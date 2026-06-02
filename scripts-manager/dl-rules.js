// zpwrchrome — Rule System settings page.
//
// Stores rules + match mode + default mask under chrome.storage.local["dl.rules"].
// Schema:
//   { matchMode: "first"|"all", defaultMask: "*name*.*ext*",
//     rows: [{ active, asTasksFilter, name, internal, condition, mask }] }

const KEY = "dl.rules";

export const DL_RULES_DEFAULTS = Object.freeze({
  matchMode: "first",
  defaultMask: "*name*.*ext*",
  rows: [
    { active: true,  asTasksFilter: true,  name: "Recent",      internal: "r_recent",      condition: "*time_add* >= [3_days_ago]",         mask: "" },
    { active: true,  asTasksFilter: true,  name: "Downloading", internal: "r_downloading", condition: "*state* != [finished] && *state* != [interrupted]", mask: "" },
    { active: true,  asTasksFilter: true,  name: "Finished",    internal: "r_done",        condition: "*state* == [finished]",              mask: "" },
    { active: true,  asTasksFilter: true,  name: "Image",       internal: "r_done_image",  condition: "{r_done} && *ext*.is([ext_image])",  mask: "" },
    { active: true,  asTasksFilter: true,  name: "Video",       internal: "r_done_video",  condition: "{r_done} && *ext*.is([ext_video])",  mask: "" },
    { active: true,  asTasksFilter: true,  name: "Audio",       internal: "r_done_audio",  condition: "{r_done} && *ext*.is([ext_audio])",  mask: "" },
    { active: true,  asTasksFilter: true,  name: "Document",    internal: "r_done_doc",    condition: "{r_done} && *ext*.is([ext_doc])",    mask: "" },
    { active: true,  asTasksFilter: true,  name: "Other",       internal: "r_done_other",  condition: "{r_done} && !*ext*.is([ext_audio]) && !*ext*.is([ext_video]) && !*ext*.is([ext_image]) && !*ext*.is([ext_doc])", mask: "" },
    { active: true,  asTasksFilter: true,  name: "Failed",      internal: "r_failed",      condition: "*state* == [interrupted]",           mask: "" },
    { active: false, asTasksFilter: false, name: "Small Files", internal: "r_smallf",      condition: "*size* > 0 && *size* < [kb(1024)]",  mask: "" },
  ],
});

export async function loadRules() {
  try {
    const bag = await chrome.storage.local.get(KEY);
    const got = bag?.[KEY];
    if (got && Array.isArray(got.rows) && got.rows.length) return { ...DL_RULES_DEFAULTS, ...got };
  } catch {}
  return JSON.parse(JSON.stringify(DL_RULES_DEFAULTS));
}

export async function saveRules(next) {
  const obj = {
    matchMode:   next?.matchMode === "all" ? "all" : "first",
    defaultMask: String(next?.defaultMask ?? "*name*.*ext*"),
    rows:        Array.isArray(next?.rows) ? next.rows : [],
  };
  await chrome.storage.local.set({ [KEY]: obj });
  return obj;
}

if (typeof document !== "undefined" && document.getElementById("rule-rows")) {
  bootRulesPage();
}

function bootRulesPage() {
  const $rows = document.getElementById("rule-rows");
  const $mode = document.getElementById("match-mode");
  const $mask = document.getElementById("default-mask");
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
      <td class="ck"><input type="checkbox" data-field="active" ${row.active ? "checked" : ""}></td>
      <td class="ck"><input type="checkbox" data-field="asTasksFilter" ${row.asTasksFilter ? "checked" : ""}></td>
      <td><input type="text" data-field="name" value="${escapeAttr(row.name)}"></td>
      <td><input type="text" data-field="internal" value="${escapeAttr(row.internal)}"></td>
      <td><input type="text" data-field="condition" value="${escapeAttr(row.condition)}"></td>
      <td><input type="text" data-field="mask" value="${escapeAttr(row.mask)}"></td>
    `;
    return tr;
  }

  function readState() {
    const rows = [];
    for (const tr of $rows.querySelectorAll("tr")) {
      const active = tr.querySelector("[data-field='active']").checked;
      const asTasksFilter = tr.querySelector("[data-field='asTasksFilter']").checked;
      const name = tr.querySelector("[data-field='name']").value.trim();
      const internal = tr.querySelector("[data-field='internal']").value.trim();
      const condition = tr.querySelector("[data-field='condition']").value;
      const mask = tr.querySelector("[data-field='mask']").value;
      if (!name && !internal && !condition.trim()) continue;
      rows.push({ active, asTasksFilter, name, internal, condition, mask });
    }
    return {
      matchMode: $mode.value === "all" ? "all" : "first",
      defaultMask: $mask.value,
      rows,
    };
  }

  async function hydrate() {
    const cfg = await loadRules();
    $rows.innerHTML = "";
    cfg.rows.forEach((row, i) => $rows.appendChild(rowEl(row, i)));
    $mode.value = cfg.matchMode || "first";
    $mask.value = cfg.defaultMask || "*name*.*ext*";
  }
  async function persist() { await saveRules(readState()); flash("saved"); }
  let _t;
  function debounced() { clearTimeout(_t); _t = setTimeout(persist, 250); }

  $rows.addEventListener("change", persist);
  $rows.addEventListener("input",  (e) => { if (e.target.type === "text") debounced(); });
  $mode.addEventListener("change", persist);
  $mask.addEventListener("input", debounced);

  $add?.addEventListener("click", async () => {
    const cur = readState();
    cur.rows.push({ active: true, asTasksFilter: true, name: "", internal: "", condition: "", mask: "" });
    await saveRules(cur);
    await hydrate();
    flash("rule added");
  });
  $reset?.addEventListener("click", async () => {
    if (!confirm("Reset Rule System to defaults?")) return;
    await saveRules(JSON.parse(JSON.stringify(DL_RULES_DEFAULTS)));
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
