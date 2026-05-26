// Static invariants for the unpacked extension. No chrome runtime needed —
// these checks are catchers for the failure modes that bite us at install time
// (Chrome refuses to load the extension) or at review time (doc drift, dead
// shortcuts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const cmds = manifest.commands;
const cmdNames = Object.keys(cmds);
const bgSrc = read("background.js");

test("manifest.json declares manifest_version 3", () => {
  assert.equal(manifest.manifest_version, 3);
});

test("manifest.json has at most 4 commands with suggested keys (Chrome ceiling)", () => {
  const withKey = cmdNames.filter((n) => cmds[n].suggested_key);
  assert.ok(withKey.length <= 4,
    `Chrome MV3 caps suggested_key to 4. Got ${withKey.length}: ${withKey.join(", ")}`);
});

test("every command has a non-empty description", () => {
  for (const name of cmdNames) {
    assert.ok(
      typeof cmds[name].description === "string" && cmds[name].description.trim().length > 0,
      `command ${name} is missing description`
    );
  }
});

test("no default suggested key uses macOS-reserved shortcuts", () => {
  // Per /Users/wizard/.claude/CLAUDE.md: Cmd+Tab/H/M/Q never reach the WebView.
  // Cmd+T/W/N are reserved by Chrome itself.
  const banned = [
    /^Command\+(Tab|H|M|Q|T|W|N|R|L|F|G)$/i,
    /^Cmd\+(Tab|H|M|Q|T|W|N|R|L|F|G)$/i,
    /^MacCtrl\+Tab$/i
  ];
  for (const name of cmdNames) {
    const sk = cmds[name].suggested_key;
    if (!sk) continue;
    for (const [platform, combo] of Object.entries(sk)) {
      for (const re of banned) {
        assert.ok(!re.test(combo),
          `command ${name} on ${platform} binds reserved shortcut ${combo}`);
      }
    }
  }
});

test("suggested keys do not collide with each other", () => {
  const seen = new Map();
  for (const name of cmdNames) {
    const sk = cmds[name].suggested_key;
    if (!sk) continue;
    for (const [platform, combo] of Object.entries(sk)) {
      const key = `${platform}:${combo}`;
      assert.ok(!seen.has(key),
        `key collision on ${platform}: ${combo} used by ${seen.get(key)} and ${name}`);
      seen.set(key, name);
    }
  }
});

test("every command name is valid kebab-case or _execute_*", () => {
  const ok = /^(_execute_[a-z_]+|[a-z][a-z0-9-]*[a-z0-9])$/;
  for (const name of cmdNames) {
    assert.ok(ok.test(name), `command name "${name}" is not kebab-case`);
  }
});

test("every user-dispatched command in manifest has a handler in background.js", () => {
  // Excluded: chrome builtins (_execute_*), search-tabs which calls
  // chrome.action.openPopup() from the dispatch table.
  const skip = new Set(["_execute_action"]);
  const jumpFamily = /^jump-to-[1-9]$/;
  let jumpCovered = false;
  for (const name of cmdNames) {
    if (skip.has(name)) continue;
    if (jumpFamily.test(name)) {
      jumpCovered = bgSrc.includes('command.startsWith("jump-to-")');
      assert.ok(jumpCovered, "jump-to-* family must be handled via startsWith dispatch");
      continue;
    }
    assert.ok(
      bgSrc.includes(`command === "${name}"`),
      `background.js has no \`command === "${name}"\` branch`
    );
  }
});

test("background.js does not dispatch commands not declared in manifest", () => {
  const declared = new Set(cmdNames);
  const found = [...bgSrc.matchAll(/command === "([a-z][a-z0-9-]+)"/g)].map((m) => m[1]);
  for (const c of found) {
    assert.ok(declared.has(c),
      `background.js handles "${c}" but it is not declared in manifest.json`);
  }
});

test("every file path referenced by manifest exists on disk", () => {
  const paths = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons)
  ];
  for (const p of paths) {
    const abs = join(ROOT, p);
    assert.ok(existsSync(abs), `manifest references missing file: ${p}`);
    assert.ok(statSync(abs).size > 0, `manifest references zero-byte file: ${p}`);
  }
});

test("manifest icons are PNG and match their declared size", () => {
  // PNG header: 8 bytes + IHDR length(4) + "IHDR"(4) + width(4) + height(4)
  for (const [size, path] of Object.entries(manifest.icons)) {
    const buf = readFileSync(join(ROOT, path));
    assert.equal(buf[0], 0x89, `${path} missing PNG signature`);
    assert.equal(buf.toString("ascii", 1, 4), "PNG", `${path} not a PNG`);
    const width  = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.equal(width,  Number(size), `${path} width ${width} ≠ ${size}`);
    assert.equal(height, Number(size), `${path} height ${height} ≠ ${size}`);
  }
});

test("popup mirrors the modal: same 6 categories declared in both popup.js and modal/content.js", () => {
  // The popup is the fallback UI when the modal can't inject (chrome://,
  // view-source://, web store). Both surfaces must show the same category
  // list so the user sees the same UX everywhere.
  const popup = read("popup.js");
  const modal = read("modal/content.js");
  for (const id of ["all", "current", "pinned", "audible", "muted", "closed"]) {
    const re = new RegExp(`id:\\s*"${id}"`);
    assert.match(popup, re, `popup.js missing category "${id}"`);
    assert.match(modal, re, `modal/content.js missing category "${id}"`);
  }
});

test("popup uses the same 2-column layout structure as the modal", () => {
  // Both render: .header (title/search/hint), .body (.cats + .list), .footer.
  const html = read("popup.html");
  const modal = read("modal/content.js");
  for (const sel of ["class=\"header\"", "class=\"body\"", "class=\"cats\"", "class=\"list\"", "class=\"footer\""]) {
    assert.ok(html.includes(sel),  `popup.html missing ${sel}`);
    assert.ok(modal.includes(sel), `modal/content.js missing ${sel}`);
  }
});

test("popup.html references popup.css and popup.js and contains no inline JS handlers", () => {
  const html = read("popup.html");
  assert.match(html, /href=["']popup\.css["']/);
  assert.match(html, /src=["']popup\.js["']/);
  // CSP under MV3 default-src forbids inline event handlers and inline <script>.
  assert.ok(!/on(click|change|input|load|submit|keydown)\s*=/.test(html),
    "popup.html contains an inline event handler (blocked by MV3 CSP)");
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html),
    "popup.html contains an inline <script> (blocked by MV3 CSP)");
});

test("popup.css keeps the strykelang cyberpunk palette variables", () => {
  // Acceptance criterion from the spec: visuals lifted from
  // strykelang docs/hud-static.css. Don't let a refactor strip the palette.
  const css = read("popup.css");
  for (const v of ["--cyan", "--accent", "--magenta", "--bg-card", "--cyan-glow"]) {
    assert.ok(css.includes(v), `popup.css missing palette variable ${v}`);
  }
  // Hex must match strykelang's --cyan: #05d9e8 and --accent: #ff2a6d.
  assert.match(css, /--cyan:\s*#05d9e8/);
  assert.match(css, /--accent:\s*#ff2a6d/);
});

test("README, docs/index.html, and modal/content.js are in sync (scripts/gen.sh is idempotent)", () => {
  const readmeBefore = read("README.md");
  const docsBefore   = read("docs/index.html");
  const modalBefore  = read("modal/content.js");
  execFileSync("bash", [join(ROOT, "scripts/gen.sh")], { stdio: "pipe" });
  assert.equal(read("README.md"),         readmeBefore, "README.md drifted — re-run scripts/gen.sh and commit");
  assert.equal(read("docs/index.html"),   docsBefore,   "docs/index.html drifted — re-run scripts/gen.sh and commit");
  assert.equal(read("modal/content.js"),  modalBefore,  "modal/content.js drifted — re-run scripts/build-modal.sh and commit");
});

test("docs/index.html keeps the strykelang cyberpunk palette", () => {
  // Same guard as popup.css — the landing page must not silently lose the
  // visual identity it advertises.
  const html = read("docs/index.html");
  for (const v of ["--cyan", "--accent", "--magenta", "--bg-card", "--cyan-glow"]) {
    assert.ok(html.includes(v), `docs/index.html missing palette variable ${v}`);
  }
  assert.match(html, /--cyan:\s*#05d9e8/);
  assert.match(html, /--accent:\s*#ff2a6d/);
});

test("scripts/gen.sh is syntactically valid bash", () => {
  // Catches `set -euo pipefail` typos, unbalanced HEREDOCs, missing quotes.
  execFileSync("bash", ["-n", join(ROOT, "scripts/gen.sh")], { stdio: "pipe" });
});

test("every exported helper in lib/util.js is imported by background.js", () => {
  // No dead exports: if a helper lives in util.js but background.js doesn't
  // import it, either it's unused (delete it) or the test was forgotten.
  const util = read("lib/util.js");
  const exports = [...util.matchAll(/^export (?:const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.ok(exports.length > 0, "lib/util.js exports nothing");
  for (const name of exports) {
    assert.ok(
      bgSrc.includes(name),
      `lib/util.js exports "${name}" but background.js never references it`
    );
  }
});

test("popup.html declares the document language", () => {
  // Accessibility baseline.
  assert.match(read("popup.html"), /<html\s+[^>]*\blang=/);
});

test("popup.html has UTF-8 charset declared in first 1024 bytes (HTML spec)", () => {
  const head = read("popup.html").slice(0, 1024);
  assert.match(head, /<meta\s+charset=["']?utf-8/i);
});

test("icons SVG source parses (well-formed enough for rsvg-convert)", () => {
  // We don't ship an XML parser. Use the simplest possible sanity check:
  // open/close tag balance and an <svg> root.
  const svg = read("icons/icon.svg");
  assert.match(svg, /<svg\b/);
  assert.match(svg, /<\/svg>\s*$/);
  const opens  = (svg.match(/<[A-Za-z]/g)  || []).length;
  const closes = (svg.match(/<\/[A-Za-z]/g) || []).length;
  const selfs  = (svg.match(/\/>/g)         || []).length;
  // every open is either closed (matching </tag>) or self-closing.
  assert.equal(opens, closes + selfs,
    `icon.svg tag count mismatch — opens=${opens} closes=${closes} self-close=${selfs}`);
});

test("README banner block contains the ZPWRCHROME letters", () => {
  // Cheap structural assertion that the banner wasn't replaced with a
  // generic header. The ASCII block uses backslashes and underscores; we
  // just verify the README's banner code-fence is the figlet output, not
  // some other code block.
  const readme = read("README.md");
  const banner = readme.match(/^```\n([\s\S]+?)\n```/);
  assert.ok(banner, "README has no opening code fence");
  assert.match(banner[1], /\\/, "banner does not look like figlet output (no backslash glyphs)");
});

test("manifest.json, theme/manifest.json, and package.json share the same version", () => {
  // Avoids the failure mode where the extension ships v0.2.0 but the theme
  // and npm test harness still claim v0.1.0.
  const ext   = JSON.parse(read("manifest.json")).version;
  const theme = JSON.parse(read("theme/manifest.json")).version;
  const pkg   = JSON.parse(read("package.json")).version;
  assert.equal(theme, ext, `theme version ${theme} ≠ extension version ${ext}`);
  assert.equal(pkg,   ext, `package.json version ${pkg} ≠ extension version ${ext}`);
});

test("cyberpunk fonts are bundled locally as woff2", () => {
  // The popup and modal both reference 'Share Tech Mono' and 'Orbitron'.
  // Google Fonts is not loaded over the network (CSP), so the woff2 files
  // must be on disk and declared in web_accessible_resources for the modal.
  const expected = ["fonts/ShareTechMono-Regular.woff2", "fonts/Orbitron.woff2"];
  for (const rel of expected) {
    const abs = join(ROOT, rel);
    assert.ok(existsSync(abs), `missing bundled font: ${rel}`);
    const buf = readFileSync(abs);
    // woff2 magic: "wOF2"
    assert.equal(buf.toString("ascii", 0, 4), "wOF2", `${rel} is not a valid woff2 file`);
  }
});

test("popup.css declares @font-face for the bundled fonts", () => {
  const css = read("popup.css");
  assert.match(css, /@font-face[\s\S]*'Share Tech Mono'[\s\S]*ShareTechMono-Regular\.woff2/);
  assert.match(css, /@font-face[\s\S]*'Orbitron'[\s\S]*Orbitron\.woff2/);
});

test("every JS source parses (node --check)", () => {
  // v0.2.4 shipped a syntactically broken modal/content.js (bare backticks
  // in a comment closed the CSS template literal). Tests passed because
  // CI never ran `node --check modal/content.js`. This catches it.
  // Note: modal/content.template.js is intentionally excluded — it carries
  // %%STM%% / %%ORB%% / %%FZF%% markers and only parses after substitution.
  const files = [
    "background.js",
    "popup.js",
    "lib/util.js",
    "lib/fzf.js",
    "modal/content.js",
    "scripts/gen.mjs",
    "scripts/build-modal.mjs"
  ];
  for (const f of files) {
    try {
      execFileSync("node", ["--check", join(ROOT, f)], { stdio: "pipe" });
    } catch (e) {
      const stderr = (e.stderr && e.stderr.toString()) || e.message;
      assert.fail(`node --check ${f} failed:\n${stderr.split("\n").slice(0, 5).join("\n")}`);
    }
  }
});

test("background.js configures the USER_SCRIPT world before registering", () => {
  // Without configureWorld({ messaging: true }) the GM.* shim's
  // chrome.runtime.sendMessage silently fails inside USER_SCRIPT world,
  // and some Chrome builds refuse to fire the scripts at all until the
  // world is configured.
  const bg = read("background.js");
  assert.match(bg, /chrome\.userScripts\.configureWorld/,
    "background.js must call chrome.userScripts.configureWorld");
  assert.match(bg, /messaging:\s*true/,
    "configureWorld must enable messaging so the GM.* shim's sendMessage works");
});

test("background.js verifies registration via getScripts() and surfaces lastSync", () => {
  // After register, the background must verify with getScripts() and
  // persist a lastSync object the dashboard can show. This catches the
  // silent-no-fire case the user hit on example.com.
  const bg = read("background.js");
  assert.match(bg, /chrome\.userScripts\.getScripts/,
    "background.js must call getScripts() to verify the post-register state");
  assert.match(bg, /userScripts\.lastSync/,
    "background.js must persist lastSync metadata for the dashboard");
});

test("background.js wires a unified webNavigation logger for both modes", () => {
  const bg = read("background.js");
  assert.match(bg, /chrome\.webNavigation\.onCommitted/,
    "must hook onCommitted for document-start scripts");
  assert.match(bg, /chrome\.webNavigation\.onDOMContentLoaded/,
    "must hook onDOMContentLoaded for document-end scripts");
  assert.match(bg, /chrome\.webNavigation\.onCompleted/,
    "must hook onCompleted for document-idle scripts");
  assert.match(bg, /chrome\.scripting\.executeScript/,
    "must inject via chrome.scripting.executeScript in fallback mode");
  assert.match(bg, /world:\s*"ISOLATED"/,
    "fallback must inject in ISOLATED world so chrome.runtime messaging works");
  assert.match(bg, /enableNavigationLogger\(\)/,
    "background.js must wire enableNavigationLogger() in initUserscripts");
  // handleNav must always appendFireLog, regardless of mode (native skips inject).
  const hn = bg.match(/async function handleNav\([\s\S]*?\n\}\n/);
  assert.ok(hn, "handleNav function not found");
  assert.match(hn[0], /appendFireLog\(/, "handleNav must log every matching fire");
  assert.match(hn[0], /if \(native\) continue;/,
    "handleNav must skip injection when chrome.userScripts is available");
  // Manifest still needs the permission.
  assert.ok(manifest.permissions.includes("webNavigation"),
    "manifest must declare webNavigation permission");
});

test("GM shim swallows sendMessage promise rejections (SW-lifecycle races)", () => {
  // Without this, every script invocation logs "Uncaught (in promise)
  // Error: Could not establish connection" to the page's console.
  const shim = read("lib/gm-shim.js");
  assert.match(shim, /chrome\.runtime\.lastError/,
    "GM shim must reference chrome.runtime.lastError so sendMessage errors are swallowed");
  // The fire beacon must use the callback form (the Promise form rejects loud).
  const fireMatch = shim.match(/kind:\s*"gm:fire"[\s\S]*?\)\s*;/);
  assert.ok(fireMatch, "gm:fire beacon not found");
  assert.match(fireMatch[0], /,\s*\(\)\s*=>\s*\{/,
    "gm:fire beacon must use the callback form, not the Promise form");
});

test("scripts.list trusts the live chrome.userScripts presence over stored mode", () => {
  // Bug v0.4.5: storage "userScripts.mode" was set to "fallback" on the
  // first load (before Allow User Scripts was toggled on). After the user
  // enabled the toggle + reloaded, chrome.userScripts WAS defined but the
  // dashboard still rendered "fallback" because it read the stale storage.
  const bg = read("background.js");
  const sec = bg.match(/msg\?\.kind === "scripts\.list"[\s\S]*?return true;/);
  assert.ok(sec, "scripts.list handler not found");
  assert.match(sec[0], /const native = !!chrome\.userScripts/,
    "scripts.list must derive native from the LIVE API check");
  // syncUserScripts on success must write "native" + clear stale error.
  assert.match(bg, /chrome\.storage\.local\.set\(\{\s*"userScripts\.mode":\s*"native"\s*\}\)/,
    "syncUserScripts must set mode to 'native' when chrome.userScripts is available");
  assert.match(bg, /chrome\.storage\.local\.remove\("userScripts\.error"\)/,
    "syncUserScripts must clear the stale error key on native-mode success");
});

test("background.js logs fires from handleNav (not via the unreliable userscript beacon)", () => {
  // The SW knows what's about to fire — log directly from background
  // rather than depending on the userscript's chrome.runtime.sendMessage
  // (which races against SW lifecycle and silently drops).
  const bg = read("background.js");
  assert.match(bg, /async function appendFireLog\(/,
    "background.js must declare an appendFireLog helper");
  const hn = bg.match(/async function handleNav\([\s\S]*?\n\}\n/);
  assert.ok(hn, "handleNav body not found");
  assert.match(hn[0], /appendFireLog\(/,
    "handleNav must call appendFireLog for every matching script");
});

test("userscript run log: GM shim fires a beacon, background appends to a ring buffer", () => {
  const shim = read("lib/gm-shim.js");
  assert.match(shim, /kind:\s*"gm:fire"/,
    "GM shim must send a gm:fire beacon at script load");
  assert.match(shim, /url:\s*location\.href/,
    "fire beacon must carry the current URL");

  const bg = read("background.js");
  assert.match(bg, /msg\?\.kind === "gm:fire"/,
    "background.js must handle gm:fire");
  assert.match(bg, /FIRE_LOG_CAP\s*=\s*\d+/,
    "background.js must cap the fire log size (ring buffer)");
  assert.match(bg, /msg\?\.kind === "scripts\.firelog"/,
    "background.js must expose scripts.firelog reader");
  assert.match(bg, /msg\?\.kind === "scripts\.firelog\.clear"/,
    "background.js must expose scripts.firelog.clear");

  // Dashboard
  const html = read("scripts-manager/manager.html");
  assert.match(html, /data-tab="log"/, "dashboard must have a Run Log tab");
  assert.match(html, /id="pane-log"/,  "dashboard must have a #pane-log section");
  assert.match(html, /id="log-list"/,  "dashboard must have a #log-list tbody");
});

test("background.js omits empty excludeMatches from the registration", () => {
  // Empty arrays make some Chrome versions reject the whole register call.
  const bg = read("background.js");
  assert.match(bg, /if \(meta\.excludes\.length\) reg\.excludeMatches/,
    "background.js must omit excludeMatches when empty");
});

test("popup and modal both have a discoverable link to the userscript dashboard", () => {
  // Without a visible entry point, users have to right-click the extension
  // icon → Options. That's not discoverable.
  const html  = read("popup.html");
  const popJs = read("popup.js");
  const tmpl  = read("modal/content.template.js");

  assert.match(html,  /id="open-scripts"/, "popup.html must declare #open-scripts link");
  assert.match(popJs, /scripts-manager\/manager\.html/,
    "popup.js must open scripts-manager/manager.html on click");

  assert.match(tmpl, /data-act="open-scripts"/, "modal template must include open-scripts link");
  assert.match(tmpl, /kind: "open-scripts-manager"/,
    "modal must send open-scripts-manager message");

  // Background must handle it (and ignore the standalone command).
  const bg = read("background.js");
  assert.match(bg, /msg\?\.kind === "open-scripts-manager"/,
    "background.js must handle open-scripts-manager message");
});

test("userscript dashboard has Tampermonkey-style structure", () => {
  // 4 tabs (Installed / Settings / Utilities / Help), sortable Name column,
  // table view (not card view), filter input, banner.
  const html = read("scripts-manager/manager.html");
  for (const tab of ["installed", "log", "settings", "utilities", "help"]) {
    const re = new RegExp(`data-tab="${tab}"`);
    assert.match(html, re, `dashboard missing tab: ${tab}`);
    const paneRe = new RegExp(`id="pane-${tab}"`);
    assert.match(html, paneRe, `dashboard missing pane: ${tab}`);
  }
  assert.match(html, /class="scripts"/, "dashboard must use table layout (.scripts)");
  assert.match(html, /class="name sortable"/,    "Name column must be sortable");
  assert.match(html, /class="size sortable"/,    "Size column must be sortable");
  assert.match(html, /class="upd sortable"/,     "Last-updated column must be sortable");
  assert.match(html, /id="filter"/, "dashboard must have a filter input");
  assert.match(html, /class="banner"/, "dashboard must have a banner header");
});

test("modal content script embeds fonts inline (CSP-safe data: URIs, no network fetch)", () => {
  // Pre-v0.2.3 we used FontFace API + chrome.runtime.getURL, but that path
  // is subject to the host page's font-src CSP and silently failed on
  // strict sites. Now base64-inlined via scripts/build-modal.sh.
  const content = read("modal/content.js");
  assert.match(content, /url\(data:font\/woff2;base64,/,
    "modal must use base64 data: URIs in @font-face — bypasses host CSP");
  // Old FontFace path must be gone in the generated file too.
  assert.ok(!/new FontFace\(/.test(content),
    "modal must not use the FontFace API — replaced by inline data URIs");
});

test("fonts directory has the OFL license", () => {
  const lic = read("fonts/LICENSE");
  assert.match(lic, /SIL Open Font License/);
  assert.match(lic, /Share Tech Mono/);
  assert.match(lic, /Orbitron/);
});

test("manifest permissions are all referenced by background.js or popup.js", () => {
  const popupSrc = read("popup.js");
  const all = bgSrc + "\n" + popupSrc;
  const usage = {
    tabs:           /chrome\.tabs\./,
    tabGroups:      /chrome\.tabGroups\./,
    sessions:       /chrome\.sessions\./,
    bookmarks:      /chrome\.bookmarks\./,
    storage:        /chrome\.storage\./,
    scripting:      /chrome\.scripting\./,
    userScripts:    /chrome\.userScripts/,
    webNavigation:  /chrome\.webNavigation\./,
    clipboardWrite: /navigator\.clipboard\.writeText/
  };
  for (const perm of manifest.permissions) {
    assert.ok(usage[perm], `unknown permission in test mapping: ${perm}`);
    assert.match(all, usage[perm], `permission "${perm}" declared but never used`);
  }
});
