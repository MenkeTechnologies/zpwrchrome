// Unit tests for lib/lights-off-css.js — defaults, overlay styles,
// host routing, opacity clamping, color sanitization.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OVERLAY_ID, LIFT_ATTR, MAX_Z, OVERLAY_Z, DEFAULTS,
  hostnameOf, shouldApply, buildOverlayStyles, clampOpacity, sanitizeColor,
} from "../lib/lights-off-css.js";

// ─── Constants ─────────────────────────────────────────────────────
test("constants: overlay id + lift attr are stable + namespaced", () => {
  // Stable IDs let content scripts find pre-existing overlays from
  // earlier injections (e.g. after a settings change) instead of
  // double-stacking.
  assert.equal(OVERLAY_ID, "zpwr-lights-off-overlay");
  assert.equal(LIFT_ATTR,  "data-zpwr-lights-lifted");
  // Video chain must outrank the overlay so it shows in spotlight.
  assert.ok(MAX_Z > OVERLAY_Z, "video z-index must exceed overlay z-index");
  // MAX_Z is the documented CSS int ceiling.
  assert.equal(MAX_Z, 2147483647);
});

test("DEFAULTS: frozen with sane cinema-mode defaults", () => {
  assert.ok(Object.isFrozen(DEFAULTS));
  assert.equal(DEFAULTS.opacity, 0.85);
  assert.equal(DEFAULTS.fadeMs, 300);
  assert.equal(DEFAULTS.color, "#000000");
  assert.equal(DEFAULTS.mode, "all");
  assert.deepEqual(DEFAULTS.domains, []);
  assert.equal(DEFAULTS.autoOn, false);
  assert.equal(DEFAULTS.liftPlayer, true);
});

// ─── Overlay styles ────────────────────────────────────────────────
test("buildOverlayStyles: produces a full-viewport black overlay at z-1 below max", () => {
  const css = buildOverlayStyles({});
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /inset:\s*0/);
  assert.match(css, /background-color:\s*#000000/);
  assert.match(css, new RegExp(`z-index:\\s*${OVERLAY_Z}`));
  // Always start at opacity 0 so the rAF fade-in is visible.
  assert.match(css, /opacity:\s*0\s*!important/);
  // pointer-events enabled so the click-to-undim handler fires.
  assert.match(css, /pointer-events:\s*auto/);
  // Cursor is pointer to signal click-to-dismiss.
  assert.match(css, /cursor:\s*pointer/);
});

test("buildOverlayStyles: applies fade duration + color overrides", () => {
  const css = buildOverlayStyles({ fadeMs: 500, color: "#0a0a14" });
  assert.match(css, /transition:\s*opacity\s+500ms/);
  assert.match(css, /background-color:\s*#0a0a14/);
});

test("buildOverlayStyles: clamps fadeMs to a sane range", () => {
  // Negative → 0. Huge values → 60000 ceiling.
  assert.match(buildOverlayStyles({ fadeMs: -1000 }), /transition:\s*opacity\s+0ms/);
  assert.match(buildOverlayStyles({ fadeMs: 99999 }), /transition:\s*opacity\s+60000ms/);
  // Non-numeric coerces to 0 via Number(NaN) || 0.
  assert.match(buildOverlayStyles({ fadeMs: "abc" }), /transition:\s*opacity\s+0ms/);
});

test("buildOverlayStyles: every declaration is !important (no site bg leaks through)", () => {
  const css = buildOverlayStyles({});
  // Pull every "key: value" segment; assert each ends in !important.
  const decls = css.split(";").map((s) => s.trim()).filter(Boolean);
  const unguarded = decls.filter((d) => !/!important$/.test(d));
  assert.equal(unguarded.length, 0,
    `every declaration must use !important — unguarded:\n${unguarded.join("\n")}`);
});

// ─── Host routing ──────────────────────────────────────────────────
test("hostnameOf: lowercases + falls back to '' on parse error", () => {
  assert.equal(hostnameOf("https://YouTube.COM/watch?v=foo"), "youtube.com");
  assert.equal(hostnameOf("http://sub.example.test:8000/x"), "sub.example.test");
  assert.equal(hostnameOf("not a url"), "");
});

test("shouldApply: default settings → applies everywhere", () => {
  assert.equal(shouldApply("youtube.com", undefined), true);
  assert.equal(shouldApply("youtube.com", null), true);
});

test("shouldApply: mode='all' — domains[] is a blocklist", () => {
  const s = { mode: "all", domains: ["youtube.com"] };
  assert.equal(shouldApply("youtube.com", s), false);
  assert.equal(shouldApply("m.youtube.com", s), false);
  assert.equal(shouldApply("vimeo.com", s), true);
});

test("shouldApply: mode='allowlist' — only listed domains dim", () => {
  const s = { mode: "allowlist", domains: ["youtube.com"] };
  assert.equal(shouldApply("youtube.com", s), true);
  assert.equal(shouldApply("m.youtube.com", s), true);
  assert.equal(shouldApply("vimeo.com", s), false);
});

test("shouldApply: subdomain match is right-anchored (dot boundary)", () => {
  const s = { mode: "all", domains: ["youtube.com"] };
  // evilyoutube.com is NOT a subdomain — must NOT be excluded.
  assert.equal(shouldApply("evilyoutube.com", s), true,
    "right-anchored match: evilyoutube.com is not in youtube.com's subdomain tree");
});

// ─── Opacity + color sanitization ──────────────────────────────────
test("clampOpacity: clamps to [0, 1]; non-finite → DEFAULTS.opacity", () => {
  assert.equal(clampOpacity(0.5), 0.5);
  assert.equal(clampOpacity(0), 0);
  assert.equal(clampOpacity(1), 1);
  assert.equal(clampOpacity(-0.5), 0);
  assert.equal(clampOpacity(2.5), 1);
  assert.equal(clampOpacity("0.7"), 0.7);
  assert.equal(clampOpacity("abc"), DEFAULTS.opacity);
  assert.equal(clampOpacity(NaN), DEFAULTS.opacity);
  assert.equal(clampOpacity(Infinity), DEFAULTS.opacity);
});

test("sanitizeColor: accepts 3- and 6-digit hex; rejects anything else", () => {
  assert.equal(sanitizeColor("#000000"), "#000000");
  assert.equal(sanitizeColor("#fff"), "#fff");
  assert.equal(sanitizeColor("#0A0A14"), "#0A0A14");
  // Bad inputs all fall back to DEFAULTS.color so we never paint with
  // a malformed value the browser might silently default to transparent.
  assert.equal(sanitizeColor("red"), DEFAULTS.color);
  assert.equal(sanitizeColor("rgb(0,0,0)"), DEFAULTS.color);
  assert.equal(sanitizeColor("#xyz"), DEFAULTS.color);
  assert.equal(sanitizeColor(""), DEFAULTS.color);
  assert.equal(sanitizeColor(null), DEFAULTS.color);
});
