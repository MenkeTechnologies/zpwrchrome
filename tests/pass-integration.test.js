// Static-analysis tests for the UNIX `pass` integration:
//   - manifest declares nativeMessaging + the five pass-* commands
//   - background.js opens the named native messaging port
//   - dispatch routes all five pass-* commands
//   - the autofill injector uses the native HTMLInputElement.value setter
//     (React / Vue / Lit shim) and dispatches input + change events
//   - clipboard auto-clear runs at the 45-second `pass -c` convention
//   - popup.js registers the PASS category with a "Tab" key indicator
//
// These pin contracts that would silently break the integration. They do
// NOT exercise actual native messaging (no host on CI).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const bg       = read("background.js");
const popup    = read("popup.js");

test("manifest declares nativeMessaging permission", () => {
  assert.ok(manifest.permissions.includes("nativeMessaging"),
    "permissions must include nativeMessaging");
});

test("manifest declares all five pass-* commands", () => {
  for (const name of ["pass-open-popup", "pass-fill", "pass-copy-pw", "pass-copy-user", "pass-copy-otp"]) {
    assert.ok(manifest.commands[name], `manifest missing command "${name}"`);
  }
});

test("background.js opens the named native messaging port", () => {
  assert.match(bg, /chrome\.runtime\.connectNative\(\s*NATIVE_HOST\s*\)/);
  assert.match(bg, /const NATIVE_HOST = "com\.menketechnologies\.zpwrchrome"/);
});

test("background.js routes id=0 push events to nmEventListeners", () => {
  // Hand-rolled NM port wrapper: id=0 is reserved for host-initiated push
  // events (download progress, etc.). Phase 6 download UI subscribes here.
  assert.match(bg, /msg\.id === 0/);
  assert.match(bg, /nmEventListeners/);
});

test("nmCall posts the id+kind+op+args envelope on the port", () => {
  const m = bg.match(/function nmCall\([\s\S]*?\n\}/);
  assert.ok(m, "nmCall helper missing");
  assert.match(m[0], /port\.postMessage\(\{[\s\S]*\bid\b[\s\S]*\bkind\b[\s\S]*\bop:[\s\S]*\bargs:[\s\S]*\}\)/);
});

test("dispatch routes all five pass-* commands", () => {
  for (const name of ["pass-open-popup", "pass-fill", "pass-copy-pw", "pass-copy-user", "pass-copy-otp"]) {
    assert.match(bg, new RegExp(`command === "${name}"`),
      `dispatch missing handler for "${name}"`);
  }
});

test("openPassInPopup stashes pendingCategory=pass before opening popup", () => {
  const fn = bg.match(/async function openPassInPopup\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /pendingCategory:\s*"pass"/);
  assert.match(fn[0], /chrome\.action\.openPopup/);
});

test("fillLoginForm uses native HTMLInputElement.value setter (React/Vue shim)", () => {
  const fn = bg.match(/function fillLoginForm\([\s\S]*?\n\}/);
  assert.ok(fn, "fillLoginForm injector missing");
  assert.match(fn[0], /Object\.getPrototypeOf\(el\)/);
  assert.match(fn[0], /Object\.getOwnPropertyDescriptor\(proto, "value"\)/);
  assert.match(fn[0], /desc\.set\.call\(el, val\)/);
});

test("fillLoginForm dispatches input AND change events for framework listeners", () => {
  const fn = bg.match(/function fillLoginForm\([\s\S]*?\n\}/);
  assert.match(fn[0], /new Event\("input",\s*\{ bubbles: true \}\)/);
  assert.match(fn[0], /new Event\("change",\s*\{ bubbles: true \}\)/);
});

test("fillLoginForm prefers username field preceding password in document order", () => {
  const fn = bg.match(/function fillLoginForm\([\s\S]*?\n\}/);
  assert.match(fn[0], /compareDocumentPosition\(c\) & Node\.DOCUMENT_POSITION_PRECEDING/);
});

test("fillLoginForm filters out hidden / checkbox / radio / file / image inputs from username search", () => {
  const fn = bg.match(/function fillLoginForm\([\s\S]*?\n\}/);
  for (const t of ["password", "hidden", "submit", "reset", "button", "checkbox", "radio", "file", "image"]) {
    assert.match(fn[0], new RegExp(`:not\\(\\[type="${t}"\\]\\)`),
      `username selector must exclude type="${t}"`);
  }
});

test("clipboard auto-clear runs at the 45-second pass -c convention", () => {
  assert.match(bg, /const PASS_CLIPBOARD_CLEAR_MS = 45_000/);
  const fn = bg.match(/async function passClipboardCopy\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /setTimeout\(/);
  assert.match(fn[0], /PASS_CLIPBOARD_CLEAR_MS/);
  assert.match(fn[0], /writeClipboard\(""\)/);
});

test("pass copy paths use passClipboardCopy (not the raw writeClipboard)", () => {
  const fn = bg.match(/async function passCopyForActive\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /passClipboardCopy\(/);
  assert.doesNotMatch(fn[0], /[^_]writeClipboard\(/);  // bare writeClipboard would skip the clear
});

test("popup CATEGORIES declares the PASS entry with Tab key indicator", () => {
  assert.match(popup, /id: "pass",\s+label: "Pass",\s+key: "Tab"/);
});

test("popup loadPass reads active tab host before NM call", () => {
  const fn = popup.match(/function loadPass\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /chrome\.tabs\.query\(\{\s*active:\s*true,\s*currentWindow:\s*true\s*\}/);
  assert.match(fn[0], /kind:\s*"pass\.match"/);
});

test("popup state.pass model carries matches + host + loaded + err + searchResults", () => {
  // matches/searchResults are arrays of {store, path} after multi-store. The
  // PASS slash-prefix triggers searchResults; bare filter narrows matches.
  assert.match(popup, /pass:\s*\{[\s\S]*matches:[\s\S]*host:[\s\S]*loaded:[\s\S]*err:[\s\S]*searchResults:[\s\S]*searchQuery:/);
});

test("popup pass row renders fill + user + pw + otp buttons", () => {
  for (const cls of ["pass-fill-btn", "pass-copy-user", "pass-copy-pw", "pass-copy-otp"]) {
    assert.match(popup, new RegExp(`class="badge ${cls}"`), `pass row missing button class .${cls}`);
  }
});

test("popup pass-fill click sends pass.fill kind and closes popup on success", () => {
  const block = popup.match(/pass-fill-btn"\)\.forEach[\s\S]*?\n  \}\);/);
  assert.ok(block);
  assert.match(block[0], /kind:\s*"pass\.fill"/);
  assert.match(block[0], /window\.close\(\)/);
});

test("popup pass copy buttons use callback form (not bare await) on sendMessage", () => {
  // The quality.test.js pinned callback-or-.catch() invariant — keep it.
  // Anything that breaks this gets caught by the quality test too, but
  // pin it here so the failure points at pass code, not the umbrella test.
  const calls = [
    /chrome\.runtime\.sendMessage\(\{ kind: "pass\.match"[^)]+\}, \(r\) =>/,
    /chrome\.runtime\.sendMessage\(\{ kind: "pass\.fetch"[^)]+\}, \(r\) =>/,
    /chrome\.runtime\.sendMessage\(\{ kind: "pass\.otp"[^)]+\}, \(r\) =>/,
    /chrome\.runtime\.sendMessage\(\{ kind: "pass\.fill"[^)]+\}, \(r\) =>/,
  ];
  for (const re of calls) {
    assert.match(popup, re, `pass sendMessage call must use 2-arg callback form: ${re}`);
  }
});

test("background pass.* message handlers all delegate through nmCall", () => {
  for (const kind of ["pass.match", "pass.list", "pass.search", "pass.fetch", "pass.otp"]) {
    const re = new RegExp(`msg\\?\\.kind === "${kind.replace(".", "\\.")}"[\\s\\S]*?nmCall\\("pass"`);
    assert.match(bg, re, `background handler for "${kind}" must call nmCall("pass", ...)`);
  }
});

// ── Browserpass-compat features ────────────────────────────────────────────

test("pass-open-url command + handler navigate active tab to entry's url field", () => {
  assert.ok(manifest.commands["pass-open-url"], "pass-open-url command missing");
  assert.match(bg, /command === "pass-open-url"\)\s+return passOpenUrlForActive/);
  const fn = bg.match(/async function passOpenUrlForActive\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /chrome\.tabs\.update\(t\.id, \{ url \}\)/);
});

test("popup pass row renders go button + shift-click opens in new tab", () => {
  assert.match(popup, /class="badge pass-go-btn"/);
  const handler = popup.match(/pass-go-btn"\)\.forEach[\s\S]*?\n  \}\);/);
  assert.ok(handler);
  assert.match(handler[0], /e\.shiftKey \|\| e\.metaKey \|\| e\.ctrlKey/);
  assert.match(handler[0], /kind: "pass\.openUrl"/);
  assert.match(handler[0], /newTab/);
});

test("popup PASS slash-prefix triggers whole-store search via pass.search", () => {
  // browserpass convention: `/foo` searches the entire store, ignoring host.
  assert.match(popup, /state\.filter\.startsWith\("\/"\)/);
  assert.match(popup, /loadPassSearch/);
  const fn = popup.match(/function loadPassSearch\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /kind: "pass\.search"/);
});

test("auto-submit settings flag passed through to fillLoginForm injector", () => {
  // Argument count: fillLoginForm(username, password, autoSubmit). Settings
  // come from chrome.storage.local["pass.settings"].
  assert.match(bg, /const PASS_SETTINGS_KEY = "pass\.settings"/);
  assert.match(bg, /autoSubmit: false/);
  const fill = bg.match(/function fillLoginForm\(username, password, autoSubmit\)[\s\S]*?\n\}/);
  assert.ok(fill, "fillLoginForm must accept autoSubmit param");
  assert.match(fill[0], /if \(autoSubmit\)/);
  assert.match(fill[0], /button\[type="submit"\]/);
});

test("settings read/write exposed via pass.settings.get / pass.settings.set", () => {
  assert.match(bg, /msg\?\.kind === "pass\.settings\.get"/);
  assert.match(bg, /msg\?\.kind === "pass\.settings\.set"/);
});

test("multi-store: fetch/otp forward store name as nmCall arg literal", () => {
  // Direct nmCall paths — must build {path, store} object explicitly.
  for (const kind of ["pass.fetch", "pass.otp"]) {
    const re = new RegExp(`msg\\?\\.kind === "${kind.replace(".", "\\.")}"[\\s\\S]{0,400}store:\\s*msg\\.store`);
    assert.match(bg, re, `${kind} handler must forward args.store to nmCall`);
  }
});

test("multi-store: fill/openUrl forward store via positional helper arg", () => {
  // These routes go through helper functions that then build the nmCall
  // object. Verify the helper signatures accept store + the inner nmCall
  // forwards it.
  const fillFromPath = bg.match(/async function passFillFromPath\(path, store\)[\s\S]*?\n\}/);
  assert.ok(fillFromPath);
  assert.match(fillFromPath[0], /nmCall\("pass", "fetch", \{ path, store \}\)/);

  const openUrlFromPath = bg.match(/async function passOpenUrlFromPath\(path, newTab, store\)[\s\S]*?\n\}/);
  assert.ok(openUrlFromPath);
  assert.match(openUrlFromPath[0], /nmCall\("pass", "fetch", \{ path, store \}\)/);
});

test("popup pass row carries store badge + data-store attribute", () => {
  assert.match(popup, /pass-store-badge/);
  assert.match(popup, /data-store=/);
});

test("HTTP basic auth listener registered when permission present", () => {
  const block = bg.match(/chrome\.webRequest\.onAuthRequired\.addListener\([\s\S]*?\["asyncBlocking"\]\s*\);/);
  assert.ok(block, "basic auth listener missing");
  assert.match(block[0], /details\.isProxy/);                  // skip proxy auth
  assert.match(block[0], /basicAuthEnabled/);                  // honors settings flag
  assert.match(block[0], /matches\.length !== 1/);             // single-match guard
  assert.match(block[0], /authCredentials: \{ username, password \}/);
});

test("manifest declares webRequest + webRequestAuthProvider perms", () => {
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.ok(manifest.permissions.includes("webRequestAuthProvider"));
});
