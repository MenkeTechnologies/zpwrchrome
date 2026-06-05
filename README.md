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
[![Commands](https://img.shields.io/badge/commands-49-ff2a6d.svg)](#0x02-keyboard-commands)
[![Theme](https://img.shields.io/badge/companion-theme-d300c5.svg)](theme/)
[![Docs](https://img.shields.io/badge/docs-online-05d9e8.svg)](https://menketechnologies.github.io/zpwrchrome/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### `[THE BROWSER POWER-TOOL — PASS · DOWNLOADS · TABS · HISTORY · USERSCRIPTS]`

> *"UNIX `pass` in the browser. Segmented download manager that owns the default. JetBrains-style tab switcher. fzf history. Tampermonkey-equivalent userscripts."*
>
> *"One extension, 49 commands, zero compromises."*

## `[CYBERPUNK HUD]`

A Chrome MV3 extension that bundles four daily-driver tools into one toolbar icon: a browserpass-compatible UNIX `pass` integration (fill / copy / OTP / auto-submit / basic-auth injection), a segmented multi-connection download manager that intercepts every browser download by default (HEAD probe + parallel `Range` GETs via a vendored Rust host), a JetBrains-style tab switcher with cross-window MRU + named scenes + opener-tree + minimap, an fzf-fuzzy search over up to 5000 browser-history entries, and a Tampermonkey-equivalent userscript engine. 45 commands bindable to keyboard shortcuts. Built by [MenkeTechnologies](https://github.com/MenkeTechnologies), Manifest V3, zero JS runtime dependencies.

### [`Live Site`](https://menketechnologies.github.io/zpwrchrome/) &middot; [`Source`](https://github.com/MenkeTechnologies/zpwrchrome) &middot; [`Theme`](theme/)

---

## Table of Contents

- [\[0x00\] Overview](#0x00-overview)
- [\[0x01\] Install](#0x01-install)
- [\[0x02\] Keyboard Commands](#0x02-keyboard-commands)
- [\[0x03\] Popup UI](#0x03-popup-ui)
- [\[0x04\] Tab Switcher Modal](#0x04-tab-switcher-modal)
- [\[0x05\] Companion Theme](#0x05-companion-theme)
- [\[0x06\] Architecture](#0x06-architecture)
- [\[0x07\] Capability Surface](#0x07-capability-surface)
- [\[0x08\] Files](#0x08-files)
- [\[0x09\] Tests](#0x09-tests)
- [\[0x0A\] CI](#0x0a-ci)
- [\[0x0B\] Regenerating Docs](#0x0b-regenerating-docs)
- [\[0xFF\] License](#0xff-license)

---

## [0x00] OVERVIEW

`zpwrchrome` is a Chrome MV3 extension that bundles four daily-driver capabilities into one toolbar icon: UNIX `pass` integration, a segmented download manager that takes over Chrome's default, a JetBrains-style tab switcher, and fzf history search. 49 keyboard commands, a cyberpunk HUD popup, and a matching browser theme. Highlights:

- **MRU stack** — cross-window most-recently-used tracking via `chrome.storage.session`, survives service-worker restarts
- **Alt+T popup** — the cyberpunk HUD with 11 categories (All / Current Window / Pinned / Audible / Muted / Recently Closed / Scenes / Tree / Minimap / History / **Pass**), Cmd+1–0 jumps, fzf scoring on every row
- **Cmd+E / Ctrl+E modal** — JetBrains-style Recent Files overlay: 2-column shadow-DOM modal injected into the active page with categories (All / Current Window / Pinned / Audible / Muted / Recently Closed), Cmd+1–6 category jumps, live filter, hold-cycle on the trigger key
- **Cmd+Y / Ctrl+Y history** — replaces Chrome’s built-in chrome://history page with an fzf-fuzzy search over up to 5000 entries, Backspace deletes the highlighted URL from history
- **UNIX `pass` integration** — replaces browserpass via a vendored Rust native-messaging host that walks `~/.password-store` with eTLD+1 + multi-label PSL matching, shells to `pass show`/`pass otp`, returns credentials over a length-prefixed JSON port. PASS popup category with fill / user / pw / otp buttons. Hotkeys: `pass-fill` autofills the active tab via injected `HTMLInputElement.value` setter (React/Vue safe) + input/change dispatch; `pass-copy-{pw,user,otp}` write to clipboard with 45 s auto-clear matching `pass -c`
- **Segmented download manager** — same Rust host vendors a multi-connection downloader (HEAD probe → N parallel `Range` segments, default 4, pre-allocated dest file). Cookie + User-Agent forwarded from `chrome.cookies.getAll` so logged-in downloads work; transient errors retry with 200 ms × 3ⁿ backoff and resume via `Range` from the segment-local offset; queue mirrored to `chrome.storage.local` so the UI paints instantly across service-worker restarts. Right-click `Download with zpwrchrome` on links / images / video / audio; `dl-paste-url` reads the clipboard via injected `navigator.clipboard.readText`. Live queue UI at `scripts-manager/downloads.html` subscribes to host push events. Filename collisions auto-rename `foo.zip` → `foo (1).zip`. Pure-Rust, vendorable TLS (`ureq`+rustls), no `aria2` or other runtime binary
- **45 user-bindable commands** — Chrome caps default-suggested at 4; everything else binds at `chrome://extensions/shortcuts` (single-tab ops, batch ops, numeric jumps, clipboard utilities, pass-* + dl-*)
- **Sub-popup live filter** — type to filter open + closed tabs; `↑`/`↓`/`Enter`/`Delete`/`Esc` nav
- **Companion Chrome theme** — `theme/` paints frame/toolbar/omnibox/NTP with the strykelang HUD palette
- **Strykelang HUD aesthetic** — palette and animations sourced from `strykelang/docs/hud-static.css` (`--cyan #05d9e8`, `--accent #ff2a6d`, `--magenta #d300c5`, CRT scanlines, neon-border-glow card frames)
- **Pure-helper test surface** — MRU stack semantics, hostname parsing, jump-index resolution in `lib/util.js` + pass match/parse + dl filename/collision helpers in `browserpass-host-rs/src/{ported,extensions}/` all unit-tested without a Chrome runtime
- **Single source of truth** — `README.md`, `docs/index.html`, and command counts are all generated from `manifest.json` by `scripts/gen.sh`; CI guards against drift
- **Zero JS runtime dependencies** — no bundler, no transpiler, no npm modules at runtime; pure ES module service worker. The native host adds `serde`/`serde_json`/`ureq` (foundational pure-Rust crates) and ships as a single static binary

---

## [0x01] INSTALL

```sh
git clone https://github.com/MenkeTechnologies/zpwrchrome.git
```

#### Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**, pick the cloned directory
4. Open `chrome://extensions/shortcuts` to bind any of the 45 user-configurable commands

#### Native messaging host (required for `pass`, downloads, screenshots)

1. Install GPG + `pass` if you want the password-store integration (`brew install pass` on macOS, `apt install pass` on Debian/Ubuntu); make sure `pass show` decrypts an entry from your shell first. (Skip if you only want downloads + screenshots.)
2. Install the host binary from crates.io and register it for this extension's ID:

```sh
cargo install browserpass-host-rs
# find your extension ID at chrome://extensions (Developer mode), then:
browserpass-host-rs --install <ext-id>
```

The installer writes `com.menketechnologies.zpwrchrome.json` into every detected Chromium-family browser config dir (Chrome / Chromium / Brave / Edge / Arc / Vivaldi on macOS + Linux). `allowed_origins` is populated with `chrome-extension://<ext-id>/` so the browser will only spawn the host for this extension. Reload the extension at `chrome://extensions` after running it.

To upgrade later: `cargo install browserpass-host-rs --force` — the NM manifest already points at `$CARGO_HOME/bin/browserpass-host-rs` so no re-install is needed.

#### Theme

1. **Load unpacked** the `theme/` subdirectory (separate Chrome extension — themes cannot be bundled with action extensions)
2. `chrome://settings/appearance` → **Reset to default** to remove

---

## [0x02] KEYBOARD COMMANDS

Chrome’s MV3 manifest allows at most **4** commands with default-suggested keys; the rest are bound by the user at `chrome://extensions/shortcuts`. `zpwrchrome` ships **4** default-keyed and **45** user-bindable, for **49 total** — covering pass actions, download manager, tab switcher, history search, and userscript management.

| Command | Default | Description |
| --- | --- | --- |
| `_execute_action` | Alt+T | Open zpwrchrome popup |
| `switch-previous-tab` | Ctrl+E | Switch to the previously active tab (MRU) |
| `restore-last-closed` | *(user-set in `chrome://extensions/shortcuts`)* | Restore the most recently closed tab |
| `recent-modal` | *(user-set in `chrome://extensions/shortcuts`)* | Open the recent-tabs popup (same as Alt+T — user-bindable) |
| `open-history` | Ctrl+Y | Open the popup focused on the History category (fzf-search browsing history) |
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
| `manage-scripts` | *(user-set in `chrome://extensions/shortcuts`)* | Open the userscript manager (Tampermonkey-style) |
| `save-scene-prompt` | *(user-set in `chrome://extensions/shortcuts`)* | Open popup focused on save-scene input |
| `restore-scene-1` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #1 (newest) — opens a new window with saved tabs |
| `restore-scene-2` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #2 |
| `restore-scene-3` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #3 |
| `restore-scene-4` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #4 |
| `restore-scene-5` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #5 |
| `kill-heaviest` | *(user-set in `chrome://extensions/shortcuts`)* | Close the open tab consuming the most memory (Chrome dev/canary only — requires chrome.processes API) |
| `pass-open-popup` | *(user-set in `chrome://extensions/shortcuts`)* | Open popup focused on the PASS category (matches credentials for the active tab from ~/.password-store via the zpwrchrome native host) |
| `pass-fill` | Ctrl+Shift+L | Autofill the best-matching `pass` credential into the active tab's login form (requires the native host) — customize at chrome://extensions/shortcuts |
| `pass-copy-pw` | *(user-set in `chrome://extensions/shortcuts`)* | Copy the best-matching `pass` password for the active tab to the clipboard (auto-clears after 45 s) |
| `pass-copy-user` | *(user-set in `chrome://extensions/shortcuts`)* | Copy the best-matching `pass` username for the active tab to the clipboard |
| `pass-copy-otp` | *(user-set in `chrome://extensions/shortcuts`)* | Copy the TOTP code for the best-matching `pass` entry to the clipboard |
| `pass-open-url` | *(user-set in `chrome://extensions/shortcuts`)* | Navigate the active tab to the URL stored in the best-matching `pass` entry (parses url/link/website/web/site keys) |
| `screenshot-full-page` | *(user-set in `chrome://extensions/shortcuts`)* | Full-page screenshot — scrolls the active tab in viewport-sized steps and stitches into one PNG (no extra permissions required; customize at chrome://extensions/shortcuts) |
| `dl-paste-url` | *(user-set in `chrome://extensions/shortcuts`)* | Download the URL currently on the clipboard via the zpwrchrome segmented downloader |
| `dl-show-queue` | *(user-set in `chrome://extensions/shortcuts`)* | Open the zpwrchrome download manager queue view |
| `dl-pause-all` | *(user-set in `chrome://extensions/shortcuts`)* | Pause every active download in the zpwrchrome download manager |
| `dl-resume-all` | *(user-set in `chrome://extensions/shortcuts`)* | Resume every paused download in the zpwrchrome download manager |

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

## [0x04] TAB SWITCHER MODAL

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
| `theme_ntp_background.png` | 3840×2400 | New-tab-page background (4K-ready) — grid + radial gradients + HUD corner brackets |
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
```

The service worker holds no globals — MRU lives in `chrome.storage.session`. Pure helpers in `lib/util.js` (JS) and `browserpass-host-rs/src/{ported,extensions}/` (Rust) carry no Chrome / Process references and are unit-tested in plain Node / `cargo test`. The native host is the Rust port of `browserpass-native` v3.1.2 plus three extension actions (`otp`, `search`, `dl.*`); each request spawns a fresh process (BP protocol) with download workers detaching to keep state under `$XDG_CACHE_HOME/zpwrchrome/dl/`.

---

## [0x07] CAPABILITY SURFACE

zpwrchrome is four daily-driver tools in one extension. Each row names a capability and what replaces / supersedes in the typical browser power-user stack.

| Capability | Replaces / supersedes | Implementation |
| --- | --- | --- |
| UNIX `pass` integration (fill / copy / OTP / open URL / basic-auth injection) | [browserpass-extension](https://github.com/browserpass/browserpass-extension) | client-side eTLD+1 + multi-label PSL match, server-side via the [browserpass-host-rs](https://crates.io/crates/browserpass-host-rs) Rust crate (PROTOCOL.md v3.1.2 compatible — drop-in for the Go binary) |
| Segmented multi-connection download manager (default-handler takeover) | Chrome's built-in download UI · Chrono / IDM-style extensions · `aria2c` | HEAD probe + N parallel `Range` GETs, cookies + User-Agent forwarded, retry with backoff, file-state worker model, full sidebar-nav queue page |
| JetBrains-style tab switcher (MRU + scenes + opener-tree + minimap) | [Recent Tabs by Jason Savard](https://jasonsavard.com/wiki/Recent_Tabs) · OneTab · Workona | cross-window MRU via `chrome.storage.session`, Alt+T popup with 11 categories, Cmd+E modal overlay, fzf scoring on every row, batch tab ops + clipboard utilities |
| fzf history search | Chrome's `chrome://history` page · the omnibox | re-ranks `chrome.history.search` results by frecency, up to 5000 entries, Backspace deletes inline |
| Tampermonkey-equivalent userscript engine | Tampermonkey · Greasemonkey · Violentmonkey | `@metadata` block parser, `@match` pattern compilation, full GM_* shim (getValue/setValue/openInTab/setClipboard/notification), fire-log ring buffer |

### Counts & invariants

| | |
| --- | --- |
| Total chrome.commands | **49** (manifest cap on default keys is 4 — this ext ships 4; the other 45 are user-bindable at `chrome://extensions/shortcuts`) |
| Manifest | **MV3** |
| License | **MIT** |
| Test suite | **2783** `node:test` cases (JS) + 74 `cargo test` cases (Rust) |
| Generator + doc-drift CI | Yes — README + landing page regenerated from `manifest.json` by `scripts/gen.sh`; CI fails on drift |
| Runtime deps | Zero on the JS side (pure ES-module SW). The Rust host adds `serde` / `serde_json` / `ureq` (foundational pure-Rust crates) and ships as a single static binary |

---

## [0x08] FILES

| Path | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, command registry (the only source of truth) |
| `background.js` | Service worker — MRU tracker, command dispatcher, popup message API, NM port (`nmCall`/`nmAddEventListener`), pass-fill injector, clipboard auto-clear, context-menu `Download with zpwrchrome`, `enrichDownloadArgs` (cookie + UA forwarding), `dl.snapshot` mirror |
| `lib/util.js` | Pure helpers — `mruPush`/`mruDrop`/`mruStep`/`mruPrevious`/`hostnameOf`/`resolveJumpIndex` |
| `popup.html` / `popup.css` / `popup.js` | Cyberpunk HUD popup with 11 categories including PASS (fill/user/pw/otp buttons) |
| `modal/content.js` | JetBrains-style Recent Tabs modal — content script, shadow DOM, 2-column layout |
| `scripts-manager/manager.{html,css,js}` | Userscript engine dashboard (Tampermonkey-equivalent) |
| `scripts-manager/downloads.{html,css,js}` | Live download queue UI — push-event subscription + cached snapshot rehydration |
| `browserpass-host-rs/Cargo.toml` / `browserpass-host-rs/src/{lib,frame}.rs` + `src/ported/**` + `src/extensions/**` + `src/bin/browserpass_host_rs.rs` | Rust port of `browserpass-native` v3.1.2 + extension actions (`otp`, `search`, `dl.*`) over length-prefixed JSON on stdio. Strict 1:1 port discipline (per-fn citations, Go comment carry-over) — see `browserpass-host-rs/docs/port_report.html` |
| `browserpass-host-rs --install <ext-id>` (CLI flag on the binary, not a separate script) | Writes `com.menketechnologies.zpwrchrome.json` into every detected Chromium-family browser config dir on macOS / Linux. `allowed_origins` is set to `chrome-extension://<ext-id>/` so the browser will only spawn the host for this extension |
| `browserpass-host-rs/tests/ported_*.rs` + `extensions_*.rs` | `cargo test` suite — per-fn pins for the port + extensions, end-to-end binary spawn tests, segmented download against a local HTTP fixture |
| `docs/index.html` | GitHub-Pages landing page (regenerated from manifest) |
| `docs/report.html` | Strykelang-style engineering report (regenerated from repo stats) |
| `theme/` | Companion Chrome theme — separate unpacked extension |
| `icons/icon.svg` + `icon{16,32,48,128}.png` | Extension icons; PNGs rasterized via `rsvg-convert` |
| `scripts/gen.sh` + `scripts/gen.mjs` | Regenerate `README.md` and `docs/index.html` from `manifest.json` |
| `tests/` | `node:test` suite — pure logic + static invariants + theme + protocol + pass / dl integration |
| `.github/workflows/ci.yml` | GitHub Actions — `npm test` on push/PR across Node 20 + 22 |
| `package.json` | `npm test` script |

---

## [0x09] TESTS

```sh
npm test
```

Stock Node ≥ 20, no external dependencies. 2783 tests across 171 files. Covers:

- **Pure logic** (`tests/logic*.test.js`, `tests/util-*.test.js`) — MRU stack semantics (prepend, dedup, cap, wrap, no-mutate, large-|delta| double-mod), hostname parse, jump-index resolution, scene CRUD, opener-tree forest (iterative flatten — handles 50k-deep chains without stack overflow), domain hue distribution, frecency formula
- **fzf scoring** (`tests/fzf*.test.js`) — match algorithm correctness, scoring constants (BOUNDARY ≥ NON_WORD ≥ CAMEL > CONSECUTIVE > 0), highlight integration (indices spell needle case-insensitively, HTML escape preserved inside marks), ranking stability over realistic filter passes
- **Userscript parser** (`tests/userscript*.test.js`, `tests/parseMetadata-*.test.js`, `tests/matchPatternToRegex-*.test.js`) — Tampermonkey/Greasemonkey metadata block parsing, match-pattern compilation per Chrome's spec (file/ftp/* scheme handling), validate→register→matchUrl pipeline roundtrip
- **GM_*/GM.* shim** (`tests/gm-shim*.test.js`, `tests/gm-background.test.js`) — every GM_* alias and gm:* message wiring against the background.js dispatcher
- **Fuzz** (`tests/fuzz-*.test.js`) — deterministic-PRNG sweeps over fzfMatch, util helpers, parseMetadata; adversarial inputs (regex metachars, nested markers, 100k-char values, pathological *.host patterns); Monte Carlo scene CRUD against a Map+order-list oracle
- **Stress** (`tests/stress-*.test.js`) — time budgets for keystroke-hot paths (10k fzfMatch < 1s, 100k mruPush < 2s, 500-item filter pipeline < 200ms); scale (1M mruPush, 10k-deep tree, 50k buildScene churn, 10k-pattern matchUrl); pathological inputs (all-same-char haystacks, 50k-char fzf, 60k-char rejection in O(haystack))
- **Static manifest invariants** (`tests/static.test.js`) — MV3, ≤4 suggested keys (Chrome ceiling), no macOS/Chrome-reserved defaults, no key collisions, kebab-case command names, every manifest command has a `background.js` handler and vice versa, every referenced file exists with correct PNG dimensions, popup HTML has no inline event handlers or inline `<script>` (MV3 CSP), strykelang palette intact in popup.css and docs/index.html, every declared permission is actually used in code, README + docs/index.html stay byte-identical after re-running `scripts/gen.sh`
- **Theme invariants** (`tests/theme.test.js`) — MV3 + `theme` block, no `action`/`background` (Chrome rejects mixed manifests), all theme images are PNGs at declared dimensions, every color is a 0–255 integer triplet, strykelang palette anchors pinned, version conforms to Chrome's 1–4-part 0–65535 rule
- **Popup ↔ background protocol** (`tests/protocol.test.js`) — every message `kind` sent by `popup.js` is handled by `background.js` and vice versa, no orphans on either side
- **Build pipeline** (`tests/build.test.js`, `tests/gen-pipeline.test.js`) — UTIL_INLINE/FZF_INLINE markers present + balanced, build-modal.mjs strips `export ` correctly, generated banner pinned, gen.sh counts tests dynamically

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
