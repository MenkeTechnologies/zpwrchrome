// frecencyScore extremes + ranking-corpus tests. The existing
// util-frecency-more + frecency-edge-unit + logic-more files cover the
// per-input formula; this file pins behavior on extreme inputs and on
// composed ranking over a realistic history corpus.

import { test } from "node:test";
import assert from "node:assert/strict";
import { frecencyScore } from "../lib/util.js";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const DAY  = 24 * HOUR;

test("frecencyScore handles a 100,000-visit history item without overflow", () => {
  const score = frecencyScore({ visitCount: 100_000, lastVisitTime: NOW - HOUR }, NOW);
  assert.ok(Number.isFinite(score), `score must be finite, got ${score}`);
  assert.ok(score > 0);
});

test("frecencyScore decays smoothly across a year of staleness", () => {
  // Pin that very old visits still produce a positive score (no flooring
  // to zero) — the minimap and history ranker rely on relative ordering.
  const oneYear = frecencyScore({ visitCount: 10, lastVisitTime: NOW - 365 * DAY }, NOW);
  assert.ok(oneYear > 0,
    `year-old visit should still rank > 0, got ${oneYear}`);
  // And it should be a small fraction of the same item visited an hour ago.
  const recent = frecencyScore({ visitCount: 10, lastVisitTime: NOW - HOUR }, NOW);
  assert.ok(recent > oneYear * 50,
    `recent should dominate stale by ≥50x (got recent=${recent}, year=${oneYear})`);
});

test("frecencyScore null item returns 0 without throwing", () => {
  assert.equal(frecencyScore(null, NOW), 0);
  assert.equal(frecencyScore(undefined, NOW), 0);
});

test("frecencyScore lastVisitTime exactly == now produces a positive score", () => {
  const score = frecencyScore({ visitCount: 1, lastVisitTime: NOW }, NOW);
  assert.equal(score, 1 / 2, "hoursAgo=0 → denominator (0 + 2) = 2");
});

test("frecencyScore ranking over a typical corpus matches expected order", () => {
  // Realistic mix: a few high-visit recents, some old high-visit, brand-new
  // typed visit, and stale low-visit. Pin the relative ranking.
  const items = [
    { id: "github-recent", visitCount: 80, lastVisitTime: NOW - 2 * HOUR },
    { id: "old-popular",   visitCount: 200, lastVisitTime: NOW - 30 * DAY },
    { id: "new-typed",     visitCount: 1, typedCount: 1, lastVisitTime: NOW - 5 * 60 * 1000 },
    { id: "stale-rare",    visitCount: 2, lastVisitTime: NOW - 90 * DAY },
  ];
  const ranked = [...items]
    .map((i) => ({ ...i, score: frecencyScore(i, NOW) }))
    .sort((a, b) => b.score - a.score);
  // Recent high-traffic should be top.
  assert.equal(ranked[0].id, "github-recent",
    `expected github-recent top, got order: ${ranked.map((r) => r.id).join(",")}`);
  // Stale rare should be last.
  assert.equal(ranked[ranked.length - 1].id, "stale-rare");
});

test("frecencyScore typedCount=1 outranks visitCount=1 at identical recency", () => {
  // Typed visits double-count in the numerator (visitCount + 2*typedCount).
  const typed = frecencyScore({ visitCount: 1, typedCount: 1, lastVisitTime: NOW - HOUR }, NOW);
  const clicked = frecencyScore({ visitCount: 1, lastVisitTime: NOW - HOUR }, NOW);
  assert.ok(typed > clicked,
    `typed (${typed}) should outscore click-only (${clicked}) at same recency`);
});

test("frecencyScore one-typed-visit recently beats 50-clicks-a-week-ago", () => {
  // (1 + 2*1) / (1 + 2) = 1; vs (50) / (168 + 2) ≈ 0.294
  const newTyped = frecencyScore({ visitCount: 1, typedCount: 1, lastVisitTime: NOW - HOUR }, NOW);
  const oldHigh  = frecencyScore({ visitCount: 50, lastVisitTime: NOW - 7 * DAY }, NOW);
  assert.ok(newTyped > oldHigh,
    `recent-typed (${newTyped}) should beat week-old-clicks (${oldHigh})`);
});

test("frecencyScore 100-week-old visits still beats 1-this-morning per documented behavior", () => {
  // README/util.js: "a hundred visits last week still beats a one-off visit
  // this morning." Pin the comparison.
  const stale = frecencyScore({ visitCount: 100, lastVisitTime: NOW - 7 * DAY }, NOW);
  const fresh = frecencyScore({ visitCount: 1, lastVisitTime: NOW - 2 * HOUR }, NOW);
  assert.ok(stale > fresh,
    `100 visits/week (${stale}) should beat 1 visit/2h (${fresh})`);
});

test("frecencyScore preserves ordering when called with the same nowMs across items", () => {
  // Determinism check: sorting a corpus by score yields the same order on
  // repeated runs — the formula has no random component.
  const items = Array.from({ length: 20 }, (_, i) => ({
    visitCount: (i * 7) % 50 + 1,
    typedCount: i % 3,
    lastVisitTime: NOW - ((i * 13) % 200) * HOUR,
  }));
  const orderA = items.map((it) => frecencyScore(it, NOW));
  const orderB = items.map((it) => frecencyScore(it, NOW));
  assert.deepEqual(orderA, orderB);
});

test("frecencyScore lastVisitTime well in the future is clamped (no negative hoursAgo)", () => {
  // hoursAgo = max(0, (now - lastVisit) / 3.6M). A future lastVisitTime
  // becomes negative under (now - last), then clamps to 0.
  const future = frecencyScore({ visitCount: 5, lastVisitTime: NOW + 10 * DAY }, NOW);
  const atNow  = frecencyScore({ visitCount: 5, lastVisitTime: NOW }, NOW);
  assert.equal(future, atNow,
    "future lastVisitTime should clamp to hoursAgo=0 (== now)");
});

test("frecencyScore strict monotone: increasing visitCount only increases score", () => {
  const at = (n) => frecencyScore({ visitCount: n, lastVisitTime: NOW - HOUR }, NOW);
  for (let n = 1; n < 10; n++) {
    assert.ok(at(n + 1) > at(n),
      `score must strictly grow with visitCount (n=${n}, at(n)=${at(n)}, at(n+1)=${at(n + 1)})`);
  }
});
