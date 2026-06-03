// zpwrchrome — batch URL pattern expansion.
//
// Recognises bracketed range patterns embedded in a URL and expands them
// into an array of concrete URLs. Examples:
//
//   https://site.com/img[01:99].jpg                       → 99 URLs
//   https://site.com/p[0:200:10].html                     → 21 URLs (step 10)
//   https://site.com/[a:f].txt                            → 6 URLs
//   https://site.com/x[1:3]-[a:c].png                     → 9 URLs (cartesian)
//   https://site.com/plain.jpg                            → 1 URL (passthrough)
//
// Numeric ranges support zero-padding: [01:99] → 01, 02, ..., 99.
// Alpha ranges are single ASCII letters in either direction.
//
// Hard cap MAX_EXPANSION prevents accidental million-URL fan-outs from
// pathological inputs. Returns the original URL only if no bracket
// pattern is detected.

export const MAX_EXPANSION = 1000;

const PATTERN_RE = /\[(\d+):(\d+)(?::(\d+))?\]|\[([A-Za-z]):([A-Za-z])\]/g;

/**
 * Expand a single URL containing zero or more bracket range patterns into
 * the cartesian product of all ranges. Throws if expansion would exceed
 * MAX_EXPANSION URLs (prevents pathological inputs).
 *
 * @param {string} url
 * @returns {string[]}
 */
export function expandBatch(url) {
  if (typeof url !== "string" || url.length === 0) return [];
  const matches = [...url.matchAll(PATTERN_RE)];
  if (matches.length === 0) return [url];

  // Build per-pattern value arrays.
  const ranges = matches.map((m) => buildRange(m));
  const total = ranges.reduce((acc, r) => acc * r.length, 1);
  if (total > MAX_EXPANSION) {
    throw new RangeError(`batch expansion would produce ${total} URLs (cap ${MAX_EXPANSION})`);
  }

  // Cartesian product. Iterate by computing the index in each dimension
  // from a flat counter — cheaper than recursion for the common 1-2 patterns.
  const out = new Array(total);
  for (let i = 0; i < total; i++) {
    let result = url;
    let n = i;
    // Replace tokens from RIGHT to LEFT so index offsets stay stable.
    for (let k = matches.length - 1; k >= 0; k--) {
      const r = ranges[k];
      const idx = n % r.length;
      n = Math.floor(n / r.length);
      const m = matches[k];
      result = result.slice(0, m.index) + r[idx] + result.slice(m.index + m[0].length);
    }
    out[i] = result;
  }
  return out;
}

function buildRange(m) {
  // Numeric: m[1]=start, m[2]=end, m[3]=step (optional)
  if (m[1] !== undefined) {
    const start = parseInt(m[1], 10);
    const end   = parseInt(m[2], 10);
    const step  = m[3] !== undefined ? parseInt(m[3], 10) : 1;
    if (!Number.isFinite(step) || step <= 0) {
      throw new RangeError(`batch step must be positive integer, got ${m[3]}`);
    }
    // Zero-padding kicks in ONLY when the user explicitly wrote a leading
    // zero on either bound — `[01:99]` → "01", "02", … vs `[1:99]` → "1",
    // "2", …. Matches upstream Chrono/IDM/DTA convention.
    const padded = (m[1].startsWith("0") && m[1].length > 1) ||
                   (m[2].startsWith("0") && m[2].length > 1);
    const width  = padded ? Math.max(m[1].length, m[2].length) : 0;
    const arr = [];
    const fmt = (v) => width > 0 ? String(v).padStart(width, "0") : String(v);
    if (start <= end) {
      for (let v = start; v <= end; v += step) arr.push(fmt(v));
    } else {
      for (let v = start; v >= end; v -= step) arr.push(fmt(v));
    }
    return arr;
  }
  // Alpha: m[4]=start, m[5]=end (single letters, same case)
  const a = m[4].charCodeAt(0);
  const b = m[5].charCodeAt(0);
  const arr = [];
  if (a <= b) for (let c = a; c <= b; c++) arr.push(String.fromCharCode(c));
  else        for (let c = a; c >= b; c--) arr.push(String.fromCharCode(c));
  return arr;
}

/**
 * Same as expandBatch but never throws — returns [url] on any error.
 * Useful from UI hot paths where a bad pattern shouldn't break the flow.
 */
export function expandBatchSafe(url) {
  try { return expandBatch(url); }
  catch { return [url]; }
}

/** Return true when the URL contains at least one bracket range pattern. */
export function hasBatchPattern(url) {
  PATTERN_RE.lastIndex = 0;
  return PATTERN_RE.test(String(url));
}
