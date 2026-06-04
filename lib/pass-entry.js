// Encode parsed pass entries back to the multi-line text form the GPG file
// stores. Inverse of `parseEntry` in lib/bp-pass.js — chosen so a parse →
// format round-trip is byte-identical when no fields changed, and so a
// format → parse round-trip recovers every value the editor exposes.
//
// browserpass multi-line schema:
//   line 1 : password
//   line 2+: `key: value` pairs (login, username, url, ...) +
//            `otpauth://...` URI line + free-form notes lines
//
// Field write order (deterministic so diffs stay readable):
//   login → url → otpauth → other extra fields (alpha) → notes

const USER_PREFERRED_KEY = "login";
const URL_PREFERRED_KEY  = "url";
const USER_SYNONYMS = ["login", "username", "user", "email", "mail"];
const URL_SYNONYMS  = ["url", "link", "website", "web", "site", "uri", "launch"];

// formatEntry({password, username, url, otpUrl, fields, notes}) → text.
// Accepts either the parsed-entry shape (fields = bag of key→value) or the
// flattened editor shape (just username/url at top level). Trailing newline
// is preserved — `pass` writes one and the host's saveEncryptedContents
// expects exactly the bytes you give it.
export function formatEntry(input) {
  const e = input || {};
  const password = String(e.password ?? "");
  const fields = { ...(e.fields || {}) };

  // Editor convenience: if username / url were passed at top level, promote
  // them into the fields bag under the canonical key. Existing synonyms
  // already in `fields` are kept; we don't rewrite them to login/url because
  // doing so would mutate entries the user wrote by hand.
  if (e.username != null && e.username !== "") {
    const hasUser = USER_SYNONYMS.some((k) => fields[k]);
    if (!hasUser) fields[USER_PREFERRED_KEY] = String(e.username);
  }
  if (e.url != null && e.url !== "") {
    const hasUrl = URL_SYNONYMS.some((k) => fields[k]);
    if (!hasUrl) fields[URL_PREFERRED_KEY] = String(e.url);
  }

  // Ordering: login/url synonyms first (in synonym-list order so
  // hand-written `username: foo` doesn't get reordered relative to its
  // original position), then other fields alpha-sorted.
  const ordered = [];
  for (const k of USER_SYNONYMS) if (k in fields) ordered.push(k);
  for (const k of URL_SYNONYMS)  if (k in fields) ordered.push(k);
  const seen = new Set(ordered);
  const extras = Object.keys(fields)
    .filter((k) => !seen.has(k))
    .sort();
  for (const k of extras) ordered.push(k);

  const out = [password];
  for (const k of ordered) {
    const v = fields[k];
    if (v == null) continue;
    out.push(`${k}: ${v}`);
  }

  const otpUrl = String(e.otpUrl || "").trim();
  if (otpUrl) out.push(otpUrl);

  const notes = Array.isArray(e.notes) ? e.notes : (e.notes ? String(e.notes).split("\n") : []);
  for (const line of notes) {
    if (line == null) continue;
    out.push(String(line));
  }

  return out.join("\n") + "\n";
}

// validatePassPath(rel) → string | null
// rel is the relative path inside the store (no .gpg suffix). Reject:
//   * empty
//   * leading slash
//   * `..` traversal
//   * trailing slash
//   * embedded NUL
// Allowed: any other UTF-8. Whitespace is permitted (pass tolerates it).
export function validatePassPath(rel) {
  const s = String(rel || "");
  if (!s) return "path is empty";
  if (s.includes("\0")) return "path contains NUL byte";
  if (s.startsWith("/")) return "path must be relative (no leading /)";
  if (s.endsWith("/"))   return "path must name an entry, not a directory";
  for (const seg of s.split("/")) {
    if (seg === "" || seg === "." || seg === "..") {
      return `invalid path segment "${seg}"`;
    }
  }
  return null;
}

// buildTree(paths) → nested tree for the manager's left pane.
//   paths: ["a/b/c", "a/d", "e"]
// Returns:
//   { name: "", path: "", dirs: [...], entries: [...] }
// where each dir is { name, path, dirs, entries } and each entry is
// { name, path }. dirs and entries are alpha-sorted at each level.
export function buildTree(paths) {
  const root = { name: "", path: "", dirs: [], entries: [] };
  const dirIndex = new Map(); // path → node
  dirIndex.set("", root);

  for (const raw of paths || []) {
    const p = String(raw || "").replace(/\.gpg$/, "").replace(/^\/+/, "");
    if (!p) continue;
    const parts = p.split("/");
    let cur = root;
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      let child = dirIndex.get(acc);
      if (!child) {
        child = { name: parts[i], path: acc, dirs: [], entries: [] };
        cur.dirs.push(child);
        dirIndex.set(acc, child);
      }
      cur = child;
    }
    cur.entries.push({ name: parts[parts.length - 1], path: p });
  }

  const sortNode = (node) => {
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.entries.sort((a, b) => a.name.localeCompare(b.name));
    node.dirs.forEach(sortNode);
  };
  sortNode(root);
  return root;
}
