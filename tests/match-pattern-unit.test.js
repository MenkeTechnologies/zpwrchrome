// matchPatternToRegex and matchUrl behavioral tests in lib/userscript.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidMatchPattern,
  matchPatternToRegex,
  matchUrl,
  userscriptId,
} from "../lib/userscript.js";

test("isValidMatchPattern accepts https wildcard host patterns", () => {
  assert.equal(isValidMatchPattern("https://*.example.com/*"), true);
});

test("isValidMatchPattern accepts <all_urls> special pattern", () => {
  assert.equal(isValidMatchPattern("<all_urls>"), true);
});

test("isValidMatchPattern rejects empty string", () => {
  assert.equal(isValidMatchPattern(""), false);
});

test("isValidMatchPattern rejects pattern missing path segment", () => {
  assert.equal(isValidMatchPattern("https://example.com"), false);
});

test("matchPatternToRegex <all_urls> matches http and https", () => {
  const re = matchPatternToRegex("<all_urls>");
  assert.match("http://a/", re);
  assert.match("https://b/path?q=1", re);
});

test("matchPatternToRegex escapes dots in host labels", () => {
  const re = matchPatternToRegex("https://news.ycombinator.com/*");
  assert.match("https://news.ycombinator.com/item", re);
  assert.doesNotMatch("https://newsXycombinator.com/item", re);
});

test("matchPatternToRegex * in host matches subdomain segments", () => {
  const re = matchPatternToRegex("https://*.github.com/*");
  assert.match("https://api.github.com/repos", re);
  assert.match("https://github.com/about", re);
});

test("matchUrl returns true when any pattern in array matches", () => {
  assert.equal(matchUrl(["https://a.com/*", "https://b.com/*"], "https://b.com/x"), true);
});

test("matchUrl returns false for empty patterns array", () => {
  assert.equal(matchUrl([], "https://any/"), false);
});

test("matchUrl returns false when URL matches none of the patterns", () => {
  assert.equal(matchUrl(["https://a.com/*"], "https://b.com/"), false);
});

test("matchUrl skips invalid patterns without throwing", () => {
  assert.equal(matchUrl(["not-a-pattern", "https://ok.com/*"], "https://ok.com/"), true);
});

test("userscriptId sanitizes name and namespace into chrome-safe id prefix", () => {
  const a = userscriptId({ name: "Demo", namespace: "https://ns/" });
  const b = userscriptId({ name: "Demo", namespace: "https://ns/" });
  assert.equal(a, b);
  assert.match(a, /^us_/);
  assert.ok(a.length <= 80);
});

test("userscriptId differs when namespace changes", () => {
  const a = userscriptId({ name: "Demo", namespace: "https://a/" });
  const b = userscriptId({ name: "Demo", namespace: "https://b/" });
  assert.notEqual(a, b);
});

test("matchPatternToRegex path * wildcard matches query strings", () => {
  const re = matchPatternToRegex("https://example.com/*");
  assert.match("https://example.com/foo?bar=1", re);
});

test("matchUrl matching is case-insensitive via regex i flag", () => {
  assert.equal(matchUrl(["https://Example.com/*"], "https://example.com/"), true);
});
