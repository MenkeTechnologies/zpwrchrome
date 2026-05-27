// fzfPositionBonus and fzfCharClass boundary scoring in lib/fzf.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fzfCharClass,
  fzfPositionBonus,
  FZF_BONUS_BOUNDARY,
  FZF_BONUS_CAMEL,
  FZF_BONUS_NON_WORD,
} from "../lib/fzf.js";

test("fzfCharClass classifies lowercase letters as word chars (class 1)", () => {
  assert.equal(fzfCharClass("a"), 1);
  assert.equal(fzfCharClass("z"), 1);
});

test("fzfCharClass classifies uppercase letters as word chars (class 2)", () => {
  assert.equal(fzfCharClass("A"), 2);
  assert.equal(fzfCharClass("Z"), 2);
});

test("fzfCharClass classifies digits as class 3", () => {
  assert.equal(fzfCharClass("0"), 3);
  assert.equal(fzfCharClass("9"), 3);
});

test("fzfCharClass classifies slash and dot as non-word (class 0)", () => {
  assert.equal(fzfCharClass("/"), 0);
  assert.equal(fzfCharClass("."), 0);
});

test("fzfPositionBonus awards camelCase bonus on lowercase to uppercase transition", () => {
  assert.equal(fzfPositionBonus("a", "B"), FZF_BONUS_CAMEL);
});

test("fzfPositionBonus awards boundary bonus on non-word to lowercase transition", () => {
  assert.equal(fzfPositionBonus("/", "a"), FZF_BONUS_BOUNDARY);
});

test("fzfPositionBonus returns zero for same-class letter continuation", () => {
  assert.equal(fzfPositionBonus("a", "b"), 0);
});

test("fzfPositionBonus awards non-word bonus when word classes differ (digit to letter)", () => {
  assert.equal(fzfPositionBonus("3", "a"), FZF_BONUS_NON_WORD);
});

test("fzfPositionBonus treats empty previous char as word boundary", () => {
  assert.equal(fzfPositionBonus("", "a"), FZF_BONUS_BOUNDARY);
});

test("fzfPositionBonus returns zero for undefined previous char at index 0 edge", () => {
  assert.equal(fzfPositionBonus(undefined, "x"), FZF_BONUS_BOUNDARY);
});

test("fzfCharClass treats underscore as non-word (class 0)", () => {
  assert.equal(fzfCharClass("_"), 0);
});

test("fzfPositionBonus hyphen to letter earns word boundary bonus", () => {
  assert.equal(fzfPositionBonus("-", "t"), FZF_BONUS_BOUNDARY);
});
