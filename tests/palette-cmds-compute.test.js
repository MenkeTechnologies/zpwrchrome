// Behavioural pins for the inline-compute + provider logic of the SHARED
// command-palette source (lib/palette-cmds.js): the calc.rs / units.rs /
// numfmt.rs / currency.rs ports, the keyword search provider, the custom
// command provider, and the compute provider's dispatch order. The module keeps
// rate-table + stryke-cache state at file scope, so every test loads a fresh copy.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "palette-cmds.js"), "utf8");

function load() {
  const root = {};
  // eslint-disable-next-line no-new-func
  new Function(src).call(root);
  return root.ZWIRE_PALETTE_CMDS;
}

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} !~ ${b}`);

// ─── calcEval — recursive-descent arithmetic ───────────────────────
test("calcEval: precedence, parens, whitespace", () => {
  const { calcEval } = load();
  assert.equal(calcEval("1 + 2 * 3"), 7);
  assert.equal(calcEval("(1 + 2) * 3"), 9);
  assert.equal(calcEval("  10 - 4 - 3  "), 3, "subtraction is left-associative");
  assert.equal(calcEval("100 / 10 / 5"), 2, "division is left-associative");
  assert.equal(calcEval("7 % 4 * 2"), 6, "% binds with * and /");
  assert.equal(calcEval("((((2))))"), 2);
});

test("calcEval: ^ is right-associative and binds tighter than *", () => {
  const { calcEval } = load();
  assert.equal(calcEval("2^3^2"), 512);
  assert.equal(calcEval("2*3^2"), 18);
  assert.equal(calcEval("2^-1"), 0.5, "unary minus allowed in the exponent");
});

test("calcEval: unary chains and number literal forms", () => {
  const { calcEval } = load();
  assert.equal(calcEval("--3"), 3);
  assert.equal(calcEval("-+-3"), 3);
  assert.equal(calcEval(".5 + .25"), 0.75);
  assert.equal(calcEval("1e3 + 2E-2"), 1000.02);
  assert.equal(calcEval("1.5e+2"), 150);
});

test("calcEval: functions, constants, variables", () => {
  const { calcEval } = load();
  assert.equal(calcEval("sqrt(16) + abs(-2)"), 6);
  assert.equal(calcEval("log(1000)"), 3, "log is base 10");
  assert.equal(calcEval("ln(e)"), 1, "ln is natural log");
  assert.equal(calcEval("log2(1024)"), 10);
  assert.equal(calcEval("floor(2.7) + ceil(2.1) + round(2.5)"), 8);
  near(calcEval("sin(pi / 2)"), 1);
  assert.equal(calcEval("x * 2 + y", { x: 5, y: 1 }), 11);
});

test("calcEval: errors carry a message and are real Errors", () => {
  const { calcEval } = load();
  const cases = [
    ["1 / 0", /division by zero/],
    ["5 % 0", /modulo by zero/],
    ["(1 + 2", /expected `\)`/],
    ["sqrt(4", /after function argument/],
    ["foo(1)", /unknown function `foo`/],
    ["zz + 1", /unknown identifier `zz`/],
    ["1 +", /unexpected end/],
    ["", /unexpected end/],
    ["1 $ 2", /trailing input/],
    ["#", /unexpected character `#`/],
    [".", /invalid number/],
    ["10^400", /not finite/],
    ["ln(0)", /not finite/],
  ];
  for (const [expr, re] of cases) {
    assert.throws(() => calcEval(expr), (e) => e instanceof Error && re.test(e.message), `calcEval(${JSON.stringify(expr)})`);
  }
});

test("calcEval: a var named like a function only resolves without a call", () => {
  const { calcEval } = load();
  assert.equal(calcEval("sqrt", { sqrt: 9 }), 9);
  assert.equal(calcEval("sqrt(sqrt)", { sqrt: 9 }), 3);
  assert.throws(() => calcEval("toString"), /unknown identifier/, "prototype keys are not variables");
});

test("calcEval: non-ASCII input is rejected, not mis-indexed", () => {
  const { calcEval } = load();
  // Array.from splits by code point, so an astral char is ONE unexpected char.
  assert.throws(() => calcEval("1 + 😀"), /unexpected character `😀`/);
  assert.throws(() => calcEval("2 × 3"), /trailing input/);
});

// ─── fmtNum — format_result ────────────────────────────────────────
test("fmtNum: integers print bare, fractions trimmed to 10 places", () => {
  const { fmtNum } = load();
  assert.equal(fmtNum(42), "42");
  assert.equal(fmtNum(-7), "-7");
  assert.equal(fmtNum(0), "0");
  assert.equal(fmtNum(1.5), "1.5");
  assert.equal(fmtNum(0.1 + 0.2), "0.3", "float noise is hidden by the 10-place cap");
  assert.equal(fmtNum(1 / 3), "0.3333333333");
  assert.equal(fmtNum(2.50), "2.5");
});

test("fmtNum: the 1e15 integer cutoff switches to toFixed without losing digits", () => {
  const { fmtNum } = load();
  assert.equal(fmtNum(999999999999999), "999999999999999");
  assert.equal(fmtNum(1e15), "1000000000000000");
  assert.equal(fmtNum(1e20), "100000000000000000000", "trailing zeros of the integer part survive");
});

// ─── units ─────────────────────────────────────────────────────────
test("unitConvert: aliases resolve case-insensitively to canonical names", () => {
  const { unitConvert } = load();
  const r = unitConvert(1, " KM ", "Mi");
  assert.equal(r.from, "kilometers");
  assert.equal(r.to, "miles");
  near(r.result, 1000 / 1609.344);
  assert.equal(unitConvert(1, "gib", "mib").result, 1024);
  assert.equal(unitConvert(1, "kb", "bit").result, 8000);
  assert.equal(unitConvert(1, "week", "h").result, 168);
  near(unitConvert(180, "deg", "rad").result, Math.PI);
});

test("unitConvert: temperature is affine, not a factor", () => {
  const { unitConvert } = load();
  assert.equal(unitConvert(100, "c", "f").result, 212);
  assert.equal(unitConvert(-40, "f", "c").result, -40);
  near(unitConvert(0, "k", "c").result, -273.15);
  near(unitConvert(32, "°f", "kelvin").result, 273.15);
  assert.equal(unitConvert(25, "c", "c").result, 25);
});

test("unitConvert: unknown units and cross-dimension conversions throw", () => {
  const { unitConvert } = load();
  assert.throws(() => unitConvert(1, "parsec", "m"), /unknown unit `parsec`/);
  assert.throws(() => unitConvert(1, "m", "furlong"), /unknown unit `furlong`/);
  assert.throws(() => unitConvert(1, "kg", "m"), /cannot convert/);
  assert.throws(() => unitConvert(1, "c", "s"), /cannot convert/);
});

test("unitParseConvert: every connective and implicit value of 1", () => {
  const { unitParseConvert } = load();
  assert.equal(unitParseConvert("5 km to m").result, 5000);
  assert.equal(unitParseConvert("5 km in m").result, 5000);
  assert.equal(unitParseConvert("5 km as m").result, 5000);
  assert.equal(unitParseConvert("5 km -> m").result, 5000);
  assert.equal(unitParseConvert("5 km>m").result, 5000);
  assert.equal(unitParseConvert("10km to m").result, 10000, "number glued to the unit");
  assert.equal(unitParseConvert("km to m").value, 1, "bare unit means 1");
  assert.equal(unitParseConvert("1e3 m to km").result, 1);
  assert.equal(unitParseConvert("-40 C TO F").result, -40);
  near(unitParseConvert("100 km/h -> mph").result, 62.1371192, 1e-6);
});

test("unitParseConvert: ' to ' wins over ' in ' so the inch alias survives", () => {
  const { unitParseConvert } = load();
  const r = unitParseConvert("12 in to cm");
  assert.equal(r.from, "inches");
  near(r.result, 30.48);
});

test("unitParseConvert: malformed input throws", () => {
  const { unitParseConvert } = load();
  assert.throws(() => unitParseConvert("5 km"), /expected `<n> <from> to <to>`/);
  assert.throws(() => unitParseConvert("-- km to m"), /bad number/);
  assert.throws(() => unitParseConvert("5 km to"), /expected/, "a dangling connective is trimmed away");
  assert.throws(() => unitParseConvert("5 km to ?"), /unknown unit `\?`/);
});

// ─── percent ───────────────────────────────────────────────────────
test("percent: every supported form", () => {
  const { percent } = load();
  assert.deepEqual(percent("20% of 50"), { result: 10, formatted: "10", detail: "20% of 50 = 10" });
  assert.deepEqual(percent("10 of 50"), { result: 20, formatted: "20", detail: "10 is 20% of 50" });
  assert.deepEqual(percent("20% off 50"), { result: 40, formatted: "40", detail: "50 minus 20% = 40" });
  assert.equal(percent("50 to 75").detail, "50 → 75 is a +50% change");
  assert.equal(percent("80 to 60").detail, "80 → 60 is a -25% change");
  assert.equal(percent("100 + 10%").result, 110);
  assert.equal(percent("100 - 10%").result, 90);
  assert.equal(percent("1,000 + 10%").result, 1100, "thousands separators are stripped");
});

test("percent: a leading minus is a sign, not the operator", () => {
  const { percent } = load();
  assert.equal(percent("-100 - 10%").result, -90);
});

test("percent: degenerate inputs return null instead of NaN/Infinity", () => {
  const { percent } = load();
  assert.equal(percent("5 of 0"), null, "x is ?% of 0 is undefined");
  assert.equal(percent("0 to 5"), null, "change from 0 is undefined");
  assert.equal(percent("abc of 5"), null);
  assert.equal(percent("20% of"), null);
  assert.equal(percent("hello"), null);
  assert.equal(percent("5 + 5"), null, "+ without % is not a percentage");
  assert.equal(percent("1 of 2 of 3"), null, "ambiguous split is refused");
});

// ─── currency ──────────────────────────────────────────────────────
test("currencyParse: amount/from/to, case preserved, connectives", () => {
  const { currencyParse } = load();
  assert.deepEqual(currencyParse("100 usd to EUR"), { amount: 100, from: "usd", to: "EUR" });
  assert.deepEqual(currencyParse("2.5 GBP into JPY"), { amount: 2.5, from: "GBP", to: "JPY" });
  assert.deepEqual(currencyParse("7 CHF in USD"), { amount: 7, from: "CHF", to: "USD" });
  assert.deepEqual(currencyParse("7 CHF>USD"), { amount: 7, from: "CHF", to: "USD" });
  assert.equal(currencyParse("usd to eur"), null, "amount required");
  assert.equal(currencyParse("ten usd to eur"), null);
  assert.equal(currencyParse("100 usd"), null);
  assert.equal(currencyParse("100 usd to "), null);
});

test("currencyConvert: cross-rate through the base, guarded rates", () => {
  const PC = load();
  assert.throws(() => PC.currencyConvert(1, "USD", "EUR"), /no rate for `USD`/, "empty table before priming");
  PC.primeRates((cb) => cb({ rates: { USD: 1, EUR: 0.5, JPY: 150, ZZZ: 0 }, ts: 123 }));
  const r = PC.currencyConvert(10, " eur ", "jpy");
  assert.equal(r.from, "EUR");
  assert.equal(r.to, "JPY");
  assert.equal(r.rate, 300);
  assert.equal(r.result, 3000);
  assert.throws(() => PC.currencyConvert(1, "USD", "XXX"), /no rate for `XXX`/);
  assert.throws(() => PC.currencyConvert(1, "ZZZ", "USD"), /is zero/);
});

test("primeRates: ignores malformed payloads and survives a throwing refresh", () => {
  const PC = load();
  PC.primeRates("not a function");
  PC.primeRates((cb) => cb(null));
  PC.primeRates((cb) => cb({ rates: "nope" }));
  PC.primeRates(() => { throw new Error("host down"); });
  assert.throws(() => PC.currencyConvert(1, "USD", "USD"), /no rate/);
  let refreshed = 0;
  PC.primeRates((cb) => cb({ rates: { USD: 1 } }), () => { refreshed++; throw new Error("ui gone"); });
  assert.equal(refreshed, 1);
  assert.equal(PC.currencyConvert(3, "usd", "usd").result, 3);
});

// ─── makeComputeProvider — dispatch order ──────────────────────────
function compute(PC, extra = {}) {
  const copied = [], toasts = [];
  const ctx = { copy: (t) => copied.push(t), toast: (t) => toasts.push(t), ...extra };
  return { p: PC.makeComputeProvider(ctx), copied, toasts };
}

test("compute provider: arithmetic row copies the formatted result", () => {
  const PC = load();
  const { p, copied, toasts } = compute(PC);
  const rows = p(" 2 + 2 * 10 ");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "= 22");
  assert.equal(rows[0].top, true);
  rows[0].run();
  assert.deepEqual(copied, ["22"]);
  assert.deepEqual(toasts, ["copied 22"]);
});

test("compute provider: bare words / numbers and broken sums yield nothing", () => {
  const PC = load();
  const { p } = compute(PC);
  for (const q of ["", "   ", "github", "42", "hello-world", "1 +", "1/0"]) {
    assert.deepEqual(p(q), [], `q=${JSON.stringify(q)}`);
  }
});

test("compute provider: unit, percent and currency each take their own row", () => {
  const PC = load();
  const { p } = compute(PC);
  assert.equal(p("5 km to m")[0].label, "5000 meters");
  assert.equal(p("20% of 50")[0].label, "= 10");
  assert.deepEqual(p("100 usd to eur"), [], "no currency row before rates load");
  PC.primeRates((cb) => cb({ rates: { USD: 1, EUR: 0.5 }, ts: 1 }));
  const row = p("100 usd to eur")[0];
  assert.equal(row.label, "50 EUR");
  assert.equal(row.detail, "100 USD · copy ⏎");
});

test("compute provider: a unit name that is also a loaded currency code stays a unit when the other side isn't", () => {
  const PC = load();
  PC.primeRates((cb) => cb({ rates: { USD: 1, KG: 2 }, ts: 1 }));
  const { p } = compute(PC);
  assert.equal(p("1 kg to g")[0].label, "1000 grams");
});

test("compute provider: a ctx without copy/toast still runs the row", () => {
  const PC = load();
  const rows = PC.makeComputeProvider()("3*3");
  assert.equal(rows[0].label, "= 9");
  assert.doesNotThrow(() => rows[0].run());
});

test("compute provider: @stryke is debounced, cached, and re-rendered on reply", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const PC = load();
  const evals = [];
  let refreshes = 0;
  const { p, copied } = compute(PC, {
    evalStryke: (code, cb) => { evals.push(code); cb(code === "die" ? { err: "boom" } : { out: "out:" + code }); },
    refresh: () => { refreshes++; },
  });
  assert.deepEqual(p("@"), [], "empty code is ignored");
  assert.equal(p("@ p 1")[0].label, "…");
  assert.equal(p("@ p 12")[0].label, "…", "a newer keystroke replaces the pending eval");
  t.mock.timers.tick(199);
  assert.deepEqual(evals, []);
  t.mock.timers.tick(1);
  assert.deepEqual(evals, ["p 12"], "only the code the user paused on evaluates");
  assert.equal(refreshes, 1);
  const row = p("@p 12")[0];
  assert.equal(row.label, "out:p 12");
  row.run();
  assert.deepEqual(copied, ["out:p 12"]);
  p("@ p 12");
  t.mock.timers.tick(1000);
  assert.deepEqual(evals, ["p 12"], "cached code never re-evaluates");
  p("@ die");
  t.mock.timers.tick(200);
  const err = p("@ die")[0];
  assert.equal(err.label, "stryke: error");
  assert.match(err.detail, /boom/);
});

test("compute provider: @stryke without an evaluator shows a placeholder and schedules nothing", () => {
  const PC = load();
  const rows = PC.makeComputeProvider({})("@ 1+1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "…");
});

// ─── makeSearchProvider ────────────────────────────────────────────
function search(PC) {
  const opened = [];
  return { s: PC.makeSearchProvider((u) => opened.push(u)), opened };
}

test("search provider: exact alias with a query URL-encodes the rest", () => {
  const PC = load();
  const { s, opened } = search(PC);
  const rows = s("GH  foo bar&baz=é ");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "GitHub: foo bar&baz=é");
  assert.equal(rows[0].top, true);
  assert.equal(rows[0].detail, "search");
  rows[0].run();
  assert.deepEqual(opened, ["https://github.com/search?q=foo%20bar%26baz%3D%C3%A9"]);
});

test("search provider: keyword alone opens the destination origin", () => {
  const PC = load();
  const { s, opened } = search(PC);
  const rows = s("crate");
  assert.equal(rows[0].label, "crates.io");
  assert.equal(rows[0].detail, "open");
  rows[0].run();
  assert.deepEqual(opened, ["https://crates.io/"]);
});

test("search provider: prefix of an alias or slugged name matches but is not pinned top", () => {
  const PC = load();
  const { s } = search(PC);
  assert.equal(s("git serde")[0].label, "GitHub: serde");
  assert.equal(s("git serde")[0].top, false);
  assert.equal(s("stack")[0].label, "Stack Overflow", "slug of the label 'Stack Overflow'");
  assert.equal(s("crates")[0].top, true, "'crates' is an exact alias");
  assert.equal(s("go")[0].label, "pkg.go.dev", "exact alias beats the Google prefix");
});

test("search provider: single-letter non-alias never prefix-matches", () => {
  const PC = load();
  const { s } = search(PC);
  const labels = s("q").map((r) => r.label);
  assert.deepEqual(labels, ["Google: q", "DuckDuckGo: q"]);
  assert.ok(s("q").every((r) => r.fallback));
});

test("search provider: bare domain offers a direct open before the fallbacks", () => {
  const PC = load();
  const { s, opened } = search(PC);
  const rows = s("example.co.uk/path?x=1");
  assert.equal(rows[0].label, "Open example.co.uk/path?x=1");
  rows[0].run();
  assert.deepEqual(opened, ["https://example.co.uk/path?x=1"]);
  assert.equal(rows.length, 3);
});

test("search provider: fallback search URLs encode the whole raw query", () => {
  const PC = load();
  const { s, opened } = search(PC);
  const rows = s("what is 1+1 ?");
  for (const r of rows) r.run();
  assert.deepEqual(opened, [
    "https://www.google.com/search?q=what%20is%201%2B1%20%3F",
    "https://duckduckgo.com/?q=what%20is%201%2B1%20%3F",
  ]);
  assert.deepEqual(s(""), []);
});

test("SEARCH registry: every template is a valid https URL with exactly one {q}", () => {
  const { SEARCH } = load();
  for (const [aliases, label, tpl] of SEARCH) {
    assert.ok(aliases.length > 0 && aliases.every((a) => a === a.toLowerCase() && !/\s/.test(a)), label);
    assert.equal(tpl.split("{q}").length, 2, `${label} must carry one {q}`);
    assert.equal(new URL(tpl.replace("{q}", "x")).protocol, "https:", label);
  }
});

// ─── custom items / provider ───────────────────────────────────────
test("stepsSummary / typeLabel / isDefaultCmd", () => {
  const PC = load();
  assert.equal(PC.stepsSummary({ steps: [{ type: "url" }, { type: "shell" }, { type: "weird" }] }), "open url → shell → custom");
  assert.equal(PC.stepsSummary({ type: "js" }), "javascript");
  assert.equal(PC.stepsSummary({ steps: [] }), "custom");
  assert.equal(PC.stepsSummary(null), "custom");
  assert.equal(PC.stepsSummary({ type: "url" }, (t) => t.toUpperCase()), "URL");
  assert.equal(PC.isDefaultCmd({ id: "def-gh" }), true);
  assert.equal(PC.isDefaultCmd({ id: "my-def-gh" }), false);
  assert.equal(PC.isDefaultCmd({}), false);
  assert.equal(PC.isDefaultCmd(null), false);
});

test("makeCustomItems: detail falls back keyword → steps, user tier from id", () => {
  const PC = load();
  const runs = [];
  const rows = PC.makeCustomItems([
    { id: "def-gh", label: "GitHub", keyword: "gh", type: "url" },
    { id: "u1", label: "Deploy", steps: [{ type: "shell" }, { type: "url" }] },
    { id: "u2", label: "Explicit", detail: "mine", keyword: "ex" },
  ], { runCustom: (e, a) => runs.push([e.id, a]) });
  assert.deepEqual(rows.map((r) => [r.icon, r.detail, r.keyword, r.user]), [
    ["✦", "gh …", "gh", false],
    ["✦", "shell → open url", "", true],
    ["✦", "mine", "ex", true],
  ]);
  rows[1].run();
  assert.deepEqual(runs, [["u1", ""]]);
  assert.deepEqual(PC.makeCustomItems(null, { runCustom() {} }), []);
});

test("makeCustomProvider: only an exact keyword WITH an argument emits a pinned row", () => {
  const PC = load();
  const runs = [];
  const cache = [
    { id: "def-arx", label: "arXiv", keyword: "ARX", type: "url" },
    { id: "u-arx", label: "Mine", keyword: "arx", type: "shell" },
    { id: "u-arxiv", label: "Long", keyword: "arxiv", type: "url" },
    { id: "u-none", label: "No keyword" },
  ];
  const p = PC.makeCustomProvider(() => cache, { runCustom: (e, a) => runs.push([e.id, a]) });
  assert.deepEqual(p("arx"), [], "no arg: the registered row already covers it");
  assert.deepEqual(p(""), []);
  const rows = p("Arx   2312.001  ");
  assert.deepEqual(rows.map((r) => [r.label, r.user, r.top]), [
    ["arXiv: 2312.001", false, true],
    ["Mine: 2312.001", true, true],
  ]);
  rows[1].run();
  assert.deepEqual(runs, [["u-arx", "2312.001"]]);
  assert.deepEqual(PC.makeCustomProvider(() => null, { runCustom() {} })("arx 1"), []);
});
