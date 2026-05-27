// buildTabTree / flattenTree behavioral edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTabTree, flattenTree } from "../lib/util.js";

test("buildTabTree with empty array returns empty roots", () => {
  const { roots, byId } = buildTabTree([]);
  assert.deepEqual(roots, []);
  assert.equal(byId.size, 0);
});

test("buildTabTree single tab is a root with no children", () => {
  const { roots } = buildTabTree([{ id: 1, title: "solo" }]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].tab.id, 1);
  assert.deepEqual(roots[0].children, []);
});

test("buildTabTree nests child under opener when parent exists", () => {
  const { roots } = buildTabTree([
    { id: 1 }, { id: 2, openerTabId: 1 }
  ]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].children.length, 1);
  assert.equal(roots[0].children[0].tab.id, 2);
});

test("buildTabTree treats missing opener as root even if openerTabId set", () => {
  const { roots } = buildTabTree([{ id: 2, openerTabId: 999 }]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].tab.id, 2);
});

test("buildTabTree prevents self-parent by re-rooting cyclic opener", () => {
  const { roots } = buildTabTree([{ id: 1, openerTabId: 1 }]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].children.length, 0);
});

test("flattenTree marks hasChildren true on nodes with kids", () => {
  const { roots } = buildTabTree([{ id: 1 }, { id: 2, openerTabId: 1 }]);
  const flat = flattenTree(roots, new Set());
  assert.equal(flat[0].hasChildren, true);
  assert.equal(flat[1].hasChildren, false);
});

test("flattenTree collapsed flag mirrors membership in collapsed set", () => {
  const { roots } = buildTabTree([{ id: 1 }, { id: 2, openerTabId: 1 }]);
  const flat = flattenTree(roots, new Set([1]));
  assert.equal(flat[0].collapsed, true);
});

test("flattenTree depth increases for nested opener chain", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }, { id: 3, openerTabId: 2 }];
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots, new Set());
  assert.deepEqual(flat.map((n) => n.depth), [0, 1, 2]);
});

test("flattenTree with null collapsed coerces to empty skip set", () => {
  const { roots } = buildTabTree([{ id: 1 }, { id: 2, openerTabId: 1 }]);
  const flat = flattenTree(roots, null);
  assert.equal(flat.length, 2);
});

test("flattenTree object-shaped collapsed map skips numeric string keys", () => {
  const { roots } = buildTabTree([{ id: 1 }, { id: 2, openerTabId: 1 }, { id: 3, openerTabId: 2 }]);
  const flat = flattenTree(roots, { "2": true });
  assert.equal(flat.length, 2);
  assert.deepEqual(flat.map((n) => n.tab.id), [1, 2]);
});

test("buildTabTree preserves sibling order under same parent", () => {
  const { roots } = buildTabTree([
    { id: 1 }, { id: 2, openerTabId: 1 }, { id: 3, openerTabId: 1 }
  ]);
  assert.deepEqual(roots[0].children.map((n) => n.tab.id), [2, 3]);
});

test("flattenTree visiting collapsed parent hides all descendants", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }, { id: 3, openerTabId: 2 }];
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots, new Set([1]));
  assert.deepEqual(flat.map((n) => n.tab.id), [1]);
});

test("buildTabTree byId map contains every valid tab id", () => {
  const tabs = [{ id: 10 }, { id: 20, openerTabId: 10 }];
  const { byId } = buildTabTree(tabs);
  assert.ok(byId.has(10));
  assert.ok(byId.has(20));
});

test("flattenTree empty roots returns empty list", () => {
  assert.deepEqual(flattenTree([], new Set()), []);
});
