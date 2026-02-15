(() => {
  const ROOT_ID = "zeda-sidebar-root";
  const PANEL_ID = "zeda-sidebar-panel";
  const TOGGLE_EVENT = "zeda:toggle-sidebar";
  const STATE_OPEN_CLASS = "zeda-sidebar--open";
  const DRAFT_STORAGE_KEY = "zedaSidebarDraft";
  const BACKEND_BASE_URL_STORAGE_KEY = "zedaBackendBaseUrl";
  const DEFAULT_BACKEND_BASE_URL = "http://localhost:8000";
  const SHADOW_STYLE_FILE = "src/content/sidebar.css";
  const RUN_SCAN_ACTION = "zeda:run-scan";
  const EDGE_TRIGGER_PX = 16;
  const EDGE_TRIGGER_VERTICAL_PADDING_PX = 20;
  const EDGE_TRIGGER_COOLDOWN_MS = 500;

  const existingHost = document.getElementById(ROOT_ID);
  if (existingHost) {
    // Re-running the script should only toggle visibility, not duplicate DOM nodes.
    window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
    return;
  }

  const host = document.createElement("div");
  host.id = ROOT_ID;
  document.documentElement.appendChild(host);

  // Phase 2+3 isolates extension markup/styles from host-page CSS.
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

  const readSelectionText = () => {
    const selectedText = window.getSelection()?.toString() ?? "";
    return selectedText.trim();
  };

  const truncate = (value, maxLength = 220) =>
    value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;

  const inferInputType = (value) => {
    const trimmed = value.trim();
    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      return "url";
    }
    return "text";
  };

  const saveDraft = async (draft) => {
    if (!chrome.storage?.session) {
      return;
    }

    try {
      await chrome.storage.session.set({ [DRAFT_STORAGE_KEY]: draft });
    } catch (error) {
      console.warn("[Zeda Extension] Unable to persist sidebar draft:", error);
    }
  };

  const loadDraft = async () => {
    if (!chrome.storage?.session) {
      return null;
    }

    try {
      const payload = await chrome.storage.session.get(DRAFT_STORAGE_KEY);
      return payload[DRAFT_STORAGE_KEY] ?? null;
    } catch (error) {
      console.warn("[Zeda Extension] Unable to restore sidebar draft:", error);
      return null;
    }
  };

  const resolveBackendBaseUrl = async () => {
    if (!chrome.storage?.local) {
      return DEFAULT_BACKEND_BASE_URL;
    }

    try {
      const payload = await chrome.storage.local.get(BACKEND_BASE_URL_STORAGE_KEY);
      const value = payload[BACKEND_BASE_URL_STORAGE_KEY];
      if (typeof value !== "string" || value.trim().length === 0) {
        return DEFAULT_BACKEND_BASE_URL;
      }
      return value.trim().replace(/\/+$/, "");
    } catch (error) {
      console.warn("[Zeda Extension] Failed to read backend URL settings:", error);
      return DEFAULT_BACKEND_BASE_URL;
    }
  };

  const saveBackendBaseUrl = async (rawBaseUrl) => {
    if (!chrome.storage?.local) {
      return DEFAULT_BACKEND_BASE_URL;
    }

    const normalized = rawBaseUrl.trim().replace(/\/+$/, "");
    if (!normalized) {
      throw new Error("Backend URL cannot be empty.");
    }

    await chrome.storage.local.set({
      [BACKEND_BASE_URL_STORAGE_KEY]: normalized
    });

    return normalized;
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
      console.warn("[Zeda Extension] Failed to load sidebar stylesheet, using fallback styles.", error);
      styleElement.textContent = `
        :host { position: fixed; top: 0; right: 0; height: 100vh; width: 360px; z-index: 2147483646; }
        .zeda-sidebar__panel { height: 100%; background: #0f172a; color: #e2e8f0; transform: translateX(100%); transition: transform 220ms ease; border-left: 1px solid #334155; }
        :host(.zeda-sidebar--open) .zeda-sidebar__panel { transform: translateX(0); }
      `;
    }

    shadowRoot.appendChild(styleElement);
  };

  const formatMs = (value) => {
    if (!Number.isFinite(value) || value < 0) {
      return "n/a";
    }
    return `${Math.round(value)}ms`;
  };

  const formatScore = (value) => {
    if (!Number.isFinite(value)) {
      return "n/a";
    }
    return `${Math.round(value)}/100`;
  };

  const buildInsightList = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    const list = createElement("ul", "zeda-sidebar__list");
    items
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .slice(0, 4)
      .forEach((item) => {
        const listItem = createElement("li", "zeda-sidebar__list-item", item.trim());
        list.appendChild(listItem);
      });

    return list.childElementCount > 0 ? list : null;
  };

  const createResultCard = (label, sectionResult) => {
    const card = createElement("article", "zeda-sidebar__result-card");
    const header = createElement("div", "zeda-sidebar__result-header");
    const title = createElement("h4", "zeda-sidebar__result-title", label);
    const badge = createElement("span", "zeda-sidebar__result-badge");
    const summary = createElement("p", "zeda-sidebar__result-summary");

    header.appendChild(title);
    header.appendChild(badge);
    card.appendChild(header);
    card.appendChild(summary);

    if (!sectionResult?.ok || !sectionResult?.data) {
      badge.textContent = "Error";
      badge.classList.add("zeda-sidebar__result-badge--error");
      summary.textContent = sectionResult?.error || `${label} result unavailable.`;
      return card;
    }

    const data = sectionResult.data;
    badge.textContent = `${data.verdict || "Unknown"} • ${formatScore(data.veracityIndex)}`;
    summary.textContent = data.summary || "No summary returned.";

    const insights = buildInsightList(data.keyFindings || data.fakeParts);
    if (insights) {
      card.appendChild(insights);
    }

    const evidenceCount = Array.isArray(data.evidenceSources) ? data.evidenceSources.length : 0;
    const meta = createElement(
      "p",
      "zeda-sidebar__result-meta",
      `Sources: ${evidenceCount} • Time: ${formatMs(sectionResult.ms)}`
    );
    card.appendChild(meta);

    return card;
  };

  const mountSidebar = async () => {
    await loadSidebarStyles();

    const panel = createElement("aside", "zeda-sidebar__panel");
    panel.id = PANEL_ID;
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "Zeda Sidebar");

    const header = createElement("header", "zeda-sidebar__header");
    const titleWrap = createElement("div", "zeda-sidebar__title-wrap");
    const title = createElement("h2", "zeda-sidebar__title", "Zeda");
    const subtitle = createElement("p", "zeda-sidebar__subtitle", "Cognitive Firewall • Live Page Scan");
    const closeButton = createElement("button", "zeda-sidebar__close", "Close");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close Zeda sidebar");
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    header.appendChild(titleWrap);
    header.appendChild(closeButton);

    const body = createElement("div", "zeda-sidebar__body");

    const backendSection = createElement("section", "zeda-sidebar__section");
    const backendTitle = createElement("h3", "zeda-sidebar__section-title", "Backend Connection");
    const backendRow = createElement("div", "zeda-sidebar__backend-row");
    const backendInput = createElement("input", "zeda-sidebar__input");
    const backendSaveButton = createElement("button", "zeda-sidebar__button zeda-sidebar__button--ghost", "Save");
    const backendHint = createElement("p", "zeda-sidebar__hint", "Default: http://localhost:8000");
    backendInput.type = "url";
    backendInput.placeholder = "http://localhost:8000";
    backendInput.setAttribute("aria-label", "Zeda backend base URL");
    backendSaveButton.type = "button";
    backendRow.appendChild(backendInput);
    backendRow.appendChild(backendSaveButton);
    backendSection.appendChild(backendTitle);
    backendSection.appendChild(backendRow);
    backendSection.appendChild(backendHint);

    const actionsSection = createElement("section", "zeda-sidebar__section");
    const actionsTitle = createElement("h3", "zeda-sidebar__section-title", "Quick Actions");
    const actionsGrid = createElement("div", "zeda-sidebar__actions");
    const analyzeSelectionButton = createElement("button", "zeda-sidebar__button", "Analyze Selection");
    const analyzePageUrlButton = createElement("button", "zeda-sidebar__button", "Analyze Page URL");
    const analyzePastedTextButton = createElement(
      "button",
      "zeda-sidebar__button zeda-sidebar__button--full",
      "Use Pasted Text"
    );
    analyzeSelectionButton.type = "button";
    analyzePageUrlButton.type = "button";
    analyzePastedTextButton.type = "button";
    actionsGrid.appendChild(analyzeSelectionButton);
    actionsGrid.appendChild(analyzePageUrlButton);
    actionsGrid.appendChild(analyzePastedTextButton);
    actionsSection.appendChild(actionsTitle);
    actionsSection.appendChild(actionsGrid);

    const pasteSection = createElement("section", "zeda-sidebar__section");
    const pasteTitle = createElement("h3", "zeda-sidebar__section-title", "Pasted Input");
    const pasteTextArea = createElement("textarea", "zeda-sidebar__textarea");
    pasteTextArea.placeholder = "Paste suspicious text, email content, or a URL...";
    pasteSection.appendChild(pasteTitle);
    pasteSection.appendChild(pasteTextArea);

    const previewSection = createElement("section", "zeda-sidebar__section");
    const previewTitle = createElement("h3", "zeda-sidebar__section-title", "Captured Payload");
    const preview = createElement("pre", "zeda-sidebar__preview", "No payload captured yet.");
    const status = createElement(
      "p",
      "zeda-sidebar__status",
      "Ready. Capture selection, page URL, or pasted text to run a full scan."
    );
    previewSection.appendChild(previewTitle);
    previewSection.appendChild(preview);
    previewSection.appendChild(status);

    const reportSection = createElement("section", "zeda-sidebar__section");
    const reportTitle = createElement("h3", "zeda-sidebar__section-title", "Zeda Report");
    const reportMeta = createElement("p", "zeda-sidebar__report-meta", "No scans yet.");
    const reportGrid = createElement("div", "zeda-sidebar__results-grid");
    reportSection.appendChild(reportTitle);
    reportSection.appendChild(reportMeta);
    reportSection.appendChild(reportGrid);

    body.appendChild(backendSection);
    body.appendChild(actionsSection);
    body.appendChild(pasteSection);
    body.appendChild(previewSection);
    body.appendChild(reportSection);

    const footer = createElement("footer", "zeda-sidebar__footer", "Shortcut: Ctrl/Command + Shift + Z");

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    shadowRoot.appendChild(panel);

    let lastEdgeTriggerAt = 0;
    let isRunning = false;

    const setStatus = (message, tone = "neutral") => {
      status.textContent = message;
      status.className = "zeda-sidebar__status";

      if (tone === "warning") {
        status.classList.add("zeda-sidebar__status--warning");
      } else if (tone === "success") {
        status.classList.add("zeda-sidebar__status--success");
      }
    };

    const setRunningState = (running) => {
      isRunning = running;
      analyzeSelectionButton.disabled = running;
      analyzePageUrlButton.disabled = running;
      analyzePastedTextButton.disabled = running;
      pasteTextArea.disabled = running;
      backendInput.disabled = running;
      backendSaveButton.disabled = running;
    };

    const setCapturedPayload = async (payloadType, payloadValue, sourceLabel) => {
      preview.textContent = payloadValue;
      setStatus(`Captured ${payloadType} from ${sourceLabel}.`, "success");
      await saveDraft({ type: payloadType, value: payloadValue });
    };

    const applyBackendUiState = async () => {
      const backendBaseUrl = await resolveBackendBaseUrl();
      backendInput.value = backendBaseUrl;
      backendHint.textContent = `Using backend: ${backendBaseUrl}`;
    };

    const renderReport = (pipelineData) => {
      reportGrid.innerHTML = "";

      const ingestStatus = pipelineData?.ingest?.ok ? "ok" : "failed";
      reportMeta.textContent = `Backend: ${pipelineData.backendBaseUrl} • Ingest: ${ingestStatus} (${formatMs(
        pipelineData.ingest?.ms
      )}) • Total: ${formatMs(pipelineData.timings?.totalMs)}`;

      reportGrid.appendChild(createResultCard("Verify", pipelineData.verify));
      reportGrid.appendChild(createResultCard("Protect", pipelineData.protect));
    };

    const runScan = async (inputType, content, sourceLabel) => {
      if (isRunning) {
        return;
      }

      await setCapturedPayload(inputType, truncate(content, 2000), sourceLabel);
      setOpenState(true);
      setRunningState(true);
      setStatus("Running ingest, verify, and protect checks...", "success");

      try {
        const response = await chrome.runtime.sendMessage({
          action: RUN_SCAN_ACTION,
          payload: {
            inputType,
            content,
            source: sourceLabel
          }
        });

        if (!response?.ok || !response?.data) {
          const errorMessage =
            response && typeof response.error === "string" ? response.error : "Extension scan pipeline failed.";
          setStatus(errorMessage, "warning");
          reportMeta.textContent = "Scan failed before report generation.";
          return;
        }

        renderReport(response.data);
        const verifyOk = response.data.verify?.ok;
        const protectOk = response.data.protect?.ok;
        const overallTone = verifyOk || protectOk ? "success" : "warning";

        setStatus(
          verifyOk || protectOk
            ? "Scan completed. Review Verify and Protect cards below."
            : "Scan completed with errors. Check details in report cards.",
          overallTone
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unexpected scan error.", "warning");
      } finally {
        setRunningState(false);
      }
    };

    analyzeSelectionButton.addEventListener("click", async () => {
      const selectedText = readSelectionText();
      if (!selectedText) {
        setStatus("No highlighted text found. Select text on the page, then try again.", "warning");
        return;
      }

      await runScan("text", selectedText, "selection");
    });

    analyzePageUrlButton.addEventListener("click", async () => {
      await runScan("url", window.location.href, "active page");
    });

    analyzePastedTextButton.addEventListener("click", async () => {
      const pasted = pasteTextArea.value.trim();
      if (!pasted) {
        setStatus("Paste content into the input area before using this action.", "warning");
        return;
      }

      await runScan(inferInputType(pasted), pasted, "pasted input");
    });

    backendSaveButton.addEventListener("click", async () => {
      const inputValue = backendInput.value.trim();
      if (!inputValue) {
        setStatus("Backend URL cannot be empty.", "warning");
        return;
      }

      try {
        const savedUrl = await saveBackendBaseUrl(inputValue);
        backendInput.value = savedUrl;
        backendHint.textContent = `Using backend: ${savedUrl}`;
        setStatus("Backend URL saved.", "success");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to save backend URL.", "warning");
      }
    });

    closeButton.addEventListener("click", () => {
      setOpenState(false);
    });

    // Open the sidebar when the cursor reaches the far-right screen edge.
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

    // Close when clicking outside the sidebar surface.
    const handleGlobalClickClose = (event) => {
      if (!host.classList.contains(STATE_OPEN_CLASS)) {
        return;
      }

      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      const clickedInsideSidebar = path.includes(host) || path.includes(panel);
      if (!clickedInsideSidebar) {
        setOpenState(false);
      }
    };

    window.addEventListener(TOGGLE_EVENT, toggleOpen);
    window.addEventListener("mousemove", handleEdgeHoverOpen, { passive: true });
    window.addEventListener("mousedown", handleGlobalClickClose, true);

    // Restore the last captured payload for smoother repeated scans.
    const draft = await loadDraft();
    if (draft && typeof draft.value === "string" && draft.value.trim().length > 0) {
      preview.textContent = draft.value;
      if (draft.type === "text") {
        pasteTextArea.value = draft.value;
      }
      setStatus(`Restored previous ${draft.type || "payload"} draft from this session.`, "success");
    }

    await applyBackendUiState();

    // Start closed; edge hover or extension command opens it.
    setOpenState(false);
  };

  mountSidebar().catch((error) => {
    console.error("[Zeda Extension] Failed to mount sidebar:", error);
  });
})();
