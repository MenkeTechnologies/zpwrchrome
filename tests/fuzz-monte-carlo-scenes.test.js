// Monte Carlo CRUD with an oracle: run thousands of buildScene/upsertScene/
// dropScene operations against a parallel Map-based reference model and
// assert the lib state matches the model after every step. Catches subtle
// ordering/identity bugs that uniform random fuzz misses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScene, upsertScene, dropScene } from "../lib/util.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTabs(rand, count) {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://h${Math.floor(rand() * 10000)}.test/p${i}`,
    title: `Tab ${i}`,
    pinned: rand() < 0.2,
  }));
}

function runSession(seed, ops) {
  const r = rng(seed);
  const SLUGS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];
  // Oracle: ordered list of slugs in newest-first order + Map<slug, scene>.
  // The library list must always match the oracle in slug order + payload.
  let scenes = [];
  let oracleOrder = [];                 // newest-first slugs
  const oraclePayload = new Map();      // slug → scene object actually inserted

  for (let i = 0; i < ops; i++) {
    const slug = SLUGS[Math.floor(r() * SLUGS.length)];
    const action = r();
    if (action < 0.75) {
      // upsert path
      const scene = buildScene(slug, makeTabs(r, Math.floor(r() * 10) + 1));
      assert.notEqual(scene, null, `i=${i} buildScene returned null for slug=${slug}`);
      scenes = upsertScene(scenes, scene);
      oracleOrder = [scene.slug, ...oracleOrder.filter((s) => s !== scene.slug)];
      oraclePayload.set(scene.slug, scene);
    } else {
      // drop path
      scenes = dropScene(scenes, slug);
      oracleOrder = oracleOrder.filter((s) => s !== slug);
      oraclePayload.delete(slug);
    }

    // Invariants after EVERY op:
    assert.equal(scenes.length, oracleOrder.length,
      `i=${i}: lib length ${scenes.length} ≠ oracle ${oracleOrder.length}`);
    for (let k = 0; k < scenes.length; k++) {
      assert.equal(scenes[k].slug, oracleOrder[k],
        `i=${i} index ${k}: lib slug ${scenes[k].slug} ≠ oracle ${oracleOrder[k]}`);
      assert.equal(scenes[k], oraclePayload.get(scenes[k].slug),
        `i=${i} slug ${scenes[k].slug}: lib payload identity mismatch`);
    }
    // No duplicate slugs.
    assert.equal(
      new Set(scenes.map((s) => s.slug)).size,
      scenes.length,
      `i=${i} duplicate slugs in lib state`
    );
  }
  return { scenes, oracleOrder };
}

test("monte-carlo: 1000 random scene ops match the oracle (seed 0xC0DEFACE)", () => {
  runSession(0xC0DEFACE, 1000);
});

test("monte-carlo: 1000 random scene ops match the oracle (seed 0x1337C0DE)", () => {
  runSession(0x1337C0DE, 1000);
});

test("monte-carlo: 5000 random scene ops match the oracle (long-burn seed)", () => {
  runSession(0xFEEDBEEF, 5000);
});

test("monte-carlo: upsert-only burst preserves newest-first order across N pushes", () => {
  // Pure upsert with no drops. Each slug ends up exactly once, in
  // reverse-insertion-order (most recent first).
  const r = rng(0xAAAAAAAA);
  let scenes = [];
  const SLUGS = ["alpha", "bravo", "charlie", "delta", "echo"];
  const lastSeen = new Map();
  let stamp = 0;
  for (let i = 0; i < 500; i++) {
    const slug = SLUGS[Math.floor(r() * SLUGS.length)];
    const scene = buildScene(slug, [{ url: `https://x${i}.test/` }]);
    scenes = upsertScene(scenes, scene);
    lastSeen.set(slug, stamp++);
  }
  // Lib state must be sorted by lastSeen descending.
  for (let k = 1; k < scenes.length; k++) {
    const a = lastSeen.get(scenes[k - 1].slug);
    const b = lastSeen.get(scenes[k].slug);
    assert.ok(a > b, `out-of-order: ${scenes[k - 1].slug}@${a} should beat ${scenes[k].slug}@${b}`);
  }
});

test("monte-carlo: drop-everything-then-rebuild yields the same state as build-only", () => {
  const r = rng(0xBBBBBBBB);
  const SLUGS = ["alpha", "bravo", "charlie"];
  let scenesA = [];
  let scenesB = [];
  for (let i = 0; i < 200; i++) {
    const slug = SLUGS[Math.floor(r() * SLUGS.length)];
    const scene = buildScene(slug, [{ url: `https://x${i}.test/` }]);
    scenesA = upsertScene(scenesA, scene);
    scenesB = upsertScene(scenesB, scene);
  }
  // Drop everything in scenesB, then rebuild from scratch using A's state.
  for (const s of [...scenesB]) scenesB = dropScene(scenesB, s.slug);
  assert.deepEqual(scenesB, []);
  // After re-applying upserts in same order, B should match A.
  for (const s of [...scenesA].reverse()) scenesB = upsertScene(scenesB, s);
  assert.deepEqual(
    scenesA.map((s) => s.slug),
    scenesB.map((s) => s.slug),
  );
});

test("monte-carlo: alternating upsert + drop of single slug never exceeds length 1", () => {
  const r = rng(0xCCCCCCCC);
  let scenes = [];
  for (let i = 0; i < 1000; i++) {
    if (r() < 0.5) {
      const scene = buildScene("only", [{ url: `https://x${i}.test/` }]);
      scenes = upsertScene(scenes, scene);
      assert.equal(scenes.length, 1, `i=${i} length=${scenes.length}`);
      assert.equal(scenes[0].slug, "only");
    } else {
      scenes = dropScene(scenes, "only");
      assert.equal(scenes.length, 0, `i=${i} after drop, length=${scenes.length}`);
    }
  }
});

test("monte-carlo: scenes list never aliases prior state (every op returns new array)", () => {
  const r = rng(0xDDDDDDDD);
  const SLUGS = ["a", "b", "c"];
  let scenes = [];
  for (let i = 0; i < 100; i++) {
    const prev = scenes;
    const slug = SLUGS[Math.floor(r() * SLUGS.length)];
    if (r() < 0.6) {
      const scene = buildScene(slug, [{ url: `https://x${i}.test/` }]);
      scenes = upsertScene(scenes, scene);
    } else {
      scenes = dropScene(scenes, slug);
    }
    assert.notEqual(scenes, prev, `i=${i} returned the same array reference`);
  }
});
