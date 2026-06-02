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

test("background dl.* message handlers all delegate through BP helpers", () => {
  // The BP rewrite: dl.add → bpDlAdd, dl.list → bpDlList, dl.{pause,resume,cancel}
  // → bpDlGid("dl.X", gid). Each helper does a one-shot sendNativeMessage.
  const cases = {
    "dl.add":    /bpDlAdd\(args\)/,
    "dl.list":   /bpDlList\(\)/,
    "dl.pause":  /bpDlGid\("dl\.pause"/,
    "dl.resume": /bpDlGid\("dl\.resume"/,
    "dl.cancel": /bpDlGid\("dl\.cancel"/,
  };
  for (const [kind, expected] of Object.entries(cases)) {
    const re = new RegExp(
      `msg\\?\\.kind === "${kind.replace(".", "\\.")}"[\\s\\S]{0,400}${expected.source}`
    );
    assert.match(bg, re, `background handler for "${kind}" must use ${expected}`);
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

test("dl-pause-all and dl-resume-all enumerate via bpDlList then bulk-call", () => {
  const pause = bg.match(/async function dlPauseAll\([\s\S]*?\n\}/);
  assert.match(pause[0], /bpDlList\(\)/);
  assert.match(pause[0], /j\.status === "active"/);
  assert.match(pause[0], /bpDlGid\("dl\.pause"/);

  const resume = bg.match(/async function dlResumeAll\([\s\S]*?\n\}/);
  assert.match(resume[0], /j\.status === "paused"/);
  assert.match(resume[0], /bpDlGid\("dl\.resume"/);
});

test("context menu registers for link + image/video/audio (not just link)", () => {
  // Phase 7 design: right-click on a link OR direct media downloads via host.
  const installer = bg.match(/chrome\.contextMenus\.create\(\{[\s\S]*?contexts: \["link"\][\s\S]*?\}/);
  assert.ok(installer, "missing link contextMenus.create");
  assert.match(bg, /contexts: \["image", "video", "audio"\]/);
});

test("SW mirrors dl.list snapshots to chrome.storage.local via bpDlBroadcast", () => {
  // BP one-shot: there are no host push events. After every dl.{add,pause,
  // resume,cancel} round-trip the SW polls dl.list and broadcasts the result
  // to any open downloads.html page + caches it for fast paint on next open.
  assert.match(bg, /const DL_SNAPSHOT_KEY = "dl\.snapshot"/);
  const fn = bg.match(/async function bpDlBroadcast\([\s\S]*?\n\}/);
  assert.ok(fn, "bpDlBroadcast helper missing");
  assert.match(fn[0], /bpDlList\(\)/);
  assert.match(fn[0], /chrome\.storage\.local\.set\(\{ \[DL_SNAPSHOT_KEY\]: \{ jobs, ts: Date\.now\(\) \} \}\)/);
  assert.match(fn[0], /chrome\.runtime\.sendMessage\(\{ kind: "dl\.event", event: \{ kind: "dl\.progress", jobs \} \}\)/);
});

test("dl.snapshot.cached handler returns the persisted snapshot for re-hydration", () => {
  const block = bg.match(/msg\?\.kind === "dl\.snapshot\.cached"[\s\S]*?return true;/);
  assert.ok(block, "dl.snapshot.cached handler missing");
  assert.match(block[0], /chrome\.storage\.local\.get\(DL_SNAPSHOT_KEY\)/);
});

test("downloads.js paints from cached snapshot before kicking off live poll", () => {
  // Bottom-of-file boot sequence must hit dl.snapshot.cached, paint, and
  // only then call poll(). Pins the "instant paint" UX guarantee across SW
  // restarts.
  assert.match(dlJs, /kind: "dl\.snapshot\.cached"/);
  const boot = dlJs.match(/chrome\.runtime\.sendMessage\(\{ kind: "dl\.snapshot\.cached" \}, \(r\) => \{[\s\S]*?poll\(\);\s*\}\);/);
  assert.ok(boot, "downloads.js boot must rehydrate-then-poll");
  assert.match(boot[0], /state\.jobs = r\.snapshot\.jobs/);
  assert.match(boot[0], /renderList\(\)/);
});

test("downloads.js live-update path renders on dl.event push without polling", () => {
  const listener = dlJs.match(/chrome\.runtime\.onMessage\.addListener\(\(msg\) => \{[\s\S]*?\}\);/);
  assert.ok(listener, "downloads.js onMessage listener missing");
  assert.match(listener[0], /msg\?\.kind !== "dl\.event"/);
  assert.match(listener[0], /msg\.event\?\.kind === "dl\.progress"/);
  assert.match(listener[0], /state\.jobs = msg\.event\.jobs/);
  assert.match(listener[0], /renderList\(\)/);
});

test("downloads.html loads its own downloads.css (standalone manager UI)", () => {
  // Redesigned as a Chrono-style download manager: own stylesheet, no longer
  // shares manager.css with the userscript dashboard.
  assert.match(dlHtml, /href="downloads\.css"/);
  assert.match(dlHtml, /src="downloads\.js"/);
  assert.doesNotMatch(dlHtml, /href="manager\.css"/);
});

test("downloads.html ships sidebar nav with browserpass-style categories", () => {
  for (const cat of ["all", "recent", "downloading", "finished", "failed", "trash"]) {
    assert.match(dlHtml, new RegExp(`data-cat="${cat}"`), `missing sidebar category ${cat}`);
  }
  for (const sub of ["finished:image", "finished:video", "finished:audio", "finished:document", "finished:archive", "finished:other"]) {
    assert.match(dlHtml, new RegExp(`data-cat="${sub.replace(":", "\\:")}"`), `missing finished sub ${sub}`);
  }
});

test("default-download takeover: chrome.downloads.onCreated cancels + reissues via BP", () => {
  // Every browser download gets cancelled in Chrome and reissued through
  // the segmented downloader by default. blob:/data:/chrome:/file: URLs
  // are skipped (page-generated or non-network). User can opt out by
  // setting chrome.storage.local["dl.takeOverDefault"] = false.
  assert.match(bg, /const DL_TAKEOVER_KEY = "dl\.takeOverDefault"/);
  assert.match(bg, /chrome\.downloads\.onCreated\.addListener/);
  assert.match(bg, /shouldInterceptDownload\(item\)/);
  assert.match(bg, /isTakeOverEnabled\(\)/);
  assert.match(bg, /chrome\.downloads\.cancel\(item\.id\)/);
  assert.match(bg, /chrome\.downloads\.erase\(\{ id: item\.id \}\)/);
  assert.match(bg, /const resp = await bpDlAdd\(args\)/);

  const filter = bg.match(/function shouldInterceptDownload\([\s\S]*?\n\}/);
  assert.ok(filter);
  for (const scheme of ["blob:", "data:", "chrome:", "chrome-extension:", "about:", "file:"]) {
    assert.match(filter[0], new RegExp(`startsWith\\("${scheme.replace(":", "\\:")}"\\)`),
      `takeover must skip ${scheme} URLs`);
  }
});

test("default-download takeover lands files in ~/Downloads (matches Chrome default)", () => {
  // So the takeover is transparent — same destination Chrome would have
  // used. The lastDir setting can override the default when
  // saveToLastUsedLocation is on; both literals must appear in the block.
  const block = bg.match(/chrome\.downloads\.onCreated\.addListener[\s\S]+?bpDlAdd/);
  assert.ok(block, "takeover block missing");
  assert.match(block[0], /"~\/Downloads"/);
});

test("downloads.html toolbar exposes add / pause-all / resume-all / refresh / clear / cancel", () => {
  for (const id of ["t-add", "t-resume-all", "t-pause-all", "t-refresh", "t-clear", "t-cancel-sel"]) {
    assert.match(dlHtml, new RegExp(`id="${id}"`), `missing toolbar button #${id}`);
  }
});

test("downloads.html Clear menu exposes 4 scopes + Delete-from-disk checkbox", () => {
  // Chrono-style submenu: missing-files / completed / failed / all, plus a
  // delete-from-disk checkbox that applies to the chosen scope.
  for (const scope of ["missing", "done", "failed", "all"]) {
    assert.match(dlHtml, new RegExp(`data-scope="${scope}"`),
      `Clear menu must offer scope=${scope}`);
  }
  assert.match(dlHtml, /id="cm-disk"/, "Delete-from-disk checkbox missing");
  assert.match(dlHtml, /id="clear-menu"/, "Clear menu container missing");
});

test("dl.clear handler forwards scope + deleteFromDisk to the BP host", () => {
  // The clear msg.kind must reach bpSend with action:"dl.clear" and pass
  // through the user's scope choice + delete-from-disk toggle. Anything
  // else and the host can't differentiate "completed tasks" from "all".
  const block = bg.match(/msg\?\.kind === "dl\.clear"[\s\S]*?return true;/);
  assert.ok(block, "dl.clear handler missing");
  assert.match(block[0], /action: "dl\.clear"/);
  assert.match(block[0], /scope: String\(msg\.scope/);
  assert.match(block[0], /deleteFromDisk: !!msg\.deleteFromDisk/);
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

// ── settings page (Chrono-equivalent General/Network/Misc) ──────────────

const setHtml = read("scripts-manager/dl-settings.html");
const setJs   = read("scripts-manager/dl-settings.js");

test("settings page DL_DEFAULTS covers every Chrono General field we adopted", () => {
  for (const key of [
    "overrideDownloadsPage", "hideBuiltInUI",
    "saveToLastUsedLocation", "addToFrontOfQueue", "addPaused",
    "oneClickEnabled",
    "maxConcurrent", "maxPerServer",
    "conflictAction", "onDirUnsavable",
    "urlFromClipboard", "clearSearchOnFilter", "cancelOnTrash",
    "lastDir",
  ]) {
    assert.match(setJs, new RegExp(`\\b${key}\\b`), `DL_DEFAULTS missing "${key}"`);
  }
});

test("settings page binds an input[data-key] for every persisted user-editable setting", () => {
  for (const key of [
    "overrideDownloadsPage", "hideBuiltInUI",
    "saveToLastUsedLocation", "addToFrontOfQueue", "addPaused",
    "oneClickEnabled",
    "maxConcurrent", "maxPerServer",
    "conflictAction", "onDirUnsavable",
    "urlFromClipboard", "clearSearchOnFilter", "cancelOnTrash",
  ]) {
    assert.match(setHtml, new RegExp(`data-key="${key}"`), `settings HTML missing data-key="${key}"`);
  }
});

test("settings page hooks numeric ranges that match Chrono (1-20 concurrent, 1-5 per-server)", () => {
  assert.match(setHtml, /data-key="maxConcurrent"[^>]*min="1"[^>]*max="20"/);
  assert.match(setHtml, /data-key="maxPerServer"[^>]*min="1"[^>]*max="5"/);
});

test("downloads.html toolbar includes the ⚙ link to dl-settings.html", () => {
  assert.match(dlHtml, /id="t-settings"[^>]*href="dl-settings.html"/);
});

test("background.js takeover handler reads lastDir + addPaused + addToFrontOfQueue from dl.settings", () => {
  const block = bg.match(/chrome\.downloads\.onCreated\.addListener[\s\S]*?\n  \}\);\n\}/);
  assert.ok(block, "chrome.downloads.onCreated handler not found");
  assert.match(block[0], /loadDlSettings\(\)/);
  assert.match(block[0], /saveToLastUsedLocation/);
  assert.match(block[0], /addToFrontOfQueue/);
  assert.match(block[0], /addPaused/);
  assert.match(block[0], /"dl\.pause"/);
});

test("background.js redirects chrome://downloads/ to our manager when overrideDownloadsPage is on", () => {
  const block = bg.match(/chrome\.tabs\?\.onUpdated\?\.addListener[\s\S]*?\}\);\n/);
  assert.ok(block, "chrome.tabs.onUpdated listener for chrome://downloads/ not found");
  assert.match(block[0], /overrideDownloadsPage/);
  assert.match(block[0], /scripts-manager\/downloads\.html/);
});

test("background.js applies hideBuiltInUI via setUiOptions on install + startup", () => {
  assert.match(bg, /async function applyDownloadsUiVisibility/);
  assert.match(bg, /chrome\.downloads\?\.setUiOptions/);
  assert.match(bg, /onInstalled\.addListener\(applyDownloadsUiVisibility\)/);
  assert.match(bg, /onStartup\.addListener\(applyDownloadsUiVisibility\)/);
});

test("background.js re-applies UI visibility on dl.settings.changed messages from the settings page", () => {
  const block = bg.match(/msg\?\.kind === "dl\.settings\.changed"[\s\S]*?return true;/);
  assert.ok(block, "dl.settings.changed handler not registered");
  assert.match(block[0], /applyDownloadsUiVisibility\(\)/);
});

test("downloads.js applies clearSearchOnFilter when the user changes category", () => {
  const dljs = read("scripts-manager/downloads.js");
  assert.match(dljs, /state\.settings\.clearSearchOnFilter/);
});

test("isTakeOverEnabled now reads dl.settings.oneClickEnabled with back-compat to dl.takeOverDefault", () => {
  const fn = bg.match(/async function isTakeOverEnabled\(\)[\s\S]*?\n\}/);
  assert.ok(fn, "isTakeOverEnabled not found");
  assert.match(fn[0], /loadDlSettings\(\)/);
  assert.match(fn[0], /oneClickEnabled/);
  assert.match(fn[0], /DL_TAKEOVER_KEY/);   // legacy fallback still consulted
});
