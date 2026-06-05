// Unit tests for lib/find-snippet.js — snippet windowing + whitespace
// collapse + match counting used by the find-in-all-tabs UI.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HARVEST_MAX_CHARS,
  SNIPPET_RADIUS,
  findFirstMatch,
  extractSnippet,
  countOccurrences,
} from "../lib/find-snippet.js";

test("HARVEST_MAX_CHARS is a sane cap (~200 KB)", () => {
  assert.equal(HARVEST_MAX_CHARS, 200_000);
});

test("findFirstMatch: case-insensitive, returns offset range", () => {
  const t = "The quick brown fox jumps over the lazy dog";
  assert.deepEqual(findFirstMatch(t, "Quick"),  { start: 4, end: 9 });
  assert.deepEqual(findFirstMatch(t, "lazy"),   { start: 35, end: 39 });
  assert.equal(findFirstMatch(t, "missing"), null);
  assert.equal(findFirstMatch("",   "x"),    null);
  assert.equal(findFirstMatch("x",  ""),     null);
  assert.equal(findFirstMatch(null, "x"),    null);
});

test("extractSnippet: returns the match with `radius` chars of context", () => {
  const t = "A".repeat(200) + " needle " + "B".repeat(200);
  const out = extractSnippet(t, "needle");
  assert.ok(out);
  // Snippet should center on the match; with radius=80 + collapsed ws
  // the length is ~160-170 chars.
  assert.ok(out.snippet.length >= 80 && out.snippet.length <= 200,
    `snippet length ${out.snippet.length} out of expected range`);
  // The needle is somewhere inside the snippet.
  assert.ok(out.snippet.toLowerCase().includes("needle"));
  // hitStart/hitEnd map to the snippet itself.
  assert.equal(out.snippet.slice(out.hitStart, out.hitEnd).toLowerCase(), "needle");
});

test("extractSnippet: collapses whitespace so multi-line innerText fits one row", () => {
  const t = "line1\n\n\n   line2 with the needle\n\n\nline3";
  const out = extractSnippet(t, "needle");
  assert.ok(out);
  assert.doesNotMatch(out.snippet, /\s{2,}/, "consecutive whitespace must be collapsed");
});

test("extractSnippet: case-insensitive search but preserves original case in snippet", () => {
  const t = "Some PREFIX text Needle Suffix more";
  const out = extractSnippet(t, "needle");
  assert.ok(out);
  // Original case "Needle" survives in the snippet body.
  assert.match(out.snippet, /Needle/);
  // hit offsets index into the collapsed snippet, not the original.
  assert.equal(out.snippet.slice(out.hitStart, out.hitEnd), "Needle");
});

test("extractSnippet: leftElide/rightElide flags reflect whether context was truncated", () => {
  const start = extractSnippet("needle at start " + "x".repeat(500), "needle");
  assert.ok(start);
  assert.equal(start.leftElide,  false);
  assert.equal(start.rightElide, true);

  const end = extractSnippet("x".repeat(500) + " needle", "needle");
  assert.ok(end);
  assert.equal(end.leftElide,  true);
  assert.equal(end.rightElide, false);

  const both = extractSnippet("x".repeat(500) + " needle " + "y".repeat(500), "needle");
  assert.ok(both);
  assert.equal(both.leftElide,  true);
  assert.equal(both.rightElide, true);

  const neither = extractSnippet("tiny needle text", "needle");
  assert.ok(neither);
  assert.equal(neither.leftElide,  false);
  assert.equal(neither.rightElide, false);
});

test("extractSnippet: returns null when text doesn't contain the query", () => {
  assert.equal(extractSnippet("hello world", "absent"), null);
});

test("extractSnippet: custom radius is honored", () => {
  // 10 chars on each side around a 1-char match = ~21-char window, then
  // whitespace collapse so likely smaller.
  const out = extractSnippet("x".repeat(100) + " Q " + "y".repeat(100), "Q", 10);
  assert.ok(out);
  assert.ok(out.snippet.length <= 30, `radius=10 should give a short snippet, got ${out.snippet.length}`);
});

test("countOccurrences: case-insensitive count of every non-overlapping match", () => {
  const t = "abc ABC Abc abC nope";
  assert.equal(countOccurrences(t, "abc"), 4);
  assert.equal(countOccurrences(t, "nope"), 1);
  assert.equal(countOccurrences(t, "missing"), 0);
});

test("countOccurrences: empty inputs return 0", () => {
  assert.equal(countOccurrences("",      "x"), 0);
  assert.equal(countOccurrences("hello", ""),  0);
  assert.equal(countOccurrences(null,    "x"), 0);
});

test("countOccurrences: handles overlapping-looking queries non-overlapping", () => {
  // "aa" in "aaaa" — non-overlapping count is 2, not 3.
  assert.equal(countOccurrences("aaaa", "aa"), 2);
});

test("SNIPPET_RADIUS is the default used by extractSnippet", () => {
  // Sanity: passing the same explicit radius produces an identical result.
  const t = "x".repeat(200) + " word " + "y".repeat(200);
  const a = extractSnippet(t, "word");
  const b = extractSnippet(t, "word", SNIPPET_RADIUS);
  assert.deepEqual(a, b);
});
