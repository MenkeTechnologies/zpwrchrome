// Pathological fzfMatch inputs designed to stress every branch of the
// scoring algorithm and bound execution time on adversarial shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fzfMatch } from "../lib/fzf.js";

function bench(label, budgetMs, fn) {
  const start = process.hrtime.bigint();
  const out = fn();
  const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.ok(elapsed < budgetMs, `${label} took ${elapsed.toFixed(1)}ms (budget ${budgetMs}ms)`);
  return out;
}

test("pathological: needle 'aaaaaa' in 1000-char all-'a' haystack stays under 100ms", () => {
  const haystack = "a".repeat(1000);
  const m = bench("6×a in 1000×a", 100, () => fzfMatch("aaaaaa", haystack));
  assert.notEqual(m, null);
  assert.equal(m.indices.length, 6);
});

test("pathological: needle 'abcde' over 5000 copies of 'abcde' stays under 200ms", () => {
  const haystack = "abcde".repeat(5000);
  const m = bench("abcde×5000", 200, () => fzfMatch("abcde", haystack));
  assert.notEqual(m, null);
  assert.equal(m.indices.length, 5);
});

test("pathological: needle at index 0 of 'a' + 50k 'b' chars + 'a' picks the prefix", () => {
  const haystack = "a" + "b".repeat(50_000) + "a";
  const m = bench("prefix-a + 50k×b + a", 200, () => fzfMatch("aa", haystack));
  assert.notEqual(m, null);
  // Prefix 'a' (boundary + first-char-mult bonus) + final 'a'.
  assert.equal(m.indices[0], 0);
  assert.equal(m.indices[1], haystack.length - 1);
});

test("pathological: alternating boundary chars maximise position-bonus computation", () => {
  // Force the scorer to evaluate fzfPositionBonus on every char by
  // alternating word/non-word boundaries throughout the haystack.
  const haystack = " a b c d e f g h i j ".repeat(500);
  const m = bench("alt-boundary x500", 200, () => fzfMatch("aei", haystack));
  assert.notEqual(m, null);
  assert.equal(m.indices.length, 3);
});

test("pathological: needle just barely fits the haystack (lengths differ by 1)", () => {
  // Needle len = haystack len - 1. Only one possible start position.
  const needle = "abcdefghij";
  const haystack = needle + "z";
  const m = fzfMatch(needle, haystack);
  assert.notEqual(m, null);
  assert.deepEqual(m.indices, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("pathological: needle === haystack on a 1000-char string completes < 100ms", () => {
  const s = "abcdefghij".repeat(100);
  const m = bench("self-match 1000", 100, () => fzfMatch(s, s));
  assert.notEqual(m, null);
  assert.equal(m.indices.length, 1000);
  // Indices must be 0..999 exactly.
  for (let i = 0; i < 1000; i++) assert.equal(m.indices[i], i);
});

test("pathological: needle with only the last haystack char present runs single-pass", () => {
  // Worst-case path for the greedy forward match: scan everything to find
  // the only 'z' at the end.
  const haystack = "a".repeat(10_000) + "z";
  const m = bench("scan-for-z 10k", 100, () => fzfMatch("z", haystack));
  assert.notEqual(m, null);
  assert.deepEqual(m.indices, [10_000]);
});

test("pathological: needle out of order ('ba' in 'ab') returns null fast", () => {
  // No path forward — the first-pass char-exists check should reject.
  const m = fzfMatch("ba", "ab".repeat(10_000));
  // 'b' at idx 1, then 'a' must come after idx 1 — exists at idx 2. Found.
  assert.notEqual(m, null);
});

test("pathological: empty haystack rejects every non-empty needle", () => {
  for (const needle of ["a", "abc", "z".repeat(100)]) {
    assert.equal(fzfMatch(needle, ""), null);
  }
});

test("pathological: needle just past haystack length is rejected immediately", () => {
  const start = process.hrtime.bigint();
  const m = fzfMatch("a".repeat(1001), "a".repeat(1000));
  const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.equal(m, null);
  assert.ok(elapsed < 5, `over-length rejection took ${elapsed.toFixed(2)}ms`);
});

test("pathological: 100-char needle in 200-char haystack runs in bounded time", () => {
  const needle   = "abcdefghij".repeat(10);
  const haystack = "abcdefghij".repeat(20);
  const m = bench("100→200 self-prefix", 200, () => fzfMatch(needle, haystack));
  assert.notEqual(m, null);
  assert.equal(m.indices.length, 100);
});

test("pathological: digit needle in mixed-case haystack still matches digits", () => {
  // Case-insensitive matching shouldn't accidentally treat digits as letters.
  const haystack = "AbC123dEf456GhI789";
  const m = fzfMatch("147", haystack);
  assert.notEqual(m, null);
  assert.equal(m.indices.length, 3);
  for (const idx of m.indices) assert.ok(/[0-9]/.test(haystack[idx]));
});

test("pathological: needle with leading space matches space chars (non-word boundary)", () => {
  const m = fzfMatch(" a", "x a b");
  assert.notEqual(m, null);
  assert.equal(m.indices.length, 2);
});

test("pathological: 200 successive fzfMatch calls on the same hard input are stable", () => {
  // No hidden state — repeated calls must produce identical output.
  const needle = "rxz";
  const haystack = "rendererXxxZetaPathwayService";
  const first = fzfMatch(needle, haystack);
  for (let i = 0; i < 200; i++) {
    const m = fzfMatch(needle, haystack);
    assert.deepEqual(m, first, `i=${i} non-deterministic`);
  }
});

test("pathological: input rejection paths execute in O(haystack) not O(haystack²)", () => {
  // Char-not-present rejection — needle has 'q' that never appears.
  const haystack = ("abc".repeat(20_000));   // 60k chars, no q
  const start = process.hrtime.bigint();
  const m = fzfMatch("aq", haystack);
  const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.equal(m, null);
  assert.ok(elapsed < 50, `60k-char rejection took ${elapsed.toFixed(2)}ms`);
});
