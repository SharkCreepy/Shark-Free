// SPDX-License-Identifier: GPL-3.0-or-later
// background.js - service worker.
// Owns ONE resilient WebSocket to the local bridge (ws://127.0.0.1:PORT).
// Keeping the socket here (not in the content script) avoids https→ws mixed
// content issues and centralises reconnect / timeout logic.
//
// Contract with content.js: every sendMessage ALWAYS gets a response object,
// even when the bridge is offline. The agentic loop must never hang waiting.

const PORT = 17613;
const BRIDGE_URL = `ws://127.0.0.1:${PORT}`;

// Chat sites where a SharkNyx provider content script runs. Status pushes go
// to every tab matching these. Add the new provider's URL pattern here (and in
// manifest.json content_scripts + host_permissions) when integrating another AI.
const PROVIDER_URLS = ["https://chatgpt.com/*", "https://chat.openai.com/*", "https://gemini.google.com/*", "https://www.kimi.ai/*", "https://kimi.ai/*", "https://chat.z.ai/*", "https://chat.qwen.ai/*", "https://arena.ai/*", "https://ptero.pro/*", "https://claude.ai/*", "https://duck.ai/*", "https://console.groq.com/chat*", "https://www.perplexity.ai/*", "https://huggingface.co/chat*", "https://www.meta.ai/*", "https://meta.ai/*"];

// The Portal runs as a local static page. This bridge is separate from the
// Roblox Studio WebSocket above: Portal chats use a provider tab the user
// already opened, visibly activating it for the request; no tab is created.
const PORTAL_ORIGINS = new Set(["http://127.0.0.1:3000", "http://localhost:3000"]);
const PORTAL_PROVIDERS = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"] },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", matches: ["https://claude.ai/*"] },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", matches: ["https://gemini.google.com/*"] },
  { id: "groq", name: "Groq Chat", url: "https://console.groq.com/chat", matches: ["https://console.groq.com/chat*"] },
  { id: "duck", name: "Duck.ai", url: "https://duck.ai/", matches: ["https://duck.ai/*"] },
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/", matches: ["https://www.perplexity.ai/*"] },
  { id: "huggingchat", name: "HuggingChat", url: "https://huggingface.co/chat/", matches: ["https://huggingface.co/chat*"] },
  { id: "kimi", name: "Kimi", url: "https://www.kimi.ai/", matches: ["https://www.kimi.ai/*", "https://kimi.ai/*"] },
  { id: "glm", name: "GLM", url: "https://chat.z.ai/", matches: ["https://chat.z.ai/*"] },
  { id: "qwen", name: "Qwen", url: "https://chat.qwen.ai/", matches: ["https://chat.qwen.ai/*"] },
  { id: "arena", name: "Arena", url: "https://arena.ai/text/direct", matches: ["https://arena.ai/*"] },
  { id: "meta", name: "Meta AI", url: "https://www.meta.ai/", matches: ["https://www.meta.ai/*", "https://meta.ai/*"] },
  { id: "ptero", name: "Ptero.pro", url: "https://ptero.pro/", matches: ["https://ptero.pro/*"] },
];
const portalRequests = new Map(); // requestId -> { portalTabId, providerTabId, providerId, cancelled }
const portalCancellationTombstones = new Map(); // requestId -> { portalTabId, expiresAt }
const PORTAL_CANCEL_TTL_MS = 120000;

function rememberPortalCancellation(requestId, portalTabId) {
  const now = Date.now();
  for (const [id, marker] of portalCancellationTombstones) {
    if (marker.expiresAt <= now) portalCancellationTombstones.delete(id);
  }
  portalCancellationTombstones.set(requestId, { portalTabId, expiresAt: now + PORTAL_CANCEL_TTL_MS });
  while (portalCancellationTombstones.size > 100) {
    portalCancellationTombstones.delete(portalCancellationTombstones.keys().next().value);
  }
}

function consumePortalCancellation(requestId, portalTabId) {
  const marker = portalCancellationTombstones.get(requestId);
  if (!marker) return false;
  if (marker.expiresAt <= Date.now()) {
    portalCancellationTombstones.delete(requestId);
    return false;
  }
  if (marker.portalTabId !== portalTabId) return false;
  portalCancellationTombstones.delete(requestId);
  return true;
}

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 5000;
const HEARTBEAT_MS = 10000;
// If no message (incl. pong) arrives within this window while we believe we're
// connected, the socket is half-open: force a reconnect instead of letting
// pending requests slowly time out.
const STALE_SOCKET_MS = 25000;
const REQUEST_TIMEOUT_DEFAULT = 130000; // a bit above the 120s tool timeout

let ws = null;
let connected = false;
let reconnectDelay = RECONNECT_MIN;
let reconnectTimer = null;
let heartbeatTimer = null;
let lastMessageAt = 0; // timestamp of the last frame received from the bridge
let nextId = 1;
const pending = new Map(); // id -> {resolve, timer}
let toolsCache = [];
let mcpAlive = false;
let serversCache = [];
// true/false = a PLACE is loaded and usable in Roblox Studio; null = unknown.
// The MCP process stays alive when Studio is closed or its MCP option is off,
// so this is probed separately (bridge "studio_status").
let studioConnected = null;
// true/false = a Roblox Studio app is connected to the MCP server at all; null =
// unknown. studioApp=true with studioConnected=false means "Studio open but no
// place"; studioApp=false means "Studio closed OR its MCP option disabled".
let studioApp = null;
// true/false = a Roblox Studio WINDOW/PROCESS exists on this machine (checked
// bridge-side via tasklist); null = unknown/old bridge. Distinguishes the two
// studioApp=false sub-cases the UI must word differently: Studio genuinely not
// launched ("open Roblox Studio") vs Studio OPEN but its MCP plugin never
// registered with the bridge - the documented fix for the latter is opening
// Assistant Settings > MCP Servers inside Studio (validated live 3x), which
// "open Roblox Studio" wording completely fails to convey.
let studioProc = null;

function log(...a) {
  console.log("[zs-bg]", ...a);
}

function isPortalSender(sender) {
  if (!sender?.tab || !Number.isInteger(sender.tab.id)) return false;
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  const candidateUrls = [sender.url, sender.origin, sender.tab.url].filter((value) => typeof value === "string" && value);
  return candidateUrls.some((value) => {
    try { return PORTAL_ORIGINS.has(new URL(value).origin); } catch { return false; }
  });
}

function providerForId(id) {
  return PORTAL_PROVIDERS.find((provider) => provider.id === id) || null;
}

function providerIdForUrl(url) {
  let host = "";
  try { host = new URL(url || "").hostname; } catch { return ""; }
  return PORTAL_PROVIDERS.find((provider) => provider.matches.some((pattern) => {
    const match = pattern.match(/^https:\/\/([^/]+)\//);
    if (!match) return false;
    const patternHost = match[1].replace(/^\*\./, "");
    return host === patternHost || (patternHost.startsWith("www.") && host === patternHost.slice(4));
  }))?.id || "";
}


function portalProviderList() {
  return PORTAL_PROVIDERS.map(({ id, name, url }) => ({ id, name, url }));
}

async function findProviderTab(providerId) {
  const provider = providerForId(providerId);
  if (!provider) return null;
  const tabs = await chrome.tabs.query({ url: provider.matches });
  return tabs
    .filter((tab) => Number.isInteger(tab.id) && tab.status === "complete")
    .sort((a, b) => Number(!!b.active) - Number(!!a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}

async function forwardPortalProgress(msg, sender) {
  const providerId = String(msg.providerId || "");
  if (!providerForId(providerId) || providerIdForUrl(sender?.url) !== providerId || !sender?.tab?.id) return;
  const pendingRequest = portalRequests.get(String(msg.requestId || ""));
  if (!pendingRequest || pendingRequest.providerTabId !== sender.tab.id || pendingRequest.providerId !== providerId) return;
  try {
    await chrome.tabs.sendMessage(pendingRequest.portalTabId, {
      type: "snx-portal-progress",
      requestId: String(msg.requestId),
      conversationId: String(msg.conversationId || ""),
      text: typeof msg.text === "string" ? msg.text : "",
      modelId: typeof msg.modelId === "string" ? msg.modelId : "",
      modelLabel: typeof msg.modelLabel === "string" ? msg.modelLabel : "",
    });
  } catch {}
}

async function dispatchPortalMessage(requestId, payload, portalTabId) {
  const provider = providerForId(String(payload.providerId || ""));
  if (!provider) return { ok: false, kind: "invalid_request", error: "Unknown AI provider." };
  const agentMode = payload.agentMode === true;
  if (payload.agentMode != null && typeof payload.agentMode !== "boolean") return { ok: false, kind: "invalid_request", error: "Invalid Portal mode." };
  const request = { portalTabId, providerTabId: null, providerId: provider.id, cancelled: false, agentMode };
  portalRequests.set(requestId, request);
  try {
    if (agentMode) {
      if (!(await waitForConnection(8000))) return { ok: false, kind: "bridge_offline", error: "The local SharkNyx bridge is offline. Start the bridge and retry; no Studio command was run." };
      await refreshStudioStatus();
      if (!connected) return { ok: false, kind: "bridge_offline", error: "The local SharkNyx bridge is offline. Start the bridge and retry; no Studio command was run." };
      if (studioConnected !== true) {
        const error = studioConnected === false
          ? studioApp === true
            ? "Roblox Studio is open, but its Studio MCP server is not connected. In Studio, open Assistant Settings > MCP Servers and enable the Roblox/Studio MCP connection. No command was run."
            : studioProc === false
              ? "Roblox Studio is not running. Open Roblox Studio and a place, connect its MCP server, then retry. No command was run."
              : "Roblox Studio is not connected to the local MCP bridge. Start Studio and enable its MCP server, then retry. No command was run."
          : "Roblox Studio connection is not confirmed yet. Wait for the local bridge status to update and retry. No command was run.";
        return { ok: false, kind: studioConnected === false ? "studio_offline" : "studio_unverified", error };
      }
    }
    let tab;
    try { tab = await findProviderTab(provider.id); }
    catch (error) {
      if (request.cancelled) return { ok: true, stopped: true, kind: "stopped", error: "Portal request stopped before provider send." };
      return { ok: false, kind: "provider_tab_unavailable", error: "The extension could not inspect provider tabs. Reload the extension and retry.", detail: String(error && error.message || error).slice(0, 200) };
    }
    if (request.cancelled) return { ok: true, stopped: true, kind: "stopped", error: "Portal request stopped before provider send." };
    if (!tab) return { ok: false, kind: "provider_tab_missing", error: `No open ${provider.name} tab was found. Open the provider in a regular browser tab and sign in there; no popup or background tab was created.` };
    request.providerTabId = tab.id;
    try {
      tab = await chrome.tabs.update(tab.id, { active: true }) || { ...tab, active: true };
    } catch (error) {
      return { ok: false, kind: "provider_tab_unavailable", error: `Could not activate the existing ${provider.name} tab. No prompt was sent.`, detail: String(error && error.message || error).slice(0, 200) };
    }
    if (request.cancelled) return { ok: true, stopped: true, kind: "stopped", error: "Portal request stopped before provider send." };
    if (agentMode && !tab.active) return { ok: false, kind: "provider_hidden", error: "Roblox Agent mode requires a visible provider page for its existing review safeguards. No command was run." };
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "snx-portal-provider-request", requestId, payload });
    } catch (error) {
      return {
        ok: false,
        kind: "provider_tab_unavailable",
        error: `${provider.name} is open but its extension listener is not responding. Reload that provider tab and retry.`,
        detail: String(error && error.message || error).slice(0, 240),
      };
    }
  } finally {
    if (portalRequests.get(requestId) === request) portalRequests.delete(requestId);
  }
}

// ── WebSocket lifecycle ─────────────────────────────────────────────────
function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  clearTimeout(reconnectTimer);
  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch (e) {
    log("WebSocket ctor failed", e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    reconnectDelay = RECONNECT_MIN;
    lastMessageAt = Date.now();
    log("connected to bridge");
    startHeartbeat();
    broadcastStatus();
  };

  ws.onmessage = (ev) => {
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleBridgeMessage(msg);
  };

  ws.onclose = () => {
    connected = false;
    mcpAlive = false;
    studioConnected = null;
    studioApp = null;
    studioProc = null;
    serversCache = [];
    stopHeartbeat();
    failAllPending("bridge connection closed");
    broadcastStatus();
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will follow; nothing to do here but avoid an unhandled error.
    try { ws.close(); } catch {}
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.7, RECONNECT_MAX);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (connected) {
      // Half-open socket: the WS still reports OPEN but nothing comes through.
      // The pong (and every other frame) refreshes lastMessageAt; if it has
      // gone stale, drop the dead socket so onclose triggers a reconnect.
      if (lastMessageAt && Date.now() - lastMessageAt > STALE_SOCKET_MS) {
        log("socket stale, forcing reconnect");
        try { ws.close(); } catch {}
        return;
      }
      // Keeps the MV3 service worker alive AND detects a half-open socket.
      send({ type: "ping" }).catch(() => {});
      refreshStudioStatus();
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// Resolve once the socket is OPEN, or false after `timeout` ms.
function waitForConnection(timeout = 8000) {
  return new Promise((resolve) => {
    if (connected && ws && ws.readyState === WebSocket.OPEN) return resolve(true);
    connect(); // nudge a (re)connection - important after a worker wake-up
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (connected && ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(iv);
        resolve(true);
      } else if (Date.now() - t0 > timeout) {
        clearInterval(iv);
        resolve(false);
      }
    }, 100);
  });
}

// ── request/response over the socket ────────────────────────────────────
async function send(obj, timeout = REQUEST_TIMEOUT_DEFAULT) {
  // The MV3 service worker can be suspended; the first message after a wake-up
  // arrives before the socket has re-opened. Wait for it instead of failing -
  // otherwise Kimi wrongly hears "bridge offline".
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
    await waitForConnection(8000);
  }
  return new Promise((resolve) => {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      resolve({ ok: false, kind: "disconnected", error: "bridge not connected" });
      return;
    }
    const id = nextId++;
    const payload = { ...obj, id };
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ ok: false, kind: "timeout", error: "bridge did not respond in time" });
      }
    }, timeout);
    pending.set(id, { resolve, timer });
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      resolve({ ok: false, kind: "disconnected", error: String(e) });
    }
  });
}

// Ask the bridge whether a Roblox Studio instance is actually connected to the
// MCP server. Broadcasts only on change so the UI updates promptly but quietly.
let studioProbing = false;
async function refreshStudioStatus() {
  if (!connected) return { connected: false, studio: studioConnected, studioApp, studioProc, mcpAlive };
  if (studioProbing) {
    const startedAt = Date.now();
    while (studioProbing && Date.now() - startedAt < 12500) await new Promise((resolve) => setTimeout(resolve, 50));
    return { connected, studio: studioConnected, studioApp, studioProc, mcpAlive };
  }
  studioProbing = true;
  try {
    const r = await send({ type: "studio_status" }, 12000);
    const v = r && r.ok && typeof r.studio === "boolean" ? r.studio : null;
    if (v !== studioConnected) {
      studioConnected = v;
      broadcastStatus();
    }
    return { connected, studio: studioConnected, studioApp, studioProc, mcpAlive };
  } finally {
    studioProbing = false;
  }
}

function handleBridgeMessage(msg) {
  if ("studio" in msg && (typeof msg.studio === "boolean" || msg.studio === null)) {
    studioConnected = msg.studio;
  }
  if ("studio_app" in msg && (typeof msg.studio_app === "boolean" || msg.studio_app === null)) {
    studioApp = msg.studio_app;
  }
  if ("studio_proc" in msg && (typeof msg.studio_proc === "boolean" || msg.studio_proc === null)) {
    studioProc = msg.studio_proc;
  }
  if (msg.type === "studio_status") {
    resolvePending(msg.id, { ok: true, studio: studioConnected });
    broadcastStatus();
    return;
  }
  if (msg.type === "connected") {
    mcpAlive = !!msg.mcp_alive;
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    broadcastStatus();
    return;
  }
  if (msg.type === "pong") {
    resolvePending(msg.id, { ok: true });
    return;
  }
  if (msg.type === "tools") {
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    mcpAlive = !!msg.mcp_alive;
    resolvePending(msg.id, { ok: true, tools: toolsCache });
    broadcastStatus();
    return;
  }
  if (msg.type === "tool_result") {
    resolvePending(msg.id, msg.ok
      ? { ok: true, text: msg.text, images: msg.images || [] }
      : { ok: false, kind: msg.kind, error: msg.error });
    return;
  }
  if (msg.type === "mcp_status") {
    mcpAlive = !!msg.alive;
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    resolvePending(msg.id, { ok: !!msg.ok, alive: msg.alive, error: msg.error });
    broadcastStatus();
    return;
  }
  if (msg.type === "server_changed") {
    // The bridge acks, then restarts itself to reload config.json. The socket
    // will drop right after this - the content script shows a spinner until the
    // reconnect lands and a fresh status arrives.
    resolvePending(msg.id, { ok: !!msg.ok, error: msg.error, restarting: !!msg.restarting });
    return;
  }
  if (msg.type === "error") {
    resolvePending(msg.id, { ok: false, error: msg.error });
    return;
  }
}

function resolvePending(id, value) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(value);
}

function failAllPending(reason) {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ ok: false, kind: "disconnected", error: reason });
  }
  pending.clear();
}

// ── status push to any open provider tab + popup ─────────────────────────
function statusObj() {
  return { type: "zs-status", connected, mcpAlive, studio: studioConnected, studioApp, studioProc, tools: toolsCache.length, servers: serversCache };
}

function broadcastStatus() {
  chrome.runtime.sendMessage(statusObj()).catch(() => {});
  chrome.tabs.query({ url: PROVIDER_URLS }, (tabs) => {
    for (const t of tabs) chrome.tabs.sendMessage(t.id, statusObj()).catch(() => {});
  });
}

// ── messages from content.js / popup.js ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "snx-portal-ping":
        if (!isPortalSender(sender)) { sendResponse({ ok: false, error: "Portal origin is not allowed." }); break; }
        if (!connected) connect(); // wake the local bridge after the worker has been suspended
        sendResponse({ ok: true, bridgeConnected: connected, studioConnected, studioApp, studioProc, mcpAlive, providers: portalProviderList() });
        break;
      case "snx-portal-list-providers":
        if (!isPortalSender(sender)) { sendResponse({ ok: false, error: "Portal origin is not allowed." }); break; }
        sendResponse({ ok: true, providers: portalProviderList() });
        break;
      case "snx-portal-send-message": {
        if (!isPortalSender(sender)) { sendResponse({ ok: false, kind: "forbidden", error: "Portal origin is not allowed." }); break; }
        const requestId = String(msg.requestId || "");
        const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : null;
        if (!requestId || requestId.length > 120 || !payload || typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 60000 || (payload.agentMode != null && typeof payload.agentMode !== "boolean")) {
          sendResponse({ ok: false, kind: "invalid_request", error: "Invalid Portal message or mode." });
          break;
        }
        if (consumePortalCancellation(requestId, sender.tab.id)) { sendResponse({ ok: true, stopped: true, kind: "stopped" }); break; }
        if (portalRequests.has(requestId)) { sendResponse({ ok: false, kind: "duplicate_request", error: "This Portal request is already running." }); break; }
        sendResponse(await dispatchPortalMessage(requestId, payload, sender.tab.id));
        break;
      }
      case "snx-portal-stop-message": {
        if (!isPortalSender(sender)) { sendResponse({ ok: false, kind: "forbidden", error: "Portal origin is not allowed." }); break; }
        const activeId = String(msg.payload?.requestId || "");
        if (!activeId || activeId.length > 120) { sendResponse({ ok: false, kind: "invalid_request", error: "Invalid Portal request ID." }); break; }
        const active = portalRequests.get(activeId);
        if (!active) {
          rememberPortalCancellation(activeId, sender.tab.id);
          sendResponse({ ok: true, stopped: true, pendingLookup: true });
          break;
        }
        if (active.portalTabId !== sender.tab.id) { sendResponse({ ok: false, error: "No matching Portal request is active." }); break; }
        active.cancelled = true;
        if (!Number.isInteger(active.providerTabId)) { sendResponse({ ok: true, stopped: true, pendingLookup: true }); break; }
        try {
          sendResponse(await chrome.tabs.sendMessage(active.providerTabId, { type: "snx-portal-provider-stop", requestId: activeId }));
        } catch (error) {
          sendResponse({ ok: false, error: String(error && error.message || error).slice(0, 240) });
        }
        break;
      }
      case "snx-portal-provider-progress":
        await forwardPortalProgress(msg, sender);
        sendResponse({ ok: true });
        break;
      case "status":
        if (!connected) connect(); // self-heal after a worker wake-up
        sendResponse(statusObj());
        break;
      case "list_tools": {
        // Prefer a live refresh; fall back to cache so the loop never stalls.
        // 10s, not 25s: a catalogue request only blocks this long when one of the
        // MCP servers is dead (typically Roblox in a degraded, Blender-only
        // session), and in that exact case we already hold a perfectly good cached
        // catalogue. Waiting the full 25s just froze the boot for no new data.
        const r = await send({ type: "list_tools" }, 10000);
        if (r.ok) sendResponse({ ok: true, tools: r.tools });
        else sendResponse({ ok: toolsCache.length > 0, tools: toolsCache, error: r.error });
        break;
      }
      case "call_tool": {
        const timeout = (msg.timeout || 120000) + 10000;
        const r = await send(
          { type: "call_tool", name: msg.name, arguments: msg.arguments, timeout: msg.timeout },
          timeout
        );
        sendResponse(r);
        break;
      }
      case "restart_mcp": {
        const r = await send({ type: "restart_mcp" }, 30000);
        sendResponse(r);
        break;
      }
      case "add_server": {
        const r = await send({
          type: "add_server", server_id: msg.server_id,
          command: msg.command, args: msg.args, env: msg.env,
        }, 15000);
        sendResponse(r);
        break;
      }
      case "remove_server": {
        const r = await send({ type: "remove_server", server_id: msg.server_id }, 15000);
        sendResponse(r);
        break;
      }
      case "reconnect":
        reconnectDelay = RECONNECT_MIN;
        connect();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true; // async sendResponse
});

// Wake/keepalive hooks.
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
