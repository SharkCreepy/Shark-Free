// Smoke tests for the shared Duck.ai and Groq Chat adapters.
// Run with: node test-simple-providers.js
const fs = require("fs");

function fakeElement(tag, text = "", dataset = {}, visible = true) {
  const attributes = {};
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: text ? [{ nodeType: 3, nodeValue: text }] : [],
    dataset,
    value: "",
    disabled: false,
    _visible: visible,
    parentElement: null,
    matches(selector) { return this._matchSet ? this._matchSet.has(selector) : false; },
    closest(selector) { return selector === "#zs-root" ? null : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getAttribute(name) { return attributes[name] || null; },
    setAttribute(name, value) { attributes[name] = String(value); },
    removeAttribute(name) { delete attributes[name]; },
    dispatchEvent() {},
    focus() {},
    click() { if (this._onClick) this._onClick(); },
    getBoundingClientRect() { return this._visible ? { width: 500, height: 50 } : { width: 0, height: 0 }; },
    classList: { add() {}, contains() { return false; } },
  };
  return node;
}
const ok = (name, value) => {
  console.log(`${value ? "PASS" : "FAIL"}  ${name}`);
  if (!value) process.exitCode = 1;
};

function loadProvider(file, config, fixture) {
  const selectorMap = new Map();
  const userItems = [fixture.user];
  const assistantItems = [fixture.assistant];
  fixture.user._matchSet = new Set([config.selectors.userItem, config.selectors.anyItem]);
  fixture.assistant._matchSet = new Set([config.selectors.assistantItem, config.selectors.anyItem]);
  selectorMap.set(config.selectors.userItem, userItems);
  selectorMap.set(config.selectors.assistantItem, assistantItems);
  selectorMap.set(config.selectors.anyItem, [...userItems, ...assistantItems]);
  selectorMap.set(config.selectors.editor, fixture.editors);
  selectorMap.set(config.selectors.composer, fixture.composers || [fixture.composer]);
  selectorMap.set(config.selectors.send, fixture.sendButtons);
  selectorMap.set(config.selectors.stop, []);
  const document = {
    querySelectorAll(selector) { return selectorMap.get(selector) || []; },
    addEventListener() {},
  };
  global.document = document;
  global.Event = class { constructor(type, options) { this.type = type; this.options = options; } };
  global.window = {
    location: { pathname: fixture.path },
    getComputedStyle(el) { return { display: el._visible ? "block" : "none", visibility: "visible" }; },
    HTMLTextAreaElement: class {},
    HTMLInputElement: class {},
  };
  global.location = global.window.location;

  const source = fs.readFileSync(__dirname + "/providers/simple-chat.js", "utf8") +
    "\n" + fs.readFileSync(__dirname + "/providers/" + file, "utf8") +
    "\nreturn ZSProvider;";
  const provider = new Function(source)();
  fixture.userItems = userItems;
  return provider;
}

function fixture() {
  const user = fakeElement("div", "Build a small obby", { messageId: "u-1" });
  const assistant = fakeElement("div", 'Use list_commands before editing. {"command":"list_commands"}', { messageId: "a-1" });
  const editor = fakeElement("textarea");
  const composer = fakeElement("form");
  const send = fakeElement("button");
  send._onClick = () => { editor.value = ""; currentFixture.userItems.push(fakeElement("div", "bootstrap", { messageId: "u-2" })); };
  return { user, assistant, editor, editors: [editor], composer, sendButtons: [send], path: "/" };
}

let currentFixture;
async function run() {
  for (const [file, config, label] of [
    ["duck.js", { id: "duck", displayName: "Duck.ai", selectors: {
      userItem: '[data-testid="user-message"]',
      assistantItem: '[data-activeresponse], [data-testid*="assistant-message"], [role="assistant"]',
      anyItem: '[data-testid="user-message"], [data-activeresponse], [data-testid*="assistant-message"], [role="assistant"]',
      editor: 'textarea[name="user-prompt"], textarea[aria-label*="Ask" i]',
      composer: '[data-testid="duckai-chat-input"]', send: 'button[aria-label="Ask"], button[aria-label*="Ask" i]',
      stop: 'button[aria-label*="Stop generating" i], button[aria-label*="Stop response" i]',
    }, conversationKey: () => "" }, "Duck.ai"],
    ["groq.js", { id: "groq", displayName: "Groq Chat", selectors: {
      userItem: 'div.w-full.flex.flex-col.items-end.group',
      assistantItem: 'div.group.relative[class*="transition-all"]',
      anyItem: 'div.w-full.flex.flex-col.items-end.group, div.group.relative[class*="transition-all"]',
      editor: 'textarea[placeholder="Ask Groq"]',
      composer: 'div:has(> textarea[placeholder="Ask Groq"])',
      send: 'button:has(svg.lucide-arrow-up)', stop: 'button[aria-label*="Stop" i], button[title*="Stop" i]',
    }, conversationKey: () => "" }, "Groq Chat"],
  ]) {
    currentFixture = fixture();
    if (file === "groq.js") {
      currentFixture.editors = [fakeElement("textarea", "", {}, false), currentFixture.editor];
      currentFixture.composers = [fakeElement("form", "", {}, false), currentFixture.composer];
    }
    const P = loadProvider(file, config, currentFixture);
    ok(`${label} provider identity and text-only capability`, P.id === config.id && P.displayName === config.displayName && !P.supportsVision);
    ok(`${label} user and assistant messages are recognized`, P.isUserItem(currentFixture.user) && P.isAssistantItem(currentFixture.assistant));
    ok(`${label} assistant text is readable`, P.readAssistant().reply.includes("list_commands"));
    ok(`${label} injected instruction stays concise`, P.promptExtra.length < 150);
    ok(`${label} visible composer is detected`, P.getEditor() === currentFixture.editor && P.composerFrame() === currentFixture.composer);
    await P.typeAndSend("bootstrap");
    ok(`${label} sends through the site's native control`, P.userCount() === 2 && currentFixture.editor.value === "");
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
