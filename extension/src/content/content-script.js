(() => {
  const ROOT_ID = "zeda-sidebar-root";
  const UI_VERSION = "0.7.6";
  const TOGGLE_EVENT = "zeda:toggle-sidebar";
  const STATE_OPEN_CLASS = "zeda-sidebar--open";
  const SHADOW_STYLE_FILE = "src/content/sidebar.css";
  const LOGO_IMAGE_FILE = "resources/zeda_logo.png";
  const RUN_SCAN_ACTION = "zeda:run-scan";
  const CAPTURE_VISIBLE_TAB_ACTION = "zeda:capture-visible-tab";
  const EDGE_TRIGGER_PX = 16;
  const EDGE_TRIGGER_VERTICAL_PADDING_PX = 20;
  const EDGE_TRIGGER_COOLDOWN_MS = 500;
  const ANALYSIS_STEP_INTERVAL_MS = 900;
  const MIN_CAPTURE_SELECTION_PX = 12;
  const CAPTURE_PANEL_HIDE_DELAY_MS = 280;

  const existingHost = document.getElementById(ROOT_ID);
  if (existingHost) {
    const existingVersion = existingHost.getAttribute("data-zeda-ui-version");
    if (existingVersion === UI_VERSION) {
      // Same bundle: toggle instead of recreating DOM.
      window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
      return;
    }

    // Different bundle: replace stale DOM so users see the latest UI instantly.
    existingHost.remove();
  }

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.setAttribute("data-zeda-ui-version", UI_VERSION);
  document.documentElement.appendChild(host);
  const shadowRoot = host.attachShadow({ mode: "open" });

  const createElement = (tagName, className, text) => {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (typeof text === "string") {
      element.textContent = text;
    }
    return element;
  };

  const setOpenState = (isOpen) => {
    host.classList.toggle(STATE_OPEN_CLASS, isOpen);
  };

  const toggleOpen = () => {
    setOpenState(!host.classList.contains(STATE_OPEN_CLASS));
  };

  const loadSidebarStyles = async () => {
    const styleElement = document.createElement("style");
    const styleUrl = chrome.runtime.getURL(SHADOW_STYLE_FILE);

    try {
      const response = await fetch(styleUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch sidebar stylesheet: ${response.status}`);
      }
      styleElement.textContent = await response.text();
    } catch (error) {
      console.warn("[Zeda Extension] Failed to load stylesheet. Using fallback styles.", error);
      styleElement.textContent = `
        :host { position: fixed; top: 0; right: 0; height: 100vh; width: 360px; z-index: 2147483646; }
        .zeda-sidebar__panel { height: 100%; background: #0f172a; color: #e2e8f0; transform: translateX(100%); transition: transform 220ms ease; border-left: 1px solid #334155; }
        :host(.zeda-sidebar--open) .zeda-sidebar__panel { transform: translateX(0); }
      `;
    }

    shadowRoot.appendChild(styleElement);
  };

  const readNumericScore = (data) => {
    const candidates = [data?.veracityIndex, data?.score, data?.riskScore];
    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, Math.min(100, Math.round(value)));
      }
    }
    return null;
  };

  const formatSeconds = (ms) => {
    const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    const seconds = safeMs / 1000;
    if (safeMs > 0 && seconds < 0.1) {
      // Avoid misleading "0.0s" for very fast phases.
      return "0.1s";
    }
    if (seconds >= 10) {
      return `${Math.round(seconds)}s`;
    }
    return `${seconds.toFixed(1)}s`;
  };

  const sanitizeDisplayText = (value, maxLength = 180) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) {
      return "";
    }

    // Never render raw base64/data-url payloads in the sidebar.
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed) || trimmed.includes("base64,")) {
      return "Uploaded image content could not be summarized from model output.";
    }

    if (trimmed.length <= maxLength) {
      return trimmed;
    }

    return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
  };

  const extractReasons = (data) => {
    const candidates = [];
    if (Array.isArray(data?.keyFindings)) {
      candidates.push(...data.keyFindings);
    }
    if (Array.isArray(data?.fakeParts)) {
      candidates.push(...data.fakeParts);
    }
    if (Array.isArray(data?.reasons)) {
      candidates.push(...data.reasons);
    }

    const normalized = candidates
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .map((item) => sanitizeDisplayText(item))
      .filter((item) => item.length > 0);

    return [...new Set(normalized)].slice(0, 3);
  };

  const buildTimingRows = (pipelineData) => {
    const stepMs = pipelineData?.timings?.stepsMs;
    const ingestMs = Number.isFinite(pipelineData?.ingest?.ms) ? Math.max(0, pipelineData.ingest.ms) : 0;
    const analysisMs = Number.isFinite(pipelineData?.analysis?.ms) ? Math.max(0, pipelineData.analysis.ms) : 0;
    const totalMs = Number.isFinite(pipelineData?.timings?.totalMs)
      ? Math.max(0, pipelineData.timings.totalMs)
      : ingestMs + analysisMs;

    // Backward-compatible fallback for older worker payloads that do not include timings.stepsMs.
    const extractingMs = Number.isFinite(stepMs?.extractingContent)
      ? Math.max(0, stepMs.extractingContent)
      : ingestMs;
    const analyzingMs = Number.isFinite(stepMs?.analyzingClaimsOrRisk)
      ? Math.max(0, stepMs.analyzingClaimsOrRisk)
      : analysisMs;
    const scoringMs = Number.isFinite(stepMs?.scoringAndReport)
      ? Math.max(0, stepMs.scoringAndReport)
      : Math.max(0, totalMs - extractingMs - analyzingMs);

    return [
      { label: "Extracting content...", seconds: formatSeconds(extractingMs) },
      {
        label: pipelineData?.mode === "protect" ? "Scanning privacy/scam risk..." : "Verifying claims...",
        seconds: formatSeconds(analyzingMs)
      },
      { label: "Scoring & generating report...", seconds: formatSeconds(scoringMs) }
    ];
  };

  const renderTimingSummary = (container, pipelineData) => {
    const timingRows = buildTimingRows(pipelineData);
    const timingList = createElement("ul", "zeda-sidebar__timing-list");
    timingRows.forEach((row) => {
      const item = createElement("li", "zeda-sidebar__timing-item");
      const label = createElement("span", "zeda-sidebar__timing-label", row.label);
      const value = createElement("span", "zeda-sidebar__timing-value", row.seconds);
      item.appendChild(label);
      item.appendChild(value);
      timingList.appendChild(item);
    });
    container.appendChild(timingList);
  };

  const ensurePipelineTimings = (pipelineData, fallbackTotalMs) => {
    if (!pipelineData || typeof pipelineData !== "object") {
      return pipelineData;
    }

    const ingestMs = Number.isFinite(pipelineData?.ingest?.ms) ? Math.max(0, pipelineData.ingest.ms) : 0;
    const analysisMs = Number.isFinite(pipelineData?.analysis?.ms) ? Math.max(0, pipelineData.analysis.ms) : 0;
    const explicitTotalMs = Number.isFinite(pipelineData?.timings?.totalMs)
      ? Math.max(0, pipelineData.timings.totalMs)
      : null;
    const totalMs = explicitTotalMs ?? Math.max(0, fallbackTotalMs, ingestMs + analysisMs);

    if (!pipelineData.timings || typeof pipelineData.timings !== "object") {
      pipelineData.timings = {};
    }

    if (!pipelineData.timings.stepsMs || typeof pipelineData.timings.stepsMs !== "object") {
      pipelineData.timings.stepsMs = {};
    }

    if (!Number.isFinite(pipelineData.timings.stepsMs.extractingContent)) {
      pipelineData.timings.stepsMs.extractingContent = ingestMs;
    }
    if (!Number.isFinite(pipelineData.timings.stepsMs.analyzingClaimsOrRisk)) {
      pipelineData.timings.stepsMs.analyzingClaimsOrRisk = analysisMs;
    }
    if (!Number.isFinite(pipelineData.timings.stepsMs.scoringAndReport)) {
      const extractingMs = Math.max(0, pipelineData.timings.stepsMs.extractingContent || 0);
      const analyzingMs = Math.max(0, pipelineData.timings.stepsMs.analyzingClaimsOrRisk || 0);
      pipelineData.timings.stepsMs.scoringAndReport = Math.max(0, totalMs - extractingMs - analyzingMs);
    }

    if (!Number.isFinite(pipelineData.timings.totalMs)) {
      pipelineData.timings.totalMs =
        pipelineData.timings.stepsMs.extractingContent +
        pipelineData.timings.stepsMs.analyzingClaimsOrRisk +
        pipelineData.timings.stepsMs.scoringAndReport;
    }

    return pipelineData;
  };

  const toDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.readAsDataURL(file);
    });

  const normalizeUrlInput = (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    try {
      return new URL(trimmed).toString();
    } catch {
      try {
        return new URL(`https://${trimmed}`).toString();
      } catch {
        return "";
      }
    }
  };

  const requestVisibleTabCapture = async () => {
    const response = await chrome.runtime.sendMessage({
      action: CAPTURE_VISIBLE_TAB_ACTION
    });

    if (!response?.ok || !response?.data?.dataUrl) {
      throw new Error(
        typeof response?.error === "string" ? response.error : "Unable to capture the current tab screenshot."
      );
    }

    return response.data.dataUrl;
  };

  const loadImageElement = (dataUrl) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to decode captured screenshot."));
      image.src = dataUrl;
    });

  const cropDataUrlByViewportRect = async (dataUrl, rect) => {
    const image = await loadImageElement(dataUrl);

    const scaleX = image.naturalWidth / Math.max(1, window.innerWidth);
    const scaleY = image.naturalHeight / Math.max(1, window.innerHeight);
    const sx = Math.max(0, Math.floor(rect.x * scaleX));
    const sy = Math.max(0, Math.floor(rect.y * scaleY));
    const sw = Math.max(1, Math.floor(rect.width * scaleX));
    const sh = Math.max(1, Math.floor(rect.height * scaleY));

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to initialize screenshot crop canvas.");
    }

    context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL("image/png");
  };

  const pickSelectionRectFromOverlay = () =>
    new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      overlay.setAttribute("aria-label", "Zeda screenshot selection overlay");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        cursor: "crosshair",
        background: "rgba(8, 6, 4, 0.28)"
      });

      const selection = document.createElement("div");
      Object.assign(selection.style, {
        position: "absolute",
        border: "2px solid rgba(255, 201, 88, 0.95)",
        boxShadow: "0 0 0 99999px rgba(8, 6, 4, 0.45)",
        borderRadius: "6px",
        pointerEvents: "none",
        display: "none"
      });
      overlay.appendChild(selection);

      let startX = 0;
      let startY = 0;
      let dragging = false;

      const cleanup = () => {
        window.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
      };

      const buildRect = (x, y) => {
        const left = Math.min(startX, x);
        const top = Math.min(startY, y);
        const width = Math.abs(x - startX);
        const height = Math.abs(y - startY);
        return { x: left, y: top, width, height };
      };

      const renderRect = ({ x, y, width, height }) => {
        selection.style.display = "block";
        selection.style.left = `${x}px`;
        selection.style.top = `${y}px`;
        selection.style.width = `${width}px`;
        selection.style.height = `${height}px`;
      };

      const onKeyDown = (event) => {
        if (event.key !== "Escape") {
          return;
        }
        cleanup();
        reject(new Error("Capture area selection canceled."));
      };

      overlay.addEventListener("mousedown", (event) => {
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        renderRect({ x: startX, y: startY, width: 0, height: 0 });
        event.preventDefault();
      });

      overlay.addEventListener("mousemove", (event) => {
        if (!dragging) {
          return;
        }
        renderRect(buildRect(event.clientX, event.clientY));
      });

      overlay.addEventListener("mouseup", (event) => {
        if (!dragging) {
          return;
        }

        dragging = false;
        const rect = buildRect(event.clientX, event.clientY);
        cleanup();

        if (rect.width < MIN_CAPTURE_SELECTION_PX || rect.height < MIN_CAPTURE_SELECTION_PX) {
          reject(new Error("Selected area is too small. Drag a larger area."));
          return;
        }

        resolve(rect);
      });

      window.addEventListener("keydown", onKeyDown, true);
      document.documentElement.appendChild(overlay);
    });

  const mountSidebar = async () => {
    await loadSidebarStyles();

    const panel = createElement("aside", "zeda-sidebar__panel");
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "Zeda Sidebar");

    const header = createElement("header", "zeda-sidebar__header");
    const brand = createElement("div", "zeda-sidebar__brand");
    const logoBadge = createElement("div", "zeda-sidebar__logo-badge");
    const logoImage = createElement("img", "zeda-sidebar__logo-image");
    logoImage.src = chrome.runtime.getURL(LOGO_IMAGE_FILE);
    logoImage.alt = "Zeda";
    const subtitle = createElement("p", "zeda-sidebar__subtitle", "Verify · Protect");
    const closeButton = createElement("button", "zeda-sidebar__close", "Close");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close Zeda sidebar");
    logoBadge.appendChild(logoImage);
    brand.appendChild(logoBadge);
    brand.appendChild(subtitle);
    header.appendChild(brand);
    header.appendChild(closeButton);

    const body = createElement("div", "zeda-sidebar__body");

    const modeSection = createElement("section", "zeda-sidebar__section");
    const modeTitle = createElement("h3", "zeda-sidebar__section-title", "Choose Mode");
    const modeGrid = createElement("div", "zeda-sidebar__mode-grid");

    const verifyModeButton = createElement("button", "zeda-sidebar__mode-card");
    verifyModeButton.type = "button";
    verifyModeButton.setAttribute("aria-pressed", "false");
    verifyModeButton.appendChild(createElement("p", "zeda-sidebar__mode-label", "Verify"));
    verifyModeButton.appendChild(
      createElement("p", "zeda-sidebar__mode-copy", "Check whether a claim is supported by evidence.")
    );

    const protectModeButton = createElement("button", "zeda-sidebar__mode-card");
    protectModeButton.type = "button";
    protectModeButton.setAttribute("aria-pressed", "false");
    protectModeButton.appendChild(createElement("p", "zeda-sidebar__mode-label", "Protect"));
    protectModeButton.appendChild(
      createElement("p", "zeda-sidebar__mode-copy", "Detect scam or privacy risk patterns in content.")
    );

    modeGrid.appendChild(verifyModeButton);
    modeGrid.appendChild(protectModeButton);
    modeSection.appendChild(modeTitle);
    modeSection.appendChild(modeGrid);

    const inputSection = createElement("section", "zeda-sidebar__section");
    const inputHeader = createElement("div", "zeda-sidebar__section-heading");
    const inputTitle = createElement("h3", "zeda-sidebar__section-title", "Upload Data");
    const captureMenuWrap = createElement("div", "zeda-sidebar__capture-menu-wrap");
    const captureMenuButton = createElement("button", "zeda-sidebar__capture-trigger", "📋");
    captureMenuButton.type = "button";
    captureMenuButton.setAttribute("aria-label", "Screenshot options");
    captureMenuButton.setAttribute("aria-expanded", "false");
    const captureMenu = createElement("div", "zeda-sidebar__capture-menu");
    captureMenu.hidden = true;
    const captureFullMenuButton = createElement("button", "zeda-sidebar__capture-option", "Entire screen");
    captureFullMenuButton.type = "button";
    const captureAreaMenuButton = createElement("button", "zeda-sidebar__capture-option", "Portion of screen");
    captureAreaMenuButton.type = "button";
    captureMenu.appendChild(captureFullMenuButton);
    captureMenu.appendChild(captureAreaMenuButton);
    captureMenuWrap.appendChild(captureMenuButton);
    captureMenuWrap.appendChild(captureMenu);
    inputHeader.appendChild(inputTitle);
    inputHeader.appendChild(captureMenuWrap);

    const inputTabs = createElement("div", "zeda-sidebar__tabs");
    const imageTabButton = createElement("button", "zeda-sidebar__tab-btn", "Image");
    const urlTabButton = createElement("button", "zeda-sidebar__tab-btn", "URL");
    const textTabButton = createElement("button", "zeda-sidebar__tab-btn", "Text");
    imageTabButton.type = "button";
    urlTabButton.type = "button";
    textTabButton.type = "button";
    inputTabs.appendChild(imageTabButton);
    inputTabs.appendChild(urlTabButton);
    inputTabs.appendChild(textTabButton);

    const imagePanel = createElement("div", "zeda-sidebar__input-panel");
    const imageUploadLabel = createElement("label", "zeda-sidebar__upload-zone");
    const imageUploadTitle = createElement("p", "zeda-sidebar__upload-title", "Drop image or click to upload");
    const imageUploadHint = createElement("p", "zeda-sidebar__upload-hint", "PNG, JPG, WEBP");
    const imagePreview = createElement("img", "zeda-sidebar__upload-preview");
    imagePreview.alt = "Selected screenshot preview";
    imagePreview.hidden = true;
    const imageFileInput = createElement("input");
    imageFileInput.type = "file";
    imageFileInput.accept = "image/*";
    imageFileInput.className = "zeda-sidebar__upload-input";
    imageUploadLabel.appendChild(imageUploadTitle);
    imageUploadLabel.appendChild(imageUploadHint);
    imageUploadLabel.appendChild(imagePreview);
    imageUploadLabel.appendChild(imageFileInput);
    imagePanel.appendChild(imageUploadLabel);

    const urlPanel = createElement("div", "zeda-sidebar__input-panel");
    const urlInput = createElement("input", "zeda-sidebar__text-input");
    urlInput.type = "url";
    urlInput.placeholder = "https://example.com/article";
    urlPanel.appendChild(urlInput);

    const textPanel = createElement("div", "zeda-sidebar__input-panel");
    const textInput = createElement("textarea", "zeda-sidebar__textarea");
    textInput.placeholder = "Paste message, claim, or email content here...";
    textPanel.appendChild(textInput);

    const scanButton = createElement("button", "zeda-sidebar__button zeda-sidebar__button--primary", "Analyze");
    scanButton.type = "button";

    inputSection.appendChild(inputHeader);
    inputSection.appendChild(inputTabs);
    inputSection.appendChild(imagePanel);
    inputSection.appendChild(urlPanel);
    inputSection.appendChild(textPanel);
    inputSection.appendChild(scanButton);

    const resultSection = createElement("section", "zeda-sidebar__section");
    const resultTitle = createElement("h3", "zeda-sidebar__section-title", "Result");
    const status = createElement("p", "zeda-sidebar__status", "Select mode, add input, then scan.");
    const resultBox = createElement("div", "zeda-sidebar__result-box");
    resultSection.appendChild(resultTitle);
    resultSection.appendChild(status);
    resultSection.appendChild(resultBox);

    const footer = createElement("footer", "zeda-sidebar__footer", "Move cursor to right edge to open");

    body.appendChild(modeSection);
    body.appendChild(inputSection);
    body.appendChild(resultSection);
    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    shadowRoot.appendChild(panel);

    let selectedMode = null;
    let activeInputType = "text";
    let imageDataUrl = "";
    let isRunning = false;
    let isSelectingArea = false;
    let isCaptureFlowActive = false;
    let isCaptureMenuOpen = false;
    let lastEdgeTriggerAt = 0;
    let progressIntervalId = null;

    const setStatus = (message, tone = "neutral") => {
      status.textContent = message;
      status.className = "zeda-sidebar__status";
      if (tone === "warning") {
        status.classList.add("zeda-sidebar__status--warning");
      } else if (tone === "success") {
        status.classList.add("zeda-sidebar__status--success");
      }
    };

    const setMode = (mode) => {
      selectedMode = mode;
      verifyModeButton.classList.toggle("zeda-sidebar__mode-card--active", mode === "verify");
      protectModeButton.classList.toggle("zeda-sidebar__mode-card--active", mode === "protect");
      verifyModeButton.setAttribute("aria-pressed", String(mode === "verify"));
      protectModeButton.setAttribute("aria-pressed", String(mode === "protect"));
      setStatus(`Mode selected: ${mode}.`);
      updateScanState();
    };

    const setRunning = (running) => {
      isRunning = running;
      verifyModeButton.disabled = running;
      protectModeButton.disabled = running;
      imageTabButton.disabled = running;
      urlTabButton.disabled = running;
      textTabButton.disabled = running;
      imageFileInput.disabled = running;
      captureMenuButton.disabled = running;
      captureFullMenuButton.disabled = running;
      captureAreaMenuButton.disabled = running;
      urlInput.disabled = running;
      textInput.disabled = running;
      scanButton.disabled = running;
      scanButton.textContent = running ? "Analyzing..." : "Analyze";
    };

    const closeCaptureMenu = () => {
      isCaptureMenuOpen = false;
      captureMenu.hidden = true;
      captureMenuButton.classList.remove("zeda-sidebar__capture-trigger--open");
      captureMenuButton.setAttribute("aria-expanded", "false");
    };

    const openCaptureMenu = () => {
      isCaptureMenuOpen = true;
      captureMenu.hidden = false;
      captureMenuButton.classList.add("zeda-sidebar__capture-trigger--open");
      captureMenuButton.setAttribute("aria-expanded", "true");
    };

    const toggleCaptureMenu = () => {
      if (isCaptureMenuOpen) {
        closeCaptureMenu();
        return;
      }
      openCaptureMenu();
    };

    const applyImageDataUrl = ({ dataUrl, titleText, hintText }) => {
      imageDataUrl = dataUrl;
      imagePreview.src = dataUrl;
      imagePreview.hidden = false;
      imageUploadTitle.textContent = titleText;
      imageUploadHint.textContent = hintText;
      setInputTab("image");
      updateScanState();
    };

    const clearAnalysisProgress = () => {
      if (progressIntervalId !== null) {
        window.clearInterval(progressIntervalId);
        progressIntervalId = null;
      }
    };

    const setProgressState = (stepNodes, activeIndex) => {
      stepNodes.forEach((node, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
        node.setAttribute("data-state", state);
      });
    };

    const startAnalysisProgress = () => {
      resultBox.innerHTML = "";
      clearAnalysisProgress();

      const labels = [
        "Extracting content...",
        selectedMode === "verify" ? "Verifying claims..." : "Scanning privacy/scam risk...",
        "Scoring & generating report..."
      ];

      const progress = createElement("div", "zeda-sidebar__analysis-progress");
      const stepNodes = labels.map((label) => {
        const row = createElement("div", "zeda-sidebar__analysis-step");
        const dot = createElement("span", "zeda-sidebar__analysis-dot");
        const text = createElement("span", "zeda-sidebar__analysis-text", label);
        row.appendChild(dot);
        row.appendChild(text);
        progress.appendChild(row);
        return row;
      });

      resultBox.appendChild(progress);
      setProgressState(stepNodes, 0);

      let activeStep = 0;
      progressIntervalId = window.setInterval(() => {
        activeStep = Math.min(activeStep + 1, stepNodes.length - 1);
        setProgressState(stepNodes, activeStep);
      }, ANALYSIS_STEP_INTERVAL_MS);

      // Keep the active generation state visible, like the main Zeda results flow.
      resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const renderError = (message, clearFirst = true) => {
      if (clearFirst) {
        resultBox.innerHTML = "";
      }
      resultBox.appendChild(createElement("p", "zeda-sidebar__result-error", message));
    };

    const renderResult = (pipelineData) => {
      clearAnalysisProgress();
      const analysis = pipelineData?.analysis;
      resultBox.innerHTML = "";
      renderTimingSummary(resultBox, pipelineData);

      if (!analysis?.ok || !analysis?.data) {
        renderError(analysis?.error || "No result returned from backend.", false);
        return false;
      }

      const data = analysis.data;
      const verdict = typeof data?.verdict === "string" && data.verdict.trim() ? data.verdict.trim() : "Unknown";
      const score = readNumericScore(data);

      const headline = createElement(
        "p",
        "zeda-sidebar__result-headline",
        score === null ? verdict : `${verdict} - ${score}/100`
      );
      resultBox.appendChild(headline);

      const reasons = extractReasons(data);
      if (reasons.length > 0) {
        const list = createElement("ul", "zeda-sidebar__result-list");
        reasons.forEach((reason) => {
          list.appendChild(createElement("li", "zeda-sidebar__result-item", reason));
        });
        resultBox.appendChild(list);
        return true;
      }

      const fallbackSummary =
        typeof data?.summary === "string" && data.summary.trim() ? data.summary.trim() : "No details returned.";
      resultBox.appendChild(createElement("p", "zeda-sidebar__result-summary", sanitizeDisplayText(fallbackSummary, 240)));
      return true;
    };

    const setInputTab = (inputType) => {
      activeInputType = inputType;

      imageTabButton.classList.toggle("zeda-sidebar__tab-btn--active", inputType === "image");
      urlTabButton.classList.toggle("zeda-sidebar__tab-btn--active", inputType === "url");
      textTabButton.classList.toggle("zeda-sidebar__tab-btn--active", inputType === "text");

      imagePanel.hidden = inputType !== "image";
      urlPanel.hidden = inputType !== "url";
      textPanel.hidden = inputType !== "text";
      updateScanState();
    };

    const resolvePayload = () => {
      if (activeInputType === "image") {
        return imageDataUrl
          ? {
              inputType: "image",
              content: imageDataUrl
            }
          : null;
      }

      if (activeInputType === "url") {
        const normalizedUrl = normalizeUrlInput(urlInput.value);
        return normalizedUrl
          ? {
              inputType: "url",
              content: normalizedUrl
            }
          : null;
      }

      const content = textInput.value.trim();
      return content
        ? {
            inputType: "text",
            content
          }
        : null;
    };

    const updateScanState = () => {
      if (isRunning) {
        return;
      }
      const payload = resolvePayload();
      scanButton.disabled = !selectedMode || !payload;
    };

    const runScan = async (sourceOverride) => {
      if (isRunning) {
        return;
      }

      if (!selectedMode) {
        setStatus("Choose Protect or Verify first.", "warning");
        return;
      }

      const payload = resolvePayload();
      if (!payload) {
        setStatus("Add valid input before analyzing.", "warning");
        return;
      }

      setOpenState(true);
      setRunning(true);
      setStatus("Analyzing...", "success");
      startAnalysisProgress();

      try {
        const startedAtMs = performance.now();
        // Keep backend calls in service worker to avoid exposing API details in page context.
        const response = await chrome.runtime.sendMessage({
          action: RUN_SCAN_ACTION,
          payload: {
            mode: selectedMode,
            inputType: payload.inputType,
            content: payload.content,
            source: sourceOverride || `${activeInputType} input`
          }
        });
        const totalRoundTripMs = performance.now() - startedAtMs;

        if (!response?.ok || !response?.data) {
          clearAnalysisProgress();
          renderError(typeof response?.error === "string" ? response.error : "Scan failed.");
          setStatus("Analysis failed. Review the error below.", "warning");
          return;
        }

        const pipelineData = ensurePipelineTimings(response.data, totalRoundTripMs);
        const success = renderResult(pipelineData);
        if (success) {
          setStatus("Scan complete.", "success");
        } else {
          setStatus("Analysis failed. Review the error below.", "warning");
        }
      } catch (error) {
        clearAnalysisProgress();
        renderError(error instanceof Error ? error.message : "Unexpected scan error.");
        setStatus("Analysis failed. Review the error below.", "warning");
      } finally {
        setRunning(false);
        updateScanState();
      }
    };

    verifyModeButton.addEventListener("click", () => setMode("verify"));
    protectModeButton.addEventListener("click", () => setMode("protect"));

    imageTabButton.addEventListener("click", () => setInputTab("image"));
    urlTabButton.addEventListener("click", () => setInputTab("url"));
    textTabButton.addEventListener("click", () => setInputTab("text"));

    textInput.addEventListener("input", updateScanState);
    urlInput.addEventListener("input", updateScanState);

    const captureFullViewAndAnalyze = async () => {
      if (isRunning) {
        return;
      }
      if (!selectedMode) {
        setStatus("Choose Protect or Verify before capture.", "warning");
        return;
      }

      try {
        setStatus("Capturing full view...", "success");
        closeCaptureMenu();
        isCaptureFlowActive = true;
        setOpenState(false);
        await new Promise((resolve) => window.setTimeout(resolve, CAPTURE_PANEL_HIDE_DELAY_MS));

        const fullViewDataUrl = await requestVisibleTabCapture();
        setOpenState(true);
        applyImageDataUrl({
          dataUrl: fullViewDataUrl,
          titleText: "Screenshot captured",
          hintText: "Full visible page view"
        });
        setStatus("Full view captured. Analyzing...", "success");
        await runScan("captured full view");
      } catch (error) {
        setOpenState(true);
        setStatus(error instanceof Error ? error.message : "Failed to capture full view screenshot.", "warning");
      } finally {
        isCaptureFlowActive = false;
      }
    };

    const captureAreaAndAnalyze = async () => {
      if (isRunning) {
        return;
      }
      if (!selectedMode) {
        setStatus("Choose Protect or Verify before capture.", "warning");
        return;
      }

      try {
        setStatus("Select area to capture. Press ESC to cancel.", "success");
        closeCaptureMenu();
        isCaptureFlowActive = true;
        setOpenState(false);
        isSelectingArea = true;

        // Let the panel slide away before drawing the selection overlay.
        await new Promise((resolve) => window.setTimeout(resolve, CAPTURE_PANEL_HIDE_DELAY_MS));

        const fullViewDataUrl = await requestVisibleTabCapture();
        const selectionRect = await pickSelectionRectFromOverlay();
        const croppedDataUrl = await cropDataUrlByViewportRect(fullViewDataUrl, selectionRect);

        setOpenState(true);
        applyImageDataUrl({
          dataUrl: croppedDataUrl,
          titleText: "Area captured",
          hintText: `${Math.round(selectionRect.width)} x ${Math.round(selectionRect.height)} selection`
        });
        setStatus("Area captured. Analyzing...", "success");
        await runScan("captured area");
      } catch (error) {
        setOpenState(true);
        setStatus(error instanceof Error ? error.message : "Failed to capture selected area.", "warning");
      } finally {
        isSelectingArea = false;
        isCaptureFlowActive = false;
      }
    };

    const handleClipboardPaste = async (event) => {
      if (isRunning || activeInputType !== "image") {
        return;
      }

      const clipboard = event.clipboardData;
      if (!clipboard?.items?.length) {
        return;
      }

      const imageItem = [...clipboard.items].find((item) => item.type.startsWith("image/"));
      if (!imageItem) {
        return;
      }

      const imageFile = imageItem.getAsFile();
      if (!imageFile) {
        return;
      }

      event.preventDefault();
      try {
        const pastedDataUrl = await toDataUrl(imageFile);
        applyImageDataUrl({
          dataUrl: pastedDataUrl,
          titleText: "Clipboard image ready",
          hintText: imageFile.name || "Pasted screenshot"
        });

        if (selectedMode) {
          setStatus("Clipboard image captured. Analyzing...", "success");
          await runScan("clipboard screenshot");
        } else {
          setStatus("Clipboard image loaded. Choose mode then Analyze.");
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to read clipboard image.", "warning");
      }
    };

    imageFileInput.addEventListener("change", async (event) => {
      const file = event.target?.files?.[0];
      if (!file) {
        return;
      }

      try {
        const fileDataUrl = await toDataUrl(file);
        applyImageDataUrl({
          dataUrl: fileDataUrl,
          titleText: "Image ready for analysis",
          hintText: file.name
        });
        setStatus("Image loaded.");
      } catch (error) {
        imageDataUrl = "";
        imagePreview.hidden = true;
        setStatus(error instanceof Error ? error.message : "Failed to load image.", "warning");
      } finally {
        updateScanState();
      }
    });

    captureMenuButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCaptureMenu();
    });
    captureFullMenuButton.addEventListener("click", captureFullViewAndAnalyze);
    captureAreaMenuButton.addEventListener("click", captureAreaAndAnalyze);
    scanButton.addEventListener("click", () => runScan());
    window.addEventListener("paste", handleClipboardPaste, true);

    closeButton.addEventListener("click", () => {
      closeCaptureMenu();
      setOpenState(false);
    });

    const handleEdgeHoverOpen = (event) => {
      if (isSelectingArea || isCaptureFlowActive) {
        return;
      }
      if (host.classList.contains(STATE_OPEN_CLASS)) {
        return;
      }

      const inVerticalRange =
        event.clientY >= EDGE_TRIGGER_VERTICAL_PADDING_PX &&
        event.clientY <= window.innerHeight - EDGE_TRIGGER_VERTICAL_PADDING_PX;
      const inRightEdgeZone = event.clientX >= window.innerWidth - EDGE_TRIGGER_PX;
      if (!inVerticalRange || !inRightEdgeZone) {
        return;
      }

      const now = Date.now();
      if (now - lastEdgeTriggerAt < EDGE_TRIGGER_COOLDOWN_MS) {
        return;
      }

      lastEdgeTriggerAt = now;
      setOpenState(true);
    };

    const handleGlobalClickClose = (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      const clickedCaptureControl = path.includes(captureMenuWrap) || path.includes(captureMenuButton) || path.includes(captureMenu);
      if (isCaptureMenuOpen && !clickedCaptureControl) {
        closeCaptureMenu();
      }

      if (!host.classList.contains(STATE_OPEN_CLASS)) {
        return;
      }

      const clickedInsideSidebar = path.includes(host) || path.includes(panel);
      if (!clickedInsideSidebar) {
        closeCaptureMenu();
        setOpenState(false);
      }
    };

    window.addEventListener(TOGGLE_EVENT, toggleOpen);
    window.addEventListener("mousemove", handleEdgeHoverOpen, { passive: true });
    window.addEventListener("mousedown", handleGlobalClickClose, true);

    setInputTab("text");
    setStatus("Choose Protect or Verify first.");
    updateScanState();
    setOpenState(false);
  };

  mountSidebar().catch((error) => {
    console.error("[Zeda Extension] Failed to mount sidebar:", error);
  });
})();
