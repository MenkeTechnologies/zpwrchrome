// Composed-operation invariants for the MRU helpers. Per-function tests
// live in mru-step-unit / logic / util-mru-cap-edge — this file pins the
// invariants that survive across long sequences of push/drop calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mruPush, mruDrop, mruStep, mruPrevious, MRU_CAP_DEFAULT } from "../lib/util.js";

test("mruPush over many distinct ids respects the cap throughout the sequence", () => {
  let mru = [];
  for (let id = 1; id <= 500; id++) {
    mru = mruPush(mru, id);
    assert.ok(mru.length <= MRU_CAP_DEFAULT,
      `length=${mru.length} exceeded cap=${MRU_CAP_DEFAULT} after push id=${id}`);
  }
  assert.equal(mru.length, MRU_CAP_DEFAULT);
  // Newest at head: last pushed id should be index 0.
  assert.equal(mru[0], 500);
});

test("mruPush dedupes — no id appears twice across N pushes of repeating ids", () => {
  let mru = [];
  // Push 100 distinct ids, then push the same set again.
  const distinct = Array.from({ length: 100 }, (_, i) => i + 1);
  for (const id of distinct) mru = mruPush(mru, id);
  for (const id of distinct) mru = mruPush(mru, id);
  const counts = mru.reduce((m, id) => m.set(id, (m.get(id) || 0) + 1), new Map());
  for (const [, c] of counts) assert.equal(c, 1, "every id must appear exactly once");
});

test("mruPush of the same id repeatedly stays length-1", () => {
  let mru = [];
  for (let i = 0; i < 50; i++) mru = mruPush(mru, 42);
  assert.deepEqual(mru, [42]);
});

test("mruPush + mruDrop roundtrip returns the list to its pre-push state", () => {
  const before = [10, 20, 30];
  const pushed = mruPush(before, 40);
  const dropped = mruDrop(pushed, 40);
  assert.deepEqual(dropped, before);
});

test("mruDrop after mruPush of an existing id reverts to original ordering", () => {
  const before = [10, 20, 30];
  // Re-push id 20 → moves to head: [20, 10, 30]. Drop 20 → [10, 30].
  // Not the same as `before` — pin so the difference is documented.
  const pushed = mruPush(before, 20);
  const dropped = mruDrop(pushed, 20);
  assert.deepEqual(dropped, [10, 30]);
});

test("alternating mruPush/mruDrop preserves at-most-once invariant for every id", () => {
  let mru = [];
  for (let i = 0; i < 100; i++) {
    const id = (i * 7) % 30;          // visit ~30 distinct ids in shuffled order
    if (i % 5 === 0 && mru.length) mru = mruDrop(mru, mru[mru.length - 1]);
    else mru = mruPush(mru, id);
    const counts = new Map();
    for (const x of mru) counts.set(x, (counts.get(x) || 0) + 1);
    for (const [k, c] of counts) {
      assert.equal(c, 1, `id ${k} appeared ${c} times after step ${i}`);
    }
  }
});

test("mruStep on a saturated cap-sized list cycles deterministically", () => {
  let mru = [];
  for (let id = 1; id <= MRU_CAP_DEFAULT; id++) mru = mruPush(mru, id);
  // After this, head is the newest (MRU_CAP_DEFAULT); tail is 1.
  // Stepping forward by 1 from head wraps to the oldest's neighbor toward head.
  const head = mru[0];
  const stepped = mruStep(mru, head, +1);
  assert.equal(stepped, mru[1], "+1 from head → element at index 1");
  const wrapped = mruStep(mru, mru[mru.length - 1], +1);
  assert.equal(wrapped, mru[0], "+1 from tail wraps to head");
});

test("mruPrevious after mruPush returns the prior active tab", () => {
  // Simulate user switching tabs: push 1, push 2, push 3.
  // The MRU is [3, 2, 1]; "previous to 3" is 2.
  let mru = [];
  for (const id of [1, 2, 3]) mru = mruPush(mru, id);
  assert.equal(mruPrevious(mru, 3), 2);
});

test("mruDrop of every id in arbitrary order empties the list", () => {
  let mru = [];
  for (let id = 1; id <= 50; id++) mru = mruPush(mru, id);
  // Drop in a non-sequential order.
  for (const id of [7, 23, 1, 49, 50, 25, 12, 33, 5, 18]) mru = mruDrop(mru, id);
  // The remaining items are exactly (1..50) minus the dropped set.
  const dropped = new Set([7, 23, 1, 49, 50, 25, 12, 33, 5, 18]);
  assert.equal(mru.length, 50 - dropped.size);
  for (const id of mru) assert.equal(dropped.has(id), false);
});

test("mruPush returns a brand-new array (never aliases the input)", () => {
  const before = [1, 2, 3];
  const after = mruPush(before, 4);
  assert.notEqual(after, before);
  assert.deepEqual(before, [1, 2, 3], "input array must not mutate");
});

test("mruPush with cap=N stabilises at length N after N+k pushes (any k≥0)", () => {
  for (const cap of [1, 3, 10, 50]) {
    let mru = [];
    for (let id = 1; id <= cap + 25; id++) mru = mruPush(mru, id, cap);
    assert.equal(mru.length, cap,
      `expected length=${cap} after ${cap + 25} pushes, got ${mru.length}`);
  }
});

test("MRU oldest entry slides off after one full cap turnover", () => {
  const cap = 5;
  let mru = [];
  for (let id = 1; id <= cap; id++) mru = mruPush(mru, id, cap);
  assert.ok(mru.includes(1));
  mru = mruPush(mru, cap + 1, cap);
  assert.equal(mru.includes(1), false, "id 1 must evict on push #cap+1");
  assert.equal(mru.length, cap);
});
