// Pin flattenTree's tolerance of the various shapes a caller may pass for
// the `collapsed` argument. The util coerces (Set | object | falsy) into a
// Set of numeric ids — the array case is the easy footgun: Object.keys on an
// array yields *positional indices*, not element values, so a stale caller
// that hands in an array of tab ids would silently skip the wrong nodes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTabTree, flattenTree } from "../lib/util.js";

// 1 → 2 → 4, 1 → 3 (two siblings under 1, one grandchild under 2)
const TABS = [
  { id: 1 },
  { id: 2, openerTabId: 1 },
  { id: 3, openerTabId: 1 },
  { id: 4, openerTabId: 2 },
];

function flattenIds(collapsed) {
  const { roots } = buildTabTree(TABS);
  return flattenTree(roots, collapsed).map((e) => e.tab.id);
}

test("flattenTree with collapsed=undefined emits every node", () => {
  assert.deepEqual(flattenIds(undefined), [1, 2, 4, 3]);
});

test("flattenTree with collapsed=null emits every node", () => {
  assert.deepEqual(flattenIds(null), [1, 2, 4, 3]);
});

test("flattenTree with empty Set emits every node", () => {
  assert.deepEqual(flattenIds(new Set()), [1, 2, 4, 3]);
});

test("flattenTree with Set({2}) hides descendants of 2", () => {
  assert.deepEqual(flattenIds(new Set([2])), [1, 2, 3]);
});

test("flattenTree with plain-object collapsed uses keys as numeric ids", () => {
  assert.deepEqual(flattenIds({ 2: true }), [1, 2, 3]);
});

test("flattenTree object form ignores non-numeric keys (NaN coercion is fine)", () => {
  // "abc" → NaN → never matches a real id, so no skip happens.
  assert.deepEqual(flattenIds({ abc: true }), [1, 2, 4, 3]);
});

test("flattenTree with collapsed=ARRAY skips positional indices not values", () => {
  // Object.keys([10]) === ["0"]; map(Number) → [0]. Tab id 0 doesn't exist
  // in the tree, so passing the tab id 10 as a single-element array
  // collapses *nothing*. This pins the surprising semantics so a future
  // caller doesn't assume arrays of *ids* work the same as a Set of ids.
  assert.deepEqual(flattenIds([10]), [1, 2, 4, 3]);
});

test("flattenTree with collapsed=ARRAY whose positional index matches a real id", () => {
  // Length-3 array → keys ["0","1","2"] → skip ids 0, 1, 2. Root id 1 still
  // emits its own row (collapsed:true) but its subtree is hidden.
  const out = flattenIds(["a", "b", "c"]);
  assert.deepEqual(out, [1]);
});

test("flattenTree marks collapsed flag when id is in skip set", () => {
  const { roots } = buildTabTree(TABS);
  const out = flattenTree(roots, new Set([2]));
  const node2 = out.find((e) => e.tab.id === 2);
  assert.equal(node2.collapsed, true);
  assert.equal(node2.hasChildren, true);
});

test("flattenTree depth is zero for roots and increments by one per level", () => {
  const { roots } = buildTabTree(TABS);
  const out = flattenTree(roots);
  const byId = new Map(out.map((e) => [e.tab.id, e.depth]));
  assert.equal(byId.get(1), 0);
  assert.equal(byId.get(2), 1);
  assert.equal(byId.get(3), 1);
  assert.equal(byId.get(4), 2);
});

test("flattenTree with collapsed-as-Set ignores nodes not present in tree", () => {
  // Stale collapsed id (99 doesn't exist) shouldn't affect output.
  assert.deepEqual(flattenIds(new Set([99])), [1, 2, 4, 3]);
});
