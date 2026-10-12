
import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware

from config import UPLOAD_DIR
from database import mongo_client, reports_collection, db
from services.gemini_service import analyze_report_batch
from pydantic import BaseModel
from services.rag_service import ask_labstory

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="LabStory API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://lab-story-ai-ten.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

patient_analysis_collection = db["patient_analysis"]

ALLOWED_TYPES = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}

MAX_FILES = 30
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_BATCH_BYTES = 50 * 1024 * 1024


def utc_now():
    return datetime.now(timezone.utc)


def build_graph_data(reports: list) -> list:
    """Build graph-ready data from extracted lab reports."""
    grouped_tests = {}

    for report in reports:
        structured = report.get("structured_report") or {}
        report_date = structured.get("report_date")

        if not report_date:
            continue

        for test in structured.get("tests", []):
            name = (test.get("name") or "").strip()
            unit = (test.get("unit") or "").strip()
            value = test.get("value")

            if not name or value is None:
                continue

            key = (name.casefold(), unit.casefold())

            if key not in grouped_tests:
                grouped_tests[key] = {
                    "test_name": name,
                    "unit": unit,
                    "data_points": [],
                }

            grouped_tests[key]["data_points"].append({
                "date": report_date,
                "value": value,
                "reference_low": test.get("reference_low"),
                "reference_high": test.get("reference_high"),
            })

    analysis = []

    for item in grouped_tests.values():
        points = item["data_points"]
        points.sort(key=lambda point: point["date"])

        values = [point["value"] for point in points]

        if len(values) < 2:
            trend = "insufficient data"
        elif values[-1] > values[0]:
            trend = "increasing"
        elif values[-1] < values[0]:
            trend = "decreasing"
        else:
            trend = "unchanged"

        analysis.append({
            **item,
            "trend": trend,
        })

    return analysis


def process_report_batch(patient_id: str, report_ids: list[str]):
    """
    Process the entire uploaded batch with one Gemini call.
    All report records have already been inserted into MongoDB.
    """
    object_ids = [ObjectId(report_id) for report_id in report_ids]

    report_filter = {
        "_id": {"$in": object_ids},
        "patient_id": patient_id,
    }

    batch = []
    paths = []

    try:
        batch = list(reports_collection.find(report_filter))

        if len(batch) != len(report_ids):
            raise ValueError(
                "Some uploaded report records could not be found."
            )

        paths = [
            report["file_path"]
            for report in batch
            if report.get("file_path")
        ]

        patient_analysis_collection.update_one(
            {"patient_id": patient_id},
            {
                "$set": {
                    "status": "processing",
                    "updated_at": utc_now(),
                    "error": None,
                },
                "$setOnInsert": {
                    "created_at": utc_now(),
                },
            },
            upsert=True,
        )

        reports_collection.update_many(
            report_filter,
            {
                "$set": {
                    "status": "processing",
                    "processing_started_at": utc_now(),
                    "processing_error": None,
                }
            },
        )

        # The only Gemini call for this batch.
        extracted = analyze_report_batch(batch)

        results_by_id = {
            item.report_id: item
            for item in extracted.reports
        }

        expected_ids = set(report_ids)
        returned_ids = set(results_by_id)

        if expected_ids != returned_ids:
            raise ValueError(
                "Gemini did not return exactly one result per uploaded file."
            )

        # Save each extracted report.
        for report_id in report_ids:
            result = results_by_id[report_id]

            update_result = reports_collection.update_one(
                {
                    "_id": ObjectId(report_id),
                    "patient_id": patient_id,
                },
                {
                    "$set": {
                        "structured_report": {
                            "report_date": result.report_date,
                            "tests": [
                                test.model_dump()
                                for test in result.tests
                            ],
                        },
                        "status": "extracted",
                        "extracted_at": utc_now(),
                        "processing_error": None,
                    }
                },
            )

            if update_result.matched_count != 1:
                raise ValueError(
                    f"Could not save extracted report {report_id}."
                )

        # Build graphs locally; this does not call Gemini.
        # Include previously extracted reports for longitudinal graphs.
        all_extracted_reports = list(
            reports_collection.find({
                "patient_id": patient_id,
                "status": "extracted",
                "structured_report": {"$ne": None},
            })
        )

        graph_data = build_graph_data(all_extracted_reports)

        patient_analysis_collection.update_one(
            {"patient_id": patient_id},
            {
                "$set": {
                    "status": "completed",
                    "analysis": graph_data,
                    "summary": extracted.summary,
                    "report_count": len(all_extracted_reports),
                    "completed_at": utc_now(),
                    "updated_at": utc_now(),
                    "error": None,
                }
            },
            upsert=True,
        )

        logger.info(
            "Batch completed for patient %s: %d uploaded reports",
            patient_id,
            len(report_ids),
        )

    except Exception:
        logger.exception(
            "Batch processing failed for patient %s",
            patient_id,
        )

        reports_collection.update_many(
            report_filter,
            {
                "$set": {
                    "status": "failed",
                    "processing_error": (
                        "Batch processing failed. Please retry."
                    ),
                    "failed_at": utc_now(),
                }
            },
        )

        patient_analysis_collection.update_one(
            {"patient_id": patient_id},
            {
                "$set": {
                    "status": "failed",
                    "updated_at": utc_now(),
                    "error": (
                        "Batch processing failed. Please retry."
                    ),
                }
            },
            upsert=True,
        )

    finally:
        # Uploaded files are temporary; extracted data stays in MongoDB.
        for path in paths:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                logger.exception(
                    "Could not remove temporary file: %s",
                    path,
                )


@app.get("/")
def root():
    return {"message": "LabStory API"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-test")
def db_test():
    return {
        "message": "MongoDB connected",
        "result": mongo_client.admin.command("ping"),
    }


@app.post("/patients/{patient_id}/reports/batch", status_code=202)
async def upload_patient_reports_batch(
    patient_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    patient_name: str = Form(...),
):
    """
    Save every file and report record first.
    Schedule background processing only after all records are saved.
    """
    if not files or len(files) > MAX_FILES:
        for file in files:
            await file.close()

        raise HTTPException(
            status_code=400,
            detail=f"Upload between 1 and {MAX_FILES} files.",
        )

    os.makedirs(UPLOAD_DIR, exist_ok=True)

    saved_paths = []
    report_docs = []
    total_bytes = 0

    try:
        for file in files:
            filename = file.filename or "unnamed"
            extension = os.path.splitext(filename)[1].lower()

            if extension not in ALLOWED_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Unsupported file type: {filename}. "
                        "Upload PDF, JPG, JPEG, or PNG files."
                    ),
                )

            file_path = os.path.join(
                UPLOAD_DIR,
                f"{uuid4()}{extension}",
            )

            file_size = 0

            try:
                with open(file_path, "wb") as output:
                    while True:
                        chunk = await file.read(1024 * 1024)

                        if not chunk:
                            break

                        file_size += len(chunk)
                        total_bytes += len(chunk)

                        if file_size > MAX_FILE_BYTES:
                            raise HTTPException(
                                status_code=413,
                                detail=f"{filename} exceeds 15 MB.",
                            )

                        if total_bytes > MAX_BATCH_BYTES:
                            raise HTTPException(
                                status_code=413,
                                detail="The batch exceeds 50 MB.",
                            )

                        output.write(chunk)

                if file_size == 0:
                    raise HTTPException(
                        status_code=400,
                        detail=f"{filename} is empty.",
                    )

                saved_paths.append(file_path)

                report_docs.append({
                    "_id": ObjectId(),
                    "patient_id": patient_id,
                    "patient_name": patient_name,
                    "filename": filename,
                    "file_path": file_path,
                    "content_type": ALLOWED_TYPES[extension],
                    "status": "uploaded",
                    "uploaded_at": utc_now(),
                    "structured_report": None,
                })

            finally:
                await file.close()

        # Insert every report record before starting any processing.
        reports_collection.insert_many(
            report_docs,
            ordered=True,
        )

        patient_analysis_collection.update_one(
            {"patient_id": patient_id},
            {
                "$set": {
                    "status": "pending",
                    "updated_at": utc_now(),
                    "error": None,
                },
                "$setOnInsert": {
                    "created_at": utc_now(),
                },
            },
            upsert=True,
        )

    except Exception as exc:
        # Roll back any records inserted for this batch.
        if report_docs:
            try:
                reports_collection.delete_many({
                    "_id": {
                        "$in": [
                            doc["_id"] for doc in report_docs
                        ]
                    },
                    "patient_id": patient_id,
                })
            except Exception:
                logger.exception(
                    "Could not roll back batch report records"
                )

        for path in saved_paths:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                logger.exception(
                    "Could not clean up temporary file: %s",
                    path,
                )

        if isinstance(exc, HTTPException):
            raise

        logger.exception("Could not save report batch")

        raise HTTPException(
            status_code=500,
            detail="Could not save the complete batch.",
        ) from exc

    report_ids = [
        str(doc["_id"])
        for doc in report_docs
    ]

    # This runs only after all report records have been saved.
    background_tasks.add_task(
        process_report_batch,
        patient_id,
        report_ids,
    )

    return {
        "message": (
            f"{len(report_ids)} files saved. "
            "Batch processing started."
        ),
        "patient_id": patient_id,
        "report_ids": report_ids,
        "status": "uploaded",
    }


@app.get("/patients/{patient_id}/reports/status")
def get_patient_report_status(patient_id: str):
    """Return upload and extraction status for each report."""
    reports = list(
        reports_collection.find(
            {"patient_id": patient_id},
            {
                "_id": 1,
                "filename": 1,
                "status": 1,
                "uploaded_at": 1,
                "extracted_at": 1,
                "processing_error": 1,
            },
        ).sort("uploaded_at", 1)
    )

    report_items = [
        {
            "report_id": str(report["_id"]),
            "filename": report.get("filename"),
            "status": report.get("status", "uploaded"),
            "uploaded_at": report.get("uploaded_at"),
            "extracted_at": report.get("extracted_at"),
            "processing_error": report.get("processing_error"),
        }
        for report in reports
    ]

    analysis = patient_analysis_collection.find_one(
        {"patient_id": patient_id},
        {
            "_id": 0,
            "status": 1,
            "report_count": 1,
            "completed_at": 1,
            "updated_at": 1,
            "error": 1,
        },
    )

    return {
        "patient_id": patient_id,
        "reports": report_items,
        "analysis": analysis or {"status": "pending"},
    }


@app.get("/patients/{patient_id}/analysis")
def get_patient_analysis(patient_id: str):
    """Return cached analysis; do not call Gemini here."""
    result = patient_analysis_collection.find_one(
        {"patient_id": patient_id},
        {"_id": 0},
    )

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Analysis has not been created yet.",
        )

    return result

class AskLabStoryRequest(BaseModel):
    question: str


@app.post("/ask")
def ask(request: AskLabStoryRequest):
    return ask_labstory(request.question)