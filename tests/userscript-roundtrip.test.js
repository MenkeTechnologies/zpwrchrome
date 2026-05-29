// End-to-end userscript pipeline tests. Each test composes multiple lib/
// helpers in the same order the background.js registration path uses them,
// so a regression in any single function lights up here too.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMetadata,
  userscriptId,
  validateUserscript,
  expandMatchPatterns,
  matchUrl,
  includeToMatchPattern,
  isValidMatchPattern,
} from "../lib/userscript.js";

const WRAP = (body) => `// ==UserScript==\n${body}// ==/UserScript==\n\nconsole.log("ok");\n`;

const SAMPLE = WRAP([
  "// @name        sample-script\n",
  "// @namespace   https://menketechnologies.github.io/\n",
  "// @version     1.0.0\n",
  "// @match       https://example.com/*\n",
  "// @grant       GM.setValue\n",
  "// @grant       GM.getValue\n",
].join(""));

test("parseMetadata → userscriptId is stable across repeated parses of the same source", () => {
  const idA = userscriptId(parseMetadata(SAMPLE));
  const idB = userscriptId(parseMetadata(SAMPLE));
  assert.equal(idA, idB);
});

test("parseMetadata → userscriptId stays ≤ 80 chars even with long namespaces", () => {
  const longNs = "https://" + "a".repeat(300) + ".example.com/";
  const src = WRAP([
    "// @name long-ns\n",
    `// @namespace ${longNs}\n`,
    "// @match https://x.test/*\n",
  ].join(""));
  const id = userscriptId(parseMetadata(src));
  assert.ok(id.length <= 80, `id length ${id.length} exceeds 80 cap`);
});

test("validateUserscript accepts a parsed sample and reports no errors", () => {
  const errors = validateUserscript(parseMetadata(SAMPLE));
  assert.deepEqual(errors, []);
});

test("validateUserscript on null parse result rejects with no-block message", () => {
  const errors = validateUserscript(parseMetadata("// plain js\nconsole.log(1);\n"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no ==UserScript==/);
});

test("pipeline matches the URL the user typed @match for", () => {
  const meta = parseMetadata(SAMPLE);
  const patterns = expandMatchPatterns(meta.matches);
  assert.ok(matchUrl(patterns, "https://example.com/page"));
  assert.ok(matchUrl(patterns, "https://www.example.com/page"),
    "apex @match must expand to www subdomain");
});

test("validateUserscript flags every invalid @match in the parsed meta", () => {
  const src = WRAP([
    "// @name bad-matches\n",
    "// @match not-a-pattern\n",
    "// @match https://ok.test/*\n",
    "// @match also-bad\n",
  ].join(""));
  const meta = parseMetadata(src);
  const errors = validateUserscript(meta);
  // Each bad pattern reported once; total errors must be ≥ 2.
  const badCount = errors.filter((e) => /invalid @match pattern/.test(e)).length;
  assert.equal(badCount, 2);
});

test("includeToMatchPattern output is validated as a real Chrome match pattern", () => {
  for (const include of [
    "*",
    "https://*.example.com/*",
    "https://example.com",  // → https://example.com/*
  ]) {
    const converted = includeToMatchPattern(include);
    if (converted == null) continue;
    assert.equal(isValidMatchPattern(converted), true,
      `converted include "${include}" → "${converted}" must be a valid match pattern`);
  }
});

test("userscriptId is sensitive to namespace AND name (no accidental id collisions)", () => {
  const sources = [
    WRAP("// @name one\n// @namespace ns-a\n// @match https://x.test/*\n"),
    WRAP("// @name one\n// @namespace ns-b\n// @match https://x.test/*\n"),
    WRAP("// @name two\n// @namespace ns-a\n// @match https://x.test/*\n"),
    WRAP("// @name two\n// @namespace ns-b\n// @match https://x.test/*\n"),
  ];
  const ids = sources.map((s) => userscriptId(parseMetadata(s)));
  assert.equal(new Set(ids).size, ids.length, `expected 4 unique ids, got ${ids.join(",")}`);
});

test("pipeline @include alone (no @match) is registered through includeToMatchPattern", () => {
  const src = WRAP([
    "// @name include-only\n",
    "// @include https://*.allowed.test/*\n",
  ].join(""));
  const meta = parseMetadata(src);
  // validateUserscript allows include-only scripts.
  assert.deepEqual(validateUserscript(meta), []);
  // The include must convert to a Chrome match pattern.
  const converted = includeToMatchPattern(meta.includes[0]);
  assert.notEqual(converted, null);
  assert.equal(isValidMatchPattern(converted), true);
});

test("pipeline with both @match and @include gives @match precedence in expansion", () => {
  // expandMatchPatterns only operates on meta.matches — @include stays out.
  const src = WRAP([
    "// @name both\n",
    "// @match https://a.test/*\n",
    "// @include https://b.test/*\n",
  ].join(""));
  const meta = parseMetadata(src);
  const patterns = expandMatchPatterns(meta.matches);
  assert.ok(matchUrl(patterns, "https://a.test/"));
  assert.equal(matchUrl(patterns, "https://b.test/"), false,
    "@include URL must not match via match patterns");
});

test("parseMetadata→userscriptId remains stable under whitespace-only header edits", () => {
  const a = WRAP("// @name ws\n// @match https://x.test/*\n");
  const b = WRAP("// @name ws\n\n\n// @match https://x.test/*\n\n\n");
  const idA = userscriptId(parseMetadata(a));
  const idB = userscriptId(parseMetadata(b));
  assert.equal(idA, idB, "blank-line edits inside block must not change id");
});

test("validateUserscript missing-name error message contains 'missing @name'", () => {
  const src = WRAP("// @match https://x.test/*\n");
  const errors = validateUserscript(parseMetadata(src));
  assert.ok(errors.some((e) => e.includes("missing @name")),
    `expected missing-name error in: ${errors.join(" | ")}`);
});
