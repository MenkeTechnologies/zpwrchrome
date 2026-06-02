// Static-analysis tests for the download manager wiring:
//   - cookie + user-agent forwarding (cookies permission required)
//   - segmented downloader path delegates through nmCall
//   - storage.local snapshot mirroring survives SW restart
//   - context menu registration for links + media
//   - downloads.html UI re-hydrates from cached snapshot before live poll
//
// Each test pins a contract that, if it regresses, would silently break a
// load-bearing feature of the manager.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const bg       = read("background.js");
const dlJs     = read("scripts-manager/downloads.js");
const dlHtml   = read("scripts-manager/downloads.html");

test("manifest declares cookies + contextMenus + notifications + nativeMessaging", () => {
  for (const p of ["cookies", "contextMenus", "notifications", "nativeMessaging"]) {
    assert.ok(manifest.permissions.includes(p), `permissions missing "${p}"`);
  }
});

test("manifest declares all four dl-* commands", () => {
  for (const name of ["dl-paste-url", "dl-show-queue", "dl-pause-all", "dl-resume-all"]) {
    assert.ok(manifest.commands[name], `manifest missing command "${name}"`);
  }
});

test("background dl.* message handlers all delegate through nmCall", () => {
  for (const kind of ["dl.add", "dl.list", "dl.pause", "dl.resume", "dl.cancel"]) {
    const re = new RegExp(`msg\\?\\.kind === "${kind.replace(".", "\\.")}"[\\s\\S]*?nmCall\\("dl"`);
    assert.match(bg, re, `background handler for "${kind}" must call nmCall("dl", ...)`);
  }
});

test("enrichDownloadArgs attaches chrome.cookies.getAll output as Cookie header", () => {
  const fn = bg.match(/async function enrichDownloadArgs\([\s\S]*?\n\}/);
  assert.ok(fn, "enrichDownloadArgs helper missing");
  assert.match(fn[0], /chrome\.cookies\.getAll\(\{ url \}\)/);
  assert.match(fn[0], /\.map\(\(c\) => `\$\{c\.name\}=\$\{c\.value\}`\)\.join\("; "\)/);
  assert.match(fn[0], /args\.userAgent = navigator\.userAgent/);
});

test("dl-paste-url + context-menu + dl.add handler all funnel through enrichDownloadArgs", () => {
  // Every URL → download path must go through cookie/UA enrichment so we
  // don't accidentally ship a "logged-out" download in any of the three.
  const dlAddBlock = bg.match(/msg\?\.kind === "dl\.add"[\s\S]*?return true;/);
  assert.ok(dlAddBlock);
  assert.match(dlAddBlock[0], /enrichDownloadArgs\(url, msg\)/);

  const pasteFn = bg.match(/async function dlPasteUrl\([\s\S]*?\n\}/);
  assert.ok(pasteFn);
  assert.match(pasteFn[0], /enrichDownloadArgs\(url,/);

  const ctxHandler = bg.match(/chrome\.contextMenus\.onClicked\.addListener\([\s\S]*?\n  \}\);/);
  assert.ok(ctxHandler);
  assert.match(ctxHandler[0], /enrichDownloadArgs\(url,/);
});

test("dl-paste-url reads clipboard via injected navigator.clipboard.readText", () => {
  const fn = bg.match(/async function dlPasteUrl\([\s\S]*?\n\}/);
  assert.match(fn[0], /chrome\.scripting\.executeScript/);
  assert.match(fn[0], /navigator\.clipboard\.readText\(\)/);
  assert.match(fn[0], /\/\^https\?:\\\/\\\/\/i/);
});

test("dl-pause-all and dl-resume-all enumerate via dl.list then bulk-call", () => {
  const pause = bg.match(/async function dlPauseAll\([\s\S]*?\n\}/);
  assert.match(pause[0], /nmCall\("dl", "list"/);
  assert.match(pause[0], /j\.status === "active"/);
  assert.match(pause[0], /nmCall\("dl", "pause"/);

  const resume = bg.match(/async function dlResumeAll\([\s\S]*?\n\}/);
  assert.match(resume[0], /j\.status === "paused"/);
  assert.match(resume[0], /nmCall\("dl", "resume"/);
});

test("context menu registers for link + image/video/audio (not just link)", () => {
  // Phase 7 design: right-click on a link OR direct media downloads via host.
  const installer = bg.match(/chrome\.contextMenus\.create\(\{[\s\S]*?contexts: \["link"\][\s\S]*?\}/);
  assert.ok(installer, "missing link contextMenus.create");
  assert.match(bg, /contexts: \["image", "video", "audio"\]/);
});

test("SW mirrors dl.progress to chrome.storage.local under DL_SNAPSHOT_KEY", () => {
  // Required so downloads.html paints the queue instantly across SW restarts
  // even before the NM port reconnects.
  assert.match(bg, /const DL_SNAPSHOT_KEY = "dl\.snapshot"/);
  const listener = bg.match(/nmAddEventListener\(\(evt\) => \{[\s\S]*?\n\}\);/);
  assert.ok(listener, "missing nmAddEventListener handler");
  assert.match(listener[0], /evt\.kind === "dl\.progress"/);
  assert.match(listener[0], /chrome\.storage\.local\.set\(\{ \[DL_SNAPSHOT_KEY\]: \{ jobs: evt\.jobs, ts: Date\.now\(\) \} \}\)/);
});

test("dl.snapshot.cached handler returns the persisted snapshot for re-hydration", () => {
  const block = bg.match(/msg\?\.kind === "dl\.snapshot\.cached"[\s\S]*?return true;/);
  assert.ok(block, "dl.snapshot.cached handler missing");
  assert.match(block[0], /chrome\.storage\.local\.get\(DL_SNAPSHOT_KEY\)/);
});

test("downloads.js paints from cached snapshot before kicking off live poll", () => {
  // Look at the bottom-of-file boot sequence — it must hit dl.snapshot.cached
  // and only then call poll(). This pins the "instant paint" UX guarantee.
  assert.match(dlJs, /kind: "dl\.snapshot\.cached"/);
  const boot = dlJs.match(/chrome\.runtime\.sendMessage\(\{ kind: "dl\.snapshot\.cached" \}, \(r\) => \{[\s\S]*?poll\(\);\s*\}\);/);
  assert.ok(boot, "downloads.js boot must rehydrate-then-poll");
  assert.match(boot[0], /render\(r\.snapshot\.jobs\)/);
});

test("downloads.js live-update path renders on dl.event push without polling", () => {
  const listener = dlJs.match(/chrome\.runtime\.onMessage\.addListener\(\(msg\) => \{[\s\S]*?\}\);/);
  assert.ok(listener, "downloads.js onMessage listener missing");
  assert.match(listener[0], /msg\?\.kind (?:===|!==) "dl\.event"/);
  assert.match(listener[0], /evt\?\.kind === "dl\.progress"/);
  assert.match(listener[0], /render\(evt\.jobs\)/);
});

test("downloads.html loads downloads.css alongside manager.css for theme", () => {
  assert.match(dlHtml, /href="manager\.css"/);
  assert.match(dlHtml, /href="downloads\.css"/);
  assert.match(dlHtml, /src="downloads\.js"/);
});

test("downloads.js progress bar uses gradient cyan→magenta fill", () => {
  // Cyberpunk HUD aesthetic — same palette as the rest of the extension.
  const css = read("scripts-manager/downloads.css");
  assert.match(css, /linear-gradient\(90deg, var\(--magenta\), var\(--cyan\)\)/);
});

test("dl.add wire-up forwards segments + dir + name + cookies + userAgent to host", () => {
  // Argument set the host's `add` operation accepts.
  const block = bg.match(/msg\?\.kind === "dl\.add"[\s\S]*?return true;/);
  assert.match(block[0], /enrichDownloadArgs/);
  const enrich = bg.match(/async function enrichDownloadArgs\([\s\S]*?\n\}/);
  for (const field of ["url", "dir", "name", "segments", "cookies", "userAgent"]) {
    assert.match(enrich[0], new RegExp(`\\b${field}\\b`), `enrichDownloadArgs missing field "${field}"`);
  }
});
