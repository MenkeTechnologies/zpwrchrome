import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mruPush,
  mruDrop,
  mruStep,
  mruPrevious,
  hostnameOf,
  resolveJumpIndex,
  MRU_CAP_DEFAULT
} from "../lib/util.js";
import { fzfMatch, highlightWithIndices } from "../lib/fzf.js";

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

test("mruPush prepends a new id", () => {
  assert.deepEqual(mruPush([2, 3], 1), [1, 2, 3]);
});

test("mruPush moves an existing id to the front (dedup)", () => {
  assert.deepEqual(mruPush([1, 2, 3, 4], 3), [3, 1, 2, 4]);
});

test("mruPush enforces cap and trims the tail", () => {
  const big = Array.from({ length: MRU_CAP_DEFAULT }, (_, i) => i);
  const next = mruPush(big, 9999);
  assert.equal(next.length, MRU_CAP_DEFAULT);
  assert.equal(next[0], 9999);
  assert.equal(next[next.length - 1], MRU_CAP_DEFAULT - 2);
});

test("mruPush rejects non-finite ids and returns a copy", () => {
  const before = [1, 2, 3];
  for (const bad of [undefined, null, NaN, "1", Infinity, -Infinity, {}]) {
    const after = mruPush(before, bad);
    assert.deepEqual(after, before);
    assert.notEqual(after, before, "must not return the same array reference");
  }
});

test("mruDrop removes an id without mutating input", () => {
  const before = [1, 2, 3];
  const after = mruDrop(before, 2);
  assert.deepEqual(after, [1, 3]);
  assert.deepEqual(before, [1, 2, 3]);
});

test("mruDrop is a no-op when id is absent", () => {
  assert.deepEqual(mruDrop([1, 2, 3], 99), [1, 2, 3]);
});

test("mruStep cycles forward and wraps", () => {
  assert.equal(mruStep([10, 20, 30], 10, +1), 20);
  assert.equal(mruStep([10, 20, 30], 30, +1), 10);
});

test("mruStep cycles backward and wraps", () => {
  assert.equal(mruStep([10, 20, 30], 10, -1), 30);
  assert.equal(mruStep([10, 20, 30], 20, -1), 10);
});

test("mruStep returns undefined when stack is too short", () => {
  assert.equal(mruStep([], 1, +1), undefined);
  assert.equal(mruStep([42], 42, +1), undefined);
});

test("mruStep falls back to head when current id is absent", () => {
  // Current tab not in MRU (e.g. just switched to a new window) → step from front.
  assert.equal(mruStep([10, 20, 30], 999, +1), 10);
});

test("mruPrevious returns first id that isn't current", () => {
  assert.equal(mruPrevious([10, 20, 30], 10), 20);
  assert.equal(mruPrevious([20, 10, 30], 10), 20);
});

test("mruPrevious returns undefined for empty or single-element stack", () => {
  assert.equal(mruPrevious([], 1), undefined);
  assert.equal(mruPrevious([42], 42), undefined);
});

test("hostnameOf extracts hostname from valid URLs", () => {
  assert.equal(hostnameOf("https://example.com/path?q=1"), "example.com");
  assert.equal(hostnameOf("http://sub.example.co.uk:8080/x"), "sub.example.co.uk");
  assert.equal(hostnameOf("file:///etc/hosts"), "(local)");
});

test("hostnameOf returns (other) for unparseable input", () => {
  assert.equal(hostnameOf(""), "(other)");
  assert.equal(hostnameOf("not a url"), "(other)");
  assert.equal(hostnameOf(undefined), "(other)");
});

test("resolveJumpIndex caps numeric jumps at tabs.length-1", () => {
  assert.equal(resolveJumpIndex("jump-to-1", 5), 0);
  assert.equal(resolveJumpIndex("jump-to-3", 5), 2);
  assert.equal(resolveJumpIndex("jump-to-8", 5), 4); // capped
});

test("resolveJumpIndex treats jump-to-9 as last tab", () => {
  assert.equal(resolveJumpIndex("jump-to-9", 1), 0);
  assert.equal(resolveJumpIndex("jump-to-9", 7), 6);
  assert.equal(resolveJumpIndex("jump-to-9", 12), 11);
});

test("resolveJumpIndex returns -1 for empty window", () => {
  assert.equal(resolveJumpIndex("jump-to-1", 0), -1);
});

test("resolveJumpIndex returns -1 for non-jump commands", () => {
  assert.equal(resolveJumpIndex("duplicate-tab", 5), -1);
  assert.equal(resolveJumpIndex("jump-to-x", 5), -1);
});

// ===== fzf =====

test("fzfMatch returns { score: 0, indices: [] } for empty needle", () => {
  const m = fzfMatch("", "anything");
  assert.deepEqual(m, { score: 0, indices: [] });
});

test("fzfMatch returns null when chars aren't present in order", () => {
  assert.equal(fzfMatch("xyz", "abc"),         null);
  assert.equal(fzfMatch("abcd", "abc"),        null);  // needle longer than haystack
  assert.equal(fzfMatch("bac", "abc"),         null);  // wrong order
});

test("fzfMatch is case-insensitive", () => {
  // Greedy forward match picks the FIRST matching lowercased char, not the
  // optimal one. "RTM" in "Recent Tabs Modal": R at 0, first t at 5 (Recen[t]),
  // first m at 12 (Modal).
  const m = fzfMatch("RTM", "Recent Tabs Modal");
  assert.ok(m, "expected a match for case-insensitive RTM");
  assert.deepEqual(m.indices, [0, 5, 12]);
});

test("fzfMatch picks the highest-scoring start position", () => {
  // For "ab" in "a_ab": start at 0 → [0,3], start at 2 → [2,3].
  // [2,3] has consecutive bonus AND boundary bonus on a (prev='_').
  const m = fzfMatch("ab", "a_ab");
  assert.deepEqual(m.indices, [2, 3]);
});

test("fzfMatch rewards word-boundary matches more than consecutive matches", () => {
  // fzf-canonical: boundary bonus (9) on a char in "t-a-b-bar" outweighs
  // the consecutive bonus (4) on the same char in "tab-bar".
  const a = fzfMatch("tab", "t-a-b-bar");   // boundary on each char
  const b = fzfMatch("tab", "tab-bar");     // consecutive
  assert.ok(a.score > b.score, `boundary should beat consecutive: ${a.score} vs ${b.score}`);
});

test("fzfMatch rewards prefix-boundary first-char match", () => {
  // First char at position 0 gets BONUS_BOUNDARY * BONUS_FIRST_CHAR_MULT (9*2=18).
  // A match mid-word (preceded by another letter, no boundary) gets 0.
  const start = fzfMatch("zpwr", "zpwrchrome");
  const mid   = fzfMatch("zpwr", "axxxzpwrchrome");  // 'x' before 'z' = no boundary
  assert.ok(start.score > mid.score,
    `prefix match should outscore mid-word match: ${start.score} vs ${mid.score}`);
});

test("fzfMatch indices are strictly increasing positions in haystack", () => {
  const m = fzfMatch("github", "github.com/MenkeTechnologies/zpwrchrome");
  assert.ok(m);
  for (let i = 1; i < m.indices.length; i++) {
    assert.ok(m.indices[i] > m.indices[i - 1],
      `non-monotonic at ${i}: ${m.indices}`);
  }
});

test("highlightWithIndices wraps matched chars in <mark class=\"fzf-hl\">", () => {
  const out = highlightWithIndices("abc", [1], escape);
  assert.equal(out, 'a<mark class="fzf-hl">b</mark>c');
});

test("highlightWithIndices coalesces adjacent matches into one <mark>", () => {
  const out = highlightWithIndices("abcdef", [1, 2, 3], escape);
  assert.equal(out, 'a<mark class="fzf-hl">bcd</mark>ef');
});

test("highlightWithIndices escapes HTML in unmatched and matched chars", () => {
  const out = highlightWithIndices("<a>&b", [0, 3], escape);
  assert.equal(out, '<mark class="fzf-hl">&lt;</mark>a&gt;<mark class="fzf-hl">&amp;</mark>b');
});

test("highlightWithIndices returns empty escaped text when no indices", () => {
  assert.equal(highlightWithIndices("<b>", [], escape), "&lt;b&gt;");
});
