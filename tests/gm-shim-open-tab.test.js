// GM.openInTab and GM.addElement behavior in lib/gm-shim.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GM_SHIM_SOURCE } from "../lib/gm-shim.js";

test("GM.openInTab passes insert flag defaulting to true in payload", () => {
  assert.match(GM_SHIM_SOURCE, /active: o\.active !== false, insert: o\.insert !== false/);
});

test("GM.openInTab resolves to tabId from response object", () => {
  assert.match(GM_SHIM_SOURCE, /openInTab[\s\S]*?\.then\(\(r\) => r\?\.tabId\)/);
});

test("GM.openInTab boolean opts means background tab when true passed", () => {
  assert.match(GM_SHIM_SOURCE, /typeof opts === "boolean" \? \{ active: !opts \}/);
});

test("GM.addElement string overload uses document.head as parent", () => {
  assert.match(GM_SHIM_SOURCE, /parent = document\.head \|\| document\.documentElement/);
});

test("GM.addElement sets textContent attribute specially without setAttribute", () => {
  assert.match(GM_SHIM_SOURCE, /if \(k === "textContent"\) el\.textContent = v/);
  assert.match(GM_SHIM_SOURCE, /else el\.setAttribute\(k, v\)/);
});

test("GM.addElement returns created element to caller", () => {
  assert.match(GM_SHIM_SOURCE, /parent\.appendChild\(el\)[\s\S]*?return el/);
});

test("GM.listValues returns empty array when response not ok", () => {
  assert.match(GM_SHIM_SOURCE, /listValues[\s\S]*?r && r\.ok \? r\.keys : \[\]/);
});

test("GM.deleteValue sends script id from GM_info in payload", () => {
  assert.match(GM_SHIM_SOURCE, /deleteValue[\s\S]*?script: GM_info\.script\.id, key/);
});

test("GM.setValue resolves to undefined after successful write", () => {
  assert.match(GM_SHIM_SOURCE, /setValue[\s\S]*?\.then\(\(\) => undefined\)/);
});

test("GM.getValue uses gm:getValue kind prefix in sendMessage", () => {
  assert.match(GM_SHIM_SOURCE, /kind: "gm:" \+ kind/);
});

test("GM.info alias points at GM_info constant", () => {
  assert.match(GM_SHIM_SOURCE, /info: GM_info,/);
});

test("GM_addElement alias references GM.addElement", () => {
  assert.match(GM_SHIM_SOURCE, /const GM_addElement\s*=\s*GM\.addElement/);
});
