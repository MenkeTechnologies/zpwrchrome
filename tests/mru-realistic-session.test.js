// Realistic browser-session simulations through mruPush/mruDrop/mruStep/
// mruPrevious. Each test models a sequence a real user could trigger and
// asserts the resulting MRU state matches expectations — catches drift
// between the helpers and the real Chrome lifecycle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mruPush, mruDrop, mruStep, mruPrevious } from "../lib/util.js";

test("session: opening 5 tabs sequentially places newest at head", () => {
  let mru = [];
  for (const id of [101, 102, 103, 104, 105]) mru = mruPush(mru, id);
  assert.deepEqual(mru, [105, 104, 103, 102, 101]);
});

test("session: switching back to a middle tab promotes it to the head", () => {
  let mru = [];
  for (const id of [101, 102, 103, 104, 105]) mru = mruPush(mru, id);
  // User clicks tab 102 → service worker pushes it.
  mru = mruPush(mru, 102);
  assert.deepEqual(mru, [102, 105, 104, 103, 101]);
});

test("session: closing the active tab drops it; previous becomes the next head on switch", () => {
  let mru = [];
  for (const id of [101, 102, 103]) mru = mruPush(mru, id);
  // Active is 103. User closes it (chrome.tabs.onRemoved).
  mru = mruDrop(mru, 103);
  assert.deepEqual(mru, [102, 101]);
  // mruPrevious from a tab not in the list returns the head — which is the
  // tab Chrome will focus next.
  assert.equal(mruPrevious(mru, 999), 102);
});

test("session: alt-tab cycling forward through 4 tabs visits each exactly once before wrapping", () => {
  let mru = [];
  for (const id of [1, 2, 3, 4]) mru = mruPush(mru, id);
  // head is 4. Forward step from 4 → 3, then 3 → 2, then 2 → 1, then 1 → 4.
  let cur = mru[0];
  const visited = [cur];
  for (let i = 0; i < 4; i++) {
    cur = mruStep(mru, cur, +1);
    visited.push(cur);
  }
  assert.deepEqual(visited, [4, 3, 2, 1, 4]);
});

test("session: rapid open-and-close churn (10 cycles) stays bounded in length", () => {
  let mru = [];
  for (let i = 0; i < 10; i++) {
    mru = mruPush(mru, 500 + i);
    mru = mruDrop(mru, 500 + i);
  }
  assert.deepEqual(mru, []);
});

test("session: closing a non-active tab leaves the active head untouched", () => {
  let mru = [];
  for (const id of [10, 20, 30]) mru = mruPush(mru, id);
  // Head is 30. Close tab 10 (not active).
  mru = mruDrop(mru, 10);
  assert.deepEqual(mru, [30, 20]);
  // Active stays at head.
  assert.equal(mru[0], 30);
});

test("session: reopening a closed tab gets a brand-new id (push prepends)", () => {
  let mru = [];
  for (const id of [10, 20, 30]) mru = mruPush(mru, id);
  mru = mruDrop(mru, 20);                     // user closes tab 20
  mru = mruPush(mru, 99);                      // session-restore creates new id
  assert.deepEqual(mru, [99, 30, 10]);
});

test("session: cross-window switching is order-preserving (id only, not window)", () => {
  // chrome.tabs.onActivated fires across windows. Pin that mruPush doesn't
  // care which window the id belongs to.
  let mru = [];
  mru = mruPush(mru, 101);    // window A, tab 101
  mru = mruPush(mru, 201);    // window B, tab 201
  mru = mruPush(mru, 101);    // user switches back to window A
  assert.deepEqual(mru, [101, 201]);
});

test("session: mruPrevious gives the right answer for Ctrl+E (alt-tab to previous)", () => {
  // Simulates user pressing Ctrl+E. mruPrevious returns the tab to switch to.
  let mru = [];
  for (const id of [100, 200, 300]) mru = mruPush(mru, id);
  // Head is 300, previous (target of Ctrl+E) is 200.
  assert.equal(mruPrevious(mru, 300), 200);
});

test("session: long-lived user with 250 distinct tabs caps stack at MRU_CAP_DEFAULT", () => {
  let mru = [];
  for (let id = 1; id <= 250; id++) mru = mruPush(mru, id);
  // Cap is 200. Oldest 50 ids must have been evicted.
  assert.equal(mru.length, 200);
  // Verify ids 1..50 evicted; ids 51..250 present.
  for (let id = 1; id <= 50; id++) assert.equal(mru.includes(id), false, `id ${id} should be evicted`);
  for (let id = 51; id <= 250; id++) assert.ok(mru.includes(id), `id ${id} should be present`);
});

test("session: chrome.tabs.onReplaced (id change) acts as drop + push roundtrip", () => {
  // When a tab is replaced (prerender → real), Chrome fires onReplaced
  // with (added, removed). The service worker drops the old, pushes the new.
  let mru = [];
  for (const id of [10, 20, 30]) mru = mruPush(mru, id);
  // Replace 20 → 22.
  mru = mruDrop(mru, 20);
  mru = mruPush(mru, 22);
  assert.deepEqual(mru, [22, 30, 10]);
});
