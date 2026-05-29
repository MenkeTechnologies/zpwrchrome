// Boundary inputs for resolveJumpIndex and resolveSceneOrdinal that the
// other test files don't pin: zero/negative ordinals, decimal numbers
// (parseInt truncation), leading zeros, trailing garbage, non-string inputs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveJumpIndex, resolveSceneOrdinal } from "../lib/util.js";

test("resolveJumpIndex jump-to-0 returns -1 (out of 1..9 range)", () => {
  // n=0 → Math.min(-1, tabsLength-1) = -1. Pin so a future "treat 0 as 1"
  // change is explicit.
  assert.equal(resolveJumpIndex("jump-to-0", 5), -1);
});

test("resolveJumpIndex jump-to-N for negative N returns < 0 (caller treats as invalid)", () => {
  // n=-1 → Math.min(-2, tabsLength-1) = -2. The dispatch path checks `< 0`
  // so any negative is rejected; pin the actual returned value.
  assert.equal(resolveJumpIndex("jump-to--1", 5), -2);
});

test("resolveJumpIndex jump-to-1.5 truncates via parseInt to jump-to-1", () => {
  assert.equal(resolveJumpIndex("jump-to-1.5", 5), 0);
});

test("resolveJumpIndex jump-to-100 caps at last tab index", () => {
  assert.equal(resolveJumpIndex("jump-to-100", 5), 4);
});

test("resolveJumpIndex jump-to-9 is treated as last-tab even when tabs.length < 9", () => {
  assert.equal(resolveJumpIndex("jump-to-9", 3), 2);
});

test("resolveJumpIndex jump-to-9 on single-tab window returns 0", () => {
  assert.equal(resolveJumpIndex("jump-to-9", 1), 0);
});

test("resolveJumpIndex empty string and non-jump command return -1", () => {
  assert.equal(resolveJumpIndex("", 5), -1);
  assert.equal(resolveJumpIndex("focus-tab-1", 5), -1);
});

test("resolveJumpIndex with tabsLength=0 short-circuits to -1 regardless of n", () => {
  for (const n of [1, 2, 5, 9]) {
    assert.equal(resolveJumpIndex(`jump-to-${n}`, 0), -1, `n=${n} should be -1 on empty window`);
  }
});

test("resolveJumpIndex jump-to- (no digits) returns -1 via NaN guard", () => {
  assert.equal(resolveJumpIndex("jump-to-", 5), -1);
});

test("resolveJumpIndex jump-to-abc returns -1 (parseInt yields NaN)", () => {
  assert.equal(resolveJumpIndex("jump-to-abc", 5), -1);
});

test("resolveSceneOrdinal accepts leading-zero ordinal (parseInt parses base-10)", () => {
  // "restore-scene-01" → parseInt("01", 10) === 1 → ordinal 0.
  assert.equal(resolveSceneOrdinal("restore-scene-01", 5), 0);
});

test("resolveSceneOrdinal restore-scene-1.5 truncates to scene 1 via parseInt", () => {
  assert.equal(resolveSceneOrdinal("restore-scene-1.5", 5), 0);
});

test("resolveSceneOrdinal non-string command returns -1", () => {
  assert.equal(resolveSceneOrdinal(null, 5), -1);
  assert.equal(resolveSceneOrdinal(undefined, 5), -1);
  assert.equal(resolveSceneOrdinal(42, 5), -1);
});

test("resolveSceneOrdinal restore-scene-10 (n > 9) returns -1", () => {
  assert.equal(resolveSceneOrdinal("restore-scene-10", 20), -1);
});

test("resolveSceneOrdinal restore-scene-N where N > scenesLength returns -1", () => {
  // Asked for scene 5 but only 3 saved → -1.
  assert.equal(resolveSceneOrdinal("restore-scene-5", 3), -1);
});

test("resolveSceneOrdinal restore-scene-N with empty scene list returns -1", () => {
  for (const n of [1, 5, 9]) {
    assert.equal(resolveSceneOrdinal(`restore-scene-${n}`, 0), -1);
  }
});
