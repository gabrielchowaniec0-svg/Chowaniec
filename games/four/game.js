// Four in a Row: Connect Four against the computer (Easy / Medium / Hard), two players on one device,
// or with the family through ChowGames turns (players[0] is red and goes first).
(function () {
  'use strict';

  const ROWS = 6, COLS = 7;
  const DISC = [
    { name: 'Red', main: '#ef4444', light: '#ff9b8f', dark: '#b91c1c', rim: '#991b1b' },
    { name: 'Yellow', main: '#facc15', light: '#fff6a8', dark: '#d19a06', rim: '#a16207' }
  ];
  const LEVELS = {
    easy: { label: 'Easy', n: 1, depth: 2, mistake: 0.45, ms: 0 },
    medium: { label: 'Medium', n: 2, depth: 4, mistake: 0.08, ms: 0 },
    hard: { label: 'Hard', n: 3, depth: 10, mistake: 0, ms: 650 }
  };
  const G = window.ChowGames;
  // A little 'signal strength' meter: 1, 2 or 3 bars lit for Easy, Medium, Hard.
  const pips = (k) => `<span class="f4-pips l${LEVELS[k].n}" aria-hidden="true"><i></i><i></i><i></i></span>`;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Rules ----------
  const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const dropRow = (board, c) => { for (let r = ROWS - 1; r >= 0; r--) if (board[r][c] == null) return r; return -1; };
  const isFull = (board) => board[0].every((v) => v != null);
  function findWin(board, r, c) {
    const p = board[r][c];
    if (p == null) return null;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells = [[r, c]];
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === p) { cells.push([rr, cc]); rr += dr * s; cc += dc * s; }
      }
      if (cells.length >= 4) {
        cells.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
        return cells.slice(0, 4);
      }
    }
    return null;
  }

  // ---------- Computer player: negamax with alpha-beta on a flat board ----------
  const ORDER = [3, 2, 4, 1, 5, 0, 6];
  const WINDOWS = (() => {
    const w = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const er = r + dr * 3, ec = c + dc * 3;
        if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
        w.push([0, 1, 2, 3].map((k) => (r + dr * k) * COLS + (c + dc * k)));
      }
    }
    return w;
  })();
  const WIN = 1000000;

  function evaluate(b, me) {
    const op = 3 - me;
    let s = 0;
    for (let r = 0; r < ROWS; r++) { const v = b[r * COLS + 3]; if (v === me) s += 4; else if (v === op) s -= 4; }
    for (const w of WINDOWS) {
      let m = 0, o = 0;
      for (let k = 0; k < 4; k++) { const v = b[w[k]]; if (v === me) m++; else if (v === op) o++; }
      if (m && o) continue;
      if (m === 3) s += 12; else if (m === 2) s += 3;
      else if (o === 3) s -= 14; else if (o === 2) s -= 3;
    }
    return s;
  }
  function flatWin(b, idx) {
    const p = b[idx], r = (idx / COLS) | 0, c = idx % COLS;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let n = 1;
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) { n++; rr += dr * s; cc += dc * s; }
      }
      if (n >= 4) return true;
    }
    return false;
  }
  function search(b, h, me, depth, alpha, beta, ply, deadline, stats) {
    if ((++stats.n & 1023) === 0 && deadline && performance.now() > deadline) stats.out = true;
    if (stats.out) return 0;
    let any = false;
    for (const c of ORDER) {
      if (h[c] < 0) continue;
      any = true;
      const idx = h[c] * COLS + c;
      b[idx] = me;
      if (flatWin(b, idx)) { b[idx] = 0; return WIN - ply; }
      b[idx] = 0;
    }
    if (!any) return 0;
    if (depth === 0) return evaluate(b, me);
    let best = -Infinity;
    for (const c of ORDER) {
      if (h[c] < 0) continue;
      const idx = h[c] * COLS + c;
      b[idx] = me; h[c]--;
      const v = -search(b, h, 3 - me, depth - 1, -beta, -alpha, ply + 1, deadline, stats);
      b[idx] = 0; h[c]++;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }
  // Scores each legal column for player `who` (0|1) at the given depth. Returns [{c, v}] best first.
  function rankMoves(board, who, depth, deadline) {
    const b = new Int8Array(ROWS * COLS), h = new Int8Array(COLS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) b[r * COLS + c] = board[r][c] == null ? 0 : board[r][c] + 1;
    for (let c = 0; c < COLS; c++) h[c] = dropRow(board, c);
    const me = who + 1, stats = { n: 0, out: false }, out = [];
    for (const c of ORDER) {
      if (h[c] < 0) continue;
      const idx = h[c] * COLS + c;
      b[idx] = me; h[c]--;
      const v = flatWin(b, idx) ? WIN : -search(b, h, 3 - me, depth - 1, -Infinity, Infinity, 1, deadline, stats);
      b[idx] = 0; h[c]++;
      if (stats.out) return null;
      out.push({ c, v });
    }
    return out.sort((a, b2) => b2.v - a.v);
  }
  function computerMove(board, who, levelKey) {
    const L = LEVELS[levelKey];
    const legal = ORDER.filter((c) => dropRow(board, c) >= 0);
    let ranked;
    if (L.ms) {
      const deadline = performance.now() + L.ms;
      ranked = rankMoves(board, who, 2, 0);
      for (let d = 4; d <= L.depth; d += 1) {
        const r = rankMoves(board, who, d, deadline);
        if (!r) break;
        ranked = r;
        if (ranked[0].v > WIN / 2) break;
      }
    } else ranked = rankMoves(board, who, L.depth, 0);
    if (Math.random() < L.mistake) {
      // A friendly mistake: any move that isn't an instant giveaway on Medium; anything goes on Easy.
      const pool = levelKey === 'easy' ? legal : ranked.filter((m) => m.v > -WIN / 2).map((m) => m.c);
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    const top = ranked.filter((m) => m.v === ranked[0].v);
    return top[Math.floor(Math.random() * top.length)].c;
  }

  // ---------- State ----------
  let root, wrap, canvas, cx, boxEl, statusEl, menuEl, controlsEl;
  let W = 0, H = 0, dpr = 1, cell = 60, bx = 0, by = 0, boardLayer = null;
  let mode = 'menu';          // menu | solo | local | multi
  let level = 'easy';
  try { level = localStorage.getItem('chow_four_level') || 'easy'; if (!LEVELS[level]) level = 'easy'; } catch (e) { /* ignore */ }
  let board = emptyBoard(), turn = 0, winner = null, winCells = null, last = null;
  let anims = [], particles = [], hoverCol = -1, keyCol = 3, thinking = false, overFor = null, winAt = 0;
  let multi = null;           // { players, gid, seq, myIdx, committing }
  let busy = false;

  // ---------- Layout and drawing ----------
  function layout() {
    const r = boxEl.getBoundingClientRect();
    W = Math.max(1, Math.floor(r.width)); H = Math.max(1, Math.floor(r.height));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    cell = Math.max(16, Math.min(92, Math.floor(Math.min((W - 12) / (COLS + 0.44), (H - 10) / (ROWS + 0.44 + 1.15)))));
    const bw = cell * (COLS + 0.44), bh = cell * (ROWS + 0.44);
    bx = Math.round((W - bw) / 2);
    by = Math.round(cell * 1.1 + Math.max(0, H - bh - cell * 1.1) * 0.38);
    buildBoardLayer(bw, bh);
  }
  const colX = (c) => bx + cell * (0.22 + c + 0.5);
  const rowY = (r) => by + cell * (0.22 + r + 0.5);
  const holeR = () => cell * 0.4;

  function rr(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
  }

  function buildBoardLayer(bw, bh) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(bw * dpr) + 2; c.height = Math.ceil(bh * dpr) + 2;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const rad = cell * 0.36;
    const grad = g.createLinearGradient(0, 0, 0, bh);
    grad.addColorStop(0, '#3b82f6'); grad.addColorStop(0.5, '#2563eb'); grad.addColorStop(1, '#1e40af');
    rr(g, 0, 0, bw, bh, rad); g.fillStyle = grad; g.fill();
    // glossy sheen across the top
    const sheen = g.createLinearGradient(0, 0, 0, bh * 0.55);
    sheen.addColorStop(0, 'rgba(255,255,255,.38)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); rr(g, 0, 0, bw, bh, rad); g.clip();
    g.beginPath(); g.ellipse(bw * 0.5, -bh * 0.18, bw * 0.75, bh * 0.55, 0, 0, Math.PI * 2); g.fillStyle = sheen; g.fill();
    g.restore();
    // edge lines
    rr(g, 1.5, 1.5, bw - 3, bh - 3, rad - 1); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.28)'; g.stroke();
    rr(g, 0.5, 0.5, bw - 1, bh - 1, rad); g.lineWidth = 1; g.strokeStyle = 'rgba(15,23,80,.6)'; g.stroke();
    const hr = cell * 0.4;
    // hole bevels
    for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
      const x = cell * (0.22 + cc + 0.5), y = cell * (0.22 + r + 0.5);
      const bev = g.createLinearGradient(x, y - hr, x, y + hr);
      bev.addColorStop(0, 'rgba(10,20,80,.55)'); bev.addColorStop(1, 'rgba(255,255,255,.35)');
      g.beginPath(); g.arc(x, y, hr + cell * 0.045, 0, Math.PI * 2); g.fillStyle = bev; g.fill();
    }
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
      g.beginPath(); g.arc(cell * (0.22 + cc + 0.5), cell * (0.22 + r + 0.5), hr, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    const m = 30, sh = document.createElement('canvas');
    sh.width = Math.ceil((bw + m * 2) * dpr); sh.height = Math.ceil((bh + m * 2) * dpr);
    const sg = sh.getContext('2d');
    sg.scale(dpr, dpr);
    sg.shadowColor = 'rgba(0,0,0,.28)'; sg.shadowBlur = 18; sg.shadowOffsetY = 10;
    rr(sg, m + 4, m + 4, bw - 8, bh - 4, rad); sg.fillStyle = 'rgba(30,64,175,1)'; sg.fill();
    boardLayer = { c, w: bw, h: bh, sh, m };
  }

  function drawDisc(ctx, x, y, r, p, alpha) {
    const d = DISC[p];
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, d.light); g.addColorStop(0.45, d.main); g.addColorStop(1, d.dark);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 0.68, 0, Math.PI * 2); ctx.lineWidth = Math.max(1.5, r * 0.09); ctx.strokeStyle = d.rim; ctx.globalAlpha *= 0.55; ctx.stroke();
    ctx.globalAlpha = alpha != null ? alpha * 0.7 : 0.7;
    ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.38, r * 0.32, r * 0.17, -0.6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }

  function cssVar(name, fb) { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; }

  function draw(t) {
    const ctx = cx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!boardLayer) return;
    const r = holeR() + 1;
    // board shadow (pre-rendered)
    ctx.drawImage(boardLayer.sh, bx - boardLayer.m, by - boardLayer.m, boardLayer.sh.width / dpr, boardLayer.sh.height / dpr);
    // inside of the board (seen through the holes)
    ctx.save(); rr(ctx, bx + 2, by + 2, boardLayer.w - 4, boardLayer.h - 4, cell * 0.3); ctx.fillStyle = cssVar('--f4-hole', '#e8eefc'); ctx.fill(); ctx.restore();
    const animating = new Set(anims.map((a) => a.r * COLS + a.c));
    for (let rr2 = 0; rr2 < ROWS; rr2++) for (let c = 0; c < COLS; c++) {
      const p = board[rr2][c];
      if (p == null || animating.has(rr2 * COLS + c)) continue;
      drawDisc(ctx, colX(c), rowY(rr2), r, p);
    }
    for (const a of anims) {
      ctx.save();
      // above the board the disc is in the open; below the top edge it slides behind the board
      drawDisc(ctx, colX(a.c), a.y, r, a.p);
      ctx.restore();
    }
    ctx.drawImage(boardLayer.c, bx, by, boardLayer.c.width / dpr, boardLayer.c.height / dpr);
    // column highlight + preview disc
    const can = canDrop();
    let shown = false;
    const col = hoverCol >= 0 ? hoverCol : (keyActive && can ? keyCol : -1);
    if (can && col >= 0 && dropRow(board, col) >= 0) {
      ctx.save();
      rr(ctx, colX(col) - cell * 0.48, by + cell * 0.12, cell * 0.96, boardLayer.h - cell * 0.24, cell * 0.42);
      ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.stroke();
      ctx.restore();
      const bob = reduceMotion ? 0 : Math.sin(t / 220) * cell * 0.06;
      drawDisc(ctx, colX(col), by - cell * 0.58 + bob, r, myColour(), 0.95);
      shown = true;
      // a ghost where it will land
      const lr = dropRow(board, col);
      ctx.save(); ctx.beginPath(); ctx.arc(colX(col), rowY(lr), r * 0.86, 0, Math.PI * 2);
      ctx.setLineDash([cell * 0.09, cell * 0.08]); ctx.lineWidth = Math.max(2, cell * 0.05); ctx.strokeStyle = DISC[myColour()].main; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.restore();
    }
    if (can && !shown) {
      // whose disc is waiting: float it above the last column used so a tap target is obvious
      const c0 = dropRow(board, keyCol) >= 0 ? keyCol : ORDER.find((c) => dropRow(board, c) >= 0);
      const bob = reduceMotion ? 0 : Math.sin(t / 260) * cell * 0.08;
      if (c0 != null) drawDisc(ctx, colX(c0), by - cell * 0.58 + bob, r, myColour(), 0.6);
    }
    // winning four
    if (winCells && !anims.length) {
      const k = Math.min(1, (t - winAt) / 400);
      const pulse = 0.5 + 0.5 * Math.sin(t / 160);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.shadowColor = '#fff'; ctx.shadowBlur = cell * 0.4;
      for (const [wr, wc] of winCells) {
        ctx.beginPath(); ctx.arc(colX(wc), rowY(wr), r * (1.02 + 0.08 * pulse), 0, Math.PI * 2);
        ctx.lineWidth = cell * 0.09; ctx.strokeStyle = `rgba(255,255,255,${0.75 + 0.25 * pulse})`; ctx.stroke();
      }
      const [a0, a1] = [winCells[0], winCells[3]];
      const x0 = colX(a0[1]), y0 = rowY(a0[0]), x1 = colX(a1[1]), y1 = rowY(a1[0]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
      ctx.lineWidth = cell * 0.14; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
      ctx.restore();
    }
    // confetti
    for (const p of particles) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.globalAlpha = Math.min(1, p.life);
      ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
  }

  let lastT = 0;
  function frameLoop(t) {
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
    step(dt, t);
    draw(t);
    requestAnimationFrame(frameLoop);
  }

  function step(dt, t) {
    const g = cell * 75;
    for (const a of anims) {
      a.vy += g * dt; a.y += a.vy * dt;
      if (a.y >= a.ty) {
        a.y = a.ty;
        if (!a.hit) { a.hit = true; G.sfx('drop'); bumpBoard(); }
        a.vy = -a.vy * 0.32;
        a.bounces++;
        if (Math.abs(a.vy) < cell * 2.2 || a.bounces > 3) a.done = true;
      }
    }
    const finished = anims.filter((a) => a.done);
    if (finished.length) { anims = anims.filter((a) => !a.done); finished.forEach((a) => a.cb && a.cb()); }
    for (const p of particles) { p.vy += 600 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt; p.life -= dt * 0.5; }
    particles = particles.filter((p) => p.life > 0 && p.y < H + 40);
  }

  function bumpBoard() {
    if (reduceMotion) return;
    canvas.classList.remove('bump'); void canvas.offsetWidth; canvas.classList.add('bump');
  }

  function animateDrop(r, c, p, cb) {
    if (reduceMotion) { cb && cb(); G.sfx('drop'); return; }
    anims.push({ r, c, p, y: by - cell * 0.58, vy: cell * 4, ty: rowY(r), hit: false, bounces: 0, done: false, cb });
  }

  function confetti() {
    if (reduceMotion) return;
    const cols = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899'];
    for (let i = 0; i < 140; i++) {
      particles.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 900, vy: -300 - Math.random() * 650,
        a: Math.random() * 6, va: (Math.random() - 0.5) * 14, s: 7 + Math.random() * 8, col: cols[i % cols.length], life: 1.6 + Math.random() });
    }
  }

  // ---------- Turn logic ----------
  let keyActive = false;
  function myColour() {
    if (mode === 'multi' && multi) return multi.myIdx >= 0 ? multi.myIdx : turn;
    return turn;
  }
  function canDrop() {
    if (mode === 'menu' || winner != null || anims.length || thinking || busy || G.modalOpen()) return false;
    if (mode === 'solo') return turn === 0;
    if (mode === 'multi') return !!multi && multi.myIdx === turn && multi.present;
    return true;
  }

  function place(c, p) {
    const r = dropRow(board, c);
    if (r < 0) return null;
    board[r][c] = p;
    last = { r, c };
    const w = findWin(board, r, c);
    if (w) { winner = p; winCells = w; } else if (isFull(board)) winner = 'draw';
    else turn = 1 - p;
    return { r, c };
  }

  function onLanded() {
    if (winner != null) { celebrate(); return; }
    renderStatus();
    if (mode === 'solo' && turn === 1) computerTurn();
  }

  function celebrate() {
    winAt = performance.now();
    renderStatus();
    const iWon = winner !== 'draw' && ((mode === 'solo' && winner === 0) || (mode === 'multi' && multi && winner === multi.myIdx) || mode === 'local');
    if (winner === 'draw') G.sfx('score');
    else if (iWon) { G.sfx('win'); confetti(); }
    else { G.sfx('lose'); }
    const key = mode + ':' + (multi ? multi.gid : '') + ':' + JSON.stringify(board);
    if (overFor === key) return;
    overFor = key;
    setTimeout(() => finishCard(), winner === 'draw' ? 900 : 1700);
  }

  function finishCard() {
    if (winner == null) return;
    if (mode === 'multi' && multi) {
      const names = multi.players;
      const title = winner === 'draw' ? 'It’s a draw!' : `${names[winner] || DISC[winner].name} wins!`;
      const detail = `${names[0]} (red) vs ${names[1]} (yellow)`;
      G.gameOver({ title, detail, score: winner === multi.myIdx ? 1 : 0 });
      return;
    }
    if (mode === 'solo') {
      if (winner === 0 && level !== 'easy') { G.gameOver({ title: 'You win!', score: 1, again: newGame }); return; }
      if (winner === 0) {
        resultCard('You win!', 'You beat the Easy computer! Beat Medium or Hard to earn a win on the family leaderboard.', `<div class="cg-hero gold">${G.icon('trophy', 28)}</div>`);
        return;
      }
      if (winner === 'draw') { resultCard('It’s a draw!', 'So close! The board is full.', `<div class="cg-hero">${G.icon('handshake', 28)}</div>`); return; }
      G.gameOver({ title: 'The computer wins', score: 0, again: newGame });
      return;
    }
    if (mode === 'local') {
      resultCard(winner === 'draw' ? 'It’s a draw!' : `${DISC[winner].name} wins!`, 'Pass the phone and play again.',
        winner === 'draw' ? `<div class="cg-hero">${G.icon('handshake', 28)}</div>` : `<div class="cg-hero plain"><i class="f4-disc" style="--c:${DISC[winner].main}"></i></div>`);
    }
  }

  function resultCard(title, text, hero) {
    const card = G.modal(`${hero || ''}<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="cg-row col"><button type="button" class="primary" data-a="again">Play again</button><button type="button" data-a="menu">Change game</button></div>`, { onClose: () => {} });
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      G.closeModal();
      if (b.dataset.a === 'again') newGame(); else showMenu(mode === 'solo');
    });
  }

  function humanDrop(c) {
    if (!canDrop() || c < 0 || c >= COLS) return;
    if (dropRow(board, c) < 0) { G.sfx('wrong'); shakeStatus(); return; }
    G.sfx('click');
    if (mode === 'multi') { multiDrop(c); return; }
    const p = turn;
    const at = place(c, p);
    renderStatus();
    animateDrop(at.r, at.c, p, onLanded);
    if (hoverPointer !== 'mouse') hoverCol = -1;
  }

  function computerTurn() {
    thinking = true;
    renderStatus();
    const started = performance.now();
    setTimeout(() => {
      if (mode !== 'solo' || winner != null) { thinking = false; return; }
      const c = computerMove(board, 1, level);
      const wait = Math.max(0, 450 - (performance.now() - started));
      setTimeout(() => {
        if (mode !== 'solo' || winner != null) { thinking = false; return; }
        thinking = false;
        const at = place(c, 1);
        renderStatus();
        animateDrop(at.r, at.c, 1, onLanded);
      }, wait);
    }, 60);
  }

  function resetBoard() {
    board = emptyBoard(); turn = 0; winner = null; winCells = null; last = null; anims = []; particles = []; thinking = false; overFor = null;
  }
  function newGame() {
    G.closeModal();
    if (mode === 'multi') return;
    resetBoard();
    renderStatus();
  }

  // ---------- Multiplayer ----------
  function multiDrop(c) {
    const base = JSON.stringify({ board, turn, winner, last });
    const p = turn;
    const at = place(c, p);
    multi.seq += 1;
    renderStatus();
    animateDrop(at.r, at.c, p, onLanded);
    hoverCol = -1;
    commitMove(c, JSON.parse(base), multi.seq - 1, 0);
  }

  async function commitMove(c, before, baseSeq, attempt) {
    busy = true;
    const shared = toShared();
    let ok = false;
    try { ok = await G.turns.commit(shared, { done: shared.winner != null }); } catch (e) { ok = false; }
    if (ok) { busy = false; renderStatus(); return; }
    // The core may have been holding a stale copy (a poll that raced our last move). If the board it
    // now has is still the one we moved on, replay the move once more.
    const fresh = G.turns.shared();
    if (attempt < 2 && fresh && fresh.gid === multi.gid && fresh.seq === baseSeq) {
      await new Promise((r) => setTimeout(r, 150));
      return commitMove(c, before, baseSeq, attempt + 1);
    }
    busy = false;
    if (fresh) applyShared(fresh, true);
  }

  function toShared() {
    return { board, turn, winner, last, win: winCells, players: multi.players, gid: multi.gid, seq: multi.seq };
  }

  function applyShared(s, force) {
    if (!s || !Array.isArray(s.board)) return;
    if (!multi || s.gid !== multi.gid) {
      resetBoard();
      multi = { players: (s.players || []).slice(0, 2), gid: s.gid, seq: -1, myIdx: -1, present: true };
    }
    multi.myIdx = multi.players.indexOf(G.me());
    if (!force && s.seq <= multi.seq) return;
    // find the new disc so it can fall in
    const fresh = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (s.board[r][c] != null && board[r][c] == null) fresh.push({ r, c, p: s.board[r][c] });
    }
    const changedElsewhere = s.board.some((row, r) => row.some((v, c) => board[r][c] != null && v !== board[r][c]));
    multi.seq = s.seq;
    board = s.board.map((row) => row.slice());
    turn = s.turn; winner = s.winner; last = s.last; winCells = s.win || null;
    if (changedElsewhere) anims = [];
    const animate = fresh.length === 1 && !changedElsewhere;
    if (animate) animateDrop(fresh[0].r, fresh[0].c, fresh[0].p, onLanded);
    else if (winner != null) celebrate();
    renderStatus();
  }

  function initialShared(players, seed) {
    return { board: emptyBoard(), turn: 0, winner: null, last: null, win: null, players: players.slice(0, 2), gid: seed, seq: 0 };
  }

  // keep an eye on people leaving mid-game
  setInterval(() => {
    if (mode !== 'multi' || !multi) return;
    const s = G.session();
    const present = !s || multi.players.every((n) => s.players.includes(n));
    if (present !== multi.present) { multi.present = present; renderStatus(); }
  }, 1000);

  // ---------- UI ----------
  function chip(p, name, on) {
    return `<span class="f4-chip${on ? ' on' : ''}" style="--c:${DISC[p].main}"><i></i><b>${esc(name)}</b></span>`;
  }
  function renderStatus() {
    if (!statusEl) return;
    let names, msg, cls = '';
    if (mode === 'solo') names = ['You', 'Computer'];
    else if (mode === 'local') names = ['Red', 'Yellow'];
    else if (mode === 'multi' && multi) names = multi.players.map((n, i) => (i === multi.myIdx ? `${n} (you)` : n));
    else names = ['Red', 'Yellow'];
    if (winner === 'draw') { msg = 'It’s a draw!'; cls = 'end'; }
    else if (winner != null) {
      cls = 'end';
      if (mode === 'solo') msg = winner === 0 ? 'You win!' : 'The computer wins';
      else if (mode === 'multi') msg = winner === multi.myIdx ? 'You win!' : `${multi.players[winner]} wins!`;
      else msg = `${DISC[winner].name} wins!`;
    } else if (mode === 'solo') { msg = turn === 0 ? 'Your turn' : 'Computer is thinking…'; cls = turn === 0 ? 'mine' : ''; }
    else if (mode === 'local') { msg = `${DISC[turn].name}’s turn`; cls = 'mine'; }
    else if (mode === 'multi' && multi) {
      if (!multi.present) { const s = G.session(); const gone = multi.players.filter((n) => s && !s.players.includes(n)); msg = `${gone.join(' & ') || 'Someone'} left the game`; cls = 'end'; }
      else if (multi.myIdx < 0) msg = `${multi.players[turn]}’s turn`;
      else if (turn === multi.myIdx) { msg = 'Your turn'; cls = 'mine'; }
      else msg = `Waiting for ${multi.players[turn]}…`;
    }
    statusEl.innerHTML = `<div class="f4-players">${chip(0, names[0], winner == null && turn === 0)}<span class="vs">vs</span>${chip(1, names[1], winner == null && turn === 1)}</div>` +
      `<div class="f4-msg ${cls}" style="--c:${DISC[winner != null && winner !== 'draw' ? winner : turn].main}" aria-live="polite"><i></i><span>${esc(msg || '')}</span></div>`;
    controlsEl.hidden = mode === 'multi' || mode === 'menu';
    const lv = $('[data-a="level"]', controlsEl);
    if (lv) lv.innerHTML = mode === 'solo' ? `${pips(level)}<span>${LEVELS[level].label}</span>` : `${G.icon('users', 18)}<span>2 players</span>`;
  }
  function shakeStatus() { const m = $('.f4-msg', statusEl); if (m) { m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); } }

  // The computer player only appears when someone picks it: "Play the computer" opens the level choice.
  function showCpu(on) {
    const b = $('[data-a="cpu"]', menuEl);
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
    $('.f4-cpu', menuEl).hidden = !on;
  }
  function showMenu(cpu) {
    mode = 'menu';
    G.closeModal();
    resetBoard();
    menuEl.hidden = false;
    showCpu(!!cpu);
    menuEl.querySelectorAll('[data-level]').forEach((b) => b.classList.toggle('sel', b.dataset.level === level));
    renderStatus();
  }
  function startSolo(lv) {
    level = lv;
    try { localStorage.setItem('chow_four_level', lv); } catch (e) { /* ignore */ }
    mode = 'solo';
    menuEl.hidden = true;
    resetBoard();
    renderStatus();
  }
  function startLocal() { mode = 'local'; menuEl.hidden = true; resetBoard(); renderStatus(); }

  // ---------- Family first: the shared start-screen buttons (same look in every game) ----------
  // ffButtons({ solo, soloIcon, extra }) -> HTML: a big "Play with the family" button (data-ff="family")
  // and an optional secondary solo button (data-ff="solo"). Call ffStyle() once.
  function ffStyle() {
    if (document.getElementById('ff-style')) return;
    const s = document.createElement('style');
    s.id = 'ff-style';
    s.textContent = '.ff-actions{display:flex;flex-direction:column;align-items:stretch;gap:10px;width:100%;max-width:360px;margin:16px auto 0;}' +
      '.ff-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;border:0;border-radius:18px;font:inherit;line-height:1.15;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .12s,filter .12s,box-shadow .12s;}' +
      '.ff-btn:active{transform:translateY(3px) scale(.985);}' +
      '.ff-btn:focus-visible{outline:3px solid #60a5fa;outline-offset:3px;}' +
      '.ff-family{min-height:64px;padding:10px 20px;background:linear-gradient(180deg,#34d399,#16a34a);color:#fff;font-size:20px;font-weight:800;letter-spacing:.01em;text-shadow:0 1px 2px rgba(0,0,0,.2);box-shadow:0 5px 0 #15803d,0 12px 26px rgba(22,163,74,.35);}' +
      '.ff-family:hover{filter:brightness(1.06);}.ff-family:active{box-shadow:0 2px 0 #15803d,0 6px 14px rgba(22,163,74,.3);}' +
      '.ff-family .cg-ic{width:26px;height:26px;flex:none;}' +
      '.ff-solo{min-height:50px;padding:8px 16px;background:#ffffff;color:#18181b;border:2px solid rgba(0,0,0,.12);font-size:16px;font-weight:700;box-shadow:0 2px 0 rgba(0,0,0,.08);}' +
      '.ff-solo:hover{filter:brightness(.97);}.ff-solo .cg-ic{flex:none;}' +
      '.ff-solo[aria-expanded="true"]{border-color:#16a34a;}' +
      '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .ff-solo{background:#26262c;color:#f4f4f5;border-color:rgba(255,255,255,.14);}}' +
      ':root[data-theme="dark"] .ff-solo{background:#26262c;color:#f4f4f5;border-color:rgba(255,255,255,.14);}';
    document.head.appendChild(s);
  }
  function ffButtons({ solo, soloIcon, extra } = {}) {
    const ic = window.ChowGames.icon;
    return '<div class="ff-actions">' +
      `<button type="button" class="ff-btn ff-family" data-ff="family">${ic('users', 26)}<span>Play with the family</span></button>` +
      (solo ? `<button type="button" class="ff-btn ff-solo" data-ff="solo">${ic(soloIcon || 'play', 19)}<span>${solo}</span></button>` : '') +
      (extra || '') + '</div>';
  }

  function build(ctx) {
    ffStyle();
    root = ctx.root;
    root.classList.add('f4-stage');
    root.innerHTML = `<div class="f4-wrap"><div class="f4-status"></div><div class="f4-box"><canvas aria-label="Four in a Row board" role="img"></canvas></div>
      <div class="f4-controls"><button type="button" class="f4-btn" data-a="menu">${G.icon('back', 17)}<span>Menu</span></button><button type="button" class="f4-btn ghost" data-a="level"></button><button type="button" class="f4-btn primary" data-a="restart">${G.icon('again', 17)}<span>New game</span></button></div></div>
      <div class="f4-menu" hidden><div class="f4-menu-card">
        <div class="f4-logo" aria-hidden="true"><i style="--c:#ef4444"></i><i style="--c:#facc15"></i><i style="--c:#ef4444"></i><i style="--c:#facc15"></i></div>
        <h2>Four in a Row</h2><p>Drop discs and line up four – across, up or slanted!</p>
        ${ffButtons({ solo: '2 players on this device', soloIcon: 'gamepad', extra: `<button type="button" class="ff-btn ff-solo" data-a="cpu" aria-expanded="false">${G.icon('cpu', 19)}<span>Play the computer</span></button>` })}
        <div class="f4-cpu" hidden><h3>How tricky?</h3>
        <div class="f4-levels">${Object.entries(LEVELS).map(([k, L]) => `<button type="button" data-level="${k}">${pips(k)}${L.label}</button>`).join('')}</div></div>
      </div></div>`;
    wrap = $('.f4-wrap', root); statusEl = $('.f4-status', root); boxEl = $('.f4-box', root); canvas = $('canvas', root); cx = canvas.getContext('2d');
    controlsEl = $('.f4-controls', root); menuEl = $('.f4-menu', root);
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.level) startSolo(b.dataset.level);
      else if (b.dataset.ff === 'solo') startLocal();
      else if (b.dataset.ff === 'family') { b.blur(); G.openLobby(); }
      else if (b.dataset.a === 'cpu') showCpu(b.getAttribute('aria-expanded') !== 'true');
    });
    controlsEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.a === 'menu' || b.dataset.a === 'level') showMenu(mode === 'solo');
      else if (b.dataset.a === 'restart') newGame();
    });
    // pointer: hover shows the preview; tap/release drops. Dragging a finger moves the preview.
    const colAt = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (y < by - cell * 1.15 || y > by + boardLayer.h + cell * 0.3) return -1;
      const c = Math.floor((x - bx - cell * 0.22) / cell);
      return c >= 0 && c < COLS ? c : -1;
    };
    canvas.addEventListener('pointermove', (e) => { hoverPointer = e.pointerType; keyActive = false; if (e.pointerType === 'mouse' || downCol >= 0) hoverCol = colAt(e); });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hoverCol = -1; });
    canvas.addEventListener('pointerdown', (e) => { hoverPointer = e.pointerType; keyActive = false; downCol = colAt(e); hoverCol = downCol; try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
    canvas.addEventListener('pointerup', (e) => {
      if (downCol < 0) return;
      const c = colAt(e);
      downCol = -1;
      if (c >= 0) { keyCol = c; humanDrop(c); }
      if (e.pointerType !== 'mouse') hoverCol = -1;
    });
    canvas.addEventListener('pointercancel', () => { downCol = -1; hoverCol = -1; });
    window.addEventListener('keydown', (e) => {
      if (G.modalOpen() || mode === 'menu') return;
      if (e.key === 'ArrowLeft') { keyActive = true; hoverCol = -1; keyCol = (keyCol + COLS - 1) % COLS; e.preventDefault(); }
      else if (e.key === 'ArrowRight') { keyActive = true; hoverCol = -1; keyCol = (keyCol + 1) % COLS; e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { if (keyActive || hoverCol < 0) { keyActive = true; humanDrop(keyCol); } else humanDrop(hoverCol); e.preventDefault(); }
      else if (/^[1-7]$/.test(e.key)) { keyActive = true; keyCol = Number(e.key) - 1; humanDrop(keyCol); }
    });
    new ResizeObserver(() => layout()).observe(boxEl);
    layout();
    showMenu();
    requestAnimationFrame(frameLoop);
  }
  let hoverPointer = 'mouse', downCol = -1;

  G.on('multiStart', (info) => {
    mode = 'multi';
    menuEl.hidden = true;
    multi = null;
    resetBoard();
    if (info && info.shared) applyShared(info.shared, true);
  });
  G.on('shared', (s) => { if (mode === 'multi') applyShared(s); });
  G.on('multiEnd', () => { multi = null; showMenu(false); });

  G.mount({
    id: 'four', title: 'Four in a Row', mode: 'turns', minPlayers: 2, maxPlayers: 2, scoreLabel: 'wins',
    help: '<ul><li>Take turns dropping a disc into a column.</li><li>Get <b>four in a row</b> – across, up and down, or slanted – to win!</li>' +
      '<li>Tap a column (or click it). On a keyboard use ← → and Enter, or the keys 1–7.</li>' +
      '<li>Against the computer, <b>Easy</b> is gentle, <b>Medium</b> thinks ahead and <b>Hard</b> is very tricky. Wins against Medium and Hard count on the family leaderboard.</li>' +
      `<li>${G.icon('users', 17)} <b>Play together</b>: Red goes first. Every win counts on the leaderboard.</li></ul>`,
    initialShared,
    onReady: build
  });

  // exposed for tests
  window.__four = { computerMove, findWin, geom: () => { const r = canvas.getBoundingClientRect(); return { x: r.left + colX(0), dx: cell, y: r.top + by + cell }; }, state: () => ({ board, turn, winner, mode, level, anims: anims.length, thinking, busy, multi }) };
})();
