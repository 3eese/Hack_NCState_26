# Zeda MV3 Extension

Current implementation includes:

1. Phase 1 shell (manifest, worker, shortcut, injection)
2. Phase 2 sidebar UI (Shadow DOM + Sider-style open/close behavior)
3. Phase 3 integration (`/api/ingest`, `/api/verify`, `/api/protect` via service worker)
4. Mode-first capture flows:
   1. Upload image / URL / text
   2. Capture full visible screen and auto-analyze
   3. Capture selected area and auto-analyze
   4. Clipboard image paste shortcut (`Ctrl/Cmd + V`) in Image tab

For developer setup and usage instructions, see:

- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
