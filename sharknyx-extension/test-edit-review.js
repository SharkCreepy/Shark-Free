// Smoke tests for the multi_edit preview payload and the Agent approval rule.
// Run with: node test-edit-review.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "core/config.js"), "utf8"), context);
const review = (args) => vm.runInContext(`ZS.scriptEditReviewPayload(${JSON.stringify(args)})`, context);

const patch = review({
  target_file: "game.ServerScriptService.Main",
  edits: [
    { old_string: "local x = 1", new_string: "local x = 2" },
    { old_string: "old", new_string: "new", replace_all: true },
  ],
});
assert.equal(patch.target, "game.ServerScriptService.Main");
assert.equal(patch.edits.length, 2);
assert.equal(patch.edits[0].oldText, "local x = 1");
assert.equal(patch.edits[0].newText, "local x = 2");
assert.equal(patch.edits[1].replaceAll, true);

const create = review({ file_path: "game.ServerStorage.Memory", edits: [{ old_string: "", new_string: "return {}" }] });
assert.equal(create.target, "game.ServerStorage.Memory");
assert.equal(create.edits[0].newText, "return {}");

const fallback = review({ unfamiliar: { contents: "still visible" } });
assert.equal(fallback.edits.length, 0);
assert.match(fallback.raw, /still visible/);

const agentPrompt = vm.runInContext('ZS.buildSystemPrompt({ siteName: "HuggingChat" })', context);
const planPrompt = vm.runInContext('ZS.buildPlanPrompt({ siteName: "HuggingChat" })', context);
assert.match(agentPrompt, /Only Accept applies it/);
assert.match(agentPrompt, /Never bypass review with another tool/);
assert.match(planPrompt, /Never output SharkNyx tool-call JSON/);

const main = fs.readFileSync(path.join(__dirname, "core/main.js"), "utf8");
const reviewGate = main.indexOf('if (bareName === "multi_edit")');
const bridgeDispatch = main.indexOf('bg({ type: "call_tool", name, arguments: args, timeout })');
assert.ok(reviewGate >= 0 && bridgeDispatch > reviewGate, "multi_edit review happens before bridge dispatch");
assert.match(main, /data-review="accept"/);
assert.match(main, /data-review="decline"/);
assert.match(main, /data-review="change"/);

console.log("Script edit review tests passed.");
