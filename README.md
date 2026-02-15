# Zeda

Zeda is a multimodal trust-and-safety platform with two modes:

- `Verify`: checks whether a claim is supported by public evidence.
- `Protect`: detects phishing/privacy risk patterns in content.

Inputs supported:

- Text
- URL
- Image (including screenshots)

Zeda includes:

- Web app (`frontend`)
- Backend API (`backend`)
- Chrome/Chromium extension (`extension`)

## User Guide

### Use the Web App

1. Open the app in your browser (`http://localhost:8080` by default).
2. Choose a mode:
   1. `Verify`
   2. `Protect`
3. Choose input type:
   1. Text
   2. URL
   3. Image
4. Click `Analyze`.
5. Review:
   1. Score / verdict
   2. Key findings
   3. Potentially suspicious parts
   4. Evidence sources (when available)

### Use the Browser Extension

1. Open any normal `http/https` webpage.
2. Open the Zeda sidebar:
   1. Move cursor to the right edge, or
   2. Use toolbar icon, or
   3. `Ctrl+Shift+Z` (`Cmd+Shift+Z` on Mac)
3. Choose `Verify` or `Protect`.
4. Choose input tab (`Image`, `URL`, `Text`).
5. Run analysis using one of:
   1. Manual input + `Analyze`
   2. `Capture Full View & Analyze`
   3. `Capture Area & Analyze`
   4. Paste screenshot in Image tab (`Ctrl/Cmd + V`)

## Developer Guide

### Project Structure

```text
Hack_NCState_26/
  backend/     # Express API: ingest, verify, protect
  frontend/    # React + Vite web app
  extension/   # Manifest V3 sidebar extension
  resources/   # Shared branding assets
```

### Prerequisites

- Node.js 18+ (recommended)
- npm
- Chrome/Edge/Brave (for extension development)

### 1) Backend Setup

```bash
cd backend
npm install
cp .env.example .env
```

Set required env values in `backend/.env`:

- `PORT` (default `8000`)
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (for example `gemini-1.5-flash`)
- `GEMINI_TIMEOUT_MS` (for example `25000`)

Optional env values:

- `JSON_BODY_LIMIT` (or `BODY_LIMIT`) for large image payloads

Run backend:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:8000/health
```

### 2) Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Default frontend env:

- `VITE_API_BASE_URL=http://localhost:8000`

### 3) Extension Setup (MV3)

1. Ensure backend is running (`http://localhost:8000`).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the `extension` folder.
6. Reload extension after any code change.

### 4) API Endpoints

- `POST /api/ingest`
- `POST /api/verify`
- `POST /api/protect`
- `GET /health`

### 5) Common Scripts

Backend (`backend/package.json`):

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`

Frontend (`frontend/package.json`):

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run test`

### 6) Troubleshooting

1. `413 Payload Too Large`
   1. Increase `JSON_BODY_LIMIT` in backend env.
   2. Reduce image size before upload.
2. Extension capture permission error
   1. Reload extension.
   2. Confirm extension has site access on target page.
3. Request timeout
   1. Check backend logs.
   2. Validate API key/model configuration.
   3. Retry with smaller input.
4. No analysis output
   1. Confirm `VITE_API_BASE_URL` points to active backend.
   2. Verify backend `/health` endpoint responds.

### 7) Additional Docs

- Extension-specific developer notes: `extension/DEVELOPER_GUIDE.md`
- Extension feature summary: `extension/README.md`
