from dotenv import load_dotenv
from pymongo import MongoClient
import os

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")

mongo_client = MongoClient(MONGO_URI)

db = mongo_client["medtrack"]

reports_collection = db["reports"]