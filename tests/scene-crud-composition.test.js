// CRUD composition tests for the scene helpers in lib/util.js.
// The individual functions (buildScene/upsertScene/dropScene) are covered
// elsewhere; this file pins their *composed* behavior across realistic
// sequences a service-worker session would run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScene, upsertScene, dropScene } from "../lib/util.js";

const TAB = (i) => ({ url: `https://site-${i}.test/`, title: `T${i}`, pinned: false });
const T0 = 1_700_000_000_000;

function build(name, tabs, nowMs = T0) {
  const scene = buildScene(name, tabs, nowMs);
  assert.notEqual(scene, null, `buildScene must succeed for ${name}`);
  return scene;
}

test("upsertScene inserts N distinct scenes preserving newest-first order", () => {
  let scenes = [];
  scenes = upsertScene(scenes, build("alpha", [TAB(1)], T0));
  scenes = upsertScene(scenes, build("bravo", [TAB(2)], T0 + 1));
  scenes = upsertScene(scenes, build("charlie", [TAB(3)], T0 + 2));
  assert.deepEqual(scenes.map((s) => s.slug), ["charlie", "bravo", "alpha"]);
});

test("upsertScene replacing an existing slug moves it to the front", () => {
  let scenes = [];
  scenes = upsertScene(scenes, build("alpha", [TAB(1)], T0));
  scenes = upsertScene(scenes, build("bravo", [TAB(2)], T0 + 1));
  // Re-insert alpha → should hop to head.
  scenes = upsertScene(scenes, build("alpha", [TAB(1), TAB(10)], T0 + 2));
  assert.deepEqual(scenes.map((s) => s.slug), ["alpha", "bravo"]);
  assert.equal(scenes[0].tabs.length, 2, "replacement carries new tab payload");
  assert.equal(scenes[0].updated_at, T0 + 2);
});

test("dropScene + upsertScene roundtrip restores newest-first ordering", () => {
  let scenes = [];
  scenes = upsertScene(scenes, build("alpha", [TAB(1)], T0));
  scenes = upsertScene(scenes, build("bravo", [TAB(2)], T0 + 1));
  scenes = upsertScene(scenes, build("charlie", [TAB(3)], T0 + 2));
  // Drop the middle one.
  scenes = dropScene(scenes, "bravo");
  assert.deepEqual(scenes.map((s) => s.slug), ["charlie", "alpha"]);
  // Re-add it → goes to head.
  scenes = upsertScene(scenes, build("bravo", [TAB(2)], T0 + 3));
  assert.deepEqual(scenes.map((s) => s.slug), ["bravo", "charlie", "alpha"]);
});

test("dropScene is idempotent for the same slug across repeated calls", () => {
  let scenes = upsertScene([], build("alpha", [TAB(1)]));
  scenes = dropScene(scenes, "alpha");
  assert.deepEqual(scenes, []);
  scenes = dropScene(scenes, "alpha");
  assert.deepEqual(scenes, [], "dropping again on empty list is a no-op");
});

test("upsertScene preserves the input list immutably (no in-place mutation)", () => {
  const before = [build("alpha", [TAB(1)])];
  const after = upsertScene(before, build("bravo", [TAB(2)]));
  assert.equal(before.length, 1, "input list length must not change");
  assert.equal(before[0].slug, "alpha", "input element identity preserved");
  assert.notEqual(after, before, "upsert must return a new array");
});

test("dropScene returns a fresh array (no aliasing) when slug is absent", () => {
  const before = [build("alpha", [TAB(1)])];
  const after = dropScene(before, "missing");
  assert.deepEqual(after, before);
  assert.notEqual(after, before, "drop must return a new array even on no-op");
});

test("full-clear cycle: insert three, drop them all, list ends empty", () => {
  let scenes = [];
  for (const n of ["a", "b", "c"]) scenes = upsertScene(scenes, build(n, [TAB(1)]));
  for (const slug of ["a", "b", "c"]) scenes = dropScene(scenes, slug);
  assert.deepEqual(scenes, []);
});

test("upsertScene replace updates updated_at while keeping created_at distinct", () => {
  // buildScene sets both timestamps. After replace, the new scene has its own
  // (later) created_at — pin that upsertScene doesn't merge timestamps.
  let scenes = upsertScene([], build("alpha", [TAB(1)], T0));
  scenes = upsertScene(scenes, build("alpha", [TAB(2)], T0 + 5000));
  assert.equal(scenes[0].created_at, T0 + 5000);
  assert.equal(scenes[0].updated_at, T0 + 5000);
});

test("buildScene with all non-restorable URLs still produces a scene with empty tabs", () => {
  const tabs = [
    { url: "chrome://settings" },
    { url: "chrome-extension://x/index.html" },
    { url: "devtools://devtools/" },
    { url: "view-source:https://example.com/" },
    { url: "about:blank" },
  ];
  const scene = buildScene("dead-set", tabs, T0);
  assert.notEqual(scene, null, "non-empty slug → scene is built");
  assert.deepEqual(scene.tabs, [], "every tab is filtered out");
});

test("dropScene + reinsert preserves identity by slug, not by reference", () => {
  // After drop + reinsert, the new scene object replaces the old; downstream
  // code that holds a stale reference must re-read from the list.
  const original = build("alpha", [TAB(1)], T0);
  let scenes = upsertScene([], original);
  scenes = dropScene(scenes, "alpha");
  const fresh = build("alpha", [TAB(2)], T0 + 1);
  scenes = upsertScene(scenes, fresh);
  assert.equal(scenes[0], fresh, "list entry is the new object, not the old");
  assert.notEqual(scenes[0], original);
});

test("upsertScene merges trailing same-slug entries by replacing them all", () => {
  // Hypothetical corrupt state: duplicates of the same slug already in the
  // list. upsertScene filters by slug, so all duplicates collapse to one entry.
  const dup = build("alpha", [TAB(1)], T0);
  const list = [dup, dup, build("bravo", [TAB(2)], T0)];
  const after = upsertScene(list, build("alpha", [TAB(3)], T0 + 1));
  const alphaCount = after.filter((s) => s.slug === "alpha").length;
  assert.equal(alphaCount, 1, "all duplicate alpha entries must be replaced");
});
