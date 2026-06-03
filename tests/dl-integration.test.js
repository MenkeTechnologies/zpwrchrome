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

// ── Chrono-port: Interface / Extension Filter / Rule System / Help / About ──

const ifaceHtml = read("scripts-manager/dl-interface.html");
const ifaceJs   = read("scripts-manager/dl-interface.js");
const extHtml   = read("scripts-manager/dl-extfilter.html");
const extJs     = read("scripts-manager/dl-extfilter.js");
const ruleHtml  = read("scripts-manager/dl-rules.html");
const ruleJs    = read("scripts-manager/dl-rules.js");
const helpHtml  = read("scripts-manager/dl-help.html");
const aboutHtml = read("scripts-manager/dl-about.html");

test("every settings page links to the same six-tab sidebar (General/Interface/Extension Filter/Rule System/Help/About)", () => {
  for (const page of [setHtml, ifaceHtml, extHtml, ruleHtml, helpHtml, aboutHtml]) {
    for (const href of ["dl-settings.html", "dl-interface.html", "dl-extfilter.html", "dl-rules.html", "dl-help.html", "dl-about.html"]) {
      assert.match(page, new RegExp(`href="${href}"`), `sidebar missing href="${href}" in one of the settings pages`);
    }
  }
});

test("Interface page exposes every Chrono General/Interface section we adopted", () => {
  for (const key of [
    "openAsStandalone", "startButtonRetriesFailed", "slideInDetailsOnClick", "doubleClickAction", "filePreviewAutoplay",
    "popupShowDownloadingFirst", "popupCloseAfterClear", "popupMaxItems", "popupDeleteClickAction",
    "newTaskFolderPicker",
    "menuDownloadAllResources", "menuSaveLinkAs", "menuOneClickDownload",
    "notifyOnOneClick", "notifyOnComplete", "notifyOnError", "soundOnComplete", "soundOnError", "largeImagePreview", "notificationClickAction",
    "badgeShowCount", "fontSize",
  ]) {
    assert.match(ifaceHtml, new RegExp(`data-key="${key}"`), `Interface HTML missing data-key="${key}"`);
    assert.match(ifaceJs,   new RegExp(`\\b${key}\\b`),     `DL_INTERFACE_DEFAULTS missing "${key}"`);
  }
});

test("background.js wires badge text + completion/error notifications off dl.interface flags", () => {
  assert.match(bg, /async function applyToolbarBadge/);
  assert.match(bg, /chrome\.action\?\.setBadgeText/);
  assert.match(bg, /async function notifyJobTransitions/);
  assert.match(bg, /notifyOnComplete/);
  assert.match(bg, /notifyOnError/);
});

test("Extension Filter ships the seven Chrono buckets as defaults", () => {
  for (const internal of ["ext_image", "ext_video", "ext_audio", "ext_doc", "ext_arch", "ext_app", "ext_all"]) {
    assert.match(extJs, new RegExp(`internal: "${internal}"`), `Extension Filter missing default bucket "${internal}"`);
  }
});

test("Extension Filter page has an editable rows table + Reset/Add buttons", () => {
  assert.match(extHtml, /id="ext-rows"/);
  assert.match(extHtml, /id="add-row"/);
  assert.match(extHtml, /id="reset"/);
  for (const col of ["Enable", "Display name", "Internal name", "File extensions"]) {
    assert.match(extHtml, new RegExp(`>${col}<`), `Extension Filter table missing column "${col}"`);
  }
});

test("bucketFor() resolves a filename to its enabled extension bucket", async () => {
  const mod = await import("../scripts-manager/dl-extfilter.js");
  const cfg = JSON.parse(JSON.stringify(mod.DL_EXTFILTER_DEFAULTS));
  assert.equal(mod.bucketFor("a.png", cfg), "ext_image");
  assert.equal(mod.bucketFor("vid.mp4", cfg), "ext_video");
  assert.equal(mod.bucketFor("song.flac", cfg), "ext_audio");
  assert.equal(mod.bucketFor("notes.md", cfg), "ext_doc");
  assert.equal(mod.bucketFor("pkg.tar.gz", cfg), "ext_arch");
  assert.equal(mod.bucketFor("setup.exe", cfg), "ext_app");
  assert.equal(mod.bucketFor("noext", cfg), null);
});

test("Rule System ships the ten Chrono seed rules with conditions", () => {
  for (const internal of [
    "r_recent", "r_downloading", "r_done",
    "r_done_image", "r_done_video", "r_done_audio", "r_done_doc", "r_done_other",
    "r_failed", "r_smallf",
  ]) {
    assert.match(ruleJs, new RegExp(`internal: "${internal}"`), `Rule System default rule "${internal}" missing`);
  }
});

test("Rule System page exposes Match mode dropdown + Default naming mask", () => {
  assert.match(ruleHtml, /id="match-mode"/);
  assert.match(ruleHtml, /id="default-mask"/);
  for (const col of ["Active", "As Tasks Filter", "Display name", "Internal name", "Condition", "Naming mask"]) {
    assert.match(ruleHtml, new RegExp(`>${col}<`), `Rule System table missing column "${col}"`);
  }
});

test("Rule System defaultMask is the canonical *name*.*ext* template", () => {
  assert.match(ruleJs, /defaultMask: "\*name\*\.\*ext\*"/);
});

test("Help page covers Batch Descriptors + Naming Masks + Rule System + Panic button", () => {
  for (const heading of ["Batch Descriptors", "Naming Masks", "Rule System", "Panic Button"]) {
    assert.match(helpHtml, new RegExp(heading.replace(/\s+/g, "\\s+")), `Help page missing section "${heading}"`);
  }
  assert.match(helpHtml, /id="panic"/);
});

test("About page surfaces version from runtime manifest + MenkeTechnologies branding + crate link", () => {
  assert.match(aboutHtml, /id="ver"/);
  assert.match(aboutHtml, /MenkeTechnologies/);
  assert.match(aboutHtml, /crates\.io\/crates\/browserpass-host-rs/);
  const aboutJs = read("scripts-manager/dl-about.js");
  assert.match(aboutJs, /chrome\.runtime\.getManifest/);
});

test("popup.html exposes a quick 'downloads ▸' link in the header next to scripts ▸", () => {
  const popupHtml = read("popup.html");
  const popupJs   = read("popup.js");
  assert.match(popupHtml, /id="open-downloads"/);
  assert.match(popupJs, /open-downloads/);
  assert.match(popupJs, /scripts-manager\/downloads\.html/);
});

test("popup ships a persistent bottom downloads strip that auto-refreshes every 1s", () => {
  const popupHtml = read("popup.html");
  const popupCss  = read("popup.css");
  const popupJs   = read("popup.js");
  // HTML: extra grid row reserved for the strip
  assert.match(popupHtml, /id="dl-strip"/);
  assert.match(popupHtml, /id="dl-strip-list"/);
  assert.match(popupHtml, /id="dl-strip-count"/);
  assert.match(popupHtml, /id="dl-strip-open"/);
  // CSS: modal grid grew to 4 rows so the strip sits above the keybinding footer.
  assert.match(popupCss, /grid-template-rows:\s*auto 1fr auto auto/);
  assert.match(popupCss, /\.dl-strip\s*\{/);
  // JS: cached-snapshot first paint, then dl.list poll on 1s interval.
  assert.match(popupJs, /function renderStrip/);
  assert.match(popupJs, /kind: "dl\.snapshot\.cached"/);
  assert.match(popupJs, /function pollStrip/);
  assert.match(popupJs, /setInterval\(pollStrip,\s*1000\)/);
  // Click handling: done rows open the file, otherwise jump to manager.
  assert.match(popupJs, /status === "done" && dest/);
  assert.match(popupJs, /kind: "dl\.openFile"/);
});

test("badge filter only counts active+pending jobs (never done/failed/cancelled/paused)", () => {
  // Pins the badge regression where the toolbar count stayed visible after
  // a job transitioned to failed/done — the snapshot itself was correct,
  // the badge just wasn't recomputed. See bpDlBroadcast self-poll below.
  const fn = bg.match(/async function applyToolbarBadge[\s\S]*?\n\}/);
  assert.ok(fn, "applyToolbarBadge not found");
  assert.match(fn[0], /j\.status === "active" \|\| j\.status === "pending"/);
  // Negative pins — these status values MUST NOT appear inside the filter.
  for (const bad of ["done", "failed", "cancelled", "paused"]) {
    const dangerous = new RegExp(`j\\.status === "${bad}"`);
    assert.doesNotMatch(fn[0], dangerous, `badge filter must not count "${bad}" jobs`);
  }
});

test("bpDlBroadcast re-polls every 1.5s while any active/pending job exists, then stops", () => {
  // The host can't push lifecycle events back to the SW (one-shot NM), so
  // the SW polls until nothing remains active — which is what clears stale
  // badges after a download fails or completes.
  const fn = bg.match(/async function bpDlBroadcast[\s\S]*?\n\}\n/);
  assert.ok(fn, "bpDlBroadcast not found");
  assert.match(fn[0], /stillInFlight/);
  assert.match(fn[0], /scheduleBgPoll\(1500\)/);
  assert.match(fn[0], /cancelBgPoll\(\)/);
  assert.match(bg, /function scheduleBgPoll\(ms\)/);
  assert.match(bg, /function cancelBgPoll\(\)/);
});

test("downloads.html toolbar exposes a 📁 button bound to t-open-dir", () => {
  assert.match(dlHtml, /id="t-open-dir"/);
});

test("downloads.js t-open-dir picks downloadDir > lastDir > host-default in that order", () => {
  const dljs = read("scripts-manager/downloads.js");
  const block = dljs.match(/t-open-dir[\s\S]*?\}\);\n\}\);/);
  assert.ok(block, "t-open-dir handler not wired");
  assert.match(block[0], /s\.downloadDir && s\.downloadDir\.trim/);
  assert.match(block[0], /s\.saveToLastUsedLocation && s\.lastDir/);
  assert.match(block[0], /kind: "dl\.openDir"/);
});

test("settings page exposes a 'Default download folder' text input + open/reset buttons", () => {
  const setHtml = read("scripts-manager/dl-settings.html");
  assert.match(setHtml, /data-key="downloadDir"/);
  assert.match(setHtml, /id="dd-open"/);
  assert.match(setHtml, /id="dd-reset"/);
});

test("DL_DEFAULTS.downloadDir is empty by default (= host fallback)", () => {
  const setJs = read("scripts-manager/dl-settings.js");
  assert.match(setJs, /downloadDir: ""/);
});

test("done rows offer both 'open' and 'reveal' actions; both gated on dest_exists", () => {
  const dljs = read("scripts-manager/downloads.js");
  // Both buttons must appear together, only when status=done AND destOnDisk.
  assert.match(dljs, /\(job\.status === "done" && destOnDisk\)\s*\?\s*`<button data-act="open"   data-dest="\$\{escDest\}">open<\/button>\s*<button data-act="reveal" data-dest="\$\{escDest\}">reveal<\/button>`/);
  // Click handler dispatches both, mapping open → dl.openFile, reveal → dl.openDir.
  assert.match(dljs, /act === "reveal" \|\| act === "open"/);
  assert.match(dljs, /act === "open" \? "dl\.openFile" : "dl\.openDir"/);
});

test("background.js dl.openFile handler forwards path as `dir` to host", () => {
  const block = bg.match(/msg\?\.kind === "dl\.openFile"[\s\S]*?return true;/);
  assert.ok(block, "dl.openFile handler missing");
  assert.match(block[0], /action: "dl\.openFile"/);
  assert.match(block[0], /dir: String\(msg\.path/);
});

test("downloads.html ships a right-side details drawer + collapse toggle, driven by slideInDetailsOnClick", () => {
  assert.match(dlHtml, /id="drawer"/);
  assert.match(dlHtml, /id="drawer-body"/);
  assert.match(dlHtml, /id="drawer-toggle"/);
  // CSS must shift the grid columns when the drawer is open.
  const css = read("scripts-manager/downloads.css");
  assert.match(css, /\.main\.has-drawer\s*\{[\s\S]*?grid-template-columns:\s*220px 1fr 340px/);
  // JS must honor the slideInDetailsOnClick interface setting and toggle the
  // class when a row is selected.
  const dljs = read("scripts-manager/downloads.js");
  assert.match(dljs, /function renderDrawer\(\)/);
  assert.match(dljs, /settings\.slideInDetailsOnClick !== false/);
  assert.match(dljs, /\$main\.classList\.add\("has-drawer"\)/);
  assert.match(dljs, /\$main\.classList\.remove\("has-drawer"\)/);
  // Live updates: poll + dl.event listener both call renderDrawer.
  const poll = dljs.match(/function poll\(\)[\s\S]*?\n\}/);
  assert.ok(poll, "poll() not found");
  assert.match(poll[0], /renderDrawer\(\)/);
  const listener = dljs.match(/chrome\.runtime\.onMessage\.addListener\(\(msg\) => \{[\s\S]*?\n\}\);/);
  assert.match(listener[0], /renderDrawer\(\)/);
});

test("downloads.js shows elapsed time in row meta (next to ETA)", () => {
  const dljs = read("scripts-manager/downloads.js");
  // Helper present + rendered in template + patched in place per tick.
  assert.match(dljs, /function fmtElapsed\(ms\)/);
  assert.match(dljs, /<span class="elp">\$\{fmtElapsed\(job\.elapsed_ms\)\} elapsed<\/span>/);
  assert.match(dljs, /const elpEl = el\.querySelector\(".meta \.elp"\);/);
});

test("manifest declares a default Ctrl+Shift+L / Cmd+Shift+L binding for pass-fill (customizable at chrome://extensions/shortcuts)", () => {
  const cmd = manifest.commands["pass-fill"];
  assert.ok(cmd, "pass-fill command missing");
  assert.equal(cmd.suggested_key?.default, "Ctrl+Shift+L");
  assert.equal(cmd.suggested_key?.mac,     "Command+Shift+L");
  // Description must point users at the rebind page so they know it's customizable.
  assert.match(cmd.description, /chrome:\/\/extensions\/shortcuts/);
});

test("settings page renders a Pass-autofill section with a keyboard shortcut table sourced from chrome.commands.getAll", () => {
  const setHtml = read("scripts-manager/dl-settings.html");
  const setJs   = read("scripts-manager/dl-settings.js");
  assert.match(setHtml, /data-key="passAutoSubmit"/);
  assert.match(setHtml, /id="kb-rows"/);
  assert.match(setHtml, /id="open-shortcuts"/);
  assert.match(setJs, /chrome\.commands\.getAll/);
  assert.match(setJs, /chrome:\/\/extensions\/shortcuts/);
  for (const cmd of ["pass-fill", "pass-open-popup", "pass-copy-pw", "pass-copy-user", "pass-copy-otp", "pass-open-url"]) {
    assert.match(setJs, new RegExp(`"${cmd}"`), `keyboard-shortcut table must list "${cmd}"`);
  }
});

test("DL_DEFAULTS.passAutoSubmit defaults to false (matches upstream browserpass)", () => {
  const setJs = read("scripts-manager/dl-settings.js");
  assert.match(setJs, /passAutoSubmit: false/);
});

test("background.js pass-fill code reads autoSubmit from dl.settings.passAutoSubmit (with pass.settings.autoSubmit as legacy fallback)", () => {
  // Both fill paths (passFillActive + passFillFromPath) must read the new key.
  const allBlocks = bg.match(/loadDlSettings\(\);\s*const autoSubmit = !!\(dlSettings\.passAutoSubmit \|\| settings\.autoSubmit\);/g);
  assert.ok(allBlocks && allBlocks.length >= 2, "both pass fill paths must read dl.settings.passAutoSubmit");
});

test("background.js pass-fill keystroke handler diag-traces every step", () => {
  // Every meaningful step in passFillActive — host lookup, match, fetch,
  // inject, error — must emit a diagPush so failures show up in the
  // Diagnostics page without needing the SW DevTools.
  const fn = bg.match(/async function passFillActive\(\)[\s\S]*?\n\}/);
  assert.ok(fn, "passFillActive not found");
  for (const label of [
    "pass.fill.start", "pass.fill.host", "pass.fill.matches",
    "pass.fill.entry", "pass.fill.injected",
  ]) {
    assert.match(fn[0], new RegExp(`diagPush\\("${label.replace(/\./g, "\\.")}"`), `passFillActive must diagPush("${label}")`);
  }
});

test("fillLoginForm returns structured result so diag can record per-frame outcome", () => {
  const fn = bg.match(/function fillLoginForm\([\s\S]*?\n\}/);
  assert.ok(fn, "fillLoginForm not found");
  // Old contract was `return true;` — must now be a structured object.
  assert.match(fn[0], /return \{ filled: false, reason: "no_visible_password_field"/);
  assert.match(fn[0], /return \{ filled: !!password, userFilled, submitted, origin:/);
});

test("takeover handler honors downloadDir > lastDir > ~/Downloads", () => {
  const block = bg.match(/chrome\.downloads\.onCreated\.addListener[\s\S]+?bpDlAdd/);
  assert.ok(block, "takeover block missing");
  assert.match(block[0], /settings\.downloadDir && settings\.downloadDir\.trim/);
  assert.match(block[0], /settings\.saveToLastUsedLocation && settings\.lastDir/);
  assert.match(block[0], /"~\/Downloads"/);
});

test("downloads.js renders rows incrementally via _rowCache (no innerHTML thrash, no hover flicker)", () => {
  const dljs = read("scripts-manager/downloads.js");
  // Render loop must keep a cache keyed by gid + a stable rowIdentity hash;
  // full-list innerHTML replacement during the 4Hz poll is what caused
  // hover state (and the action buttons inside it) to flicker.
  assert.match(dljs, /function rowIdentity\(j\)/);
  assert.match(dljs, /const _rowCache = new Map\(\);/);
  assert.match(dljs, /function applyRowProgress/);
  // Negative — the destructive innerHTML write inside renderList is gone.
  const renderFn = dljs.match(/function renderList\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(renderFn, "renderList not found");
  assert.doesNotMatch(renderFn[0], /\$list\.innerHTML\s*=\s*jobs\.map/);
});

test("downloads.css actions panel is always visible (not hover-gated), so retry/reveal stay clickable", () => {
  const css = read("scripts-manager/downloads.css");
  // The old `.dl-row:hover .actions { opacity: 1 }` rule was the symptom
  // user reported as "no retry button" — pin its removal.
  assert.doesNotMatch(css, /\.dl-row:hover \.actions/);
  assert.match(css, /\.dl-row \.actions \{[\s\S]*?opacity: 1;/);
});

test("downloads.js renders 'reveal' AND 'open' actions on done rows + maps to the right host action", () => {
  const dljs = read("scripts-manager/downloads.js");
  // Both buttons live in the same `done && destOnDisk` conditional now.
  assert.match(dljs, /\(job\.status === "done" && destOnDisk\)\s*\?\s*`<button data-act="open"   data-dest="\$\{escDest\}">open<\/button>\s*<button data-act="reveal" data-dest="\$\{escDest\}">reveal<\/button>`/);
  // Handler-side: open → dl.openFile, reveal → dl.openDir.
  assert.match(dljs, /act === "open" \? "dl\.openFile" : "dl\.openDir"/);
});

test("downloads.js marks done rows whose dest is missing and hides reveal/open actions for them", () => {
  const dljs = read("scripts-manager/downloads.js");
  // The host emits dest_exists per job; the UI must read it and:
  //   1. tag the row .missing
  //   2. swap the stat tag for "missing"
  //   3. strike the name
  //   4. NEVER render reveal for a missing file (covered by the test above)
  assert.match(dljs, /job\.dest_exists !== false/);
  assert.match(dljs, /const isMissing\s*=\s*job\.status === "done" && !destOnDisk/);
  assert.match(dljs, /stat-tag missing/);
  const css = read("scripts-manager/downloads.css");
  assert.match(css, /\.dl-row\.missing/);
  assert.match(css, /\.dl-row\.missing \.name \{[^}]*line-through/);
  assert.match(css, /\.stat-tag\.missing/);
});

test("background.js dl.openDir handler forwards the path arg to the host as `dir`", () => {
  const block = bg.match(/msg\?\.kind === "dl\.openDir"[\s\S]*?return true;/);
  assert.ok(block, "dl.openDir handler not registered");
  assert.match(block[0], /action: "dl\.openDir"/);
  assert.match(block[0], /dir: String\(msg\.path/);
});

test("SW fires one bpDlBroadcast on install + startup to clear any stale badge", () => {
  // Pattern: both runtime.onInstalled and runtime.onStartup get a listener
  // that calls bpDlBroadcast() unconditionally so a SW resume after Chrome
  // restart doesn't leave a number on the icon for downloads that already
  // finished/failed while the SW was suspended.
  const installHooks = bg.match(/runtime\.onInstalled\.addListener\(\(\)\s*=>\s*\{\s*bpDlBroadcast\(\)/);
  const startupHooks = bg.match(/runtime\.onStartup\.addListener\(\(\)\s*=>\s*\{\s*bpDlBroadcast\(\)/);
  assert.ok(installHooks, "onInstalled must call bpDlBroadcast() to clear stale badge");
  assert.ok(startupHooks, "onStartup must call bpDlBroadcast() to clear stale badge");
});
