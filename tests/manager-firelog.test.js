// Run Log tab — firelog fetch, filter, render, and clear in manager.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

const renderLog = js.match(/function renderLog\(\)[\s\S]*?\n\}/);
assert.ok(renderLog, "renderLog missing");

test("refreshLog fetches log via scripts.firelog message kind", () => {
  assert.match(js, /send\(\{ kind: "scripts\.firelog" \}\)/);
});

test("refreshLog stores entries in logEntries then calls renderLog", () => {
  assert.match(js, /logEntries = resp\?\.log \|\| \[\]/);
  assert.match(js, /renderLog\(\)/);
  assert.match(js, /updateLogCount\(\)/);
});

test("renderLog fzf-filters by script name id and url", () => {
  assert.match(renderLog[0], /fzfMatch\(f, e\.name \|\| ""\)/);
  assert.match(renderLog[0], /fzfMatch\(f, e\.script \|\| ""\)/);
  assert.match(renderLog[0], /fzfMatch\(f, e\.url \|\| ""\)/);
});

test("renderLog empty-with-filter message says no matches", () => {
  assert.match(renderLog[0], /logEntries\.length[\s\S]*?"no matches"/);
});

test("renderLog empty-without-entries shows developer mode hint", () => {
  assert.match(renderLog[0], /Developer mode/);
});

test("renderLog table row includes ordinal index column", () => {
  assert.match(renderLog[0], /class="num">\$\{i \+ 1\}/);
});

test("renderLog table row includes tabId and frame columns", () => {
  assert.match(renderLog[0], /\$\{e\.tabId \?\? "—"\}/);
  assert.match(renderLog[0], /\$\{e\.frame \?\? 0\}/);
});

test("renderLog HTML-safe-renders script name and url cells via fzfHl", () => {
  assert.match(renderLog[0], /fzfHl\(e\.name \|\| "\(unnamed\)", f\)/);
  assert.match(renderLog[0], /fzfHl\(url, f\)/);
  // href stays plain escapeHtml — never wrapped in <mark>
  assert.match(renderLog[0], /href="\$\{escapeHtml\(e\.url \|\| ""\)\}"/);
});

test("renderLog url cell links open in new tab with noopener", () => {
  assert.match(renderLog[0], /target="_blank" rel="noopener"/);
});

test("renderLog timestamp shows locale date and time with milliseconds", () => {
  assert.match(renderLog[0], /toLocaleTimeString\(\)/);
  assert.match(renderLog[0], /getMilliseconds\(\)\)\.padStart\(3, "0"\)/);
});

test("log filter input re-renders on input event", () => {
  assert.match(js, /\$logFilter\.addEventListener\("input", renderLog\)/);
});

test("log refresh button calls refreshLog", () => {
  assert.match(js, /\$logRefresh\.addEventListener\("click", refreshLog\)/);
});

test("log clear confirms before scripts.firelog.clear", () => {
  assert.match(js, /confirm\("clear the run log\?"\)/);
  assert.match(js, /send\(\{ kind: "scripts\.firelog\.clear" \}\)/);
});

test("storage.onChanged listener ignores non-local area changes", () => {
  assert.match(js, /if \(area !== "local"\) return/);
});

test("storage.onChanged listener watches userScripts.fireLog key", () => {
  assert.match(js, /changes\["userScripts\.fireLog"\]/);
});

test("refreshLog called once at module load for initial badge count", () => {
  assert.match(js, /^refreshLog\(\);$/m);
});

test("updateLogCount resets tab label when log is empty", () => {
  assert.match(js, /logEntries\.length > 0 \? `Run Log \(\$\{logEntries\.length\}\)` : "Run Log"/);
});
