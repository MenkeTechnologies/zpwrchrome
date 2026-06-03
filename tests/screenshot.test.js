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

test("orchestrator restores scroll + overflow state even when capture throws (try/finally)", () => {
  // try/finally wraps captureTiles, restoreCaptureState in the finally.
  // The restore call is itself wrapped in try{} so even an exec failure
  // (e.g. tab navigated away mid-capture) doesn't propagate over the
  // original error.
  assert.match(shot, /try \{\s*tiles = await captureTiles[\s\S]*?\}\s*finally\s*\{[\s\S]*?restoreCaptureState[\s\S]*?\}/);
});

test("orchestrator uses scroll-overlap (GoFullPage technique) instead of DOM mutation for stickies", () => {
  // Mutating the DOM to neutralize position:fixed/sticky added reflow
  // latency that contributed to the captureVisibleTab throttle errors.
  // Replaced with a 200 px scroll overlap — the lower tile's pixels
  // overwrite the sticky banner from the upper tile.
  assert.match(shot, /const SCROLL_OVERLAP_PX\s*=\s*200/);
  assert.match(shot, /yStep\s*=\s*Math\.max\(1, vh - SCROLL_OVERLAP_PX\)/);
  // The old DOM-mutating functions are gone.
  assert.doesNotMatch(shot, /function hideStickies/);
  assert.doesNotMatch(shot, /function restoreStickies/);
  assert.doesNotMatch(shot, /data-zpc-screenshot-prev/);
  // Replacement: suppressScrollChrome saves overflow + scroll, sets
  // overflow:hidden during capture; restoreCaptureState reverts.
  assert.match(shot, /function suppressScrollChrome/);
  assert.match(shot, /function restoreCaptureState/);
  assert.match(shot, /style\.overflow\s*=\s*"hidden"/);
});

test("orchestrator caps page size so an infinite-scroll page can't hang the SW", () => {
  // Two caps: MAX_TILES on the grid + MAX_PIXELS on the canvas area.
  assert.match(shot, /MAX_TILES\s*=\s*\d+/);
  assert.match(shot, /MAX_PIXELS\s*=\s*[\d_]+\s*\*\s*[\d_]+/);
  assert.match(shot, /cols \* rows > MAX_TILES/);
  assert.match(shot, /sw \* dpr \* sh \* dpr > MAX_PIXELS/);
});

test("orchestrator captures scroll position so it can restore after", () => {
  // Scroll position is captured up-front in suppressScrollChrome's saved
  // bag and passed back through restoreCaptureState's args.
  const fn = shot.match(/function suppressScrollChrome\(\)[\s\S]*?return saved[\s\S]*?\n\}/);
  assert.ok(fn, "suppressScrollChrome not found");
  assert.match(fn[0], /scrollX:\s+window\.scrollX/);
  assert.match(fn[0], /scrollY:\s+window\.scrollY/);
  // restoreCaptureState uses scrollTo with behavior:instant so it doesn't
  // animate the page back to the original position.
  const r = shot.match(/function restoreCaptureState\(saved\)[\s\S]*?\n\}/);
  assert.ok(r, "restoreCaptureState not found");
  assert.match(r[0], /scrollTo\(\{\s*left:\s*saved\.scrollX,\s*top:\s*saved\.scrollY,\s*behavior:\s*"instant"\s*\}\)/);
});

test("orchestrator waits between captureVisibleTab calls — captureVisibleTab is ~2 Hz", () => {
  // CAPTURE_GAP_MS must comfortably exceed the 500 ms 1/2-Hz budget. 600 ms
  // gives headroom for SW jitter; the retry below handles the rare miss.
  const m = shot.match(/const CAPTURE_GAP_MS\s*=\s*(\d+)/);
  assert.ok(m, "CAPTURE_GAP_MS not declared");
  assert.ok(parseInt(m[1], 10) >= 500, `gap is only ${m[1]} ms — Chrome will throttle`);
  assert.match(shot, /new Promise\(\(res\) => setTimeout\(res, CAPTURE_GAP_MS\)\)/);
});

test("orchestrator retries with exponential backoff on MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND", () => {
  // User hit single-retry-not-enough in production. Now three retries
  // with 1100 → 2500 → 5000 ms backoff. Other errors re-throw immediately.
  assert.match(shot, /const RETRY_BACKOFF_MS\s*=\s*\[1100, 2500, 5000\]/);
  const fn = shot.match(/async function captureVisibleTabRetry[\s\S]*?\n\}/);
  assert.ok(fn, "captureVisibleTabRetry not found");
  assert.match(fn[0], /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/);
  // Loop bounded by backoff array length so we can't busy-spin.
  assert.match(fn[0], /attempt <= RETRY_BACKOFF_MS\.length/);
  assert.match(fn[0], /RETRY_BACKOFF_MS\[attempt\]/);
  // captureTiles uses the wrapper, not the raw API.
  assert.match(shot, /captureVisibleTabRetry\(tab\.windowId\)/);
});

test("orchestrator stitches tiles on OffscreenCanvas (SW-friendly, no DOM)", () => {
  assert.match(shot, /new OffscreenCanvas\(W, H\)/);
  assert.match(shot, /createImageBitmap\(blob\)/);
  // PNG output via convertToBlob — not the Canvas2D toBlob which doesn't
  // exist on OffscreenCanvas.
  assert.match(shot, /canvas\.convertToBlob\(\{ type: "image\/png" \}\)/);
});

test("orchestrator returns {blob, filename, host} — caller writes via bpSend directly", () => {
  // CRITICAL: chrome.runtime.sendMessage from the SW does NOT deliver to
  // the SW itself ("Could not establish connection. Receiving end does
  // not exist"). The earlier implementation tried to round-trip dl.writeFile
  // through sendMessage and silently dropped the bytes. The orchestrator
  // now just returns the blob; background.js calls bpSend in its own
  // catch-block right after.
  assert.match(shot, /return \{ blob, filename, host \}/);
  // No sendMessage call sites inside screenshot.js anymore (comments OK).
  assert.doesNotMatch(shot, /chrome\.runtime\.sendMessage\s*\(/);
  // blobToBase64 is now exported so background.js can encode in-SW.
  assert.match(shot, /export async function blobToBase64/);
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

test("orchestrator allows chrome-extension://<self> but rejects other schemes", () => {
  // user hit: tried screenshot on our manager page. http(s) + file are
  // allowed; chrome-extension://<our id>/* is allowed; chrome:// + web
  // store + other extensions are rejected with a named scheme error.
  assert.match(shot, /okHttp\s*=\s*\/\^\(https\?\|file\)/);
  assert.match(shot, /ourOwn\s*=\s*url\.startsWith\(`chrome-extension:\/\/\$\{chrome\.runtime\.id\}\/`\)/);
  assert.match(shot, /!okHttp && !ourOwn/);
});

test("orchestrator scrollTo uses behavior:instant — smooth scroll would race the capture", () => {
  const m = shot.match(/function scrollTo\(x, y\)[\s\S]*?\}/);
  assert.ok(m, "scrollTo helper missing");
  assert.match(m[0], /behavior: "instant"/);
});
