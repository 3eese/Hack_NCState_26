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

### Open/Close Behavior

1. Move cursor to the **right edge** of any `http/https` page to open sidebar
2. Click **outside** sidebar to close
3. Alternative toggle:
   1. Extension toolbar icon
   2. `Ctrl + Shift + Z` (`Cmd + Shift + Z` on Mac)

### Scan Actions

1. **Analyze Selection**
   1. Highlight text on the page
   2. Click button
2. **Analyze Page URL**
   1. Sends current page URL to backend
3. **Use Pasted Text**
   1. Paste content in textarea
   2. Click button
   3. If pasted value is a URL, extension auto-routes as URL input

### Report Output

The extension calls backend through service worker:

1. `POST /api/ingest`
2. `POST /api/verify`
3. `POST /api/protect`

Results are shown in two cards:

1. Verify
2. Protect

Each card includes verdict, score, summary, key findings, source count, and endpoint timing.

## 5. Development Workflow

When you edit extension files:

1. Save code changes
2. Go to `chrome://extensions`
3. Click **Reload** on the Zeda extension card
4. Refresh the target webpage

## 6. Configure Backend URL (Optional)

Default backend URL is `http://localhost:8000`.

You can change it directly in the sidebar:

1. Open sidebar
2. In **Backend Connection**, enter new base URL
3. Click **Save**

Alternative (service worker console):

```js
chrome.storage.local.set({ zedaBackendBaseUrl: "https://your-api.example.com" });
```

Reload extension after changing this value.

## 7. Troubleshooting

1. **Sidebar does not appear**
   1. Ensure page is `http/https` (not `chrome://` pages)
   2. Reload extension and refresh page
2. **Scan fails**
   1. Confirm backend is running on configured URL
   2. Check backend logs for endpoint errors
3. **No results in cards**
   1. Inspect extension service worker console for network errors
   2. Verify CORS/host permissions match backend origin
