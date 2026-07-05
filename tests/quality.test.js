// Anti-pattern regression tests. Each test below maps to a real bug we
// shipped (and the user reported). The goal is: if any of these patterns
// reappears, CI catches it before it lands on main.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const CLIENT_FILES = [
  "popup.js",
  "modal/content.template.js",
  "scripts-manager/manager.js",
  "lib/gm-shim.js"
];

// ============================================================================
// v0.4.6 bug: chrome.runtime.sendMessage without a callback returns a Promise.
// If the SW isn't reachable, the Promise rejects with "Could not establish
// connection." A try/catch around the call doesn't catch async rejections.
// Every sendMessage from a client must either have a 2nd-arg callback OR be
// followed by a `.catch(` within ~200 chars.
// ============================================================================
test("every chrome.runtime.sendMessage in clients has a callback or .catch()", () => {
  for (const file of CLIENT_FILES) {
    const src = read(file);
    const re = /chrome\.runtime\.sendMessage\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      // Search from the call all the way to EOF — callback bodies can be long.
      const tail = src.slice(m.index);
      const hasMultiArg = hasTopLevelComma(tail);
      const hasCatch    = /\.\s*catch\s*\(/.test(tail.slice(0, 500));
      assert.ok(
        hasMultiArg || hasCatch,
        `${file}: sendMessage without callback or .catch() at char ${m.index}\n` +
        `slice: ${tail.slice(0, 160).replace(/\n/g, "\\n")}…`
      );
    }
  }
});

// Did the sendMessage call have a top-level comma (i.e., ≥ 2 args)? We scan
// from the opening "(" and look for a "," at depth 1 before we hit the
// matching ")".
function hasTopLevelComma(src) {
  const open = src.indexOf("(");
  if (open < 0) return false;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return false;
    } else if (c === "," && depth === 1) return true;
  }
  return false;
}

// ============================================================================
// v0.4.7 bug: scripts.list used `meta["userScripts.mode"] || (chrome.userScripts ? ...)`.
// `||` always picked the stale stored value over the live API check. Generalize:
// in background.js, no `chrome.storage.local.get(...) || chrome.<API>` pattern.
// ============================================================================
test("background.js does not prefer stale stored API mode over the live chrome.* check", () => {
  const bg = read("background.js");
  // Look for: `meta["userScripts.mode"]` (or similar) joined by `||` to a chrome.X check.
  // Easy way: scan for `userScripts.mode"\]` followed by `||` within 50 chars,
  // followed by `chrome.` within 80 chars.
  const re = /userScripts\.mode["']\][^|;]{0,50}\|\|[^;]{0,80}chrome\./;
  assert.ok(!re.test(bg),
    "stored userScripts.mode value is being OR'd with chrome.* live check; live check must win unconditionally");
});

// ============================================================================
// v0.4.4/0.4.8 bug: scripts didn't fire because configureWorld({ messaging: true })
// was never called. USER_SCRIPT world has messaging disabled by default — the GM.*
// shim's sendMessage silently fails.
// ============================================================================
test("background.js calls chrome.userScripts.configureWorld with messaging:true", () => {
  const bg = read("background.js");
  assert.match(bg, /chrome\.userScripts\.configureWorld\(/);
  // Within a few hundred chars of the call, must set messaging:true.
  const idx = bg.indexOf("chrome.userScripts.configureWorld(");
  assert.ok(idx >= 0);
  const slice = bg.slice(idx, idx + 400);
  assert.match(slice, /messaging:\s*true/,
    "configureWorld must enable messaging so the GM.* shim sendMessage works");
});

// ============================================================================
// Multiple v0.4.x bugs: fire log was empty because we relied on the gm:fire
// beacon (userscript → SW). The beacon races SW lifecycle. Fix is to log from
// background.js itself in the navigation listener.
// ============================================================================
test("fire log is written from background.js (not just userscript beacon)", () => {
  const bg = read("background.js");
  // handleNav must call appendFireLog directly.
  const hn = bg.match(/async function handleNav\([\s\S]*?\n\}\n/);
  assert.ok(hn, "handleNav function not found in background.js");
  assert.match(hn[0], /appendFireLog\(/,
    "handleNav must call appendFireLog directly — beacon-only logging races SW lifecycle");
  // And handleNav must be wired to all three webNavigation phases.
  for (const ev of ["onCommitted", "onDOMContentLoaded", "onCompleted"]) {
    const re = new RegExp(`chrome\\.webNavigation\\.${ev}\\.addListener`);
    assert.match(bg, re, `webNavigation.${ev} must be wired for handleNav`);
  }
});

// ============================================================================
// v0.4.6 bug: Run Log didn't update without re-clicking the tab. manager.js
// must subscribe to chrome.storage.onChanged for the fire log key.
// ============================================================================
test("manager.js auto-refreshes the Run Log on storage change", () => {
  const mgr = read("scripts-manager/manager.js");
  assert.match(mgr, /chrome\.storage\.onChanged\.addListener/,
    "manager.js must listen for storage changes to auto-refresh the Run Log");
  assert.match(mgr, /userScripts\.fireLog/,
    "onChanged listener must filter on the fire-log key");
  assert.match(mgr, /refreshLog\(\)/,
    "onChanged listener must call refreshLog()");
});

// ============================================================================
// v0.4.4 bug: empty excludeMatches array made some Chrome versions reject
// the whole register call. Must be conditionally added.
// ============================================================================
test("background.js omits empty excludeMatches from chrome.userScripts.register", () => {
  const bg = read("background.js");
  assert.match(bg, /if \(meta\.excludes\.length\)\s+reg\.excludeMatches/,
    "excludeMatches must be added only when non-empty (empty arrays reject the register call)");
});

// ============================================================================
// v0.4.7 bug: stale userScripts.error stayed in storage when the API became
// available. syncUserScripts must clear it on success.
// ============================================================================
test("background.js clears the stale userScripts.error on successful native sync", () => {
  const bg = read("background.js");
  assert.match(bg, /chrome\.storage\.local\.remove\(\s*["']userScripts\.error["']\s*\)/,
    "stale userScripts.error must be removed when native chrome.userScripts is alive");
});

// ============================================================================
// Storage key set/get consistency. Catches typos like writing
// "userscript.fireLog" but reading "userScripts.fireLog".
// ============================================================================
test("every chrome.storage.local.set key is read somewhere", () => {
  const sources = [
    "background.js",
    "popup.js",
    "scripts-manager/manager.js",
    "lib/ui-scheme.js"   // reads ui.scheme (get + storage.onChanged) written by background.js
  // Strip optional chaining (e.g. chrome.storage?.local?.get?.(…)) so the
  // read/write regexes below match whether or not a source uses `?.`. Optional
  // CALLS (`get?.(`) collapse to `get(`; optional property access to `.`.
  ].map((f) => ({ file: f, src: read(f).replace(/\?\.\(/g, "(").replace(/\?\./g, ".") }));

  const writes = new Set();
  const reads  = new Set();

  // Capture both literal-key sets and variable-key sets.
  for (const { src } of sources) {
    // chrome.storage.X.set({ "key": ... })  — literal key
    for (const m of src.matchAll(/chrome\.storage\.(local|session|sync)\.set\(\s*\{\s*(?:\[?\s*)?["']([^"']+)["']/g)) {
      writes.add(m[2]);
    }
    // chrome.storage.X.set({ [VAR]: ... })  — computed key, capture the var
    for (const m of src.matchAll(/chrome\.storage\.(local|session|sync)\.set\(\s*\{\s*\[\s*([A-Z_][\w$]*)\s*\]/g)) {
      // Resolve VAR by finding `const VAR = "..."`
      const cre = new RegExp("const\\s+" + m[2] + "\\s*=\\s*[\"']([^\"']+)[\"']");
      const cm = src.match(cre);
      if (cm) writes.add(cm[1]);
    }
    // chrome.storage.X.get("key")  — literal
    for (const m of src.matchAll(/chrome\.storage\.(local|session|sync)\.get\(\s*["']([^"']+)["']/g)) {
      reads.add(m[2]);
    }
    // chrome.storage.X.get(["k1", "k2"])  — array of literals
    for (const m of src.matchAll(/chrome\.storage\.(local|session|sync)\.get\(\s*\[\s*([^\]]+)\]/g)) {
      for (const lit of m[2].matchAll(/["']([^"']+)["']/g)) reads.add(lit[1]);
    }
    // chrome.storage.X.get(VAR)  — variable
    for (const m of src.matchAll(/chrome\.storage\.(local|session|sync)\.get\(\s*([A-Z_][\w$]*)\s*[,)]/g)) {
      const cre = new RegExp("const\\s+" + m[2] + "\\s*=\\s*[\"']([^\"']+)[\"']");
      const cm = src.match(cre);
      if (cm) reads.add(cm[1]);
    }
  }

  for (const key of writes) {
    assert.ok(reads.has(key),
      `storage key "${key}" is written but never read — typo? dead write?`);
  }
});

// ============================================================================
// Vimium bypass: the modal must (a) attach keydown at window-level capture,
// (b) place a focus-sink <input> in document.body, and (c) call
// stopImmediatePropagation for non-modifier-combo keys.
// ============================================================================
test("modal still defeats Vimium key-stealing (all three mechanisms intact)", () => {
  const tmpl = read("modal/content.template.js");
  assert.match(tmpl, /window\.addEventListener\(\s*"keydown",[^,]+,\s*true\)/,
    "modal must register window keydown at capture phase");
  assert.match(tmpl, /document\.createElement\("input"\)[\s\S]+sink\.focus\(\)/,
    "modal must create a focus-sink <input> and focus it");
  assert.match(tmpl, /stopImmediatePropagation\(\)/,
    "modal must call stopImmediatePropagation");
});

// ============================================================================
// v0.2.4 bug: bare backticks in a CSS template literal closed the literal and
// produced un-parseable JS. node --check catches this directly — we just
// re-assert it explicitly per modal/content.js so the failure mode is
// obvious in the test report.
// ============================================================================
test("modal/content.js parses with node --check (template literals balanced)", async () => {
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync("node", ["--check", join(ROOT, "modal/content.js")], { stdio: "pipe" });
  } catch (e) {
    const out = (e.stderr || e.stdout || e.message || "").toString();
    assert.fail("modal/content.js failed node --check:\n" + out.split("\n").slice(0, 8).join("\n"));
  }
});

// ============================================================================
// v0.4.x bug: popup and modal must keep the SAME category list. Tests already
// pin this; extend to verify the canonical category ids appear in both.
// ============================================================================
test("popup and modal categories are kept in lockstep", () => {
  const popup = read("popup.js");
  const modal = read("modal/content.template.js");
  const ids = ["all", "current", "pinned", "audible", "muted", "closed"];
  for (const id of ids) {
    const re = new RegExp(`id:\\s*"${id}"`);
    assert.match(popup, re, `popup missing category "${id}"`);
    assert.match(modal, re, `modal missing category "${id}"`);
  }
});

// ============================================================================
// v0.4.x bug: a user-script's fire log entry must carry the fields the UI
// renders. If a field is renamed in background but not in manager.js, rows
// silently render blank. Pin the contract.
// ============================================================================
test("fire log entry shape: required fields present in appendFireLog calls", () => {
  const bg = read("background.js");
  // Every appendFireLog({...}) call must include these keys.
  const required = ["script", "name", "url", "tabId", "frame", "mode"];
  const calls = [...bg.matchAll(/appendFireLog\(\s*\{([\s\S]*?)\}\s*\)/g)];
  assert.ok(calls.length > 0, "no appendFireLog calls found");
  for (const [, body] of calls) {
    for (const field of required) {
      const re = new RegExp(`\\b${field}\\b\\s*[:,]`);
      assert.match(body, re,
        `appendFireLog call missing field "${field}":\n${body.slice(0, 200)}`);
    }
  }
});

// ============================================================================
// initUserscripts wiring: must run at install/startup/SW-spawn AND must
// wire the navigation logger.
// ============================================================================
test("initUserscripts is registered on onInstalled + onStartup + invoked at SW load", () => {
  const bg = read("background.js");
  assert.match(bg, /chrome\.runtime\.onInstalled\.addListener\(\s*initUserscripts\s*\)/,
    "initUserscripts must be registered on onInstalled");
  assert.match(bg, /chrome\.runtime\.onStartup\.addListener\(\s*initUserscripts\s*\)/,
    "initUserscripts must be registered on onStartup");
  // Bare call at top level for SW spawn.
  assert.match(bg, /^initUserscripts\(\);\s*$/m,
    "initUserscripts must be invoked at top level for SW cold spawn");
  // initUserscripts must call enableNavigationLogger.
  const fn = bg.match(/async function initUserscripts\([\s\S]*?\n\}\n/);
  assert.ok(fn);
  assert.match(fn[0], /enableNavigationLogger\(\)/);
});

// ============================================================================
// Run-log UI count badge: tab text must include the live count.
// ============================================================================
test("Run Log tab shows a live count badge", () => {
  const mgr = read("scripts-manager/manager.js");
  assert.match(mgr, /function updateLogCount\(/,
    "manager.js must declare updateLogCount");
  assert.match(mgr, /Run Log \(\$\{logEntries\.length\}\)/,
    "tab label must include the live entry count");
});

// ============================================================================
// Arrow keys broke with many items because scrollIntoView triggers
// mouseenter on the row that lands under a stationary cursor — which then
// reset state.rowIdx to the mouse-row, undoing the keyboard nav.
// Both popup and modal must gate mouseenter on a recent real mousemove.
// ============================================================================
test("hover-selection is gated on real mousemove (arrow keys + many items)", () => {
  for (const file of ["popup.js", "modal/content.template.js"]) {
    const src = read(file);
    // Must listen for mousemove on the list and stash the timestamp.
    assert.match(src, /addEventListener\("mousemove"[\s\S]{0,200}lastMouseMove/,
      `${file}: must track real mousemove timestamps on the list`);
    // Must gate mouseenter on a recent mousemove (within 100ms-ish).
    assert.match(src, /Date\.now\(\)\s*-\s*state\.lastMouseMove\s*>\s*\d+/,
      `${file}: mouseenter must skip when no recent mousemove (scroll-induced)`);
  }
});

// ============================================================================
// Match-pattern semantics — Chrome's spec says `*` scheme = http|https only.
// Catches future drift where someone widens it to include file/ftp.
// ============================================================================
test("matchPatternToRegex follows Chrome's `*` = http|https rule", async () => {
  const { matchPatternToRegex } = await import("../lib/userscript.js");
  const re = matchPatternToRegex("*://example.com/*");
  assert.ok(re.test("http://example.com/x"));
  assert.ok(re.test("https://example.com/x"));
  assert.ok(!re.test("ftp://example.com/x"),
    "* must NOT match ftp:// — Chrome's spec restricts to http|https");
  assert.ok(!re.test("file:///etc/hosts"));
});

// ============================================================================
// Manifest-to-code coherence: every chrome.* API used in code must be backed
// by a permission. We had this test; extend to also catch chrome.scripting +
// chrome.webNavigation + chrome.tabs + chrome.tabGroups + chrome.userScripts.
// ============================================================================
test("every chrome.* API used in background.js maps to a manifest permission", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const bg = read("background.js");
  const apis = {
    "chrome.tabs":         "tabs",
    "chrome.tabGroups":    "tabGroups",
    "chrome.sessions":     "sessions",
    "chrome.bookmarks":    "bookmarks",
    "chrome.storage":      "storage",
    "chrome.scripting":    "scripting",
    "chrome.userScripts":  "userScripts",
    "chrome.webNavigation":"webNavigation"
  };
  for (const [api, perm] of Object.entries(apis)) {
    if (bg.includes(api)) {
      assert.ok(manifest.permissions.includes(perm),
        `background.js uses ${api} but manifest doesn't declare permission "${perm}"`);
    }
  }
});
