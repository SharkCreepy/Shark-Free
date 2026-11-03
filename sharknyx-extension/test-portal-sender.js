// Run with: node test-portal-sender.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const background = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
assert.doesNotMatch(background, /\bconst\s+URL\s*=/,
  "the bridge endpoint must not shadow the global URL constructor used for origin checks");
assert.match(background, /case "snx-portal-ping":[\s\S]*?if \(!connected\) connect\(\)/,
  "an allowed Portal PING wakes the local bridge connection after the worker sleeps");
const declaration = background.match(/function isPortalSender\(sender\) \{[\s\S]*?\n\}/);
assert.ok(declaration, "background worker Portal sender check exists");
const isPortalSender = new Function(
  "chrome", "PORTAL_ORIGINS",
  `${declaration[0]}\nreturn isPortalSender;`,
)({ runtime: { id: "sharknyx-extension-id" } }, new Set(["http://127.0.0.1:3000", "http://localhost:3000"]));

assert.equal(isPortalSender({ id: "sharknyx-extension-id", tab: { id: 7, url: "http://127.0.0.1:3000/" }, url: "chrome-extension://sharknyx-extension-id/portal-relay.js" }), true,
  "a content-script URL from the extension is accepted when the actual tab is an allowed Portal origin");
assert.equal(isPortalSender({ tab: { id: 8, url: "http://localhost:3000/" }, origin: "http://localhost:3000" }), true,
  "a Portal sender without a populated extension ID is accepted using its exact loopback origin");
assert.equal(isPortalSender({ id: "sharknyx-extension-id", tab: { id: 9, url: "http://127.0.0.1:3001/" }, url: "http://127.0.0.1:3001/" }), false,
  "a different local port remains forbidden");
assert.equal(isPortalSender({ id: "foreign-extension-id", tab: { id: 10, url: "http://127.0.0.1:3000/" } }), false,
  "a mismatched explicit sender extension ID remains forbidden");
assert.equal(isPortalSender({ id: "sharknyx-extension-id", tab: { url: "http://127.0.0.1:3000/" } }), false,
  "a sender without a concrete tab ID is rejected");
assert.equal(isPortalSender({ id: "sharknyx-extension-id", tab: { id: 11, url: "https://example.com/" }, url: "https://example.com/" }), false,
  "a non-loopback origin is rejected");

console.log("Portal sender-origin tests passed.");
