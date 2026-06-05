// Unit tests for lib/reader-mode-css.js — themes, font stacks,
// clamping, reading-time estimation, CSS builder.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OVERLAY_ID, STYLE_ID, STATE_KEY,
  THEMES, FONT_STACKS, DEFAULTS,
  WORDS_PER_MIN,
  estimateReadingTime,
  clampFontSize, clampLineWidth, clampLineHeight,
  pickTheme, pickFontStack,
  buildReaderCss,
} from "../lib/reader-mode-css.js";

// ─── Identifiers + frozen tables ───────────────────────────────────
test("constants: overlay/style/state keys are stable", () => {
  assert.equal(OVERLAY_ID, "zpwr-reader-mode");
  assert.equal(STYLE_ID,   "zpwr-reader-mode-style");
  assert.equal(STATE_KEY,  "reader.mode");
});

test("THEMES: all four variants exist with the required slots", () => {
  assert.ok(Object.isFrozen(THEMES));
  for (const name of ["cyberpunk", "classic-dark", "classic-light", "sepia"]) {
    const t = THEMES[name];
    assert.ok(t, `theme ${name} missing`);
    for (const k of ["bg","panel","text","muted","accent","accent2","accent3","border"]) {
      assert.ok(t[k], `${name}.${k} missing`);
    }
    assert.match(t.bg, /^#[0-9a-f]{3,6}$/i);
  }
});

test("FONT_STACKS: mono / serif / sans all present", () => {
  assert.ok(Object.isFrozen(FONT_STACKS));
  assert.match(FONT_STACKS.mono,  /Share Tech Mono/);
  assert.match(FONT_STACKS.serif, /Iowan Old Style|Baskerville/);
  assert.match(FONT_STACKS.sans,  /Inter|system/);
});

test("DEFAULTS: cyberpunk + mono, frozen, reasonable values", () => {
  assert.ok(Object.isFrozen(DEFAULTS));
  assert.equal(DEFAULTS.theme, "cyberpunk");
  assert.equal(DEFAULTS.font,  "mono");
  assert.equal(DEFAULTS.fontSize, 16);
  assert.equal(DEFAULTS.lineWidth, 65);
  assert.equal(DEFAULTS.scanlines, false);
});

// ─── Reading-time estimation ───────────────────────────────────────
test("estimateReadingTime: 200 wpm rule with floor of 1 min", () => {
  assert.equal(WORDS_PER_MIN, 200);
  assert.equal(estimateReadingTime(""), 0);
  assert.equal(estimateReadingTime(null), 0);
  // 50 words → 0.25 min → floored to 1.
  assert.equal(estimateReadingTime("word ".repeat(50)), 1);
  // 200 words → exactly 1 min.
  assert.equal(estimateReadingTime("word ".repeat(200)), 1);
  // 400 words → 2 min.
  assert.equal(estimateReadingTime("word ".repeat(400)), 2);
  // 1000 words → 5 min.
  assert.equal(estimateReadingTime("word ".repeat(1000)), 5);
});

// ─── Clamping ──────────────────────────────────────────────────────
test("clampFontSize: integer in [12, 28]; NaN → default", () => {
  assert.equal(clampFontSize(16), 16);
  assert.equal(clampFontSize(8),  12);
  assert.equal(clampFontSize(40), 28);
  assert.equal(clampFontSize("18"), 18);
  assert.equal(clampFontSize(16.7), 17);  // rounds
  assert.equal(clampFontSize("abc"), DEFAULTS.fontSize);
  assert.equal(clampFontSize(NaN),   DEFAULTS.fontSize);
});

test("clampLineWidth: integer in [40, 120]; NaN → default", () => {
  assert.equal(clampLineWidth(65), 65);
  assert.equal(clampLineWidth(20), 40);
  assert.equal(clampLineWidth(200), 120);
  assert.equal(clampLineWidth("abc"), DEFAULTS.lineWidth);
});

test("clampLineHeight: float in [1.2, 2.4]; NaN → default", () => {
  assert.equal(clampLineHeight(1.65), 1.65);
  assert.equal(clampLineHeight(1.0),  1.2);
  assert.equal(clampLineHeight(3.0),  2.4);
  assert.equal(clampLineHeight("abc"), DEFAULTS.lineHeight);
});

// ─── Theme + font pickers ──────────────────────────────────────────
test("pickTheme: unknown name → cyberpunk default", () => {
  assert.equal(pickTheme("cyberpunk"),     THEMES.cyberpunk);
  assert.equal(pickTheme("sepia"),         THEMES.sepia);
  assert.equal(pickTheme("nonexistent"),   THEMES[DEFAULTS.theme]);
  assert.equal(pickTheme(undefined),       THEMES[DEFAULTS.theme]);
});

test("pickFontStack: unknown name → mono default", () => {
  assert.equal(pickFontStack("mono"),  FONT_STACKS.mono);
  assert.equal(pickFontStack("serif"), FONT_STACKS.serif);
  assert.equal(pickFontStack("zzz"),   FONT_STACKS[DEFAULTS.font]);
});

// ─── CSS builder ───────────────────────────────────────────────────
test("buildReaderCss: scopes every rule under #zpwr-reader-mode", () => {
  const css = buildReaderCss({});
  // No selector should exist at the top level — everything is nested
  // under the overlay id so it can't leak into the host page.
  assert.match(css, /#zpwr-reader-mode\s*\{/);
  // Spot-check a sampling of rules.
  for (const sel of ["h1", "p", "a", "blockquote", "code", "pre", "img"]) {
    assert.match(css, new RegExp(`#zpwr-reader-mode\\s+${sel}`),
      `${sel} rule must be scoped under #zpwr-reader-mode`);
  }
});

test("buildReaderCss: theme picks bg/accent colors from THEMES table", () => {
  const cy = buildReaderCss({ theme: "cyberpunk" });
  assert.ok(cy.includes(THEMES.cyberpunk.bg));
  assert.ok(cy.includes(THEMES.cyberpunk.accent));
  const sp = buildReaderCss({ theme: "sepia" });
  assert.ok(sp.includes(THEMES.sepia.bg));
  assert.ok(sp.includes(THEMES.sepia.accent));
  // Cross-check: cyberpunk colors must NOT appear in the sepia output.
  assert.ok(!sp.includes(THEMES.cyberpunk.bg),
    "sepia output must not include cyberpunk bg");
});

test("buildReaderCss: font + size + line-width + line-height all reflected", () => {
  const css = buildReaderCss({ font: "serif", fontSize: 20, lineWidth: 80, lineHeight: 1.8 });
  assert.match(css, /font-family:.*Iowan Old Style/);
  assert.match(css, /font-size:\s*20px/);
  assert.match(css, /max-width:\s*80ch/);
  assert.match(css, /line-height:\s*1\.8/);
});

test("buildReaderCss: scanlines toggle adds body::after rule", () => {
  const on  = buildReaderCss({ scanlines: true });
  const off = buildReaderCss({ scanlines: false });
  assert.match(on,  /#zpwr-reader-mode::after/);
  assert.match(on,  /repeating-linear-gradient/);
  assert.doesNotMatch(off, /repeating-linear-gradient/);
});

test("buildReaderCss: clamps applied (no extreme values leak through)", () => {
  const css = buildReaderCss({ fontSize: 500, lineWidth: 1, lineHeight: 99 });
  assert.match(css, /font-size:\s*28px/);  // clamped to ceiling
  assert.match(css, /max-width:\s*40ch/);  // clamped to floor
  assert.match(css, /line-height:\s*2\.4/);// clamped to ceiling
});
