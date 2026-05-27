// Run Log live updates and clear flow in manager.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

test("refreshLog requests scripts.firelog kind from background", () => {
  const fn = js.match(/async function refreshLog\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /send\(\{ kind: "scripts\.firelog" \}\)/);
});

test("refreshLog stores log array from response defaulting to empty", () => {
  const fn = js.match(/async function refreshLog\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /logEntries = resp\?\.log \|\| \[\]/);
});

test("refreshLog calls updateLogCount after renderLog", () => {
  const fn = js.match(/async function refreshLog\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /renderLog\(\)/);
  assert.match(fn[0], /updateLogCount\(\)/);
});

test("updateLogCount sets tab label to Run Log with count when entries exist", () => {
  const fn = js.match(/function updateLogCount\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /Run Log \(\$\{logEntries\.length\}\)/);
});

test("updateLogCount uses plain Run Log label when no entries", () => {
  const fn = js.match(/function updateLogCount\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /: "Run Log"/);
});

test("storage onChanged listener ignores non-local areas", () => {
  assert.match(js, /if \(area !== "local"\) return/);
});

test("storage onChanged refreshes log when userScripts.fireLog changes", () => {
  assert.match(js, /if \(changes\["userScripts\.fireLog"\]\)/);
  assert.match(js, /refreshLog\(\)/);
});

test("manager pulls fire log once on page load before user opens tab", () => {
  assert.match(js, /\/\/ Pull once on load[\s\S]*?refreshLog\(\)/);
});

test("log clear button confirms before wiping log", () => {
  assert.match(js, /if \(!confirm\("clear the run log\?"\)\) return/);
});

test("log clear sends scripts.firelog.clear kind", () => {
  assert.match(js, /send\(\{ kind: "scripts\.firelog\.clear" \}\)/);
});

test("log clear refreshes log after background acknowledges", () => {
  assert.match(js, /firelog\.clear[\s\S]*?refreshLog\(\)/);
});

test("log filter input wires renderLog on input event", () => {
  assert.match(js, /\$logFilter\.addEventListener\("input", renderLog\)/);
});

test("log refresh button calls refreshLog on click", () => {
  assert.match(js, /\$logRefresh\.addEventListener\("click", refreshLog\)/);
});
