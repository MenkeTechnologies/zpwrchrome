// Userscript metadata parser. Pure ES module — testable in node.
//
// Recognises the standard Greasemonkey / Tampermonkey directive block:
//
//   // ==UserScript==
//   // @name        My script
//   // @namespace   https://example.com
//   // @version     1.0
//   // @match       https://*.example.com/*
//   // @include     https://other.example.com/page
//   // @exclude     https://*.example.com/admin/*
//   // @run-at      document-idle
//   // @grant       GM.setValue
//   // @description Does a thing
//   // @author      MenkeTechnologies
//   // @icon        https://example.com/icon.png
//   // ==/UserScript==

export const RUN_AT_VALUES = new Set(["document-start", "document-end", "document-idle"]);

const HEADER_RE = /\/\/\s*==UserScript==\s*\n([\s\S]*?)\/\/\s*==\/UserScript==/;
const LINE_RE   = /^\/\/\s*@([\w-]+)\s+(.+?)\s*$/;

const ARRAY_KEYS = new Set(["match", "include", "exclude", "grant", "require", "resource", "connect"]);

export function parseMetadata(src) {
  const out = {
    name: "",
    namespace: "",
    version: "",
    description: "",
    author: "",
    icon: "",
    runAt: "document-idle",
    matches: [],
    includes: [],
    excludes: [],
    grants: [],
    requires: [],
    resources: [],
    raw: {}
  };

  const block = src.match(HEADER_RE);
  if (!block) return null;

  for (const rawLine of block[1].split("\n")) {
    const m = rawLine.match(LINE_RE);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2];
    if (ARRAY_KEYS.has(key)) {
      (out.raw[key] = out.raw[key] || []).push(value);
    } else {
      out.raw[key] = value;
    }
  }

  out.name        = out.raw.name        || "";
  out.namespace   = out.raw.namespace   || "";
  out.version     = out.raw.version     || "";
  out.description = out.raw.description || "";
  out.author      = out.raw.author      || "";
  out.icon        = out.raw.icon        || out.raw.iconurl || "";
  out.matches     = out.raw.match    || [];
  out.includes    = out.raw.include  || [];
  out.excludes    = out.raw.exclude  || [];
  out.grants      = out.raw.grant    || [];
  out.requires    = out.raw.require  || [];
  out.resources   = out.raw.resource || [];

  let runAt = (out.raw["run-at"] || "document-idle").toLowerCase();
  // Tampermonkey accepts document_start with underscores; normalize to dash.
  runAt = runAt.replace(/_/g, "-");
  if (!RUN_AT_VALUES.has(runAt)) runAt = "document-idle";
  out.runAt = runAt;

  return out;
}

// Convert a Greasemonkey @include pattern (globbed URL) to a Chrome match
// pattern. @include is more flexible than match patterns; we approximate.
// Returns null if the input can't be safely converted.
export function includeToMatchPattern(include) {
  if (typeof include !== "string" || !include) return null;
  // "*" alone → all URLs (Tampermonkey convention)
  if (include === "*") return "<all_urls>";
  // Match patterns already valid (scheme://host/path with * or specific)
  if (/^[a-z*]+:\/\/[^/]*\/.*/i.test(include)) {
    // Heuristic: looks like a match pattern. Accept as-is.
    return include;
  }
  // URL with no path → append /*
  if (/^[a-z*]+:\/\/[^/]+$/i.test(include)) return include + "/*";
  return null;
}

// Verify a candidate Chrome match pattern. Chrome's spec:
//   <scheme>://<host>/<path>
//   <scheme> is one of: *, http, https, file, ftp, urn (or <all_urls>)
//   <host> may start with *. and contain literal label after, or be *
//   <path> must start with /
export function isValidMatchPattern(p) {
  if (p === "<all_urls>") return true;
  const m = p.match(/^(\*|http|https|file|ftp|urn):\/\/(\*|(?:\*\.)?[^/*]+|)(\/.*)$/);
  return !!m;
}

// Quick syntactic check that a userscript has the minimum to be runnable.
export function validateUserscript(meta) {
  const errors = [];
  if (!meta) return ["no ==UserScript== block found"];
  if (!meta.name) errors.push("missing @name");
  if (meta.matches.length === 0 && meta.includes.length === 0) {
    errors.push("missing @match or @include");
  }
  for (const p of meta.matches) {
    if (!isValidMatchPattern(p)) errors.push(`invalid @match pattern: ${p}`);
  }
  return errors;
}

// Convert a Chrome match pattern (or "<all_urls>") into a RegExp. Returns
// null for malformed patterns. Used by the no-dev-mode fallback path which
// has to match URLs in JS rather than letting Chrome do it.
const RE_ESC = /[.+?^${}()|[\]\\]/g;
function escapeRegex(s) { return s.replace(RE_ESC, "\\$&"); }

export function matchPatternToRegex(pattern) {
  if (pattern === "<all_urls>") return /^(https?|file|ftp):\/\/.+/i;
  const m = pattern.match(/^(\*|http|https|file|ftp|urn):\/\/(\*|(?:\*\.)?[^/*]+|)(\/.*)$/);
  if (!m) return null;
  // Per Chrome's match-pattern spec, "*" in scheme means http|https only —
  // not file or ftp (those must be named explicitly).
  const scheme = m[1] === "*" ? "https?" : m[1];
  let host;
  if (m[2] === "*")               host = "[^/]+";
  else if (m[2].startsWith("*.")) host = "(?:[^/.]+\\.)*" + escapeRegex(m[2].slice(2));
  else                             host = escapeRegex(m[2]);
  const path = m[3].split("*").map(escapeRegex).join(".*");
  return new RegExp("^" + scheme + "://" + host + path + "$", "i");
}

export function matchUrl(patterns, url) {
  if (!Array.isArray(patterns)) return false;
  for (const p of patterns) {
    const re = matchPatternToRegex(p);
    if (re && re.test(url)) return true;
  }
  return false;
}

// Produce a stable id from name + namespace for chrome.userScripts.register.
export function userscriptId(meta) {
  const base = `${meta.namespace || ""}::${meta.name || ""}`;
  // chrome.userScripts.register requires ids match [A-Za-z0-9_-]+
  return ("us_" + base).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}
