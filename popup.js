// zpwrchrome — popup
const $q       = document.getElementById("q");
const $mru     = document.getElementById("mru");
const $closed  = document.getElementById("closed");

let state = { mru: [], closed: [], filter: "", sel: 0, flat: [] };

function host(u) { try { return new URL(u).hostname; } catch { return ""; } }

function matches(filter, t) {
  if (!filter) return true;
  const f = filter.toLowerCase();
  return (t.title || "").toLowerCase().includes(f)
      || (t.url   || "").toLowerCase().includes(f)
      || host(t.url || "").toLowerCase().includes(f);
}

function render() {
  const f = state.filter.trim();
  const mru    = state.mru.filter((t) => matches(f, t));
  const closed = state.closed
    .map((s) => s.tab || s.window?.tabs?.[0])
    .filter(Boolean)
    .filter((t) => matches(f, t));

  state.flat = [
    ...mru.map((t) => ({ kind: "open", tab: t })),
    ...closed.map((t, i) => ({ kind: "closed", tab: t, sessionId: state.closed[i].tab?.sessionId || state.closed[i].window?.sessionId }))
  ];

  $mru.innerHTML    = mru.length    ? "" : `<li class="empty">no matches</li>`;
  $closed.innerHTML = closed.length ? "" : `<li class="empty">no recently closed tabs</li>`;

  let flatIdx = 0;
  for (const t of mru) {
    $mru.appendChild(makeRow(t, flatIdx++, "open"));
  }
  for (let i = 0; i < closed.length; i++) {
    const sessionId = state.closed[i].tab?.sessionId || state.closed[i].window?.sessionId;
    $closed.appendChild(makeRow(closed[i], flatIdx++, "closed", sessionId));
  }

  if (state.sel >= state.flat.length) state.sel = Math.max(0, state.flat.length - 1);
  updateSel();
}

function makeRow(t, idx, kind, sessionId) {
  const li = document.createElement("li");
  li.dataset.idx = String(idx);
  li.dataset.kind = kind;
  if (kind === "open")   li.dataset.tabId = String(t.id);
  if (kind === "closed") li.dataset.sessionId = sessionId;
  if (t.active) li.classList.add("active-tab");

  const img = document.createElement("img");
  img.className = "favicon";
  img.src = t.favIconUrl || "";
  img.onerror = () => { img.style.visibility = "hidden"; };
  if (!img.src) img.style.visibility = "hidden";

  const meta = document.createElement("div");
  meta.className = "meta-col";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = t.title || t.url || "(untitled)";
  const url = document.createElement("span");
  url.className = "url";
  url.textContent = host(t.url || "") || t.url || "";
  meta.append(title, url);

  const x = document.createElement("span");
  x.className = "x";
  x.textContent = "×";
  x.title = kind === "open" ? "close tab" : "forget";
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    if (kind === "open") chrome.runtime.sendMessage({ kind: "close-tab", tabId: t.id }, refresh);
    else { state.closed = state.closed.filter((s) => (s.tab?.sessionId || s.window?.sessionId) !== sessionId); render(); }
  });

  li.append(img, meta, x);
  li.addEventListener("click", () => activate(idx));
  return li;
}

function updateSel() {
  const rows = document.querySelectorAll(".tab-list li");
  rows.forEach((r) => r.classList.remove("sel"));
  const row = document.querySelector(`.tab-list li[data-idx="${state.sel}"]`);
  if (row) {
    row.classList.add("sel");
    row.scrollIntoView({ block: "nearest" });
  }
}

function activate(idx) {
  const e = state.flat[idx];
  if (!e) return;
  if (e.kind === "open")   chrome.runtime.sendMessage({ kind: "activate", tabId: e.tab.id }, () => window.close());
  if (e.kind === "closed") chrome.runtime.sendMessage({ kind: "restore",  sessionId: e.sessionId }, () => window.close());
}

function refresh() {
  chrome.runtime.sendMessage({ kind: "list" }, (resp) => {
    if (!resp) return;
    state.mru = resp.mru || [];
    state.closed = resp.closed || [];
    render();
  });
}

$q.addEventListener("input", (e) => {
  state.filter = e.target.value;
  state.sel = 0;
  render();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    state.sel = Math.min(state.flat.length - 1, state.sel + 1);
    updateSel();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    state.sel = Math.max(0, state.sel - 1);
    updateSel();
  } else if (e.key === "Enter") {
    e.preventDefault();
    activate(state.sel);
  } else if (e.key === "Delete" || (e.key === "Backspace" && e.shiftKey)) {
    const entry = state.flat[state.sel];
    if (entry?.kind === "open") {
      e.preventDefault();
      chrome.runtime.sendMessage({ kind: "close-tab", tabId: entry.tab.id }, refresh);
    }
  } else if (e.key === "Escape") {
    if ($q.value) { $q.value = ""; state.filter = ""; state.sel = 0; render(); }
    else window.close();
  }
});

refresh();
