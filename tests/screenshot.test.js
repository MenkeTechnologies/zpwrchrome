// Full-page screenshot orchestrator — static-shape contract tests.
// The actual capture requires a real Chrome window so we pin structural
// invariants instead of execution behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const shot = read("lib/screenshot.js");
const bg   = read("background.js");
const mfst = JSON.parse(read("manifest.json"));

test("screenshot orchestrator exports captureFullPage + screenshotFullPage", () => {
  assert.match(shot, /export async function captureFullPage/);
  assert.match(shot, /export async function screenshotFullPage/);
});

test("orchestrator probes page dimensions before scrolling", () => {
  assert.match(shot, /function probeDims\(\)/);
  // Reads scrollX/Y so it can RESTORE after the capture (no surprise scroll).
  assert.match(shot, /scrollX: window\.scrollX/);
  assert.match(shot, /scrollY: window\.scrollY/);
  // Reads scrollWidth + scrollHeight via the canonical root so it works on
  // pages where document.body is the actual scroller (quirks mode).
  assert.match(shot, /scrollingElement \|\| document\.documentElement/);
  assert.match(shot, /devicePixelRatio/);
});

test("orchestrator restores original scroll + sticky styles even when capture throws", () => {
  // Try/finally wraps captureTiles, restoreStickies + scrollTo in the finally.
  assert.match(shot, /try \{\s*tiles = await captureTiles[\s\S]*?\}\s*finally\s*\{[\s\S]*?restoreStickies[\s\S]*?scrollTo[\s\S]*?\}/);
});

test("orchestrator caps page size so an infinite-scroll page can't hang the SW", () => {
  // Two caps: MAX_TILES on the grid + MAX_PIXELS on the canvas area.
  assert.match(shot, /MAX_TILES\s*=\s*\d+/);
  assert.match(shot, /MAX_PIXELS\s*=\s*[\d_]+\s*\*\s*[\d_]+/);
  assert.match(shot, /cols \* rows > MAX_TILES/);
  assert.match(shot, /sw \* dpr \* sh \* dpr > MAX_PIXELS/);
});

test("orchestrator hides fixed/sticky elements before capture, restores after", () => {
  assert.match(shot, /function hideStickies\(\)/);
  assert.match(shot, /function restoreStickies\(\)/);
  // Marker attribute so restore can find them without a closure roundtrip
  // (the SW-injected functions can't share state with each other).
  assert.match(shot, /data-zpc-screenshot-prev/);
  // Both fixed AND sticky positions get neutralized.
  assert.match(shot, /cs\.position === "fixed" \|\| cs\.position === "sticky"/);
});

test("orchestrator waits between captureVisibleTab calls — captureVisibleTab is ~2 Hz", () => {
  // CAPTURE_GAP_MS must be ≥ 400 to clear Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND.
  const m = shot.match(/const CAPTURE_GAP_MS\s*=\s*(\d+)/);
  assert.ok(m, "CAPTURE_GAP_MS not declared");
  assert.ok(parseInt(m[1], 10) >= 400, `gap is only ${m[1]} ms — Chrome will throttle`);
  assert.match(shot, /new Promise\(\(res\) => setTimeout\(res, CAPTURE_GAP_MS\)\)/);
});

test("orchestrator stitches tiles on OffscreenCanvas (SW-friendly, no DOM)", () => {
  assert.match(shot, /new OffscreenCanvas\(W, H\)/);
  assert.match(shot, /createImageBitmap\(blob\)/);
  // PNG output via convertToBlob — not the Canvas2D toBlob which doesn't
  // exist on OffscreenCanvas.
  assert.match(shot, /canvas\.convertToBlob\(\{ type: "image\/png" \}\)/);
});

test("orchestrator writes via host dl.writeFile so settings.downloadDir wins", () => {
  // chrome.downloads.download cannot override Chrome's default Downloads
  // folder, so the user's configured downloadDir would be ignored. Route
  // the PNG bytes through the native host instead — same path as every
  // other download in this extension.
  assert.match(shot, /kind: "dl\.writeFile"/);
  assert.match(shot, /resolvePreferredDownloadDir/);
  // Priority: explicit downloadDir > tracked lastDir > host default (= "").
  const fn = shot.match(/async function resolvePreferredDownloadDir[\s\S]*?\n\}/);
  assert.ok(fn, "resolvePreferredDownloadDir not found");
  assert.match(fn[0], /s\.downloadDir/);
  assert.match(fn[0], /s\.saveToLastUsedLocation && s\.lastDir/);
  // base64 encoding is chunked so a multi-MB blob doesn't blow the call stack.
  assert.match(shot, /async function blobToBase64/);
  assert.match(shot, /CHUNK\s*=\s*0x8000/);
  assert.match(shot, /String\.fromCharCode\.apply\(null, bytes\.subarray/);
});

test("orchestrator filename includes hostname + ISO timestamp", () => {
  assert.match(shot, /hostnameFromUrl\(tab\.url/);
  assert.match(shot, /new Date\(\)\.toISOString\(\)\.replace\(\/\[:.\]\/g, "-"\)/);
  assert.match(shot, /zpwrchrome-\$\{host \|\| "page"\}-\$\{stamp\}\.png/);
});

test("manifest declares screenshot-full-page command (no default key — user binds it)", () => {
  const cmd = mfst.commands["screenshot-full-page"];
  assert.ok(cmd, "screenshot-full-page command missing");
  assert.ok(typeof cmd.description === "string" && cmd.description.length > 10);
  // Description points users at chrome://extensions/shortcuts for rebinding.
  assert.match(cmd.description, /chrome:\/\/extensions\/shortcuts/);
  // No suggested_key — captureVisibleTab needs a user gesture; the
  // chrome.commands invocation itself is the gesture, so any user-bound
  // key works. Auto-binding could collide with site shortcuts.
  assert.ok(!cmd.suggested_key, "screenshot command should not auto-bind a default key");
});

test("background.js wires the command + toolbar-icon context menu + diag trace", () => {
  // Command dispatcher.
  assert.match(bg, /command === "screenshot-full-page"\)\s*return doScreenshotFullPage\(\)/);
  // Wrapper handles success + failure notifications and traces both paths
  // to the diag ring buffer.
  const fn = bg.match(/async function doScreenshotFullPage[\s\S]*?\n\}/);
  assert.ok(fn, "doScreenshotFullPage not found");
  assert.match(fn[0], /diagPush\("screenshot\.start"/);
  assert.match(fn[0], /diagPush\("screenshot\.done"/);
  assert.match(fn[0], /diagPush\("screenshot\.err"/);
  assert.match(fn[0], /chrome\.notifications\.create/);
  // Toolbar context menu entry.
  assert.match(bg, /const CTX_ACT_SHOT/);
  assert.match(bg, /Full-page screenshot \(this tab\)/);
  assert.match(bg, /info\.menuItemId === CTX_ACT_SHOT/);
});

test("orchestrator scrollTo uses behavior:instant — smooth scroll would race the capture", () => {
  const m = shot.match(/function scrollTo\(x, y\)[\s\S]*?\}/);
  assert.ok(m, "scrollTo helper missing");
  assert.match(m[0], /behavior: "instant"/);
});
