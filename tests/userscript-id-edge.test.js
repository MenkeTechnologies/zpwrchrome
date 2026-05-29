// Edge cases for userscriptId and includeToMatchPattern that the other
// userscript test files don't pin: empty/missing meta fields, unicode names,
// Tampermonkey "@include *" star wildcard, and the 80-char id ceiling.

import { test } from "node:test";
import assert from "node:assert/strict";
import { userscriptId, includeToMatchPattern, isValidMatchPattern } from "../lib/userscript.js";

test("userscriptId on empty meta produces a valid chrome-id-shaped slug", () => {
  const id = userscriptId({});
  assert.ok(/^[A-Za-z0-9_-]+$/.test(id), `id must be chrome-safe, got ${id}`);
  assert.ok(id.startsWith("us_"), `id must start with us_, got ${id}`);
});

test("userscriptId preserves uniqueness across distinct empty-field combinations", () => {
  // Different namespaces (even both empty + name) collide into the same
  // sanitized id — pin that behavior so callers know to disambiguate.
  const both = userscriptId({});
  const ns  = userscriptId({ namespace: "x" });
  assert.notEqual(both, ns);
});

test("userscriptId strips non-ASCII characters from unicode names", () => {
  const id = userscriptId({ name: "café-script", namespace: "https://example.com" });
  assert.ok(/^[A-Za-z0-9_-]+$/.test(id), "every char must be chrome-id-safe");
  assert.ok(id.includes("caf"), "must keep ASCII chars verbatim");
});

test("userscriptId truncates to 80 characters at the byte boundary", () => {
  const longName = "x".repeat(500);
  const id = userscriptId({ name: longName, namespace: "https://example.com/very/long/ns" });
  assert.equal(id.length, 80);
});

test("userscriptId yields identical output for identical inputs", () => {
  const meta = { name: "Site Cleaner", namespace: "https://menketechnologies.github.io/" };
  assert.equal(userscriptId(meta), userscriptId(meta));
});

test("userscriptId on missing namespace falls back to empty + sanitized name", () => {
  const id = userscriptId({ name: "abc" });
  // base = "::abc" → "us___abc"
  assert.equal(id, "us___abc");
});

test("includeToMatchPattern returns <all_urls> for Tampermonkey bare *", () => {
  assert.equal(includeToMatchPattern("*"), "<all_urls>");
});

test("includeToMatchPattern passes through already-valid match patterns", () => {
  assert.equal(includeToMatchPattern("https://*.example.com/*"), "https://*.example.com/*");
});

test("includeToMatchPattern appends /* when input is scheme://host with no path", () => {
  assert.equal(includeToMatchPattern("https://example.com"), "https://example.com/*");
});

test("includeToMatchPattern returns null for non-string input", () => {
  assert.equal(includeToMatchPattern(null), null);
  assert.equal(includeToMatchPattern(undefined), null);
  assert.equal(includeToMatchPattern(42), null);
});

test("includeToMatchPattern returns null for empty string", () => {
  assert.equal(includeToMatchPattern(""), null);
});

test("includeToMatchPattern returns null for path-only glob without scheme", () => {
  // Greasemonkey @include accepts these, but Chrome match patterns require
  // a scheme. We drop the conversion rather than silently mis-translate.
  assert.equal(includeToMatchPattern("/admin/*"), null);
});

test("isValidMatchPattern rejects empty string", () => {
  assert.equal(isValidMatchPattern(""), false);
});

test("isValidMatchPattern rejects scheme-only inputs without host or path", () => {
  assert.equal(isValidMatchPattern("https://"), false);
});

test("isValidMatchPattern accepts the host wildcard prefix shape", () => {
  // "*.example.com" — the canonical Tampermonkey subdomain form.
  assert.equal(isValidMatchPattern("https://*.example.com/*"), true);
});
