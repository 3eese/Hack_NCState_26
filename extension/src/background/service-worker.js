const CONTENT_SCRIPT_FILE = "src/content/content-script.js";
const TOGGLE_COMMAND = "toggle-zeda-sidebar";
const RUN_SCAN_ACTION = "zeda:run-scan";
const BACKEND_BASE_URL_STORAGE_KEY = "zedaBackendBaseUrl";
const DEFAULT_BACKEND_BASE_URL = "http://localhost:8000";
const DEFAULT_REQUEST_TIMEOUT_MS = 18000;

const VALID_INPUT_TYPES = new Set(["text", "url", "image"]);

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

const callJsonEndpoint = async (baseUrl, path, payload, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}${path}`, {
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
        ? "Request timed out."
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

const runScanPipeline = async ({ inputType, content, source }) => {
  if (!VALID_INPUT_TYPES.has(inputType)) {
    throw new Error("Unsupported inputType. Expected text, url, or image.");
  }

  const normalizedContent = readPayloadText(content);
  if (!normalizedContent) {
    throw new Error("Scan content is empty.");
  }

  const baseUrl = await resolveBackendBaseUrl();
  const startedAt = Date.now();

  const ingestResult = await callJsonEndpoint(baseUrl, "/api/ingest", {
    inputType,
    content: normalizedContent
  });

  let verifyResult = {
    ok: false,
    status: 0,
    ms: 0,
    data: null,
    error: "Verify was skipped because ingest failed."
  };
  let protectResult = {
    ok: false,
    status: 0,
    ms: 0,
    data: null,
    error: "Protect was skipped because ingest failed."
  };

  if (ingestResult.ok) {
    const analysisPayload = buildAnalysisPayload(inputType, normalizedContent, ingestResult.data);

    // Verify and Protect are independent after ingest and can run in parallel.
    const [verifyResponse, protectResponse] = await Promise.all([
      callJsonEndpoint(baseUrl, "/api/verify", analysisPayload),
      callJsonEndpoint(baseUrl, "/api/protect", analysisPayload)
    ]);

    verifyResult = verifyResponse;
    protectResult = protectResponse;
  }

  const finishedAt = Date.now();
  return {
    backendBaseUrl: baseUrl,
    input: {
      inputType,
      source,
      contentPreview: normalizedContent.slice(0, 280)
    },
    ingest: ingestResult,
    verify: verifyResult,
    protect: protectResult,
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
