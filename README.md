```
 _____________          _______   _____ _    _ _____   ____  __  __ ______ 
|___  /  __ \ \        / /  __ \ / ____| |  | |  __ \ / __ \|  \/  |  ____|
   / /| |__) \ \  /\  / /| |__) | |    | |__| | |__) | |  | | \  / | |__   
  / / |  ___/ \ \/  \/ / |  _  /| |    |  __  |  _  /| |  | | |\/| |  __|  
 / /__| |      \  /\  /  | | \ \| |____| |  | | | \ \| |__| | |  | | |____ 
/_____|_|       \/  \/   |_|  \_\\_____|_|  |_|_|  \_\\____/|_|  |_|______|
```

[![CI](https://github.com/MenkeTechnologies/zpwrchrome/actions/workflows/ci.yml/badge.svg)](https://github.com/MenkeTechnologies/zpwrchrome/actions/workflows/ci.yml)
[![Manifest](https://img.shields.io/badge/manifest-v3-05d9e8.svg)](manifest.json)
[![Commands](https://img.shields.io/badge/commands-29-ff2a6d.svg)](#0x02-keyboard-commands)
[![Theme](https://img.shields.io/badge/companion-theme-d300c5.svg)](theme/)
[![Docs](https://img.shields.io/badge/docs-online-05d9e8.svg)](https://menketechnologies.github.io/zpwrchrome/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### `[THE FASTEST RECENT-TABS SWITCHER WITH THE MOST KEYBOARD SHORTCUTS IN THE WORLD]`

> *"Recent Tabs with one shortcut. zpwrchrome with 29."*
>
> *"MRU is a primitive, not a side panel."*
>
> *"29 commands. 4 default-keyed. 25 user-bound. Zero compromises."*

## `[CYBERPUNK HUD]`

The most keyboard-driven recent-tabs Chrome extension ever shipped. Cross-window MRU stack, 25 user-bindable commands for batch tab ops and clipboard utilities, sub-popup live-filter search, and a companion Chrome theme that paints the rest of the browser with the same strykelang HUD palette. Built by [MenkeTechnologies](https://github.com/MenkeTechnologies), Manifest V3, zero runtime dependencies.

### [`Live Site`](https://menketechnologies.github.io/zpwrchrome/) &middot; [`Source`](https://github.com/MenkeTechnologies/zpwrchrome) &middot; [`Theme`](theme/)

---

## Table of Contents

- [\[0x00\] Overview](#0x00-overview)
- [\[0x01\] Install](#0x01-install)
- [\[0x02\] Keyboard Commands](#0x02-keyboard-commands)
- [\[0x03\] Popup UI](#0x03-popup-ui)
- [\[0x04\] Recent-Tabs Modal](#0x04-recent-tabs-modal)
- [\[0x05\] Companion Theme](#0x05-companion-theme)
- [\[0x06\] Architecture](#0x06-architecture)
- [\[0x07\] vs Recent Tabs](#0x07-vs-recent-tabs)
- [\[0x08\] Files](#0x08-files)
- [\[0x09\] Tests](#0x09-tests)
- [\[0x0A\] CI](#0x0a-ci)
- [\[0x0B\] Regenerating Docs](#0x0b-regenerating-docs)
- [\[0xFF\] License](#0xff-license)

---

## [0x00] OVERVIEW

`zpwrchrome` is a Chrome MV3 extension that replaces [Recent Tabs by Jason Savard](https://jasonsavard.com/wiki/Recent_Tabs) with a keyboard-first switcher carrying 28× more commands, a cyberpunk HUD popup, and a matching browser theme. Highlights:

- **MRU stack** — cross-window most-recently-used tracking via `chrome.storage.session`, survives service-worker restarts
- **Alt+Z back** — one-keystroke return to previous tab (matches Recent Tabs’ only shortcut)
- **Cmd+E / Ctrl+E modal** — JetBrains-style Recent Files overlay: 2-column shadow-DOM modal injected into the active page with categories (All / Current Window / Pinned / Audible / Muted / Recently Closed), Cmd+1–6 category jumps, live filter, hold-cycle on the trigger key
- **Alt+Shift+T restore** — reopens the most recently closed tab/window from any window
- **25 user-bindable commands** — Chrome caps default-suggested at 4; everything else binds at `chrome://extensions/shortcuts` (single-tab ops, batch ops, numeric jumps, clipboard utilities)
- **Sub-popup live filter** — type to filter open + closed tabs; `↑`/`↓`/`Enter`/`Delete`/`Esc` nav
- **Companion Chrome theme** — `theme/` paints frame/toolbar/omnibox/NTP with the strykelang HUD palette
- **Strykelang HUD aesthetic** — palette and animations sourced from `strykelang/docs/hud-static.css` (`--cyan #05d9e8`, `--accent #ff2a6d`, `--magenta #d300c5`, CRT scanlines, neon-border-glow card frames)
- **Pure-helper test surface** — MRU stack semantics, hostname parsing, and jump-index resolution live in `lib/util.js` and are unit-tested without a Chrome runtime
- **Single source of truth** — `README.md`, `docs/index.html`, and command counts are all generated from `manifest.json` by `scripts/gen.sh`; CI guards against drift
- **Zero runtime dependencies** — no bundler, no transpiler, no npm modules at runtime; pure ES module service worker

---

## [0x01] INSTALL

```sh
git clone https://github.com/MenkeTechnologies/zpwrchrome.git
```

#### Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**, pick the cloned directory
4. Open `chrome://extensions/shortcuts` to bind any of the 25 user-configurable commands

#### Theme

1. **Load unpacked** the `theme/` subdirectory (separate Chrome extension — themes cannot be bundled with action extensions)
2. `chrome://settings/appearance` → **Reset to default** to remove

---

## [0x02] KEYBOARD COMMANDS

Chrome’s MV3 manifest allows at most **4** commands with default-suggested keys; the rest are bound by the user at `chrome://extensions/shortcuts`. `zpwrchrome` ships **4** default-keyed and **25** user-bindable, for **29 total** — versus Recent Tabs’ 1.

| Command | Default | Description |
| --- | --- | --- |
| `_execute_action` | Alt+T | Open zpwrchrome popup |
| `switch-previous-tab` | Alt+Z | Switch to the previously active tab (MRU) |
| `restore-last-closed` | Alt+Shift+T | Restore the most recently closed tab |
| `recent-modal` | Ctrl+E | Open the JetBrains-style Recent Tabs modal overlay |
| `search-tabs` | *(user-set in `chrome://extensions/shortcuts`)* | Open popup focused on the tab search box |
| `mru-next` | *(user-set in `chrome://extensions/shortcuts`)* | Cycle forward through MRU stack |
| `mru-prev` | *(user-set in `chrome://extensions/shortcuts`)* | Cycle backward through MRU stack |
| `jump-to-1` | *(user-set in `chrome://extensions/shortcuts`)* | Jump to tab #1 in current window |
| `jump-to-2` | *(user-set in `chrome://extensions/shortcuts`)* | Jump to tab #2 in current window |
| `jump-to-3` | *(user-set in `chrome://extensions/shortcuts`)* | Jump to tab #3 in current window |
| `jump-to-4` | *(user-set in `chrome://extensions/shortcuts`)* | Jump to tab #4 in current window |
| `jump-to-5` | *(user-set in `chrome://extensions/shortcuts`)* | Jump to tab #5 in current window |
| `jump-to-6` | *(user-set in `chrome://extensions/shortcuts`)* | Jump to tab #6 in current window |
| `jump-to-7` | *(user-set in `chrome://extensions/shortcuts`)* | Jump to tab #7 in current window |
| `jump-to-8` | *(user-set in `chrome://extensions/shortcuts`)* | Jump to tab #8 in current window |
| `jump-to-9` | *(user-set in `chrome://extensions/shortcuts`)* | Jump to last tab in current window |
| `duplicate-tab` | *(user-set in `chrome://extensions/shortcuts`)* | Duplicate the active tab |
| `pin-tab` | *(user-set in `chrome://extensions/shortcuts`)* | Toggle pin on the active tab |
| `mute-tab` | *(user-set in `chrome://extensions/shortcuts`)* | Toggle mute on the active tab |
| `move-to-new-window` | *(user-set in `chrome://extensions/shortcuts`)* | Detach active tab to a new window |
| `close-others` | *(user-set in `chrome://extensions/shortcuts`)* | Close all other tabs in current window |
| `close-right` | *(user-set in `chrome://extensions/shortcuts`)* | Close all tabs to the right of the active tab |
| `close-duplicates` | *(user-set in `chrome://extensions/shortcuts`)* | Close tabs with duplicate URLs (keeps leftmost) |
| `reload-all` | *(user-set in `chrome://extensions/shortcuts`)* | Reload every tab in current window |
| `sort-by-url` | *(user-set in `chrome://extensions/shortcuts`)* | Sort tabs in current window by URL |
| `group-by-domain` | *(user-set in `chrome://extensions/shortcuts`)* | Group tabs in current window by domain (Chrome tab groups) |
| `copy-url` | *(user-set in `chrome://extensions/shortcuts`)* | Copy active tab URL to clipboard |
| `copy-title-md` | *(user-set in `chrome://extensions/shortcuts`)* | Copy active tab as Markdown link |
| `bookmark-tab` | *(user-set in `chrome://extensions/shortcuts`)* | Bookmark active tab to Other Bookmarks |

---

## [0x03] POPUP UI

The popup (`popup.html` / `popup.css` / `popup.js`) is a 520×600 cyberpunk HUD with two stacked lists:

- **Open // MRU** — every open tab, in most-recently-used order
- **Recently Closed** — last 25 closed tabs/windows via `chrome.sessions`

Keyboard nav inside the popup:

| Key | Action |
| --- | --- |
| any character | live-filter by title / URL / hostname |
| `↑` / `↓` | move selection |
| `Enter` | switch to open tab, or restore closed tab |
| `Delete` / `Shift+Backspace` | close highlighted open tab |
| `Esc` | clear filter, or close popup |

Click any row to activate it. Hover reveals a `×` icon to close.

---

## [0x04] RECENT-TABS MODAL

JetBrains IDEs have a Recent Files modal (`Cmd+E` on Mac). `zpwrchrome` ports the same UX to Chrome: a full-page shadow-DOM overlay injected into the active tab, with categories on the left and the live tab list on the right.

| Key | Action |
| --- | --- |
| `Cmd+E` / `Ctrl+E` | open the modal — and, while open, cycle MRU forward |
| `Cmd+Shift+E` / `Ctrl+Shift+E` | cycle MRU backward (when modal is open) |
| `Cmd+1` … `Cmd+6` | jump to category (All / Current Window / Pinned / Audible / Muted / Recently Closed) |
| `↑` / `↓` | move selection |
| `Enter` | switch to / restore selection |
| `Delete` / `Shift+Backspace` | close the highlighted open tab in place |
| `Esc` | dismiss without activating |
| any letter | live-filter by title / URL / hostname |

Implementation: `modal/content.js` is a content script registered on `<all_urls>` (excluded from the Chrome Web Store, which rejects all extensions). It builds the modal inside a closed shadow root so host-page CSS can never leak in. Visuals are the strykelang HUD palette inline-rendered into a `<style>` block. On restricted pages (`chrome://`, `view-source://`, the Web Store) the command transparently falls back to the regular action popup.

---

## [0x05] COMPANION THEME

The `theme/` directory ships a separate Chrome theme. Same strykelang palette as the popup, applied to the browser frame, toolbar, omnibox, and new-tab page.

| Theme image | Resolution | Purpose |
| --- | --- | --- |
| `theme_ntp_background.png` | 1920×1200 | New-tab-page background — grid + radial gradients + HUD corner brackets |
| `theme_frame.png` | 1920×120 | Window-frame strip — gradient + cyan→accent seam |
| `theme_toolbar.png` | 1920×80 | Toolbar background |

Color anchors (RGB triplets in `theme/manifest.json`):

| Slot | Hex | RGB | Strykelang variable |
| --- | --- | --- | --- |
| `frame` / `ntp_background` | `#05050a` | [5, 5, 10] | `--bg-primary` |
| `toolbar` / `omnibox_background` | `#0a0a14` | [10, 10, 20] | `--bg-secondary` |
| `bookmark_text` / `ntp_link` | `#05d9e8` | [5, 217, 232] | `--cyan` |
| `ntp_header` | `#ff2a6d` | [255, 42, 109] | `--accent` |
| `tab_text` / `ntp_text` | `#e0f0ff` | [224, 240, 255] | `--text` |

---

## [0x06] ARCHITECTURE

```
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
```

The service worker holds no globals — MRU lives in `chrome.storage.session`. Pure helpers in `lib/util.js` carry no `chrome.*` references and are unit-tested in plain Node.

---

## [0x07] VS RECENT TABS

| Feature | `zpwrchrome` | Recent Tabs (Jason Savard) |
| --- | --- | --- |
| Default keyboard shortcuts | **4** | 1 (`Alt+Z`) |
| User-bindable commands | **25** | a few |
| Total commands | **29** | ~3-5 |
| Cross-window MRU | **yes** | yes |
| In-popup live filter | **yes** | yes |
| In-popup arrow / Enter / Del nav | **yes** | partial |
| JetBrains-style `Cmd+E` modal overlay | **yes** | no |
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
| Test suite | **107** node:test cases | none public |
| Generator + doc-drift CI | **yes** | n/a |

---

## [0x08] FILES

| Path | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, command registry (the only source of truth) |
| `background.js` | Service worker — MRU tracker, command dispatcher, popup message API |
| `lib/util.js` | Pure helpers — `mruPush`/`mruDrop`/`mruStep`/`mruPrevious`/`hostnameOf`/`resolveJumpIndex` |
| `popup.html` / `popup.css` / `popup.js` | Cyberpunk HUD popup |
| `modal/content.js` | JetBrains-style Recent Tabs modal — content script, shadow DOM, 2-column layout |
| `docs/index.html` | GitHub-Pages landing page (regenerated from manifest) |
| `theme/` | Companion Chrome theme — separate unpacked extension |
| `icons/icon.svg` + `icon{16,32,48,128}.png` | Extension icons; PNGs rasterized via `rsvg-convert` |
| `scripts/gen.sh` + `scripts/gen.mjs` | Regenerate `README.md` and `docs/index.html` from `manifest.json` |
| `tests/` | `node:test` suite — pure logic + static invariants + theme + protocol |
| `.github/workflows/ci.yml` | GitHub Actions — `npm test` on push/PR across Node 20 + 22 |
| `package.json` | `npm test` script |

---

## [0x09] TESTS

```sh
npm test
```

Stock Node ≥ 20, no external dependencies, ~200 ms total runtime. Covers:

- **Pure logic** (`tests/logic.test.js`) — MRU stack semantics (prepend, dedup, cap, wrap, no-mutate), hostname parse (valid / invalid / file URLs), jump-index resolution (1–8 cap, 9 = last tab, empty windows, non-jump commands)
- **Static manifest invariants** (`tests/static.test.js`) — MV3, ≤4 suggested keys (Chrome ceiling), no macOS/Chrome-reserved defaults, no key collisions, kebab-case command names, every manifest command has a `background.js` handler, every handler is declared in the manifest, every referenced file exists with correct PNG dimensions, popup HTML has no inline event handlers or inline `<script>` (MV3 CSP), strykelang palette intact in popup.css and docs/index.html, every declared permission is actually used in code, README + docs/index.html stay byte-identical after re-running `scripts/gen.sh`
- **Theme invariants** (`tests/theme.test.js`) — MV3 + `theme` block, no `action`/`background` (Chrome rejects mixed manifests), all theme images are PNGs at declared dimensions, every color is a 0–255 integer triplet, strykelang palette anchors pinned, `ntp_background_alignment`/`repeat` in Chrome’s enum, version conforms to Chrome’s 1–4-part 0–65535 rule
- **Popup ↔ background protocol** (`tests/protocol.test.js`) — every message `kind` sent by `popup.js` is handled by `background.js` and vice versa, no orphans on either side

---

## [0x0A] CI

`.github/workflows/ci.yml` runs `npm test` on every push and pull-request. Matrix: Node `20` + `22` on `ubuntu-latest`. The doc-drift test (re-run `scripts/gen.sh` and compare) catches stale README / landing page in the same job.

```yaml
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        node: [20, 22]
```

CI badge at the top of this README.

---

## [0x0B] REGENERATING DOCS

`README.md` and `docs/index.html` are derived from `manifest.json`. Refresh both with:

```sh
scripts/gen.sh
```

CI re-runs the same generator and fails the build if either file is not byte-identical to what `gen.sh` emits, so stale docs can never land on `main`.

---

## [0xFF] LICENSE

MIT — see [`LICENSE`](LICENSE).

---

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░░ >>> TRACK MRU. SWITCH FAST. CYBERPUNK HUD. OWN YOUR BROWSER. <<< ░░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

##### created by [MenkeTechnologies](https://github.com/MenkeTechnologies)
