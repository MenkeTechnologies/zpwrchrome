// popup.html structural invariants — CSP-safe markup and HUD chrome.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const html = readFileSync(join(ROOT, "popup.html"), "utf8");

test("popup.html exists and declares dark theme on html element", () => {
  assert.ok(existsSync(join(ROOT, "popup.html")));
  assert.match(html, /<html lang="en" data-theme="dark">/);
});

test("popup.html loads popup.css and popup.js module", () => {
  assert.match(html, /<link rel="stylesheet" href="popup\.css">/);
  assert.match(html, /<script src="popup\.js" type="module"><\/script>/);
});

test("popup.html has no inline event handlers (MV3 CSP)", () => {
  const inline = /\bon(click|change|input|error|load|submit|keydown|mouseover|mouseenter|focus|blur)\s*=/i;
  assert.ok(!inline.test(html));
});

test("popup.html search input has autofocus and autocomplete off", () => {
  assert.match(html, /class="search"[^>]+autocomplete="off"[^>]+autofocus/);
});

test("popup.html declares cats and list mount points", () => {
  assert.match(html, /id="cats"/);
  assert.match(html, /id="list"/);
});

test("popup.html killHeaviest button starts hidden", () => {
  assert.match(html, /id="killHeaviest"[^>]*class="[^"]*hidden/);
});

test("popup.html killHeaviest title mentions dev/canary processes API", () => {
  assert.match(html, /title="Close the most memory-heavy tab \(Chrome dev\/canary only\)"/);
});

test("popup.html open-scripts link is present with hash href (handled in JS)", () => {
  assert.match(html, /id="open-scripts"/);
  assert.match(html, /href="#"/);
});

test("popup.html footer documents arrow, enter, category, tree, backspace keys", () => {
  assert.match(html, /<kbd>↑↓<\/kbd>nav/);
  assert.match(html, /<kbd>Enter<\/kbd>switch/);
  assert.match(html, /<kbd>⌘1–0<\/kbd>category/);
  assert.match(html, /<kbd>←→<\/kbd>tree/);
  assert.match(html, /<kbd>⌫<\/kbd>close tab/);
});

test("popup.html title bar reads zpwrchrome // recent", () => {
  assert.match(html, /zpwrchrome \/\/ recent/);
});

test("popup.html uses modal layout class matching popup.css", () => {
  assert.match(html, /<div class="modal">/);
  assert.match(html, /<div class="header">/);
  assert.match(html, /<div class="body">/);
  assert.match(html, /<div class="footer">/);
});

test("popup.html search placeholder mentions filter dimensions", () => {
  assert.match(html, /placeholder="filter \/\/ url, title, host"/);
});

test("popup.html charset is utf-8", () => {
  assert.match(html, /<meta charset="utf-8">/);
});

test("popup.html page title is zpwrchrome", () => {
  assert.match(html, /<title>zpwrchrome<\/title>/);
});
