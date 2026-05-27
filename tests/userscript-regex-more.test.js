// matchPatternToRegex and matchUrl behavioral tests beyond userscript.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchPatternToRegex,
  matchUrl,
  isValidMatchPattern,
  expandMatchPatterns,
} from "../lib/userscript.js";

test("matchPatternToRegex matches exact path without wildcard", () => {
  const re = matchPatternToRegex("https://example.com/path");
  assert.ok(re.test("https://example.com/path"));
  assert.ok(!re.test("https://example.com/path/extra"));
});

test("matchPatternToRegex *.host matches apex and subdomains", () => {
  const re = matchPatternToRegex("https://*.example.com/*");
  assert.ok(re.test("https://example.com/"));
  assert.ok(re.test("https://www.example.com/x"));
  assert.ok(re.test("https://a.b.example.com/y"));
});

test("matchPatternToRegex rejects scheme-less URLs at runtime", () => {
  const re = matchPatternToRegex("https://example.com/*");
  assert.ok(!re.test("example.com/path"));
});

test("matchUrl short-circuits false for non-array patterns argument", () => {
  assert.equal(matchUrl(undefined, "https://a/"), false);
  assert.equal(matchUrl("https://a/*", "https://a/"), false);
});

test("matchUrl returns true on first matching pattern in list", () => {
  assert.ok(matchUrl(
    ["https://miss.com/*", "https://hit.com/*"],
    "https://hit.com/page"
  ));
});

test("matchUrl is case-insensitive on URL path", () => {
  const patterns = ["https://example.com/*"];
  assert.ok(matchUrl(patterns, "https://example.com/CaseSensitive"));
});

test("isValidMatchPattern accepts wildcard scheme star", () => {
  assert.ok(isValidMatchPattern("*://example.com/*"));
});

test("isValidMatchPattern rejects missing path slash", () => {
  assert.ok(!isValidMatchPattern("https://example.com"));
});

test("expandMatchPatterns deduplicates original and generated wildcard host", () => {
  const out = expandMatchPatterns(["https://docs.google.com/*"]);
  assert.equal(new Set(out).size, out.length);
  assert.equal(out.length, 2);
});

test("expandMatchPatterns leaves localhost single-label host unchanged", () => {
  const out = expandMatchPatterns(["http://localhost/*"]);
  assert.deepEqual(out, ["http://localhost/*"]);
});

test("expandMatchPatterns leaves IP literal hosts unchanged", () => {
  const out = expandMatchPatterns(["http://192.168.1.1/*"]);
  assert.deepEqual(out, ["http://192.168.1.1/*"]);
});

test("matchPatternToRegex http scheme does not match https URL", () => {
  const re = matchPatternToRegex("http://example.com/*");
  assert.ok(re.test("http://example.com/x"));
  assert.ok(!re.test("https://example.com/x"));
});

test("matchPatternToRegex star scheme matches http and https only", () => {
  const re = matchPatternToRegex("*://example.com/*");
  assert.ok(re.test("http://example.com/x"));
  assert.ok(re.test("https://example.com/x"));
  assert.ok(!re.test("file:///tmp/x"));
});

test("matchUrl with expanded patterns matches www subdomain of apex @match", () => {
  const patterns = expandMatchPatterns(["https://github.com/*"]);
  assert.ok(matchUrl(patterns, "https://www.github.com/MenkeTechnologies/zpwrchrome"));
});

test("matchPatternToRegex path star matches empty remainder after slash", () => {
  const re = matchPatternToRegex("https://example.com/*");
  assert.ok(re.test("https://example.com/"));
});

test("matchPatternToRegex accepts triple-slash host wildcard pattern syntactically", () => {
  const re = matchPatternToRegex("https://*/*");
  assert.ok(re);
  assert.ok(re.test("https://example.com/path"));
});

test("isValidMatchPattern accepts <all_urls> sentinel", () => {
  assert.ok(isValidMatchPattern("<all_urls>"));
});

test("matchUrl with ftp pattern matches ftp URLs", () => {
  assert.ok(matchUrl(["ftp://files.example.com/*"], "ftp://files.example.com/readme"));
});
