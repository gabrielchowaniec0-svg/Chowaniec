// Doodle Guess: a family drawing party game. Each turn one person draws a secret word and everyone else
// races to guess it in the chat box. Faster guesses score more, and the artist scores when people guess.
//
// Play together (race): the round's seed decides the turn order and the words (the artist picks one of an
// Easy, a Medium and a Hard word). Everything runs on a shared clock from info.startAt: a turn is 75 s
// (the first few seconds are for picking the word) + a 5 s reveal. A turn ends early 2 s after the last
// person guesses. Everyone draws once, or twice when there are only 2–3 players.
//
// Drawings travel in the artist's race state, as small text "ops" on a 1000×750 grid:
//   b<colour><size><x><y><deltas>  begin a stroke     p<deltas>  more points of the current stroke
//   f<colour><x><y>                flood fill         u          undo         c   clear
// x/y are 2 chars of base 64; each delta is 1 char (−31…31) or '.' + 2 chars. Ops are numbered from 0
// each turn. The state carries the newest ops after the slowest guesser's ack (budget ~2 KB), so a guesser
// who misses an update still catches up; anyone further behind (a reload, a late phone) loads a compact
// snapshot of the whole drawing that rotates through the state in ~0.9 KB chunks. Every device draws the
// ops into its own fixed 1000×750 canvas the same way, so the pictures match pixel for pixel.
(function () {
  'use strict';

  const G = window.ChowGames;
  const WORDS = window.DOODLE_WORDS;

  const W = 1000, H = 750;
  const TURN_MS = 75000;            // one turn, including picking the word
  const CHOOSE_MS = 12000;          // the artist picks a word within this (else the Easy word)
  const REVEAL_MS = 5000;
  const GRACE_MS = 2000;            // once everyone has guessed, the turn ends this long after
  const SKIP_MS = 6000;             // an artist who hasn't picked a word this long after the pick time is skipped
  const PODIUM_MS = 7000;
  const OPS_BUDGET = 2000;          // chars of drawing ops per update
  const SNAP_CHUNK = 900;           // chars of snapshot per update
  const SNAP_MAX = 8 * SNAP_CHUNK;
  const STATE_MAX = 3500;
  const PUSH_MS = 120;
  const GALLERY_KEY = 'chowaniec_doodle_gallery';
  const GALLERY_MAX = 24;
  const PRACTICE_KEY = 'chowaniec_doodle_practice';

  const PALETTE = [
    { c: '#1f2937', n: 'Black' }, { c: '#9ca3af', n: 'Grey' }, { c: '#ef4444', n: 'Red' }, { c: '#f97316', n: 'Orange' },
    { c: '#facc15', n: 'Yellow' }, { c: '#22c55e', n: 'Green' }, { c: '#3b82f6', n: 'Blue' }, { c: '#a855f7', n: 'Purple' },
    { c: '#ec4899', n: 'Pink' }, { c: '#92400e', n: 'Brown' }
  ];
  const ERASER = 10;
  const INK = PALETTE.map((p) => p.c).concat('#ffffff');
  const SIZES = [5, 12, 24, 44];
  const LEVELS = [
    { id: 'easy', name: 'Easy', mult: 1, color: '#22c55e' },
    { id: 'medium', name: 'Medium', mult: 1.25, color: '#f59e0b' },
    { id: 'hard', name: 'Hard', mult: 1.5, color: '#ef4444' }
  ];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round5 = (v) => Math.round(v / 5) * 5;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---------- Icons ----------
  // Drawing tools the core doesn't have (Lucide paths, ISC licence), drawn the same way as ChowGames.icon.
  const EXTRA = {
    pen: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    eraser: '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
    bucket: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
    brush: '<path d="m11 10 3 3"/><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z"/><path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"/>',
    download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'
  };
  function ic(name, size) {
    if (!EXTRA[name]) return G.icon(name, size);
    const px = size || 20;
    return `<svg class="cg-ic" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXTRA[name]}</svg>`;
  }

  // ---------- Op codec ----------
  const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.';
  const CI = {};
  for (let i = 0; i < 64; i++) CI[CH[i]] = i;
  const n2 = (v) => CH[(v >> 6) & 63] + CH[v & 63];
  const d2 = (s, i) => (CI[s[i]] || 0) * 64 + (CI[s[i + 1]] || 0);
  const encD = (d) => (d >= -31 && d <= 31 ? CH[d + 31] : '.' + n2(clamp(d + 2048, 0, 4095)));
  function decDeltas(s, i, st, out) {
    const vals = [];
    while (i < s.length) {
      const c = CI[s[i]];
      if (c === undefined) { i++; continue; }
      if (c === 63) { vals.push(d2(s, i + 1) - 2048); i += 3; } else { vals.push(c - 31); i += 1; }
    }
    for (let k = 0; k + 1 < vals.length; k += 2) {
      st.x = clamp(st.x + vals[k], 0, W - 1);
      st.y = clamp(st.y + vals[k + 1], 0, H - 1);
      out.push(['p', st.x, st.y]);
    }
  }
  // One op string -> drawing commands. `st` tracks the last point (for the deltas).
  function decodeOp(s, st) {
    const out = [];
    if (typeof s !== 'string' || !s) return out;
    const t = s[0];
    if (t === 'b' && s.length >= 7) {
      st.x = clamp(d2(s, 3), 0, W - 1); st.y = clamp(d2(s, 5), 0, H - 1);
      out.push(['b', clamp(CI[s[1]] || 0, 0, ERASER), clamp(CI[s[2]] || 0, 0, SIZES.length - 1), st.x, st.y]);
      decDeltas(s, 7, st, out);
    } else if (t === 'p') decDeltas(s, 1, st, out);
    else if (t === 'f' && s.length >= 6) out.push(['f', clamp(CI[s[1]] || 0, 0, ERASER), clamp(d2(s, 2), 0, W - 1), clamp(d2(s, 4), 0, H - 1)]);
    else if (t === 'u') out.push(['u']);
    else if (t === 'c') out.push(['c']);
    return out;
  }
  // Ramer–Douglas–Peucker on a flat [x,y,x,y…] list (keeps the ends).
  function simplify(p, eps) {
    const n = p.length / 2;
    if (n <= 2 || eps <= 0) return p.slice();
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((p[i * 2] - ax) * dy - (p[i * 2 + 1] - ay) * dx) / len;
        if (d > best) { best = d; bi = i; }
      }
      if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
    return out;
  }
  function encAction(a, eps) {
    if (a.t === 'f') return 'f' + CH[a.c] + n2(a.x) + n2(a.y);
    if (a.t === 'c') return 'c';
    const p = eps ? simplify(a.p, eps) : a.p;
    let s = 'b' + CH[a.c] + CH[a.s] + n2(p[0]) + n2(p[1]);
    for (let i = 2; i < p.length; i += 2) s += encD(p[i] - p[i - 2]) + encD(p[i + 1] - p[i - 1]);
    return s;
  }
  // The whole drawing as one string (ops joined by '|'), simplified until it fits.
  function snapshotOf(actions) {
    let list = actions;
    let s = list.map((a) => encAction(a, 0)).join('|');
    if (s.length <= SNAP_MAX) return s;
    const lc = list.map((a) => a.t).lastIndexOf('c');
    if (lc >= 0) { list = list.slice(lc + 1); s = list.map((a) => encAction(a, 0)).join('|'); }
    for (const eps of [1.2, 2.5, 4, 7, 11]) {
      if (s.length <= SNAP_MAX) return s;
      s = list.map((a) => encAction(a, eps)).join('|');
    }
    while (s.length > SNAP_MAX && list.length > 1) { list = list.slice(1); s = list.map((a) => encAction(a, 11)).join('|'); }
    return s.slice(0, SNAP_MAX);
  }

  // ---------- The drawing board (fixed 1000×750, the same on every device) ----------
  const RGB = INK.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  class Board {
    constructor() {
      this.cv = document.createElement('canvas');
      this.cv.width = W; this.cv.height = H;
      this.ctx = this.cv.getContext('2d');
      this.actions = [];
      this.cur = null;
      this.ver = 0;
      this.last = null;     // last point drawn (for the guessers' pencil)
      this.wipe();
    }
    wipe() { const c = this.ctx; c.globalCompositeOperation = 'source-over'; c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H); this.ver++; }
    reset() { this.actions = []; this.cur = null; this.last = null; this.wipe(); }
    run(cmd) {
      switch (cmd[0]) {
        case 'b': this.begin(cmd[1], cmd[2], cmd[3], cmd[4]); break;
        case 'p': this.point(cmd[1], cmd[2]); break;
        case 'f': this.fill(cmd[1], cmd[2], cmd[3]); break;
        case 'u': this.undo(); break;
        case 'c': this.clear(); break;
        default: break;
      }
    }
    begin(c, s, x, y) { const a = { t: 'b', c, s, p: [x, y] }; this.actions.push(a); this.cur = a; this.dot(a); this.last = [x, y]; }
    point(x, y) { const a = this.cur; if (!a) return; a.p.push(x, y); this.seg(a, a.p.length / 2 - 1); this.last = [x, y]; }
    fill(c, x, y) { this.cur = null; const a = { t: 'f', c, x, y }; this.actions.push(a); this.flood(a); this.last = [x, y]; }
    clear() { this.cur = null; this.actions.push({ t: 'c' }); this.wipe(); }
    undo() { this.cur = null; if (!this.actions.length) return; this.actions.pop(); this.replay(); }
    replay() {
      this.wipe();
      let from = 0;
      for (let i = this.actions.length - 1; i >= 0; i--) if (this.actions[i].t === 'c') { from = i + 1; break; }
      for (let i = from; i < this.actions.length; i++) {
        const a = this.actions[i];
        if (a.t === 'b') { this.dot(a); for (let k = 1; k < a.p.length / 2; k++) this.seg(a, k); } else if (a.t === 'f') this.flood(a);
      }
      this.cur = null;
    }
    dot(a) {
      const c = this.ctx;
      c.fillStyle = INK[a.c];
      c.beginPath(); c.arc(a.p[0], a.p[1], SIZES[a.s] / 2, 0, Math.PI * 2); c.fill();
      this.ver++;
    }
    // Point i of a stroke: a smooth curve through the midpoints, then a short line on to the point itself.
    // It only depends on the points so far, so drawing a stroke in any batches gives the same pixels.
    seg(a, i) {
      const c = this.ctx, p = a.p;
      const x1 = p[i * 2 - 2], y1 = p[i * 2 - 1], x2 = p[i * 2], y2 = p[i * 2 + 1];
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      c.strokeStyle = INK[a.c];
      c.lineWidth = SIZES[a.s];
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      if (i === 1) { c.moveTo(x1, y1); c.lineTo(mx, my); } else { c.moveTo((p[i * 2 - 4] + x1) / 2, (p[i * 2 - 3] + y1) / 2); c.quadraticCurveTo(x1, y1, mx, my); }
      c.lineTo(x2, y2);
      c.stroke();
      this.ver++;
    }
    flood(a) {
      const img = this.ctx.getImageData(0, 0, W, H), d = img.data;
      const [r, g, b] = RGB[a.c];
      const s0 = (a.y * W + a.x) * 4;
      const tr = d[s0], tg = d[s0 + 1], tb = d[s0 + 2];
      if (Math.abs(tr - r) + Math.abs(tg - g) + Math.abs(tb - b) < 12) return;
      const TOL = 150;
      const mask = new Uint8Array(W * H);
      const ok = (p) => { if (mask[p]) return false; const k = p * 4; return Math.abs(d[k] - tr) + Math.abs(d[k + 1] - tg) + Math.abs(d[k + 2] - tb) <= TOL; };
      const stack = [a.x, a.y];
      while (stack.length) {
        const y = stack.pop(); let x = stack.pop();
        let p = y * W + x;
        while (x > 0 && ok(p - 1)) { x--; p--; }
        let up = false, dn = false;
        while (x < W && ok(p)) {
          mask[p] = 1;
          if (y > 0) { const q = ok(p - W); if (q && !up) { stack.push(x, y - 1); up = true; } else if (!q) up = false; }
          if (y < H - 1) { const q = ok(p + W); if (q && !dn) { stack.push(x, y + 1); dn = true; } else if (!q) dn = false; }
          x++; p++;
        }
      }
      // Paint, and creep one pixel into soft (anti-aliased) edges so there's no white halo.
      for (let p = 0; p < W * H; p++) {
        let on = mask[p] === 1;
        if (!on) {
          const x = p % W;
          const near = (x > 0 && mask[p - 1] === 1) || (x < W - 1 && mask[p + 1] === 1) || (p >= W && mask[p - W] === 1) || (p < W * (H - 1) && mask[p + W] === 1);
          if (near) { const k = p * 4; on = Math.abs(d[k] - tr) + Math.abs(d[k + 1] - tg) + Math.abs(d[k + 2] - tb) <= 420; }
        }
        if (on) { const k = p * 4; d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255; }
      }
      this.ctx.putImageData(img, 0, 0);
      this.ver++;
    }
    hash() {
      const d = new Uint32Array(this.ctx.getImageData(0, 0, W, H).data.buffer);
      let h = 2166136261 >>> 0;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(16);
    }
    blank() { return !this.actions.some((a) => a.t !== 'c') || this.actions[this.actions.length - 1].t === 'c'; }
    image(w, q) {
      const c = document.createElement('canvas');
      c.width = w; c.height = Math.round(w * H / W);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(this.cv, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', q || 0.82);
    }
  }

  // ---------- Words ----------
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function judge(guess, word) {
    const g = norm(guess), w = norm(word);
    if (!g) return 'empty';
    if (g === w || g === w + 's' || g + 's' === w || g === w + 'es' || g + 'es' === w) return 'right';
    if (w.length >= 4 && lev(g, w) <= (w.length >= 8 ? 2 : 1)) return 'close';
    if (g.length >= 3 && ((w.includes(g) && g.length >= w.length - 3) || g.includes(w))) return 'close';
    return 'wrong';
  }
  const letterCount = (w) => w.replace(/[^a-z]/gi, '').length;
  function hintCount(word, frac) {
    const max = clamp(Math.floor(letterCount(word) / 3), 1, 3);
    const steps = [0.4, 0.6, 0.8];
    let n = 0;
    for (let i = 0; i < max; i++) if (frac >= steps[i]) n++;
    return n;
  }
  // Word slots: letters shown (revealed) or blank; spaces and hyphens shown as they are.
  function slotsHtml(word, shown) {
    let i = 0;
    return '<span class="dd-word">' + word.split(' ').map((part) => {
      const html = '<span class="dd-wpart">' + part.split('').map((ch) => {
        const idx = i++;
        if (!/[a-z]/i.test(ch)) return `<span class="dd-l sym">${esc(ch)}</span>`;
        return shown(idx) ? `<span class="dd-l on">${esc(ch)}</span>` : '<span class="dd-l"></span>';
      }).join('') + '</span>';
      i++;   // the space
      return html;
    }).join('<span class="dd-gap"></span>') + '</span>';
  }

  // ---------- Page ----------
  let el = {};
  let user = '';
  let board = null;
  let raf = 0;
  let mode = 'menu';         // menu | multi | practice
  let M = null;              // the multiplayer round
  let P = null;              // practice
  const tool = { t: 'pen', c: 0, s: 1 };
  let drawing = null;        // the pointer that is drawing
  let viewVer = -1;
  const queue = [];          // guessers: drawing commands waiting to be animated in
  let pencilAt = 0;
  let canDraw = false;

  function build(root) {
    root.innerHTML = `<div class="dd">
      <div class="dd-bg" aria-hidden="true"></div>
      <section class="dd-menu" aria-label="Doodle Guess">
        <div class="dd-menu-in">
          <div class="dd-hero">${heroSvg()}</div>
          <h2 class="dd-title" aria-label="Doodle Guess">${'Doodle'.split('').map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}<span class="sp"></span>${'Guess'.split('').map((c, i) => `<span style="--i:${i + 7}">${c}</span>`).join('')}</h2>
          <p class="dd-tag">Draw it. Guess it. Giggle a lot.</p>
          <div class="dd-actions">
            <button type="button" class="dd-btn primary big" data-act="family">${G.icon('users', 22)}<span>Play with the family</span></button>
            <div class="dd-actions-row">
              <button type="button" class="dd-btn" data-act="practice">${ic('brush', 19)}<span>Practice drawing</span></button>
              <button type="button" class="dd-btn" data-act="gallery">${G.icon('image', 19)}<span>My gallery</span><em class="dd-count"></em></button>
            </div>
          </div>
          <ol class="dd-steps">
            <li><span class="si" style="--c:#f43f5e">${ic('pen', 18)}</span><div><b>One person draws</b><span>Pick a secret word and draw it. No letters allowed!</span></div></li>
            <li><span class="si" style="--c:#3b82f6">${G.icon('chat', 18)}</span><div><b>Everyone guesses</b><span>Type guesses as the picture appears. Faster is more points.</span></div></li>
            <li><span class="si" style="--c:#f59e0b">${G.icon('trophy', 18)}</span><div><b>Take turns</b><span>Everyone gets a go at drawing. 2–8 players.</span></div></li>
          </ol>
        </div>
      </section>
      <section class="dd-game" hidden>
        <div class="dd-main">
          <div class="dd-hud">
            <div class="dd-hud-l"><span class="dd-timer" hidden>${G.icon('clock', 16)}<b>75</b></span><button type="button" class="dd-ibtn dd-home" aria-label="Back to the menu" hidden>${G.icon('home', 20)}</button></div>
            <div class="dd-hud-c" aria-live="polite"></div>
            <div class="dd-hud-r"><span class="dd-turn" hidden></span><span class="dd-pbtns" hidden><button type="button" class="dd-ibtn" data-p="word" aria-label="New word">${G.icon('shuffle', 19)}</button><button type="button" class="dd-ibtn" data-p="save" aria-label="Save to my gallery">${G.icon('save', 19)}</button><button type="button" class="dd-ibtn" data-p="gallery" aria-label="My gallery">${G.icon('image', 19)}</button></span></div>
          </div>
          <div class="dd-boardbox">
            <div class="dd-paper">
              <canvas class="dd-cv" aria-label="Drawing"></canvas>
              <div class="dd-pencil" aria-hidden="true">${ic('pen', 22)}</div>
              <div class="dd-over" hidden></div>
            </div>
          </div>
          <div class="dd-tools" hidden>
            <div class="dd-colors" role="radiogroup" aria-label="Colour">${PALETTE.map((p, i) => `<button type="button" class="dd-sw" role="radio" data-c="${i}" style="--c:${p.c}" aria-label="${p.n}"></button>`).join('')}</div>
            <div class="dd-trow">
              <div class="dd-seg">
                <button type="button" class="dd-tool" data-t="pen" aria-label="Pen">${ic('pen', 20)}</button>
                <button type="button" class="dd-tool" data-t="eraser" aria-label="Eraser">${ic('eraser', 20)}</button>
                <button type="button" class="dd-tool" data-t="fill" aria-label="Fill">${ic('bucket', 20)}</button>
              </div>
              <div class="dd-seg dd-sizes" role="radiogroup" aria-label="Pen size">${SIZES.map((s, i) => `<button type="button" class="dd-size" role="radio" data-s="${i}" aria-label="Size ${i + 1}"><i style="--d:${[5, 9, 14, 20][i]}px"></i></button>`).join('')}</div>
              <div class="dd-seg">
                <button type="button" class="dd-tool" data-t="undo" aria-label="Undo">${G.icon('undo', 20)}</button>
                <button type="button" class="dd-tool" data-t="clear" aria-label="Clear the picture">${G.icon('trash', 20)}</button>
              </div>
            </div>
          </div>
        </div>
        <aside class="dd-side">
          <div class="dd-players"></div>
          <div class="dd-feed" role="log" aria-live="polite" aria-label="Guesses"></div>
          <form class="dd-guess" autocomplete="off">
            <label class="dd-glabel" for="dd-in">${G.icon('chat', 17)}<span>Guess</span></label>
            <input id="dd-in" class="dd-in" type="text" maxlength="32" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" aria-label="Type your guess">
            <button type="submit" class="dd-send" aria-label="Send guess">${G.icon('send', 19)}</button>
          </form>
        </aside>
      </section>
      <section class="dd-end" hidden></section>
      <canvas class="dd-fx" aria-hidden="true"></canvas>
    </div>`;
    el = {
      wrap: $('.dd', root), menu: $('.dd-menu', root), game: $('.dd-game', root), end: $('.dd-end', root),
      main: $('.dd-main', root), hud: $('.dd-hud', root), hudC: $('.dd-hud-c', root), timer: $('.dd-timer', root), timerB: $('.dd-timer b', root),
      turn: $('.dd-turn', root), home: $('.dd-home', root), pbtns: $('.dd-pbtns', root),
      box: $('.dd-boardbox', root), paper: $('.dd-paper', root), cv: $('.dd-cv', root), over: $('.dd-over', root), pencil: $('.dd-pencil', root),
      tools: $('.dd-tools', root), side: $('.dd-side', root), players: $('.dd-players', root), feed: $('.dd-feed', root),
      form: $('.dd-guess', root), input: $('.dd-in', root), fx: $('.dd-fx', root), count: $('.dd-count', root)
    };
    board = new Board();

    el.menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.act === 'family') G.openLobby();
      if (b.dataset.act === 'practice') startPractice();
      if (b.dataset.act === 'gallery') openGallery();
    });
    el.tools.addEventListener('click', onTool);
    el.pbtns.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b || !P) return;
      if (b.dataset.p === 'word') { G.sfx('flip'); newPracticeWord(); }
      if (b.dataset.p === 'save') savePractice();
      if (b.dataset.p === 'gallery') openGallery();
    });
    el.hudC.addEventListener('click', (e) => { if (P && e.target.closest('[data-p="level"]')) { P.level = (P.level + 1) % 3; G.sfx('click'); newPracticeWord(); } });
    el.home.addEventListener('click', () => { G.sfx('click'); showMenu(); });
    el.form.addEventListener('submit', (e) => { e.preventDefault(); submitGuess(); });
    el.over.addEventListener('click', onOverlayClick);
    el.end.addEventListener('click', onEndClick);

    el.cv.addEventListener('pointerdown', onDown);
    el.cv.addEventListener('pointermove', onMove);
    el.cv.addEventListener('pointerup', onUp);
    el.cv.addEventListener('pointercancel', onUp);
    el.cv.addEventListener('lostpointercapture', onUp);
    el.cv.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', layout);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fitViewport);
    if (window.ResizeObserver) new ResizeObserver(() => layout()).observe(el.wrap);
    paintTools();
    raf = requestAnimationFrame(loop);
    // The menu shows the same animated scene as the games page banner (with the built-in one as a fallback).
    fetch('banner.html', { cache: 'force-cache' }).then((r) => (r.ok ? r.text() : '')).then((html) => {
      if (html && html.includes('bn-doodle')) $('.dd-hero', root).innerHTML = html;
    }).catch(() => { /* keep the built-in picture */ });
  }

  // ---------- Layout ----------
  function fitViewport() {
    const vv = window.visualViewport;
    if (!vv || !el.wrap) return;
    const host = el.wrap.parentElement.getBoundingClientRect();
    const h = Math.round(vv.height + vv.offsetTop - host.top);
    if (h > 120 && h < host.height - 40) el.wrap.style.height = h + 'px'; else el.wrap.style.removeProperty('height');
    layout();
  }
  function layout() {
    if (!el.wrap || el.game.hidden) return;
    const r = el.wrap.getBoundingClientRect();
    const wide = r.width >= 760 && r.width > r.height * 1.05;
    el.game.classList.toggle('wide', wide);
    el.game.classList.toggle('short', !wide && r.height < 640);
    const drawerTools = !el.tools.hidden;
    const mainW = el.main.clientWidth;
    const pad = wide ? 32 : 16;
    const hudH = el.hud.offsetHeight + 8;
    const toolsH = drawerTools ? el.tools.offsetHeight + 8 : 0;
    let bw, bh;
    if (wide) {
      bh = Math.max(120, r.height - hudH - toolsH - 24);
      bw = Math.min(mainW - pad, bh * W / H);
    } else {
      const sideMin = mode === 'practice' ? 0 : (drawerTools ? 120 : 200);
      bh = Math.max(110, Math.min((mainW - pad) * H / W, r.height - hudH - toolsH - sideMin - 16));
      bw = bh * W / H;
    }
    bh = bw * H / W;
    el.paper.style.width = Math.floor(bw) + 'px';
    el.paper.style.height = Math.floor(bh) + 'px';
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const cw = Math.round(Math.floor(bw) * dpr), chh = Math.round(Math.floor(bh) * dpr);
    if (el.cv.width !== cw || el.cv.height !== chh) { el.cv.width = cw; el.cv.height = chh; viewVer = -1; }
    sizeFx();
  }
  function renderView() {
    if (!board || viewVer === board.ver || el.game.hidden) return;
    viewVer = board.ver;
    const c = el.cv.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(board.cv, 0, 0, el.cv.width, el.cv.height);
  }

  // ---------- Tools ----------
  function paintTools() {
    $$('.dd-sw', el.tools).forEach((b) => { const on = tool.t !== 'eraser' && Number(b.dataset.c) === tool.c; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $$('.dd-size', el.tools).forEach((b) => { const on = Number(b.dataset.s) === tool.s; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $$('.dd-tool[data-t="pen"],.dd-tool[data-t="eraser"],.dd-tool[data-t="fill"]', el.tools).forEach((b) => { const on = b.dataset.t === tool.t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    el.tools.style.setProperty('--ink', tool.t === 'eraser' ? '#d4d4d8' : PALETTE[tool.c].c);
    el.cv.dataset.tool = tool.t;
  }
  function onTool(e) {
    const sw = e.target.closest('.dd-sw'), sz = e.target.closest('.dd-size'), tb = e.target.closest('.dd-tool');
    if (sw) { tool.c = Number(sw.dataset.c); if (tool.t === 'eraser') tool.t = 'pen'; G.sfx('click'); }
    else if (sz) { tool.s = Number(sz.dataset.s); if (tool.t === 'fill') tool.t = 'pen'; G.sfx('click'); }
    else if (tb) {
      const t = tb.dataset.t;
      if (t === 'undo') { doUndo(); return; }
      if (t === 'clear') { doClear(); return; }
      tool.t = t;
      G.sfx('click');
    } else return;
    paintTools();
  }
  function doUndo() {
    if (!canDraw || !board.actions.length) return;
    drawing = null;
    recOp('u');
    board.undo();
    G.sfx('flip');
  }
  function doClear() {
    if (!canDraw || board.blank()) return;
    drawing = null;
    recOp('c');
    board.clear();
    G.sfx('whoosh');
    if (P) G.toast('Cleared. Undo brings it back.');
  }

  // ---------- Recording ops (the artist) ----------
  const rec = { ops: [], pend: '', np: 0, lx: 0, ly: 0, e: '' };
  function recReset(e) { rec.ops = []; rec.pend = ''; rec.np = 0; rec.e = e || ''; }
  function recFlush() { if (rec.pend) { rec.ops.push('p' + rec.pend); rec.pend = ''; rec.np = 0; } }
  function recOp(s) { recFlush(); rec.ops.push(s); }

  function gridPoint(e) {
    const r = el.cv.getBoundingClientRect();
    return [clamp(Math.round((e.clientX - r.left) / r.width * W), 0, W - 1), clamp(Math.round((e.clientY - r.top) / r.height * H), 0, H - 1)];
  }
  function onDown(e) {
    if (!canDraw || drawing || G.modalOpen() || G.countingDown()) return;
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    const [x, y] = gridPoint(e);
    if (tool.t === 'fill') {
      recOp('f' + CH[tool.c] + n2(x) + n2(y));
      board.fill(tool.c, x, y);
      G.sfx('drop');
      return;
    }
    drawing = { id: e.pointerId, x, y };
    try { el.cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const c = tool.t === 'eraser' ? ERASER : tool.c;
    recOp('b' + CH[c] + CH[tool.s] + n2(x) + n2(y));
    rec.lx = x; rec.ly = y;
    board.begin(c, tool.s, x, y);
  }
  function onMove(e) {
    if (!drawing || e.pointerId !== drawing.id) return;
    if (!canDraw) { drawing = null; return; }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y] = gridPoint(ev);
      if (Math.hypot(x - drawing.x, y - drawing.y) < 3) continue;
      drawing.x = x; drawing.y = y;
      rec.pend += encD(x - rec.lx) + encD(y - rec.ly);
      rec.lx = x; rec.ly = y;
      if (++rec.np >= 80) recFlush();
      board.point(x, y);
    }
  }
  function onUp(e) {
    if (!drawing || (e.pointerId !== undefined && e.pointerId !== drawing.id)) return;
    if (e.type === 'pointerup' && canDraw) {
      const [x, y] = gridPoint(e);
      if (x !== drawing.x || y !== drawing.y) {
        rec.pend += encD(x - rec.lx) + encD(y - rec.ly);
        rec.lx = x; rec.ly = y;
        board.point(x, y);
      }
    }
    drawing = null;
    recFlush();
  }
  function setCanDraw(on) {
    canDraw = !!on;
    if (!on) drawing = null;
    el.paper.classList.toggle('drawable', canDraw);
  }

  // ---------- Keys ----------
  function onKey(e) {
    if (G.modalOpen() || e.altKey) return;
    const typing = document.activeElement === el.input;
    if (canDraw && !typing) {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); doUndo(); return; }
      if (e.ctrlKey || e.metaKey) return;
      if (k === 'b' || k === 'p') { tool.t = 'pen'; paintTools(); return; }
      if (k === 'e') { tool.t = 'eraser'; paintTools(); return; }
      if (k === 'f' || k === 'g') { tool.t = 'fill'; paintTools(); return; }
      if (k >= '1' && k <= '4') { tool.s = Number(k) - 1; if (tool.t === 'fill') tool.t = 'pen'; paintTools(); return; }
      if (k === '[') { tool.s = Math.max(0, tool.s - 1); paintTools(); return; }
      if (k === ']') { tool.s = Math.min(SIZES.length - 1, tool.s + 1); paintTools(); return; }
      return;
    }
    // A guesser can just start typing.
    if (mode === 'multi' && !typing && !el.input.disabled && !el.side.hidden && e.key.length === 1 && !e.ctrlKey && !e.metaKey && /\S/.test(e.key)) el.input.focus();
  }

  // ---------- Menu ----------
  function galleryList() { const g = store.get(GALLERY_KEY); return Array.isArray(g) ? g : []; }
  function showMenu() {
    mode = 'menu';
    M = null; P = null;
    setCanDraw(false);
    queue.length = 0;
    el.game.hidden = true;
    el.end.hidden = true;
    el.menu.hidden = false;
    document.body.classList.remove('dd-multi');
    el.menu.classList.remove('in'); void el.menu.offsetWidth; el.menu.classList.add('in');
    const n = galleryList().length;
    el.count.textContent = n ? String(n) : '';
  }
  function showGame(kind) {
    mode = kind;
    el.menu.hidden = true;
    el.end.hidden = true;
    el.game.hidden = false;
    el.game.classList.toggle('practice', kind === 'practice');
    el.side.hidden = kind === 'practice';
    el.home.hidden = kind !== 'practice';
    el.pbtns.hidden = kind !== 'practice';
    el.timer.hidden = kind === 'practice';
    el.turn.hidden = kind === 'practice';
    el.over.hidden = true;
    el.over.innerHTML = '';
    viewVer = -1;
    layout();
  }
  function showTools(on) {
    if (el.tools.hidden === !on) return;
    el.tools.hidden = !on;
    layout();
  }

  // ---------- Practice ----------
  function startPractice() {
    G.closeModal();
    const saved = store.get(PRACTICE_KEY) || {};
    P = { level: clamp(Number(saved.level) || 0, 0, 2), word: '' };
    board.reset();
    recReset();
    queue.length = 0;
    showGame('practice');
    showTools(true);
    setCanDraw(true);
    newPracticeWord();
  }
  function newPracticeWord() {
    const list = WORDS[LEVELS[P.level].id];
    let w = P.word;
    for (let n = 0; n < 6 && w === P.word; n++) w = list[Math.floor(Math.random() * list.length)];
    P.word = w;
    store.set(PRACTICE_KEY, { level: P.level });
    const lv = LEVELS[P.level];
    el.hudC.innerHTML = `<div class="dd-prompt pop"><span class="dd-plabel">Draw</span><b>${esc(w)}</b><button type="button" class="dd-lv" data-p="level" style="--c:${lv.color}" aria-label="Word level: ${lv.name}. Tap to change">${lv.name}</button></div>`;
  }
  function savePractice() {
    if (board.blank()) { G.toast('Draw something first!'); G.sfx('wrong'); return; }
    const item = { id: Date.now().toString(36), word: P.word, at: Date.now(), img: board.image(600, 0.85) };
    if (addToGallery(item)) { G.toast('Saved to your gallery'); G.sfx('coin'); burstAt(el.paper, 26); }
  }
  function addToGallery(item) {
    let list = [item].concat(galleryList()).slice(0, GALLERY_MAX);
    while (list.length) {
      if (store.set(GALLERY_KEY, list)) return true;
      list = list.slice(0, -1);
      if (!list.length || list[0] !== item) break;
    }
    G.toast('Your gallery is full. Delete a drawing to make room.');
    return false;
  }
  function openGallery() {
    const list = galleryList();
    const card = G.modal(`<div class="cg-hero plain">${G.badge('doodle', 52)}</div><h2>My gallery</h2>` +
      (list.length ? `<p class="cg-sub">${list.length} drawing${list.length === 1 ? '' : 's'} saved on this device</p><div class="dd-gal">${list.map((g) => `<button type="button" class="dd-gi" data-id="${esc(g.id)}" aria-label="${esc(g.word)}"><img src="${g.img}" alt=""><span>${esc(g.word)}</span></button>`).join('')}</div>`
        : `<p class="cg-sub">Nothing here yet.</p><p>Tap <b>Practice drawing</b>, draw the word and press the save button to keep your masterpiece.</p>`) +
      `<div class="cg-row"><button type="button" class="primary" data-cg="close">Close</button></div>`, { wide: true });
    card.classList.add('dd-galcard');
    card.addEventListener('click', (e) => {
      const b = e.target.closest('.dd-gi');
      if (b) viewDrawing(b.dataset.id);
    });
  }
  function viewDrawing(id) {
    const g = galleryList().find((x) => x.id === id);
    if (!g) return;
    const d = new Date(g.at);
    const card = G.modal(`<h2>${esc(g.word)}</h2><p class="cg-sub">${esc(d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))}</p><img class="dd-big" src="${g.img}" alt="${esc(g.word)}">` +
      `<div class="cg-row"><button type="button" data-g="back">${G.icon('back', 18)} Back</button><a class="cg-btn dd-dl" href="${g.img}" download="doodle-${esc(norm(g.word))}.jpg">${ic('download', 18)} Save</a><button type="button" data-g="del">${G.icon('trash', 18)} Delete</button></div>`, { wide: true });
    card.classList.add('dd-galview');
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]');
      if (!b) return;
      if (b.dataset.g === 'back') openGallery();
      if (b.dataset.g === 'del') {
        store.set(GALLERY_KEY, galleryList().filter((x) => x.id !== id));
        G.sfx('drop');
        el.count.textContent = galleryList().length ? String(galleryList().length) : '';
        openGallery();
      }
    });
  }

  // ---------- Multiplayer ----------
  function startMulti(info) {
    G.closeModal();
    const sess = G.session();
    const rand = G.rng(info.seed);
    // The players fixed when the round started (from roundSetup), so a late joiner gets the same game.
    const fixed = info.shared && Array.isArray(info.shared.players) ? info.shared.players.filter((n) => typeof n === 'string').slice(0, 8) : [];
    const players = fixed.length >= 2 ? fixed : info.players.slice();
    const palette = {};
    info.players.forEach((n, i) => { palette[n] = info.colors[i]; });
    const colors = players.map((n, i) => palette[n] || G.colors[(i + 3) % G.colors.length]);
    const order = shuffle(players, rand);
    const turns = players.length <= 3 ? players.length * 2 : players.length;
    const pools = LEVELS.map((l) => shuffle(WORDS[l.id], rand));
    const words = [], hints = [];
    for (let k = 0; k < turns; k++) {
      words.push(pools.map((p) => p[k % p.length]));
      hints.push(words[k].map((w) => shuffle(w.split('').map((c, i) => (/[a-z]/i.test(c) ? i : -1)).filter((i) => i >= 0), rand)));
    }
    const key = `chowaniec_doodle_${sess ? sess.id : 'x'}_${info.round || 0}`;
    const saved = store.get(key);
    const S = saved && saved.v === 1 ? saved : { v: 1, sv: [], wc: [], g: [], gid: 0 };
    if (!S.fz) S.fz = [];
    M = {
      info, players, colors, me: info.me, order, turns, words, hints, key, S, watching: !players.includes(info.me), cache: {},
      startAt: info.startAt || (sess && sess.startAt ? Date.parse(sess.startAt) : Date.now()),
      k: -1, phase: '', others: {}, othersAt: 0, lastPush: 0, lastSave: 0, lastStrip: 0,
      seen: {}, solvedSeen: {}, closeSeen: {}, thumbs: {}, rx: null, snap: null, lastTick: 0, ended: false,
      lastGuessAt: 0, gains: {}, created: Date.now(), synced: false
    };
    // Old rounds' saved state is no longer needed.
    try { Object.keys(localStorage).filter((k) => k.startsWith('chowaniec_doodle_') && !k.startsWith(key) && k !== GALLERY_KEY && k !== PRACTICE_KEY).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    el.feed.innerHTML = '';
    el.players.classList.remove('compact');
    board.reset();
    queue.length = 0;
    document.body.classList.add('dd-multi');
    showGame('multi');
    addFeed('sys', `${G.icon('sparkles', 15)}<span>Welcome to Doodle Guess! ${M.turns} turns, ${M.turns > players.length ? 'everyone draws twice' : 'everyone draws once'}.</span>`);
    M.synced = Date.now() - M.startAt < 3000;    // a fresh round: nothing to catch up on
    if (M.watching) addFeed('sys', `${G.icon('eye', 15)}<span>This round started without you, so you’re watching. You’ll play in the next one!</span>`);
    else if (Date.now() - M.startAt > 4000) addFeed('sys', `${G.icon('refresh', 15)}<span>You’re back in the game!</span>`);
    multiFrame(Date.now());
  }

  const drawerOf = (k) => M.order[k % M.order.length];
  const colorOf = (name) => { const i = M.players.indexOf(name); return i >= 0 ? M.colors[i] : '#a1a1aa'; };
  const initial = (name) => esc(String(name || '?').trim().charAt(0).toUpperCase());
  function stateOf(name) {
    if (name === M.me) return M.S;
    const o = M.others[name];
    return o && o.state ? o.state : null;
  }
  function solveTime(name, k, ds, full) {
    const st = stateOf(name);
    const v = st && Array.isArray(st.sv) ? Number(st.sv[k]) : 0;
    return v && v >= ds && v <= full ? v : null;
  }
  function turnTimes(k, ts) {
    const drawer = drawerOf(k);
    const st = stateOf(drawer);
    const wc = st && Array.isArray(st.wc) ? st.wc[k] : null;
    const known = Array.isArray(wc);
    const drawStart = known ? clamp(Number(wc[1]) || 0, ts, ts + CHOOSE_MS) : ts + CHOOSE_MS;
    const idx = known ? clamp(Number(wc[0]) || 0, 0, 2) : 0;
    const full = ts + TURN_MS;
    // An artist who never picked a word (left, or their phone is asleep) is skipped.
    let end = known ? full : ts + CHOOSE_MS + SKIP_MS;
    const guessers = M.players.filter((n) => n !== drawer);
    const solves = [];
    if (known) {
      for (const n of guessers) { const v = solveTime(n, k, drawStart, full); if (v != null) solves.push([n, v]); }
      if (guessers.length && solves.length === guessers.length) end = Math.min(full, Math.max(...solves.map((s) => s[1])) + GRACE_MS);
    }
    return { k, ts, drawer, known, idx, drawStart, full, end, guessers, solves, word: M.words[k][idx], level: idx };
  }
  // Where the shared clock is now: which turn, which phase, plus every turn so far (for the scores).
  function schedule(now) {
    const t = now - M.startAt;
    const list = [];
    let ts = 0;
    for (let k = 0; k < M.turns; k++) {
      // A finished turn is frozen, so nothing that arrives later (or someone leaving) can rewrite the past.
      const ti = M.S.fz[k] && M.S.fz[k].ts === ts ? M.S.fz[k] : turnTimes(k, ts);
      list.push(ti);
      if (t < ti.end + REVEAL_MS) return Object.assign({ t, list, phase: t < ti.drawStart ? 'choose' : t < ti.end ? 'draw' : 'reveal' }, ti);
      if (!M.S.fz[k] && M.synced) M.S.fz[k] = ti;
      ts = ti.end + REVEAL_MS;
    }
    return { t, list, k: M.turns, ts, phase: 'end' };
  }
  // Points for one turn: { name: points }.
  function turnPoints(ti) {
    const pts = {};
    const mult = LEVELS[ti.level].mult;
    const sorted = ti.solves.filter((s) => s[1] <= ti.end).sort((a, b) => a[1] - b[1]);
    sorted.forEach(([n, v], i) => {
      const speed = clamp((ti.full - v) / Math.max(1, ti.full - ti.drawStart), 0, 1);
      pts[n] = round5((100 + 200 * speed + (i === 0 ? 50 : 0)) * mult);
    });
    if (sorted.length) pts[ti.drawer] = round5((sorted.length * 50 + (sorted.length === ti.guessers.length ? 50 : 0)) * mult);
    return pts;
  }
  function totals(sch, upto) {
    const tot = {};
    M.players.forEach((n) => { tot[n] = 0; });
    sch.list.forEach((ti) => {
      if (upto != null && ti.k > upto) return;
      const p = turnPoints(ti);
      Object.keys(p).forEach((n) => { if (n in tot) tot[n] += p[n]; });
    });
    return tot;
  }

  function multiFrame(now) {
    if (!M) return;
    if (now - M.othersAt > 100) {
      M.othersAt = now;
      const m = {};
      G.race.others().forEach((o) => { m[o.name] = o; M.cache[o.name] = o; });
      // Keep the last state of someone who left, so their guesses still count.
      M.players.forEach((n) => { if (!m[n] && M.cache[n] && n !== M.me) m[n] = Object.assign({}, M.cache[n], { gone: true }); });
      M.others = m;
      // Wait for everyone's states before working out where the game is (a reload or a late join).
      if (!M.synced && (Object.keys(m).length || now - M.created > 5000)) M.synced = true;
    }
    if (!M.synced) {
      if (el.over.hidden) { el.over.hidden = false; el.over.className = 'dd-over choose'; el.over.innerHTML = `<div class="dd-wait"><div class="dd-wait-art">${pencilArt()}</div><h3>Joining the game…</h3></div>`; }
      return;
    }
    const sch = schedule(now);
    const iDraw = sch.phase !== 'end' && drawerOf(sch.k) === M.me;
    // The artist didn't pick in time: the Easy word.
    if (iDraw && sch.phase !== 'choose' && !Array.isArray(M.S.wc[sch.k]) && sch.t < sch.ts + CHOOSE_MS + SKIP_MS - 2000) {
      M.S.wc[sch.k] = [0, sch.ts + CHOOSE_MS];
      push(true);
      return multiFrame(now);
    }
    if (sch.k !== M.k || sch.phase !== M.phase) { enterPhase(sch, iDraw); M.lastKnown = sch.known; }
    if (M.phase === 'end') return;
    if (M.lastKnown !== sch.known) { M.lastKnown = sch.known; updateInput(sch, iDraw); }
    if (!iDraw) receive(sch);
    hudFrame(sch, iDraw);
    if (now - M.lastStrip > 250) { M.lastStrip = now; feedFromOthers(sch); renderPlayers(sch); }
    if (now - M.lastPush > PUSH_MS) push(false, sch);
  }

  function enterPhase(sch, iDraw) {
    const newTurn = sch.k !== M.k;
    const prevPhase = M.phase;
    if (newTurn && M.k >= 0 && M.k < M.turns && !M.thumbs[M.k] && prevPhase !== '') snapThumb(M.k);
    M.k = sch.k;
    M.phase = sch.phase;
    if (sch.phase === 'end') { setCanDraw(false); showTools(false); return podium(sch); }
    if (newTurn) {
      board.reset();
      queue.length = 0;
      M.rx = { e: '', seq: 0, st: { x: 0, y: 0 }, snap: null, ref: null };
      M.snap = null;
      if (iDraw) restoreDrawing(sch.k);
      M.closeSeen = {};
      addFeed('turn', `${ic('pen', 15)}<span><b style="color:${colorOf(sch.drawer)}">${esc(sch.drawer === M.me ? 'You' : sch.drawer)}</b> ${sch.drawer === M.me ? 'are' : 'is'} drawing · turn ${sch.k + 1} of ${M.turns}</span>`);
      if (prevPhase) G.sfx('whoosh');
    }
    el.game.classList.toggle('drawing', iDraw && sch.phase === 'draw');
    showTools(iDraw && sch.phase === 'draw');
    setCanDraw(iDraw && sch.phase === 'draw');
    el.over.hidden = true;
    el.over.className = 'dd-over';
    el.paper.classList.remove('done');
    if (sch.phase === 'choose') renderChoose(sch, iDraw);
    if (sch.phase === 'draw') {
      if (iDraw) {
        if (!rec.e) recReset(Math.random().toString(36).slice(2, 7));
        if (prevPhase === 'choose') G.sfx('go');
      } else if (prevPhase === 'choose') G.sfx('flip');
    }
    if (sch.phase === 'reveal') renderReveal(sch);
    updateInput(sch, iDraw);
    renderPlayers(sch);
    layout();
  }

  // The artist's ops for this turn survive a reload.
  const drawKey = (k) => `${M.key}_d${k}`;
  function restoreDrawing(k) {
    const d = store.get(drawKey(k));
    recReset(d && d.e ? d.e : '');
    if (!d || !Array.isArray(d.ops)) return;
    rec.ops = d.ops.slice();
    const st = { x: 0, y: 0 };
    rec.ops.forEach((op) => decodeOp(op, st).forEach((c) => board.run(c)));
    rec.lx = st.x; rec.ly = st.y;
  }
  function saveDrawing() {
    if (!M || M.k < 0 || drawerOf(M.k) !== M.me || !rec.e) return;
    store.set(drawKey(M.k), { e: rec.e, ops: rec.ops });
  }

  // ----- sending my state -----
  function push(force, schIn) {
    if (!M) return;
    const now = Date.now();
    M.lastPush = now;
    const sch = schIn || schedule(now);
    const tot = totals(sch);
    const S = M.S;
    const st = { score: tot[M.me] || 0, k: sch.k, sv: S.sv, wc: S.wc, g: S.g.slice(-6) };
    const iDraw = sch.phase !== 'end' && drawerOf(sch.k) === M.me;
    if (iDraw && rec.e) {
      recFlush();
      const n = rec.ops.length;
      // The newest ops, back to the slowest guesser's ack, within the budget.
      let minAck = n;
      // Everyone else watching the paper (players and anyone who joined late to watch).
      Object.keys(M.others).forEach((g) => {
        if (M.others[g].gone) return;
        const o = stateOf(g);
        const ak = o && Array.isArray(o.ak) && o.ak[0] === sch.k && o.ak[1] === rec.e ? Number(o.ak[2]) || 0 : 0;
        minAck = Math.min(minAck, ak);
      });
      let s0 = n, size = 0;
      while (s0 > minAck && size + rec.ops[s0 - 1].length + 3 <= OPS_BUDGET) { s0--; size += rec.ops[s0].length + 3; }
      st.d = { k: sch.k, e: rec.e, s0, o: rec.ops.slice(s0) };
      // Anyone behind the window gets the snapshot, a chunk per update.
      if (n && minAck < s0) {
        let sn = M.snap;
        if (!sn || (sn.q < n && sn.sent >= sn.parts.length * 2 && now - sn.at > 2500)) {
          const s = snapshotOf(board.actions);
          const parts = [];
          for (let i = 0; i < s.length; i += SNAP_CHUNK) parts.push(s.slice(i, i + SNAP_CHUNK));
          sn = M.snap = { q: n, parts: parts.length ? parts : [''], i: 0, at: now, sent: 0, switched: now };
        }
        if (now - sn.switched > 380) { sn.i = (sn.i + 1) % sn.parts.length; sn.switched = now; sn.sent++; }
        st.sn = { k: sch.k, e: rec.e, q: sn.q, n: sn.parts.length, i: sn.i, c: sn.parts[sn.i] };
      }
      while (JSON.stringify(st).length > STATE_MAX && st.d.o.length) { st.d.o.shift(); st.d.s0++; }
      if (now - M.lastSave > 700) { M.lastSave = now; saveDrawing(); }
    } else if (M.rx) st.ak = [sch.k, M.rx.e, M.rx.seq];
    G.race.update(st);
    M.lastState = st;
    if (iDraw) M.maxState = Math.max(M.maxState || 0, JSON.stringify(st).length);
    if (force || now - M.lastSave > 700) { M.lastSave = now; store.set(M.key, S); if (iDraw) saveDrawing(); }
  }

  // ----- receiving the drawing -----
  function receive(sch) {
    if (sch.phase === 'end') return;
    const o = M.others[sch.drawer];
    const st = o && o.state;
    const rx = M.rx;
    if (!st || !rx || st === rx.ref) return;
    rx.ref = st;
    const d = st.d;
    if (!d || d.k !== sch.k || typeof d.e !== 'string' || !Array.isArray(d.o)) return;
    const s0 = Number(d.s0) || 0, end = s0 + d.o.length;
    if (d.e !== rx.e || end < rx.seq) {
      // A fresh drawing (or the artist's phone started over).
      rx.e = d.e; rx.seq = 0; rx.st = { x: 0, y: 0 }; rx.snap = null;
      if (board.actions.length) board.reset();
      queue.length = 0;
    }
    if (rx.seq < s0) {
      const sn = st.sn;
      if (sn && sn.k === sch.k && sn.e === d.e && typeof sn.c === 'string') {
        if (!rx.snap || rx.snap.q !== sn.q || rx.snap.n !== sn.n) rx.snap = { q: sn.q, n: sn.n, parts: {} };
        rx.snap.parts[sn.i] = sn.c;
        const have = Object.keys(rx.snap.parts).length;
        if (have >= rx.snap.n && rx.snap.q >= s0 && rx.snap.q <= end) {
          let s = '';
          for (let i = 0; i < rx.snap.n; i++) s += rx.snap.parts[i] || '';
          board.reset();
          queue.length = 0;
          rx.st = { x: 0, y: 0 };
          s.split('|').forEach((op) => decodeOp(op, rx.st).forEach((c) => board.run(c)));
          rx.seq = rx.snap.q;
          rx.snap = null;
          M.snapsLoaded = (M.snapsLoaded || 0) + 1;
          pencilAt = 0;
        }
      }
      if (rx.seq < s0) return;
    }
    for (let i = rx.seq; i < end; i++) queue.push(...decodeOp(d.o[i - s0], rx.st));
    rx.seq = end;
  }
  // Guessers: play the queued commands in over a few frames, so the picture flows on like live drawing.
  function drainQueue() {
    if (!queue.length) return;
    const n = Math.max(2, Math.ceil(queue.length / 14));
    for (let i = 0; i < n && queue.length; i++) board.run(queue.shift());
    pencilAt = performance.now();
  }
  function pencilFrame() {
    const show = mode === 'multi' && M && !canDraw && M.phase === 'draw' && board.last && performance.now() - pencilAt < 700;
    el.pencil.classList.toggle('on', !!show);
    if (show) {
      el.pencil.style.transform = `translate(${(board.last[0] / W * el.paper.clientWidth).toFixed(1)}px, ${(board.last[1] / H * el.paper.clientHeight).toFixed(1)}px)`;
    }
  }

  // ----- HUD -----
  function setHtml(node, html) { if (node.__html === html) return; node.__html = html; node.innerHTML = html; }
  function hudFrame(sch, iDraw) {
    let left;
    if (sch.phase === 'choose') left = sch.ts + CHOOSE_MS - sch.t;
    else if (sch.phase === 'draw') left = sch.end - sch.t;
    else left = 0;
    const secs = Math.max(0, Math.ceil(left / 1000));
    if (el.timerB.textContent !== String(secs)) {
      el.timerB.textContent = String(secs);
      if (sch.phase === 'draw' && secs <= 5 && secs > 0 && M.lastTick !== secs) { M.lastTick = secs; G.sfx('tick'); }
    }
    el.timer.classList.toggle('low', sch.phase === 'draw' && secs <= 10);
    el.timer.classList.toggle('idle', sch.phase !== 'draw');
    setHtml(el.turn, `<span><i class="lbl">Turn </i><b>${Math.min(sch.k + 1, M.turns)}</b>/${M.turns}</span>`);
    const solved = !iDraw && solveTime(M.me, sch.k, sch.drawStart, sch.full) != null;
    let html;
    if (sch.phase === 'choose') {
      html = iDraw ? '<div class="dd-status">Pick a word</div>' : `<div class="dd-status"><i class="dot" style="background:${colorOf(sch.drawer)}"></i>Picking a word…</div>`;
    } else if (!sch.known) {
      html = `<div class="dd-status">${sch.phase === 'reveal' ? 'Turn skipped' : `Waiting for ${esc(sch.drawer)}…`}</div>`;
    } else if (iDraw || solved || sch.phase === 'reveal') {
      html = `<div class="dd-reveal${solved ? ' ok' : ''}">${iDraw && sch.phase === 'draw' ? '<span class="dd-plabel">Draw</span>' : ''}<b class="dd-wtext">${esc(sch.word)}</b>${solved && sch.phase === 'draw' ? `<span class="dd-okmark">${G.icon('check', 16)}</span>` : ''}</div>`;
    } else {
      const frac = (sch.t - sch.drawStart) / Math.max(1, sch.full - sch.drawStart);
      const n = hintCount(sch.word, frac);
      const show = new Set(M.hints[sch.k][sch.idx].slice(0, n));
      html = `<div class="dd-hint">${slotsHtml(sch.word, (i) => show.has(i))}<small>${letterCount(sch.word)} letters</small></div>`;
    }
    setHtml(el.hudC, html);
    if (sch.phase === 'choose') {
      const c = $('.dd-ch-left', el.over);
      if (c) c.textContent = String(secs);
    }
    pencilFrame();
  }
  function updateInput(sch, iDraw) {
    const solved = !iDraw && sch.phase !== 'end' && solveTime(M.me, sch.k, sch.drawStart, sch.full) != null;
    const open = !iDraw && sch.phase === 'draw' && !solved && !M.watching && sch.known;
    el.input.disabled = !open;
    el.form.classList.toggle('off', !open);
    el.form.dataset.why = iDraw ? 'draw' : solved ? 'solved' : sch.phase;
    const lab = $('.dd-glabel span', el.form);
    lab.textContent = M.watching ? 'Watching' : iDraw ? 'You’re drawing' : solved ? 'You got it!' : sch.phase === 'draw' && sch.known ? 'Guess' : 'Wait…';
    if (!open && document.activeElement === el.input) el.input.blur();
    if (open && window.matchMedia && window.matchMedia('(pointer: fine)').matches && !G.modalOpen()) setTimeout(() => { if (!el.input.disabled) el.input.focus({ preventScroll: true }); }, 30);
  }

  // ----- word choice / reveal overlays -----
  function renderChoose(sch, iDraw) {
    el.over.hidden = false;
    el.over.className = 'dd-over choose';
    if (iDraw) {
      el.over.innerHTML = `<div class="dd-choose"><h3>Your turn to draw!</h3><p>Pick a word. Harder words score more.</p><div class="dd-chs">${M.words[sch.k].map((w, i) => `<button type="button" class="dd-ch" data-ch="${i}" style="--c:${LEVELS[i].color}"><span class="lv">${LEVELS[i].name}${i ? ` <em>×${LEVELS[i].mult}</em>` : ''}</span><b>${esc(w)}</b></button>`).join('')}</div><p class="dd-ch-t">${G.icon('timer', 15)} <span class="dd-ch-left">${Math.ceil((sch.ts + CHOOSE_MS - sch.t) / 1000)}</span></p></div>`;
      G.sfx('flip');
    } else {
      el.over.innerHTML = `<div class="dd-wait"><div class="dd-wait-art">${pencilArt()}</div><h3><i class="dot" style="background:${colorOf(sch.drawer)}"></i>${esc(sch.drawer)} is picking a word…</h3><p>Get ready to guess! <span class="dd-ch-left">${Math.ceil((sch.ts + CHOOSE_MS - sch.t) / 1000)}</span></p></div>`;
    }
  }
  function onOverlayClick(e) {
    const b = e.target.closest('[data-ch]');
    if (!b || !M || M.phase !== 'choose') return;
    const sch = schedule(Date.now());
    if (sch.phase !== 'choose' || drawerOf(sch.k) !== M.me || Array.isArray(M.S.wc[sch.k])) return;
    M.S.wc[sch.k] = [Number(b.dataset.ch), Math.max(sch.ts, Math.round(sch.t))];
    G.sfx('click');
    push(true);
    multiFrame(Date.now());
  }
  function renderReveal(sch) {
    const pts = turnPoints(sch);
    const rows = [sch.drawer].concat(sch.guessers).map((n) => ({ n, p: pts[n] || 0, drew: n === sch.drawer }));
    const got = sch.solves.length;
    el.over.hidden = false;
    el.over.className = 'dd-over reveal';
    el.paper.classList.add('done');
    if (!sch.known) {
      el.over.innerHTML = `<div class="dd-rev"><p class="dd-rev-k">Skipping a turn</p><h3 class="away">${esc(sch.drawer)} is away</h3><p class="dd-rev-n">On to the next artist!</p></div>`;
      G.sfx('drop');
      return;
    }
    el.over.innerHTML = `<div class="dd-rev"><p class="dd-rev-k">${sch.known ? 'The word was' : 'Skipping a turn'}</p>${sch.known ? `<h3>${esc(sch.word)}</h3>` : `<h3 class="away">${esc(sch.drawer)} is away</h3>`}<p class="dd-rev-n">${got === sch.guessers.length && got ? 'Everyone got it!' : got ? `${got} of ${sch.guessers.length} guessed it` : 'Nobody guessed it this time'}</p>` +
      `<ul class="dd-rev-l">${rows.map((r, i) => `<li style="--i:${i}"><i class="av" style="background:${colorOf(r.n)}">${initial(r.n)}</i><span>${esc(r.n === M.me ? 'You' : r.n)}${r.drew ? ` <small>${ic('pen', 12)} drew</small>` : ''}</span><b class="${r.p ? 'ok' : ''}">${r.p ? `+${fmt(r.p)}` : '0'}</b></li>`).join('')}</ul></div>`;
    const mine = pts[M.me] || 0;
    G.sfx(mine ? 'score' : 'drop');
    if (mine) burstAt(el.paper, 30);
    if (sch.known) addFeed('word', `${G.icon('eye', 15)}<span>The word was <b>${esc(sch.word)}</b></span>`);
    snapThumb(sch.k);
  }
  function snapThumb(k) {
    if (!M || M.thumbs[k] || board.blank()) return;
    const ti = schedule(Date.now()).list[k];
    M.thumbs[k] = { img: board.image(360, 0.8), word: ti ? ti.word : '', by: drawerOf(k) };
  }

  // ----- guesses -----
  function submitGuess() {
    if (!M || el.input.disabled || M.watching) return;
    const text = el.input.value.replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!text) return;
    const now = Date.now();
    if (now - M.lastGuessAt < 600) return;
    M.lastGuessAt = now;
    const sch = schedule(now);
    if (sch.phase !== 'draw' || drawerOf(sch.k) === M.me) return;
    el.input.value = '';
    const res = sch.known ? judge(text, sch.word) : 'wrong';
    if (res === 'right') {
      M.S.sv[sch.k] = Math.round(sch.t);
      push(true);
      const after = schedule(Date.now());
      const p = turnPoints(after.list[sch.k])[M.me] || 0;
      addFeed('me-ok', `${G.icon('check', 15)}<span>You guessed it! <b>${esc(sch.word)}</b></span><em>+${fmt(p)}</em>`);
      G.sfx('match');
      burstAt(el.paper, 40);
      flashPaper('ok');
      updateInput(after, false);
    } else if (res === 'close') {
      addFeed('close', `${G.icon('zap', 15)}<span><b>${esc(text)}</b> is so close!</span>`);
      G.sfx('flip');
      flashPaper('close');
    } else {
      M.S.gid += 1;
      M.S.g.push([M.S.gid, sch.k, text]);
      if (M.S.g.length > 12) M.S.g = M.S.g.slice(-12);
      addFeed('guess', `<i class="av" style="background:${colorOf(M.me)}">${initial(M.me)}</i><span><b>You</b> ${esc(text)}</span>`);
      push(true);
    }
  }
  function feedFromOthers(sch) {
    M.players.forEach((n) => {
      if (n === M.me) return;
      const st = stateOf(n);
      if (!st) return;
      const seen = M.seen[n] || 0;
      let top = seen;
      (Array.isArray(st.g) ? st.g : []).forEach((g) => {
        if (!Array.isArray(g)) return;
        const id = Number(g[0]) || 0;
        if (id <= seen) return;
        top = Math.max(top, id);
        if (g[1] === sch.k && sch.phase !== 'end') addFeed('guess', `<i class="av" style="background:${colorOf(n)}">${initial(n)}</i><span><b>${esc(n)}</b> ${esc(String(g[2] || '').slice(0, 32))}</span>`);
      });
      M.seen[n] = top;
      // Who has guessed the word.
      for (let k = 0; k <= Math.min(sch.k, M.turns - 1); k++) {
        const ti = sch.list[k];
        if (!ti) continue;
        const key = n + ':' + k;
        if (M.solvedSeen[key]) continue;
        const v = solveTime(n, k, ti.drawStart, ti.full);
        if (v == null) continue;
        M.solvedSeen[key] = true;
        if (k === sch.k && (sch.phase === 'draw' || sch.phase === 'reveal')) {
          addFeed('ok', `${G.icon('check', 15)}<span><b>${esc(n)}</b> guessed the word!</span>`);
          G.sfx('point');
          const chip = $(`.dd-pl[data-n="${CSS.escape(n)}"]`, el.players);
          if (chip) { chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop'); }
        }
      }
    });
  }
  function addFeed(kind, html) {
    const row = document.createElement('div');
    row.className = 'dd-msg ' + kind;
    row.innerHTML = html;
    el.feed.appendChild(row);
    while (el.feed.children.length > 80) el.feed.firstElementChild.remove();
    el.feed.scrollTop = el.feed.scrollHeight;
  }
  function flashPaper(kind) {
    el.paper.classList.remove('flash-ok', 'flash-close'); void el.paper.offsetWidth;
    el.paper.classList.add('flash-' + kind);
  }
  function renderPlayers(sch) {
    if (!M) return;
    const tot = totals(sch);
    const cur = sch.list[Math.min(sch.k, sch.list.length - 1)];
    const pts = cur && sch.phase !== 'end' ? turnPoints(cur) : {};
    setHtml(el.players, M.order.map((n) => {
      const drawingNow = cur && sch.phase !== 'end' && cur.drawer === n;
      const solved = cur && sch.phase !== 'end' && !drawingNow && cur.solves.some((s) => s[0] === n);
      const o = M.others[n];
      const away = n !== M.me && (!o || o.gone || o.age > 12000);
      return `<div class="dd-pl${n === M.me ? ' me' : ''}${drawingNow ? ' drawing' : ''}${solved ? ' solved' : ''}${away ? ' away' : ''}" data-n="${esc(n)}" style="--c:${colorOf(n)}">` +
        `<i class="av">${drawingNow ? ic('pen', 14) : solved ? G.icon('check', 14) : initial(n)}</i><span class="nm">${esc(n === M.me ? 'You' : n)}</span><b>${fmt(tot[n] || 0)}</b>${pts[n] && sch.phase === 'draw' ? `<em>+${fmt(pts[n])}</em>` : ''}</div>`;
    }).join(''));
    // Narrow phone and lots of players: drop the names (the coloured initials stay).
    if (!el.game.classList.contains('wide') && !el.players.classList.contains('compact') && el.players.scrollWidth > el.players.clientWidth + 2) el.players.classList.add('compact');
  }

  // ----- the end -----
  function podium(sch) {
    if (M.ended) return;
    M.ended = true;
    setCanDraw(false);
    const tot = totals(sch);
    const rows = M.players.map((n) => ({ name: n, score: tot[n] || 0, me: n === M.me, color: colorOf(n) })).sort((a, b) => b.score - a.score || (a.me ? -1 : 1));
    const top = rows[0];
    const tie = rows.length > 1 && rows[1].score === top.score;
    const title = tie ? 'It’s a tie at the top!' : top.me ? 'You win!' : `${esc(top.name)} wins!`;
    const order = [1, 0, 2].filter((k) => rows[k]);
    const thumbs = Object.keys(M.thumbs).map(Number).sort((a, b) => a - b).map((k) => Object.assign({ k }, M.thumbs[k]));
    el.game.hidden = true;
    el.end.hidden = false;
    el.end.innerHTML = `<div class="dd-end-in">
      <h2>${title}</h2>
      <div class="dd-podium">${order.map((k) => { const r = rows[k]; return `<div class="pd p${k + 1}${r.me ? ' me' : ''}" style="--c:${r.color}">
        <div class="av">${k === 0 ? `<span class="crown">${G.icon('crown', 26)}</span>` : ''}<i>${initial(r.name)}</i></div>
        <div class="nm">${esc(r.me ? 'You' : r.name)}</div><div class="sc" data-to="${r.score}">0</div>
        <div class="blk"><span>${k + 1}</span></div></div>`; }).join('')}</div>
      ${rows.length > 3 ? `<ol class="dd-rest" start="4">${rows.slice(3).map((r, k) => `<li class="${r.me ? 'me' : ''}"><span class="rk">${k + 4}</span><i class="dot" style="background:${r.color}"></i><span class="nm">${esc(r.name)}</span><span class="sc">${fmt(r.score)}</span></li>`).join('')}</ol>` : ''}
      ${thumbs.length ? `<h3>${G.icon('image', 16)} Tonight’s masterpieces</h3><p class="dd-sub">Tap one to keep it in your gallery</p><div class="dd-thumbs">${thumbs.map((t) => `<button type="button" class="dd-th" data-k="${t.k}"><img src="${t.img}" alt=""><span><b>${esc(t.word)}</b> by ${esc(t.by === M.me ? 'you' : t.by)}</span><em>${G.icon('save', 14)}</em></button>`).join('')}</div>` : ''}
    </div>`;
    $$('.dd-podium .sc', el.end).forEach((s) => countUp(s, Number(s.dataset.to)));
    G.sfx(!tie && top.me ? 'win' : 'score');
    rain(!tie && top.me ? 140 : 80);
    const score = tot[M.me] || 0;
    G.race.update({ score, k: M.turns, sv: M.S.sv, wc: M.S.wc, g: [] });
    store.set(M.key, M.S);
    const mine = M;
    const elapsed = sch.t - sch.ts;
    setTimeout(() => { if (M === mine && G.isMulti()) G.gameOver({ score }); }, Math.max(1500, PODIUM_MS - Math.max(0, elapsed)));
  }
  function onEndClick(e) {
    const b = e.target.closest('.dd-th');
    if (!b || !M || b.classList.contains('saved')) return;
    const t = M.thumbs[Number(b.dataset.k)];
    if (!t) return;
    if (addToGallery({ id: Date.now().toString(36) + b.dataset.k, word: t.word, at: Date.now(), img: t.img })) {
      b.classList.add('saved');
      b.querySelector('em').innerHTML = G.icon('check', 14);
      G.toast('Saved to your gallery');
      G.sfx('coin');
    }
  }
  function countUp(node, to) {
    const t0 = performance.now();
    const step = (t) => {
      const p = clamp((t - t0) / 1100, 0, 1);
      node.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- The main loop ----------
  function loop() {
    raf = requestAnimationFrame(loop);
    if (mode === 'multi' && M) multiFrame(Date.now());
    drainQueue();
    renderView();
  }

  // ---------- Art ----------
  function pencilArt() {
    return `<svg viewBox="0 0 120 90" aria-hidden="true"><path class="dd-wa-line" d="M14 70 C30 40 46 74 62 46 S94 30 106 52" fill="none" stroke="#f43f5e" stroke-width="5" stroke-linecap="round"/>` +
      `<g class="dd-wa-pen"><g transform="rotate(35)"><rect x="-6" y="-46" width="12" height="38" rx="2" fill="#facc15"/><rect x="-6" y="-52" width="12" height="8" rx="2" fill="#f9a8d4"/><rect x="-6" y="-46" width="12" height="4" fill="#cbd5e1"/><path d="M-6 -8 0 4 6 -8Z" fill="#fde7c7"/><path d="M-2 -1 0 4 2 -1Z" fill="#1f2937"/></g></g></svg>`;
  }
  function heroSvg() {
    return `<svg class="dd-hero-svg" viewBox="0 0 320 200" aria-hidden="true">
      <defs><linearGradient id="ddHeroBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe4e6"/><stop offset="1" stop-color="#fecdd3"/></linearGradient></defs>
      <rect width="320" height="200" rx="0" fill="url(#ddHeroBg)"/>
      <g opacity=".5" fill="#fff"><circle cx="30" cy="30" r="3"/><circle cx="290" cy="40" r="4"/><circle cx="270" cy="170" r="3"/><circle cx="40" cy="160" r="2.5"/></g>
      <g transform="translate(80 26) rotate(-3)"><rect x="4" y="6" width="160" height="124" rx="10" fill="#000" opacity=".12"/><rect width="160" height="124" rx="10" fill="#fff"/>
        <path class="dd-hl" style="--len:520" d="M48 92 C40 70 44 50 58 44 L54 22 L70 36 C76 34 86 34 92 36 L108 22 L104 44 C118 50 122 70 114 92 C104 108 58 108 48 92 Z" fill="none" stroke="#1f2937" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path class="dd-hl d2" style="--len:60" d="M66 66 h2 M94 66 h2 M76 80 Q81 86 86 80" fill="none" stroke="#1f2937" stroke-width="5" stroke-linecap="round"/>
        <path class="dd-hl d3" style="--len:120" d="M40 78 l-22 -4 M40 86 l-22 4 M122 78 l22 -4 M122 86 l22 4" fill="none" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>
      </g>
      <g class="dd-hpen"><g transform="rotate(30)"><rect x="-7" y="-58" width="14" height="46" rx="2" fill="#facc15"/><rect x="-7" y="-58" width="5" height="46" fill="#fde047"/><rect x="-7" y="-66" width="14" height="10" rx="3" fill="#f9a8d4"/><rect x="-7" y="-58" width="14" height="5" fill="#cbd5e1"/><path d="M-7 -12 0 2 7 -12Z" fill="#fde7c7"/><path d="M-2.5 -3 0 2 2.5 -3Z" fill="#1f2937"/></g></g>
      <g class="dd-bub b1"><rect x="14" y="40" width="58" height="26" rx="13" fill="#3b82f6"/><path d="M52 64 58 74 60 62Z" fill="#3b82f6"/><text x="43" y="58" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">mouse?</text></g>
      <g class="dd-bub b2"><rect x="246" y="58" width="62" height="26" rx="13" fill="#f59e0b"/><path d="M258 82 254 92 266 82Z" fill="#f59e0b"/><text x="277" y="76" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">bear?</text></g>
      <g class="dd-bub b3"><rect x="236" y="120" width="68" height="28" rx="14" fill="#22c55e"/><path d="M250 146 246 156 260 146Z" fill="#22c55e"/><text x="270" y="139" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">CAT!</text></g>
    </svg>`;
  }

  // ---------- Confetti ----------
  const fx = { parts: [], raf: 0, w: 0, h: 0, dpr: 1 };
  const FX_COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#facc15'];
  function sizeFx() {
    if (!el.fx) return;
    const r = el.wrap.getBoundingClientRect();
    fx.dpr = Math.min(2, window.devicePixelRatio || 1);
    fx.w = r.width; fx.h = r.height;
    el.fx.width = Math.round(r.width * fx.dpr);
    el.fx.height = Math.round(r.height * fx.dpr);
  }
  function addPart(x, y, vx, vy) {
    fx.parts.push({ x, y, vx, vy, r: 3 + Math.random() * 4, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.4, c: FX_COLORS[Math.floor(Math.random() * FX_COLORS.length)], life: 1, round: Math.random() < 0.3 });
  }
  function burstAt(node, n) {
    const w = el.wrap.getBoundingClientRect(), r = node.getBoundingClientRect();
    const x = r.left - w.left + r.width / 2, y = r.top - w.top + r.height / 2;
    for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 7; addPart(x, y, Math.cos(a) * s, Math.sin(a) * s - 4); }
    runFx();
  }
  function rain(n) {
    for (let k = 0; k < n; k++) addPart(Math.random() * fx.w, -20 - Math.random() * fx.h * 0.6, (Math.random() - 0.5) * 2, 1 + Math.random() * 3);
    runFx();
  }
  function runFx() {
    if (fx.raf) return;
    const ctx = el.fx.getContext('2d');
    const step = () => {
      ctx.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
      ctx.clearRect(0, 0, fx.w, fx.h);
      fx.parts = fx.parts.filter((p) => p.life > 0 && p.y < fx.h + 30);
      for (const p of fx.parts) {
        p.vy += 0.22; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.a += p.va;
        if (p.y > 0) p.life -= 0.006;
        ctx.globalAlpha = clamp(p.life * 1.5, 0, 1);
        ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.r * 0.7, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (fx.parts.length) fx.raf = requestAnimationFrame(step);
      else { fx.raf = 0; ctx.clearRect(0, 0, fx.w, fx.h); }
    };
    fx.raf = requestAnimationFrame(step);
  }

  // ---------- Frame ----------
  G.mount({
    id: 'doodle', title: 'Doodle Guess', mode: 'race', scoreLabel: 'points', syncMs: 300,
    help: '<ul>' +
      '<li>Tap <b>Play with the family</b>, start a game and send the link. You need <b>2 or more players</b>.</li>' +
      '<li>Each turn one person is the <b>artist</b>. They pick a secret word (Easy, Medium or Hard) and draw it. No letters or numbers!</li>' +
      '<li>Everyone else types guesses. Guess fast: a quicker guess scores more, and the first to guess gets a bonus.</li>' +
      '<li>If your guess is nearly right you’ll see <b>So close!</b> (only you can see it). Letters of the word appear as the clock runs down.</li>' +
      '<li>The artist scores for every person who guesses, plus a bonus if everyone does. Hard words are worth ×1.5.</li>' +
      '<li>Turns last 75 seconds. Everyone draws once (twice with 2–3 players). Highest score wins!</li>' +
      '<li>Drawing tools: 10 colours, 4 pen sizes, eraser, fill bucket, undo and clear. On a keyboard: <b>1–4</b> sizes, <b>E</b> eraser, <b>F</b> fill, <b>Ctrl+Z</b> undo.</li>' +
      '<li><b>Practice drawing</b> on your own and save your favourites to your gallery.</li>' +
      '</ul>',
    roundSetup(players) {
      if (players.length < 2) {
        G.toast('Doodle Guess needs at least 2 players. Send the link to someone!');
        G.sfx('wrong');
        return null;
      }
      return { v: 1, players: players.slice(0, 8) };
    },
    onReady(ctx) {
      user = ctx.user;
      build(ctx.root);
      showMenu();
    }
  });

  G.on('multiStart', (info) => { if (el.wrap) startMulti(info); });
  G.on('multiEnd', () => { if (el.wrap) showMenu(); });

  // Read-only peek for automated tests.
  window.__doodle = {
    mode: () => mode,
    hash: () => board.hash(),
    actions: () => board.actions.length,
    strokes: () => board.actions.filter((a) => a.t === 'b').length,
    points: () => board.actions.reduce((n, a) => n + (a.t === 'b' ? a.p.length / 2 : 0), 0),
    queue: () => queue.length,
    ops: () => rec.ops.length,
    opsChars: () => rec.ops.join('').length,
    snapsLoaded: () => (M ? M.snapsLoaded || 0 : 0),
    maxState: () => (M ? M.maxState || 0 : 0),
    watching: () => !!(M && M.watching),
    inputOpen: () => !el.input.disabled,
    stateSize: () => (M ? JSON.stringify(M.lastState || null).length : 0),
    judge, snapshotOf: () => snapshotOf(board.actions).length,
    state: () => {
      if (!M) return null;
      const sch = schedule(Date.now());
      return { k: sch.k, phase: sch.phase, drawer: sch.phase === 'end' ? null : sch.drawer, me: M.me, word: sch.phase === 'end' ? null : sch.word, known: sch.known, options: sch.phase === 'end' ? null : M.words[sch.k], turns: M.turns, order: M.order, totals: totals(sch), rx: M.rx ? { e: M.rx.e, seq: M.rx.seq } : null, t: sch.t, end: sch.end, drawStart: sch.drawStart };
    },
    practice: () => (P ? { word: P.word, level: P.level } : null)
  };
})();
