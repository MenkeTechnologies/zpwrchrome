// zpwrchrome — service worker
// MV3: no persistent globals; state lives in chrome.storage.session.

import {
  MRU_CAP_DEFAULT,
  mruPush,
  mruDrop,
  mruStep as mruStepPure,
  mruPrevious,
  hostnameOf,
  resolveJumpIndex,
  buildScene,
  upsertScene,
  dropScene,
  resolveSceneOrdinal,
  frecencyScore
} from "./lib/util.js";
import {
  parseMetadata,
  validateUserscript,
  userscriptId,
  includeToMatchPattern,
  matchUrl,
  expandMatchPatterns
} from "./lib/userscript.js";
import { GM_SHIM_SOURCE } from "./lib/gm-shim.js";
import { matchIn, parseEntry, fallbackUsernameFromPath } from "./lib/bp-pass.js";
import { loadSettings as loadDlSettings, DL_DEFAULTS as DL_SETTINGS_DEFAULTS, saveSettings as saveDlSettings } from "./scripts-manager/dl-settings.js";

const MRU_KEY = "mru";
const DL_SETTINGS_KEY = "dl.settings";
const SCENES_KEY = "scenes";   // chrome.storage.local — survives browser restart

async function readMru() {
  const { [MRU_KEY]: mru } = await chrome.storage.session.get(MRU_KEY);
  return Array.isArray(mru) ? mru : [];
}

async function writeMru(mru) {
  await chrome.storage.session.set({ [MRU_KEY]: mru.slice(0, MRU_CAP_DEFAULT) });
}

async function pushMru(tabId) {
  const next = mruPush(await readMru(), tabId);
  await writeMru(next);
}

async function dropFromMru(tabId) {
  const mru = await readMru();
  const next = mruDrop(mru, tabId);
  if (next.length !== mru.length) await writeMru(next);
}

chrome.tabs.onActivated.addListener(({ tabId }) => { pushMru(tabId); });
chrome.tabs.onRemoved.addListener((tabId) => { dropFromMru(tabId); });
chrome.tabs.onReplaced.addListener((added, removed) => {
  dropFromMru(removed).then(() => pushMru(added));
});

chrome.runtime.onInstalled.addListener(seedMru);
chrome.runtime.onStartup.addListener(seedMru);

async function seedMru() {
  const tabs = await chrome.tabs.query({});
  const active = tabs.filter((t) => t.active).map((t) => t.id);
  const rest = tabs.filter((t) => !t.active).map((t) => t.id);
  await writeMru([...active, ...rest]);
}

// ---------------------------------------------------------------------------
// Command dispatcher

chrome.commands.onCommand.addListener(async (command) => {
  try { await dispatch(command); }
  catch (e) { console.error("[zpwrchrome]", command, e); }
});

async function dispatch(command) {
  if (command === "switch-previous-tab")  return switchPreviousTab();
  if (command === "restore-last-closed")  return restoreLastClosed();
  if (command === "search-tabs")          return chrome.action.openPopup();
  if (command === "recent-modal")         return openRecentModal();
  if (command === "mru-next")             return mruStep(+1);
  if (command === "mru-prev")             return mruStep(-1);
  if (command.startsWith("jump-to-"))     return jumpTo(command);
  if (command === "duplicate-tab")        return withActive((t) => chrome.tabs.duplicate(t.id));
  if (command === "pin-tab")              return withActive((t) => chrome.tabs.update(t.id, { pinned: !t.pinned }));
  if (command === "mute-tab")             return withActive((t) => chrome.tabs.update(t.id, { muted: !t.mutedInfo?.muted }));
  if (command === "move-to-new-window")   return withActive((t) => chrome.windows.create({ tabId: t.id }));
  if (command === "close-others")         return closeOthers();
  if (command === "close-right")          return closeRight();
  if (command === "close-duplicates")     return closeDuplicates();
  if (command === "reload-all")           return reloadAll();
  if (command === "sort-by-url")          return sortByUrl();
  if (command === "group-by-domain")      return groupByDomain();
  if (command === "copy-url")             return copyActiveUrl();
  if (command === "copy-title-md")        return copyActiveTitleMd();
  if (command === "bookmark-tab")         return bookmarkActive();
  if (command === "manage-scripts")       return openScriptsManager();
  if (command === "save-scene-prompt")    return chrome.action.openPopup();
  if (command.startsWith("restore-scene-")) return restoreSceneByOrdinal(command);
  if (command === "kill-heaviest")        return killHeaviestTab();
  if (command === "open-history")         return openHistoryInPopup();
  if (command === "pass-open-popup")      return openPassInPopup();
  if (command === "pass-fill")            return passFillActive();
  if (command === "pass-copy-pw")         return passCopyForActive("pw");
  if (command === "pass-copy-user")       return passCopyForActive("user");
  if (command === "pass-copy-otp")        return passCopyForActive("otp");
  if (command === "pass-open-url")        return passOpenUrlForActive();
  if (command === "dl-paste-url")         return dlPasteUrl();
  if (command === "dl-show-queue")        return dlShowQueue();
  if (command === "dl-pause-all")         return dlPauseAll();
  if (command === "dl-resume-all")        return dlResumeAll();
}

async function openPassInPopup() {
  await chrome.storage.session.set({ pendingCategory: "pass" });
  await chrome.action.openPopup().catch(() => {});
}

async function passMatchActive() {
  const t = await getActive();
  const h = hostnameOf(t?.url || "");
  if (!h) return { matches: [] };
  try {
    const matches = await bpMatchByHost(h);
    return { matches };
  } catch (e) {
    console.warn("[zpwrchrome] pass.match:", e?.message || e);
    return { matches: [] };
  }
}

async function passCopyForActive(field) {
  const { matches } = await passMatchActive();
  if (!matches.length) return;
  const m = matches[0];
  try {
    if (field === "otp") {
      const code = await bpOtpCode(m.path);
      if (code) await passClipboardCopy(code);
      return;
    }
    const entry = await bpFetchParsed(m.path);
    const text = field === "user" ? entry.username : entry.password;
    if (text) await passClipboardCopy(text);
  } catch (e) {
    console.warn("[zpwrchrome] pass copy", field, "failed:", e?.message || e);
  }
}

// Best-effort clipboard auto-clear (browserpass / pass -c convention).
// 45 s matches `pass -c`. The MV3 service worker can be torn down mid-wait,
// in which case the clipboard stays — that's a "fail open" trade-off; the
// alternative (chrome.alarms) costs another declared permission for the
// same convention and won't help if the SW is asleep anyway.
const PASS_CLIPBOARD_CLEAR_MS = 45_000;
let passClipboardTimer = null;

async function passClipboardCopy(text) {
  if (!text) return;
  await writeClipboard(text);
  if (passClipboardTimer) clearTimeout(passClipboardTimer);
  passClipboardTimer = setTimeout(() => {
    passClipboardTimer = null;
    writeClipboard("").catch(() => {});
  }, PASS_CLIPBOARD_CLEAR_MS);
}

async function passOpenUrlForActive() {
  const { matches } = await passMatchActive();
  if (!matches.length) return;
  const m = matches[0];
  try {
    const entry = await bpFetchParsed(m.path);
    const url = String(entry.url || "").trim();
    if (!url) return;
    const t = await getActive();
    if (t?.id) await chrome.tabs.update(t.id, { url });
  } catch (e) {
    console.warn("[zpwrchrome] pass-open-url:", e?.message || e);
  }
}

async function passOpenUrlFromPath(path, newTab, _store) {
  try {
    const entry = await bpFetchParsed(path);
    const url = String(entry.url || "").trim();
    if (!url) return false;
    if (newTab) {
      await chrome.tabs.create({ url });
    } else {
      const t = await getActive();
      if (t?.id) await chrome.tabs.update(t.id, { url });
    }
    return true;
  } catch (e) {
    console.warn("[zpwrchrome] pass.openUrl:", e?.message || e);
    return false;
  }
}

const PASS_SETTINGS_KEY = "pass.settings";
const PASS_SETTINGS_DEFAULTS = {
  // browserpass `Automatically submit forms after filling` equivalent —
  // off by default to match browserpass's default. When on, the injected
  // fillLoginForm picks the nearest submit button and clicks it after
  // values have been set + change events have fired.
  autoSubmit: false,
  // Auto-supply HTTP basic auth credentials from the matching `pass` entry
  // when the browser shows the auth prompt for a URL whose host has a
  // single matching entry. Off by default to avoid leaking credentials on
  // unexpected auth-required redirects.
  basicAuthEnabled: false,
};

async function getPassSettings() {
  const bag = await chrome.storage.local.get(PASS_SETTINGS_KEY);
  return { ...PASS_SETTINGS_DEFAULTS, ...(bag?.[PASS_SETTINGS_KEY] || {}) };
}

async function setPassSettings(patch) {
  const next = { ...(await getPassSettings()), ...(patch || {}) };
  await chrome.storage.local.set({ [PASS_SETTINGS_KEY]: next });
  return next;
}

async function passFillFromPath(path, _store) {
  if (!path) return false;
  const t = await getActive();
  if (!t?.id) return false;
  let entry;
  try {
    entry = await bpFetchParsed(path);
  } catch (e) {
    console.warn("[zpwrchrome] pass.fill fetch:", e?.message || e);
    return false;
  }
  const settings = await getPassSettings();
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: t.id, allFrames: true },
      func: fillLoginForm,
      args: [String(entry.username || ""), String(entry.password || ""), !!settings.autoSubmit],
    });
    return Array.isArray(results) && results.some((r) => r?.result === true);
  } catch (e) {
    console.warn("[zpwrchrome] pass.fill inject:", e?.message || e);
    return false;
  }
}

async function passFillActive() {
  const t = await getActive();
  if (!t?.id) return;
  const h = hostnameOf(t.url || "");
  if (!h) return;
  let matches;
  try {
    matches = await bpMatchByHost(h);
  } catch (e) {
    console.warn("[zpwrchrome] pass-fill match:", e?.message || e);
    return;
  }
  if (!matches.length) return;
  if (matches.length > 1) {
    return openPassInPopup();
  }
  let entry;
  try {
    entry = await bpFetchParsed(matches[0].path);
  } catch (e) {
    console.warn("[zpwrchrome] pass-fill fetch:", e?.message || e);
    return;
  }
  const settings = await getPassSettings();
  try {
    await chrome.scripting.executeScript({
      target: { tabId: t.id, allFrames: true },
      func: fillLoginForm,
      args: [String(entry.username || ""), String(entry.password || ""), !!settings.autoSubmit],
    });
  } catch (e) {
    console.warn("[zpwrchrome] pass-fill inject:", e?.message || e);
  }
}

// Injected into the active tab (all frames) by pass-fill. Pure DOM logic —
// kept self-contained so chrome.scripting.executeScript can serialize it.
//
// Strategy:
//  1. Pick the first visible, enabled <input type="password">.
//  2. For the username, prefer a visible non-password text-like input in
//     the SAME form, preceding the password field in document order; fall
//     back to the first visible text-like input anywhere.
//  3. Set values via the native HTMLInputElement.value setter so React /
//     Vue / Lit (which override the property) still see the change.
//  4. Dispatch input + change so framework listeners react.
function fillLoginForm(username, password, autoSubmit) {
  function nativeSet(el, val) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function visible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.type === "hidden") return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    return true;
  }
  const pw = [...document.querySelectorAll('input[type="password"]')].find(visible);
  if (!pw) return false;
  if (password) nativeSet(pw, password);
  if (username) {
    const sel = 'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"])';
    const all = pw.form
      ? [...pw.form.querySelectorAll(sel)]
      : [...document.querySelectorAll(sel)];
    const visibleAll = all.filter(visible);
    const before = visibleAll.filter((c) => pw.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING);
    const target = before.length ? before[before.length - 1] : visibleAll[0];
    if (target) nativeSet(target, username);
  }
  pw.focus();
  if (autoSubmit) {
    // Walk up to the enclosing form, then prefer an explicit submit button
    // (so onClick handlers run); fall back to form.submit() if no button is
    // present.
    const form = pw.form;
    if (form) {
      const submitBtn =
        form.querySelector('button[type="submit"]') ||
        form.querySelector('input[type="submit"]') ||
        form.querySelector('button:not([type="button"]):not([type="reset"])');
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
      } else {
        try { form.submit(); } catch {}
      }
    }
  }
  return true;
}

async function dlPasteUrl() {
  // Read clipboard via injection into the active tab — service workers have
  // no DOM clipboard. The active tab inherits user-activation from the
  // keyboard command so clipboard.readText() is permitted.
  const t = await getActive();
  if (!t?.id) return;
  let url;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: t.id },
      func: () => navigator.clipboard.readText(),
    });
    url = String(result || "").trim();
  } catch (e) {
    console.warn("[zpwrchrome] dl-paste-url: clipboard read failed:", e?.message || e);
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    console.warn("[zpwrchrome] dl-paste-url: clipboard text is not an http(s) URL");
    return;
  }
  try {
    const args = await enrichDownloadArgs(url, {});
    const resp = await bpDlAdd(args);
    const data = resp.data || {};
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "zpwrchrome download queued",
        message: `gid ${data.gid} → ${data.dest || ""}`,
      });
    }
    bpDlBroadcast();
  } catch (e) {
    console.warn("[zpwrchrome] dl-paste-url:", e?.message || e);
  }
}

async function dlShowQueue() {
  const url = chrome.runtime.getURL("scripts-manager/downloads.html");
  await chrome.tabs.create({ url });
}

async function dlPauseAll() {
  try {
    const resp = await bpDlList();
    const active = (resp.data?.jobs || []).filter((j) => j.status === "active");
    await Promise.all(active.map((j) => bpDlGid("dl.pause", j.gid).catch(() => null)));
    bpDlBroadcast();
  } catch (e) {
    console.warn("[zpwrchrome] dl-pause-all:", e?.message || e);
  }
}

async function dlResumeAll() {
  try {
    const resp = await bpDlList();
    const paused = (resp.data?.jobs || []).filter((j) => j.status === "paused");
    await Promise.all(paused.map((j) => bpDlGid("dl.resume", j.gid).catch(() => null)));
    bpDlBroadcast();
  } catch (e) {
    console.warn("[zpwrchrome] dl-resume-all:", e?.message || e);
  }
}

// Build the args object for dl.add, attaching session cookies + user-agent
// so downloads behind a login (paywalls, GitHub private releases, S3 signed
// URLs that piggyback on session) work without the user re-logging in CLI.
//
// Cookie scope: chrome.cookies.getAll({url}) returns only cookies that the
// browser would itself send for this exact URL — respects Secure, Path,
// Domain, SameSite. We don't widen that.
async function enrichDownloadArgs(url, msg) {
  const args = {
    url,
    dir: msg.dir,
    name: msg.name,
    segments: msg.segments,
  };
  if (chrome.cookies && url) {
    try {
      const jar = await chrome.cookies.getAll({ url });
      if (jar?.length) {
        args.cookies = jar.map((c) => `${c.name}=${c.value}`).join("; ");
      }
    } catch (e) {
      console.warn("[zpwrchrome] cookie fetch failed:", e?.message || e);
    }
  }
  args.userAgent = navigator.userAgent;
  return args;
}

// ---------------------------------------------------------------------------
// Default-download takeover. Every browser-initiated download (Save link as,
// click on direct-link, content-disposition: attachment, etc.) is intercepted
// by chrome.downloads.onCreated, cancelled in Chrome, and reissued through
// the BP segmented downloader. Files land in ~/Downloads (matching Chrome's
// default) instead of ~/Downloads/zpwrchrome so the takeover is transparent.
//
// blob: and data: URLs are skipped — those are page-generated downloads
// where Chrome already has the bytes in memory and there's nothing to gain
// from re-fetching. chrome:// / chrome-extension:// / about: are also
// skipped — those aren't real network downloads.

const DL_TAKEOVER_KEY = "dl.takeOverDefault";  // legacy back-compat key

async function isTakeOverEnabled() {
  // New canonical setting lives in dl.settings.oneClickEnabled. Fall back
  // to the legacy DL_TAKEOVER_KEY for users upgrading from < 0.8.0.
  try {
    const s = await loadDlSettings();
    if (typeof s.oneClickEnabled === "boolean") return s.oneClickEnabled;
    const bag = await chrome.storage.local.get(DL_TAKEOVER_KEY);
    return bag?.[DL_TAKEOVER_KEY] !== false;
  } catch {
    return true;
  }
}

function shouldInterceptDownload(item) {
  const url = String(item?.url || "");
  if (!url) return false;
  if (url.startsWith("blob:"))            return false;
  if (url.startsWith("data:"))            return false;
  if (url.startsWith("chrome:"))          return false;
  if (url.startsWith("chrome-extension:"))return false;
  if (url.startsWith("about:"))           return false;
  // Some extensions (or our own dl.add) hand a finalUrl that's identical to
  // url; if it ever comes back to us via a redirect chain we'd loop. The
  // dl.* extension actions never go through chrome.downloads so this won't
  // happen in practice, but bail just in case.
  if (url.startsWith("file:"))            return false;
  return true;
}

if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(async (item) => {
    if (!shouldInterceptDownload(item))   return;
    if (!(await isTakeOverEnabled()))     return;

    // Cancel Chrome's download immediately. Erase from history so the
    // download shelf clears (the shelf may still flash briefly — there's
    // no MV3 API to suppress that without the deprecated downloads.shelf
    // permission).
    try { await chrome.downloads.cancel(item.id); } catch {}
    try { await chrome.downloads.erase({ id: item.id }); } catch {}

    // Chrome may have picked a filename via its own heuristic — use it
    // when present so the user-visible name matches what they expected.
    const suggested = (item.filename || "").split(/[\\/]/).pop();
    const settings  = await loadDlSettings();
    const dir       = settings.saveToLastUsedLocation && settings.lastDir
      ? settings.lastDir
      : "~/Downloads";
    const args = await enrichDownloadArgs(item.url, {
      dir,
      name: suggested || undefined,
      priority:        settings.addToFrontOfQueue ? "front" : "back",
      conflictAction:  settings.conflictAction,
      onDirUnsavable:  settings.onDirUnsavable,
    });
    try {
      const resp = await bpDlAdd(args);
      const data = resp.data || {};

      // Remember the directory used for the next takeover.
      if (settings.saveToLastUsedLocation && data.dest) {
        const usedDir = String(data.dest).replace(/\/[^/]+$/, "");
        if (usedDir && usedDir !== settings.lastDir) {
          await saveDlSettings({ ...settings, lastDir: usedDir });
        }
      }
      // "Add paused" — immediately pause the freshly-enqueued job.
      if (settings.addPaused && data.gid) {
        try { await bpDlGid("dl.pause", data.gid); } catch {}
      }
      if (chrome.notifications) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: "zpwrchrome download (intercepted)",
          message: `gid ${data.gid} → ${data.dest || ""}`,
        });
      }
      bpDlBroadcast();
    } catch (e) {
      console.warn("[zpwrchrome] download takeover failed:", e?.message || e);
    }
  });
}

// chrome://downloads/ override — when "Override browser's downloads page"
// is enabled, redirect navigations to chrome://downloads/ into our manager.
chrome.tabs?.onUpdated?.addListener(async (tabId, change, tab) => {
  if (!change?.url) return;
  if (!change.url.startsWith("chrome://downloads")) return;
  try {
    const s = await loadDlSettings();
    if (!s.overrideDownloadsPage) return;
    await chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL("scripts-manager/downloads.html"),
    });
  } catch {}
});

// Hide / show the built-in download shelf+UI per settings. Re-applied on
// SW startup and when settings change (dl.settings.changed message).
async function applyDownloadsUiVisibility() {
  try {
    const s = await loadDlSettings();
    if (chrome.downloads?.setUiOptions) {
      await chrome.downloads.setUiOptions({ enabled: !s.hideBuiltInUI });
    } else if (chrome.downloads?.setShelfEnabled) {
      chrome.downloads.setShelfEnabled(!s.hideBuiltInUI);
    }
  } catch {}
}
chrome.runtime.onInstalled.addListener(applyDownloadsUiVisibility);
chrome.runtime.onStartup.addListener(applyDownloadsUiVisibility);

// ---------------------------------------------------------------------------
// Right-click "Download with zpwrchrome" on links + media (phase 7 opt-in).

const CTX_DL_LINK  = "zpwrchrome-dl-link";
const CTX_DL_MEDIA = "zpwrchrome-dl-media";

chrome.runtime.onInstalled.addListener(() => {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.create({
    id: CTX_DL_LINK,
    title: "Download with zpwrchrome",
    contexts: ["link"],
  }, () => void chrome.runtime.lastError);
  chrome.contextMenus.create({
    id: CTX_DL_MEDIA,
    title: "Download with zpwrchrome",
    contexts: ["image", "video", "audio"],
  }, () => void chrome.runtime.lastError);
});

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info) => {
    const url = info.linkUrl || info.srcUrl;
    if (!url) return;
    try {
      const args = await enrichDownloadArgs(url, {});
      const resp = await bpDlAdd(args);
      const data = resp.data || {};
      if (chrome.notifications) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: "zpwrchrome download queued",
          message: `gid ${data.gid} → ${data.dest || ""}`,
        });
      }
      bpDlBroadcast();
    } catch (e) {
      console.warn("[zpwrchrome] right-click download:", e?.message || e);
    }
  });
}

async function openHistoryInPopup() {
  // Hand the category off to the popup via session storage. The popup reads
  // and clears this on init so it jumps straight to the History tab. We use
  // session (not local) so a stale value from a prior browser run never
  // hijacks the popup the next time Alt+T is pressed.
  await chrome.storage.session.set({ pendingCategory: "history" });
  await chrome.action.openPopup().catch(() => {});
}

async function openScriptsManager() {
  const url = chrome.runtime.getURL("scripts-manager/manager.html");
  await chrome.tabs.create({ url });
}

async function getActive() {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t;
}

async function withActive(fn) {
  const t = await getActive();
  if (t) return fn(t);
}

async function switchPreviousTab() {
  const active = await getActive();
  const prev = mruPrevious(await readMru(), active?.id);
  if (typeof prev !== "number") return;
  try {
    const tab = await chrome.tabs.get(prev);
    await chrome.tabs.update(prev, { active: true });
    if (tab.windowId !== active?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch { await dropFromMru(prev); }
}

async function mruStep(delta) {
  const active = await getActive();
  const next = mruStepPure(await readMru(), active?.id, delta);
  if (typeof next !== "number" || next === active?.id) return;
  try {
    const tab = await chrome.tabs.get(next);
    await chrome.tabs.update(next, { active: true });
    if (tab.windowId !== active?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch { await dropFromMru(next); }
}

async function jumpTo(command) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const idx = resolveJumpIndex(command, tabs.length);
  if (idx < 0) return;
  await chrome.tabs.update(tabs[idx].id, { active: true });
}

async function openRecentModal() {
  // Always open the toolbar action popup so Cmd+E anchors to the extension
  // icon (top-right when pinned) — same visual location as Cmd+Y and every
  // other extension-command popup. The in-page shadow-DOM modal at
  // modal/content.js used to inject overlay-style on external pages, but it
  // landed center-of-viewport instead of top-right, breaking visual parity
  // across the command set.
  await chrome.action.openPopup().catch(() => {});
}

async function restoreLastClosed() {
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 1 });
  const s = sessions[0];
  if (!s) return;
  if (s.tab)    return chrome.sessions.restore(s.tab.sessionId);
  if (s.window) return chrome.sessions.restore(s.window.sessionId);
}

async function closeOthers() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const victims = tabs.filter((t) => !t.active && !t.pinned).map((t) => t.id);
  if (victims.length) await chrome.tabs.remove(victims);
}

async function closeRight() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = tabs.find((t) => t.active);
  if (!active) return;
  const victims = tabs.filter((t) => t.index > active.index && !t.pinned).map((t) => t.id);
  if (victims.length) await chrome.tabs.remove(victims);
}

async function closeDuplicates() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const seen = new Set();
  const victims = [];
  for (const t of tabs) {
    if (t.pinned) continue;
    if (seen.has(t.url)) victims.push(t.id);
    else seen.add(t.url);
  }
  if (victims.length) await chrome.tabs.remove(victims);
}

async function reloadAll() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id)));
}

async function sortByUrl() {
  const tabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
  const sorted = [...tabs].sort((a, b) => (a.url || "").localeCompare(b.url || ""));
  const base = tabs.reduce((m, t) => Math.min(m, t.index), Infinity);
  for (let i = 0; i < sorted.length; i++) {
    await chrome.tabs.move(sorted[i].id, { index: base + i });
  }
}

async function groupByDomain() {
  if (!chrome.tabs.group || !chrome.tabGroups) return;
  const tabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
  const byHost = new Map();
  for (const t of tabs) {
    const h = hostnameOf(t.url);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(t.id);
  }
  for (const [host, ids] of byHost) {
    if (ids.length < 2) continue;
    const groupId = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(groupId, { title: host, collapsed: false });
  }
}

async function writeClipboard(text) {
  // Service workers have no DOM clipboard. Inject into the active page.
  const t = await getActive();
  if (!t?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: t.id },
      func: (s) => navigator.clipboard.writeText(s),
      args: [text]
    });
  } catch {
    // chrome:// pages refuse injection — fall back to a transient bookmark-bar trick is overkill; swallow.
  }
}

async function copyActiveUrl() {
  const t = await getActive();
  if (t?.url) await writeClipboard(t.url);
}

async function copyActiveTitleMd() {
  const t = await getActive();
  if (t?.url) await writeClipboard(`[${t.title || t.url}](${t.url})`);
}

async function bookmarkActive() {
  const t = await getActive();
  if (!t?.url) return;
  await chrome.bookmarks.create({ title: t.title || t.url, url: t.url });
}

// ---------------------------------------------------------------------------
// Userscripts (Tampermonkey-style)

const SCRIPTS_KEY = "userscripts";
const GM_PREFIX = "gm:";  // chrome.storage.local key prefix for per-script GM values
const FIRE_LOG_KEY = "userScripts.fireLog";
const FIRE_LOG_CAP = 200;

async function appendFireLog(entry) {
  const bag = await chrome.storage.local.get(FIRE_LOG_KEY);
  const log = Array.isArray(bag[FIRE_LOG_KEY]) ? bag[FIRE_LOG_KEY] : [];
  const final = { when: Date.now(), ...entry };
  log.unshift(final);
  if (log.length > FIRE_LOG_CAP) log.length = FIRE_LOG_CAP;
  await chrome.storage.local.set({ [FIRE_LOG_KEY]: log });
  console.info("[zpwrchrome] fire logged:", final.mode, final.name || final.script, "→", final.url);
}

async function readScripts() {
  const { [SCRIPTS_KEY]: arr } = await chrome.storage.local.get(SCRIPTS_KEY);
  return Array.isArray(arr) ? arr : [];
}

async function writeScripts(scripts) {
  await chrome.storage.local.set({ [SCRIPTS_KEY]: scripts });
  await syncUserScripts();
}

// chrome.userScripts.configureWorld must be called once per SW lifecycle
// before any script in the USER_SCRIPT world can use chrome.runtime
// (messaging is disabled by default). Without this, the GM.* shim's
// sendMessage calls fail silently and GM.getValue / GM.setValue look dead.
// We attempt it on every sync — Chrome ignores the call if the world is
// already configured the same way.
async function configureUserScriptsWorld() {
  if (!chrome.userScripts?.configureWorld) return;
  try {
    await chrome.userScripts.configureWorld({
      messaging: true,
      csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'self'"
    });
  } catch (e) {
    console.warn("[zpwrchrome] configureWorld failed:", e?.message || e);
  }
}

async function syncUserScripts() {
  if (!chrome.userScripts) {
    await chrome.storage.local.set({
      "userScripts.error": "chrome.userScripts API not available — Chrome 120+ + Developer mode + per-extension 'Allow User Scripts' toggle required"
    });
    return { registered: 0, error: "API unavailable" };
  }

  // Native mode is live. Clear the stale error key from a prior load when
  // the API was unavailable. (We don't persist mode anymore — scripts.list
  // derives it from `!!chrome.userScripts` live, so any stored value would
  // be ignored anyway.)
  await chrome.storage.local.remove("userScripts.error");

  await configureUserScriptsWorld();

  const scripts = await readScripts();
  console.info("[zpwrchrome] syncUserScripts: loaded", scripts.length, "saved script(s)");

  // Unregister everything we previously registered.
  try {
    await chrome.userScripts.unregister();
  } catch (e) {
    const msg = e?.message || String(e);
    console.error("[zpwrchrome] unregister failed:", msg);
    await chrome.storage.local.set({ "userScripts.error": "unregister: " + msg });
    return { registered: 0, error: msg };
  }
  await chrome.storage.local.remove("userScripts.error");

  const registrations = [];
  const skipped = [];
  for (const s of scripts) {
    if (!s.enabled) { skipped.push({ id: s.id, reason: "disabled" }); continue; }
    const meta = parseMetadata(s.src);
    if (!meta) { skipped.push({ id: s.id, reason: "no metadata block" }); continue; }
    const errs = validateUserscript(meta);
    if (errs.length) { skipped.push({ id: s.id, reason: errs.join(", ") }); continue; }

    const baseMatches = meta.matches.length
      ? meta.matches
      : meta.includes.map(includeToMatchPattern).filter(Boolean);
    if (!baseMatches.length) { skipped.push({ id: s.id, reason: "no usable @match" }); continue; }
    // Auto-expand bare-host patterns to also include *.host — catches the
    // common Tampermonkey-user error of writing `https://amazon.com/*`
    // when they actually want www.amazon.com etc.
    const matches = expandMatchPatterns(baseMatches);

    const id = userscriptId(meta);
    const info = {
      script: {
        id, name: meta.name, namespace: meta.namespace, version: meta.version,
        description: meta.description, author: meta.author,
        grants: meta.grants, matches, excludes: meta.excludes
      },
      version: chrome.runtime.getManifest().version,
      scriptHandler: "zpwrchrome",
      scriptMetaStr: (s.src.match(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/) || [""])[0]
    };

    const shim = GM_SHIM_SOURCE.replace("__GM_INFO_JSON__", JSON.stringify(info));
    const code =
      "(function () {\n" +
      shim + "\n" +
      "try {\n" +
      s.src + "\n" +
      "} catch (e) { console.error('[zpwrchrome userscript]', " + JSON.stringify(meta.name) + ", e); }\n" +
      "}).call(window);";

    const reg = {
      id,
      matches,
      js: [{ code }],
      runAt: meta.runAt.replace(/-/g, "_"),  // chrome wants document_idle
      world: "USER_SCRIPT",
      allFrames: false
    };
    // Only include excludeMatches when non-empty — some Chrome versions
    // reject the registration object outright on an empty array.
    if (meta.excludes.length) reg.excludeMatches = meta.excludes;

    registrations.push(reg);
  }

  console.info("[zpwrchrome] registering", registrations.length, "script(s); skipped", skipped.length);
  if (skipped.length) console.info("[zpwrchrome] skipped:", skipped);

  let registered = 0;
  if (registrations.length) {
    try {
      await chrome.userScripts.register(registrations);
      registered = registrations.length;
    } catch (e) {
      const msg = e?.message || String(e);
      console.error("[zpwrchrome] register failed:", msg, "\nfirst registration was:", registrations[0]);
      await chrome.storage.local.set({ "userScripts.error": "register: " + msg });
      return { registered: 0, error: msg, skipped };
    }
  }

  // Verify by querying back what's actually live.
  try {
    const live = await chrome.userScripts.getScripts();
    console.info("[zpwrchrome] live scripts after sync:", live.length, live.map((x) => x.id));
    await chrome.storage.local.set({ "userScripts.lastSync": {
      at: Date.now(),
      registered,
      liveIds: live.map((x) => x.id),
      skipped
    }});
  } catch (e) {
    console.warn("[zpwrchrome] getScripts verification failed:", e?.message || e);
  }

  return { registered, skipped };
}

chrome.runtime.onInstalled.addListener(initUserscripts);
chrome.runtime.onStartup.addListener(initUserscripts);
// Also init once at SW startup.
initUserscripts();

async function initUserscripts() {
  const result = await syncUserScripts();
  // Wire the webNavigation logger regardless of mode. In fallback mode it
  // ALSO injects. In native mode chrome.userScripts handles injection and
  // we just log — this is more reliable than the gm:fire beacon which
  // races against SW lifecycle.
  enableNavigationLogger();
  return result;
}

// ---------------------------------------------------------------------------
// Navigation logger. Single source of fire-log truth, used by both modes:
//   - Native mode (chrome.userScripts available): only logs; injection is
//     handled by Chrome.
//   - Fallback mode (chrome.userScripts unavailable): logs AND injects via
//     chrome.scripting.executeScript.

let navListenerWired = false;

function enableNavigationLogger() {
  if (navListenerWired) return;
  if (!chrome.webNavigation) {
    console.warn("[zpwrchrome] no webNavigation API — fire log won't update");
    return;
  }
  navListenerWired = true;
  console.info("[zpwrchrome] navigation logger active (mode:", chrome.userScripts ? "native" : "fallback", ")");

  chrome.webNavigation.onCommitted.addListener((details) => handleNav(details, "document-start"));
  chrome.webNavigation.onDOMContentLoaded.addListener((details) => handleNav(details, "document-end"));
  chrome.webNavigation.onCompleted.addListener((details) => handleNav(details, "document-idle"));
}

async function handleNav({ tabId, frameId, url }, phase) {
  if (typeof tabId !== "number" || tabId < 0) return;
  if (!url || !/^(https?|file|ftp):/i.test(url)) return;
  if (frameId !== 0) return; // top frame only — keeps log clean

  const scripts = await readScripts();
  if (!scripts.length) return;

  const native = !!chrome.userScripts;

  for (const s of scripts) {
    if (!s.enabled) continue;
    const meta = parseMetadata(s.src);
    if (!meta) continue;
    if (meta.runAt !== phase) continue;

    const basePatterns = meta.matches.length
      ? meta.matches
      : meta.includes.map(includeToMatchPattern).filter(Boolean);
    const patterns = expandMatchPatterns(basePatterns);
    if (!matchUrl(patterns, url)) continue;
    if (meta.excludes.length && matchUrl(meta.excludes, url)) continue;

    const id = userscriptId(meta);

    // Always log the fire — single source of truth across modes.
    await appendFireLog({
      script: id,
      name:   meta.name,
      url,
      tabId,
      frame:  frameId,
      mode:   native ? "native" : "fallback",
      phase
    });

    // Native mode: chrome.userScripts handles injection. Done.
    if (native) continue;

    // Fallback mode: inject ourselves via chrome.scripting.
    if (!chrome.scripting) continue;
    const info = {
      script: {
        id, name: meta.name, namespace: meta.namespace, version: meta.version,
        description: meta.description, author: meta.author,
        grants: meta.grants, matches: patterns, excludes: meta.excludes
      },
      version: chrome.runtime.getManifest().version,
      scriptHandler: "zpwrchrome-fallback",
      scriptMetaStr: (s.src.match(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/) || [""])[0]
    };
    const shim = GM_SHIM_SOURCE.replace("__GM_INFO_JSON__", JSON.stringify(info));
    const code =
      "(function () {\n" +
      shim + "\n" +
      "try {\n" +
      s.src + "\n" +
      "} catch (e) { console.error('[zpwrchrome userscript]', " + JSON.stringify(meta.name) + ", e); }\n" +
      "}).call(window);";

    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "ISOLATED",
        injectImmediately: phase === "document-start",
        func: (src) => {
          try { (new Function(src))(); }
          catch (e) { console.error("[zpwrchrome userscript fallback]", e); }
        },
        args: [code]
      });
    } catch (e) {
      // Restricted pages (chrome://, web store) — silently skip.
      if (!/Cannot access|chrome:\/\/|chromewebstore/.test(e?.message || "")) {
        console.warn("[zpwrchrome] fallback inject failed for", id, "on", url, "—", e?.message || e);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Popup data API

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === "list") {
    Promise.all([readMru(), chrome.tabs.query({}), chrome.sessions.getRecentlyClosed({ maxResults: 25 })])
      .then(([mru, tabs, closed]) => {
        const byId = new Map(tabs.map((t) => [t.id, t]));
        const mruTabs = mru.map((id) => byId.get(id)).filter(Boolean);
        const seen = new Set(mruTabs.map((t) => t.id));
        for (const t of tabs) if (!seen.has(t.id)) mruTabs.push(t);
        sendResponse({ mru: mruTabs, closed });
      });
    return true;
  }
  if (msg?.kind === "activate") {
    chrome.tabs.update(msg.tabId, { active: true }).then(() => {
      chrome.tabs.get(msg.tabId).then((t) => chrome.windows.update(t.windowId, { focused: true }));
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg?.kind === "restore") {
    chrome.sessions.restore(msg.sessionId).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.kind === "close-tab") {
    chrome.tabs.remove(msg.tabId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.kind === "open-scripts-manager") {
    openScriptsManager().then(() => sendResponse({ ok: true }));
    return true;
  }

  // --- Userscript manager API ---
  if (msg?.kind === "scripts.list") {
    Promise.all([
      readScripts(),
      chrome.storage.local.get(["userScripts.error", "userScripts.lastSync"])
    ]).then(([scripts, meta]) => {
      // Trust the LIVE API check, not the (possibly stale) storage value.
      // If chrome.userScripts is defined now, we're in native mode period —
      // even if some prior load wrote "fallback" to storage.
      const native = !!chrome.userScripts;
      sendResponse({
        ok: true,
        scripts,
        error: native ? null : (meta["userScripts.error"] || null),
        lastSync: meta["userScripts.lastSync"] || null,
        mode: native ? "native" : "fallback",
        native
      });
    });
    return true;
  }

  if (msg?.kind === "scripts.resync") {
    syncUserScripts().then((r) => sendResponse({ ok: true, ...r }));
    return true;
  }
  if (msg?.kind === "scripts.save") {
    (async () => {
      const all = await readScripts();
      const incoming = msg.script;
      const isNew = !!msg.isNew;
      const meta = parseMetadata(incoming.src);
      const errors = validateUserscript(meta);
      if (errors.length) { sendResponse({ ok: false, errors }); return; }
      incoming.id = incoming.id || userscriptId(meta);
      incoming.name = meta.name;
      incoming.updatedAt = Date.now();

      const nameLc = (incoming.name || "").toLowerCase();

      if (isNew) {
        // Creating new: reject if ANY existing script collides on id or name.
        // (Same @name+@namespace produces same userscriptId — would otherwise
        // overwrite the existing script silently.)
        const idCollide   = all.find((s) => s.id === incoming.id);
        const nameCollide = all.find((s) => (s.name || "").toLowerCase() === nameLc);
        if (idCollide || nameCollide) {
          const existing = idCollide || nameCollide;
          sendResponse({
            ok: false,
            errors: [`a script with @name "${incoming.name}" already exists (id ${existing.id}). Rename your new script or delete the existing one first.`]
          });
          return;
        }
        incoming.enabled = incoming.enabled !== false;
        all.push(incoming);
      } else {
        // Updating: incoming.id was passed from editing.id. Only refuse if
        // renaming would collide with a DIFFERENT existing script.
        const idx = all.findIndex((s) => s.id === incoming.id);
        const dupe = all.find((s) => s.id !== incoming.id && (s.name || "").toLowerCase() === nameLc);
        if (dupe) {
          sendResponse({
            ok: false,
            errors: [`renaming to @name "${incoming.name}" collides with an existing script (id ${dupe.id}). Pick another name.`]
          });
          return;
        }
        if (idx >= 0) all[idx] = { ...all[idx], ...incoming };
        else { incoming.enabled = incoming.enabled !== false; all.push(incoming); }
      }

      await writeScripts(all);
      sendResponse({ ok: true, script: incoming });
    })();
    return true;
  }
  if (msg?.kind === "scripts.delete") {
    (async () => {
      const all = (await readScripts()).filter((s) => s.id !== msg.id);
      await writeScripts(all);
      // Drop per-script storage too.
      await chrome.storage.local.remove(GM_PREFIX + msg.id);
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg?.kind === "scripts.toggle") {
    (async () => {
      const all = await readScripts();
      const s = all.find((x) => x.id === msg.id);
      if (s) s.enabled = !!msg.enabled;
      await writeScripts(all);
      sendResponse({ ok: true });
    })();
    return true;
  }

  // --- GM.* shim handlers (from inside userscripts) ---
  if (msg?.kind === "gm:getValue") {
    chrome.storage.local.get(GM_PREFIX + msg.script).then((bag) => {
      const map = bag[GM_PREFIX + msg.script] || {};
      sendResponse({ ok: true, value: map[msg.key] });
    });
    return true;
  }
  if (msg?.kind === "gm:setValue") {
    (async () => {
      const key = GM_PREFIX + msg.script;
      const bag = await chrome.storage.local.get(key);
      const map = bag[key] || {};
      map[msg.key] = msg.value;
      await chrome.storage.local.set({ [key]: map });
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg?.kind === "gm:deleteValue") {
    (async () => {
      const key = GM_PREFIX + msg.script;
      const bag = await chrome.storage.local.get(key);
      const map = bag[key] || {};
      delete map[msg.key];
      await chrome.storage.local.set({ [key]: map });
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg?.kind === "gm:listValues") {
    chrome.storage.local.get(GM_PREFIX + msg.script).then((bag) => {
      const map = bag[GM_PREFIX + msg.script] || {};
      sendResponse({ ok: true, keys: Object.keys(map) });
    });
    return true;
  }
  if (msg?.kind === "gm:setClipboard") {
    writeClipboard(msg.text).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.kind === "gm:openInTab") {
    chrome.tabs.create({ url: msg.url, active: !!msg.active })
      .then((t) => sendResponse({ ok: true, tabId: t.id }));
    return true;
  }
  if (msg?.kind === "gm:fire") {
    appendFireLog({
      when:   msg.when || Date.now(),
      script: msg.script,
      name:   msg.name,
      url:    msg.url,
      tabId:  _sender?.tab?.id ?? null,
      frame:  _sender?.frameId ?? 0,
      mode:   "native"
    }).then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.kind === "scripts.firelog") {
    chrome.storage.local.get(FIRE_LOG_KEY).then((bag) => {
      sendResponse({ ok: true, log: bag[FIRE_LOG_KEY] || [] });
    });
    return true;
  }
  if (msg?.kind === "scripts.firelog.clear") {
    chrome.storage.local.set({ [FIRE_LOG_KEY]: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.kind === "gm:notification") {
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: msg.title || "zpwrchrome userscript",
        message: msg.text || ""
      }, () => sendResponse({ ok: true }));
    } else {
      sendResponse({ ok: false });
    }
    return true;
  }

  // --- Named scenes (save/restore named tab-sets) ---
  if (msg?.kind === "scenes-list") {
    readScenes().then((scenes) => sendResponse({ scenes }));
    return true;
  }
  if (msg?.kind === "scenes-save") {
    saveSceneFromActiveWindow(String(msg.name || ""))
      .then((scene) => sendResponse({ ok: !!scene, scene }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.kind === "scenes-restore") {
    restoreSceneBySlug(String(msg.slug || ""))
      .then((winId) => sendResponse({ ok: typeof winId === "number", windowId: winId }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.kind === "scenes-delete") {
    deleteSceneBySlug(String(msg.slug || ""))
      .then((n) => sendResponse({ ok: true, remaining: n }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // --- chrome.history wrappers (popup AND modal both go through here so
  //     content-script callers — which can't reach chrome.history directly
  //     in MV3 — get the same data as the popup) ---
  if (msg?.kind === "history-list") {
    if (!chrome.history) { sendResponse({ ok: false, history: [] }); return true; }
    chrome.history.search(
      { text: "", maxResults: msg.maxResults || 5000, startTime: 0 },
      (results) => {
        // Re-rank by frecency (recency * frequency). Chrome's native ordering
        // is lastVisitTime-desc which over-promotes one-off visits. Frecency
        // surfaces the URLs the user actually lives on. Each item carries
        // its score so client-side fzf scoring can use it as a tiebreaker.
        const now = Date.now();
        const ranked = (results || []).map((h) => ({
          ...h,
          frecency: frecencyScore(h, now),
        }));
        ranked.sort((a, b) => b.frecency - a.frecency);
        sendResponse({ ok: true, history: ranked });
      }
    );
    return true;
  }
  if (msg?.kind === "history-delete") {
    if (!chrome.history) { sendResponse({ ok: false }); return true; }
    chrome.history.deleteUrl({ url: String(msg.url || "") }, () => sendResponse({ ok: true }));
    return true;
  }

  // --- chrome.processes (dev/canary only) ---
  if (msg?.kind === "processes-snapshot") {
    snapshotProcesses()
      .then((data) => sendResponse(data))
      .catch((e) => sendResponse({ available: false, error: String(e), perTab: {} }));
    return true;
  }
  if (msg?.kind === "kill-heaviest") {
    killHeaviestTab()
      .then((tabId) => sendResponse({ ok: typeof tabId === "number", tabId }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  // --- Native messaging host: pass + downloads (BP envelope) ---
  if (msg?.kind === "pass.match") {
    bpMatchByHost(String(msg.host || ""))
      .then((matches) => sendResponse({ ok: true, matches }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.list") {
    bpListEntries()
      .then((entries) => sendResponse({ ok: true, entries: entries.map((p) => ({ path: p, store: "default" })) }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.search") {
    const query = String(msg.query || "");
    bpSend({
      action: "search",
      settings: { stores: bpStores() },
      echoResponse: query,
    })
      .then((resp) => sendResponse({ ok: true, matches: resp.data?.matches || [] }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.fetch") {
    bpFetchParsed(String(msg.path || ""))
      .then((entry) => sendResponse({ ok: true, data: entry }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.otp") {
    bpOtpCode(String(msg.path || ""))
      .then((otp) => sendResponse({ ok: true, otp }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.fill") {
    passFillFromPath(String(msg.path || ""), msg.store || undefined)
      .then((ok) => sendResponse({ ok }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.openUrl") {
    passOpenUrlFromPath(String(msg.path || ""), !!msg.newTab, msg.store || undefined)
      .then((ok) => sendResponse({ ok }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.settings.get") {
    getPassSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }
  if (msg?.kind === "pass.settings.set") {
    setPassSettings(msg.settings || {})
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.add") {
    const url = String(msg.url || "");
    enrichDownloadArgs(url, msg).then((args) =>
      bpDlAdd(args)
        .then((resp) => { bpDlBroadcast(); sendResponse({ ok: true, ...(resp.data || {}) }); })
        .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }))
    );
    return true;
  }
  if (msg?.kind === "dl.list") {
    bpDlList()
      .then((resp) => sendResponse({ ok: true, jobs: resp.data?.jobs || [] }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.snapshot.cached") {
    chrome.storage.local.get(DL_SNAPSHOT_KEY).then((bag) => {
      sendResponse({ ok: true, snapshot: bag?.[DL_SNAPSHOT_KEY] || null });
    });
    return true;
  }
  if (msg?.kind === "dl.pause") {
    bpDlGid("dl.pause", Number(msg.gid))
      .then((resp) => { bpDlBroadcast(); sendResponse({ ok: true, ...(resp.data || {}) }); })
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.resume") {
    bpDlGid("dl.resume", Number(msg.gid))
      .then((resp) => { bpDlBroadcast(); sendResponse({ ok: true, ...(resp.data || {}) }); })
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.cancel") {
    bpDlGid("dl.cancel", Number(msg.gid))
      .then((resp) => { bpDlBroadcast(); sendResponse({ ok: true, ...(resp.data || {}) }); })
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.clear") {
    // scope: done | failed | missing | all; deleteFromDisk: bool
    bpSend({ action: "dl.clear", scope: String(msg.scope || "done"), deleteFromDisk: !!msg.deleteFromDisk })
      .then((resp) => { bpDlBroadcast(); sendResponse({ ok: true, ...(resp.data || {}) }); })
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.settings.changed") {
    applyDownloadsUiVisibility();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.kind === "host.meta") {
    // BP `echo` round-trip — confirms the host is reachable and returns the
    // sentinel verbatim. Used by the popup as a liveness probe.
    bpSend({ action: "echo", echoResponse: { ping: "zpwrchrome" } })
      .then((resp) => sendResponse({ ok: true, alive: true, echo: resp }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
});

// ---------------------------------------------------------------------------
// Scenes — persisted to chrome.storage.local (survives browser restart).

async function readScenes() {
  const { [SCENES_KEY]: s } = await chrome.storage.local.get(SCENES_KEY);
  return Array.isArray(s) ? s : [];
}
async function writeScenes(scenes) {
  await chrome.storage.local.set({ [SCENES_KEY]: scenes });
}

async function saveSceneFromActiveWindow(name) {
  const win = await chrome.windows.getLastFocused({ populate: true });
  if (!win?.tabs?.length) return null;
  const scene = buildScene(name, win.tabs);
  if (!scene) return null;
  const scenes = upsertScene(await readScenes(), scene);
  await writeScenes(scenes);
  return scene;
}

async function restoreSceneByOrdinal(command) {
  const scenes = await readScenes();
  const idx = resolveSceneOrdinal(command, scenes.length);
  if (idx < 0) return;
  return restoreSceneBySlug(scenes[idx].slug);
}

async function restoreSceneBySlug(slug) {
  const scenes = await readScenes();
  const scene = scenes.find((s) => s.slug === slug);
  if (!scene || !scene.tabs.length) return undefined;
  // Open a new window with the first URL, then add the rest. Keeps existing
  // windows untouched — restore is purely additive, never clobbers state.
  const [first, ...rest] = scene.tabs;
  const win = await chrome.windows.create({ url: first.url, focused: true });
  // Apply pinned on the first tab.
  if (first.pinned && win.tabs?.[0]?.id != null) {
    try { await chrome.tabs.update(win.tabs[0].id, { pinned: true }); } catch {}
  }
  for (const entry of rest) {
    try {
      const tab = await chrome.tabs.create({ windowId: win.id, url: entry.url, active: false });
      if (entry.pinned && tab?.id != null) {
        await chrome.tabs.update(tab.id, { pinned: true });
      }
    } catch (e) {
      console.warn("[zpwrchrome] scene restore tab failed:", entry.url, e);
    }
  }
  return win.id;
}

async function deleteSceneBySlug(slug) {
  const next = dropScene(await readScenes(), slug);
  await writeScenes(next);
  return next.length;
}

// ---------------------------------------------------------------------------
// Processes API — Chrome dev/canary only. `chrome.processes` is gated to
// non-stable channels and is undefined elsewhere. We feature-detect and
// return { available: false } so the UI can show a graceful "—".

function processesApiAvailable() {
  return typeof chrome !== "undefined"
      && typeof chrome.processes === "object"
      && typeof chrome.processes.getProcessInfo === "function";
}

// Returns { available, perTab: { [tabId]: { cpu, memoryBytes } }, error? }
async function snapshotProcesses() {
  if (!processesApiAvailable()) {
    return { available: false, reason: "chrome.processes unavailable on this channel", perTab: {} };
  }
  // chrome.processes.getProcessInfo(ids, includeMemory, cb)
  const info = await new Promise((resolve) => {
    try {
      chrome.processes.getProcessInfo([], true, (procs) => resolve(procs || {}));
    } catch { resolve({}); }
  });
  // Aggregate per-tab. Each ProcessInfo.tasks[] is { tabId, title }.
  const perTab = {};
  for (const pid of Object.keys(info)) {
    const p = info[pid];
    const cpu = typeof p.cpu === "number" ? p.cpu : 0;
    const mem = typeof p.privateMemory === "number" ? p.privateMemory : 0;
    for (const task of (p.tasks || [])) {
      const tid = task.tabId;
      if (typeof tid !== "number" || tid < 0) continue;
      const cur = perTab[tid] || { cpu: 0, memoryBytes: 0 };
      cur.cpu += cpu;
      cur.memoryBytes += mem;
      perTab[tid] = cur;
    }
  }
  return { available: true, perTab };
}

async function killHeaviestTab() {
  const snap = await snapshotProcesses();
  if (!snap.available) return undefined;
  let worst = null;
  for (const [tid, m] of Object.entries(snap.perTab)) {
    if (!worst || m.memoryBytes > worst.mem) worst = { tabId: Number(tid), mem: m.memoryBytes };
  }
  if (!worst) return undefined;
  // Refuse to kill the active tab; pick the next-heaviest non-active.
  const active = await getActive();
  if (active?.id === worst.tabId) {
    const ranked = Object.entries(snap.perTab)
      .map(([tid, m]) => ({ tabId: Number(tid), mem: m.memoryBytes }))
      .sort((a, b) => b.mem - a.mem)
      .filter((r) => r.tabId !== active.id);
    if (!ranked.length) return undefined;
    worst = ranked[0];
  }
  try { await chrome.tabs.remove(worst.tabId); return worst.tabId; }
  catch { return undefined; }
}

// ---------------------------------------------------------------------------
// HTTP basic auth injection via chrome.webRequest.onAuthRequired (asyncBlocking
// listener). Only fires when (a) the user opted in via pass.settings, (b) the
// request is NOT a proxy auth challenge (different security model), and (c)
// exactly one pass entry matches the request URL's host. Ambiguous matches
// fall through to the native browser prompt so the user picks the account.
if (chrome.webRequest && chrome.webRequest.onAuthRequired) {
  chrome.webRequest.onAuthRequired.addListener(
    async (details, callback) => {
      if (details.isProxy) { callback({}); return; }
      try {
        const settings = await getPassSettings();
        if (!settings.basicAuthEnabled) { callback({}); return; }
        const host = hostnameOf(details.url || "");
        if (!host) { callback({}); return; }
        const matches = await bpMatchByHost(host);
        if (matches.length !== 1) { callback({}); return; }
        const entry = await bpFetchParsed(matches[0].path);
        const username = String(entry.username || "");
        const password = String(entry.password || "");
        if (!username || !password) { callback({}); return; }
        callback({ authCredentials: { username, password } });
      } catch (e) {
        console.warn("[zpwrchrome] basic auth lookup:", e?.message || e);
        callback({});
      }
    },
    { urls: ["<all_urls>"] },
    ["asyncBlocking"]
  );
}

// ---------------------------------------------------------------------------
// Native messaging — BP (browserpass-host-rs) protocol over chrome.runtime
//                    .sendNativeMessage (one-shot per request).
//
// Wire shape (every action shares this envelope):
//   request:  { action, settings: { stores: { storeId: {id,name,path} } }, ...args }
//   response: { status: "ok"|"error", version, data?, code?, params? }
//
// The host (browserpass-host-rs) speaks PROTOCOL.md v3.1.2 plus three
// extension actions (otp, search, dl.*). Each call spawns a fresh host
// process — there is no long-lived port. Pause/resume/cancel + live queue
// updates for downloads are surfaced via the host's file-state at
// $XDG_CACHE_HOME/zpwrchrome/dl/gid_NNNNNN.json (read by `dl.list`).

const NATIVE_HOST = "com.menketechnologies.zpwrchrome";
const DL_SNAPSHOT_KEY = "dl.snapshot";

// Default password store; `~/` is expanded by the host's
// normalizePasswordStorePath at request time, so no env lookup is needed here.
const PASS_STORE = { id: "default", name: "Default", path: "~/.password-store" };
function bpStores() { return { default: PASS_STORE }; }

// Send one BP envelope. Returns a Promise resolving to the full response
// object on `status:"ok"`, rejecting with an Error (carrying `code` +
// `params` properties) on `status:"error"`. Transport failures throw.
function bpSend(req) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, req, (resp) => {
        const last = chrome.runtime.lastError;
        if (last) { reject(new Error(last.message)); return; }
        if (!resp || typeof resp !== "object") { reject(new Error("native host: empty response")); return; }
        if (resp.status === "error") {
          const msg = resp.params?.message || `error code ${resp.code}`;
          const e = new Error(msg);
          e.code = resp.code;
          e.params = resp.params;
          reject(e);
          return;
        }
        resolve(resp);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// BP `list` → all `.gpg` entries in the default store. Returns the
// extension-side path representation (no `.gpg` suffix) to match the
// shape the popup PASS category expects.
async function bpListEntries() {
  const resp = await bpSend({ action: "list", settings: { stores: bpStores() } });
  const files = resp.data?.files?.default || [];
  return files.map((f) => f.replace(/\.gpg$/, ""));
}

// Client-side eTLD+1 match for the active tab's host. Returns
// `[{path, store}, ...]` so the popup PASS rows can render store badges
// (single-store today, but the shape is multi-store-ready).
async function bpMatchByHost(host) {
  const entries = await bpListEntries();
  return matchIn(entries, host).map((path) => ({ path, store: "default" }));
}

// BP `fetch` + client-side parse. Returns the parsed entry with username
// fallback to the entry's basename (browserpass convention).
async function bpFetchParsed(path) {
  const file = path.endsWith(".gpg") ? path : `${path}.gpg`;
  const resp = await bpSend({
    action: "fetch",
    storeId: "default",
    file,
    settings: { stores: bpStores() },
  });
  const raw = resp.data?.contents || "";
  return fallbackUsernameFromPath(parseEntry(raw), path);
}

// `otp` extension action — host shells `pass otp` and returns the code.
async function bpOtpCode(path) {
  const file = path.endsWith(".gpg") ? path : `${path}.gpg`;
  const resp = await bpSend({
    action: "otp",
    storeId: "default",
    file,
    settings: { stores: bpStores() },
  });
  return resp.data?.code || "";
}

// dl.* extension actions — one round-trip each.
async function bpDlAdd(args)       { return bpSend({ action: "dl.add",    ...args }); }
async function bpDlList()          { return bpSend({ action: "dl.list" }); }
async function bpDlGid(action, gid){ return bpSend({ action, gid }); }

// Mirror dl.list snapshots to chrome.storage.local so downloads.html can
// paint instantly on open. Background polls dl.list whenever something is
// known to be active (after dl.add) and broadcasts to any open page.
async function bpDlBroadcast() {
  try {
    const resp = await bpDlList();
    const jobs = resp.data?.jobs || [];
    await chrome.storage.local.set({ [DL_SNAPSHOT_KEY]: { jobs, ts: Date.now() } });
    chrome.runtime.sendMessage({ kind: "dl.event", event: { kind: "dl.progress", jobs } }).catch(() => {});
  } catch (e) {
    // worker process not registered → silently skip
  }
}
