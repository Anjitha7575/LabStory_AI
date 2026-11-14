# LabStory AI

Turn a pile of lab reports into one clear story of your health over time.

Upload your blood test reports (PDF or photos). LabStory AI reads them, pulls out every test result, and shows each test as a chart over time, with a simple badge: **within range**, **needs attention**, or **not enough data**. You can also ask health questions, and it answers using a trusted reference guide, with sources.

**Live demo:** https://lab-story-ai-ten.vercel.app

## Why I built it

Most people get lab reports from different labs, in different formats, years apart. Comparing "Cholesterol in 2023 vs 2025" means digging through old PDFs. LabStory puts all of it in one place.

## How it works

1. **Upload:** add up to 30 reports at once (PDF, JPG or PNG).
2. **Extract:** Gemini reads all reports in one call and returns structured data: test name, value, unit, reference range and report date.
3. **Group:** Python groups the same test across reports (matched by name and unit) and builds a timeline for each test.
4. **Show:** the React app draws a chart for every test and marks the latest value against its reference range.
5. **Ask:** a question like "What can help improve cholesterol?" is answered using RAG: the app finds the most relevant parts of a health reference guide (stored as embeddings in MongoDB) and Gemini answers using only those parts, with sources.

## Safety rules I built in

Health data needs care, so the AI is told to:

- **Never invent** a test result, unit, reference range or date. If a value isn't clearly readable, it's skipped.
- Keep units **exactly as printed** in the report.
- **Never diagnose** diseases or suggest treatment.
- Keep each report separate, never mixing results from different reports.

Every extracted result is also matched back to its original report ID, so data can always be traced to its source.

## Tech

- Backend: Python, FastAPI, Google Gemini (extraction + embeddings), MongoDB, pypdf
- Frontend: React + Vite
- Hosting: Vercel (frontend), Render (backend)

## Run it locally

Backend:

```bash
cd backend
pip install -r requirements.txt
```

Create `backend/.env`:

```
GEMINI_API_KEY=your_key_here
MONGO_URI=your_mongodb_uri
```

Then:

```bash
uvicorn main:app --reload --port 8000
```

Frontend (in another terminal):

```bash
cd frontend
npm install
npm run dev
```

## Main API endpoints

| Endpoint | What it does |
|---|---|
| `POST /patients/{id}/reports/batch` | Upload a batch of reports |
| `GET /patients/{id}/reports/status` | Check extraction progress |
| `GET /patients/{id}/analysis` | Get grouped results for the charts |
| `POST /ask` | Ask a health question (answered from the reference guide) |

## Limitations

- Reads only what is printed. Blurry photos may give fewer results.
- The same test with different names across labs (for example "HbA1c" vs "Glycated Haemoglobin") may show as two separate charts.
- This is not medical advice. Always talk to a doctor about your results.
