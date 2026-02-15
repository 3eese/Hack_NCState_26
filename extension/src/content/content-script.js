(() => {
  const ROOT_ID = "zeda-sidebar-root";
  const PANEL_ID = "zeda-sidebar-panel";
  const TOGGLE_EVENT = "zeda:toggle-sidebar";
  const STATE_OPEN_CLASS = "zeda-sidebar--open";

  const existingRoot = document.getElementById(ROOT_ID);
  if (existingRoot) {
    // Re-running the script should only toggle visibility, not duplicate DOM nodes.
    window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
    return;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "zeda-sidebar";

  const panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.className = "zeda-sidebar__panel";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Zeda Sidebar");

  const header = document.createElement("header");
  header.className = "zeda-sidebar__header";

  const title = document.createElement("h2");
  title.className = "zeda-sidebar__title";
  title.textContent = "Zeda";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "zeda-sidebar__close";
  closeButton.setAttribute("aria-label", "Close Zeda sidebar");
  closeButton.textContent = "Close";

  const body = document.createElement("div");
  body.className = "zeda-sidebar__body";
  body.innerHTML = [
    "<p><strong>Phase 1 ready.</strong></p>",
    "<p>Extension shell is active:</p>",
    "<ul>",
    "<li>MV3 service worker configured</li>",
    "<li>Toolbar and keyboard shortcut wired</li>",
    "<li>Sidebar injection working</li>",
    "</ul>",
    "<p>Next: add scan actions and API integration.</p>"
  ].join("");

  const footer = document.createElement("footer");
  footer.className = "zeda-sidebar__footer";
  footer.textContent = "Shortcut: Ctrl/Command + Shift + Z";

  header.appendChild(title);
  header.appendChild(closeButton);
  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);
  root.appendChild(panel);
  document.documentElement.appendChild(root);

  const toggleOpen = () => {
    root.classList.toggle(STATE_OPEN_CLASS);
  };

  // Allow close button and re-injection to share the same toggle behavior.
  closeButton.addEventListener("click", toggleOpen);
  window.addEventListener(TOGGLE_EVENT, toggleOpen);

  // Open immediately on first inject.
  requestAnimationFrame(() => {
    root.classList.add(STATE_OPEN_CLASS);
  });
})();
