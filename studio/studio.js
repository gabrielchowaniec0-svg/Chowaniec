// Chowaniec Studio (/studio/studio.js)
// ---------------------------------------------------------------------------------------------------
// A camera for shooting theatre and comedy scenes: plan the line-up, shoot every scene take by take (each take is
// filed under its scene automatically), review each take, mark the best one, then hand the clips over in order.
// Works with /studio/store.js (on-device storage), /studio/camera.js (camera + recorder) and, when present,
// /studio/gestures.js (window.StudioGestures) and /studio/export.js (window.StudioExport).
(function () {
  'use strict';
  var Store = window.StudioStore, Cam = window.StudioCamera;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var main = $('#main'), camEl = $('#cam'), camUi = $('#cam-ui'), video = $('#cam-video'), stage = $('#cam-stage'), frame = $('#cam-frame');
  var html = document.documentElement;

  // ---------- small helpers ----------
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function pad(n, l) { n = String(n); while (n.length < (l || 2)) n = '0' + n; return n; }
  function fmtDur(s) { s = Math.max(0, Math.round(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(x); }
  function fmtClock(ms) { var s = Math.floor(ms / 1000); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60); }
  function fmtBytes(b) {
    if (!b) return '0 MB';
    if (b >= 1e9) return (b / 1e9).toFixed(b >= 1e10 ? 0 : 1) + ' GB';
    if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
    return Math.max(1, Math.round(b / 1e3)) + ' KB';
  }
  function haptic(kind) { try { var H = window.ChowaniecHaptics; if (H) { if (kind === 'success') H.success(); else if (kind === 'warning') H.warning(); else H.tap(kind); } } catch (e) { /* ignore */ } }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  // ---------- icons (inline SVG, lucide style) ----------
  var P = {
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    sliders: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    zapOff: '<path d="M10.5 4.6 13 2l-.7 5.5M16.8 10H21l-4.2 5M7.2 7.2 3 14h9l-1 8 4.7-5.6M2 2l20 20"/>',
    flip: '<path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/><path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/><circle cx="12" cy="12" r="3"/><path d="m18 22-3-3 3-3M6 2l3 3-3 3"/>',
    star: '<path d="M12 2.6l2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.16l-5.7 3 1.09-6.35-4.62-4.5 6.38-.93z"/>',
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>',
    clapper: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9M12.4 3.4l3.1 4M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.2"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    thumbUp: '<path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
    thumbDown: '<path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
    next: '<path d="m5 4 10 8-10 8V4zM19 5v14"/>',
    prev: '<path d="m19 20-10-8 10-8v16zM5 19V5"/>',
    replay: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18.5h2"/>',
    landscape: '<rect x="2" y="6" width="20" height="12" rx="2.5"/>',
    portrait: '<rect x="7" y="2" width="10" height="20" rx="2.5"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
    timer: '<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    drive: '<path d="M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
    film: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 8h5M2 16h5M17 8h5M17 16h5M2 12h20"/>',
    files: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    more: '<circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    victory: '<path d="M8 13 5.5 3.6a1.6 1.6 0 0 1 3.1-.8L11 11M13 11l2.4-8.2a1.6 1.6 0 0 1 3.1.9L16 13"/><path d="M6 13h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z"/>',
    fist: '<path d="M6 10V8a2 2 0 0 1 4 0v1M10 9V7a2 2 0 0 1 4 0v2M14 9V8a2 2 0 0 1 4 0v4"/><path d="M6 10a2 2 0 0 0-2 2v1a8 8 0 0 0 8 8h1a5 5 0 0 0 5-5v-4"/>',
    pointUp: '<path d="M10 11V4a2 2 0 0 1 4 0v7"/><path d="M14 11h1a3 3 0 0 1 3 3v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6v-3a2 2 0 0 1 4 0"/>'
  };
  function ic(name, size, cls) {
    var fill = (name === 'star' && /filled/.test(cls || '')) || name === 'play' || name === 'pause' || name === 'next' || name === 'prev';
    return '<svg class="st-ic' + (cls ? ' ' + cls : '') + '" width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[name] || '') + '</svg>';
  }

  // ---------- voice phrases ----------
  var LANGS = [
    { code: 'en-US', label: 'English', scene: 'Scene {s}, take {t}', action: 'Action!', cut: 'Cut!' },
    { code: 'en-GB', label: 'English (UK)', scene: 'Scene {s}, take {t}', action: 'Action!', cut: 'Cut!' },
    { code: 'pl-PL', label: 'Polski', scene: 'Scena {s}, ujęcie {t}', action: 'Akcja!', cut: 'Cięcie!' },
    { code: 'es-ES', label: 'Español', scene: 'Escena {s}, toma {t}', action: '¡Acción!', cut: '¡Corten!' },
    { code: 'de-DE', label: 'Deutsch', scene: 'Szene {s}, Take {t}', action: 'Und Action!', cut: 'Cut!' },
    { code: 'fr-FR', label: 'Français', scene: 'Scène {s}, prise {t}', action: 'Action !', cut: 'Coupez !' },
    { code: 'it-IT', label: 'Italiano', scene: 'Scena {s}, ciak {t}', action: 'Azione!', cut: 'Stop!' }
  ];
  function defaultLang() {
    var n = (navigator.language || 'en-US').toLowerCase();
    var hit = LANGS.find(function (l) { return l.code.toLowerCase() === n; }) || LANGS.find(function (l) { return l.code.slice(0, 2) === n.slice(0, 2); });
    return hit ? hit.code : 'en-US';
  }
  function langOf(code) { return LANGS.find(function (l) { return l.code === code; }) || LANGS[0]; }

  var DEFAULT_SETTINGS = { orientation: 'landscape', review: true, countdown: 3, voice: true, voiceLang: null, gestures: false, autoAdvance: true };
  var CAM_PREFS_KEY = 'chowaniec_studio_cam_v1';
  var camPrefs = lsGet(CAM_PREFS_KEY, { deviceId: null, preset: 'max', grid: true, guides: false });
  function saveCamPrefs() { lsSet(CAM_PREFS_KEY, camPrefs); }

  // ---------- state ----------
  var S = { projects: [], project: null, takes: [], tab: 'lineup', est: null };
  function settingsOf(p) { var s = Object.assign({}, DEFAULT_SETTINGS, (p && p.settings) || {}); if (!s.voiceLang) s.voiceLang = defaultLang(); return s; }
  function sceneIndex(p, id) { return p.scenes.findIndex(function (s) { return s.id === id; }); }
  function sceneById(p, id) { return p.scenes.find(function (s) { return s.id === id; }) || null; }
  function takesOf(sceneId) { return S.takes.filter(function (t) { return t.sceneId === sceneId; }).sort(function (a, b) { return a.n - b.n; }); }
  function bestTake(sceneId) {
    var ts = takesOf(sceneId);
    return ts.find(function (t) { return t.starred; }) || ts.filter(function (t) { return t.status === 'kept'; }).pop() || null;
  }
  function sceneDone(sceneId) { return !!bestTake(sceneId); }
  function projectStats(p, takes) {
    var done = 0, size = 0, dur = 0;
    p.scenes.forEach(function (s) { var ts = takes.filter(function (t) { return t.sceneId === s.id; }); if (ts.some(function (t) { return t.starred || t.status === 'kept'; })) done++; });
    takes.forEach(function (t) { size += t.size || 0; dur += t.duration || 0; });
    return { done: done, total: p.scenes.length, takes: takes.length, size: size, duration: dur };
  }
  function saveProject() { return S.project ? Store.putProject(S.project) : Promise.resolve(); }
  function currentScene() {
    var p = S.project; if (!p || !p.scenes.length) return null;
    return sceneById(p, p.current) || p.scenes[0];
  }

  // ---------- toast ----------
  var toastTimer = null;
  function toast(msg, action) {
    var el = camOpen ? $('#cam-toast') : $('#st-toast');
    if (!el) return;
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button" class="st-toast__btn">' + esc(action.label) + '</button>' : '');
    el.hidden = false;
    el.classList.remove('is-in'); void el.offsetWidth; el.classList.add('is-in');
    if (action) el.querySelector('button').onclick = function () { el.hidden = true; action.run(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, action ? 6000 : 2600);
  }

  // ---------- sheet ----------
  var sheetEl = $('#st-sheet'), sheetBody = $('#st-sheet-body'), sheetApi = null, sheetOnClose = null;
  function openSheet(htmlStr, onClose) {
    sheetBody.innerHTML = htmlStr;
    sheetOnClose = onClose || null;
    if (window.ChowaniecUI && window.ChowaniecUI.sheet) {
      sheetApi = sheetApi || window.ChowaniecUI.sheet(sheetEl);
      sheetApi.open();
    } else {
      sheetEl.hidden = false; requestAnimationFrame(function () { sheetEl.classList.add('is-open'); });
    }
    var f = sheetBody.querySelector('[autofocus]'); if (f) setTimeout(function () { f.focus(); }, 60);
  }
  function closeSheet() {
    if (sheetApi) sheetApi.close(); else { sheetEl.classList.remove('is-open'); setTimeout(function () { sheetEl.hidden = true; }, 200); }
    var cb = sheetOnClose; sheetOnClose = null; if (cb) cb();
  }
  sheetEl.addEventListener('click', function (e) { if (e.target === sheetEl && !sheetApi) closeSheet(); });
  function confirmSheet(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var done = false;
      openSheet('<h2 class="ch-sheet__title" id="st-sheet-title">' + esc(title) + '</h2><p class="st-sheet-text">' + esc(text) + '</p>' +
        '<div class="st-sheet-actions"><button type="button" class="ch-btn ch-btn--secondary" data-c="0">Cancel</button><button type="button" class="ch-btn ' + (danger ? 'ch-btn--danger' : 'ch-btn--primary') + '" data-c="1">' + esc(okLabel) + '</button></div>',
        function () { if (!done) { done = true; resolve(false); } });
      $$('[data-c]', sheetBody).forEach(function (b) { b.onclick = function () { var v = b.dataset.c === '1'; done = true; closeSheet(); resolve(v); }; });
    });
  }

  // ---------- header ----------
  function setHeader(title, sub, back, actions) {
    $('#st-title').textContent = title;
    $('#st-small').textContent = title;
    document.title = title === 'Studio' ? 'Studio' : title + ' · Studio';
    var subEl = $('#st-sub'); subEl.textContent = sub || ''; subEl.hidden = !sub;
    var b = $('#st-back'); b.href = back.href; b.setAttribute('aria-label', back.label);
    $('#st-actions').innerHTML = actions || '';
  }

  // ---------- routing ----------
  function parseHash() {
    var h = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
    if (h[0] === 'p' && h[1]) return { view: 'project', id: decodeURIComponent(h[1]), sub: h[2] || null };
    return { view: 'home' };
  }
  var routing = Promise.resolve();
  function route() { routing = routing.then(doRoute).catch(function (e) { console.warn('[studio] route', e); }); return routing; }
  async function doRoute() {
    var r = parseHash();
    if (r.view === 'project') {
      if (!S.project || S.project.id !== r.id) {
        var p = await Store.getProject(r.id);
        if (!p) { location.replace('#/'); return; }
        S.project = p;
        S.takes = await Store.listTakes(p.id);
        S.tab = S.takes.length ? 'takes' : 'lineup';
      }
      if (r.sub === 'shoot') {
        renderProject();
        if (!camOpen) openCamera();
        return;
      }
      if (camOpen) await closeCamera();
      if (r.sub === 'takes' || r.sub === 'lineup' || r.sub === 'setup') S.tab = r.sub;
      renderProject();
    } else {
      if (camOpen) await closeCamera();
      S.project = null; S.takes = [];
      await renderHome();
    }
  }

  // ============================================================================================
  // HOME: projects
  // ============================================================================================
  async function renderHome() {
    setHeader('Studio', 'Shoot scenes, review every take, export in order.', { href: '/', label: 'Back to home' }, '');
    var projects = await Store.listProjects();
    var all = [];
    for (var i = 0; i < projects.length; i++) { all.push({ p: projects[i], takes: await Store.listTakes(projects[i].id) }); }
    S.projects = projects;
    var used = 0;
    var rows = all.map(function (x, i) {
      var st = projectStats(x.p, x.takes); used += st.size;
      var s = settingsOf(x.p);
      return '<li><a class="ch-row st-prow ch-enter" style="--i:' + i + '" href="#/p/' + encodeURIComponent(x.p.id) + '">' +
        '<span class="ch-row__lead"><span class="st-pthumb" data-o="' + s.orientation + '">' + (x.takes.find(function (t) { return t.thumb; }) ? '<img alt="" src="' + x.takes.find(function (t) { return t.thumb; }).thumb + '">' : ic('clapper', 22)) + '</span></span>' +
        '<span class="ch-row__main"><span class="ch-row__title">' + esc(x.p.name) + '</span>' +
        '<span class="ch-row__sub">' + st.done + ' of ' + st.total + ' scenes done · ' + st.takes + (st.takes === 1 ? ' take' : ' takes') + (st.size ? ' · ' + fmtBytes(st.size) : '') + '</span>' +
        '<span class="st-meter st-meter--sm"><i style="width:' + (st.total ? Math.round(st.done / st.total * 100) : 0) + '%"></i></span></span>' +
        '<span class="ch-row__trail">' + ic('right', 18, 'ch-row__chev') + '</span></a></li>';
    }).join('');
    main.innerHTML =
      '<section class="ch-card st-new ch-enter" aria-labelledby="new-h">' +
        '<div class="ch-card__head"><span class="ch-card__icon">' + ic('clapper', 20) + '</span><h2 class="ch-card__title" id="new-h">New project</h2></div>' +
        '<form class="st-newform" id="new-form" autocomplete="off"><div class="ch-field"><label class="ch-label" for="new-name">Project name</label><input class="ch-input" id="new-name" maxlength="60" required></div>' +
        '<button type="submit" class="ch-btn ch-btn--primary">' + ic('plus', 18) + 'Create</button></form>' +
        '<p class="ch-help">Next you set the scene line-up, orientation, countdown and review options. Then shoot.</p>' +
      '</section>' +
      (rows ? '<div class="ch-section-head"><h2>Projects</h2><span class="ch-muted st-small">' + all.length + '</span></div><ul class="ch-list ch-list--inset">' + rows + '</ul>'
        : '<div class="ch-empty"><div class="ch-empty__icon">' + ic('camera', 26) + '</div><div class="ch-empty__title">No projects yet</div><p>Make one for each sketch, show or video. Every take you shoot is filed under its scene.</p></div>') +
      '<div class="st-privacy ch-card ch-card--flat ch-card--tight">' + ic('shield', 20) + '<div><strong>Everything stays on this phone.</strong> Videos are saved in this browser\'s private storage and never uploaded. They only leave when you share or export them.<div class="st-storage" id="home-storage">' + (used ? 'Studio uses ' + fmtBytes(used) + '. ' : '') + '</div></div></div>';
    $('#new-form').onsubmit = function (e) {
      e.preventDefault();
      var name = $('#new-name').value.trim();
      if (!name) { $('#new-name').focus(); return; }
      createProject(name);
    };
    var est = await Store.estimate();
    if (est && $('#home-storage')) $('#home-storage').textContent = (used ? 'Studio uses ' + fmtBytes(used) + '. ' : '') + fmtBytes(est.free) + ' free for recording.';
  }
  async function createProject(name) {
    var p = { id: uid(), name: name, created: Date.now(), settings: Object.assign({}, DEFAULT_SETTINGS, { voiceLang: defaultLang() }), scenes: [{ id: uid(), name: '', takeCounter: 0 }], current: null };
    p.current = p.scenes[0].id;
    await Store.putProject(p);
    haptic('success');
    S.project = p; S.takes = []; S.tab = 'lineup';
    location.hash = '#/p/' + encodeURIComponent(p.id) + '/lineup';
  }

  // ============================================================================================
  // PROJECT
  // ============================================================================================
  function sceneLabel(i, s) { return 'Scene ' + (i + 1) + (s && s.name ? ' · ' + s.name : ''); }
  function renderProject() {
    var p = S.project; if (!p) return;
    var st = projectStats(p, S.takes), s = settingsOf(p);
    var cs = currentScene(), ci = cs ? sceneIndex(p, cs.id) : 0;
    setHeader(p.name, null, { href: '#/', label: 'Back to Studio' },
      '<button type="button" class="ch-iconbtn" data-act="rename-project" aria-label="Rename project">' + ic('pen', 20) + '</button>');
    var pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    var hero = '<section class="ch-card ch-card--accent st-hero ch-enter">' +
      '<div class="st-hero__row"><div><div class="ch-eyebrow">' + (s.orientation === 'portrait' ? 'Vertical 9:16' : 'Horizontal 16:9') + ' · ' + (s.countdown ? s.countdown + ' s countdown' : 'No countdown') + '</div>' +
      '<div class="st-hero__big"><span>' + st.done + '</span> of ' + st.total + ' scenes done</div></div>' +
      '<span class="st-orient-badge" data-o="' + s.orientation + '" aria-hidden="true">' + ic(s.orientation === 'portrait' ? 'portrait' : 'landscape', 26) + '</span></div>' +
      '<div class="st-meter"><i style="width:' + pct + '%"></i></div>' +
      '<button type="button" class="ch-btn ch-btn--primary ch-btn--lg ch-btn--block st-shoot" data-act="shoot">' + ic('camera', 20) + 'Start shooting</button>' +
      '<p class="st-hero__next">' + (cs ? 'Up next: <strong>' + esc(sceneLabel(ci, cs)) + '</strong> · take ' + ((cs.takeCounter || 0) + 1) : 'Add a scene to start') + '</p></section>';
    var tabs = '<div class="ch-segmented ch-segmented--block st-tabs" role="tablist">' +
      ['lineup', 'takes', 'setup'].map(function (t) {
        var lbl = { lineup: 'Line-up', takes: 'Takes', setup: 'Setup' }[t];
        var n = t === 'takes' ? ' <span class="st-tabcount">' + st.takes + '</span>' : t === 'lineup' ? ' <span class="st-tabcount">' + st.total + '</span>' : '';
        return '<button type="button" role="tab" aria-selected="' + (S.tab === t) + '" aria-pressed="' + (S.tab === t) + '" data-act="tab" data-tab="' + t + '">' + lbl + n + '</button>';
      }).join('') + '</div>';
    var body = S.tab === 'takes' ? renderTakes() : S.tab === 'setup' ? renderSetup() : renderLineup();
    main.innerHTML = hero + tabs + '<div class="st-tabbody" id="tabbody">' + body + '</div>';
    if (S.tab === 'setup') wireSetup();
    if (S.tab === 'lineup') wireLineup();
    if (S.tab === 'takes') fillStorage();
  }

  // ---------- line-up ----------
  function renderLineup() {
    var p = S.project;
    var rows = p.scenes.map(function (sc, i) {
      var n = takesOf(sc.id).length, done = sceneDone(sc.id);
      return '<li class="st-scene' + (done ? ' is-done' : '') + '" data-id="' + sc.id + '">' +
        '<label class="st-scene__num" for="sn-' + sc.id + '"><span class="ch-sr">Scene </span>' + (i + 1) + '</label>' +
        '<div class="st-scene__main"><input class="ch-input st-scene__name" id="sn-' + sc.id + '" value="' + esc(sc.name) + '" maxlength="80" aria-label="Scene ' + (i + 1) + ' name" data-act-input="scene-name">' +
        '<span class="st-scene__meta">' + (done ? ic('check', 14) + ' Done · ' : '') + n + (n === 1 ? ' take' : ' takes') + '</span></div>' +
        '<div class="st-scene__tools"><button type="button" class="ch-iconbtn" data-act="scene-up" aria-label="Move scene ' + (i + 1) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + ic('up', 20) + '</button>' +
        '<button type="button" class="ch-iconbtn" data-act="scene-down" aria-label="Move scene ' + (i + 1) + ' down"' + (i === p.scenes.length - 1 ? ' disabled' : '') + '>' + ic('down', 20) + '</button>' +
        '<button type="button" class="ch-iconbtn st-danger-ic" data-act="scene-del" aria-label="Delete scene ' + (i + 1) + '">' + ic('trash', 19) + '</button></div></li>';
    }).join('');
    return '<p class="st-lead">Scene numbers follow this order. Takes are filed under their scene as Take 1, 2, 3, and exports come out in this order.</p>' +
      '<ol class="st-scenes" id="scenes">' + rows + '</ol>' +
      '<div class="st-row-actions"><button type="button" class="ch-btn ch-btn--secondary" data-act="scene-add">' + ic('plus', 18) + 'Add scene</button>' +
      '<button type="button" class="ch-btn ch-btn--secondary" data-act="paste">' + ic('clipboard', 18) + 'Paste a list</button></div>';
  }
  var nameTimer = null;
  function wireLineup() {
    $$('[data-act-input="scene-name"]', main).forEach(function (inp) {
      inp.addEventListener('input', function () {
        var id = inp.closest('.st-scene').dataset.id, sc = sceneById(S.project, id);
        if (sc) sc.name = inp.value.trim();
        clearTimeout(nameTimer); nameTimer = setTimeout(saveProject, 400);
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var li = inp.closest('.st-scene'); var nx = li.nextElementSibling; if (nx) nx.querySelector('input').focus(); else addScene(true); }
      });
    });
  }
  async function addScene(focus) {
    var sc = { id: uid(), name: '', takeCounter: 0 };
    S.project.scenes.push(sc);
    if (!S.project.current) S.project.current = sc.id;
    await saveProject(); renderProject();
    if (focus !== false) { var el = $('#sn-' + sc.id); if (el) el.focus(); }
  }
  function parseLines(text) {
    return text.split(/\r?\n/).map(function (l) {
      return l.replace(/^\s*(?:scene|scena|sc\.?|s)?\s*#?\d+[a-z]?\s*[.):\-–—]?\s*/i, function (m) { return /\d/.test(m) ? '' : m; }).replace(/^[\s\-–—*•·]+/, '').trim();
    }).filter(Boolean);
  }
  function openPaste() {
    openSheet('<h2 class="ch-sheet__title" id="st-sheet-title">Paste a line-up</h2>' +
      '<div class="ch-field"><label class="ch-label" for="paste-text">One scene per line</label><textarea class="ch-input st-paste" id="paste-text" rows="8" autofocus></textarea>' +
      '<p class="ch-help">Numbers like "1.", "Scene 3:" or bullets are removed. Each line becomes a scene in this order.</p></div>' +
      '<div class="ch-segmented ch-segmented--block st-paste-mode" role="radiogroup" aria-label="Where to put them">' +
      '<label><input type="radio" name="pm" value="append" checked>Add after current scenes</label><label><input type="radio" name="pm" value="replace">Replace empty line-up</label></div>' +
      '<p class="st-paste-count ch-help" id="paste-count">0 scenes</p>' +
      '<div class="st-sheet-actions"><button type="button" class="ch-btn ch-btn--secondary" id="paste-cancel">Cancel</button><button type="button" class="ch-btn ch-btn--primary" id="paste-go">Create scenes</button></div>');
    var ta = $('#paste-text');
    var upd = function () { var n = parseLines(ta.value).length; $('#paste-count').textContent = n + (n === 1 ? ' scene' : ' scenes'); };
    ta.addEventListener('input', upd);
    $('#paste-cancel').onclick = closeSheet;
    $('#paste-go').onclick = async function () {
      var names = parseLines(ta.value);
      if (!names.length) { ta.focus(); return; }
      var mode = (sheetBody.querySelector('input[name=pm]:checked') || {}).value;
      var p = S.project;
      // "Replace" only drops scenes that have no takes, so nothing recorded is ever lost.
      if (mode === 'replace') p.scenes = p.scenes.filter(function (sc) { return takesOf(sc.id).length; });
      else p.scenes = p.scenes.filter(function (sc) { return sc.name || takesOf(sc.id).length; });
      names.forEach(function (n) { p.scenes.push({ id: uid(), name: n.slice(0, 80), takeCounter: 0 }); });
      if (!sceneById(p, p.current)) p.current = p.scenes[0].id;
      await saveProject();
      closeSheet(); haptic('success');
      toast(names.length + ' scenes added');
      renderProject();
    };
  }

  // ---------- setup ----------
  function seg(name, value, opts) {
    return '<div class="ch-segmented ch-segmented--block" role="radiogroup" aria-label="' + esc(name) + '">' + opts.map(function (o) {
      return '<label><input type="radio" name="' + esc(name) + '" value="' + o[0] + '"' + (String(value) === String(o[0]) ? ' checked' : '') + '>' + (o[2] ? ic(o[2], 16) : '') + esc(o[1]) + '</label>';
    }).join('') + '</div>';
  }
  function toggle(id, label, on, help, disabled) {
    return '<div class="st-set"><label class="ch-toggle st-toggle"><input type="checkbox" role="switch" id="' + id + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span class="ch-toggle__track"></span><span class="st-toggle__txt">' + esc(label) + '</span></label>' + (help ? '<p class="ch-help">' + esc(help) + '</p>' : '') + '</div>';
  }
  function gesturesAvailable() { return !!(window.StudioGestures && window.StudioGestures.start); }
  function renderSetup() {
    var s = settingsOf(S.project);
    var gOk = gesturesAvailable();
    return '<section class="ch-card st-setcard"><h3 class="st-h3">Orientation</h3>' +
      seg('orientation', s.orientation, [['landscape', 'Horizontal 16:9', 'landscape'], ['portrait', 'Vertical 9:16', 'portrait']]) +
      '<p class="ch-help">The camera warns you, loudly, whenever the phone is held the other way.</p></section>' +
      '<section class="ch-card st-setcard"><h3 class="st-h3">Countdown</h3>' +
      seg('countdown', s.countdown, [[0, 'Off'], [3, '3 s'], [5, '5 s'], [10, '10 s']]) +
      toggle('set-voice', 'Voice countdown', s.voice, 'Says "Scene 3, take 2 … 3, 2, 1, action!" out loud. Recording starts only after the voice has finished, so it is never in the take. With the voice off you hear beeps.') +
      '<div class="ch-field"><label class="ch-label" for="set-lang">Voice language</label><select class="ch-input" id="set-lang">' +
      LANGS.map(function (l) { return '<option value="' + l.code + '"' + (l.code === s.voiceLang ? ' selected' : '') + '>' + esc(l.label) + '</option>'; }).join('') + '</select></div>' +
      '<button type="button" class="ch-btn ch-btn--secondary ch-btn--sm st-testvoice" data-act="test-voice">' + ic('volume', 16) + 'Test the voice</button></section>' +
      '<section class="ch-card st-setcard"><h3 class="st-h3">After each take</h3>' +
      toggle('set-review', 'Review after each take', s.review, 'Plays the take back straight away: keep it, retake, or go on to the next scene.') +
      toggle('set-advance', 'Go to the next scene after keeping a take', s.autoAdvance, 'The first take you keep in a scene gets the star (best take). You can change it later.') +
      '</section>' +
      '<section class="ch-card st-setcard"><h3 class="st-h3">Hand gestures</h3>' +
      toggle('set-gestures', 'Control the camera with your hand', s.gestures && gOk, gOk ? 'Open palm: start the countdown. Fist: cut. Thumbs up: keep. Thumbs down: retake. Victory: next scene. Point up: replay.' : 'Hand gestures are not available in this browser right now.', !gOk) +
      '</section>' +
      '<section class="ch-card st-setcard st-danger"><h3 class="st-h3">Project</h3><p class="ch-help">Deleting removes every take of this project from the phone and frees the space.</p>' +
      '<div class="st-row-actions"><button type="button" class="ch-btn ch-btn--secondary" data-act="rename-project">' + ic('pen', 18) + 'Rename</button><button type="button" class="ch-btn ch-btn--danger" data-act="delete-project">' + ic('trash', 18) + 'Delete project</button></div></section>';
  }
  function wireSetup() {
    var p = S.project;
    function set(k, v) { p.settings = Object.assign(settingsOf(p), p.settings || {}); p.settings[k] = v; saveProject(); haptic('selection'); }
    $$('input[name=orientation]', main).forEach(function (r) { r.onchange = function () { set('orientation', r.value); renderProject(); }; });
    $$('input[name=countdown]', main).forEach(function (r) { r.onchange = function () { set('countdown', Number(r.value)); }; });
    $('#set-voice').onchange = function (e) { set('voice', e.target.checked); };
    $('#set-lang').onchange = function (e) { set('voiceLang', e.target.value); };
    $('#set-review').onchange = function (e) { set('review', e.target.checked); };
    $('#set-advance').onchange = function (e) { set('autoAdvance', e.target.checked); };
    $('#set-gestures').onchange = function (e) { set('gestures', e.target.checked); };
  }

  // ---------- takes (library) ----------
  function takeCard(t, sc, i) {
    var o = (t.h > t.w) ? 'portrait' : 'landscape';
    return '<div class="st-take' + (t.starred ? ' is-best' : '') + (t.status === 'retake' ? ' is-retake' : '') + '" data-take="' + t.id + '">' +
      '<button type="button" class="st-take__thumb" data-o="' + o + '" data-act="play-take" aria-label="Play scene ' + (i + 1) + ' take ' + t.n + '">' +
        (t.thumb ? '<img alt="" src="' + t.thumb + '">' : '<span class="st-take__noimg">' + ic('film', 24) + '</span>') +
        '<span class="st-take__dur">' + fmtDur(t.duration) + '</span><span class="st-take__play">' + ic('play', 18) + '</span>' +
        (t.flags && t.flags.orientation ? '<span class="st-take__flag" title="Phone was held the wrong way during this take">' + ic('alert', 13) + 'Orientation</span>' : '') +
      '</button>' +
      '<div class="st-take__meta"><span class="st-take__n">Take ' + t.n + '</span>' +
        '<button type="button" class="st-star" data-act="star" aria-pressed="' + !!t.starred + '" aria-label="' + (t.starred ? 'Best take' : 'Mark as best take') + '">' + ic('star', 18, t.starred ? 'filled' : '') + '</button></div>' +
      '<div class="st-take__sub">' + (t.status === 'retake' ? 'Retake · ' : '') + fmtBytes(t.size) + (t.h ? ' · ' + resLabel(t.w, t.h, t.fps) : '') + '</div>' +
      '</div>';
  }
  function resLabel(w, h, fps) {
    var short = Math.min(w || 0, h || 0);
    var r = short >= 2100 ? '4K' : short >= 1400 ? '1440p' : short >= 1060 ? '1080p' : short >= 700 ? '720p' : short + 'p';
    return r + (fps ? fps : '');
  }
  function renderTakes() {
    var p = S.project;
    var best = p.scenes.map(function (sc) { return bestTake(sc.id); }).filter(Boolean);
    var totalDur = best.reduce(function (a, t) { return a + (t.duration || 0); }, 0);
    var tools = '<div class="st-libtools"><button type="button" class="ch-btn ch-btn--secondary" data-act="play-all"' + (best.length ? '' : ' disabled') + '>' + ic('play', 16) + 'Play all best takes</button>' +
      '<button type="button" class="ch-btn ch-btn--primary" data-act="export"' + (S.takes.length ? '' : ' disabled') + '>' + ic('share', 18) + 'Export</button></div>' +
      '<p class="st-lead">' + (best.length ? best.length + ' best ' + (best.length === 1 ? 'take' : 'takes') + ' · ' + fmtDur(totalDur) + ' in scene order. ' : '') + 'Tap the star to choose the best take of a scene.</p>';
    var scenes = p.scenes.map(function (sc, i) {
      var ts = takesOf(sc.id);
      return '<section class="st-libscene" data-id="' + sc.id + '"><div class="st-libscene__head">' +
        '<span class="st-libscene__num' + (sceneDone(sc.id) ? ' is-done' : '') + '">' + (i + 1) + '</span>' +
        '<h3 class="st-libscene__title">' + esc(sc.name || 'Scene ' + (i + 1)) + '</h3>' +
        '<span class="st-libscene__count">' + ts.length + (ts.length === 1 ? ' take' : ' takes') + '</span>' +
        '<button type="button" class="ch-iconbtn" data-act="rename-scene" aria-label="Rename scene ' + (i + 1) + '">' + ic('pen', 18) + '</button></div>' +
        (ts.length ? '<div class="st-takes">' + ts.map(function (t) { return takeCard(t, sc, i); }).join('') + '</div>'
          : '<div class="st-notakes"><span>No takes yet</span><button type="button" class="ch-btn ch-btn--sm ch-btn--secondary" data-act="shoot-scene">' + ic('camera', 16) + 'Shoot this scene</button></div>') +
        '</section>';
    }).join('');
    return tools + scenes + '<div class="st-privacy ch-card ch-card--flat ch-card--tight">' + ic('drive', 20) + '<div><strong>On this phone only.</strong> <span id="lib-storage"></span></div></div>';
  }
  async function fillStorage() {
    var est = await Store.estimate();
    var st = projectStats(S.project, S.takes);
    var el = $('#lib-storage');
    if (el) el.textContent = 'This project uses ' + fmtBytes(st.size) + (est ? '. ' + fmtBytes(est.free) + ' free.' : '.') + ' Delete takes you don\'t need to free space.';
  }
  async function toggleStar(id) {
    var t = S.takes.find(function (x) { return x.id === id; }); if (!t) return;
    var on = !t.starred;
    for (var i = 0; i < S.takes.length; i++) {
      var o = S.takes[i];
      if (o.sceneId === t.sceneId && o.starred && o.id !== t.id) { o.starred = false; await Store.putTake(o); }
    }
    t.starred = on;
    if (on && t.status === 'retake') t.status = 'kept';
    await Store.putTake(t);
    haptic(on ? 'success' : 'selection');
  }
  async function deleteTake(id) {
    var t = S.takes.find(function (x) { return x.id === id; }); if (!t) return;
    var sc = sceneById(S.project, t.sceneId), i = sceneIndex(S.project, t.sceneId);
    var ok = await confirmSheet('Delete take ' + t.n + '?', 'Scene ' + (i + 1) + (sc && sc.name ? ' · ' + sc.name : '') + '. This removes the video from the phone (' + fmtBytes(t.size) + ').', 'Delete take', true);
    if (!ok) return false;
    await Store.deleteTake(id);
    S.takes = S.takes.filter(function (x) { return x.id !== id; });
    haptic('warning');
    toast('Deleted. Freed ' + fmtBytes(t.size));
    return true;
  }

  // ---------- project actions ----------
  async function renameProject() {
    openSheet('<h2 class="ch-sheet__title" id="st-sheet-title">Rename project</h2><div class="ch-field"><label class="ch-label" for="rn-in">Project name</label><input class="ch-input" id="rn-in" maxlength="60" value="' + esc(S.project.name) + '" autofocus></div>' +
      '<div class="st-sheet-actions"><button type="button" class="ch-btn ch-btn--secondary" id="rn-c">Cancel</button><button type="button" class="ch-btn ch-btn--primary" id="rn-ok">Save</button></div>');
    $('#rn-c').onclick = closeSheet;
    var go = async function () { var v = $('#rn-in').value.trim(); if (!v) return; S.project.name = v; await saveProject(); closeSheet(); renderProject(); };
    $('#rn-ok').onclick = go; $('#rn-in').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }
  function renameScene(id) {
    var sc = sceneById(S.project, id), i = sceneIndex(S.project, id);
    openSheet('<h2 class="ch-sheet__title" id="st-sheet-title">Scene ' + (i + 1) + '</h2><div class="ch-field"><label class="ch-label" for="rs-in">Scene name</label><input class="ch-input" id="rs-in" maxlength="80" value="' + esc(sc.name) + '" autofocus></div>' +
      '<div class="st-sheet-actions"><button type="button" class="ch-btn ch-btn--secondary" id="rs-c">Cancel</button><button type="button" class="ch-btn ch-btn--primary" id="rs-ok">Save</button></div>');
    $('#rs-c').onclick = closeSheet;
    var go = async function () { sc.name = $('#rs-in').value.trim(); await saveProject(); closeSheet(); renderProject(); };
    $('#rs-ok').onclick = go; $('#rs-in').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }
  async function deleteProject() {
    var st = projectStats(S.project, S.takes);
    var ok = await confirmSheet('Delete "' + S.project.name + '"?', 'This deletes ' + st.takes + ' takes (' + fmtBytes(st.size) + ') from the phone. It can\'t be undone.', 'Delete project', true);
    if (!ok) return;
    await Store.deleteProject(S.project.id);
    haptic('warning');
    S.project = null;
    location.hash = '#/';
    setTimeout(function () { toast('Project deleted. Freed ' + fmtBytes(st.size)); }, 100);
  }

  main.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    var act = b.dataset.act, p = S.project;
    var li = b.closest('[data-id]'), sid = li && li.dataset.id;
    var tk = b.closest('[data-take]'), tid = tk && tk.dataset.take;
    if (act === 'tab') { S.tab = b.dataset.tab; history.replaceState(null, '', '#/p/' + encodeURIComponent(p.id) + '/' + S.tab); renderProject(); haptic('selection'); }
    else if (act === 'shoot') { enterCamera(); }
    else if (act === 'shoot-scene') { p.current = sid; await saveProject(); enterCamera(); }
    else if (act === 'scene-add') { addScene(true); }
    else if (act === 'paste') { openPaste(); }
    else if (act === 'scene-up' || act === 'scene-down') {
      var i = sceneIndex(p, sid), j = act === 'scene-up' ? i - 1 : i + 1;
      if (j < 0 || j >= p.scenes.length) return;
      var tmp = p.scenes[i]; p.scenes[i] = p.scenes[j]; p.scenes[j] = tmp;
      await saveProject(); renderProject(); haptic('selection');
      var btn = $('.st-scene[data-id="' + sid + '"] [data-act="' + act + '"]'); if (btn && !btn.disabled) btn.focus();
    }
    else if (act === 'scene-del') {
      var n = takesOf(sid).length, idx = sceneIndex(p, sid);
      if (n) {
        var ok = await confirmSheet('Delete scene ' + (idx + 1) + '?', 'Its ' + n + (n === 1 ? ' take' : ' takes') + ' will be deleted from the phone too.', 'Delete scene', true);
        if (!ok) return;
        var ts = takesOf(sid);
        for (var k = 0; k < ts.length; k++) await Store.deleteTake(ts[k].id);
        S.takes = S.takes.filter(function (t) { return t.sceneId !== sid; });
      }
      p.scenes.splice(idx, 1);
      if (p.current === sid) p.current = p.scenes[Math.min(idx, p.scenes.length - 1)] ? p.scenes[Math.min(idx, p.scenes.length - 1)].id : null;
      await saveProject(); renderProject();
    }
    else if (act === 'test-voice') {
      var s = settingsOf(p), L = langOf(s.voiceLang);
      await speak(L.scene.replace('{s}', 1).replace('{t}', 1), s.voiceLang); await speak('3', s.voiceLang); await speak(L.action, s.voiceLang);
    }
    else if (act === 'rename-project') renameProject();
    else if (act === 'delete-project') deleteProject();
    else if (act === 'rename-scene') renameScene(sid);
    else if (act === 'star') { await toggleStar(tid); renderProject(); }
    else if (act === 'play-take') { openPlayer([tid], 0, { single: true }); }
    else if (act === 'play-all') { var ids = p.scenes.map(function (sc) { return bestTake(sc.id); }).filter(Boolean).map(function (t) { return t.id; }); if (ids.length) openPlayer(ids, 0, {}); }
    else if (act === 'export') openExport();
  });
  $('#st-actions').addEventListener('click', function (e) { var b = e.target.closest('[data-act]'); if (b && b.dataset.act === 'rename-project') renameProject(); });

  // ============================================================================================
  // PLAYER (one take, or every best take in scene order)
  // ============================================================================================
  var playerEl = $('#player'), player = null;
  async function openPlayer(ids, at, opts) {
    closePlayer();
    player = { ids: ids, i: at || 0, opts: opts || {}, url: null };
    playerEl.innerHTML =
      '<div class="player__top"><button type="button" class="cam-btn" data-pa="close" aria-label="Close player">' + ic('x', 22) + '</button>' +
      '<div class="player__title"><span id="player-title"></span><small id="player-sub"></small></div>' +
      (ids.length > 1 ? '<span class="player__count" id="player-count"></span>' : '<span class="player__spacer"></span>') + '</div>' +
      '<div class="player__stage"><video id="player-video" playsinline preload="auto"></video><div class="player__label" id="player-label" aria-hidden="true"></div></div>' +
      '<div class="player__bar"><span class="player__time" id="pl-t">0:00</span><input type="range" class="st-range" id="pl-seek" min="0" max="1000" value="0" aria-label="Position"><span class="player__time" id="pl-d">0:00</span></div>' +
      '<div class="player__controls">' +
        (ids.length > 1 ? '<button type="button" class="cam-btn" data-pa="prev" aria-label="Previous take">' + ic('prev', 20) + '</button>' : '') +
        '<button type="button" class="player__pp" data-pa="pp" aria-label="Pause" id="pl-pp">' + ic('pause', 26) + '</button>' +
        (ids.length > 1 ? '<button type="button" class="cam-btn" data-pa="next" aria-label="Next take">' + ic('next', 20) + '</button>' : '') +
      '</div>' +
      (player.opts.single ? '<div class="player__actions">' +
        '<button type="button" class="player__act" data-pa="star" id="pl-star">' + ic('star', 20) + '<span>Best</span></button>' +
        '<button type="button" class="player__act" data-pa="share">' + ic('share', 20) + '<span>Share</span></button>' +
        '<button type="button" class="player__act player__act--danger" data-pa="delete">' + ic('trash', 20) + '<span>Delete</span></button></div>' : '');
    playerEl.hidden = false;
    html.setAttribute('data-appnav', 'off'); navRefresh();
    var v = $('#player-video');
    v.addEventListener('timeupdate', playerTime);
    v.addEventListener('loadedmetadata', playerTime);
    v.addEventListener('play', function () { setPP('#pl-pp', true, 26); });
    v.addEventListener('pause', function () { setPP('#pl-pp', false, 26); });
    v.addEventListener('ended', function () { if (player && player.i < player.ids.length - 1) playerGo(player.i + 1); });
    $('#pl-seek').addEventListener('input', function (e) { var d = playerDuration(); if (d) v.currentTime = e.target.value / 1000 * d; });
    await playerGo(player.i);
    setTimeout(function () { var c = playerEl.querySelector('[data-pa="close"]'); if (c) c.focus(); }, 50);
  }
  function playerTake() { return player && S.takes.find(function (t) { return t.id === player.ids[player.i]; }); }
  function playerDuration() { var v = $('#player-video'), t = playerTake(); return v && isFinite(v.duration) && v.duration > 0 ? v.duration : (t ? t.duration : 0); }
  function setPP(sel, playing, size) { var b = $(sel); if (!b) return; b.innerHTML = ic(playing ? 'pause' : 'play', size); b.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
  function playerTime() {
    var v = $('#player-video'); if (!v || !$('#pl-t')) return;
    var d = playerDuration();
    $('#pl-t').textContent = fmtDur(v.currentTime); $('#pl-d').textContent = fmtDur(d);
    if (d) $('#pl-seek').value = Math.round(v.currentTime / d * 1000);
  }
  async function playerGo(i) {
    if (!player) return;
    player.i = Math.max(0, Math.min(player.ids.length - 1, i));
    var t = playerTake(); if (!t) return;
    var sc = sceneById(S.project, t.sceneId), si = sceneIndex(S.project, t.sceneId);
    $('#player-title').textContent = 'Scene ' + (si + 1) + (sc && sc.name ? ' · ' + sc.name : '');
    $('#player-sub').textContent = 'Take ' + t.n + ' · ' + fmtDur(t.duration) + ' · ' + fmtBytes(t.size);
    var c = $('#player-count'); if (c) c.textContent = (player.i + 1) + ' / ' + player.ids.length;
    var lab = $('#player-label'); lab.textContent = 'S' + pad(si + 1) + ' · T' + t.n; lab.classList.remove('is-in'); void lab.offsetWidth; lab.classList.add('is-in');
    var star = $('#pl-star'); if (star) { star.classList.toggle('is-on', !!t.starred); star.innerHTML = ic('star', 20, t.starred ? 'filled' : '') + '<span>' + (t.starred ? 'Best take' : 'Mark best') + '</span>'; }
    var blob = await Store.getClip(t);
    var v = $('#player-video');
    if (player.url) URL.revokeObjectURL(player.url);
    if (!blob) { toast('This video is missing from storage'); return; }
    player.url = URL.createObjectURL(blob);
    v.src = player.url;
    try { await v.play(); } catch (e) { v.muted = true; try { await v.play(); } catch (e2) { /* user taps play */ } }
  }
  function closePlayer() {
    if (!player) return;
    var v = $('#player-video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    if (player.url) URL.revokeObjectURL(player.url);
    player = null; playerEl.hidden = true; playerEl.innerHTML = '';
    if (!camOpen) { html.removeAttribute('data-appnav'); navRefresh(); }
  }
  playerEl.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-pa]'); if (!b || !player) return;
    var a = b.dataset.pa, v = $('#player-video'), t = playerTake();
    if (a === 'close') { closePlayer(); renderProject(); }
    else if (a === 'pp') { if (v.paused) { v.muted = false; v.play(); } else v.pause(); }
    else if (a === 'prev') playerGo(player.i - 1);
    else if (a === 'next') playerGo(player.i + 1);
    else if (a === 'star') { await toggleStar(t.id); playerGo(player.i); }
    else if (a === 'share') { shareTakes([t]); }
    else if (a === 'delete') { v.pause(); if (await deleteTake(t.id)) { closePlayer(); renderProject(); } }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && player) { closePlayer(); renderProject(); }
  });

  // ============================================================================================
  // EXPORT / HANDOFF
  // ============================================================================================
  function extOf(t) { return t.ext || (/webm/.test(t.mimeType || '') ? 'webm' : 'mp4'); }
  function fileName(t) {
    var p = S.project, si = sceneIndex(p, t.sceneId), sc = sceneById(p, t.sceneId);
    var X = window.StudioExport;
    if (X && X.filename) { try { return X.filename(p.name, si + 1, sc ? sc.name : '', t.n, extOf(t)); } catch (e) { /* fall back */ } }
    var clean = function (s) { return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); };
    return (clean(p.name) || 'Studio') + '_S' + pad(si + 1) + (sc && sc.name ? '_' + clean(sc.name) : '') + '_Take' + t.n + '.' + extOf(t);
  }
  // Takes recorded with different resolution / frame rate / format can't be joined losslessly.
  function takeSig(t) { return [Math.max(t.w || 0, t.h || 0), Math.min(t.w || 0, t.h || 0), t.fps || 0, (t.mimeType || '').split(';')[0]].join('|'); }
  function mixedSettings(takes) {
    var sigs = {}; takes.forEach(function (t) { sigs[takeSig(t)] = t; });
    var k = Object.keys(sigs); if (k.length < 2) return '';
    return k.slice(0, 3).map(function (x) { var t = sigs[x]; return resLabel(t.w, t.h, t.fps) + ' ' + extOf(t).toUpperCase(); }).join(', ');
  }
  function bestTakes() { return S.project.scenes.map(function (sc) { return bestTake(sc.id); }).filter(Boolean); }
  function allTakesInOrder() {
    var out = []; S.project.scenes.forEach(function (sc) { takesOf(sc.id).forEach(function (t) { out.push(t); }); }); return out;
  }
  async function filesFor(takes) {
    var files = [];
    for (var i = 0; i < takes.length; i++) {
      var b = await Store.getClip(takes[i]);
      if (b) files.push(new File([b], fileName(takes[i]), { type: (takes[i].mimeType || 'video/mp4').split(';')[0] }));
    }
    return files;
  }
  function downloadFile(file) {
    var a = document.createElement('a'), url = URL.createObjectURL(file);
    a.href = url; a.download = file.name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  async function deliver(files) {
    var X = window.StudioExport;
    if (X && X.share) { try { return await X.share(files, { title: S.project ? S.project.name : 'Studio' }); } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; } }
    if (navigator.canShare && navigator.share) {
      try { if (navigator.canShare({ files: files })) { await navigator.share({ files: files }); return 'shared'; } }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    for (var i = 0; i < files.length; i++) { downloadFile(files[i]); await sleep(450); }
    return 'downloaded';
  }
  async function shareTakes(takes) {
    var files = await filesFor(takes);
    if (!files.length) { toast('Nothing to share'); return; }
    var r = await deliver(files);
    if (r === 'shared') toast('Shared'); else if (r === 'downloaded') toast(files.length === 1 ? 'Saved to Downloads' : files.length + ' clips saved to Downloads');
  }
  var exportCtl = null;
  function openExport() {
    var X = window.StudioExport, best = bestTakes(), all = allTakesInOrder();
    var dur = best.reduce(function (a, t) { return a + (t.duration || 0); }, 0);
    var size = best.reduce(function (a, t) { return a + (t.size || 0); }, 0);
    var join = { lossless: false, reason: '' }, canJoin = !!(X && X.join) && best.length > 0;
    if (canJoin && X.canJoin) {
      try { join = X.canJoin(best.map(function (t) { return { blob: new Blob([], { type: (t.mimeType || 'video/mp4').split(';')[0] }), mimeType: t.mimeType, name: fileName(t), size: t.size, width: t.w, height: t.h, fps: t.fps, duration: t.duration }; })) || join; } catch (e) { /* ignore */ }
    }
    var missing = S.project.scenes.length - best.length;
    var mixed = mixedSettings(best);
    if (canJoin && mixed && join.lossless) join = { lossless: false, reason: 'Some takes were recorded with different settings (' + mixed + '), so the joined video will be re-encoded.' };
    openSheet('<h2 class="ch-sheet__title" id="st-sheet-title">Export</h2>' +
      '<p class="st-sheet-text">Clips come out in line-up order with clean names, ready for CapCut or the gallery. Nothing is uploaded unless you pick an app to share to.</p>' +
      '<div class="st-exp ch-card ch-card--flat ch-card--tight"><div class="st-exp__head"><span class="ch-card__icon">' + ic('film', 20) + '</span><div><h3 class="st-h3">One video</h3>' +
      '<p class="ch-help">' + best.length + ' best ' + (best.length === 1 ? 'take' : 'takes') + ' joined in scene order · ' + fmtDur(dur) + ' · about ' + fmtBytes(size) + (missing > 0 ? '. ' + missing + (missing === 1 ? ' scene has' : ' scenes have') + ' no kept take yet and will be skipped.' : '') + '</p>' +
      (canJoin ? '<p class="ch-help st-exp__reason">' + esc(join.reason || (join.lossless ? 'Joined without re-encoding: full original quality.' : '')) + '</p>' : '<p class="ch-help st-exp__reason">' + (best.length ? 'Joining isn\'t available in this browser. Use separate clips instead.' : 'Keep at least one take first.') + '</p>') +
      '</div></div>' +
      '<div class="st-exp__progress" id="exp-prog" hidden><div class="st-meter"><i id="exp-bar" style="width:0%"></i></div><div class="st-exp__ptext"><span id="exp-pct">Preparing…</span><button type="button" class="ch-btn ch-btn--ghost ch-btn--sm" id="exp-cancel">Cancel</button></div></div>' +
      '<div class="st-exp__done" id="exp-done" hidden></div>' +
      '<button type="button" class="ch-btn ch-btn--primary ch-btn--block" id="exp-join"' + (canJoin ? '' : ' disabled') + '>' + ic('film', 18) + 'Make one video</button></div>' +
      '<div class="st-exp ch-card ch-card--flat ch-card--tight"><div class="st-exp__head"><span class="ch-card__icon">' + ic('files', 20) + '</span><div><h3 class="st-h3">Separate clips</h3>' +
      '<p class="ch-help">Named in order so they line up by themselves, e.g. ' + esc(best[0] ? fileName(best[0]) : fileName({ sceneId: S.project.scenes[0] && S.project.scenes[0].id, n: 1, mimeType: 'video/mp4' })) + '</p></div></div>' +
      '<div class="ch-segmented ch-segmented--block" role="radiogroup" aria-label="Which clips"><label><input type="radio" name="exp-which" value="best" checked>Best takes (' + best.length + ')</label><label><input type="radio" name="exp-which" value="all">Every take (' + all.length + ')</label></div>' +
      '<button type="button" class="ch-btn ch-btn--secondary ch-btn--block" id="exp-clips"' + (all.length ? '' : ' disabled') + '>' + ic('share', 18) + 'Share or save clips</button></div>',
      function () { if (exportCtl) { exportCtl.abort(); exportCtl = null; } });
    $('#exp-join').onclick = function () { runJoin(best); };
    $('#exp-clips').onclick = async function () {
      var which = (sheetBody.querySelector('input[name=exp-which]:checked') || {}).value;
      var list = which === 'all' ? all : best;
      if (!list.length) { toast('No kept takes yet'); return; }
      this.disabled = true; this.innerHTML = ic('share', 18) + 'Preparing ' + list.length + ' clips…';
      try { await shareTakes(list); } finally { this.disabled = false; this.innerHTML = ic('share', 18) + 'Share or save clips'; }
    };
  }
  async function runJoin(best) {
    var X = window.StudioExport;
    var btn = $('#exp-join'), prog = $('#exp-prog'), bar = $('#exp-bar'), pct = $('#exp-pct');
    btn.disabled = true; prog.hidden = false; $('#exp-done').hidden = true;
    exportCtl = new AbortController();
    $('#exp-cancel').onclick = function () { if (exportCtl) exportCtl.abort(); };
    try {
      var clips = [];
      for (var i = 0; i < best.length; i++) {
        var b = await Store.getClip(best[i]);
        if (b) clips.push({ blob: b, mimeType: best[i].mimeType, name: fileName(best[i]), duration: best[i].duration });
      }
      var out = await X.join(clips, {
        signal: exportCtl.signal,
        onProgress: function (f) { var v = Math.max(0, Math.min(1, f || 0)); bar.style.width = Math.round(v * 100) + '%'; pct.textContent = 'Joining… ' + Math.round(v * 100) + '%'; }
      });
      exportCtl = null;
      bar.style.width = '100%'; pct.textContent = 'Done';
      var ext = /webm/.test(out.type || '') ? 'webm' : 'mp4';
      var name = null;
      try { name = X.filename ? X.filename(S.project.name, null, 'Full', null, ext) : null; } catch (e2) { /* ignore */ }
      if (!name || /S00|T0\b|Take0|null|undefined/.test(name)) name = (S.project.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Studio') + '_Full.' + ext;
      var file = new File([out], name, { type: out.type || 'video/mp4' });
      prog.hidden = true;
      var done = $('#exp-done'); done.hidden = false;
      var mode = X.lastJoinInfo && X.lastJoinInfo.mode;
      var how = mode === 'remux' || mode === 'single' ? '<span class="st-exp__badge is-ok">Lossless</span>' : mode ? '<span class="st-exp__badge">Re-encoded</span>' : '';
      done.innerHTML = '<p class="st-exp__ok">' + ic('check', 18) + '<span>' + esc(name) + ' · ' + fmtBytes(file.size) + '</span>' + how + '</p><button type="button" class="ch-btn ch-btn--primary ch-btn--block" id="exp-share">' + ic('share', 18) + 'Share or save</button>';
      $('#exp-share').onclick = async function () { var r = await deliver([file]); if (r === 'shared') toast('Shared'); else if (r === 'downloaded') toast('Saved to Downloads'); };
      haptic('success');
    } catch (e) {
      prog.hidden = true;
      if (e && e.name === 'AbortError') toast('Export cancelled');
      else { console.warn('[studio] join failed', e); toast('Couldn\'t join: ' + ((e && e.message) || 'unknown error')); }
    } finally { btn.disabled = false; }
  }

  // ============================================================================================
  // CAMERA
  // ============================================================================================
  var camOpen = false, cameras = [], wakeLock = null, audio = null, meterRaf = 0, rec = null, countdownTok = null, reviewTake = null, reviewUrl = null;
  var guard = { wrong: false, timer: null, sensor: null };
  function navRefresh() { try { if (window.ChowaniecNav) window.ChowaniecNav.refresh(); } catch (e) { /* ignore */ } }
  function setState(s) { camEl.dataset.state = s; updateRecButton(); }
  function state() { return camEl.dataset.state; }

  function enterCamera() {
    var p = S.project; if (!p) return;
    if (!p.scenes.length) { toast('Add a scene first'); return; }
    // Called from a tap: ask for full screen + orientation lock and motion permission while we still have the gesture.
    var want = settingsOf(p).orientation;
    try {
      var de = document.documentElement;
      if (de.requestFullscreen && !document.fullscreenElement) {
        de.requestFullscreen({ navigationUI: 'hide' }).then(function () { lockOrientation(want); }).catch(function () { /* not allowed */ });
      } else lockOrientation(want);
    } catch (e) { /* ignore */ }
    try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().catch(function () {}); } catch (e) { /* ignore */ }
    ensureAudioCtx();
    location.hash = '#/p/' + encodeURIComponent(p.id) + '/shoot';
  }
  function lockOrientation(want) {
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock(want).catch(function () { /* unsupported */ }); } catch (e) { /* ignore */ }
  }
  function ensureAudioCtx() {
    try {
      if (!audio) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = { ctx: new AC() }; }
      if (audio && audio.ctx.state === 'suspended') audio.ctx.resume();
    } catch (e) { /* ignore */ }
  }

  async function openCamera() {
    camOpen = true;
    camEl.hidden = false;
    document.body.setAttribute('data-immersive', '');
    html.setAttribute('data-appnav', 'off'); html.classList.add('st-camopen'); navRefresh();
    buildCamUi();
    setState('starting');
    camMsg(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camMsg('Camera not available', window.isSecureContext === false ? 'The camera only works over a secure (https) connection.' : 'This browser can\'t use the camera.', false);
      return;
    }
    try {
      await startStream(camPrefs.deviceId);
    } catch (e) {
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      camMsg(denied ? 'Allow the camera and microphone' : 'Couldn\'t start the camera', denied ? 'Studio needs the camera and microphone to record. Allow them in the browser\'s site settings, then try again.' : ((e && e.message) || 'Another app may be using it.'), true);
      return;
    }
    if (!camOpen) { Cam.close(); return; }
    requestWake();
    startGuard();
    startGestures();
    Store.persist();
    setState('idle');
    refreshStorage();
  }
  async function startStream(deviceId) {
    var stream = await Cam.open({ deviceId: deviceId || null, preset: camPrefs.preset === 'max' ? null : camPrefs.preset, video: video });
    if (!cameras.length || cameras.some(function (c) { return !c.label; })) cameras = await Cam.listCameras();
    if (!deviceId) {
      // First time: switch to the main rear camera if the browser picked another one.
      var def = Cam.defaultCameraId(cameras), curId = Cam.specs().deviceId;
      if (def && curId && def !== curId && cameras.find(function (c) { return c.deviceId === curId && c.kind !== 'back'; })) {
        stream = await Cam.open({ deviceId: def, preset: camPrefs.preset === 'max' ? null : camPrefs.preset, video: video });
      }
    }
    var curCam = cameras.find(function (c) { return c.deviceId === Cam.specs().deviceId; });
    camEl.classList.toggle('is-front', !!(curCam && curCam.kind === 'front'));
    var tr = stream.getVideoTracks()[0];
    if (tr) tr.addEventListener('ended', function () { if (camOpen && !stoppingStream) camMsg('The camera stopped', 'Another app may have taken it.', true); });
    startMeter(stream);
    await new Promise(function (r) { if (video.readyState >= 1) r(); else { video.onloadedmetadata = function () { r(); }; setTimeout(r, 1500); } });
    layoutFrame();
    renderCamControls();
    updateSpecs();
    return stream;
  }
  var stoppingStream = false;
  async function closeCamera() {
    if (!camOpen) return;
    if (state() === 'recording') await stopTake();
    cancelCountdown();
    closeReview(true);
    camOpen = false;
    stopGestures(); stopGuard(); stopMeter(); releaseWake();
    stoppingStream = true; Cam.close(); stoppingStream = false;
    setState('off');
    camEl.hidden = true;
    document.body.removeAttribute('data-immersive');
    html.removeAttribute('data-appnav'); html.classList.remove('st-camopen'); navRefresh();
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* ignore */ }
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); } catch (e) { /* ignore */ }
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    S.takes = await Store.listTakes(S.project.id);
    renderProject();
  }
  function leaveCamera() {
    var p = S.project;
    if (p) location.hash = '#/p/' + encodeURIComponent(p.id) + '/' + (S.takes.length ? 'takes' : 'lineup');
    else location.hash = '#/';
  }

  function camMsg(title, text, retry) {
    var el = $('#cam-msg'); if (!el) return;
    if (!title) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<div class="cam-msg__box"><span class="cam-msg__ic">' + ic('camera', 30) + '</span><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' +
      '<div class="cam-msg__btns">' + (retry ? '<button type="button" class="cam-pill cam-pill--light" data-act="retry">Try again</button>' : '') + '<button type="button" class="cam-pill" data-act="close">Close</button></div></div>';
  }

  // ---------- camera UI ----------
  function buildCamUi() {
    var s = settingsOf(S.project);
    camEl.dataset.orient = s.orientation;
    camEl.classList.toggle('show-grid', !!camPrefs.grid);
    camEl.classList.toggle('show-guides', !!camPrefs.guides);
    camUi.innerHTML =
      '<div class="cam-top">' +
        '<button type="button" class="cam-btn" data-act="close" aria-label="Close camera">' + ic('x', 22) + '</button>' +
        '<div class="cam-specs" id="cam-specs" aria-live="off"></div>' +
        '<div class="cam-top__tools">' +
          '<button type="button" class="cam-btn" data-act="torch" id="cam-torch" aria-label="Torch" aria-pressed="false" hidden>' + ic('zapOff', 20) + '</button>' +
          '<button type="button" class="cam-btn" data-act="grid" aria-label="Grid" aria-pressed="' + !!camPrefs.grid + '">' + ic('grid', 20) + '</button>' +
          '<button type="button" class="cam-btn" data-act="settings" aria-label="Camera settings">' + ic('sliders', 20) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="cam-hud">' +
        '<div class="cam-scene" id="cam-scene"></div>' +
        '<div class="cam-timer" id="cam-timer" hidden><i></i><span id="cam-time">00:00:00</span></div>' +
      '</div>' +
      '<div class="cam-side">' +
        '<div class="cam-meter" id="cam-meter" aria-hidden="true"><span class="cam-meter__ic">' + ic('mic', 13) + '</span><div class="cam-meter__bars"><i><b id="m-l"></b></i><i><b id="m-r"></b></i></div></div>' +
        '<div class="cam-gest" id="cam-gest" hidden>' + ic('hand', 15) + '<span id="cam-gest-t">Gestures</span></div>' +
        '<div class="cam-store" id="cam-store"></div>' +
      '</div>' +
      '<div class="cam-zoom" id="cam-zoom"></div>' +
      '<div class="cam-bottom">' +
        '<button type="button" class="cam-shotsbtn" data-act="shots" id="cam-shotsbtn" aria-label="Shot list"></button>' +
        '<button type="button" class="cam-rec" data-act="rec" id="cam-rec" aria-label="Start take"><span class="cam-rec__in"></span></button>' +
        '<button type="button" class="cam-btn cam-btn--lg" data-act="flip" id="cam-flip" aria-label="Switch camera">' + ic('flip', 24) + '</button>' +
      '</div>' +
      '<div class="cam-count" id="cam-count" hidden></div>' +
      '<div class="cam-review" id="cam-review" hidden></div>' +
      '<div class="cam-panel" id="cam-panel" hidden></div>' +
      '<div class="cam-panel cam-shots" id="cam-shots" hidden></div>' +
      '<div class="cam-warn" id="cam-warn" hidden role="alertdialog" aria-live="assertive"></div>' +
      '<div class="cam-msg" id="cam-msg" hidden></div>' +
      '<div class="cam-toast st-toast" id="cam-toast" role="status" aria-live="polite" hidden></div>';
    renderScene();
  }
  function renderScene() {
    var el = $('#cam-scene'); if (!el) return;
    var p = S.project, sc = currentScene(); if (!sc) return;
    var i = sceneIndex(p, sc.id), tn = (sc.takeCounter || 0) + 1;
    if (rec) tn = rec.n;
    if (reviewTake) tn = reviewTake.n;
    el.innerHTML = '<button type="button" class="cam-scene__nav" data-act="prev-scene" aria-label="Previous scene"' + (i === 0 ? ' disabled' : '') + '>' + ic('left', 18) + '</button>' +
      '<div class="cam-scene__txt"><span class="cam-scene__top"><b>SCENE ' + (i + 1) + '</b><span class="cam-scene__sep"></span><b class="cam-scene__take">TAKE ' + tn + '</b></span>' +
      '<span class="cam-scene__name">' + esc(sc.name || 'Untitled scene') + '</span></div>' +
      '<button type="button" class="cam-scene__nav" data-act="next-scene" aria-label="Next scene"' + (i >= p.scenes.length - 1 ? ' disabled' : '') + '>' + ic('right', 18) + '</button>';
    var sb = $('#cam-shotsbtn');
    if (sb) {
      var st = projectStats(p, S.takes), last = S.takes.slice().sort(function (a, b) { return b.created - a.created; })[0];
      sb.innerHTML = (last && last.thumb ? '<img alt="" src="' + last.thumb + '">' : ic('list', 22)) + '<span class="cam-shotsbtn__n">' + st.done + '/' + st.total + '</span>';
      sb.setAttribute('aria-label', 'Shot list, ' + st.done + ' of ' + st.total + ' scenes done');
    }
  }
  function updateRecButton() {
    var b = $('#cam-rec'); if (!b) return;
    var s = state();
    b.setAttribute('aria-label', s === 'recording' ? 'Stop take' : s === 'countdown' ? 'Cancel countdown' : 'Start take');
    b.disabled = s === 'stopping' || s === 'starting' || s === 'review';
    var busy = s === 'recording' || s === 'stopping' || s === 'countdown';
    $$('[data-act="flip"], [data-act="settings"], [data-act="shots"], [data-lens]', camUi).forEach(function (x) { x.disabled = busy; });
    renderSceneNavState();
  }
  function renderSceneNavState() {
    var p = S.project, sc = currentScene(); if (!p || !sc) return;
    var i = sceneIndex(p, sc.id), busy = /recording|stopping|countdown/.test(state());
    var pv = camUi.querySelector('[data-act="prev-scene"]'), nx = camUi.querySelector('[data-act="next-scene"]');
    if (pv) pv.disabled = busy || i === 0;
    if (nx) nx.disabled = busy || i >= p.scenes.length - 1;
  }
  function updateSpecs() {
    var el = $('#cam-specs'); if (!el) return;
    var sp = Cam.specs();
    var cam = cameras.find(function (c) { return c.deviceId === sp.deviceId; });
    el.innerHTML = '<b>' + (sp.width && sp.height ? sp.width + '×' + sp.height : '…') + '</b><span>' + sp.fps + ' fps</span><span>' + Math.round(sp.bitrate / 1e6) + ' Mbps</span><span>' + sp.container + '</span>' +
      (cam ? '<span class="cam-specs__lens">' + esc(cam.name) + '</span>' : '');
    el.title = (sp.codec ? sp.codec + ' · ' : '') + (sp.audio ? (sp.audio.sampleRate ? Math.round(sp.audio.sampleRate / 1000) + ' kHz ' : '') + (sp.audio.channels === 2 ? 'stereo' : sp.audio.channels === 1 ? 'mono' : '') : 'no sound');
  }
  async function refreshStorage() {
    var el = $('#cam-store'); if (!el) return;
    var est = await Store.estimate(); if (!est || !est.quota) { el.textContent = ''; return; }
    S.est = est;
    var sp = Cam.specs(), bps = (sp.bitrate || 12e6) / 8 + 32000;
    var mins = Math.floor(est.free / bps / 60);
    el.innerHTML = ic('drive', 13) + '<span>' + fmtBytes(est.free) + ' · ≈ ' + (mins >= 120 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min') + '</span>';
    el.classList.toggle('is-low', mins < 10);
  }

  function renderCamControls() {
    var c = Cam.caps();
    var torch = $('#cam-torch'); if (torch) torch.hidden = !c.torch;
    // Lens / zoom row like the phone's own camera app: lenses if the browser lists several rear lenses, else zoom stops.
    var zoomEl = $('#cam-zoom'); if (!zoomEl) return;
    var sp = Cam.specs();
    var curCam = cameras.find(function (x) { return x.deviceId === sp.deviceId; });
    var backs = cameras.filter(function (x) { return x.kind === 'back'; });
    var out = '';
    if (backs.length > 1 && (!curCam || curCam.kind === 'back')) {
      out += backs.slice().sort(function (a, b) { return a.zoomHint - b.zoomHint; }).map(function (x) {
        var on = curCam && x.deviceId === curCam.deviceId;
        var t = x.zoomHint < 1 ? String(x.zoomHint).replace(/^0/, '') : x.zoomHint + '';
        return '<button type="button" class="cam-zstop' + (on ? ' is-on' : '') + '" data-lens="' + esc(x.deviceId) + '" aria-pressed="' + !!on + '" aria-label="' + esc(x.name) + '">' + esc(t) + (on ? '×' : '') + '</button>';
      }).join('');
    } else if (c.zoom && c.zoom.max > c.zoom.min) {
      var stops = [c.zoom.min, 1, 2, 3, 5, 10].filter(function (z, i, a) { return z >= c.zoom.min && z <= c.zoom.max && a.indexOf(z) === i; });
      var z = Cam.settings().zoom || 1;
      out += stops.map(function (s) {
        var on = Math.abs(z - s) < 0.05;
        return '<button type="button" class="cam-zstop' + (on ? ' is-on' : '') + '" data-zoom="' + s + '" aria-pressed="' + on + '">' + (s < 1 ? String(+s.toFixed(1)).replace(/^0/, '') : s) + (on ? '×' : '') + '</button>';
      }).join('');
    }
    zoomEl.innerHTML = out;
    zoomEl.hidden = !out;
    var flip = $('#cam-flip'); if (flip) flip.style.visibility = (!cameras.some(function (x) { return x.kind === 'front'; }) && cameras.length < 2) ? 'hidden' : '';
  }

  // ---------- settings panel ----------
  function renderPanel() {
    var el = $('#cam-panel'), c = Cam.caps(), st = Cam.settings(), s = settingsOf(S.project), sp = Cam.specs();
    var avail = Cam.availablePresets();
    var q = '<div class="cam-ps"><h3>Quality</h3><div class="cam-opts">' +
      '<button type="button" class="cam-opt' + (camPrefs.preset === 'max' ? ' is-on' : '') + '" data-preset="max" aria-pressed="' + (camPrefs.preset === 'max') + '"><b>Best available</b><small>' + (avail[0] ? esc(avail[0].label) : 'Highest the lens offers') + '</small></button>' +
      avail.map(function (p) {
        var on = camPrefs.preset === p.id;
        return '<button type="button" class="cam-opt' + (on ? ' is-on' : '') + '" data-preset="' + p.id + '" aria-pressed="' + on + '"><b>' + esc(p.label) + '</b><small>' + Math.round(Cam.bitrateFor(p.w, p.h, p.fps) / 1e6) + ' Mbps</small></button>';
      }).join('') + '</div>' +
      '<p class="cam-ps__note">Now: ' + sp.width + '×' + sp.height + ' · ' + sp.fps + ' fps · ' + Math.round(sp.bitrate / 1e6) + ' Mbps · ' + sp.container + (sp.codec ? ' ' + sp.codec : '') + '</p></div>';
    var lenses = cameras.length > 1 ? '<div class="cam-ps"><h3>Lens</h3><div class="cam-opts">' + cameras.map(function (x) {
      var on = x.deviceId === sp.deviceId;
      return '<button type="button" class="cam-opt' + (on ? ' is-on' : '') + '" data-lens="' + esc(x.deviceId) + '" aria-pressed="' + on + '"><b>' + esc(x.name) + '</b><small>' + esc(x.label) + '</small></button>';
    }).join('') + '</div></div>' : '';
    var pro = '';
    if (c.zoom && c.zoom.max > c.zoom.min) pro += rangeRow('zoom', 'Zoom', c.zoom, st.zoom || c.zoom.min, function (v) { return (+v).toFixed(1) + '×'; });
    if (c.exposureCompensation && c.exposureCompensation.max > c.exposureCompensation.min) pro += rangeRow('ev', 'Exposure', c.exposureCompensation, st.exposureCompensation || 0, function (v) { return (v > 0 ? '+' : '') + (+v).toFixed(1) + ' EV'; });
    if (c.whiteBalanceMode && c.whiteBalanceMode.length > 1) pro += chipRow('wb', 'White balance', c.whiteBalanceMode, st.whiteBalanceMode, { continuous: 'Auto', manual: 'Locked', 'single-shot': 'Once', none: 'Off' });
    if (c.focusMode && c.focusMode.length > 1) pro += chipRow('fm', 'Focus', c.focusMode, st.focusMode, { continuous: 'Auto', manual: 'Manual', 'single-shot': 'Tap', none: 'Fixed' });
    var proBlock = pro ? '<div class="cam-ps"><h3>Picture</h3>' + pro + '<p class="cam-ps__note">Tap the picture to focus there. Pinch to zoom.</p></div>' : '<div class="cam-ps"><h3>Picture</h3><p class="cam-ps__note">This browser doesn\'t offer manual zoom, exposure or white balance for this lens. Tap the picture to focus where supported.</p></div>';
    var shoot = '<div class="cam-ps"><h3>Shoot</h3>' +
      chipRow('orient', 'Orientation', ['landscape', 'portrait'], s.orientation, { landscape: 'Horizontal 16:9', portrait: 'Vertical 9:16' }) +
      chipRow('cd', 'Countdown', ['0', '3', '5', '10'], String(s.countdown), { 0: 'Off', 3: '3 s', 5: '5 s', 10: '10 s' }) +
      camToggle('voice', 'Voice countdown', s.voice) + camToggle('review', 'Review after each take', s.review) + camToggle('advance', 'Next scene after keeping', s.autoAdvance) +
      (gesturesAvailable() ? camToggle('gestures', 'Hand gestures', s.gestures) : '') +
      camToggle('grid', 'Rule-of-thirds grid', camPrefs.grid) + camToggle('guides', 'Safe-area guides', camPrefs.guides) + '</div>';
    var a = sp.audio;
    var snd = '<div class="cam-ps"><h3>Sound</h3><p class="cam-ps__note">' + (a ? 'Natural sound: no noise suppression, echo cancelling or auto gain. ' + (a.sampleRate ? Math.round(a.sampleRate / 1000) + ' kHz' : '') + (a.channels ? ' · ' + (a.channels >= 2 ? 'stereo' : 'mono') : '') + ' · 256 kbps' + (a.processed ? ' (this browser still processes the sound)' : '') : 'No microphone: takes are recorded without sound.') + '</p>' +
      '<p class="cam-ps__note">' + ic('shield', 13) + ' Recorded on this phone only. Nothing is uploaded.</p></div>';
    el.innerHTML = '<div class="cam-panel__head"><h2>Camera</h2><button type="button" class="cam-btn" data-act="panel-close" aria-label="Close settings">' + ic('x', 20) + '</button></div>' +
      '<div class="cam-panel__body">' + q + lenses + proBlock + shoot + snd + '</div>';
  }
  function rangeRow(id, label, r, v, fmt) {
    return '<div class="cam-range"><label for="cr-' + id + '">' + label + '</label><output id="cro-' + id + '">' + fmt(v) + '</output>' +
      '<input type="range" class="st-range" id="cr-' + id + '" data-range="' + id + '" min="' + r.min + '" max="' + r.max + '" step="' + (r.step || 0.1) + '" value="' + v + '"></div>';
  }
  function chipRow(id, label, values, cur, names) {
    return '<div class="cam-chiprow"><span class="cam-chiprow__l" id="cl-' + id + '">' + label + '</span><div class="cam-chips" role="group" aria-labelledby="cl-' + id + '">' + values.map(function (v) {
      return '<button type="button" class="cam-chip' + (String(v) === String(cur) ? ' is-on' : '') + '" data-chip="' + id + '" data-v="' + esc(v) + '" aria-pressed="' + (String(v) === String(cur)) + '">' + esc(names[v] || v) + '</button>';
    }).join('') + '</div></div>';
  }
  function camToggle(id, label, on) {
    return '<label class="cam-toggle"><span>' + esc(label) + '</span><input type="checkbox" role="switch" data-tog="' + id + '"' + (on ? ' checked' : '') + '><i></i></label>';
  }
  var rangeT = {};
  camUi.addEventListener('input', function (e) {
    var r = e.target.closest('[data-range]'); if (!r) return;
    var id = r.dataset.range, v = parseFloat(r.value);
    var o = $('#cro-' + id); if (o) o.textContent = id === 'zoom' ? v.toFixed(1) + '×' : (v > 0 ? '+' : '') + v.toFixed(1) + ' EV';
    clearTimeout(rangeT[id]);
    rangeT[id] = setTimeout(function () { if (id === 'zoom') Cam.setZoom(v).then(renderCamControls); else Cam.setExposureCompensation(v); }, 30);
  });
  camUi.addEventListener('change', async function (e) {
    var t = e.target.closest('[data-tog]'); if (!t) return;
    var id = t.dataset.tog, on = t.checked, p = S.project;
    p.settings = settingsOf(p);
    if (id === 'voice') p.settings.voice = on;
    else if (id === 'review') p.settings.review = on;
    else if (id === 'advance') p.settings.autoAdvance = on;
    else if (id === 'gestures') { p.settings.gestures = on; if (on) startGestures(); else stopGestures(); }
    else if (id === 'grid') { camPrefs.grid = on; saveCamPrefs(); camEl.classList.toggle('show-grid', on); var g = camUi.querySelector('[data-act="grid"]'); if (g) g.setAttribute('aria-pressed', on); }
    else if (id === 'guides') { camPrefs.guides = on; saveCamPrefs(); camEl.classList.toggle('show-guides', on); }
    if (/voice|review|advance|gestures/.test(id)) await saveProject();
    haptic('selection');
  });

  // ---------- shot list panel ----------
  function renderShots() {
    var el = $('#cam-shots'), p = S.project, cs = currentScene();
    var st = projectStats(p, S.takes);
    el.innerHTML = '<div class="cam-panel__head"><h2>Shot list <small>' + st.done + ' of ' + st.total + ' done</small></h2><button type="button" class="cam-btn" data-act="shots-close" aria-label="Close shot list">' + ic('x', 20) + '</button></div>' +
      '<div class="cam-panel__body"><ol class="cam-shotlist">' + p.scenes.map(function (sc, i) {
        var ts = takesOf(sc.id), best = bestTake(sc.id);
        return '<li><button type="button" class="cam-shot' + (cs && cs.id === sc.id ? ' is-cur' : '') + (best ? ' is-done' : '') + '" data-goscene="' + sc.id + '">' +
          '<span class="cam-shot__num">' + (best ? ic('check', 15) : i + 1) + '</span>' +
          '<span class="cam-shot__main"><b>' + esc(sc.name || 'Scene ' + (i + 1)) + '</b><small>Scene ' + (i + 1) + ' · ' + ts.length + (ts.length === 1 ? ' take' : ' takes') + (best ? ' · best: take ' + best.n : '') + '</small></span>' +
          (best && best.thumb ? '<img alt="" src="' + best.thumb + '">' : '') + '</button></li>';
      }).join('') + '</ol></div>';
  }

  function closePanels() { ['#cam-panel', '#cam-shots'].forEach(function (s) { var x = $(s); if (x) x.hidden = true; }); camEl.classList.remove('has-panel'); }
  function togglePanel(sel, render) {
    var x = $(sel), open = x.hidden;
    closePanels();
    if (open) { render(); x.hidden = false; camEl.classList.add('has-panel'); }
  }

  camEl.addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var act = b.dataset.act;
    if (b.dataset.lens) { await switchLens(b.dataset.lens); return; }
    if (b.dataset.zoom) { await Cam.setZoom(parseFloat(b.dataset.zoom)); haptic('selection'); renderCamControls(); return; }
    if (b.dataset.preset) {
      var hadSig = S.takes.length ? takeSig(S.takes[S.takes.length - 1]) : null;
      camPrefs.preset = b.dataset.preset; saveCamPrefs();
      await Cam.applyPreset(b.dataset.preset === 'max' ? 'max' : b.dataset.preset);
      await sleep(300); layoutFrame(); updateSpecs(); renderPanel(); refreshStorage(); haptic('selection');
      if (hadSig) { var sp2 = Cam.specs(); if (takeSig({ w: sp2.width, h: sp2.height, fps: sp2.fps, mimeType: sp2.mime }) !== hadSig) toast('Different from earlier takes: "One video" will need to re-encode. Keep one quality per project for a lossless join.'); }
      return;
    }
    if (b.dataset.chip) { await chip(b.dataset.chip, b.dataset.v); return; }
    if (b.dataset.goscene) { S.project.current = b.dataset.goscene; await saveProject(); renderScene(); closePanels(); haptic('selection'); return; }
    if (b.dataset.rv) { reviewAction(b.dataset.rv); return; }
    switch (act) {
      case 'close': leaveCamera(); break;
      case 'retry': camMsg(null); setState('starting'); try { await startStream(camPrefs.deviceId); requestWake(); startGuard(); startGestures(); setState('idle'); } catch (err) { camMsg('Couldn\'t start the camera', (err && err.message) || '', true); } break;
      case 'rec': onRecButton(); break;
      case 'torch': {
        var on = b.getAttribute('aria-pressed') !== 'true';
        if (await Cam.setTorch(on)) { b.setAttribute('aria-pressed', on); b.innerHTML = ic(on ? 'zap' : 'zapOff', 20); haptic('selection'); }
        break;
      }
      case 'grid': camPrefs.grid = !camPrefs.grid; saveCamPrefs(); camEl.classList.toggle('show-grid', camPrefs.grid); b.setAttribute('aria-pressed', camPrefs.grid); haptic('selection'); break;
      case 'settings': togglePanel('#cam-panel', renderPanel); break;
      case 'panel-close': case 'shots-close': closePanels(); break;
      case 'shots': togglePanel('#cam-shots', renderShots); break;
      case 'flip': await flipCamera(); break;
      case 'prev-scene': await gotoScene(-1); break;
      case 'next-scene': await gotoScene(1); break;
      case 'count-cancel': cancelCountdown(); break;
      case 'warn-switch': await chip('orient', settingsOf(S.project).orientation === 'landscape' ? 'portrait' : 'landscape'); toast('This project is now ' + (settingsOf(S.project).orientation === 'portrait' ? 'vertical 9:16' : 'horizontal 16:9')); break;
      case 'done-back': leaveCamera(); break;
      case 'done-stay': $('#cam-count').hidden = true; break;
    }
  });
  async function chip(id, v) {
    var p = S.project;
    if (id === 'wb') await Cam.setWhiteBalance(v);
    else if (id === 'fm') await Cam.setFocusMode(v);
    else if (id === 'orient') {
      p.settings = settingsOf(p); p.settings.orientation = v; await saveProject();
      camEl.dataset.orient = v; lockOrientation(v); checkOrientation(); layoutFrame();
    }
    else if (id === 'cd') { p.settings = settingsOf(p); p.settings.countdown = Number(v); await saveProject(); }
    haptic('selection');
    if (!$('#cam-panel').hidden) renderPanel();
  }
  async function switchLens(id) {
    if (/recording|stopping|countdown/.test(state())) return;
    camPrefs.deviceId = id; saveCamPrefs();
    setState('starting');
    try { await startStream(id); } catch (e) { toast('That lens couldn\'t start'); try { await startStream(null); } catch (e2) { /* ignore */ } }
    restartGestures();
    setState('idle'); haptic('selection');
    if (!$('#cam-panel').hidden) renderPanel();
    refreshStorage();
  }
  async function flipCamera() {
    var sp = Cam.specs(), cur = cameras.find(function (c) { return c.deviceId === sp.deviceId; });
    var target;
    if (cur && cur.kind === 'front') target = Cam.defaultCameraId(cameras.filter(function (c) { return c.kind !== 'front'; }));
    else target = (cameras.find(function (c) { return c.kind === 'front'; }) || {}).deviceId;
    if (!target) { var i = cameras.indexOf(cur); target = cameras[(i + 1) % cameras.length] && cameras[(i + 1) % cameras.length].deviceId; }
    if (target) await switchLens(target);
    camEl.classList.toggle('is-front', !!(cameras.find(function (c) { return c.deviceId === target; }) || {}).kind && (cameras.find(function (c) { return c.deviceId === target; }).kind === 'front'));
  }
  async function gotoScene(d) {
    var p = S.project, cs = currentScene(); if (!cs) return;
    var i = sceneIndex(p, cs.id) + d;
    if (i < 0 || i >= p.scenes.length) return;
    p.current = p.scenes[i].id; await saveProject(); renderScene(); renderSceneNavState(); haptic('selection');
  }

  // Keep the grid, guides and focus ring on the actual picture (the video is letterboxed with object-fit: contain).
  function layoutFrame() {
    var vw = video.videoWidth, vh = video.videoHeight, W = stage.clientWidth, H = stage.clientHeight;
    if (!vw || !vh || !W || !H) { frame.style.cssText = 'left:0;top:0;width:100%;height:100%'; return; }
    var k = Math.min(W / vw, H / vh), fw = vw * k, fh = vh * k;
    frame.style.cssText = 'left:' + ((W - fw) / 2) + 'px;top:' + ((H - fh) / 2) + 'px;width:' + fw + 'px;height:' + fh + 'px';
    frame.dataset.o = vh > vw ? 'portrait' : 'landscape';
  }
  video.addEventListener('resize', function () { layoutFrame(); updateSpecs(); });
  window.addEventListener('resize', function () { if (camOpen) { layoutFrame(); checkOrientation(); } });

  // ---------- tap to focus + pinch to zoom ----------
  var ptrs = new Map(), pinch = null, tapStart = null;
  stage.addEventListener('pointerdown', function (e) {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
    if (ptrs.size === 2) {
      var c = Cam.caps(); tapStart = null;
      if (c.zoom) { var a = Array.from(ptrs.values()); pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), z: Cam.settings().zoom || 1, min: c.zoom.min, max: c.zoom.max, raf: 0 }; }
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      var a = Array.from(ptrs.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      var z = Math.max(pinch.min, Math.min(pinch.max, pinch.z * d / pinch.d));
      if (!pinch.raf) pinch.raf = requestAnimationFrame(function () { if (pinch) { pinch.raf = 0; Cam.setZoom(z); } });
    }
  });
  function ptrEnd(e) {
    ptrs.delete(e.pointerId);
    if (pinch && ptrs.size < 2) { pinch = null; setTimeout(renderCamControls, 150); }
    if (tapStart && ptrs.size === 0 && e.type === 'pointerup' && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 12 && Date.now() - tapStart.t < 500) focusTap(e.clientX, e.clientY);
    if (ptrs.size === 0) tapStart = null;
  }
  stage.addEventListener('pointerup', ptrEnd);
  stage.addEventListener('pointercancel', ptrEnd);
  function focusTap(x, y) {
    if (camEl.classList.contains('has-panel')) { closePanels(); return; }
    var r = frame.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    var nx = (x - r.left) / r.width, ny = (y - r.top) / r.height;
    var f = $('#cam-focus');
    f.style.left = (x - r.left) + 'px'; f.style.top = (y - r.top) + 'px';
    f.classList.remove('is-on'); void f.offsetWidth; f.classList.add('is-on');
    Cam.focusAt(nx, ny);
    haptic('selection');
  }

  // ---------- audio level meter ----------
  function startMeter(stream) {
    stopMeter();
    ensureAudioCtx();
    if (!audio || !stream.getAudioTracks().length) { var m = $('#cam-meter'); if (m) m.classList.add('is-off'); return; }
    try {
      var src = audio.ctx.createMediaStreamSource(stream);
      var split = audio.ctx.createChannelSplitter(2);
      var aL = audio.ctx.createAnalyser(), aR = audio.ctx.createAnalyser();
      aL.fftSize = aR.fftSize = 512;
      src.connect(split); split.connect(aL, 0); split.connect(aR, 1);
      audio.src = src; audio.aL = aL; audio.aR = aR;
      var buf = new Float32Array(aL.fftSize), pk = [0, 0];
      var bl = $('#m-l'), br = $('#m-r');
      var level = function (an) { an.getFloatTimeDomainData(buf); var m = 0; for (var i = 0; i < buf.length; i++) { var v = Math.abs(buf[i]); if (v > m) m = v; } return m; };
      var tick = function () {
        meterRaf = requestAnimationFrame(tick);
        var l = level(aL), r = level(aR);
        // Mono mics send channel 0 only: mirror it.
        if (r === 0 && l > 0) r = l;
        pk[0] = Math.max(l, pk[0] * 0.92); pk[1] = Math.max(r, pk[1] * 0.92);
        var toPct = function (v) { var db = 20 * Math.log10(Math.max(v, 1e-5)); return Math.max(0, Math.min(100, (db + 60) / 60 * 100)); };
        if (bl) { bl.style.width = toPct(pk[0]) + '%'; bl.parentNode.classList.toggle('is-clip', pk[0] > 0.98); }
        if (br) { br.style.width = toPct(pk[1]) + '%'; br.parentNode.classList.toggle('is-clip', pk[1] > 0.98); }
      };
      tick();
    } catch (e) { /* meter is optional */ }
  }
  function stopMeter() {
    cancelAnimationFrame(meterRaf); meterRaf = 0;
    if (audio && audio.src) { try { audio.src.disconnect(); } catch (e) { /* ignore */ } audio.src = null; }
  }
  function beep(freq, dur) {
    ensureAudioCtx();
    return new Promise(function (resolve) {
      if (!audio) { setTimeout(resolve, dur * 1000); return; }
      try {
        var o = audio.ctx.createOscillator(), g = audio.ctx.createGain(), t = audio.ctx.currentTime;
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(audio.ctx.destination);
        o.start(t); o.stop(t + dur + 0.02);
        o.onended = function () { resolve(); };
        setTimeout(resolve, dur * 1000 + 200);
      } catch (e) { resolve(); }
    });
  }

  // ---------- wake lock ----------
  async function requestWake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', function () { wakeLock = null; }); } } catch (e) { wakeLock = null; }
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
  document.addEventListener('visibilitychange', function () {
    if (!camOpen) return;
    if (document.visibilityState === 'hidden') {
      // The phone is locked or the app switched: save the take rather than record a black screen.
      if (state() === 'recording') stopTake();
      else if (state() === 'countdown') cancelCountdown();
    } else {
      requestWake();
      var tr = Cam.track();
      if (!tr || tr.readyState === 'ended') { setState('starting'); startStream(camPrefs.deviceId).then(function () { setState('idle'); restartGestures(); }).catch(function () { camMsg('The camera stopped', 'Tap Try again to restart it.', true); }); }
    }
  });

  // ---------- speech ----------
  var voicesCache = null;
  function pickVoice(lang) {
    try {
      var vs = voicesCache && voicesCache.length ? voicesCache : (voicesCache = speechSynthesis.getVoices());
      var l = lang.toLowerCase();
      return vs.find(function (v) { return v.lang && v.lang.toLowerCase() === l && v.localService; }) || vs.find(function (v) { return v.lang && v.lang.toLowerCase() === l; }) ||
        vs.find(function (v) { return v.lang && v.lang.toLowerCase().slice(0, 2) === l.slice(0, 2); }) || null;
    } catch (e) { return null; }
  }
  try { if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', function () { voicesCache = speechSynthesis.getVoices(); }); } catch (e) { /* ignore */ }
  // Resolves when the utterance has finished (its 'end' event), or after a safety timeout (then speech is cancelled
  // so it can't overlap the recording).
  function speak(text, lang) {
    return new Promise(function (resolve) {
      var ss = window.speechSynthesis;
      if (!ss || !window.SpeechSynthesisUtterance) { resolve(false); return; }
      var done = false, u;
      var finish = function (ok) { if (done) return; done = true; clearTimeout(to); resolve(ok); };
      try {
        u = new SpeechSynthesisUtterance(text);
        u.lang = lang || 'en-US';
        var v = pickVoice(u.lang); if (v) u.voice = v;
        u.rate = 1.05; u.pitch = 1; u.volume = 1;
        u.onend = function () { finish(true); };
        u.onerror = function () { finish(false); };
        ss.speak(u);
      } catch (e) { resolve(false); return; }
      var to = setTimeout(function () { try { ss.cancel(); } catch (e) { /* ignore */ } finish(false); }, 1800 + text.length * 140);
    });
  }

  // ---------- recording flow ----------
  function onRecButton() {
    var s = state();
    if (s === 'idle') startTake();
    else if (s === 'countdown') cancelCountdown();
    else if (s === 'recording') stopTake();
  }
  async function startTake() {
    if (state() !== 'idle' || !camOpen) return;
    var p = S.project, s = settingsOf(p), sc = currentScene(); if (!sc) return;
    if (guard.wrong) { pulseWarning(); return; }
    if (S.est && S.est.quota && S.est.free < 200e6) { toast('The phone is almost full. Delete some takes first.'); haptic('warning'); return; }
    closePanels();
    var i = sceneIndex(p, sc.id), n = (sc.takeCounter || 0) + 1, L = langOf(s.voiceLang);
    var tok = countdownTok = { cancelled: false };
    var cd = $('#cam-count');
    setState('countdown');
    if (s.countdown > 0) {
      cd.hidden = false;
      var show = function (big, small) {
        cd.innerHTML = '<div class="cam-count__slate"><em><b>SCENE ' + (i + 1) + '</b> · TAKE ' + n + '</em>' + (sc.name ? '<span>' + esc(sc.name) + '</span>' : '') + '</div>' +
          '<div class="cam-count__n" data-len="' + String(big).length + '">' + esc(big) + '</div>' + (small ? '<div class="cam-count__sub">' + esc(small) + '</div>' : '') +
          '<button type="button" class="cam-pill cam-count__cancel" data-act="count-cancel">Cancel</button>';
      };
      show('', 'Get ready');
      if (s.voice) await speak(L.scene.replace('{s}', i + 1).replace('{t}', n), s.voiceLang);
      if (tok.cancelled) return;
      for (var k = s.countdown; k >= 1; k--) {
        show(k);
        haptic('medium');
        var tick = sleep(1000);
        if (s.voice) await Promise.all([tick, speak(String(k), s.voiceLang)]);
        else { beep(880, 0.12); await tick; }
        if (tok.cancelled) return;
      }
      show(L.action.replace(/[!¡]/g, '').trim().toUpperCase());
      haptic('heavy');
      if (s.voice) await speak(L.action, s.voiceLang); else await beep(1320, 0.35);
      if (tok.cancelled) return;
      // Leave a moment of silence so the end of the voice never lands in the take.
      await sleep(250);
      if (tok.cancelled) return;
    } else {
      await sleep(120);
    }
    cd.hidden = true;
    if (tok.cancelled || !camOpen) return;
    if (guard.wrong) { setState('idle'); pulseWarning(); return; }
    beginRecording(sc, n);
  }
  function cancelCountdown() {
    if (countdownTok) countdownTok.cancelled = true;
    countdownTok = null;
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    var cd = $('#cam-count'); if (cd) cd.hidden = true;
    if (state() === 'countdown') { setState('idle'); haptic('selection'); }
  }
  function beginRecording(sc, n) {
    var p = S.project, id = uid();
    var mime = Cam.pickMime(), ext = /webm/.test(mime) ? 'webm' : 'mp4';
    var writer = Store.createClipWriter(p.id, id, ext);
    var sp = Cam.specs();
    rec = { id: id, sceneId: sc.id, n: n, writer: writer, t0: 0, ext: ext, specs: sp, flags: { orientation: guard.wrong }, thumb: null, timer: 0, stopP: null, stopResolve: null };
    rec.stopP = new Promise(function (r) { rec.stopResolve = r; });
    var r0 = rec;
    try {
      var info = Cam.startRecorder({
        onChunk: function (b) { r0.writer.write(b); },
        onStop: function () { finishTake(r0); },
        onError: function (err) { console.warn('[studio] recorder error', err); toast('Recording error: ' + ((err && err.message) || err)); }
      });
      rec.mimeType = info.mimeType; rec.bitrate = info.bitrate;
      if (/webm/.test(info.mimeType)) rec.ext = 'webm';
    } catch (e) {
      console.warn('[studio] could not start recorder', e);
      writer.abort(); rec = null; setState('idle'); toast('Couldn\'t start recording: ' + (e.message || e)); return;
    }
    rec.t0 = performance.now();
    setState('recording');
    haptic('heavy');
    renderScene();
    var tm = $('#cam-timer'); tm.hidden = false;
    var timeEl = $('#cam-time');
    rec.timer = setInterval(function () { if (rec) timeEl.textContent = fmtClock(performance.now() - rec.t0); }, 250);
    timeEl.textContent = '00:00:00';
    setTimeout(function () { if (rec === r0) r0.thumb = grabThumb(); }, 700);
  }
  function grabThumb() {
    try {
      var vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
      var k = 360 / Math.max(vw, vh), c = document.createElement('canvas');
      c.width = Math.round(vw * k); c.height = Math.round(vh * k);
      var g = c.getContext('2d');
      if (camEl.classList.contains('is-front')) { g.translate(c.width, 0); g.scale(-1, 1); }
      g.drawImage(video, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    } catch (e) { return null; }
  }
  function stopTake() {
    if (!rec || state() !== 'recording') return rec ? rec.stopP : Promise.resolve();
    rec.duration = (performance.now() - rec.t0) / 1000;
    if (!rec.thumb) rec.thumb = grabThumb();
    setState('stopping');
    clearInterval(rec.timer);
    var r0 = rec;
    if (!Cam.stopRecorder()) finishTake(r0);
    return r0.stopP;
  }
  // Runs after MediaRecorder's 'stop' event: every chunk is in, the file gets closed, the take is filed.
  async function finishTake(r0) {
    if (r0.finished) return; r0.finished = true;
    var p = S.project, s = settingsOf(p), L = langOf(s.voiceLang);
    var tm = $('#cam-timer'); if (tm) tm.hidden = true;
    var sc = sceneById(p, r0.sceneId);
    var take = null;
    try {
      var res = await r0.writer.close();
      if (!res.size) throw new Error('empty recording');
      if (sc) sc.takeCounter = Math.max(sc.takeCounter || 0, r0.n);
      take = {
        id: r0.id, projectId: p.id, sceneId: r0.sceneId, n: r0.n, created: Date.now(),
        duration: r0.duration || (performance.now() - r0.t0) / 1000, size: res.size, storage: res.storage, file: res.file,
        mimeType: r0.mimeType, ext: r0.ext, thumb: r0.thumb,
        w: r0.specs.width, h: r0.specs.height, fps: r0.specs.fps, bitrate: r0.bitrate,
        status: 'new', starred: false, flags: r0.flags
      };
      await Store.putTake(take);
      await saveProject();
      S.takes.push(take);
    } catch (e) {
      console.warn('[studio] saving take failed', e);
      toast('That take couldn\'t be saved' + (e && e.name === 'QuotaExceededError' ? ': the phone is full' : ''));
    }
    rec = null;
    r0.stopResolve(take);
    // Only now, with the recorder stopped and the file closed, call "Cut!" so it can never end up in the take.
    if (camOpen) { if (s.voice) speak(L.cut, s.voiceLang); else beep(660, 0.18); }
    haptic('success');
    refreshStorage();
    if (!camOpen) return;
    if (!take) { setState('idle'); renderScene(); return; }
    if (s.review && document.visibilityState !== 'hidden') openReview(take);
    else { await keepTake(take, s.autoAdvance); setState('idle'); }
    renderScene();
  }

  // ---------- review ----------
  async function openReview(take) {
    reviewTake = take;
    setState('review');
    var el = $('#cam-review'), p = S.project, i = sceneIndex(p, take.sceneId), sc = sceneById(p, take.sceneId);
    var g = settingsOf(p).gestures && gesturesAvailable();
    var isLast = i >= p.scenes.length - 1;
    el.innerHTML = '<div class="cam-review__top"><div class="cam-review__title"><b>Scene ' + (i + 1) + ' · Take ' + take.n + '</b><span>' + esc(sc && sc.name ? sc.name : '') + '</span></div>' +
      '<span class="cam-review__meta">' + fmtDur(take.duration) + ' · ' + fmtBytes(take.size) + (take.flags && take.flags.orientation ? ' · <span class="cam-review__flag">' + ic('alert', 13) + ' held the wrong way</span>' : '') + '</span></div>' +
      '<div class="cam-review__stage"><video id="rv-video" playsinline preload="auto"></video><button type="button" class="cam-review__pp" id="rv-pp" aria-label="Pause">' + ic('pause', 28) + '</button></div>' +
      '<div class="cam-review__bar"><span id="rv-t">0:00</span><input type="range" class="st-range" id="rv-seek" min="0" max="1000" value="0" aria-label="Scrub through the take"><span id="rv-d">' + fmtDur(take.duration) + '</span>' +
      '<button type="button" class="cam-btn cam-btn--sm" data-rv="replay" aria-label="Replay from the start">' + ic('replay', 18) + '</button></div>' +
      '<div class="cam-review__actions">' +
        '<button type="button" class="cam-rvbtn cam-rvbtn--retake" data-rv="retake">' + ic('thumbDown', 22) + '<span>Retake</span>' + (g ? '<small>thumbs down</small>' : '') + '</button>' +
        '<button type="button" class="cam-rvbtn cam-rvbtn--keep" data-rv="keep">' + ic('thumbUp', 24) + '<span>Keep</span>' + (g ? '<small>thumbs up</small>' : '') + '</button>' +
        '<button type="button" class="cam-rvbtn cam-rvbtn--next" data-rv="next"' + (isLast ? '' : '') + '>' + ic('next', 22) + '<span>' + (isLast ? 'Keep & finish' : 'Next scene') + '</span>' + (g ? '<small>victory sign</small>' : '<small>keeps this take</small>') + '</button>' +
      '</div>';
    el.hidden = false;
    var v = $('#rv-video');
    var dur = function () { return isFinite(v.duration) && v.duration > 0 ? v.duration : take.duration; };
    v.addEventListener('timeupdate', function () { var t = $('#rv-t'), sk = $('#rv-seek'); if (!t || !sk) return; t.textContent = fmtDur(v.currentTime); var d = dur(); if (d) sk.value = Math.round(v.currentTime / d * 1000); });
    v.addEventListener('play', function () { setPP('#rv-pp', true, 28); el.classList.remove('is-paused'); });
    v.addEventListener('pause', function () { setPP('#rv-pp', false, 28); el.classList.add('is-paused'); });
    v.addEventListener('ended', function () { el.classList.add('is-paused'); });
    $('#rv-seek').addEventListener('input', function (e) { v.currentTime = e.target.value / 1000 * dur(); });
    $('#rv-pp').onclick = function () { if (v.paused) { v.muted = false; v.play(); } else v.pause(); };
    var blob = await Store.getClip(take);
    if (reviewTake !== take) return;
    if (!blob) { toast('Couldn\'t load the take'); return; }
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    reviewUrl = URL.createObjectURL(blob);
    v.src = reviewUrl;
    try { await v.play(); } catch (e) { v.muted = true; try { await v.play(); } catch (e2) { /* tap to play */ } }
  }
  function closeReview(silent) {
    var el = $('#cam-review'); if (!el) return;
    var v = $('#rv-video'); if (v) { v.pause(); v.removeAttribute('src'); try { v.load(); } catch (e) { /* ignore */ } }
    if (reviewUrl) { URL.revokeObjectURL(reviewUrl); reviewUrl = null; }
    el.hidden = true; el.innerHTML = '';
    reviewTake = null;
    if (!silent && state() === 'review') setState('idle');
  }
  async function reviewAction(a) {
    var t = reviewTake; if (!t) return;
    var s = settingsOf(S.project);
    if (a === 'replay') { var v = $('#rv-video'); if (v) { v.currentTime = 0; v.muted = false; v.play().catch(function () {}); } return; }
    // Stay busy (record button disabled) until the decision is saved and the scene has moved on.
    closeReview(true);
    setState('stopping');
    if (a === 'keep') await keepTake(t, s.autoAdvance);
    else if (a === 'next') await keepTake(t, true);
    else if (a === 'retake') {
      t.status = 'retake'; t.starred = false; await Store.putTake(t);
      haptic('warning');
      toast('Take ' + t.n + ' set aside. Ready for take ' + (t.n + 1), { label: 'Undo', run: function () { if (state() === 'idle') { t.status = 'new'; Store.putTake(t); openReview(t); } } });
    }
    setState('idle');
    renderScene();
  }
  async function keepTake(t, advance) {
    t.status = 'kept';
    var others = takesOf(t.sceneId).filter(function (x) { return x.id !== t.id; });
    var first = !others.some(function (x) { return x.starred; });
    if (first) t.starred = true;
    await Store.putTake(t);
    haptic('success');
    var msg = 'Take ' + t.n + ' kept' + (first ? ' as the best take' : '');
    if (advance) {
      var moved = await advanceScene(t.sceneId);
      if (moved === 'done') return;
      if (moved) msg += ' · on to scene ' + (sceneIndex(S.project, S.project.current) + 1);
    }
    toast(msg);
  }
  // Move to the next scene in the line-up; past the end, go to the first scene that still has no kept take.
  async function advanceScene(fromId) {
    var p = S.project, i = sceneIndex(p, fromId);
    var next = p.scenes[i + 1];
    if (!next) next = p.scenes.find(function (sc) { return !sceneDone(sc.id); });
    if (!next) { allDone(); return 'done'; }
    if (next.id === p.current) return false;
    p.current = next.id; await saveProject();
    renderScene();
    return true;
  }
  function allDone() {
    var cd = $('#cam-count'), st = projectStats(S.project, S.takes);
    cd.hidden = false;
    cd.innerHTML = '<div class="cam-done"><span class="cam-done__ic">' + ic('check', 34) + '</span><h2>That\'s a wrap</h2><p>All ' + st.total + ' scenes have a kept take.</p>' +
      '<div class="cam-msg__btns"><button type="button" class="cam-pill cam-pill--light" data-act="done-back">See the takes</button><button type="button" class="cam-pill" data-act="done-stay">Keep shooting</button></div></div>';
    haptic('success');
    speakIfVoice('That\'s a wrap!');
  }
  function speakIfVoice(t) { var s = settingsOf(S.project); if (s.voice && /^en/.test(s.voiceLang)) speak(t, s.voiceLang); }

  // ---------- keyboard + Bluetooth shutter remotes ----------
  document.addEventListener('keydown', function (e) {
    if (!camOpen) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    var k = e.key;
    if (k === 'Escape') { if (camEl.classList.contains('has-panel')) closePanels(); else if (state() === 'countdown') cancelCountdown(); return; }
    if (state() === 'review') {
      if (k === 'Enter' || k === 'k') { e.preventDefault(); reviewAction('keep'); }
      else if (k === 'r' || k === 'Backspace') { e.preventDefault(); reviewAction('retake'); }
      else if (k === 'n' || k === 'ArrowRight') { e.preventDefault(); reviewAction('next'); }
      return;
    }
    if (k === ' ' || k === 'Enter' || k === 'AudioVolumeUp' || k === 'VolumeUp' || k === 'Camera') {
      if (e.target && e.target.closest && e.target.closest('button') && e.target.closest('button') !== $('#cam-rec') && k !== 'AudioVolumeUp') return;
      e.preventDefault(); onRecButton();
    }
  });

  // ============================================================================================
  // ORIENTATION GUARD
  // ============================================================================================
  function screenOrientation() {
    try { if (window.matchMedia) return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'; } catch (e) { /* ignore */ }
    try { if (screen.orientation && screen.orientation.type) return /portrait/.test(screen.orientation.type) ? 'portrait' : 'landscape'; } catch (e) { /* ignore */ }
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
  }
  // How the phone is physically held. The motion sensor wins when it has a clear reading (it still works when the
  // screen is locked to one orientation); lying flat it says nothing, so fall back to the screen.
  function physicalOrientation() {
    var s = guard.sensor;
    if (s && Date.now() - s.t < 2000 && s.o !== 'flat') return s.o;
    return screenOrientation();
  }
  function onDeviceOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    var b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
    var gx = Math.cos(b) * Math.sin(g), gy = Math.sin(b), gz = Math.cos(b) * Math.cos(g);
    var o = Math.abs(gz) > 0.85 ? 'flat' : Math.abs(gy) > Math.abs(gx) * 1.15 ? 'portrait' : Math.abs(gx) > Math.abs(gy) * 1.15 ? 'landscape' : (guard.sensor ? guard.sensor.o : 'flat');
    var prev = guard.sensor && guard.sensor.o;
    guard.sensor = { t: Date.now(), o: o, side: gx >= 0 ? 1 : -1 };
    if (o !== prev) checkOrientation();
  }
  function onScreenChange() { setTimeout(function () { checkOrientation(); layoutFrame(); }, 60); }
  function startGuard() {
    window.addEventListener('deviceorientation', onDeviceOrientation);
    window.addEventListener('orientationchange', onScreenChange);
    try { if (screen.orientation) screen.orientation.addEventListener('change', onScreenChange); } catch (e) { /* ignore */ }
    try { guard.mq = window.matchMedia('(orientation: portrait)'); guard.mq.addEventListener('change', onScreenChange); } catch (e) { /* ignore */ }
    clearInterval(guard.poll); guard.poll = setInterval(checkOrientation, 1000);
    checkOrientation();
  }
  function stopGuard() {
    window.removeEventListener('deviceorientation', onDeviceOrientation);
    window.removeEventListener('orientationchange', onScreenChange);
    try { if (screen.orientation) screen.orientation.removeEventListener('change', onScreenChange); } catch (e) { /* ignore */ }
    try { if (guard.mq) guard.mq.removeEventListener('change', onScreenChange); } catch (e) { /* ignore */ }
    clearInterval(guard.poll);
    showWarning(false);
  }
  function checkOrientation() {
    if (!camOpen || !S.project) return;
    var want = settingsOf(S.project).orientation, have = physicalOrientation();
    var active = /idle|countdown|recording|stopping|starting/.test(state());
    var wrong = active && have !== want;
    if (wrong !== guard.wrong) showWarning(wrong);
  }
  function showWarning(on) {
    guard.wrong = on;
    var el = $('#cam-warn'); if (!el) return;
    clearInterval(guard.timer); guard.timer = null;
    if (!on) {
      el.hidden = true; el.innerHTML = '';
      try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { /* ignore */ }
      camEl.classList.remove('is-wrong');
      return;
    }
    var want = settingsOf(S.project).orientation;
    if (state() === 'countdown') cancelCountdown();
    if (rec && state() === 'recording') rec.flags.orientation = true;
    // When the screen is locked one way and the phone is held the other, turn the message so it reads upright.
    var turn = guard.sensor && screenOrientation() !== physicalOrientation() ? (guard.sensor.side > 0 ? -90 : 90) : 0;
    el.innerHTML = '<div class="cam-warn__box" style="--turn:' + turn + 'deg">' +
      '<div class="cam-warn__phone" data-want="' + want + '">' + ic('phone', 120) + '<span class="cam-warn__arrow">' + ic('rotate', 54) + '</span></div>' +
      '<h2 class="cam-warn__title">' + (want === 'landscape' ? 'TURN YOUR PHONE SIDEWAYS' : 'HOLD IT UPRIGHT') + '</h2>' +
      '<p class="cam-warn__sub">This project is ' + (want === 'landscape' ? 'Horizontal 16:9' : 'Vertical 9:16') + '. ' +
      (rec && state() === 'recording' ? '<b>Still recording. This take is flagged.</b>' : 'You can\'t start a take until it\'s the right way round.') + '</p>' +
      (rec ? '' : '<div class="cam-warn__btns"><button type="button" class="cam-warn__btn" data-act="warn-switch">Shoot ' + (want === 'landscape' ? 'vertical 9:16' : 'horizontal 16:9') + ' instead</button>' +
        '<button type="button" class="cam-warn__btn" data-act="close">Close camera</button></div>') + '</div>';
    el.hidden = false;
    camEl.classList.add('is-wrong');
    buzz();
    guard.timer = setInterval(buzz, 1400);
  }
  function buzz() {
    // Never vibrate during a take: the microphone would pick up the motor buzz (like the countdown voice,
    // nothing may cut into a recording). Mid-take the warning stays visual and the take is flagged.
    if (state() === 'recording') return;
    var ok = false, pat = [400, 120, 400, 120, 250];
    try {
      var H = window.ChowaniecHaptics;
      if (H && H.buzz) ok = H.buzz(pat, { always: true });
      if (!ok && navigator.vibrate) ok = navigator.vibrate(pat);
    } catch (e) { /* ignore */ }
    if (!ok) haptic('warning');
  }
  function pulseWarning() {
    var el = $('#cam-warn'); if (!el) return;
    el.classList.remove('is-shake'); void el.offsetWidth; el.classList.add('is-shake');
    buzz();
  }

  // ============================================================================================
  // GESTURES
  // ============================================================================================
  var gest = { on: false, hideT: 0 };
  var G_LABEL = { open_palm: 'Open palm · action', closed_fist: 'Fist · cut', thumbs_up: 'Thumbs up · keep', thumbs_down: 'Thumbs down · retake', victory: 'Victory · next scene', pointing_up: 'Point up · replay' };
  var G_ICON = { open_palm: 'hand', closed_fist: 'fist', thumbs_up: 'thumbUp', thumbs_down: 'thumbDown', victory: 'victory', pointing_up: 'pointUp' };
  async function startGestures() {
    var G = window.StudioGestures, s = settingsOf(S.project), chip = $('#cam-gest');
    if (!s.gestures || !G || gest.on) { if (chip && !gest.on) chip.hidden = true; return; }
    try {
      var ok = G.supported ? await G.supported() : true;
      if (!ok) { if (chip) chip.hidden = true; toast('Hand gestures aren\'t supported on this device'); return; }
      gest.on = true;
      if (chip) { chip.hidden = false; chip.classList.add('is-loading'); $('#cam-gest-t').textContent = 'Loading gestures…'; }
      // The module reports 'loading' (first use downloads the hand model) / 'ready' / 'error'.
      G.onStatus = function (st) {
        var c = $('#cam-gest'), t = $('#cam-gest-t'); if (!c || !t || !gest.on) return;
        c.classList.toggle('is-loading', st === 'loading');
        if (st === 'loading') t.textContent = 'Loading gestures…';
        else if (st === 'ready') t.textContent = 'Gestures on';
        else if (st === 'error') { gest.on = false; c.hidden = true; toast('Hand gestures couldn\'t start'); }
      };
      if (G.setPaused) G.setPaused(false);   // paused state is global in the module and survives stop()/start()
      await G.start(video, { onGesture: onGesture, fps: 15 });
      if (chip && gest.on && (!G.isRunning || G.isRunning())) { chip.classList.remove('is-loading'); $('#cam-gest-t').textContent = 'Gestures on'; }
    } catch (e) {
      gest.on = false; console.warn('[studio] gestures', e);
      if (chip) chip.hidden = true;
      toast('Hand gestures couldn\'t start');
    }
  }
  function stopGestures() {
    var G = window.StudioGestures;
    if (gest.on && G) { try { G.stop(); } catch (e) { /* ignore */ } }
    gest.on = false;
    var chip = $('#cam-gest'); if (chip) chip.hidden = true;
  }
  function restartGestures() { if (gest.on) { stopGestures(); startGestures(); } }
  function onGesture(name, conf) {
    if (!camOpen) return;
    var chip = $('#cam-gest');
    if (chip) {
      chip.innerHTML = ic(G_ICON[name] || 'hand', 15) + '<span id="cam-gest-t">' + esc(G_LABEL[name] || name) + '</span>';
      chip.classList.remove('is-hit'); void chip.offsetWidth; chip.classList.add('is-hit');
      clearTimeout(gest.hideT);
      gest.hideT = setTimeout(function () { chip.classList.remove('is-hit'); chip.innerHTML = ic('hand', 15) + '<span id="cam-gest-t">Gestures on</span>'; }, 1600);
    }
    if (guard.wrong) { if (name === 'closed_fist' && state() === 'recording') stopTake(); return; }
    var s = state();
    if (s === 'idle') {
      if (name === 'open_palm') startTake();
      else if (name === 'victory') gotoScene(1);
      else if (name === 'pointing_up') {
        var cs = currentScene(), last = cs && takesOf(cs.id).pop();
        if (!last) last = S.takes.slice().sort(function (a, b) { return b.created - a.created; })[0];
        if (last) openReview(last);
      }
    } else if (s === 'countdown') {
      if (name === 'closed_fist') cancelCountdown();
    } else if (s === 'recording') {
      if (name === 'closed_fist') stopTake();
    } else if (s === 'review') {
      if (name === 'thumbs_up') reviewAction('keep');
      else if (name === 'thumbs_down') reviewAction('retake');
      else if (name === 'victory') reviewAction('next');
      else if (name === 'pointing_up') reviewAction('replay');
    }
  }

  // ============================================================================================
  // BOOT
  // ============================================================================================
  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', function () { if (camOpen && state() === 'recording') stopTake(); });
  Store.ready().then(route).catch(function (e) {
    main.innerHTML = '<div class="ch-empty"><div class="ch-empty__icon">' + ic('alert', 26) + '</div><div class="ch-empty__title">Storage isn\'t available</div><p>This browser blocked on-device storage (private mode?). Studio needs it to save takes.</p></div>';
    console.warn('[studio] storage', e);
  });
  // For tests and debugging.
  window.ChowaniecStudio = { state: state, route: route, get project() { return S.project; }, get takes() { return S.takes; }, onGesture: onGesture, checkOrientation: checkOrientation, physicalOrientation: physicalOrientation };
})();
