import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMetadata,
  validateUserscript,
  isValidMatchPattern,
  includeToMatchPattern,
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
