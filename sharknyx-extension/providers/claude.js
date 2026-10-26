// SPDX-License-Identifier: GPL-3.0-or-later
// providers/claude.js - provider adapter for Claude.ai.
// Claude uses ProseMirror for its composer and marks assistant response
// containers with data-is-streaming while a turn is being generated.
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let diag = () => {};
  let locked = false;
  let hooksInstalled = false;

  const S = {
    userItem: '[data-testid="user-message"]',
    assistantItem: "[data-is-streaming]",
    anyItem: '[data-testid="user-message"], [data-is-streaming]',
    streaming: '[data-is-streaming="true"]',
    content: ".font-claude-response, .font-claude-message, .prose",
    editor: "div.ProseMirror[contenteditable], [contenteditable][data-placeholder]",
    send: 'button[aria-label="Send message"], button[aria-label*="Send" i]',
    stop: 'button[aria-label*="Stop" i], button[title*="Stop" i]',
    error: '[role="alert"],[data-testid*="error" i],[class*="toast" i],[class*="error" i]',
  };
  const RE = {
    contextLimit: /conversation.{0,30}(too long|limit)|context.{0,30}(limit|exceeded)|maximum.{0,20}context|token.{0,10}limit|start.{0,20}new.{0,20}chat/i,
    tooLong: /conversation.{0,30}(too long|getting too long)|context.{0,20}(too long|limit)|maximum.{0,20}context/i,
    busy: /something went wrong|try again later|temporarily unavailable|too many requests|rate limit/i,
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
  const CMD_SHAPE = /\"(?:command|tool)\"\s*:\s*\"|###\s*(?:LUA|MCP_TOOL)\s*###/i;
  const BLOCK_TAGS = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "LI", "OL", "P", "PRE", "SECTION", "UL"]);

  function matches(el, selector) {
    if (!el || !selector || !el.matches) return false;
    try { return el.matches(selector); } catch { return false; }
  }

  // Preserve paragraph/code line breaks while excluding SharkNyx's injected UI.
  function textWithout(root, excludeSel) {
    if (!root) return "";
    let text = "";
    const walk = (node) => {
      if (node.nodeType === 3) { text += node.nodeValue || ""; return; }
      if (node.nodeType !== 1) return;
      if (matches(node, ".zs-chip, .chat-feedback-bar")) return;
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
  const assistantItems = () => [...document.querySelectorAll(S.assistantItem)];
  const isUserItem = (item) => matches(item, S.userItem);
  const isAssistantItem = (item) => matches(item, S.assistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => document.querySelectorAll(S.userItem).length;
  const contentOf = (item) => {
    if (!item) return null;
    return matches(item, S.content) ? item : item.querySelector(S.content) || item;
  };
  const itemText = (item) => textWithout(contentOf(item));
  const classifyText = (item, excludeSel) => textWithout(contentOf(item), excludeSel);
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
  const getEditor = () => {
    const editor = document.querySelector(S.editor);
    return editor && !editor.closest("#zs-root") ? editor : null;
  };
  const editorText = () => textWithout(getEditor());
  const isFreshChat = () => chatIsEmpty() && !!getEditor();
  const composerFrame = () => {
    const editor = getEditor();
    return editor && (editor.closest("fieldset") || editor);
  };
  const barAnchor = () => composerFrame();
  const coverTarget = () => getEditor() || composerFrame();

  function streamLen(item = lastAssistant()) { return itemText(item).length; }
  let streamMax = -1;
  let streamAt = 0;
  let streamItem = null;
  let streamGrowing = false;
  function sampleStream() {
    const item = lastAssistant();
    const len = streamLen(item);
    const now = Date.now();
    if (item !== streamItem || len < streamMax - 400) {
      streamItem = item; streamMax = len; streamAt = now; streamGrowing = false;
    } else if (len > streamMax) {
      streamMax = len; streamAt = now; streamGrowing = true;
    }
  }
  const stopButton = () => document.querySelector(S.stop);
  const isHardGenerating = () => !!document.querySelector(S.streaming) || !!stopButton();
  function isGenerating() {
    sampleStream();
    return isHardGenerating() || (streamGrowing && Date.now() - streamAt < timings.GEN_IDLE_MS);
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
    diag("mode_ready", { reason, provider: "claude", ready });
    return { ready };
  }
  function setInputLock(on) {
    locked = !!on;
    const editor = getEditor();
    if (editor) editor.setAttribute("contenteditable", locked ? "false" : "true");
  }

  function selectAll(editor) {
    editor.focus();
    if (document.execCommand) {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  async function typeEditorText(editor, text) {
    selectAll(editor);
    const lines = String(text).split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) document.execCommand("insertText", false, lines[i]);
      if (i < lines.length - 1) document.execCommand("insertLineBreak", false, null);
      if (i && i % 80 === 0) await sleep(0);
    }
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function waitFor(pred, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (pred()) return true;
      await sleep(100);
    }
    return false;
  }
  const sendButton = () => document.querySelector(S.send);
  const sendReady = () => {
    const button = sendButton();
    return !!button && !button.disabled && button.getAttribute("aria-disabled") !== "true";
  };
  async function typeAndSend(text) {
    const editor = getEditor();
    if (!editor) throw new Error("Claude input box not found");
    const relock = locked;
    const beforeUsers = userCount();
    if (relock) editor.setAttribute("contenteditable", "true");
    try {
      await typeEditorText(editor, text);
      if (!(await waitFor(sendReady, 15000))) throw new Error("Claude send button did not become ready");
      const button = sendButton();
      if (!button) throw new Error("Claude send button disappeared");
      button.click();
      const accepted = await waitFor(() => userCount() > beforeUsers || !editorText().trim() || isGenerating(), 10000);
      if (!accepted) throw new Error("Claude did not accept the message");
    } finally {
      if (relock) {
        const current = getEditor();
        if (current) current.setAttribute("contenteditable", "false");
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
    return null;
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text || "");
  const isBusyMsg = (text) => RE.busy.test(text || "");
  function conversationKey() {
    const match = (window.location && window.location.pathname || "").match(/^\/chat\/([^/?#]+)/);
    return match ? match[1] : "";
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
      const control = event.target && event.target.closest && event.target.closest(`${S.send},${S.stop}`);
      if (!control || !getEditor()) return;
      if (matches(control, S.stop) || isHardGenerating()) { handlers.onNativeStop(); return; }
      if (control.disabled || control.getAttribute("aria-disabled") === "true" || !editorText().trim() || handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (chatIsEmpty()) handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
  }

  // Hide streamed command blocks across Claude's re-renders.
  function findToolBlockSpot(item) {
    const body = contentOf(item);
    if (!body) return null;
    let first = null;
    for (const node of body.querySelectorAll("pre, p")) {
      if (node.closest(".zs-chip, .zs-tool-hide") || !CMD_SHAPE.test(textWithout(node))) continue;
      node.classList.add("zs-tool-hide");
      body.classList.add("zs-cmd-mask");
      if (!first) first = { parent: node.parentElement, ref: node };
    }
    const wholeReply = textWithout(body);
    if (/^\s*(?:\{\s*"(?:command|tool)"\s*:|###\s*(?:LUA|MCP_TOOL)\s*###)/i.test(wholeReply)) body.classList.add("zs-cmd-mask-all");
    return first;
  }
  const chipAnchor = (item) => contentOf(item) || item;
  const chipTrailRef = (item) => item.querySelector('div[role="group"][aria-label="Message actions"]');

  return {
    id: "claude",
    displayName: "Claude",
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
