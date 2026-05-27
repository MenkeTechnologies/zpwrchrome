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

// UTIL_INLINE_START
// scripts/build-modal.mjs inlines everything between these markers into
// modal/content.js (where ES imports aren't available to content scripts).
// `export ` is stripped during substitution.
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

// ---------------------------------------------------------------------------
// Named scenes — save current window's tabs as a slug, restore later.
// Pure logic lives here so tests don't need a chrome.* runtime.
// ---------------------------------------------------------------------------

const SCENE_NAME_MAX = 48;
const SCENE_CAP_PER_SCENE = 200;

// kebab-cased [a-z0-9-]+, max 48 chars, collapses dashes, trims edges.
function slugify(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SCENE_NAME_MAX);
}

// Some URL schemes can't be programmatically re-opened by URL — skip them
// silently on save so a restore never silently swallows.
function isRestorableUrl(url) {
  if (typeof url !== "string" || !url) return false;
  return !/^(chrome|chrome-extension|devtools|view-source|about):/i.test(url);
}

// Build a Scene from raw tab objects (chrome.tabs.query result).
export function buildScene(name, tabs, nowMs = Date.now()) {
  const slug = slugify(name);
  if (!slug) return null;
  const entries = (Array.isArray(tabs) ? tabs : [])
    .map((t) => ({
      url: t?.url || t?.pendingUrl || "",
      title: t?.title || "",
      pinned: !!t?.pinned,
    }))
    .filter((e) => isRestorableUrl(e.url))
    .slice(0, SCENE_CAP_PER_SCENE);
  return {
    name: String(name).slice(0, SCENE_NAME_MAX),
    slug,
    tabs: entries,
    created_at: nowMs,
    updated_at: nowMs,
  };
}

// Upsert by slug; newest-first ordering.
export function upsertScene(scenes, scene) {
  if (!scene || !scene.slug) return Array.isArray(scenes) ? scenes.slice() : [];
  const without = (Array.isArray(scenes) ? scenes : []).filter((s) => s.slug !== scene.slug);
  return [scene, ...without];
}

export function dropScene(scenes, slug) {
  return (Array.isArray(scenes) ? scenes : []).filter((s) => s.slug !== slug);
}

// Resolve "restore-scene-N" (1..9) → ordinal index into the scenes list.
export function resolveSceneOrdinal(command, scenesLength) {
  if (typeof command !== "string" || !command.startsWith("restore-scene-")) return -1;
  const n = parseInt(command.slice("restore-scene-".length), 10);
  if (!Number.isFinite(n) || n < 1 || n > 9) return -1;
  if (scenesLength <= 0 || n > scenesLength) return -1;
  return n - 1;
}

// ---------------------------------------------------------------------------
// Tab tree by opener — parent→child relationships from chrome.tabs.Tab.
// Orphans (no openerTabId, or opener no longer exists) become roots.
// ---------------------------------------------------------------------------

// Build a forest from a flat tab array. Returns { roots: TreeNode[], byId }.
// TreeNode = { tab, children: TreeNode[] }
export function buildTabTree(tabs) {
  if (!Array.isArray(tabs)) return { roots: [], byId: new Map() };
  const byId = new Map();
  for (const t of tabs) {
    if (t && typeof t.id === "number") byId.set(t.id, { tab: t, children: [] });
  }
  const roots = [];
  for (const t of tabs) {
    if (!t || typeof t.id !== "number") continue;
    const node = byId.get(t.id);
    const parentId = t.openerTabId;
    const parent = (typeof parentId === "number") ? byId.get(parentId) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return { roots, byId };
}

// Flatten a tree to a depth-tagged display list, honoring a collapsed-set
// (subtrees rooted at any id in `collapsed` hide their descendants).
// Each entry: { tab, depth, hasChildren, collapsed }
export function flattenTree(roots, collapsed) {
  const out = [];
  const skip = collapsed instanceof Set ? collapsed
            : new Set(collapsed && typeof collapsed === "object" ? Object.keys(collapsed).map(Number) : []);
  const walk = (node, depth) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = skip.has(node.tab.id);
    out.push({ tab: node.tab, depth, hasChildren, collapsed: isCollapsed });
    if (hasChildren && !isCollapsed) {
      for (const c of node.children) walk(c, depth + 1);
    }
  };
  for (const r of roots || []) walk(r, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Domain → stable hue for the minimap. Uses djb2 → [0..360].
// ---------------------------------------------------------------------------

export function domainHueFor(url) {
  const host = hostnameOf(url);
  // djb2
  let h = 5381;
  for (let i = 0; i < host.length; i++) {
    h = ((h << 5) + h + host.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

// ---------------------------------------------------------------------------
// Frecency — combine recency + frequency into one ranking score for history.
//
//   frecency = (visitCount + 2*typedCount) / (hoursAgo + 2)
//
// Typed visits weigh 2x because the user deliberately chose the URL (not just
// clicked a link). The +2 stops brand-new visits from dominating with
// infinitesimal hoursAgo; a linear decay gives ~57x weight to "an hour ago"
// vs "a week ago" — recent matters, but a hundred visits last week still
// beats a one-off visit this morning.
//
// Pure — no chrome.* refs — so this can ship to both popup (extension page)
// and modal (content script via UTIL_INLINE) AND be unit-tested headless.
// ---------------------------------------------------------------------------
export function frecencyScore(item, nowMs = Date.now()) {
  if (!item) return 0;
  const visits = (item.visitCount || 0) + 2 * (item.typedCount || 0);
  if (visits <= 0) return 0;
  const last = item.lastVisitTime || 0;
  if (last <= 0) return visits;
  const hoursAgo = Math.max(0, (nowMs - last) / 3_600_000);
  return visits / (hoursAgo + 2);
}
// UTIL_INLINE_END
