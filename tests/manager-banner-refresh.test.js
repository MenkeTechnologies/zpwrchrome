// manager refresh() banner, stat-api, and lastSync display logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

const rfStart = js.indexOf("async function refresh()");
const rfEnd = js.indexOf("function refreshStats()");
assert.ok(rfStart >= 0 && rfEnd > rfStart, "refresh missing");
const rf = js.slice(rfStart, rfEnd);

test("refresh fetches scripts via scripts.list kind", () => {
  assert.match(rf, /send\(\{ kind: "scripts\.list" \}\)/);
  assert.match(rf, /scripts = resp\?\.scripts \|\| \[\]/);
});

test("refresh treats mode fallback or native false as fallback banner path", () => {
  assert.match(rf, /const isFallback = resp\?\.mode === "fallback" \|\| \(resp\?\.native === false\)/);
});

test("refresh hides both error and info banners before re-evaluating", () => {
  assert.match(rf, /\$info\.classList\.add\("hidden"\)/);
  assert.match(rf, /\$error\.classList\.add\("hidden"\)/);
});

test("refresh shows red error banner only when error exists and not in fallback mode", () => {
  assert.match(rf, /if \(resp\?\.error && !isFallback\)/);
  assert.match(rf, /\$error\.classList\.remove\("hidden"\)/);
  assert.match(rf, /\$errorDtl\.textContent = resp\.error/);
});

test("refresh shows yellow info banner when fallback mode is active", () => {
  assert.match(rf, /else if \(isFallback\)/);
  assert.match(rf, /\$info\.classList\.remove\("hidden"\)/);
});

test("refresh stat-api cell shows fallback label in yellow when not native", () => {
  assert.match(rf, /apiCell\.textContent = "fallback \(chrome\.scripting \+ webNavigation\)"/);
  assert.match(rf, /apiCell\.style\.color = "var\(--yellow\)"/);
});

test("refresh stat-api cell shows native label in green when userScripts available", () => {
  assert.match(rf, /apiCell\.textContent = "available \(native chrome\.userScripts\)"/);
  assert.match(rf, /apiCell\.style\.color = "var\(--green\)"/);
});

test("refresh diag-err cell shows stored error or (none)", () => {
  assert.match(rf, /diag\.textContent = resp\?\.error \|\| "\(none\)"/);
});

test("refresh stat-live shows no sync yet when lastSync absent", () => {
  assert.match(rf, /live\.textContent = "no sync yet"/);
});

test("refresh stat-live formats registered count and sync timestamp", () => {
  assert.match(rf, /sync\.registered/);
  assert.match(rf, /new Date\(sync\.at\)\.toLocaleString\(\)/);
});

test("refresh stat-live appends skipped scripts summary when present", () => {
  assert.match(rf, /sync\.skipped\?\.length/);
  assert.match(rf, /skipped\.map\(x => x\.id \+ ' \(' \+ x\.reason \+ '\)'\)/);
});

test("refresh calls render and refreshStats after updating banners", () => {
  assert.match(rf, /render\(\)/);
  assert.match(rf, /refreshStats\(\)/);
});

test("refreshStats sets stat-count to scripts.length string", () => {
  const stats = js.match(/function refreshStats\(\)[\s\S]*?\n\}/);
  assert.match(stats[0], /c\.textContent = String\(scripts\.length\)/);
});

test("refreshStats aggregates total source bytes with fmtBytes", () => {
  const stats = js.match(/function refreshStats\(\)[\s\S]*?\n\}/);
  assert.match(stats[0], /fmtBytes\(scripts\.reduce\(\(s, x\) => s \+ \(x\.src\?\.length \|\| 0\), 0\)\)/);
});
