// docs/report.html must reflect live repo stats from scripts/gen.mjs logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const lineCount = (s) => s.split("\n").length;

const manifest = JSON.parse(read("manifest.json"));
const report = read("docs/report.html");
const testFiles = readdirSync(join(ROOT, "tests")).filter((f) => f.endsWith(".test.js"));
const testCount = testFiles.reduce((sum, f) => {
  return sum + (read("tests/" + f).match(/^test\(/gm) || []).length;
}, 0);

const SOURCES = [
  "background.js", "popup.js", "popup.html", "popup.css",
  "modal/content.template.js", "lib/util.js", "lib/fzf.js",
  "lib/userscript.js", "lib/gm-shim.js",
  "scripts-manager/manager.html", "scripts-manager/manager.js", "scripts-manager/manager.css",
];
const sourceLines = Object.fromEntries(SOURCES.map((p) => [p, lineCount(read(p))]));
const totalJsLines = ["background.js", "popup.js", "modal/content.template.js",
  "lib/util.js", "lib/fzf.js", "lib/userscript.js", "lib/gm-shim.js", "scripts-manager/manager.js"]
  .reduce((s, p) => s + sourceLines[p], 0);
const totalCssLines = ["popup.css", "scripts-manager/manager.css"]
  .reduce((s, p) => s + sourceLines[p], 0);
const totalHtmlLines = ["popup.html", "scripts-manager/manager.html"]
  .reduce((s, p) => s + sourceLines[p], 0);
const totalTestLines = testFiles.reduce((s, f) => s + lineCount(read("tests/" + f)), 0);

const bgSrc = read("background.js");
const popupJs = read("popup.js");
const commandCount = Object.keys(manifest.commands).length;
const bgKinds = [...new Set(
  [...bgSrc.matchAll(/msg\?\.kind === "([a-z][\w-]*(?::[a-z][\w-]*)?)"/g)].map((m) => m[1])
)].sort();
const dispatchHandlers = [...bgSrc.matchAll(/command === "([a-z][\w-]*)"/g)].map((m) => m[1]);
const popupCategoryLabels = [...popupJs.matchAll(/\{\s*id:\s*"([a-z]+)",\s*label:\s*"([^"]+)",\s*key:\s*"([^"]+)"\s*\}/g)]
  .map((m) => m[2]);
const utilExports = [...read("lib/util.js").matchAll(/^export (?:const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const defaultKeyed = Object.keys(manifest.commands).filter((k) => manifest.commands[k].suggested_key).length;

test("report.html exists and declares dark color-scheme", () => {
  assert.match(report, /data-theme="dark"/);
  assert.match(report, /color-scheme: dark/);
});

test("report.html meta description includes dynamic test count", () => {
  assert.match(report, new RegExp(`${testCount} tests`));
});

test("report.html stat grid shows live JS line count", () => {
  assert.match(report, new RegExp(`<div class="v">${totalJsLines.toLocaleString("en-US")}</div><div class="l">JS Lines</div>`));
});

test("report.html stat grid shows live CSS line count", () => {
  assert.match(report, new RegExp(`<div class="v">${totalCssLines.toLocaleString("en-US")}</div><div class="l">CSS Lines</div>`));
});

test("report.html stat grid shows manifest command count", () => {
  assert.match(report, new RegExp(`<div class="v a">${commandCount}</div><div class="l">Keyboard Commands</div>`));
});

test("report.html stat grid shows passing test count", () => {
  assert.match(report, new RegExp(`<div class="v g">${testCount}</div><div class="l">Tests Passing</div>`));
});

test("report.html stat grid shows popup category count", () => {
  assert.match(report, new RegExp(`<div class="v">${popupCategoryLabels.length}</div><div class="l">Popup Categories</div>`));
});

test("report.html stat grid shows background message kind count", () => {
  assert.match(report, new RegExp(`<div class="v m">${bgKinds.length}</div><div class="l">Message Kinds</div>`));
});

test("report.html stat grid shows dispatch handler count", () => {
  assert.match(report, new RegExp(`<div class="v">${dispatchHandlers.length}</div><div class="l">Dispatch Handlers</div>`));
});

test("report.html stat grid shows manifest permission count", () => {
  assert.match(report, new RegExp(`<div class="v">${manifest.permissions.length}</div><div class="l">Permissions</div>`));
});

test("report.html stat grid shows util.js export count", () => {
  assert.match(report, new RegExp(`<div class="v">${utilExports.length}</div><div class="l">Pure Helpers</div>`));
});

test("report.html stat grid shows manifest version", () => {
  assert.match(report, new RegExp(`<div class="v">v${manifest.version}</div><div class="l">Version</div>`));
});

test("report.html stat grid shows default-keyed command count", () => {
  assert.match(report, new RegExp(`<div class="v y">${defaultKeyed}</div><div class="l">Default-Keyed</div>`));
});

test("report.html source distribution bar includes test line count", () => {
  assert.match(report, new RegExp(`Tests &middot; ${totalTestLines.toLocaleString("en-US")} lines`));
});

test("report.html subsystem breakdown lists background.js line count", () => {
  // gen.mjs renders counts via Number.toLocaleString("en-US") which inserts
  // thousands separators (1,121); the raw assertion form silently worked
  // only while every tracked file was under 1,000 lines.
  assert.match(report, new RegExp(`background\\.js</code> &mdash; ${sourceLines["background.js"].toLocaleString("en-US")} lines`));
});

test("report.html subsystem breakdown lists popup.js line count", () => {
  assert.match(report, new RegExp(`popup\\.js</code> &mdash; ${sourceLines["popup.js"].toLocaleString("en-US")} lines`));
});

test("report.html subsystem breakdown lists modal template line count", () => {
  assert.match(report, new RegExp(`modal/content\\.template\\.js</code> &mdash; ${sourceLines["modal/content.template.js"].toLocaleString("en-US")} lines`));
});

test("report.html lists every popup category label from popup.js", () => {
  for (const label of popupCategoryLabels) {
    assert.match(report, new RegExp(`>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`),
      `report missing category ${label}`);
  }
});

test("report.html documents every background message kind", () => {
  for (const kind of bgKinds) {
    assert.match(report, new RegExp(`>${kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`),
      `report missing message kind ${kind}`);
  }
});

test("report.html links to GitHub source repo", () => {
  assert.match(report, /github\.com\/MenkeTechnologies\/zpwrchrome/);
});

test("report.html includes engineering report title", () => {
  assert.match(report, /ENGINEERING REPORT/);
});

test("report.html includes executive summary section", () => {
  assert.match(report, />EXECUTIVE SUMMARY</);
});

test("report.html includes subsystem breakdown section", () => {
  assert.match(report, />SUBSYSTEM BREAKDOWN</);
});

test("report.html total repo line sum includes JS CSS HTML and tests", () => {
  const totalLines = totalJsLines + totalCssLines + totalHtmlLines + totalTestLines;
  assert.match(report, new RegExp(`${totalLines.toLocaleString("en-US")} total lines`));
});

test("report.html HTML line stat matches popup.html + manager.html", () => {
  assert.match(report, new RegExp(`HTML &middot; ${totalHtmlLines.toLocaleString("en-US")} lines`));
});

test("report.html includes an SVG architecture diagram with the three process groups", () => {
  // Pinned so a gen.mjs regression can't silently delete the section.
  assert.match(report, /<h2 class="section">[\s\S]*?ARCHITECTURE<\/h2>/);
  assert.match(report, /<svg class="arch"/);
  // Three labeled groups: browser, native host, filesystem.
  assert.match(report, />CHROME \(host browser\)</);
  assert.match(report, />NATIVE HOST \(Rust\)</);
  assert.match(report, />FILESYSTEM/);
  // Key components must be labeled (catches accidental relabel drift).
  for (const label of [
    "Service Worker", "Popup", "Extension pages", "Content scripts",
    "chrome.* APIs", "chrome.storage", "zpwrchrome-host",
    "Extension actions", "Detached workers",
    "~/.cache/zpwrchrome/dl/", "~/Downloads/", "~/.password-store/",
  ]) {
    assert.ok(report.includes(label), `architecture diagram missing label "${label}"`);
  }
});

test("report.html repo file count is derived not hardcoded stale", () => {
  // Mirror scripts/gen.mjs — count git-tracked files so local dev trees
  // (with target/, lockfiles, etc.) and fresh CI checkouts agree.
  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean).length;
  assert.match(report, new RegExp(`<div class="v">${tracked}</div><div class="l">Repo Files</div>`));
});
