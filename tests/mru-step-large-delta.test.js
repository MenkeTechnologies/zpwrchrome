// Regression: mruStep with |delta| ≥ mru.length must still wrap into a
// valid list member. JS's % preserves the sign of the dividend, so the
// previous single-mod formula returned undefined for negative deltas whose
// absolute value exceeded the list length. The fuzz suite caught it; this
// file pins the fix permanently.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mruStep } from "../lib/util.js";

const MRU = [10, 20, 30, 40, 50];

test("mruStep delta=-10 on length-5 list wraps to a valid member (not undefined)", () => {
  // idx=0 (currentId 10), delta=-10. With single-mod: (0 + -10 + 5) % 5 = -5
  // % 5 = -5 in JS → mru[-5] = undefined. With double-mod: 0.
  assert.equal(mruStep(MRU, 10, -10), 10);
});

test("mruStep delta=-7 on length-5 list wraps via double-mod (not undefined)", () => {
  // idx=0, delta=-7. (-7 % 5 + 5) % 5 = (-2 + 5) % 5 = 3 → mru[3] = 40.
  assert.equal(mruStep(MRU, 10, -7), 40);
});

test("mruStep delta=+25 on length-5 list wraps via full rotations to same id", () => {
  // 25 mod 5 = 0 → same position.
  assert.equal(mruStep(MRU, 30, 25), 30);
});

test("mruStep delta=-25 on length-5 list wraps via 5 full backward rotations", () => {
  assert.equal(mruStep(MRU, 30, -25), 30);
});

test("mruStep large positive delta is equivalent to delta mod length", () => {
  assert.equal(
    mruStep(MRU, 20, 1003),    // 1003 mod 5 = 3
    mruStep(MRU, 20, 3),
  );
});

test("mruStep large negative delta is equivalent to delta mod length", () => {
  // -1003 mod 5 in math = 2 (Python convention). Double-mod gives the same.
  assert.equal(
    mruStep(MRU, 20, -1003),
    mruStep(MRU, 20, 2),         // forward 2 from idx 1 → idx 3 → mru[3] = 40
  );
});

test("mruStep result is always defined when mru.length >= 2 and currentId is known", () => {
  for (const delta of [-100, -50, -10, -1, 0, 1, 10, 50, 100]) {
    for (const curId of MRU) {
      assert.notEqual(mruStep(MRU, curId, delta), undefined,
        `delta=${delta} curId=${curId} returned undefined`);
    }
  }
});
