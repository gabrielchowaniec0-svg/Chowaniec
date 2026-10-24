// Race Home: a Ludo-style race for 2-4 players. Play with the family through ChowGames turns, or on one
// device (pass and play), with computer players only when someone picks them. Rules and the computer
// player live in rules.js (window.RaceHomeRules).
(function () {
  'use strict';

  const G = window.ChowGames;
  const R = window.RaceHomeRules;
  const COL = [
    { name: 'Red', main: '#ef4444', light: '#fca5a5', dark: '#b91c1c', soft: '#fee2e2', deep: '#991b1b' },
    { name: 'Green', main: '#22c55e', light: '#86efac', dark: '#15803d', soft: '#dcfce7', deep: '#166534' },
    { name: 'Yellow', main: '#facc15', light: '#fef08a', dark: '#ca8a04', soft: '#fef9c3', deep: '#a16207' },
    { name: 'Blue', main: '#3b82f6', light: '#93c5fd', dark: '#1d4ed8', soft: '#dbeafe', deep: '#1e40af' }
  ];
  const BOT_NAMES = ['Robot Pip', 'Robot Dot', 'Robot Zed'];
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Settings ----------
  const cfg = { people: 2, bots: 0, fill: false };
  try { const s = JSON.parse(localStorage.getItem('chow_ludo_cfg') || '{}'); if (s.people >= 1 && s.people <= 4) cfg.people = s.people; cfg.bots = 0; cfg.fill = false; } catch (e) { /* ignore */ }
  const saveCfg = () => { try { localStorage.setItem('chow_ludo_cfg', JSON.stringify({ people: cfg.people })); } catch (e) { /* ignore */ } };

  // ---------- State ----------
  let root, canvas, cx, boxEl, topEl, msgEl, dieEl, menuEl, barEl;
  let W = 0, H = 0, dpr = 1, cell = 20, bx = 0, by = 0, rot = 0, layer = null;
  let mode = 'menu';                  // menu | local | multi
  let S = R.newGame(['Red', 'Yellow'], 1);
  let disp = S.tokens.map((t) => t.slice());   // where tokens are drawn (lags S while animating)
  let hop = null;                     // the token animation playing now
  let steps = [];                     // queued animations: { kind: 'die'|'move', ... }
  let playing = false;
  let dieShown = { v: 0, pl: 0 }, dieRolling = false;
  let particles = [];
  let busy = false;
  let multi = null;                   // { gid, myIdx }
  let present = null;                 // names still in the session
  let note = '', noteAt = 0;
  let focusIdx = -1, hoverTok = null;
  let overFor = null;
  let actTimer = null;

  const colorOf = (pl) => COL[S.colors[pl]];
  const nameOf = (pl) => (mode === 'multi' && multi && pl === multi.myIdx ? 'You' : S.players[pl]);

  // ---------- Who controls whom ----------
  function controls(pl) {
    if (pl == null || pl < 0 || S.winner != null || S.out[pl]) return false;
    if (mode === 'local') return !S.bots[pl];
    if (mode === 'multi') return !!multi && pl === multi.myIdx && !S.bots[pl];
    return false;
  }
  // The device that plays the computers and skips people who left: the first person still here.
  function isDriver() {
    if (mode === 'local') return true;
    if (mode !== 'multi' || !multi) return false;
    for (let i = 0; i < S.players.length; i++) {
      if (S.bots[i] || S.out[i]) continue;
      if (present && !present.includes(S.players[i])) continue;
      return i === multi.myIdx;
    }
    return false;
  }
  const settledNow = () => !playing && !steps.length && !hop && !dieRolling;
  const canRoll = () => mode !== 'menu' && S.winner == null && S.phase === 'roll' && controls(S.turn) && settledNow() && !busy && !G.modalOpen() && !G.countingDown();
  const canMove = () => mode !== 'menu' && S.winner == null && S.phase === 'move' && controls(S.turn) && settledNow() && !busy && !G.modalOpen();
  const movable = () => (S.phase === 'move' && S.die ? R.legalMoves(S, S.turn, S.die) : []);

  // ---------- Layout ----------
  function layout() {
    const r = boxEl.getBoundingClientRect();
    W = Math.max(1, Math.floor(r.width)); H = Math.max(1, Math.floor(r.height));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    cell = Math.max(10, Math.floor((Math.min(W, H) - 8) / 15));
    bx = Math.round((W - cell * 15) / 2); by = Math.round((H - cell * 15) / 2);
    buildLayer();
  }
  // grid units (0..15) -> screen pixels, turned so my colour sits at the bottom left
  function gp(x, y) {
    for (let k = 0; k < rot; k++) { const nx = 15 - y; y = x; x = nx; }
    return [bx + x * cell, by + y * cell];
  }
  function gridAt(px, py) {
    let x = (px - bx) / cell, y = (py - by) / cell;
    for (let k = 0; k < rot; k++) { const nx = y; y = 15 - x; x = nx; }
    return [x, y];
  }
  function setRotation() {
    let my = -1;
    if (mode === 'multi' && multi && multi.myIdx >= 0) my = S.colors[multi.myIdx];
    rot = my >= 0 ? (3 - my + 4) % 4 : 0;
  }

  function rr(g, x, y, w, h, rad) {
    g.beginPath();
    g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath();
  }
  function starPath(g, x, y, R1, R2) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? R2 : R1; const px = x + rr2 * Math.cos(a), py = y + rr2 * Math.sin(a); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
    g.closePath();
  }

  // The board, drawn once per size in board coordinates (unrotated); it's rotated when copied.
  function buildLayer() {
    const size = cell * 15, m = 24;
    const c = document.createElement('canvas');
    c.width = Math.ceil((size + m * 2) * dpr); c.height = Math.ceil((size + m * 2) * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(m, m);
    const u = cell;
    g.save(); g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 20; g.shadowOffsetY = 8;
    rr(g, -6, -6, size + 12, size + 12, u * 0.7); g.fillStyle = '#fffaf0'; g.fill(); g.restore();
    rr(g, -6, -6, size + 12, size + 12, u * 0.7); g.lineWidth = 3; g.strokeStyle = '#e7dcc8'; g.stroke();
    // yards
    R.YARD_ORIGIN.forEach(([ox, oy], k) => {
      const C = COL[k];
      const yg = g.createLinearGradient(ox * u, oy * u, (ox + 6) * u, (oy + 6) * u);
      yg.addColorStop(0, C.light); yg.addColorStop(0.5, C.main); yg.addColorStop(1, C.dark);
      rr(g, ox * u + 2, oy * u + 2, 6 * u - 4, 6 * u - 4, u * 0.6); g.fillStyle = yg; g.fill();
      // soft gloss
      g.save(); rr(g, ox * u + 2, oy * u + 2, 6 * u - 4, 6 * u - 4, u * 0.6); g.clip();
      g.beginPath(); g.ellipse((ox + 1.5) * u, (oy + 0.2) * u, u * 4, u * 2, -0.4, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.22)'; g.fill(); g.restore();
      rr(g, (ox + 0.85) * u, (oy + 0.85) * u, 4.3 * u, 4.3 * u, u * 0.55); g.fillStyle = '#fffdf7'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.08)'; g.stroke();
      for (let t = 0; t < 4; t++) {
        const [x, y] = R.tokenCell(k, -1, t);
        g.beginPath(); g.arc(x * u, y * u, u * 0.62, 0, Math.PI * 2); g.fillStyle = C.soft; g.fill();
        g.lineWidth = Math.max(2, u * 0.08); g.strokeStyle = C.main; g.stroke();
        g.beginPath(); g.arc(x * u, y * u + u * 0.06, u * 0.42, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.06)'; g.fill();
      }
    });
    // track cells
    const cellBox = (x, y, fill, stroke) => { rr(g, x * u + 1.5, y * u + 1.5, u - 3, u - 3, u * 0.18); g.fillStyle = fill; g.fill(); if (stroke) { g.lineWidth = 1.2; g.strokeStyle = stroke; g.stroke(); } };
    R.TRACK.forEach(([x, y], i) => {
      const startOf = R.START.indexOf(i);
      if (startOf >= 0) {
        cellBox(x, y, COL[startOf].main, null);
        // arrow pointing along the track
        const [nx, ny] = R.TRACK[(i + 1) % R.TRACK_LEN];
        const ang = Math.atan2(ny - y, nx - x);
        g.save(); g.translate((x + 0.5) * u, (y + 0.5) * u); g.rotate(ang);
        g.beginPath(); g.moveTo(u * 0.28, 0); g.lineTo(-u * 0.12, -u * 0.24); g.lineTo(-u * 0.12, u * 0.24); g.closePath(); g.fillStyle = 'rgba(255,255,255,.9)'; g.fill(); g.restore();
      } else {
        cellBox(x, y, '#ffffff', '#e2d8c6');
        if (R.SAFE.has(i)) {
          starPath(g, (x + 0.5) * u, (y + 0.5) * u, u * 0.36, u * 0.16);
          g.fillStyle = '#fde68a'; g.fill(); g.lineWidth = Math.max(1.2, u * 0.05); g.lineJoin = 'round'; g.strokeStyle = '#d97706'; g.stroke();
        }
      }
    });
    // home columns
    R.HOME_COL.forEach((cells, k) => cells.forEach(([x, y], j) => {
      cellBox(x, y, COL[k].main, null);
      g.save(); rr(g, x * u + 1.5, y * u + 1.5, u - 3, u - 3, u * 0.18); g.fillStyle = `rgba(255,255,255,${0.08 + j * 0.05})`; g.fill(); g.restore();
    }));
    // centre: four triangles meeting at home
    const cxm = 7.5 * u, cym = 7.5 * u;
    const tri = [[[6, 6], [6, 9]], [[6, 6], [9, 6]], [[9, 6], [9, 9]], [[6, 9], [9, 9]]];
    tri.forEach(([[ax, ay], [bx2, by2]], k) => {
      g.beginPath(); g.moveTo(ax * u, ay * u); g.lineTo(bx2 * u, by2 * u); g.lineTo(cxm, cym); g.closePath();
      const tg = g.createLinearGradient(ax * u, ay * u, cxm, cym);
      tg.addColorStop(0, COL[k].main); tg.addColorStop(1, COL[k].dark);
      g.fillStyle = tg; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.6)'; g.stroke();
    });
    layer = { c, m };
  }

  // ---------- Drawing ----------
  // a little house in the middle (drawn upright, whichever way the board is turned)
  function drawHouse(g) {
    const u = cell;
    g.save(); g.translate(bx + 7.5 * u, by + 7.5 * u);
    g.beginPath(); g.arc(0, 0, u * 0.62, 0, Math.PI * 2); g.fillStyle = '#fffdf7'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.1)'; g.stroke();
    const hs = u * 0.32;
    g.beginPath(); g.moveTo(-hs, -hs * 0.05); g.lineTo(0, -hs * 0.95); g.lineTo(hs, -hs * 0.05); g.lineTo(hs * 0.72, -hs * 0.05); g.lineTo(hs * 0.72, hs * 0.8); g.lineTo(-hs * 0.72, hs * 0.8); g.lineTo(-hs * 0.72, -hs * 0.05); g.closePath();
    g.fillStyle = '#f59e0b'; g.fill();
    g.fillStyle = '#fffdf7'; g.fillRect(-hs * 0.18, hs * 0.3, hs * 0.36, hs * 0.5);
    g.restore();
  }

  function drawToken(g, x, y, r, color, o) {
    o = o || {};
    const C = COL[color];
    const lift = o.lift || 0;
    g.save();
    if (o.alpha != null) g.globalAlpha = o.alpha;
    // shadow
    g.beginPath(); g.ellipse(x, y + r * 0.55, r * (0.85 - lift * 0.2), r * (0.32 - lift * 0.08), 0, 0, Math.PI * 2);
    g.fillStyle = `rgba(0,0,0,${0.28 - lift * 0.12})`; g.fill();
    y -= lift * r * 1.1;
    // base
    g.beginPath(); g.ellipse(x, y + r * 0.42, r * 0.86, r * 0.38, 0, 0, Math.PI * 2); g.fillStyle = C.deep; g.fill();
    const bg = g.createLinearGradient(x - r, 0, x + r, 0);
    bg.addColorStop(0, C.dark); bg.addColorStop(0.4, C.main); bg.addColorStop(1, C.deep);
    g.beginPath(); g.ellipse(x, y + r * 0.3, r * 0.86, r * 0.36, 0, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
    // body (a rounded cone)
    g.beginPath();
    g.moveTo(x - r * 0.62, y + r * 0.32);
    g.quadraticCurveTo(x - r * 0.42, y - r * 0.15, x - r * 0.28, y - r * 0.38);
    g.lineTo(x + r * 0.28, y - r * 0.38);
    g.quadraticCurveTo(x + r * 0.42, y - r * 0.15, x + r * 0.62, y + r * 0.32);
    g.closePath(); g.fillStyle = bg; g.fill();
    // head
    const hg = g.createRadialGradient(x - r * 0.18, y - r * 0.78, r * 0.05, x, y - r * 0.6, r * 0.5);
    hg.addColorStop(0, '#fff'); hg.addColorStop(0.35, C.light); hg.addColorStop(0.75, C.main); hg.addColorStop(1, C.dark);
    g.beginPath(); g.arc(x, y - r * 0.6, r * 0.44, 0, Math.PI * 2); g.fillStyle = hg; g.fill();
    g.lineWidth = Math.max(1, r * 0.07); g.strokeStyle = 'rgba(255,255,255,.75)';
    g.beginPath(); g.ellipse(x, y + r * 0.3, r * 0.6, r * 0.22, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.restore();
  }

  function draw(t) {
    const g = cx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!layer) return;
    // board (rotated around its centre)
    g.save();
    g.translate(bx + cell * 7.5, by + cell * 7.5);
    g.rotate(rot * Math.PI / 2);
    g.drawImage(layer.c, -cell * 7.5 - layer.m, -cell * 7.5 - layer.m, layer.c.width / dpr, layer.c.height / dpr);
    g.restore();
    drawHouse(g);
    const pulse = 0.5 + 0.5 * Math.sin(t / 190);
    // colours nobody is playing (or whose player left) fade back
    for (let k = 0; k < 4; k++) {
      const pl = S.colors.indexOf(k);
      if (mode !== 'menu' && pl >= 0 && !S.out[pl]) continue;
      if (mode === 'menu') continue;
      const [ox, oy] = R.YARD_ORIGIN[k];
      const [x0, y0] = gp(ox, oy), [x1, y1] = gp(ox + 6, oy + 6);
      g.save(); rr(g, Math.min(x0, x1) + 2, Math.min(y0, y1) + 2, Math.abs(x1 - x0) - 4, Math.abs(y1 - y0) - 4, cell * 0.6);
      g.fillStyle = 'rgba(255,250,240,.62)'; g.fill(); g.restore();
    }
    // whose turn: glow their yard
    if (mode !== 'menu' && S.winner == null) {
      const [ox, oy] = R.YARD_ORIGIN[S.colors[S.turn]];
      const [x0, y0] = gp(ox, oy), [x1, y1] = gp(ox + 6, oy + 6);
      g.save(); g.lineWidth = 4 + pulse * 3; g.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.4})`; g.shadowColor = colorOf(S.turn).main; g.shadowBlur = 16;
      rr(g, Math.min(x0, x1) + 3, Math.min(y0, y1) + 3, Math.abs(x1 - x0) - 6, Math.abs(y1 - y0) - 6, cell * 0.6); g.stroke(); g.restore();
    }
    const r = cell * 0.42;
    const mv = canMove() ? movable() : [];
    // destinations of movable tokens
    for (const m of mv) {
      const isFocus = (hoverTok && hoverTok.t === m.t) || (focusIdx >= 0 && mv[focusIdx] && mv[focusIdx].t === m.t);
      const [gx, gy] = R.tokenCell(S.colors[S.turn], m.to, m.t);
      const [x, y] = gp(gx, gy);
      g.save(); g.setLineDash([cell * 0.12, cell * 0.09]); g.lineWidth = Math.max(2, cell * (isFocus ? 0.1 : 0.06));
      g.strokeStyle = colorOf(S.turn).dark; g.globalAlpha = isFocus ? 1 : 0.55 + 0.3 * pulse;
      g.beginPath(); g.arc(x, y, cell * 0.36, 0, Math.PI * 2); g.stroke(); g.restore();
    }
    // tokens, grouped by where they stand so stacks fan out a little
    const items = [];
    const groups = new Map();
    S.players.forEach((_, pl) => {
      if (S.out[pl]) return;
      const color = S.colors[pl];
      disp[pl].forEach((p, tk) => {
        if (hop && hop.pl === pl && hop.t === tk) return;
        if (hop && hop.caps.some(([q, qt]) => q === pl && qt === tk) && hop.capT0 != null) return;
        const [gx, gy] = R.tokenCell(color, p, tk);
        const key = p === R.HOME ? `h${color}` : `${Math.round(gx * 2)},${Math.round(gy * 2)}`;
        const item = { pl, tk, color, p, gx, gy, key };
        items.push(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      });
    });
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const home = list[0].p === R.HOME;
      list.forEach((it, k) => {
        const a = (k / list.length) * Math.PI * 2 - Math.PI / 4;
        const d = home ? 0.32 : 0.2;
        it.gx += Math.cos(a) * d; it.gy += Math.sin(a) * d; it.small = true;
      });
    }
    items.sort((a, b) => gp(a.gx, a.gy)[1] - gp(b.gx, b.gy)[1]);
    for (const it of items) {
      const [x, y] = gp(it.gx, it.gy);
      const canGo = mv.some((m) => m.t === it.tk) && it.pl === S.turn;
      const rr2 = it.small ? r * 0.78 : r;
      const isFocus = canGo && ((hoverTok && hoverTok.t === it.tk) || (focusIdx >= 0 && mv[focusIdx] && mv[focusIdx].t === it.tk));
      if (canGo) {
        g.save(); g.lineWidth = Math.max(2.5, cell * 0.09); g.strokeStyle = '#fff'; g.shadowColor = colorOf(it.pl).main; g.shadowBlur = cell * (0.35 + pulse * 0.35);
        g.beginPath(); g.arc(x, y, rr2 * (1.05 + pulse * 0.12 + (isFocus ? 0.12 : 0)), 0, Math.PI * 2); g.stroke(); g.restore();
      }
      drawToken(g, x, y, rr2, it.color, { lift: canGo ? 0.12 + 0.18 * Math.abs(Math.sin(t / 260 + it.tk)) : 0 });
    }
    // the hopping token and anything being sent home
    if (hop) drawHop(g, t, r);
    for (const p of particles) {
      g.save(); g.globalAlpha = Math.max(0, Math.min(1, p.life)); g.translate(p.x, p.y); g.rotate(p.a || 0); g.fillStyle = p.col;
      if (p.kind === 'spark') { starPath(g, 0, 0, p.s, p.s * 0.45); g.fill(); } else g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
  }

  // ---------- Animations ----------
  const HOP_MS = 165, YARD_MS = 380, HOME_FLY_MS = 560;
  function drawHop(g, t, r) {
    const el = Math.max(0, t - hop.start);
    const n = hop.path.length - 1;
    const color = S.colors[hop.pl] != null ? S.colors[hop.pl] : 0;
    let x, y, lift = 0;
    if (el < hop.moveMs) {
      const segMs = hop.from === -1 ? YARD_MS : HOP_MS;
      const k = Math.max(0, Math.min(n - 1, Math.floor(el / segMs)));
      const f = Math.min(1, (el - k * segMs) / segMs);
      const [ax, ay] = gp(...hop.path[k]), [bx2, by2] = gp(...hop.path[k + 1]);
      x = ax + (bx2 - ax) * f; y = ay + (by2 - ay) * f;
      lift = Math.sin(f * Math.PI) * (hop.from === -1 ? 1.4 : 0.8);
    } else [x, y] = gp(...hop.path[n]);
    drawToken(g, x, y - lift * cell * 0.3, r, hop.color, { lift: Math.min(1, lift * 0.6) });
    // captured tokens fly back to their yard
    if (hop.capT0 != null) {
      for (const [q, qt] of hop.caps) {
        const qc = S.colors[q];
        const k = Math.max(0, Math.min(1, (el - hop.capT0) / HOME_FLY_MS));
        const [ax, ay] = gp(...hop.path[n]), [ex, ey] = gp(...R.tokenCell(qc, -1, qt));
        const e = 1 - Math.pow(1 - k, 3);
        const xx = ax + (ex - ax) * e, yy = ay + (ey - ay) * e - Math.sin(k * Math.PI) * cell * 2.2;
        drawToken(g, xx, yy, r, qc, { lift: Math.sin(k * Math.PI) });
      }
    }
    void color;
  }

  function burst(x, y, col, n, kind) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 70 + Math.random() * 200;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, a: Math.random() * 6, va: (Math.random() - 0.5) * 10, s: kind === 'spark' ? 3 + Math.random() * 4 : 4 + Math.random() * 5, col, life: 0.8 + Math.random() * 0.5, kind, g: kind === 'spark' ? 160 : 500 });
    }
  }
  function confetti() {
    if (reduceMotion) return;
    const cols = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899'];
    for (let i = 0; i < 150; i++) particles.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.4, vx: (Math.random() - 0.5) * 900, vy: -300 - Math.random() * 650, a: Math.random() * 6, va: (Math.random() - 0.5) * 14, s: 7 + Math.random() * 8, col: cols[i % cols.length], life: 1.6 + Math.random(), g: 600 });
  }

  // Plays one token move: hop square by square, then send any captured tokens home.
  function playMove(last) {
    return new Promise((resolve) => {
      const color = S.colors[last.pl];
      const path = [];
      if (last.from === -1) { path.push(R.tokenCell(color, -1, last.t)); path.push(R.tokenCell(color, 0, last.t)); }
      else for (let p = last.from; p <= last.to; p++) path.push(R.tokenCell(color, p, last.t));
      if (reduceMotion) {
        disp[last.pl][last.t] = last.to;
        for (const [q, qt] of last.caps) disp[q][qt] = -1;
        G.sfx(last.caps.length ? 'whoosh' : 'drop');
        resolve();
        return;
      }
      const moveMs = last.from === -1 ? YARD_MS : HOP_MS * (path.length - 1);
      hop = { pl: last.pl, t: last.t, from: last.from, color, path, caps: last.caps, start: performance.now(), moveMs, capT0: null, fired: 0, resolve };
      if (last.from === -1) G.sfx('jump');
    });
  }
  function stepHop(t) {
    if (!hop) return;
    const el = Math.max(0, t - hop.start);
    const n = hop.path.length - 1;
    if (hop.from !== -1) {
      const k = Math.min(n, Math.floor(el / HOP_MS));
      while (hop.fired < k) { hop.fired++; G.sfx(hop.fired === n ? 'drop' : 'tick'); }
    }
    if (el >= hop.moveMs && hop.capT0 == null) {
      if (hop.from === -1) G.sfx('drop');
      const [x, y] = gp(...hop.path[n]);
      disp[hop.pl][hop.t] = hop.from === -1 ? 0 : hop.from + n;
      const reached = disp[hop.pl][hop.t];
      if (hop.caps.length) {
        hop.capT0 = el;
        G.sfx('whoosh');
        setTimeout(() => G.sfx('hit'), 60);
        hop.caps.forEach(([q]) => burst(x, y, COL[S.colors[q]].main, 18));
      } else hop.capT0 = el - HOME_FLY_MS;
      if (reached === R.HOME) { G.sfx('score'); burst(x, y, '#fde047', 24, 'spark'); }
    }
    if (hop.capT0 != null && el >= hop.capT0 + (hop.caps.length ? HOME_FLY_MS : 0)) {
      for (const [q, qt] of hop.caps) disp[q][qt] = -1;
      const done = hop.resolve;
      hop = null;
      done();
    }
  }

  // The die: tumbles through faces, then lands on the rolled value.
  function playDie(roll) {
    return new Promise((resolve) => {
      dieRolling = true;
      dieShown = { v: roll.v, pl: roll.pl };
      renderDie();
      if (reduceMotion) { G.sfx('drop'); dieRolling = false; renderDie(); setTimeout(resolve, 250); return; }
      dieEl.classList.remove('land'); dieEl.classList.add('rolling');
      let k = 0;
      const faces = setInterval(() => {
        k++;
        setFace(1 + Math.floor(Math.random() * 6));
        if (k % 2) G.sfx('tick');
      }, 75);
      setTimeout(() => {
        clearInterval(faces);
        dieRolling = false;
        dieEl.classList.remove('rolling'); void dieEl.offsetWidth; dieEl.classList.add('land');
        renderDie();
        G.sfx(roll.v === 6 ? 'coin' : 'drop');
        setTimeout(resolve, 260);
      }, 620);
    });
  }

  // Shows a new state: queues the die roll and/or the token move it contains, in the order they happened.
  function show(next, snap) {
    const prev = S;
    const sameGame = prev && next.gid === prev.gid && next.players.length === prev.players.length;
    S = next;
    setRotation();
    if (!sameGame || snap) {
      steps = []; hop = null; playing = false; dieRolling = false;
      disp = S.tokens.map((t) => t.slice());
      if (S.roll) dieShown = { v: S.roll.v, pl: S.roll.pl };
      renderAll();
      afterSettle();
      return;
    }
    const newRoll = S.roll && (!prev.roll || S.roll.n !== prev.roll.n) ? S.roll : null;
    const prevN = prev.last ? prev.last.n : 0;
    const newMove = S.last && S.last.n !== prevN ? S.last : null;
    if (newMove && newMove.n !== prevN + 1) { show(next, true); return; }    // missed a move: just jump there
    const rollAfterMove = S.phase === 'move' || (newRoll && newRoll.result !== 'move');
    const todo = [];
    if (newRoll && !rollAfterMove) todo.push({ kind: 'die', roll: newRoll });
    if (newMove) todo.push({ kind: 'move', last: newMove });
    if (newRoll && rollAfterMove) todo.push({ kind: 'die', roll: newRoll });
    // out players' tokens disappear straight away
    S.out.forEach((o, i) => { if (o) disp[i] = [-1, -1, -1, -1]; });
    steps.push(...todo, { kind: 'sync', state: S });
    renderAll();
    runSteps();
  }
  async function runSteps() {
    if (playing) return;
    playing = true;
    while (steps.length) {
      const st = steps.shift();
      if (st.kind === 'die') {
        await playDie(st.roll);
        const who = st.roll.pl;
        if (st.roll.result === 'pass') say(controls(who) ? `No moves with a ${st.roll.v}` : `${nameOf(who)} can’t move`);
        else if (st.roll.result === 'again') say('A 6! Roll again');
        else if (st.roll.result === 'forfeit') { say('Three 6s in a row – turn over!'); G.sfx('wrong'); }
        else if (st.roll.v === 6) say('A 6! Move, then roll again');
        if (st.roll.result !== 'move') await wait(450);
        renderStatus();
      } else if (st.kind === 'move') {
        await playMove(st.last);
        if (st.last.caps.length) {
          const victims = [...new Set(st.last.caps.map(([q]) => q))].map((q) => nameOf(q));
          say(`${nameOf(st.last.pl)} sent ${victims.join(' & ')} back home!`);
        } else if (st.last.to === R.HOME) say(`${nameOf(st.last.pl)} got a token home!`);
      } else if (st.kind === 'sync') {
        if (st.state === S) disp = S.tokens.map((x) => x.slice());
      }
    }
    playing = false;
    renderAll();
    afterSettle();
  }
  function say(text) { note = text; noteAt = Date.now(); renderStatus(); }

  function afterSettle() {
    if (S.winner != null) { celebrate(); return; }
    schedule();
  }

  // Automatic actions: computer turns, skipping people who left, and moving the only token that can move.
  function schedule() {
    clearTimeout(actTimer);
    if (mode === 'menu' || S.winner != null || !settledNow() || busy) return;
    const seq = S.seq, gid = S.gid;
    const still = () => mode !== 'menu' && S.seq === seq && S.gid === gid && S.winner == null && settledNow() && !busy;
    if (mode === 'multi' && isDriver() && present) {
      const gone = S.players.map((n, i) => i).filter((i) => !S.bots[i] && !S.out[i] && !present.includes(S.players[i]));
      if (gone.length) { act(R.markOut(S, gone)); return; }
    }
    const pl = S.turn;
    if (S.bots[pl] && isDriver()) {
      actTimer = setTimeout(() => {
        if (!still()) return;
        if (S.phase === 'roll') act(R.doRoll(S, 1 + Math.floor(Math.random() * 6)));
        else if (S.phase === 'move') { const m = R.pickMove(S); if (m) act(R.doMove(S, m)); }
      }, S.phase === 'roll' ? 650 : 450);
      return;
    }
    if (controls(pl) && S.phase === 'move') {
      const opts = R.distinctMoves(S, pl, S.die);
      if (opts.length === 1) actTimer = setTimeout(() => { if (still()) act(R.doMove(S, opts[0])); }, 420);
    }
  }

  // Applies one of my own actions (shown at once) and saves it to the shared game.
  function act(next) {
    const base = S.seq;
    show(next);
    if (mode === 'multi') commitNow(base, 0);
  }
  async function commitNow(baseSeq, attempt) {
    busy = true;
    const shared = S;
    let ok = false;
    try { ok = await G.turns.commit(shared, { done: shared.winner != null }); } catch (e) { ok = false; }
    if (ok) { busy = false; renderStatus(); if (settledNow()) afterSettle(); return; }
    const fresh = G.turns.shared();
    if (attempt < 2 && fresh && multi && fresh.gid === multi.gid && fresh.seq === baseSeq && S === shared) {
      await wait(150);
      return commitNow(baseSeq, attempt + 1);
    }
    busy = false;
    if (fresh) applyShared(fresh, true); else renderStatus();
  }

  function rollNow() {
    if (!canRoll()) { if (S.phase === 'roll' && controls(S.turn) === false && mode !== 'menu' && S.winner == null) { G.sfx('wrong'); shake(); } return; }
    note = '';
    act(R.doRoll(S, 1 + Math.floor(Math.random() * 6)));
  }
  function moveToken(t) {
    if (!canMove()) return;
    const m = movable().find((x) => x.t === t);
    if (!m) { G.sfx('wrong'); return; }
    clearTimeout(actTimer);
    G.sfx('click');
    focusIdx = -1; hoverTok = null;
    act(R.doMove(S, m));
  }

  // ---------- Game over ----------
  function celebrate() {
    const w = S.winner;
    renderAll();
    const key = mode + ':' + S.gid + ':' + S.seq;
    if (overFor === key) return;
    overFor = key;
    const mine = w != null && S.reason !== 'left' && !S.bots[w] && (mode === 'local' || (!!multi && w === multi.myIdx));
    if (mine) { G.sfx('win'); confetti(); } else G.sfx(w == null || S.reason === 'left' ? 'score' : 'lose');
    setTimeout(() => { if (overFor === key) finishCard(); }, 1500);
  }
  function finishCard() {
    const w = S.winner;
    if (mode === 'multi' && multi) {
      if (S.reason === 'left') { G.gameOver({ title: w === multi.myIdx ? 'Everyone else left' : 'Game over', detail: 'The game ended because the other players left.', score: 0 }); return; }
      G.gameOver({ title: w === multi.myIdx ? 'You win!' : `${S.players[w]} wins!`, detail: `First to bring all four tokens home (${COL[S.colors[w]].name}).`, score: w === multi.myIdx ? 1 : 0 });
      return;
    }
    if (mode === 'local') {
      const humans = S.bots.filter((b) => !b).length;
      if (humans === 1) {
        if (!S.bots[w]) G.gameOver({ title: 'You win!', score: 1, again: restartLocal });
        else G.gameOver({ title: `${S.players[w]} wins`, score: 0, again: restartLocal });
        return;
      }
      const C = COL[S.colors[w]];
      const card = G.modal(`<div class="cg-hero plain"><i class="ld-pawn big" style="--c:${C.main};--d:${C.dark}"></i></div><h2>${esc(S.players[w])} wins!</h2><p>All four tokens made it home.</p><div class="cg-row col"><button type="button" class="primary" data-a="again">Play again</button><button type="button" data-a="menu">Change game</button></div>`);
      card.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        G.closeModal();
        if (b.dataset.a === 'again') restartLocal(); else showMenu();
      });
    }
  }

  // ---------- Multiplayer ----------
  function initialShared(players, seed) {
    const names = players.slice(0, 4);
    const bots = names.map(() => false);
    if (cfg.fill) for (let i = 0; names.length < 4; i++) { names.push(BOT_NAMES[i]); bots.push(true); }
    return R.newGame(names, seed, bots);
  }
  function applyShared(s, force) {
    if (!s || !Array.isArray(s.tokens)) return;
    if (!multi || s.gid !== multi.gid) {
      multi = { gid: s.gid, myIdx: s.players.indexOf(G.me()) };
      overFor = null; particles = []; note = '';
      S = s;
      present = (G.session() && G.session().players) || null;
      show(s, true);
      layout();
      return;
    }
    if (!force && s.seq <= S.seq) return;
    if (force && s.seq <= S.seq && s.seq === S.seq && JSON.stringify(s) === JSON.stringify(S)) return;
    show(s, force && s.seq <= S.seq);
  }
  setInterval(() => {
    if (mode !== 'multi' || !multi) return;
    const s = G.session();
    const now = s ? s.players.slice() : null;
    if (JSON.stringify(now) !== JSON.stringify(present)) { present = now; renderTop(); schedule(); }
  }, 1000);

  // ---------- UI ----------
  function renderAll() { renderTop(); renderStatus(); renderDie(); }
  function renderTop() {
    if (!topEl) return;
    topEl.innerHTML = S.players.map((n, i) => {
      const C = COL[S.colors[i]];
      const home = S.tokens[i].filter((p) => p === R.HOME).length;
      const gone = S.out[i] || (mode === 'multi' && present && !S.bots[i] && !present.includes(n));
      const label = mode === 'multi' && multi && i === multi.myIdx ? `${n} (you)` : n;
      return `<span class="ld-chip${S.winner == null && S.turn === i && mode !== 'menu' ? ' on' : ''}${gone ? ' gone' : ''}${S.winner === i ? ' won' : ''}" style="--c:${C.main};--d:${C.dark}">` +
        `<i class="ld-pawn" style="--c:${C.main};--d:${C.dark}"></i><b>${S.bots[i] ? G.icon('cpu', 14) : ''}${esc(label)}</b>` +
        `<span class="ld-homes" aria-label="${home} of 4 home">${[0, 1, 2, 3].map((k) => `<i class="${k < home ? 'in' : ''}"></i>`).join('')}</span></span>`;
    }).join('');
  }
  function renderStatus() {
    if (!msgEl) return;
    let msg = '', cls = '';
    const pl = S.turn;
    const C = colorOf(pl);
    if (mode === 'menu') msg = '';
    else if (S.winner != null) { msg = S.reason === 'left' ? 'Everyone else left' : `${nameOf(S.winner) === 'You' ? 'You win' : `${S.players[S.winner]} wins`}!`; cls = 'end'; }
    else if (mode === 'multi' && multi && multi.myIdx < 0) msg = `${S.players[pl]}’s turn`;
    else if (controls(pl)) {
      const who = mode === 'local' && S.bots.filter((b) => !b).length > 1 ? `${S.players[pl]}: ` : '';
      if (S.phase === 'roll') { msg = `${who}tap the die to roll`; cls = 'mine'; }
      else { const n = R.distinctMoves(S, pl, S.die || 0).length; msg = n > 1 ? `${who}tap a glowing token` : `${who}moving…`; cls = 'mine'; }
      if (!who) msg = msg.charAt(0).toUpperCase() + msg.slice(1);
    } else if (S.bots[pl]) msg = `${S.players[pl]} is ${S.phase === 'roll' ? 'rolling' : 'thinking'}…`;
    else msg = `Waiting for ${S.players[pl]}…`;
    const fresh = note && Date.now() - noteAt < 2600 && S.winner == null;
    msgEl.innerHTML = `${fresh ? `<span class="ld-note">${esc(note)}</span>` : ''}<span class="ld-msg ${cls}" style="--c:${C.main}">${esc(msg)}</span>`;
    msgEl.setAttribute('aria-label', (fresh ? note + '. ' : '') + msg);
    if (fresh) { clearTimeout(renderStatus.t); renderStatus.t = setTimeout(renderStatus, 2700); }
    barEl.hidden = mode === 'menu';
    const menuBtn = $('[data-a="menu"]', barEl);
    if (menuBtn) menuBtn.hidden = mode !== 'local';
    const lobbyBtn = $('[data-a="lobby"]', barEl);
    if (lobbyBtn) lobbyBtn.hidden = mode !== 'multi';
  }
  function setFace(v) { dieEl.dataset.v = String(v); }
  function renderDie() {
    if (!dieEl) return;
    const pl = dieRolling ? dieShown.pl : (S.phase === 'roll' || S.winner != null ? S.turn : (dieShown.pl != null ? dieShown.pl : S.turn));
    const C = COL[S.colors[pl] != null ? S.colors[pl] : 0];
    dieEl.style.setProperty('--c', C.main);
    dieEl.style.setProperty('--d', C.dark);
    if (!dieRolling) setFace(S.phase === 'roll' && !dieShown.v ? 6 : (dieShown.v || 6));
    const ready = canRoll();
    dieEl.classList.toggle('ready', ready);
    dieEl.classList.toggle('idle', S.phase === 'roll' && !dieRolling);
    dieEl.setAttribute('aria-label', ready ? 'Roll the die' : `Die showing ${dieShown.v || 6}`);
  }
  function shake() { const m = $('.ld-msg', msgEl); if (m) { m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); } }

  // ---------- Menu ----------
  function renderMenuCfg() {
    const people = $('[data-v="people"]', menuEl), bots = $('[data-v="bots"]', menuEl);
    people.textContent = cfg.people; bots.textContent = cfg.bots;
    const total = cfg.people + cfg.bots;
    $('[data-step="people:-1"]', menuEl).disabled = cfg.people <= 1;
    $('[data-step="people:1"]', menuEl).disabled = total >= 4;
    $('[data-step="bots:-1"]', menuEl).disabled = cfg.bots <= 0;
    $('[data-step="bots:1"]', menuEl).disabled = total >= 4;
    const ok = total >= 2;
    const start = $('[data-a="start"]', menuEl);
    start.disabled = !ok;
    $('.ld-cfg-hint', menuEl).textContent = ok ? `${total} players: ${[...Array(total)].map((_, i) => R.NAMES[R.SEATS[total][i]]).join(', ')}` : 'Add a person or a computer player to start';
    const fill = $('[data-a="fill"]', menuEl);
    fill.setAttribute('aria-checked', cfg.fill ? 'true' : 'false');
    fill.classList.toggle('on', cfg.fill);
  }
  function showMenu() {
    mode = 'menu';
    G.closeModal();
    clearTimeout(actTimer);
    steps = []; hop = null; playing = false; dieRolling = false; busy = false;
    S = R.newGame(['Red', 'Green', 'Yellow', 'Blue'], 1);
    disp = S.tokens.map((t) => t.slice());
    dieShown = { v: 0, pl: 0 };
    rot = 0;
    menuEl.hidden = false;
    renderMenuCfg();
    renderAll();
  }
  function startLocal() {
    if (cfg.people + cfg.bots < 2) return;
    saveCfg();
    mode = 'local';
    menuEl.hidden = true;
    restartLocal();
  }
  function restartLocal() {
    G.closeModal();
    if (mode !== 'local') return;
    const total = cfg.people + cfg.bots;
    const seats = R.SEATS[total];
    // computers take the last seats
    const names = [], bots = [];
    let b = 0;
    for (let i = 0; i < total; i++) {
      const isBot = i >= cfg.people;
      bots.push(isBot);
      names.push(isBot ? BOT_NAMES[b++] : (cfg.people === 1 ? 'You' : R.NAMES[seats[i]]));
    }
    overFor = null; note = ''; particles = [];
    show(R.newGame(names, Date.now() % 1e9, bots), true);
    layout();
  }

  function build(ctx) {
    root = ctx.root;
    root.classList.add('ld-stage');
    root.innerHTML = `<div class="ld-wrap"><div class="ld-top"></div><div class="ld-box"><canvas aria-label="Race Home board" role="img"></canvas></div>
      <div class="ld-bar" hidden><button type="button" class="ld-small" data-a="menu" hidden aria-label="Menu">${G.icon('back', 20)}</button><button type="button" class="ld-small" data-a="lobby" hidden aria-label="Players">${G.icon('users', 20)}</button>
        <div class="ld-status" aria-live="polite"></div>
        <button type="button" class="ld-die" data-v="6"><span class="ld-face">${'<i></i>'.repeat(9)}</span></button></div></div>
      <div class="ld-menu" hidden><div class="ld-menu-card">
        <div class="ld-logo" aria-hidden="true"><i class="ld-pawn" style="--c:${COL[0].main};--d:${COL[0].dark}"></i><i class="ld-pawn" style="--c:${COL[1].main};--d:${COL[1].dark}"></i><span class="ld-logo-die" data-v="6"><span class="ld-face">${'<i></i>'.repeat(9)}</span></span><i class="ld-pawn" style="--c:${COL[2].main};--d:${COL[2].dark}"></i><i class="ld-pawn" style="--c:${COL[3].main};--d:${COL[3].dark}"></i></div>
        <h2>Race Home</h2><p>Roll the die and race your four tokens round the board. Bring them all home first to win!</p>
        <div class="ld-more"><button type="button" class="ld-family" data-a="family">${G.icon('users', 22)}<span>Play with the family</span></button>
        <button type="button" class="ld-toggle" data-a="fill" role="switch" aria-checked="false"><span class="ld-switch"><i></i></span><span>Fill empty seats with computer players</span></button></div>
        <h3>On this device</h3>
        <div class="ld-cfg">
          <div class="ld-row"><span>${G.icon('user', 18)}People</span><button type="button" data-step="people:-1" aria-label="Fewer people">${G.icon('minus', 18)}</button><b data-v="people">2</b><button type="button" data-step="people:1" aria-label="More people">${G.icon('plus', 18)}</button></div>
          <div class="ld-row"><span>${G.icon('cpu', 18)}Computers</span><button type="button" data-step="bots:-1" aria-label="Fewer computers">${G.icon('minus', 18)}</button><b data-v="bots">0</b><button type="button" data-step="bots:1" aria-label="More computers">${G.icon('plus', 18)}</button></div>
          <p class="ld-cfg-hint"></p>
          <button type="button" class="ld-start" data-a="start">${G.icon('play', 18)}<span>Start on this device</span></button>
        </div>
      </div></div>`;
    topEl = $('.ld-top', root); boxEl = $('.ld-box', root); canvas = $('canvas', root); cx = canvas.getContext('2d');
    msgEl = $('.ld-status', root); dieEl = $('.ld-die', root); menuEl = $('.ld-menu', root); barEl = $('.ld-bar', root);
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      G.sfx('click');
      if (b.dataset.step) {
        const [k, d] = b.dataset.step.split(':');
        cfg[k] = Math.max(0, cfg[k] + Number(d));
        if (cfg.people < 1) cfg.people = 1;
        while (cfg.people + cfg.bots > 4) cfg.bots--;
        renderMenuCfg();
      } else if (b.dataset.a === 'fill') { cfg.fill = !cfg.fill; renderMenuCfg(); }
      else if (b.dataset.a === 'start') startLocal();
      else if (b.dataset.a === 'family') G.openLobby();
    });
    dieEl.addEventListener('click', () => rollNow());
    barEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.a === 'menu') { if (S.winner == null && S.last) { const card = G.modal(`<h2>Leave this game?</h2><p>The race will be lost.</p><div class="cg-row"><button type="button" data-cg="close">Keep playing</button><button type="button" class="primary" data-a="yes">Leave</button></div>`); card.querySelector('[data-a="yes"]').addEventListener('click', () => { G.closeModal(); showMenu(); }); } else showMenu(); }
      else if (b.dataset.a === 'lobby') G.openLobby();
    });
    const tokenAt = (e) => {
      const r = canvas.getBoundingClientRect();
      const [gx, gy] = gridAt(e.clientX - r.left, e.clientY - r.top);
      let best = null, bd = 0.8;
      for (const m of movable()) {
        const color = S.colors[S.turn];
        for (const [x, y, w] of [[...R.tokenCell(color, m.from, m.t), 1], [...R.tokenCell(color, m.to, m.t), 1.15]]) {
          const d = Math.hypot(x - gx, y - gy) / w;
          if (d < bd) { bd = d; best = m; }
        }
      }
      return best;
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!canMove()) return;
      const m = tokenAt(e);
      if (m) moveToken(m.t);
    });
    canvas.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; const m = canMove() ? tokenAt(e) : null; hoverTok = m; canvas.style.cursor = m ? 'pointer' : 'default'; });
    window.addEventListener('keydown', (e) => {
      if (G.modalOpen() || mode === 'menu') return;
      if (e.target && e.target.closest && e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
      const mv = movable();
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (canRoll()) rollNow();
        else if (canMove() && mv.length) moveToken(mv[Math.max(0, focusIdx)] ? mv[Math.max(0, focusIdx)].t : mv[0].t);
      } else if (/^[1-4]$/.test(e.key) && canMove()) moveToken(Number(e.key) - 1);
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Tab') && canMove() && mv.length) { e.preventDefault(); focusIdx = (focusIdx + 1) % mv.length; }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && canMove() && mv.length) { e.preventDefault(); focusIdx = (focusIdx - 1 + mv.length) % mv.length; }
    });
    new ResizeObserver(() => layout()).observe(boxEl);
    layout();
    showMenu();
    requestAnimationFrame(loop);
  }

  let lastT = 0, lastReady = null;
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
    stepHop(t);
    for (const p of particles) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.99; p.a += (p.va || 0) * dt; p.life -= dt * (p.kind ? 1.1 : 0.5); }
    particles = particles.filter((p) => p.life > 0 && p.y < H + 40);
    const ready = canRoll() + ':' + canMove();
    if (ready !== lastReady) { lastReady = ready; renderDie(); renderStatus(); }
    draw(t);
  }

  G.on('multiStart', (info) => {
    mode = 'multi';
    menuEl.hidden = true;
    multi = null;
    clearTimeout(actTimer);
    if (info && info.shared) applyShared(info.shared, true);
  });
  G.on('shared', (s) => { if (mode === 'multi') applyShared(s); });
  G.on('multiEnd', () => { multi = null; present = null; showMenu(); });

  G.mount({
    id: 'ludo', title: 'Race Home', mode: 'turns', minPlayers: 2, maxPlayers: 4, scoreLabel: 'wins',
    help: '<ul><li>Tap the <b>die</b> to roll. You need a <b>6</b> to bring a token out of your yard.</li>' +
      '<li>Then tap a glowing token to move it that many squares (if only one can move, it moves by itself). Tokens go clockwise round the board and up their own coloured path.</li>' +
      '<li>Rolled a 6? Roll again! But three 6s in a row ends your turn.</li>' +
      `<li>Land on someone else’s token to send it back to their yard. Tokens on a ${G.icon('star', 15)} star or a coloured start square are safe.</li>` +
      '<li>You need the exact number to reach home in the middle. The first to bring all four tokens home wins!</li>' +
      '<li>On a keyboard: Space rolls, the keys 1–4 or the arrow keys and Enter move a token.</li>' +
      `<li>${G.icon('users', 17)} <b>Play with the family</b> on 2–4 phones. If someone leaves, their colour is skipped. Every win counts on the leaderboard.</li></ul>`,
    initialShared,
    onReady: build
  });

  window.__ludo = {
    state: () => ({ mode, S, disp, busy, settled: settledNow(), canRoll: canRoll(), canMove: canMove(), movable: movable(), multi, rot, cfg }),
    tokenXY: (pl, t) => { const r = canvas.getBoundingClientRect(); const [x, y] = gp(...R.tokenCell(S.colors[pl], disp[pl][t], t)); return [r.left + x, r.top + y]; },
    rules: R
  };
})();
