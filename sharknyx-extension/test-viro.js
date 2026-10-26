// Smoke test for providers/viro.js. Run with: node test-viro.js
const fs = require("fs");
const path = require("path");

function fakeElement(tag, classes = [], children = [], attrs = {}) {
  const element = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: children.map((child) => typeof child === "string"
      ? { nodeType: 3, nodeValue: child, childNodes: [] }
      : child),
    children: [],
    dataset: { ...(attrs.dataset || {}) },
    attributes: { ...(attrs.attributes || {}) },
    value: attrs.value || "",
    placeholder: attrs.placeholder || "",
    disabled: !!attrs.disabled,
    title: attrs.title || "",
    classList: {
      contains: (name) => classes.includes(name),
      add: (name) => { if (!classes.includes(name)) classes.push(name); },
      remove: (name) => { const i = classes.indexOf(name); if (i >= 0) classes.splice(i, 1); },
    },
    getAttribute(name) {
      if (name === "data-role") return this.dataset.role || null;
      if (name === "placeholder") return this.placeholder || null;
      if (name === "aria-label") return this.attributes["aria-label"] || null;
      if (name === "aria-disabled") return this.attributes["aria-disabled"] || null;
      return this.attributes[name] || null;
    },
    matches(selector) {
      return selector.split(",").some((part) => {
        const s = part.trim();
        if (!s) return false;
        const tagMatch = s.match(/^[a-z]+/i);
        if (tagMatch && tagMatch[0].toUpperCase() !== this.tagName) return false;
        const idMatch = s.match(/#([\w-]+)/);
        if (idMatch && this.attributes.id !== idMatch[1]) return false;
        const classMatches = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
        if (!classMatches.every((c) => classes.includes(c))) return false;
        for (const [, name, value] of s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
          const actual = this.getAttribute(name);
          if (value == null ? actual == null : actual !== value) return false;
        }
        return true;
      });
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const found = [];
      const visit = (parent) => {
        for (const child of parent.childNodes || []) {
          if (child.nodeType !== 1) continue;
          child.parentElement = parent;
          if (child.matches(selector)) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    },
    closest(selector) {
      let node = this;
      while (node) {
        if (node.matches && node.matches(selector)) return node;
        node = node.parentElement;
      }
      return null;
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    dispatchEvent() {},
    focus() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, bottom: 0 }),
  };
  element.children = element.childNodes.filter((c) => c.nodeType === 1);
  for (const child of element.children) child.parentElement = element;
  return element;
}
const hasClass = (node, name) => node.classList.contains(name);

const userItem = fakeElement("div", ["v2-message"], [fakeElement("p", [], ["build a small obby"])], { dataset: { role: "user", messageId: "u-1" } });
const commandText = '{"command":"execute_luau","params":{"code":"return 1"}}';
const commandPre = fakeElement("pre", [], [fakeElement("code", [], [commandText])]);
const chip = fakeElement("div", ["zs-chip"], ["execute_luau · 1s"]);
const assistantItem = fakeElement("div", ["v2-message"], [fakeElement("p", [], ["Running the requested script."]), commandPre, chip], { dataset: { role: "assistant", messageId: "a-1" } });
let turns = [userItem, assistantItem];
const editor = fakeElement("textarea", [], [], { placeholder: "What's on your mind today?", value: "" });
const send = fakeElement("button", [], [], { attributes: { "aria-label": "Send message" } });
let stop = null;
const S = {
  anyItem: ".v2-message[data-role]",
  userItem: '.v2-message[data-role="user"]',
  assistantItem: '.v2-message[data-role="assistant"]',
  editor: 'textarea[placeholder="What\'s on your mind today?"]',
  send: 'button[aria-label="Send message"], button[title="Send message"]',
  stop: 'button[aria-label="Stop generating"], button[title="Stop generating"]',
  error: '[role="alert"],[data-sonner-toast],[class*="toast" i],[class*="error" i]',
};
const emptySelectors = new Set([
  'iframe[src*="captcha" i],[class*="captcha" i]',
  '[role="dialog"],[aria-modal="true"]',
  S.error,
]);
global.document = {
  querySelector(selector) {
    if (selector === S.editor) return editor;
    if (selector === "textarea") return editor;
    if (selector === S.send) return send;
    if (selector === S.stop) return stop;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === S.anyItem) return turns;
    if (selector === S.userItem) return turns.filter((item) => item.dataset.role === "user");
    if (selector === S.assistantItem) return turns.filter((item) => item.dataset.role === "assistant");
    if (selector === "textarea") return [editor];
    if (emptySelectors.has(selector)) return [];
    return [];
  },
  addEventListener() {},
};
function HTMLTextAreaElement() {}
Object.defineProperty(HTMLTextAreaElement.prototype, "value", { set(value) { this.value = value; } });
global.window = { HTMLTextAreaElement, location: { pathname: "/chat/viro-chat-123" }, getComputedStyle: () => ({ display: "none", visibility: "visible" }) };
global.innerHeight = 1000;
global.Event = class { constructor(type, options) { this.type = type; this.options = options; } };

const P = new Function(fs.readFileSync(path.join(__dirname, "providers/viro.js"), "utf8") + "; return ZSProvider;")();
const ok = (name, condition) => {
  console.log((condition ? "PASS" : "FAIL") + "  " + name);
  if (!condition) process.exitCode = 1;
};

ok("provider identity and conservative text-only capability", P.id === "viro" && P.displayName === "Viro" && P.supportsVision === false);
ok("Viro user and assistant turns are recognized by data-role", P.isUserItem(userItem) && P.isAssistantItem(assistantItem));
ok("assistant text extraction preserves code and excludes SharkNyx chips", P.itemText(assistantItem).includes(commandText) && !P.itemText(assistantItem).includes("execute_luau · 1s"));
ok("Viro's stable message id is exposed", P.lastAssistantId() === "a-1" && P.itemKey(assistantItem) === "a-1");
ok("message counts and active response are read", P.userCount() === 1 && P.assistantCount() === 1 && P.readAssistant().reply.includes("Running the requested script."));
ok("chat route supplies per-conversation identity", P.conversationKey() === "viro-chat-123");
window.location.pathname = "/chat";
ok("new chat route has no prior conversation identity", P.conversationKey() === "");
window.location.pathname = "/chat/viro-chat-123";
ok("the visible Viro composer is detected", P.getEditor() === editor);
ok("Viro asks for concise exact-scope Roblox actions", /concise/i.test(P.promptExtra) && /unrequested/i.test(P.promptExtra));
const spot = P.findToolBlockSpot(assistantItem);
ok("command code is hidden and the streamed message is persistently marked", !!spot && hasClass(commandPre, "zs-tool-hide") && hasClass(assistantItem, "zs-cmd-mask"));
const bare = fakeElement("div", ["v2-message"], [fakeElement("p", [], ['{"command":"execute_luau","params":{}}'])], { dataset: { role: "assistant" } });
P.findToolBlockSpot(bare);
ok("unfenced command-only replies are masked as a whole turn", hasClass(bare, "zs-cmd-mask-all"));
stop = fakeElement("button", [], [], { attributes: { "aria-label": "Stop generating" } });
ok("Viro's documented stop control is detected as active generation", P.isHardGenerating() && P.isGenerating());
stop = null;

send.click = () => {
  editor.value = "";
  turns = turns.concat(fakeElement("div", ["v2-message"], [fakeElement("p", [], ["build a small obby"])], { dataset: { role: "user", messageId: "u-2" } }));
};
(async () => {
  const readiness = await P.ensureComposerReady("test");
  ok("Viro reports the logged-in composer as ready", readiness.ready);
  await P.typeAndSend("test message");
  ok("typeAndSend inserts text and confirms the appended user turn", editor.value === "" && P.userCount() === 2);
})().catch((error) => { console.error(error); process.exitCode = 1; });
