// Run with: node test-portal-sender.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const background = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
assert.doesNotMatch(background, /isPortalSender|PORTAL_ORIGINS|snx-portal-/i, "no Portal sender allowlist or message protocol remains");
assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"), "OpenCode loopback provider permission remains");
assert.ok(manifest.host_permissions.includes("http://localhost/*"), "OpenCode localhost provider permission remains");
const localScripts = manifest.content_scripts.filter((entry) =>
  entry.matches.some((match) => /^http:\/\/(?:127\.0\.0\.1|localhost)\//i.test(match))
);
assert.ok(localScripts.length > 0, "the OpenCode local content script is registered");
assert.ok(localScripts.every((entry) => entry.js.includes("providers/opencode.js") && !entry.js.includes("portal-relay.js")),
  "local page access is only for OpenCode; no Portal relay is injected");

console.log("Extension Portal sender-origin removal tests passed.");
