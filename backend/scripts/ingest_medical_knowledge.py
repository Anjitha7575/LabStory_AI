
from services.rag_service import ingest_reference

sample_text = """
A laboratory reference range is the range of test results
typically found in a healthy population. Reference ranges can
vary between laboratories, methods, and patient populations.
Results should be interpreted using the reference range printed
on the laboratory report and in the context of clinical findings.
"""

count = ingest_reference(
    title="Laboratory Reference Ranges — Introductory Note",
    source_url="https://example.org/lab-reference-ranges-intro",
    text=sample_text,
)

print(f"Stored {count} medical knowledge chunk(s).")
