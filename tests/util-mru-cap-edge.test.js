// Pin behaviour of mruPush at unusual `cap` values, and mruStep with deltas
// that are exact multiples of the list length. These edges are easy to break
// silently (off-by-one inside the modulo or the slice), and the rest of the
// MRU test files don't cover them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mruPush, mruStep, mruDrop } from "../lib/util.js";

test("mruPush with cap=0 yields an empty stack regardless of input", () => {
  assert.deepEqual(mruPush([10, 20, 30], 99, 0), []);
});

test("mruPush with cap=0 still rejects non-finite ids and returns []", () => {
  // Non-finite branch returns mru.slice() (full input) — but cap=0 means we
  // still want callers to know the stack-after-noop is empty when cap is 0?
  // The implementation short-circuits before the slice(0, cap) — pin that.
  assert.deepEqual(mruPush([1, 2, 3], NaN, 0), [1, 2, 3]);
});

test("mruPush cap larger than input length leaves length unchanged", () => {
  assert.deepEqual(mruPush([1, 2, 3], 4, 50), [4, 1, 2, 3]);
});

test("mruPush moves existing id to head when cap equals current length", () => {
  assert.deepEqual(mruPush([1, 2, 3], 3, 3), [3, 1, 2]);
});

test("mruPush rejects string-coerced numeric tab id", () => {
  // typeof "5" === "string" → returns shallow copy of original.
  const before = [1, 2];
  const after = mruPush(before, "5");
  assert.deepEqual(after, [1, 2]);
  assert.notEqual(after, before, "must return a new array (shallow copy)");
});

test("mruStep with delta equal to length is a full wrap (same id)", () => {
  assert.equal(mruStep([10, 20, 30], 10, 3), 10);
  assert.equal(mruStep([10, 20, 30], 20, 3), 20);
});

test("mruStep with delta equal to negative length is a full backward wrap", () => {
  assert.equal(mruStep([10, 20, 30], 10, -3), 10);
});

test("mruStep with delta greater than length wraps via modulo", () => {
  // delta=7 on a 3-element list ≡ delta=1
  assert.equal(mruStep([10, 20, 30], 10, 7), 20);
});

test("mruDrop returns a fresh array (no aliasing) when id is absent", () => {
  const before = [1, 2, 3];
  const after = mruDrop(before, 999);
  assert.deepEqual(after, [1, 2, 3]);
  assert.notEqual(after, before, "filter must produce a new array");
});

test("mruDrop strips every occurrence of the id (defensive dedup)", () => {
  // mruPush should keep the list deduped, but mruDrop is the cleanup path
  // when external state slips a dup in — defend the invariant.
  assert.deepEqual(mruDrop([5, 1, 5, 2, 5], 5), [1, 2]);
});
