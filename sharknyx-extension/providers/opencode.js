// SPDX-License-Identifier: GPL-3.0-or-later
// providers/opencode.js - provider adapter for the OpenCode web UI.
//
// OpenCode (https://github.com/anomalyco/opencode) ships a browser UI served by
// its own local server (opencode serve / opencode pair), normally at
// http://127.0.0.1:<port>. Unlike the hosted chat sites, the same origin is
// shared by every other local app, so this adapter only activates when the page
// really is OpenCode: the server-rendered shell always sets the OpenCode title
// and the `oc-*` theme id on <html>. Every other localhost page is left
// untouched (main.js returns immediately when ZS_OPENCODE_PAGE is false).
//
// DOM contract observed on OpenCode 2.3.0 (web UI, session view):
//   [data-timeline-row="UserMessage"]      user turn (text in [data-slot="user-message-text"])
//   [data-timeline-row="AssistantPart"]    one assistant part; a message can have
//                                          several (reasoning, text, tools) that share
//                                          data-message-id, so reply text is gathered
//                                          from all rows of the newest id
//   [data-component="text-part"]           assistant prose; [data-slot="text-part-body"]
//                                          holds the markdown, the copy/meta footer sits
//                                          in a sibling [data-slot="text-part-copy-wrapper"]
//   div[contenteditable="true"][role="textbox"]   composer
//   button[data-action="composer-submit"]  Send; the same button becomes "Stop" while
//                                          a turn is running
//   [data-timeline-row="Error"]            provider/agent error row

// Manifest match patterns cannot carry a port, so this adapter is injected into
// every localhost page. The OpenCode server always renders a title of "OpenCode"
// and an `oc-*` theme id on <html>, which lets us tell it apart before core/main.js
// builds any UI. core/main.js returns immediately when this flag is false.
const ZSOpenCodePage = (() => {
  try {
    const host = window.location && window.location.hostname;
    if (!(host === "127.0.0.1" || host === "localhost" || host === "::1")) return false;
    const root = document.documentElement;
    const themed = !!(root && root.dataset && /^oc-/.test(root.dataset.theme || ""));
    const titled = /opencode/i.test(document.title || "");
    const path = (window.location && window.location.pathname) || "";
    const routed = /^\/(?:new-session|server|session)\b/.test(path);
    return themed || titled || routed;
  } catch {
    return false;
  }
})();
if (typeof window !== "undefined") window.__ZS_OPENCODE_PAGE__ = ZSOpenCodePage;

// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let diag = () => {};
  let locked = false;
  let hooksInstalled = false;

  const S = {
    anyItem: '[data-timeline-row="UserMessage"], [data-timeline-row="AssistantPart"]',
    userItem: '[data-timeline-row="UserMessage"]',
    assistantItem: '[data-timeline-row="AssistantPart"]',
    userBody: '[data-slot="user-message-text"]',
    textPart: '[data-component="text-part"]',
    reply: '[data-slot="text-part-body"]',
    editor: 'div[contenteditable="true"][role="textbox"]',
    composer: 'form, [data-component="composer"]',
    send: 'button[data-action="composer-submit"]',
    error: '[data-timeline-row="Error"], [role="alert"]',
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
  const PROMPT_EXTRA = "Keep visible explanations brief. Do not add unrequested features. Use the fewest necessary commands and stop when done.";
  const BLOCK_TAGS = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "LI", "OL", "P", "PRE", "SECTION", "UL"]);
  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*(?:LUA|MCP_TOOL)\s*###/i;

  function matches(el, selector) {
    if (!el || !selector || !el.matches) return false;
    try { return el.matches(selector); } catch { return false; }
  }
  function queryAll(selector, root = document) {
    if (!selector || !root || !root.querySelectorAll) return [];
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  }
  const ours = (el) => !!(el && el.closest && el.closest("#zs-root"));
  function visible(el) {
    if (!el || el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    try {
      const style = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && r.width > 0 && r.height > 0;
    } catch { return true; }
  }

  // Preserve Markdown/code line breaks while dropping buttons, icons and our own UI.
  function textWithout(root, excludeSel) {
    if (!root) return "";
    let text = "";
    const walk = (node) => {
      if (node.nodeType === 3) { text += node.nodeValue || ""; return; }
      if (node.nodeType !== 1) return;
      if (matches(node, "#zs-root, .zs-chip, .zs-tool-hide, button, svg, [data-slot=\"user-message-menu\"], [data-slot=\"text-part-copy-wrapper\"], [data-slot=\"user-message-copy-wrapper\"]")) return;
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

  const allItems = () => queryAll(S.anyItem).filter((el) => !ours(el));
  const userItems = () => queryAll(S.userItem).filter((el) => !ours(el));
  const assistantItems = () => queryAll(S.assistantItem).filter((el) => !ours(el));
  const isUserItem = (item) => matches(item, S.userItem);
  const isAssistantItem = (item) => matches(item, S.assistantItem);
  const userCount = () => userItems().length;
  const messageId = (item) => (item && item.getAttribute ? item.getAttribute("data-message-id") || null : null);
  const itemKey = (item) => messageId(item);

  // One assistant message can be split across several rows that share an id.
  function assistantIds() {
    const ids = [];
    for (const item of assistantItems()) {
      const id = messageId(item);
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }
  const assistantCount = () => assistantIds().length;
  const lastAssistantId = () => {
    const ids = assistantIds();
    return ids.length ? ids[ids.length - 1] : null;
  };
  const lastAssistant = () => {
    const items = assistantItems();
    if (!items.length) return null;
    const id = lastAssistantId();
    const sameMessage = id ? items.filter((item) => messageId(item) === id) : items;
    const withText = sameMessage.filter((item) => item.querySelector(S.reply));
    return (withText.length ? withText : sameMessage).slice(-1)[0] || null;
  };
  const userText = (item) => {
    const body = item && item.querySelector(S.userBody);
    return textWithout(body || item);
  };
  const assistantText = (item) => {
    if (!item) return "";
    const bodies = queryAll(S.reply, item);
    if (!bodies.length) return "";
    return bodies.map((body) => textWithout(body)).filter(Boolean).join("\n\n").trim();
  };
  function assistantReplyText(id = lastAssistantId()) {
    if (!id) return "";
    const rows = assistantItems().filter((item) => messageId(item) === id);
    return rows.map((row) => assistantText(row)).filter(Boolean).join("\n\n").trim();
  }
  const itemText = (item) => (isUserItem(item) ? userText(item) : assistantText(item));
  const classifyText = (item, excludeSel) => {
    const body = isUserItem(item) ? item && item.querySelector(S.userBody) : item && item.querySelector(S.reply);
    return textWithout(body || item, excludeSel);
  };
  const chatIsEmpty = () => allItems().length === 0;
  const getEditor = () => queryAll(S.editor).filter((el) => !ours(el)).find(visible)
    || queryAll(S.editor).filter((el) => !ours(el))[0] || null;
  const editorText = () => {
    const editor = getEditor();
    return editor ? (typeof editor.value === "string" ? editor.value : editor.innerText || editor.textContent || "") : "";
  };
  const isFreshChat = () => chatIsEmpty() && !!getEditor();
  const composerFrame = () => {
    const editor = getEditor();
    if (!editor) return null;
    return editor.closest("form") || editor.closest(S.composer) || editor.parentElement || editor;
  };
  const barAnchor = () => composerFrame();
  const coverTarget = () => getEditor() || composerFrame();

  function streamLen(item = lastAssistant()) {
    return assistantText(item).length;
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

  const submitButton = () => queryAll(S.send).filter((el) => !ours(el)).find(visible) || null;
  const isStopLabel = (button) => !!button && /stop/i.test(button.getAttribute("aria-label") || "");
  // The in-flight marker ([data-slot="user-message-pending"]) is left behind in
  // the DOM after a turn finishes, so it can never be used as a live signal.
  // The submit button's label is the only reliable one: "Stop" while running.
  function isGenerating() {
    sampleStream();
    return isStopLabel(submitButton()) || (streamMax > 1 && Date.now() - streamAt < timings.GEN_IDLE_MS);
  }
  const isHardGenerating = () => isStopLabel(submitButton());
  const isBusyNow = isGenerating;

  function snapshot() {
    const item = lastAssistant();
    return { th: 0, rp: item ? streamLen(item) : 0 };
  }
  function readAssistant() {
    const item = lastAssistant();
    return item
      ? { present: true, reply: assistantReplyText().trim(), thinking: "", item }
      : { present: false, reply: "", thinking: "", item: null };
  }

  const turnHalted = () => false;
  const findContinueBtn = () => null;
  const clickContinueBtn = () => false;
  const modeWarning = () => "";
  const captchaPresent = () => false;
  function overlayBlocking() {
    return queryAll('[role="dialog"], [aria-modal="true"]').some((el) => !ours(el) && visible(el));
  }

  function enforceComposer() {
    const editor = getEditor();
    if (!editor) return { ready: false };
    if (locked) editor.setAttribute("contenteditable", "false");
    else editor.setAttribute("contenteditable", "true");
    return { ready: true };
  }
  async function ensureComposerReady(reason) {
    const ready = !!getEditor() && !overlayBlocking();
    diag("mode_ready", { reason, provider: "opencode", ready });
    return { ready };
  }
  function setInputLock(on) {
    locked = !!on;
    const editor = getEditor();
    if (!editor) return;
    editor.setAttribute("contenteditable", locked ? "false" : "true");
  }

  function setEditorText(editor, text) {
    editor.focus();
    if (document.execCommand) {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      const lines = String(text).split("\n");
      lines.forEach((line, index) => {
        if (line) document.execCommand("insertText", false, line);
        if (index < lines.length - 1) document.execCommand("insertLineBreak", false, null);
      });
    } else {
      editor.textContent = text;
    }
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
    if (!editor) throw new Error("OpenCode composer not found");
    const wasLocked = locked;
    const beforeUsers = userCount();
    if (wasLocked) setInputLock(false);
    try {
      setEditorText(editor, String(text));
      const ready = await waitFor(() => {
        const button = submitButton();
        return !!button && !button.disabled && !isHardGenerating();
      }, 15000);
      if (!ready) throw new Error("OpenCode send button did not become ready");
      const button = submitButton();
      if (!button) throw new Error("OpenCode send button disappeared");
      button.click();
      const accepted = await waitFor(() => userCount() > beforeUsers || isGenerating() || !editorText().trim(), 15000);
      diag("opencode.send", { accepted, editorLen: editorText().length });
      if (!accepted) throw new Error("OpenCode did not accept the message");
    } finally {
      if (wasLocked) setInputLock(true);
    }
  }
  function stopGeneration() {
    const button = submitButton();
    if (isStopLabel(button)) { try { button.click(); } catch {} }
  }

  function scanError() {
    for (const el of queryAll(S.error)) {
      if (ours(el)) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (text.length > 8 && text.length < 800) return text.slice(0, 400);
    }
    return getEditor() ? null : "The OpenCode composer disappeared (session ended?).";
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text || "");
  const isBusyMsg = (text) => RE.busy.test(text || "");
  const streamError = () => null;

  // Session identity: /server/<base64>/session/<id>, or the unsent draft id.
  function conversationKey() {
    const path = (window.location && window.location.pathname) || "";
    const session = path.match(/\/session\/([^/?#]+)/);
    if (session) return session[1];
    const draft = (window.location && window.location.search || "").match(/[?&]draftId=([^&#]+)/);
    return draft ? draft[1] : "";
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
      if (isStopLabel(button)) { handlers.onNativeStop(); return; }
      if (button.disabled || !editorText().trim() || handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (chatIsEmpty()) handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
  }

  // Hide agent command blocks from the visible transcript.
  function findToolBlockSpot(item) {
    if (!item) return null;
    let first = null;
    for (const node of queryAll("pre, p, code", item)) {
      if (node.closest(".zs-chip, .zs-tool-hide") || !CMD_SHAPE.test(textWithout(node))) continue;
      node.classList.add("zs-tool-hide");
      if (item.classList) item.classList.add("zs-cmd-mask");
      if (!first) first = { parent: node.parentElement, ref: node };
    }
    return first;
  }
  const chipAnchor = (item) => (item && (item.querySelector(S.reply) || item)) || item;
  const chipTrailRef = () => null;

  return {
    id: "opencode",
    displayName: "OpenCode",
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
    scanError, isTooLongMsg, isBusyMsg, streamError,
    conversationKey, installSendHooks, findToolBlockSpot,
    promptExtra: PROMPT_EXTRA,
  };
})();
