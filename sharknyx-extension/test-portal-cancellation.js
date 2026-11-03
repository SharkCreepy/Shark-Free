// Run with: node test-portal-cancellation.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const background = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
const declaration = background.match(/async function dispatchPortalMessage\(requestId, payload, portalTabId\) \{[\s\S]*?\n\}/);
assert.ok(declaration, "background worker exposes the expected dispatch function");
assert.match(background, /active\.cancelled = true;/, "STOP marks an already registered request as cancelled");
assert.match(background, /rememberPortalCancellation\(activeId, sender\.tab\.id\)/, "STOP arriving before SEND is retained as a tab-bound tombstone");
assert.match(background, /consumePortalCancellation\(requestId, sender\.tab\.id\)/, "a following SEND consumes the matching early-stop tombstone");
assert.doesNotMatch(background, /chrome\.tabs\.create\s*\(/, "dispatch never creates automatic provider tabs");
assert.match(background, /chrome\.tabs\.update\(tab\.id, \{ active: true \}\)/, "dispatch activates the existing provider tab for a user-initiated send");

async function makeDispatch({ findTab, updateTab, sent, providerResponse = { ok: true, text: "reply" }, status = {} }) {
  const portalRequests = new Map();
  const updates = [];
  const chrome = { tabs: {
    sendMessage: async (tabId, message) => { sent.push({ tabId, message }); return providerResponse; },
    update: async (tabId, options) => {
      updates.push({ tabId, options });
      if (updateTab) return updateTab(tabId, options);
      return { id: tabId, status: "complete", active: true };
    },
  } };
  const dispatch = new Function(
    "providerForId", "findProviderTab", "portalRequests", "chrome", "waitForConnection", "refreshStudioStatus",
    "connected", "studioConnected", "studioApp", "studioProc",
    `${declaration[0]}\nreturn dispatchPortalMessage;`,
  )(
    (id) => id === "groq" ? { id: "groq", name: "Groq Chat", url: "https://console.groq.com/chat" } : null,
    findTab || (async () => null), portalRequests, chrome,
    async () => status.connected !== false,
    async () => ({ connected: status.connected !== false, studio: status.studio === undefined ? null : status.studio, studioApp: status.studioApp ?? null, studioProc: status.studioProc ?? null }),
    status.connected !== false, status.studio === true, status.studioApp ?? null, status.studioProc ?? null,
  );
  return { dispatch, portalRequests, updates };
}

(async () => {
  let resolveLookup;
  const lookup = new Promise((resolve) => { resolveLookup = resolve; });
  const cancelledSend = [];
  const pendingCase = await makeDispatch({ findTab: () => lookup, sent: cancelledSend });
  const resultPromise = pendingCase.dispatch("req-pending-stop", { providerId: "groq", text: "hello" }, 17);
  const registered = pendingCase.portalRequests.get("req-pending-stop");
  assert.ok(registered, "request is registered before async provider-tab lookup starts");
  assert.equal(registered.providerTabId, null, "provider tab is not assigned during lookup");
  registered.cancelled = true;
  resolveLookup({ id: 88, status: "complete", active: false });
  const cancelled = await resultPromise;
  assert.equal(cancelled.stopped, true, "lookup completion observes cancellation");
  assert.equal(cancelledSend.length, 0, "a cancelled lookup never sends the prompt");
  assert.equal(pendingCase.updates.length, 0, "a cancelled lookup never activates a provider tab");
  assert.equal(pendingCase.portalRequests.has("req-pending-stop"), false, "cancelled request is removed after completion");

  const normalSent = [];
  const normalCase = await makeDispatch({ findTab: async () => ({ id: 89, status: "complete", active: false }), sent: normalSent });
  const normal = await normalCase.dispatch("req-normal", { providerId: "groq", text: "hello" }, 17);
  assert.equal(normal.ok, true, "plain Chat uses an already-open provider tab");
  assert.equal(normalSent.length, 1, "exactly one provider send occurs");
  assert.deepEqual(normalCase.updates, [{ tabId: 89, options: { active: true } }], "plain Chat visibly activates the already-open provider tab");
  assert.equal(normalCase.portalRequests.size, 0, "completed provider requests are removed");

  const missingSent = [];
  const missingCase = await makeDispatch({ findTab: async () => null, sent: missingSent });
  const missing = await missingCase.dispatch("req-missing", { providerId: "groq", text: "hello" }, 17);
  assert.equal(missing.kind, "provider_tab_missing", "a missing provider tab returns an actionable error");
  assert.match(missing.error, /Open the provider in a regular browser tab/);
  assert.equal(missingSent.length, 0, "no prompt is sent when the user has not opened the provider");
  assert.equal(missingCase.updates.length, 0, "there is no tab to activate and none is created");

  const activationSent = [];
  const failedActivationCase = await makeDispatch({ findTab: async () => ({ id: 90, status: "complete", active: false }), updateTab: async () => { throw new Error("activation denied"); }, sent: activationSent });
  const failedActivation = await failedActivationCase.dispatch("req-activation-failed", { providerId: "groq", text: "hello" }, 17);
  assert.equal(failedActivation.kind, "provider_tab_unavailable", "activation failure is actionable");
  assert.equal(activationSent.length, 0, "no prompt is sent if the existing provider tab cannot be activated");

  const authSent = [];
  const authCase = await makeDispatch({ findTab: async () => ({ id: 91, status: "complete", active: false }), sent: authSent, providerResponse: { ok: false, kind: "sign_in_required", error: "Sign in on this provider tab; no prompt was sent." } });
  const authResult = await authCase.dispatch("req-auth", { providerId: "groq", text: "hello" }, 17);
  assert.equal(authResult.kind, "sign_in_required", "the provider page blocks the explicit send when sign-in is required");
  assert.equal(authSent.length, 1);
  assert.equal(authResult.error, "Sign in on this provider tab; no prompt was sent.");

  const hiddenAgentSent = [];
  const hiddenAgentCase = await makeDispatch({
    findTab: async () => ({ id: 92, status: "complete", active: false }),
    updateTab: async (id) => ({ id, status: "complete", active: false }),
    sent: hiddenAgentSent, status: { connected: true, studio: true },
  });
  const hiddenAgent = await hiddenAgentCase.dispatch("req-agent-hidden", { providerId: "groq", text: "Create a part", agentMode: true }, 17);
  assert.equal(hiddenAgent.kind, "provider_hidden", "Agent mode fails closed if the activated tab is still hidden");
  assert.equal(hiddenAgentCase.updates.length, 1);
  assert.equal(hiddenAgentSent.length, 0);

  const visibleAgentSent = [];
  const visibleAgentCase = await makeDispatch({ findTab: async () => ({ id: 93, status: "complete", active: false }), sent: visibleAgentSent, status: { connected: true, studio: true } });
  const visibleAgent = await visibleAgentCase.dispatch("req-agent-visible", { providerId: "groq", text: "Create a part", agentMode: true }, 17);
  assert.equal(visibleAgent.ok, true, "Agent mode works after an explicit send visibly activates the already-open page when Studio is live");
  assert.equal(visibleAgentSent[0].message.payload.agentMode, true);
  assert.equal(visibleAgentCase.updates.length, 1);

  const offlineSent = [];
  const offlineCase = await makeDispatch({ findTab: async () => ({ id: 94, status: "complete", active: true }), sent: offlineSent, status: { connected: false, studio: false } });
  const offline = await offlineCase.dispatch("req-offline", { providerId: "groq", text: "Create a part", agentMode: true }, 17);
  assert.equal(offline.kind, "bridge_offline", "Agent mode fails closed when the local bridge is offline");
  assert.equal(offlineSent.length, 0, "no provider prompt is sent while the bridge is offline");

  const studioOfflineSent = [];
  const studioOfflineCase = await makeDispatch({ findTab: async () => ({ id: 95, status: "complete", active: true }), sent: studioOfflineSent, status: { connected: true, studio: false, studioApp: true } });
  const studioOffline = await studioOfflineCase.dispatch("req-studio-offline", { providerId: "groq", text: "Create a part", agentMode: true }, 17);
  assert.equal(studioOffline.kind, "studio_offline", "Agent mode fails closed when Studio MCP is not connected");
  assert.equal(studioOfflineSent.length, 0, "no provider prompt is sent without a live Studio connection");

  console.log("Portal existing-tab activation, cancellation, and Agent-gate tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
