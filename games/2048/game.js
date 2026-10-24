// 2048: slide the tiles, join matching numbers, reach 2048. Plugs into the shared frame in /games/core.js
// (see games/README.md). Every new tile uses exactly two numbers from ChowGames.rng(seed) (where to try
// first, and 2 or 4), so in a race everyone gets the same tile sequence.
(function () {
  'use strict';
  const CG = window.ChowGames;
  const N = 4;
  const SLIDE_MS = 110;
  const ROUND_MS = 3 * 60 * 1000;
  const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const SAVE_KEY = 'chow_2048_save_';
  const BEST_KEY = 'chow_2048_best_';
  const SWIPE_PX = 26;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  let root, user = '';
  let el = {};
  let size = 0, gap = 0, tileSize = 0;

  // ---------- State ----------
  let G = null;            // { seed, rnd, draws, grid[16], score, won, keepGoing, undoUsed, snap, over, spawns[] }
  let multi = false;
  let phase = 'start';     // start | play | win | over
  let nextId = 1;
  let pending = [];        // DOM work waiting for the slide to finish
  let pendingTimer = null;
  let endAt = 0;
  let timerInt = null;
  let lastSec = -1;
  let overTimer = null;

  function makeRng(seed, draws) {
    const r = CG.rng(seed);
    for (let i = 0; i < draws; i++) r();
    return r;
  }
  function draw() { G.draws++; return G.rnd(); }

  function newGame(seed) {
    G = { seed, rnd: makeRng(seed, 0), draws: 0, grid: new Array(N * N).fill(null), score: 0, won: false, keepGoing: false, undoUsed: false, snap: null, over: false, spawns: [] };
    spawn(); spawn();
  }

  // The tile goes to the first empty cell at or after a seeded spot, so the sequence only depends on the rng.
  function spawn() {
    const r1 = draw(), r2 = draw();
    const want = Math.floor(r1 * N * N);
    const v = r2 < 0.9 ? 2 : 4;
    G.spawns.push({ want, v });
    for (let i = 0; i < N * N; i++) {
      const k = (want + i) % (N * N);
      if (!G.grid[k]) {
        const t = { id: nextId++, v, k, isNew: true };
        G.grid[k] = t;
        return t;
      }
    }
    return null;
  }

  function lines(dir) {
    const out = [];
    for (let i = 0; i < N; i++) {
      const line = [];
      for (let j = 0; j < N; j++) {
        if (dir === 'left') line.push(i * N + j);
        if (dir === 'right') line.push(i * N + (N - 1 - j));
        if (dir === 'up') line.push(j * N + i);
        if (dir === 'down') line.push((N - 1 - j) * N + i);
      }
      out.push(line);
    }
    return out;
  }

  // Returns { moved, gained, slides: [{tile, to}], merges: [{a, b, tile}] } and updates G.grid.
  function slide(dir) {
    const grid = new Array(N * N).fill(null);
    const slides = [], merges = [];
    let moved = false, gained = 0;
    for (const line of lines(dir)) {
      const tiles = line.map((k) => G.grid[k]).filter(Boolean);
      const out = [];
      for (const t of tiles) {
        const last = out[out.length - 1];
        if (last && !last.b && last.a.v === t.v) last.b = t;
        else out.push({ a: t });
      }
      out.forEach((o, i) => {
        const k = line[i];
        if (o.b) {
          const nt = { id: nextId++, v: o.a.v * 2, k, merged: true };
          grid[k] = nt;
          merges.push({ a: o.a, b: o.b, tile: nt });
          slides.push({ tile: o.a, to: k }, { tile: o.b, to: k });
          gained += nt.v;
          moved = true;
        } else {
          if (o.a.k !== k) moved = true;
          slides.push({ tile: o.a, to: k });
          grid[k] = o.a;
        }
      });
    }
    if (moved) {
      for (const s of slides) s.tile.k = s.to;
      G.grid = grid;
    }
    return { moved, gained, slides, merges };
  }

  function canMove() {
    for (let k = 0; k < N * N; k++) {
      const t = G.grid[k];
      if (!t) return true;
      const r = Math.floor(k / N), c = k % N;
      if (c < N - 1 && G.grid[k + 1] && G.grid[k + 1].v === t.v) return true;
      if (r < N - 1 && G.grid[k + N] && G.grid[k + N].v === t.v) return true;
    }
    return false;
  }
  const maxTile = () => G.grid.reduce((m, t) => Math.max(m, t ? t.v : 0), 0);

  function snapshot() {
    return { cells: G.grid.map((t) => (t ? t.v : 0)), score: G.score, draws: G.draws, won: G.won, keepGoing: G.keepGoing };
  }
  function restore(s) {
    G.grid = s.cells.map((v, k) => (v ? { id: nextId++, v, k } : null));
    G.score = s.score;
    G.draws = s.draws;
    G.rnd = makeRng(G.seed, s.draws);
    G.won = s.won;
    G.keepGoing = s.keepGoing;
  }

  function save() {
    if (multi || !G) return;
    if (G.over || phase === 'over') { store.del(SAVE_KEY + user); return; }
    store.set(SAVE_KEY + user, JSON.stringify({ seed: G.seed, ...snapshot(), undoUsed: G.undoUsed, snap: G.snap }));
  }
  function loadSave() {
    try {
      const s = JSON.parse(store.get(SAVE_KEY + user) || 'null');
      if (!s || !Array.isArray(s.cells) || s.cells.length !== N * N) return null;
      return s;
    } catch (e) { return null; }
  }

  // ---------- Moves ----------
  // During the 3-2-1 before a race nothing moves (the core keeps "Go!" up briefly after the start, so allow that).
  const countingDown = () => !!(CG.countingDown && CG.countingDown()) && Date.now() - roundStart > 1000;
  let roundStart = 0;

  function move(dir) {
    if (!G || G.over || phase !== 'play' || CG.modalOpen() || countingDown()) return;
    flush();
    const before = multi ? null : snapshot();
    const res = slide(dir);
    if (!res.moved) { nudge(dir); return; }
    if (before) G.snap = before;
    G.score += res.gained;
    const t = spawn();
    animate(res, t);
    if (res.gained) {
      showGain(res.gained);
      const top = Math.max(...res.merges.map((m) => m.tile.v));
      CG.sfx(top >= 512 ? 'match' : top >= 64 ? 'coin' : 'point');
    } else CG.sfx('whoosh');
    updateHud();
    if (multi) CG.race.update({ score: G.score, alive: true, best: maxTile() });
    const made2048 = !G.won && res.merges.some((m) => m.tile.v >= 2048);
    if (made2048) {
      G.won = true;
      if (multi) { CG.toast('🎉 You made 2048!'); confetti(); CG.sfx('win'); }
      else { phase = 'win'; setTimeout(showWin, SLIDE_MS + 220); }
    }
    if (!canMove()) {
      G.over = true;
      clearTimeout(overTimer);
      overTimer = setTimeout(() => endGame('stuck'), 900);
    }
    save();
  }

  function undo() {
    if (multi || !G || G.undoUsed || !G.snap || phase !== 'play' || G.over) return;
    flush();
    restore(G.snap);
    G.undoUsed = true;
    G.snap = null;
    rebuild(true);
    updateHud();
    CG.sfx('flip');
    save();
  }

  function endGame(why) {
    if (!G || phase === 'over') return;
    clearTimeout(overTimer);
    phase = 'over';
    G.over = true;
    stopTimer();
    const best = Math.max(Number(store.get(BEST_KEY + user)) || 0, G.score);
    store.set(BEST_KEY + user, String(best));
    store.del(SAVE_KEY + user);
    updateHud();
    renderOverlay();
    if (multi) {
      CG.race.update({ score: G.score, alive: false, best: maxTile() });
      if (why === 'time') CG.sfx('whoosh');
      CG.gameOver({ score: G.score });
      return;
    }
    const title = why === 'done' ? '🏆 Well played!' : G.won ? '🎉 What a game!' : 'No more moves!';
    CG.gameOver({ score: G.score, title, again: () => startSolo(true, true) });
  }

  // ---------- DOM ----------
  function build() {
    root.innerHTML = `
      <div class="tw">
        <div class="tw-top">
          <div class="tw-logo" aria-hidden="true">2048</div>
          <div class="tw-box" id="tw-scorebox"><small>Score</small><b id="tw-score">0</b></div>
          <div class="tw-box tw-bestbox"><small>Best</small><b id="tw-best">0</b></div>
          <div class="tw-box tw-timer" id="tw-timer" hidden><small>Time</small><b id="tw-time">3:00</b></div>
        </div>
        <div class="tw-actions" id="tw-actions">
          <button type="button" class="tw-btn" id="tw-undo">↶ Undo</button>
          <button type="button" class="tw-btn primary" id="tw-new">New game</button>
        </div>
        <div class="tw-wrap" id="tw-wrap">
          <div class="tw-board" id="tw-board">
            <div class="tw-cells">${'<div class="tw-cell"></div>'.repeat(N * N)}</div>
            <div class="tw-tiles" id="tw-tiles"></div>
            <div class="tw-overlay" id="tw-overlay"></div>
          </div>
        </div>
        <div class="tw-opps" id="tw-opps" hidden></div>
        <canvas class="tw-confetti" id="tw-confetti" aria-hidden="true"></canvas>
      </div>`;
    const $ = (s) => root.querySelector(s);
    el = {
      tw: $('.tw'), score: $('#tw-score'), scoreBox: $('#tw-scorebox'), best: $('#tw-best'), bestBox: $('.tw-bestbox'), logo: $('.tw-logo'),
      timer: $('#tw-timer'), time: $('#tw-time'), actions: $('#tw-actions'), undo: $('#tw-undo'), newBtn: $('#tw-new'),
      wrap: $('#tw-wrap'), board: $('#tw-board'), tiles: $('#tw-tiles'), overlay: $('#tw-overlay'), opps: $('#tw-opps'), confetti: $('#tw-confetti')
    };
    el.undo.addEventListener('click', undo);
    el.newBtn.addEventListener('click', askNewGame);
    el.overlay.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'play') begin();
      if (act === 'fresh') startSolo(true, true);
      if (act === 'keep') { G.keepGoing = true; phase = 'play'; renderOverlay(); updateHud(); save(); CG.sfx('click'); }
      if (act === 'finish') endGame('done');
    });
  }

  function askNewGame() {
    if (multi) return;
    if (!G || G.score === 0 || phase !== 'play') { startSolo(true, true); return; }
    const card = CG.modal(`<h2>Start a new game?</h2><p class="cg-sub">Your score of <b>${fmt(G.score)}</b> will be saved to the leaderboard.</p>` +
      '<div class="cg-row"><button type="button" data-cg="close">Keep playing</button><button type="button" class="primary" data-a="new">New game</button></div>');
    card.querySelector('[data-a="new"]').addEventListener('click', () => {
      CG.closeModal();
      if (G.score > 0) CG.submitScore(G.score);
      const best = Math.max(Number(store.get(BEST_KEY + user)) || 0, G.score);
      store.set(BEST_KEY + user, String(best));
      startSolo(true, true);
    });
  }

  function layout() {
    if (!el.wrap) return;
    let w = el.wrap.clientWidth;
    const h = el.wrap.clientHeight;
    const side = getComputedStyle(el.tw).display === 'grid';   // short landscape: the scores sit beside the board
    if (side) {
      const sideW = el.wrap.offsetLeft - el.tw.querySelector('.tw-top').offsetLeft;
      w = root.clientWidth - 28 - sideW;
    }
    if (w <= 0 || h <= 0) return;
    size = Math.floor(Math.min(w, h, 540));
    const padX = side ? Math.max(14, Math.floor((root.clientWidth - (el.wrap.offsetLeft - el.tw.querySelector('.tw-top').offsetLeft) - size) / 2)) : '';
    el.tw.style.paddingLeft = el.tw.style.paddingRight = padX === '' ? '' : padX + 'px';
    gap = Math.max(6, Math.round(size * 0.028));
    tileSize = (size - gap * (N + 1)) / N;
    el.board.style.width = size + 'px';
    el.board.style.height = size + 'px';
    el.tw.style.setProperty('--bs', size + 'px');
    el.tw.style.setProperty('--gap', gap + 'px');
    el.tw.style.setProperty('--ts', tileSize + 'px');
    el.board.classList.add('noanim');
    el.tiles.querySelectorAll('.tile').forEach((t) => place(t, Number(t.dataset.k)));
    void el.board.offsetWidth;
    el.board.classList.remove('noanim');
    const cv = el.confetti, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(root.clientWidth * dpr); cv.height = Math.round(root.clientHeight * dpr);
  }

  const posOf = (k) => ({ x: gap + (k % N) * (tileSize + gap), y: gap + Math.floor(k / N) * (tileSize + gap) });
  function place(node, k) {
    const p = posOf(k);
    node.dataset.k = k;
    node.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  function tileEl(t, cls) {
    const d = document.createElement('div');
    const digits = String(t.v).length;
    d.className = `tile v${t.v > 16384 ? 'big' : t.v} d${Math.min(digits, 5)}${cls ? ' ' + cls : ''}`;
    d.dataset.id = t.id;
    d.innerHTML = `<div class="in">${t.v}</div>`;
    place(d, t.k);
    el.tiles.appendChild(d);
    return d;
  }
  const nodeOf = (t) => el.tiles.querySelector(`.tile[data-id="${t.id}"]`);

  function rebuild(fade) {
    flush();
    el.tiles.innerHTML = '';
    for (const t of G.grid) if (t) tileEl(t, fade ? 'new' : '');
  }

  function animate(res, spawned) {
    for (const s of res.slides) {
      const n = nodeOf(s.tile);
      if (n) place(n, s.to);
    }
    pending.push(() => {
      for (const m of res.merges) {
        [m.a, m.b].forEach((t) => { const n = nodeOf(t); if (n) n.remove(); });
        tileEl(m.tile, 'merged');
        if (m.tile.v >= 128) sparkle(m.tile);
      }
      if (spawned) tileEl(spawned, 'new');
    });
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flush, SLIDE_MS);
  }
  function flush() {
    clearTimeout(pendingTimer);
    const p = pending; pending = [];
    p.forEach((fn) => fn());
  }

  function nudge(dir) {
    const b = el.board;
    b.classList.remove('nudge-left', 'nudge-right', 'nudge-up', 'nudge-down');
    void b.offsetWidth;
    b.classList.add('nudge-' + dir);
  }

  function sparkle(t) {
    const p = posOf(t.k);
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('i');
      s.className = 'tw-spark';
      const a = (i / 8) * Math.PI * 2;
      s.style.left = (p.x + tileSize / 2) + 'px';
      s.style.top = (p.y + tileSize / 2) + 'px';
      s.style.setProperty('--dx', Math.cos(a) * tileSize * 0.75 + 'px');
      s.style.setProperty('--dy', Math.sin(a) * tileSize * 0.75 + 'px');
      el.tiles.appendChild(s);
      setTimeout(() => s.remove(), 600);
    }
  }

  function showGain(n) {
    el.scoreBox.querySelectorAll('.tw-gain').forEach((x) => x.remove());
    const s = document.createElement('span');
    s.className = 'tw-gain';
    s.textContent = '+' + n;
    el.scoreBox.appendChild(s);
    setTimeout(() => s.remove(), 800);
    el.scoreBox.classList.remove('pop'); void el.scoreBox.offsetWidth; el.scoreBox.classList.add('pop');
  }

  function updateHud() {
    if (!G) return;
    el.score.textContent = fmt(G.score);
    el.best.textContent = fmt(Math.max(Number(store.get(BEST_KEY + user)) || 0, G.score));
    const canUndo = !multi && !G.undoUsed && !!G.snap && phase === 'play' && !G.over;
    el.undo.disabled = !canUndo;
    el.undo.textContent = G.undoUsed ? '↶ Undo used' : '↶ Undo';
  }

  function renderOverlay() {
    const o = el.overlay;
    if (phase === 'start') {
      const saved = loadSave();
      const resume = saved && saved.score > 0;
      o.innerHTML = `<div class="tw-card"><div class="tw-card-logo" aria-hidden="true"><span class="v2">2</span><span class="v0">0</span><span class="v4">4</span><span class="v8">8</span></div>` +
        `<p>${matchMedia('(pointer: coarse)').matches ? 'Swipe' : 'Use the arrow keys'} to slide the tiles.<br>Join matching numbers to reach <b>2048</b>!</p>` +
        (resume ? `<button type="button" class="tw-big" data-act="play">▶ Continue <small>${fmt(saved.score)}</small></button><button type="button" class="tw-link" data-act="fresh">Start a new game</button>`
          : '<button type="button" class="tw-big" data-act="play">▶ Play</button>') + '</div>';
      o.className = 'tw-overlay show';
    } else if (phase === 'win') {
      o.innerHTML = '<div class="tw-card win"><div class="tw-trophy" aria-hidden="true">🏆</div><h2>You made 2048!</h2><p>Amazing! Keep going for an even bigger tile?</p>' +
        '<button type="button" class="tw-big" data-act="keep">Keep going</button><button type="button" class="tw-link" data-act="finish">Finish and save my score</button></div>';
      o.className = 'tw-overlay show win';
    } else {
      o.innerHTML = '';
      o.className = 'tw-overlay';
    }
  }

  function showWin() {
    if (phase !== 'win') return;
    renderOverlay();
    updateHud();
    confetti();
    CG.sfx('win');
  }

  // ---------- Confetti ----------
  let confettiParts = [];
  let confettiRun = false;
  function confetti() {
    const cv = el.confetti;
    const W = cv.width, H = cv.height;
    const cols = ['#ff7b5c', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#ffb000', '#9b5de5'];
    for (let i = 0; i < 140; i++) {
      confettiParts.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.45, vx: (Math.random() - 0.5) * W * 0.03, vy: -Math.random() * H * 0.03 - H * 0.008,
        r: (4 + Math.random() * 5) * (W / root.clientWidth), a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length], life: 1 });
    }
    if (!confettiRun) { confettiRun = true; requestAnimationFrame(confettiFrame); }
  }
  function confettiFrame() {
    const cv = el.confetti, c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    const gy = cv.height * 0.0009;
    for (const p of confettiParts) {
      p.vy += gy; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va; p.life -= 0.006;
      c.save(); c.translate(p.x, p.y); c.rotate(p.a); c.globalAlpha = Math.max(0, Math.min(1, p.life * 3));
      c.fillStyle = p.c; c.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); c.restore();
    }
    confettiParts = confettiParts.filter((p) => p.life > 0 && p.y < cv.height + 20);
    if (confettiParts.length) requestAnimationFrame(confettiFrame);
    else { confettiRun = false; c.clearRect(0, 0, cv.width, cv.height); }
  }

  // ---------- Multiplayer bits ----------
  function startTimer() {
    stopTimer();
    lastSec = -1;
    timerInt = setInterval(tickTimer, 200);
    tickTimer();
  }
  function stopTimer() { clearInterval(timerInt); timerInt = null; }
  function tickTimer() {
    const left = Math.max(0, endAt - Date.now());
    const sec = Math.ceil(left / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      el.time.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      el.timer.classList.toggle('hurry', sec <= 10);
      if (sec <= 10 && sec > 0 && phase === 'play') CG.sfx('tick');
    }
    renderOpps();
    if (left <= 0 && phase !== 'over') { stopTimer(); flush(); endGame('time'); }
  }

  function renderOpps() {
    if (!multi) { el.opps.hidden = true; return; }
    const others = CG.race.others();
    const was = el.opps.hidden;
    el.opps.hidden = !others.length;
    if (!others.length) return;
    el.opps.innerHTML = others.map((o) => {
      const best = Number(o.state.best) || 2, alive = o.state.alive !== false;
      return `<div class="op${alive ? '' : ' out'}"><span class="mini v${best > 16384 ? 'big' : best} d${Math.min(String(best).length, 5)}">${best}</span>` +
        `<div class="op-t"><b><i style="background:${esc(o.color)}"></i>${esc(o.name)}</b><span>${fmt(o.state.score)}${alive ? '' : ' 🏁'}</span></div></div>`;
    }).join('');
    if (was) layout();
  }

  function setMultiUi(on) {
    el.tw.classList.toggle('multi', on);
    el.timer.hidden = !on;
    el.bestBox.hidden = on;
    el.actions.hidden = on;
    el.opps.hidden = true;
    layout();
  }

  // ---------- Flow ----------
  function startSolo(fresh, immediate) {
    clearTimeout(overTimer);
    flush();
    const saved = fresh ? null : loadSave();
    if (fresh) store.del(SAVE_KEY + user);
    if (saved) {
      G = { seed: saved.seed, rnd: null, draws: 0, grid: [], score: 0, won: false, keepGoing: false, undoUsed: !!saved.undoUsed, snap: saved.snap || null, over: false, spawns: [] };
      restore(saved);
    } else newGame(Math.floor(Math.random() * 2 ** 31));
    rebuild(true);
    phase = immediate ? 'play' : 'start';
    if (immediate) save();
    renderOverlay();
    updateHud();
  }

  function begin() {
    if (phase !== 'start') return;
    phase = 'play';
    renderOverlay();
    updateHud();
    save();
    CG.sfx('go');
  }

  // ---------- Input ----------
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (CG.modalOpen() || countingDown()) return;
    const dir = KEYS[e.code];
    if (dir) {
      e.preventDefault();
      if (phase === 'start') begin();
      move(dir);
      return;
    }
    if (e.code === 'KeyU' || e.code === 'Backspace') { e.preventDefault(); undo(); }
    if ((e.code === 'Enter' || e.code === 'Space') && phase === 'start') { e.preventDefault(); begin(); }
  }

  function bindTouch() {
    let sw = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || CG.modalOpen()) return;
      sw = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
    });
    root.addEventListener('pointermove', (e) => {
      if (!sw || sw.done || e.pointerId !== sw.id) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      sw.done = true;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (countingDown()) return;
      if (phase === 'start') begin();
      move(dir);
    });
    const end = () => { sw = null; };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
  }

  // ---------- Boot ----------
  CG.mount({
    id: '2048', title: '2048', emoji: '🔢', mode: 'race', scoreLabel: 'points',
    help: '<ul><li><b>Swipe</b> (or use the <b>arrow keys</b> / <b>WASD</b>) to slide every tile.</li>' +
      '<li>Two tiles with the same number join into one: 2+2 → 4, 4+4 → 8…</li>' +
      '<li>Each join adds the new number to your score. Reach <b>2048</b> to win, then keep going if you like!</li>' +
      '<li>A new tile appears after every move. The game ends when the board is full and nothing can join.</li>' +
      '<li>Made a mistake? <b>↶ Undo</b> works once per game.</li>' +
      '<li>In <b>👥 Play together</b> everyone gets the same new tiles and has <b>3 minutes</b>. Highest score wins!</li></ul>',
    onReady(ctx) {
      root = ctx.root; user = ctx.user || '';
      build();
      new ResizeObserver(() => layout()).observe(el.wrap);
      window.addEventListener('resize', layout);
      layout();
      startSolo(false);
      window.addEventListener('keydown', onKey);
      bindTouch();
    }
  });

  CG.on('multiStart', (info) => {
    clearTimeout(overTimer);
    flush();
    multi = true;
    setMultiUi(true);
    newGame(info.seed);
    rebuild(true);
    phase = 'play';
    renderOverlay();
    updateHud();
    roundStart = Date.now();
    endAt = roundStart + ROUND_MS;
    startTimer();
    CG.race.update({ score: 0, alive: true, best: maxTile() });
  });
  CG.on('multiEnd', () => {
    multi = false;
    stopTimer();
    setMultiUi(false);
    startSolo(false);
  });

  // For tests: a read-only peek at the game.
  window.Game2048 = {
    state: () => G && ({ phase, multi, score: G.score, cells: G.grid.map((t) => (t ? t.v : 0)), spawns: G.spawns.slice(), draws: G.draws, undoUsed: G.undoUsed, won: G.won, over: G.over, timeLeft: multi ? Math.max(0, endAt - Date.now()) : null })
  };
})();
