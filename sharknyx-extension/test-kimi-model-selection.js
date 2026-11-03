// Run with: node test-kimi-model-selection.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "providers", "kimi.js"), "utf8");
const start = source.indexOf("  const PORTAL_MODEL_OPTIONS = Object.freeze({");
const end = source.indexOf('\n  return {\n    id: "kimi",', start);
assert.ok(start >= 0 && end > start, "Kimi model selection helper exists");
const helperSource = source.slice(start, end);

let menuOpen = false;
const clickedOptions = [];
const modelLabel = { innerText: "K3.1 Pro High", textContent: "K3.1 Pro High" };
const makeVisibleNode = (properties = {}) => ({
  isConnected: true,
  getBoundingClientRect: () => ({ width: 120, height: 32 }),
  ...properties,
});
const modelControl = makeVisibleNode({
  innerText: "K3.1 Pro High",
  textContent: "K3.1 Pro High",
  closest() { return this; },
  click() { this.clickCount = (this.clickCount || 0) + 1; menuOpen = true; },
});
modelLabel.closest = () => modelControl;
const options = ["K3.1 Pro", "K2.8 Preview", "Instant"].map((name) => makeVisibleNode({
  innerText: name,
  textContent: name,
  click() { clickedOptions.push(name); modelLabel.innerText = name; modelLabel.textContent = name; menuOpen = false; },
}));
const document = {
  querySelector(selector) { return selector.includes("current-model") ? modelLabel : null; },
  querySelectorAll(selector) {
    if (selector === 'button,[role="button"]') return [modelControl];
    if (selector.includes('[role="option"]')) return menuOpen ? options : [];
    return [];
  },
};
const selectModel = new Function(
  "document", "getComputedStyle", "sleep", "S",
  `${helperSource}\nreturn selectModel;`,
)(document, () => ({ display: "block", visibility: "visible", opacity: "1" }), async () => {}, { currentModelName: ".current-model .model-name" });

(async () => {
  const proResult = await selectModel("kimi-k3-1-pro");
  assert.equal(proResult.ok, true);
  assert.equal(proResult.modelLabel, "K3.1 Pro");
  assert.equal(clickedOptions[0], "K3.1 Pro", "the exact menu option is clicked even when the current label is K3.1 Pro High");
  assert.equal(modelControl.clickCount, 1, "the current model dropdown is opened before the Kimi selection");
  const result = await selectModel("kimi-k2-8-preview");
  assert.equal(result.ok, true);
  assert.equal(result.modelLabel, "K2.8 Preview");
  assert.equal(clickedOptions[1], "K2.8 Preview");
  assert.equal(modelLabel.textContent, "K2.8 Preview", "the exact visible dropdown row was selected and confirmed before sending");
  const unknown = await selectModel("not-a-kimi-model");
  assert.equal(unknown.ok, false, "unknown IDs fail closed");
  console.log("Kimi exact model selection tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
