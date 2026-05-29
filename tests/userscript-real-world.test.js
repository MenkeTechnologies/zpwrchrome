// Realistic Tampermonkey-style userscript metadata blocks. Each test parses
// a representative header that exercises a different real-world directive
// pattern and asserts the parser produces the documented shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetadata, validateUserscript, RUN_AT_VALUES } from "../lib/userscript.js";

test("real-world: Tampermonkey default template parses with every standard field", () => {
  const src = `// ==UserScript==
// @name         New Userscript
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://*.example.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=example.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
})();
`;
  const meta = parseMetadata(src);
  assert.equal(meta.name, "New Userscript");
  assert.equal(meta.namespace, "http://tampermonkey.net/");
  assert.equal(meta.version, "0.1");
  assert.equal(meta.description, "try to take over the world!");
  assert.equal(meta.author, "You");
  assert.equal(meta.icon, "https://www.google.com/s2/favicons?sz=64&domain=example.com");
  assert.deepEqual(meta.matches, ["https://*.example.com/*"]);
  assert.deepEqual(meta.grants, ["none"]);
  assert.equal(meta.runAt, "document-idle");
});

test("real-world: multi-grant + GM.* + GM_* mix is preserved", () => {
  const src = `// ==UserScript==
// @name        big-script
// @match       https://*.example.com/*
// @grant       GM.setValue
// @grant       GM.getValue
// @grant       GM_xmlhttpRequest
// @grant       GM_setClipboard
// @grant       unsafeWindow
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.deepEqual(meta.grants, [
    "GM.setValue",
    "GM.getValue",
    "GM_xmlhttpRequest",
    "GM_setClipboard",
    "unsafeWindow",
  ]);
});

test("real-world: multi-@match with mixed schemes parses each entry independently", () => {
  const src = `// ==UserScript==
// @name        multi-match
// @match       https://*.github.com/*
// @match       https://*.gitlab.com/*
// @match       https://*.bitbucket.org/*
// @match       http://localhost/*
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.equal(meta.matches.length, 4);
  assert.equal(meta.matches[3], "http://localhost/*");
});

test("real-world: @require jQuery from CDN is captured into requires", () => {
  const src = `// ==UserScript==
// @name        jq-script
// @match       https://x.test/*
// @require     https://code.jquery.com/jquery-3.6.0.min.js
// @require     https://cdn.example.com/util.min.js
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.deepEqual(meta.requires, [
    "https://code.jquery.com/jquery-3.6.0.min.js",
    "https://cdn.example.com/util.min.js",
  ]);
});

test("real-world: @resource with key + URL pair lands as one array entry", () => {
  const src = `// ==UserScript==
// @name        res
// @match       https://x.test/*
// @resource    css https://cdn.example.com/style.css
// @resource    json https://cdn.example.com/data.json
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.deepEqual(meta.resources, [
    "css https://cdn.example.com/style.css",
    "json https://cdn.example.com/data.json",
  ]);
});

test("real-world: @icon as data: URL is preserved verbatim", () => {
  const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAA0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
  const src = `// ==UserScript==
// @name   data-icon
// @match  https://x.test/*
// @icon   ${tiny}
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.equal(meta.icon, tiny);
});

test("real-world: @run-at document-start is recognized as valid runAt", () => {
  const src = `// ==UserScript==
// @name      early
// @match     https://x.test/*
// @run-at    document-start
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.equal(meta.runAt, "document-start");
  assert.ok(RUN_AT_VALUES.has(meta.runAt));
});

test("real-world: @exclude patterns are collected separately from @include", () => {
  const src = `// ==UserScript==
// @name      scoped
// @include   https://*.example.com/*
// @exclude   https://*.example.com/admin/*
// @exclude   https://*.example.com/private/*
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.deepEqual(meta.includes, ["https://*.example.com/*"]);
  assert.deepEqual(meta.excludes, [
    "https://*.example.com/admin/*",
    "https://*.example.com/private/*",
  ]);
});

test("real-world: validateUserscript accepts the Tampermonkey default template", () => {
  const src = `// ==UserScript==
// @name         valid
// @match        https://*.example.com/*
// @grant        none
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.deepEqual(validateUserscript(meta), []);
});

test("real-world: validateUserscript rejects header with only @description (no name/match)", () => {
  const src = `// ==UserScript==
// @description does nothing useful
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  const errors = validateUserscript(meta);
  assert.ok(errors.some((e) => e.includes("missing @name")));
  assert.ok(errors.some((e) => /missing @match/.test(e)));
});

test("real-world: @connect for cross-origin requests is preserved in raw map", () => {
  const src = `// ==UserScript==
// @name     fetch-script
// @match    https://x.test/*
// @grant    GM_xmlhttpRequest
// @connect  api.example.com
// @connect  cdn.example.com
// @connect  *
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.deepEqual(meta.raw.connect, ["api.example.com", "cdn.example.com", "*"]);
});

test("real-world: typical block with comments between directives parses cleanly", () => {
  const src = `// ==UserScript==
// @name        commented
// @namespace   https://example.com/
// Comment line — should be ignored
// @match       https://*.example.com/*
// More commentary
// @grant       GM.setValue
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.equal(meta.name, "commented");
  assert.deepEqual(meta.matches, ["https://*.example.com/*"]);
  assert.deepEqual(meta.grants, ["GM.setValue"]);
});

test("real-world: invalid @run-at falls back to document-idle without crashing", () => {
  const src = `// ==UserScript==
// @name      bad-runat
// @match     https://x.test/*
// @run-at    document-on-mars
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.equal(meta.runAt, "document-idle");
});

test("real-world: @run-at document_start (underscore variant) normalizes to dash form", () => {
  const src = `// ==UserScript==
// @name      underscore
// @match     https://x.test/*
// @run-at    document_start
// ==/UserScript==
`;
  const meta = parseMetadata(src);
  assert.equal(meta.runAt, "document-start");
});
