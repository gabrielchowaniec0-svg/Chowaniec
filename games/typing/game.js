// Type Racer: race the family to type a passage. Every car moves along the track as its driver types.
// Mistakes turn red and must be fixed before you can go on. Score = round(WPM x accuracy x 10) plus a
// finish bonus by place (300 / 200 / 100, then 50 for finishing). Passages live in passages.js; the host
// picks easy / medium / hard (roundSetup) and the round's seed picks the passage, so everyone types the same
// one. Practice alone races a ghost car driving at your own best speed. Plugs into /games/core.js.
(function () {
  'use strict';
  const CG = window.ChowGames;
  const PASSAGES = window.TYPE_PASSAGES || { easy: ['The cat sat in the sun.'], medium: [], hard: [] };
  const LEVELS = { easy: { name: 'Easy', sub: 'Short sentences', limit: 90000 }, medium: { name: 'Medium', sub: 'Fun facts', limit: 150000 }, hard: { name: 'Hard', sub: 'Story paragraphs', limit: 240000 } };
  const BONUS = [300, 200, 100];
  const AFTER_FIRST_MS = 45000;
  const LEVEL_KEY = 'chow_typing_level';
  const BEST_KEY = 'chow_typing_best_';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  // Phones sometimes swap in curly quotes; treat them as the plain ones.
  const norm = (s) => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ');

  // ---------- DOM ----------
  let root, el = {}, canvas, g, dpr = 1, tw = 0, th = 0;
  let me = '';

  // ---------- State ----------
  let phase = 'ready';        // ready | playing | done
  let multi = false;
  let level = store.get(LEVEL_KEY) || 'easy';
  if (!LEVELS[level]) level = 'easy';
  let R = null;               // the race in progress
  let cars = new Map();       // name -> { x (shown progress), color, ... }
  let others = [], othersAt = 0;
  let confetti = [];
  let lastFrame = 0, finishTimer = null, statsAt = 0;

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function build() {
    root.innerHTML = `<div class="ty" id="ty"><div class="ty-in">
      <div class="ty-trackwrap"><canvas id="ty-track" role="img" aria-label="Race track"></canvas></div>
      <div class="ty-stats">
        <div class="ty-pill" title="Words per minute">${CG.icon('gauge', 18)}<b id="ty-wpm">0</b><small>WPM</small></div>
        <div class="ty-pill" title="Accuracy">${CG.icon('target', 18)}<b id="ty-acc">100</b><small>%</small></div>
        <div class="ty-pill ty-time" title="Time">${CG.icon('timer', 18)}<b id="ty-time">0:00</b></div>
        <div class="ty-lv" id="ty-lv"></div>
      </div>
      <div class="ty-textwrap"><div class="ty-text" id="ty-text" aria-live="off"></div>
        <button type="button" class="ty-tapfocus" id="ty-tapfocus" hidden>${CG.icon('keyboard', 20)}<span>Tap here to type</span></button></div>
      <label class="ty-inputrow"><span class="ty-sr">Type here</span>
        <input id="ty-input" class="ty-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text" enterkeyhint="next" aria-label="Type the highlighted word here" readonly></label>
      <div class="ty-hint" id="ty-hint"></div>
    </div><div class="ty-overlay" id="ty-overlay"></div></div>`;
    el = {
      ty: root.querySelector('#ty'), track: root.querySelector('.ty-trackwrap'), wpm: root.querySelector('#ty-wpm'), acc: root.querySelector('#ty-acc'),
      time: root.querySelector('#ty-time'), lv: root.querySelector('#ty-lv'), text: root.querySelector('#ty-text'), input: root.querySelector('#ty-input'),
      hint: root.querySelector('#ty-hint'), overlay: root.querySelector('#ty-overlay'), tap: root.querySelector('#ty-tapfocus'), textwrap: root.querySelector('.ty-textwrap')
    };
    canvas = root.querySelector('#ty-track');
    g = canvas.getContext('2d');
    el.input.addEventListener('input', onInput);
    el.input.addEventListener('paste', (e) => e.preventDefault());
    el.input.addEventListener('drop', (e) => e.preventDefault());
    el.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    el.input.addEventListener('blur', () => setTimeout(updateFocusHint, 50));
    el.input.addEventListener('focus', updateFocusHint);
    el.tap.addEventListener('click', () => { el.input.focus(); });
    el.textwrap.addEventListener('pointerdown', (e) => { if (phase === 'playing' && !e.target.closest('button')) { e.preventDefault(); el.input.focus(); } });
    el.overlay.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      CG.sfx('click');
      if (b.dataset.act === 'family') CG.openLobby();
      if (b.dataset.act === 'solo') startSolo(b.dataset.lv);
    });
  }

  // ---------- Layout ----------
  function lanes() { return multi ? Math.max(1, (CG.session() ? CG.session().players.length : 1)) : (R && R.ghostWpm ? 2 : 1); }
  function layout() {
    if (!el.ty) return;
    // keep everything above the phone keyboard
    const vv = window.visualViewport;
    if (vv) {
      const top = el.ty.getBoundingClientRect().top;
      const avail = vv.height + vv.offsetTop - top;
      el.ty.style.height = avail > 120 && avail < root.clientHeight - 4 ? Math.round(avail) + 'px' : '';
    }
    const w = el.track.clientWidth;
    const n = lanes();
    const tight = el.ty.clientHeight < 460;
    const laneH = clamp(Math.round(w / (n > 4 ? 22 : 15)), tight ? 20 : 26, n > 4 ? 34 : 46);
    const h = laneH * n + (tight ? 14 : 22);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    tw = w; th = h;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    el.ty.classList.toggle('tight', tight);
  }

  // ---------- Race ----------
  function newRace(text, lv, startAt) {
    R = {
      text, words: text.split(' '), wi: 0, done: 0, value: '', keys: 0, errors: 0, level: lv,
      startAt: startAt || 0, finishAt: 0, place: 0, score: 0, wpm: 0, acc: 100, limit: LEVELS[lv].limit,
      ghostWpm: multi ? 0 : Number(store.get(BEST_KEY + lv + '_' + me)) || 0, combo: 0
    };
    cars = new Map();
    confetti = [];
    el.input.value = '';
    el.lv.textContent = LEVELS[lv].name;
    renderText();
    updateStats();
  }
  const target = () => R.words[R.wi] + (R.wi < R.words.length - 1 ? ' ' : '');
  const same = (a, b) => (R.level === 'easy' ? a.toLowerCase() === b.toLowerCase() : a === b);
  function goodPrefix(v, t) { let i = 0; while (i < v.length && i < t.length && same(v[i], t[i])) i++; return i; }
  const progressChars = () => (R ? R.done + Math.min(goodPrefix(R.value, target()), target().length) : 0);
  const progress = () => (R ? (R.finishAt ? 1 : clamp(progressChars() / R.text.length, 0, 1)) : 0);
  const elapsed = () => (R && R.startAt ? (R.finishAt || Date.now()) - R.startAt : 0);
  function liveWpm() {
    const ms = elapsed();
    if (ms < 1500) return 0;
    return Math.round((progressChars() / 5) / (ms / 60000));
  }
  const accuracy = () => (R && R.keys ? Math.round(((R.keys - R.errors) / R.keys) * 100) : 100);

  function onInput() {
    if (phase !== 'playing' || !R || R.finishAt) { el.input.value = ''; return; }
    if (!R.startAt) R.startAt = Date.now();     // practice: the clock starts with your first key
    let v = norm(el.input.value);
    const t = target();
    if (v.length > t.length + 12) { v = v.slice(0, t.length + 12); el.input.value = v; }
    const prev = R.value;
    if (v.length > prev.length && v.startsWith(prev)) {
      for (let i = prev.length; i < v.length; i++) {
        R.keys++;
        const ok = goodPrefix(v.slice(0, i + 1), t) === i + 1;
        if (!ok) { R.errors++; if (goodPrefix(prev, t) === prev.length && i === prev.length) { CG.sfx('wrong'); el.input.classList.remove('shake'); void el.input.offsetWidth; el.input.classList.add('shake'); } }
      }
    } else if (v.length > prev.length) {
      // the phone replaced the whole word (autocomplete): count the new letters once
      R.keys += v.length;
      R.errors += v.length - goodPrefix(v, t);
    }
    R.value = v;
    const last = R.wi === R.words.length - 1;
    if ((last && same(v, R.words[R.wi])) || (!last && v.length === t.length && goodPrefix(v, t) === t.length)) {
      R.done += t.length;
      R.wi++;
      R.value = '';
      el.input.value = '';
      CG.sfx(last ? 'win' : 'tick');
      if (last) { finish(true); return; }
    }
    renderText();
    updateStats();
    pushState();
  }

  function renderText() {
    if (!R) { el.text.innerHTML = ''; return; }
    const parts = [];
    R.words.forEach((w, i) => {
      if (i < R.wi) parts.push(`<span class="w done">${esc(w)}</span>`);
      else if (i === R.wi && !R.finishAt) {
        const t = w;
        const v = R.value;
        const good = goodPrefix(v, t + ' ');
        let html = '';
        for (let k = 0; k < t.length; k++) {
          const cls = k < v.length ? (k < good ? 'ok' : 'bad') : '';
          html += `${k === v.length ? '<i class="caret"></i>' : ''}<span class="${cls}">${esc(t[k])}</span>`;
        }
        if (v.length > t.length) html += `<span class="bad extra">${esc(v.slice(t.length)).replace(/ /g, '&middot;')}</span>`;
        if (v.length >= t.length) html += '<i class="caret"></i>';
        parts.push(`<span class="w cur${v.length > good ? ' wrong' : ''}">${html}</span>`);
      } else parts.push(`<span class="w">${esc(w)}</span>`);
    });
    el.text.innerHTML = parts.join(' ');
    el.input.classList.toggle('wrong', !!R.value && goodPrefix(R.value, target()) < R.value.length);
    const cur = el.text.querySelector('.cur');
    if (cur) {
      const box = el.text;
      const top = cur.offsetTop - box.offsetTop;
      if (top < box.scrollTop + 4 || top > box.scrollTop + box.clientHeight - cur.offsetHeight * 2) box.scrollTop = Math.max(0, top - cur.offsetHeight * 0.6);
    }
  }

  function updateStats() {
    if (!R) return;
    R.wpm = liveWpm(); R.acc = accuracy();
    el.wpm.textContent = R.wpm;
    el.acc.textContent = R.acc;
    const left = deadline() - Date.now();
    const ms = phase === 'playing' && R.startAt && left < 30000 ? Math.max(0, left) : elapsed();
    const s = Math.floor(ms / 1000);
    el.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.time.parentNode.classList.toggle('warn', phase === 'playing' && !!R.startAt && left < 30000);
  }

  // The round ends at the time limit, or 45 seconds after the first person finishes.
  function deadline() {
    if (!R || !R.startAt) return Infinity;
    let end = R.startAt + R.limit;
    if (multi) {
      let first = R.finishAt ? R.finishAt - R.startAt : Infinity;
      for (const o of others) if (o.state && Number(o.state.ft) > 0) first = Math.min(first, Number(o.state.ft));
      if (first < Infinity) end = Math.min(end, R.startAt + first + AFTER_FIRST_MS);
    }
    return end;
  }

  function raceState(extra) {
    return Object.assign({ score: R.score || Math.round(R.wpm * (R.acc / 100) * 10), alive: true, p: Math.round(progress() * 1000) / 1000, wpm: R.wpm, acc: R.acc, ft: R.finishAt ? R.finishAt - R.startAt : 0, detail: `${R.wpm} WPM · ${R.acc}%` }, extra || {});
  }
  let pushAt = 0;
  function pushState(force) {
    if (!multi || !R || phase !== 'playing') return;
    const t = performance.now();
    if (!force && t - pushAt < 100) return;
    pushAt = t;
    CG.race.update(raceState());
  }

  function finish(completed) {
    if (!R || R.finishAt || phase !== 'playing') return;
    R.finishAt = Date.now();
    R.completed = completed;
    R.wpm = completed ? Math.round((R.text.length / 5) / ((R.finishAt - R.startAt) / 60000)) : liveWpm();
    R.acc = accuracy();
    const base = Math.round(R.wpm * (R.acc / 100) * 10);
    el.input.value = ''; el.input.blur(); el.input.readOnly = true;
    renderText(); updateStats();
    if (completed) {
      for (let i = 0; i < 60; i++) confetti.push({ x: tw - 30, y: th / 2, vx: -Math.random() * 6, vy: (Math.random() - 0.5) * 6, c: ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'][i % 5], life: 1.4, r: 2 + Math.random() * 2 });
    }
    if (!multi) {
      phase = 'done';
      R.score = base;
      const best = Number(store.get(BEST_KEY + R.level + '_' + me)) || 0;
      const isBest = completed && R.wpm > best;
      if (isBest) store.set(BEST_KEY + R.level + '_' + me, String(R.wpm));
      el.hint.innerHTML = completed ? `${CG.icon('flag', 16)} Finished!` : `${CG.icon('timer', 16)} Time is up`;
      clearTimeout(finishTimer);
      finishTimer = setTimeout(() => {
        CG.gameOver({ score: base, title: completed ? `${R.wpm} WPM${isBest ? ', your best yet!' : '!'}` : 'Time is up!', again: () => startSolo(R.level) });
      }, 900);
      return;
    }
    R.score = base;
    CG.race.update(raceState({ score: base }));
    el.hint.innerHTML = completed ? `${CG.icon('flag', 16)} Finished! Waiting for the others…` : `${CG.icon('timer', 16)} Time is up`;
    // give the others' latest finish times a moment to arrive, then work out the place
    clearTimeout(finishTimer);
    finishTimer = setTimeout(() => {
      others = CG.race.others();
      const myFt = R.finishAt - R.startAt;
      let place = 1;
      if (completed) {
        for (const o of others) { const ft = Number(o.state && o.state.ft) || 0; if (ft > 0 && (ft < myFt || (ft === myFt && o.name < me))) place++; }
        R.place = place;
        R.score = base + (BONUS[place - 1] || 50);
      }
      phase = 'done';
      el.hint.innerHTML = completed ? `${CG.icon('flag', 16)} You finished ${ordinal(place)}!` : `${CG.icon('timer', 16)} Time is up`;
      CG.race.update(raceState(Object.assign({ score: R.score, alive: false }, completed ? { place } : { detail: `${R.wpm} WPM · ${R.acc}% · did not finish` })));
      CG.gameOver({ score: R.score });
    }, 900);
  }

  // ---------- Track ----------
  function carShape(x, y, s, color, ghost) {
    g.save();
    g.translate(x, y);
    g.globalAlpha = ghost ? 0.45 : 1;
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.beginPath(); g.ellipse(0, s * 0.42, s * 0.95, s * 0.12, 0, 0, Math.PI * 2); g.fill();
    // body
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-s * 0.95, s * 0.25);
    g.lineTo(-s * 0.95, -s * 0.05);
    g.quadraticCurveTo(-s * 0.9, -s * 0.2, -s * 0.6, -s * 0.22);
    g.lineTo(-s * 0.35, -s * 0.5);
    g.quadraticCurveTo(-s * 0.25, -s * 0.58, s * 0.05, -s * 0.58);
    g.lineTo(s * 0.3, -s * 0.58);
    g.quadraticCurveTo(s * 0.45, -s * 0.56, s * 0.55, -s * 0.24);
    g.quadraticCurveTo(s * 0.92, -s * 0.18, s, s * 0.02);
    g.lineTo(s, s * 0.25);
    g.closePath(); g.fill();
    // window
    g.fillStyle = ghost ? 'rgba(255,255,255,.6)' : '#dbeafe';
    g.beginPath();
    g.moveTo(-s * 0.28, -s * 0.24); g.lineTo(-s * 0.14, -s * 0.47); g.lineTo(s * 0.25, -s * 0.47); g.lineTo(s * 0.4, -s * 0.24); g.closePath(); g.fill();
    g.fillStyle = color; g.fillRect(s * 0.04, -s * 0.48, s * 0.06, s * 0.26);
    // stripe and light
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(-s * 0.8, -s * 0.02, s * 1.6, s * 0.07);
    g.fillStyle = '#fde68a'; g.beginPath(); g.arc(s * 0.93, -s * 0.02, s * 0.07, 0, Math.PI * 2); g.fill();
    // wheels
    for (const wx of [-s * 0.55, s * 0.55]) {
      g.fillStyle = '#1f2937'; g.beginPath(); g.arc(wx, s * 0.27, s * 0.22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d1d5db'; g.beginPath(); g.arc(wx, s * 0.27, s * 0.09, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  function drawTrack(now, dt) {
    if (!tw) return;
    const dark = isDark();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, tw, th);
    const rows = trackRows();
    const n = Math.max(1, rows.length);
    const pad = th > 120 ? 11 : 7;
    const laneH = (th - pad * 2) / n;
    const startX = 14, finishX = tw - 40;
    // grass edges and road
    g.fillStyle = dark ? '#14532d' : '#86efac';
    g.fillRect(0, 0, tw, th);
    g.fillStyle = dark ? '#1f2937' : '#475569';
    g.fillRect(0, pad, tw, th - pad * 2);
    g.fillStyle = dark ? '#e5e7eb' : '#f8fafc';
    g.fillRect(0, pad - 2, tw, 2); g.fillRect(0, th - pad, tw, 2);
    // lane dashes, moving gently
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.setLineDash([12, 10]);
    g.lineDashOffset = -(now / 40) % 22;
    for (let i = 1; i < n; i++) { const y = pad + laneH * i; g.beginPath(); g.moveTo(startX, y); g.lineTo(finishX, y); g.stroke(); }
    g.setLineDash([]);
    // start line and chequered finish
    g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(startX + 34, pad, 3, th - pad * 2);
    const sq = Math.max(4, Math.min(8, (th - pad * 2) / 10));
    for (let y = pad, r = 0; y < th - pad; y += sq, r++) for (let c = 0; c < 2; c++) { g.fillStyle = (r + c) % 2 ? '#111827' : '#ffffff'; g.fillRect(finishX + c * sq, y, sq, Math.min(sq, th - pad - y)); }
    // flag on a pole
    const fx = finishX + sq * 2 + 4;
    g.fillStyle = dark ? '#d1d5db' : '#374151'; g.fillRect(fx, 2, 2, th - 4);
    const wave = Math.sin(now / 180) * 2;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { g.fillStyle = (r + c) % 2 ? '#111827' : '#fff'; g.fillRect(fx + 2 + c * 4, 3 + r * 4 + (c % 2 ? wave * 0.4 : 0), 4, 4); }

    const s = clamp(laneH * 0.42, 9, 20);
    rows.forEach((r, i) => {
      const car = cars.get(r.key) || { x: 0 };
      car.x += (r.p - car.x) * Math.min(1, dt / (r.me ? 90 : 260));
      if (Math.abs(r.p - car.x) < 0.0005) car.x = r.p;
      cars.set(r.key, car);
      const cy = pad + laneH * (i + 0.5);
      const cx = startX + s + car.x * (finishX - startX - s * 2.2);
      carShape(cx, cy, s, r.color, r.ghost);
      // label behind the car
      const fs = clamp(laneH * 0.36, 9, 13);
      g.font = `700 ${fs}px Outfit, system-ui, sans-serif`;
      g.textBaseline = 'middle';
      const label = r.name + (r.wpm ? `  ${r.wpm}` : '');
      const lw = g.measureText(label).width;
      const lx = cx - s * 1.15 - lw - 6;
      const tx = lx < startX ? cx + s * 1.2 + 4 : lx;
      g.globalAlpha = r.ghost ? 0.7 : 1;
      g.fillStyle = 'rgba(0,0,0,.45)';
      if (g.roundRect) { g.beginPath(); g.roundRect(tx - 4, cy - fs * 0.7, lw + 8, fs * 1.4, fs * 0.7); g.fill(); } else g.fillRect(tx - 4, cy - fs * 0.7, lw + 8, fs * 1.4);
      g.fillStyle = r.me ? '#fde047' : '#fff';
      g.fillText(label, tx, cy + 0.5);
      g.globalAlpha = 1;
      if (r.place) {
        g.fillStyle = r.place === 1 ? '#f59e0b' : r.place === 2 ? '#94a3b8' : r.place === 3 ? '#c2410c' : '#64748b';
        g.beginPath(); g.arc(finishX - s * 1.9, cy - s * 0.65, fs * 0.75, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `800 ${fs * 0.95}px Outfit, system-ui, sans-serif`;
        g.fillText(String(r.place), finishX - s * 1.9, cy - s * 0.65 + 0.5); g.textAlign = 'left';
      }
    });
    // confetti at the finish
    const f = dt / 16.7;
    for (const c of confetti) {
      c.life -= 0.015 * f; c.x += c.vx * f; c.y += c.vy * f; c.vy += 0.1 * f;
      g.globalAlpha = clamp(c.life, 0, 1); g.fillStyle = c.c; g.fillRect(c.x, c.y, c.r * 2, c.r);
    }
    g.globalAlpha = 1;
    confetti = confetti.filter((c) => c.life > 0);
  }

  // Everyone on the track: the players in a race, or you and your ghost in practice.
  function trackRows() {
    if (!R) return [];
    if (!multi) {
      const rows = [{ key: 'me', name: 'You', color: '#3b82f6', p: progress(), wpm: R.wpm, me: true }];
      const gp = R.ghostWpm && R.startAt ? clamp((R.ghostWpm * 5 / 60000) * elapsed() / R.text.length, 0, 1) : 0;
      if (R.ghostWpm) rows.push({ key: 'ghost', name: `Your best ${R.ghostWpm}`, color: '#a855f7', p: gp, ghost: true, wpm: 0 });
      return rows;
    }
    const sess = CG.session();
    const names = sess ? sess.players : [me];
    const map = new Map(others.map((o) => [o.name, o]));
    const finishers = [];
    const rows = names.map((name, i) => {
      if (name === me) return { key: name, name, color: CG.colors[i % CG.colors.length], p: progress(), wpm: R.wpm, me: true, ft: R.finishAt ? R.finishAt - R.startAt : 0 };
      const o = map.get(name);
      const st = (o && o.state) || {};
      return { key: name, name, color: (o && o.color) || CG.colors[i % CG.colors.length], p: clamp(Number(st.p) || 0, 0, 1), wpm: Number(st.wpm) || 0, ft: Number(st.ft) || 0 };
    });
    rows.forEach((r) => { if (r.ft > 0) finishers.push(r); });
    finishers.sort((a, b) => a.ft - b.ft || (a.name < b.name ? -1 : 1)).forEach((r, i) => { r.place = i + 1; });
    return rows;
  }

  // ---------- Overlays ----------
  function renderOverlay() {
    const o = el.overlay;
    if (phase !== 'ready') { o.innerHTML = ''; o.className = 'ty-overlay'; return; }
    const lv = (k) => `<button type="button" class="ty-lvbtn${k === level ? ' on' : ''}" data-act="solo" data-lv="${k}"><b>${LEVELS[k].name}</b><small>${LEVELS[k].sub}</small></button>`;
    o.innerHTML = `<div class="ty-card"><div class="ty-logo">${CG.badge('typing', 52)}</div><h2>Type Racer</h2>
      <p>Type the passage as fast as you can. Every word you get right moves your car closer to the flag.</p>
      <button type="button" class="ty-btn primary" data-act="family">${CG.icon('users', 22)}<span>Play with the family</span></button>
      <p class="ty-note">Everyone types the same passage at the same time. Fastest and most accurate wins!</p>
      <h3>${CG.icon('car', 16)} Practice alone against your best</h3>
      <div class="ty-lvrow">${lv('easy')}${lv('medium')}${lv('hard')}</div></div>`;
    o.className = 'ty-overlay show';
  }

  function updateFocusHint() {
    const need = phase === 'playing' && R && !R.finishAt && document.activeElement !== el.input && !CG.modalOpen();
    el.tap.hidden = !need;
  }

  function pickText(lv, rnd) {
    const list = PASSAGES[lv] && PASSAGES[lv].length ? PASSAGES[lv] : PASSAGES.easy;
    return list[Math.floor(rnd() * list.length) % list.length];
  }

  function startSolo(lv) {
    if (multi) return;
    clearTimeout(finishTimer);
    level = LEVELS[lv] ? lv : level;
    store.set(LEVEL_KEY, level);
    CG.closeModal();
    newRace(pickText(level, Math.random), level, 0);
    phase = 'playing';
    el.input.readOnly = false;
    el.input.focus();
    renderOverlay();
    el.hint.innerHTML = R.ghostWpm ? `Beat your best: <b>${R.ghostWpm} WPM</b>. The clock starts when you type.` : 'The clock starts when you type the first letter.';
    layout();
    updateFocusHint();
  }
  function toReady() {
    clearTimeout(finishTimer);
    phase = 'ready';
    R = null;
    el.input.readOnly = true;
    el.input.value = '';
    el.hint.textContent = '';
    newRace(pickText(level, Math.random), level, 0);
    renderOverlay();
    layout();
    updateFocusHint();
  }

  // ---------- Loop ----------
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(60, now - (lastFrame || now));
    lastFrame = now;
    if (multi && now - othersAt > 150) { othersAt = now; others = CG.race.others(); }
    if (phase === 'playing' && R) {
      if (R.startAt && Date.now() >= deadline()) finish(false);
      if (now - statsAt > 200) { statsAt = now; updateStats(); }
      pushState(false);
    }
    drawTrack(now, dt);
  }

  // ---------- Boot ----------
  CG.mount({
    id: 'typing', title: 'Type Racer', mode: 'race', scoreLabel: 'points', syncMs: 300,
    help: '<ul><li>Type the highlighted word, then press <b>space</b>. Your car drives forward with every word.</li>' +
      '<li>A wrong letter turns <b>red</b>. Delete it and type the right one before you can go on.</li>' +
      '<li>On a phone, tap the passage to bring up the keyboard.</li>' +
      '<li><b>WPM</b> is words per minute (five letters count as one word). <b>Accuracy</b> is how many of your key presses were right.</li>' +
      '<li>Score = WPM × accuracy × 10, plus a finish bonus: 300 for 1st, 200 for 2nd, 100 for 3rd and 50 for everyone else who finishes.</li>' +
      '<li>Easy passages do not mind capital letters. Medium and Hard ones do.</li>' +
      `<li><b>${CG.icon('users', 17)} Play with the family:</b> the host picks Easy, Medium or Hard and everyone gets the same passage. After the first car finishes, the others have 45 seconds left.</li>` +
      '<li>Practice alone races a see-through ghost car that drives at your best speed.</li></ul>',
    roundSetup() {
      return new Promise((resolve) => {
        const lv = (k) => `<button type="button" class="ty-lvbtn${k === level ? ' on' : ''}" data-lv="${k}"><b>${LEVELS[k].name}</b><small>${LEVELS[k].sub}</small></button>`;
        let done = false;
        const card = CG.modal(`<div class="cg-hero plain">${CG.badge('typing', 48)}</div><h2>Pick the passage</h2><p class="cg-sub">Everyone types the same one</p>` +
          `<div class="ty-lvrow">${lv('easy')}${lv('medium')}${lv('hard')}</div><div class="cg-row"><button type="button" data-cg="close">Cancel</button></div>`, {
          onClose: () => { if (!done) { done = true; resolve(null); setTimeout(() => CG.openLobby(), 0); } }
        });
        card.addEventListener('click', (e) => {
          const b = e.target.closest('[data-lv]');
          if (!b || done) return;
          done = true;
          level = b.dataset.lv;
          store.set(LEVEL_KEY, level);
          CG.closeModal();
          resolve({ level });
        });
      });
    },
    onReady(ctx) {
      root = ctx.root; me = ctx.user || CG.me();
      document.body.classList.add('ty-page');
      build();
      new ResizeObserver(() => layout()).observe(el.track);
      window.addEventListener('resize', layout);
      if (window.visualViewport) { window.visualViewport.addEventListener('resize', layout); window.visualViewport.addEventListener('scroll', layout); }
      toReady();
      new MutationObserver(updateFocusHint).observe(document.body, { childList: true });
      requestAnimationFrame(frame);
    }
  });

  CG.on('multiStart', (info) => {
    clearTimeout(finishTimer);
    multi = true;
    me = info.me || CG.me();
    const lv = info.shared && LEVELS[info.shared.level] ? info.shared.level : 'easy';
    newRace(pickText(lv, CG.rng(info.seed)), lv, info.startAt || Date.now());
    others = [];
    phase = 'playing';
    el.input.readOnly = false;
    el.input.value = '';
    renderOverlay();
    el.hint.innerHTML = `${CG.icon('flag', 16)} Go! Type the highlighted word.`;
    layout();
    el.input.focus();
    updateFocusHint();
    CG.race.update(raceState());
  });
  CG.on('multiEnd', () => { multi = false; others = []; toReady(); });

  // For tests and curious grown-ups: a read-only peek at the race.
  window.TypeRacer = {
    state: () => R && ({ phase, multi, text: R.text, level: R.level, wi: R.wi, words: R.words.length, value: R.value, progress: progress(), wpm: R.wpm, acc: R.acc, keys: R.keys, errors: R.errors, finished: !!R.finishAt, place: R.place, score: R.score, ghostWpm: R.ghostWpm }),
    cars: () => [...cars.entries()].map(([k, c]) => ({ name: k, x: c.x }))
  };
})();
