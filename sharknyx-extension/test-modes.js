const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({});
const source = fs.readFileSync(path.join(__dirname, "core/config.js"), "utf8");
vm.runInContext(source, context, { filename: "core/config.js" });

const plan = vm.runInContext(
  'ZS.buildPlanPrompt({ siteName: "ChatGPT", providerNotes: "Use concise wording.", customPrompt: "Prefer numbered plans." })',
  context,
);
const agent = vm.runInContext('ZS.buildSystemPrompt({ siteName: "ChatGPT" })', context);
const markers = vm.runInContext("[ZS.SYS_MARKER, ZS.PLAN_MARKER]", context);

assert.ok(plan.includes(markers[0]), "Plan prompt includes the system camouflage marker");
assert.ok(plan.includes(markers[1]), "Plan prompt includes its distinct session-mode marker");
assert.ok(plan.includes("planning-only"), "Plan prompt states that it is planning-only");
assert.ok(plan.includes("Never output SharkNyx tool-call JSON"), "Plan prompt forbids executable tool output");
assert.ok(plan.includes("Prefer numbered plans."), "Plan prompt retains user style preferences");
assert.ok(!plan.includes("list_commands"), "Plan prompt does not inherit Agent tool instructions");
assert.ok(agent.includes("list_commands"), "Agent prompt remains unchanged and command-capable");

console.log("Plan-mode prompt tests passed.");
