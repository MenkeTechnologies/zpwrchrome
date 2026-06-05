// Memory + scale stress tests — push the helpers an order of magnitude past
// realistic input sizes to surface algorithmic regressions (O(N²) creep,
// runaway allocations) that the normal-size tests can't detect.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mruPush,
  mruDrop,
  buildTabTree,
  flattenTree,
  buildScene,
  upsertScene,
  dropScene,
  MRU_CAP_DEFAULT,
} from "../lib/util.js";
import {
  matchUrl,
  expandMatchPatterns,
} from "../lib/userscript.js";

function bench(label, budgetMs, fn) {
  const start = process.hrtime.bigint();
  const out = fn();
  const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.ok(elapsed < budgetMs, `${label} took ${elapsed.toFixed(1)}ms (budget ${budgetMs}ms)`);
  return out;
}

test("scale: 1,000,000 mruPush operations stay capped + finite-time (< 10s)", () => {
  bench("1M mruPush", 10_000, () => {
    let mru = [];
    for (let i = 0; i < 1_000_000; i++) mru = mruPush(mru, i % 5000);
    assert.equal(mru.length, MRU_CAP_DEFAULT);
    // All survivors are unique.
    assert.equal(new Set(mru).size, mru.length);
  });
});

test("scale: 500k push + 500k drop alternation finishes in bounded time (< 10s)", () => {
  bench("500k push + 500k drop", 10_000, () => {
    let mru = [];
    for (let i = 0; i < 500_000; i++) mru = mruPush(mru, i % 2000);
    for (let i = 0; i < 500_000; i++) mru = mruDrop(mru, i % 2000);
    assert.deepEqual(mru, []);
  });
});

test("scale: 10,000-deep opener chain buildTabTree+flattenTree < 1s", () => {
  const tabs = Array.from({ length: 10_000 }, (_, i) => ({
    id: i + 1,
    openerTabId: i === 0 ? undefined : i,
  }));
  bench("10k-deep chain", 1000, () => {
    const { roots } = buildTabTree(tabs);
    const flat = flattenTree(roots);
    assert.equal(flat.length, 10_000);
    // Depth must reach 9,999 at the tip.
    assert.equal(flat[flat.length - 1].depth, 9_999);
  });
});

test("scale: 5000-node sibling forest buildTabTree+flattenTree < 200ms", () => {
  const tabs = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1 }));
  bench("5k-sibling forest", 200, () => {
    const { roots } = buildTabTree(tabs);
    assert.equal(roots.length, 5000);
    const flat = flattenTree(roots);
    assert.equal(flat.length, 5000);
    for (const node of flat) assert.equal(node.depth, 0);
  });
});

test("scale: 10,000-pattern matchUrl pass per-URL < 1500ms", () => {
  // matchUrl rebuilds the regex for every pattern on every call (no cache),
  // so 10k patterns × 2 calls × 2 URLs is ~40k regex compiles. Budget is
  // generous (~3× observed on local M-series, 5× of CI-runner timings) —
  // catches order-of-magnitude regressions, not the constant factor.
  // GitHub's ubuntu-latest hosted runners routinely hit 540-580ms; the
  // 500ms budget was right at the edge and flaked.
  const patterns = Array.from({ length: 10_000 },
    (_, i) => `https://host-${i}.example.com/*`);
  bench("10k matchUrl pattern pass", 1500, () => {
    assert.equal(matchUrl(patterns, "https://host-9999.example.com/index"), true);
    assert.equal(matchUrl(patterns, "https://nope.test/"), false);
  });
});

test("scale: 10,000 expandMatchPatterns + matchUrl combined pass < 500ms", () => {
  const patterns = Array.from({ length: 10_000 },
    (_, i) => `https://example-${i}.com/*`);
  bench("10k expand+match", 500, () => {
    const expanded = expandMatchPatterns(patterns);
    assert.ok(expanded.length >= patterns.length);
    // Confirm www auto-expansion works at scale.
    assert.equal(matchUrl(expanded, "https://www.example-100.com/path"), true);
  });
});

test("scale: 5000-scene CRUD list with random reads/updates finishes < 5s", () => {
  bench("5k scene CRUD", 5000, () => {
    let scenes = [];
    for (let i = 0; i < 5000; i++) {
      const scene = buildScene(`scene-${i}`, [{ url: `https://h${i}.test/` }]);
      scenes = upsertScene(scenes, scene);
    }
    assert.equal(scenes.length, 5000);
    // Drop every-third one.
    for (let i = 0; i < 5000; i += 3) scenes = dropScene(scenes, `scene-${i}`);
    // Expected remaining: ~2/3 of 5000.
    assert.ok(scenes.length > 3000 && scenes.length < 3500,
      `expected ~3333 scenes after dropping every third, got ${scenes.length}`);
  });
});

test("scale: 200 scenes each with 200 tabs (per-scene cap) total 40k tab records < 1s", () => {
  bench("200×200 scene/tabs", 1000, () => {
    let scenes = [];
    for (let i = 0; i < 200; i++) {
      // Build with 250 tabs; cap should clip to 200.
      const tabs = Array.from({ length: 250 },
        (_, k) => ({ url: `https://h${i}-${k}.test/` }));
      const scene = buildScene(`scene-${i}`, tabs);
      assert.equal(scene.tabs.length, 200);
      scenes = upsertScene(scenes, scene);
    }
    assert.equal(scenes.length, 200);
    const totalTabs = scenes.reduce((n, s) => n + s.tabs.length, 0);
    assert.equal(totalTabs, 40_000);
  });
});

test("scale: 50,000 buildScene calls (slug churn) finish < 5s", () => {
  bench("50k buildScene", 5000, () => {
    for (let i = 0; i < 50_000; i++) {
      const scene = buildScene(`alpha-${i % 1000}`, [{ url: `https://x${i}.test/` }]);
      assert.notEqual(scene, null);
    }
  });
});

test("scale: mixed buildTabTree/flatten under N=1000 ten times completes < 500ms", () => {
  bench("10× 1k-node tree", 500, () => {
    for (let run = 0; run < 10; run++) {
      const tabs = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        openerTabId: i % 100 === 0 ? undefined : Math.floor(i / 10) * 10 + 1,
      }));
      const { roots } = buildTabTree(tabs);
      const flat = flattenTree(roots);
      assert.equal(flat.length, 1000);
    }
  });
});

test("scale: flattenTree with random 50% collapsed nodes still emits a stable subset", () => {
  const tabs = Array.from({ length: 2000 }, (_, i) => ({
    id: i + 1,
    openerTabId: i === 0 ? undefined : Math.max(1, i - 5),
  }));
  const { roots } = buildTabTree(tabs);
  // Collapse every even id.
  const collapsed = new Set();
  for (let i = 2; i <= 2000; i += 2) collapsed.add(i);
  bench("2k tree with 1k collapsed", 200, () => {
    const flat = flattenTree(roots, collapsed);
    // Whatever subset emerges, every entry must be one of the input ids.
    const ids = new Set(tabs.map((t) => t.id));
    for (const node of flat) assert.ok(ids.has(node.tab.id));
  });
});
