"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");

const main = fs.readFileSync("core/main.js", "utf8");
const config = fs.readFileSync("core/config.js", "utf8");
const parser = fs.readFileSync("core/parser.js", "utf8");
const popup = fs.readFileSync("popup.html", "utf8");
const overlay = fs.readFileSync("overlay.css", "utf8");

assert.match(config, /CLARIFY FIRST:.*Question:.*A\. .*B\./s, "Agent prompt requests a structured question and choices");
assert.match(config, /Plan mode.*Question:.*A\. .*B\./s, "Plan prompt uses the same clarification contract");
assert.match(parser, /function parseClarification\(text\)/, "parser exposes the explicit clarification format");
assert.match(main, /const clarification = ZSParse\.parseClarification\(res\.text \|\| res\.raw \|\| ""\)/, "Agent loop recognizes clarification turns");
assert.match(main, /ui\.showClarificationOptions\(res\.item, clarification, submitClarificationAnswer\)/, "question response gets the choice card");
assert.match(main, /Answer to your question: \$\{value\}/, "selected answers return through the provider composer as a visible user turn");
assert.match(main, /submitAnswer\(\`\$\{option\.label\}\. \$\{option\.text\}\`\)/, "selected option labels are included in the answer");
assert.match(main, /A\.running \|\| A\.starting \|\| A\.toolRunning \|\| P\.isGenerating\(\) \|\| document\.hidden/, "answers are blocked while the provider or agent is busy/hidden");

const clarificationBranch = main.match(/const clarification = ZSParse\.parseClarification\(res\.text \|\| res\.raw \|\| ""\);([\s\S]*?)\/\/ Plan mode never dispatches/s);
assert.ok(clarificationBranch, "clarification guard precedes Plan/tool handling");
assert.match(clarificationBranch[1], /break;/, "question turns stop the loop before tool execution");
assert.doesNotMatch(clarificationBranch[1], /executeCall\(|dispatchTool\(/, "question branch cannot dispatch commands");

assert.match(main, /class="zs-clarification-card"|className = "zs-clarification-card"/, "clarification card has a dedicated class");
assert.match(main, /aria-live", "polite"/, "answer status is announced accessibly");
assert.match(popup, /id="state"/, "popup status element remains compatible with popup.js");
assert.match(popup, /id="reconnect"[\s\S]*id="restart"[\s\S]*id="settings"/, "popup retains bridge, server, and settings controls");
assert.match(popup, /linear-gradient\(145deg, #06101f/, "popup uses the requested navy gradient");
assert.match(overlay, /\.zs-clarification-card[\s\S]*linear-gradient\(145deg, #071426/, "in-chat options use the matching dark gradient");
assert.match(overlay, /:focus-visible/, "choice UI includes keyboard-visible focus states");

console.log("PASS clarification prompt, parsing gate, visible answer flow, popup compatibility, and gradient UI");
