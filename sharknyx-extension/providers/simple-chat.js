// SPDX-License-Identifier: GPL-3.0-or-later
// Shared DOM adapter for simple text-chat sites (Duck.ai and Groq Chat).
// Site-specific selectors and chat identity are supplied by each thin adapter.
var ZSSimpleChat = (() => {
  "use strict";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const BLOCK_TAGS = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "LI", "OL", "P", "PRE", "SECTION", "UL"]);
  const CMD_SHAPE = /\"(?:command|tool)\"\s*:\s*\"|###\s*(?:LUA|MCP_TOOL)\s*###/i;
  const RE = {
    contextLimit: /conversation.{0,30}(too long|limit)|context.{0,30}(limit|exceeded)|maximum.{0,20}context|token.{0,10}limit|start.{0,20}new.{0,20}chat/i,
    tooLong: /conversation.{0,30}(too long|getting too long)|context.{0,20}(too long|limit)|maximum.{0,20}context/i,
    busy: /temporarily unavailable|try again later|too many requests|rate limit|something went wrong/i,
  };
  const timings = {
    GEN_IDLE_MS: 1800,
    REASON_IDLE_MS: 12000,
    WARMUP_MS: 45000,
    REASON_NOREPLY_MS: 90000,
    STABLE_MS: 9000,
    RESPONSE_TIMEOUT_MS: 300000,
  };
  const PROMPT_EXTRA = "Use brief, plain language. Do only what the user asked, use the fewest necessary commands, and stop when done.";

  function matches(el, selector) {
    if (!el || !selector || !el.matches) return false;
    try { return el.matches(selector); } catch { return false; }
  }
  function queryAll(selector, root = document) {
    if (!selector || !root || !root.querySelectorAll) return [];
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  }
  function visible(el) {
    if (!el || el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    try {
      const style = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && r.width > 0 && r.height > 0;
    } catch { return true; }
  }

  function create(config) {
    const S = config.selectors;
    let diag = () => {};
    let locked = false;
    let hooksInstalled = false;
    let streamItem = null;
    let streamMax = -1;
    let streamAt = 0;

    function textWithout(root, excludeSel) {
      if (!root) return "";
      let text = "";
      const walk = (node) => {
        if (node.nodeType === 3) { text += node.nodeValue || ""; return; }
        if (node.nodeType !== 1) return;
        if (matches(node, "#zs-root, .zs-chip, .zs-tool-hide, button, svg, .chat-feedback-bar")) return;
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

    const getEditor = () => {
      const editors = queryAll(S.editor).filter((el) => !el.closest || !el.closest("#zs-root"));
      return editors.find(visible) || editors[0] || null;
    };
    const editorText = () => {
      const editor = getEditor();
      return editor ? (typeof editor.value === "string" ? editor.value : editor.innerText || editor.textContent || "") : "";
    };
    const allItems = () => queryAll(S.anyItem).filter((el) => !el.closest || !el.closest("#zs-root"));
    const userItems = () => queryAll(S.userItem).filter((el) => !el.closest || !el.closest("#zs-root"));
    const assistantItems = () => queryAll(S.assistantItem).filter((el) => !el.closest || !el.closest("#zs-root"));
    const isUserItem = (item) => matches(item, S.userItem);
    const isAssistantItem = (item) => matches(item, S.assistantItem);
    const assistantCount = () => assistantItems().length;
    const userCount = () => userItems().length;
    const chatIsEmpty = () => allItems().length === 0;
    const isFreshChat = () => chatIsEmpty() && !!getEditor();
    const bodyOf = (item) => item && (S.reply ? item.querySelector(S.reply) || item : item);
    const itemText = (item) => textWithout(bodyOf(item));
    const classifyText = (item, excludeSel) => textWithout(bodyOf(item), excludeSel);
    const lastAssistant = () => { const items = assistantItems(); return items.length ? items[items.length - 1] : null; };
    const lastAssistantId = () => {
      const item = lastAssistant();
      return item ? item.dataset && (item.dataset.messageId || item.dataset.id) || item : null;
    };
    const itemKey = (item) => item ? item.dataset && (item.dataset.messageId || item.dataset.id) || item : null;
    const streamLen = (item = lastAssistant()) => itemText(item).length;

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
    const stopButton = () => queryAll(S.stop).find((el) =>
      (!el.closest || !el.closest("#zs-root")) && visible(el)) || null;
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

    const composerFrame = () => {
      const editor = getEditor();
      const frames = S.composer ? queryAll(S.composer).filter((el) => !el.closest || !el.closest("#zs-root")) : [];
      return frames.find(visible) || frames[0] ||
        (editor && (editor.closest("form") || editor.closest("fieldset") || editor.parentElement)) || editor;
    };
    const barAnchor = () => composerFrame();
    const coverTarget = () => getEditor() || composerFrame();
    const captchaPresent = () => queryAll('iframe[src*="captcha" i], [class*="captcha" i]').some(visible);
    function overlayBlocking() {
      return queryAll('[role="dialog"], [aria-modal="true"]').some((el) =>
        !el.closest("#zs-root") && visible(el));
    }
    function enforceComposer() { return { ready: !!getEditor() }; }
    async function ensureComposerReady(reason) {
      const ready = !!getEditor() && !overlayBlocking() && !captchaPresent();
      diag("mode_ready", { reason, provider: config.id, ready });
      return { ready };
    }
    function setInputLock(on) {
      locked = !!on;
      const editor = getEditor();
      if (!editor) return;
      if ("readOnly" in editor) editor.readOnly = locked;
      else editor.setAttribute("contenteditable", locked ? "false" : "true");
    }

    function setEditorText(editor, text) {
      editor.focus();
      if ("value" in editor && (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT")) {
        const Ctor = editor.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
        const setter = Ctor && Object.getOwnPropertyDescriptor(Ctor.prototype, "value");
        if (setter && setter.set) setter.set.call(editor, text);
        else editor.value = text;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (document.execCommand) {
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
        const lines = String(text).split("\n");
        lines.forEach((line, index) => {
          if (line) document.execCommand("insertText", false, line);
          if (index < lines.length - 1) document.execCommand("insertLineBreak", false, null);
        });
      } else editor.textContent = text;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    async function waitFor(predicate, timeoutMs) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await sleep(100);
      }
      return !!predicate();
    }
    const sendButton = () => {
      const buttons = queryAll(S.send).filter((el) => !el.closest || !el.closest("#zs-root"));
      return buttons.find((el) => visible(el) && !el.disabled) || buttons.find(visible) || buttons[0] || null;
    };
    const sendReady = () => {
      const button = sendButton();
      return !!button && !button.disabled && button.getAttribute("aria-disabled") !== "true" && !isHardGenerating();
    };
    async function typeAndSend(text) {
      const editor = getEditor();
      if (!editor) throw new Error(`${config.displayName} input box not found`);
      const wasLocked = locked;
      const beforeUsers = userCount();
      if (wasLocked) setInputLock(false);
      try {
        setEditorText(editor, String(text));
        if (!(await waitFor(sendReady, 15000))) throw new Error(`${config.displayName} send button did not become ready`);
        const button = sendButton();
        if (!button) throw new Error(`${config.displayName} send button disappeared`);
        button.click();
        const accepted = await waitFor(() => userCount() > beforeUsers || !editorText().trim() || isGenerating(), 10000);
        if (!accepted) throw new Error(`${config.displayName} did not accept the message`);
      } finally {
        if (wasLocked) setInputLock(true);
      }
    }
    function stopGeneration() { const button = stopButton(); if (button) { try { button.click(); } catch {} } }

    function scanError() {
      for (const el of queryAll(S.error || '[role="alert"], [class*="error" i]')) {
        if (el.closest("#zs-root") || allItems().some((item) => item.contains(el))) continue;
        const text = (el.innerText || el.textContent || "").trim();
        if (text.length > 8 && text.length < 600 && RE.contextLimit.test(text)) return text.slice(0, 240);
      }
      return getEditor() ? null : `The ${config.displayName} input box disappeared (session ended?).`;
    }
    const isTooLongMsg = (text) => RE.tooLong.test(text || "");
    const isBusyMsg = (text) => RE.busy.test(text || "");

    function installSendHooks(handlers) {
      if (hooksInstalled) return;
      hooksInstalled = true;
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        const editor = getEditor();
        if (!editor || event.target !== editor || !editorText().trim() || handlers.isBlocked()) return;
        if (!handlers.isStarted()) { if (chatIsEmpty()) handlers.onBlockedAttempt(); return; }
        handlers.onUserMessage(assistantCount());
      }, true);
      document.addEventListener("click", (event) => {
        const control = event.target && event.target.closest && event.target.closest(S.send + (S.stop ? `,${S.stop}` : ""));
        if (!control || !getEditor()) return;
        if (matches(control, S.stop) || isHardGenerating()) { handlers.onNativeStop(); return; }
        if (control.disabled || !editorText().trim() || handlers.isBlocked()) return;
        if (!handlers.isStarted()) { if (chatIsEmpty()) handlers.onBlockedAttempt(); return; }
        handlers.onUserMessage(assistantCount());
      }, true);
    }

    function findToolBlockSpot(item) {
      const body = bodyOf(item);
      if (!body) return null;
      let first = null;
      for (const node of queryAll("pre, p, code", body)) {
        if (node.closest(".zs-chip, .zs-tool-hide") || !CMD_SHAPE.test(textWithout(node))) continue;
        node.classList.add("zs-tool-hide");
        body.classList.add("zs-cmd-mask");
        if (!first) first = { parent: node.parentElement, ref: node };
      }
      if (/^\s*(?:\{\s*\"(?:command|tool)\"\s*:|###\s*(?:LUA|MCP_TOOL)\s*###)/i.test(textWithout(body))) {
        body.classList.add("zs-cmd-mask-all");
      }
      return first;
    }

    const conversationKey = () => config.conversationKey ? config.conversationKey() : "";
    const turnHalted = () => false;
    return {
      id: config.id,
      displayName: config.displayName,
      supportsVision: false,
      timings,
      reliableCounts: true,
      chipAtItemLevel: true,
      chipAppend: true,
      chipAnchor: (item) => bodyOf(item) || item,
      chipTrailRef: (item) => item.querySelector("[data-message-actions]") || null,
      init({ diag: d } = {}) { if (d) diag = d; },
      allItems, isUserItem, isAssistantItem, itemText, classifyText,
      assistantCount, userCount, lastAssistant, lastAssistantId, itemKey,
      readAssistant, streamLen, snapshot,
      getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor,
      coverTarget, coverMaxH: 260,
      setInputLock, typeAndSend, stopGeneration,
      isGenerating, isBusyNow, isHardGenerating,
      enforceComposer, ensureComposerReady, captchaPresent, overlayBlocking,
      turnHalted, findContinueBtn: () => null, clickContinueBtn: () => false,
      scanError, isTooLongMsg, isBusyMsg,
      conversationKey, installSendHooks, findToolBlockSpot,
      promptExtra: PROMPT_EXTRA,
    };
  }

  return { create };
})();
