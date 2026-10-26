// Smoke test for providers/ptero.js. Run with: node test-ptero.js
// A small DOM stub keeps this test dependency-free while exercising the
// provider's extraction, conversation-key, command-mask, and send contracts.
const fs = require("fs");

function fakeElement(tag, classes = [], children = [], attrs = {}) {
  const element = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: children.map((child) => typeof child === "string"
      ? { nodeType: 3, nodeValue: child, childNodes: [] }
      : child),
    children: [],
    dataset: { ...(attrs.dataset || {}) },
    title: attrs.title || "",
    disabled: !!attrs.disabled,
    value: attrs.value || "",
    classList: {
      contains: (name) => classes.includes(name),
      add: (name) => { if (!classes.includes(name)) classes.push(name); },
      remove: (name) => { const i = classes.indexOf(name); if (i >= 0) classes.splice(i, 1); },
    },
    matches(selector) {
      return selector.split(",").some((part) => {
        const s = part.trim();
        if (!s) return false;
        if (s.startsWith(".")) return s.slice(1).split(".").every((c) => classes.includes(c));
        return s.toLowerCase() === this.tagName.toLowerCase();
      });
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
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
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, bottom: 0 }),
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    dispatchEvent() {},
    focus() {},
  };
  element.children = element.childNodes.filter((c) => c.nodeType === 1);
  for (const child of element.children) child.parentElement = element;
  return element;
}
function hasClass(node, name) { return node.classList.contains(name); }

const userBody = fakeElement("div", ["chat-msg-text"], [fakeElement("p", [], ["build a small obby"]) ]);
const userItem = fakeElement("div", ["chat-msg", "user"], [userBody], { dataset: { msgId: "u-1" } });
const commandText = '{"command":"execute_luau","params":{"code":"return 1"}}';
const commandPre = fakeElement("pre", [], [fakeElement("code", [], [commandText])]);
const chip = fakeElement("div", ["zs-chip"], ["execute_luau · 1s"]);
const replyBody = fakeElement("div", ["chat-msg-text"], [fakeElement("p", [], ["Running the requested script."]), commandPre, chip]);
const feedback = fakeElement("div", ["chat-feedback-bar"], ["Good response"]);
const content = fakeElement("div", ["chat-msg-content"], [replyBody, feedback]);
const thinkingBody = fakeElement("div", ["chat-thinking-body"], ["Reasoning stays separate from the final answer."]);
const assistantItem = fakeElement("div", ["chat-msg", "assistant"], [thinkingBody, content], { dataset: { msgId: "a-1" } });
const turns = [userItem, assistantItem];
const editor = fakeElement("textarea", [], [], { value: "" });
const send = fakeElement("button", ["chat-send-btn"], [], { title: "Send" });
const overlayNodes = [];
const selectors = {
  "#chat-messages .chat-msg": turns,
  "#chat-messages .chat-msg.user": turns.filter((x) => hasClass(x, "user")),
  "#chat-messages .chat-msg.assistant": turns.filter((x) => hasClass(x, "assistant")),
  'iframe[src*="captcha"], [class*="captcha"]': [],
  '[role="dialog"],[aria-modal="true"],[class*="modal"],[id*="modal"],#chat-welcome-popup,#chat-onboarding-tour': overlayNodes,
  '[role="alert"],.chat-error,[class*="error-message"],[class*="toast"]': [],
};
let activeConversationId = "ptero-chat-123";
global.document = {
  querySelector: (selector) => selector === "#chat-input" ? editor
    : selector === "#chat-input-area" ? fakeElement("div")
      : selector === "#chat-send-btn" ? send
        : selector === "#chat-messages" ? fakeElement("div")
          : selector === ".chat-conv-item.active" ? null : null,
  querySelectorAll: (selector) => selectors[selector] || [],
  addEventListener() {},
};
global.window = {
  localStorage: { getItem: (key) => key === "mlp_ai_chat_active_conversation" ? activeConversationId : null },
  getComputedStyle: () => ({ display: "none", visibility: "visible" }),
};
global.innerHeight = 1000;
global.Event = class { constructor(type, options) { this.type = type; this.options = options; } };

const P = new Function(fs.readFileSync(__dirname + "/providers/ptero.js", "utf8") + "; return ZSProvider;")();
const ok = (name, condition) => {
  console.log((condition ? "PASS" : "FAIL") + "  " + name);
  if (!condition) process.exitCode = 1;
};

ok("provider identity and text-only capability", P.id === "ptero" && P.displayName === "Ptero.pro" && P.supportsVision === false);
ok("Ptero user and assistant turns are recognized", P.isUserItem(userItem) && P.isAssistantItem(assistantItem));
ok("message extraction preserves code and excludes SharkNyx UI", P.itemText(assistantItem).includes(commandText) && !P.itemText(assistantItem).includes("execute_luau · 1s"));
ok("stable Ptero message id is exposed", P.lastAssistantId() === "a-1" && P.itemKey(assistantItem) === "a-1");
const assistantState = P.readAssistant();
ok("Ptero reasoning is extracted separately from the final reply", assistantState.thinking.includes("Reasoning stays separate") && !assistantState.reply.includes("Reasoning stays separate"));
ok("Ptero reasoning contributes to live stream activity", P.isGenerating());
ok("Ptero requests concise, exact-scope answers", /explanations brief/i.test(P.promptExtra) && /do not add unrequested/i.test(P.promptExtra));
const assistantSelector = "#chat-messages .chat-msg.assistant";
const savedAssistantItems = selectors[assistantSelector];
const thinkingOnlyItem = fakeElement("div", ["chat-msg", "assistant"], [fakeElement("details", ["chat-thinking"], [fakeElement("div", ["chat-thinking-body"], ["Still reasoning."])])], { dataset: { msgId: "a-thinking" } });
selectors[assistantSelector] = [thinkingOnlyItem];
const thinkingOnlyState = P.readAssistant();
ok("thinking-only Ptero output is not mistaken for a final answer", !thinkingOnlyState.reply && thinkingOnlyState.thinking === "Still reasoning.");
ok("thinking-only Ptero output still counts as active stream content", P.isGenerating());
selectors[assistantSelector] = savedAssistantItems;
ok("Ptero local conversation id is used", P.conversationKey() === "ptero-chat-123");
activeConversationId = null;
ok("a fresh Ptero chat has an empty conversation key", P.conversationKey() === "");
const spot = P.findToolBlockSpot(assistantItem);
ok("agent command blocks are hidden and the reply marked", !!spot && replyBody.classList.contains("zs-cmd-mask") && commandPre.classList.contains("zs-tool-hide"));
const bareBody = fakeElement("div", ["chat-msg-text"], [fakeElement("p", [], ['{"command":"execute_luau","params":{}}'])]);
const bareItem = fakeElement("div", ["chat-msg", "assistant"], [fakeElement("div", ["chat-msg-content"], [bareBody])], { dataset: { msgId: "a-2" } });
P.findToolBlockSpot(bareItem);
ok("unfenced command replies receive persistent whole-reply masking", bareBody.classList.contains("zs-cmd-mask-all"));
ok("assistant snapshot reflects current reply length", P.snapshot().rp === P.itemText(assistantItem).length);
const eofNotice = "The response stream ended before the provider returned a final answer. Please retry this message.";
const eofItem = fakeElement("div", ["chat-msg", "assistant"], [fakeElement("div", ["chat-msg-content"], [fakeElement("div", ["chat-msg-text"], [eofNotice])])]);
ok("Ptero's exact stream-ended notice is recognized", P.streamError(eofItem) === eofNotice);
const partialNote = fakeElement("div", ["chat-stopped-note"], [eofNotice]);
const partialItem = fakeElement("div", ["chat-msg", "assistant"], [fakeElement("div", ["chat-msg-content"], [fakeElement("div", ["chat-msg-text"], [commandText, partialNote])])]);
ok("Ptero stream failure is recognized even after partial output", !!P.streamError(partialItem));

// The Ptero send button clears the composer and appends a new user turn when
// clicked, matching the app's observed acceptance signal.
send.click = () => {
  editor.value = "";
  const newUser = fakeElement("div", ["chat-msg", "user"], [fakeElement("div", ["chat-msg-text"], ["test message"])], { dataset: { msgId: "u-2" } });
  turns.push(newUser);
  selectors["#chat-messages .chat-msg.user"] = turns.filter((x) => hasClass(x, "user"));
};
(async () => {
  await P.typeAndSend("test message");
  ok("typeAndSend dispatches and confirms a Ptero send", editor.value === "" && P.userCount() === 2);
})();
