from pypdf import PdfReader


def extract_text_from_pdf(file_path: str) -> str:
    """Extract selectable text from a text-based PDF."""
    reader = PdfReader(file_path)
    return "\n".join(page.extract_text() or "" for page in reader.pages)
