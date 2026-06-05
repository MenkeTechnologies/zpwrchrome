// Unit tests for lib/ua-presets.js — preset shape, group enumeration,
// and the resolveUA(state) dispatcher used by the SW to compute the
// User-Agent value to inject via declarativeNetRequest.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  UA_PRESETS,
  getPreset,
  presetGroups,
  resolveUA,
} from "../lib/ua-presets.js";

test("UA_PRESETS: frozen array with non-empty preset list", () => {
  assert.ok(Object.isFrozen(UA_PRESETS));
  assert.ok(UA_PRESETS.length >= 10, "must ship a useful number of presets");
});

test("UA_PRESETS: every entry has { id, group, label, ua } strings", () => {
  for (const p of UA_PRESETS) {
    assert.equal(typeof p.id,    "string", `${JSON.stringify(p)} missing id`);
    assert.equal(typeof p.group, "string");
    assert.equal(typeof p.label, "string");
    assert.equal(typeof p.ua,    "string");
    assert.ok(p.id.length    > 0);
    assert.ok(p.group.length > 0);
    assert.ok(p.label.length > 0);
    assert.ok(p.ua.length    > 0);
  }
});

test("UA_PRESETS: ids are unique", () => {
  const ids = UA_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "preset ids must be unique");
});

test("UA_PRESETS: ships the major browser groups", () => {
  const groups = presetGroups();
  for (const expected of ["Chrome", "Firefox", "Safari", "Mobile", "Bots", "CLI"]) {
    assert.ok(groups.includes(expected), `missing group: ${expected}`);
  }
});

test("presetGroups: declaration order preserved (no alpha re-sort)", () => {
  const groups = presetGroups();
  // Chrome group ships first in the file.
  assert.equal(groups[0], "Chrome");
});

test("getPreset: returns the matching record or null", () => {
  const chrome = getPreset("chrome-mac");
  assert.ok(chrome);
  assert.equal(chrome.group, "Chrome");
  assert.match(chrome.ua, /Chrome\/[\d.]+/);

  assert.equal(getPreset("nope"),    null);
  assert.equal(getPreset(undefined), null);
  assert.equal(getPreset(null),      null);
});

// ─── resolveUA dispatcher ──────────────────────────────────────────
test("resolveUA: disabled state returns null (no override applied)", () => {
  assert.equal(resolveUA(null),                           null);
  assert.equal(resolveUA(undefined),                      null);
  assert.equal(resolveUA({ enabled: false }),             null);
  // Even with a custom UA configured, disabled means null.
  assert.equal(resolveUA({ enabled: false, mode: "custom", customUA: "x" }), null);
});

test("resolveUA: preset mode returns the preset's ua string", () => {
  const out = resolveUA({ enabled: true, mode: "preset", presetId: "firefox-mac" });
  assert.match(out, /Firefox\/[\d.]+/);
  assert.match(out, /Mac OS X/);
});

test("resolveUA: preset mode with unknown id returns null", () => {
  assert.equal(resolveUA({ enabled: true, mode: "preset", presetId: "no-such-id" }), null);
});

test("resolveUA: missing mode defaults to preset lookup", () => {
  const out = resolveUA({ enabled: true, presetId: "chrome-linux" });
  assert.match(out, /Chrome/);
  assert.match(out, /Linux/);
});

test("resolveUA: custom mode returns the customUA, trimmed", () => {
  assert.equal(
    resolveUA({ enabled: true, mode: "custom", customUA: "  My Custom UA  " }),
    "My Custom UA",
  );
});

test("resolveUA: custom mode with empty / whitespace-only customUA returns null", () => {
  assert.equal(resolveUA({ enabled: true, mode: "custom", customUA: ""   }), null);
  assert.equal(resolveUA({ enabled: true, mode: "custom", customUA: "  " }), null);
  assert.equal(resolveUA({ enabled: true, mode: "custom" }),                 null);
});
