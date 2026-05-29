// Behavior pins for popup.js escapeHtml() — actually executes the extracted
// source rather than regex-matching it. Catches drift in entity mapping
// (e.g. someone removing &#39; or swapping &quot; for &#34;) or coercion
// behavior (someone forgetting String(s) and crashing on null/undefined).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

function extractFn(src, name) {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} missing`);
  return new Function(`${m[0]}; return ${name};`)();
}

const escapeHtml = extractFn(popup, "escapeHtml");

test("escapeHtml encodes the five canonical HTML metacharacters exactly", () => {
  // The mapping is hard-pinned here so anyone swapping &#39; → &apos; (which
  // older IE doesn't recognize) or &quot; → &#34; (which works but breaks
  // attr-equality tests) trips this test.
  assert.equal(escapeHtml("<"), "&lt;");
  assert.equal(escapeHtml(">"), "&gt;");
  assert.equal(escapeHtml("&"), "&amp;");
  assert.equal(escapeHtml('"'), "&quot;");
  assert.equal(escapeHtml("'"), "&#39;");
});

test("escapeHtml leaves safe ASCII text untouched", () => {
  assert.equal(escapeHtml("plain text 123"), "plain text 123");
  assert.equal(escapeHtml(""), "");
});

test("escapeHtml escapes already-escaped entities (double-encoding is intentional)", () => {
  // Pin that the function does NOT try to detect and skip pre-escaped
  // entities. "&amp;" → "&amp;amp;" guarantees idempotency only at the
  // pre-encoded layer; consumers must not pass HTML in.
  assert.equal(escapeHtml("&amp;"), "&amp;amp;");
});

test("escapeHtml neutralizes a closing-script-tag payload", () => {
  // The most common XSS canary — pin that the < and > both get escaped so
  // a malicious title can't break out of the surrounding tag.
  assert.equal(escapeHtml("</script>"), "&lt;/script&gt;");
});

test("escapeHtml coerces non-string inputs via String() rather than throwing", () => {
  // String(null) === "null", String(undefined) === "undefined", String(42) === "42"
  assert.equal(escapeHtml(null), "null");
  assert.equal(escapeHtml(undefined), "undefined");
  assert.equal(escapeHtml(42), "42");
});

test("escapeHtml handles multi-character runs in one pass", () => {
  // The regex /[&<>"']/g must hit every occurrence, not just the first.
  assert.equal(escapeHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
});
