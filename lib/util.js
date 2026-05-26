// Pure helpers used by background.js. Zero chrome.* references so this
// module can be imported by node:test in headless CI.

export const MRU_CAP_DEFAULT = 200;

export function mruPush(mru, tabId, cap = MRU_CAP_DEFAULT) {
  if (typeof tabId !== "number" || !Number.isFinite(tabId)) return mru.slice();
  const filtered = mru.filter((id) => id !== tabId);
  filtered.unshift(tabId);
  return filtered.slice(0, cap);
}

export function mruDrop(mru, tabId) {
  return mru.filter((id) => id !== tabId);
}

// Return the tab id `delta` steps away from `currentId` in the MRU list,
// wrapping around. Returns undefined when the list is too short to step.
export function mruStep(mru, currentId, delta) {
  if (mru.length < 2) return undefined;
  const idx = mru.indexOf(currentId);
  if (idx === -1) return mru[0];
  return mru[(idx + delta + mru.length) % mru.length];
}

// Pick the tab id of the previous tab (first MRU entry that isn't current).
export function mruPrevious(mru, currentId) {
  for (const id of mru) if (id !== currentId) return id;
  return undefined;
}

export function hostnameOf(url) {
  try { return new URL(url).hostname || "(local)"; } catch { return "(other)"; }
}

// Resolve a numeric jump command ("jump-to-3") against a tabs array.
// "jump-to-9" is treated as last-tab. 1-8 cap at tabs.length.
export function resolveJumpIndex(command, tabsLength) {
  if (!command.startsWith("jump-to-")) return -1;
  const n = parseInt(command.slice("jump-to-".length), 10);
  if (!Number.isFinite(n) || tabsLength <= 0) return -1;
  if (n === 9) return tabsLength - 1;
  return Math.min(n - 1, tabsLength - 1);
}
