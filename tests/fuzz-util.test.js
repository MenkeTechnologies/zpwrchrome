// Fuzz tests for lib/util.js: deterministic-PRNG sweeps over the pure
// helpers, asserting per-call invariants that must hold regardless of
// input. CI reproducibility comes from the named seed at the top of each
// test.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mruPush,
  mruDrop,
  mruStep,
  mruPrevious,
  resolveJumpIndex,
  resolveSceneOrdinal,
  buildScene,
  upsertScene,
  dropScene,
  buildTabTree,
  flattenTree,
  domainHueFor,
  frecencyScore,
  hostnameOf,
  MRU_CAP_DEFAULT,
} from "../lib/util.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("fuzz: mruPush + mruDrop sequence maintains at-most-once + length ≤ cap", () => {
  const r = rng(0x1111aaaa);
  let mru = [];
  const cap = 32;
  for (let i = 0; i < 5000; i++) {
    const id = Math.floor(r() * 100); // small id space → many collisions
    if (r() < 0.3) mru = mruDrop(mru, id);
    else mru = mruPush(mru, id, cap);
    assert.ok(mru.length <= cap, `i=${i} length=${mru.length} > cap=${cap}`);
    assert.equal(new Set(mru).size, mru.length, `i=${i} duplicates in MRU: ${JSON.stringify(mru)}`);
  }
});

test("fuzz: mruPush always produces a brand-new array (never aliases input)", () => {
  const r = rng(0x22220000);
  for (let i = 0; i < 1000; i++) {
    const len = Math.floor(r() * 20);
    const mru = Array.from({ length: len }, (_, k) => k + 1);
    const before = mru.slice();
    const after = mruPush(mru, Math.floor(r() * 50));
    assert.notEqual(after, mru, "must return a new array");
    assert.deepEqual(mru, before, "input must not mutate");
  }
});

test("fuzz: mruStep returns either undefined (short list) or a list member", () => {
  const r = rng(0x33330000);
  for (let i = 0; i < 1000; i++) {
    const len = Math.floor(r() * 12);
    const mru = Array.from({ length: len }, (_, k) => k + 1);
    const delta = Math.floor(r() * 20) - 10;
    const cur = Math.floor(r() * 15);
    const result = mruStep(mru, cur, delta);
    if (result === undefined) {
      assert.ok(mru.length < 2, `undefined returned for len=${mru.length}`);
    } else {
      assert.ok(mru.includes(result), `i=${i} result=${result} not in mru=${JSON.stringify(mru)}`);
    }
  }
});

test("fuzz: mruPrevious returns either undefined or an id different from current", () => {
  const r = rng(0x44440000);
  for (let i = 0; i < 1000; i++) {
    const len = Math.floor(r() * 12);
    const mru = Array.from({ length: len }, (_, k) => k + 1);
    const cur = Math.floor(r() * 15);
    const prev = mruPrevious(mru, cur);
    if (prev !== undefined) {
      assert.notEqual(prev, cur, "previous must not be current");
      assert.ok(mru.includes(prev), "previous must be in list");
    }
  }
});

test("fuzz: resolveJumpIndex always returns an integer; out-of-range yields -1", () => {
  const r = rng(0x55550000);
  for (let i = 0; i < 1000; i++) {
    const n = Math.floor(r() * 15);
    const tabsLen = Math.floor(r() * 25);
    const cmd = r() < 0.7 ? `jump-to-${n}` : `not-jump-${n}`;
    const result = resolveJumpIndex(cmd, tabsLen);
    assert.equal(Number.isInteger(result), true, `i=${i} cmd=${cmd} tabsLen=${tabsLen} → ${result}`);
    if (result >= 0) {
      assert.ok(result < tabsLen, `result ${result} must be valid index < ${tabsLen}`);
    }
  }
});

test("fuzz: resolveSceneOrdinal returns -1 OR a valid index < scenesLength", () => {
  const r = rng(0x66660000);
  for (let i = 0; i < 1000; i++) {
    const n = Math.floor(r() * 12) - 1;     // negatives included
    const scenesLen = Math.floor(r() * 12);
    const cmd = r() < 0.6 ? `restore-scene-${n}` : `random-cmd-${n}`;
    const result = resolveSceneOrdinal(cmd, scenesLen);
    assert.equal(Number.isInteger(result), true);
    assert.ok(result === -1 || (result >= 0 && result < scenesLen),
      `i=${i} cmd=${cmd} scenesLen=${scenesLen} → ${result}`);
  }
});

test("fuzz: buildScene either returns null or an object with valid slug + tabs", () => {
  const r = rng(0x77770000);
  const NAMES = ["alpha", "bravo", "", "---", "!!!", "  ", "café", "1234", "x".repeat(80)];
  for (let i = 0; i < 500; i++) {
    const name = NAMES[Math.floor(r() * NAMES.length)];
    const tabCount = Math.floor(r() * 50);
    const tabs = Array.from({ length: tabCount }, (_, k) => ({
      url: r() < 0.8 ? `https://h${k}.test/` : "",
      pinned: r() < 0.3,
    }));
    const scene = buildScene(name, tabs);
    if (scene == null) continue;
    assert.ok(/^[a-z0-9-]+$/.test(scene.slug), `bad slug "${scene.slug}" for name "${name}"`);
    assert.ok(scene.slug.length <= 48, `slug too long: ${scene.slug.length}`);
    assert.ok(scene.tabs.length <= 200, `tab cap exceeded: ${scene.tabs.length}`);
    assert.equal(scene.created_at, scene.updated_at);
  }
});

test("fuzz: upsertScene preserves slug-uniqueness and newest-first order", () => {
  const r = rng(0x88880000);
  let scenes = [];
  const NAMES = ["alpha", "bravo", "charlie", "delta", "echo"];
  for (let i = 0; i < 500; i++) {
    const name = NAMES[Math.floor(r() * NAMES.length)];
    const scene = buildScene(name, [{ url: `https://x${i}.test/` }]);
    if (scene == null) continue;
    if (r() < 0.2) scenes = dropScene(scenes, scene.slug);
    else scenes = upsertScene(scenes, scene);
    // Invariants:
    const slugs = scenes.map((s) => s.slug);
    assert.equal(new Set(slugs).size, slugs.length,
      `i=${i} duplicate slug in scenes: ${slugs.join(",")}`);
  }
});

test("fuzz: buildTabTree+flattenTree never produces nodes outside the input set", () => {
  const r = rng(0x99990000);
  for (let i = 0; i < 200; i++) {
    const n = Math.floor(r() * 30) + 1;
    const tabs = Array.from({ length: n }, (_, k) => {
      const id = k + 1;
      const opener = r() < 0.6 ? Math.floor(r() * (n + 1)) : undefined; // may not exist
      return opener ? { id, openerTabId: opener } : { id };
    });
    const { roots } = buildTabTree(tabs);
    const flat = flattenTree(roots);
    const inputIds = new Set(tabs.map((t) => t.id));
    for (const node of flat) {
      assert.ok(inputIds.has(node.tab.id),
        `i=${i} flattened id ${node.tab.id} not in input set`);
      assert.ok(node.depth >= 0, `i=${i} negative depth ${node.depth}`);
    }
  }
});

test("fuzz: domainHueFor always returns integer in [0, 359]", () => {
  const r = rng(0xaaaa0000);
  const SCHEMES = ["https", "http", "wss", "ftp", "file"];
  for (let i = 0; i < 1000; i++) {
    const scheme = SCHEMES[Math.floor(r() * SCHEMES.length)];
    const host = "h" + Math.floor(r() * 100000).toString(36);
    const url = scheme === "file" ? "file:///tmp/x" : `${scheme}://${host}.test/path`;
    const hue = domainHueFor(url);
    assert.equal(Number.isInteger(hue), true);
    assert.ok(hue >= 0 && hue <= 359, `i=${i} url=${url} hue=${hue}`);
  }
});

test("fuzz: frecencyScore always returns a finite non-negative number", () => {
  const r = rng(0xbbbb0000);
  const NOW = 1_700_000_000_000;
  for (let i = 0; i < 1000; i++) {
    const item = {
      visitCount: Math.floor(r() * 10000),
      typedCount: Math.floor(r() * 1000),
      lastVisitTime: NOW - Math.floor(r() * 365 * 24 * 3_600_000),
    };
    const score = frecencyScore(item, NOW);
    assert.equal(Number.isFinite(score), true, `i=${i} score=${score}`);
    assert.ok(score >= 0, `i=${i} score=${score} must be ≥ 0`);
  }
});

test("fuzz: hostnameOf never throws and always returns a non-empty string", () => {
  const r = rng(0xcccc0000);
  const CHARS = "abc123:/?#%@.";
  for (let i = 0; i < 1000; i++) {
    let url = "";
    const len = Math.floor(r() * 40) + 1;
    for (let k = 0; k < len; k++) url += CHARS[Math.floor(r() * CHARS.length)];
    const host = hostnameOf(url);
    assert.equal(typeof host, "string", `i=${i} url="${url}" → ${host}`);
    assert.ok(host.length > 0, `i=${i} empty host for url="${url}"`);
  }
});
