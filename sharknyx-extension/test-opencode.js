// Smoke tests for the OpenCode web-UI adapter.
// Run with: node test-opencode.js
//
// The fixtures mirror the DOM observed on OpenCode 2.3.0's web UI: a user turn,
// an assistant message split into a reasoning part and a text part that share
// data-message-id, the markdown body slot, and the composer whose submit button
// doubles as Stop while a turn runs.
const fs = require("fs");

function textNode(value) {
  return { nodeType: 3, nodeValue: value };
}

function el(tag, options = {}) {
  const attributes = { ...(options.attrs || {}) };
  const children = options.children || [];
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: children,
    parentElement: null,
    disabled: !!options.disabled,
    hidden: false,
    _matches: options.matches || new Set(),
    _query: options.query || new Map(),
    matches(selector) { return this._matches.has(selector); },
    closest(selector) { return selector === "#zs-root" ? null : null; },
    querySelector(selector) { return (this._query.get(selector) || [])[0] || null; },
    querySelectorAll(selector) { return this._query.get(selector) || []; },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
    setAttribute(name, value) { attributes[name] = String(value); },
    removeAttribute(name) { delete attributes[name]; },
    dispatchEvent() {},
    focus() { this._focused = true; },
    click() { if (this._onClick) this._onClick(); },
    getBoundingClientRect() { return { width: 480, height: 44, top: 100, bottom: 144 }; },
    classList: { add() {}, remove() {}, contains() { return false; } },
  };
  for (const child of children) if (child && child.nodeType === 1) child.parentElement = node;
  return node;
}

const ok = (name, value) => {
  console.log(`${value ? "PASS" : "FAIL"}  ${name}`);
  if (!value) process.exitCode = 1;
};

const S = {
  anyItem: '[data-timeline-row="UserMessage"], [data-timeline-row="AssistantPart"]',
  userItem: '[data-timeline-row="UserMessage"]',
  assistantItem: '[data-timeline-row="AssistantPart"]',
  userBody: '[data-slot="user-message-text"]',
  reply: '[data-slot="text-part-body"]',
  editor: 'div[contenteditable="true"][role="textbox"]',
  composer: 'form, [data-component="composer"]',
  send: 'button[data-action="composer-submit"]',
  pending: '[data-slot="user-message-pending"]',
  error: '[data-timeline-row="Error"], [role="alert"]',
};

function buildFixture() {
  const state = { users: [], generating: false, sent: 0 };

  const userBody = el("div", {
    matches: new Set([S.userBody]),
    children: [textNode("Build a small obby")],
  });
  const userRow = el("div", {
    attrs: { "data-message-id": "msg-user-1", "data-timeline-row": "UserMessage" },
    matches: new Set([S.userItem, S.anyItem]),
    children: [userBody],
    query: new Map([[S.userBody, [userBody]]]),
  });

  // Reasoning part: same message id, no text-part body.
  const reasoningRow = el("div", {
    attrs: { "data-message-id": "msg-assistant-1", "data-timeline-row": "AssistantPart" },
    matches: new Set([S.assistantItem, S.anyItem]),
  });

  // Text part: markdown body plus a meta footer that must not leak into the reply.
  const replyBody = el("div", {
    matches: new Set([S.reply]),
    children: [textNode('Use list_commands first. {"command":"list_commands"}')],
  });
  const meta = el("span", { children: [textNode("Build · Beam Free · 1s · 838.7 tok/s")] });
  const textRow = el("div", {
    attrs: { "data-message-id": "msg-assistant-1", "data-timeline-row": "AssistantPart" },
    matches: new Set([S.assistantItem, S.anyItem]),
    children: [replyBody, meta],
    query: new Map([[S.reply, [replyBody]]]),
  });

  const editor = el("div", { attrs: { contenteditable: "true", role: "textbox" }, matches: new Set([S.editor]) });
  const composer = el("form", { matches: new Set(), children: [editor] });
  editor.parentElement = composer;

  const send = el("button", {
    attrs: { "data-action": "composer-submit", "aria-label": "Send" },
    matches: new Set([S.send]),
  });
  send._onClick = () => {
    state.sent += 1;
    editor.textContent = "";
    state.users.push(el("div", {
      attrs: { "data-message-id": `msg-user-${state.users.length + 2}`, "data-timeline-row": "UserMessage" },
      matches: new Set([S.userItem, S.anyItem]),
    }));
  };

  const selectorMap = new Map([
    [S.userItem, [userRow]],
    [S.assistantItem, [reasoningRow, textRow]],
    [S.anyItem, [userRow, reasoningRow, textRow]],
    [S.editor, [editor]],
    [S.send, [send]],
    [S.pending, []],
    [S.error, []],
    [S.reply, [replyBody]],
  ]);

  const document = {
    title: "OpenCode",
    documentElement: { dataset: { theme: "oc-2" } },
    body: { appendChild() {} },
    querySelectorAll(selector) {
      if (selector === S.userItem) return [userRow, ...state.users];
      if (selector === S.assistantItem) return [reasoningRow, textRow];
      if (selector === S.anyItem) return [userRow, ...state.users, reasoningRow, textRow];
      if (selector === S.send) return [send];
      if (selector === S.pending) return [];
      return selectorMap.get(selector) || [];
    },
    addEventListener() {},
    execCommand(command) {
      if (command === "delete") editor.textContent = "";
      if (command === "insertText") editor.textContent += arguments[2] || "";
      return true;
    },
    createElement(tag) { return el(tag); },
    getElementById() { return null; },
  };

  global.document = document;
  global.Event = class { constructor(type, options) { this.type = type; this.options = options; } };
  global.window = {
    location: { hostname: "127.0.0.1", pathname: "/server/aHR0cA/session/ses_abc123", search: "" },
    getComputedStyle() { return { display: "block", visibility: "visible" }; },
  };
  global.location = global.window.location;

  return { state, send, editor, userRow, textRow, reasoningRow };
}

function loadProvider() {
  const source = fs.readFileSync(__dirname + "/providers/opencode.js", "utf8") + "\nreturn { ZSProvider, ZSOpenCodePage };";
  return new Function(source)();
}

async function run() {
  const fixture = buildFixture();
  const { ZSProvider: P, ZSOpenCodePage } = loadProvider();

  ok("activates only on the OpenCode page", ZSOpenCodePage === true);
  ok("provider identity and text-only capability",
    P.id === "opencode" && P.displayName === "OpenCode" && P.supportsVision === false);

  ok("user and assistant parts are recognized",
    P.isUserItem(fixture.userRow) && P.isAssistantItem(fixture.textRow) && P.isAssistantItem(fixture.reasoningRow));

  ok("assistant parts sharing an id count as one turn", P.assistantCount() === 1 && P.userCount() === 1);

  const reply = P.readAssistant().reply;
  ok("reply text is read from the markdown body", reply.includes('{"command":"list_commands"}'));
  ok("turn metadata is excluded from the reply", !/tok\/s|Beam Free/.test(reply));
  ok("last assistant id is stable across parts", P.lastAssistantId() === "msg-assistant-1");

  ok("composer is detected", P.getEditor() === fixture.editor && P.composerFrame() === fixture.editor.parentElement);

  // isGenerating() also treats recently-changed text as "still streaming" for a
  // short settle window, so the hard signal is the stable contract to assert.
  ok("idle turn is not hard-generating", P.isHardGenerating() === false);
  fixture.send.setAttribute("aria-label", "Stop");
  ok("a Stop-labelled submit button means generating",
    P.isHardGenerating() === true && P.isGenerating() === true);
  fixture.send.setAttribute("aria-label", "Send");
  ok("idle again once the button reads Send", P.isHardGenerating() === false);

  await P.typeAndSend("bootstrap");
  ok("sends through the native submit control", fixture.state.sent === 1 && P.userCount() === 2);

  ok("injected instruction stays concise", P.promptExtra.length < 150);

  ok("session key comes from the session path", P.conversationKey() === "ses_abc123");

  // A local page that is not OpenCode must not activate.
  const other = buildFixture();
  global.document.title = "Vite + React";
  global.document.documentElement.dataset.theme = "";
  global.window.location.pathname = "/dashboard";
  global.window.location.search = "";
  const reloaded = loadProvider();
  ok("stays inactive on an unrelated localhost page", reloaded.ZSOpenCodePage === false);
  ok("fixture still usable after guard check", other.state.sent === 0);
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
