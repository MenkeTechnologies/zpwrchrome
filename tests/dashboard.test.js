// zpwrchrome dashboard hub — the searchable tile grid that launches every tool,
// settings page and info screen (options_ui landing). These invariants keep the
// catalog honest: every tile must point at a page that actually ships, and the
// page must be wired into the popup, manifest command, and context menu.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const html = read("scripts-manager/dashboard.html");
const css = read("scripts-manager/dashboard.css");
const js = read("scripts-manager/dashboard.js");

test("dashboard.html exists, is dark-themed, and loads dashboard.js/.css", () => {
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /<link rel="stylesheet" href="dashboard\.css">/);
  assert.match(html, /<script src="dashboard\.js" type="module">/);
});

test("dashboard.html has the search box and tile grid mount point", () => {
  assert.match(html, /id="search"/);
  assert.match(html, /id="grid"/);
  assert.match(html, /id="count"/);
});

// Parse the SECTIONS catalog out of the module without importing it (it touches
// chrome.* + DOM at load). We only need the tile page targets.
function catalogPages() {
  const pages = [...js.matchAll(/page:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(pages.length >= 15, `expected a rich tile catalog, got ${pages.length}`);
  return pages;
}

test("every dashboard tile points at a scripts-manager page that ships", () => {
  for (const page of catalogPages()) {
    assert.ok(
      existsSync(join(ROOT, "scripts-manager", page)),
      `dashboard tile references missing page scripts-manager/${page}`,
    );
  }
});

test("catalog covers the load-bearing tools", () => {
  for (const page of ["downloads.html", "manager.html", "pass.html", "find-all.html", "reader-mode.html"]) {
    assert.ok(js.includes(`"${page}"`), `dashboard missing a tile for ${page}`);
  }
});

test("dashboard persists per-category tile order and reorders via drag", () => {
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /dragstart/);
  assert.match(js, /dragover/);
  assert.match(js, /saveOrder/);
});

test("dashboard filters tiles and shows live stats", () => {
  assert.match(js, /function matches\(/);
  assert.match(js, /kind:\s*"scripts\.list"/);
  assert.match(js, /kind:\s*"dl\.list"/);
});

test("dashboard css defines the cyberpunk tile chrome", () => {
  assert.match(css, /--cyan:\s+#05d9e8/);
  assert.match(css, /\.tile\s*\{/);
  assert.match(css, /clip-path:/);
});

test("popup links to the dashboard and opens it in a tab", () => {
  const popupHtml = read("popup.html");
  const popupJs = read("popup.js");
  assert.match(popupHtml, /id="open-dashboard"/);
  assert.match(popupJs, /getElementById\("open-dashboard"\)/);
  assert.match(popupJs, /scripts-manager\/dashboard\.html/);
});

test("manifest routes options_ui + an open-dashboard command to the dashboard", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.options_ui.page, "scripts-manager/dashboard.html");
  assert.ok(manifest.commands["open-dashboard"], "manifest must declare the open-dashboard command");
});

test("background.js handles open-dashboard and focuses an existing tab", () => {
  const bg = read("background.js");
  assert.match(bg, /command === "open-dashboard"/);
  const fn = bg.match(/async function openDashboard\([\s\S]*?\n\}/);
  assert.ok(fn, "openDashboard helper must exist");
  assert.match(fn[0], /scripts-manager\/dashboard\.html/);
  assert.match(fn[0], /chrome\.tabs\.query/);
  // context-menu route
  assert.match(bg, /\[CTX_ACT_DASH\]:\s*"\/scripts-manager\/dashboard\.html"/);
});
