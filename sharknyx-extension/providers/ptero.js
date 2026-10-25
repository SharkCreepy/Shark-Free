// SPDX-License-Identifier: GPL-3.0-or-later
// providers/ptero.js - provider adapter for Ptero.pro.
// Ptero's public app uses a plain textarea composer and keeps chats locally.
// The core remains provider-agnostic; this file translates its interface to
// Ptero's message, send, stop, and conversation elements.
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let diag = () => {};
  let locked = false;
  let hooksInstalled = false;

  const S = {
    list: "#chat-messages",
    anyItem: "#chat-messages .chat-msg",
    userItem: "#chat-messages .chat-msg.user",
    assistantItem: "#chat-messages .chat-msg.assistant",
    reply: ".chat-msg-text",
    editor: "#chat-input",
    composer: "#chat-input-area",
    send: "#chat-send-btn",
    error: '[role="alert"],.chat-error,[class*="error-message"],[class*="toast"]',
  };
  const RE = {
    contextLimit: /context.{0,20}(limit|exceeded)|conversation.{0,20}(too long|limit)|maximum.{0,20}context|token.{0,10}limit/i,
    tooLong: /conversation.{0,20}(too long|getting too long)|context.{0,20}(too long|limit)|maximum.{0,20}context/i,
    busy: /temporarily (unavailable|disabled)|try again later|rate limit|too many requests|something went wrong/i,
  };
  const timings = {
    GEN_IDLE_MS: 1800,
    REASON_IDLE_MS: 12000,
    WARMUP_MS: 45000,
    REASON_NOREPLY_MS: 90000,
    STABLE_MS: 9000,
    RESPONSE_TIMEOUT_MS: 300000,
  };

  function matches(el, selector) {
    if (!el || !selector || !el.matches) return false;
    try { return el.matches(selector); } catch { return false; }
  }

  // Preserve Markdown/code line breaks while excluding SharkNyx's injected UI.
  function textWithout(root, excludeSel) {
    if (!root) return "";
    let text = "";
    const blocks = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "LI", "OL", "P", "PRE", "SECTION", "UL"]);
    const walk = (node) => {
      if (node.nodeType === 3) { text += node.nodeValue || ""; return; }
      if (node.nodeType !== 1) return;
      if (matches(node, ".zs-chip, .chat-msg-edit-inline, .chat-feedback-bar")) return;
      if (excludeSel && matches(node, excludeSel)) return;
      const tag = node.tagName || "";
      if (tag === "BR") { text += "\n"; return; }
      const block = blocks.has(tag);
      if (block && text && !text.endsWith("\n")) text += "\n";
      for (const child of node.childNodes || []) walk(child);
      if (block && text && !text.endsWith("\n")) text += "\n";
    };
    walk(root);
    return text.replace(/\r/g, "").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const allItems = () => [...document.querySelectorAll(S.anyItem)];
  const assistantItems = () => [...document.querySelectorAll(S.assistantItem)];
  const isUserItem = (item) => !!item && item.classList.contains("user");
  const isAssistantItem = (item) => !!item && item.classList.contains("assistant");
  const assistantCount = () => assistantItems().length;
  const userCount = () => document.querySelectorAll(S.userItem).length;
  const bodyOf = (item) => item && item.querySelector(S.reply);
  const itemText = (item) => textWithout(bodyOf(item));
  const classifyText = (item, excludeSel) => textWithout(bodyOf(item), excludeSel);
  const lastAssistant = () => {
    const items = assistantItems();
    return items.length ? items[items.length - 1] : null;
  };
  const lastAssistantId = () => {
    const item = lastAssistant();
    return item && item.dataset ? item.dataset.msgId || null : null;
  };
  const itemKey = (item) => item && item.dataset ? item.dataset.msgId || null : null;
  const chatIsEmpty = () => allItems().length === 0;
  const getEditor = () => {
    const editor = document.querySelector(S.editor);
    return editor && !editor.closest("#zs-root") ? editor : null;
  };
  const editorText = () => {
    const editor = getEditor();
    return editor ? editor.value || "" : "";
  };
  const isFreshChat = () => chatIsEmpty() && !!getEditor();
  const composerFrame = () => document.querySelector(S.composer) || getEditor();
  const barAnchor = () => composerFrame();
  const coverTarget = () => getEditor() || composerFrame();

  function streamLen(item = lastAssistant()) {
    return itemText(item).length;
  }
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
  function stopButton() {
    const button = document.querySelector(S.send);
    if (!button) return null;
    if (button.classList.contains("is-stop") || button.title === "Stop generating") return button;
    const icon = button.querySelector(".chat-icon-stop");
    if (icon) {
      try {
        const style = window.getComputedStyle(icon);
        if (style.display !== "none" && style.visibility !== "hidden") return button;
      } catch {}
    }
    return null;
  }
  function isGenerating() {
    sampleStream();
    return !!stopButton() || (streamMax > 1 && Date.now() - streamAt < timings.GEN_IDLE_MS);
  }
  const isHardGenerating = () => !!stopButton();
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
  const turnHalted = () => false;
  const findContinueBtn = () => null;
  const clickContinueBtn = () => false;
  const modeWarning = () => "";
  const captchaPresent = () => {
    for (const el of document.querySelectorAll('iframe[src*="captcha"], [class*="captcha"]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 20 && r.bottom > 0 && r.top < innerHeight) return true;
    }
    return false;
  };
  function overlayBlocking() {
    for (const el of document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal"],[id*="modal"],#chat-welcome-popup,#chat-onboarding-tour')) {
      if (el.closest("#zs-root") || el.hidden || el.getAttribute("aria-hidden") === "true" || el.getAttribute("data-hidden") === "1") continue;
      let style;
      try { style = window.getComputedStyle(el); } catch { style = null; }
      if (style && (style.display === "none" || style.visibility === "hidden")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40 && r.bottom > 0 && r.top < innerHeight) return true;
    }
    return false;
  }

  function enforceComposer() {
    const editor = getEditor();
    if (editor && locked) editor.setAttribute("readonly", "");
    else if (editor) editor.removeAttribute("readonly");
    return { ready: !!editor };
  }
  async function ensureComposerReady(reason) {
    const ready = !!getEditor() && !overlayBlocking() && !captchaPresent();
    diag("mode_ready", { reason, provider: "ptero", ready });
    return { ready };
  }
  function setInputLock(on) {
    locked = !!on;
    const editor = getEditor();
    if (editor) {
      if (locked) editor.setAttribute("readonly", "");
      else editor.removeAttribute("readonly");
    }
  }

  function setTextareaValue(editor, value) {
    const setter = window.HTMLTextAreaElement && Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
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
  async function typeAndSend(text) {
    const editor = getEditor();
    const button = document.querySelector(S.send);
    if (!editor) throw new Error("Ptero.pro message box not found");
    if (!button) throw new Error("Ptero.pro send button not found");
    const beforeUsers = userCount();
    editor.focus();
    setTextareaValue(editor, String(text));
    const ready = await waitFor(() => {
      const send = document.querySelector(S.send);
      return !!send && !send.disabled && !isHardGenerating();
    }, 10000);
    if (!ready) throw new Error("Ptero.pro send button did not become ready");
    document.querySelector(S.send).click();
    const accepted = await waitFor(() => editorText().trim() === "" || userCount() > beforeUsers, 3500);
    diag("ptero.send", { accepted, editorLen: editorText().length });
    if (!accepted) throw new Error("Ptero.pro did not accept the message");
  }
  function stopGeneration() {
    const button = stopButton();
    if (button) { try { button.click(); } catch {} }
  }

  function scanError() {
    const list = document.querySelector(S.list);
    for (const el of document.querySelectorAll(S.error)) {
      if (el.closest("#zs-root") || (list && list.contains(el))) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (text.length > 8 && text.length < 600 && RE.contextLimit.test(text)) return text.slice(0, 240);
    }
    return getEditor() ? null : "The Ptero.pro input box disappeared (session ended?).";
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text || "");
  const isBusyMsg = (text) => RE.busy.test(text || "");

  // Ptero keeps the selected local conversation id in localStorage; the active
  // sidebar row is a fallback. A blank new chat returns an empty key.
  function conversationKey() {
    try {
      const id = window.localStorage && window.localStorage.getItem("mlp_ai_chat_active_conversation");
      if (id) return id;
    } catch {}
    const active = document.querySelector(".chat-conv-item.active");
    return active && active.dataset ? active.dataset.id || "" : "";
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
      const button = event.target && event.target.closest && event.target.closest(S.send);
      if (!button || !getEditor()) return;
      if (isHardGenerating()) { handlers.onNativeStop(); return; }
      if (button.disabled || !editorText().trim() || handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (chatIsEmpty()) handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
  }

  // Hide agent command blocks from the visible transcript. The assistant turn
  // survives Ptero's stream updates, so the CSS rule can keep recreated <pre>
  // blocks hidden after the provider marks the turn.
  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*(?:LUA|MCP_TOOL)\s*###/i;
  function findToolBlockSpot(item) {
    const body = bodyOf(item);
    if (!body) return null;
    let first = null;
    for (const node of body.querySelectorAll("pre, p")) {
      if (node.closest(".zs-chip, .zs-tool-hide")) continue;
      if (!CMD_SHAPE.test(textWithout(node))) continue;
      node.classList.add("zs-tool-hide");
      body.classList.add("zs-cmd-mask");
      if (!first) first = { parent: node.parentElement, ref: node };
    }
    const wholeReply = textWithout(body);
    if (/^\s*(?:\{\s*"(?:command|tool)"\s*:|###\s*(?:LUA|MCP_TOOL)\s*###)/i.test(wholeReply)) {
      body.classList.add("zs-cmd-mask-all");
    }
    return first;
  }
  const chipAnchor = (item) => item.querySelector(".chat-msg-content") || item;
  const chipTrailRef = (item) => item.querySelector(".chat-feedback-bar");

  return {
    id: "ptero",
    displayName: "Ptero.pro",
    supportsVision: false,
    timings,
    reliableCounts: true,
    chipAtItemLevel: true,
    chipAppend: true,
    chipAnchor,
    chipTrailRef,
    init({ diag: d } = {}) { if (d) diag = d; },
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey,
    readAssistant, streamLen, snapshot,
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor,
    coverTarget, coverMaxH: 220,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady, modeWarning, captchaPresent, overlayBlocking,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg,
    conversationKey, installSendHooks, findToolBlockSpot,
  };
})();
