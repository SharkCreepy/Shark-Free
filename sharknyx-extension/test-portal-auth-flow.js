// Run with: node test-portal-auth-flow.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const core = fs.readFileSync(path.join(root, "core", "main.js"), "utf8");
const relay = fs.readFileSync(path.join(root, "portal-relay.js"), "utf8");

assert.ok(!manifest.permissions.includes("cookies"), "the extension does not request cookie permission");
assert.doesNotMatch(background, /chrome\.cookies\./, "the worker never reads Chrome cookies");
assert.doesNotMatch(background + core + relay, /document\.cookie|sessionToken/i, "the Portal relay and worker do not read or transfer cookie/session-token values");
assert.doesNotMatch(background + core + relay, /chrome\.windows\.(?:create|remove)|snx-portal-login-provider|CONNECT_ACCOUNT/, "there is no custom provider-login popup operation");
assert.doesNotMatch(background, /chrome\.tabs\.create\s*\(/, "the Portal worker does not create provider tabs in the background");
assert.match(background, /chrome\.tabs\.update\(tab\.id, \{ active: true \}\)/, "a Portal send visibly activates an already-open provider tab");
assert.match(background, /if \(!tab\).*provider_tab_missing/, "a missing provider tab returns an actionable failure instead of creating a tab");
assert.doesNotMatch(core + relay + background, /snx-provider-auth-probe|snx-provider-auth-state|snx-portal-provider-statuses/, "provider sign-in state is not automatically monitored or pushed to the Portal");
const authProbe = core.match(/function providerPageAuthStatus\(\) \{[\s\S]*?\n  \}/)?.[0] || "";
assert.ok(authProbe, "a one-time provider-page readiness check exists for explicit sends");
assert.match(authProbe, /input\[type="password"\]/, "password fields may be detected by presence only during a send-time check");
assert.doesNotMatch(authProbe, /\.value|\.innerHTML|document\.cookie/, "the readiness check does not read secret input values or credential storage");
assert.match(authProbe, /one-time-code|captcha|challengeCopy/, "MFA and challenge UI block a send until the user completes them");
assert.match(relay, /PING: "snx-portal-ping"/);
assert.match(relay, /SEND_MESSAGE: "snx-portal-send-message"/);
assert.match(relay, /STOP_MESSAGE: "snx-portal-stop-message"/);
assert.doesNotMatch(relay, /CONNECT_ACCOUNT|snx-portal-login-provider/, "the bridge exposes no provider login action");

console.log("Portal provider no-popup/no-background and credential privacy checks passed.");
