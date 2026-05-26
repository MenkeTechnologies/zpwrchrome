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
  userscriptId,
  RUN_AT_VALUES
} from "../lib/userscript.js";

const SAMPLE = `// ==UserScript==
// @name        Sample Script
// @namespace   https://github.com/MenkeTechnologies
// @version     1.2.3
// @description Does a thing
// @author      MenkeTechnologies
// @match       https://*.example.com/*
// @match       https://other.example.com/page
// @exclude     https://*.example.com/admin/*
// @run-at      document-end
// @grant       GM.setValue
// @grant       GM.getValue
// ==/UserScript==

(function () {
  console.log("hello");
})();
`;

test("parseMetadata extracts all standard fields", () => {
  const m = parseMetadata(SAMPLE);
  assert.equal(m.name,        "Sample Script");
  assert.equal(m.namespace,   "https://github.com/MenkeTechnologies");
  assert.equal(m.version,     "1.2.3");
  assert.equal(m.description, "Does a thing");
  assert.equal(m.author,      "MenkeTechnologies");
  assert.equal(m.runAt,       "document-end");
  assert.deepEqual(m.matches, [
    "https://*.example.com/*",
    "https://other.example.com/page"
  ]);
  assert.deepEqual(m.excludes, ["https://*.example.com/admin/*"]);
  assert.deepEqual(m.grants,   ["GM.setValue", "GM.getValue"]);
});

test("parseMetadata returns null when block missing", () => {
  assert.equal(parseMetadata("just some js"), null);
  assert.equal(parseMetadata(""), null);
});

test("parseMetadata defaults runAt to document-idle and normalizes underscores", () => {
  const m1 = parseMetadata(`// ==UserScript==
// @name foo
// @match https://x/*
// ==/UserScript==`);
  assert.equal(m1.runAt, "document-idle");

  const m2 = parseMetadata(`// ==UserScript==
// @name foo
// @match https://x/*
// @run-at document_start
// ==/UserScript==`);
  assert.equal(m2.runAt, "document-start");
});

test("parseMetadata clamps unknown runAt to document-idle", () => {
  const m = parseMetadata(`// ==UserScript==
// @name foo
// @match https://x/*
// @run-at when-the-stars-align
// ==/UserScript==`);
  assert.equal(m.runAt, "document-idle");
});

test("RUN_AT_VALUES enumerates the 3 valid runAt phases", () => {
  assert.equal(RUN_AT_VALUES.size, 3);
  for (const v of ["document-start", "document-end", "document-idle"]) {
    assert.ok(RUN_AT_VALUES.has(v));
  }
});

test("validateUserscript reports missing name + missing matches", () => {
  const noBlock = validateUserscript(null);
  assert.deepEqual(noBlock, ["no ==UserScript== block found"]);

  const m = parseMetadata(`// ==UserScript==
// @description nope
// ==/UserScript==`);
  const errs = validateUserscript(m);
  assert.ok(errs.includes("missing @name"));
  assert.ok(errs.includes("missing @match or @include"));
});

test("validateUserscript catches malformed match patterns", () => {
  const m = parseMetadata(`// ==UserScript==
// @name x
// @match not-a-pattern
// ==/UserScript==`);
  const errs = validateUserscript(m);
  assert.ok(errs.some((e) => e.includes("invalid @match")), `got: ${errs.join("|")}`);
});

test("validateUserscript accepts a well-formed script", () => {
  assert.deepEqual(validateUserscript(parseMetadata(SAMPLE)), []);
});

test("isValidMatchPattern accepts canonical Chrome patterns", () => {
  for (const p of [
    "<all_urls>",
    "https://*.example.com/*",
    "https://example.com/path",
    "*://*/*",
    "http://localhost/*",
    "file:///*"
  ]) {
    assert.ok(isValidMatchPattern(p), `should accept: ${p}`);
  }
});

test("isValidMatchPattern rejects malformed patterns", () => {
  for (const p of [
    "https://example.com",     // no path
    "not-a-pattern",
    "javascript:alert(1)",
    ""
  ]) {
    assert.ok(!isValidMatchPattern(p), `should reject: ${p}`);
  }
});

test("includeToMatchPattern handles common cases", () => {
  assert.equal(includeToMatchPattern("*"),                       "<all_urls>");
  assert.equal(includeToMatchPattern("https://example.com"),     "https://example.com/*");
  assert.equal(includeToMatchPattern("https://*.example.com/*"), "https://*.example.com/*");
  assert.equal(includeToMatchPattern(""),                        null);
  assert.equal(includeToMatchPattern(null),                      null);
});

test("userscriptId is stable + safe for chrome.userScripts.id", () => {
  const id1 = userscriptId({ name: "My Script", namespace: "https://example.com" });
  const id2 = userscriptId({ name: "My Script", namespace: "https://example.com" });
  assert.equal(id1, id2, "must be deterministic");
  assert.match(id1, /^[A-Za-z0-9_-]+$/, "must match chrome's id charset");
  assert.ok(id1.length <= 80, "must be ≤80 chars");

  const idA = userscriptId({ name: "A", namespace: "" });
  const idB = userscriptId({ name: "B", namespace: "" });
  assert.notEqual(idA, idB, "different names → different ids");
});

test("matchPatternToRegex handles canonical Chrome patterns", () => {
  // Exact host
  const re1 = matchPatternToRegex("https://example.com/*");
  assert.ok(re1.test("https://example.com/"));
  assert.ok(re1.test("https://example.com/path/to/page?q=1"));
  assert.ok(!re1.test("https://sub.example.com/"));
  assert.ok(!re1.test("http://example.com/"));

  // Subdomain wildcard
  const re2 = matchPatternToRegex("https://*.example.com/*");
  assert.ok(re2.test("https://www.example.com/"));
  assert.ok(re2.test("https://api.v2.example.com/x"));
  assert.ok(re2.test("https://example.com/"), "*.example.com matches the apex too per Chrome's spec");
  assert.ok(!re2.test("https://example.org/"));

  // Scheme wildcard — Chrome spec: "*" = http|https only
  const re3 = matchPatternToRegex("*://example.com/*");
  assert.ok(re3.test("http://example.com/"));
  assert.ok(re3.test("https://example.com/x"));
  assert.ok(!re3.test("ftp://example.com/"));
  assert.ok(!re3.test("file:///etc/hosts"));

  // <all_urls>
  const re4 = matchPatternToRegex("<all_urls>");
  assert.ok(re4.test("https://example.com/"));
  assert.ok(re4.test("http://anything.test/x"));

  // Malformed
  assert.equal(matchPatternToRegex("nope"), null);
  assert.equal(matchPatternToRegex("https://example.com"), null, "no path = invalid match pattern");
});

test("expandMatchPatterns adds *.host for bare apex domains", () => {
  // User error catch: `https://amazon.com/*` only matches apex per Chrome
  // spec; they probably want www.amazon.com too. Auto-expand.
  const out = expandMatchPatterns(["https://amazon.com/*"]);
  assert.ok(out.includes("https://amazon.com/*"), "original kept");
  assert.ok(out.includes("https://*.amazon.com/*"), "subdomain variant added");
});

test("expandMatchPatterns leaves already-wildcarded hosts alone", () => {
  const out = expandMatchPatterns(["https://*.amazon.com/*"]);
  assert.deepEqual(out, ["https://*.amazon.com/*"]);
});

test("expandMatchPatterns leaves <all_urls> alone", () => {
  assert.deepEqual(expandMatchPatterns(["<all_urls>"]), ["<all_urls>"]);
});

test("expandMatchPatterns leaves single-label hosts (localhost) alone", () => {
  const out = expandMatchPatterns(["http://localhost/*"]);
  assert.deepEqual(out, ["http://localhost/*"]);
});

test("expandMatchPatterns leaves raw IP addresses alone", () => {
  const out = expandMatchPatterns(["http://127.0.0.1/*"]);
  assert.deepEqual(out, ["http://127.0.0.1/*"]);
});

test("expandMatchPatterns dedupes when the same pattern appears twice", () => {
  const out = expandMatchPatterns([
    "https://amazon.com/*",
    "https://*.amazon.com/*"
  ]);
  // Both inputs kept; no extra expansion added for the already-wildcarded one.
  assert.equal(out.length, 2);
});

test("matchUrl returns true on any-pattern match", () => {
  const patterns = ["https://example.com/*", "https://*.github.com/*"];
  assert.ok(matchUrl(patterns, "https://example.com/foo"));
  assert.ok(matchUrl(patterns, "https://api.github.com/repos"));
  assert.ok(!matchUrl(patterns, "https://gitlab.com/x"));
  assert.ok(!matchUrl(patterns, ""));
  assert.ok(!matchUrl(null,    "https://example.com/"));
  assert.ok(!matchUrl([],      "https://example.com/"));
});

test("parseMetadata supports the Tampermonkey-style multi-match block", () => {
  // Real-world userscripts often have many @match lines.
  const src = `// ==UserScript==
// @name        Multi
// @match       https://a.example.com/*
// @match       https://b.example.com/*
// @match       https://c.example.com/*
// @include     https://d.example.com/*
// @exclude     https://*.example.com/blocked/*
// ==/UserScript==
console.log(1);`;
  const m = parseMetadata(src);
  assert.equal(m.matches.length,  3);
  assert.equal(m.includes.length, 1);
  assert.equal(m.excludes.length, 1);
});
