# zpwrchrome

Cyberpunk Chrome extension — recent-tabs switcher with 28 keyboard commands.
Same idea as [Recent Tabs by Jason Savard](https://jasonsavard.com/wiki/Recent_Tabs), but with a much larger keymap and the strykelang HUD aesthetic.

Built by [MenkeTechnologies](https://github.com/MenkeTechnologies). Manifest V3.

## Features

- Most-recently-used (MRU) tab tracking across all windows
- One-keystroke jump back to previous tab (`Alt+Z`, matches Recent Tabs)
- Restore most recently closed tab (`Alt+Shift+T`)
- Popup with live filter over both open and recently-closed tabs
- `↑`/`↓`/`Enter`/`Delete`/`Esc` keyboard nav inside the popup
- Window-level batch ops: close-others, close-right, close-duplicates, reload-all, sort-by-URL, group-by-domain
- Single-tab ops: duplicate, pin, mute, detach to new window, bookmark, copy URL, copy Markdown link
- Numeric tab jumps 1-9 (1-8 = nth tab; 9 = last tab)

## Install (unpacked)

1. `git clone https://github.com/MenkeTechnologies/zpwrchrome.git`
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked**, pick the cloned directory
5. Open `chrome://extensions/shortcuts` to bind any of the 24 user-configurable commands

## Keyboard commands

Chrome’s manifest allows at most 4 default-suggested shortcuts. The rest are
bound by the user from `chrome://extensions/shortcuts`. **4 ship with default keys**,
**24 are user-configurable**, for **28 total**.

| Command | Default | Description |
| --- | --- | --- |
| `_execute_action` | Alt+T | Open zpwrchrome popup |
| `switch-previous-tab` | Alt+Z | Switch to the previously active tab (MRU) |
| `restore-last-closed` | Alt+Shift+T | Restore the most recently closed tab |
| `search-tabs` | Alt+S | Open popup focused on the tab search box |
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

## Files

| Path | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, command registry |
| `background.js` | Service worker: MRU tracker, command dispatcher |
| `popup.html` / `popup.css` / `popup.js` | Cyberpunk HUD popup (palette from strykelang `docs/hud-static.css`) |
| `icons/icon.svg` | Source SVG; PNGs rasterized via `rsvg-convert` |
| `scripts/gen-readme.sh` | Regenerate this README from `manifest.json` |

## Regenerating this README

Command list and counts are derived from `manifest.json`. To refresh:

```sh
scripts/gen-readme.sh
```

## License

MIT, MenkeTechnologies.
