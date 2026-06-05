// Stress tests with explicit time budgets. The pure helpers run on every
// keystroke in the popup; a regression that turns one of them O(N²) would
// add visible jank before any user-facing test caught it. Budgets are
// generous (10× the observed local timing) so CI on slow runners doesn't
// flake — they catch order-of-magnitude regressions, not microbench noise.

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
  frecencyScore,
  domainHueFor,
  MRU_CAP_DEFAULT,
} from "../lib/util.js";
import { fzfMatch, highlightWithIndices } from "../lib/fzf.js";
import { parseMetadata } from "../lib/userscript.js";

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function bench(label, budgetMs, fn) {
  const start = process.hrtime.bigint();
  fn();
  const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.ok(elapsed < budgetMs,
    `${label} took ${elapsed.toFixed(1)}ms (budget ${budgetMs}ms)`);
}

test("stress: 10,000 fzfMatch calls over realistic haystacks finish < 1000ms", () => {
  const haystacks = Array.from({ length: 100 }, (_, i) =>
    `tab-${i}-${i * 13}-popupRender-${i % 10}.js`);
  bench("10k fzfMatch", 1000, () => {
    for (let i = 0; i < 100; i++) {
      for (const h of haystacks) fzfMatch("pop", h);
    }
  });
});

test("stress: 100,000 mruPush operations under MRU_CAP_DEFAULT finish < 2000ms", () => {
  bench("100k mruPush", 2000, () => {
    let mru = [];
    for (let i = 0; i < 100_000; i++) {
      mru = mruPush(mru, i % 1000, MRU_CAP_DEFAULT);
    }
  });
});

test("stress: alternating mruPush + mruDrop x50k completes < 2000ms", () => {
  bench("50k push+drop", 2000, () => {
    let mru = [];
    for (let i = 0; i < 50_000; i++) {
      mru = mruPush(mru, i % 500);
      if (i % 3 === 0) mru = mruDrop(mru, (i - 7) % 500);
    }
  });
});

test("stress: buildTabTree + flattenTree on 2000-node forest finish < 200ms", () => {
  const tabs = Array.from({ length: 2000 }, (_, i) => ({
    id: i + 1,
    openerTabId: i < 100 ? undefined : ((i - 100) % 200) + 1,
  }));
  bench("2000-node tree", 200, () => {
    const { roots } = buildTabTree(tabs);
    const flat = flattenTree(roots);
    assert.equal(flat.length, 2000);
  });
});

test("stress: highlightWithIndices on 1000 calls finish < 100ms", () => {
  const haystack = "popupRenderComponent.test.js";
  const m = fzfMatch("popup", haystack);
  bench("1000 highlights", 100, () => {
    for (let i = 0; i < 1000; i++) highlightWithIndices(haystack, m.indices, escape);
  });
});

test("stress: 10,000 frecencyScore calls finish < 500ms", () => {
  // Budget was 50ms (calibrated on a fast local box). GitHub's runners
  // routinely hit 200-300ms on the same workload — the surrounding
  // tests use 100-2000ms ranges per the file's own "10× local timing"
  // header. 500ms catches an order-of-magnitude regression (which is
  // what a frecency turned O(N²) would surface as) without flaking on
  // slow CI runners.
  const NOW = 1_700_000_000_000;
  const items = Array.from({ length: 100 }, (_, i) => ({
    visitCount: (i * 7) % 100 + 1,
    typedCount: i % 5,
    lastVisitTime: NOW - (i * 60 * 60 * 1000),
  }));
  bench("10k frecencyScore", 500, () => {
    for (let i = 0; i < 100; i++) {
      for (const it of items) frecencyScore(it, NOW);
    }
  });
});

test("stress: 10,000 domainHueFor calls over a 100-URL corpus finish < 500ms", () => {
  const urls = Array.from({ length: 100 }, (_, i) =>
    `https://host-${i}.example-${i % 7}.test/path/${i}`);
  bench("10k domainHueFor", 500, () => {
    for (let i = 0; i < 100; i++) for (const u of urls) domainHueFor(u);
  });
});

test("stress: 500 scene CRUD ops (build+upsert+drop) finish < 500ms", () => {
  let scenes = [];
  bench("500 scene CRUD", 500, () => {
    for (let i = 0; i < 500; i++) {
      const tabs = Array.from({ length: 30 }, (_, k) => ({
        url: `https://h${i}-${k}.test/`, pinned: k % 5 === 0,
      }));
      const scene = buildScene(`scene-${i % 50}`, tabs);
      if (scene && i % 7 === 0) scenes = dropScene(scenes, scene.slug);
      else if (scene) scenes = upsertScene(scenes, scene);
    }
  });
  // Sanity: post-op state should not have grown unbounded.
  assert.ok(scenes.length <= 50, `scenes.length=${scenes.length} > 50 unique slugs`);
});

test("stress: parseMetadata on a 500-directive header finishes < 50ms", () => {
  const lines = ["// ==UserScript==", "// @name big"];
  for (let i = 0; i < 500; i++) lines.push(`// @match https://h${i}.test/*`);
  lines.push("// ==/UserScript==");
  const src = lines.join("\n") + "\n";
  bench("500-directive parse", 50, () => {
    const meta = parseMetadata(src);
    assert.notEqual(meta, null);
  });
});

test("stress: filter pipeline (fzf+highlight) over 500 items finishes < 200ms", () => {
  // Simulates a single keystroke in the popup: every visible row gets
  // fzf-matched + highlighted.
  const items = Array.from({ length: 500 }, (_, i) =>
    `tab-${i}-popupRender-${i % 7}.js`);
  bench("500-item filter pass", 200, () => {
    const matched = [];
    for (const it of items) {
      const m = fzfMatch("pop", it);
      if (m) {
        const html = highlightWithIndices(it, m.indices, escape);
        matched.push({ score: m.score, html });
      }
    }
    matched.sort((a, b) => b.score - a.score);
    assert.ok(matched.length > 0);
  });
});

test("stress: huge string haystack (50k chars) fzfMatch finishes < 200ms", () => {
  const haystack = "a".repeat(50_000) + "popup";
  bench("50k haystack fzfMatch", 200, () => {
    const m = fzfMatch("popup", haystack);
    assert.notEqual(m, null);
    assert.equal(m.indices.length, 5);
  });
});
