// modal html() template structure and accessibility in content.template.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

const htmlStart = tmpl.indexOf("function html()");
const htmlEnd = tmpl.indexOf("function wire()");
assert.ok(htmlStart >= 0 && htmlEnd > htmlStart, "html() missing");
const htmlFn = tmpl.slice(htmlStart, htmlEnd);

test("modal html sets role dialog and aria-modal on modal container", () => {
  assert.match(htmlFn, /role="dialog" aria-modal="true"/);
});

test("modal html aria-label describes Recent Tabs purpose", () => {
  assert.match(htmlFn, /aria-label="Recent Tabs"/);
});

test("modal html includes search input with filter placeholder", () => {
  assert.match(htmlFn, /class="search"[\s\S]*?placeholder="filter \/\/ url, title, host"/);
});

test("modal html header title shows zpwrchrome recent branding", () => {
  assert.match(htmlFn, /zpwrchrome \/\/ recent/);
});

test("modal html renders all CATEGORIES with label and shortcut key", () => {
  assert.match(htmlFn, /CATEGORIES\.map\(\(c, i\) =>/);
  assert.match(htmlFn, /\$\{c\.label\}/);
  assert.match(htmlFn, /\$\{c\.key\}/);
});

test("modal html first category gets sel class by default", () => {
  assert.match(htmlFn, /i === 0 \? " sel" : ""/);
});

test("modal html includes scripts dashboard hint link", () => {
  assert.match(htmlFn, /data-act="open-scripts"/);
  assert.match(htmlFn, /scripts ▸/);
});

test("modal html hint shows platform-specific cycle shortcut", () => {
  assert.match(htmlFn, /navigator\.platform\.includes\("Mac"\)/);
  assert.match(htmlFn, /⌘E/);
  assert.match(htmlFn, /Ctrl\+E/);
});

test("modal html body contains cats sidebar and list region", () => {
  assert.match(htmlFn, /class="cats"/);
  assert.match(htmlFn, /class="list"/);
});

test("modal html cats include data-id for category switching", () => {
  assert.match(htmlFn, /data-id="\$\{c\.id\}"/);
});

test("modal template MODAL_ID guard prevents double install", () => {
  assert.match(tmpl, /if \(window\[MODAL_ID \+ "-installed"\]\) return/);
  assert.match(tmpl, /window\[MODAL_ID \+ "-installed"\] = true/);
});

test("modal template uses IIFE wrapper for lexical isolation", () => {
  assert.match(tmpl, /\(\(\) => \{/);
  assert.match(tmpl, /\}\)\(\);?\s*$/);
});
