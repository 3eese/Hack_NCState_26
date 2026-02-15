const CONTENT_SCRIPT_FILE = "src/content/content-script.js";
const TOGGLE_COMMAND = "toggle-zeda-sidebar";
const RUN_SCAN_ACTION = "zeda:run-scan";
const BACKEND_BASE_URL_STORAGE_KEY = "zedaBackendBaseUrl";
const DEFAULT_BACKEND_BASE_URL = "http://localhost:8000";
const DEFAULT_REQUEST_TIMEOUT_MS = 70000;
const DEFAULT_INGEST_TIMEOUT_MS = 25000;

const VALID_INPUT_TYPES = new Set(["text", "url", "image"]);
const VALID_MODES = new Set(["verify", "protect"]);

const normalizeBaseUrl = (rawBaseUrl) => {
  const fallback = DEFAULT_BACKEND_BASE_URL;
  if (typeof rawBaseUrl !== "string" || rawBaseUrl.trim().length === 0) {
    return fallback;
  }

  return rawBaseUrl.trim().replace(/\/+$/, "");
};

const resolveBackendBaseUrl = async () => {
  try {
    const payload = await chrome.storage.local.get(BACKEND_BASE_URL_STORAGE_KEY);
    return normalizeBaseUrl(payload[BACKEND_BASE_URL_STORAGE_KEY]);
  } catch (error) {
    console.warn("[Zeda Extension] Failed to read backend URL from storage. Using default.", error);
    return DEFAULT_BACKEND_BASE_URL;
  }
};

const isSupportedTab = (tab) => {
  if (!tab || typeof tab.id !== "number" || !tab.url) {
    return false;
  }

  // Restrict injection to normal http/https pages.
  return tab.url.startsWith("http://") || tab.url.startsWith("https://");
};

const injectSidebar = async (tab) => {
  if (!isSupportedTab(tab)) {
    console.warn("[Zeda Extension] Unsupported tab for sidebar injection:", tab?.url);
    return;
  }

  try {
    // The content script owns Shadow DOM style loading, so script injection is enough.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [CONTENT_SCRIPT_FILE]
    });
  } catch (error) {
    console.error("[Zeda Extension] Failed to inject sidebar script:", error);
  }
};

const getActiveTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
};

const readPayloadText = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const createSkippedIngestResult = (reason) => ({
  ok: true,
  status: 0,
  ms: 0,
  data: {
    normalizedPayload: null,
    skipped: true,
    reason
  },
  error: null
});

const buildAnalysisPayload = (inputType, content, ingestData) => {
  const normalizedPayload = ingestData?.normalizedPayload ?? null;
  const normalizedText = readPayloadText(normalizedPayload?.text);
  const normalizedInputType =
    typeof normalizedPayload?.inputType === "string" ? normalizedPayload.inputType : inputType;

  const body = {
    inputType: normalizedInputType,
    content: normalizedText || content
  };

  if (normalizedPayload) {
    body.normalizedPayload = normalizedPayload;
  }

  // Keep the original URL available for protect heuristics when the source is URL input.
  if (inputType === "url") {
    body.url = content;
  }

  return body;
};

const buildDirectPayload = (inputType, content) => {
  const body = {
    inputType,
    content
  };

  if (inputType === "url") {
    body.url = content;
  }

  return body;
};

const callJsonEndpoint = async (baseUrl, path, payload, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const endpointUrl = `${baseUrl}${path}`;

  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    const durationMs = Date.now() - startedAt;
    const endpointMessage =
      (data && typeof data.message === "string" && data.message.trim().length > 0 && data.message.trim()) ||
      `Request failed with status ${response.status}.`;

    const isApiSuccess = data && typeof data === "object" ? data.status !== "error" : true;
    const ok = response.ok && isApiSuccess;

    return {
      ok,
      status: response.status,
      ms: durationMs,
      data: data?.data ?? null,
      error: ok ? null : endpointMessage
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Request timed out after ${Math.round(timeoutMs / 1000)}s (${endpointUrl}).`
        : error instanceof Error
          ? error.message
          : "Unknown request failure.";

    return {
      ok: false,
      status: 0,
      ms: durationMs,
      data: null,
      error: message
    };
  } finally {
    clearTimeout(timeout);
  }
};

const runScanPipeline = async ({ mode, inputType, content, source }) => {
  if (!VALID_MODES.has(mode)) {
    throw new Error("Unsupported mode. Expected verify or protect.");
  }

  if (!VALID_INPUT_TYPES.has(inputType)) {
    throw new Error("Unsupported inputType. Expected text, url, or image.");
  }

  const normalizedContent = readPayloadText(content);
  if (!normalizedContent) {
    throw new Error("Scan content is empty.");
  }

  const baseUrl = await resolveBackendBaseUrl();
  const startedAt = Date.now();

  // Route selection:
  // - URL: try ingest first (scraping), then analyze normalized text. If ingest fails, fall back to direct URL analysis.
  // - Text/Image: skip ingest and analyze directly to reduce latency and avoid OCR dependency failures for images.
  const shouldUseIngest = inputType === "url";
  let ingestResult = shouldUseIngest
    ? await callJsonEndpoint(baseUrl, "/api/ingest", {
        inputType,
        content: normalizedContent
      }, DEFAULT_INGEST_TIMEOUT_MS)
    : createSkippedIngestResult(`Ingest skipped for ${inputType} input.`);

  let analysisResult = {
    ok: false,
    status: 0,
    ms: 0,
    data: null,
    error: `${mode} was skipped because ingest failed.`
  };

  if (shouldUseIngest && ingestResult.ok) {
    const analysisPayload = buildAnalysisPayload(inputType, normalizedContent, ingestResult.data);
    const endpointPath = mode === "verify" ? "/api/verify" : "/api/protect";

    // Run the selected engine on normalized ingest output.
    analysisResult = await callJsonEndpoint(baseUrl, endpointPath, analysisPayload);
  } else {
    const endpointPath = mode === "verify" ? "/api/verify" : "/api/protect";
    const directPayload = buildDirectPayload(inputType, normalizedContent);

    // Fallback or direct flow: always attempt selected engine even if ingest fails/skips.
    analysisResult = await callJsonEndpoint(baseUrl, endpointPath, directPayload);

    if (shouldUseIngest && !ingestResult.ok && !analysisResult.ok) {
      analysisResult.error = `Ingest failed (${ingestResult.error || "unknown"}) and ${mode} analysis failed (${analysisResult.error || "unknown"}).`;
    }
  }

  const finishedAt = Date.now();
  return {
    backendBaseUrl: baseUrl,
    mode,
    input: {
      inputType,
      source,
      contentPreview: normalizedContent.slice(0, 280)
    },
    ingest: ingestResult,
    analysis: analysisResult,
    timings: {
      totalMs: finishedAt - startedAt
    }
  };
};

// Toolbar click toggles (or first-time injects) the sidebar in the active page.
chrome.action.onClicked.addListener(async (tab) => {
  await injectSidebar(tab);
});

// Keyboard shortcut uses the same injection path as the toolbar action.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== TOGGLE_COMMAND) {
    return;
  }

  const activeTab = await getActiveTab();
  await injectSidebar(activeTab);
});

// Content scripts ask the worker to run backend calls so page scripts never handle API credentials directly.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.action !== RUN_SCAN_ACTION) {
    return false;
  }

  (async () => {
    try {
      const pipelineResult = await runScanPipeline(message.payload ?? {});
      sendResponse({
        ok: true,
        data: pipelineResult
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown scan error."
      });
    }
  })();

  return true;
});
