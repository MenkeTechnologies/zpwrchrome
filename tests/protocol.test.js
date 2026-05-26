// Popup ↔ background.js message protocol coverage.
// Every kind sent by popup.js must be handled in background.js, and every
// background.js handler must be reachable from popup.js. Orphans on either
// side mean either a feature is dead code or the popup is calling a handler
// that no longer exists — both regressions we want to catch in CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const popupSrc = read("popup.js");
const bgSrc    = read("background.js");

// `chrome.runtime.sendMessage({ kind: "..."` is the wire shape.
const sentByPopup = new Set(
  [...popupSrc.matchAll(/sendMessage\(\s*\{\s*kind:\s*"([a-z-]+)"/g)].map((m) => m[1])
);

// `msg?.kind === "..."` is how background.js dispatches.
const handledByBg = new Set(
  [...bgSrc.matchAll(/msg\?\.kind === "([a-z-]+)"/g)].map((m) => m[1])
);

test("popup.js sends at least one message kind", () => {
  assert.ok(sentByPopup.size > 0, "popup.js sends no messages — popup is dead code");
});

test("background.js handles at least one message kind", () => {
  assert.ok(handledByBg.size > 0, "background.js has no kind dispatcher");
});

test("every popup→background kind has a background handler", () => {
  for (const kind of sentByPopup) {
    assert.ok(handledByBg.has(kind),
      `popup.js sends "${kind}" but background.js has no \`msg?.kind === "${kind}"\` branch`);
  }
});

test("every background handler is reachable from popup.js", () => {
  for (const kind of handledByBg) {
    assert.ok(sentByPopup.has(kind),
      `background.js handles "${kind}" but popup.js never sends it — dead code`);
  }
});

test("known protocol kinds are present", () => {
  // Pin the protocol so a silent rename can't slip past.
  const expected = ["list", "activate", "restore", "close-tab"];
  for (const k of expected) {
    assert.ok(sentByPopup.has(k), `popup.js missing required kind "${k}"`);
    assert.ok(handledByBg.has(k), `background.js missing handler for "${k}"`);
  }
});
