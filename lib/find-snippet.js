// Pure snippet-extraction helpers for the find-in-all-tabs feature.
//
// The SW harvests `document.body.innerText` from every open http(s) tab,
// caps it at HARVEST_MAX_CHARS, and stores the raw text per-tab. The UI
// filters tabs whose text contains the query (case-insensitive) and
// renders a short window of context around the FIRST match per tab.
// These helpers are split out so they can be unit-tested in plain Node
// without a Chrome environment.

export const HARVEST_MAX_CHARS = 200_000;     // ~200 KB of text per tab
export const SNIPPET_RADIUS    = 80;          // chars on each side of the match

// findFirstMatch(text, query) → { start, end } | null
// Case-insensitive substring scan. Returns the byte-offset range of the
// first match in `text`, or null if no match.
export function findFirstMatch(text, query) {
  if (!text || !query) return null;
  const lc = String(text).toLowerCase();
  const q  = String(query).toLowerCase();
  const idx = lc.indexOf(q);
  if (idx < 0) return null;
  return { start: idx, end: idx + q.length };
}

// extractSnippet(text, query, radius = SNIPPET_RADIUS) →
//   { snippet: string, hitStart: number, hitEnd: number } | null
//
// Returns a window of `text` centered on the first match of `query`, with
// `radius` chars of context on each side, collapsed whitespace. `hitStart`
// and `hitEnd` are the offsets of the query within the returned snippet
// (after whitespace collapse may shift things, but we map back so
// renderers can highlight precisely).
export function extractSnippet(text, query, radius = SNIPPET_RADIUS) {
  const match = findFirstMatch(text, query);
  if (!match) return null;
  const start = Math.max(0, match.start - radius);
  const end   = Math.min(text.length, match.end + radius);
  const raw   = String(text).slice(start, end);
  // Collapse runs of whitespace so the snippet stays one line — common
  // case is the harvested innerText has lots of "\n\n" between blocks.
  const collapsed = raw.replace(/\s+/g, " ").trim();
  // Recompute hit offsets within the collapsed snippet — search again
  // because collapsing can shift indices. Falls back to first occurrence,
  // which is what the user expects to see highlighted.
  const collapsedLc = collapsed.toLowerCase();
  const q = String(query).toLowerCase();
  const hit = collapsedLc.indexOf(q);
  return {
    snippet:   collapsed,
    hitStart:  hit < 0 ? 0          : hit,
    hitEnd:    hit < 0 ? q.length   : hit + q.length,
    leftElide: start > 0,
    rightElide: end < text.length,
  };
}

// countOccurrences(text, query) → integer ≥ 0
// Plain case-insensitive scan; used for the per-row "N matches" badge so
// the user can see at a glance which tab has the most hits.
export function countOccurrences(text, query) {
  if (!text || !query) return 0;
  const lc = String(text).toLowerCase();
  const q  = String(query).toLowerCase();
  if (!q) return 0;
  let count = 0;
  let i = 0;
  while ((i = lc.indexOf(q, i)) >= 0) { count++; i += q.length; }
  return count;
}
