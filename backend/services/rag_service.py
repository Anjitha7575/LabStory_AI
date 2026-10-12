
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from google import genai

load_dotenv()

# Existing .env variables
MONGO_URI = os.getenv("MONGO_URI")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not MONGO_URI or not GEMINI_API_KEY:
    raise ValueError("Missing MONGO_URI or GEMINI_API_KEY in .env")

mongo_client = MongoClient(MONGO_URI)
db = mongo_client["medtrack"]
knowledge_collection = db["medical_knowledge"]

gemini_client = genai.Client(api_key=GEMINI_API_KEY)

EMBEDDING_MODEL = "gemini-embedding-001"


def chunk_text(text: str, chunk_size: int = 1500, overlap: int = 200):
    """Split reference text into overlapping chunks."""
    text = " ".join(text.split())
    chunks = []

    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        if end >= len(text):
            break

        start = end - overlap

    return chunks


def create_embedding(text: str) -> list[float]:
    """Convert text into a vector using Gemini."""
    response = gemini_client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
        config={"output_dimensionality": 3072},
    )

    return response.embeddings[0].values


def ingest_reference(
    title: str,
    source_url: str,
    text: str,
):
    """Chunk a reference, embed it, and store it in MongoDB."""
    chunks = chunk_text(text)

    if not chunks:
        raise ValueError("Reference text is empty")

    documents = []

    for index, chunk in enumerate(chunks):
        embedding = create_embedding(chunk)

        documents.append({
            "title": title,
            "source_url": source_url,
            "chunk_index": index,
            "text": chunk,
            "embedding": embedding,
        })

    # Avoid duplicate copies when re-ingesting the same reference.
    knowledge_collection.delete_many({
        "source_url": source_url
    })

    if documents:
        knowledge_collection.insert_many(documents)

    return len(documents)



def search_medical_knowledge(question: str, limit: int = 3):
    """Find medical knowledge chunks relevant to a question."""

    # Convert the user's question into an embedding
    question_embedding = create_embedding(question)

    # Search MongoDB for the most similar chunks
    results = knowledge_collection.aggregate([
        {
            "$vectorSearch": {
                "index": "vector_index",
                "path": "embedding",
                "queryVector": question_embedding,
                "numCandidates": 30,
                "limit": limit
            }
        },
        {
            "$project": {
                "_id": 0,
                "title": 1,
                "source_url": 1,
                "text": 1,
                "score": {"$meta": "vectorSearchScore"}
            }
        }
    ])

    return list(results)



def ask_labstory(question: str):
    # 1. Retrieve relevant medical knowledge
    chunks = search_medical_knowledge(question, limit=3)

    if not chunks:
        return {
            "answer": "I couldn't find relevant information in the available references.",
            "sources": [],
        }

    # 2. Prepare the retrieved evidence
    context = "\n\n".join(
        f"Source: {chunk['title']}\n"
        f"URL: {chunk['source_url']}\n"
        f"Content: {chunk['text']}"
        for chunk in chunks
    )

    # 3. Ask Gemini to answer using the evidence
    prompt = f"""
You are LabStory, an assistant that explains laboratory information.

Answer the user's question using ONLY the reference material below.

Rules:
- Do not invent medical facts or unsupported conclusions.
- If the references do not contain the answer, say so.
- Do not diagnose diseases or prescribe treatment.
- Explain the information in simple language.
- This is educational information, not a substitute for a clinician.

Reference material:
{context}

User question:
{question}
"""

    response = gemini_client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )

    return {
        "answer": response.text or "I couldn't generate an answer.",
        "sources": [
            {
                "title": chunk["title"],
                "url": chunk["source_url"],
            }
            for chunk in chunks
        ],
    }
