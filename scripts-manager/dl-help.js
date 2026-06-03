// zpwrchrome — Help page; only side effect is the Panic Button.

import "../lib/page-nav.js";
const PANIC_KEYS = ["dl.settings", "dl.interface", "dl.extFilters", "dl.rules"];

const $btn = document.getElementById("panic");
const $st  = document.getElementById("panic-status");

$btn?.addEventListener("click", async () => {
  if (!confirm("Wipe ALL download-manager state (general, interface, extension filter, rules)? Cannot be undone.")) return;
  await chrome.storage.local.remove(PANIC_KEYS);
  try { await chrome.runtime.sendMessage({ kind: "dl.settings.changed" }); } catch {}
  try { await chrome.runtime.sendMessage({ kind: "dl.interface.changed" }); } catch {}
  $st.textContent = "all download state wiped — reload any open settings page";
  $st.style.color = "var(--accent)";
  $st.classList.add("show");
});
