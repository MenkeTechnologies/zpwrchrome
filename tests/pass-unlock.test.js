// Static-analysis tests for browser-side GPG unlock (`pass.unlock`).
//
// The contract these pin, and why each one matters:
//   - the passphrase reaches the host and nothing else: no chrome.storage
//     write, no diag-ring entry, no host-console template that would land it
//     in an exportable transcript
//   - a locked store is distinguishable from any other host failure, and both
//     the popup and the pass manager act on that signal instead of dead-ending
//     on an error string
//   - the passphrase field owns its keystrokes in the popup, whose global
//     keydown handler otherwise closes a tab on Backspace
//
// These do NOT exercise native messaging (no host on CI) — the end-to-end
// behavior is covered by zpwrchrome-host/tests/extensions_gpg_unlock.rs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const bg       = read("background.js");
const popup    = read("popup.js");
const mgrJs    = read("scripts-manager/pass.js");
const mgrHtml  = read("scripts-manager/pass.html");
const hostJs   = read("scripts-manager/host.js");

test("background.js sends the passphrase to the host under the pass.unlock action", () => {
  assert.match(bg, /async function bpPassUnlock\b/, "bpPassUnlock helper must exist");
  assert.match(bg, /action:\s*"pass\.unlock"/, "must use the pass.unlock wire action");
  assert.match(bg, /passphrase:\s*String\(passphrase/, "passphrase must ride the request");
  assert.match(bg, /async function bpPassLock\b/, "bpPassLock helper must exist");
  assert.match(bg, /action:\s*"pass\.lock"/, "must use the pass.lock wire action");
});

test("background.js routes pass.unlock / pass.lock messages from the UI surfaces", () => {
  assert.match(bg, /msg\?\.kind === "pass\.unlock"/, "SW must handle the pass.unlock message");
  assert.match(bg, /msg\?\.kind === "pass\.lock"/,   "SW must handle the pass.lock message");
});

// The passphrase must not outlive the request. A chrome.storage write would
// persist it to disk; the diag ring is readable from the host console and
// exportable to a file.
test("the passphrase is never persisted or logged", () => {
  assert.doesNotMatch(bg, /storage\.(local|sync|session)\.set\([^)]*passphrase/,
    "passphrase must never be written to chrome.storage");
  assert.match(bg, /Object\.keys\(req \|\| \{\}\)\.filter\(\(k\) => k !== "passphrase"\)/,
    "bpSend must drop `passphrase` from the diag ring's logged key list");
  assert.doesNotMatch(popup, /storage\.(local|sync|session)\.set\([^)]*passphrase/,
    "popup must never persist the passphrase");
  assert.doesNotMatch(mgrJs, /storage\.(local|sync|session)\.set\([^)]*passphrase/,
    "pass manager must never persist the passphrase");
});

// Every request typed in the host console is written to the transcript, which
// has an Export button — a pass.unlock template there would put a passphrase
// in a file on disk.
test("the host console offers pass.lock but never a pass.unlock template", () => {
  assert.match(hostJs, /\{"action":"pass\.lock"\}/, "pass.lock belongs in the catalog");
  assert.doesNotMatch(hostJs, /"action":"pass\.unlock"/,
    "pass.unlock must stay out of the catalog — its payload is a passphrase");
});

// Error code 24 is UnableToDecryptPasswordFile. Wrapper layers rethrow with a
// fresh Error and lose `.code`, so the message must be matched too, otherwise
// a locked store looks like a generic failure and never prompts.
test("a locked store is distinguishable from other host failures", () => {
  assert.match(bg, /const PASS_ERR_DECRYPT = 24/, "the decrypt error code must be pinned");
  assert.match(bg, /function isPassLockedError\b/, "isPassLockedError helper must exist");
  assert.match(bg, /unable to decrypt/i, "must also match the host's message after rewrapping");
  for (const kind of ["pass.fetch", "pass.otp", "pass.fill"]) {
    const handler = bg.slice(bg.indexOf(`msg?.kind === "${kind}"`));
    assert.match(handler.slice(0, 400), /locked: isPassLockedError\(e\)/,
      `${kind} must report whether the failure was a locked store`);
  }
  // passCopyFieldForPath resolves on failure instead of throwing, so the
  // message handler's .catch never runs for the copy path — the flag has to be
  // set inside the helper or the popup can't tell a locked store from an entry
  // with no password.
  const copyHelper = bg.slice(bg.indexOf("async function passCopyFieldForPath"));
  assert.match(copyHelper.slice(0, copyHelper.indexOf("\n}\n")), /locked: isPassLockedError\(e\)/,
    "passCopyFieldForPath must carry the locked flag on its resolved failure value");
});

test("popup surfaces an unlock bar and retries the op that tripped the lock", () => {
  assert.match(popup, /function renderPassUnlockBar\b/, "unlock bar renderer must exist");
  assert.match(popup, /id="pass-unlock-pw"[^>]*type="password"|type="password"[^>]*id="pass-unlock-pw"/,
    "the passphrase field must be type=password");
  assert.match(popup, /function promptPassUnlock\b/, "locked failures must open the prompt");
  assert.match(popup, /if \(r\?\.locked\) promptPassUnlock\(/,
    "fill / copy failures must open the prompt when the store is locked");
  assert.match(popup, /kind: "pass\.unlock", passphrase/, "submit must send the passphrase");
  assert.match(popup, /file: passUnlockPendingPath \|\| undefined/,
    "unlock must target the entry whose op failed, so the retry can't hit a second locked key");
});

// The popup's global keydown handler closes a tab on Backspace and moves the
// selection on the arrows — typing a passphrase must not do either.
test("the popup's global key bindings stand down while the passphrase field has focus", () => {
  const handler = popup.slice(popup.indexOf('document.addEventListener("keydown"'));
  const guard = handler.slice(0, 600);
  assert.match(guard, /getElementById\("pass-unlock-pw"\)/,
    "the guard must look up the passphrase field");
  assert.match(guard, /document\.activeElement === \$pw\) return/,
    "the handler must return early while the field has focus");
});

test("pass manager exposes unlock / lock and retries the entry that failed", () => {
  assert.match(mgrHtml, /id="t-unlock"/, "toolbar must have an unlock button");
  assert.match(mgrHtml, /id="t-lock"/,   "toolbar must have a lock button");
  assert.match(mgrJs, /function unlockDialog\b/, "unlock dialog must exist");
  assert.match(mgrJs, /type="password"/, "the dialog's field must be type=password");
  assert.match(mgrJs, /function isLockedErr\b/, "locked-store detection must exist");
  assert.match(mgrJs, /isLockedErr\(e\) && \(await unlockDialog\(path\)\)\) pickEntry\(path\)/,
    "a locked fetch must prompt and then reload the same entry");
  assert.match(mgrJs, /isLockedErr\(e\) && \(await unlockDialog\(path\)\)\) doFill\(\)/,
    "a locked fill must prompt and then retry the fill");
});

// pass.html is an extension page: an inline handler would be blocked by the
// MV3 CSP, and the new toolbar buttons are wired in JS for that reason.
test("the new pass-manager toolbar buttons carry no inline handlers", () => {
  const buttons = mgrHtml.match(/<button[^>]*id="t-(unlock|lock)"[^>]*>/g) || [];
  assert.equal(buttons.length, 2, "both toolbar buttons must be present");
  for (const b of buttons) {
    assert.doesNotMatch(b, /\son[a-z]+=/i, `inline handler in ${b} would be CSP-blocked`);
  }
});
