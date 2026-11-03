// Run with: node test-portal-images.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = fs.readFileSync(path.join(__dirname, "core", "main.js"), "utf8");
const declaration = core.match(/function decodePortalImages\(attachments\) \{[\s\S]*?\n  \}/);
assert.ok(declaration, "provider-page image decoder exists");
const regexDeclaration = core.match(/^  const PORTAL_IMAGE_RE = (.+);$/m);
assert.ok(regexDeclaration, "provider-page image data URL pattern exists");
const decode = new Function(
  "atob", "btoa",
  `const PORTAL_IMAGE_RE = ${regexDeclaration[1]};\n${declaration[0]}\nreturn decodePortalImages;`,
)(global.atob, global.btoa);

const validPng = { type: "image/png", size: 8, dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
assert.deepEqual(decode([validPng]), [{ mimeType: "image/png", data: "iVBORw0KGgo=" }]);
assert.throws(() => decode([{ ...validPng, dataUrl: "data:image/png;base64,iVBORw0KGgp=" }]), /non-canonical Base64/);
assert.throws(() => decode([{ ...validPng, dataUrl: "data:image/png;base64,YWJj", size: 3 }]), /does not match its declared image type/);
assert.throws(() => decode([{ ...validPng, type: "image/jpeg" }]), /MIME type did not match/);
assert.throws(() => decode([{ ...validPng, size: 9 }]), /size did not match/);
assert.throws(() => decode(Array(5).fill(validPng)), /no more than four images/);

console.log("Provider-page Portal image validation tests passed.");
