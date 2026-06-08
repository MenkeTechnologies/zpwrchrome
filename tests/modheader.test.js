// Unit tests for lib/modheader.js — pure projection of a ModHeader state
// bag into chrome.declarativeNetRequest dynamic rules. Chrome-free, runs
// under plain node --test.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDnrRules,
  defaultModheaderState,
  MODHEADER_RULE_BASE,
  MODHEADER_RULE_CAP,
  MODHEADER_ALL_RT,
} from "../lib/modheader.js";

function mkState(rules, { enabled = true, activeProfileId = "p1" } = {}) {
  return {
    enabled,
    activeProfileId,
    profiles: [{ id: "p1", name: "P1", color: "#05d9e8", rules }],
  };
}

test("defaultModheaderState: returns a single empty profile, disabled", () => {
  const s = defaultModheaderState();
  assert.equal(s.enabled, false);
  assert.equal(s.profiles.length, 1);
  assert.equal(s.profiles[0].rules.length, 0);
  assert.equal(s.activeProfileId, s.profiles[0].id);
});

test("buildDnrRules: empty when state.enabled is false", () => {
  const r = buildDnrRules(mkState([{ id: "r1", enabled: true, kind: "request", name: "X", value: "1" }], { enabled: false }));
  assert.deepEqual(r, []);
});

test("buildDnrRules: empty when active profile missing", () => {
  const r = buildDnrRules(mkState([{ id: "r1", enabled: true, kind: "request", name: "X", value: "1" }], { activeProfileId: "doesnt-exist" }));
  assert.deepEqual(r, []);
});

test("buildDnrRules: skips disabled rules", () => {
  const r = buildDnrRules(mkState([
    { id: "r1", enabled: false, kind: "request", name: "X", value: "1" },
    { id: "r2", enabled: true,  kind: "request", name: "Y", value: "2" },
  ]));
  assert.equal(r.length, 1);
  assert.equal(r[0].action.requestHeaders[0].header, "y");
});

test("buildDnrRules: request header set", () => {
  const r = buildDnrRules(mkState([
    { id: "r1", enabled: true, kind: "request", name: "X-Token", value: "abc", operation: "set" },
  ]))[0];
  assert.equal(r.id, MODHEADER_RULE_BASE);
  assert.equal(r.action.type, "modifyHeaders");
  assert.deepEqual(r.action.requestHeaders, [{ header: "x-token", operation: "set", value: "abc" }]);
  assert.equal(r.condition.urlFilter, "*");
  assert.deepEqual(r.condition.resourceTypes, [...MODHEADER_ALL_RT]);
});

test("buildDnrRules: request header append + remove operations", () => {
  const r = buildDnrRules(mkState([
    { id: "r1", enabled: true, kind: "request", name: "Cookie", value: "x=1", operation: "append" },
    { id: "r2", enabled: true, kind: "request", name: "Origin", value: "",    operation: "remove" },
  ]));
  assert.deepEqual(r[0].action.requestHeaders, [{ header: "cookie", operation: "append", value: "x=1" }]);
  // 'remove' must NOT carry a value (DNR rejects it).
  assert.deepEqual(r[1].action.requestHeaders, [{ header: "origin", operation: "remove" }]);
});

test("buildDnrRules: response header goes to responseHeaders, not requestHeaders", () => {
  const r = buildDnrRules(mkState([
    { id: "r1", enabled: true, kind: "response", name: "X-Frame-Options", value: "ALLOWALL", operation: "set" },
  ]))[0];
  assert.deepEqual(r.action.responseHeaders, [{ header: "x-frame-options", operation: "set", value: "ALLOWALL" }]);
  assert.equal(r.action.requestHeaders, undefined);
});

test("buildDnrRules: redirect uses action.redirect.url + main+sub frame resourceTypes", () => {
  const r = buildDnrRules(mkState([
    { id: "r1", enabled: true, kind: "redirect", value: "https://example.com/", urlFilter: "https://old.example.com/*" },
  ]))[0];
  assert.equal(r.action.type, "redirect");
  assert.equal(r.action.redirect.url, "https://example.com/");
  assert.equal(r.condition.urlFilter, "https://old.example.com/*");
  assert.deepEqual(r.condition.resourceTypes, ["main_frame", "sub_frame"]);
});

test("buildDnrRules: drops rules with empty header name or empty redirect URL", () => {
  const r = buildDnrRules(mkState([
    { id: "r1", enabled: true, kind: "request",  name: "",  value: "x" },
    { id: "r2", enabled: true, kind: "redirect", value: "" },
    { id: "r3", enabled: true, kind: "request",  name: "X", value: "y" },
  ]));
  assert.equal(r.length, 1);
  assert.equal(r[0].action.requestHeaders[0].header, "x");
});

test("buildDnrRules: assigns ascending IDs starting at MODHEADER_RULE_BASE", () => {
  const rules = Array.from({ length: 5 }, (_, i) => ({
    id: `r${i}`, enabled: true, kind: "request", name: `H${i}`, value: String(i),
  }));
  const r = buildDnrRules(mkState(rules));
  assert.equal(r.length, 5);
  for (let i = 0; i < 5; i++) assert.equal(r[i].id, MODHEADER_RULE_BASE + i);
});

test("buildDnrRules: caps at MODHEADER_RULE_CAP", () => {
  const rules = Array.from({ length: MODHEADER_RULE_CAP + 5 }, (_, i) => ({
    id: `r${i}`, enabled: true, kind: "request", name: "H", value: String(i),
  }));
  const r = buildDnrRules(mkState(rules));
  assert.equal(r.length, MODHEADER_RULE_CAP);
});

test("buildDnrRules: defaults urlFilter to '*' when blank or whitespace", () => {
  const r = buildDnrRules(mkState([
    { id: "r1", enabled: true, kind: "request", name: "X", value: "1", urlFilter: "" },
    { id: "r2", enabled: true, kind: "request", name: "Y", value: "2", urlFilter: "   " },
    { id: "r3", enabled: true, kind: "request", name: "Z", value: "3", urlFilter: " *://api.example.com/* " },
  ]));
  assert.equal(r[0].condition.urlFilter, "*");
  assert.equal(r[1].condition.urlFilter, "*");
  assert.equal(r[2].condition.urlFilter, "*://api.example.com/*");
});

test("buildDnrRules: only active profile contributes — second profile ignored", () => {
  const state = {
    enabled: true,
    activeProfileId: "p1",
    profiles: [
      { id: "p1", name: "P1", color: "#05d9e8", rules: [
        { id: "r1", enabled: true, kind: "request", name: "Active", value: "yes" },
      ]},
      { id: "p2", name: "P2", color: "#ff2a6d", rules: [
        { id: "r2", enabled: true, kind: "request", name: "Inactive", value: "no" },
      ]},
    ],
  };
  const r = buildDnrRules(state);
  assert.equal(r.length, 1);
  assert.equal(r[0].action.requestHeaders[0].header, "active");
});
