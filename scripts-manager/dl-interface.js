// zpwrchrome — Interface settings page.
//
// Persists under chrome.storage.local["dl.interface"]. The badge-count
// + notification settings are read directly by background.js.

const KEY = "dl.interface";

export const DL_INTERFACE_DEFAULTS = Object.freeze({
  // Main manager
  openAsStandalone: false,
  startButtonRetriesFailed: true,
  slideInDetailsOnClick: true,
  doubleClickAction: "open-folder",
  filePreviewAutoplay: false,

  // Pop-up
  popupShowDownloadingFirst: true,
  popupCloseAfterClear: false,
  popupMaxItems: 50,
  popupDeleteClickAction: "ask",

  // New Task Dialog
  newTaskFolderPicker: true,

  // Menu (context-menu items)
  menuDownloadAllResources: false,
  menuSaveLinkAs: true,
  menuOneClickDownload: true,

  // Notifications
  notifyOnOneClick: false,
  notifyOnComplete: true,
  notifyOnError: true,
  soundOnComplete: false,
  soundOnError: false,
  largeImagePreview: false,
  notificationClickAction: "open-file",

  // Miscellaneous
  badgeShowCount: true,
  fontSize: 13,
});

export async function loadInterface() {
  try {
    const bag = await chrome.storage.local.get(KEY);
    return { ...DL_INTERFACE_DEFAULTS, ...(bag?.[KEY] || {}) };
  } catch {
    return { ...DL_INTERFACE_DEFAULTS };
  }
}

export async function saveInterface(next) {
  const merged = { ...DL_INTERFACE_DEFAULTS, ...(next || {}) };
  await chrome.storage.local.set({ [KEY]: merged });
  return merged;
}

if (typeof document !== "undefined" && document.querySelector("[data-key]")) {
  bootInterfacePage();
}

function bootInterfacePage() {
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
      if (Number.isNaN(n)) return DL_INTERFACE_DEFAULTS[el.dataset.key];
      const min = parseInt(el.min, 10);
      const max = parseInt(el.max, 10);
      if (!Number.isNaN(min) && n < min) return min;
      if (!Number.isNaN(max) && n > max) return max;
      return n;
    }
    return el.value;
  }

  async function hydrate() {
    const s = await loadInterface();
    for (const el of inputs) applyToInput(el, s[el.dataset.key]);
  }
  async function persist() {
    const s = await loadInterface();
    for (const el of inputs) s[el.dataset.key] = readFromInput(el);
    await saveInterface(s);
    flash("saved");
    try { await chrome.runtime.sendMessage({ kind: "dl.interface.changed" }); } catch {}
  }

  inputs.forEach((el) => {
    el.addEventListener("change", persist);
    if (el.type === "number") el.addEventListener("input", persist);
  });
  $reset?.addEventListener("click", async () => {
    if (!confirm("Reset Interface settings to defaults?")) return;
    await saveInterface({ ...DL_INTERFACE_DEFAULTS });
    await hydrate();
    flash("reset");
    try { await chrome.runtime.sendMessage({ kind: "dl.interface.changed" }); } catch {}
  });

  hydrate();
}
