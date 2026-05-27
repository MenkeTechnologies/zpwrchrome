// scripts-manager import/export/resync/wipe utilities in manager.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

const utilStart = js.indexOf("// ------------------- Utilities -------------------");
assert.ok(utilStart >= 0, "utilities section missing");
const util = js.slice(utilStart);

test("util-import-file triggers hidden file input click", () => {
  assert.match(util, /getElementById\("util-import-file"\)\.addEventListener\("click", \(\) => \$fileInput\.click\(\)\)/);
});

test("util file input reads first selected file as text then opens editor", () => {
  assert.match(util, /\$fileInput\.addEventListener\("change"/);
  assert.match(util, /const src = await file\.text\(\)/);
  assert.match(util, /openEditor\(\{ src \}\)/);
});

test("util file input clears value after import so same file can be re-selected", () => {
  assert.match(util, /\$fileInput\.value = ""/);
});

test("util-import-url fetches trimmed URL and opens editor on success", () => {
  assert.match(util, /getElementById\("util-import-url"\)\.value\.trim\(\)/);
  assert.match(util, /const r = await fetch\(url\)/);
  assert.match(util, /if \(!r\.ok\) throw new Error\("HTTP " \+ r\.status\)/);
  assert.match(util, /openEditor\(\{ src \}\)/);
});

test("util-import-url alerts fetch failure message to user", () => {
  assert.match(util, /alert\("fetch failed: " \+ e\.message\)/);
});

test("util-export-all serializes scripts array as pretty JSON blob", () => {
  assert.match(util, /JSON\.stringify\(scripts, null, 2\)/);
  assert.match(util, /download\(blob, "zpwrchrome-userscripts\.json"\)/);
});

test("util-export-bundle joins script sources with separator banner", () => {
  assert.match(util, /scripts\.map\(\(s\) => s\.src\)\.join/);
  assert.match(util, /\/\/ ===============================/);
  assert.match(util, /download\(blob, "zpwrchrome-userscripts\.user\.js"\)/);
});

test("util-resync sends scripts.resync kind to background", () => {
  assert.match(util, /send\(\{ kind: "scripts\.resync" \}\)/);
});

test("util-resync alerts error when background returns error string", () => {
  assert.match(util, /if \(r\?\.error\) \{[\s\S]*?alert\("re-register failed:\\n" \+ r\.error\)/);
});

test("util-resync success alert includes registered count and skipped summary", () => {
  assert.match(util, /alert\("registered " \+ \(r\?\.registered \?\? 0\)/);
  assert.match(util, /r\?\.skipped\?\.length/);
});

test("util-resync calls refresh after alert", () => {
  assert.match(util, /scripts\.resync[\s\S]*?refresh\(\)/);
});

test("wipe-all confirms destructive action before deleting every script", () => {
  assert.match(util, /confirm\("erase ALL userscripts and their GM storage\? this cannot be undone\."\)/);
});

test("wipe-all loops scripts sending scripts.delete for each id", () => {
  assert.match(util, /for \(const s of scripts\) await send\(\{ kind: "scripts\.delete", id: s\.id \}\)/);
});

test("download helper revokes object URL after synthetic anchor click", () => {
  const dl = js.match(/function download\(blob, name\)[\s\S]*?\n\}/);
  assert.match(dl[0], /URL\.createObjectURL\(blob\)/);
  assert.match(dl[0], /a\.click\(\)/);
  assert.match(dl[0], /URL\.revokeObjectURL\(url\)/);
});
