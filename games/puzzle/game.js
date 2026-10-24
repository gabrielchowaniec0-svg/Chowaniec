// Picture Puzzle: a jigsaw with real tab-and-blank pieces (12 to 100 pieces) or a sliding-tile puzzle
// (3×3 to 5×5), made from built-in painted pictures (pictures.js) or your own photo.
// Race mode: the host picks the picture, mode and size in roundSetup (a custom photo is shared with
// ChowGames.uploadImage), and everyone gets the same picture, the same piece shapes and the same scatter
// order from the round's seed. Fastest wins.
//
// Scoring (documented in the help too):
//   Jigsaw: points = round(pieces × 100 × max(0.3, 1 − seconds / (pieces × 10)))
//   Slide:  points = round(N² × 100 × max(0.3, 1 − 0.6 × seconds / (4·N³) − 0.4 × moves / (4·N³)))
// Bigger puzzles are worth more, and a quicker solve always scores at least as much as a slower one.
(function () {
  'use strict';

  const G = window.ChowGames;
  const PICS = window.PuzzlePictures;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => G.icon(n, s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const BW = 1200, BH = 900;          // board size in world units (pictures are 4:3)
  const PIC_W = 1600, PIC_H = 1200;   // resolution pictures are painted / loaded at
  const JIGSAW = { 12: [4, 3, 'Kids'], 24: [6, 4, 'Easy'], 48: [8, 6, 'Medium'], 100: [10, 10, 'Expert'] };
  const SLIDE = { 3: 'Easy', 4: 'Medium', 5: 'Hard' };

  // ---------- preferences ----------
  const PREF_KEY = 'chow_puzzle_pref', PHOTO_KEY = 'chow_puzzle_photo';
  const pref = { mode: 'jigsaw', pieces: 12, slide: 3, pic: 'balloons', ghost: true, edges: false, numbers: false };
  try { Object.assign(pref, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { /* ignore */ }
  if (!JIGSAW[pref.pieces]) pref.pieces = 12;
  if (!SLIDE[pref.slide]) pref.slide = 3;
  if (pref.mode !== 'slide') pref.mode = 'jigsaw';
  const savePref = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (e) { /* ignore */ } };

  let custom = null;   // { dataUrl, canvas, thumb, upload: { id, url } }
  function loadSavedPhoto() {
    try {
      const d = localStorage.getItem(PHOTO_KEY);
      if (d && d.startsWith('data:image/')) imageFromUrl(d).then((img) => setCustom(d, img, false)).catch(() => {});
    } catch (e) { /* ignore */ }
  }
  if (pref.pic === 'custom' && !(function () { try { return localStorage.getItem(PHOTO_KEY); } catch (e) { return null; } })()) pref.pic = 'balloons';
  if (pref.pic !== 'custom' && !PICS.list.some((p) => p.key === pref.pic)) pref.pic = 'balloons';

  // ---------- pictures ----------
  const picCache = new Map();    // key -> canvas (PIC_W × PIC_H)
  const thumbCache = new Map();  // key -> data URL
  function builtinCanvas(key) {
    if (!picCache.has(key)) { const cv = document.createElement('canvas'); cv.width = PIC_W; cv.height = PIC_H; PICS.paint(key, cv); picCache.set(key, cv); }
    return picCache.get(key);
  }
  function thumbOf(key) {
    if (key === 'custom') return custom ? custom.thumb : '';
    if (!thumbCache.has(key)) { const cv = document.createElement('canvas'); cv.width = 240; cv.height = 180; PICS.paint(key, cv); thumbCache.set(key, cv.toDataURL('image/jpeg', 0.85)); }
    return thumbCache.get(key);
  }
  const picName = (key) => (key === 'custom' ? 'Your photo' : ((PICS.list.find((p) => p.key === key) || {}).name || 'Picture'));
  function imageFromUrl(url) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Couldn’t open that picture.')); img.src = url; });
  }
  function toPicCanvas(img) {
    const cv = document.createElement('canvas'); cv.width = PIC_W; cv.height = PIC_H;
    const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high';
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const sc = Math.max(PIC_W / iw, PIC_H / ih), w = iw * sc, h = ih * sc;
    x.drawImage(img, (PIC_W - w) / 2, (PIC_H - h) / 2, w, h);
    return cv;
  }
  function setCustom(dataUrl, img, save) {
    const canvas = toPicCanvas(img);
    const t = document.createElement('canvas'); t.width = 240; t.height = 180; t.getContext('2d').drawImage(canvas, 0, 0, 240, 180);
    custom = { dataUrl, canvas, thumb: t.toDataURL('image/jpeg', 0.85), upload: null };
    if (save) { try { localStorage.setItem(PHOTO_KEY, dataUrl); } catch (e) { /* too big to keep: fine */ } }
    refreshPickers();
  }
  // Loads the picture a round needs: { kind: 'builtin', key } or { kind: 'upload', id, url }.
  async function loadPicture(image) {
    if (!image || image.kind !== 'upload') {
      const key = image && PICS.list.some((p) => p.key === image.key) ? image.key : PICS.list[0].key;
      return { canvas: builtinCanvas(key), key, name: picName(key) };
    }
    const ck = 'upload:' + image.id;
    if (custom && custom.upload && custom.upload.id === image.id) picCache.set(ck, custom.canvas);
    if (!picCache.has(ck)) {
      const u = window.getChowaniecUser ? window.getChowaniecUser() : null;
      const res = await fetch(image.url, { credentials: 'same-origin', headers: { 'X-Chowaniec-Key': (u && u.key) || '' } });
      if (!res.ok) throw new Error('Couldn’t load the picture.');
      const blobUrl = URL.createObjectURL(await res.blob());
      try { picCache.set(ck, toPicCanvas(await imageFromUrl(blobUrl))); } finally { URL.revokeObjectURL(blobUrl); }
    }
    return { canvas: picCache.get(ck), key: ck, name: 'Photo' };
  }

  // ---------- elements & view ----------
  let root, cv, ctx, hudEl, statsEl, barsEl, toolsEl, menuEl, loadEl, thumbEl;
  let Wc = 0, Hc = 0, dpr = 1;
  let screen = 'menu';        // menu | loading | play | done
  let game = null;            // the running puzzle (jigsaw or slide)
  let M = null;               // multiplayer round info { seed, shared, players }
  let loadToken = 0;
  const view = { s: 1, ox: 0, oy: 0, fit: 1, fox: 0, foy: 0 };
  let colors = {};
  const hitCtx = document.createElement('canvas').getContext('2d');

  function readColors() {
    const cs = getComputedStyle(root);
    const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    colors = { board: v('--pz-board', 'rgba(0,0,0,.08)'), boardEdge: v('--pz-board-edge', 'rgba(0,0,0,.12)'), ink: v('--cg-ink', '#18181b') };
  }

  const topInset = () => {
    let t = 58;
    if (M) { const n = (G.session() ? G.session().players.length : 2); t = Math.max(t, 64 + Math.min(7, n - 1) * 29, 26 + n * 27); }
    return t;
  };
  const bottomInset = () => 80 + safeBottom();
  let sbCache = null;
  function safeBottom() {
    if (sbCache == null) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);visibility:hidden'; document.body.appendChild(d); sbCache = d.getBoundingClientRect().height || 0; d.remove(); }
    return sbCache;
  }

  // ---------- jigsaw: shapes ----------
  function makeJigsaw(n, seed, pic) {
    const [cols, rows] = JIGSAW[n];
    const rand = G.rng(seed);
    const pw = BW / cols, ph = BH / rows, S = Math.min(pw, ph), pad = 0.42 * S;
    const J = 0.045;
    const u = () => (rand() * 2 - 1) * J;
    // One line of edges with tangents that flow smoothly from one segment to the next (after Draradech's generator).
    function lineParams(count) {
      const out = [];
      let flip = rand() < 0.5, e = u();
      for (let k = 0; k < count; k++) {
        const old = flip; flip = rand() < 0.5;
        const a = flip === old ? -e : e;
        const seg = { flip, a, b: u(), c: u(), d: u(), t: 0.094 + rand() * 0.018 };
        e = u(); seg.e = e;
        out.push(seg);
      }
      return out;
    }
    function segPoints(p, ox, oy, along, sl, horizontal) {
      const sg = p.flip ? -1 : 1, t = p.t;
      const L = (v, tab) => (tab ? sl / 2 + (v - 0.5) * S : v * sl);
      const raw = [[0, 0, 0], [0.2, p.a, 0], [0.5 + p.b + p.d, -t + p.c, 1], [0.5 - t + p.b, t + p.c, 1], [0.5 - 2 * t + p.b - p.d, 3 * t + p.c, 1],
        [0.5 + 2 * t + p.b - p.d, 3 * t + p.c, 1], [0.5 + t + p.b, t + p.c, 1], [0.5 + p.b + p.d, -t + p.c, 1], [0.8, p.e, 0], [1, 0, 0]];
      return raw.map(([v, w, tab]) => { const l = L(v, tab), ww = w * S * sg; return horizontal ? [ox + l, oy + ww] : [ox + ww, oy + l]; });
    }
    const Hl = [], Vl = [];
    for (let r = 1; r < rows; r++) Hl[r] = lineParams(cols).map((p, c) => segPoints(p, c * pw, r * ph, 0, pw, true));
    for (let c = 1; c < cols; c++) Vl[c] = lineParams(rows).map((p, r) => segPoints(p, c * pw, r * ph, 0, ph, false));
    const pieces = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x0 = c * pw, y0 = r * ph, x1 = x0 + pw, y1 = y0 + ph;
      const path = new Path2D();
      path.moveTo(x0, y0);
      const fwd = (P) => { path.bezierCurveTo(P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1]); path.bezierCurveTo(P[4][0], P[4][1], P[5][0], P[5][1], P[6][0], P[6][1]); path.bezierCurveTo(P[7][0], P[7][1], P[8][0], P[8][1], P[9][0], P[9][1]); };
      const back = (P) => fwd(P.slice().reverse());
      if (r === 0) path.lineTo(x1, y0); else fwd(Hl[r][c]);
      if (c === cols - 1) path.lineTo(x1, y1); else fwd(Vl[c + 1][r]);
      if (r === rows - 1) path.lineTo(x0, y1); else back(Hl[r + 1][c]);
      if (c === 0) path.lineTo(x0, y0); else back(Vl[c][r]);
      path.closePath();
      const i = pieces.length;
      pieces.push({ i, c, r, hx: x0, hy: y0, x: x0, y: y0, g: i, path, edge: r === 0 || c === 0 || r === rows - 1 || c === cols - 1, sprite: null, shadow: null, ax: 0, ay: 0 });
    }
    // scatter order and jitter: same for everyone (positions depend on each screen's tray)
    const order = pieces.map((p) => p.i);
    for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    const jitter = pieces.map(() => [rand() * 2 - 1, rand() * 2 - 1]);
    const sig = hashStr(JSON.stringify([Hl.map((l) => l && l.map((P) => P[3].map((v) => Math.round(v)))), order]));
    const groups = {};
    pieces.forEach((p) => { groups[p.i] = { ids: [p.i], locked: false, pop: 0 }; });
    return { kind: 'jigsaw', n, cols, rows, pw, ph, S, pad, pieces, groups, z: order.slice(), scatterOrder: order, jitter, pic, seed, sig,
      locked: 0, start: 0, paused: 0, pausedAt: 0, done: false, drag: null, spriteK: 0, finishAt: 0, sparkT: 0 };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

  // Draws part of the picture into world rect (x, y, w, h), clipping the source to the picture (Safari-safe).
  function drawPicRegion(x2, pic, x, y, w, h) {
    const sx = pic.width / BW, sy = pic.height / BH;
    const ax = Math.max(0, x), ay = Math.max(0, y), bx = Math.min(BW, x + w), by = Math.min(BH, y + h);
    if (bx <= ax || by <= ay) return;
    x2.drawImage(pic, ax * sx, ay * sy, (bx - ax) * sx, (by - ay) * sy, ax, ay, bx - ax, by - ay);
  }

  function renderSprites(J, k) {
    const fw = J.pw + 2 * J.pad, fh = J.ph + 2 * J.pad, S = J.S;
    const cw = Math.ceil(fw * k), ch = Math.ceil(fh * k);
    J.pieces.forEach((p) => {
      const sp = p.sprite && p.sprite.width === cw && p.sprite.height === ch ? p.sprite : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
      const x = sp.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cw, ch);
      x.setTransform(k, 0, 0, k, -(p.hx - J.pad) * k, -(p.hy - J.pad) * k);
      x.save(); x.clip(p.path);
      x.imageSmoothingQuality = 'high';
      drawPicRegion(x, J.pic, p.hx - J.pad, p.hy - J.pad, fw, fh);
      x.lineJoin = 'round';
      // bevel: light from the top left, shade on the bottom right
      [[0.03, 0.07, 'rgba(255,255,255,.26)'], [0.012, 0.03, 'rgba(255,255,255,.42)']].forEach(([d, w, col]) => { x.save(); x.translate(d * S, d * S); x.strokeStyle = col; x.lineWidth = w * S; x.stroke(p.path); x.restore(); });
      [[0.03, 0.07, 'rgba(0,0,0,.20)'], [0.012, 0.03, 'rgba(0,0,0,.30)']].forEach(([d, w, col]) => { x.save(); x.translate(-d * S, -d * S); x.strokeStyle = col; x.lineWidth = w * S; x.stroke(p.path); x.restore(); });
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1.6 / k; x.stroke(p.path);
      x.restore();
      p.sprite = sp;
      const sh = p.shadow && p.shadow.width === cw && p.shadow.height === ch ? p.shadow : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
      const y = sh.getContext('2d');
      y.setTransform(1, 0, 0, 1, 0, 0); y.clearRect(0, 0, cw, ch);
      y.shadowColor = 'rgba(0,0,0,1)'; y.shadowBlur = Math.max(2, S * 0.07 * k); y.shadowOffsetX = 20000; y.shadowOffsetY = 0;
      y.setTransform(k, 0, 0, k, -(p.hx - J.pad) * k - 20000, -(p.hy - J.pad) * k);
      y.fillStyle = '#000'; y.fill(p.path);
      p.shadow = sh;
    });
    J.spriteK = k;
  }

  // ---------- jigsaw: layout & scatter ----------
  function playArea() {
    const top = topInset(), bot = bottomInset();
    return { x0: (8 - view.fox) / view.fit, y0: (top - view.foy) / view.fit, x1: (Wc - 8 - view.fox) / view.fit, y1: (Hc - bot - view.foy) / view.fit };
  }
  function layoutJigsaw(J) {
    const top = topInset(), bot = bottomInset(), side = 10, gap = 12;
    const aw = Wc - side * 2, ah = Hc - top - bot;
    const slotW = J.pw + 0.3 * J.S, slotH = J.ph + 0.3 * J.S;
    const need = J.n <= 24 ? J.n : Math.ceil(J.n * 0.85);
    let best = null;
    for (const place of ['top', 'center', 'left']) {
      let s = Math.min(aw / BW, ah / BH);
      for (let it = 0; it < 80; it++, s *= 0.97) {
        const bw = BW * s, bh = BH * s;
        const bx = place === 'left' ? side : side + (aw - bw) / 2;
        const by = place === 'top' ? top : top + (ah - bh) / 2;
        const regs = trayRegions(bx, by, bw, bh, side, top, aw, ah, gap);
        let slots = 0;
        regs.forEach((r) => { slots += Math.floor(r.w / (slotW * s)) * Math.floor(r.h / (slotH * s)); });
        if (slots >= need) { if (!best || s > best.s * 1.01) best = { s, bx, by, place }; break; }
      }
    }
    if (!best) { const s = Math.min(aw / BW, ah / BH) * 0.45; best = { s, bx: side + (aw - BW * s) / 2, by: top, place: 'top' }; }
    view.fit = best.s; view.fox = best.bx; view.foy = best.by;
    view.s = view.fit; view.ox = view.fox; view.oy = view.foy;
    J.layout = best;
  }
  function trayRegions(bx, by, bw, bh, side, top, aw, ah, gap) {
    const regs = [];
    const L = bx - side - gap, R = side + aw - (bx + bw) - gap, T = by - top - gap, B = top + ah - (by + bh) - gap;
    if (B > 0) regs.push({ x: side, y: by + bh + gap, w: aw, h: B });
    if (L > 0) regs.push({ x: side, y: top, w: L, h: B > 0 ? by + bh - top : ah });
    if (R > 0) regs.push({ x: bx + bw + gap, y: top, w: R, h: B > 0 ? by + bh - top : ah });
    if (T > 0) regs.push({ x: Math.max(side, bx), y: top, w: Math.min(bw, aw), h: T });
    return regs;
  }
  // Puts the given pieces into tray slots (in this order). jit: use the seeded jitter.
  function scatter(J, ids, jit) {
    const s = view.fit, b = J.layout;
    const regs = trayRegions(b.bx, b.by, BW * s, BH * s, 10, topInset(), Wc - 20, Hc - topInset() - bottomInset(), 12);
    const slotW = J.pw + 0.3 * J.S, slotH = J.ph + 0.3 * J.S;
    const slots = [];
    regs.forEach((r) => {
      const nx = Math.floor(r.w / (slotW * s)), ny = Math.floor(r.h / (slotH * s));
      if (!nx || !ny) return;
      const gx = (r.w / s - nx * slotW) / nx, gy = (r.h / s - ny * slotH) / ny;
      for (let yy = 0; yy < ny; yy++) for (let xx = 0; xx < nx; xx++) slots.push([(r.x - view.fox) / s + xx * (slotW + gx) + gx / 2 + slotW / 2, (r.y - view.foy) / s + yy * (slotH + gy) + gy / 2 + slotH / 2, gx, gy]);
    });
    if (!slots.length) slots.push([BW / 2, BH + J.ph, 0, 0]);
    const n = ids.length;
    ids.forEach((id, k) => {
      const p = J.pieces[id];
      let slot, extra = [0, 0];
      if (slots.length >= n) slot = slots[jit ? Math.floor((k * slots.length) / n) : k];
      else { slot = slots[k % slots.length]; const layer = Math.floor(k / slots.length); extra = [layer * 0.28 * J.pw, layer * 0.22 * J.ph]; }
      const [jx, jy] = jit ? J.jitter[id] : [0, 0];
      const room = jit ? 0.1 * J.S : 0;
      const tx = slot[0] - J.pw / 2 + extra[0] + jx * (room + slot[2] * 0.4), ty = slot[1] - J.ph / 2 + extra[1] + jy * (room + slot[3] * 0.4);
      p.ax += p.x - tx; p.ay += p.y - ty;
      p.x = tx; p.y = ty;
    });
    J.pieces.forEach((p) => clampGroup(J, p.g));
  }
  function clampGroup(J, gid) {
    const g = J.groups[gid];
    if (!g || g.locked) return;
    const A = playArea();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    g.ids.forEach((id) => { const p = J.pieces[id]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + J.pw); y1 = Math.max(y1, p.y + J.ph); });
    const mx = J.pw * 0.45, my = J.ph * 0.45;
    let dx = 0, dy = 0;
    if (x1 < A.x0 + mx) dx = A.x0 + mx - x1; else if (x0 > A.x1 - mx) dx = A.x1 - mx - x0;
    if (y1 < A.y0 + my) dy = A.y0 + my - y1; else if (y0 > A.y1 - my) dy = A.y1 - my - y0;
    if (dx || dy) g.ids.forEach((id) => { J.pieces[id].x += dx; J.pieces[id].y += dy; });
  }

  // ---------- jigsaw: play ----------
  const looseIds = (J) => J.pieces.filter((p) => !J.groups[p.g].locked).map((p) => p.i);
  const isHidden = (J, p) => pref.edges && !p.edge && !J.groups[p.g].locked && J.groups[p.g].ids.length === 1;
  function placedCount(J) { return J.pieces.filter((p) => J.groups[p.g].locked || J.groups[p.g].ids.length > 1).length; }

  function pieceAt(J, wx, wy, loose) {
    for (let k = J.z.length - 1; k >= 0; k--) {
      const p = J.pieces[J.z[k]];
      if (J.groups[p.g].locked || isHidden(J, p)) continue;
      const lx = wx - (p.x - p.hx), ly = wy - (p.y - p.hy);
      if (lx < p.hx - J.pad || lx > p.hx + J.pw + J.pad || ly < p.hy - J.pad || ly > p.hy + J.ph + J.pad) continue;
      if (hitCtx.isPointInPath(p.path, lx, ly)) return p;
    }
    if (loose) {
      // fingers are big: accept a touch close to a piece
      let best = null, bd = Infinity;
      for (let k = J.z.length - 1; k >= 0; k--) {
        const p = J.pieces[J.z[k]];
        if (J.groups[p.g].locked || isHidden(J, p)) continue;
        const d = Math.hypot(wx - (p.x + J.pw / 2), wy - (p.y + J.ph / 2));
        if (d < Math.max(J.pw, J.ph) * 0.62 && d < bd) { bd = d; best = p; }
      }
      return best;
    }
    return null;
  }
  function raiseGroup(J, gid) {
    const ids = J.groups[gid].ids;
    J.z = J.z.filter((id) => J.pieces[id].g !== gid).concat(J.z.filter((id) => J.pieces[id].g === gid));
    void ids;
  }
  function shiftGroup(J, gid, dx, dy, anim) {
    J.groups[gid].ids.forEach((id) => { const p = J.pieces[id]; p.x += dx; p.y += dy; if (anim) { p.ax -= dx; p.ay -= dy; } });
  }
  function merge(J, keep, other) {
    const a = J.groups[keep], b = J.groups[other];
    b.ids.forEach((id) => { J.pieces[id].g = keep; });
    a.ids = a.ids.concat(b.ids);
    a.locked = a.locked || b.locked;
    delete J.groups[other];
    raiseGroup(J, keep);
  }
  function lockGroup(J, gid) {
    const g = J.groups[gid];
    g.locked = true;
    g.ids.forEach((id) => { const p = J.pieces[id]; p.ax += p.x - p.hx; p.ay += p.y - p.hy; p.x = p.hx; p.y = p.hy; });
    J.z = J.z.filter((id) => J.pieces[id].g !== gid);
    J.lockedOrder = (J.lockedOrder || []).concat(g.ids);
    J.locked = J.lockedOrder.length;
  }
  function neighbours(J, p) {
    const out = [];
    if (p.c > 0) out.push(J.pieces[p.i - 1]);
    if (p.c < J.cols - 1) out.push(J.pieces[p.i + 1]);
    if (p.r > 0) out.push(J.pieces[p.i - J.cols]);
    if (p.r < J.rows - 1) out.push(J.pieces[p.i + J.cols]);
    return out;
  }
  function dropGroup(J, gid) {
    const tol = Math.max(0.24 * J.S, 15 / view.s);
    const boardSnap = () => {
      for (const id of J.groups[gid].ids) {
        const p = J.pieces[id];
        if (Math.hypot(p.x - p.hx, p.y - p.hy) < tol) { lockGroup(J, gid); return true; }
      }
      return false;
    };
    if (boardSnap()) return 'board';
    let joined = false;
    for (let pass = 0; pass < 8; pass++) {
      let found = null;
      for (const id of J.groups[gid].ids) {
        const p = J.pieces[id];
        for (const q of neighbours(J, p)) {
          if (q.g === gid || isHidden(J, q)) continue;
          const ex = q.x - (q.hx - p.hx), ey = q.y - (q.hy - p.hy);
          if (Math.hypot(ex - p.x, ey - p.y) < tol) { found = { q, dx: ex - p.x, dy: ey - p.y }; break; }
        }
        if (found) break;
      }
      if (!found) break;
      shiftGroup(J, gid, found.dx, found.dy, true);
      const other = found.q.g;
      const wasLocked = J.groups[other].locked;
      if (wasLocked) {
        // joining a placed piece places the whole group
        J.groups[gid].ids.forEach((id) => { const p = J.pieces[id]; p.x = p.hx; p.y = p.hy; });
        lockGroup(J, gid);
        merge(J, other, gid);
        J.z = J.z.filter((id) => !J.groups[other].ids.includes(id));
        return 'board';
      }
      merge(J, gid, other);
      joined = true;
      if (boardSnap()) return 'board';
    }
    clampGroup(J, gid);
    return joined ? 'join' : null;
  }

  // ---------- slide puzzle ----------
  function makeSlide(N, seed, pic) {
    const rand = G.rng(seed);
    const T = N * N, E = T - 1;
    const tiles = []; for (let i = 0; i < T; i++) tiles.push(i);
    let e = E, prev = -1;
    const steps = N * N * N * 6;
    const nb = (pos) => { const c = pos % N, r = Math.floor(pos / N), out = []; if (c > 0) out.push(pos - 1); if (c < N - 1) out.push(pos + 1); if (r > 0) out.push(pos - N); if (r < N - 1) out.push(pos + N); return out; };
    const correct = () => tiles.reduce((a, t, i) => a + (t === i && t !== E ? 1 : 0), 0);
    for (let k = 0; k < steps || correct() > Math.ceil((T - 1) * 0.25) || tiles.every((t, i) => t === i); k++) {
      const opts = nb(e).filter((p) => p !== prev);
      const to = opts[Math.floor(rand() * opts.length)];
      [tiles[e], tiles[to]] = [tiles[to], tiles[e]];
      prev = e; e = to;
      if (k > steps * 4) break;
    }
    const disp = []; tiles.forEach((t, pos) => { disp[t] = { x: pos % N, y: Math.floor(pos / N) }; });
    return { kind: 'slide', N, tiles, empty: e, E, moves: 0, pic, seed, disp, start: 0, paused: 0, pausedAt: 0, done: false, finishAt: 0, sprites: null, spriteKey: '', down: null, sig: hashStr(tiles.join(',')) };
  }
  function layoutSlide() {
    const top = topInset(), bot = bottomInset(), side = 12;
    const aw = Wc - side * 2, ah = Hc - top - bot - 8;
    const portrait = Hc > Wc * 1.15;
    const s = Math.min(aw / BW, (portrait ? ah - 120 : ah) / BH);
    const bw = BW * s, bh = BH * s;
    view.fit = view.s = s; view.fox = view.ox = side + (aw - bw) / 2;
    view.foy = view.oy = portrait ? top + Math.max(0, (ah - bh - 120) * 0.35) : top + (ah - bh) / 2;
    // where the little preview picture goes: under the board, beside it, or in the corner
    const tw = 132, th = 99;
    let tx = 12, ty = Hc - bot - th - 6;
    if (portrait && Hc - bot - (view.oy + bh) >= th + 16) { tx = view.ox; ty = view.oy + bh + 14; }
    else if (view.ox - 24 >= tw) { tx = Math.max(12, view.ox - tw - 20); ty = view.oy; }
    thumbEl.style.left = tx + 'px'; thumbEl.style.top = ty + 'px'; thumbEl.style.bottom = 'auto';
  }
  function renderTiles(S2) {
    const N = S2.N, tw = (BW * view.s) / N, th = (BH * view.s) / N, gap = Math.max(2, tw * 0.025);
    const key = `${tw.toFixed(1)}:${dpr}`;
    if (S2.spriteKey === key) return;
    S2.spriteKey = key;
    const w = Math.max(1, Math.round((tw - gap) * dpr)), h = Math.max(1, Math.round((th - gap) * dpr));
    S2.sprites = [];
    for (let t = 0; t < N * N; t++) {
      const cv2 = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const x = cv2.getContext('2d');
      const rad = Math.min(w, h) * 0.07;
      const rp = () => { x.beginPath(); x.moveTo(rad, 0); x.arcTo(w, 0, w, h, rad); x.arcTo(w, h, 0, h, rad); x.arcTo(0, h, 0, 0, rad); x.arcTo(0, 0, w, 0, rad); x.closePath(); };
      x.save(); rp(); x.clip();
      const c = t % N, r = Math.floor(t / N);
      const sx = S2.pic.width / N, sy = S2.pic.height / N;
      const gx = (gap / 2 / tw) * sx, gy = (gap / 2 / th) * sy;
      x.imageSmoothingQuality = 'high';
      x.drawImage(S2.pic, c * sx + gx, r * sy + gy, sx - gx * 2, sy - gy * 2, 0, 0, w, h);
      const lw = Math.max(2, Math.min(w, h) * 0.05);
      x.lineWidth = lw; x.strokeStyle = 'rgba(255,255,255,.35)'; x.save(); x.translate(lw * 0.5, lw * 0.5); rp(); x.stroke(); x.restore();
      x.strokeStyle = 'rgba(0,0,0,.28)'; x.save(); x.translate(-lw * 0.5, -lw * 0.5); rp(); x.stroke(); x.restore();
      x.restore();
      S2.sprites[t] = cv2;
    }
  }
  function slideLine(S2, pos) {
    const N = S2.N, ec = S2.empty % N, er = Math.floor(S2.empty / N), tc = pos % N, tr = Math.floor(pos / N);
    if (pos === S2.empty || (tc !== ec && tr !== er)) return 0;
    const step = tc === ec ? (tr > er ? N : -N) : (tc > ec ? 1 : -1);
    let moved = 0;
    while (S2.empty !== pos) { const next = S2.empty + step; S2.tiles[S2.empty] = S2.tiles[next]; S2.tiles[next] = S2.E; S2.empty = next; moved++; }
    return moved;
  }
  function slideMove(S2, pos) {
    if (S2.done || screen !== 'play') return;
    const n = slideLine(S2, pos);
    if (!n) { G.sfx('wrong'); return; }
    if (!S2.start) S2.start = now();
    S2.moves += n;
    G.sfx(n > 1 ? 'whoosh' : 'click');
    progressChanged();
    if (S2.tiles.every((t, i) => t === i)) finish();
    kick();
  }
  function slideDir(S2, dx, dy) {
    // the tile next to the gap, on the side the swipe comes from, slides in
    const N = S2.N, ec = S2.empty % N, er = Math.floor(S2.empty / N);
    const c = ec - dx, r = er - dy;
    if (c < 0 || c >= N || r < 0 || r >= N) { G.sfx('wrong'); return; }
    slideMove(S2, r * N + c);
  }
  const slideCorrect = (S2) => S2.tiles.reduce((a, t, i) => a + (t === i && t !== S2.E ? 1 : 0), 0);

  // ---------- timer, progress, scoring ----------
  const elapsed = (g) => (!g || !g.start ? 0 : ((g.finishAt || (g.pausedAt || now())) - g.start - g.paused) / 1000);
  function score(g) {
    const t = elapsed(g);
    if (g.kind === 'jigsaw') return Math.round(g.n * 100 * Math.max(0.3, 1 - t / (g.n * 10)));
    const N = g.N, k = 4 * N * N * N;
    return Math.round(N * N * 100 * Math.max(0.3, 1 - (0.6 * t) / k - (0.4 * g.moves) / k));
  }
  const fmtTime = (s) => { s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function progress(g) {
    if (!g) return { placed: 0, total: 0 };
    if (g.kind === 'jigsaw') return { placed: placedCount(g), total: g.n };
    return { placed: slideCorrect(g), total: g.N * g.N - 1 };
  }
  function progressChanged() {
    renderStats();
    if (M && game && !game.done) { const p = progress(game); G.race.update({ score: p.placed, alive: true, placed: p.placed, total: p.total }); }
  }

  function renderStats() {
    if (!game) { statsEl.innerHTML = ''; return; }
    const p = progress(game);
    const t = `<span class="pz-chip">${ic('clock', 16)}<b>${fmtTime(elapsed(game))}</b></span>`;
    statsEl.innerHTML = game.kind === 'jigsaw'
      ? `${t}<span class="pz-chip">${ic('puzzle', 16)}<b>${p.placed}</b><small>/ ${p.total}</small></span>`
      : `${t}<span class="pz-chip">${ic('footprints', 16)}<b>${game.moves}</b><small>moves</small></span>`;
  }
  function renderBars() {
    if (!M || !game) { barsEl.innerHTML = ''; barsEl.hidden = true; return; }
    const others = G.race.others();
    barsEl.hidden = !others.length;
    barsEl.innerHTML = others.slice(0, 7).map((o) => {
      const st = o.state || {}, total = Number(st.total) || progress(game).total || 1, done = !!st.done;
      const placed = done ? total : clamp(Number(st.placed) || 0, 0, total);
      return `<div class="pz-bar${done ? ' done' : ''}"><i style="background:${o.color}"></i><b>${esc(o.name)}</b><span class="tr"><span style="width:${(placed / total) * 100}%;background:${o.color}"></span></span><em>${done ? ic('check', 13) : `${placed}/${total}`}</em></div>`;
    }).join('');
  }
  function renderTools() {
    if (!game) { toolsEl.innerHTML = ''; return; }
    const b = (a, icon, label, on) => `<button type="button" class="pz-tool${on ? ' on' : ''}" data-a="${a}" aria-pressed="${on ? 'true' : 'false'}">${ic(icon, 20)}<span>${label}</span></button>`;
    const menu = `<button type="button" class="pz-tool" data-a="menu">${ic(M ? 'users' : 'home', 20)}<span>${M ? 'Lobby' : 'Menu'}</span></button>`;
    toolsEl.innerHTML = game.kind === 'jigsaw'
      ? menu + b('ghost', 'eye', 'Picture', pref.ghost) + b('edges', 'grid', 'Edges', pref.edges) + b('tidy', 'layers', 'Tidy') + (view.s > view.fit * 1.02 ? b('fit', 'maximize', 'Fit') : '')
      : menu + b('ghost', 'eye', 'Picture', pref.ghost) + b('numbers', 'hash', 'Numbers', pref.numbers) + (M ? '' : b('reshuffle', 'shuffle', 'Shuffle'));
    thumbEl.hidden = !(game.kind === 'slide' && pref.ghost);
  }

  // ---------- drawing ----------
  let raf = 0, lastFrame = 0, parts = [];
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - (lastFrame || t)) / 1000); lastFrame = t;
    let busy = false;
    if (game) busy = draw(dt) || busy;
    else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
    busy = drawParts(dt) || busy;
    if (busy) kick(); else lastFrame = 0;
  }
  const worldToScreen = (x, y) => [x * view.s + view.ox, y * view.s + view.oy];
  const screenToWorld = (x, y) => [(x - view.ox) / view.s, (y - view.oy) / view.s];

  function draw(dt) {
    const g = game;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.ox, dpr * view.oy);
    return g.kind === 'jigsaw' ? drawJigsaw(g, dt) : drawSlide(g, dt);
  }
  function boardBack(r) {
    ctx.save();
    ctx.fillStyle = colors.board;
    roundRect(ctx, -r, -r, BW + 2 * r, BH + 2 * r, r * 1.6); ctx.fill();
    ctx.strokeStyle = colors.boardEdge; ctx.lineWidth = 2 / view.s; ctx.stroke();
    ctx.restore();
  }
  function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }

  function drawJigsaw(J, dt) {
    let busy = false;
    const want = Math.min(1.6, view.s * dpr);
    if (!J.spriteK || (Math.abs(want - J.spriteK) / J.spriteK > 0.08 && !pinch && now() - lastZoom > 160)) renderSprites(J, want);
    else if (Math.abs(want - J.spriteK) / J.spriteK > 0.08) busy = true;
    const fw = J.pw + 2 * J.pad, fh = J.ph + 2 * J.pad;
    boardBack(8 / view.s);
    if (pref.ghost && !J.done) { ctx.globalAlpha = 0.24; ctx.drawImage(J.pic, 0, 0, BW, BH); ctx.globalAlpha = 1; }
    const decay = Math.pow(0.001, dt / 0.18);
    const anim = (p) => { if (p.ax || p.ay) { p.ax *= decay; p.ay *= decay; if (Math.abs(p.ax) + Math.abs(p.ay) < 0.3) { p.ax = 0; p.ay = 0; } else busy = true; } };
    (J.lockedOrder || []).forEach((id) => { const p = J.pieces[id]; anim(p); ctx.drawImage(p.sprite, p.x + p.ax - J.pad, p.y + p.ay - J.pad, fw, fh); });
    const S = J.S, dragG = J.drag ? J.drag.g : -1;
    let lift = J.lift || 0;
    lift += ((dragG >= 0 ? 1 : 0) - lift) * Math.min(1, dt * 14);
    if (Math.abs(lift - (dragG >= 0 ? 1 : 0)) > 0.01) busy = true; else lift = dragG >= 0 ? 1 : 0;
    J.lift = lift;
    let gc = null;
    if (dragG >= 0) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      J.groups[dragG].ids.forEach((id) => { const p = J.pieces[id]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + J.pw); y1 = Math.max(y1, p.y + J.ph); });
      gc = [(x0 + x1) / 2, (y0 + y1) / 2];
    }
    for (const id of J.z) {
      const p = J.pieces[id];
      if (isHidden(J, p)) continue;
      anim(p);
      const g = J.groups[p.g];
      const lifted = p.g === dragG;
      if (g.pop > 0) { g.pop = Math.max(0, g.pop - dt * 4); busy = true; }
      const sc = 1 + (lifted ? 0.035 * lift : 0) + Math.sin(g.pop * Math.PI) * 0.03;
      const x = p.x + p.ax, y = p.y + p.ay;
      ctx.save();
      if (sc !== 1) { const cx = lifted ? gc[0] : x + J.pw / 2, cy = lifted ? gc[1] : y + J.ph / 2; ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy); }
      const l = lifted ? lift : 0;
      ctx.globalAlpha = 0.42 + 0.12 * l;
      ctx.drawImage(p.shadow, x - J.pad + S * (0.018 + 0.05 * l), y - J.pad + S * (0.03 + 0.09 * l), fw, fh);
      ctx.globalAlpha = 1;
      ctx.drawImage(p.sprite, x - J.pad, y - J.pad, fw, fh);
      ctx.restore();
    }
    if (J.done) {
      const k = clamp((now() - J.finishAt) / 700, 0, 1);
      ctx.globalAlpha = k; ctx.drawImage(J.pic, 0, 0, BW, BH); ctx.globalAlpha = 1;
      const sweep = clamp((now() - J.finishAt - 250) / 900, 0, 1);
      if (sweep > 0 && sweep < 1 && !reduceMotion) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, BW, BH); ctx.clip();
        const x = -400 + sweep * (BW + 800);
        const gr = ctx.createLinearGradient(x - 160, 0, x + 160, BH * 0.3);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, BW, BH); ctx.restore();
      }
      if (k < 1 || sweep < 1) busy = true;
    }
    return busy;
  }

  function drawSlide(S2, dt) {
    renderTiles(S2);
    let busy = false;
    const N = S2.N, tw = BW / N, th = BH / N, gapW = Math.max(2, (tw * view.s) * 0.025) / view.s;
    boardBack(8 / view.s);
    // the empty slot
    const ec = S2.empty % N, er = Math.floor(S2.empty / N);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; roundRect(ctx, ec * tw + gapW / 2, er * th + gapW / 2, tw - gapW, th - gapW, tw * 0.07); ctx.fill();
    const k = Math.min(1, dt * 18);
    S2.tiles.forEach((t, pos) => {
      if (t === S2.E) return;
      const d = S2.disp[t], txp = pos % N, typ = Math.floor(pos / N);
      d.x += (txp - d.x) * k; d.y += (typ - d.y) * k;
      if (Math.abs(txp - d.x) + Math.abs(typ - d.y) > 0.003) busy = true; else { d.x = txp; d.y = typ; }
      const x = d.x * tw + gapW / 2, y = d.y * th + gapW / 2;
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; roundRect(ctx, x + 2 / view.s, y + 4 / view.s, tw - gapW, th - gapW, tw * 0.07); ctx.fill(); ctx.globalAlpha = 1;
      ctx.drawImage(S2.sprites[t], x, y, tw - gapW, th - gapW);
      if (pref.numbers) {
        const r = Math.min(tw, th) * 0.13;
        ctx.fillStyle = t === pos ? 'rgba(34,197,94,.92)' : 'rgba(17,17,20,.72)';
        ctx.beginPath(); ctx.arc(x + r * 1.25, y + r * 1.25, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = `800 ${r * 1.15}px Outfit, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(t + 1), x + r * 1.25, y + r * 1.3);
      }
    });
    if (S2.done) {
      const a = clamp((now() - S2.finishAt) / 600, 0, 1);
      ctx.globalAlpha = a; ctx.drawImage(S2.pic, 0, 0, BW, BH); ctx.globalAlpha = 1;
      if (a < 1) busy = true;
    }
    return busy;
  }

  // particles live in screen space
  function burst(x, y, n, speed, cols) {
    if (reduceMotion) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random());
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, s: 4 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - 0.5) * 12, col: cols[k % cols.length], life: 0.7 + Math.random() * 0.6, star: Math.random() < 0.35 });
    }
    kick();
  }
  function confetti() {
    const cols = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899', '#14b8a6'];
    for (let k = 0; k < 4; k++) burst(Wc * (0.15 + 0.23 * k), Hc * 0.42, 46, Math.max(380, Wc * 0.5), cols);
  }
  function drawParts(dt) {
    if (!parts.length) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    parts = parts.filter((p) => (p.life -= dt) > 0);
    parts.forEach((p) => {
      p.vy += 700 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillStyle = p.col;
      if (p.star) { ctx.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? p.s * 0.4 : p.s; ctx.lineTo(Math.cos((i * Math.PI) / 4) * r, Math.sin((i * Math.PI) / 4) * r); } ctx.fill(); }
      else ctx.fillRect(-p.s / 2, -p.s * 0.3, p.s, p.s * 0.6);
      ctx.restore();
    });
    return parts.length > 0;
  }

  // ---------- input ----------
  const ptrs = new Map();
  let pinch = null, pan = null, lastZoom = 0;
  function localXY(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function blocked() { return screen !== 'play' || !game || game.done || G.modalOpen() || G.countingDown() || !!$('.pz-crop') || !!$('.pz-setup-ov'); }

  function onDown(e) {
    if (blocked()) return;
    const [x, y] = localXY(e);
    ptrs.set(e.pointerId, { x, y });
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const g = game;
    if (g.kind === 'slide') { if (ptrs.size === 1) g.down = { x, y, id: e.pointerId, t: now() }; return; }
    if (g.drag) return;   // a second finger while dragging: ignore
    if (ptrs.size === 2) {
      pan = null;
      const [a, b] = [...ptrs.values()];
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: view.s, w: screenToWorld(mid[0], mid[1]) };
      return;
    }
    const [wx, wy] = screenToWorld(x, y);
    const p = pieceAt(g, wx, wy, e.pointerType !== 'mouse');
    if (p) {
      if (!g.start) g.start = now();
      g.drag = { g: p.g, id: e.pointerId, lx: wx, ly: wy };
      raiseGroup(g, p.g);
      G.sfx('tick');
      kick();
    } else if (view.s > view.fit * 1.02) pan = { id: e.pointerId, x, y, ox: view.ox, oy: view.oy };
  }
  function onMove(e) {
    if (!ptrs.has(e.pointerId)) return;
    const [x, y] = localXY(e);
    ptrs.set(e.pointerId, { x, y });
    const g = game;
    if (!g || g.kind !== 'jigsaw') return;
    if (g.drag && g.drag.id === e.pointerId) {
      const [wx, wy] = screenToWorld(x, y);
      shiftGroup(g, g.drag.g, wx - g.drag.lx, wy - g.drag.ly);
      g.drag.lx = wx; g.drag.ly = wy;
      clampGroup(g, g.drag.g);
      kick();
    } else if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      setZoom(pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), pinch.w, mid);
    } else if (pan && pan.id === e.pointerId) {
      view.ox = pan.ox + (x - pan.x); view.oy = pan.oy + (y - pan.y); clampView(); kick();
    }
  }
  function onUp(e) {
    if (!ptrs.has(e.pointerId)) return;
    const [x, y] = localXY(e);
    ptrs.delete(e.pointerId);
    const g = game;
    if (!g) return;
    if (g.kind === 'slide') {
      const d = g.down; g.down = null;
      if (!d || d.id !== e.pointerId || e.type === 'pointercancel' || blocked()) return;
      const dx = x - d.x, dy = y - d.y, dist = Math.hypot(dx, dy);
      const [wx, wy] = screenToWorld(d.x, d.y);
      const N = g.N, c = Math.floor(wx / (BW / N)), r = Math.floor(wy / (BH / N));
      const inside = c >= 0 && c < N && r >= 0 && r < N;
      if (dist < 14) { if (inside) slideMove(g, r * N + c); return; }
      const hor = Math.abs(dx) > Math.abs(dy), sx = hor ? Math.sign(dx) : 0, sy = hor ? 0 : Math.sign(dy);
      if (inside) {
        const pos = r * N + c, ec = g.empty % N, er = Math.floor(g.empty / N);
        if ((hor && r === er && Math.sign(ec - c) === sx) || (!hor && c === ec && Math.sign(er - r) === sy)) { slideMove(g, pos); return; }
      }
      slideDir(g, sx, sy);
      return;
    }
    if (g.drag && g.drag.id === e.pointerId) {
      const gid = g.drag.g, pid = g.groups[gid].ids[0];
      g.drag = null;
      const res = dropGroup(g, gid);
      if (res) {
        const now_g = g.pieces[pid].g, gg = g.groups[now_g];
        if (gg) gg.pop = 1;
        const c = groupCenterScreen(g, now_g);
        if (res === 'board') { G.sfx('point'); burst(c[0], c[1], 14, 220, ['#facc15', '#ffffff', '#22c55e']); }
        else { G.sfx('click'); burst(c[0], c[1], 8, 150, ['#ffffff', '#38bdf8']); }
        progressChanged();
        if (g.locked === g.n) finish();
      }
      kick();
    }
    if (ptrs.size < 2) pinch = null;
    if (pan && pan.id === e.pointerId) pan = null;
  }
  function groupCenterScreen(J, gid) {
    const g = J.groups[gid];
    if (!g) return [Wc / 2, Hc / 2];
    let sx = 0, sy = 0;
    g.ids.forEach((id) => { const p = J.pieces[id]; sx += p.x + J.pw / 2; sy += p.y + J.ph / 2; });
    return worldToScreen(sx / g.ids.length, sy / g.ids.length);
  }
  function setZoom(s, w, at) {
    view.s = clamp(s, view.fit, view.fit * 4);
    view.ox = at[0] - w[0] * view.s; view.oy = at[1] - w[1] * view.s;
    clampView(); lastZoom = now(); kick();
    renderToolsSoon();
  }
  function clampView() {
    if (view.s <= view.fit * 1.0001) { view.s = view.fit; view.ox = view.fox; view.oy = view.foy; return; }
    const tx0 = -view.fox / view.fit, tx1 = (Wc - view.fox) / view.fit, ty0 = -view.foy / view.fit, ty1 = (Hc - view.foy) / view.fit;
    view.ox = clamp(view.ox, Wc - tx1 * view.s, -tx0 * view.s);
    view.oy = clamp(view.oy, Hc - ty1 * view.s, -ty0 * view.s);
  }
  let toolsTimer = 0;
  function renderToolsSoon() { clearTimeout(toolsTimer); toolsTimer = setTimeout(() => { renderTools(); kick(); }, 120); }
  function onWheel(e) {
    if (blocked() || !game || game.kind !== 'jigsaw') return;
    e.preventDefault();
    const [x, y] = localXY(e);
    setZoom(view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), screenToWorld(x, y), [x, y]);
  }
  function onKey(e) {
    if (blocked() || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (game.kind === 'slide') {
      const d = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      if (d) { e.preventDefault(); slideDir(game, d[0], d[1]); return; }
    }
    if (k === 'p') tool('ghost'); else if (k === 'e' && game.kind === 'jigsaw') tool('edges'); else if (k === 't' && game.kind === 'jigsaw') tool('tidy'); else if (k === 'n' && game.kind === 'slide') tool('numbers');
  }

  function tool(a) {
    if (!game) return;
    G.sfx('click');
    if (a === 'menu') { if (M) { G.openLobby(); } else showMenu(); return; }
    if (a === 'ghost') { pref.ghost = !pref.ghost; savePref(); }
    if (a === 'edges') { pref.edges = !pref.edges; savePref(); }
    if (a === 'numbers') { pref.numbers = !pref.numbers; savePref(); }
    if (a === 'tidy' && game.kind === 'jigsaw') {
      const singles = game.scatterOrder.filter((id) => { const p = game.pieces[id]; return !game.groups[p.g].locked && game.groups[p.g].ids.length === 1 && !isHidden(game, p); });
      if (pref.edges) singles.sort((a2, b2) => game.pieces[b2].edge - game.pieces[a2].edge);
      scatter(game, singles, false);
      G.sfx('whoosh');
    }
    if (a === 'fit') { view.s = view.fit; clampView(); }
    if (a === 'reshuffle' && game.kind === 'slide' && !M) { startGame({ mode: 'slide', size: game.N, pic: game.picInfo }, Math.floor(Math.random() * 2 ** 31)); return; }
    renderTools(); kick();
  }

  // ---------- game flow ----------
  function finish() {
    const g = game;
    if (g.done) return;
    g.done = true;
    g.finishAt = now();
    g.drag = null;
    const pts = score(g);
    renderStats();
    G.sfx('win');
    confetti();
    setTimeout(confetti, 450);
    kick();
    const p = progress(g);
    if (M) G.race.update({ score: p.total, alive: true, placed: p.total, total: p.total });
    const token = loadToken;
    setTimeout(() => {
      if (token !== loadToken || game !== g) return;
      screen = 'done';
      const again = () => { if (!M) startGame(g.cfg, Math.floor(Math.random() * 2 ** 31)); };
      G.gameOver({ score: pts, title: 'Puzzle complete!', again });
    }, M ? 1300 : 1900);
  }

  async function startGame(cfg, seed, info) {
    const token = ++loadToken;
    hideMenu();
    G.closeModal();
    screen = 'loading';
    game = null;
    renderStats(); renderTools(); renderBars();
    loadEl.hidden = false;
    kick();
    let pic;
    try {
      pic = cfg.pic.kind === 'local' ? { canvas: custom.canvas, key: 'custom', name: 'Your photo' } : await loadPicture(cfg.pic);
    } catch (err) {
      if (token !== loadToken) return;
      loadEl.hidden = true;
      G.toast(err.message || 'Couldn’t load the picture.');
      if (!M) showMenu();
      pic = { canvas: builtinCanvas(PICS.list[0].key), key: PICS.list[0].key };
    }
    if (token !== loadToken) return;
    loadEl.hidden = true;
    const g = cfg.mode === 'slide' ? makeSlide(cfg.size, seed, pic.canvas) : makeJigsaw(cfg.size, seed, pic.canvas);
    g.cfg = cfg; g.picInfo = cfg.pic; g.picKey = pic.key;
    game = g;
    screen = 'play';
    thumbEl.getContext('2d').drawImage(pic.canvas, 0, 0, thumbEl.width, thumbEl.height);
    layout(true);
    if (M || g.kind === 'slide') g.start = M ? now() : 0;
    renderStats(); renderTools(); renderBars();
    progressChanged();
    G.sfx('whoosh');
    if (g.kind === 'jigsaw' && !reduceMotion) {
      // pieces fly out from the board to their tray spots
      g.pieces.forEach((p) => { p.ax = (p.hx - p.x) * 0.9; p.ay = (p.hy - p.y) * 0.9; });
    }
    kick();
    void info;
  }

  function layout(fresh) {
    if (!root) return;
    const r = root.getBoundingClientRect();
    const oldW = Wc, oldH = Hc;
    Wc = Math.max(1, r.width); Hc = Math.max(1, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr);
    cv.style.width = Wc + 'px'; cv.style.height = Hc + 'px';
    readColors();
    const g = game;
    if (g && g.kind === 'jigsaw') {
      const wasPortrait = oldH > oldW;
      layoutJigsaw(g);
      if (fresh) scatter(g, g.scatterOrder, true);
      else if (wasPortrait !== (Hc > Wc) || Math.abs(oldW - Wc) > 40) {
        const singles = g.scatterOrder.filter((id) => { const p = g.pieces[id]; return !g.groups[p.g].locked && g.groups[p.g].ids.length === 1; });
        scatter(g, singles, true);
        Object.keys(g.groups).forEach((gid) => clampGroup(g, Number(gid)));
      } else Object.keys(g.groups).forEach((gid) => clampGroup(g, Number(gid)));
      g.spriteK = 0;
    } else if (g && g.kind === 'slide') { layoutSlide(); g.spriteKey = ''; }
    renderTools();
    kick();
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

  // ---------- menu & picker ----------
  function pickerHTML(sel) {
    const sizes = sel.mode === 'slide'
      ? Object.keys(SLIDE).map((n) => `<button type="button" class="pz-size${Number(n) === sel.slide ? ' sel' : ''}" data-size="${n}"><b>${n} × ${n}</b><small>${SLIDE[n]}</small></button>`).join('')
      : Object.keys(JIGSAW).map((n) => `<button type="button" class="pz-size${Number(n) === sel.pieces ? ' sel' : ''}" data-size="${n}"><b>${n}</b><small>${JIGSAW[n][2]}</small></button>`).join('');
    const pics = [`<button type="button" class="pz-pic add" data-pic="add" aria-label="Use your own picture"><span class="ph">${ic('camera', 28)}</span><span class="nm">${custom ? 'New photo' : 'Your photo'}</span></button>`];
    if (custom) pics.push(`<button type="button" class="pz-pic${sel.pic === 'custom' ? ' sel' : ''}" data-pic="custom"><img alt="" src="${custom.thumb}"><span class="nm">Your photo</span></button>`);
    PICS.list.forEach((p) => pics.push(`<button type="button" class="pz-pic${sel.pic === p.key ? ' sel' : ''}" data-pic="${p.key}"><img alt="" src="${thumbOf(p.key)}"><span class="nm">${esc(p.name)}</span></button>`));
    return `<div class="pz-seg" role="group" aria-label="Puzzle type"><button type="button" data-mode="jigsaw" class="${sel.mode === 'jigsaw' ? 'sel' : ''}">${ic('puzzle', 18)} Jigsaw</button><button type="button" data-mode="slide" class="${sel.mode === 'slide' ? 'sel' : ''}">${ic('grid', 18)} Sliding tiles</button></div>` +
      `<h3>${sel.mode === 'slide' ? 'Tiles' : 'Pieces'}</h3><div class="pz-sizes">${sizes}</div>` +
      `<h3>Picture</h3><div class="pz-pics">${pics.join('')}</div>`;
  }
  // Wires up a picker inside `box`; `sel` is updated in place and onChange re-renders.
  function bindPicker(box, sel, onChange) {
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !box.contains(b)) return;
      if (b.dataset.mode) { sel.mode = b.dataset.mode; G.sfx('click'); onChange(); }
      else if (b.dataset.size) { if (sel.mode === 'slide') sel.slide = Number(b.dataset.size); else sel.pieces = Number(b.dataset.size); G.sfx('click'); onChange(); }
      else if (b.dataset.pic === 'add') { G.sfx('click'); pickPhoto().then((ok) => { if (ok) { sel.pic = 'custom'; onChange(); } }); }
      else if (b.dataset.pic) { sel.pic = b.dataset.pic; G.sfx('click'); onChange(); }
    });
  }
  const pickers = new Set();
  function refreshPickers() { pickers.forEach((fn) => fn()); }

  function showMenu() {
    ffStyle();
    loadToken++;
    screen = 'menu';
    game = null;
    G.closeModal();
    renderStats(); renderTools(); renderBars();
    loadEl.hidden = true;
    menuEl.hidden = false;
    const card = $('.pz-menu-card', menuEl);
    const render = () => {
      card.innerHTML = `<div class="pz-head">${G.badge('puzzle', 48)}<div><h2>Picture Puzzle</h2><p>Put the picture back together!</p></div></div>` +
        ffButtons() + '<p class="pz-ffhint">You choose the picture, everyone races to finish it.</p>' +
        '<h3 class="pz-or"><span>Or play on my own</span></h3>' +
        `<div class="pz-picker">${pickerHTML(pref)}</div>` +
        `<div class="pz-actions"><button type="button" class="ff-btn ff-solo" data-a="play">${ic('play', 19)}<span>Play on my own</span></button></div>`;
      const sel = $('.pz-pic.sel', card); if (sel && sel.scrollIntoView && !render.done) { render.done = true; }
    };
    card.__render = render;
    render();
    pickers.add(render);
    kick();
  }
  function hideMenu() { menuEl.hidden = true; }

  function soloStart() {
    savePref();
    if (pref.pic === 'custom' && !custom) { G.toast('Pick a photo first.'); return; }
    const cfg = { mode: pref.mode, size: pref.mode === 'slide' ? pref.slide : pref.pieces, pic: pref.pic === 'custom' ? { kind: 'local' } : { kind: 'builtin', key: pref.pic } };
    startGame(cfg, Math.floor(Math.random() * 2 ** 31));
  }

  // The host's picker before a race: returns the round's shared setup, or null to cancel.
  function roundSetup() {
    return new Promise((resolve) => {
      const sel = { mode: pref.mode, pieces: pref.pieces, slide: pref.slide, pic: pref.pic === 'custom' && !custom ? PICS.list[0].key : pref.pic };
      let done = false;
      const finishWith = (v) => { if (done) return; done = true; pickers.delete(render); resolve(v); };
      // Our own layer above the core's cards: the core keeps redrawing its results card while a round is over.
      const ov = document.createElement('div');
      ov.className = 'pz-setup-ov';
      ov.innerHTML = `<div class="cg-card wide pz-setup" role="dialog" aria-modal="true" aria-label="Choose the puzzle"><div class="cg-hero plain">${G.badge('puzzle', 52)}</div><h2>Choose the puzzle</h2><p class="cg-sub">Everyone gets the same picture and pieces. Fastest wins!</p><div class="pz-picker in-modal"></div>` +
        `<div class="cg-row"><button type="button" data-a="cancel">Cancel</button><button type="button" class="primary" data-a="go">${ic('play', 18)} Start</button></div></div>`;
      document.body.appendChild(ov);
      const card = $('.pz-setup', ov);
      const box = $('.pz-picker', card);
      const render = () => { if (!card.isConnected) { finishWith(null); return; } box.innerHTML = pickerHTML(sel); };
      pickers.add(render);
      render();
      bindPicker(box, sel, render);
      card.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        if (b.dataset.a === 'cancel') { ov.remove(); G.closeModal(); finishWith(null); setTimeout(() => G.openLobby(), 0); return; }
        Object.assign(pref, { mode: sel.mode, pieces: sel.pieces, slide: sel.slide, pic: sel.pic }); savePref();
        let image = { kind: 'builtin', key: sel.pic };
        if (sel.pic === 'custom') {
          if (!custom) { G.toast('Pick a photo first.'); return; }
          if (!custom.upload) {
            b.disabled = true; b.innerHTML = `${ic('upload', 18)} Sharing photo…`;
            try { custom.upload = await G.uploadImage(custom.dataUrl); }
            catch (err) { G.toast(err.message || 'Couldn’t share the photo.'); b.disabled = false; b.innerHTML = `${ic('play', 18)} Start`; return; }
          }
          image = { kind: 'upload', id: custom.upload.id, url: custom.upload.url };
        }
        ov.remove();
        finishWith({ image, mode: sel.mode, pieces: sel.mode === 'slide' ? sel.slide : sel.pieces });
      });
    });
  }

  // ---------- your own photo: pick, frame, shrink ----------
  let fileInput = null;
  function pickPhoto() {
    return new Promise((resolve) => {
      if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.hidden = true;
        fileInput.setAttribute('aria-label', 'Choose a photo');
        document.body.appendChild(fileInput);
      }
      fileInput.value = '';
      fileInput.onchange = async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) { resolve(false); return; }
        const url = URL.createObjectURL(f);
        try {
          const img = await imageFromUrl(url);
          resolve(await cropPhoto(img));
        } catch (err) { G.toast('Couldn’t open that picture. Try a JPEG or PNG.'); resolve(false); }
        finally { URL.revokeObjectURL(url); }
      };
      fileInput.click();
    });
  }
  function cropPhoto(img) {
    return new Promise((resolve) => {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const ov = document.createElement('div');
      ov.className = 'pz-crop';
      ov.innerHTML = `<div class="pz-crop-card" role="dialog" aria-modal="true" aria-label="Frame your photo"><h2>Frame your photo</h2><p class="pz-hint">Drag to move it, pinch or slide to zoom.</p>` +
        `<div class="pz-crop-box"><canvas></canvas></div>` +
        `<label class="pz-zoom">${ic('minus', 16)}<input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">${ic('plus', 16)}</label>` +
        `<div class="pz-actions"><button type="button" class="pz-btn" data-a="cancel">Cancel</button><button type="button" class="pz-btn primary" data-a="ok">${ic('check', 20)} Use photo</button></div></div>`;
      document.body.appendChild(ov);
      const c2 = $('canvas', ov), box = $('.pz-crop-box', ov), range = $('input', ov);
      const st = { z: 1, cx: iw / 2, cy: ih / 2 };   // zoom and the image point at the frame centre
      let cw = 0, ch = 0, base = 1, k = 1;
      const fitIn = () => {
        cw = box.clientWidth; ch = cw * 0.75; k = Math.min(2, window.devicePixelRatio || 1);
        c2.width = Math.round(cw * k); c2.height = Math.round(ch * k); c2.style.height = ch + 'px';
        base = Math.max(cw / iw, ch / ih);
        paint();
      };
      const clampSt = () => {
        const sc = base * st.z, hw = cw / 2 / sc, hh = ch / 2 / sc;
        st.cx = clamp(st.cx, hw, iw - hw); st.cy = clamp(st.cy, hh, ih - hh);
      };
      const paint = () => {
        clampSt();
        const x = c2.getContext('2d'), sc = base * st.z;
        x.setTransform(k, 0, 0, k, 0, 0);
        x.fillStyle = '#000'; x.fillRect(0, 0, cw, ch);
        x.imageSmoothingQuality = 'high';
        x.drawImage(img, cw / 2 - st.cx * sc, ch / 2 - st.cy * sc, iw * sc, ih * sc);
        x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 1;
        for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo((cw * i) / 3, 0); x.lineTo((cw * i) / 3, ch); x.moveTo(0, (ch * i) / 3); x.lineTo(cw, (ch * i) / 3); x.stroke(); }
      };
      const ps = new Map(); let pz = null;
      c2.addEventListener('pointerdown', (e) => { c2.setPointerCapture(e.pointerId); ps.set(e.pointerId, [e.clientX, e.clientY]); if (ps.size === 2) { const [a, b] = [...ps.values()]; pz = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: st.z }; } });
      c2.addEventListener('pointermove', (e) => {
        if (!ps.has(e.pointerId)) return;
        const prev = ps.get(e.pointerId); ps.set(e.pointerId, [e.clientX, e.clientY]);
        if (ps.size >= 2 && pz) { const [a, b] = [...ps.values()]; st.z = clamp(pz.z * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pz.d), 1, 4); range.value = st.z; }
        else { const sc = base * st.z; st.cx -= (e.clientX - prev[0]) / sc; st.cy -= (e.clientY - prev[1]) / sc; }
        paint();
      });
      const up = (e) => { ps.delete(e.pointerId); if (ps.size < 2) pz = null; };
      c2.addEventListener('pointerup', up); c2.addEventListener('pointercancel', up);
      c2.addEventListener('wheel', (e) => { e.preventDefault(); st.z = clamp(st.z * Math.exp(-e.deltaY * 0.002), 1, 4); range.value = st.z; paint(); }, { passive: false });
      range.addEventListener('input', () => { st.z = Number(range.value); paint(); });
      const close = (v) => { window.removeEventListener('resize', fitIn); ov.remove(); resolve(v); };
      ov.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        if (b.dataset.a === 'cancel') { close(false); return; }
        const sc = base * st.z, sw = cw / sc, sh = ch / sc, sx = st.cx - sw / 2, sy = st.cy - sh / 2;
        const ow = Math.round(clamp(sw, 800, 1600)), oh = Math.round(ow * 0.75);
        const out = Object.assign(document.createElement('canvas'), { width: ow, height: oh });
        const ox = out.getContext('2d'); ox.imageSmoothingQuality = 'high';
        ox.drawImage(img, sx, sy, sw, sh, 0, 0, ow, oh);
        let q = 0.88, data = out.toDataURL('image/jpeg', q);
        while (data.length * 0.75 > 1.9 * 1024 * 1024 && q > 0.4) { q -= 0.12; data = out.toDataURL('image/jpeg', q); }
        imageFromUrl(data).then((im) => { setCustom(data, im, true); close(true); }).catch(() => close(false));
      });
      window.addEventListener('resize', fitIn);
      requestAnimationFrame(fitIn);
    });
  }

  // ---------- build ----------
  function build(c) {
    root = c.root;
    root.classList.add('pz-stage');
    root.innerHTML =
      '<canvas class="pz-canvas" aria-label="Puzzle board"></canvas>' +
      '<div class="pz-hud"><div class="pz-stats"></div><div class="pz-bars" hidden></div></div>' +
      '<canvas class="pz-thumb" width="240" height="180" hidden aria-hidden="true"></canvas>' +
      '<div class="pz-tools"></div>' +
      `<div class="pz-loading" hidden><div class="pz-spin">${ic('puzzle', 34)}</div><p>Getting the picture ready…</p></div>` +
      '<div class="pz-menu" hidden><div class="pz-menu-card"></div></div>';
    cv = $('.pz-canvas', root); ctx = cv.getContext('2d');
    hudEl = $('.pz-hud', root); statsEl = $('.pz-stats', root); barsEl = $('.pz-bars', root); toolsEl = $('.pz-tools', root);
    menuEl = $('.pz-menu', root); loadEl = $('.pz-loading', root); thumbEl = $('.pz-thumb', root);
    void hudEl;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId)) onUp(e); });
    cv.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    toolsEl.addEventListener('click', (e) => { const b = e.target.closest('button[data-a]'); if (b) tool(b.dataset.a); });
    menuEl.addEventListener('click', (e) => {
      const f = e.target.closest('button[data-ff="family"]');
      if (f) { G.sfx('click'); f.blur(); G.openLobby(); return; }
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.a === 'play') soloStart();
    });
    bindPicker($('.pz-menu-card', menuEl), pref, () => { savePref(); const card = $('.pz-menu-card', menuEl); if (card.__render) card.__render(); });
    new ResizeObserver(() => layout(false)).observe(root);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const recolor = () => { readColors(); kick(); };
    if (mq.addEventListener) mq.addEventListener('change', recolor);
    new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    setInterval(() => {
      if (screen === 'play' && game && !game.done) renderStats();
      if (M) renderBars();
      preloadRound();
    }, 400);
    layout(false);
    loadSavedPhoto();
    if (!M) showMenu();
  }

  // While the 3-2-1 runs, start painting/fetching the round's picture.
  let preloaded = '';
  function preloadRound() {
    const s = G.session && G.session();
    if (!s || s.status !== 'playing' || !s.shared || !s.shared.image) return;
    const key = s.id + ':' + s.round;
    if (preloaded === key) return;
    preloaded = key;
    loadPicture(s.shared.image).catch(() => {});
  }

  function pauseTimer() { const g = game; if (!M && g && g.start && !g.done && !g.pausedAt) g.pausedAt = now(); }
  function resumeTimer() { const g = game; if (g && g.pausedAt) { g.paused += now() - g.pausedAt; g.pausedAt = 0; } }
  G.on('pause', pauseTimer);
  G.on('resume', resumeTimer);

  G.on('multiStart', (info) => {
    const sh = (info && info.shared) || {};
    const list = PICS.list;
    const mode = sh.mode === 'slide' ? 'slide' : 'jigsaw';
    let size = Number(sh.pieces);
    if (mode === 'slide' ? !SLIDE[size] : !JIGSAW[size]) size = mode === 'slide' ? 3 : 24;
    const image = sh.image && (sh.image.kind === 'upload' || sh.image.kind === 'builtin') ? sh.image : { kind: 'builtin', key: list[(info.seed >>> 0) % list.length].key };
    M = { seed: info.seed, shared: { image, mode, pieces: size }, players: info.players };
    startGame({ mode, size, pic: image }, info.seed, info);
  });
  G.on('multiEnd', () => { M = null; showMenu(); layout(false); });

  G.mount({
    id: 'puzzle', title: 'Picture Puzzle', mode: 'race', scoreLabel: 'points',
    help: '<ul>' +
      '<li><b>Jigsaw:</b> drag the pieces onto the board. A piece clicks into place when it is close to its spot, and pieces that belong together join up and move as one.</li>' +
      '<li><b>Picture</b> shows a faint copy of the picture on the board, <b>Edges</b> shows only the border pieces, <b>Tidy</b> lines up the loose pieces. Pinch or scroll to zoom.</li>' +
      '<li><b>Sliding tiles:</b> tap a tile next to the gap (or in the same row or column) to slide it, or swipe. Arrow keys work too. Put the picture back in order.</li>' +
      '<li><b>Your own photo:</b> pick one from your phone or computer (or take one), then frame it.</li>' +
      '<li><b>Points:</b> jigsaw = pieces × 100, less the longer you take (at least 30%). Sliding tiles count your time and moves. Bigger puzzles score more.</li>' +
      '<li><b>Play together:</b> everyone gets the same puzzle. The host picks the picture. Fastest wins!</li></ul>',
    roundSetup,
    onReady: build
  });

  // test hooks
  window.__puzzle = {
    state: () => ({ screen, kind: game && game.kind, n: game && (game.n || game.N), done: game && game.done, score: game && score(game), progress: progress(game), view: Object.assign({}, view), picKey: game && game.picKey, sig: game && game.sig, multi: !!M, shared: M && M.shared }),
    pieces: () => (game && game.kind === 'jigsaw' ? game.pieces.map((p) => ({ i: p.i, x: p.x, y: p.y, hx: p.hx, hy: p.hy, locked: game.groups[p.g].locked, g: p.g, edge: p.edge, pw: game.pw, ph: game.ph })) : []),
    pieceAt: (sx, sy) => { if (!game || game.kind !== 'jigsaw') return -1; const [wx, wy] = screenToWorld(sx, sy); const p = pieceAt(game, wx, wy, false); return p ? p.i : -1; },
    toScreen: (x, y) => worldToScreen(x, y),
    slide: () => (game && game.kind === 'slide' ? { N: game.N, tiles: game.tiles.slice(), empty: game.empty, moves: game.moves } : null),
    picHash: () => { if (!game) return ''; const c2 = Object.assign(document.createElement('canvas'), { width: 16, height: 12 }); c2.getContext('2d').drawImage(game.pic, 0, 0, 16, 12); return hashStr(Array.from(c2.getContext('2d').getImageData(0, 0, 16, 12).data).map((v) => v >> 4).join(',')); },
    canvasRect: () => cv.getBoundingClientRect().toJSON(),
    drawMs: (n) => { const t0 = performance.now(); for (let i = 0; i < (n || 20); i++) draw(0.016); return (performance.now() - t0) / (n || 20); }
  };
})();
