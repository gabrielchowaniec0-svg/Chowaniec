// Snake: a smooth, friendly take on the classic. Eat apples (10), golden apples (30), don't bump the walls
// or your own tail. Plugs into the shared frame in /games/core.js (see games/README.md).
// Every apple comes from ChowGames.rng(seed), always two numbers per apple, so in a race everyone gets the
// same apple sequence.
(function () {
  'use strict';
  const CG = window.ChowGames;
  const COLS = 15, ROWS = 15;
  const START_LEN = 3;
  const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const PAD_KEY = 'chow_snake_dpad';
  const BEST_KEY = 'chow_snake_best_';
  const SWIPE_PX = 22;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- DOM ----------
  let root, user = '';
  let el = {};
  let canvas, g, dpr = 1, cell = 24, bw = 0, bh = 0, bgCache = null;
  let pal = null;

  // ---------- Game state ----------
  let S = null;
  let phase = 'ready';   // ready | playing | paused | dying | over
  let multi = false;
  let overTimer = null;
  let particles = [];
  let floaters = [];
  let shake = 0;
  let lastFrame = 0;
  let oppTimer = 0;

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function palette() {
    const dark = isDark();
    return dark ? {
      dark, a: '#2c4a2a', b: '#274225', snake: '#5b8dff', snakeDark: '#3f6fe0', snakeHi: '#9dbcff', shadow: 'rgba(0,0,0,.35)',
      eye: '#ffffff', pupil: '#1d2433', apple: '#ff5a5f', appleDark: '#d63a44', leaf: '#5fd068', stem: '#a0703f', tongue: '#ff5f86'
    } : {
      dark, a: '#aad751', b: '#a2d149', snake: '#4a7cf3', snakeDark: '#3561d4', snakeHi: '#8fb2ff', shadow: 'rgba(30,60,0,.22)',
      eye: '#ffffff', pupil: '#1d2433', apple: '#ff4b4b', appleDark: '#d62f3a', leaf: '#3fb34f', stem: '#8a5a2b', tongue: '#ff4f7a'
    };
  }

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

  function build() {
    ffStyle();
    const ic = CG.icon;
    root.innerHTML = `
      <div class="sn">
        <div class="sn-hud">
          <div class="sn-pill" title="Score"><span class="sn-ic apple" aria-hidden="true">${ic('apple', 20)}</span><b id="sn-score">0</b></div>
          <div class="sn-pill sn-best" title="Your best"><span class="sn-ic gold" aria-hidden="true">${ic('trophy', 18)}</span><b id="sn-best">0</b></div>
          <button type="button" class="sn-padbtn" id="sn-padbtn" aria-pressed="false" aria-label="Show arrow buttons">${ic('gamepad', 22)}</button>
        </div>
        <div class="sn-boardwrap" id="sn-boardwrap">
          <div class="sn-board" id="sn-board">
            <canvas id="sn-canvas" aria-label="Snake board" role="img"></canvas>
            <div class="sn-overlay" id="sn-overlay"></div>
          </div>
        </div>
        <div class="sn-opps" id="sn-opps" hidden></div>
        <div class="sn-pad" id="sn-pad" hidden>
          <button type="button" data-dir="up" class="u" aria-label="Up">${ic('arrowUp', 26)}</button>
          <button type="button" data-dir="left" class="l" aria-label="Left">${ic('arrowLeft', 26)}</button>
          <button type="button" data-dir="right" class="r" aria-label="Right">${ic('arrowRight', 26)}</button>
          <button type="button" data-dir="down" class="d" aria-label="Down">${ic('arrowDown', 26)}</button>
        </div>
      </div>`;
    el = {
      score: root.querySelector('#sn-score'), best: root.querySelector('#sn-best'), padBtn: root.querySelector('#sn-padbtn'),
      wrap: root.querySelector('#sn-boardwrap'), board: root.querySelector('#sn-board'), overlay: root.querySelector('#sn-overlay'),
      opps: root.querySelector('#sn-opps'), pad: root.querySelector('#sn-pad'), bestPill: root.querySelector('.sn-best')
    };
    canvas = root.querySelector('#sn-canvas');
    g = canvas.getContext('2d');

    el.padBtn.addEventListener('click', () => setPad(el.pad.hidden));
    el.pad.querySelectorAll('button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 140);
        onDir(b.dataset.dir);
      });
    });
    el.overlay.addEventListener('click', (e) => {
      const f = e.target.closest('button[data-ff]');
      if (f) {
        f.blur();
        if (CG.countingDown && CG.countingDown()) return;
        if (f.dataset.ff === 'family') { CG.sfx('click'); CG.openLobby(); } else if (phase === 'ready') start('right');
        return;
      }
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'play') start('right');
      if (b.dataset.act === 'resume') resume();
    });
    setPad(store.get(PAD_KEY) === '1', true);
  }

  function setPad(on, quiet) {
    el.pad.hidden = !on;
    el.padBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.padBtn.classList.toggle('on', on);
    if (!quiet) { store.set(PAD_KEY, on ? '1' : '0'); CG.sfx('click'); }
    layout();
  }

  // ---------- Layout ----------
  function layout() {
    if (!el.wrap) return;
    const w = el.wrap.clientWidth - 14, h = el.wrap.clientHeight - 14;
    if (w <= 0 || h <= 0) return;
    cell = Math.max(8, Math.floor(Math.min(w / COLS, h / ROWS)));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    bw = cell * COLS; bh = cell * ROWS;
    canvas.width = Math.round(bw * dpr); canvas.height = Math.round(bh * dpr);
    canvas.style.width = bw + 'px'; canvas.style.height = bh + 'px';
    el.board.style.width = bw + 'px'; el.board.style.height = bh + 'px';
    el.board.style.marginTop = Math.round(Math.min((h - bh) / 2, 28) + 7) + 'px';
    root.querySelector('.sn').style.setProperty('--bw', bw + 'px');
    root.querySelector('.sn').style.setProperty('--cell', cell + 'px');
    paintBg();
  }

  function paintBg() {
    pal = palette();
    bgCache = document.createElement('canvas');
    bgCache.width = canvas.width; bgCache.height = canvas.height;
    const c = bgCache.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      c.fillStyle = (x + y) % 2 ? pal.b : pal.a;
      c.fillRect(x * cell, y * cell, cell, cell);
    }
    // a soft vignette so the board feels a little 3D
    const gr = c.createRadialGradient(bw / 2, bh / 2, bw * 0.2, bw / 2, bh / 2, bw * 0.75);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, pal.dark ? 'rgba(0,0,0,.18)' : 'rgba(40,80,0,.10)');
    c.fillStyle = gr; c.fillRect(0, 0, bw, bh);
  }

  // ---------- Game ----------
  function newGame(seed) {
    const mid = ROWS - 6;   // a little low, so the start card above never hides the snake
    const body = [];
    for (let i = 0; i < START_LEN; i++) body.push({ x: 4 - i, y: mid });
    S = {
      seed, rnd: CG.rng(seed), body, prevTail: { ...body[body.length - 1] }, dir: { ...DIRS.right }, queue: [],
      apple: null, appleCount: 0, eaten: 0, score: 0, shownScore: 0, stepMs: 150, acc: 0,
      pendingEat: null, head: { a: 0 }, blinkAt: performance.now() + 1500, blinkT: 0, tongueAt: performance.now() + 900, tongueT: 0,
      deathAt: 0, cause: '', log: [], won: false
    };
    // The first apple sits right in front of you; every one after that comes from the seeded sequence.
    placeApple({ x: 10, y: mid, gold: false });
    particles = []; floaters = []; shake = 0;
    S.head.a = 0;
    updateHud();
  }

  // Each apple uses exactly two random numbers, whatever the board looks like, so the sequence is shared.
  function nextApple() {
    const r1 = S.rnd(), r2 = S.rnd();
    const want = Math.floor(r1 * COLS * ROWS);
    const gold = S.appleCount >= 3 && r2 < 0.14;
    const taken = new Set(S.body.map((p) => p.y * COLS + p.x));
    for (let i = 0; i < COLS * ROWS; i++) {
      const k = (want + i) % (COLS * ROWS);
      if (!taken.has(k)) return { x: k % COLS, y: Math.floor(k / COLS), gold, want };
    }
    return null;
  }
  function placeApple(a) {
    if (!a) { S.apple = null; return; }
    S.apple = { x: a.x, y: a.y, gold: a.gold, born: performance.now() + (S.appleCount ? S.stepMs * 0.9 : 0) };
    S.log.push({ x: a.x, y: a.y, gold: a.gold, want: a.want == null ? -1 : a.want });
    S.appleCount++;
  }

  function queueDir(name) {
    const d = DIRS[name];
    if (!d) return;
    const last = S.queue.length ? S.queue[S.queue.length - 1] : S.dir;
    if ((d.x === last.x && d.y === last.y) || (d.x === -last.x && d.y === -last.y)) return;
    if (S.queue.length < 3) S.queue.push(d);
  }

  function step(now) {
    if (S.pendingEat) fireEat(S.pendingEat);
    while (S.queue.length) {
      const d = S.queue.shift();
      if (!(d.x === -S.dir.x && d.y === -S.dir.y) && !(d.x === S.dir.x && d.y === S.dir.y)) { S.dir = d; break; }
    }
    const head = S.body[0];
    const nx = head.x + S.dir.x, ny = head.y + S.dir.y;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return die(now, 'wall');
    const eat = S.apple && S.apple.x === nx && S.apple.y === ny;
    const n = S.body.length - (eat ? 0 : 1);   // the tail moves out of the way unless we grow
    for (let i = 0; i < n; i++) if (S.body[i].x === nx && S.body[i].y === ny) return die(now, 'self');
    S.body.unshift({ x: nx, y: ny });
    if (eat) {
      S.prevTail = { ...S.body[S.body.length - 1] };
      const a = S.apple;
      S.eaten++;
      S.score += a.gold ? 30 : 10;
      S.pendingEat = { x: a.x, y: a.y, gold: a.gold };
      S.eatenApple = { x: a.x, y: a.y, gold: a.gold, at: now };
      S.stepMs = Math.max(80, 150 - S.eaten * 2.4);
      const next = nextApple();
      if (!next) { placeApple(null); S.won = true; }
      else placeApple(next);
    } else {
      S.prevTail = S.body.pop();
    }
    if (multi) CG.race.update({ score: S.score, alive: true, len: S.body.length });
    if (S.won) { S.acc = 0; return die(now, 'won'); }
  }

  function fireEat(p) {
    S.pendingEat = null;
    S.eatenApple = null;
    const cx = (p.x + 0.5) * cell, cy = (p.y + 0.5) * cell;
    const cols = p.gold ? ['#ffd23f', '#ffb703', '#fff3b0'] : [pal.apple, '#ffb3b3', pal.leaf];
    for (let i = 0; i < (p.gold ? 22 : 14); i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.6 + Math.random() * 1.6) * cell * 0.09;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - cell * 0.03, life: 1, r: cell * (0.05 + Math.random() * 0.07), c: cols[i % cols.length] });
    }
    particles.push({ ring: true, x: cx, y: cy, life: 1, c: p.gold ? '#ffd23f' : '#ffffff' });
    floaters.push({ x: cx, y: cy - cell * 0.3, text: p.gold ? '+30' : '+10', gold: p.gold, life: 1 });
    S.shownScore = S.score;
    CG.sfx(p.gold ? 'coin' : 'point');
    updateHud(true);
  }

  function die(now, cause) {
    if (S.pendingEat) fireEat(S.pendingEat);
    phase = 'dying';
    S.cause = cause;
    S.deathAt = now;
    S.bump = cause === 'won' ? null : { ...S.dir };
    if (cause === 'won') CG.sfx('win'); else { CG.sfx('hit'); shake = 1; }
    S.shownScore = S.score;
    updateHud();
    const best = Math.max(Number(store.get(BEST_KEY + user)) || 0, S.score);
    store.set(BEST_KEY + user, String(best));
    clearTimeout(overTimer);
    overTimer = setTimeout(finish, cause === 'won' ? 1400 : 1000);
  }

  function finish() {
    if (phase !== 'dying') return;
    phase = 'over';
    renderOverlay();
    if (multi) {
      CG.race.update({ score: S.score, alive: false, len: S.body.length });
      CG.gameOver({ score: S.score });
      return;
    }
    const title = S.cause === 'won' ? 'You filled the board!' : S.cause === 'self' ? 'Oops! You bit your tail' : 'Bonk! You hit the wall';
    CG.gameOver({ score: S.score, title, again: toReady });
  }

  function toReady() {
    if (multi) return;
    clearTimeout(overTimer);
    newGame(Math.floor(Math.random() * 2 ** 31));
    phase = 'ready';
    renderOverlay();
  }

  function start(name) {
    if (phase !== 'ready') return;
    phase = 'playing';
    if (name && name !== 'left') queueDir(name);
    S.acc = S.stepMs;   // take the first step on the next frame
    renderOverlay();
    CG.sfx('go');
  }

  function pause() {
    if (phase !== 'playing' || multi) return;
    phase = 'paused';
    renderOverlay();
  }
  function resume() {
    if (phase !== 'paused') return;
    phase = 'playing';
    lastFrame = performance.now();
    renderOverlay();
  }

  function onDir(name) {
    if (CG.modalOpen()) return;
    if (CG.countingDown && CG.countingDown() && phase !== 'playing') return;   // the 3-2-1 before a race
    if (phase === 'ready') { start(name); return; }
    if (phase === 'paused') resume();
    if (phase !== 'playing') return;
    queueDir(name);
  }

  // ---------- HUD and overlays ----------
  function updateHud(bump) {
    if (!S) return;
    el.score.textContent = S.shownScore;
    const best = Math.max(Number(store.get(BEST_KEY + user)) || 0, S.shownScore);
    el.best.textContent = best;
    if (bump) { el.score.parentNode.classList.remove('pop'); void el.score.offsetWidth; el.score.parentNode.classList.add('pop'); }
  }

  const PLAY_IC = CG.icon('play', 18).replace('fill="none"', 'fill="currentColor"');
  function renderOverlay() {
    const o = el.overlay;
    if (phase === 'ready') {
      o.innerHTML = `<div class="sn-card sn-start"><div class="sn-head"><span class="sn-logo" aria-hidden="true">${CG.badge('snake', 40)}</span><div class="sn-txt"><h2>Snake</h2>
        <p>${matchMedia('(pointer: coarse)').matches ? 'Swipe to steer' : 'Arrow keys to steer'}, eat the apples!</p></div></div>
        ${ffButtons({ solo: 'Practice alone' })}</div>`;
      o.className = 'sn-overlay show';
    } else if (phase === 'paused') {
      o.innerHTML = '<div class="sn-card"><h2>Paused</h2><p>Take a break!</p><button type="button" class="sn-play" data-act="resume">' + PLAY_IC + 'Keep going</button></div>';
      o.className = 'sn-overlay show mid';
    } else {
      o.innerHTML = '';
      o.className = 'sn-overlay';
    }
  }

  function renderOpps() {
    if (!multi) { el.opps.hidden = true; return; }
    const others = CG.race.others();
    if (!others.length) { el.opps.hidden = true; return; }
    const wasHidden = el.opps.hidden;
    el.opps.hidden = false;
    const top = Math.max(10, S ? S.score : 0, ...others.map((o) => Number(o.state.score) || 0));
    el.opps.innerHTML = others.map((o) => {
      const sc = Number(o.state.score) || 0, alive = o.state.alive !== false;
      return `<div class="op${alive ? '' : ' out'}"><div class="op-top"><i style="background:${esc(o.color)}"></i><b>${esc(o.name)}</b><span>${sc}${alive ? '' : CG.icon('flag', 13)}</span></div>` +
        `<div class="op-bar"><u style="width:${Math.round(100 * sc / top)}%;background:${esc(o.color)}"></u></div>` +
        `<div class="op-len">${CG.icon('worm', 13)} ${Number(o.state.len) || START_LEN}</div></div>`;
    }).join('');
    if (wasHidden) layout();
  }

  // ---------- Drawing ----------
  const cx = (x) => (x + 0.5) * cell;

  function drawApple(a, now, scale) {
    const x = cx(a.x), y = cx(a.y);
    const bob = 1 + Math.sin(now / 260 + a.x) * 0.035;
    const s = scale * bob;
    if (s <= 0.01) return;
    const r = cell * 0.36 * s;
    g.save();
    g.translate(x, y);
    // shadow
    g.fillStyle = 'rgba(0,0,0,.14)';
    g.beginPath(); g.ellipse(0, cell * 0.32 * scale, r * 0.9, r * 0.32, 0, 0, Math.PI * 2); g.fill();
    if (a.gold) {
      g.shadowColor = 'rgba(255,200,40,.85)';
      g.shadowBlur = cell * 0.5;
    }
    const grd = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
    if (a.gold) { grd.addColorStop(0, '#fff6c2'); grd.addColorStop(0.45, '#ffd23f'); grd.addColorStop(1, '#f19a00'); }
    else { grd.addColorStop(0, '#ff8a80'); grd.addColorStop(0.5, pal.apple); grd.addColorStop(1, pal.appleDark); }
    g.fillStyle = grd;
    // apple shape: two overlapping circles make the little dip at the top
    g.beginPath();
    g.arc(-r * 0.28, 0, r * 0.82, 0, Math.PI * 2);
    g.arc(r * 0.28, 0, r * 0.82, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    // highlight
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath(); g.ellipse(-r * 0.42, -r * 0.3, r * 0.2, r * 0.13, -0.6, 0, Math.PI * 2); g.fill();
    // stem and leaf
    g.strokeStyle = pal.stem; g.lineWidth = Math.max(1.5, cell * 0.06); g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -r * 0.6); g.quadraticCurveTo(r * 0.05, -r * 0.95, r * 0.18, -r * 1.12); g.stroke();
    g.fillStyle = a.gold ? '#7bd37b' : pal.leaf;
    g.beginPath(); g.ellipse(r * 0.42, -r * 0.92, r * 0.3, r * 0.14, -0.5, 0, Math.PI * 2); g.fill();
    if (a.gold) {
      // twinkles
      for (let i = 0; i < 3; i++) {
        const ang = now / 700 + i * 2.1, rr = r * 1.35;
        const tw = 0.5 + 0.5 * Math.sin(now / 180 + i * 1.7);
        star(Math.cos(ang) * rr, Math.sin(ang) * rr, cell * 0.09 * tw + cell * 0.02);
      }
    }
    g.restore();
  }
  function star(x, y, r) {
    g.fillStyle = '#fffbe6';
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r);
    g.fill();
  }

  function snakePoints(t) {
    const b = S.body, n = b.length;
    const pts = [];
    const h0 = b[1] || b[0];
    pts.push({ x: lerp(h0.x, b[0].x, t), y: lerp(h0.y, b[0].y, t) });
    for (let i = 1; i < n; i++) pts.push(b[i]);
    pts.push({ x: lerp(S.prevTail.x, b[n - 1].x, t), y: lerp(S.prevTail.y, b[n - 1].y, t) });
    return pts;
  }

  function strokePath(pts, ox, oy) {
    g.beginPath();
    g.moveTo(cx(pts[0].x) + ox, cx(pts[0].y) + oy);
    for (let i = 1; i < pts.length; i++) g.lineTo(cx(pts[i].x) + ox, cx(pts[i].y) + oy);
    g.stroke();
  }

  function drawSnake(now, t, dt) {
    const pts = snakePoints(t);
    const dying = phase === 'dying' || phase === 'over';
    let bx = 0, by = 0;
    if (dying && S.bump) {
      const k = clamp((now - S.deathAt) / 260, 0, 1);
      const amt = Math.sin(k * Math.PI) * 0.28;
      bx = S.bump.x * amt; by = S.bump.y * amt;
      pts[0] = { x: pts[0].x + bx, y: pts[0].y + by };
    }
    const bodyCol = dying && S.cause !== 'won' ? mix(pal.snake, '#9aa3b5', 0.45) : pal.snake;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = pal.shadow; g.lineWidth = cell * 0.78;
    strokePath(pts, 0, cell * 0.09);
    g.strokeStyle = bodyCol; g.lineWidth = cell * 0.76;
    strokePath(pts, 0, 0);
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = cell * 0.26;
    strokePath(pts, -cell * 0.05, -cell * 0.1);

    // head direction, turned smoothly
    const p0 = pts[0], p1 = pts[1];
    let target = Math.atan2(S.dir.y, S.dir.x);
    if (p1 && (Math.abs(p0.x - p1.x) + Math.abs(p0.y - p1.y)) > 0.05 && !dying) target = Math.atan2(p0.y - p1.y, p0.x - p1.x);
    let diff = target - S.head.a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    S.head.a += diff * Math.min(1, dt * 0.022);
    const a = S.head.a;
    const hx = cx(p0.x), hy = cx(p0.y);
    g.save();
    g.translate(hx, hy);
    g.rotate(a);
    // tongue
    if (!dying && S.tongueT > 0) {
      const k = Math.sin(S.tongueT * Math.PI);
      const L = cell * 0.36 * k;
      g.strokeStyle = pal.tongue; g.lineWidth = Math.max(1.5, cell * 0.075); g.lineCap = 'round';
      g.beginPath(); g.moveTo(cell * 0.32, 0); g.lineTo(cell * 0.32 + L, 0);
      g.lineTo(cell * 0.32 + L + cell * 0.1 * k, -cell * 0.07 * k);
      g.moveTo(cell * 0.32 + L, 0); g.lineTo(cell * 0.32 + L + cell * 0.1 * k, cell * 0.07 * k);
      g.stroke();
    }
    g.fillStyle = bodyCol;
    g.beginPath(); g.ellipse(cell * 0.05, 0, cell * 0.48, cell * 0.45, 0, 0, Math.PI * 2); g.fill();
    // eyes
    const blink = S.blinkT > 0 || dying;
    let lx = 0, ly = 0;
    if (S.apple && !dying) {
      const ax = cx(S.apple.x) - hx, ay = cx(S.apple.y) - hy;
      const la = Math.atan2(ay, ax) - a;
      lx = Math.cos(la) * cell * 0.05; ly = Math.sin(la) * cell * 0.05;
    }
    for (const side of [-1, 1]) {
      const ex = cell * 0.13, ey = side * cell * 0.22;
      g.fillStyle = pal.eye;
      g.beginPath(); g.arc(ex, ey, cell * 0.175, 0, Math.PI * 2); g.fill();
      if (blink) {
        g.fillStyle = bodyCol;
        g.beginPath(); g.arc(ex, ey, cell * 0.185, 0, Math.PI * 2); g.fill();
        g.strokeStyle = pal.pupil; g.lineWidth = Math.max(1.2, cell * 0.05); g.lineCap = 'round';
        g.beginPath();
        if (dying && S.cause !== 'won') { // little dizzy squiggle
          g.moveTo(ex - cell * 0.07, ey - cell * 0.07); g.lineTo(ex + cell * 0.07, ey + cell * 0.07);
          g.moveTo(ex + cell * 0.07, ey - cell * 0.07); g.lineTo(ex - cell * 0.07, ey + cell * 0.07);
        } else g.arc(ex, ey, cell * 0.09, 0.2, Math.PI - 0.2);
        g.stroke();
      } else {
        g.fillStyle = pal.pupil;
        g.beginPath(); g.arc(ex + lx, ey + ly, cell * 0.095, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(ex + lx + cell * 0.03, ey + ly - cell * 0.03, cell * 0.03, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  function mix(c1, c2, k) {
    const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const a = p(c1), b = p(c2);
    return '#' + a.map((v, i) => Math.round(lerp(v, b[i], k)).toString(16).padStart(2, '0')).join('');
  }

  function drawFx(dt) {
    const f = dt / 16.7;
    for (const p of particles) {
      p.life -= (p.ring ? 0.05 : 0.028) * f;
      if (p.ring) {
        const k = 1 - p.life;
        g.strokeStyle = p.c; g.globalAlpha = Math.max(0, p.life) * 0.8; g.lineWidth = cell * 0.08;
        g.beginPath(); g.arc(p.x, p.y, cell * (0.3 + k * 0.6), 0, Math.PI * 2); g.stroke();
      } else {
        p.x += p.vx * f; p.y += p.vy * f; p.vy += cell * 0.004 * f; p.vx *= 0.97; p.vy *= 0.97;
        g.fillStyle = p.c; g.globalAlpha = Math.max(0, p.life);
        g.beginPath(); g.arc(p.x, p.y, p.r * (0.5 + p.life * 0.5), 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
    particles = particles.filter((p) => p.life > 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const fl of floaters) {
      fl.life -= 0.022 * f;
      fl.y -= cell * 0.02 * f;
      g.globalAlpha = Math.max(0, Math.min(1, fl.life * 1.6));
      g.font = `800 ${Math.round(cell * (fl.gold ? 0.62 : 0.5))}px Outfit, system-ui, sans-serif`;
      g.lineWidth = cell * 0.12; g.strokeStyle = 'rgba(0,0,0,.25)';
      g.strokeText(fl.text, fl.x, fl.y);
      g.fillStyle = fl.gold ? '#ffd23f' : '#ffffff';
      g.fillText(fl.text, fl.x, fl.y);
    }
    g.globalAlpha = 1;
    floaters = floaters.filter((x) => x.life > 0);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!S || !bw) return;
    const dt = Math.min(100, now - (lastFrame || now));
    lastFrame = now;

    if (phase === 'playing' && !multi && CG.modalOpen()) pause();
    if (phase === 'playing') {
      S.acc += dt;
      let guard = 0;
      while (S.acc >= S.stepMs && phase === 'playing' && guard++ < 4) { S.acc -= S.stepMs; step(now); }
    }
    // little life: blinking and tongue flicks
    if (S.blinkT > 0) S.blinkT = Math.max(0, S.blinkT - dt / 140);
    else if (now > S.blinkAt) { S.blinkT = 1; S.blinkAt = now + 2200 + Math.random() * 3200; }
    if (S.tongueT > 0) { S.tongueT += dt / 360; if (S.tongueT >= 1) S.tongueT = 0; }
    else if (now > S.tongueAt && phase !== 'dying') { S.tongueT = 0.001; S.tongueAt = now + 1600 + Math.random() * 2600; }

    const t = phase === 'playing' ? clamp(S.acc / S.stepMs, 0, 1) : 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shake > 0) {
      shake = Math.max(0, shake - dt / 380);
      const s = shake * cell * 0.18;
      g.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    g.clearRect(-20, -20, bw + 40, bh + 40);
    g.drawImage(bgCache, 0, 0, bw, bh);

    if (S.eatenApple) drawApple(S.eatenApple, now, Math.max(0, 1 - t * 1.15));
    if (S.apple) {
      const age = now - S.apple.born;
      if (age > 0) drawApple(S.apple, now, easeOutBack(clamp(age / 340, 0, 1)));
    }
    drawSnake(now, t, dt);
    drawFx(dt);

    if (multi && now - oppTimer > 400) { oppTimer = now; renderOpps(); }
  }

  // ---------- Input ----------
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const name = KEYS[e.code];
    if (name) {
      if (CG.modalOpen()) return;
      e.preventDefault();
      onDir(name);
      return;
    }
    if (CG.modalOpen()) return;
    if ((e.code === 'Space' || e.code === 'Enter') && phase === 'ready' && e.target && e.target.closest && e.target.closest('button')) return; // a focused button handles it
    if (e.code === 'Space' || e.code === 'KeyP' || e.code === 'Escape') {
      if (e.code === 'Space') e.preventDefault();
      if (phase === 'playing') pause();
      else if (phase === 'paused') resume();
      else if (phase === 'ready' && e.code === 'Space') start('right');
    } else if (e.code === 'Enter' && phase === 'ready') start('right');
  }

  function bindTouch() {
    let sw = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || CG.modalOpen()) return;
      sw = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    });
    root.addEventListener('pointermove', (e) => {
      if (!sw || e.pointerId !== sw.id) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      sw.x = e.clientX; sw.y = e.clientY; sw.moved = true;   // keep the finger down to chain turns
    });
    const end = (e) => {
      if (!sw || e.pointerId !== sw.id) return;
      const tap = !sw.moved;
      sw = null;
      if (tap && !CG.modalOpen()) { if (phase === 'paused') resume(); }
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', () => { sw = null; });
    root.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
  }

  // ---------- Boot ----------
  CG.mount({
    id: 'snake', title: 'Snake', mode: 'race', scoreLabel: 'points',
    help: '<ul><li>Steer with the <b>arrow keys</b> or <b>WASD</b>. On a phone, <b>swipe</b> anywhere (keep your finger down to make quick turns).</li>' +
      `<li>Tap ${CG.icon('gamepad', 18)} for big arrow buttons.</li>` +
      '<li>Eat apples for <b>10</b> points. Golden apples are worth <b>30</b>!</li>' +
      '<li>Every apple makes you longer and a little faster.</li>' +
      '<li>Don’t bump into the walls or your own tail.</li>' +
      `<li>Space pauses. In <b>${CG.icon('users', 17)} Play together</b> everyone gets the same apples. Most points wins!</li></ul>`,
    onReady(ctx) {
      root = ctx.root; user = ctx.user || '';
      build();
      new ResizeObserver(() => layout()).observe(el.wrap);
      window.addEventListener('resize', layout);
      layout();
      newGame(ctx.seed);
      phase = 'ready';
      renderOverlay();
      window.addEventListener('keydown', onKey);
      bindTouch();
      const mq = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
      if (mq && mq.addEventListener) mq.addEventListener('change', paintBg);
      new MutationObserver(paintBg).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      requestAnimationFrame(frame);
    }
  });

  CG.on('pause', pause);
  CG.on('multiStart', (info) => {
    clearTimeout(overTimer);
    multi = true;
    el.bestPill.hidden = true;
    newGame(info.seed);
    phase = 'playing';
    S.acc = S.stepMs;
    renderOverlay();
    CG.race.update({ score: 0, alive: true, len: S.body.length });
    renderOpps();
    lastFrame = performance.now();
  });
  CG.on('multiEnd', () => {
    multi = false;
    el.bestPill.hidden = false;
    el.opps.hidden = true;
    layout();
    toReady();
  });

  // For tests and curious grown-ups: a read-only peek at the game.
  window.SnakeGame = {
    state: () => S && ({ phase, multi, score: S.score, len: S.body.length, body: S.body.map((p) => ({ ...p })), dir: { ...S.dir }, apple: S.apple && { ...S.apple }, apples: S.log.slice(), stepMs: S.stepMs, cell })
  };
})();
