// Unit tests for lib/cyber-theme-css.js — palette, intensity layering,
// optional knobs, host-routing logic.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  THEME,
  buildThemeCss,
  hostnameOf,
  shouldApplyTo,
} from "../lib/cyber-theme-css.js";

// ─── Palette ───────────────────────────────────────────────────────
test("THEME palette: frozen, has every documented color slot", () => {
  assert.ok(Object.isFrozen(THEME));
  for (const k of ["bgPrimary","bgSecondary","bgCard","bgHover","cyan","accent","magenta","orange","green","yellow","text","textDim","border","fontStack"]) {
    assert.ok(THEME[k], `missing palette slot: ${k}`);
  }
  // Sanity — hex codes should look hex-ish.
  assert.match(THEME.cyan, /^#[0-9a-f]{6}$/i);
  assert.match(THEME.accent, /^#[0-9a-f]{6}$/i);
});

// ─── buildThemeCss — intensity layering ────────────────────────────
test("buildThemeCss: subtle layer always present — links + headings + scrollbars", () => {
  const css = buildThemeCss({ intensity: "subtle" });
  assert.match(css, /a, a:visited/);
  assert.match(css, /h1, h2, h3, h4, h5, h6/);
  assert.match(css, /::-webkit-scrollbar/);
  // No body-bg recolor at subtle.
  assert.doesNotMatch(css, /html, body \{\s*background-color/);
});

test("buildThemeCss: medium layer adds body-bg + form fields + code blocks", () => {
  const css = buildThemeCss({ intensity: "medium" });
  assert.match(css, /html, body \{\s*background-color/);
  assert.match(css, /input, textarea, select, button/);
  assert.match(css, /code, pre, kbd/);
});

test("buildThemeCss: full layer adds tables + image dim + badges", () => {
  const css = buildThemeCss({ intensity: "full" });
  assert.match(css, /table, th, td/);
  assert.match(css, /img, video/);
  assert.match(css, /\[class\*="badge"\]/);
});

test("buildThemeCss: full layer SUPERSETS medium (every medium selector still present)", () => {
  const full = buildThemeCss({ intensity: "full" });
  for (const sel of [
    "html, body",
    "input, textarea, select, button",
    "code, pre, kbd",
    "::-webkit-scrollbar",
  ]) {
    assert.ok(full.includes(sel), `full layer missing ${sel}`);
  }
});

test("buildThemeCss: default intensity is medium", () => {
  assert.deepEqual(buildThemeCss({}), buildThemeCss({ intensity: "medium" }));
  assert.deepEqual(buildThemeCss(),    buildThemeCss({ intensity: "medium" }));
});

// ─── Optional knobs ────────────────────────────────────────────────
test("buildThemeCss: forceMono adds the Share Tech Mono font override", () => {
  const css = buildThemeCss({ forceMono: true });
  assert.match(css, /Share Tech Mono/);
  assert.match(css, /\*:not\(code\)/);
});

test("buildThemeCss: forceMono off → no font override", () => {
  const css = buildThemeCss({ forceMono: false });
  assert.doesNotMatch(css, /\*:not\(code\)/);
});

test("buildThemeCss: scanlines adds a body::after CRT overlay", () => {
  const css = buildThemeCss({ scanlines: true });
  assert.match(css, /body::after/);
  assert.match(css, /repeating-linear-gradient/);
  assert.match(css, /mix-blend-mode: screen/);
});

test("buildThemeCss: scanlines off → no body::after rule", () => {
  const css = buildThemeCss({ scanlines: false });
  assert.doesNotMatch(css, /body::after/);
});

test("buildThemeCss: darkMode applies CSS filter inversion on html + re-inverts media", () => {
  const css = buildThemeCss({ darkMode: true });
  // <html> gets the inversion filter — this is what makes Amazon-like
  // pages actually look dark instead of just having recolored links.
  assert.match(css, /html \{[^}]*filter:\s*invert\(0\.92\)/);
  assert.match(css, /hue-rotate\(180deg\)/);
  // Media elements (img/video/picture/canvas/iframe/svg image/bg-image
  // inline styles) get the inversion re-applied so they keep their
  // original colors.
  assert.match(css, /img, video, picture, canvas, iframe/);
  assert.match(css, /\[style\*="background-image"\]/);
});

test("buildThemeCss: darkMode off → no html filter", () => {
  const css = buildThemeCss({ darkMode: false });
  assert.doesNotMatch(css, /html \{[^}]*filter:/);
});

test("buildThemeCss: darkMode layers UNDER intensity rules (filter declared first)", () => {
  const css = buildThemeCss({ darkMode: true, intensity: "medium" });
  // The inversion block must appear before the body-bg block so any
  // subsequent body recolor sits on top of the filtered base.
  const filterIdx = css.indexOf("filter: invert(0.92)");
  const bodyIdx   = css.indexOf("html, body");
  assert.ok(filterIdx >= 0 && bodyIdx > filterIdx,
    "darkMode filter block must precede the intensity-medium body rule");
});

test("buildThemeCss: every property uses !important so site styles can't override", () => {
  const css = buildThemeCss({ intensity: "full", forceMono: true, scanlines: true });
  // A spot-check: pull every "selector { ... }" block and count declarations
  // that don't end in !important. There's a few harmless ones (custom-
  // prop assignments inside :root, etc.); just verify it's small.
  const decls = css.match(/[a-z-]+\s*:\s*[^;]+;/gi) || [];
  const unimportant = decls.filter((d) => !/!important\s*;\s*$/.test(d));
  assert.ok(unimportant.length === 0,
    `every declaration must use !important, ${unimportant.length} unguarded:\n${unimportant.slice(0, 5).join("\n")}`);
});

// ─── Host routing ──────────────────────────────────────────────────
test("hostnameOf: extracts lowercase hostname, returns '' on parse error", () => {
  assert.equal(hostnameOf("https://Example.COM/path"),    "example.com");
  assert.equal(hostnameOf("http://sub.foo.test:8000/x"),  "sub.foo.test");
  assert.equal(hostnameOf("not a url"),                   "");
  assert.equal(hostnameOf(""),                            "");
});

test("shouldApplyTo: disabled or no settings → false", () => {
  assert.equal(shouldApplyTo("example.com", null),                       false);
  assert.equal(shouldApplyTo("example.com", { enabled: false }),         false);
});

test("shouldApplyTo: mode='all' (default) — domains[] acts as blocklist", () => {
  const s = { enabled: true, domains: ["example.com"] };
  assert.equal(shouldApplyTo("example.com",      s), false);
  assert.equal(shouldApplyTo("sub.example.com",  s), false);
  assert.equal(shouldApplyTo("other.com",        s), true);
});

test("shouldApplyTo: mode='allowlist' — only listed domains theme", () => {
  const s = { enabled: true, mode: "allowlist", domains: ["example.com"] };
  assert.equal(shouldApplyTo("example.com",     s), true);
  assert.equal(shouldApplyTo("sub.example.com", s), true);
  assert.equal(shouldApplyTo("other.com",       s), false);
});

test("shouldApplyTo: subdomain matching is right-anchored (host must end with .domain)", () => {
  const s = { enabled: true, domains: ["example.com"] };
  // "evilexample.com" does NOT match "example.com" — must be a dot boundary.
  assert.equal(shouldApplyTo("evilexample.com", s), true,
    "evilexample.com should NOT be considered a subdomain of example.com");
});

test("shouldApplyTo: case-insensitive host comparison", () => {
  const s = { enabled: true, mode: "allowlist", domains: ["Example.com"] };
  assert.equal(shouldApplyTo("example.com",     s), true);
  assert.equal(shouldApplyTo("EXAMPLE.COM",     s), true);
  assert.equal(shouldApplyTo("sub.Example.COM", s), true);
});

test("shouldApplyTo: empty domains[] in blocklist mode → theme everything; in allowlist → nothing", () => {
  assert.equal(shouldApplyTo("anywhere.com", { enabled: true, mode: "all",       domains: [] }), true);
  assert.equal(shouldApplyTo("anywhere.com", { enabled: true, mode: "blocklist", domains: [] }), true);
  assert.equal(shouldApplyTo("anywhere.com", { enabled: true, mode: "allowlist", domains: [] }), false);
});
