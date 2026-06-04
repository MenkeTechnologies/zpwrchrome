// zpwrchrome — shared global navigation strip.
//
// Auto-injected as the first child of <body> by every page that imports
// this module. One source of truth for cross-page links, including the
// Chrome-internal extension page (which depends on chrome.runtime.id, so
// it has to be computed at load time).

const LINKS = [
  { key: "downloads",   label: "downloads",   href: "/scripts-manager/downloads.html" },
  { key: "settings",    label: "settings",    href: "/scripts-manager/dl-settings.html" },
  { key: "interface",   label: "interface",   href: "/scripts-manager/dl-interface.html" },
  { key: "extfilter",   label: "extension filter", href: "/scripts-manager/dl-extfilter.html" },
  { key: "rules",       label: "rule system", href: "/scripts-manager/dl-rules.html" },
  { key: "userscripts", label: "userscripts", href: "/scripts-manager/manager.html" },
  { key: "pass",        label: "pass",        href: "/scripts-manager/pass.html" },
  { key: "diagnostics", label: "diagnostics", href: "/scripts-manager/dl-diag.html" },
  { key: "help",        label: "help",        href: "/scripts-manager/dl-help.html" },
  { key: "about",       label: "about",       href: "/scripts-manager/dl-about.html" },
];

function pageKeyFromPath() {
  const p = (location.pathname || "").toLowerCase();
  if (p.endsWith("downloads.html"))     return "downloads";
  if (p.endsWith("dl-settings.html"))   return "settings";
  if (p.endsWith("dl-interface.html"))  return "interface";
  if (p.endsWith("dl-extfilter.html"))  return "extfilter";
  if (p.endsWith("dl-rules.html"))      return "rules";
  if (p.endsWith("dl-diag.html"))       return "diagnostics";
  if (p.endsWith("dl-help.html"))       return "help";
  if (p.endsWith("dl-about.html"))      return "about";
  if (p.endsWith("manager.html"))       return "userscripts";
  if (p.endsWith("pass.html"))          return "pass";
  return null;
}

function buildNav(activeKey) {
  const nav = document.createElement("nav");
  nav.className = "zpc-globalnav";
  const brand = document.createElement("a");
  brand.className = "zpc-globalnav-brand";
  brand.href = chrome.runtime.getURL("/scripts-manager/downloads.html");
  brand.textContent = "zpwrchrome";
  brand.title = "Open the download manager";
  nav.appendChild(brand);

  for (const link of LINKS) {
    const a = document.createElement("a");
    a.className = "zpc-globalnav-link" + (link.key === activeKey ? " active" : "");
    a.href = chrome.runtime.getURL(link.href);
    a.textContent = link.label;
    a.dataset.nav = link.key;
    nav.appendChild(a);
  }

  // chrome://extensions/?id=<ourId> link — has to use chrome.tabs.create
  // because <a href="chrome://..."> is blocked in extension pages.
  const ext = document.createElement("a");
  ext.className = "zpc-globalnav-link zpc-globalnav-ext";
  ext.href = "#";
  ext.textContent = "extensions ▸";
  ext.title = "Open this extension's chrome://extensions page";
  ext.addEventListener("click", (e) => {
    e.preventDefault();
    const url = `chrome://extensions/?id=${chrome.runtime.id}`;
    chrome.tabs.create({ url });
  });
  nav.appendChild(ext);

  return nav;
}

function ensureStyles() {
  if (document.getElementById("zpc-globalnav-style")) return;
  const css = `
    .zpc-globalnav {
      display: flex; align-items: center; gap: 14px;
      background: var(--bg-primary, #05050a);
      border-bottom: 1px solid var(--border, #1a1a3e);
      padding: 6px 14px;
      font-family: 'Share Tech Mono', 'SF Mono', monospace;
      font-size: 11px;
      letter-spacing: 1px;
      flex-wrap: wrap;
    }
    .zpc-globalnav-brand {
      color: var(--accent, #ff2a6d);
      text-decoration: none;
      font-weight: 700;
      letter-spacing: 2px;
      margin-right: 4px;
    }
    .zpc-globalnav-brand:hover { color: var(--cyan, #05d9e8); }
    .zpc-globalnav-link {
      color: var(--text-dim, #7a8ba8);
      text-decoration: none;
      padding: 2px 6px;
      border-bottom: 1px solid transparent;
      transition: color 0.1s, border-color 0.1s;
    }
    .zpc-globalnav-link:hover { color: var(--cyan, #05d9e8); border-bottom-color: var(--cyan, #05d9e8); }
    .zpc-globalnav-link.active {
      color: var(--cyan, #05d9e8);
      border-bottom-color: var(--cyan, #05d9e8);
      font-weight: 700;
    }
    .zpc-globalnav-ext { margin-left: auto; color: var(--magenta, #d300c5); }
    .zpc-globalnav-ext:hover { color: var(--accent, #ff2a6d); border-bottom-color: var(--accent, #ff2a6d); }
    /* Reserve a row in pages that use display:grid for the body so the nav
       doesn't squash the rest of the layout. */
    body { --zpc-globalnav-h: 32px; }
  `;
  const tag = document.createElement("style");
  tag.id = "zpc-globalnav-style";
  tag.textContent = css;
  document.head.appendChild(tag);
}

export function injectGlobalNav() {
  if (document.querySelector(".zpc-globalnav")) return;
  ensureStyles();
  const nav = buildNav(pageKeyFromPath());
  document.body.insertBefore(nav, document.body.firstChild);
}

if (typeof document !== "undefined" && document.body) {
  injectGlobalNav();
} else if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", injectGlobalNav, { once: true });
}
