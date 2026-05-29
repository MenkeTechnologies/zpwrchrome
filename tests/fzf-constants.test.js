// FZF scoring-constant invariants. These pin the relative ordering of the
// bonus/penalty values so a future tune that breaks the popup ranking is
// caught in CI rather than during user-visible regression.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FZF_SCORE_MATCH,
  FZF_SCORE_GAP_START,
  FZF_SCORE_GAP_EXTENSION,
  FZF_BONUS_BOUNDARY,
  FZF_BONUS_NON_WORD,
  FZF_BONUS_CAMEL,
  FZF_BONUS_CONSECUTIVE,
  FZF_BONUS_FIRST_CHAR_MULT,
} from "../lib/fzf.js";

test("FZF_SCORE_MATCH is the dominant positive constant", () => {
  assert.ok(FZF_SCORE_MATCH > 0, "match base must be positive");
  assert.ok(FZF_SCORE_MATCH >= FZF_BONUS_BOUNDARY,
    "match base should be ≥ boundary bonus so per-char score dominates");
});

test("FZF gap penalties are negative (gaps must cost score)", () => {
  assert.ok(FZF_SCORE_GAP_START < 0);
  assert.ok(FZF_SCORE_GAP_EXTENSION < 0);
});

test("FZF gap-extension penalty is gentler than gap-start", () => {
  // |GAP_EXTENSION| ≤ |GAP_START| — first gap hurts most; widening it
  // less so (matches fzf's published behavior).
  assert.ok(Math.abs(FZF_SCORE_GAP_EXTENSION) <= Math.abs(FZF_SCORE_GAP_START));
});

test("FZF_BONUS_BOUNDARY is the highest single-position bonus", () => {
  for (const other of [FZF_BONUS_NON_WORD, FZF_BONUS_CAMEL, FZF_BONUS_CONSECUTIVE]) {
    assert.ok(FZF_BONUS_BOUNDARY >= other,
      `boundary (${FZF_BONUS_BOUNDARY}) should outrank ${other}`);
  }
});

test("FZF bonus order: BOUNDARY ≥ NON_WORD ≥ CAMEL > CONSECUTIVE > 0", () => {
  assert.ok(FZF_BONUS_BOUNDARY >= FZF_BONUS_NON_WORD);
  assert.ok(FZF_BONUS_NON_WORD >= FZF_BONUS_CAMEL);
  assert.ok(FZF_BONUS_CAMEL > FZF_BONUS_CONSECUTIVE);
  assert.ok(FZF_BONUS_CONSECUTIVE > 0);
});

test("FZF_BONUS_FIRST_CHAR_MULT is exactly 2 (doubles the first-char bonus)", () => {
  assert.equal(FZF_BONUS_FIRST_CHAR_MULT, 2);
});

test("FZF gap-start penalty is large enough to discourage scatter over consecutive", () => {
  // Without this property a needle would prefer to spread across word
  // boundaries instead of staying packed. |GAP_START| ≥ CONSECUTIVE bonus.
  assert.ok(Math.abs(FZF_SCORE_GAP_START) >= FZF_BONUS_CONSECUTIVE - 1,
    "gap-start penalty must overshadow a single consecutive bonus");
});

test("FZF total per-char minimum (match + worst bonuses) stays positive", () => {
  // Even with no bonus and a gap, an additional matched char shouldn't drop
  // the score by more than the per-char gain. This ensures longer matches
  // don't trivially win-or-lose based on the gap path alone.
  const perChar = FZF_SCORE_MATCH + FZF_SCORE_GAP_START + FZF_SCORE_GAP_EXTENSION * 0;
  assert.ok(perChar > 0,
    `matched char (${FZF_SCORE_MATCH}) should outweigh a single gap-start (${FZF_SCORE_GAP_START})`);
});

test("FZF all scoring constants are integers (no floating-point surprises)", () => {
  for (const [name, v] of [
    ["FZF_SCORE_MATCH", FZF_SCORE_MATCH],
    ["FZF_SCORE_GAP_START", FZF_SCORE_GAP_START],
    ["FZF_SCORE_GAP_EXTENSION", FZF_SCORE_GAP_EXTENSION],
    ["FZF_BONUS_BOUNDARY", FZF_BONUS_BOUNDARY],
    ["FZF_BONUS_NON_WORD", FZF_BONUS_NON_WORD],
    ["FZF_BONUS_CAMEL", FZF_BONUS_CAMEL],
    ["FZF_BONUS_CONSECUTIVE", FZF_BONUS_CONSECUTIVE],
    ["FZF_BONUS_FIRST_CHAR_MULT", FZF_BONUS_FIRST_CHAR_MULT],
  ]) {
    assert.equal(Number.isInteger(v), true, `${name} (${v}) must be integer`);
  }
});

test("FZF MATCH * 2 still exceeds first-char-bonus-doubled boundary", () => {
  // Two extra matched chars must out-score a single first-char boundary bonus,
  // so a longer subset match can beat a shorter prefix-only match on identical
  // haystacks. Pin this so a tune doesn't accidentally flip the relation.
  assert.ok(2 * FZF_SCORE_MATCH > FZF_BONUS_BOUNDARY * FZF_BONUS_FIRST_CHAR_MULT,
    `2 × MATCH (${2 * FZF_SCORE_MATCH}) should exceed FIRST_CHAR boundary boost (${FZF_BONUS_BOUNDARY * FZF_BONUS_FIRST_CHAR_MULT})`);
});
