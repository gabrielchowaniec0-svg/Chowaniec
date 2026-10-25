// Kitchen Rush: a cooking rush for the whole family. Everyone cooks in their own kitchen, but the orders are the
// same for everybody (same seed, same timing), so it is a fair race AND a team: the crew's scores add up to a
// team total with three stars. Chop at the boards (hold the button), grill patties, fry fries, stir soup,
// build the plate and serve it before the ticket runs out. Don't let things burn!
// Plugs into /games/core.js. The logic is plain and testable: window.KitchenRush exposes a few hooks.
(function () {
  'use strict';
  const CG = window.ChowGames;

  const COLS = 11, ROWS = 7;
  // # wall, T L B M U crates (tomato, lettuce, bun, meat patty, potato), R plates, X trash, S serving window,
  // b chopping board, c counter, s stove, f fryer, p soup pot, . floor
  const MAP = [
    '#TLBMUR#XS#',
    '#.........#',
    '#.cc...bb.#',
    '#...ccc...#',
    '#.........#',
    '#.ss.ff.pp#',
    '###########'
  ];
  const CRATE = { T: 'tomato', L: 'lettuce', B: 'bun', M: 'patty', U: 'potato' };
  const CHOP = { tomato: 'tomato_c', lettuce: 'lettuce_c', potato: 'potato_c' };
  const CHOP_MS = 1900, COOK_MS = 5000, SOUP_MS = 6500, BURN_MS = 6500;
  const DISHES = {
    burger: { name: 'Burger', parts: ['bun', 'patty_cooked', 'lettuce_c'], value: 60, help: 'bun + grilled patty + chopped lettuce' },
    salad: { name: 'Salad', parts: ['lettuce_c', 'tomato_c'], value: 40, help: 'chopped lettuce + chopped tomato' },
    fries: { name: 'Fries', parts: ['fries'], value: 30, help: 'fried chopped potato' },
    soup: { name: 'Tomato soup', parts: ['soup'], value: 45, help: 'two chopped tomatoes in the pot' }
  };
  const DISH_IDS = Object.keys(DISHES);
  const ROUND_MS = 180000;
  const PATIENCE_MS = 72000;
  const MAX_OPEN = 5;
  const SPEED = 4.3;           // tiles per second
  const RADIUS = 0.3;
  const STARS = [300, 650, 1000];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- World ----------
  let tiles = [];              // per tile: { ch, kind, item, prog, state, inputs }
  const kindOf = (ch) => (CRATE[ch] ? 'crate' : { R: 'rack', X: 'trash', S: 'serve', b: 'board', c: 'counter', s: 'stove', f: 'fryer', p: 'pot', '#': 'wall', '.': 'floor' }[ch] || 'wall');
  function buildWorld() {
    tiles = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const ch = MAP[y][x];
      tiles.push({ ch, kind: kindOf(ch), item: null, prog: 0, state: 'idle', inputs: 0 });
    }
  }
  const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS ? null : tiles[ty * COLS + tx]);
  const solid = (tx, ty) => { const t = tileAt(tx, ty); return !t || t.kind !== 'floor'; };

  // ---------- Round state ----------
  let root, el = {}, canvas, g, dpr = 1, W = 0, H = 0, tile = 40, ox = 0, oy = 0;
  let me = '', multi = false;
  let phase = 'ready';         // ready | playing | done
  let R = null;
  let paused = false;          // tests can freeze the loop and step it by hand
  let last = 0, others = [], othersAt = 0, pushAt = 0;
  const keys = {};
  let stick = { x: 0, y: 0 }, actHeld = false;
  let particles = [];

  function makeOrders(seed) {
    const rnd = CG.rng(seed);
    const list = [];
    let at = 3500;
    for (let i = 0; i < 40; i++) {
      list.push({ id: i, dish: DISH_IDS[Math.floor(rnd() * DISH_IDS.length)], at, done: false, expired: false });
      const gap = clamp(15500 - i * 420, 8000, 15500);
      at += gap * (0.75 + rnd() * 0.5);
      if (at > ROUND_MS) break;
    }
    return list;
  }

  function newRound(seed, startAt) {
    buildWorld();
    R = {
      seed, startAt: startAt || Date.now(), t: 0, orders: makeOrders(seed), score: 0, served: 0, missed: 0, burnt: 0, streak: 0,
      px: 5, py: 4, fx: 0, fy: -1, held: null, over: false, lastToast: 0
    };
    particles = [];
    renderTickets(true);
    updateHud();
  }

  // ---------- Items ----------
  const isPlate = (it) => !!(it && typeof it === 'object' && it.plate);
  function plateDish(p) {
    const sorted = p.items.slice().sort().join(',');
    return DISH_IDS.find((id) => DISHES[id].parts.slice().sort().join(',') === sorted) || null;
  }
  function canAdd(p, item) {
    if (typeof item !== 'string') return false;
    const have = p.items.concat(item).sort();
    return DISH_IDS.some((id) => {
      const need = DISHES[id].parts.slice();
      return have.every((x) => { const i = need.indexOf(x); if (i < 0) return false; need.splice(i, 1); return true; });
    });
  }
  const label = (it) => (isPlate(it) ? (plateDish(it) ? DISHES[plateDish(it)].name : it.items.length ? 'Plate (' + it.items.length + ')' : 'Plate') : String(it || '').replace(/_/g, ' '));

  // ---------- Actions ----------
  function say(text) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(say.t);
    say.t = setTimeout(() => el.toast.classList.remove('show'), 1400);
  }
  function pop(tx, ty, text, color) { particles.push({ x: tx + 0.5, y: ty, text, color: color || '#fff', age: 0 }); }

  function target() {
    const tx = Math.floor(R.px + R.fx * 0.75), ty = Math.floor(R.py + R.fy * 0.75);
    const t = tileAt(tx, ty);
    return t && t.kind !== 'floor' && t.kind !== 'wall' ? { t, tx, ty } : null;
  }

  function press() {
    if (!R || phase !== 'playing' || R.over) return false;
    const tg = target();
    if (!tg) return false;
    const { t, tx, ty } = tg;
    const held = R.held;
    const sfx = (n) => CG.sfx && CG.sfx(n);
    switch (t.kind) {
      case 'crate':
        if (!held) { R.held = CRATE[t.ch]; sfx('click'); return true; }
        say('Your hands are full'); return false;
      case 'rack':
        if (!held) { R.held = { plate: true, items: [] }; sfx('click'); return true; }
        say('Your hands are full'); return false;
      case 'trash':
        if (held) {
          R.held = isPlate(held) ? { plate: true, items: [] } : null;
          sfx('whoosh'); pop(tx, ty, 'Tossed', '#cbd5e1'); return true;
        }
        return false;
      case 'serve': return serve(tx, ty);
      case 'counter': {
        if (held && !t.item) { t.item = held; R.held = null; sfx('click'); return true; }
        if (!held && t.item) { R.held = t.item; t.item = null; sfx('click'); return true; }
        if (held && t.item) {
          if (isPlate(held) && !isPlate(t.item) && canAdd(held, t.item)) { held.items.push(t.item); t.item = null; sfx('drop'); return true; }
          if (isPlate(t.item) && !isPlate(held) && canAdd(t.item, held)) { t.item.items.push(held); R.held = null; sfx('drop'); return true; }
          say('That does not go together');
        }
        return false;
      }
      case 'board': {
        if (!held && t.item) { R.held = t.item; t.item = null; t.prog = 0; sfx('click'); return true; }
        if (held && !t.item && typeof held === 'string' && CHOP[held]) { t.item = held; t.prog = 0; R.held = null; sfx('drop'); return true; }
        if (held && !t.item) say('Only tomato, lettuce and potato can be chopped');
        return false;
      }
      case 'stove': case 'fryer': case 'pot': return cook(t, tx, ty);
      default: return false;
    }
  }

  function cook(t, tx, ty) {
    const held = R.held;
    const sfx = (n) => CG.sfx && CG.sfx(n);
    const want = t.kind === 'stove' ? 'patty' : t.kind === 'fryer' ? 'potato_c' : 'tomato_c';
    if (t.state === 'burnt') { if (!held || isPlate(held)) { t.item = null; t.state = 'idle'; t.prog = 0; t.inputs = 0; pop(tx, ty, 'Cleaned', '#cbd5e1'); sfx('whoosh'); return true; } say('Hands free to clean it'); return false; }
    if (t.state === 'ready') {
      if (t.kind === 'pot') {
        if (isPlate(held) && canAdd(held, 'soup')) { held.items.push('soup'); t.state = 'idle'; t.item = null; t.inputs = 0; t.prog = 0; sfx('drop'); return true; }
        say('Bring a plate for the soup'); return false;
      }
      if (!held) { R.held = t.item; t.item = null; t.state = 'idle'; t.prog = 0; sfx('click'); return true; }
      if (isPlate(held) && canAdd(held, t.item)) { held.items.push(t.item); t.item = null; t.state = 'idle'; t.prog = 0; sfx('drop'); return true; }
      say('Your hands are full'); return false;
    }
    if (t.state === 'idle') {
      if (held === want && (t.kind !== 'pot' || t.inputs < 2)) {
        R.held = null; sfx('drop');
        if (t.kind === 'pot') { t.inputs++; if (t.inputs === 2) { t.state = 'work'; t.prog = 0; } return true; }
        t.item = want; t.state = 'work'; t.prog = 0; return true;
      }
      if (t.kind === 'pot' && !held && t.inputs > 0) { R.held = 'tomato_c'; t.inputs--; return true; }
      if (held) say(t.kind === 'stove' ? 'The stove needs a raw patty' : t.kind === 'fryer' ? 'The fryer needs chopped potato' : 'The pot needs chopped tomatoes');
      return false;
    }
    return false;
  }

  function serve(tx, ty) {
    const held = R.held;
    if (!isPlate(held)) { say(held ? 'Serve it on a plate' : 'Bring a finished plate here'); return false; }
    const dish = plateDish(held);
    if (!dish) { say('That plate is not finished'); return false; }
    const open = openOrders();
    const o = open.filter((x) => x.dish === dish).sort((a, b) => a.at - b.at)[0];
    if (!o) { say('Nobody ordered that'); return false; }
    o.done = true;
    const left = clamp(1 - (R.t - o.at) / PATIENCE_MS, 0, 1);
    const tip = Math.round(DISHES[dish].value * 0.5 * left);
    R.streak++;
    const bonus = Math.min(20, (R.streak - 1) * 5);
    const pts = DISHES[dish].value + tip + bonus;
    R.score += pts; R.served++;
    R.held = null;
    pop(tx, ty, '+' + pts, '#fde047');
    if (CG.sfx) CG.sfx('coin');
    renderTickets(true);
    updateHud();
    pushState(true);
    return true;
  }

  function openOrders() { return R.orders.filter((o) => !o.done && !o.expired && o.at <= R.t && R.t < o.at + PATIENCE_MS).slice(0, MAX_OPEN); }

  // ---------- Simulation ----------
  function tick(dt) {
    if (!R || phase !== 'playing' || R.over) return;
    R.t += dt;
    // keep time exact in a family round: the server's start time is the clock
    // movement
    let dx = (keys.ArrowRight || keys.d || keys.D ? 1 : 0) - (keys.ArrowLeft || keys.a || keys.A ? 1 : 0) + stick.x;
    let dy = (keys.ArrowDown || keys.s || keys.S ? 1 : 0) - (keys.ArrowUp || keys.w || keys.W ? 1 : 0) + stick.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.12) {
      dx /= Math.max(1, len); dy /= Math.max(1, len);
      R.fx = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0;
      R.fy = Math.abs(dx) > Math.abs(dy) ? 0 : Math.sign(dy);
      if (Math.abs(dx) === Math.abs(dy)) { R.fx = Math.sign(dx); R.fy = 0; }
      step(dx * SPEED * dt / 1000, dy * SPEED * dt / 1000);
    }
    // chopping while the button is held at a board
    if (actHeld) {
      const tg = target();
      if (tg && tg.t.kind === 'board' && tg.t.item && CHOP[tg.t.item]) {
        tg.t.prog += dt / CHOP_MS;
        if (Math.random() < 0.18 && CG.sfx) CG.sfx('tick');
        if (tg.t.prog >= 1) { tg.t.item = CHOP[tg.t.item]; tg.t.prog = 1; pop(tg.tx, tg.ty, 'Chopped', '#86efac'); if (CG.sfx) CG.sfx('point'); }
      }
    }
    // cooking
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.kind !== 'stove' && t.kind !== 'fryer' && t.kind !== 'pot') continue;
      const tx = i % COLS, ty = Math.floor(i / COLS);
      if (t.state === 'work') {
        t.prog += dt / (t.kind === 'pot' ? SOUP_MS : COOK_MS);
        if (t.prog >= 1) { t.state = 'ready'; t.prog = 0; t.item = t.kind === 'stove' ? 'patty_cooked' : t.kind === 'fryer' ? 'fries' : 'soup'; pop(tx, ty, 'Ready!', '#fde047'); if (CG.sfx) CG.sfx('point'); }
      } else if (t.state === 'ready') {
        t.prog += dt / BURN_MS;
        if (t.prog >= 1) { t.state = 'burnt'; t.item = t.kind === 'stove' ? 'patty_burnt' : t.kind === 'fryer' ? 'fries_burnt' : 'soup_burnt'; R.burnt++; pop(tx, ty, 'Burnt!', '#f87171'); if (CG.sfx) CG.sfx('wrong'); }
      }
    }
    // orders that ran out of patience
    R.orders.forEach((o) => {
      if (!o.done && !o.expired && R.t >= o.at + PATIENCE_MS) { o.expired = true; R.missed++; R.streak = 0; R.score = Math.max(0, R.score - 10); say('An order expired (-10)'); if (CG.sfx) CG.sfx('hit'); renderTickets(true); }
    });
    particles.forEach((p) => { p.age += dt; });
    particles = particles.filter((p) => p.age < 900);
    if (R.t >= ROUND_MS) finish();
  }

  function step(mx, my) {
    const tryMove = (nx, ny) => {
      const minX = Math.floor(nx - RADIUS), maxX = Math.floor(nx + RADIUS), minY = Math.floor(ny - RADIUS), maxY = Math.floor(ny + RADIUS);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (solid(x, y)) return false;
      return true;
    };
    if (tryMove(R.px + mx, R.py)) R.px += mx;
    if (tryMove(R.px, R.py + my)) R.py += my;
  }

  function finish() {
    if (!R || R.over) return;
    R.over = true;
    phase = 'done';
    updateHud();
    pushState(true);
    const stars = STARS.filter((s) => R.score >= s).length;
    CG.gameOver({
      score: R.score,
      title: stars >= 3 ? 'Five-star service!' : 'Service over!',
      detail: `${R.served} served · ${R.missed} missed · ${R.burnt} burnt · ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`,
      again: () => toReady()
    });
  }

  // ---------- Multiplayer sync ----------
  function pushState(force) {
    if (!multi || !R) return;
    const now = performance.now();
    if (!force && now - pushAt < 300) return;
    pushAt = now;
    CG.race.update({ score: R.score, served: R.served, held: R.held ? label(R.held) : '' });
  }

  // ---------- HUD ----------
  function renderTickets(rebuild) {
    if (!el.orders || !R) return;
    const open = openOrders();
    if (rebuild) {
      el.orders.innerHTML = open.map((o) => `<div class="kr-ticket" data-id="${o.id}"><b>${esc(DISHES[o.dish].name)}</b><small>${esc(DISHES[o.dish].help)}</small><div class="bar"><i></i></div></div>`).join('');
    }
    el.orders.querySelectorAll('.kr-ticket').forEach((node) => {
      const o = R.orders[Number(node.dataset.id)];
      if (!o) return;
      const left = clamp(1 - (R.t - o.at) / PATIENCE_MS, 0, 1);
      node.querySelector('i').style.width = (left * 100).toFixed(1) + '%';
      node.classList.toggle('warn', left < 0.5 && left >= 0.25);
      node.classList.toggle('late', left < 0.25);
    });
  }
  let hudAt = 0;
  function updateHud() {
    if (!el.score || !R) return;
    el.score.textContent = R.score;
    const left = Math.max(0, Math.ceil((ROUND_MS - R.t) / 1000));
    el.time.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (multi) {
      const list = others.slice().sort((a, b) => (b.state && b.state.score || 0) - (a.state && a.state.score || 0));
      const team = (R.score || 0) + list.reduce((a, o) => a + ((o.state && o.state.score) || 0), 0);
      const stars = STARS.filter((s) => team >= s).length;
      el.team.innerHTML = `Team <b>${team}</b> ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
      el.team.hidden = false;
      el.crew.innerHTML = list.slice(0, 5).map((o) => `<span><i style="background:${esc(o.color || '#fff')}"></i>${esc(o.name)} <b>${(o.state && o.state.score) || 0}</b></span>`).join('');
    } else { el.team.hidden = true; el.crew.innerHTML = ''; }
  }

  // ---------- Drawing ----------
  function layout() {
    if (!canvas) return;
    const r = el.stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    tile = Math.floor(Math.min(W / COLS, H / ROWS));
    ox = Math.floor((W - tile * COLS) / 2); oy = Math.floor((H - tile * ROWS) / 2);
    el.stick.style.display = el.act.style.display = (matchMedia('(pointer: coarse)').matches || window.innerWidth < 700) ? '' : 'none';
  }

  const COLORS = { floorA: '#e9d9b8', floorB: '#dfcda7', wall: '#4b3b32', counter: '#b08a5c', counterTop: '#c9a272', steel: '#9aa5b1', steelDark: '#6b7682' };

  function drawItem(it, cx, cy, s) {
    g.save(); g.translate(cx, cy);
    const r = s * 0.5;
    const circle = (x, y, rad, fill, stroke) => { g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); } };
    const rr = (x, y, w, h, rad, fill) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, rad) : g.rect(x, y, w, h); g.fillStyle = fill; g.fill(); };
    if (isPlate(it)) {
      circle(0, 0, r * 1.05, '#fff', '#cbd5e1');
      it.items.forEach((p, i) => { g.save(); g.translate((i - (it.items.length - 1) / 2) * r * 0.55, -r * 0.1); g.scale(0.62, 0.62); drawItem(p, 0, 0, s); g.restore(); });
      g.restore(); return;
    }
    switch (it) {
      case 'tomato': circle(0, 0, r * 0.7, '#ef4444', '#b91c1c'); circle(0, -r * 0.6, r * 0.2, '#16a34a'); break;
      case 'tomato_c': for (let i = -1; i <= 1; i++) circle(i * r * 0.5, i === 0 ? -r * 0.15 : r * 0.15, r * 0.34, '#ef4444', '#b91c1c'); break;
      case 'lettuce': circle(0, 0, r * 0.72, '#4ade80', '#15803d'); circle(-r * 0.15, -r * 0.1, r * 0.4, '#86efac'); break;
      case 'lettuce_c': rr(-r * 0.7, -r * 0.3, r * 0.55, r * 0.5, 4, '#4ade80'); rr(-r * 0.05, -r * 0.1, r * 0.6, r * 0.5, 4, '#86efac'); break;
      case 'potato': g.beginPath(); g.ellipse(0, 0, r * 0.75, r * 0.55, 0.4, 0, Math.PI * 2); g.fillStyle = '#b8864b'; g.fill(); break;
      case 'potato_c': for (let i = -1; i <= 1; i++) rr(i * r * 0.45 - r * 0.15, -r * 0.55, r * 0.3, r * 1.1, 3, '#fde68a'); break;
      case 'bun': g.beginPath(); g.arc(0, r * 0.15, r * 0.75, Math.PI, 0); g.closePath(); g.fillStyle = '#e8b36a'; g.fill(); rr(-r * 0.75, r * 0.15, r * 1.5, r * 0.3, 4, '#d99a4a'); break;
      case 'patty': rr(-r * 0.7, -r * 0.35, r * 1.4, r * 0.7, 8, '#f9a8a8'); break;
      case 'patty_cooked': rr(-r * 0.7, -r * 0.35, r * 1.4, r * 0.7, 8, '#7c4a2a'); break;
      case 'patty_burnt': rr(-r * 0.7, -r * 0.35, r * 1.4, r * 0.7, 8, '#1f2937'); break;
      case 'fries': rr(-r * 0.55, r * 0.05, r * 1.1, r * 0.6, 4, '#ef4444'); for (let i = -2; i <= 2; i++) rr(i * r * 0.22 - r * 0.08, -r * 0.65, r * 0.16, r * 0.8, 2, '#fde047'); break;
      case 'fries_burnt': rr(-r * 0.55, r * 0.05, r * 1.1, r * 0.6, 4, '#7f1d1d'); for (let i = -2; i <= 2; i++) rr(i * r * 0.22 - r * 0.08, -r * 0.65, r * 0.16, r * 0.8, 2, '#292524'); break;
      case 'soup': g.beginPath(); g.arc(0, 0, r * 0.7, 0, Math.PI); g.closePath(); g.fillStyle = '#f97316'; g.fill(); rr(-r * 0.7, -r * 0.1, r * 1.4, r * 0.2, 3, '#fb923c'); break;
      case 'soup_burnt': g.beginPath(); g.arc(0, 0, r * 0.7, 0, Math.PI); g.closePath(); g.fillStyle = '#292524'; g.fill(); break;
      default: circle(0, 0, r * 0.5, '#94a3b8');
    }
    g.restore();
  }

  function bar(x, y, w, v, color) {
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y, w, 6);
    g.fillStyle = color; g.fillRect(x, y, w * clamp(v, 0, 1), 6);
  }

  function draw(now) {
    if (!g || !R) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#1f1a17'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(ox, oy);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = tiles[y * COLS + x];
      const px = x * tile, py = y * tile;
      g.fillStyle = (x + y) % 2 ? COLORS.floorA : COLORS.floorB; g.fillRect(px, py, tile, tile);
      if (t.kind === 'floor') continue;
      if (t.kind === 'wall') { g.fillStyle = COLORS.wall; g.fillRect(px, py, tile, tile); continue; }
      drawStation(t, x, y, px, py, now);
    }
    // the target highlight
    const tg = R && phase === 'playing' ? target() : null;
    if (tg) { g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.strokeRect(tg.tx * tile + 2, tg.ty * tile + 2, tile - 4, tile - 4); }
    // the chef
    drawChef(R.px * tile, R.py * tile, R.fx, R.fy, R.held, me, CG.colors ? CG.colors[0] : '#3b82f6', now);
    // pop-ups
    particles.forEach((p) => {
      const k = p.age / 900;
      g.globalAlpha = 1 - k; g.fillStyle = p.color; g.font = `800 ${Math.round(tile * 0.34)}px Outfit, sans-serif`; g.textAlign = 'center';
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3; g.strokeText(p.text, p.x * tile, (p.y - k * 0.8) * tile); g.fillText(p.text, p.x * tile, (p.y - k * 0.8) * tile);
      g.globalAlpha = 1;
    });
    g.restore();
  }

  function drawStation(t, x, y, px, py, now) {
    const s = tile;
    const base = (fill, top) => { g.fillStyle = fill; g.fillRect(px, py, s, s); g.fillStyle = top; g.fillRect(px + 3, py + 3, s - 6, s - 10); };
    const cx = px + s / 2, cy = py + s / 2;
    switch (t.kind) {
      case 'crate': base('#7a5230', '#a97844'); drawItem(CRATE[t.ch], cx, cy, s * 0.8); break;
      case 'rack': base(COLORS.steelDark, COLORS.steel); for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(cx, cy + 4 - i * 4, s * 0.3, s * 0.12, 0, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#cbd5e1'; g.stroke(); } break;
      case 'trash': base('#374151', '#4b5563'); g.fillStyle = '#9ca3af'; g.fillRect(px + s * 0.28, py + s * 0.3, s * 0.44, s * 0.44); g.fillRect(px + s * 0.24, py + s * 0.24, s * 0.52, s * 0.08); break;
      case 'serve': base('#0f766e', '#14b8a6'); g.fillStyle = '#fff'; g.font = `800 ${Math.round(s * 0.22)}px Outfit, sans-serif`; g.textAlign = 'center'; g.fillText('SERVE', cx, cy + s * 0.08); break;
      case 'counter': base(COLORS.counter, COLORS.counterTop); if (t.item) drawItem(t.item, cx, cy, s * 0.8); break;
      case 'board': base(COLORS.counter, '#d9b98a'); g.fillStyle = '#f5e6c8'; g.fillRect(px + s * 0.12, py + s * 0.12, s * 0.76, s * 0.6);
        if (t.item) { drawItem(t.item, cx, cy - 2, s * 0.8); if (CHOP[t.item]) bar(px + 4, py + s - 12, s - 8, t.prog, '#22c55e'); } break;
      case 'stove': case 'fryer': case 'pot': {
        base('#374151', t.kind === 'pot' ? '#475569' : t.kind === 'fryer' ? '#64748b' : '#4b5563');
        g.beginPath(); g.arc(cx, cy - 2, s * 0.32, 0, Math.PI * 2); g.fillStyle = t.kind === 'fryer' ? '#fcd34d' : '#111827'; g.fill();
        if (t.state === 'work') { g.beginPath(); g.arc(cx, cy - 2, s * 0.32, 0, Math.PI * 2); g.strokeStyle = '#fb923c'; g.lineWidth = 3; g.stroke(); }
        if (t.item) drawItem(t.item, cx, cy - 2, s * 0.7);
        if (t.kind === 'pot' && t.state === 'idle' && t.inputs) { for (let i = 0; i < t.inputs; i++) drawItem('tomato_c', cx - s * 0.12 + i * s * 0.24, cy - 2, s * 0.45); }
        if (t.state === 'work') bar(px + 4, py + s - 12, s - 8, t.prog, '#fb923c');
        if (t.state === 'ready') bar(px + 4, py + s - 12, s - 8, 1 - t.prog, t.prog > 0.6 ? '#ef4444' : '#fde047');
        if (t.state === 'burnt') { g.fillStyle = 'rgba(100,100,100,.55)'; g.beginPath(); g.arc(cx + Math.sin(now / 200) * 4, cy - s * 0.4, s * 0.16, 0, Math.PI * 2); g.fill(); }
        break;
      }
      default: break;
    }
  }

  function drawChef(x, y, fx, fy, held, name, color, now) {
    const s = tile, r = s * 0.3;
    const bob = Math.sin(now / 120) * (Math.hypot(stick.x, stick.y) > 0.1 || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight ? 2 : 0.5);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(x, y + r * 1.05, r * 1.0, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x, y + bob, r, 0, Math.PI * 2); g.fillStyle = color || '#3b82f6'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.stroke();
    // hat
    g.fillStyle = '#fff'; g.fillRect(x - r * 0.7, y - r * 1.15 + bob, r * 1.4, r * 0.5);
    g.beginPath(); g.arc(x, y - r * 1.15 + bob, r * 0.75, Math.PI, 0); g.fill();
    // eyes follow the facing
    g.fillStyle = '#111';
    g.beginPath(); g.arc(x - r * 0.3 + fx * r * 0.2, y - r * 0.05 + fy * r * 0.2 + bob, r * 0.12, 0, Math.PI * 2); g.arc(x + r * 0.3 + fx * r * 0.2, y - r * 0.05 + fy * r * 0.2 + bob, r * 0.12, 0, Math.PI * 2); g.fill();
    if (held) drawItem(held, x + fx * s * 0.45, y + fy * s * 0.45 - s * 0.1 + bob, s * 0.7);
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(s * 0.2)}px Outfit, sans-serif`; g.textAlign = 'center';
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3; g.strokeText(name, x, y + r * 2.0); g.fillText(name, x, y + r * 2.0);
  }

  // ---------- UI / controls ----------
  function build() {
    root.innerHTML = `<div class="kr" id="kr">
      <div class="kr-hud"><div class="kr-top">
        <span class="kr-pill">${CG.icon('star', 16)}<b id="kr-score">0</b></span>
        <span class="kr-pill">${CG.icon('timer', 16)}<b id="kr-time">3:00</b></span>
        <span class="kr-pill" id="kr-team" hidden></span>
        <div class="kr-crew" id="kr-crew"></div></div>
        <div class="kr-orders" id="kr-orders" aria-live="polite"></div></div>
      <div class="kr-stage" id="kr-stage"><canvas id="kr-canvas" role="img" aria-label="Kitchen"></canvas>
        <div class="kr-toast" id="kr-toast" role="status"></div>
        <div class="kr-stick" id="kr-stick" aria-hidden="true"><i></i></div>
        <button type="button" class="kr-act" id="kr-act" aria-label="Action: pick up, put down, hold to chop">ACT</button>
        <div class="kr-overlay" id="kr-overlay"></div></div></div>`;
    el = { score: root.querySelector('#kr-score'), time: root.querySelector('#kr-time'), team: root.querySelector('#kr-team'), crew: root.querySelector('#kr-crew'),
      orders: root.querySelector('#kr-orders'), stage: root.querySelector('#kr-stage'), toast: root.querySelector('#kr-toast'), stick: root.querySelector('#kr-stick'),
      act: root.querySelector('#kr-act'), overlay: root.querySelector('#kr-overlay') };
    canvas = root.querySelector('#kr-canvas');
    g = canvas.getContext('2d');
    bindControls();
  }

  function bindControls() {
    const typing = () => CG.modalOpen && CG.modalOpen();
    window.addEventListener('keydown', (e) => {
      if (typing() || CG.countingDown()) return;
      if ([' ', 'Enter', 'e', 'E'].includes(e.key)) {
        e.preventDefault();
        if (!e.repeat) { actHeld = true; press(); }
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) { keys[e.key] = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if ([' ', 'Enter', 'e', 'E'].includes(e.key)) actHeld = false;
      delete keys[e.key];
    });
    window.addEventListener('blur', () => { actHeld = false; Object.keys(keys).forEach((k) => delete keys[k]); stick = { x: 0, y: 0 }; });
    // on-screen joystick
    const pad = el.stick, knob = pad.querySelector('i');
    let pid = null;
    const move = (e) => {
      const r = pad.getBoundingClientRect();
      let vx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), vy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(vx, vy); if (l > 1) { vx /= l; vy /= l; }
      stick = { x: Math.abs(vx) < 0.2 ? 0 : vx, y: Math.abs(vy) < 0.2 ? 0 : vy };
      knob.style.transform = `translate(${vx * 38}px, ${vy * 38}px)`;
    };
    pad.addEventListener('pointerdown', (e) => { pid = e.pointerId; pad.setPointerCapture(pid); move(e); e.preventDefault(); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
    const end = (e) => { if (e.pointerId === pid) { pid = null; stick = { x: 0, y: 0 }; knob.style.transform = ''; } };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
    // action button: tap to pick up/put down, hold to chop
    el.act.addEventListener('pointerdown', (e) => { if (CG.countingDown()) return; actHeld = true; el.act.classList.add('down'); press(); e.preventDefault(); });
    const up = () => { actHeld = false; el.act.classList.remove('down'); };
    el.act.addEventListener('pointerup', up); el.act.addEventListener('pointercancel', up); el.act.addEventListener('pointerleave', up);
    el.overlay.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'family') CG.openLobby();
      if (b.dataset.act === 'solo') startSolo();
    });
  }

  function renderOverlay() {
    const o = el.overlay;
    if (phase !== 'ready') { o.innerHTML = ''; o.className = 'kr-overlay'; return; }
    o.innerHTML = `<div class="kr-card"><div>${CG.badge('chef', 52)}</div><h2>Kitchen Rush</h2>
      <p>Orders keep coming! Cook, plate and serve before the tickets run out. Everyone gets the same orders, and your scores add up to a team total.</p>
      <button type="button" class="kr-btn primary" data-act="family">${CG.icon('users', 22)}<span>Cook with the family</span></button>
      <h3>Practice alone</h3>
      <button type="button" class="kr-btn" data-act="solo">${CG.icon('play', 20)}<span>Start a solo shift</span></button>
      <h3>Recipes</h3>
      <div class="kr-recipes">${DISH_IDS.map((id) => `<div><b>${esc(DISHES[id].name)}</b>${esc(DISHES[id].help)}</div>`).join('')}</div></div>`;
    o.className = 'kr-overlay show';
  }

  function toReady() {
    phase = 'ready'; multi = false; others = [];
    newRound(Math.floor(Math.random() * 1e9), Date.now());
    R.over = false;
    renderOverlay();
  }

  function startSolo() {
    if (multi) return;
    newRound(Math.floor(Math.random() * 1e9), Date.now());
    phase = 'playing';
    renderOverlay();
    say('Orders are coming in!');
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (paused) { draw(now); return; }
    const dt = Math.min(50, now - (last || now));
    last = now;
    if (multi && now - othersAt > 200) { othersAt = now; others = CG.race.others(); }
    if (phase === 'playing' && R) {
      if (multi && R.startAt) {
        const want = Date.now() - R.startAt;        // the shared clock wins in a family round
        if (Math.abs(want - R.t) > 600) R.t = want;
      }
      tick(dt);
      if (now - hudAt > 200) { hudAt = now; renderTickets(false); updateHud(); }
      pushState(false);
      if (multi && openOrders().length !== el.orders.children.length) renderTickets(true);
    }
    draw(now);
  }

  CG.mount({
    id: 'chef', title: 'Kitchen Rush', mode: 'race', scoreLabel: 'points', syncMs: 400,
    help: '<ul><li><b>Move</b> with the stick (phone) or the arrow keys / WASD. The chef faces the way you walk; the white box shows what you are facing.</li>' +
      '<li><b>ACT</b> (or Space / E) picks things up, puts them down and uses a station. <b>Hold ACT</b> at a chopping board to chop.</li>' +
      '<li>Burger = bun + grilled patty + chopped lettuce. Salad = chopped lettuce + chopped tomato. Fries = fried chopped potato. Soup = two chopped tomatoes in the pot, ladled onto a plate.</li>' +
      '<li>Build a plate (take one from the rack), then <b>SERVE</b> it before the ticket bar runs out. Faster serving means a bigger tip, and a streak earns bonus points.</li>' +
      '<li>Cooked food burns if you leave it. Clean burnt food at the station, or throw items in the bin.</li>' +
      `<li><b>${CG.icon('users', 17)} Cook with the family:</b> everyone gets the same orders in their own kitchen at the same time. Your scores add up to a team total with up to three stars.</li></ul>`,
    onReady(ctx) {
      root = ctx.root; me = ctx.user || CG.me();
      build();
      new ResizeObserver(layout).observe(el.stage);
      window.addEventListener('resize', layout);
      layout();
      toReady();
      requestAnimationFrame(frame);
    }
  });

  CG.on('multiStart', (info) => {
    multi = true;
    me = info.me || CG.me();
    newRound(info.seed, info.startAt || Date.now());
    R.over = false;
    others = [];
    phase = 'playing';
    renderOverlay();
    say('Service! Orders incoming!');
    CG.race.update({ score: 0, served: 0, held: '' });
  });
  CG.on('multiEnd', () => { toReady(); });
  CG.on('pause', () => { actHeld = false; });

  // Hooks for tests and curious grown-ups.
  window.KitchenRush = {
    start: (seed) => { newRound(seed || 1, Date.now()); phase = 'playing'; renderOverlay(); },
    pause: (v) => { paused = !!v; },
    step: (ms) => { const n = Math.ceil(ms / 25); for (let i = 0; i < n; i++) tick(Math.min(25, ms - i * 25)); renderTickets(false); updateHud(); },
    teleport: (x, y, fx, fy) => { R.px = x; R.py = y; R.fx = fx || 0; R.fy = fy == null ? -1 : fy; },
    press, hold: (v) => { actHeld = !!v; },
    state: () => R && ({ phase, t: R.t, score: R.score, served: R.served, missed: R.missed, burnt: R.burnt, held: R.held, px: R.px, py: R.py, open: openOrders().map((o) => o.dish), orders: R.orders.map((o) => ({ dish: o.dish, at: o.at })) }),
    tile: (x, y) => { const t = tileAt(x, y); return t && { kind: t.kind, item: t.item, state: t.state, prog: t.prog, inputs: t.inputs }; },
    map: () => MAP.slice()
  };
})();
