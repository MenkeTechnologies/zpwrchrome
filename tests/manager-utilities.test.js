// Manager utilities pane — import/export/resync/wipe invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");
const html = readFileSync(join(ROOT, "scripts-manager/manager.html"), "utf8");

test("manager import-file button triggers hidden file input click", () => {
  assert.match(js, /getElementById\("util-import-file"\)/);
  assert.match(js, /\$fileInput\.click\(\)/);
});

test("manager import-url fetches remote script text via fetch", () => {
  assert.match(js, /getElementById\("util-import-url-btn"\)/);
  assert.match(js, /const r = await fetch\(url\)/);
  assert.match(js, /await r\.text\(\)/);
});

test("manager import-url opens editor with fetched source on success", () => {
  assert.match(js, /openEditor\(\{ src \}\)/);
});

test("manager import-url alerts on HTTP failure", () => {
  assert.match(js, /if \(!r\.ok\) throw new Error\("HTTP " \+ r\.status\)/);
  assert.match(js, /alert\("fetch failed: " \+ e\.message\)/);
});

test("manager export-all serializes scripts array as pretty JSON", () => {
  assert.match(js, /JSON\.stringify\(scripts, null, 2\)/);
  assert.match(js, /type: "application\/json"/);
  assert.match(js, /download\(blob, "zpwrchrome-userscripts\.json"\)/);
});

test("manager export-bundle joins script sources with separator comment", () => {
  assert.match(js, /scripts\.map\(\(s\) => s\.src\)\.join/);
  assert.match(js, /\/\/ ===============================/);
  assert.match(js, /download\(blob, "zpwrchrome-userscripts\.user\.js"\)/);
});

test("manager download helper revokes object URL after click", () => {
  assert.match(js, /URL\.createObjectURL\(blob\)/);
  assert.match(js, /URL\.revokeObjectURL\(url\)/);
});

test("manager util-resync sends scripts.resync and surfaces skipped scripts", () => {
  assert.match(js, /send\(\{ kind: "scripts\.resync" \}\)/);
  assert.match(js, /r\?\.skipped\?\.length/);
});

test("manager util-resync alerts registration count on success", () => {
  assert.match(js, /alert\("registered " \+ \(r\?\.registered \?\? 0\)/);
});

test("manager wipe-all confirms destructive action before deleting", () => {
  assert.match(js, /confirm\("erase ALL userscripts/);
});

test("manager wipe-all deletes every script via scripts.delete loop", () => {
  assert.match(js, /for \(const s of scripts\) await send\(\{ kind: "scripts\.delete", id: s\.id \}\)/);
});

test("manager open-chrome-ext buttons open chrome://extensions with extension id", () => {
  assert.match(js, /for \(const id of \["open-chrome-ext", "open-chrome-ext-err"\]/);
  assert.match(js, /chrome:\/\/extensions\/\?id=" \+ chrome\.runtime\.id/);
});

test("manager.html utilities pane has import URL text field", () => {
  assert.match(html, /id="util-import-url"/);
});

test("manager.html utilities pane has export-all and export-bundle buttons", () => {
  assert.match(html, /id="util-export-all"/);
  assert.match(html, /id="util-export-bundle"/);
});

test("manager.html utilities pane has util-resync button", () => {
  assert.match(html, /id="util-resync"/);
});

test("manager.html hidden file input accepts .user.js and .js files", () => {
  assert.match(html, /id="file-input"/);
  assert.match(html, /accept="\.user\.js,\.js"/);
});

test("manager calls refresh() at module load to populate dashboard", () => {
  assert.match(js, /^refresh\(\);$/m);
});
