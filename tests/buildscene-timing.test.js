// buildScene timestamp invariants. Pins how created_at + updated_at are
// produced, that the default nowMs falls back to Date.now() when omitted,
// and that the per-scene tab cap is independent of timestamp logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScene, upsertScene } from "../lib/util.js";

const TABS = [{ url: "https://x.test/", title: "x" }];
const T0 = 1_700_000_000_000;

test("buildScene new scene: created_at === updated_at when caller passes nowMs", () => {
  const s = buildScene("alpha", TABS, T0);
  assert.equal(s.created_at, T0);
  assert.equal(s.updated_at, T0);
  assert.equal(s.created_at, s.updated_at);
});

test("buildScene default nowMs falls back to Date.now() when omitted", () => {
  const before = Date.now();
  const s = buildScene("alpha", TABS);
  const after = Date.now();
  assert.ok(s.created_at >= before && s.created_at <= after,
    `created_at ${s.created_at} should fall within [${before}, ${after}]`);
  assert.equal(s.created_at, s.updated_at,
    "default nowMs path must still produce identical timestamps");
});

test("buildScene with explicit nowMs=0 sets both timestamps to 0 (no Date.now fallback)", () => {
  const s = buildScene("zero", TABS, 0);
  assert.equal(s.created_at, 0);
  assert.equal(s.updated_at, 0);
});

test("buildScene tab cap of 200 is independent of timestamp argument", () => {
  const tabs = Array.from({ length: 250 }, (_, i) => ({ url: `https://h${i}.test/` }));
  for (const ts of [T0, T0 + 60_000, 0, Date.now()]) {
    const s = buildScene("capped", tabs, ts);
    assert.equal(s.tabs.length, 200,
      `cap should hold at 200 regardless of nowMs=${ts}, got ${s.tabs.length}`);
  }
});

test("upsertScene replace: updated_at on replacement equals the new buildScene's nowMs", () => {
  // The replacement scene's timestamps come from its own buildScene call;
  // upsertScene does not merge in the old scene's created_at.
  const list = [buildScene("alpha", TABS, T0)];
  const replaced = upsertScene(list, buildScene("alpha", TABS, T0 + 5000));
  assert.equal(replaced[0].created_at, T0 + 5000);
  assert.equal(replaced[0].updated_at, T0 + 5000);
});

test("buildScene returns object whose name and slug match input semantics", () => {
  const s = buildScene("My Saved", TABS, T0);
  assert.equal(s.name, "My Saved");
  assert.equal(s.slug, "my-saved");
});

test("buildScene preserves the pinned flag from each tab", () => {
  const tabs = [
    { url: "https://a.test/", pinned: true },
    { url: "https://b.test/", pinned: false },
    { url: "https://c.test/" },                  // pinned missing → false
  ];
  const s = buildScene("pinned-mix", tabs, T0);
  assert.equal(s.tabs[0].pinned, true);
  assert.equal(s.tabs[1].pinned, false);
  assert.equal(s.tabs[2].pinned, false);
});

test("buildScene defaults missing tab.title to empty string", () => {
  const tabs = [{ url: "https://x.test/" }];
  const s = buildScene("no-title", tabs, T0);
  assert.equal(s.tabs[0].title, "");
});

test("buildScene with pendingUrl falls back when url is empty", () => {
  const tabs = [{ url: "", pendingUrl: "https://pending.test/" }];
  const s = buildScene("pending", tabs, T0);
  assert.equal(s.tabs.length, 1);
  assert.equal(s.tabs[0].url, "https://pending.test/");
});

test("buildScene with both url and pendingUrl prefers url", () => {
  const tabs = [{ url: "https://real.test/", pendingUrl: "https://pending.test/" }];
  const s = buildScene("prefer-real", tabs, T0);
  assert.equal(s.tabs[0].url, "https://real.test/");
});

test("buildScene with non-array tabs argument yields a scene with empty tabs", () => {
  // Defensive: a corrupt caller could pass a Promise or undefined; the helper
  // tolerates non-array and produces a valid empty-tabs scene rather than
  // throwing.
  const s = buildScene("defensive", null, T0);
  assert.notEqual(s, null);
  assert.deepEqual(s.tabs, []);
});
