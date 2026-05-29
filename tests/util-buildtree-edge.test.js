// buildTabTree resilience tests that complement logic-tree-more.test.js:
// opener pointing at a non-existent tab, deep five-level chains, self-opener
// guard, mutual-cycle behavior, mixed orphans + chains, and openerTabId === 0.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTabTree, flattenTree } from "../lib/util.js";

function ids(roots) {
  return flattenTree(roots).map((e) => e.tab.id);
}

test("buildTabTree re-roots tab whose openerTabId points at a non-existent tab", () => {
  const tabs = [
    { id: 10, openerTabId: 999 }, // 999 not in set → root
    { id: 11, openerTabId: 10 },
  ];
  const { roots } = buildTabTree(tabs);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].tab.id, 10);
  assert.equal(roots[0].children[0].tab.id, 11);
});

test("buildTabTree preserves a five-level opener chain in order", () => {
  const tabs = [
    { id: 1 },
    { id: 2, openerTabId: 1 },
    { id: 3, openerTabId: 2 },
    { id: 4, openerTabId: 3 },
    { id: 5, openerTabId: 4 },
  ];
  const { roots } = buildTabTree(tabs);
  assert.deepEqual(ids(roots), [1, 2, 3, 4, 5]);
});

test("buildTabTree treats a self-opener tab as a root (parent === node guard)", () => {
  const tabs = [{ id: 7, openerTabId: 7 }];
  const { roots } = buildTabTree(tabs);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].tab.id, 7);
  assert.deepEqual(roots[0].children, []);
});

test("buildTabTree mutual A↔B cycle leaves both nodes parented by the other", () => {
  // Each tab finds the other as a valid parent. Neither becomes a root.
  // flattenTree(roots) produces [] (no roots to walk) — pin this so a future
  // refactor that "fixes" cycles by promoting one side stays intentional.
  const tabs = [
    { id: 1, openerTabId: 2 },
    { id: 2, openerTabId: 1 },
  ];
  const { roots } = buildTabTree(tabs);
  assert.equal(roots.length, 0);
  assert.deepEqual(flattenTree(roots), []);
});

test("buildTabTree mixes orphan roots and parented children correctly", () => {
  const tabs = [
    { id: 100 },                       // orphan root
    { id: 200, openerTabId: 100 },     // child of 100
    { id: 300 },                       // orphan root
    { id: 400, openerTabId: 999 },     // stale opener → root
  ];
  const { roots } = buildTabTree(tabs);
  const rootIds = roots.map((n) => n.tab.id);
  assert.deepEqual(rootIds.sort(), [100, 300, 400]);
});

test("buildTabTree treats openerTabId=0 as parent lookup at id 0 (root if absent)", () => {
  // typeof 0 === "number" so the lookup happens; byId.get(0) is undefined,
  // so the tab falls through to roots. Pin so a future "treat 0 as no-parent"
  // optimization stays explicit.
  const tabs = [{ id: 50, openerTabId: 0 }];
  const { roots } = buildTabTree(tabs);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].tab.id, 50);
});

test("buildTabTree treats openerTabId=0 as the parent when a tab with id=0 exists", () => {
  // Chrome never assigns tab id 0 in practice, but the helper has no special
  // case — if a fixture creates one, it acts as a normal parent.
  const tabs = [
    { id: 0 },
    { id: 1, openerTabId: 0 },
  ];
  const { roots } = buildTabTree(tabs);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].tab.id, 0);
  assert.equal(roots[0].children[0].tab.id, 1);
});

test("buildTabTree skips tabs with non-numeric id but processes the rest", () => {
  const tabs = [
    { id: 1 },
    { id: "two" },              // skipped (typeof id !== "number")
    { id: 3, openerTabId: 1 },  // valid child of 1
    null,                        // skipped
    undefined,                   // skipped
  ];
  const { roots, byId } = buildTabTree(tabs);
  assert.equal(byId.size, 2);
  assert.deepEqual(roots.map((r) => r.tab.id), [1]);
  assert.deepEqual(roots[0].children.map((c) => c.tab.id), [3]);
});

test("buildTabTree byId map exposes every numeric-id node for direct lookup", () => {
  const tabs = [
    { id: 1 },
    { id: 2, openerTabId: 1 },
    { id: 3, openerTabId: 2 },
  ];
  const { byId } = buildTabTree(tabs);
  assert.equal(byId.get(1).tab.id, 1);
  assert.equal(byId.get(2).tab.id, 2);
  assert.equal(byId.get(3).tab.id, 3);
  assert.equal(byId.get(99), undefined);
});

test("buildTabTree input is not mutated by the construction pass", () => {
  const t1 = { id: 1 };
  const t2 = { id: 2, openerTabId: 1 };
  const original = [t1, t2];
  const copy = original.map((t) => ({ ...t }));
  buildTabTree(original);
  assert.deepEqual(original, copy, "input tab objects must not gain children property");
  assert.equal(t1.children, undefined);
  assert.equal(t2.children, undefined);
});

test("buildTabTree non-array input yields empty roots and empty byId", () => {
  assert.deepEqual(buildTabTree(null).roots, []);
  assert.equal(buildTabTree(undefined).byId.size, 0);
  assert.equal(buildTabTree("not an array").byId.size, 0);
});
