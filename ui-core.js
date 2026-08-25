(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GPTBDUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function getSelectionToggleCopy(options = {}) {
    const enabled = Boolean(options.enabled);
    const projectMode = Boolean(options.projectMode);
    const hasVisibleSidebar = Boolean(options.hasVisibleSidebar);

    if (projectMode) {
      return enabled
        ? { label: "Hide project checkboxes", title: "Hide project chat selection checkboxes (Esc)" }
        : { label: "Show project checkboxes", title: "Show selection checkboxes for project chats" };
    }
    if (!hasVisibleSidebar) {
      return enabled
        ? { label: "Hide sidebar checkboxes", title: "Checkboxes are enabled. Open the ChatGPT sidebar to use them, or click to hide them." }
        : { label: "Show sidebar checkboxes", title: "Show selection checkboxes in the ChatGPT sidebar" };
    }
    return enabled
      ? { label: "Hide sidebar checkboxes", title: "Hide chat selection checkboxes (Esc)" }
      : { label: "Show sidebar checkboxes", title: "Show selection checkboxes in the ChatGPT sidebar" };
  }

  return { getSelectionToggleCopy };
});
