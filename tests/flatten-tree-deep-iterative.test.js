// Regression: flattenTree on a deeply-nested opener chain must not blow the
// JS call stack. The previous implementation used recursion and bottomed
// out around ~10k frames; this file pins the iterative-stack rewrite by
// running depths well past that threshold.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTabTree, flattenTree } from "../lib/util.js";

function chain(depth) {
  return Array.from({ length: depth }, (_, i) => ({
    id: i + 1,
    openerTabId: i === 0 ? undefined : i,
  }));
}

test("flattenTree on 50,000-deep opener chain returns all nodes (no stack overflow)", () => {
  const { roots } = buildTabTree(chain(50_000));
  const flat = flattenTree(roots);
  assert.equal(flat.length, 50_000);
  assert.equal(flat[0].depth, 0);
  assert.equal(flat[flat.length - 1].depth, 49_999);
});

test("flattenTree iterative output preserves DFS order identical to former recursive form", () => {
  // Tree:
  //   1
  //   ├── 2
  //   │   ├── 4
  //   │   └── 5
  //   └── 3
  //       └── 6
  const tabs = [
    { id: 1 },
    { id: 2, openerTabId: 1 },
    { id: 3, openerTabId: 1 },
    { id: 4, openerTabId: 2 },
    { id: 5, openerTabId: 2 },
    { id: 6, openerTabId: 3 },
  ];
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots);
  assert.deepEqual(flat.map((e) => e.tab.id), [1, 2, 4, 5, 3, 6]);
});

test("flattenTree on 30k-deep chain with mid-chain collapse honors the cutoff", () => {
  const tabs = chain(30_000);
  const { roots } = buildTabTree(tabs);
  // Collapse node 5000; everything below it (5001..30000) must disappear.
  const flat = flattenTree(roots, new Set([5000]));
  assert.equal(flat.length, 5000);
  assert.equal(flat[4999].tab.id, 5000);
  assert.equal(flat[4999].collapsed, true);
});

test("flattenTree on a wide+deep tree (1000 roots, 100 deep each) finishes < 1s", () => {
  const tabs = [];
  let id = 1;
  const rootIds = [];
  for (let r = 0; r < 1000; r++) {
    const rid = id++;
    rootIds.push(rid);
    tabs.push({ id: rid });
    let parent = rid;
    for (let d = 0; d < 99; d++) {
      const cid = id++;
      tabs.push({ id: cid, openerTabId: parent });
      parent = cid;
    }
  }
  const { roots } = buildTabTree(tabs);
  const start = process.hrtime.bigint();
  const flat = flattenTree(roots);
  const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.equal(flat.length, 100_000);
  assert.ok(elapsed < 1000, `100k-node flatten took ${elapsed.toFixed(1)}ms`);
});
