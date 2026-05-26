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

const popupSrc   = read("popup.js");
const bgSrc      = read("background.js");
const contentSrc = read("modal/content.js");

// `chrome.runtime.sendMessage({ kind: "..."` is the wire shape.
const sentByPopup = new Set(
  [...popupSrc.matchAll(/sendMessage\(\s*\{\s*kind:\s*"([a-z-]+)"/g)].map((m) => m[1])
);
const sentByContent = new Set(
  [...contentSrc.matchAll(/sendMessage\(\s*\{\s*kind:\s*"([a-z-]+)"/g)].map((m) => m[1])
);
const sentByClients = new Set([...sentByPopup, ...sentByContent]);

// `msg?.kind === "..."` is how background.js and content.js dispatch.
const handledByBg = new Set(
  [...bgSrc.matchAll(/msg\?\.kind === "([a-z-]+)"/g)].map((m) => m[1])
);
const handledByContent = new Set(
  [...contentSrc.matchAll(/msg\?\.kind === "([a-z-]+)"/g)].map((m) => m[1])
);

test("popup.js sends at least one message kind", () => {
  assert.ok(sentByPopup.size > 0, "popup.js sends no messages — popup is dead code");
});

test("background.js handles at least one message kind", () => {
  assert.ok(handledByBg.size > 0, "background.js has no kind dispatcher");
});

test("every client→background kind has a background handler", () => {
  for (const kind of sentByClients) {
    assert.ok(handledByBg.has(kind),
      `popup.js or modal/content.js sends "${kind}" but background.js has no handler`);
  }
});

test("every background handler is reachable from at least one client", () => {
  for (const kind of handledByBg) {
    assert.ok(sentByClients.has(kind),
      `background.js handles "${kind}" but no client (popup.js or modal/content.js) sends it`);
  }
});

test("known popup ↔ background protocol kinds are present", () => {
  const expected = ["list", "activate", "restore", "close-tab"];
  for (const k of expected) {
    assert.ok(sentByPopup.has(k), `popup.js missing required kind "${k}"`);
    assert.ok(handledByBg.has(k), `background.js missing handler for "${k}"`);
  }
});

test("modal content script ↔ background protocol kinds are present", () => {
  // The modal opens via background→content (open-modal), then fetches data
  // (list) and acts (activate / restore / close-tab) through the same wire.
  assert.ok(handledByContent.has("open-modal"),
    "modal/content.js must handle open-modal");
  assert.ok(handledByContent.has("close-modal"),
    "modal/content.js must handle close-modal");
  for (const k of ["list", "activate", "restore", "close-tab"]) {
    assert.ok(sentByContent.has(k),
      `modal/content.js must send "${k}"`);
  }
});

test("background→content kinds (open-modal/close-modal) are tabs.sendMessage targets, not runtime handlers", () => {
  // Sanity: background.js should NOT also handle open-modal/close-modal —
  // those are inbound for the content script only.
  assert.ok(!handledByBg.has("open-modal"),
    "open-modal is sent to content script, not handled in background");
  assert.ok(!handledByBg.has("close-modal"),
    "close-modal is sent to content script, not handled in background");
});
