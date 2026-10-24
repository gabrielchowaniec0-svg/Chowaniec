// Block Drop: an original falling-blocks puzzle. A 10 x 20 well, seven four-square shapes from a seeded
// "bag" (every shape once per seven, shuffled), hold, a three-piece preview, ghost piece, rotation with wall
// kicks, soft and hard drops, lock delay, combos and levels. Plugs into /games/core.js (see games/README.md).
//
// Versus (Play with the family): everyone gets the same pieces from the round's seed. Clearing 2 / 3 / 4
// rows at once sends 1 / 2 / 4 grey rows to the opponent with the most points who is still playing (rows
// you clear first cancel rows that are on their way to you). Garbage travels inside the race states: each
// player's state holds `sent` = { name: total rows sent so far }, and each receiver adds the new rows on its
// next lock, with the gap column picked by its own seeded generator. States also carry a 200-character
// snapshot of the well (`w`) so everyone sees small live copies of the other wells. Last one standing wins.
(function () {
  'use strict';
  const CG = window.ChowGames;
  const COLS = 10, ROWS = 22, HIDDEN = 2, VIS = ROWS - HIDDEN;
  const LOCK_MS = 500, MAX_RESETS = 15, CLEAR_MS = 380, DAS = 150, ARR = 45, SOFT_MS = 32;
  const COLORS = { I: '#22d3ee', J: '#3b82f6', L: '#fb923c', O: '#facc15', S: '#4ade80', T: '#c084fc', Z: '#f87171', G: '#94a3b8' };
  const SHAPES = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]],
    O: [[1, 0], [2, 0], [1, 1], [2, 1]], S: [[1, 0], [2, 0], [0, 1], [1, 1]], T: [[1, 0], [0, 1], [1, 1], [2, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]]
  };
  const ROT = {};
  for (const t of 'IJLOSTZ') {
    const n = t === 'I' || t === 'O' ? 4 : 3;
    let s = SHAPES[t];
    ROT[t] = [s];
    for (let i = 1; i < 4; i++) { if (t !== 'O') s = s.map(([x, y]) => [n - 1 - y, x]); ROT[t].push(s); }
  }
  // Wall kicks (x right, y UP, as they are usually written). Tried in order until one fits.
  const KICK = {
    '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  };
  const KICK_I = {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  };
  const CLEAR_NAMES = ['', 'Single', 'Double', 'Triple', 'Four lines!'];
  const ATTACK = [0, 0, 1, 2, 4];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const coarse = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  // ---------- DOM ----------
  let root, wrap, canvas, g, holdBtn, overlay;
  let dpr = 1, cw = 0, ch = 0, cell = 24;
  const L = {};
  let pal = null;
  const sprites = new Map();

  // ---------- State ----------
  let S = null;
  let phase = 'ready';      // ready | playing | paused | over
  let multi = false;
  let me = '';
  let particles = [], floaters = [], flyers = [];
  let shake = 0, lastFrame = 0;
  let others = [], othersAt = 0, pushAt = 0, winAt = 0;
  let endTimer = null;
  const keys = { das: 0, dasT0: 0, dasLast: 0, soft: false };

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function palette() {
    const dark = isDark();
    return dark
      ? { dark, panel: 'rgba(255,255,255,.06)', panelLine: 'rgba(255,255,255,.08)', ink: '#f4f4f5', muted: '#a1a1aa', well: '#12152b', wellLine: 'rgba(255,255,255,.045)', frame: '#2c2f57', ghost: 'rgba(255,255,255,.16)' }
      : { dark, panel: 'rgba(255,255,255,.78)', panelLine: 'rgba(60,40,120,.08)', ink: '#1e1b4b', muted: '#6b6b8a', well: '#1b1f3f', wellLine: 'rgba(255,255,255,.05)', frame: '#3b3f7a', ghost: 'rgba(255,255,255,.2)' };
  }

  function build() {
    root.innerHTML = `<div class="bd" id="bd"><canvas id="bd-canvas" role="img" aria-label="Block Drop well"></canvas>
      <button type="button" class="bd-hold" id="bd-hold" aria-label="Hold piece"></button>
      <div class="bd-overlay" id="bd-overlay"></div></div>`;
    wrap = root.querySelector('#bd');
    canvas = root.querySelector('#bd-canvas');
    g = canvas.getContext('2d');
    holdBtn = root.querySelector('#bd-hold');
    overlay = root.querySelector('#bd-overlay');
    holdBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (!CG.modalOpen()) doHold(); });
    holdBtn.addEventListener('click', (e) => e.preventDefault());
    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      CG.sfx('click');
      if (b.dataset.act === 'family') CG.openLobby();
      if (b.dataset.act === 'solo') startSolo();
      if (b.dataset.act === 'resume') resume();
    });
  }

  // ---------- Layout ----------
  function layout() {
    if (!wrap) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cw = w; ch = h;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const pad = 10;
    L.portrait = w < 640 && h > w * 1.25;
    if (L.portrait) {
      // tall phone: a big well on the left, one column (hold, next, score, the others) on the right
      const sideC = 3.3, gapC = 0.4;
      cell = clamp(Math.floor(Math.min((w - 2 * pad - 8) / (COLS + sideC + gapC), (h - 2 * pad) / VIS)), 8, 40);
      L.wellW = cell * COLS; L.wellH = cell * VIS;
      L.gap = Math.max(8, Math.round(cell * gapC));
      L.sideW = Math.floor(Math.min(w - 2 * pad - 8 - L.wellW - L.gap, cell * 4.4));
      L.wellX = Math.round((w - (L.wellW + L.gap + L.sideW)) / 2) + 2;
      L.wellY = Math.round(Math.max(pad, (h - L.wellH) / 2));
      L.sideX = L.wellX + L.wellW + L.gap;
    } else {
      const narrow = w < 640;
      const sideC = narrow ? 3.5 : 5, gapC = 0.45;
      cell = clamp(Math.floor(Math.min((w - 2 * pad) / (COLS + 2 * sideC + 2 * gapC), (h - 2 * pad) / VIS)), 8, 40);
      L.wellW = cell * COLS; L.wellH = cell * VIS;
      L.wellX = Math.round((w - L.wellW) / 2);
      L.wellY = Math.round(Math.max(pad, (h - L.wellH) / 2));
      L.gap = Math.max(6, Math.round(cell * gapC));
      L.sideW = Math.floor(Math.min(L.wellX - L.gap - pad + 4, cell * (narrow ? 4.2 : 5.2)));
      L.sideX = L.wellX + L.wellW + L.gap;
    }
    L.pc = Math.floor(Math.min(cell * 0.72, (L.sideW - 10) / 4.3));
    L.fs = clamp(Math.round(cell * 0.5), 10, 16);
    L.label = Math.round(L.fs * 1.7);
    const slot = Math.round(L.pc * (L.portrait ? 2.5 : 2.8));
    L.slot = slot;
    const hold = { x: L.portrait ? L.sideX : L.wellX - L.gap - L.sideW, y: L.wellY, w: L.sideW, h: L.label + slot };
    const next = { x: L.sideX, y: L.portrait ? hold.y + hold.h + Math.round(L.gap * 0.7) : L.wellY, w: L.sideW, h: L.label + slot * 3 };
    L.hold = hold; L.next = next;
    L.statsY = next.y + next.h + Math.round(L.gap * 0.7);
    L.statH = Math.round(L.fs * (L.portrait ? 2.7 : 3.2));
    L.leftX = hold.x;
    Object.assign(holdBtn.style, { left: hold.x + 'px', top: hold.y + 'px', width: hold.w + 'px', height: hold.h + 'px' });
    pal = palette();
    sprites.clear();
  }

  // A rounded, glossy block, drawn once per colour and size.
  function sprite(color, size) {
    const key = color + size;
    let c = sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const px = Math.max(1, Math.round(size * dpr));
    c.width = px; c.height = px;
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    const r = Math.max(1.5, size * 0.2), i = Math.max(0.5, size * 0.05);
    const rr = (x0, y0, w, h, rad) => { x.beginPath(); x.roundRect ? x.roundRect(x0, y0, w, h, rad) : x.rect(x0, y0, w, h); };
    rr(i, i, size - 2 * i, size - 2 * i, r); x.fillStyle = shade(color, -0.22); x.fill();
    rr(i, i, size - 2 * i, size - 2 * i - size * 0.1, r); x.fillStyle = color; x.fill();
    const gr = x.createLinearGradient(0, i, 0, size * 0.55);
    gr.addColorStop(0, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    rr(i + size * 0.08, i + size * 0.06, size - 2 * i - size * 0.16, size * 0.4, r * 0.7); x.fillStyle = gr; x.fill();
    x.fillStyle = 'rgba(255,255,255,.75)';
    x.beginPath(); x.arc(size * 0.27, size * 0.27, size * 0.07, 0, Math.PI * 2); x.fill();
    sprites.set(key, c);
    return c;
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
    return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  // ---------- Game ----------
  function makeBag(rnd) {
    const b = 'IJLOSTZ'.split('');
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; }
    return b;
  }
  function newGame(seed) {
    S = {
      seed, rnd: CG.rng(seed), grng: CG.rng(((seed ^ 0x5bd1e995) >>> 0) || 7),
      board: new Array(COLS * ROWS).fill(0), queue: [], cur: null, hold: null, canHold: true,
      score: 0, lines: 0, level: 1, combo: -1, b2b: false, fall: 0, lockT: 0, resets: 0, lowest: 0,
      clearing: null, pending: [], sent: {}, recv: {}, totalSent: 0, totalGot: 0, over: false, won: false, overAt: 0, koAt: 0,
      pieces: 0, place: 0, rise: null, startAt: Date.now(), shownScore: 0, order: []
    };
    particles = []; floaters = []; flyers = []; shake = 0;
    refill();
    spawn();
  }
  function refill() { while (S.queue.length < 7) { const b = makeBag(S.rnd); S.order.push(...b); S.queue.push(...b); } }
  const at = (x, y) => S.board[y * COLS + x];
  function fits(t, r, x, y) {
    for (const [cx, cy] of ROT[t][r]) {
      const X = x + cx, Y = y + cy;
      if (X < 0 || X >= COLS || Y >= ROWS) return false;
      if (Y >= 0 && S.board[Y * COLS + X]) return false;
    }
    return true;
  }
  const onGround = () => !!S.cur && !fits(S.cur.t, S.cur.r, S.cur.x, S.cur.y + 1);
  const gravMs = () => Math.max(16, Math.pow(0.8 - (S.level - 1) * 0.007, S.level - 1) * 1000);

  function spawn(type) {
    const t = type || S.queue.shift();
    refill();
    const p = { t, r: 0, x: 3, y: 0, born: performance.now() };
    if (!fits(p.t, p.r, p.x, p.y)) { S.cur = null; topOut(); return false; }
    if (fits(p.t, p.r, p.x, p.y + 1)) p.y++;
    S.cur = p; S.fall = 0; S.lockT = 0; S.resets = 0; S.lowest = p.y;
    return true;
  }
  function touched() {   // a move or turn on the floor buys a little more time, up to 15 times
    if (onGround() && S.resets < MAX_RESETS) { S.lockT = 0; S.resets++; }
  }
  function tryMove(dx) {
    const c = S.cur;
    if (!c || !fits(c.t, c.r, c.x + dx, c.y)) return false;
    c.x += dx; touched();
    return true;
  }
  function stepDown(soft) {
    const c = S.cur;
    if (!c || !fits(c.t, c.r, c.x, c.y + 1)) return false;
    c.y++;
    if (soft) S.score += 1;
    if (c.y > S.lowest) { S.lowest = c.y; S.resets = 0; S.lockT = 0; }
    return true;
  }
  function rotate(dir) {
    const c = S.cur;
    if (!c) return false;
    if (c.t === 'O') { CG.sfx('click'); return true; }
    const to = (c.r + dir + 4) % 4;
    const table = (c.t === 'I' ? KICK_I : KICK)['' + c.r + to];
    for (const [kx, ky] of table) {
      if (fits(c.t, to, c.x + kx, c.y - ky)) {
        c.x += kx; c.y -= ky; c.r = to;
        if (c.y > S.lowest) { S.lowest = c.y; S.resets = 0; }
        touched();
        CG.sfx('flip');
        return true;
      }
    }
    return false;
  }
  function dropY(c) { let y = c.y; while (fits(c.t, c.r, c.x, y + 1)) y++; return y; }
  function hardDrop() {
    const c = S.cur;
    if (!c) return;
    const gy = dropY(c), d = gy - c.y;
    S.score += 2 * d;
    if (d > 0) flyers.push({ t: c.t, r: c.r, x: c.x, y0: c.y, y1: gy, life: 1 });
    c.y = gy;
    shake = Math.max(shake, 0.5);
    lock(true);
  }
  function doHold() {
    if (phase !== 'playing' || !S || !S.cur || !S.canHold || S.over) return;
    const t = S.cur.t;
    S.canHold = false;
    CG.sfx('whoosh');
    if (S.hold) { const h = S.hold; S.hold = t; spawn(h); } else { S.hold = t; spawn(); }
    holdBtn.classList.remove('pop'); void holdBtn.offsetWidth; holdBtn.classList.add('pop');
    pushState(true);
  }

  function lock(hard) {
    const c = S.cur;
    let above = true;
    for (const [cx, cy] of ROT[c.t][c.r]) {
      const X = c.x + cx, Y = c.y + cy;
      if (Y >= 0) S.board[Y * COLS + X] = c.t;
      if (Y >= HIDDEN) above = false;
    }
    S.cur = null; S.canHold = true; S.pieces++;
    CG.sfx(hard ? 'drop' : 'click');
    // a little dust under the piece
    for (const [cx, cy] of ROT[c.t][c.r]) {
      if (c.y + cy + 1 < ROWS && at(c.x + cx, c.y + cy + 1) === 0) continue;
      for (let i = 0; i < (hard ? 3 : 1); i++) particles.push({ x: L.wellX + (c.x + cx + Math.random()) * cell, y: L.wellY + (c.y + cy + 1 - HIDDEN) * cell, vx: (Math.random() - 0.5) * 1.6, vy: -Math.random() * 1.4, r: cell * 0.09, c: 'rgba(255,255,255,.8)', life: 0.7 });
    }
    if (above) { topOut(); return; }
    const full = [];
    for (let y = 0; y < ROWS; y++) {
      let f = true;
      for (let x = 0; x < COLS; x++) if (!S.board[y * COLS + x]) { f = false; break; }
      if (f) full.push(y);
    }
    if (full.length) {
      clearRows(full);
      S.clearing = { rows: full, at: performance.now() };
    } else {
      S.combo = -1;
      applyGarbage();
      if (!S.over) spawn();
    }
    pushState(true);
  }

  function clearRows(full) {
    const n = full.length;
    const quad = n === 4;
    let pts = [0, 100, 300, 500, 800][n] * S.level;
    const b2b = quad && S.b2b;
    if (b2b) pts = Math.round(pts * 1.5);
    S.b2b = quad;
    S.combo++;
    if (S.combo > 0) pts += 50 * S.combo * S.level;
    S.score += pts;
    let attack = ATTACK[n];
    // rows you clear cancel grey rows that are on their way to you first
    let cancelled = 0;
    while (attack > 0 && S.pending.length) {
      const p = S.pending[0];
      const k = Math.min(p.n, attack);
      p.n -= k; attack -= k; cancelled += k;
      if (!p.n) S.pending.shift();
    }
    if (attack > 0) sendGarbage(attack);
    const before = S.level;
    S.lines += n;
    S.level = Math.min(20, 1 + Math.floor(S.lines / 10));
    const midY = L.wellY + ((full[0] + full[n - 1]) / 2 + 0.5 - HIDDEN) * cell;
    floaters.push({ text: (b2b ? 'Super ' : '') + CLEAR_NAMES[n], sub: '+' + fmt(pts), x: L.wellX + L.wellW / 2, y: midY, life: 1, big: n >= 3 });
    if (S.combo > 0) floaters.push({ text: 'Combo ' + S.combo, x: L.wellX + L.wellW / 2, y: midY + cell * 1.6, life: 1, small: true, color: '#fde047' });
    if (cancelled) floaters.push({ text: 'Blocked ' + cancelled, x: L.wellX + L.wellW / 2, y: midY - cell * 1.6, life: 1, small: true, color: '#86efac' });
    for (const y of full) {
      for (let x = 0; x < COLS; x++) {
        const col = COLORS[at(x, y)] || '#fff';
        for (let i = 0; i < 2; i++) particles.push({ x: L.wellX + (x + 0.5) * cell, y: L.wellY + (y - HIDDEN + 0.5) * cell, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 4 - 1, r: cell * (0.1 + Math.random() * 0.1), c: col, life: 1, grav: true });
      }
    }
    shake = Math.max(shake, n >= 4 ? 1 : n * 0.25);
    CG.sfx(n >= 4 ? 'win' : n >= 2 ? 'match' : 'score');
    if (S.level > before) {
      setTimeout(() => CG.sfx('coin'), 260);
      floaters.push({ text: 'Level ' + S.level, x: L.wellX + L.wellW / 2, y: L.wellY + L.wellH * 0.3, life: 1.3, big: true, color: '#67e8f9' });
    }
  }

  function finishClear() {
    const rows = S.clearing.rows;
    S.clearing = null;
    const keep = [];
    for (let y = 0; y < ROWS; y++) if (!rows.includes(y)) keep.push(...S.board.slice(y * COLS, y * COLS + COLS));
    S.board = new Array(rows.length * COLS).fill(0).concat(keep);
    if (S.board.every((v) => !v)) {
      const bonus = 1000 * S.level;
      S.score += bonus;
      floaters.push({ text: 'All clear!', sub: '+' + fmt(bonus), x: L.wellX + L.wellW / 2, y: L.wellY + L.wellH * 0.5, life: 1.4, big: true, color: '#fde047' });
      CG.sfx('win');
    }
    spawn();
    pushState(true);
  }

  // ---------- Versus: garbage ----------
  function pickTarget() {
    const live = others.filter((o) => o.state && o.state.alive !== false && !o.state.done);
    if (!live.length) return null;
    live.sort((a, b) => (Number(b.state.score) || 0) - (Number(a.state.score) || 0) || (a.name < b.name ? -1 : 1));
    return live[0].name;
  }
  function sendGarbage(n) {
    if (!multi) return;
    const target = pickTarget();
    if (!target) return;
    S.sent[target] = (S.sent[target] || 0) + n;
    S.totalSent += n;
    const box = oppBoxes.find((b) => b.name === target);
    const x0 = L.wellX + L.wellW / 2, y0 = L.wellY + L.wellH * 0.5;
    for (let i = 0; i < 10 + n * 4; i++) {
      particles.push({ x: x0 + (Math.random() - 0.5) * L.wellW * 0.6, y: y0 + (Math.random() - 0.5) * cell * 2, home: box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : null, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, r: cell * 0.14, c: '#fca5a5', life: 1.2 });
    }
    floaters.push({ text: `${n} row${n > 1 ? 's' : ''} to ${target}`, x: L.wellX + L.wellW / 2, y: L.wellY + L.wellH * 0.62, life: 1.2, small: true, color: '#fca5a5' });
    CG.sfx('whoosh');
  }
  function checkIncoming() {
    for (const o of others) {
      const total = Number(o.state && o.state.sent && o.state.sent[me]) || 0;
      const had = S.recv[o.name] || 0;
      if (total > had) {
        S.pending.push({ n: total - had, from: o.name });
        S.recv[o.name] = total;
        S.totalGot += total - had;
        floaters.push({ text: `${o.name} sent ${total - had}!`, x: L.wellX + L.wellW / 2, y: L.wellY + L.wellH * 0.2, life: 1.2, small: true, color: '#fca5a5' });
        CG.sfx('wrong');
      }
    }
  }
  const pendingCount = () => S.pending.reduce((a, p) => a + p.n, 0);
  function applyGarbage() {
    let budget = 8, added = 0, overflow = false;
    while (S.pending.length && budget > 0) {
      const p = S.pending[0];
      if (p.gap == null) p.gap = Math.floor(S.grng() * COLS);
      const k = Math.min(p.n, budget);
      for (let i = 0; i < k; i++) {
        for (let x = 0; x < COLS; x++) if (S.board[x]) overflow = true;
        S.board.splice(0, COLS);
        for (let x = 0; x < COLS; x++) S.board.push(x === p.gap ? 0 : 'G');
      }
      p.n -= k; budget -= k; added += k;
      if (!p.n) S.pending.shift();
    }
    if (added) { S.rise = { n: added, at: performance.now() }; shake = Math.max(shake, 0.4); CG.sfx('hit'); }
    if (overflow) topOut();
  }

  // ---------- Ending ----------
  function topOut() {
    if (S.over) return;
    S.over = true; S.cur = null; S.overAt = performance.now();
    S.koAt = Date.now() - S.startAt;
    phase = 'over';
    CG.sfx('lose');
    shake = 1;
    if (multi) {
      // knock-out order: my place is one behind everyone still playing (last one standing = 1)
      const sess = CG.session();
      const map = new Map(others.map((o) => [o.name, o.state || {}]));
      const still = (sess ? sess.players : []).filter((n) => n !== me && (() => { const st = map.get(n); return !st || (st.alive !== false && !st.done); })()).length;
      S.place = still + 1;
      CG.race.update(raceState({ alive: false, ko: S.koAt, place: S.place }));
    }
    clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      if (multi) CG.gameOver({ score: S.score });
      else CG.gameOver({ score: S.score, title: S.lines ? `${fmt(S.lines)} line${S.lines === 1 ? '' : 's'} cleared!` : 'Game over', again: startSolo });
    }, 1300);
  }
  function win() {
    if (S.over) return;
    S.over = true; S.won = true; S.cur = null; S.overAt = performance.now();
    S.koAt = Date.now() - S.startAt;
    phase = 'over';
    CG.sfx('win');
    for (let i = 0; i < 70; i++) {
      const cols = Object.values(COLORS);
      particles.push({ x: L.wellX + Math.random() * L.wellW, y: L.wellY + L.wellH * (0.3 + Math.random() * 0.4), vx: (Math.random() - 0.5) * 7, vy: -Math.random() * 7 - 2, r: cell * (0.12 + Math.random() * 0.12), c: cols[i % cols.length], life: 1.6, grav: true });
    }
    S.place = 1;
    CG.race.update(raceState({ alive: false, won: true, ko: S.koAt, place: 1, detail: 'Last one standing' }));
    clearTimeout(endTimer);
    endTimer = setTimeout(() => CG.gameOver({ score: S.score }), 1600);
  }

  // ---------- Race state ----------
  function wellString() {
    const cells = S.board.slice(HIDDEN * COLS);
    if (S.cur) for (const [cx, cy] of ROT[S.cur.t][S.cur.r]) { const Y = S.cur.y + cy - HIDDEN; if (Y >= 0) cells[Y * COLS + S.cur.x + cx] = S.cur.t; }
    return cells.map((v) => v || '.').join('');
  }
  function raceState(extra) {
    return Object.assign({ score: S.score, alive: !S.over, lv: S.level, ln: S.lines, w: wellString(), sent: Object.assign({}, S.sent), inc: pendingCount(), detail: `${S.lines} line${S.lines === 1 ? '' : 's'} · ${S.totalSent} sent` }, extra || {});
  }
  function pushState(now) {
    if (!multi || !S || S.over) return;
    const t = performance.now();
    if (!now && t - pushAt < 120) return;
    pushAt = t;
    CG.race.update(raceState());
  }
  function lastStandingCheck() {
    if (!multi || !S || S.over) return;
    const sess = CG.session();
    if (!sess) return;
    const names = sess.players.filter((n) => n !== me);
    if (!names.length) return;
    const map = new Map(others.map((o) => [o.name, o]));
    const grace = Date.now() - S.startAt > 15000;
    let started = 0;
    for (const n of names) {
      const o = map.get(n);
      if (o) { started++; if (o.state.alive !== false && !o.state.done) return; } else if (!grace) return;
    }
    if (started) win();
  }

  // Everyone's place: still playing (or the winner) first, then whoever was knocked out last.
  function standings() {
    const sess = CG.session();
    const names = sess ? sess.players.slice() : [me];
    const map = new Map(others.map((o) => [o.name, o.state]));
    const rows = names.map((name) => {
      const st = name === me ? (S ? { alive: !S.over, won: S.won, ko: S.koAt, score: S.score } : null) : map.get(name);
      const out = !!st && (st.alive === false || !!st.done) && !st.won;
      const key = !st ? -1 : out ? Number(st.ko) || 0 : Infinity;
      return { name, st, out, won: !!(st && st.won), key, score: st ? Number(st.score) || 0 : 0 };
    });
    rows.sort((a, b) => b.key - a.key || b.score - a.score);
    rows.forEach((r, i) => { const pl = r.name === me ? S && S.place : r.st && Number(r.st.place); r.place = pl >= 1 ? pl : i + 1; });
    return rows;
  }

  // ---------- Loop ----------
  function update(dt, now) {
    if (S.clearing) { if (now - S.clearing.at >= CLEAR_MS) finishClear(); return; }
    if (!S.cur) return;
    if (keys.das && !CG.modalOpen()) {
      if (now - keys.dasT0 >= DAS) {
        let guard = 0;
        while (now - keys.dasLast >= ARR && guard++ < 10) { tryMove(keys.das); keys.dasLast += ARR; }
      }
    }
    const grav = gravMs();
    const soft = keys.soft || touch.soft;
    const step = soft ? Math.min(SOFT_MS, grav) : grav;
    S.fall += dt;
    let guard = 0;
    while (S.fall >= step && guard++ < 22) {
      S.fall -= step;
      if (!stepDown(soft)) { S.fall = 0; break; }
    }
    if (onGround()) {
      S.lockT += dt;
      if (S.lockT >= LOCK_MS) lock(false);
    } else S.lockT = 0;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!S || !cw) return;
    const dt = Math.min(50, now - (lastFrame || now));
    lastFrame = now;
    if (multi && now - othersAt > 100) {
      othersAt = now;
      others = CG.race.others();
      if (!S.over) checkIncoming();
      if (now - winAt > 300) { winAt = now; lastStandingCheck(); }
    }
    if (phase === 'playing') {
      if (!multi && CG.modalOpen()) pause();
      else update(dt, now);
    }
    pushState(false);
    render(now, dt);
  }

  // ---------- Drawing ----------
  function rrect(x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  function font(px, weight) { return `${weight || 800} ${Math.round(px)}px Outfit, system-ui, -apple-system, sans-serif`; }
  function piecePreview(t, cx, cy, pc, alpha) {
    const cells = ROT[t][0];
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (const [x, y] of cells) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const w = (maxX - minX + 1) * pc, h = (maxY - minY + 1) * pc;
    g.globalAlpha = alpha == null ? 1 : alpha;
    const sp = sprite(COLORS[t], pc);
    for (const [x, y] of cells) g.drawImage(sp, Math.round(cx - w / 2 + (x - minX) * pc), Math.round(cy - h / 2 + (y - minY) * pc), pc, pc);
    g.globalAlpha = 1;
  }
  function panel(x, y, w, h, label) {
    rrect(x, y, w, h, Math.min(16, cell * 0.6));
    g.fillStyle = pal.panel; g.fill();
    g.strokeStyle = pal.panelLine; g.lineWidth = 1; g.stroke();
    if (label) {
      g.fillStyle = pal.muted; g.font = font(L.fs * 0.82, 700); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, x + w / 2, y + L.label * 0.55);
    }
  }

  let oppBoxes = [];
  function render(now, dt) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    let sx = 0, sy = 0;
    if (shake > 0) { shake = Math.max(0, shake - dt / 420); sx = (Math.random() - 0.5) * shake * cell * 0.3; sy = (Math.random() - 0.3) * shake * cell * 0.3; }

    // side panels
    const hl = phase === 'playing' && S.canHold;
    const H = L.hold, N = L.next, slot = L.slot;
    panel(H.x, H.y, H.w, H.h, coarse() ? 'Hold' : 'Hold (C)');
    if (S.hold && phase !== 'ready') piecePreview(S.hold, H.x + H.w / 2, H.y + L.label + slot / 2 - 2, L.pc, hl ? 1 : 0.35);
    panel(N.x, N.y, N.w, N.h, 'Next');
    if (phase !== 'ready') for (let i = 0; i < 3; i++) piecePreview(S.queue[i], N.x + N.w / 2, N.y + L.label + slot * i + slot / 2 - 2, i ? Math.round(L.pc * 0.86) : L.pc, i ? 0.8 : 1);
    // stats
    S.shownScore += (S.score - S.shownScore) * Math.min(1, dt / 90);
    if (Math.abs(S.score - S.shownScore) < 1) S.shownScore = S.score;
    const stats = [['Score', fmt(Math.round(S.shownScore))]];
    if (L.portrait) stats.push([multi ? 'Level · Sent' : 'Level · Lines', multi ? `${S.level} · ${S.totalSent}` : `${S.level} · ${S.lines}`]);
    else { stats.push(['Level', S.level], ['Lines', S.lines]); if (multi) stats.push(['Rows sent', S.totalSent]); }
    let y = L.statsY;
    for (const [k, v] of stats) {
      if (y + L.statH > L.wellY + L.wellH + 1 && k !== 'Score') break;
      panel(L.sideX, y, L.sideW, L.statH);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = pal.muted; g.font = font(L.fs * 0.72, 700); g.fillText(k, L.sideX + L.sideW / 2, y + L.statH * 0.3);
      g.fillStyle = pal.ink; g.font = font(k === 'Score' ? L.fs * 1.15 : L.fs * 1.05); g.fillText(String(v), L.sideX + L.sideW / 2, y + L.statH * 0.68);
      y += L.statH + Math.round(L.gap * 0.6);
    }
    L.statsEnd = y;

    // well
    g.save();
    g.translate(sx, sy);
    const wx = L.wellX, wy = L.wellY;
    rrect(wx - 5, wy - 5, L.wellW + 10, L.wellH + 10, Math.min(14, cell * 0.5)); g.fillStyle = pal.frame; g.fill();
    rrect(wx, wy, L.wellW, L.wellH, Math.min(10, cell * 0.35)); g.fillStyle = pal.well; g.fill();
    g.save();
    rrect(wx, wy, L.wellW, L.wellH, Math.min(10, cell * 0.35)); g.clip();
    g.strokeStyle = pal.wellLine; g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < COLS; x++) { g.moveTo(wx + x * cell + 0.5, wy); g.lineTo(wx + x * cell + 0.5, wy + L.wellH); }
    for (let r = 1; r < VIS; r++) { g.moveTo(wx, wy + r * cell + 0.5); g.lineTo(wx + L.wellW, wy + r * cell + 0.5); }
    g.stroke();
    // danger glow when the stack is high
    let top = ROWS;
    for (let i = 0; i < S.board.length; i++) if (S.board[i]) { top = Math.floor(i / COLS); break; }
    if (phase === 'playing' && top - HIDDEN < 5) {
      const k = 0.18 + 0.1 * Math.sin(now / 160);
      const gr = g.createLinearGradient(0, wy, 0, wy + cell * 6);
      gr.addColorStop(0, `rgba(248,113,113,${k})`); gr.addColorStop(1, 'rgba(248,113,113,0)');
      g.fillStyle = gr; g.fillRect(wx, wy, L.wellW, cell * 6);
    }
    // rising garbage slides up
    let riseOff = 0;
    if (S.rise) {
      const k = (now - S.rise.at) / 220;
      if (k >= 1) S.rise = null; else riseOff = (1 - k) * (1 - k) * S.rise.n * cell;
    }
    const clearing = S.clearing;
    const ck = clearing ? clamp((now - clearing.at) / CLEAR_MS, 0, 1) : 0;
    const gray = S.over && !S.won ? clamp((now - S.overAt) / 900, 0, 1) : 0;
    for (let r = HIDDEN; r < ROWS; r++) {
      const isClear = clearing && clearing.rows.includes(r);
      for (let x = 0; x < COLS; x++) {
        const v = at(x, r);
        if (!v) continue;
        const px = wx + x * cell, py = wy + (r - HIDDEN) * cell + riseOff;
        const grayed = gray > 0 && (ROWS - r) / VIS < gray * 1.05;
        if (isClear) {
          const s = 1 - Math.max(0, (ck - 0.35) / 0.65);
          if (s <= 0) continue;
          const d = Math.abs(x - 4.5) / 5;
          if (ck > 0.35 && d > s) continue;
          g.drawImage(sprite(COLORS[v], cell), px, py, cell, cell);
          g.fillStyle = `rgba(255,255,255,${0.85 * (1 - Math.abs(ck - 0.3) / 0.7)})`;
          g.fillRect(px, py, cell, cell);
        } else g.drawImage(sprite(grayed ? '#6b7280' : COLORS[v], cell), px, py, cell, cell);
      }
    }
    // hard drop streaks
    for (const f of flyers) {
      f.life -= dt / 200;
      if (f.life <= 0) continue;
      g.globalAlpha = f.life * 0.35;
      g.fillStyle = COLORS[f.t];
      for (const [cx, cy] of ROT[f.t][f.r]) {
        const top0 = Math.max(HIDDEN, f.y0 + cy), bot = f.y1 + cy;
        if (bot < HIDDEN) continue;
        g.fillRect(wx + (f.x + cx) * cell + cell * 0.2, wy + (top0 - HIDDEN) * cell, cell * 0.6, (bot - top0) * cell);
      }
      g.globalAlpha = 1;
    }
    flyers = flyers.filter((f) => f.life > 0);
    // ghost and the falling piece
    if (S.cur && phase !== 'ready') {
      const c = S.cur, gy = dropY(c);
      for (const [cx, cy] of ROT[c.t][c.r]) {
        const r = gy + cy;
        if (r < HIDDEN) continue;
        const px = wx + (c.x + cx) * cell, py = wy + (r - HIDDEN) * cell;
        rrect(px + 2, py + 2, cell - 4, cell - 4, cell * 0.18);
        g.fillStyle = COLORS[c.t] + '33'; g.fill();
        g.strokeStyle = COLORS[c.t] + 'aa'; g.lineWidth = Math.max(1.5, cell * 0.07); g.stroke();
      }
      const lockFade = onGround() ? 1 - 0.35 * clamp(S.lockT / LOCK_MS, 0, 1) : 1;
      const pop = clamp((now - c.born) / 120, 0, 1);
      g.globalAlpha = lockFade * (0.4 + 0.6 * pop);
      for (const [cx, cy] of ROT[c.t][c.r]) {
        const r = c.y + cy;
        if (r < HIDDEN) continue;
        g.drawImage(sprite(COLORS[c.t], cell), wx + (c.x + cx) * cell, wy + (r - HIDDEN) * cell, cell, cell);
      }
      g.globalAlpha = 1;
    }
    g.restore();
    // incoming garbage meter (left edge of the well)
    const inc = phase === 'ready' ? 0 : pendingCount();
    if (inc > 0) {
      const mh = Math.min(L.wellH, inc * cell);
      rrect(wx - 5 - Math.max(5, cell * 0.28), wy + L.wellH - mh, Math.max(5, cell * 0.28), mh, 3);
      g.fillStyle = `rgba(248,113,113,${0.75 + 0.25 * Math.sin(now / 120)})`; g.fill();
    }
    g.restore();

    drawFx(dt);
    if (multi) drawOpponents(now);
    else oppBoxes = [];

    if (S.over && multi) {
      const k = clamp((now - S.overAt) / 400, 0, 1);
      g.globalAlpha = k;
      const cx = L.wellX + L.wellW / 2, cy = L.wellY + L.wellH * 0.42;
      rrect(cx - L.wellW * 0.4, cy - cell * 1.6, L.wellW * 0.8, cell * 3.2, cell * 0.6);
      g.fillStyle = 'rgba(15,15,25,.82)'; g.fill();
      g.fillStyle = S.won ? '#fde047' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = font(cell * 1.05); g.fillText(S.won ? 'You win!' : 'Out!', cx, cy - cell * 0.4);
      g.fillStyle = '#d4d4d8'; g.font = font(cell * 0.55, 600);
      g.fillText(S.won ? 'Last one standing' : S.place ? `${ordinal(S.place)} place` : '', cx, cy + cell * 0.75);
      g.globalAlpha = 1;
    }
  }

  function drawFx(dt) {
    const f = dt / 16.7;
    for (const p of particles) {
      p.life -= 0.022 * f;
      if (p.home) {
        p.vx += ((p.home.x - p.x) * 0.012 - p.vx * 0.08) * f; p.vy += ((p.home.y - p.y) * 0.012 - p.vy * 0.08) * f;
        if (Math.hypot(p.home.x - p.x, p.home.y - p.y) < 12) p.life = Math.min(p.life, 0.1);
      } else if (p.grav) p.vy += 0.18 * f;
      p.x += p.vx * f; p.y += p.vy * f;
      g.globalAlpha = clamp(p.life, 0, 1);
      g.fillStyle = p.c;
      g.beginPath(); g.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    particles = particles.filter((p) => p.life > 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const fl of floaters) {
      fl.life -= 0.016 * f;
      fl.y -= 0.35 * f;
      const a = clamp(fl.life * 2, 0, 1);
      const pop = 1 + Math.max(0, fl.life - 0.85) * 2.4;
      g.globalAlpha = a;
      const px = (fl.big ? 0.95 : fl.small ? 0.5 : 0.72) * cell * pop;
      g.font = font(px);
      g.lineWidth = Math.max(3, px * 0.18); g.strokeStyle = 'rgba(20,16,50,.75)'; g.lineJoin = 'round';
      g.strokeText(fl.text, fl.x, fl.y); g.fillStyle = fl.color || '#fff'; g.fillText(fl.text, fl.x, fl.y);
      if (fl.sub) { g.font = font(px * 0.62); g.strokeText(fl.sub, fl.x, fl.y + px * 0.95); g.fillStyle = '#fde68a'; g.fillText(fl.sub, fl.x, fl.y + px * 0.95); }
    }
    g.globalAlpha = 1;
    floaters = floaters.filter((x) => x.life > 0);
  }

  // Small live copies of the other wells, drawn from their 200-character snapshots.
  function drawOpponents(now) {
    const list = others.slice().sort((a, b) => (a.name < b.name ? -1 : 1));
    oppBoxes = [];
    if (!list.length) return;
    const ranks = new Map(standings().map((r) => [r.name, r]));
    const target = S.over ? null : pickTarget();
    const below = { x: L.sideX, y: L.statsEnd + 2, w: L.sideW, h: L.wellY + L.wellH - L.statsEnd - 2 };
    const cols = L.portrait ? [below, { x: 0, y: 0, w: 0, h: 0 }]
      : [{ x: L.hold.x, y: L.hold.y + L.hold.h + L.gap, w: L.sideW, h: L.wellY + L.wellH - (L.hold.y + L.hold.h + L.gap) }, below];
    const lab = clamp(Math.round(L.fs * 0.8), 9, 13);
    let mc = 2, plan = null;
    for (let m = Math.min(9, Math.floor((L.sideW - 8) / COLS)); m >= 2; m--) {
      const bw = m * COLS + 8, bh = m * VIS + lab * 2 + 10;
      const caps = cols.map((c) => (c.h >= bh ? Math.max(0, Math.floor((c.w + 4) / (bw + 4))) * Math.floor((c.h + 4) / (bh + 4)) : 0));
      if (caps[0] + caps[1] >= list.length) { mc = m; plan = { bw, bh, caps }; break; }
    }
    if (!plan) { mc = 2; plan = { bw: 28, bh: 2 * VIS + lab * 2 + 10, caps: [99, 0] }; }
    let i = 0;
    cols.forEach((c, ci) => {
      const perRow = Math.max(1, Math.floor((c.w + 4) / (plan.bw + 4)));
      for (let k = 0; k < plan.caps[ci] && i < list.length; k++, i++) {
        const o = list[i];
        const bx = c.x + (k % perRow) * (plan.bw + 4) + (c.w - Math.min(perRow, list.length) * (plan.bw + 4) + 4) / 2;
        const by = c.y + Math.floor(k / perRow) * (plan.bh + 4);
        drawOpp(o, bx, by, plan.bw, plan.bh, mc, lab, ranks.get(o.name), o.name === target, now);
        oppBoxes.push({ name: o.name, x: bx, y: by, w: plan.bw, h: plan.bh });
      }
    });
  }
  function drawOpp(o, x, y, w, h, mc, lab, rank, isTarget, now) {
    const st = o.state || {};
    const out = st.alive === false || st.done;
    rrect(x, y, w, h, 8);
    g.fillStyle = pal.panel; g.fill();
    if (isTarget) { g.strokeStyle = '#f87171'; g.lineWidth = 2; g.stroke(); }
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = o.color; g.beginPath(); g.arc(x + 8, y + lab * 0.85, Math.max(3, lab * 0.3), 0, Math.PI * 2); g.fill();
    g.fillStyle = pal.ink; g.font = font(lab, 700);
    let name = o.name;
    while (name.length > 2 && g.measureText(name).width > w - 18) name = name.slice(0, -1);
    g.fillText(name === o.name ? name : name + '…', x + 14, y + lab * 0.85);
    const mx = x + (w - mc * COLS) / 2, my = y + lab * 1.7;
    g.fillStyle = pal.well;
    g.fillRect(mx, my, mc * COLS, mc * VIS);
    const s = String(st.w || '');
    for (let i = 0; i < Math.min(s.length, COLS * VIS); i++) {
      const v = s[i];
      if (v === '.' || !COLORS[v]) continue;
      g.fillStyle = out ? '#6b7280' : COLORS[v];
      g.fillRect(mx + (i % COLS) * mc, my + Math.floor(i / COLS) * mc, mc - (mc > 3 ? 0.6 : 0), mc - (mc > 3 ? 0.6 : 0));
    }
    const inc = Number(st.inc) || 0;
    if (inc > 0 && !out) { g.fillStyle = '#f87171'; g.fillRect(mx - 3, my + mc * VIS - Math.min(VIS, inc) * mc, 2, Math.min(VIS, inc) * mc); }
    g.textAlign = 'center';
    g.fillStyle = pal.ink; g.font = font(lab, 800);
    g.fillText(fmt(st.score), x + w / 2, my + mc * VIS + lab * 0.85);
    if (out || (rank && rank.won)) {
      g.fillStyle = 'rgba(15,15,25,.72)';
      const bh = lab * 2.6;
      g.fillRect(mx, my + mc * VIS / 2 - bh / 2, mc * COLS, bh);
      const fz = Math.min(lab * 0.95, mc * COLS * 0.3);
      g.fillStyle = st.won ? '#fde047' : '#fff'; g.font = font(fz, 800);
      g.fillText(st.won ? 'Winner' : 'Out', x + w / 2, my + mc * VIS / 2 - lab * 0.45);
      g.font = font(fz * 0.85, 700); g.fillStyle = '#d4d4d8';
      if (rank) g.fillText(ordinal(rank.place), x + w / 2, my + mc * VIS / 2 + lab * 0.6);
    } else if (isTarget) {
      g.fillStyle = '#f87171'; g.font = font(lab * 0.75, 800);
      g.fillText('TARGET', x + w / 2, my + lab * 0.7);
    }
  }

  // ---------- Overlays ----------
  function renderOverlay() {
    if (phase === 'ready') {
      const tips = coarse() ? 'Tap to turn · drag to move · flick down to drop' : 'Arrows move · Up / X / Z turn · C holds · Space drops';
      overlay.innerHTML = `<div class="bd-card bd-start"><div class="bd-logo">${CG.badge('blocks', 52)}</div><h2>Block Drop</h2>
        <p>Stack the falling blocks and fill whole rows to clear them.</p>
        <button type="button" class="bd-btn primary" data-act="family">${CG.icon('users', 22)}<span>Play with the family</span></button>
        <p class="bd-note">Same pieces for everyone. Clear rows to send grey rows to the leader. Last one standing wins!</p>
        <button type="button" class="bd-btn" data-act="solo">${CG.icon('play', 18)}<span>Practice alone</span></button>
        <p class="bd-tips">${tips}</p></div>`;
      overlay.className = 'bd-overlay show';
    } else if (phase === 'paused') {
      overlay.innerHTML = `<div class="bd-card"><h2>Paused</h2><p>Take a little break.</p><button type="button" class="bd-btn primary" data-act="resume">${CG.icon('play', 18)}<span>Keep going</span></button></div>`;
      overlay.className = 'bd-overlay show';
    } else { overlay.innerHTML = ''; overlay.className = 'bd-overlay'; }
  }

  function startSolo() {
    if (multi) return;
    clearTimeout(endTimer);
    CG.closeModal();
    newGame(Math.floor(Math.random() * 2 ** 31));
    phase = 'playing';
    renderOverlay();
    CG.sfx('go');
    lastFrame = performance.now();
  }
  function toReady() {
    clearTimeout(endTimer);
    newGame(Math.floor(Math.random() * 2 ** 31));
    phase = 'ready';
    renderOverlay();
  }
  function pause() { if (phase !== 'playing' || multi) return; phase = 'paused'; keys.das = 0; keys.soft = false; renderOverlay(); }
  function resume() { if (phase !== 'paused') return; phase = 'playing'; lastFrame = performance.now(); renderOverlay(); }

  // ---------- Input ----------
  const canAct = () => phase === 'playing' && S && S.cur && !S.over && !CG.modalOpen() && !(CG.countingDown && CG.countingDown());
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (CG.modalOpen()) return;
    const k = e.code;
    const game = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space', 'KeyZ', 'KeyX', 'KeyC', 'KeyA', 'KeyD', 'KeyS', 'KeyW', 'ShiftLeft', 'ShiftRight'].includes(k);
    if (game) e.preventDefault();
    if (phase === 'ready') { if (k === 'Space' || k === 'Enter') { e.preventDefault(); startSolo(); } return; }
    if (phase === 'paused') { if (k === 'Space' || k === 'Enter' || k === 'KeyP' || k === 'Escape') resume(); return; }
    if (k === 'KeyP' || k === 'Escape') { pause(); return; }
    if (e.repeat) return;
    if (!canAct()) return;
    if (k === 'ArrowLeft' || k === 'KeyA') { tryMove(-1); keys.das = -1; keys.dasT0 = performance.now(); keys.dasLast = keys.dasT0 + DAS; }
    else if (k === 'ArrowRight' || k === 'KeyD') { tryMove(1); keys.das = 1; keys.dasT0 = performance.now(); keys.dasLast = keys.dasT0 + DAS; }
    else if (k === 'ArrowDown' || k === 'KeyS') { keys.soft = true; if (stepDown(true)) S.fall = 0; }
    else if (k === 'ArrowUp' || k === 'KeyX' || k === 'KeyW') rotate(1);
    else if (k === 'KeyZ') rotate(-1);
    else if (k === 'KeyC' || k === 'ShiftLeft' || k === 'ShiftRight') doHold();
    else if (k === 'Space') hardDrop();
    pushState(false);
  }
  function onKeyUp(e) {
    const k = e.code;
    if ((k === 'ArrowLeft' || k === 'KeyA') && keys.das === -1) keys.das = 0;
    if ((k === 'ArrowRight' || k === 'KeyD') && keys.das === 1) keys.das = 0;
    if (k === 'ArrowDown' || k === 'KeyS') keys.soft = false;
  }

  // Touch: tap = turn, drag sideways = move (the piece follows your finger column by column), drag down =
  // drop faster, a quick flick down = drop all the way, swipe up = hold.
  const touch = { id: null, soft: false };
  function bindTouch() {
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || CG.modalOpen()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (phase === 'paused') { resume(); return; }
      if (!canAct()) return;
      touch.id = e.pointerId;
      Object.assign(touch, { x0: e.clientX, y0: e.clientY, t0: performance.now(), col0: S.cur.x, piece: S.cur, rows: 0, mode: null, hist: [[e.clientX, e.clientY, performance.now()]], soft: false });
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    wrap.addEventListener('pointermove', (e) => {
      if (touch.id !== e.pointerId || !S) return;
      const t = performance.now();
      touch.hist.push([e.clientX, e.clientY, t]);
      while (touch.hist.length > 2 && t - touch.hist[0][2] > 90) touch.hist.shift();
      if (!canAct()) return;
      if (S.cur !== touch.piece) {   // a new piece arrived mid-drag: carry on from here
        touch.piece = S.cur; touch.col0 = S.cur.x; touch.x0 = e.clientX; touch.y0 = e.clientY; touch.rows = 0;
      }
      const dx = e.clientX - touch.x0, dy = e.clientY - touch.y0;
      const step = Math.max(14, cell * 0.95);
      if (!touch.mode && Math.hypot(dx, dy) > 10) touch.mode = Math.abs(dx) > Math.abs(dy) * 0.9 ? 'h' : (dy > 0 ? 'v' : 'up');
      if (touch.mode === 'h' || touch.mode === 'v') {
        const want = touch.col0 + Math.round(dx / step);
        let guard = 0;
        while (S.cur && S.cur.x !== want && guard++ < 12) { if (!tryMove(want > S.cur.x ? 1 : -1)) break; }
      }
      if (touch.mode === 'v' || (touch.mode === 'h' && dy > step * 2.5)) {
        if (touch.mode === 'h') touch.mode = 'v';
        const rows = Math.floor(Math.max(0, dy) / step);
        let guard = 0;
        while (touch.rows < rows && guard++ < 22) { touch.rows++; if (!stepDown(true)) break; S.fall = 0; }
      }
      pushState(false);
    });
    const end = (e) => {
      if (touch.id !== e.pointerId) return;
      touch.id = null;
      if (!canAct()) return;
      const t = performance.now();
      const dx = e.clientX - touch.x0, dy = e.clientY - touch.y0;
      const h0 = touch.hist[0], h1 = touch.hist[touch.hist.length - 1];
      const vy = h0 && h1 && h1[2] - h0[2] > 0 && t - h1[2] < 90 ? (Math.max(e.clientY, h1[1]) - h0[1]) / (h1[2] - h0[2]) : 0;
      if (!touch.mode && t - touch.t0 < 350 && Math.hypot(dx, dy) < 12) {
        rotate(e.clientX - wrap.getBoundingClientRect().left < L.wellX - L.gap ? -1 : 1);
      } else if (touch.mode === 'v' && vy > 0.6 && dy > 30) hardDrop();
      else if (touch.mode === 'up' && dy < -40) doHold();
      pushState(false);
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', (e) => { if (touch.id === e.pointerId) touch.id = null; });
    wrap.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    wrap.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- Boot ----------
  CG.mount({
    id: 'blocks', title: 'Block Drop', mode: 'race', scoreLabel: 'points', syncMs: 400,
    help: '<ul><li>Blocks fall into the well. Fill a whole row to clear it. Clear 2, 3 or 4 rows at once for big points, and keep clearing in a row for a combo.</li>' +
      '<li><b>Keyboard:</b> left and right arrows move, <b>Up</b> or <b>X</b> turns, <b>Z</b> turns the other way, <b>Down</b> drops faster, <b>Space</b> drops all the way, <b>C</b> holds a piece for later, <b>P</b> pauses.</li>' +
      '<li><b>Phone:</b> tap to turn, drag left and right to move (the piece follows your finger), drag down to drop faster, flick down to drop all the way, and tap <b>Hold</b> (or swipe up) to keep a piece.</li>' +
      '<li>The see-through outline shows where the piece will land. Every 10 rows the level goes up and the blocks fall faster.</li>' +
      `<li><b>${CG.icon('users', 17)} Play with the family:</b> everyone gets the same pieces. Clearing 2, 3 or 4 rows sends 1, 2 or 4 grey rows to the player with the most points (marked TARGET). Clearing rows also blocks grey rows coming your way. If your blocks reach the top you are out. <b>Last one standing wins!</b></li></ul>`,
    onReady(ctx) {
      root = ctx.root; me = ctx.user || CG.me();
      document.body.classList.add('bd-page');
      build();
      new ResizeObserver(() => layout()).observe(wrap);
      window.addEventListener('resize', layout);
      newGame(ctx.seed);
      layout();
      phase = 'ready';
      renderOverlay();
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', () => { keys.das = 0; keys.soft = false; });
      bindTouch();
      const mq = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
      const repaint = () => { pal = palette(); sprites.clear(); };
      if (mq && mq.addEventListener) mq.addEventListener('change', repaint);
      new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      requestAnimationFrame(frame);
    }
  });

  CG.on('pause', pause);
  CG.on('multiStart', (info) => {
    clearTimeout(endTimer);
    multi = true;
    me = info.me || CG.me();
    newGame(info.seed);
    S.startAt = info.startAt || Date.now();
    others = []; oppBoxes = [];
    phase = 'playing';
    keys.das = 0; keys.soft = false;
    renderOverlay();
    CG.race.update(raceState());
    lastFrame = performance.now();
  });
  CG.on('multiEnd', () => { multi = false; others = []; toReady(); });

  // For tests and curious grown-ups: a read-only peek at the game.
  window.BlockDrop = {
    state: () => S && ({
      phase, multi, score: S.score, lines: S.lines, level: S.level, over: S.over, won: S.won, hold: S.hold, canHold: S.canHold,
      cur: S.cur && { t: S.cur.t, r: S.cur.r, x: S.cur.x, y: S.cur.y }, queue: S.queue.slice(0, 5), order: S.order.slice(0, 28),
      board: S.board.map((v) => v || '.').join(''), clearing: !!S.clearing, sent: Object.assign({}, S.sent), got: S.totalGot,
      pending: pendingCount(), cell, layout: Object.assign({}, L)
    }),
    shapes: ROT
  };
})();
