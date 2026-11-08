// Note Uploader: Liliana, Amelia and Emilia send meeting notes (text, photos, to-dos) to Gabriel, Vicky and Nicole.
// Uploaders: "Send notes" + "Sent" (live: seen by / reviewed by / replies). Heads: "Inbox" (live, every 15 s) + "Send notes".
// API: /.netlify/functions/uploads (roles are enforced there, see netlify/lib/uploads-store.mjs).
(function () {
  'use strict';
  var API = '/.netlify/functions/uploads';
  var MAX_PHOTOS = 8, MAX_SIDE = 1600, MAX_BYTES = 1.45 * 1024 * 1024, POLL_MS = 15000;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var nice = function (n) { return n === 'Victoria' ? 'Vicky' : n; };
  var listNames = function (names) { names = names.map(nice); return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; };

  // ---------- icons (lucide-style) ----------
  var P = {
    lock: '<rect x="3" y="11" width="18" height="11" rx="2.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2.5"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2.5"/>',
    pen: '<path d="M12 20h9"/><path d="M16.38 3.62a2.12 2.12 0 1 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86z"/>',
    heading: '<path d="M6 12h12M6 20V4M18 20V4"/>',
    bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
    list: '<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>',
    checklist: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
    sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.02l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.02.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.93"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    reply: '<path d="M20 18v-2a4 4 0 0 0-4-4H4"/><path d="m9 17-5-5 5-5"/>',
    trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    notes: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'
  };
  function icon(name, size) {
    size = size || 18;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[name] || '') + '</svg>';
  }
  function paintIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      if (el.firstChild && el.firstChild.nodeName === 'svg') return;
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, el.classList.contains('ch-empty__icon') ? 26 : el.classList.contains('up-done__tick') ? 34 : el.closest('.up-viewer') ? 22 : 18));
    });
  }
  var COLORS = ['#e11d48', '#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#475569'];
  function colorFor(name) {
    if (window.ChowaniecUI && window.ChowaniecUI.colorFor) return window.ChowaniecUI.colorFor(name);
    var h = 0; name = String(name || ''); for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length];
  }
  function avatar(name, size) {
    return '<span class="ch-avatar' + (size ? ' ch-avatar--' + size : '') + '" style="--_c:' + colorFor(name) + '" aria-hidden="true">' + esc(String(name || '?').charAt(0)) + '</span>';
  }

  // ---------- helpers ----------
  function me() { try { return window.getChowaniecUser ? window.getChowaniecUser() : JSON.parse(sessionStorage.getItem('chowaniec_user') || 'null'); } catch (e) { return null; } }
  function api(path, body) {
    var u = me() || {};
    var opts = { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Chowaniec-Key': u.key || '' } };
    if (body) { opts.method = 'POST'; opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status });
        return data;
      });
    });
  }
  var toastTimer = null;
  function toast(text, bad) {
    var el = $('toast');
    el.textContent = text; el.hidden = false; el.classList.toggle('is-bad', !!bad);
    requestAnimationFrame(function () { el.classList.add('is-on'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); setTimeout(function () { el.hidden = true; }, 300); }, 3200);
  }
  function hideToast() { clearTimeout(toastTimer); $('toast').classList.remove('is-on'); $('toast').hidden = true; }
  function hap(kind) { try { if (window.ChowaniecHaptics) window.ChowaniecHaptics.tap(kind || 'light'); } catch (e) { /* ignore */ } }
  function store(key, value) { try { if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (e) { return null; } return null; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function when(iso, long) {
    var d = new Date(iso), now = new Date(), ago = now - d;
    var t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (!long && ago < 60 * 1000) return 'Just now';
    if (!long && ago < 60 * 60 * 1000) return Math.round(ago / 60000) + ' min ago';
    if (sameDay(d, now)) return (long ? 'Today at ' : '') + t;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday' + (long ? ' at ' + t : '');
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + (long ? ' at ' + t : '');
  }
  function renderMarkdown(md) {
    var src = String(md || '');
    if (!window.marked || !window.DOMPurify) return '<p>' + esc(src).replace(/\n/g, '<br>') + '</p>';
    var html = window.marked.parse(src, { gfm: true, breaks: true });
    return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }
  var photoUrl = function (id) { return API + '?photo=' + encodeURIComponent(id); };

  // ---------- state ----------
  var role = 'none', myName = '', heads = ['Gabriel', 'Victoria', 'Nicole'];
  var view = 'send';           // send | list | detail | done | blocked
  var items = [], knownIds = null, listFilter = { who: '', unreviewed: false, q: '' };
  var current = null;          // the open submission
  var lastSentId = null;

  // ================================================================ tabs
  function setTabs() {
    var a = $('tab-a'), b = $('tab-b');
    var first = role === 'recipient' ? 'list' : 'send';
    var second = role === 'recipient' ? 'send' : 'list';
    a.dataset.view = first; b.dataset.view = second;
    var label = function (v) { return v === 'send' ? icon('pen', 16) + 'Send notes' : icon(role === 'recipient' ? 'inbox' : 'send', 16) + (role === 'recipient' ? 'Inbox' : 'Sent') + '<span class="ch-badge up-tabbadge" hidden></span>'; };
    a.innerHTML = label(first); b.innerHTML = label(second);
    $('tabs').hidden = false;
    [a, b].forEach(function (btn) { btn.addEventListener('click', function () { hap('light'); show(btn.dataset.view, { push: true }); }); });
  }
  function markTabs() {
    var v = view === 'detail' ? 'list' : view === 'done' ? 'send' : view;
    [$('tab-a'), $('tab-b')].forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === v)); });
  }
  function setBadge(n) {
    document.querySelectorAll('.up-tabbadge').forEach(function (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); });
  }

  function show(v, opts) {
    opts = opts || {};
    var from = view;
    view = v;
    ['send', 'list', 'detail', 'done', 'blocked'].forEach(function (k) { $('view-' + k).hidden = k !== v; });
    $('loading').hidden = true;
    markTabs();
    if (v === 'list') renderList();
    if (v !== 'detail') current = null;
    if (opts.push) {
      var url = v === 'detail' && current ? '?id=' + current.id : location.pathname;
      history.pushState({ v: v, id: current && current.id, from: from }, '', url);
    }
    if (!opts.keepScroll) window.scrollTo({ top: 0 });
  }

  // ================================================================ send: meeting picker
  var meeting = { title: '', eventId: null, meetingCode: null };
  function loadMeetings() {
    api(API + '?meetings=1').then(function (d) {
      var box = $('meeting-chips');
      var chips = [];
      (d.events || []).forEach(function (e) {
        var isToday = e.date === d.today;
        var t = e.time ? new Date('2000-01-01T' + e.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
        var day = isToday ? 'Today' : new Date(e.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
        chips.push({ title: e.title, eventId: e.id, kind: 'calendar', sub: day + (t ? ' ' + t : '') });
      });
      (d.meets || []).forEach(function (m) {
        var title = 'Meet call, ' + new Date(m.at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        chips.push({ title: title, meetingCode: m.code, kind: 'video', sub: when(m.at) });
      });
      box.innerHTML = '';
      if (!chips.length) { box.hidden = true; $('meeting-help').textContent = 'Type the meeting name, like “Costume meeting”.'; return; }
      chips.slice(0, 10).forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'ch-chip up-mchip';
        b.innerHTML = icon(c.kind, 15) + '<span>' + esc(c.title) + '</span><small>' + esc(c.sub) + '</small>';
        b.setAttribute('aria-pressed', 'false');
        b._m = c;
        b.addEventListener('click', function () {
          hap('light');
          var on = b.getAttribute('aria-pressed') !== 'true';
          meeting = on ? { title: c.title, eventId: c.eventId || null, meetingCode: c.meetingCode || null } : { title: '', eventId: null, meetingCode: null };
          $('meeting-title').value = meeting.title;
          syncChips(); saveDraft();
        });
        box.appendChild(b);
      });
      syncChips();
    }).catch(function () { $('meeting-chips').hidden = true; });
  }
  function syncChips() {
    document.querySelectorAll('.up-mchip').forEach(function (b) {
      var c = b._m;
      b.setAttribute('aria-pressed', String(!!meeting.title && meeting.title === c.title && (meeting.eventId || null) === (c.eventId || null) && (meeting.meetingCode || null) === (c.meetingCode || null)));
    });
  }

  // ================================================================ send: editor
  var editor, draftKey, saveTimer = null;
  function draft() { return { meeting: meeting, markdown: editor.value, todos: readTodos(true), photos: photos.filter(function (p) { return p.id; }).map(function (p) { return { id: p.id, size: p.size }; }), savedAt: Date.now() }; }
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var d = draft();
      var empty = !d.markdown.trim() && !d.meeting.title && !d.todos.length && !d.photos.length;
      store(draftKey, empty ? null : d);
      $('save-state').textContent = empty ? 'Your notes save on this device as you type.' : 'Draft saved on this device.';
    }, 350);
  }
  function restoreDraft() {
    var d = store(draftKey);
    if (!d) return;
    meeting = Object.assign({ title: '', eventId: null, meetingCode: null }, d.meeting || {});
    $('meeting-title').value = meeting.title || '';
    editor.value = d.markdown || '';
    (d.todos || []).forEach(function (t) { addTodo(t); });
    (d.photos || []).slice(0, MAX_PHOTOS).forEach(function (p) { photos.push({ key: Math.random().toString(36).slice(2), id: p.id, size: p.size, src: photoUrl(p.id), state: 'done' }); });
    renderPhotos();
    autosize();
    $('save-state').textContent = 'Picked up your draft from ' + when(new Date(d.savedAt || Date.now()).toISOString()).toLowerCase() + '.';
  }
  function autosize() { editor.style.height = 'auto'; editor.style.height = Math.min(Math.max(editor.scrollHeight + 2, 220), window.innerHeight * 0.7) + 'px'; }

  function format(kind) {
    var s = editor.selectionStart, e = editor.selectionEnd, v = editor.value;
    editor.focus();
    if (kind === 'b') {
      var sel = v.slice(s, e) || 'bold text';
      editor.setRangeText('**' + sel + '**', s, e, 'end');
      if (s === e) editor.setSelectionRange(s + 2, s + 2 + sel.length);
    } else {
      var prefix = kind === 'h' ? '## ' : kind === 'ul' ? '- ' : '- [ ] ';
      var lineStart = v.lastIndexOf('\n', s - 1) + 1;
      var lineEnd = v.indexOf('\n', e); if (lineEnd < 0) lineEnd = v.length;
      var lines = v.slice(lineStart, lineEnd).split('\n');
      var allHave = lines.every(function (l) { return l.indexOf(prefix) === 0; });
      var out = lines.map(function (l) { var bare = l.replace(/^(#{1,6} |- \[[ xX]\] |[-*+] )/, ''); return allHave ? bare : prefix + bare; }).join('\n');
      editor.setRangeText(out, lineStart, lineEnd, 'end');
    }
    editor.dispatchEvent(new Event('input'));
  }
  // Enter inside a list keeps the list going (and an empty item ends it).
  function onKey(ev) {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
    var v = editor.value, s = editor.selectionStart;
    if (s !== editor.selectionEnd) return;
    var ls = v.lastIndexOf('\n', s - 1) + 1;
    var line = v.slice(ls, s);
    var m = line.match(/^(\s*)(- \[[ xX]\] |[-*+] |(\d+)\. )/);
    if (!m) return;
    ev.preventDefault();
    if (line.trim() === m[2].trim()) { editor.setRangeText('', ls, s, 'end'); }
    else { var next = m[3] ? (Number(m[3]) + 1) + '. ' : m[2].replace(/\[[xX]\]/, '[ ]'); editor.setRangeText('\n' + m[1] + next, s, s, 'end'); }
    editor.dispatchEvent(new Event('input'));
  }
  function setMode(preview) {
    $('mode-write').setAttribute('aria-pressed', String(!preview));
    $('mode-preview').setAttribute('aria-pressed', String(preview));
    editor.hidden = preview; $('toolbar').classList.toggle('is-off', preview);
    var pv = $('preview');
    pv.hidden = !preview;
    if (preview) pv.innerHTML = editor.value.trim() ? renderMarkdown(editor.value) : '<p class="ch-muted">Nothing written yet.</p>';
  }

  // Dictation (Web Speech API where available)
  var rec = null, listening = false;
  function setupDictation() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    var btn = $('btn-dictate');
    btn.hidden = false;
    btn.addEventListener('click', function () {
      if (listening) { rec.stop(); return; }
      rec = new SR();
      rec.lang = navigator.language || 'en-US'; rec.continuous = true; rec.interimResults = false;
      rec.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          var text = e.results[i][0].transcript.trim();
          if (!text) continue;
          var s = editor.selectionStart, before = editor.value.slice(0, s);
          var lead = before && !/\s$/.test(before) ? ' ' : '';
          editor.setRangeText(lead + text.charAt(0).toUpperCase() + text.slice(1), s, editor.selectionEnd, 'end');
          editor.dispatchEvent(new Event('input'));
        }
      };
      rec.onend = function () { listening = false; btn.setAttribute('aria-pressed', 'false'); btn.classList.remove('is-live'); btn.querySelector('.up-mic__label').textContent = 'Dictate'; };
      rec.onerror = function (e) { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow the microphone to dictate your notes.', true); };
      try { rec.start(); } catch (e) { return; }
      listening = true; hap('medium');
      btn.setAttribute('aria-pressed', 'true'); btn.classList.add('is-live'); btn.querySelector('.up-mic__label').textContent = 'Listening… tap to stop';
      setMode(false); editor.focus();
    });
  }

  // Tidy with AI (Notes AI "cleanup"), shown for the person to accept or skip.
  var aiSuggestion = null, beforeTidy = null;
  function tidy() {
    var text = editor.value.trim();
    if (!text) { toast('Write some notes first, then the AI can tidy them.'); return; }
    var btn = $('btn-tidy');
    btn.disabled = true; btn.classList.add('is-busy'); btn.lastChild.textContent = 'Tidying…';
    var u = me() || {};
    fetch('/.netlify/functions/notes-ai', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chowaniec-Key': u.key || '' }, body: JSON.stringify({ mode: 'cleanup', markdown: text, title: meeting.title || 'Meeting notes' }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.markdown) throw Object.assign(new Error(d.error || ''), { status: r.status }); return d; }); })
      .then(function (d) {
        aiSuggestion = d.markdown;
        $('ai-result').innerHTML = renderMarkdown(d.markdown);
        $('ai-box').hidden = false;
        $('ai-box').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      })
      .catch(function (e) {
        if (e.status === 500 && /not configured/i.test(e.message)) { toast('AI tidying is switched off right now. Your notes are fine as they are.'); btn.hidden = true; return; }
        toast(e.status === 429 ? 'The AI is busy. Try again in a moment.' : 'The AI couldn’t tidy this right now. Your notes are safe.', true);
      })
      .then(function () { btn.disabled = false; btn.classList.remove('is-busy'); btn.lastChild.textContent = 'Tidy with AI'; });
  }

  // ================================================================ send: photos
  var photos = [];   // { key, file?, src, id?, size, state: 'working'|'uploading'|'done'|'error', error? }
  function renderPhotos() {
    var box = $('photos');
    box.innerHTML = '';
    photos.forEach(function (p, i) {
      var tile = document.createElement('div');
      tile.className = 'up-photo up-photo--' + p.state;
      tile.innerHTML = (p.src ? '<img alt="Photo ' + (i + 1) + '" src="' + esc(p.src) + '">' : '') +
        (p.state === 'working' || p.state === 'uploading' ? '<span class="up-photo__spin" aria-label="Uploading"></span>' : '') +
        (p.state === 'error' ? '<span class="up-photo__err">' + icon('alert', 16) + 'Tap to retry</span>' : '') +
        '<button type="button" class="up-photo__x" aria-label="Remove photo ' + (i + 1) + '">' + icon('x', 16) + '</button>';
      tile.querySelector('.up-photo__x').addEventListener('click', function () { photos = photos.filter(function (x) { return x !== p; }); renderPhotos(); saveDraft(); hap('light'); });
      if (p.state === 'error') tile.addEventListener('click', function (e) { if (!e.target.closest('.up-photo__x')) upload(p); });
      box.appendChild(tile);
    });
    $('photo-count').textContent = photos.length + ' of ' + MAX_PHOTOS;
    var full = photos.length >= MAX_PHOTOS;
    ['lbl-camera', 'lbl-gallery'].forEach(function (id) { $(id).classList.toggle('is-disabled', full); $(id).querySelector('input').disabled = full; });
    box.hidden = !photos.length;
  }
  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That picture couldn’t be opened. Try a JPEG or PNG.')); };
      img.src = url;
    });
  }
  function toBlob(canvas, q) { return new Promise(function (r) { canvas.toBlob(r, 'image/jpeg', q); }); }
  // Shrinks to at most 1600 px on the long side, as a JPEG under 1.5 MB.
  function shrink(file) {
    return loadImage(file).then(function (img) {
      var w = img.width, h = img.height, scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      var attempt = function (scaleNow, q) {
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scaleNow)); c.height = Math.max(1, Math.round(h * scaleNow));
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return toBlob(c, q).then(function (blob) {
          if (!blob) throw new Error('That picture couldn’t be opened.');
          if (blob.size <= MAX_BYTES) return blob;
          if (q > 0.55) return attempt(scaleNow, q - 0.12);
          if (scaleNow > 0.3) return attempt(scaleNow * 0.8, 0.7);
          throw new Error('That picture is too big.');
        });
      };
      return attempt(scale, 0.85);
    });
  }
  function dataUrl(blob) { return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = reject; r.readAsDataURL(blob); }); }
  function upload(p) {
    p.state = 'uploading'; renderPhotos();
    p.job = dataUrl(p.blob).then(function (data) { return api(API, { action: 'photo', data: data }); }).then(function (d) {
      p.id = d.photo.id; p.size = d.photo.size; p.state = 'done'; renderPhotos(); saveDraft();
    }).catch(function (e) { p.state = 'error'; p.error = e.message; renderPhotos(); toast(e.message || 'A photo didn’t upload. Tap it to try again.', true); });
    return p.job;
  }
  function addFiles(list) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name); });
    var room = MAX_PHOTOS - photos.length;
    if (files.length > room) toast(room ? 'Only ' + room + ' more photo' + (room === 1 ? '' : 's') + ' fit (8 at most).' : 'That’s 8 photos already, the most you can send.');
    files.slice(0, room).forEach(function (file) {
      var p = { key: Math.random().toString(36).slice(2), state: 'working', src: '' };
      photos.push(p);
      shrink(file).then(function (blob) { p.blob = blob; p.src = URL.createObjectURL(blob); return upload(p); })
        .catch(function (e) { photos = photos.filter(function (x) { return x !== p; }); renderPhotos(); toast(e.message || 'That picture couldn’t be added.', true); });
    });
    renderPhotos();
  }

  // ================================================================ send: to-dos
  function family() { return (typeof window.chowaniecPeople === 'function' ? window.chowaniecPeople() : ['Gabriel', 'Victoria', 'Nicole', 'Liliana', 'Amelia', 'Emilia']); }
  var todoN = 0;
  function addTodo(t, focus) {
    t = t || {};
    var n = ++todoN;
    var row = document.createElement('div');
    row.className = 'up-todo ch-enter';
    var opts = ['Everyone'].concat(family()).map(function (name) { return '<option value="' + esc(name) + '"' + (t.who === name ? ' selected' : '') + '>' + esc(nice(name)) + '</option>'; }).join('');
    row.innerHTML = '<div class="ch-field up-todo__who"><label class="ch-label" for="tw' + n + '">Who</label><select class="ch-input" id="tw' + n + '">' + opts + '</select></div>' +
      '<div class="ch-field up-todo__what"><label class="ch-label" for="tt' + n + '">What</label><input class="ch-input" id="tt' + n + '" maxlength="200" autocomplete="off" enterkeyhint="done"></div>' +
      '<button type="button" class="ch-iconbtn up-todo__x" aria-label="Remove this thing to do">' + icon('x', 18) + '</button>';
    row.querySelector('input').value = t.what || '';
    row.querySelector('.up-todo__x').addEventListener('click', function () { row.remove(); saveDraft(); });
    row.addEventListener('input', saveDraft);
    row.addEventListener('change', saveDraft);
    row.querySelector('input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addTodo({}, true); } });
    $('todos').appendChild(row);
    if (focus) row.querySelector('input').focus();
  }
  function readTodos(keepEmpty) {
    return Array.prototype.map.call(document.querySelectorAll('.up-todo'), function (r) { return { who: r.querySelector('select').value, what: r.querySelector('input').value.trim() }; })
      .filter(function (t) { return keepEmpty ? true : !!t.what; });
  }

  // ================================================================ send
  var sending = false;
  function sendError(text) { var el = $('send-error'); el.textContent = text || ''; el.hidden = !text; }
  function send() {
    if (sending) return;
    sendError('');
    meeting.title = $('meeting-title').value.trim();
    if (!meeting.title) { sendError('Pick or type which meeting these notes are for.'); $('meeting-title').focus(); $('card-meeting').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    var todos = readTodos();
    if (!editor.value.trim() && !photos.length && !todos.length) { sendError('Write some notes or add a photo first.'); editor.focus(); return; }
    sending = true;
    var btn = $('btn-send');
    btn.disabled = true; $('send-label').textContent = 'Sending…';
    var waiting = photos.filter(function (p) { return p.state !== 'done'; });
    Promise.all(waiting.map(function (p) { return p.state === 'error' ? upload(p) : p.job || Promise.resolve(); })).then(function () {
      if (photos.some(function (p) { return !p.id; })) throw new Error('A photo is still not uploaded. Tap it to try again, or remove it.');
      return api(API, { action: 'send', meeting: meeting, markdown: editor.value, todos: todos, photos: photos.map(function (p) { return p.id; }) });
    }).then(function (d) {
      lastSentId = d.submission.id;
      store(draftKey, null);
      resetForm();
      hap('success');
      if (window.ChowaniecPolish && window.ChowaniecPolish.celebrate) { try { window.ChowaniecPolish.celebrate('sent'); } catch (e) { /* ignore */ } }
      var others = heads.filter(function (n) { return n !== myName; });
      $('done-meeting').textContent = d.submission.meeting.title;
      $('done-text').textContent = listNames(others) + (others.length > 1 ? ' have' : ' has') + ' your notes. You\u2019ll see here when they read them.';
      hideToast();
      items = [Object.assign({ unread: false }, summaryOf(d.submission))].concat(items.filter(function (i) { return i.id !== d.submission.id; }));
      if (knownIds) knownIds[d.submission.id] = true;
      show('done');
    }).catch(function (e) { sendError(e.message); hap('error'); })
      .then(function () { sending = false; btn.disabled = false; $('send-label').textContent = sendLabel(); });
  }
  function summaryOf(s) { return { id: s.id, meeting: s.meeting, author: s.author, createdAt: s.createdAt, preview: s.markdown.slice(0, 160), photoCount: s.photos.length, todoCount: s.todos.length, cover: s.photos[0] ? s.photos[0].id : null, seenBy: s.seenBy, reviewedBy: s.reviewedBy, replyCount: s.replies.length, lastReply: s.replies.slice(-1)[0] || null, noteId: s.noteId }; }
  function sendLabel() { var others = heads.filter(function (n) { return n !== myName; }); return 'Send to ' + listNames(others); }
  function resetForm() {
    meeting = { title: '', eventId: null, meetingCode: null };
    $('meeting-title').value = ''; editor.value = ''; autosize(); syncChips();
    photos = []; renderPhotos(); $('todos').innerHTML = '';
    $('ai-box').hidden = true; $('btn-undo').hidden = true; beforeTidy = null;
    setMode(false);
    $('save-state').textContent = 'Your notes save on this device as you type.';
  }

  // ================================================================ list
  function statusLine(i) {
    var seen = Object.keys(i.seenBy || {}), rev = Object.keys(i.reviewedBy || {});
    var parts = [];
    if (rev.length) parts.push('Reviewed by ' + listNames(rev));
    var seenOnly = seen.filter(function (n) { return rev.indexOf(n) < 0; });
    if (seenOnly.length) parts.push('Seen by ' + listNames(seenOnly));
    return parts.join(' · ') || 'Delivered, not opened yet';
  }
  function filtered() {
    var q = listFilter.q.toLowerCase();
    return items.filter(function (i) {
      if (listFilter.who && i.author !== listFilter.who) return false;
      if (listFilter.unreviewed && Object.keys(i.reviewedBy || {}).length) return false;
      if (q && (i.meeting.title + ' ' + (i.preview || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderFilters() {
    var box = $('filter-chips');
    $('filters').hidden = role !== 'recipient' || items.length < 2;
    if ($('filters').hidden) return;
    var authors = [];
    items.forEach(function (i) { if (authors.indexOf(i.author) < 0) authors.push(i.author); });
    var chips = [{ label: 'All', on: !listFilter.who && !listFilter.unreviewed, fn: function () { listFilter.who = ''; listFilter.unreviewed = false; } },
      { label: 'Not reviewed', on: listFilter.unreviewed, fn: function () { listFilter.unreviewed = !listFilter.unreviewed; } }]
      .concat(authors.map(function (a) { return { label: nice(a), on: listFilter.who === a, fn: function () { listFilter.who = listFilter.who === a ? '' : a; } }; }));
    box.innerHTML = '';
    chips.forEach(function (c) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'ch-chip'; b.textContent = c.label; b.setAttribute('aria-pressed', String(c.on));
      b.addEventListener('click', function () { c.fn(); hap('light'); renderList(); });
      box.appendChild(b);
    });
  }
  function renderList() {
    renderFilters();
    var ul = $('list'), empty = $('list-empty');
    var rows = filtered();
    ul.innerHTML = '';
    ul.hidden = !rows.length;
    empty.hidden = !!rows.length;
    if (!rows.length) {
      var none = !items.length;
      empty.className = 'ch-card ch-empty';
      empty.innerHTML = '<span class="ch-empty__icon">' + icon(role === 'recipient' ? 'inbox' : 'send', 26) + '</span>' +
        '<h2 class="ch-empty__title">' + (none ? (role === 'recipient' ? 'No meeting notes yet' : 'Nothing sent yet') : 'Nothing matches') + '</h2>' +
        '<p>' + (none ? (role === 'recipient' ? 'When Liliana, Amelia or Emilia send notes after a meeting, they show up here straight away.' : 'Notes you send show up here, and you can see when Gabriel, Vicky and Nicole read them.') : 'Try a different filter.') + '</p>' +
        (none && role !== 'recipient' ? '<button type="button" class="ch-btn ch-btn--primary" id="empty-send" style="margin-top:12px">' + icon('pen', 18) + 'Send notes</button>' : '');
      var es = $('empty-send'); if (es) es.addEventListener('click', function () { show('send', { push: true }); });
      return;
    }
    rows.forEach(function (i, n) {
      var li = document.createElement('li');
      var fresh = knownIds && !knownIds[i.id];
      if (fresh) li.className = 'up-new';
      var mine = i.author === myName;
      var reviewed = Object.keys(i.reviewedBy || {}).length;
      var meta = [];
      if (!mine || role === 'recipient') meta.push(nice(i.author));
      if (i.photoCount) meta.push(i.photoCount + ' photo' + (i.photoCount === 1 ? '' : 's'));
      if (i.todoCount) meta.push(i.todoCount + ' to-do' + (i.todoCount === 1 ? '' : 's'));
      var sub = role === 'recipient' && !mine ? (i.preview || meta.join(' · ')) : statusLine(i);
      li.innerHTML = '<a class="ch-row up-row' + (i.unread ? ' is-unread' : '') + '" href="?id=' + esc(i.id) + '">' +
        '<span class="ch-row__lead">' + (i.cover ? '<span class="up-thumb"><img alt="" loading="lazy" src="' + esc(photoUrl(i.cover)) + '"></span>' : avatar(i.author)) + '</span>' +
        '<span class="ch-row__main"><span class="ch-row__title">' + esc(i.meeting.title) + '</span>' +
        '<span class="ch-row__sub">' + esc(sub) + '</span>' +
        '<span class="up-row__meta">' + (role === 'recipient' && !mine ? esc(meta.join(' · ')) : '') +
        (reviewed && role === 'recipient' ? '<span class="up-pill up-pill--ok">' + icon('check', 12) + 'Reviewed</span>' : '') +
        (i.replyCount ? '<span class="up-pill">' + icon('reply', 12) + i.replyCount + (i.replyCount === 1 ? ' reply' : ' replies') + '</span>' : '') + '</span></span>' +
        '<span class="ch-row__trail"><span>' + esc(when(i.createdAt)) + '</span>' + (i.unread ? '<span class="ch-dot" aria-label="New"></span>' : '') + '</span></a>';
      li.querySelector('a').addEventListener('click', function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openDetail(i.id, true); });
      ul.appendChild(li);
    });
  }

  function loadList(first) {
    return api(API + '?list=1').then(function (d) {
      heads = d.recipients || heads;
      var prev = knownIds;
      items = d.items || [];
      setBadge(d.unread || 0);
      if (view === 'list') renderList();
      knownIds = {};
      items.forEach(function (i) { knownIds[i.id] = true; });
      if (prev && !first && role === 'recipient') {
        var fresh = items.filter(function (i) { return !prev[i.id] && i.author !== myName; });
        if (fresh.length && view !== 'list') toast(nice(fresh[0].author) + ' sent notes: ' + fresh[0].meeting.title);
      }
      return d;
    });
  }

  // ================================================================ detail
  function openDetail(id, push) {
    return api(API + '?id=' + encodeURIComponent(id)).then(function (d) {
      current = d.submission;
      show('detail', { push: push });
      renderDetail();
      markSeenIfNeeded();
    }).catch(function (e) { toast(e.message, true); if (view !== 'list') show(role === 'recipient' ? 'list' : 'send'); });
  }
  function markSeenIfNeeded() {
    var s = current;
    if (!s) return;
    var need = (role === 'recipient' && s.author !== myName && !s.seenBy[myName]) || (s.author === myName && (s.activityAt || '') > (s.authorSeenAt || ''));
    if (!need) return;
    api(API, { action: 'seen', id: s.id }).then(function (d) {
      if (current && current.id === s.id) current = d.submission;
      items.forEach(function (i) { if (i.id === s.id) { i.unread = false; i.seenBy = d.submission.seenBy; } });
      setBadge(items.filter(function (i) { return i.unread; }).length);
    }).catch(function () { /* try again next time */ });
  }

  function deliveryHtml(s) {
    var others = heads.filter(function (n) { return n !== s.author; });
    return '<div class="up-delivery" aria-label="Who has read it">' + others.map(function (n) {
      var rev = s.reviewedBy[n], seen = s.seenBy[n];
      var state = rev ? 'reviewed' : seen ? 'seen' : 'waiting';
      var text = rev ? 'Reviewed' : seen ? 'Seen' : 'Not yet';
      var at = rev || seen;
      return '<div class="up-person up-person--' + state + '">' + avatar(n, 'sm') + '<span><b>' + esc(nice(n)) + '</b><small>' +
        (state === 'waiting' ? icon('clock', 12) : state === 'seen' ? icon('eye', 12) : icon('checkCircle', 12)) + esc(text) + '</small>' + (at ? '<small class="up-person__at">' + esc(when(at)) + '</small>' : '') + '</span></div>';
    }).join('') + '</div>';
  }

  function renderDetail() {
    var s = current;
    if (!s) return;
    var mine = s.author === myName;
    $('detail-back-label').textContent = role === 'recipient' ? 'Inbox' : 'Sent';
    var rev = Object.keys(s.reviewedBy), seen = Object.keys(s.seenBy);
    var isHead = role === 'recipient';
    var html = '';
    html += '<div class="ch-card up-dhead">' +
      '<p class="ch-eyebrow">' + (s.meeting.eventId ? icon('calendar', 13) + ' Calendar event' : s.meeting.meetingCode ? icon('video', 13) + ' Meet call' : 'Meeting') + '</p>' +
      '<h2 class="ch-display up-dtitle">' + esc(s.meeting.title) + '</h2>' +
      '<div class="up-byline">' + avatar(s.author) + '<span><b>' + esc(mine ? 'You' : nice(s.author)) + '</b><small>' + esc(when(s.createdAt, true)) + '</small></span></div>' +
      (mine || !isHead ? deliveryHtml(s) : (rev.length || seen.length > 1 ? '<p class="ch-help up-dstatus">' + esc(statusLine(s)) + '</p>' : '')) +
      '</div>';

    if (s.markdown.trim()) html += '<div class="ch-card"><div class="up-prose">' + renderMarkdown(s.markdown) + '</div></div>';

    if (s.photos.length) {
      html += '<div class="ch-card"><div class="ch-card__head"><span class="ch-card__icon">' + icon('image') + '</span><h3 class="ch-card__title">Photos</h3><span class="ch-muted up-count">' + s.photos.length + '</span></div><div class="up-gallery">' +
        s.photos.map(function (p, i) { return '<button type="button" class="up-gimg" data-i="' + i + '" aria-label="Open photo ' + (i + 1) + ' of ' + s.photos.length + '"><img alt="" loading="lazy" src="' + esc(photoUrl(p.id)) + '"></button>'; }).join('') + '</div></div>';
    }
    if (s.todos.length) {
      html += '<div class="ch-card"><div class="ch-card__head"><span class="ch-card__icon">' + icon('checklist') + '</span><h3 class="ch-card__title">Things to do</h3></div><ul class="ch-list up-dtodos">' +
        s.todos.map(function (t) { return '<li class="up-dtodo">' + avatar(t.who === 'Everyone' ? '+' : t.who, 'sm') + '<span><b>' + esc(nice(t.who)) + '</b> ' + esc(t.what) + '</span></li>'; }).join('') + '</ul></div>';
    }

    // conversation
    html += '<div class="ch-card" id="convo"><div class="ch-card__head"><span class="ch-card__icon">' + icon('reply') + '</span><h3 class="ch-card__title">' + (isHead && !mine ? 'Reply to ' + esc(nice(s.author)) : 'Replies') + '</h3></div>' +
      (s.replies.length ? '<ol class="up-replies">' + s.replies.map(function (r) {
        var own = r.by === myName;
        return '<li class="up-reply' + (own ? ' is-own' : '') + '">' + (own ? '' : avatar(r.by, 'sm')) + '<div class="up-bubble"><small>' + esc(own ? 'You' : nice(r.by)) + ' · ' + esc(when(r.at)) + '</small><p>' + esc(r.text) + '</p></div></li>';
      }).join('') + '</ol>' : (isHead && !mine ? '' : '<p class="ch-muted up-noreply">No replies yet. When Gabriel, Vicky or Nicole reply, it shows up here.</p>')) +
      ((isHead || mine) && (isHead || s.replies.length) ? '<form class="up-replyform" id="reply-form"><div class="ch-field"><label class="ch-label" for="reply-text">' + (isHead && !mine ? 'Message to ' + esc(nice(s.author)) : 'Your answer') + '</label>' +
        '<textarea class="ch-input" id="reply-text" rows="2" maxlength="1000"></textarea></div><button type="submit" class="ch-btn ch-btn--primary ch-btn--sm">' + icon('send', 16) + 'Send reply</button></form>' : '') +
      '</div>';

    if (isHead) {
      var iReviewed = !!s.reviewedBy[myName];
      html += '<div class="up-actions">' +
        '<button type="button" class="ch-btn ' + (iReviewed ? 'ch-btn--secondary' : 'ch-btn--primary') + '" id="act-review" aria-pressed="' + iReviewed + '">' + icon(iReviewed ? 'checkCircle' : 'check') + (iReviewed ? 'Reviewed' : 'Mark reviewed') + '</button>' +
        (s.noteId ? '<a class="ch-btn ch-btn--secondary" href="/notes/?id=' + esc(s.noteId) + '">' + icon('notes') + 'Open in Notes</a>' : '<button type="button" class="ch-btn ch-btn--secondary" id="act-save">' + icon('notes') + 'Save to Notes</button>') +
        '<button type="button" class="ch-btn ch-btn--ghost up-danger" id="act-delete">' + icon('trash') + 'Delete</button>' +
        '</div>';
    } else if (s.noteId) {
      html += '<div class="up-actions"><a class="ch-btn ch-btn--secondary" href="/notes/?id=' + esc(s.noteId) + '">' + icon('notes') + 'Saved to Notes: open it</a></div>';
    }

    var box = $('detail');
    var draftReply = $('reply-text') ? $('reply-text').value : '';
    var hadFocus = document.activeElement && document.activeElement.id === 'reply-text';
    box.innerHTML = html;
    if ($('reply-text')) { $('reply-text').value = draftReply; if (hadFocus) $('reply-text').focus(); }

    box.querySelectorAll('.up-gimg').forEach(function (b) { b.addEventListener('click', function () { openViewer(Number(b.dataset.i)); }); });
    var form = $('reply-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = $('reply-text').value.trim();
      if (!t) { $('reply-text').focus(); return; }
      var btn = form.querySelector('button'); btn.disabled = true;
      act({ action: 'reply', id: s.id, text: t }).then(function (ok) { if (ok) { $('reply-text').value = ''; toast('Reply sent to ' + (mine ? listNames(heads.filter(function (n) { return n !== myName; })) : nice(s.author)) + '.'); } btn.disabled = false; });
    });
    var rv = $('act-review');
    if (rv) rv.addEventListener('click', function () { rv.disabled = true; act({ action: s.reviewedBy[myName] ? 'unreview' : 'review', id: s.id }).then(function () { if (current && current.reviewedBy[myName]) toast(nice(s.author) + ' will see you reviewed it.'); }); });
    var sv = $('act-save');
    if (sv) sv.addEventListener('click', function () {
      sv.disabled = true; sv.lastChild.textContent = 'Saving…';
      api(API, { action: 'save-to-notes', id: s.id }).then(function (d) {
        current = d.submission || current; current.noteId = d.noteId; renderDetail(); toast('Saved to Notes, shared with ' + listNames(heads.concat([s.author]).filter(function (n, i, a) { return n !== myName && a.indexOf(n) === i; })) + '.');
      }).catch(function (e) { toast(e.message, true); sv.disabled = false; sv.lastChild.textContent = 'Save to Notes'; });
    });
    var dl = $('act-delete');
    if (dl) dl.addEventListener('click', function () { if (window.ChowaniecUI) window.ChowaniecUI.sheet('#sheet-delete').open(); });
  }

  function act(body) {
    return api(API, body).then(function (d) {
      if (d.submission && current && current.id === d.submission.id) { current = d.submission; renderDetail(); }
      hap('success');
      loadList().catch(function () {});
      return true;
    }).catch(function (e) { toast(e.message, true); renderDetail(); return false; });
  }

  // ================================================================ photo viewer
  var vIndex = 0, lastFocus = null;
  function openViewer(i) {
    if (!current || !current.photos.length) return;
    lastFocus = document.activeElement;
    vIndex = i; var v = $('viewer'); v.hidden = false;
    requestAnimationFrame(function () { v.classList.add('is-open'); });
    document.documentElement.classList.add('up-noscroll');
    paintViewer(); $('viewer-close').focus();
  }
  function paintViewer() {
    var list = current.photos, n = list.length;
    $('viewer-img').src = photoUrl(list[vIndex].id);
    $('viewer-img').alt = 'Photo ' + (vIndex + 1) + ' of ' + n + ' from ' + nice(current.author);
    $('viewer-open').href = photoUrl(list[vIndex].id);
    $('viewer-count').textContent = (vIndex + 1) + ' / ' + n;
    $('viewer-prev').hidden = $('viewer-next').hidden = n < 2;
  }
  function stepViewer(d) { var n = current.photos.length; vIndex = (vIndex + d + n) % n; paintViewer(); }
  function closeViewer() {
    var v = $('viewer'); v.classList.remove('is-open');
    document.documentElement.classList.remove('up-noscroll');
    setTimeout(function () { v.hidden = true; $('viewer-img').removeAttribute('src'); }, 200);
    if (lastFocus) lastFocus.focus();
  }
  function setupViewer() {
    $('viewer-close').addEventListener('click', closeViewer);
    $('viewer-prev').addEventListener('click', function () { stepViewer(-1); });
    $('viewer-next').addEventListener('click', function () { stepViewer(1); });
    $('viewer').addEventListener('click', function (e) { if (e.target === $('viewer')) closeViewer(); });
    document.addEventListener('keydown', function (e) {
      if ($('viewer').hidden) return;
      if (e.key === 'Escape') closeViewer(); else if (e.key === 'ArrowLeft') stepViewer(-1); else if (e.key === 'ArrowRight') stepViewer(1);
    });
    var x0 = null;
    $('viewer').addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    $('viewer').addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50 && current.photos.length > 1) stepViewer(dx < 0 ? 1 : -1); else if (dx > -10 && dx < 10 && e.target.id === 'viewer-img') { /* tap: nothing */ } });
  }

  // ================================================================ live updates
  var pollTimer = null;
  function poll() {
    if (document.hidden || role === 'none') return;
    loadList().then(function () {
      if (view === 'detail' && current) {
        var id = current.id;
        api(API + '?id=' + encodeURIComponent(id)).then(function (d) {
          if (!current || current.id !== id) return;
          if (JSON.stringify(d.submission) !== JSON.stringify(current)) { current = d.submission; renderDetail(); markSeenIfNeeded(); }
        }).catch(function (e) { if (e.status === 404 && current && current.id === id) { toast('These notes were deleted.'); show('list'); } });
      }
    }).catch(function () { /* offline: try next time */ });
  }
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  }

  // ================================================================ start
  function routeFromUrl(push) {
    var id = new URLSearchParams(location.search).get('id');
    if (id) return openDetail(id, false);
    show(role === 'recipient' ? 'list' : 'send', { keepScroll: !push });
    return Promise.resolve();
  }

  function start() {
    var u = me();
    paintIcons();
    if (!u) return;
    myName = u.name;
    api(API + '?list=1').then(function (d) {
      role = d.role;
      if (role === 'none') { $('sub').textContent = 'For meeting notes from Liliana, Amelia and Emilia.'; show('blocked'); return; }
      heads = d.recipients || heads;
      items = d.items || [];
      knownIds = {}; items.forEach(function (i) { knownIds[i.id] = true; });
      setBadge(d.unread || 0);
      $('sub').textContent = role === 'recipient'
        ? 'Meeting notes from Liliana, Amelia and Emilia, as soon as they send them.'
        : 'Write up a meeting and send it to Gabriel, Vicky and Nicole.';
      setTabs();
      setupSend();
      setupViewer();
      routeFromUrl(false);
      startPolling();
      window.addEventListener('popstate', function () {
        if (!$('viewer').hidden) closeViewer();
        var id = new URLSearchParams(location.search).get('id');
        if (id) openDetail(id, false); else show(history.state && history.state.v && history.state.v !== 'detail' ? history.state.v : (role === 'recipient' ? 'list' : 'send'));
      });
    }).catch(function (e) {
      $('loading').hidden = true;
      var b = $('view-blocked'); b.hidden = false;
      b.querySelector('.ch-empty__title').textContent = 'Couldn’t load your notes';
      b.querySelector('p').textContent = e.message + ' Check your connection and try again.';
    });
  }

  function setupSend() {
    editor = $('notes');
    draftKey = 'chowaniec_uploader_draft:' + myName;
    $('send-label').textContent = sendLabel();
    restoreDraft();
    loadMeetings();
    editor.addEventListener('input', function () { autosize(); saveDraft(); if (!$('btn-undo').hidden && beforeTidy !== null && editor.value !== aiApplied) { $('btn-undo').hidden = true; beforeTidy = null; } });
    editor.addEventListener('keydown', onKey);
    $('meeting-title').addEventListener('input', function () {
      var v = $('meeting-title').value.trim();
      if (v !== meeting.title) meeting = { title: v, eventId: null, meetingCode: null };
      syncChips(); saveDraft(); sendError('');
    });
    $('toolbar').addEventListener('click', function (e) { var b = e.target.closest('[data-fmt]'); if (b) { format(b.dataset.fmt); hap('light'); } });
    $('mode-write').addEventListener('click', function () { setMode(false); editor.focus(); });
    $('mode-preview').addEventListener('click', function () { setMode(true); });
    setupDictation();
    $('btn-tidy').addEventListener('click', tidy);
    $('ai-use').addEventListener('click', function () {
      beforeTidy = editor.value; aiApplied = aiSuggestion; editor.value = aiSuggestion; autosize(); saveDraft();
      $('ai-box').hidden = true; $('btn-undo').hidden = false; setMode(false); hap('success');
      toast('Tidied. You can undo it if you liked yours better.');
    });
    $('ai-keep').addEventListener('click', function () { $('ai-box').hidden = true; aiSuggestion = null; });
    $('btn-undo').addEventListener('click', function () { if (beforeTidy === null) return; editor.value = beforeTidy; beforeTidy = null; autosize(); saveDraft(); $('btn-undo').hidden = true; toast('Back to your version.'); });
    $('in-camera').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    $('in-gallery').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    $('btn-addtodo').addEventListener('click', function () { addTodo({}, true); });
    $('btn-send').addEventListener('click', send);
    $('done-open').addEventListener('click', function () { if (lastSentId) openDetail(lastSentId, true); });
    $('done-new').addEventListener('click', function () { show('send'); $('meeting-title').focus(); });
    $('detail-back').addEventListener('click', function () { if (history.state && history.state.v === 'detail' && history.state.from === 'list') history.back(); else { history.replaceState({ v: 'list' }, '', location.pathname); show('list'); } });
    $('confirm-delete').addEventListener('click', function () {
      var s = current; if (!s) return;
      var btn = $('confirm-delete'); btn.disabled = true;
      api(API, { action: 'delete', id: s.id }).then(function () {
        window.ChowaniecUI.sheet('#sheet-delete').close();
        items = items.filter(function (i) { return i.id !== s.id; });
        history.replaceState(null, '', location.pathname);
        show('list'); toast('Deleted.');
      }).catch(function (e) { toast(e.message, true); }).then(function () { btn.disabled = false; });
    });
    renderPhotos();
    window.addEventListener('beforeunload', function () {
      // flush a pending draft save
      if (saveTimer) { clearTimeout(saveTimer); var d = draft(); if (d.markdown.trim() || d.meeting.title || d.todos.length || d.photos.length) store(draftKey, d); }
    });
  }
  var aiApplied = null;

  var started = false;
  function go() { if (!started && window.isAppAuthorized && window.isAppAuthorized()) { started = true; start(); } }
  window.initializeProtectedContent = go;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
