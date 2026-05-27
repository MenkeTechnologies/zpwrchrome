// buildTabTree and flattenTree additional behavioral unit tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTabTree, flattenTree } from "../lib/util.js";

test("buildTabTree with null input coerces to empty forest", () => {
  const { roots, byId } = buildTabTree(null);
  assert.deepEqual(roots, []);
  assert.equal(byId.size, 0);
});

test("buildTabTree skips entries missing numeric id", () => {
  const { roots, byId } = buildTabTree([{ title: "no id" }, { id: 1 }]);
  assert.equal(roots.length, 1);
  assert.equal(byId.size, 1);
});

test("buildTabTree multiple roots preserve input order", () => {
  const { roots } = buildTabTree([{ id: 3 }, { id: 1 }, { id: 2 }]);
  assert.deepEqual(roots.map((n) => n.tab.id), [3, 1, 2]);
});

test("buildTabTree deep opener chain nests three levels", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }, { id: 3, openerTabId: 2 }];
  const { roots } = buildTabTree(tabs);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].children[0].children[0].tab.id, 3);
});

test("flattenTree collapsed set hides all descendants of collapsed node", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }, { id: 3, openerTabId: 2 }];
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots, new Set([1]));
  assert.deepEqual(flat.map((n) => n.tab.id), [1]);
});

test("flattenTree marks collapsed true when node id is in skip set", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }];
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots, new Set([1]));
  assert.equal(flat[0].collapsed, true);
});

test("flattenTree depth increments by one per tree level", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }];
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots, new Set());
  assert.deepEqual(flat.map((n) => n.depth), [0, 1]);
});

test("flattenTree empty roots returns empty list", () => {
  assert.deepEqual(flattenTree([], new Set()), []);
});

test("buildTabTree byId map contains every valid tab node", () => {
  const tabs = [{ id: 10 }, { id: 11, openerTabId: 10 }];
  const { byId } = buildTabTree(tabs);
  assert.ok(byId.has(10));
  assert.ok(byId.has(11));
});

test("flattenTree object-shaped collapsed skips numeric string keys", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }, { id: 3, openerTabId: 2 }];
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots, { 2: true });
  assert.deepEqual(flat.map((n) => n.tab.id), [1, 2]);
});

test("buildTabTree sibling tabs under same opener stay in insertion order", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }, { id: 3, openerTabId: 1 }];
  const { roots } = buildTabTree(tabs);
  assert.deepEqual(roots[0].children.map((n) => n.tab.id), [2, 3]);
});

test("flattenTree hasChildren false on leaf nodes", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }];
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots, new Set());
  assert.equal(flat[1].hasChildren, false);
});
