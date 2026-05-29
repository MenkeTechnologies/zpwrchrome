// GM_SHIM_SOURCE structural tests — pin which GM_*/GM.* aliases the source
// string exports and that the wiring matches what background.js handles
// via gm:* messages. The existing gm-shim.test.js file covers behavior
// (mock-driven); this file covers the source string surface area itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { GM_SHIM_SOURCE } from "../lib/gm-shim.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bgSrc = readFileSync(join(ROOT, "background.js"), "utf8");

test("GM_SHIM_SOURCE exports every GM_* sync alias that Tampermonkey scripts expect", () => {
  for (const name of [
    "GM_setValue",
    "GM_getValue",
    "GM_deleteValue",
    "GM_listValues",
    "GM_setClipboard",
    "GM_openInTab",
    "GM_addStyle",
    "GM_addElement",
    "GM_notification",
  ]) {
    assert.match(GM_SHIM_SOURCE, new RegExp(`const ${name}\\s*=`),
      `missing GM_* alias: ${name}`);
  }
});

test("GM_SHIM_SOURCE defines GM.* methods that mirror the GM_* aliases", () => {
  for (const method of [
    "getValue",
    "setValue",
    "deleteValue",
    "listValues",
    "setClipboard",
    "openInTab",
    "addStyle",
    "addElement",
    "notification",
  ]) {
    assert.match(GM_SHIM_SOURCE, new RegExp(`${method}:`),
      `GM.${method} must be defined inside the GM object`);
  }
});

test("GM_SHIM_SOURCE binds every gm:* message kind that background.js handles", () => {
  // Pull gm:* kinds from background.js (kind === "gm:foo" guards) and verify
  // the shim sends each one via __gmSend (except gm:fire, the beacon).
  const bgKinds = [...bgSrc.matchAll(/kind === "gm:([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.ok(bgKinds.length > 0, "background.js must declare gm:* handler guards");
  for (const kind of bgKinds) {
    if (kind === "fire") continue; // fire is the beacon, not a GM-callable.
    assert.match(GM_SHIM_SOURCE, new RegExp(`__gmSend\\("${kind}"`),
      `shim must send gm:${kind} for the background.js handler to fire`);
  }
});

test("GM_SHIM_SOURCE __GM_INFO_JSON__ placeholder is present (replaced at register time)", () => {
  assert.match(GM_SHIM_SOURCE, /__GM_INFO_JSON__/);
  assert.match(bgSrc, /__GM_INFO_JSON__/, "background.js must substitute the placeholder");
});

test("GM_SHIM_SOURCE wraps __gmSend in callback form (no bare-Promise race)", () => {
  // chrome.runtime.sendMessage's callback form is the only one safe to use
  // when the SW may terminate mid-call. The shim must keep it that way.
  assert.match(GM_SHIM_SOURCE, /chrome\.runtime\.sendMessage\([^)]+,\s*\(resp\)\s*=>/);
});

test("GM_SHIM_SOURCE swallows chrome.runtime.lastError in __gmSend callback", () => {
  // If we don't void lastError, console shows a "Unchecked runtime.lastError"
  // warning on every user-script message — pin that the swallow is present.
  assert.match(GM_SHIM_SOURCE, /void chrome\.runtime\.lastError/);
});

test("GM_SHIM_SOURCE fires gm:fire beacon at load time (telemetry)", () => {
  assert.match(GM_SHIM_SOURCE, /kind:\s*"gm:fire"/);
});

test("GM_SHIM_SOURCE exposes unsafeWindow as window (Tampermonkey compatibility)", () => {
  assert.match(GM_SHIM_SOURCE, /const unsafeWindow\s*=\s*window/);
});

test("GM_SHIM_SOURCE openInTab normalizes boolean opts to { active } shape", () => {
  // Tampermonkey accepts both openInTab(url, false) and openInTab(url, {active: false}).
  // The shim must coerce both to a single { active, insert } payload shape.
  assert.match(GM_SHIM_SOURCE, /typeof opts === "boolean"/);
});

test("GM_SHIM_SOURCE addElement supports both string-tag and parent-element overloads", () => {
  // The signature is addElement(parentOrTag, tagOrAttrs, maybeAttrs). The
  // shim's branch on `typeof parentOrTag === "string"` is the discriminator.
  assert.match(GM_SHIM_SOURCE, /typeof parentOrTag === "string"/);
});

test("GM_SHIM_SOURCE addElement honors textContent attribute specially", () => {
  // textContent shouldn't go through setAttribute — pin the shim still
  // branches on it explicitly so script authors get expected DOM behavior.
  assert.match(GM_SHIM_SOURCE, /textContent/);
});

test("GM_SHIM_SOURCE getValue returns fallback when response value is undefined", () => {
  // Tampermonkey contract: missing key → user-supplied fallback. The shim
  // must short-circuit on `r.value !== undefined` not just `r.ok`.
  assert.match(GM_SHIM_SOURCE, /r\.value !== undefined/);
});

test("GM_SHIM_SOURCE addStyle appends a <style> element to head (no inline JS path)", () => {
  // CSP-safe: addStyle creates a real <style> node rather than evaluating
  // any CSS-in-JS pipeline.
  assert.match(GM_SHIM_SOURCE, /createElement\("style"\)/);
  assert.match(GM_SHIM_SOURCE, /document\.head\s*\|\|\s*document\.documentElement/);
});

test("GM_SHIM_SOURCE is exported as a non-trivial-length string from lib/gm-shim.js", () => {
  // Sanity: keep the source large enough that an accidental empty-export
  // refactor breaks the build.
  assert.ok(GM_SHIM_SOURCE.length > 1500,
    `GM_SHIM_SOURCE length ${GM_SHIM_SOURCE.length} suspiciously small`);
});
