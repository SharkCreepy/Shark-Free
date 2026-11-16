// Run with: node test-portal-relay.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "portal-relay.js"), "utf8");
const coreSource = fs.readFileSync(path.join(__dirname, "core", "main.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
const kimiSource = fs.readFileSync(path.join(__dirname, "providers", "kimi.js"), "utf8");
assert.match(coreSource, /if \(!sessionModesHydrated\) await sessionModesReady/, "Portal waits for persisted Agent/Plan session state before sending");
assert.match(coreSource, /if \(A\.portalRequestActive && !portalAgentExecutionActive\(\)\) return "ERROR: no Roblox command was run because a plain Portal chat request is active/, "plain Chat mode cannot dispatch Roblox tools");
assert.match(coreSource, /if \(A\.portalRequestActive && !portalAgentExecutionActive\(\)\) \{ diag\("loop\.blocked\.portalRequest"\); return; \}/, "only an explicit Portal Agent request can enter the existing Agent loop");
assert.match(coreSource, /if \(!sessionModesHydrated \|\| A\.portalRequestActive \|\| A\.sessionMode === "plan"/, "auto-resume is blocked during Portal chats");
assert.match(coreSource, /typeof P\.selectModel === "function"/, "a provider-specific selection must run before the prompt is sent");
assert.match(coreSource, /modelApplied: request\.modelApplied/, "the Portal only attributes a model after the provider confirms selection");
assert.match(kimiSource, /"kimi-k3-1-pro": "K3\.1 Pro"[\s\S]*?"kimi-k2-8-preview": "K2\.8 Preview"[\s\S]*?"kimi-instant": "Instant"/, "Kimi maps the three requested exact dropdown choices");
assert.match(kimiSource, /exactModelMenuOption\(expected\)/, "Kimi must find an exact visible menu option before clicking it");
assert.match(coreSource, /providerPageAuthStatus\(\)/, "provider sign-in readiness is checked only during an explicit send");
assert.doesNotMatch(backgroundSource, /portal/i, "Portal dispatch is no longer part of the background worker");
assert.doesNotMatch(backgroundSource, /chrome\.windows\.(?:create|remove)|chrome\.tabs\.create\s*\(/, "the worker never creates login popups or provider tabs");
assert.doesNotMatch(backgroundSource + coreSource, /snx-provider-auth-probe|snx-provider-auth-state|snx-portal-provider-statuses/, "automatic provider sign-in monitoring and status pushes are absent");
assert.match(coreSource, /payload\.agentMode === true/, "Agent execution requires the explicit boolean mode flag");
assert.match(coreSource, /await startSession\("agent", requestId\)/, "Portal Agent startup reuses the existing Agent session bootstrap");
assert.match(coreSource, /ui\.reviewScriptEdit/, "existing script-change review remains in the tool path");
assert.match(coreSource, /if \(document\.hidden && !A\.stop\)/, "the existing foreground visibility gate remains active");
function makeRelay({ host = "127.0.0.1", port = "3000", response = { ok: true, providers: [] } } = {}) {
  const windowListeners = new Map();
  const runtimeListeners = [];
  const posted = [];
  const calls = [];
  const window = {
    addEventListener(type, fn) { windowListeners.set(type, fn); },
    postMessage(message, targetOrigin) { posted.push({ message, targetOrigin }); },
  };
  const chrome = { runtime: {
    lastError: null,
    onMessage: { addListener(fn) { runtimeListeners.push(fn); } },
    sendMessage(message, callback) { calls.push(message); callback(response); },
  } };
  const location = { protocol: "http:", hostname: host, port, origin: `http://${host}:${port}` };
  vm.runInNewContext(source, { window, chrome, location, Object, Set, Promise, String, Number, Array, atob: global.atob, btoa: global.btoa });
  return { window, posted, calls, windowListener: windowListeners.get("message"), runtimeListener: runtimeListeners[0], origin: location.origin };
}

(async () => {
  const relay = makeRelay({ response: { ok: true, bridgeConnected: false, studioConnected: true, studioApp: true, studioProc: true, providers: [{ id: "duck", name: "Duck.ai", url: "https://duck.ai/" }] } });
  assert.equal(typeof relay.windowListener, "function", "relay installs a page message listener on the allowed origin");

  await relay.windowListener({ source: relay.window, origin: "https://evil.example", data: { channel: "sharknyx.portal.v1", source: "portal", type: "PING", requestId: "bad" } });
  assert.equal(relay.calls.length, 0, "rejects messages from a foreign origin");

  await relay.windowListener({ source: relay.window, origin: relay.origin, data: { channel: "sharknyx.portal.v1", source: "portal", type: "PING", requestId: "ping-1", payload: {} } });
  assert.equal(relay.calls[0].type, "snx-portal-ping");
  assert.ok(relay.posted.some((item) => item.message.type === "EXTENSION_READY"));
  assert.equal(relay.posted.find((item) => item.message.type === "EXTENSION_READY").message.payload.studioConnected, true, "PING exposes separate Studio status");
  assert.ok(relay.posted.some((item) => item.message.type === "RESPONSE" && item.message.replyTo === "ping-1"));
  relay.runtimeListener({ type: "zs-status", connected: true, studio: true, studioApp: true, studioProc: true });
  assert.ok(relay.posted.some((item) => item.message.type === "BRIDGE_STATUS" && item.message.payload.studioConnected === true), "live extension status broadcasts are forwarded to the Portal");

  await relay.windowListener({ source: relay.window, origin: relay.origin, data: { channel: "sharknyx.portal.v1", source: "portal", type: "SEND_MESSAGE", requestId: "invalid-image", payload: { providerId: "claude", text: "describe this", attachments: [{ type: "image/png", size: 1, dataUrl: "not-a-data-url" }] } } });
  assert.equal(relay.calls.length, 1, "invalid attachments are rejected before messaging the extension worker");
  assert.ok(relay.posted.some((item) => item.message.payload?.kind === "invalid_request"));

  for (const [id, attachment] of [
    ["invalid-base64", { type: "image/png", size: 1, dataUrl: "data:image/png;base64,AQ==" }],
    ["fake-png", { type: "image/png", size: 3, dataUrl: "data:image/png;base64,YWJj" }],
    ["noncanonical-base64", { type: "image/png", size: 8, dataUrl: "data:image/png;base64,iVBORw0KGgp=" }],
  ]) {
    await relay.windowListener({ source: relay.window, origin: relay.origin, data: { channel: "sharknyx.portal.v1", source: "portal", type: "SEND_MESSAGE", requestId: id, payload: { providerId: "claude", text: "describe this", attachments: [attachment] } } });
  }
  assert.equal(relay.calls.length, 1, "malformed/non-canonical Base64 and data without a PNG signature are rejected before extension messaging");

  const validPng = { type: "image/png", size: 8, dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
  await relay.windowListener({ source: relay.window, origin: relay.origin, data: { channel: "sharknyx.portal.v1", source: "portal", type: "SEND_MESSAGE", requestId: "valid-image", payload: { providerId: "claude", text: "describe this", attachments: [validPng] } } });
  assert.equal(relay.calls.length, 2, "a correctly signed image can be forwarded");

  const validPayload = { providerId: "duck", conversationId: "portal-chat-1", text: "hello", modelId: "", modelLabel: "" };
  await relay.windowListener({ source: relay.window, origin: relay.origin, data: { channel: "sharknyx.portal.v1", source: "portal", type: "SEND_MESSAGE", requestId: "send-1", payload: validPayload } });
  assert.equal(relay.calls[2].type, "snx-portal-send-message");
  assert.equal(relay.calls[2].payload.providerId, "duck");
  assert.ok(relay.posted.some((item) => item.message.type === "RESPONSE" && item.message.replyTo === "send-1"));

  await relay.windowListener({ source: relay.window, origin: relay.origin, data: { channel: "sharknyx.portal.v1", source: "portal", type: "SEND_MESSAGE", requestId: "wrong-provider", payload: { providerId: "unknown", text: "hello" } } });
  assert.equal(relay.calls.length, 3, "unknown providers are rejected before reaching the extension worker");

  await relay.windowListener({ source: relay.window, origin: relay.origin, data: { channel: "sharknyx.portal.v1", source: "portal", type: "SEND_MESSAGE", requestId: "invalid-mode", payload: { providerId: "duck", text: "hello", agentMode: "true" } } });
  assert.equal(relay.calls.length, 3, "a non-boolean Agent-mode value is rejected before extension messaging");
  await relay.windowListener({ source: relay.window, origin: relay.origin, data: { channel: "sharknyx.portal.v1", source: "portal", type: "SEND_MESSAGE", requestId: "agent-mode", payload: { providerId: "duck", text: "Build a part in Studio", agentMode: true } } });
  assert.equal(relay.calls[3].payload.agentMode, true, "the explicit Agent-mode selection is relayed as a boolean");

  await relay.windowListener({ source: relay.window, origin: relay.origin, data: { channel: "sharknyx.portal.v1", source: "portal", type: "CONNECT_ACCOUNT", requestId: "login-duck", payload: { providerId: "duck" } } });
  assert.equal(relay.calls.length, 4, "obsolete CONNECT_ACCOUNT messages are ignored rather than reaching the worker");
  assert.doesNotMatch(source, /CONNECT_ACCOUNT|snx-portal-login-provider|snx-portal-provider-statuses/, "the relay exposes no automated account-login or auth-status protocol");

  const nonLocal = makeRelay({ host: "example.com" });
  assert.equal(nonLocal.windowListener, undefined, "relay does not initialize on public origins");
  const wrongPort = makeRelay({ port: "3001" });
  assert.equal(wrongPort.windowListener, undefined, "relay does not initialize outside the documented Portal port");

  console.log("Portal relay content-script tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
