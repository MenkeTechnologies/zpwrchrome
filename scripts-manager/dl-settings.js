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
  // Default folder for new downloads. Empty = use host default (~/Downloads
  // on macOS/Linux). User-set explicit value wins over saveToLastUsedLocation.
  // Tildes are expanded host-side.
  downloadDir: "",
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

  // Pass autofill
  passAutoSubmit: false,

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

  // "Open this folder" reveals the currently-typed downloadDir in Finder.
  document.getElementById("dd-open")?.addEventListener("click", () => {
    const path = document.querySelector('[data-key="downloadDir"]').value.trim();
    chrome.runtime.sendMessage({ kind: "dl.openDir", path }, (r) => {
      if (!r?.ok) flash(`open dir failed: ${r?.err || "unknown"}`, false);
      else        flash(`opened ${r.opened || "folder"}`);
    });
  });
  // "Reset to host default" clears the field so the host falls back to ~/Downloads.
  document.getElementById("dd-reset")?.addEventListener("click", async () => {
    const el = document.querySelector('[data-key="downloadDir"]');
    el.value = "";
    await persist();
  });

  // Pass keyboard shortcuts — populated from chrome.commands.getAll() so the
  // user sees their current binding (defaults included). Chrome controls
  // rebinding; we just send them to the right page.
  const $kbRows = document.getElementById("kb-rows");
  const $openShortcuts = document.getElementById("open-shortcuts");
  if ($kbRows && chrome.commands?.getAll) {
    chrome.commands.getAll((cmds) => {
      const wanted = [
        ["pass-fill",       "Autofill best-matching pass entry"],
        ["pass-open-popup", "Open popup → Pass category"],
        ["pass-copy-pw",    "Copy password to clipboard"],
        ["pass-copy-user",  "Copy username to clipboard"],
        ["pass-copy-otp",   "Copy TOTP code to clipboard"],
        ["pass-open-url",   "Open URL stored in pass entry"],
      ];
      const map = new Map((cmds || []).map((c) => [c.name, c.shortcut || ""]));
      $kbRows.innerHTML = wanted.map(([name, label]) => {
        const sc = (map.get(name) || "").trim();
        const kbd = sc
          ? sc.split(/\s*\+\s*/).map((k) => `<kbd>${k}</kbd>`).join("+")
          : `<span style="color: var(--text-muted);">(unbound)</span>`;
        return `<tr><td>${label}<br><code style="color: var(--text-muted); font-size: 11px;">${name}</code></td><td>${kbd}</td></tr>`;
      }).join("");
    });
  }
  $openShortcuts?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  hydrate();
}
