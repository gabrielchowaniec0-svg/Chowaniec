// Mini Golf: a charming, slightly tilted top-down mini golf for Chowaniec Games.
// Two hand-designed 9-hole courses (holes.js): walls for bank shots, hills and slopes, sand, water,
// windmills, sliding bridges and a drawbridge, pipes, loops, bumpers and conveyor belts.
// Solo: "Practice" a course. Together: everyone plays the same 9 holes at once on their own phone and sees
// the others' balls rolling live on the same hole. Physics runs in fixed 1/240 s steps and only depends on
// the shot (angle, power) and the step it was taken on, so a shot can be replayed exactly (tests use this).
(function () {
  'use strict';
  const CG = window.ChowGames;
  const COURSES = window.GOLF_COURSES;

  // ---------- Tuning ----------
  const DT = 1 / 240;
  const BR = 6;              // ball radius
  const CUP = 11;            // cup radius
  const WT = 6;              // wall half thickness
  const WH = 10;             // wall height
  const TILT = 0.84;         // camera tilt: ground y is squashed by this much
  const VMAX = 760;          // full-power putt speed
  const MU = 140, KD = 0.5;  // rolling friction (constant + per speed)
  const MU_S = 900, KD_S = 2.2;  // sand
  const CAP_V = 205;         // the cup only catches balls slower than this
  const PULL = 1800;         // cup lip pull
  const WALL_E = 0.74;       // wall bounce
  const KICK = 150;          // bumper kick
  const LOOP_V = 340;        // speed needed to make it round a loop
  const LOOP_R = 26, LOOP_G = 1000;
  const MAXS = 6;            // strokes before the ball is picked up
  const FONT = 'Outfit, system-ui, -apple-system, "Segoe UI", sans-serif';
  const TAU = Math.PI * 2;

  // ---------- Helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const isTouch = () => (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  const hexRgb = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (c, a) => { const [r, g, b] = hexRgb(c); return `rgba(${r},${g},${b},${a})`; };
  const shade = (c, amt) => { const A = hexRgb(c), B = amt >= 0 ? [255, 255, 255] : [0, 0, 0], t = Math.abs(amt); return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`; };
  function pip(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  }
  function polyDist(pts, x, y) { let d = 1e9; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1])); } return d; }
  function shape(s) {
    if (s[0] === 'r') return { t: 'r', x: s[1], y: s[2], w: s[3], h: s[4] };
    if (s[0] === 'e') return { t: 'e', x: s[1], y: s[2], rx: s[3], ry: s[4] };
    return { t: 'p', pts: s[1] };
  }
  function inShape(s, x, y) {
    if (s.t === 'r') return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    if (s.t === 'e') { const u = (x - s.x) / s.rx, v = (y - s.y) / s.ry; return u * u + v * v <= 1; }
    return pip(s.pts, x, y);
  }
  function shapePath(g, s, grow) {
    const e = grow || 0;
    g.beginPath();
    if (s.t === 'r') g.rect(s.x - e, s.y - e, s.w + 2 * e, s.h + 2 * e);
    else if (s.t === 'e') g.ellipse(s.x, s.y, s.rx + e, s.ry + e, 0, 0, TAU);
    else { s.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }
  }
  function polyPath(g, pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  const disc = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, TAU); g.fill(); };
  const ell = (g, x, y, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); g.fill(); };

  // ---------- Holes ----------
  function compile(d, ci, hi) {
    const H = {
      ci, hi, name: d.name, par: d.par, tee: d.tee, cup: d.cup,
      greens: [d.green].concat(d.green2 ? [d.green2] : []),
      segs: [], posts: [], bumpers: [], draws: [], blocks: [],
      sand: (d.sand || []).map(shape), water: (d.water || []).map(shape),
      slopes: (d.slopes || []).map((s) => ({ s: shape(s.s), gx: s.g[0], gy: s.g[1] })),
      hills: (d.hills || []).map(([x, y, r, k]) => ({ x, y, r, k })),
      conv: (d.conveyors || []).map(([x, y, w, h, dx, dy, v]) => ({ s: shape(['r', x, y, w, h]), x, y, w, h, dx, dy, v })),
      pipes: (d.pipes || []).map(([ax, ay, bx, by, deg]) => ({ ax, ay, bx, by, ox: Math.cos(deg * Math.PI / 180), oy: Math.sin(deg * Math.PI / 180), len: Math.hypot(bx - ax, by - ay) })),
      mill: d.mill ? Object.assign({}, d.mill) : null,
      loop: d.loop ? Object.assign({ w: 26 }, d.loop) : null,
      bridge: d.bridge ? Object.assign({ amp: 0, down: 1 }, d.bridge) : null,
      planks: d.planks || null, decor: d.decor || []
    };
    const addPoly = (pts, closed, vis, t) => {
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        H.segs.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], t: t || WT });
      }
      if (vis) H.draws.push({ pts, closed, t: t || WT });
    };
    H.greens.forEach((p) => addPoly(p, true, true));
    (d.walls || []).forEach((p) => addPoly(p, false, true));
    (d.blocks || []).forEach(([x, y, w, h]) => { const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; addPoly(pts, true, true); H.blocks.push(pts); });
    (d.posts || []).forEach(([x, y, r]) => H.posts.push({ x, y, r }));
    (d.bumpers || []).forEach(([x, y, r]) => H.bumpers.push({ x, y, r, hit: 0 }));
    if (H.mill) {
      const m = H.mill, hw = m.gap / 2, side = 30, dep = 25;
      m.y0 = m.y - dep; m.y1 = m.y + dep; m.hw = hw; m.side = side;
      addPoly([[m.x - hw - side, m.y0], [m.x - hw, m.y0], [m.x - hw, m.y1], [m.x - hw - side, m.y1]], true, false, 1);
      addPoly([[m.x + hw, m.y0], [m.x + hw + side, m.y0], [m.x + hw + side, m.y1], [m.x + hw, m.y1]], true, false, 1);
    }
    if (H.loop) {
      const l = H.loop;
      // Small posts at the loop's feet (they keep the ball in the lane under the loop).
      l.yc = l.y - l.len / 2;
    }
    // Bounds and the collision grid.
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    H.greens.forEach((p) => p.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
    H.bbox = [x0, y0, x1, y1];
    const C = 32, gx0 = Math.floor((x0 - 40) / C), gy0 = Math.floor((y0 - 40) / C), gw = Math.ceil((x1 - x0 + 80) / C) + 1, gh = Math.ceil((y1 - y0 + 80) / C) + 1;
    const grid = []; for (let i = 0; i < gw * gh; i++) grid.push([]);
    H.segs.forEach((s, k) => {
      const pad = s.t + BR + 4;
      const cx0 = clamp(Math.floor((Math.min(s.ax, s.bx) - pad) / C) - gx0, 0, gw - 1), cx1 = clamp(Math.floor((Math.max(s.ax, s.bx) + pad) / C) - gx0, 0, gw - 1);
      const cy0 = clamp(Math.floor((Math.min(s.ay, s.by) - pad) / C) - gy0, 0, gh - 1), cy1 = clamp(Math.floor((Math.max(s.ay, s.by) + pad) / C) - gy0, 0, gh - 1);
      for (let yy = cy0; yy <= cy1; yy++) for (let xx = cx0; xx <= cx1; xx++) grid[yy * gw + xx].push(k);
    });
    H.grid = { C, gx0, gy0, gw, gh, cells: grid };
    return H;
  }
  const HOLES = COURSES.map((c, ci) => c.holes.map((d, hi) => compile(d, ci, hi)));
  const coursePar = (ci) => HOLES[ci].reduce((s, h) => s + h.par, 0);

  // ---------- Physics ----------
  const bridgeX = (br, T) => br.cx + br.amp * Math.sin(TAU * T * DT / br.period);
  const bridgePhase = (br, T) => ((T * DT / br.period) % 1 + 1) % 1;
  const bridgeDown = (br, T) => bridgePhase(br, T) < br.down;
  const millAngle = (m, T) => m.phase + TAU * T * DT / m.period;
  function millBlocked(m, T) {
    const q = Math.PI / 2;
    let a = (millAngle(m, T) - q) % q; if (a < 0) a += q;
    return a < 0.3 || a > q - 0.3;
  }
  function onBridge(H, x, y, T) {
    const br = H.bridge;
    if (!br || y <= br.y0 || y >= br.y1 || x <= br.x0 || x >= br.x1) return 0;
    if (br.kind === 'slide') return Math.abs(x - bridgeX(br, T)) < br.bw / 2 ? 1 : -1;
    return bridgeDown(br, T) && Math.abs(x - br.cx) < br.bw / 2 ? 1 : -1;
  }
  function inWater(H, x, y, T) {
    for (let i = 0; i < H.water.length; i++) if (inShape(H.water[i], x, y)) return true;
    if (onBridge(H, x, y, T) < 0) return true;
    for (let i = 0; i < H.greens.length; i++) if (pip(H.greens[i], x, y)) return false;
    return true;
  }
  function inSand(H, x, y) { for (let i = 0; i < H.sand.length; i++) if (inShape(H.sand[i], x, y)) return true; return false; }

  function newBall(x, y) { return { x, y, vx: 0, vy: 0, st: 'rest', still: 0, age: 0, inCup: false, t: 0, t0: 0, pi: 0, ps: 0, lt: 0, lv0: 0 }; }
  const shotSpeed = (p) => VMAX * Math.pow(clamp(p, 0, 1), 1.2);
  function applyShot(b, ang, pow) {
    const v = shotSpeed(pow);
    b.vx = Math.cos(ang) * v; b.vy = Math.sin(ang) * v;
    b.st = 'roll'; b.still = 0; b.age = 0; b.inCup = false;
  }

  function hitSeg(b, ax, ay, bx, by, R, ev) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((b.x - ax) * dx + (b.y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t, qy = ay + dy * t;
    let nx = b.x - qx, ny = b.y - qy;
    const d2 = nx * nx + ny * ny;
    if (d2 >= R * R) return false;
    let d = Math.sqrt(d2);
    if (d < 1e-6) { nx = -b.vx; ny = -b.vy; d = Math.hypot(nx, ny); if (d < 1e-6) { nx = 0; ny = 1; d = 1; } }
    nx /= d; ny /= d;
    b.x = qx + nx * R; b.y = qy + ny * R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + WALL_E) * vn * nx; b.vy -= (1 + WALL_E) * vn * ny;
      b.vx *= 0.985; b.vy *= 0.985;
      if (ev && vn < -45) ev.push(['wall', -vn, qx, qy]);
    }
    return true;
  }
  function hitCirc(b, c, R, e, kick, ev, kind, idx) {
    let nx = b.x - c.x, ny = b.y - c.y;
    const d2 = nx * nx + ny * ny;
    if (d2 >= R * R) return;
    let d = Math.sqrt(d2);
    if (d < 1e-6) { nx = 0; ny = 1; d = 1; }
    nx /= d; ny /= d;
    b.x = c.x + nx * R; b.y = c.y + ny * R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
      if (kick) {
        b.vx += nx * kick; b.vy += ny * kick;
        const sp = Math.hypot(b.vx, b.vy); if (sp > VMAX) { b.vx *= VMAX / sp; b.vy *= VMAX / sp; }
      }
      if (ev && (kick || vn < -45)) ev.push([kind, -vn, idx]);
    }
  }

  // One physics step for a ball on hole H at step T. ev (optional) collects events for sounds and effects.
  function physStep(b, H, T, ev) {
    if (b.st === 'pipe') {
      if (--b.t <= 0) {
        const p = H.pipes[b.pi];
        b.x = p.bx; b.y = p.by; b.vx = p.ox * b.ps; b.vy = p.oy * b.ps; b.st = 'roll'; b.still = 0;
        if (ev) ev.push(['pipeOut', b.pi]);
      }
      return;
    }
    if (b.st === 'loop') {
      const l = H.loop;
      const v = Math.sqrt(Math.max(b.lv0 * b.lv0 - 2 * LOOP_G * LOOP_R * (1 - Math.cos(b.lt)), 900));
      b.lt += (v / LOOP_R) * DT;
      if (b.lt >= TAU) {
        b.st = 'roll'; b.x = l.x; b.y = l.y - l.len; b.vx = 0; b.vy = -b.lv0 * 0.86; b.still = 0; b.lt = 0;
        if (ev) ev.push(['loopOut']);
        return;
      }
      b.x = l.x; b.y = l.y - l.len * (b.lt / TAU);
      return;
    }
    if (b.st === 'roll') b.age++;
    let ax = 0, ay = 0;
    // A moving bridge carries the ball.
    const br = H.bridge;
    let onBr = false;
    if (br) {
      const ob = onBridge(H, b.x, b.y, T);
      if (ob > 0) { onBr = true; if (br.kind === 'slide') b.x += bridgeX(br, T) - bridgeX(br, T - 1); }
    }
    for (let i = 0; i < H.slopes.length; i++) { const s = H.slopes[i]; if (inShape(s.s, b.x, b.y)) { ax += s.gx; ay += s.gy; } }
    for (let i = 0; i < H.hills.length; i++) {
      const h = H.hills[i], dx = b.x - h.x, dy = b.y - h.y, d = Math.hypot(dx, dy);
      if (d < h.r && d > 0.5) { const f = h.k * Math.sin(Math.PI * d / h.r); ax += dx / d * f; ay += dy / d * f; }
    }
    const force = Math.hypot(ax, ay);
    b.vx += ax * DT; b.vy += ay * DT;
    // Friction (on a belt it works against the belt's speed, so the belt carries the ball).
    let conv = null;
    for (let i = 0; i < H.conv.length; i++) if (inShape(H.conv[i].s, b.x, b.y)) { conv = H.conv[i]; break; }
    const sandy = inSand(H, b.x, b.y);
    let sp;
    if (conv) {
      const bx = conv.dx * conv.v, by = conv.dy * conv.v;
      let rx = b.vx - bx, ry = b.vy - by;
      const rs = Math.hypot(rx, ry);
      if (rs > 0) { const ns = Math.max(0, rs - (420 + 1.6 * rs) * DT); rx *= ns / rs; ry *= ns / rs; }
      b.vx = bx + rx; b.vy = by + ry;
      sp = Math.hypot(b.vx, b.vy);
    } else {
      sp = Math.hypot(b.vx, b.vy);
      const dec = sandy ? MU_S + KD_S * sp : MU + KD * sp;
      if (sp > 0) { const ns = Math.max(0, sp - dec * DT); b.vx *= ns / sp; b.vy *= ns / sp; sp = ns; }
    }
    // The cup: slow balls drop in, fast ones curl round the lip.
    const cx = b.x - H.cup[0], cy = b.y - H.cup[1], cd = Math.hypot(cx, cy);
    if (cd < CUP) {
      if (sp < CAP_V && cd < CUP - 2.5) { b.st = 'sunk'; b.vx = b.vy = 0; if (ev) ev.push(['sunk']); return; }
      if (cd > 0.01) { b.vx -= cx / cd * PULL * DT; b.vy -= cy / cd * PULL * DT; }
      b.inCup = true;
    } else if (b.inCup) { b.inCup = false; if (ev) ev.push(['lip']); }
    const py = b.y;
    b.x += b.vx * DT; b.y += b.vy * DT;
    // Pipes swallow the ball and spit it out somewhere else.
    for (let i = 0; i < H.pipes.length; i++) {
      const p = H.pipes[i];
      if (Math.hypot(b.x - p.ax, b.y - p.ay) < 10) {
        b.st = 'pipe'; b.pi = i; b.ps = clamp(sp * 0.9, 180, 600);
        b.t = b.t0 = Math.round(clamp(p.len / 420, 0.35, 1.1) / DT);
        b.x = p.ax; b.y = p.ay; b.vx = b.vy = 0;
        if (ev) ev.push(['pipeIn', i]);
        return;
      }
    }
    // Loops: fast enough and you go round, otherwise you roll back.
    if (H.loop) {
      const l = H.loop;
      if (py > l.y && b.y <= l.y && Math.abs(b.x - l.x) < l.w && b.vy < 0) {
        if (sp >= LOOP_V) { b.st = 'loop'; b.lt = 0; b.lv0 = sp; b.x = l.x; b.y = l.y; b.vx = b.vy = 0; if (ev) ev.push(['loop']); return; }
        b.vy = -b.vy * 0.5; b.vx *= 0.5; b.y = l.y + 0.5;
        if (ev) ev.push(['loopFail']);
      }
    }
    // Walls, posts, bumpers and the windmill.
    const G = H.grid;
    const gx = Math.floor(b.x / G.C) - G.gx0, gy = Math.floor(b.y / G.C) - G.gy0;
    if (gx >= 0 && gy >= 0 && gx < G.gw && gy < G.gh) {
      const cell = G.cells[gy * G.gw + gx];
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < cell.length; i++) { const s = H.segs[cell[i]]; hitSeg(b, s.ax, s.ay, s.bx, s.by, s.t + BR, pass ? null : ev); }
      }
    }
    for (let i = 0; i < H.posts.length; i++) hitCirc(b, H.posts[i], H.posts[i].r + BR, 0.7, 0, ev, 'post', i);
    for (let i = 0; i < H.bumpers.length; i++) hitCirc(b, H.bumpers[i], H.bumpers[i].r + BR, 1, KICK, ev, 'bump', i);
    if (H.mill && millBlocked(H.mill, T)) { const m = H.mill; hitSeg(b, m.x - m.hw, m.y1, m.x + m.hw, m.y1, 3 + BR, ev); }
    if (inWater(H, b.x, b.y, T)) { b.st = 'water'; b.vx = b.vy = 0; if (ev) ev.push(['water']); return; }
    // At rest?
    sp = Math.hypot(b.vx, b.vy);
    if (sp < 5) {
      const lim = sandy ? MU_S : MU;
      b.still += DT;
      if ((!conv && force <= lim) || b.still > 1.5) { b.vx = b.vy = 0; b.st = onBr ? 'ride' : 'rest'; b.still = 0; }
    } else b.still = 0;
    if (b.st === 'roll' && b.age > 25 / DT) { b.vx = b.vy = 0; b.st = onBr ? 'ride' : 'rest'; }
  }
  const settled = (st) => st === 'rest' || st === 'ride';
  const ended = (st) => st === 'rest' || st === 'ride' || st === 'sunk' || st === 'water';

  // Plays a shot to the end without touching the game (deterministic): { x, y, st, steps }.
  function simulate(H, b0, T, ang, pow, maxSteps) {
    const b = Object.assign({}, b0);
    applyShot(b, ang, pow);
    let t = T, n = 0;
    const lim = maxSteps || 40 / DT;
    for (; n < lim; n++) { physStep(b, H, t, null); t++; if (ended(b.st)) break; }
    return { x: b.x, y: b.y, st: b.st, steps: n + 1, T: t };
  }

  // ---------- Themes ----------
  const THEMES = {
    garden: {
      bg: '#93d36a', bg2: '#8acb61', felt: '#4cc15b', felt2: '#45b553', wallTop: '#f3c27e', wallSide: '#c0813f', wallEdge: '#a86c30',
      path: '#ece6d6', path2: '#d9d0bb', water: '#59c2ef', water2: '#3aa5dc', rim: '#c4ecfb', sand: '#f4dd9d', sand2: '#e6c579',
      flag: '#ef4444', tube: '#22a447', tube2: '#5ad070', loop: '#f59e0b', loop2: '#fde68a', bumper: '#ec4899', bumper2: '#fbcfe8',
      bridge: '#c58a52', bridge2: '#9a6634', post: '#e8d9bb', post2: '#c8b48c'
    },
    pirate: {
      bg: '#2fb7da', bg2: '#46c6e6', felt: '#3fbe73', felt2: '#38b169', wallTop: '#c98f55', wallSide: '#8b5a2b', wallEdge: '#6e4420',
      beach: '#f6e0a3', beach2: '#ecd087', foam: '#e6fbff', water: '#33b6dd', water2: '#1e9cc9', rim: '#d5f6ff', sand: '#f8e6ae', sand2: '#e8cd85',
      flag: '#1f2937', tube: '#b7793f', tube2: '#e0a466', loop: '#a16207', loop2: '#fbbf24', bumper: '#b45309', bumper2: '#fcd34d',
      bridge: '#b97b45', bridge2: '#80522a', post: '#a7a29a', post2: '#7c766d'
    }
  };

  // ---------- View (world -> canvas pixels) ----------
  // ground: x * k + ox, y * k * TILT + oy ; something z units tall rises by z * k.
  const groundT = (g, V) => g.setTransform(V.k, 0, 0, V.k * TILT, V.ox, V.oy);
  const upT = (g, V, x, y, z, sc) => { const k = V.k * (sc || 1); g.setTransform(k, 0, 0, k, V.ox + x * V.k, V.oy + y * V.k * TILT - (z || 0) * V.k); };

  // ---------- Static hole art ----------
  function renderArt(g, V, H, rect, th, opts) {
    const theme = THEMES[th];
    const rnd = CG.rng(1234 + H.ci * 97 + H.hi * 7919);
    const [rx0, ry0, rx1, ry1] = rect;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = theme.bg; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    groundT(g, V);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const greens = H.greens;
    const dist = (x, y) => { let d = 1e9, inside = false; greens.forEach((p) => { d = Math.min(d, polyDist(p, x, y)); if (pip(p, x, y)) inside = true; }); return inside ? -d : d; };
    if (th === 'garden') {
      // Mown lawn stripes and little tufts.
      g.fillStyle = theme.bg2;
      for (let x = Math.floor(rx0 / 80) * 80 - 400; x < rx1 + 400; x += 80) { g.beginPath(); g.moveTo(x, ry0 - 50); g.lineTo(x + 40, ry0 - 50); g.lineTo(x + 40 + (ry1 - ry0 + 100) * 0.5, ry1 + 50); g.lineTo(x + (ry1 - ry0 + 100) * 0.5, ry1 + 50); g.fill(); }
      g.strokeStyle = 'rgba(40,110,30,.28)'; g.lineWidth = 1.4;
      const nT = Math.round((rx1 - rx0) * (ry1 - ry0) / 900);
      for (let i = 0; i < nT; i++) { const x = lerp(rx0, rx1, rnd()), y = lerp(ry0, ry1, rnd()); g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x - 3, y - 4); g.moveTo(x, y); g.lineTo(x, y - 5); g.moveTo(x + 2, y); g.lineTo(x + 3, y - 4); g.stroke(); }
      // A paved path round the hole.
      greens.forEach((p) => { polyPath(g, p); g.strokeStyle = theme.path2; g.lineWidth = 50; g.stroke(); });
      greens.forEach((p) => { polyPath(g, p); g.strokeStyle = theme.path; g.lineWidth = 44; g.stroke(); });
      // Paving stones.
      g.strokeStyle = 'rgba(160,130,90,.25)'; g.lineWidth = 1.2;
      greens.forEach((p) => {
        for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
          for (let s = 10; s < L - 4; s += 18) { const x = a[0] + (b[0] - a[0]) * s / L, y = a[1] + (b[1] - a[1]) * s / L; g.beginPath(); g.moveTo(x - nx * 21, y - ny * 21); g.lineTo(x - nx * 9, y - ny * 9); g.moveTo(x + nx * 9, y + ny * 9); g.lineTo(x + nx * 21, y + ny * 21); g.stroke(); }
        }
      });
    } else {
      // Sea with waves, a sandy island round the hole, foam.
      const sea = g.createLinearGradient(0, ry0, 0, ry1); sea.addColorStop(0, theme.bg2); sea.addColorStop(1, theme.bg);
      g.fillStyle = sea; g.fillRect(rx0 - 50, ry0 - 50, rx1 - rx0 + 100, ry1 - ry0 + 100);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
      const nW = Math.round((rx1 - rx0) * (ry1 - ry0) / 5000);
      for (let i = 0; i < nW; i++) { const x = lerp(rx0, rx1, rnd()), y = lerp(ry0, ry1, rnd()); if (dist(x, y) < 90) continue; g.beginPath(); g.moveTo(x - 9, y); g.quadraticCurveTo(x - 4.5, y - 4, x, y); g.quadraticCurveTo(x + 4.5, y + 4, x + 9, y); g.stroke(); }
      const blobs = [];
      greens.forEach((p) => {
        for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let s = 0; s < L; s += 26) blobs.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L, 52 + rnd() * 26]);
        }
      });
      g.fillStyle = 'rgba(255,255,255,.5)'; blobs.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r + 12, 0, TAU); g.fill(); });
      g.fillStyle = theme.foam; blobs.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r + 5, 0, TAU); g.fill(); });
      g.fillStyle = theme.beach2; blobs.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); });
      g.fillStyle = theme.beach; blobs.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y - 2, r - 4, 0, TAU); g.fill(); });
      greens.forEach((p) => { polyPath(g, p); g.fillStyle = theme.beach; g.fill(); });
      g.fillStyle = 'rgba(190,150,80,.28)';
      const nS = Math.round((rx1 - rx0) * (ry1 - ry0) / 260);
      for (let i = 0; i < nS; i++) { const x = lerp(rx0, rx1, rnd()), y = lerp(ry0, ry1, rnd()); const d = dist(x, y); if (d < 8 || d > 50) continue; g.fillRect(x, y, 1.6, 1.6); }
    }
    // Decorations lying flat on the ground, and the tall ones to draw later (sorted by depth).
    const tall = [];
    const flat = [];
    H.decor.forEach(([kind, x, y, s]) => (FLAT[kind] ? flat : tall).push({ kind, x, y, s: s || 1, r: rnd() }));
    const step = 44;
    for (let y = Math.floor(ry0 / step) * step; y < ry1 + step; y += step) {
      for (let x = Math.floor(rx0 / step) * step; x < rx1 + step; x += step) {
        const px = x + rnd() * step, py = y + rnd() * step, d = dist(px, py);
        const pick = rnd(), sz = 0.8 + rnd() * 0.45, r = rnd();
        if (d < 30) continue;
        let kind = null;
        if (th === 'garden') {
          if (d < 50) kind = pick < 0.3 ? 'flowers' : pick < 0.4 ? 'tulips' : pick < 0.46 ? 'mushroom' : null;
          else kind = pick < 0.2 ? 'tree' : pick < 0.42 ? 'bush' : pick < 0.6 ? 'flowers' : pick < 0.68 ? 'tulips' : pick < 0.72 ? 'stone' : pick < 0.745 ? 'gnome' : pick < 0.77 ? 'mushroom' : null;
        } else {
          if (d < 58) kind = pick < 0.16 ? 'palm' : pick < 0.27 ? 'shell' : pick < 0.36 ? 'starfish' : pick < 0.42 ? 'barrel' : pick < 0.45 ? 'crab' : pick < 0.47 ? 'chest' : null;
          else if (d > 100) kind = pick < 0.022 ? 'rock' : pick < 0.034 ? 'buoy' : pick < 0.042 ? 'boat' : pick < 0.047 ? 'isle' : null;
        }
        if (!kind) continue;
        if (!FLAT[kind]) { const hgt = (TALL_H[kind] || 30) * sz / TILT; let ok = true; const hw = kind === 'tree' || kind === 'palm' || kind === 'boat' ? 24 : 10; for (let q = 0; q <= hgt; q += 8) if (dist(px, py - q) < 34 || dist(px - hw, py - q) < 30 || dist(px + hw, py - q) < 30) { ok = false; break; } if (!ok) continue; }
        (FLAT[kind] ? flat : tall).push({ kind, x: px, y: py, s: sz, r });
      }
    }
    flat.forEach((o) => { groundT(g, V); g.translate(o.x, o.y); g.scale(o.s, o.s); FLAT[o.kind](g, theme, o.r); });
    groundT(g, V);
    // Shadow under the course, then the felt with mowing stripes and speckles.
    g.save(); g.translate(4, 7); greens.forEach((p) => { polyPath(g, p); g.fillStyle = 'rgba(0,0,0,.16)'; g.fill(); }); g.restore();
    g.save();
    g.beginPath(); greens.forEach((p) => { p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); });
    g.clip();
    const [bx0, by0, bx1, by1] = H.bbox;
    g.fillStyle = theme.felt; g.fillRect(bx0 - 20, by0 - 20, bx1 - bx0 + 40, by1 - by0 + 40);
    g.fillStyle = theme.felt2;
    for (let y = by0 - 400; y < by1 + 40; y += 44) { g.beginPath(); g.moveTo(bx0 - 20, y); g.lineTo(bx1 + 20, y + (bx1 - bx0 + 40) * 0.35); g.lineTo(bx1 + 20, y + 22 + (bx1 - bx0 + 40) * 0.35); g.lineTo(bx0 - 20, y + 22); g.fill(); }
    const nF = Math.round((bx1 - bx0) * (by1 - by0) / 70);
    for (let i = 0; i < nF; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(0,60,0,.07)'; g.fillRect(lerp(bx0, bx1, rnd()), lerp(by0, by1, rnd()), 1.5, 1.5); }
    // Slopes: shading plus little downhill arrows.
    H.slopes.forEach((s) => {
      g.save(); shapePath(g, s.s); g.clip();
      const r = s.s.t === 'r' ? s.s : { x: s.s.x - s.s.rx, y: s.s.y - s.s.ry, w: s.s.rx * 2, h: s.s.ry * 2 };
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, gl = Math.hypot(s.gx, s.gy), ux = s.gx / gl, uy = s.gy / gl, L = Math.abs(ux) * r.w / 2 + Math.abs(uy) * r.h / 2;
      const gr = g.createLinearGradient(cx - ux * L, cy - uy * L, cx + ux * L, cy + uy * L);
      gr.addColorStop(0, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(0,40,0,.2)');
      g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = 'rgba(255,255,255,.32)'; g.lineWidth = 3; const a = Math.atan2(uy, ux);
      for (let yy = r.y + 26; yy < r.y + r.h; yy += 52) for (let xx = r.x + 26 + ((yy / 52) % 2) * 26; xx < r.x + r.w; xx += 52) {
        g.save(); g.translate(xx, yy); g.rotate(a); g.beginPath(); g.moveTo(-5, -8); g.lineTo(4, 0); g.lineTo(-5, 8); g.stroke(); g.restore();
      }
      g.restore();
    });
    H.hills.forEach((h) => {
      const bump = h.k > 0;
      const g1 = g.createRadialGradient(h.x - h.r * 0.25, h.y - h.r * 0.25, 2, h.x, h.y, h.r);
      g1.addColorStop(0, bump ? 'rgba(255,255,255,.26)' : 'rgba(0,40,0,.2)'); g1.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = g1; g.beginPath(); g.arc(h.x, h.y, h.r, 0, TAU); g.fill();
      const g2 = g.createRadialGradient(h.x + h.r * 0.3, h.y + h.r * 0.3, 2, h.x, h.y, h.r);
      g2.addColorStop(0, bump ? 'rgba(0,40,0,.18)' : 'rgba(255,255,255,.16)'); g2.addColorStop(1, 'rgba(0,40,0,0)');
      g.fillStyle = g2; g.beginPath(); g.arc(h.x, h.y, h.r, 0, TAU); g.fill();
      g.strokeStyle = bump ? 'rgba(255,255,255,.14)' : 'rgba(0,50,0,.12)'; g.lineWidth = 1.5;
      for (let q = 0.35; q < 1; q += 0.22) { g.beginPath(); g.arc(h.x, h.y, h.r * q, 0, TAU); g.stroke(); }
    });
    // Sand.
    H.sand.forEach((s) => {
      g.save(); shapePath(g, s, 2.5); g.fillStyle = theme.sand2; g.fill();
      shapePath(g, s); g.fillStyle = theme.sand; g.fill(); g.clip();
      g.fillStyle = 'rgba(160,120,50,.22)';
      const bb = s.t === 'e' ? [s.x - s.rx, s.y - s.ry, s.rx * 2, s.ry * 2] : [s.x, s.y, s.w, s.h];
      for (let i = 0; i < bb[2] * bb[3] / 18; i++) g.fillRect(bb[0] + rnd() * bb[2], bb[1] + rnd() * bb[3], 1.4, 1.4);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) { const x = bb[0] + bb[2] * (0.2 + rnd() * 0.6), y = bb[1] + bb[3] * (0.25 + rnd() * 0.5); g.beginPath(); g.arc(x, y, 6 + rnd() * 6, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
      g.restore();
    });
    // Water (ponds inside the course, the bridge channel).
    const waters = H.water.slice();
    if (H.bridge) { const b = H.bridge; waters.push({ t: 'r', x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }); }
    waters.forEach((s) => {
      g.save(); shapePath(g, s, 3); g.fillStyle = theme.rim; g.fill();
      shapePath(g, s); g.clip();
      const bb = s.t === 'e' ? [s.x - s.rx, s.y - s.ry, s.rx * 2, s.ry * 2] : [s.x, s.y, s.w, s.h];
      const wg = g.createLinearGradient(0, bb[1], 0, bb[1] + bb[3]); wg.addColorStop(0, theme.water2); wg.addColorStop(1, theme.water);
      g.fillStyle = wg; g.fillRect(bb[0] - 2, bb[1] - 2, bb[2] + 4, bb[3] + 4);
      g.fillStyle = 'rgba(0,40,80,.18)'; g.fillRect(bb[0] - 2, bb[1] - 2, bb[2] + 4, 5);
      g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1.6;
      for (let i = 0; i < bb[2] * bb[3] / 900; i++) { const x = bb[0] + rnd() * bb[2], y = bb[1] + rnd() * bb[3]; g.beginPath(); g.moveTo(x - 6, y); g.quadraticCurveTo(x - 3, y - 2.5, x, y); g.quadraticCurveTo(x + 3, y + 2.5, x + 6, y); g.stroke(); }
      if (th === 'garden') for (let i = 0; i < bb[2] * bb[3] / 2600; i++) {
        const x = bb[0] + 10 + rnd() * (bb[2] - 20), y = bb[1] + 10 + rnd() * (bb[3] - 20), r = 6 + rnd() * 4, a0 = rnd() * TAU;
        if (!inShape(s, x, y)) continue;
        g.fillStyle = '#3f9f45'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a0 + 0.5, a0 + TAU - 0.1); g.closePath(); g.fill();
        g.fillStyle = '#5cc25d'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, r * 0.75, a0 + 0.6, a0 + TAU - 0.2); g.closePath(); g.fill();
        if (rnd() < 0.4) { disc(g, x + r * 0.2, y - r * 0.1, 2.6, '#f9a8d4'); disc(g, x + r * 0.2, y - r * 0.1, 1.2, '#fde047'); }
      }
      g.restore();
    });
    // Planks over water (Plank Walk).
    if (H.planks) {
      const [x, y, w, h] = H.planks;
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + 3, y + 4, w, h);
      g.fillStyle = '#c58a52'; g.fillRect(x, y, w, h);
      g.strokeStyle = '#8f5c2f'; g.lineWidth = 1.4;
      for (let yy = y; yy <= y + h; yy += 14) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
      g.fillStyle = '#7a4a22'; for (let yy = y + 7; yy < y + h; yy += 14) { disc(g, x + 5, yy, 1.4, '#7a4a22'); disc(g, x + w - 5, yy, 1.4, '#7a4a22'); }
      g.fillStyle = '#9a6634'; g.fillRect(x - 3, y, 3, h); g.fillRect(x + w, y, 3, h);
    }
    // Conveyor frames (the belt itself moves, drawn every frame).
    H.conv.forEach((c) => { g.fillStyle = 'rgba(0,0,0,.2)'; rr(g, c.x - 2, c.y - 2 + 3, c.w + 4, c.h + 4, 6); g.fill(); g.fillStyle = '#475569'; rr(g, c.x - 2, c.y - 2, c.w + 4, c.h + 4, 6); g.fill(); });
    // The tee mat and the cup.
    const [tx, ty] = H.tee;
    g.fillStyle = 'rgba(0,0,0,.15)'; rr(g, tx - 21, ty - 12, 42, 26, 6); g.fill();
    g.fillStyle = shade(theme.felt, -0.25); rr(g, tx - 21, ty - 14, 42, 26, 6); g.fill();
    g.fillStyle = shade(theme.felt, -0.12); rr(g, tx - 18, ty - 11, 36, 20, 5); g.fill();
    disc(g, tx - 13, ty - 1, 2.4, '#fff'); disc(g, tx + 13, ty - 1, 2.4, '#fff');
    const [cx, cy] = H.cup;
    ell(g, cx, cy, CUP + 3.5, CUP + 3.5, 'rgba(255,255,255,.22)');
    ell(g, cx, cy, CUP + 1, CUP + 1, '#e5e7eb');
    ell(g, cx, cy, CUP, CUP, '#111827');
    g.save(); g.beginPath(); g.arc(cx, cy, CUP, 0, TAU); g.clip(); ell(g, cx, cy + 5, CUP, CUP, '#030712'); g.restore();
    g.restore();
    // Walls: shadow, side, top.
    const strokeAll = (lw, col, dz) => {
      g.strokeStyle = col; g.lineWidth = lw;
      H.draws.forEach((w) => { g.beginPath(); w.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1] - dz) : g.moveTo(p[0], p[1] - dz))); if (w.closed) g.closePath(); g.stroke(); });
    };
    g.save(); g.translate(3, 5); strokeAll(WT * 2 + 2, 'rgba(0,0,0,.16)', 0); g.restore();
    for (let z = 0; z <= WH; z += 2) strokeAll(WT * 2, theme.wallSide, z / TILT);
    strokeAll(WT * 2 + 1, theme.wallEdge, WH / TILT + 0.6);
    strokeAll(WT * 2 - 1.5, theme.wallTop, WH / TILT + 0.6);
    if (th === 'pirate') {
      g.strokeStyle = 'rgba(110,68,32,.45)'; g.lineWidth = 1;
      H.draws.forEach((w) => {
        const n = w.closed ? w.pts.length : w.pts.length - 1;
        for (let i = 0; i < n; i++) {
          const a = w.pts[i], b = w.pts[(i + 1) % w.pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let s = 14; s < L; s += 28) { const x = a[0] + (b[0] - a[0]) * s / L, y = a[1] + (b[1] - a[1]) * s / L - WH / TILT; disc(g, x, y, 1.6, 'rgba(110,68,32,.55)'); }
        }
      });
    } else {
      g.strokeStyle = 'rgba(255,236,200,.85)'; g.lineWidth = 2;
      H.draws.forEach((w) => { g.beginPath(); w.pts.forEach((p, i) => (i ? g.lineTo(p[0] - 1, p[1] - WH / TILT - 1.6) : g.moveTo(p[0] - 1, p[1] - WH / TILT - 1.6))); if (w.closed) g.closePath(); g.stroke(); });
      g.strokeStyle = 'rgba(140,85,35,.45)'; g.lineWidth = 1;
      H.draws.forEach((w) => {
        const n = w.closed ? w.pts.length : w.pts.length - 1;
        for (let i = 0; i < n; i++) {
          const a = w.pts[i], b = w.pts[(i + 1) % w.pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
          for (let s2 = 30; s2 < L - 10; s2 += 40) { const x = a[0] + (b[0] - a[0]) * s2 / L, y = a[1] + (b[1] - a[1]) * s2 / L - WH / TILT; g.beginPath(); g.moveTo(x - nx * 5, y - ny * 5); g.lineTo(x + nx * 5, y + ny * 5); g.stroke(); }
        }
      });
    }
    H.blocks.forEach((pts) => {
      g.fillStyle = theme.wallTop;
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1] - WH / TILT) : g.moveTo(p[0], p[1] - WH / TILT))); g.closePath(); g.fill();
      if (th === 'garden') { g.save(); g.clip(); for (let i = 0; i < 14; i++) { const x = lerp(pts[0][0], pts[1][0], rnd()), y = lerp(pts[0][1], pts[2][1], rnd()) - WH / TILT; disc(g, x, y, 2.2, ['#f472b6', '#facc15', '#a78bfa', '#fb7185'][i % 4]); disc(g, x, y, 0.9, '#fff7ed'); } g.restore(); }
    });
    // Round posts (flower pots / rocks).
    H.posts.forEach((p) => {
      g.save(); g.translate(3, 5); ell(g, p.x, p.y, p.r + 1, p.r + 1, 'rgba(0,0,0,.18)'); g.restore();
      for (let z = 0; z <= 14; z += 2) ell(g, p.x, p.y - z / TILT, p.r, p.r, theme.post2);
      ell(g, p.x, p.y - 14 / TILT, p.r, p.r, theme.post);
      if (th === 'garden') { ell(g, p.x, p.y - 14 / TILT, p.r - 3, p.r - 3, '#8b5a2b'); for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; disc(g, p.x + Math.cos(a) * (p.r - 7), p.y - 14 / TILT + Math.sin(a) * (p.r - 7), 3, ['#f472b6', '#fde047', '#fb923c', '#c084fc', '#fff'][i]); } disc(g, p.x, p.y - 14 / TILT, 3.4, '#4ade80'); }
      else { ell(g, p.x - p.r * 0.25, p.y - 14 / TILT - p.r * 0.25, p.r * 0.45, p.r * 0.35, 'rgba(255,255,255,.25)'); }
    });
    // Pipes: a hose (or wooden pipe) lying over the walls between the two mouths.
    H.pipes.forEach((p) => {
      const c = pipeCtrl(p);
      g.lineCap = 'round';
      g.save(); g.translate(2, 4); g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 16; g.beginPath(); g.moveTo(p.ax, p.ay); g.quadraticCurveTo(c[0], c[1], p.bx, p.by); g.stroke(); g.restore();
      g.strokeStyle = shade(theme.tube, -0.2); g.lineWidth = 16; g.beginPath(); g.moveTo(p.ax, p.ay - 8); g.quadraticCurveTo(c[0], c[1] - 8, p.bx, p.by - 8); g.stroke();
      g.strokeStyle = theme.tube; g.lineWidth = 13; g.stroke();
      g.strokeStyle = theme.tube2; g.lineWidth = 4; g.beginPath(); g.moveTo(p.ax - 2, p.ay - 11); g.quadraticCurveTo(c[0] - 2, c[1] - 11, p.bx - 2, p.by - 11); g.stroke();
      if (th === 'pirate') { g.strokeStyle = 'rgba(80,50,20,.5)'; g.lineWidth = 1.2; for (let t = 0.08; t < 1; t += 0.12) { const q = quadAt(p.ax, p.ay, c[0], c[1], p.bx, p.by, t); g.beginPath(); g.arc(q[0], q[1] - 8, 7, 0, TAU); g.stroke(); } }
      [[p.ax, p.ay, true], [p.bx, p.by, false]].forEach(([x, y, entry]) => {
        ell(g, x + 2, y + 4, 15, 15, 'rgba(0,0,0,.18)');
        for (let z = 0; z <= 12; z += 2) ell(g, x, y - z / TILT, 14, 14, shade(theme.tube, -0.28));
        ell(g, x, y - 12 / TILT, 14, 14, theme.tube);
        ell(g, x, y - 12 / TILT, 10.5, 10.5, entry ? '#0b1220' : shade(theme.tube, -0.45));
        if (!entry) { g.fillStyle = '#fff'; g.save(); g.translate(x, y - 12 / TILT); g.rotate(Math.atan2(p.oy, p.ox)); g.beginPath(); g.moveTo(6, 0); g.lineTo(-3, -5); g.lineTo(-3, 5); g.closePath(); g.fill(); g.restore(); }
      });
    });
    // Loop: ramps on the ground (the hoop is drawn every frame so the ball can go round it).
    if (H.loop) {
      const l = H.loop;
      g.fillStyle = 'rgba(0,0,0,.14)'; rr(g, l.x - 22, l.y - l.len - 6, 44, l.len + 12, 6); g.fill();
      g.fillStyle = shade(theme.loop, 0.55); rr(g, l.x - 20, l.y - l.len - 8, 40, l.len + 12, 6); g.fill();
    }
    // Tall decorations, sorted by depth.
    tall.sort((a, b) => a.y - b.y);
    tall.forEach((o) => { upT(g, V, o.x, o.y, 0, o.s); TALL[o.kind](g, theme, o.r); });
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (opts && opts.vignette) {
      const vg = g.createRadialGradient(g.canvas.width / 2, g.canvas.height / 2, Math.min(g.canvas.width, g.canvas.height) * 0.45, g.canvas.width / 2, g.canvas.height / 2, Math.max(g.canvas.width, g.canvas.height) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,30,10,.16)');
      g.fillStyle = vg; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    }
  }
  function pipeCtrl(p) {
    const mx = (p.ax + p.bx) / 2, my = (p.ay + p.by) / 2, dx = p.bx - p.ax, dy = p.by - p.ay, L = Math.hypot(dx, dy) || 1;
    return [mx - dy / L * L * 0.25, my + dx / L * L * 0.25];
  }
  function quadAt(ax, ay, cx, cy, bx, by, t) { const u = 1 - t; return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]; }

  // Flat ground decorations (ground transform; local units).
  const FLAT = {
    flowers(g, th, r) {
      const cols = ['#f472b6', '#fde047', '#ffffff', '#c084fc', '#fb923c', '#f87171'];
      for (let i = 0; i < 6; i++) {
        const a = i * 2.4 + r * 6, d = 4 + (i % 3) * 5, x = Math.cos(a) * d, y = Math.sin(a) * d, c = cols[(i + Math.floor(r * 6)) % cols.length];
        disc(g, x + 0.8, y + 1.2, 3.2, 'rgba(0,60,0,.18)');
        for (let k = 0; k < 5; k++) disc(g, x + Math.cos(k * 1.256) * 2.3, y + Math.sin(k * 1.256) * 2.3, 1.8, c);
        disc(g, x, y, 1.3, c === '#fde047' ? '#f97316' : '#fde047');
      }
    },
    stone(g) { ell(g, 1.5, 2.5, 9, 6, 'rgba(0,0,0,.15)'); ell(g, 0, 0, 9, 6, '#cbd5e1'); ell(g, -2, -1.5, 5, 3, '#e2e8f0'); },
    shell(g, th, r) {
      g.save(); g.rotate(r * TAU); g.fillStyle = r < 0.5 ? '#fbcfe8' : '#fde68a';
      g.beginPath(); g.moveTo(0, 4); g.arc(0, 4, 7, Math.PI * 1.15, Math.PI * 1.85); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(150,80,60,.5)'; g.lineWidth = 0.8; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(0, 4); g.lineTo(k * 2.4, -2.5); g.stroke(); }
      g.restore();
    },
    starfish(g, th, r) {
      g.save(); g.rotate(r * TAU); g.fillStyle = r < 0.5 ? '#fb923c' : '#f472b6';
      g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? 3.4 : 9; g.lineTo(Math.cos(a) * d, Math.sin(a) * d); } g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.6)'; for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * TAU / 5; disc(g, Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0.9, 'rgba(255,255,255,.7)'); }
      g.restore();
    },
    crab(g, th, r) {
      ell(g, 1, 2, 9, 5, 'rgba(0,0,0,.15)');
      g.strokeStyle = '#dc2626'; g.lineWidth = 1.6;
      for (let s = -1; s <= 1; s += 2) for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(s * 5, k * 1.6 - 1); g.lineTo(s * 9.5, k * 2.6); g.stroke(); }
      ell(g, 0, 0, 7.5, 5, '#ef4444'); disc(g, -9, -4.5, 2.8, '#ef4444'); disc(g, 9, -4.5, 2.8, '#ef4444');
      disc(g, -2.6, -4.6, 2, '#fff'); disc(g, 2.6, -4.6, 2, '#fff'); disc(g, -2.4, -4.6, 1, '#111'); disc(g, 2.8, -4.6, 1, '#111');
    }
  };
  const TALL_H = { isle: 60, tree: 72, palm: 84, bush: 26, tulips: 20, mushroom: 18, gnome: 34, barrel: 24, chest: 24, rock: 16, buoy: 8, boat: 46 };
  // Upright decorations (screen-scale transform; origin at the ground point, y up is negative).
  const TALL = {
    tree(g, th, r) {
      ell(g, 6, 0, 26, 11, 'rgba(0,50,0,.2)');
      g.fillStyle = '#92582c'; rr(g, -4, -26, 8, 26, 3); g.fill();
      const c1 = r < 0.5 ? '#3f9b3a' : '#2f8a3a', c2 = r < 0.5 ? '#57b947' : '#45a84b';
      disc(g, -12, -36, 16, c1); disc(g, 12, -36, 16, c1); disc(g, 0, -50, 20, c1);
      disc(g, -8, -40, 13, c2); disc(g, 8, -44, 13, c2); disc(g, -2, -54, 12, '#7bd35f');
      if (r < 0.35) { disc(g, -10, -32, 2.6, '#ef4444'); disc(g, 9, -40, 2.6, '#ef4444'); disc(g, 2, -52, 2.6, '#ef4444'); }
    },
    bush(g, th, r) {
      ell(g, 4, 1, 18, 7, 'rgba(0,50,0,.2)');
      disc(g, -9, -8, 10, '#2f8a3a'); disc(g, 9, -8, 10, '#2f8a3a'); disc(g, 0, -14, 12, '#3f9b3a'); disc(g, -3, -17, 6, '#5cbf4f');
      if (r < 0.5) for (let i = 0; i < 5; i++) disc(g, -10 + i * 5, -10 - (i % 2) * 6, 2, r < 0.25 ? '#f9a8d4' : '#fef08a');
    },
    tulips(g, th, r) {
      const cols = ['#ef4444', '#f472b6', '#facc15', '#a855f7'];
      for (let i = 0; i < 4; i++) {
        const x = -9 + i * 6, h = 12 + ((i * 7 + r * 10) % 5);
        g.strokeStyle = '#2f8a3a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, -h); g.stroke();
        ell(g, x + 2.5, -4, 3, 1.5, '#3f9b3a');
        g.fillStyle = cols[(i + Math.floor(r * 4)) % 4]; g.beginPath(); g.moveTo(x - 3, -h); g.lineTo(x - 3, -h - 4); g.lineTo(x - 1.5, -h - 2.5); g.lineTo(x, -h - 5); g.lineTo(x + 1.5, -h - 2.5); g.lineTo(x + 3, -h - 4); g.lineTo(x + 3, -h); g.quadraticCurveTo(x, -h + 3, x - 3, -h); g.fill();
      }
    },
    mushroom(g) {
      ell(g, 2, 0, 9, 3.5, 'rgba(0,0,0,.15)');
      g.fillStyle = '#fef3c7'; rr(g, -3, -9, 6, 9, 2.5); g.fill();
      g.fillStyle = '#ef4444'; g.beginPath(); g.ellipse(0, -9, 10, 7, 0, Math.PI, 0); g.closePath(); g.fill();
      disc(g, -4, -12, 1.6, '#fff'); disc(g, 3, -14, 1.8, '#fff'); disc(g, 5, -10, 1.2, '#fff');
    },
    gnome(g) {
      ell(g, 2, 0, 9, 3.5, 'rgba(0,0,0,.18)');
      g.fillStyle = '#2563eb'; rr(g, -6, -14, 12, 14, 4); g.fill();
      g.fillStyle = '#7c2d12'; g.fillRect(-6, -2, 5, 2); g.fillRect(1, -2, 5, 2);
      disc(g, 0, -18, 5, '#fcd9b6');
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-5, -18); g.quadraticCurveTo(0, -6, 5, -18); g.closePath(); g.fill();
      disc(g, 0, -17.5, 1.5, '#fb7185');
      g.fillStyle = '#ef4444'; g.beginPath(); g.moveTo(-6, -20); g.lineTo(6, -20); g.lineTo(1, -34); g.closePath(); g.fill();
      disc(g, -1.8, -19.5, 0.8, '#111'); disc(g, 1.8, -19.5, 0.8, '#111');
    },
    palm(g, th, r) {
      ell(g, 16, 0, 28, 9, 'rgba(0,0,0,.14)');
      const lean = (r - 0.5) * 16;
      g.strokeStyle = '#a16207'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(lean * 0.3, -26, lean, -52); g.stroke();
      g.strokeStyle = '#ca8a04'; g.lineWidth = 2;
      for (let t = 0.12; t < 1; t += 0.14) { const x = lean * t * t + lean * 0.3 * 2 * t * (1 - t) * 0, y = -52 * t; g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x + 3, y - 1); g.stroke(); }
      const tx = lean, ty = -52;
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.62, L = 26;
        g.fillStyle = i % 2 ? '#16a34a' : '#22c55e';
        g.beginPath(); g.moveTo(tx, ty);
        g.quadraticCurveTo(tx + Math.cos(a - 0.3) * L * 0.6, ty + Math.sin(a - 0.3) * L * 0.6 - 6, tx + Math.cos(a) * L, ty + Math.sin(a) * L + 10);
        g.quadraticCurveTo(tx + Math.cos(a + 0.3) * L * 0.5, ty + Math.sin(a + 0.3) * L * 0.5, tx, ty);
        g.fill();
      }
      disc(g, tx - 3, ty + 3, 3.2, '#78350f'); disc(g, tx + 3, ty + 4, 3.2, '#92400e');
    },
    barrel(g) {
      ell(g, 3, 1, 12, 4.5, 'rgba(0,0,0,.18)');
      g.fillStyle = '#9a6634'; rr(g, -9, -22, 18, 22, 5); g.fill();
      g.fillStyle = '#b97b45'; rr(g, -6, -22, 6, 22, 3); g.fill();
      g.fillStyle = '#475569'; g.fillRect(-9, -18, 18, 2.4); g.fillRect(-9, -6, 18, 2.4);
      ell(g, 0, -22, 9, 3.5, '#c58a52'); ell(g, 0, -22, 6.5, 2.2, '#9a6634');
    },
    chest(g) {
      ell(g, 3, 1, 15, 5, 'rgba(0,0,0,.18)');
      g.fillStyle = '#92400e'; rr(g, -13, -14, 26, 14, 2); g.fill();
      g.fillStyle = '#b45309'; g.beginPath(); g.moveTo(-13, -14); g.quadraticCurveTo(0, -26, 13, -14); g.closePath(); g.fill();
      g.fillStyle = '#facc15'; g.fillRect(-13, -15, 26, 2); g.fillRect(-2, -18, 4, 8); g.fillRect(-11, -14, 2, 14); g.fillRect(9, -14, 2, 14);
      disc(g, -6, -19, 2.4, '#fde047'); disc(g, 4, -20, 2, '#fef9c3');
    },
    isle(g, th, r) {
      ell(g, 0, 0, 44, 18, 'rgba(255,255,255,.6)'); ell(g, 0, -1, 40, 15, '#f6e0a3'); ell(g, -6, -3, 26, 9, '#fbe9b8');
      TALL.palm(g, th, r);
    },
    rock(g) {
      ell(g, 0, 2, 20, 6, 'rgba(255,255,255,.55)');
      g.fillStyle = '#78716c'; g.beginPath(); g.moveTo(-16, 0); g.lineTo(-10, -12); g.lineTo(0, -16); g.lineTo(12, -10); g.lineTo(16, 0); g.closePath(); g.fill();
      g.fillStyle = '#a8a29e'; g.beginPath(); g.moveTo(-10, -12); g.lineTo(0, -16); g.lineTo(2, -6); g.lineTo(-8, -4); g.closePath(); g.fill();
    },
    buoy(g) {
      ell(g, 0, 2, 13, 4, 'rgba(255,255,255,.55)');
      g.lineWidth = 4.5; g.strokeStyle = '#ef4444'; g.beginPath(); g.ellipse(0, -4, 9, 5, 0, 0, TAU); g.stroke();
      g.strokeStyle = '#fff'; g.setLineDash([4, 4.5]); g.stroke(); g.setLineDash([]);
    },
    boat(g) {
      ell(g, 0, 3, 30, 6, 'rgba(255,255,255,.5)');
      g.fillStyle = '#9a3412'; g.beginPath(); g.moveTo(-26, -8); g.lineTo(26, -8); g.lineTo(18, 2); g.lineTo(-18, 2); g.closePath(); g.fill();
      g.fillStyle = '#c2410c'; g.fillRect(-26, -9, 52, 3);
      g.fillStyle = '#78350f'; g.fillRect(-1.2, -44, 2.4, 36);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(2, -42); g.lineTo(20, -12); g.lineTo(2, -12); g.closePath(); g.fill();
      g.fillStyle = '#ef4444'; g.beginPath(); g.moveTo(-1, -44); g.lineTo(-12, -40); g.lineTo(-1, -37); g.closePath(); g.fill();
    }
  };

  // ---------- Game state ----------
  let root, cvs, ctx, dpr = 1, Wl = 1, Hl = 1;
  let art = null, artRect = null, artFor = null;
  let H = null;                  // current hole
  let theme = THEMES.garden, themeId = 'garden';
  let ball = newBall(0, 0);
  let T = 0;                     // physics step counter
  let acc = 0, last = 0, timeScale = 1;
  let state = 'menu';            // menu | play | done
  let P = null;                  // the round: { ci, hi, card, strokes, multi }
  let shotQ = null;              // { a, p, T }
  let lastSpot = null;
  let multi = false, multiInfo = null;
  let aim = null;                // { id, sx, sy, cx, cy } while dragging
  let kbAim = null;              // { a, p } keyboard aiming
  let aimA = -Math.PI / 2, aimP = 0;
  let waterT = 0, sunkT = 0, pickT = 0, nextT = 0;
  let sunkAt = null;
  let pipeT = 0;
  let flash = 0;
  let wallSnd = 0;
  let hintShown = false;
  const EV = [];
  const parts = [];
  const confetti = [];
  const ghosts = new Map();
  const cam = { x: 0, y: 0, s: 1, init: false, fitX: true, fitY: true, minX: 0, maxX: 0, minY: 0, maxY: 0, top: 64, bot: 50 };
  const hud = {};

  function canShoot() {
    return state === 'play' && settled(ball.st) && !shotQ && P && !P.holeDone && !CG.modalOpen() && !CG.countingDown() && !scOpen() && !document.querySelector('.mg-pickover');
  }

  // ---------- Layout and camera ----------
  function layout() {
    if (!H) return;
    const [x0, y0, x1, y1] = H.bbox;
    const narrow = Wl < 560;
    cam.top = narrow ? 92 : 70; cam.bot = narrow ? 58 : 54;
    const bw = x1 - x0 + 30, bh = y1 - y0 + 30 + 40;
    const sw = (Wl - 16) / bw, sh = (Hl - cam.top - cam.bot) / (bh * TILT);
    let s = Math.min(sw, sh, 1.8);
    if (s < 0.78) s = Math.min(sw, 0.78);
    cam.s = s;
    const viewW = Wl / s, viewHu = (cam.top) / (s * TILT), viewHd = (Hl - cam.top) / (s * TILT);
    const usable = (Hl - cam.top - cam.bot) / (s * TILT);
    const cxm = (x0 + x1) / 2;
    cam.fitX = viewW >= bw;
    if (cam.fitX) cam.minX = cam.maxX = cxm;
    else { cam.minX = x0 - 15 + viewW / 2; cam.maxX = x1 + 15 - viewW / 2; }
    cam.fitY = usable >= bh;
    // cam.y is the world y shown at the top of the usable area.
    const top = y0 - 15 - 40;
    if (cam.fitY) cam.minY = cam.maxY = top - (usable - bh) / 2;
    else { cam.minY = top; cam.maxY = y1 + 15 - usable; }
    cam.viewHu = viewHu; cam.viewHd = viewHd; cam.usable = usable; cam.viewW = viewW;
  }
  function camTarget() {
    let tx = clamp(ball.x, cam.minX, cam.maxX), ty;
    if (cam.fitY) ty = cam.minY;
    else {
      const by = ball.st === 'sunk' ? H.cup[1] : ball.y;
      const ahead = aim || kbAim ? Math.sin(aimA) * 90 : 0;
      ty = clamp(by + ahead - cam.usable * 0.55, cam.minY, cam.maxY);
    }
    return [tx, ty];
  }
  const view = () => ({ k: cam.s * dpr, ox: (Wl / 2 - cam.x * cam.s) * dpr, oy: (cam.top - cam.y * cam.s * TILT) * dpr });
  const toScreen = (x, y, z) => [Wl / 2 + (x - cam.x) * cam.s, cam.top + (y - cam.y) * cam.s * TILT - (z || 0) * cam.s];

  function buildArt() {
    if (!H) return;
    layout();
    const s = cam.s, k = s * dpr;
    const x0 = cam.minX - cam.viewW / 2 - 10, x1 = cam.maxX + cam.viewW / 2 + 10;
    const y0 = cam.minY - cam.viewHu - 10, y1 = cam.maxY + cam.viewHd + 10;
    const w = Math.ceil((x1 - x0) * k), h = Math.ceil((y1 - y0) * k * TILT);
    if (!art) art = document.createElement('canvas');
    art.width = clamp(w, 1, 8192); art.height = clamp(h, 1, 8192);
    const g = art.getContext('2d');
    renderArt(g, { k, ox: -x0 * k, oy: -y0 * k * TILT }, H, [x0, y0, x1, y1], themeId, { vignette: true });
    artRect = [x0, y0]; artFor = H;
    if (!cam.init) { const [tx, ty] = camTarget(); cam.x = tx; cam.y = ty; cam.init = true; }
    sparkles = [];
    const rnd = CG.rng(77 + H.hi);
    const ws = H.water.slice(); if (H.bridge) ws.push({ t: 'r', x: H.bridge.x0, y: H.bridge.y0, w: H.bridge.x1 - H.bridge.x0, h: H.bridge.y1 - H.bridge.y0 });
    ws.forEach((s2) => { const bb = s2.t === 'e' ? [s2.x - s2.rx, s2.y - s2.ry, s2.rx * 2, s2.ry * 2] : [s2.x, s2.y, s2.w, s2.h]; for (let i = 0; i < bb[2] * bb[3] / 700; i++) { const x = bb[0] + rnd() * bb[2], y = bb[1] + rnd() * bb[3]; if (inShape(s2, x - 6, y) && inShape(s2, x + 6, y)) sparkles.push([x, y, rnd() * TAU, 0.6 + rnd()]); } });
  }
  let sparkles = [];

  // ---------- Flow ----------
  function startCourse(ci, mInfo) {
    CG.closeModal();
    closeSc();
    multi = !!mInfo; multiInfo = mInfo || null;
    P = { ci, hi: 0, card: [], strokes: 0, holeDone: false, total: 0 };
    themeId = COURSES[ci].theme; theme = THEMES[themeId];
    hideMenu();
    state = 'play';
    ghosts.clear();
    T = multi ? syncT() : 0;
    loadHole(0);
  }
  function syncT() { return multiInfo && multiInfo.startAt ? Math.max(0, Math.floor((Date.now() - multiInfo.startAt) / 1000 / DT)) : T; }
  function loadHole(i) {
    P.hi = i; P.strokes = 0; P.holeDone = false;
    H = HOLES[P.ci][i];
    H.bumpers.forEach((b) => { b.hit = 0; });
    ball = newBall(H.tee[0], H.tee[1]);
    lastSpot = { x: H.tee[0], y: H.tee[1] };
    shotQ = null; aim = null; kbAim = null; aimA = Math.atan2(H.cup[1] - H.tee[1], H.cup[0] - H.tee[0]); aimP = 0.5;
    waterT = sunkT = pickT = nextT = 0; sunkAt = null;
    parts.length = 0;
    cam.init = false;
    buildArt();
    popEl.classList.remove('show');
    showBanner();
    updateHud(true);
    if (i === 0 && !hintShown) showHint(true);
    sendState();
  }
  function shoot(a, p) {
    if (!settled(ball.st)) return;
    P.strokes++;
    lastSpot = { x: ball.x, y: ball.y };
    applyShot(ball, a, p);
    CG.sfx(p < 0.35 ? 'tick' : 'click');
    const n = Math.round(4 + p * 10);
    for (let i = 0; i < n; i++) { const aa = a + Math.PI + (Math.random() - 0.5) * 1.6, v = 30 + Math.random() * 90 * p; parts.push({ x: ball.x, y: ball.y, z: 1, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, vz: 30 + Math.random() * 50, life: 0.45, max: 0.45, c: Math.random() < 0.5 ? '#ffffff' : shade(theme.felt, 0.35), r: 1.6 }); }
    showHint(false); hintShown = true;
    updateHud();
  }
  function score() { return P ? P.card.reduce((s, st, i) => s + Math.max(0, HOLES[P.ci][i].par + 3 - st) * 100, 0) : 0; }
  function totalStrokes() { return P ? P.card.reduce((s, v) => s + v, 0) + (P.holeDone ? 0 : P.strokes) : 0; }

  function tick() {
    if (state !== 'play' || !P) { T++; return; }
    if (shotQ && T >= shotQ.T) { const q = shotQ; shotQ = null; shoot(q.a, q.p); }
    const st = ball.st;
    if (st === 'roll' || st === 'ride' || st === 'pipe' || st === 'loop') {
      EV.length = 0;
      physStep(ball, H, T, EV);
      if (EV.length) handleEvents();
      if (st !== 'rest' && ball.st === 'rest' && st === 'roll') onRest();
      if (st === 'roll' && ball.st === 'ride') onRest();
    }
    T++;
  }
  function handleEvents() {
    for (const e of EV) {
      const k = e[0];
      if (k === 'wall' || k === 'post') { if (e[1] > 110 && wallSnd <= 0) { CG.sfx('tick'); wallSnd = 0.07; } }
      else if (k === 'bump') { CG.sfx('flip'); const b = H.bumpers[e[2]]; if (b) b.hit = 1; for (let i = 0; i < 6; i++) { const aa = Math.random() * TAU; parts.push({ x: ball.x, y: ball.y, z: 6, vx: Math.cos(aa) * 80, vy: Math.sin(aa) * 80, vz: 40, life: 0.4, max: 0.4, c: theme.bumper2, r: 2 }); } }
      else if (k === 'sunk') onSunk();
      else if (k === 'water') onWater();
      else if (k === 'lip') { if (Math.hypot(ball.vx, ball.vy) > 120) { popText('Lip out!', 'small'); CG.sfx('wrong'); } }
      else if (k === 'pipeIn') { CG.sfx('whoosh'); pipeT = 0; }
      else if (k === 'pipeOut') { CG.sfx('flip'); puff(ball.x, ball.y, theme.tube2, 8); }
      else if (k === 'loop') CG.sfx('whoosh');
      else if (k === 'loopOut') CG.sfx('point');
      else if (k === 'loopFail') { CG.sfx('wrong'); popText('Faster for the loop!', 'small'); }
    }
  }
  function puff(x, y, c, n) { for (let i = 0; i < n; i++) { const aa = Math.random() * TAU, v = 30 + Math.random() * 70; parts.push({ x, y, z: 3, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, vz: 40 + Math.random() * 40, life: 0.5, max: 0.5, c, r: 2 }); } }
  function onRest() {
    if (inSand(H, ball.x, ball.y)) puff(ball.x, ball.y, theme.sand2, 6);
    if (P.strokes >= MAXS) pickUp();
    sendState();
  }
  function onWater() {
    P.strokes++;
    CG.sfx('drop'); setTimeout(() => CG.sfx('wrong'), 220);
    for (let i = 0; i < 16; i++) { const aa = Math.random() * TAU, v = 20 + Math.random() * 70; parts.push({ x: ball.x, y: ball.y, z: 2, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, vz: 60 + Math.random() * 90, life: 0.7, max: 0.7, c: Math.random() < 0.5 ? '#e0f7ff' : theme.water, r: 2.2 }); }
    parts.push({ ring: 1, x: ball.x, y: ball.y, life: 0.8, max: 0.8 }); parts.push({ ring: 1, x: ball.x, y: ball.y, life: 1.1, max: 1.1 });
    popText('Splash! +1', 'warn');
    waterT = 0.85;
    updateHud();
  }
  function respawn() {
    let x = lastSpot.x, y = lastSpot.y;
    const br = H.bridge;
    if (br && y > br.y0 - 2 && y < br.y1 + 2 && x > br.x0 && x < br.x1) { y = br.y1 + 16; x = clamp(x, br.x0 + 16, br.x1 - 16); }
    if (inWater(H, x, y, T)) { x = H.tee[0]; y = H.tee[1]; }
    ball = newBall(x, y);
    puff(x, y, '#ffffff', 6);
    if (P.strokes >= MAXS) pickUp(); else sendState();
  }
  function pickUp() {
    P.holeDone = true;
    P.card[P.hi] = 7;
    popText('Picked up', 'warn', 'No points this hole');
    CG.sfx('wrong');
    pickT = 1.8;
    updateHud();
    sendState();
  }
  function onSunk() {
    P.holeDone = true;
    const st = P.strokes, par = H.par, d = st - par;
    P.card[P.hi] = st;
    const pts = Math.max(0, par + 3 - st) * 100;
    const name = st === 1 ? 'Hole in one!' : d <= -2 ? 'Eagle!' : d === -1 ? 'Birdie!' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : `${st} strokes`;
    sunkT = 0; sunkAt = { x: ball.x, y: ball.y };
    CG.sfx('drop');
    setTimeout(() => CG.sfx(st === 1 ? 'win' : d <= 0 ? 'match' : 'score'), 260);
    popText(name, st === 1 || d < 0 ? 'gold' : d === 0 ? 'good' : '', pts ? `+${fmt(pts)} points` : 'No points this time');
    for (let i = 0; i < 14; i++) { const aa = Math.random() * TAU, v = 30 + Math.random() * 60; parts.push({ star: 1, x: H.cup[0], y: H.cup[1], z: 4, vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, vz: 80 + Math.random() * 80, life: 0.9, max: 0.9, c: ['#fde047', '#ffffff', '#f472b6'][i % 3], r: 2.4 }); }
    if (st === 1 || d < 0) makeConfetti(st === 1 ? 140 : 70);
    nextT = 2.1;
    updateHud();
    sendState();
  }
  function nextHole() {
    if (P.hi + 1 < HOLES[P.ci].length) { loadHole(P.hi + 1); return; }
    finishCourse();
  }
  function finishCourse() {
    state = 'done';
    const sc = score();
    sendState(true);
    openSc(true);
    setTimeout(() => {
      if (multi) CG.gameOver({ score: sc });
      else CG.gameOver({ score: sc, title: `${COURSES[P.ci].name} complete!`, again: () => startCourse(P.ci) });
      finalShown = true;
    }, 1400);
  }
  let finalShown = false;
  function toMenu() {
    multi = false; multiInfo = null; state = 'menu'; finalShown = false;
    closeSc(); ghosts.clear();
    P = null;
    showMenu();
    demoHole();
  }
  function demoHole() {
    const ci = menuCourse;
    themeId = COURSES[ci].theme; theme = THEMES[themeId];
    H = HOLES[ci][ci === 0 ? 4 : 5];
    ball = newBall(H.tee[0], H.tee[1]);
    cam.init = false;
    buildArt();
    updateHud(true);
  }

  // ---------- Multiplayer ----------
  let lastSend = 0;
  function sendState(final) {
    if (!multi || !P) return;
    const vis = ball.st === 'pipe' || ball.st === 'sunk' || ball.st === 'water' || P.holeDone ? 1 : 0;
    CG.race.update({
      score: score(), alive: !final, hole: P.hi + 1, x: Math.round(ball.x), y: Math.round(ball.y), vx: Math.round(ball.vx), vy: Math.round(ball.vy),
      strokes: P.strokes, total: totalStrokes(), card: P.card.join(''), h: vis
    });
    lastSend = performance.now();
  }
  function updateGhosts(dt) {
    if (!multi) return;
    const list = CG.race.others();
    const seen = new Set();
    list.forEach((o) => {
      const s = o.state || {};
      seen.add(o.name);
      let gh = ghosts.get(o.name);
      if (!gh) { gh = { name: o.name, color: o.color, x: s.x || 0, y: s.y || 0, px: s.x || 0, py: s.y || 0, vx: 0, vy: 0, key: '', a: 0 }; ghosts.set(o.name, gh); }
      gh.color = o.color; gh.st = s;
      const key = `${s.hole}|${s.x}|${s.y}|${s.vx}|${s.vy}|${s.h}`;
      if (key !== gh.key) {
        const jump = gh.hole !== s.hole;
        gh.key = key; gh.hole = s.hole;
        // Predict where it is now (the state is up to a few hundred ms old).
        let x = s.x || 0, y = s.y || 0, vx = s.vx || 0, vy = s.vy || 0;
        const age = clamp((o.age || 0) / 1000, 0, 0.5);
        for (let t = 0; t < age; t += 1 / 60) { const sp = Math.hypot(vx, vy); if (sp < 1) break; const ns = Math.max(0, sp - (MU + KD * sp) / 60); vx *= ns / sp; vy *= ns / sp; x += vx / 60; y += vy / 60; }
        gh.px = x; gh.py = y; gh.vx = vx; gh.vy = vy;
        if (jump) { gh.x = x; gh.y = y; }
      } else {
        const sp = Math.hypot(gh.vx, gh.vy);
        if (sp > 1) { const ns = Math.max(0, sp - (MU + KD * sp) * dt); gh.vx *= ns / sp; gh.vy *= ns / sp; gh.px += gh.vx * dt; gh.py += gh.vy * dt; }
      }
      const k = Math.min(1, dt * 10);
      gh.x += (gh.px - gh.x) * k; gh.y += (gh.py - gh.y) * k;
      const want = P && s.hole === P.hi + 1 && !s.h && s.alive !== false && !s.done ? 1 : 0;
      gh.a += (want - gh.a) * Math.min(1, dt * 6);
    });
    for (const n of ghosts.keys()) if (!seen.has(n)) ghosts.delete(n);
  }

  // ---------- Rendering ----------
  let time = 0;
  function render(dt) {
    const g = ctx;
    if (!H) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#93d36a'; g.fillRect(0, 0, cvs.width, cvs.height); return; }
    if (artFor !== H) buildArt();
    const [tx, ty] = camTarget();
    const k = Math.min(1, dt * 4);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    if (Math.abs(tx - cam.x) < 0.05) cam.x = tx;
    if (Math.abs(ty - cam.y) < 0.05) cam.y = ty;
    const V = view();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = theme.bg; g.fillRect(0, 0, cvs.width, cvs.height);
    g.drawImage(art, Math.round(V.ox + artRect[0] * V.k), Math.round(V.oy + artRect[1] * V.k * TILT));
    groundT(g, V);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // Water sparkles.
    sparkles.forEach(([x, y, ph, sp]) => { const a = Math.sin(time * 2 * sp + ph); if (a > 0.55) { g.strokeStyle = `rgba(255,255,255,${(a - 0.55) * 1.8})`; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + 4, y); g.stroke(); } });
    // Belts.
    H.conv.forEach((c) => {
      g.save(); rr(g, c.x, c.y, c.w, c.h, 4); g.fillStyle = '#334155'; g.fill(); g.clip();
      const off = (T * DT * c.v) % 28;
      g.fillStyle = 'rgba(250,204,21,.85)';
      for (let x = c.x - 28 + (c.dx > 0 ? off : -off + 28); x < c.x + c.w + 28; x += 28) {
        const X = c.dx > 0 ? x : x;
        g.beginPath(); const d = c.dx > 0 ? 1 : -1;
        g.moveTo(X, c.y + 6); g.lineTo(X + 8 * d, c.y + c.h / 2); g.lineTo(X, c.y + c.h - 6); g.lineTo(X + 7 * d, c.y + c.h - 6); g.lineTo(X + 15 * d, c.y + c.h / 2); g.lineTo(X + 7 * d, c.y + 6); g.closePath(); g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(c.x, c.y, c.w, 4);
      g.restore();
    });
    // Bridges.
    if (H.bridge) drawBridge(g, V);
    // Bumpers.
    H.bumpers.forEach((b) => {
      b.hit = Math.max(0, b.hit - dt * 4);
      const sq = 1 + b.hit * 0.18;
      ell(g, b.x + 3, b.y + 5, b.r + 1, b.r + 1, 'rgba(0,0,0,.2)');
      for (let z = 0; z <= 12; z += 2) ell(g, b.x, b.y - z / TILT, b.r * sq, b.r * sq, shade(theme.bumper, -0.25));
      ell(g, b.x, b.y - 12 / TILT, b.r * sq, b.r * sq, b.hit > 0.2 ? '#fff' : theme.bumper);
      ell(g, b.x, b.y - 12 / TILT, b.r * 0.62 * sq, b.r * 0.62 * sq, theme.bumper2);
      ell(g, b.x - b.r * 0.2, b.y - 12 / TILT - b.r * 0.25, b.r * 0.25, b.r * 0.18, 'rgba(255,255,255,.7)');
    });
    // The ball in a pipe shows as a bump travelling along the hose.
    if (ball.st === 'pipe') {
      const p = H.pipes[ball.pi], c = pipeCtrl(p), t = 1 - ball.t / Math.max(1, ball.t0), q = quadAt(p.ax, p.ay, c[0], c[1], p.bx, p.by, t);
      ell(g, q[0], q[1] - 9, 9.5, 9.5, theme.tube2); ell(g, q[0] - 2, q[1] - 12, 3.5, 3, 'rgba(255,255,255,.6)');
    }
    // Ghost balls of the others on this hole.
    ghosts.forEach((gh) => { if (gh.a > 0.02) drawGhost(g, V, gh); });
    // Splash rings and ground particles.
    parts.forEach((p) => { if (p.ring) { const t = 1 - p.life / p.max; g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - t)})`; g.lineWidth = 2; g.beginPath(); g.ellipse(p.x, p.y, 4 + t * 22, 4 + t * 22, 0, 0, TAU); g.stroke(); } });
    // Aim line (under the ball).
    if (state === 'play' && settled(ball.st) && (aim || kbAim) && aimP > 0.04) drawAim(g, V);
    // Depth-sorted things: the ball, the windmill, the loop, the flag.
    const mill = H.mill, loop = H.loop;
    const ballY = ball.y;
    const behindMill = mill && ballY < mill.y1 + 4;
    const items = [];
    if (mill) items.push([mill.y1, () => drawMill(g, V, behindMill && ballY < mill.y0 + 6 ? 0.5 : 1)]);
    if (loop) items.push([loop.y + 2, () => drawLoop(g, V)]);
    items.push([H.cup[1] + 0.5, () => drawFlag(g, V)]);
    if (ball.st !== 'loop') items.push([ballY, () => drawBall(g, V)]);
    items.sort((a, b) => a[0] - b[0]);
    items.forEach((it) => it[1]());
    // Particles in the air.
    parts.forEach((p) => {
      if (p.ring) return;
      const a = clamp(p.life / p.max, 0, 1);
      upT(g, V, p.x, p.y, p.z);
      g.globalAlpha = a;
      if (p.star) { g.fillStyle = p.c; g.beginPath(); for (let i = 0; i < 8; i++) { const an = i * Math.PI / 4, d = i % 2 ? p.r * 0.45 : p.r * 1.6; g.lineTo(Math.cos(an) * d, Math.sin(an) * d); } g.closePath(); g.fill(); }
      else disc(g, 0, 0, p.r, p.c);
      g.globalAlpha = 1;
    });
    // Confetti over everything (screen space).
    if (confetti.length) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      confetti.forEach((c) => { g.save(); g.translate(c.x, c.y); g.rotate(c.r); g.scale(1, Math.cos(c.f)); g.fillStyle = c.c; g.fillRect(-4, -2.5, 8, 5); g.restore(); });
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawBall(g, V) {
    if (ball.st === 'pipe' || waterT > 0 && ball.st === 'water') return;
    let x = ball.x, y = ball.y, z = BR, sc = 1, a = 1;
    if (ball.st === 'loop') {
      [x, y, z] = loopPt(H.loop, ball.lt);
    }
    if (ball.st === 'sunk') {
      const t = clamp(sunkT / 0.35, 0, 1);
      x = lerp(sunkAt.x, H.cup[0], t); y = lerp(sunkAt.y, H.cup[1], t);
      z = BR * (1 - t * 1.6); sc = 1 - t * 0.35; a = 1 - clamp((sunkT - 0.25) / 0.3, 0, 1);
      if (a <= 0) return;
    }
    groundT(g, V);
    if (ball.st !== 'sunk') ell(g, x + 2.5, y + 3, BR * 1.05, BR * 0.95, 'rgba(0,0,0,.25)');
    if (state === 'play' && canShoot() && !aim) {
      const p = (Math.sin(time * 4) + 1) / 2;
      g.strokeStyle = `rgba(255,255,255,${0.35 + p * 0.35})`; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, y, BR + 6 + p * 4, BR + 6 + p * 4, 0, 0, TAU); g.stroke();
    }
    upT(g, V, x, y, z, sc);
    g.globalAlpha = a;
    const gr = g.createRadialGradient(-BR * 0.35, -BR * 0.4, 0.5, 0, 0, BR * 1.05);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#f1f5f9'); gr.addColorStop(1, '#b6c2cf');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, BR, 0, TAU); g.fill();
    if (multi && multiInfo) { g.strokeStyle = multiInfo.myColor || '#22c55e'; g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, BR - 0.6, 0, TAU); g.stroke(); }
    disc(g, -BR * 0.35, -BR * 0.4, 1.5, 'rgba(255,255,255,.95)');
    g.globalAlpha = 1;
  }
  function drawGhost(g, V, gh) {
    const x = gh.x, y = gh.y;
    groundT(g, V);
    g.globalAlpha = gh.a;
    ell(g, x + 2.5, y + 3, BR, BR * 0.9, 'rgba(0,0,0,.14)');
    upT(g, V, x, y, BR);
    g.globalAlpha = 0.62 * gh.a;
    disc(g, 0, 0, BR, gh.color);
    g.globalAlpha = 0.9 * gh.a;
    g.strokeStyle = '#fff'; g.lineWidth = 1.4; g.beginPath(); g.arc(0, 0, BR, 0, TAU); g.stroke();
    disc(g, -2, -2.4, 1.4, 'rgba(255,255,255,.9)');
    // Name tag.
    const [sx, sy] = toScreen(x, y, BR * 2 + 6);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = `700 11px ${FONT}`;
    const w = g.measureText(gh.name).width + 12;
    g.globalAlpha = 0.88 * gh.a;
    g.fillStyle = gh.color; rr(g, sx - w / 2, sy - 18, w, 16, 8); g.fill();
    g.beginPath(); g.moveTo(sx - 4, sy - 2.5); g.lineTo(sx + 4, sy - 2.5); g.lineTo(sx, sy + 2); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(gh.name, sx, sy - 9.5);
    g.globalAlpha = 1;
  }
  function drawFlag(g, V) {
    const [cx, cy] = H.cup;
    const near = Math.hypot(ball.x - cx, ball.y - cy);
    const a = ball.st === 'sunk' ? 0.25 : clamp((near - 30) / 70, 0.28, 1);
    upT(g, V, cx, cy, 0);
    g.globalAlpha = a;
    ell(g, 0, 0, 3, 1.4, 'rgba(0,0,0,.25)');
    g.fillStyle = '#f8fafc'; g.fillRect(-1.3, -72, 2.6, 72);
    g.fillStyle = '#94a3b8'; g.fillRect(0.4, -72, 0.9, 72);
    const w = time * 5;
    g.fillStyle = theme.flag;
    g.beginPath(); g.moveTo(1, -72);
    for (let i = 0; i <= 8; i++) { const t = i / 8; g.lineTo(1 + t * 28, -72 + Math.sin(w - t * 3) * 2.4 * t + t * 2); }
    for (let i = 8; i >= 0; i--) { const t = i / 8; g.lineTo(1 + t * 28, -55 + Math.sin(w - t * 3) * 2.4 * t - t * 2); }
    g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = `800 11px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(H.hi + 1), 13, -63 + Math.sin(w - 1.4) * 1.2);
    disc(g, 0, -73, 2.4, '#facc15');
    g.globalAlpha = 1;
  }
  function drawMill(g, V, alpha) {
    const m = H.mill, w = m.hw * 2 + m.side * 2 + 30, dep = (m.y1 - m.y0) * TILT, fh = 78;
    const garden = themeId === 'garden';
    upT(g, V, m.x, m.y1, 0);
    g.globalAlpha = alpha;
    // Shadow, walls, roof.
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(10, 0, w * 0.6, 12, 0, 0, TAU); g.fill();
    const wallC = garden ? '#fff7ed' : '#d6d3d1', wallS = garden ? '#f1dfc3' : '#a8a29e', roofC = garden ? '#ef4444' : '#78350f', roofS = garden ? '#b91c1c' : '#5b2a0b';
    g.fillStyle = wallS; g.beginPath(); g.moveTo(-w / 2, -fh); g.lineTo(-w / 2 + 6, -fh - dep); g.lineTo(w / 2 - 6, -fh - dep); g.lineTo(w / 2, -fh); g.closePath(); g.fill();
    g.fillStyle = wallC; g.fillRect(-w / 2, -fh, w, fh);
    if (!garden) { g.strokeStyle = 'rgba(87,83,78,.35)'; g.lineWidth = 1; for (let yy = -fh + 9; yy < 0; yy += 9) { g.beginPath(); g.moveTo(-w / 2, yy); g.lineTo(w / 2, yy); g.stroke(); for (let xx = -w / 2 + ((yy / 9) % 2 ? 7 : 0); xx < w / 2; xx += 14) { g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, yy + 9); g.stroke(); } } }
    else { g.fillStyle = 'rgba(214,180,140,.4)'; g.fillRect(-w / 2, -8, w, 8); }
    g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(w / 2 - 10, -fh, 10, fh);
    // Tunnel arch.
    const aw = m.hw * 2 + 4;
    g.fillStyle = '#1f2937'; g.beginPath(); g.moveTo(-aw / 2, 0); g.lineTo(-aw / 2, -14); g.arc(0, -14, aw / 2, Math.PI, 0); g.lineTo(aw / 2, 0); g.closePath(); g.fill();
    g.strokeStyle = garden ? '#c2410c' : '#57534e'; g.lineWidth = 3; g.beginPath(); g.moveTo(-aw / 2 - 1.5, 0); g.lineTo(-aw / 2 - 1.5, -14); g.arc(0, -14, aw / 2 + 1.5, Math.PI, 0); g.lineTo(aw / 2 + 1.5, 0); g.stroke();
    // Windows.
    [-w / 2 + 16, w / 2 - 16].forEach((x) => { g.fillStyle = garden ? '#7dd3fc' : '#1f2937'; rr(g, x - 6, -fh + 14, 12, 14, 5); g.fill(); g.fillStyle = garden ? '#16a34a' : '#78350f'; g.fillRect(x - 9, -fh + 13, 3, 16); g.fillRect(x + 6, -fh + 13, 3, 16); });
    // Roof.
    g.fillStyle = roofS; g.beginPath(); g.moveTo(-w / 2 - 8, -fh); g.lineTo(0, -fh - dep - 40); g.lineTo(w / 2 + 8, -fh); g.closePath(); g.fill();
    g.fillStyle = roofC; g.beginPath(); g.moveTo(-w / 2 - 8, -fh); g.lineTo(0, -fh - dep - 40); g.lineTo(w / 2 + 8, -fh); g.lineTo(w / 2 - 2, -fh + 4); g.lineTo(-w / 2 + 2, -fh + 4); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1.5; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(-w / 2 - 8 + i * (w / 2 + 8) / 4, -fh - (dep + 40) * i / 4); g.lineTo(w / 2 + 8 - i * (w / 2 + 8) / 4, -fh - (dep + 40) * i / 4); g.stroke(); }
    if (!garden) { g.fillStyle = '#78350f'; g.fillRect(-1, -fh - dep - 62, 2, 24); g.fillStyle = '#ef4444'; g.beginPath(); g.moveTo(1, -fh - dep - 62); g.lineTo(16, -fh - dep - 57); g.lineTo(1, -fh - dep - 52); g.closePath(); g.fill(); }
    // Blades.
    const hub = -fh + 10, L = fh - 4;
    const ang = millAngle(m, T + acc / DT);
    g.globalAlpha = Math.min(1, alpha + 0.25);
    for (let i = 0; i < 4; i++) {
      const a = ang + i * Math.PI / 2;
      g.save(); g.translate(0, hub); g.rotate(a);
      g.fillStyle = garden ? '#92400e' : '#57534e'; g.fillRect(0, -2, L, 4);
      g.fillStyle = garden ? 'rgba(255,255,255,.95)' : 'rgba(254,243,199,.95)';
      g.fillRect(16, 2, L - 18, 16);
      g.strokeStyle = garden ? '#b45309' : '#78716c'; g.lineWidth = 1;
      g.strokeRect(16, 2, L - 18, 16);
      for (let xx = 25; xx < L - 2; xx += 9) { g.beginPath(); g.moveTo(xx, 2); g.lineTo(xx, 18); g.stroke(); }
      g.beginPath(); g.moveTo(16, 10); g.lineTo(L - 2, 10); g.stroke();
      g.restore();
    }
    disc(g, 0, hub, 6, garden ? '#92400e' : '#44403c'); disc(g, 0, hub, 2.5, '#fde047');
    g.globalAlpha = 1;
  }
  function drawLoop(g, V) {
    const l = H.loop;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const S = (th, dy) => { const [x, y, z] = loopPt(l, th); return [V.ox + x * V.k, V.oy + (y + dy) * V.k * TILT - (z - BR) * V.k]; };
    const rail = (dy, col, lw, a0, a1) => {
      g.strokeStyle = col; g.lineWidth = lw * V.k; g.beginPath();
      for (let i = 0; i <= 40; i++) { const q = S(a0 + (a1 - a0) * i / 40, dy); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }
      g.stroke();
    };
    g.lineCap = 'round';
    // shadow on the ground
    g.fillStyle = 'rgba(0,0,0,.13)'; g.beginPath(); g.ellipse(V.ox + (l.x + 4) * V.k, V.oy + (l.y - l.len / 2 + 4) * V.k * TILT, LOOP_R * V.k, (l.len / 2 + 8) * V.k * TILT, 0, 0, TAU); g.fill();
    const ring = (col, lw, dy, a0, a1) => { g.strokeStyle = col; g.lineWidth = lw * V.k; g.beginPath(); for (let i = 0; i <= 48; i++) { const q = S(a0 + (a1 - a0) * i / 48, dy); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); } g.stroke(); };
    ring(shade(theme.loop, -0.35), 10, 0, 0, TAU);
    ring(theme.loop, 7, 0, 0, TAU);
    ring(theme.loop2, 2, -2.2, Math.PI * 0.1, Math.PI * 1.9);
    // little stands at the feet
    [[0, 1], [TAU, -1]].forEach(([th]) => { const q = S(th, 0); g.fillStyle = shade(theme.loop, -0.35); g.beginPath(); g.ellipse(q[0], q[1] + 1.5 * V.k, 9 * V.k, 3.5 * V.k, 0, 0, TAU); g.fill(); });
    if (ball.st === 'loop') drawBall(g, V);
  }
  // The loop hoop as seen by the tilted camera (a little skewed sideways so it reads as a loop).
  const loopPt = (l, th) => [l.x + LOOP_R * 0.95 * Math.sin(th), l.y - l.len * th / TAU - 4 * Math.sin(th), LOOP_R * (1 - Math.cos(th)) + BR];
  function drawBridge(g, V) {
    const br = H.bridge;
    groundT(g, V);
    const garden = themeId === 'garden';
    if (br.kind === 'slide') {
      const x = bridgeX(br, T + acc / DT), y = br.y0 - 5, w = br.bw, h = br.y1 - br.y0 + 10;
      g.fillStyle = 'rgba(0,30,60,.25)'; g.fillRect(x - w / 2 + 4, y + 8, w, h);
      g.fillStyle = theme.bridge2; rr(g, x - w / 2 - 3, y, w + 6, h, 4); g.fill();
      g.fillStyle = theme.bridge; g.fillRect(x - w / 2, y + 2, w, h - 4);
      g.strokeStyle = 'rgba(90,55,25,.6)'; g.lineWidth = 1.2;
      for (let yy = y + 9; yy < y + h - 2; yy += 9) { g.beginPath(); g.moveTo(x - w / 2, yy); g.lineTo(x + w / 2, yy); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x - w / 2, y + 2, w, 3);
      if (garden) { [-1, 1].forEach((s) => { disc(g, x + s * (w / 2 + 6), br.y0 + (br.y1 - br.y0) / 2, 7, '#3f9f45'); disc(g, x + s * (w / 2 + 6), br.y0 + (br.y1 - br.y0) / 2, 5, '#5cc25d'); }); }
    } else {
      const ph = bridgePhase(br, T + acc / DT);
      let up = 0;
      if (ph >= br.down) { const t = (ph - br.down) / (1 - br.down); up = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1; }
      const th = up * 1.25, L = br.y1 - br.y0 + 8, x0 = br.cx - br.bw / 2, x1 = br.cx + br.bw / 2;
      const yH = br.y0 - 4, yE = yH + L * Math.cos(th), zE = L * Math.sin(th);
      // posts on the far bank and the chains
      g.setTransform(1, 0, 0, 1, 0, 0);
      const P2 = (x, y, z) => [V.ox + x * V.k, V.oy + y * V.k * TILT - z * V.k];
      const quad = (pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach((p, i) => { const q = P2(p[0], p[1], p[2]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); g.fill(); };
      quad([[x0 + 4, yH + 6, 0], [x1 + 4, yH + 6, 0], [x1 + 4, yE + 6, 0], [x0 + 4, yE + 6, 0]], 'rgba(0,30,60,.22)');
      quad([[x0 - 3, yH, 0], [x1 + 3, yH, 0], [x1 + 3, yE, zE], [x0 - 3, yE, zE]], theme.bridge2);
      quad([[x0, yH, 1], [x1, yH, 1], [x1, yE, zE + 1], [x0, yE, zE + 1]], theme.bridge);
      g.strokeStyle = 'rgba(90,55,25,.6)'; g.lineWidth = 1.2 * V.k;
      for (let t = 0.12; t < 1; t += 0.12) { const y = yH + (yE - yH) * t, z = zE * t + 1, a = P2(x0, y, z), b = P2(x1, y, z); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      [x0 - 6, x1 + 6].forEach((x) => {
        const b = P2(x, yH - 3, 0), t = P2(x, yH - 3, 34);
        g.strokeStyle = theme.wallSide; g.lineWidth = 6 * V.k; g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(t[0], t[1]); g.stroke();
        g.fillStyle = theme.wallTop; g.beginPath(); g.arc(t[0], t[1], 4 * V.k, 0, TAU); g.fill();
        const e = P2(x < br.cx ? x0 : x1, yE, zE + 1);
        g.strokeStyle = '#64748b'; g.lineWidth = 1.4 * V.k; g.setLineDash([3 * V.k, 2 * V.k]); g.beginPath(); g.moveTo(t[0], t[1]); g.lineTo(e[0], e[1]); g.stroke(); g.setLineDash([]);
      });
    }
  }
  function drawAim(g, V) {
    const a = aimA, p = aimP;
    const len = 30 + 250 * p;
    const ux = Math.cos(a), uy = Math.sin(a);
    groundT(g, V);
    const col = p < 0.5 ? '#ffffff' : p < 0.8 ? '#fde047' : '#fb923c';
    for (let d = 14; d < len; d += 11) {
      const t = d / len;
      g.fillStyle = rgba(col === '#ffffff' ? '#ffffff' : col, 0.95 - t * 0.6);
      g.beginPath(); g.ellipse(ball.x + ux * d, ball.y + uy * d, 2.4, 2.4, 0, 0, TAU); g.fill();
    }
    const ex = ball.x + ux * (len + 6), ey = ball.y + uy * (len + 6);
    g.fillStyle = col; g.beginPath(); g.moveTo(ex + ux * 8, ey + uy * 8); g.lineTo(ex - uy * 6, ey + ux * 6); g.lineTo(ex + uy * 6, ey - ux * 6); g.closePath(); g.fill();
    // Rubber band behind the ball.
    const bl = 14 + 60 * p;
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2.5; g.setLineDash([2, 4]);
    g.beginPath(); g.moveTo(ball.x, ball.y); g.lineTo(ball.x - ux * bl, ball.y - uy * bl); g.stroke(); g.setLineDash([]);
    // Power meter next to the ball (screen space).
    const [sx, sy] = toScreen(ball.x, ball.y, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const side = ux > 0.3 ? -1 : 1;
    const mx = clamp(sx + side * 34, 12, Wl - 22), my = clamp(sy - 40, cam.top + 6, Hl - 90), mh = 74;
    g.fillStyle = 'rgba(17,24,39,.55)'; rr(g, mx - 7, my - 4, 14, mh + 8, 7); g.fill();
    const gr = g.createLinearGradient(0, my + mh, 0, my);
    gr.addColorStop(0, '#4ade80'); gr.addColorStop(0.55, '#facc15'); gr.addColorStop(1, '#f97316');
    g.fillStyle = gr; rr(g, mx - 4, my + mh * (1 - p), 8, mh * p, 4); g.fill();
    g.fillStyle = '#fff'; g.font = `800 12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${Math.round(p * 100)}%`, mx, my + mh + 16);
  }
  function makeConfetti(n) {
    const cols = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#fde047'];
    for (let i = 0; i < n; i++) confetti.push({ x: Wl / 2 + (Math.random() - 0.5) * 60, y: Hl * 0.42, vx: (Math.random() - 0.5) * 520, vy: -200 - Math.random() * 420, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 12, f: Math.random() * TAU, vf: 6 + Math.random() * 8, c: cols[i % cols.length], life: 3 });
  }
  function stepFx(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.ring) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= 300 * dt; p.vx *= 0.97; p.vy *= 0.97;
      if (p.z < 0) { p.z = 0; p.vz *= -0.3; }
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.life -= dt; c.vy += 600 * dt; c.vx *= 0.985; c.x += c.vx * dt; c.y += c.vy * dt * 0.6; c.r += c.vr * dt; c.f += c.vf * dt;
      if (c.life <= 0 || c.y > Hl + 20) confetti.splice(i, 1);
    }
  }

  // ---------- UI ----------
  const CSS = `
.mg-wrap{position:absolute;inset:0;overflow:hidden;background:#93d36a;touch-action:none}
.mg-wrap canvas.mg-main{position:absolute;inset:0;display:block}
.mg-hud{position:absolute;left:10px;top:10px;display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100% - 20px);pointer-events:none;z-index:3}
body.cg-multi .mg-hud{max-width:calc(100% - 46vw - 26px)}
body.cg-multi .mg-chip{padding:0 9px;gap:5px}
body.cg-multi .mg-dots{gap:3px}
body.cg-multi .mg-dots i{width:8px;height:8px}
.mg-chip{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:12px;background:rgba(255,255,255,.92);color:#14532d;font:700 15px/1 ${FONT};box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap}
.mg-chip small{font-weight:600;color:#4b7a55;font-size:13px}
.mg-chip .cg-ic{color:#16a34a}
.mg-sep{width:1px;height:16px;background:#cfe3d4;margin:0 2px}
.mg-dots{display:inline-flex;gap:4px}
.mg-dots i{width:9px;height:9px;border-radius:50%;background:#d1e7d6;display:block}
.mg-dots i.on{background:#16a34a}
.mg-dots i.warn{background:#f97316}
.mg-pts b{font-variant-numeric:tabular-nums}
.mg-bottom{position:absolute;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);display:flex;align-items:flex-end;gap:8px;z-index:3;pointer-events:none}
.mg-others{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;align-items:flex-start}
.mg-oth{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:5px 10px;border-radius:10px;background:rgba(17,24,39,.7);color:#fff;font:600 12.5px/1.2 ${FONT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mg-oth i{width:9px;height:9px;border-radius:50%;flex:none}
.mg-oth span{opacity:.8;font-weight:500}
.mg-scbtn{pointer-events:auto;flex:none;display:inline-flex;align-items:center;gap:7px;height:44px;padding:0 14px;border:0;border-radius:14px;background:rgba(255,255,255,.94);color:#14532d;font:700 14px ${FONT};box-shadow:0 2px 10px rgba(0,0,0,.18);cursor:pointer}
.mg-scbtn:active{transform:scale(.96)}
.mg-hint{position:absolute;left:50%;top:calc(var(--hud-h,52px) + 14px);transform:translateX(-50%);z-index:3;display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:14px;background:rgba(17,24,39,.78);color:#fff;font:600 14px ${FONT};pointer-events:none;opacity:0;transition:opacity .3s;white-space:nowrap}
.mg-hint.show{opacity:1}
.mg-hint .cg-ic{animation:mgNudge 1.4s ease-in-out infinite}
@keyframes mgNudge{0%,100%{transform:translateY(-3px)}50%{transform:translateY(5px)}}
.mg-banner{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%) scale(.9);z-index:4;text-align:center;padding:14px 26px 12px;border-radius:20px;background:rgba(255,255,255,.95);color:#14532d;box-shadow:0 10px 30px rgba(0,0,0,.22);pointer-events:none;opacity:0;transition:opacity .35s,transform .35s cubic-bezier(.2,.9,.3,1.3)}
.mg-banner.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
.mg-banner .n{font:800 13px ${FONT};letter-spacing:.12em;text-transform:uppercase;color:#16a34a}
.mg-banner .t{font:800 26px/1.15 ${FONT};margin:3px 0 2px;white-space:nowrap}
.mg-banner .p{font:600 14px ${FONT};color:#4b7a55}
.mg-pop{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%);z-index:4;text-align:center;pointer-events:none;opacity:0}
.mg-pop.show{animation:mgPop 1.9s ease-out forwards}
.mg-pop.small.show{animation:mgPop 1.1s ease-out forwards}
.mg-pop .big{font:800 44px/1 ${FONT};color:#fff;text-shadow:0 3px 0 rgba(0,0,0,.18),0 6px 22px rgba(0,0,0,.35);white-space:nowrap}
.mg-pop.small .big{font-size:26px}
.mg-pop.gold .big{color:#fde047}
.mg-pop.good .big{color:#bbf7d0}
.mg-pop.warn .big{color:#fed7aa}
.mg-pop .sub{margin-top:6px;font:700 16px ${FONT};color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.45)}
@keyframes mgPop{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}12%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}22%{transform:translate(-50%,-50%) scale(1)}78%{opacity:1}100%{opacity:0;transform:translate(-50%,-62%) scale(1)}}
.mg-over{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;padding:16px;background:linear-gradient(180deg,rgba(20,83,45,.18),rgba(20,83,45,.42));overflow:auto}
.mg-over.hide{display:none}
.mg-card{width:100%;max-width:400px;margin:auto;padding:22px 18px 18px;border-radius:26px;background:#fff;color:#14532d;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.3)}
.mg-logo{display:flex;align-items:center;justify-content:center;gap:10px;font:800 34px/1 ${FONT};letter-spacing:.02em;color:#166534}
.mg-logo b{color:#22c55e}
.mg-logo .cg-badge{box-shadow:0 3px 8px rgba(0,0,0,.2)}
.mg-tag{margin:8px 0 16px;font:500 15px/1.4 ${FONT};color:#4b6b55}
.mg-family{width:100%;min-height:58px;display:flex;align-items:center;justify-content:center;gap:10px;border:0;border-radius:18px;background:linear-gradient(135deg,#22c55e,#15803d);color:#fff;font:800 19px ${FONT};box-shadow:0 6px 0 #14532d,0 10px 22px rgba(21,128,61,.35);cursor:pointer;transition:transform .1s}
.mg-family:active{transform:translateY(3px);box-shadow:0 3px 0 #14532d}
.mg-h{margin:22px 0 8px;font:700 12.5px ${FONT};letter-spacing:.1em;text-transform:uppercase;color:#6b8a74}
.mg-courses{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mg-course{display:flex;flex-direction:column;align-items:stretch;gap:2px;padding:6px 6px 9px;border:2px solid #dcfce7;border-radius:18px;background:#f7fdf8;color:#14532d;font:inherit;cursor:pointer;text-align:left;transition:transform .12s,border-color .12s}
.mg-course:hover{border-color:#86efac}
.mg-course:active{transform:scale(.97)}
.mg-course canvas{width:100%;aspect-ratio:4/3;border-radius:12px;display:block;margin-bottom:4px;background:#93d36a}
.mg-course b{font:800 16px ${FONT};padding:0 4px;display:flex;align-items:center;gap:6px}
.mg-course span{font:500 12.5px ${FONT};color:#5f7d68;padding:0 4px}
.mg-how{margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px;font:500 13.5px ${FONT};color:#5f7d68}
.mg-sc{position:absolute;inset:0;z-index:7;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(0,0,0,.35)}
.mg-sc.hide{display:none}
.mg-sc .mg-card{max-width:560px;padding:18px 12px 14px}
.mg-sc h2{margin:0 0 2px;font:800 22px ${FONT}}
.mg-sc .sub{font:500 14px ${FONT};color:#5f7d68;margin-bottom:10px}
.mg-tbl{width:100%;border-collapse:separate;border-spacing:0 3px;font:600 13px ${FONT};font-variant-numeric:tabular-nums}
.mg-tbl th,.mg-tbl td{padding:5px 0;text-align:center;min-width:22px}
.mg-tbl th{color:#6b8a74;font-weight:700;font-size:11.5px}
.mg-tbl td.l,.mg-tbl th.l{text-align:left;padding-left:8px;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-tbl tr.par td{color:#6b8a74;background:#f0fdf4}
.mg-tbl tr.me td{background:#ecfdf5}
.mg-tbl tr td:first-child{border-radius:9px 0 0 9px}
.mg-tbl tr td:last-child{border-radius:0 9px 9px 0}
.mg-tbl .tot{font-weight:800}
.mg-s{display:inline-flex;align-items:center;justify-content:center;width:21px;height:21px;border-radius:50%}
.mg-s.u{background:#fde047;color:#713f12;font-weight:800}
.mg-s.e{background:#bbf7d0;color:#14532d}
.mg-s.o{border-radius:6px;background:#fee2e2;color:#991b1b}
.mg-s.x{border-radius:6px;background:#e5e7eb;color:#6b7280}
.mg-s.cur{outline:2px dashed #22c55e}
.mg-sc .cg-row{margin-top:12px}
.mg-sc button.primary{min-height:46px;padding:0 22px;border:0;border-radius:14px;background:#16a34a;color:#fff;font:700 15px ${FONT};cursor:pointer}
.mg-pickover{position:fixed;inset:0;z-index:9100;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.45)}
.mg-pick{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.mg-pick .mg-course.on{border-color:#22c55e;background:#dcfce7}
@media (max-width:380px){.mg-chip{height:31px;padding:0 10px;font-size:14px}.mg-logo{font-size:29px}.mg-banner .t{font-size:22px}}
@media (prefers-reduced-motion:reduce){.mg-pop.show,.mg-pop.small.show{animation-duration:.01s}.mg-hint .cg-ic{animation:none}}
`;
  let menuEl, scEl, hintEl, bannerEl, popEl, othersEl, menuCourse = 0;
  function buildUi() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const hudEl = document.createElement('div'); hudEl.className = 'mg-hud';
    hudEl.innerHTML = `<div class="mg-chip mg-hole">${CG.icon('flag', 16)}<span>Hole 1</span><small>/9</small><i class="mg-sep"></i><small>Par</small><b class="mg-parv">2</b></div>` +
      `<div class="mg-chip mg-str"><span class="mg-dots">${'<i></i>'.repeat(MAXS)}</span></div><div class="mg-chip mg-pts">${CG.icon('star', 16)}<b>0</b></div>`;
    root.appendChild(hudEl);
    hud.el = hudEl; hud.hole = hudEl.querySelector('.mg-hole span'); hud.of = hudEl.querySelector('.mg-hole small'); hud.par = hudEl.querySelector('.mg-parv');
    hud.dots = [...hudEl.querySelectorAll('.mg-dots i')]; hud.pts = hudEl.querySelector('.mg-pts b');
    const bottom = document.createElement('div'); bottom.className = 'mg-bottom';
    bottom.innerHTML = `<div class="mg-others"></div><button type="button" class="mg-scbtn" aria-label="Scorecard">${CG.icon('grid', 18)}<span>Scorecard</span></button>`;
    root.appendChild(bottom);
    othersEl = bottom.querySelector('.mg-others');
    bottom.querySelector('.mg-scbtn').addEventListener('click', () => { CG.sfx('click'); openSc(false); });
    hud.bottom = bottom;
    hintEl = document.createElement('div'); hintEl.className = 'mg-hint';
    hintEl.innerHTML = `${CG.icon('arrowDown', 18)}<span>${isTouch() ? 'Drag back from the ball, then let go' : 'Drag back from the ball, then let go (or use the arrow keys and Space)'}</span>`;
    root.appendChild(hintEl);
    bannerEl = document.createElement('div'); bannerEl.className = 'mg-banner'; root.appendChild(bannerEl);
    popEl = document.createElement('div'); popEl.className = 'mg-pop'; root.appendChild(popEl);
    // Start screen.
    menuEl = document.createElement('div'); menuEl.className = 'mg-over mg-menu';
    menuEl.innerHTML = `<div class="mg-card"><div class="mg-logo">${CG.badge('golf', 42)}<span>MINI <b>GOLF</b></span></div>` +
      '<p class="mg-tag">18 hand-made holes with windmills, loops, pipes and a pirate cove.</p>' +
      `<button type="button" class="mg-family">${CG.icon('users', 24)}Play with the family</button>` +
      `<div class="mg-h">Practice alone</div><div class="mg-courses">${courseCards()}</div>` +
      `<div class="mg-how">${CG.icon('target', 16)}Drag back from the ball, let go to putt.</div></div>`;
    root.appendChild(menuEl);
    menuEl.querySelector('.mg-family').addEventListener('click', () => { CG.sfx('click'); CG.openLobby(); });
    menuEl.querySelectorAll('.mg-course').forEach((b) => b.addEventListener('click', () => { CG.sfx('click'); menuCourse = +b.dataset.c; startCourse(+b.dataset.c); }));
    menuEl.querySelectorAll('.mg-course canvas').forEach((c, i) => drawThumb(c, i));
    scEl = document.createElement('div'); scEl.className = 'mg-sc hide'; root.appendChild(scEl);
    scEl.addEventListener('click', (e) => { if (e.target === scEl || e.target.closest('[data-x]')) closeSc(); });
  }
  function courseCards(sel) {
    return COURSES.map((c, i) => `<button type="button" class="mg-course${sel === i ? ' on' : ''}" data-c="${i}"><canvas width="320" height="240" aria-hidden="true"></canvas><b>${CG.icon(i ? 'map' : 'flag', 16)}${esc(c.name)}</b><span>9 holes · Par ${coursePar(i)}</span></button>`).join('');
  }
  const thumbCache = [];
  function drawThumb(c, ci) {
    if (!thumbCache[ci]) {
      const t = document.createElement('canvas'); t.width = 320; t.height = 240;
      const Hh = HOLES[ci][ci === 0 ? 4 : 5], [x0, y0, x1, y1] = Hh.bbox;
      const k = Math.min(320 / (x1 - x0 + 40), 240 / ((y1 - y0 + 120) * TILT)) * 1.35;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - 10;
      const V = { k, ox: 160 - cx * k, oy: 120 - cy * k * TILT };
      const g = t.getContext('2d');
      renderArt(g, V, Hh, [cx - 160 / k, cy - 120 / (k * TILT), cx + 160 / k, cy + 120 / (k * TILT)], COURSES[ci].theme);
      const saveH = H, saveT = theme, saveId = themeId, saveB = ball;
      H = Hh; theme = THEMES[COURSES[ci].theme]; themeId = COURSES[ci].theme; ball = newBall(Hh.tee[0], Hh.tee[1] - 140);
      if (Hh.mill) drawMill(g, V, 1);
      drawFlag(g, V);
      upT(g, V, ball.x, ball.y, BR); disc(g, 0, 0, BR, '#fff');
      H = saveH; theme = saveT; themeId = saveId; ball = saveB;
      g.setTransform(1, 0, 0, 1, 0, 0);
      thumbCache[ci] = t;
    }
    c.getContext('2d').drawImage(thumbCache[ci], 0, 0);
  }
  function showMenu() { menuEl.classList.remove('hide'); hud.el.style.display = 'none'; hud.bottom.style.display = 'none'; showHint(false); }
  function hideMenu() { menuEl.classList.add('hide'); hud.el.style.display = ''; hud.bottom.style.display = ''; }
  let hintTimer = null;
  function showHint(on) { clearTimeout(hintTimer); hintEl.classList.toggle('show', !!on); if (on) hintTimer = setTimeout(() => hintEl.classList.remove('show'), 9000); }
  let bannerTimer = null;
  function showBanner() {
    bannerEl.innerHTML = `<div class="n">Hole ${P.hi + 1} of 9 · ${esc(COURSES[P.ci].name)}</div><div class="t">${esc(H.name)}</div><div class="p">Par ${H.par}</div>`;
    bannerEl.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), 1700);
  }
  let popTimer = null;
  function popText(text, cls, sub) {
    popEl.className = 'mg-pop' + (cls ? ' ' + cls : '');
    popEl.innerHTML = `<div class="big">${esc(text)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`;
    void popEl.offsetWidth;
    popEl.classList.add('show');
    clearTimeout(popTimer);
    popTimer = setTimeout(() => popEl.classList.remove('show'), 2000);
  }
  let hudKey = '';
  function updateHud(force) {
    if (!P) return;
    const key = `${P.hi}|${P.strokes}|${score()}|${P.ci}`;
    if (key === hudKey && !force) return;
    hudKey = key;
    hud.hole.textContent = `Hole ${P.hi + 1}`;
    hud.of.textContent = `/${HOLES[P.ci].length}`;
    hud.par.textContent = String(H.par);
    hud.dots.forEach((d, i) => { d.className = i < P.strokes ? (i >= H.par ? 'warn' : 'on') : ''; });
    hud.pts.textContent = fmt(score());
    if (scOpen()) renderSc();
  }
  function updateOthers() {
    if (!multi || !P) { if (othersEl.innerHTML) othersEl.innerHTML = ''; return; }
    const rows = [];
    CG.race.others().forEach((o) => {
      const s = o.state || {};
      if (s.hole === P.hi + 1 && !s.done && s.alive !== false) return;
      const card = String(s.card || '');
      let d = 0; for (let i = 0; i < card.length; i++) d += (+card[i]) - HOLES[P.ci][i].par;
      const rel = d === 0 ? 'Even' : d > 0 ? `+${d}` : String(d);
      const where = s.done || s.alive === false ? 'Finished' : `Hole ${s.hole || 1}`;
      rows.push(`<div class="mg-oth"><i style="background:${o.color}"></i><b>${esc(o.name)}</b><span>${where} · ${card.length ? rel : 'Even'}</span></div>`);
    });
    const html = rows.join('');
    if (html !== othersEl.innerHTML) othersEl.innerHTML = html;
  }
  // Scorecard.
  const scOpen = () => scEl && !scEl.classList.contains('hide');
  let scFinal = false;
  function openSc(final) { if (!P) return; scFinal = final; renderSc(); scEl.classList.remove('hide'); }
  function closeSc() { if (scEl) scEl.classList.add('hide'); }
  function renderSc() {
    if (!P) return;
    const holes = HOLES[P.ci];
    const cell = (st, par, cur) => {
      if (st == null) return cur ? `<span class="mg-s cur">${P.strokes || ''}</span>` : '';
      if (st >= 7) return '<span class="mg-s x">–</span>';
      const c = st < par ? 'u' : st === par ? 'e' : 'o';
      return `<span class="mg-s ${c}">${st}</span>`;
    };
    const rowFor = (name, color, card, cur, mine) => {
      let tot = 0, pts = 0;
      const tds = holes.map((h, i) => { const st = card[i]; if (st != null) { tot += Math.min(st, 7); pts += Math.max(0, h.par + 3 - st) * 100; } return `<td>${cell(st, h.par, mine && i === cur && !P.holeDone && state === 'play')}</td>`; }).join('');
      return `<tr class="${mine ? 'me' : ''}"><td class="l">${color ? `<i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px"></i>` : ''}${esc(name)}</td>${tds}<td class="tot">${tot || ''}</td><td class="tot">${fmt(pts)}</td></tr>`;
    };
    let rows = rowFor(multi ? CG.me() || 'You' : 'You', multi && multiInfo ? multiInfo.myColor : '', P.card, P.hi, true);
    if (multi) CG.race.others().forEach((o) => { const card = String((o.state && o.state.card) || '').split('').map(Number); rows += rowFor(o.name, o.color, card, -1, false); });
    scEl.innerHTML = `<div class="mg-card"><h2>${scFinal ? 'Final scorecard' : 'Scorecard'}</h2><div class="sub">${esc(COURSES[P.ci].name)} · Par ${coursePar(P.ci)}</div>` +
      `<table class="mg-tbl"><thead><tr><th class="l">Hole</th>${holes.map((h, i) => `<th>${i + 1}</th>`).join('')}<th>Tot</th><th>Pts</th></tr></thead><tbody>` +
      `<tr class="par"><td class="l">Par</td>${holes.map((h) => `<td>${h.par}</td>`).join('')}<td class="tot">${coursePar(P.ci)}</td><td></td></tr>${rows}</tbody></table>` +
      (scFinal ? '' : `<div class="cg-row"><button type="button" class="primary" data-x="1">Keep playing</button></div>`) + '</div>';
  }

  // The host picks the course for everyone (our own layer: the frame's results card re-renders while open).
  function pickCourse() {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'mg-pickover';
      back.innerHTML = `<div class="cg-card" role="dialog" aria-modal="true"><div class="cg-hero plain">${CG.badge('golf', 52)}</div><h2>Pick a course</h2><p class="cg-sub">Everyone plays the same 9 holes</p>` +
        `<div class="mg-pick">${courseCards(menuCourse)}</div>` +
        `<div class="cg-row"><button type="button" data-x="1">Cancel</button><button type="button" class="primary" data-go="1">${CG.icon('flag', 18)} Tee off</button></div></div>`;
      document.body.appendChild(back);
      back.querySelectorAll('canvas').forEach((cv, i) => drawThumb(cv, i));
      let pick = menuCourse;
      const finish = (v) => { back.remove(); document.removeEventListener('keydown', onEsc, true); resolve(v); };
      const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
      document.addEventListener('keydown', onEsc, true);
      back.addEventListener('click', (e) => {
        if (e.target === back || e.target.closest('[data-x]')) { finish(null); return; }
        const t = e.target.closest('button[data-c]');
        if (t) { pick = +t.dataset.c; CG.sfx('click'); back.querySelectorAll('.mg-pick .mg-course').forEach((b) => b.classList.toggle('on', b === t)); return; }
        if (e.target.closest('[data-go]')) { menuCourse = pick; finish({ course: pick }); }
      });
      setTimeout(() => { const b = back.querySelector('[data-go]'); if (b) b.focus(); }, 30);
    });
  }

  // ---------- Input ----------
  function maxDrag() { return clamp(Math.min(Wl, Hl) * 0.36, 110, 200); }
  function aimFrom(e) {
    const dx = e.clientX - aim.sx, dy = e.clientY - aim.sy;
    const wx = dx / cam.s, wy = dy / (cam.s * TILT);
    const L = Math.hypot(dx, dy);
    if (L > 3) aimA = Math.atan2(-wy, -wx);
    aimP = clamp(L / maxDrag(), 0, 1);
  }
  function onDown(e) {
    if (state !== 'play') return;
    if (!canShoot()) return;
    if (aim) return;
    aim = { id: e.pointerId, sx: e.clientX, sy: e.clientY };
    aimP = 0; kbAim = null;
    try { cvs.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  }
  function onMove(e) { if (aim && e.pointerId === aim.id) { aimFrom(e); if (!canShoot()) aim = null; } }
  function onUp(e) {
    if (!aim || e.pointerId !== aim.id) return;
    aimFrom(e);
    aim = null;
    if (aimP > 0.05 && canShoot()) shotQ = { a: aimA, p: aimP, T };
  }
  const keys = {};
  function onKey(e, down) {
    if (CG.modalOpen() || document.querySelector('.mg-pickover')) return;
    const k = e.key;
    if (state !== 'play') return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'd', 'w', 's'].includes(k)) e.preventDefault();
    keys[k] = down;
    if (!down) return;
    if ((k === ' ' || k === 'Enter') && canShoot()) {
      if (!kbAim) { kbAim = { on: 1 }; aimP = aimP || 0.5; return; }
      shotQ = { a: aimA, p: Math.max(0.06, aimP), T }; kbAim = null; return;
    }
    if (k === 'Escape') { kbAim = null; if (scOpen()) closeSc(); }
    if (k === 'c' || k === 'C') { if (scOpen()) closeSc(); else openSc(false); }
  }
  function keyAim(dt) {
    if (!canShoot()) return;
    const l = keys.ArrowLeft || keys.a, r = keys.ArrowRight || keys.d, u = keys.ArrowUp || keys.w, d = keys.ArrowDown || keys.s;
    if (l || r || u || d) { if (!kbAim) { kbAim = { on: 1 }; if (!aimP) aimP = 0.5; } }
    if (l) aimA -= dt * 1.6; if (r) aimA += dt * 1.6;
    if (u) aimP = clamp(aimP + dt * 0.6, 0.05, 1); if (d) aimP = clamp(aimP - dt * 0.6, 0.05, 1);
  }

  // ---------- Size ----------
  let lastW = 0, lastH = 0, artTimer = null;
  function resize() {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const nd = Math.min(2, window.devicePixelRatio || 1);
    if (w === lastW && h === lastH && nd === dpr && cvs.width > 1) return;
    lastW = w; lastH = h; Wl = w; Hl = h; dpr = nd;
    cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr);
    cvs.style.width = w + 'px'; cvs.style.height = h + 'px';
    clearTimeout(artTimer);
    if (!art) buildArt(); else artTimer = setTimeout(() => { cam.init = false; buildArt(); }, 90);
    layout();
  }

  // ---------- Main loop ----------
  const perf = { n: 0, sum: 0, max: 0 };
  function frame(now) {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    let dt = last ? (now - last) / 1000 : 0;
    last = now;
    dt = Math.min(dt, 0.1);
    time += dt;
    wallSnd -= dt;
    keyAim(dt);
    if (state === 'play' && P) {
      if (multi && settled(ball.st) && ball.st === 'rest' && !shotQ && multiInfo && multiInfo.startAt) { const tt = syncT(); if (Math.abs(tt - T) > 12) T = tt; }
      acc += dt * timeScale;
      let n = 0;
      const cap = timeScale > 1 ? 400 : 40;
      while (acc >= DT && n < cap) { tick(); acc -= DT; n++; }
      if (n >= cap) acc = 0;
      if (ball.st === 'water' && waterT > 0) { waterT -= dt * timeScale; if (waterT <= 0) respawn(); }
      if (ball.st === 'sunk') sunkT += dt;
      if (nextT > 0) { nextT -= dt * timeScale; if (nextT <= 0) nextHole(); }
      if (pickT > 0) { pickT -= dt * timeScale; if (pickT <= 0) nextHole(); }
      if (multi && performance.now() - lastSend > 120) sendState();
    } else { acc += dt; while (acc >= DT) { T++; acc -= DT; } }
    updateGhosts(dt);
    stepFx(dt);
    render(dt);
    updateHud();
    if (multi) updateOthers();
    if (!multi && state === 'done' && finalShown && !CG.modalOpen() && !CG.isMulti()) toMenu();
    const pd = performance.now() - t0;
    perf.n++; perf.sum += pd; if (pd > perf.max) perf.max = pd;
  }

  function onMultiStart(info) {
    const sh = info.shared && typeof info.shared.course === 'number' ? info.shared.course : null;
    const ci = sh != null && sh >= 0 && sh < COURSES.length ? sh : Math.floor(CG.rng(info.seed)() * COURSES.length);
    const myIndex = (info.players || []).indexOf(info.me || CG.me());
    startCourse(ci, { startAt: info.startAt || Date.now(), players: info.players, myColor: (info.colors || [])[myIndex] || CG.colors[0], round: info.round });
  }

  // ---------- Boot ----------
  CG.mount({
    id: 'golf', title: 'Mini Golf', mode: 'race', scoreLabel: 'points', syncMs: 300,
    help: '<ul><li><b>Putt</b>: put your finger (or mouse) down, drag <b>back</b> away from where you want to go, and let go. The further you pull, the harder the putt. Drag back to the start to cancel.</li>' +
      '<li><b>Keyboard</b>: arrow keys aim and set the power, Space putts. C shows the scorecard.</li>' +
      '<li>Bank off the walls, ride the slopes and belts, time the <b>windmill</b> and the <b>bridges</b>. Pipes take you somewhere new, loops need speed.</li>' +
      '<li>Water costs <b>1 stroke</b> and puts you back where you putted from. Sand slows you right down.</li>' +
      '<li>Too fast and the ball <b>lips out</b> of the cup. After 6 strokes the ball is picked up.</li>' +
      '<li>Points per hole: (par + 3 − strokes) × 100. A hole in one on a par 3 is 500!</li>' +
      '<li><b>Play together</b>: everyone plays the same 9 holes at the same time and sees the others\' balls live.</li></ul>',
    onReady(c) {
      root = document.createElement('div');
      root.className = 'mg-wrap';
      c.root.appendChild(root);
      cvs = document.createElement('canvas');
      cvs.className = 'mg-main';
      cvs.setAttribute('aria-label', 'Mini golf course');
      root.appendChild(cvs);
      ctx = cvs.getContext('2d', { alpha: false });
      buildUi();
      resize();
      demoHole();
      showMenu();
      if (window.ResizeObserver) new ResizeObserver(resize).observe(root);
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 200));
      window.addEventListener('keydown', (e) => onKey(e, true));
      window.addEventListener('keyup', (e) => onKey(e, false));
      window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; aim = null; });
      cvs.addEventListener('pointerdown', onDown);
      cvs.addEventListener('pointermove', onMove);
      cvs.addEventListener('pointerup', onUp);
      cvs.addEventListener('pointercancel', () => { aim = null; });
      root.addEventListener('contextmenu', (e) => e.preventDefault());
      requestAnimationFrame(frame);
      // Test hooks (deterministic replays of shots).
      window.__golf = {
        get state() { return state; }, get T() { return T; }, get ball() { return Object.assign({}, ball); }, get hole() { return P ? P.hi : -1; },
        get course() { return P ? P.ci : -1; }, get strokes() { return P ? P.strokes : 0; }, get card() { return P ? P.card.slice() : []; }, get score() { return score(); },
        get multi() { return multi; }, get ghosts() { return [...ghosts.values()].map((g) => ({ name: g.name, x: g.x, y: g.y, a: g.a, hole: g.hole })); },
        get busy() { return !!(shotQ || !settled(ball.st) || nextT > 0 || pickT > 0 || waterT > 0 || (P && P.holeDone)); },
        set timeScale(v) { timeScale = v; }, get timeScale() { return timeScale; },
        holes: COURSES.map((c, ci) => c.holes.map((h, hi) => ({ name: h.name, par: h.par, tee: h.tee, cup: h.cup, bbox: HOLES[ci][hi].bbox }))),
        startCourse, toMenu, artMs() { const t = performance.now(); cam.init = false; buildArt(); return performance.now() - t; }, jump(hi) { if (P) loadHole(hi); }, perf() { const r = { avg: +(perf.sum / Math.max(1, perf.n)).toFixed(2), max: +perf.max.toFixed(1), n: perf.n }; perf.n = 0; perf.sum = 0; perf.max = 0; return r; },
        // Simulates a putt on the current hole from the current ball, taken at step T0 (>= T).
        sim(a, p, T0) {
          const b = Object.assign({}, ball); let t = T;
          const t0 = T0 == null ? T : T0;
          while (t < t0) { if (b.st === 'ride') physStep(b, H, t, null); t++; }
          if (!settled(b.st)) return { st: b.st, x: b.x, y: b.y };
          return simulate(H, b, t0, a, p);
        },
        // Simulates on any hole from any spot (for the course-completion search).
        simAt(ci, hi, x, y, T0, a, p) { const Hh = HOLES[ci][hi]; const b = newBall(x, y); return simulate(Hh, b, T0, a, p); },
        blocked(ci, hi, x, y) {
          const Hh = HOLES[ci][hi];
          if (inWater(Hh, x, y, 0) && onBridge(Hh, x, y, 0) === 0) return true;
          for (const s of Hh.segs) if (segDist(x, y, s.ax, s.ay, s.bx, s.by) < s.t + BR) return true;
          for (const c of Hh.posts.concat(Hh.bumpers)) if (Math.hypot(x - c.x, y - c.y) < c.r + BR) return true;
          return false;
        },
        timed(ci, hi) { const Hh = HOLES[ci][hi]; return !!(Hh.mill || Hh.bridge); },
        pipes(ci, hi) { return HOLES[ci][hi].pipes.map((p) => [p.ax, p.ay, p.bx, p.by]); },
        loop(ci, hi) { const l = HOLES[ci][hi].loop; return l ? [l.x, l.y, l.len] : null; },
        screenOfBall() { const r = cvs.getBoundingClientRect(), q = toScreen(ball.x, ball.y, BR); return [r.left + q[0], r.top + q[1]]; },
        shootAt(a, p, T0) { if (!canShoot()) return false; shotQ = { a, p, T: T0 }; return true; },
        drawThumb
      };
    },
    roundSetup() { return pickCourse(); }
  });
  CG.on('resume', () => { last = 0; });
  CG.on('multiStart', (info) => onMultiStart(info));
  CG.on('multiEnd', () => toMenu());
})();
