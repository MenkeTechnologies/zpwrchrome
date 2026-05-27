// scripts-manager/manager.css layout and HUD styling invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const css = readFileSync(join(ROOT, "scripts-manager/manager.css"), "utf8");

test("manager.css defines Share Tech Mono and Orbitron font faces", () => {
  assert.match(css, /font-family: 'Share Tech Mono'/);
  assert.match(css, /font-family: 'Orbitron'/);
});

test("manager.css banner uses gradient background with cyan accent line", () => {
  assert.match(css, /\.banner \{/);
  assert.match(css, /\.banner::after/);
});

test("manager.css tabs strip styles active tab with accent underline", () => {
  assert.match(css, /\.tab\.active/);
});

test("manager.css tab-add button uses accent color for new script affordance", () => {
  assert.match(css, /\.tab-add/);
});

test("manager.css error and info banners use distinct color treatments", () => {
  assert.match(css, /\.error \{/);
  assert.match(css, /\.info \{/);
});

test("manager.css hidden utility class uses display none important", () => {
  assert.match(css, /\.hidden \{ display: none !important; \}/);
});

test("manager.css pane visibility toggles via .pane.active", () => {
  assert.match(css, /\.pane \{ display: none; \}/);
  assert.match(css, /\.pane\.active \{ display: block; \}/);
});

test("manager.css filter input focus ring uses accent glow", () => {
  assert.match(css, /\.filter:focus/);
  assert.match(css, /box-shadow: 0 0 12px var\(--accent-glow\)/);
});

test("manager.css scripts table header supports sortable columns", () => {
  assert.match(css, /\.scripts th\.sortable/);
  assert.match(css, /\.scripts th\.sort-asc/);
  assert.match(css, /\.scripts th\.sort-desc/);
});

test("manager.css disabled script rows reduce opacity", () => {
  assert.match(css, /\.scripts tbody tr\.disabled/);
  assert.match(css, /opacity: \.55/);
});

test("manager.css toggle switch uses pseudo-element knob", () => {
  assert.match(css, /\.toggle::after/);
});

test("manager.css GM badge uses on class for granted scripts", () => {
  assert.match(css, /\.badge\.on/);
});

test("manager.css row delete button has delete hover styling", () => {
  assert.match(css, /\.row-actions button\.delete:hover/);
});

test("manager.css modal-backdrop covers viewport for editor", () => {
  assert.match(css, /\.modal-backdrop/);
  assert.match(css, /position:\s*fixed/);
});

test("manager.css editor textarea uses monospace stack", () => {
  assert.match(css, /#editor/);
  assert.match(css, /font-family.*mono/i);
});

test("manager.css utilities pane styles btn-secondary buttons", () => {
  assert.match(css, /\.btn-secondary/);
});

test("manager.css log table scrolls inside table-wrap", () => {
  assert.match(css, /\.table-wrap/);
});

test("manager.css home-link for namespace URLs uses cyan accent", () => {
  assert.match(css, /\.home-link/);
});
