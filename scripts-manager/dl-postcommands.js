// zpwrchrome — Post-download Commands settings page.
//
// Each row maps a basename glob to an argv-style command. Persists under
// chrome.storage.local["dl.postCommands"] as { rules: [...] }. The SW's
// download-completion hook (background.js → runPostDownloadCommand)
// matches first-rule-wins on the finished file's path.

import "../lib/page-nav.js";
import { STATE_KEY, DEFAULTS } from "../lib/dl-postcommands.js";

async function loadState() {
  try {
    const bag = await chrome.storage.local.get(STATE_KEY);
    const got = bag?.[STATE_KEY];
    if (got && Array.isArray(got.rules)) return got;
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULTS));
}

async function saveState(next) {
  const obj = { rules: Array.isArray(next?.rules) ? next.rules : [] };
  await chrome.storage.local.set({ [STATE_KEY]: obj });
  return obj;
}

function newId() {
  // Sufficient uniqueness for a UI-side row identity — collisions don't
  // matter for matching (we key on order), only for keying React-style
  // diffs that aren't used here.
  return `r_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

if (typeof document !== "undefined" && document.getElementById("pc-rows")) {
  boot();
}

function boot() {
  const $rows   = document.getElementById("pc-rows");
  const $add    = document.getElementById("add-row");
  const $reset  = document.getElementById("reset");
  const $status = document.getElementById("status");

  function flash(msg, ok = true) {
    $status.textContent = msg;
    $status.style.color = ok ? "var(--green)" : "var(--accent)";
    $status.classList.add("show");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => $status.classList.remove("show"), 1200);
  }

  function rowEl(rule, i, total) {
    const tr = document.createElement("tr");
    tr.dataset.idx = String(i);
    tr.dataset.id  = rule.id;
    tr.innerHTML = `
      <td class="ck">
        <input type="checkbox" data-field="enabled" ${rule.enabled !== false ? "checked" : ""}>
      </td>
      <td class="ck">
        <input type="checkbox" data-field="confirm" ${rule.confirm ? "checked" : ""}>
      </td>
      <td><input type="text" data-field="name"    value="${escapeAttr(rule.name || "")}"    placeholder="e.g. extract zips"></td>
      <td><input type="text" data-field="glob"    value="${escapeAttr(rule.glob || "")}"    placeholder="*.zip"></td>
      <td><input type="text" data-field="command" value="${escapeAttr(rule.command || "")}" placeholder="unzip -d {dir} {path}"></td>
      <td class="reorder">
        <button class="arrow" data-act="up"   ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
        <button class="arrow" data-act="down" ${i === total - 1 ? "disabled" : ""} title="Move down">↓</button>
      </td>
      <td><button class="del" data-act="del" title="Delete this rule">✕</button></td>
    `;
    return tr;
  }

  function readRows() {
    const out = [];
    for (const tr of $rows.querySelectorAll("tr")) {
      const enabled = tr.querySelector('[data-field="enabled"]').checked;
      const confirm = tr.querySelector('[data-field="confirm"]').checked;
      const name    = tr.querySelector('[data-field="name"]').value;
      const glob    = tr.querySelector('[data-field="glob"]').value.trim();
      const command = tr.querySelector('[data-field="command"]').value;
      const id      = tr.dataset.id || newId();
      // Keep rows even when empty so the user can edit incrementally;
      // only matching requires a non-empty glob + command at runtime.
      out.push({ id, enabled, confirm, name, glob, command });
    }
    return out;
  }

  async function hydrate(rules) {
    const r = rules || (await loadState()).rules;
    $rows.innerHTML = "";
    r.forEach((rule, i) => $rows.appendChild(rowEl(rule, i, r.length)));
  }

  async function persist() {
    const rules = readRows();
    await saveState({ rules });
    flash("saved");
  }

  $rows.addEventListener("change", persist);
  let _t;
  $rows.addEventListener("input", (e) => {
    if (e.target.tagName === "INPUT" && e.target.type === "text") {
      clearTimeout(_t); _t = setTimeout(persist, 250);
    }
  });

  $rows.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const tr = btn.closest("tr");
    const i  = Number(tr.dataset.idx);
    const rules = readRows();
    if (btn.dataset.act === "up" && i > 0) {
      [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
    } else if (btn.dataset.act === "down" && i < rules.length - 1) {
      [rules[i], rules[i + 1]] = [rules[i + 1], rules[i]];
    } else if (btn.dataset.act === "del") {
      rules.splice(i, 1);
    } else {
      return;
    }
    await saveState({ rules });
    await hydrate(rules);
    flash(btn.dataset.act === "del" ? "deleted" : "reordered");
  });

  $add?.addEventListener("click", async () => {
    const rules = readRows();
    rules.push({
      id: newId(), enabled: true, confirm: false,
      name: "", glob: "", command: "",
    });
    await saveState({ rules });
    await hydrate(rules);
    flash("row added");
  });

  $reset?.addEventListener("click", async () => {
    if (!confirm("Clear ALL post-download command rules?")) return;
    await saveState({ rules: [] });
    await hydrate([]);
    flash("cleared");
  });

  hydrate();
}
