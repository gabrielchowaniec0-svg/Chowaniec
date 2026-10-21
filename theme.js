// Chowaniec themes: one engine for colours, light/dark, seasonal decorations and motion on every page.
//
// Load it in <head> (before the page paints) together with /theme.css:
//   <link rel="stylesheet" href="/theme.css"><script src="/theme.js"></script>
// It applies the look cached on this device straight away (no flash), then syncs with the person's
// saved look on the server (settings.look) and re-applies.
//
// window.ChowaniecTheme = {
//   catalog()                -> [{ id, name, group, swatch:[c1,c2,c3], season?, only? }]
//   current()                -> the look in use: { theme, mode, custom:{accent,bg,bg2,gradient}, season, motion, onboarded }
//   season()                 -> the real current season/holiday: 'winter'|'spring'|'summer'|'autumn'|'halloween'|'christmas'
//   apply(look)              -> preview a look (nothing is saved)
//   save(look)               -> apply + cache + save to the server; returns a Promise
//   setMode('auto'|'light'|'dark')  -> shortcut that saves just the light/dark choice
//   markOnboarded(n)         -> remember the first-run onboarding was completed (version n)
//   mountPicker(el, opts)    -> full theme picker UI. opts: { onChange(look), autosave:true }. Returns { get(), destroy() }
//   tokens(look)             -> { dark, id, vars } computed design tokens (used by tests)
// }
// Event 'chowaniec-theme-change' on window: detail = { look, season (real season), decor (decoration kind or ''), dark, id }
(function () {
  'use strict';
  if (window.ChowaniecTheme) return;
  var root = document.documentElement;
  var LS_LOOK = 'chowaniec_look';
  var LS_MODE = 'chowaniec_theme';           // legacy light/dark key still read by older code
  var LS_MOTION = 'chowaniec_reduce_motion'; // legacy reduce-motion key used by pwa.js
  var DEFAULT_LOOK = { theme: 'classic', mode: 'auto', custom: { accent: '#7c3aed', bg: '#ffffff', bg2: '#f4f4f5', gradient: false }, season: 'auto', motion: 'full', onboarded: 0 };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  // ---------- colour helpers ----------
  function h2r(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function r2h(a) { return '#' + a.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join(''); }
  function mix(a, b, t) { var A = h2r(a), B = h2r(b); return r2h(A.map(function (v, i) { return v + (B[i] - v) * t; })); }
  function lum(h) { var c = h2r(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function onColor(bg) { return contrast(bg, '#ffffff') >= contrast(bg, '#0a0a0a') ? '#ffffff' : '#0a0a0a'; }
  function rgba(h, a) { var c = h2r(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  // Moves `fg` toward `toward` until it reaches `min` contrast on every background.
  function ensure(fg, bgs, min, toward) {
    var c = fg;
    for (var i = 0; i < 30; i++) { if (bgs.every(function (b) { return contrast(c, b) >= min; })) return c; c = mix(c, toward, 0.12); }
    return toward;
  }

  // ---------- the themes ----------
  // Each mode: bg (page), surface (cards), text, accent (buttons, your bubbles). Optional: page (CSS background), chat.
  var D = {
    classic: { name: 'Classic', group: 'Classic', desc: 'Black and white',
      light: { bg: '#fafafa', chat: '#efeeea', surface: '#ffffff', text: '#0a0a0a', accent: '#0a0a0a' },
      dark: { bg: '#0e0e11', chat: '#0b0b0d', surface: '#1a1a1d', text: '#f4f4f5', accent: '#f2f2f3' } },
    mono: { name: 'High contrast', group: 'Classic', desc: 'Maximum contrast',
      light: { bg: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#000000', strong: true },
      dark: { bg: '#000000', surface: '#0a0a0a', text: '#ffffff', accent: '#ffffff', strong: true } },
    seasonal: { name: 'Seasonal (auto)', group: 'Seasonal', desc: 'Changes with the real season and holidays', auto: true },
    autumn: { name: 'Autumn', group: 'Seasonal', season: 'autumn',
      light: { bg: '#fbf3e8', surface: '#fffaf3', text: '#3a2414', accent: '#a8431a' },
      dark: { bg: '#1b130d', surface: '#271b12', text: '#f6e9da', accent: '#f08a3c' } },
    winter: { name: 'Winter', group: 'Seasonal', season: 'winter',
      light: { bg: '#eef4fb', surface: '#ffffff', text: '#10243a', accent: '#1d5fa8' },
      dark: { bg: '#0b1522', surface: '#12233a', text: '#e6f1ff', accent: '#7cc4ff' } },
    spring: { name: 'Spring', group: 'Seasonal', season: 'spring',
      light: { bg: '#f3faf0', surface: '#ffffff', text: '#1d3322', accent: '#b83280' },
      dark: { bg: '#101a13', surface: '#182a1d', text: '#eaf7ec', accent: '#f09ac4' } },
    summer: { name: 'Summer', group: 'Seasonal', season: 'summer',
      light: { bg: '#fffbe8', surface: '#ffffff', text: '#2b2410', accent: '#0e7c86' },
      dark: { bg: '#0c1a1d', surface: '#12292e', text: '#eafcff', accent: '#ffb340' } },
    halloween: { name: 'Halloween', group: 'Seasonal', season: 'halloween', only: 'dark',
      dark: { bg: '#120a1a', surface: '#1e1229', text: '#f5e9ff', accent: '#ff8a1f' } },
    christmas: { name: 'Christmas', group: 'Seasonal', season: 'christmas',
      light: { bg: '#fbf6f0', surface: '#ffffff', text: '#2a1414', accent: '#b3122b' },
      dark: { bg: '#0d1b14', surface: '#14291d', text: '#f4f1e8', accent: '#ff6b7a' } },
    ocean: { name: 'Ocean', group: 'Palettes',
      light: { bg: '#eef7fb', surface: '#ffffff', text: '#0b2a3b', accent: '#0a6fa3' },
      dark: { bg: '#08151d', surface: '#0e2230', text: '#e3f4ff', accent: '#4cc3f0' } },
    forest: { name: 'Forest', group: 'Palettes',
      light: { bg: '#f1f6f0', surface: '#ffffff', text: '#14291a', accent: '#2e6b3a' },
      dark: { bg: '#0d1710', surface: '#15251a', text: '#e6f3e8', accent: '#6fcf86' } },
    sunset: { name: 'Sunset', group: 'Palettes',
      light: { bg: '#fff3ec', surface: '#ffffff', text: '#3a1a14', accent: '#c2410c' },
      dark: { bg: '#1c0f12', surface: '#2a161a', text: '#ffe8dc', accent: '#ff8a5b' } },
    lavender: { name: 'Lavender', group: 'Palettes',
      light: { bg: '#f6f1fd', surface: '#ffffff', text: '#251a3d', accent: '#6d3fc0' },
      dark: { bg: '#14101f', surface: '#1e182e', text: '#efe8ff', accent: '#b79bff' } },
    rose: { name: 'Rose', group: 'Palettes',
      light: { bg: '#fff1f4', surface: '#ffffff', text: '#3b1420', accent: '#be1f4f' },
      dark: { bg: '#1d0f14', surface: '#2a161d', text: '#ffe9ee', accent: '#ff7d9f' } },
    midnight: { name: 'Midnight', group: 'Palettes', only: 'dark',
      dark: { bg: '#070a14', surface: '#0f1426', text: '#e8ecff', accent: '#7b8cff' } },
    aurora: { name: 'Aurora', group: 'Gradients',
      light: { bg: '#eefcf6', page: 'linear-gradient(135deg,#d9fbe9 0%,#d6ecff 50%,#ead9ff 100%)', surface: '#ffffff', text: '#0f2a2a', accent: '#0f766e' },
      dark: { bg: '#06201f', page: 'linear-gradient(135deg,#06201f 0%,#0b1a3a 55%,#2a0f45 100%)', surface: '#0f2230', text: '#e8fffb', accent: '#5eead4' } },
    sunrise: { name: 'Sunrise', group: 'Gradients',
      light: { bg: '#fff1d6', page: 'linear-gradient(160deg,#fff1d6 0%,#ffd6c9 55%,#f9c6e0 100%)', surface: '#ffffff', text: '#3a1d12', accent: '#c2410c' },
      dark: { bg: '#2b1220', page: 'linear-gradient(160deg,#2b1220 0%,#3a1a1a 55%,#1b1233 100%)', surface: '#2c1620', text: '#ffeede', accent: '#ffb36b' } },
    candy: { name: 'Candy', group: 'Gradients',
      light: { bg: '#ffe3f1', page: 'linear-gradient(135deg,#ffe3f1 0%,#e3ecff 50%,#e0fff4 100%)', surface: '#ffffff', text: '#2a1535', accent: '#c026a3' },
      dark: { bg: '#2a0f2e', page: 'linear-gradient(135deg,#2a0f2e 0%,#10213a 55%,#0f2e2a 100%)', surface: '#241530', text: '#ffeafa', accent: '#ff8ad8' } },
    deepspace: { name: 'Deep space', group: 'Gradients', only: 'dark',
      dark: { bg: '#05060f', page: 'radial-gradient(120% 80% at 80% 0%,#1d1147 0%,rgba(5,6,15,0) 60%),linear-gradient(160deg,#05060f 0%,#0d0b24 50%,#1a0b2e 100%)', surface: '#0e1020', text: '#eceeff', accent: '#9d8cff' } },
    custom: { name: 'Custom', group: 'Custom', custom: true }
  };
  var ORDER = ['classic', 'mono', 'seasonal', 'autumn', 'winter', 'spring', 'summer', 'halloween', 'christmas', 'ocean', 'forest', 'sunset', 'lavender', 'rose', 'midnight', 'aurora', 'sunrise', 'candy', 'deepspace', 'custom'];

  // The real season, with the holidays that get their own look.
  function realSeason(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    if ((m === 10 && day >= 15) || (m === 11 && day === 1)) return 'halloween';
    if (m === 12 && day >= 10) return 'christmas';
    if (m === 12 || m === 1 || m === 2) return 'winter';
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    return 'autumn';
  }

  // ---------- look handling ----------
  function cleanLook(input, base) {
    base = base || DEFAULT_LOOK;
    var i = input || {}, c = i.custom || {}, bc = base.custom || DEFAULT_LOOK.custom;
    var hex = function (v, f) { return /^#[0-9a-fA-F]{6}$/.test(v || '') ? String(v).toLowerCase() : f; };
    return {
      theme: D[i.theme] ? i.theme : (D[base.theme] ? base.theme : 'classic'),
      mode: ['auto', 'light', 'dark'].indexOf(i.mode) >= 0 ? i.mode : base.mode,
      custom: { accent: hex(c.accent, bc.accent), bg: hex(c.bg, bc.bg), bg2: hex(c.bg2, bc.bg2), gradient: typeof c.gradient === 'boolean' ? c.gradient : !!bc.gradient },
      season: i.season === 'auto' || i.season === 'off' || /^(winter|spring|summer|autumn|halloween|christmas)$/.test(i.season || '') ? i.season : base.season,
      motion: i.motion === 'full' || i.motion === 'reduced' ? i.motion : base.motion,
      onboarded: typeof i.onboarded === 'number' && i.onboarded >= 0 ? Math.floor(i.onboarded) : (base.onboarded || 0)
    };
  }

  function cachedLook() {
    var raw = lsGet(LS_LOOK), look = null;
    try { look = raw ? JSON.parse(raw) : null; } catch (e) { look = null; }
    var legacy = lsGet(LS_MODE);
    var out = cleanLook(look || {}, DEFAULT_LOOK);
    if (!look && (legacy === 'light' || legacy === 'dark')) out.mode = legacy;
    if (!look && lsGet(LS_MOTION) === '1') out.motion = 'reduced';
    return out;
  }

  function systemDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  function prefersReduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  // Resolves a look into a definition + light/dark.
  function resolve(look) {
    var id = look.theme, season = null;
    if (id === 'seasonal') { season = realSeason(); id = season; }
    var def = D[id] || D.classic;
    var dark;
    if (id === 'custom') dark = lum(look.custom.bg) < 0.35;
    else if (def.only) dark = def.only === 'dark';
    else dark = look.mode === 'dark' || (look.mode === 'auto' && systemDark());
    var spec;
    if (id === 'custom') spec = customSpec(look.custom, dark);
    else spec = def[dark ? 'dark' : 'light'] || def.dark || def.light;
    return { id: id, def: def, dark: dark, spec: spec, seasonal: !!def.season };
  }

  function customSpec(c, dark) {
    var bg = c.bg, text = dark ? mix('#f6f6f8', bg, 0.04) : mix('#101014', bg, 0.04);
    var surface = dark ? mix(bg, '#ffffff', 0.07) : mix(bg, '#ffffff', 0.7);
    var accent = c.accent;
    // keep the accent readable against its button text and against the page
    var ink = onColor(accent);
    var tries = 0;
    while (contrast(accent, ink) < 4.5 && tries++ < 20) accent = mix(accent, ink === '#ffffff' ? '#000000' : '#ffffff', 0.1);
    var spec = { bg: bg, surface: surface, text: text, accent: accent };
    if (c.gradient) spec.page = 'linear-gradient(135deg,' + c.bg + ' 0%,' + c.bg2 + ' 100%)';
    return spec;
  }

  // The full set of design tokens (CSS variables) for one resolved theme.
  function buildTokens(r) {
    var s = r.spec, dark = r.dark, strong = !!s.strong;
    var bg = s.bg, surface = s.surface, text = s.text, accent = s.accent, ink = onColor(accent);
    var surface2 = mix(surface, text, dark ? 0.06 : 0.04), surface3 = mix(surface, text, dark ? 0.12 : 0.08);
    var bgs = [bg, surface, surface2];
    var text2 = ensure(mix(text, surface, 0.2), bgs, 7, text);
    var muted = ensure(mix(text, surface, 0.4), bgs.concat([surface3]), strong ? 7 : 4.8, text);
    var faint = ensure(mix(text, surface, 0.5), bgs, strong ? 7 : 4.5, text);
    var chat = s.chat || bg;
    var v = {};
    v['--bg'] = bg; v['--surface'] = surface; v['--surface-2'] = surface2; v['--surface-3'] = surface3;
    v['--text'] = text; v['--text-2'] = text2; v['--muted'] = muted; v['--faint'] = faint;
    v['--line'] = rgba(text, strong ? 0.4 : dark ? 0.12 : 0.1); v['--line-strong'] = rgba(text, strong ? 0.8 : dark ? 0.2 : 0.18);
    v['--accent'] = accent; v['--accent-ink'] = ink; v['--accent-soft'] = mix(surface, accent, dark ? 0.22 : 0.12);
    v['--accent-text'] = ensure(accent, [surface, bg], 4.5, text);
    v['--page-bg'] = s.page || bg;
    v['--chat-bg'] = s.page ? 'transparent' : chat;
    v['--bg-dot'] = rgba(text, 0.045);
    // settings.css / lists / messages vocabulary
    v['--card'] = surface; v['--ink'] = text; v['--soft'] = surface2;
    // chat vocabulary (group.css)
    v['--chrome'] = rgba(surface, 0.86); v['--chrome-solid'] = surface; v['--sheet-bg'] = mix(bg, surface, 0.4);
    v['--mine-bg'] = accent; v['--mine-fg'] = ink; v['--mine-stamp'] = rgba(ink, 0.62); v['--mine-quote'] = rgba(ink, 0.14);
    v['--theirs-bg'] = surface; v['--theirs-fg'] = text; v['--theirs-stamp'] = muted;
    v['--bubble-shadow'] = dark ? 'none' : '0 1px 1.5px rgba(0,0,0,0.08)';
    var aiBg = mix(surface, '#7c3aed', dark ? 0.24 : 0.09);
    v['--ai-bg'] = aiBg; v['--ai-fg'] = ensure(text, [aiBg], 7, text); v['--ai-acc'] = dark ? '#8b5cf6' : '#7c3aed';
    v['--ai-acc-text'] = ensure(dark ? '#c4b5fd' : '#6d28d9', [aiBg], 4.5, text);
    var hl = mix(surface, '#f2c14e', dark ? 0.2 : 0.28);
    v['--hl-bg'] = hl; v['--hl-ring'] = dark ? '#c99a2e' : '#f2c14e';
    v['--mark'] = dark ? 'rgba(250,204,21,0.4)' : '#fde68a'; v['--mark-fg'] = dark ? '#fff7d6' : '#422006';
    v['--on-bg'] = accent; v['--on-fg'] = ink;
    v['--online'] = '#22c55e';
    var danger = ensure(dark ? '#f87171' : '#dc2626', [surface, bg], 4.5, dark ? '#ffffff' : '#7f1d1d');
    v['--bad'] = danger; v['--ok'] = ensure(dark ? '#34d399' : '#047857', [surface, bg], 4.5, text); v['--warn'] = ensure(dark ? '#fbbf24' : '#b45309', [surface, bg], 4.5, text);
    v['--danger'] = danger; v['--danger-bg'] = rgba(danger, dark ? 0.14 : 0.08);
    var warnBg = mix(surface, '#f59e0b', dark ? 0.16 : 0.1);
    v['--warn-bg'] = warnBg; v['--warn-fg'] = ensure(dark ? '#fcd34d' : '#92400e', [warnBg], 4.5, text); v['--warn-line'] = mix(warnBg, '#f59e0b', 0.25);
    v['--overlay'] = dark ? 'rgba(0,0,0,0.6)' : 'rgba(10,10,10,0.32)';
    v['--shadow-lg'] = dark ? '0 24px 60px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)' : '0 24px 60px -16px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.05)';
    v['--shadow-sm'] = dark ? '0 1px 3px rgba(0,0,0,0.5)' : '0 1px 3px rgba(0,0,0,0.08)';
    v['--sep-bg'] = rgba(surface, 0.8); v['--sep-fg'] = muted;
    v['--input-bg'] = surface2;
    v['--toast-bg'] = text; v['--toast-fg'] = onColor(text);
    v['--shimmer-a'] = mix(surface, text, dark ? 0.08 : 0.07); v['--shimmer-b'] = mix(surface, text, dark ? 0.16 : 0.03);
    v['--bubble-radius'] = '18px';
    return v;
  }

  // ---------- applying ----------
  var current = cachedLook();
  var lastDecor = '';
  var applied = false;

  function decorKind(look, r) {
    if (look.season === 'off') return '';
    var s = look.season === 'auto' ? (r.seasonal ? r.def.season : '') : look.season;
    if (r.id === 'custom' && look.season === 'auto') s = '';
    return s || '';
  }

  function setMeta(color) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta && document.head) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.appendChild(meta); }
    if (meta) meta.setAttribute('content', color);
  }

  function paint(look) {
    var r = resolve(look), vars = buildTokens(r);
    var style = root.style;
    Object.keys(vars).forEach(function (k) { style.setProperty(k, vars[k]); });
    root.setAttribute('data-theme', r.dark ? 'dark' : 'light');
    root.setAttribute('data-look', r.id);
    root.setAttribute('data-motion', look.motion === 'reduced' || prefersReduced() ? 'reduced' : 'full');
    root.style.colorScheme = r.dark ? 'dark' : 'light';
    var decor = decorKind(look, r);
    root.setAttribute('data-decor', decor);
    setMeta(vars['--surface']);
    // keep older code that reads these keys in step
    lsSet(LS_MODE, look.mode === 'auto' ? null : look.mode);
    lsSet(LS_MOTION, look.motion === 'reduced' ? '1' : null);
    return { r: r, vars: vars, decor: decor };
  }

  function announce(look, info) {
    try { window.dispatchEvent(new CustomEvent('chowaniec-theme-change', { detail: { look: look, season: realSeason(), decor: info.decor, dark: info.r.dark, id: info.r.id } })); } catch (e) { /* ignore */ }
  }

  var fxLoading = false;
  function syncFx(decor, dark) {
    var reduced = root.getAttribute('data-motion') === 'reduced';
    if (window.ChowaniecFX) { window.ChowaniecFX.set(decor, { dark: dark, still: reduced }); lastDecor = decor; return; }
    if (!decor || fxLoading || /^\/meet(\/|$)/.test(location.pathname)) return;
    fxLoading = true;
    var s = document.createElement('script');
    s.src = '/theme-fx.js'; s.async = true;
    s.onload = function () { fxLoading = false; if (window.ChowaniecFX) window.ChowaniecFX.set(root.getAttribute('data-decor') || '', { dark: root.getAttribute('data-theme') === 'dark', still: root.getAttribute('data-motion') === 'reduced' }); };
    s.onerror = function () { fxLoading = false; };
    (document.head || root).appendChild(s);
  }

  function applyLook(look, opts) {
    opts = opts || {};
    look = cleanLook(look, current);
    current = look;
    var run = function () {
      current = look;
      var info = paint(look);
      applied = true;
      var go = function () { syncFx(info.decor, info.r.dark); announce(look, info); };
      if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
      return info;
    };
    var smooth = opts.animate !== false && applied && root.getAttribute('data-motion') !== 'reduced';
    if (smooth && document.startViewTransition) {
      try { document.startViewTransition(run); return; } catch (e) { /* fall through */ }
    }
    if (smooth) {
      root.classList.add('cz-fade');
      clearTimeout(applyLook._t);
      applyLook._t = setTimeout(function () { root.classList.remove('cz-fade'); }, 450);
    }
    run();
  }

  // ---------- server sync ----------
  function userKey() { try { var u = window.getChowaniecUser && window.getChowaniecUser(); return u && u.key; } catch (e) { return null; } }
  function fetchLook() {
    var key = userKey();
    if (!key) return Promise.resolve(null);
    return fetch('/.netlify/functions/settings', { headers: { 'X-Chowaniec-Key': key }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.settings && d.settings.look ? d.settings.look : null; })
      .catch(function () { return null; });
  }
  var saveTimer = null, savePromise = null;
  function pushLook(look) {
    clearTimeout(saveTimer);
    return new Promise(function (resolveSave, rejectSave) {
      saveTimer = setTimeout(function () {
        var key = userKey();
        if (!key) { resolveSave(look); return; }
        fetch('/.netlify/functions/settings', { method: 'POST', headers: { 'X-Chowaniec-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { look: look } }) })
          .then(function (r) { if (!r.ok) throw new Error('Could not save your look.'); resolveSave(look); })
          .catch(function (e) { rejectSave(e); });
      }, 350);
    });
  }

  function save(look) {
    look = cleanLook(look, current);
    lsSet(LS_LOOK, JSON.stringify(look));
    applyLook(look);
    savePromise = pushLook(look);
    return savePromise;
  }

  var synced = false;
  function syncFromServer(tries) {
    if (synced) return;
    if (!userKey()) { if ((tries || 0) < 40) setTimeout(function () { syncFromServer((tries || 0) + 1); }, 250); return; }
    synced = true;
    fetchLook().then(function (remote) {
      if (!remote) return;
      var look = cleanLook(remote, DEFAULT_LOOK);
      lsSet(LS_LOOK, JSON.stringify(look));
      if (JSON.stringify(look) !== JSON.stringify(current)) applyLook(look);
      else window.dispatchEvent(new CustomEvent('chowaniec-theme-synced', { detail: { look: look } }));
    });
  }

  // ---------- public helpers ----------
  function swatch(id, look) {
    var l = cleanLook(Object.assign({}, current, { theme: id }), current);
    var r = resolve(l), s = r.spec;
    return [s.page ? s.bg : s.bg, s.surface, s.accent];
  }
  function catalog() {
    return ORDER.map(function (id) {
      var d = D[id], sw;
      if (id === 'seasonal') sw = swatch(realSeason());
      else if (id === 'custom') sw = [current.custom.bg, current.custom.bg2, current.custom.accent];
      else sw = swatch(id);
      var out = { id: id, name: d.name, group: d.group, swatch: sw };
      if (d.season) out.season = d.season;
      if (d.only) out.only = d.only;
      if (d.desc) out.desc = d.desc;
      return out;
    });
  }

  // ---------- picker ----------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function mountPicker(host, opts) {
    opts = opts || {};
    var autosave = opts.autosave !== false;
    var state = cleanLook(current, DEFAULT_LOOK);
    var uid = 'ctp' + Math.random().toString(36).slice(2, 7);
    var wrap = el('div', { class: 'ctp' });
    host.innerHTML = '';
    host.appendChild(wrap);

    function change(patch, noPreview) {
      state = cleanLook(Object.assign({}, state, patch), state);
      if (patch.custom) state.custom = cleanLook({ custom: Object.assign({}, state.custom, patch.custom) }, state).custom;
      if (!noPreview) applyLook(state);
      if (autosave) save(state);
      if (opts.onChange) opts.onChange(state);
      draw();
    }

    function tile(item) {
      var b = el('button', { type: 'button', class: 'ctp-tile', 'data-theme-id': item.id, 'aria-pressed': String(state.theme === item.id), 'aria-label': item.name + (item.only ? ' (dark only)' : '') });
      var sw = el('span', { class: 'ctp-sw', 'aria-hidden': 'true' }, [
        el('i', { style: 'background:' + item.swatch[0] }), el('i', { style: 'background:' + item.swatch[1] }), el('i', { style: 'background:' + item.swatch[2] })
      ]);
      b.appendChild(sw);
      b.appendChild(el('span', { class: 'ctp-name', text: item.name }));
      if (item.id === 'seasonal') b.appendChild(el('span', { class: 'ctp-sub', text: 'Now: ' + realSeason() }));
      b.addEventListener('click', function () { change({ theme: item.id }); });
      return b;
    }

    function colorRow(label, key) {
      var id = uid + key;
      var input = el('input', { type: 'color', id: id, value: state.custom[key] });
      input.addEventListener('input', function () { var c = {}; c[key] = input.value; change({ theme: 'custom', custom: c }); });
      return el('div', { class: 'ctp-color' }, [el('label', { for: id, text: label }), input]);
    }

    function toggle(label, hint, checked, onChange) {
      var id = uid + label.replace(/\W/g, '');
      var input = el('input', { type: 'checkbox', role: 'switch', id: id });
      input.checked = checked;
      input.addEventListener('change', function () { onChange(input.checked); });
      return el('div', { class: 'ctp-row' }, [
        el('div', { class: 'ctp-grow' }, [el('label', { for: id, class: 'ctp-t', text: label }), hint ? el('div', { class: 'ctp-s', text: hint }) : null]),
        el('span', { class: 'ctp-switch' }, [input, el('span', { class: 'ctp-track' })])
      ]);
    }

    function draw() {
      var focusId = document.activeElement && wrap.contains(document.activeElement) ? document.activeElement.getAttribute('data-theme-id') : null;
      wrap.innerHTML = '';
      // light / dark
      var r = resolve(state);
      var modes = el('div', { class: 'ctp-seg', role: 'group', 'aria-label': 'Light or dark' });
      [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].forEach(function (m) {
        var b = el('button', { type: 'button', 'data-mode': m[0], 'aria-pressed': String(state.mode === m[0]), text: m[1] });
        b.addEventListener('click', function () { change({ mode: m[0] }); });
        modes.appendChild(b);
      });
      wrap.appendChild(el('div', { class: 'ctp-block' }, [el('div', { class: 'ctp-h', text: 'Light or dark' }), modes,
        (r.def.only || state.theme === 'custom') ? el('div', { class: 'ctp-s', text: state.theme === 'custom' ? 'Custom colours decide this for themselves.' : 'This theme is always dark.' }) : null]));
      // theme tiles by group
      var cat = catalog(), groups = [];
      cat.forEach(function (c) { if (groups.indexOf(c.group) < 0) groups.push(c.group); });
      groups.forEach(function (g) {
        var grid = el('div', { class: 'ctp-grid', role: 'group', 'aria-label': g + ' themes' });
        cat.filter(function (c) { return c.group === g; }).forEach(function (c) { grid.appendChild(tile(c)); });
        wrap.appendChild(el('div', { class: 'ctp-block' }, [el('div', { class: 'ctp-h', text: g }), grid]));
        if (g === 'Custom' && state.theme === 'custom') {
          wrap.lastChild.appendChild(el('div', { class: 'ctp-custom' }, [
            colorRow('Accent colour', 'accent'), colorRow('Background', 'bg'),
            colorRow('Second colour', 'bg2'),
            toggle('Gradient background', 'Blend the background into the second colour.', state.custom.gradient, function (on) { change({ theme: 'custom', custom: { gradient: on } }); })
          ]));
        }
      });
      // decorations
      var deco = el('div', { class: 'ctp-block' }, [el('div', { class: 'ctp-h', text: 'Decorations' })]);
      var sel = el('select', { id: uid + 'season', class: 'ctp-select', 'aria-label': 'Seasonal decorations' });
      [['auto', 'Match my theme'], ['off', 'None'], ['autumn', 'Falling leaves'], ['winter', 'Snow'], ['spring', 'Blossoms'], ['summer', 'Sun glints'], ['halloween', 'Halloween'], ['christmas', 'Christmas lights']].forEach(function (o) {
        var op = el('option', { value: o[0], text: o[1] }); if (state.season === o[0]) op.selected = true; sel.appendChild(op);
      });
      sel.addEventListener('change', function () { change({ season: sel.value }); });
      deco.appendChild(el('div', { class: 'ctp-row' }, [el('div', { class: 'ctp-grow' }, [el('label', { for: uid + 'season', class: 'ctp-t', text: 'Seasonal decorations' }), el('div', { class: 'ctp-s', text: 'Gentle things floating around the app. Seasonal themes bring their own.' })]), sel]));
      deco.appendChild(toggle('Reduce animations', 'Calmer screens with less movement on every page.', state.motion === 'reduced', function (on) { change({ motion: on ? 'reduced' : 'full' }); }));
      wrap.appendChild(deco);
      if (focusId) { var f = wrap.querySelector('[data-theme-id="' + focusId + '"]'); if (f) f.focus({ preventScroll: true }); }
    }
    draw();
    var onSync = function (e) { state = cleanLook(e.detail.look, state); draw(); };
    window.addEventListener('chowaniec-theme-synced', onSync);
    return { get: function () { return state; }, destroy: function () { window.removeEventListener('chowaniec-theme-synced', onSync); host.innerHTML = ''; } };
  }

  // ---------- gentle entrance animation for new chat messages and list rows ----------
  var seen = Object.create(null), watching = false, startedAt = Date.now();
  function watchEnter() {
    if (watching || !window.MutationObserver) return;
    watching = true;
    new MutationObserver(function (muts) {
      if (Date.now() - startedAt < 1500 || root.getAttribute('data-motion') === 'reduced') {
        muts.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1 && n.matches && n.matches('.msg-row[data-id]')) seen[n.getAttribute('data-id')] = 1; }); });
        return;
      }
      var fresh = [];
      muts.forEach(function (m) { m.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        var rows = n.matches && n.matches('.msg-row[data-id]') ? [n] : (n.querySelectorAll ? Array.prototype.slice.call(n.querySelectorAll('.msg-row[data-id]')) : []);
        rows.forEach(function (row) { var id = row.getAttribute('data-id'); if (!seen[id]) { seen[id] = 1; fresh.push(row); } });
      }); });
      if (fresh.length && fresh.length <= 6) fresh.forEach(function (row) { row.classList.add('cz-enter'); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---------- start ----------
  applyLook(current, { animate: false });
  try {
    var q = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    var again = function () { if (current.mode === 'auto') applyLook(current, { animate: false }); };
    if (q) { if (q.addEventListener) q.addEventListener('change', again); else if (q.addListener) q.addListener(again); }
  } catch (e) { /* ignore */ }
  window.addEventListener('storage', function (e) { if (e.key === LS_LOOK) { current = cachedLook(); applyLook(current, { animate: false }); } });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && window.ChowaniecFX && lastDecor) window.ChowaniecFX.resume && window.ChowaniecFX.resume(); });
  var boot = function () {
    root.classList.add('cz-ready');
    watchEnter();
    setTimeout(function () { syncFromServer(0); }, 300);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.ChowaniecTheme = {
    catalog: catalog,
    current: function () { return JSON.parse(JSON.stringify(current)); },
    season: realSeason,
    apply: function (look) { applyLook(look); },
    save: save,
    setMode: function (mode) { return save(Object.assign({}, current, { mode: mode })); },
    markOnboarded: function (n) { return save(Object.assign({}, current, { onboarded: n })); },
    mountPicker: mountPicker,
    tokens: function (look) { var r = resolve(cleanLook(look || current, current)); return { dark: r.dark, id: r.id, vars: buildTokens(r) }; },
    _contrast: contrast
  };
})();
