// Background message handlers must return true for async sendResponse paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function sliceHandler(kind, len = 800) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `handler for "${kind}" not found`);
  return bg.slice(idx, idx + len);
}

const ASYNC_KINDS = [
  "list",
  "activate",
  "restore",
  "close-tab",
  "open-scripts-manager",
  "scripts.resync",
  "scripts.delete",
  "scripts.toggle",
  "gm:getValue",
  "gm:setValue",
  "gm:deleteValue",
  "gm:listValues",
  "gm:setClipboard",
  "gm:openInTab",
  "gm:fire",
  "gm:notification",
  "scripts.firelog",
  "scripts.firelog.clear",
  "scenes-list",
  "scenes-save",
  "scenes-restore",
  "scenes-delete",
  "history-list",
  "history-delete",
];

for (const kind of ASYNC_KINDS) {
  test(`${kind} handler returns true for async sendResponse`, () => {
    const len = kind.startsWith("scripts.") && kind !== "scripts.firelog" && kind !== "scripts.firelog.clear"
      ? 3500
      : 800;
    const sec = sliceHandler(kind, len);
    assert.match(sec, /return true/, `${kind} must return true`);
  });
}

test("onMessage listener is registered on chrome.runtime", () => {
  assert.match(bg, /chrome\.runtime\.onMessage\.addListener/);
});

test("scripts.save handler returns true inside long async IIFE", () => {
  const sec = sliceHandler("scripts.save", 4000);
  assert.match(sec, /return true/);
});
