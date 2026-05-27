// Single source of truth for the command list. Emits README.md and
// docs/index.html. Invoked by scripts/gen.sh and exercised in tests.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
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
const testCount = testFiles.reduce((sum, f) => {
  const src = readFileSync(join(testDir, f), "utf8");
  return sum + (src.match(/^test\(/gm) || []).length;
}, 0);

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

### \`[THE FASTEST RECENT-TABS SWITCHER WITH THE MOST KEYBOARD SHORTCUTS IN THE WORLD]\`

> *"Recent Tabs with one shortcut. zpwrchrome with ${total}."*
>
> *"MRU is a primitive, not a side panel."*
>
> *"${total} commands. ${withKey.length} default-keyed. ${userBound} user-bound. Zero compromises."*

## \`[CYBERPUNK HUD]\`

The most keyboard-driven recent-tabs Chrome extension ever shipped. Cross-window MRU stack, ${userBound} user-bindable commands for batch tab ops and clipboard utilities, sub-popup live-filter search, and a companion Chrome theme that paints the rest of the browser with the same strykelang HUD palette. Built by [MenkeTechnologies](https://github.com/MenkeTechnologies), Manifest V3, zero runtime dependencies.

### [\`Live Site\`](https://menketechnologies.github.io/zpwrchrome/) &middot; [\`Source\`](https://github.com/MenkeTechnologies/zpwrchrome) &middot; [\`Theme\`](theme/)

---

## Table of Contents

- [\\[0x00\\] Overview](#0x00-overview)
- [\\[0x01\\] Install](#0x01-install)
- [\\[0x02\\] Keyboard Commands](#0x02-keyboard-commands)
- [\\[0x03\\] Popup UI](#0x03-popup-ui)
- [\\[0x04\\] Recent-Tabs Modal](#0x04-recent-tabs-modal)
- [\\[0x05\\] Companion Theme](#0x05-companion-theme)
- [\\[0x06\\] Architecture](#0x06-architecture)
- [\\[0x07\\] vs Recent Tabs](#0x07-vs-recent-tabs)
- [\\[0x08\\] Files](#0x08-files)
- [\\[0x09\\] Tests](#0x09-tests)
- [\\[0x0A\\] CI](#0x0a-ci)
- [\\[0x0B\\] Regenerating Docs](#0x0b-regenerating-docs)
- [\\[0xFF\\] License](#0xff-license)

---

## [0x00] OVERVIEW

\`zpwrchrome\` is a Chrome MV3 extension that replaces [Recent Tabs by Jason Savard](https://jasonsavard.com/wiki/Recent_Tabs) with a keyboard-first switcher carrying ${total - 1}× more commands, a cyberpunk HUD popup, and a matching browser theme. Highlights:

- **MRU stack** — cross-window most-recently-used tracking via \`chrome.storage.session\`, survives service-worker restarts
- **Alt+T popup** — the cyberpunk HUD with 10 categories (All / Current Window / Pinned / Audible / Muted / Recently Closed / Scenes / Tree / Minimap / History), Cmd+1–0 jumps, fzf scoring on every row
- **Cmd+E / Ctrl+E modal** — JetBrains-style Recent Files overlay: 2-column shadow-DOM modal injected into the active page with categories (All / Current Window / Pinned / Audible / Muted / Recently Closed), Cmd+1–6 category jumps, live filter, hold-cycle on the trigger key
- **Cmd+Y / Ctrl+Y history** — replaces Chrome’s built-in chrome://history page with an fzf-fuzzy search over up to ${5000} entries, Backspace deletes the highlighted URL from history
- **${userBound} user-bindable commands** — Chrome caps default-suggested at 4; everything else binds at \`chrome://extensions/shortcuts\` (single-tab ops, batch ops, numeric jumps, clipboard utilities)
- **Sub-popup live filter** — type to filter open + closed tabs; \`↑\`/\`↓\`/\`Enter\`/\`Delete\`/\`Esc\` nav
- **Companion Chrome theme** — \`theme/\` paints frame/toolbar/omnibox/NTP with the strykelang HUD palette
- **Strykelang HUD aesthetic** — palette and animations sourced from \`strykelang/docs/hud-static.css\` (\`--cyan #05d9e8\`, \`--accent #ff2a6d\`, \`--magenta #d300c5\`, CRT scanlines, neon-border-glow card frames)
- **Pure-helper test surface** — MRU stack semantics, hostname parsing, and jump-index resolution live in \`lib/util.js\` and are unit-tested without a Chrome runtime
- **Single source of truth** — \`README.md\`, \`docs/index.html\`, and command counts are all generated from \`manifest.json\` by \`scripts/gen.sh\`; CI guards against drift
- **Zero runtime dependencies** — no bundler, no transpiler, no npm modules at runtime; pure ES module service worker

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

#### Theme

1. **Load unpacked** the \`theme/\` subdirectory (separate Chrome extension — themes cannot be bundled with action extensions)
2. \`chrome://settings/appearance\` → **Reset to default** to remove

---

## [0x02] KEYBOARD COMMANDS

Chrome’s MV3 manifest allows at most **4** commands with default-suggested keys; the rest are bound by the user at \`chrome://extensions/shortcuts\`. \`zpwrchrome\` ships **${withKey.length}** default-keyed and **${userBound}** user-bindable, for **${total} total** — versus Recent Tabs’ 1.

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

## [0x04] RECENT-TABS MODAL

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
| \`theme_ntp_background.png\` | 1920×1200 | New-tab-page background — grid + radial gradients + HUD corner brackets |
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
                  ┌──────────────────────────┐
                  │  background.js (sw)      │
   chrome.tabs    │  ──────────────────────  │   chrome.storage
   onActivated ──▶│  pushMru / dropFromMru   │◀────  .session
   onRemoved      │  command dispatcher      │       (MRU array)
   onReplaced     │  message API for popup   │
                  └──────────────────────────┘
                              │
                              │  runtime.sendMessage
                              ▼
                  ┌──────────────────────────┐
                  │  popup.{html,css,js}     │
                  │  ──────────────────────  │
                  │  search input            │
                  │  MRU list + closed list  │
                  │  ↑↓/Enter/Del nav        │
                  └──────────────────────────┘

                  ┌──────────────────────────┐
                  │  lib/util.js (pure)      │
                  │  ──────────────────────  │
                  │  mruPush / mruDrop       │
                  │  mruStep / mruPrevious   │
                  │  hostnameOf              │
                  │  resolveJumpIndex        │
                  └──────────────────────────┘
                              ▲
                              │ imported by
                              │ background.js + tests
\`\`\`

The service worker holds no globals — MRU lives in \`chrome.storage.session\`. Pure helpers in \`lib/util.js\` carry no \`chrome.*\` references and are unit-tested in plain Node.

---

## [0x07] VS RECENT TABS

| Feature | \`zpwrchrome\` | Recent Tabs (Jason Savard) |
| --- | --- | --- |
| Default keyboard shortcuts | **${withKey.length}** | 1 (\`Alt+Z\`) |
| User-bindable commands | **${userBound}** | a few |
| Total commands | **${total}** | ~3-5 |
| Cross-window MRU | **yes** | yes |
| In-popup live filter | **yes** | yes |
| In-popup arrow / Enter / Del nav | **yes** | partial |
| JetBrains-style \`Cmd+E\` modal overlay | **yes** | no |
| Restore closed tabs | **yes** | yes |
| Batch tab ops (close-others/right/dupes, reload-all) | **yes** | no |
| Sort tabs by URL | **yes** | no |
| Group tabs by domain (Chrome tab groups) | **yes** | no |
| Numeric jumps (1–9) | **yes** | no |
| Copy URL / Markdown link | **yes** | no |
| Bookmark active tab via shortcut | **yes** | no |
| Companion browser theme | **yes** | no |
| Manifest version | **MV3** | MV2/MV3 |
| License | **MIT** | proprietary |
| Test suite | **${testCount}** node:test cases | none public |
| Generator + doc-drift CI | **yes** | n/a |

---

## [0x08] FILES

| Path | Purpose |
| --- | --- |
| \`manifest.json\` | MV3 manifest, command registry (the only source of truth) |
| \`background.js\` | Service worker — MRU tracker, command dispatcher, popup message API |
| \`lib/util.js\` | Pure helpers — \`mruPush\`/\`mruDrop\`/\`mruStep\`/\`mruPrevious\`/\`hostnameOf\`/\`resolveJumpIndex\` |
| \`popup.html\` / \`popup.css\` / \`popup.js\` | Cyberpunk HUD popup |
| \`modal/content.js\` | JetBrains-style Recent Tabs modal — content script, shadow DOM, 2-column layout |
| \`docs/index.html\` | GitHub-Pages landing page (regenerated from manifest) |
| \`theme/\` | Companion Chrome theme — separate unpacked extension |
| \`icons/icon.svg\` + \`icon{16,32,48,128}.png\` | Extension icons; PNGs rasterized via \`rsvg-convert\` |
| \`scripts/gen.sh\` + \`scripts/gen.mjs\` | Regenerate \`README.md\` and \`docs/index.html\` from \`manifest.json\` |
| \`tests/\` | \`node:test\` suite — pure logic + static invariants + theme + protocol |
| \`.github/workflows/ci.yml\` | GitHub Actions — \`npm test\` on push/PR across Node 20 + 22 |
| \`package.json\` | \`npm test\` script |

---

## [0x09] TESTS

\`\`\`sh
npm test
\`\`\`

Stock Node ≥ 20, no external dependencies, ~200 ms total runtime. Covers:

- **Pure logic** (\`tests/logic.test.js\`) — MRU stack semantics (prepend, dedup, cap, wrap, no-mutate), hostname parse (valid / invalid / file URLs), jump-index resolution (1–8 cap, 9 = last tab, empty windows, non-jump commands)
- **Static manifest invariants** (\`tests/static.test.js\`) — MV3, ≤4 suggested keys (Chrome ceiling), no macOS/Chrome-reserved defaults, no key collisions, kebab-case command names, every manifest command has a \`background.js\` handler, every handler is declared in the manifest, every referenced file exists with correct PNG dimensions, popup HTML has no inline event handlers or inline \`<script>\` (MV3 CSP), strykelang palette intact in popup.css and docs/index.html, every declared permission is actually used in code, README + docs/index.html stay byte-identical after re-running \`scripts/gen.sh\`
- **Theme invariants** (\`tests/theme.test.js\`) — MV3 + \`theme\` block, no \`action\`/\`background\` (Chrome rejects mixed manifests), all theme images are PNGs at declared dimensions, every color is a 0–255 integer triplet, strykelang palette anchors pinned, \`ntp_background_alignment\`/\`repeat\` in Chrome’s enum, version conforms to Chrome’s 1–4-part 0–65535 rule
- **Popup ↔ background protocol** (\`tests/protocol.test.js\`) — every message \`kind\` sent by \`popup.js\` is handled by \`background.js\` and vice versa, no orphans on either side

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
  <title>zpwrchrome — cyberpunk recent-tabs switcher</title>
  <meta name="description" content="Chrome extension: recent-tabs switcher with ${total} keyboard shortcuts and a cyberpunk HUD by MenkeTechnologies.">
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
    <p class="tagline">Cyberpunk Chrome extension. ${total} keyboard commands for tab navigation, batch tab ops, and clipboard utilities.<br>Built on the strykelang HUD palette by MenkeTechnologies.</p>
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
    </div>
  </header>

  <main>
    <section class="card">
      <h2>features</h2>
      <div class="features">
        <div class="feature"><strong>MRU tracking</strong>Cross-window most-recently-used stack. Survives service-worker restarts.</div>
        <div class="feature"><strong>Cmd+Y history</strong>Replaces Chrome's chrome://history with an fzf-fuzzy search over up to ${5000} URLs. Backspace deletes.</div>
        <div class="feature"><strong>Cmd+E modal</strong>JetBrains-style Recent Files overlay injected into the active page.</div>
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
        <li>Open <code>chrome://extensions/shortcuts</code> to bind any of the ${userBound} user-configurable commands</li>
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
