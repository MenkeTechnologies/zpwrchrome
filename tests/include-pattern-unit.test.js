// includeToMatchPattern and isValidMatchPattern additional unit tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  includeToMatchPattern,
  isValidMatchPattern,
  matchPatternToRegex,
} from "../lib/userscript.js";

test("includeToMatchPattern accepts https host with existing wildcard path", () => {
  assert.equal(includeToMatchPattern("https://*.example.com/*"), "https://*.example.com/*");
});

test("includeToMatchPattern appends slash-star to https host without path", () => {
  assert.equal(includeToMatchPattern("https://example.com"), "https://example.com/*");
});

test("includeToMatchPattern returns null for non-string input", () => {
  assert.equal(includeToMatchPattern(null), null);
  assert.equal(includeToMatchPattern(undefined), null);
});

test("includeToMatchPattern returns null for ftp URL missing path segment", () => {
  assert.equal(includeToMatchPattern("ftp://files.example.com"), "ftp://files.example.com/*");
});

test("isValidMatchPattern accepts urn scheme with path", () => {
  assert.ok(isValidMatchPattern("urn://resource/path"));
});

test("isValidMatchPattern accepts apex host without wildcard prefix", () => {
  assert.ok(isValidMatchPattern("https://example.com/*"));
});

test("isValidMatchPattern accepts *.host wildcard prefix form", () => {
  assert.ok(isValidMatchPattern("https://*.example.com/*"));
});

test("isValidMatchPattern rejects javascript pseudo scheme", () => {
  assert.ok(!isValidMatchPattern("javascript:alert(1)"));
});

test("isValidMatchPattern rejects host-only http pattern", () => {
  assert.ok(!isValidMatchPattern("http://example.com"));
});

test("matchPatternToRegex returns null for malformed pattern string", () => {
  assert.equal(matchPatternToRegex("not-a-pattern"), null);
});

test("matchPatternToRegex star scheme matches http and https only", () => {
  const re = matchPatternToRegex("*://example.com/*");
  assert.match("https://example.com/x", re);
  assert.match("http://example.com/x", re);
  assert.doesNotMatch("file:///x", re);
});

test("matchPatternToRegex wildcard host matches subdomains", () => {
  const re = matchPatternToRegex("https://*.google.com/*");
  assert.match("https://mail.google.com/inbox", re);
  assert.match("https://google.com/search", re);
});

test("includeToMatchPattern preserves ftp scheme in generated path pattern", () => {
  assert.equal(includeToMatchPattern("ftp://mirror.local"), "ftp://mirror.local/*");
});

test("isValidMatchPattern rejects empty string", () => {
  assert.ok(!isValidMatchPattern(""));
});

test("includeToMatchPattern returns null for bare hostname without scheme", () => {
  assert.equal(includeToMatchPattern("example.com"), null);
});
