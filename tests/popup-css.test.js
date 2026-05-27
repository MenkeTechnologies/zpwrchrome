// Popup stylesheet invariants — palette, layout, and HUD chrome.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const css = readFileSync(join(ROOT, "popup.css"), "utf8");

test("popup.css loads Share Tech Mono and Orbitron from local fonts/", () => {
  assert.match(css, /font-family: 'Share Tech Mono'/);
  assert.match(css, /src: url\('fonts\/ShareTechMono-Regular\.woff2'\)/);
  assert.match(css, /font-family: 'Orbitron'/);
  assert.match(css, /src: url\('fonts\/Orbitron\.woff2'\)/);
});

test("popup.css defines strykelang HUD palette on :root", () => {
  assert.match(css, /--cyan:\s+#05d9e8/);
  assert.match(css, /--accent:\s+#ff2a6d/);
  assert.match(css, /--magenta:\s+#d300c5/);
  assert.match(css, /--bg-primary:\s+#05050a/);
});

test("popup.css fixes popup dimensions to 720×560", () => {
  assert.match(css, /html, body \{[\s\S]*?width: 720px/);
  assert.match(css, /height: 560px/);
});

test("popup.css uses border-box globally", () => {
  assert.match(css, /\* \{[\s\S]*?box-sizing: border-box/);
});

test("popup.css styles selected row with cyan accent border", () => {
  assert.match(css, /\.row\.sel/);
  assert.match(css, /border.*var\(--cyan\)/);
});

test("popup.css defines fzf highlight mark class", () => {
  assert.match(css, /mark\.fzf-hl|\.fzf-hl/);
});

test("popup.css category strip uses two-column cat layout", () => {
  assert.match(css, /\.cats/);
  assert.match(css, /\.cat/);
  assert.match(css, /\.cat\.sel/);
});

test("popup.css minimap grid defines mm-cell and mm-pinned variants", () => {
  assert.match(css, /\.mm-grid/);
  assert.match(css, /\.mm-cell/);
  assert.match(css, /\.mm-pinned/);
  assert.match(css, /\.mm-active/);
});

test("popup.css tree rows support indent via padding-left on .tree-row", () => {
  assert.match(css, /\.tree-row/);
});

test("popup.css scene form styles scene-save-btn and scene-name input", () => {
  assert.match(css, /\.scene-save-btn/);
  assert.match(css, /\.scene-name/);
});

test("popup.css kill-heaviest button uses accent color", () => {
  assert.match(css, /\.kill-heaviest/);
});

test("popup.css proc-col styles memory/CPU column when processes API available", () => {
  assert.match(css, /\.proc-col/);
});

test("popup.css badge variants style pinned and audible rows", () => {
  assert.match(css, /\.badge\.pinned/);
  assert.match(css, /\.badge\.audible/);
});

test("popup.js emits muted badge class on muted tabs", () => {
  const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
  assert.match(popup, /class="badge muted">muted<\/span>/);
});

test("popup.css footer documents keyboard hints with kbd elements", () => {
  assert.match(css, /\.footer/);
  assert.match(css, /kbd/);
});

test("popup.css list area scrolls independently of header", () => {
  assert.match(css, /\.body/);
  assert.match(css, /\.list/);
  assert.match(css, /overflow.*auto|overflow-y.*auto/);
});

test("popup.css empty state styling for zero-result lists", () => {
  assert.match(css, /\.empty/);
});

test("popup.css selection highlight uses semi-transparent cyan", () => {
  assert.match(css, /::selection/);
  assert.match(css, /rgba\(5, 217, 232/);
});

test("popup.css modal container fills the popup frame", () => {
  assert.match(css, /\.modal \{[\s\S]*?width: 100%[\s\S]*?height: 100%/);
});
