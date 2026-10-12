
import fitz  # PyMuPDF
from pathlib import Path

from services.rag_service import ingest_reference

PDF_PATH = Path("data/labstory_health_advice_guide.pdf")


def extract_pdf_text(pdf_path: Path):
    pages = []

    with fitz.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf, start=1):
            text = page.get_text("text").strip()

            if text:
                pages.append(
                    f"[Page {page_number}]\n{text}"
                )

    return "\n\n".join(pages)


if __name__ == "__main__":
    if not PDF_PATH.exists():
        raise FileNotFoundError(
            f"PDF not found: {PDF_PATH.resolve()}\n"
            "Place the generated PDF in the data/ folder."
        )

    text = extract_pdf_text(PDF_PATH)

    if not text:
        raise ValueError("No text was extracted from the PDF.")

    count = ingest_reference(
        title="LabStory Health Advice Guide",
        source_url="local://labstory_health_advice_guide.pdf",
        text=text,
    )

    print(f"Extracted {len(text)} characters.")
    print(f"Stored {count} chunks in medical_knowledge.")
