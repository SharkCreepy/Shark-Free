// Run with: node test-portal-cancellation.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const background = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
assert.doesNotMatch(background, /portal/i, "the background worker has no Portal-specific code");
assert.doesNotMatch(background, /chrome\.tabs\.(?:create|update)\s*\(/, "the removed Portal dispatcher cannot create or activate provider tabs");
assert.match(background, /case "list_tools"/, "the standalone Roblox Studio bridge handlers remain registered");
assert.match(background, /case "call_tool"/, "Roblox Studio Agent tool execution remains registered");

console.log("Extension background no-Portal regression passed.");
