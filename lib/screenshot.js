// zpwrchrome — full-page screenshot orchestrator.
//
// Strategy: scroll the active tab through its full scrollHeight in
// viewport-sized steps, capture each viewport via
// chrome.tabs.captureVisibleTab, and stitch the tiles together on an
// OffscreenCanvas in the SW. Outputs a PNG blob downloaded through
// chrome.downloads.download (blob: URLs are already exempt from the
// extension's takeover handler, so this lands cleanly in Chrome's
// Downloads folder without going through the segmented host).
//
// Limits:
//   * captureVisibleTab is throttled at ~2 Hz — we sleep CAPTURE_GAP_MS
//     between captures to stay within the budget.
//   * MAX_TILES caps runaway infinite-scroll pages.
//   * MAX_PIXELS caps the output canvas at ~16k×16k to keep memory bounded.
//   * Fixed/sticky elements get an injected `position: static !important`
//     during the capture so they don't appear N times in the stitched
//     output; original styles are reverted on completion.

// Chrome enforces MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND ≈ 2. 600 ms
// puts us comfortably under the budget even with SW jitter; on the rare
// quota miss the captureVisibleTabRetry wrapper backs off to 1100 ms.
const CAPTURE_GAP_MS = 600;
const MAX_TILES      = 60;
const MAX_PIXELS     = 16_000 * 16_000;

export const SCREENSHOT_VERSION = 1;

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function exec(tabId, func, args) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func, args,
  });
  return result;
}

// Injected: read page dimensions + current scroll + device pixel ratio.
function probeDims() {
  const root = document.scrollingElement || document.documentElement;
  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    vw: window.innerWidth,
    vh: window.innerHeight,
    sw: Math.max(root.scrollWidth,  root.clientWidth,  document.body?.scrollWidth  || 0),
    sh: Math.max(root.scrollHeight, root.clientHeight, document.body?.scrollHeight || 0),
    dpr: window.devicePixelRatio || 1,
  };
}

// Injected: scroll to absolute position (no smooth scroll — we want
// the next captureVisibleTab to see the new viewport immediately).
function scrollTo(x, y) {
  window.scrollTo({ left: x, top: y, behavior: "instant" });
}

// Injected: tag every element with position fixed|sticky and remember
// its inline style so we can restore. Returns nothing — the marker
// attribute `data-zpc-screenshot-static` is what we rely on later.
function hideStickies() {
  const marked = [];
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.position === "sticky") {
      el.dataset.zpcScreenshotPrev = el.style.position || "";
      el.style.position = "static";
      marked.push(true);
    }
  }
  return marked.length;
}

// Injected: undo hideStickies.
function restoreStickies() {
  for (const el of document.querySelectorAll("[data-zpc-screenshot-prev]")) {
    el.style.position = el.dataset.zpcScreenshotPrev || "";
    delete el.dataset.zpcScreenshotPrev;
  }
}

/**
 * Capture the full scrollable area of the active tab as a PNG blob.
 * @returns {Promise<Blob>} the stitched PNG
 */
export async function captureFullPage(tab) {
  const tabId = tab.id;
  let dims;
  try {
    dims = await exec(tabId, probeDims);
  } catch (e) {
    // Most common cause: tab is on a restricted page (chrome://, web store,
    // PDF viewer). The wrapper in screenshotFullPage filters by URL, but
    // some sites that look like https still block executeScript (e.g.
    // chrome-untrusted://). Surface the underlying error.
    throw new Error(`screenshot: cannot inject probe — ${e?.message || e}`);
  }
  if (!dims || !dims.vw || !dims.vh) throw new Error("screenshot: empty viewport");
  const { vw, vh, sw, sh, dpr, scrollX: origX, scrollY: origY } = dims;

  // Compute tile grid.
  const cols = Math.max(1, Math.ceil(sw / vw));
  const rows = Math.max(1, Math.ceil(sh / vh));
  if (cols * rows > MAX_TILES) {
    throw new Error(`screenshot: page too large (${cols}×${rows} tiles > ${MAX_TILES})`);
  }
  if (sw * dpr * sh * dpr > MAX_PIXELS) {
    throw new Error(`screenshot: page too large (${(sw*dpr*sh*dpr / 1e6).toFixed(0)} MPx > ${MAX_PIXELS / 1e6} MPx)`);
  }

  await exec(tabId, hideStickies);
  let tiles;
  try {
    tiles = await captureTiles(tabId, vw, vh, sw, sh, cols, rows);
  } finally {
    await exec(tabId, restoreStickies);
    await exec(tabId, scrollTo, [origX, origY]);
  }

  return await stitchTiles(tiles, sw, sh, dpr);
}

// Wrap captureVisibleTab in a quota-aware retry. Chrome's throttle error
// message is documented as "exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
// quota"; we sleep 1100 ms (> 1 / 2 Hz period) and try once more.
// Anything else re-throws unchanged.
async function captureVisibleTabRetry(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(msg)) {
      await new Promise((res) => setTimeout(res, 1100));
      return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    }
    throw e;
  }
}

async function captureTiles(tabId, vw, vh, sw, sh, cols, rows) {
  const tiles = [];
  const tab = await chrome.tabs.get(tabId);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = Math.min(c * vw, Math.max(0, sw - vw));
      const sy = Math.min(r * vh, Math.max(0, sh - vh));
      await exec(tabId, scrollTo, [sx, sy]);
      // Brief settle for sticky-replacement reflow + async paint.
      await new Promise((res) => setTimeout(res, CAPTURE_GAP_MS));
      const dataUrl = await captureVisibleTabRetry(tab.windowId);
      tiles.push({ r, c, sx, sy, dataUrl });
    }
  }
  return tiles;
}

async function stitchTiles(tiles, sw, sh, dpr) {
  const W = Math.round(sw * dpr);
  const H = Math.round(sh * dpr);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  for (const t of tiles) {
    const resp = await fetch(t.dataUrl);
    const blob = await resp.blob();
    const bmp  = await createImageBitmap(blob);
    ctx.drawImage(bmp, Math.round(t.sx * dpr), Math.round(t.sy * dpr));
    bmp.close();
  }
  return await canvas.convertToBlob({ type: "image/png" });
}

/**
 * End-to-end: capture full page → write to disk through the native host
 * so we land in the user-configured download folder (settings.downloadDir
 * > settings.lastDir > host default ~/Downloads). chrome.downloads.download
 * can't override the browser's default folder, so we route bytes through
 * the host instead.
 *
 * @param {chrome.tabs.Tab} [tab] — defaults to the active tab
 * @returns {Promise<{dest: string, bytes: number, filename: string}>}
 */
export async function screenshotFullPage(tab) {
  tab = tab || await getActiveTab();
  if (!tab?.id) throw new Error("screenshot: no active tab");
  // chrome.scripting.executeScript + chrome.tabs.captureVisibleTab work on:
  //   * http://, https://, file://
  //   * chrome-extension:// when the page belongs to THIS extension
  //   * NOT chrome:// (browser internals), other extensions, web store
  // Bail loudly so the notification names the cause when something is
  // unreachable.
  const url = String(tab.url || "");
  const okHttp = /^(https?|file):\/\//i.test(url);
  const ourOwn = url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  if (!okHttp && !ourOwn) {
    throw new Error(`screenshot: cannot capture this URL scheme (${url.split(":")[0] || "unknown"}://) — try a regular http(s) page`);
  }
  const blob = await captureFullPage(tab);
  const base64 = await blobToBase64(blob);
  const host = hostnameFromUrl(tab.url || "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `zpwrchrome-${host || "page"}-${stamp}.png`;

  // Same priority as the takeover handler — keep the user's chosen folder
  // (or its tracked lastDir) in sync with how regular downloads behave.
  const dir = await resolvePreferredDownloadDir();

  const resp = await new Promise((res) => {
    chrome.runtime.sendMessage(
      { kind: "dl.writeFile", dir, name: filename, base64 },
      (r) => res(r || { ok: false, err: "no response" }),
    );
  });
  if (!resp.ok) throw new Error(resp.err || "screenshot: dl.writeFile failed");
  return { dest: resp.dest, bytes: resp.bytes, filename };
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // btoa needs a binary string; chunk to avoid call-stack limits on huge images.
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function resolvePreferredDownloadDir() {
  // Try dl.settings.get → settings.downloadDir, then settings.lastDir,
  // then empty (= host default). Falls back to "" on any error so the
  // host's default_download_dir() still wins.
  return new Promise((res) => {
    chrome.runtime.sendMessage({ kind: "dl.settings.get" }, (r) => {
      const s = r?.settings || {};
      const dd = (s.downloadDir && String(s.downloadDir).trim()) || "";
      if (dd) return res(dd);
      if (s.saveToLastUsedLocation && s.lastDir) return res(String(s.lastDir));
      return res("");
    });
  });
}

function hostnameFromUrl(u) {
  try { return new URL(u).hostname.replace(/[^a-z0-9.-]/gi, ""); }
  catch { return ""; }
}
