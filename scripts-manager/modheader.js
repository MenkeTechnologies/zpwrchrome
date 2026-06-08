// zpwrchrome — modheader controller.

import "../lib/page-nav.js";

const $ = (id) => document.getElementById(id);

const state = {
  bag: null,    // persisted state from SW
  dnr: [],      // current DNR rule projection (for the "live DNR" readout)
};

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message || "runtime error"));
      if (!resp || resp.ok === false) return reject(new Error(resp?.err || "bridge error"));
      resolve(resp);
    });
  });
}

function setStatus(text, cls = "") {
  const el = $("status");
  el.textContent = text;
  el.className = cls || "dim";
  if (cls === "ok") setTimeout(() => { if (el.textContent === text) el.textContent = "—"; }, 1800);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function activeProfile() {
  return state.bag?.profiles?.find((p) => p.id === state.bag.activeProfileId);
}

function renderHeader() {
  const enabled = !!state.bag?.enabled;
  $("enabled").checked = enabled;
  $("toggle-label").textContent = enabled ? "on" : "off";
  $("cur-status").textContent = enabled ? "active" : "off";
  $("cur-status").className = enabled ? "val" : "val off";
  const ap = activeProfile();
  $("cur-profile").textContent = ap ? ap.name : "—";
  $("cur-dnr").textContent = String(state.dnr?.length || 0) + " rule(s)";
}

function renderProfiles() {
  const list = state.bag?.profiles || [];
  const active = state.bag?.activeProfileId;
  $("profile-list").innerHTML = list.map((p) => {
    const enabledCount = (p.rules || []).filter((r) => r.enabled).length;
    return `
      <div class="profile${p.id === active ? " active" : ""}" data-id="${escapeHtml(p.id)}">
        <span class="dot" style="background:${escapeHtml(p.color || "#05d9e8")}"></span>
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="count">${enabledCount}/${p.rules?.length || 0}</span>
      </div>`;
  }).join("");
  $("profile-list").querySelectorAll(".profile").forEach((el) => {
    el.addEventListener("click", () => pickProfile(el.dataset.id));
  });
  const ap = activeProfile();
  $("rules-title").textContent = ap ? `Rules — ${ap.name}` : "Rules";
}

function renderRules() {
  const ap = activeProfile();
  const rules = ap?.rules || [];
  if (!rules.length) {
    $("rules-list").innerHTML = `<div class="empty">no rules · add one with the buttons above</div>`;
    return;
  }
  $("rules-list").innerHTML = rules.map((r) => {
    const showOp = r.kind !== "redirect";
    const labelKind = r.kind === "response" ? "RES" : r.kind === "redirect" ? "REDIR" : "REQ";
    const namePlaceholder = r.kind === "redirect" ? "(unused)" : "header name";
    const valuePlaceholder = r.kind === "redirect" ? "https://destination.example/$1" : "header value";
    return `
      <div class="rule kind-${escapeHtml(r.kind)}${r.enabled ? "" : " disabled"}" data-id="${escapeHtml(r.id)}">
        <label class="check"><input type="checkbox" data-act="toggle" ${r.enabled ? "checked" : ""}></label>
        <div class="kind">${labelKind}</div>
        <input type="text" data-field="name"  placeholder="${namePlaceholder}" value="${escapeHtml(r.name || "")}" ${r.kind === "redirect" ? "disabled" : ""}>
        <input type="text" data-field="value" placeholder="${valuePlaceholder}" value="${escapeHtml(r.value || "")}">
        <input type="text" data-field="urlFilter" placeholder="url filter (default *)" value="${escapeHtml(r.urlFilter || "")}">
        ${showOp ? `
          <select data-field="operation">
            <option value="set"    ${r.operation === "set"    ? "selected" : ""}>set</option>
            <option value="append" ${r.operation === "append" ? "selected" : ""}>append</option>
            <option value="remove" ${r.operation === "remove" ? "selected" : ""}>remove</option>
          </select>` : `<span class="dim">—</span>`}
        <button class="col-del" data-act="delete" title="Delete rule">✕</button>
      </div>`;
  }).join("");

  $("rules-list").querySelectorAll(".rule").forEach((row) => {
    const id = row.dataset.id;
    row.querySelectorAll("input[type='text'], select").forEach((input) => {
      input.addEventListener("change", () => {
        const patch = { [input.dataset.field]: input.value };
        updateRule(id, patch);
      });
    });
    row.querySelector("[data-act='toggle']").addEventListener("change", (ev) => {
      updateRule(id, { enabled: ev.target.checked });
    });
    row.querySelector("[data-act='delete']").addEventListener("click", () => deleteRule(id));
  });
}

function render() {
  renderHeader();
  renderProfiles();
  renderRules();
}

// ─── Actions ────────────────────────────────────────────────────────
async function refresh() {
  const r = await send({ kind: "modheader.get" });
  state.bag = r.state;
  state.dnr = r.dnr || [];
  render();
}

async function setEnabled(v) {
  try {
    const r = await send({ kind: "modheader.set", patch: { enabled: !!v } });
    state.bag = r.state;
    // re-fetch DNR projection
    const g = await send({ kind: "modheader.get" });
    state.dnr = g.dnr || [];
    render();
    setStatus(v ? "enabled" : "disabled", "ok");
  } catch (e) { setStatus(e.message, "err"); }
}

async function pickProfile(id) {
  try {
    const r = await send({ kind: "modheader.set", patch: { activeProfileId: id } });
    state.bag = r.state;
    const g = await send({ kind: "modheader.get" });
    state.dnr = g.dnr || [];
    render();
    setStatus("switched to " + (activeProfile()?.name || id), "ok");
  } catch (e) { setStatus(e.message, "err"); }
}

async function addProfile() {
  const name = prompt("Profile name:", "New profile");
  if (!name) return;
  try {
    const r = await send({ kind: "modheader.profile.add", name });
    state.bag = r.state;
    const g = await send({ kind: "modheader.get" });
    state.dnr = g.dnr || [];
    render();
    setStatus("profile created", "ok");
  } catch (e) { setStatus(e.message, "err"); }
}

async function renameProfile() {
  const ap = activeProfile();
  if (!ap) return;
  const name = prompt("Rename profile:", ap.name);
  if (!name || name === ap.name) return;
  try {
    const r = await send({ kind: "modheader.profile.update", id: ap.id, patch: { name } });
    state.bag = r.state;
    render();
    setStatus("renamed", "ok");
  } catch (e) { setStatus(e.message, "err"); }
}

async function deleteProfile() {
  const ap = activeProfile();
  if (!ap) return;
  if (!confirm(`Delete profile "${ap.name}" and all its rules?`)) return;
  try {
    const r = await send({ kind: "modheader.profile.delete", id: ap.id });
    state.bag = r.state;
    const g = await send({ kind: "modheader.get" });
    state.dnr = g.dnr || [];
    render();
    setStatus("deleted", "ok");
  } catch (e) { setStatus(e.message, "err"); }
}

async function addRule(kind) {
  const ap = activeProfile();
  if (!ap) { setStatus("no active profile", "err"); return; }
  try {
    const r = await send({ kind: "modheader.rule.add", profileId: ap.id, rule: { kind } });
    state.bag = r.state;
    const g = await send({ kind: "modheader.get" });
    state.dnr = g.dnr || [];
    render();
    setStatus("rule added", "ok");
  } catch (e) { setStatus(e.message, "err"); }
}

async function updateRule(ruleId, patch) {
  const ap = activeProfile();
  if (!ap) return;
  try {
    const r = await send({ kind: "modheader.rule.update", profileId: ap.id, ruleId, patch });
    state.bag = r.state;
    const g = await send({ kind: "modheader.get" });
    state.dnr = g.dnr || [];
    // Only re-render header counts and skip the full rules list to avoid
    // stealing focus from the active input the user is typing into.
    renderHeader();
    renderProfiles();
  } catch (e) { setStatus(e.message, "err"); }
}

async function deleteRule(ruleId) {
  const ap = activeProfile();
  if (!ap) return;
  try {
    const r = await send({ kind: "modheader.rule.delete", profileId: ap.id, ruleId });
    state.bag = r.state;
    const g = await send({ kind: "modheader.get" });
    state.dnr = g.dnr || [];
    render();
    setStatus("rule deleted", "ok");
  } catch (e) { setStatus(e.message, "err"); }
}

// ─── Wire up ────────────────────────────────────────────────────────
$("enabled").addEventListener("change", (ev) => setEnabled(ev.target.checked));
$("b-add-profile").addEventListener("click",    addProfile);
$("b-rename-profile").addEventListener("click", renameProfile);
$("b-delete-profile").addEventListener("click", deleteProfile);
$("b-add-req").addEventListener("click",   () => addRule("request"));
$("b-add-res").addEventListener("click",   () => addRule("response"));
$("b-add-redir").addEventListener("click", () => addRule("redirect"));

refresh();
