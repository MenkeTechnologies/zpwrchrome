// zpwrchrome — service worker
// MV3: no persistent globals; state lives in chrome.storage.session.

import {
  MRU_CAP_DEFAULT,
  mruPush,
  mruDrop,
  mruStep as mruStepPure,
  mruPrevious,
  hostnameOf,
  resolveJumpIndex
} from "./lib/util.js";
import {
  parseMetadata,
  validateUserscript,
  userscriptId,
  includeToMatchPattern
} from "./lib/userscript.js";
import { GM_SHIM_SOURCE } from "./lib/gm-shim.js";

const MRU_KEY = "mru";

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
  // Regular pages: content script renders the shadow-DOM modal overlay.
  // chrome://, view-source://, web store, extension pages: Chrome blocks
  // content scripts, so we open the toolbar action popup, which renders
  // the SAME 2-column layout as the in-page modal (popup.html mirrors
  // modal/content.js).
  const t = await getActive();
  if (!t?.id) return chrome.action.openPopup().catch(() => {});
  try {
    await chrome.tabs.sendMessage(t.id, { kind: "open-modal" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: t.id },
        files: ["modal/content.js"]
      });
      await chrome.tabs.sendMessage(t.id, { kind: "open-modal" });
    } catch {
      await chrome.action.openPopup().catch(() => {});
    }
  }
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

async function readScripts() {
  const { [SCRIPTS_KEY]: arr } = await chrome.storage.local.get(SCRIPTS_KEY);
  return Array.isArray(arr) ? arr : [];
}

async function writeScripts(scripts) {
  await chrome.storage.local.set({ [SCRIPTS_KEY]: scripts });
  await syncUserScripts();
}

async function syncUserScripts() {
  if (!chrome.userScripts) return; // permission absent or older Chrome
  const scripts = await readScripts();
  // Unregister our existing entries (filter by id prefix to avoid clobbering
  // anything another extension may have left behind — though chrome.userScripts
  // is per-extension, the filter is still good hygiene).
  try {
    await chrome.userScripts.unregister();
  } catch (e) {
    // Throws when dev mode is off — surface in storage so the manager can show it.
    await chrome.storage.local.set({ "userScripts.error": e.message || String(e) });
    return;
  }
  await chrome.storage.local.remove("userScripts.error");

  const registrations = [];
  for (const s of scripts) {
    if (!s.enabled) continue;
    const meta = parseMetadata(s.src);
    if (!meta || validateUserscript(meta).length) continue;

    const matches = meta.matches.length
      ? meta.matches
      : meta.includes.map(includeToMatchPattern).filter(Boolean);
    if (!matches.length) continue;

    const info = {
      script: {
        id: userscriptId(meta),
        name: meta.name,
        namespace: meta.namespace,
        version: meta.version,
        description: meta.description,
        author: meta.author,
        grants: meta.grants,
        matches: matches,
        excludes: meta.excludes
      },
      version: chrome.runtime.getManifest().version,
      scriptHandler: "zpwrchrome",
      scriptMetaStr: (s.src.match(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/) || [""])[0]
    };

    const shim = GM_SHIM_SOURCE.replace("__GM_INFO_JSON__", JSON.stringify(info));
    const code = `(function () {\n${shim}\ntry {\n${s.src}\n} catch (e) { console.error("[zpwrchrome userscript]", ${JSON.stringify(meta.name)}, e); }\n}).call(window);`;

    registrations.push({
      id: userscriptId(meta),
      matches,
      excludeMatches: meta.excludes,
      js: [{ code }],
      runAt: meta.runAt.replace(/-/g, "_"), // chrome wants document_idle etc.
      world: "USER_SCRIPT",
      allFrames: false
    });
  }

  if (registrations.length) {
    try {
      await chrome.userScripts.register(registrations);
    } catch (e) {
      await chrome.storage.local.set({ "userScripts.error": e.message || String(e) });
    }
  }
}

chrome.runtime.onInstalled.addListener(syncUserScripts);
chrome.runtime.onStartup.addListener(syncUserScripts);

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
    Promise.all([readScripts(), chrome.storage.local.get("userScripts.error")])
      .then(([scripts, err]) => sendResponse({ ok: true, scripts, error: err["userScripts.error"] || null }));
    return true;
  }
  if (msg?.kind === "scripts.save") {
    (async () => {
      const all = await readScripts();
      const incoming = msg.script;
      const meta = parseMetadata(incoming.src);
      const errors = validateUserscript(meta);
      if (errors.length) { sendResponse({ ok: false, errors }); return; }
      incoming.id = incoming.id || userscriptId(meta);
      incoming.name = meta.name;
      incoming.updatedAt = Date.now();
      const idx = all.findIndex((s) => s.id === incoming.id);
      if (idx >= 0) all[idx] = { ...all[idx], ...incoming };
      else { incoming.enabled = incoming.enabled !== false; all.push(incoming); }
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
});
