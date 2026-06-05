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
    // Upstream renamed `scripts` → `scriptSrc` mid-corpus; both still
    // appear in real fingerprints. We merge them into one matcher set.
    const scripts  = [...arr(def.scripts), ...arr(def.scriptSrc)].map(parsePattern);
    const text     = arr(def.text).map(parsePattern);
    const url      = arr(def.url).map(parsePattern);
    const meta     = kvArr(def.meta,    /*lower=*/true);   // [ {key, patterns:[…]} ]
    const headers  = kvArr(def.headers, /*lower=*/true);
    const cookies  = kvArr(def.cookies, /*lower=*/false);  // RFC 6265 — case-sensitive
    const js       = kvArr(def.js,      /*lower=*/false);  // JS identifier paths
    const dom      = parseDomRules(def.dom);            // [{ selector, kind, attr?, attrPattern?, ... }]
    const implies  = arr(def.implies).map(parseImplies);
    const requires = arr(def.requires);
    const excludes = arr(def.excludes);
    out.push({
      name, cats, html, scripts, text, url, meta, headers, cookies, js,
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

// Normalize the upstream's polymorphic `dom` field into a flat rule list.
// Shapes seen in the wild:
//   "selector"                         → { selector, kind: "exists" }
//   ["sel1", "sel2"]                   → two exists rules
//   { sel: { exists: "" } }            → exists rule
//   { sel: { attributes: { x: "p" } } } → attr-pattern rule
//   { sel: { text: "p" } }             → text-content rule
//   { sel: { properties: { x: "p" } }} → DOM-property-pattern rule
// We harvest selectors so the page-side probe can pre-flight them all
// at once with one querySelector pass.
function parseDomRules(raw) {
  if (raw == null) return [];
  if (typeof raw === "string") return [{ selector: raw, kind: "exists" }];
  if (Array.isArray(raw)) {
    const out = [];
    for (const v of raw) out.push(...parseDomRules(v));
    return out;
  }
  if (typeof raw === "object") {
    const out = [];
    for (const [selector, spec] of Object.entries(raw)) {
      if (spec === "" || spec == null) {
        out.push({ selector, kind: "exists" });
        continue;
      }
      if (typeof spec === "string") {
        // Shorthand: { sel: "regex" } → exists + text regex
        out.push({ selector, kind: "text", textPattern: parsePattern(spec) });
        continue;
      }
      if (typeof spec === "object") {
        if (spec.exists !== undefined) out.push({ selector, kind: "exists" });
        if (spec.text)
          out.push({ selector, kind: "text", textPattern: parsePattern(spec.text) });
        if (spec.attributes) {
          for (const [attr, pat] of Object.entries(spec.attributes)) {
            out.push({ selector, kind: "attribute", attr, attrPattern: parsePattern(pat) });
          }
        }
        if (spec.properties) {
          for (const [prop, pat] of Object.entries(spec.properties)) {
            out.push({ selector, kind: "property", prop, propPattern: parsePattern(pat) });
          }
        }
      }
    }
    return out;
  }
  return [];
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
  // text — search the rendered text (innerText)
  if (rec.text.length && signals.text) {
    const hits = rec.text.map((p) => tryOne(p, signals.text)).filter(Boolean);
    tally("text", hits);
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
  // dom — page-side probe pre-computes which selectors / attribute /
  // text / property rules matched and ships back as signals.dom: a
  // Set-like object keyed by `${selector}|${kind}|${attr/prop/""}`.
  if (rec.dom.length && signals.dom) {
    const hits = [];
    for (const rule of rec.dom) {
      const key = `${rule.selector}|${rule.kind}|${rule.attr || rule.prop || ""}`;
      const found = signals.dom[key];
      if (!found) continue;
      // For text/attribute/property rules, the probe returns the value;
      // run the pattern against it.
      if (rule.kind === "exists") {
        hits.push({ p: { confidence: 100, version: "", source: rule.selector }, version: "" });
      } else if (rule.textPattern && rule.textPattern.re) {
        const m = String(found).match(rule.textPattern.re);
        if (m) hits.push({ p: rule.textPattern, version: resolveVersion(rule.textPattern.version, m) });
      } else if (rule.attrPattern && rule.attrPattern.re) {
        const m = String(found).match(rule.attrPattern.re);
        if (m) hits.push({ p: rule.attrPattern, version: resolveVersion(rule.attrPattern.version, m) });
      } else if (rule.propPattern && rule.propPattern.re) {
        const m = String(found).match(rule.propPattern.re);
        if (m) hits.push({ p: rule.propPattern, version: resolveVersion(rule.propPattern.version, m) });
      }
    }
    tally("dom", hits);
  }

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
export function scrapeSignals(jsLookups, domRules) {
  function safeAt(path) {
    try {
      // Bracket-style segmenter — handles foo.bar, foo["bar-baz"],
      // foo[0].bar, foo['x'].y, all via one walker. The upstream JS
      // matcher format is dot-paths; we tolerate bracketed segments
      // because some fingerprints (core-js, Sentry, etc.) embed
      // hyphenated keys.
      let cur = window;
      const re = /\.?([^.\[\]]+)|\["([^"]+)"\]|\['([^']+)'\]|\[(\d+)\]/g;
      let m;
      while ((m = re.exec(String(path))) !== null) {
        const part = m[1] ?? m[2] ?? m[3] ?? m[4];
        if (!part) continue;
        cur = cur[part];
        if (cur == null) return null;
      }
      return cur;
    } catch { return null; }
  }
  const html = document.documentElement?.outerHTML || "";
  const text = document.body?.innerText || "";
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
  // dom probes — for each (selector, kind, attr|prop) rule, query the
  // page and emit the value the engine needs to test against. Keyed by
  // `${selector}|${kind}|${attr|prop|""}` so engine can O(1) lookup.
  const dom = {};
  for (const rule of (Array.isArray(domRules) ? domRules : [])) {
    try {
      const sel = String(rule.selector || "").trim();
      if (!sel) continue;
      const key = `${sel}|${rule.kind}|${rule.attr || rule.prop || ""}`;
      if (rule.kind === "exists") {
        if (document.querySelector(sel)) dom[key] = "1";
        continue;
      }
      const el = document.querySelector(sel);
      if (!el) continue;
      if      (rule.kind === "text")      dom[key] = el.textContent || "";
      else if (rule.kind === "attribute") dom[key] = el.getAttribute(rule.attr) || "";
      else if (rule.kind === "property") {
        try { dom[key] = el[rule.prop] != null ? String(el[rule.prop]) : ""; }
        catch { dom[key] = ""; }
      }
    } catch {}
  }

  return { html, text, scripts, meta, cookies, jsGlobals, dom, url: location.href };
}
