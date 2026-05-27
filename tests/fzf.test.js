// Unit tests for lib/fzf.js — scoring helpers and edge cases not covered
// by the popup/modal integration tests in logic.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fzfCharClass,
  fzfPositionBonus,
  fzfMatch,
  highlightWithIndices,
  FZF_SCORE_MATCH,
  FZF_BONUS_BOUNDARY,
  FZF_BONUS_CAMEL,
  FZF_BONUS_FIRST_CHAR_MULT
} from "../lib/fzf.js";

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

test("fzfCharClass maps lowercase letters to class 1", () => {
  assert.equal(fzfCharClass("a"), 1);
  assert.equal(fzfCharClass("z"), 1);
});

test("fzfCharClass maps uppercase letters to class 2", () => {
  assert.equal(fzfCharClass("A"), 2);
  assert.equal(fzfCharClass("Z"), 2);
});

test("fzfCharClass maps digits to class 3", () => {
  assert.equal(fzfCharClass("0"), 3);
  assert.equal(fzfCharClass("9"), 3);
});

test("fzfCharClass maps punctuation and space to class 0 (non-word)", () => {
  for (const c of [" ", "-", "_", ".", "/"]) {
    assert.equal(fzfCharClass(c), 0, `expected non-word for "${c}"`);
  }
});

test("fzfPositionBonus awards boundary when non-word precedes a word char", () => {
  assert.equal(fzfPositionBonus(" ", "a"), FZF_BONUS_BOUNDARY);
  assert.equal(fzfPositionBonus("-", "Z"), FZF_BONUS_BOUNDARY);
});

test("fzfPositionBonus awards camelCase bonus on lowercase→uppercase transition", () => {
  assert.equal(fzfPositionBonus("a", "B"), FZF_BONUS_CAMEL);
});

test("fzfPositionBonus returns 0 for consecutive lowercase letters", () => {
  assert.equal(fzfPositionBonus("a", "b"), 0);
});

test("fzfMatch returns null when needle is longer than haystack", () => {
  assert.equal(fzfMatch("abcdef", "abc"), null);
});

test("fzfMatch returns null for empty haystack with non-empty needle", () => {
  assert.equal(fzfMatch("a", ""), null);
});

test("fzfMatch exact full-string match includes every index", () => {
  const m = fzfMatch("tab", "tab");
  assert.deepEqual(m.indices, [0, 1, 2]);
  assert.ok(m.score > 0);
});

test("fzfMatch first-char boundary bonus is doubled", () => {
  // Prefix "z" at index 0 gets FZF_BONUS_BOUNDARY * FZF_BONUS_FIRST_CHAR_MULT.
  const atStart = fzfMatch("z", "zpwr");
  const midWord = fzfMatch("z", "axzpwr");
  assert.ok(atStart.score > midWord.score,
    `prefix boundary bonus: ${atStart.score} vs ${midWord.score}`);
  assert.equal(atStart.score - midWord.score,
    FZF_BONUS_BOUNDARY * FZF_BONUS_FIRST_CHAR_MULT);
});

test("fzfMatch applies consecutive bonus for adjacent matched chars", () => {
  const consecutive = fzfMatch("bc", "abc");
  const gapped      = fzfMatch("bc", "abxc");
  assert.ok(consecutive.score > gapped.score,
    `consecutive (${consecutive.score}) should beat gapped (${gapped.score})`);
  assert.deepEqual(consecutive.indices, [1, 2]);
  assert.deepEqual(gapped.indices, [1, 3]);
});

test("fzfMatch gap paths carry non-adjacent index pairs", () => {
  const gapped = fzfMatch("bc", "abxc");
  assert.equal(gapped.indices[1] - gapped.indices[0], 2,
    "gapped match must skip at least one character between hits");
});

test("fzfMatch every matched char contributes FZF_SCORE_MATCH base points", () => {
  const one = fzfMatch("a", "a");
  const two = fzfMatch("ab", "ab");
  // Bonuses differ, but the +16-per-char base is the dominant delta here.
  assert.ok(two.score - one.score >= FZF_SCORE_MATCH,
    `expected at least +${FZF_SCORE_MATCH} for the second char`);
});

test("fzfMatch handles digits in needle and haystack", () => {
  const m = fzfMatch("404", "error-404-not-found");
  assert.ok(m);
  assert.deepEqual(m.indices, [6, 7, 8]);
});

test("highlightWithIndices returns empty string for empty text", () => {
  assert.equal(highlightWithIndices("", [0], escape), "");
});

test("highlightWithIndices returns escaped text when indices is null", () => {
  assert.equal(highlightWithIndices("<b>", null, escape), "&lt;b&gt;");
});

test("highlightWithIndices wraps non-contiguous matches in separate marks", () => {
  const out = highlightWithIndices("a.b.c", [0, 2, 4], escape);
  assert.equal(out,
    '<mark class="fzf-hl">a</mark>.<mark class="fzf-hl">b</mark>.<mark class="fzf-hl">c</mark>');
});

test("highlightWithIndices closes an open mark at end-of-string", () => {
  const out = highlightWithIndices("abc", [2], escape);
  assert.equal(out, 'ab<mark class="fzf-hl">c</mark>');
});

test("highlightWithIndices treats duplicate indices idempotently", () => {
  const out = highlightWithIndices("abc", [1, 1, 1], escape);
  assert.equal(out, 'a<mark class="fzf-hl">b</mark>c');
});
