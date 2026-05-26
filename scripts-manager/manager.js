import {
  parseMetadata,
  validateUserscript,
  userscriptId
} from "../lib/userscript.js";

const $list      = document.getElementById("list");
const $newBtn    = document.getElementById("new-script");
const $filter    = document.getElementById("filter");
const $count     = document.getElementById("count");
const $modal     = document.getElementById("editor-modal");
const $editor    = document.getElementById("editor");
const $editTitle = document.getElementById("editor-title");
const $editMeta  = document.getElementById("editor-meta");
const $editSave  = document.getElementById("editor-save");
const $editCancel= document.getElementById("editor-cancel");
const $error     = document.getElementById("error");
const $errorDtl  = document.getElementById("error-detail");
const $ver       = document.getElementById("ver");

const TEMPLATE = `// ==UserScript==
// @name        my script
// @namespace   https://github.com/MenkeTechnologies
// @version     1.0
// @match       https://*.example.com/*
// @run-at      document-idle
// @grant       GM.setValue
// @description short description
// ==/UserScript==

(function () {
  console.log("hello from my userscript");
})();`;

let editing = null;
let scripts = [];
let sort = { key: "name", dir: "asc" };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

function fmtDate(t) {
  if (!t) return "—";
  const d = new Date(t);
  const m = String(d.getMonth() + 1);
  const day = String(d.getDate());
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

// ------------------- Tabs -------------------
document.querySelectorAll(".tab").forEach((el) => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
    el.classList.add("active");
    document.getElementById("pane-" + el.dataset.tab).classList.add("active");
    if (el.dataset.tab === "log") refreshLog();
  });
});

// ------------------- Run Log -------------------
const $logList    = document.getElementById("log-list");
const $logFilter  = document.getElementById("log-filter");
const $logRefresh = document.getElementById("log-refresh");
const $logClear   = document.getElementById("log-clear");

let logEntries = [];

async function refreshLog() {
  const resp = await send({ kind: "scripts.firelog" });
  logEntries = resp?.log || [];
  renderLog();
  updateLogCount();
}

function updateLogCount() {
  const tab = document.querySelector('.tab[data-tab="log"]');
  if (!tab) return;
  tab.textContent = logEntries.length > 0 ? `Run Log (${logEntries.length})` : "Run Log";
}

// Live update: refresh the log whenever the SW writes a new entry.
// This way the Run Log tab updates as soon as a script fires, no
// manual refresh needed.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes["userScripts.fireLog"]) {
    refreshLog();
  }
});

// Pull once on load so the count badge is accurate before any firing.
refreshLog();

function renderLog() {
  const f = $logFilter.value.trim().toLowerCase();
  const rows = logEntries.filter((e) => {
    if (!f) return true;
    return (e.name || "").toLowerCase().includes(f)
        || (e.script || "").toLowerCase().includes(f)
        || (e.url || "").toLowerCase().includes(f);
  });
  if (!rows.length) {
    $logList.innerHTML = `<tr class="empty-row"><td colspan="6" class="empty">${
      logEntries.length
        ? "no matches"
        : `no script firings yet — make sure <strong>Developer mode</strong> is on and the script matches a page you visit`
    }</td></tr>`;
    return;
  }
  $logList.innerHTML = rows.map((e, i) => {
    const d = new Date(e.when);
    const time = d.toLocaleTimeString() + "." + String(d.getMilliseconds()).padStart(3, "0");
    const date = d.toLocaleDateString();
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="ver" title="${escapeHtml(d.toISOString())}">${escapeHtml(date)} <small>${escapeHtml(time)}</small></td>
        <td class="name">${escapeHtml(e.name || "(unnamed)")} <small>${escapeHtml(e.script || "")}</small></td>
        <td class="ver"><a class="home-link" href="${escapeHtml(e.url || "")}" target="_blank" rel="noopener">${escapeHtml((e.url || "").slice(0, 80))}</a></td>
        <td class="ver">${e.tabId ?? "—"}</td>
        <td class="ver">${e.frame ?? 0}</td>
      </tr>
    `;
  }).join("");
}

$logFilter.addEventListener("input", renderLog);
$logRefresh.addEventListener("click", refreshLog);
$logClear.addEventListener("click", async () => {
  if (!confirm("clear the run log?")) return;
  await send({ kind: "scripts.firelog.clear" });
  refreshLog();
});

// ------------------- Header version -------------------
try { $ver.textContent = "v" + chrome.runtime.getManifest().version; }
catch { $ver.textContent = "v?"; }

// ------------------- Refresh / render -------------------
const $info = document.getElementById("banner-fallback");

async function refresh() {
  const resp = await send({ kind: "scripts.list" });
  scripts = resp?.scripts || [];

  const isFallback = resp?.mode === "fallback" || (resp?.native === false);
  // Choose banner: red error only when even the fallback can't be wired
  // (no webNavigation/scripting). Yellow info when fallback IS active.
  $info.classList.add("hidden");
  $error.classList.add("hidden");
  if (resp?.error && !isFallback) {
    $error.classList.remove("hidden");
    $errorDtl.textContent = resp.error;
  } else if (isFallback) {
    $info.classList.remove("hidden");
  }

  const apiCell = document.getElementById("stat-api");
  if (apiCell) {
    if (isFallback) {
      apiCell.textContent = "fallback (chrome.scripting + webNavigation)";
      apiCell.style.color = "var(--yellow)";
    } else {
      apiCell.textContent = "available (native chrome.userScripts)";
      apiCell.style.color = "var(--green)";
    }
  }
  const diag = document.getElementById("diag-err");
  if (diag) diag.textContent = resp?.error || "(none)";
  const live = document.getElementById("stat-live");
  if (live) {
    const sync = resp?.lastSync;
    if (sync) {
      const t = new Date(sync.at).toLocaleString();
      live.innerHTML = `<strong style="color:var(--green)">${sync.registered}</strong> registered · <span style="color:var(--text-dim)">${t}</span>`;
      if (sync.skipped?.length) {
        live.innerHTML += `<br><span style="color:var(--yellow);font-size:10.5px">${sync.skipped.length} skipped: ${sync.skipped.map(x => x.id + ' (' + x.reason + ')').join('; ')}</span>`;
      }
    } else {
      live.textContent = "no sync yet";
    }
  }
  render();
  refreshStats();
}

function refreshStats() {
  const c = document.getElementById("stat-count");
  if (c) c.textContent = String(scripts.length);
  const b = document.getElementById("stat-bytes");
  if (b) b.textContent = fmtBytes(scripts.reduce((s, x) => s + (x.src?.length || 0), 0));
}

function sortScripts(rows) {
  const key = sort.key;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });
}

function sortValue(s, key) {
  if (key === "name") return (s.name || parseMetadata(s.src)?.name || "").toLowerCase();
  if (key === "size") return s.src?.length || 0;
  if (key === "updatedAt") return s.updatedAt || 0;
  return 0;
}

function filterScripts(rows) {
  const f = $filter.value.trim().toLowerCase();
  if (!f) return rows;
  return rows.filter((s) => {
    const meta = parseMetadata(s.src) || {};
    return (s.name || "").toLowerCase().includes(f)
        || (meta.namespace || "").toLowerCase().includes(f)
        || [...(meta.matches || []), ...(meta.includes || [])].some((p) => p.toLowerCase().includes(f));
  });
}

function render() {
  const rows = sortScripts(filterScripts(scripts));
  $count.textContent = `${rows.length} of ${scripts.length} script${scripts.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    $list.innerHTML = `<tr class="empty-row"><td colspan="11" class="empty">${
      scripts.length
        ? "no matches — clear filter or add a script"
        : `no scripts installed — click <strong>＋</strong>`
    }</td></tr>`;
    return;
  }

  $list.innerHTML = rows.map((s, i) => rowHtml(s, i)).join("");
  $list.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", (e) => onRowClick(e, tr));
  });

  document.querySelectorAll(".scripts th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === sort.key) th.classList.add(sort.dir === "asc" ? "sort-asc" : "sort-desc");
  });
}

function rowHtml(s, idx) {
  const meta = parseMetadata(s.src) || {};
  const name = escapeHtml(meta.name || s.name || "(unnamed)");
  const desc = meta.description ? `<small>${escapeHtml(meta.description.slice(0, 80))}</small>` : "";
  const ver  = escapeHtml(meta.version || "—");
  const size = fmtBytes(s.src?.length || 0);
  const sites = (meta.matches?.length || 0) + (meta.includes?.length || 0);
  const grants = meta.grants?.length || 0;
  const requires = meta.requires?.length || 0;
  const upd = fmtDate(s.updatedAt);
  const home = meta.namespace && /^https?:\/\//.test(meta.namespace)
    ? `<a class="home-link" href="${escapeHtml(meta.namespace)}" target="_blank" rel="noopener" title="${escapeHtml(meta.namespace)}">⌂</a>`
    : `<span class="icon-cell">—</span>`;

  return `
    <tr data-id="${escapeHtml(s.id)}" class="${s.enabled ? "" : "disabled"}">
      <td class="cb"><input type="checkbox" data-act="select" tabindex="-1"></td>
      <td class="num">${idx + 1}</td>
      <td class="en"><div class="toggle" data-act="toggle" title="enable/disable"></div></td>
      <td class="name">${name} ${desc}</td>
      <td class="ver">${ver}</td>
      <td class="size">${size}</td>
      <td class="icon-cell ${sites ? "has" : ""}" title="${sites} match pattern${sites === 1 ? "" : "s"}">${sites || "—"}</td>
      <td class="icon-cell feat-cell">
        ${grants ?   `<span class="badge on"   title="grants: ${escapeHtml((meta.grants||[]).join(", "))}">GM</span>` : `<span class="badge" title="no @grant">·</span>`}
        ${requires ? `<span class="badge lock" title="requires: ${escapeHtml((meta.requires||[]).join(", "))} (not yet loaded)">⊕</span>` : ``}
        ${meta.runAt === "document-start" ? `<span class="badge lock" title="runs at document-start">⚡</span>` : ``}
      </td>
      <td class="home">${home}</td>
      <td class="upd">${upd}</td>
      <td class="act">
        <div class="row-actions">
          <button data-act="edit"   title="edit">✎</button>
          <button data-act="delete" class="delete" title="delete">🗑</button>
        </div>
      </td>
    </tr>
  `;
}

async function onRowClick(e, tr) {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  const id = tr.dataset.id;
  if (act === "toggle") {
    await send({ kind: "scripts.toggle", id, enabled: tr.classList.contains("disabled") });
    refresh();
  } else if (act === "delete") {
    if (!confirm("delete this script? GM storage will also be removed.")) return;
    await send({ kind: "scripts.delete", id });
    refresh();
  } else if (act === "edit") {
    const s = scripts.find((x) => x.id === id);
    openEditor(s);
  }
}

// ------------------- Sorting -------------------
document.querySelectorAll(".scripts th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const k = th.dataset.sort;
    if (sort.key === k) sort.dir = sort.dir === "asc" ? "desc" : "asc";
    else { sort.key = k; sort.dir = "asc"; }
    render();
  });
});

// ------------------- Filter -------------------
$filter.addEventListener("input", () => render());

// ------------------- Editor -------------------
function openEditor(script) {
  editing = script || null;
  $editor.value = script ? script.src : TEMPLATE;
  $editTitle.textContent = script ? `edit · ${script.name || "(unnamed)"}` : "new script";
  $modal.classList.remove("hidden");
  $editor.focus();
  $editor.setSelectionRange($editor.value.length, $editor.value.length);
  updateEditorMeta();
}
function closeEditor() {
  $modal.classList.add("hidden");
  editing = null;
}
function updateEditorMeta() {
  const meta = parseMetadata($editor.value);
  if (!meta) { $editMeta.innerHTML = `<span class="bad">no ==UserScript== block</span>`; return; }
  const errs = validateUserscript(meta);
  const bits = [
    `<strong>${escapeHtml(meta.name || "(no name)")}</strong>`,
    meta.version && `v${escapeHtml(meta.version)}`,
    `runAt: ${escapeHtml(meta.runAt)}`,
    meta.matches.length  && `${meta.matches.length} match`,
    meta.includes.length && `${meta.includes.length} include`,
    meta.grants.length   && `grants: ${escapeHtml(meta.grants.join(", "))}`
  ].filter(Boolean).join(" · ");
  $editMeta.innerHTML = errs.length
    ? bits + ` · <span class="bad">${escapeHtml(errs.join("; "))}</span>`
    : bits + ` · <span class="ok">valid</span>`;
}
$editor.addEventListener("input", updateEditorMeta);

$editSave.addEventListener("click", async () => {
  const src = $editor.value;
  const meta = parseMetadata(src);
  const errs = validateUserscript(meta);
  if (errs.length) { alert("can't save:\n" + errs.join("\n")); return; }
  const id = editing?.id || userscriptId(meta);
  const resp = await send({
    kind: "scripts.save",
    script: { ...(editing || {}), id, src, enabled: editing ? editing.enabled : true }
  });
  if (!resp?.ok) { alert("save failed:\n" + ((resp?.errors || []).join("\n") || "unknown error")); return; }
  closeEditor();
  refresh();
});
$editCancel.addEventListener("click", closeEditor);
$modal.addEventListener("click", (e) => { if (e.target === $modal) closeEditor(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$modal.classList.contains("hidden")) closeEditor();
  if ((e.metaKey || e.ctrlKey) && e.key === "s" && !$modal.classList.contains("hidden")) {
    e.preventDefault(); $editSave.click();
  }
});
$newBtn.addEventListener("click", () => openEditor(null));

// ------------------- Utilities -------------------
const $fileInput = document.getElementById("file-input");
document.getElementById("util-import-file").addEventListener("click", () => $fileInput.click());
$fileInput.addEventListener("change", async () => {
  const file = $fileInput.files[0];
  if (!file) return;
  const src = await file.text();
  openEditor({ src });
  $fileInput.value = "";
});

document.getElementById("util-import-url-btn").addEventListener("click", async () => {
  const url = document.getElementById("util-import-url").value.trim();
  if (!url) return;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const src = await r.text();
    openEditor({ src });
  } catch (e) {
    alert("fetch failed: " + e.message);
  }
});

document.getElementById("util-export-all").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(scripts, null, 2)], { type: "application/json" });
  download(blob, "zpwrchrome-userscripts.json");
});
document.getElementById("util-export-bundle").addEventListener("click", () => {
  const bundle = scripts.map((s) => s.src).join("\n\n// ===============================\n\n");
  const blob = new Blob([bundle], { type: "text/javascript" });
  download(blob, "zpwrchrome-userscripts.user.js");
});
document.getElementById("util-resync").addEventListener("click", async () => {
  const r = await send({ kind: "scripts.resync" });
  if (r?.error) {
    alert("re-register failed:\n" + r.error);
  } else {
    alert("registered " + (r?.registered ?? 0) + " script(s)"
      + (r?.skipped?.length ? "\nskipped: " + r.skipped.map((s) => s.id + " (" + s.reason + ")").join(", ") : ""));
  }
  refresh();
});

document.getElementById("wipe-all").addEventListener("click", async () => {
  if (!confirm("erase ALL userscripts and their GM storage? this cannot be undone.")) return;
  for (const s of scripts) await send({ kind: "scripts.delete", id: s.id });
  refresh();
});

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Banner "Open chrome://extensions" buttons (red + yellow).
for (const id of ["open-chrome-ext", "open-chrome-ext-err"]) {
  const b = document.getElementById(id);
  if (b) b.addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id }));
}

refresh();
