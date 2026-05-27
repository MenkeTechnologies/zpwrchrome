// Additional pure-logic unit tests for lib/util.js and lib/fzf.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mruPush,
  mruDrop,
  mruStep,
  mruPrevious,
  hostnameOf,
  resolveJumpIndex,
  resolveSceneOrdinal,
  buildScene,
  upsertScene,
  buildTabTree,
  flattenTree,
  domainHueFor,
  frecencyScore,
  MRU_CAP_DEFAULT
} from "../lib/util.js";
import { fzfMatch, fzfCharClass, fzfPositionBonus, FZF_BONUS_CAMEL } from "../lib/fzf.js";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

test("mruPush with cap=1 keeps only the newest id", () => {
  assert.deepEqual(mruPush([1, 2, 3], 4, 1), [4]);
});

test("mruDrop on empty stack returns empty array", () => {
  assert.deepEqual(mruDrop([], 1), []);
});

test("mruStep with delta 0 returns same id (mod length unchanged)", () => {
  assert.equal(mruStep([10, 20, 30], 20, 0), 20);
});

test("mruPrevious on two-element stack returns the non-current id", () => {
  assert.equal(mruPrevious([10, 20], 10), 20);
  assert.equal(mruPrevious([10, 20], 20), 10);
});

test("hostnameOf parses bracketed IPv6 URLs", () => {
  assert.equal(hostnameOf("https://[::1]/path"), "[::1]");
});

test("resolveJumpIndex jump-to-1 on 3-tab window returns index 0", () => {
  assert.equal(resolveJumpIndex("jump-to-1", 3), 0);
});

test("resolveJumpIndex jump-to-9 on 3-tab window returns index 2", () => {
  assert.equal(resolveJumpIndex("jump-to-9", 3), 2);
});

test("resolveSceneOrdinal restore-scene-3 on 5 scenes returns index 2", () => {
  assert.equal(resolveSceneOrdinal("restore-scene-3", 5), 2);
});

test("buildScene slugifies unicode names to ASCII kebab segments", () => {
  const s = buildScene("Café Launch", [{ url: "https://a/" }]);
  assert.equal(s.slug, "caf-launch");
});

test("buildScene skips tabs with empty url and pendingUrl", () => {
  const s = buildScene("x", [{ url: "", pendingUrl: "" }, { url: "https://ok/" }]);
  assert.equal(s.tabs.length, 1);
});

test("upsertScene replaces existing slug in-place at front", () => {
  const a = { slug: "a", tabs: [{ url: "https://old/" }] };
  const b = { slug: "b", tabs: [] };
  const after = upsertScene([a, b], { slug: "a", tabs: [{ url: "https://new/" }] });
  assert.equal(after[0].tabs[0].url, "https://new/");
  assert.equal(after.length, 2);
});

test("buildTabTree preserves sibling order under the same parent", () => {
  const tabs = [
    { id: 1 },
    { id: 2, openerTabId: 1 },
    { id: 3, openerTabId: 1 },
  ];
  const { roots } = buildTabTree(tabs);
  assert.deepEqual(roots[0].children.map((n) => n.tab.id), [2, 3]);
});

test("flattenTree depth increments by 1 per tree level", () => {
  const tabs = [{ id: 1 }, { id: 2, openerTabId: 1 }, { id: 3, openerTabId: 2 }];
  const { roots } = buildTabTree(tabs);
  const flat = flattenTree(roots, new Set());
  assert.deepEqual(flat.map((n) => n.depth), [0, 1, 2]);
});

test("domainHueFor returns same hue for http and https on same host", () => {
  assert.equal(domainHueFor("http://example.com/a"), domainHueFor("https://example.com/b"));
});

test("frecencyScore with only typedCount uses 2x weight in numerator", () => {
  const score = frecencyScore({ visitCount: 0, typedCount: 5, lastVisitTime: NOW - HOUR }, NOW);
  assert.ok(Math.abs(score - 10 / 3) < 1e-9);
});

test("fzfCharClass classifies underscore as non-word", () => {
  assert.equal(fzfCharClass("_"), 0);
});

test("fzfPositionBonus detects camelCase boundary (a→B)", () => {
  assert.equal(fzfPositionBonus("a", "B"), FZF_BONUS_CAMEL);
});

test("fzfMatch returns null when needle is empty string is handled (score 0)", () => {
  assert.deepEqual(fzfMatch("", "anything"), { score: 0, indices: [] });
});

test("fzfMatch finds needle at end of long haystack", () => {
  const m = fzfMatch("chrome", "zpwrchrome");
  assert.ok(m);
  assert.ok(m.indices.includes(4));
});
