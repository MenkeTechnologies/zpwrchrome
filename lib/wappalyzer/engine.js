// Wappalyzer-compatible technology detection engine.
//
// Pure JS module: takes a `Signals` bag (html, headers, cookies, scripts,
// meta, jsGlobals, url) + a fingerprint corpus → returns the list of
// matched technologies with confidence + version when extractable.
//
// Fingerprint format mirrors upstream wappalyzer's technologies.json:
//   {
//     "Tech Name": {
//       cats:     [number, …],
//       html:     "regex"           | ["regex", …],
//       headers:  { "Name": "regex" } | { "Name": ["regex", …] },
//       cookies:  { "Name": "regex" } | { "Name": ["regex", …] },
//       scripts:  "regex"           | ["regex", …],
//       meta:     { "name": "regex" } | { "name": ["regex", …] },
//       js:       { "global.path":  "regex" },
//       dom:      see upstream — { "selector": { exists: "" } | ... },
//       url:      "regex" | […],
//       implies:  "Other Tech"      | ["Other Tech\\;confidence:50", …],
//       requires: "Other Tech"      | […],
//       excludes: "Other Tech"      | […],
//       icon:     "FooBar.svg",
//       website:  "https://…",
//     }
//   }
//
// Pattern modifiers: a `\;confidence:NN`, `\;version:\\1` etc. tail
// (semicolon-separated) carries metadata. We parse them out per upstream.

// Wappalyzer encodes metadata in the pattern string as a `\;`-separated
// tail: "regex\\;confidence:50\\;version:\\1". The version template can
// contain `\N` backrefs that get resolved against the regex match at
// detection time. We split on the literal 2-char `\;` sequence so the
// backslashes inside the version template (\1, \2, …) survive intact.
function parsePattern(raw) {
  const parts = String(raw).split("\\;");
  const body = parts[0];
  let confidence = 100;
  let version = "";
  for (let i = 1; i < parts.length; i++) {
    const mod = parts[i];
    const colon = mod.indexOf(":");
    if (colon < 0) continue;
    const k = mod.slice(0, colon);
    const v = mod.slice(colon + 1);
    if      (k === "confidence") confidence = parseInt(v, 10) || 100;
    else if (k === "version")    version    = v;
  }
  let re;
  try { re = new RegExp(body, "i"); }
  catch { re = null; }
  return { re, source: body, confidence, version };
}

// Compile every pattern in a fingerprint set once. Returns a flat shape
// that's cheap to iterate during detection.
export function compileFingerprints(corpus) {
  const out = [];
  for (const [name, def] of Object.entries(corpus || {})) {
    const cats     = def.cats     || [];
    const html     = arr(def.html).map(parsePattern);
    const scripts  = arr(def.scripts).map(parsePattern);
    const url      = arr(def.url).map(parsePattern);
    const meta     = kvArr(def.meta,    /*lower=*/true);   // [ {key, patterns:[…]} ]
    const headers  = kvArr(def.headers, /*lower=*/true);
    const cookies  = kvArr(def.cookies, /*lower=*/false);  // RFC 6265 — case-sensitive
    const js       = kvArr(def.js,      /*lower=*/false);  // JS identifier paths
    const dom      = def.dom || null;                  // pass through; injected
    const implies  = arr(def.implies).map(parseImplies);
    const requires = arr(def.requires);
    const excludes = arr(def.excludes);
    out.push({
      name, cats, html, scripts, url, meta, headers, cookies, js,
      dom, implies, requires, excludes,
      icon: def.icon || "",
      website: def.website || "",
    });
  }
  return out;
}

function arr(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function kvArr(obj, lower) {
  if (!obj) return [];
  return Object.entries(obj).map(([key, val]) => ({
    key:      lower ? String(key).toLowerCase() : String(key),
    patterns: arr(val).map(parsePattern),
  }));
}

function parseImplies(raw) {
  // Format: "TechName" | "TechName\\;confidence:50"
  const s = String(raw);
  const m = s.match(/^([^\\]+?)(?:\\;confidence:(\d+))?$/);
  if (!m) return { name: s, confidence: 100 };
  return { name: m[1].trim(), confidence: parseInt(m[2] || "100", 10) };
}

// resolveVersion(template, match) — expand `\N` backrefs in the version
// template against a regex match. Wappalyzer puts the version in the
// pattern's `\;version:\1` tail; the literal "\1" / "\2" etc. resolves
// at match-time from the regex capture groups.
function resolveVersion(template, match) {
  if (!template) return "";
  if (!match) return template;
  return String(template).replace(/\\(\d)/g, (_, n) => match[Number(n)] || "");
}

function tryMatch(p, value) {
  if (!p.re) return null;
  const m = String(value).match(p.re);
  return m;  // null when no match
}

// matchRecord(record, signals) → { confidence, version, matched: [hit, …] }
// Returns confidence 0 if nothing matched.
function matchRecord(rec, signals) {
  let confidence = 0;
  let version = "";
  const matched = [];

  // Try one (pattern, value) pair. Returns { p, version, m } on hit, null
  // on miss. Resolves backrefs in the version template against the match.
  const tryOne = (p, value) => {
    const m = tryMatch(p, value);
    if (!m) return null;
    return { p, version: resolveVersion(p.version, m), m };
  };

  const tally = (group, hits) => {
    if (!hits.length) return;
    confidence = Math.min(100, confidence + Math.max(...hits.map((h) => h.p.confidence)));
    const v = hits.map((h) => h.version).find(Boolean);
    if (v && !version) version = v;
    matched.push({ group, hits: hits.map((h) => h.p.source) });
  };

  // url
  if (rec.url.length && signals.url) {
    const hits = rec.url.map((p) => tryOne(p, signals.url)).filter(Boolean);
    tally("url", hits);
  }
  // scripts — each pattern against each src URL, first hit wins per pattern
  if (rec.scripts.length && signals.scripts) {
    const hits = [];
    for (const p of rec.scripts) {
      for (const src of signals.scripts) {
        const h = tryOne(p, src);
        if (h) { hits.push(h); break; }
      }
    }
    tally("scripts", hits);
  }
  // html — search the whole body text
  if (rec.html.length && signals.html) {
    const hits = rec.html.map((p) => tryOne(p, signals.html)).filter(Boolean);
    tally("html", hits);
  }
  // meta / headers / cookies / js — kv-shaped matchers
  const kvMatch = (kvList, bag) => {
    if (!kvList.length || !bag) return [];
    const hits = [];
    for (const { key, patterns } of kvList) {
      const val = bag[key];
      if (val == null) continue;
      for (const p of patterns) {
        const h = tryOne(p, String(val));
        if (h) { hits.push(h); break; }
      }
    }
    return hits;
  };
  tally("meta",    kvMatch(rec.meta,    signals.meta));
  tally("headers", kvMatch(rec.headers, signals.headers));
  tally("cookies", kvMatch(rec.cookies, signals.cookies));
  tally("js",      kvMatch(rec.js,      signals.jsGlobals));

  return { confidence, version, matched };
}

// detect(signals, compiled) → [{ name, cats, confidence, version, icon,
//                               website, matched: [{group, hits}] }]
//
// Implements implies / requires / excludes per upstream:
//   - implies: every detected tech adds its implied techs (confidence
//     can be downweighted via \;confidence:NN tail).
//   - requires: a tech only counts if every named requirement is also
//     present (after a first pass).
//   - excludes: a tech evicts any tech in its excludes list from the
//     final result set.
export function detect(signals, compiled) {
  const hits = new Map(); // name → {tech, confidence, version, matched}
  for (const rec of compiled) {
    const m = matchRecord(rec, signals);
    if (m.confidence <= 0) continue;
    hits.set(rec.name, { rec, confidence: m.confidence, version: m.version, matched: m.matched });
  }

  // implies — additive pass; cap confidence at the implier's, then
  // multiply by implication confidence/100.
  for (const [_name, h] of [...hits]) {
    for (const imp of h.rec.implies) {
      if (!hits.has(imp.name)) {
        // Look up the implied tech's record for cats/icon/website.
        const impRec = compiled.find((r) => r.name === imp.name);
        if (!impRec) continue;
        hits.set(imp.name, {
          rec: impRec,
          confidence: Math.round((h.confidence * imp.confidence) / 100),
          version: "",
          matched: [{ group: "implied", hits: [`<- ${h.rec.name}`] }],
        });
      }
    }
  }

  // requires — drop techs whose every requirement isn't present.
  for (const [name, h] of [...hits]) {
    for (const req of h.rec.requires) {
      if (!hits.has(req)) { hits.delete(name); break; }
    }
  }

  // excludes — drop techs that a present tech excludes.
  for (const [_name, h] of [...hits]) {
    for (const ex of h.rec.excludes) {
      hits.delete(ex);
    }
  }

  return [...hits.values()].map((h) => ({
    name:       h.rec.name,
    cats:       h.rec.cats,
    confidence: h.confidence,
    version:    h.version,
    icon:       h.rec.icon,
    website:    h.rec.website,
    matched:    h.matched,
  }));
}

// scrapeSignals — page-side function used by chrome.scripting.executeScript
// to harvest html / scripts / meta / cookies / jsGlobals from the live
// document. Stays self-contained (no closures) because executeScript
// serializes it. Header signals must come from the SW's webRequest
// listener — content scripts can't read response headers directly.
export function scrapeSignals(jsLookups) {
  function safeAt(path) {
    try {
      let cur = window;
      for (const part of String(path).split(".")) {
        cur = cur[part];
        if (cur == null) return null;
      }
      return cur;
    } catch { return null; }
  }
  const html = document.documentElement?.outerHTML || "";
  const scripts = [...document.querySelectorAll("script[src]")].map((s) => s.src).filter(Boolean);
  const meta = {};
  for (const el of document.querySelectorAll("meta[name], meta[property], meta[http-equiv]")) {
    const k = (el.getAttribute("name") || el.getAttribute("property") || el.getAttribute("http-equiv") || "").toLowerCase();
    const v = el.getAttribute("content") || "";
    if (k) meta[k] = v;
  }
  const cookies = {};
  for (const c of String(document.cookie || "").split("; ")) {
    if (!c) continue;
    const eq = c.indexOf("=");
    if (eq < 0) continue;
    cookies[c.slice(0, eq).toLowerCase()] = c.slice(eq + 1);
  }
  const jsGlobals = {};
  for (const path of Array.isArray(jsLookups) ? jsLookups : []) {
    const v = safeAt(path);
    if (v != null) jsGlobals[path] = (typeof v === "object") ? "[object]" : String(v);
  }
  return { html, scripts, meta, cookies, jsGlobals, url: location.href };
}
