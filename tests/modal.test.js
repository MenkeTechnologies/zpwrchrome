// Static invariants for the JetBrains-style Recent Tabs modal content script.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const content = read("modal/content.js");

test("manifest declares modal/content.js as a content script on <all_urls>", () => {
  assert.ok(Array.isArray(manifest.content_scripts), "no content_scripts array");
  const cs = manifest.content_scripts[0];
  assert.ok(cs.matches.includes("<all_urls>"), "content script must match <all_urls>");
  assert.ok(cs.js.includes("modal/content.js"), "modal/content.js must be in cs.js");
});

test("content script is also declared web_accessible_resources (for fallback injection)", () => {
  const war = manifest.web_accessible_resources || [];
  const all = war.flatMap((w) => w.resources || []);
  assert.ok(all.includes("modal/content.js"),
    "modal/content.js must be in web_accessible_resources so scripting.executeScript can load it");
});

test("recent-modal command is declared with a default-suggested key", () => {
  const cmd = manifest.commands["recent-modal"];
  assert.ok(cmd, "recent-modal command missing");
  assert.ok(cmd.suggested_key, "recent-modal must ship with a default key (this is the headline feature)");
  // Mac default must be Cmd+E to match JetBrains.
  assert.equal(cmd.suggested_key.mac, "Command+E",
    "Mac default key for recent-modal must be Command+E (JetBrains parity)");
  // Cross-platform default Ctrl+E.
  assert.equal(cmd.suggested_key.default, "Ctrl+E");
});

test("background.js dispatches recent-modal", () => {
  const bg = read("background.js");
  assert.match(bg, /command === "recent-modal"/, "background.js missing handler");
  // v0.4.16+: recent-modal goes straight to chrome.action.openPopup() so
  // Cmd+E anchors to the toolbar icon (top-right), matching every other
  // command's popup location. The shadow-DOM injection path is retired.
  const mod = bg.match(/async function openRecentModal\(\)[\s\S]*?\n\}\n/);
  assert.ok(mod, "openRecentModal body not found");
  assert.match(mod[0], /chrome\.action\.openPopup/,
    "openRecentModal must call chrome.action.openPopup()");
  assert.ok(!/tabs\.sendMessage\([^)]*"open-modal"/.test(mod[0]),
    "openRecentModal must NOT inject the in-page modal — popup-only now");
});

test("content script is wrapped in an IIFE and is idempotent", () => {
  // Two injections in the same page must not double-install listeners.
  assert.match(content, /\(\(\) => \{[\s\S]+\}\)\(\);/, "content script not an IIFE");
  assert.match(content, /window\[.*?"-installed"\]/, "no idempotency guard");
});

test("content script attaches a closed shadow root (style isolation)", () => {
  assert.match(content, /attachShadow\(\{\s*mode:\s*"closed"/,
    "modal must use closed shadow root to keep host CSS out");
});

test("initial open pre-selects the previous-MRU row (JetBrains UX)", () => {
  // Single Enter should switch back to the tab the user came from. To do
  // that, on first render rowIdx must be set to active_index + 1 (with
  // wrap). Once user nav happens, leave rowIdx alone.
  const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
  assert.match(tmpl, /firstRender:\s*true/, "state.firstRender flag missing");
  assert.match(tmpl, /findIndex\(\(t\) => t\.active\)/,
    "must locate the active tab to compute next-row selection");
  // Same in the popup so both surfaces match.
  const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
  assert.match(popup, /firstRender:\s*true/, "popup must have firstRender flag");
  assert.match(popup, /findIndex\(\(t\) => t\.active\)/,
    "popup must locate the active tab to compute next-row selection");
});

test("modal listener attaches at window-capture so other extensions can't steal keys", () => {
  // Vimium and similar extensions register keydown listeners on `document`.
  // Window-level capture fires BEFORE document-level capture, so attaching
  // to window with capture=true lets us swallow keys before Vimium sees them.
  const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
  assert.match(tmpl, /window\.addEventListener\(\s*"keydown",[^,]+,\s*true\)/,
    "modal must attach keydown to window with capture=true");
  // And NOT to document (we moved away from that).
  assert.ok(!/document\.addEventListener\(\s*"keydown",/.test(tmpl),
    "modal must not listen on document — window capture beats document capture");
});

test("modal calls stopImmediatePropagation to block other extensions", () => {
  const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
  // stopPropagation alone isn't enough — stopImmediatePropagation also blocks
  // other listeners attached to the same target in the same phase.
  assert.match(tmpl, /stopImmediatePropagation\(\)/,
    "modal must call stopImmediatePropagation so Vimium etc. can't act on the same key");
});

test("modal forwards every printable key to the filter (no Vimium leak)", () => {
  // The handler must accept any single-char e.key (so 'd', 's', 'j', etc.
  // all go to the filter — none escape to Vimium).
  const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
  assert.match(tmpl, /e\.key\.length === 1/,
    "modal must catch every length-1 key (the printable set)");
  assert.match(tmpl, /setFilter\(state\.filter \+ e\.key\)/,
    "modal must append the typed char to the filter");
});

test("modal uses a focus-sink <input> in document.body to bypass Vimium", () => {
  // Vimium checks document.activeElement.tagName === 'INPUT' to detect
  // "insert mode" and stops grabbing single-char keys. The closed shadow
  // root hides our visible search from that check (host div, not input),
  // so we add a hidden real <input> outside the shadow + keep focus on it.
  const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
  assert.match(tmpl, /document\.createElement\("input"\)/,
    "modal must create a real <input> for the focus sink");
  assert.match(tmpl, /state\.sink/, "sink reference must be stored on state");
  assert.match(tmpl, /sink\.focus\(\)/,
    "modal must focus the sink so Vimium detects insert mode");
  // The sink must be in document.body / document.documentElement so it's
  // actually in the DOM (an input not attached to document doesn't count
  // as the active element).
  assert.match(tmpl, /document\.(body|documentElement)\.appendChild\(sink\)/);
  // And it must be tabindex >= 0 so .focus() works.
  assert.match(tmpl, /sink\.setAttribute\("tabindex",\s*"0"\)/);
});

test("plain Backspace closes the highlighted tab (Mac-laptop friendly)", () => {
  // Mac laptops don't have a Del key; Fn+Backspace is awkward. Backspace
  // closes the tab when filter is empty; otherwise it trims one char from
  // the filter.
  const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
  assert.match(tmpl, /e\.key === "Backspace"/, "modal must handle Backspace");
  assert.match(tmpl, /e\.key === "Delete"/,    "modal must also accept Del");
  assert.match(tmpl, /state\.filter\.length > 0/,
    "Backspace must trim filter chars first, only close-tab when filter empty");
  assert.ok(!/Backspace.*e\.shiftKey/.test(tmpl),
    "Shift+Backspace requirement removed — Backspace alone now works");
  // Popup parity (popup is in extension context, not subject to Vimium).
  const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
  assert.match(popup, /e\.key === "Delete" \|\| e\.key === "Backspace"/);
});

test(":host font-family carries !important so all:initial doesn't reset it", () => {
  // Regression for v0.2.3: `all: initial !important` expanded to
  // `font-family: initial !important`, and the unprefixed
  // `font-family: 'Share Tech Mono'` couldn't override it. Result: body
  // text fell back to user-agent default (Times New Roman) while only
  // .title and kbd survived because they had explicit font-family.
  const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
  const m = tmpl.match(/:host\s*\{[\s\S]*?\}/);
  assert.ok(m, "no :host rule in modal/content.template.js");
  // Both `all: initial` and `font-family` must be `!important` so they
  // don't fight each other.
  assert.match(m[0], /all:\s*initial\s*!important/);
  assert.match(m[0], /font-family:[^;]*!important/,
    ":host font-family must carry !important to beat all:initial !important");
});

test("modal embeds fonts as base64 data URIs (bypasses host-page CSP)", () => {
  // Pages with strict font-src CSP block chrome-extension:// font URLs.
  // data: URIs are part of the stylesheet bytes — no fetch, no CSP check.
  const stm = readFileSync(join(ROOT, "fonts/ShareTechMono-Regular.woff2")).toString("base64");
  const orb = readFileSync(join(ROOT, "fonts/Orbitron.woff2")).toString("base64");
  assert.ok(content.includes(stm), "modal/content.js missing inlined Share Tech Mono base64");
  assert.ok(content.includes(orb), "modal/content.js missing inlined Orbitron base64");
  // And the @font-face rules must reference data: URIs (not http/blob/chrome-extension).
  const fontFaces = content.match(/@font-face\s*\{[\s\S]*?\}/g) || [];
  assert.ok(fontFaces.length >= 3, `expected ≥3 @font-face rules, got ${fontFaces.length}`);
  for (const ff of fontFaces) {
    assert.match(ff, /src:\s*url\(data:font\/woff2;base64,/,
      "every @font-face must use a data: URI — non-data URLs hit host-page CSP");
  }
});

test("modal/content.js is generated from the template (do-not-edit-by-hand banner present)", () => {
  // Catches the case where someone hand-edits modal/content.js and the
  // template falls out of sync.
  assert.match(content, /THIS FILE IS GENERATED by scripts\/build-modal\.sh/);
});

test("modal template has %%STM%% / %%ORB%% markers and FontFace API code is gone", () => {
  const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
  assert.match(tmpl, /%%STM%%/, "template must keep %%STM%% marker");
  assert.match(tmpl, /%%ORB%%/, "template must keep %%ORB%% marker");
  assert.ok(!/new FontFace\(/.test(tmpl),
    "FontFace API is replaced by inline @font-face data URIs — remove the dead code");
  assert.ok(!/ensureFonts\(\)/.test(tmpl),
    "ensureFonts() call must be removed (no longer needed)");
});

test("content script never uses an inline event handler attribute", () => {
  // No `onclick=`, `onerror=`, etc. in the rendered HTML.
  const inlineHandler = /\bon(click|change|input|error|load|submit|keydown|mouseover|mouseenter|focus|blur)\s*=/i;
  // Allowed: the regex pattern source itself in the test would match, so we
  // look at the content of `html()` template literals.
  const htmlBlocks = [...content.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  for (const block of htmlBlocks) {
    assert.ok(!inlineHandler.test(block),
      `inline event handler in template literal:\n${block.slice(0, 200)}`);
  }
});

test("content script listens for open-modal and close-modal messages", () => {
  assert.match(content, /msg\?\.kind === "open-modal"/);
  assert.match(content, /msg\?\.kind === "close-modal"/);
});

test("content script sends activate / restore / close-tab / list to background", () => {
  for (const kind of ["activate", "restore", "close-tab", "list"]) {
    const re = new RegExp(`sendMessage\\(\\s*\\{\\s*kind:\\s*"${kind}"`);
    assert.match(content, re, `content script must send "${kind}"`);
  }
});

test("content script declares the 6 JetBrains-style categories", () => {
  const expected = ["all", "current", "pinned", "audible", "muted", "closed"];
  for (const id of expected) {
    const re = new RegExp(`id:\\s*"${id}"`);
    assert.match(content, re, `category "${id}" not declared`);
  }
});

test("content script keyboard nav covers JetBrains-canonical keys", () => {
  // Cmd+E (cycle), Cmd+0..9 (category jump — 0 = 10th slot for History),
  // Arrow nav, Enter, Esc, Delete.
  assert.match(content, /metaKey.*ctrlKey.*"e"/, "Cmd/Ctrl+E cycling missing");
  assert.match(content, /\[0-9\]/,                  "Cmd+0..9 category nav missing");
  assert.match(content, /e\.key === "ArrowDown"/,   "ArrowDown missing");
  assert.match(content, /e\.key === "ArrowUp"/,     "ArrowUp missing");
  assert.match(content, /e\.key === "Enter"/,       "Enter missing");
  assert.match(content, /e\.key === "Escape"/,      "Escape missing");
});

test("content script renders an interactive search input", () => {
  assert.match(content, /class="search"/);
  // Visible search is read-only; the hidden focus-sink is what actually
  // receives focus (so Vimium detects insert mode).
  assert.match(content, /sink\.focus\(\)/, "modal must focus the hidden sink on open");
});

test("content script uses the strykelang HUD palette", () => {
  for (const hex of ["#05d9e8", "#ff2a6d", "#0d0d1a", "#0a0a14", "#e0f0ff"]) {
    assert.ok(content.includes(hex), `palette color ${hex} missing from modal CSS`);
  }
});

test("recent-modal does not break the 4-default-keys ceiling", () => {
  // Adding recent-modal as default-keyed means one prior command must have
  // been demoted. Re-verify the global count.
  const cmds = manifest.commands;
  const defaults = Object.keys(cmds).filter((k) => cmds[k].suggested_key);
  assert.ok(defaults.length <= 4,
    `Chrome MV3 caps suggested_key at 4. Got ${defaults.length}: ${defaults.join(", ")}`);
});

test("openRecentModal opens the toolbar popup (top-right anchor)", () => {
  // v0.4.16: every command's UI must open from the toolbar icon for visual
  // parity. The in-page shadow-DOM overlay was retired because it landed
  // center-of-viewport while Cmd+Y / Alt+T / save-scene-prompt all anchored
  // top-right.
  const bg = readFileSync(join(ROOT, "background.js"), "utf8");
  assert.match(bg, /async function openRecentModal\(\)/, "openRecentModal not defined");
  const mod = bg.match(/async function openRecentModal\(\)[\s\S]*?\n\}\n/);
  assert.ok(mod, "could not locate openRecentModal body");
  assert.match(mod[0], /chrome\.action\.openPopup/,
    "openRecentModal must call chrome.action.openPopup()");
  // No content-script injection, no separate-window create.
  assert.ok(!/chrome\.windows\.create/.test(mod[0]),
    "openRecentModal must NOT use chrome.windows.create — separate OS window is jarring");
  assert.ok(!/chrome\.scripting\.executeScript/.test(mod[0]),
    "openRecentModal must NOT inject content scripts — popup-only now");
});

test("popup .modal has the cyan border + neon glow to mirror the in-page overlay", () => {
  const css = readFileSync(join(ROOT, "popup.css"), "utf8");
  // Find the .modal rule and verify border + box-shadow are present.
  const m = css.match(/\.modal\s*\{[\s\S]*?\}/);
  assert.ok(m, "no .modal rule in popup.css");
  assert.match(m[0], /border:\s*1px solid var\(--cyan\)/, ".modal missing cyan border");
  assert.match(m[0], /box-shadow:[\s\S]*?var\(--cyan-glow\)/, ".modal missing neon glow box-shadow");
});

test("content script is excluded from the Chrome Web Store (Chrome blocks it anyway)", () => {
  const cs = manifest.content_scripts[0];
  const excl = cs.exclude_matches || [];
  const hasWebStore = excl.some((m) => /chromewebstore|webstore/.test(m));
  assert.ok(hasWebStore,
    "content script must exclude *://chromewebstore.google.com/* (Chrome silently refuses to inject there)");
});
