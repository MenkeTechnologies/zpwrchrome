// zpwrchrome — download settings page.
//
// All settings live in chrome.storage.local["dl.settings"]. Background.js
// reads the same key when intercepting downloads and when responding to
// browser-side hooks (chrome://downloads override, builtin-UI hide).

const KEY = "dl.settings";

export const DL_DEFAULTS = Object.freeze({
  // Chrome section
  overrideDownloadsPage: true,
  hideBuiltInUI: true,

  // New Task Defaults
  saveToLastUsedLocation: true,
  addToFrontOfQueue: false,
  addPaused: false,

  // One-click Download — mirrors the legacy "dl.takeOverDefault" flag.
  oneClickEnabled: true,

  // Network
  maxConcurrent: 20,
  maxPerServer: 5,

  // Miscellaneous
  conflictAction: "prompt",         // "prompt" | "overwrite" | "rename"
  onDirUnsavable: "default",        // "default" | "fail"
  urlFromClipboard: true,
  clearSearchOnFilter: false,
  cancelOnTrash: false,

  // Internal (not user-editable in UI): last directory used by dl.add.
  lastDir: "",
});

export async function loadSettings() {
  try {
    const bag = await chrome.storage.local.get(KEY);
    const got = bag?.[KEY] || {};
    return { ...DL_DEFAULTS, ...got };
  } catch {
    return { ...DL_DEFAULTS };
  }
}

export async function saveSettings(next) {
  const merged = { ...DL_DEFAULTS, ...(next || {}) };
  await chrome.storage.local.set({ [KEY]: merged });
  return merged;
}

// Module-level body only runs in the settings page context. The exports
// above are reusable from downloads.js / background.js without side effects.
if (typeof document !== "undefined" && document.querySelector("[data-key]")) {
  bootSettingsPage();
}

function bootSettingsPage() {
  const inputs = document.querySelectorAll("[data-key]");
  const $status = document.getElementById("status");
  const $reset  = document.getElementById("reset");

  function flash(msg, ok = true) {
    $status.textContent = msg;
    $status.style.color = ok ? "var(--green)" : "var(--accent)";
    $status.classList.add("show");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => $status.classList.remove("show"), 1200);
  }

  function applyToInput(el, val) {
    if (el.type === "checkbox") el.checked = !!val;
    else el.value = String(val);
  }

  function readFromInput(el) {
    if (el.type === "checkbox") return el.checked;
    if (el.type === "number") {
      const n = parseInt(el.value, 10);
      if (Number.isNaN(n)) return DL_DEFAULTS[el.dataset.key];
      const min = parseInt(el.min, 10);
      const max = parseInt(el.max, 10);
      if (!Number.isNaN(min) && n < min) return min;
      if (!Number.isNaN(max) && n > max) return max;
      return n;
    }
    return el.value;
  }

  async function hydrate() {
    const settings = await loadSettings();
    for (const el of inputs) applyToInput(el, settings[el.dataset.key]);
  }

  async function persist() {
    const settings = await loadSettings();
    for (const el of inputs) settings[el.dataset.key] = readFromInput(el);
    await saveSettings(settings);
    flash("saved");
    // Notify the SW so it can re-arm browser-side hooks (override-page,
    // hide-builtin-ui) without waiting for a service-worker restart.
    try { await chrome.runtime.sendMessage({ kind: "dl.settings.changed" }); } catch {}
  }

  inputs.forEach((el) => {
    el.addEventListener("change", persist);
    if (el.type === "number") el.addEventListener("input", persist);
  });

  $reset?.addEventListener("click", async () => {
    if (!confirm("Reset all download settings to defaults?")) return;
    await saveSettings({ ...DL_DEFAULTS });
    await hydrate();
    flash("reset");
    try { await chrome.runtime.sendMessage({ kind: "dl.settings.changed" }); } catch {}
  });

  hydrate();
}
