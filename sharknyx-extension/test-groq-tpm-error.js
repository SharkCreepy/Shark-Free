// Run with: node test-groq-tpm-error.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tpmError = "Request too large for model `openai/gpt-oss-120b` in organization `org_example` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 8754, please reduce your message size and try again.";
const alert = { innerText: tpmError, textContent: tpmError, closest() { return null; } };
global.document = {
  querySelectorAll(selector) {
    return selector.includes('role="alert"') || selector.includes("error") || selector.includes("limit") ? [alert] : [];
  },
  addEventListener() {},
};
global.window = { location: { pathname: "/chat" }, getComputedStyle: () => ({ display: "block", visibility: "visible" }) };
global.location = global.window.location;

const extensionDir = path.join(__dirname);
const providerSource = fs.readFileSync(path.join(extensionDir, "providers", "simple-chat.js"), "utf8") +
  "\n" + fs.readFileSync(path.join(extensionDir, "providers", "groq.js"), "utf8") +
  "\nreturn ZSProvider;";
const provider = new Function(providerSource)();
const coreSource = fs.readFileSync(path.join(extensionDir, "core", "main.js"), "utf8");

assert.equal(provider.classifyErrorText(tpmError), "tpm_limit");
assert.equal(provider.scanError(), tpmError, "the Groq TPM error is surfaced from the provider alert");
assert.equal(provider.classifyErrorText("This conversation reached its context limit."), "context_limit");
assert.equal(provider.classifyErrorText("Too many requests; rate limit exceeded."), "", "ordinary account rate limits remain distinct");
assert.match(coreSource, /newReply && P\.classifyErrorText/, "Agent mode classifies an inline error only on the new reply");
assert.match(coreSource, /ctx && String\(ctx\) !== String\(A\.providerErrorBaseline \|\| \"\"\)/, "Agent mode ignores an unchanged old error alert");
assert.match(coreSource, /newTurn && inlineErrorKind/, "Portal Chat classifies inline errors only on the new assistant turn");
assert.match(coreSource, /providerError && String\(providerError\) !== baselineProviderError/, "Portal Chat ignores an unchanged old provider alert");
console.log("Groq TPM error classification and stale-notice guard tests passed.");
