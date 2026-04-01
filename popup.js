const UI_HIDDEN_KEY = "gptbd-ui-hidden";
const DEV_TOOLS_KEY = "gptbd-dev-tools";
const REPO_BASE_URL = "https://github.com/johnvouros/ChatGPT-bulk-delete-chats";
const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
const DOC_LINKS = {
  privacy: `${REPO_BASE_URL}/blob/main/PRIVACY.md`,
  license: `${REPO_BASE_URL}/blob/main/LICENSE`,
  terms: `${REPO_BASE_URL}/blob/main/TERMS.md`,
  bugs: `${REPO_BASE_URL}/issues/new`
};

async function initPopup() {
  const manifest = chrome.runtime.getManifest();
  const versionLabel = document.getElementById("version-label");
  const devToggleTarget = document.getElementById("dev-toggle-target");
  const toggle = document.getElementById("toolbar-toggle");
  const compatibilityButton = document.getElementById("compatibility-button");
  const compatibilitySection = document.getElementById("compatibility-section");
  const hideDiagnosticsButton = document.getElementById("hide-diagnostics-button");

  if (versionLabel) versionLabel.textContent = `v${manifest.version}`;
  bindLinks();

  const stored = await chrome.storage.local.get([UI_HIDDEN_KEY, DEV_TOOLS_KEY]);
  const hidden = Boolean(stored?.[UI_HIDDEN_KEY]);
  const devToolsEnabled = Boolean(stored?.[DEV_TOOLS_KEY]);
  if (toggle) {
    toggle.checked = !hidden;
    toggle.addEventListener("change", async () => {
      await chrome.storage.local.set({ [UI_HIDDEN_KEY]: !toggle.checked });
    });
  }

  if (compatibilitySection) {
    compatibilitySection.hidden = !devToolsEnabled;
  }

  if (devToggleTarget && versionLabel) {
    bindDevModeToggle(devToggleTarget, versionLabel, devToolsEnabled);
  }

  if (compatibilityButton) {
    compatibilityButton.addEventListener("click", () => {
      void runCompatibilityCheck();
    });
  }

  if (hideDiagnosticsButton) {
    hideDiagnosticsButton.addEventListener("click", async () => {
      await chrome.storage.local.set({ [DEV_TOOLS_KEY]: false });
      if (compatibilitySection) compatibilitySection.hidden = true;
      if (versionLabel) versionLabel.textContent = `v${manifest.version}`;
    });
  }

  if (devToolsEnabled) {
    void loadCompatibilityStatus();
  }
}

function bindLinks() {
  setLink("privacy-link", DOC_LINKS.privacy);
  setLink("license-link", DOC_LINKS.license);
  setLink("terms-link", DOC_LINKS.terms);
  setLink("bugs-link", DOC_LINKS.bugs);
}

function setLink(id, href) {
  const el = document.getElementById(id);
  if (!el) return;
  el.href = href;
}

function bindDevModeToggle(target, versionLabel, initialEnabled) {
  let enabled = initialEnabled;
  let clickCount = 0;
  let resetTimer = 0;
  let restoreTimer = 0;

  target.addEventListener("pointerdown", async event => {
    event.preventDefault();
    window.clearTimeout(resetTimer);
    clickCount += 1;
    if (clickCount < 5) {
      resetTimer = window.setTimeout(() => {
        clickCount = 0;
      }, 3000);
      return;
    }

    clickCount = 0;
    enabled = !enabled;
    await chrome.storage.local.set({ [DEV_TOOLS_KEY]: enabled });
    const compatibilitySection = document.getElementById("compatibility-section");
    if (compatibilitySection) compatibilitySection.hidden = !enabled;
    if (versionLabel) {
      versionLabel.textContent = enabled ? "Dev tools enabled" : `v${chrome.runtime.getManifest().version}`;
      window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => {
        versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;
      }, 1600);
    }

    if (enabled) {
      void loadCompatibilityStatus();
    }
  });
}

async function loadCompatibilityStatus() {
  const tab = await getActiveTab();
  if (!isChatGptTab(tab)) {
    renderCompatibilityError("Open ChatGPT in the active tab to run the compatibility check.");
    return;
  }

  const response = await sendTabMessage(tab.id, { type: "gptbd:get-compatibility-status" });
  if (!response?.ok || !response.report) {
    renderCompatibilityError("The ChatGPT toolbar is not ready in this tab yet. Refresh ChatGPT and try again.");
    return;
  }

  renderCompatibilityReport(response.report);
}

async function runCompatibilityCheck() {
  const button = document.getElementById("compatibility-button");
  if (button) {
    button.disabled = true;
    button.textContent = "Checking…";
  }

  try {
    const tab = await getActiveTab();
    if (!isChatGptTab(tab)) {
      renderCompatibilityError("Open ChatGPT in the active tab to run the compatibility check.");
      return;
    }

    const response = await sendTabMessage(tab.id, { type: "gptbd:run-compatibility-check" });
    if (!response?.ok || !response.report) {
      renderCompatibilityError(response?.error || "Compatibility check failed. Refresh ChatGPT and try again.");
      return;
    }

    renderCompatibilityReport(response.report);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Run check";
    }
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isChatGptTab(tab) {
  if (!tab) return false;
  if (!tab.url) return true;
  try {
    const url = new URL(tab.url);
    return CHATGPT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function sendTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

function renderCompatibilityReport(report) {
  const state = report.mode || "idle";
  const titleByState = {
    healthy: "Healthy",
    fallback: "Fallback mode",
    degraded: "Degraded",
    paused: "Paused",
    idle: "Not checked yet"
  };

  setStatusState(state);
  setText("compatibility-title", titleByState[state] || "Status unknown");
  setText("compatibility-summary", report.note || report.summary || "Compatibility check complete.");
  setTime(report.checkedAt, report.ranNow);
  setCapability("sync", report.capabilities?.sync);
  setCapability("deleteApi", report.capabilities?.deleteApi);
  setCapability("deleteUi", report.capabilities?.deleteUi);
  setIssues(report.issues || []);
}

function renderCompatibilityError(message) {
  setStatusState("error");
  setText("compatibility-title", "Unavailable");
  setText("compatibility-summary", message);
  setTime(null, false);
  setCapability("sync", null);
  setCapability("deleteApi", null);
  setCapability("deleteUi", null);
  setIssues([]);
}

function setStatusState(state) {
  const status = document.getElementById("compatibility-status");
  if (status) status.dataset.state = state;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setTime(timestamp, ranNow) {
  const el = document.getElementById("compatibility-time");
  if (!el) return;
  if (!timestamp) {
    el.hidden = true;
    el.textContent = "";
    return;
  }

  const date = new Date(timestamp);
  const prefix = ranNow ? "Checked just now" : "Last checked";
  el.textContent = `${prefix} · ${date.toLocaleString()}`;
  el.hidden = false;
}

function setCapability(key, value) {
  const el = document.querySelector(`[data-capability="${key}"]`);
  if (!el) return;
  if (value === true) {
    el.textContent = "Available";
    el.dataset.ok = "true";
  } else if (value === false) {
    el.textContent = "Unavailable";
    el.dataset.ok = "false";
  } else {
    el.textContent = "Unknown";
    delete el.dataset.ok;
  }
}

function setIssues(issues) {
  const list = document.getElementById("compatibility-issues");
  if (!list) return;
  list.replaceChildren();
  list.hidden = issues.length === 0;
  issues.slice(0, 4).forEach(issue => {
    const item = document.createElement("li");
    item.className = "popup__issue";
    item.textContent = issue;
    list.appendChild(item);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void initPopup();
});
