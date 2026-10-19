
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

from schemas.lab_report import LabReportBatch
from services.report_service import extract_text_from_pdf


load_dotenv()

logger = logging.getLogger(__name__)

GEMINI_MODEL =  os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError(
        "GEMINI_API_KEY is missing. Add it to your backend .env file."
    )

client = genai.Client(api_key=api_key)


def analyze_report_batch(files: list[dict]) -> LabReportBatch:
    """
    Extract lab results from a batch of PDF/image reports.

    Makes exactly one Gemini API call for this batch.
    Each result must contain the corresponding MongoDB report_id.
    """
    if not files:
        raise ValueError("No reports were provided for analysis.")

    contents = [
        """
You are a medical laboratory report data extraction assistant.

Extract laboratory test results from every supplied report.

Return JSON matching the supplied schema.

Rules:
1. Return exactly one result for every supplied report.
2. Copy the report_id provided in the accompanying metadata exactly.
3. Never invent a report_id, test result, unit, reference range, or date.
4. Extract the report date when clearly available; otherwise return null.
5. Extract the test name, numeric value, unit, and reference range.
6. If a reference range is unavailable, use null for its lower and upper
   bounds.
7. If a value is not clearly readable, do not guess or invent it.
8. Include only results supported by the report.
9. Keep units as printed in the original report.
10. The summary should briefly describe the extracted batch. Do not
    diagnose diseases or recommend treatment.
11. Do not combine results from different reports into one report.
12. Return an empty tests list if no laboratory results can be reliably
    extracted from a report.
"""
    ]

    expected_report_ids = set()

    for report in files:
        report_id = str(report["_id"])
        expected_report_ids.add(report_id)

        filename = report.get("filename", "unknown")
        file_path = report.get("file_path")

        if not file_path:
            raise ValueError(
                f"No file path found for report {report_id}."
            )

        path = Path(file_path)

        if not path.is_file():
            raise FileNotFoundError(
                f"Uploaded file is missing for report {report_id}: "
                f"{path}"
            )

        extension = path.suffix.lower()
        content_type = report.get("content_type", "")

        # Include the identifier so the response can be matched back
        # to the correct MongoDB record.
        contents.append(
            f"""
Report metadata:
report_id: {report_id}
filename: {filename}
file_type: {content_type or extension}

Extract results only from the report immediately following this metadata.
Return this exact report_id in the corresponding result.
"""
        )

        if extension == ".pdf":
            # Extract selectable text from a PDF.
            text = extract_text_from_pdf(str(path))

            if not text or not text.strip():
                raise ValueError(
                    f"{filename} contains no extractable PDF text. "
                    "This may be a scanned PDF. OCR or PDF vision "
                    "support is needed for this file."
                )

            contents.append(
                f"PDF report text for report_id {report_id}:\n{text}"
            )

        elif extension in {".jpg", ".jpeg", ".png"}:
            expected_mime_types = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
            }

            mime_type = expected_mime_types[extension]

            if content_type and content_type != mime_type:
                logger.warning(
                    "Content type %s differs from extension %s for %s",
                    content_type,
                    extension,
                    filename,
                )

            try:
                image_bytes = path.read_bytes()
            except OSError as exc:
                raise ValueError(
                    f"Could not read image file {filename}."
                ) from exc

            if not image_bytes:
                raise ValueError(f"Image file {filename} is empty.")

            contents.append(
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=mime_type,
                )
            )

        else:
            raise ValueError(
                f"Unsupported file type for {filename}: {extension}"
            )

    logger.info(
        "Sending %d reports to Gemini in one request",
        len(files),
    )

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=LabReportBatch,
                temperature=0.1,
            ),
        )
    except Exception:
        logger.exception("Gemini API request failed")
        raise

    # Prefer the SDK's parsed response when available.
    parsed = getattr(response, "parsed", None)

    if isinstance(parsed, LabReportBatch):
        result = parsed
    elif parsed is not None:
        result = LabReportBatch.model_validate(parsed)
    else:
        response_text = getattr(response, "text", None)

        if not response_text:
            raise ValueError(
                "Gemini returned no usable response. Check the backend "
                "logs for API errors or response blocking."
            )

        try:
            result = LabReportBatch.model_validate_json(response_text)
        except Exception as exc:
            logger.exception(
                "Could not validate Gemini's JSON response"
            )
            raise ValueError(
                "Gemini returned a response that did not match "
                "the expected lab report schema."
            ) from exc

    results_by_id = {
        item.report_id: item
        for item in result.reports
    }

    if len(results_by_id) != len(result.reports):
        raise ValueError(
            "Gemini returned duplicate report IDs."
        )

    returned_ids = set(results_by_id)

    if returned_ids != expected_report_ids:
        missing_ids = expected_report_ids - returned_ids
        unexpected_ids = returned_ids - expected_report_ids

        raise ValueError(
            "Gemini's report IDs did not match the uploaded batch. "
            f"Missing IDs: {sorted(missing_ids)}; "
            f"unexpected IDs: {sorted(unexpected_ids)}."
        )

    logger.info(
        "Gemini extracted %d reports successfully",
        len(result.reports),
    )

    return result
