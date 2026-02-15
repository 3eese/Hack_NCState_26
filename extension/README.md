# Zeda MV3 Extension (Phase 1)

This folder contains the Phase 1 shell for the Zeda browser extension:

1. Manifest V3 setup
2. Service worker
3. Toolbar + keyboard shortcut trigger
4. On-demand sliding sidebar injection

## Load Locally (Chrome / Chromium)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `/extension` folder
5. Open any `http` or `https` page
6. Click the extension icon, or use `Ctrl/Command + Shift + Z`

## Notes

1. This is a Phase 1 shell only.
2. API calls to backend are not wired yet.
3. Next phase adds scan actions and message-based API integration.
