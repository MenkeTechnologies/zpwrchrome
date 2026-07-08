// Userscript dashboard invariants — scripts-manager/manager.{html,js,css}.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const html = read("scripts-manager/manager.html");
const js   = read("scripts-manager/manager.js");
const css  = read("scripts-manager/manager.css");

test("manager.html exists and loads manager.js as ES module", () => {
  assert.ok(existsSync(join(ROOT, "scripts-manager/manager.html")));
  assert.match(html, /<script[^>]+src="manager\.js"[^>]+type="module"/);
});

test("manager.html has no inline event handlers (MV3 CSP)", () => {
  const inline = /\bon(click|change|input|error|load|submit|keydown|mouseover|mouseenter|focus|blur)\s*=/i;
  assert.ok(!inline.test(html));
});

test("manager.html declares all five dashboard tabs", () => {
  for (const tab of ["installed", "log", "settings", "utilities", "help"]) {
    assert.match(html, new RegExp(`data-tab="${tab}"`), `missing tab "${tab}"`);
    assert.match(html, new RegExp(`id="pane-${tab}"`), `missing pane "${tab}"`);
  }
});

test("manager.html editor modal uses textarea (not inline handlers)", () => {
  assert.match(html, /id="editor-modal"/);
  assert.match(html, /id="editor"/);
  assert.match(html, /id="editor-save"/);
  assert.match(html, /id="editor-cancel"/);
});

test("manager.html run log table declares the six contract columns", () => {
  for (const col of ["When", "Script", "URL", "Tab", "Frame"]) {
    assert.match(html, new RegExp(`<th[^>]*>${col}`));
  }
});

test("manager.html utilities pane supports file and URL import", () => {
  assert.match(html, /id="util-import-file"/);
  assert.match(html, /id="file-input"[^>]+accept="\.user\.js,\.js"/);
  assert.match(html, /id="util-import-url"/);
  assert.match(html, /id="util-import-url-btn"/);
});

test("manager.html utilities pane supports JSON and bundle export", () => {
  assert.match(html, /id="util-export-all"/);
  assert.match(html, /id="util-export-bundle"/);
});

test("manager.html settings pane exposes wipe-all danger action", () => {
  assert.match(html, /id="wipe-all"/);
  assert.match(html, /erase all scripts/i);
});

test("manager.html fallback banner explains the three-step native-mode path", () => {
  assert.match(html, /id="banner-fallback"/);
  assert.match(html, /Allow User Scripts/);
  assert.match(html, /Developer mode/);
});

test("manifest.json routes options_ui to scripts-manager/dashboard.html", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.options_ui.page, "scripts-manager/dashboard.html");
  assert.equal(manifest.options_ui.open_in_tab, true);
});

test("manager.js imports userscript helpers from lib/userscript.js", () => {
  assert.match(js, /import[\s\S]+from\s+"\.\.\/lib\/userscript\.js"/);
  assert.match(js, /parseMetadata/);
  assert.match(js, /validateUserscript/);
  assert.match(js, /userscriptId/);
});

test("manager.js TEMPLATE ships a valid starter ==UserScript== block", () => {
  assert.match(js, /const TEMPLATE = `\/\/ ==UserScript==/);
  assert.match(js, /@name\s+my script/);
  assert.match(js, /@match\s+https:\/\/\*\.example\.com\/\*/);
});

test("manager.js send() wraps chrome.runtime.sendMessage with a Promise + callback", () => {
  const fn = js.match(/function send\(msg\)[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /chrome\.runtime\.sendMessage\(msg,\s*resolve\)/);
});

test("manager.js refresh() pulls scripts.list from background", () => {
  const fn = js.match(/async function refresh\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /kind:\s*"scripts\.list"/);
});

test("manager.js distinguishes native vs fallback mode in the API stat cell", () => {
  assert.match(js, /resp\?\.mode === "fallback"/);
  assert.match(js, /native chrome\.userScripts/);
  assert.match(js, /fallback \(chrome\.scripting \+ webNavigation\)/);
});

test("manager.js save dialog sends scripts.save with isNew derived from editing", () => {
  assert.match(js, /const isNew = !editing/);
  assert.match(js, /kind:\s*"scripts\.save"/);
  assert.match(js, /isNew,/);
});

test("manager.js save dialog blocks invalid metadata before sending", () => {
  assert.match(js, /validateUserscript\(meta\)/);
  assert.match(js, /if \(errs\.length\) \{ alert\("can't save:/);
});

test("manager.js row toggle sends scripts.toggle with inverted enabled flag", () => {
  assert.match(js, /kind:\s*"scripts\.toggle"/);
  assert.match(js, /enabled:\s*tr\.classList\.contains\("disabled"\)/);
});

test("manager.js row delete confirms before scripts.delete", () => {
  assert.match(js, /confirm\("delete this script\? GM storage will also be removed\."\)/);
  assert.match(js, /kind:\s*"scripts\.delete"/);
});

test("manager.js editor supports Escape to close and Cmd/Ctrl+S to save", () => {
  assert.match(js, /e\.key === "Escape" && !\$modal\.classList\.contains\("hidden"\)/);
  assert.match(js, /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === "s"/);
  assert.match(js, /\$editSave\.click\(\)/);
});

test("manager.js live-updates Run Log via chrome.storage.onChanged", () => {
  assert.match(js, /chrome\.storage\.onChanged\.addListener/);
  assert.match(js, /changes\["userScripts\.fireLog"\]/);
  assert.match(js, /refreshLog\(\)/);
});

test("manager.js refreshLog reads scripts.firelog from background", () => {
  assert.match(js, /kind:\s*"scripts\.firelog"/);
});

test("manager.js clear log confirms then sends scripts.firelog.clear", () => {
  assert.match(js, /confirm\("clear the run log\?"\)/);
  assert.match(js, /kind:\s*"scripts\.firelog\.clear"/);
});

test("manager.js renderLog filters by script name, id, and url", () => {
  const fn = js.match(/function renderLog\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /e\.name/);
  assert.match(fn[0], /e\.script/);
  assert.match(fn[0], /e\.url/);
});

test("manager.js sortScripts supports name, size, and updatedAt columns", () => {
  assert.match(js, /function sortScripts\(/);
  assert.match(js, /if \(key === "name"\)/);
  assert.match(js, /if \(key === "size"\)/);
  assert.match(js, /if \(key === "updatedAt"\)/);
});

test("manager.js filterScripts matches name, namespace, and match patterns", () => {
  const fn = js.match(/function filterScripts\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /meta\.namespace/);
  assert.match(fn[0], /meta\.matches/);
  assert.match(fn[0], /meta\.includes/);
});

test("manager.js util-resync sends scripts.resync and surfaces skipped scripts", () => {
  assert.match(js, /kind:\s*"scripts\.resync"/);
  assert.match(js, /r\?\.skipped/);
});

test("manager.js util-export-all serializes scripts as JSON", () => {
  assert.match(js, /JSON\.stringify\(scripts/);
  assert.match(js, /zpwrchrome-userscripts\.json/);
});

test("manager.js util-export-bundle joins sources with a separator banner", () => {
  assert.match(js, /scripts\.map\(\(s\) => s\.src\)\.join/);
  assert.match(js, /zpwrchrome-userscripts\.user\.js/);
});

test("manager.js wipe-all deletes every script via scripts.delete", () => {
  assert.match(js, /confirm\("erase ALL userscripts/);
  assert.match(js, /for \(const s of scripts\) await send\(\{ kind: "scripts\.delete"/);
});

test("manager.js open-chrome-ext buttons deep-link to this extension's card", () => {
  assert.match(js, /chrome:\/\/extensions\/\?id=" \+ chrome\.runtime\.id/);
  assert.match(js, /open-chrome-ext/);
});

test("manager.js rowHtml escapes script metadata for HTML injection safety", () => {
  assert.match(js, /escapeHtml\(meta\.name/);
  assert.match(js, /escapeHtml\(s\.id\)/);
});

test("manager.js rowHtml shows GM badge when @grant directives exist", () => {
  assert.match(js, /meta\.grants\?\.length/);
  assert.match(js, /title="grants:/);
});

test("manager.js updateEditorMeta shows validation errors inline", () => {
  assert.match(js, /function updateEditorMeta\(/);
  assert.match(js, /validateUserscript\(meta\)/);
  assert.match(js, /class="bad"/);
  assert.match(js, /class="ok">valid/);
});

test("manager.css defines strykelang palette variables", () => {
  for (const v of ["--cyan", "--accent", "--bg-primary", "--bg-secondary"]) {
    assert.match(css, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("manager.css styles disabled script rows differently", () => {
  assert.match(css, /\.disabled/);
});
