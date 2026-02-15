(() => {
  const ROOT_ID = "zeda-sidebar-root";
  const UI_VERSION = "0.6.3";
  const TOGGLE_EVENT = "zeda:toggle-sidebar";
  const STATE_OPEN_CLASS = "zeda-sidebar--open";
  const SHADOW_STYLE_FILE = "src/content/sidebar.css";
  const RUN_SCAN_ACTION = "zeda:run-scan";
  const EDGE_TRIGGER_PX = 16;
  const EDGE_TRIGGER_VERTICAL_PADDING_PX = 20;
  const EDGE_TRIGGER_COOLDOWN_MS = 500;
  const ANALYSIS_STEP_INTERVAL_MS = 900;

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

  const mountSidebar = async () => {
    await loadSidebarStyles();

    const panel = createElement("aside", "zeda-sidebar__panel");
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "Zeda Sidebar");

    const header = createElement("header", "zeda-sidebar__header");
    const brand = createElement("div", "zeda-sidebar__brand");
    const logoBadge = createElement("div", "zeda-sidebar__logo-badge", "Z");
    const titleWrap = createElement("div", "zeda-sidebar__title-wrap");
    const title = createElement("h2", "zeda-sidebar__title", "Zeda");
    const subtitle = createElement("p", "zeda-sidebar__subtitle", "Verify · Protect");
    const closeButton = createElement("button", "zeda-sidebar__close", "Close");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close Zeda sidebar");
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    brand.appendChild(logoBadge);
    brand.appendChild(titleWrap);
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
    const inputTitle = createElement("h3", "zeda-sidebar__section-title", "Upload Data");

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

    inputSection.appendChild(inputTitle);
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
      urlInput.disabled = running;
      textInput.disabled = running;
      scanButton.disabled = running;
      scanButton.textContent = running ? "Analyzing..." : "Analyze";
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

    const renderError = (message) => {
      resultBox.innerHTML = "";
      resultBox.appendChild(createElement("p", "zeda-sidebar__result-error", message));
    };

    const renderResult = (pipelineData) => {
      clearAnalysisProgress();
      const analysis = pipelineData?.analysis;

      if (!analysis?.ok || !analysis?.data) {
        renderError(analysis?.error || "No result returned from backend.");
        return false;
      }

      resultBox.innerHTML = "";
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
        return;
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

    const runScan = async () => {
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
        // Keep backend calls in service worker to avoid exposing API details in page context.
        const response = await chrome.runtime.sendMessage({
          action: RUN_SCAN_ACTION,
          payload: {
            mode: selectedMode,
            inputType: payload.inputType,
            content: payload.content,
            source: `${activeInputType} input`
          }
        });

        if (!response?.ok || !response?.data) {
          clearAnalysisProgress();
          renderError(typeof response?.error === "string" ? response.error : "Scan failed.");
          setStatus("Analysis failed. Review the error below.", "warning");
          return;
        }

        const success = renderResult(response.data);
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

    imageFileInput.addEventListener("change", async (event) => {
      const file = event.target?.files?.[0];
      if (!file) {
        return;
      }

      try {
        imageDataUrl = await toDataUrl(file);
        imagePreview.src = imageDataUrl;
        imagePreview.hidden = false;
        imageUploadTitle.textContent = "Image ready for analysis";
        imageUploadHint.textContent = file.name;
        setStatus("Image loaded.");
      } catch (error) {
        imageDataUrl = "";
        imagePreview.hidden = true;
        setStatus(error instanceof Error ? error.message : "Failed to load image.", "warning");
      } finally {
        updateScanState();
      }
    });

    scanButton.addEventListener("click", runScan);

    closeButton.addEventListener("click", () => {
      setOpenState(false);
    });

    const handleEdgeHoverOpen = (event) => {
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
      if (!host.classList.contains(STATE_OPEN_CLASS)) {
        return;
      }

      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      const clickedInside = path.includes(host) || path.includes(panel);
      if (!clickedInside) {
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
