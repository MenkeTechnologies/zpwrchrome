// fzfMatch ranking invariants — pins the relations between scores rather
// than absolute numbers, so a future scoring-constant tune doesn't silently
// re-order the popup list. Complements fzf-more / fzf-position-more /
// fzf-match-edge which cover smaller per-function behaviors.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fzfMatch } from "../lib/fzf.js";

function scoreOf(needle, haystack) {
  const m = fzfMatch(needle, haystack);
  return m ? m.score : -Infinity;
}

test("fzfMatch is deterministic across repeated calls on identical inputs", () => {
  const a = fzfMatch("popup", "popupRender.js");
  const b = fzfMatch("popup", "popupRender.js");
  assert.deepEqual(a, b);
});

test("fzfMatch picks the highest-scoring path when multiple matches exist", () => {
  // "ab" in "ababab" — three start positions, all valid. Best score is the
  // one that maximizes boundary/consecutive bonuses (the prefix-position).
  const m = fzfMatch("ab", "ababab");
  assert.ok(m);
  // First-char boundary at index 0 gives boundary*first_char_mult bonus
  // → optimal indices [0, 1].
  assert.deepEqual(m.indices, [0, 1]);
});

test("fzfMatch score is strictly higher when first char hits a real boundary", () => {
  // 'a' at index 0 of "abc" gets prev=" " → boundary*first_char_mult bonus.
  // 'a' inside "bca" lands mid-word with prev='c' (same class) → no bonus.
  const atBoundary = scoreOf("a", "abc");
  const inside    = scoreOf("a", "bca");
  assert.ok(atBoundary > inside,
    `boundary-aligned (${atBoundary}) should beat mid-word (${inside})`);
});

test("fzfMatch score is strictly higher for boundary match than mid-word match", () => {
  const boundary = scoreOf("p", "popup");          // 'p' at word start
  const midword  = scoreOf("p", "ttptp");          // 'p' mid-word
  assert.ok(boundary > midword,
    `boundary 'p' (${boundary}) should beat mid-word 'p' (${midword})`);
});

test("fzfMatch indices are monotonically strict-increasing on dense haystacks", () => {
  const m = fzfMatch("aaaa", "aaaaaaaa");
  assert.ok(m);
  for (let i = 1; i < m.indices.length; i++) {
    assert.ok(m.indices[i] > m.indices[i - 1],
      `indices must strictly increase, got [${m.indices.join(", ")}]`);
  }
  // For "aaaa" in "aaaaaaaa" the greedy forward-match locks in [0,1,2,3].
  assert.deepEqual(m.indices, [0, 1, 2, 3]);
});

test("fzfMatch returns null when chars exist but not in order", () => {
  // 'a' and 'b' both present, but 'b' comes before 'a' in the haystack.
  assert.equal(fzfMatch("ab", "ba"), null);
});

test("fzfMatch sorts items by descending score for a typical filter pass", () => {
  const items = [
    "background.js",
    "popup.js",
    "popup-render.js",
    "modal/content.js",
    "lib/util.js",
  ];
  const ranked = items
    .map((s) => ({ s, m: fzfMatch("pop", s) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m.score - a.m.score)
    .map((x) => x.s);
  // popup* should rank above any haystack without "pop" as a prefix segment.
  assert.equal(ranked[0], "popup.js");
  assert.equal(ranked[1], "popup-render.js");
});

test("fzfMatch empty needle returns score 0 regardless of haystack length", () => {
  assert.deepEqual(fzfMatch("", ""), { score: 0, indices: [] });
  assert.deepEqual(fzfMatch("", "anything"), { score: 0, indices: [] });
});

test("fzfMatch non-empty needle against empty haystack is null", () => {
  assert.equal(fzfMatch("a", ""), null);
});

test("fzfMatch score grows monotonically as needle length grows in same haystack", () => {
  // Each extra matched char adds at least FZF_SCORE_MATCH base points.
  const haystack = "abcdefghij";
  let prev = -Infinity;
  for (const n of ["a", "ab", "abc", "abcd"]) {
    const s = scoreOf(n, haystack);
    assert.ok(s > prev, `score must grow when needle "${n}" extends previous`);
    prev = s;
  }
});

test("fzfMatch tie-break across equal-score paths picks earliest start", () => {
  // For single-char needle, every occurrence is a candidate; tie-break
  // favours earliest position (which gets the prefix-boundary bonus).
  const m = fzfMatch("z", "zzz");
  assert.deepEqual(m.indices, [0]);
});

test("fzfMatch single char matches the first occurrence in a normal haystack", () => {
  const m = fzfMatch("u", "popup-render");
  assert.equal(m.indices.length, 1);
  assert.equal(m.indices[0], "popup-render".indexOf("u"));
});

test("fzfMatch boundary-aligned consecutive chars outrank scattered gapped hits", () => {
  // "ren" packed at the start of "renderer" beats the same letters scattered
  // through "rabbitenroom" — boundary + consecutive bonuses dominate the gap
  // penalty incurred by the scattered version.
  const packed     = scoreOf("ren", "renderer");
  const scattered  = scoreOf("ren", "rabbitenroom");
  assert.ok(packed > scattered,
    `packed (${packed}) should outrank scattered (${scattered})`);
});
