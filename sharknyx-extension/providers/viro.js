// SPDX-License-Identifier: GPL-3.0-or-later
// providers/viro.js - provider adapter for Viro's web chat.
// Viro renders chat turns as .v2-message[data-role] and uses a textarea composer.
// This adapter interacts only with the visible page DOM, not private APIs.
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let diag = () => {};
  let locked = false;
  let hooksInstalled = false;

  const S = {
    anyItem: ".v2-message[data-role]",
    userItem: '.v2-message[data-role="user"]',
    assistantItem: '.v2-message[data-role="assistant"]',
    editor: 'textarea[placeholder="What\'s on your mind today?"]',
    send: 'button[aria-label="Send message"], button[title="Send message"]',
    stop: 'button[aria-label="Stop generating"], button[title="Stop generating"]',
    error: '[role="alert"],[data-sonner-toast],[class*="toast" i],[class*="error" i]',
  };
  const RE = {
    contextLimit: /conversation.{0,30}(too long|limit)|context.{0,30}(limit|exceeded)|maximum.{0,20}context|token.{0,10}limit/i,
    tooLong: /conversation.{0,30}(too long|getting too long)|context.{0,20}(too long|limit)|maximum.{0,20}context/i,
    busy: /temporarily unavailable|try again later|too many requests|rate limit|couldn't reach viro|failed to send/i,
  };
  const timings = {
    GEN_IDLE_MS: 1800,
    REASON_IDLE_MS: 12000,
    WARMUP_MS: 45000,
    REASON_NOREPLY_MS: 90000,
    STABLE_MS: 9000,
    RESPONSE_TIMEOUT_MS: 300000,
  };
  const PROMPT_EXTRA = "Keep replies concise and act only on the user's explicit request. Do not add unrequested features or objects, avoid redundant Roblox commands and routine checks, and stop when the requested task is complete.";
  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*(?:LUA|MCP_TOOL)\s*###/i;
  const BLOCK_TAGS = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "LI", "OL", "P", "PRE", "SECTION", "UL"]);

  function matches(el, selector) {
    if (!el || !selector || !el.matches) return false;
    try { return el.matches(selector); } catch { return false; }
  }
  function textWithout(root, excludeSel) {
    if (!root) return "";
    let text = "";
    const walk = (node) => {
      if (node.nodeType === 3) { text += node.nodeValue || ""; return; }
      if (node.nodeType !== 1) return;
      if (matches(node, ".zs-chip, [data-zs-ui]")) return;
      if (excludeSel && matches(node, excludeSel)) return;
      const tag = node.tagName || "";
      if (tag === "BR") { text += "\n"; return; }
      const block = BLOCK_TAGS.has(tag);
      if (block && text && !text.endsWith("\n")) text += "\n";
      for (const child of node.childNodes || []) walk(child);
      if (block && text && !text.endsWith("\n")) text += "\n";
    };
    walk(root);
    return text.replace(/\r/g, "").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const allItems = () => [...document.querySelectorAll(S.anyItem)];
  const userItems = () => [...document.querySelectorAll(S.userItem)];
  const assistantItems = () => [...document.querySelectorAll(S.assistantItem)];
  const roleOf = (item) => item && (item.getAttribute ? item.getAttribute("data-role") : item.dataset && item.dataset.role);
  const isUserItem = (item) => roleOf(item) === "user";
  const isAssistantItem = (item) => roleOf(item) === "assistant";
  const assistantCount = () => assistantItems().length;
  const userCount = () => userItems().length;
  const itemText = (item) => textWithout(item);
  const classifyText = (item, excludeSel) => textWithout(item, excludeSel);
  const lastAssistant = () => {
    const items = assistantItems();
    return items.length ? items[items.length - 1] : null;
  };
  const lastAssistantId = () => {
    const item = lastAssistant();
    return item ? item.dataset && (item.dataset.messageId || item.dataset.id) || item : null;
  };
  const itemKey = (item) => item ? item.dataset && (item.dataset.messageId || item.dataset.id) || item : null;
  const chatIsEmpty = () => allItems().length === 0;

  function getEditor() {
    const exact = document.querySelector(S.editor);
    if (exact && !exact.closest("#zs-root")) return exact;
    // Keep working if Viro changes its translated placeholder. The chat composer
    // is the only textarea in the message area; ignore inputs in SharkNyx's UI.
    const candidates = [...document.querySelectorAll("textarea")].filter((el) => !el.closest("#zs-root"));
    const byPlaceholder = candidates.find((el) => /what's on your mind today/i.test(el.getAttribute("placeholder") || ""));
    return byPlaceholder || (candidates.length === 1 ? candidates[0] : null);
  }
  const editorText = () => {
    const editor = getEditor();
    return editor ? editor.value || "" : "";
  };
  const composerFrame = () => {
    const editor = getEditor();
    return editor && (editor.closest("form") || editor.parentElement || editor);
  };
  const barMount = () => {
    const frame = composerFrame();
    if (!frame) return null;
    if (frame.parentElement) return { parent: frame.parentElement, before: frame };
    return { parent: frame, before: getEditor() };
  };
  const coverTarget = () => getEditor() || composerFrame();
  const isFreshChat = () => chatIsEmpty() && !!getEditor();
  const streamLen = (item = lastAssistant()) => itemText(item).length;
  let streamMax = -1;
  let streamAt = 0;
  let streamItem = null;
  function sampleStream() {
    const item = lastAssistant();
    const len = streamLen(item);
    const now = Date.now();
    if (item !== streamItem || len < streamMax - 400) {
      streamItem = item; streamMax = len; streamAt = now;
    } else if (len > streamMax) {
      streamMax = len; streamAt = now;
    }
  }
  function stopButton() { return document.querySelector(S.stop); }
  const isHardGenerating = () => !!stopButton();
  function isGenerating() {
    sampleStream();
    return isHardGenerating() || (streamMax > 1 && Date.now() - streamAt < timings.GEN_IDLE_MS);
  }
  const isBusyNow = isGenerating;
  function snapshot() {
    const item = lastAssistant();
    return { th: 0, rp: item ? streamLen(item) : 0 };
  }
  function readAssistant() {
    const item = lastAssistant();
    return item ? { present: true, reply: classifyText(item, ".zs-chip").trim(), thinking: "", item }
      : { present: false, reply: "", thinking: "", item: null };
  }

  function captchaPresent() {
    for (const el of document.querySelectorAll('iframe[src*="captcha" i],[class*="captcha" i]')) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 20 && rect.height > 20 && rect.bottom > 0 && rect.top < innerHeight) return true;
    }
    return false;
  }
  function overlayBlocking() {
    for (const el of document.querySelectorAll('[role="dialog"],[aria-modal="true"]')) {
      if (el.closest("#zs-root") || el.hidden || el.getAttribute("aria-hidden") === "true") continue;
      let style;
      try { style = window.getComputedStyle(el); } catch { style = null; }
      if (style && (style.display === "none" || style.visibility === "hidden")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40 && rect.bottom > 0 && rect.top < innerHeight) return true;
    }
    return false;
  }
  function enforceComposer() { return { ready: !!getEditor() }; }
  async function ensureComposerReady(reason) {
    const ready = !!getEditor() && !overlayBlocking() && !captchaPresent();
    diag("mode_ready", { reason, provider: "viro", ready });
    return { ready };
  }
  function setInputLock(on) {
    locked = !!on;
    const editor = getEditor();
    if (editor) editor.readOnly = locked;
  }

  function setTextareaValue(editor, value) {
    const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(editor, value);
    else editor.value = value;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function waitFor(predicate, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (predicate()) return true;
      await sleep(100);
    }
    return !!predicate();
  }
  const sendButton = () => document.querySelector(S.send);
  const sendReady = () => {
    const button = sendButton();
    return !!button && !button.disabled && (!button.getAttribute || button.getAttribute("aria-disabled") !== "true") && !isHardGenerating();
  };
  async function typeAndSend(text) {
    const editor = getEditor();
    if (!editor) throw new Error("Viro message box not found. Sign in and open a chat.");
    const beforeUsers = userCount();
    const wasLocked = locked;
    if (wasLocked) editor.readOnly = false;
    try {
      editor.focus();
      setTextareaValue(editor, String(text));
      if (!(await waitFor(sendReady, 12000))) throw new Error("Viro send button did not become ready");
      const button = sendButton();
      if (!button) throw new Error("Viro send button disappeared");
      button.click();
      const accepted = await waitFor(() => editorText().trim() === "" || userCount() > beforeUsers || isGenerating(), 10000);
      diag("viro.send", { accepted, editorLen: editorText().length });
      if (!accepted) throw new Error("Viro did not accept the message");
    } finally {
      if (wasLocked) {
        const current = getEditor();
        if (current) current.readOnly = true;
      }
    }
  }
  function stopGeneration() {
    const button = stopButton();
    if (button) { try { button.click(); } catch {} }
  }

  function scanError() {
    for (const el of document.querySelectorAll(S.error)) {
      if (el.closest("#zs-root") || el.closest(S.anyItem)) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (text.length > 8 && text.length < 600 && RE.contextLimit.test(text)) return text.slice(0, 240);
    }
    return getEditor() ? null : "Viro's chat composer is unavailable. Sign in and open a chat.";
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text || "");
  const isBusyMsg = (text) => RE.busy.test(text || "");
  function conversationKey() {
    const path = window.location && window.location.pathname || "";
    const match = path.match(/^\/chat\/([^/?#]+)/);
    if (!match) return "";
    try { return decodeURIComponent(match[1]); } catch { return match[1]; }
  }

  function installSendHooks(handlers) {
    if (hooksInstalled) return;
    hooksInstalled = true;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      const editor = getEditor();
      if (!editor || event.target !== editor || !editorText().trim() || handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (chatIsEmpty()) handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
    document.addEventListener("click", (event) => {
      if (!event.isTrusted) return; // ignore the synthetic clicks used by typeAndSend/stopGeneration
      const target = event.target && event.target.closest && event.target.closest(`${S.send},${S.stop}`);
      if (!target || !getEditor()) return;
      if (matches(target, S.stop) || isHardGenerating()) { handlers.onNativeStop(); return; }
      if (target.disabled || (target.getAttribute && target.getAttribute("aria-disabled") === "true") || !editorText().trim() || handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (chatIsEmpty()) handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
  }

  function findToolBlockSpot(item) {
    if (!item) return null;
    let first = null;
    for (const node of item.querySelectorAll("pre, p")) {
      if (node.closest(".zs-chip, .zs-tool-hide") || !CMD_SHAPE.test(textWithout(node))) continue;
      node.classList.add("zs-tool-hide");
      item.classList.add("zs-cmd-mask");
      if (!first) first = { parent: node.parentElement, ref: node };
    }
    const wholeReply = textWithout(item);
    if (/^\s*(?:\{\s*"(?:command|tool)"\s*:|###\s*(?:LUA|MCP_TOOL)\s*###)/i.test(wholeReply)) {
      item.classList.add("zs-cmd-mask-all");
    }
    return first;
  }
  function chipAnchor(item) { return item; }

  return {
    id: "viro",
    displayName: "Viro",
    supportsVision: false,
    timings,
    reliableCounts: true,
    chipAtItemLevel: true,
    chipAnchor,
    init({ diag: d } = {}) { if (d) diag = d; },
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey,
    readAssistant, streamLen, snapshot,
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barMount,
    coverTarget, coverMaxH: 280,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady, captchaPresent, overlayBlocking,
    turnHalted: () => false,
    findContinueBtn: () => null,
    clickContinueBtn: () => false,
    scanError, isTooLongMsg, isBusyMsg,
    conversationKey, installSendHooks, findToolBlockSpot,
    promptExtra: PROMPT_EXTRA,
  };
})();
