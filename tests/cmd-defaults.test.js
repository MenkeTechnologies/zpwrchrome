// lib/cmd-defaults.js — the default ⌘K custom-command registry and its seeder.
// The seeder runs on every page load and merges in defaults the user neither
// has nor deleted, so a regression here either resurrects commands the user
// removed or clobbers their own entries. Runs against a fake chrome.storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "cmd-defaults.js"), "utf8");
const paletteSrc = readFileSync(join(here, "..", "lib", "palette-cmds.js"), "utf8");

// Fake chrome.storage.local with an inspectable store + write log. `failGet` /
// `failSet` make the respective call throw synchronously.
function load({ store = {}, failGet = false, failSet = false } = {}) {
  const writes = [];
  const chrome = {
    runtime: { lastError: undefined },
    storage: {
      local: {
        get(keys, cb) {
          if (failGet) throw new Error("no storage");
          const o = {};
          for (const k of keys) if (k in store) o[k] = store[k];
          cb(o);
        },
        set(obj, cb) {
          if (failSet) throw new Error("quota");
          writes.push(obj);
          Object.assign(store, obj);
          cb();
        },
      },
    },
  };
  const ctx = { chrome };
  ctx.self = ctx;
  vm.runInNewContext(src, ctx);
  const seed = () => new Promise((res) => ctx.zwireSeedCmds(res));
  return { D: ctx.ZWIRE_CMD_DEFAULTS, seed, store, writes };
}

test("defaults: ids are unique, def- prefixed, and keywords are unique", () => {
  const { D } = load();
  const ids = D.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate default id");
  assert.ok(ids.every((id) => /^def-[a-z0-9]+$/.test(id)));
  const kws = D.map((c) => c.keyword.toLowerCase());
  const dup = [...kws.filter((k, i) => kws.indexOf(k) !== i)];
  assert.deepEqual(dup, [], "two defaults on one keyword both pin to the top of the palette");
  assert.ok(kws.every((k) => k && !/\s/.test(k)), "a keyword with a space can never match (the palette splits on the first space)");
});

test("defaults: url commands are https URLs; {q} survives the palette's encode-and-substitute", () => {
  const { D } = load();
  for (const c of D.filter((x) => x.type === "url")) {
    const filled = c.value.replace(/\{q\}/g, encodeURIComponent("a b&c"));
    const u = new URL(filled);
    assert.equal(u.protocol, "https:", c.id);
    if (c.value.includes("{q}")) assert.ok(filled.includes("a%20b%26c"), c.id);
  }
});

test("defaults: action commands name an action the palette dispatches", () => {
  const { D } = load();
  const known = new Set(["reload", "copyUrl", "cycleScheme"]);
  for (const c of D.filter((x) => x.type === "action")) assert.ok(known.has(c.value), `${c.id}: ${c.value}`);
  assert.ok(D.every((c) => c.type === "url" || c.type === "action"));
});

test("defaults: every one is recognised as a default by the shared palette source", () => {
  const { D } = load();
  const root = {};
  // eslint-disable-next-line no-new-func
  new Function(paletteSrc).call(root);
  const PC = root.ZWIRE_PALETTE_CMDS;
  const rows = PC.makeCustomItems(D, { runCustom() {} });
  assert.ok(rows.every((r) => r.user === false), "defaults must not rank in the user tier");
});

test("seed: first run writes every default once", async () => {
  const { D, seed, store, writes } = load();
  const list = await seed();
  assert.equal(writes.length, 1);
  assert.deepEqual(list.map((c) => c.id), D.map((c) => c.id));
  assert.deepEqual(store.zb_custom_cmds, list);
});

test("seed: is idempotent — a second load writes nothing", async () => {
  const env = load();
  await env.seed();
  const again = await env.seed();
  assert.equal(env.writes.length, 1);
  assert.equal(again.length, env.D.length);
});

test("seed: user entries keep their order and come first; same-id user edits win", async () => {
  const mine = { id: "u-1", label: "Mine", keyword: "mm", type: "url", value: "https://example.com/{q}" };
  const edited = { id: "def-github", label: "My GitHub", keyword: "ghx", type: "url", value: "https://example.com" };
  const { D, seed } = load({ store: { zb_custom_cmds: [mine, edited] } });
  const list = await seed();
  assert.deepEqual(list.slice(0, 2), [mine, edited]);
  assert.equal(list.filter((c) => c.id === "def-github").length, 1, "the edited default is not re-added");
  assert.equal(list.length, D.length + 1);
});

test("seed: defaults the user deleted are never resurrected", async () => {
  const { D, seed } = load({ store: { zb_cmds_removed: ["def-chatgpt", "def-scheme", "not-a-default"] } });
  const list = await seed();
  const ids = new Set(list.map((c) => c.id));
  assert.ok(!ids.has("def-chatgpt"));
  assert.ok(!ids.has("def-scheme"));
  assert.equal(list.length, D.length - 2);
});

test("seed: everything present or removed → no write, current list returned as-is", async () => {
  const { D } = load();
  const half = D.slice(0, 10);
  const removed = D.slice(10).map((c) => c.id);
  const env = load({ store: { zb_custom_cmds: half, zb_cmds_removed: removed } });
  const list = await env.seed();
  assert.equal(env.writes.length, 0);
  assert.equal(list, env.store.zb_custom_cmds);
});

test("seed: tolerates junk entries in the stored list", async () => {
  const { D, seed } = load({ store: { zb_custom_cmds: [null, { label: "no id" }, 7] } });
  const list = await seed();
  assert.equal(list.length, 3 + D.length);
});

test("seed: a throwing storage.set still hands back the merged list", async () => {
  const { D, seed } = load({ failSet: true });
  const list = await seed();
  assert.equal(list.length, D.length);
});

test("seed: no storage at all falls back to a COPY of the defaults", async () => {
  const { D, seed } = load({ failGet: true });
  const list = await seed();
  assert.deepEqual(list, D);
  assert.notEqual(list, D, "callers may mutate the result; the registry must stay intact");
});
