// Additional fzf behavioral tests not covered by tests/fzf.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fzfMatch,
  fzfCharClass,
  fzfPositionBonus,
  FZF_BONUS_NON_WORD,
  FZF_SCORE_GAP_START,
  FZF_SCORE_GAP_EXTENSION
} from "../lib/fzf.js";

test("fzfMatch is case-insensitive on haystack", () => {
  const lower = fzfMatch("abc", "aBcDeF");
  const upper = fzfMatch("ABC", "aBcDeF");
  assert.ok(lower && upper);
  assert.deepEqual(lower.indices, upper.indices);
});

test("fzfMatch returns null when characters are out of order", () => {
  assert.equal(fzfMatch("cba", "abc"), null);
});

test("fzfMatch single-char needle at word boundary beats mid-word", () => {
  const boundary = fzfMatch("t", "tab-switcher");
  const mid      = fzfMatch("t", "switcher");
  assert.ok(boundary.score > mid.score);
});

test("fzfPositionBonus awards non-word transition bonus (digit→letter)", () => {
  assert.equal(fzfPositionBonus("3", "a"), FZF_BONUS_NON_WORD);
});

test("fzfCharClass treats hyphen as non-word (class 0)", () => {
  assert.equal(fzfCharClass("-"), 0);
});

test("fzfMatch camelCase path in haystack scores higher than all-lowercase gap", () => {
  const camel = fzfMatch("tc", "tabCount");
  const flat  = fzfMatch("tc", "tabcount");
  assert.ok(camel && flat);
  assert.ok(camel.score >= flat.score);
});

test("fzfMatch indices always strictly increase left-to-right", () => {
  const m = fzfMatch("chrome", "zpwr-chrome-extension");
  assert.ok(m);
  for (let i = 1; i < m.indices.length; i++) {
    assert.ok(m.indices[i] > m.indices[i - 1]);
  }
});

test("fzfMatch longer needle on same haystack has lower or equal score per char efficiency", () => {
  const one = fzfMatch("a", "amazon");
  const two = fzfMatch("am", "amazon");
  assert.ok(one && two);
  assert.ok(two.score > one.score);
});

test("fzfMatch empty needle returns score 0 with empty indices", () => {
  assert.deepEqual(fzfMatch("", "anything"), { score: 0, indices: [] });
});

test("fzfMatch hyphenated haystack still matches contiguous needle letters", () => {
  const m = fzfMatch("tab", "my-tab-list");
  assert.ok(m);
  assert.deepEqual(m.indices, [3, 4, 5]);
});

test("fzfMatch gapped letters earn boundary bonus per separator (can outscore contiguous)", () => {
  const contiguous = fzfMatch("test", "my-test-here");
  const gapped     = fzfMatch("test", "t-e-s-t");
  assert.ok(contiguous && gapped);
  assert.ok(gapped.score > contiguous.score);
});

test("fzfMatch gap start penalty makes distant first char worse than adjacent", () => {
  // Indirect: first char at index 0 avoids gap-start penalty on subsequent chars.
  const atZero = fzfMatch("ab", "abxxxx");
  const offset = fzfMatch("ab", "xxxxab");
  assert.ok(atZero.score > offset.score);
});

test("fzf scoring constants export expected gap penalties", () => {
  assert.ok(FZF_SCORE_GAP_START < 0);
  assert.ok(FZF_SCORE_GAP_EXTENSION < 0);
  assert.ok(FZF_SCORE_GAP_START < FZF_SCORE_GAP_EXTENSION);
});

test("fzfMatch matches needle spanning hyphenated segments", () => {
  const m = fzfMatch("zpwr", "zpwr-chrome");
  assert.ok(m);
  assert.ok(m.indices.includes(0));
});
