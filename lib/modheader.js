// zpwrchrome — pure helpers for the ModHeader-style HTTP header manager.
//
// Kept Chrome-free so unit tests can import without mocking chrome.*.
// The service worker imports buildDnrRules() to project the active
// profile's enabled rules into chrome.declarativeNetRequest dynamic rules.

export const MODHEADER_RULE_BASE = 2000;
export const MODHEADER_RULE_CAP  = 1000;

export const MODHEADER_ALL_RT = Object.freeze([
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "media", "websocket", "other",
]);

export function defaultModheaderState() {
  return {
    enabled: false,
    activeProfileId: "default",
    profiles: [{ id: "default", name: "Default", color: "#05d9e8", rules: [] }],
  };
}

// Project a state bag into chrome.declarativeNetRequest addRules. Pure.
// Skips disabled rules, only the active profile contributes. Invalid rules
// (empty header name on a header op, empty redirect URL) are dropped.
export function buildDnrRules(state) {
  if (!state?.enabled) return [];
  const active = state.profiles?.find?.((p) => p.id === state.activeProfileId);
  if (!active) return [];
  const rules = (active.rules || []).filter((r) => r?.enabled);
  const out = [];
  let nextId = MODHEADER_RULE_BASE;
  for (const r of rules) {
    if (nextId >= MODHEADER_RULE_BASE + MODHEADER_RULE_CAP) break;
    const urlFilter = (r.urlFilter && String(r.urlFilter).trim()) || "*";
    const resourceTypes = Array.isArray(r.resourceTypes) && r.resourceTypes.length
      ? r.resourceTypes.slice()
      : MODHEADER_ALL_RT.slice();
    if (r.kind === "redirect") {
      const url = String(r.value || "").trim();
      if (!url) continue;
      out.push({
        id: nextId++,
        priority: 1,
        condition: { urlFilter, resourceTypes: ["main_frame", "sub_frame"] },
        action: { type: "redirect", redirect: { url } },
      });
      continue;
    }
    const name = String(r.name || "").trim().toLowerCase();
    if (!name) continue;
    const op = r.operation === "append" || r.operation === "remove" ? r.operation : "set";
    const header = { header: name, operation: op };
    if (op !== "remove") header.value = String(r.value ?? "");
    const action = { type: "modifyHeaders" };
    if (r.kind === "response") action.responseHeaders = [header];
    else action.requestHeaders = [header];
    out.push({ id: nextId++, priority: 1, condition: { urlFilter, resourceTypes }, action });
  }
  return out;
}
