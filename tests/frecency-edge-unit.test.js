// frecencyScore edge cases beyond util-frecency-more.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { frecencyScore } from "../lib/util.js";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

test("frecencyScore with only typedCount uses 2x weight per typed visit", () => {
  const score = frecencyScore({ typedCount: 5, visitCount: 0, lastVisitTime: NOW - HOUR }, NOW);
  assert.equal(score, 10 / (1 + 2));
});

test("frecencyScore visitCount alone contributes without typed multiplier", () => {
  const score = frecencyScore({ visitCount: 4, lastVisitTime: NOW - HOUR }, NOW);
  assert.equal(score, 4 / (1 + 2));
});

test("frecencyScore very old visit approaches zero score", () => {
  const old = frecencyScore({ visitCount: 100, lastVisitTime: NOW - 365 * 24 * HOUR }, NOW);
  const recent = frecencyScore({ visitCount: 100, lastVisitTime: NOW - HOUR }, NOW);
  assert.ok(recent > old);
  assert.ok(old < 1);
});

test("frecencyScore same item scored twice at same now is stable", () => {
  const item = { visitCount: 3, typedCount: 1, lastVisitTime: NOW - 2 * HOUR };
  assert.equal(frecencyScore(item, NOW), frecencyScore(item, NOW));
});

test("frecencyScore missing lastVisitTime uses visits-only numerator", () => {
  assert.equal(frecencyScore({ visitCount: 2 }, NOW), 2);
});

test("frecencyScore hoursAgo denominator is at least 1", () => {
  const atNow = frecencyScore({ visitCount: 6, lastVisitTime: NOW }, NOW);
  const future = frecencyScore({ visitCount: 6, lastVisitTime: NOW + HOUR }, NOW);
  assert.equal(atNow, future);
});

test("frecencyScore higher typedCount increases score at same recency", () => {
  const manyTyped = frecencyScore({ typedCount: 10, visitCount: 0, lastVisitTime: NOW - HOUR }, NOW);
  const fewTyped  = frecencyScore({ typedCount: 1, visitCount: 0, lastVisitTime: NOW - HOUR }, NOW);
  assert.ok(manyTyped > fewTyped);
});

test("frecencyScore combined visits and typed sum in numerator", () => {
  const score = frecencyScore({ visitCount: 2, typedCount: 3, lastVisitTime: NOW - 2 * HOUR }, NOW);
  assert.equal(score, (2 + 6) / (2 + 2));
});

test("frecencyScore single visit one hour ago uses hoursAgo plus 2 denominator", () => {
  assert.equal(frecencyScore({ visitCount: 1, lastVisitTime: NOW - HOUR }, NOW), 1 / 3);
});

test("frecencyScore undefined typedCount treated as zero", () => {
  const a = frecencyScore({ visitCount: 3, lastVisitTime: NOW - HOUR }, NOW);
  const b = frecencyScore({ visitCount: 3, typedCount: undefined, lastVisitTime: NOW - HOUR }, NOW);
  assert.equal(a, b);
});

test("frecencyScore returns number not NaN for minimal item shape", () => {
  const s = frecencyScore({ visitCount: 1, lastVisitTime: NOW }, NOW);
  assert.ok(Number.isFinite(s));
});

test("frecencyScore recent high-traffic beats old moderate traffic", () => {
  const recentHeavy = frecencyScore({ visitCount: 20, lastVisitTime: NOW - HOUR }, NOW);
  const oldModerate = frecencyScore({ visitCount: 50, lastVisitTime: NOW - 720 * HOUR }, NOW);
  assert.ok(recentHeavy > oldModerate);
});
