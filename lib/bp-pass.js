// Client-side pass helpers for the BP protocol path.
//
// The Rust port of browserpass-native (browserpass-host-rs) does NOT do
// domain matching or entry parsing server-side — those live in upstream
// browserpass-extension and (now) here in JS. Each fn ports verbatim from
// the previous Rust implementation in browserpass-host-rs/src/pass.rs
// (now removed) so the matching contract is unchanged.

// Multi-label public suffixes — minimum viable set; covers the common case
// where the registrable domain is two labels past the suffix
// (foo.co.uk, foo.com.au). Single-label TLDs (com, org, io, etc.) need no
// entry here.
const MULTI_LABEL_SUFFIXES = [
  "co.uk", "com.au", "co.jp", "co.in", "co.za", "com.br", "com.mx",
  "com.tw", "com.cn", "co.kr", "co.nz", "ac.uk", "gov.uk", "org.uk",
  "co.il", "ne.jp", "or.jp",
];

export function etldPlusOne(host) {
  const h = String(host || "").trim().replace(/\.+$/, "").toLowerCase();
  for (const tld of MULTI_LABEL_SUFFIXES) {
    const suffix = "." + tld;
    if (h.endsWith(suffix)) {
      const head = h.slice(0, h.length - suffix.length);
      const labels = head.split(".");
      const last = labels[labels.length - 1];
      if (last) return `${last}.${tld}`;
    }
  }
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}

// candidates(host) → list of host strings to try matching against, from
// most-specific (full subdomain chain) down to eTLD+1 (never bare TLD).
export function candidates(host) {
  const h = String(host || "").trim().replace(/\.+$/, "").toLowerCase();
  if (!h) return [];
  const etld1 = etldPlusOne(h);
  const out = [];
  let cur = h;
  while (true) {
    out.push(cur);
    if (cur === etld1) break;
    const idx = cur.indexOf(".");
    if (idx < 0) break;
    const rest = cur.slice(idx + 1);
    if (rest === etld1 || rest.includes(".")) {
      cur = rest;
    } else {
      break;
    }
  }
  if (!out.includes(etld1) && etld1.includes(".")) out.push(etld1);
  return out;
}

// matchIn(entries, host) → entries whose path's first segment or basename
// equals or is a subdomain of any candidate domain. Mirrors the Rust port's
// scoring + sort behavior (lower candidate index wins).
export function matchIn(entries, host) {
  const cands = candidates(host);
  if (!cands.length) return [];
  const buckets = new Map();   // candidate index → entries
  for (const entry of entries) {
    const first = entry.split("/")[0] || "";
    const basename = entry.split("/").slice(-1)[0] || entry;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (
        first === c || first.endsWith("." + c) ||
        basename === c || basename.endsWith("." + c)
      ) {
        if (!buckets.has(i)) buckets.set(i, []);
        buckets.get(i).push(entry);
        break;
      }
    }
  }
  const out = [];
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  for (const k of keys) out.push(...buckets.get(k));
  // dedup + sort within each bucket
  return [...new Set(out)].sort();
}

// parseEntry(text) → {password, username, url, otpUrl, fields, notes}
//
// Mirrors the Rust port's parse_entry exactly:
//   * line 1 is the password
//   * subsequent `key: value` lines populate `fields`
//   * `otpauth://…` lines are captured in `otpUrl`
//   * username synonyms: login, username, user, email, mail
//   * url synonyms (browserpass-extension): url, link, website, web, site
//   * everything else lands in `notes`
export function parseEntry(text) {
  const lines = String(text || "").split("\n");
  const password = (lines.shift() || "").replace(/\r$/, "");
  const fields = {};
  const notes = [];
  let otpUrl = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    if (line.startsWith("otpauth://")) {
      otpUrl = line;
      continue;
    }
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = line.slice(idx + 1).trim();
      if (key && !key.includes(" ")) {
        fields[key] = val;
        continue;
      }
    }
    notes.push(line);
  }
  const userKeys = ["login", "username", "user", "email", "mail"];
  const urlKeys  = ["url", "link", "website", "web", "site", "uri", "launch", "homepage", "host", "hostname", "domain"];
  const username = userKeys.map((k) => fields[k]).find((v) => v) || "";
  const url      = urlKeys.map((k) => fields[k]).find((v) => v)  || "";
  return { password, username, url, otpUrl, fields, notes };
}

// browserpass-compat: when no explicit username field present, fall back to
// the entry's basename (the part after the last `/`, with `.gpg` stripped).
//   `example.com/johndoe.gpg` → username = "johndoe"
export function fallbackUsernameFromPath(parsed, entryPath) {
  if (parsed.username) return parsed;
  const stripped = String(entryPath || "").replace(/\.gpg$/, "");
  const basename = stripped.split("/").pop() || "";
  if (basename) parsed.username = basename;
  return parsed;
}

// When no explicit URL field is present, derive `https://<host>` from the
// first path segment that looks like a hostname (contains a `.`). The
// `<host>/<username>` layout is the dominant browserpass convention; this
// fallback means the manager's URL row populates for those entries without
// the user having to add a `url:` line by hand.
//   `adobe.com/jmenke@wccnet.edu` → url = "https://adobe.com"
//   `aws/prod/root`               → url unchanged (no segment looks like a host)
//   `subdomain.example.com.gpg`   → url = "https://subdomain.example.com"
export function fallbackUrlFromPath(parsed, entryPath) {
  if (parsed.url) return parsed;
  const stripped = String(entryPath || "").replace(/\.gpg$/, "");
  const segs = stripped.split("/").filter(Boolean);
  for (const seg of segs) {
    // Skip the basename when there's a parent dir — basenames are typically
    // usernames, not hosts. (For root-level entries like `github.com.gpg`,
    // the basename IS the host, so we still consider it.)
    if (segs.length > 1 && seg === segs[segs.length - 1]) continue;
    if (seg.includes(".") && !seg.startsWith(".") && !seg.endsWith(".")) {
      parsed.url = `https://${seg}`;
      return parsed;
    }
  }
  // Root-level dotted basename — treat as host.
  if (segs.length === 1 && segs[0].includes(".")) {
    parsed.url = `https://${segs[0]}`;
  }
  return parsed;
}
