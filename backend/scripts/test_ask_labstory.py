
from services.rag_service import ask_labstory

# result = ask_labstory(
#     "What is a laboratory reference range?"
# )

# print("\nAnswer:")
# print(result["answer"])

# print("\nSources:")
# for source in result["sources"]:
#     print(source["title"], "-", source["url"])



result = ask_labstory(
    "What lifestyle changes can help improve cholesterol?"
)

print("\nAnswer:")
print(result["answer"])

print("\nSources:")
for source in result["sources"]:
    print(source["title"], "-", source["url"])
