// Dino Dash: a friendly endless runner for Chowaniec Games (see /games/README.md).
// Everything is drawn on one canvas. The course (cacti, birds, coins) is generated from a seed by
// distance, so in a race every player gets exactly the same course.
(function () {
  'use strict';
  const CG = window.ChowGames;

  // ---------- Tuning (world units; the dino is about 48 tall) ----------
  const DINO_X = 58;                       // dino's distance from the left edge of the view
  const JUMP_V = 650;                      // take-off speed
  const G = 3300;                          // normal gravity
  const G_HOLD = 1750;                     // gravity while the jump is held and rising
  const G_FAST = 7600;                     // fast fall (duck in the air)
  const HOLD_MAX = 0.3;                    // how long holding makes the jump higher
  const JUMP_MAX_H = 120;                  // about the top of a held jump (for race.y)
  const BUFFER = 0.14;                     // a press just before landing still jumps
  const COYOTE = 0.08;                     // ...and just after running off nothing (kept for feel)
  const SPEED0 = 285, SPEED_GAIN = 335, SPEED_K = 34000;
  const speedAt = (d) => SPEED0 + SPEED_GAIN * (1 - Math.exp(-d / SPEED_K));
  const scoreOf = (d, bonus) => Math.floor(d / 20) + bonus;
  const STEP = 1 / 120;
  const DAY_LEN = 26000;                   // distance for one full day/night cycle

  const qs = new URLSearchParams(location.search);
  let AUTOPLAY = qs.has('autoplay');     // a little robot plays (handy for testing)

  // ---------- Colour helpers ----------
  const rgbCache = {};
  function rgb(hex) {
    if (rgbCache[hex]) return rgbCache[hex];
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    rgbCache[hex] = v;
    return v;
  }
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    const c = (i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0');
    return '#' + c(0) + c(1) + c(2);
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  function hash(n) { // 0..1, stable for an integer
    let x = (n | 0) * 374761393 + 668265263;
    x = (x ^ (x >>> 13)) * 1274126177;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  const DINO_COLORS = { body: '#5fd68a', dark: '#2e8f57', belly: '#d4f7c4', spike: '#ffb547', cheek: '#ff8fab' };
  function tintColors(color) {
    return { body: color, dark: mix(color, '#000000', 0.38), belly: mix(color, '#ffffff', 0.6), spike: mix(color, '#ffffff', 0.35), cheek: '#ff8fab' };
  }

  // Sky palettes through the day (t = 0..1 of DAY_LEN).
  const PAL = {
    day: { top: '#74c4ff', bot: '#dcf3ff', far: '#a9dfc9', near: '#7bd09a', grass: '#5bc56f', soil: '#f6d896', soil2: '#e9bd6e', cloud: '#ffffff', stars: 0 },
    dusk: { top: '#ff8fa8', bot: '#ffd9a3', far: '#dcaecb', near: '#b5c88c', grass: '#6db85e', soil: '#f1c582', soil2: '#dba660', cloud: '#ffeaf1', stars: 0.15 },
    night: { top: '#1f2d68', bot: '#5061a3', far: '#40528f', near: '#2f6c70', grass: '#2f9264', soil: '#b19468', soil2: '#8f7552', cloud: '#a3aedd', stars: 1 },
    dawn: { top: '#9f8ef2', bot: '#ffc8e2', far: '#bcb3ea', near: '#8fcaa9', grass: '#57b975', soil: '#f0d194', soil2: '#dab26f', cloud: '#fff1f8', stars: 0.3 }
  };
  const KEYS = [[0, 'day'], [0.5, 'day'], [0.6, 'dusk'], [0.68, 'night'], [0.86, 'night'], [0.94, 'dawn'], [1, 'day']];
  function palette(dist) {
    const t = ((dist / DAY_LEN) % 1 + 1) % 1;
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
    const [t0, a] = KEYS[i], [t1, b] = KEYS[i + 1];
    const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    const A = PAL[a], B = PAL[b], out = {};
    for (const key in A) out[key] = typeof A[key] === 'number' ? lerp(A[key], B[key], k) : mix(A[key], B[key], k);
    out.t = t;
    return out;
  }

  // ---------- State ----------
  let canvas, ctx, root, cssW = 0, cssH = 0, dpr = 1, scale = 1, viewW = 500, groundY = 300;
  let me = '';
  const S = {
    mode: 'ready',          // ready | playing | paused | dying | over
    multi: false,
    seed: 1, rng: null,
    dist: 0, h: 0, vy: 0, onGround: true, holding: false, holdT: 0, buffer: 0, coyote: 0,
    duckKey: false, duckTouch: false, bonus: 0, jumpD: -1e9,
    obs: [], items: [], nextX: 0,
    time: 0, runPhase: 0, deadT: 0, dustT: 0, shake: 0, flash: 0, lastHundred: 0,
    hi: 0, overSent: false
  };
  let parts = [];
  let floats = [];
  const ghosts = {};          // name -> smoothed { dist, h }
  const decoRand = CG.rng(Math.floor(Math.random() * 1e9));
  const clouds = Array.from({ length: 9 }, (_, i) => ({ x: decoRand() * 1400, y: 0.15 + decoRand() * 0.7, s: 0.6 + decoRand() * 0.8, k: 0.05 + decoRand() * 0.1, i }));
  const stars = Array.from({ length: 60 }, () => ({ x: decoRand(), y: decoRand(), r: 0.6 + decoRand() * 1.4, p: decoRand() * 6.28 }));

  const ducking = () => S.duckKey || S.duckTouch;
  const blocked = () => CG.modalOpen() || !!document.getElementById('cg-countdown');
  const hiKey = () => 'chowaniec_dino_hi_' + (me || 'me');

  // ---------- Course (seeded) ----------
  const CACTUS = { s: [18, 32], m: [22, 42], l: [27, 52] };

  function reset(seed) {
    S.seed = seed >>> 0 || 1;
    S.rng = CG.rng(S.seed);
    S.dist = 0; S.h = 0; S.vy = 0; S.onGround = true; S.holding = false; S.holdT = 0; S.buffer = 0; S.coyote = 0;
    S.duckKey = false; S.duckTouch = false; S.bonus = 0; S.jumpD = -1e9;
    S.obs = []; S.items = []; S.nextX = 820;
    S.runPhase = 0; S.deadT = 0; S.dustT = 0; S.shake = 0; S.flash = 0; S.lastHundred = 0; S.overSent = false;
    parts = []; floats = [];
    for (const k in ghosts) delete ghosts[k];
    extendCourse();
  }

  function extendCourse() {
    const until = S.dist + viewW + 400;
    while (S.nextX < until) genNext();
    while (S.obs.length && S.obs[0].x + S.obs[0].w < S.dist - DINO_X - 80) S.obs.shift();
    while (S.items.length && (S.items[0].x < S.dist - DINO_X - 40)) S.items.shift();
  }

  function genNext() {
    const r = S.rng, x = S.nextX, sp = speedAt(x), f = (sp - SPEED0) / SPEED_GAIN;
    const birdChance = x < 5200 ? 0 : Math.min(0.3, 0.12 + (x - 5200) / 70000);
    let o;
    if (r() < birdChance) {
      const low = r() < 0.5;
      o = { kind: 'bird', x, w: 46, h: 30, y: low ? 12 : 40, phase: r() * 6.28, hue: r() };
    } else {
      const roll = r();
      let kinds;
      if (x < 2600) kinds = roll < 0.6 ? ['s'] : ['m'];
      else if (roll < 0.26) kinds = ['s'];
      else if (roll < 0.48) kinds = ['m'];
      else if (roll < 0.64) kinds = ['l'];
      else if (roll < 0.8) kinds = ['s', 's'];
      else if (roll < 0.91) kinds = ['m', 's'];
      else kinds = f > 0.22 ? ['s', 'l', 's'] : ['s', 'm'];
      const pieces = [];
      let px = 0, maxH = 0;
      for (const k of kinds) {
        const [w, h] = CACTUS[k];
        pieces.push({ dx: px, w, h, arms: Math.floor(r() * 4), flower: r() < 0.55 ? Math.floor(r() * 3) : -1 });
        px += w + 1;
        maxH = Math.max(maxH, h);
      }
      o = { kind: 'cactus', x, w: px - 1, h: maxH, pieces };
    }
    S.obs.push(o);
    const gapT = (1.3 - 0.48 * f) + r() * (1.05 - 0.4 * f);
    const gap = Math.max(sp * gapT, 300 + o.w);
    S.nextX = x + o.w + gap;
    // Coins in an arc over cacti, a row of coins (or an egg) in long gaps.
    if (o.kind === 'cactus' && r() < 0.32) {
      const cx = x + o.w / 2, top = o.h + 20;
      [-34, 0, 34].forEach((dx, i) => S.items.push({ kind: 'coin', x: cx + dx, h: top + (i === 1 ? 20 : 4), got: false }));
    }
    if (gap > 420 && r() < 0.34) {
      const mid = x + o.w + gap / 2;
      if (r() < 0.18) S.items.push({ kind: 'egg', x: mid, h: r() < 0.5 ? 18 : 70, got: false });
      else for (let i = -1.5; i <= 1.5; i++) S.items.push({ kind: 'coin', x: mid + i * 28, h: 18, got: false });
    }
  }

  // Hitboxes in world space, y = height above ground.
  function dinoBoxes(dist, h, duck) {
    const x = dist;
    if (duck && S.onGround) return [[x + 6, x + 52, h + 3, h + 23]];
    return [[x + 8, x + 31, h + 6, h + 33], [x + 23, x + 42, h + 27, h + 45]];
  }
  function obstacleBoxes(o) {
    if (o.kind === 'bird') return [[o.x + 7, o.x + 39, o.y + 7, o.y + 22]];
    return o.pieces.map((p) => [o.x + p.dx + 3.5, o.x + p.dx + p.w - 3.5, 0, p.h - 5]);
  }
  const overlap = (a, b) => a[0] < b[1] && a[1] > b[0] && a[2] < b[3] && a[3] > b[2];

  // ---------- Game flow ----------
  function startSolo() {
    S.multi = false;
    reset(Math.floor(Math.random() * 2 ** 31));
    S.mode = 'playing';
    CG.sfx('go');
  }

  function crash() {
    S.mode = 'dying';
    S.deadT = 0;
    S.shake = 9;
    S.holding = false;
    CG.sfx('crash');
    const cx = S.dist + 34, ch = S.h + 40;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      parts.push({ kind: 'spark', x: cx, h: ch, vx: Math.cos(a) * (120 + Math.random() * 90), vy: Math.sin(a) * (120 + Math.random() * 90), life: 0.6, max: 0.6, size: 4 + Math.random() * 3, color: ['#ffd23f', '#ff8fab', '#7cc8ff', '#ffffff'][i % 4], g: 300 });
    }
  }

  function finish() {
    if (S.overSent) return;
    S.overSent = true;
    S.mode = 'over';
    const score = scoreOf(S.dist, S.bonus);
    if (score > S.hi) { S.hi = score; try { localStorage.setItem(hiKey(), String(score)); } catch (e) { /* ignore */ } }
    if (S.multi) CG.gameOver({ score });
    else CG.gameOver({ score, title: score >= 1000 ? 'Amazing run!' : 'Bonk! Game over', again: () => startSolo() });
  }

  // ---------- Input ----------
  function press(fromPointer) {
    if (blocked()) return;
    if (S.mode === 'ready') { if (fromPointer) return; startSolo(); } // on screen: the buttons choose (keys start practice)
    else if (S.mode === 'paused') { S.mode = 'playing'; return; }
    if (S.mode !== 'playing') return;
    S.holding = true;
    S.buffer = BUFFER;
  }
  function release() { S.holding = false; }

  let touch = null;
  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    touch = { id: e.pointerId, y: e.clientY, t: performance.now(), swiped: false };
    press(true);
  }
  function onPointerMove(e) {
    if (!touch || e.pointerId !== touch.id || touch.swiped) return;
    if (e.clientY - touch.y > 26) {
      touch.swiped = true;
      S.duckTouch = true;
      S.holding = false;
      // A swipe that started with a tap: cut that little hop short.
      if (!S.onGround && performance.now() - touch.t < 180 && S.vy > 0) S.vy = 0;
    }
  }
  function onPointerUp(e) {
    if (touch && e.pointerId !== touch.id) return;
    touch = null;
    S.duckTouch = false;
    release();
  }

  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
  const DUCK_KEYS = ['ArrowDown', 'KeyS'];
  function onKeyDown(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return;
    if (blocked()) return;
    if (JUMP_KEYS.includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) press();
    } else if (DUCK_KEYS.includes(e.code)) {
      e.preventDefault();
      S.duckKey = true;
      S.holding = false;
    } else if ((e.code === 'KeyP' || e.code === 'Escape') && !S.multi) {
      if (S.mode === 'playing') S.mode = 'paused';
      else if (S.mode === 'paused') S.mode = 'playing';
    }
  }
  function onKeyUp(e) {
    if (JUMP_KEYS.includes(e.code)) release();
    if (DUCK_KEYS.includes(e.code)) S.duckKey = false;
  }

  // ---------- Simulation ----------
  function step(dt) {
    if (S.mode !== 'playing') return;
    const sp = speedAt(S.dist);
    S.dist += sp * dt;
    S.runPhase += sp * dt * 0.055;
    if (AUTOPLAY) robot(sp);

    // Jumping
    if (S.buffer > 0) S.buffer -= dt;
    S.coyote = S.onGround ? COYOTE : S.coyote - dt;
    if (S.buffer > 0 && S.coyote > 0 && S.vy <= 0) {
      S.vy = JUMP_V; S.onGround = false; S.buffer = 0; S.coyote = 0; S.holdT = 0; S.jumpD = S.dist;
      CG.sfx('jump');
      for (let i = 0; i < 4; i++) dust(S.dist + 14 + i * 5, 60);
    }
    if (!S.onGround) {
      let g = G;
      if (ducking()) g = G_FAST;
      else if (S.holding && S.vy > 0 && S.holdT < HOLD_MAX) { g = G_HOLD; S.holdT += dt; }
      S.vy -= g * dt;
      S.h += S.vy * dt;
      if (S.h <= 0) {
        S.h = 0; S.vy = 0; S.onGround = true;
        for (let i = 0; i < 6; i++) dust(S.dist + 8 + i * 6, 90);
      }
    }

    // Running dust
    if (S.onGround) {
      S.dustT -= dt;
      if (S.dustT <= 0) { S.dustT = 0.075; dust(S.dist + 10, 30); }
    }

    extendCourse();

    // Collisions
    const boxes = dinoBoxes(S.dist, S.h, ducking());
    for (const o of S.obs) {
      if (o.x > S.dist + 70) break;
      if (o.x + o.w < S.dist) continue;
      const ob = obstacleBoxes(o);
      if (boxes.some((a) => ob.some((b) => overlap(a, b)))) { crash(); return; }
    }
    for (const it of S.items) {
      if (it.got) continue;
      if (it.x > S.dist + 80) break;
      const r = it.kind === 'egg' ? 14 : 13;
      const box = [it.x - r, it.x + r, it.h - r, it.h + r];
      if (boxes.some((a) => overlap(a, box))) {
        it.got = true;
        const pts = it.kind === 'egg' ? 25 : 5;
        S.bonus += pts;
        CG.sfx(it.kind === 'egg' ? 'score' : 'coin');
        floats.push({ x: it.x, h: it.h + 10, text: '+' + pts, life: 0.9, color: it.kind === 'egg' ? '#ff7eb6' : '#f5a300' });
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          parts.push({ kind: 'spark', x: it.x, h: it.h, vx: Math.cos(a) * 110 + sp * 0.6, vy: Math.sin(a) * 110, life: 0.45, max: 0.45, size: 3, color: it.kind === 'egg' ? '#ffc2dc' : '#ffe066', g: 0 });
        }
      }
    }

    const score = scoreOf(S.dist, S.bonus);
    const hundred = Math.floor(score / 100);
    if (hundred > S.lastHundred) { S.lastHundred = hundred; S.flash = 0.9; CG.sfx('point'); }

    if (S.multi) CG.race.update({ score, y: Math.round(clamp(S.h / JUMP_MAX_H, 0, 1) * 100) / 100, alive: true, dist: Math.round(S.dist), duck: ducking() ? 1 : 0, jd: Math.round(S.jumpD), jh: Math.round(S.holdT * 1000) / 1000 });
  }

  function dust(x, spread) {
    parts.push({ kind: 'dust', x, h: 2, vx: speedAt(S.dist) * (0.45 + Math.random() * 0.25) - spread * Math.random(), vy: 20 + Math.random() * 40, life: 0.45, max: 0.45, size: 2.5 + Math.random() * 3.5, g: -30 });
  }

  // A small robot pilot for ?autoplay (testing): jumps cacti and low birds, ducks mid birds.
  function robot(sp) {
    const next = S.obs.find((o) => o.x + o.w > S.dist + 4);
    S.duckKey = false;
    if (!next) { S.holding = false; return; }
    const gap = next.x - (S.dist + 40);
    if (next.kind === 'bird' && next.y > 30) { S.duckKey = gap < 70 && gap > -next.w - 50; S.holding = false; return; }
    const lead = sp * 0.11 + (next.w > 40 || next.h > 45 ? 18 : 0);
    if (S.onGround && gap < lead && gap > -10) { S.holding = true; S.buffer = BUFFER; }
    if (!S.onGround && S.holdT > (next.w > 40 || next.h > 45 ? 0.3 : 0.12)) S.holding = false;
  }

  function update(dt) {
    S.time += dt;
    if (S.mode === 'playing' && !S.multi && CG.modalOpen()) S.mode = 'paused';
    if (S.mode === 'playing') {
      acc += dt;
      while (acc >= STEP && S.mode === 'playing') { step(STEP); acc -= STEP; }
    } else acc = 0;
    if (S.mode === 'dying') {
      S.deadT += dt;
      if (S.deadT > 0.85) finish();
    }
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 30);
    if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
    for (const p of parts) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.h += p.vy * dt;
      p.vy -= (p.g || 0) * dt;
    }
    parts = parts.filter((p) => p.life > 0);
    for (const f of floats) { f.life -= dt; f.h += 40 * dt; }
    floats = floats.filter((f) => f.life > 0);
    updateGhosts(dt);
  }
  let acc = 0;

  // Height of a jump that took off at distance jd with the button held for jh seconds, at distance d.
  function jumpHeightAt(jd, jh, d) {
    const t = (d - jd) / speedAt(jd);
    if (!(t > 0) || t > 1.2) return 0;
    const th = Math.min(jh, HOLD_MAX);
    let h;
    if (t <= th) h = JUMP_V * t - 0.5 * G_HOLD * t * t;
    else {
      const t2 = t - th;
      h = JUMP_V * th - 0.5 * G_HOLD * th * th + (JUMP_V - G_HOLD * th) * t2 - 0.5 * G * t2 * t2;
    }
    return Math.max(0, h);
  }

  function ghostPose(d) {
    for (const o of S.obs) {
      if (o.x > d + 400) break;
      if (o.x + o.w < d - 60) continue;
      if (o.kind === 'bird' && o.y > 30) { if (o.x - d < 70 && o.x + o.w - d > -50) return { h: 0, duck: true }; continue; }
      const big = o.w > 30 || o.h > 45 || o.kind === 'bird';
      const sp = speedAt(o.x);
      const peakT = big ? HOLD_MAX + (JUMP_V - G_HOLD * HOLD_MAX) / G : JUMP_V / G;
      const jd = o.x + o.w / 2 - 26 - sp * peakT;
      const h = jumpHeightAt(jd, big ? HOLD_MAX : 0, d);
      if (h > 0) return { h, duck: false };
    }
    return { h: 0, duck: false };
  }

  function updateGhosts(dt) {
    if (!S.multi) return;
    const seen = {};
    for (const o of CG.race.others()) {
      const st = o.state || {};
      seen[o.name] = true;
      const alive = st.alive !== false;
      const target = (Number(st.dist) || 0) + (alive && S.mode === 'playing' ? speedAt(Number(st.dist) || 0) * Math.min(o.age, 1500) / 1000 : 0);
      let g = ghosts[o.name];
      if (!g) g = ghosts[o.name] = { dist: target, h: 0, color: o.color, name: o.name };
      g.color = o.color; g.alive = alive; g.duck = !!st.duck; g.score = st.score || 0;
      if (alive && S.mode === 'playing') g.dist += speedAt(g.dist) * dt;
      g.dist += (target - g.dist) * Math.min(1, dt * 3);
      // Replay their jump from where it started, so it lines up with the (identical) course.
      // Their updates are up to ~0.6 s old, too late for a half-second jump, so a ghost that is still
      // alive is also shown clearing whatever is in front of it (they must have, to still be running).
      let target_h = st.jd != null ? jumpHeightAt(Number(st.jd), Number(st.jh) || 0, g.dist) : (Number(st.y) || 0) * JUMP_MAX_H;
      g.autoDuck = false;
      if (alive) {
        const pose = ghostPose(g.dist);
        target_h = Math.max(target_h, pose.h);
        g.autoDuck = pose.duck;
      }
      g.h += (target_h - g.h) * Math.min(1, dt * 18);
      g.phase = (g.phase || 0) + (alive ? dt * 16 : 0);
    }
    for (const k in ghosts) if (!seen[k]) delete ghosts[k];
  }

  // ---------- Drawing ----------
  const sx = (wx) => (wx - S.dist + DINO_X) * scale;
  const sy = (wh) => groundY - wh * scale;

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
  }
  function ell(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

  function render() {
    const pal = palette(S.dist);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, pal.top);
    sky.addColorStop(1, pal.bot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cssW, cssH);

    let shx = 0, shy = 0;
    if (S.shake > 0) { shx = (Math.random() - 0.5) * S.shake; shy = (Math.random() - 0.5) * S.shake; }
    ctx.translate(shx, shy);

    drawSkyBodies(pal);
    drawClouds(pal);
    drawHills(pal);
    drawGround(pal);
    drawItems();
    for (const o of S.obs) {
      const x = sx(o.x);
      if (x > cssW + 10 || x + o.w * scale < -10) continue;
      if (o.kind === 'bird') drawBird(o, x, sy(o.y));
      else drawCactus(o, x, sy(0));
    }
    drawGhosts();
    const dead = S.mode === 'dying' || S.mode === 'over';
    const idle = S.mode === 'ready';
    drawDino(sx(S.dist), sy(S.h), scale, {
      colors: DINO_COLORS, duck: ducking() && S.onGround && !dead, phase: S.runPhase, air: !S.onGround,
      dead, idle, time: S.time, deadT: S.deadT
    });
    drawGhostLabels();
    drawParticles();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawHud(pal);
    drawOverlay();
  }

  function drawSkyBodies(pal) {
    const skyH = groundY;
    if (pal.stars > 0.02) {
      ctx.fillStyle = '#ffffff';
      for (const s of stars) {
        ctx.globalAlpha = pal.stars * (0.55 + 0.45 * Math.sin(S.time * 2 + s.p));
        circ(s.x * cssW, s.y * skyH * 0.75, s.r);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const t = pal.t;
    const r = Math.max(16, 22 * scale);
    // Sun across the day part, moon at night.
    const sunK = clamp(t / 0.66, 0, 1);
    const sunX = cssW * (0.85 - 0.25 * sunK), sunY = skyH * (0.18 + 0.5 * Math.pow(sunK, 3));
    const sunA = clamp(1 - pal.stars * 1.2, 0, 1);
    if (sunA > 0.01) {
      ctx.globalAlpha = sunA * 0.25;
      ctx.fillStyle = '#fff3b0';
      circ(sunX, sunY, r * 1.9); ctx.fill();
      ctx.globalAlpha = sunA;
      ctx.fillStyle = '#ffe066';
      circ(sunX, sunY, r); ctx.fill();
      ctx.fillStyle = '#fff6c4';
      circ(sunX - r * 0.3, sunY - r * 0.3, r * 0.35); ctx.fill();
    }
    if (pal.stars > 0.3) {
      const mA = clamp((pal.stars - 0.3) / 0.7, 0, 1);
      const mx = cssW * 0.78, my = skyH * 0.2;
      ctx.globalAlpha = mA * 0.2;
      ctx.fillStyle = '#e8ecff';
      circ(mx, my, r * 1.7); ctx.fill();
      ctx.globalAlpha = mA;
      ctx.fillStyle = '#f4f1ff';
      circ(mx, my, r * 0.9); ctx.fill();
      ctx.fillStyle = '#d9d6f2';
      circ(mx - r * 0.3, my - r * 0.15, r * 0.18); ctx.fill();
      circ(mx + r * 0.25, my + r * 0.3, r * 0.13); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  }

  function cloudShape(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 14 * s, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(x + 16 * s, y - 10 * s, 16 * s, Math.PI, Math.PI * 1.85);
    ctx.arc(x + 36 * s, y - 6 * s, 13 * s, Math.PI * 1.2, Math.PI * 1.95);
    ctx.arc(x + 48 * s, y, 12 * s, Math.PI * 1.5, Math.PI * 0.5);
    ctx.closePath();
  }
  function drawClouds(pal) {
    const span = cssW + 260;
    for (const c of clouds) {
      const drift = S.dist * c.k * scale + S.time * 6;
      const x = ((c.x - drift) % span + span) % span - 120;
      const y = groundY * c.y * 0.8 + 10;
      const s = c.s * Math.max(0.8, scale);
      ctx.fillStyle = mix(pal.cloud, pal.top, 0.28);
      cloudShape(x, y + 3 * s, s); ctx.fill();
      ctx.fillStyle = pal.cloud;
      ctx.globalAlpha = 0.95;
      cloudShape(x, y, s); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function hill(offset, base, amp, wl, color, seed) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, groundY + 2);
    for (let x = 0; x <= cssW + 12; x += 12) {
      const u = (x + offset) / scale;
      const y = base - amp * (0.55 + 0.3 * Math.sin(u / wl + seed) + 0.15 * Math.sin(u / (wl * 0.37) + seed * 2));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(cssW, groundY + 2);
    ctx.closePath();
    ctx.fill();
  }
  function drawHills(pal) {
    hill(S.dist * 0.12 * scale, groundY, 70 * scale, 70, pal.far, 1.3);
    hill(S.dist * 0.3 * scale, groundY, 32 * scale, 42, pal.near, 4.1);
    // A few round bushes on the near hills
    const bw = 170;
    const off = S.dist * 0.3;
    const first = Math.floor((off - 40) / bw);
    ctx.fillStyle = mix(pal.near, '#1d5e3a', 0.18);
    for (let i = first; i < first + cssW / scale / bw + 3; i++) {
      if (hash(i * 7) < 0.45) continue;
      const x = (i * bw - off) * scale + hash(i) * 60 * scale;
      const r = (8 + hash(i * 3) * 8) * scale;
      circ(x, groundY - 2 * scale, r); ctx.fill();
      circ(x + r * 0.9, groundY - 1 * scale, r * 0.75); ctx.fill();
    }
  }

  function drawGround(pal) {
    const soil = ctx.createLinearGradient(0, groundY, 0, cssH);
    soil.addColorStop(0, pal.soil);
    soil.addColorStop(1, pal.soil2);
    ctx.fillStyle = soil;
    ctx.fillRect(0, groundY, cssW, cssH - groundY + 20);
    // Pebbles and little stripes scroll with the ground.
    const tile = 34;
    const startI = Math.floor((S.dist - DINO_X) / tile) - 1;
    const endI = startI + Math.ceil(viewW / tile) + 3;
    const depth = (cssH - groundY) / scale;
    for (let i = startI; i <= endI; i++) {
      const hsh = hash(i);
      const x = sx(i * tile + hash(i * 13) * tile);
      if (hsh < 0.55) {
        const d = 10 + hash(i * 5) * Math.min(depth - 14, 60);
        ctx.fillStyle = mix(pal.soil2, '#8a6236', 0.25);
        ell(x, groundY + d * scale, (2 + hash(i * 9) * 3) * scale, (1.4 + hash(i * 11) * 1.5) * scale);
        ctx.fill();
      }
      if (hsh > 0.82 && depth > 70) {
        const d = 40 + hash(i * 17) * Math.min(depth - 50, 120);
        ctx.fillStyle = mix(pal.soil, '#ffffff', 0.25);
        rr(x, groundY + d * scale, 14 * scale, 3 * scale, 1.5 * scale);
        ctx.fill();
      }
    }
    // Soft wavy layers deeper down (tall portrait screens show a lot of ground)
    for (let k = 1; k <= 3; k++) {
      const yy = groundY + (k * 62 + 18) * scale;
      if (yy > cssH) break;
      ctx.fillStyle = mix(pal.soil2, '#c08a4a', 0.12 * k);
      ctx.beginPath();
      ctx.moveTo(0, cssH);
      for (let x = 0; x <= cssW + 16; x += 16) {
        const u = x / scale + S.dist;
        ctx.lineTo(x, yy + Math.sin(u / (38 + k * 9) + k * 1.7) * 5 * scale);
      }
      ctx.lineTo(cssW, cssH);
      ctx.closePath();
      ctx.fill();
    }
    // Grass strip with a scalloped edge
    const gh = 7 * scale;
    ctx.fillStyle = pal.grass;
    ctx.beginPath();
    ctx.moveTo(0, groundY + gh);
    const step = Math.max(3, 4 * scale);
    for (let x = 0; x <= cssW + step; x += step) {
      const u = x / scale + S.dist;
      ctx.lineTo(x, groundY - (1.2 + 1.2 * Math.sin(u / 4.5)) * scale);
    }
    ctx.lineTo(cssW, groundY + gh);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = mix(pal.grass, '#1f6b3c', 0.25);
    ctx.fillRect(0, groundY + gh - 2 * scale, cssW, 2.5 * scale);
    // Tufts and flowers on the grass
    const ft = 46;
    const fs = Math.floor((S.dist - DINO_X) / ft) - 1;
    for (let i = fs; i <= fs + Math.ceil(viewW / ft) + 2; i++) {
      const hh = hash(i * 31 + 7);
      const x = sx(i * ft + hash(i * 3 + 1) * ft);
      if (hh < 0.35) {
        ctx.strokeStyle = mix(pal.grass, '#1f6b3c', 0.2);
        ctx.lineWidth = 1.6 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, groundY); ctx.lineTo(x - 2 * scale, groundY - 6 * scale);
        ctx.moveTo(x + 2 * scale, groundY); ctx.lineTo(x + 2.5 * scale, groundY - 8 * scale);
        ctx.moveTo(x + 4 * scale, groundY); ctx.lineTo(x + 6 * scale, groundY - 5 * scale);
        ctx.stroke();
      } else if (hh < 0.48) {
        const fc = ['#ff8fab', '#ffd23f', '#ffffff', '#c4a7ff'][Math.floor(hash(i * 5) * 4)];
        ctx.strokeStyle = mix(pal.grass, '#1f6b3c', 0.3);
        ctx.lineWidth = 1.2 * scale;
        ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(x, groundY - 7 * scale); ctx.stroke();
        ctx.fillStyle = fc;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          circ(x + Math.cos(a) * 2.2 * scale, groundY - 8 * scale + Math.sin(a) * 2.2 * scale, 1.6 * scale); ctx.fill();
        }
        ctx.fillStyle = '#ffb000';
        circ(x, groundY - 8 * scale, 1.2 * scale); ctx.fill();
      }
    }
  }

  function drawItems() {
    for (const it of S.items) {
      if (it.got) continue;
      const x = sx(it.x), y = sy(it.h);
      if (x < -20 || x > cssW + 20) continue;
      const bob = Math.sin(S.time * 5 + it.x * 0.05) * 2 * scale;
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.scale(scale, scale);
      if (it.kind === 'coin') {
        const w = Math.max(0.18, Math.abs(Math.cos(S.time * 4 + it.x * 0.02)));
        ctx.scale(w, 1);
        ctx.fillStyle = '#e59e00';
        circ(0, 1, 8.5); ctx.fill();
        ctx.fillStyle = '#ffd23f';
        circ(0, 0, 8.5); ctx.fill();
        ctx.fillStyle = '#ffe98a';
        circ(0, 0, 5.6); ctx.fill();
        ctx.fillStyle = '#f2b100';
        rr(-1.4, -4, 2.8, 8, 1.4); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        circ(-3.6, -3.6, 1.6); ctx.fill();
      } else {
        ctx.rotate(Math.sin(S.time * 6) * 0.12);
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ell(0, 11, 7, 2); ctx.fill();
        ctx.fillStyle = '#fff6e4';
        ctx.strokeStyle = '#e9b98f';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.bezierCurveTo(7, -11, 9, 2, 8, 4);
        ctx.bezierCurveTo(7, 10, -7, 10, -8, 4);
        ctx.bezierCurveTo(-9, 2, -7, -11, 0, -11);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff9ac4'; circ(-3, -2, 2.2); ctx.fill();
        ctx.fillStyle = '#8fd3ff'; circ(3, 2, 2); ctx.fill();
        ctx.fillStyle = '#ffd23f'; circ(2, -6, 1.6); ctx.fill();
        ctx.fillStyle = '#b8f0a0'; circ(-3, 5, 1.5); ctx.fill();
        // twinkle
        ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + 0.5 * Math.sin(S.time * 8)) + ')';
        star(9, -10, 3.2, 1.2);
      }
      ctx.restore();
    }
  }

  function star(x, y, R, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r : R;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawCactus(o, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const p of o.pieces) {
      const cw = p.w * 0.46, cx = p.dx + (p.w - cw) / 2, h = p.h;
      const shapes = [];
      shapes.push([cx, -h, cw, h, cw / 2]);
      const armW = Math.max(5, cw * 0.62);
      if (p.arms & 1) { // left arm
        const ay = -h * 0.55;
        shapes.push([p.dx, ay - h * 0.22, armW, h * 0.3, armW / 2]);
        shapes.push([p.dx, ay - 2, cx - p.dx + 3, armW, armW / 2]);
      }
      if (p.arms & 2 || p.arms === 0) { // right arm
        const ay = -h * 0.42;
        shapes.push([p.dx + p.w - armW, ay - h * 0.26, armW, h * 0.34, armW / 2]);
        shapes.push([cx + cw - 3, ay, p.dx + p.w - (cx + cw) + 3, armW, armW / 2]);
      }
      // outline pass, then fill pass: one clean silhouette
      ctx.fillStyle = '#1f8a4c';
      for (const s of shapes) { rr(s[0] - 1.6, s[1] - 1.6, s[2] + 3.2, s[3] + 3.2, s[4] + 1.6); ctx.fill(); }
      ctx.fillStyle = '#3cc879';
      for (const s of shapes) { rr(s[0], s[1], s[2], s[3], s[4]); ctx.fill(); }
      // light stripe and spines
      ctx.fillStyle = '#7fe3a6';
      rr(cx + cw * 0.22, -h + cw * 0.35, cw * 0.18, h - cw * 0.6, cw * 0.09); ctx.fill();
      ctx.fillStyle = '#d9fbe6';
      for (let k = 0; k < Math.floor(h / 9); k++) {
        circ(cx + (k % 2 ? cw * 0.78 : cw * 0.55), -h + 7 + k * 8, 0.9); ctx.fill();
      }
      if (p.flower >= 0) {
        const fc = ['#ff7eb6', '#ffd23f', '#ff9f6b'][p.flower];
        ctx.fillStyle = fc;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
          circ(cx + cw / 2 + Math.cos(a) * 2.8, -h - 1 + Math.sin(a) * 2.8, 2.3); ctx.fill();
        }
        ctx.fillStyle = '#fff4b0';
        circ(cx + cw / 2, -h - 1, 1.7); ctx.fill();
      }
    }
    // soft shadow on the ground
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#000';
    ell(o.w / 2, 1.5, o.w / 2 + 3, 2.4); ctx.fill();
    ctx.restore();
  }

  function drawBird(o, x, y) {
    const flap = Math.sin(S.time * 13 + o.phase) * 0.75 + 0.2;
    const bob = Math.sin(S.time * 3 + o.phase) * 2;
    const body = o.hue < 0.5 ? '#b49cff' : '#7fc8ff';
    const dark = o.hue < 0.5 ? '#6d4fd8' : '#2f86c9';
    ctx.save();
    ctx.translate(x, y + bob * scale);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    // shadow
    ctx.globalAlpha = 0.1; ctx.fillStyle = '#000';
    ell(23, o.y + 1 - bob, 14, 2.5); ctx.fill();
    ctx.globalAlpha = 1;
    // back wing
    ctx.fillStyle = mix(body, '#000000', 0.12);
    ctx.beginPath(); ctx.moveTo(22, -17); ctx.quadraticCurveTo(34, -17 - 14 * flap, 42, -16 - 18 * flap); ctx.quadraticCurveTo(34, -12, 28, -12); ctx.closePath(); ctx.fill();
    // tail
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(33, -15); ctx.lineTo(45, -19); ctx.lineTo(44, -11); ctx.closePath(); ctx.fill();
    // body
    ctx.fillStyle = dark; ell(24, -14.5, 13.5, 8.2); ctx.fill();
    ctx.fillStyle = body; ell(24, -14.5, 12, 6.8); ctx.fill();
    ctx.fillStyle = mix(body, '#ffffff', 0.55); ell(22, -11.5, 7, 3.4); ctx.fill();
    // head + crest
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(14, -23); ctx.quadraticCurveTo(20, -30, 26, -27); ctx.quadraticCurveTo(20, -24, 16, -21); ctx.closePath(); ctx.fill();
    circ(12, -18, 7.8); ctx.fill();
    ctx.fillStyle = body; circ(12, -18, 6.5); ctx.fill();
    // beak
    ctx.fillStyle = '#ffb23f';
    ctx.beginPath(); ctx.moveTo(6, -19.5); ctx.quadraticCurveTo(-1, -17.5, -4, -15.5); ctx.quadraticCurveTo(2, -14.5, 7, -15.5); ctx.closePath(); ctx.fill();
    // eye + cheek
    ctx.fillStyle = '#fff'; circ(10.5, -19.5, 2.9); ctx.fill();
    ctx.fillStyle = '#2b2440'; circ(9.6, -19.5, 1.7); ctx.fill();
    ctx.fillStyle = '#fff'; circ(9.1, -20.2, 0.6); ctx.fill();
    ctx.fillStyle = 'rgba(255,143,171,.7)'; ell(13.5, -15.2, 2, 1.2); ctx.fill();
    // front wing
    ctx.fillStyle = mix(body, '#ffffff', 0.25);
    ctx.strokeStyle = dark; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(18, -16); ctx.quadraticCurveTo(26, -16 - 16 * flap, 36, -15 - 21 * flap); ctx.quadraticCurveTo(29, -10, 22, -11); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // The dino. (px, py) = bottom-left of its box on screen.
  function drawDino(px, py, s, o) {
    const c = o.colors;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(s, s);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const run = Math.sin(o.phase || 0);
    let breathe = o.idle ? Math.sin(o.time * 3) * 0.8 : 0;
    if (o.dead) { ctx.translate(22, 0); ctx.rotate(-0.08 * Math.min(1, o.deadT * 6)); ctx.translate(-22, 0); }

    if (o.duck) {
      // legs
      const l1 = Math.max(0, run) * 3, l2 = Math.max(0, -run) * 3;
      ctx.fillStyle = c.dark;
      rr(13, -9 - l1, 7, 9, 3); ctx.fill();
      rr(30, -9 - l2, 7, 9, 3); ctx.fill();
      const outline = () => {
        ctx.beginPath(); ctx.moveTo(10, -17); ctx.quadraticCurveTo(-1, -17, -7, -10); ctx.quadraticCurveTo(2, -10, 12, -9); ctx.closePath(); ctx.fill();
        ell(25, -13.5, 19, 9.5); ctx.fill();
        rr(37, -28, 22, 18, 9); ctx.fill();
      };
      spikes(c, [[15, -21.5], [23, -23], [31, -22.5]], 4.5);
      stroked(outline, c);
      ctx.fillStyle = c.belly; ell(27, -9.5, 11, 4.6); ctx.fill();
      face(c, 49, -21, o, 0.9);
      ctx.restore();
      return;
    }

    // legs (behind the body)
    let l1 = 0, l2 = 0;
    if (o.dead) { l1 = 0; l2 = 0; }
    else if (o.air) { l1 = 4; l2 = 1.5; }
    else if (!o.idle) { l1 = Math.max(0, run) * 5.5; l2 = Math.max(0, -run) * 5.5; }
    ctx.fillStyle = c.dark;
    rr(11.5, -15 - l1, 8, 15, 3.5); ctx.fill();
    ctx.fillStyle = mix(c.body, '#000000', 0.12);
    rr(12.8, -13.7 - l1, 5.4, 12.4, 2.6); ctx.fill();
    ctx.fillStyle = c.dark;
    rr(22.5, -15 - l2, 8, 15, 3.5); ctx.fill();

    spikes(c, [[9, -31 + breathe], [15.5, -36 + breathe], [22, -48.5 + breathe]], 5);
    stroked(() => {
      // tail
      ctx.beginPath(); ctx.moveTo(10, -30 + breathe); ctx.quadraticCurveTo(-2, -26, -8, -14); ctx.quadraticCurveTo(1, -16, 12, -13); ctx.closePath(); ctx.fill();
      // body
      ell(19.5, -22 + breathe * 0.5, 14, 12.5); ctx.fill();
      // head
      rr(20, -51 + breathe, 25.5, 22, 10); ctx.fill();
      // neck
      rr(19, -38 + breathe, 13, 14, 6); ctx.fill();
    }, c);
    // front leg over the body edge
    ctx.fillStyle = c.body;
    rr(23.8, -13.5 - l2, 5.4, 12.2, 2.6); ctx.fill();
    // belly
    ctx.fillStyle = c.belly;
    ell(23, -18 + breathe * 0.5, 8.5, 8.2); ctx.fill();
    // arm
    ctx.strokeStyle = c.dark; ctx.lineWidth = 4.4;
    ctx.beginPath(); ctx.moveTo(28, -23 + breathe); ctx.lineTo(33, -19.5 + breathe); ctx.stroke();
    ctx.strokeStyle = c.body; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(28, -23 + breathe); ctx.lineTo(33, -19.5 + breathe); ctx.stroke();
    face(c, 36, -42 + breathe, o, 1);
    ctx.restore();
  }

  function stroked(shapes, c) {
    ctx.save();
    ctx.fillStyle = c.dark;
    // a slightly bigger copy behind for the outline
    for (const [dx, dy] of [[-1.3, 0], [1.3, 0], [0, -1.3], [0, 1.3], [-0.9, -0.9], [0.9, 0.9], [0.9, -0.9], [-0.9, 0.9]]) {
      ctx.save(); ctx.translate(dx, dy); shapes(); ctx.restore();
    }
    ctx.fillStyle = c.body;
    shapes();
    ctx.restore();
  }

  function spikes(c, list, r) {
    for (const [x, y] of list) {
      ctx.fillStyle = c.dark;
      ctx.beginPath(); ctx.moveTo(x - r - 1.2, y + 2); ctx.quadraticCurveTo(x, y - r * 2.1, x + r + 1.2, y + 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.spike;
      ctx.beginPath(); ctx.moveTo(x - r, y + 2); ctx.quadraticCurveTo(x, y - r * 1.75, x + r, y + 2); ctx.closePath(); ctx.fill();
    }
  }

  function face(c, ex, ey, o, k) {
    // eye
    const blink = o.idle && (o.time % 3.2) < 0.13;
    if (o.dead) {
      ctx.strokeStyle = '#2b2440'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 3.2; a += 0.3) {
        const rr2 = 0.5 + a * 0.33;
        const xx = ex + Math.cos(a + o.time * 8) * rr2 * k, yy = ey + Math.sin(a + o.time * 8) * rr2 * k;
        if (a === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      // dizzy stars
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < 3; i++) {
        const a = o.time * 5 + (i * Math.PI * 2) / 3;
        star(ex - 8 + Math.cos(a) * 13, ey - 13 + Math.sin(a) * 3.5, 3.4, 1.4);
      }
    } else if (blink) {
      ctx.strokeStyle = '#2b2440'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(ex, ey, 3.2 * k, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff'; circ(ex, ey, 5 * k); ctx.fill();
      ctx.fillStyle = '#2b2440'; circ(ex + 1.3 * k, ey + 0.3, 3 * k); ctx.fill();
      ctx.fillStyle = '#ffffff'; circ(ex + 2.3 * k, ey - 1.1 * k, 1.2 * k); ctx.fill();
    }
    // cheek, nostril, smile
    ctx.fillStyle = c.cheek; ctx.globalAlpha *= 0.6;
    ell(ex - 1 * k, ey + 7 * k, 3.2 * k, 2 * k); ctx.fill();
    ctx.globalAlpha /= 0.6;
    ctx.fillStyle = c.dark;
    circ(ex + 7.5 * k, ey - 1.5 * k, 0.9 * k); ctx.fill();
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (o.dead) { ctx.arc(ex + 5 * k, ey + 9 * k, 2 * k, 0, Math.PI * 2); }
    else ctx.arc(ex + 4.5 * k, ey + 3.5 * k, 4 * k, 0.25 * Math.PI, 0.7 * Math.PI);
    ctx.stroke();
  }

  let ghostLayer = null, gctx = null;
  function drawGhosts() {
    ghostLabels = [];
    if (!S.multi) return;
    const list = Object.values(ghosts).sort((a, b) => a.dist - b.dist);
    if (!list.length) return;
    // Ghosts are drawn solid on their own layer, then laid over the scene see-through.
    if (!ghostLayer) { ghostLayer = document.createElement('canvas'); gctx = ghostLayer.getContext('2d'); }
    if (ghostLayer.width !== canvas.width || ghostLayer.height !== canvas.height) { ghostLayer.width = canvas.width; ghostLayer.height = canvas.height; }
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, ghostLayer.width, ghostLayer.height);
    const main = ctx;
    ctx = gctx;
    ctx.setTransform(main.getTransform());
    const labels = [];
    for (const g of list) {
      let x = sx(g.dist);
      if (g.alive) x = clamp(x, 6, cssW - 60 * scale);
      if (x < -60 * scale || x > cssW + 10) continue;
      const y = sy(g.h);
      ctx.globalAlpha = g.alive ? 1 : 0.6;
      drawDino(x, y, scale, { colors: tintColors(g.color), duck: (g.duck || g.autoDuck) && g.h < 2, phase: g.phase, air: g.h > 1, dead: !g.alive, time: S.time, deadT: 1 });
      labels.push({ x: x + 26 * scale, y: y - 58 * scale, g });
    }
    ctx = main;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(ghostLayer, 0, 0);
    ctx.restore();
    ghostLabels = labels;
  }
  let ghostLabels = [];

  // Name tags go on top of everything, nudged up so they don't cover me or each other.
  function drawGhostLabels() {
    if (!S.multi || !ghostLabels.length) return;
    const labels = ghostLabels;
    const myX = sx(S.dist) + 26 * scale, myTop = sy(S.h + (ducking() && S.onGround ? 30 : 52)) - 12;
    ctx.font = '700 12px Outfit, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed = [];
    for (const l of labels) {
      const w = Math.min(120, ctx.measureText(l.g.name).width + 14);
      let y = l.y;
      if (Math.abs(l.x - myX) < 40 * scale + w / 2) y = Math.min(y, myTop);
      for (const p of placed) if (Math.abs(p.x - l.x) < (p.w + w) / 2 && Math.abs(p.y - y) < 18) y = p.y - 19;
      placed.push({ x: l.x, y, w });
      ctx.globalAlpha = l.g.alive ? 0.92 : 0.6;
      ctx.fillStyle = l.g.color;
      rr(l.x - w / 2, y - 9, w, 18, 9); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(l.g.name, l.x, y + 0.5, w - 10);
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      const x = sx(p.x), y = sy(p.h);
      if (p.kind === 'dust') {
        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = '#fff3d6';
        circ(x, y, p.size * scale * (1.4 - a * 0.4)); ctx.fill();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        star(x, y, p.size * scale, p.size * 0.45 * scale);
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(15 * Math.max(1, scale * 0.9))}px Outfit, system-ui, sans-serif`;
    for (const f of floats) {
      ctx.globalAlpha = clamp(f.life / 0.4, 0, 1);
      const x = sx(f.x), y = sy(f.h);
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function digits(str, x, y, cell, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < str.length; i++) ctx.fillText(str[i], x + i * cell + cell / 2, y);
    return str.length * cell;
  }

  function drawHud() {
    const score = scoreOf(S.dist, S.bonus);
    const fs = cssW < 400 ? 18 : 22;
    const cell = fs * 0.62;
    const pad = 12;
    ctx.font = `800 ${fs}px Outfit, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hiStr = String(Math.max(S.hi, S.mode === 'over' ? score : 0)).padStart(5, '0');
    const scStr = String(score).padStart(5, '0');
    const w = cell * 2 + 6 + hiStr.length * cell + 16 + scStr.length * cell + 24;
    const h = fs + 16;
    const x = pad + (window.visualViewport ? 0 : 0), y = pad;
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    rr(x, y, w, h, h / 2); ctx.fill();
    let cx = x + 12;
    const cy = y + h / 2 + 1;
    ctx.globalAlpha = 0.75;
    cx += digits('HI', cx, cy, cell, '#8b7fa8') + 6;
    cx += digits(hiStr, cx, cy, cell, '#8b7fa8') + 16;
    ctx.globalAlpha = 1;
    const blink = S.flash > 0 && Math.floor(S.flash * 8) % 2 === 0;
    digits(scStr, cx, cy, cell, blink ? '#ff7eb6' : '#3b2f5c');
  }

  function bigText(text, y, size, fill, stroke) {
    ctx.font = `800 ${size}px Outfit, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size * 0.16);
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, cssW / 2, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, cssW / 2, y);
  }

  function drawOverlay() {
    const counting = !!document.getElementById('cg-countdown');
    if (S.mode === 'ready') {
      const midY = Math.max(90, groundY * 0.42);
      const tsz = Math.round(clamp(cssW * 0.11, 34, 64));
      if (counting) { bigText('Get ready!', midY, tsz * 0.8, '#ffffff', '#3b2f5c'); return; }
      ctx.save();
      bigText('Dino Dash', ffTop() - tsz * 0.62, tsz, '#ffffff', '#3b2f5c');
      ctx.restore();
      const touchy = matchMedia('(pointer: coarse)').matches;
      ctx.font = `600 ${cssW < 400 ? 14 : 16}px Outfit, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(59,47,92,.85)';
      ctx.textAlign = 'center';
      const hint = touchy ? 'Tap to jump (hold = higher) · swipe down to duck' : 'Space / ↑ to jump (hold = higher) · ↓ to duck';
      const hy = groundY + Math.min(60, (cssH - groundY) / 2);
      ctx.fillText(hint, cssW / 2, hy, cssW - 24);
    } else if (S.mode === 'paused') {
      ctx.fillStyle = 'rgba(30,20,60,.25)';
      ctx.fillRect(0, 0, cssW, cssH);
      const tsz = Math.round(clamp(cssW * 0.1, 30, 54));
      bigText('Paused', groundY * 0.4, tsz, '#ffffff', '#3b2f5c');
      bigText('Tap to keep running', groundY * 0.4 + tsz, Math.round(tsz * 0.45), '#ffe066', '#3b2f5c');
    }
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

  // Start screen buttons (HTML over the canvas): family race first, practice second.
  let ffEl = null;
  function ffTop() { const tsz = Math.round(clamp(cssW * 0.11, 34, 64)); return Math.max(90, groundY * 0.42) + tsz * 0.05; }
  function buildStart() {
    ffStyle();
    ffEl = document.createElement('div');
    ffEl.className = 'dd-start';
    ffEl.style.cssText = 'position:absolute;left:16px;right:16px;z-index:2;display:none;';
    ffEl.innerHTML = ffButtons({ solo: 'Practice alone' });
    ffEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    ffEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ff]');
      if (!b || blocked()) return;
      b.blur();
      CG.sfx('click');
      if (b.dataset.ff === 'family') CG.openLobby();
      else if (S.mode === 'ready' && !S.multi) startSolo();
    });
    root.appendChild(ffEl);
  }
  function syncStart() {
    if (!ffEl) return;
    const show = S.mode === 'ready' && !S.multi && !document.getElementById('cg-countdown');
    const top = Math.round(ffTop()) + 'px';
    if (ffEl.style.top !== top) ffEl.style.top = top;
    const d = show ? 'block' : 'none';
    if (ffEl.style.display !== d) ffEl.style.display = d;
  }

  // ---------- Setup ----------
  function layout() {
    const r = root.getBoundingClientRect();
    cssW = Math.max(1, r.width);
    cssH = Math.max(1, r.height);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scale = Math.min(cssW / 450, cssH / 270, 1.9);
    viewW = cssW / scale;
    groundY = Math.round(Math.min(cssH - 46 * scale, cssH * 0.56 + 110 * scale));
    if (S.rng) extendCourse();
  }

  let last = 0;
  function loop(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    update(dt);
    render();
    syncStart();
    requestAnimationFrame(loop);
  }

  function loadHi() {
    try { S.hi = Number(localStorage.getItem(hiKey())) || 0; } catch (e) { /* ignore */ }
    const u = window.getChowaniecUser ? window.getChowaniecUser() : null;
    if (!u || !u.key) return;
    fetch('/.netlify/functions/games?board=dino', { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Chowaniec-Key': u.key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.mine && d.mine.score > S.hi) S.hi = d.mine.score; })
      .catch(() => {});
  }

  CG.mount({
    id: 'dino', title: 'Dino Dash', mode: 'race', scoreLabel: 'points',
    help: '<ul><li><b>Jump:</b> tap the screen, or press Space or ↑. Hold it down to jump higher.</li>' +
      '<li><b>Duck:</b> swipe down, or press ↓. Ducking in the air drops you down fast.</li>' +
      '<li>Hop over cacti and duck under the birds that fly at head height.</li>' +
      '<li>Grab coins (+5) and painted eggs (+25) for bonus points.</li>' +
      '<li>It gets a little faster as you go. Day turns to night and back again!</li>' +
      '<li><b>Play together:</b> everyone runs the same course at the same time. Friends show up as see-through dinos.</li></ul>',
    onReady(c) {
      root = c.root;
      me = c.user || '';
      canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', 'Dino Dash game');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:pointer;';
      root.appendChild(canvas);
      ctx = canvas.getContext('2d');
      buildStart();
      layout();
      reset(c.seed || 1);
      loadHi();
      if ('ResizeObserver' in window) new ResizeObserver(layout).observe(root);
      window.addEventListener('resize', layout);
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', () => { S.holding = false; S.duckKey = false; S.duckTouch = false; });
      requestAnimationFrame(loop);
    }
  });

  CG.on('pause', () => { if (S.mode === 'playing' && !S.multi) S.mode = 'paused'; S.holding = false; });
  CG.on('multiStart', (info) => {
    S.multi = true;
    reset(info.seed);
    S.mode = 'playing';
    last = 0;
    CG.race.update({ score: 0, y: 0, alive: true, dist: 0, duck: 0 });
  });
  CG.on('multiEnd', () => {
    S.multi = false;
    reset(Math.floor(Math.random() * 2 ** 31));
    S.mode = 'ready';
  });

  // Read-only peek for tests and curious grown-ups.
  window.DinoDash = { autoplay: (on) => { AUTOPLAY = !!on; if (!on) { S.holding = false; S.duckKey = false; } }, state: () => ({ mode: S.mode, multi: S.multi, score: scoreOf(S.dist, S.bonus), dist: Math.round(S.dist), h: S.h, ghosts: Object.keys(ghosts).length, seed: S.seed, obstacles: S.obs.slice(0, 3).map((o) => [o.kind, Math.round(o.x), o.w]) }) };
})();
