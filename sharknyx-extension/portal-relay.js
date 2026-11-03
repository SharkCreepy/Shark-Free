// SPDX-License-Identifier: GPL-3.0-or-later
// Local Portal <-> extension relay. This script runs only on the explicitly
// allowed localhost Portal origin. It never reads cookies, passwords, or page
// storage; it forwards the Portal's user-selected message to the extension SW.
(() => {
  "use strict";

  const CHANNEL = "sharknyx.portal.v1";
  const PORTAL_PORT = "3000";
  const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);
  const PROVIDER_IDS = new Set([
    "chatgpt", "claude", "gemini", "groq", "duck", "perplexity",
    "huggingchat", "kimi", "glm", "qwen", "arena", "meta", "ptero",
  ]);
  const MAX_TEXT = 60000;
  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
  const IMAGE_DATA_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i;
  const ALLOWED_EFFORT = new Set(["low", "medium", "high", "extra", "max"]);

  if (location.protocol !== "http:" || location.port !== PORTAL_PORT || !ALLOWED_HOSTS.has(location.hostname)) return;
  const PORTAL_ORIGIN = location.origin;

  function post(type, requestId, payload = {}) {
    const message = { channel: CHANNEL, source: "extension", type, payload };
    if (requestId) message.replyTo = requestId;
    window.postMessage(message, PORTAL_ORIGIN);
  }

  function imageBytes(attachment) {
    if (!attachment || typeof attachment !== "object") return null;
    const match = IMAGE_DATA_RE.exec(String(attachment.dataUrl || ""));
    if (!match) return null;
    const mime = match[1].toLowerCase();
    const base64 = match[2];
    if (base64.length % 4 !== 0) return null;
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const bytes = Math.floor(base64.length * 3 / 4) - padding;
    if (attachment.type && String(attachment.type).toLowerCase() !== mime) return null;
    if (Number.isFinite(attachment.size) && attachment.size !== bytes) return null;
    if (bytes < 1 || bytes > MAX_IMAGE_BYTES) return null;
    let binary;
    try {
      binary = atob(base64);
      if (btoa(binary) !== base64) return null;
    } catch { return null; }
    if (binary.length !== bytes) return null;
    const hasBytes = (signature, offset = 0) => signature.every((byte, index) => binary.charCodeAt(offset + index) === byte);
    const validSignature = mime === "image/png"
      ? hasBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : mime === "image/jpeg" ? hasBytes([0xff, 0xd8, 0xff])
      : mime === "image/gif" ? (hasBytes([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || hasBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
      : mime === "image/webp" ? (hasBytes([0x52, 0x49, 0x46, 0x46]) && hasBytes([0x57, 0x45, 0x42, 0x50], 8))
      : false;
    if (!validSignature) return null;
    return { mime, base64, bytes };
  }

  function validate(type, payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Invalid request payload.";
    if (type === "SEND_MESSAGE") {
      if (!PROVIDER_IDS.has(String(payload.providerId || ""))) return "Unknown AI provider.";
      if (typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > MAX_TEXT) return "Message must contain 1–60,000 characters.";
      if (payload.modelId != null && (typeof payload.modelId !== "string" || payload.modelId.length > 120)) return "Invalid model selection.";
      if (payload.agentMode != null && typeof payload.agentMode !== "boolean") return "Invalid chat mode.";
      if (payload.effort != null && !ALLOWED_EFFORT.has(payload.effort)) return "Invalid Claude effort value.";
      const attachments = payload.attachments == null ? [] : payload.attachments;
      if (!Array.isArray(attachments) || attachments.length > MAX_IMAGES) return "Choose no more than four images.";
      let total = 0;
      for (const attachment of attachments) {
        const image = imageBytes(attachment);
        if (!image) return "An image is invalid or exceeds the 5 MiB per-image limit.";
        total += image.bytes;
        if (total > MAX_TOTAL_IMAGE_BYTES) return "Selected images exceed the 10 MiB total limit.";
      }
    } else if (type === "STOP_MESSAGE") {
      if (typeof payload.requestId !== "string" || payload.requestId.length > 120) return "Invalid stop request.";
    }
    return null;
  }

  function sendRuntime(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          resolve(error ? { ok: false, kind: "extension_unavailable", error: error.message } : (response || { ok: false, error: "The extension returned no response." }));
        });
      } catch (error) {
        resolve({ ok: false, kind: "extension_unavailable", error: String(error && error.message || error) });
      }
    });
  }

  const runtimeTypes = {
    PING: "snx-portal-ping",
    LIST_PROVIDERS: "snx-portal-list-providers",
    SEND_MESSAGE: "snx-portal-send-message",
    STOP_MESSAGE: "snx-portal-stop-message",
  };

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== PORTAL_ORIGIN) return;
    const request = event.data;
    if (!request || request.channel !== CHANNEL || request.source !== "portal" || typeof request.requestId !== "string" || request.requestId.length > 120) return;
    const type = request.type;
    if (!Object.hasOwn(runtimeTypes, type)) return;
    const payload = request.payload && typeof request.payload === "object" ? request.payload : {};
    const error = validate(type, payload);
    if (error) {
      post("RESPONSE", request.requestId, { ok: false, kind: "invalid_request", error });
      return;
    }
    const result = await sendRuntime({ type: runtimeTypes[type], requestId: request.requestId, payload });
    if (type === "PING" && result.ok) {
      post("EXTENSION_READY", "", {
        providers: result.providers || [], relay: "local-postmessage-v1",
        bridgeConnected: result.bridgeConnected, studioConnected: result.studioConnected,
        studioApp: result.studioApp, studioProc: result.studioProc,
      });
    }
    if (type === "LIST_PROVIDERS" && result.ok) {
      post("PROVIDERS", "", { providers: result.providers || [] });
    }
    post("RESPONSE", request.requestId, result);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "zs-status") {
      post("BRIDGE_STATUS", "", {
        bridgeConnected: !!message.connected,
        studioConnected: typeof message.studio === "boolean" ? message.studio : null,
        studioApp: typeof message.studioApp === "boolean" ? message.studioApp : null,
        studioProc: typeof message.studioProc === "boolean" ? message.studioProc : null,
      });
      return;
    }
    if (!message || message.type !== "snx-portal-progress" || typeof message.requestId !== "string") return;
    post("CHAT_PROGRESS", message.requestId, {
      requestId: message.requestId,
      conversationId: String(message.conversationId || "").slice(0, 120),
      text: typeof message.text === "string" ? message.text.slice(0, 200000) : "",
      modelId: typeof message.modelId === "string" ? message.modelId.slice(0, 120) : "",
      modelLabel: typeof message.modelLabel === "string" ? message.modelLabel.slice(0, 120) : "",
    });
  });
})();
