const CONTENT_SCRIPT_FILE = "src/content/content-script.js";
const CONTENT_STYLE_FILE = "src/content/sidebar.css";
const TOGGLE_COMMAND = "toggle-zeda-sidebar";

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
    // CSS is inserted first so the content script can immediately render styled UI.
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: [CONTENT_STYLE_FILE]
    });
  } catch (error) {
    // insertCSS may fail on first-party protected pages; continue to script injection attempt.
    console.warn("[Zeda Extension] Failed to insert sidebar CSS:", error);
  }

  try {
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
