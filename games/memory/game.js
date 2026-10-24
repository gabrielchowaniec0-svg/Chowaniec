// Memory Match: flip two cards, find the pairs. Solo (timer + moves) or 2–4 players taking turns through
// ChowGames turns. Shared state: { cards, theme, matched: {index: player}, flipped, turn, scores, phase,
// players, gid, seq, miss }. phase: 'pick' | 'reveal' (two different cards showing) | 'done'.
(function () {
  'use strict';

  const G = window.ChowGames;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const THEMES = {
    animals: { label: 'Animals', icon: 'cat', mark: 'cat', back: ['#34d399', '#059669'], list: ['🐶', '🐱', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐙', '🦄', '🐢'] },
    fruit: { label: 'Fruit', icon: 'apple', mark: 'apple', back: ['#fb7185', '#e11d48'], list: ['🍎', '🍌', '🍇', '🍓', '🍒', '🍑', '🍍', '🥝', '🍉', '🍋', '🍐', '🥥', '🍊', '🥕', '🌽', '🥑', '🍄', '🥨'] },
    vehicles: { label: 'Vehicles', icon: 'car', mark: 'car', back: ['#60a5fa', '#4f46e5'], list: ['🚗', '🚕', '🚌', '🚓', '🚑', '🚒', '🚜', '🚲', '🛵', '🚂', '✈️', '🚀', '🚁', '⛵', '🚤', '🛸', '🏎️', '🛴'] },
    mix: { label: 'Mix', icon: 'shuffle', mark: 'star', back: ['#fbbf24', '#f97316'], list: null }
  };
  THEMES.mix.list = [0, 1, 2, 3, 4, 5].flatMap((i) => [THEMES.animals.list[i * 3], THEMES.fruit.list[i * 3 + 1], THEMES.vehicles.list[i * 3 + 2]]);
  const SIZES = {
    easy: { label: 'Easy', n: 12, cols: 4, grid: '4 × 3' },
    medium: { label: 'Medium', n: 16, cols: 4, grid: '4 × 4' },
    hard: { label: 'Hard', n: 24, cols: 6, grid: '6 × 4' }
  };
  const REVEAL_MS = 1200, STALE_REVEAL_MS = 4000;

  let pref = { theme: 'animals', size: 'medium' };
  try { Object.assign(pref, JSON.parse(localStorage.getItem('chow_memory_pref') || '{}')); } catch (e) { /* ignore */ }
  if (!THEMES[pref.theme]) pref.theme = 'animals';
  if (!SIZES[pref.size]) pref.size = 'medium';
  const savePref = () => { try { localStorage.setItem('chow_memory_pref', JSON.stringify(pref)); } catch (e) { /* ignore */ } };

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  function deal(theme, n, rand) {
    const ids = shuffle(THEMES[theme].list.map((_, i) => i), rand).slice(0, n / 2);
    return shuffle(ids.concat(ids), rand);
  }

  // ---------- Elements ----------
  let root, gridEl, hudEl, statusEl, menuEl, controlsEl, fx, fxc, W = 0, H = 0;
  let mode = 'menu';            // menu | solo | multi
  let cardsEls = [];
  let theme = pref.theme;
  let cards = [];               // emoji ids
  let dealtKey = '';

  // solo
  let solo = null;              // { open: [], matched: Set, moves, start, end, timer, flipBack }

  // multi
  let S = null;                 // latest shared we're showing
  let M = null;                 // { gid, seq, myIdx, players, revealSeen: {seq, at}, hold: {cards, until}, overShown, busy, queue }

  // ---------- Layout ----------
  function bestGrid(n, w, h) {
    let best = null;
    for (let c = 2; c <= 8; c++) {
      if (n % c) continue;
      const r = n / c;
      if (r < 2 || r > 8 || c / r > 2 || r / c > 2) continue;
      const gap = Math.max(6, Math.min(12, Math.min(w, h) * 0.018));
      const cw = (w - gap * (c - 1)) / c, ch = (h - gap * (r - 1)) / r;
      const size = Math.min(cw, ch / 1.18);   // cards are a little taller than wide
      if (!best || size > best.size) best = { c, r, size, gap };
    }
    return best;
  }
  function layout() {
    const box = gridEl.parentElement.getBoundingClientRect();
    W = box.width; H = box.height;
    const n = cardsEls.length;
    if (n) {
      const g = bestGrid(n, W - 4, H - 4);
      const cw = Math.floor(Math.min(g.size, 150));
      gridEl.style.gridTemplateColumns = `repeat(${g.c}, ${cw}px)`;
      gridEl.style.gridAutoRows = `${Math.floor(cw * 1.18)}px`;
      gridEl.style.gap = `${g.gap}px`;
      gridEl.style.setProperty('--fs', `${Math.floor(cw * 0.56)}px`);
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rr = root.getBoundingClientRect();
    fx.width = Math.round(rr.width * dpr); fx.height = Math.round(rr.height * dpr);
    fx.style.width = rr.width + 'px'; fx.style.height = rr.height + 'px';
    fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function buildCards(list, th) {
    theme = th;
    cards = list.slice();
    const T = THEMES[th];
    root.style.setProperty('--back1', T.back[0]);
    root.style.setProperty('--back2', T.back[1]);
    const backMark = G.icon(T.mark, 24);
    gridEl.innerHTML = cards.map((id, i) => `<button type="button" class="mm-card deal" data-i="${i}" style="--d:${(i * 0.025).toFixed(3)}s" aria-label="Card ${i + 1}">` +
      `<span class="mm-inner"><span class="mm-face mm-back"><span>${backMark}</span></span><span class="mm-face mm-front"><span>${T.list[id]}</span></span></span></button>`).join('');
    cardsEls = Array.from(gridEl.children);
    setTimeout(() => cardsEls.forEach((c) => c.classList.remove('deal')), 900);
    layout();
    G.sfx('whoosh');
  }

  function setCard(i, { up, matched, color, pop }) {
    const el = cardsEls[i];
    if (!el) return;
    const wasUp = el.classList.contains('up');
    el.classList.toggle('up', !!up);
    el.classList.toggle('matched', !!matched);
    el.style.setProperty('--pc', color || '#22c55e');
    if (up !== wasUp) el.setAttribute('aria-label', up ? `Card ${i + 1}: ${THEMES[theme].list[cards[i]]}` : `Card ${i + 1}`);
    if (pop && !reduceMotion) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }
  function wiggle(idxs) {
    if (reduceMotion) return;
    idxs.forEach((i) => { const el = cardsEls[i]; if (el) { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); } });
  }
  function sparkle(i, color) {
    const el = cardsEls[i];
    if (!el || reduceMotion) return;
    const r = el.getBoundingClientRect(), rr = root.getBoundingClientRect();
    burst(r.left - rr.left + r.width / 2, r.top - rr.top + r.height / 2, 18, [color || '#22c55e', '#facc15', '#ffffff'], 260);
  }

  // ---------- Particles ----------
  let parts = [], fxRunning = false, lastT = 0;
  function burst(x, y, n, cols, speed) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random());
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, s: 5 + Math.random() * 6, a: Math.random() * 6, va: (Math.random() - 0.5) * 12, col: cols[k % cols.length], life: 0.8 + Math.random() * 0.5, star: Math.random() < 0.4 });
    }
    if (!fxRunning) { fxRunning = true; lastT = 0; requestAnimationFrame(fxLoop); }
  }
  function confetti() {
    if (reduceMotion) return;
    const rr = root.getBoundingClientRect();
    const cols = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899'];
    for (let k = 0; k < 3; k++) burst(rr.width * (0.2 + 0.3 * k), rr.height * 0.4, 50, cols, 520);
  }
  function fxLoop(t) {
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
    fxc.clearRect(0, 0, fx.width, fx.height);
    for (const p of parts) {
      p.vy += 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt; p.life -= dt;
      fxc.save(); fxc.translate(p.x, p.y); fxc.rotate(p.a); fxc.globalAlpha = Math.max(0, Math.min(1, p.life * 2)); fxc.fillStyle = p.col;
      if (p.star) { fxc.beginPath(); for (let k = 0; k < 5; k++) { const a = k * 1.2566; fxc.lineTo(Math.cos(a) * p.s * 0.7, Math.sin(a) * p.s * 0.7); fxc.lineTo(Math.cos(a + 0.628) * p.s * 0.3, Math.sin(a + 0.628) * p.s * 0.3); } fxc.fill(); }
      else fxc.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      fxc.restore();
    }
    parts = parts.filter((p) => p.life > 0);
    if (parts.length) requestAnimationFrame(fxLoop);
    else { fxRunning = false; fxc.clearRect(0, 0, fx.width, fx.height); }
  }

  // ---------- Solo ----------
  const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function soloScore(pairs, moves, secs) {
    // accuracy (1000 for a perfect game) + a little for every pair (bigger boards score more)
    // + a time bonus for beating ~10 seconds a pair
    const accuracy = Math.round(1000 * pairs / Math.max(1, moves));
    const timeBonus = Math.max(0, Math.round((pairs * 10 - secs) * pairs * 1.5));
    return Math.max(0, accuracy + pairs * 40 + timeBonus);
  }

  function startSolo(sizeKey, themeKey) {
    if (sizeKey) pref.size = sizeKey;
    if (themeKey) pref.theme = themeKey;
    savePref();
    mode = 'solo';
    M = null; S = null;
    menuEl.hidden = true;
    G.closeModal();
    if (solo) { clearInterval(solo.timer); clearTimeout(solo.flipBack); }
    solo = { open: [], matched: new Set(), moves: 0, start: 0, end: 0, timer: null, flipBack: null, pending: null };
    buildCards(deal(pref.theme, SIZES[pref.size].n, Math.random), pref.theme);
    solo.timer = setInterval(renderHud, 250);
    renderHud();
    renderControls();
  }

  function soloTap(i) {
    if (!solo || solo.end || solo.matched.has(i) || solo.open.includes(i)) return;
    if (solo.pending) { clearTimeout(solo.flipBack); hidePending(); }
    if (!solo.start) solo.start = performance.now();
    solo.open.push(i);
    setCard(i, { up: true });
    G.sfx('flip');
    if (solo.open.length < 2) { renderHud(); return; }
    const [a, b] = solo.open;
    solo.open = [];
    solo.moves++;
    if (cards[a] === cards[b]) {
      solo.matched.add(a); solo.matched.add(b);
      setTimeout(() => {
        G.sfx('match');
        setCard(a, { up: true, matched: true, pop: true }); setCard(b, { up: true, matched: true, pop: true });
        sparkle(a); sparkle(b);
      }, 260);
      if (solo.matched.size === cards.length) soloWin();
    } else {
      solo.pending = [a, b];
      setTimeout(() => { if (solo && solo.pending && solo.pending[0] === a) { G.sfx('wrong'); wiggle([a, b]); } }, 380);
      solo.flipBack = setTimeout(hidePending, 1100);
    }
    renderHud();
  }
  function hidePending() {
    if (!solo || !solo.pending) return;
    solo.pending.forEach((k) => setCard(k, { up: false }));
    solo.pending = null;
  }

  function soloWin() {
    solo.end = performance.now();
    clearInterval(solo.timer);
    renderHud();
    const pairs = cards.length / 2, secs = (solo.end - solo.start) / 1000;
    const score = soloScore(pairs, solo.moves, secs);
    setTimeout(() => { G.sfx('win'); confetti(); }, 450);
    setTimeout(() => {
      if (mode !== 'solo') return;
      G.gameOver({ score, title: `${solo.moves} moves · ${fmtTime(solo.end - solo.start)}`, again: () => startSolo() });
    }, 1700);
  }

  // ---------- Multiplayer ----------
  function initialShared(players, seed) {
    // bigger boards for bigger groups: 3–4 players get at least 20 cards
    const size = players.length > 2 ? Math.max(20, SIZES[pref.size].n) : SIZES[pref.size].n;
    return {
      cards: deal(pref.theme, size, G.rng(seed)), theme: pref.theme, matched: {}, flipped: [], turn: 0,
      scores: players.map(() => 0), phase: 'pick', players: players.slice(), gid: seed, seq: 0, miss: null
    };
  }

  const myName = () => G.me();
  const present = () => { const s = G.session(); return s ? s.players : (M ? M.players : []); };
  function nextTurn(s, from) {
    const here = present();
    for (let k = 1; k <= s.players.length; k++) {
      const t = (from + k) % s.players.length;
      if (here.includes(s.players[t])) return t;
    }
    return (from + 1) % s.players.length;
  }
  const clone = (s) => JSON.parse(JSON.stringify(s));

  function applyShared(s, force) {
    if (!s || !Array.isArray(s.cards)) return;
    const fresh = !M || s.gid !== M.gid;
    if (fresh) {
      M = { gid: s.gid, seq: -1, players: s.players.slice(), myIdx: s.players.indexOf(myName()), revealSeen: null, hold: null, overShown: false, busy: false, queue: [] };
      S = null;
      buildCards(s.cards, s.theme);
    }
    if (!force && s.seq <= M.seq) return;
    const prev = S;
    M.seq = s.seq;
    S = clone(s);
    if (S.phase === 'reveal' && (!M.revealSeen || M.revealSeen.seq !== S.seq)) M.revealSeen = { seq: S.seq, at: Date.now() };
    // a miss that this device didn't get to see for long enough: keep those two up for a moment
    if (S.miss && prev && (!prev.miss || prev.miss.seq !== S.miss.seq)) {
      const seenFor = M.revealSeen && M.revealSeen.seq === S.miss.seq ? Date.now() - M.revealSeen.at : 0;
      if (seenFor < 1000) M.hold = { cards: S.miss.cards, until: Date.now() + 1100 - seenFor };
    }
    renderMulti(prev);
  }

  function renderMulti(prev) {
    if (!S) return;
    const hold = M.hold && M.hold.until > Date.now() ? M.hold.cards : [];
    let matchedNow = 0;
    for (let i = 0; i < cards.length; i++) {
      const owner = S.matched[i];
      const isNew = owner != null && !!prev && prev.matched[i] == null;
      const up = owner != null || S.flipped.includes(i) || hold.includes(i) || M.queue.includes(i);
      setCard(i, { up, matched: owner != null, color: owner != null ? colorOf(owner) : null, pop: isNew });
      if (isNew) { matchedNow++; sparkle(i, colorOf(owner)); }
    }
    if (matchedNow) G.sfx('match');
    if (prev) {
      const newly = S.flipped.filter((i) => !prev.flipped.includes(i));
      if (newly.length && !M.lastLocal) G.sfx('flip');
      if (S.phase === 'reveal' && prev.phase !== 'reveal') { setTimeout(() => G.sfx('wrong'), 250); wiggle(S.flipped); }
    }
    M.lastLocal = false;
    if (hold.length) setTimeout(() => { if (S) renderMulti(S); }, Math.max(50, M.hold.until - Date.now() + 20));
    renderHud();
    renderControls();
    if (S.phase === 'done' && !M.overShown) {
      M.overShown = true;
      setTimeout(() => { G.sfx('win'); confetti(); }, 500);
      const gid = M.gid;
      setTimeout(() => { if (M && M.gid === gid && mode === 'multi') multiOver(); }, 1900);
    }
  }

  function colorOf(p) { return G.colors[p % G.colors.length]; }

  function multiOver() {
    const best = Math.max(...S.scores);
    const winners = S.players.filter((_, i) => S.scores[i] === best);
    const title = winners.length === 1 ? `${winners[0]} wins!` : `${winners.join(' & ')} tie!`;
    const detail = S.players.map((n, i) => `${n} ${S.scores[i]}`).join(' · ');
    const mine = M.myIdx >= 0 ? S.scores[M.myIdx] : 0;
    G.gameOver({ title, detail: `Pairs: ${detail}`, score: mine * 10 });
  }

  const myTurn = () => mode === 'multi' && S && M && M.myIdx >= 0 && S.turn === M.myIdx && S.phase === 'pick';

  function multiTap(i) {
    if (!myTurn() || S.matched[i] != null || S.flipped.includes(i) || M.queue.includes(i)) return;
    if (M.busy) {
      // the first flip is still saving: show this one right away and play it next
      if (S.flipped.length + M.queue.length >= 2) return;
      M.queue.push(i);
      setCard(i, { up: true });
      G.sfx('flip');
      return;
    }
    G.sfx('flip');
    doFlip(i);
  }

  function doFlip(i) {
    const base = S.seq;
    const s = clone(S);
    s.seq = base + 1;
    let after = null;
    if (s.flipped.length === 0) s.flipped = [i];
    else {
      const j = s.flipped[0];
      if (s.cards[i] === s.cards[j]) {
        s.matched[i] = s.turn; s.matched[j] = s.turn; s.scores[s.turn] += 1; s.flipped = [];
        if (Object.keys(s.matched).length === s.cards.length) s.phase = 'done';
      } else {
        s.flipped = [j, i]; s.phase = 'reveal';
        after = 'reveal';
      }
    }
    M.lastLocal = true;
    applyShared(s, true);
    send(s, base, s.phase === 'done').then((ok) => {
      if (ok && after === 'reveal') setTimeout(() => advanceReveal(s.seq), REVEAL_MS);
      if (M.queue.length && myTurn()) { const k = M.queue.shift(); doFlip(k); } else { M.queue = []; if (S) renderMulti(S); }
    });
  }

  function advanceReveal(seq) {
    if (!S || S.phase !== 'reveal' || S.seq !== seq || M.busy) return;
    const s = clone(S);
    s.miss = { cards: s.flipped.slice(), seq: s.seq };
    s.flipped = []; s.phase = 'pick'; s.turn = nextTurn(s, s.turn); s.seq = seq + 1;
    M.lastLocal = true;
    applyShared(s, true);
    send(s, seq, false);
  }

  async function send(s, baseSeq, done, attempt = 0) {
    M.busy = true;
    let ok = false;
    try { ok = await G.turns.commit(s, { done }); } catch (e) { ok = false; }
    if (!ok) {
      const fresh = G.turns.shared();
      // our copy of the session may have been a poll behind; if nobody really moved, try again
      if (attempt < 2 && fresh && fresh.gid === s.gid && fresh.seq === baseSeq) {
        await new Promise((r) => setTimeout(r, 150));
        return send(s, baseSeq, done, attempt + 1);
      }
      M.busy = false;
      M.queue = [];
      if (fresh) applyShared(fresh, true);
      return false;
    }
    M.busy = false;
    return true;
  }

  // Housekeeping: stale reveals (the mover vanished) and turns of people who left.
  setInterval(() => {
    if (mode !== 'multi' || !S || !M || M.busy || M.myIdx < 0) return;
    if (S.phase === 'reveal' && M.revealSeen && M.revealSeen.seq === S.seq && Date.now() - M.revealSeen.at > STALE_REVEAL_MS) {
      advanceReveal(S.seq);
      return;
    }
    if (S.phase === 'pick') {
      const here = present();
      const cur = S.players[S.turn];
      if (!here.includes(cur)) {
        const firstHere = S.players.find((n) => here.includes(n));
        if (firstHere === myName()) {
          const s = clone(S); const base = s.seq;
          s.flipped = []; s.turn = nextTurn(s, s.turn); s.seq = base + 1;
          applyShared(s, true); send(s, base, false);
        }
      }
    }
    renderHud();
  }, 1000);

  // ---------- HUD ----------
  function renderHud() {
    if (mode === 'solo' && solo) {
      const t = solo.start ? (solo.end || performance.now()) - solo.start : 0;
      const pairs = solo.matched.size / 2, total = cards.length / 2;
      hudEl.innerHTML = `<div class="mm-stats"><span class="st"><i>${G.icon('timer', 17)}</i><b>${fmtTime(t)}</b></span><span class="st"><i>${G.icon('layers', 17)}</i><b>${solo.moves}</b><small>${solo.moves === 1 ? 'move' : 'moves'}</small></span><span class="st"><i class="gold">${G.icon('star', 17)}</i><b>${pairs}/${total}</b><small>pairs</small></span></div>`;
      statusEl.textContent = '';
      statusEl.className = 'mm-status';
      return;
    }
    if (mode === 'multi' && S) {
      const here = present();
      hudEl.innerHTML = `<div class="mm-players">${S.players.map((n, i) => `<span class="mm-pl${i === S.turn && S.phase !== 'done' ? ' on' : ''}${here.includes(n) ? '' : ' gone'}" style="--pc:${colorOf(i)}"><i></i><b>${esc(i === M.myIdx ? 'You' : n)}</b><em>${S.scores[i]}</em></span>`).join('')}</div>`;
      let msg, cls = 'mm-status';
      const cur = S.players[S.turn];
      if (S.phase === 'done') { msg = 'All pairs found!'; cls += ' end'; }
      else if (S.turn === M.myIdx) { msg = S.phase === 'reveal' ? 'Not a pair…' : (S.flipped.length || M.queue.length ? 'Now find its partner!' : 'Your turn – flip two cards'); cls += ' mine'; }
      else msg = S.phase === 'reveal' ? `Not a pair for ${cur}…` : `Waiting for ${cur}…`;
      statusEl.className = cls;
      statusEl.style.setProperty('--pc', colorOf(S.turn));
      statusEl.textContent = msg;
    }
  }
  function renderControls() { controlsEl.hidden = mode !== 'solo'; }

  function showMenu() {
    mode = 'menu';
    if (solo) { clearInterval(solo.timer); clearTimeout(solo.flipBack); solo = null; }
    M = null; S = null;
    G.closeModal();
    hudEl.innerHTML = ''; statusEl.textContent = ''; statusEl.className = 'mm-status';
    renderMenu();
    menuEl.hidden = false;
    // a calm board in the background
    buildCards(deal(pref.theme, SIZES[pref.size].n, Math.random), pref.theme);
    renderControls();
  }
  function renderMenu() {
    menuEl.querySelector('.mm-menu-card').innerHTML =
      `<div class="mm-logo" aria-hidden="true" style="--lc:${THEMES[pref.theme].back[1]};--lb1:${THEMES[pref.theme].back[0]};--lb2:${THEMES[pref.theme].back[1]}"><span>${G.icon(THEMES[pref.theme].icon, 28)}</span><span>?</span><span>${G.icon(THEMES[pref.theme].icon, 28)}</span></div>` +
      '<h2>Memory Match</h2><p>Flip two cards. Find all the pairs!</p>' +
      `<h3>Pictures</h3><div class="mm-themes">${Object.entries(THEMES).map(([k, T]) => `<button type="button" data-theme="${k}" class="${k === pref.theme ? 'sel' : ''}" style="--b1:${T.back[0]};--b2:${T.back[1]}"><span>${G.icon(T.icon, 24)}</span>${T.label}</button>`).join('')}</div>` +
      `<h3>Play</h3><div class="mm-sizes">${Object.entries(SIZES).map(([k, Z]) => `<button type="button" data-size="${k}" class="${k === pref.size ? 'sel' : ''}"><span class="mm-mini" style="--c:${Z.cols}">${'<i></i>'.repeat(Z.n)}</span><b>${Z.label}</b><small>${Z.n} cards</small></button>`).join('')}</div>` +
      `<div class="mm-more"><button type="button" data-a="family">${G.icon('users', 20)}<span>Play with the family</span></button></div>`;
  }

  function build(ctx) {
    root = ctx.root;
    root.classList.add('mm-stage');
    root.innerHTML = '<div class="mm-wrap"><div class="mm-hud"></div><div class="mm-status" aria-live="polite"></div><div class="mm-board"><div class="mm-grid"></div></div>' +
      '<div class="mm-controls"><button type="button" class="mm-btn" data-a="menu">' + G.icon('back', 17) + '<span>Menu</span></button><button type="button" class="mm-btn primary" data-a="restart">' + G.icon('again', 17) + '<span>New game</span></button></div></div>' +
      '<canvas class="mm-fx" aria-hidden="true"></canvas><div class="mm-menu" hidden><div class="mm-menu-card"></div></div>';
    hudEl = $('.mm-hud', root); statusEl = $('.mm-status', root); gridEl = $('.mm-grid', root); controlsEl = $('.mm-controls', root); menuEl = $('.mm-menu', root);
    fx = $('.mm-fx', root); fxc = fx.getContext('2d');
    gridEl.addEventListener('click', (e) => {
      const b = e.target.closest('.mm-card');
      if (!b || G.modalOpen()) return;
      const i = Number(b.dataset.i);
      if (mode === 'solo') soloTap(i);
      else if (mode === 'multi') {
        if (!myTurn()) { if (S && S.phase !== 'done') { const m = statusEl; m.classList.remove('shake'); void m.offsetWidth; m.classList.add('shake'); } return; }
        multiTap(i);
      }
    });
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.theme) { pref.theme = b.dataset.theme; savePref(); renderMenu(); buildCards(deal(pref.theme, SIZES[pref.size].n, Math.random), pref.theme); }
      else if (b.dataset.size) startSolo(b.dataset.size);
      else if (b.dataset.a === 'family') G.openLobby();
    });
    controlsEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.a === 'menu') showMenu(); else startSolo();
    });
    // keyboard: arrows move a focus ring, Enter/Space flips
    gridEl.addEventListener('keydown', (e) => {
      const b = e.target.closest('.mm-card');
      if (!b) return;
      const i = Number(b.dataset.i);
      const cols = getComputedStyle(gridEl).gridTemplateColumns.split(' ').length;
      const to = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i - cols, ArrowDown: i + cols }[e.key];
      if (to != null) { e.preventDefault(); if (cardsEls[to]) cardsEls[to].focus(); }
    });
    new ResizeObserver(layout).observe($('.mm-board', root));
    G.on('pause', () => { /* the timer keeps going; nothing moves on its own */ });
    showMenu();
  }

  G.on('multiStart', (info) => {
    mode = 'multi';
    if (solo) { clearInterval(solo.timer); clearTimeout(solo.flipBack); solo = null; }
    menuEl.hidden = true;
    M = null; S = null;
    if (info && info.shared) applyShared(info.shared, true);
  });
  G.on('shared', (s) => { if (mode === 'multi') applyShared(s); });
  G.on('multiEnd', () => { showMenu(); });

  G.mount({
    id: 'memory', title: 'Memory Match', mode: 'turns', minPlayers: 2, maxPlayers: 4, scoreLabel: 'points',
    help: '<ul><li>Tap a card to flip it, then tap another.</li><li>Same picture? It’s a <b>pair</b> and stays up! Different? They flip back – try to remember where they were.</li>' +
      '<li>Solo: find every pair in as few moves and as fast as you can. Fewer moves = more points.</li>' +
      `<li>${G.icon('users', 17)} <b>Play together</b> (2–4 players): take turns. Find a pair and you go again. Most pairs wins!</li>` +
      '<li>Keyboard: Tab or arrow keys to move, Enter to flip.</li></ul>',
    initialShared,
    onReady: build
  });

  window.__memory = { state: () => ({ mode, cards: cards.slice(), solo: solo && { moves: solo.moves, matched: solo.matched.size, end: solo.end }, S: S && clone(S), myIdx: M && M.myIdx, busy: M && M.busy }), soloScore };
})();
