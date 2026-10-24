// Kart Party: a top-down arcade kart racer for Chowaniec Games (Micro Machines meets Mario Kart).
// Solo: race 3 to 5 friendly computer karts for 3 laps. Together: everyone races live on the same circuit
// and sees the others' karts glide around (dead reckoning along the track + error easing).
// The track is drawn into cached offscreen tiles; karts, items and effects are drawn on top every frame.
(function () {
  'use strict';
  const CG = window.ChowGames;

  // ---------- Tuning ----------
  const RW = 66;              // road half-width (world units)
  const CURB = 9;             // curb width
  const WALL = RW + 86;       // soft barrier distance from the centre line
  const KR = 14;              // kart collision radius
  const VMAX = 330;           // top speed on tarmac
  const TURN = 2.75;          // steering rate (rad/s)
  const LAPS = 3;
  const SEGS = 8;             // checkpoints per lap
  const STEP = 1 / 120;
  const TILE = 256;
  const POINTS = [1000, 700, 500, 350, 250, 150, 100, 50];
  const AI_NAMES = ['Pip', 'Mochi', 'Ziggy', 'Luna', 'Bolt'];
  const FONT = 'Outfit, system-ui, -apple-system, "Segoe UI", sans-serif';

  // ---------- Helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const wrapA = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
  const isTouch = () => (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  const hexRgb = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const shade = (c, amt) => { const A = hexRgb(c), B = amt >= 0 ? [255, 255, 255] : [0, 0, 0], t = Math.abs(amt); return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`; };
  const ordinal = (n) => { const t = n % 100; if (t >= 11 && t <= 13) return 'th'; return ['th', 'st', 'nd', 'rd'][n % 10] || 'th'; };
  const fmtTime = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function disc(g, x, y, r, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, TAU); g.fill(); }
  function ell(g, x, y, rx, ry, rot, c) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); g.fill(); }

  // ---------- Tracks ----------
  const THEMES = {
    park: { name: 'Sunny Park', ground: '#7cc957', ground2: '#74c050', runoff: '#93d86e', road: '#666b75', road2: '#6d727c', curb: ['#ef4444', '#ffffff'], wall: ['#2f7d32', '#4a9f3f'],
      dust: ['#5fae3c', '#8bd16a'], mini: '#4f9e3a', sky: 'linear-gradient(160deg,#7dd3fc,#86efac)', decor: [['tree', 34], ['tree', 20], ['bush', 16], ['flowers', 14], ['rock', 5], ['pond', 4], ['picnic', 3]] },
    candy: { name: 'Candy Land', ground: '#ffc6df', ground2: '#ffbcd9', runoff: '#ffe0ee', road: '#7a5242', road2: '#82594a', curb: ['#ff3d9a', '#ffffff'], wall: ['#e11d48', '#ffffff'],
      dust: ['#ff9cc9', '#ffffff'], mini: '#e85d9f', sky: 'linear-gradient(160deg,#f9a8d4,#c4b5fd)', decor: [['lolly', 22], ['gumdrop', 22], ['donut', 12], ['cupcake', 14], ['sweet', 18]] },
    snow: { name: 'Snowy Peaks', ground: '#eaf3fc', ground2: '#e1ecf8', runoff: '#f7fbff', road: '#59647a', road2: '#5f6a80', curb: ['#2563eb', '#ffffff'], wall: ['#ffffff', '#ffffff'],
      dust: ['#ffffff', '#dbeafe'], mini: '#6f95c4', sky: 'linear-gradient(160deg,#bfdbfe,#e0f2fe)', decor: [['pine', 40], ['pine', 16], ['snowman', 8], ['srock', 10], ['ice', 4], ['igloo', 3]] }
  };
  const TRACKS = [
    { theme: 'park', pts: [[400, 420], [1250, 300], [2050, 380], [2500, 780], [2420, 1300], [1950, 1520], [1500, 1260], [1050, 1560], [520, 1540], [260, 1000]] },
    { theme: 'candy', pts: [[380, 460], [950, 300], [1500, 520], [2050, 320], [2600, 560], [2620, 1150], [2150, 1380], [1850, 1880], [1250, 1880], [900, 1560], [480, 1640], [260, 1100]] },
    { theme: 'snow', pts: [[360, 380], [1100, 330], [1400, 720], [1700, 720], [2000, 360], [2620, 460], [2720, 1080], [2300, 1560], [1600, 1380], [1050, 1760], [420, 1640], [260, 1040]] }
  ];

  const GEOM = [];
  function geom(ti) {
    if (GEOM[ti]) return GEOM[ti];
    const cp = TRACKS[ti].pts, n = cp.length, raw = [];
    for (let i = 0; i < n; i++) {
      const p0 = cp[(i - 1 + n) % n], p1 = cp[i], p2 = cp[(i + 1) % n], p3 = cp[(i + 2) % n];
      for (let k = 0; k < 60; k++) {
        const t = k / 60, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    let len = 0; const cum = [0];
    for (let i = 1; i <= raw.length; i++) { const a = raw[i - 1], b = raw[i % raw.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); cum.push(len); }
    const N = Math.round(len / 8), sp = len / N, shift = Math.round(380 / sp);
    const X = new Float32Array(N), Y = new Float32Array(N), TX = new Float32Array(N), TY = new Float32Array(N), ANG = new Float32Array(N), CURV = new Float32Array(N), LINE = new Float32Array(N), SC = new Float32Array(N);
    let j = 0;
    const tmp = [];
    for (let i = 0; i < N; i++) {
      const s = i * len / N;
      while (cum[j + 1] < s) j++;
      const t = (s - cum[j]) / (cum[j + 1] - cum[j]), a = raw[j], b = raw[(j + 1) % raw.length];
      tmp.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    for (let i = 0; i < N; i++) { const p = tmp[(i + shift) % N]; X[i] = p[0]; Y[i] = p[1]; }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      const dx = X[b] - X[a], dy = Y[b] - Y[a], l = Math.hypot(dx, dy) || 1;
      TX[i] = dx / l; TY[i] = dy / l; ANG[i] = Math.atan2(dy, dx);
    }
    const raw2 = new Float32Array(N);
    for (let i = 0; i < N; i++) raw2[i] = wrapA(ANG[(i + 1) % N] - ANG[i]) / sp;
    const smooth = (src, w) => { const out = new Float32Array(N); for (let i = 0; i < N; i++) { let s = 0; for (let k = -w; k <= w; k++) s += src[(i + k + N) % N]; out[i] = s / (2 * w + 1); } return out; };
    const c6 = smooth(raw2, 6);
    for (let i = 0; i < N; i++) CURV[i] = c6[i];
    const c30 = smooth(raw2, 26);
    for (let i = 0; i < N; i++) SC[i] = clamp(c30[i] * 210, -1, 1) * (RW - 22);
    const l2 = smooth(SC, 18);
    for (let i = 0; i < N; i++) LINE[i] = l2[i];
    // Chunks of the centre line (Path2D) for drawing tiles, with bounding boxes.
    const CH = 16, chunks = [];
    for (let i0 = 0; i0 < N; i0 += CH) {
      const i1 = Math.min(N, i0 + CH);
      const p = new Path2D(); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = i0; i <= i1; i++) { const k = i % N; if (i === i0) p.moveTo(X[k], Y[k]); else p.lineTo(X[k], Y[k]); x0 = Math.min(x0, X[k]); y0 = Math.min(y0, Y[k]); x1 = Math.max(x1, X[k]); y1 = Math.max(y1, Y[k]); }
      chunks.push({ p, s0: i0 * sp, x0, y0, x1, y1 });
    }
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (let i = 0; i < N; i++) { bx0 = Math.min(bx0, X[i]); by0 = Math.min(by0, Y[i]); bx1 = Math.max(bx1, X[i]); by1 = Math.max(by1, Y[i]); }
    const GC = 200, grid = new Map();
    for (let i = 0; i < N; i++) { const key = Math.floor(X[i] / GC) * 4096 + Math.floor(Y[i] / GC); let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(i); }
    const G = { ti, theme: THEMES[TRACKS[ti].theme], N, sp, L: len, X, Y, TX, TY, ANG, CURV, LINE, chunks, grid, GC, bbox: [bx0, by0, bx1, by1] };
    GEOM[ti] = G;
    return G;
  }

  // Nearest centre-line sample anywhere (spatial grid), optionally limited to an index range.
  function nearestGlobal(G, x, y, from, count) {
    let best = -1, bd = 1e18;
    if (from != null) {
      for (let k = 0; k < count; k++) { const i = (from + k + G.N) % G.N; const dx = x - G.X[i], dy = y - G.Y[i], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      return best;
    }
    const cx = Math.floor(x / G.GC), cy = Math.floor(y / G.GC);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const a = G.grid.get((cx + ox) * 4096 + cy + oy); if (!a) continue;
      for (const i of a) { const dx = x - G.X[i], dy = y - G.Y[i], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    }
    if (best < 0) for (let i = 0; i < G.N; i += 2) { const dx = x - G.X[i], dy = y - G.Y[i], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function nearestLocal(G, x, y, hint, win) {
    let best = hint, bd = 1e18;
    for (let j = -win; j <= win; j++) { const i = (hint + j + G.N) % G.N; const dx = x - G.X[i], dy = y - G.Y[i], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  // Fills o with { i, s, d } for a point near sample i.
  function frameAt(G, x, y, i, o) {
    const dx = x - G.X[i], dy = y - G.Y[i];
    const along = dx * G.TX[i] + dy * G.TY[i];
    o.i = i; o.s = (i * G.sp + along + G.L) % G.L; o.d = -dx * G.TY[i] + dy * G.TX[i];
    return o;
  }
  // Point on the track at arc length s, lateral offset d (positive = right of the driving direction).
  function pointAt(G, s, d, o) {
    s = ((s % G.L) + G.L) % G.L;
    const f = s / G.sp, i = Math.floor(f) % G.N, k = (i + 1) % G.N, t = f - Math.floor(f);
    const tx = lerp(G.TX[i], G.TX[k], t), ty = lerp(G.TY[i], G.TY[k], t);
    o.x = lerp(G.X[i], G.X[k], t) - ty * d; o.y = lerp(G.Y[i], G.Y[k], t) + tx * d; o.a = Math.atan2(ty, tx);
    return o;
  }

  // ---------- Race world ----------
  let G = null;               // current track geometry
  let W = null;               // { pads, boxes, decor, decorGrid, stand }
  let karts = [];             // local karts (me + computer karts)
  let me = null;
  let remotes = new Map();    // multiplayer: name -> remote kart
  let hazards = [];           // bananas
  let particles = [];
  let confetti = [];
  let state = 'menu';         // menu | grid | race | done
  let multi = false;
  let multiInfo = null;       // { players, colors, me, myIndex, round, t0 }
  let paused = false;
  let raceT = 0;              // seconds since GO
  let gridT = 0;              // solo start lights timer
  let finishT = 0;
  let myPlace = 0;
  let finalSent = false;
  let menuTrack = 0, menuRivals = 5;
  let raceSeed = 1;
  let preRound = 0;
  let myHazId = 0;
  const myHits = [];
  const deadHaz = new Set();
  let rocketHeld = -1;
  let wrongT = 0;
  let shake = 0;
  let autopilot = false;
  const tmpF = { i: 0, s: 0, d: 0 }, tmpP = { x: 0, y: 0, a: 0 };

  function buildWorld(ti, seed) {
    G = geom(ti);
    const rnd = CG.rng((seed ^ (ti * 2654435761)) >>> 0);
    const th = G.theme;
    // Item box rows and boost pads.
    const boxes = [];
    [0.3, 0.66].forEach((f) => {
      const s = f * G.L;
      [-42, -14, 14, 42].forEach((d) => { pointAt(G, s, d, tmpP); boxes.push({ x: tmpP.x, y: tmpP.y, s, d, off: 0, spin: rnd() * TAU }); });
    });
    const pads = [];
    const straight = [];
    for (let i = 0; i < G.N; i += 4) {
      let m = 0; for (let k = -14; k <= 14; k++) m = Math.max(m, Math.abs(G.CURV[(i + k + G.N) % G.N]));
      const s = i * G.sp;
      const farFrom = (v) => Math.min(Math.abs(s - v), G.L - Math.abs(s - v)) > 260;
      if (m < 1 / 700 && farFrom(0) && farFrom(0.3 * G.L) && farFrom(0.66 * G.L)) straight.push(s);
    }
    for (let tries = 0; tries < 60 && pads.length < 4 && straight.length; tries++) {
      const s = straight[Math.floor(rnd() * straight.length)];
      if (pads.some((p) => Math.min(Math.abs(p.s - s), G.L - Math.abs(p.s - s)) < G.L / 6)) continue;
      const d = Math.round((rnd() * 2 - 1) * 30);
      pointAt(G, s, d, tmpP);
      pads.push({ s, d, x: tmpP.x, y: tmpP.y, a: tmpP.a });
    }
    // Scenery outside the barrier.
    const decor = [];
    const total = th.decor.reduce((a, b) => a + b[1], 0);
    const [bx0, by0, bx1, by1] = G.bbox;
    const X0 = bx0 - WALL - 340, Y0 = by0 - WALL - 340, X1 = bx1 + WALL + 340, Y1 = by1 + WALL + 340;
    const STEPD = 92;
    for (let y = Y0; y < Y1; y += STEPD) for (let x = X0; x < X1; x += STEPD) {
      if (rnd() < 0.22) continue;
      let pick = rnd() * total, type = th.decor[0][0];
      for (const [t, w] of th.decor) { pick -= w; if (pick <= 0) { type = t; break; } }
      const big = type === 'pond' || type === 'ice' || type === 'igloo';
      const r = big ? 60 + rnd() * 34 : type === 'tree' || type === 'pine' ? 30 + rnd() * 20 : type === 'lolly' || type === 'donut' ? 22 + rnd() * 10 : 13 + rnd() * 9;
      const px = x + (rnd() - 0.5) * STEPD * 0.8, py = y + (rnd() - 0.5) * STEPD * 0.8;
      const i = nearestGlobal(G, px, py);
      const dist = Math.hypot(px - G.X[i], py - G.Y[i]);
      if (dist < WALL + 12 + r * 0.55) continue;
      if (big && decor.some((o) => (o.big) && Math.hypot(o.x - px, o.y - py) < 300)) continue;
      if (decor.some((o) => Math.hypot(o.x - px, o.y - py) < (o.r + r) * 0.7)) continue;
      decor.push({ type, x: px, y: py, r, rot: rnd() * TAU, v: rnd(), big });
    }
    // Grandstand by the start line, on the side with more room.
    let stand = null;
    for (const side of [-1, 1]) {
      pointAt(G, 30, side * (WALL + 70), tmpP);
      const i = nearestGlobal(G, tmpP.x, tmpP.y);
      if (Math.hypot(tmpP.x - G.X[i], tmpP.y - G.Y[i]) > WALL + 50) { stand = { x: tmpP.x, y: tmpP.y, a: tmpP.a, side }; break; }
    }
    if (stand) for (let k = decor.length - 1; k >= 0; k--) { const o = decor[k]; const dx = o.x - stand.x, dy = o.y - stand.y; if (Math.hypot(dx, dy) < 190 + o.r) decor.splice(k, 1); }
    // Tyre stacks on the outside of the bends (karts bump off them).
    const solids = [];
    for (let i = 0; i < G.N; i += 14) {
      const c = G.CURV[i], s0 = i * G.sp;
      if (Math.abs(c) < 1 / 380 || s0 < 260 || s0 > G.L - 420) continue;
      const side = -Math.sign(c);
      pointAt(G, s0, side * (RW + CURB + 40), tmpP);
      const j = nearestGlobal(G, tmpP.x, tmpP.y);
      if (Math.hypot(tmpP.x - G.X[j], tmpP.y - G.Y[j]) < RW + CURB + 30) continue;
      solids.push({ x: tmpP.x, y: tmpP.y, r: 15, rot: tmpP.a });
    }
    W = { pads, boxes, decor, stand, solids };
    clearTiles();
    buildMini();
  }

  // Grid slot k (0 = pole): behind the start line in two staggered columns.
  function gridSlot(k, o) {
    const back = 46 + k * 32, lat = (k % 2 ? 1 : -1) * 30;
    return pointAt(G, G.L - back, lat, o);
  }

  function makeKart(opts) {
    gridSlot(opts.slot, tmpP);
    const k = {
      name: opts.name, color: opts.color, ai: !!opts.ai, isMe: !!opts.isMe, slot: opts.slot,
      x: tmpP.x, y: tmpP.y, a: tmpP.a, vx: 0, vy: 0, vF: 0, idx: 0, s: 0, d: 0, seg: SEGS - 1, lap: -1, cpNext: SEGS,
      fin: null, boostT: 0, drift: 0, driftT: 0, driftLvl: 0, spinT: 0, spinA: 0, shieldT: 0, item: null, rollT: 0, hopT: 0,
      steerVis: 0, grass: false, curb: false, skill: opts.skill || 1, bias: opts.bias || 0, rubber: 1, itemWait: 0, padIn: -1, bumpT: 0,
      sparkT: 0, place: 0
    };
    k.idx = nearestGlobal(G, k.x, k.y);
    frameAt(G, k.x, k.y, k.idx, tmpF); k.s = tmpF.s; k.d = tmpF.d; k.seg = Math.floor(k.s / G.L * SEGS) % SEGS; k.prog = k.lap * G.L + k.s;
    return k;
  }

  function resetCommon() {
    hazards = []; particles = []; confetti = []; deadHaz.clear(); myHits.length = 0; myHazId = 0;
    raceT = 0; gridT = 0; finishT = 0; myPlace = 0; finalSent = false; wrongT = 0; rocketHeld = -1; shake = 0;
    remotes = new Map();
    W.boxes.forEach((b) => { b.off = 0; });
  }

  function setupSolo(ti, rivals, demo) {
    multi = false; multiInfo = null;
    raceSeed = Math.floor(Math.random() * 2 ** 31);
    if (!G || G.ti !== ti || !W) buildWorld(ti, 7 + ti); else clearTilesIfNeeded();
    resetCommon();
    const n = rivals + 1;
    const mySlot = demo ? -1 : Math.floor(n / 2);
    karts = [];
    let ai = 0;
    for (let s = 0; s < n; s++) {
      if (s === mySlot) { me = makeKart({ slot: s, name: CG.me() || 'You', color: CG.colors[0], isMe: true }); karts.push(me); continue; }
      const k = makeKart({ slot: s, name: AI_NAMES[ai], color: CG.colors[1 + ai], ai: true, skill: [0.94, 0.915, 0.89, 0.87, 0.85][ai], bias: [-12, 10, -4, 14, -14][ai] });
      ai++;
      karts.push(k);
    }
    if (demo) me = null;
  }

  function setupMulti(info) {
    multi = true;
    const players = info.players.slice();
    const myIndex = players.indexOf(info.me || CG.me());
    multiInfo = { players, colors: info.colors || players.map((_, i) => CG.colors[i % CG.colors.length]), me: info.me || CG.me(), myIndex, round: info.round, t0: 0 };
    const sh = info.shared && typeof info.shared.track === 'number' ? info.shared.track : null;
    const ti = sh != null && sh >= 0 && sh < TRACKS.length ? sh : Math.floor(CG.rng(info.seed)() * TRACKS.length);
    raceSeed = info.seed;
    if (!G || G.ti !== ti || !W || W.seed !== info.seed) { buildWorld(ti, info.seed); W.seed = info.seed; }
    resetCommon();
    karts = [];
    me = makeKart({ slot: Math.max(0, myIndex), name: multiInfo.me, color: multiInfo.colors[Math.max(0, myIndex)], isMe: true });
    karts.push(me);
    players.forEach((name, i) => {
      if (i === myIndex) return;
      gridSlot(i, tmpP);
      remotes.set(name, {
        name, color: multiInfo.colors[i], index: i, t: null, offMin: Infinity, s0: 0, d0: 0, a0: tmpP.a, ang0: tmpP.a, v0: 0, lap: -1, cp: SEGS - 1, fin: null,
        x: tmpP.x, y: tmpP.y, a: tmpP.a, ex: 0, ey: 0, ea: 0, f: 0, dl: 0, seen: performance.now(), spinA: 0, prog: 0, has: false, sx: tmpP.x, sy: tmpP.y, sa: tmpP.a, steer: 0
      });
      const r = remotes.get(name);
      const i0 = nearestGlobal(G, tmpP.x, tmpP.y); frameAt(G, tmpP.x, tmpP.y, i0, tmpF); r.s0 = tmpF.s; r.d0 = tmpF.d; r.prog = -G.L + tmpF.s;
    });
  }

  // ---------- Physics ----------
  function stepKart(k, inp, dt) {
    const th = k.spinT > 0;
    let thr = th ? 0 : inp.thr, steer = th ? 0 : inp.steer;
    const fx = Math.cos(k.a), fy = Math.sin(k.a);
    let vF = k.vx * fx + k.vy * fy, vR = -k.vx * fy + k.vy * fx;
    // Surface
    k.idx = nearestLocal(G, k.x, k.y, k.idx, 8);
    frameAt(G, k.x, k.y, k.idx, tmpF);
    const ad = Math.abs(tmpF.d);
    k.grass = ad > RW + CURB - 2;
    k.curb = !k.grass && ad > RW - 3;
    const boosting = k.boostT > 0;
    let vmax = VMAX * k.skill * k.rubber * (k.grass && !boosting ? 0.52 : 1) * (boosting ? 1.3 : 1);
    if (inp.cap) vmax = Math.min(vmax, inp.cap);
    if (thr > 0) {
      if (vF < vmax) vF += (vmax - vF) * (boosting ? 3 : 1.2) * thr * dt + (vF < 0 ? 400 * dt : 0);
    } else if (thr < 0) {
      if (vF > 4) vF -= 560 * dt; else vF = Math.max(vF - 220 * dt, -120);
    } else {
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), 95 * dt);
    }
    if (vF > vmax) vF -= (vF - vmax) * (k.grass ? 2.6 : 1.1) * dt;
    if (k.grass && Math.abs(vF) > 40 && Math.random() < 0.5) puff(k, k.grass);
    // Drift
    const sp = Math.abs(vF);
    if (k.drift) {
      if (!inp.drift || vF < 90 || th) endDrift(k);
      else if (!k.grass) {
        k.driftT += dt * (steer * k.drift > 0.2 ? 1.35 : 0.8);
        const lvl = k.driftT > 2.1 ? 3 : k.driftT > 1.25 ? 2 : k.driftT > 0.55 ? 1 : 0;
        if (lvl > k.driftLvl) { k.driftLvl = lvl; if (k.isMe) CG.sfx('point'); }
      }
    } else if (inp.drift && !th && Math.abs(steer) > 0.3 && vF > 140 && !k.grass && inp.driftEdge !== false) {
      k.drift = Math.sign(steer); k.driftT = 0; k.driftLvl = 0; k.hopT = 0.2;
    }
    // Steering
    const gain = clamp(sp / 80, 0, 1) * (1 - 0.22 * clamp((sp - 180) / 170, 0, 1));
    let turn;
    if (k.drift) turn = TURN * (0.62 * k.drift + 0.5 * steer) * gain;
    else turn = TURN * steer * gain * (vF >= 0 ? 1 : -1);
    const grip = k.drift ? 2.2 : k.grass ? 5 : 9;
    vR *= Math.exp(-grip * dt);
    k.vx = fx * vF - fy * vR; k.vy = fy * vF + fx * vR;
    k.a = wrapA(k.a + turn * dt);
    k.vF = vF;
    k.steerVis += (steer - k.steerVis) * Math.min(1, dt * 14);
    k.x += k.vx * dt; k.y += k.vy * dt;
    // Timers
    if (k.boostT > 0) k.boostT -= dt;
    if (k.shieldT > 0) k.shieldT -= dt;
    if (k.hopT > 0) k.hopT -= dt;
    if (k.bumpT > 0) k.bumpT -= dt;
    if (k.spinT > 0) { k.spinT -= dt; k.spinA += dt * 13 * clamp(k.spinT + 0.25, 0.3, 1); k.vx *= Math.exp(-2.4 * dt); k.vy *= Math.exp(-2.4 * dt); if (k.spinT <= 0) k.spinA = 0; }
    if (k.rollT > 0) { k.rollT -= dt; if (k.rollT <= 0) { k.item = k.pending; k.pending = null; if (k.isMe) CG.sfx('coin'); } }
    // Barrier
    k.idx = nearestLocal(G, k.x, k.y, k.idx, 8);
    frameAt(G, k.x, k.y, k.idx, tmpF);
    if (Math.abs(tmpF.d) > WALL - 6) {
      const sg = Math.sign(tmpF.d), nx = -G.TY[k.idx] * sg, ny = G.TX[k.idx] * sg;
      const over = Math.abs(tmpF.d) - (WALL - 6);
      k.x -= nx * over; k.y -= ny * over;
      const vn = k.vx * nx + k.vy * ny;
      if (vn > 0) { k.vx -= nx * vn * 1.4; k.vy -= ny * vn * 1.4; k.vx *= 0.9; k.vy *= 0.9; if (k.isMe && vn > 60 && k.bumpT <= 0) { CG.sfx('drop'); shake = 0.25; k.bumpT = 0.4; } }
      frameAt(G, k.x, k.y, k.idx, tmpF);
    }
    // Tyre stacks
    for (const o of W.solids) {
      const dx = k.x - o.x, dy = k.y - o.y, R = o.r + KR - 2, d2 = dx * dx + dy * dy;
      if (d2 >= R * R || d2 < 0.01) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      k.x = o.x + nx * R; k.y = o.y + ny * R;
      const vn = k.vx * nx + k.vy * ny;
      if (vn < 0) { k.vx -= nx * vn * 1.5; k.vy -= ny * vn * 1.5; k.vx *= 0.85; k.vy *= 0.85; if (k.isMe && vn < -60 && k.bumpT <= 0) { CG.sfx('drop'); shake = 0.2; k.bumpT = 0.4; } }
    }
    // Progress, checkpoints and laps
    const prevSeg = k.seg;
    k.s = tmpF.s; k.d = tmpF.d;
    const seg = Math.floor(k.s / G.L * SEGS) % SEGS;
    if (seg !== prevSeg) {
      if (prevSeg === SEGS - 1 && seg === 0) {
        if (k.cpNext >= SEGS) { k.lap++; k.cpNext = 1; onLap(k); }
      } else if (prevSeg === 0 && seg === SEGS - 1) {
        if (k.cpNext === 1 && k.lap >= 0) { k.lap--; k.cpNext = SEGS; }
      } else if (seg === k.cpNext && k.cpNext < SEGS) k.cpNext++;
      k.seg = seg;
    }
    k.prog = k.lap * G.L + k.s;
    // Drift sparks
    if (k.drift && k.driftLvl > 0) {
      k.sparkT -= dt;
      if (k.sparkT <= 0) { k.sparkT = 0.03; sparks(k); }
    }
    if (k.boostT > 0 && Math.random() < 0.7) flame(k);
  }

  function endDrift(k) {
    if (k.driftLvl > 0) {
      const t = [0, 0.55, 0.9, 1.3][k.driftLvl];
      k.boostT = Math.max(k.boostT, t);
      const fx = Math.cos(k.a), fy = Math.sin(k.a);
      k.vx += fx * 40; k.vy += fy * 40;
      for (let i = 0; i < 6 + k.driftLvl * 4; i++) { const a = Math.random() * TAU; addP({ x: k.x - fx * 14, y: k.y - fy * 14, vx: Math.cos(a) * 90 - fx * 60, vy: Math.sin(a) * 90 - fy * 60, life: 0.45, max: 0.45, r: 2.6 + k.driftLvl * 0.5, c: SPARK[k.driftLvl], kind: 'spark' }); }
      if (k.isMe) { CG.sfx('whoosh'); if (k.driftLvl >= 2) flash(['', 'Turbo!', 'Super turbo!', 'Ultra turbo!'][k.driftLvl], 'turbo'); }
    }
    k.drift = 0; k.driftT = 0; k.driftLvl = 0;
  }

  function onLap(k) {
    if (k.lap >= LAPS && k.fin == null) {
      k.fin = raceT;
      if (k.isMe) onMyFinish();
      return;
    }
    if (k.isMe && k.lap >= 1) {
      CG.sfx('score');
      flash(k.lap === LAPS - 1 ? 'Final lap!' : `Lap ${k.lap + 1}`, k.lap === LAPS - 1 ? 'final' : '');
    }
  }

  function collideKarts() {
    for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, R = KR * 2;
      if (d2 >= R * R || d2 < 0.01) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = (R - d) / 2;
      a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const imp = -rv * 0.75;
        a.vx -= nx * imp * 0.5; a.vy -= ny * imp * 0.5; b.vx += nx * imp * 0.5; b.vy += ny * imp * 0.5;
        if ((a.isMe || b.isMe) && -rv > 70 && (me.bumpT <= 0)) { CG.sfx('click'); me.bumpT = 0.3; }
      }
    }
  }

  // ---------- Items ----------
  function rollItem(k, place, n) {
    const r = Math.random(), back = n > 1 ? (place - 1) / (n - 1) : 0.5;
    let item;
    if (k.ai) item = r < 0.45 + back * 0.3 ? 'mushroom' : 'shield';
    else {
      const pM = 0.22 + back * 0.43, pS = 0.3;
      item = r < pM ? 'mushroom' : r < pM + pS ? 'shield' : 'banana';
    }
    k.pending = item; k.rollT = 1.0; k.itemWait = 0.6 + Math.random() * 2.5;
  }

  function useItem(k) {
    if (!k.item || k.rollT > 0) return;
    const it = k.item; k.item = null;
    if (it === 'mushroom') {
      k.boostT = Math.max(k.boostT, 1.35);
      const fx = Math.cos(k.a), fy = Math.sin(k.a);
      const vF = k.vx * fx + k.vy * fy, want = VMAX * 1.18;
      if (vF < want) { k.vx += fx * (want - vF); k.vy += fy * (want - vF); }
      if (k.isMe) CG.sfx('whoosh');
      for (let i = 0; i < 10; i++) addP({ x: k.x - fx * 18, y: k.y - fy * 18, vx: -fx * 120 + (Math.random() - 0.5) * 120, vy: -fy * 120 + (Math.random() - 0.5) * 120, life: 0.45, max: 0.45, r: 5, c: ['#fde047', '#fb923c', '#ffffff'][i % 3], kind: 'dot' });
    } else if (it === 'shield') {
      k.shieldT = 10;
      if (k.isMe) CG.sfx('flip');
    } else if (it === 'banana') {
      const fx = Math.cos(k.a), fy = Math.sin(k.a);
      const h = { owner: multi ? multiInfo.myIndex : -1, id: ++myHazId, x: k.x - fx * 30, y: k.y - fy * 30, born: raceT, mine: k.isMe, a: Math.random() * TAU };
      h.key = `${h.owner}.${h.id}`;
      hazards.push(h);
      if (k.isMe) CG.sfx('drop');
    }
  }

  function checkPickups(k, standings) {
    for (const b of W.boxes) {
      if (b.off > 0) continue;
      const dx = k.x - b.x, dy = k.y - b.y;
      if (dx * dx + dy * dy < 22 * 22) {
        b.off = 2.4;
        for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; addP({ x: b.x, y: b.y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, life: 0.5, max: 0.5, r: 4, c: `hsl(${i * 30},95%,62%)`, kind: 'dot' }); }
        if (!k.item && k.rollT <= 0) {
          const n = standings.length, place = standings.indexOf(k) + 1 || Math.ceil(n / 2);
          rollItem(k, place, n);
          if (k.isMe) CG.sfx('tick');
        }
      }
    }
    for (const p of W.pads) {
      const ds = ((k.s - p.s + G.L * 1.5) % G.L) - G.L / 2;
      const inside = Math.abs(ds) < 24 && Math.abs(k.d - p.d) < 20;
      if (inside && k.padIn !== p) {
        k.padIn = p; k.boostT = Math.max(k.boostT, 0.95);
        const fx = Math.cos(k.a), fy = Math.sin(k.a), vF = k.vx * fx + k.vy * fy, want = VMAX * 1.12;
        if (vF < want) { k.vx += fx * (want - vF) * 0.6; k.vy += fy * (want - vF) * 0.6; }
        if (k.isMe) CG.sfx('whoosh');
      } else if (!inside && k.padIn === p) k.padIn = -1;
    }
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      if (raceT - h.born < 0.4 && h.mine && k.isMe) continue;
      const dx = k.x - h.x, dy = k.y - h.y;
      if (dx * dx + dy * dy < 22 * 22) {
        hazards.splice(i, 1);
        deadHaz.add(h.key);
        if (multi && k.isMe) { myHits.push(h.key); if (myHits.length > 16) myHits.shift(); }
        if (k.shieldT > 0) {
          k.shieldT = 0;
          for (let j = 0; j < 14; j++) { const a = j / 14 * TAU; addP({ x: k.x, y: k.y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, life: 0.4, max: 0.4, r: 3.5, c: '#bae6fd', kind: 'dot' }); }
          if (k.isMe) CG.sfx('flip');
        } else {
          k.spinT = 1.0; endDrift(k); k.drift = 0;
          for (let j = 0; j < 6; j++) addP({ x: k.x, y: k.y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 0.9, max: 0.9, r: 6, c: '#fde047', kind: 'star' });
          if (k.isMe) { CG.sfx('hit'); shake = 0.3; }
        }
      }
    }
  }

  // ---------- Computer driving (also the test autopilot) ----------
  function aiInput(k, out, cap) {
    const fx = Math.cos(k.a), fy = Math.sin(k.a);
    const vF = k.vx * fx + k.vy * fy;
    const look = 46 + Math.max(0, vF) * 0.3;
    const ti = (k.idx + Math.round(look / G.sp)) % G.N;
    let off = G.LINE[ti] + k.bias;
    // Step around bananas ahead.
    for (const h of hazards) {
      const dx = h.x - k.x, dy = h.y - k.y, along = dx * fx + dy * fy;
      if (along > 0 && along < 160) {
        frameAt(G, h.x, h.y, nearestLocal(G, h.x, h.y, k.idx, 30), tmpF);
        if (Math.abs(tmpF.d - off) < 30) off = tmpF.d + (tmpF.d > 0 ? -38 : 38);
      }
    }
    // Pull out to pass a kart just ahead.
    for (const o of karts) {
      if (o === k) continue;
      const dx = o.x - k.x, dy = o.y - k.y, along = dx * fx + dy * fy;
      if (along > 8 && along < 85 && Math.abs(o.d - (k.d)) < 26 && vF > 120) { off = o.d + (o.d > 0 ? -34 : 34) + (k.bias > 0 ? 4 : -4); break; }
    }
    off = clamp(off, -RW + 16, RW - 16);
    const tx = G.X[ti] - G.TY[ti] * off, ty = G.Y[ti] + G.TX[ti] * off;
    const diff = wrapA(Math.atan2(ty - k.y, tx - k.x) - k.a);
    out.steer = clamp(diff * 2.7, -1, 1);
    let cmax = 0;
    const ahead = Math.round((40 + Math.max(0, vF) * 0.85) / G.sp);
    for (let j = 2; j < ahead; j += 3) cmax = Math.max(cmax, Math.abs(G.CURV[(k.idx + j) % G.N]));
    const vT = clamp(2.25 / Math.max(cmax, 1e-4), 150, 999) * (k.ai ? k.skill * k.rubber : 1);
    out.thr = vF > vT + 25 ? -1 : vF > vT ? 0 : 1;
    if (Math.abs(diff) > 1.4 && vF > 60) out.thr = -1;
    out.drift = k.isMe && autopilot === 2 && vF > 150 && (k.drift ? cmax > 1 / 450 && Math.abs(diff) < 0.9 : cmax > 1 / 330 && Math.abs(out.steer) > 0.12);
    if (out.drift && !k.drift) out.steer = Math.sign(out.steer) * Math.max(0.45, Math.abs(out.steer));
    out.cap = cap || 0; out.use = false;
    if (k.item && k.rollT <= 0) {
      k.itemWait -= STEP;
      if (k.itemWait <= 0 && (k.item !== 'mushroom' || cmax < 1 / 500)) out.use = true;
    }
    return out;
  }

  function rubberBand() {
    if (multi || !me) { karts.forEach((k) => { k.rubber = 1; }); return; }
    for (const k of karts) {
      if (!k.ai) continue;
      const diff = k.prog - me.prog;
      k.rubber = diff > 160 ? lerp(1, 0.8, clamp((diff - 160) / 800, 0, 1)) : diff < -250 ? lerp(1, 1.07, clamp((-diff - 250) / 900, 0, 1)) : 1;
      if (me.fin != null) k.rubber = 1;
    }
  }

  // ---------- Standings ----------
  function cmpRows(a, b) {
    if (a.fin != null && b.fin != null) return a.fin - b.fin || (a.name < b.name ? -1 : 1);
    if (a.fin != null) return -1;
    if (b.fin != null) return 1;
    return b.prog - a.prog;
  }
  function standings() {
    const rows = karts.slice();
    if (multi) remotes.forEach((r) => { if (r.gone) return; rows.push(r); });
    return rows.sort(cmpRows);
  }

  // ---------- Input ----------
  const keys = { up: false, down: false, left: false, right: false, drift: false };
  const touch = { left: false, right: false, brake: false, drift: false };
  let itemPressed = false, usingTouch = isTouch();
  const inpMe = { thr: 0, steer: 0, drift: false, use: false, cap: 0, driftEdge: true };
  const inpAi = { thr: 0, steer: 0, drift: false, use: false, cap: 0 };

  function readMe() {
    const blocked = CG.countingDown() || CG.modalOpen() || paused;
    const o = inpMe;
    if (blocked) { o.thr = 0; o.steer = 0; o.drift = false; o.use = false; itemPressed = false; return o; }
    const tl = touch.left || keys.left, trt = touch.right || keys.right;
    o.steer = (tl ? -1 : 0) + (trt ? 1 : 0);
    if (usingTouch) o.thr = touch.brake || keys.down ? -1 : 1;
    else o.thr = keys.up && keys.down ? -1 : keys.up ? 1 : keys.down ? -1 : 0;
    o.drift = keys.drift || touch.drift;
    o.driftEdge = true;
    o.use = itemPressed; itemPressed = false;
    o.cap = 0;
    return o;
  }

  // ---------- Simulation step ----------
  function step(dt) {
    if (!G) return;
    if (W) W.boxes.forEach((b) => { if (b.off > 0) b.off -= dt; b.spin += dt * 2; });
    if (state === 'grid') {
      gridT += dt;
      const before = lightsOn(gridT - dt), after = lightsOn(gridT);
      if (after !== before) { if (after < 4) CG.sfx('tick'); else { CG.sfx('go'); flash('GO!', 'go'); } }
      const i = readMe();
      if (i.thr > 0 && rocketHeld < 0) rocketHeld = gridT; else if (i.thr <= 0) rocketHeld = -1;
      if (gridT >= 3.0) {
        state = 'race';
        if (me && rocketHeld > 2.35 && !usingTouch) { me.boostT = 0.8; CG.sfx('whoosh'); flash('Rocket start!', 'turbo'); }
      }
      return;
    }
    if (state === 'mgrid') return;
    if (state === 'menu' || state === 'race' || state === 'done') {
      raceT += dt;
      const st = standings();
      rubberBand();
      for (const k of karts) {
        let inp;
        if (k.isMe) {
          if (state === 'done' || autopilot) inp = aiInput(k, inpAi, state === 'done' ? Math.max(1, VMAX * (0.6 - finishT * 0.2)) : 0);
          else inp = readMe();
          if (state === 'done' && finishT > 2.5 && multi) { inp.thr = 0; }
        } else inp = aiInput(k, inpAi, k.fin != null ? VMAX * 0.55 : 0);
        if (state === 'menu' && k.lap >= LAPS - 1 && k.s > G.L * 0.9) { k.lap = 0; }
        stepKart(k, inp, dt);
        if (inp.use) useItem(k);
        checkPickups(k, st);
      }
      collideKarts();
      if (state === 'race' && me && me.fin == null) {
        // Wrong way?
        const fx = Math.cos(me.a), fy = Math.sin(me.a);
        const dot = fx * G.TX[me.idx] + fy * G.TY[me.idx];
        if (dot < -0.35 && Math.hypot(me.vx, me.vy) > 30) wrongT += dt; else wrongT = Math.max(0, wrongT - dt * 2);
      } else wrongT = 0;
      if (state === 'done') finishT += dt;
      // Old bananas melt away.
      for (let i = hazards.length - 1; i >= 0; i--) if (raceT - hazards[i].born > 45) { deadHaz.add(hazards[i].key); hazards.splice(i, 1); }
    }
  }
  function lightsOn(t) { return t < 0.6 ? 0 : t < 1.4 ? 1 : t < 2.2 ? 2 : t < 3.0 ? 3 : 4; }

  function onMyFinish() {
    state = 'done'; finishT = 0;
    endDrift(me);
    if (!multi) {
      const order = karts.slice().sort(cmpRows);
      myPlace = order.indexOf(me) + 1;
    } else myPlace = 0;
    CG.sfx(multi ? 'score' : myPlace === 1 ? 'win' : 'score');
    burstConfetti();
    showFinish();
  }
  function scoreFor(place, t) {
    const par = LAPS * G.L / 310;
    const bonus = clamp(Math.round(300 * (1.3 - t / par) / 0.4), 0, 300);
    return (POINTS[place - 1] || 25) + bonus;
  }
  function finishFlow() {
    if (state !== 'done' || finalSent) return;
    if (!multi) {
      if (finishT > 2.6) {
        finalSent = true;
        const sc = scoreFor(myPlace, me.fin);
        CG.gameOver({ score: sc, title: `${myPlace}${ordinal(myPlace)} place!`, again: () => startSolo() });
      }
      return;
    }
    // Multiplayer: keep sending our finish time for a moment so everyone learns it, then report.
    if (finishT > 1.3) {
      finalSent = true;
      myPlace = 1;
      remotes.forEach((r) => { if (r.fin != null && (r.fin < me.fin || (r.fin === me.fin && r.name < me.name))) myPlace++; });
      const sc = scoreFor(myPlace, me.fin);
      sendState(sc);
      showFinish();
      CG.gameOver({ score: sc });
    }
  }

  // ---------- Multiplayer sync ----------
  function sendState(finalScore) {
    if (!multi || !me) return;
    const st = standings();
    const pos = st.indexOf(me) + 1;
    const h = [];
    for (const z of hazards) if (z.mine) h.push([z.id, Math.round(z.x), Math.round(z.y)]);
    const flags = (me.drift ? 1 : 0) | (me.boostT > 0 ? 2 : 0) | (me.shieldT > 0 ? 4 : 0) | (me.spinT > 0 ? 8 : 0);
    CG.race.update({
      score: finalScore != null ? finalScore : (POINTS[pos - 1] || 0), alive: true,
      x: Math.round(me.x), y: Math.round(me.y), a: Math.round(wrapA(me.a) * 100) / 100, v: Math.round(Math.hypot(me.vx, me.vy) * (me.vF < 0 ? -1 : 1)),
      lap: me.lap, cp: me.seg, fin: me.fin == null ? null : Math.round(me.fin * 1000), t: Math.round(raceT * 1000),
      f: flags, dl: me.driftLvl, st: Math.round(me.steerVis * 10) / 10, h, k: myHits.slice()
    });
  }

  function updateRemotes(dt) {
    if (!multi) return;
    const now = performance.now();
    const list = CG.race.others();
    const ms = (raceT + (paused ? 0 : acc)) * 1000;   // continuous clock, so remote karts glide between fixed steps
    const seenNames = new Set();
    for (const o of list) {
      const r = remotes.get(o.name);
      if (!r || !o.state) continue;
      seenNames.add(o.name);
      r.seen = now; r.gone = false;
      const st = o.state;
      if (typeof st.t === 'number' && st.t !== r.t && typeof st.x === 'number') {
        // New state: remember where it puts the kart now, so the change can be eased in.
        const had = r.has;
        const oldX = r.x, oldY = r.y, oldA = r.a;
        r.t = st.t; r.has = true;
        r.offMin = Math.min(r.offMin, ms - st.t);
        const segN = G.N / SEGS;
        const cp = typeof st.cp === 'number' ? st.cp : 0;
        const i = nearestGlobal(G, st.x, st.y, Math.round((cp - 1) * segN), Math.round(segN * 3));
        frameAt(G, st.x, st.y, i, tmpF);
        r.s0 = tmpF.s; r.d0 = clamp(tmpF.d, -WALL, WALL); r.ang0 = G.ANG[i]; r.a0 = st.a || 0; r.v0 = st.v || 0;
        r.lap = typeof st.lap === 'number' ? st.lap : -1; r.cp = cp;
        r.fin = st.fin == null ? null : st.fin / 1000;
        r.f = st.f || 0; r.dl = st.dl || 0; r.steer = st.st || 0;
        r.rawProg = r.lap * G.L + r.s0;
        r.stamp = st.t;
        predictRemote(r, ms);
        if (had) {
          r.ex = oldX - r.px; r.ey = oldY - r.py; r.ea = wrapA(oldA - r.pa);
          if (Math.hypot(r.ex, r.ey) > 260) { r.ex = 0; r.ey = 0; r.ea = 0; }
        } else { r.ex = 0; r.ey = 0; r.ea = 0; }
        // Their bananas and the bananas they hit.
        const live = new Set();
        if (Array.isArray(st.h)) for (const z of st.h.slice(0, 12)) {
          if (!Array.isArray(z) || z.length < 3) continue;
          const key = `${r.index}.${z[0]}`; live.add(key);
          if (deadHaz.has(key) || hazards.some((q) => q.key === key)) continue;
          hazards.push({ key, owner: r.index, id: z[0], x: +z[1], y: +z[2], born: raceT, mine: false, a: Math.random() * TAU });
        }
        for (let j = hazards.length - 1; j >= 0; j--) { const q = hazards[j]; if (q.owner === r.index && !q.mine && !live.has(q.key)) hazards.splice(j, 1); }
        if (Array.isArray(st.k)) for (const key of st.k.slice(0, 20)) {
          if (typeof key !== 'string') continue;
          deadHaz.add(key);
          for (let j = hazards.length - 1; j >= 0; j--) if (hazards[j].key === key) hazards.splice(j, 1);
        }
      }
    }
    remotes.forEach((r) => {
      if (!seenNames.has(r.name) && r.has && now - r.seen > 4000) r.gone = true;
      r.offMin += dt * 4;
      if (r.has) predictRemote(r, ms);
      else { r.px = r.x; r.py = r.y; r.pa = r.a; }
      const k = Math.exp(-dt * 4.2);
      r.ex *= k; r.ey *= k; r.ea *= k;
      r.x = r.px + r.ex; r.y = r.py + r.ey; r.a = r.pa + r.ea;
      if (r.f & 8) r.spinA += dt * 12; else r.spinA = 0;
      if (r.f & 1 && r.dl > 0 && Math.random() < 0.5) sparks({ x: r.x, y: r.y, a: r.a, driftLvl: r.dl, drift: 1 });
      if (r.f & 2 && Math.random() < 0.5) flame({ x: r.x, y: r.y, a: r.a });
    });
  }
  function predictRemote(r, ms) {
    let stale = clamp((ms - r.t) - r.offMin + 120, 0, 1400) / 1000;
    const vAlong = r.v0 * Math.cos(r.a0 - r.ang0);
    let adv;
    if (r.fin != null) adv = vAlong * 1.2 * (1 - Math.exp(-stale / 1.2));
    else adv = vAlong * stale;
    pointAt(G, r.s0 + adv, r.d0, tmpP);
    // Rank by where they are now (not where their last update was), so every device agrees on the order.
    if (r.rawProg != null) r.prog = r.rawProg + (r.fin != null ? 0 : adv);
    r.px = tmpP.x; r.py = tmpP.y; r.pa = r.a0 + wrapA(tmpP.a - r.ang0);
  }

  // Before multiStart (during the shared 3-2-1), put everyone on the grid so the lights have something to show.
  function pollPreGrid() {
    if (!CG.countingDown()) return;
    const s = CG.session && CG.session();
    if (!s || s.status !== 'playing' || !s.players || !s.players.includes(CG.me())) return;
    if (preRound === s.round) return;
    preRound = s.round;
    setupMulti({ players: s.players, colors: s.players.map((_, i) => CG.colors[i % CG.colors.length]), me: CG.me(), seed: s.seed, shared: s.shared, round: s.round });
    state = 'mgrid';
    multiInfo.t0 = Date.parse(s.startAt);
    hideMenu(); showPause(false); hideFinish(); paused = false;
    prefetchAround();
  }

  function onMultiStart(info) {
    const s = CG.session && CG.session();
    if (!(state === 'mgrid' && preRound === info.round && multiInfo)) setupMulti(info);
    else { multiInfo.colors = info.colors || multiInfo.colors; me.color = multiInfo.colors[Math.max(0, multiInfo.myIndex)]; remotes.forEach((r) => { r.color = multiInfo.colors[r.index] || r.color; }); }
    preRound = info.round;
    multiInfo.t0 = s && s.startAt ? Date.parse(s.startAt) : Date.now();
    raceT = clamp((Date.now() - multiInfo.t0) / 1000, 0, 600);
    state = 'race'; paused = false;
    hideMenu(); showPause(false); hideFinish();
    if (!G) return;
    prefetchAround();
  }

  // ---------- Particles ----------
  function addP(p) { if (particles.length < 420) particles.push(p); }
  function puff(k) {
    const th = G.theme;
    addP({ x: k.x - Math.cos(k.a) * 14 + (Math.random() - 0.5) * 14, y: k.y - Math.sin(k.a) * 14 + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.5, max: 0.5, r: 4 + Math.random() * 3, c: th.dust[Math.random() < 0.5 ? 0 : 1], kind: 'dot' });
  }
  const SPARK = ['#ffffff', '#60a5fa', '#fb923c', '#f472b6'];
  function sparks(k) {
    const fx = Math.cos(k.a), fy = Math.sin(k.a), c = SPARK[k.driftLvl] || '#fff';
    for (const side of [-1, 1]) {
      const x = k.x - fx * 13 - fy * 10 * side, y = k.y - fy * 13 + fx * 10 * side;
      addP({ x, y, vx: -fx * 60 + (Math.random() - 0.5) * 90, vy: -fy * 60 + (Math.random() - 0.5) * 90, life: 0.28, max: 0.28, r: 2.4 + k.driftLvl * 0.6, c, kind: 'spark' });
    }
  }
  function flame(k) {
    const fx = Math.cos(k.a), fy = Math.sin(k.a);
    addP({ x: k.x - fx * 19 + (Math.random() - 0.5) * 6, y: k.y - fy * 19 + (Math.random() - 0.5) * 6, vx: -fx * 90, vy: -fy * 90, life: 0.22, max: 0.22, r: 5, c: Math.random() < 0.5 ? '#fde047' : '#fb923c', kind: 'dot' });
  }
  function burstConfetti() {
    const cols = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#facc15', '#ffffff'];
    for (let i = 0; i < 160; i++) {
      confetti.push({ x: Wl * (0.1 + Math.random() * 0.8), y: -20 - Math.random() * Hl * 0.5, vx: (Math.random() - 0.5) * 120, vy: 80 + Math.random() * 160, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 12, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: cols[i % cols.length], life: 4 + Math.random() * 2 });
    }
  }
  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      if (p.life <= 0) { particles[i] = particles[particles.length - 1]; particles.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i]; c.life -= dt;
      if (c.life <= 0 || c.y > Hl + 30) { confetti.splice(i, 1); continue; }
      c.x += (c.vx + Math.sin(c.life * 3 + c.r) * 40) * dt; c.y += c.vy * dt; c.r += c.vr * dt;
    }
  }

  // ---------- Sprites (scenery art, drawn top-down) ----------
  const PAINT = {
    tree(g, r, v) {
      ell(g, r * 0.22, r * 0.28, r, r * 0.95, 0, 'rgba(20,60,20,.25)');
      const lobes = 7;
      disc(g, 0, 0, r * 0.92, '#2f8a3a');
      for (let i = 0; i < lobes; i++) { const a = i / lobes * TAU + v; disc(g, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.48, '#3ea047'); }
      disc(g, -r * 0.18, -r * 0.2, r * 0.55, '#52b553');
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + v * 2; disc(g, -r * 0.2 + Math.cos(a) * r * 0.32, -r * 0.24 + Math.sin(a) * r * 0.3, r * 0.2, '#6cc962'); }
      disc(g, -r * 0.35, -r * 0.38, r * 0.14, '#8fe07e');
      if (v > 0.6) for (let i = 0; i < 5; i++) { const a = i * 1.3 + v * 5; disc(g, Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.07, '#ef4444'); }
    },
    bush(g, r, v) {
      ell(g, r * 0.2, r * 0.25, r, r * 0.85, 0, 'rgba(20,60,20,.22)');
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + v; disc(g, Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, r * 0.55, '#43a047'); }
      disc(g, -r * 0.15, -r * 0.15, r * 0.45, '#66bb6a');
      const fc = ['#f472b6', '#fde047', '#ffffff', '#c084fc'][Math.floor(v * 4)];
      for (let i = 0; i < 6; i++) { const a = i * 1.1 + v * 3; disc(g, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.5, r * 0.12, fc); }
    },
    flowers(g, r, v) {
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4 + v * 6, d = r * (0.15 + (i % 3) * 0.3), x = Math.cos(a) * d, y = Math.sin(a) * d;
        const c = ['#ff5d8f', '#ffd23f', '#ffffff', '#b07bff', '#ff8a3d'][(i + Math.floor(v * 5)) % 5];
        for (let p = 0; p < 5; p++) { const pa = p / 5 * TAU; disc(g, x + Math.cos(pa) * 3.4, y + Math.sin(pa) * 3.4, 2.8, c); }
        disc(g, x, y, 2, '#f59e0b');
      }
    },
    rock(g, r) {
      ell(g, r * 0.2, r * 0.25, r, r * 0.8, 0, 'rgba(0,0,0,.18)');
      ell(g, 0, 0, r, r * 0.8, 0.3, '#9ca3af'); ell(g, -r * 0.2, -r * 0.2, r * 0.6, r * 0.45, 0.3, '#cbd5e1');
    },
    pond(g, r, v) {
      ell(g, 0, 0, r * 1.08, r * 0.78, v, '#d9c38f');
      ell(g, 0, 0, r, r * 0.7, v, '#38bdf8');
      ell(g, -r * 0.15, -r * 0.1, r * 0.75, r * 0.45, v, '#5fcdfb');
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(-r * 0.2, -r * 0.18, r * 0.4, r * 0.18, v, 3.6, 5.2); g.stroke();
      for (let i = 0; i < 3; i++) { const a = v * 7 + i * 2.1; const x = Math.cos(a) * r * 0.5, y = Math.sin(a) * r * 0.32; disc(g, x, y, 7, '#4caf50'); disc(g, x + 2, y - 2, 2.4, '#f9a8d4'); }
    },
    picnic(g, r, v) {
      g.save(); g.rotate(v * 3);
      g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(-r * 0.75 + 4, -r * 0.75 + 5, r * 1.5, r * 1.5);
      const n = 6, s = r * 1.5 / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? '#ffffff' : '#ef4444'; g.fillRect(-r * 0.75 + i * s, -r * 0.75 + j * s, s + 0.3, s + 0.3); }
      disc(g, r * 0.2, -r * 0.1, r * 0.22, '#c08552'); disc(g, -r * 0.25, r * 0.25, r * 0.12, '#ef4444');
      g.restore();
    },
    lolly(g, r, v) {
      g.save(); g.rotate(v * 6);
      g.fillStyle = 'rgba(120,20,80,.18)'; g.fillRect(0, -2, r * 1.8, 6);
      g.fillStyle = '#fff'; g.fillRect(0, -3, r * 1.7, 5);
      g.restore();
      disc(g, r * 0.18, r * 0.22, r, 'rgba(120,20,80,.2)');
      const cols = [['#ff4fa3', '#fff'], ['#60a5fa', '#fff'], ['#facc15', '#f97316'], ['#a3e635', '#fff']][Math.floor(v * 4)];
      disc(g, 0, 0, r, cols[1]);
      g.strokeStyle = cols[0]; g.lineWidth = r * 0.24; g.lineCap = 'round'; g.beginPath();
      for (let t = 0; t < 1; t += 0.02) { const a = t * TAU * 2.6 + v * 5, d = t * r * 0.86; if (t === 0) g.moveTo(Math.cos(a) * d, Math.sin(a) * d); else g.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
      g.stroke();
      disc(g, -r * 0.35, -r * 0.35, r * 0.18, 'rgba(255,255,255,.7)');
    },
    gumdrop(g, r, v) {
      disc(g, r * 0.2, r * 0.25, r, 'rgba(120,20,80,.18)');
      const c = ['#f43f5e', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4'][Math.floor(v * 5)];
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      gr.addColorStop(0, shade(c, 0.55)); gr.addColorStop(1, c);
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
      for (let i = 0; i < 10; i++) { const a = i * 2.3 + v * 9, d = r * (0.3 + (i % 3) * 0.2); disc(g, Math.cos(a) * d, Math.sin(a) * d, 1.3, 'rgba(255,255,255,.8)'); }
    },
    donut(g, r, v) {
      disc(g, r * 0.2, r * 0.25, r, 'rgba(120,20,80,.18)');
      disc(g, 0, 0, r, '#e7a96b');
      const ic = ['#ff7ab8', '#7c3aed', '#fde68a', '#5b3a29'][Math.floor(v * 4)];
      g.fillStyle = ic; g.beginPath();
      for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU, d = r * (0.82 + Math.sin(i * 2.7 + v * 9) * 0.07); if (i === 0) g.moveTo(Math.cos(a) * d, Math.sin(a) * d); else g.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
      g.closePath(); g.fill();
      const sc = ['#ffffff', '#facc15', '#38bdf8', '#4ade80', '#f87171'];
      for (let i = 0; i < 16; i++) {
        const a = i * 2.39 + v, d = r * (0.48 + (i % 3) * 0.12);
        g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.rotate(a * 3); g.fillStyle = sc[i % 5]; g.fillRect(-2.6, -0.9, 5.2, 1.8); g.restore();
      }
      disc(g, 0, 0, r * 0.32, '#ffc6df');
      g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r * 0.32, 0, TAU); g.stroke();
    },
    cupcake(g, r, v) {
      disc(g, r * 0.2, r * 0.25, r, 'rgba(120,20,80,.18)');
      g.fillStyle = '#f5d0a9'; g.beginPath();
      for (let i = 0; i <= 28; i++) { const a = i / 28 * TAU, d = r * (i % 2 ? 0.92 : 1); if (i === 0) g.moveTo(Math.cos(a) * d, Math.sin(a) * d); else g.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
      g.fill();
      const fc = ['#f9a8d4', '#a5f3fc', '#fde68a', '#ddd6fe'][Math.floor(v * 4)];
      disc(g, 0, 0, r * 0.8, fc); disc(g, 0, 0, r * 0.56, shade(fc, 0.3)); disc(g, 0, 0, r * 0.32, shade(fc, 0.55));
      disc(g, r * 0.05, r * 0.05, r * 0.2, '#dc2626'); disc(g, -r * 0.03, -r * 0.04, r * 0.07, '#fecaca');
    },
    sweet(g, r, v) {
      g.save(); g.rotate(v * 6);
      ell(g, r * 0.2, r * 0.25, r * 1.2, r * 0.6, 0, 'rgba(120,20,80,.15)');
      const c = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899'][Math.floor(v * 5)];
      g.fillStyle = shade(c, 0.25);
      g.beginPath(); g.moveTo(-r * 0.4, 0); g.lineTo(-r * 1.1, -r * 0.45); g.lineTo(-r * 1.1, r * 0.45); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(r * 0.4, 0); g.lineTo(r * 1.1, -r * 0.45); g.lineTo(r * 1.1, r * 0.45); g.closePath(); g.fill();
      ell(g, 0, 0, r * 0.62, r * 0.5, 0, c);
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * r * 0.25 - 3, -r * 0.4); g.lineTo(i * r * 0.25 + 3, r * 0.4); g.stroke(); }
      g.restore();
    },
    pine(g, r, v) {
      ell(g, r * 0.25, r * 0.3, r, r * 0.95, 0, 'rgba(40,70,120,.2)');
      const layer = (rad, col, rot) => {
        g.fillStyle = col; g.beginPath();
        for (let i = 0; i < 16; i++) { const a = i / 16 * TAU + rot, d = i % 2 ? rad * 0.62 : rad; if (i === 0) g.moveTo(Math.cos(a) * d, Math.sin(a) * d); else g.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
        g.closePath(); g.fill();
      };
      layer(r, '#1f5f3c', v); layer(r * 0.74, '#2d7a4c', v + 0.2); layer(r * 0.48, '#3d9460', v + 0.4); disc(g, 0, 0, r * 0.14, '#6b4423');
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + v, d = r * (i % 2 ? 0.55 : 0.82); disc(g, Math.cos(a) * d, Math.sin(a) * d, r * 0.09, '#ffffff'); }
    },
    snowman(g, r, v) {
      g.save(); g.rotate(v * 6);
      ell(g, r * 0.25, r * 0.3, r * 1.15, r * 0.8, 0, 'rgba(40,70,120,.2)');
      g.strokeStyle = '#7c4a24'; g.lineWidth = 2.4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-r * 0.2, -r * 0.6); g.lineTo(-r * 0.1, -r * 1.25); g.moveTo(-r * 0.12, -r * 1.0); g.lineTo(-r * 0.35, -r * 1.2);
      g.moveTo(-r * 0.2, r * 0.6); g.lineTo(-r * 0.1, r * 1.25); g.moveTo(-r * 0.12, r * 1.0); g.lineTo(-r * 0.35, r * 1.2); g.stroke();
      const ball = (x, rad) => { const gr = g.createRadialGradient(x - rad * 0.35, -rad * 0.35, rad * 0.1, x, 0, rad); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#d6e4f5'); g.fillStyle = gr; g.beginPath(); g.arc(x, 0, rad, 0, TAU); g.fill(); };
      ball(-r * 0.3, r * 0.72);
      for (let i = -1; i <= 1; i++) disc(g, -r * 0.3 + i * r * 0.28, 0, 1.8, '#1f2937');
      ball(r * 0.45, r * 0.5);
      disc(g, r * 0.55, -r * 0.17, 1.9, '#1f2937'); disc(g, r * 0.55, r * 0.17, 1.9, '#1f2937');
      g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(r * 0.7, -r * 0.08); g.lineTo(r * 1.15, 0); g.lineTo(r * 0.7, r * 0.08); g.closePath(); g.fill();
      g.restore();
    },
    srock(g, r) {
      ell(g, r * 0.25, r * 0.3, r, r * 0.8, 0, 'rgba(40,70,120,.2)');
      ell(g, 0, 0, r, r * 0.8, 0.4, '#94a3b8'); ell(g, -r * 0.15, -r * 0.2, r * 0.7, r * 0.5, 0.4, '#ffffff');
    },
    ice(g, r, v) {
      ell(g, 0, 0, r * 1.06, r * 0.76, v, '#ffffff');
      ell(g, 0, 0, r, r * 0.7, v, '#bae6fd');
      ell(g, -r * 0.2, -r * 0.12, r * 0.6, r * 0.35, v, '#dbf3ff');
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.6; g.beginPath();
      for (let i = 0; i < 4; i++) { const a = v * 5 + i * 1.6; g.moveTo(Math.cos(a) * r * 0.1, Math.sin(a) * r * 0.1); g.lineTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.4); g.lineTo(Math.cos(a + 0.4) * r * 0.75, Math.sin(a + 0.4) * r * 0.5); }
      g.stroke();
    },
    igloo(g, r, v) {
      g.save(); g.rotate(v * 6);
      ell(g, r * 0.2, r * 0.25, r * 0.85, r * 0.8, 0, 'rgba(40,70,120,.2)');
      g.fillStyle = '#e2e8f0'; g.fillRect(r * 0.5, -r * 0.25, r * 0.45, r * 0.5);
      const gr = g.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r * 0.75);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#dbeafe');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 0.72, 0, TAU); g.fill();
      g.strokeStyle = '#bfdbfe'; g.lineWidth = 2;
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(0, 0, r * 0.72 * k / 4, 0, TAU); g.stroke(); }
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.18, Math.sin(a) * r * 0.18); g.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72); g.stroke(); }
      g.fillStyle = '#334155'; g.fillRect(r * 0.8, -r * 0.15, r * 0.15, r * 0.3);
      g.restore();
    }
  };
  // ---------- Track tiles (pre-rendered, cached) ----------
  const tiles = new Map();
  const tilePool = [];
  let tileScale = 1, tileCap = 40, tileFrame = 0;
  function clearTiles() { tiles.forEach((t) => tilePool.push(t.c)); tiles.clear(); }
  function clearTilesIfNeeded() { /* tiles stay valid while the track and scale are unchanged */ }
  function tileFor(ix, iy, force) {
    const key = ix * 4096 + iy;
    let t = tiles.get(key);
    if (t) { t.used = tileFrame; return t; }
    if (!force) return null;
    t = { c: renderTile(ix, iy), used: tileFrame };
    tiles.set(key, t);
    if (tiles.size > tileCap) {
      let oldK = null, oldU = Infinity;
      tiles.forEach((v, k) => { if (v.used < oldU && v.used < tileFrame - 1) { oldU = v.used; oldK = k; } });
      if (oldK != null) { tilePool.push(tiles.get(oldK).c); tiles.delete(oldK); }
    }
    return t;
  }
  function renderTile(ix, iy) {
    const s = tileScale, x0 = ix * TILE - 1, y0 = iy * TILE - 1, WD = TILE + 2;
    const px = Math.ceil(WD * s);
    const c = tilePool.pop() || document.createElement('canvas');
    if (c.width !== px) { c.width = px; c.height = px; }
    const g = c.getContext('2d', { alpha: false });
    g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    paintGround(g, x0, y0, WD, ix, iy);
    paintTrack(g, x0, y0, WD);
    paintDecor(g, x0, y0, WD);
    return c;
  }
  function paintGround(g, x0, y0, WD, ix, iy) {
    const th = G.theme;
    g.fillStyle = th.ground; g.fillRect(x0, y0, WD, WD);
    const rnd = CG.rng(((ix + 50) * 7919 + (iy + 50) * 104729 + G.ti * 31) >>> 0);
    if (G.theme === THEMES.park) {
      g.fillStyle = th.ground2;
      const P = 180;
      for (let k = Math.floor((x0 + y0) / P) - 1; k * P < x0 + y0 + WD * 2; k++) {
        const c0 = k * P;
        g.beginPath(); g.moveTo(c0 - y0, y0); g.lineTo(c0 + P / 2 - y0, y0); g.lineTo(c0 + P / 2 - (y0 + WD), y0 + WD); g.lineTo(c0 - (y0 + WD), y0 + WD); g.closePath(); g.fill();
      }
      for (let i = 0; i < 26; i++) disc(g, x0 + rnd() * WD, y0 + rnd() * WD, 1.6 + rnd() * 1.6, rnd() < 0.5 ? '#68b244' : '#94da70');
    } else if (G.theme === THEMES.candy) {
      const cols = ['#ffffff', '#fde047', '#60a5fa', '#a78bfa', '#f472b6', '#4ade80'];
      for (let i = 0; i < 34; i++) {
        g.save(); g.translate(x0 + rnd() * WD, y0 + rnd() * WD); g.rotate(rnd() * TAU);
        g.fillStyle = cols[Math.floor(rnd() * cols.length)]; rr(g, -4, -1.4, 8, 2.8, 1.4); g.fill(); g.restore();
      }
    } else {
      for (let i = 0; i < 30; i++) disc(g, x0 + rnd() * WD, y0 + rnd() * WD, 1.5 + rnd() * 2.5, rnd() < 0.5 ? '#d6e6f7' : '#ffffff');
      g.strokeStyle = 'rgba(160,190,225,.35)'; g.lineWidth = 2;
      for (let i = 0; i < 3; i++) { const x = x0 + rnd() * WD, y = y0 + rnd() * WD; g.beginPath(); g.arc(x, y, 30 + rnd() * 40, 3.5, 5.6); g.stroke(); }
    }
  }
  function paintTrack(g, x0, y0, WD) {
    const th = G.theme, pad = WALL + 14;
    const list = G.chunks.filter((c) => c.x1 >= x0 - pad && c.x0 <= x0 + WD + pad && c.y1 >= y0 - pad && c.y0 <= y0 + WD + pad);
    if (!list.length) return;
    g.lineJoin = 'round';
    const pass = (w, col, dash) => {
      g.lineWidth = w; g.strokeStyle = col; g.setLineDash(dash || []); g.lineCap = dash ? 'butt' : 'round';
      for (const c of list) { g.lineDashOffset = c.s0; g.stroke(c.p); }
    };
    pass(2 * (WALL + 9), G.theme === THEMES.snow ? '#b9d0ea' : shade(th.wall[0], -0.15));
    pass(2 * (WALL + 7), th.wall[0]);
    if (th.wall[1] !== th.wall[0]) pass(2 * (WALL + 7), th.wall[1], [16, 16]);
    pass(2 * WALL, th.runoff);
    pass(2 * (RW + CURB) + 4, 'rgba(0,0,0,.08)');
    pass(2 * (RW + CURB), th.curb[1]);
    pass(2 * (RW + CURB), th.curb[0], [20, 20]);
    pass(2 * RW, th.road);
    pass(2 * RW - 36, th.road2);
    pass(2.5, 'rgba(255,255,255,.38)', [22, 34]);
    g.setLineDash([]);
    // Start/finish line and grid boxes.
    if (G.X[0] > x0 - 200 && G.X[0] < x0 + WD + 200 && G.Y[0] > y0 - 200 && G.Y[0] < y0 + WD + 200) {
      g.save(); g.translate(G.X[0], G.Y[0]); g.rotate(G.ANG[0]);
      const n = 12, sq = 2 * RW / n;
      for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { g.fillStyle = (i + r) % 2 ? '#111827' : '#ffffff'; g.fillRect(-sq + r * sq, -RW + i * sq, sq + 0.4, sq + 0.4); }
      g.restore();
    }
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.5; g.lineCap = 'round';
    for (let k = 0; k < 8; k++) {
      gridSlot(k, tmpP);
      if (tmpP.x < x0 - 60 || tmpP.x > x0 + WD + 60 || tmpP.y < y0 - 60 || tmpP.y > y0 + WD + 60) continue;
      g.save(); g.translate(tmpP.x, tmpP.y); g.rotate(tmpP.a);
      g.beginPath(); g.moveTo(-6, -15); g.lineTo(20, -15); g.lineTo(20, 15); g.lineTo(-6, 15); g.stroke();
      g.restore();
    }
  }
  function paintDecor(g, x0, y0, WD) {
    const st = W.stand;
    if (st && st.x > x0 - 200 && st.x < x0 + WD + 200 && st.y > y0 - 200 && st.y < y0 + WD + 200) paintStand(g, st);
    for (const o of W.solids) {
      if (o.x + 30 < x0 || o.x - 30 > x0 + WD || o.y + 30 < y0 || o.y - 30 > y0 + WD) continue;
      g.save(); g.translate(o.x, o.y); g.rotate(o.rot); paintTyres(g, o.r); g.restore();
    }
    for (const o of W.decor) {
      const ext = o.r * 1.5 + 8;
      if (o.x + ext < x0 || o.x - ext > x0 + WD || o.y + ext < y0 || o.y - ext > y0 + WD) continue;
      g.save(); g.translate(o.x, o.y); PAINT[o.type](g, o.r, o.v); g.restore();
    }
  }
  function paintTyres(g, r) {
    const th = G.theme;
    ell(g, 4, 5, r * 1.25, r * 1.05, 0, 'rgba(0,0,0,.2)');
    for (const [x, y] of [[-r * 0.55, -r * 0.45], [r * 0.55, -r * 0.45], [0, r * 0.5]]) {
      disc(g, x, y, r * 0.62, '#1f2937');
      disc(g, x, y, r * 0.42, th.curb[0]);
      disc(g, x, y, r * 0.24, '#111827');
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, r * 0.52, 3.6, 4.9); g.stroke();
    }
  }
  function paintStand(g, st) {
    g.save(); g.translate(st.x, st.y); g.rotate(st.a);
    const w = 300, h = 74;
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
    g.fillStyle = '#e5e7eb'; g.fillRect(-w / 2, -h / 2, w, h);
    const rnd = CG.rng(99);
    const cols = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#fde047'];
    for (let row = 0; row < 4; row++) {
      g.fillStyle = row % 2 ? '#cbd5e1' : '#d1d5db'; g.fillRect(-w / 2, -h / 2 + row * (h / 4), w, h / 4 - 1);
      for (let i = 0; i < 26; i++) if (rnd() < 0.85) disc(g, -w / 2 + 7 + i * 11.2 + (row % 2) * 4, -h / 2 + row * (h / 4) + 9, 4.2, cols[Math.floor(rnd() * cols.length)]);
    }
    const sideOut = st.side;
    g.fillStyle = '#dc2626';
    for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#dc2626'; g.fillRect(-w / 2 + i * w / 10, sideOut > 0 ? h / 2 - 2 : -h / 2 - 12, w / 10, 14); }
    g.restore();
  }
  function prefetchAround() {
    if (!G || !me) return;
    const R = 650;
    const cx = me.x, cy = me.y;
    for (let ix = Math.floor((cx - R) / TILE); ix <= Math.floor((cx + R) / TILE); ix++) for (let iy = Math.floor((cy - R) / TILE); iy <= Math.floor((cy + R) / TILE); iy++) tileFor(ix, iy, true);
  }

  // ---------- Minimap ----------
  let miniBase = null, miniT = null;
  function buildMini() {
    if (!miniEl) return;
    const [bx0, by0, bx1, by1] = G.bbox;
    const pad = 90, w = bx1 - bx0 + pad * 2, h = by1 - by0 + pad * 2;
    const cw = 104, sc = cw / Math.max(w, h * 1.0);
    const ch = Math.round(h * sc), cwid = Math.round(w * sc);
    const dp = Math.min(2, window.devicePixelRatio || 1);
    miniEl.width = Math.round(cwid * dp); miniEl.height = Math.round(ch * dp);
    miniEl.style.width = cwid + 'px'; miniEl.style.height = ch + 'px';
    const c = document.createElement('canvas'); c.width = miniEl.width; c.height = miniEl.height;
    const g = c.getContext('2d');
    g.setTransform(sc * dp, 0, 0, sc * dp, (-bx0 + pad) * sc * dp, (-by0 + pad) * sc * dp);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = new Path2D(); for (let i = 0; i <= G.N; i += 2) { const k = i % G.N; if (!i) path.moveTo(G.X[k], G.Y[k]); else path.lineTo(G.X[k], G.Y[k]); } path.closePath();
    const px = 1 / sc;
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 9 * px; g.stroke(path);
    g.strokeStyle = '#ffffff'; g.lineWidth = 6.5 * px; g.stroke(path);
    g.strokeStyle = G.theme.road; g.lineWidth = 3.6 * px; g.stroke(path);
    g.save(); g.translate(G.X[0], G.Y[0]); g.rotate(G.ANG[0]); const q = 2.2 * px; for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111827' : '#ffffff'; g.fillRect(-q + j * q, -2 * q + i * q, q, q); } g.restore();
    miniBase = c; miniT = { sc: sc * dp, ox: (-bx0 + pad) * sc * dp, oy: (-by0 + pad) * sc * dp };
  }
  function drawMini() {
    if (!miniEl || !miniBase) return;
    const g = miniEl.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, miniEl.width, miniEl.height);
    g.drawImage(miniBase, 0, 0);
    const dp = miniEl.width / parseFloat(miniEl.style.width || '1');
    const dot = (x, y, c, big) => {
      const px = x * miniT.sc + miniT.ox, py = y * miniT.sc + miniT.oy;
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(px, py, (big ? 6 : 4.4) * dp / 2 * 1.5, 0, TAU); g.fill();
      g.fillStyle = c; g.beginPath(); g.arc(px, py, (big ? 4.4 : 3.2) * dp / 2 * 1.5, 0, TAU); g.fill();
    };
    remotes.forEach((r) => { if (!r.gone) dot(r.x, r.y, r.color); });
    for (const k of karts) if (!k.isMe) dot(k.x, k.y, k.color);
    if (me) dot(me.x, me.y, me.color, true);
  }

  // ---------- Rendering ----------
  let root, cvs, ctx, dpr = 1, Wl = 1, Hl = 1, Z = 1;
  const cam = { x: 0, y: 0, a: 0, init: false };
  let lastFocus = null;

  function focusKart() {
    if (state === 'menu') return karts[0] || null;
    if (multi && me && me.fin != null && finishT > 1.2) {
      const st = standings();
      const live = st.find((r) => !r.isMe && r.fin == null && !r.gone);
      if (live) return live;
    }
    return me;
  }

  function render(dt) {
    const g = ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = G ? G.theme.ground : '#7cc957';
    g.fillRect(0, 0, Wl, Hl);
    if (!G) return;
    const f = focusKart();
    if (f) {
      const fa = f.a;
      if (!cam.init) { cam.x = f.x; cam.y = f.y; cam.a = fa; cam.init = true; lastFocus = f; cam.blend = 0; }
      if (lastFocus !== f) { lastFocus = f; cam.blend = 1; }
      cam.blend = Math.max(0, (cam.blend || 0) - dt * 1.2);
      const kpos = 1 - Math.exp(-dt * lerp(14, 2.5, cam.blend));
      const far = Math.hypot(f.x - cam.x, f.y - cam.y) > 900;
      cam.x = far ? f.x : cam.x + (f.x - cam.x) * kpos;
      cam.y = far ? f.y : cam.y + (f.y - cam.y) * kpos;
      cam.a += wrapA(fa - cam.a) * (1 - Math.exp(-dt * lerp(4.2, 2, cam.blend)));
    }
    let sx = 0, sy = 0;
    if (shake > 0) { shake -= dt; sx = (Math.random() - 0.5) * 6 * shake; sy = (Math.random() - 0.5) * 6 * shake; }
    // While watching someone else, the results card covers the middle: show their kart lower down.
    const wantY = f && f !== me && state === 'done' && CG.modalOpen() ? 0.83 : 0.66;
    cam.ay = cam.ay == null ? wantY : cam.ay + (wantY - cam.ay) * (1 - Math.exp(-dt * 3));
    const ax = Wl / 2 + sx, ay = Hl * cam.ay + sy;
    const rot = -cam.a - Math.PI / 2;
    g.translate(ax, ay); g.rotate(rot); g.scale(Z, Z); g.translate(-cam.x, -cam.y);
    // Visible world box.
    const cs = Math.cos(-rot), sn = Math.sin(-rot);
    let wx0 = 1e9, wy0 = 1e9, wx1 = -1e9, wy1 = -1e9;
    for (const [px, py] of [[-ax, -ay], [Wl - ax, -ay], [-ax, Hl - ay], [Wl - ax, Hl - ay]]) {
      const ux = (px * cs - py * sn) / Z + cam.x, uy = (px * sn + py * cs) / Z + cam.y;
      wx0 = Math.min(wx0, ux); wy0 = Math.min(wy0, uy); wx1 = Math.max(wx1, ux); wy1 = Math.max(wy1, uy);
    }
    tileFrame++;
    const t0 = performance.now();
    for (let ix = Math.floor(wx0 / TILE); ix <= Math.floor(wx1 / TILE); ix++) for (let iy = Math.floor(wy0 / TILE); iy <= Math.floor(wy1 / TILE); iy++) {
      const t = tileFor(ix, iy, true);
      g.drawImage(t.c, ix * TILE - 1, iy * TILE - 1, TILE + 2, TILE + 2);
    }
    // Warm one tile ahead per frame when there is time.
    if (f && performance.now() - t0 < 4) {
      const ahead = 520, hx = f.x + Math.cos(f.a) * ahead, hy = f.y + Math.sin(f.a) * ahead;
      outer: for (let ix = Math.floor((hx - 300) / TILE); ix <= Math.floor((hx + 300) / TILE); ix++) for (let iy = Math.floor((hy - 300) / TILE); iy <= Math.floor((hy + 300) / TILE); iy++) {
        if (!tiles.has(ix * 4096 + iy)) { tileFor(ix, iy, true); break outer; }
      }
    }
    const inView = (x, y, m) => x > wx0 - m && x < wx1 + m && y > wy0 - m && y < wy1 + m;
    const tnow = performance.now() / 1000;
    // Boost pads
    for (const p of W.pads) {
      if (!inView(p.x, p.y, 60)) continue;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a);
      rr(g, -26, -17, 52, 34, 7); g.fillStyle = '#7c2d12'; g.fill();
      rr(g, -24, -15, 48, 30, 6); const gr = g.createLinearGradient(-24, 0, 24, 0); gr.addColorStop(0, '#f97316'); gr.addColorStop(1, '#facc15'); g.fillStyle = gr; g.fill();
      for (let i = 0; i < 3; i++) {
        const ph = ((tnow * 2.2 - i * 0.33) % 1 + 1) % 1;
        g.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * (1 - ph)})`;
        const x = -14 + i * 12;
        g.beginPath(); g.moveTo(x - 4, -10); g.lineTo(x + 5, 0); g.lineTo(x - 4, 10); g.lineTo(x - 9, 10); g.lineTo(x, 0); g.lineTo(x - 9, -10); g.closePath(); g.fill();
      }
      g.restore();
    }
    // Item boxes
    for (const b of W.boxes) {
      if (!inView(b.x, b.y, 40)) continue;
      const grow = b.off > 0 ? clamp(1 - b.off / 0.35, 0, 1) * 0 + (b.off < 0.4 ? 1 - b.off / 0.4 : 0) : 1;
      if (grow <= 0.02) continue;
      const bob = 1 + Math.sin(tnow * 4 + b.spin) * 0.06;
      g.save(); g.translate(b.x, b.y);
      ell(g, 3, 4, 13 * grow, 11 * grow, 0, 'rgba(0,0,0,.2)');
      g.rotate(b.spin); g.scale(grow * bob, grow * bob);
      const hue = (tnow * 90 + b.d * 3) % 360;
      const gr = g.createLinearGradient(-12, -12, 12, 12);
      gr.addColorStop(0, `hsl(${hue},95%,68%)`); gr.addColorStop(0.5, `hsl(${(hue + 80) % 360},95%,62%)`); gr.addColorStop(1, `hsl(${(hue + 160) % 360},95%,60%)`);
      rr(g, -12, -12, 24, 24, 6); g.fillStyle = gr; g.fill();
      g.lineWidth = 2.2; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke();
      g.rotate(-b.spin - rot);
      g.fillStyle = '#ffffff'; g.font = `800 17px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeText('?', 0, 1); g.fillText('?', 0, 1);
      g.restore();
    }
    // Bananas
    for (const h of hazards) { if (inView(h.x, h.y, 30)) drawBanana(g, h.x, h.y, h.a, 1.45); }
    // Karts (remote first, then local, me last)
    remotes.forEach((r) => {
      if (r.gone || !inView(r.x, r.y, 50)) return;
      const parked = r.fin != null && (raceT - r.fin) > 2.5;
      drawKart(g, { x: r.x, y: r.y, a: r.a + r.spinA, color: r.color, steer: r.steer, drift: r.f & 1 ? 1 : 0, shield: r.f & 4, boost: r.f & 2, hop: 0 }, parked ? 0.55 : 1);
    });
    for (const k of karts) if (!k.isMe && inView(k.x, k.y, 50)) drawKart(g, kv(k), 1);
    if (me && inView(me.x, me.y, 50)) drawKart(g, kv(me), 1);
    // Particles
    for (const p of particles) {
      if (!inView(p.x, p.y, 20)) continue;
      const t = p.life / p.max;
      g.globalAlpha = Math.min(1, t * 1.6);
      if (p.kind === 'star') { g.save(); g.translate(p.x, p.y); g.rotate(tnow * 6); starPath(g, p.r * (0.6 + t * 0.4)); g.fillStyle = p.c; g.fill(); g.restore(); }
      else if (p.kind === 'spark') {
        const r = p.r * (0.6 + t * 0.7);
        g.fillStyle = p.c; g.beginPath(); g.moveTo(p.x, p.y - r * 1.8); g.lineTo(p.x + r * 0.5, p.y); g.lineTo(p.x, p.y + r * 1.8); g.lineTo(p.x - r * 0.5, p.y); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(p.x - r * 1.8, p.y); g.lineTo(p.x, p.y + r * 0.5); g.lineTo(p.x + r * 1.8, p.y); g.lineTo(p.x, p.y - r * 0.5); g.closePath(); g.fill();
        disc(g, p.x, p.y, r * 0.45, '#ffffff');
      }
      else disc(g, p.x, p.y, p.r * (0.6 + (1 - t) * 0.6), p.c);
    }
    g.globalAlpha = 1;
    // Start gantry over the line
    if (inView(G.X[0], G.Y[0], 140)) {
      g.save(); g.translate(G.X[0], G.Y[0]); g.rotate(G.ANG[0]);
      g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(4, -RW - 22 + 6, 12, 2 * RW + 44);
      disc(g, 0, -RW - 18, 7, '#374151'); disc(g, 0, RW + 18, 7, '#374151');
      g.fillStyle = 'rgba(17,24,39,.82)'; g.fillRect(-5, -RW - 16, 10, 2 * RW + 32);
      for (let i = 0; i < 3; i++) {
        const lit = state === 'grid' ? lightsOn(gridT) : state === 'mgrid' ? mLights() : 4;
        const col = lit >= 4 ? '#22c55e' : i < lit ? '#ef4444' : '#4b5563';
        disc(g, 0, -24 + i * 24, 5.5, col);
      }
      g.restore();
    }
    // Name tags (screen space)
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toScreen = (x, y) => {
      const dx = (x - cam.x) * Z, dy = (y - cam.y) * Z;
      const c2 = Math.cos(rot), s2 = Math.sin(rot);
      return [ax + dx * c2 - dy * s2, ay + dx * s2 + dy * c2];
    };
    g.font = `700 12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tag = (x, y, name, color, alpha) => {
      const [px, py] = toScreen(x, y);
      if (px < -60 || px > Wl + 60 || py < -40 || py > Hl + 40) return;
      const w = Math.min(110, g.measureText(name).width + 14), ty = py - 30 * Math.max(0.85, Z);
      g.globalAlpha = alpha;
      rr(g, px - w / 2, ty - 10, w, 20, 10); g.fillStyle = color; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
      g.fillStyle = '#ffffff'; g.fillText(name.length > 12 ? name.slice(0, 11) + '…' : name, px, ty + 0.5);
      g.beginPath(); g.moveTo(px - 4, ty + 10); g.lineTo(px + 4, ty + 10); g.lineTo(px, ty + 15); g.closePath(); g.fillStyle = color; g.fill();
      g.globalAlpha = 1;
    };
    remotes.forEach((r) => { if (!r.gone) tag(r.x, r.y, r.name, r.color, r.fin != null && raceT - r.fin > 2.5 ? 0.6 : 1); });
    if (state !== 'menu') for (const k of karts) if (!k.isMe) tag(k.x, k.y, k.name, k.color, 1);
    if (f && f !== me && state !== 'menu' && me) { /* watching someone else: own tag helps find yourself */ tag(me.x, me.y, 'You', me.color, 0.8); }
    // Confetti
    for (const c of confetti) {
      g.save(); g.translate(c.x, c.y); g.rotate(c.r); g.fillStyle = c.c; g.globalAlpha = Math.min(1, c.life); g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); g.restore();
    }
    g.globalAlpha = 1;
  }
  function kv(k) { return { x: k.x, y: k.y, a: k.a + k.spinA + (k.drift ? k.drift * 0.32 : 0), color: k.color, steer: k.steerVis, drift: k.drift, shield: k.shieldT > 0 ? (k.shieldT < 2 ? (Math.sin(k.shieldT * 20) > 0 ? 1 : 0) : 1) : 0, boost: k.boostT > 0, hop: k.hopT > 0 ? Math.sin((0.2 - k.hopT) / 0.2 * Math.PI) : 0, me: k.isMe }; }
  function starPath(g, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, d = i % 2 ? r * 0.45 : r; if (!i) g.moveTo(Math.cos(a) * d, Math.sin(a) * d); else g.lineTo(Math.cos(a) * d, Math.sin(a) * d); }
    g.closePath();
  }
  function drawBanana(g, x, y, a, s) {
    g.save(); g.translate(x, y); g.rotate(a); g.scale(s, s);
    ell(g, 2, 3, 12, 7, 0, 'rgba(0,0,0,.2)');
    g.fillStyle = '#facc15'; g.strokeStyle = '#a16207'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-11, -3); g.quadraticCurveTo(0, 10, 11, -3); g.quadraticCurveTo(0, 4, -11, -3); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fde68a'; g.beginPath(); g.moveTo(-8, -1.5); g.quadraticCurveTo(0, 6, 8, -1.5); g.quadraticCurveTo(0, 3, -8, -1.5); g.fill();
    disc(g, -11, -3, 1.8, '#713f12'); disc(g, 11, -3, 1.8, '#713f12');
    g.restore();
  }
  function drawKart(g, k, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.translate(k.x, k.y);
    g.rotate(k.a);
    const hs = 1 + (k.hop || 0) * 0.14;
    // shadow
    rr(g, -16 + 3, -12 + 4, 34, 24, 8); g.fillStyle = 'rgba(0,0,0,.25)'; g.fill();
    g.scale(hs, hs);
    // wheels
    g.fillStyle = '#1f2937';
    rr(g, -15, -14, 10, 6, 2); g.fill(); rr(g, -15, 8, 10, 6, 2); g.fill();
    const st = clamp(k.steer || 0, -1, 1) * 0.42;
    for (const sy of [-11, 11]) { g.save(); g.translate(10, sy); g.rotate(st); rr(g, -4.5, -2.6, 9, 5.2, 2); g.fill(); g.restore(); }
    // body
    const c = k.color, dark = shade(c, -0.38), light = shade(c, 0.35);
    g.beginPath();
    g.moveTo(18, -5); g.quadraticCurveTo(20, 0, 18, 5);
    g.lineTo(6, 9); g.lineTo(-9, 10.5); g.quadraticCurveTo(-15, 10, -15, 6); g.lineTo(-15, -6); g.quadraticCurveTo(-15, -10, -9, -10.5); g.lineTo(6, -9); g.closePath();
    g.fillStyle = c; g.fill(); g.lineWidth = 1.6; g.strokeStyle = dark; g.stroke();
    // stripe and nose
    g.fillStyle = light; g.beginPath(); g.moveTo(16, -2.5); g.lineTo(16, 2.5); g.lineTo(2, 3.2); g.lineTo(2, -3.2); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; rr(g, 15.5, -4.5, 3.6, 9, 1.6); g.fill();
    // spoiler
    g.fillStyle = dark; rr(g, -19, -11, 5, 22, 2); g.fill();
    // driver
    disc(g, -4, 0, 6.8, dark);
    disc(g, -4, 0, 6.0, '#ffffff');
    g.fillStyle = c; g.fillRect(-10, -1.5, 11.5, 3);
    g.strokeStyle = '#1e293b'; g.lineWidth = 2.6; g.lineCap = 'round'; g.beginPath(); g.arc(-4, 0, 4.6, -0.95, 0.95); g.stroke();
    disc(g, -6.6, -2.6, 1.4, 'rgba(255,255,255,.9)');
    g.restore();
    if (k.shield) {
      g.save(); g.globalAlpha = alpha * 0.9; g.translate(k.x, k.y);
      const gr = g.createRadialGradient(-6, -6, 4, 0, 0, 25);
      gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.7, 'rgba(125,211,252,.25)'); gr.addColorStop(1, 'rgba(56,189,248,.55)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 25, 0, TAU); g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(186,230,253,.95)'; g.stroke();
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // ---------- HUD and overlays (HTML) ----------
  let hudEl, posEl, lapEl, timeEl, miniEl, itemEl, itemCv, msgEl, lightsEl, specEl, touchEl, menuEl, pauseEl, finishEl;
  let msgTimer = null;
  const CSS = `
  .kp-wrap { position:absolute; inset:0; overflow:hidden; background:#7cc957; }
  .kp-wrap canvas.kp-main { position:absolute; left:0; top:0; display:block; -webkit-touch-callout:none; }
  .kp-hud { position:absolute; left:10px; top:10px; display:flex; flex-direction:column; align-items:flex-start; gap:6px; pointer-events:none; color:#fff; }
  .kp-pos { display:flex; align-items:baseline; gap:2px; padding:2px 12px 4px; border-radius:16px; background:rgba(17,17,30,.55); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); font-weight:900; font-style:italic; line-height:1; }
  .kp-pos b { font-size:40px; letter-spacing:-.02em; background:linear-gradient(180deg,#fff7b0,#ffd23f 50%,#ff9500); -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 2px 0 rgba(0,0,0,.35)); }
  .kp-pos.p2 b { background:linear-gradient(180deg,#ffffff,#cbd5e1 55%,#94a3b8); -webkit-background-clip:text; background-clip:text; }
  .kp-pos.p3 b { background:linear-gradient(180deg,#ffe4c7,#fb923c 55%,#c2410c); -webkit-background-clip:text; background-clip:text; }
  .kp-pos.pn b { background:linear-gradient(180deg,#ffffff,#e0e7ff); -webkit-background-clip:text; background-clip:text; }
  .kp-pos sup { font-size:17px; font-weight:800; margin-right:3px; }
  .kp-pos span { font-size:15px; opacity:.8; font-style:normal; font-weight:700; }
  .kp-chip { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:12px; background:rgba(17,17,30,.55); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; }
  .kp-chip .cg-ic { opacity:.9; }
  .kp-mini { border-radius:14px; background:rgba(17,17,30,.4); padding:6px; box-sizing:content-box; backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  .kp-row { display:flex; align-items:center; gap:8px; }
  .kp-item { position:relative; width:58px; height:58px; border-radius:18px; background:rgba(17,17,30,.55); border:2px solid rgba(255,255,255,.55); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); pointer-events:none; display:flex; align-items:center; justify-content:center; }
  .kp-item canvas { width:52px; height:52px; }
  .kp-item.kp-hide { display:flex !important; visibility:hidden; }
  .kp-item.has { border-color:#fde047; box-shadow:0 0 0 3px rgba(253,224,71,.35); }
  .kp-msg { position:absolute; left:0; right:0; top:40%; text-align:center; pointer-events:none; font-weight:900; font-style:italic; font-size:clamp(34px,10vw,64px); color:#fff; letter-spacing:-.01em; text-shadow:0 4px 0 rgba(0,0,0,.25), 0 8px 26px rgba(0,0,0,.35); opacity:0; transform:scale(.6); transition:opacity .2s, transform .25s cubic-bezier(.2,.9,.3,1.4); }
  .kp-msg.show { opacity:1; transform:scale(1); }
  .kp-msg.go { color:#4ade80; } .kp-msg.final { color:#fde047; } .kp-msg.turbo { color:#f9a8d4; font-size:clamp(26px,7vw,44px); } .kp-msg.warn { color:#fca5a5; font-size:clamp(26px,7vw,44px); }
  .kp-msg .cg-ic { width:.8em; height:.8em; vertical-align:-0.08em; }
  .kp-lights { position:absolute; left:50%; top:28%; transform:translateX(-50%); display:flex; gap:10px; padding:10px 14px; border-radius:20px; background:#111827; box-shadow:0 10px 30px rgba(0,0,0,.35); pointer-events:none; transition:opacity .3s; }
  .kp-lights i { width:30px; height:30px; border-radius:50%; background:#374151; box-shadow:inset 0 -3px 0 rgba(0,0,0,.35); }
  .kp-lights i.r { background:radial-gradient(circle at 35% 35%,#fecaca,#ef4444 60%); box-shadow:0 0 16px #ef4444; }
  .kp-lights i.g { background:radial-gradient(circle at 35% 35%,#bbf7d0,#22c55e 60%); box-shadow:0 0 16px #22c55e; }
  .kp-lights.hide { opacity:0; }
  .kp-spec { position:absolute; left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 18px); transform:translateX(-50%); display:flex; align-items:center; gap:8px; padding:9px 16px; border-radius:999px; background:rgba(17,17,30,.7); color:#fff; font-weight:700; font-size:15px; pointer-events:none; white-space:nowrap; z-index:9100; }
  .kp-spec i { width:10px; height:10px; border-radius:50%; }
  .kp-hide { display:none !important; }
  .kp-touch { position:absolute; inset:0; pointer-events:none; }
  .kp-btn { position:absolute; pointer-events:auto; border:0; border-radius:26px; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; font:800 12px Outfit, system-ui, sans-serif; letter-spacing:.03em; text-transform:uppercase; background:rgba(17,17,30,.42); border:2px solid rgba(255,255,255,.55); backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); touch-action:none; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }
  .kp-btn.on { background:rgba(255,255,255,.4); transform:scale(.95); }
  .kp-btn .cg-ic { width:34px; height:34px; }
  .kp-l { left:calc(env(safe-area-inset-left,0px) + 12px); bottom:calc(env(safe-area-inset-bottom,0px) + 16px); width:84px; height:84px; }
  .kp-r { left:calc(env(safe-area-inset-left,0px) + 106px); bottom:calc(env(safe-area-inset-bottom,0px) + 16px); width:84px; height:84px; }
  .kp-d { right:calc(env(safe-area-inset-right,0px) + 12px); bottom:calc(env(safe-area-inset-bottom,0px) + 16px); width:92px; height:84px; background:rgba(168,85,247,.5); }
  .kp-i { right:calc(env(safe-area-inset-right,0px) + 12px); bottom:calc(env(safe-area-inset-bottom,0px) + 112px); width:92px; height:68px; background:rgba(234,179,8,.5); }
  .kp-b { right:calc(env(safe-area-inset-right,0px) + 116px); bottom:calc(env(safe-area-inset-bottom,0px) + 16px); width:64px; height:64px; border-radius:22px; }
  .kp-b .cg-ic { width:26px; height:26px; }
  .kp-p { position:absolute; right:12px; top:10px; bottom:auto; width:46px; height:46px; border-radius:15px; }
  .kp-p .cg-ic { width:20px; height:20px; }
  .kp-multi .kp-p { display:none; }
  .kp-over { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:14px; background:linear-gradient(180deg, rgba(10,12,40,.1), rgba(10,12,40,.5)); overflow:auto; transition:opacity .25s; }
  .kp-over.hide { opacity:0; pointer-events:none; }
  .kp-card { width:100%; max-width:440px; margin:auto; text-align:center; color:#fff; padding:18px 16px 18px; border-radius:26px; background:rgba(14,16,36,.66); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); box-shadow:0 20px 60px rgba(0,0,0,.35); border:1px solid rgba(255,255,255,.16); }
  .kp-logo { font-weight:900; font-style:italic; font-size:clamp(42px, 12vw, 64px); line-height:.9; letter-spacing:-.02em; transform:skewX(-8deg); background:linear-gradient(180deg,#fff6b0 0%,#ffd23f 45%,#ff7a00 100%); -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 4px 0 #b3261e) drop-shadow(0 8px 18px rgba(0,0,0,.4)); }
  .kp-logo span { display:block; background:linear-gradient(180deg,#ffffff 0%,#fbcfe8 45%,#ec4899 100%); -webkit-background-clip:text; background-clip:text; }
  .kp-tag { margin:10px 0 2px; font-size:14px; font-weight:600; opacity:.92; }
  .kp-h { margin:12px 0 6px; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; opacity:.75; }
  .kp-tracks { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  .kp-track { padding:6px 4px 7px; border-radius:16px; border:2px solid rgba(255,255,255,.2); background:rgba(255,255,255,.08); color:#fff; font:700 13px Outfit, system-ui, sans-serif; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:4px; min-height:44px; }
  .kp-track canvas { width:100%; height:auto; aspect-ratio:3/2; border-radius:11px; display:block; }
  .kp-track.on { border-color:#fde047; background:rgba(253,224,71,.16); box-shadow:0 0 0 3px rgba(253,224,71,.25); }
  .kp-seg { display:inline-flex; gap:6px; }
  .kp-seg button { min-width:52px; min-height:44px; border-radius:14px; border:2px solid rgba(255,255,255,.2); background:rgba(255,255,255,.08); color:#fff; font:800 17px Outfit, system-ui, sans-serif; cursor:pointer; }
  .kp-seg button.on { border-color:#fde047; background:rgba(253,224,71,.16); }
  .kp-ctl { display:flex; flex-direction:column; gap:6px; margin:12px auto 0; font-size:13px; text-align:left; max-width:340px; opacity:.95; }
  .kp-ctl div { display:flex; align-items:center; gap:8px; }
  .kp-ctl .k { flex:none; display:flex; gap:3px; min-width:96px; }
  .kp-ctl kbd { display:inline-flex; min-width:24px; height:24px; padding:0 5px; align-items:center; justify-content:center; border-radius:7px; background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.28); border-bottom-width:3px; font:700 12px Outfit, system-ui, sans-serif; }
  .kp-ctl kbd .cg-ic { width:14px; height:14px; }
  .kp-go { display:inline-flex; align-items:center; gap:10px; margin-top:14px; padding:13px 30px; border:0; border-radius:999px; background:linear-gradient(180deg,#ff5a4f,#e8192c); color:#fff; font:800 19px Outfit, system-ui, sans-serif; letter-spacing:.02em; box-shadow:0 6px 0 #9b0f1c, 0 10px 24px rgba(232,25,44,.45); cursor:pointer; animation:kpPulse 1.3s ease-in-out infinite; }
  .kp-go .cg-ic { width:20px; height:20px; }
  .kp-note { margin-top:12px; font-size:12.5px; opacity:.8; display:flex; align-items:center; justify-content:center; gap:6px; }
  @keyframes kpPulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.05); } }
  @media (prefers-reduced-motion: reduce) { .kp-go { animation:none; } }
  .kp-pause .kp-card { max-width:300px; }
  .kp-pause h2 { margin:0 0 6px; font-size:28px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:10px; }
  .kp-finish { position:absolute; left:0; right:0; top:22%; text-align:center; pointer-events:none; color:#fff; transition:opacity .3s; }
  .kp-finish .big { font-weight:900; font-style:italic; font-size:clamp(48px,14vw,84px); line-height:1; transform:skewX(-8deg); background:linear-gradient(180deg,#fff6b0,#ffd23f 45%,#ff7a00); -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 4px 0 #b3261e) drop-shadow(0 8px 18px rgba(0,0,0,.4)); }
  .kp-finish .sub { margin-top:8px; display:inline-flex; align-items:center; gap:8px; padding:8px 16px; border-radius:999px; background:rgba(17,17,30,.62); font-weight:800; font-size:20px; }
  .kp-finish.hide { opacity:0; }
  .kp-pickover { position:fixed; inset:0; z-index:9400; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,.5); animation:cgFade .18s ease-out; }
  .kp-pick { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:12px; }
  .kp-pick button { display:flex; flex-direction:column; align-items:center; gap:6px; padding:6px 4px 8px; border-radius:14px; border:2px solid var(--cg-line); background:transparent; color:var(--cg-ink); font:600 13px Outfit, system-ui, sans-serif; cursor:pointer; min-height:44px; }
  .kp-pick button.on { border-color:#f59e0b; background:rgba(245,158,11,.12); }
  .kp-pick canvas { width:100%; height:auto; border-radius:10px; display:block; }
  @media (max-height: 640px) { .kp-tracks canvas { aspect-ratio:2/1; } .kp-ctl { display:none; } }
  `;

  function ctlHtml() {
    const ic = (n) => CG.icon(n, 14);
    if (isTouch()) {
      return `<div><span class="k"><kbd>${ic('arrowLeft')}</kbd><kbd>${ic('arrowRight')}</kbd></span>Steer with the buttons bottom-left. Your kart speeds up by itself</div>` +
        `<div><span class="k"><kbd>Drift</kbd></span>Hold while turning for a sparkly turbo</div>` +
        `<div><span class="k"><kbd>Item</kbd><kbd>Brake</kbd></span>Use your power-up, or slow down</div>`;
    }
    return `<div><span class="k"><kbd>${ic('arrowUp')}</kbd><kbd>W</kbd></span>Go · <kbd>${ic('arrowDown')}</kbd> <kbd>S</kbd> brake / reverse</div>` +
      `<div><span class="k"><kbd>${ic('arrowLeft')}</kbd><kbd>${ic('arrowRight')}</kbd></span>Steer (or <kbd>A</kbd> <kbd>D</kbd>)</div>` +
      `<div><span class="k"><kbd>Space</kbd><kbd>Shift</kbd></span>Hold while turning to drift, let go for a turbo</div>` +
      `<div><span class="k"><kbd>E</kbd><kbd>Enter</kbd></span>Use item · <kbd>P</kbd> pause</div>`;
  }

  function buildUi() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    hudEl = document.createElement('div'); hudEl.className = 'kp-hud kp-hide';
    hudEl.innerHTML = `<div class="kp-row"><div class="kp-pos"><b>1</b><sup>st</sup><span>/6</span></div><div class="kp-item"><canvas width="104" height="104" aria-hidden="true"></canvas></div></div><div class="kp-chip kp-lap">${CG.icon('flag', 16)}<span>Lap 1/3</span></div><div class="kp-chip kp-time">${CG.icon('timer', 16)}<span>0:00.0</span></div><canvas class="kp-mini" aria-hidden="true"></canvas>`;
    root.appendChild(hudEl);
    posEl = hudEl.querySelector('.kp-pos'); lapEl = hudEl.querySelector('.kp-lap span'); timeEl = hudEl.querySelector('.kp-time span'); miniEl = hudEl.querySelector('.kp-mini');
    itemEl = hudEl.querySelector('.kp-item'); itemCv = itemEl.querySelector('canvas');
    lightsEl = document.createElement('div'); lightsEl.className = 'kp-lights hide'; lightsEl.innerHTML = '<i></i><i></i><i></i>'; root.appendChild(lightsEl);
    msgEl = document.createElement('div'); msgEl.className = 'kp-msg'; msgEl.setAttribute('aria-live', 'polite'); root.appendChild(msgEl);
    finishEl = document.createElement('div'); finishEl.className = 'kp-finish hide'; root.appendChild(finishEl);
    specEl = document.createElement('div'); specEl.className = 'kp-spec kp-hide'; document.body.appendChild(specEl);
    // Touch buttons
    touchEl = document.createElement('div'); touchEl.className = 'kp-touch kp-hide';
    touchEl.innerHTML = `<button type="button" class="kp-btn kp-p" data-k="pause" aria-label="Pause">${CG.icon('pause', 20)}</button><button type="button" class="kp-btn kp-l" data-k="left" aria-label="Steer left">${CG.icon('arrowLeft', 34)}</button>` +
      `<button type="button" class="kp-btn kp-r" data-k="right" aria-label="Steer right">${CG.icon('arrowRight', 34)}</button>` +
      `<button type="button" class="kp-btn kp-b" data-k="brake" aria-label="Brake">${CG.icon('arrowDown', 26)}Brake</button>` +
      `<button type="button" class="kp-btn kp-d" data-k="drift" aria-label="Drift">${CG.icon('sparkles', 30)}Drift</button>` +
      `<button type="button" class="kp-btn kp-i" data-k="item" aria-label="Use item">${CG.icon('gift', 26)}Item</button>`;
    root.appendChild(touchEl);
    touchEl.querySelectorAll('.kp-btn').forEach((b) => {
      const k = b.dataset.k;
      const down = (e) => {
        e.preventDefault(); e.stopPropagation(); usingTouch = true;
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        b.classList.add('on');
        if (k === 'pause') { b.classList.remove('on'); pause(); return; }
        if (k === 'item') itemPressed = true; else touch[k] = true;
        ensureAudio();
      };
      const up = (e) => { if (e) e.preventDefault(); b.classList.remove('on'); if (k !== 'item') touch[k] = false; };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', () => up());
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    // Menu
    menuEl = document.createElement('div'); menuEl.className = 'kp-over';
    menuEl.innerHTML = `<div class="kp-card"><div class="kp-logo">KART<span>PARTY</span></div>` +
      '<p class="kp-tag">Three laps, friendly karts and sparkly drift turbos!</p>' +
      `<div class="kp-h">Pick a track</div><div class="kp-tracks">${TRACKS.map((t, i) => `<button type="button" class="kp-track" data-t="${i}"><canvas width="180" height="120" aria-hidden="true"></canvas>${THEMES[t.theme].name}</button>`).join('')}</div>` +
      `<div class="kp-h">Computer karts</div><div class="kp-seg">${[3, 4, 5].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('')}</div>` +
      `<div class="kp-ctl">${ctlHtml()}</div>` +
      `<button type="button" class="kp-go">${CG.icon('flag', 20)}Start race</button>` +
      `<div class="kp-note">${CG.icon('users', 15)}Race the family live with Play together</div></div>`;
    root.appendChild(menuEl);
    menuEl.querySelectorAll('.kp-track').forEach((b) => b.addEventListener('click', () => { CG.sfx('click'); selectTrack(+b.dataset.t); }));
    menuEl.querySelectorAll('.kp-seg button').forEach((b) => b.addEventListener('click', () => { CG.sfx('click'); menuRivals = +b.dataset.n; syncMenu(); }));
    menuEl.querySelector('.kp-go').addEventListener('click', () => startSolo());
    menuEl.querySelectorAll('.kp-track canvas').forEach((c, i) => drawThumb(c, i));
    pauseEl = document.createElement('div'); pauseEl.className = 'kp-over kp-pause hide';
    pauseEl.innerHTML = `<div class="kp-card"><h2>${CG.icon('pause', 26)}Paused</h2><button type="button" class="kp-go">${CG.icon('play', 20)}${isTouch() ? 'Keep driving' : 'Keep driving'}</button></div>`;
    root.appendChild(pauseEl);
    pauseEl.addEventListener('click', () => resume());
    syncMenu();
  }
  function syncMenu() {
    menuEl.querySelectorAll('.kp-track').forEach((b) => b.classList.toggle('on', +b.dataset.t === menuTrack));
    menuEl.querySelectorAll('.kp-seg button').forEach((b) => b.classList.toggle('on', +b.dataset.n === menuRivals));
  }
  function selectTrack(i) {
    if (i === menuTrack && G && G.ti === i) return;
    menuTrack = i; syncMenu();
    if (state === 'menu') startDemo();
  }
  function drawThumb(c, ti) {
    const g0 = geom(ti), th = g0.theme, g = c.getContext('2d');
    const [bx0, by0, bx1, by1] = g0.bbox, pad = 150;
    const sc = Math.min(c.width / (bx1 - bx0 + pad * 2), c.height / (by1 - by0 + pad * 2));
    g.fillStyle = th.ground; g.fillRect(0, 0, c.width, c.height);
    g.save();
    g.translate(c.width / 2, c.height / 2); g.scale(sc, sc); g.translate(-(bx0 + bx1) / 2, -(by0 + by1) / 2);
    const p = new Path2D(); for (let i = 0; i <= g0.N; i += 3) { const k = i % g0.N; if (!i) p.moveTo(g0.X[k], g0.Y[k]); else p.lineTo(g0.X[k], g0.Y[k]); } p.closePath();
    g.lineJoin = 'round';
    g.strokeStyle = th.wall[0]; g.lineWidth = 2 * (WALL + 8); g.stroke(p);
    g.strokeStyle = th.runoff; g.lineWidth = 2 * WALL; g.stroke(p);
    g.strokeStyle = th.curb[0]; g.lineWidth = 2 * (RW + CURB) + 20; g.stroke(p);
    g.strokeStyle = th.road; g.lineWidth = 2 * RW + 20; g.stroke(p);
    g.save(); g.translate(g0.X[0], g0.Y[0]); g.rotate(g0.ANG[0]); g.fillStyle = '#fff'; g.fillRect(-14, -RW - 10, 28, 2 * RW + 20); g.fillStyle = '#111827'; for (let i = 0; i < 6; i++) g.fillRect(i % 2 ? 0 : -14, -RW - 10 + i * (2 * RW + 20) / 6, 14, (2 * RW + 20) / 6); g.restore();
    g.restore();
  }
  function showMenu() { menuEl.classList.remove('hide'); syncMenu(); }
  function hideMenu() { menuEl.classList.add('hide'); }
  function showPause(on) { pauseEl.classList.toggle('hide', !on); }
  function flash(text, cls) {
    msgEl.className = 'kp-msg' + (cls ? ' ' + cls : '');
    msgEl.textContent = text;
    void msgEl.offsetWidth;
    msgEl.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => msgEl.classList.remove('show'), cls === 'go' ? 700 : 1300);
  }
  function showFinish() {
    const place = myPlace;
    finishEl.innerHTML = `<div class="big">FINISH!</div>` + (place ? `<div class="sub">${CG.icon(place === 1 ? 'crown' : place <= 3 ? 'medal' : 'flag', 22)}${place}${ordinal(place)} place · ${fmtTime(me.fin)}</div>` : `<div class="sub">${CG.icon('timer', 22)}${fmtTime(me.fin)}</div>`);
    finishEl.classList.remove('hide');
  }
  function hideFinish() { finishEl.classList.add('hide'); }

  let hudCache = '';
  function updateHud() {
    const racing = state === 'race' || state === 'done' || state === 'grid' || state === 'mgrid';
    hudEl.classList.toggle('kp-hide', !racing || !me);
    itemEl.classList.toggle('kp-hide', !racing || !me || state === 'done');
    touchEl.classList.toggle('kp-hide', !(racing && me && isTouch() && state !== 'done'));
    touchEl.classList.toggle('kp-multi', multi);
    const lightsVisible = state === 'grid' || state === 'mgrid' || (state === 'race' && raceT < 0.8);
    lightsEl.classList.toggle('hide', !lightsVisible);
    if (lightsVisible) {
      const n = state === 'grid' ? lightsOn(gridT) : state === 'mgrid' ? mLights() : 4;
      lightsEl.querySelectorAll('i').forEach((el, i) => { el.className = n >= 4 ? 'g' : i < n ? 'r' : ''; });
    }
    // Spectating?
    const f = focusKart();
    const watching = multi && f && f !== me && state === 'done';
    specEl.classList.toggle('kp-hide', !watching);
    if (watching) {
      const html = `${CG.icon('eye', 18)}<i style="background:${f.color}"></i>Watching ${esc(f.name)}`;
      if (specEl.innerHTML !== html) specEl.innerHTML = html;
    }
    if (!racing || !me) return;
    const st = standings();
    const pos = Math.max(1, st.indexOf(me) + 1), n = st.length;
    const lap = clamp(me.lap + 1, 1, LAPS);
    const t = state === 'race' || state === 'done' ? (me.fin != null ? me.fin : raceT) : 0;
    const key = `${pos}|${n}|${lap}|${Math.floor(t * 10)}`;
    if (key !== hudCache) {
      hudCache = key;
      posEl.className = 'kp-pos ' + (pos === 1 ? '' : pos === 2 ? 'p2' : pos === 3 ? 'p3' : 'pn');
      posEl.innerHTML = `<b>${pos}</b><sup>${ordinal(pos)}</sup><span>/${n}</span>`;
      lapEl.textContent = `Lap ${lap}/${LAPS}`;
      timeEl.textContent = fmtTime(t);
    }
    // Wrong way warning
    if (wrongT > 1.2 && !msgEl.classList.contains('show')) { msgEl.className = 'kp-msg warn show'; msgEl.innerHTML = `${CG.icon('undo', 40)} Wrong way!`; clearTimeout(msgTimer); msgTimer = setTimeout(() => msgEl.classList.remove('show'), 900); }
    drawItem();
    drawMini();
  }
  function mLights() {
    if (!multiInfo || !multiInfo.t0) return 0;
    const left = (multiInfo.t0 - Date.now()) / 1000;
    return left > 3 ? 0 : left > 2 ? 1 : left > 1 ? 2 : left > 0 ? 3 : 4;
  }
  let itemKey = null;
  function drawItem() {
    const rolling = me.rollT > 0;
    const it = rolling ? ['mushroom', 'shield', 'banana'][Math.floor(performance.now() / 90) % 3] : me.item;
    const key = (it || '') + (rolling ? 'r' : '');
    itemEl.classList.toggle('has', !!me.item && !rolling);
    if (key === itemKey) return;
    itemKey = key;
    const g = itemCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 104, 104);
    if (!it) {
      g.setTransform(2, 0, 0, 2, 52, 52);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.setLineDash([4, 4]); rr(g, -15, -15, 30, 30, 8); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,.45)'; g.font = `800 17px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 0, 1);
      return;
    }
    g.setTransform(2, 0, 0, 2, 52, 52);
    g.globalAlpha = rolling ? 0.75 : 1;
    drawItemArt(g, it);
    g.globalAlpha = 1;
  }
  function drawItemArt(g, it) {
    if (it === 'mushroom') {
      g.fillStyle = '#fef3c7'; rr(g, -8, 0, 16, 15, 5); g.fill(); g.strokeStyle = '#92400e'; g.lineWidth = 1.2; g.stroke();
      disc(g, -3, 6, 1.5, '#1f2937'); disc(g, 3, 6, 1.5, '#1f2937');
      g.fillStyle = '#ef4444'; g.beginPath(); g.moveTo(-17, 3); g.quadraticCurveTo(-17, -17, 0, -17); g.quadraticCurveTo(17, -17, 17, 3); g.closePath(); g.fill(); g.strokeStyle = '#991b1b'; g.stroke();
      disc(g, -8, -8, 4, '#fff'); disc(g, 6, -10, 3.4, '#fff'); disc(g, 11, -1, 2.4, '#fff'); disc(g, -13, -1, 2.2, '#fff');
    } else if (it === 'shield') {
      const gr = g.createRadialGradient(-6, -6, 2, 0, 0, 18);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#7dd3fc'); gr.addColorStop(1, '#0284c7');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 17, 0, TAU); g.fill();
      g.strokeStyle = '#e0f2fe'; g.lineWidth = 2; g.stroke();
      disc(g, -6, -7, 3.5, 'rgba(255,255,255,.9)');
    } else if (it === 'banana') {
      drawBanana(g, 0, 0, -0.3, 1.45);
    }
  }

  // ---------- Game flow ----------
  function startDemo() {
    setupSolo(menuTrack, 5, true);
    state = 'menu'; raceT = 0; cam.init = false;
    karts.forEach((k) => { k.skill = 0.9 + Math.random() * 0.06; });
  }
  function startSolo() {
    if (CG.isMulti()) return;
    CG.closeModal();
    ensureAudio();
    CG.sfx('click');
    setupSolo(menuTrack, menuRivals, false);
    state = 'grid'; gridT = 0; paused = false; cam.init = false;
    hideMenu(); showPause(false); hideFinish();
    prefetchAround();
  }
  function toMenu() {
    multi = false; multiInfo = null; preRound = 0; paused = false;
    hideFinish(); showPause(false);
    startDemo();
    showMenu();
  }
  function pause() {
    if (state === 'menu' || multi || paused || state === 'done') return;
    paused = true; showPause(true);
    for (const k in keys) keys[k] = false;
    for (const k in touch) touch[k] = false;
  }
  function resume() { if (!paused) return; paused = false; showPause(false); last = 0; ensureAudio(); }

  // ---------- Engine hum (own tiny audio, follows the mute button) ----------
  let ac = null, eng = null;
  function ensureAudio() {
    try {
      if (!ac) {
        const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
        ac = new C();
        const o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), gn = ac.createGain();
        o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 520; gn.gain.value = 0;
        o.connect(f); o2.connect(f); f.connect(gn).connect(ac.destination); o.start(); o2.start();
        eng = { o, o2, f, gn };
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { /* no sound */ }
  }
  function engineSound() {
    if (!eng || !ac || ac.state !== 'running') return;
    const on = me && (state === 'race' || state === 'grid' || state === 'mgrid' || (state === 'done' && finishT < 3)) && !paused && !CG.muted() && document.visibilityState === 'visible';
    const sp = me ? clamp(Math.hypot(me.vx, me.vy) / VMAX, 0, 1.4) : 0;
    const t = ac.currentTime;
    eng.gn.gain.setTargetAtTime(on ? 0.022 + sp * 0.018 : 0, t, 0.08);
    const fr = 48 + sp * 88 + (me && me.boostT > 0 ? 18 : 0);
    eng.o.frequency.setTargetAtTime(fr, t, 0.06); eng.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.06);
    eng.f.frequency.setTargetAtTime(380 + sp * 700, t, 0.1);
  }

  // ---------- Input handlers ----------
  function onKey(e, down) {
    const k = e.key;
    const map = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ' ': 'drift', Shift: 'drift' };
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (document.querySelector('.kp-pickover')) return;
    if (CG.modalOpen()) { if (!down && map[k]) keys[map[k]] = false; return; }
    if (map[k]) {
      if (state !== 'menu') e.preventDefault();
      keys[map[k]] = down;
      if (down && !e.repeat) usingTouch = false;
    }
    if (!down) return;
    if (state === 'menu' && !CG.isMulti()) {
      if (k === 'Enter' || k === ' ') { e.preventDefault(); startSolo(); return; }
      if (k === 'ArrowLeft' || k === 'ArrowRight') { selectTrack((menuTrack + (k === 'ArrowLeft' ? 2 : 1)) % 3); return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') { menuRivals = clamp(menuRivals + (k === 'ArrowUp' ? 1 : -1), 3, 5); syncMenu(); return; }
    }
    if (paused && (k === ' ' || k === 'Enter' || k === 'p' || k === 'P' || k === 'Escape')) { e.preventDefault(); resume(); return; }
    if ((k === 'e' || k === 'E' || k === 'Enter') && !e.repeat) { itemPressed = true; e.preventDefault(); }
    if ((k === 'p' || k === 'P' || k === 'Escape') && (state === 'race' || state === 'grid') && !multi) pause();
  }

  // ---------- Size ----------
  let lastW = 0, lastH = 0;
  function resize() {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const nd = Math.min(2, window.devicePixelRatio || 1);
    if (w === lastW && h === lastH && nd === dpr && cvs.width) return;
    lastW = w; lastH = h; Wl = w; Hl = h; dpr = nd;
    cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr);
    cvs.style.width = w + 'px'; cvs.style.height = h + 'px';
    Z = clamp(Math.min(w, h) / 430, 0.84, 1.3);
    const ts = Math.min(2.4, Z * dpr);
    if (Math.abs(ts - tileScale) > 0.01) {
      tileScale = ts;
      clearTiles(); tilePool.length = 0;
    }
    const tilePx = (TILE + 2) * tileScale, bytes = tilePx * tilePx * 4;
    const need = Math.ceil((Math.hypot(w, h) / Z) / TILE + 3) ** 2;
    tileCap = Math.max(need + 8, Math.floor((isTouch() ? 70e6 : 140e6) / bytes));
    if (miniEl && G) buildMini();
  }

  // ---------- Main loop ----------
  let last = 0, acc = 0;
  const perf = { n: 0, sum: 0, max: 0 };
  function frame(now) {
    requestAnimationFrame(frame);
    const pt0 = performance.now();
    let dt = last ? (now - last) / 1000 : 0;
    last = now;
    dt = Math.min(dt, 0.1);
    pollPreGrid();
    if (multi && multiInfo && multiInfo.t0 && (state === 'race' || state === 'done')) {
      // Keep the race clock on the shared start time (so finish times compare fairly).
      const target = (Date.now() - multiInfo.t0) / 1000;
      if (Math.abs(target - raceT) > 0.25) raceT = target;
    }
    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 14) { step(STEP); acc -= STEP; n++; }
      if (n >= 14) acc = 0;
      stepParticles(dt);
    }
    if (multi) {
      updateRemotes(dt);
      if ((state === 'race' || state === 'done') && !finalSent) sendState();
    }
    finishFlow();
    if (!multi && (state === 'race' || state === 'grid') && !paused && (CG.modalOpen() || document.querySelector('.kp-pickover'))) pause();
    if (!multi && state === 'done' && finalSent && !CG.modalOpen() && !CG.isMulti()) toMenu();
    render(dt);
    updateHud();
    engineSound();
    const pd = performance.now() - pt0;
    perf.n++; perf.sum += pd; if (pd > perf.max) perf.max = pd;
  }

  // The host picks the track for everyone. This is our own layer above the frame's cards (the results card
  // re-renders while it is open, which would close a ChowGames.modal).
  function pickTrack() {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'kp-pickover';
      back.innerHTML = `<div class="cg-card" role="dialog" aria-modal="true"><div class="cg-hero plain">${CG.badge('kart', 52)}</div><h2>Pick a track</h2><p class="cg-sub">Everyone races on the same circuit</p>` +
        `<div class="kp-pick">${TRACKS.map((t, i) => `<button type="button" data-t="${i}" class="${i === menuTrack ? 'on' : ''}"><canvas width="180" height="120" aria-hidden="true"></canvas>${THEMES[t.theme].name}</button>`).join('')}</div>` +
        `<div class="cg-row"><button type="button" data-x="1">Cancel</button><button type="button" class="primary" data-go="1">${CG.icon('flag', 18)} Start the race</button></div></div>`;
      document.body.appendChild(back);
      back.querySelectorAll('canvas').forEach((cv, i) => drawThumb(cv, i));
      let pick = menuTrack;
      const finish = (v) => { back.remove(); document.removeEventListener('keydown', onEsc, true); resolve(v); };
      const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
      document.addEventListener('keydown', onEsc, true);
      back.addEventListener('click', (e) => {
        if (e.target === back || e.target.closest('[data-x]')) { finish(null); return; }
        const t = e.target.closest('button[data-t]');
        if (t) { pick = +t.dataset.t; CG.sfx('click'); back.querySelectorAll('.kp-pick button').forEach((b) => b.classList.toggle('on', b === t)); return; }
        if (e.target.closest('[data-go]')) { menuTrack = pick; syncMenu(); finish({ track: pick }); }
      });
      setTimeout(() => { const b = back.querySelector('[data-go]'); if (b) b.focus(); }, 30);
    });
  }

  // ---------- Boot ----------
  CG.mount({
    id: 'kart', title: 'Kart Party', mode: 'race', scoreLabel: 'points', syncMs: 300,
    help: '<ul><li>Race <b>3 laps</b>. 1st place earns 1000 points, 2nd 700, 3rd 500…, plus a bonus for a fast time.</li>' +
      '<li><b>Phone</b>: steer with the arrow buttons. Your kart drives by itself; tap <b>Brake</b> to slow down.</li>' +
      '<li><b>Keyboard</b>: arrows or W A S D. E or Enter uses your item, P pauses.</li>' +
      '<li><b>Drift</b> (Space, Shift or the Drift button): hold it while turning. Sparks go blue, orange, then pink. Let go for a turbo!</li>' +
      '<li>Rainbow <b>item boxes</b> give a mushroom (speed boost), a shield bubble, or a banana that makes karts spin.</li>' +
      '<li>Orange pads boost you. Grass and snow slow you down.</li>' +
      '<li><b>Play together</b>: everyone races live on the same track.</li></ul>',
    onReady(c) {
      root = document.createElement('div');
      root.className = 'kp-wrap';
      c.root.appendChild(root);
      cvs = document.createElement('canvas');
      cvs.className = 'kp-main';
      cvs.setAttribute('aria-label', 'Kart Party race track');
      root.appendChild(cvs);
      ctx = cvs.getContext('2d', { alpha: false });
      buildUi();
      resize();
      if (window.ResizeObserver) new ResizeObserver(resize).observe(root);
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 200));
      window.addEventListener('keydown', (e) => onKey(e, true));
      window.addEventListener('keyup', (e) => onKey(e, false));
      window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false; });
      root.addEventListener('contextmenu', (e) => e.preventDefault());
      root.addEventListener('pointerdown', () => ensureAudio());
      startDemo();
      buildMini();
      requestAnimationFrame(frame);
      window.__kart = {
        get state() { return state; }, get raceT() { return raceT; }, get me() { return me; }, get karts() { return karts; }, get remotes() { return remotes; },
        get hazards() { return hazards; }, get track() { return G && G.ti; }, get L() { return G && G.L; }, get multi() { return multi; }, get place() { return myPlace; },
        set autopilot(v) { autopilot = v === 2 ? 2 : !!v; }, get autopilot() { return autopilot; }, standings: () => standings().map((r) => ({ name: r.name, fin: r.fin, prog: Math.round(r.prog), lap: r.lap })),
        get tiles() { return tiles.size; }, perf() { const r = { avg: +(perf.sum / Math.max(1, perf.n)).toFixed(2), max: +perf.max.toFixed(1), n: perf.n }; perf.n = 0; perf.sum = 0; perf.max = 0; return r; }, give(it) { if (me) me.item = it; }, get pads() { return W && W.pads.map((p) => p.s / G.L); },
        tp(frac, d) { if (!me) return; pointAt(G, frac * G.L, d || 0, tmpP); me.x = tmpP.x; me.y = tmpP.y; me.a = tmpP.a; me.vx = Math.cos(me.a) * 250; me.vy = Math.sin(me.a) * 250; me.idx = nearestGlobal(G, me.x, me.y); cam.init = false; }, startSolo, selectTrack, setRivals(n) { menuRivals = n; syncMenu(); }
      };
    },
    roundSetup() { return pickTrack(); }
  });
  CG.on('pause', () => { pause(); if (ac && ac.state === 'running') try { ac.suspend(); } catch (e) { /* ignore */ } });
  CG.on('resume', () => { if (ac && ac.state === 'suspended') try { ac.resume(); } catch (e) { /* ignore */ } last = 0; });
  CG.on('multiStart', (info) => onMultiStart(info));
  CG.on('multiEnd', () => toMenu());
})();
