// Picture Puzzle: the built-in pictures, painted in canvas from code (no image files). Every picture has its
// own fixed random seed, so it looks exactly the same on every device (multiplayer races share them by key).
// PuzzlePictures.list = [{ key, name, draw(ctx) }]; draw paints into a 1200 × 900 coordinate space.
(function () {
  'use strict';

  const W = 1200, H = 900, TAU = Math.PI * 2;
  let c = null;      // the canvas context being painted
  let R = Math.random;

  function seeded(seed) {
    let a = seed >>> 0 || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---------- painting helpers ----------
  const rnd = (a, b) => a + R() * (b - a);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  function stops(g, list) { list.forEach((s, i) => (Array.isArray(s) ? g.addColorStop(s[0], s[1]) : g.addColorStop(list.length > 1 ? i / (list.length - 1) : 0, s))); return g; }
  const lin = (x0, y0, x1, y1, list) => stops(c.createLinearGradient(x0, y0, x1, y1), list);
  const rad = (x, y, r, list, x0, y0, r0) => stops(c.createRadialGradient(x0 == null ? x : x0, y0 == null ? y : y0, r0 || 0, x, y, r), list);
  function fill(f) { c.fillStyle = f; c.fill(); }
  function stroke(s, w) { c.strokeStyle = s; c.lineWidth = w; c.stroke(); }
  function circ(x, y, r, f) { c.beginPath(); c.arc(x, y, Math.max(0, r), 0, TAU); fill(f); }
  function ell(x, y, rx, ry, f, rot) { c.beginPath(); c.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot || 0, 0, TAU); fill(f); }
  function rect(x, y, w, h, f) { c.fillStyle = f; c.fillRect(x, y, w, h); }
  function rrPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function rr(x, y, w, h, r, f) { rrPath(x, y, w, h, r); fill(f); }
  function poly(pts, f) { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); fill(f); }
  function line(x0, y0, x1, y1, s, w) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineCap = 'round'; stroke(s, w); }
  function star(x, y, r, f, points, inner, rot) {
    const n = points || 5, ir = r * (inner || 0.45);
    c.beginPath();
    for (let i = 0; i < n * 2; i++) { const a = (rot || -Math.PI / 2) + (i * Math.PI) / n, rr2 = i % 2 ? ir : r; c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); }
    c.closePath(); fill(f);
  }
  function sparkle(x, y, r, f) { star(x, y, r, f, 4, 0.22, 0); }
  // A soft wavy band from y down to the bottom (hills, waves, dunes).
  function wave(y, amp, len, phase, f, bottom) {
    c.beginPath(); c.moveTo(-10, bottom == null ? H + 10 : bottom);
    for (let x = -10; x <= W + 10; x += 10) c.lineTo(x, y + Math.sin(x / len + phase) * amp + Math.sin(x / (len * 0.37) + phase * 2.1) * amp * 0.3);
    c.lineTo(W + 10, bottom == null ? H + 10 : bottom); c.closePath(); fill(f);
  }
  // Jagged mountains between minY and maxY from x = -20 to W + 20.
  function ridge(base, minY, maxY, n, f, snow) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([-20 + ((W + 40) * i) / n + rnd(-0.3, 0.3) * ((W + 40) / n), i % 2 ? rnd(minY, maxY) : rnd((minY + maxY) / 2, maxY)]);
    c.beginPath(); c.moveTo(-20, base);
    pts.forEach(([x, y]) => c.lineTo(x, y));
    c.lineTo(W + 20, base); c.closePath(); fill(f);
    if (snow) pts.forEach(([x, y], i) => { if (i % 2 && y < maxY - (maxY - minY) * 0.35) poly([x, y, x - 34, y + 40, x - 14, y + 34, x, y + 46, x + 14, y + 32, x + 32, y + 40], snow); });
    return pts;
  }
  function cloud(x, y, s, col, shade) {
    const puffs = [[0, 0, 1], [-0.9, 0.25, 0.7], [0.9, 0.2, 0.75], [-0.4, -0.35, 0.75], [0.45, -0.3, 0.7], [1.6, 0.4, 0.45], [-1.6, 0.42, 0.45]];
    if (shade) puffs.forEach(([dx, dy, r]) => circ(x + dx * s, y + dy * s + s * 0.12, r * s, shade));
    puffs.forEach(([dx, dy, r]) => circ(x + dx * s, y + dy * s, r * s, col));
  }
  function bird(x, y, s, col) {
    c.beginPath(); c.moveTo(x - s, y - s * 0.3); c.quadraticCurveTo(x - s * 0.5, y - s * 0.6, x, y); c.quadraticCurveTo(x + s * 0.5, y - s * 0.6, x + s, y - s * 0.3);
    c.lineCap = 'round'; c.lineJoin = 'round'; stroke(col, Math.max(2, s * 0.18));
  }
  function pine(x, y, h, col, snow) {
    const w = h * 0.42;
    rect(x - h * 0.04, y - h * 0.15, h * 0.08, h * 0.17, '#4a2e1a');
    for (let i = 0; i < 3; i++) {
      const ty = y - h * 0.12 - i * h * 0.27, tw = w * (1 - i * 0.24);
      poly([x, ty - h * 0.42, x - tw, ty, x + tw, ty], col);
      if (snow) poly([x, ty - h * 0.42, x - tw * 0.42, ty - h * 0.24, x - tw * 0.15, ty - h * 0.27, x, ty - h * 0.22, x + tw * 0.2, ty - h * 0.27, x + tw * 0.42, ty - h * 0.24], snow);
    }
  }
  function leaf(x, y, l, w, rot, f) { c.save(); c.translate(x, y); c.rotate(rot); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(l * 0.5, -w, l, 0); c.quadraticCurveTo(l * 0.5, w, 0, 0); fill(f); c.restore(); }
  function petals(x, y, r, n, col, pr, rot) {
    for (let i = 0; i < n; i++) { const a = (rot || 0) + (i * TAU) / n; ell(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.55, r * (pr || 0.25), col, a); }
  }
  function text(str, x, y, size, f, weight, align) {
    c.font = `${weight || 800} ${size}px "Trebuchet MS", "Arial Rounded MT Bold", Outfit, sans-serif`;
    c.textAlign = align || 'center'; c.textBaseline = 'middle'; c.fillStyle = f; c.fillText(str, x, y);
  }
  function withClip(pathFn, body) { c.save(); pathFn(); c.clip(); body(); c.restore(); }

  // ---------- the pictures ----------
  const list = [];
  const add = (key, name, draw) => list.push({ key, name, draw });

  add('sunset', 'Sunset Lake', () => {
    const horizon = 560;
    rect(0, 0, W, horizon + 2, lin(0, 0, 0, horizon, [[0, '#24104f'], [0.3, '#6a2389'], [0.58, '#d9417a'], [0.8, '#ff8a3d'], [1, '#ffd36b']]));
    for (let i = 0; i < 90; i++) circ(R() * W, R() * 230, rnd(0.5, 2.1), `rgba(255,255,255,${rnd(0.25, 0.85).toFixed(2)})`);
    circ(600, 500, 330, rad(600, 500, 330, [[0, 'rgba(255,236,160,.95)'], [0.25, 'rgba(255,180,90,.5)'], [1, 'rgba(255,110,90,0)']]));
    circ(600, 500, 112, lin(0, 390, 0, 610, ['#fffbe0', '#ffdc6e', '#ff9a3c']));
    for (let i = 0; i < 9; i++) {
      const y = rnd(140, 470), x = rnd(-50, W + 50), w = rnd(140, 300), h = rnd(9, 20);
      ell(x, y + h * 0.5, w, h, 'rgba(120,30,90,.35)');
      ell(x, y, w, h, y > 360 ? 'rgba(255,190,140,.75)' : 'rgba(255,140,190,.6)');
    }
    for (let i = 0; i < 7; i++) bird(rnd(180, 520) + i * 22, rnd(170, 290), rnd(10, 18), 'rgba(40,12,50,.75)');
    const far = () => ridge(horizon + 4, 390, 490, 14, lin(0, 330, 0, horizon, ['#b05a9a', '#8a3f8c']));
    const mid = () => ridge(horizon + 4, 455, 530, 11, lin(0, 400, 0, horizon, ['#6a2c7c', '#4d1f66']));
    far(); mid();
    // lake + reflections
    rect(0, horizon, W, H - horizon, lin(0, horizon, 0, H, ['#ff9a6a', '#c0508a', '#4a2273', '#1c0d38']));
    withClip(() => { c.beginPath(); c.rect(0, horizon, W, H - horizon); }, () => {
      c.save(); c.globalAlpha = 0.28; c.translate(0, horizon * 2 + 8); c.scale(1, -1); R = seeded(77); far(); mid(); c.restore();
      R = seeded(78);
      for (let y = horizon + 6; y < H; y += 9) {
        const k = (y - horizon) / (H - horizon), w = (230 - k * 120) * rnd(0.5, 1.2);
        rr(600 - w / 2 + rnd(-20, 20), y, w, 3.5, 2, `rgba(255,222,140,${(0.75 - k * 0.55).toFixed(2)})`);
      }
      for (let i = 0; i < 70; i++) { const y = rnd(horizon + 20, H); rr(R() * W, y, rnd(20, 70), 2.2, 1, `rgba(255,190,220,${rnd(0.1, 0.3).toFixed(2)})`); }
    });
    // shores with pines
    poly([0, 600, 160, 585, 330, 610, 420, 640, 0, 660], '#1e0c33');
    poly([W, 590, 1020, 580, 880, 612, 820, 634, W, 650], '#1e0c33');
    for (let i = 0; i < 9; i++) pine(20 + i * 42 + rnd(-8, 8), 612 + i * 3, rnd(90, 150), '#170a29');
    for (let i = 0; i < 8; i++) pine(W - 20 - i * 44 + rnd(-8, 8), 604 + i * 3, rnd(90, 160), '#170a29');
    // little boat
    poly([520, 742, 690, 742, 664, 768, 548, 768], '#1a0b2c');
    line(606, 742, 606, 650, '#1a0b2c', 4);
    poly([610, 655, 610, 736, 668, 736], 'rgba(255,214,170,.9)');
    poly([602, 664, 602, 736, 556, 736], 'rgba(255,160,150,.9)');
    for (let i = 0; i < 4; i++) rr(530 + i * 40, 774 + i * 6, 70, 3, 2, 'rgba(255,220,160,.35)');
    // reeds
    for (let i = 0; i < 46; i++) {
      const x = i < 23 ? rnd(0, 260) : rnd(940, W), h = rnd(70, 190);
      c.beginPath(); c.moveTo(x, H); c.quadraticCurveTo(x + rnd(-14, 14), H - h * 0.6, x + rnd(-24, 24), H - h); c.lineCap = 'round'; stroke('#120722', rnd(3, 6));
      if (R() < 0.35) ell(x + rnd(-8, 8), H - h + 10, 6, 20, '#3a1a2a');
    }
    for (let i = 0; i < 6; i++) sparkle(rnd(80, 1120), rnd(30, 200), rnd(6, 11), 'rgba(255,255,255,.85)');
  });

  add('reef', 'Coral Reef', () => {
    rect(0, 0, W, H, lin(0, 0, 0, H, [[0, '#7ff0f5'], [0.25, '#22bfe0'], [0.65, '#0f6fb1'], [1, '#0a3f7a']]));
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) { const x = rnd(-100, W), w = rnd(40, 110); poly([x, 0, x + w, 0, x + w + 260, H, x + 140, H], 'rgba(255,255,255,.07)'); }
    c.restore();
    // far reef shapes
    for (let i = 0; i < 9; i++) ell(rnd(0, W), rnd(640, 720), rnd(80, 170), rnd(40, 90), 'rgba(10,80,130,.55)');
    wave(760, 16, 70, 1.2, lin(0, 740, 0, H, ['#ffe6a3', '#f2c27a', '#d89c55']));
    for (let i = 0; i < 260; i++) circ(R() * W, rnd(780, H), rnd(1, 3), `rgba(${pick(['160,110,60', '255,255,255', '200,140,80'])},${rnd(0.2, 0.5).toFixed(2)})`);
    // seaweed
    const weed = (x, h, col, w) => {
      c.beginPath(); c.moveTo(x, H - 60); let px = x;
      for (let y = 0; y < h; y += 20) { px = x + Math.sin(y / 38 + x) * 18; c.lineTo(px, H - 60 - y); }
      c.lineCap = 'round'; c.lineJoin = 'round'; stroke(col, w);
    };
    for (let i = 0; i < 14; i++) weed(rnd(0, W), rnd(160, 380), pick(['#21b36b', '#1e8f5a', '#5ad16a', '#13734a']), rnd(9, 16));
    // branching coral
    const branch = (x, y, len, a, w, col, d) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      line(x, y, x2, y2, col, w);
      if (d > 0) { branch(x2, y2, len * 0.78, a - rnd(0.25, 0.55), w * 0.75, col, d - 1); branch(x2, y2, len * 0.78, a + rnd(0.25, 0.55), w * 0.75, col, d - 1); }
      else circ(x2, y2, w * 0.7, col);
    };
    [[150, '#ff6f91'], [470, '#ff9f43'], [880, '#ff5d8f'], [1090, '#c56cf0']].forEach(([x, col]) => branch(x, 820, rnd(70, 95), -Math.PI / 2 + rnd(-0.15, 0.15), 22, col, 4));
    // brain corals
    [[330, 805, 95, '#b46cf0'], [720, 815, 110, '#ffb347'], [1000, 830, 80, '#ff7aa8']].forEach(([x, y, r, col]) => {
      ell(x, y, r, r * 0.62, col);
      ell(x - r * 0.2, y - r * 0.2, r * 0.6, r * 0.3, 'rgba(255,255,255,.25)');
      for (let k = 0; k < 6; k++) { c.beginPath(); c.ellipse(x, y + 6, r * (0.9 - k * 0.14), r * 0.55 * (0.9 - k * 0.14), 0, Math.PI * 1.05, Math.PI * 1.95); stroke('rgba(90,20,80,.35)', 4); }
    });
    // fan corals
    [[610, 790, '#ff4d6d'], [40, 780, '#ffd166']].forEach(([x, y, col]) => {
      for (let k = 0; k < 16; k++) { const a = -Math.PI * 0.95 + (k * Math.PI * 0.9) / 15; line(x, y, x + Math.cos(a) * 130, y + Math.sin(a) * 150, col, 6); }
      c.beginPath(); c.arc(x, y, 120, Math.PI * 1.05, Math.PI * 1.95); stroke(col, 5);
      c.beginPath(); c.arc(x, y, 70, Math.PI * 1.05, Math.PI * 1.95); stroke(col, 5);
    });
    // tube sponges
    for (let k = 0; k < 4; k++) { const x = 780 + k * 34, h = rnd(90, 160); rr(x, 830 - h, 30, h, 15, '#ffd23f'); ell(x + 15, 834 - h, 13, 7, '#c48a00'); }
    // turtle
    const tx = 860, ty = 300;
    ell(tx - 120, ty + 40, 46, 18, '#4caf50', 0.6); ell(tx + 110, ty + 50, 40, 16, '#4caf50', -0.5);
    ell(tx - 100, ty - 50, 60, 20, '#4caf50', -0.5); ell(tx + 100, ty - 52, 56, 18, '#4caf50', 0.5);
    ell(tx + 150, ty - 4, 42, 32, '#66bb6a'); circ(tx + 170, ty - 12, 6, '#123'); circ(tx + 172, ty - 14, 2, '#fff');
    ell(tx, ty, 140, 95, lin(0, ty - 95, 0, ty + 95, ['#8bc34a', '#558b2f']));
    for (let k = 0; k < 7; k++) { const a = (k * TAU) / 7; star(tx + Math.cos(a) * 70, ty + Math.sin(a) * 45, 30, '#6d9c2a', 6, 0.86); }
    star(tx, ty, 38, '#7cad35', 6, 0.86);
    // fish
    const fish = (x, y, s, body, fin, dir, stripes) => {
      c.save(); c.translate(x, y); c.scale(dir * s, s);
      poly([-40, 0, -70, -24, -64, 0, -70, 24], fin);
      ell(0, 0, 48, 28, body);
      poly([-6, -24, 18, -40, 24, -22], fin);
      if (stripes === 'clown') { withClip(() => { c.beginPath(); c.ellipse(0, 0, 48, 28, 0, 0, TAU); }, () => { [-18, 14].forEach((sx) => { rect(sx - 7, -30, 14, 60, '#222'); rect(sx - 5, -30, 10, 60, '#fff'); }); }); }
      if (stripes === 'band') { withClip(() => { c.beginPath(); c.ellipse(0, 0, 48, 28, 0, 0, TAU); }, () => { rect(-48, -4, 96, 8, 'rgba(255,255,255,.5)'); }); }
      if (stripes === 'dots') for (let k = 0; k < 5; k++) circ(rnd(-28, 22), rnd(-12, 12), 4, 'rgba(255,255,255,.6)');
      circ(28, -6, 7, '#fff'); circ(30, -6, 3.5, '#111');
      c.restore();
    };
    const kinds = [['#ff8a1e', '#ff8a1e', 'clown'], ['#2f6bff', '#ffd400', 'band'], ['#ffd400', '#ffb000', ''], ['#ff5fa2', '#c2185b', 'dots'], ['#9c6bff', '#6a3fe0', 'band'], ['#2ee6c8', '#13a58d', 'dots']];
    const spots = [[160, 160], [380, 110], [640, 170], [260, 330], [520, 300], [1080, 120], [140, 520], [430, 520], [690, 470], [1080, 480], [930, 620], [300, 650]];
    spots.forEach(([x, y], i) => { const k = kinds[i % kinds.length]; fish(x + rnd(-20, 20), y + rnd(-20, 20), rnd(0.65, 1.15), k[0], k[1], R() < 0.5 ? 1 : -1, k[2]); });
    // starfish, shells, bubbles
    star(250, 860, 34, '#ff7043', 5, 0.42, -1.2); for (let k = 0; k < 6; k++) circ(250 + rnd(-10, 10), 860 + rnd(-10, 10), 2.5, '#ffd0b0');
    star(940, 875, 26, '#ab47bc', 5, 0.42, -1.4);
    for (let k = 0; k < 4; k++) { const x = rnd(380, 720), y = rnd(860, 885); c.beginPath(); c.arc(x, y, 14, Math.PI, 0); fill('#fff1e0'); for (let j = 0; j < 5; j++) line(x, y, x - 13 + j * 6.5, y - 12, 'rgba(200,140,100,.6)', 2); }
    for (let i = 0; i < 55; i++) { const x = rnd(0, W), y = rnd(0, 720), r = rnd(3, 13); c.beginPath(); c.arc(x, y, r, 0, TAU); stroke('rgba(255,255,255,.6)', 2); circ(x - r * 0.3, y - r * 0.3, r * 0.25, 'rgba(255,255,255,.7)'); }
  });

  add('candy', 'Candy Shop', () => {
    for (let x = 0; x < W; x += 60) rect(x, 0, 60, H, (x / 60) % 2 ? '#ffe3ef' : '#ffd0e4');
    for (let x = 30; x < W; x += 120) for (let y = 260; y < 700; y += 60) circ(x, y, 4, 'rgba(255,255,255,.7)');
    // awning
    for (let i = 0; i < 12; i++) rect(i * 100, 0, 100, 110, i % 2 ? '#ffffff' : '#ff4f86');
    for (let i = 0; i < 12; i++) { c.beginPath(); c.arc(i * 100 + 50, 110, 50, 0, Math.PI); fill(i % 2 ? '#ffffff' : '#ff4f86'); }
    rect(0, 0, W, 16, '#d6336c');
    // sign
    rr(330, 150, 540, 92, 28, '#7b2fa0'); rr(342, 162, 516, 68, 22, '#9b4dca');
    text('SWEET SHOP', 600, 198, 54, '#ffd43b');
    for (let k = 0; k < 8; k++) circ(360 + k * 69, 156, 6, '#ffe066');
    // shelves with jars
    const candyCols = ['#ff3b6b', '#ffb703', '#3bc9db', '#7950f2', '#51cf66', '#ff922b', '#f783ac', '#ffffff', '#4dabf7'];
    const shelf = (y) => { rect(40, y, W - 80, 22, '#b86b35'); rect(40, y, W - 80, 6, '#d98c4f'); rect(40, y + 22, W - 80, 8, 'rgba(0,0,0,.12)'); };
    const jar = (x, y, w, h, mix, lid) => {
      rr(x + w * 0.18, y - h - 24, w * 0.64, 26, 8, lid); rect(x + w * 0.18, y - h - 8, w * 0.64, 6, 'rgba(0,0,0,.15)');
      rr(x, y - h, w, h, 22, 'rgba(255,255,255,.45)');
      withClip(() => rrPath(x + 6, y - h + 6, w - 12, h - 12, 18), () => {
        const fillTop = y - h * rnd(0.72, 0.9);
        for (let yy = y - 10; yy > fillTop; yy -= 15) for (let xx = x + 12; xx < x + w; xx += 17) {
          const col = pick(mix), r = rnd(7, 10), px = xx + rnd(-4, 4), py = yy + rnd(-3, 3);
          circ(px, py, r, col); circ(px - r * 0.35, py - r * 0.35, r * 0.3, 'rgba(255,255,255,.55)');
        }
      });
      rrPath(x, y - h, w, h, 22); stroke('rgba(255,255,255,.9)', 4);
      rr(x + 12, y - h + 14, 12, h * 0.6, 6, 'rgba(255,255,255,.5)');
      rr(x + w * 0.22, y - h * 0.48, w * 0.56, 30, 8, '#fff8e1'); rrPath(x + w * 0.22, y - h * 0.48, w * 0.56, 30, 8); stroke(lid, 3);
    };
    [[440, 0], [650, 1]].forEach(([y, row]) => {
      shelf(y);
      for (let i = 0; i < 6; i++) {
        const w = rnd(118, 140), x = 70 + i * 180 + rnd(-6, 6) + (row ? 40 : 0), h = rnd(150, 180);
        if (x + w > W - 50) continue;
        const mix = [pick(candyCols), pick(candyCols), pick(candyCols)];
        jar(x, y, w, h, mix, pick(['#ff4f86', '#7b2fa0', '#20c997', '#fab005', '#339af0']));
      }
    });
    // counter
    rect(0, 690, W, 210, '#ff8fb1'); rect(0, 690, W, 26, '#ffb3c9'); for (let x = 0; x < W; x += 80) rect(x + 34, 730, 12, 170, 'rgba(255,255,255,.35)');
    rect(0, 716, W, 8, 'rgba(0,0,0,.12)');
    // lollipops
    const lolly = (x, y, r, a, b) => {
      line(x, y, x, y + r * 2.6, '#f8f9fa', 8);
      circ(x, y, r, a);
      c.beginPath(); for (let t = 0; t < 26; t += 0.2) { const rr2 = (t / 26) * r; c.lineTo(x + Math.cos(t) * rr2, y + Math.sin(t) * rr2); } stroke(b, r * 0.16);
      circ(x - r * 0.35, y - r * 0.4, r * 0.18, 'rgba(255,255,255,.6)');
    };
    lolly(120, 560, 52, '#ff3b6b', '#ffffff'); lolly(1085, 545, 58, '#7950f2', '#ffd43b');
    // cupcakes
    const cupcake = (x, y, s, frost, cup) => {
      poly([x - 40 * s, y - 50 * s, x + 40 * s, y - 50 * s, x + 30 * s, y, x - 30 * s, y], cup);
      for (let k = -3; k <= 3; k++) line(x + k * 10 * s, y - 50 * s, x + k * 8 * s, y, 'rgba(0,0,0,.15)', 3 * s);
      circ(x - 26 * s, y - 60 * s, 22 * s, frost); circ(x + 26 * s, y - 60 * s, 22 * s, frost); circ(x, y - 66 * s, 30 * s, frost); circ(x, y - 92 * s, 20 * s, frost); circ(x, y - 108 * s, 12 * s, frost);
      for (let k = 0; k < 10; k++) rr(x + rnd(-36, 30) * s, y + rnd(-96, -50) * s, 10 * s, 4 * s, 2, pick(candyCols));
      circ(x + 4 * s, y - 124 * s, 11 * s, '#e03131'); circ(x + 1 * s, y - 127 * s, 3 * s, 'rgba(255,255,255,.7)');
    };
    cupcake(300, 690, 1, '#fff0f6', '#4dabf7'); cupcake(470, 690, 0.9, '#d0bfff', '#ff922b'); cupcake(780, 690, 1.05, '#ffe066', '#e64980');
    // donut
    ell(620, 670, 70, 34, '#e8a96a'); ell(620, 664, 62, 28, '#ff6fa8'); ell(620, 662, 20, 9, '#ff8fb1');
    for (let k = 0; k < 16; k++) { const a = R() * TAU, d = rnd(30, 52); rr(620 + Math.cos(a) * d, 664 + Math.sin(a) * d * 0.45, 9, 3.5, 2, pick(candyCols)); }
    // candy canes
    [[940, '#e03131'], [990, '#2f9e44']].forEach(([x, col]) => {
      c.lineCap = 'round'; c.beginPath(); c.moveTo(x, 690); c.lineTo(x, 560); c.arc(x + 22, 560, 22, Math.PI, 0); stroke('#fff', 16);
      c.setLineDash([12, 12]); c.beginPath(); c.moveTo(x, 690); c.lineTo(x, 560); c.arc(x + 22, 560, 22, Math.PI, 0); stroke(col, 16); c.setLineDash([]);
    });
    // wrapped sweets on the counter front
    for (let i = 0; i < 9; i++) {
      const x = 80 + i * 130 + rnd(-10, 10), y = rnd(790, 860), col = pick(candyCols);
      poly([x - 44, y - 16, x - 24, y, x - 44, y + 16], col); poly([x + 44, y - 16, x + 24, y, x + 44, y + 16], col);
      ell(x, y, 28, 20, col); ell(x - 8, y - 7, 9, 5, 'rgba(255,255,255,.5)');
    }
  });

  add('space', 'Outer Space', () => {
    rect(0, 0, W, H, rad(600, 450, 800, ['#1b1f5c', '#0b0d2e', '#03030c']));
    c.save(); c.globalCompositeOperation = 'lighter';
    [[300, 250, 360, 'rgba(170,60,255,.35)'], [800, 600, 420, 'rgba(0,180,255,.22)'], [620, 300, 260, 'rgba(255,60,170,.25)'], [1000, 200, 260, 'rgba(60,255,200,.12)']].forEach(([x, y, r, col]) => circ(x, y, r, rad(x, y, r, [col, 'rgba(0,0,0,0)'])));
    c.restore();
    for (let i = 0; i < 520; i++) circ(R() * W, R() * H, Math.pow(R(), 3) * 2.4 + 0.4, `rgba(255,255,${Math.round(rnd(200, 255))},${rnd(0.35, 1).toFixed(2)})`);
    for (let i = 0; i < 16; i++) { const x = R() * W, y = R() * H, r = rnd(8, 18); circ(x, y, r * 1.6, rad(x, y, r * 1.6, ['rgba(255,255,255,.5)', 'rgba(255,255,255,0)'])); sparkle(x, y, r, '#ffffff'); }
    // ringed planet
    const px = 860, py = 290, pr = 150;
    c.save(); c.translate(px, py); c.rotate(-0.35);
    c.beginPath(); c.ellipse(0, 0, pr * 1.9, pr * 0.42, 0, Math.PI, TAU); stroke('rgba(255,214,150,.85)', 22); c.beginPath(); c.ellipse(0, 0, pr * 1.6, pr * 0.32, 0, Math.PI, TAU); stroke('rgba(255,170,110,.6)', 12);
    c.restore();
    withClip(() => { c.beginPath(); c.arc(px, py, pr, 0, TAU); }, () => {
      rect(px - pr, py - pr, pr * 2, pr * 2, '#f2b36b');
      const bands = ['#ffd59e', '#e08d4f', '#f7c58a', '#c96f3b', '#ffe2b8', '#d98a52', '#f2b36b'];
      for (let k = 0; k < 14; k++) { c.save(); c.translate(px, py); c.rotate(-0.35); rect(-pr * 1.2, -pr + k * pr * 0.15, pr * 2.4, pr * rnd(0.06, 0.12), bands[k % bands.length]); c.restore(); }
      circ(px, py, pr, rad(px - pr * 0.45, py - pr * 0.45, pr * 2.1, [[0, 'rgba(255,255,255,.28)'], [0.35, 'rgba(255,255,255,0)'], [0.62, 'rgba(40,10,60,.15)'], [1, 'rgba(40,10,60,.65)']]));
    });
    c.save(); c.translate(px, py); c.rotate(-0.35);
    c.beginPath(); c.ellipse(0, 0, pr * 1.9, pr * 0.42, 0, 0, Math.PI); stroke('rgba(255,214,150,.9)', 22); c.beginPath(); c.ellipse(0, 0, pr * 1.6, pr * 0.32, 0, 0, Math.PI); stroke('rgba(255,170,110,.7)', 12);
    c.restore();
    // earth-like planet
    const ex = 230, ey = 660, er = 120;
    circ(ex, ey, er + 26, rad(ex, ey, er + 26, [[0.8, 'rgba(120,200,255,.5)'], [1, 'rgba(120,200,255,0)']]));
    withClip(() => { c.beginPath(); c.arc(ex, ey, er, 0, TAU); }, () => {
      rect(ex - er, ey - er, er * 2, er * 2, lin(ex - er, ey - er, ex + er, ey + er, ['#4fc3f7', '#1565c0']));
      for (let k = 0; k < 7; k++) { const x = ex + rnd(-90, 90), y = ey + rnd(-90, 90); for (let j = 0; j < 6; j++) circ(x + rnd(-30, 30), y + rnd(-20, 20), rnd(14, 30), j % 2 ? '#43a047' : '#66bb6a'); }
      for (let k = 0; k < 5; k++) ell(ex + rnd(-90, 90), ey + rnd(-100, 100), rnd(30, 60), rnd(6, 10), 'rgba(255,255,255,.75)', rnd(-0.3, 0.3));
      circ(ex, ey, er, rad(ex - er * 0.45, ey - er * 0.45, er * 2.1, [[0, 'rgba(255,255,255,.25)'], [0.35, 'rgba(255,255,255,0)'], [0.62, 'rgba(0,0,40,.15)'], [1, 'rgba(0,0,40,.7)']]));
    });
    // moon
    circ(470, 760, 52, lin(430, 720, 520, 810, ['#f1f3f5', '#adb5bd']));
    [[455, 745, 10], [490, 770, 13], [470, 790, 7], [492, 740, 6]].forEach(([x, y, r]) => { circ(x, y, r, 'rgba(110,120,130,.45)'); circ(x - 2, y - 2, r * 0.7, 'rgba(200,205,210,.6)'); });
    // little red planet
    circ(1070, 720, 54, lin(1030, 680, 1110, 770, ['#ff8a65', '#c62828'])); ell(1060, 705, 18, 8, 'rgba(255,255,255,.25)');
    // comet
    c.save(); c.translate(180, 160); c.rotate(0.45);
    poly([0, -10, -260, -2, -260, 2, 0, 10], lin(0, 0, -260, 0, ['rgba(180,240,255,.9)', 'rgba(180,240,255,0)']));
    circ(0, 0, 13, '#e3fafc'); c.restore();
    // rocket
    c.save(); c.translate(560, 520); c.rotate(0.62);
    poly([-26, 70, 26, 70, 18, 150, -18, 150], 'rgba(0,0,0,0)');
    c.beginPath(); c.moveTo(-22, 80); c.quadraticCurveTo(0, 230, 22, 80); fill(lin(0, 80, 0, 220, ['#fff3bf', '#ffa94d', 'rgba(255,80,40,0)']));
    c.beginPath(); c.moveTo(-12, 80); c.quadraticCurveTo(0, 160, 12, 80); fill('#fffbe6');
    poly([-34, 30, -70, 90, -30, 78], '#e03131'); poly([34, 30, 70, 90, 30, 78], '#e03131');
    c.beginPath(); c.moveTo(0, -110); c.bezierCurveTo(50, -70, 44, 40, 32, 82); c.lineTo(-32, 82); c.bezierCurveTo(-44, 40, -50, -70, 0, -110); fill(lin(-40, 0, 40, 0, ['#ced4da', '#ffffff', '#adb5bd']));
    c.beginPath(); c.moveTo(0, -110); c.bezierCurveTo(26, -90, 34, -66, 37, -48); c.lineTo(-37, -48); c.bezierCurveTo(-34, -66, -26, -90, 0, -110); fill('#e03131');
    circ(0, -6, 20, '#495057'); circ(0, -6, 15, lin(-15, -20, 15, 10, ['#a5d8ff', '#1c7ed6'])); circ(-5, -11, 5, 'rgba(255,255,255,.8)');
    poly([-4, 40, 4, 40, 4, 84, -4, 84], '#e03131');
    c.restore();
    // friendly UFO
    const ux = 420, uy = 210;
    ell(ux, uy - 14, 42, 38, 'rgba(160,255,220,.55)'); ell(ux - 12, uy - 26, 12, 10, 'rgba(255,255,255,.6)');
    ell(ux, uy + 8, 100, 26, lin(0, uy - 20, 0, uy + 30, ['#dee2e6', '#868e96']));
    for (let k = 0; k < 6; k++) circ(ux - 75 + k * 30, uy + 12, 6, pick(['#ffd43b', '#ff6b6b', '#69db7c', '#74c0fc']));
    poly([ux - 34, uy + 30, ux + 34, uy + 30, ux + 80, uy + 150, ux - 80, uy + 150], 'rgba(200,255,200,.12)');
  });

  add('farm', 'Happy Farm', () => {
    rect(0, 0, W, 560, lin(0, 0, 0, 560, ['#5bb8ff', '#a8dcff', '#e3f6ff']));
    circ(1040, 120, 150, rad(1040, 120, 150, ['rgba(255,240,150,.8)', 'rgba(255,240,150,0)']));
    circ(1040, 120, 66, '#ffe066'); circ(1040, 120, 54, '#ffd43b');
    cloud(220, 120, 50, '#fff', 'rgba(150,190,220,.5)'); cloud(620, 90, 38, '#fff', 'rgba(150,190,220,.5)'); cloud(820, 220, 30, '#fff', 'rgba(150,190,220,.5)');
    for (let i = 0; i < 4; i++) bird(rnd(450, 750), rnd(160, 240), 10, '#37474f');
    wave(430, 22, 160, 0.4, '#a5d86e'); wave(480, 26, 120, 2, '#86c75a');
    // field stripes on far hill
    withClip(() => { c.beginPath(); c.rect(620, 470, 600, 120); }, () => { for (let k = 0; k < 12; k++) rect(620 + k * 50, 450, 24, 160, 'rgba(255,230,120,.45)'); });
    wave(560, 18, 200, 1, lin(0, 540, 0, H, ['#6cc04a', '#3d9a35']));
    // trees on hills
    [[90, 480, 50], [700, 455, 36], [770, 470, 30], [1150, 470, 46]].forEach(([x, y, r]) => { rect(x - 7, y, 14, r * 1.3, '#7b4a26'); circ(x, y - r * 0.2, r, '#2e8b3e'); circ(x - r * 0.4, y - r * 0.5, r * 0.6, '#3fa34d'); });
    // barn
    rect(180, 380, 320, 260, '#d93a3a'); for (let x = 190; x < 500; x += 26) rect(x, 380, 3, 260, 'rgba(0,0,0,.12)');
    poly([160, 390, 340, 250, 520, 390], '#7a1f1f'); poly([180, 384, 340, 266, 500, 384], '#a52a2a');
    rect(170, 380, 340, 14, '#f8f9fa');
    rect(280, 500, 120, 140, '#f8f9fa'); rect(290, 510, 100, 130, '#b02525');
    line(290, 510, 390, 640, '#f8f9fa', 10); line(390, 510, 290, 640, '#f8f9fa', 10);
    rect(310, 300, 60, 60, '#f8f9fa'); rect(318, 308, 44, 44, '#5c2c12'); line(318, 308, 362, 352, '#f8f9fa', 5); line(362, 308, 318, 352, '#f8f9fa', 5);
    for (let k = 0; k < 7; k++) line(320 + rnd(0, 40), 352, 316 + rnd(0, 48), 344 + rnd(-6, 6), '#f2c94c', 3);
    // silo
    rect(520, 330, 90, 310, lin(520, 0, 610, 0, ['#adb5bd', '#f1f3f5', '#adb5bd'])); for (let y = 350; y < 640; y += 30) rect(520, y, 90, 3, 'rgba(0,0,0,.12)');
    c.beginPath(); c.arc(565, 330, 45, Math.PI, 0); fill('#868e96');
    // fence
    for (let x = 20; x < W; x += 70) { rr(x, 620, 16, 110, 4, '#f3e3c3'); }
    rect(0, 640, W, 14, '#e9d5a8'); rect(0, 690, W, 14, '#e9d5a8');
    // grass front
    rect(0, 730, W, 170, lin(0, 730, 0, H, ['#55b23a', '#2f8a2c']));
    for (let i = 0; i < 160; i++) { const x = R() * W, y = rnd(740, H); line(x, y, x + rnd(-6, 6), y - rnd(10, 22), pick(['#3c9a33', '#6ccf4b', '#2f7d27']), 3); }
    for (let i = 0; i < 26; i++) { const x = R() * W, y = rnd(750, 890), col = pick(['#fff', '#ffd43b', '#ff8787', '#da77f2']); petals(x, y, 10, 5, col, 0.3); circ(x, y, 3.5, '#f59f00'); }
    // sunflowers by the fence
    [[620, 560], [660, 590], [1120, 570]].forEach(([x, y]) => { line(x, y, x, 720, '#2f9e44', 6); leaf(x, y + 70, 36, 12, -0.5, '#2f9e44'); petals(x, y, 34, 14, '#ffd43b', 0.22); circ(x, y, 14, '#7a4b1a'); });
    // cow
    const cow = (x, y) => {
      rect(x - 70, y + 20, 14, 56, '#f8f9fa'); rect(x - 30, y + 24, 14, 56, '#f1f3f5'); rect(x + 40, y + 20, 14, 56, '#f8f9fa'); rect(x + 70, y + 24, 14, 56, '#f1f3f5');
      rect(x - 70, y + 70, 14, 10, '#343a40'); rect(x - 30, y + 74, 14, 10, '#343a40'); rect(x + 40, y + 70, 14, 10, '#343a40'); rect(x + 70, y + 74, 14, 10, '#343a40');
      line(x - 92, y - 10, x - 112, y + 40, '#f1f3f5', 5); circ(x - 112, y + 44, 7, '#343a40');
      rr(x - 100, y - 50, 200, 100, 46, '#ffffff');
      withClip(() => rrPath(x - 100, y - 50, 200, 100, 46), () => { ell(x - 40, y - 20, 34, 24, '#212529', 0.4); ell(x + 30, y + 26, 30, 20, '#212529', -0.3); ell(x + 70, y - 40, 20, 16, '#212529'); });
      ell(x - 10, y + 50, 22, 12, '#ffa8c5');
      ell(x + 118, y - 50, 48, 40, '#ffffff'); ell(x + 140, y - 30, 34, 24, '#ffc9de'); circ(x + 132, y - 30, 4, '#c2255c'); circ(x + 150, y - 30, 4, '#c2255c');
      circ(x + 104, y - 64, 7, '#212529'); circ(x + 128, y - 66, 7, '#212529'); circ(x + 102, y - 66, 2.5, '#fff'); circ(x + 126, y - 68, 2.5, '#fff');
      ell(x + 84, y - 84, 18, 9, '#f1f3f5', -0.5); ell(x + 154, y - 86, 18, 9, '#f1f3f5', 0.5);
      poly([x + 98, y - 88, x + 92, y - 116, x + 108, y - 90], '#fff3bf'); poly([x + 136, y - 90, x + 146, y - 118, x + 150, y - 88], '#fff3bf');
    };
    cow(820, 660);
    // pig
    const pig = (x, y) => {
      for (const dx of [-40, -14, 18, 42]) rr(x + dx, y + 20, 16, 40, 6, '#f783ac');
      ell(x, y, 74, 50, '#ffa8c5'); ell(x - 18, y - 18, 30, 14, 'rgba(255,255,255,.35)');
      c.beginPath(); c.moveTo(x - 72, y - 6); c.bezierCurveTo(x - 96, y - 26, x - 100, y + 6, x - 84, y + 2); stroke('#f783ac', 5);
      circ(x + 66, y - 14, 38, '#ffa8c5'); ell(x + 96, y - 6, 16, 13, '#f783ac'); circ(x + 92, y - 6, 3.5, '#a61e4d'); circ(x + 101, y - 6, 3.5, '#a61e4d');
      circ(x + 72, y - 28, 5, '#212529'); poly([x + 46, y - 44, x + 50, y - 72, x + 70, y - 50], '#f783ac'); poly([x + 74, y - 50, x + 92, y - 72, x + 94, y - 44], '#f783ac');
    };
    pig(1030, 800);
    // sheep
    const sheep = (x, y) => {
      for (const dx of [-34, -12, 14, 34]) rect(x + dx, y + 20, 10, 40, '#343a40');
      for (let k = 0; k < 12; k++) circ(x + rnd(-50, 50), y + rnd(-26, 20), rnd(22, 30), k % 2 ? '#f8f9fa' : '#e9ecef');
      ell(x - 64, y - 6, 24, 30, '#343a40'); circ(x - 70, y - 12, 4, '#fff'); ell(x - 84, y - 20, 12, 6, '#343a40', 0.5);
      for (let k = 0; k < 4; k++) circ(x - 62 + rnd(-10, 10), y - 34 + rnd(-4, 4), 10, '#f8f9fa');
    };
    sheep(560, 800);
    // chickens
    const hen = (x, y, s) => {
      line(x - 6 * s, y + 20 * s, x - 6 * s, y + 34 * s, '#f59f00', 3); line(x + 6 * s, y + 20 * s, x + 6 * s, y + 34 * s, '#f59f00', 3);
      ell(x, y, 30 * s, 24 * s, '#fff'); poly([x - 26 * s, y - 10 * s, x - 46 * s, y - 26 * s, x - 34 * s, y + 4 * s], '#f1f3f5');
      circ(x + 24 * s, y - 22 * s, 16 * s, '#fff'); poly([x + 38 * s, y - 24 * s, x + 50 * s, y - 20 * s, x + 38 * s, y - 16 * s], '#fab005');
      circ(x + 22 * s, y - 40 * s, 6 * s, '#e03131'); circ(x + 30 * s, y - 38 * s, 6 * s, '#e03131'); circ(x + 28 * s, y - 24 * s, 3 * s, '#212529');
      ell(x - 4 * s, y + 2 * s, 16 * s, 10 * s, '#e9ecef', -0.3);
    };
    hen(250, 820, 1.2); hen(360, 850, 1); hen(130, 860, 0.9);
  });

  add('flowers', 'Flower Meadow', () => {
    rect(0, 0, W, 360, lin(0, 0, 0, 360, ['#8fd3ff', '#cdeeff', '#fff4dc']));
    circ(180, 110, 140, rad(180, 110, 140, ['rgba(255,245,180,.9)', 'rgba(255,245,180,0)'])); circ(180, 110, 50, '#fff3bf');
    cloud(620, 100, 34, '#fff', 'rgba(160,200,230,.5)'); cloud(980, 150, 44, '#fff', 'rgba(160,200,230,.5)');
    for (let x = -20; x < W + 40; x += 46) circ(x, 330 + rnd(-10, 10), rnd(30, 52), pick(['#5aa64a', '#4c9a41', '#69b85a']));
    rect(0, 330, W, H - 330, lin(0, 330, 0, H, ['#8edc6a', '#4fb04a', '#2a7d31']));
    const cols = { tulip: ['#ff4d6d', '#ff8fab', '#ffd60a', '#c77dff', '#ff7b00'], daisy: ['#ffffff', '#fff0f6'], poppy: ['#e5383b', '#ff5d8f'], bell: ['#4361ee', '#7b2cbf', '#4cc9f0'] };
    const flower = (x, y, s) => {
      const kind = pick(['tulip', 'tulip', 'daisy', 'daisy', 'poppy', 'bell', 'sun']);
      const stemH = 70 * s;
      line(x, y, x + 6 * s, y - stemH, '#2b8a3e', Math.max(2, 5 * s));
      leaf(x + 3 * s, y - stemH * 0.4, 30 * s, 9 * s, R() < 0.5 ? -0.7 : -2.4, '#37b24d');
      const fx = x + 6 * s, fy = y - stemH;
      if (kind === 'tulip') { const col = pick(cols.tulip); ell(fx, fy, 15 * s, 19 * s, col); poly([fx - 15 * s, fy - 4 * s, fx - 15 * s, fy - 24 * s, fx - 6 * s, fy - 12 * s, fx, fy - 26 * s, fx + 6 * s, fy - 12 * s, fx + 15 * s, fy - 24 * s, fx + 15 * s, fy - 4 * s], col); ell(fx - 5 * s, fy - 4 * s, 4 * s, 10 * s, 'rgba(255,255,255,.3)'); }
      else if (kind === 'daisy') { petals(fx, fy, 22 * s, 12, pick(cols.daisy), 0.2, R()); circ(fx, fy, 7 * s, '#fcc419'); }
      else if (kind === 'poppy') { petals(fx, fy, 22 * s, 5, pick(cols.poppy), 0.5, R()); circ(fx, fy, 6 * s, '#212529'); }
      else if (kind === 'bell') { const col = pick(cols.bell); for (let k = 0; k < 4; k++) { const by = fy + k * 12 * s; c.beginPath(); c.arc(fx + (k % 2 ? 9 : -9) * s, by, 8 * s, Math.PI, 0); c.lineTo(fx + (k % 2 ? 19 : 1) * s, by + 6 * s); c.lineTo(fx + (k % 2 ? -1 : -19) * s, by + 6 * s); fill(col); } }
      else { petals(fx, fy, 30 * s, 16, '#ffd43b', 0.2, R()); petals(fx, fy, 24 * s, 16, '#fab005', 0.2, R()); circ(fx, fy, 11 * s, '#6f4518'); for (let k = 0; k < 6; k++) circ(fx + rnd(-6, 6) * s, fy + rnd(-6, 6) * s, 1.6 * s, '#3b2410'); }
    };
    for (let row = 0; row < 9; row++) {
      const y = 370 + row * row * 6.4 + row * 6, s = 0.38 + row * 0.16, n = Math.round(30 - row * 2.4);
      for (let i = 0; i < 6 + row * 3; i++) { const x = R() * W; line(x, y + 30 * s, x + rnd(-10, 10) * s, y - rnd(20, 50) * s, pick(['#2f9e44', '#40c057', '#2b8a3e']), Math.max(1.5, 3 * s)); }
      for (let i = 0; i < n; i++) flower(rnd(-20, W + 20), y + rnd(-8, 14) * s + 60 * s, s);
    }
    const butterfly = (x, y, s, a, b) => {
      c.save(); c.translate(x, y); c.rotate(rnd(-0.3, 0.3)); c.scale(s, s);
      ell(-22, -16, 24, 20, a, -0.4); ell(22, -16, 24, 20, a, 0.4); ell(-16, 14, 15, 13, b, 0.4); ell(16, 14, 15, 13, b, -0.4);
      circ(-24, -18, 7, 'rgba(255,255,255,.7)'); circ(24, -18, 7, 'rgba(255,255,255,.7)'); circ(-16, 14, 4, 'rgba(0,0,0,.25)'); circ(16, 14, 4, 'rgba(0,0,0,.25)');
      ell(0, 0, 5, 24, '#212529'); line(0, -22, -10, -40, '#212529', 2); line(0, -22, 10, -40, '#212529', 2);
      c.restore();
    };
    butterfly(420, 260, 1.3, '#ff922b', '#ffd43b'); butterfly(860, 330, 1.1, '#748ffc', '#da77f2'); butterfly(1060, 500, 1.2, '#f06595', '#ffa8a8'); butterfly(240, 470, 0.9, '#3bc9db', '#69db7c');
    const bee = (x, y) => { ell(x - 6, y - 14, 10, 14, 'rgba(255,255,255,.8)', -0.5); ell(x + 6, y - 14, 10, 14, 'rgba(255,255,255,.8)', 0.5); ell(x, y, 20, 13, '#fcc419'); rect(x - 6, y - 12, 5, 24, '#212529'); rect(x + 5, y - 12, 5, 24, '#212529'); circ(x + 17, y - 3, 3, '#212529'); };
    bee(660, 230); bee(330, 360); bee(980, 260);
  });

  add('city', 'City Lights', () => {
    rect(0, 0, W, 620, lin(0, 0, 0, 620, ['#0a0b2b', '#1e1d5a', '#4a2f86', '#a04c8c']));
    for (let i = 0; i < 180; i++) circ(R() * W, R() * 420, rnd(0.5, 2), `rgba(255,255,255,${rnd(0.3, 0.9).toFixed(2)})`);
    circ(980, 140, 150, rad(980, 140, 150, ['rgba(255,250,220,.55)', 'rgba(255,250,220,0)']));
    circ(980, 140, 64, '#fff9db'); [[960, 120, 12], [1000, 160, 9], [995, 115, 6], [960, 165, 7]].forEach(([x, y, r]) => circ(x, y, r, 'rgba(220,210,170,.7)'));
    const firework = (x, y, r, col) => {
      for (let k = 0; k < 22; k++) { const a = (k * TAU) / 22; line(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25, x + Math.cos(a) * r, y + Math.sin(a) * r, col, 3); circ(x + Math.cos(a) * r * 1.08, y + Math.sin(a) * r * 1.08, 4, '#fff'); }
      circ(x, y, r * 0.5, rad(x, y, r * 0.5, [col, 'rgba(0,0,0,0)']));
    };
    firework(260, 160, 90, '#ff6bd6'); firework(560, 110, 64, '#69f0ae'); firework(420, 260, 50, '#ffd740');
    // back buildings
    let x = -10;
    while (x < W) { const w = rnd(50, 110), h = rnd(160, 330); rect(x, 600 - h, w, h + 2, '#2a2456'); for (let wy = 600 - h + 12; wy < 590; wy += 20) for (let wx = x + 8; wx < x + w - 8; wx += 16) if (R() < 0.3) rect(wx, wy, 7, 9, 'rgba(255,214,120,.45)'); x += w + rnd(-6, 4); }
    // front buildings
    const fronts = [];
    x = -20;
    while (x < W) {
      const w = rnd(80, 150), h = rnd(180, 420), col = pick(['#3b2f6e', '#2d3a6b', '#46306b', '#283b5c', '#3a2a5e']);
      fronts.push([x, w, h]);
      rect(x, 620 - h, w, h, col); rect(x, 620 - h, 6, h, 'rgba(255,255,255,.06)'); rect(x + w - 10, 620 - h, 10, h, 'rgba(0,0,0,.15)');
      const roof = R();
      if (roof < 0.3) { line(x + w / 2, 620 - h, x + w / 2, 620 - h - 60, '#8b8fb8', 4); circ(x + w / 2, 620 - h - 62, 6, '#ff5252'); }
      else if (roof < 0.5) poly([x, 620 - h, x + w / 2, 620 - h - 50, x + w, 620 - h], col);
      else if (roof < 0.65) { rect(x + w * 0.25, 620 - h - 40, w * 0.5, 40, col); }
      const ww = w > 110 ? 12 : 10;
      for (let wy = 620 - h + 18; wy < 600; wy += 26) for (let wx = x + 12; wx < x + w - 14; wx += ww + 10) {
        const lit = R(); rect(wx, wy, ww, 14, lit > 0.45 ? pick(['#ffd56b', '#ffb347', '#ffe8a3', '#bde0ff']) : 'rgba(10,10,40,.55)');
      }
      x += w + rnd(2, 14);
    }
    // river and reflections
    rect(0, 620, W, H - 620, lin(0, 620, 0, H, ['#2b2463', '#161642', '#0a0b24']));
    fronts.forEach(([fx, w, h]) => { for (let y = 630; y < Math.min(H, 630 + h * 0.8); y += 10) if (R() < 0.6) rr(fx + rnd(0, w * 0.8), y, rnd(10, 40), 3, 2, `rgba(255,210,120,${(0.4 - (y - 630) / 900).toFixed(2)})`); });
    for (let y = 630; y < H; y += 12) rr(980 - 40 + rnd(-20, 20), y, rnd(40, 90), 3, 2, 'rgba(255,250,220,.4)');
    // bridge
    rect(0, 680, W, 18, '#1a1840');
    for (let k = 0; k < 4; k++) { const bx = 150 + k * 300; c.beginPath(); c.moveTo(bx - 150, 680); c.quadraticCurveTo(bx, 560, bx + 150, 680); stroke('#5c5aa8', 6); rect(bx - 8, 640, 16, 140, '#1a1840'); }
    for (let k = 0; k < 24; k++) { const lx = 25 + k * 50; circ(lx, 676, 5, '#ffe066'); circ(lx, 676, 14, 'rgba(255,224,102,.25)'); rr(lx - 2, 720 + rnd(0, 20), 4, rnd(30, 60), 2, 'rgba(255,224,102,.25)'); }
    // boat
    poly([700, 800, 880, 800, 860, 830, 720, 830], '#0d0c2a'); rect(740, 780, 90, 20, '#22205a'); for (let k = 0; k < 5; k++) rect(748 + k * 16, 786, 9, 8, '#ffd56b');
  });

  add('balloons', 'Hot-Air Balloons', () => {
    rect(0, 0, W, H, lin(0, 0, 0, H, ['#4fb3ff', '#9fd7ff', '#ffe2c2', '#ffc7a6']));
    circ(1000, 640, 220, rad(1000, 640, 220, ['rgba(255,240,190,.9)', 'rgba(255,220,160,0)'])); circ(1000, 640, 70, '#fff3bf');
    cloud(160, 160, 40, '#fff', 'rgba(150,190,230,.4)'); cloud(700, 240, 30, '#fff', 'rgba(150,190,230,.4)'); cloud(1050, 120, 48, '#fff', 'rgba(150,190,230,.4)'); cloud(420, 520, 26, '#fff', 'rgba(150,190,230,.4)');
    wave(700, 30, 180, 0.3, '#86c06c'); wave(740, 22, 120, 2.4, '#6fb35b');
    withClip(() => wave(740, 22, 120, 2.4, '#6fb35b'), () => {
      for (let k = 0; k < 40; k++) { const fx = rnd(-50, W), fy = rnd(720, 900); poly([fx, fy, fx + rnd(80, 160), fy - rnd(10, 30), fx + rnd(120, 220), fy + rnd(30, 60), fx + rnd(10, 40), fy + rnd(40, 70)], pick(['#9ad35a', '#c5e063', '#f4d35e', '#7cbf4b', '#e9b949', '#5fa64a'])); }
      for (let k = 0; k < 18; k++) { const tx = rnd(0, W), ty = rnd(760, 880); circ(tx, ty, rnd(10, 18), '#2f7d32'); }
    });
    const balloon = (x, y, r, colors, pattern) => {
      const shape = () => { c.beginPath(); c.moveTo(x, y + r * 1.35); c.bezierCurveTo(x - r * 0.35, y + r * 1.05, x - r * 1.05, y + r * 0.55, x - r, y - r * 0.05); c.arc(x, y - r * 0.05, r, Math.PI, 0); c.bezierCurveTo(x + r * 1.05, y + r * 0.55, x + r * 0.35, y + r * 1.05, x, y + r * 1.35); c.closePath(); };
      line(x - r * 0.3, y + r * 1.3, x - r * 0.22, y + r * 1.75, '#5c3d1e', Math.max(1.5, r * 0.025)); line(x + r * 0.3, y + r * 1.3, x + r * 0.22, y + r * 1.75, '#5c3d1e', Math.max(1.5, r * 0.025));
      rr(x - r * 0.25, y + r * 1.72, r * 0.5, r * 0.32, r * 0.06, '#a0522d'); rect(x - r * 0.25, y + r * 1.8, r * 0.5, r * 0.05, '#7a3b17');
      withClip(shape, () => {
        rect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.7, colors[0]);
        const n = 8;
        for (let k = 0; k < n; k++) if (k % 2) {
          const a0 = -1 + (k / n) * 2, a1 = -1 + ((k + 1) / n) * 2;
          c.beginPath(); c.moveTo(x, y - r * 1.05);
          c.bezierCurveTo(x + a0 * r * 1.35, y - r * 0.9, x + a0 * r * 1.3, y + r * 0.6, x, y + r * 1.4);
          c.bezierCurveTo(x + a1 * r * 1.3, y + r * 0.6, x + a1 * r * 1.35, y - r * 0.9, x, y - r * 1.05); fill(colors[1]);
        }
        if (pattern === 'band') { rect(x - r * 1.2, y + r * 0.15, r * 2.4, r * 0.22, colors[2]); for (let k = -6; k <= 6; k++) poly([x + k * r * 0.2, y + r * 0.15, x + (k + 0.5) * r * 0.2, y - r * 0.05, x + (k + 1) * r * 0.2, y + r * 0.15], colors[2]); }
        if (pattern === 'dots') for (let k = 0; k < 7; k++) circ(x + rnd(-0.7, 0.7) * r, y + rnd(-0.6, 0.6) * r, r * 0.09, colors[2]);
        if (pattern === 'top') { c.beginPath(); c.arc(x, y - r * 0.05, r * 1.02, Math.PI, 0); c.lineTo(x + r, y - r * 0.35); c.lineTo(x - r, y - r * 0.35); fill(colors[2]); }
        rect(x - r * 1.2, y + r * 0.9, r * 2.4, r * 0.6, 'rgba(0,0,0,.18)');
        circ(x - r * 0.38, y - r * 0.42, r * 0.7, rad(x - r * 0.38, y - r * 0.42, r * 0.7, ['rgba(255,255,255,.45)', 'rgba(255,255,255,0)']));
        circ(x + r * 0.9, y + r * 0.3, r * 1.1, rad(x + r * 0.9, y + r * 0.3, r * 1.1, ['rgba(0,0,40,.25)', 'rgba(0,0,40,0)']));
      });
    };
    const sets = [
      [['#ff595e', '#ffca3a', '#ffffff'], 'band'], [['#1982c4', '#8ac926', '#ffca3a'], 'top'], [['#6a4c93', '#ff70a6', '#ffffff'], 'dots'],
      [['#ff924c', '#ffd6a5', '#ff595e'], 'band'], [['#00b4d8', '#ffffff', '#ff595e'], 'top'], [['#ffca3a', '#ff595e', '#1982c4'], 'dots'],
      [['#8ac926', '#ffffff', '#6a4c93'], 'band'], [['#f15bb5', '#fee440', '#00bbf9'], 'top']
    ];
    const spots = [[1110, 560, 34], [130, 590, 40], [880, 420, 52], [330, 360, 62], [640, 520, 46], [1020, 210, 82], [560, 170, 98], [200, 120, 70]];
    spots.forEach(([bx, by, br], i) => balloon(bx, by, br, sets[i][0], sets[i][1]));
    for (let k = 0; k < 6; k++) bird(rnd(700, 1100), rnd(320, 420), rnd(7, 11), 'rgba(60,60,80,.6)');
  });

  add('castle', 'Fairy Castle', () => {
    rect(0, 0, W, H, lin(0, 0, 0, H, ['#ffd1ec', '#d9c6ff', '#b9e4ff']));
    const rb = ['#ff5c5c', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa', '#e599f7'];
    c.save(); c.globalAlpha = 0.7; rb.forEach((col, i) => { c.beginPath(); c.arc(600, 820, 640 - i * 26, Math.PI, 0); stroke(col, 26); }); c.restore();
    cloud(150, 640, 46, '#fff', 'rgba(200,180,230,.6)'); cloud(1060, 620, 52, '#fff', 'rgba(200,180,230,.6)'); cloud(240, 160, 34, '#fff', 'rgba(200,180,230,.6)'); cloud(980, 140, 30, '#fff', 'rgba(200,180,230,.6)');
    for (let i = 0; i < 26; i++) sparkle(R() * W, R() * 500, rnd(6, 14), 'rgba(255,255,255,.9)');
    wave(640, 30, 170, 1.1, '#9be38a'); wave(700, 26, 140, 3, '#7bd16a');
    const tower = (x, top, w, roof, flag) => {
      rect(x - w / 2, top, w, 700 - top, lin(x - w / 2, 0, x + w / 2, 0, ['#f8f0ff', '#e7dcff', '#cfc0f5']));
      for (let y = top + 20; y < 700; y += 26) for (let bx = x - w / 2 + ((y / 26) % 2 ? 0 : 14); bx < x + w / 2; bx += 28) rect(bx, y, 2, 13, 'rgba(120,90,180,.18)');
      for (let y = top + 20; y < 700; y += 26) rect(x - w / 2, y, w, 2, 'rgba(120,90,180,.15)');
      poly([x - w / 2 - 14, top, x, top - w * 1.5, x + w / 2 + 14, top], roof);
      poly([x - w / 2 - 14, top, x - w * 0.15, top - w * 1.0, x, top - w * 1.5, x - w * 0.1, top], 'rgba(255,255,255,.18)');
      line(x, top - w * 1.5, x, top - w * 1.5 - 50, '#6c5a8e', 4); poly([x + 2, top - w * 1.5 - 50, x + 46, top - w * 1.5 - 38, x + 2, top - w * 1.5 - 26], flag);
      c.beginPath(); c.arc(x, top + 60, w * 0.16, Math.PI, 0); c.lineTo(x + w * 0.16, top + 100); c.lineTo(x - w * 0.16, top + 100); fill('#ffd43b');
      c.beginPath(); c.arc(x, top + 60, w * 0.16, Math.PI, 0); c.lineTo(x + w * 0.16, top + 100); c.lineTo(x - w * 0.16, top + 100); c.closePath(); stroke('#8e6cff', 3);
    };
    // keep
    rect(390, 400, 420, 300, lin(390, 0, 810, 0, ['#f3eaff', '#e4d8ff', '#d4c4f7']));
    for (let y = 412; y < 700; y += 24) { rect(390, y, 420, 2, 'rgba(120,90,180,.15)'); for (let bx = 390 + ((y / 24) % 2 ? 0 : 18); bx < 810; bx += 36) rect(bx, y, 2, 12, 'rgba(120,90,180,.15)'); }
    for (let k = 0; k < 10; k++) rect(390 + k * 44, 372, 26, 30, '#e4d8ff');
    tower(600, 230, 130, '#ff6fb5', '#ffd43b');
    tower(330, 330, 110, '#8e6cff', '#ff6b6b'); tower(870, 330, 110, '#8e6cff', '#69db7c');
    tower(180, 450, 80, '#ff8cc6', '#4dabf7'); tower(1020, 450, 80, '#ff8cc6', '#ff922b');
    // door + windows
    c.beginPath(); c.arc(600, 600, 60, Math.PI, 0); c.lineTo(660, 700); c.lineTo(540, 700); fill('#8b5a2b');
    for (let k = -2; k <= 2; k++) line(600 + k * 22, 560, 600 + k * 22, 700, 'rgba(0,0,0,.25)', 3);
    circ(630, 650, 6, '#ffd43b');
    [[470, 470], [730, 470], [470, 580], [730, 580]].forEach(([wx, wy]) => { c.beginPath(); c.arc(wx, wy, 22, Math.PI, 0); c.lineTo(wx + 22, wy + 40); c.lineTo(wx - 22, wy + 40); fill('#ffe066'); line(wx, wy - 22, wx, wy + 40, '#8e6cff', 3); });
    // banners
    [[420, '#ff6fb5'], [780, '#4dabf7']].forEach(([bx, col]) => poly([bx - 18, 410, bx + 18, 410, bx + 18, 490, bx, 474, bx - 18, 490], col));
    // path + flowers + trees
    c.beginPath(); c.moveTo(540, 700); c.bezierCurveTo(520, 760, 380, 800, 420, H + 10); c.lineTo(760, H + 10); c.bezierCurveTo(760, 800, 660, 760, 660, 700); fill(lin(0, 700, 0, H, ['#ffe8b0', '#f5c97b']));
    for (let k = 0; k < 30; k++) ell(rnd(450, 740), rnd(720, 890), rnd(8, 18), rnd(4, 8), 'rgba(200,150,80,.35)');
    rect(0, 700, 540, 200, lin(0, 700, 0, H, ['#7bd16a', '#4caf50'])); rect(660, 700, 540, 200, lin(0, 700, 0, H, ['#7bd16a', '#4caf50']));
    c.beginPath(); c.moveTo(540, 700); c.bezierCurveTo(520, 760, 380, 800, 420, H + 10); c.lineTo(760, H + 10); c.bezierCurveTo(760, 800, 660, 760, 660, 700); fill(lin(0, 700, 0, H, ['#ffe8b0', '#f5c97b']));
    [[70, 690, 60], [1130, 700, 64], [300, 760, 46], [930, 770, 50]].forEach(([tx, ty, r]) => { rect(tx - 8, ty, 16, r, '#8b5a2b'); circ(tx, ty - r * 0.3, r, '#40c057'); circ(tx - r * 0.35, ty - r * 0.6, r * 0.55, '#69db7c'); for (let k = 0; k < 5; k++) circ(tx + rnd(-r * 0.7, r * 0.7), ty - r * 0.3 + rnd(-r * 0.6, r * 0.5), 6, '#ff6b6b'); });
    for (let k = 0; k < 40; k++) { const fx = R() < 0.5 ? rnd(0, 470) : rnd(730, W), fy = rnd(730, 890); petals(fx, fy, 12, 5, pick(['#ff8cc6', '#ffd43b', '#fff', '#b197fc']), 0.32, R()); circ(fx, fy, 4, '#fab005'); }
  });

  add('autumn', 'Autumn Forest', () => {
    rect(0, 0, W, 560, lin(0, 0, 0, 560, ['#8ecbff', '#ffe3a8', '#ffc37a']));
    circ(860, 300, 180, rad(860, 300, 180, ['rgba(255,240,180,.85)', 'rgba(255,220,150,0)']));
    cloud(240, 110, 36, '#fff8ec', 'rgba(230,170,120,.45)'); cloud(1000, 90, 30, '#fff8ec', 'rgba(230,170,120,.45)');
    wave(440, 26, 150, 0.8, '#e9a35b'); wave(500, 22, 120, 2.2, '#d4803f');
    const tcols = [['#ff7b00', '#ff9e00', '#ffb627'], ['#d62828', '#f77f00', '#e85d04'], ['#ffba08', '#faa307', '#ffd166'], ['#9d0208', '#dc2f02', '#e85d04'], ['#7cb518', '#a7c957', '#ffbe0b']];
    const tree = (x, y, r, cols) => {
      poly([x - r * 0.12, y, x + r * 0.12, y, x + r * 0.08, y - r * 1.2, x - r * 0.08, y - r * 1.2], '#6b3e1e');
      line(x, y - r * 0.9, x - r * 0.4, y - r * 1.3, '#6b3e1e', r * 0.08); line(x, y - r, x + r * 0.45, y - r * 1.35, '#6b3e1e', r * 0.08);
      for (let k = 0; k < 34; k++) { const a = R() * TAU, d = Math.sqrt(R()) * r; circ(x + Math.cos(a) * d, y - r * 1.5 + Math.sin(a) * d * 0.8, r * rnd(0.22, 0.36), cols[k % 3]); }
      for (let k = 0; k < 18; k++) { const a = R() * TAU, d = Math.sqrt(R()) * r; leaf(x + Math.cos(a) * d, y - r * 1.5 + Math.sin(a) * d * 0.8, r * 0.16, r * 0.06, R() * TAU, 'rgba(255,255,255,.25)'); }
    };
    [[80, 520, 70], [330, 500, 60], [560, 520, 56], [1110, 520, 72], [760, 510, 50]].forEach(([x, y, r], i) => tree(x, y, r, tcols[(i + 2) % 5]));
    rect(0, 540, W, H - 540, lin(0, 540, 0, H, ['#d9822b', '#b8621e', '#7f3f12']));
    // path
    c.beginPath(); c.moveTo(560, 545); c.bezierCurveTo(500, 640, 760, 700, 600, H + 10); c.lineTo(940, H + 10); c.bezierCurveTo(1000, 720, 640, 640, 640, 545); fill(lin(0, 545, 0, H, ['#f2d29b', '#e2b06b']));
    [[180, 760, 110], [980, 740, 120], [420, 640, 80]].forEach(([x, y, r], i) => tree(x, y, r, tcols[i % 5]));
    for (let i = 0; i < 320; i++) leaf(R() * W, rnd(560, H), rnd(10, 18), rnd(4, 7), R() * TAU, pick(['#ff7b00', '#d62828', '#ffba08', '#9d0208', '#f77f00', '#a7c957']));
    for (let i = 0; i < 40; i++) leaf(R() * W, rnd(0, 700), rnd(12, 20), rnd(5, 8), R() * TAU, pick(['#ff7b00', '#d62828', '#ffba08', '#f77f00']));
    const shroom = (x, y, s) => { rr(x - 8 * s, y - 30 * s, 16 * s, 30 * s, 6 * s, '#fff4e0'); c.beginPath(); c.arc(x, y - 28 * s, 30 * s, Math.PI, 0); c.closePath(); fill('#e03131'); [[-14, -40], [4, -48], [16, -36], [-2, -34]].forEach(([dx, dy]) => circ(x + dx * s, y + dy * s, 4.5 * s, '#fff')); };
    shroom(300, 840, 1.4); shroom(350, 860, 1); shroom(1080, 860, 1.2);
    const pumpkin = (x, y, s) => { for (let k = -2; k <= 2; k++) ell(x + k * 16 * s, y, 22 * s, 34 * s, k % 2 ? '#f76707' : '#fd7e14'); rr(x - 4 * s, y - 46 * s, 8 * s, 16 * s, 3, '#5c940d'); leaf(x + 4 * s, y - 38 * s, 22 * s, 8 * s, -0.4, '#74b816'); };
    pumpkin(820, 830, 1.3); pumpkin(900, 860, 0.9); pumpkin(110, 860, 1.1);
    // hedgehog
    const hx = 520, hy = 820;
    for (let k = 0; k < 22; k++) { const a = Math.PI + (k / 21) * Math.PI; poly([hx + Math.cos(a) * 40, hy + Math.sin(a) * 40, hx + Math.cos(a + 0.08) * 76, hy + Math.sin(a + 0.08) * 76, hx + Math.cos(a + 0.16) * 40, hy + Math.sin(a + 0.16) * 40], '#6b4423'); }
    c.beginPath(); c.arc(hx, hy, 62, Math.PI, 0); fill('#8b5a2b');
    ell(hx + 66, hy - 10, 34, 22, '#e8c9a0'); circ(hx + 98, hy - 10, 7, '#212529'); circ(hx + 70, hy - 18, 4.5, '#212529'); circ(hx + 72, hy - 20, 1.5, '#fff');
    rect(hx - 70, hy, 180, 6, '#7f3f12');
  });

  add('beach', 'Tropical Beach', () => {
    rect(0, 0, W, 470, lin(0, 0, 0, 470, ['#2fb3ff', '#8fdcff', '#d8f6ff']));
    circ(960, 150, 170, rad(960, 150, 170, ['rgba(255,250,200,.95)', 'rgba(255,250,200,0)'])); circ(960, 150, 62, '#fff9c4');
    cloud(260, 120, 40, '#fff', 'rgba(140,200,240,.45)'); cloud(640, 80, 30, '#fff', 'rgba(140,200,240,.45)'); cloud(720, 300, 24, '#fff', 'rgba(140,200,240,.45)');
    for (let k = 0; k < 6; k++) bird(rnd(380, 820), rnd(150, 260), rnd(9, 14), '#455a64');
    rect(0, 460, W, 260, lin(0, 460, 0, 720, ['#1ec8d8', '#0aa6c6', '#0a86b5']));
    // far island
    ell(820, 470, 120, 22, '#5bbf5a'); line(840, 466, 860, 400, '#7a5230', 6); for (let k = 0; k < 5; k++) leaf(860, 400, 46, 10, -Math.PI + k * 0.7 - 0.2, '#2f9e44');
    for (let y = 480; y < 700; y += 16) for (let k = 0; k < 6; k++) { const wx = rnd(0, W); c.beginPath(); c.arc(wx, y, rnd(10, 30), Math.PI * 1.15, Math.PI * 1.85); stroke(`rgba(255,255,255,${(0.25 + (y - 480) / 700).toFixed(2)})`, 3); }
    for (let k = 0; k < 6; k++) rr(960 - 50 + rnd(-30, 30), 480 + k * 18, rnd(50, 110), 4, 2, 'rgba(255,255,220,.6)');
    // sailboat
    poly([380, 600, 520, 600, 500, 630, 400, 630], '#e03131'); line(450, 600, 450, 470, '#5c3d1e', 5); poly([456, 476, 456, 594, 530, 594], '#fff'); poly([444, 490, 444, 594, 390, 594], '#ffe066');
    // shoreline
    c.beginPath(); c.moveTo(-10, H + 10); for (let x = -10; x <= W + 10; x += 10) c.lineTo(x, 700 + Math.sin(x / 120) * 18 + Math.sin(x / 47) * 6); c.lineTo(W + 10, H + 10); fill('#fff');
    c.beginPath(); c.moveTo(-10, H + 10); for (let x = -10; x <= W + 10; x += 10) c.lineTo(x, 712 + Math.sin(x / 120) * 18 + Math.sin(x / 47) * 6); c.lineTo(W + 10, H + 10); fill(lin(0, 700, 0, H, ['#ffe6a8', '#f5c46c']));
    for (let k = 0; k < 300; k++) circ(R() * W, rnd(730, H), rnd(1, 2.4), 'rgba(170,110,40,.3)');
    // palms
    const palm = (x, y, h, lean, s) => {
      const tx = x + lean * h, ty = y - h, P = (t) => [x + lean * h * t * t, y - h * t];
      c.beginPath();
      for (let k = 0; k <= 20; k++) { const [px, py] = P(k / 20); c.lineTo(px - (22 - k * 0.6) * s, py); }
      for (let k = 20; k >= 0; k--) { const [px, py] = P(k / 20); c.lineTo(px + (22 - k * 0.6) * s, py); }
      fill(lin(x - 20, 0, x + 20, 0, ['#8b5a2b', '#b07a45', '#7a4b22']));
      for (let k = 1; k < 16; k++) { const [px, py] = P(k / 16); c.beginPath(); c.arc(px, py + 12 * s, (21 - k * 0.6) * s, Math.PI * 1.15, Math.PI * 1.85); stroke('rgba(70,40,15,.55)', 3); }
      const frond = (a, len, col) => {
        const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.6 + len * 0.25;
        const mx = tx + Math.cos(a) * len * 0.5, my = ty + Math.sin(a) * len * 0.5 - len * 0.12;
        c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(mx, my - 26 * s, ex, ey); c.quadraticCurveTo(mx, my + 22 * s, tx, ty); fill(col);
        c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(mx, my, ex, ey); stroke('rgba(0,70,20,.55)', 3);
        for (let k = 1; k < 9; k++) { const t = k / 9, qx = (1 - t) * (1 - t) * tx + 2 * (1 - t) * t * mx + t * t * ex, qy = (1 - t) * (1 - t) * ty + 2 * (1 - t) * t * my + t * t * ey; line(qx, qy, qx + Math.cos(a + 1.9) * 22 * s * (1 - t * 0.6), qy + Math.sin(a + 1.9) * 22 * s * (1 - t * 0.6), 'rgba(255,255,255,.18)', 2); }
      };
      [[-2.9, '#2b9348'], [-0.25, '#2b9348'], [-2.4, '#55a630'], [-0.75, '#55a630'], [-1.9, '#2b9348'], [-1.25, '#40916c'], [-3.4, '#55a630'], [0.25, '#40916c']].forEach(([a, col]) => frond(a, 190 * s, col));
      circ(tx - 10 * s, ty + 12 * s, 14 * s, '#6b4423'); circ(tx + 12 * s, ty + 14 * s, 14 * s, '#6b4423'); circ(tx + 1 * s, ty + 28 * s, 14 * s, '#5a381c');
    };
    palm(250, 880, 330, -0.28, 0.85); palm(120, 880, 470, 0.25, 1);
    // umbrella + towel
    c.save(); c.translate(740, 800); c.rotate(-0.08); for (let k = 0; k < 7; k++) rect(k * 26, 0, 26, 74, k % 2 ? '#4dabf7' : '#ffe066'); c.restore();
    ell(930, 872, 90, 12, 'rgba(150,100,30,.25)');
    line(930, 872, 930, 570, '#f1f3f5', 7);
    const ux = 930, uy = 590, ur = 170;
    const dome = () => { c.beginPath(); c.moveTo(ux - ur, uy + 30); c.quadraticCurveTo(ux, uy - 190, ux + ur, uy + 30); for (let k = 6; k > 0; k--) c.quadraticCurveTo(ux - ur + ((k - 0.5) * 2 * ur) / 6, uy + 12, ux - ur + ((k - 1) * 2 * ur) / 6, uy + 30); c.closePath(); };
    withClip(dome, () => {
      rect(ux - ur - 10, uy - 120, ur * 2 + 20, 160, '#ff6b6b');
      for (let k = 0; k < 6; k += 2) poly([ux, uy - 75, ux - ur + (k * 2 * ur) / 6, uy + 40, ux - ur + ((k + 1) * 2 * ur) / 6, uy + 40], '#ffffff');
      circ(ux - 60, uy - 60, 120, rad(ux - 60, uy - 60, 120, ['rgba(255,255,255,.3)', 'rgba(255,255,255,0)']));
    });
    circ(ux, uy - 76, 7, '#f1f3f5');
    // ball
    const bx = 600, by = 800; circ(bx, by, 40, '#fff');
    [['#ff6b6b', 0], ['#4dabf7', 2.1], ['#ffd43b', 4.2]].forEach(([col, a]) => { c.beginPath(); c.moveTo(bx, by); c.arc(bx, by, 40, a, a + 1.05); c.closePath(); fill(col); });
    circ(bx - 12, by - 14, 9, 'rgba(255,255,255,.7)');
    // bucket
    poly([460, 800, 520, 800, 510, 860, 470, 860], '#20c997'); c.beginPath(); c.arc(490, 800, 30, Math.PI, 0); stroke('#495057', 3);
    // crab
    const cx = 1080, cy = 840;
    for (const s of [-1, 1]) { for (let k = 0; k < 3; k++) line(cx + s * 26, cy + 4 + k * 6, cx + s * 52, cy + 16 + k * 8, '#e03131', 4); line(cx + s * 20, cy - 10, cx + s * 40, cy - 34, '#e03131', 5); circ(cx + s * 44, cy - 40, 12, '#f03e3e'); poly([cx + s * 44, cy - 40, cx + s * 58, cy - 54, cx + s * 54, cy - 36], '#ffe6a8'); }
    ell(cx, cy, 36, 24, '#f03e3e'); line(cx - 10, cy - 18, cx - 12, cy - 36, '#e03131', 3); line(cx + 10, cy - 18, cx + 12, cy - 36, '#e03131', 3); circ(cx - 12, cy - 38, 6, '#fff'); circ(cx + 12, cy - 38, 6, '#fff'); circ(cx - 12, cy - 38, 3, '#111'); circ(cx + 12, cy - 38, 3, '#111');
    star(380, 860, 26, '#ff922b', 5, 0.42); star(200, 880, 18, '#f06595', 5, 0.42);
    for (let k = 0; k < 5; k++) { const sx = rnd(520, 760), sy = rnd(860, 890); c.beginPath(); c.arc(sx, sy, 12, Math.PI, 0); fill('#fff0f6'); }
  });

  add('winter', 'Snowy Village', () => {
    rect(0, 0, W, 620, lin(0, 0, 0, 620, ['#0b1739', '#1d3a7a', '#4a73c2', '#9bb8ee']));
    for (let i = 0; i < 160; i++) circ(R() * W, R() * 380, rnd(0.5, 2), `rgba(255,255,255,${rnd(0.3, 0.9).toFixed(2)})`);
    c.save(); c.globalCompositeOperation = 'lighter';
    [['rgba(80,255,170,', 120, 0.3], ['rgba(80,220,255,', 180, 1.7], ['rgba(190,100,255,', 90, 3.1]].forEach(([col, y0, ph]) => {
      for (let k = 0; k < 3; k++) {
        c.beginPath();
        for (let x = -20; x <= W + 20; x += 20) c.lineTo(x, y0 + k * 22 + Math.sin(x / 160 + ph) * 50);
        for (let x = W + 20; x >= -20; x -= 20) c.lineTo(x, y0 + k * 22 + 110 + Math.sin(x / 160 + ph) * 50 + Math.sin(x / 50) * 8);
        c.closePath(); fill(lin(0, y0 - 40, 0, y0 + 170, [col + '0)', col + '0.28)', col + '0)']));
      }
    });
    c.restore();
    circ(180, 120, 110, rad(180, 120, 110, ['rgba(255,252,230,.45)', 'rgba(255,252,230,0)'])); circ(180, 120, 46, '#fdfcf0'); [[166, 108, 9], [196, 130, 7], [190, 100, 5]].forEach(([x, y, r]) => circ(x, y, r, 'rgba(200,200,180,.6)'));
    wave(470, 30, 170, 0.5, '#c9d9f5'); wave(540, 26, 140, 2, '#dfe9fb');
    for (let k = 0; k < 16; k++) pine(rnd(0, W), rnd(500, 560), rnd(80, 130), '#1f5c4a', '#f4f8ff');
    rect(0, 620, W, 280, lin(0, 620, 0, H, ['#f4f8ff', '#dce8fb', '#c3d5f2']));
    const house = (x, y, w, h, wall, roofCol) => {
      rect(x, y - h, w, h, wall); for (let yy = y - h + 14; yy < y; yy += 16) rect(x, yy, w, 2, 'rgba(0,0,0,.12)');
      rect(x + w * 0.7, y - h - 80, 26, 70, '#6d4c41'); for (let k = 0; k < 4; k++) circ(x + w * 0.7 + 13 + k * 10, y - h - 100 - k * 30, 14 + k * 5, `rgba(255,255,255,${0.5 - k * 0.1})`);
      poly([x - 24, y - h + 4, x + w / 2, y - h - 90, x + w + 24, y - h + 4], roofCol);
      c.beginPath(); c.moveTo(x - 30, y - h + 6); c.lineTo(x + w / 2, y - h - 98); c.lineTo(x + w + 30, y - h + 6); c.quadraticCurveTo(x + w + 10, y - h + 22, x + w - 10, y - h + 8); c.quadraticCurveTo(x + w / 2, y - h - 60, x + 10, y - h + 8); c.quadraticCurveTo(x - 10, y - h + 22, x - 30, y - h + 6); fill('#ffffff');
      const wy = y - h * 0.62;
      [[x + w * 0.2, wy], [x + w * 0.62, wy]].forEach(([wx, wyy]) => { rect(wx - 4, wyy - 4, w * 0.22 + 8, h * 0.32 + 8, '#5d4037'); rect(wx, wyy, w * 0.22, h * 0.32, '#ffd56b'); line(wx + w * 0.11, wyy, wx + w * 0.11, wyy + h * 0.32, '#5d4037', 3); line(wx, wyy + h * 0.16, wx + w * 0.22, wyy + h * 0.16, '#5d4037', 3); rr(wx - 6, wyy + h * 0.32 + 2, w * 0.22 + 12, 8, 4, '#fff'); });
      rect(x + w * 0.4, y - h * 0.4, w * 0.2, h * 0.4, '#8d3b2a'); circ(x + w * 0.56, y - h * 0.2, 3, '#ffd43b');
    };
    [[330, 690, 170], [395, 705, 140], [690, 700, 150], [1010, 690, 130]].forEach(([px, py, ph]) => pine(px, py, ph, '#2b6e4f', '#ffffff'));
    house(90, 720, 190, 150, '#c0504d', '#7b2b28'); house(450, 700, 170, 130, '#4f7cac', '#2d4e75'); house(760, 730, 220, 170, '#e0a458', '#8a5a2b');
    for (let k = 0; k < 3; k++) pine(30 + k * 26, 790 + k * 20, 150 - k * 20, '#2b6e4f', '#ffffff');
    // lamp
    rect(660, 640, 8, 190, '#37474f'); rr(648, 610, 32, 40, 6, '#37474f'); rect(653, 616, 22, 28, '#fff3bf'); circ(664, 630, 70, rad(664, 630, 70, ['rgba(255,240,170,.55)', 'rgba(255,240,170,0)']));
    // snowman
    const sx = 1070, sy = 820;
    circ(sx, sy, 62, '#fff'); circ(sx, sy - 88, 44, '#fff'); circ(sx, sy - 152, 32, '#fff');
    circ(sx + 10, sy - 30, 70, 'rgba(120,150,200,.12)');
    rect(sx - 26, sy - 190, 52, 10, '#212529'); rect(sx - 18, sy - 226, 36, 38, '#212529'); rect(sx - 18, sy - 198, 36, 7, '#e03131');
    circ(sx - 11, sy - 160, 4, '#212529'); circ(sx + 11, sy - 160, 4, '#212529'); poly([sx, sy - 152, sx + 34, sy - 146, sx, sy - 142], '#ff922b');
    for (let k = -2; k <= 2; k++) circ(sx + k * 7, sy - 134 + Math.abs(k) * -2, 2.5, '#212529');
    rr(sx - 40, sy - 126, 80, 16, 8, '#e03131'); rect(sx + 14, sy - 118, 16, 46, '#e03131');
    [sy - 95, sy - 70, sy - 10, sy + 20].forEach((by) => circ(sx, by, 5, '#212529'));
    line(sx - 40, sy - 94, sx - 100, sy - 130, '#6d4c41', 5); line(sx + 40, sy - 94, sx + 96, sy - 136, '#6d4c41', 5);
    // sled + presents
    rr(300, 820, 120, 16, 8, '#c92a2a'); line(300, 846, 430, 846, '#495057', 4); rect(320, 790, 36, 30, '#4dabf7'); rect(334, 790, 8, 30, '#ffd43b'); rect(366, 780, 40, 40, '#69db7c'); rect(382, 780, 8, 40, '#e64980');
    for (let i = 0; i < 180; i++) circ(R() * W, R() * H, rnd(1.5, 4.5), `rgba(255,255,255,${rnd(0.5, 0.95).toFixed(2)})`);
  });

  add('quilt', 'Patchwork Quilt', () => {
    const cols = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#fff4e6'];
    const n = 6, m = 4.5, s = W / n;
    rect(0, 0, W, H, '#fff4e6');
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < n; gx++) {
      const x = gx * s, y = gy * s, a = pick(cols), b = pick(cols.filter((q) => q !== a)), kind = (gx * 3 + gy * 5 + Math.floor(R() * 3)) % 8;
      withClip(() => { c.beginPath(); c.rect(x, y, s, s); }, () => {
        rect(x, y, s, s, a);
        const cx = x + s / 2, cy = y + s / 2;
        if (kind === 0) for (let k = 0; k < 6; k++) rect(x, y + k * s / 6, s, s / 12, b);
        else if (kind === 1) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) circ(x + s / 8 + i * s / 4, y + s / 8 + j * s / 4, s / 14, b);
        else if (kind === 2) star(cx, cy, s * 0.4, b, 5, 0.45);
        else if (kind === 3) { c.beginPath(); c.moveTo(cx, cy + s * 0.32); c.bezierCurveTo(cx - s * 0.55, cy - s * 0.05, cx - s * 0.2, cy - s * 0.45, cx, cy - s * 0.15); c.bezierCurveTo(cx + s * 0.2, cy - s * 0.45, cx + s * 0.55, cy - s * 0.05, cx, cy + s * 0.32); fill(b); }
        else if (kind === 4) { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { if ((i + j) % 2) rect(x + i * s / 4, y + j * s / 4, s / 4, s / 4, b); } }
        else if (kind === 5) { poly([x, y, x + s, y, cx, cy], b); poly([x, y + s, x + s, y + s, cx, cy], b); }
        else if (kind === 6) { for (let k = 4; k > 0; k--) circ(cx, cy, (s * 0.42 * k) / 4, k % 2 ? b : a); }
        else { petals(cx, cy, s * 0.3, 8, b, 0.3, 0.3); circ(cx, cy, s * 0.09, pick(cols)); }
        c.setLineDash([8, 7]); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 3; c.strokeRect(x + 9, y + 9, s - 18, s - 18); c.setLineDash([]);
        rect(x, y, s, 4, 'rgba(0,0,0,.08)'); rect(x, y, 4, s, 'rgba(0,0,0,.08)');
      });
    }
    void m;
  });

  // Paints picture `key` onto a canvas of size w × h (the 1200 × 900 design is scaled to fit).
  function paint(key, canvas) {
    const item = list.find((p) => p.key === key) || list[0];
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    c = ctx; R = seeded(hash(item.key));
    try { item.draw(); } finally { ctx.restore(); c = null; R = Math.random; }
    return canvas;
  }

  window.PuzzlePictures = { list, paint, W, H };
})();
