// Static-analysis contracts for the "Save to zcite" wiring in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

test("background imports the zcite extractor from lib", () => {
  assert.match(bg, /import\s+\{\s*extractCslFromPage\s*\}\s+from\s+"\.\/lib\/zcite-extract\.js"/);
});

test("registers the Save-to-zcite page context menu", () => {
  assert.match(bg, /CTX_PG_ZCITE\s*=\s*"zpwrchrome-pg-zcite"/);
  assert.match(bg, /id:\s*CTX_PG_ZCITE,\s*title:\s*"Save page to zcite/);
});

test("onClicked dispatches CTX_PG_ZCITE to savePageToZcite", () => {
  assert.match(bg, /info\.menuItemId === CTX_PG_ZCITE/);
  assert.match(bg, /await savePageToZcite\(tab\)/);
});

test("savePageToZcite injects the extractor and sends zcite.save to the host", () => {
  assert.match(bg, /func:\s*extractCslFromPage/);
  assert.match(bg, /bpSend\(\{\s*action:\s*"zcite\.save",\s*item:\s*csl\s*\}\)/);
});
