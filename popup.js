const UI_HIDDEN_KEY = "gptbd-ui-hidden";
const REPO_BASE_URL = "https://github.com/johnvouros/ChatGPT-bulk-delete-chats";
const DOC_LINKS = {
  privacy: `${REPO_BASE_URL}/blob/main/PRIVACY.md`,
  license: `${REPO_BASE_URL}/blob/main/LICENSE`,
  terms: `${REPO_BASE_URL}/blob/main/TERMS.md`,
  bugs: `${REPO_BASE_URL}/issues/new`
};

async function initPopup() {
  const manifest = chrome.runtime.getManifest();
  const versionLabel = document.getElementById("version-label");
  const toggle = document.getElementById("toolbar-toggle");

  if (versionLabel) versionLabel.textContent = `v${manifest.version}`;
  bindLinks();

  const stored = await chrome.storage.local.get(UI_HIDDEN_KEY);
  const hidden = Boolean(stored?.[UI_HIDDEN_KEY]);
  if (toggle) {
    toggle.checked = !hidden;
    toggle.addEventListener("change", async () => {
      await chrome.storage.local.set({ [UI_HIDDEN_KEY]: !toggle.checked });
    });
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

document.addEventListener("DOMContentLoaded", () => {
  void initPopup();
});
