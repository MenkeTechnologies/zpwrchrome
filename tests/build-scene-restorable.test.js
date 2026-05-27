// buildScene filters non-restorable URLs via isRestorableUrl logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScene } from "../lib/util.js";

const ts = 1_700_000_000_000;

test("buildScene filters chrome:// URLs from saved tabs", () => {
  const s = buildScene("work", [
    { url: "chrome://settings/" },
    { url: "https://ok.com/" },
  ], ts);
  assert.equal(s.tabs.length, 1);
  assert.equal(s.tabs[0].url, "https://ok.com/");
});

test("buildScene filters chrome-extension:// URLs", () => {
  const s = buildScene("x", [{ url: "chrome-extension://abc/popup.html" }], ts);
  assert.equal(s.tabs.length, 0);
});

test("buildScene filters devtools:// URLs", () => {
  const s = buildScene("x", [{ url: "devtools://devtools/bundled/inspector.html" }], ts);
  assert.equal(s.tabs.length, 0);
});

test("buildScene filters view-source: URLs", () => {
  const s = buildScene("x", [{ url: "view-source:https://example.com/" }], ts);
  assert.equal(s.tabs.length, 0);
});

test("buildScene filters about: URLs", () => {
  const s = buildScene("x", [{ url: "about:blank" }, { url: "https://a/" }], ts);
  assert.equal(s.tabs.length, 1);
});

test("buildScene keeps https and http restorable tabs", () => {
  const s = buildScene("mix", [
    { url: "http://local.dev/" },
    { url: "https://secure.site/page" },
  ], ts);
  assert.equal(s.tabs.length, 2);
});

test("buildScene stores pinned flag from tab object", () => {
  const s = buildScene("pin", [{ url: "https://a/", pinned: true }], ts);
  assert.equal(s.tabs[0].pinned, true);
});

test("buildScene defaults pinned to false when absent", () => {
  const s = buildScene("x", [{ url: "https://a/" }], ts);
  assert.equal(s.tabs[0].pinned, false);
});

test("buildScene caps tabs at 200 per scene", () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ url: `https://t${i}.example/` }));
  const s = buildScene("big", many, ts);
  assert.equal(s.tabs.length, 200);
});

test("buildScene slugifies scene name to kebab-case slug", () => {
  const s = buildScene("My Research Q4", [{ url: "https://a/" }], ts);
  assert.equal(s.slug, "my-research-q4");
});

test("buildScene returns null when name slugifies to empty", () => {
  assert.equal(buildScene("!!!", [{ url: "https://a/" }], ts), null);
});

test("buildScene records created_at and updated_at timestamps", () => {
  const s = buildScene("ts", [{ url: "https://a/" }], ts);
  assert.equal(s.created_at, ts);
  assert.equal(s.updated_at, ts);
});
