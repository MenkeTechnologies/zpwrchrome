// User-Agent presets for the UA switcher. Pinned to specific stable
// strings rather than dynamic compilation so the spoof value is
// reproducible and easy to verify on the receiving end.
//
// Group → preset → UA string. The UI groups them visually; the SW
// just sees a flat (id, ua) pair.

export const UA_PRESETS = Object.freeze([
  // ── Desktop Chrome ──────────────────────────────────────────────
  { id: "chrome-win",   group: "Chrome",   label: "Chrome on Windows",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
  { id: "chrome-mac",   group: "Chrome",   label: "Chrome on macOS",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
  { id: "chrome-linux", group: "Chrome",   label: "Chrome on Linux",
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },

  // ── Desktop Firefox ─────────────────────────────────────────────
  { id: "firefox-win",  group: "Firefox",  label: "Firefox on Windows",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0" },
  { id: "firefox-mac",  group: "Firefox",  label: "Firefox on macOS",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:128.0) Gecko/20100101 Firefox/128.0" },
  { id: "firefox-linux",group: "Firefox",  label: "Firefox on Linux",
    ua: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" },

  // ── Desktop Safari ──────────────────────────────────────────────
  { id: "safari-mac",   group: "Safari",   label: "Safari on macOS",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15" },

  // ── Desktop Edge ────────────────────────────────────────────────
  { id: "edge-win",     group: "Edge",     label: "Edge on Windows",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0" },

  // ── Mobile ─────────────────────────────────────────────────────
  { id: "android-chrome", group: "Mobile", label: "Chrome on Android",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" },
  { id: "iphone-safari",  group: "Mobile", label: "Safari on iPhone",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" },
  { id: "ipad-safari",    group: "Mobile", label: "Safari on iPad",
    ua: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" },

  // ── Bots ────────────────────────────────────────────────────────
  { id: "googlebot",      group: "Bots",   label: "Googlebot",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36" },
  { id: "bingbot",        group: "Bots",   label: "Bingbot",
    ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
  { id: "duckduckbot",    group: "Bots",   label: "DuckDuckBot",
    ua: "Mozilla/5.0 (compatible; DuckDuckBot-Https/1.1; https://duckduckgo.com/duckduckbot)" },

  // ── CLI / curl ─────────────────────────────────────────────────
  { id: "curl",           group: "CLI",    label: "curl/8",
    ua: "curl/8.10.0" },
  { id: "wget",           group: "CLI",    label: "Wget/1.24",
    ua: "Wget/1.24.5" },
]);

// Returns the preset by id, or null.
export function getPreset(id) {
  return UA_PRESETS.find((p) => p.id === id) || null;
}

// All distinct group names in declaration order.
export function presetGroups() {
  const seen = new Set();
  const out = [];
  for (const p of UA_PRESETS) {
    if (seen.has(p.group)) continue;
    seen.add(p.group);
    out.push(p.group);
  }
  return out;
}

// resolveUA(state) — pure resolver. `state` is the persisted bag:
//   { enabled: boolean, mode: "preset" | "custom", presetId?, customUA? }
// Returns the resolved UA string or null if no override should apply.
export function resolveUA(state) {
  if (!state || !state.enabled) return null;
  if (state.mode === "custom") {
    const ua = String(state.customUA || "").trim();
    return ua || null;
  }
  // mode === "preset" or unspecified
  const p = getPreset(state.presetId);
  return p ? p.ua : null;
}
