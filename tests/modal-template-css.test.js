// Shadow-DOM CSS inlined in modal/content.template.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

const cssMatch = tmpl.match(/const CSS = `\n([\s\S]*?)  `;/);
assert.ok(cssMatch, "CSS template literal not found");
const css = cssMatch[1];

test("modal CSS inlines Share Tech Mono via base64 FONT_STM marker", () => {
  assert.match(css, /font-family: 'Share Tech Mono'/);
  assert.match(css, /data:font\/woff2;base64,\$\{FONT_STM\}/);
});

test("modal CSS inlines Orbitron via base64 FONT_ORB marker", () => {
  assert.match(css, /font-family: 'Orbitron'/);
  assert.match(css, /data:font\/woff2;base64,\$\{FONT_ORB\}/);
});

test("modal CSS :host sets font-family with important to beat host page", () => {
  assert.match(css, /:host \{[\s\S]*?font-family:.*!important/);
});

test("modal CSS documents all:initial !important cascade bug on :host", () => {
  assert.match(tmpl, /all: initial !important/);
});

test("modal CSS overlay uses semi-transparent backdrop", () => {
  assert.match(css, /\.overlay/);
});

test("modal CSS selected row uses cyan accent like popup", () => {
  assert.match(css, /\.row\.sel/);
  assert.match(css, /#05d9e8|cyan/i);
});

test("modal CSS defines fzf-hl mark styling for search highlights", () => {
  assert.match(css, /fzf-hl|mark\.fzf-hl/);
});

test("modal CSS minimap mm-active uses white box-shadow ring", () => {
  assert.match(css, /\.mm-active/);
  assert.match(css, /box-shadow: 0 0 0 2px #fff/);
});

test("modal CSS minimap mm-pinned uses accent border color", () => {
  assert.match(css, /\.mm-pinned/);
  assert.match(css, /border-color: #ff2a6d/);
});

test("modal CSS tree-toggle button styling present", () => {
  assert.match(css, /\.tree-toggle/);
});

test("modal CSS scene-save-form styles present", () => {
  assert.match(css, /\.scene-save-form/);
});

test("modal openModal attaches closed shadow root to host", () => {
  assert.match(tmpl, /attachShadow\(\{ mode: "closed" \}\)/);
});

test("modal openModal injects CSS and html into shadow innerHTML", () => {
  assert.match(tmpl, /shadow\.innerHTML = `<style>\$\{CSS\}<\/style>` \+ html\(\)/);
});

test("modal focus sink is 1px invisible input outside shadow DOM", () => {
  assert.match(tmpl, /width:1px !important/);
  assert.match(tmpl, /opacity:0 !important/);
});

test("modal focus sink uses z-index near max int for Vimium compatibility", () => {
  assert.match(tmpl, /z-index:2147483646 !important/);
});

test("modal repeat openModal while state set cycles forward instead of reinstalling", () => {
  assert.match(tmpl, /if \(state\) \{[\s\S]*?cycle\(\+1\)/);
});
