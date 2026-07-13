/* zpwrchrome — the zwire command palette on every dashboard page. SAME palette
 * as the HUD (hud-internal/zpalette.js) and the New Tab (newtab/palette.js): the
 * item source is the SHARED palette-cmds.js (ZWIRE_PALETTE_CMDS) so the three
 * surfaces can't drift, rendered by zgui-core's ZGui.palette.
 *
 * Opened ONLY by hud-internal's ⌘K router: hud owns ⌘K browser-wide as a
 * chrome.commands shortcut, and when the active tab is a zpwrchrome page it
 * cross-ext-messages our service worker, which relays { kind: 'zpc.open-palette' }
 * to this page. There is NO local ⌘K keydown here on purpose — outside zwire
 * there is no ⌘K owner and the palette has no meaning, so it simply never opens.
 *
 * Being an extension page (tabs / history perms) it opens destinations directly
 * with chrome.tabs; host-backed custom commands (shell / stryke / host) bridge to
 * hud-internal exactly as the New Tab palette does. Classic script (window.ZGui);
 * loaded after the zgui-core bundle by lib/page-nav.js. */
(function () {
  'use strict';
  var PC = window.ZWIRE_PALETTE_CMDS || {};
  var HUD_ID = 'omcgnnjfmbmpdlofklbpddkhnfibfhgg';   // hud-internal — host-command + custom-cmd bridge

  /* -------- overlay CSS (verbatim from the other palettes; inherits our --vars) */
  var PALETTE_CSS = [
    '.palette-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.6);display:flex;',
    ' justify-content:center;padding-top:12vh;font-family:"Share Tech Mono",Monaco,monospace;}',
    '.palette-box{width:min(580px,92vw);max-height:60vh;background:var(--bg-primary);border:1px solid var(--cyan);',
    ' box-shadow:0 0 60px var(--cyan-glow),0 20px 60px rgba(0,0,0,.5);border-radius:4px;display:flex;flex-direction:column;overflow:hidden;}',
    '.palette-input{width:100%;padding:14px 18px;background:var(--bg-card);border:none;border-bottom:1px solid var(--border);',
    ' color:var(--text);font-size:15px;font-family:inherit;outline:none;}',
    '.palette-input::placeholder{color:var(--text-muted,var(--text-dim));}',
    '.palette-results{overflow-y:auto;max-height:calc(60vh - 50px);padding:4px 0;}',
    '.palette-row{display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;}',
    '.palette-row:hover,.palette-selected{background:var(--cyan-dim);}',
    '.palette-icon{font-size:16px;width:22px;text-align:center;flex-shrink:0;}',
    '.palette-name{flex:1;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.palette-detail{font-size:11px;color:var(--text-muted,var(--text-dim));max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}',
    'mark.fzf-hl{background:transparent;color:var(--cyan);font-weight:700;}'
  ].join('');
  var styleEl;
  function ensureStyle() { if (!styleEl) { styleEl = document.createElement('style'); document.head.appendChild(styleEl); styleEl.textContent = PALETTE_CSS; } }

  // Open a destination. zpwrchrome dashboards are tool pages, so unlike the
  // disposable new-tab we open in a NEW tab rather than navigating this one away.
  function open(url) { try { chrome.tabs.create({ url: url }); } catch (e) { try { location.href = url; } catch (x) {} } }
  function clip(t) { try { navigator.clipboard.writeText(t); } catch (e) {} }

  /* -------- navigable destinations (chrome:// + settings), same set as the HUD */
  var CHROME = [['+', 'New tab', 'chrome://newtab'], ['▼', 'Downloads', 'chrome://downloads'],
    ['◷', 'History', 'chrome://history'], ['★', 'Bookmarks', 'chrome://bookmarks'],
    ['⬡', 'Extensions', 'chrome://extensions'], ['⚙', 'Settings', 'chrome://settings'],
    ['⚉', 'Version', 'chrome://version'], ['⚙', 'System', 'chrome://system'],
    ['⚑', 'Flags', 'chrome://flags'], ['⌨', 'Keyboard shortcuts', 'chrome://extensions/shortcuts'],
    ['⚿', 'Passwords', 'chrome://password-manager'], ['◎', 'Inspect devices', 'chrome://inspect'],
    ['§', 'Policy', 'chrome://policy'], ['⊛', 'Components', 'chrome://components'],
    ['▤', 'GPU', 'chrome://gpu'], ['⇅', 'Net internals', 'chrome://net-internals'],
    ['≡', 'All chrome:// pages', 'chrome://about']];
  var SETTINGS = [['You & Google', 'chrome://settings/syncSetup'], ['Appearance', 'chrome://settings/appearance'],
    ['Autofill & passwords', 'chrome://settings/autofill'], ['Payment methods', 'chrome://settings/payments'],
    ['Privacy & security', 'chrome://settings/privacy'], ['Site settings', 'chrome://settings/content'],
    ['Clear browsing data', 'chrome://settings/clearBrowserData'], ['Performance', 'chrome://settings/performance'],
    ['Search engine', 'chrome://settings/search'], ['Downloads', 'chrome://settings/downloads'],
    ['Accessibility', 'chrome://settings/accessibility'], ['System', 'chrome://settings/system']];

  function items() {
    var out = [];
    if (PC.makeZpwrItems) PC.makeZpwrItems(open).forEach(function (it) { out.push(it); });   // zpwrchrome tools
    CHROME.forEach(function (p) { out.push({ icon: p[0], label: 'Open: ' + p[1], detail: p[2], run: function () { open(p[2]); } }); });
    SETTINGS.forEach(function (p) { out.push({ icon: '⚙', label: 'Settings: ' + p[0], detail: p[1], run: function () { open(p[1]); } }); });
    return out;
  }

  /* -------- custom commands (shared cmd-defaults) + host bridge to hud-internal */
  var customCache = [];
  function bridgeHost(req, cb) { try { chrome.runtime.sendMessage(HUD_ID, { type: 'zb-host', req: req }, function (res) { void chrome.runtime.lastError; if (cb) cb(res); }); } catch (e) { if (cb) cb({ ok: false, err: String(e) }); } }
  function bridgeAction(action) { try { chrome.runtime.sendMessage(HUD_ID, { type: 'zbAction', action: action }, function () { void chrome.runtime.lastError; }); } catch (e) {} }
  function osKind() { var p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase(); if (p.indexOf('win') >= 0) return 'win'; if (p.indexOf('mac') >= 0 || p.indexOf('darwin') >= 0) return 'mac'; return 'nix'; }
  function shellReq(cmd) { var os = osKind(); if (os === 'win') return { cmd: 'exec', program: 'cmd.exe', args: ['/d', '/s', '/c', cmd] }; var path = (os === 'mac') ? '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' : '/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin'; return { cmd: 'exec', program: '/bin/sh', args: ['-c', cmd], env: { PATH: path } }; }
  function b64dec(s) { try { return s ? decodeURIComponent(escape(atob(s))) : ''; } catch (e) { try { return s ? atob(s) : ''; } catch (x) { return ''; } } }
  function toast(text, bad) {
    try { if (window.ZGui && ZGui.toast) { ZGui.toast.show(text); return; } } catch (e) {}
    var d = document.createElement('div'); d.textContent = text;
    d.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:var(--bg-card,#0a0d16);color:' + (bad ? 'var(--accent,#ff2a6d)' : 'var(--cyan,#05d9e8)') + ';border:1px solid currentColor;padding:8px 12px;font:12px "Share Tech Mono",monospace;border-radius:4px;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    (document.body || document.documentElement).appendChild(d); setTimeout(function () { try { d.remove(); } catch (e) {} }, 3200);
  }
  function toastReply(label, prefix, res, b64) {
    if (!res || !res.ok) { toast(label + ': ' + ((res && res.err) || 'no response'), true); return; }
    var r = res.reply || {}; if (!b64 && r.ok === false) { toast(label + ': ' + (r.err || 'error'), true); return; }
    var dec = b64 ? b64dec : function (s) { return s || ''; };
    var out = dec(r.stdout).trim(), er = dec(r.stderr).trim(), bad = (r.code != null && r.code !== 0) || r.timedOut, text = out || er;
    toast(prefix + (text ? ' ◂ ' + text.slice(0, 160) : (bad ? ' (exit ' + r.code + ')' : ' ✓')), bad);
  }
  // The 'js' step runs user JavaScript. MV3's default CSP forbids eval/new Function
  // in this realm, so relay the code to the manifest-declared sandbox page (its own
  // CSP allows unsafe-eval + modals) via a hidden, reused iframe and eval it there.
  var _zjsFrame = null, _zjsReady = false, _zjsN = 0, _zjsQ = [], _zjsBound = false;
  function zjsRun(code, arg) {
    if (!_zjsBound) {
      _zjsBound = true;
      window.addEventListener('message', function (e) {
        var d = e.data;
        if (d && d.zjs === 1 && d.ok === false) { try { console.error('zwire custom js:', d.err); } catch (x) {} }
      });
    }
    var msg = { zjs: 1, id: 'j' + (++_zjsN), code: String(code || ''), arg: arg || '' };
    if (_zjsReady && _zjsFrame && _zjsFrame.contentWindow) { _zjsFrame.contentWindow.postMessage(msg, '*'); return; }
    _zjsQ.push(msg);
    if (_zjsFrame) return;
    _zjsFrame = document.createElement('iframe');
    _zjsFrame.src = chrome.runtime.getURL('sandbox/js-run.html');
    _zjsFrame.setAttribute('aria-hidden', 'true');
    _zjsFrame.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;border:0;opacity:0;';
    _zjsFrame.addEventListener('load', function () {
      _zjsReady = true;
      var cw = _zjsFrame.contentWindow;
      _zjsQ.forEach(function (m) { try { cw.postMessage(m, '*'); } catch (x) {} });
      _zjsQ = [];
    });
    (document.body || document.documentElement).appendChild(_zjsFrame);
  }
  function runStep(type, v, arg) {
    v = v || '';
    if (type === 'scheme') { try { chrome.storage.local.set({ 'ui.scheme': v }); } catch (e) {} return; }
    if (type === 'js') { zjsRun(v, arg); return; }
    if (type === 'action') { if (v === 'reload') { try { location.reload(); } catch (x) {} } else if (v === 'copyUrl') { clip(location.href); } else { bridgeAction({ a: v }); } return; }
    if (type === 'stryke') { var sc = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v); bridgeHost({ cmd: 'stryke_run', code: sc }, function (res) { toastReply('stryke', '⟨stryke⟩', res, false); }); return; }
    if (type === 'shell') { var c = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v); bridgeHost(shellReq(c), function (res) { toastReply('shell', '$ ' + c, res, true); }); return; }
    if (type === 'applescript') { if (osKind() !== 'mac') { toast('applescript: macOS only', true); return; } var as = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : v; var aargs = []; String(as).split('\n').forEach(function (line) { aargs.push('-e'); aargs.push(line); }); bridgeHost({ cmd: 'exec', program: 'osascript', args: aargs }, function (res) { toastReply('applescript', '⟨osa⟩', res, true); }); return; }
    if (type === 'batch') { var bc = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : (arg ? v + ' ' + arg : v); bridgeHost({ cmd: 'exec', program: 'cmd.exe', args: ['/d', '/s', '/c', bc] }, function (res) { toastReply('batch', 'cmd> ' + bc, res, true); }); return; }
    if (type === 'host') { var raw = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, arg || '') : v; var obj; try { obj = JSON.parse(raw); } catch (err) { toast('host: invalid JSON', true); return; } bridgeHost(obj, function (res) { if (!res || !res.ok) { toast('host: ' + ((res && res.err) || 'no response'), true); return; } var r = res.reply; toast('host ◂ ' + (r && typeof r === 'object' ? JSON.stringify(r).slice(0, 140) : String(r))); }); return; }
    var url = v.indexOf('{q}') >= 0 ? v.replace(/\{q\}/g, encodeURIComponent(arg || '')) : v;   // url (default)
    if (url) open(url);
  }
  function entrySteps(e) { if (e && Array.isArray(e.steps)) return e.steps; if (e && e.type) return [{ type: e.type, value: e.value }]; return []; }
  function runCustom(e, arg) { entrySteps(e).forEach(function (s, i) { setTimeout(function () { try { runStep(s.type, s.value, arg); } catch (x) {} }, i * 140); }); }

  var CMDCTX = { runCustom: runCustom, typeLabel: PC.typeLabel, isDefaultCmd: PC.isDefaultCmd };
  var searchProvider = PC.makeSearchProvider ? PC.makeSearchProvider(open) : function () { return []; };
  var customProvider = PC.makeCustomProvider ? PC.makeCustomProvider(function () { return customCache; }, CMDCTX) : function () { return []; };
  function customItems(list) { return PC.makeCustomItems ? PC.makeCustomItems(list, CMDCTX) : []; }
  function refreshPalette() { try { var inp = document.querySelector('.palette-input'); if (inp) inp.dispatchEvent(new Event('input')); } catch (e) {} }
  function evalStryke(code, cb) { bridgeHost({ cmd: 'stryke_run', code: code }, function (res) { if (!res || !res.ok) { cb({ err: (res && res.err) || 'no response' }); return; } var r = res.reply || {}; if (!r.ok) { cb({ err: r.err || 'error' }); return; } cb({ out: (r.stdout || '').replace(/\s+$/, '') || (r.stderr || '').trim() }); }); }
  var computeProvider = PC.makeComputeProvider ? PC.makeComputeProvider({ copy: clip, toast: function (t) { toast(t); }, evalStryke: evalStryke, refresh: refreshPalette }) : function () { return []; };
  function getRates(cb) { try { chrome.runtime.sendMessage(HUD_ID, { type: 'zwireGetRates' }, function (r) { void chrome.runtime.lastError; cb(r); }); } catch (e) { cb(null); } }

  // Custom commands are authored on hud-internal's Commands page; storage is
  // per-extension, so pull the authoritative list (incl. user additions) from hud
  // over cross-ext messaging. Fall back to the vendored shipped defaults if hud's
  // worker is unreachable (older hud, or a suspended worker).
  function seedCustom(cb) {
    var done = false;
    function local() { if (done) return; done = true; customCache = (window.ZWIRE_CMD_DEFAULTS || []).slice(); cb(); }
    try {
      chrome.runtime.sendMessage(HUD_ID, { type: 'zwireGetCmds' }, function (resp) {
        void chrome.runtime.lastError;
        if (done) return;
        if (resp && Array.isArray(resp.cmds)) { done = true; customCache = resp.cmds; cb(); } else local();
      });
      setTimeout(local, 500);
    } catch (e) { local(); }
  }

  function frecentItems(cb) {
    if (!chrome.history) { cb([]); return; }
    try {
      var now = Date.now();
      chrome.history.search({ text: '', maxResults: 500, startTime: now - 1000 * 60 * 60 * 24 * 90 }, function (h) {
        void chrome.runtime.lastError;
        var scored = (h || []).map(function (x) { var ageDays = (now - (x.lastVisitTime || 0)) / (1000 * 60 * 60 * 24); return { title: x.title || x.url, url: x.url, score: ((x.visitCount || 1) + 2 * (x.typedCount || 0)) / (1 + ageDays * 0.3) }; }).filter(function (x) { return x.url && x.url.indexOf('chrome') !== 0; });
        scored.sort(function (a, b) { return b.score - a.score; });
        cb(scored.slice(0, 30).map(function (x) { return { icon: '★', label: (x.title || x.url), detail: x.url, run: function () { open(x.url); } }; }));
      });
    } catch (e) { cb([]); }
  }
  function tabItems(cb) {
    try {
      chrome.tabs.query({}, function (tabs) {
        void chrome.runtime.lastError;
        cb((tabs || []).map(function (t) { return { icon: '▣', label: 'Tab: ' + (t.title || t.url || '(tab)'), detail: t.url, run: function () { chrome.tabs.update(t.id, { active: true }); if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true }); } }; }));
      });
    } catch (e) { cb([]); }
  }
  // Installed userscripts (the Tampermonkey-style engine managed in
  // scripts-manager/manager.html). Enter toggles enable/disable — the manager's
  // primary action — so a script can be flipped from the palette without leaving
  // the current page. Pulled from OUR own service worker (scripts.list).
  function userscriptItems(cb) {
    try {
      chrome.runtime.sendMessage({ kind: 'scripts.list' }, function (resp) {
        void chrome.runtime.lastError;
        var scripts = (resp && resp.ok && Array.isArray(resp.scripts)) ? resp.scripts : [];
        cb(scripts.map(function (s) {
          var name = s.name || '(unnamed script)';
          return {
            icon: s.enabled ? '📜' : '⊘',
            label: 'Userscript: ' + name + (s.enabled ? '' : ' (off)'),
            detail: s.enabled ? 'enabled · ⏎ disables' : 'disabled · ⏎ enables',
            run: function () {
              try {
                chrome.runtime.sendMessage({ kind: 'scripts.toggle', id: s.id, enabled: !s.enabled }, function () {
                  void chrome.runtime.lastError;
                  toast('userscript ' + (!s.enabled ? 'enabled' : 'disabled') + ': ' + name);
                });
              } catch (e) {}
            }
          };
        }));
      });
    } catch (e) { cb([]); }
  }

  function openPalette() {
    if (!window.ZGui || !ZGui.palette || !ZGui.fzf) {   // zgui-core bundle didn't load
      try { console.warn('zpwrchrome palette: zgui-core not loaded — cannot open'); } catch (e) {}
      return;
    }
    ensureStyle();
    try {
      ZGui.palette.clear();
      ZGui.palette.register(items());
      if (ZGui.palette.registerProvider) { ZGui.palette.registerProvider(computeProvider); ZGui.palette.registerProvider(searchProvider); ZGui.palette.registerProvider(customProvider); }
      ZGui.palette.open();
    } catch (e) {}
    try { if (PC.primeRates) PC.primeRates(getRates, refreshPalette); } catch (e) {}
    try {
      seedCustom(function () {
        try {
          var userCmds = [], defCmds = [];
          customCache.forEach(function (e) { ((PC.isDefaultCmd && PC.isDefaultCmd(e)) ? defCmds : userCmds).push(e); });
          if (ZGui.palette.setUserItems) ZGui.palette.setUserItems(customItems(userCmds)); else ZGui.palette.register(customItems(userCmds));
          ZGui.palette.register(customItems(defCmds));
          refreshPalette();
        } catch (e) {}
      });
    } catch (e) {}
    try { frecentItems(function (fi) { try { ZGui.palette.register(fi); refreshPalette(); } catch (e) {} }); } catch (e) {}
    try { tabItems(function (ti) { try { ZGui.palette.register(ti); refreshPalette(); } catch (e) {} }); } catch (e) {}
    try { userscriptItems(function (ui) { try { ZGui.palette.register(ui); refreshPalette(); } catch (e) {} }); } catch (e) {}
  }
  window.__zpcPaletteOpen = openPalette;

  // Opened ONLY by hud-internal's ⌘K router: its SW cross-ext-messages ours, which
  // relays { kind: 'zpc.open-palette' } to every zpwrchrome page. document.hasFocus()
  // ensures only the ACTIVE page (the one ⌘K was pressed on) opens. No local ⌘K.
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.kind === 'zpc.open-palette' && document.hasFocus()) {
        try { (window.ZGui && ZGui.palette && ZGui.palette.isOpen()) ? ZGui.palette.close() : openPalette(); } catch (e) {}
      }
    });
  } catch (e) {}
})();
