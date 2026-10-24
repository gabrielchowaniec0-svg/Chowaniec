// Police Patrol: drive a cartoon police cruiser around a little town and answer dispatch calls.
// The town is a grid of roads (two lanes, traffic lights, crosswalks) with houses, shops, parks, a school
// and the police station. The static town is pre-rendered into offscreen chunks; traffic, people, the
// lights and the mission props are drawn live on top. The town and the list of calls come from
// ChowGames.rng(seed), so in a race every player patrols the same town and gets the same calls.
(function () {
  'use strict';
  const CG = window.ChowGames;

  // ---------- World layout ----------
  const NB = 6;                    // blocks per side
  const NN = NB + 1;               // roads per side
  const R = 100;                   // road width
  const LANE = 25;                 // lane centre offset from the road centre
  const BLK = 400;                 // block size (including its sidewalk)
  const PITCH = BLK + R;
  const MARGIN = 230;              // countryside around the town
  const SW = 18;                   // sidewalk width
  const WORLD = MARGIN * 2 + NB * PITCH + R;
  const IN_S = R / 2;              // a lane starts where the junction box ends...
  const OUT_S = PITCH - R / 2;     // ...and ends at the next junction box
  const STOP_S = PITCH - R / 2 - 46;   // where a car's centre waits at a red light
  const PER = BLK - 18;            // one side of a sidewalk loop
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // E S W N
  const SHIFT = 300;               // a shift lasts five minutes
  const CH = 512, PAD = 3;         // pre-rendered chunk size (world units)
  const FONT = 'Outfit, system-ui, -apple-system, "Segoe UI", sans-serif';
  const roadC = (i) => MARGIN + R / 2 + i * PITCH;
  const blkX = (i) => MARGIN + R + i * PITCH;
  const TOWN0 = roadC(0) - R / 2, TOWN1 = roadC(NB) + R / 2;

  const H_ST = ['Sunny Road', 'Maple Street', 'Oak Street', 'Main Street', 'Cherry Street', 'Birch Street', 'River Road'];
  const V_ST = ['West Avenue', 'Apple Avenue', 'Bear Avenue', 'Park Avenue', 'Lemon Avenue', 'Duck Avenue', 'East Avenue'];
  const KIDS = ['Mia', 'Leo', 'Zoe', 'Sam', 'Ava', 'Max', 'Lily', 'Ben', 'Ella', 'Noah', 'Ruby', 'Finn', 'Isla', 'Theo'];
  const PARK_NAMES = ['Sunny Park', 'Duck Pond Park', 'Rainbow Park', 'Acorn Park', 'Bluebell Park'];
  const SHOP_LIST = [
    { key: 'bakery', name: 'BAKERY', title: 'Bakery', wall: '#fde7d4', awn: '#f472b6', sign: '#db2777', roof: '#e9d5c4' },
    { key: 'icecream', name: 'ICE CREAM', title: 'Ice Cream Shop', wall: '#e0f2fe', awn: '#38bdf8', sign: '#0284c7', roof: '#d6e4ee' },
    { key: 'toys', name: 'TOYS', title: 'Toy Shop', wall: '#fef9c3', awn: '#f59e0b', sign: '#ea580c', roof: '#e7dfc0' },
    { key: 'cafe', name: 'CAFE', title: 'Cafe', wall: '#ede0d4', awn: '#16a34a', sign: '#166534', roof: '#ddd0c4' },
    { key: 'books', name: 'BOOKS', title: 'Book Shop', wall: '#ede9fe', awn: '#8b5cf6', sign: '#6d28d9', roof: '#dcd6ea' },
    { key: 'pizza', name: 'PIZZA', title: 'Pizza Place', wall: '#fee2e2', awn: '#ef4444', sign: '#b91c1c', roof: '#ead3d3' },
    { key: 'flowers', name: 'FLOWERS', title: 'Flower Shop', wall: '#fce7f3', awn: '#ec4899', sign: '#be185d', roof: '#ead5df' },
    { key: 'pets', name: 'PET SHOP', title: 'Pet Shop', wall: '#dcfce7', awn: '#22c55e', sign: '#15803d', roof: '#d0e4d4' },
    { key: 'market', name: 'MARKET', title: 'Market', wall: '#ffedd5', awn: '#f97316', sign: '#c2410c', roof: '#eadbc8' },
    { key: 'bikes', name: 'BIKES', title: 'Bike Shop', wall: '#e0e7ff', awn: '#6366f1', sign: '#4338ca', roof: '#d4d8ea' },
    { key: 'candy', name: 'CANDY', title: 'Candy Shop', wall: '#fae8ff', awn: '#d946ef', sign: '#a21caf', roof: '#e7d4ea' }
  ];
  const CAR_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#f1f5f9', '#64748b', '#a3e635', '#0ea5e9', '#fb7185'];
  const CAR_TYPES = {
    sedan: { L: 44, W: 22 }, hatch: { L: 38, W: 21 }, van: { L: 52, W: 24 }, taxi: { L: 44, W: 22 }, bus: { L: 86, W: 28 },
    sport: { L: 44, W: 21 }, bandit: { L: 44, W: 23 }, truck: { L: 58, W: 27 }, police: { L: 46, W: 23 }
  };
  const RANKS = [
    { name: 'Cadet', at: 0, icon: 'shield', c1: '#93c5fd', c2: '#2563eb' },
    { name: 'Officer', at: 250, icon: 'badge', c1: '#86efac', c2: '#16a34a' },
    { name: 'Sergeant', at: 700, icon: 'star', c1: '#fdba74', c2: '#ea580c' },
    { name: 'Detective', at: 1300, icon: 'eye', c1: '#c4b5fd', c2: '#7c3aed' },
    { name: 'Chief', at: 2000, icon: 'crown', c1: '#fde68a', c2: '#d97706' }
  ];

  // ---------- Small helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const hyp = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
  const isTouch = () => (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  const hexRgb = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function shade(c, amt) {
    const A = hexRgb(c), B = amt >= 0 ? [255, 255, 255] : [0, 0, 0], t = Math.abs(amt);
    return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
  }
  function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[k]; a[k] = t; } return a; }
  function rr(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); }
  function blobs(g, list, color) { g.fillStyle = color; g.beginPath(); for (const [x, y, r] of list) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); } g.fill(); }
  function hash2(x, y, s) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  const validDir = (i, j, d) => { const ni = i + DIRS[d][0], nj = j + DIRS[d][1]; return ni >= 0 && nj >= 0 && ni <= NB && nj <= NB; };
  // A point on a lane: starting at node (i, j) going in direction d, s along, lat to the right of the lane centre.
  function lanePt(i, j, d, s, lat, out) {
    const dx = DIRS[d][0], dy = DIRS[d][1], off = LANE + (lat || 0);
    out.x = roadC(i) + dx * s - dy * off;
    out.y = roadC(j) + dy * s + dx * off;
    return out;
  }
  const tmpP = { x: 0, y: 0 }, tmpQ = { x: 0, y: 0 };

  // ---------- Sound (own context for the siren, engine and little voices; respects mute) ----------
  let ac = null, master = null, sirenG = null, engine = null, noiseBuf = null;
  function ensureAudio() {
    try {
      if (!ac) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        ac = new C();
        master = ac.createGain(); master.gain.value = 1; master.connect(ac.destination);
        // Siren: a soft two-tone "nee-naw" (a square LFO flips a triangle tone between two notes).
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 770;
        const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 1.3;
        const lg = ac.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(o.frequency);
        const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = 1540;
        const lg2 = ac.createGain(); lg2.gain.value = 240; lg.connect(lg2); lg2.connect(o2.frequency);
        const g2 = ac.createGain(); g2.gain.value = 0.25; o2.connect(g2);
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
        sirenG = ac.createGain(); sirenG.gain.value = 0;
        o.connect(f); g2.connect(f); f.connect(sirenG); sirenG.connect(master);
        o.start(); o2.start(); lfo.start();
        // Engine: a quiet low hum that rises with speed.
        const e1 = ac.createOscillator(); e1.type = 'sawtooth'; e1.frequency.value = 48;
        const ef = ac.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 360;
        const eg = ac.createGain(); eg.gain.value = 0;
        e1.connect(ef); ef.connect(eg); eg.connect(master); e1.start();
        engine = { o: e1, f: ef, g: eg };
        noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.4), ac.sampleRate);
        const ch = noiseBuf.getChannelData(0);
        for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { /* no sound */ }
  }
  const audioOn = () => ac && ac.state === 'running' && !CG.muted() && document.visibilityState === 'visible';
  function tone(type, f1, f2, dur, vol, delay, filt) {
    if (!audioOn()) return;
    const t = ac.currentTime + 0.01 + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    if (f2 !== f1) o.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (filt) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filt; o.connect(f); f.connect(g); } else o.connect(g);
    g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, freq, delay) {
    if (!audioOn() || !noiseBuf) return;
    const t = ac.currentTime + 0.01 + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }
  const SND = {
    radio() { noise(0.16, 0.06, 1900); tone('sine', 1320, 1320, 0.07, 0.06, 0.18); tone('sine', 1760, 1760, 0.09, 0.06, 0.27); },
    honk() { tone('square', 330, 330, 0.17, 0.05, 0, 1300); tone('square', 415, 415, 0.17, 0.04, 0, 1300); },
    quack() { tone('sawtooth', 560, 360, 0.11, 0.05, 0, 1100); tone('sawtooth', 540, 340, 0.11, 0.04, 0.15, 1100); },
    meow() {
      if (!audioOn()) return;
      const t = ac.currentTime + 0.01, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(650, t); o.frequency.linearRampToValueAtTime(1150, t + 0.12); o.frequency.linearRampToValueAtTime(620, t + 0.38);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.42);
    },
    jingle() { [784, 659, 784, 880, 784, 659, 523, 587].forEach((f, k) => tone('triangle', f, f, 0.15, 0.045, k * 0.17)); },
    bonk() { tone('triangle', 180, 90, 0.14, 0.08); },
    pop() { tone('sine', 500, 1100, 0.09, 0.06); },
    cheer() { [523, 659, 784, 1047].forEach((f, k) => tone('triangle', f, f, 0.16, 0.05, k * 0.08)); }
  };
  let engAt = 0;
  function audioTick(now) {
    if (!ac || now - engAt < 60) return;
    engAt = now;
    const t = ac.currentTime;
    const live = state === 'play' && !paused && audioOn() && !(CG.modalOpen() && !multi);
    sirenG.gain.setTargetAtTime(live && P.siren ? 0.035 : 0, t, 0.05);
    const sp = Math.abs(P.v) / 250;
    engine.o.frequency.setTargetAtTime(44 + sp * 70, t, 0.1);
    engine.f.frequency.setTargetAtTime(300 + sp * 500, t, 0.1);
    engine.g.gain.setTargetAtTime(live ? 0.012 + sp * 0.016 : 0, t, 0.12);
  }

  // ---------- Vector art ----------
  // Cars face +x and are centred on (0, 0).
  function drawCarVec(g, type, color, o) {
    o = o || {};
    const { L, W } = CAR_TYPES[type];
    const x = -L / 2, y = -W / 2;
    // soft contact shadow (rotation-proof: centred halo)
    g.save();
    g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 7 * (o.rs || 1);
    g.fillStyle = 'rgba(0,0,0,.35)'; rr(g, x + 1, y + 1, L - 2, W - 2, W * 0.35); g.fill();
    g.restore();
    // tyres
    g.fillStyle = '#1e222b';
    const tw = type === 'bus' ? 12 : 9;
    for (const tx of [-L * 0.3, L * 0.26]) for (const ty of [y - 1.6, W / 2 - 2.6]) { rr(g, tx - tw / 2, ty, tw, 4.2, 1.6); g.fill(); }
    if (type === 'bus') for (const ty of [y - 1.6, W / 2 - 2.6]) { rr(g, -L * 0.1 - tw / 2, ty, tw, 4.2, 1.6); g.fill(); }
    // body
    const body = g.createLinearGradient(0, y, 0, -y);
    body.addColorStop(0, shade(color, 0.32)); body.addColorStop(0.45, color); body.addColorStop(1, shade(color, -0.22));
    g.fillStyle = body;
    rr(g, x, y, L, W, type === 'bus' || type === 'truck' || type === 'van' ? 6 : W * 0.38); g.fill();
    g.lineWidth = 1.1; g.strokeStyle = 'rgba(0,0,0,.4)'; g.stroke();
    const glass = (gx, gw, inset, r) => {
      const gg = g.createLinearGradient(gx, 0, gx + gw, 0); gg.addColorStop(0, '#1e3a5f'); gg.addColorStop(1, '#5fa8d8');
      g.fillStyle = gg; rr(g, gx, y + inset, gw, W - inset * 2, r); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; rr(g, gx + gw * 0.25, y + inset + 1.5, gw * 0.3, W * 0.22, 1); g.fill();
    };
    if (type === 'bus') {
      g.fillStyle = shade(color, 0.18); rr(g, x + 4, y + 3, L - 8, W - 6, 4); g.fill();
      for (let k = 0; k < 6; k++) { g.fillStyle = '#3b6f9e'; rr(g, x + 10 + k * 11.5, y + 1.2, 8, 3, 1); g.fill(); rr(g, x + 10 + k * 11.5, -y - 4.2, 8, 3, 1); g.fill(); }
      glass(L / 2 - 9, 6, 3, 2);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + 8, -1, L - 22, 2);
    } else if (type === 'truck') {
      // ice cream truck: cab + box with a big cone on the roof
      glass(L / 2 - 14, 7, 3.5, 2.5);
      g.fillStyle = '#fdf2f8'; rr(g, x + 3, y + 2.5, L * 0.66, W - 5, 4); g.fill();
      g.strokeStyle = '#f9a8d4'; g.lineWidth = 2.4; g.beginPath();
      for (let k = 0; k < 5; k++) { const sx = x + 6 + k * 7; g.moveTo(sx, y + 3); g.lineTo(sx + 3, -y - 3); }
      g.stroke();
      // cone
      g.fillStyle = '#e0a458'; g.beginPath(); g.moveTo(x + 9, 0); g.lineTo(x + 22, -6); g.lineTo(x + 22, 6); g.closePath(); g.fill();
      blobs(g, [[x + 25, 0, 6.5]], '#fbcfe8'); blobs(g, [[x + 28, -2, 4.5]], '#fde68a'); blobs(g, [[x + 30, 2, 2]], '#ef4444');
    } else if (type === 'van') {
      glass(L / 2 - 13, 7, 3, 2.5);
      g.fillStyle = shade(color, 0.14); rr(g, x + 4, y + 3, L - 20, W - 6, 4); g.fill();
      g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x + 12, y + 3, 1, W - 6); g.fillRect(x + 22, y + 3, 1, W - 6);
    } else {
      const front = type === 'hatch' ? L * 0.1 : L * 0.08;
      glass(front, L * 0.17, 3, 3);
      glass(-L * 0.36, L * 0.12, 3.5, 2.5);
      g.fillStyle = shade(color, type === 'police' ? 0 : 0.12); rr(g, -L * 0.24, y + 3.2, L * 0.33, W - 6.4, 3); g.fill();
      if (type === 'sport') { g.fillStyle = '#fff'; g.fillRect(x + 2, -2.2, L - 4, 1.6); g.fillRect(x + 2, 0.6, L - 4, 1.6); }
      if (type === 'taxi') { g.fillStyle = '#111827'; rr(g, -7, -3, 9, 6, 1.5); g.fill(); g.fillStyle = '#fde047'; g.font = `800 4px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', -2.5, 0.3); }
      if (type === 'bandit') {
        // purple with yellow stripes and a big cookie on the roof
        g.fillStyle = '#fde047'; g.fillRect(x + 3, y + 2, L - 6, 2); g.fillRect(x + 3, -y - 4, L - 6, 2);
        blobs(g, [[-L * 0.07, 0, 7.5]], '#c08443'); blobs(g, [[-L * 0.07 - 1, -1, 6.5]], '#d9a066');
        blobs(g, [[-L * 0.07 - 3, -2.5, 1.4], [-L * 0.07 + 2, -3, 1.2], [-L * 0.07 + 1, 2, 1.5], [-L * 0.07 - 3.5, 2.5, 1.1], [-L * 0.07 + 3.5, 0.5, 1]], '#5b3416');
      }
      if (type === 'police') {
        // blue hood and trunk, light bar on the roof
        g.fillStyle = '#1d4ed8';
        rr(g, L * 0.27, y + 1.5, L * 0.21, W - 3, 5); g.fill();
        rr(g, x + 1.5, y + 1.5, L * 0.12, W - 3, 5); g.fill();
        g.fillStyle = '#fff'; g.beginPath();
        const sx = L * 0.375, r1 = 3.4, r2 = 1.4;
        for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rad = k % 2 ? r2 : r1; g.lineTo(sx + Math.cos(a) * rad, Math.sin(a) * rad); }
        g.closePath(); g.fill();
        if (o.stripe) { g.fillStyle = o.stripe; rr(g, -L * 0.24, y + 3.2, L * 0.33, 3.2, 1.5); g.fill(); rr(g, -L * 0.24, -y - 6.4, L * 0.33, 3.2, 1.5); g.fill(); }
        // light bar
        const lit = o.lit || 0;   // 0 off, 1 red side bright, 2 blue side bright
        g.fillStyle = '#334155'; rr(g, -L * 0.1, y + 2.5, 6, W - 5, 2); g.fill();
        g.fillStyle = lit === 1 ? '#ff4d4d' : '#9b2c2c'; rr(g, -L * 0.1 + 0.8, y + 3.2, 4.4, (W - 6.4) / 2 - 0.5, 1.5); g.fill();
        g.fillStyle = lit === 2 ? '#4da3ff' : '#1e3a8a'; rr(g, -L * 0.1 + 0.8, 0.5, 4.4, (W - 6.4) / 2 - 0.5, 1.5); g.fill();
        if (lit) { g.fillStyle = 'rgba(255,255,255,.8)'; rr(g, -L * 0.1 + 1.8, lit === 1 ? y + 4.5 : 2, 2.4, 3, 1); g.fill(); }
      }
    }
    // lights
    g.fillStyle = '#fff7c2'; rr(g, L / 2 - 2.6, y + 2.2, 2.4, 4.2, 1); g.fill(); rr(g, L / 2 - 2.6, -y - 6.4, 2.4, 4.2, 1); g.fill();
    g.fillStyle = '#e11d48'; rr(g, x + 0.4, y + 2.4, 2, 3.6, 1); g.fill(); rr(g, x + 0.4, -y - 6, 2, 3.6, 1); g.fill();
    // mirrors
    if (type !== 'bus' && type !== 'truck') { g.fillStyle = shade(color, -0.25); rr(g, L * 0.1, y - 2.2, 3, 2.6, 1); g.fill(); rr(g, L * 0.1, -y - 0.4, 3, 2.6, 1); g.fill(); }
  }

  // People are upright little figures (origin at the feet). frame 0 stand, 1/2 walking.
  const LOOKS = [];
  (function () {
    const skins = ['#f9d3b4', '#e8b48f', '#c98d63', '#8d5a3b', '#f5c9a0'];
    const shirts = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#eab308', '#6366f1'];
    const pants = ['#1e3a8a', '#374151', '#7c2d12', '#0f766e', '#4b5563'];
    const hairs = ['#3b2414', '#111827', '#a16207', '#d97706', '#6b7280', '#7c2d12'];
    const r = CG.rng(4242);
    for (let k = 0; k < 14; k++) LOOKS.push({ skin: pick(r, skins), shirt: pick(r, shirts), pants: pick(r, pants), hair: pick(r, hairs), long: r() < 0.45, kid: r() < 0.3, hat: r() < 0.15 ? pick(r, shirts) : null });
  })();
  function drawPedVec(g, lk, frame, opt) {
    opt = opt || {};
    const sw = frame === 0 ? 0 : frame === 1 ? 2.4 : -2.4;
    g.fillStyle = 'rgba(0,0,0,.22)'; ell(g, 0, 0, 6.5, 2.4); g.fill();
    g.lineCap = 'round';
    g.strokeStyle = lk.pants; g.lineWidth = 3.4;
    g.beginPath(); g.moveTo(-2.1, -9); g.lineTo(-2.1 - sw, -1.3); g.moveTo(2.1, -9); g.lineTo(2.1 + sw, -1.3); g.stroke();
    g.fillStyle = opt.stripes ? '#f8fafc' : lk.shirt; rr(g, -5.2, -19.5, 10.4, 11.5, 4); g.fill();
    if (opt.stripes) { g.fillStyle = '#111827'; for (let k = 0; k < 4; k++) g.fillRect(-5.2, -18.5 + k * 2.9, 10.4, 1.4); }
    if (opt.badge) { g.fillStyle = '#facc15'; circ(g, -2, -15.5, 1.4); g.fill(); }
    g.strokeStyle = opt.stripes ? '#e5e7eb' : lk.shirt; g.lineWidth = 2.7;
    g.beginPath();
    if (opt.armsUp) { g.moveTo(-4.6, -17.5); g.lineTo(-7.5, -26); g.moveTo(4.6, -17.5); g.lineTo(7.5, -26); }
    else if (opt.point != null) {
      const ax = Math.cos(opt.point), ay = Math.sin(opt.point) * 0.6;
      g.moveTo(4.6 * Math.sign(ax || 1), -17.5); g.lineTo(4.6 * Math.sign(ax || 1) + ax * 8, -17.5 + ay * 8 - 1);
      g.moveTo(-4.6, -17.5); g.lineTo(-6.5, -10);
    } else if (opt.wave) { const w = Math.sin(opt.wave * 10) * 3; g.moveTo(4.6, -17.5); g.lineTo(8 + w, -26); g.moveTo(-4.6, -17.5); g.lineTo(-6.5, -10); }
    else { g.moveTo(-4.8, -17.5); g.lineTo(-6.5 + sw * 0.6, -10.5); g.moveTo(4.8, -17.5); g.lineTo(6.5 - sw * 0.6, -10.5); }
    g.stroke();
    g.fillStyle = lk.skin;
    if (opt.armsUp) { circ(g, -7.8, -26.8, 1.8); g.fill(); circ(g, 7.8, -26.8, 1.8); g.fill(); }
    circ(g, 0, -24.3, 5.1); g.fill();
    g.fillStyle = lk.hair;
    g.beginPath(); g.arc(0, -25, 5.4, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
    if (lk.long) { rr(g, -5.6, -26, 2.6, 8, 1.3); g.fill(); rr(g, 3, -26, 2.6, 8, 1.3); g.fill(); }
    if (opt.cap) { g.fillStyle = '#1e3a8a'; rr(g, -5.6, -31, 11.2, 4.5, 2); g.fill(); g.fillRect(-6.5, -27.4, 13, 1.6); g.fillStyle = '#facc15'; circ(g, 0, -29, 1.3); g.fill(); }
    else if (lk.hat) { g.fillStyle = lk.hat; g.beginPath(); g.arc(0, -26.5, 5.2, Math.PI, 0); g.fill(); g.fillRect(-6.5, -26.8, 13, 1.6); }
    if (opt.mask) { g.fillStyle = '#111827'; rr(g, -5.4, -26.2, 10.8, 3, 1.4); g.fill(); g.fillStyle = '#fff'; circ(g, -2, -24.7, 0.9); g.fill(); circ(g, 2, -24.7, 0.9); g.fill(); }
    else { g.fillStyle = '#1f2937'; circ(g, -1.8, -24, 0.8); g.fill(); circ(g, 1.8, -24, 0.8); g.fill(); }
    g.strokeStyle = '#9a3412'; g.lineWidth = 0.8; g.beginPath(); g.arc(0, -22.8, 1.6, 0.2, Math.PI - 0.2); g.stroke();
  }
  function drawKitten(g, x, y, t, held) {
    const b = Math.sin(t * 6) * 0.6;
    g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, x, y, 6, 2); if (!held) g.fill();
    g.fillStyle = '#fb923c'; ell(g, x, y - 5 + b * 0.3, 5.6, 4.4); g.fill();
    g.strokeStyle = '#fb923c'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(x + 4.5, y - 4); g.quadraticCurveTo(x + 10, y - 6 + Math.sin(t * 4) * 2, x + 8, y - 12); g.stroke();
    circ(g, x - 1, y - 11 + b, 4.6); g.fill();
    g.beginPath(); g.moveTo(x - 5, y - 13 + b); g.lineTo(x - 4.8, y - 18.5 + b); g.lineTo(x - 1.8, y - 15 + b); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x + 3, y - 13 + b); g.lineTo(x + 2.8, y - 18.5 + b); g.lineTo(x - 0.2, y - 15 + b); g.closePath(); g.fill();
    g.fillStyle = '#c2410c'; g.fillRect(x - 3, y - 7, 1.2, 3); g.fillRect(x + 1, y - 7, 1.2, 3);
    g.fillStyle = '#fff7ed'; ell(g, x - 1, y - 9.5 + b, 2.6, 1.8); g.fill();
    g.fillStyle = '#1f2937'; circ(g, x - 2.6, y - 11.8 + b, 0.9); g.fill(); circ(g, x + 0.6, y - 11.8 + b, 0.9); g.fill();
    g.fillStyle = '#f472b6'; circ(g, x - 1, y - 10.3 + b, 0.7); g.fill();
  }
  function drawDuck(g, x, y, size, t, mom) {
    const s = size, w = Math.sin(t * 12) * 0.8;
    g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, x, y, 5 * s, 1.8 * s); g.fill();
    g.fillStyle = mom ? '#fafafa' : '#fde047';
    ell(g, x, y - 4 * s + w * 0.2, 5.2 * s, 3.8 * s); g.fill();
    circ(g, x + 3.2 * s, y - 8.5 * s + w * 0.3, 2.8 * s); g.fill();
    g.fillStyle = mom ? '#e5e7eb' : '#facc15'; ell(g, x - 1, y - 4 * s, 3 * s, 2 * s); g.fill();
    g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(x + 5.5 * s, y - 9 * s); g.lineTo(x + 8.5 * s, y - 8 * s); g.lineTo(x + 5.5 * s, y - 7.4 * s); g.closePath(); g.fill();
    g.fillStyle = '#111827'; circ(g, x + 4 * s, y - 9.4 * s, 0.75 * s); g.fill();
    if (mom) { g.fillStyle = '#3b82f6'; rr(g, x - 4 * s, y - 5.2 * s, 3 * s, 1.6 * s, 0.8); g.fill(); }
  }
  function drawBalloon(g, x, y, t, col) {
    const bx = x + Math.sin(t * 1.7) * 2.5, by = y - 34 + Math.sin(t * 2.3) * 2;
    g.strokeStyle = '#475569'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 3, y - 14, bx, by + 9); g.stroke();
    g.fillStyle = 'rgba(0,0,0,.15)'; ell(g, x, y, 4, 1.6); g.fill();
    const gr = g.createRadialGradient(bx - 3, by - 3, 1, bx, by, 10); gr.addColorStop(0, shade(col, 0.5)); gr.addColorStop(1, col);
    g.fillStyle = gr; ell(g, bx, by, 7.5, 9.2); g.fill();
    g.fillStyle = col; g.beginPath(); g.moveTo(bx - 1.6, by + 9.6); g.lineTo(bx + 1.6, by + 9.6); g.lineTo(bx, by + 7.5); g.fill();
  }
  function drawBike(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, x, y + 1, 12, 3); g.fill();
    g.strokeStyle = '#1f2937'; g.lineWidth = 1.6;
    circ(g, x - 7, y - 5, 5); g.stroke(); circ(g, x + 7, y - 5, 5); g.stroke();
    g.strokeStyle = '#ef4444'; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(x - 7, y - 5); g.lineTo(x - 1, y - 12); g.lineTo(x + 5, y - 12); g.lineTo(x + 7, y - 5); g.moveTo(x - 1, y - 12); g.lineTo(x + 1, y - 5); g.lineTo(x - 7, y - 5); g.moveTo(x + 5, y - 12); g.lineTo(x + 4, y - 15); g.stroke();
    g.fillStyle = '#111827'; rr(g, x - 3, y - 14, 5, 2, 1); g.fill();
  }
  function drawCookieJar(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, x, y, 6, 2); g.fill();
    g.fillStyle = 'rgba(219,234,254,.95)'; rr(g, x - 5.5, y - 12, 11, 12, 3); g.fill();
    g.strokeStyle = '#93c5fd'; g.lineWidth = 0.8; g.stroke();
    blobs(g, [[x - 2, y - 4, 2.6], [x + 2.3, y - 6, 2.4], [x - 0.5, y - 8.8, 2.2]], '#d9a066');
    g.fillStyle = '#ef4444'; rr(g, x - 6, y - 14, 12, 3, 1.5); g.fill();
  }

  // Sprite caches (pre-rendered at the current render scale).
  let rs = 1;                         // pixels per world unit for pre-rendered art
  const spriteCache = new Map();
  function carSprite(type, color, o) {
    const key = type + color + (o ? (o.lit || 0) + (o.stripe || '') : '');
    let c = spriteCache.get(key);
    if (!c) {
      const { L, W } = CAR_TYPES[type], m = 9;
      c = document.createElement('canvas');
      c.width = Math.ceil((L + m * 2) * rs); c.height = Math.ceil((W + m * 2) * rs);
      const g = c.getContext('2d');
      g.scale(rs, rs); g.translate(L / 2 + m, W / 2 + m);
      drawCarVec(g, type, color, Object.assign({ rs }, o || {}));
      c.wl = L + m * 2; c.hl = W + m * 2;
      spriteCache.set(key, c);
    }
    return c;
  }
  function pedSprite(look, frame) {
    const key = 'p' + look + '_' + frame;
    let c = spriteCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = Math.ceil(24 * rs); c.height = Math.ceil(36 * rs);
      const g = c.getContext('2d');
      g.scale(rs, rs); g.translate(12, 33);
      drawPedVec(g, LOOKS[look], frame);
      spriteCache.set(key, c);
    }
    return c;
  }
  let glowR = null, glowB = null;
  function glowSprite(col) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }

  // ---------- Town art (drawn into chunks) ----------
  const GRASS = '#8acb62', GRASS_D = '#79bb53', WALK = '#e8e3d6', WALK_D = '#d6cfbf', CURB = '#c3baa6', ASPH = '#5d6372', ASPH_D = '#565c6a';
  function artTree(g, x, y, r, k) {
    const cols = [['#2f7d32', '#43a047', '#66bb6a', '#a5d6a7'], ['#256f3a', '#3b9a4e', '#5cbf61', '#9be29a'], ['#3d7a1f', '#5a9e2f', '#7fc241', '#c2ea8a']][k % 3];
    g.fillStyle = 'rgba(20,60,10,.28)'; ell(g, x + r * 0.45, y + 1, r * 1.05, r * 0.45); g.fill();
    g.fillStyle = '#7b4a26'; rr(g, x - 2.6, y - r * 0.9, 5.2, r * 0.9, 2); g.fill();
    const cy = y - r * 1.2;
    const b = [[x, cy, r], [x - r * 0.55, cy + r * 0.25, r * 0.7], [x + r * 0.55, cy + r * 0.2, r * 0.72], [x - r * 0.15, cy - r * 0.45, r * 0.7]];
    blobs(g, b.map(([a, c, d]) => [a + 2, c + 3, d]), cols[0]);
    blobs(g, b, cols[1]);
    blobs(g, b.map(([a, c, d]) => [a - d * 0.2, c - d * 0.22, d * 0.68]), cols[2]);
    blobs(g, b.slice(0, 2).map(([a, c, d]) => [a - d * 0.38, c - d * 0.42, d * 0.25]), cols[3]);
  }
  function artBush(g, x, y, r, flower) {
    g.fillStyle = 'rgba(20,60,10,.22)'; ell(g, x + 2, y + 1, r * 1.2, r * 0.5); g.fill();
    const b = [[x - r * 0.5, y - r * 0.5, r * 0.7], [x + r * 0.5, y - r * 0.5, r * 0.7], [x, y - r * 0.85, r * 0.8]];
    blobs(g, b, '#3f9b45'); blobs(g, b.map(([a, c, d]) => [a - d * 0.2, c - d * 0.25, d * 0.55]), '#62bd5c');
    if (flower) blobs(g, [[x - r * 0.4, y - r * 0.9, 1.6], [x + r * 0.3, y - r * 1.1, 1.6], [x + r * 0.6, y - r * 0.5, 1.6], [x - r * 0.7, y - r * 0.4, 1.6]], flower);
  }
  function artFlowerBed(g, x, y, w, h, r) {
    g.fillStyle = '#8b5a2b'; rr(g, x, y, w, h, Math.min(w, h) / 2); g.fill();
    g.fillStyle = '#6f4520'; rr(g, x + 1.5, y + 1.5, w - 3, h - 3, Math.min(w, h) / 2); g.fill();
    const cols = ['#f43f5e', '#facc15', '#ffffff', '#a855f7', '#fb923c', '#ec4899'];
    for (let k = 0; k < (w * h) / 40; k++) {
      const fx = x + 4 + r() * (w - 8), fy = y + 4 + r() * (h - 8), c = cols[Math.floor(r() * cols.length)];
      blobs(g, [[fx, fy + 1, 2.4]], '#3f8f3a');
      blobs(g, [[fx - 1.5, fy, 1.5], [fx + 1.5, fy, 1.5], [fx, fy - 1.5, 1.5], [fx, fy + 1.5, 1.5]], c);
      blobs(g, [[fx, fy, 1]], '#fde68a');
    }
  }
  function wallWindows(g, x, y, w, h, n, col) {
    const ww = Math.min(12, (w - 10) / n - 6), gap = (w - n * ww) / (n + 1);
    for (let k = 0; k < n; k++) {
      const wx = x + gap + k * (ww + gap);
      g.fillStyle = '#fff'; rr(g, wx - 1.2, y + h * 0.2 - 1.2, ww + 2.4, h * 0.42 + 2.4, 2); g.fill();
      g.fillStyle = col || '#7dd3fc'; rr(g, wx, y + h * 0.2, ww, h * 0.42, 1.5); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(wx + 1.2, y + h * 0.2 + 1.2, ww * 0.35, h * 0.18);
    }
  }
  function artHouse(g, x, y, w, d, h, o) {
    // shadow, front wall (facing the viewer), roof
    g.fillStyle = 'rgba(20,50,10,.25)'; rr(g, x + 7, y - h + 9, w + 3, d + h - 5, 6); g.fill();
    const wy = y + d - h;
    g.fillStyle = o.wall; g.fillRect(x, wy, w, h);
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x, wy + h - 4, w, 4);
    const doorX = x + w * o.door - 6;
    wallWindows(g, x, wy, w * o.door - 8, h, 1);
    wallWindows(g, doorX + 14, wy, x + w - doorX - 14, h, 1);
    g.fillStyle = o.doorCol; rr(g, doorX, wy + h * 0.32, 12, h * 0.68, 2); g.fill();
    g.fillStyle = '#fde68a'; circ(g, doorX + 9.5, wy + h * 0.7, 1.1); g.fill();
    g.fillStyle = '#d6d3d1'; g.fillRect(doorX - 3, y + d - 1, 18, 3);
    // roof
    const rx = x - 4, ry = y - h - 3, rw = w + 8, rd = d + 2;
    const ridge = ry + rd * 0.42;
    g.fillStyle = shade(o.roof, 0.22); g.beginPath(); g.moveTo(rx + 6, ry); g.lineTo(rx + rw - 6, ry); g.lineTo(rx + rw, ridge); g.lineTo(rx, ridge); g.closePath(); g.fill();
    g.fillStyle = o.roof; g.beginPath(); g.moveTo(rx, ridge); g.lineTo(rx + rw, ridge); g.lineTo(rx + rw - 2, ry + rd); g.lineTo(rx + 2, ry + rd); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 1;
    g.beginPath(); for (let k = ridge + 5; k < ry + rd - 1; k += 5) { g.moveTo(rx + 2, k); g.lineTo(rx + rw - 2, k); } g.stroke();
    g.fillStyle = shade(o.roof, -0.25); g.fillRect(rx, ridge - 1, rw, 2.2); g.fillRect(rx + 2, ry + rd - 2, rw - 4, 2);
    if (o.chimney) { g.fillStyle = '#b45309'; g.fillRect(rx + rw * 0.72, ry + 2, 8, 12); g.fillStyle = '#78350f'; g.fillRect(rx + rw * 0.72 - 1, ry + 1, 10, 3); }
  }
  function artShop(g, x, y, w, d, h, s) {
    g.fillStyle = 'rgba(20,40,10,.25)'; rr(g, x + 8, y - h + 8, w + 2, d + h - 4, 5); g.fill();
    const wy = y + d - h;
    g.fillStyle = s.wall; g.fillRect(x, wy, w, h);
    // windows + door
    g.fillStyle = '#fff'; rr(g, x + 6, wy + h * 0.38, w * 0.34, h * 0.5, 2); g.fill(); rr(g, x + w * 0.6 - 2, wy + h * 0.38, w * 0.34, h * 0.5, 2); g.fill();
    g.fillStyle = '#7dd3fc'; rr(g, x + 7.5, wy + h * 0.38 + 1.5, w * 0.34 - 3, h * 0.5 - 3, 1.5); g.fill(); rr(g, x + w * 0.6 - 0.5, wy + h * 0.38 + 1.5, w * 0.34 - 3, h * 0.5 - 3, 1.5); g.fill();
    g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x + 10, wy + h * 0.42, 5, h * 0.3); g.fillRect(x + w * 0.6 + 3, wy + h * 0.42, 5, h * 0.3);
    g.fillStyle = shade(s.awn, -0.3); rr(g, x + w / 2 - 7, wy + h * 0.36, 14, h * 0.64, 2); g.fill();
    g.fillStyle = '#bae6fd'; rr(g, x + w / 2 - 5, wy + h * 0.42, 10, h * 0.3, 1.5); g.fill();
    // awning
    const ay = wy + 3, ah = h * 0.26, n = Math.round(w / 12);
    for (let k = 0; k < n; k++) {
      g.fillStyle = k % 2 ? '#ffffff' : s.awn;
      const ax = x - 3 + k * (w + 6) / n, aw = (w + 6) / n;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + aw, ay); g.lineTo(ax + aw, ay + ah); g.arc(ax + aw / 2, ay + ah, aw / 2, 0, Math.PI); g.closePath(); g.fill();
    }
    // flat roof
    g.fillStyle = s.roof; g.fillRect(x - 2, y - h - 2, w + 4, d + 2);
    g.fillStyle = shade(s.roof, -0.12); g.fillRect(x - 2, y - h + d - 2, w + 4, 3); g.fillRect(x - 2, y - h - 2, w + 4, 2);
    g.fillStyle = '#cbd5e1'; rr(g, x + w * 0.68, y - h + 6, 16, 12, 2); g.fill(); g.fillStyle = '#94a3b8'; circ(g, x + w * 0.68 + 8, y - h + 12, 4); g.fill();
    // sign on the roof edge
    g.font = `800 11px ${FONT}`;
    const tw = Math.min(w - 10, g.measureText(s.name).width + 14);
    g.fillStyle = s.sign; rr(g, x + w / 2 - tw / 2, y - h + d - 20, tw, 15, 4); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.name, x + w / 2, y - h + d - 12.2, w - 14);
  }
  function artParking(g, x, y, w, h, n, vertical) {
    g.fillStyle = '#6b7280'; rr(g, x, y, w, h, 8); g.fill();
    g.fillStyle = '#737a88'; rr(g, x + 3, y + 3, w - 6, h - 6, 6); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.6; g.beginPath();
    for (let k = 0; k <= n; k++) {
      if (vertical) { const yy = y + 6 + k * (h - 12) / n; g.moveTo(x + 6, yy); g.lineTo(x + 44, yy); }
      else { const xx = x + 6 + k * (w - 12) / n; g.moveTo(xx, y + 6); g.lineTo(xx, y + 50); }
    }
    g.stroke();
  }
  function parkedCar(g, x, y, a, type, color, o) {
    g.save(); g.translate(x, y); g.rotate(a); drawCarVec(g, type, color, o); g.restore();
  }
  function artPond(g, x, y, rx, ry, r) {
    g.fillStyle = '#d7c49e'; ell(g, x, y, rx + 6, ry + 5); g.fill();
    g.fillStyle = '#a3e0f5'; ell(g, x, y, rx, ry); g.fill();
    const gr = g.createRadialGradient(x - rx * 0.3, y - ry * 0.3, 2, x, y, rx);
    gr.addColorStop(0, '#7dd3fc'); gr.addColorStop(1, '#2b9bd6');
    g.fillStyle = gr; ell(g, x, y + 1, rx - 3, ry - 3); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.4;
    for (let k = 0; k < 4; k++) { const wx = x - rx * 0.5 + r() * rx, wy = y - ry * 0.4 + r() * ry * 0.8; g.beginPath(); g.arc(wx, wy, 5, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    for (let k = 0; k < 5; k++) {
      const a = r() * Math.PI * 2, d = 0.45 + r() * 0.35, lx = x + Math.cos(a) * rx * d, ly = y + Math.sin(a) * ry * d;
      g.fillStyle = '#4ade80'; g.beginPath(); g.arc(lx, ly, 4.5, 0.4, Math.PI * 2 - 0.1); g.lineTo(lx, ly); g.fill();
      if (k % 2 === 0) blobs(g, [[lx + 1, ly - 1, 1.6]], '#f9a8d4');
    }
    g.strokeStyle = '#3f7d2c'; g.lineWidth = 1.5;
    for (let k = 0; k < 8; k++) { const a = Math.PI * 0.15 + r() * Math.PI * 0.7, px = x + Math.cos(a) * (rx + 2), py = y + Math.sin(a) * (ry + 2); g.beginPath(); g.moveTo(px, py); g.lineTo(px + (r() - 0.5) * 3, py - 9); g.stroke(); blobs(g, [[px + 0.5, py - 9, 1.5]], '#7c4a1e'); }
  }
  function artPlayground(g, x, y, w, h) {
    g.fillStyle = '#f5dfa8'; rr(g, x, y, w, h, 12); g.fill();
    g.fillStyle = '#ecd08b'; rr(g, x + 4, y + 4, w - 8, h - 8, 9); g.fill();
    // slide
    g.fillStyle = '#ef4444'; rr(g, x + 10, y + 12, 14, 14, 2); g.fill();
    g.fillStyle = '#facc15'; g.beginPath(); g.moveTo(x + 24, y + 14); g.lineTo(x + 46, y + 24); g.lineTo(x + 46, y + 30); g.lineTo(x + 24, y + 22); g.closePath(); g.fill();
    g.strokeStyle = '#94a3b8'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 10, y + 14); g.lineTo(x + 2 + 8, y + 28); g.stroke();
    // swings
    const sx = x + w - 46;
    g.strokeStyle = '#3b82f6'; g.lineWidth = 3; g.beginPath(); g.moveTo(sx, y + h - 14); g.lineTo(sx + 4, y + 10); g.lineTo(sx + 34, y + 10); g.lineTo(sx + 38, y + h - 14); g.stroke();
    g.strokeStyle = '#64748b'; g.lineWidth = 1; g.beginPath(); for (const k of [10, 24]) { g.moveTo(sx + k, y + 10); g.lineTo(sx + k, y + 26); g.moveTo(sx + k + 5, y + 10); g.lineTo(sx + k + 5, y + 26); } g.stroke();
    g.fillStyle = '#f97316'; g.fillRect(sx + 9, y + 26, 7, 2.4); g.fillRect(sx + 23, y + 26, 7, 2.4);
    // sandbox
    g.fillStyle = '#b45309'; rr(g, x + 12, y + h - 28, 30, 20, 3); g.fill(); g.fillStyle = '#fde68a'; rr(g, x + 14, y + h - 26, 26, 16, 2); g.fill();
    blobs(g, [[x + 22, y + h - 18, 2.5]], '#ef4444');
  }
  function artFountain(g, x, y) {
    g.fillStyle = 'rgba(20,50,10,.2)'; ell(g, x + 3, y + 3, 24, 13); g.fill();
    g.fillStyle = '#cbd5e1'; ell(g, x, y, 24, 14); g.fill();
    g.fillStyle = '#60a5fa'; ell(g, x, y, 19, 10.5); g.fill();
    g.fillStyle = '#bfdbfe'; ell(g, x - 4, y - 3, 8, 3.5); g.fill();
    g.fillStyle = '#e2e8f0'; rr(g, x - 3, y - 14, 6, 14, 2); g.fill();
    g.fillStyle = 'rgba(219,234,254,.9)'; ell(g, x, y - 15, 7, 4); g.fill();
  }
  function artBench(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x - 10, y + 1, 22, 3);
    g.fillStyle = '#92400e'; g.fillRect(x - 11, y - 8, 22, 3); g.fillRect(x - 11, y - 3.5, 22, 3);
    g.fillStyle = '#334155'; g.fillRect(x - 9, y - 1, 2, 3); g.fillRect(x + 7, y - 1, 2, 3);
  }
  function artLamp(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,.18)'; ell(g, x + 2, y + 1, 4, 1.6); g.fill();
    g.fillStyle = '#334155'; g.fillRect(x - 1, y - 24, 2, 24);
    g.fillStyle = '#1e293b'; rr(g, x - 3.5, y - 28, 7, 5, 2); g.fill();
    g.fillStyle = '#fef08a'; rr(g, x - 2.2, y - 26.5, 4.4, 2.6, 1); g.fill();
  }
  function artFlag(g, x, y, col) {
    g.fillStyle = 'rgba(0,0,0,.18)'; ell(g, x + 3, y + 1, 5, 2); g.fill();
    g.fillStyle = '#94a3b8'; g.fillRect(x - 1, y - 54, 2.2, 54);
    g.fillStyle = col; g.beginPath(); g.moveTo(x + 1, y - 53); g.quadraticCurveTo(x + 12, y - 56, x + 24, y - 51); g.lineTo(x + 24, y - 39); g.quadraticCurveTo(x + 12, y - 44, x + 1, y - 41); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + 1, y - 47); g.quadraticCurveTo(x + 12, y - 50, x + 24, y - 45); g.lineTo(x + 24, y - 39); g.quadraticCurveTo(x + 12, y - 44, x + 1, y - 41); g.closePath(); g.fill();
  }
  function artBarn(g, x, y) {
    // a little red farm barn with hay bales
    const w = 84, d = 54, h = 34, bx = x - w / 2, by = y - d / 2 + 10;
    g.fillStyle = 'rgba(20,50,10,.25)'; rr(g, bx + 8, by - h + 8, w + 2, d + h - 4, 6); g.fill();
    const wy = by + d - h;
    g.fillStyle = '#dc2626'; g.fillRect(bx, wy, w, h);
    g.fillStyle = '#fff'; g.fillRect(bx + w / 2 - 13, wy + 8, 26, h - 8);
    g.fillStyle = '#b91c1c'; g.fillRect(bx + w / 2 - 11, wy + 10, 22, h - 10);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx + w / 2 - 11, wy + 10); g.lineTo(bx + w / 2 + 11, wy + h); g.moveTo(bx + w / 2 + 11, wy + 10); g.lineTo(bx + w / 2 - 11, wy + h); g.stroke();
    g.fillStyle = '#7f1d1d'; g.beginPath(); g.moveTo(bx - 5, by - h + d * 0.45); g.lineTo(bx + 10, by - h - 2); g.lineTo(bx + w - 10, by - h - 2); g.lineTo(bx + w + 5, by - h + d * 0.45); g.closePath(); g.fill();
    g.fillStyle = '#991b1b'; g.fillRect(bx - 5, by - h + d * 0.45, w + 10, d * 0.55 + 2);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(bx - 5, by - h + d * 0.45, w + 10, 3);
    for (const [hx, hy] of [[x + 58, y + 26], [x + 70, y + 12], [x - 62, y + 30]]) {
      g.fillStyle = 'rgba(0,0,0,.18)'; ell(g, hx + 3, hy + 2, 10, 4); g.fill();
      g.fillStyle = '#eab308'; ell(g, hx, hy - 5, 10, 8); g.fill();
      g.strokeStyle = '#ca8a04'; g.lineWidth = 1.2; g.beginPath(); g.arc(hx, hy - 5, 5, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = '#a16207'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 95, y + 52); g.lineTo(x + 95, y + 52); g.moveTo(x - 95, y + 44); g.lineTo(x + 95, y + 44); g.stroke();
    g.fillStyle = '#854d0e'; for (let k = -95; k <= 95; k += 19) g.fillRect(x + k - 1.5, y + 40, 3, 15);
  }
  function artStar(g, x, y, r1, r2, col) {
    g.fillStyle = col; g.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rad = k % 2 ? r2 : r1; g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
    g.closePath(); g.fill();
  }

  // ---------- Town generation ----------
  let T = null;
  function genTown(seed) {
    const r = CG.rng((seed ^ 0x51ab3) >>> 0);
    const t = { seed, nodes: [], blocks: [], ground: [], road: [], obj: [], spots: [], duckSites: [], shops: {}, parks: [] };
    const add = (layer, x0, y0, x1, y1, z, fn) => t[layer].push({ x0, y0, x1, y1, z, fn });
    for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) {
      const corner = (i === 0 || i === NB) && (j === 0 || j === NB);
      t.nodes.push({ i, j, x: roadC(i), y: roadC(j), lights: !corner, off: Math.floor(r() * 16), broken: false, manual: null });
    }
    // block kinds
    const kinds = new Array(NB * NB).fill('houses');
    const id = (i, j) => j * NB + i;
    kinds[id(2, 2)] = 'police';
    const freeList = () => kinds.map((k, n) => (k === 'houses' ? n : -1)).filter((n) => n >= 0);
    let parks = 0, tries = 0;
    while (parks < 4 && tries++ < 200) {
      const n = pick(r, freeList()), bi = n % NB, bj = Math.floor(n / NB);
      if (bj === NB - 1) continue;    // the duck pond sits on a park's south side, so not on the edge row
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const ii = bi + a, jj = bj + b; return ii >= 0 && jj >= 0 && ii < NB && jj < NB && (kinds[id(ii, jj)] === 'park' || kinds[id(ii, jj)] === 'police'); });
      if (near && tries < 150) continue;
      kinds[n] = 'park'; parks++;
    }
    kinds[pick(r, freeList())] = 'school';
    for (let k = 0; k < 7; k++) kinds[pick(r, freeList())] = 'shops';
    // shop names: the bakery and the ice cream shop exactly once
    const shopBlocks = kinds.map((k, n) => (k === 'shops' ? n : -1)).filter((n) => n >= 0);
    const extra = SHOP_LIST.slice(2);
    const shopNames = [SHOP_LIST[0], SHOP_LIST[1]];
    while (shopNames.length < shopBlocks.length * 3) shopNames.push(...shuffle(extra.slice(), r));
    shopNames.length = shopBlocks.length * 3;
    const firstTwo = shopNames.splice(0, 2); shuffle(shopNames, r);
    shopNames.splice(Math.floor(r() * 4), 0, firstTwo[0]); shopNames.splice(5 + Math.floor(r() * 6), 0, firstTwo[1]);
    let shopK = 0, parkK = 0;

    // spots: places on a lane next to a curb (for pick-ups and drop-offs)
    function spotH(j, x, below, kind, label, extraProps) {
      const i0 = clamp(Math.floor((x - roadC(0)) / PITCH), 0, NB - 1);
      const s = below
        ? { x, y: roadC(j) + LANE, i: i0, j, d: 0, s: x - roadC(i0), nx: 0, ny: 1 }
        : { x, y: roadC(j) - LANE, i: i0 + 1, j, d: 2, s: roadC(i0 + 1) - x, nx: 0, ny: -1 };
      s.kind = kind; s.label = label; s.street = H_ST[j];
      Object.assign(s, extraProps || {});
      t.spots.push(s);
      return s;
    }
    function spotV(i, y, east, kind, label, extraProps) {
      const j0 = clamp(Math.floor((y - roadC(0)) / PITCH), 0, NB - 1);
      const s = east
        ? { x: roadC(i) + LANE, y, i, j: j0 + 1, d: 3, s: roadC(j0 + 1) - y, nx: 1, ny: 0 }
        : { x: roadC(i) - LANE, y, i, j: j0, d: 1, s: y - roadC(j0), nx: -1, ny: 0 };
      s.kind = kind; s.label = label; s.street = V_ST[i];
      Object.assign(s, extraProps || {});
      t.spots.push(s);
      return s;
    }

    // the whole town's asphalt and the outer sidewalk
    add('ground', TOWN0 - SW, TOWN0 - SW, TOWN1 + SW, TOWN1 + SW, 0, (g) => {
      g.fillStyle = CURB; rr(g, TOWN0 - SW - 2, TOWN0 - SW - 2, TOWN1 - TOWN0 + SW * 2 + 4, TOWN1 - TOWN0 + SW * 2 + 4, 20); g.fill();
      g.fillStyle = WALK; rr(g, TOWN0 - SW, TOWN0 - SW, TOWN1 - TOWN0 + SW * 2, TOWN1 - TOWN0 + SW * 2, 18); g.fill();
      g.fillStyle = ASPH; rr(g, TOWN0, TOWN0, TOWN1 - TOWN0, TOWN1 - TOWN0, 10); g.fill();
    });
    // asphalt patches
    for (let k = 0; k < 70; k++) {
      const h = r() < 0.5, idx = Math.floor(r() * NN), along = TOWN0 + r() * (TOWN1 - TOWN0), c = roadC(idx) + (r() - 0.5) * 60;
      const px = h ? along : c, py = h ? c : along, pw = 14 + r() * 30, ph = 8 + r() * 14;
      add('road', px - pw, py - ph, px + pw, py + ph, 0, (g) => { g.fillStyle = ASPH_D; ell(g, px, py, h ? pw : ph, h ? ph : pw); g.fill(); });
    }
    // road markings
    for (let j = 0; j < NN; j++) for (let i = 0; i < NB; i++) {
      // horizontal edge (i,j)-(i+1,j) and vertical edge (j,i)-(j,i+1)
      for (const hz of [true, false]) {
        const a = roadC(i) + R / 2, b = roadC(i + 1) - R / 2, c = roadC(j);
        const x0 = hz ? a : c - R / 2, y0 = hz ? c - R / 2 : a, x1 = hz ? b : c + R / 2, y1 = hz ? c + R / 2 : b;
        add('road', x0, y0, x1, y1, 1, (g) => {
          g.fillStyle = '#facc15';
          for (let s = a + 32; s < b - 32; s += 34) { if (hz) g.fillRect(s, c - 1.6, 18, 3.2); else g.fillRect(c - 1.6, s, 3.2, 18); }
          g.fillStyle = 'rgba(255,255,255,.55)';
          if (hz) { g.fillRect(a + 30, c - R / 2 + 4, b - a - 60, 1.6); g.fillRect(a + 30, c + R / 2 - 5.6, b - a - 60, 1.6); }
          else { g.fillRect(c - R / 2 + 4, a + 30, 1.6, b - a - 60); g.fillRect(c + R / 2 - 5.6, a + 30, 1.6, b - a - 60); }
        });
      }
    }
    // crosswalks + stop lines at every junction arm
    for (const n of t.nodes) {
      const { x, y } = n;
      add('road', x - R / 2 - 30, y - R / 2 - 30, x + R / 2 + 30, y + R / 2 + 30, 2, (g) => {
        for (let d = 0; d < 4; d++) {
          if (!validDir(n.i, n.j, d)) continue;
          const dx = DIRS[d][0], dy = DIRS[d][1];
          g.fillStyle = '#f8fafc';
          // zebra stripes across this arm, 2..16 units out from the box
          for (let k = -R / 2 + 6; k < R / 2 - 4; k += 10) {
            if (dx) g.fillRect(x + dx * (R / 2 + 2) - (dx < 0 ? 14 : 0), y + k, 14, 6);
            else g.fillRect(x + k, y + dy * (R / 2 + 2) - (dy < 0 ? 14 : 0), 6, 14);
          }
          // stop line on the lane coming in from this arm (that lane drives in direction (d+2)%4)
          if (n.lights) {
            const ind = (d + 2) % 4, rx = -DIRS[ind][1], ry = DIRS[ind][0];
            const cx = x + dx * (R / 2 + 22) + rx * LANE, cy = y + dy * (R / 2 + 22) + ry * LANE;
            if (dx) g.fillRect(cx - 2, cy - 21, 4, 42); else g.fillRect(cx - 21, cy - 2, 42, 4);
          }
        }
      });
    }

    const tree = (x, y, rad) => { const k = Math.floor(r() * 3); add('obj', x - rad * 1.6, y - rad * 2.3, x + rad * 1.6, y + rad * 0.6, y, (g) => artTree(g, x, y, rad, k)); };
    const lamp = (x, y) => add('obj', x - 5, y - 30, x + 5, y + 3, y, (g) => artLamp(g, x, y));
    // blocks
    for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) {
      const kind = kinds[id(bi, bj)];
      const bx = blkX(bi), by = blkX(bj), ix = bx + SW, iy = by + SW, iw = BLK - SW * 2;
      const blk = { bi, bj, kind, x: bx, y: by };
      t.blocks.push(blk);
      const paved = kind === 'shops' || kind === 'police' || kind === 'school';
      add('ground', bx, by, bx + BLK, by + BLK, 1, (g) => {
        g.fillStyle = CURB; rr(g, bx - 1.5, by - 1.5, BLK + 3, BLK + 3, 17); g.fill();
        g.fillStyle = WALK; rr(g, bx, by, BLK, BLK, 16); g.fill();
        g.strokeStyle = WALK_D; g.lineWidth = 1; g.beginPath();
        for (let k = 24; k < BLK - 16; k += 24) { g.moveTo(bx + k, by); g.lineTo(bx + k, by + SW); g.moveTo(bx + k, by + BLK - SW); g.lineTo(bx + k, by + BLK); g.moveTo(bx, by + k); g.lineTo(bx + SW, by + k); g.moveTo(bx + BLK - SW, by + k); g.lineTo(bx + BLK, by + k); }
        g.stroke();
        g.fillStyle = paved ? '#e9e2cf' : GRASS; rr(g, ix, iy, iw, iw, 6); g.fill();
        if (!paved) { g.fillStyle = 'rgba(0,0,0,.05)'; rr(g, ix, iy, iw, 3, 2); g.fill(); }
      });
      // a couple of street lamps on each block's sidewalk
      lamp(bx + 9, by + BLK / 2); lamp(bx + BLK - 9, by + BLK / 2 + 40);

      if (kind === 'houses') {
        const lw = iw / 3, lh = iw / 2;
        const roofs = ['#ef4444', '#3b82f6', '#14b8a6', '#f97316', '#a855f7', '#e11d48', '#0ea5e9', '#65a30d', '#b45309'];
        const walls = ['#fff7ed', '#fefce8', '#f0f9ff', '#fdf2f8', '#f7fee7', '#fffbeb', '#eef2ff'];
        for (let row = 0; row < 2; row++) for (let c = 0; c < 3; c++) {
          const lx = ix + c * lw, ly = iy + row * lh;
          const w = 62 + Math.floor(r() * 16), d = 46 + Math.floor(r() * 10), h = 22 + Math.floor(r() * 7);
          const hx = lx + (lw - w) / 2 + (r() - 0.5) * 8;
          const hy = row === 0 ? ly + h + 18 + Math.floor(r() * 6) : ly + 34 + Math.floor(r() * 8);
          const o = { roof: pick(r, roofs), wall: pick(r, walls), door: 0.35 + r() * 0.3, doorCol: pick(r, ['#92400e', '#1d4ed8', '#be123c', '#047857', '#7c3aed']), chimney: r() < 0.5 };
          add('obj', hx - 6, hy - h - 6, hx + w + 12, hy + d + 4, hy + d, (g) => artHouse(g, hx, hy, w, d, h, o));
          // front path, fence and garden
          if (row === 1) {
            const px = hx + w * o.door - 3;
            add('ground', px - 2, hy + d, px + 10, iy + iw + 1, 3, (g) => { g.fillStyle = '#e7dcc6'; g.fillRect(px, hy + d, 8, iy + iw - hy - d); g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 1; g.beginPath(); for (let k = hy + d + 6; k < iy + iw; k += 7) { g.moveTo(px, k); g.lineTo(px + 8, k); } g.stroke(); });
          }
          if (c < 2) { const fx = lx + lw; add('ground', fx - 2, ly + 4, fx + 2, ly + lh - 4, 3, (g) => { g.fillStyle = '#b08350'; g.fillRect(fx - 1, ly + 8, 2, lh - 16); for (let k = ly + 8; k < ly + lh - 8; k += 9) g.fillRect(fx - 2, k, 4, 3); }); }
          if (r() < 0.6) { const bx2 = hx + w + 8 + r() * 6, by2 = hy + d - 2; if (bx2 < lx + lw - 6) { const fl = pick(r, ['#f472b6', '#facc15', '#fb7185', null]); add('obj', bx2 - 10, by2 - 14, bx2 + 10, by2 + 3, by2, (g) => artBush(g, bx2, by2, 7, fl)); } }
          // the yard tree (kittens like to climb it)
          const tr = 13 + Math.floor(r() * 4);
          const tx = c === 0 ? lx + 16 : c === 2 ? lx + lw - 16 : lx + (r() < 0.5 ? 14 : lw - 14);
          const ty = row === 0 ? Math.min(hy + d - 4, ly + lh - 8) : ly + lh - 18;
          tree(tx, ty, tr);
          if (row === 1 && r() < 0.6) { const fbx = lx + 10 + r() * (lw - 50); const fby = ly + lh - 34; const fr = CG.rng(Math.floor(r() * 1e9)); add('ground', fbx, fby, fbx + 32, fby + 12, 4, (g) => artFlowerBed(g, fbx, fby, 32, 12, fr)); }
          const cx = lx + lw / 2, num = 2 * (bi * 3 + c) + (row ? 2 : 1) + 10;
          const sp = row === 0
            ? spotH(bj, cx, true, 'house', `${num} ${H_ST[bj]}`, { tree: { x: tx, y: ty, r: tr } })
            : spotH(bj + 1, cx, false, 'house', `${num} ${H_ST[bj + 1]}`, { tree: { x: tx, y: ty, r: tr } });
          sp.blk = blk;
        }
      } else if (kind === 'shops') {
        const sw = iw / 3;
        for (let k = 0; k < 3; k++) {
          const s = shopNames[shopK++];
          const w = sw - 12, d = 70, h = 34, x = ix + k * sw + 6, y = iy + iw - 4 - d;
          add('obj', x - 4, y - h - 4, x + w + 10, y + d + 2, y + d, (g) => artShop(g, x, y, w, d, h, s));
          const sp = spotH(bj + 1, x + w / 2, false, 'shop', `the ${s.title} on ${H_ST[bj + 1]}`, { shop: s.key });
          sp.blk = blk;
          if (!t.shops[s.key]) t.shops[s.key] = sp;
        }
        // car park behind, with a few parked cars
        const px = ix + 10, py = iy + 12, pw = iw - 20, ph = 150;
        const parked = [];
        for (let k = 0; k < 8; k++) if (r() < 0.45) parked.push([k, pick(r, CAR_COLORS), pick(r, ['sedan', 'hatch', 'van'])]);
        add('ground', px, py, px + pw, py + ph, 3, (g) => {
          artParking(g, px, py, pw, ph, 8, false);
          g.fillStyle = '#5b6170'; g.fillRect(px + 8, py + 60, pw - 16, 30);
          for (const [k, col, ty] of parked) parkedCar(g, px + 6 + (k + 0.5) * (pw - 12) / 8, py + 30, Math.PI / 2, ty, col);
        });
        for (let k = 0; k < 4; k++) { const tx = ix + 30 + k * (iw - 60) / 3; tree(tx, iy + 190, 12); }
      } else if (kind === 'police') {
        const w = 230, d = 96, h = 42, x = ix + (iw - w) / 2, y = iy + iw - 24 - d;
        const s = { name: 'POLICE', wall: '#e0e7ff', awn: '#1d4ed8', sign: '#1d4ed8', roof: '#cbd5e1' };
        add('obj', x - 4, y - h - 4, x + w + 10, y + d + 2, y + d, (g) => {
          artShop(g, x, y, w, d, h, s);
          // big badge on the roof
          artStar(g, x + 40, y - h + 34, 20, 9, '#facc15'); artStar(g, x + 40, y - h + 34, 14, 6.5, '#f59e0b');
          g.fillStyle = '#1d4ed8'; circ(g, x + 40, y - h + 34, 5); g.fill();
          // rooftop helipad
          const hx = x + w - 46, hy = y - h + 30;
          g.fillStyle = '#94a3b8'; circ(g, hx, hy, 23); g.fill();
          g.fillStyle = '#475569'; circ(g, hx, hy, 21); g.fill();
          g.strokeStyle = '#facc15'; g.lineWidth = 2.5; circ(g, hx, hy, 16.5); g.stroke();
          g.fillStyle = '#fff'; g.font = `900 17px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', hx, hy + 1);
          for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; g.fillStyle = '#fde047'; circ(g, hx + Math.cos(a) * 21, hy + Math.sin(a) * 21, 1.8); g.fill(); }
          // blue trim and a pair of roof vents
          g.fillStyle = '#1d4ed8'; g.fillRect(x - 2, y - h - 2, w + 4, 4);
          g.fillStyle = '#cbd5e1'; rr(g, x + 90, y - h + 12, 18, 12, 2); g.fill(); rr(g, x + 116, y - h + 12, 18, 12, 2); g.fill();
          g.fillStyle = '#94a3b8'; circ(g, x + 99, y - h + 18, 4); g.fill(); circ(g, x + 125, y - h + 18, 4); g.fill();
          // steps
          g.fillStyle = '#e2e8f0'; g.fillRect(x + w / 2 - 22, y + d, 44, 6); g.fillStyle = '#cbd5e1'; g.fillRect(x + w / 2 - 22, y + d + 6, 44, 5);
        });
        const fx = x + w + 18, fy = y + d - 6;
        add('obj', fx - 6, fy - 58, fx + 28, fy + 3, fy, (g) => artFlag(g, fx, fy, '#dc2626'));
        const px = ix + 14, py = iy + 12, pw = iw - 28, ph = 112;
        add('ground', px, py, px + pw, py + ph, 3, (g) => {
          artParking(g, px, py, pw, ph, 7, false);
          for (const k of [1, 2, 4]) parkedCar(g, px + 6 + (k + 0.5) * (pw - 12) / 7, py + 30, -Math.PI / 2, 'police', '#ffffff');
          parkedCar(g, px + 6 + 5.5 * (pw - 12) / 7, py + 30, -Math.PI / 2, 'van', '#1d4ed8');
        });
        for (const k of [0, 1]) tree(k ? ix + iw - 18 : ix + 18, iy + iw - 30, 14);
        const sp = spotH(bj + 1, ix + iw / 2, false, 'police', 'the Police Station');
        sp.blk = blk;
        t.station = sp;
      } else if (kind === 'school') {
        const w = 190, d = 92, h = 38, x = ix + 14, y = iy + iw - 22 - d;
        const s = { name: 'SCHOOL', wall: '#fde2c8', awn: '#dc2626', sign: '#b91c1c', roof: '#e7c8b0' };
        add('obj', x - 4, y - h - 4, x + w + 10, y + d + 2, y + d, (g) => {
          artShop(g, x, y, w, d, h, s);
          g.fillStyle = '#facc15'; circ(g, x + 26, y - h + 26, 9); g.fill(); g.strokeStyle = '#a16207'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 26, y - h + 26); g.lineTo(x + 26, y - h + 20); g.moveTo(x + 26, y - h + 26); g.lineTo(x + 30, y - h + 28); g.stroke();
        });
        // court + field
        const cx = ix + 220, cy = iy + 160, cw = 128, chh = 170;
        add('ground', cx, cy, cx + cw, cy + chh, 3, (g) => {
          g.fillStyle = '#f97316'; rr(g, cx, cy, cw, chh, 6); g.fill();
          g.strokeStyle = '#fff'; g.lineWidth = 2; rr(g, cx + 8, cy + 8, cw - 16, chh - 16, 3); g.stroke();
          g.beginPath(); g.moveTo(cx + 8, cy + chh / 2); g.lineTo(cx + cw - 8, cy + chh / 2); g.stroke();
          circ(g, cx + cw / 2, cy + chh / 2, 16); g.stroke();
        });
        const fx = ix + 12, fy = iy + 12, fw = iw - 24, fh = 130;
        add('ground', fx, fy, fx + fw, fy + fh, 3, (g) => {
          g.fillStyle = '#6fbf4a'; rr(g, fx, fy, fw, fh, 8); g.fill();
          g.fillStyle = 'rgba(255,255,255,.08)'; for (let k = 0; k < 6; k++) if (k % 2) g.fillRect(fx + k * fw / 6, fy, fw / 6, fh);
          g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; rr(g, fx + 10, fy + 10, fw - 20, fh - 20, 2); g.stroke();
          g.beginPath(); g.moveTo(fx + fw / 2, fy + 10); g.lineTo(fx + fw / 2, fy + fh - 10); g.stroke(); circ(g, fx + fw / 2, fy + fh / 2, 18); g.stroke();
          g.strokeRect(fx + 10, fy + fh / 2 - 22, 22, 44); g.strokeRect(fx + fw - 32, fy + fh / 2 - 22, 22, 44);
        });
        tree(ix + 200, iy + iw - 26, 13);
        const sp = spotH(bj + 1, x + w / 2, false, 'school', 'the School');
        sp.blk = blk;
        t.school = sp;
      } else if (kind === 'park') {
        const name = PARK_NAMES[parkK++ % PARK_NAMES.length];
        const pr = CG.rng(Math.floor(r() * 1e9));
        // winding path loop
        add('ground', ix, iy, ix + iw, iy + iw, 2, (g) => {
          g.strokeStyle = '#e9d8b4'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
          rr(g, ix + 52, iy + 52, iw - 104, iw - 104, 60); g.stroke();
          g.beginPath(); g.moveTo(ix + iw / 2, iy); g.lineTo(ix + iw / 2, iy + 52); g.moveTo(ix, iy + iw / 2); g.lineTo(ix + 52, iy + iw / 2); g.moveTo(ix + iw, iy + iw / 2); g.lineTo(ix + iw - 52, iy + iw / 2); g.stroke();
          g.strokeStyle = 'rgba(0,0,0,.05)'; g.lineWidth = 2; rr(g, ix + 52, iy + 52, iw - 104, iw - 104, 60); g.stroke();
        });
        // pond near the south side (ducks live here)
        const left = r() < 0.5;
        const pcx = left ? ix + 96 : ix + iw - 96, pcy = iy + iw - 70;
        add('ground', pcx - 80, pcy - 50, pcx + 80, pcy + 50, 3, (g) => artPond(g, pcx, pcy, 66, 38, CG.rng(seed + bi * 7 + bj)));
        // playground and fountain
        const plx = left ? ix + iw - 150 : ix + 40, ply = iy + 40;
        add('ground', plx, ply, plx + 110, ply + 80, 3, (g) => artPlayground(g, plx, ply, 110, 80));
        add('obj', ix + iw / 2 - 26, iy + iw / 2 - 20, ix + iw / 2 + 26, iy + iw / 2 + 16, iy + iw / 2 + 12, (g) => artFountain(g, ix + iw / 2, iy + iw / 2 + 4));
        const fbr = CG.rng(Math.floor(r() * 1e9));
        add('ground', ix + iw / 2 - 40, iy + iw / 2 - 52, ix + iw / 2 + 40, iy + iw / 2 - 36, 4, (g) => artFlowerBed(g, ix + iw / 2 - 40, iy + iw / 2 - 52, 80, 14, fbr));
        for (const [bx2, by2] of [[ix + iw / 2 - 60, iy + iw / 2 + 30], [ix + iw / 2 + 50, iy + iw / 2 + 30]]) add('obj', bx2 - 12, by2 - 10, bx2 + 12, by2 + 4, by2, (g) => artBench(g, bx2, by2));
        // trees around the edge (leave the gates and the pond free)
        for (let k = 0; k < 16; k++) {
          const side = k % 4, u = 0.1 + pr() * 0.8;
          let x, y;
          if (side === 0) { x = ix + u * iw; y = iy + 44; } else if (side === 1) { x = ix + iw - 16; y = iy + 40 + u * (iw - 60); } else if (side === 2) { x = ix + u * iw; y = iy + iw - 10; } else { x = ix + 16; y = iy + 40 + u * (iw - 60); }
          if (Math.abs(x - (ix + iw / 2)) < 26 || Math.abs(y - (iy + iw / 2)) < 26) continue;
          if (Math.abs(x - pcx) < 92 && y > pcy - 60) continue;
          if (x > plx - 12 && x < plx + 122 && y > ply - 10 && y < ply + 104) continue;
          tree(x, y, 13 + pr() * 6);
        }
        for (let k = 0; k < 5; k++) { const x = ix + 70 + pr() * (iw - 140), y = iy + 120 + pr() * 120; if (Math.abs(x - (ix + iw / 2)) < 50 && Math.abs(y - (iy + iw / 2)) < 50) continue; const fl = pick(pr, ['#f472b6', '#facc15', null]); add('obj', x - 10, y - 14, x + 10, y + 3, y, (g) => artBush(g, x, y, 8, fl)); }
        const label = name;
        const sps = [spotH(bj, ix + iw / 2, true, 'park', label), spotV(bi, iy + iw / 2, true, 'park', label), spotV(bi + 1, iy + iw / 2, false, 'park', label)];
        if (bj + 1 <= NB) sps.push(spotH(bj + 1, left ? ix + iw - 60 : ix + 60, false, 'park', label));
        sps.forEach((s) => { s.blk = blk; });
        t.parks.push({ name, spots: sps, blk });
        // ducks cross the south road from the pond
        t.duckSites.push({ x: pcx, j: bj + 1, roadY: roadC(bj + 1), yA: roadC(bj + 1) - R / 2 - 9, yB: roadC(bj + 1) + R / 2 + 9, park: name, pond: { x: pcx, y: pcy } });
      }
    }
    // the countryside: trees, bushes and flowers around the town, a fence at the world edge
    const or = CG.rng(seed ^ 0x77);
    // corners: two farms and two ponds
    const cornerC = [[115, 125], [WORLD - 115, 125], [115, WORLD - 110], [WORLD - 115, WORLD - 110]];
    const farms = or() < 0.5 ? [0, 3] : [1, 2];
    cornerC.forEach(([x, y], k) => {
      if (farms.includes(k)) {
        add('obj', x - 70, y - 70, x + 80, y + 50, y + 20, (g) => artBarn(g, x, y));
      } else {
        const pr = CG.rng(seed + k * 31);
        add('ground', x - 90, y - 60, x + 90, y + 60, 3, (g) => artPond(g, x, y, 78, 46, pr));
      }
    });
    const nearCorner = (x, y) => cornerC.some(([cx, cy]) => Math.abs(x - cx) < 105 && Math.abs(y - cy) < 85);
    for (let k = 0; k < 40; k++) {
      const x = 30 + or() * (WORLD - 60), y = 50 + or() * (WORLD - 80);
      if (x > TOWN0 - SW - 60 && x < TOWN1 + SW + 60 && y > TOWN0 - SW - 50 && y < TOWN1 + SW + 70) continue;
      if (nearCorner(x, y)) continue;
      const fr = CG.rng(Math.floor(or() * 1e9));
      add('ground', x - 30, y - 12, x + 30, y + 12, 3, (g) => { for (let q = 0; q < 14; q++) { const fx = x - 26 + fr() * 52, fy = y - 9 + fr() * 18; blobs(g, [[fx - 1.6, fy, 1.6], [fx + 1.6, fy, 1.6], [fx, fy - 1.6, 1.6], [fx, fy + 1.6, 1.6]], ['#ffffff', '#fde047', '#f9a8d4', '#c4b5fd'][q % 4]); blobs(g, [[fx, fy, 1]], '#f59e0b'); } });
    }
    for (let k = 0; k < 340; k++) {
      let x = or() * WORLD, y = or() * WORLD;
      if (x > TOWN0 - SW - 30 && x < TOWN1 + SW + 30 && y > TOWN0 - SW - 10 && y < TOWN1 + SW + 56) continue;
      if (nearCorner(x, y)) continue;
      if (x < 20 || y < 50 || x > WORLD - 20 || y > WORLD - 14) continue;
      if (or() < 0.7) tree(x, y, 14 + or() * 9); else { const fl = pick(or, ['#f472b6', '#facc15', '#a78bfa', null]); add('obj', x - 12, y - 16, x + 12, y + 3, y, (g) => artBush(g, x, y, 9, fl)); }
    }
    add('ground', 0, 0, WORLD, WORLD, 5, (g) => {
      g.strokeStyle = '#a16207'; g.lineWidth = 3;
      g.strokeRect(10, 10, WORLD - 20, WORLD - 20);
      g.fillStyle = '#ca8a04';
      for (let k = 10; k < WORLD - 10; k += 26) { g.fillRect(k - 2, 6, 4, 9); g.fillRect(k - 2, WORLD - 15, 4, 9); g.fillRect(6, k - 2, 9, 4); g.fillRect(WORLD - 15, k - 2, 9, 4); }
    });
    t.obj.sort((a, b) => a.z - b.z);
    t.ground.sort((a, b) => a.z - b.z);
    t.road.sort((a, b) => a.z - b.z);
    if (!t.station) t.station = t.spots[0];
    t.start = { x: t.station.x - 40, y: t.station.y, a: Math.PI };
    return t;
  }
  const nodeAt = (i, j) => T.nodes[j * NN + i];

  // ---------- Chunks (pre-rendered static town) ----------
  const chunks = new Map();
  let frameNo = 0, maxChunks = 16;
  function clearChunks() { chunks.clear(); }
  function buildChunk(cx, cy) {
    const x0 = cx * CH - PAD, y0 = cy * CH - PAD, size = CH + PAD * 2;
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * rs);
    const g = c.getContext('2d', { alpha: false });
    g.setTransform(rs, 0, 0, rs, -x0 * rs, -y0 * rs);
    g.fillStyle = GRASS; g.fillRect(x0, y0, size, size);
    // grass tufts and little flowers (hashed per cell so chunks line up)
    const cell = 30;
    for (let gy = Math.floor(y0 / cell) - 1; gy <= Math.ceil((y0 + size) / cell); gy++) for (let gx = Math.floor(x0 / cell) - 1; gx <= Math.ceil((x0 + size) / cell); gx++) {
      const h = hash2(gx, gy, T.seed);
      if (h % 3) continue;
      const px = gx * cell + (h >>> 4) % cell, py = gy * cell + (h >>> 9) % cell;
      if ((h >>> 14) % 9 === 0) { blobs(g, [[px - 1.8, py, 1.5], [px + 1.8, py, 1.5], [px, py - 1.8, 1.5], [px, py + 1.8, 1.5]], ['#ffffff', '#fde047', '#f9a8d4'][(h >>> 18) % 3]); blobs(g, [[px, py, 1]], '#f59e0b'); }
      else { g.strokeStyle = GRASS_D; g.lineWidth = 1.4; g.beginPath(); g.moveTo(px - 3, py); g.lineTo(px - 1, py - 4); g.moveTo(px, py); g.lineTo(px + 0.5, py - 5); g.moveTo(px + 3, py); g.lineTo(px + 2, py - 4); g.stroke(); }
    }
    const x1 = x0 + size, y1 = y0 + size;
    for (const layer of [T.ground, T.road, T.obj]) {
      for (const it of layer) {
        if (it.x1 < x0 || it.x0 > x1 || it.y1 < y0 || it.y0 > y1) continue;
        g.save(); it.fn(g); g.restore();
      }
    }
    return c;
  }
  function chunk(cx, cy) {
    const key = cx * 1000 + cy;
    let e = chunks.get(key);
    if (!e) {
      e = { c: buildChunk(cx, cy), used: frameNo };
      chunks.set(key, e);
      if (chunks.size > maxChunks) {
        let oldK = null, oldU = Infinity;
        for (const [k, v] of chunks) if (v.used < oldU && v.used < frameNo) { oldU = v.used; oldK = k; }
        if (oldK != null) chunks.delete(oldK);
      }
    }
    e.used = frameNo;
    return e.c;
  }
  function prefetch(vx0, vy0, vx1, vy1) {
    // build at most one chunk per frame just outside the view, in the direction we are heading
    const m = 260, ax = Math.cos(P.a) * m, ay = Math.sin(P.a) * m;
    const cands = [[vx0 + ax, vy0 + ay], [vx1 + ax, vy0 + ay], [vx0 + ax, vy1 + ay], [vx1 + ax, vy1 + ay], [(vx0 + vx1) / 2 + ax, (vy0 + vy1) / 2 + ay]];
    for (const [x, y] of cands) {
      const cx = Math.floor(clamp(x, 0, WORLD - 1) / CH), cy = Math.floor(clamp(y, 0, WORLD - 1) / CH);
      if (!chunks.has(cx * 1000 + cy)) { chunk(cx, cy); return; }
    }
  }

  // ---------- Minimap ----------
  let mapBase = null;
  function buildMinimap() {
    const S = 220, k = S / WORLD;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#7cc257'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#e9e5da'; g.fillRect((TOWN0 - SW) * k, (TOWN0 - SW) * k, (TOWN1 - TOWN0 + SW * 2) * k, (TOWN1 - TOWN0 + SW * 2) * k);
    g.fillStyle = '#7b8191'; g.fillRect(TOWN0 * k, TOWN0 * k, (TOWN1 - TOWN0) * k, (TOWN1 - TOWN0) * k);
    const col = { houses: '#f5d9b0', shops: '#fdba74', park: '#5fb246', police: '#60a5fa', school: '#fca5a5' };
    for (const b of T.blocks) { g.fillStyle = col[b.kind]; g.beginPath(); g.roundRect ? g.roundRect(b.x * k + 1, b.y * k + 1, BLK * k - 2, BLK * k - 2, 3) : g.rect(b.x * k + 1, b.y * k + 1, BLK * k - 2, BLK * k - 2); g.fill(); }
    for (const d of T.duckSites) { g.fillStyle = '#38bdf8'; ell(g, d.pond.x * k, d.pond.y * k, 5, 3); g.fill(); }
    mapBase = c;
  }

  // ---------- Traffic ----------
  let cars = [], peds = [], carId = 1, trafficR = Math.random;
  function makeCar(i, j, d, s, kind, type, color, vmax) {
    const c = { id: carId++, kind, type, color, i, j, d, s, mode: 'lane', u: 0, v: vmax * 0.7, vmax, lat: 0, latT: 0, x: 0, y: 0, a: d * Math.PI / 2, ghostT: 0, stuckT: 0, yieldT: 0, waitT: 0, route: null, dest: null, vOverride: null, ignoreLights: false, L: CAR_TYPES[type].L };
    lanePt(i, j, d, s, 0, tmpP); c.x = tmpP.x; c.y = tmpP.y;
    cars.push(c);
    return c;
  }
  function spawnTraffic(seed) {
    cars = []; peds = []; carId = 1;
    trafficR = CG.rng((seed ^ 0x7a11c) >>> 0);
    const r = trafficR;
    let n = 0, guard = 0;
    while (n < 44 && guard++ < 600) {
      const i = Math.floor(r() * NN), j = Math.floor(r() * NN), d = Math.floor(r() * 4);
      if (!validDir(i, j, d)) continue;
      const s = IN_S + 30 + r() * (STOP_S - IN_S - 60);
      if (cars.some((c) => c.i === i && c.j === j && c.d === d && Math.abs(c.s - s) < 90)) continue;
      lanePt(i, j, d, s, 0, tmpP);
      if (hyp(tmpP.x, tmpP.y, T.start.x, T.start.y) < 220) continue;
      const roll = r();
      const type = roll < 0.38 ? 'sedan' : roll < 0.62 ? 'hatch' : roll < 0.78 ? 'van' : roll < 0.92 ? 'taxi' : 'bus';
      const col = type === 'taxi' ? '#facc15' : type === 'bus' ? '#f59e0b' : pick(r, CAR_COLORS);
      makeCar(i, j, d, s, 'ai', type, col, type === 'bus' ? 80 : 105 + r() * 30);
      n++;
    }
    for (let k = 0; k < 64; k++) {
      peds.push({ b: Math.floor(r() * NB * NB), p: r() * PER * 4, dir: r() < 0.5 ? 1 : -1, sp: 16 + r() * 12, look: Math.floor(r() * LOOKS.length), mode: 'walk', x: 0, y: 0, hop: 0, step: r() * 10, cross: null, kid: r() < 0.3 });
    }
  }

  // Obstacles every car checks (besides other cars): the player, ducks, people on crosswalks.
  const extraObs = [];
  let blockerHit = null;
  function obstacleGap(c) {
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    let best = 1e9; blockerHit = null;
    const look = 70 + c.v * 0.6;
    for (let k = 0; k < cars.length; k++) {
      const o = cars[k];
      if (o === c) continue;
      const dx = o.x - c.x, dy = o.y - c.y;
      if (dx > look + 50 || dx < -look - 50 || dy > look + 50 || dy < -look - 50) continue;
      const f = dx * ca + dy * sa;
      if (f <= 0) continue;
      const l = -dx * sa + dy * ca;
      if (Math.abs(l) > 19) continue;
      const g = f - (c.L + o.L) / 2 - 7;
      if (g < best) { best = g; blockerHit = o; }
    }
    if (state === 'play' && !P.hidden && !(c.kind === 'truck' && c.pushT > 1.4)) {
      const dx = P.x - c.x, dy = P.y - c.y, f = dx * ca + dy * sa;
      if (f > 0 && f < look + 60) {
        const l = -dx * sa + dy * ca;
        if (Math.abs(l) < 22) { const g = f - c.L / 2 - 26; if (g < best) { best = g; blockerHit = P; } }
      }
    }
    for (let k = 0; k < extraObs.length; k++) {
      const o = extraObs[k], dx = o.x - c.x, dy = o.y - c.y, f = dx * ca + dy * sa;
      if (f <= 0 || f > look + 40) continue;
      const l = -dx * sa + dy * ca;
      if (Math.abs(l) > 18) continue;
      const g = f - c.L / 2 - 14;
      if (g < best) { best = g; blockerHit = o; }
    }
    return best;
  }
  function bezier(c, u) {
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, d = u * u;
    c.x = a * c.E.x + b * c.C.x + d * c.X.x;
    c.y = a * c.E.y + b * c.C.y + d * c.X.y;
    const tx = 2 * (1 - u) * (c.C.x - c.E.x) + 2 * u * (c.X.x - c.C.x), ty = 2 * (1 - u) * (c.C.y - c.E.y) + 2 * u * (c.X.y - c.C.y);
    if (tx || ty) c.a = Math.atan2(ty, tx);
  }
  function chooseDir(c, ti, tj) {
    if (c.route && c.route.length) return c.route.shift();
    const back = (c.d + 2) % 4, opts = [];
    for (let d = 0; d < 4; d++) if (d !== back && validDir(ti, tj, d)) opts.push(d);
    if (!opts.length) return back;
    if (c.kind === 'bandit') {
      // run away: pick the way whose next junction is furthest from the cruiser
      let best = opts[0], bs = -1;
      for (const d of opts) { const sc = hyp(roadC(ti + DIRS[d][0]), roadC(tj + DIRS[d][1]), P.x, P.y) + trafficR() * 220; if (sc > bs) { bs = sc; best = d; } }
      return best;
    }
    let tot = 0;
    const w = opts.map((d) => { const v = d === c.d ? 2.2 : 1; tot += v; return v; });
    let x = trafficR() * tot;
    for (let k = 0; k < opts.length; k++) { x -= w[k]; if (x <= 0) return opts[k]; }
    return opts[opts.length - 1];
  }
  function beginTurn(c) {
    const ti = c.i + DIRS[c.d][0], tj = c.j + DIRS[c.d][1];
    const nd = chooseDir(c, ti, tj);
    const E = lanePt(c.i, c.j, c.d, OUT_S, 0, { x: 0, y: 0 });
    const X = lanePt(ti, tj, nd, IN_S, 0, { x: 0, y: 0 });
    let C;
    if (nd === c.d) C = { x: (E.x + X.x) / 2, y: (E.y + X.y) / 2 };
    else if (c.d % 2 === 0) C = { x: X.x, y: E.y }; else C = { x: E.x, y: X.y };
    let len = 0, px = E.x, py = E.y;
    for (let k = 1; k <= 8; k++) {
      const u = k / 8, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, d = u * u;
      const x = a * E.x + b * C.x + d * X.x, y = a * E.y + b * C.y + d * X.y;
      len += Math.hypot(x - px, y - py); px = x; py = y;
    }
    c.E = E; c.C = C; c.X = X; c.tl = Math.max(10, len); c.nd = nd; c.ti = ti; c.tj = tj;
    c.u = (c.s - OUT_S) / c.tl; c.mode = 'turn'; c.lat = 0; c.latT = 0;
  }
  function carUpdate(c, dt) {
    let vmax = c.vOverride != null ? c.vOverride : c.vmax;
    // pull over a little when the cruiser comes up behind with its siren on
    if (c.kind === 'ai' && P.siren && state === 'play' && c.mode === 'lane') {
      const dx = P.x - c.x, dy = P.y - c.y, ca = Math.cos(c.a), sa = Math.sin(c.a);
      const f = dx * ca + dy * sa;
      if (f < -20 && f > -180 && Math.abs(-dx * sa + dy * ca) < 40 && Math.cos(P.a - c.a) > 0.6) { c.latT = 15; c.yieldT = 0.8; }
    }
    if (c.yieldT > 0) { c.yieldT -= dt; vmax = Math.min(vmax, 50); if (c.yieldT <= 0) c.latT = c.pullT || 0; }
    let gap = c.ghostT > 0 ? 1e9 : obstacleGap(c);
    const blocker = blockerHit;
    // the escorted truck honks at a cruiser parked in its way, then squeezes past
    if (c.kind === 'truck') {
      if (blocker === P && Math.abs(P.v) < 25 && c.vOverride == null) { c.pushT = (c.pushT || 0) + dt; if (c.pushT > 0.5 && !c.honked) { c.honked = true; SND.honk(); bubble('Beep! Let me pass!', c.x, c.y - 24, 1.4); } }
      else if (blocker !== P) { c.pushT = Math.max(0, (c.pushT || 0) - dt * 0.5); if (!c.pushT) c.honked = false; }
    }
    let lightGap = 1e9;
    if (c.mode === 'lane') {
      const n = nodeAt(c.i + DIRS[c.d][0], c.j + DIRS[c.d][1]);
      const toStop = STOP_S - c.s;
      if (n.manual) { if (n.manual.allow !== c.id && toStop > -6) lightGap = Math.max(0, toStop); }
      else if (!c.ignoreLights) {
        const L = lightOf(n, c.d % 2);
        if (L === 'r' || (L === 'y' && toStop > 30)) { if (toStop > -6) lightGap = Math.max(0, toStop); }
        else if (L === 'f' && toStop > -10) vmax = Math.min(vmax, 45 + Math.max(0, toStop) * 0.6);
      }
      if (c.s > STOP_S - 30 && c.latT && !c.pullT) c.latT = 0;
      if (c.pullT) c.latT = c.pullT;
      if (c.catchStop && c.stopAt == null) c.stopAt = Math.max(c.s + 15, Math.min(c.s + 60, STOP_S - 40));
      if (c.dest && c.dest.i === c.i && c.dest.j === c.j && c.dest.d === c.d && (!c.route || !c.route.length)) lightGap = Math.min(lightGap, Math.max(0, c.dest.s - c.s));
      if (c.stopAt != null) lightGap = Math.min(lightGap, Math.max(0, c.stopAt - c.s));
    }
    const g = Math.min(gap, lightGap);
    let vt = g < 1 ? 0 : Math.min(vmax, Math.sqrt(2 * 230 * g));
    if (c.v < vt) c.v = Math.min(vt, c.v + 130 * dt); else c.v = Math.max(vt, c.v - 420 * dt);
    // two cars stuck nose to nose in a junction: let one of them slide through
    if (c.v < 3 && gap < lightGap && gap < 40 && blocker && blocker !== P && blocker.mode && !(blocker.mode === 'lane' && c.mode === 'lane' && blocker.i === c.i && blocker.j === c.j && blocker.d === c.d) && (c.mode === 'turn' || blocker.mode === 'turn')) {
      c.stuckT += dt; if (c.stuckT > 3) { c.ghostT = 1.6; c.stuckT = 0; }
    } else c.stuckT = 0;
    if (c.ghostT > 0) c.ghostT -= dt;
    if (c.v < 2) c.waitT += dt; else c.waitT = 0;
    c.lat += (c.latT - c.lat) * Math.min(1, dt * 3);
    if (c.mode === 'lane') {
      c.s += c.v * dt;
      if (c.s >= OUT_S) beginTurn(c);
      else { lanePt(c.i, c.j, c.d, c.s, c.lat, tmpP); c.x = tmpP.x; c.y = tmpP.y; c.a = c.d * Math.PI / 2 + (c.latT - c.lat) * -0.012 * Math.min(1, c.v / 30); }
    }
    if (c.mode === 'turn') {
      c.u += c.v * dt / c.tl;
      if (c.u >= 1) {
        const over = (c.u - 1) * c.tl;
        c.i = c.ti; c.j = c.tj; c.d = c.nd; c.s = IN_S + over; c.mode = 'lane';
        lanePt(c.i, c.j, c.d, c.s, 0, tmpP); c.x = tmpP.x; c.y = tmpP.y; c.a = c.d * Math.PI / 2;
        if (c.onNode) c.onNode(c);
      } else bezier(c, c.u);
    }
  }
  function lightOf(n, axis) {
    if (!n.lights) return 'g';
    if (n.broken) return 'f';
    const k = ((gameT + n.off) % 16 + 16) % 16;
    if (axis === 1) return k < 6 ? 'g' : k < 7.5 ? 'y' : 'r';
    return k >= 8 && k < 14 ? 'g' : k >= 14 && k < 15.5 ? 'y' : 'r';
  }
  // People: walk around their block's sidewalk; at corners they sometimes cross when the cars have red.
  function pedPos(pd) {
    const b = T.blocks[pd.b], x0 = b.x + 9, y0 = b.y + 9;
    const side = Math.floor(pd.p / PER) % 4, t = pd.p - Math.floor(pd.p / PER) * PER;
    if (side === 0) { pd.x = x0 + t; pd.y = y0; } else if (side === 1) { pd.x = x0 + PER; pd.y = y0 + t; } else if (side === 2) { pd.x = x0 + PER - t; pd.y = y0 + PER; } else { pd.x = x0; pd.y = y0 + PER - t; }
  }
  // crossings from corner k (0 NW, 1 NE, 2 SE, 3 SW): [di, dj, target corner, node di, node dj, axis that must be red]
  const CROSS = [
    [[-1, 0, 1, 0, 0, 1], [0, -1, 3, 0, 0, 0]],
    [[1, 0, 0, 1, 0, 1], [0, -1, 2, 1, 0, 0]],
    [[1, 0, 3, 1, 1, 1], [0, 1, 1, 1, 1, 0]],
    [[-1, 0, 2, 0, 1, 1], [0, 1, 0, 0, 1, 0]]
  ];
  function pedCanGo(n, axis) {
    if (!n.lights || n.broken || n.manual) return false;
    const k = ((gameT + n.off) % 16 + 16) % 16;
    return axis === 1 ? k >= 7.6 && k < 11 : k >= 15.6 || k < 3;
  }
  function pedUpdate(pd, dt) {
    if (pd.hop > 0) pd.hop = Math.max(0, pd.hop - dt);
    if (pd.mode === 'walk') {
      const np = pd.p + pd.sp * dt * pd.dir;
      const k0 = Math.floor(pd.p / PER), k1 = Math.floor(np / PER);
      pd.p = ((np % (PER * 4)) + PER * 4) % (PER * 4);
      pd.step += dt * pd.sp * 0.25;
      if (k0 !== k1) {
        const corner = (((pd.dir > 0 ? k1 : k0) % 4) + 4) % 4;
        if (trafficR() < 0.4) {
          const b = T.blocks[pd.b], opts = CROSS[corner].filter(([di, dj]) => { const ii = b.bi + di, jj = b.bj + dj; return ii >= 0 && jj >= 0 && ii < NB && jj < NB; });
          if (opts.length) {
            const [di, dj, tc, ndi, ndj, axis] = pick(trafficR, opts);
            pd.p = corner * PER; pedPos(pd);
            const nb = (b.bj + dj) * NB + (b.bi + di);
            const tgt = { b: nb, p: tc * PER, x: 0, y: 0 }; pedPos(tgt);
            pd.cross = { x0: pd.x, y0: pd.y, x1: tgt.x, y1: tgt.y, node: nodeAt(b.bi + ndi, b.bj + ndj), axis, nb, np: tc * PER, u: 0 };
            pd.mode = 'wait';
          }
        }
      }
      if (pd.mode === 'walk') pedPos(pd);
    } else if (pd.mode === 'wait') {
      if (pedCanGo(pd.cross.node, pd.cross.axis)) pd.mode = 'cross';
    } else {
      const c = pd.cross, len = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
      c.u += pd.sp * 1.25 * dt / len;
      pd.step += dt * pd.sp * 0.3;
      if (c.u >= 1) { pd.b = c.nb; pd.p = c.np; pd.mode = 'walk'; pd.cross = null; pd.dir = trafficR() < 0.5 ? 1 : -1; pedPos(pd); }
      else { pd.x = lerp(c.x0, c.x1, c.u); pd.y = lerp(c.y0, c.y1, c.u); }
    }
  }

  // ---------- Navigation ----------
  // Nearest road line for a point: returns the two junctions at the ends of that stretch.
  function roadEnds(x, y) {
    let bh = 1e9, hj = 0, bv = 1e9, vi = 0;
    for (let k = 0; k < NN; k++) { const dh = Math.abs(y - roadC(k)), dv = Math.abs(x - roadC(k)); if (dh < bh) { bh = dh; hj = k; } if (dv < bv) { bv = dv; vi = k; } }
    if (bh <= bv) { const i0 = clamp(Math.floor((x - roadC(0)) / PITCH), 0, NB - 1); const e = [[i0, hj], [i0 + 1, hj]]; e.px = clamp(x, roadC(0), roadC(NB)); e.py = roadC(hj); return e; }
    const j0 = clamp(Math.floor((y - roadC(0)) / PITCH), 0, NB - 1);
    const e = [[vi, j0], [vi, j0 + 1]]; e.px = roadC(vi); e.py = clamp(y, roadC(0), roadC(NB)); return e;
  }
  const navDist = new Float64Array(NN * NN), navNext = new Int32Array(NN * NN);
  let navPath = [], navAt = 0, navLen = 0;
  function computeNav(tx, ty) {
    navDist.fill(1e12); navNext.fill(-1);
    const done = new Uint8Array(NN * NN);
    for (const [i, j] of roadEnds(tx, ty)) { const n = j * NN + i; navDist[n] = hyp(roadC(i), roadC(j), tx, ty); navNext[n] = -2; }
    for (;;) {
      let u = -1, best = 1e12;
      for (let n = 0; n < NN * NN; n++) if (!done[n] && navDist[n] < best) { best = navDist[n]; u = n; }
      if (u < 0) break;
      done[u] = 1;
      const ui = u % NN, uj = Math.floor(u / NN);
      for (let d = 0; d < 4; d++) {
        if (!validDir(ui, uj, d)) continue;
        const v = (uj + DIRS[d][1]) * NN + ui + DIRS[d][0];
        if (navDist[u] + PITCH < navDist[v]) { navDist[v] = navDist[u] + PITCH; navNext[v] = u; }
      }
    }
    // from the player: same stretch of road? straight there. Otherwise via the better end (prefer ahead).
    const pe = roadEnds(P.x, P.y), te = roadEnds(tx, ty);
    const same = pe[0][0] === te[0][0] && pe[0][1] === te[0][1] && pe[1][0] === te[1][0] && pe[1][1] === te[1][1];
    navPath = [{ x: P.x, y: P.y }];
    if (!same || hyp(P.x, P.y, tx, ty) > PITCH) {
      // run along the middle of the road: start under the car on the centre line, then junction to junction
      if (Math.abs(P.x - pe.px) < R / 2 + SW + 12 && Math.abs(P.y - pe.py) < R / 2 + SW + 12) navPath[0] = { x: pe.px, y: pe.py };
      let bestN = -1, bs = 1e12;
      for (const [i, j] of pe) {
        const n = j * NN + i, nx = roadC(i), ny = roadC(j);
        const behind = Math.cos(Math.atan2(ny - P.y, nx - P.x) - P.a) < -0.2 ? 160 : 0;
        const sc = hyp(P.x, P.y, nx, ny) + navDist[n] + behind;
        if (sc < bs) { bs = sc; bestN = n; }
      }
      let n = bestN, guard = 0;
      while (n >= 0 && guard++ < 60) { navPath.push({ x: roadC(n % NN), y: roadC(Math.floor(n / NN)) }); n = navNext[n]; }
      if (hyp(tx, ty, te.px, te.py) > 4 && Math.abs(tx - te.px) < R && Math.abs(ty - te.py) < R) navPath.push({ x: te.px, y: te.py });
    }
    navPath.push({ x: tx, y: ty });
    navLen = 0;
    for (let k = 1; k < navPath.length; k++) navLen += hyp(navPath[k - 1].x, navPath[k - 1].y, navPath[k].x, navPath[k].y);
  }
  // Route for a car (no U-turns) from its lane to a destination lane spot: list of turns at each junction.
  function routeTo(c, dest) {
    if (c.i === dest.i && c.j === dest.j && c.d === dest.d && dest.s > c.s + 10) return [];
    const key = (i, j, d) => (j * NN + i) * 4 + d;
    const si = c.i + DIRS[c.d][0], sj = c.j + DIRS[c.d][1];
    const prev = new Map(), q = [[si, sj, c.d]];
    prev.set(key(si, sj, c.d), null);
    let found = null;
    while (q.length) {
      const [i, j, d] = q.shift();
      if (i === dest.i && j === dest.j && dest.d !== (d + 2) % 4) { found = [i, j, d]; break; }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4 || !validDir(i, j, nd)) continue;
        const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1], k = key(ni, nj, nd);
        if (prev.has(k)) continue;
        prev.set(k, [i, j, d, nd]);
        q.push([ni, nj, nd]);
      }
    }
    if (!found) return null;
    const moves = [dest.d];
    let cur = found;
    for (;;) { const p = prev.get(key(cur[0], cur[1], cur[2])); if (!p) break; moves.unshift(p[3]); cur = p; }
    return moves;
  }

  // ---------- Game state ----------
  let state = 'title', multi = false, paused = false, gameT = 0, startAt = 0, lastSent = 0;
  let score = 0, peak = 0, rankIdx = 0, callsDone = 0;
  let calls = [], call = null, callIdx = 0, gapT = 0;
  const P = { x: 0, y: 0, a: 0, v: 0, siren: false, lock: false, hidden: false, rider: null, flash: 0, hitCool: 0, inNode: -1, safeT: 0 };
  const penCool = { red: 0, bump: 0, ped: 0, safe: 0 };
  let camX = WORLD / 2, camY = WORLD / 2, camZ = 1, baseZ = 1, lookX = 0, lookY = 0, camFX = 0, camFY = 0;
  const parts = [], floats = [], bubbles = [];
  const ghosts = new Map();
  let autopilot = false, timeScale = 1;

  // ---------- Calls ----------
  const CALL_TYPES = ['kitten', 'speeder', 'ducks', 'lost', 'bandit', 'traffic', 'icecream'];
  const CALL_META = {
    kitten: { title: 'Kitten in a tree', icon: 'cat', color: '#f59e0b', base: 150 },
    speeder: { title: 'Speeding car', icon: 'gauge', color: '#ef4444', base: 200 },
    ducks: { title: 'Ducks crossing', icon: 'bird', color: '#0ea5e9', base: 160 },
    lost: { title: 'Lost and found', icon: 'eye', color: '#8b5cf6', base: 150 },
    bandit: { title: 'Cookie Bandit', icon: 'siren', color: '#a855f7', base: 250 },
    traffic: { title: 'Broken traffic light', icon: 'shuffle', color: '#f97316', base: 120 },
    icecream: { title: 'Ice cream escort', icon: 'music', color: '#ec4899', base: 200 }
  };
  function genCalls(seed) {
    const r = CG.rng((seed ^ 0xca11ed) >>> 0);
    const order = shuffle(CALL_TYPES.filter((t) => t !== 'kitten'), r);
    order.unshift('kitten');
    const list = [];
    let prev = null;
    for (let k = 0; k < 40; k++) {
      let type = k < order.length ? order[k] : pick(r, CALL_TYPES);
      while (k >= order.length && type === prev) type = pick(r, CALL_TYPES);
      prev = type;
      list.push(makeCall(type, r, k));
    }
    return list;
  }
  const houseSpots = () => T.spots.filter((s) => s.kind === 'house');
  function farSpot(r, list, from, min) { const far = list.filter((s) => hyp(s.x, s.y, from.x, from.y) > min); return pick(r, far.length ? far : list); }
  function makeCall(type, r, k) {
    const c = { type, k, seed: Math.floor(r() * 1e9), name: pick(r, KIDS) };
    if (type === 'kitten') { c.a = pick(r, houseSpots()); c.b = farSpot(r, houseSpots(), c.a, 900); }
    else if (type === 'ducks') c.site = pick(r, T.duckSites);
    else if (type === 'lost') {
      c.item = r() < 0.5 ? 'balloon' : 'bike';
      c.color = pick(r, ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#a855f7']);
      const pool = T.spots.filter((s) => s.kind === 'park' || s.kind === 'house');
      c.at = pick(r, pool);
      c.owner = farSpot(r, T.spots.filter((s) => s.kind === 'house' || s.kind === 'school'), c.at, 800);
      const a = r() * Math.PI * 2, d = 60 + r() * 90;
      c.search = { x: clamp(c.at.x + Math.cos(a) * d, TOWN0, TOWN1), y: clamp(c.at.y + Math.sin(a) * d, TOWN0, TOWN1) };
    } else if (type === 'traffic') {
      const n = pick(r, T.nodes.filter((n) => n.i > 0 && n.j > 0 && n.i < NB && n.j < NB));
      c.node = { i: n.i, j: n.j }; c.arm = Math.floor(r() * 4);
    } else if (type === 'icecream') {
      c.from = T.shops.icecream || pick(r, T.spots);
      const parks = T.spots.filter((s) => s.kind === 'park' || s.kind === 'school');
      c.to = farSpot(r, parks, c.from, 700);
    } else if (type === 'bandit') c.shop = T.shops.bakery || pick(r, T.spots);
    return c;
  }
  function spotProp(s, d) { return { x: s.x + s.nx * d, y: s.y + s.ny * d }; }
  const meta = () => CALL_META[call.type];
  function setText(t) { if (call.text !== t) { call.text = t; hud.dirty = true; flashCard(); } }

  function startCall() {
    const def = calls[callIdx % calls.length];
    call = Object.assign({}, def, { phase: 0, t: 0, hold: 0, meter: -1, near: false, figs: [], zones: [], tgt: null, r: CG.rng(def.seed + callIdx), done: false });
    const c = call;
    if (c.type === 'kitten') {
      c.kitty = { x: c.a.tree.x, y: c.a.tree.y - c.a.tree.r * 1.55, onCar: false };
      c.owner = spotProp(c.b, 40);
      c.text = `${c.name}'s kitten is stuck in a tree at ${c.a.label}. Go and help!`;
    } else if (c.type === 'speeder') {
      // pick a lane a little way off and send a red sports car zooming along it
      const cands = [];
      for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) for (let d = 0; d < 4; d++) {
        if (!validDir(i, j, d)) continue;
        lanePt(i, j, d, PITCH / 2, 0, tmpP);
        const dd = hyp(tmpP.x, tmpP.y, P.x, P.y);
        if (dd > 450 && dd < 950) cands.push([i, j, d]);
      }
      const [i, j, d] = cands.length ? pick(c.r, cands) : [0, 0, 0];
      c.car = makeCar(i, j, d, PITCH / 2, 'speeder', 'sport', '#ef4444', 175);
      c.car.ignoreLights = true;
      c.text = `A red car is driving too fast on ${d % 2 ? V_ST[i] : H_ST[j]}! Turn on your siren and follow it.`;
    } else if (c.type === 'ducks') {
      const s = c.site;
      c.ducks = [0, 1, 2, 3, 4].map((k) => ({ x: s.x - 10 + k * 7 - (k ? 6 : 0), y: s.yA - 4 - (k ? 6 : 0), k }));
      c.boxes = [{ x: s.x - 78, y: s.roadY + LANE }, { x: s.x + 78, y: s.roadY - LANE }];
      c.u = 0;
      c.text = `A duck family wants to cross ${H_ST[s.j]} by ${s.park}. Drive there!`;
    } else if (c.type === 'lost') {
      c.pos = spotProp(c.at, 36);
      c.found = false; c.onCar = false;
      c.ownerAt = spotProp(c.owner, 40);
      c.text = `${c.name} lost a ${c.item === 'balloon' ? colorName(c.color) + ' balloon' : 'bike'} near ${c.at.street}. Search the circle!`;
    } else if (c.type === 'bandit') {
      const s = c.shop;
      c.car = makeCar(s.i, s.j, s.d, clamp(s.s + 60, IN_S + 10, STOP_S - 10), 'bandit', 'bandit', '#7c3aed', 150);
      c.car.ignoreLights = true;
      c.text = 'The Cookie Bandit took the cookies from the Bakery! Catch the purple car and tag it.';
    } else if (c.type === 'traffic') {
      c.n = nodeAt(c.node.i, c.node.j);
      c.n.broken = true;
      const ad = c.arm, dx = DIRS[ad][0], dy = DIRS[ad][1];
      // park on the lane coming in from arm `ad`, just before the stop line
      const ind = (ad + 2) % 4;
      c.inDir = ind;
      c.park = { x: c.n.x + dx * (R / 2 + 46) - DIRS[ind][1] * LANE, y: c.n.y + dy * (R / 2 + 46) + DIRS[ind][0] * LANE };
      c.count = 0; c.need = 6; c.prompt = null; c.idle = 0;
      c.text = `The light at ${H_ST[c.node.j]} and ${V_ST[c.node.i]} is broken. Park in the yellow box.`;
    } else if (c.type === 'icecream') {
      const s = c.from;
      c.car = makeCar(s.i, s.j, s.d, clamp(s.s, IN_S + 10, STOP_S - 20), 'truck', 'truck', '#fdf2f8', 92);
      c.car.vOverride = 0; c.car.v = 0; c.car.ignoreLights = true; c.car.pullT = 0;
      c.text = `The ice cream truck needs a police escort. Meet it at ${s.label}.`;
      c.jT = 0;
    }
    c.par = 60 + (c.type === 'bandit' || c.type === 'speeder' ? 20 : 0) + (c.type === 'icecream' ? 30 : 0);
    hud.dirty = true;
    SND.radio();
    showCard(true);
    navAt = 0;
  }
  function colorName(c) { return { '#ef4444': 'red', '#3b82f6': 'blue', '#22c55e': 'green', '#f59e0b': 'orange', '#ec4899': 'pink', '#a855f7': 'purple' }[c] || 'shiny'; }

  // Arrive at a spot: close and slow fills a little ring; the action button finishes it at once.
  function arrive(pt, rad, dt) {
    const d = hyp(P.x, P.y, pt.x, pt.y);
    call.near = d < rad;
    if (d < rad && Math.abs(P.v) < 140) {
      call.hold += dt * (actionHeld || actionTap ? 6 : 1.8);
      if (call.hold >= 1) { call.hold = 0; actionTap = false; return true; }
    } else call.hold = Math.max(0, call.hold - dt * 2);
    return false;
  }
  function finishCall(extra) {
    const m = meta();
    const tb = Math.max(0, Math.round((call.par - call.t) * 2));
    const total = m.base + tb + (extra || 0);
    const r0 = rankIdx;
    addScore(total);
    const promoted = rankIdx > r0;
    callsDone++;
    banner('Good job, Officer!', `+${m.base + (extra || 0)} points` + (tb ? ` · +${tb} time bonus` : ''), m.icon, m.color);
    burst(P.x, P.y, 'confetti', 40);
    CG.sfx('win');
    floatText(`+${total}`, P.x, P.y - 30, '#16a34a', 1.3);
    // cars that belonged to the call drive off as normal traffic and fade away later
    if (call.car) { call.car.kind = 'ai'; call.car.temp = true; call.car.vOverride = null; call.car.ignoreLights = false; call.car.vmax = 95; call.car.pullT = 0; call.car.latT = 0; call.car.catchStop = false; call.car.route = null; call.car.dest = null; call.car.stopAt = null; }
    if (call.n) { call.n.broken = false; call.n.manual = null; }
    P.lock = false; P.hidden = false; P.rider = null;
    hidePanels();
    call = null;
    callIdx++;
    gapT = 2.6;
    if (promoted) gapT = 5.4;
    showCard(false);
  }
  function updateCall(dt) {
    const c = call;
    c.t += dt;
    c.zones.length = 0; c.figs.length = 0;
    const tm = gameT;
    if (c.type === 'kitten') {
      if (c.phase === 0) {
        c.tgt = c.a;
        c.figs.push({ y: c.kitty.y + 0.5, f: (g) => { g.save(); g.translate(c.kitty.x, c.kitty.y); g.scale(1.5, 1.5); drawKitten(g, 0, 0, tm, true); g.restore(); } });
        if (Math.floor(tm * 0.5) !== c.mw && hyp(P.x, P.y, c.a.x, c.a.y) < 400) { c.mw = Math.floor(tm * 0.5); SND.meow(); bubble('Meow!', c.kitty.x, c.kitty.y - 20, 1.2); }
        c.zones.push({ x: c.a.x, y: c.a.y, r: 52 });
        if (arrive(c.a, 62, dt)) {
          c.phase = 1; SND.meow(); burst(c.kitty.x, c.kitty.y, 'hearts', 10); CG.sfx('coin');
          P.rider = 'kitten';
          setText(`Got the kitten! Take it home to ${c.name} at ${c.b.label}.`);
          floatText('Kitten rescued!', P.x, P.y - 34, '#f59e0b');
        }
      } else {
        c.tgt = c.b;
        c.zones.push({ x: c.b.x, y: c.b.y, r: 52 });
        c.figs.push({ y: c.owner.y, f: (g) => pedFig(g, c.owner.x, c.owner.y, c.name, { wave: tm }) });
        if (arrive(c.b, 62, dt)) {
          P.rider = null; SND.meow(); burst(c.owner.x, c.owner.y - 20, 'hearts', 16);
          bubble('Thank you, Officer!', c.owner.x, c.owner.y - 34, 2.2);
          finishCall();
        }
      }
    } else if (c.type === 'speeder') {
      const car = c.car;
      if (c.phase === 0) {
        c.tgt = car; c.chase = true;
        const d = hyp(P.x, P.y, car.x, car.y);
        if (c.meter < 0) c.meter = 0;
        if (d < 230 && P.siren) { c.meter = Math.min(1, c.meter + dt / 2.4); setText('Great! Stay close with the siren on…'); }
        else if (d < 230) setText('Turn on your siren so the driver sees you!');
        else c.meter = Math.max(0, c.meter - dt * 0.05);
        if (d < 230 && !P.siren) c.sirenHint = true; else c.sirenHint = false;
        if (Math.random() < dt * 8) burst(car.x - Math.cos(car.a) * 24, car.y - Math.sin(car.a) * 24, 'puff', 1);
        if (c.meter >= 1) {
          c.phase = 1; c.meter = -1; c.sirenHint = false;
          car.pullT = 22; car.catchStop = true; car.vmax = 90;
          setText('It pulled over. Stop behind it to write a ticket.');
          CG.sfx('score');
        }
      } else if (c.phase === 1) {
        c.chase = false;
        // a spot just behind it, back in the lane (not on the curb where people walk)
        const behind = { x: car.x - Math.cos(car.a) * 54 + Math.sin(car.a) * car.lat, y: car.y - Math.sin(car.a) * 54 - Math.cos(car.a) * car.lat };
        c.tgt = behind;
        c.zones.push({ x: behind.x, y: behind.y, r: 40 });
        if (car.v < 5 && arrive(behind, 70, dt)) { c.phase = 2; P.lock = true; openTicket(); }
      } else if (c.phase === 2) {
        c.tgt = car;
      } else if (c.phase === 3) {
        c.t3 = (c.t3 || 0) + dt;
        if (c.t3 > 1.6) finishCall();
      }
    } else if (c.type === 'ducks') {
      const s = c.site;
      c.tgt = { x: s.x, y: s.roadY };
      const inBox = c.boxes.find((b) => Math.abs(P.x - b.x) < 36 && Math.abs(P.y - b.y) < 26);
      const holding = inBox && Math.abs(P.v) < 30;
      if (c.phase === 0) {
        if (hyp(P.x, P.y, s.x, s.roadY) < 300) { c.phase = 1; setText('Stop in a yellow box to hold the traffic for the ducks.'); SND.quack(); }
      }
      if (c.phase >= 1) for (const b of c.boxes) c.zones.push({ box: true, x: b.x, y: b.y, w: 64, h: 44, on: holding && inBox === b });
      if (c.phase === 1) {
        if (holding) { c.phase = 2; c.meter = 0; setText('Keep waiting… the ducklings are crossing!'); SND.quack(); }
      }
      if (c.phase === 2) {
        if (holding) c.u = Math.min(1.5, c.u + dt / 9); else if (Math.random() < dt * 0.8) { bubble('Quack! Wait for us!', c.ducks[0].x, c.ducks[0].y - 18, 1.4); }
        c.meter = Math.min(1, c.u / 1.4);
        if (Math.floor(tm * 0.7) !== c.qk && holding) { c.qk = Math.floor(tm * 0.7); if (Math.random() < 0.5) SND.quack(); }
        if (c.u >= 1.5) { c.meter = -1; SND.quack(); burst(s.x, s.yB, 'hearts', 12); bubble('Quack quack! Thank you!', s.x, s.yB - 20, 2); finishCall(); return; }
      }
      // ducks walk in a line (mum first)
      for (const d of c.ducks) {
        const pk = clamp(c.u * 1.25 - d.k * 0.06, 0, 1);
        d.x = s.x - (d.k ? 4 : 0) + Math.sin(tm * 3 + d.k) * 1.5 + (d.k ? (d.k % 2 ? -4 : 4) : 0);
        d.y = lerp(s.yA - 4 - d.k * 9, s.yB + 6 + (4 - d.k) * 2, pk);
        if (d.y > s.roadY - R / 2 - 2 && d.y < s.roadY + R / 2 + 2) extraObs.push(d);
        c.figs.push({ y: d.y, f: (g) => drawDuck(g, d.x, d.y, d.k ? 0.95 : 1.5, tm + d.k, !d.k) });
      }
    } else if (c.type === 'lost') {
      if (c.phase === 0) {
        if (!c.found) {
          c.tgt = c.search;
          c.zones.push({ x: c.search.x, y: c.search.y, r: 190, search: true });
          if (hyp(P.x, P.y, c.pos.x, c.pos.y) < 190) { c.found = true; burst(c.pos.x, c.pos.y - 20, 'sparkle', 16); CG.sfx('coin'); setText(`There it is! Grab ${c.name}'s ${c.item}.`); floatText('Found it!', c.pos.x, c.pos.y - 40, '#8b5cf6'); }
        } else {
          c.tgt = c.pos;
          c.zones.push({ x: c.at.x, y: c.at.y, r: 46 });
          if (arrive({ x: c.at.x, y: c.at.y }, 70, dt)) { c.phase = 1; P.rider = c.item; CG.sfx('coin'); setText(`Bring it back to ${c.name} at ${c.owner.label}.`); }
        }
        if (Math.random() < dt * 2.5) burst(c.pos.x + (Math.random() - 0.5) * 20, c.pos.y - 10 - Math.random() * 20, 'sparkle', 1);
        c.figs.push({ y: c.pos.y, f: (g) => { g.save(); g.translate(c.pos.x, c.pos.y); g.scale(1.4, 1.4); if (c.item === 'balloon') drawBalloon(g, 0, 0, tm, c.color); else drawBike(g, 0, 0); g.restore(); } });
      } else {
        c.tgt = c.owner;
        c.zones.push({ x: c.owner.x, y: c.owner.y, r: 52 });
        c.figs.push({ y: c.ownerAt.y, f: (g) => pedFig(g, c.ownerAt.x, c.ownerAt.y, c.name, { wave: tm }) });
        if (arrive(c.owner, 62, dt)) { P.rider = null; burst(c.ownerAt.x, c.ownerAt.y - 20, 'hearts', 14); bubble('Yay! Thank you!', c.ownerAt.x, c.ownerAt.y - 34, 2); SND.cheer(); finishCall(); }
      }
    } else if (c.type === 'bandit') {
      const car = c.car;
      if (c.phase === 0) {
        c.tgt = car; c.chase = true;
        const d = hyp(P.x, P.y, car.x, car.y);
        // forgiving: the bandit gets tired when far away or after a long chase
        car.vmax = d > 600 ? 95 : c.t > 50 ? 105 : 150;
        if (Math.random() < dt * 5) burst(car.x - Math.cos(car.a) * 22, car.y - Math.sin(car.a) * 22, 'crumb', 1);
        if (d < 40) {
          c.phase = 1; c.t1 = 0; c.chase = false;
          car.pullT = 22; car.catchStop = true; car.vmax = 70;
          CG.sfx('score');
          floatText('Tagged!', car.x, car.y - 30, '#a855f7', 1.2);
          setText('You got the Cookie Bandit!');
        }
      } else if (c.phase === 1) {
        if (car.v < 3) c.t1 += dt;
        c.tgt = car;
        const fx = car.x + Math.cos(car.a + Math.PI / 2) * 26, fy = car.y + Math.sin(car.a + Math.PI / 2) * 26;
        if (c.t1 > 0.5) c.figs.push({ y: fy, f: (g) => { g.save(); g.translate(fx, fy); drawPedVec(g, LOOKS[3], 0, { stripes: true, mask: true, armsUp: true }); g.restore(); } });
        if (c.t1 > 0.8 && !c.said) { c.said = true; bubble('Okay, okay! Here are the cookies!', fx, fy - 40, 2.6); }
        if (c.t1 > 2.4) { c.phase = 2; P.rider = 'cookies'; CG.sfx('coin'); setText('Bring the cookies back to the Bakery.'); }
      } else {
        c.tgt = c.shop;
        c.zones.push({ x: c.shop.x, y: c.shop.y, r: 52 });
        const bk = spotProp(c.shop, 38);
        c.figs.push({ y: bk.y, f: (g) => pedFig(g, bk.x, bk.y, 'Baker', { wave: tm, look: 9 }) });
        if (arrive(c.shop, 62, dt)) { P.rider = null; bubble('My cookies! Thank you!', bk.x, bk.y - 34, 2); SND.cheer(); finishCall(); }
      }
    } else if (c.type === 'traffic') {
      const n = c.n;
      if (c.phase === 0) {
        c.tgt = c.park;
        c.zones.push({ box: true, x: c.park.x, y: c.park.y, w: c.inDir % 2 ? 44 : 64, h: c.inDir % 2 ? 64 : 44, on: false });
        if (hyp(P.x, P.y, c.park.x, c.park.y) < 46 && Math.abs(P.v) < 60) {
          c.phase = 1; P.lock = true; n.manual = { allow: null, car: null };
          c.off = { x: c.park.x, y: c.park.y, t: 0 };
          setText('Wave the honking car through! Tap the arrow that points at it.');
          openTraffic();
        }
      } else {
        c.tgt = n;
        // the officer walks to the middle of the junction
        c.off.t = Math.min(1, c.off.t + dt * 1.2);
        const ox = lerp(c.park.x, n.x, c.off.t), oy = lerp(c.park.y, n.y, c.off.t);
        const pr = c.prompt;
        c.figs.push({ y: oy, f: (g) => { g.save(); g.translate(ox, oy); drawPedVec(g, { skin: '#f1c7a4', shirt: '#1e40af', pants: '#1e3a8a', hair: '#3b2414' }, 0, { cap: true, badge: true, point: pr && pr.ok ? Math.atan2(pr.car.y - oy, pr.car.x - ox) : null }); g.restore(); } });
        if (n.manual.allow) {
          const ac2 = cars.find((x) => x.id === n.manual.allow);
          if (!ac2 || ac2.mode === 'lane' && !(ac2.i + DIRS[ac2.d][0] === n.i && ac2.j + DIRS[ac2.d][1] === n.j)) { n.manual.allow = null; c.prompt = null; c.idle = 0; }
        } else if (c.off.t >= 1) {
          if (!c.prompt) {
            // find a car waiting at one of the other three arms
            let best = null;
            for (const o of cars) {
              if (o.mode !== 'lane' || o.d === c.inDir || o.kind !== 'ai') continue;
              if (o.i + DIRS[o.d][0] !== n.i || o.j + DIRS[o.d][1] !== n.j) continue;
              if (STOP_S - o.s > 14 || o.v > 6) continue;
              if (!best || o.waitT > best.waitT) best = o;
            }
            if (best) {
              const lim = Math.max(3, 6 - c.count * 0.5);
              c.prompt = { car: best, ans: (best.d + 2) % 4, t: 0, lim, ok: false, wrongs: 0 };
              SND.honk(); bubble('Beep beep!', best.x, best.y - 22, 1.2);
              trafficPanel();
            } else {
              c.idle += dt;
              if (c.idle > 1.2) {
                c.idle = 0;
                const arms = [0, 1, 2, 3].filter((d) => d !== c.inDir);
                const d = pick(c.r, arms);
                const fi = n.i - DIRS[d][0], fj = n.j - DIRS[d][1];
                if (!cars.some((o) => o.i === fi && o.j === fj && o.d === d && o.mode === 'lane' && o.s > STOP_S - 200)) {
                  const nc = makeCar(fi, fj, d, STOP_S - 150, 'ai', pick(c.r, ['sedan', 'hatch', 'van', 'taxi']), pick(c.r, CAR_COLORS), 100);
                  nc.temp = true;
                  if (nc.type === 'taxi') nc.color = '#facc15';
                }
              }
            }
          } else if (!c.prompt.ok) {
            const p = c.prompt;
            p.t += dt;
            if (Math.floor(p.t * 1.2) !== p.hk) { p.hk = Math.floor(p.t * 1.2); if (p.t > 0.5) SND.honk(); }
            if (p.t > p.lim) { flash('Too slow! Try the next car.', 'warn'); c.prompt = null; trafficPanel(); }
          }
        }
        if (c.prompt && !c.prompt.ok) c.zones.push({ x: c.prompt.car.x, y: c.prompt.car.y, r: 34, honk: true });
        c.meter = c.count / c.need;
        if (c.count >= c.need && !n.manual.allow) { finishCall(c.count * 15); }
      }
    } else if (c.type === 'icecream') {
      const car = c.car;
      if (c.phase === 0) {
        c.tgt = car;
        c.zones.push({ x: car.x, y: car.y, r: 60 });
        if (arrive(car, 95, dt)) {
          c.phase = 1;
          car.route = routeTo(car, c.to) || [];
          car.dest = c.to; car.vOverride = null;
          setText(`Escort the truck! Stay close while it drives to ${c.to.label}.`);
          SND.jingle();
        }
      } else {
        c.tgt = c.to;
        c.zones.push({ x: c.to.x, y: c.to.y, r: 52 });
        const d = hyp(P.x, P.y, car.x, car.y);
        if (d > 200) { car.vOverride = 0; if (!c.waiting) { c.waiting = true; bubble('Wait for me!', car.x, car.y - 24, 1.6); setText('The truck is waiting for you. Stay close!'); } }
        else { car.vOverride = null; if (c.waiting) { c.waiting = false; setText(`Great! Keep the truck company to ${c.to.label}.`); } }
        c.jT += dt;
        if (c.jT > 4 && d < 260) { c.jT = 0; SND.jingle(); }
        if (Math.random() < dt * 3) burst(car.x + (Math.random() - 0.5) * 30, car.y - 10, 'note', 1);
        const arrived = car.mode === 'lane' && car.i === c.to.i && car.j === c.to.j && car.d === c.to.d && (!car.route || !car.route.length) && c.to.s - car.s < 8 && car.v < 4;
        if (arrived) {
          const kx = c.to.x + c.to.nx * 40, ky = c.to.y + c.to.ny * 40;
          bubble('Yay, ice cream!', kx, ky - 30, 2.2);
          burst(car.x, car.y, 'confetti', 20); SND.jingle();
          finishCall();
        }
      }
    }
  }
  function pedFig(g, x, y, name, o) {
    g.save(); g.translate(x, y);
    drawPedVec(g, LOOKS[o.look != null ? o.look : (name.charCodeAt(0) % LOOKS.length)], 0, { wave: o.wave });
    g.restore();
  }

  // ---------- Ticket and traffic panels ----------
  let ticketEl = null, trafficEl = null;
  function openTicket() {
    const opts = shuffle([['gauge', 'Driving too fast', true], ['music', 'Singing too loud', false], ['apple', 'Eating an apple', false]], call.r);
    call.ticket = { opts, wrong: 0 };
    ticketEl.innerHTML = `<h3>${CG.icon('badge', 22)} Write a ticket</h3><p>Why did we stop this car?</p><div class="pp-opts">` +
      opts.map(([ic, t], k) => `<button type="button" class="pp-opt" data-k="${k}">${CG.icon(ic, 30)}<span>${t}</span><span class="k">${k + 1}</span></button>`).join('') + '</div>';
    ticketEl.classList.add('show'); ui.classList.add('panel');
    setText('Write the ticket!');
    CG.sfx('flip');
  }
  function ticketPick(k) {
    if (!call || call.type !== 'speeder' || call.phase !== 2 || !call.ticket || call.ticket.stamp) return;
    const o = call.ticket.opts[k];
    const btn = ticketEl.querySelector(`[data-k="${k}"]`);
    if (!o || !btn) return;
    if (!o[2]) {
      call.ticket.wrong++;
      btn.classList.remove('wrong'); void btn.offsetWidth; btn.classList.add('wrong');
      CG.sfx('wrong');
      flash('Hmm, not that one. Try again!', 'info');
      if (call.ticket.wrong >= 2) { const r = call.ticket.opts.findIndex((x) => x[2]); const rb = ticketEl.querySelector(`[data-k="${r}"]`); if (rb) rb.classList.add('hint'); }
      return;
    }
    call.ticket.stamp = true;
    CG.sfx('point');
    ticketEl.innerHTML = `<h3>${CG.icon('badge', 22)} Write a ticket</h3><p>Driving too fast. Now stamp it!</p><button type="button" class="pp-stamp" data-stamp="1">${CG.icon('check', 24)} Stamp</button>`;
  }
  function ticketStamp() {
    if (!call || call.type !== 'speeder' || call.phase !== 2 || !call.ticket || !call.ticket.stamp || call.ticket.done) return;
    call.ticket.done = true;
    CG.sfx('drop');
    ticketEl.innerHTML = `<h3>${CG.icon('badge', 22)} Ticket</h3><div class="pp-stamped">SLOW DOWN</div>`;
    const car = call.car;
    bubble('Sorry, Officer! I will drive slowly.', car.x, car.y - 22, 2.6);
    call.phase = 3;
    setTimeout(() => { ticketEl.classList.remove('show'); }, 1300);
  }
  function openTraffic() { trafficEl.classList.add('show'); ui.classList.add('panel'); trafficPanel(); }
  function trafficPanel() {
    if (!call || call.type !== 'traffic') return;
    const p = call.prompt, wait = !p || p.ok;
    const btn = (d, ic) => `<button type="button" data-d="${d}" aria-label="Wave from the ${['right', 'bottom', 'left', 'top'][d]}"${d === call.arm ? ' disabled' : ''}>${CG.icon(ic, 34)}</button>`;
    trafficEl.innerHTML = `<h3>${CG.icon('shuffle', 22)} Direct the traffic</h3><p>${wait ? 'Waiting for the next car…' : 'Which way is the honking car?'}</p>` +
      `<div class="pp-pad"><span></span>${btn(3, 'arrowUp')}<span></span>${btn(2, 'arrowLeft')}<div class="mid">${call.count}<small>of ${call.need}</small></div>${btn(0, 'arrowRight')}<span></span>${btn(1, 'arrowDown')}<span></span></div>` +
      `<div class="pp-tbar"><i></i></div>`;
  }
  function trafficPick(d) {
    const c = call;
    if (!c || c.type !== 'traffic' || c.phase !== 1 || !c.prompt || c.prompt.ok) return;
    const p = c.prompt;
    const b = trafficEl.querySelector(`[data-d="${d}"]`);
    if (d === p.ans) {
      p.ok = true;
      c.n.manual.allow = p.car.id;
      c.count++;
      addScore(15);
      floatText('+15', p.car.x, p.car.y - 24, '#16a34a');
      CG.sfx('coin');
      bubble(pick(c.r, ['Thanks!', 'Thank you!', 'Bye!']), p.car.x, p.car.y - 22, 1);
      trafficPanel();
    } else {
      p.wrongs++;
      if (b) { b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong'); }
      CG.sfx('wrong');
      flash('Oops! Look for the car that is honking.', 'info');
      if (p.wrongs >= 1) { const hb = trafficEl.querySelector(`[data-d="${p.ans}"]`); if (hb) hb.classList.add('hint'); }
    }
  }
  function hidePanels() { if (ticketEl) ticketEl.classList.remove('show'); if (trafficEl) trafficEl.classList.remove('show'); if (ui) ui.classList.remove('panel'); }

  // ---------- Score, ranks, feedback ----------
  function addScore(n) {
    score = Math.max(0, score + n);
    if (score > peak) peak = score;
    hud.dirty = true;
    hud.bump = n;
    let ri = 0;
    for (let k = 0; k < RANKS.length; k++) if (peak >= RANKS[k].at) ri = k;
    if (ri > rankIdx) {
      rankIdx = ri;
      if (!call) gapT = Math.max(gapT, 5.4);   // let the promotion show before the next call comes in
      const rk = RANKS[ri];
      setTimeout(() => { if (state === 'play') { banner(`Promoted to ${rk.name}!`, 'You earned a new badge', rk.icon, rk.c2, rk); CG.sfx('match'); burst(P.x, P.y, 'confetti', 50); } }, 2700);
    }
  }
  function penalty(kind, pts, text) {
    if (penCool[kind] > 0) return;
    penCool[kind] = 3;
    addScore(-pts);
    flash(`Careful! ${text}`, 'warn');
    CG.sfx('wrong');
    floatText(`-${pts}`, P.x, P.y - 30, '#ef4444');
  }
  function floatText(text, x, y, color, size) { floats.push({ text, x, y, color, size: size || 1, t: 0, life: 1.4 }); }
  function bubble(text, x, y, life) { if (!text) return; bubbles.push({ text, x, y, t: 0, life: life || 1.6 }); if (bubbles.length > 6) bubbles.shift(); }
  function burst(x, y, kind, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = kind === 'confetti' ? 60 + Math.random() * 160 : kind === 'puff' || kind === 'crumb' ? 10 + Math.random() * 20 : 20 + Math.random() * 60;
      parts.push({ kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'confetti' ? 60 : kind === 'hearts' || kind === 'note' ? 30 : 0), t: 0, life: kind === 'confetti' ? 1.4 : kind === 'puff' ? 0.7 : 1.1, r: kind === 'confetti' ? 3 + Math.random() * 2 : 4, c: ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#ec4899', '#a855f7'][k % 6], spin: Math.random() * 6 });
    }
    if (parts.length > 300) parts.splice(0, parts.length - 300);
  }

  // ---------- Player ----------
  const keys = { up: false, down: false, left: false, right: false };
  let actionHeld = false, actionTap = false;
  const joy = { id: null, x0: 0, y0: 0, dx: 0, dy: 0, on: false };
  function readInput() {
    if (autopilot) return autoInput();
    if (joy.on) {
      const len = Math.hypot(joy.dx, joy.dy);
      if (len < 10) return { thr: 0, steer: 0 };
      const m = clamp((len - 8) / 46, 0, 1), ja = Math.atan2(joy.dy, joy.dx);
      const diff = wrapA(ja - P.a);
      return { thr: m * (Math.abs(diff) > 1.6 ? 0.38 : Math.abs(diff) > 0.8 ? 0.6 : 1), steer: clamp(diff * 2.4, -1, 1), joy: true };
    }
    return { thr: keys.up ? 1 : keys.down ? -1 : 0, steer: keys.left ? -1 : keys.right ? 1 : 0 };
  }
  // Car-shaped body made of two circles, pushed out of block interiors.
  function solidPush(cx, cy, rad) {
    let px = 0, py = 0;
    const lo = TOWN0 - SW + rad - 4, hi = TOWN1 + SW - rad + 4;
    if (cx < lo) px += lo - cx; if (cx > hi) px += hi - cx;
    if (cy < lo) py += lo - cy; if (cy > hi) py += hi - cy;
    const bi = Math.floor((cx - blkX(0)) / PITCH), bj = Math.floor((cy - blkX(0)) / PITCH);
    for (let a = bi - 1; a <= bi + 1; a++) for (let b = bj - 1; b <= bj + 1; b++) {
      if (a < 0 || b < 0 || a >= NB || b >= NB) continue;
      const x0 = blkX(a) + SW, y0 = blkX(b) + SW, x1 = x0 + BLK - SW * 2, y1 = y0 + BLK - SW * 2;
      const qx = clamp(cx, x0, x1), qy = clamp(cy, y0, y1);
      let dx = cx - qx, dy = cy - qy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rad * rad) continue;
      if (d2 > 0.0001) { const d = Math.sqrt(d2), k = (rad - d) / d; px += dx * k; py += dy * k; }
      else { const l = cx - x0, rgt = x1 - cx, t = cy - y0, bt = y1 - cy, m = Math.min(l, rgt, t, bt); if (m === l) px -= l + rad; else if (m === rgt) px += rgt + rad; else if (m === t) py -= t + rad; else py += bt + rad; }
    }
    return [px, py];
  }
  let bonkCool = 0;
  function playerUpdate(dt) {
    for (const k in penCool) if (penCool[k] > 0) penCool[k] -= dt;
    if (bonkCool > 0) bonkCool -= dt;
    P.flash += dt;
    if (P.lock) { P.v = P.v > 0 ? Math.max(0, P.v - 500 * dt) : Math.min(0, P.v + 500 * dt); if (autopilot) autoInput(); }
    else {
      const inp = readInput();
      const vmax = P.siren ? 280 : 250;
      if (inp.thr > 0) {
        const vt = vmax * inp.thr;
        if (P.v < 0) P.v = Math.min(0, P.v + 560 * dt);
        else if (P.v < vt) P.v = Math.min(vt, P.v + 240 * dt * (P.v < 80 ? 1.3 : 1));
        else P.v = Math.max(vt, P.v - 260 * dt);
      } else if (inp.thr < 0) {
        if (P.v > 0) P.v = Math.max(0, P.v - 520 * dt);
        else P.v = Math.max(-90, P.v - 180 * dt);
      } else P.v = P.v > 0 ? Math.max(0, P.v - 210 * dt) : Math.min(0, P.v + 210 * dt);
      const sp = Math.abs(P.v);
      const tf = clamp(sp / 70, 0, 1) * (sp > 200 ? 0.85 : 1);
      P.a += inp.steer * 2.8 * tf * (P.v >= 0 ? 1 : -1) * dt;
      // gentle steering help: straighten out along the road when not steering
      if (!inp.steer && sp > 30) {
        const ax = Math.round(P.a / (Math.PI / 2)) * (Math.PI / 2), diff = ax - P.a;
        if (Math.abs(diff) < 0.32) P.a += diff * Math.min(1, dt * 4);
      }
      P.a = wrapA(P.a);
    }
    const ox = P.x, oy = P.y;
    P.x += Math.cos(P.a) * P.v * dt;
    P.y += Math.sin(P.a) * P.v * dt;
    // walls
    const ca = Math.cos(P.a), sa = Math.sin(P.a);
    let hit = false;
    for (const off of [13, -13]) {
      const [px, py] = solidPush(P.x + ca * off, P.y + sa * off, 11);
      if (px || py) { P.x += px; P.y += py; hit = true; }
    }
    if (hit) {
      const moved = Math.hypot(P.x - ox, P.y - oy) / Math.max(dt, 0.001);
      if (Math.abs(P.v) > 90 && bonkCool <= 0) { SND.bonk(); bonkCool = 0.6; burst(P.x + ca * 22, P.y + sa * 22, 'puff', 4); }
      P.v = Math.sign(P.v) * Math.min(Math.abs(P.v), moved + 20) * 0.92;
    }
    // other cars
    for (const c of cars) {
      const dx = c.x - P.x, dy = c.y - P.y;
      if (dx * dx + dy * dy > 90 * 90) continue;
      const cca = Math.cos(c.a), csa = Math.sin(c.a), half = c.L / 2 - 10;
      let touched = false;
      for (const po of [13, -13]) for (let q = -1; q <= 1; q += c.L > 60 ? 0.5 : 1) {
        const ax2 = P.x + ca * po, ay2 = P.y + sa * po, bx2 = c.x + cca * half * q, by2 = c.y + csa * half * q;
        const ddx = ax2 - bx2, ddy = ay2 - by2, d2 = ddx * ddx + ddy * ddy;
        if (d2 < 22 * 22 && d2 > 0.01) { const d = Math.sqrt(d2), k = (22 - d) / d * 0.5; P.x += ddx * k; P.y += ddy * k; touched = true; }
      }
      if (touched) {
        if (call && call.type === 'bandit' && c === call.car) continue;
        const toward = (dx * ca + dy * sa) * Math.sign(P.v || 1) > 0;
        if (Math.abs(P.v) > 50 && toward) {
          P.v *= 0.35;
          SND.bonk(); burst((P.x + c.x) / 2, (P.y + c.y) / 2, 'star', 6);
          if (!(call && c === call.car)) penalty('bump', 5, 'Don’t bump other cars.');
        }
      }
    }
    // people
    for (const pd of peds) {
      const dx = pd.x - P.x, dy = pd.y - P.y;
      if (dx * dx + dy * dy < 24 * 24) { if (pd.hop <= 0) { pd.hop = 0.5; if (Math.abs(P.v) > 40) penalty('ped', 5, 'Watch out for people!'); } }
    }
    // red lights (the siren lets a police car go through carefully)
    let inNode = -1;
    for (const n of T.nodes) if (Math.abs(P.x - n.x) < R / 2 && Math.abs(P.y - n.y) < R / 2) { inNode = n.j * NN + n.i; break; }
    if (inNode >= 0 && inNode !== P.inNode) {
      const n = T.nodes[inNode];
      const fromSide = Math.abs(ox - n.x) >= R / 2 - 4 ? 0 : 1;
      if (n.lights && !n.broken && !n.manual && !P.siren && Math.abs(P.v) > 40 && lightOf(n, fromSide) === 'r') penalty('red', 10, 'That light was red.');
    }
    P.inNode = inNode;
    // a careful stop at a red light earns a little bonus
    if (!P.siren && Math.abs(P.v) < 6 && penCool.safe <= 0) {
      const ni = clamp(Math.round((P.x - roadC(0)) / PITCH), 0, NB), nj = clamp(Math.round((P.y - roadC(0)) / PITCH), 0, NB), n = nodeAt(ni, nj);
      const dx = n.x - P.x, dy = n.y - P.y, ax = Math.abs(dx) > Math.abs(dy) ? 0 : 1, along = ax ? Math.abs(dy) : Math.abs(dx), lat = ax ? Math.abs(dx) : Math.abs(dy);
      const facing = Math.cos(Math.atan2(dy, dx) - P.a) > 0.8;
      if (n.lights && !n.broken && facing && along > R / 2 + 10 && along < R / 2 + 110 && lat < R / 2 && lightOf(n, ax) === 'r') {
        P.safeT += dt;
        if (P.safeT > 0.8) { P.safeT = 0; penCool.safe = 25; addScore(5); floatText('+5', P.x, P.y - 30, '#16a34a'); flash('Safe stop at the red light!', 'good'); CG.sfx('point'); }
      } else P.safeT = 0;
    } else P.safeT = 0;
    if (Math.abs(P.v) > 150 && Math.random() < dt * 6) burst(P.x - ca * 26, P.y - sa * 26, 'puff', 1);
  }

  // ---------- Autopilot (testing aid: drives to the current target and plays the mini-games) ----------
  const autoS = { stuck: 0, rev: 0, ans: 0 };
  function autoInput() {
    if (!call) return { thr: 0, steer: 0 };
    P.siren = true;
    const c = call;
    if (c.type === 'traffic' && c.phase === 1) {
      if (c.prompt && !c.prompt.ok) { autoS.ans += 1 / 60; if (autoS.ans > 0.6) { autoS.ans = 0; trafficPick(c.prompt.ans); } }
      return { thr: 0, steer: 0 };
    }
    if (c.type === 'speeder' && c.phase === 2 && c.ticket) {
      autoS.ans += 1 / 60;
      if (autoS.ans > 0.6) { autoS.ans = 0; if (!c.ticket.stamp) ticketPick(c.ticket.opts.findIndex((x) => x[2])); else ticketStamp(); }
      return { thr: 0, steer: 0 };
    }
    let tg = c.tgt;
    if (c.type === 'ducks' && c.phase >= 1) tg = c.boxes.reduce((a, b) => (hyp(P.x, P.y, a.x, a.y) < hyp(P.x, P.y, b.x, b.y) ? a : b));
    if (c.type === 'traffic' && c.phase === 0) tg = c.park;
    if (!tg) return { thr: 0, steer: 0 };
    const d = hyp(P.x, P.y, tg.x, tg.y);
    let aim = tg;
    if (!(c.chase && d < 170) && navPath.length > 1 && d > 60) {
      // look ahead along the guide line
      let left = 70, ax = P.x, ay = P.y;
      for (let k = 1; k < navPath.length; k++) {
        const q = navPath[k], seg = hyp(ax, ay, q.x, q.y);
        if (seg >= left) { ax += (q.x - ax) * left / seg; ay += (q.y - ay) * left / seg; left = 0; break; }
        left -= seg; ax = q.x; ay = q.y;
      }
      aim = { x: ax, y: ay };
    }
    const diff = wrapA(Math.atan2(aim.y - P.y, aim.x - P.x) - P.a);
    let vt = Math.abs(diff) > 0.6 ? 80 : 240;
    if (!c.chase && d < 160) vt = Math.min(vt, 40 + d * 0.5);
    if ((c.type === 'ducks' && c.phase >= 1 && d < 22) || (c.type === 'traffic' && d < 20) || (c.type === 'speeder' && c.phase === 1 && d < 25)) vt = 0;
    if (c.type === 'icecream' && c.phase === 1) { const car = c.car, bx = car.x - Math.cos(car.a) * 75, by = car.y - Math.sin(car.a) * 75, td = hyp(P.x, P.y, bx, by); vt = td > 60 ? Math.min(240, 40 + td) : Math.max(0, car.v - 10); return steerTo({ x: bx, y: by }, vt); }
    if (c.type === 'speeder' && c.phase === 0 && d < 90) vt = Math.max(60, c.car.v);
    if (autoS.rev > 0) { autoS.rev -= 1 / 60; return { thr: -1, steer: diff > 0 ? -1 : 1 }; }
    if (vt > 20 && Math.abs(P.v) < 5) { autoS.stuck += 1 / 60; if (autoS.stuck > 1.2) { autoS.stuck = 0; autoS.rev = 0.7; } } else autoS.stuck = 0;
    return { thr: vt <= 0 ? 0 : clamp(vt / 250, 0.15, 1), steer: clamp(diff * 3, -1, 1) };
  }
  function steerTo(aim, vt) {
    const diff = wrapA(Math.atan2(aim.y - P.y, aim.x - P.x) - P.a);
    if (autoS.rev > 0) { autoS.rev -= 1 / 60; return { thr: -1, steer: diff > 0 ? -1 : 1 }; }
    if (vt > 20 && Math.abs(P.v) < 5) { autoS.stuck += 1 / 60; if (autoS.stuck > 1.2) { autoS.stuck = 0; autoS.rev = 0.7; } } else autoS.stuck = 0;
    return { thr: vt <= 0 ? 0 : clamp(vt / 250, 0.15, 1), steer: clamp(diff * 3, -1, 1) };
  }

  // ---------- Other players (race) ----------
  const GHOST_DELAY = 480;
  function updateGhosts(dt) {
    if (!multi) return;
    const now = performance.now();
    const list = CG.race.others();
    for (const o of list) {
      const s = o.state;
      if (!s || typeof s.x !== 'number') continue;
      let g = ghosts.get(o.name);
      if (!g) { g = { name: o.name, buf: [], offs: [], off: 0, x: s.x, y: s.y, a: s.a || 0, shown: false }; ghosts.set(o.name, g); }
      g.color = o.color; g.siren = !!s.siren; g.call = s.call || 0; g.alive = s.alive !== false;
      const last = g.buf[g.buf.length - 1];
      const st = typeof s.t === 'number' ? s.t : Date.now();
      if (!last || st !== last.t) {
        if (last && st < last.t) { g.buf.length = 0; g.offs.length = 0; }
        g.buf.push({ t: st, x: s.x, y: s.y, a: s.a || 0, v: s.v || 0 });
        if (g.buf.length > 14) g.buf.shift();
        g.offs.push(now - st); if (g.offs.length > 12) g.offs.shift();
        g.off = Math.min.apply(null, g.offs);
      }
    }
    for (const g of ghosts.values()) {
      if (!g.buf.length) continue;
      const tt = now - g.off - GHOST_DELAY;
      const b = g.buf;
      let tx, ty, ta;
      if (tt <= b[0].t) { tx = b[0].x; ty = b[0].y; ta = b[0].a; }
      else if (tt >= b[b.length - 1].t) {
        const l = b[b.length - 1], e = g.alive ? Math.min(0.7, (tt - l.t) / 1000) : 0;
        tx = l.x + Math.cos(l.a) * l.v * e; ty = l.y + Math.sin(l.a) * l.v * e; ta = l.a;
      } else {
        let k = 0; while (k < b.length - 2 && b[k + 1].t < tt) k++;
        const p = b[k], q = b[k + 1], u = (tt - p.t) / Math.max(1, q.t - p.t);
        tx = lerp(p.x, q.x, u); ty = lerp(p.y, q.y, u); ta = p.a + wrapA(q.a - p.a) * u;
      }
      if (!g.shown || hyp(g.x, g.y, tx, ty) > 300) { g.x = tx; g.y = ty; g.a = ta; g.shown = true; }
      else { const k = Math.min(1, dt * 10); g.x += (tx - g.x) * k; g.y += (ty - g.y) * k; g.a += wrapA(ta - g.a) * k; }
    }
  }

  // ---------- Update ----------
  function update(dt) {
    frameNo++;
    if (state === 'play' && multi) gameT = Math.max(0, (Date.now() - startAt) / 1000);
    else gameT += dt;
    extraObs.length = 0;
    if (state === 'play' && call) { updateCall(dt); }
    actionTap = false;
    for (const pd of peds) { pedUpdate(pd, dt); if (pd.mode === 'cross') extraObs.push(pd); }
    for (const c of cars) carUpdate(c, dt);
    // tidy up call cars that have done their job
    for (let k = cars.length - 1; k >= 0; k--) { const c = cars[k]; if (c.temp && (!call || call.car !== c) && hyp(c.x, c.y, P.x, P.y) > 900) cars.splice(k, 1); }
    if (state === 'play') {
      playerUpdate(dt);
      if (!call) { gapT -= dt; if (gapT <= 0) startCall(); }
      navAt -= dt;
      if (call && call.tgt && navAt <= 0) { navAt = 0.35; computeNav(call.tgt.x, call.tgt.y); }
      if (!call) navPath = [];
      const left = SHIFT - gameT;
      if (left <= 0) { endShift(); }
      if (multi) CG.race.update({ score: Math.round(score), alive: true, x: Math.round(P.x), y: Math.round(P.y), a: Math.round(P.a * 100) / 100, v: Math.round(P.v), call: callIdx, siren: P.siren ? 1 : 0, t: Math.round(gameT * 1000) });
    }
    updateGhosts(dt);
    // camera
    if (state === 'play' || state === 'over') {
      const lx = Math.cos(P.a) * P.v * 0.35, ly = Math.sin(P.a) * P.v * 0.35;
      lookX += (lx - lookX) * Math.min(1, dt * 2.5); lookY += (ly - lookY) * Math.min(1, dt * 2.5);
      let fx = P.x + lookX, fy = P.y + lookY, zt = baseZ * (1 - 0.1 * Math.min(1, Math.abs(P.v) / 260));
      if (call && call.type === 'traffic' && call.phase === 1) { fx = call.n.x; fy = call.n.y; zt = baseZ * 0.88; }
      if (ui && ui.classList.contains('panel') && Wl < 900) fy += Hl * 0.13 / camZ;
      const cr = call && call.type === 'traffic' && call.phase === 1 ? 3 : 9;
      camFX += (fx - camFX) * Math.min(1, dt * cr); camFY += (fy - camFY) * Math.min(1, dt * cr);
      camX = camFX; camY = camFY;
      camZ += (zt - camZ) * Math.min(1, dt * 2);
    } else {
      const t = gameT * 0.05;
      camX = WORLD / 2 + Math.sin(t) * 900; camY = WORLD / 2 + Math.sin(t * 1.3 + 1) * 800;
      camZ = baseZ;
    }
    const hw = Wl / (2 * camZ), hh = Hl / (2 * camZ);
    camX = hw * 2 >= WORLD ? WORLD / 2 : clamp(camX, hw, WORLD - hw);
    camY = hh * 2 >= WORLD ? WORLD / 2 : clamp(camY, hh, WORLD - hh);
    // particles
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k]; p.t += dt;
      if (p.t > p.life) { parts.splice(k, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'confetti') { p.vy += 220 * dt; p.vx *= 0.98; } else if (p.kind === 'hearts' || p.kind === 'note' || p.kind === 'sparkle') { p.vy -= 10 * dt; p.vx *= 0.95; }
    }
    for (let k = floats.length - 1; k >= 0; k--) { floats[k].t += dt; if (floats[k].t > floats[k].life) floats.splice(k, 1); }
    for (let k = bubbles.length - 1; k >= 0; k--) { bubbles[k].t += dt; if (bubbles[k].t > bubbles[k].life) bubbles.splice(k, 1); }
  }

  // ---------- Render ----------
  let cvs, ctx, Wl = 1, Hl = 1, dpr = 1;
  const upright = [];
  function render() {
    const z = camZ, k = z * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = GRASS; ctx.fillRect(0, 0, cvs.width, cvs.height);
    if (!T) return;
    const ox = Math.round(cvs.width / 2 - camX * k), oy = Math.round(cvs.height / 2 - camY * k);
    ctx.setTransform(k, 0, 0, k, ox, oy);
    const vx0 = camX - Wl / (2 * z), vx1 = camX + Wl / (2 * z), vy0 = camY - Hl / (2 * z), vy1 = camY + Hl / (2 * z);
    // town
    ctx.imageSmoothingEnabled = true;
    for (let cy = Math.floor(Math.max(0, vy0) / CH); cy <= Math.floor(Math.min(WORLD - 1, vy1) / CH); cy++) {
      for (let cx = Math.floor(Math.max(0, vx0) / CH); cx <= Math.floor(Math.min(WORLD - 1, vx1) / CH); cx++) {
        ctx.drawImage(chunk(cx, cy), cx * CH - PAD, cy * CH - PAD, CH + PAD * 2, CH + PAD * 2);
      }
    }
    prefetch(vx0, vy0, vx1, vy1);
    const inView = (x, y, m) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;
    const t = gameT;
    // light colours on the stop lines
    for (const n of T.nodes) {
      if (!n.lights || !inView(n.x, n.y, 120)) continue;
      for (let d = 0; d < 4; d++) {
        if (!validDir(n.i, n.j, d)) continue;
        const ind = (d + 2) % 4, L = lightOf(n, ind % 2);
        if (L === 'f' && Math.floor(t * 2.5) % 2) continue;
        ctx.fillStyle = L === 'g' ? 'rgba(34,197,94,.85)' : L === 'r' ? 'rgba(239,68,68,.9)' : 'rgba(250,204,21,.9)';
        const dx = DIRS[d][0], dy = DIRS[d][1], rx = -DIRS[ind][1], ry = DIRS[ind][0];
        const cx = n.x + dx * (R / 2 + 22) + rx * LANE, cy = n.y + dy * (R / 2 + 22) + ry * LANE;
        if (dx) ctx.fillRect(cx - 2.5, cy - 20, 5, 40); else ctx.fillRect(cx - 20, cy - 2.5, 40, 5);
      }
    }
    // the guide line to the current target
    if (state === 'play' && call && navPath.length > 1 && !P.lock) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(navPath[0].x, navPath[0].y);
      for (let q = 1; q < navPath.length; q++) ctx.lineTo(navPath[q].x, navPath[q].y);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 11; ctx.stroke();
      ctx.setLineDash([2, 16]); ctx.lineDashOffset = -t * 50;
      ctx.strokeStyle = meta().color; ctx.lineWidth = 8; ctx.stroke();
      ctx.restore();
    }
    // zones
    if (state === 'play' && call) {
      for (const zn of call.zones) {
        if (zn.box) {
          ctx.save(); ctx.translate(zn.x, zn.y);
          ctx.fillStyle = zn.on ? 'rgba(34,197,94,.35)' : 'rgba(250,204,21,.32)'; rr(ctx, -zn.w / 2, -zn.h / 2, zn.w, zn.h, 6); ctx.fill();
          ctx.setLineDash([7, 5]); ctx.lineDashOffset = -t * 20; ctx.lineWidth = 3; ctx.strokeStyle = zn.on ? '#16a34a' : '#eab308'; ctx.stroke(); ctx.setLineDash([]);
          ctx.restore();
        } else if (zn.search) {
          ctx.save(); ctx.fillStyle = 'rgba(139,92,246,.10)'; circ(ctx, zn.x, zn.y, zn.r); ctx.fill();
          ctx.setLineDash([10, 8]); ctx.lineDashOffset = -t * 18; ctx.strokeStyle = 'rgba(139,92,246,.75)'; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
        } else {
          const pulse = 1 + Math.sin(t * 5) * 0.08;
          ctx.save();
          ctx.fillStyle = zn.honk ? 'rgba(250,204,21,.3)' : 'rgba(255,255,255,.28)'; circ(ctx, zn.x, zn.y, zn.r * pulse); ctx.fill();
          ctx.lineWidth = 4; ctx.strokeStyle = zn.honk ? '#f59e0b' : meta().color; ctx.stroke();
          if (!zn.honk && call.hold > 0) { ctx.beginPath(); ctx.arc(zn.x, zn.y, zn.r * pulse + 6, -Math.PI / 2, -Math.PI / 2 + call.hold * Math.PI * 2); ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 6; ctx.stroke(); }
          ctx.restore();
        }
      }
    }
    // cars
    const flashOn = Math.floor(t * 6) % 2;
    for (const c of cars) {
      if (!inView(c.x, c.y, 60)) continue;
      drawCar(c.type, c.color, c.x, c.y, c.a, null);
    }
    // other players' cruisers
    if (multi) for (const g of ghosts.values()) {
      if (!g.shown || !inView(g.x, g.y, 80)) continue;
      ctx.globalAlpha = g.alive ? 0.92 : 0.6;
      drawCar('police', '#ffffff', g.x, g.y, g.a, { stripe: g.color, lit: g.siren ? 1 + ((Math.floor(t * 6) + g.name.length) % 2) : 0 });
      ctx.globalAlpha = 1;
    }
    // me
    if ((state === 'play' || state === 'over') && !P.hidden) {
      if (multi) { ctx.fillStyle = 'rgba(255,255,255,.35)'; circ(ctx, P.x, P.y, 34 + Math.sin(t * 4) * 2); ctx.fill(); }
      drawCar('police', '#ffffff', P.x, P.y, P.a, { lit: P.siren ? 1 + flashOn : 0 });
      // the passenger on the roof
      if (P.rider) {
        ctx.save(); ctx.translate(P.x, P.y);
        ctx.scale(1.4, 1.4);
        if (P.rider === 'kitten') drawKitten(ctx, 0, 5, t, true);
        else if (P.rider === 'balloon') drawBalloon(ctx, -6, 0, t, call ? call.color : '#ef4444');
        else if (P.rider === 'bike') { ctx.rotate(P.a); ctx.scale(0.75, 0.75); drawBike(ctx, -12, 6); }
        else if (P.rider === 'cookies') drawCookieJar(ctx, 0, 5);
        ctx.restore();
      }
    }
    // upright things, back to front: people, signals, call props
    upright.length = 0;
    for (const pd of peds) if (inView(pd.x, pd.y, 30)) upright.push(pd);
    for (const n of T.nodes) if (n.lights && inView(n.x, n.y, 90)) upright.push(n);
    if (state === 'play' && call) for (const f of call.figs) upright.push(f);
    upright.sort((a, b) => sortY(a) - sortY(b));
    for (const u of upright) {
      if (u.f) { u.f(ctx); continue; }
      if (u.look != null) {
        const fr = u.mode === 'wait' ? 0 : 1 + (Math.floor(u.step) % 2);
        const img = pedSprite(u.look, fr), sc = u.kid ? 0.78 : 1;
        const hop = u.hop > 0 ? Math.sin((0.5 - u.hop) / 0.5 * Math.PI) * 10 : 0;
        ctx.drawImage(img, u.x - 12 * sc, u.y - 33 * sc - hop, 24 * sc, 36 * sc);
      } else drawSignals(u, t);
    }
    // siren glows (additive)
    ctx.globalCompositeOperation = 'lighter';
    if ((state === 'play' || state === 'over') && P.siren && !P.hidden) sirenGlow(P.x, P.y, P.a, flashOn);
    if (multi) for (const g of ghosts.values()) if (g.shown && g.siren && inView(g.x, g.y, 80)) sirenGlow(g.x, g.y, g.a, (Math.floor(t * 6) + g.name.length) % 2);
    ctx.globalCompositeOperation = 'source-over';
    // particles
    for (const p of parts) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = Math.max(0, a);
      if (p.kind === 'confetti') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.spin + p.t * 8); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); }
      else if (p.kind === 'hearts') heart(ctx, p.x, p.y, 4 + p.t * 2, '#f43f5e');
      else if (p.kind === 'sparkle') { artStar(ctx, p.x, p.y, 4.5, 1.6, '#fde047'); }
      else if (p.kind === 'star') { artStar(ctx, p.x, p.y, 5, 2, '#facc15'); }
      else if (p.kind === 'note') { ctx.fillStyle = '#ec4899'; circ(ctx, p.x, p.y, 2.6); ctx.fill(); ctx.fillRect(p.x + 1.8, p.y - 9, 1.3, 9); }
      else if (p.kind === 'crumb') { ctx.fillStyle = '#c08443'; circ(ctx, p.x, p.y, 2); ctx.fill(); }
      else { ctx.fillStyle = '#e5e7eb'; circ(ctx, p.x, p.y, p.r * (1 + p.t * 2.2)); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    // the target arrow around my car
    if (state === 'play' && call && call.tgt && !P.lock) {
      const d = hyp(P.x, P.y, call.tgt.x, call.tgt.y);
      if (d > 90) {
        const a = Math.atan2(call.tgt.y - P.y, call.tgt.x - P.x), rad = 46 + Math.sin(t * 6) * 3;
        ctx.save(); ctx.translate(P.x + Math.cos(a) * rad, P.y + Math.sin(a) * rad); ctx.rotate(a);
        ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -10); ctx.lineTo(-2, 0); ctx.lineTo(-6, 10); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.restore();
      }
    }
    // screen space: name tags, bubbles, floating text
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = (x) => (x - camX) * z + Wl / 2, sy = (y) => (y - camY) * z + Hl / 2;
    if (multi) for (const g of ghosts.values()) {
      if (!g.shown || !inView(g.x, g.y, 80)) continue;
      tag(sx(g.x), sy(g.y) - 30 * z - 6, `${g.name} · Call ${g.call + 1}`, g.color, g.alive);
    }
    for (const b of bubbles) {
      if (!inView(b.x, b.y, 200)) continue;
      const a = b.t < 0.15 ? b.t / 0.15 : b.t > b.life - 0.3 ? (b.life - b.t) / 0.3 : 1;
      speech(sx(b.x), sy(b.y) - b.t * 4, b.text, a);
    }
    for (const f of floats) {
      const a = f.t > f.life - 0.4 ? (f.life - f.t) / 0.4 : 1, pop = f.t < 0.15 ? 0.6 + f.t / 0.15 * 0.4 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = `900 ${Math.round(22 * f.size * pop)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineJoin = 'round';
      const yy = sy(f.y) - f.t * 40;
      ctx.strokeText(f.text, sx(f.x), yy); ctx.fillStyle = f.color; ctx.fillText(f.text, sx(f.x), yy);
      ctx.globalAlpha = 1;
    }
    // off-screen target pointer at the screen edge
    if (state === 'play' && call && call.tgt) {
      const tx = sx(call.tgt.x), ty = sy(call.tgt.y), m = 26;
      if (tx < 0 || ty < 0 || tx > Wl || ty > Hl) {
        const cx = Wl / 2, cy = Hl / 2, a = Math.atan2(ty - cy, tx - cx);
        const kx = (Wl / 2 - m) / Math.max(0.001, Math.abs(Math.cos(a))), ky = (Hl / 2 - m) / Math.max(0.001, Math.abs(Math.sin(a))), kk = Math.min(kx, ky);
        const px = cx + Math.cos(a) * kk, py = cy + Math.sin(a) * kk;
        ctx.save(); ctx.translate(px, py);
        ctx.fillStyle = meta().color; circ(ctx, 0, 0, 17); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.rotate(a); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -7); ctx.lineTo(-2, 0); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }
  const sortY = (u) => (u.f ? u.y : u.look != null ? u.y : u.y + R / 2 + 9);
  function drawCar(type, color, x, y, a, o) {
    const img = carSprite(type, color, o);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.drawImage(img, -img.wl / 2, -img.hl / 2, img.wl, img.hl);
    ctx.restore();
  }
  function sirenGlow(x, y, a, ph) {
    const ox = Math.cos(a) * -4, oy = Math.sin(a) * -4, px = -Math.sin(a) * 7, py = Math.cos(a) * 7;
    const img = ph ? glowR : glowB, s = 70;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(img, x + ox + (ph ? -px : px) - s / 2, y + oy + (ph ? -py : py) - s / 2, s, s);
    ctx.globalAlpha = 0.25;
    ctx.drawImage(img, x - 70, y - 70, 140, 140);
    ctx.globalAlpha = 1;
  }
  function drawSignals(n, t) {
    // four little traffic lights on the corners: SW + NE show east-west, NW + SE show north-south
    const e = R / 2 + 9;
    const heads = [[-e, e, 0, 0], [e, -e, 0, 2], [-e, -e, 1, 1], [e, e, 1, 3]];
    for (const [ox, oy, axis, need] of heads) {
      // skip heads for approaches that don't exist (edges of town)
      if (need === 0 && n.i === 0) continue; if (need === 2 && n.i === NB) continue; if (need === 1 && n.j === 0) continue; if (need === 3 && n.j === NB) continue;
      const x = n.x + ox, y = n.y + oy, L = lightOf(n, axis);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ell(ctx, x + 2, y + 1, 4, 1.6); ctx.fill();
      ctx.fillStyle = '#475569'; ctx.fillRect(x - 1, y - 20, 2, 20);
      ctx.fillStyle = '#1e293b'; rr(ctx, x - 4.5, y - 40, 9, 22, 3); ctx.fill();
      const on = (c) => (L === c || (L === 'f' && c === 'y' && Math.floor(t * 2.5) % 2 === 0));
      ctx.fillStyle = on('r') ? '#ff4d4d' : '#5b1f1f'; circ(ctx, x, y - 35, 2.6); ctx.fill();
      ctx.fillStyle = on('y') ? '#ffd23f' : '#5b4a1f'; circ(ctx, x, y - 29, 2.6); ctx.fill();
      ctx.fillStyle = on('g') ? '#3ee07a' : '#1f4a2c'; circ(ctx, x, y - 23, 2.6); ctx.fill();
    }
  }
  function heart(g, x, y, s, col) {
    g.fillStyle = col; g.beginPath();
    g.moveTo(x, y + s * 0.9);
    g.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.8, y - s * 1.4, x, y - s * 0.5);
    g.bezierCurveTo(x + s * 0.8, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
    g.fill();
  }
  function tag(x, y, text, color, alive) {
    ctx.font = `700 13px ${FONT}`;
    const tw = ctx.measureText(text).width + 16, th = 22;
    ctx.globalAlpha = alive ? 0.95 : 0.6;
    ctx.fillStyle = color; rr(ctx, x - tw / 2, y - th, tw, th, th / 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 5, y - 1); ctx.lineTo(x + 5, y - 1); ctx.lineTo(x, y + 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y - th / 2 + 0.5);
    ctx.globalAlpha = 1;
  }
  function speech(x, y, text, a) {
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.font = `700 14px ${FONT}`;
    const tw = Math.min(220, ctx.measureText(text).width + 20), th = 28;
    const bx = clamp(x - tw / 2, 6, Wl - tw - 6), by = y - th - 8;
    ctx.fillStyle = 'rgba(15,23,42,.18)'; rr(ctx, bx + 2, by + 3, tw, th, 12); ctx.fill();
    ctx.fillStyle = '#fff'; rr(ctx, bx, by, tw, th, 12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(clamp(x, bx + 12, bx + tw - 12) - 6, by + th - 1); ctx.lineTo(clamp(x, bx + 12, bx + tw - 12) + 6, by + th - 1); ctx.lineTo(clamp(x, bx + 12, bx + tw - 12), by + th + 7); ctx.fill();
    ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + tw / 2, by + th / 2 + 0.5, tw - 12);
    ctx.globalAlpha = 1;
  }

  // ---------- HUD (DOM) ----------
  const hud = { dirty: true, bump: 0, time: '', score: '', rank: -1, dist: '', ang: 0, meter: -2, near: null, siren: null, card: null };
  let ui, el = {};
  function buildUI(root) {
    ui = document.createElement('div');
    ui.className = 'pp-ui off';
    ui.innerHTML =
      `<div class="pp-top pp-play"><div class="pp-chip time">${CG.icon('clock', 18)}<span class="v">5:00</span></div>` +
      `<div class="pp-chip score">${CG.icon('star', 18)}<span class="v">0</span></div>` +
      `<div class="pp-chip pp-rank"><span class="pp-rb"></span><span class="rn"></span></div></div>` +
      `<div class="pp-card pp-play hide"><div class="ci"></div><div class="ct"><b>${CG.icon('siren', 14)}<span class="cn"></span></b><p></p><div class="pp-meter"><i></i></div></div><div class="cd"><div class="ar">${CG.icon('arrowUp', 20)}</div><span class="dv"></span></div></div>` +
      `<div class="pp-alert"></div>` +
      `<div class="pp-banner"></div>` +
      `<div class="pp-map pp-play"><canvas></canvas></div>` +
      `<div class="pp-joy"><div class="pp-knob"></div></div>` +
      `<div class="pp-btns pp-play"><button type="button" class="pp-btn siren" aria-label="Siren">${CG.icon('siren', 28)}<span>SIREN</span></button><button type="button" class="pp-btn act" aria-label="Help">${CG.icon('handshake', 30)}<span>HELP</span></button></div>` +
      `<div class="pp-keys pp-play"><span><kbd>${CG.icon('arrowUp', 12)}</kbd><kbd>${CG.icon('arrowDown', 12)}</kbd><kbd>${CG.icon('arrowLeft', 12)}</kbd><kbd>${CG.icon('arrowRight', 12)}</kbd> drive</span><span><kbd>Space</kbd> siren</span><span><kbd>E</kbd> help</span><span><kbd>P</kbd> pause</span></div>` +
      `<div class="pp-panel pp-ticket"></div><div class="pp-panel pp-traffic"></div>`;
    root.appendChild(ui);
    el = {
      top: ui.querySelector('.pp-top'), time: ui.querySelector('.pp-chip.time'), timeV: ui.querySelector('.pp-chip.time .v'), score: ui.querySelector('.pp-chip.score'), scoreV: ui.querySelector('.pp-chip.score .v'),
      rb: ui.querySelector('.pp-rb'), rn: ui.querySelector('.rn'), card: ui.querySelector('.pp-card'), ci: ui.querySelector('.pp-card .ci'), cn: ui.querySelector('.pp-card .cn'), cp: ui.querySelector('.pp-card p'),
      meter: ui.querySelector('.pp-meter'), meterI: ui.querySelector('.pp-meter i'), ar: ui.querySelector('.pp-card .ar'), dv: ui.querySelector('.pp-card .dv'),
      alert: ui.querySelector('.pp-alert'), banner: ui.querySelector('.pp-banner'), map: ui.querySelector('.pp-map canvas'), mapBox: ui.querySelector('.pp-map'),
      joy: ui.querySelector('.pp-joy'), knob: ui.querySelector('.pp-knob'), btns: ui.querySelector('.pp-btns'), siren: ui.querySelector('.pp-btn.siren'), act: ui.querySelector('.pp-btn.act'), keys: ui.querySelector('.pp-keys')
    };
    ticketEl = ui.querySelector('.pp-ticket'); trafficEl = ui.querySelector('.pp-traffic');
    if (!isTouch()) el.btns.style.display = 'none'; else el.keys.style.display = 'none';
    const press = (b, fn) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); ensureAudio(); if (CG.modalOpen() || state !== 'play' || paused) return; fn(e); });
    press(el.siren, () => toggleSiren());
    press(el.act, () => { actionHeld = true; actionTap = true; });
    el.act.addEventListener('pointerup', () => { actionHeld = false; });
    el.act.addEventListener('pointercancel', () => { actionHeld = false; });
    ticketEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.stamp) ticketStamp(); else if (b.dataset.k != null) ticketPick(Number(b.dataset.k)); });
    trafficEl.addEventListener('pointerdown', (e) => { const b = e.target.closest('button[data-d]'); if (!b || b.disabled) return; e.preventDefault(); trafficPick(Number(b.dataset.d)); });
    for (const p of [ticketEl, trafficEl]) p.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  function rankBadge(rk, size) { return `<span class="pp-rb" style="width:${size}px;height:${size}px;background:linear-gradient(135deg,${rk.c1},${rk.c2})">${CG.icon(rk.icon, Math.round(size * 0.56))}</span>`; }
  function showCard(on) { el.card.classList.toggle('hide', !on); hud.dirty = true; }
  function flashCard() { el.card.classList.remove('flash'); void el.card.offsetWidth; el.card.classList.add('flash'); }
  let alertTimer = null;
  function flash(text, kind) {
    el.alert.className = 'pp-alert show' + (kind === 'good' ? ' good' : kind === 'info' ? ' info' : '');
    el.alert.innerHTML = `${CG.icon(kind === 'good' ? 'thumbsUp' : kind === 'info' ? 'info' : 'shield', 20)}<span></span>`;
    el.alert.querySelector('span').textContent = text;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => el.alert.classList.remove('show'), 1900);
  }
  function banner(title, sub, icon, color, rk) {
    el.banner.innerHTML = `<div class="bb" style="background:${rk ? `linear-gradient(135deg,${rk.c1},${rk.c2})` : color}">${CG.icon(icon, 38)}</div><h2></h2><p></p>`;
    el.banner.querySelector('h2').textContent = title;
    el.banner.querySelector('p').textContent = sub;
    el.banner.classList.remove('show'); void el.banner.offsetWidth; el.banner.classList.add('show');
  }
  let layoutAt = 0;
  function hudTick(now) {
    if (state !== 'play' && state !== 'over') return;
    const left = Math.max(0, SHIFT - gameT);
    const ts = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    if (ts !== hud.time) { hud.time = ts; el.timeV.textContent = ts; el.time.classList.toggle('low', left <= 30 && state === 'play'); }
    const ss = Math.round(score).toLocaleString('en-US');
    if (ss !== hud.score) {
      hud.score = ss; el.scoreV.textContent = ss;
      el.score.classList.remove('bump', 'minus'); void el.score.offsetWidth; el.score.classList.add('bump'); if (hud.bump < 0) el.score.classList.add('minus');
    }
    if (rankIdx !== hud.rank) {
      hud.rank = rankIdx; const rk = RANKS[rankIdx];
      el.rb.outerHTML = rankBadge(rk, 27); el.rb = ui.querySelector('.pp-rank .pp-rb'); el.rn.textContent = rk.name;
    }
    if (call) {
      if (hud.dirty) {
        hud.dirty = false;
        const m = meta();
        if (hud.card !== call) { hud.card = call; el.ci.style.background = m.color; el.ci.innerHTML = CG.icon(m.icon, 26); el.cn.textContent = m.title; }
        el.cp.textContent = call.text;
      }
      const tg = call.tgt;
      if (tg) {
        const d = hyp(P.x, P.y, tg.x, tg.y), ds = d < 100 ? 'here' : `${Math.max(1, Math.round((navPath.length > 1 ? Math.max(navLen, d) : d) / 5))} m`;
        if (ds !== hud.dist) { hud.dist = ds; el.dv.textContent = ds === 'here' ? 'Here!' : ds; el.ar.classList.toggle('here', ds === 'here'); }
        // arrow follows the guide line's next turn
        let ax = tg.x, ay = tg.y;
        if (navPath.length > 2 && hyp(P.x, P.y, navPath[1].x, navPath[1].y) > 30) { ax = navPath[1].x; ay = navPath[1].y; } else if (navPath.length > 2) { ax = navPath[2].x; ay = navPath[2].y; }
        const ang = Math.round(Math.atan2(ay - P.y, ax - P.x) * 180 / Math.PI + 90);
        if (ang !== hud.ang) { hud.ang = ang; el.ar.firstChild.style.transform = `rotate(${ang}deg)`; }
      }
      const mv = call.meter >= 0 ? Math.round(call.meter * 100) : -1;
      if (mv !== hud.meter) { hud.meter = mv; el.meter.classList.toggle('on', mv >= 0); if (mv >= 0) el.meterI.style.width = mv + '%'; }
      const nr = !!call.near && !P.lock;
      if (nr !== hud.near) { hud.near = nr; el.act.classList.toggle('ready', nr); }
    }
    if (P.siren !== hud.siren) { hud.siren = P.siren; el.siren.classList.toggle('on', P.siren); }
    if (call && call.sirenHint && !P.siren) el.siren.classList.add('ready'); else el.siren.classList.remove('ready');
    if (trafficEl.classList.contains('show') && call && call.prompt && !call.prompt.ok) { const bar = trafficEl.querySelector('.pp-tbar i'); if (bar) bar.style.width = Math.max(0, 100 - call.prompt.t / call.prompt.lim * 100) + '%'; }
    // keep the dispatch card clear of the live scoreboard in a race
    if (now - layoutAt > 500) {
      layoutAt = now;
      const wr = ui.getBoundingClientRect();
      let top = el.top.getBoundingClientRect().bottom - wr.top + 8;
      const rb = document.getElementById('cg-race');
      if (rb && multi) { const r = rb.getBoundingClientRect(); if (r.height) { const cr = el.card.getBoundingClientRect(); if (r.left < cr.right) top = Math.max(top, r.bottom - wr.top + 8); } }
      el.card.style.top = top + 'px';
      el.alert.style.top = (call ? el.card.getBoundingClientRect().bottom - wr.top + 10 : top) + 'px';
      el.btns.style.display = isTouch() && state === 'play' && !P.lock ? '' : 'none';
    }
    drawMinimap();
  }
  let mapCtx = null, mapFrame = 0;
  function drawMinimap() {
    if (!mapBase || (mapFrame++ % 3)) return;
    const c = el.map, box = el.mapBox.clientWidth || 112, px = Math.round(box * dpr);
    if (c.width !== px) { c.width = c.height = px; mapCtx = c.getContext('2d'); }
    const g = mapCtx, k = px / WORLD;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(mapBase, 0, 0, px, px);
    if (call && call.zones) for (const zn of call.zones) if (zn.search) { g.fillStyle = 'rgba(139,92,246,.35)'; circ(g, zn.x * k, zn.y * k, zn.r * k); g.fill(); }
    if (navPath.length > 1 && call) { g.strokeStyle = meta().color; g.lineWidth = 2.5 * dpr; g.lineJoin = 'round'; g.beginPath(); g.moveTo(navPath[0].x * k, navPath[0].y * k); for (let q = 1; q < navPath.length; q++) g.lineTo(navPath[q].x * k, navPath[q].y * k); g.stroke(); }
    if (call && call.tgt) { const p = 1 + Math.sin(gameT * 6) * 0.25; g.fillStyle = meta().color; circ(g, call.tgt.x * k, call.tgt.y * k, 5 * dpr * p); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5 * dpr; g.stroke(); }
    if (multi) for (const gh of ghosts.values()) { if (!gh.shown) continue; g.fillStyle = gh.color; circ(g, gh.x * k, gh.y * k, 3.6 * dpr); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1 * dpr; g.stroke(); }
    g.save(); g.translate(P.x * k, P.y * k); g.rotate(P.a);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(7 * dpr, 0); g.lineTo(-5 * dpr, -5 * dpr); g.lineTo(-2.5 * dpr, 0); g.lineTo(-5 * dpr, 5 * dpr); g.closePath(); g.fill();
    g.strokeStyle = '#1d4ed8'; g.lineWidth = 1.5 * dpr; g.stroke();
    g.restore();
  }

  // ---------- Flow ----------
  let overlay, pauseEl, root;
  function toggleSiren() { if (state !== 'play') return; P.siren = !P.siren; CG.sfx(P.siren ? 'go' : 'click'); }
  function resetPlay(seed, isMulti) {
    multi = isMulti;
    if (!T || T.seed !== seed) { T = genTown(seed); clearChunks(); buildMinimap(); }
    for (const n of T.nodes) { n.broken = false; n.manual = null; }
    spawnTraffic(seed);
    calls = genCalls(seed);
    callIdx = 0; call = null; gapT = 1.2; callsDone = 0;
    score = 0; peak = 0; rankIdx = 0;
    Object.assign(P, { x: T.start.x, y: T.start.y, a: T.start.a, v: 0, siren: false, lock: false, hidden: false, rider: null, inNode: -1, safeT: 0 });
    for (const k in penCool) penCool[k] = 0;
    parts.length = 0; floats.length = 0; bubbles.length = 0; ghosts.clear(); navPath = [];
    gameT = 0; lookX = lookY = 0; camZ = baseZ; camFX = P.x; camFY = P.y;
    hud.time = hud.score = hud.dist = ''; hud.rank = -1; hud.card = null; hud.meter = -2; hud.dirty = true;
    hidePanels(); showCard(false);
    autoS.stuck = autoS.rev = autoS.ans = 0;
  }
  function startShift(seed, isMulti) {
    ensureAudio();
    resetPlay(seed, isMulti);
    startAt = isMulti ? (Date.parse((CG.session() || {}).startAt || '') || Date.now()) : 0;
    state = 'play'; paused = false;
    overlay.classList.add('hide'); pauseEl.classList.add('hide');
    ui.classList.remove('off');
    if (!isMulti) CG.sfx('go');
    joy.on = false; el.joy.classList.remove('on');
  }
  function startSolo() { if (CG.isMulti()) return; startShift(T && state === 'title' ? T.seed : Math.floor(Math.random() * 2 ** 31), false); }
  function endShift() {
    if (state !== 'play') return;
    state = 'over';
    P.siren = false; P.v = 0;
    hidePanels(); showCard(false);
    const sc = Math.round(score);
    if (multi) {
      CG.race.update({ score: sc, alive: false, x: Math.round(P.x), y: Math.round(P.y), a: Math.round(P.a * 100) / 100, v: 0, call: callIdx, siren: 0, t: Math.round(gameT * 1000) });
      CG.gameOver({ score: sc, title: 'Shift complete!' });
    } else {
      CG.sfx('win');
      CG.gameOver({ score: sc, title: 'Shift complete!', again: startSolo });
    }
  }
  function toTitle() {
    state = 'title'; multi = false; paused = false;
    resetPlay(Math.floor(Math.random() * 2 ** 31), false);
    ui.classList.add('off');
    overlay.classList.remove('hide'); pauseEl.classList.add('hide');
  }
  function pause() {
    if (state !== 'play' || multi || paused) return;
    paused = true; pauseEl.classList.remove('hide');
    keys.up = keys.down = keys.left = keys.right = false; joy.on = false; el.joy.classList.remove('on'); actionHeld = false;
  }
  function resume() { if (!paused) return; paused = false; pauseEl.classList.add('hide'); last = 0; ensureAudio(); }
  function buildOverlays() {
    overlay = document.createElement('div');
    overlay.className = 'pp-over';
    const touch = isTouch();
    const ctl = touch
      ? `<div><span class="k t"><span class="ib" style="background:rgba(255,255,255,.18)">${CG.icon('gamepad', 18)}</span></span>Touch and drag anywhere to drive</div>` +
        `<div><span class="k t"><span class="ib" style="background:linear-gradient(90deg,#ef4444 50%,#3b82f6 50%)">${CG.icon('siren', 17)}</span></span>Siren on and off</div>` +
        `<div><span class="k t"><span class="ib" style="background:#f59e0b">${CG.icon('handshake', 17)}</span></span>Help (or just stop close by)</div>`
      : `<div><span class="k"><kbd>${CG.icon('arrowUp', 12)}</kbd><kbd>${CG.icon('arrowDown', 12)}</kbd><kbd>${CG.icon('arrowLeft', 12)}</kbd><kbd>${CG.icon('arrowRight', 12)}</kbd></span>Drive (or W A S D)</div>` +
        '<div><span class="k"><kbd>Space</kbd></span>Siren on and off</div>' +
        '<div><span class="k"><kbd>E</kbd></span>Help (or just stop close by)</div>';
    overlay.innerHTML = `<div class="pp-tcard">${CG.badge('police', 64)}<div class="pp-logo">POLICE<span>PATROL</span></div>` +
      '<p class="pp-tag">Answer the radio, help the town and earn your badges! Follow the dotted line to each call, and stop at red lights.</p>' +
      `<div class="pp-ranks">${RANKS.map((rk) => `<div>${rankBadge(rk, 34)}${rk.name}</div>`).join('')}</div>` +
      `<div class="pp-ctl">${ctl}</div><button type="button" class="pp-go">${CG.icon('play', 20)} Start shift</button></div>`;
    root.appendChild(overlay);
    overlay.querySelector('.pp-go').addEventListener('click', (e) => { e.stopPropagation(); if (CG.modalOpen()) return; startSolo(); });
    pauseEl = document.createElement('div');
    pauseEl.className = 'pp-over pp-pause hide';
    pauseEl.innerHTML = `<div class="pp-tcard"><div class="cg-hero" style="margin:0 auto;background:rgba(255,255,255,.15);color:#fff">${CG.icon('pause', 26)}</div><h2>Paused</h2><button type="button" class="pp-go">${CG.icon('play', 20)} Keep driving</button></div>`;
    root.appendChild(pauseEl);
    pauseEl.addEventListener('click', () => resume());
  }

  // ---------- Input ----------
  function onKey(e, down) {
    const k = e.key;
    const map = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
    if (CG.modalOpen()) { if (!down && map[k]) keys[map[k]] = false; return; }
    const tag2 = e.target && e.target.tagName;
    if (tag2 === 'INPUT' || tag2 === 'TEXTAREA') return;
    if (map[k]) { keys[map[k]] = down; e.preventDefault(); }
    if (k === 'e' || k === 'E' || k === 'Enter') { actionHeld = down; if (down && !e.repeat) actionTap = true; }
    if (!down || e.repeat) return;
    if (state === 'title' && (k === ' ' || k === 'Enter') && !CG.isMulti()) { e.preventDefault(); startSolo(); return; }
    if (paused) { if (k === ' ' || k === 'Enter' || k === 'p' || k === 'P' || k === 'Escape') { e.preventDefault(); resume(); } return; }
    if (state !== 'play') return;
    if (k === ' ') { e.preventDefault(); toggleSiren(); }
    if ((k === 'p' || k === 'P' || k === 'Escape') && !multi) pause();
    // mini-games
    if (call && call.type === 'traffic' && call.phase === 1) {
      const dmap = { ArrowRight: 0, d: 0, D: 0, ArrowDown: 1, s: 1, S: 1, ArrowLeft: 2, a: 2, A: 2, ArrowUp: 3, w: 3, W: 3 };
      if (dmap[k] != null) trafficPick(dmap[k]);
    }
    if (call && call.type === 'speeder' && call.phase === 2) {
      if (k === '1' || k === '2' || k === '3') ticketPick(Number(k) - 1);
      if ((k === 'e' || k === 'E' || k === 'Enter') && call.ticket && call.ticket.stamp) ticketStamp();
    }
  }
  function onDown(e) {
    ensureAudio();
    if (CG.modalOpen()) return;
    if (paused || state !== 'play') return;
    if (joy.id != null || P.lock) return;
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    joy.id = e.pointerId; joy.x0 = x; joy.y0 = y; joy.dx = joy.dy = 0; joy.on = true;
    el.joy.style.left = x + 'px'; el.joy.style.top = y + 'px'; el.knob.style.transform = '';
    el.joy.classList.add('on');
    try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  }
  function onMove(e) {
    if (e.pointerId !== joy.id) return;
    const r = root.getBoundingClientRect();
    let dx = e.clientX - r.left - joy.x0, dy = e.clientY - r.top - joy.y0;
    const len = Math.hypot(dx, dy), max = 54;
    if (len > max) {
      // drag the base along so the stick never gets stuck at the edge
      const over = len - max; joy.x0 += dx / len * over; joy.y0 += dy / len * over; dx = dx / len * max; dy = dy / len * max;
      el.joy.style.left = joy.x0 + 'px'; el.joy.style.top = joy.y0 + 'px';
    }
    joy.dx = dx; joy.dy = dy;
    el.knob.style.transform = `translate(${dx}px,${dy}px)`;
  }
  function onUp(e) { if (e.pointerId !== joy.id) return; joy.id = null; joy.on = false; joy.dx = joy.dy = 0; el.joy.classList.remove('on'); }

  // ---------- Size ----------
  function resize() {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const nd = Math.min(2, window.devicePixelRatio || 1);
    if (w === Wl && h === Hl && nd === dpr && cvs.width > 1) return;
    Wl = w; Hl = h; dpr = nd;
    cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr);
    cvs.style.width = w + 'px'; cvs.style.height = h + 'px';
    baseZ = clamp(Math.sqrt(w * h) / 600, 0.72, 1.3);
    if (w < 500) baseZ = Math.min(baseZ, 0.86);
    camZ = baseZ;
    const nrs = Math.min(2, Math.round(baseZ * dpr * 4) / 4);
    maxChunks = Math.ceil(w / baseZ / CH + 2) * Math.ceil(h / baseZ / CH + 2) + 4;
    if (nrs !== rs) { rs = nrs; clearChunks(); spriteCache.clear(); }
  }

  // ---------- Loop ----------
  let last = 0;
  const prof = { u: 0, r: 0, n: 0, max: 0 };
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    dt = Math.min(dt, 0.05);
    const frozen = paused || (state === 'play' && !multi && CG.modalOpen());
    const p0 = performance.now();
    if (!frozen && T) for (let k = 0; k < timeScale; k++) update(dt);
    const p1 = performance.now();
    render();
    const p2 = performance.now();
    prof.u += p1 - p0; prof.r += p2 - p1; prof.n++; if (p2 - p0 > prof.max) prof.max = p2 - p0;
    hudTick(now);
    audioTick(now);
  }

  // ---------- Boot ----------
  const HELP = '<ul>' +
    '<li><b>Drive</b>: arrow keys or W A S D. On a phone, touch and drag on the screen to point the car where you want to go.</li>' +
    '<li>The <b>radio</b> gives you calls one after another. Follow the <b>dotted line</b>, the yellow arrow and the minimap.</li>' +
    '<li>Stop close to the glowing circle and things happen by themselves, or press <b>E</b> / the help button.</li>' +
    '<li><b>Siren</b>: Space or the siren button. Use it to stop speeding cars. With the siren on, cars move aside and you may pass red lights.</li>' +
    '<li>Calls: rescue kittens, stop speeders and write a ticket, hold traffic for ducks, find lost things, catch the Cookie Bandit, direct traffic and escort the ice cream truck.</li>' +
    '<li>Faster calls give a <b>time bonus</b>. Running a red light or bumping cars costs a few points. A careful stop at a red light earns +5.</li>' +
    '<li>Earn points to rank up: Cadet, Officer, Sergeant, Detective and Chief. A shift lasts <b>5 minutes</b>.</li>' +
    '<li>Play together: everyone patrols the same town with the same calls. You see the other cruisers with their names.</li></ul>';
  CG.mount({
    id: 'police', title: 'Police Patrol', mode: 'race', scoreLabel: 'points', syncMs: 400, help: HELP,
    onReady(c) {
      root = document.createElement('div');
      root.className = 'pp-wrap';
      c.root.appendChild(root);
      cvs = document.createElement('canvas');
      cvs.className = 'pp-main';
      cvs.setAttribute('aria-label', 'Police Patrol town');
      root.appendChild(cvs);
      ctx = cvs.getContext('2d', { alpha: false });
      glowR = glowSprite('rgba(255,60,60,.9)'); glowB = glowSprite('rgba(60,130,255,.9)');
      buildUI(root);
      buildOverlays();
      resize();
      if (window.ResizeObserver) new ResizeObserver(resize).observe(root);
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 200));
      window.addEventListener('keydown', (e) => onKey(e, true));
      window.addEventListener('keyup', (e) => onKey(e, false));
      window.addEventListener('blur', () => { keys.up = keys.down = keys.left = keys.right = false; actionHeld = false; joy.on = false; joy.id = null; });
      root.addEventListener('pointerdown', onDown);
      root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerup', onUp);
      root.addEventListener('pointercancel', onUp);
      root.addEventListener('lostpointercapture', onUp);
      root.addEventListener('contextmenu', (e) => e.preventDefault());
      ['pointerdown', 'keydown', 'touchend'].forEach((t) => window.addEventListener(t, ensureAudio, { capture: true, passive: true }));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { clearChunks(); spriteCache.clear(); });
      toTitle();
      requestAnimationFrame(frame);
      window.__police = {
        get state() { return state; }, get paused() { return paused; }, get P() { return P; }, get call() { return call; }, get callIdx() { return callIdx; }, get score() { return score; }, get rank() { return RANKS[rankIdx].name; },
        get gameT() { return gameT; }, set gameT(v) { gameT = v; if (multi) startAt = Date.now() - v * 1000; }, get T() { return T; }, get cars() { return cars; }, get ghosts() { return ghosts; }, get calls() { return calls; }, get chunks() { return chunks.size; },
        set auto(v) { autopilot = !!v; }, set timeScale(v) { timeScale = Math.max(1, Math.min(8, v | 0)); }, get auto() { return autopilot; }, teleport(x, y, a) { P.x = x; P.y = y; if (a != null) P.a = a; P.v = 0; navAt = 0; },
        skipCall() { if (call) finishCall(); }, prof, get navPath() { return navPath; }
      };
    }
  });
  CG.on('pause', () => { pause(); if (ac && ac.state === 'running') try { ac.suspend(); } catch (e) { /* ignore */ } });
  CG.on('resume', () => { if (ac && ac.state === 'suspended') try { ac.resume(); } catch (e) { /* ignore */ } last = 0; });
  CG.on('multiStart', (info) => { startShift(info.seed, true); });
  CG.on('multiEnd', () => { toTitle(); });
})();
