// Road Rush: a pseudo-3D arcade racer (segment-projected road, OutRun style) for Chowaniec Games.
// Timed run: start with 60 s, checkpoints add time, score = distance + coins×50 + overtakes×10.
// Everything random about the course (road shape, scenery, coins, boost pads, traffic) comes from
// ChowGames.rng(seed), so in a race every player drives the identical course.
(function () {
  'use strict';
  const CG = window.ChowGames;

  // ---------- Tuning ----------
  const SEG = 200;              // segment length (world units)
  const ROAD = 2000;            // road half-width
  const RUMBLE = 3;             // segments per colour stripe
  const DRAW = 230;             // draw distance in segments
  const MAXS = 12000;           // top speed (world units / s)
  const BOOST_MAX = MAXS * 1.38;
  const ACCEL = MAXS / 4.2;
  const BRAKE = -MAXS * 1.2;
  const COAST = -MAXS / 5;
  const OFF_DECEL = -MAXS / 1.5;
  const OFF_LIMIT = MAXS / 3.2;
  const CENTRIFUGAL = 0.3;
  const START_TIME = 60;
  const CP_BONUS = 15;
  const START_SEG = 20;
  const START_POS = START_SEG * SEG;
  const CAR_W = 900;             // player car world width
  const CAR_LEN = 360;           // collision length
  const LANES = [-0.66, 0, 0.66];
  const LANE_SPEED = [0.56, 0.46, 0.36];
  const MPH = 150 / MAXS;
  const BLEND = 160;             // segments to cross-fade between scenery zones
  const ZONE_LENS = [2000, 2200, 2600, 2800];
  const STEP = 1 / 60;

  // ---------- Small helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIn = (a, b, t) => a + (b - a) * t * t;
  const easeInOut = (a, b, t) => a + (b - a) * (-Math.cos(t * Math.PI) / 2 + 0.5);
  const hexRgb = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mixRgb = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`; };
  const shade = (c, amt) => (amt >= 0 ? mixRgb(c, '#ffffff', amt) : mixRgb(c, '#000000', -amt));
  const isTouch = () => (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  const FONT = 'Outfit, system-ui, -apple-system, "Segoe UI", sans-serif';

  function mk(w, h, s, draw) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * s)); c.height = Math.max(1, Math.ceil(h * s));
    const g = c.getContext('2d');
    g.scale(s, s);
    draw(g, w, h);
    return c;
  }
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); }
  function vgrad(g, y0, y1, stops) { const gr = g.createLinearGradient(0, y0, 0, y1); stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c)); return gr; }
  function circles(g, list, color) { g.fillStyle = color; g.beginPath(); list.forEach(([x, y, r]) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }); g.fill(); }

  // ---------- Zones (scenery themes) ----------
  const ZONES = [
    { key: 'country', name: 'Country Roads', grass: ['#62c346', '#56b63b'], road: ['#6e727c', '#686c76'], rumble: ['#ffffff', '#e53935'], lane: '#ffffff',
      sky: ['#2f86e0', '#79bff3', '#d9f1ff'], fog: '#d9f1ff', ground: '#56b63b', night: 0 },
    { key: 'beach', name: 'Sunny Beach', grass: ['#f4dca0', '#eed294'], road: ['#7a7e88', '#747882'], rumble: ['#ffffff', '#ff8a1f'], lane: '#ffffff',
      sky: ['#1f9fe9', '#86d6f7', '#ffe6bf'], fog: '#ffe6bf', ground: '#eed294', night: 0 },
    { key: 'city', name: 'Night City', grass: ['#33354a', '#2d2f42'], road: ['#3d4054', '#393c4f'], rumble: ['#e9e9f5', '#ff3d8b'], lane: '#ffd54a',
      sky: ['#080721', '#271a58', '#b8427a'], fog: '#3a2153', ground: '#2d2f42', night: 1 }
  ];
  // Which zone a segment is in: { a, b, t } = blend from zone a to zone b by t, plus k (zone number).
  function zoneAt(i) {
    let start = 0, k = 0, len = ZONE_LENS[0];
    while (i >= start + len) { start += len; k++; len = ZONE_LENS[Math.min(k, ZONE_LENS.length - 1)]; }
    const b = k % ZONES.length;
    if (k > 0 && i - start < BLEND) return { a: (k - 1) % ZONES.length, b, t: (i - start) / BLEND, k };
    return { a: b, b, t: 0, k };
  }

  // ---------- Art (all procedural, pre-rendered to offscreen canvases) ----------
  const ART = {};
  let artRnd = CG.rng(20240611);

  function artTree(g, w, h) {
    g.fillStyle = 'rgba(0,0,0,.18)'; ell(g, w / 2, h - 7, w * 0.34, 8); g.fill();
    const tg = g.createLinearGradient(w / 2 - 14, 0, w / 2 + 14, 0); tg.addColorStop(0, '#8a5a2e'); tg.addColorStop(1, '#5a3618');
    g.fillStyle = tg; g.beginPath(); g.moveTo(w / 2 - 15, h - 8); g.lineTo(w / 2 - 9, h * 0.5); g.lineTo(w / 2 + 9, h * 0.5); g.lineTo(w / 2 + 15, h - 8); g.closePath(); g.fill();
    const blobs = [[0.5, 0.36, 0.3], [0.27, 0.5, 0.22], [0.73, 0.5, 0.22], [0.36, 0.24, 0.21], [0.64, 0.26, 0.2], [0.5, 0.58, 0.24]].map(([x, y, r]) => [x * w, y * h, r * w]);
    circles(g, blobs.map(([x, y, r]) => [x + 5, y + 7, r]), '#2a7a34');
    circles(g, blobs, '#3f9f45');
    circles(g, blobs.map(([x, y, r]) => [x - r * 0.18, y - r * 0.2, r * 0.72]), '#58bb4f');
    circles(g, blobs.slice(0, 5).map(([x, y, r]) => [x - r * 0.35, y - r * 0.38, r * 0.3]), '#86d86a');
  }
  function artPine(g, w, h) {
    g.fillStyle = 'rgba(0,0,0,.18)'; ell(g, w / 2, h - 6, w * 0.3, 7); g.fill();
    g.fillStyle = '#6b4423'; g.fillRect(w / 2 - 9, h * 0.78, 18, h * 0.21);
    const tiers = [[0.86, 0.5, 0.46], [0.64, 0.4, 0.36], [0.42, 0.3, 0.24]];
    tiers.forEach(([by, hw, th]) => {
      const y0 = by * h, top = y0 - th * h * 1.25;
      g.fillStyle = '#1f6b3a'; g.beginPath(); g.moveTo(w / 2, top); g.lineTo(w / 2 + hw * w, y0); g.lineTo(w / 2 - hw * w, y0); g.closePath(); g.fill();
      g.fillStyle = '#2f8a48'; g.beginPath(); g.moveTo(w / 2, top); g.lineTo(w / 2 - hw * w, y0); g.lineTo(w / 2 - hw * w * 0.1, y0 - 4); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(w / 2, top); g.lineTo(w / 2 - hw * w * 0.55, y0 - th * h * 0.5); g.lineTo(w / 2 - hw * w * 0.2, y0 - th * h * 0.45); g.closePath(); g.fill();
    });
  }
  function artBush(g, w, h, flower) {
    g.fillStyle = 'rgba(0,0,0,.16)'; ell(g, w / 2, h - 6, w * 0.44, 7); g.fill();
    const b = [[0.25, 0.62, 0.24], [0.5, 0.48, 0.3], [0.75, 0.62, 0.24], [0.4, 0.7, 0.22], [0.62, 0.7, 0.22]].map(([x, y, r]) => [x * w, y * h, r * w * 0.62]);
    circles(g, b.map(([x, y, r]) => [x + 3, y + 5, r]), '#2c7d33');
    circles(g, b, '#48a845');
    circles(g, b.map(([x, y, r]) => [x - r * 0.25, y - r * 0.25, r * 0.55]), '#6cc85b');
    if (flower) for (let i = 0; i < 9; i++) { const x = w * (0.18 + artRnd() * 0.64), y = h * (0.35 + artRnd() * 0.4); circles(g, [[x, y, 5]], flower); circles(g, [[x, y, 2]], '#fff7c2'); }
  }
  function artFlowers(g, w, h) {
    for (let i = 0; i < 14; i++) {
      const x = w * (0.06 + artRnd() * 0.88), y = h * (0.55 + artRnd() * 0.35);
      g.strokeStyle = '#3f9b3c'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, h - 2); g.lineTo(x + (artRnd() - 0.5) * 8, y); g.stroke();
      const col = ['#ff5d8f', '#ffd23f', '#ffffff', '#b07bff', '#ff8a3d'][Math.floor(artRnd() * 5)];
      for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2; circles(g, [[x + Math.cos(a) * 6, y + Math.sin(a) * 6, 5]], col); }
      circles(g, [[x, y, 4]], '#ffb703');
    }
  }
  function artCow(g, w, h) {
    g.fillStyle = 'rgba(0,0,0,.16)'; ell(g, w / 2, h - 6, w * 0.42, 8); g.fill();
    g.fillStyle = '#f6f3ee';
    [[0.28, 0.62], [0.42, 0.66], [0.62, 0.66], [0.74, 0.62]].forEach(([x]) => { rr(g, x * w - 7, h * 0.55, 14, h * 0.42, 5); g.fill(); });
    g.fillStyle = '#3a3a3a'; [[0.28], [0.42], [0.62], [0.74]].forEach(([x]) => g.fillRect(x * w - 7, h - 16, 14, 10));
    rr(g, w * 0.18, h * 0.3, w * 0.62, h * 0.38, 34); g.fillStyle = '#f6f3ee'; g.fill();
    g.save(); g.clip();
    circles(g, [[w * 0.34, h * 0.38, 20], [w * 0.58, h * 0.56, 24], [w * 0.7, h * 0.33, 14]], '#2b2b2b');
    g.restore();
    g.strokeStyle = '#2b2b2b'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(w * 0.18, h * 0.38); g.quadraticCurveTo(w * 0.08, h * 0.45, w * 0.1, h * 0.62); g.stroke();
    // head
    rr(g, w * 0.72, h * 0.16, w * 0.24, h * 0.34, 18); g.fillStyle = '#f6f3ee'; g.fill();
    rr(g, w * 0.76, h * 0.34, w * 0.22, h * 0.18, 12); g.fillStyle = '#ffb3c1'; g.fill();
    circles(g, [[w * 0.83, h * 0.43, 3], [w * 0.92, h * 0.43, 3]], '#c26b7a');
    circles(g, [[w * 0.79, h * 0.26, 4.5], [w * 0.91, h * 0.26, 4.5]], '#222');
    circles(g, [[w * 0.795, h * 0.25, 1.5], [w * 0.915, h * 0.25, 1.5]], '#fff');
    g.fillStyle = '#e8d5a3'; g.beginPath(); g.moveTo(w * 0.75, h * 0.17); g.lineTo(w * 0.72, h * 0.06); g.lineTo(w * 0.79, h * 0.15); g.fill();
    g.beginPath(); g.moveTo(w * 0.93, h * 0.17); g.lineTo(w * 0.97, h * 0.06); g.lineTo(w * 0.9, h * 0.15); g.fill();
  }
  function artBillboard(text, bg, fg) {
    return (g, w, h) => {
      g.fillStyle = 'rgba(0,0,0,.18)'; ell(g, w / 2, h - 6, w * 0.4, 7); g.fill();
      g.fillStyle = '#6d4a2b'; g.fillRect(w * 0.2 - 8, h * 0.45, 16, h * 0.55 - 6); g.fillRect(w * 0.8 - 8, h * 0.45, 16, h * 0.55 - 6);
      rr(g, 6, 6, w - 12, h * 0.6, 14); g.fillStyle = '#ffffff'; g.fill();
      rr(g, 16, 16, w - 32, h * 0.6 - 20, 9); g.fillStyle = bg; g.fill();
      g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(16, 16); g.lineTo(w * 0.55, 16); g.lineTo(w * 0.35, h * 0.6 - 4); g.lineTo(16, h * 0.6 - 4); g.fill();
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = h * 0.3; g.font = `italic 900 ${size}px ${FONT}`;
      while (g.measureText(text).width > w - 60 && size > 10) { size -= 2; g.font = `italic 900 ${size}px ${FONT}`; }
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeText(text, w / 2, h * 0.31 + 4);
      g.fillText(text, w / 2, h * 0.31);
    };
  }
  function artChevron(dir) {
    return (g, w, h) => {
      g.fillStyle = '#8a8f99'; g.fillRect(w / 2 - 5, h * 0.5, 10, h * 0.5);
      rr(g, 4, 4, w - 8, h * 0.56, 10); g.fillStyle = '#1f1f1f'; g.fill();
      rr(g, 9, 9, w - 18, h * 0.56 - 10, 7); g.fillStyle = '#ffd400'; g.fill();
      g.fillStyle = '#1f1f1f';
      for (let k = 0; k < 2; k++) {
        const cx = w * (0.36 + k * 0.3), cy = h * 0.32, s = h * 0.15;
        g.beginPath();
        g.moveTo(cx - dir * s * 0.6, cy - s); g.lineTo(cx + dir * s * 0.5, cy); g.lineTo(cx - dir * s * 0.6, cy + s);
        g.lineTo(cx - dir * s * 0.05, cy + s); g.lineTo(cx + dir * s * 1.05, cy); g.lineTo(cx - dir * s * 0.05, cy - s); g.closePath(); g.fill();
      }
    };
  }
  function artPalm(flip) {
    return (g, w, h) => {
      g.save(); if (flip) { g.translate(w, 0); g.scale(-1, 1); }
      g.fillStyle = 'rgba(0,0,0,.16)'; ell(g, w * 0.42, h - 6, w * 0.25, 7); g.fill();
      const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push([w * 0.42 + Math.sin(t * 1.6) * w * 0.16, h - 8 - t * h * 0.66]); }
      for (let i = 0; i < 14; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], r = lerp(13, 8, i / 14);
        g.fillStyle = i % 2 ? '#a0703f' : '#8a5c31';
        g.beginPath(); g.moveTo(x0 - r, y0); g.lineTo(x1 - r * 0.95, y1 - 2); g.lineTo(x1 + r * 0.95, y1 - 2); g.lineTo(x0 + r, y0); g.closePath(); g.fill();
      }
      const [tx, ty] = pts[14];
      const leaf = (ang, len, col) => {
        g.save(); g.translate(tx, ty); g.rotate(ang);
        g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -len * 0.28, len, len * 0.22); g.quadraticCurveTo(len * 0.5, -len * 0.02, 0, 0); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -len * 0.16, len, len * 0.22); g.stroke();
        g.restore();
      };
      const L = w * 0.5;
      [[-2.9, '#2e8b3e'], [-2.3, '#3aa14a'], [-1.75, '#2e8b3e'], [-1.2, '#45b052'], [-0.6, '#3aa14a'], [-0.1, '#2e8b3e'], [0.45, '#45b052'], [3.4, '#3aa14a']].forEach(([a, c]) => leaf(a, L * (0.85 + 0.15 * Math.cos(a * 3)), c));
      circles(g, [[tx - 7, ty + 6, 8], [tx + 7, ty + 7, 8], [tx, ty + 13, 8]], '#6b4423');
      g.restore();
    };
  }
  function artUmbrella(g, w, h) {
    g.fillStyle = 'rgba(0,0,0,.14)'; ell(g, w / 2, h - 8, w * 0.42, 10); g.fill();
    rr(g, w * 0.12, h * 0.8, w * 0.5, h * 0.14, 4); g.fillStyle = '#4fc3f7'; g.fill();
    g.fillStyle = '#ffffff'; for (let i = 0; i < 4; i++) g.fillRect(w * 0.12 + i * w * 0.13 + 4, h * 0.8, w * 0.05, h * 0.14);
    g.fillStyle = '#e0e0e0'; g.fillRect(w / 2 - 3, h * 0.28, 6, h * 0.7);
    const cy = h * 0.32, rx = w * 0.48, ry = h * 0.26;
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI + i * Math.PI / 8, a1 = a0 + Math.PI / 8;
      g.fillStyle = i % 2 ? '#ffffff' : '#ef3b4f';
      g.beginPath(); g.moveTo(w / 2, cy - ry * 0.85); g.lineTo(w / 2 + Math.cos(a0) * rx, cy + Math.sin(a0) * ry * 0.2 + 2); g.lineTo(w / 2 + Math.cos(a1) * rx, cy + Math.sin(a1) * ry * 0.2 + 2); g.closePath(); g.fill();
    }
    circles(g, [[w / 2, cy - ry * 0.85, 5]], '#ffd23f');
  }
  function artSurf(g, w, h) {
    g.fillStyle = 'rgba(0,0,0,.14)'; ell(g, w / 2, h - 6, w * 0.4, 7); g.fill();
    [['#ff6b6b', -0.18, 0.28], ['#4dd0e1', 0, 0.5], ['#ffd23f', 0.16, 0.72]].forEach(([c, rot, x]) => {
      g.save(); g.translate(w * x, h * 0.55); g.rotate(rot);
      ell(g, 0, 0, w * 0.13, h * 0.44); g.fillStyle = c; g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(-2.5, -h * 0.4, 5, h * 0.8);
      ell(g, -w * 0.04, -h * 0.15, w * 0.03, h * 0.18); g.fillStyle = 'rgba(255,255,255,.3)'; g.fill();
      g.restore();
    });
  }
  function artHut(g, w, h) {
    g.fillStyle = 'rgba(0,0,0,.16)'; ell(g, w / 2, h - 6, w * 0.46, 8); g.fill();
    g.fillStyle = '#7b5230'; g.fillRect(w * 0.12, h * 0.42, 8, h * 0.56); g.fillRect(w * 0.88 - 8, h * 0.42, 8, h * 0.56);
    for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#c98d55' : '#b97d47'; g.fillRect(w * 0.16, h * 0.44 + i * h * 0.055, w * 0.68, h * 0.055); }
    rr(g, w * 0.34, h * 0.52, w * 0.32, h * 0.2, 6); g.fillStyle = '#5ec8f0'; g.fill();
    g.fillStyle = '#fff'; g.font = `900 ${h * 0.11}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SURF', w / 2, h * 0.62);
    g.fillStyle = '#e8c35a'; g.beginPath(); g.moveTo(w * 0.02, h * 0.46); g.lineTo(w / 2, h * 0.06); g.lineTo(w * 0.98, h * 0.46); g.closePath(); g.fill();
    g.strokeStyle = '#c9a03f'; g.lineWidth = 2;
    for (let i = 0; i < 22; i++) { const x = w * (0.04 + i * 0.043); g.beginPath(); g.moveTo(x, h * 0.46); g.lineTo(x + 3, h * 0.52); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.moveTo(w / 2, h * 0.06); g.lineTo(w * 0.02, h * 0.46); g.lineTo(w * 0.3, h * 0.46); g.closePath(); g.fill();
  }
  function artBuilding(col, floors, cols, roof) {
    return (g, w, h) => {
      const top = roof ? 34 : 6;
      g.fillStyle = shade(col, -0.35); g.fillRect(w * 0.82, top + 10, w * 0.14, h - top - 10);
      g.fillStyle = vgrad(g, top, h, [shade(col, 0.12), col, shade(col, -0.15)]); g.fillRect(w * 0.04, top, w * 0.8, h - top);
      g.fillStyle = shade(col, 0.25); g.fillRect(w * 0.02, top - 6, w * 0.84, 8);
      const x0 = w * 0.1, ww = w * 0.68, y0 = top + 18, hh = h - top - 60;
      const cw = ww / cols, ch = hh / floors;
      for (let r = 0; r < floors; r++) for (let c = 0; c < cols; c++) {
        const lit = artRnd() < 0.58;
        g.fillStyle = lit ? (artRnd() < 0.8 ? '#ffd86b' : '#9ff3ff') : '#1c1e33';
        g.fillRect(x0 + c * cw + cw * 0.18, y0 + r * ch + ch * 0.2, cw * 0.64, ch * 0.58);
      }
      // shop front
      g.fillStyle = '#ffe9a8'; g.fillRect(w * 0.12, h - 38, w * 0.64, 30);
      g.fillStyle = '#ff3d8b'; g.fillRect(w * 0.08, h - 46, w * 0.72, 8);
      if (roof === 'antenna') {
        g.fillStyle = '#8b8fa8'; g.fillRect(w * 0.42, 0, 4, top); circles(g, [[w * 0.42 + 2, 3, 4]], '#ff3b3b');
      } else if (roof === 'tank') {
        g.fillStyle = '#5b5f78'; g.fillRect(w * 0.2, 8, w * 0.2, top - 8); g.fillRect(w * 0.22, top - 6, 4, 6); g.fillRect(w * 0.36, top - 6, 4, 6);
      }
    };
  }
  function artLamp(side) {
    // side = -1: lamp stands on the left and leans right over the road
    return (g, w, h) => {
      g.save(); if (side > 0) { g.translate(w, 0); g.scale(-1, 1); }
      const px = w * 0.16, hx = w * 0.78, hy = h * 0.2;
      const glow = g.createRadialGradient(hx, hy + 8, 2, hx, hy + 8, w * 0.42);
      glow.addColorStop(0, 'rgba(255,230,150,.75)'); glow.addColorStop(0.4, 'rgba(255,210,120,.25)'); glow.addColorStop(1, 'rgba(255,200,100,0)');
      g.fillStyle = glow; g.fillRect(0, 0, w, h * 0.55);
      g.fillStyle = '#4b4f63'; g.fillRect(px - 5, h * 0.16, 10, h * 0.84);
      g.fillRect(px - 9, h - 14, 18, 14);
      g.strokeStyle = '#4b4f63'; g.lineWidth = 8; g.beginPath(); g.moveTo(px, h * 0.2); g.quadraticCurveTo(px, hy - 12, hx - 20, hy - 6); g.lineTo(hx + 6, hy - 6); g.stroke();
      rr(g, hx - 22, hy - 10, 44, 14, 6); g.fillStyle = '#3a3d4f'; g.fill();
      ell(g, hx, hy + 5, 18, 6); g.fillStyle = '#fff6d0'; g.fill();
      g.restore();
    };
  }
  function artNeon(text, color) {
    return (g, w, h) => {
      g.fillStyle = '#2a2c3d'; g.fillRect(w * 0.22 - 4, h * 0.55, 8, h * 0.45); g.fillRect(w * 0.78 - 4, h * 0.55, 8, h * 0.45);
      rr(g, 8, 8, w - 16, h * 0.56, 14); g.fillStyle = '#15132a'; g.fill();
      g.lineWidth = 4; g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = 14; rr(g, 16, 16, w - 32, h * 0.56 - 16, 9); g.stroke();
      g.font = `italic 900 ${h * 0.28}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffffff'; g.shadowBlur = 18; g.fillText(text, w / 2, h * 0.31); g.fillText(text, w / 2, h * 0.31);
      g.shadowBlur = 0;
    };
  }
  function artGantry(text, c1, c2) {
    return (g, w, h) => {
      const pw = w * 0.035;
      [w * 0.04, w * 0.96 - pw].forEach((x) => {
        g.fillStyle = '#e8e8ee'; g.fillRect(x, h * 0.12, pw, h * 0.88);
        g.fillStyle = c1; for (let i = 0; i < 8; i++) g.fillRect(x, h * 0.3 + i * h * 0.09, pw, h * 0.045);
        g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x + pw * 0.6, h * 0.12, pw * 0.4, h * 0.88);
      });
      const by = h * 0.04, bh = h * 0.24;
      rr(g, w * 0.02, by, w * 0.96, bh, 12); g.fillStyle = vgrad(g, by, by + bh, [shade(c2, 0.2), c2, shade(c2, -0.25)]); g.fill();
      const sq = bh * 0.16;
      for (let i = 0; i * sq < w * 0.92; i++) {
        g.fillStyle = i % 2 ? '#111' : '#fff'; g.fillRect(w * 0.04 + i * sq, by + 6, sq, sq);
        g.fillStyle = i % 2 ? '#fff' : '#111'; g.fillRect(w * 0.04 + i * sq, by + bh - 6 - sq, sq, sq);
      }
      g.font = `italic 900 ${bh * 0.46}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 8; g.strokeStyle = shade(c2, -0.45); g.strokeText(text, w / 2, by + bh / 2 + 2);
      g.fillStyle = '#fff'; g.fillText(text, w / 2, by + bh / 2 + 2);
    };
  }
  function starPath(g, x, y, ro, ri) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? ri : ro; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath();
  }
  function artCoin(g, w, h) {
    const r = w / 2 - 2;
    const gr = g.createRadialGradient(w * 0.38, h * 0.35, 2, w / 2, h / 2, r);
    gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.45, '#ffd23f'); gr.addColorStop(1, '#e09a00');
    circles(g, [[w / 2, h / 2, r]], '#b8790a');
    circles(g, [[w / 2, h / 2, r - 3]], gr);
    g.strokeStyle = 'rgba(160,100,0,.55)'; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, h / 2, r * 0.68, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#c98500'; starPath(g, w / 2, h / 2 + 1, r * 0.5, r * 0.22); g.fill();
    g.fillStyle = 'rgba(255,255,255,.7)'; ell(g, w * 0.36, h * 0.3, r * 0.22, r * 0.12); g.fill();
  }
  function artGlow(color) {
    return (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, color); gr.addColorStop(0.25, color.replace(/[\d.]+\)$/, '0.45)')); gr.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    };
  }

  // ----- Cars (seen from behind) -----
  function wheels(g, xs, y, ww, hh) { xs.forEach((x) => { rr(g, x, y, ww, hh, 8); g.fillStyle = '#18181c'; g.fill(); g.fillStyle = '#2c2c33'; g.fillRect(x + 4, y + 6, ww - 8, 4); }); }
  function tailLight(g, x, y, w, h, r) {
    rr(g, x, y, w, h, r); g.fillStyle = '#7a0000'; g.fill();
    rr(g, x + 2, y + 2, w - 4, h - 4, r); g.fillStyle = vgrad(g, y, y + h, ['#ff6a5a', '#e10f0f', '#a30000']); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x + 5, y + 3, w * 0.4, 2.5);
  }
  function artConvertible(color, turn) {
    return (g, w, h) => {
      const t = turn * 9, light = shade(color, 0.3), dark = shade(color, -0.4);
      g.fillStyle = 'rgba(0,0,0,.35)'; ell(g, w / 2, h - 9, w * 0.47, 10); g.fill();
      wheels(g, [16 - turn * 3, w - 62 - turn * 3], h - 60, 46, 52);
      // windshield and its frame (in front of the people, so drawn first)
      g.fillStyle = 'rgba(175,220,255,.55)'; g.beginPath(); g.moveTo(66 + t, 60); g.lineTo(86 + t * 1.4, 16); g.lineTo(w - 86 + t * 1.4, 16); g.lineTo(w - 66 + t, 60); g.closePath(); g.fill();
      g.strokeStyle = '#2a2a32'; g.lineWidth = 5; g.stroke();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(96 + t * 1.4, 22); g.lineTo(120 + t * 1.4, 22); g.lineTo(100 + t, 54); g.lineTo(78 + t, 54); g.closePath(); g.fill();
      // seats and heads
      rr(g, 76 + t, 40, 42, 34, 12); g.fillStyle = '#26262e'; g.fill();
      rr(g, w - 118 + t, 40, 42, 34, 12); g.fill();
      circles(g, [[97 + t * 1.2, 34, 17]], '#4a2c14');
      circles(g, [[93 + t * 1.2, 28, 7]], 'rgba(255,255,255,.15)');
      circles(g, [[w - 97 + t * 1.2, 35, 16]], '#f2c14e');
      circles(g, [[w - 97 + t * 1.2, 52, 8]], '#f2c14e');
      g.fillStyle = '#ff5fa2'; g.beginPath(); g.moveTo(w - 97 + t * 1.2, 20); g.lineTo(w - 110 + t * 1.2, 12); g.lineTo(w - 110 + t * 1.2, 26); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(w - 97 + t * 1.2, 20); g.lineTo(w - 84 + t * 1.2, 12); g.lineTo(w - 84 + t * 1.2, 26); g.closePath(); g.fill();
      // mirrors
      rr(g, 14 + t * 0.6, 50, 22, 14, 5); g.fillStyle = dark; g.fill(); rr(g, w - 36 + t * 0.6, 50, 22, 14, 5); g.fill();
      // rear deck
      g.fillStyle = vgrad(g, 56, 78, [light, color]); g.beginPath(); g.moveTo(12, 80); g.lineTo(30 + t * 0.6, 58); g.lineTo(w - 30 + t * 0.6, 58); g.lineTo(w - 12, 80); g.closePath(); g.fill();
      // body
      rr(g, 6, 70, w - 12, 76, 24); g.fillStyle = vgrad(g, 70, 146, [light, color, color, dark]); g.fill();
      g.fillStyle = 'rgba(255,255,255,.28)'; rr(g, 22, 74, w - 44, 6, 3); g.fill();
      tailLight(g, 18, 86, 56, 20, 7); tailLight(g, w - 74, 86, 56, 20, 7);
      g.fillStyle = '#ffb000'; rr(g, 78, 89, 12, 14, 3); g.fill(); rr(g, w - 90, 89, 12, 14, 3); g.fill();
      g.fillStyle = 'rgba(255,255,255,.65)'; g.fillRect(96, 100, w - 192, 3);
      rr(g, w / 2 - 26, 108, 52, 20, 4); g.fillStyle = '#ffd84d'; g.fill(); g.strokeStyle = '#7a5b00'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#3b2a00'; g.font = `800 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RUSH', w / 2, 119);
      rr(g, 12, 128, w - 24, 16, 8); g.fillStyle = '#26262c'; g.fill();
      circles(g, [[82, 138, 7], [w - 82, 138, 7]], '#9a9aa6'); circles(g, [[82, 138, 4], [w - 82, 138, 4]], '#2a2a2e');
    };
  }
  function artTraffic(type, color) {
    return (g, w, h) => {
      const light = shade(color, 0.3), dark = shade(color, -0.4);
      g.fillStyle = 'rgba(0,0,0,.33)'; ell(g, w / 2, h - 8, w * 0.46, 9); g.fill();
      if (type === 'van' || type === 'truck') {
        wheels(g, [20, w - 60], h - 50, 40, 44);
        const top = type === 'truck' ? 4 : 18;
        rr(g, 12, top, w - 24, h - top - 34, 14); g.fillStyle = type === 'truck' ? vgrad(g, top, h, ['#ffffff', '#f1f1f4', '#d6d6de']) : vgrad(g, top, h, [light, color, dark]); g.fill();
        if (type === 'truck') {
          g.fillStyle = color; g.fillRect(12, h * 0.42, w - 24, 22);
          g.fillStyle = '#fff'; g.font = `italic 900 17px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ICE CREAM', w / 2, h * 0.42 + 12);
          // cone
          const cx = w / 2, cy = h * 0.22;
          g.fillStyle = '#e8b06a'; g.beginPath(); g.moveTo(cx - 12, cy); g.lineTo(cx + 12, cy); g.lineTo(cx, cy + 26); g.closePath(); g.fill();
          circles(g, [[cx - 6, cy - 4, 10], [cx + 6, cy - 4, 10], [cx, cy - 13, 10]], '#ff9ec7');
          circles(g, [[cx, cy - 22, 4]], '#e53935');
          g.strokeStyle = '#c9c9d2'; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, h * 0.42 + 26); g.lineTo(w / 2, h - 38); g.stroke();
        } else {
          rr(g, 26, 28, w / 2 - 34, 44, 8); g.fillStyle = vgrad(g, 28, 72, ['#2a3a52', '#5d7c9c']); g.fill();
          rr(g, w / 2 + 8, 28, w / 2 - 34, 44, 8); g.fill();
          g.strokeStyle = shade(color, -0.3); g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, 24); g.lineTo(w / 2, h - 40); g.stroke();
          g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(32, 66); g.lineTo(50, 32); g.lineTo(62, 32); g.lineTo(44, 66); g.fill();
        }
        tailLight(g, 16, h - 88, 16, 34, 5); tailLight(g, w - 32, h - 88, 16, 34, 5);
        rr(g, w / 2 - 22, h - 66, 44, 16, 3); g.fillStyle = '#f5f5f7'; g.fill();
        rr(g, 14, h - 46, w - 28, 14, 7); g.fillStyle = '#2a2a30'; g.fill();
        return;
      }
      if (type === 'beetle') {
        wheels(g, [24, w - 62], h - 52, 38, 44);
        g.fillStyle = vgrad(g, 16, h - 30, [light, color, dark]);
        g.beginPath(); g.moveTo(16, h - 40); g.bezierCurveTo(10, 40, 50, 14, w / 2, 14); g.bezierCurveTo(w - 50, 14, w - 10, 40, w - 16, h - 40); g.closePath(); g.fill();
        rr(g, 64, 34, w - 128, 34, 16); g.fillStyle = vgrad(g, 34, 68, ['#2a3a52', '#6f8fb0']); g.fill();
        g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.moveTo(76, 62); g.lineTo(92, 38); g.lineTo(104, 38); g.lineTo(88, 62); g.fill();
        circles(g, [[40, h - 72, 12], [w - 40, h - 72, 12]], '#8a0000'); circles(g, [[40, h - 72, 9], [w - 40, h - 72, 9]], '#ff3030');
        rr(g, w / 2 - 22, h - 72, 44, 16, 3); g.fillStyle = '#f5f5f7'; g.fill();
        rr(g, 14, h - 46, w - 28, 12, 6); g.fillStyle = '#c9c9d2'; g.fill();
        return;
      }
      // sedan
      wheels(g, [20, w - 60], h - 50, 40, 44);
      g.fillStyle = vgrad(g, 24, 80, [light, color]); g.beginPath(); g.moveTo(42, 80); g.lineTo(64, 24); g.lineTo(w - 64, 24); g.lineTo(w - 42, 80); g.closePath(); g.fill();
      g.fillStyle = vgrad(g, 32, 74, ['#26354c', '#64839f']); g.beginPath(); g.moveTo(56, 74); g.lineTo(72, 32); g.lineTo(w - 72, 32); g.lineTo(w - 56, 74); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.moveTo(70, 72); g.lineTo(86, 34); g.lineTo(100, 34); g.lineTo(84, 72); g.fill();
      rr(g, 10, 72, w - 20, h - 104, 18); g.fillStyle = vgrad(g, 72, h - 32, [light, color, dark]); g.fill();
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(24, 78, w - 48, 4);
      tailLight(g, 18, 88, 48, 18, 6); tailLight(g, w - 66, 88, 48, 18, 6);
      rr(g, w / 2 - 22, 98, 44, 16, 3); g.fillStyle = '#f5f5f7'; g.fill();
      rr(g, 14, h - 46, w - 28, 14, 7); g.fillStyle = '#2a2a30'; g.fill();
    };
  }

  const CAR_TYPES = [
    { type: 'sedan', w: 860, lw: 240, lh: 170, lights: [[0.17, 0.57], [0.83, 0.57]] },
    { type: 'beetle', w: 800, lw: 220, lh: 160, lights: [[0.18, 0.55], [0.82, 0.55]] },
    { type: 'van', w: 940, lw: 240, lh: 200, lights: [[0.1, 0.52], [0.9, 0.52]] },
    { type: 'truck', w: 1040, lw: 240, lh: 230, lights: [[0.1, 0.55], [0.9, 0.55]] }
  ];
  const CAR_COLORS = ['#3b82f6', '#facc15', '#22c55e', '#a855f7', '#f97316', '#f1f5f9', '#ec4899', '#14b8a6'];
  const carCache = new Map();
  function carArt(ti, color) {
    const key = ti + color;
    let c = carCache.get(key);
    if (!c) { const T = CAR_TYPES[ti]; c = mk(T.lw, T.lh, 1.4, artTraffic(T.type, color)); carCache.set(key, c); }
    return c;
  }
  const PCAR = { lw: 260, lh: 170, lights: [[0.177, 0.565], [0.823, 0.565]] };
  const ghostCache = new Map();
  function ghostArt(color) {
    let c = ghostCache.get(color);
    if (!c) { c = mk(PCAR.lw, PCAR.lh, 1.2, artConvertible(color, 0)); ghostCache.set(color, c); }
    return c;
  }

  // Scenery sprite table: w/h are world size, hit = half-width that bumps you (0 = drive through).
  const SPR = {};
  function sprite(name, lw, lh, s, ww, hit, draw, ax) {
    const img = mk(lw, lh, s, draw);
    SPR[name] = { img, w: ww, h: ww * lh / lw, hit, ax: ax == null ? 0.5 : ax };
  }
  function buildArt() {
    artRnd = CG.rng(20240611);
    sprite('tree', 220, 270, 1.3, 1500, 220, artTree);
    sprite('pine', 170, 300, 1.3, 1050, 160, artPine);
    sprite('bush', 200, 130, 1.2, 900, 0, (g, w, h) => artBush(g, w, h, null));
    sprite('bushf', 200, 130, 1.2, 900, 0, (g, w, h) => artBush(g, w, h, '#ff6fa5'));
    sprite('flowers', 200, 80, 1.2, 800, 0, artFlowers);
    sprite('cow', 220, 160, 1.3, 1000, 380, artCow);
    sprite('bb1', 400, 260, 1.2, 2800, 1000, artBillboard('ROAD RUSH', '#e53935', '#fff'));
    sprite('bb2', 400, 260, 1.2, 2800, 1000, artBillboard('HAVE FUN!', '#1e88e5', '#ffd23f'));
    sprite('bb3', 400, 260, 1.2, 2800, 1000, artBillboard('CHOWANIEC', '#7c3aed', '#fff'));
    sprite('chevL', 120, 150, 1.4, 650, 90, artChevron(-1));
    sprite('chevR', 120, 150, 1.4, 650, 90, artChevron(1));
    sprite('palm', 240, 400, 1.2, 1700, 160, artPalm(false));
    sprite('palm2', 240, 400, 1.2, 1700, 160, artPalm(true));
    sprite('umbrella', 220, 200, 1.3, 1200, 90, artUmbrella);
    sprite('surf', 160, 220, 1.3, 800, 260, artSurf);
    sprite('hut', 320, 280, 1.2, 2000, 850, artHut);
    sprite('bb4', 400, 260, 1.2, 2800, 1000, artBillboard('SURF’S UP!', '#00acc1', '#fff'));
    sprite('bld1', 240, 520, 1.1, 2700, 1200, artBuilding('#3d4370', 9, 4, 'antenna'));
    sprite('bld2', 260, 400, 1.1, 2900, 1300, artBuilding('#5a3a6e', 6, 4, 'tank'));
    sprite('bld3', 240, 600, 1.1, 2600, 1200, artBuilding('#2f5068', 11, 3, 'antenna'));
    sprite('bld4', 260, 360, 1.1, 2900, 1300, artBuilding('#6a3550', 5, 5, null));
    sprite('lampL', 200, 420, 1.2, 1100, 70, artLamp(-1), 0.16);
    sprite('lampR', 200, 420, 1.2, 1100, 70, artLamp(1), 0.84);
    sprite('neon1', 300, 170, 1.2, 1800, 650, artNeon('PIZZA', '#ff3d8b'));
    sprite('neon2', 300, 170, 1.2, 1800, 650, artNeon('ARCADE', '#22d3ee'));
    sprite('neon3', 300, 170, 1.2, 1800, 650, artNeon('DINER', '#facc15'));
    sprite('neon4', 300, 170, 1.2, 1800, 650, artNeon('DISCO', '#a855f7'));
    sprite('cp', 600, 300, 1.4, ROAD * 2.7, 0, artGantry('CHECKPOINT', '#ff7a00', '#1e6fff'));
    sprite('start', 600, 300, 1.4, ROAD * 2.7, 0, artGantry('START', '#e53935', '#16a34a'));
    ART.coin = mk(64, 64, 1.5, artCoin);
    ART.glowRed = mk(64, 64, 1, artGlow('rgba(255,60,40,1)'));
    ART.glowWarm = mk(64, 64, 1, artGlow('rgba(255,210,120,1)'));
    ART.glowCyan = mk(64, 64, 1, artGlow('rgba(80,230,255,1)'));
    ART.player = [-1, 0, 1].map((t) => mk(PCAR.lw, PCAR.lh, 2, artConvertible('#e8192c', t)));
  }

  // ----- Backgrounds (sky gradient, clouds/stars, far and near parallax layers), rebuilt on resize -----
  const BG = [];
  function seamless(w, terms, rnd) {
    const ph = terms.map(() => rnd() * Math.PI * 2);
    return (x) => terms.reduce((s, [k, a], i) => s + a * Math.sin((x / w) * Math.PI * 2 * k + ph[i]), 0);
  }
  function buildBackgrounds() {
    const s = dpr, w = Math.max(900, Math.ceil(Wl * 1.2)), hy = L.hy;
    const rnd = CG.rng(777);
    BG.length = 0;
    ZONES.forEach((Z, zi) => {
      const b = { tw: w };
      const skyH = Math.ceil(hy);
      // clouds or stars
      b.sky = mk(w, skyH, s, (g) => {
        if (Z.night) {
          for (let i = 0; i < 140; i++) { const x = rnd() * w, y = rnd() * skyH * 0.85, r = rnd() < 0.1 ? 1.6 : 0.9; g.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.6})`; g.fillRect(x, y, r, r); }
          return;
        }
        const n = zi === 0 ? 7 : 4;
        for (let i = 0; i < n; i++) {
          const cx = (i + rnd() * 0.6) * w / n, cy = skyH * (0.12 + rnd() * 0.45), sc = 0.6 + rnd() * 0.8;
          [cx - w, cx, cx + w].forEach((x) => {
            const parts = [[0, 0, 26], [-30, 8, 20], [30, 8, 22], [-14, -12, 20], [16, -10, 18], [-52, 14, 13], [54, 14, 14]];
            circles(g, parts.map(([dx, dy, r]) => [x + dx * sc, cy + dy * sc + 4, r * sc]), 'rgba(170,200,230,.45)');
            circles(g, parts.map(([dx, dy, r]) => [x + dx * sc, cy + dy * sc, r * sc]), 'rgba(255,255,255,.95)');
          });
        }
      });
      // far layer
      const fh = Math.ceil(hy * 0.42);
      b.farH = fh;
      b.far = mk(w, fh, s, (g) => {
        if (Z.key === 'country') {
          const f1 = seamless(w, [[2, 0.35], [5, 0.2], [9, 0.12]], rnd), f2 = seamless(w, [[3, 0.3], [7, 0.15], [13, 0.07]], rnd);
          const range = (f, base, amp, cols) => { g.fillStyle = vgrad(g, 0, fh, cols); g.beginPath(); g.moveTo(0, fh); for (let x = 0; x <= w; x += 6) g.lineTo(x, fh * base - f(x) * fh * amp); g.lineTo(w, fh); g.closePath(); g.fill(); };
          range(f1, 0.45, 0.75, ['#ffffff', '#ffffff', '#b9d3ef', '#9cbde3', '#8fb2db']);
          range(f2, 0.72, 0.55, ['#e8f2fb', '#8ab3dc', '#6f9fcf', '#6a9acb']);
        } else if (Z.key === 'beach') {
          const seaTop = fh * 0.62;
          g.fillStyle = '#7fb9a0'; g.beginPath(); g.moveTo(w * 0.1, seaTop); g.quadraticCurveTo(w * 0.17, seaTop - fh * 0.25, w * 0.25, seaTop); g.fill();
          g.fillStyle = '#93c7b0'; g.beginPath(); g.moveTo(w * 0.58, seaTop); g.quadraticCurveTo(w * 0.62, seaTop - fh * 0.14, w * 0.7, seaTop); g.fill();
          g.fillStyle = vgrad(g, seaTop, fh, ['#6fd0f0', '#38aee0', '#2398d1']); g.fillRect(0, seaTop, w, fh - seaTop);
          for (let i = 0; i < 60; i++) { const y = seaTop + 3 + rnd() * (fh - seaTop - 4); g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.5})`; g.fillRect(rnd() * w, y, 6 + rnd() * 18 * (y - seaTop) / (fh - seaTop + 1), 1.5); }
          // sailboat
          const bx = w * 0.4, by = seaTop + 4;
          g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(bx, by - 26); g.lineTo(bx, by - 4); g.lineTo(bx + 16, by - 4); g.closePath(); g.fill();
          g.fillStyle = '#ff7a59'; g.beginPath(); g.moveTo(bx - 1, by - 22); g.lineTo(bx - 1, by - 4); g.lineTo(bx - 11, by - 4); g.closePath(); g.fill();
          g.fillStyle = '#5b3a1e'; g.fillRect(bx - 12, by - 3, 30, 4);
        } else {
          for (let x = -10; x < w;) {
            const bw = 20 + rnd() * 46, bh = fh * (0.25 + rnd() * 0.7);
            const xx = x;
            g.fillStyle = '#3b2b6e'; g.fillRect(xx, fh - bh, bw, bh);
            g.fillStyle = 'rgba(255,214,120,.55)';
            for (let yy = fh - bh + 6; yy < fh - 4; yy += 7) for (let wx = xx + 4; wx < xx + bw - 4; wx += 7) if (rnd() < 0.22) g.fillRect(wx, yy, 3, 3);
            if (rnd() < 0.25) { g.fillStyle = '#3b2b6e'; g.fillRect(xx + bw / 2 - 1, fh - bh - 14, 2, 14); g.fillStyle = '#ff4d4d'; g.fillRect(xx + bw / 2 - 2, fh - bh - 16, 4, 4); }
            x += bw + 2;
          }
        }
      });
      // near layer
      const nh = Math.ceil(hy * 0.3);
      b.nearH = nh;
      b.near = mk(w, nh, s, (g) => {
        if (Z.key === 'country') {
          const f = seamless(w, [[3, 0.3], [6, 0.18], [11, 0.08]], rnd);
          g.fillStyle = vgrad(g, 0, nh, ['#8ad662', '#62bc45', '#4fa83a']); g.beginPath(); g.moveTo(0, nh);
          const ys = []; for (let x = 0; x <= w; x += 4) { const y = nh * 0.55 - f(x) * nh * 0.8; ys.push([x, y]); g.lineTo(x, y); }
          g.lineTo(w, nh); g.closePath(); g.fill();
          for (let i = 0; i < ys.length; i += 7) { if (rnd() < 0.45) { const [x, y] = ys[i]; g.fillStyle = '#5a3a1e'; g.fillRect(x - 1, y - 6, 2, 7); circles(g, [[x, y - 9, 4.5 + rnd() * 2]], rnd() < 0.5 ? '#2f8a3a' : '#3c9c44'); } }
        } else if (Z.key === 'beach') {
          const f = seamless(w, [[2, 1], [5, 0.4]], rnd);
          g.fillStyle = '#f3d99b';
          g.beginPath(); g.moveTo(0, nh);
          for (let x = 0; x <= w; x += 4) g.lineTo(x, nh - Math.max(0, f(x) - 0.35) * nh * 0.45);
          g.lineTo(w, nh); g.closePath(); g.fill();
          for (let x = 0; x < w; x += 24) {
            const v = f(x) - 0.35;
            if (v > 0.25 && rnd() < 0.35) {
              const y = nh - v * nh * 0.45, hh = 16 + rnd() * 10;
              g.strokeStyle = '#7a5530'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 4, y - hh / 2, x + 2, y - hh); g.stroke();
              g.strokeStyle = '#2f8f45'; g.lineWidth = 3; [-1, -0.4, 0.4, 1].forEach((d) => { g.beginPath(); g.moveTo(x + 2, y - hh); g.quadraticCurveTo(x + 2 + d * 7, y - hh - 6, x + 2 + d * 12, y - hh + 3); g.stroke(); });
            }
          }
        } else {
          for (let x = -10; x < w;) {
            const bw = 26 + rnd() * 50, bh = nh * (0.3 + rnd() * 0.65);
            g.fillStyle = '#1d1636'; g.fillRect(x, nh - bh, bw, bh);
            for (let yy = nh - bh + 5; yy < nh - 3; yy += 6) for (let wx = x + 3; wx < x + bw - 3; wx += 6) if (rnd() < 0.4) { g.fillStyle = rnd() < 0.85 ? 'rgba(255,214,110,.85)' : 'rgba(140,240,255,.85)'; g.fillRect(wx, yy, 3, 3); }
            if (rnd() < 0.3) { g.fillStyle = rnd() < 0.5 ? '#ff3d8b' : '#22d3ee'; g.fillRect(x, nh - bh, bw, 2); }
            x += bw + 3;
          }
        }
      });
      BG.push(b);
    });
    // sun / moon
    ART.sun = mk(220, 220, s, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 10, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.22, 'rgba(255,240,170,1)'); gr.addColorStop(0.3, 'rgba(255,230,140,.45)'); gr.addColorStop(1, 'rgba(255,220,120,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    ART.moon = mk(160, 160, s, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 10, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
      circles(g, [[w / 2, w / 2, 26]], '#f6f1dc');
      circles(g, [[w / 2 - 8, w / 2 - 6, 6], [w / 2 + 9, w / 2 + 6, 4], [w / 2 + 2, w / 2 - 13, 3]], 'rgba(200,190,160,.6)');
    });
  }

  // ---------- Track (generated lazily, deterministically from the seed) ----------
  let T = null;
  function newTrack(seed) {
    T = { seed, rnd: CG.rng(seed), segs: [], cars: [], lastY: 0, cps: [], coinRun: null, lastBoost: 0, piece: 0 };
    // checkpoints: the first after 1400 segments, then each gap 130 segments longer than the one before
    for (let k = 0, at = 1400, gap = 1000; k < 200; k++, at += gap, gap += 130) T.cps.push(at);
    T.cpSet = new Set(T.cps);
    addRoad(0, START_SEG + 70, 0, 0, 0);
  }
  function ensure(n) { while (T.segs.length < n) addPiece(); }

  function addPiece() {
    const R = T.rnd, i = T.segs.length, D = clamp(i / 9000, 0, 1);
    const len = (a, b) => Math.round(a + R() * (b - a));
    const hill = (scale) => {
      let h = (R() * 2 - 1) * scale;
      if (T.lastY > 30 * SEG) h = -Math.abs(h); else if (T.lastY < -30 * SEG) h = Math.abs(h);
      return h;
    };
    const dir = R() < 0.5 ? -1 : 1;
    const r = R();
    T.piece++;
    if (r < 0.16) addRoad(len(10, 25), len(20, 60), len(10, 25), 0, R() < 0.5 ? hill(12 + 22 * D) : 0);
    else if (r < 0.52) addRoad(len(15, 35), len(20, 60), len(15, 35), dir * (1.6 + R() * (2.2 + 3.4 * D)), R() < 0.45 ? hill(10 + 25 * D) : 0);
    else if (r < 0.72) {
      const c = 1.5 + R() * (2 + 3 * D), e = len(15, 30), h = len(15, 40);
      addRoad(e, h, e, dir * c, hill(8 + 15 * D));
      addRoad(e, h, e, -dir * c, hill(8 + 15 * D));
    } else {
      const n = 1 + Math.floor(R() * 3);
      for (let k = 0; k < n; k++) addRoad(len(15, 30), len(10, 30), len(15, 30), R() < 0.4 ? dir * (1 + R() * 2) : 0, hill(15 + 28 * D));
    }
  }

  function addRoad(enter, hold, leave, curve, hillH) {
    const startY = T.lastY, endY = startY + hillH * SEG, total = enter + hold + leave;
    const first = T.segs.length;
    for (let n = 0; n < enter; n++) addSeg(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    for (let n = 0; n < hold; n++) addSeg(curve, easeInOut(startY, endY, (enter + n) / total));
    for (let n = 0; n < leave; n++) addSeg(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
    // Warning chevrons on the outside of sharper bends
    if (Math.abs(curve) >= 3) {
      const side = curve > 0 ? -1 : 1, name = curve > 0 ? 'chevR' : 'chevL';
      for (let k = 0; k < 4; k++) { const s = T.segs[first + k * 5]; if (s && !s.cp) s.sprites.push({ s: SPR[name], x: side * 1.32 }); }
    }
  }

  function addSeg(curve, y) {
    const R = T.rnd, i = T.segs.length, Z = zoneAt(i), D = clamp(i / 9000, 0, 1);
    const alt = Math.floor(i / RUMBLE) % 2;
    const pick = (key) => (Z.t ? mixRgb(ZONES[Z.a][key][alt], ZONES[Z.b][key][alt], Z.t) : ZONES[Z.b][key][alt]);
    const s = {
      i, curve, y1: T.lastY, y2: y,
      grass: pick('grass'), road: pick('road'), rumble: pick('rumble'),
      lane: alt ? null : (Z.t ? mixRgb(ZONES[Z.a].lane, ZONES[Z.b].lane, Z.t) : ZONES[Z.b].lane),
      fog: Z.t ? mixRgb(ZONES[Z.a].fog, ZONES[Z.b].fog, Z.t) : ZONES[Z.b].fog,
      night: lerp(ZONES[Z.a].night, ZONES[Z.b].night, Z.t),
      sprites: [], coins: null, boost: null, check: false, cp: false
    };
    T.lastY = y;
    T.segs.push(s);

    // start line, checkpoints
    if (i === START_SEG + 3) { s.sprites.push({ s: SPR.start, x: 0 }); s.check = true; }
    if (i === START_SEG + 4) s.check = true;
    if (T.cpSet.has(i)) { s.cp = true; s.check = true; s.sprites.push({ s: SPR.cp, x: 0 }); }
    if (T.cpSet.has(i - 1)) s.check = true;

    // scenery
    const zk = (Z.t && R() < Z.t) || !Z.t ? ZONES[Z.b].key : ZONES[Z.a].key;
    const nearCp = s.cp || s.check;
    const side = () => (R() < 0.5 ? -1 : 1);
    if (zk === 'country') {
      for (const sd of [-1, 1]) {
        if (R() < 0.3) { const q = R(); s.sprites.push({ s: SPR[q < 0.45 ? 'tree' : q < 0.7 ? 'pine' : q < 0.88 ? 'bush' : 'bushf'], x: sd * (1.45 + R() * 2.2) }); }
        if (R() < 0.05) s.sprites.push({ s: SPR.flowers, x: sd * (1.2 + R() * 0.2) });
      }
      if (R() < 0.006) s.sprites.push({ s: SPR.cow, x: side() * (2.1 + R() * 1.2) });
      if (R() < 0.006 && !nearCp) s.sprites.push({ s: SPR[['bb1', 'bb2', 'bb3'][Math.floor(R() * 3)]], x: side() * 2.1 });
    } else if (zk === 'beach') {
      for (const sd of [-1, 1]) {
        if (R() < 0.17) s.sprites.push({ s: SPR[R() < 0.5 ? 'palm' : 'palm2'], x: sd * (1.4 + R() * 2.2) });
        if (R() < 0.03) s.sprites.push({ s: SPR.umbrella, x: sd * (1.9 + R() * 1.6) });
      }
      if (R() < 0.012) s.sprites.push({ s: SPR.surf, x: side() * (1.5 + R() * 0.8) });
      if (R() < 0.006) s.sprites.push({ s: SPR.hut, x: side() * 2.6 });
      if (R() < 0.004 && !nearCp) s.sprites.push({ s: SPR[R() < 0.5 ? 'bb4' : 'bb2'], x: side() * 2.1 });
    } else {
      if (i % 7 === 0) for (const sd of [-1, 1]) s.sprites.push({ s: SPR[['bld1', 'bld2', 'bld3', 'bld4'][Math.floor(R() * 4)]], x: sd * (2.35 + R() * 0.5) });
      if (i % 12 === 0) { s.sprites.push({ s: SPR.lampL, x: -1.22 }); s.sprites.push({ s: SPR.lampR, x: 1.22 }); }
      if (i % 7 === 3 && R() < 0.12 && !nearCp) s.sprites.push({ s: SPR[['neon1', 'neon2', 'neon3', 'neon4'][Math.floor(R() * 4)]], x: side() * 1.75 });
    }

    // coins
    if (i > START_SEG + 40) {
      const run = T.coinRun;
      if (run) {
        if ((i - run.start) % 5 === 0) {
          const k = (i - run.start) / 5;
          const x = run.weave ? Math.sin(k * 0.55 + run.ph) * 0.66 : run.x;
          (s.coins = s.coins || []).push({ x, taken: false, ph: k });
          if (k + 1 >= run.n) T.coinRun = null;
        }
      } else if (R() < 0.014) {
        T.coinRun = { start: i, n: 6 + Math.floor(R() * 6), x: LANES[Math.floor(R() * 3)], weave: R() < 0.35, ph: R() * 6 };
      }
      // boost pads now and then
      if (i - T.lastBoost > 260 && i > START_SEG + 160 && R() < 0.005) {
        T.lastBoost = i;
        T.boostLeft = 8; T.boostX = LANES[Math.floor(R() * 3)];
      }
      if (T.boostLeft > 0) { s.boost = T.boostX; T.boostLeft--; if (!T.boostLeft && !T.coinRun) T.coinRun = { start: i + 3, n: 8, x: T.boostX, weave: false, ph: 0 }; }
    }

    // traffic (each car: z = z0 + v·t, so every player meets the same cars)
    if (i > START_SEG + 50 && R() < 0.028 + 0.04 * D) {
      const lane = Math.floor(R() * 3);
      const ti = (() => { const q = R(); return q < 0.5 ? 0 : q < 0.72 ? 1 : q < 0.9 ? 2 : 3; })();
      const color = CAR_COLORS[Math.floor(R() * CAR_COLORS.length)];
      T.cars.push({ z0: i * SEG + R() * SEG, x: LANES[lane] + (R() - 0.5) * 0.08, v: MAXS * LANE_SPEED[lane], ti, color, z: 0, bumped: false, passed: false, wob: 0 });
    }
  }

  // ---------- Game state ----------
  let root, cvs, ctx, Wl = 1, Hl = 1, dpr = 1;
  const L = { hy: 0, r: 0, H: 1000, d: 850, f: 300, cx: 0, carY: 0 };
  let state = 'title';           // title | play | over | done
  let paused = false, multi = false;
  let pos = START_POS, speed = 0, px = 0, time = START_TIME, raceT = 0, coins = 0, overtakes = 0;
  let boostT = 0, shake = 0, bumpCool = 0, overT = 0, lastTick = 0, zoneK = 0, cpIdx = 0, steerVis = 0;
  let skyOff = 0, farOff = 0, nearOff = 0;
  const keys = { left: false, right: false, up: false, down: false };
  const touches = new Map();
  const msgs = [], parts = [];
  const ghosts = new Map();
  let overlay, pauseEl, hintsShown = false;

  function score() { return Math.max(0, Math.floor((pos - START_POS) / 100)) + coins * 50 + overtakes * 10; }

  function resetRun(seed, isMulti) {
    newTrack(seed);
    multi = !!isMulti;
    pos = START_POS; speed = 0; px = 0; time = START_TIME; raceT = 0; coins = 0; overtakes = 0;
    boostT = 0; shake = 0; bumpCool = 0; overT = 0; lastTick = 0; zoneK = 0; cpIdx = 0; steerVis = 0;
    msgs.length = 0; parts.length = 0; ghosts.clear(); touches.clear();
    keys.left = keys.right = keys.up = keys.down = false;
    ensure(START_SEG + DRAW + 40);
  }
  function startRun(seed, isMulti) {
    resetRun(seed, isMulti);
    state = 'play'; paused = false;
    showOverlay(false); showPause(false);
    ensureAudio();
    pushMsg('GO!', '#ffd23f', 1.4);
    if (!isMulti) CG.sfx('go');
  }
  function startSolo() { if (CG.isMulti()) return; startRun(Math.floor(Math.random() * 2 ** 31), false); }
  function toTitle() {
    state = 'title'; paused = false; multi = false;
    showPause(false); showOverlay(true);
  }

  function pushMsg(text, color, size, life) { const used = new Set(msgs.filter((m) => !m.small).map((m) => m.slot)); let slot = 0; while (used.has(slot)) slot++; msgs.push({ slot, text, color: color || '#fff', size: size || 1, t: 0, life: life || 1.6 }); if (msgs.length > 4) msgs.shift(); }
  function burst(x, y, n, kind) {
    for (let k = 0; k < n && parts.length < 140; k++) {
      const a = Math.random() * Math.PI * 2, sp = kind === 'smoke' ? 40 + Math.random() * 60 : 90 + Math.random() * 160;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'smoke' ? 30 : 60), t: 0, life: kind === 'smoke' ? 0.7 : 0.55, kind, r: kind === 'smoke' ? 8 + Math.random() * 8 : 3 + Math.random() * 3 });
    }
  }

  // ---------- Update ----------
  function segAt(z) { return T.segs[Math.floor(z / SEG)]; }

  function steerInput() {
    let l = keys.left, r = keys.right, brake = keys.down;
    let tl = false, tr = false;
    touches.forEach((side) => { if (side < 0) tl = true; else tr = true; });
    if (tl && tr) brake = true; else { l = l || tl; r = r || tr; }
    return { steer: (r ? 1 : 0) - (l ? 1 : 0), brake };
  }

  function update(dt) {
    const playing = state === 'play';
    const attract = state === 'title';
    const inp = playing ? steerInput() : { steer: 0, brake: false };
    raceT += dt;
    ensure(Math.floor(pos / SEG) + DRAW + 60);
    const seg = segAt(pos);
    const pct = speed / MAXS;

    // speed
    if (attract) speed = lerp(speed, MAXS * 0.55, dt * 1.5);
    else if (!playing) speed = Math.max(0, speed + BRAKE * 0.6 * dt);
    else {
      if (boostT > 0) { boostT -= dt; speed = Math.min(BOOST_MAX, speed + ACCEL * 2.5 * dt); }
      else if (inp.brake) speed += BRAKE * dt;
      else if (speed < MAXS) speed += ACCEL * (keys.up ? 1.15 : 1) * dt;
      else speed += COAST * dt;
      if ((px < -1 || px > 1) && speed > OFF_LIMIT) speed += OFF_DECEL * dt;
      speed = clamp(speed, 0, BOOST_MAX);
    }
    const prevPos = pos;
    pos += speed * dt;

    // steering and centrifugal drift
    const dx = dt * 2.1 * Math.min(1, pct + 0.15);
    if (attract) px = lerp(px, Math.sin(raceT * 0.3) * 0.3, dt * 2);
    else {
      px += dx * inp.steer;
      px -= dx * Math.min(pct, 1.1) * seg.curve * CENTRIFUGAL;
      px = clamp(px, -2.6, 2.6);
    }
    steerVis = lerp(steerVis, inp.steer, dt * 10);

    // background parallax
    const adv = (pos - prevPos) / SEG;
    skyOff += 0.0006 * seg.curve * adv; farOff += 0.0012 * seg.curve * adv; nearOff += 0.0024 * seg.curve * adv;

    // traffic
    const cars = T.cars;
    for (let k = cars.length - 1; k >= 0; k--) {
      const c = cars[k];
      c.z = c.z0 + c.v * raceT;
      if (c.wob > 0) c.wob = Math.max(0, c.wob - dt * 2);
      if (c.z < pos - 40 * SEG) { cars.splice(k, 1); continue; }
      if (attract) continue;
      const cw = CAR_TYPES[c.ti].w;
      const gap = c.z - pos;
      if (playing && gap > -CAR_LEN * 0.6 && gap < CAR_LEN && speed > c.v && Math.abs(px - c.x) * ROAD < (CAR_W + cw) * 0.5 * 0.78) {
        // bump!
        c.bumped = true; c.wob = 1;
        pos = c.z - CAR_LEN - 1;
        speed = c.v * 0.55;
        px += (px >= c.x ? 1 : -1) * 0.14;
        bump();
      }
      if (!c.passed && c.z < pos - CAR_LEN * 0.8 && c.z > pos - 6 * SEG) {
        c.passed = true;
        if (playing && !c.bumped) { overtakes++; CG.sfx('point'); }
      }
    }

    if (playing) {
      // coins
      const si = Math.floor(pos / SEG);
      for (let k = si - 1; k <= si + 1; k++) {
        const s = T.segs[k];
        if (!s || !s.coins) continue;
        for (const c of s.coins) {
          if (c.taken) continue;
          if (Math.abs(k * SEG - pos) < 260 && Math.abs(c.x - px) * ROAD < 620) {
            c.taken = true; coins++;
            CG.sfx('coin');
            burst(L.cx + (c.x - px) * ROAD * L.r, L.carY - 60, 10, 'spark');
            msgs.push({ text: '+50', color: '#ffd23f', size: 0.6, t: 0, life: 0.7, small: true, x: L.cx + (c.x - px) * ROAD * L.r });
          }
        }
      }
      // boost pad
      if (seg.boost != null && Math.abs(seg.boost - px) < 0.36) {
        if (boostT < 1.5) { CG.sfx('whoosh'); if (boostT <= 0) pushMsg('BOOST!', '#22d3ee', 1.1, 1); }
        boostT = 2.6;
      }
      // roadside objects
      bumpCool -= dt;
      if (Math.abs(px) > 1 && bumpCool <= 0) {
        for (let k = Math.floor(pos / SEG); k <= Math.floor(pos / SEG) + 1; k++) {
          const s = T.segs[k];
          for (const sp of s.sprites) {
            if (!sp.s.hit) continue;
            if (Math.abs(sp.x - px) * ROAD < CAR_W * 0.4 + sp.s.hit) {
              speed = Math.min(speed, MAXS * 0.22);
              px += px > 0 ? -0.25 : 0.25;
              bump();
              break;
            }
          }
        }
      }
      if ((px < -1 || px > 1) && speed > 1000 && Math.random() < 0.5) parts.push({ x: L.cx + (Math.random() - 0.5) * CAR_W * L.r, y: L.carY - 4, vx: (Math.random() - 0.5) * 80, vy: -40 - Math.random() * 50, t: 0, life: 0.6, kind: 'dust', r: 5 + Math.random() * 6 });
      // checkpoints
      if (cpIdx < T.cps.length && pos >= T.cps[cpIdx] * SEG) {
        cpIdx++;
        time += CP_BONUS;
        pushMsg('+15s CHECKPOINT!', '#7cff6b', 1.15, 2);
        CG.sfx('match');
      }
      // zones
      const z = zoneAt(Math.floor(pos / SEG));
      if (z.k !== zoneK && z.t > 0.4) { zoneK = z.k; pushMsg(ZONES[z.b].name.toUpperCase(), '#ffffff', 0.9, 2.2); }
      // time
      time -= dt;
      if (time <= 10 && time > 0 && Math.ceil(time) !== lastTick) { lastTick = Math.ceil(time); CG.sfx('tick'); }
      if (time <= 0) { time = 0; state = 'over'; overT = 0; pushMsg('TIME UP!', '#ff5252', 1.4, 3); CG.sfx('lose'); }
      if (multi) CG.race.update({ score: score(), alive: true, z: Math.round(pos), x: Math.round(px * 100) / 100, speed: Math.round(speed) });
    } else if (state === 'over') {
      overT += dt;
      if (overT > 1.6 && speed < 50) finish();
    }
    if (shake > 0) shake = Math.max(0, shake - dt);
    if (boostT > 0 && playing && Math.random() < 0.7) parts.push({ x: L.cx + (Math.random() - 0.5) * CAR_W * L.r * 0.5, y: L.carY - 20, vx: (Math.random() - 0.5) * 60, vy: 80 + Math.random() * 60, t: 0, life: 0.4, kind: 'boost', r: 3 + Math.random() * 3 });
  }

  function bump() {
    shake = 0.4; bumpCool = 0.5;
    CG.sfx('hit');
    burst(L.cx, L.carY - 50, 8, 'smoke');
    if (navigator.vibrate) try { navigator.vibrate(40); } catch (e) { /* ignore */ }
  }

  function finish() {
    if (state !== 'over') return;
    const sc = score();
    if (multi) {
      state = 'done';
      CG.race.update({ score: sc, alive: false, z: Math.round(pos), x: px, speed: 0 });
      CG.gameOver({ score: sc });
    } else {
      state = 'title';
      showOverlay(true);
      CG.gameOver({ score: sc, title: 'Time up!', again: startSolo });
    }
  }

  // ---------- Render ----------
  const N = DRAW + 2;
  const PX = new Float64Array(N), PY = new Float64Array(N), PS = new Float64Array(N), XW = new Float64Array(N);
  const buckets = []; for (let n = 0; n < N; n++) buckets.push([]);

  function poly(x1, y1, x2, y2, x3, y3, x4, y4) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill(); }

  function drawBackground(zone) {
    const hy = L.hy;
    const drawZone = (zi, alpha) => {
      const Z = ZONES[zi], b = BG[zi];
      if (!b) return;
      ctx.globalAlpha = alpha;
      const gr = ctx.createLinearGradient(0, 0, 0, hy);
      gr.addColorStop(0, Z.sky[0]); gr.addColorStop(0.55, Z.sky[1]); gr.addColorStop(1, Z.sky[2]);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, Wl, hy + 2);
      if (Z.night) ctx.drawImage(ART.moon, Wl * 0.74 - 80, hy * 0.18 - 80 + 40, 160, 160);
      else ctx.drawImage(ART.sun, (zi === 1 ? Wl * 0.3 : Wl * 0.72) - 110, hy * (zi === 1 ? 0.5 : 0.3) - 110, 220, 220);
      tile(b.sky, b.tw, skyOff, 0, Math.ceil(hy));
      tile(b.far, b.tw, farOff, hy - b.farH + 1, b.farH);
      tile(b.near, b.tw, nearOff, hy - b.nearH + 2, b.nearH);
      ctx.fillStyle = Z.ground; ctx.fillRect(0, hy + 1, Wl, Hl - hy);
    };
    drawZone(zone.a, 1);
    if (zone.t > 0 && zone.a !== zone.b) drawZone(zone.b, zone.t);
    ctx.globalAlpha = 1;
  }
  function tile(img, tw, off, y, h) {
    let x = -(((off % 1) + 1) % 1) * tw;
    for (; x < Wl; x += tw) ctx.drawImage(img, x, y, tw, h);
  }

  function render() {
    const segs = T.segs;
    const camZ = pos - L.d;
    const baseI = Math.max(0, Math.floor(camZ / SEG));
    ensure(baseI + N + 2);
    const pSeg = segAt(pos);
    const pPct = (pos % SEG) / SEG;
    const playerY = lerp(pSeg.y1, pSeg.y2, pPct);
    const camY = playerY + L.H;
    const camX = px * ROAD;
    const f = L.f, cx = L.cx, hy = L.hy;
    const zone = zoneAt(pSeg.i);

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 14 * shake, (Math.random() - 0.5) * 10 * shake);
    drawBackground(zone);

    // project
    let x = 0, dx = -(segs[baseI].curve * ((camZ - baseI * SEG) / SEG));
    for (let n = 0; n < N; n++) {
      const s = segs[baseI + n];
      const cz = (baseI + n) * SEG - camZ;
      XW[n] = x - camX;
      if (cz > 20) { const sc = f / cz; PS[n] = sc; PX[n] = cx + sc * XW[n]; PY[n] = hy - sc * (s.y1 - camY); } else PS[n] = 0;
      x += dx; dx += s.curve;
      buckets[n].length = 0;
    }
    // bucket traffic and ghosts by segment
    const maxZ = (baseI + N - 1) * SEG;
    for (const c of T.cars) { if (c.z > camZ + 40 && c.z < maxZ) buckets[Math.floor(c.z / SEG) - baseI].push(c); }
    const others = multi || CG.isMulti() ? CG.race.others() : [];
    const gl = [];
    if (others.length) {
      const now = performance.now();
      for (const o of others) {
        const st = o.state || {};
        if (typeof st.z !== 'number') continue;
        let g = ghosts.get(o.name);
        const target = st.z + (st.alive === false ? 0 : (st.speed || 0) * Math.min(o.age, 1500) / 1000);
        if (!g || Math.abs(g.z - target) > 8000) { g = { z: target, x: st.x || 0, t: now }; ghosts.set(o.name, g); }
        const gdt = Math.min(0.1, (now - g.t) / 1000); g.t = now;
        if (st.alive !== false) g.z += (st.speed || 0) * gdt;
        g.z += (target - g.z) * Math.min(1, gdt * 3);
        g.x += ((st.x || 0) - g.x) * Math.min(1, gdt * 5);
        if (g.z > camZ + 60 && g.z < maxZ) { const item = { ghost: true, z: g.z, x: g.x, name: o.name, color: o.color }; buckets[Math.floor(g.z / SEG) - baseI].push(item); gl.push(item); }
      }
    }

    const fogStart = N * 0.45;
    const pN = Math.floor(pos / SEG) - baseI;
    const t = raceT;
    for (let n = N - 2; n >= 0; n--) {
      const sc1 = PS[n], sc2 = PS[n + 1];
      if (!sc1) { if (n === pN) drawPlayer(); continue; }
      const s = segs[baseI + n];
      const x1 = PX[n], y1 = PY[n], w1 = sc1 * ROAD, x2 = PX[n + 1], y2 = PY[n + 1], w2 = sc2 * ROAD;
      const fog = n > fogStart ? Math.min(1, (n - fogStart) / (N - fogStart)) ** 1.6 : 0;
      if (y2 < y1 && y2 < Hl && y1 > 0) {
        const top = Math.floor(y2), hh = Math.ceil(y1) - top + 1;
        const yo = y2 - 0.8; // overlap the farther strip a little so no seams show
        ctx.fillStyle = s.grass; ctx.fillRect(0, top, Wl, hh);
        const r1 = w1 / 7, r2 = w2 / 7;
        ctx.fillStyle = s.rumble;
        poly(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, yo, x2 - w2 - r2, yo);
        poly(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, yo, x2 + w2 + r2, yo);
        ctx.fillStyle = s.road;
        poly(x1 - w1, y1, x1 + w1, y1, x2 + w2, yo, x2 - w2, yo);
        if (s.check) {
          const cells = 10;
          for (let c = 0; c < cells; c++) {
            if ((c + s.i) % 2) continue;
            const a = -1 + (2 * c) / cells, b = a + 2 / cells;
            ctx.fillStyle = '#ffffff';
            poly(x1 + a * w1, y1, x1 + b * w1, y1, x2 + b * w2, yo, x2 + a * w2, yo);
          }
          ctx.fillStyle = 'rgba(20,20,20,.55)';
          for (let c = 0; c < cells; c++) {
            if (!((c + s.i) % 2)) continue;
            const a = -1 + (2 * c) / cells, b = a + 2 / cells;
            poly(x1 + a * w1, y1, x1 + b * w1, y1, x2 + b * w2, yo, x2 + a * w2, yo);
          }
        } else if (s.lane && w1 > 24) {
          const l1 = w1 / 30, l2 = w2 / 30;
          ctx.fillStyle = s.lane;
          for (const k of [-1 / 3, 1 / 3]) poly(x1 + k * 2 * w1 - l1 / 2, y1, x1 + k * 2 * w1 + l1 / 2, y1, x2 + k * 2 * w2 + l2 / 2, yo, x2 + k * 2 * w2 - l2 / 2, yo);
        }
        if (s.boost != null) {
          const bx1 = x1 + s.boost * w1, bx2 = x2 + s.boost * w2, pw1 = w1 * 0.27, pw2 = w2 * 0.27;
          ctx.fillStyle = '#1d4ed8';
          poly(bx1 - pw1, y1, bx1 + pw1, y1, bx2 + pw2, yo, bx2 - pw2, yo);
          ctx.fillStyle = s.i % 2 ? '#22d3ee' : '#a5f3fc';
          poly(bx1 - pw1 * 0.86, y1, bx1 + pw1 * 0.86, y1, bx2 + pw2 * 0.86, yo, bx2 - pw2 * 0.86, yo);
          if (s.i % 2) { ctx.fillStyle = '#ffffff'; poly(bx1 - pw1 * 0.7, y1, bx2, yo, bx1 + pw1 * 0.7, y1, bx1, y1 - (y1 - yo) * 0.45); }
        }
        if (fog > 0.02) { ctx.globalAlpha = fog; ctx.fillStyle = s.fog; ctx.fillRect(0, top, Wl, hh); ctx.globalAlpha = 1; }
      }
      const sAlpha = 1 - fog;
      if (sAlpha < 0.03) continue;
      if (sAlpha < 0.98) ctx.globalAlpha = sAlpha;
      // scenery
      for (const sp of s.sprites) {
        const S = sp.s, sw = S.w * sc1, sh = S.h * sc1;
        const sx = cx + sc1 * (XW[n] + sp.x * ROAD) - sw * S.ax, sy = y1 - sh;
        if (sx > Wl || sx + sw < 0 || sy > Hl || sw < 1.2) continue;
        ctx.drawImage(S.img, sx, sy, sw, sh);
      }
      // coins
      if (s.coins) {
        for (const c of s.coins) {
          if (c.taken) continue;
          const cs = 420 * sc1;
          if (cs < 1.5) continue;
          const spin = Math.abs(Math.cos(t * 4 + c.ph * 0.7)) * 0.85 + 0.15;
          const ccx = cx + sc1 * (XW[n] + c.x * ROAD), ccy = y1 - sc1 * (300 + Math.sin(t * 5 + c.ph) * 40);
          ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(ccx, y1 - 1, cs * 0.35, cs * 0.08, 0, 0, Math.PI * 2); ctx.fill();
          ctx.drawImage(ART.coin, ccx - cs * spin / 2, ccy - cs / 2, cs * spin, cs);
        }
      }
      // cars and ghosts on this segment
      const bk = buckets[n];
      if (bk.length > 1) bk.sort((a, b) => b.z - a.z);
      for (const c of bk) drawCarItem(c, n, baseI, camZ, camY, s);
      if (sAlpha < 0.98) ctx.globalAlpha = 1;
      if (n === pN) drawPlayer();
    }
    ctx.globalAlpha = 1;
    // ghost name labels on top so they stay readable
    for (const g of gl) if (g.lx != null) label(g);

    drawParticles();
    if (boostT > 0 && state === 'play') speedLines();
    ctx.restore();
    drawHud();
  }

  function drawCarItem(c, n, baseI, camZ, camY, s) {
    const pct = (c.z - (baseI + n) * SEG) / SEG;
    const cz = c.z - camZ;
    if (cz < 40) return;
    const sc = L.f / cz;
    const xw = lerp(XW[n], XW[n + 1], pct) + c.x * ROAD + (c.wob ? Math.sin(c.wob * 30) * 60 * c.wob : 0);
    const yw = lerp(s.y1, s.y2, pct) - camY;
    const sx = L.cx + sc * xw, sy = L.hy - sc * yw;
    if (c.ghost) {
      const img = ghostArt(c.color);
      const w = CAR_W * sc, h = w * PCAR.lh / PCAR.lw;
      c.lx = null;
      if (sx + w / 2 < 0 || sx - w / 2 > Wl || w < 2) return;
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * 0.5;
      ctx.drawImage(img, sx - w / 2, sy - h, w, h);
      ctx.globalAlpha = a;
      c.lx = sx; c.ly = sy - h - 4; c.ls = w;
      return;
    }
    const TY = CAR_TYPES[c.ti];
    const w = TY.w * sc, h = w * TY.lh / TY.lw;
    if (sx + w / 2 < 0 || sx - w / 2 > Wl || w < 1.5) return;
    ctx.drawImage(carArt(c.ti, c.color), sx - w / 2, sy - h, w, h);
    if (s.night > 0.3 && w > 6) lights(TY.lights, sx - w / 2, sy - h, w, h, s.night * 0.9, false);
  }
  function lights(pts, x, y, w, h, a, strong) {
    const prevOp = ctx.globalCompositeOperation, prevA = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = prevA * a;
    const r = w * (strong ? 0.42 : 0.32);
    for (const [fx, fy] of pts) ctx.drawImage(ART.glowRed, x + fx * w - r / 2, y + fy * h - r / 2, r, r);
    ctx.globalCompositeOperation = prevOp; ctx.globalAlpha = prevA;
  }
  function label(g) {
    const fs = clamp(g.ls * 0.16, 11, 15);
    ctx.font = `700 ${fs}px ${FONT}`;
    const tw = ctx.measureText(g.name).width + 14, th = fs + 8;
    const x = clamp(g.lx - tw / 2, 4, Wl - tw - 4), y = Math.max(4, g.ly - th);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = g.color; rr(ctx, x, y, tw, th, th / 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.name, x + tw / 2, y + th / 2 + 0.5);
  }

  function drawPlayer() {
    const w = CAR_W * L.r, h = w * PCAR.lh / PCAR.lw;
    const pct = speed / MAXS;
    const bounce = state === 'play' || state === 'title' ? Math.sin(raceT * 28) * pct * 1.3 + (Math.random() - 0.5) * pct * 0.8 : 0;
    const sv = steerVis + (state === 'title' ? 0 : 0);
    const img = ART.player[sv < -0.35 ? 0 : sv > 0.35 ? 2 : 1];
    const x = L.cx - w / 2, y = L.carY - h + bounce;
    ctx.drawImage(img, x, y, w, h);
    const s = segAt(pos);
    const braking = state === 'play' && steerInput().brake;
    if (s.night > 0.3 || braking) lights(PCAR.lights, x, y, w, h, Math.max(s.night, braking ? 1 : 0), braking);
  }

  function drawParticles() {
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k];
      p.t += frameDt;
      if (p.t > p.life) { parts.splice(k, 1); continue; }
      p.x += p.vx * frameDt; p.y += p.vy * frameDt;
      if (p.kind === 'spark') p.vy += 300 * frameDt;
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = a;
      if (p.kind === 'spark') { ctx.fillStyle = p.t * 10 % 2 < 1 ? '#fff6b0' : '#ffd23f'; ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r); }
      else if (p.kind === 'boost') { ctx.fillStyle = '#7df9ff'; ctx.fillRect(p.x, p.y, p.r, p.r * 2.5); }
      else { ctx.fillStyle = p.kind === 'dust' ? '#c9a66b' : '#e6e6ea'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + p.t * 2), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
  function speedLines() {
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, r0 = Math.max(Wl, Hl) * (0.35 + Math.random() * 0.2), r1 = r0 + 40 + Math.random() * 80;
      ctx.moveTo(L.cx + Math.cos(a) * r0, L.hy + Math.sin(a) * r0 * 0.7); ctx.lineTo(L.cx + Math.cos(a) * r1, L.hy + Math.sin(a) * r1 * 0.7);
    }
    ctx.stroke();
  }

  function panel(x, y, w, h, labelText, value, color, sub) {
    ctx.fillStyle = '#151a33'; rr(ctx, x, y, w, h, 14); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `700 10px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(labelText, x + 11, y + 7);
    ctx.fillStyle = color || '#fff'; ctx.font = `italic 800 ${Math.round(h * 0.5)}px ${FONT}`; ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x + 10, y + h - 9);
    if (sub) { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText(sub, x + w - 10, y + h - 10); }
  }

  function drawHud() {
    // messages
    for (let k = msgs.length - 1; k >= 0; k--) {
      const m = msgs[k];
      m.t += frameDt;
      if (m.t > m.life) { msgs.splice(k, 1); continue; }
      const a = m.t < m.life - 0.3 ? 1 : (m.life - m.t) / 0.3;
      const pop = m.t < 0.18 ? 0.6 + (m.t / 0.18) * 0.55 : m.t < 0.3 ? 1.15 - ((m.t - 0.18) / 0.12) * 0.15 : 1;
      ctx.globalAlpha = a;
      if (m.small) {
        ctx.font = `italic 800 20px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.strokeText(m.text, m.x, L.carY - 110 - m.t * 60);
        ctx.fillStyle = m.color; ctx.fillText(m.text, m.x, L.carY - 110 - m.t * 60);
      } else {
        let fs = Math.min(Wl * 0.1, 52) * m.size;
        ctx.font = `italic 900 ${fs}px ${FONT}`;
        const tw = ctx.measureText(m.text).width;
        if (tw > Wl * 0.9) fs *= Wl * 0.9 / tw;
        fs *= pop;
        ctx.font = `italic 900 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const y = Hl * 0.3 + (m.slot || 0) * Math.min(Wl * 0.1, 52) * 1.15;
        ctx.lineWidth = Math.max(4, fs * 0.14); ctx.strokeStyle = 'rgba(10,10,30,.75)'; ctx.lineJoin = 'round';
        ctx.strokeText(m.text, Wl / 2, y); ctx.fillStyle = m.color; ctx.fillText(m.text, Wl / 2, y);
      }
      ctx.globalAlpha = 1;
    }
    if (state === 'title') return;
    const pad = 10, top = 10;
    const tl = Math.max(0, time);
    const low = tl <= 10 && state === 'play';
    const pulse = low ? 1 + Math.max(0, Math.sin(raceT * 12)) * 0.08 : 1;
    const pw = Math.min(118, (Wl - pad * 4) / 3);
    // time
    ctx.save();
    if (pulse !== 1) { ctx.translate(pad + pw / 2, top + 30); ctx.scale(pulse, pulse); ctx.translate(-(pad + pw / 2), -(top + 30)); }
    panel(pad, top, pw, 60, 'TIME', String(Math.ceil(tl)), low ? '#ff5252' : '#ffd23f');
    ctx.restore();
    // progress to next checkpoint
    if (T.cps[cpIdx] != null) {
      const prev = cpIdx ? T.cps[cpIdx - 1] * SEG : START_POS, next = T.cps[cpIdx] * SEG;
      const p = clamp((pos - prev) / (next - prev), 0, 1);
      ctx.fillStyle = '#151a33'; rr(ctx, pad, top + 64, pw, 8, 4); ctx.fill();
      ctx.fillStyle = '#7cff6b'; rr(ctx, pad, top + 64, Math.max(8, pw * p), 8, 4); ctx.fill();
    }
    const mph = Math.round(speed * MPH);
    if (CG.isMulti()) {
      panel(pad, top + 78, pw, 52, 'SCORE', score().toLocaleString('en-US'), '#fff');
      panel(pad, top + 136, pw, 52, 'MPH', String(mph), boostT > 0 ? '#22d3ee' : '#fff');
    } else {
      panel(Wl / 2 - pw / 2, top, pw, 60, 'SCORE', score().toLocaleString('en-US'), '#fff');
      panel(Wl - pad - pw, top, pw, 60, 'MPH', String(mph), boostT > 0 ? '#22d3ee' : '#fff');
    }
    // coins + overtakes
    ctx.font = `800 13px ${FONT}`;
    const ct = String(coins), ot = `${overtakes} passed`;
    const cw = Math.max(pw, 27 + ctx.measureText(ct).width + 14 + ctx.measureText(ot).width + 10);
    const cy = CG.isMulti() ? top + 194 : top + 66, cxp = CG.isMulti() ? pad : Wl / 2 - cw / 2;
    ctx.fillStyle = '#151a33'; rr(ctx, cxp, cy, cw, 24, 12); ctx.fill();
    ctx.drawImage(ART.coin, cxp + 5, cy + 3, 18, 18);
    ctx.fillStyle = '#ffd23f'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ct, cxp + 27, cy + 12.5);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(ot, cxp + cw - 10, cy + 12.5);
    // touch zone hints
    if (isTouch() && state === 'play') {
      const inp = steerInput();
      const r = 30, y = Hl - r - 18;
      [[-1, r + 16], [1, Wl - r - 16]].forEach(([d, x]) => {
        const on = (d < 0 && (inp.steer < 0 || inp.brake)) || (d > 0 && (inp.steer > 0 || inp.brake));
        ctx.globalAlpha = on ? 0.55 : 0.22;
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = on ? 1 : 0.6;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(x - d * 4 + d * 6, y - 11); ctx.lineTo(x + d * 8, y); ctx.lineTo(x - d * 4 + d * 6, y + 11); ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }
  }

  // ---------- Engine sound ----------
  let ac = null, eng = null, engAt = 0;
  function ensureAudio() {
    try {
      if (!ac) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        ac = new C();
        const o1 = ac.createOscillator(), o2 = ac.createOscillator(), fl = ac.createBiquadFilter(), g = ac.createGain();
        o1.type = 'sawtooth'; o2.type = 'square';
        fl.type = 'lowpass'; fl.frequency.value = 600; fl.Q.value = 2;
        g.gain.value = 0;
        o1.connect(fl); o2.connect(fl); fl.connect(g); g.connect(ac.destination);
        o1.start(); o2.start();
        eng = { o1, o2, fl, g };
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { /* no engine sound */ }
  }
  function engine(now) {
    if (!eng || now - engAt < 60) return;
    engAt = now;
    const on = (state === 'play' || state === 'over') && !paused && !CG.muted() && document.visibilityState === 'visible' && !(CG.modalOpen() && !multi);
    const pct = speed / MAXS;
    const t = ac.currentTime;
    const fq = 48 + pct * 105 + (boostT > 0 ? 25 : 0);
    eng.o1.frequency.setTargetAtTime(fq, t, 0.08);
    eng.o2.frequency.setTargetAtTime(fq * 0.502, t, 0.08);
    eng.fl.frequency.setTargetAtTime(380 + pct * 900, t, 0.1);
    eng.g.gain.setTargetAtTime(on ? 0.028 + pct * 0.02 : 0, t, 0.12);
  }

  // ---------- Loop ----------
  let last = 0, frameDt = 0, acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!T) return;
    let dt = last ? (now - last) / 1000 : STEP;
    last = now;
    dt = Math.min(dt, 0.1);
    frameDt = dt;
    const frozen = paused || (state === 'play' && !multi && CG.modalOpen());
    if (!frozen) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP * 0.999 && steps < 6) { update(STEP); acc -= STEP; steps++; }
      if (steps === 6) acc = 0;
    } else frameDt = 0;
    render();
    engine(now);
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

  // ---------- Overlays ----------
  const CSS = `
  .rr-wrap { position:absolute; inset:0; overflow:hidden; background:#79bff3; }
  .rr-wrap canvas { position:absolute; left:0; top:0; display:block; -webkit-touch-callout:none; }
  .rr-over { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:16px; background:linear-gradient(180deg, rgba(10,12,40,.15), rgba(10,12,40,.55)); cursor:pointer; transition:opacity .25s; }
  .rr-over.hide { opacity:0; pointer-events:none; }
  .rr-card { width:100%; max-width:420px; text-align:center; color:#fff; padding:22px 18px 20px; border-radius:26px; background:rgba(14,16,36,.62); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); box-shadow:0 20px 60px rgba(0,0,0,.35); border:1px solid rgba(255,255,255,.14); }
  .rr-logo { font-weight:900; font-style:italic; font-size:clamp(46px, 13vw, 72px); line-height:.92; letter-spacing:-.02em; transform:skewX(-8deg); background:linear-gradient(180deg,#fff6b0 0%,#ffd23f 45%,#ff7a00 100%); -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 4px 0 #b3261e) drop-shadow(0 8px 18px rgba(0,0,0,.4)); }
  .rr-logo span { display:block; background:linear-gradient(180deg,#ffffff 0%,#9be7ff 50%,#22a6f2 100%); -webkit-background-clip:text; background-clip:text; }
  .rr-tag { margin:14px 0 4px; font-size:15px; font-weight:600; opacity:.92; }
  .rr-ctl { display:flex; flex-direction:column; gap:7px; margin:14px auto 4px; font-size:14px; text-align:left; max-width:330px; }
  .rr-ctl div { display:flex; align-items:center; gap:10px; }
  .rr-ctl kbd .cg-ic { display:block; }
  .rr-ctl kbd { display:inline-flex; gap:2px; min-width:26px; height:26px; padding:0 6px; align-items:center; justify-content:center; border-radius:7px; background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.28); border-bottom-width:3px; font:700 13px Outfit, system-ui, sans-serif; }
  .rr-ctl .k { flex:none; display:flex; gap:4px; min-width:92px; }
  .rr-go { display:inline-block; margin-top:16px; padding:13px 30px; border-radius:999px; background:linear-gradient(180deg,#ff5a4f,#e8192c); color:#fff; font-weight:800; font-size:19px; letter-spacing:.02em; box-shadow:0 6px 0 #9b0f1c, 0 10px 24px rgba(232,25,44,.45); animation:rrPulse 1.3s ease-in-out infinite; }
  @keyframes rrPulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.06); } }
  @media (prefers-reduced-motion: reduce) { .rr-go { animation:none; } }
  .rr-pause .rr-card { max-width:300px; }
  .rr-title { cursor:default; }
  .rr-key { margin:10px 0 0; font-size:13px; opacity:.75; }
  .rr-pause h2 { margin:0 0 6px; font-size:28px; font-weight:800; }
  `;
  function ctlHtml() {
    const touch = isTouch();
    const ic = (n) => CG.icon(n, 15);
    const t = `<div><span class="k"><kbd>${ic('arrowLeft')}</kbd><kbd>${ic('arrowRight')}</kbd></span>Hold the left or right side of the screen to steer</div>` +
      `<div><span class="k"><kbd>${ic('arrowLeft')}${ic('arrowRight')}</kbd></span>Hold both sides to brake. You speed up by yourself</div>`;
    const k = `<div><span class="k"><kbd>${ic('arrowLeft')}</kbd><kbd>${ic('arrowRight')}</kbd></span>Steer (or <kbd>A</kbd> <kbd>D</kbd>)</div>` +
      `<div><span class="k"><kbd>${ic('arrowUp')}</kbd><kbd>W</kbd></span>Go (the car speeds up by itself)</div>` +
      `<div><span class="k"><kbd>${ic('arrowDown')}</kbd><kbd>S</kbd></span>Brake · <kbd>P</kbd> pause</div>`;
    return touch ? t : k;
  }
  function buildOverlays() {
    ffStyle();
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    overlay = document.createElement('div');
    overlay.className = 'rr-over';
    overlay.innerHTML = `<div class="rr-card"><div class="rr-logo">ROAD<span>RUSH</span></div>` +
      '<p class="rr-tag">Beat the clock, grab coins, zoom past traffic! Checkpoints give you +15 seconds.</p>' +
      `<div class="rr-ctl">${ctlHtml()}</div>${ffButtons({ solo: 'Practice alone' })}${isTouch() ? '' : '<p class="rr-key">or press Space to practice</p>'}</div>`;
    overlay.classList.add('rr-title');
    root.appendChild(overlay);
    overlay.addEventListener('pointerdown', (e) => e.stopPropagation());
    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ff]');
      if (!b || CG.modalOpen()) return;
      b.blur();
      ensureAudio();
      CG.sfx('click');
      if (b.dataset.ff === 'family') CG.openLobby();
      else if (state === 'title') startSolo();
    });
    pauseEl = document.createElement('div');
    pauseEl.className = 'rr-over rr-pause hide';
    pauseEl.innerHTML = `<div class="rr-card"><h2>Paused</h2><div class="rr-go">${isTouch() ? 'Tap to keep driving' : 'Click or press Space'}</div></div>`;
    root.appendChild(pauseEl);
  }
  function showOverlay(on) { overlay.classList.toggle('hide', !on); }
  function showPause(on) { pauseEl.classList.toggle('hide', !on); }
  function pause() {
    if (state !== 'play' || multi || paused) return;
    paused = true; showPause(true);
    touches.clear(); keys.left = keys.right = keys.up = keys.down = false;
  }
  function resume() { if (!paused) return; paused = false; showPause(false); last = 0; ensureAudio(); }

  // ---------- Input ----------
  function onKey(e, down) {
    const k = e.key;
    const map = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
    if (CG.modalOpen()) { if (!down && map[k]) keys[map[k]] = false; return; }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (map[k]) { keys[map[k]] = down; e.preventDefault(); }
    if (!down) return;
    if (k === ' ' || k === 'Enter') {
      if (state === 'title' && !CG.isMulti()) { if (tag !== 'BUTTON') { e.preventDefault(); startSolo(); } } else if (paused) { e.preventDefault(); resume(); }
    }
    if ((k === 'p' || k === 'P' || k === 'Escape') && state === 'play' && !multi) { if (paused) resume(); else pause(); }
  }
  function sideOf(e) { const r = root.getBoundingClientRect(); return e.clientX - r.left < r.width / 2 ? -1 : 1; }
  function onDown(e) {
    if (CG.modalOpen()) return;
    ensureAudio();
    if (paused) { resume(); return; }
    if (state === 'title') return; // the start card's buttons choose: family or practice
    if (state !== 'play') return;
    touches.set(e.pointerId, sideOf(e));
    try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  }
  function onMove(e) { if (touches.has(e.pointerId)) touches.set(e.pointerId, sideOf(e)); }
  function onUp(e) { touches.delete(e.pointerId); }

  // ---------- Size ----------
  let bgTimer = null, lastW = 0, lastH = 0;
  function resize() {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const nd = Math.min(2, window.devicePixelRatio || 1);
    if (w === lastW && h === lastH && nd === dpr && cvs.width) return;
    lastW = w; lastH = h; Wl = w; Hl = h; dpr = nd;
    cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr);
    cvs.style.width = w + 'px'; cvs.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = w / h, k = clamp((a - 0.55) / (1.5 - 0.55), 0, 1);
    L.hy = h * (0.4 + 0.08 * k);
    L.carY = h * (0.95 - 0.02 * k);
    const half = w * (0.66 - 0.2 * k);
    L.r = half / ROAD;
    L.H = (L.carY - L.hy) / L.r;
    L.d = L.H * 0.85;
    L.f = L.r * L.d;
    L.cx = w / 2;
    clearTimeout(bgTimer);
    if (!BG.length) buildBackgrounds(); else bgTimer = setTimeout(buildBackgrounds, 120);
  }

  // ---------- Boot ----------
  CG.mount({
    id: 'road', title: 'Road Rush', mode: 'race', scoreLabel: 'points',
    help: '<ul><li><b>Steer</b>: hold the left or right half of the screen, or use ← → (A D).</li>' +
      '<li>Your car speeds up by itself. <b>Brake</b> with ↓ (S) or by holding both sides.</li>' +
      '<li>You start with <b>60 seconds</b>. Drive through a <b>checkpoint</b> for +15 seconds!</li>' +
      '<li>Bumping a car or a tree slows you down, so weave around them.</li>' +
      '<li>Collect <b>coins</b> (+50) and drive over the glowing <b>boost pads</b> for a burst of speed.</li>' +
      '<li>Score = distance + coins × 50 + cars passed × 10.</li>' +
      '<li>Play together: everyone drives the same road, and you see the others as see-through ghost cars.</li></ul>',
    onReady(c) {
      root = document.createElement('div');
      root.className = 'rr-wrap';
      c.root.appendChild(root);
      cvs = document.createElement('canvas');
      cvs.setAttribute('aria-label', 'Road Rush game');
      root.appendChild(cvs);
      ctx = cvs.getContext('2d', { alpha: false });
      buildOverlays();
      buildArt();
      resize();
      if (window.ResizeObserver) new ResizeObserver(resize).observe(root);
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 200));
      window.addEventListener('keydown', (e) => onKey(e, true));
      window.addEventListener('keyup', (e) => onKey(e, false));
      window.addEventListener('blur', () => { keys.left = keys.right = keys.up = keys.down = false; touches.clear(); });
      root.addEventListener('pointerdown', onDown);
      root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerup', onUp);
      root.addEventListener('pointercancel', onUp);
      root.addEventListener('lostpointercapture', onUp);
      root.addEventListener('contextmenu', (e) => e.preventDefault());
      ['pointerdown', 'keydown', 'touchend'].forEach((t) => window.addEventListener(t, ensureAudio, { capture: true, passive: true }));
      resetRun(Math.floor(Math.random() * 2 ** 31), false);
      state = 'title';
      requestAnimationFrame(frame);
      window.__road = { get T() { return T; }, jump(seg) { ensure(seg + DRAW + 60); pos = seg * SEG; }, get state() { return state; }, get paused() { return paused; }, get pos() { return pos; }, get speed() { return speed; }, get px() { return px; }, get time() { return time; }, set time(v) { time = v; }, get score() { return score(); }, get coins() { return coins; }, get overtakes() { return overtakes; }, get seed() { return T.seed; }, get cars() { return T.cars.length; }, ghosts };
    }
  });
  CG.on('pause', () => { pause(); if (ac && ac.state === 'running') try { ac.suspend(); } catch (e) { /* ignore */ } });
  CG.on('resume', () => { if (ac && ac.state === 'suspended') try { ac.resume(); } catch (e) { /* ignore */ } last = 0; });
  CG.on('multiStart', (info) => { startRun(info.seed, true); });
  CG.on('multiEnd', () => { toTitle(); });
})();
