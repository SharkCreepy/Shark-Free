// Run with: node test-portal-auth-flow.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

assert.doesNotMatch(background, /portal/i, "the extension background worker contains no Portal code or protocol names");
assert.doesNotMatch(JSON.stringify(manifest), /portal/i, "the manifest contains no Portal branding or relay injection");
assert.ok(!manifest.host_permissions.includes("http://127.0.0.1/*"), "the extension does not request local HTTP host access for a Portal");
assert.ok(!manifest.host_permissions.includes("http://localhost/*"), "the extension does not request localhost HTTP host access for a Portal");
assert.ok(manifest.host_permissions.includes("ws://127.0.0.1/*"), "the Studio bridge WebSocket permission remains available");
assert.ok(manifest.content_scripts.every((entry) => !entry.js.includes("portal-relay.js")), "the Portal relay is not injected into local pages");
assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("https://chatgpt.com/*")), "normal provider scripts remain installed");

console.log("Extension background and manifest contain no Portal references; Studio/provider integration remains.");
