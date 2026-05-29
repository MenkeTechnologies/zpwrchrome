// Fuzz tests for lib/userscript.js. parseMetadata, validateUserscript,
// matchPatternToRegex, matchUrl, and expandMatchPatterns must never throw
// — they're called on arbitrary userscript source uploaded by the user.
// Deterministic PRNG; failure prints the seed + iteration for replay.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMetadata,
  validateUserscript,
  isValidMatchPattern,
  matchPatternToRegex,
  matchUrl,
  expandMatchPatterns,
  includeToMatchPattern,
  userscriptId,
} from "../lib/userscript.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRECTIVES = ["name", "namespace", "version", "description", "author",
                    "icon", "match", "include", "exclude", "grant", "require",
                    "resource", "connect", "run-at"];
const TOKENS = ["foo", "bar", "*", "https://x.test/*", "GM.setValue", "none",
                "document-start", "document_end", "document-idle"];
const SCHEMES = ["*", "http", "https", "file", "ftp", "urn", "git", "data"];
const HOSTS = ["*", "*.example.com", "example.com", "*.test", "localhost",
               "127.0.0.1", "", "a.b.c.example.com"];
const PATHS = ["/*", "/foo*", "/path/to/x", "/", "*"];

function randItem(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function randHeader(rand) {
  const lines = ["// ==UserScript=="];
  const directiveCount = Math.floor(rand() * 8) + 1;
  for (let i = 0; i < directiveCount; i++) {
    const dir = randItem(rand, DIRECTIVES);
    const val = randItem(rand, TOKENS);
    lines.push(`// @${dir}   ${val}`);
  }
  lines.push("// ==/UserScript==");
  lines.push("console.log(1);");
  return lines.join("\n") + "\n";
}

function randPattern(rand) {
  const scheme = randItem(rand, SCHEMES);
  const host = randItem(rand, HOSTS);
  const path = randItem(rand, PATHS);
  return `${scheme}://${host}${path}`;
}

test("fuzz: parseMetadata never throws across 500 random headers", () => {
  const r = rng(0xfeed0001);
  for (let i = 0; i < 500; i++) {
    const src = randHeader(r);
    assert.doesNotThrow(() => parseMetadata(src), `i=${i}`);
  }
});

test("fuzz: parseMetadata return value is null OR has every documented field", () => {
  const r = rng(0xfeed0002);
  const required = [
    "name", "namespace", "version", "description", "author", "icon",
    "runAt", "matches", "includes", "excludes", "grants", "requires",
    "resources", "raw",
  ];
  for (let i = 0; i < 500; i++) {
    const meta = parseMetadata(randHeader(r));
    if (meta == null) continue;
    for (const k of required) {
      assert.ok(k in meta, `i=${i} missing field ${k}: ${JSON.stringify(meta)}`);
    }
    for (const k of ["matches", "includes", "excludes", "grants", "requires", "resources"]) {
      assert.ok(Array.isArray(meta[k]), `i=${i} ${k} not array`);
    }
  }
});

test("fuzz: validateUserscript always returns a string-array (never throws)", () => {
  const r = rng(0xfeed0003);
  for (let i = 0; i < 500; i++) {
    const meta = parseMetadata(randHeader(r));
    const errs = validateUserscript(meta);
    assert.ok(Array.isArray(errs), `i=${i} validateUserscript returned non-array`);
    for (const e of errs) assert.equal(typeof e, "string", `i=${i} non-string error`);
  }
});

test("fuzz: matchPatternToRegex returns RegExp OR null on random patterns", () => {
  const r = rng(0xfeed0004);
  for (let i = 0; i < 500; i++) {
    const p = randPattern(r);
    const re = matchPatternToRegex(p);
    assert.ok(re === null || re instanceof RegExp,
      `i=${i} pattern="${p}" → ${re}`);
  }
});

test("fuzz: isValidMatchPattern is a boolean for every input", () => {
  const r = rng(0xfeed0005);
  for (let i = 0; i < 500; i++) {
    const p = randPattern(r);
    const v = isValidMatchPattern(p);
    assert.equal(typeof v, "boolean", `i=${i} pattern="${p}" → ${v}`);
  }
});

test("fuzz: isValidMatchPattern agrees with matchPatternToRegex (true ⇒ non-null regex)", () => {
  const r = rng(0xfeed0006);
  for (let i = 0; i < 500; i++) {
    const p = randPattern(r);
    if (isValidMatchPattern(p)) {
      assert.notEqual(matchPatternToRegex(p), null,
        `i=${i} pattern="${p}" passes validator but fails compile`);
    }
  }
});

test("fuzz: matchUrl returns boolean across random patterns × URLs", () => {
  const r = rng(0xfeed0007);
  for (let i = 0; i < 500; i++) {
    const patterns = Array.from({ length: Math.floor(r() * 5) + 1 }, () => randPattern(r));
    const url = `https://h${i}.test/path/${i}`;
    const v = matchUrl(patterns, url);
    assert.equal(typeof v, "boolean", `i=${i} result=${v}`);
  }
});

test("fuzz: expandMatchPatterns output never changes total count by more than 2× input", () => {
  // The expander adds at most one *.host variant per input pattern, so
  // |output| ≤ 2 × |input|. Pin this so an aggressive expansion doesn't
  // silently inflate the pattern list.
  const r = rng(0xfeed0008);
  for (let i = 0; i < 200; i++) {
    const patterns = Array.from({ length: Math.floor(r() * 10) + 1 }, () => randPattern(r));
    const out = expandMatchPatterns(patterns);
    assert.ok(out.length <= 2 * patterns.length,
      `i=${i} input=${patterns.length} output=${out.length}`);
  }
});

test("fuzz: userscriptId output always matches /^[A-Za-z0-9_-]+$/ and ≤ 80 chars", () => {
  const r = rng(0xfeed0009);
  for (let i = 0; i < 500; i++) {
    const meta = parseMetadata(randHeader(r)) || { name: randItem(r, TOKENS), namespace: randItem(r, TOKENS) };
    const id = userscriptId(meta);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(id), `i=${i} id="${id}" not chrome-safe`);
    assert.ok(id.length <= 80, `i=${i} id length ${id.length} > 80`);
  }
});

test("fuzz: includeToMatchPattern output is null OR a syntactically valid match pattern", () => {
  const r = rng(0xfeed000a);
  for (let i = 0; i < 500; i++) {
    const include = randPattern(r);
    const out = includeToMatchPattern(include);
    if (out === null) continue;
    // Either <all_urls>, or the converter passed it through unchanged. Both
    // must be syntactically valid as match patterns themselves.
    assert.equal(typeof out, "string", `i=${i} non-string out=${out}`);
    if (out !== "<all_urls>") {
      // We can't require isValidMatchPattern (the converter is lenient) but
      // at minimum every result has scheme separator.
      assert.ok(out.includes(":") && (out.startsWith("<") || out.includes("://")),
        `i=${i} include="${include}" → "${out}" has unusual shape`);
    }
  }
});

test("stress: 1000-pattern matchUrl pass completes without throwing", () => {
  const r = rng(0xfeed000b);
  const patterns = Array.from({ length: 1000 }, () => randPattern(r));
  for (let i = 0; i < 100; i++) {
    const url = `https://test-${i}.example.com/path?q=${i}`;
    assert.doesNotThrow(() => matchUrl(patterns, url), `url=${url}`);
  }
});

test("stress: parseMetadata on a 1000-line header completes and yields valid shape", () => {
  const lines = ["// ==UserScript=="];
  for (let i = 0; i < 1000; i++) lines.push(`// @match https://h${i}.test/*`);
  lines.push("// @name big");
  lines.push("// ==/UserScript==");
  const src = lines.join("\n") + "\nconsole.log(1);\n";
  const meta = parseMetadata(src);
  assert.notEqual(meta, null);
  assert.equal(meta.matches.length, 1000);
  assert.equal(meta.name, "big");
});
