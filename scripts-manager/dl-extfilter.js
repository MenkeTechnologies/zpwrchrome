// zpwrchrome — Extension Filter settings page.
//
// Persists buckets under chrome.storage.local["dl.extFilters"] as
// { rows: [{ enabled, name, internal, extensions }, …] }.
// downloads.js (and the Rule System engine) consult these buckets when
// classifying finished jobs.

import "../lib/page-nav.js";
const KEY = "dl.extFilters";

export const DL_EXTFILTER_DEFAULTS = Object.freeze({
  rows: [
    { enabled: true,  name: "Image",       internal: "ext_image", extensions: "bmp|cur|dds|exr|gif|ico|jpg|jpeg|pcx|pbm|pgm|png|ppm|psd|svg|tga|tif|tiff|webp|heic|avif" },
    { enabled: true,  name: "Video",       internal: "ext_video", extensions: "3gp|3g2|asf|avi|f4f|f4i|f4m|f4v|flv|h264|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|rm|rmvb|ts|vob|webm|wmv" },
    { enabled: true,  name: "Audio",       internal: "ext_audio", extensions: "aac|aif|ape|flac|m4a|mid|mp3|oga|ogg|opus|m3u|alac|wav|wma" },
    { enabled: true,  name: "Document",    internal: "ext_doc",   extensions: "c|cfg|cpp|cs|css|csv|dat|doc|docx|h|hpp|html|ini|java|js|json|md|odp|ods|odt|pdf|ppt|pptx|py|rb|rs|rtf|sh|sql|tex|toml|ts|txt|xls|xlsx|xml|yaml|yml" },
    { enabled: true,  name: "Archive",     internal: "ext_arch",  extensions: "7z|bin|cbr|cue|deb|dmg|gz|iso|mdf|pkg|rar|rpm|tar|tbz|tbz2|tgz|xz|z|zip|zst" },
    { enabled: true,  name: "Application", internal: "ext_app",   extensions: "apk|app|bat|cgi|com|dll|exe|gadget|jar|msi|wsf|sh|cmd|ps1|elf|pkg" },
    { enabled: false, name: "All",         internal: "ext_all",   extensions: "[ext_audio]|[ext_video]|[ext_image]|[ext_doc]|[ext_arch]|[ext_app]" },
  ],
});

export async function loadExtFilters() {
  try {
    const bag = await chrome.storage.local.get(KEY);
    const got = bag?.[KEY];
    if (got && Array.isArray(got.rows) && got.rows.length) return got;
  } catch {}
  return JSON.parse(JSON.stringify(DL_EXTFILTER_DEFAULTS));
}

export async function saveExtFilters(next) {
  const obj = next && Array.isArray(next.rows) ? { rows: next.rows } : { rows: [] };
  await chrome.storage.local.set({ [KEY]: obj });
  return obj;
}

// Resolve a filename's bucket. Returns the matching `internal` name or null.
export function bucketFor(filename, filters) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (!ext) return null;
  for (const row of filters.rows) {
    if (!row.enabled || row.internal === "ext_all") continue;
    const set = String(row.extensions || "").toLowerCase().split("|").map((s) => s.trim()).filter(Boolean);
    if (set.includes(ext)) return row.internal;
  }
  return null;
}

if (typeof document !== "undefined" && document.getElementById("ext-rows")) {
  bootExtPage();
}

function bootExtPage() {
  const $rows   = document.getElementById("ext-rows");
  const $status = document.getElementById("status");
  const $reset  = document.getElementById("reset");
  const $add    = document.getElementById("add-row");

  function flash(msg, ok = true) {
    $status.textContent = msg;
    $status.style.color = ok ? "var(--green)" : "var(--accent)";
    $status.classList.add("show");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => $status.classList.remove("show"), 1200);
  }

  function rowEl(row, i) {
    const tr = document.createElement("tr");
    tr.dataset.idx = String(i);
    tr.innerHTML = `
      <td class="ck"><input type="checkbox" data-field="enabled" ${row.enabled ? "checked" : ""}></td>
      <td><input type="text" data-field="name" value="${escapeAttr(row.name)}"></td>
      <td><input type="text" data-field="internal" value="${escapeAttr(row.internal)}"></td>
      <td><input type="text" data-field="extensions" value="${escapeAttr(row.extensions)}"></td>
    `;
    return tr;
  }

  function readRows() {
    const out = [];
    for (const tr of $rows.querySelectorAll("tr")) {
      const enabled = tr.querySelector("[data-field='enabled']").checked;
      const name = tr.querySelector("[data-field='name']").value.trim();
      const internal = tr.querySelector("[data-field='internal']").value.trim();
      const extensions = tr.querySelector("[data-field='extensions']").value.trim();
      if (!name && !internal && !extensions) continue;
      out.push({ enabled, name, internal, extensions });
    }
    return out;
  }

  async function hydrate() {
    const cfg = await loadExtFilters();
    $rows.innerHTML = "";
    cfg.rows.forEach((row, i) => $rows.appendChild(rowEl(row, i)));
  }
  async function persist() {
    await saveExtFilters({ rows: readRows() });
    flash("saved");
  }
  $rows.addEventListener("change", persist);
  $rows.addEventListener("input",  (e) => { if (e.target.type === "text") debounced(); });
  let _t;
  function debounced() { clearTimeout(_t); _t = setTimeout(persist, 250); }

  $add?.addEventListener("click", async () => {
    const cur = readRows();
    cur.push({ enabled: true, name: "", internal: "", extensions: "" });
    await saveExtFilters({ rows: cur });
    await hydrate();
    flash("row added");
  });
  $reset?.addEventListener("click", async () => {
    if (!confirm("Reset Extension Filter to defaults?")) return;
    await saveExtFilters(JSON.parse(JSON.stringify(DL_EXTFILTER_DEFAULTS)));
    await hydrate();
    flash("reset");
  });

  hydrate();
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[c]));
}
