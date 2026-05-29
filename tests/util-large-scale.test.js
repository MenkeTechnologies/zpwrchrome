// Large-scale correctness tests for the pure helpers. The per-input edge
// tests cover small cases; this file exercises realistic sizes to catch
// O(N²) regressions and walking-the-whole-list invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mruPush,
  mruDrop,
  buildTabTree,
  flattenTree,
  domainHueFor,
  frecencyScore,
  MRU_CAP_DEFAULT,
} from "../lib/util.js";
import { fzfMatch } from "../lib/fzf.js";

test("mruPush remains correct under 10,000 random-id pushes (final length capped)", () => {
  let mru = [];
  const ids = Array.from({ length: 10_000 }, (_, i) => ((i * 1103515245 + 12345) >>> 0) % 5000);
  for (const id of ids) mru = mruPush(mru, id);
  assert.ok(mru.length <= MRU_CAP_DEFAULT,
    `length=${mru.length} > cap=${MRU_CAP_DEFAULT}`);
  // No duplicates after the dedup invariant.
  assert.equal(new Set(mru).size, mru.length, "MRU must hold unique ids");
});

test("mruPush followed by mruDrop of every id leaves an empty stack", () => {
  let mru = [];
  for (let id = 0; id < 1000; id++) mru = mruPush(mru, id, 500);
  for (let id = 0; id < 1000; id++) mru = mruDrop(mru, id);
  assert.deepEqual(mru, []);
});

test("buildTabTree on a 500-node flat sibling forest yields 500 roots", () => {
  const tabs = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
  const { roots } = buildTabTree(tabs);
  assert.equal(roots.length, 500);
});

test("flattenTree on a 500-deep chain visits every node in depth order", () => {
  const tabs = Array.from({ length: 500 }, (_, i) => ({
    id: i + 1,
    openerTabId: i === 0 ? undefined : i,
  }));
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots);
  assert.equal(flat.length, 500);
  // Depth must increment by 1 per level, starting from 0.
  for (let i = 0; i < flat.length; i++) {
    assert.equal(flat[i].depth, i,
      `node ${i + 1} should be at depth ${i}, got ${flat[i].depth}`);
  }
});

test("flattenTree on a wide bushy tree (1 root, 100 children) visits 101 nodes", () => {
  const tabs = [{ id: 1 }];
  for (let id = 2; id <= 101; id++) tabs.push({ id, openerTabId: 1 });
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots);
  assert.equal(flat.length, 101);
  assert.equal(flat[0].depth, 0);
  // Every other node is depth 1.
  for (let i = 1; i < flat.length; i++) {
    assert.equal(flat[i].depth, 1, `child ${i} must be at depth 1`);
  }
});

test("flattenTree collapsing every interior node keeps only roots in output", () => {
  // Three roots, each with 10 children.
  const tabs = [];
  let id = 1;
  const rootIds = [];
  for (let r = 0; r < 3; r++) {
    const rootId = id++;
    rootIds.push(rootId);
    tabs.push({ id: rootId });
    for (let c = 0; c < 10; c++) tabs.push({ id: id++, openerTabId: rootId });
  }
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots, new Set(rootIds));
  // Roots emit (collapsed:true) but no children.
  assert.equal(flat.length, 3);
  assert.deepEqual(flat.map((e) => e.tab.id), rootIds);
  for (const node of flat) assert.equal(node.collapsed, true);
});

test("domainHueFor over a 200-host corpus yields ≥ 50 distinct hues", () => {
  // 200 made-up host names. With djb2 → mod 360, real spread is good.
  const hues = new Set();
  for (let i = 0; i < 200; i++) {
    hues.add(domainHueFor(`https://host-${i}-${i * 7}.test/path`));
  }
  assert.ok(hues.size >= 50,
    `expected ≥50 distinct hues across 200 hosts, got ${hues.size}`);
});

test("frecencyScore monotonically decreasing over a sweep of staleness", () => {
  const HOUR = 3_600_000;
  const NOW = 1_700_000_000_000;
  let prev = Infinity;
  for (let h = 0; h < 168; h += 4) {  // 0..168 hours = up to a week
    const s = frecencyScore({ visitCount: 10, lastVisitTime: NOW - h * HOUR }, NOW);
    assert.ok(s <= prev,
      `score must be non-increasing as item ages; at h=${h}: ${s} > prev ${prev}`);
    prev = s;
  }
});

test("fzfMatch finds a needle near the end of a long haystack", () => {
  // 5000-char haystack with the needle planted at the end.
  const haystack = "x".repeat(5000) + "popup";
  const m = fzfMatch("popup", haystack);
  assert.notEqual(m, null);
  assert.deepEqual(m.indices, [5000, 5001, 5002, 5003, 5004]);
});

test("fzfMatch on 100 popup-list-sized haystacks completes without throwing", () => {
  // Just smoke-test that the algorithm handles a typical popup-load
  // worth of items at once.
  const items = Array.from({ length: 100 }, (_, i) => `tab-${i}-${i * 13}-render.js`);
  for (const item of items) {
    const m = fzfMatch("render", item);
    assert.notEqual(m, null);
    assert.equal(m.indices.length, "render".length);
  }
});
