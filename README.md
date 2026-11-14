# ResuMatch - AI Resume and Job Matching

A local web app with secure accounts, private resume uploads, Gemini resume analysis, Google Jobs search, and application tracking.

## Requirements
- Node.js 20 or newer
- npm
- Gemini API key for resume analysis
- SerpApi API key for Google Jobs results

## Configure
Set these values in `.env` (keep this file private):

```env
JWT_SECRET=your-long-random-secret-at-least-32-characters
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.8-flash
SERPAPI_API_KEY=your-serpapi-key
GOOGLE_JOBS_LOCATION=India
GOOGLE_JOBS_DOMAIN=google.co.in
GOOGLE_JOBS_COUNTRY=in
GOOGLE_JOBS_LANGUAGE=en
```

Get a SerpApi key at https://serpapi.com/manage-api-key. The Google Jobs engine is provided by SerpApi; Google does not provide a public API to search the Google Jobs listings directly. SerpApi's free plan currently includes a limited monthly search quota. Keep the key on the server and do not add it to browser code.

The Google Jobs location settings are optional. The app defaults to India and English. Restart the dev server after changing `.env`.

## Start

```powershell
npm.cmd run dev
```

Open http://localhost:3000. The SQLite database is created automatically at `data/resumatch.sqlite`.

## Use
1. Create an account and log in.
2. Upload a text-based PDF, DOC, DOCX or TXT resume (maximum 10 MB).
3. Wait for Gemini to analyse it and search Google Jobs for matching skills.
4. Open a listing at its original application site or save it to your tracker.

## API overview
- `POST /api/auth/register` - create an account
- `POST /api/auth/login` - sign in
- `POST /api/auth/logout` - sign out
- `POST /api/resume/upload` - upload and extract resume text
- `POST /api/resume/:id/analyse` - analyse the resume and find jobs
- `GET /api/jobs` - search Google Jobs via SerpApi
- `POST /api/jobs/:id/save` - save a job
- `GET /api/jobs/applications` - list saved applications
- `PATCH /api/jobs/applications/:id` - update application status

## Notes
- Google Jobs results are returned by SerpApi's `google_jobs` engine. They may include links to Google job details and the original hiring site.
- Match scores count resume skills mentioned in each listing. They are not predictions of hiring outcomes.
- Scanned PDFs need OCR before upload.
- Resume analysis sends extracted resume text to Google's Gemini API.
- Uploaded resumes and `.env` must remain private. Do not commit secrets, databases, or resume files.
## Team
- **Team name:** Next X
- **Developed By:**
  1. Supratim Gogoi
  2. Shahan Uz Zaman
