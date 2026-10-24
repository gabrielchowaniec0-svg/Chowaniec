// Dice Party: roll five dice up to three times a turn (tap a die to hold it), then score the roll in one of
// 13 boxes. Solo, or 2–6 players taking turns through ChowGames turns. The roller's device rolls the dice
// and saves every roll, so everyone watches the same dice tumble.
//
// Shared state: { g:'dice', gid, seq, players, turn, dice[5], held[5], rolls (0–3 this turn), rid (roll
//   counter, for animations), cards [[13 scores, -1 = empty] per player], phase 'play'|'done', last }.
(function () {
  'use strict';

  const G = window.ChowGames;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Scoring ----------
  const CATS = [
    { label: 'Ones', face: 1 }, { label: 'Twos', face: 2 }, { label: 'Threes', face: 3 },
    { label: 'Fours', face: 4 }, { label: 'Fives', face: 5 }, { label: 'Sixes', face: 6 },
    { label: '3 of a kind', icon: 'layers', hint: 'Three the same: add up all dice' },
    { label: '4 of a kind', icon: 'grid2', hint: 'Four the same: add up all dice' },
    { label: 'Full house', icon: 'home', hint: 'Three of one and two of another: 25' },
    { label: 'Small straight', icon: 'arrowRight', hint: 'Four in a row: 30' },
    { label: 'Large straight', icon: 'rocket', hint: 'Five in a row: 40' },
    { label: 'Party!', icon: 'party', hint: 'All five the same: 50' },
    { label: 'Chance', icon: 'shuffle', hint: 'Anything: add up all dice' }
  ];
  const BONUS_AT = 63, BONUS = 35;
  function counts(d) { const c = [0, 0, 0, 0, 0, 0, 0]; d.forEach((v) => c[v]++); return c; }
  const has = (c, list) => list.every((v) => c[v] > 0);
  function scoreFor(cat, d) {
    const c = counts(d), sum = d.reduce((a, b) => a + b, 0), max = Math.max(...c);
    if (cat < 6) return c[cat + 1] * (cat + 1);
    switch (cat) {
      case 6: return max >= 3 ? sum : 0;
      case 7: return max >= 4 ? sum : 0;
      case 8: return c.includes(3) && c.includes(2) ? 25 : 0;
      case 9: return has(c, [1, 2, 3, 4]) || has(c, [2, 3, 4, 5]) || has(c, [3, 4, 5, 6]) ? 30 : 0;
      case 10: return has(c, [1, 2, 3, 4, 5]) || has(c, [2, 3, 4, 5, 6]) ? 40 : 0;
      case 11: return max === 5 ? 50 : 0;
      default: return sum;
    }
  }
  function totals(card) {
    let upper = 0, lower = 0;
    card.forEach((v, i) => { if (v >= 0) { if (i < 6) upper += v; else lower += v; } });
    const bonus = upper >= BONUS_AT ? BONUS : 0;
    return { upper, bonus, lower, total: upper + bonus + lower };
  }

  // ---------- Rules (pure: each returns a new state, or null if not allowed) ----------
  let presentNames = null;   // null = everyone (solo)
  const here = (s, i) => !presentNames || presentNames.includes(s.players[i]);
  const open = (s, i) => s.cards[i].some((v) => v < 0);
  function newGame(players, seed) {
    return {
      g: 'dice', gid: seed >>> 0, seq: 0, players: players.slice(), turn: 0, dice: [1, 2, 3, 4, 5], held: [false, false, false, false, false],
      rolls: 0, rid: 0, cards: players.map(() => Array(13).fill(-1)), phase: 'play', last: { kind: 'start' }
    };
  }
  function nextTurn(s, from) {
    const n = s.players.length;
    for (let k = 1; k <= n; k++) { const t = (from + k) % n; if (here(s, t) && open(s, t)) return t; }
    return -1;
  }
  function doRoll(s0, p, values) {
    if (!s0 || s0.phase !== 'play' || s0.turn !== p || s0.rolls >= 3) return null;
    const s = clone(s0); s.seq++;
    if (s.rolls === 0) s.held = [false, false, false, false, false];
    s.dice = s.dice.map((d, i) => (s.held[i] ? d : values[i]));
    s.rolls++; s.rid++;
    s.last = { kind: 'roll', p, rid: s.rid };
    return s;
  }
  function doHold(s0, p, i) {
    if (!s0 || s0.phase !== 'play' || s0.turn !== p || s0.rolls < 1 || s0.rolls >= 3 || i < 0 || i > 4) return null;
    const s = clone(s0); s.seq++;
    s.held[i] = !s.held[i];
    s.last = { kind: 'hold', p };
    return s;
  }
  function doScore(s0, p, cat) {
    if (!s0 || s0.phase !== 'play' || s0.turn !== p || s0.rolls < 1 || !(cat >= 0 && cat < 13) || s0.cards[p][cat] >= 0) return null;
    const s = clone(s0); s.seq++;
    const pts = scoreFor(cat, s.dice);
    s.cards[p][cat] = pts;
    s.last = { kind: 'score', p, cat, pts };
    finishTurn(s, p);
    return s;
  }
  function finishTurn(s, from) {
    s.rolls = 0; s.held = [false, false, false, false, false];
    const t = nextTurn(s, from);
    if (t < 0) { s.phase = 'done'; return; }
    s.turn = t;
  }
  function doGone(s0) {
    if (!s0 || s0.phase !== 'play') return null;
    const s = clone(s0); s.seq++;
    s.last = { kind: 'gone', p: s.turn };
    finishTurn(s, s.turn);
    return s;
  }
  function rollValues() {
    const out = [];
    const buf = new Uint32Array(5);
    try { crypto.getRandomValues(buf); } catch (e) { for (let i = 0; i < 5; i++) buf[i] = Math.floor(Math.random() * 2 ** 32); }
    for (let i = 0; i < 5; i++) out.push(1 + (buf[i] % 6));
    return out;
  }

  // ---------- View ----------
  let root, playersEl, statusEl, trayEl, diceEls = [], rollBtn, cardEl, menuEl, fx, fxc, bannerEl;
  let mode = 'menu';     // menu | solo | multi
  let S = null;          // the state on screen
  let V = null;          // { gid, confirmed, pushing, again, overShown, rid, rot[] , armZero }
  const colorOf = (i) => G.colors[i % G.colors.length];
  function myIdx() { if (!S) return -1; if (mode === 'solo') return 0; return S.players.indexOf(G.me()); }
  const myTurn = () => S && S.phase === 'play' && S.turn === myIdx() && myIdx() >= 0;
  const dname = (i) => (i === myIdx() ? 'You' : S.players[i]);

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const faceHtml = (v) => `<span class="dp-f f${v}">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => `<i${PIPS[v].includes(k) ? ' class="on"' : ''}></i>`).join('')}</span>`;
  const CUBE = [1, 2, 3, 4, 5, 6].map(faceHtml).join('');
  const BASE = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
  const miniDie = (v) => `<span class="dp-mini">${faceHtml(v)}</span>`;

  function buildDice() {
    trayEl.querySelector('.dp-dice').innerHTML = [0, 1, 2, 3, 4].map((i) => `<button type="button" class="dp-die" data-i="${i}" aria-label="Die ${i + 1}">` +
      `<span class="dp-shadow"></span><span class="dp-bounce"><span class="dp-cube">${CUBE}</span></span><span class="dp-tag">${G.icon('lock', 12)}Held</span></button>`).join('');
    diceEls = Array.from(trayEl.querySelectorAll('.dp-die'));
  }
  function setDie(i, v, spin) {
    const el = diceEls[i];
    const cube = el.querySelector('.dp-cube');
    const r = V.rot[i];
    const b = BASE[v];
    if (spin && !reduceMotion) {
      const turnsX = 1 + Math.floor(Math.random() * 2), turnsY = 1 + Math.floor(Math.random() * 2);
      const nx = b[0] + 360 * (Math.round((r.x - b[0]) / 360) + turnsX * (Math.random() < 0.5 ? 1 : -1));
      const ny = b[1] + 360 * (Math.round((r.y - b[1]) / 360) + turnsY);
      r.x = nx; r.y = ny;
      const dur = 0.75 + Math.random() * 0.35;
      cube.style.transition = `transform ${dur.toFixed(2)}s cubic-bezier(.15,.65,.25,1)`;
      el.style.setProperty('--dur', `${dur.toFixed(2)}s`);
      el.classList.remove('rolling'); void el.offsetWidth; el.classList.add('rolling');
      setTimeout(() => el.classList.remove('rolling'), dur * 1000 + 50);
    } else {
      r.x = b[0] + 360 * Math.round((r.x - b[0]) / 360); r.y = b[1] + 360 * Math.round((r.y - b[1]) / 360);
      cube.style.transition = 'none';
    }
    cube.style.transform = `rotateX(${r.x}deg) rotateY(${r.y}deg)`;
    el.dataset.v = v;
    el.setAttribute('aria-label', `Die ${i + 1}: ${v}${S && S.held[i] ? ', held' : ''}`);
  }

  function render() {
    if (!S) return;
    renderPlayers();
    renderTray();
    renderCard();
    renderStatus();
  }

  function renderPlayers() {
    if (mode === 'solo') {
      const t = totals(S.cards[0]);
      const filled = S.cards[0].filter((v) => v >= 0).length;
      playersEl.innerHTML = `<div class="dp-stats"><span class="st"><i>${G.icon('dice', 17)}</i><b>${Math.min(13, filled + (S.phase === 'done' ? 0 : 1))}</b><small>/ 13</small></span><span class="st"><i class="gold">${G.icon('star', 17)}</i><b>${t.total}</b><small>points</small></span></div>`;
      return;
    }
    playersEl.innerHTML = `<div class="dp-players">${S.players.map((n, i) => `<span class="dp-pl${S.phase === 'play' && S.turn === i ? ' on' : ''}${here(S, i) ? '' : ' gone'}" style="--pc:${colorOf(i)}"><i>${esc(n.slice(0, 1).toUpperCase())}</i><b>${esc(dname(i))}</b><em>${totals(S.cards[i]).total}</em></span>`).join('')}</div>`;
  }

  function renderTray() {
    const mine = myTurn();
    trayEl.classList.toggle('idle', S.rolls === 0 && S.phase === 'play');
    trayEl.style.setProperty('--pc', colorOf(S.turn));
    diceEls.forEach((el, i) => {
      el.classList.toggle('held', !!S.held[i] && S.rolls > 0);
      el.classList.toggle('can', mine && S.rolls > 0 && S.rolls < 3);
      el.disabled = !(mine && S.rolls > 0 && S.rolls < 3);
    });
    const left = 3 - S.rolls;
    let label, sub = '';
    if (S.phase === 'done') label = 'Game over';
    else if (!mine) label = myIdx() < 0 || mode !== 'multi' ? `${S.players[S.turn]} is rolling…` : `${S.players[S.turn]} is rolling…`;
    else if (S.rolls === 0) label = 'Roll the dice!';
    else if (left > 0) { label = 'Roll again'; sub = 'or pick a score'; }
    else label = 'Pick a score below';
    rollBtn.disabled = !mine || left <= 0 || V.rolling;
    rollBtn.classList.toggle('go', mine && S.rolls === 0);
    rollBtn.innerHTML = `${G.icon('dice', 24)}<span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="dp-left" aria-label="${left} rolls left">${[0, 1, 2].map((k) => `<i class="${k < left ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  function renderCard() {
    const me = myIdx(), t = S.turn;
    const showPrev = S.phase === 'play' && S.rolls > 0 && !V.rolling;
    const cols = S.players.map((_, i) => i);
    const head = `<tr><th class="lab"></th>${cols.map((i) => `<th class="${S.phase === 'play' && i === t ? 'cur' : ''}${here(S, i) ? '' : ' gone'}" style="--pc:${colorOf(i)}"><span>${mode === 'solo' ? 'Score' : esc(dname(i).slice(0, 7))}</span></th>`).join('')}</tr>`;
    const row = (c) => {
      const C = CATS[c];
      const lab = `<th class="lab" scope="row">${C.face ? miniDie(C.face) : `<span class="dp-ic">${G.icon(C.icon, 16)}</span>`}<span>${C.label}</span></th>`;
      return `<tr class="r${c}${c === 11 ? ' party' : ''}">${lab}${cols.map((i) => {
        const v = S.cards[i][c];
        const cur = S.phase === 'play' && i === t;
        if (v >= 0) return `<td class="${cur ? 'cur ' : ''}got${V.justScored && V.justScored.p === i && V.justScored.cat === c ? ' new' : ''}">${v}</td>`;
        if (cur && showPrev) {
          const pts = scoreFor(c, S.dice);
          if (i === me) return `<td class="cur"><button type="button" class="dp-pick${pts ? '' : ' zero'}${V.armZero === c ? ' arm' : ''}" data-c="${c}" aria-label="Score ${pts} in ${C.label}">${V.armZero === c ? 'Sure? 0' : pts}</button></td>`;
          return `<td class="cur prev${pts ? '' : ' zero'}">${pts}</td>`;
        }
        return `<td class="${cur ? 'cur' : ''}"></td>`;
      }).join('')}</tr>`;
    };
    let body = '';
    for (let c = 0; c < 6; c++) body += row(c);
    body += `<tr class="sum"><th class="lab" scope="row"><span class="dp-ic">${G.icon('gift', 16)}</span><span>Bonus <small>${BONUS_AT}+ up top</small></span></th>${cols.map((i) => {
      const tt = totals(S.cards[i]);
      return `<td class="${S.phase === 'play' && i === t ? 'cur' : ''}${tt.bonus ? ' bonus' : ''}">${tt.bonus ? `+${BONUS}` : `<small>${tt.upper}/${BONUS_AT}</small>`}</td>`;
    }).join('')}</tr>`;
    for (let c = 6; c < 13; c++) body += row(c);
    body += `<tr class="total"><th class="lab" scope="row"><span class="dp-ic">${G.icon('trophy', 16)}</span><span>Total</span></th>${cols.map((i) => `<td class="${S.phase === 'play' && i === t ? 'cur' : ''}">${totals(S.cards[i]).total}</td>`).join('')}</tr>`;
    const scroll = cardEl.scrollTop;
    cardEl.innerHTML = `<table class="dp-table${cols.length > 3 ? ' many' : ''}" style="--pc:${colorOf(t)}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    cardEl.scrollTop = scroll;
  }

  function renderStatus() {
    const me = myIdx();
    let msg = '', cls = 'dp-status';
    if (S.phase === 'done') { msg = 'Game over!'; cls += ' end'; }
    else if (S.turn === me) {
      cls += ' mine';
      msg = S.rolls === 0 ? (mode === 'solo' ? 'Tap Roll to start your turn' : 'Your turn! Tap Roll') : S.rolls < 3 ? 'Tap dice to hold them, roll again or score' : 'Choose where to score';
    } else msg = `${S.players[S.turn]}’s turn`;
    statusEl.className = cls;
    statusEl.style.setProperty('--pc', colorOf(S.turn));
    statusEl.textContent = msg;
  }

  // ---------- Showing states ----------
  function show(s, local) {
    const prev = S;
    if (!V || !prev || s.gid !== V.gid) {
      V = { gid: s.gid, confirmed: s.seq, pushing: false, again: false, overShown: false, rid: s.rid, rot: [0, 1, 2, 3, 4].map(() => ({ x: 0, y: 0 })), armZero: -1, rolling: false, justScored: null };
      S = clone(s);
      S.dice.forEach((v, i) => setDie(i, v, false));
      render();
      afterShow(null);
      return;
    }
    S = clone(s);
    V.armZero = -1;
    V.justScored = null;
    const L = S.last || {};
    if (S.rid !== V.rid && L.kind === 'roll') {
      // new roll: tumble the dice that weren't held
      V.rid = S.rid;
      V.rolling = true;
      const spin = S.dice.map((v, i) => !(S.held[i] && prev.rolls > 0) || S.rolls === 1);
      S.dice.forEach((v, i) => setDie(i, v, spin[i]));
      rattle();
      render();
      const token = S.rid;
      setTimeout(() => {
        if (!V || V.rid !== token) return;
        V.rolling = false;
        G.sfx('drop');
        celebrateRoll();
        render();
      }, reduceMotion ? 0 : 1050);
    } else {
      if (S.rid !== V.rid) V.rid = S.rid;
      S.dice.forEach((v, i) => { if (Number(diceEls[i].dataset.v) !== v) setDie(i, v, false); });
      if (L.kind === 'score' && prev && prev.seq === S.seq - 1) {
        V.justScored = { p: L.p, cat: L.cat };
        G.sfx(L.pts ? (L.cat === 11 ? 'win' : 'coin') : 'drop');
        setTimeout(() => {
          const cell = cardEl.querySelector(`tr.r${L.cat} td.new`);
          if (cell) { cell.scrollIntoView({ block: 'nearest' }); const r = cell.getBoundingClientRect(), rr = root.getBoundingClientRect(); if (L.pts) burst(r.left - rr.left + r.width / 2, r.top - rr.top + r.height / 2, L.pts >= 25 ? 22 : 10, [colorOf(L.p), '#facc15', '#ffffff'], 220); }
          const tt = totals(S.cards[L.p]);
          if (L.cat < 6 && tt.bonus && totals(prev.cards[L.p]).bonus === 0) { flash('Bonus +35!'); G.sfx('match'); }
        }, 30);
      } else if (L.kind === 'hold' && !local) G.sfx('click');
      render();
    }
    afterShow(prev);
  }

  function rattle() {
    if (G.muted()) return;
    const n = 7;
    for (let k = 0; k < n; k++) setTimeout(() => G.sfx(k % 2 ? 'tick' : 'click'), 40 + k * (70 + Math.random() * 30));
    G.sfx('whoosh');
  }
  function celebrateRoll() {
    if (S.phase !== 'play') return;
    const d = S.dice, c = counts(d);
    if (Math.max(...c) === 5) { flash('Party!', true); G.sfx('win'); confetti(); }
    else if (scoreFor(10, d)) { flash('Large straight!'); G.sfx('match'); }
    else if (scoreFor(8, d)) { flash('Full house!'); G.sfx('score'); }
    else if (Math.max(...c) === 4) { flash('4 of a kind!'); G.sfx('score'); }
  }
  function flash(text, big) {
    bannerEl.textContent = text;
    bannerEl.className = `dp-banner${big ? ' big' : ''}`;
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
  }

  function afterShow(prev) {
    const me = myIdx();
    if (S.phase === 'play' && S.turn === me && me >= 0 && mode === 'multi' && (!prev || prev.turn !== me)) { G.sfx('tick'); flash('Your turn!'); }
    if (S.phase === 'done' && !V.overShown) {
      V.overShown = true;
      const gid = V.gid;
      setTimeout(() => { if (V && V.gid === gid) { G.sfx('win'); confetti(); } }, 500);
      setTimeout(() => { if (V && V.gid === gid && S && S.phase === 'done') gameEnd(); }, 1900);
    }
  }

  function gameEnd() {
    const me = myIdx();
    if (mode === 'solo') {
      const t = totals(S.cards[0]).total;
      G.gameOver({ score: t, title: t >= 250 ? 'What a party!' : t >= 180 ? 'Great game!' : 'Game over', again: () => startSolo() });
      return;
    }
    if (mode !== 'multi') return;
    const rows = S.players.map((n, i) => ({ n, i, t: totals(S.cards[i]).total })).filter((r) => here(S, r.i) || r.i === me);
    rows.sort((a, b) => b.t - a.t);
    const best = rows.length ? rows[0].t : 0;
    const winners = rows.filter((r) => r.t === best);
    const title = winners.length > 1 ? `${winners.map((w) => (w.i === me ? 'You' : w.n)).join(' & ')} tie!` : winners[0].i === me ? 'You win!' : `${winners[0].n} wins!`;
    const detail = S.players.map((n, i) => `${i === me ? 'You' : n} ${totals(S.cards[i]).total}${here(S, i) || i === me ? '' : ' (left)'}`).join(' · ');
    G.gameOver({ title, detail, score: me >= 0 ? totals(S.cards[me]).total : 0 });
  }

  // ---------- Saving moves (multiplayer) ----------
  function act(fn) {
    if (!S) return false;
    const next = fn(S);
    if (!next) return false;
    show(next, true);
    if (mode === 'multi') save();
    return true;
  }
  // Sends the latest local state; one request at a time. If someone else changed the board meanwhile, the
  // latest shared state wins and is shown.
  async function save() {
    if (V.pushing) { V.again = true; return; }
    V.pushing = true;
    const gid = V.gid;
    let tries = 0;
    try {
      do {
        V.again = false;
        const mine = S;
        let ok = false;
        try { ok = await G.turns.commit(mine, { done: mine.phase === 'done', quiet: true }); } catch (e) { ok = false; }
        if (!V || V.gid !== gid) return;
        if (ok) { V.confirmed = mine.seq; tries = 0; continue; }
        const fresh = G.turns.shared();
        if (fresh && fresh.g === 'dice' && fresh.gid === gid && fresh.seq === V.confirmed && tries++ < 3) { await sleep(150); V.again = true; continue; }   // only our copy was behind
        if (fresh && fresh.g === 'dice' && fresh.gid === gid) { V.confirmed = fresh.seq; V.again = false; S = clone(fresh); V.rid = S.rid; V.rolling = false; S.dice.forEach((v, i) => setDie(i, v, false)); render(); afterShow(null); }
        break;
      } while (V.again);
    } finally { if (V && V.gid === gid) V.pushing = false; }
  }

  function onRoll() {
    if (!myTurn() || S.rolls >= 3 || V.rolling || G.modalOpen()) { if (S && !myTurn()) nudge(); return; }
    const vals = rollValues();
    const me = myIdx();
    act((s) => doRoll(s, me, vals));
  }
  function onDie(i) {
    if (!myTurn() || S.rolls < 1 || S.rolls >= 3 || V.rolling || G.modalOpen()) return;
    G.sfx(S.held[i] ? 'click' : 'tick');
    const me = myIdx();
    act((s) => doHold(s, me, i));
  }
  function onPick(c) {
    if (!myTurn() || S.rolls < 1 || V.rolling || G.modalOpen()) return;
    const pts = scoreFor(c, S.dice);
    if (!pts && V.armZero !== c) { V.armZero = c; G.sfx('wrong'); renderCard(); return; }
    const me = myIdx();
    act((s) => doScore(s, me, c));
  }
  function nudge() { statusEl.classList.remove('shake'); void statusEl.offsetWidth; statusEl.classList.add('shake'); }

  // ---------- Particles ----------
  let parts = [], fxRunning = false, lastT = 0;
  function layoutFx() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rr = root.getBoundingClientRect();
    fx.width = Math.round(rr.width * dpr); fx.height = Math.round(rr.height * dpr);
    fx.style.width = rr.width + 'px'; fx.style.height = rr.height + 'px';
    fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function burst(x, y, n, cols, speed) {
    if (reduceMotion) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random());
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, s: 5 + Math.random() * 6, a: Math.random() * 6, va: (Math.random() - 0.5) * 12, col: cols[k % cols.length], life: 0.7 + Math.random() * 0.5, star: Math.random() < 0.4 });
    }
    if (!fxRunning) { fxRunning = true; lastT = 0; requestAnimationFrame(fxLoop); }
  }
  function confetti() {
    const rr = root.getBoundingClientRect();
    const cols = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899'];
    for (let k = 0; k < 3; k++) burst(rr.width * (0.2 + 0.3 * k), rr.height * 0.35, 45, cols, 520);
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

  // ---------- Screens ----------
  function startSolo() {
    mode = 'solo';
    presentNames = null;
    menuEl.hidden = true;
    G.closeModal();
    V = null; S = null;
    show(newGame([G.me() || 'You'], Math.floor(Math.random() * 2 ** 31)));
  }
  function showMenu() {
    mode = 'menu';
    presentNames = null;
    V = null; S = null;
    show(newGame([G.me() || 'You'], 1));
    menuEl.hidden = false;
  }

  // ---------- Family first: the shared start-screen buttons (same look in every game) ----------
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
    return '<div class="ff-actions">' +
      `<button type="button" class="ff-btn ff-family" data-ff="family">${G.icon('users', 26)}<span>Play with the family</span></button>` +
      (solo ? `<button type="button" class="ff-btn ff-solo" data-ff="solo">${G.icon(soloIcon || 'play', 19)}<span>${solo}</span></button>` : '') +
      (extra || '') + '</div>';
  }

  function build(ctx) {
    ffStyle();
    root = ctx.root;
    root.classList.add('dp-stage');
    const logo = [[5, -18, -16], [6, 10, 0], [3, -6, 16]].map(([v, rx, ry], k) => `<span class="dp-logo-die" style="--k:${k}"><span class="dp-cube" style="transform:rotateX(${BASE[v][0] + rx}deg) rotateY(${BASE[v][1] + ry}deg)">${CUBE}</span></span>`).join('');
    root.innerHTML = '<div class="dp-wrap"><div class="dp-side">' +
      '<div class="dp-top"></div><div class="dp-status" aria-live="polite"></div>' +
      '<div class="dp-tray"><div class="dp-dice"></div><div class="dp-banner" aria-live="polite"></div></div>' +
      '<button type="button" class="dp-roll"></button></div>' +
      '<div class="dp-card"></div></div>' +
      '<canvas class="dp-fx" aria-hidden="true"></canvas>' +
      '<div class="dp-menu" hidden><div class="dp-menu-card">' +
      `<div class="dp-logo" aria-hidden="true">${logo}</div>` +
      '<h2>Dice Party</h2><p>Roll five dice up to three times, keep the best ones and fill your scorecard. Five the same is a <b>Party!</b></p>' +
      ffButtons({ solo: 'Play solo', soloIcon: 'dice' }) + '</div></div>';
    playersEl = $('.dp-top', root); statusEl = $('.dp-status', root); trayEl = $('.dp-tray', root); rollBtn = $('.dp-roll', root);
    cardEl = $('.dp-card', root); menuEl = $('.dp-menu', root); bannerEl = $('.dp-banner', root);
    fx = $('.dp-fx', root); fxc = fx.getContext('2d');
    buildDice();
    rollBtn.addEventListener('click', () => { G.sfx('click'); onRoll(); });
    trayEl.addEventListener('click', (e) => { const b = e.target.closest('.dp-die'); if (b) onDie(Number(b.dataset.i)); else if (S && myTurn() && S.rolls === 0) onRoll(); });
    cardEl.addEventListener('click', (e) => { const b = e.target.closest('.dp-pick'); if (b) onPick(Number(b.dataset.c)); });
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.ff === 'family') { b.blur(); G.openLobby(); }
      else if (b.dataset.ff === 'solo') startSolo();
    });
    window.addEventListener('keydown', (e) => {
      if (mode === 'menu' || !S || G.modalOpen()) return;
      if (e.key >= '1' && e.key <= '5') { onDie(Number(e.key) - 1); return; }
      if ((e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'r') && !(e.target.closest && e.target.closest('button, a, input'))) { e.preventDefault(); onRoll(); }
    });
    new ResizeObserver(layoutFx).observe(root);
    layoutFx();
    G.on('pause', () => { /* nothing runs on its own */ });

    // People who left: skip their turn (the first person still here does it).
    setInterval(() => {
      if (mode !== 'multi' || !S || !V || V.pushing || S.phase !== 'play') return;
      const sess = G.session();
      if (!sess) return;
      presentNames = sess.players.slice();
      if (myIdx() < 0) return;
      const firstHere = S.players.find((n, i) => here(S, i));
      if (!here(S, S.turn) && firstHere === G.me()) act((s) => doGone(s));
      else renderPlayers();
    }, 1200);

    showMenu();
  }

  G.on('multiStart', (info) => {
    mode = 'multi';
    menuEl.hidden = true;
    presentNames = info.players.slice();
    V = null; S = null;
    if (info.shared && info.shared.g === 'dice') show(info.shared);
  });
  G.on('shared', (s, info) => {
    if (mode !== 'multi' || !s || s.g !== 'dice') return;
    if (info && info.players) presentNames = info.players.slice();
    if (V && S && s.gid === V.gid) {
      if (V.pushing) return;                 // our own move is saving
      if (s.seq < S.seq) return;
      if (s.seq === S.seq && JSON.stringify(s) === JSON.stringify(S)) return;
      V.confirmed = s.seq;
    }
    show(s);
  });
  G.on('multiEnd', () => showMenu());

  G.mount({
    id: 'dice', title: 'Dice Party', mode: 'turns', minPlayers: 1, maxPlayers: 6, scoreLabel: 'points',
    help: '<ul><li>On your turn, <b>roll</b> the five dice up to <b>3 times</b>. Tap a die to <b>hold</b> it (it won’t be rolled again); tap again to let it go.</li>' +
      '<li>After any roll, tap a box on your scorecard to score. The faded numbers show what each box would give. Every box is used once, so 13 turns in all.</li>' +
      '<li><b>Ones–Sixes</b>: add up the dice showing that number. Get <b>63 or more</b> up top for a <b>+35 bonus</b>.</li>' +
      '<li><b>3 / 4 of a kind</b>: add up all five dice. <b>Full house</b> (3 + 2): 25. <b>Small straight</b> (4 in a row): 30. <b>Large straight</b> (5 in a row): 40. <b>Party!</b> (all five the same): 50. <b>Chance</b>: add them all up.</li>' +
      '<li>Nothing fits? Score a 0 somewhere (tap it twice to be sure).</li>' +
      `<li>${G.icon('users', 17)} <b>Play together</b> (up to 6): take turns and watch each other roll. Highest total wins!</li>` +
      '<li>Keyboard: Space to roll, 1–5 to hold dice, Tab to a box and Enter to score.</li></ul>',
    initialShared: (players, seed) => newGame(players, seed),
    onReady: build
  });

  window.__dice = { CATS, scoreFor, totals, newGame, doRoll, doHold, doScore, doGone, state: () => (S ? clone(S) : null), mode: () => mode, me: myIdx, busy: () => !!(V && (V.pushing || V.rolling)) };
})();
