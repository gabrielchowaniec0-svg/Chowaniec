// Checkers: American rules on a wooden 8×8 board. Play with the family through ChowGames turns
// (players[0] is Red and moves first), two players on one device, or the computer (Easy / Medium / Hard).
// Rules and the computer player live in rules.js (window.CheckersRules).
(function () {
  'use strict';

  const G = window.ChowGames;
  const R = window.CheckersRules;
  const SIDE = [
    { name: 'Red', main: '#e23d3d', light: '#ff9d8e', dark: '#9e1b1f', edge: '#7a1216', ring: 'rgba(90,10,12,.38)' },
    { name: 'White', main: '#f3ebdd', light: '#ffffff', dark: '#c4b292', edge: '#a08a66', ring: 'rgba(110,84,50,.32)' }
  ];
  const LEVELS = { easy: { label: 'Easy', n: 1 }, medium: { label: 'Medium', n: 2 }, hard: { label: 'Hard', n: 3 } };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pips = (k) => `<span class="ck-pips l${LEVELS[k].n}" aria-hidden="true"><i></i><i></i><i></i></span>`;
  const pieceDot = (side, king) => `<i class="ck-dot s${side}${king ? ' k' : ''}"></i>`;

  // ---------- State ----------
  let root, canvas, cx, boxEl, statusEl, menuEl, controlsEl, histEl, offerEl;
  let W = 0, H = 0, dpr = 1, cell = 50, bx = 0, by = 0, frameW = 14, layer = null;
  let mode = 'menu';                   // menu | solo | local | multi
  let level = 'medium';
  try { level = localStorage.getItem('chow_checkers_level') || 'medium'; if (!LEVELS[level]) level = 'medium'; } catch (e) { /* ignore */ }
  let game = R.newGame(['Red', 'White'], 1);
  let board = R.decode(game.board);
  let moves = [];
  let sel = -1, partial = null, cursor = -1, keyActive = false, hoverSq = -1;
  let anim = null, animQ = [], particles = [];
  let thinking = false, busy = false, overFor = null, winAt = 0;
  let multi = null;                    // { gid, myIdx, present }
  let undoStack = [];
  let flashForcedAt = 0;

  const flip = () => mode === 'multi' && multi && multi.myIdx === 1;

  function setGame(s) {
    game = s;
    board = R.decode(s.board);
    moves = s.winner == null ? R.legalMoves(board, s.turn) : [];
    sel = -1; partial = null;
    // only one piece can move (usually a forced jump): pick it up for them
    if (canMove()) {
      const froms = new Set(moves.map((m) => m.from));
      if (froms.size === 1 && moves[0].caps.length) { sel = moves[0].from; partial = [sel]; }
    }
    renderStatus();
    renderHist();
  }

  // ---------- Layout ----------
  function layout() {
    const r = boxEl.getBoundingClientRect();
    W = Math.max(1, Math.floor(r.width)); H = Math.max(1, Math.floor(r.height));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    cell = Math.max(18, Math.floor(Math.min(W - 4, H - 4) / 8.7));
    frameW = Math.round(cell * 0.35);
    const total = cell * 8 + frameW * 2;
    bx = Math.round((W - total) / 2) + frameW;
    by = Math.round((H - total) / 2) + frameW;
    buildLayer();
  }
  // square index -> centre on screen (respects the flipped view)
  function sqXY(i) {
    let r = i >> 3, c = i & 7;
    if (flip()) { r = 7 - r; c = 7 - c; }
    return [bx + (c + 0.5) * cell, by + (r + 0.5) * cell];
  }
  function sqAt(x, y) {
    let c = Math.floor((x - bx) / cell), r = Math.floor((y - by) / cell);
    if (r < 0 || r > 7 || c < 0 || c > 7) return -1;
    if (flip()) { r = 7 - r; c = 7 - c; }
    return r * 8 + c;
  }

  function rr(g, x, y, w, h, rad) {
    g.beginPath();
    g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath();
  }

  // Wood grain: thin wavy lines, the same every time (seeded).
  function grain(g, x, y, w, h, color, n, seed, vertical) {
    const rnd = G.rng(seed);
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.strokeStyle = color;
    for (let k = 0; k < n; k++) {
      const off = rnd() * (vertical ? w : h), amp = 0.6 + rnd() * 2.2, f = 0.02 + rnd() * 0.05, ph = rnd() * 6;
      g.lineWidth = 0.6 + rnd() * 1.4;
      g.beginPath();
      const len = vertical ? h : w;
      for (let t = 0; t <= len; t += 4) {
        const d = off + Math.sin(t * f + ph) * amp + Math.sin(t * f * 2.7 + ph) * amp * 0.4;
        if (vertical) { if (t === 0) g.moveTo(x + d, y + t); else g.lineTo(x + d, y + t); }
        else if (t === 0) g.moveTo(x + t, y + d); else g.lineTo(x + t, y + d);
      }
      g.stroke();
    }
    g.restore();
  }

  function buildLayer() {
    const total = cell * 8 + frameW * 2, m = 24;
    const c = document.createElement('canvas');
    c.width = Math.ceil((total + m * 2) * dpr); c.height = Math.ceil((total + m * 2) * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const ox = m, oy = m;
    // shadow under the board
    g.save(); g.shadowColor = 'rgba(0,0,0,.32)'; g.shadowBlur = 22; g.shadowOffsetY = 10;
    rr(g, ox, oy, total, total, frameW * 0.7); g.fillStyle = '#5a3218'; g.fill(); g.restore();
    // frame
    const fg = g.createLinearGradient(ox, oy, ox + total, oy + total);
    fg.addColorStop(0, '#8a5427'); fg.addColorStop(0.5, '#6d3d1a'); fg.addColorStop(1, '#55290f');
    rr(g, ox, oy, total, total, frameW * 0.7); g.fillStyle = fg; g.fill();
    g.save(); rr(g, ox, oy, total, total, frameW * 0.7); g.clip();
    grain(g, ox, oy, total, total, 'rgba(40,18,4,.22)', 40, 7, false);
    g.restore();
    rr(g, ox + 1.5, oy + 1.5, total - 3, total - 3, frameW * 0.65); g.lineWidth = 2; g.strokeStyle = 'rgba(255,220,170,.28)'; g.stroke();
    // squares
    const sx = ox + frameW, sy = oy + frameW;
    for (let r = 0; r < 8; r++) for (let cc = 0; cc < 8; cc++) {
      const x = sx + cc * cell, y = sy + r * cell, dark = (r + cc) % 2 === 1;
      const sg = g.createLinearGradient(x, y, x + cell, y + cell);
      if (dark) { sg.addColorStop(0, '#a3683b'); sg.addColorStop(1, '#8b532b'); } else { sg.addColorStop(0, '#f5ddb0'); sg.addColorStop(1, '#ebc98f'); }
      g.fillStyle = sg; g.fillRect(x, y, cell + 0.5, cell + 0.5);
      grain(g, x, y, cell, cell, dark ? 'rgba(60,28,8,.2)' : 'rgba(150,96,40,.09)', 5, r * 8 + cc + 11, (r + cc) % 4 < 2);
    }
    // inner bevel
    g.save();
    g.lineWidth = Math.max(2, frameW * 0.18);
    g.strokeStyle = 'rgba(30,12,2,.45)'; g.strokeRect(sx - g.lineWidth / 2, sy - g.lineWidth / 2, cell * 8 + g.lineWidth, cell * 8 + g.lineWidth);
    const ig = g.createLinearGradient(0, sy, 0, sy + cell * 0.25);
    ig.addColorStop(0, 'rgba(0,0,0,.18)'); ig.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ig; g.fillRect(sx, sy, cell * 8, cell * 0.25);
    g.restore();
    layer = { c, m };
  }

  // ---------- Drawing ----------
  function drawCrown(g, x, y, s, alpha) {
    g.save();
    g.globalAlpha *= alpha == null ? 1 : alpha;
    g.translate(x, y);
    g.beginPath();
    g.moveTo(-s, s * 0.55); g.lineTo(-s * 1.05, -s * 0.45); g.lineTo(-s * 0.5, s * 0.05); g.lineTo(0, -s * 0.75);
    g.lineTo(s * 0.5, s * 0.05); g.lineTo(s * 1.05, -s * 0.45); g.lineTo(s, s * 0.55); g.closePath();
    const cg = g.createLinearGradient(0, -s, 0, s);
    cg.addColorStop(0, '#fff3b0'); cg.addColorStop(0.45, '#fbbf24'); cg.addColorStop(1, '#d97706');
    g.fillStyle = cg; g.fill();
    g.lineJoin = 'round'; g.lineWidth = Math.max(1, s * 0.14); g.strokeStyle = '#92400e'; g.stroke();
    for (const px of [-1.05, 0, 1.05]) { g.beginPath(); g.arc(px * s, px === 0 ? -s * 0.78 : -s * 0.48, s * 0.16, 0, Math.PI * 2); g.fillStyle = '#fff7d6'; g.fill(); }
    g.restore();
  }

  // One glossy piece. lift: 0..1 raises it (bigger shadow), crown: 0..1 how far the crown has dropped in.
  function drawPiece(g, x, y, r, v, o) {
    o = o || {};
    const side = R.owner(v), S = SIDE[side];
    const lift = o.lift || 0, sc = o.scale || 1;
    const king = R.isKing(v) || o.crown != null;
    g.save();
    if (o.alpha != null) g.globalAlpha = o.alpha;
    r *= sc;
    // shadow
    const sh = g.createRadialGradient(x, y + r * 0.25 + lift * r * 0.5, r * 0.2, x, y + r * 0.25 + lift * r * 0.5, r * (1.15 + lift * 0.35));
    sh.addColorStop(0, `rgba(0,0,0,${0.42 - lift * 0.15})`); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.beginPath(); g.arc(x, y + r * 0.25 + lift * r * 0.5, r * (1.15 + lift * 0.35), 0, Math.PI * 2); g.fill();
    y -= lift * r * 0.45;
    const layers = king ? 2 : 1;
    for (let k = 0; k < layers; k++) {
      const yy = y - k * r * 0.24 + (king ? r * 0.1 : 0);
      // side (thickness)
      g.beginPath(); g.arc(x, yy + r * 0.16, r, 0, Math.PI * 2); g.fillStyle = S.edge; g.fill();
      // top face
      const tg = g.createRadialGradient(x - r * 0.35, yy - r * 0.4, r * 0.08, x, yy, r);
      tg.addColorStop(0, S.light); tg.addColorStop(0.5, S.main); tg.addColorStop(1, S.dark);
      g.beginPath(); g.arc(x, yy, r, 0, Math.PI * 2); g.fillStyle = tg; g.fill();
      // ridges
      g.lineWidth = Math.max(1, r * 0.07); g.strokeStyle = S.ring;
      g.beginPath(); g.arc(x, yy, r * 0.76, 0, Math.PI * 2); g.stroke();
      g.lineWidth = Math.max(1, r * 0.04);
      g.beginPath(); g.arc(x, yy, r * 0.55, 0, Math.PI * 2); g.stroke();
      // gloss
      g.save(); g.globalAlpha *= 0.55;
      g.beginPath(); g.ellipse(x - r * 0.3, yy - r * 0.42, r * 0.42, r * 0.2, -0.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      g.restore();
    }
    if (king) {
      const t = o.crown == null ? 1 : o.crown;
      const top = y - r * 0.14;
      const dropY = top - (1 - easeOutBack(t)) * r * 1.6;
      drawCrown(g, x, dropY, r * 0.42, Math.min(1, t * 2.5));
    }
    g.restore();
  }
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOutBack = (t) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  function tintSq(g, i, color) {
    const [x, y] = sqXY(i);
    g.fillStyle = color; g.fillRect(x - cell / 2, y - cell / 2, cell, cell);
  }

  function draw(t) {
    const g = cx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!layer) return;
    g.drawImage(layer.c, bx - frameW - layer.m, by - frameW - layer.m, layer.c.width / dpr, layer.c.height / dpr);
    const pr = cell * 0.39;
    const showBoard = anim ? anim.board : board;
    // last move
    const last = anim ? null : game.last;
    if (last) {
      const ring = (i, a) => { const [x, y] = sqXY(i); tintSq(g, i, `rgba(255,236,170,${a * 0.22})`); g.save(); g.lineWidth = Math.max(2, cell * 0.06); g.strokeStyle = `rgba(251,191,36,${a})`; g.strokeRect(x - cell / 2 + g.lineWidth / 2, y - cell / 2 + g.lineWidth / 2, cell - g.lineWidth, cell - g.lineWidth); g.restore(); };
      ring(last.path[0], 0.55);
      ring(last.path[last.path.length - 1], 0.95);
      for (const cpt of last.caps) tintSq(g, cpt, 'rgba(255,140,80,.16)');
    }
    const can = canMove() && !anim;
    const cands = can && sel >= 0 ? candidates() : [];
    if (can && sel >= 0) {
      tintSq(g, sel, 'rgba(110,231,183,.35)');
      // path so far (multi-jump)
      if (partial && partial.length > 1) {
        g.save(); g.lineWidth = cell * 0.08; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(16,185,129,.85)'; g.setLineDash([cell * 0.12, cell * 0.1]);
        g.beginPath(); partial.forEach((s, k) => { const [x, y] = sqXY(s); if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.restore();
      }
    }
    // pieces
    const animating = anim && anim.active;
    for (let i = 0; i < 64; i++) {
      const v = showBoard[i];
      if (!v) continue;
      if (animating && i === anim.m.from) continue;
      if (animating && anim.m.caps.includes(i)) continue;
      const [x, y] = sqXY(i);
      const lifted = can && i === sel;
      drawPiece(g, x, y, pr, v, { lift: lifted ? 0.6 + Math.sin(t / 240) * 0.08 : 0 });
    }
    if (animating) drawAnim(g, t, pr);
    // hints
    if (can) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 200);
      const froms = new Set(moves.map((m) => m.from));
      const forced = moves.length && moves[0].caps.length;
      if (sel < 0 || forced) {
        for (const f of froms) {
          if (f === sel) continue;
          const [x, y] = sqXY(f);
          g.save();
          g.lineWidth = Math.max(2, cell * (forced ? 0.07 : 0.04));
          const flash = t - flashForcedAt < 900 ? 1 : 0;
          g.strokeStyle = forced ? `rgba(251,146,60,${0.6 + 0.4 * pulse})` : 'rgba(255,255,255,.55)';
          if (forced) { g.shadowColor = '#fb923c'; g.shadowBlur = cell * (0.2 + 0.25 * pulse + flash * 0.4); }
          g.beginPath(); g.arc(x, y - (R.isKing(board[f]) ? pr * 0.1 : 0), pr * (forced ? 1.1 + 0.05 * pulse : 1.06), 0, Math.PI * 2); g.stroke();
          g.restore();
        }
      }
      if (sel >= 0) {
        const step = partial ? partial.length : 1;
        const nexts = new Set(cands.map((m) => m.path[step]).filter((s) => s != null));
        for (const s of nexts) {
          const [x, y] = sqXY(s);
          const hov = s === hoverSq || (keyActive && s === cursor);
          g.save();
          g.beginPath(); g.arc(x, y, cell * (hov ? 0.24 : 0.17) + pulse * cell * 0.02, 0, Math.PI * 2);
          g.fillStyle = hov ? 'rgba(16,185,129,.9)' : 'rgba(16,185,129,.62)'; g.fill();
          g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.85)'; g.stroke();
          g.restore();
        }
        // pieces that would be captured
        const capNext = new Set(cands.map((m) => m.caps[step - 1]).filter((s) => s != null));
        for (const s of capNext) {
          const [x, y] = sqXY(s);
          g.save(); g.lineWidth = Math.max(2, cell * 0.06); g.strokeStyle = `rgba(239,68,68,${0.65 + 0.35 * pulse})`;
          const k = pr * 0.42;
          g.lineCap = 'round';
          g.beginPath(); g.moveTo(x - k, y - k - pr * 0.1); g.lineTo(x + k, y + k - pr * 0.1); g.moveTo(x + k, y - k - pr * 0.1); g.lineTo(x - k, y + k - pr * 0.1); g.stroke();
          g.restore();
        }
        // selected piece ring
        const [x, y] = sqXY(sel);
        g.save(); g.lineWidth = Math.max(2.5, cell * 0.06); g.strokeStyle = '#34d399'; g.shadowColor = '#34d399'; g.shadowBlur = cell * 0.25;
        g.beginPath(); g.arc(x, y - pr * 0.3, pr * 1.12, 0, Math.PI * 2); g.stroke(); g.restore();
      }
    }
    // keyboard cursor
    if (keyActive && cursor >= 0 && mode !== 'menu') {
      const [x, y] = sqXY(cursor);
      g.save(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.setLineDash([6, 4]);
      g.strokeRect(x - cell / 2 + 3, y - cell / 2 + 3, cell - 6, cell - 6); g.restore();
    }
    // particles
    for (const p of particles) {
      g.save(); g.globalAlpha = Math.max(0, Math.min(1, p.life));
      g.translate(p.x, p.y); g.rotate(p.a || 0);
      g.fillStyle = p.col;
      if (p.kind === 'spark') { g.beginPath(); g.arc(0, 0, p.s, 0, Math.PI * 2); g.fill(); } else g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
  }

  // ---------- Move animation ----------
  const SLIDE_MS = 240, JUMP_MS = 340, POP_MS = 320, CROWN_MS = 520;
  function queueAnim(startBoard, m, done) {
    if (reduceMotion) {
      if (m.caps.length) G.sfx('point'); else G.sfx('drop');
      if (m.crown) G.sfx('coin');
      done && done();
      return;
    }
    const segs = [];
    let tt = 0;
    for (let k = 0; k < m.path.length - 1; k++) {
      const jump = m.caps.length > 0;
      const d = jump ? JUMP_MS : SLIDE_MS;
      segs.push({ a: m.path[k], b: m.path[k + 1], t0: tt, t1: tt + d, jump, cap: jump ? m.caps[k] : -1 });
      tt += d + (jump ? 40 : 0);
    }
    const crownT0 = tt;
    if (m.crown) tt += CROWN_MS;
    animQ.push({ board: startBoard.slice(), m, piece: startBoard[m.from], segs, crownT0, total: tt + 60, done, fired: new Set() });
    if (!anim) nextAnim();
  }
  function nextAnim() {
    anim = animQ.shift() || null;
    if (anim) { anim.active = true; anim.start = performance.now(); }
  }
  function drawAnim(g, t, pr) {
    const el = Math.max(0, t - anim.start);
    // captured pieces: still there until jumped, then pop
    for (const s of anim.segs) {
      if (s.cap < 0) continue;
      const v = anim.board[s.cap];
      const [x, y] = sqXY(s.cap);
      if (el < s.t1) drawPiece(g, x, y, pr, v);
      else if (el < s.t1 + POP_MS) {
        const k = (el - s.t1) / POP_MS;
        drawPiece(g, x, y, pr, v, { scale: 1 + k * 0.45, alpha: 1 - k });
      }
    }
    // the moving piece
    let x, y, lift = 0;
    const seg = anim.segs.find((s) => el < s.t1) || null;
    if (seg && el >= seg.t0) {
      const k = easeInOut(Math.min(1, (el - seg.t0) / (seg.t1 - seg.t0)));
      const [ax, ay] = sqXY(seg.a), [bx2, by2] = sqXY(seg.b);
      x = ax + (bx2 - ax) * k; y = ay + (by2 - ay) * k;
      lift = seg.jump ? Math.sin(k * Math.PI) * 1.4 : 0.25 * Math.sin(k * Math.PI);
    } else if (seg) {
      [x, y] = sqXY(seg.a);
    } else {
      [x, y] = sqXY(anim.m.to);
    }
    const crownK = anim.m.crown ? Math.max(0, Math.min(1, (el - anim.crownT0) / CROWN_MS)) : null;
    // a man that is being crowned stays a plain man until the crown drops in
    drawPiece(g, x, y - lift * cell * 0.25, pr, anim.piece, { lift: Math.min(1, lift), scale: 1 + lift * 0.08, crown: anim.m.crown && el >= anim.crownT0 ? crownK : null });
  }
  function stepAnim(now) {
    if (!anim) return;
    const el = Math.max(0, now - anim.start);
    for (const [k, s] of anim.segs.entries()) {
      if (el >= s.t1 && !anim.fired.has(k)) {
        anim.fired.add(k);
        if (s.jump) { G.sfx('point'); const [x, y] = sqXY(s.cap); burst(x, y, SIDE[R.owner(anim.board[s.cap])].main, 16); }
        else G.sfx('drop');
        if (s.jump && k === anim.segs.length - 1) setTimeout(() => G.sfx('drop'), 40);
      }
    }
    if (anim.m.crown && el >= anim.crownT0 + CROWN_MS * 0.55 && !anim.fired.has('crown')) {
      anim.fired.add('crown');
      G.sfx('coin');
      const [x, y] = sqXY(anim.m.to);
      burst(x, y - cell * 0.2, '#fde047', 22, 'spark');
    }
    if (el >= anim.total) {
      const done = anim.done;
      anim = null;
      nextAnim();
      if (done) done();
      renderStatus();
    }
  }
  function burst(x, y, col, n, kind) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 180;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, a: Math.random() * 6, va: (Math.random() - 0.5) * 10, s: kind === 'spark' ? 1.5 + Math.random() * 2.5 : 4 + Math.random() * 5, col, life: 0.7 + Math.random() * 0.4, kind, g: kind === 'spark' ? 120 : 420 });
    }
  }
  function confetti() {
    if (reduceMotion) return;
    const cols = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899'];
    for (let i = 0; i < 140; i++) {
      particles.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 900, vy: -300 - Math.random() * 650,
        a: Math.random() * 6, va: (Math.random() - 0.5) * 14, s: 7 + Math.random() * 8, col: cols[i % cols.length], life: 1.6 + Math.random(), g: 600 });
    }
  }

  let lastT = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
    stepAnim(t);
    for (const p of particles) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.99; p.a += (p.va || 0) * dt; p.life -= dt * (p.kind ? 1.2 : 0.5); }
    particles = particles.filter((p) => p.life > 0 && p.y < H + 40);
    draw(t);
  }

  // ---------- Turn logic ----------
  function mySide() {
    if (mode === 'multi') return multi ? multi.myIdx : -1;
    if (mode === 'solo') return 0;
    return game.turn;
  }
  function canMove() {
    if (mode === 'menu' || game.winner != null || anim || thinking || busy || G.modalOpen()) return false;
    if (mode === 'solo') return game.turn === 0;
    if (mode === 'multi') return !!multi && multi.myIdx === game.turn && multi.present;
    return true;
  }
  function candidates() {
    if (sel < 0) return [];
    const p = partial || [sel];
    return moves.filter((m) => m.from === sel && p.every((s, k) => m.path[k] === s));
  }

  function onSquare(i) {
    if (!canMove() || i < 0) return;
    const side = game.turn;
    if (sel >= 0) {
      const cands = candidates();
      const step = (partial || [sel]).length;
      const viaStep = cands.filter((m) => m.path[step] === i);
      if (viaStep.length) {
        if (viaStep.length === 1 || viaStep.every((m) => m.path.length === step + 1)) { doMove(viaStep[0]); return; }
        partial = (partial || [sel]).concat(i);
        G.sfx('click');
        renderStatus();
        return;
      }
      const ending = cands.filter((m) => m.to === i);
      if (ending.length === 1) { doMove(ending[0]); return; }
      if (i === sel) { partial = [sel]; renderStatus(); return; }      // tapping it again starts its path over
    }
    if (board[i] && R.owner(board[i]) === side) {
      if (moves.some((m) => m.from === i)) { sel = i; partial = [i]; G.sfx('click'); renderStatus(); return; }
      G.sfx('wrong'); shakeStatus();
      if (moves.length && moves[0].caps.length) { flashForcedAt = performance.now(); G.toast('You have to jump! Look for the glowing piece.'); }
      return;
    }
    if (sel >= 0) { G.sfx('wrong'); shakeStatus(); }
  }

  function doMove(m) {
    const before = game;
    const startBoard = board.slice();
    if (mode === 'solo') undoStack.push(before);
    const next = R.play(game, m);
    hoverSq = -1;
    setGame(next);
    queueAnim(startBoard, m, settled);
    if (mode === 'multi') commitMove(before.seq, 0);
  }

  function settled() {
    renderStatus();
    if (game.winner != null) { celebrate(); return; }
    if (mode === 'solo' && game.turn === 1) computerTurn();
  }

  function computerTurn() {
    if (thinking) return;
    thinking = true;
    renderStatus();
    const started = performance.now();
    const gid = game.gid, seq = game.seq;
    setTimeout(() => {
      if (mode !== 'solo' || game.gid !== gid || game.seq !== seq || game.winner != null) { thinking = false; renderStatus(); return; }
      const m = R.computerMove(board, 1, level);
      const wait = Math.max(0, 520 - (performance.now() - started));
      setTimeout(() => {
        thinking = false;
        if (mode !== 'solo' || game.gid !== gid || game.seq !== seq || !m) { renderStatus(); return; }
        const startBoard = board.slice();
        setGame(R.play(game, m));
        queueAnim(startBoard, m, settled);
      }, wait);
    }, 60);
  }

  function celebrate() {
    winAt = performance.now();
    renderStatus();
    const w = game.winner;
    const iWon = w !== 'draw' && ((mode === 'solo' && w === 0) || (mode === 'multi' && multi && w === multi.myIdx) || mode === 'local');
    if (w === 'draw') G.sfx('score');
    else if (iWon) { G.sfx('win'); confetti(); } else G.sfx('lose');
    const key = mode + ':' + game.gid + ':' + game.seq;
    if (overFor === key) return;
    overFor = key;
    setTimeout(() => { if (overFor === key) finishCard(); }, w === 'draw' ? 900 : 1500);
  }

  function reasonText() {
    const w = game.winner, names = sideNames();
    switch (game.reason) {
      case 'resign': return `${names[1 - w]} resigned.`;
      case 'agreed': return 'Both players agreed to a draw.';
      case 'quiet': return '40 moves each without a capture.';
      case 'captured': return `All of ${names[1 - w]}’s pieces were captured.`;
      case 'blocked': return `${names[1 - w]} had no moves left.`;
      default: return '';
    }
  }
  function sideNames() {
    if (mode === 'multi' && multi) return game.players.slice(0, 2);
    if (mode === 'solo') return ['You', 'The computer'];
    return ['Red', 'White'];
  }

  function finishCard() {
    const w = game.winner;
    if (w == null) return;
    const names = sideNames();
    if (mode === 'multi' && multi) {
      const title = w === 'draw' ? 'It’s a draw!' : `${names[w]} wins!`;
      G.gameOver({ title, detail: reasonText() || `${names[0]} (red) vs ${names[1]} (white)`, score: w === multi.myIdx ? 1 : 0 });
      return;
    }
    if (mode === 'solo') {
      if (w === 0 && level !== 'easy') { G.gameOver({ title: 'You win!', score: 1, again: newGame }); return; }
      if (w === 0) { resultCard('You win!', 'You beat the Easy computer! Beat Medium or Hard to earn a win on the family leaderboard.', `<div class="cg-hero gold">${G.icon('trophy', 28)}</div>`); return; }
      if (w === 'draw') { resultCard('It’s a draw!', reasonText(), `<div class="cg-hero">${G.icon('handshake', 28)}</div>`); return; }
      G.gameOver({ title: 'The computer wins', score: 0, again: newGame });
      return;
    }
    resultCard(w === 'draw' ? 'It’s a draw!' : `${SIDE[w].name} wins!`, reasonText() + ' Pass the phone and play again.',
      w === 'draw' ? `<div class="cg-hero">${G.icon('handshake', 28)}</div>` : `<div class="cg-hero plain">${pieceDot(w, true).replace('ck-dot', 'ck-dot big')}</div>`);
  }

  function resultCard(title, text, hero) {
    const card = G.modal(`${hero || ''}<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="cg-row col"><button type="button" class="primary" data-a="again">Play again</button><button type="button" data-a="menu">Change game</button></div>`);
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      G.closeModal();
      if (b.dataset.a === 'again') newGame(); else showMenu();
    });
  }

  function confirmBox(title, text, yes, fn) {
    const card = G.modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="cg-row"><button type="button" data-cg="close">Cancel</button><button type="button" class="primary" data-a="yes">${esc(yes)}</button></div>`);
    card.querySelector('[data-a="yes"]').addEventListener('click', () => { G.closeModal(); fn(); });
  }

  function newGame() {
    G.closeModal();
    if (mode === 'multi') return;
    undoStack = [];
    overFor = null; anim = null; animQ = []; particles = [];
    setGame(R.newGame(mode === 'solo' ? ['You', 'Computer'] : ['Red', 'White'], Date.now() % 1e9));
  }

  // ---------- Draws and resigning ----------
  function offerDraw() {
    if (game.winner != null || anim) return;
    if (mode === 'local') {
      confirmBox('Agree to a draw?', 'If both players agree, the game ends in a draw.', 'Yes, it’s a draw', () => { setGame(R.agreeDraw(game)); celebrate(); });
      return;
    }
    if (mode === 'solo') {
      if (thinking) return;
      const v = R.judge(board, 1);
      if (v <= 25) { G.toast('The computer agrees to a draw.'); setGame(R.agreeDraw(game)); celebrate(); }
      else { G.sfx('wrong'); G.toast('The computer wants to keep playing!'); }
      return;
    }
    if (mode === 'multi' && multi && multi.myIdx >= 0 && game.offer == null && multi.present) {
      const before = game;
      game = Object.assign({}, game, { offer: multi.myIdx, declined: null, seq: game.seq + 1 });
      renderStatus();
      G.sfx('click');
      commitMove(before.seq, 0);
    }
  }
  function answerOffer(yes) {
    if (!(mode === 'multi' && multi && game.offer != null && game.offer !== multi.myIdx)) return;
    const before = game;
    if (yes) setGame(R.agreeDraw(game));
    else { game = Object.assign({}, game, { offer: null, declined: { by: multi.myIdx, seq: game.seq + 1 }, seq: game.seq + 1 }); renderStatus(); }
    G.sfx('click');
    commitMove(before.seq, 0).then(() => { if (game.winner != null) celebrate(); });
  }
  function resign() {
    if (game.winner != null) return;
    if (mode === 'multi') {
      if (!multi || multi.myIdx < 0) return;
      confirmBox('Resign this game?', `${game.players[1 - multi.myIdx]} will win.`, 'Resign', () => {
        const before = game;
        setGame(R.resign(game, multi.myIdx));
        commitMove(before.seq, 0).then(() => { if (game.winner != null) celebrate(); });
      });
      return;
    }
    const side = mode === 'solo' ? 0 : game.turn;
    confirmBox('Resign this game?', mode === 'solo' ? 'The computer will win.' : `${SIDE[side].name} gives up and ${SIDE[1 - side].name} wins.`, 'Resign', () => { thinking = false; setGame(R.resign(game, side)); celebrate(); });
  }
  function undo() {
    if (mode !== 'solo' || anim || thinking || !undoStack.length || game.winner != null) return;
    G.sfx('flip');
    setGame(undoStack.pop());
  }

  // ---------- Multiplayer ----------
  async function commitMove(baseSeq, attempt) {
    busy = true;
    renderStatus();
    const shared = game;
    let ok = false;
    try { ok = await G.turns.commit(shared, { done: shared.winner != null, quiet: true }); } catch (e) { ok = false; }
    if (ok) { busy = false; renderStatus(); return true; }
    const fresh = G.turns.shared();
    // The core may have held a stale copy (a poll racing our last move): if the board it now has is the
    // one we moved from, send the move again.
    if (attempt < 2 && fresh && multi && fresh.gid === multi.gid && fresh.seq === baseSeq) {
      await new Promise((r) => setTimeout(r, 150));
      return commitMove(baseSeq, attempt + 1);
    }
    busy = false;
    if (fresh) applyShared(fresh, true);
    else renderStatus();
    return false;
  }

  function applyShared(s, force) {
    if (!s || typeof s.board !== 'string') return;
    if (!multi || s.gid !== multi.gid) {
      multi = { gid: s.gid, myIdx: -1, present: true };
      anim = null; animQ = []; overFor = null; particles = [];
      multi.myIdx = (s.players || []).indexOf(G.me());
      layout();
      setGame(s);
      if (s.winner != null) celebrate();
      return;
    }
    multi.myIdx = (s.players || []).indexOf(G.me());
    if (!force && s.seq <= game.seq) return;
    const prev = game;
    const oneMore = s.hist && prev.hist && s.hist.length === prev.hist.length + 1 && s.last && s.hist.slice(0, -1).join() === prev.hist.join();
    const startBoard = board.slice();
    // someone offered / declined a draw
    if (s.offer != null && s.offer !== prev.offer && s.offer !== multi.myIdx) { G.sfx('tick'); }
    if (s.declined && (!prev.declined || prev.declined.seq !== s.declined.seq) && s.declined.by !== multi.myIdx && prev.offer === multi.myIdx) G.toast('Draw declined. Keep playing!');
    setGame(s);
    if (oneMore) {
      const m = { from: s.last.path[0], to: s.last.path[s.last.path.length - 1], path: s.last.path, caps: s.last.caps, crown: s.last.crown };
      queueAnim(startBoard, m, settled);
    } else {
      anim = null; animQ = [];
      if (s.winner != null) celebrate();
    }
  }

  // keep an eye on people leaving mid-game
  setInterval(() => {
    if (mode !== 'multi' || !multi) return;
    const s = G.session();
    const present = !s || game.players.every((n) => s.players.includes(n));
    if (present !== multi.present) { multi.present = present; renderStatus(); }
  }, 1000);

  // ---------- UI ----------
  function renderStatus() {
    if (!statusEl) return;
    const names = mode === 'multi' && multi ? game.players.map((n, i) => (i === multi.myIdx ? 'You' : n)) : mode === 'solo' ? ['You', 'Computer'] : ['Red', 'White'];
    const cnt = R.count(board);
    const chip = (side) => {
      const left = cnt[side].men + cnt[side].kings;
      return `<span class="ck-chip${game.winner == null && game.turn === side && mode !== 'menu' ? ' on' : ''}" style="--c:${SIDE[side].main}">${pieceDot(side)}<b>${esc(names[side])}</b><em title="Pieces left">${left}</em></span>`;
    };
    let msg = '', cls = '';
    const w = game.winner;
    const forced = moves.length && moves[0].caps.length;
    if (w === 'draw') { msg = 'It’s a draw!'; cls = 'end'; }
    else if (w != null) {
      cls = 'end';
      if (mode === 'solo') msg = w === 0 ? 'You win!' : 'The computer wins';
      else if (mode === 'multi') msg = w === multi.myIdx ? 'You win!' : `${game.players[w]} wins!`;
      else msg = `${SIDE[w].name} wins!`;
    } else if (mode === 'solo') {
      if (game.turn === 0) { msg = forced ? 'You must jump!' : 'Your turn'; cls = 'mine'; } else msg = 'Computer is thinking…';
    } else if (mode === 'local') { msg = `${SIDE[game.turn].name}’s turn${forced ? ' – jump!' : ''}`; cls = 'mine'; }
    else if (mode === 'multi' && multi) {
      if (!multi.present) { const s = G.session(); const gone = game.players.filter((n) => s && !s.players.includes(n)); msg = `${gone.join(' & ') || 'Someone'} left the game`; cls = 'end'; }
      else if (multi.myIdx < 0) msg = `${game.players[game.turn]}’s turn`;
      else if (game.turn === multi.myIdx) { msg = forced ? 'Your turn – you must jump!' : 'Your turn'; cls = 'mine'; }
      else msg = `Waiting for ${game.players[game.turn]}…`;
    }
    const quietLeft = Math.ceil((R.QUIET_LIMIT - (game.quiet || 0)) / 2);
    const quietNote = w == null && mode !== 'menu' && (game.quiet || 0) >= 40 ? `<span class="ck-quiet">${G.icon('clock', 14)}Draw in ${quietLeft} move${quietLeft === 1 ? '' : 's'} without a capture</span>` : '';
    const top = flip() ? 0 : 1;
    statusEl.innerHTML = `<div class="ck-players">${chip(top)}<span class="vs">vs</span>${chip(1 - top)}</div>` +
      `<div class="ck-msg ${cls}" style="--c:${SIDE[w != null && w !== 'draw' ? w : game.turn].main}" aria-live="polite">${pieceDot(w != null && w !== 'draw' ? w : game.turn)}<span>${esc(msg)}</span></div>${quietNote}`;
    // draw offers
    let offer = '';
    if (mode === 'multi' && multi && w == null && game.offer != null) {
      if (game.offer === multi.myIdx) offer = `<div class="ck-offer">${G.icon('handshake', 18)}<span>You offered a draw. Waiting for ${esc(game.players[1 - multi.myIdx])}…</span></div>`;
      else if (multi.myIdx >= 0) offer = `<div class="ck-offer ask">${G.icon('handshake', 18)}<span><b>${esc(game.players[game.offer])}</b> offers a draw</span><button type="button" class="ck-btn primary" data-a="accept">Accept</button><button type="button" class="ck-btn" data-a="decline">No thanks</button></div>`;
      else offer = `<div class="ck-offer">${G.icon('handshake', 18)}<span>${esc(game.players[game.offer])} offered a draw</span></div>`;
    }
    offerEl.innerHTML = offer;
    offerEl.hidden = !offer;
    // controls
    let btns = '';
    const over = w != null;
    if (mode === 'solo' || mode === 'local') {
      btns += `<button type="button" class="ck-btn" data-a="menu">${G.icon('back', 17)}<span>Menu</span></button>`;
      if (mode === 'solo') btns += `<button type="button" class="ck-btn" data-a="undo"${undoStack.length && !over ? '' : ' disabled'}>${G.icon('undo', 17)}<span>Undo</span></button>`;
      if (!over) btns += `<button type="button" class="ck-btn" data-a="draw">${G.icon('handshake', 17)}<span>Draw</span></button><button type="button" class="ck-btn" data-a="resign">${G.icon('flag', 17)}<span>Resign</span></button>`;
      btns += `<button type="button" class="ck-btn primary" data-a="restart">${G.icon('again', 17)}<span>New</span></button>`;
    } else if (mode === 'multi' && multi) {
      if (multi.myIdx >= 0 && !over && multi.present) {
        btns += `<button type="button" class="ck-btn" data-a="draw"${game.offer != null ? ' disabled' : ''}>${G.icon('handshake', 17)}<span>Offer draw</span></button>`;
        btns += `<button type="button" class="ck-btn" data-a="resign">${G.icon('flag', 17)}<span>Resign</span></button>`;
      } else btns += `<button type="button" class="ck-btn" data-a="lobby">${G.icon('users', 17)}<span>Players</span></button>`;
    }
    controlsEl.innerHTML = btns;
    controlsEl.hidden = !btns;
    const lvl = $('.ck-level', root);
    if (lvl) { lvl.hidden = mode !== 'solo'; lvl.innerHTML = mode === 'solo' ? `${pips(level)}${LEVELS[level].label}` : ''; }
  }
  function shakeStatus() { const m = $('.ck-msg', statusEl); if (m) { m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); } }

  function renderHist() {
    if (!histEl) return;
    const h = game.hist || [];
    if (!h.length) { histEl.innerHTML = `<span class="ck-hist-empty">${G.icon('route', 15)}Moves will appear here</span>`; return; }
    let html = '';
    for (let i = 0; i < h.length; i += 2) {
      const lastIdx = h.length - 1;
      html += `<li><b>${i / 2 + 1}.</b><span class="s0${i === lastIdx ? ' last' : ''}">${h[i]}</span>${h[i + 1] ? `<span class="s1${i + 1 === lastIdx ? ' last' : ''}">${h[i + 1]}</span>` : ''}</li>`;
    }
    histEl.innerHTML = `<ol>${html}</ol>`;
    const ol = histEl.firstChild;
    ol.scrollTop = ol.scrollHeight; ol.scrollLeft = ol.scrollWidth;
  }

  function showMenu() {
    mode = 'menu';
    G.closeModal();
    anim = null; animQ = []; thinking = false;
    setGame(R.newGame(['Red', 'White'], 1));
    menuEl.hidden = false;
    menuEl.querySelectorAll('[data-level]').forEach((b) => b.classList.toggle('sel', b.dataset.level === level));
    layout();
    renderStatus();
  }
  function startSolo(lv) {
    level = lv;
    try { localStorage.setItem('chow_checkers_level', lv); } catch (e) { /* ignore */ }
    mode = 'solo';
    menuEl.hidden = true;
    layout();
    newGame();
  }
  function startLocal() { mode = 'local'; menuEl.hidden = true; layout(); newGame(); }

  function build(ctx) {
    root = ctx.root;
    root.classList.add('ck-stage');
    root.innerHTML = `<div class="ck-wrap"><div class="ck-status"></div><div class="ck-offerbox" hidden></div>
      <div class="ck-main"><div class="ck-box"><canvas aria-label="Checkers board" role="img"></canvas></div><div class="ck-side"><h3>${G.icon('route', 15)}Moves<span class="ck-level" hidden></span></h3><div class="ck-hist"></div></div></div>
      <div class="ck-controls" hidden></div></div>
      <div class="ck-menu" hidden><div class="ck-menu-card">
        <div class="ck-logo" aria-hidden="true"><i class="ck-dot big s0"></i><i class="ck-dot big s1 k"></i><i class="ck-dot big s0 k"></i></div>
        <h2>Checkers</h2><p>Hop over the other pieces, crown your kings and clear the board!</p>
        <div class="ck-more"><button type="button" class="ck-family" data-a="family">${G.icon('users', 22)}<span>Play with the family</span></button>
        <button type="button" data-a="local">${G.icon('gamepad', 20)}<span>2 players on this device</span></button></div>
        <h3>Or play the computer</h3>
        <div class="ck-levels">${Object.entries(LEVELS).map(([k, L]) => `<button type="button" data-level="${k}">${pips(k)}${L.label}</button>`).join('')}</div>
      </div></div>`;
    statusEl = $('.ck-status', root); offerEl = $('.ck-offerbox', root); boxEl = $('.ck-box', root); canvas = $('canvas', root); cx = canvas.getContext('2d');
    controlsEl = $('.ck-controls', root); menuEl = $('.ck-menu', root); histEl = $('.ck-hist', root);
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.level) startSolo(b.dataset.level);
      else if (b.dataset.a === 'local') startLocal();
      else if (b.dataset.a === 'family') G.openLobby();
    });
    const onBtn = (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b || b.disabled) return;
      const a = b.dataset.a;
      if (a !== 'accept' && a !== 'decline') G.sfx('click');
      if (a === 'menu') showMenu();
      else if (a === 'restart') { if (game.winner == null && game.hist.length) confirmBox('Start a new game?', 'This game will be lost.', 'New game', newGame); else newGame(); }
      else if (a === 'undo') undo();
      else if (a === 'draw') offerDraw();
      else if (a === 'resign') resign();
      else if (a === 'accept') answerOffer(true);
      else if (a === 'decline') answerOffer(false);
      else if (a === 'lobby') G.openLobby();
    };
    controlsEl.addEventListener('click', onBtn);
    offerEl.addEventListener('click', onBtn);
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => {
      if (G.countingDown()) return;
      keyActive = false;
      const [x, y] = pos(e);
      onSquare(sqAt(x, y));
    });
    canvas.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; const [x, y] = pos(e); hoverSq = sqAt(x, y); canvas.style.cursor = hoverSq >= 0 && canMove() && (moves.some((m) => m.from === hoverSq) || candidates().some((m) => m.path.includes(hoverSq))) ? 'pointer' : 'default'; });
    canvas.addEventListener('pointerleave', () => { hoverSq = -1; });
    window.addEventListener('keydown', (e) => {
      if (G.modalOpen() || mode === 'menu') return;
      const k = e.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
        e.preventDefault();
        if (!keyActive || cursor < 0) { keyActive = true; cursor = sel >= 0 ? sel : (moves[0] ? moves[0].from : 36); return; }
        let r = cursor >> 3, c = cursor & 7;
        const s = flip() ? -1 : 1;
        if (k === 'ArrowUp') r -= s; if (k === 'ArrowDown') r += s; if (k === 'ArrowLeft') c -= s; if (k === 'ArrowRight') c += s;
        cursor = Math.max(0, Math.min(7, r)) * 8 + Math.max(0, Math.min(7, c));
      } else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (keyActive && cursor >= 0) onSquare(cursor); }
      else if (k === 'Escape') { sel = -1; partial = null; }
      else if ((k === 'z' || k === 'u') && mode === 'solo') undo();
    });
    new ResizeObserver(() => layout()).observe(boxEl);
    layout();
    showMenu();
    requestAnimationFrame(loop);
  }

  G.on('multiStart', (info) => {
    mode = 'multi';
    menuEl.hidden = true;
    multi = null;
    thinking = false; undoStack = [];
    if (info && info.shared) applyShared(info.shared, true);
  });
  G.on('shared', (s) => { if (mode === 'multi') applyShared(s); });
  G.on('multiEnd', () => { multi = null; showMenu(); });

  G.mount({
    id: 'checkers', title: 'Checkers', mode: 'turns', minPlayers: 2, maxPlayers: 2, scoreLabel: 'wins',
    help: '<ul><li>Pieces move one step <b>diagonally forward</b> on the dark squares.</li>' +
      '<li><b>Jump</b> over an opponent’s piece to capture it. If you can jump, you <b>must</b> – the pieces that can are glowing. Keep jumping if you can!</li>' +
      `<li>Reach the far side to become a <b>king</b> ${G.icon('crown', 15)}: kings move forwards and backwards.</li>` +
      '<li>Win by capturing every piece or leaving your opponent with no moves. After 40 moves each without a capture it’s a draw, and you can also offer a draw or resign.</li>' +
      '<li>Tap a piece to see where it can go, then tap the green dot. On a keyboard use the arrow keys and Enter.</li>' +
      `<li>${G.icon('users', 17)} <b>Play with the family</b>: Red moves first. Every win counts on the leaderboard (against the computer, wins on Medium and Hard count).</li></ul>`,
    initialShared: (players, seed) => R.newGame(players, seed),
    onReady: build
  });

  // for tests
  window.__checkers = {
    state: () => ({ mode, level, game, sel, partial, anim: !!anim || animQ.length > 0, thinking, busy, multi, moves: moves.map((m) => m.path.slice()) }),
    sqXY: (i) => { const r = canvas.getBoundingClientRect(); const [x, y] = sqXY(i); return [r.left + x, r.top + y]; },
    rules: R
  };
})();
