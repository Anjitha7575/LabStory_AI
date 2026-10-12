
from services.rag_service import search_medical_knowledge

question = "What is a laboratory reference range?"

results = search_medical_knowledge(question)

for result in results:
    print("\nTitle:", result["title"])
    print("Score:", result["score"])
    print("Text:", result["text"])
