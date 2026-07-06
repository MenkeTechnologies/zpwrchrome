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
import { matchIn, parseEntry, fallbackUsernameFromPath, fallbackUrlFromPath } from "./lib/bp-pass.js";
import { computeOtpFromUrl } from "./lib/totp.js";
import { UA_PRESETS, getPreset, presetGroups, resolveUA } from "./lib/ua-presets.js";
import {
  buildDnrRules as modheaderBuildDnrRules,
  defaultModheaderState,
  MODHEADER_RULE_BASE,
  MODHEADER_RULE_CAP,
} from "./lib/modheader.js";
import { STATE_KEY as DL_POSTCMD_KEY, pickRule as pickPostCmdRule, buildSpawn as buildPostCmdSpawn } from "./lib/dl-postcommands.js";
import { compileFingerprints, detect as wappDetect, scrapeSignals } from "./lib/wappalyzer/engine.js";
// JSON-module import attributes (`with { type: "json" }`) load
// unreliably in some Chrome MV3 SW versions — the error surfaces as
// "Failed to load the script unexpectedly" on the technologies.json
// path. We use fetch + JSON.parse instead, which works in every Chrome
// version that supports MV3 SWs. The bundled .json files are
// accessible to the SW via chrome.runtime.getURL without any
// web_accessible_resources entry (only content scripts / web pages
// would need WAR).
import {
  PROFILE_TOKENS,
  CC_TOKENS,
  TOKEN_SYNONYMS,
  expandFieldValue,
} from "./lib/identity-tokens.js";
import { loadSettings as loadDlSettings, DL_DEFAULTS as DL_SETTINGS_DEFAULTS, saveSettings as saveDlSettings } from "./scripts-manager/dl-settings.js";
import { loadInterface as loadDlInterface, DL_INTERFACE_DEFAULTS } from "./scripts-manager/dl-interface.js";
import { loadRules as loadDlRules } from "./scripts-manager/dl-rules.js";
import { diagPush, diagRead, diagClear } from "./lib/diag.js";
import { expandBatchSafe }                from "./lib/dl-batch.js";
import { screenshotFullPage, blobToBase64 } from "./lib/screenshot.js";
import { extractCslFromPage } from "./lib/zcite-extract.js";

const MRU_KEY = "mru";
const DL_SETTINGS_KEY = "dl.settings";
const DL_INTERFACE_KEY = "dl.interface";
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
  if (command === "open-history")         return openHistoryInPopup();
  if (command === "pass-open-popup")      return openPassInPopup();
  if (command === "pass-fill")            return passFillActive();
  if (command === "pass-copy-pw")         return passCopyForActive("pw");
  if (command === "pass-copy-user")       return passCopyForActive("user");
  if (command === "pass-copy-otp")        return passCopyForActive("otp");
  if (command === "pass-open-url")        return passOpenUrlForActive();
  if (command === "pass-fill-identity")   return passFillIdentityCombinedActive();
  if (command === "pass-fill-profile")    return passFillIdentityActive("profile");
  if (command === "pass-fill-cc")         return passFillIdentityActive("creditcard");
  if (command === "find-in-all-tabs")     return openFindAllTabs();
  if (command === "lights-off")           return toggleLightsOffActive();
  if (command === "reader-mode")          return toggleReaderModeActive();
  if (command === "screenshot-full-page") return doScreenshotFullPage();
  if (command === "dl-paste-url")         return dlPasteUrl();
  if (command === "dl-show-queue")        return dlShowQueue();
  if (command === "dl-pause-all")         return dlPauseAll();
  if (command === "dl-resume-all")        return dlResumeAll();
}

async function openPassInPopup() {
  await chrome.storage.session.set({ pendingCategory: "pass" });
  await chrome.action.openPopup().catch(() => {});
}

// Full-page pass manager — focus an existing tab if one is already open,
// else create a new one. Same pattern as openScriptsManager() and the
// downloads manager handler.
async function openPassManager() {
  const url = chrome.runtime.getURL("scripts-manager/pass.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId != null) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

// Find-in-all-tabs — opens the search UI in a new tab (or focuses the
// existing one). Same pattern as openPassManager / openScriptsManager.
async function openFindAllTabs() {
  const url = chrome.runtime.getURL("scripts-manager/find-all.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId != null) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

// Turn off the lights — send a toggle message to the active tab's
// content script. The script in modal/lights-off.js owns the overlay
// element + the lifted-video state; the SW just kicks the toggle.
async function toggleLightsOffActive() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "lights-off:toggle" });
  } catch {
    // Tab without the content script (chrome://, store, etc.) — try
    // an on-the-fly inject so toolbar context menu still works on
    // pages we'd normally skip.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["modal/lights-off.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "lights-off:toggle" });
    } catch {}
  }
}

// Reader mode — strip active page to its main article inside an overlay.
// Same fallback pattern as toggleLightsOffActive: try a sendMessage to
// the content script first; if no listener (tab without the script
// because the SW was woken before document_idle), inject on the fly.
async function toggleReaderModeActive() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "reader-mode:toggle" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["modal/reader-mode.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "reader-mode:toggle" });
    } catch {}
  }
}

// Lights-off manager page (opacity/fade/color/blocklist).
async function openLightsOffManager() {
  const url = chrome.runtime.getURL("scripts-manager/lights-off.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId != null) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

// UA switcher — opens the UI page.
async function openUaSwitcher() {
  const url = chrome.runtime.getURL("scripts-manager/ua-switcher.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId != null) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

// ────────────────────────────────────────────────────────────────────
// User-Agent switcher — persisted settings + declarativeNetRequest
// dynamic rule that rewrites the User-Agent request header.
//
// Settings shape (chrome.storage.local key UA_STATE_KEY):
//   { enabled: bool, mode: "preset" | "custom", presetId?, customUA? }
// Rule id 1001 is dedicated to the UA modifier (so syncUaRule can
// idempotently add/remove without touching unrelated DNR rules).
const UA_STATE_KEY = "ua.state";
const UA_RULE_ID   = 1001;

async function getUaState() {
  const bag = await chrome.storage.local.get(UA_STATE_KEY);
  return bag?.[UA_STATE_KEY] || { enabled: false, mode: "preset", presetId: "chrome-mac", customUA: "" };
}
async function setUaState(patch) {
  const next = { ...(await getUaState()), ...(patch || {}) };
  await chrome.storage.local.set({ [UA_STATE_KEY]: next });
  await syncUaRule(next);
  return next;
}

async function syncUaRule(state) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  const ua = resolveUA(state);
  try {
    if (!ua) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [UA_RULE_ID],
        addRules: [],
      });
      diagPush("ua.rule.cleared", {});
      return;
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [UA_RULE_ID],
      addRules: [{
        id: UA_RULE_ID,
        priority: 1,
        condition: { urlFilter: "*", resourceTypes: [
          "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
          "object", "xmlhttprequest", "ping", "media", "websocket", "other",
        ] },
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "user-agent", operation: "set", value: ua }],
        },
      }],
    });
    diagPush("ua.rule.set", { uaLen: ua.length });
  } catch (e) {
    diagPush("ua.rule.err", { err: String(e?.message || e) });
    console.warn("[zpwrchrome] ua-switcher rule sync:", e?.message || e);
  }
}

// Run once on SW boot — reapply whatever was persisted so settings
// survive SW suspension.
(async () => { try { await syncUaRule(await getUaState()); } catch {} })();

// ─── ModHeader: modify HTTP request/response headers + URL redirects ──
//
// Generalisation of the UA switcher. Multiple profiles, each with N rules;
// only the active profile's enabled rules project into
// chrome.declarativeNetRequest dynamic rules. Pure projection helper lives
// in lib/modheader.js for unit testing without a Chrome runtime. DNR rule
// IDs 2000..2999 are reserved (UA switcher owns 1001 — do not overlap).
const MODHEADER_STATE_KEY = "modheader.state";

async function getModheaderState() {
  const bag = await chrome.storage.local.get(MODHEADER_STATE_KEY);
  const s = bag?.[MODHEADER_STATE_KEY];
  if (!s || !Array.isArray(s.profiles) || !s.profiles.length) return defaultModheaderState();
  return s;
}

async function setModheaderState(next) {
  await chrome.storage.local.set({ [MODHEADER_STATE_KEY]: next });
  await syncModheaderRules(next);
  return next;
}

async function syncModheaderRules(state) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  const removeRuleIds = [];
  for (let i = 0; i < MODHEADER_RULE_CAP; i++) removeRuleIds.push(MODHEADER_RULE_BASE + i);
  const addRules = modheaderBuildDnrRules(state);
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
    diagPush("modheader.rule.sync", { count: addRules.length });
  } catch (e) {
    diagPush("modheader.rule.err", { err: String(e?.message || e) });
    console.warn("[zpwrchrome] modheader rule sync:", e?.message || e);
  }
}

// Reapply persisted rules on SW boot so settings survive suspension.
(async () => { try { await syncModheaderRules(await getModheaderState()); } catch {} })();

async function passMatchActive() {
  const t = await getActive();
  const h = hostnameOf(t?.url || "");
  if (!h) {
    diagPush("pass.match.no_host", { url: t?.url });
    return { matches: [], host: "" };
  }
  try {
    const matches = await bpMatchByHost(h);
    diagPush("pass.match.ok", { host: h, count: matches.length });
    return { matches, host: h };
  } catch (e) {
    diagPush("pass.match.err", { host: h, err: String(e?.message || e), code: e?.code });
    console.warn("[zpwrchrome] pass.match:", e?.message || e);
    return { matches: [], host: h };
  }
}

async function passCopyForActive(field) {
  diagPush("pass.copy.start", { field });
  const { matches, host } = await passMatchActive();
  if (!matches.length) { diagPush("pass.copy.skip", { reason: "no_matches", host }); return; }
  const m = matches[0];
  diagPush("pass.copy.match", { field, host, path: m.path, total: matches.length });
  try {
    if (field === "otp") {
      const code = await passOtpCodeForPath(m.path);
      if (!code) { diagPush("pass.copy.no_otp", { path: m.path }); return; }
      await passClipboardCopy(code);
      diagPush("pass.copy.ok", { field, path: m.path });
      return;
    }
    const entry = await bpFetchParsed(m.path);
    const text = field === "user" ? entry.username : entry.password;
    if (!text) { diagPush("pass.copy.empty_field", { field, path: m.path }); return; }
    await passClipboardCopy(text);
    diagPush("pass.copy.ok", { field, path: m.path });
  } catch (e) {
    diagPush("pass.copy.err", { field, err: String(e?.message || e), code: e?.code });
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

// Schemeless URLs in pass entries — e.g. `10.59.0.17` or `example.com`
// from fallbackUrlFromPath when no explicit `url:` key is present — get
// interpreted by chrome.tabs.update as RELATIVE to the popup's origin
// (chrome-extension://<id>/), so opening lands at e.g.
// chrome-extension://<id>/10.59.0.17 → 404. Coerce to an absolute URL
// here. Hostnames + bare hosts default to https:// (modern web); IPs
// + host:port shapes default to http:// (typical internal services
// shipped via raw IPs).
function normalizeOpenUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;       // already has scheme
  if (s.startsWith("//")) return `https:${s}`;            // protocol-relative
  // Local-ish: raw IPv4, IPv6 in brackets, localhost, *.local — http://.
  const head = s.split(/[\/?#]/)[0];                      // host[:port] only
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(head);
  const isIPv6 = /^\[[0-9a-f:]+\](:\d+)?$/i.test(head);
  const isLocal = /^(localhost|[\w-]+\.local)(:\d+)?$/i.test(head);
  const isHostPort = /^[\w.-]+:\d+$/.test(head);
  if (isIPv4 || isIPv6 || isLocal || isHostPort) return `http://${s}`;
  return `https://${s}`;
}

async function passOpenUrlForActive() {
  const { matches } = await passMatchActive();
  if (!matches.length) return;
  const m = matches[0];
  try {
    const entry = await bpFetchParsed(m.path);
    const url = normalizeOpenUrl(entry.url);
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
    const url = normalizeOpenUrl(entry.url);
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

// Fetch + copy in one SW round-trip. Used by the popup's user / pw / otp
// buttons because navigator.clipboard.writeText() in the popup itself
// loses its user-gesture window across the SW + NM + GPG round-trip.
// Routes through writeClipboard() which injects into the active page —
// gesture context is the popup click that triggered the message.
async function passCopyFieldForPath(path, field) {
  if (!path || !field) return { ok: false, err: "missing path or field" };
  try {
    let text = "";
    if (field === "otp") {
      text = await passOtpCodeForPath(path);
    } else {
      const entry = await bpFetchParsed(path);
      if (field === "password" || field === "pw") text = String(entry.password || "");
      else if (field === "username" || field === "user") text = String(entry.username || "");
      else if (field === "url") text = normalizeOpenUrl(entry.url) || String(entry.url || "");
      else return { ok: false, err: `unknown field: ${field}` };
    }
    if (!text) return { ok: false, err: `empty ${field}` };
    await passClipboardCopy(text);
    return { ok: true, length: text.length };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}

// ────────────────────────────────────────────────────────────────────
// Identity / credit-card fill.
//
// Entries under `profile/*` and `creditcard/*` in the pass store are
// treated as autofill sources. Their `key: value` block uses WHATWG
// HTML autocomplete tokens directly (cc-number, cc-exp, given-name,
// street-address, postal-code, …) — see lib/identity-tokens.js for the
// full set + the recognizer.
//
// Flow:
//   1. List entries under the prefix.
//   2. If 2+, inject a shadow-DOM picker into the active tab (last-used
//      cached per host) and wait for the user's choice.
//   3. Fetch + decrypt the chosen entry via the BP host.
//   4. Inject fillIdentityForm() into every frame of the active tab,
//      passing the fields bag + synonym map + token list as args.
const IDENTITY_LAST_USED_KEY = "pass.identity.lastUsed";
const IDENTITY_PICKER_TIMEOUT_MS = 60_000;

async function passFillIdentityActive(kind) {
  diagPush("pass.identity.fill.start", { kind });
  const t = await getActive();
  if (!t?.id) {
    diagPush("pass.identity.fill.skip", { kind, reason: "no_active_tab" });
    return;
  }
  const host = hostnameOf(t.url || "");
  const fields = await pickAndFetchIdentityFields(t.id, host, kind);
  if (!fields) return;
  await injectIdentityFill(t.id, fields, { kinds: [kind] });
}

// Combined fill: gather fields from BOTH profile/* and creditcard/*
// entries (each kind goes through its own pick/cache/picker), merge
// into one bag, inject fillIdentityForm once. The fill function only
// touches recognized fields on the page — so a page with only profile
// inputs gets only profile values written, even when we passed CC
// values in the bag. Single keystroke for a checkout that has both.
async function passFillIdentityCombinedActive() {
  diagPush("pass.identity.fill.combined.start");
  const t = await getActive();
  if (!t?.id) {
    diagPush("pass.identity.fill.combined.skip", { reason: "no_active_tab" });
    return;
  }
  const host = hostnameOf(t.url || "");
  // Pre-scan the page so we only invoke pickers for categories that
  // actually have inputs to fill. Without this, a profile-only address
  // page would still pop the creditcard picker (user has multiple cards)
  // before injecting fields that nothing on the page recognizes.
  let detected;
  try {
    detected = await detectIdentityCategoriesOnPage(t.id);
  } catch (e) {
    diagPush("pass.identity.fill.combined.detect_err", { err: String(e?.message || e) });
    detected = { profile: true, creditcard: true };  // fall through to both
  }
  diagPush("pass.identity.fill.combined.detected", detected);
  const merged = {};
  const usedKinds = [];
  for (const kind of ["profile", "creditcard"]) {
    if (!detected[kind]) {
      diagPush("pass.identity.fill.combined.skip_kind", { kind, reason: "no_fields_on_page" });
      continue;
    }
    let paths;
    try {
      paths = await bpListEntriesUnderPrefix(`${kind}/`);
    } catch (e) {
      diagPush("pass.identity.fill.combined.list_err", { kind, err: String(e?.message || e) });
      continue;
    }
    if (!paths.length) continue;  // silent skip — no need to nag when the
                                  // user has only one of the two kinds
    const fields = await pickAndFetchIdentityFields(t.id, host, kind, paths);
    if (!fields) continue;
    Object.assign(merged, fields);
    usedKinds.push(kind);
  }
  if (!usedKinds.length) {
    notify({
      title: "zpwrchrome — pass identity fill",
      message: !detected.profile && !detected.creditcard
        ? "No recognized profile or credit-card fields on this page."
        : "No matching `profile/*` or `creditcard/*` entries in the pass store. Add one in the pass manager.",
    });
    return;
  }
  await injectIdentityFill(t.id, merged, { kinds: usedKinds });
}

// Page-side scan: walk every visible <input>/<select>/<textarea>, run
// the same recognizer used by fillIdentityForm, return which token
// categories appear. Lets the orchestrator skip the picker for
// categories not present on the page.
async function detectIdentityCategoriesOnPage(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: scanIdentityCategories,
    args: [TOKEN_SYNONYMS, [...PROFILE_TOKENS, ...CC_TOKENS], [...PROFILE_TOKENS], [...CC_TOKENS]],
  });
  const out = { profile: false, creditcard: false };
  for (const r of (results || [])) {
    if (r?.result?.profile)    out.profile    = true;
    if (r?.result?.creditcard) out.creditcard = true;
  }
  return out;
}

function scanIdentityCategories(synonyms, knownTokens, profileTokens, ccTokens) {
  const known = new Set(knownTokens);
  const profileSet = new Set(profileTokens);
  const ccSet      = new Set(ccTokens);
  function normalize(s) { return String(s || "").toLowerCase().replace(/[_\s]+/g, "-"); }
  function visible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const t = String(el.type || "").toLowerCase();
    if (t === "hidden" || t === "submit" || t === "button" || t === "reset" ||
        t === "image"  || t === "file"   || t === "checkbox" || t === "radio" || t === "password") return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    return true;
  }
  function labelText(el) {
    const doc = el.ownerDocument;
    if (el.id) {
      try {
        const lab = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) return lab.textContent || "";
      } catch {}
    }
    let p = el.parentElement;
    while (p) { if (p.tagName === "LABEL") return p.textContent || ""; p = p.parentElement; }
    return "";
  }
  function recognize(spec) {
    const ac = String(spec.autocomplete || "").trim().toLowerCase();
    if (ac) {
      if (known.has(ac)) return ac;
      for (const t of ac.split(/\s+/)) if (known.has(t)) return t;
      if (ac === "off" || ac === "current-password" || ac === "new-password") return null;
    }
    const hay = [spec.name, spec.id, spec.label, spec.placeholder].map(normalize).join(" ");
    let best = null, bestLen = 0;
    for (const token in synonyms) {
      for (const syn of synonyms[token]) {
        const sn = normalize(syn);
        if (hay.includes(sn) && sn.length > bestLen) { best = token; bestLen = sn.length; }
      }
    }
    if (best) return best;
    const tp = String(spec.type || "").toLowerCase();
    if (tp === "email") return "email";
    if (tp === "tel")   return "tel";
    return null;
  }
  let hasProfile = false;
  let hasCC = false;
  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (!visible(el)) continue;
    const token = recognize({
      autocomplete: el.autocomplete || "",
      name:         el.name         || "",
      id:           el.id           || "",
      label:        labelText(el),
      placeholder:  el.placeholder  || "",
      type:         el.type         || "",
    });
    if (!token) continue;
    if (ccSet.has(token))      hasCC      = true;
    else if (profileSet.has(token)) hasProfile = true;
    if (hasProfile && hasCC) break;
  }
  return { profile: hasProfile, creditcard: hasCC };
}

// Shared pick + fetch: list entries under `${kind}/` (or use the
// already-listed paths), use the last-used cache for an exact 1-entry
// store or as the picker's default for multi-entry stores, fetch and
// return the entry's fields bag (with top-level url/username promoted
// so the recognizer sees them).
async function pickAndFetchIdentityFields(tabId, host, kind, prelistedPaths) {
  let paths = prelistedPaths;
  if (!paths) {
    try {
      paths = await bpListEntriesUnderPrefix(`${kind}/`);
    } catch (e) {
      diagPush("pass.identity.fill.list_err", { kind, err: String(e?.message || e) });
      console.warn("[zpwrchrome] identity fill list:", e?.message || e);
      return null;
    }
  }
  diagPush("pass.identity.fill.candidates", { kind, count: paths.length, paths });
  if (!paths.length) {
    notify({
      title: "zpwrchrome — pass identity fill",
      message: `No \`${kind}/\` entries in the pass store. Add one in the pass manager (toolbar right-click → Open pass manager).`,
    });
    return null;
  }
  let chosen;
  if (paths.length === 1) {
    chosen = paths[0];
  } else {
    const last = await getIdentityLastUsed(kind, host);
    const ordered = last && paths.includes(last)
      ? [last, ...paths.filter((p) => p !== last)]
      : paths;
    chosen = await showIdentityPicker(tabId, kind, ordered);
    if (!chosen) {
      diagPush("pass.identity.fill.cancelled", { kind });
      return null;
    }
    await setIdentityLastUsed(kind, host, chosen);
  }
  let entry;
  try {
    entry = await bpFetchParsed(chosen);
  } catch (e) {
    diagPush("pass.identity.fill.fetch_err", { kind, path: chosen, err: String(e?.message || e) });
    console.warn("[zpwrchrome] identity fill fetch:", e?.message || e);
    return null;
  }
  const fields = { ...(entry.fields || {}) };
  if (entry.url      && !fields.url)   fields.url   = entry.url;
  if (entry.username && !fields.email && /@/.test(entry.username)) fields.email = entry.username;
  return fields;
}

async function injectIdentityFill(tabId, fields, { kinds }) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: fillIdentityForm,
      args: [fields, TOKEN_SYNONYMS, [...PROFILE_TOKENS, ...CC_TOKENS]],
    });
    const totalFilled = (results || []).reduce((s, r) => s + (r?.result?.filled || 0), 0);
    diagPush("pass.identity.fill.injected", {
      kinds, frames: results?.length || 0, totalFilled,
    });
    if (totalFilled === 0) {
      notify({
        title: "zpwrchrome — pass identity fill",
        message: `No recognized ${kinds.join(" / ")} fields on this page.`,
      });
    }
  } catch (e) {
    diagPush("pass.identity.fill.inject_err", { kinds, err: String(e?.message || e) });
    console.warn("[zpwrchrome] identity fill inject:", e?.message || e);
  }
}

async function bpListEntriesUnderPrefix(prefix) {
  const all = await bpListEntries();
  return all.filter((p) => p.startsWith(prefix)).sort();
}

async function getIdentityLastUsed(kind, host) {
  const bag = await chrome.storage.local.get(IDENTITY_LAST_USED_KEY);
  const m = bag?.[IDENTITY_LAST_USED_KEY] || {};
  return m?.[`${kind}|${host || ""}`] || null;
}
async function setIdentityLastUsed(kind, host, path) {
  const bag = await chrome.storage.local.get(IDENTITY_LAST_USED_KEY);
  const m = bag?.[IDENTITY_LAST_USED_KEY] || {};
  m[`${kind}|${host || ""}`] = path;
  await chrome.storage.local.set({ [IDENTITY_LAST_USED_KEY]: m });
}

function notify(opts) {
  if (!chrome.notifications) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title:   opts.title   || "zpwrchrome",
    message: opts.message || "",
  }, () => void chrome.runtime.lastError);
}

// In-tab shadow-DOM picker. Resolves to the chosen path or null on cancel
// / timeout. The picker page-side sends `identity.picker.result` back to
// the SW; we wire a one-shot listener tagged with a reqId so multiple
// concurrent invocations don't cross-talk.
async function showIdentityPicker(tabId, kind, paths) {
  const reqId = (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^a-z0-9-]/gi, "");
  return new Promise(async (resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      chrome.runtime.onMessage.removeListener(onMsg);
      resolve(v);
    };
    const onMsg = (msg, _sender, sendResponse) => {
      if (msg?.kind !== "identity.picker.result" || msg.reqId !== reqId) return;
      sendResponse?.({ ok: true });
      finish(msg.path || null);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    setTimeout(() => finish(null), IDENTITY_PICKER_TIMEOUT_MS);
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        func:   openIdentityPicker,
        args:   [reqId, kind, paths],
      });
    } catch (e) {
      console.warn("[zpwrchrome] identity picker inject:", e?.message || e);
      finish(null);
    }
  });
}

// ────────────────────────────────────────────────────────────────────
// Page-injected functions — must be self-contained (no closures over
// background.js module scope). Args are JSON-serialized by
// chrome.scripting.executeScript.
//
// fillIdentityForm walks every visible <input>/<select>/<textarea> in
// the current frame, recognizes its autocomplete token, looks up a
// value in the fields bag (with alias-chain fallbacks for cc-exp,
// name ↔ given/family, street-address ↔ address-line1/2/3), and writes
// via the native value setter so React/Vue/Lit observers fire.
function fillIdentityForm(fields, synonyms, knownTokens) {
  const known = new Set(knownTokens);
  function normalize(s) {
    return String(s || "").toLowerCase().replace(/[_\s]+/g, "-");
  }
  function labelText(el) {
    const doc = el.ownerDocument;
    if (el.id) {
      try {
        const lab = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) return lab.textContent || "";
      } catch {}
    }
    let p = el.parentElement;
    while (p) {
      if (p.tagName === "LABEL") return p.textContent || "";
      p = p.parentElement;
    }
    const labId = el.getAttribute("aria-labelledby");
    if (labId) {
      const lab = doc.getElementById(labId);
      if (lab) return lab.textContent || "";
    }
    return "";
  }
  function visible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const t = String(el.type || "").toLowerCase();
    if (t === "hidden" || t === "submit" || t === "button" || t === "reset" ||
        t === "image"  || t === "file"   || t === "checkbox" || t === "radio") return false;
    if (t === "password") return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    return true;
  }
  function nativeSet(el, val) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function recognize(spec) {
    const ac = String(spec.autocomplete || "").trim().toLowerCase();
    if (ac) {
      if (known.has(ac)) return ac;
      for (const t of ac.split(/\s+/)) if (known.has(t)) return t;
      if (ac === "off" || ac === "current-password" || ac === "new-password") return null;
    }
    const hay = [spec.name, spec.id, spec.label, spec.placeholder].map(normalize).join(" ");
    let best = null;
    let bestLen = 0;
    for (const token in synonyms) {
      for (const syn of synonyms[token]) {
        const sn = normalize(syn);
        if (hay.includes(sn) && sn.length > bestLen) {
          best = token; bestLen = sn.length;
        }
      }
    }
    if (best) return best;
    const tp = String(spec.type || "").toLowerCase();
    if (tp === "email") return "email";
    if (tp === "tel")   return "tel";
    return null;
  }
  function expand(token) {
    const direct = fields[token];
    if (direct != null && direct !== "") return String(direct);
    // Synonym lookup — friendly names (city, state, zipcode, …) in the
    // pass entry resolve to the canonical autocomplete token the form
    // expects. Mirrors lib/identity-tokens.js#expandFieldValue.
    const syns = synonyms[token];
    if (syns) {
      for (const syn of syns) {
        if (syn === token) continue;
        const v = fields[syn];
        if (v != null && v !== "") return String(v);
      }
    }
    if (token === "cc-exp" && fields["cc-exp-month"] && fields["cc-exp-year"]) {
      const m = String(fields["cc-exp-month"]);
      const y = String(fields["cc-exp-year"]);
      return `${m.length === 1 ? "0" + m : m}/${y.slice(-2)}`;
    }
    if (token === "cc-exp-month" && fields["cc-exp"]) {
      const m = String(fields["cc-exp"]).match(/^(\d{1,2})[\/-]/);
      return m ? (m[1].length === 1 ? "0" + m[1] : m[1]) : null;
    }
    if (token === "cc-exp-year" && fields["cc-exp"]) {
      const m = String(fields["cc-exp"]).match(/[\/-](\d{2,4})$/);
      return m ? m[1] : null;
    }
    if (token === "name") {
      const parts = [fields["given-name"], fields["additional-name"], fields["family-name"]].filter(Boolean);
      return parts.length ? parts.join(" ") : null;
    }
    if (token === "cc-name") {
      if (fields.name) return String(fields.name);
      const p1 = [fields["cc-given-name"], fields["cc-family-name"]].filter(Boolean);
      if (p1.length) return p1.join(" ");
      const p2 = [fields["given-name"], fields["family-name"]].filter(Boolean);
      return p2.length ? p2.join(" ") : null;
    }
    if (token === "given-name") {
      const n = String(fields.name || "").trim();
      return n ? n.split(/\s+/)[0] : null;
    }
    if (token === "family-name") {
      const n = String(fields.name || "").trim();
      if (!n) return null;
      const parts = n.split(/\s+/);
      return parts.length > 1 ? parts[parts.length - 1] : null;
    }
    if (token === "street-address") {
      const lines = [fields["address-line1"], fields["address-line2"], fields["address-line3"]].filter(Boolean);
      return lines.length ? lines.join("\n") : null;
    }
    if (token === "address-line1") {
      const street = String(fields["street-address"] || "");
      return street ? street.split("\n")[0] : null;
    }
    if (token === "country-name") {
      return fields.country != null ? String(fields.country) : null;
    }
    return null;
  }
  const filled = [];
  const candidates = document.querySelectorAll("input, select, textarea");
  for (const el of candidates) {
    if (!visible(el)) continue;
    const token = recognize({
      autocomplete: el.autocomplete || "",
      name:         el.name         || "",
      id:           el.id           || "",
      label:        labelText(el),
      placeholder:  el.placeholder  || "",
      type:         el.type         || "",
    });
    if (!token) continue;
    const val = expand(token);
    if (val == null || val === "") continue;
    nativeSet(el, val);
    filled.push({ token, name: el.name || "", id: el.id || "" });
  }
  return { filled: filled.length, fields: filled, origin: location?.origin || "" };
}

// In-tab shadow-DOM picker. Same z-index ceiling as the tab-switcher
// modal; closed shadow so the host page can't restyle it.
function openIdentityPicker(reqId, kind, paths) {
  const existing = document.getElementById(`__zpc_idpicker_${reqId}`);
  if (existing) existing.remove();
  const host = document.createElement("div");
  host.id = `__zpc_idpicker_${reqId}`;
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .scrim {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.7);
        display: flex; align-items: center; justify-content: center;
        font-family: 'Share Tech Mono', 'SF Mono', monospace;
      }
      .box {
        background: #0d0d1a; border: 1px solid #05d9e8;
        box-shadow: 0 0 24px rgba(5,217,232,0.4);
        padding: 16px 18px;
        border-radius: 4px;
        min-width: 360px; max-width: 540px;
        color: #e0f0ff;
      }
      h1 {
        font-size: 11px; color: #05d9e8;
        margin: 0 0 12px;
        letter-spacing: 2px; text-transform: uppercase;
        font-weight: 700;
      }
      input {
        width: 100%; box-sizing: border-box;
        background: #05050a; border: 1px solid #1a1a3e;
        color: #e0f0ff;
        font-family: inherit; font-size: 12px;
        padding: 6px 10px; border-radius: 2px;
        margin-bottom: 10px;
      }
      input:focus { outline: none; border-color: #05d9e8; box-shadow: 0 0 4px rgba(5,217,232,0.4); }
      ul { list-style: none; padding: 0; margin: 0; max-height: 360px; overflow: auto; }
      li {
        padding: 8px 10px; cursor: pointer;
        border-left: 2px solid transparent;
        font-size: 13px; color: #e0f0ff;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      li.sel { background: #12122a; border-left-color: #05d9e8; color: #05d9e8; }
      li:hover { background: #12122a; }
      .hint {
        font-size: 10px; color: #7a8ba8;
        margin-top: 12px; text-align: right;
        letter-spacing: 1px;
      }
    </style>
    <div class="scrim">
      <div class="box" role="dialog" aria-modal="true">
        <h1>fill ${kind} from pass</h1>
        <input id="q" type="search" autocomplete="off" placeholder="filter…" autofocus>
        <ul id="lst"></ul>
        <div class="hint">↑↓ select · Enter fill · Esc cancel</div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(host);
  const q   = root.getElementById("q");
  const lst = root.getElementById("lst");
  let idx = 0;
  let filt = paths.slice();
  function render() {
    if (filt.length === 0) {
      lst.innerHTML = `<li style="color:#7a8ba8;cursor:default;">no matches</li>`;
      return;
    }
    if (idx >= filt.length) idx = filt.length - 1;
    if (idx < 0) idx = 0;
    lst.innerHTML = filt.map((p, i) =>
      `<li class="${i === idx ? "sel" : ""}" data-i="${i}">${p.replace(/[<>&"]/g, (c) => ({ "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;" }[c]))}</li>`
    ).join("");
    Array.from(lst.querySelectorAll("li[data-i]")).forEach((el) => {
      el.addEventListener("click", () => { idx = Number(el.dataset.i); send(filt[idx]); });
      el.addEventListener("mouseenter", () => { idx = Number(el.dataset.i); render(); });
    });
  }
  function refilter() {
    const s = q.value.trim().toLowerCase();
    filt = s ? paths.filter((p) => p.toLowerCase().includes(s)) : paths.slice();
    idx = 0;
    render();
  }
  function send(path) {
    chrome.runtime.sendMessage({ kind: "identity.picker.result", reqId, path }, () => void chrome.runtime.lastError);
    cleanup();
  }
  function cleanup() {
    document.removeEventListener("keydown", onKey, true);
    host.remove();
  }
  function onKey(ev) {
    if (ev.key === "ArrowDown") { idx++; render(); ev.preventDefault(); ev.stopPropagation(); }
    else if (ev.key === "ArrowUp") { idx--; render(); ev.preventDefault(); ev.stopPropagation(); }
    else if (ev.key === "Enter")   { if (filt[idx]) send(filt[idx]); ev.preventDefault(); ev.stopPropagation(); }
    else if (ev.key === "Escape")  { send(null); ev.preventDefault(); ev.stopPropagation(); }
  }
  document.addEventListener("keydown", onKey, true);
  q.addEventListener("input", refilter);
  render();
  setTimeout(() => q.focus(), 0);
}
// ────────────────────────────────────────────────────────────────────

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
  const dlSettings = await loadDlSettings();
  const autoSubmit = !!(dlSettings.passAutoSubmit || settings.autoSubmit);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: t.id, allFrames: true },
      func: fillLoginForm,
      args: [String(entry.username || ""), String(entry.password || ""), autoSubmit],
    });
    // Success = any frame filled at least ONE of password / username
    // (browserpass parity — 2-step login pages fill only one per step).
    return Array.isArray(results) && results.some(
      (r) => r?.result?.pwFilled === true || r?.result?.userFilled === true || r?.result?.filled === true,
    );
  } catch (e) {
    console.warn("[zpwrchrome] pass.fill inject:", e?.message || e);
    return false;
  }
}

async function passFillActive() {
  diagPush("pass.fill.start");
  const t = await getActive();
  if (!t?.id) { diagPush("pass.fill.skip", { reason: "no_active_tab" }); return; }
  const h = hostnameOf(t.url || "");
  if (!h)     { diagPush("pass.fill.skip", { reason: "no_hostname", url: t.url }); return; }
  diagPush("pass.fill.host", { host: h, tabId: t.id });
  let matches;
  try {
    matches = await bpMatchByHost(h);
  } catch (e) {
    diagPush("pass.fill.match_err", { host: h, err: String(e?.message || e), code: e?.code });
    console.warn("[zpwrchrome] pass-fill match:", e?.message || e);
    return;
  }
  diagPush("pass.fill.matches", { host: h, count: matches.length, paths: matches.slice(0, 5).map((m) => m.path) });
  if (!matches.length) { diagPush("pass.fill.skip", { reason: "no_matches", host: h }); return; }
  if (matches.length > 1) {
    diagPush("pass.fill.disambiguate", { host: h, count: matches.length });
    return openPassInPopup();
  }
  let entry;
  try {
    entry = await bpFetchParsed(matches[0].path);
  } catch (e) {
    diagPush("pass.fill.fetch_err", { path: matches[0].path, err: String(e?.message || e), code: e?.code });
    console.warn("[zpwrchrome] pass-fill fetch:", e?.message || e);
    return;
  }
  diagPush("pass.fill.entry", {
    path: matches[0].path,
    hasUsername: !!entry.username,
    hasPassword: !!entry.password,
    fieldKeys: Object.keys(entry).filter((k) => k !== "password" && k !== "raw"),
  });
  const settings = await getPassSettings();
  const dlSettings = await loadDlSettings();
  const autoSubmit = !!(dlSettings.passAutoSubmit || settings.autoSubmit);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: t.id, allFrames: true },
      func: fillLoginForm,
      args: [String(entry.username || ""), String(entry.password || ""), autoSubmit],
    });
    const summary = (results || []).map((r) => ({
      origin:    r?.result?.origin,
      pwFilled:  !!(r?.result?.pwFilled || r?.result?.filled),
      userFilled:!!r?.result?.userFilled,
      reason:    r?.result?.reason,
      submitted: !!r?.result?.submitted,
    }));
    // Either field counts as filled — covers the 2-step login case.
    const filledCount = summary.filter((s) => s.pwFilled || s.userFilled).length;
    diagPush("pass.fill.injected", {
      frames:      summary.length,
      filled:      filledCount,
      autoSubmit:  autoSubmit,
      perFrame:    summary,
    });
    if (filledCount === 0) {
      diagPush("pass.fill.no_password_field", { reasons: summary.map((s) => s.reason).filter(Boolean) });
    }
  } catch (e) {
    diagPush("pass.fill.inject_err", { err: String(e?.message || e) });
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
  // Heuristic: does an <input> look like a username/email field even when
  // no password field is anchored next to it? Used on pages that split
  // login into two steps (Google / Microsoft / Okta) — the first step
  // is username-only, the second is password-only. Browserpass fills
  // whichever step you're on; we needed to match that.
  function looksLikeUsername(el) {
    const t = String(el.type || "").toLowerCase();
    if (t === "email") return true;
    const ac = String(el.autocomplete || "").toLowerCase();
    if (ac.includes("username") || ac === "email") return true;
    const blob = `${el.name || ""} ${el.id || ""} ${el.placeholder || ""}`.toLowerCase();
    return /\b(user(name)?|email|e-?mail|login|account|signin|userid|user-id)\b/.test(blob);
  }
  function findUsernameAnchoredOnPassword(pwEl) {
    // Same form (preferred) or whole document; pick the visible text-like
    // input immediately preceding the password in document order.
    const sel = 'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"])';
    const all = pwEl.form
      ? [...pwEl.form.querySelectorAll(sel)]
      : [...document.querySelectorAll(sel)];
    const visibleAll = all.filter(visible);
    const before = visibleAll.filter((c) => pwEl.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING);
    return before.length ? before[before.length - 1] : visibleAll[0] || null;
  }
  function findStandaloneUsername() {
    // No password on the page — find the most likely username field by
    // type=email, autocomplete=username/email, or name/id/placeholder
    // matching a username-ish keyword.
    const all = [...document.querySelectorAll('input')].filter(visible);
    return all.find(looksLikeUsername) || null;
  }

  const pw = [...document.querySelectorAll('input[type="password"]')].find(visible);

  let userEl = null;
  let userFilled = false;
  if (username) {
    userEl = pw ? findUsernameAnchoredOnPassword(pw) : findStandaloneUsername();
    if (userEl) { nativeSet(userEl, username); userFilled = true; }
  }

  let pwFilled = false;
  if (pw && password) { nativeSet(pw, password); pwFilled = true; }

  if (!userFilled && !pwFilled) {
    return {
      filled:  false,
      reason:  pw ? "no_visible_username_field" : "no_visible_login_or_password_field",
      origin:  location?.origin || "",
    };
  }

  // Focus order: password if we filled it (lets the user submit by hitting
  // Enter); else the username (e.g. for the first step of a 2-step login).
  if (pw && pwFilled) pw.focus();
  else if (userEl)    userEl.focus();

  let submitted = false;
  if (autoSubmit) {
    // Find the "Next" / "Continue" / "Sign in" button to CLICK — never
    // form.submit(). On SPAs (React/Vue/Svelte routers), form.submit()
    // does a hard GET navigation that puts every input value into the
    // URL query string and reloads the page, bypassing the framework's
    // own onClick handlers. The user's 10.59.0.17:5000/#/signin bug was
    // exactly this: step 1 (username only) got filled, then form.submit()
    // ran, the form had no submit button so the inputs serialized into
    // ?username=… and the page reloaded instead of advancing to step 2.
    //
    // Search order:
    //   1. <button|input type=submit> / unflagged <button> inside the form
    //   2. The anchor field's enclosing <form> for nested wrappers
    //   3. A few common selectors looked up document-wide as fallback
    //      (covers buttons rendered OUTSIDE the form by the SPA, common
    //      for shadcn/Material/Tailwind layouts)
    const anchor = (pw && pwFilled) ? pw : userEl;
    const form = anchor && anchor.form;
    const findInForm = (f) => {
      if (!f) return null;
      const b =
        f.querySelector('button[type="submit"]') ||
        f.querySelector('input[type="submit"]') ||
        f.querySelector('button:not([type="button"]):not([type="reset"])');
      return b && !b.disabled && visible(b) ? b : null;
    };
    const findNearby = (start) => {
      // BFS up the ancestor chain looking for a submit-shaped button.
      let cur = start;
      while (cur && cur !== cur.ownerDocument) {
        const b =
          cur.querySelector?.('button[type="submit"]') ||
          cur.querySelector?.('input[type="submit"]');
        if (b && !b.disabled && visible(b)) return b;
        cur = cur.parentElement;
      }
      return null;
    };
    const findByText = () => {
      const rx = /^(sign[- ]?in|log[- ]?in|continue|next|submit|enter)\b/i;
      const all = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')];
      return all.find((b) => {
        if (b.disabled || !visible(b)) return false;
        const t = String(b.value || b.textContent || b.getAttribute("aria-label") || "").trim();
        return rx.test(t);
      }) || null;
    };
    const submitBtn = findInForm(form) || findNearby(anchor) || findByText();
    if (submitBtn) {
      submitBtn.click();
      submitted = true;
    }
    // No form.submit() fallback by design — see comment above.
  }
  // Backward-compat: `filled` historically meant "password filled". Keep
  // that for downstream telemetry, but expose the new `pwFilled` /
  // `userFilled` granularly too so callers can tell the cases apart.
  return { filled: pwFilled, pwFilled, userFilled, submitted, origin: location?.origin || "" };
}

// Inject a content script into the active tab that enumerates URLs by
// kind, return the deduped list, then batch-enqueue. Empty selection
// surfaces a notification instead of silently no-op'ing.
async function runPageSniffer(menuId) {
  const t = await getActive();
  if (!t?.id) return;
  const kind = menuId === CTX_PG_IMAGES ? "images"
             : menuId === CTX_PG_MEDIA  ? "media"
             : "links";
  let urls = [];
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: t.id, allFrames: true },
      func: collectPageUrls,
      args: [kind],
    });
    urls = Array.isArray(result) ? result : [];
  } catch (e) {
    diagPush("dl.page-sniff.inject_err", { kind, err: String(e?.message || e) });
    return;
  }
  // Dedup + filter to http(s) only.
  const seen = new Set();
  urls = urls.filter((u) => {
    if (!/^https?:\/\//i.test(u)) return false;
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  diagPush("dl.page-sniff", { kind, host: hostnameOf(t.url || ""), count: urls.length });
  if (!urls.length) {
    chrome.notifications?.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "zpwrchrome — page sniffer",
      message: `No ${kind} found on this page.`,
    });
    return;
  }
  // Use the existing enrich + bpDlAdd path. Sequential to avoid hammering
  // the host with N concurrent dl.add calls — each spawns its own worker.
  let ok = 0;
  const sniffDir = await resolveDownloadDir();
  for (const u of urls) {
    try {
      const args = await enrichDownloadArgs(u, { dir: sniffDir });
      await bpDlAdd(args);
      ok++;
    } catch (e) {
      diagPush("dl.page-sniff.fail", { url: u, err: String(e?.message || e) });
    }
  }
  bpDlBroadcast();
  chrome.notifications?.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "zpwrchrome — page sniffer",
    message: `Enqueued ${ok} / ${urls.length} ${kind} from this page.`,
  });
}

// Injected into the active tab by runPageSniffer — serialized via
// chrome.scripting.executeScript so it must be a pure function with no
// outer closures.
function collectPageUrls(kind) {
  const out = [];
  function push(u) { if (u && typeof u === "string") out.push(new URL(u, location.href).href); }
  if (kind === "links") {
    for (const a of document.querySelectorAll('a[href]')) push(a.getAttribute("href"));
  } else if (kind === "images") {
    for (const img of document.querySelectorAll('img[src]')) push(img.getAttribute("src"));
    // Parse srcset to extract the highest-resolution candidate per image.
    for (const img of document.querySelectorAll('img[srcset]')) {
      const set = img.getAttribute("srcset") || "";
      const candidates = set.split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
      for (const c of candidates) push(c);
    }
    // <picture><source srcset="..."></picture>.
    for (const s of document.querySelectorAll('picture source[srcset]')) {
      const set = s.getAttribute("srcset") || "";
      const candidates = set.split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
      for (const c of candidates) push(c);
    }
  } else if (kind === "media") {
    for (const v of document.querySelectorAll('video[src]'))  push(v.getAttribute("src"));
    for (const a of document.querySelectorAll('audio[src]'))  push(a.getAttribute("src"));
    for (const s of document.querySelectorAll('video source[src], audio source[src]')) {
      push(s.getAttribute("src"));
    }
  }
  return out;
}

async function doScreenshotFullPage(tab) {
  // Redundant feedback channels — chrome.notifications is silently dropped
  // when Chrome's macOS notification permission is denied, so we ALSO log
  // to the SW console and flash the toolbar badge. Whichever channel works
  // for the user surfaces the outcome.
  diagPush("screenshot.start", { url: tab?.url });
  console.log("[zpwrchrome] screenshot starting on", tab?.url);
  await chrome.action?.setBadgeBackgroundColor?.({ color: "#ffb800" });
  await chrome.action?.setBadgeText?.({ text: "📸" });
  try {
    const { blob, filename } = await screenshotFullPage(tab);
    // Chunked upload — Chrome's per-message NM cap is ~1 MB so a multi-MB
    // base64 PNG would otherwise corrupt the framed JSON and the host bails
    // with "Unable to parse the length of the browser request". Split into
    // <512 KB chunks (after base64 expansion = ~683 KB of base64 text =
    // well under 1 MB envelope), stream through dl.writeFileChunk, final
    // chunk carries dir + name and triggers the rename.
    const base64 = await blobToBase64(blob);
    const settings = await loadDlSettings();
    const dir = (settings.downloadDir && settings.downloadDir.trim())
      ? settings.downloadDir.trim()
      : (settings.saveToLastUsedLocation && settings.lastDir)
        ? settings.lastDir
        : "";
    const sessionId = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-z0-9-]/gi, "");
    const CHUNK_SIZE = 512 * 1024;          // 512 KB of base64 per chunk
    const chunkCount = Math.max(1, Math.ceil(base64.length / CHUNK_SIZE));
    let resp;
    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SIZE;
      const slice = base64.slice(start, start + CHUNK_SIZE);
      const isLast = i === chunkCount - 1;
      resp = await bpSend({
        action:     "dl.writeFileChunk",
        sessionId,
        chunkIndex: i,
        base64:     slice,
        final:      isLast,
        dir:        isLast ? dir      : "",
        name:       isLast ? filename : "",
      });
      diagPush("screenshot.chunk", { i, of: chunkCount, bytes: slice.length, sessionId });
    }
    const dest  = resp?.data?.dest  || "";
    const bytes = resp?.data?.bytes || blob.size;
    diagPush("screenshot.done", { dest, bytes, filename, chunks: chunkCount });
    console.log("[zpwrchrome] screenshot saved →", dest, `(${bytes} bytes)`);
    await chrome.action?.setBadgeBackgroundColor?.({ color: "#39ff14" });
    await chrome.action?.setBadgeText?.({ text: "✓" });
    setTimeout(() => applyMultiplexedBadge(), 3000);
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "zpwrchrome — screenshot saved",
        message: dest || filename,
      }, () => void chrome.runtime.lastError);
    }
  } catch (e) {
    const msg = String(e?.message || e);
    diagPush("screenshot.err", { err: msg });
    console.error("[zpwrchrome] screenshot failed:", msg);
    await chrome.action?.setBadgeBackgroundColor?.({ color: "#ff2a6d" });
    await chrome.action?.setBadgeText?.({ text: "✕" });
    setTimeout(() => applyMultiplexedBadge(), 5000);
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "zpwrchrome — screenshot failed",
        message: msg.length > 200 ? msg.slice(0, 200) + "…" : msg,
      }, () => void chrome.runtime.lastError);
    }
  }
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
    const args = await enrichDownloadArgs(url, { dir: await resolveDownloadDir() });
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

// Resolve the destination directory for a download from settings, the same way
// the Chrome-takeover path does: an explicit user-set downloadDir wins, else
// the tracked lastDir (only when saveToLastUsedLocation is on), else the host
// default ~/Downloads. Centralized so the right-click menu, page sniffer,
// paste-URL command and takeover all honor the SAME configured folder — before
// this, only the takeover did, so right-click downloads silently ignored the
// user's chosen download folder and always landed in ~/Downloads.
async function resolveDownloadDir(settings) {
  const s = settings || await loadDlSettings();
  if (s.downloadDir && s.downloadDir.trim())   return s.downloadDir.trim();
  if (s.saveToLastUsedLocation && s.lastDir)   return s.lastDir;
  return "~/Downloads";
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

// URLs we re-issue as a normal Chrome download after a BP-host failure — must
// NOT be intercepted again (that would loop).
const zbFallbackDl = new Set();

if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(async (item) => {
    diagPush("dl.takeover.onCreated", { id: item?.id, url: item?.url, filename: item?.filename });
    if (!shouldInterceptDownload(item))   { diagPush("dl.takeover.skip", { reason: "not_intercepted", url: item?.url }); return; }
    if (item && zbFallbackDl.has(item.url)) { zbFallbackDl.delete(item.url); diagPush("dl.takeover.skip", { reason: "chrome_fallback" }); return; }
    if (!(await isTakeOverEnabled()))     { diagPush("dl.takeover.skip", { reason: "disabled" }); return; }

    // Cancel Chrome's download immediately. Erase from history so the
    // download shelf clears (the shelf may still flash briefly — there's
    // no MV3 API to suppress that without the deprecated downloads.shelf
    // permission).
    try { await chrome.downloads.cancel(item.id); } catch {}
    try { await chrome.downloads.erase({ id: item.id }); } catch {}

    // Chrome may have picked a full target path via its own heuristic OR via
    // the "Ask where to save each file" Save As dialog. Split it into the
    // basename (user-visible name) and the directory the user actually chose.
    const suggestedPath = String(item.filename || "");
    const suggested     = suggestedPath.split(/[\\/]/).pop();
    const chosenDir     = /[\\/]/.test(suggestedPath)
      ? suggestedPath.replace(/[\\/][^\\/]*$/, "")
      : "";
    const settings  = await loadDlSettings();
    // Priority: explicit user-set downloadDir (a deliberate override) > the
    // directory Chrome resolved for this download — i.e. the Save As choice,
    // which used to be discarded > tracked lastDir > ~/Downloads.
    const dir       = (settings.downloadDir && settings.downloadDir.trim())
      ? settings.downloadDir.trim()
      : chosenDir
        ? chosenDir
        : (settings.saveToLastUsedLocation && settings.lastDir)
          ? settings.lastDir
          : "~/Downloads";
    // Pull the rule-system default naming mask too. dl-rules.js exposes it
    // as `defaultMask`. Empty mask = host passes filename through verbatim.
    let mask = "";
    try {
      const rules = await loadDlRules();
      mask = String(rules?.defaultMask || "");
    } catch {}
    const args = await enrichDownloadArgs(item.url, {
      dir,
      name: suggested || undefined,
      mask,
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
      diagPush("dl.takeover.failed", { url: item?.url, err: String(e?.message || e), code: e?.code });
      console.warn("[zpwrchrome] download takeover failed:", e?.message || e);
      // The BP native host is unreachable (e.g. not installed) — the original
      // Chrome download was already cancelled, so re-issue it via Chrome so the
      // file isn't silently lost. zbFallbackDl stops us re-intercepting it.
      try { zbFallbackDl.add(item.url); await chrome.downloads.download({ url: item.url }); }
      catch (e2) { zbFallbackDl.delete(item.url); diagPush("dl.takeover.fallback_failed", { err: String(e2?.message || e2) }); }
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
// One sync broadcast on SW start clears any stale badge left over from a
// previous session (e.g. badge stuck at the last-seen pending count when
// the SW was suspended mid-download).
chrome.runtime.onInstalled.addListener(() => { bpDlBroadcast(); });
chrome.runtime.onStartup.addListener(()   => { bpDlBroadcast(); });

// ---------------------------------------------------------------------------
// Right-click context menus.
//   * On links + media → "Download with zpwrchrome".
//   * On the toolbar icon (contexts: ["action"]) → quick-access menu
//     mirroring Chrono's right-click: manager, settings, change folder,
//     diagnostics, help, report-issue, repo.

// "Save to zcite" — extract the active page's bibliographic metadata as CSL-JSON and hand
// it to the native host's `zcite.save`, which drops it into zcite's inbox for import. The
// MIT extension/host never link the proprietary zcite engine; the handoff is a CSL-JSON
// file in a shared directory.
async function savePageToZcite(tab) {
  if (!tab || !tab.id) return;
  let csl = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractCslFromPage,
    });
    csl = results && results[0] && results[0].result;
  } catch (e) {
    notifyZcite("Save to zcite failed", String((e && e.message) || e));
    return;
  }
  if (!csl || !csl.title) {
    notifyZcite("Save to zcite", "No citation metadata found on this page.");
    return;
  }
  try {
    await bpSend({ action: "zcite.save", item: csl });
    notifyZcite("Saved to zcite", csl.title);
  } catch (e) {
    notifyZcite("Save to zcite failed", String((e && e.message) || e));
  }
}

function notifyZcite(title, message) {
  if (chrome.notifications) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message: String(message || "").slice(0, 200),
    });
  }
}

const CTX_DL_LINK    = "zpwrchrome-dl-link";
const CTX_DL_MEDIA   = "zpwrchrome-dl-media";
const CTX_PG_LINKS   = "zpwrchrome-pg-links";
const CTX_PG_IMAGES  = "zpwrchrome-pg-images";
const CTX_PG_MEDIA   = "zpwrchrome-pg-media";
const CTX_PG_ZCITE   = "zpwrchrome-pg-zcite";
const CTX_ACT_MGR    = "zpc-act-manager";
const CTX_ACT_SCR    = "zpc-act-scripts";
const CTX_ACT_PASS   = "zpc-act-pass";
const CTX_ACT_FIND   = "zpc-act-find";
const CTX_ACT_UA     = "zpc-act-ua";
const CTX_ACT_MODHDR = "zpc-act-modhdr";
const CTX_ACT_THEME  = "zpc-act-theme";
const CTX_ACT_LIGHTS = "zpc-act-lights";
const CTX_ACT_LIGHTSCFG = "zpc-act-lightscfg";
const CTX_ACT_READER = "zpc-act-reader";
const CTX_ACT_READERCFG = "zpc-act-readercfg";
const CTX_ACT_DIAG   = "zpc-act-diag";
const CTX_ACT_SET    = "zpc-act-settings";
const CTX_ACT_IFACE  = "zpc-act-interface";
const CTX_ACT_EXTFLT = "zpc-act-extfilter";
const CTX_ACT_RULES  = "zpc-act-rules";
const CTX_ACT_FOLD   = "zpc-act-folder";
const CTX_ACT_EXTPG  = "zpc-act-extpage";
const CTX_ACT_SHOT   = "zpc-act-screenshot";
const CTX_ACT_HELP   = "zpc-act-help";
const CTX_ACT_ABOUT  = "zpc-act-about";
const CTX_ACT_ISSUE  = "zpc-act-issue";
const CTX_ACT_REPO   = "zpc-act-repo";
const CTX_ACT_SEP1   = "zpc-act-sep1";
const CTX_ACT_SEP2   = "zpc-act-sep2";
const CTX_ACT_SEP3   = "zpc-act-sep3";
// Submenu parents — Chrome caps top-level action-context-menu items at
// 6 (ACTION_MENU_TOP_LEVEL_LIMIT in the contextMenus API docs); items
// beyond #6 are silently dropped. Submenu children don't count against
// that cap, so we group everything except the 3 most-used quick
// actions under three parent submenus.
const CTX_SUB_MGRS   = "zpc-sub-mgrs";
const CTX_SUB_SET    = "zpc-sub-set";
const CTX_SUB_HELP   = "zpc-sub-help";

const REPO_URL  = "https://github.com/MenkeTechnologies/zpwrchrome";
const ISSUE_URL = "https://github.com/MenkeTechnologies/zpwrchrome/issues/new";

chrome.runtime.onInstalled.addListener(async () => {
  if (!chrome.contextMenus) return;
  // Wipe stale menu state first. We do need this now because the
  // restructure (everything-under-submenus) means old top-level ids
  // would collide with new parentId-children of the same id; without
  // a clean slate the create() calls silently no-op on the stale
  // version. Wrap removeAll in a manual Promise so the await blocks
  // SW termination regardless of whether the native API returns one.
  await new Promise((resolve) => chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    resolve();
  }));
  const ok = () => void chrome.runtime.lastError;
  // Link/media menus.
  chrome.contextMenus.create({ id: CTX_DL_LINK,  title: "Download with zpwrchrome", contexts: ["link"] }, ok);
  chrome.contextMenus.create({ id: CTX_DL_MEDIA, title: "Download with zpwrchrome", contexts: ["image", "video", "audio"] }, ok);

  // Page-level sniffers — right-click on page background offers bulk grabs.
  chrome.contextMenus.create({ id: CTX_PG_LINKS,  title: "zpwrchrome: download all links on page",  contexts: ["page"] }, ok);
  chrome.contextMenus.create({ id: CTX_PG_IMAGES, title: "zpwrchrome: download all images on page", contexts: ["page"] }, ok);
  chrome.contextMenus.create({ id: CTX_PG_MEDIA,  title: "zpwrchrome: download all media on page",  contexts: ["page"] }, ok);
  chrome.contextMenus.create({ id: CTX_PG_ZCITE,  title: "Save page to zcite (reference)",          contexts: ["page"] }, ok);

  // Toolbar-icon menu (right-click on the extension's action icon).
  //
  // Chrome's ACTION_MENU_TOP_LEVEL_LIMIT is 6 — items 7+ are silently
  // dropped. Layout:
  //   1. Turn off the lights (this tab)        — per-tab quick action
  //   2. Reader mode (this tab)                — per-tab quick action
  //   3. Full-page screenshot (this tab)       — per-tab quick action
  //   4. Manager pages ▸                       — submenu (no cap)
  //   5. Settings ▸                            — submenu (no cap)
  //   6. Help ▸                                — submenu (no cap)
  const act = ["action"];
  const create = (props) => chrome.contextMenus.create(props, ok);

  // === Top level (exactly 6) ====================================
  create({ id: CTX_ACT_LIGHTS, title: "Turn off the lights (this tab)",  contexts: act });
  create({ id: CTX_ACT_READER, title: "Reader mode (this tab)",          contexts: act });
  create({ id: CTX_ACT_SHOT,   title: "Full-page screenshot (this tab)", contexts: act });
  create({ id: CTX_SUB_MGRS,   title: "Manager pages",                   contexts: act });
  create({ id: CTX_SUB_SET,    title: "Settings",                        contexts: act });
  create({ id: CTX_SUB_HELP,   title: "Help",                            contexts: act });

  // === Manager pages submenu ====================================
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_MGR,    title: "Open download manager",   contexts: act });
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_SCR,    title: "Open userscript manager", contexts: act });
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_PASS,   title: "Open pass manager",       contexts: act });
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_FIND,   title: "Find in all tabs",        contexts: act });
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_UA,     title: "User-Agent switcher",     contexts: act });
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_MODHDR, title: "ModHeader (HTTP headers)", contexts: act });
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_THEME,  title: "Cyberpunk page theme",    contexts: act });
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_LIGHTSCFG, title: "Lights-off settings…", contexts: act });
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_READERCFG, title: "Reader-mode settings…", contexts: act });
  create({ parentId: CTX_SUB_MGRS, id: CTX_ACT_DIAG,   title: "Open diagnostics",        contexts: act });

  // === Settings submenu =========================================
  create({ parentId: CTX_SUB_SET, id: CTX_ACT_SET,    title: "General",            contexts: act });
  create({ parentId: CTX_SUB_SET, id: CTX_ACT_IFACE,  title: "Interface",          contexts: act });
  create({ parentId: CTX_SUB_SET, id: CTX_ACT_EXTFLT, title: "Extension Filter",   contexts: act });
  create({ parentId: CTX_SUB_SET, id: CTX_ACT_RULES,  title: "Rule System",        contexts: act });
  create({ parentId: CTX_SUB_SET, id: CTX_ACT_SEP1,   type: "separator",           contexts: act });
  create({ parentId: CTX_SUB_SET, id: CTX_ACT_FOLD,   title: "Change downloads folder…", contexts: act });

  // === Help submenu =============================================
  create({ parentId: CTX_SUB_HELP, id: CTX_ACT_HELP,  title: "Help",                contexts: act });
  create({ parentId: CTX_SUB_HELP, id: CTX_ACT_ABOUT, title: "About zpwrchrome",    contexts: act });
  create({ parentId: CTX_SUB_HELP, id: CTX_ACT_EXTPG, title: "Manage this extension", contexts: act });
  create({ parentId: CTX_SUB_HELP, id: CTX_ACT_SEP2,  type: "separator",            contexts: act });
  create({ parentId: CTX_SUB_HELP, id: CTX_ACT_ISSUE, title: "Report an issue",     contexts: act });
  create({ parentId: CTX_SUB_HELP, id: CTX_ACT_REPO,  title: "View source on GitHub", contexts: act });
});

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Toolbar-icon menu — open the matching extension page in a new tab.
    // Append #downloadDir for the change-folder item so the General settings
    // page can scroll to the field and focus its input.
    const pages = {
      [CTX_ACT_MGR]:    "/scripts-manager/downloads.html",
      [CTX_ACT_SCR]:    "/scripts-manager/manager.html",
      [CTX_ACT_PASS]:   "/scripts-manager/pass.html",
      [CTX_ACT_FIND]:   "/scripts-manager/find-all.html",
      [CTX_ACT_UA]:     "/scripts-manager/ua-switcher.html",
      [CTX_ACT_MODHDR]: "/scripts-manager/modheader.html",
      [CTX_ACT_THEME]:  "/scripts-manager/theme-injector.html",
      [CTX_ACT_LIGHTSCFG]: "/scripts-manager/lights-off.html",
      [CTX_ACT_READERCFG]: "/scripts-manager/reader-mode.html",
      [CTX_ACT_DIAG]:   "/scripts-manager/dl-diag.html",
      [CTX_ACT_SET]:    "/scripts-manager/dl-settings.html",
      [CTX_ACT_IFACE]:  "/scripts-manager/dl-interface.html",
      [CTX_ACT_EXTFLT]: "/scripts-manager/dl-extfilter.html",
      [CTX_ACT_RULES]:  "/scripts-manager/dl-rules.html",
      [CTX_ACT_FOLD]:   "/scripts-manager/dl-settings.html#downloadDir",
      [CTX_ACT_HELP]:   "/scripts-manager/dl-help.html",
      [CTX_ACT_ABOUT]:  "/scripts-manager/dl-about.html",
    };
    if (pages[info.menuItemId]) {
      chrome.tabs.create({ url: chrome.runtime.getURL(pages[info.menuItemId]) });
      return;
    }
    if (info.menuItemId === CTX_ACT_EXTPG) {
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
      return;
    }
    if (info.menuItemId === CTX_ACT_LIGHTS) {
      Promise.resolve()
        .then(() => toggleLightsOffActive())
        .catch((e) => console.error("[zpwrchrome] lights-off:", e));
      return;
    }
    if (info.menuItemId === CTX_ACT_READER) {
      Promise.resolve()
        .then(() => toggleReaderModeActive())
        .catch((e) => console.error("[zpwrchrome] reader-mode:", e));
      return;
    }
    if (info.menuItemId === CTX_ACT_SHOT) {
      // Wrap in .catch so a synchronous throw (e.g. screenshot module
      // failed to import) still surfaces to the SW console.
      Promise.resolve()
        .then(() => doScreenshotFullPage(tab))
        .catch((e) => console.error("[zpwrchrome] screenshot dispatch:", e));
      return;
    }
    if (info.menuItemId === CTX_ACT_ISSUE) { chrome.tabs.create({ url: ISSUE_URL }); return; }
    if (info.menuItemId === CTX_ACT_REPO)  { chrome.tabs.create({ url: REPO_URL });  return; }

    // Save the current page as a reference into zcite.
    if (info.menuItemId === CTX_PG_ZCITE) {
      await savePageToZcite(tab);
      return;
    }

    // Page-level sniffer: enumerate URLs in the current tab, then batch-add.
    if (info.menuItemId === CTX_PG_LINKS  ||
        info.menuItemId === CTX_PG_IMAGES ||
        info.menuItemId === CTX_PG_MEDIA) {
      await runPageSniffer(info.menuItemId);
      return;
    }

    // Link/media → kick off a segmented download via the host.
    const url = info.linkUrl || info.srcUrl;
    if (!url) return;
    try {
      const args = await enrichDownloadArgs(url, { dir: await resolveDownloadDir() });
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
  // Self-heal: if the SW was suspended during a recent tab switch,
  // chrome.tabs.onActivated never fired and the MRU head doesn't reflect
  // the real current tab. Re-push the real current tab so the first
  // non-self entry is genuinely "the previous tab".
  if (active?.id != null) await pushMru(active.id);
  // SW suspension can miss tabs.onRemoved, leaving stale IDs at the head
  // of the MRU. Walk down the list and skip any tab id that no longer
  // resolves; drop them from the persistent MRU as we go so the next
  // shortcut starts clean.
  const mru = await readMru();
  for (const id of mru) {
    if (id === active?.id) continue;
    if (typeof id !== "number") continue;
    try {
      const tab = await chrome.tabs.get(id);
      await chrome.tabs.update(id, { active: true });
      if (tab.windowId !== active?.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return;                                    // success
    } catch {
      await dropFromMru(id);                     // stale → drop and try next
    }
  }
}

async function mruStep(delta) {
  // Same stale-id problem as switchPreviousTab: walk in delta direction
  // skipping any tab id that no longer exists. Drop stale entries as
  // we go so the persistent MRU self-heals.
  const active = await getActive();
  if (active?.id != null) await pushMru(active.id);  // self-heal MRU head
  let mru = await readMru();
  // Cap iterations at the MRU length so a fully-stale list terminates.
  for (let i = 0; i < mru.length; i++) {
    const next = mruStepPure(mru, active?.id, delta);
    if (typeof next !== "number" || next === active?.id) return;
    try {
      const tab = await chrome.tabs.get(next);
      await chrome.tabs.update(next, { active: true });
      if (tab.windowId !== active?.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return;                                    // success
    } catch {
      await dropFromMru(next);                   // stale → drop and try again
      mru = await readMru();                     // refresh local copy
    }
  }
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
// Find-in-all-tabs — harvest innerText from every open http(s) tab, ship
// the texts to the UI, on user-select activate the chosen tab + scroll
// to the first match via the page's own window.find().
//
// Cap per tab at HARVEST_MAX_CHARS to keep the bridge response under
// the SW message-size budget (a few hundred tabs × 1 MB each would
// blow the runtime.sendMessage envelope).

const FIND_HARVEST_MAX_CHARS = 200_000;

async function scanAllTabs() {
  const tabs = await chrome.tabs.query({});
  const httpTabs = tabs.filter((t) => /^https?:/i.test(t.url || ""));
  // Inject in parallel — each scrape is independent, no shared state.
  const out = await Promise.all(httpTabs.map(async (t) => {
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: false },
        func:   harvestInnerText,
        args:   [FIND_HARVEST_MAX_CHARS],
      });
      const text = res?.[0]?.result || "";
      return {
        tabId:     t.id,
        windowId:  t.windowId,
        active:    !!t.active,
        title:     t.title || "",
        url:       t.url   || "",
        favIconUrl: t.favIconUrl || "",
        text,
        bytes:     text.length,
      };
    } catch (e) {
      diagPush("find.scrape.err", { tabId: t.id, err: String(e?.message || e) });
      return null;
    }
  }));
  return out.filter(Boolean);
}

// Page-injected — must be self-contained.
function harvestInnerText(cap) {
  const t = document.body?.innerText || "";
  return t.length > cap ? t.slice(0, cap) : t;
}

async function scrollToMatchInTab(tabId, query) {
  if (!Number.isFinite(tabId) || tabId < 0) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId != null) {
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
    }
    if (query) {
      // window.find() is the cleanest path: it scrolls the page AND
      // highlights the match. Not in the WHATWG spec but supported in
      // every Chromium-family browser the extension runs on.
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        func:   pageFindAndScroll,
        args:   [query],
      });
    }
    return true;
  } catch (e) {
    diagPush("find.scroll.err", { tabId, err: String(e?.message || e) });
    return false;
  }
}

function pageFindAndScroll(query) {
  try {
    // Reset any prior find selection so window.find() starts at top.
    window.getSelection?.()?.removeAllRanges?.();
    const found = window.find(query, /*caseSensitive*/ false, /*backwards*/ false,
                              /*wrapAround*/ true, /*wholeWord*/ false,
                              /*searchInFrames*/ true, /*showDialog*/ false);
    // If window.find succeeded, the selection is already in view; if
    // not, fall back to a simple substring scroll on body text.
    if (!found) {
      const body = document.body;
      if (body && body.textContent && body.textContent.toLowerCase().includes(query.toLowerCase())) {
        body.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Wappalyzer-compatible technology detection.
//
// On every main_frame navigation we:
//   1. webRequest.onCompleted   → capture response headers per tabId
//   2. webNavigation.onCompleted → inject scrapeSignals into the page,
//      merge with the cached headers, run wappDetect, cache the result,
//      update the toolbar badge with the match count.
//   3. popup pulls the cached result via the `tech.detected` bridge.
//
// Cache is per-tabId in module scope (fine for the SW since we don't
// persist across SW restarts — page reload re-runs detection). Clears
// on tabs.onRemoved.

// Lazy-loaded corpus. The fetch + JSON.parse runs on first import of
// this module (SW startup) and the awaiter `wappReady` gates every
// consumer. Pre-compute the deduped JS-global key list + dom-rule list
// so the page-side scrapeSignals only does work for selectors the corpus
// actually cares about (~600 KB of arg payload otherwise).
let WAPP_TECHNOLOGIES = {};
let WAPP_CATEGORIES   = {};
let WAPP_COMPILED     = [];
let WAPP_JS_LOOKUPS   = [];
let WAPP_DOM_RULES    = [];
const wappReady = (async () => {
  try {
    const [tech, cats] = await Promise.all([
      fetch(chrome.runtime.getURL("lib/wappalyzer/data/technologies.json")).then((r) => r.json()),
      fetch(chrome.runtime.getURL("lib/wappalyzer/data/categories.json")).then((r) => r.json()),
    ]);
    WAPP_TECHNOLOGIES = tech;
    WAPP_CATEGORIES   = cats;
    WAPP_COMPILED     = compileFingerprints(tech);
    const jsSet = new Set();
    for (const t of Object.values(tech)) {
      if (t.js && typeof t.js === "object") {
        for (const k of Object.keys(t.js)) jsSet.add(k);
      }
    }
    WAPP_JS_LOOKUPS = [...jsSet];
    const seen = new Set();
    for (const rec of WAPP_COMPILED) {
      for (const rule of rec.dom) {
        const key = `${rule.selector}|${rule.kind}|${rule.attr || rule.prop || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        WAPP_DOM_RULES.push({ selector: rule.selector, kind: rule.kind, attr: rule.attr, prop: rule.prop });
      }
    }
    diagPush("tech.corpus.loaded", { techs: WAPP_COMPILED.length, jsKeys: WAPP_JS_LOOKUPS.length, domRules: WAPP_DOM_RULES.length });
  } catch (e) {
    diagPush("tech.corpus.err", { err: String(e?.message || e) });
    console.warn("[zpwrchrome] wappalyzer corpus load:", e?.message || e);
  }
})();

const techHeadersByTab = new Map();   // tabId → { name: value } (last response)
const techResultsByTab = new Map();   // tabId → [{ name, cats, confidence, version, … }]

function recordResponseHeaders(tabId, headers) {
  if (typeof tabId !== "number" || tabId < 0) return;
  const bag = {};
  for (const h of (headers || [])) {
    if (!h?.name) continue;
    bag[String(h.name).toLowerCase()] = String(h.value || "");
  }
  techHeadersByTab.set(tabId, bag);
}

if (chrome.webRequest?.onCompleted) {
  chrome.webRequest.onCompleted.addListener(
    (info) => {
      if (info.type !== "main_frame") return;
      recordResponseHeaders(info.tabId, info.responseHeaders);
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"],
  );
}

async function runTechDetection(tabId) {
  if (typeof tabId !== "number" || tabId < 0) return null;
  await wappReady;          // wait for the corpus to load on first request
  if (!WAPP_COMPILED.length) return null;
  let pageSignals;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func:   scrapeSignals,
      args:   [WAPP_JS_LOOKUPS, WAPP_DOM_RULES],
    });
    pageSignals = results?.[0]?.result || null;
  } catch (e) {
    diagPush("tech.scrape.err", { tabId, err: String(e?.message || e) });
    return null;
  }
  if (!pageSignals) return null;
  const headers = techHeadersByTab.get(tabId) || {};
  const signals = { ...pageSignals, headers };
  const hits = wappDetect(signals, WAPP_COMPILED);
  techResultsByTab.set(tabId, hits);
  try {
    // Badge updates flow through the multiplexer (applyMultiplexedBadge)
    // so a tab with both tech matches AND pass matches shows as e.g.
    // "10*" rather than fighting between a per-tab tech write and the
    // global multiplex. Refresh fires here once the count is cached.
    refreshActiveTabBadge().catch(() => {});
  } catch {}
  diagPush("tech.detected", { tabId, count: hits.length });
  return hits;
}

if (chrome.webNavigation?.onCompleted) {
  chrome.webNavigation.onCompleted.addListener(
    (details) => {
      if (details.frameId !== 0) return;
      // Delay a tick so scrapeSignals sees populated DOM + jsGlobals.
      setTimeout(() => { runTechDetection(details.tabId).catch(() => {}); }, 250);
    },
    { url: [{ schemes: ["http", "https"] }] },
  );
}

chrome.tabs?.onRemoved?.addListener((tabId) => {
  techHeadersByTab.delete(tabId);
  techResultsByTab.delete(tabId);
});

// ---------------------------------------------------------------------------
// Userscripts (Tampermonkey-style)

const SCRIPTS_KEY = "userscripts";
const GM_PREFIX = "gm:";  // chrome.storage.local key prefix for per-script GM values
const FIRE_LOG_KEY = "userScripts.fireLog";
const FIRE_LOG_CAP = 200;

// Serial append chain — userscripts fire concurrently on SPA navigations
// with multiple @match patterns, so a naive get→mutate→set lets the second
// writer clobber the first's entry. Each call chains onto the prior tail
// so the read/write window is never interleaved.
let _fireLogChain = Promise.resolve();
async function appendFireLog(entry) {
  const next = _fireLogChain.then(async () => {
    const bag = await chrome.storage.local.get(FIRE_LOG_KEY);
    const log = Array.isArray(bag[FIRE_LOG_KEY]) ? bag[FIRE_LOG_KEY] : [];
    const final = { when: Date.now(), ...entry };
    log.unshift(final);
    if (log.length > FIRE_LOG_CAP) log.length = FIRE_LOG_CAP;
    await chrome.storage.local.set({ [FIRE_LOG_KEY]: log });
    console.info("[zpwrchrome] fire logged:", final.mode, final.name || final.script, "→", final.url);
  });
  _fireLogChain = next.catch(() => {});
  return next;
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

// Three listeners can fire syncUserScripts concurrently (onInstalled,
// onStartup, and the bare boot call below). If their unregister() +
// register() pairs interleave, chrome.userScripts.register sees the same
// id twice and rejects the whole batch with "Duplicate script ID". A
// single-flight collapse fixes the duplicate-id race but creates a fresh
// one: writeScripts(vA) stores vA then awaits a sync; if writeScripts(vB)
// stores vB while vA's sync is in flight, it joins vA's promise and never
// triggers a register pass against vB. Serial chaining gives every caller
// its own readScripts() snapshot taken AFTER prior passes settle.
let _syncChainTail = Promise.resolve();
async function syncUserScripts() {
  const next = _syncChainTail.then(_doSyncUserScripts);
  _syncChainTail = next.catch(() => {});
  return next;
}
async function _doSyncUserScripts() {
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
  // Track which registration IDs we've already assigned in THIS sync pass.
  // Two stored scripts sharing @name+@namespace would otherwise collide on
  // userscriptId(meta) and chrome.userScripts.register would reject the
  // whole batch with "Duplicate script ID". Save-time isNew check already
  // rejects new dupes — but legacy storage, imports, or hand-edits can
  // still leave dupes in place. Disambiguate at register time so load
  // never errors, even if the dupes exist.
  const usedIds = new Set();
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
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

    let id = userscriptId(meta);
    if (usedIds.has(id)) {
      // Collision with an earlier registration this pass. Append a stable
      // suffix derived from the array index so the load is deterministic.
      // (We keep using the meta-derived prefix so the live id is still
      // recognizable in logs / chrome.userScripts.getScripts output.)
      let suffix = 2;
      let candidate = `${id}__${suffix}`;
      while (usedIds.has(candidate)) candidate = `${id}__${++suffix}`;
      console.warn("[zpwrchrome] duplicate userscript id at load:", id, "→ remapped to", candidate, "(storage id:", s.id, ")");
      id = candidate;
    }
    usedIds.add(id);
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
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ ok: false, error: "invalid tabId" });
      return true;
    }
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

  // --- UA switcher ---
  if (msg?.kind === "ua.get") {
    (async () => {
      const state = await getUaState();
      sendResponse({ ok: true, state, presets: UA_PRESETS, groups: presetGroups(), resolved: resolveUA(state) });
    })();
    return true;
  }
  if (msg?.kind === "ua.set") {
    setUaState(msg.patch || {})
      .then((state) => sendResponse({ ok: true, state, resolved: resolveUA(state) }))
      .catch((e)    => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "ua.clear") {
    setUaState({ enabled: false })
      .then((state) => sendResponse({ ok: true, state }))
      .catch((e)    => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }

  // --- ModHeader ---
  if (msg?.kind === "modheader.get") {
    (async () => {
      const state = await getModheaderState();
      sendResponse({ ok: true, state, dnr: modheaderBuildDnrRules(state) });
    })();
    return true;
  }
  if (msg?.kind === "modheader.set") {
    (async () => {
      try {
        const cur = await getModheaderState();
        const next = { ...cur, ...(msg.patch || {}) };
        await setModheaderState(next);
        sendResponse({ ok: true, state: next });
      } catch (e) { sendResponse({ ok: false, err: String(e?.message || e) }); }
    })();
    return true;
  }
  if (msg?.kind === "modheader.profile.add") {
    (async () => {
      try {
        const cur = await getModheaderState();
        const id = "p_" + Math.random().toString(36).slice(2, 10);
        const profile = {
          id,
          name: String(msg.name || "New profile").slice(0, 80),
          color: String(msg.color || "#05d9e8").slice(0, 16),
          rules: [],
        };
        const next = { ...cur, profiles: [...cur.profiles, profile], activeProfileId: id };
        await setModheaderState(next);
        sendResponse({ ok: true, state: next, profile });
      } catch (e) { sendResponse({ ok: false, err: String(e?.message || e) }); }
    })();
    return true;
  }
  if (msg?.kind === "modheader.profile.delete") {
    (async () => {
      try {
        const cur = await getModheaderState();
        const profiles = cur.profiles.filter((p) => p.id !== msg.id);
        if (!profiles.length) profiles.push(defaultModheaderState().profiles[0]);
        const activeProfileId = cur.activeProfileId === msg.id ? profiles[0].id : cur.activeProfileId;
        const next = { ...cur, profiles, activeProfileId };
        await setModheaderState(next);
        sendResponse({ ok: true, state: next });
      } catch (e) { sendResponse({ ok: false, err: String(e?.message || e) }); }
    })();
    return true;
  }
  if (msg?.kind === "modheader.profile.update") {
    (async () => {
      try {
        const cur = await getModheaderState();
        const profiles = cur.profiles.map((p) => p.id === msg.id ? { ...p, ...(msg.patch || {}) } : p);
        const next = { ...cur, profiles };
        await setModheaderState(next);
        sendResponse({ ok: true, state: next });
      } catch (e) { sendResponse({ ok: false, err: String(e?.message || e) }); }
    })();
    return true;
  }
  if (msg?.kind === "modheader.rule.add") {
    (async () => {
      try {
        const cur = await getModheaderState();
        const id = "r_" + Math.random().toString(36).slice(2, 10);
        const rule = {
          id, enabled: true,
          kind: msg.rule?.kind === "response" || msg.rule?.kind === "redirect" ? msg.rule.kind : "request",
          name: String(msg.rule?.name || ""),
          value: String(msg.rule?.value || ""),
          operation: msg.rule?.operation === "append" || msg.rule?.operation === "remove" ? msg.rule.operation : "set",
          urlFilter: String(msg.rule?.urlFilter || ""),
          resourceTypes: Array.isArray(msg.rule?.resourceTypes) ? msg.rule.resourceTypes : [],
        };
        const profiles = cur.profiles.map((p) =>
          p.id === msg.profileId ? { ...p, rules: [...p.rules, rule] } : p
        );
        const next = { ...cur, profiles };
        await setModheaderState(next);
        sendResponse({ ok: true, state: next, rule });
      } catch (e) { sendResponse({ ok: false, err: String(e?.message || e) }); }
    })();
    return true;
  }
  if (msg?.kind === "modheader.rule.update") {
    (async () => {
      try {
        const cur = await getModheaderState();
        const profiles = cur.profiles.map((p) => {
          if (p.id !== msg.profileId) return p;
          const rules = p.rules.map((r) => r.id === msg.ruleId ? { ...r, ...(msg.patch || {}) } : r);
          return { ...p, rules };
        });
        const next = { ...cur, profiles };
        await setModheaderState(next);
        sendResponse({ ok: true, state: next });
      } catch (e) { sendResponse({ ok: false, err: String(e?.message || e) }); }
    })();
    return true;
  }
  if (msg?.kind === "modheader.rule.delete") {
    (async () => {
      try {
        const cur = await getModheaderState();
        const profiles = cur.profiles.map((p) =>
          p.id === msg.profileId ? { ...p, rules: p.rules.filter((r) => r.id !== msg.ruleId) } : p
        );
        const next = { ...cur, profiles };
        await setModheaderState(next);
        sendResponse({ ok: true, state: next });
      } catch (e) { sendResponse({ ok: false, err: String(e?.message || e) }); }
    })();
    return true;
  }

  // --- Find-in-all-tabs ---
  if (msg?.kind === "find.scanAllTabs") {
    scanAllTabs()
      .then((tabs) => sendResponse({ ok: true, tabs }))
      .catch((e)   => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "find.scrollToMatch") {
    scrollToMatchInTab(Number(msg.tabId), String(msg.query || ""))
      .then((ok) => sendResponse({ ok: !!ok }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }

  // --- Tech detection (Wappalyzer-compatible) ---
  if (msg?.kind === "tech.detected") {
    const tabId = Number(msg.tabId);
    (async () => {
      await wappReady;
      const cached = techResultsByTab.get(tabId);
      if (cached) {
        sendResponse({ ok: true, tabId, hits: cached, categories: WAPP_CATEGORIES });
        return;
      }
      const hits = await runTechDetection(tabId);
      sendResponse({ ok: true, tabId, hits: hits || [], categories: WAPP_CATEGORIES });
    })();
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
    passOtpCodeForPath(String(msg.path || ""))
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
  if (msg?.kind === "pass.copyField") {
    // SW-side fetch + copy so the clipboard write hits writeClipboard()
    // (which injects into the active tab) — the popup's own
    // navigator.clipboard.writeText() loses its user-gesture window
    // across the SW + NM + GPG round-trip and silently no-ops.
    passCopyFieldForPath(String(msg.path || ""), String(msg.field || ""))
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.save") {
    bpSaveEntry(String(msg.path || ""), String(msg.contents || ""))
      .then(()  => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.delete") {
    bpDeleteEntry(String(msg.path || ""))
      .then(()  => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "pass.openManager") {
    openPassManager().then(() => sendResponse({ ok: true }));
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
  if (msg?.kind === "dl.restart") {
    // Re-download from byte zero: discard the partial/old file and respawn a
    // fresh worker. Distinct from dl.resume (which continues from where it
    // left off). Used to recover a job stamped done on a truncated file.
    bpDlGid("dl.restart", Number(msg.gid))
      .then((resp) => { bpDlBroadcast(); sendResponse({ ok: true, ...(resp.data || {}) }); })
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.remove") {
    bpDlGid("dl.remove", Number(msg.gid))
      .then((resp) => { bpDlBroadcast(); sendResponse({ ok: true, ...(resp.data || {}) }); })
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.openDir") {
    // path: optional — empty = open the default download dir on the host.
    // The host puts the path in the request's `url` field (re-using the
    // existing DlRequest shape — see DlRequest comment in dl.rs).
    bpSend({ action: "dl.openDir", dir: String(msg.path || "") })
      .then((resp) => sendResponse({ ok: true, opened: resp.data?.opened || null }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.openFile") {
    bpSend({ action: "dl.openFile", dir: String(msg.path || "") })
      .then((resp) => sendResponse({ ok: true, opened: resp.data?.opened || null }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e), code: e?.code }));
    return true;
  }
  if (msg?.kind === "dl.writeFile") {
    bpSend({
      action: "dl.writeFile",
      dir:    String(msg.dir    || ""),
      name:   String(msg.name   || ""),
      base64: String(msg.base64 || ""),
    })
      .then((resp) => sendResponse({ ok: true, dest: resp.data?.dest, bytes: resp.data?.bytes }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e), code: e?.code }));
    return true;
  }
  if (msg?.kind === "dl.clear") {
    // scope: done | failed | missing | all; deleteFromDisk: bool
    bpSend({ action: "dl.clear", scope: String(msg.scope || "done"), deleteFromDisk: !!msg.deleteFromDisk })
      .then((resp) => { bpDlBroadcast(); sendResponse({ ok: true, ...(resp.data || {}) }); })
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e) }));
    return true;
  }
  if (msg?.kind === "dl.settings.get") {
    loadDlSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }
  if (msg?.kind === "dl.settings.changed") {
    applyDownloadsUiVisibility();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.kind === "diag.read") {
    diagRead().then((entries) => sendResponse({ ok: true, entries }));
    return true;
  }
  if (msg?.kind === "diag.clear") {
    diagClear().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.kind === "diag.ping") {
    // Liveness probe + round-trip diag pop. Useful from the diagnostics page.
    diagPush("diag.ping", { from: msg.from || "(unknown)" });
    bpSend({ action: "echo", echoResponse: { ping: "diag" } })
      .then((resp) => sendResponse({ ok: true, alive: true, echo: resp }))
      .catch((e) => sendResponse({ ok: false, err: String(e?.message || e), code: e?.code }));
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
// Native messaging — BP (zpwrchrome-host) protocol over chrome.runtime
//                    .sendNativeMessage (one-shot per request).
//
// Wire shape (every action shares this envelope):
//   request:  { action, settings: { stores: { storeId: {id,name,path} } }, ...args }
//   response: { status: "ok"|"error", version, data?, code?, params? }
//
// The host (zpwrchrome-host) speaks PROTOCOL.md v3.1.2 plus three
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
  const t0 = performance.now();
  const action = req?.action || "(no action)";
  // Don't log password contents or huge payloads — just keys.
  const reqSummary = { action, keys: Object.keys(req || {}) };
  diagPush("bp.send", reqSummary);
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, req, (resp) => {
        const dt = Math.round(performance.now() - t0);
        const last = chrome.runtime.lastError;
        if (last) {
          diagPush("bp.send.transport_err", { action, ms: dt, err: String(last.message || last) });
          reject(new Error(last.message));
          return;
        }
        if (!resp || typeof resp !== "object") {
          diagPush("bp.send.empty", { action, ms: dt });
          reject(new Error("native host: empty response"));
          return;
        }
        if (resp.status === "error") {
          const msg = resp.params?.message || `error code ${resp.code}`;
          diagPush("bp.send.host_err", { action, ms: dt, code: resp.code, msg, params: resp.params });
          const e = new Error(msg);
          e.code = resp.code;
          e.params = resp.params;
          reject(e);
          return;
        }
        diagPush("bp.send.ok", { action, ms: dt, dataKeys: resp.data ? Object.keys(resp.data) : [] });
        resolve(resp);
      });
    } catch (e) {
      diagPush("bp.send.throw", { action, err: String(e?.message || e) });
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
  let parsed = fallbackUsernameFromPath(parseEntry(raw), path);
  parsed = fallbackUrlFromPath(parsed, path);
  parsed.raw = raw;
  return parsed;
}

// BP `save` — write encrypted contents back to <path>.gpg. Caller passes
// the already-formatted multi-line text (see lib/pass-entry.js).
async function bpSaveEntry(path, contents) {
  const file = path.endsWith(".gpg") ? path : `${path}.gpg`;
  return bpSend({
    action: "save",
    storeId: "default",
    file,
    contents,
    settings: { stores: bpStores() },
  });
}

// BP `delete` — remove <path>.gpg and prune empty parent dirs.
async function bpDeleteEntry(path) {
  const file = path.endsWith(".gpg") ? path : `${path}.gpg`;
  return bpSend({
    action: "delete",
    storeId: "default",
    file,
    settings: { stores: bpStores() },
  });
}

// `otp` extension action — host shells `pass otp` and returns the code.
// PATH-issue note: Chrome doesn't pass the user's shell PATH to the
// native messaging host, so `pass` typically isn't found
// (/opt/homebrew/bin/pass on macOS, /usr/local/bin/pass elsewhere).
// passOtpCodeForPath() below is the new entry point that computes TOTP
// client-side from the entry's otpauth:// URL via Web Crypto and only
// falls back to this `pass otp` shell-out when the entry has no URL.
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

// passOtpCodeForPath(path) — TOTP / HOTP from the entry's otpauth://
// URL (decoded from the GPG fetch result). No shell-out, no pass-otp
// extension dependency, no PATH dependency. Falls back to `pass otp`
// only when the entry has no otpauth URL at all (still useful for
// users who rely on pass-otp's own state files for HOTP counters).
async function passOtpCodeForPath(path) {
  let entry;
  try {
    entry = await bpFetchParsed(path);
  } catch (e) {
    throw new Error(`fetch failed: ${e?.message || e}`);
  }
  const url = String(entry.otpUrl || "").trim();
  if (url) {
    try {
      return await computeOtpFromUrl(url);
    } catch (e) {
      throw new Error(`compute totp: ${e?.message || e}`);
    }
  }
  // No client-computable otpauth URL — last-resort fall back to the
  // host's `pass otp` action. This will fail with `Unable to spawn pass
  // otp` on a typical Chrome-spawned host (no PATH), but the error is
  // surfaced rather than silently returning empty so the user knows
  // their entry doesn't have an otpauth:// URL in it.
  return bpOtpCode(path);
}

// dl.* extension actions — one round-trip each.
async function bpDlAdd(args) {
  // Batch pattern fan-out: if args.url contains bracket ranges
  // ([01:99], [a:f], [0:20:5]), expand into individual dl.add calls and
  // return a summary aligned with what the caller expects from a single add.
  const urls = expandBatchSafe(args.url);
  if (urls.length <= 1) return bpSend({ action: "dl.add", ...args });

  diagPush("dl.add.batch.start", { url: args.url, count: urls.length });
  const results = await Promise.allSettled(urls.map((u) => bpSend({ action: "dl.add", ...args, url: u })));
  const ok    = results.filter((r) => r.status === "fulfilled");
  const fail  = results.filter((r) => r.status === "rejected");
  diagPush("dl.add.batch.done", { url: args.url, ok: ok.length, fail: fail.length });
  if (ok.length === 0) {
    const first = fail[0]?.reason;
    throw new Error(`batch add: all ${urls.length} URLs failed (${first?.message || "unknown"})`);
  }
  return {
    status: "ok",
    version: 3001002,
    data: {
      batch: true,
      requested: urls.length,
      enqueued: ok.length,
      failed: fail.length,
      gids: ok.map((r) => r.value?.data?.gid).filter(Boolean),
      firstDest: ok[0].value?.data?.dest,
    },
  };
}
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
    await applyToolbarBadge(jobs);
    await notifyJobTransitions(jobs);
    // NM is one-shot — the worker can't notify us when it finishes/fails.
    // If anything is still in flight, re-poll soon so the badge + completion
    // notifications self-correct as states transition; stop polling when no
    // job remains active, which clears the badge naturally.
    const stillInFlight = jobs.some((j) => j.status === "active" || j.status === "pending");
    if (stillInFlight) scheduleBgPoll(1500);
    else               cancelBgPoll();
  } catch (e) {
    // worker process not registered → silently skip
  }
}

// SW-level polling. chrome.alarms (not setTimeout) — MV3 suspends the SW
// after ~30s idle, which would silently destroy a setTimeout-driven poll
// loop. Alarms wake the SW from suspension and survive across the session.
// `periodInMinutes: 0.5` (~30s) is the floor that unpacked / MV3 alarms
// reliably fire at; tighter cadence is OK in dev but throttled in prod.
const DL_POLL_ALARM = "zpwr.dl.poll";
function scheduleBgPoll(ms) {
  // ms is advisory — alarms have a 30s minimum in production, so we round
  // up. The first fire still happens via `when:` so the immediate transition
  // (e.g. just-added job) gets a near-term poll.
  const whenMs  = Math.max(250, ms | 0);
  const periodM = 0.5;
  chrome.alarms.create(DL_POLL_ALARM, { when: Date.now() + whenMs, periodInMinutes: periodM });
}
function cancelBgPoll() {
  chrome.alarms.clear(DL_POLL_ALARM).catch(() => {});
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === DL_POLL_ALARM) bpDlBroadcast();
});

// Toolbar badge. Three counters share the single Chrome badge:
//   1. Active downloads (cyan #05d9e8) — wins on number when ≥ 1 in flight.
//   2. Tech detected on active tab (orange #ff8c1a) — wins on number
//      when no downloads but tech present.
//   3. Matching pass entries for active tab (magenta #d300c5) — wins
//      alone, otherwise modifies the dominant cell with `*`.
// Composite: a trailing `*` means "one of the other two also matches".
// Tooltip always lists the full breakdown. Per-domain toggles:
// dl.interface.badgeShowCount + dl.settings.passShowMatchBadge (tech is
// always shown — it's information-only, no opt-out).
let _dlActiveCount  = 0;
let _passMatchCount = 0;
let _techMatchCount = 0;   // mirrors techResultsByTab.get(activeTabId).length
async function applyMultiplexedBadge() {
  try {
    const ifc = await loadDlInterface();
    const dls = await loadDlSettings();
    const showDl   = !!ifc.badgeShowCount;
    const showPass = dls.passShowMatchBadge !== false;   // default ON
    const dl   = showDl   ? _dlActiveCount  : 0;
    const pass = showPass ? _passMatchCount : 0;
    const tech = _techMatchCount;

    let text  = "";
    let color = "#05d9e8";   // cyan default
    let title = "zpwrchrome";

    // Priority for the visible NUMBER: downloads (most actionable) →
    // tech (info about the current tab) → pass (a click away). Trailing
    // letter tags spell out which OTHER counters are also non-zero:
    //   t = tech also detected
    //   l = login (pass) match also present
    // So a tab with 10 downloads + 5 tech + 2 pass shows "10tl"; a tab
    // with 5 tech + 2 pass shows "5l"; a tab with just 2 pass shows "2".
    const tag = (cond, ch) => cond ? ch : "";
    if (dl > 0) {
      text  = String(dl) + tag(tech > 0, "t") + tag(pass > 0, "l");
      color = "#05d9e8";
    } else if (tech > 0) {
      text  = String(tech) + tag(pass > 0, "l");
      color = "#ff8c1a";
    } else if (pass > 0) {
      text  = String(pass);
      color = "#d300c5";
    }
    // Title — always describe every non-zero counter so hovering reveals
    // exactly what `10*` is composed of.
    const parts = [];
    if (dl)   parts.push(`${dl} active download${dl   === 1 ? "" : "s"}`);
    if (tech) parts.push(`${tech} technolog${tech === 1 ? "y" : "ies"} detected`);
    if (pass) parts.push(`${pass} pass match${pass === 1 ? "" : "es"} (hit your fill shortcut)`);
    if (parts.length) title = `zpwrchrome — ${parts.join(" · ")}`;

    await chrome.action?.setBadgeBackgroundColor?.({ color });
    await chrome.action?.setBadgeText?.({ text });
    await chrome.action?.setTitle?.({ title });
  } catch {}
}

// Refresh both pass-match count + tech-match count for whatever tab is
// currently active and repaint the badge. Single source of truth that
// handles tech, pass, and downloads in one pass.
async function refreshActiveTabBadge() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;
    _techMatchCount = (typeof tabId === "number") ? (techResultsByTab.get(tabId)?.length || 0) : 0;
  } catch { _techMatchCount = 0; }
  // refreshPassMatchBadge re-paints, so we don't need a separate call.
  await refreshPassMatchBadge();
}

async function applyToolbarBadge(jobs) {
  _dlActiveCount = (jobs || []).filter((j) => j.status === "active" || j.status === "pending").length;
  await applyMultiplexedBadge();
}

// Recompute the pass-match count for whatever tab is currently active and
// repaint the badge. Called on tab switch + URL change + once on startup.
async function refreshPassMatchBadge() {
  try {
    const dls = await loadDlSettings();
    if (dls.passShowMatchBadge === false) {
      _passMatchCount = 0;
      await applyMultiplexedBadge();
      return;
    }
    const t = await getActive();
    const h = hostnameOf(t?.url || "");
    if (!h) { _passMatchCount = 0; await applyMultiplexedBadge(); return; }
    try {
      const matches = await bpMatchByHost(h);
      _passMatchCount = Array.isArray(matches) ? matches.length : 0;
      diagPush("pass.badge", { host: h, count: _passMatchCount });
    } catch (e) {
      _passMatchCount = 0;
      diagPush("pass.badge.err", { host: h, err: String(e?.message || e), code: e?.code });
    }
    await applyMultiplexedBadge();
  } catch {}
}

chrome.tabs?.onActivated?.addListener?.(() => { refreshActiveTabBadge(); });
chrome.tabs?.onUpdated?.addListener?.((tabId, change) => {
  if (change?.url || change?.status === "complete") refreshActiveTabBadge();
});
chrome.runtime.onInstalled.addListener(() => { refreshPassMatchBadge(); });
chrome.runtime.onStartup.addListener(()   => { refreshPassMatchBadge(); });
// Also recompute when settings change so flipping passShowMatchBadge
// or hideBuiltInUI takes effect without a tab switch.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === "dl.settings.changed" || msg?.kind === "dl.interface.changed") {
    refreshPassMatchBadge();
    // Do NOT sendResponse here — the existing handlers below already do.
  }
  return false;
});

// Last-seen-status cache for completion / error notifications.
// Persisted to chrome.storage.session so it survives MV3 SW suspension —
// without persistence, a download that completes while the SW is asleep
// would arrive at the next poll with prev=undefined, the `prev &&` guard
// would short-circuit, and runPostDownloadCommand + the completion
// notification would silently never fire.
const DL_LAST_STATUS_KEY = "dl.lastStatus";
async function loadDlLastStatus() {
  try {
    const bag = await chrome.storage.session.get(DL_LAST_STATUS_KEY);
    const obj = bag[DL_LAST_STATUS_KEY];
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}
async function saveDlLastStatus(map) {
  try { await chrome.storage.session.set({ [DL_LAST_STATUS_KEY]: map }); } catch {}
}
async function notifyJobTransitions(jobs) {
  const ifc = await loadDlInterface();
  const prevMap = await loadDlLastStatus();
  for (const j of jobs) {
    const prev = prevMap[j.gid];
    if (prev === j.status) continue;
    if (j.status === "done" && prev && prev !== "done") {
      if (ifc.notifyOnComplete) {
        chrome.notifications?.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: "zpwrchrome — download complete",
          message: (j.dest || "").split(/[\\/]/).pop() || `gid ${j.gid}`,
        });
      }
      // Independent of the completion notification: run any matching
      // post-download command. Errors surface as a notification but never
      // throw out of the transition pass.
      runPostDownloadCommand(j).catch((e) =>
        diagPush("dl.postcmd.unexpected", { gid: j.gid, err: String(e?.message || e) }));
    } else if (ifc.notifyOnError && j.status === "failed" && prev && prev !== "failed") {
      chrome.notifications?.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "zpwrchrome — download failed",
        message: j.err || `gid ${j.gid}`,
      });
    }
  }
  const next = {};
  for (const j of jobs) next[j.gid] = j.status;
  await saveDlLastStatus(next);
}

// ─── Post-download custom commands ────────────────────────────────────
// Per-rule argv-style commands fired on download completion. Rules are
// stored under `chrome.storage.local["dl.postCommands"]`; matching is
// first-rule-wins on the destination basename. If the matched rule has
// `confirm: true` a Chrome notification asks Run / Skip — the pending
// argv survives SW suspends via chrome.storage.session keyed by the
// notification ID. No shell is invoked anywhere on this path: the host's
// `run.spawn` accepts an argv array and passes it straight to
// `std::process::Command::new(argv[0]).args(argv[1..])`.

const DL_POSTCMD_PENDING_PREFIX = "dl.postcmd.pending.";

async function runPostDownloadCommand(job) {
  const dest = job?.dest || "";
  if (!dest) return;
  const { [DL_POSTCMD_KEY]: state } = await chrome.storage.local.get(DL_POSTCMD_KEY);
  const rules = Array.isArray(state?.rules) ? state.rules : [];
  const rule = pickPostCmdRule(rules, dest);
  if (!rule) return;
  const { argv, displayCommand } = buildPostCmdSpawn(rule, dest);
  if (!argv.length) {
    diagPush("dl.postcmd.skip_empty", { gid: job.gid, ruleId: rule.id, name: rule.name });
    return;
  }
  diagPush("dl.postcmd.match", {
    gid: job.gid, ruleId: rule.id, name: rule.name, confirm: !!rule.confirm,
    argv0: argv[0], argc: argv.length,
  });
  if (rule.confirm) {
    await stagePostCmdConfirm(job, rule, argv, displayCommand);
  } else {
    await spawnPostCmd(job, rule, argv, displayCommand);
  }
}

async function stagePostCmdConfirm(job, rule, argv, displayCommand) {
  if (!chrome.notifications) {
    // No notification API — fall back to running silently.
    await spawnPostCmd(job, rule, argv, displayCommand);
    return;
  }
  const notifId = `${DL_POSTCMD_PENDING_PREFIX}${job.gid}.${Date.now()}`;
  await chrome.storage.session.set({
    [notifId]: { gid: job.gid, ruleId: rule.id, ruleName: rule.name || "", argv, displayCommand, dest: job.dest },
  });
  chrome.notifications.create(notifId, {
    type:     "basic",
    iconUrl:  chrome.runtime.getURL("icons/icon128.png"),
    title:    `zpwrchrome — run ${rule.name || "post-download command"}?`,
    message:  displayCommand.length > 200 ? displayCommand.slice(0, 200) + "…" : displayCommand,
    buttons:  [{ title: "Run" }, { title: "Skip" }],
    requireInteraction: true,
  });
}

async function spawnPostCmd(job, rule, argv, displayCommand) {
  try {
    const resp = await bpSend({ action: "run.spawn", argv });
    const d = resp?.data || {};
    diagPush("dl.postcmd.ok", {
      gid: job.gid, ruleId: rule.id, code: d.code, ms: d.durationMs,
      truncated: !!d.truncated, stderrLen: (d.stderr || "").length,
    });
    if (chrome.notifications) {
      const ok = d.code === 0;
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: ok
          ? `zpwrchrome — ${rule.name || "post-download command"} done`
          : `zpwrchrome — ${rule.name || "post-download command"} exited ${d.code}`,
        message: ok
          ? (displayCommand.length > 200 ? displayCommand.slice(0, 200) + "…" : displayCommand)
          : ((d.stderr || displayCommand).split("\n").slice(0, 3).join("\n").slice(0, 300)),
      });
    }
  } catch (e) {
    diagPush("dl.postcmd.err", {
      gid: job.gid, ruleId: rule.id, err: String(e?.message || e),
    });
    chrome.notifications?.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: `zpwrchrome — ${rule.name || "post-download command"} failed`,
      message: String(e?.message || e),
    });
  }
}

if (chrome.notifications?.onButtonClicked) {
  chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
    if (!notifId.startsWith(DL_POSTCMD_PENDING_PREFIX)) return;
    const { [notifId]: pending } = await chrome.storage.session.get(notifId);
    await chrome.storage.session.remove(notifId);
    chrome.notifications.clear(notifId);
    if (!pending) return;
    if (btnIdx === 0) {
      await spawnPostCmd(
        { gid: pending.gid, dest: pending.dest },
        { id: pending.ruleId, name: pending.ruleName, confirm: true },
        pending.argv, pending.displayCommand,
      );
    } else {
      diagPush("dl.postcmd.skip", { gid: pending.gid, ruleId: pending.ruleId });
    }
  });
}
if (chrome.notifications?.onClosed) {
  chrome.notifications.onClosed.addListener(async (notifId) => {
    if (!notifId.startsWith(DL_POSTCMD_PENDING_PREFIX)) return;
    await chrome.storage.session.remove(notifId);
  });
}

/* ---------------------------------------------------------------------------
 * Colorscheme sync with the global zwire HUD.
 * hud-internal owns the scheme (native file <app-data>/zwire/hud-scheme drives the
 * compiled color mixer). We mirror it into our own chrome.storage.local
 * "ui.scheme", which lib/ui-scheme.js already fans out to every zpwrchrome
 * page. A scheme picked in our own theme injector is pushed back to the HUD.
 * Separate extensions can't share storage, so this rides runtime messaging.
 * ------------------------------------------------------------------------- */
(() => {
  const HUD_ID = "omcgnnjfmbmpdlofklbpddkhnfibfhgg";
  const UI_SCHEME_KEY = "ui.scheme";
  let fromHud = null;   // last scheme we applied because the HUD told us to

  function applyFromHud(scheme) {
    if (!scheme) return;
    fromHud = scheme;                       // so our storage listener won't echo it back
    try { chrome.storage.local.set({ [UI_SCHEME_KEY]: scheme }); } catch (e) {}
  }

  // Pull the current HUD scheme on worker start.
  try {
    chrome.runtime.sendMessage(HUD_ID, { type: "zb-scheme-get" }, (r) => {
      void chrome.runtime.lastError;
      if (r && r.scheme) applyFromHud(r.scheme);
    });
  } catch (e) {}
  try { chrome.runtime.onStartup?.addListener?.(() => {
    try { chrome.runtime.sendMessage(HUD_ID, { type: "zb-scheme-get" }, (r) => { void chrome.runtime.lastError; if (r && r.scheme) applyFromHud(r.scheme); }); } catch (e) {}
  }); } catch (e) {}

  // Light/effects sync — same cross-extension bridge as the scheme. The HUD owns
  // the light flag (chrome.storage zb_ui); mirror it into our "ui.light" so
  // lib/ui-scheme.js can flip every zpwrchrome page light.
  const UI_LIGHT_KEY = "ui.light";
  let fromHudLight = null;   // last light value the HUD pushed — don't echo it back
  function applyUiFromHud(ui) { const light = !!(ui && ui.light); fromHudLight = light; try { chrome.storage.local.set({ [UI_LIGHT_KEY]: light }); } catch (e) {} }
  try { chrome.runtime.sendMessage(HUD_ID, { type: "zb-ui-get" }, (r) => { void chrome.runtime.lastError; if (r && r.ui) applyUiFromHud(r.ui); }); } catch (e) {}

  // A light toggle in OUR theme injector (writes ui.light) → tell the HUD to go
  // light globally so the whole browser follows. Skip the HUD's own echo.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[UI_LIGHT_KEY]) return;
      const light = !!changes[UI_LIGHT_KEY].newValue;
      if (light === fromHudLight) { fromHudLight = null; return; }
      try { chrome.runtime.sendMessage(HUD_ID, { type: "zb-ui-set", light }, () => { void chrome.runtime.lastError; }); } catch (e) {}
    });
  } catch (e) {}

  // Live push from the HUD when the user repaints the browser or toggles light/fx.
  try {
    chrome.runtime.onMessageExternal.addListener((msg, sender) => {
      if (!sender || sender.id !== HUD_ID || !msg) return;
      if (msg.type === "zb-scheme" && msg.scheme) applyFromHud(msg.scheme);
      if (msg.type === "zb-ui" && msg.ui) applyUiFromHud(msg.ui);
    });
  } catch (e) {}

  // A pick in OUR theme injector (writes ui.scheme) → tell the HUD so the whole
  // browser chrome follows. Skip the echo of a scheme the HUD just pushed to us.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[UI_SCHEME_KEY]) return;
      const scheme = changes[UI_SCHEME_KEY].newValue;
      if (!scheme || scheme === fromHud) { fromHud = null; return; }
      try { chrome.runtime.sendMessage(HUD_ID, { type: "zb-scheme-set", scheme }, () => { void chrome.runtime.lastError; }); } catch (e) {}
    });
  } catch (e) {}
})();
