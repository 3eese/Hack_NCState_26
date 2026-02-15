# Zeda Extension Developer Guide

This guide explains how to install, run, and use the Zeda Manifest V3 extension in development.

## 1. Prerequisites

1. Chromium browser (Chrome, Edge, Brave)
2. Local backend running on `http://localhost:8000`
3. Repository cloned locally

## 2. Start the Backend

From the repository root:

```bash
cd backend
npm install
npm run dev
```

Confirm backend health:

```bash
curl http://localhost:8000/health
```

## 3. Load the Extension

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select:

`/Hack_NCState_26/extension`

## 4. Use the Extension

### Open/Close

1. Move cursor to the **right edge** of any `http/https` page to open sidebar
2. Click outside sidebar to close
3. Alternative toggle:
   1. Extension toolbar icon
   2. `Ctrl + Shift + Z` (`Cmd + Shift + Z` on Mac)

### Analysis Flow

1. Choose mode: **Verify** or **Protect**
2. Choose input tab: **Image**, **URL**, or **Text**
3. Run analysis:
   1. Manual upload/input + **Analyze**
   2. **Capture Full View & Analyze**
   3. **Capture Area & Analyze**
   4. In Image tab: paste screenshot via `Ctrl/Cmd + V`

### Capture Modes

1. **Full View**
   1. Captures current visible tab viewport
   2. Sends screenshot directly for selected mode analysis
2. **Area Capture**
   1. Captures full visible tab viewport
   2. Prompts drag-to-select area overlay
   3. Crops selection and sends cropped image for analysis
   4. Press `Esc` to cancel selection

### Backend Routing

The service worker handles extension-side routing:

1. Text/Image inputs: call selected endpoint directly
   1. `POST /api/verify` or `POST /api/protect`
2. URL input:
   1. Attempt `POST /api/ingest`
   2. Then selected endpoint with normalized data
   3. Fallback to direct selected endpoint if ingest fails

## 5. Development Workflow

When you edit extension files:

1. Save code changes
2. Go to `chrome://extensions`
3. Click **Reload** on the Zeda extension card
4. Refresh the target webpage

## 6. Configure Backend URL (Optional)

Default backend URL is `http://localhost:8000`.

To override:

```js
chrome.storage.local.set({ zedaBackendBaseUrl: "https://your-api.example.com" });
```

Reload extension after changing this value.

## 7. Troubleshooting

1. Sidebar does not appear:
   1. Ensure page is `http/https` (not `chrome://` pages)
   2. Reload extension and refresh page
2. Capture fails:
   1. Check browser permission prompts
   2. Ensure active tab is a normal web page
3. Analysis times out:
   1. Confirm backend is running on configured URL
   2. Check backend logs for `/api/verify` or `/api/protect` latency/errors
