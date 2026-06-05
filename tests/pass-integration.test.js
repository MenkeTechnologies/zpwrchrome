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

// ─── URL normalization (schemeless entries) ────────────────────────
// Caught in the wild: pass entry at 10.59.0.17/admin had url="10.59.0.17"
// (from fallbackUrlFromPath); chrome.tabs.update({url}) interpreted the
// schemeless string as RELATIVE to the popup's chrome-extension:// origin
// and opened chrome-extension://<id>/10.59.0.17 instead of http://10.59.0.17.

test("background.js has normalizeOpenUrl helper that defends against schemeless entries", () => {
  assert.match(bg, /function normalizeOpenUrl\b/, "normalizeOpenUrl must exist");
  // Both go-button paths (popup + active-tab command) must route through it
  // before chrome.tabs.update / chrome.tabs.create — never pass entry.url raw.
  assert.match(bg, /normalizeOpenUrl\(entry\.url\)/,
    "passOpenUrlForActive + passOpenUrlFromPath must call normalizeOpenUrl");
  // IPv4 / host:port / localhost defaults: http://. Anything else: https://.
  assert.match(bg, /isIPv4\s*=\s*\/\^\\d/, "IPv4 detection present");
  assert.match(bg, /isLocal\s*=\s*\/\^\(localhost/, "localhost detection present");
  assert.match(bg, /isHostPort\s*=/,                "host:port detection present");
  assert.match(bg, /`http:\/\/\$\{s\}`/,            "local-ish hosts default to http://");
  assert.match(bg, /`https:\/\/\$\{s\}`/,           "everything else defaults to https://");
});

test("OTP is computed client-side from otpauth:// URL via Web Crypto, with `pass otp` only as last-resort", () => {
  // Background: Chrome doesn't pass shell PATH to the NM host, so
  // `Command::new("pass")` in the Rust host can't find pass and returns
  // "Unable to spawn `pass otp`". We compute TOTP/HOTP from the entry's
  // otpauth:// URL in the SW via Web Crypto instead. Pinned here so any
  // future refactor doesn't accidentally route OTP back through bpOtpCode.
  assert.match(bg, /async function passOtpCodeForPath\b/,
    "passOtpCodeForPath helper must exist");
  assert.match(bg, /import\s+\{\s*computeOtpFromUrl\s*\}\s+from\s+["']\.\/lib\/totp\.js["']/,
    "background.js must import computeOtpFromUrl");
  assert.match(bg, /passOtpCodeForPath[\s\S]+?await computeOtpFromUrl\(url\)/,
    "passOtpCodeForPath must compute via computeOtpFromUrl(entry.otpUrl)");
  assert.match(bg, /passOtpCodeForPath[\s\S]+?return bpOtpCode\(path\)/,
    "passOtpCodeForPath must fall back to bpOtpCode when no otpauth URL");
  // Every caller now goes through passOtpCodeForPath, never bpOtpCode directly.
  for (const site of ["passCopyForActive", "passCopyFieldForPath", 'msg\\?\\.kind === "pass\\.otp"']) {
    const re = new RegExp(`${site}[\\s\\S]{0,800}?passOtpCodeForPath`);
    assert.match(bg, re, `${site} must call passOtpCodeForPath`);
  }
});

test("fillLoginForm autoSubmit CLICKS a button — never form.submit() (SPA-safe)", () => {
  // Caught at 10.59.0.17:5000/#/signin: step 1 (username only) got filled,
  // then form.submit() did a GET navigation that serialized every input
  // to the URL query string and reloaded the page instead of letting the
  // SPA router advance to step 2. The autoSubmit branch must look for a
  // button to click (in-form, ancestor-walk, text-match) and just give up
  // silently if none exists. Pressing Enter remains the user's escape
  // hatch.
  assert.doesNotMatch(bg, /try\s*{\s*form\.submit\(\)/,
    "form.submit() fallback must not be present anymore");
  assert.match(bg, /No form\.submit\(\) fallback by design/,
    "the no-form-submit-by-design comment must be present to flag any re-add");
  assert.match(bg, /findInForm/,  "submit button finder #1 (in-form)");
  assert.match(bg, /findNearby/,  "submit button finder #2 (ancestor walk)");
  assert.match(bg, /findByText/,  "submit button finder #3 (text-match fallback)");
  // The text matcher must accept the multi-step-login button vocabulary.
  assert.match(bg, /sign\[-\s\]\?in\|log\[-\s\]\?in\|continue\|next\|submit\|enter/,
    "submit-button text-match regex must cover sign-in/login/continue/next/submit/enter");
});

test("popup user/pw/otp buttons route through SW (gesture-window fix)", () => {
  // Doing navigator.clipboard.writeText() in the popup after a SW + NM +
  // GPG round-trip drops the user gesture and Chrome silently no-ops.
  // The buttons must now ask the SW to do both fetch + copy in one
  // message, and the SW must inject the clipboard write into the active
  // tab via writeClipboard().
  assert.match(popup, /kind:\s*"pass\.copyField"/,
    "popup copy buttons must send pass.copyField to the SW");
  assert.doesNotMatch(popup,
    /pass-copy-pw[\s\S]{0,400}copyToClipboard\(data\?\.password/,
    "popup must NOT call copyToClipboard(data.password) directly anymore");
  assert.doesNotMatch(popup,
    /pass-copy-user[\s\S]{0,400}copyToClipboard\(data\?\.username/,
    "popup must NOT call copyToClipboard(data.username) directly anymore");
  assert.match(bg, /msg\?\.kind === "pass\.copyField"/,
    "SW must wire the pass.copyField bridge handler");
  assert.match(bg, /async function passCopyFieldForPath\b/,
    "passCopyFieldForPath helper must exist");
  // Must reuse passClipboardCopy → writeClipboard pipeline that injects
  // the writeText() into the active tab (kept the gesture context).
  assert.match(bg, /passCopyFieldForPath[\s\S]+?await passClipboardCopy\(text\)/,
    "passCopyFieldForPath must route through passClipboardCopy");
});

test("manifest declares all five pass-* commands", () => {
  for (const name of ["pass-open-popup", "pass-fill", "pass-copy-pw", "pass-copy-user", "pass-copy-otp"]) {
    assert.ok(manifest.commands[name], `manifest missing command "${name}"`);
  }
});

test("background.js talks to the BP host via sendNativeMessage (one-shot)", () => {
  assert.match(bg, /chrome\.runtime\.sendNativeMessage\(NATIVE_HOST/);
  assert.match(bg, /const NATIVE_HOST = "com\.menketechnologies\.zpwrchrome"/);
});

test("bpSend wraps sendNativeMessage in a Promise + BP error handling", () => {
  const fn = bg.match(/function bpSend\([\s\S]*?\n\}/);
  assert.ok(fn, "bpSend helper missing");
  assert.match(fn[0], /chrome\.runtime\.sendNativeMessage\(NATIVE_HOST/);
  assert.match(fn[0], /resp\.status === "error"/);
  assert.match(fn[0], /resolve\(resp\)/);
});

test("bpListEntries strips .gpg suffix from BP list response", () => {
  const fn = bg.match(/async function bpListEntries\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /action: "list"/);
  assert.match(fn[0], /\.replace\(\/\\\.gpg\$\/, ""\)/);
});

test("bpMatchByHost defers to lib/bp-pass.js client-side matcher", () => {
  // The browserpass protocol does matching client-side; the helper just
  // wraps lib/bp-pass.js matchIn + tags with {store:"default"}.
  const fn = bg.match(/async function bpMatchByHost\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /matchIn\(entries, host\)/);
  assert.match(fn[0], /store: "default"/);
});

test("bpFetchParsed runs BP fetch + parseEntry + filename-username fallback", () => {
  const fn = bg.match(/async function bpFetchParsed\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /action: "fetch"/);
  assert.match(fn[0], /fallbackUsernameFromPath\(parseEntry\(raw\), path\)/);
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

test("popup CATEGORIES declares the PASS entry with the Cmd+P key indicator", () => {
  assert.match(popup, /id: "pass",\s+label: "Pass",\s+key: "⌘P"/);
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

test("background pass.* message handlers all delegate through BP helpers", () => {
  // pass.match → bpMatchByHost, pass.list → bpListEntries, pass.search →
  // bpSend({action:"search"}), pass.fetch → bpFetchParsed.
  // pass.otp goes through passOtpCodeForPath which computes TOTP client-side
  // from the entry's otpauth:// URL (Web Crypto), only falling back to the
  // host's `pass otp` shell-out when the entry has no otpauth URL —
  // see notes in lib/totp.js + tests/totp.test.js.
  const cases = {
    "pass.match":  /bpMatchByHost/,
    "pass.list":   /bpListEntries/,
    "pass.search": /action: "search"/,
    "pass.fetch":  /bpFetchParsed/,
    "pass.otp":    /passOtpCodeForPath/,
  };
  for (const [kind, expected] of Object.entries(cases)) {
    const re = new RegExp(
      `msg\\?\\.kind === "${kind.replace(".", "\\.")}"[\\s\\S]{0,400}${expected.source}`
    );
    assert.match(bg, re, `background handler for "${kind}" must use ${expected}`);
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

test("single-store BP path uses default store id throughout", () => {
  // The BP rewrite collapses multi-store back to one (default at ~/.password-store).
  // The host's normalize_password_store_path expands `~/` at request time, so
  // the extension hardcodes the alias rather than reading env.
  assert.match(bg, /const PASS_STORE = \{ id: "default", name: "Default", path: "~\/\.password-store" \}/);
  const fn = bg.match(/function bpStores\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /default: PASS_STORE/);
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
