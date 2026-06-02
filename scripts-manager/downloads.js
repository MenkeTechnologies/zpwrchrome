// zpwrchrome download queue UI.
//
// Polls dl.list 5x/s while jobs are active; backs off to 1/s when idle.
// Phase 6 (push events) replaces this with a long-lived port subscription.

const $queue  = document.getElementById("queue");
const $status = document.getElementById("status");

function fmtBytes(n) {
  if (!n || n <= 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
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
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function row(job) {
  const pct = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const bytesPerSec = job.elapsedMs > 0 ? (job.done * 1000) / job.elapsedMs : 0;
  const wrap = document.createElement("div");
  wrap.className = "dl-row";
  wrap.innerHTML = `
    <div>
      <div class="url">${escapeHtml(job.url)}</div>
      <div class="meta">
        <span class="status-tag ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
        <span>gid ${job.gid}</span>
        <span>${fmtBytes(job.done)} / ${job.total > 0 ? fmtBytes(job.total) : "?"} (${pct}%)</span>
        <span>${fmtSpeed(job.done, job.elapsedMs)}</span>
        <span>ETA ${fmtEta(job.done, job.total, bytesPerSec)}</span>
        <span>${job.segments} seg</span>
        <span class="dest">${escapeHtml(job.dest || "")}</span>
      </div>
      ${job.err ? `<div class="err">${escapeHtml(job.err)}</div>` : ""}
    </div>
    <div class="actions">
      ${job.status === "active" ? `<button data-act="pause"  data-gid="${job.gid}">pause</button>`  : ""}
      ${job.status === "paused" ? `<button data-act="resume" data-gid="${job.gid}">resume</button>` : ""}
      ${(job.status === "active" || job.status === "paused" || job.status === "pending")
         ? `<button class="danger" data-act="cancel" data-gid="${job.gid}">cancel</button>` : ""}
    </div>
    <div class="dl-bar"><div class="fill" style="width: ${pct}%;"></div></div>
  `;
  return wrap;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let lastRender = 0;
function render(jobs) {
  // Newest first. Pending/active at top, done/cancelled/failed at bottom.
  const order = { active: 0, paused: 1, pending: 2, failed: 3, cancelled: 4, done: 5 };
  const sorted = [...jobs].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.gid - a.gid);
  $queue.replaceChildren();
  if (!sorted.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "no downloads yet — paste a URL or right-click a link → Download with zpwrchrome";
    $queue.appendChild(empty);
    return;
  }
  for (const job of sorted) $queue.appendChild(row(job));
  lastRender = Date.now();
}

$queue.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const gid = Number(btn.dataset.gid);
  const act = btn.dataset.act;
  chrome.runtime.sendMessage({ kind: `dl.${act}`, gid }, (r) => {
    if (chrome.runtime.lastError || !r?.ok) {
      $status.textContent = `${act} failed: ${r?.err || chrome.runtime.lastError?.message || "unknown"}`;
      return;
    }
    poll();
  });
});

document.getElementById("addUrl")?.addEventListener("click", () => {
  const url = prompt("URL to download:");
  if (!url) return;
  chrome.runtime.sendMessage({ kind: "dl.add", url }, (r) => {
    if (chrome.runtime.lastError || !r?.ok) {
      $status.textContent = `add failed: ${r?.err || chrome.runtime.lastError?.message}`;
      return;
    }
    poll();
  });
});

document.getElementById("pauseAll")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ kind: "dl.list" }, (r) => {
    if (!r?.ok) return;
    const active = (r.jobs || []).filter((j) => j.status === "active");
    Promise.all(active.map((j) => new Promise((res) => {
      chrome.runtime.sendMessage({ kind: "dl.pause", gid: j.gid }, () => res());
    }))).then(poll);
  });
});

document.getElementById("resumeAll")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ kind: "dl.list" }, (r) => {
    if (!r?.ok) return;
    const paused = (r.jobs || []).filter((j) => j.status === "paused");
    Promise.all(paused.map((j) => new Promise((res) => {
      chrome.runtime.sendMessage({ kind: "dl.resume", gid: j.gid }, () => res());
    }))).then(poll);
  });
});

// Live-update path: when the host pushes progress, background.js fans it
// out as {kind:"dl.event", event:{kind:"dl.progress", jobs:[...]}}. Render
// immediately and reset the poll backoff so a stalled host still recovers.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind !== "dl.event") return;
  const evt = msg.event;
  if (evt?.kind === "dl.progress" && Array.isArray(evt.jobs)) {
    $status.textContent = "live";
    render(evt.jobs);
  }
});

let pollTimer = null;
function poll() {
  chrome.runtime.sendMessage({ kind: "dl.list" }, (r) => {
    if (chrome.runtime.lastError) {
      $status.textContent = `native host: ${chrome.runtime.lastError.message} — run host/install.sh <ext-id>`;
      return;
    }
    if (!r?.ok) {
      $status.textContent = `error: ${r?.err || "unknown"}`;
      return;
    }
    $status.textContent = "live";
    render(r.jobs || []);
    const anyActive = (r.jobs || []).some((j) => j.status === "active");
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, anyActive ? 200 : 1500);
  });
}

// Re-hydrate from the cached snapshot the SW mirrored to chrome.storage.local
// so the queue paints instantly even if the SW is asleep at popup-open time.
// Stale cache is fine — the live poll/event stream overrides within a tick.
chrome.runtime.sendMessage({ kind: "dl.snapshot.cached" }, (r) => {
  if (r?.snapshot?.jobs) {
    const ageMs = Date.now() - (r.snapshot.ts || 0);
    $status.textContent = `cached (${Math.floor(ageMs / 1000)}s old)`;
    render(r.snapshot.jobs);
  }
  poll();
});
