// Source string for the GM.* shim. Prepended to every userscript before
// chrome.userScripts.register. Runs inside the USER_SCRIPT world where
// chrome.runtime.sendMessage is available (so we can proxy storage and
// clipboard ops through the service worker).
//
// `__GM_INFO_JSON__` is replaced at register time with the script's
// metadata so GM_info is populated correctly.

export const GM_SHIM_SOURCE = `
const GM_info = __GM_INFO_JSON__;
const unsafeWindow = window;

const __gmSend = (kind, payload) => new Promise((resolve) => {
  try {
    chrome.runtime.sendMessage({ kind: "gm:" + kind, ...payload }, (resp) => resolve(resp));
  } catch { resolve({ ok: false }); }
});

const GM = {
  info: GM_info,
  getValue: (key, fallback) => __gmSend("getValue", { script: GM_info.script.id, key }).then(
    (r) => (r && r.ok && r.value !== undefined ? r.value : fallback)
  ),
  setValue: (key, value) => __gmSend("setValue", { script: GM_info.script.id, key, value }).then(() => undefined),
  deleteValue: (key) => __gmSend("deleteValue", { script: GM_info.script.id, key }).then(() => undefined),
  listValues: () => __gmSend("listValues", { script: GM_info.script.id }).then((r) => (r && r.ok ? r.keys : [])),
  setClipboard: (text) => __gmSend("setClipboard", { text }).then(() => undefined),
  openInTab: (url, opts) => {
    const o = typeof opts === "boolean" ? { active: !opts } : (opts || {});
    return __gmSend("openInTab", { url, active: o.active !== false, insert: o.insert !== false }).then((r) => r?.tabId);
  },
  addStyle: (css) => {
    const el = document.createElement("style");
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
    return el;
  },
  addElement: (parentOrTag, tagOrAttrs, maybeAttrs) => {
    let parent, tag, attrs;
    if (typeof parentOrTag === "string") {
      parent = document.head || document.documentElement;
      tag = parentOrTag;
      attrs = tagOrAttrs || {};
    } else {
      parent = parentOrTag;
      tag = tagOrAttrs;
      attrs = maybeAttrs || {};
    }
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "textContent") el.textContent = v;
      else el.setAttribute(k, v);
    }
    parent.appendChild(el);
    return el;
  },
  notification: (text, title) => {
    const t = typeof text === "string" ? { text, title } : text;
    return __gmSend("notification", t).then(() => undefined);
  }
};

// Sync GM_* aliases — these return Promises in our impl (Tampermonkey ships
// both sync and async; modern scripts usually \`await\` either).
const GM_setValue    = GM.setValue;
const GM_getValue    = GM.getValue;
const GM_deleteValue = GM.deleteValue;
const GM_listValues  = GM.listValues;
const GM_setClipboard = GM.setClipboard;
const GM_openInTab   = GM.openInTab;
const GM_addStyle    = GM.addStyle;
const GM_addElement  = GM.addElement;
const GM_notification = GM.notification;
`;
