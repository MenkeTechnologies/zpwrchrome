// zpwrchrome — downloads manager.
//
// Sidebar-nav over BP `dl.list` snapshots. Polls 5×/s while anything is
// active, backs off to 1/s when idle. Re-hydrates from the SW's cached
// snapshot before the first live poll so the list paints instantly.

import "../lib/page-nav.js";
import { loadSettings, DL_DEFAULTS } from "./dl-settings.js";
import { fzfMatch, highlightWithIndices } from "../lib/fzf.js";

const $list   = document.getElementById("list");
const $search = document.getElementById("search");
const $count  = document.getElementById("footer-count");
const $status = document.getElementById("footer-status");

const state = {
  jobs: [],
  category: "all",
  filter: "",
  selected: null,   // gid of currently selected row (null = none)
  pollTimer: null,
  settings: { ...DL_DEFAULTS },
};

loadSettings().then((s) => { state.settings = s; });
chrome.storage?.onChanged?.addListener?.((changes, area) => {
  if (area === "local" && changes["dl.settings"]) {
    state.settings = { ...DL_DEFAULTS, ...(changes["dl.settings"].newValue || {}) };
  }
});

// ── classification ───────────────────────────────────────────────────

const EXT_IMG  = new Set(["jpg","jpeg","png","gif","webp","svg","bmp","ico","tiff","heic","avif"]);
const EXT_VID  = new Set(["mp4","mkv","avi","mov","webm","flv","m4v","wmv","ts","vob"]);
const EXT_AUD  = new Set(["mp3","wav","flac","aac","ogg","m4a","opus","wma","alac"]);
const EXT_DOC  = new Set(["pdf","doc","docx","xls","xlsx","ppt","pptx","odt","ods","odp","txt","md","rtf","csv","epub","mobi"]);
const EXT_ARCH = new Set(["zip","tar","gz","bz2","xz","7z","rar","tgz","tbz","tbz2","z","lz","lzma","cab","iso","dmg"]);

function classify(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (EXT_IMG.has(ext))  return "image";
  if (EXT_VID.has(ext))  return "video";
  if (EXT_AUD.has(ext))  return "audio";
  if (EXT_DOC.has(ext))  return "document";
  if (EXT_ARCH.has(ext)) return "archive";
  return "other";
}

function basename(path) {
  return (path || "").split("/").pop() || path || "";
}

function fmtBytes(n) {
  if (!n || n <= 0) return "0 B";
  const units = ["B","KB","MB","GB","TB"];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtSpeed(bytes, ms) {
  if (!ms || ms <= 0) return "—";
  return `${fmtBytes((bytes * 1000) / ms)}/s`;
}

function fmtEta(done, total, bytesPerSec) {
  if (!total || total <= done) return "—";
  if (!bytesPerSec) return "—";
  return fmtDur(Math.round((total - done) / bytesPerSec));
}
function fmtElapsed(ms) {
  if (!ms || ms <= 0) return "0s";
  return fmtDur(Math.round(ms / 1000));
}
function fmtDur(sec) {
  if (sec < 0) sec = 0;
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec/60)}m ${sec%60}s`;
  return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`;
}

function fmtDate(unixSec) {
  if (!unixSec || unixSec <= 0) return "";
  const d = new Date(unixSec * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function fzfHl(text, query) {
  const t = String(text ?? "");
  if (!query) return escapeHtml(t);
  const m = fzfMatch(query, t);
  return m ? highlightWithIndices(t, m.indices, escapeHtml) : escapeHtml(t);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

// ── category filter ─────────────────────────────────────────────────

function filterJobs() {
  const cat = state.category;
  const f   = state.filter.trim();
  const now = Math.floor(Date.now() / 1000);

  return state.jobs.filter((j) => {
    const name = basename(j.dest);
    const kind = classify(name);

    // category gate
    if (cat === "all")         { /* keep all */ }
    else if (cat === "recent") {
      // last 24h
      if (!j.started_at || (now - j.started_at) > 86400) return false;
    }
    else if (cat === "downloading") {
      if (!["active","pending","paused"].includes(j.status)) return false;
    }
    else if (cat === "finished") {
      if (j.status !== "done") return false;
    }
    else if (cat.startsWith("finished:")) {
      if (j.status !== "done") return false;
      if (cat.slice("finished:".length) !== kind) return false;
    }
    else if (cat === "failed") {
      if (j.status !== "failed") return false;
    }
    else if (cat === "trash") {
      if (j.status !== "cancelled") return false;
    }

    // text filter — fzf over name + url, either matching counts
    if (f) {
      if (!fzfMatch(f, name) && !fzfMatch(f, j.url || "")) return false;
    }
    return true;
  });
}

// counts per category for the sidebar pills
function countsByCategory() {
  const now = Math.floor(Date.now() / 1000);
  const c = {
    all: state.jobs.length,
    recent: 0,
    downloading: 0,
    finished: 0,
    "finished:image": 0,
    "finished:video": 0,
    "finished:audio": 0,
    "finished:document": 0,
    "finished:archive": 0,
    "finished:other": 0,
    failed: 0,
    trash: 0,
  };
  for (const j of state.jobs) {
    if (j.started_at && (now - j.started_at) <= 86400) c.recent++;
    if (["active","pending","paused"].includes(j.status)) c.downloading++;
    if (j.status === "done") {
      c.finished++;
      c[`finished:${classify(basename(j.dest))}`]++;
    }
    if (j.status === "failed")    c.failed++;
    if (j.status === "cancelled") c.trash++;
  }
  return c;
}

// ── render ──────────────────────────────────────────────────────────

const ICONS = { image:"🖼", video:"🎬", audio:"🎵", document:"📄", archive:"🗂", other:"📦" };

function rowHtml(job) {
  const name = basename(job.dest);
  const kind = classify(name);
  const pct  = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const bps  = job.elapsed_ms > 0 ? (job.done * 1000) / job.elapsed_ms : 0;
  const sizeStr = job.total > 0
    ? `${fmtBytes(job.done)} / ${fmtBytes(job.total)} (${pct}%)`
    : (job.status === "done" ? fmtBytes(job.done) : `${fmtBytes(job.done)} / ?`);
  const showBar    = job.status === "active" || job.status === "paused";
  const showSpeed  = job.status === "active";
  const showEta    = job.status === "active";
  const isSel      = state.selected === job.gid;
  const q          = state.filter.trim();
  const escName    = fzfHl(name || "(unnamed)", q);
  const urlPlain   = escapeHtml(job.url || "");
  const escUrl     = fzfHl(job.url || "", q);
  const escDest    = escapeHtml(job.dest || "");
  const dateStr    = fmtDate(job.started_at);
  // Host-computed presence flag (dl.list returns dest_exists per row). For
  // done jobs whose dest has been deleted out of band, fall back to the
  // status tag MISSING and hide reveal/open actions — never reveal a
  // path that isn't actually there.
  const destOnDisk = job.dest_exists !== false;            // undefined = legacy host = treat as present
  const isMissing  = job.status === "done" && !destOnDisk;
  const rowCls     = `dl-row k-${kind}${isSel ? " sel" : ""}${isMissing ? " missing" : ""}`;
  const statTag    = isMissing
      ? `<span class="stat-tag missing" title="file no longer on disk">missing</span>`
      : `<span class="stat-tag ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>`;

  return `
    <div class="${rowCls}" data-gid="${job.gid}" tabindex="0">
      <span class="ico">${ICONS[kind] || "📄"}</span>
      <div class="body">
        <span class="name" title="${escDest}${isMissing ? ' (deleted)' : ''}">${escName}</span>
        <span class="url"  title="${urlPlain}">${escUrl}</span>
        <span class="meta">
          ${statTag}
          <span>${sizeStr}</span>
          ${showSpeed ? `<span class="spd">${fmtSpeed(job.done, job.elapsed_ms)}</span>` : ""}
          ${showEta   ? `<span class="eta">ETA ${fmtEta(job.done, job.total, bps)}</span>` : ""}
          ${(showBar || job.status === "done") ? `<span class="elp">${fmtElapsed(job.elapsed_ms)} elapsed</span>` : ""}
          <span class="dim">gid ${job.gid} · ${job.segments} seg</span>
        </span>
        ${showBar ? `<div class="bar"><div class="fill" style="width:${pct}%;"></div></div>` : ""}
        ${job.err ? `<div class="err">${escapeHtml(job.err)}</div>` : ""}
      </div>
      <div class="date">${escapeHtml(dateStr)}</div>
      <div class="actions">
        ${job.status === "active"  ? `<button data-act="pause"  data-gid="${job.gid}">pause</button>`  : ""}
        ${job.status === "paused"  ? `<button data-act="resume" data-gid="${job.gid}">resume</button>` : ""}
        ${(job.status === "failed" || job.status === "cancelled") ? `<button data-act="resume" data-gid="${job.gid}">retry</button>` : ""}
        ${(job.status === "done" && destOnDisk)
            ? `<button data-act="open"   data-dest="${escDest}">open</button>
               <button data-act="reveal" data-dest="${escDest}">reveal</button>` : ""}
        ${(job.status === "active" || job.status === "paused" || job.status === "pending")
            ? `<button class="danger" data-act="cancel" data-gid="${job.gid}">cancel</button>` : ""}
      </div>
    </div>
  `;
}

function renderCats() {
  const c = countsByCategory();
  const map = {
    "all": "ct-all", "recent": "ct-recent", "downloading": "ct-downloading",
    "finished": "ct-finished",
    "finished:image": "ct-image", "finished:video": "ct-video", "finished:audio": "ct-audio",
    "finished:document": "ct-doc", "finished:archive": "ct-arch", "finished:other": "ct-other",
    "failed": "ct-failed", "trash": "ct-trash",
  };
  for (const [k, id] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.textContent = c[k] > 0 ? c[k] : "";
  }
  document.querySelectorAll(".cat").forEach((el) => {
    el.classList.toggle("active", el.dataset.cat === state.category);
  });
}

// "Stable identity" hash for a job — when this string changes, the row
// needs a full rebuild; when it doesn't, only the progress / size / speed
// numbers update in place. Keeps :hover state intact across the 4Hz poll.
function rowIdentity(j) {
  return [
    j.gid, j.status, j.err || "", j.dest || "", j.url || "",
    j.segments, j.dest_exists === false ? 0 : 1,
  ].join("|");
}

// Map of gid → { el, identity } persisted across renders so the same row
// element survives a poll cycle. innerHTML thrash was killing the hover
// state (and therefore the action buttons inside it) at 4 Hz.
const _rowCache = new Map();
let _emptyEl = null;

function applyRowProgress(el, j) {
  // Update only the bits that change tick-to-tick. Everything that drives
  // a layout (status, err, action list) is gated by rowIdentity above —
  // when it changes the whole row gets rebuilt.
  const pct = j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
  const bps = j.elapsed_ms > 0 ? (j.done * 1000) / j.elapsed_ms : 0;
  const sizeStr = j.total > 0
    ? `${fmtBytes(j.done)} / ${fmtBytes(j.total)} (${pct}%)`
    : (j.status === "done" ? fmtBytes(j.done) : `${fmtBytes(j.done)} / ?`);
  const sizeEl = el.querySelector(".meta > span:nth-of-type(2)");
  if (sizeEl) sizeEl.textContent = sizeStr;
  if (j.status === "active") {
    const spdEl = el.querySelector(".meta .spd");
    const etaEl = el.querySelector(".meta .eta");
    if (spdEl) spdEl.textContent = fmtSpeed(j.done, j.elapsed_ms);
    if (etaEl) etaEl.textContent = `ETA ${fmtEta(j.done, j.total, bps)}`;
  }
  const elpEl = el.querySelector(".meta .elp");
  if (elpEl) elpEl.textContent = `${fmtElapsed(j.elapsed_ms)} elapsed`;
  const fill = el.querySelector(".bar .fill");
  if (fill) fill.style.width = `${pct}%`;
}

function renderList() {
  const jobs = filterJobs();
  // Newest first within each category: pending/active/paused first then by gid desc.
  const order = { pending: 0, active: 1, paused: 2, failed: 3, cancelled: 4, done: 5 };
  jobs.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.gid - a.gid);

  if (!jobs.length) {
    if (_rowCache.size) {
      for (const { el } of _rowCache.values()) el.remove();
      _rowCache.clear();
    }
    if (!_emptyEl) { _emptyEl = document.createElement("div"); _emptyEl.className = "empty"; $list.appendChild(_emptyEl); }
    _emptyEl.innerHTML = state.filter
      ? `no downloads match "${escapeHtml(state.filter)}"`
      : (state.category === "all"
          ? "no downloads yet — bind <kbd>dl-paste-url</kbd> or right-click a link → Download with zpwrchrome"
          : `no ${escapeHtml(state.category)} downloads`);
    $count.textContent = "0 items";
    return;
  }
  if (_emptyEl) { _emptyEl.remove(); _emptyEl = null; }

  // Incremental update — for each desired job, reuse the existing row when
  // its rowIdentity hasn't changed (just patch progress); otherwise rebuild
  // the row from the template. Then drop any rows for jobs that are gone.
  const seen = new Set();
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const id = rowIdentity(j);
    let entry = _rowCache.get(j.gid);
    if (!entry || entry.identity !== id) {
      // (Re)build the row from the same template renderList used to.
      const tmp = document.createElement("div");
      tmp.innerHTML = rowHtml(j).trim();
      const fresh = tmp.firstElementChild;
      if (entry) entry.el.replaceWith(fresh);
      else       $list.appendChild(fresh);
      entry = { el: fresh, identity: id };
      _rowCache.set(j.gid, entry);
    } else {
      // Same identity — only mutate the numbers in place.
      applyRowProgress(entry.el, j);
    }
    // Maintain visual order without recreating nodes.
    if ($list.children[i] !== entry.el) $list.insertBefore(entry.el, $list.children[i] || null);
    seen.add(j.gid);
  }
  for (const [gid, { el }] of _rowCache.entries()) {
    if (!seen.has(gid)) { el.remove(); _rowCache.delete(gid); }
  }
  $count.textContent = `${jobs.length} item${jobs.length === 1 ? "" : "s"}`;
}

// ── actions ─────────────────────────────────────────────────────────

// Concurrent action calls (multiple rapid pause→resume→pause clicks) race
// in the host's mutate_state read-modify-write. Serialization happens on
// the host side via `with_gid_lock`, so the JS sender just fires the
// message and treats each call independently. A 3-second sendMessage
// timeout protects against the SW handler hanging — a stuck call would
// otherwise leave the UI button forever disabled.
function sendAct(action, gid) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish({ ok: false, err: "timeout" }), 3000);
    chrome.runtime.sendMessage({ kind: `dl.${action}`, gid: Number(gid) }, (r) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) { finish({ ok: false, err: chrome.runtime.lastError.message }); return; }
      finish(r || { ok: false, err: "no response" });
    });
  });
}

$list.addEventListener("click", async (e) => {
  const actBtn = e.target.closest("button[data-act]");
  if (actBtn) {
    e.stopPropagation();
    const act = actBtn.dataset.act;
    if (act === "reveal" || act === "open") {
      // reveal → open parent dir; open → open file with default app.
      const dest = actBtn.dataset.dest || "";
      const kind = act === "open" ? "dl.openFile" : "dl.openDir";
      actBtn.disabled = true;
      chrome.runtime.sendMessage({ kind, path: dest }, (r) => {
        actBtn.disabled = false;
        if (!r?.ok) $status.textContent = `${act} failed: ${r?.err || "unknown"}`;
      });
      return;
    }
    const gid = Number(actBtn.dataset.gid);
    actBtn.disabled = true;
    // Optimistic UI update: flip the row's status in-place BEFORE the
    // SW → native-host round trip so the user gets immediate feedback.
    // pause/resume/cancel each pay 150-300ms of host startup + IPC; without
    // this the row looks frozen until poll() lands.
    const optimisticStatus = (
      act === "pause"  ? "paused"    :
      act === "resume" ? "pending"   :
      act === "cancel" ? "cancelled" : null
    );
    if (optimisticStatus) {
      const job = state.jobs.find((j) => j.gid === gid);
      if (job && job.status !== optimisticStatus) {
        job.status = optimisticStatus;
        renderCats();
        renderList();
        renderDrawer();
      }
    }
    const r = await sendAct(act, gid);
    actBtn.disabled = false;
    if (!r?.ok) $status.textContent = `${act} failed: ${r?.err || "unknown"}`;
    poll();
    return;
  }
  const row = e.target.closest(".dl-row");
  if (row) {
    const gid = Number(row.dataset.gid);
    const isNewSel = state.selected !== gid;
    state.selected = state.selected === gid ? null : gid;
    if (isNewSel) _drawerCollapsed = false;
    document.querySelectorAll(".dl-row").forEach((r) => r.classList.toggle("sel", Number(r.dataset.gid) === state.selected));
    renderDrawer();
  }
});

document.querySelectorAll(".cat").forEach((el) => {
  el.addEventListener("click", () => {
    state.category = el.dataset.cat;
    if (state.settings.clearSearchOnFilter && $search.value) {
      $search.value = "";
      state.filter = "";
    }
    renderCats();
    renderList();
  });
});

$search.addEventListener("input", () => {
  state.filter = $search.value;
  renderList();
});

document.getElementById("t-add").addEventListener("click", () => {
  const url = prompt("URL to download:");
  if (!url) return;
  chrome.runtime.sendMessage({ kind: "dl.add", url }, (r) => {
    if (!r?.ok) $status.textContent = `add failed: ${r?.err || "unknown"}`;
    poll();
  });
});
document.getElementById("t-pause-all").addEventListener("click", async () => {
  for (const j of state.jobs.filter((j) => j.status === "active")) {
    await sendAct("pause", j.gid);
  }
  poll();
});
document.getElementById("t-resume-all").addEventListener("click", async () => {
  for (const j of state.jobs.filter((j) => j.status === "paused" || j.status === "failed")) {
    await sendAct("resume", j.gid);
  }
  poll();
});
document.getElementById("t-refresh").addEventListener("click", () => poll());
document.getElementById("t-open-dir").addEventListener("click", () => {
  // Same priority as the takeover handler:
  //   explicit downloadDir > tracked lastDir > host default (~/Downloads).
  const s = state.settings;
  const path = (s.downloadDir && s.downloadDir.trim())
    ? s.downloadDir.trim()
    : (s.saveToLastUsedLocation && s.lastDir)
      ? s.lastDir
      : "";
  chrome.runtime.sendMessage({ kind: "dl.openDir", path }, (r) => {
    if (!r?.ok) $status.textContent = `open dir failed: ${r?.err || "unknown"}`;
    else        $status.textContent = `opened ${r.opened || "downloads folder"}`;
  });
});

// Clear menu — overlay panel toggled from the toolbar Clear button.
const $clearBtn  = document.getElementById("t-clear");
const $clearMenu = document.getElementById("clear-menu");
const $clearDisk = document.getElementById("cm-disk");

$clearBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  $clearMenu.hidden = !$clearMenu.hidden;
});
document.addEventListener("click", (e) => {
  if (!$clearMenu.hidden && !$clearMenu.contains(e.target) && e.target !== $clearBtn) {
    $clearMenu.hidden = true;
  }
});
$clearMenu.querySelectorAll(".tmenu-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const scope = btn.dataset.scope;
    const deleteFromDisk = $clearDisk.checked;
    if (scope === "all") {
      const ok = confirm(`Clear ALL ${state.jobs.length} downloads?${deleteFromDisk ? "\nAlso delete the destination files from disk." : ""}`);
      if (!ok) { $clearMenu.hidden = true; return; }
    }
    chrome.runtime.sendMessage({ kind: "dl.clear", scope, deleteFromDisk }, (r) => {
      $clearMenu.hidden = true;
      if (chrome.runtime.lastError || !r?.ok) {
        $status.textContent = `clear failed: ${r?.err || chrome.runtime.lastError?.message || "unknown"}`;
        return;
      }
      const n = (r.cleared || []).length;
      const d = (r.deletedOnDisk || []).length;
      $status.textContent = `cleared ${n} task${n === 1 ? "" : "s"}${d ? `, deleted ${d} file${d === 1 ? "" : "s"}` : ""}`;
      poll();
    });
  });
});
document.getElementById("t-cancel-sel").addEventListener("click", async () => {
  if (state.selected != null) {
    await sendAct("cancel", state.selected);
    poll();
  } else {
    $status.textContent = "select a row first";
  }
});

// ── data fetch ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind !== "dl.event") return;
  if (msg.event?.kind === "dl.progress" && Array.isArray(msg.event.jobs)) {
    state.jobs = msg.event.jobs;
    $status.textContent = "live";
    renderCats();
    renderList();
    renderDrawer();
  }
});

function poll() {
  chrome.runtime.sendMessage({ kind: "dl.list" }, (r) => {
    if (chrome.runtime.lastError) {
      $status.textContent = `native host: ${chrome.runtime.lastError.message} — run cargo install zpwrchrome-host && zpwrchrome-host --install <ext-id>`;
      schedule(2000);
      return;
    }
    if (!r?.ok) { $status.textContent = `error: ${r?.err || "unknown"}`; schedule(2000); return; }
    state.jobs = r.jobs || [];
    $status.textContent = "live";
    renderCats();
    renderList();
    renderDrawer();
    const anyActive = state.jobs.some((j) => j.status === "active");
    schedule(anyActive ? 250 : 1500);
  });
}

function schedule(ms) {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(poll, ms);
}

// ── details drawer (Chrono-style right-side panel) ─────────────────
const $main         = document.querySelector(".main");
const $drawer       = document.getElementById("drawer");
const $drawerBody   = document.getElementById("drawer-body");
const $drawerToggle = document.getElementById("drawer-toggle");

let _drawerCollapsed = false;   // user-toggled override; survives until selection change

function renderDrawer() {
  const settings = state.settings;
  const sel  = state.selected;
  const job  = sel != null ? state.jobs.find((j) => j.gid === sel) : null;
  const want = !!job && settings.slideInDetailsOnClick !== false && !_drawerCollapsed;
  if (!want) {
    $main.classList.remove("has-drawer");
    $drawer.hidden = true;
    return;
  }
  $main.classList.add("has-drawer");
  $drawer.hidden = false;

  const name   = basename(job.dest);
  const kind   = classify(name);
  const ico    = { image:"🖼", video:"🎬", audio:"🎵", document:"📄", archive:"🗂", other:"📦" }[kind] || "📄";
  const dir    = (job.dest || "").replace(/\/[^/]+$/, "/");
  const pct    = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const bps    = job.elapsed_ms > 0 ? (job.done * 1000) / job.elapsed_ms : 0;
  const startStr  = job.started_at ? new Date(job.started_at * 1000).toLocaleString() : "—";
  const sizeStr   = job.total > 0
    ? `${fmtBytes(job.done)} / ${fmtBytes(job.total)} (${pct}%)`
    : (job.status === "done" ? fmtBytes(job.done) : `${fmtBytes(job.done)} / ?`);
  const destOnDisk = job.dest_exists !== false;

  $drawerBody.innerHTML = `
    <div class="hd">
      <span class="ico">${ico}</span>
      <span class="nm" title="${escapeHtml(job.dest)}">${escapeHtml(name)}</span>
    </div>
    <div class="sub" title="${escapeHtml(job.dest)}">${escapeHtml(dir)}</div>
    <div class="row"><span class="k">URL</span>       <span class="v"><a href="${escapeHtml(job.url || "#")}" target="_blank" rel="noopener">${escapeHtml(job.url || "")}</a></span></div>
    <div class="row"><span class="k">Status</span>    <span class="v ${job.status === "failed" ? "err" : ""}"><code>${escapeHtml(job.status)}</code>${destOnDisk ? "" : " <code style='color:var(--text-muted);border-color:var(--text-muted);'>file missing</code>"}</span></div>
    <div class="row"><span class="k">File size</span> <span class="v">${escapeHtml(sizeStr)}${job.total > 0 ? ` <span style="color:var(--text-muted);">(${job.total.toLocaleString()} bytes)</span>` : ""}</span></div>
    <div class="row"><span class="k">Segments</span>  <span class="v">${job.segments}</span></div>
    <div class="row"><span class="k">Speed</span>     <span class="v">${job.status === "active" ? fmtSpeed(job.done, job.elapsed_ms) : (job.status === "done" ? `avg ${fmtSpeed(job.done, job.elapsed_ms)}` : "—")}</span></div>
    <div class="row"><span class="k">Elapsed</span>   <span class="v">${fmtElapsed(job.elapsed_ms)}</span></div>
    <div class="row"><span class="k">ETA</span>       <span class="v">${job.status === "active" ? fmtEta(job.done, job.total, bps) : "—"}</span></div>
    <div class="row"><span class="k">Started</span>   <span class="v">${escapeHtml(startStr)}</span></div>
    <div class="row"><span class="k">GID</span>       <span class="v"><code>${job.gid}</code></span></div>
    ${job.err ? `<div class="row"><span class="k">Error</span> <span class="v err">${escapeHtml(job.err)}</span></div>` : ""}
    <div class="drawer-actions">
      ${(job.status === "done" && destOnDisk)
          ? `<button data-act="open"   data-dest="${escapeHtml(job.dest)}">open</button>
             <button data-act="reveal" data-dest="${escapeHtml(job.dest)}">reveal</button>`
          : ""}
      ${job.status === "active" ? `<button data-act="pause"  data-gid="${job.gid}">pause</button>`  : ""}
      ${job.status === "paused" ? `<button data-act="resume" data-gid="${job.gid}">resume</button>` : ""}
      ${(job.status === "failed" || job.status === "cancelled") ? `<button data-act="resume" data-gid="${job.gid}">retry</button>` : ""}
      ${(job.status === "active" || job.status === "paused" || job.status === "pending")
          ? `<button class="danger" data-act="cancel" data-gid="${job.gid}">cancel</button>` : ""}
      <button class="danger" data-act="deselect" title="Close details">close</button>
    </div>
  `;
}

$drawerBody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act], a[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "deselect") { state.selected = null; renderList(); renderDrawer(); return; }
  if (act === "open" || act === "reveal") {
    const kind = act === "open" ? "dl.openFile" : "dl.openDir";
    const dest = btn.dataset.dest || "";
    btn.disabled = true;
    chrome.runtime.sendMessage({ kind, path: dest }, (r) => {
      btn.disabled = false;
      if (!r?.ok) $status.textContent = `${act} failed: ${r?.err || "unknown"}`;
    });
    return;
  }
  const gid = Number(btn.dataset.gid);
  btn.disabled = true;
  const r = await sendAct(act, gid);
  btn.disabled = false;
  if (!r?.ok) $status.textContent = `${act} failed: ${r?.err || "unknown"}`;
  poll();
});

$drawerToggle.addEventListener("click", () => {
  _drawerCollapsed = true;
  renderDrawer();
});

// Re-render drawer whenever the underlying job changes (covers live polling).
const _origRender = renderList;
function renderListAndDrawer() { _origRender(); renderDrawer(); }
// We can't reassign const renderList; instead, append a hook from poll/event callers.

// rehydrate from cached snapshot before first live poll
chrome.runtime.sendMessage({ kind: "dl.snapshot.cached" }, (r) => {
  if (r?.snapshot?.jobs) {
    state.jobs = r.snapshot.jobs;
    $status.textContent = "cached";
    renderCats();
    renderList();
    renderDrawer();
  }
  poll();
});

renderCats();
renderDrawer();
