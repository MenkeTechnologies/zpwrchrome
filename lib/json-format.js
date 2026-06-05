// Pure JSON formatter helpers — pretty-print, syntax-class tagging, and
// JSON-pointer (RFC 6901) path computation. Returns plain data so the
// caller can render to HTML / DOM however it likes. Testable in Node
// without a Chrome environment.

// looksLikeJson(raw) → boolean. Cheap pre-check for the content-script
// auto-detector: must start with `{`, `[`, `"`, a number, `true`, `false`,
// or `null` after whitespace. Avoids the cost of JSON.parse on every
// page.
export function looksLikeJson(raw) {
  const s = String(raw || "").trimStart();
  if (!s) return false;
  const c = s[0];
  if (c === "{" || c === "[" || c === '"') return true;
  if (c === "-" || (c >= "0" && c <= "9")) return true;
  if (s.startsWith("true") || s.startsWith("false") || s.startsWith("null")) return true;
  return false;
}

// tryParseJson(raw) → { ok: true, value } | { ok: false, error: string, pos?: number }
// Wraps JSON.parse, captures error position when the engine reports one.
export function tryParseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(String(raw)) };
  } catch (e) {
    const msg = String(e?.message || e);
    // V8 surfaces "Unexpected token ... in JSON at position N" — pull N
    // so the UI can highlight the offending byte.
    const m = msg.match(/position (\d+)/);
    return { ok: false, error: msg, pos: m ? Number(m[1]) : undefined };
  }
}

// jsonType(v) → "string" | "number" | "boolean" | "null" | "array" | "object" | "undefined"
export function jsonType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "object") return "object";
  return t;   // "string" / "number" / "boolean" / "undefined"
}

// nodeSummary(v) → short structural label, e.g. "Object {3}" / "Array [12]"
// Used by collapsed-node previews.
export function nodeSummary(v) {
  if (Array.isArray(v))       return `Array(${v.length})`;
  if (v && typeof v === "object") return `Object(${Object.keys(v).length})`;
  return jsonType(v);
}

// walk(value, visit, path = []) — depth-first walk over a parsed JSON
// value. `visit({ value, path, type })` is called for every node.
// `path` is the RFC 6901-shaped array of segments (strings for object
// keys, numbers for array indices). Order: parent-before-children.
export function walk(value, visit, path = []) {
  visit({ value, path: path.slice(), type: jsonType(value) });
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) walk(value[i], visit, [...path, i]);
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) walk(value[k], visit, [...path, k]);
  }
}

// formatPath(path) → RFC 6901 JSON-pointer string.
// segments: ["foo", 0, "bar"] → "/foo/0/bar"
// Escapes per RFC: ~ → ~0, / → ~1
export function formatPath(path) {
  if (!Array.isArray(path) || path.length === 0) return "";
  return "/" + path
    .map((seg) => String(seg).replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/");
}

// prettyPrint(value, indent = 2) — JSON.stringify with a stable indent.
// Returns "" for undefined.
export function prettyPrint(value, indent = 2) {
  if (value === undefined) return "";
  return JSON.stringify(value, null, indent);
}

// minify(value) — JSON.stringify without indentation. Mirrors prettyPrint.
export function minify(value) {
  if (value === undefined) return "";
  return JSON.stringify(value);
}

// countNodes(value) → integer. The number of distinct sub-values
// (including the root). Used by the summary strip in the viewer.
export function countNodes(value) {
  let n = 0;
  walk(value, () => { n++; });
  return n;
}

// jsonByteSize(value) — UTF-8 byte length of JSON.stringify(value).
// Useful for the "X KB" summary. Matches Buffer.byteLength.
export function jsonByteSize(value) {
  return new TextEncoder().encode(prettyPrint(value)).length;
}
