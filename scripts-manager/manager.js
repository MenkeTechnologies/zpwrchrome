import { parseMetadata, validateUserscript, userscriptId } from "../lib/userscript.js";

const $list      = document.getElementById("list");
const $newBtn    = document.getElementById("new-script");
const $importBtn = document.getElementById("import-script");
const $fileInput = document.getElementById("file-input");
const $modal     = document.getElementById("editor-modal");
const $editor    = document.getElementById("editor");
const $editTitle = document.getElementById("editor-title");
const $editMeta  = document.getElementById("editor-meta");
const $editSave  = document.getElementById("editor-save");
const $editCancel= document.getElementById("editor-cancel");
const $error     = document.getElementById("error");
const $errorDtl  = document.getElementById("error-detail");

let editing = null; // currently-editing script object or null for new

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

async function refresh() {
  const resp = await send({ kind: "scripts.list" });
  if (resp.error) {
    $error.classList.remove("hidden");
    $errorDtl.textContent = resp.error;
  } else {
    $error.classList.add("hidden");
  }
  renderList(resp.scripts || []);
}

function renderList(scripts) {
  if (!scripts.length) {
    $list.innerHTML = `<div class="empty">no scripts installed — click <strong>+ new script</strong></div>`;
    return;
  }
  $list.innerHTML = scripts.map((s) => {
    const meta = parseMetadata(s.src) || { matches: [], includes: [], version: "" };
    const matches = [...meta.matches, ...meta.includes].slice(0, 4).join(" · ");
    const more = (meta.matches.length + meta.includes.length) > 4 ? ` +${meta.matches.length + meta.includes.length - 4} more` : "";
    return `
      <div class="script${s.enabled ? "" : " disabled"}" data-id="${escapeHtml(s.id)}">
        <div class="toggle" data-action="toggle" title="enable/disable"></div>
        <div class="info">
          <div class="name">${escapeHtml(meta.name || "(unnamed)")} <span class="meta">v${escapeHtml(meta.version || "")}</span></div>
          <div class="meta">${escapeHtml(meta.description || "")}</div>
          <div class="matches">${escapeHtml(matches)}${escapeHtml(more)}</div>
        </div>
        <div class="row-actions">
          <button data-action="edit">edit</button>
          <button data-action="delete" class="delete">delete</button>
        </div>
      </div>
    `;
  }).join("");

  $list.querySelectorAll(".script").forEach((el) => {
    el.addEventListener("click", async (e) => {
      const action = e.target.dataset.action;
      const id = el.dataset.id;
      if (action === "toggle") {
        const enabled = el.classList.contains("disabled");
        await send({ kind: "scripts.toggle", id, enabled });
        refresh();
      } else if (action === "delete") {
        if (!confirm("delete this script?")) return;
        await send({ kind: "scripts.delete", id });
        refresh();
      } else if (action === "edit") {
        const resp = await send({ kind: "scripts.list" });
        const s = (resp.scripts || []).find((x) => x.id === id);
        openEditor(s);
      }
    });
  });
}

function openEditor(script) {
  editing = script || null;
  $editor.value = script ? script.src : $editor.placeholder;
  $editTitle.textContent = script ? `edit · ${script.name || ""}` : "new script";
  $modal.classList.remove("hidden");
  $editor.focus();
  updateEditorMeta();
}

function closeEditor() {
  $modal.classList.add("hidden");
  editing = null;
}

function updateEditorMeta() {
  const meta = parseMetadata($editor.value);
  if (!meta) {
    $editMeta.innerHTML = `<span class="bad">no ==UserScript== block</span>`;
    return;
  }
  const errs = validateUserscript(meta);
  const bits = [
    `<strong>${escapeHtml(meta.name || "(no name)")}</strong>`,
    meta.version && `v${escapeHtml(meta.version)}`,
    `runAt: ${escapeHtml(meta.runAt)}`,
    meta.matches.length && `${meta.matches.length} match`,
    meta.includes.length && `${meta.includes.length} include`,
    meta.grants.length && `grants: ${escapeHtml(meta.grants.join(", "))}`
  ].filter(Boolean).join(" · ");
  if (errs.length) {
    $editMeta.innerHTML = bits + ` · <span class="bad">${escapeHtml(errs.join("; "))}</span>`;
  } else {
    $editMeta.innerHTML = bits + ` · <span class="ok">valid</span>`;
  }
}

$editor.addEventListener("input", updateEditorMeta);

$editSave.addEventListener("click", async () => {
  const src = $editor.value;
  const meta = parseMetadata(src);
  const errs = validateUserscript(meta);
  if (errs.length) {
    alert("can't save:\n" + errs.join("\n"));
    return;
  }
  const id = editing?.id || userscriptId(meta);
  const resp = await send({
    kind: "scripts.save",
    script: { ...(editing || {}), id, src, enabled: editing ? editing.enabled : true }
  });
  if (!resp.ok) {
    alert("save failed:\n" + (resp.errors || []).join("\n"));
    return;
  }
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

$importBtn.addEventListener("click", () => $fileInput.click());
$fileInput.addEventListener("change", async () => {
  const file = $fileInput.files[0];
  if (!file) return;
  const src = await file.text();
  openEditor({ src });
  $fileInput.value = "";
});

refresh();
