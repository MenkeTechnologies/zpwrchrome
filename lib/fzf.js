// FZF-style fuzzy match — ported from audio-haxor/frontend/js/utils.js
// (functions fzfMatch + highlightWithIndices, scoring constants kept
// identical so behavior matches across MenkeTechnologies' tools).
//
// fzfMatch(needle, haystack) → { score, indices } | null
// highlightWithIndices(text, indices, escape) → HTML string with
//   <mark class="fzf-hl">…</mark> wraps around matched characters.
//
// Pure functions, zero dependencies. ES module so popup.js can import it.
// The build script scripts/build-modal.sh inlines everything between the
// FZF_INLINE_START / FZF_INLINE_END markers below into modal/content.js
// (where ES imports aren't available to content scripts). `export ` is
// stripped during substitution.

// FZF_INLINE_START
export const FZF_SCORE_MATCH = 16;
export const FZF_SCORE_GAP_START = -3;
export const FZF_SCORE_GAP_EXTENSION = -1;
export const FZF_BONUS_BOUNDARY = 9;
export const FZF_BONUS_NON_WORD = 8;
export const FZF_BONUS_CAMEL = 7;
export const FZF_BONUS_CONSECUTIVE = 4;
export const FZF_BONUS_FIRST_CHAR_MULT = 2;

export function fzfCharClass(c) {
  if (c >= "a" && c <= "z") return 1; // lower
  if (c >= "A" && c <= "Z") return 2; // upper
  if (c >= "0" && c <= "9") return 3; // digit
  return 0; // non-word
}

export function fzfPositionBonus(prev, curr) {
  const pc = fzfCharClass(prev);
  const cc = fzfCharClass(curr);
  if (pc === 0 && cc !== 0) return FZF_BONUS_BOUNDARY;                  // word boundary
  if (pc === 1 && cc === 2) return FZF_BONUS_CAMEL;                     // camelCase
  if (cc !== 0 && pc !== 0 && pc !== cc) return FZF_BONUS_NON_WORD;
  return 0;
}

// Fuzzy match with fzf-style scoring. Returns { score, indices } or null.
export function fzfMatch(needle, haystack) {
  const nLen = needle.length, hLen = haystack.length;
  if (nLen === 0) return { score: 0, indices: [] };
  if (nLen > hLen) return null;

  const nLower = needle.toLowerCase();
  const hLower = haystack.toLowerCase();

  // Quick check: all chars present in order
  let ni = 0;
  for (let hi = 0; hi < hLen && ni < nLen; hi++) {
    if (hLower[hi] === nLower[ni]) ni++;
  }
  if (ni < nLen) return null;

  // Try every starting position for the first needle character; greedy
  // forward match for the rest. Keep the highest-scoring path.
  let bestScore = -Infinity, bestIndices = null;
  const starts = [];
  for (let i = 0; i <= hLen - nLen; i++) {
    if (hLower[i] === nLower[0]) starts.push(i);
  }

  for (const start of starts) {
    const indices = [start];
    let si = start;
    let valid = true;
    for (let n = 1; n < nLen; n++) {
      let found = false;
      for (let h = si + 1; h < hLen; h++) {
        if (hLower[h] === nLower[n]) {
          indices.push(h);
          si = h;
          found = true;
          break;
        }
      }
      if (!found) { valid = false; break; }
    }
    if (!valid) continue;

    let score = 0;
    let prevIdx = -2;
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      score += FZF_SCORE_MATCH;
      const prev = idx > 0 ? haystack[idx - 1] : " ";
      let bonus = fzfPositionBonus(prev, haystack[idx]);
      if (i === 0) bonus *= FZF_BONUS_FIRST_CHAR_MULT;
      score += bonus;
      if (prevIdx === idx - 1) {
        score += FZF_BONUS_CONSECUTIVE;
      } else if (i > 0) {
        const gap = idx - prevIdx - 1;
        score += FZF_SCORE_GAP_START + FZF_SCORE_GAP_EXTENSION * (gap - 1);
      }
      prevIdx = idx;
    }
    if (score > bestScore) { bestScore = score; bestIndices = indices; }
  }
  if (!bestIndices) return null;
  return { score: bestScore, indices: bestIndices };
}

// Wrap matched characters in <mark class="fzf-hl">. Caller supplies the
// HTML-escape function so the same code works in popup (where escapeHtml is
// local) and modal (where the inlined copy reuses the same escape util).
export function highlightWithIndices(text, indices, escape) {
  if (!text) return "";
  if (!indices || indices.length === 0) return escape(text);
  const idxSet = new Set(indices);
  let result = "";
  let inMark = false;
  for (let i = 0; i < text.length; i++) {
    const ch = escape(text[i]);
    if (idxSet.has(i)) {
      if (!inMark) { result += '<mark class="fzf-hl">'; inMark = true; }
      result += ch;
    } else {
      if (inMark) { result += "</mark>"; inMark = false; }
      result += ch;
    }
  }
  if (inMark) result += "</mark>";
  return result;
}

// FZF_INLINE_END
