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
[![Commands](https://img.shields.io/badge/commands-55-ff2a6d.svg)](#0x02-keyboard-commands)
[![Theme](https://img.shields.io/badge/companion-theme-d300c5.svg)](theme/)
[![Docs](https://img.shields.io/badge/docs-online-05d9e8.svg)](https://menketechnologies.github.io/zpwrchrome/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### `[THE BROWSER POWER-TOOL — PASS · DOWNLOADS · TABS · HISTORY · USERSCRIPTS]`

> *"UNIX `pass` in the browser. Segmented download manager that owns the default. JetBrains-style tab switcher. fzf history. Tampermonkey-equivalent userscripts."*
>
> *"One extension, 55 commands, zero compromises."*

## `[CYBERPUNK HUD]`

A Chrome MV3 extension that bundles every daily-driver browser tool into one toolbar icon: a browserpass-compatible UNIX `pass` integration (fill / copy / OTP / auto-submit / basic-auth injection / full-page CRUD manager / profile + credit-card autofill), a segmented multi-connection download manager that intercepts every browser download by default (HEAD probe + parallel `Range` GETs via a vendored Rust host), a JetBrains-style tab switcher with cross-window MRU + named scenes + opener-tree + minimap, an fzf-fuzzy search over up to 5000 browser-history entries, a Tampermonkey-equivalent userscript engine, a full-page screenshot capture that scrolls the active tab and stitches the tiles into one PNG, a Wappalyzer-compatible technology detector that fingerprints the active page against a vendored 3,993-tech corpus, a cyberpunk page-theme injector that paints arbitrary pages with the strykelang HUD palette, a Turn Off the Lights cinema dimmer that lifts `<video>` above a dark overlay, an auto-detected JSON viewer + a sibling XML viewer (covers `application/xml`, `+xml` vendor types, SVG, RSS, Atom, plist, KML, GPX, …), a User-Agent switcher backed by `chrome.declarativeNetRequest` dynamic rules, a ModHeader-style request/response header + URL redirect manager (multi-profile, also via `chrome.declarativeNetRequest`), and a find-in-all-tabs full-text search. 51 commands bindable to keyboard shortcuts. Built by [MenkeTechnologies](https://github.com/MenkeTechnologies), Manifest V3, zero JS runtime dependencies.

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

`zpwrchrome` is a Chrome MV3 extension that bundles six daily-driver capabilities into one toolbar icon: UNIX `pass` integration (with full-page CRUD manager + profile / credit-card autofill), a segmented download manager that takes over Chrome's default, a JetBrains-style tab switcher with fzf history search, a Tampermonkey-equivalent userscript engine, full-page screenshot capture, and a Wappalyzer-compatible technology detector. 55 keyboard commands, a cyberpunk HUD popup, and a matching browser theme. Highlights:

- **MRU stack** — cross-window most-recently-used tracking via `chrome.storage.session`, survives service-worker restarts
- **Alt+T popup** — the cyberpunk HUD with 12 categories (All / Current Window / Pinned / Audible / Muted / Recently Closed / Scenes / Tree / Minimap / History / **Pass** / **Tech**), Cmd+1–0 jumps for the first ten, Cmd+P → Pass, Cmd+K → Tech, fzf scoring on every row
- **Cmd+E / Ctrl+E modal** — JetBrains-style Recent Files overlay: 2-column shadow-DOM modal injected into the active page with categories (All / Current Window / Pinned / Audible / Muted / Recently Closed), Cmd+1–6 category jumps, live filter, hold-cycle on the trigger key
- **Cmd+Y / Ctrl+Y history** — replaces Chrome’s built-in chrome://history page with an fzf-fuzzy search over up to 5000 entries, Backspace deletes the highlighted URL from history
- **UNIX `pass` integration** — replaces browserpass via a vendored Rust native-messaging host that walks `~/.password-store` with eTLD+1 + multi-label PSL matching, shells to `pass show`/`pass otp`, returns credentials over a length-prefixed JSON port. PASS popup category with fill / user / pw / otp buttons. Hotkeys: `pass-fill` autofills the active tab via injected `HTMLInputElement.value` setter (React/Vue safe) + input/change dispatch; `pass-copy-{pw,user,otp}` write to clipboard with 45 s auto-clear matching `pass -c`
- **Full-page pass manager** — `scripts-manager/pass.html` (toolbar right-click → "Open pass manager" or popup → `pass ▸`). Two-pane CRUD on `~/.password-store`: store tree (left, filter + ↑↓/Enter) + entry editor (right) with show/hide password, password generator, copy buttons per row, OTP-code copy via host, fill-active-tab, k/v list for non-synonym fields, free-form notes, delete with confirm scrim. `⚙ raw` toggle drops to a verbatim file-bytes textarea — escape hatch for entries with non-standard schemas. URL row auto-derives from the first path segment (`adobe.com/jmenke@wccnet.edu` → `adobe.com`) when no explicit `url:` key is present
- **Profile + credit-card autofill from `pass`** — two new commands: `pass-fill-profile` fills name / address / email / phone / etc. on the active tab from `profile/<name>` entries; `pass-fill-cc` fills card-number / exp / csc / cardholder from `creditcard/<name>` entries. Entry keys can be either the WHATWG HTML autocomplete tokens (`given-name`, `street-address`, `postal-code`, `cc-exp-month`, …) **or** friendly synonyms (`first-name`, `address`, `city`, `state`, `zipcode`, `cvv`, …) — both resolve to the same field. Field recognition: `<input autocomplete=…>` wins outright (composite forms like `shipping street-address` supported), then longest-synonym substring across name+id+label+placeholder (cvv/cvc/csc → cc-csc, first-name/fname → given-name, zip/postcode → postal-code), then `<input type="email|tel">`. Alias chains backfill: `cc-exp` ← month/year, `name` ← given+family, given/family ← split of `name`, `street-address` ← line1+line2+line3. Multi-entry stores get an in-tab shadow-DOM picker (filter input, last-used cached per host). Example `profile/personal.gpg` body — first line is a free-form label, the rest are friendly key:value pairs:

```text
personal
given-name: Jane
family-name: Doe
email: jane.doe@example.com
phone: +15551234
address: 123 Main St
city: Springfield
state: IL
zipcode: 62701
country: US
```

And `creditcard/visa.gpg`:

```text
visa
cc-name: Jane Doe
cc-number: 4111 1111 1111 1111
cc-exp-month: 09
cc-exp-year: 2031
cvv: 123
```

- **Segmented download accelerator** — same Rust host vendors a multi-connection download accelerator (IDM / aria2 / axel class): a HEAD probe sizes the file, then it is split into N byte-range segments fetched over N concurrent `Range` connections (default 6, pre-allocated dest file) to pull more throughput than Chrome's single-stream download. Segmented mode engages only when the server advertises `Accept-Ranges` and the file clears a minimum size; otherwise it falls back to a single stream. Cookie + User-Agent forwarded from `chrome.cookies.getAll` so logged-in downloads work; transient errors retry with 200 ms × 3ⁿ backoff and resume via `Range` from the segment-local offset. A truncated response — a CDN closing the connection before `Content-Length` bytes arrive — is detected (premature EOF on an incomplete segment is treated as resumable, not success) and a final byte-count gate refuses to stamp a job `done` when fewer than `Content-Length` bytes landed on disk, so a partial file never reports as complete; forward progress on a resume doesn't count against the retry budget so a repeatedly-truncating server still finishes. Per-row `restart` re-downloads from byte zero (discards the partial/old file, respawns a fresh worker — distinct from `resume`, which continues from the current offset). When a server answers HEAD without a `Content-Length` (streamed downloads behind X-Accel-Redirect / X-Sendfile), the total is recovered from the `Range` probe's `Content-Range` and a previously-known size survives a sizeless re-probe, so the UI shows a real total instead of `?`. Queue mirrored to `chrome.storage.local` so the UI paints instantly across service-worker restarts. Right-click `Download with zpwrchrome` on links / images / video / audio; `dl-paste-url` reads the clipboard via injected `navigator.clipboard.readText`. Live queue UI at `scripts-manager/downloads.html` subscribes to host push events. Filename collisions auto-rename `foo.zip` → `foo (1).zip`. Pure-Rust, vendorable TLS (`ureq`+rustls), no `aria2` or other runtime binary
- **Full-page screenshot** — `screenshot-full-page` command (or right-click toolbar icon → "Full-page screenshot (this tab)") captures the active tab edge-to-edge, including parts off-screen. Strategy: scroll the page in viewport-sized steps with a 200 px overlap, capture each viewport via `chrome.tabs.captureVisibleTab` (Chrome's hard ~2 Hz quota → 600 ms gap + exponential-backoff retry: 1.1 s → 2.5 s → 5 s), pin every `position: fixed` / `sticky` element to `static` during capture so stickies don't appear N times, stitch tiles on an `OffscreenCanvas` in the SW, stream the PNG to the host in 512 KiB base64 chunks via `dl.writeFileChunk` (Chrome's host → ext native-messaging cap is 1 MiB), then rename the upload `.part` file to the chosen filename in your downloads dir. Hard caps: 60 tiles, ~16k × 16k output pixels. No `chrome.debugger` permission required (so no permanent yellow "DevTools attached" banner)
- **Wappalyzer-compatible technology detection** — `lib/wappalyzer/engine.js` runs the vendored 3,993-fingerprint HTTPArchive/wappalyzer corpus (`lib/wappalyzer/data/technologies.json`, GPL-3 isolated under `LICENSE-WAPPALYZER`; engine code stays MIT). On every main_frame navigation: `webRequest.onCompleted` captures response headers per tabId; `webNavigation.onCompleted` injects `scrapeSignals` to harvest HTML / scripts / meta / cookies / window globals + pre-flights all 1,045 unique dom-selector rules in one pass; `detect()` runs the merged signals against the compiled corpus, implementing every matcher group (html / scripts / scriptSrc / text / url / meta / headers / cookies / js / dom — exists, text, attributes, properties) + implies/requires/excludes graph rewrites + `\\;version:\\1` backref resolution. The match count shares one toolbar badge with downloads + pass via `applyMultiplexedBadge` (see below); Cmd+K from the popup jumps to the 12th `Tech` category; `⤓ Export` ships the detected stack as JSON (filename `tech-<host>-<iso>.json`). `scripts/vendor-wappalyzer.sh` re-runs the corpus merge from a fresh upstream clone
- **ModHeader-style HTTP header manager** — multi-profile request/response header editor + URL redirect manager. Each profile owns N rules; only the **active** profile's enabled rules are projected into `chrome.declarativeNetRequest` dynamic rules (id range 2000-2999, sibling to the UA switcher's 1001). Rule kinds: **request header** (set / append / remove), **response header** (set / append / remove), **URL redirect** (`urlFilter`-scoped). Each rule carries its own `urlFilter` so a single profile can have per-site overrides. Settings UI at `scripts-manager/modheader.html` — sidebar profile list, click-to-activate, inline rule editor with name / value / op / filter fields; storage under `chrome.storage.local["modheader.state"]`. Survives SW suspension (rules re-applied on boot)
- **Three-channel toolbar badge** — single Chrome action badge multiplexes downloads (cyan), tech detection (orange), and pass matches (magenta). The visible NUMBER is the dominant counter by priority (downloads → tech → pass) and the COLOR follows it. Trailing letter tags spell out which other counters are coexisting: `t` = tech also detected, `l` = login (pass) also matching. So a tab with 10 active downloads + 5 tech + 2 pass renders `10tl`; 5 tech + 2 pass renders `5l`; 2 pass alone renders `2`. Tooltip spells out the plain-English breakdown for any state. `refreshActiveTabBadge` is the one orchestrator that repaints on `chrome.tabs.onActivated` + `chrome.tabs.onUpdated`
- **51 user-bindable commands** — Chrome caps default-suggested at 4; everything else binds at `chrome://extensions/shortcuts` (single-tab ops, batch ops, numeric jumps, clipboard utilities, pass-* + dl-*)
- **Sub-popup live filter** — type to filter open + closed tabs; `↑`/`↓`/`Enter`/`Delete`/`Esc` nav
- **Reader mode** — `modal/reader-mode.js` strips the active page to its main article and renders it in a fixed-position overlay with the strykelang HUD palette. Heuristic extraction (largest `<article>` → `<main>` / `[role="main"]` → densest paragraph cluster outside noise containers); cloned + sanitized DOM (scripts, iframes, nav, forms, inline event handlers stripped); A−/A+ font controls + Esc to close. Settings UI at `scripts-manager/reader-mode.html` — four themes (cyberpunk / classic-dark / classic-light / sepia), three font families (mono / serif / sans), font-size / line-width / line-height sliders, optional CRT scanlines. Original page DOM untouched
- **Post-download commands** — per-rule glob → argv-style command, fired by the SW the moment a download flips `active → done`. Rules are matched **top-to-bottom first-wins** against the finished file's basename (`*.zip`, `*.tar.gz`, case-insensitive). Argv is parsed shlex-style on the JS side and shipped as an array to the host's `run.spawn` action — `std::process::Command::new(argv[0]).args(argv[1..])` with **no shell invocation anywhere on the path**, so `{path}` substitution can't introduce a quoting or injection surface. Per-rule `confirm` flag pops a Chrome notification with Run / Skip buttons (pending argv survives SW suspends via `chrome.storage.session`). Placeholders: `{path}`, `{dir}`, `{name}`, `{base}`, `{ext}`. Output stdout/stderr are captured (64 KiB cap each), exit code is reported, and a 30s default timeout (max 5 min) kills runaways with code 124. Pipes / redirects / && require wrapping in `bash -c '…'` explicitly. Settings UI at `scripts-manager/dl-postcommands.html`
- **Turn off the lights (cinema mode)** — `modal/lights-off.js` injects a full-viewport near-black overlay over the active tab and lifts every visible `<video>` element (with its entire ancestor chain) above the overlay via `z-index`. Trigger via the `lights-off` command, the toolbar context menu `Turn off the lights (this tab)`, or popup → `lights ▸`. Click the overlay or press Esc to undim. Settings UI at `scripts-manager/lights-off.html` (opacity 0–1, fade duration ms, overlay color, per-host blocklist/allowlist). Port of the Turn Off the Lights Chrome extension
- **Color schemes (8)** — pick one of **Cyberpunk / Midnight / Matrix / Ember / Arctic / Crimson / Toxic / Vapor** from the theme page (`scripts-manager/theme-injector.html`). The palettes are vendored from the app-shell source of truth in `lib/color-schemes.js`; the choice recolors zpwrchrome's OWN pages (popup + every dashboard) at runtime via `lib/ui-scheme.js` (overriding each page's CSS `:root` default through `documentElement.style`, persisted under `chrome.storage.local["ui.scheme"]`, broadcast live over `storage.onChanged`) AND sets the page-theme injector palette below. One pick, both surfaces
- **Cyberpunk page-theme injector** — `modal/cyber-theme.js` runs at `document_start` on every http(s) tab and paints arbitrary pages with the chosen scheme's palette (the strykelang HUD palette by default). Settings UI at `scripts-manager/theme-injector.html` (toolbar right-click → "Open theme injector" or popup → `theme ▸`). Knobs: **intensity** (subtle = links + headings + scrollbars only / medium = + body bg + form fields + code blocks / full = + tables, cards, dimmed images), **dark mode** (smart overlay — `color-scheme: dark` + targeted overrides for common white-card patterns: AUI `.a-box` / `.order-header` / `.delivery-box` / `.bia-content`, generic `[class*="card|panel|widget"]`, ARIA dialogs, inline `background: white|#fff|rgb(255,…)`; deliberately NOT `filter: invert()` so already-dark pages stay dark), **forceMono** (Share Tech Mono everywhere — exempts icon-font carriers `<i>` / `<svg>` / `[class*="icon|fa-|material-icons|material-symbols|lucide|phosphor|glyphicon"]` / `[data-icon|data-lucide|data-cds="Icon"|data-radix-icon]` so Anthropicons, Material Symbols, Lucide, etc. keep their glyphs instead of rendering as PUA tofu), and **scanlines** (CRT overlay via `body::after`). Per-host blocklist / allowlist via the textarea; settings broadcast to every tab over `chrome.storage.onChanged`
- **Save to zcite (web connector)** — page right-click → `Save page to zcite (reference)` extracts the active page's bibliographic metadata into CSL-JSON (`lib/zcite-extract.js`: Highwire `citation_*` tags + Dublin Core + Open Graph + schema.org JSON-LD), then the native host's `zcite.save` action drops it into zcite's inbox (`<data_dir>/zcite/inbox/`) for zcite's `inbox.import` to pull in. The Zotero-Connector role for the [zcite](https://github.com/MenkeTechnologies/zcite) reference manager; the handoff is a plain CSL-JSON file, so the MIT extension/host never link the proprietary zcite engine
- **Companion Chrome theme** — `theme/` paints frame/toolbar/omnibox/NTP with the strykelang HUD palette
- **Strykelang HUD aesthetic** — palette and animations sourced from `strykelang/docs/hud-static.css` (`--cyan #05d9e8`, `--accent #ff2a6d`, `--magenta #d300c5`, CRT scanlines, neon-border-glow card frames)
- **Pure-helper test surface** — MRU stack semantics, hostname parsing, jump-index resolution in `lib/util.js` + pass match/parse + dl filename/collision helpers in `zpwrchrome-host/src/{ported,extensions}/` all unit-tested without a Chrome runtime
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
4. Open `chrome://extensions/shortcuts` to bind any of the 51 user-configurable commands

#### Native messaging host (required for `pass`, downloads, screenshots)

1. Install GPG + `pass` if you want the password-store integration (`brew install pass` on macOS, `apt install pass` on Debian/Ubuntu); make sure `pass show` decrypts an entry from your shell first. (Skip if you only want downloads + screenshots.)
2. Install the host binary from crates.io and register it for this extension's ID:

```sh
cargo install zpwrchrome-host
# find your extension ID at chrome://extensions (Developer mode), then:
zpwrchrome-host --install <ext-id>
```

The installer writes `com.menketechnologies.zpwrchrome.json` into every detected Chromium-family browser config dir (Chrome / Chromium / Brave / Edge / Arc / Vivaldi on macOS + Linux). `allowed_origins` is populated with `chrome-extension://<ext-id>/` so the browser will only spawn the host for this extension. Reload the extension at `chrome://extensions` after running it.

To upgrade later: `cargo install zpwrchrome-host --force` — the NM manifest already points at `$CARGO_HOME/bin/zpwrchrome-host` so no re-install is needed.

#### Theme

1. **Load unpacked** the `theme/` subdirectory (separate Chrome extension — themes cannot be bundled with action extensions)
2. `chrome://settings/appearance` → **Reset to default** to remove

---

## [0x02] KEYBOARD COMMANDS

Chrome’s MV3 manifest allows at most **4** commands with default-suggested keys; the rest are bound by the user at `chrome://extensions/shortcuts`. `zpwrchrome` ships **4** default-keyed and **51** user-bindable, for **55 total** — covering pass actions, download manager, tab switcher, history search, and userscript management.

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
| `open-dashboard` | *(user-set in `chrome://extensions/shortcuts`)* | Open the zpwrchrome dashboard — a searchable tile grid of every tool, settings page and info screen |
| `manage-scripts` | *(user-set in `chrome://extensions/shortcuts`)* | Open the userscript manager (Tampermonkey-style) |
| `save-scene-prompt` | *(user-set in `chrome://extensions/shortcuts`)* | Open popup focused on save-scene input |
| `restore-scene-1` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #1 (newest) — opens a new window with saved tabs |
| `restore-scene-2` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #2 |
| `restore-scene-3` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #3 |
| `restore-scene-4` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #4 |
| `restore-scene-5` | *(user-set in `chrome://extensions/shortcuts`)* | Restore scene #5 |
| `pass-open-popup` | *(user-set in `chrome://extensions/shortcuts`)* | Open popup focused on the PASS category (matches credentials for the active tab from ~/.password-store via the zpwrchrome native host) |
| `pass-fill` | Ctrl+Shift+L | Autofill the best-matching `pass` credential into the active tab's login form (requires the native host) — customize at chrome://extensions/shortcuts |
| `pass-copy-pw` | *(user-set in `chrome://extensions/shortcuts`)* | Copy the best-matching `pass` password for the active tab to the clipboard (auto-clears after 45 s) |
| `pass-copy-user` | *(user-set in `chrome://extensions/shortcuts`)* | Copy the best-matching `pass` username for the active tab to the clipboard |
| `pass-copy-otp` | *(user-set in `chrome://extensions/shortcuts`)* | Copy the TOTP code for the best-matching `pass` entry to the clipboard |
| `pass-open-url` | *(user-set in `chrome://extensions/shortcuts`)* | Navigate the active tab to the URL stored in the best-matching `pass` entry (parses url/link/website/web/site keys) |
| `pass-fill-identity` | *(user-set in `chrome://extensions/shortcuts`)* | Fill whatever identity fields the active tab has — profile (name/address/email/phone/…) AND credit-card (cc-number/cc-exp/cc-csc/cardholder/…) in one keystroke. Picks the best-matching profile/* and creditcard/* entries (picker if multiple, last-used cached per host). |
| `pass-fill-profile` | *(user-set in `chrome://extensions/shortcuts`)* | Fill profile fields only (name, address, email, phone, …) on the active tab from a `profile/*` entry in `pass`. Quick-pick overlay when multiple profiles exist. |
| `pass-fill-cc` | *(user-set in `chrome://extensions/shortcuts`)* | Fill credit-card fields only (cc-number, cc-exp, cc-csc, cardholder, …) on the active tab from a `creditcard/*` entry in `pass`. Quick-pick overlay when multiple cards exist. |
| `find-in-all-tabs` | *(user-set in `chrome://extensions/shortcuts`)* | Full-text search across every open tab — opens a search UI, scrapes innerText from every http(s) tab in parallel, fuzzy-filters as you type, Enter activates the chosen tab and scrolls to the match (no DevTools required) |
| `lights-off` | *(user-set in `chrome://extensions/shortcuts`)* | Turn off the lights — dim the entire active page with a near-black overlay while lifting any video elements above it (cinema-mode for YouTube and beyond). Click the overlay or press Esc to undim |
| `reader-mode` | *(user-set in `chrome://extensions/shortcuts`)* | Reader mode — strip the active page to its main article and render it in a strykelang HUD overlay with adjustable typography. Click × in the top bar or press Esc to close |
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

The service worker holds no globals — MRU lives in `chrome.storage.session`. Pure helpers in `lib/util.js` (JS) and `zpwrchrome-host/src/{ported,extensions}/` (Rust) carry no Chrome / Process references and are unit-tested in plain Node / `cargo test`. The native host is the Rust port of `browserpass-native` v3.1.2 plus three extension actions (`otp`, `search`, `dl.*`); each request spawns a fresh process (BP protocol) with download workers detaching to keep state under `$XDG_CACHE_HOME/zpwrchrome/dl/`.

---

## [0x07] CAPABILITY SURFACE

zpwrchrome is six daily-driver tools in one extension. Each row names a capability and what replaces / supersedes in the typical browser power-user stack.

| Capability | Replaces / supersedes | Implementation |
| --- | --- | --- |
| UNIX `pass` integration (fill / copy / OTP / open URL / basic-auth injection) | [browserpass-extension](https://github.com/browserpass/browserpass-extension) | client-side eTLD+1 + multi-label PSL match, server-side via the [zpwrchrome-host](https://crates.io/crates/zpwrchrome-host) Rust crate (PROTOCOL.md v3.1.2 compatible — drop-in for the Go binary) |
| Full-page `pass` manager (CRUD on `~/.password-store`) | upstream browserpass-extension's options page · the standalone `pass` TUI · 1Password / Bitwarden vault UIs (for the GPG-backed flow) | `scripts-manager/pass.{html,css,js}` — store tree (left) + form editor (right) talking to the BP `list` / `fetch` / `save` / `delete` actions over NM. Versioned alongside the extension; no separate install |
| Profile + credit-card autofill from `pass` (`profile/*` + `creditcard/*` entries) | Chrome's built-in autofill profiles · 1Password / Bitwarden card filler | `lib/identity-tokens.js` + page-injected `fillIdentityForm()`. Entry keys use WHATWG HTML autocomplete tokens directly — the store IS the schema. Longest-synonym recognition; alias chains backfill missing tokens; React/Vue-safe native value-setter pattern across all frames; in-tab shadow-DOM picker with last-used cache per host |
| Segmented download accelerator (multi-connection, default-handler takeover) | Chrome's built-in single-stream download UI · IDM / FDM / DAP · `aria2c` · `axel` | A real download accelerator: HEAD probe → split the file into N byte ranges → fetch them over N concurrent `Range` connections to saturate bandwidth a single stream can't, then reassemble in a pre-allocated dest file. Cookies + User-Agent forwarded, retry with backoff, file-state worker model, full sidebar-nav queue page |
| JetBrains-style tab switcher (MRU + scenes + opener-tree + minimap) | [Recent Tabs by Jason Savard](https://jasonsavard.com/wiki/Recent_Tabs) · OneTab · Workona | cross-window MRU via `chrome.storage.session`, Alt+T popup with 12 categories, Cmd+E modal overlay, fzf scoring on every row, batch tab ops + clipboard utilities |
| Wappalyzer-compatible technology detection | [Wappalyzer](https://www.wappalyzer.com/) · BuiltWith · Stack Inspector | `lib/wappalyzer/engine.js` runs the vendored 3,993-fingerprint HTTPArchive/wappalyzer corpus (`lib/wappalyzer/data/technologies.json`, GPL-3 isolated under `LICENSE-WAPPALYZER`). Every matcher type implemented: html / scripts / scriptSrc / text / url / meta / headers / cookies / js / dom (exists + text + attributes + properties). Implies / requires / excludes graph rewrites. Cmd+K from the popup, ⤓ Export to JSON, three-channel toolbar badge with letter tags (`10tl` = 10 downloads + tech + login matches) |
| fzf history search | Chrome's `chrome://history` page · the omnibox | re-ranks `chrome.history.search` results by frecency, up to 5000 entries, Backspace deletes inline |
| Tampermonkey-equivalent userscript engine | Tampermonkey · Greasemonkey · Violentmonkey | `@metadata` block parser, `@match` pattern compilation, full GM_* shim (getValue/setValue/openInTab/setClipboard/notification), fire-log ring buffer |
| Full-page screenshot (off-screen content included, no debugger banner) | GoFullPage · FireShot · Awesome Screenshot | `lib/screenshot.js` — scroll + viewport-capture + `OffscreenCanvas` stitch in the SW. Sticky/fixed elements pinned to `position: static` during capture. PNG streamed to the host via chunked `dl.writeFileChunk` (Chrome's 1 MiB host → ext NM cap), lands in your configured downloads dir |

### Counts & invariants

| | |
| --- | --- |
| Total chrome.commands | **55** (manifest cap on default keys is 4 — this ext ships 4; the other 51 are user-bindable at `chrome://extensions/shortcuts`) |
| Manifest | **MV3** |
| License | **MIT** |
| Test suite | **3022** `node:test` cases (JS) + 127 `cargo test` cases (Rust) |
| Generator + doc-drift CI | Yes — README + landing page regenerated from `manifest.json` by `scripts/gen.sh`; CI fails on drift |
| Runtime deps | Zero on the JS side (pure ES-module SW). The Rust host adds `serde` / `serde_json` / `ureq` (foundational pure-Rust crates) and ships as a single static binary |

---

## [0x08] FILES

| Path | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, command registry (the only source of truth) |
| `background.js` | Service worker — MRU tracker, command dispatcher, popup message API, NM port (`nmCall`/`nmAddEventListener`), pass-fill injector, clipboard auto-clear, context-menu `Download with zpwrchrome`, `enrichDownloadArgs` (cookie + UA forwarding), `dl.snapshot` mirror, `passFillIdentityActive` profile/CC dispatcher, in-tab shadow-DOM picker, `fillIdentityForm` token-driven page injector |
| `lib/util.js` | Pure helpers — `mruPush`/`mruDrop`/`mruStep`/`mruPrevious`/`hostnameOf`/`resolveJumpIndex` |
| `lib/bp-pass.js` | Pure pass helpers — `parseEntry` / `fallbackUsernameFromPath` / `fallbackUrlFromPath` / `matchIn` / eTLD+1 `candidates` |
| `lib/pass-entry.js` | Pure pass-entry serializer — `formatEntry` (inverse of `parseEntry`), `validatePassPath`, `buildTree` |
| `lib/identity-tokens.js` | Profile + credit-card autofill — `PROFILE_TOKENS` / `CC_TOKENS` (WHATWG HTML autocomplete vocabulary), `TOKEN_SYNONYMS` (longest-match recognition), `recognizeField`, `expandFieldValue` (alias chains: cc-exp ↔ month/year, name ↔ given/family, street-address ↔ line1/2/3) |
| `popup.html` / `popup.css` / `popup.js` | Cyberpunk HUD popup with 12 categories including PASS (fill/user/pw/otp buttons) + TECH (Wappalyzer detection) + `pass ▸` link to the full-page pass manager |
| `lib/wappalyzer/engine.js` | Pure-JS Wappalyzer-compatible detection engine — pattern compilation, every signal-group matcher, `\\;version:\\1` backref resolution, implies/requires/excludes graph rewrites, page-side `scrapeSignals` injection |
| `lib/wappalyzer/data/technologies.json` + `categories.json` | Vendored 3,993-fingerprint upstream corpus (HTTPArchive/wappalyzer, GPL-3 — see `LICENSE-WAPPALYZER` adjacent). `scripts/vendor-wappalyzer.sh` re-runs the merge from a fresh upstream clone |
| `scripts-manager/pass.{html,css,js}` | Full-page pass manager — store tree (left) + entry editor (right); CRUD via the BP `list` / `fetch` / `save` / `delete` actions; raw-bytes textarea toggle; URL row auto-derives from the first path segment when no `url:` key is present |
| `modal/content.js` | JetBrains-style Recent Tabs modal — content script, shadow DOM, 2-column layout |
| `scripts-manager/manager.{html,css,js}` | Userscript engine dashboard (Tampermonkey-equivalent) |
| `scripts-manager/downloads.{html,css,js}` | Live download queue UI — push-event subscription + cached snapshot rehydration |
| `scripts-manager/theme-injector.{html,css,js}` + `lib/color-schemes.js` + `lib/ui-scheme.js` + `lib/cyber-theme-css.js` + `modal/cyber-theme.js` | Color scheme + cyberpunk page-theme injector — pick one of 8 schemes (Cyberpunk / Midnight / Matrix / Ember / Arctic / Crimson / Toxic / Vapor, vendored from the app-shell palette in `lib/color-schemes.js`). The choice recolors zpwrchrome's own pages (popup + dashboards, applied at runtime by `lib/ui-scheme.js`, persisted under `chrome.storage.local["ui.scheme"]`) AND drives the page-theme injector palette. Page-theme knobs: `color-scheme: dark` + targeted overrides for white-card patterns + intensity / forceMono / scanlines; settings persisted under `chrome.storage.local["theme.injector"]` and broadcast to every tab via `storage.onChanged` |
| `scripts-manager/lights-off.{html,css,js}` + `lib/lights-off-css.js` + `modal/lights-off.js` | Turn-off-the-lights cinema dimmer — full-viewport overlay + `<video>` lifted above via `z-index: 2147483647`. Click overlay or Esc to undim; per-host block/allowlist; settings under `chrome.storage.local["lights.off"]` |
| `scripts-manager/reader-mode.{html,css,js}` + `lib/reader-mode-css.js` + `modal/reader-mode.js` | Reader mode — extract article via heuristic (`<article>` → `<main>` → densest paragraph cluster), sanitize (strip scripts/iframes/nav/forms/inline-handlers), render in a fixed overlay with the strykelang palette. Four themes × three font families; A−/A+ live bumpers in the top bar; settings under `chrome.storage.local["reader.mode"]` |
| `scripts-manager/dl-postcommands.{html,css,js}` + `lib/dl-postcommands.js` + `zpwrchrome-host/src/extensions/run_command.rs` | Post-download custom commands — basename-glob → argv (first-match-wins); per-rule `confirm` notification with Run / Skip buttons survives SW suspends via `chrome.storage.session`. Host `run.spawn` action spawns via `std::process::Command` (no shell), captures stdout/stderr capped at 64 KiB each, 30s default / 5min max timeout (kill → code 124). Placeholders: `{path}` `{dir}` `{name}` `{base}` `{ext}`; settings under `chrome.storage.local["dl.postCommands"]` |
| `scripts-manager/ua-switcher.{html,css,js}` + `lib/ua-presets.js` | User-Agent switcher — 16 vendor-shipped presets across 6 families plus a custom UA field. Backed by a single `chrome.declarativeNetRequest` dynamic rule (id 1001) that rewrites the `User-Agent` request header |
| `scripts-manager/modheader.{html,css,js}` | ModHeader-style HTTP header manager — multi-profile, per-rule `set` / `append` / `remove` on request OR response headers plus URL-filter-scoped redirects. Backed by `chrome.declarativeNetRequest` dynamic rules in id range 2000-2999 (UA switcher owns 1001). Only the active profile's enabled rules project into DNR; storage under `chrome.storage.local["modheader.state"]` |
| `scripts-manager/find-all.{html,css,js}` + `lib/find-snippet.js` | Find-in-all-tabs — fzf-fuzzy search across every open tab's `innerText` (parallel scrape capped at 200 KB / tab). Enter activates the chosen tab and scrolls to the match via `window.find()` |
| `modal/json-viewer.js` + `lib/json-format.js` | Auto-detects JSON-served pages and replaces `<pre>` with a collapsible tree (RFC 6901 pointer copy, prettyPrint / minify toggles, clipboard with `execCommand` fallback for non-secure contexts) |
| `modal/xml-viewer.js` + `lib/xml-format.js` | Auto-detects XML/SVG/RSS/Atom/plist/KML/GPX served pages and replaces `<pre>` with a DOMParser-driven collapsible tree. Attribute coloring, CDATA / comment / PI rendering, XPath copy per node, live filter, prettyPrint / minify / raw toggles, http(s) auto-linkify in text + attribute values |
| `zpwrchrome-host/Cargo.toml` / `zpwrchrome-host/src/{lib,frame}.rs` + `src/ported/**` + `src/extensions/**` + `src/bin/zpwrchrome_host.rs` | Rust port of `browserpass-native` v3.1.2 + extension actions (`otp`, `search`, `dl.*`) over length-prefixed JSON on stdio. Strict 1:1 port discipline (per-fn citations, Go comment carry-over) — see `zpwrchrome-host/docs/port_report.html` |
| `zpwrchrome-host --install <ext-id>` (CLI flag on the binary, not a separate script) | Writes `com.menketechnologies.zpwrchrome.json` into every detected Chromium-family browser config dir on macOS / Linux. `allowed_origins` is set to `chrome-extension://<ext-id>/` so the browser will only spawn the host for this extension |
| `zpwrchrome-host/tests/ported_*.rs` + `extensions_*.rs` | `cargo test` suite — per-fn pins for the port + extensions, end-to-end binary spawn tests, segmented download against a local HTTP fixture |
| `docs/index.html` | GitHub-Pages landing page (regenerated from manifest) |
| `docs/report.html` | Strykelang-style engineering report (regenerated from repo stats) |
| `theme/` | Companion Chrome theme — separate unpacked extension |
| `icons/icon.svg` + `icon{16,32,48,128}.png` | Extension icons; PNGs rasterized via `rsvg-convert` |
| `scripts/gen.sh` + `scripts/gen.mjs` | Regenerate `README.md` and `docs/index.html` from `manifest.json` |
| `tests/` | `node:test` suite — pure logic + static invariants + theme + protocol + pass / dl integration |
| `.github/workflows/ci.yml` | GitHub Actions — `npm test` (Node 20 + 22) + `cargo test --locked` for the host crate, on push/PR |
| `package.json` | `npm test` script |

---

## [0x09] TESTS

```sh
npm test
```

Stock Node ≥ 20, no external dependencies. 3022 tests across 188 files. Covers:

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

`.github/workflows/ci.yml` runs `npm test` on every push and pull-request. Matrix: Node `20` + `22` on `ubuntu-latest`. The Node 22 leg also runs `cargo test --locked` against the `zpwrchrome-host` crate (the Rust download/pass host), so JS and Rust regressions both block merge. The doc-drift test (re-run `scripts/gen.sh` and compare) catches stale README / landing page in the same job.

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
