// Run with: node test-portal-sender.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const background = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
assert.doesNotMatch(background, /isPortalSender|PORTAL_ORIGINS|snx-portal-/i, "no Portal sender allowlist or message protocol remains");
assert.ok(!manifest.host_permissions.some((host) => /^http:\/\/(?:127\.0\.0\.1|localhost)\//i.test(host)), "no local HTTP Portal permission remains");
assert.ok(manifest.content_scripts.every((entry) => entry.matches.every((match) => !/^http:\/\/(?:127\.0\.0\.1|localhost)\//i.test(match))), "no local Portal content script is injected");

console.log("Extension Portal sender-origin removal tests passed.");
