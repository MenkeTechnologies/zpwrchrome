// zpwrchrome — "Turn off the lights" content script.
//
// Port of the Turn Off the Lights Chrome extension: dim the entire
// page with a near-black overlay and lift any <video> elements above
// it so they appear in spotlight. Toggle via the lights-off command,
// the toolbar context menu "Turn off the lights", or the settings
// page's preview button. Click the overlay or press Esc to undim.
//
// Content scripts can't `import`, so the helpers from
// lib/lights-off-css.js are duplicated inline in a minimal form.

(function () {
  "use strict";

  const OVERLAY_ID = "zpwr-lights-off-overlay";
  const LIFT_ATTR  = "data-zpwr-lights-lifted";
  const STATE_KEY  = "lights.off";
  const MAX_Z      = 2147483647;
  const OVERLAY_Z  = 2147483646;

  const DEFAULTS = {
    opacity: 0.85, fadeMs: 300, color: "#000000",
    mode: "all", domains: [], autoOn: false, liftPlayer: true,
  };

  function hostnameOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  }
  function shouldApply(host, s) {
    const mode = (s && s.mode) || "all";
    const domains = ((s && s.domains) || []).map((d) => String(d).toLowerCase());
    const h = String(host || "").toLowerCase();
    const matches = domains.some((d) => h === d || h.endsWith("." + d));
    if (mode === "all" || mode === "blocklist") return !matches;
    if (mode === "allowlist") return matches;
    return false;
  }
  function clampOpacity(v) {
    const n = Number(v);
    if (!isFinite(n)) return DEFAULTS.opacity;
    return Math.max(0, Math.min(1, n));
  }
  function buildOverlayStyles(o) {
    const ms = Math.max(0, Math.min(60000, Number(o.fadeMs) || 0));
    return [
      "position: fixed !important", "inset: 0 !important",
      "top: 0 !important", "left: 0 !important",
      "right: 0 !important", "bottom: 0 !important",
      "width: 100vw !important", "height: 100vh !important",
      `background-color: ${o.color || "#000"} !important`,
      "opacity: 0 !important",
      `z-index: ${OVERLAY_Z} !important`,
      "cursor: pointer !important",
      `transition: opacity ${ms}ms ease-in-out !important`,
      "pointer-events: auto !important",
      "margin: 0 !important", "padding: 0 !important",
      "border: none !important", "outline: none !important",
      "display: block !important",
    ].join("; ");
  }

  // Lift one element + its ancestor chain so every container's
  // stacking context can compete with the overlay. Each touched
  // element is tagged with LIFT_ATTR so restoreAll() knows what to
  // revert — we never mutate elements we don't tag.
  function liftAncestors(el) {
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (!node.hasAttribute(LIFT_ATTR)) {
        const prevZ = node.style.zIndex || "";
        const prevP = node.style.position || "";
        node.setAttribute(LIFT_ATTR, JSON.stringify({ z: prevZ, p: prevP }));
        node.style.setProperty("z-index", String(MAX_Z), "important");
        const cs = getComputedStyle(node);
        if (cs.position === "static") {
          node.style.setProperty("position", "relative", "important");
        }
      }
      node = node.parentElement;
    }
  }
  function restoreAll() {
    document.querySelectorAll(`[${LIFT_ATTR}]`).forEach((el) => {
      let saved = {};
      try { saved = JSON.parse(el.getAttribute(LIFT_ATTR) || "{}"); } catch {}
      if (saved.z) el.style.zIndex = saved.z; else el.style.removeProperty("z-index");
      if (saved.p) el.style.position = saved.p; else el.style.removeProperty("position");
      el.removeAttribute(LIFT_ATTR);
    });
  }

  function pickVideos() {
    // Visible <video> elements only — skip 0×0 hidden players that
    // sites preload for autoplay analytics.
    return Array.from(document.querySelectorAll("video")).filter((v) => {
      const r = v.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  // ─── Public ops ─────────────────────────────────────────────────
  function show(settings) {
    const s = { ...DEFAULTS, ...(settings || {}) };
    if (!shouldApply(location.hostname, s)) return;
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.setAttribute("role", "presentation");
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText = buildOverlayStyles(s);
      overlay.addEventListener("click", hide, { once: false });
      (document.documentElement || document.body).appendChild(overlay);
      requestAnimationFrame(() => {
        overlay.style.setProperty("opacity", String(clampOpacity(s.opacity)), "important");
      });
    }
    pickVideos().forEach(liftAncestors);
    document.addEventListener("keydown", onEsc, true);
  }

  function hide() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      const ms = parseFloat(getComputedStyle(overlay).transitionDuration) * 1000 || 0;
      overlay.style.setProperty("opacity", "0", "important");
      setTimeout(() => { overlay.remove(); restoreAll(); }, ms);
    } else {
      restoreAll();
    }
    document.removeEventListener("keydown", onEsc, true);
  }

  function toggle() {
    if (document.getElementById(OVERLAY_ID)) { hide(); return; }
    chrome.storage?.local?.get?.(STATE_KEY, (bag) => show(bag?.[STATE_KEY]));
  }

  function onEsc(ev) { if (ev.key === "Escape") hide(); }

  // ─── Message bridge ─────────────────────────────────────────────
  chrome.runtime?.onMessage?.addListener?.((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "lights-off:toggle") { toggle(); sendResponse({ ok: true }); }
    else if (msg.type === "lights-off:on")  { show(msg.settings); sendResponse({ ok: true }); }
    else if (msg.type === "lights-off:off") { hide(); sendResponse({ ok: true }); }
  });

  // Expose for the settings-page preview button (set via
  // chrome.scripting.executeScript world: "MAIN" if needed; the
  // window assignment is harmless if MAIN world isn't used).
  window.__zpwrLightsOff = { show, hide, toggle };
})();
