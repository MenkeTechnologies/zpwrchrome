// zpwrchrome — HOST console. Talk to the zpwrchrome-host native binary
// (com.menketechnologies.zpwrchrome) directly, the same way background.js does.
//
// Ported from the zwire HUD host page (hud-internal/pages/host.js), re-aimed at
// THIS extension's host. Key difference from the zwire original: zpwrchrome-host
// is a browserpass-model host — one request per process spawn over
// chrome.runtime.sendNativeMessage, NO persistent port, NO streaming. So the
// panes are:
//   STATUS       — echo handshake: connected? protocol version, round-trip ms
//   REPL         — the full {action:…} command surface, JSON in / JSON out
//   COMMAND LOG  — the service-worker diag ring (every host round-trip from any
//                  extension surface — popup, SW, this page), polled via
//                  runtime.sendMessage({kind:"diag.read"})
//
// Wire envelope (every action): request { action, …args };
//                               response { status:"ok", version, data } |
//                                        { status:"error", code, version, params }
import "../lib/page-nav.js";

const NATIVE_HOST = "com.menketechnologies.zpwrchrome";
// Default password store, mirrors background.js bpStores(). `~/` is expanded
// host-side by normalizePasswordStorePath, so no env lookup is needed here.
const STORES = { default: { id: "default", name: "Default", path: "~/.password-store" } };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }

// The full zpwrchrome-host command surface — one ready-to-edit template per
// action, grouped by subsystem. Click a chip to load it PRETTY-printed into the
// editor. Stores are injected below so the templates stay readable here.
const S = JSON.stringify(STORES);
const CATALOG = [
  ["handshake", [
    '{"action":"echo","echoResponse":{"ping":"zpwrchrome"}}',
  ]],
  ["pass · browserpass protocol", [
    `{"action":"configure","settings":{"stores":${S}}}`,
    `{"action":"list","settings":{"stores":${S}}}`,
    `{"action":"tree","settings":{"stores":${S}}}`,
    `{"action":"fetch","storeId":"default","file":"github.com/user.gpg","settings":{"stores":${S}}}`,
    `{"action":"save","storeId":"default","file":"tmp/zpwrchrome-demo.gpg","contents":"hunter2\\nlogin: user\\n","settings":{"stores":${S}}}`,
    `{"action":"delete","storeId":"default","file":"tmp/zpwrchrome-demo.gpg","settings":{"stores":${S}}}`,
  ]],
  ["pass · extensions", [
    `{"action":"otp","storeId":"default","file":"github.com/user.gpg","settings":{"stores":${S}}}`,
    `{"action":"search","settings":{"stores":${S}},"echoResponse":"github"}`,
  ]],
  ["host tools", [
    '{"action":"host.crawl","path":"~/src","ext":"rs"}',
    '{"action":"host.exec","program":"git","args":["status","--porcelain"]}',
    '{"action":"run.spawn","argv":["echo","hello from zpwrchrome-host"],"cwd":"/tmp","timeoutMs":30000}',
  ]],
  ["zcite connector", [
    '{"action":"zcite.save","item":{"type":"webpage","title":"Example","URL":"https://example.com"}}',
  ]],
  ["download manager", [
    '{"action":"dl.list"}',
    '{"action":"dl.add","url":"https://speed.hetzner.de/100MB.bin","dir":"","name":"","segments":6}',
    '{"action":"dl.pause","gid":0}',
    '{"action":"dl.resume","gid":0}',
    '{"action":"dl.cancel","gid":0}',
    '{"action":"dl.restart","gid":0}',
    '{"action":"dl.remove","gid":0,"deleteFromDisk":false}',
    '{"action":"dl.clear","scope":"done","deleteFromDisk":false}',
    '{"action":"dl.openDir","dir":"/path/to/file"}',
    '{"action":"dl.openFile","dir":"/path/to/file"}',
  ]],
];

/* --------------------------------- STATUS -------------------------------- */
const $status = document.getElementById("status");
function setStatus(html) { $status.innerHTML = html; }
// zpwrchrome-host reports the browserpass PROTOCOL version as a packed int
// (3_001_002 → "3.1.2"); there is no wire action returning the host binary
// version, so STATUS shows protocol version + round-trip latency instead.
function unpackVersion(v) {
  const n = Number(v) || 0;
  return `${Math.floor(n / 1e6)}.${Math.floor((n % 1e6) / 1e3)}.${n % 1e3}`;
}
async function probe() {
  setStatus('<span class="hc-dot" style="background:var(--yellow)"></span><span class="hc-sub">probing…</span>');
  const t0 = performance.now();
  try {
    const resp = await sendNative({ action: "echo", echoResponse: { ping: "zpwrchrome" } });
    const dt = Math.round(performance.now() - t0);
    const ver = resp && resp.version ? unpackVersion(resp.version) : "?";
    const caps = CATALOG.flatMap((g) => g[1].map(actionOf))
      .map((a) => `<span class="hc-cap">${esc(a)}</span>`).join("");
    setStatus(
      '<span class="hc-dot" style="background:var(--green)"></span>'
      + '<b style="color:var(--cyan)">connected</b> '
      + `<span class="hc-sub">${esc(NATIVE_HOST)} · browserpass protocol v${esc(ver)} · ${dt} ms round-trip</span>`
      + `<div class="hc-caps">${caps}</div>`,
    );
  } catch (e) {
    setStatus(
      '<span class="hc-dot" style="background:var(--accent)"></span>'
      + `<span class="hc-sub">unavailable — ${esc(e && e.message || e)} `
      + "(install with <code>zpwrchrome-host --install &lt;ext-id&gt;</code>, then reload)</span>",
    );
  }
}

// One-shot native round-trip. Resolves the FULL response object (ok or the raw
// error envelope) so the REPL can render whatever the host sent; rejects only on
// transport failure (host missing / crashed).
function sendNative(req) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, req, (resp) => {
        const last = chrome.runtime.lastError;
        if (last) { reject(new Error(last.message || "native host error")); return; }
        if (!resp || typeof resp !== "object") { reject(new Error("empty response")); return; }
        resolve(resp);
      });
    } catch (e) { reject(e); }
  });
}

/* ------------------------- REPL: catalog · editor ------------------------ */
const actionOf = (tpl) => { try { return JSON.parse(tpl).action || tpl; } catch { return tpl; } };
const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };

const $cat = document.getElementById("catalog");
for (const [label, templates] of CATALOG) {
  $cat.appendChild(el("div", "hc-catlabel", esc(label)));
  const row = el("div", "hc-chips");
  for (const tpl of templates) {
    const chip = el("span", "hc-chip", esc(actionOf(tpl)));
    chip.title = tpl;
    chip.addEventListener("click", () => { $editor.value = pretty(tpl); $editor.focus(); });
    row.appendChild(chip);
  }
  $cat.appendChild(row);
}

const $editor = document.getElementById("editor");
$editor.value = '{\n  "action": "echo",\n  "echoResponse": { "ping": "zpwrchrome" }\n}';
// ⌘/Ctrl-Enter sends; Tab inserts two spaces instead of leaving the textarea.
$editor.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doSend(); return; }
  if (e.key === "Tab") {
    e.preventDefault();
    const s = $editor.selectionStart, en = $editor.selectionEnd;
    $editor.value = `${$editor.value.slice(0, s)}  ${$editor.value.slice(en)}`;
    $editor.selectionStart = $editor.selectionEnd = s + 2;
  }
});

function formatEditor() {
  try { $editor.value = JSON.stringify(JSON.parse($editor.value), null, 2); }
  catch (e) { logErr(`invalid JSON: ${e.message}`); }
}
document.getElementById("send").addEventListener("click", doSend);
document.getElementById("format").addEventListener("click", formatEditor);
document.getElementById("export").addEventListener("click", exportLog);
document.getElementById("clear").addEventListener("click", () => { $log.innerHTML = ""; logData = []; });

async function doSend() {
  const raw = ($editor.value || "").trim();
  if (!raw) return;
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { logErr(`invalid JSON: ${e.message}`); return; }
  logJson("out", obj);
  try {
    const resp = await sendNative(obj);
    logJson("in", resp);
  } catch (e) { logErr(String(e && e.message || e)); }
}

/* ------------------------- REPL: response transcript --------------------- */
const $log = document.getElementById("log");
let logData = []; // structured transcript for Export
let curFilter = "";

// Render a value as a collapsible JSON tree (objects/arrays fold via <details>).
function jsonNode(val, key) {
  const keyHtml = key != null ? `<span class="hc-k">${esc(key)}</span>: ` : "";
  if (val === null) return el("div", "hc-leaf", `${keyHtml}<span class="hc-v-null">null</span>`);
  const type = typeof val;
  if (type === "string") return el("div", "hc-leaf", `${keyHtml}<span class="hc-v-str">${esc(JSON.stringify(val))}</span>`);
  if (type === "number") return el("div", "hc-leaf", `${keyHtml}<span class="hc-v-num">${esc(val)}</span>`);
  if (type === "boolean") return el("div", "hc-leaf", `${keyHtml}<span class="hc-v-bool">${esc(val)}</span>`);
  const entries = Array.isArray(val) ? val.map((v, i) => [i, v]) : Object.entries(val);
  const details = el("details");
  details.open = true;
  const brace = Array.isArray(val) ? `[${entries.length}]` : `{${entries.length}}`;
  const summary = el("summary", null, `${keyHtml}<span class="hc-v-null">${esc(brace)}</span>`);
  details.appendChild(summary);
  for (const [k, v] of entries) details.appendChild(jsonNode(v, k));
  return details;
}

function logJson(kind, obj) {
  logData.push({ t: new Date().toISOString(), dir: kind, msg: obj });
  const arrow = kind === "out" ? "▸" : "◂";
  const entry = el("div", `hc-entry ${kind}`);
  const head = el("div", "hc-ehead");
  head.appendChild(el("span", "hc-ar", arrow));
  head.appendChild(el("span", "hc-etime", stamp()));
  if (kind === "out") {
    head.title = "click to edit + resend";
    head.style.cursor = "pointer";
    head.addEventListener("click", () => { $editor.value = JSON.stringify(obj, null, 2); $editor.focus(); });
  }
  entry.appendChild(head);
  const tree = el("div", "hc-tree");
  tree.appendChild(jsonNode(obj));
  entry.appendChild(tree);
  $log.appendChild(entry);
  if (curFilter && !entry.textContent.toLowerCase().includes(curFilter)) entry.style.display = "none";
  entry.scrollIntoView({ block: "nearest" });
}
function logErr(text) {
  const e = el("div", "hc-entry err");
  e.textContent = `✕ ${text}`;
  $log.appendChild(e);
  $log.scrollTop = $log.scrollHeight;
}
function applyFilter() {
  for (const e of $log.children) {
    e.style.display = (!curFilter || e.textContent.toLowerCase().includes(curFilter)) ? "" : "none";
  }
}
document.getElementById("filter").addEventListener("input", (ev) => {
  curFilter = (ev.target.value || "").trim().toLowerCase();
  applyFilter();
});

function exportLog() {
  if (!logData.length) { logErr("nothing to export yet"); return; }
  const blob = new Blob([JSON.stringify(logData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const name = `zpwrchrome-host-repl-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  if (chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({ url, filename: name, saveAs: true }, () => {
      void chrome.runtime.lastError; setTimeout(() => URL.revokeObjectURL(url), 8000);
    });
  } else {
    const a = el("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

/* ---------------------- COMMAND LOG: the SW diag ring -------------------- */
// zpwrchrome-host spawns a fresh process per request, so unlike the zwire host
// there is no shared host-side log file. The nearest cross-surface view is the
// service worker's diag ring, which records every native round-trip
// (bp.send / bp.send.ok / bp.send.host_err) plus pass/dl/ua events. Polled here.
const $clog = document.getElementById("clog");
const $hidebp = document.getElementById("hide-noise");
function classify(label) {
  if (/_err|_throw|failed|host_err|empty/.test(label)) return "bad";
  if (/skip|takeover|warn|no_/.test(label)) return "warn";
  return "ok";
}
function bodyText(entry) {
  const { ts: _ts, label: _label, ...rest } = entry;
  return Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
}
async function pollClog() {
  let r;
  try { r = await chrome.runtime.sendMessage({ kind: "diag.read" }); } catch { return; }
  const entries = (r && r.entries) || (Array.isArray(r) ? r : []);
  if (!entries.length) {
    if (!$clog.children.length) $clog.innerHTML = '<div class="hc-clr"><span class="hc-clb">no diagnostic entries yet — send a command or run a download</span></div>';
    return;
  }
  const noise = $hidebp.checked; // hide high-frequency pass.match / dl.list chatter
  const atBottom = $clog.scrollHeight - $clog.scrollTop - $clog.clientHeight < 40;
  $clog.innerHTML = "";
  for (const e of entries) {
    const label = e.label || "?";
    if (noise && /^(pass\.match|dl\.snapshot|bp\.send$)/.test(label)) continue;
    const row = el("div", `hc-clr ${classify(label)}`);
    row.appendChild(el("span", "hc-clt", esc(e.ts || "")));
    row.appendChild(el("span", "hc-cll", esc(label)));
    row.appendChild(el("span", "hc-clb", esc(bodyText(e))));
    $clog.appendChild(row);
  }
  if (atBottom) $clog.scrollTop = $clog.scrollHeight;
}
$hidebp.addEventListener("change", pollClog);
setInterval(pollClog, 1500);

/* -------------------------------- boot ---------------------------------- */
document.getElementById("ping").addEventListener("click", probe);
probe();
pollClog();
$editor.focus();
