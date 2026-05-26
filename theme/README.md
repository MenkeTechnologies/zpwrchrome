# zpwrchrome — Cyberpunk HUD theme

Companion Chrome theme for the [zpwrchrome](../) extension. Uses the strykelang
HUD palette (`#05050a` background, `#05d9e8` cyan, `#ff2a6d` accent, `#d300c5`
magenta) on the browser frame, toolbar, omnibox, and new-tab page.

## Install (unpacked)

Chrome themes cannot be bundled with action extensions, so this is a separate
unpacked extension.

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**, pick the `theme/` directory inside this repo

Chrome lets you keep at most one theme installed at a time. To remove, open
`chrome://settings/appearance` → **Reset to default**.

## Files

| Path | Purpose |
| --- | --- |
| `manifest.json` | MV3 theme manifest (palette colors + image bindings) |
| `images/theme_ntp_background.{svg,png}` | 1920×1200 new-tab-page background — grid + radial gradients + HUD corner brackets |
| `images/theme_frame.{svg,png}` | 1920×120 window-frame strip — gradient + seam glow |
| `images/theme_toolbar.{svg,png}` | 1920×80 toolbar background |

## Regenerating images

PNGs are rasterized from the SVG sources via `rsvg-convert`:

```sh
cd images
rsvg-convert -w 1920 -h 1200 theme_ntp_background.svg -o theme_ntp_background.png
rsvg-convert -w 1920 -h  120 theme_frame.svg          -o theme_frame.png
rsvg-convert -w 1920 -h   80 theme_toolbar.svg        -o theme_toolbar.png
```
