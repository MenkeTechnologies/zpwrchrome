// zpwrchrome — downloads manager.
//
// Sidebar-nav over BP `dl.list` snapshots. Polls 5×/s while anything is
// active, backs off to 1/s when idle. Re-hydrates from the SW's cached
// snapshot before the first live poll so the list paints instantly.

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
};

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
  const sec = Math.round((total - done) / bytesPerSec);
  if (sec < 60) return `${sec}s`;
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

// ── category filter ─────────────────────────────────────────────────

function filterJobs() {
  const cat = state.category;
  const f   = state.filter.trim().toLowerCase();
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

    // text filter
    if (f) {
      const haystack = (name + " " + (j.url || "")).toLowerCase();
      if (!haystack.includes(f)) return false;
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
  const escName    = escapeHtml(name || "(unnamed)");
  const escUrl     = escapeHtml(job.url || "");
  const escDest    = escapeHtml(job.dest || "");
  const dateStr    = fmtDate(job.started_at);

  return `
    <div class="dl-row k-${kind}${isSel ? " sel" : ""}" data-gid="${job.gid}" tabindex="0">
      <span class="ico">${ICONS[kind] || "📄"}</span>
      <div class="body">
        <span class="name" title="${escDest}">${escName}</span>
        <span class="url"  title="${escUrl}">${escUrl}</span>
        <span class="meta">
          <span class="stat-tag ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
          <span>${sizeStr}</span>
          ${showSpeed ? `<span>${fmtSpeed(job.done, job.elapsed_ms)}</span>` : ""}
          ${showEta   ? `<span>ETA ${fmtEta(job.done, job.total, bps)}</span>` : ""}
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

function renderList() {
  const jobs = filterJobs();
  // Newest first within each category: pending/active/paused first then by gid desc.
  const order = { pending: 0, active: 1, paused: 2, failed: 3, cancelled: 4, done: 5 };
  jobs.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.gid - a.gid);

  if (!jobs.length) {
    const msg = state.filter
      ? `no downloads match "${escapeHtml(state.filter)}"`
      : (state.category === "all"
          ? "no downloads yet — bind <kbd>dl-paste-url</kbd> or right-click a link → Download with zpwrchrome"
          : `no ${escapeHtml(state.category)} downloads`);
    $list.innerHTML = `<div class="empty">${msg}</div>`;
  } else {
    $list.innerHTML = jobs.map(rowHtml).join("");
  }
  $count.textContent = `${jobs.length} item${jobs.length === 1 ? "" : "s"}`;
}

// ── actions ─────────────────────────────────────────────────────────

function sendAct(action, gid) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ kind: `dl.${action}`, gid: Number(gid) }, (r) => {
      if (chrome.runtime.lastError) { resolve({ ok: false, err: chrome.runtime.lastError.message }); return; }
      resolve(r || { ok: false, err: "no response" });
    });
  });
}

$list.addEventListener("click", async (e) => {
  const actBtn = e.target.closest("button[data-act]");
  if (actBtn) {
    e.stopPropagation();
    const gid = Number(actBtn.dataset.gid);
    const act = actBtn.dataset.act;
    actBtn.disabled = true;
    const r = await sendAct(act, gid);
    actBtn.disabled = false;
    if (!r?.ok) $status.textContent = `${act} failed: ${r?.err || "unknown"}`;
    poll();
    return;
  }
  const row = e.target.closest(".dl-row");
  if (row) {
    const gid = Number(row.dataset.gid);
    state.selected = state.selected === gid ? null : gid;
    document.querySelectorAll(".dl-row").forEach((r) => r.classList.toggle("sel", Number(r.dataset.gid) === state.selected));
  }
});

document.querySelectorAll(".cat").forEach((el) => {
  el.addEventListener("click", () => {
    state.category = el.dataset.cat;
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
document.getElementById("t-clear-done").addEventListener("click", () => {
  // Client-side hide: switch to a category that excludes done.
  state.category = "downloading";
  renderCats();
  renderList();
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
  }
});

function poll() {
  chrome.runtime.sendMessage({ kind: "dl.list" }, (r) => {
    if (chrome.runtime.lastError) {
      $status.textContent = `native host: ${chrome.runtime.lastError.message} — run cargo install browserpass-host-rs && browserpass-host-rs --install <ext-id>`;
      schedule(2000);
      return;
    }
    if (!r?.ok) { $status.textContent = `error: ${r?.err || "unknown"}`; schedule(2000); return; }
    state.jobs = r.jobs || [];
    $status.textContent = "live";
    renderCats();
    renderList();
    const anyActive = state.jobs.some((j) => j.status === "active");
    schedule(anyActive ? 250 : 1500);
  });
}

function schedule(ms) {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(poll, ms);
}

// rehydrate from cached snapshot before first live poll
chrome.runtime.sendMessage({ kind: "dl.snapshot.cached" }, (r) => {
  if (r?.snapshot?.jobs) {
    state.jobs = r.snapshot.jobs;
    $status.textContent = "cached";
    renderCats();
    renderList();
  }
  poll();
});

renderCats();
