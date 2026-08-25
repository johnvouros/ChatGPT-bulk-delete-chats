const test = require("node:test");
const assert = require("node:assert/strict");
const { getSelectionToggleCopy } = require("../ui-core.js");

test("names the sidebar effect explicitly", () => {
  assert.equal(getSelectionToggleCopy({ hasVisibleSidebar: true }).label, "Show sidebar checkboxes");
  assert.equal(
    getSelectionToggleCopy({ enabled: true, hasVisibleSidebar: true }).label,
    "Hide sidebar checkboxes"
  );
});

test("explains the hidden-sidebar state", () => {
  const copy = getSelectionToggleCopy({ enabled: true, hasVisibleSidebar: false });
  assert.equal(copy.label, "Hide sidebar checkboxes");
  assert.match(copy.title, /Open the ChatGPT sidebar/);
});

test("uses project-specific checkbox copy", () => {
  assert.equal(getSelectionToggleCopy({ projectMode: true }).label, "Show project checkboxes");
  assert.equal(
    getSelectionToggleCopy({ projectMode: true, enabled: true }).label,
    "Hide project checkboxes"
  );
});
