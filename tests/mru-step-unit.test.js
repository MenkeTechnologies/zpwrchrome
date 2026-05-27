// mruStep and mruPrevious pure helper edge cases in lib/util.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mruStep, mruPrevious, mruPush, mruDrop } from "../lib/util.js";

test("mruStep returns undefined when MRU list has fewer than two entries", () => {
  assert.equal(mruStep([1], 1, 1), undefined);
  assert.equal(mruStep([], 1, 1), undefined);
});

test("mruStep wraps forward from last entry to first", () => {
  assert.equal(mruStep([10, 20, 30], 30, 1), 10);
});

test("mruStep wraps backward from first entry to last", () => {
  assert.equal(mruStep([10, 20, 30], 10, -1), 30);
});

test("mruStep returns first entry when currentId not in list", () => {
  assert.equal(mruStep([5, 6, 7], 999, 1), 5);
});

test("mruStep delta zero returns current id position entry", () => {
  assert.equal(mruStep([5, 6, 7], 6, 0), 6);
});

test("mruPrevious returns first MRU entry that is not currentId", () => {
  assert.equal(mruPrevious([3, 1, 2], 3), 1);
});

test("mruPrevious returns undefined when only current id exists in list", () => {
  assert.equal(mruPrevious([5], 5), undefined);
});

test("mruPrevious returns undefined on empty MRU list", () => {
  assert.equal(mruPrevious([], 1), undefined);
});

test("mruDrop removes all occurrences of tab id", () => {
  assert.deepEqual(mruDrop([1, 2, 2, 3], 2), [1, 3]);
});

test("mruPush does not mutate input array", () => {
  const before = [1, 2];
  const after = mruPush(before, 3);
  assert.deepEqual(before, [1, 2]);
  assert.notEqual(before, after);
});

test("mruPush prepends NaN-safe — rejects non-finite tab ids", () => {
  assert.deepEqual(mruPush([1, 2], NaN), [1, 2]);
  assert.deepEqual(mruPush([1, 2], Infinity), [1, 2]);
});

test("mruStep handles negative delta multiple wraps correctly", () => {
  assert.equal(mruStep([10, 20, 30], 20, -2), 30);
});

test("mruPrevious skips duplicate current ids and returns next distinct", () => {
  assert.equal(mruPrevious([5, 5, 4], 5), 4);
});

test("mruDrop on id not present returns shallow-equal new array content", () => {
  const src = [1, 2, 3];
  const out = mruDrop(src, 9);
  assert.deepEqual(out, src);
  assert.notEqual(out, src);
});
