// Smoke test for providers/claude.js. Run with: node test-claude.js
// The fixture models documented Claude message, streaming, and ProseMirror nodes.
const fs = require("fs");

function fakeElement(tag, classes = [], children = [], attrs = {}) {
  const data = { ...(attrs.data || {}) };
  const elementAttrs = { ...(attrs.attributes || {}) };
  const element = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: [],
    parentElement: null,
    dataset: { ...(attrs.dataset || {}) },
    disabled: !!attrs.disabled,
    value: "",
    classList: {
      contains: (name) => classes.includes(name),
      add: (name) => { if (!classes.includes(name)) classes.push(name); },
      remove: (name) => { const i = classes.indexOf(name); if (i >= 0) classes.splice(i, 1); },
    },
    matches(selector) {
      return selector.split(",").some((raw) => {
        const s = raw.trim();
        if (!s) return false;
        const tagMatch = /^([a-z][a-z0-9-]*)/i.exec(s);
        if (tagMatch && tagMatch[1].toUpperCase() !== this.tagName) return false;
        const idMatch = /#([\w-]+)/.exec(s);
        if (idMatch && elementAttrs.id !== idMatch[1]) return false;
        for (const m of s.matchAll(/\.([\w-]+)/g)) if (!classes.includes(m[1])) return false;
        const testId = /\[data-testid=["']([^"']+)["']\]/.exec(s);
        if (testId && elementAttrs["data-testid"] !== testId[1]) return false;
        const streamValue = /\[data-is-streaming=["']([^"']+)["']\]/.exec(s);
        if (streamValue && elementAttrs["data-is-streaming"] !== streamValue[1]) return false;
        if (/\[data-is-streaming\]/.test(s) && elementAttrs["data-is-streaming"] == null) return false;
        if (/\[contenteditable\]/.test(s) && elementAttrs.contenteditable == null) return false;
        if (/\[contenteditable=["']true["']\]/.test(s) && elementAttrs.contenteditable !== "true") return false;
        if (/\[data-placeholder\]/.test(s) && elementAttrs["data-placeholder"] == null) return false;
        const ariaLabel = /\[aria-label=["']([^"']+)["']\]/.exec(s);
        if (ariaLabel && elementAttrs["aria-label"] !== ariaLabel[1]) return false;
        if (s.includes("[aria-label*=")) {
          const m = /\[aria-label\*=["']([^"']+)["']\s*i?\]/i.exec(s);
          if (m && !(elementAttrs["aria-label"] || "").toLowerCase().includes(m[1].toLowerCase())) return false;
        }
        const title = /\[title\*=["']([^"']+)["']\s*i?\]/i.exec(s);
        if (title && !(elementAttrs.title || "").toLowerCase().includes(title[1].toLowerCase())) return false;
        if (s.includes(":not([disabled])") && this.disabled) return false;
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
    getAttribute(name) { return elementAttrs[name] == null ? null : elementAttrs[name]; },
    setAttribute(name, value) { elementAttrs[name] = String(value); },
    removeAttribute(name) { delete elementAttrs[name]; },
    dispatchEvent() {},
    focus() {},
    getBoundingClientRect: () => ({ width: 500, height: 60, top: 10, bottom: 70 }),
  };
  element.childNodes = children.map((child) => typeof child === "string"
    ? { nodeType: 3, nodeValue: child, parentElement: element }
    : child);
  for (const child of element.childNodes) if (child.nodeType === 1) child.parentElement = element;
  return element;
}
function setText(element, text) {
  element.childNodes = text ? [{ nodeType: 3, nodeValue: text, parentElement: element }] : [];
}

const user = fakeElement("div", [], [fakeElement("p", [], ["Make a small obby"])], {
  attributes: { "data-testid": "user-message" }, dataset: { messageId: "u-1" },
});
const code = fakeElement("pre", [], [fakeElement("code", [], ['{"command":"execute_luau","params":{"code":"return 1"}}'])]);
const replyRoot = fakeElement("div", ["font-claude-response", "prose"], [fakeElement("p", [], ["I will make the requested obby."]), code]);
const assistant = fakeElement("div", [], [replyRoot], {
  attributes: { "data-is-streaming": "false" }, dataset: { messageId: "a-1" },
});
const turns = [user, assistant];
const editor = fakeElement("div", ["ProseMirror"], [], { attributes: { contenteditable: "true", "data-placeholder": "Reply to Claude" } });
const fileInput = fakeElement("input", [], [], { attributes: { type: "file", accept: "image/*" } });
fileInput.files = [];
const form = fakeElement("form", [], [editor, fileInput]);
fileInput.dispatchEvent = () => {
  if (!form.querySelector("img")) {
    const preview = fakeElement("img");
    preview.parentElement = form;
    form.childNodes.push(preview);
  }
};
const send = fakeElement("button", [], [], { attributes: { "aria-label": "Send message" } });
const controls = [send];
const allSelector = '[data-testid="user-message"], [data-is-streaming]';
const userSelector = '[data-testid="user-message"]';
const assistantSelector = "[data-is-streaming]";
const selectors = {
  [allSelector]: turns,
  [userSelector]: [user],
  [assistantSelector]: [assistant],
  '[role="alert"],[data-testid*="error" i],[class*="toast" i],[class*="error" i]': [],
  'iframe[src*="captcha" i],[class*="captcha" i]': [],
  '[role="dialog"],[aria-modal="true"]': [],
};
global.innerHeight = 1000;
global.location = { pathname: "/chat/claude-chat-123" };
global.Event = class { constructor(type, options) { this.type = type; this.options = options; } };
global.File = class { constructor(parts, name, options = {}) { this.parts = parts; this.name = name; this.type = options.type || ""; } };
global.DataTransfer = class {
  constructor() {
    this._files = [];
    const self = this;
    this.items = { add(file) { self._files.push(file); }, get length() { return self._files.length; } };
  }
  get files() { return this._files; }
};
global.document = {
  querySelector(selector) {
    if (selector === "div.ProseMirror[contenteditable], [contenteditable][data-placeholder]") return editor;
    if (selector === 'input[type="file"][accept*="image" i]' || selector === 'input[type="file"]') return fileInput;
    if (selector === 'button[aria-label="Send message"], button[aria-label*="Send" i]') return controls.find((c) => c === send) || null;
    if (selector === 'button[aria-label*="Stop" i], button[title*="Stop" i]') return controls.find((c) => c !== send) || null;
    if (selector === '[data-is-streaming="true"]') return turns.find((item) => item.getAttribute("data-is-streaming") === "true") || null;
    return null;
  },
  querySelectorAll(selector) { return selectors[selector] || []; },
  addEventListener() {},
  execCommand(command, _ui, value) {
    const current = editor.childNodes.map((n) => n.nodeValue || "").join("");
    if (command === "selectAll") return true;
    if (command === "delete") { setText(editor, ""); return true; }
    if (command === "insertText") { setText(editor, current + value); return true; }
    if (command === "insertLineBreak") { setText(editor, current + "\n"); return true; }
    return true;
  },
  createRange: () => ({ selectNodeContents() {} }),
};
global.window = {
  location: global.location,
  getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
};

const P = new Function(fs.readFileSync(__dirname + "/providers/claude.js", "utf8") + "; return ZSProvider;")();
const ok = (name, condition) => {
  console.log((condition ? "PASS" : "FAIL") + "  " + name);
  if (!condition) process.exitCode = 1;
};

ok("provider identity and screenshot vision capability", P.id === "claude" && P.displayName === "Claude" && P.supportsVision === true);
ok("Claude user and assistant turns are recognized", P.isUserItem(user) && P.isAssistantItem(assistant));
ok("Claude reply extraction preserves prose and code", P.itemText(assistant).includes("requested obby") && P.itemText(assistant).includes('"command"'));
ok("Claude message ID and conversation URL are exposed", P.lastAssistantId() === "a-1" && P.conversationKey() === "claude-chat-123");
ok("Claude streaming attribute is a strong generation signal", !P.isGenerating());
assistant.setAttribute("data-is-streaming", "true");
ok("active Claude stream is detected", P.isGenerating() && P.isHardGenerating());
assistant.setAttribute("data-is-streaming", "false");
const spot = P.findToolBlockSpot(assistant);
ok("command code block is marked for camouflage", !!spot && code.classList.contains("zs-tool-hide") && replyRoot.classList.contains("zs-cmd-mask"));
ok("provider requests concise, exact-scope output", /concise/i.test(P.promptExtra) && /unrequested features/i.test(P.promptExtra));
global.location.pathname = "/new";
ok("new Claude chat has no conversation identity", P.conversationKey() === "");

send.click = () => {
  setText(editor, "");
  const nextUser = fakeElement("div", [], [fakeElement("p", [], ["bootstrap"])], { attributes: { "data-testid": "user-message" }, dataset: { messageId: "u-2" } });
  turns.push(nextUser);
  selectors[allSelector] = turns;
  selectors[userSelector] = [...selectors[userSelector], nextUser];
};
(async () => {
  await P.typeAndSend("bootstrap\nsecond line", [{ data: "aGk=", mimeType: "image/png" }]);
  ok("ProseMirror text is submitted and accepted", editor.childNodes.length === 0 && P.userCount() === 2);
  ok("captured screenshot is staged through the Claude file input", fileInput.files.length === 1 && form.querySelectorAll("img").length === 1);
})();
