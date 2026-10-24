// Sky Hop: a gentle flappy game with a round little chick, for Chowaniec Games (see /games/README.md).
// Everything is drawn on one canvas. The course (gaps, stars) comes from a seed, pillar by pillar,
// so in a race every player flies exactly the same course.
(function () {
  'use strict';
  const CG = window.ChowGames;

  // ---------- Tuning (world units; the world is 640 tall, the chick is 36 across) ----------
  const WH = 640;
  const GROUND_Y = 572;
  const R = 18;                     // chick radius (drawn)
  const HIT_R = 14;                 // chick radius (collisions), a bit forgiving
  const GRAV = 1250;
  const FLAP_V = -385;
  const MAX_FALL = 560;
  const PW = 76;                    // pillar width
  const SPEED0 = 150, SPEED_GAIN = 55, SPEED_K = 26000;
  const speedAt = (d) => SPEED0 + SPEED_GAIN * (1 - Math.exp(-d / SPEED_K));
  const FIRST_X = 430;
  const STEP = 1 / 120;

  const qs = new URLSearchParams(location.search);
  let AUTOPLAY = qs.has('autoplay');

  // ---------- Helpers ----------
  const rgbCache = {};
  function rgb(hex) {
    if (rgbCache[hex]) return rgbCache[hex];
    const h = hex.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
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
  function hash(n) {
    let x = (n | 0) * 374761393 + 668265263;
    x = (x ^ (x >>> 13)) * 1274126177;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  const CHICK = { body: '#ffd84d', dark: '#e59a12', belly: '#fff3b8', wing: '#ffc531', cheek: '#ff9bb3' };
  function tint(color) {
    return { body: mix(color, '#ffffff', 0.15), dark: mix(color, '#000000', 0.35), belly: mix(color, '#ffffff', 0.6), wing: mix(color, '#000000', 0.08), cheek: '#ff9bb3' };
  }

  // Sky colours drift gently with the score: morning, golden afternoon, pink evening, back again.
  const PAL = [
    { top: '#7fcbff', bot: '#e3f6ff', far: '#c3e9f5', hill: '#9fe0b0', hill2: '#7dd197', grass: '#6ccf7c', soil: '#f4d9a0', sun: '#fff0a0' },
    { top: '#8ec5ff', bot: '#fff1cf', far: '#d6eedb', hill: '#b4e19a', hill2: '#90d27f', grass: '#78cc6c', soil: '#f2d295', sun: '#ffe27a' },
    { top: '#b39cf5', bot: '#ffd3e2', far: '#e8d3f0', hill: '#b9d8b0', hill2: '#9ccb98', grass: '#7cc47a', soil: '#efcd9a', sun: '#ffd0a8' }
  ];
  function palette(score) {
    const t = ((score / 36) % 1 + 1) % 1 * PAL.length;
    const i = Math.floor(t), k = t - i;
    const ease = k < 0.7 ? 0 : (k - 0.7) / 0.3;
    const A = PAL[i], B = PAL[(i + 1) % PAL.length], out = {};
    for (const key in A) out[key] = mix(A[key], B[key], ease * ease * (3 - 2 * ease));
    return out;
  }

  // ---------- State ----------
  let canvas, ctx, root, cssW = 0, cssH = 0, dpr = 1, scale = 1, viewW = 400, chickX = 110, offY = 0;
  let me = '';
  const S = {
    mode: 'ready', multi: false, seed: 1, rng: null,
    dist: 0, y: GROUND_Y * 0.45, vy: 0, angle: 0, flapT: 1,
    score: 0, pillars: [], stars: [], nextX: FIRST_X, count: 0, lastC: null, pendingStar: false,
    time: 0, deadT: 0, landed: false, shake: 0, hi: 0, overSent: false, pop: 0
  };
  let parts = [];
  let floats = [];
  const ghosts = {};
  const decoRand = CG.rng(Math.floor(Math.random() * 1e9));
  const clouds = Array.from({ length: 8 }, () => ({ x: decoRand() * 1600, y: 40 + decoRand() * 300, s: 0.6 + decoRand() * 0.9, k: 0.08 + decoRand() * 0.12 }));

  const blocked = () => CG.modalOpen() || !!document.getElementById('cg-countdown');
  const hiKey = () => 'chowaniec_hop_hi_' + (me || 'me');

  // ---------- Course (seeded) ----------
  function reset(seed) {
    S.seed = seed >>> 0 || 1;
    S.rng = CG.rng(S.seed);
    S.dist = 0; S.y = GROUND_Y * 0.45; S.vy = 0; S.angle = 0; S.flapT = 1;
    S.score = 0; S.pillars = []; S.stars = []; S.nextX = FIRST_X; S.count = 0; S.lastC = null; S.pendingStar = false;
    S.deadT = 0; S.landed = false; S.shake = 0; S.overSent = false; S.pop = 0;
    parts = []; floats = [];
    for (const k in ghosts) delete ghosts[k];
    extendCourse();
  }

  function genPillar() {
    const r = S.rng, n = S.count, x = S.nextX;
    const gap = Math.max(160, 236 - n * 1.9);
    const minC = 64 + gap / 2, maxC = GROUND_Y - 46 - gap / 2;
    const maxDelta = Math.min(210, 100 + n * 5);
    const want = lerp(minC, maxC, r());
    const c = S.lastC == null ? (minC + maxC) / 2 + (want - (minC + maxC) / 2) * 0.3 : clamp(want, S.lastC - maxDelta, S.lastC + maxDelta);
    const spacing = Math.max(226, 270 - n * 1.2);
    if (S.pendingStar) {
      const prev = S.pillars[S.pillars.length - 1];
      if (prev) S.stars.push({ x: (prev.x + PW + x) / 2, y: (S.lastC + c) / 2, got: false });
      S.pendingStar = false;
    }
    S.pillars.push({ x, top: c - gap / 2, bot: c + gap / 2, n, passed: false, look: r() });
    S.pendingStar = n >= 1 && r() < 0.24;
    S.lastC = c;
    S.nextX = x + spacing;
    S.count++;
  }

  function extendCourse() {
    while (S.nextX < S.dist + viewW + 200) genPillar();
    while (S.pillars.length && S.pillars[0].x + PW < S.dist - chickX - 60) S.pillars.shift();
    while (S.stars.length && S.stars[0].x < S.dist - chickX - 40) S.stars.shift();
  }

  function circleRect(cx, cy, r, x0, y0, x1, y1) {
    const nx = clamp(cx, x0, x1), ny = clamp(cy, y0, y1);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  // ---------- Flow ----------
  function startSolo() {
    S.multi = false;
    reset(Math.floor(Math.random() * 2 ** 31));
    S.mode = 'playing';
  }

  function flap() {
    S.vy = FLAP_V;
    S.flapT = 0;
    CG.sfx('flap');
    parts.push({ kind: 'puff', x: S.dist - 10, y: S.y + 8, vx: -40, vy: 30, life: 0.35, max: 0.35, size: 5 });
  }

  function crash(hitGround) {
    S.mode = 'dying';
    S.deadT = 0;
    S.shake = 8;
    S.landed = hitGround;
    if (!hitGround) S.vy = Math.min(S.vy, -120);
    CG.sfx('hit');
    const cols = ['#ffd84d', '#fff3b8', '#ffb33f', '#ffffff'];
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
      parts.push({ kind: 'feather', x: S.dist, y: S.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 1.6 + Math.random() * 0.8, max: 2.4, size: 5 + Math.random() * 4, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 8, color: cols[i % cols.length], sway: Math.random() * 6 });
    }
  }

  function finish() {
    if (S.overSent) return;
    S.overSent = true;
    S.mode = 'over';
    if (S.score > S.hi) { S.hi = S.score; try { localStorage.setItem(hiKey(), String(S.score)); } catch (e) { /* ignore */ } }
    if (S.multi) CG.gameOver({ score: S.score });
    else CG.gameOver({ score: S.score, title: S.score >= 20 ? 'What a flight!' : 'Oops! Game over', again: () => startSolo() });
  }

  // ---------- Input ----------
  function press() {
    if (blocked()) return;
    if (S.mode === 'ready') { startSolo(); flap(); return; }
    if (S.mode === 'paused') { S.mode = 'playing'; flap(); return; }
    if (S.mode === 'playing') flap();
  }
  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    press();
  }
  function onKeyDown(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return;
    if (blocked()) return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      if (!e.repeat) press();
    } else if ((e.code === 'KeyP' || e.code === 'Escape') && !S.multi) {
      if (S.mode === 'playing') S.mode = 'paused';
      else if (S.mode === 'paused') S.mode = 'playing';
    }
  }

  // ---------- Simulation ----------
  function step(dt) {
    if (S.mode === 'playing') {
      const sp = speedAt(S.dist);
      S.dist += sp * dt;
      if (AUTOPLAY) robot();
      S.vy = Math.min(MAX_FALL, S.vy + GRAV * dt);
      S.y += S.vy * dt;
      if (S.y < R) { S.y = R; S.vy = Math.max(S.vy, 40); }
      extendCourse();
      // pillars
      for (const p of S.pillars) {
        if (p.x > S.dist + 40) break;
        if (circleRect(S.dist, S.y, HIT_R, p.x + 6, -200, p.x + PW - 6, p.top - 4) ||
            circleRect(S.dist, S.y, HIT_R, p.x + 6, p.bot + 4, p.x + PW - 6, GROUND_Y + 50)) { crash(false); return; }
        if (!p.passed && p.x + PW / 2 < S.dist) {
          p.passed = true;
          S.score += 1;
          S.pop = 1;
          CG.sfx('point');
        }
      }
      for (const st of S.stars) {
        if (st.got) continue;
        if (st.x > S.dist + 40) break;
        const dx = st.x - S.dist, dy = st.y - S.y;
        if (dx * dx + dy * dy < (R + 16) * (R + 16)) {
          st.got = true;
          S.score += 3;
          S.pop = 1;
          CG.sfx('coin');
          floats.push({ x: st.x, y: st.y - 10, text: '+3', life: 0.9 });
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            parts.push({ kind: 'spark', x: st.x, y: st.y, vx: Math.cos(a) * 120 + sp * 0.5, vy: Math.sin(a) * 120, life: 0.5, max: 0.5, size: 4 });
          }
        }
      }
      if (S.y + HIT_R > GROUND_Y) { S.y = GROUND_Y - HIT_R; crash(true); return; }
      S.angle = lerp(S.angle, clamp(S.vy / 650, -0.45, 1.2), Math.min(1, dt * 10));
      if (S.multi) CG.race.update({ score: S.score, y: Math.round((S.y / GROUND_Y) * 1000) / 1000, alive: true, dist: Math.round(S.dist) });
    } else if (S.mode === 'dying') {
      if (!S.landed) {
        S.vy = Math.min(MAX_FALL * 1.3, S.vy + GRAV * 1.2 * dt);
        S.y += S.vy * dt;
        S.angle += dt * 9;
        if (S.y + R * 0.8 >= GROUND_Y) { S.y = GROUND_Y - R * 0.8; S.landed = true; S.shake = 4; CG.sfx('drop'); }
      }
    }
  }

  // ?autoplay: a little robot pilot (handy for testing)
  function robot() {
    const next = S.pillars.find((p) => p.x + PW > S.dist - HIT_R);
    const target = next ? next.bot - 34 : GROUND_Y * 0.5;
    if (S.y > target && S.vy > -60) flap();
  }

  let acc = 0;
  function update(dt) {
    S.time += dt;
    if (S.mode === 'playing' && !S.multi && CG.modalOpen()) S.mode = 'paused';
    if (S.mode === 'playing' || S.mode === 'dying') {
      acc += dt;
      while (acc >= STEP) { step(STEP); acc -= STEP; }
    } else acc = 0;
    if (S.mode === 'dying') {
      S.deadT += dt;
      if (S.deadT > 1.15) finish();
    }
    S.flapT += dt;
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 30);
    if (S.pop > 0) S.pop = Math.max(0, S.pop - dt * 4);
    for (const p of parts) {
      p.life -= dt;
      if (p.kind === 'feather') {
        p.vx *= 1 - dt * 2.2;
        p.vy = Math.min(70, p.vy + 260 * dt);
        p.x += (p.vx + Math.sin(S.time * 3 + p.sway) * 30) * dt;
        p.rot += p.spin * dt;
      } else p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    parts = parts.filter((p) => p.life > 0);
    for (const f of floats) { f.life -= dt; f.y -= 40 * dt; }
    floats = floats.filter((f) => f.life > 0);
    updateGhosts(dt);
  }

  function updateGhosts(dt) {
    if (!S.multi) return;
    const seen = {};
    const moving = S.mode === 'playing';
    for (const o of CG.race.others()) {
      const st = o.state || {};
      seen[o.name] = true;
      const alive = st.alive !== false;
      const sd = Number(st.dist) || 0;
      const target = sd + (alive && moving ? speedAt(sd) * Math.min(o.age, 1500) / 1000 : 0);
      let g = ghosts[o.name];
      if (!g) g = ghosts[o.name] = { dist: target, y: (Number(st.y) || 0.45) * GROUND_Y, vis: 0 };
      g.name = o.name; g.color = o.color; g.alive = alive;
      if (alive && moving) g.dist += speedAt(g.dist) * dt;
      g.dist += (target - g.dist) * Math.min(1, dt * 3);
      let ty = (Number(st.y) || 0) * GROUND_Y;
      if (alive) {
        // Their height is up to ~0.6 s old; while they pass a pillar, keep them inside its gap
        // (they must have made it through, or they wouldn't still be flying).
        for (const p of S.pillars) {
          if (p.x - 50 > g.dist) break;
          if (p.x + PW + 30 < g.dist) continue;
          ty = clamp(ty, p.top + R + 8, p.bot - R - 8);
        }
        g.flap = (g.flap || 0) + dt;
        if (g.flap > 0.42) g.flap = 0;
      } else ty = GROUND_Y - R * 0.8;
      const oldY = g.y;
      g.y += (ty - g.y) * Math.min(1, dt * (alive ? 4 : 6));
      g.vy = (g.y - oldY) / Math.max(dt, 0.001);
      g.angle = alive ? clamp(g.vy / 650, -0.4, 0.8) : 1.4;
      g.vis = Math.min(1, g.vis + dt * 3);
    }
    for (const k in ghosts) if (!seen[k]) delete ghosts[k];
  }

  // ---------- Drawing ----------
  const sx = (wx) => (wx - S.dist) * scale + chickX * scale;
  const sy = (wy) => offY + wy * scale;

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
  }
  function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function ell(x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); }
  function star(x, y, Ro, Ri) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? Ri : Ro;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
  }

  function render() {
    const pal = palette(S.score);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, sy(GROUND_Y));
    sky.addColorStop(0, pal.top);
    sky.addColorStop(1, pal.bot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cssW, cssH);
    if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);

    drawSun(pal);
    drawBackClouds(pal);
    drawHills(pal);
    for (const p of S.pillars) {
      const x = sx(p.x);
      if (x > cssW + 40 || x + PW * scale < -40) continue;
      drawPillar(p, x);
    }
    drawStars();
    drawGround(pal);
    drawGhosts();
    const dead = S.mode === 'dying' || S.mode === 'over';
    let y = S.y, ang = S.angle;
    if (S.mode === 'ready') { y = GROUND_Y * 0.45 + Math.sin(S.time * 3) * 8; ang = 0; }
    drawChick(sx(S.dist), sy(y), scale, { colors: CHICK, angle: ang, flapT: S.mode === 'ready' ? (S.time % 0.5) : S.flapT, dead, time: S.time });
    drawParticles();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawHud();
    drawOverlay();
  }

  function drawSun(pal) {
    const x = cssW * 0.8, y = sy(110), r = 34 * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(S.time * 0.15);
    ctx.fillStyle = pal.sun;
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 10; i++) {
      ctx.rotate(Math.PI / 5);
      ctx.beginPath(); ctx.moveTo(-r * 0.22, -r * 1.2); ctx.lineTo(0, -r * 1.85); ctx.lineTo(r * 0.22, -r * 1.2); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 0.3;
    circ(0, 0, r * 1.35); ctx.fill();
    ctx.globalAlpha = 1;
    circ(0, 0, r); ctx.fill();
    ctx.restore();
  }

  function puffCloud(x, y, s, color, shade) {
    const draw = (dy) => {
      ctx.beginPath();
      ctx.arc(x, y + dy, 18 * s, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(x + 22 * s, y - 14 * s + dy, 22 * s, Math.PI, Math.PI * 1.9);
      ctx.arc(x + 50 * s, y - 8 * s + dy, 17 * s, Math.PI * 1.2, Math.PI * 1.95);
      ctx.arc(x + 66 * s, y + dy, 15 * s, Math.PI * 1.5, Math.PI * 0.5);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = shade; draw(4 * s);
    ctx.fillStyle = color; draw(0);
  }

  function drawBackClouds(pal) {
    const span = cssW + 300;
    for (const c of clouds) {
      const x = ((c.x - S.dist * c.k * scale - S.time * 4) % span + span) % span - 150;
      ctx.globalAlpha = 0.6;
      puffCloud(x, sy(c.y), c.s * scale, '#ffffff', mix(pal.top, '#ffffff', 0.5));
    }
    ctx.globalAlpha = 1;
  }

  function wave(off, base, amp, wl, color, seed) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, sy(GROUND_Y) + 2);
    for (let x = 0; x <= cssW + 12; x += 12) {
      const u = (x + off) / scale;
      ctx.lineTo(x, sy(base) - amp * scale * (0.6 + 0.3 * Math.sin(u / wl + seed) + 0.1 * Math.sin(u / (wl * 0.4) + seed * 3)));
    }
    ctx.lineTo(cssW, sy(GROUND_Y) + 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawHills(pal) {
    // a soft bank of far clouds on the horizon
    ctx.fillStyle = pal.far;
    ctx.beginPath();
    ctx.moveTo(0, sy(GROUND_Y));
    const off = S.dist * 0.08;
    for (let x = 0; x <= cssW + 10; x += 10) {
      const u = x / scale + off;
      ctx.lineTo(x, sy(GROUND_Y - 120) - Math.abs(Math.sin(u / 38)) * 26 * scale - Math.abs(Math.sin(u / 17 + 1)) * 10 * scale);
    }
    ctx.lineTo(cssW, sy(GROUND_Y));
    ctx.closePath();
    ctx.fill();
    wave(S.dist * 0.2 * scale, GROUND_Y, 80, 60, pal.hill, 0.7);
    // little round trees on the near hills
    const tw = 130, o2 = S.dist * 0.42;
    const first = Math.floor(o2 / tw) - 1;
    for (let i = first; i < first + cssW / scale / tw + 3; i++) {
      if (hash(i * 5) < 0.35) continue;
      const x = (i * tw - o2 + hash(i) * 50) * scale;
      const h = 20 + hash(i * 3) * 18;
      const by = sy(GROUND_Y - 18);
      ctx.fillStyle = mix(pal.hill2, '#7a5a3a', 0.55);
      rr(x - 2.5 * scale, by - h * scale * 0.5, 5 * scale, h * scale * 0.6, 2 * scale); ctx.fill();
      ctx.fillStyle = mix(pal.hill2, '#2f7d4a', 0.25);
      circ(x, by - h * scale * 0.65, h * 0.42 * scale); ctx.fill();
    }
    wave(S.dist * 0.42 * scale, GROUND_Y, 32, 34, pal.hill2, 2.3);
  }

  function drawGround(pal) {
    const gy = sy(GROUND_Y);
    ctx.fillStyle = pal.soil;
    ctx.fillRect(0, gy, cssW, cssH - gy + 10);
    ctx.fillStyle = pal.grass;
    ctx.beginPath();
    ctx.moveTo(0, gy + 16 * scale);
    for (let x = 0; x <= cssW + 6; x += 6) {
      const u = x / scale + S.dist;
      ctx.lineTo(x, gy - (2 + 2 * Math.sin(u / 5)) * scale);
    }
    ctx.lineTo(cssW, gy + 16 * scale);
    ctx.closePath();
    ctx.fill();
    // grass scallops on the soil
    ctx.beginPath();
    const sc = 14;
    const start = Math.floor((S.dist - chickX) / sc) - 1;
    for (let i = start; i < start + viewW / sc + 3; i++) {
      const x = sx(i * sc);
      ctx.moveTo(x + sc * scale, gy + 15 * scale);
      ctx.arc(x + sc * scale / 2, gy + 15 * scale, sc * scale / 2, 0, Math.PI);
    }
    ctx.fill();
    // stripes and flowers
    const ft = 40;
    const fs = Math.floor((S.dist - chickX) / ft) - 1;
    for (let i = fs; i < fs + viewW / ft + 3; i++) {
      const h = hash(i * 7 + 3);
      const x = sx(i * ft + hash(i) * ft);
      if (h < 0.25) {
        const fc = ['#ff8fab', '#ffffff', '#ffd23f', '#c4a7ff'][Math.floor(hash(i * 11) * 4)];
        ctx.fillStyle = fc;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          circ(x + Math.cos(a) * 2.6 * scale, gy + 5 * scale + Math.sin(a) * 2.6 * scale, 2 * scale); ctx.fill();
        }
        ctx.fillStyle = '#ffb000';
        circ(x, gy + 5 * scale, 1.5 * scale); ctx.fill();
      } else if (h < 0.6) {
        ctx.fillStyle = mix(pal.soil, '#b07a3a', 0.25);
        ell(x, gy + (32 + hash(i * 13) * 26) * scale, (2 + hash(i * 17) * 3) * scale, 1.6 * scale);
        ctx.fill();
      }
    }
  }

  function drawPillar(p, x) {
    const s = scale, w = PW * s;
    const topY = sy(p.top), botY = sy(p.bot), gy = sy(GROUND_Y);
    // --- the cloud column hanging from the top ---
    const tints = [['#ffffff', '#dfe6ff', '#9fb0e6'], ['#fff4fa', '#ffd9ea', '#e6a3c2'], ['#f7f3ff', '#e3daff', '#ab9be6'], ['#f2fffb', '#d3f4ea', '#8fcdb9']];
    const [cFill, cShade, cLine] = tints[Math.floor(p.look * 4) % 4];
    const capY = topY - 14 * s;
    const puffs = [
      [x + w * 0.18, capY - 1 * s, 15], [x + w * 0.5, capY + 1 * s, 15], [x + w * 0.82, capY - 1 * s, 15],
      [x + w * 0.33, capY - 10 * s, 15], [x + w * 0.67, capY - 10 * s, 15]
    ];
    let side = 0;
    for (let yy = capY - 32 * s; yy > -30 * s; yy -= 30 * s, side++) {
      puffs.push([x + 3 * s, yy - (side % 2) * 6 * s, 9]);
      puffs.push([x + w - 3 * s, yy - 15 * s + (side % 2) * 6 * s, 9]);
    }
    const colTop = -30, colH = capY - colTop;
    ctx.fillStyle = cLine;
    rr(x - 1.5 * s, colTop, w + 3 * s, colH, 10 * s); ctx.fill();
    for (const [px, py, pr] of puffs) { circ(px, py, (pr + 1.8) * s); ctx.fill(); }
    ctx.fillStyle = cShade;
    rr(x, colTop, w, colH, 10 * s); ctx.fill();
    for (const [px, py, pr] of puffs) { circ(px, py, pr * s); ctx.fill(); }
    ctx.fillStyle = cFill;
    rr(x + 5 * s, colTop, w - 18 * s, colH - 4 * s, 8 * s); ctx.fill();
    for (const [px, py, pr] of puffs) { circ(px - 2 * s, py - 2.5 * s, (pr - 3.5) * s); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    circ(x + w * 0.2, capY - 5 * s, 3.5 * s); ctx.fill();
    circ(x + w * 0.3, capY - 1 * s, 2 * s); ctx.fill();

    // --- the tree growing from the ground ---
    const trunkW = w - 12 * s;
    const tx = x + 6 * s;
    ctx.fillStyle = '#8a5a3a';
    rr(tx - 1.5 * s, botY + 20 * s, trunkW + 3 * s, gy - botY, 8 * s); ctx.fill();
    const bark = ctx.createLinearGradient(tx, 0, tx + trunkW, 0);
    bark.addColorStop(0, '#c99367'); bark.addColorStop(0.55, '#b98256'); bark.addColorStop(1, '#a06d45');
    ctx.fillStyle = bark;
    rr(tx, botY + 21 * s, trunkW, gy - botY, 7 * s); ctx.fill();
    ctx.strokeStyle = 'rgba(122,78,46,.55)';
    ctx.lineWidth = 2 * s;
    ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const yy = botY + (60 + k * 70 + hash(p.n * 7 + k) * 30) * s;
      if (yy > gy - 10 * s) break;
      const xx = tx + (8 + hash(p.n * 3 + k) * (PW - 40)) * s;
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.quadraticCurveTo(xx + 4 * s, yy + 8 * s, xx, yy + 16 * s); ctx.stroke();
    }
    // knot hole
    if (p.look > 0.5 && gy - botY > 140 * s) {
      ctx.fillStyle = '#7a4e2e';
      ell(tx + trunkW * 0.6, botY + 110 * s, 7 * s, 9 * s); ctx.fill();
    }
    // leafy crown
    const cy = botY + 18 * s;
    const blobs = [[0.5, -0.05, 0.42], [0.12, 0.25, 0.3], [0.88, 0.25, 0.3], [0.3, 0.05, 0.32], [0.7, 0.05, 0.32], [0.5, 0.3, 0.34]];
    ctx.fillStyle = '#3f9e57';
    for (const [bx, by, br] of blobs) { circ(x + bx * w, cy + by * w * 0.6, br * w * 0.62 + 2 * s); ctx.fill(); }
    ctx.fillStyle = '#5cc26c';
    for (const [bx, by, br] of blobs) { circ(x + bx * w, cy + by * w * 0.6, br * w * 0.62); ctx.fill(); }
    ctx.fillStyle = '#86dc86';
    circ(x + 0.38 * w, cy - 0.06 * w, 0.14 * w); ctx.fill();
    circ(x + 0.66 * w, cy + 0.02 * w, 0.09 * w); ctx.fill();
    // blossoms / apples
    const fruit = p.look < 0.33 ? '#ff6b81' : p.look < 0.66 ? '#ffb3cf' : '#ffd23f';
    ctx.fillStyle = fruit;
    for (let k = 0; k < 4; k++) {
      circ(x + (0.15 + hash(p.n * 13 + k) * 0.7) * w, cy + (0.02 + hash(p.n * 5 + k) * 0.3) * w * 0.6, 3.2 * s); ctx.fill();
    }
  }

  function drawStars() {
    for (const st of S.stars) {
      if (st.got) continue;
      const x = sx(st.x), y = sy(st.y + Math.sin(S.time * 3 + st.x) * 5);
      if (x < -30 || x > cssW + 30) continue;
      const s = scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(S.time * 2 + st.x) * 0.2);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff7b0';
      circ(0, 0, 22 * s); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f2a900';
      star(0, 1.5 * s, 15 * s, 7 * s); ctx.fill();
      ctx.fillStyle = '#ffd84d';
      star(0, 0, 14 * s, 6.5 * s); ctx.fill();
      ctx.fillStyle = '#5b3d1e';
      circ(-3.5 * s, -1 * s, 1.5 * s); ctx.fill();
      circ(3.5 * s, -1 * s, 1.5 * s); ctx.fill();
      ctx.strokeStyle = '#5b3d1e'; ctx.lineWidth = 1.3 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 1.5 * s, 2.6 * s, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
      ctx.restore();
    }
  }

  // The chick, centred at (px, py).
  function drawChick(px, py, s, o) {
    const c = o.colors;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(s, s);
    ctx.rotate(o.angle || 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // feet
    ctx.strokeStyle = '#f08a24'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-4, 16); ctx.lineTo(-6, 21); ctx.moveTo(4, 16); ctx.lineTo(3, 21); ctx.stroke();
    // tail feathers
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.moveTo(-15, -2); ctx.lineTo(-25, -8); ctx.lineTo(-22, 0); ctx.lineTo(-26, 5); ctx.lineTo(-15, 5); ctx.closePath(); ctx.fill();
    // body
    ctx.fillStyle = c.dark; circ(0, 0, R + 1.6); ctx.fill();
    const g = ctx.createRadialGradient(-6, -7, 2, 0, 0, R);
    g.addColorStop(0, mix(c.body, '#ffffff', 0.35));
    g.addColorStop(1, c.body);
    ctx.fillStyle = g; circ(0, 0, R); ctx.fill();
    ctx.fillStyle = c.belly; ell(-1, 8, 11, 7.5); ctx.fill();
    // tuft
    ctx.fillStyle = c.body; ctx.strokeStyle = c.dark; ctx.lineWidth = 1.4;
    for (const [a, l] of [[-0.35, 9], [0, 11], [0.35, 8]]) {
      ctx.save(); ctx.translate(1, -R + 1); ctx.rotate(a);
      ctx.beginPath(); ctx.ellipse(0, -l / 2, 2.6, l / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // eye
    if (o.dead) {
      ctx.strokeStyle = '#2b2440'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(4, -9); ctx.lineTo(11, -2); ctx.moveTo(11, -9); ctx.lineTo(4, -2); ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff'; circ(7.5, -5.5, 6); ctx.fill();
      ctx.fillStyle = '#2b2440'; circ(9, -5, 3.6); ctx.fill();
      ctx.fillStyle = '#ffffff'; circ(10.2, -6.6, 1.4); ctx.fill();
    }
    // cheek
    ctx.fillStyle = c.cheek; ctx.globalAlpha *= 0.65;
    ell(5, 4, 3.6, 2.4); ctx.fill();
    ctx.globalAlpha /= 0.65;
    // beak
    ctx.fillStyle = '#ff9a1f';
    ctx.beginPath(); ctx.moveTo(14, -2.5); ctx.quadraticCurveTo(24, 0, 14.5, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8750b';
    ctx.beginPath(); ctx.moveTo(14.5, 0.8); ctx.quadraticCurveTo(21, 1.6, 14.5, 3); ctx.closePath(); ctx.fill();
    // wing: snaps up on a flap, then settles
    const k = clamp(o.flapT / 0.22, 0, 1);
    const wingA = o.dead ? -1.2 + Math.sin(o.time * 20) * 0.3 : lerp(-1.1, 0.35, k) + (k >= 1 ? Math.sin(o.time * 4) * 0.08 : 0);
    ctx.save();
    ctx.translate(-4, 2);
    ctx.rotate(wingA);
    ctx.fillStyle = c.dark; ell(-6, 0, 10.5, 6.6); ctx.fill();
    ctx.fillStyle = c.wing; ell(-6, 0, 9, 5.2); ctx.fill();
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-11, -1); ctx.lineTo(-4, 0); ctx.moveTo(-11, 2); ctx.lineTo(-5, 2.5); ctx.stroke();
    ctx.restore();
    ctx.restore();
    if (o.dead) {
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < 3; i++) {
        const a = o.time * 5 + (i * Math.PI * 2) / 3;
        star(px + Math.cos(a) * 20 * s, py - 24 * s + Math.sin(a) * 5 * s, 4.5 * s, 2 * s); ctx.fill();
      }
    }
  }

  let ghostLayer = null, gctx = null, ghostLabels = [];
  function drawGhosts() {
    ghostLabels = [];
    if (!S.multi) return;
    const list = Object.values(ghosts);
    if (!list.length) return;
    if (!ghostLayer) { ghostLayer = document.createElement('canvas'); gctx = ghostLayer.getContext('2d'); }
    if (ghostLayer.width !== canvas.width || ghostLayer.height !== canvas.height) { ghostLayer.width = canvas.width; ghostLayer.height = canvas.height; }
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, ghostLayer.width, ghostLayer.height);
    const main = ctx;
    ctx = gctx;
    ctx.setTransform(main.getTransform());
    for (const g of list) {
      let x = sx(g.dist);
      if (g.alive) x = clamp(x, 20 * scale, cssW - 24 * scale);
      if (x < -30 * scale || x > cssW + 30 * scale) continue;
      const y = sy(g.y);
      ctx.globalAlpha = g.vis * (g.alive ? 1 : 0.7);
      drawChick(x, y, scale, { colors: tint(g.color), angle: g.angle, flapT: g.alive ? g.flap : 1, dead: !g.alive, time: S.time });
      ghostLabels.push({ x, y: y - 36 * scale, g });
    }
    ctx = main;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(ghostLayer, 0, 0);
    ctx.restore();
  }

  function drawGhostLabels() {
    if (!ghostLabels.length) return;
    const myX = sx(S.dist), myY = sy(S.y);
    ctx.font = '700 12px Outfit, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed = [];
    for (const l of ghostLabels) {
      const w = Math.min(120, ctx.measureText(l.g.name).width + 14);
      let y = l.y;
      // keep the tag off my own chick
      if (Math.abs(l.x - myX) < w / 2 + 22 * scale && Math.abs(y - myY) < 30 * scale) y = myY - 36 * scale - 10;
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
      const x = sx(p.x), y = sy(p.y);
      if (p.kind === 'feather') {
        ctx.globalAlpha = clamp(p.life / 0.6, 0, 1);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ell(0, 0, p.size * scale, p.size * 0.42 * scale); ctx.fill();
        ctx.strokeStyle = 'rgba(229,154,18,.6)';
        ctx.lineWidth = 0.8 * scale;
        ctx.beginPath(); ctx.moveTo(-p.size * scale, 0); ctx.lineTo(p.size * scale * 0.9, 0); ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'puff') {
        ctx.globalAlpha = a * 0.7;
        ctx.fillStyle = '#ffffff';
        circ(x, y, p.size * scale * (1.6 - a * 0.6)); ctx.fill();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ffe066';
        star(x, y, p.size * scale, p.size * 0.45 * scale); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    drawGhostLabels();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(18 * Math.max(1, scale))}px Outfit, system-ui, sans-serif`;
    for (const f of floats) {
      ctx.globalAlpha = clamp(f.life / 0.4, 0, 1);
      const x = sx(f.x), y = sy(f.y);
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = '#f2a900';
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function bigText(text, x, y, size, fill, stroke) {
    ctx.font = `800 ${size}px Outfit, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size * 0.16);
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  function drawHud() {
    if (S.mode === 'ready') return;
    const size = Math.round(clamp(cssH * 0.075, 40, 64) * (1 + S.pop * 0.18));
    const y = 18 + size / 2;
    bigText(String(S.score), cssW / 2, y, size, '#ffffff', '#4a3b7a');
    ctx.font = `700 ${cssW < 400 ? 13 : 15}px Outfit, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(74,59,122,.75)';
    ctx.fillText('HI ' + Math.max(S.hi, S.mode === 'over' ? S.score : 0), cssW / 2, y + size * 0.62 + 6);
  }

  function drawOverlay() {
    const counting = !!document.getElementById('cg-countdown');
    const tsz = Math.round(clamp(cssW * 0.12, 36, 66));
    const midY = sy(GROUND_Y * 0.24);
    if (S.mode === 'ready') {
      if (counting) { bigText('Get ready!', cssW / 2, midY, Math.round(tsz * 0.8), '#ffffff', '#4a3b7a'); return; }
      bigText('Sky Hop', cssW / 2, midY, tsz, '#ffffff', '#4a3b7a');
      const pulse = 1 + Math.sin(S.time * 4) * 0.05;
      ctx.save();
      ctx.translate(cssW / 2, midY + tsz);
      ctx.scale(pulse, pulse);
      bigText('Tap to start', 0, 0, Math.round(tsz * 0.48), '#ffe066', '#4a3b7a');
      ctx.restore();
      if (S.hi > 0) {
        ctx.font = `700 ${cssW < 400 ? 14 : 16}px Outfit, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(74,59,122,.8)';
        ctx.fillText('Best: ' + S.hi, cssW / 2, midY + tsz * 1.65);
      }
      const touchy = matchMedia('(pointer: coarse)').matches;
      ctx.font = `600 ${cssW < 400 ? 14 : 16}px Outfit, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(74,59,122,.85)';
      ctx.fillText(touchy ? 'Tap to flap · fly through the gaps' : 'Space, ↑ or click to flap · fly through the gaps', cssW / 2, sy(GROUND_Y) + Math.min(46 * scale, (cssH - sy(GROUND_Y)) / 2 + 8), cssW - 24);
    } else if (S.mode === 'paused') {
      ctx.fillStyle = 'rgba(40,30,80,.22)';
      ctx.fillRect(0, 0, cssW, cssH);
      bigText('Paused', cssW / 2, midY, tsz, '#ffffff', '#4a3b7a');
      bigText('Tap to keep flying', cssW / 2, midY + tsz, Math.round(tsz * 0.45), '#ffe066', '#4a3b7a');
    }
  }

  // ---------- Setup ----------
  function layout() {
    const r = root.getBoundingClientRect();
    cssW = Math.max(1, r.width);
    cssH = Math.max(1, r.height);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    // Fit the 640-tall world to the height (or the width on very wide, short screens, with the sky cut).
    scale = cssH / WH;
    offY = 0;
    viewW = cssW / scale;
    chickX = clamp(viewW * 0.3, 90, 260);
    if (S.rng) extendCourse();
  }

  let last = 0;
  function loop(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function loadHi() {
    try { S.hi = Number(localStorage.getItem(hiKey())) || 0; } catch (e) { /* ignore */ }
    const u = window.getChowaniecUser ? window.getChowaniecUser() : null;
    if (!u || !u.key) return;
    fetch('/.netlify/functions/games?board=hop', { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Chowaniec-Key': u.key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.mine && d.mine.score > S.hi) S.hi = d.mine.score; })
      .catch(() => {});
  }

  CG.mount({
    id: 'hop', title: 'Sky Hop', emoji: '🐤', mode: 'race', scoreLabel: 'points',
    help: '<ul><li><b>Flap:</b> tap the screen, click, or press Space or ↑.</li>' +
      '<li>Fly through the gaps between the clouds and the trees. Each one you pass is +1.</li>' +
      '<li>Catch the smiling stars for +3.</li>' +
      '<li>Don’t touch the ground! Bumping the top of the sky is fine.</li>' +
      '<li>The gaps start wide and get a little narrower as you go.</li>' +
      '<li><b>Play together:</b> everyone flies the same course at the same time. Friends show up as see-through chicks.</li></ul>',
    onReady(c) {
      root = c.root;
      me = c.user || '';
      canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', 'Sky Hop game');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:pointer;';
      root.appendChild(canvas);
      ctx = canvas.getContext('2d');
      layout();
      reset(c.seed || 1);
      loadHi();
      if ('ResizeObserver' in window) new ResizeObserver(layout).observe(root);
      window.addEventListener('resize', layout);
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('keydown', onKeyDown);
      requestAnimationFrame(loop);
    }
  });

  CG.on('pause', () => { if (S.mode === 'playing' && !S.multi) S.mode = 'paused'; });
  CG.on('multiStart', (info) => {
    S.multi = true;
    reset(info.seed);
    S.mode = 'playing';
    last = 0;
    flap();
    CG.race.update({ score: 0, y: Math.round((S.y / GROUND_Y) * 1000) / 1000, alive: true, dist: 0 });
  });
  CG.on('multiEnd', () => {
    S.multi = false;
    reset(Math.floor(Math.random() * 2 ** 31));
    S.mode = 'ready';
  });

  window.SkyHop = {
    autoplay: (on) => { AUTOPLAY = !!on; },
    state: () => ({ mode: S.mode, multi: S.multi, score: S.score, dist: Math.round(S.dist), y: Math.round(S.y), ghosts: Object.keys(ghosts).length, seed: S.seed, obstacles: S.pillars.slice(0, 3).map((p) => [Math.round(p.x), Math.round(p.top), Math.round(p.bot)]) })
  };
})();
