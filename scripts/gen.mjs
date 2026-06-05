// Single source of truth for the command list. Emits README.md,
// docs/index.html, and docs/report.html. Invoked by scripts/gen.sh and
// exercised in tests.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.env.ZPWR_ROOT;
if (!ROOT) {
  console.error("ZPWR_ROOT not set");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const cmds = Object.entries(manifest.commands);
const total = cmds.length;
const withKey = cmds.filter(([, v]) => v.suggested_key);
const userBound = total - withKey.length;
const version = manifest.version;

// Count tests dynamically by parsing each tests/*.test.js for `test(` calls.
const testDir = join(ROOT, "tests");
const testFiles = readdirSync(testDir).filter((f) => f.endsWith(".test.js"));
// Host crate version is read directly from Cargo.toml so the architecture
// diagram doesn't depend on environment ($npm_package_version) which only
// resolves under `npm test`. Without this the docs drift between local
// (where bash scripts/gen.sh is called bare) and CI (where npm test calls
// gen.sh with the env set).
const hostCrateVersion = (() => {
  try {
    const toml = readFileSync(join(ROOT, "zpwrchrome-host/Cargo.toml"), "utf8");
    const m = toml.match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : "";
  } catch {
    return "";
  }
})();

const testCount = testFiles.reduce((sum, f) => {
  const src = readFileSync(join(testDir, f), "utf8");
  return sum + (src.match(/^test\(/gm) || []).length;
}, 0);

// ---------------------------------------------------------------------------
// Live stats for docs/report.html. Everything below is derived from the
// repo state at gen time so the report cannot drift from reality.

const readFile = (rel) => readFileSync(join(ROOT, rel), "utf8");
const tryRead  = (rel) => { try { return readFile(rel); } catch { return null; } };
const lineCount = (s) => s == null ? 0 : s.split("\n").length;
const bytes     = (rel) => { try { return statSync(join(ROOT, rel)).size; } catch { return 0; } };

const SOURCES = [
  "background.js",
  "popup.js",
  "popup.html",
  "popup.css",
  "modal/content.template.js",
  "lib/util.js",
  "lib/fzf.js",
  "lib/userscript.js",
  "lib/gm-shim.js",
  "scripts-manager/manager.html",
  "scripts-manager/manager.js",
  "scripts-manager/manager.css",
];
const sourceLines = Object.fromEntries(SOURCES.map((p) => [p, lineCount(tryRead(p))]));
const totalJsLines  = ["background.js", "popup.js", "modal/content.template.js",
                       "lib/util.js", "lib/fzf.js", "lib/userscript.js",
                       "lib/gm-shim.js", "scripts-manager/manager.js"]
                       .reduce((s, p) => s + sourceLines[p], 0);
const totalCssLines = ["popup.css", "scripts-manager/manager.css"]
                       .reduce((s, p) => s + sourceLines[p], 0);
const totalHtmlLines = ["popup.html", "scripts-manager/manager.html"]
                       .reduce((s, p) => s + sourceLines[p], 0);
const totalTestLines = testFiles.reduce((s, f) => s + lineCount(tryRead("tests/" + f)), 0);

const bgSrc       = readFile("background.js");
const popupJs     = readFile("popup.js");
const modalTmpl   = readFile("modal/content.template.js");
const utilJs      = readFile("lib/util.js");

const popupCategories = [...popupJs.matchAll(/\{\s*id:\s*"([a-z]+)",\s*label:\s*"([^"]+)",\s*key:\s*"([^"]+)"\s*\}/g)]
  .map((m) => ({ id: m[1], label: m[2], key: m[3] }));
const modalCategories = [...modalTmpl.matchAll(/\{\s*id:\s*"([a-z]+)",\s*label:\s*"([^"]+)",\s*key:\s*"([^"]+)"\s*\}/g)]
  .map((m) => ({ id: m[1], label: m[2], key: m[3] }));

// Message kinds: every `msg?.kind === "..."` branch in background.js.
const bgKinds = [...new Set(
  [...bgSrc.matchAll(/msg\?\.kind === "([a-z][\w-]*(?::[a-z][\w-]*)?)"/g)].map((m) => m[1])
)].sort();
const popupKinds = [...new Set(
  [...popupJs.matchAll(/kind:\s*"([a-z][\w-]*(?::[a-z][\w-]*)?)"/g)].map((m) => m[1])
)].sort();
const modalKinds = [...new Set(
  [...modalTmpl.matchAll(/kind:\s*"([a-z][\w-]*(?::[a-z][\w-]*)?)"/g)].map((m) => m[1])
)].sort();

const dispatchHandlers = [...bgSrc.matchAll(/command === "([a-z][\w-]*)"/g)].map((m) => m[1]);

const permissions = manifest.permissions || [];

const utilExports = [...utilJs.matchAll(/^export (?:const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);

// Count files that are tracked in git — the canonical "Repo Files" stat
// that matches a fresh CI checkout. Walking the filesystem instead would
// drift the moment the dev ran `cargo build` (target/, ~2k files) or had
// an uncommitted .gitignored lockfile sitting around.
const totalFiles = (function countTracked() {
  try {
    const out = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" });
    return out.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
})();

// Top N source files by line count, biggest first.
const topFiles = [...SOURCES, ...testFiles.map((f) => "tests/" + f)]
  .map((p) => ({ path: p, lines: lineCount(tryRead(p)), bytes: bytes(p) }))
  .filter((x) => x.lines > 0)
  .sort((a, b) => b.lines - a.lines);

// ---------------------------------------------------------------------------
// README.md — strykelang-style: banner, badges, hex-indexed TOC, epigraphs.

const mdRow = ([name, v]) => {
  const k = v.suggested_key?.default || "*(user-set in `chrome://extensions/shortcuts`)*";
  return `| \`${name}\` | ${k} | ${v.description} |`;
};

const bannerLines = [
  " _____________          _______   _____ _    _ _____   ____  __  __ ______ ",
  "|___  /  __ \\ \\        / /  __ \\ / ____| |  | |  __ \\ / __ \\|  \\/  |  ____|",
  "   / /| |__) \\ \\  /\\  / /| |__) | |    | |__| | |__) | |  | | \\  / | |__   ",
  "  / / |  ___/ \\ \\/  \\/ / |  _  /| |    |  __  |  _  /| |  | | |\\/| |  __|  ",
  " / /__| |      \\  /\\  /  | | \\ \\| |____| |  | | | \\ \\| |__| | |  | | |____ ",
  "/_____|_|       \\/  \\/   |_|  \\_\\\\_____|_|  |_|_|  \\_\\\\____/|_|  |_|______|"
];
const bannerWidth = Math.max(...bannerLines.map((l) => l.length));
const banner = bannerLines.map((l) => l.padEnd(bannerWidth)).join("\n");

const readme = `\`\`\`
${banner}
\`\`\`

[![CI](https://github.com/MenkeTechnologies/zpwrchrome/actions/workflows/ci.yml/badge.svg)](https://github.com/MenkeTechnologies/zpwrchrome/actions/workflows/ci.yml)
[![Manifest](https://img.shields.io/badge/manifest-v3-05d9e8.svg)](manifest.json)
[![Commands](https://img.shields.io/badge/commands-${total}-ff2a6d.svg)](#0x02-keyboard-commands)
[![Theme](https://img.shields.io/badge/companion-theme-d300c5.svg)](theme/)
[![Docs](https://img.shields.io/badge/docs-online-05d9e8.svg)](https://menketechnologies.github.io/zpwrchrome/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### \`[THE BROWSER POWER-TOOL — PASS · DOWNLOADS · TABS · HISTORY · USERSCRIPTS]\`

> *"UNIX \`pass\` in the browser. Segmented download manager that owns the default. JetBrains-style tab switcher. fzf history. Tampermonkey-equivalent userscripts."*
>
> *"One extension, ${total} commands, zero compromises."*

## \`[CYBERPUNK HUD]\`

A Chrome MV3 extension that bundles six daily-driver tools into one toolbar icon: a browserpass-compatible UNIX \`pass\` integration (fill / copy / OTP / auto-submit / basic-auth injection / full-page CRUD manager / profile + credit-card autofill), a segmented multi-connection download manager that intercepts every browser download by default (HEAD probe + parallel \`Range\` GETs via a vendored Rust host), a JetBrains-style tab switcher with cross-window MRU + named scenes + opener-tree + minimap, an fzf-fuzzy search over up to ${5000} browser-history entries, a Tampermonkey-equivalent userscript engine, a full-page screenshot capture that scrolls the active tab and stitches the tiles into one PNG, and a Wappalyzer-compatible technology detector that fingerprints the active page against a vendored 3,993-tech corpus. ${userBound} commands bindable to keyboard shortcuts. Built by [MenkeTechnologies](https://github.com/MenkeTechnologies), Manifest V3, zero JS runtime dependencies.

### [\`Live Site\`](https://menketechnologies.github.io/zpwrchrome/) &middot; [\`Source\`](https://github.com/MenkeTechnologies/zpwrchrome) &middot; [\`Theme\`](theme/)

---

## Table of Contents

- [\\[0x00\\] Overview](#0x00-overview)
- [\\[0x01\\] Install](#0x01-install)
- [\\[0x02\\] Keyboard Commands](#0x02-keyboard-commands)
- [\\[0x03\\] Popup UI](#0x03-popup-ui)
- [\\[0x04\\] Tab Switcher Modal](#0x04-tab-switcher-modal)
- [\\[0x05\\] Companion Theme](#0x05-companion-theme)
- [\\[0x06\\] Architecture](#0x06-architecture)
- [\\[0x07\\] Capability Surface](#0x07-capability-surface)
- [\\[0x08\\] Files](#0x08-files)
- [\\[0x09\\] Tests](#0x09-tests)
- [\\[0x0A\\] CI](#0x0a-ci)
- [\\[0x0B\\] Regenerating Docs](#0x0b-regenerating-docs)
- [\\[0xFF\\] License](#0xff-license)

---

## [0x00] OVERVIEW

\`zpwrchrome\` is a Chrome MV3 extension that bundles six daily-driver capabilities into one toolbar icon: UNIX \`pass\` integration (with full-page CRUD manager + profile / credit-card autofill), a segmented download manager that takes over Chrome's default, a JetBrains-style tab switcher with fzf history search, a Tampermonkey-equivalent userscript engine, full-page screenshot capture, and a Wappalyzer-compatible technology detector. ${total} keyboard commands, a cyberpunk HUD popup, and a matching browser theme. Highlights:

- **MRU stack** — cross-window most-recently-used tracking via \`chrome.storage.session\`, survives service-worker restarts
- **Alt+T popup** — the cyberpunk HUD with 12 categories (All / Current Window / Pinned / Audible / Muted / Recently Closed / Scenes / Tree / Minimap / History / **Pass** / **Tech**), Cmd+1–0 jumps for the first ten, Cmd+P → Pass, Cmd+K → Tech, fzf scoring on every row
- **Cmd+E / Ctrl+E modal** — JetBrains-style Recent Files overlay: 2-column shadow-DOM modal injected into the active page with categories (All / Current Window / Pinned / Audible / Muted / Recently Closed), Cmd+1–6 category jumps, live filter, hold-cycle on the trigger key
- **Cmd+Y / Ctrl+Y history** — replaces Chrome’s built-in chrome://history page with an fzf-fuzzy search over up to ${5000} entries, Backspace deletes the highlighted URL from history
- **UNIX \`pass\` integration** — replaces browserpass via a vendored Rust native-messaging host that walks \`~/.password-store\` with eTLD+1 + multi-label PSL matching, shells to \`pass show\`/\`pass otp\`, returns credentials over a length-prefixed JSON port. PASS popup category with fill / user / pw / otp buttons. Hotkeys: \`pass-fill\` autofills the active tab via injected \`HTMLInputElement.value\` setter (React/Vue safe) + input/change dispatch; \`pass-copy-{pw,user,otp}\` write to clipboard with 45 s auto-clear matching \`pass -c\`
- **Full-page pass manager** — \`scripts-manager/pass.html\` (toolbar right-click → "Open pass manager" or popup → \`pass ▸\`). Two-pane CRUD on \`~/.password-store\`: store tree (left, filter + ↑↓/Enter) + entry editor (right) with show/hide password, password generator, copy buttons per row, OTP-code copy via host, fill-active-tab, k/v list for non-synonym fields, free-form notes, delete with confirm scrim. \`⚙ raw\` toggle drops to a verbatim file-bytes textarea — escape hatch for entries with non-standard schemas. URL row auto-derives from the first path segment (\`adobe.com/jmenke@wccnet.edu\` → \`adobe.com\`) when no explicit \`url:\` key is present
- **Profile + credit-card autofill from \`pass\`** — two new commands: \`pass-fill-profile\` fills name / address / email / phone / etc. on the active tab from \`profile/<name>\` entries; \`pass-fill-cc\` fills card-number / exp / csc / cardholder from \`creditcard/<name>\` entries. Entry keys can be either the WHATWG HTML autocomplete tokens (\`given-name\`, \`street-address\`, \`postal-code\`, \`cc-exp-month\`, …) **or** friendly synonyms (\`first-name\`, \`address\`, \`city\`, \`state\`, \`zipcode\`, \`cvv\`, …) — both resolve to the same field. Field recognition: \`<input autocomplete=…>\` wins outright (composite forms like \`shipping street-address\` supported), then longest-synonym substring across name+id+label+placeholder (cvv/cvc/csc → cc-csc, first-name/fname → given-name, zip/postcode → postal-code), then \`<input type="email|tel">\`. Alias chains backfill: \`cc-exp\` ← month/year, \`name\` ← given+family, given/family ← split of \`name\`, \`street-address\` ← line1+line2+line3. Multi-entry stores get an in-tab shadow-DOM picker (filter input, last-used cached per host). Example \`profile/personal.gpg\` body — first line is a free-form label, the rest are friendly key:value pairs:

\`\`\`text
personal
given-name: Jacob
family-name: Menke
email: jane.doe@example.com
phone: +15551234
address: 123 Main St
city: Springfield
state: IL
zipcode: 62701
country: US
\`\`\`

And \`creditcard/visa.gpg\`:

\`\`\`text
visa
cc-name: Jane Doe
cc-number: 4111 1111 1111 1111
cc-exp-month: 09
cc-exp-year: 2031
cvv: 123
\`\`\`

- **Segmented download manager** — same Rust host vendors a multi-connection downloader (HEAD probe → N parallel \`Range\` segments, default 4, pre-allocated dest file). Cookie + User-Agent forwarded from \`chrome.cookies.getAll\` so logged-in downloads work; transient errors retry with 200 ms × 3ⁿ backoff and resume via \`Range\` from the segment-local offset; queue mirrored to \`chrome.storage.local\` so the UI paints instantly across service-worker restarts. Right-click \`Download with zpwrchrome\` on links / images / video / audio; \`dl-paste-url\` reads the clipboard via injected \`navigator.clipboard.readText\`. Live queue UI at \`scripts-manager/downloads.html\` subscribes to host push events. Filename collisions auto-rename \`foo.zip\` → \`foo (1).zip\`. Pure-Rust, vendorable TLS (\`ureq\`+rustls), no \`aria2\` or other runtime binary
- **Full-page screenshot** — \`screenshot-full-page\` command (or right-click toolbar icon → "Full-page screenshot (this tab)") captures the active tab edge-to-edge, including parts off-screen. Strategy: scroll the page in viewport-sized steps with a 200 px overlap, capture each viewport via \`chrome.tabs.captureVisibleTab\` (Chrome's hard ~2 Hz quota → 600 ms gap + exponential-backoff retry: 1.1 s → 2.5 s → 5 s), pin every \`position: fixed\` / \`sticky\` element to \`static\` during capture so stickies don't appear N times, stitch tiles on an \`OffscreenCanvas\` in the SW, stream the PNG to the host in 512 KiB base64 chunks via \`dl.writeFileChunk\` (Chrome's host → ext native-messaging cap is 1 MiB), then rename the upload \`.part\` file to the chosen filename in your downloads dir. Hard caps: 60 tiles, ~16k × 16k output pixels. No \`chrome.debugger\` permission required (so no permanent yellow "DevTools attached" banner)
- **Wappalyzer-compatible technology detection** — \`lib/wappalyzer/engine.js\` runs the vendored 3,993-fingerprint HTTPArchive/wappalyzer corpus (\`lib/wappalyzer/data/technologies.json\`, GPL-3 isolated under \`LICENSE-WAPPALYZER\`; engine code stays MIT). On every main_frame navigation: \`webRequest.onCompleted\` captures response headers per tabId; \`webNavigation.onCompleted\` injects \`scrapeSignals\` to harvest HTML / scripts / meta / cookies / window globals + pre-flights all 1,045 unique dom-selector rules in one pass; \`detect()\` runs the merged signals against the compiled corpus, implementing every matcher group (html / scripts / scriptSrc / text / url / meta / headers / cookies / js / dom — exists, text, attributes, properties) + implies/requires/excludes graph rewrites + \`\\\\;version:\\\\1\` backref resolution. The match count shares one toolbar badge with downloads + pass via \`applyMultiplexedBadge\` (see below); Cmd+K from the popup jumps to the 12th \`Tech\` category; \`⤓ Export\` ships the detected stack as JSON (filename \`tech-<host>-<iso>.json\`). \`scripts/vendor-wappalyzer.sh\` re-runs the corpus merge from a fresh upstream clone
- **Three-channel toolbar badge** — single Chrome action badge multiplexes downloads (cyan), tech detection (orange), and pass matches (magenta). The visible NUMBER is the dominant counter by priority (downloads → tech → pass) and the COLOR follows it. Trailing letter tags spell out which other counters are coexisting: \`t\` = tech also detected, \`l\` = login (pass) also matching. So a tab with 10 active downloads + 5 tech + 2 pass renders \`10tl\`; 5 tech + 2 pass renders \`5l\`; 2 pass alone renders \`2\`. Tooltip spells out the plain-English breakdown for any state. \`refreshActiveTabBadge\` is the one orchestrator that repaints on \`chrome.tabs.onActivated\` + \`chrome.tabs.onUpdated\`
- **${userBound} user-bindable commands** — Chrome caps default-suggested at 4; everything else binds at \`chrome://extensions/shortcuts\` (single-tab ops, batch ops, numeric jumps, clipboard utilities, pass-* + dl-*)
- **Sub-popup live filter** — type to filter open + closed tabs; \`↑\`/\`↓\`/\`Enter\`/\`Delete\`/\`Esc\` nav
- **Turn off the lights (cinema mode)** — \`modal/lights-off.js\` injects a full-viewport near-black overlay over the active tab and lifts every visible \`<video>\` element (with its entire ancestor chain) above the overlay via \`z-index\`. Trigger via the \`lights-off\` command, the toolbar context menu \`Turn off the lights (this tab)\`, or popup → \`lights ▸\`. Click the overlay or press Esc to undim. Settings UI at \`scripts-manager/lights-off.html\` (opacity 0–1, fade duration ms, overlay color, per-host blocklist/allowlist). Port of the Turn Off the Lights Chrome extension
- **Cyberpunk page-theme injector** — \`modal/cyber-theme.js\` runs at \`document_start\` on every http(s) tab and paints arbitrary pages with the strykelang HUD palette. Settings UI at \`scripts-manager/theme-injector.html\` (toolbar right-click → "Open theme injector" or popup → \`theme ▸\`). Knobs: **intensity** (subtle = links + headings + scrollbars only / medium = + body bg + form fields + code blocks / full = + tables, cards, dimmed images), **dark mode** (smart overlay — \`color-scheme: dark\` + targeted overrides for common white-card patterns: AUI \`.a-box\` / \`.order-header\` / \`.delivery-box\` / \`.bia-content\`, generic \`[class*="card|panel|widget"]\`, ARIA dialogs, inline \`background: white|#fff|rgb(255,…)\`; deliberately NOT \`filter: invert()\` so already-dark pages stay dark), **forceMono** (Share Tech Mono everywhere — exempts icon-font carriers \`<i>\` / \`<svg>\` / \`[class*="icon|fa-|material-icons|material-symbols|lucide|phosphor|glyphicon"]\` / \`[data-icon|data-lucide|data-cds="Icon"|data-radix-icon]\` so Anthropicons, Material Symbols, Lucide, etc. keep their glyphs instead of rendering as PUA tofu), and **scanlines** (CRT overlay via \`body::after\`). Per-host blocklist / allowlist via the textarea; settings broadcast to every tab over \`chrome.storage.onChanged\`
- **Companion Chrome theme** — \`theme/\` paints frame/toolbar/omnibox/NTP with the strykelang HUD palette
- **Strykelang HUD aesthetic** — palette and animations sourced from \`strykelang/docs/hud-static.css\` (\`--cyan #05d9e8\`, \`--accent #ff2a6d\`, \`--magenta #d300c5\`, CRT scanlines, neon-border-glow card frames)
- **Pure-helper test surface** — MRU stack semantics, hostname parsing, jump-index resolution in \`lib/util.js\` + pass match/parse + dl filename/collision helpers in \`zpwrchrome-host/src/{ported,extensions}/\` all unit-tested without a Chrome runtime
- **Single source of truth** — \`README.md\`, \`docs/index.html\`, and command counts are all generated from \`manifest.json\` by \`scripts/gen.sh\`; CI guards against drift
- **Zero JS runtime dependencies** — no bundler, no transpiler, no npm modules at runtime; pure ES module service worker. The native host adds \`serde\`/\`serde_json\`/\`ureq\` (foundational pure-Rust crates) and ships as a single static binary

---

## [0x01] INSTALL

\`\`\`sh
git clone https://github.com/MenkeTechnologies/zpwrchrome.git
\`\`\`

#### Extension

1. Open \`chrome://extensions\`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**, pick the cloned directory
4. Open \`chrome://extensions/shortcuts\` to bind any of the ${userBound} user-configurable commands

#### Native messaging host (required for \`pass\`, downloads, screenshots)

1. Install GPG + \`pass\` if you want the password-store integration (\`brew install pass\` on macOS, \`apt install pass\` on Debian/Ubuntu); make sure \`pass show\` decrypts an entry from your shell first. (Skip if you only want downloads + screenshots.)
2. Install the host binary from crates.io and register it for this extension's ID:

\`\`\`sh
cargo install zpwrchrome-host
# find your extension ID at chrome://extensions (Developer mode), then:
zpwrchrome-host --install <ext-id>
\`\`\`

The installer writes \`com.menketechnologies.zpwrchrome.json\` into every detected Chromium-family browser config dir (Chrome / Chromium / Brave / Edge / Arc / Vivaldi on macOS + Linux). \`allowed_origins\` is populated with \`chrome-extension://<ext-id>/\` so the browser will only spawn the host for this extension. Reload the extension at \`chrome://extensions\` after running it.

To upgrade later: \`cargo install zpwrchrome-host --force\` — the NM manifest already points at \`$CARGO_HOME/bin/zpwrchrome-host\` so no re-install is needed.

#### Theme

1. **Load unpacked** the \`theme/\` subdirectory (separate Chrome extension — themes cannot be bundled with action extensions)
2. \`chrome://settings/appearance\` → **Reset to default** to remove

---

## [0x02] KEYBOARD COMMANDS

Chrome’s MV3 manifest allows at most **4** commands with default-suggested keys; the rest are bound by the user at \`chrome://extensions/shortcuts\`. \`zpwrchrome\` ships **${withKey.length}** default-keyed and **${userBound}** user-bindable, for **${total} total** — covering pass actions, download manager, tab switcher, history search, and userscript management.

| Command | Default | Description |
| --- | --- | --- |
${cmds.map(mdRow).join("\n")}

---

## [0x03] POPUP UI

The popup (\`popup.html\` / \`popup.css\` / \`popup.js\`) is a 520×600 cyberpunk HUD with two stacked lists:

- **Open // MRU** — every open tab, in most-recently-used order
- **Recently Closed** — last 25 closed tabs/windows via \`chrome.sessions\`

Keyboard nav inside the popup:

| Key | Action |
| --- | --- |
| any character | live-filter by title / URL / hostname |
| \`↑\` / \`↓\` | move selection |
| \`Enter\` | switch to open tab, or restore closed tab |
| \`Delete\` / \`Shift+Backspace\` | close highlighted open tab |
| \`Esc\` | clear filter, or close popup |

Click any row to activate it. Hover reveals a \`×\` icon to close.

---

## [0x04] TAB SWITCHER MODAL

JetBrains IDEs have a Recent Files modal (\`Cmd+E\` on Mac). \`zpwrchrome\` ports the same UX to Chrome: a full-page shadow-DOM overlay injected into the active tab, with categories on the left and the live tab list on the right.

| Key | Action |
| --- | --- |
| \`Cmd+E\` / \`Ctrl+E\` | open the modal — and, while open, cycle MRU forward |
| \`Cmd+Shift+E\` / \`Ctrl+Shift+E\` | cycle MRU backward (when modal is open) |
| \`Cmd+1\` … \`Cmd+6\` | jump to category (All / Current Window / Pinned / Audible / Muted / Recently Closed) |
| \`↑\` / \`↓\` | move selection |
| \`Enter\` | switch to / restore selection |
| \`Delete\` / \`Shift+Backspace\` | close the highlighted open tab in place |
| \`Esc\` | dismiss without activating |
| any letter | live-filter by title / URL / hostname |

Implementation: \`modal/content.js\` is a content script registered on \`<all_urls>\` (excluded from the Chrome Web Store, which rejects all extensions). It builds the modal inside a closed shadow root so host-page CSS can never leak in. Visuals are the strykelang HUD palette inline-rendered into a \`<style>\` block. On restricted pages (\`chrome://\`, \`view-source://\`, the Web Store) the command transparently falls back to the regular action popup.

---

## [0x05] COMPANION THEME

The \`theme/\` directory ships a separate Chrome theme. Same strykelang palette as the popup, applied to the browser frame, toolbar, omnibox, and new-tab page.

| Theme image | Resolution | Purpose |
| --- | --- | --- |
| \`theme_ntp_background.png\` | 3840×2400 | New-tab-page background (4K-ready) — grid + radial gradients + HUD corner brackets |
| \`theme_frame.png\` | 1920×120 | Window-frame strip — gradient + cyan→accent seam |
| \`theme_toolbar.png\` | 1920×80 | Toolbar background |

Color anchors (RGB triplets in \`theme/manifest.json\`):

| Slot | Hex | RGB | Strykelang variable |
| --- | --- | --- | --- |
| \`frame\` / \`ntp_background\` | \`#05050a\` | [5, 5, 10] | \`--bg-primary\` |
| \`toolbar\` / \`omnibox_background\` | \`#0a0a14\` | [10, 10, 20] | \`--bg-secondary\` |
| \`bookmark_text\` / \`ntp_link\` | \`#05d9e8\` | [5, 217, 232] | \`--cyan\` |
| \`ntp_header\` | \`#ff2a6d\` | [255, 42, 109] | \`--accent\` |
| \`tab_text\` / \`ntp_text\` | \`#e0f0ff\` | [224, 240, 255] | \`--text\` |

---

## [0x06] ARCHITECTURE

\`\`\`
   chrome.tabs        ┌──────────────────────────┐    chrome.storage
   onActivated ──────▶│  background.js (sw)      │◀──── .session (MRU)
   onRemoved          │  ──────────────────────  │      .local (scenes,
   onReplaced         │  pushMru / dropFromMru   │             userscripts,
                      │  command dispatcher      │             dl.snapshot)
   chrome.commands ──▶│  message API             │
                      │  nmCall / nmPort         │
                      │  contextMenus / cookies  │
                      └────────────┬─────────────┘
                                   │
                  ┌────────────────┼─────────────────┐
                  │                │                 │
                  │ runtime.       │ connectNative   │ scripting.
                  │ sendMessage    │ (NM port)       │ executeScript
                  ▼                ▼                 ▼
        ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
        │ popup.{js,css,   │ │ zpwr-chrome-host │ │ active tab:      │
        │ html}            │ │ (Rust binary)    │ │ • pass-fill      │
        │ ──────────────── │ │ ──────────────── │ │   injector       │
        │ MRU + 10 tab cat │ │ frame.rs (LE32+  │ │   (native value  │
        │ + PASS category  │ │   JSON, ≤1 MiB)  │ │   setter, R/V/L  │
        │ Cmd+1–0 jumps    │ │ proto.rs (id/    │ │   safe)          │
        │ fzf scoring      │ │   kind/op/args)  │ │ • dl-paste-url:  │
        └──────────────────┘ │ dispatch.rs      │ │   clipboard read │
                             │   → pass: list/  │ │ • writeClipboard │
        ┌──────────────────┐ │     match/fetch/ │ │   (copy hotkeys) │
        │ scripts-manager/ │ │     otp          │ └──────────────────┘
        │ downloads.{html, │ │   → dl:   add/   │
        │ css,js}          │◀│     list/pause/  │      ┌────────────┐
        │ ──────────────── │ │     resume/      │      │ ureq+rustls│
        │ live queue UI    │ │     cancel       │─────▶│ HEAD + N×  │
        │ subs to push     │ │ push events      │      │ Range GET  │
        │   events (id=0)  │ │   id=0 / 200ms   │      │ +retry/200 │
        │ rehydrates from  │ └──────────────────┘      │ ×3ⁿ backoff│
        │   dl.snapshot    │          │                └────────────┘
        └──────────────────┘          │                       │
                                      │ shells to             │ writes
                                      ▼                       ▼
                          ┌─────────────────────┐    ┌──────────────────┐
                          │ pass / gpg / pinentry│    │ ~/Downloads/     │
                          │ ~/.password-store/   │    │   zpwrchrome/    │
                          └─────────────────────┘    │ (pre-allocated   │
                                                     │  N-segment file) │
                                                     └──────────────────┘
\`\`\`

The service worker holds no globals — MRU lives in \`chrome.storage.session\`. Pure helpers in \`lib/util.js\` (JS) and \`zpwrchrome-host/src/{ported,extensions}/\` (Rust) carry no Chrome / Process references and are unit-tested in plain Node / \`cargo test\`. The native host is the Rust port of \`browserpass-native\` v3.1.2 plus three extension actions (\`otp\`, \`search\`, \`dl.*\`); each request spawns a fresh process (BP protocol) with download workers detaching to keep state under \`$XDG_CACHE_HOME/zpwrchrome/dl/\`.

---

## [0x07] CAPABILITY SURFACE

zpwrchrome is six daily-driver tools in one extension. Each row names a capability and what replaces / supersedes in the typical browser power-user stack.

| Capability | Replaces / supersedes | Implementation |
| --- | --- | --- |
| UNIX \`pass\` integration (fill / copy / OTP / open URL / basic-auth injection) | [browserpass-extension](https://github.com/browserpass/browserpass-extension) | client-side eTLD+1 + multi-label PSL match, server-side via the [zpwrchrome-host](https://crates.io/crates/zpwrchrome-host) Rust crate (PROTOCOL.md v3.1.2 compatible — drop-in for the Go binary) |
| Full-page \`pass\` manager (CRUD on \`~/.password-store\`) | upstream browserpass-extension's options page · the standalone \`pass\` TUI · 1Password / Bitwarden vault UIs (for the GPG-backed flow) | \`scripts-manager/pass.{html,css,js}\` — store tree (left) + form editor (right) talking to the BP \`list\` / \`fetch\` / \`save\` / \`delete\` actions over NM. Versioned alongside the extension; no separate install |
| Profile + credit-card autofill from \`pass\` (\`profile/*\` + \`creditcard/*\` entries) | Chrome's built-in autofill profiles · 1Password / Bitwarden card filler | \`lib/identity-tokens.js\` + page-injected \`fillIdentityForm()\`. Entry keys use WHATWG HTML autocomplete tokens directly — the store IS the schema. Longest-synonym recognition; alias chains backfill missing tokens; React/Vue-safe native value-setter pattern across all frames; in-tab shadow-DOM picker with last-used cache per host |
| Segmented multi-connection download manager (default-handler takeover) | Chrome's built-in download UI · Chrono / IDM-style extensions · \`aria2c\` | HEAD probe + N parallel \`Range\` GETs, cookies + User-Agent forwarded, retry with backoff, file-state worker model, full sidebar-nav queue page |
| JetBrains-style tab switcher (MRU + scenes + opener-tree + minimap) | [Recent Tabs by Jason Savard](https://jasonsavard.com/wiki/Recent_Tabs) · OneTab · Workona | cross-window MRU via \`chrome.storage.session\`, Alt+T popup with 12 categories, Cmd+E modal overlay, fzf scoring on every row, batch tab ops + clipboard utilities |
| Wappalyzer-compatible technology detection | [Wappalyzer](https://www.wappalyzer.com/) · BuiltWith · Stack Inspector | \`lib/wappalyzer/engine.js\` runs the vendored 3,993-fingerprint HTTPArchive/wappalyzer corpus (\`lib/wappalyzer/data/technologies.json\`, GPL-3 isolated under \`LICENSE-WAPPALYZER\`). Every matcher type implemented: html / scripts / scriptSrc / text / url / meta / headers / cookies / js / dom (exists + text + attributes + properties). Implies / requires / excludes graph rewrites. Cmd+K from the popup, ⤓ Export to JSON, three-channel toolbar badge with letter tags (\`10tl\` = 10 downloads + tech + login matches) |
| fzf history search | Chrome's \`chrome://history\` page · the omnibox | re-ranks \`chrome.history.search\` results by frecency, up to ${5000} entries, Backspace deletes inline |
| Tampermonkey-equivalent userscript engine | Tampermonkey · Greasemonkey · Violentmonkey | \`@metadata\` block parser, \`@match\` pattern compilation, full GM_* shim (getValue/setValue/openInTab/setClipboard/notification), fire-log ring buffer |
| Full-page screenshot (off-screen content included, no debugger banner) | GoFullPage · FireShot · Awesome Screenshot | \`lib/screenshot.js\` — scroll + viewport-capture + \`OffscreenCanvas\` stitch in the SW. Sticky/fixed elements pinned to \`position: static\` during capture. PNG streamed to the host via chunked \`dl.writeFileChunk\` (Chrome's 1 MiB host → ext NM cap), lands in your configured downloads dir |

### Counts & invariants

| | |
| --- | --- |
| Total chrome.commands | **${total}** (manifest cap on default keys is 4 — this ext ships ${withKey.length}; the other ${userBound} are user-bindable at \`chrome://extensions/shortcuts\`) |
| Manifest | **MV3** |
| License | **MIT** |
| Test suite | **${testCount}** \`node:test\` cases (JS) + 102 \`cargo test\` cases (Rust) |
| Generator + doc-drift CI | Yes — README + landing page regenerated from \`manifest.json\` by \`scripts/gen.sh\`; CI fails on drift |
| Runtime deps | Zero on the JS side (pure ES-module SW). The Rust host adds \`serde\` / \`serde_json\` / \`ureq\` (foundational pure-Rust crates) and ships as a single static binary |

---

## [0x08] FILES

| Path | Purpose |
| --- | --- |
| \`manifest.json\` | MV3 manifest, command registry (the only source of truth) |
| \`background.js\` | Service worker — MRU tracker, command dispatcher, popup message API, NM port (\`nmCall\`/\`nmAddEventListener\`), pass-fill injector, clipboard auto-clear, context-menu \`Download with zpwrchrome\`, \`enrichDownloadArgs\` (cookie + UA forwarding), \`dl.snapshot\` mirror, \`passFillIdentityActive\` profile/CC dispatcher, in-tab shadow-DOM picker, \`fillIdentityForm\` token-driven page injector |
| \`lib/util.js\` | Pure helpers — \`mruPush\`/\`mruDrop\`/\`mruStep\`/\`mruPrevious\`/\`hostnameOf\`/\`resolveJumpIndex\` |
| \`lib/bp-pass.js\` | Pure pass helpers — \`parseEntry\` / \`fallbackUsernameFromPath\` / \`fallbackUrlFromPath\` / \`matchIn\` / eTLD+1 \`candidates\` |
| \`lib/pass-entry.js\` | Pure pass-entry serializer — \`formatEntry\` (inverse of \`parseEntry\`), \`validatePassPath\`, \`buildTree\` |
| \`lib/identity-tokens.js\` | Profile + credit-card autofill — \`PROFILE_TOKENS\` / \`CC_TOKENS\` (WHATWG HTML autocomplete vocabulary), \`TOKEN_SYNONYMS\` (longest-match recognition), \`recognizeField\`, \`expandFieldValue\` (alias chains: cc-exp ↔ month/year, name ↔ given/family, street-address ↔ line1/2/3) |
| \`popup.html\` / \`popup.css\` / \`popup.js\` | Cyberpunk HUD popup with 12 categories including PASS (fill/user/pw/otp buttons) + TECH (Wappalyzer detection) + \`pass ▸\` link to the full-page pass manager |
| \`lib/wappalyzer/engine.js\` | Pure-JS Wappalyzer-compatible detection engine — pattern compilation, every signal-group matcher, \`\\\\;version:\\\\1\` backref resolution, implies/requires/excludes graph rewrites, page-side \`scrapeSignals\` injection |
| \`lib/wappalyzer/data/technologies.json\` + \`categories.json\` | Vendored 3,993-fingerprint upstream corpus (HTTPArchive/wappalyzer, GPL-3 — see \`LICENSE-WAPPALYZER\` adjacent). \`scripts/vendor-wappalyzer.sh\` re-runs the merge from a fresh upstream clone |
| \`scripts-manager/pass.{html,css,js}\` | Full-page pass manager — store tree (left) + entry editor (right); CRUD via the BP \`list\` / \`fetch\` / \`save\` / \`delete\` actions; raw-bytes textarea toggle; URL row auto-derives from the first path segment when no \`url:\` key is present |
| \`modal/content.js\` | JetBrains-style Recent Tabs modal — content script, shadow DOM, 2-column layout |
| \`scripts-manager/manager.{html,css,js}\` | Userscript engine dashboard (Tampermonkey-equivalent) |
| \`scripts-manager/downloads.{html,css,js}\` | Live download queue UI — push-event subscription + cached snapshot rehydration |
| \`scripts-manager/theme-injector.{html,css,js}\` + \`lib/cyber-theme-css.js\` + \`modal/cyber-theme.js\` | Cyberpunk page-theme injector — \`color-scheme: dark\` + targeted overrides for white-card patterns + intensity / forceMono / scanlines knobs. Settings persisted under \`chrome.storage.local["theme.injector"]\` and broadcast to every tab via \`storage.onChanged\` |
| \`scripts-manager/lights-off.{html,css,js}\` + \`lib/lights-off-css.js\` + \`modal/lights-off.js\` | Turn-off-the-lights cinema dimmer — full-viewport overlay + \`<video>\` lifted above via \`z-index: 2147483647\`. Click overlay or Esc to undim; per-host block/allowlist; settings under \`chrome.storage.local["lights.off"]\` |
| \`scripts-manager/ua-switcher.{html,css,js}\` + \`lib/ua-presets.js\` | User-Agent switcher — 16 vendor-shipped presets across 6 families plus a custom UA field. Backed by a single \`chrome.declarativeNetRequest\` dynamic rule (id 1001) that rewrites the \`User-Agent\` request header |
| \`scripts-manager/find-all.{html,css,js}\` + \`lib/find-snippet.js\` | Find-in-all-tabs — fzf-fuzzy search across every open tab's \`innerText\` (parallel scrape capped at 200 KB / tab). Enter activates the chosen tab and scrolls to the match via \`window.find()\` |
| \`modal/json-viewer.js\` + \`lib/json-format.js\` | Auto-detects JSON-served pages and replaces \`<pre>\` with a collapsible tree (RFC 6901 pointer copy, prettyPrint / minify toggles, clipboard with \`execCommand\` fallback for non-secure contexts) |
| \`zpwrchrome-host/Cargo.toml\` / \`zpwrchrome-host/src/{lib,frame}.rs\` + \`src/ported/**\` + \`src/extensions/**\` + \`src/bin/zpwrchrome_host.rs\` | Rust port of \`browserpass-native\` v3.1.2 + extension actions (\`otp\`, \`search\`, \`dl.*\`) over length-prefixed JSON on stdio. Strict 1:1 port discipline (per-fn citations, Go comment carry-over) — see \`zpwrchrome-host/docs/port_report.html\` |
| \`zpwrchrome-host --install <ext-id>\` (CLI flag on the binary, not a separate script) | Writes \`com.menketechnologies.zpwrchrome.json\` into every detected Chromium-family browser config dir on macOS / Linux. \`allowed_origins\` is set to \`chrome-extension://<ext-id>/\` so the browser will only spawn the host for this extension |
| \`zpwrchrome-host/tests/ported_*.rs\` + \`extensions_*.rs\` | \`cargo test\` suite — per-fn pins for the port + extensions, end-to-end binary spawn tests, segmented download against a local HTTP fixture |
| \`docs/index.html\` | GitHub-Pages landing page (regenerated from manifest) |
| \`docs/report.html\` | Strykelang-style engineering report (regenerated from repo stats) |
| \`theme/\` | Companion Chrome theme — separate unpacked extension |
| \`icons/icon.svg\` + \`icon{16,32,48,128}.png\` | Extension icons; PNGs rasterized via \`rsvg-convert\` |
| \`scripts/gen.sh\` + \`scripts/gen.mjs\` | Regenerate \`README.md\` and \`docs/index.html\` from \`manifest.json\` |
| \`tests/\` | \`node:test\` suite — pure logic + static invariants + theme + protocol + pass / dl integration |
| \`.github/workflows/ci.yml\` | GitHub Actions — \`npm test\` on push/PR across Node 20 + 22 |
| \`package.json\` | \`npm test\` script |

---

## [0x09] TESTS

\`\`\`sh
npm test
\`\`\`

Stock Node ≥ 20, no external dependencies. ${testCount} tests across ${testFiles.length} files. Covers:

- **Pure logic** (\`tests/logic*.test.js\`, \`tests/util-*.test.js\`) — MRU stack semantics (prepend, dedup, cap, wrap, no-mutate, large-|delta| double-mod), hostname parse, jump-index resolution, scene CRUD, opener-tree forest (iterative flatten — handles 50k-deep chains without stack overflow), domain hue distribution, frecency formula
- **fzf scoring** (\`tests/fzf*.test.js\`) — match algorithm correctness, scoring constants (BOUNDARY ≥ NON_WORD ≥ CAMEL > CONSECUTIVE > 0), highlight integration (indices spell needle case-insensitively, HTML escape preserved inside marks), ranking stability over realistic filter passes
- **Userscript parser** (\`tests/userscript*.test.js\`, \`tests/parseMetadata-*.test.js\`, \`tests/matchPatternToRegex-*.test.js\`) — Tampermonkey/Greasemonkey metadata block parsing, match-pattern compilation per Chrome's spec (file/ftp/* scheme handling), validate→register→matchUrl pipeline roundtrip
- **GM_*/GM.* shim** (\`tests/gm-shim*.test.js\`, \`tests/gm-background.test.js\`) — every GM_* alias and gm:* message wiring against the background.js dispatcher
- **Fuzz** (\`tests/fuzz-*.test.js\`) — deterministic-PRNG sweeps over fzfMatch, util helpers, parseMetadata; adversarial inputs (regex metachars, nested markers, 100k-char values, pathological *.host patterns); Monte Carlo scene CRUD against a Map+order-list oracle
- **Stress** (\`tests/stress-*.test.js\`) — time budgets for keystroke-hot paths (10k fzfMatch < 1s, 100k mruPush < 2s, 500-item filter pipeline < 200ms); scale (1M mruPush, 10k-deep tree, 50k buildScene churn, 10k-pattern matchUrl); pathological inputs (all-same-char haystacks, 50k-char fzf, 60k-char rejection in O(haystack))
- **Static manifest invariants** (\`tests/static.test.js\`) — MV3, ≤4 suggested keys (Chrome ceiling), no macOS/Chrome-reserved defaults, no key collisions, kebab-case command names, every manifest command has a \`background.js\` handler and vice versa, every referenced file exists with correct PNG dimensions, popup HTML has no inline event handlers or inline \`<script>\` (MV3 CSP), strykelang palette intact in popup.css and docs/index.html, every declared permission is actually used in code, README + docs/index.html stay byte-identical after re-running \`scripts/gen.sh\`
- **Theme invariants** (\`tests/theme.test.js\`) — MV3 + \`theme\` block, no \`action\`/\`background\` (Chrome rejects mixed manifests), all theme images are PNGs at declared dimensions, every color is a 0–255 integer triplet, strykelang palette anchors pinned, version conforms to Chrome's 1–4-part 0–65535 rule
- **Popup ↔ background protocol** (\`tests/protocol.test.js\`) — every message \`kind\` sent by \`popup.js\` is handled by \`background.js\` and vice versa, no orphans on either side
- **Build pipeline** (\`tests/build.test.js\`, \`tests/gen-pipeline.test.js\`) — UTIL_INLINE/FZF_INLINE markers present + balanced, build-modal.mjs strips \`export \` correctly, generated banner pinned, gen.sh counts tests dynamically

---

## [0x0A] CI

\`.github/workflows/ci.yml\` runs \`npm test\` on every push and pull-request. Matrix: Node \`20\` + \`22\` on \`ubuntu-latest\`. The doc-drift test (re-run \`scripts/gen.sh\` and compare) catches stale README / landing page in the same job.

\`\`\`yaml
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        node: [20, 22]
\`\`\`

CI badge at the top of this README.

---

## [0x0B] REGENERATING DOCS

\`README.md\` and \`docs/index.html\` are derived from \`manifest.json\`. Refresh both with:

\`\`\`sh
scripts/gen.sh
\`\`\`

CI re-runs the same generator and fails the build if either file is not byte-identical to what \`gen.sh\` emits, so stale docs can never land on \`main\`.

---

## [0xFF] LICENSE

MIT — see [\`LICENSE\`](LICENSE).

---

\`\`\`
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░ >>> TRACK MRU. SWITCH FAST. CYBERPUNK HUD. OWN YOUR BROWSER. <<< ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
\`\`\`

##### created by [MenkeTechnologies](https://github.com/MenkeTechnologies)
`;

writeFileSync(join(ROOT, "README.md"), readme);

// ---------------------------------------------------------------------------
// docs/index.html

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const htmlRow = ([name, v]) => {
  const key = v.suggested_key?.default;
  const cls = key ? "default" : "user-set";
  const cell = key ? `<kbd>${escape(key)}</kbd>` : `<span class="muted">user-set</span>`;
  return `        <tr class="${cls}">
          <td><code>${escape(name)}</code></td>
          <td>${cell}</td>
          <td>${escape(v.description)}</td>
        </tr>`;
};

const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>zpwrchrome — browser power-tool (pass · downloads · tabs · history)</title>
  <meta name="description" content="Chrome extension: UNIX \`pass\` integration, segmented download manager (Chrome default takeover), JetBrains-style tab switcher, fzf history search, Tampermonkey-equivalent userscripts. ${total} keyboard commands. Cyberpunk HUD by MenkeTechnologies.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;900&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <style>
    /* Palette + animations lifted from strykelang docs/hud-static.css. */
    html { color-scheme: dark; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ::selection { background: rgba(5, 217, 232, 0.3); color: #fff; }
    :root {
      --bg-primary: #05050a; --bg-secondary: #0a0a14; --bg-card: #0d0d1a;
      --bg-hover: #12122a;
      --accent: #ff2a6d; --accent-light: #ff6b9d; --accent-glow: rgba(255, 42, 109, 0.4);
      --cyan: #05d9e8; --cyan-glow: rgba(5, 217, 232, 0.4); --cyan-dim: rgba(5, 217, 232, 0.15);
      --magenta: #d300c5; --magenta-glow: rgba(211, 0, 197, 0.3);
      --green: #39ff14; --red: #ff073a;
      --text: #e0f0ff; --text-dim: #7a8ba8; --text-muted: #3d4f6a;
      --border: #1a1a3e;
      --cyber-grid-line: rgba(5, 217, 232, 0.042);
      --cyber-grid-cross: rgba(5, 217, 232, 0.034);
    }
    body {
      font-family: 'Share Tech Mono', 'SF Mono', 'Fira Code', monospace;
      background-color: var(--bg-primary);
      background-image:
        radial-gradient(ellipse at 20% 50%, rgba(5, 217, 232, 0.045) 0%, transparent 52%),
        radial-gradient(ellipse at 80% 20%, rgba(211, 0, 197, 0.04) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 82%, rgba(255, 42, 109, 0.035) 0%, transparent 48%),
        linear-gradient(var(--cyber-grid-line) 1px, transparent 1px),
        linear-gradient(90deg, var(--cyber-grid-cross) 1px, transparent 1px);
      background-size: auto, auto, auto, 52px 52px, 52px 52px;
      background-attachment: fixed;
      color: var(--text);
      min-height: 100vh;
      line-height: 1.55;
    }
    .crt::after {
      content: ''; position: fixed; inset: 0;
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(5,217,232,.015) 2px, rgba(5,217,232,.015) 4px);
      pointer-events: none; z-index: 9999;
    }
    .crt::before {
      content: ''; position: fixed; inset: 0;
      background: radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,.5) 100%);
      pointer-events: none; z-index: 9998;
    }
    .scanline {
      position: fixed; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent 0%, rgba(5,217,232,.03) 20%, rgba(5,217,232,.08) 50%, rgba(5,217,232,.03) 80%, transparent 100%);
      box-shadow: 0 0 15px 5px rgba(5,217,232,.04);
      pointer-events: none; z-index: 9997;
      animation: hscan 12s linear infinite;
    }
    @keyframes hscan { 0% { top: -2px; opacity: 0; } 5%, 95% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: rgba(5,5,10,.5); }
    ::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, var(--cyan), var(--magenta));
      border-radius: 4px; box-shadow: 0 0 8px var(--cyan-glow);
    }

    header.hero {
      padding: 60px 24px 40px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, #070714 0%, #0d0d22 42%, var(--bg-secondary) 100%);
      position: relative;
      text-align: center;
      box-shadow: 0 4px 28px rgba(0,0,0,.55), 0 1px 0 rgba(5,217,232,.1), inset 0 1px 0 rgba(5,217,232,.06);
    }
    header.hero::after {
      content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent, var(--cyan), var(--accent), var(--cyan), transparent);
      opacity: .6;
    }
    h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: clamp(1.6rem, 5vw, 3rem);
      font-weight: 900;
      letter-spacing: 4px;
      text-transform: uppercase;
      background: linear-gradient(90deg, var(--cyan), #fff, var(--accent), var(--cyan));
      background-size: 300% 100%;
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
      filter: drop-shadow(0 0 12px var(--cyan-glow));
      animation: shimmer 6s linear infinite;
      margin-bottom: 14px;
    }
    @keyframes shimmer { 0% { background-position: 0% 0%; } 100% { background-position: 300% 0%; } }
    .tagline { color: var(--text-dim); font-size: 14px; letter-spacing: .5px; max-width: 56rem; margin: 0 auto 26px; }
    .stat-row {
      display: flex; gap: 24px; justify-content: center; flex-wrap: wrap;
      margin: 28px auto 0; max-width: 64rem;
    }
    .stat {
      padding: 14px 22px;
      background: var(--bg-card); border: 1px solid var(--cyan); border-radius: 2px;
      box-shadow: 0 0 16px var(--cyan-glow);
      min-width: 9rem;
    }
    .stat .n { font-family: 'Orbitron', sans-serif; font-size: 28px; font-weight: 900; color: var(--cyan); letter-spacing: 2px; }
    .stat .l { font-size: 10px; letter-spacing: 1.5px; color: var(--text-muted); text-transform: uppercase; margin-top: 2px; }
    .ctas { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 30px; }
    .btn {
      padding: 10px 18px; border-radius: 2px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase;
      text-decoration: none; display: inline-flex; align-items: center; gap: 8px;
      transition: all .2s;
      background-image: linear-gradient(180deg, rgba(255,255,255,.12) 0%, rgba(255,255,255,.02) 40%, transparent 60%);
    }
    .btn-primary { background: transparent; color: var(--accent); border: 1px solid var(--accent); box-shadow: 0 0 10px var(--accent-glow); }
    .btn-primary:hover { background: rgba(255,42,109,.08); box-shadow: 0 0 18px var(--accent-glow); transform: translateY(-1px); }
    .btn-secondary { background: transparent; color: var(--cyan); border: 1px solid var(--cyan); box-shadow: 0 0 8px var(--cyan-dim); }
    .btn-secondary:hover { background: rgba(5,217,232,.08); box-shadow: 0 0 15px var(--cyan-glow); transform: translateY(-1px); }

    main { max-width: 80rem; margin: 0 auto; padding: 36px 20px 60px; position: relative; z-index: 1; }
    section.card {
      background-color: var(--bg-card);
      background-image: linear-gradient(180deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.02) 30%, transparent 50%);
      border: 1px solid var(--cyan);
      border-radius: 2px;
      padding: 22px 26px;
      margin: 22px 0;
      position: relative;
      box-shadow: 0 0 30px var(--cyan-glow);
      backdrop-filter: blur(12px) saturate(1.4);
      animation: glow 3.5s ease-in-out infinite;
    }
    @keyframes glow {
      0%, 100% { box-shadow: 0 0 20px var(--cyan-glow), 0 0 4px var(--cyan-glow); border-color: var(--cyan); }
      50%      { box-shadow: 0 0 40px var(--cyan-glow), 0 0 12px var(--magenta-glow); border-color: var(--accent); }
    }
    h2 {
      font-family: 'Orbitron', sans-serif; font-size: 14px; color: var(--cyan);
      text-transform: uppercase; letter-spacing: 2.5px;
      padding-bottom: 12px; margin-bottom: 14px;
      border-bottom: 1px solid var(--border);
    }
    .features { display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: 14px; }
    .feature {
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-left: 3px solid var(--cyan);
      background: var(--bg-secondary);
      font-size: 12px;
      color: var(--text);
    }
    .feature strong { color: var(--accent-light); display: block; font-family: 'Orbitron', sans-serif; font-size: 11px; letter-spacing: 1px; margin-bottom: 4px; text-transform: uppercase; }

    .install ol { margin: 0 0 0 1.2rem; }
    .install li { margin: 6px 0; font-size: 13px; }
    .install code { background: var(--bg-secondary); border: 1px solid var(--border); padding: 1px 6px; border-radius: 2px; color: var(--cyan); font-size: 12px; }

    .table-wrap { overflow-x: auto; margin-top: 10px; }
    table { border-collapse: collapse; width: 100%; min-width: 50rem; }
    th, td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; vertical-align: top; font-size: 12px; }
    th { background: var(--bg-secondary); color: var(--cyan); font-family: 'Orbitron', sans-serif; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }
    td code { background: var(--bg-secondary); border: 1px solid var(--border); padding: 1px 6px; border-radius: 2px; font-size: 11px; color: var(--text); }
    kbd {
      display: inline-block;
      padding: 2px 8px;
      font-family: 'Share Tech Mono', monospace; font-size: 11px;
      color: var(--accent); background: var(--bg-secondary);
      border: 1px solid var(--accent); border-radius: 2px;
      box-shadow: 0 0 6px var(--accent-glow);
    }
    tr.user-set kbd, .muted { color: var(--text-muted); }
    .muted { font-style: italic; font-size: 11px; }

    footer { text-align: center; padding: 24px 16px 40px; color: var(--text-muted); font-size: 11px; letter-spacing: .5px; }
    footer a { color: var(--cyan); text-decoration: none; }
    footer a:hover { color: var(--accent-light); text-shadow: 0 0 8px var(--cyan-glow); }
  </style>
</head>
<body class="crt">
  <div class="scanline"></div>

  <header class="hero">
    <h1>zpwrchrome // recent tabs</h1>
    <p class="tagline">Browser power-tool. UNIX <code>pass</code> &middot; segmented download manager (default Chrome takeover) &middot; JetBrains-style tab switcher &middot; fzf history &middot; Tampermonkey-equivalent userscripts. ${total} keyboard commands.<br>Cyberpunk HUD palette by MenkeTechnologies.</p>
    <div class="stat-row">
      <div class="stat"><div class="n">${total}</div><div class="l">commands</div></div>
      <div class="stat"><div class="n">${withKey.length}</div><div class="l">default-keyed</div></div>
      <div class="stat"><div class="n">${userBound}</div><div class="l">user-bound</div></div>
    </div>
    <div class="ctas">
      <a class="btn btn-primary"   href="https://github.com/MenkeTechnologies/zpwrchrome">▸ source on github</a>
      <a class="btn btn-secondary" href="#install">▸ install</a>
      <a class="btn btn-secondary" href="#commands">▸ commands</a>
      <a class="btn btn-secondary" href="#theme">▸ theme</a>
      <a class="btn btn-secondary" href="report.html">▸ engineering report</a>
    </div>
  </header>

  <main>
    <section class="card">
      <h2>features</h2>
      <div class="features">
        <div class="feature"><strong>MRU tracking</strong>Cross-window most-recently-used stack. Survives service-worker restarts.</div>
        <div class="feature"><strong>Cmd+Y history</strong>Replaces Chrome's chrome://history with an fzf-fuzzy search over up to ${5000} URLs. Backspace deletes.</div>
        <div class="feature"><strong>Cmd+E modal</strong>JetBrains-style Recent Files overlay injected into the active page.</div>
        <div class="feature"><strong>UNIX <code>pass</code> integration</strong>Replaces browserpass via a Rust native host. Walks <code>~/.password-store</code>, autofills active-tab login forms, copies user / pw / OTP with 45 s clipboard auto-clear (matches <code>pass -c</code>). React/Vue/Lit-safe autofill.</div>
        <div class="feature"><strong>Segmented download manager</strong>Multi-connection HTTP/HTTPS downloader. N-segment <code>Range</code> GETs with retry / resume, Chrome cookies + User-Agent forwarded for logged-in URLs. Live queue UI, right-click <em>Download with zpwrchrome</em>. Pure-Rust, ureq + rustls, no <code>aria2</code>.</div>
        <div class="feature"><strong>Filtered popup</strong>Live filter over open + closed tabs, ↑↓/Enter/Del nav.</div>
        <div class="feature"><strong>Batch tab ops</strong>close-others, close-right, close-duplicates, reload-all, sort-by-URL, group-by-domain.</div>
        <div class="feature"><strong>Single-tab ops</strong>duplicate, pin, mute, detach, bookmark, copy URL, copy Markdown link.</div>
        <div class="feature"><strong>Numeric jumps</strong>jump-to-1..9 (1-8 nth tab, 9 = last).</div>
        <div class="feature"><strong>${userBound} configurable shortcuts</strong>Bind anything you want at <code>chrome://extensions/shortcuts</code>.</div>
      </div>
    </section>

    <section class="card install" id="install">
      <h2>install (unpacked)</h2>
      <ol>
        <li><code>git clone https://github.com/MenkeTechnologies/zpwrchrome.git</code></li>
        <li>Open <code>chrome://extensions</code> and enable <strong>Developer mode</strong></li>
        <li>Click <strong>Load unpacked</strong>, pick the cloned directory</li>
        <li>For <code>pass</code>, downloads, and screenshots, install the native host from crates.io and register it for this extension: <code>cargo install zpwrchrome-host &amp;&amp; zpwrchrome-host --install &lt;ext-id&gt;</code>. Get the ext-id at <code>chrome://extensions</code> (Developer mode). <code>pass</code> support also requires GPG configured locally.</li>
        <li>Open <code>chrome://extensions/shortcuts</code> to bind any of the ${userBound} user-configurable commands (incl. <code>pass-fill</code>, <code>pass-fill-profile</code>, <code>pass-fill-cc</code>, <code>pass-copy-pw</code>, <code>pass-copy-otp</code>, <code>dl-paste-url</code>, <code>dl-show-queue</code>)</li>
        <li>Optional: <strong>Load unpacked</strong> the <code>theme/</code> subdirectory for the matching browser theme</li>
      </ol>
    </section>

    <section class="card" id="commands">
      <h2>keyboard commands</h2>
      <p style="color: var(--text-dim); font-size: 12px; margin-bottom: 8px;">
        Chrome caps default-suggested shortcuts at 4. The remaining ${userBound} commands are bound by the user
        in <code style="background: var(--bg-secondary); border: 1px solid var(--border); padding: 1px 6px; border-radius: 2px; color: var(--cyan);">chrome://extensions/shortcuts</code>.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>command</th><th>default</th><th>description</th></tr></thead>
          <tbody>
${cmds.map(htmlRow).join("\n")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card" id="theme">
      <h2>companion theme</h2>
      <p style="color: var(--text-dim); font-size: 13px;">
        The <code>theme/</code> directory ships a separate Chrome theme that paints the
        browser frame, toolbar, and new-tab page with the same cyberpunk palette
        (<code>#05050a</code> bg / <code>#05d9e8</code> cyan / <code>#ff2a6d</code> accent).
        Themes cannot be bundled with action extensions, so load it as its own
        unpacked extension.
      </p>
    </section>
  </main>

  <footer>
    zpwrchrome v${version} · MIT · MenkeTechnologies ·
    <a href="https://github.com/MenkeTechnologies/zpwrchrome">github.com/MenkeTechnologies/zpwrchrome</a>
  </footer>
</body>
</html>
`;

writeFileSync(join(ROOT, "docs/index.html"), html);

// ---------------------------------------------------------------------------
// docs/report.html — strykelang-style engineering report.

const subsystems = [
  {
    name: "Service worker",
    files: ["background.js"],
    role: "MV3 SW. Cross-window MRU tracker, command dispatcher, popup/modal message API, userscript registration, scenes, history, pass + identity fill, segmented downloads, full-page screenshot.",
  },
  {
    name: "Popup",
    files: ["popup.html", "popup.css", "popup.js"],
    role: "Cyberpunk HUD toolbar action. 12 categories (incl. PASS + TECH), fzf filter, keyboard nav, opens via Alt+T / Cmd+Y (history) / Cmd+P (pass) / Cmd+K (tech).",
  },
  {
    name: "Modal (content script)",
    files: ["modal/content.template.js"],
    role: "Shadow-DOM overlay matching the popup category set. Dormant by default after v0.4.16 — Cmd+E now opens the toolbar popup directly.",
  },
  {
    name: "Pure helpers",
    files: ["lib/util.js", "lib/fzf.js"],
    role: "Zero chrome.* refs. MRU stack semantics, hostname parse, jump-index resolution, scenes, opener-tree, domain-hue, frecency, fzf scorer. Unit-tested headless.",
  },
  {
    name: "Userscript engine",
    files: ["lib/userscript.js", "lib/gm-shim.js"],
    role: "Tampermonkey-equivalent: @metadata parser, match-pattern validator, GM_* shim (getValue/setValue/openInTab/setClipboard/notification/fire-beacon).",
  },
  {
    name: "Userscript dashboard",
    files: ["scripts-manager/manager.html", "scripts-manager/manager.js", "scripts-manager/manager.css"],
    role: "Options-page editor — installed/log/settings/utilities/help tabs, sortable table, monaco-free CodeMirror-free plain textarea editor, fire-log ring buffer reader.",
  },
  {
    name: "Download queue UI",
    files: ["scripts-manager/downloads.html", "scripts-manager/downloads.js", "scripts-manager/downloads.css"],
    role: "Live segmented-download queue. Subscribes to host push events (id=0 dl.progress) for ~5/s updates while active, falls back to polling. Re-hydrates from chrome.storage.local snapshot mirror so the queue paints instantly across SW restarts. Pause / resume / cancel per-row + bulk; speed + ETA + per-job segment count.",
  },
];

// Group commands by family for the keyboard-commands subsection.
const families = [
  { label: "Switching / popup",     match: /(_execute_action|switch-previous-tab|search-tabs|mru-(next|prev)|recent-modal|open-history)$/ },
  { label: "Jump",                  match: /^jump-to-/ },
  { label: "Single-tab ops",        match: /^(duplicate|pin|mute|move-to-new-window|copy-(url|title-md)|bookmark)-?tab|bookmark-tab|copy-url|copy-title-md/ },
  { label: "Batch tab ops",         match: /^(close-(others|right|duplicates)|reload-all|sort-by-url|group-by-domain|restore-last-closed)$/ },
  { label: "Scenes",                match: /^(save-scene-prompt|restore-scene-)/ },
  { label: "Userscripts",           match: /^manage-scripts$/ },
];
const familyCounts = families.map((f) => ({
  ...f,
  count: cmds.filter(([n]) => f.match.test(n)).length,
}));

const reportEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const num = (n) => Number(n).toLocaleString("en-US");

const fileTableRow = (f) =>
  `        <tr><td><code>${reportEsc(f.path)}</code></td><td class="num">${num(f.lines)}</td><td class="num">${num(f.bytes)}</td></tr>`;

const subsystemCard = (s) => `
        <div class="card">
          <h3>${reportEsc(s.name)}</h3>
          <ul class="files">${s.files.map((p) => `<li><code>${reportEsc(p)}</code> &mdash; ${num(sourceLines[p] || 0)} lines</li>`).join("")}</ul>
          <p>${reportEsc(s.role)}</p>
        </div>`;

const kindCard = (k, role) => `
        <li><code>${reportEsc(k)}</code><span>${reportEsc(role)}</span></li>`;

const messageRoles = {
  "list":                "popup/modal → SW. Returns MRU tab list + 25 most-recently-closed sessions.",
  "activate":            "popup/modal → SW. Switch to a tab by id + focus its window.",
  "restore":             "popup/modal → SW. Restore a closed session by sessionId.",
  "close-tab":           "popup/modal → SW. Close an open tab; refresh.",
  "open-scripts-manager":"modal → SW. Opens scripts-manager/manager.html in a new tab.",
  "scripts.list":        "manager → SW. Returns installed scripts + native/fallback mode + lastSync metadata.",
  "scripts.resync":      "manager → SW. Re-register all enabled scripts with chrome.userScripts.",
  "scripts.save":        "manager → SW. Create/update a script; rejects @name collisions on isNew.",
  "scripts.delete":      "manager → SW. Remove script + its GM storage bag.",
  "scripts.toggle":      "manager → SW. Enable/disable a script.",
  "scripts.firelog":     "manager → SW. Read the FIRE_LOG_CAP-sized ring buffer of injection events.",
  "scripts.firelog.clear":"manager → SW. Wipe the fire log.",
  "gm:getValue":         "userscript shim → SW. Per-script chrome.storage.local bag read.",
  "gm:setValue":         "userscript shim → SW. Per-script chrome.storage.local bag write.",
  "gm:deleteValue":      "userscript shim → SW. Per-script chrome.storage.local bag delete.",
  "gm:listValues":       "userscript shim → SW. List keys in the per-script bag.",
  "gm:setClipboard":     "userscript shim → SW. Inject navigator.clipboard.writeText() into the active tab.",
  "gm:openInTab":        "userscript shim → SW. chrome.tabs.create proxy (also used by history-row Enter in the modal).",
  "gm:fire":             "userscript shim → SW. Beacon appended to the fire log at script load.",
  "gm:notification":     "userscript shim → SW. chrome.notifications.create proxy.",
  "scenes-list":         "popup/modal → SW. Returns persisted scenes from chrome.storage.local.",
  "scenes-save":         "popup/modal → SW. Snapshot the active window's tabs as a named scene.",
  "scenes-restore":      "popup/modal → SW. Open a new window populated from a scene by slug.",
  "scenes-delete":       "popup/modal → SW. Drop a scene by slug.",
  "history-list":        "popup/modal → SW. chrome.history.search up to 5000 results, frecency-sorted before return.",
  "history-delete":      "popup/modal → SW. chrome.history.deleteUrl for every visit of a URL.",
};

const designDecisions = [
  ["Service worker, not background page", "MV3 requires an event-driven SW. State lives in chrome.storage.session (MRU) and chrome.storage.local (scenes, userscripts, GM bags, dl.snapshot mirror) — never in module-level globals."],
  ["No build step", "Zero npm dependencies at runtime. No bundler, no transpiler. Pure ES modules in the SW; popup ships as a regular extension page; modal pre-builds via scripts/build-modal.sh inlining fonts + lib/fzf.js + lib/util.js into a single content-script file."],
  ["Native messaging host in Rust, not JS", "<code>pass</code> + <code>gpg</code> can't run inside the SW (MV3 has no shell). One long-lived Rust process per Chrome session multiplexes pass + dl channels over the same length-prefixed JSON port (4-byte LE len, ≤1 MiB/msg per spec). Single install.sh writes the NM manifest for Chrome/Chromium/Brave/Edge on macOS+Linux.",],
  ["Vendored Rust HTTP client, not aria2", "ureq + rustls compiled into the host gives portable HTTP/HTTPS with Range support — no <code>aria2</code> or curl binary on PATH. Pure-Rust TLS works on macOS aarch64 + Linux x86_64/aarch64 with no system OpenSSL dependency. Future-proof against OS TLS API churn.",],
  ["Segmented download via Range, file pre-allocated", "HEAD probe + 4-way parallel <code>Range</code> GETs. Destination file pre-allocated to total size via <code>set_len</code> so segment threads never collide on disk writes. <code>downloaded_in_seg</code> counter tracks per-segment progress so a mid-stream connection drop resumes via Range from the correct offset rather than restarting the segment.",],
  ["Cookie + UA forwarded for logged-in URLs", "chrome.cookies.getAll(url) → Cookie header on every HEAD + GET. Without this, downloads behind a login (paywalls, GitHub private releases, session-piggybacked S3 URLs) silently 401 / 403. UA forwarded too so servers that key on UA (GitHub release filtering, browser-detection paywalls) behave identically to a regular browser download.",],
  ["Clipboard auto-clear matches <code>pass -c</code>", "45 s setTimeout on copy. Fail-open: if the SW dies before the timer fires the clipboard stays, which is the conservative direction (worst case the user sees their password longer; never accidentally clobbers a later copy they made).",],
  ["fzf scorer ported from audio-haxor", "Same constants — boundary=9, camel=7, gap-start=-3, match=16. Visual parity (<mark class=\"fzf-hl\">) across MenkeTechnologies' tools."],
  ["Closed shadow DOM for the modal", "Host-page CSS can never leak in. Fonts inlined as base64 data: URIs so strict host-page font-src CSP can't block them."],
  ["Window-capture keydown for the modal", "window.addEventListener(\"keydown\", h, true) + stopImmediatePropagation beats Vimium / cVim / any other extension that listens on document."],
  ["Frecency for History", "visitCount + 2*typedCount over hoursAgo+2. Typed visits weigh 2x (deliberate). Linear decay: ~57x weight to 1h-ago vs 1w-ago."],
  ["Default-key ceiling = 4", "Chrome MV3 hard cap. Currently 3 used (Alt+T popup, Cmd+E switch-previous-tab, Cmd+Y history). Everything else binds at chrome://extensions/shortcuts."],
  ["Pure helpers in lib/util.js", "Zero chrome.* refs so they unit-test in plain Node and so they can also be inlined into the content-script modal via UTIL_INLINE_START/END markers + scripts/build-modal.mjs."],
  ["Pure helpers in zpwrchrome-host/src/extensions/", "Filename sanitization, unique_dest_path collision handling, subseq search scorer, OTP otpauth extractor — all <code>fn</code>s with no I/O. cargo test exercises them directly. Integration tests stand up a std::net HTTP/1.1 fixture with Range support to drive the detached worker process end-to-end, with cookie-gate + retry-recovery + cancel paths.",],
];

const report = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="description" content="zpwrchrome — engineering report. Manifest V3 Chrome extension. ${total} keyboard commands, ${popupCategories.length} popup categories, ${bgKinds.length} message kinds, ${num(totalJsLines)} JS lines, ${num(testCount)} tests. Cyberpunk HUD by MenkeTechnologies.">
  <title>zpwrchrome &mdash; Engineering Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { color-scheme: dark; }
    ::selection { background: rgba(5,217,232,0.3); color: #fff; }
    :root {
      --bg-primary: #05050a; --bg-secondary: #0a0a14; --bg-card: #0d0d1a;
      --bg-hover: #12122a;
      --accent: #ff2a6d; --accent-light: #ff6b9d; --accent-glow: rgba(255,42,109,0.4);
      --cyan: #05d9e8; --cyan-glow: rgba(5,217,232,0.4); --cyan-dim: rgba(5,217,232,0.15);
      --magenta: #d300c5; --magenta-glow: rgba(211,0,197,0.3);
      --green: #39ff14; --red: #ff073a; --yellow: #ffb800;
      --text: #e0f0ff; --text-dim: #7a8ba8; --text-muted: #3d4f6a;
      --border: #1a1a3e;
      --cyber-grid-line: rgba(5,217,232,0.042);
    }
    body {
      font-family: 'Share Tech Mono','SF Mono','Fira Code',monospace;
      background-color: var(--bg-primary);
      background-image:
        radial-gradient(ellipse at 20% 50%, rgba(5,217,232,0.045) 0%, transparent 52%),
        radial-gradient(ellipse at 80% 20%, rgba(211,0,197,0.04)  0%, transparent 50%),
        radial-gradient(ellipse at 50% 82%, rgba(255,42,109,0.035) 0%, transparent 48%),
        linear-gradient(var(--cyber-grid-line) 1px, transparent 1px),
        linear-gradient(90deg, var(--cyber-grid-line) 1px, transparent 1px);
      background-size: auto, auto, auto, 52px 52px, 52px 52px;
      background-attachment: fixed;
      color: var(--text);
      min-height: 100vh;
      line-height: 1.55;
      font-size: 13px;
    }
    .scanline {
      position: fixed; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent 0%, rgba(5,217,232,.03) 20%, rgba(5,217,232,.08) 50%, rgba(5,217,232,.03) 80%, transparent 100%);
      box-shadow: 0 0 15px 5px rgba(5,217,232,.04);
      pointer-events: none; z-index: 9997;
      animation: hscan 12s linear infinite;
    }
    @keyframes hscan { 0% { top:-2px; opacity:0; } 5%,95% { opacity:1; } 100% { top:100%; opacity:0; } }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: rgba(5,5,10,.5); }
    ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, var(--cyan), var(--magenta)); border-radius: 4px; box-shadow: 0 0 8px var(--cyan-glow); }

    header.hero {
      padding: 36px 24px 28px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, #070714 0%, #0d0d22 42%, var(--bg-secondary) 100%);
      box-shadow: 0 4px 28px rgba(0,0,0,.55), 0 1px 0 rgba(5,217,232,.1), inset 0 1px 0 rgba(5,217,232,.06);
    }
    header.hero .inner { max-width: 80rem; margin: 0 auto; }
    h1.brand {
      font-family: 'Orbitron', sans-serif;
      font-size: clamp(1.2rem, 3.6vw, 2rem);
      font-weight: 900; letter-spacing: 4px; text-transform: uppercase;
      background: linear-gradient(90deg, var(--cyan), #fff, var(--accent), var(--cyan));
      background-size: 300% 100%;
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
      filter: drop-shadow(0 0 12px var(--cyan-glow));
      animation: shimmer 6s linear infinite;
    }
    @keyframes shimmer { 0% { background-position: 0% 0%; } 100% { background-position: 300% 0%; } }
    .crumbs {
      margin-top: 6px;
      font-size: 11px; color: var(--text-dim); letter-spacing: 0.05em;
    }
    .crumbs a { color: var(--cyan); text-decoration: none; }
    .crumbs a:hover { color: var(--accent-light); text-shadow: 0 0 6px var(--cyan-glow); }
    .crumbs .sep { color: var(--text-muted); margin: 0 6px; }
    .tagline {
      margin-top: 10px;
      font-size: 11px; color: var(--text-dim); letter-spacing: 0.03em; opacity: 0.8;
    }
    .tagline code { color: var(--accent-light); background: var(--bg-primary); padding: 1px 4px; border-radius: 2px; font-size: 11px; }

    main { max-width: 80rem; margin: 0 auto; padding: 30px 20px 60px; }

    h2.section {
      font-family: 'Orbitron', sans-serif;
      font-size: 14px; color: var(--cyan);
      text-transform: uppercase; letter-spacing: 3px;
      padding-bottom: 10px; margin: 32px 0 14px;
      border-bottom: 1px solid var(--border);
    }
    h2.section .hash { color: var(--accent); margin-right: 8px; }
    .subtitle { color: var(--text-dim); font-size: 12px; margin-bottom: 14px; line-height: 1.65; }
    .subtitle strong { color: var(--text); }
    .subtitle code { color: var(--accent-light); background: var(--bg-primary); padding: 1px 5px; border-radius: 2px; font-size: 11.5px; }

    .stat-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(11rem,1fr)); gap:0.65rem; margin: 18px 0; }
    .stat-card { border:1px solid var(--border); border-top:3px solid var(--cyan); background:var(--bg-card); padding:0.9rem 1rem; border-radius:2px; text-align:center; }
    .stat-card .v { font-family:'Orbitron',sans-serif; font-size:26px; font-weight:900; color:var(--cyan); line-height:1.1; text-shadow:0 0 18px var(--cyan-glow); }
    .stat-card .v.a { color: var(--accent); text-shadow:0 0 18px var(--accent-glow); }
    .stat-card .v.g { color: var(--green);  text-shadow:0 0 18px rgba(57,255,20,.3); }
    .stat-card .v.m { color: var(--magenta);text-shadow:0 0 18px var(--magenta-glow); }
    .stat-card .v.y { color: var(--yellow); text-shadow:0 0 18px rgba(255,184,0,.3); }
    .stat-card .l { font-family:'Orbitron',sans-serif; font-size:9px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:var(--text-muted); margin-top:6px; }

    .bar-wrap { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 2px; height: 22px; position: relative; overflow: hidden; margin: 4px 0 6px; }
    .bar-fill { height: 100%; }
    .bar-cyan { background: linear-gradient(90deg,#05d9e8,#0891b2); box-shadow: 0 0 8px var(--cyan-glow); }
    .bar-accent { background: linear-gradient(90deg,#ff2a6d,#a01545); box-shadow: 0 0 8px var(--accent-glow); }
    .bar-magenta { background: linear-gradient(90deg,#d300c5,#a000a0); box-shadow: 0 0 8px var(--magenta-glow); }
    .bar-green { background: linear-gradient(90deg,#39ff14,#20c00a); box-shadow: 0 0 8px rgba(57,255,20,.4); }
    .bar-label { position: absolute; right: 8px; top: 0; line-height: 22px; font-size: 11px; font-weight: 700; color:#fff; text-shadow: 0 0 4px #000; font-family:'Orbitron',sans-serif; }
    .bar-caption { font-size: 10px; color: var(--text-muted); margin-bottom: 12px; }

    .subsystems { display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: 10px; }
    .card { border: 1px solid var(--border); border-left: 3px solid var(--cyan); background: var(--bg-card); padding: 12px 14px; border-radius: 2px; }
    .card h3 { font-family:'Orbitron',sans-serif; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--cyan); margin-bottom: 6px; }
    .card p { font-size: 11.5px; color: var(--text-dim); line-height: 1.6; }
    .card .files { list-style: none; margin: 4px 0 6px; }
    .card .files li { font-size: 11px; color: var(--text-muted); margin: 1px 0; }
    .card code { color: var(--accent-light); background: var(--bg-primary); padding: 1px 4px; border-radius: 2px; font-size: 10.5px; }

    .file-table { width:100%; border-collapse: collapse; font-size: 12px; margin: 6px 0 18px; }
    .file-table th { background: var(--bg-secondary); color: var(--cyan); font-family:'Orbitron',sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; text-align: left; padding: 7px 10px; border: 1px solid var(--border); }
    .file-table td { padding: 6px 10px; border: 1px solid var(--border); color: var(--text-dim); }
    .file-table td.num { text-align: right; font-family: 'Share Tech Mono', monospace; }
    .file-table td:first-child code { color: var(--accent-light); background: var(--bg-primary); padding: 1px 5px; border-radius: 2px; font-size: 11px; }
    .file-table tr:hover td { background: var(--bg-hover); }

    .kinds { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr)); gap: 6px; margin: 6px 0 16px; }
    .kinds li { border: 1px solid var(--border); border-left: 3px solid var(--magenta); background: var(--bg-card); padding: 8px 12px; border-radius: 2px; font-size: 11px; }
    .kinds li code { color: var(--accent-light); background: var(--bg-primary); padding: 1px 5px; border-radius: 2px; font-size: 11px; display: inline-block; margin-bottom: 4px; }
    .kinds li span { display: block; color: var(--text-dim); }

    .cat-list { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 6px; }
    .cat-list li { border: 1px solid var(--border); border-left: 3px solid var(--accent); background: var(--bg-card); padding: 8px 12px; border-radius: 2px; font-size: 11.5px; display: flex; justify-content: space-between; align-items: baseline; }
    .cat-list li .key { color: var(--text-muted); font-size: 10px; letter-spacing: 1px; }
    .cat-list li .label { color: var(--text); }

    .decisions { display: grid; grid-template-columns: repeat(auto-fill, minmax(28rem, 1fr)); gap: 10px; margin-top: 10px; }
    .decisions .card { border-left-color: var(--accent); }
    .decisions .card h3 { color: var(--accent); }

    pre.code {
      background: var(--bg-secondary); border: 1px solid var(--border); border-left: 3px solid var(--cyan);
      padding: 10px 14px; border-radius: 2px;
      font-family: 'Share Tech Mono', monospace; font-size: 11.5px; color: var(--text);
      overflow-x: auto; line-height: 1.55;
      margin: 8px 0;
    }
    pre.code .c { color: var(--text-muted); }
    pre.code .k { color: var(--cyan); }
    pre.code .a { color: var(--accent-light); }

    .arch-wrap { background: var(--bg-secondary); border: 1px solid var(--border); border-left: 3px solid var(--magenta); padding: 12px; border-radius: 2px; margin: 8px 0; overflow-x: auto; }
    .arch-wrap svg.arch { display: block; max-width: 100%; height: auto; }

    .perm-pill { display: inline-block; margin: 2px 4px 2px 0; padding: 3px 8px; font-size: 11px; border: 1px solid var(--cyan); color: var(--cyan); border-radius: 2px; background: rgba(5,217,232,0.06); }
    .perm-pill.opt { border-color: var(--text-muted); color: var(--text-muted); background: transparent; }

    footer { text-align: center; padding: 24px 16px 40px; color: var(--text-muted); font-size: 11px; letter-spacing: .5px; }
    footer a { color: var(--cyan); text-decoration: none; }
    footer a:hover { color: var(--accent-light); text-shadow: 0 0 8px var(--cyan-glow); }
  </style>
</head>
<body>
  <div class="scanline"></div>

  <header class="hero">
    <div class="inner">
      <h1 class="brand">// ZPWRCHROME &mdash; ENGINEERING REPORT</h1>
      <nav class="crumbs">
        <span>Engineering Report</span>
        <span class="sep">/</span>
        <a href="index.html">Landing</a>
        <span class="sep">/</span>
        <a href="https://github.com/MenkeTechnologies/zpwrchrome">GitHub</a>
      </nav>
      <p class="tagline">
        Manifest V3 Chrome extension &middot; cross-window MRU &middot; ${total} keyboard commands &middot; ${popupCategories.length}-category fzf-scored popup &middot; <code>chrome.userScripts</code> Tampermonkey-equivalent &middot; frecency-ranked history search
      </p>
    </div>
  </header>

  <main>

    <h2 class="section"><span class="hash">&gt;_</span>EXECUTIVE SUMMARY</h2>
    <p class="subtitle">
      zpwrchrome is a single-author Chrome MV3 extension built around the
      MRU (most-recently-used) tab primitive. The service worker tracks
      tab activation in <code>chrome.storage.session</code> across windows;
      the toolbar popup renders ${popupCategories.length} categories with
      fzf fuzzy filtering; a Tampermonkey-equivalent userscript engine
      runs in Chrome's native <code>USER_SCRIPT</code> world via
      <code>chrome.userScripts</code>; and a frecency-ranked
      <code>chrome.history</code> search replaces Chrome's built-in
      <code>chrome://history</code> page on <code>Cmd+Y</code>.
      <strong>${num(totalJsLines)} JS lines + ${num(totalCssLines)} CSS lines + ${num(totalTestLines)} test lines &middot; ${total} commands &middot; ${bgKinds.length} message handlers &middot; ${testCount} tests passing</strong>.
    </p>

    <div class="stat-grid">
      <div class="stat-card"><div class="v">${num(totalJsLines)}</div><div class="l">JS Lines</div></div>
      <div class="stat-card"><div class="v">${num(totalCssLines)}</div><div class="l">CSS Lines</div></div>
      <div class="stat-card"><div class="v a">${total}</div><div class="l">Keyboard Commands</div></div>
      <div class="stat-card"><div class="v g">${testCount}</div><div class="l">Tests Passing</div></div>
      <div class="stat-card"><div class="v">${popupCategories.length}</div><div class="l">Popup Categories</div></div>
      <div class="stat-card"><div class="v m">${bgKinds.length}</div><div class="l">Message Kinds</div></div>
      <div class="stat-card"><div class="v">${dispatchHandlers.length}</div><div class="l">Dispatch Handlers</div></div>
      <div class="stat-card"><div class="v">${permissions.length}</div><div class="l">Permissions</div></div>
      <div class="stat-card"><div class="v">${utilExports.length}</div><div class="l">Pure Helpers</div></div>
      <div class="stat-card"><div class="v">${totalFiles}</div><div class="l">Repo Files</div></div>
      <div class="stat-card"><div class="v y">${withKey.length}</div><div class="l">Default-Keyed</div></div>
      <div class="stat-card"><div class="v">v${version}</div><div class="l">Version</div></div>
    </div>

    <div>
      <p class="bar-caption" style="margin-top:14px;">Source distribution &mdash; ${num(totalJsLines + totalCssLines + totalHtmlLines + totalTestLines)} total lines</p>
      ${(() => {
        const totalLines = totalJsLines + totalCssLines + totalHtmlLines + totalTestLines;
        const seg = (label, n, cls) => {
          const pct = ((n / totalLines) * 100).toFixed(1);
          return `<div class="bar-wrap"><div class="bar-fill ${cls}" style="width:${pct}%;"></div><span class="bar-label">${label} &middot; ${num(n)} lines &middot; ${pct}%</span></div>`;
        };
        return seg("JS",    totalJsLines,    "bar-cyan")
             + seg("Tests", totalTestLines,  "bar-green")
             + seg("CSS",   totalCssLines,   "bar-magenta")
             + seg("HTML",  totalHtmlLines,  "bar-accent");
      })()}
    </div>

    <h2 class="section"><span class="hash">~</span>SUBSYSTEM BREAKDOWN</h2>
    <p class="subtitle">Every JS surface in the repo, by role. Pure helpers in <code>lib/util.js</code> + <code>lib/fzf.js</code> carry zero <code>chrome.*</code> references so they unit-test headless and so <code>scripts/build-modal.mjs</code> can inline them into the content-script modal between <code>UTIL_INLINE_START/END</code> and <code>FZF_INLINE_START/END</code> markers.</p>
    <div class="subsystems">${subsystems.map(subsystemCard).join("")}
    </div>

    <h2 class="section"><span class="hash">#</span>TOP FILES BY SIZE</h2>
    <p class="subtitle">Sorted descending. <code>modal/content.template.js</code> is the source; <code>modal/content.js</code> is generated (fonts + fzf + util inlined) and excluded from this table.</p>
    <table class="file-table">
      <thead><tr><th>Path</th><th class="num">Lines</th><th class="num">Bytes</th></tr></thead>
      <tbody>
${topFiles.slice(0, 15).map(fileTableRow).join("\n")}
      </tbody>
    </table>

    <h2 class="section"><span class="hash">%</span>ARCHITECTURE</h2>
    <p class="subtitle">Three processes, six storage planes. Chrome hosts the extension; the extension's SW (one process) talks to a Rust native messaging host (one process per request, plus detached download worker processes that outlive their parent). All persistent state lives in <code>chrome.storage</code> or on the filesystem under <code>~/.cache/zpwrchrome/</code> — nothing relies on the SW staying alive.</p>
    <div class="arch-wrap">
      <svg class="arch" viewBox="0 0 1080 660" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="zpwrchrome process and data flow architecture">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--cyan)" />
          </marker>
          <marker id="arrow-m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--magenta)" />
          </marker>
          <marker id="arrow-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        <style>
          .arch text { font-family: 'Share Tech Mono','SF Mono',monospace; fill: var(--text); font-size: 11px; }
          .arch .title { font-family: 'Orbitron','Share Tech Mono',monospace; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; }
          .arch .group { fill: rgba(5,217,232,0.04); stroke: var(--border); stroke-width: 1; rx: 6; }
          .arch .box   { fill: var(--bg-card); stroke: var(--cyan); stroke-width: 1.5; rx: 4; }
          .arch .box.host    { stroke: var(--magenta); }
          .arch .box.fs      { stroke: var(--accent); }
          .arch .box.user    { stroke: var(--green); }
          .arch .box.storage { stroke: var(--yellow); }
          .arch .grpttl { fill: var(--cyan); font-size: 10px; letter-spacing: 2px; }
          .arch .grpttl.host { fill: var(--magenta); }
          .arch .grpttl.fs   { fill: var(--accent); }
          .arch .grpttl.user { fill: var(--green); }
          .arch .grpttl.storage { fill: var(--yellow); }
          .arch .lbl  { fill: var(--text); font-weight: 700; font-size: 11px; }
          .arch .sub  { fill: var(--text-dim); font-size: 9.5px; }
          .arch .flow { stroke: var(--cyan); stroke-width: 1.5; fill: none; }
          .arch .flow.m { stroke: var(--magenta); }
          .arch .flow.a { stroke: var(--accent); }
          .arch .flow.dashed { stroke-dasharray: 4 3; }
          .arch .edge { fill: var(--text-dim); font-size: 9.5px; }
        </style>

        <!-- ─── Browser group ─────────────────────────────────── -->
        <rect class="group" x="20" y="20" width="700" height="380" />
        <text class="title grpttl" x="36" y="42">CHROME (host browser)</text>

        <!-- Service worker -->
        <rect class="box" x="56" y="64" width="220" height="64" />
        <text class="lbl"  x="68" y="84">Service Worker (MV3)</text>
        <text class="sub"  x="68" y="100">background.js · 1 process</text>
        <text class="sub"  x="68" y="114">commands · NM bridge · context menus</text>

        <!-- Popup -->
        <rect class="box" x="56" y="148" width="220" height="56" />
        <text class="lbl"  x="68" y="168">Popup (toolbar)</text>
        <text class="sub"  x="68" y="184">popup.html · 12 categories</text>
        <text class="sub"  x="68" y="198">downloads strip + clipboard banner</text>

        <!-- Manager pages -->
        <rect class="box" x="56" y="222" width="220" height="56" />
        <text class="lbl"  x="68" y="242">Extension pages</text>
        <text class="sub"  x="68" y="258">scripts-manager/* · pass / manager / dl</text>
        <text class="sub"  x="68" y="272">theme / lights / ua / find / settings</text>

        <!-- Content scripts -->
        <rect class="box" x="56" y="296" width="220" height="56" />
        <text class="lbl"  x="68" y="316">Content scripts</text>
        <text class="sub"  x="68" y="332">modal/{content,cyber-theme,lights-off,json-viewer}.js</text>
        <text class="sub"  x="68" y="346">pass-fill / userscripts / screenshot probe</text>

        <!-- chrome.* APIs -->
        <rect class="box" x="320" y="64" width="200" height="288" />
        <text class="lbl"  x="332" y="84">chrome.* APIs</text>
        <text class="sub"  x="332" y="104">tabs / windows / scripting</text>
        <text class="sub"  x="332" y="120">downloads / contextMenus</text>
        <text class="sub"  x="332" y="136">notifications / sessions</text>
        <text class="sub"  x="332" y="152">history / commands</text>
        <text class="sub"  x="332" y="168">cookies</text>
        <text class="sub"  x="332" y="184">webRequest · userScripts</text>
        <text class="sub"  x="332" y="200">action.setBadgeText</text>
        <text class="sub"  x="332" y="216">runtime.sendNativeMessage</text>

        <!-- chrome.storage box (inside browser group) -->
        <rect class="box storage" x="320" y="244" width="200" height="108" />
        <text class="lbl"  x="332" y="264">chrome.storage</text>
        <text class="sub"  x="332" y="282">.session  → MRU stack</text>
        <text class="sub"  x="332" y="298">.local    → dl.settings,</text>
        <text class="sub"  x="332" y="312">             dl.rules, dl.snapshot,</text>
        <text class="sub"  x="332" y="326">             scenes, scripts, zpc.diag</text>
        <text class="sub"  x="332" y="342">.local    → pass.settings</text>

        <!-- User tabs / pages -->
        <rect class="box user" x="556" y="64" width="146" height="288" />
        <text class="lbl"  x="568" y="84">Web pages</text>
        <text class="sub"  x="568" y="104">N user tabs</text>
        <text class="sub"  x="568" y="120">login forms (pass)</text>
        <text class="sub"  x="568" y="136">link/media targets</text>
        <text class="sub"  x="568" y="152">scrollable bodies</text>
        <text class="sub"  x="568" y="168">(screenshot src)</text>

        <!-- ─── NM host process ────────────────────────────── -->
        <rect class="group" x="760" y="20" width="300" height="380" />
        <text class="title grpttl host" x="776" y="42">NATIVE HOST (Rust)</text>

        <rect class="box host" x="780" y="64" width="262" height="80" />
        <text class="lbl"  x="792" y="84">zpwrchrome-host</text>
        <text class="sub"  x="792" y="100">crates.io · v${hostCrateVersion}</text>
        <text class="sub"  x="792" y="114">one process per NM message</text>
        <text class="sub"  x="792" y="128">stdio: length-prefixed JSON</text>

        <rect class="box host" x="780" y="164" width="262" height="76" />
        <text class="lbl"  x="792" y="184">Extension actions</text>
        <text class="sub"  x="792" y="200">dl.{add,list,pause,resume,cancel}</text>
        <text class="sub"  x="792" y="214">dl.{clear,openDir,openFile,writeFile}</text>
        <text class="sub"  x="792" y="228">otp · search · echo</text>

        <rect class="box host" x="780" y="260" width="262" height="76" />
        <text class="lbl"  x="792" y="280">Detached workers</text>
        <text class="sub"  x="792" y="296">--dl-worker  (one per gid)</text>
        <text class="sub"  x="792" y="310">setsid + close FD ≥ 3</text>
        <text class="sub"  x="792" y="324">ureq+rustls · Range requests</text>

        <!-- ─── FS group (bottom) ─────────────────────────── -->
        <rect class="group" x="20" y="430" width="1040" height="200" />
        <text class="title grpttl fs" x="36" y="452">FILESYSTEM (~)</text>

        <rect class="box fs" x="56" y="468" width="280" height="140" />
        <text class="lbl"  x="68" y="488">~/.cache/zpwrchrome/dl/</text>
        <text class="sub"  x="68" y="506">gid_NNNNNN.json   (one per download)</text>
        <text class="sub"  x="68" y="522">next_gid          (monotonic counter)</text>
        <text class="sub"  x="68" y="538">worker.log        (detached worker out)</text>
        <text class="sub"  x="68" y="556">host.log          (every NM invocation)</text>
        <text class="sub"  x="68" y="572">Authoritative download state</text>
        <text class="sub"  x="68" y="588">— survives SW restart, browser restart</text>

        <rect class="box fs" x="372" y="468" width="280" height="140" />
        <text class="lbl"  x="384" y="488">~/Downloads/</text>
        <text class="sub"  x="384" y="506">User-configured (settings.downloadDir)</text>
        <text class="sub"  x="384" y="522">Falls through: downloadDir → lastDir</text>
        <text class="sub"  x="384" y="538">→ default_download_dir()  (host)</text>
        <text class="sub"  x="384" y="558">Per-download bytes (segmented HTTP)</text>
        <text class="sub"  x="384" y="574">+ screenshots (dl.writeFile)</text>

        <rect class="box fs" x="688" y="468" width="320" height="140" />
        <text class="lbl"  x="700" y="488">~/.password-store/</text>
        <text class="sub"  x="700" y="506">browserpass-compatible</text>
        <text class="sub"  x="700" y="522">GPG-encrypted *.gpg entries</text>
        <text class="sub"  x="700" y="542">Read by host actions:</text>
        <text class="sub"  x="700" y="558">  list / fetch / tree / search / otp</text>
        <text class="sub"  x="700" y="576">Powers pass-fill keystroke + autofill badge</text>

        <!-- Edges (annotated) -->
        <!-- SW ↔ chrome APIs -->
        <line class="flow" x1="276" y1="96"  x2="320" y2="96"  marker-end="url(#arrow)" />
        <line class="flow" x1="276" y1="180" x2="320" y2="180" marker-end="url(#arrow)" />
        <line class="flow" x1="276" y1="250" x2="320" y2="250" marker-end="url(#arrow)" />
        <line class="flow" x1="276" y1="324" x2="320" y2="324" marker-end="url(#arrow)" />

        <!-- chrome APIs ↔ user tabs -->
        <line class="flow" x1="520" y1="200" x2="556" y2="200" marker-end="url(#arrow)" />

        <!-- SW → NM host -->
        <path class="flow m" d="M 276 110 C 410 24 600 24 780 88" marker-end="url(#arrow-m)" />
        <text class="edge" x="430" y="56">sendNativeMessage  (stdio framed JSON)</text>

        <!-- NM host → workers -->
        <line class="flow m dashed" x1="910" y1="240" x2="910" y2="260" marker-end="url(#arrow-m)" />

        <!-- workers → ~/Downloads -->
        <path class="flow a" d="M 780 320 C 660 380 530 420 512 466" marker-end="url(#arrow-a)" />
        <text class="edge" x="540" y="416">HTTP segments → file</text>

        <!-- workers ↔ state files -->
        <path class="flow a dashed" d="M 780 296 C 500 400 340 420 196 466" marker-end="url(#arrow-a)" />
        <text class="edge" x="380" y="438">state files (read/write/atomic rename)</text>

        <!-- host → pass-store -->
        <path class="flow m" d="M 910 240 C 940 360 920 420 848 466" marker-end="url(#arrow-m)" />
        <text class="edge" x="930" y="420">gpg decrypt</text>

        <!-- SW ↔ storage (bottom-left edge) -->
        <line class="flow" x1="420" y1="352" x2="420" y2="430" marker-end="url(#arrow)" />

      </svg>
      <p class="subtitle" style="margin-top:6px;">
        <strong>Cyan</strong> edges = in-process chrome.* calls.
        <strong>Magenta</strong> edges = native messaging RPC (stdio, length-prefixed JSON, one round-trip per process).
        <strong>Pink</strong> edges = filesystem I/O performed by the detached worker process.
        Dashed = process-spawn or asynchronous (worker doesn't await parent; SW doesn't await worker).
      </p>
    </div>

    <h2 class="section"><span class="hash">@</span>EXECUTION PIPELINE</h2>
    <p class="subtitle">Three persistence stores: <code>chrome.storage.session</code> for MRU (survives SW restart, not browser restart), <code>chrome.storage.local</code> for scenes / userscripts / GM bags / fire log, and the Chrome-managed <code>chrome.history</code> + <code>chrome.sessions</code> APIs for browsing history and recently-closed tabs.</p>
    <pre class="code"><span class="c">    chrome.tabs events            background.js (SW)                  chrome.storage</span>
   onActivated  ────────────▶  <span class="k">pushMru / dropFromMru</span>  ────────▶  <span class="a">.session</span>
   onRemoved                                                              (MRU array)
   onReplaced                                                              <span class="a">.local</span>
                              <span class="k">command dispatcher</span>                       scenes
                              <span class="k">message API (popup/modal)</span>                userscripts
                              <span class="k">userscripts registration</span>                 fire-log ring
                              <span class="k">history-list (frecency)</span>                  GM bags
                                       │
                                       │ runtime.sendMessage / tabs.sendMessage
                                       ▼
              popup.html/.js                          modal/content.js (shadow DOM)
              ───────────────                         ─────────────────────────────
              ${num(popupCategories.length)} categories                            ${num(modalCategories.length)} categories (dormant since v0.4.16)
              fzf filter                              ${num(modalCategories.length)} categories
              keyboard nav                            same protocol kinds

              scripts-manager/manager.html
              ────────────────────────────
              Tampermonkey-style dashboard
              4 tabs &middot; sortable table &middot; firelog reader
</pre>

    <h2 class="section"><span class="hash">&amp;</span>MESSAGE PROTOCOL</h2>
    <p class="subtitle"><strong>${bgKinds.length}</strong> message kinds handled by the service worker. Popup sends <strong>${popupKinds.length}</strong> kinds; modal sends <strong>${modalKinds.length}</strong>. <code>tests/protocol.test.js</code> guards against orphans on either side.</p>
    <ul class="kinds">
${bgKinds.map((k) => kindCard(k, messageRoles[k] || "(handler in background.js)")).join("")}
    </ul>

    <h2 class="section"><span class="hash">$</span>KEYBOARD COMMANDS</h2>
    <p class="subtitle">Chrome MV3 caps commands with default-suggested keys at <strong>4</strong>; everything else is user-bound at <code>chrome://extensions/shortcuts</code>. Currently <strong>${withKey.length}</strong> default-keyed (<code>${withKey.map(([n, v]) => `${n}=${v.suggested_key?.mac || v.suggested_key?.default}`).join("</code>, <code>")}</code>), <strong>${userBound}</strong> user-bound, <strong>${total}</strong> total.</p>
    <div class="stat-grid">
      ${familyCounts.map((f) => `<div class="stat-card"><div class="v">${f.count}</div><div class="l">${reportEsc(f.label)}</div></div>`).join("\n      ")}
    </div>

    <h2 class="section"><span class="hash">%</span>POPUP CATEGORIES</h2>
    <p class="subtitle">The popup (<code>popup.html</code>/<code>popup.css</code>/<code>popup.js</code>) renders ${popupCategories.length} categories with fzf scoring against title + host. Each category is jumpable via <code>Cmd+1</code>..<code>Cmd+0</code> (where <code>Cmd+0</code> = History, the 10th slot). The modal mirrors the same list since v0.4.15.</p>
    <ul class="cat-list">
${popupCategories.map((c) => `      <li><span class="label">${reportEsc(c.label)}</span><span class="key">${reportEsc(c.key)}</span></li>`).join("\n")}
    </ul>

    <h2 class="section"><span class="hash">^</span>HISTORY &mdash; FRECENCY FORMULA</h2>
    <p class="subtitle"><code>chrome.history.search({ text: "", maxResults: 5000, startTime: 0 })</code> returns visits in <code>lastVisitTime</code>-desc order, which over-promotes one-off pages. <code>background.js:history-list</code> re-ranks by frecency before returning to popup/modal. Each result carries its <code>frecency</code> field forward so the fzf sort uses it as a tiebreaker.</p>
    <pre class="code">  <span class="c">// lib/util.js — pure, unit-tested, inlined into modal via UTIL_INLINE</span>
  <span class="k">export function</span> <span class="a">frecencyScore</span>(item, nowMs = Date.now()) {
    <span class="k">if</span> (!item) <span class="k">return</span> 0;
    <span class="k">const</span> visits = (item.visitCount || 0) + 2 * (item.typedCount || 0);
    <span class="k">if</span> (visits &lt;= 0) <span class="k">return</span> 0;
    <span class="k">const</span> last = item.lastVisitTime || 0;
    <span class="k">if</span> (last &lt;= 0) <span class="k">return</span> visits;
    <span class="k">const</span> hoursAgo = Math.max(0, (nowMs - last) / 3_600_000);
    <span class="k">return</span> visits / (hoursAgo + 2);
  }</pre>

    <h2 class="section"><span class="hash">!</span>PERMISSIONS</h2>
    <p class="subtitle"><strong>${permissions.length}</strong> declared. <code>tests/static.test.js</code> enforces every declared permission is actually used in <code>background.js</code> or <code>popup.js</code> &mdash; no dead permissions.</p>
    <div>
${permissions.map((p) => `      <span class="perm-pill">${reportEsc(p)}</span>`).join("\n")}
${(manifest.optional_permissions || []).map((p) => `      <span class="perm-pill opt" title="optional_permissions — not requested at install">${reportEsc(p)}</span>`).join("\n")}
    </div>

    <h2 class="section"><span class="hash">*</span>TESTS</h2>
    <p class="subtitle">Plain <code>node:test</code>. Zero dependencies. <strong>${testCount}</strong> cases across <strong>${testFiles.length}</strong> files in <strong>~1s</strong>. CI matrix: Node 20 + 22 on ubuntu-latest.</p>
    <table class="file-table">
      <thead><tr><th>File</th><th class="num">Tests</th><th class="num">Lines</th></tr></thead>
      <tbody>
${testFiles.map((f) => {
  const src = readFileSync(join(ROOT, "tests", f), "utf8");
  const n = (src.match(/^test\(/gm) || []).length;
  return `        <tr><td><code>tests/${reportEsc(f)}</code></td><td class="num">${n}</td><td class="num">${num(lineCount(src))}</td></tr>`;
}).join("\n")}
        <tr><td><code>TOTAL</code></td><td class="num"><strong>${testCount}</strong></td><td class="num"><strong>${num(totalTestLines)}</strong></td></tr>
      </tbody>
    </table>

    <h2 class="section"><span class="hash">?</span>KEY DESIGN DECISIONS</h2>
    <div class="decisions">
${designDecisions.map(([h, p]) => `      <div class="card"><h3>${reportEsc(h)}</h3><p>${p}</p></div>`).join("\n")}
    </div>

  </main>

  <footer>
    zpwrchrome v${version} &middot; MIT &middot; MenkeTechnologies &middot;
    <a href="https://github.com/MenkeTechnologies/zpwrchrome">github.com/MenkeTechnologies/zpwrchrome</a> &middot;
    regenerate via <code>scripts/gen.sh</code>
  </footer>
</body>
</html>
`;

writeFileSync(join(ROOT, "docs/report.html"), report);
console.log("wrote", join(ROOT, "docs/report.html"));
