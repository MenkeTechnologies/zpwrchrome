// includeToMatchPattern and isValidMatchPattern edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  includeToMatchPattern,
  isValidMatchPattern,
  parseMetadata,
  RUN_AT_VALUES,
} from "../lib/userscript.js";

test("RUN_AT_VALUES contains all three Chrome userScripts run-at phases", () => {
  assert.ok(RUN_AT_VALUES.has("document-start"));
  assert.ok(RUN_AT_VALUES.has("document-end"));
  assert.ok(RUN_AT_VALUES.has("document-idle"));
  assert.equal(RUN_AT_VALUES.size, 3);
});

test("includeToMatchPattern converts http://host to http://host/*", () => {
  assert.equal(includeToMatchPattern("http://example.com"), "http://example.com/*");
});

test("includeToMatchPattern preserves existing path patterns unchanged", () => {
  assert.equal(includeToMatchPattern("https://a.com/path/*"), "https://a.com/path/*");
});

test("includeToMatchPattern maps lone asterisk to all_urls", () => {
  assert.equal(includeToMatchPattern("*"), "<all_urls>");
});

test("includeToMatchPattern returns null for relative paths without scheme", () => {
  assert.equal(includeToMatchPattern("/local/path"), null);
});

test("includeToMatchPattern returns null for empty string", () => {
  assert.equal(includeToMatchPattern(""), null);
});

test("isValidMatchPattern accepts file:// scheme with path", () => {
  assert.ok(isValidMatchPattern("file:///*"));
});

test("isValidMatchPattern accepts ftp:// scheme", () => {
  assert.ok(isValidMatchPattern("ftp://host.example/*"));
});

test("isValidMatchPattern rejects match pattern missing path slash", () => {
  assert.ok(!isValidMatchPattern("https://host.example.com"));
});

test("isValidMatchPattern accepts wildcard host star", () => {
  assert.ok(isValidMatchPattern("https://*/*"));
});

test("parseMetadata collects multiple @match lines into matches array", () => {
  const src = `// ==UserScript==
// @name t
// @match https://a.com/*
// @match https://b.com/*
// ==/UserScript==
`;
  assert.deepEqual(parseMetadata(src).matches, ["https://a.com/*", "https://b.com/*"]);
});

test("parseMetadata stores scalar @version in raw map", () => {
  const src = `// ==UserScript==
// @name t
// @match https://a.com/*
// @version 2.3.4
// ==/UserScript==
`;
  assert.equal(parseMetadata(src).version, "2.3.4");
});

test("parseMetadata normalizes @run-at document_end to document-end", () => {
  const src = `// ==UserScript==
// @name t
// @match https://a.com/*
// @run-at document_end
// ==/UserScript==
`;
  assert.equal(parseMetadata(src).runAt, "document-end");
});

test("parseMetadata defaults missing @run-at to document-idle", () => {
  const src = `// ==UserScript==
// @name t
// @match https://a.com/*
// ==/UserScript==
`;
  assert.equal(parseMetadata(src).runAt, "document-idle");
});

test("parseMetadata ignores blank lines inside header block", () => {
  const src = `// ==UserScript==
// @name t

// @match https://a.com/*
// ==/UserScript==
`;
  assert.equal(parseMetadata(src).matches.length, 1);
});

test("includeToMatchPattern accepts https host with port and appends slash star", () => {
  assert.equal(includeToMatchPattern("https://localhost:8080"), "https://localhost:8080/*");
});
