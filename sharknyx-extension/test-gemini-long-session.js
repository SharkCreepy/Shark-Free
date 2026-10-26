// Regression test for Gemini long-session instruction loss.
// Run with: node test-gemini-long-session.js
const fs = require("fs");
const path = require("path");
const providerSource = fs.readFileSync(path.join(__dirname, "providers/gemini.js"), "utf8");
const coreSource = fs.readFileSync(path.join(__dirname, "core/main.js"), "utf8");
const configSource = fs.readFileSync(path.join(__dirname, "core/config.js"), "utf8");

// Provider construction is side-effect free; browser APIs are only used when
// adapter methods are called, so the settings can be checked without a DOM.
const P = new Function(providerSource + "; return ZSProvider;")();
const ok = (name, condition) => {
  console.log((condition ? "PASS" : "FAIL") + "  " + name);
  if (!condition) process.exitCode = 1;
};
const has = (source, pattern) => pattern.test(source);
const lineCount = (value) => (String(value).match(/\n/g) || []).length + 1;
const exampleCombinedLineCount = lineCount("tool result") + lineCount("\n\nreminder") - 1;

ok("Gemini opts into six-user-turn instruction refreshes", P.id === "gemini" && P.resendSystemEvery === 6);
ok("Gemini warning explains automatic long-session reminders", /automatically restates/i.test(P.unstableWarning));
ok("Gemini exposes its composer character and line caps", P.sendCharBudget === 120000 && P.sendLineBudget === 1200);
ok("core uses the provider threshold and twelve-result budget", has(coreSource, /const RESEND_SYS_EVERY = P\.resendSystemEvery \|\| 0;/) && has(coreSource, /const RESEND_SYS_EVERY_RESULTS = 12;/));
ok("user messages and injected results both advance the reminder count", has(coreSource, /bumpSys\("users"\)/) && has(coreSource, /bumpSys\("results"\)/));
ok("either user-turn or tool-result threshold can trigger a reminder", has(coreSource, /users >= RESEND_SYS_EVERY \|\| results >= RESEND_SYS_EVERY_RESULTS/));
ok("riders defer rather than truncate when either Gemini editor cap is exceeded", has(coreSource, /const lineCap = P\.sendLineBudget \|\| Infinity;/) && has(coreSource, /combinedLines > lineCap/) && has(coreSource, /if \(text\.length \+ rider\.length > cap \|\| combinedLines > lineCap\)/));
ok("combined line counting includes newlines between the result and rider", exampleCombinedLineCount === 3 && has(coreSource, /lineCount\(text\) \+ lineCount\(rider\) - 1/));
ok("oversized results defer without resetting the due reminder", has(coreSource, /if \(text\.length \+ rider\.length > cap \|\| combinedLines > lineCap\) \{\s*\/\/ Stays due[\s\S]*?return text;\s*\}/) && has(coreSource, /const spent = sinceLastSys\(\);\s*resetSysCount\(\);/));
ok("idle fallback sends a reminder when no tool result arrives", has(coreSource, /const SYS_FALLBACK_IDLE_MS = 20000;/) && has(coreSource, /if \(!sysResendDue\(\)\) return;/) && has(coreSource, /Date\.now\(\) - A\.lastGenAt < SYS_FALLBACK_IDLE_MS/));
ok("reminder marker is shared with prompt config and camouflage", has(configSource, /const RESEND_MARKER =/) && has(coreSource, /ZS\.RESEND_MARKER/) && has(coreSource, /txt\.includes\(ZS\.RESEND_MARKER\)/));
