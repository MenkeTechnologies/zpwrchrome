// Additional userscript metadata and match-pattern edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMetadata,
  validateUserscript,
  isValidMatchPattern,
  includeToMatchPattern,
  matchPatternToRegex,
  matchUrl,
  expandMatchPatterns,
  userscriptId
} from "../lib/userscript.js";

test("parseMetadata preserves @grant none (Tampermonkey convention)", () => {
  const m = parseMetadata(`// ==UserScript==
// @name x
// @match https://a/*
// @grant none
// ==/UserScript==`);
  assert.deepEqual(m.grants, ["none"]);
});

test("parseMetadata collects multiple @require lines", () => {
  const m = parseMetadata(`// ==UserScript==
// @name x
// @match https://a/*
// @require https://a/lib1.js
// @require https://a/lib2.js
// ==/UserScript==`);
  assert.equal(m.requires.length, 2);
});

test("parseMetadata normalizes @run-at document_end to document-end", () => {
  const m = parseMetadata(`// ==UserScript==
// @name x
// @match https://a/*
// @run-at document_end
// ==/UserScript==`);
  assert.equal(m.runAt, "document-end");
});

test("validateUserscript rejects missing @match and @include together", () => {
  const m = parseMetadata(`// ==UserScript==
// @name only-name
// ==/UserScript==`);
  assert.ok(validateUserscript(m).some((e) => e.includes("missing @match")));
});

test("isValidMatchPattern accepts urn:// scheme with wildcard host", () => {
  assert.ok(isValidMatchPattern("urn://*/*"));
});

test("isValidMatchPattern rejects host without path segment", () => {
  assert.ok(!isValidMatchPattern("https://example.com"));
});

test("includeToMatchPattern appends /* to scheme://host URLs", () => {
  assert.equal(includeToMatchPattern("http://localhost"), "http://localhost/*");
});

test("matchPatternToRegex rejects host-only patterns (returns null)", () => {
  assert.equal(matchPatternToRegex("https://example.com"), null);
});

test("matchPatternToRegex *.host matches apex and subdomains", () => {
  const re = matchPatternToRegex("https://*.example.org/*");
  assert.ok(re.test("https://example.org/"));
  assert.ok(re.test("https://www.example.org/x"));
});

test("matchUrl returns false for empty url string", () => {
  assert.ok(!matchUrl(["https://example.com/*"], ""));
});

test("expandMatchPatterns preserves order while deduping", () => {
  const out = expandMatchPatterns(["https://a.com/*", "https://a.com/*"]);
  assert.equal(out.length, 2);
  assert.ok(out.includes("https://*.a.com/*"));
});

test("userscriptId differs when namespace changes", () => {
  const a = userscriptId({ name: "X", namespace: "https://a" });
  const b = userscriptId({ name: "X", namespace: "https://b" });
  assert.notEqual(a, b);
});

test("userscriptId prefix is us_ for chrome.userScripts compatibility", () => {
  assert.match(userscriptId({ name: "t", namespace: "" }), /^us_/);
});

test("parseMetadata handles Windows-style CRLF line endings in header", () => {
  const m = parseMetadata("// ==UserScript==\r\n// @name crlf\r\n// @match https://x/*\r\n// ==/UserScript==\r\n");
  assert.equal(m.name, "crlf");
});

test("matchPatternToRegex explicit https does not match http", () => {
  const re = matchPatternToRegex("https://example.com/*");
  assert.ok(!re.test("http://example.com/"));
});

test("validateUserscript flags multiple invalid @match lines", () => {
  const m = parseMetadata(`// ==UserScript==
// @name x
// @match bad1
// @match bad2
// ==/UserScript==`);
  const errs = validateUserscript(m);
  assert.ok(errs.filter((e) => e.includes("invalid @match")).length >= 2);
});
