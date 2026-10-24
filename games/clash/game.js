// Color Clash: a shedding card game for 2–6 players (match the colour or the symbol, first to empty their
// hand wins). Played with the family through ChowGames turns, or as practice against 1–3 computer players
// (only when picked on the start screen).
//
// Cards are numbers 0..107 into DECK ({ c: 'r'|'y'|'g'|'b'|'w', v: '0'..'9' | 'S' skip | 'R' reverse |
// 'D' draw two | 'W' wild | 'F' wild draw four }).
// Shared state: { g:'clash', gid, seq, players, hands[[ids]], draw[ids] (top = end), pile[ids] (top = end),
//   color, turn, dir (1 = clockwise), pend (cards waiting to be drawn), pendT ('D'|'F'), drawn (the card the
//   current player just drew and may still play, or -1), vul [players on one card who didn't say Clash!],
//   phase 'play'|'done', winner, last { kind, p, ... } (the latest move, for animations) }.
// Every device sees the whole shared state, but only your own hand is ever drawn face up.
(function () {
  'use strict';

  const G = window.ChowGames;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Cards ----------
  const COLS = ['r', 'y', 'g', 'b'];
  const CN = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue', w: 'Wild' };
  const HEX = {
    r: { a: '#ff6b6b', b: '#e11d48', ink: '#be123c' },
    y: { a: '#ffd93b', b: '#f59e0b', ink: '#b45309' },
    g: { a: '#4ade80', b: '#15a34a', ink: '#15803d' },
    b: { a: '#60a5fa', b: '#2563eb', ink: '#1d4ed8' },
    w: { a: '#3b3b52', b: '#14141c', ink: '#111827' }
  };
  const DECK = (() => {
    const d = [];
    COLS.forEach((c) => { d.push({ c, v: '0' }); '123456789SRD'.split('').forEach((v) => { d.push({ c, v }); d.push({ c, v }); }); });
    for (let i = 0; i < 4; i++) d.push({ c: 'w', v: 'W' });
    for (let i = 0; i < 4; i++) d.push({ c: 'w', v: 'F' });
    return d;
  })();
  const isNum = (v) => v >= '0' && v <= '9';
  const VN = { S: 'Skip', R: 'Reverse', D: 'Draw Two', W: 'Wild', F: 'Wild Draw Four' };
  const cardName = (id) => { const k = DECK[id]; return k.c === 'w' ? VN[k.v] : `${CN[k.c]} ${isNum(k.v) ? k.v : VN[k.v]}`; };
  const ORDER = 'rygbw', VORDER = '0123456789SRDWF';
  const sortHand = (h) => h.slice().sort((a, b) => (ORDER.indexOf(DECK[a].c) - ORDER.indexOf(DECK[b].c)) || (VORDER.indexOf(DECK[a].v) - VORDER.indexOf(DECK[b].v)) || a - b);

  // Symbols drawn around (0,0), roughly 64 units tall.
  function pinwheel(r) {
    const q = (a, c) => { const a1 = a * Math.PI / 2 - Math.PI / 2, a2 = a1 + Math.PI / 2; return `<path d="M0 0L${(Math.cos(a1) * r).toFixed(1)} ${(Math.sin(a1) * r).toFixed(1)}A${r} ${r} 0 0 1 ${(Math.cos(a2) * r).toFixed(1)} ${(Math.sin(a2) * r).toFixed(1)}Z" fill="${c}"/>`; };
    return q(0, HEX.r.b) + q(1, HEX.b.b) + q(2, HEX.g.b) + q(3, HEX.y.b);
  }
  function sym(v, fill) {
    if (isNum(v)) {
      return `<text x="0" y="3" text-anchor="middle" dominant-baseline="central" font-size="56" font-weight="800" fill="${fill}">${v}</text>` +
        (v === '6' || v === '9' ? `<rect x="-13" y="27" width="26" height="5" rx="2.5" fill="${fill}"/>` : '');
    }
    if (v === 'S') return `<circle r="21" fill="none" stroke="${fill}" stroke-width="8.5"/><path d="M-14.5 14.5L14.5 -14.5" stroke="${fill}" stroke-width="8.5" stroke-linecap="round"/>`;
    if (v === 'R') {
      const arrow = `<path d="M-17 -11H5" stroke="${fill}" stroke-width="8" stroke-linecap="round"/><path d="M2 -22L20 -11L2 0Z" fill="${fill}" stroke="${fill}" stroke-width="3" stroke-linejoin="round"/>`;
      return `${arrow}<g transform="rotate(180)">${arrow}</g>`;
    }
    if (v === 'D') return `<text x="0" y="3" text-anchor="middle" dominant-baseline="central" font-size="46" font-weight="800" fill="${fill}" letter-spacing="-2">+2</text>`;
    if (v === 'W') return pinwheel(26);
    return `${pinwheel(26)}<text x="0" y="3" text-anchor="middle" dominant-baseline="central" font-size="36" font-weight="800" fill="#fff" stroke="#111827" stroke-width="6" paint-order="stroke" stroke-linejoin="round">+4</text>`;
  }
  function cornerSym(k) {
    if (k.c === 'w') return k.v === 'F' ? `<text x="0" y="2" text-anchor="middle" dominant-baseline="central" font-size="40" font-weight="800" fill="#fff">+4</text>` : pinwheel(24);
    if (k.v === 'D') return `<text x="0" y="2" text-anchor="middle" dominant-baseline="central" font-size="40" font-weight="800" fill="#fff">+2</text>`;
    return sym(k.v, '#fff');
  }
  function faceSvg(id) {
    const k = DECK[id], H = HEX[k.c], wild = k.c === 'w';
    const centre = wild
      ? `<circle r="35" fill="#fff"/><circle r="31" fill="#111827"/>${sym(k.v, HEX.w.ink)}`
      : `<circle r="34" fill="#fff"/><circle r="34" fill="none" stroke="${H.b}" stroke-opacity=".3" stroke-width="3"/><circle r="27" fill="none" stroke="${H.a}" stroke-opacity=".35" stroke-width="2"/>${sym(k.v, H.ink)}`;
    return `<svg class="cc-svg" viewBox="0 0 100 150" aria-hidden="true" focusable="false">` +
      `<rect x="1" y="1" width="98" height="148" rx="13" fill="#fff"/><rect x="6" y="6" width="88" height="138" rx="9" fill="url(#cc-g-${k.c})"/>` +
      `<path d="M6 52C30 30 62 22 94 26V15Q94 6 85 6H15Q6 6 6 15Z" fill="#fff" opacity=".13"/>` +
      `<circle cx="80" cy="128" r="22" fill="#fff" opacity=".08"/><circle cx="18" cy="110" r="9" fill="#fff" opacity=".08"/>` +
      `<g transform="translate(50 76)">${centre}</g>` +
      `<g transform="translate(19 23) scale(.34)">${cornerSym(k)}</g><g transform="translate(81 127) rotate(180) scale(.34)">${cornerSym(k)}</g></svg>`;
  }
  const BACK_SVG = '<svg class="cc-svg" viewBox="0 0 100 150" aria-hidden="true" focusable="false">' +
    '<rect x="1" y="1" width="98" height="148" rx="13" fill="#fff"/><rect x="6" y="6" width="88" height="138" rx="9" fill="url(#cc-g-back)"/>' +
    '<rect x="13" y="13" width="74" height="124" rx="7" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2"/>' +
    `<g transform="translate(50 75) rotate(-24)"><rect x="-26" y="-44" width="52" height="88" rx="26" fill="#fff" opacity=".12"/>` +
    `<circle cx="0" cy="-24" r="9" fill="${HEX.r.a}"/><circle cx="16" cy="-4" r="9" fill="${HEX.y.a}"/><circle cx="0" cy="16" r="9" fill="${HEX.g.a}"/><circle cx="-16" cy="-4" r="9" fill="${HEX.b.a}"/>` +
    '<text x="0" y="38" text-anchor="middle" font-size="13" font-weight="800" fill="#fff" letter-spacing="1">CLASH</text></g></svg>';
  const DEFS = '<svg class="cc-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
    Object.entries(HEX).map(([c, H]) => `<linearGradient id="cc-g-${c}" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="${H.a}"/><stop offset="1" stop-color="${H.b}"/></linearGradient>`).join('') +
    '<linearGradient id="cc-g-back" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs></svg>';

  // ---------- Rules (pure functions on a state; each returns a new state or null if not allowed) ----------
  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  function newGame(players, seed) {
    const rand = G.rng(seed);
    const draw = shuffle(DECK.map((_, i) => i), rand);
    const hands = players.map(() => []);
    for (let k = 0; k < 7; k++) players.forEach((_, p) => hands[p].push(draw.pop()));
    let guard = 0;
    while (!isNum(DECK[draw[draw.length - 1]].v) && guard++ < 200) draw.unshift(draw.pop());   // start on a number
    const first = draw.pop();
    return {
      g: 'clash', gid: seed >>> 0, seq: 0, players: players.slice(), hands, draw, pile: [first], color: DECK[first].c,
      turn: Math.floor(rand() * players.length), dir: 1, pend: 0, pendT: '', drawn: -1, vul: [], phase: 'play', winner: -1, last: { kind: 'start' }
    };
  }
  // Who is still here (people who leave mid-game are skipped).
  let presentNames = null;   // null = everyone (practice)
  const here = (s, i) => !presentNames || presentNames.includes(s.players[i]);
  const activeCount = (s) => s.players.filter((_, i) => here(s, i)).length;
  function nextIdx(s, from, steps) {
    const n = s.players.length;
    let t = from;
    for (let k = 0; k < steps; k++) {
      for (let j = 0; j < n; j++) { t = (t + s.dir + n) % n; if (here(s, t)) break; }
    }
    return t;
  }
  function startTurn(s, t) {
    s.turn = t;
    s.drawn = -1;
    s.vul = s.vul.filter((x) => x !== t && s.hands[x].length === 1);   // your own turn came: too late to catch you
  }
  const top = (s) => DECK[s.pile[s.pile.length - 1]];
  function legal(s, id) {
    const k = DECK[id];
    if (s.drawn >= 0 && id !== s.drawn) return false;
    if (s.pend > 0) return s.pendT === 'D' ? (k.v === 'D' || k.v === 'F') : k.v === 'F';
    if (k.c === 'w') return true;
    return k.c === s.color || k.v === top(s).v;
  }
  const rnd = (s) => G.rng(((s.gid ^ Math.imul(s.seq + 1, 2654435761)) >>> 0) || 7);
  function take(s, p, n, rand) {
    const got = [];
    for (let k = 0; k < n; k++) {
      if (!s.draw.length && s.pile.length > 1) { const t = s.pile.pop(); s.draw = shuffle(s.pile, rand); s.pile = [t]; s.last.shuffled = true; }
      if (!s.draw.length) break;
      const c = s.draw.pop();
      s.hands[p].push(c);
      got.push(c);
    }
    return got;
  }
  function doPlay(s0, p, id, color, said) {
    if (!s0 || s0.phase !== 'play' || s0.turn !== p || !s0.hands[p].includes(id) || !legal(s0, id)) return null;
    const s = clone(s0); s.seq++;
    const k = DECK[id];
    s.hands[p].splice(s.hands[p].indexOf(id), 1);
    s.pile.push(id);
    s.color = k.c === 'w' ? (COLS.includes(color) ? color : 'r') : k.c;
    s.drawn = -1;
    s.vul = s.vul.filter((x) => x !== p);
    const left = s.hands[p].length;
    if (left === 1 && !said) s.vul.push(p);
    s.last = { kind: 'play', p, card: id, said: left === 1 && !!said, skip: -1 };
    if (!left) { s.phase = 'done'; s.winner = p; s.vul = []; return s; }
    let steps = 1;
    if (k.v === 'S') steps = 2;
    else if (k.v === 'R') { if (activeCount(s) <= 2) steps = 2; else s.dir = -s.dir; }
    else if (k.v === 'D') { s.pend += 2; s.pendT = 'D'; }
    else if (k.v === 'F') { s.pend += 4; s.pendT = 'F'; }
    if (steps === 2) s.last.skip = nextIdx(s, p, 1);
    startTurn(s, nextIdx(s, p, steps));
    return s;
  }
  function doDraw(s0, p) {
    if (!s0 || s0.phase !== 'play' || s0.turn !== p || s0.drawn >= 0) return null;
    const s = clone(s0); s.seq++;
    s.last = { kind: 'draw', p, n: 0 };
    const rand = rnd(s);
    if (s.pend > 0) {
      const got = take(s, p, s.pend, rand);
      s.last.n = got.length; s.last.pen = true;
      s.pend = 0; s.pendT = '';
      startTurn(s, nextIdx(s, p, 1));
      return s;
    }
    const got = take(s, p, 1, rand);
    s.last.n = got.length;
    if (got.length && legal(s, got[0])) s.drawn = got[0];
    else startTurn(s, nextIdx(s, p, 1));
    return s;
  }
  function doKeep(s0, p) {
    if (!s0 || s0.phase !== 'play' || s0.turn !== p || s0.drawn < 0) return null;
    const s = clone(s0); s.seq++;
    s.last = { kind: 'keep', p };
    startTurn(s, nextIdx(s, p, 1));
    return s;
  }
  function doSay(s0, p) {
    if (!s0 || s0.phase !== 'play' || !s0.vul.includes(p)) return null;
    const s = clone(s0); s.seq++;
    s.vul = s.vul.filter((x) => x !== p);
    s.last = { kind: 'say', p };
    return s;
  }
  function doCatch(s0, by, target) {
    if (!s0 || s0.phase !== 'play' || by === target || !s0.vul.includes(target) || s0.hands[target].length !== 1) return null;
    const s = clone(s0); s.seq++;
    s.vul = s.vul.filter((x) => x !== target);
    s.last = { kind: 'catch', p: target, by, n: 0 };
    s.last.n = take(s, target, 2, rnd(s)).length;
    return s;
  }
  // Housekeeping for people who left: skip their turn, or end the game if only one player is left.
  function doGone(s0) {
    if (!s0 || s0.phase !== 'play') return null;
    const s = clone(s0); s.seq++;
    if (s.players.length > 1 && activeCount(s) === 1) {
      s.phase = 'done'; s.winner = s.players.findIndex((_, i) => here(s, i)); s.vul = []; s.last = { kind: 'alone', p: s.winner };
      return s;
    }
    s.last = { kind: 'gone', p: s.turn };
    startTurn(s, nextIdx(s, s.turn, 1));
    return s;
  }

  // ---------- Computer players (practice only) ----------
  const BOTS = ['Pixel', 'Gizmo', 'Bolt'];
  function botPick(s, p) {
    const hand = s.hands[p];
    const playable = hand.filter((id) => legal(s, id));
    if (!playable.length) return null;
    const nxt = nextIdx(s, p, 1);
    const danger = s.hands[nxt].length <= 2;
    let best = null, bestScore = -1e9;
    for (const id of playable) {
      const k = DECK[id];
      let sc = Math.random() * 2;
      if (k.c === s.color) sc += 3;
      if (!isNum(k.v) && k.c !== 'w') sc += danger ? 5 : 1;
      if (k.v === 'W') sc -= 3;
      if (k.v === 'F') sc -= s.pend ? -2 : (danger ? 0 : 5);
      if (isNum(k.v)) sc += Number(k.v) / 10;
      if (sc > bestScore) { bestScore = sc; best = id; }
    }
    return best;
  }
  function botColor(s, p) {
    const n = { r: 0, y: 0, g: 0, b: 0 };
    s.hands[p].forEach((id) => { const c = DECK[id].c; if (c !== 'w') n[c]++; });
    const best = COLS.slice().sort((a, b) => n[b] - n[a])[0];
    return n[best] ? best : COLS[Math.floor(Math.random() * 4)];
  }

  // ---------- View state ----------
  let root, tableEl, seatsEl, centerEl, handEl, fanEl, actionsEl, statusEl, menuEl, pickEl, fx, fxc;
  let mode = 'menu';          // menu | practice | multi
  let S = null;               // the state on screen
  let V = null;               // { gid, busy, overShown, armed, bots: count }
  let practiceBots = 1;
  const isBot = (i) => mode === 'practice' && i > 0;
  function myIdx() {
    if (!S) return -1;
    if (mode === 'practice') return 0;
    return S.players.indexOf(G.me());
  }
  const colorOf = (i) => G.colors[i % G.colors.length];
  const dispName = (i) => (i === myIdx() ? 'You' : S.players[i]);

  // ---------- Layout helpers ----------
  function seatOrder() {
    const n = S.players.length, me = myIdx();
    if (me < 0) return S.players.map((_, i) => i);
    const out = [];
    for (let j = 1; j < n; j++) out.push((me + j) % n);
    return out;
  }
  function seatPos(j, k, watching) {
    // others sit around the top of the table, left to right (clockwise after you)
    const a = watching ? Math.PI * (0.95 + (j + 0.5) * 1.1 / k) : Math.PI * (1 + (j + 1) / (k + 1));
    return { x: 50 + 41 * Math.cos(a), y: 50 + 41 * Math.sin(a) };
  }

  function sizeHand() {
    if (!S || !fanEl) return;
    const n = fanEl.children.length;
    const avail = handEl.clientWidth - 24;
    const cw = parseFloat(getComputedStyle(root).getPropertyValue('--cw')) || 84;
    let step = n > 1 ? (avail - cw) / (n - 1) : cw;
    step = Math.max(cw * 0.42, Math.min(cw * 0.72, step));
    fanEl.style.setProperty('--step', `${(step - cw).toFixed(1)}px`);
    const mid = (n - 1) / 2, rot = Math.min(4, 26 / Math.max(1, n));
    Array.from(fanEl.children).forEach((el, i) => {
      const o = i - mid;
      el.style.setProperty('--r', `${(o * rot).toFixed(2)}deg`);
      el.style.setProperty('--y', `${(Math.abs(o) * Math.abs(o) * 0.9 * (rot / 4)).toFixed(1)}px`);
    });
  }

  // ---------- Rendering ----------
  function render() {
    if (!S) return;
    renderSeats();
    renderCenter();
    renderHand();
    renderActions();
    renderStatus();
  }

  function backsHtml(n) {
    const k = Math.min(n, 8);
    let h = '';
    for (let i = 0; i < k; i++) h += `<i style="--i:${(i - (k - 1) / 2).toFixed(1)}"></i>`;
    return h;
  }
  function renderSeats() {
    const me = myIdx(), order = seatOrder(), watching = me < 0;
    const bubbles = V.bubbles || {};
    let html = order.map((i, j) => {
      const p = seatPos(j, order.length, watching);
      const on = S.phase === 'play' && S.turn === i, gone = !here(S, i);
      const n = S.hands[i].length;
      const av = isBot(i) ? G.icon('cpu', 22) : esc((S.players[i] || '?').slice(0, 1).toUpperCase());
      return `<div class="cc-seat${on ? ' on' : ''}${gone ? ' gone' : ''}${S.vul.includes(i) ? ' vul' : ''}${S.winner === i ? ' won' : ''}" data-p="${i}" style="left:${p.x.toFixed(1)}%;top:${p.y.toFixed(1)}%;--pc:${colorOf(i)}">` +
        `<div class="cc-backs" aria-hidden="true">${backsHtml(n)}</div>` +
        `<div class="cc-av">${av}<span class="cc-cnt">${n}</span></div>` +
        `<b>${esc(S.players[i])}</b>${gone ? '<small>left</small>' : ''}` +
        (bubbles[i] ? `<span class="cc-bubble ${bubbles[i].cls || ''}">${esc(bubbles[i].text)}</span>` : '') + '</div>';
    }).join('');
    if (me >= 0) {
      const on = S.phase === 'play' && S.turn === me;
      html += `<div class="cc-seat cc-mine${on ? ' on' : ''}${S.vul.includes(me) ? ' vul' : ''}" data-p="${me}" style="--pc:${colorOf(me)}"><div class="cc-av">${esc((S.players[me] || 'Y').slice(0, 1).toUpperCase())}</div><b>You</b>` +
        (bubbles[me] ? `<span class="cc-bubble ${bubbles[me].cls || ''}">${esc(bubbles[me].text)}</span>` : '') + '</div>';
    }
    seatsEl.innerHTML = html;
  }

  function renderCenter() {
    const me = myIdx();
    const myTurn = S.phase === 'play' && S.turn === me && me >= 0;
    const pile = S.pile.slice(-3);
    const topId = pile[pile.length - 1];
    const tilt = (id, i) => (((id * 37) % 21) - 10) * (i === pile.length - 1 ? 0.6 : 1.3);
    const H = HEX[S.color];
    const canPlay = myTurn && S.hands[me].some((id) => legal(S, id));
    centerEl.style.setProperty('--cc', H.b);
    centerEl.querySelector('.cc-ring').classList.toggle('ccw', S.dir < 0);
    centerEl.querySelector('.cc-draw').innerHTML = `<span class="cc-stack" aria-hidden="true"><i></i><i></i></span><span class="cc-card cc-back">${BACK_SVG}</span>` +
      `<span class="cc-left">${S.draw.length}</span>`;
    const drawBtn = centerEl.querySelector('.cc-draw');
    drawBtn.classList.toggle('hint', myTurn && S.drawn < 0 && (!canPlay || S.pend > 0));
    drawBtn.disabled = !myTurn || S.drawn >= 0;
    drawBtn.setAttribute('aria-label', S.pend > 0 ? `Take ${S.pend} cards` : `Draw a card (${S.draw.length} left)`);
    centerEl.querySelector('.cc-pile').innerHTML = pile.map((id, i) => `<span class="cc-card${i === pile.length - 1 ? ' cc-top' : ''}" data-id="${id}" style="--t:${tilt(id, i).toFixed(1)}deg">${faceSvg(id)}</span>`).join('');
    centerEl.querySelector('.cc-pile').setAttribute('aria-label', `Top card: ${cardName(topId)}${DECK[topId].c === 'w' ? `, colour ${CN[S.color]}` : ''}`);
    const chip = centerEl.querySelector('.cc-color');
    chip.innerHTML = `<i style="background:${H.b}"></i>${CN[S.color]}`;
    const pend = centerEl.querySelector('.cc-pend');
    pend.textContent = S.pend ? `+${S.pend}` : '';
    pend.hidden = !S.pend;
  }

  function renderHand() {
    const me = myIdx();
    if (me < 0) {
      fanEl.innerHTML = '';
      handEl.classList.add('watch');
      handEl.classList.remove('my-turn');
      handEl.dataset.msg = S.phase === 'done' ? '' : 'You’re watching this game';
      return;
    }
    handEl.classList.remove('watch');
    const myTurn = S.phase === 'play' && S.turn === me;
    const hand = sortHand(S.hands[me]);
    const fresh = V.freshIds || [];
    fanEl.innerHTML = hand.map((id) => {
      const ok = myTurn && legal(S, id);
      return `<button type="button" class="cc-card cc-hc${ok ? ' ok' : ''}${myTurn && !ok ? ' no' : ''}${S.drawn === id ? ' drawn' : ''}${fresh.includes(id) ? ' fresh' : ''}" data-id="${id}" aria-label="${esc(cardName(id))}${ok ? ', can play' : ''}">${faceSvg(id)}</button>`;
    }).join('');
    handEl.classList.toggle('my-turn', myTurn);
    sizeHand();
  }

  function renderActions() {
    const me = myIdx();
    let html = '';
    if (me >= 0 && S.phase === 'play') {
      const n = S.hands[me].length, myTurn = S.turn === me;
      const canArm = myTurn && n === 2 && S.hands[me].some((id) => legal(S, id));
      if (S.vul.includes(me)) html += `<button type="button" class="cc-act clash late" data-a="clash">${G.icon('zap', 24)}<span>Clash!</span></button>`;
      else if (canArm) html += `<button type="button" class="cc-act clash${V.armed ? ' armed' : ''}" data-a="clash" aria-pressed="${V.armed ? 'true' : 'false'}">${G.icon(V.armed ? 'check' : 'zap', 24)}<span>${V.armed ? 'Clash! said' : 'Clash!'}</span></button>`;
      const target = S.vul.find((x) => x !== me);
      if (target != null) html += `<button type="button" class="cc-act catch" data-a="catch" data-t="${target}">${G.icon('eye', 22)}<span>Caught you, ${esc(S.players[target])}!</span></button>`;
      if (myTurn && S.drawn >= 0) html += `<button type="button" class="cc-act keep" data-a="keep">${G.icon('check', 20)}<span>Keep it</span></button>`;
    }
    actionsEl.innerHTML = html;
  }

  function renderStatus() {
    const me = myIdx();
    let msg = '', cls = 'cc-status';
    if (S.phase === 'done') {
      msg = S.winner === me ? 'You win!' : `${S.players[S.winner]} wins!`;
      cls += ' end';
    } else if (S.turn === me) {
      cls += ' mine';
      if (S.pend > 0) msg = S.pendT === 'D' ? `Stack a Draw Two, or tap the deck to take ${S.pend}` : `Stack a Wild Draw Four, or take ${S.pend}`;
      else if (S.drawn >= 0) msg = 'Play the card you drew, or keep it';
      else if (S.hands[me].some((id) => legal(S, id))) msg = `Your turn: match ${CN[S.color]} or ${symWord(top(S).v)}`;
      else msg = 'No match: tap the deck to draw';
    } else {
      msg = isBot(S.turn) ? `${S.players[S.turn]} is thinking…` : `Waiting for ${S.players[S.turn]}…`;
    }
    statusEl.className = cls;
    statusEl.style.setProperty('--pc', colorOf(S.turn));
    statusEl.textContent = msg;
  }
  function symWord(v) { return isNum(v) ? `a ${v}` : v === 'W' || v === 'F' ? 'a wild' : `a ${VN[v]}`; }

  // ---------- Animations ----------
  function fly(from, to, html, { dur = 420, delay = 0, rot = 0, flip = false } = {}) {
    if (reduceMotion || !from || !to) return Promise.resolve();
    const el = document.createElement('div');
    el.className = 'cc-fly';
    el.innerHTML = html;
    Object.assign(el.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
    document.body.appendChild(el);
    const sx = from.width / to.width, dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const lift = Math.min(90, Math.abs(dx) * 0.25 + 30);
    const a = el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}) rotate(0deg)${flip ? ' rotateY(90deg)' : ''}`, opacity: delay ? 0 : 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(${(sx + 1) / 2 * 1.08}) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(0, 0) scale(1) rotate(${rot}deg)`, opacity: 1 }
    ], { duration: dur, delay, easing: 'cubic-bezier(.3,.7,.35,1)', fill: 'both' });
    return a.finished.then(() => el.remove(), () => el.remove());
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  function seatEl(p) { return seatsEl.querySelector(`.cc-seat[data-p="${p}"] .cc-av`) || seatsEl.querySelector(`.cc-seat[data-p="${p}"]`); }
  function bubble(p, text, cls, ms) {
    V.bubbles = V.bubbles || {};
    const token = Math.random();
    V.bubbles[p] = { text, cls, token };
    renderSeats();
    setTimeout(() => { if (V && V.bubbles && V.bubbles[p] && V.bubbles[p].token === token) { delete V.bubbles[p]; if (S) renderSeats(); } }, ms || 1700);
  }
  function popEl(el, cls) { if (!el || reduceMotion) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  // Shows a new state; animates the latest move if it is the next one after what we were showing.
  function show(s, local) {
    const prev = S;
    const fresh = !V || !prev || s.gid !== V.gid;
    if (fresh) {
      V = { gid: s.gid, busy: false, overShown: false, armed: false, bots: practiceBots, bubbles: {} };
      S = clone(s);
      V.freshIds = S.hands[myIdx()] ? S.hands[myIdx()].slice() : [];
      render();
      V.freshIds = [];
      dealAnimation();
      afterShow(null);
      return;
    }
    const step = s.seq === prev.seq + 1;
    const L = s.last || {};
    const me = myIdx();
    // capture where things fly from before the board changes
    let from = null;
    if (step && L.kind === 'play') {
      from = L.p === me ? rectOf(fanEl.querySelector(`.cc-card[data-id="${L.card}"]`)) : null;
      if (!from) from = rectOf(seatEl(L.p));
    }
    const drawRect = rectOf(centerEl.querySelector('.cc-draw .cc-back'));
    const newIds = me >= 0 ? s.hands[me].filter((id) => !prev.hands[me].includes(id)) : [];
    if (s.hands[me] && s.hands[me].length !== (prev.hands[me] || []).length) V.armed = V.armed && s.hands[me].length === 2;
    if (s.turn !== prev.turn) V.armed = false;
    S = clone(s);
    V.freshIds = step ? newIds : [];
    render();
    V.freshIds = [];
    if (!step) { afterShow(prev); return; }

    if (L.kind === 'play') {
      const topEl = centerEl.querySelector('.cc-pile .cc-top');
      const k = DECK[L.card];
      if (topEl && from) {
        topEl.style.visibility = 'hidden';
        G.sfx('whoosh');
        fly(from, topEl.getBoundingClientRect(), faceSvg(L.card), { dur: 430, rot: parseFloat(topEl.style.getPropertyValue('--t')) || 0 }).then(() => {
          topEl.style.visibility = '';
          popEl(topEl, 'land');
          landFx(topEl, k);
        });
      } else landFx(topEl, k);
      if (L.said) setTimeout(() => { bubble(L.p, 'Clash!', 'loud'); G.sfx('point'); }, 250);
      if (L.skip >= 0) setTimeout(() => bubble(L.skip, 'Skipped!', 'skip', 1500), 450);
      if (k.v === 'R' && L.skip < 0) popEl(centerEl.querySelector('.cc-ring'), 'flash');
    } else if (L.kind === 'draw' || L.kind === 'catch') {
      const n = L.n || 0;
      if (L.kind === 'catch') { bubble(L.by, 'Caught you!', 'loud'); G.sfx(L.p === me ? 'wrong' : 'coin'); }
      if (L.p === me) {
        newIds.forEach((id, i) => {
          const el = fanEl.querySelector(`.cc-card[data-id="${id}"]`);
          if (!el) return;
          el.classList.add('incoming');
          fly(drawRect, el.getBoundingClientRect(), BACK_SVG, { dur: 380, delay: i * 140 }).then(() => { el.classList.remove('incoming'); popEl(el, 'reveal'); G.sfx('flip'); });
        });
      } else {
        const to = rectOf(seatEl(L.p));
        if (to) {
          const box = { left: to.left + to.width / 2 - 14, top: to.top + to.height / 2 - 21, width: 28, height: 42 };
          for (let i = 0; i < Math.min(n, 6); i++) fly(drawRect, box, BACK_SVG, { dur: 380, delay: i * 120 }).then(() => G.sfx('drop'));
        }
      }
      if (L.pen) bubble(L.p, `+${n}`, 'pen', 1500);
      if (!n || reduceMotion) G.sfx('drop');
    } else if (L.kind === 'say') {
      bubble(L.p, 'Clash!', 'loud'); G.sfx('point');
    } else if (L.kind === 'keep') {
      G.sfx('click');
    }
    afterShow(prev);
  }

  function landFx(topEl, k) {
    if (!topEl) return;
    G.sfx(k.v === 'D' || k.v === 'F' ? 'hit' : k.c === 'w' ? 'match' : 'drop');
    const r = topEl.getBoundingClientRect(), rr = root.getBoundingClientRect();
    const cols = k.c === 'w' ? [HEX.r.b, HEX.y.b, HEX.g.b, HEX.b.b] : [HEX[k.c].a, HEX[k.c].b, '#ffffff'];
    burst(r.left - rr.left + r.width / 2, r.top - rr.top + r.height / 2, k.c === 'w' || !isNum(k.v) ? 22 : 10, cols, k.c === 'w' ? 300 : 200);
  }

  function dealAnimation() {
    if (reduceMotion) return;
    G.sfx('whoosh');
    Array.from(fanEl.children).forEach((el, i) => { el.style.setProperty('--d', `${(i * 0.06).toFixed(2)}s`); el.classList.add('deal'); setTimeout(() => el.classList.remove('deal'), 900 + i * 60); });
  }

  function afterShow(prev) {
    const me = myIdx();
    if (S.phase === 'play' && S.turn === me && me >= 0 && (!prev || prev.turn !== me || prev.phase !== 'play')) { G.sfx('tick'); popEl(statusEl, 'pop'); }
    if (S.phase === 'done' && !V.overShown) {
      V.overShown = true;
      const gid = V.gid;
      setTimeout(() => { if (!V || V.gid !== gid) return; G.sfx(S.winner === me ? 'win' : 'lose'); if (S.winner === me) confetti(); }, 650);
      setTimeout(() => { if (V && V.gid === gid && S && S.phase === 'done') gameEnd(); }, 2100);
    }
    if (mode === 'practice') scheduleBots();
  }

  function gameEnd() {
    const me = myIdx();
    const iWon = S.winner === me;
    const title = iWon ? 'You win!' : `${S.players[S.winner]} wins!`;
    const left = S.players.map((n, i) => (i === S.winner ? null : `${i === me ? 'You' : n} ${S.hands[i].length}`)).filter(Boolean).join(' · ');
    const detail = S.last && S.last.kind === 'alone' ? 'Everyone else left the game.' : `Cards left: ${left}`;
    if (mode === 'multi') { G.gameOver({ title: iWon ? `You win!` : title, detail, score: iWon ? 1 : 0 }); return; }
    if (mode !== 'practice') return;
    const card = G.modal(`<div class="cg-hero ${iWon ? 'gold' : ''}">${G.icon(iWon ? 'trophy' : 'cpu', 28)}</div><h2>${esc(title)}</h2><p class="cg-sub">${esc(detail)}</p>` +
      '<p class="cg-hint">Practice games don’t count on the family leaderboard. Play with the family to earn wins!</p>' +
      `<div class="cg-row col"><button type="button" class="primary" data-a="again">${G.icon('again', 18)} Play again</button><button type="button" data-a="family">${G.icon('users', 18)} Play with the family</button><button type="button" data-a="menu">Menu</button></div>`, { sticky: true });
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      G.closeModal();
      if (b.dataset.a === 'again') startPractice(practiceBots);
      else if (b.dataset.a === 'family') { showMenu(); G.openLobby(); }
      else showMenu();
    });
  }

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
    const cols = [HEX.r.b, HEX.y.a, HEX.g.b, HEX.b.b, '#a855f7', '#ffffff'];
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

  // ---------- Moves ----------
  // act(fn): fn(state) -> new state (or null if not allowed). Shows it at once, then saves it. If someone
  // moved first, the move is tried again on the latest board; if it no longer makes sense, the latest board
  // is shown instead.
  async function act(fn) {
    if (!S || !V) return false;
    if (mode === 'multi' && V.busy) return false;
    let next = fn(S);
    if (!next) return false;
    show(next, true);
    if (mode !== 'multi') return true;
    V.busy = true;
    const gid = V.gid;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try { ok = await G.turns.commit(next, { done: next.phase === 'done', quiet: true }); } catch (e) { ok = false; }
      if (ok) break;
      const fresh = G.turns.shared();
      if (!fresh || fresh.g !== 'clash' || fresh.gid !== gid || !V || V.gid !== gid) break;
      if (fresh.seq === next.seq - 1) { await sleep(120); continue; }   // our copy was just a poll behind
      const again = fn(fresh);
      if (!again) { S = clone(fresh); render(); afterShow(null); break; }
      next = again;
      S = clone(fresh);
      show(next, true);
    }
    if (V && V.gid === gid) V.busy = false;
    if (!ok) { const fresh = G.turns.shared(); if (fresh && fresh.g === 'clash' && V && fresh.gid === V.gid && fresh.seq !== S.seq) { S = clone(fresh); render(); afterShow(null); } }
    return ok;
  }

  function nudge(el) { popEl(el || statusEl, 'shake'); }
  function onCardTap(id, el) {
    if (!S || G.modalOpen() || !pickEl.hidden) return;
    const me = myIdx();
    if (me < 0 || S.phase !== 'play') return;
    if (S.turn !== me) { G.sfx('wrong'); nudge(); return; }
    if (!legal(S, id)) {
      G.sfx('wrong');
      nudge(el);
      G.toast(S.pend > 0 ? (S.pendT === 'D' ? `Stack a Draw Two, or tap the deck to take ${S.pend}` : `Only a Wild Draw Four can be stacked. Tap the deck to take ${S.pend}`)
        : S.drawn >= 0 ? 'You can only play the card you just drew (or keep it)' : `That doesn’t match. Play ${CN[S.color]} or ${symWord(top(S).v)}`);
      return;
    }
    G.sfx('click');
    if (DECK[id].c === 'w') openPicker(id);
    else playCard(id, null);
  }
  function playCard(id, color) {
    const me = myIdx();
    const said = V.armed && S.hands[me].length === 2;
    V.armed = false;
    act((s) => doPlay(s, me, id, color, said));
  }
  function onDraw() {
    if (!S || G.modalOpen() || !pickEl.hidden) return;
    const me = myIdx();
    if (me < 0 || S.phase !== 'play' || S.turn !== me) { nudge(); return; }
    if (S.drawn >= 0) { G.toast('Play the card you drew, or keep it'); return; }
    act((s) => doDraw(s, me));
  }
  function onAction(a, t) {
    const me = myIdx();
    if (!S || me < 0) return;
    if (a === 'keep') act((s) => doKeep(s, me));
    else if (a === 'catch') { G.sfx('click'); act((s) => doCatch(s, me, Number(t))); }
    else if (a === 'clash') {
      if (S.vul.includes(me)) { act((s) => doSay(s, me)); return; }
      V.armed = !V.armed;
      if (V.armed) { bubble(me, 'Clash!', 'loud'); G.sfx('point'); } else G.sfx('click');
      renderActions();
    }
  }

  // ---------- Colour picker ----------
  let pickCard = -1;
  function openPicker(id) {
    pickCard = id;
    pickEl.hidden = false;
    pickEl.querySelector('.cc-pick-card').innerHTML = `<span class="cc-card">${faceSvg(id)}</span>`;
    G.sfx('flip');
    setTimeout(() => { const b = pickEl.querySelector('[data-c]'); if (b) b.focus(); }, 30);
  }
  function closePicker() { pickEl.hidden = true; pickCard = -1; }

  // ---------- Practice: computer players ----------
  let botTimer = null, catchTimer = null, catchFor = '';
  function scheduleBots() {
    clearTimeout(botTimer);
    if (mode !== 'practice' || !S || S.phase !== 'play') return;
    const seq = S.seq;
    // a computer player may catch you if you forgot to say Clash!
    const key = `${V.gid}:${S.vul.includes(0) ? S.hands[0].join(',') : ''}`;
    if (S.vul.includes(0) && catchFor !== key) {
      catchFor = key;
      clearTimeout(catchTimer);
      if (Math.random() < 0.8) {
        const by = 1 + Math.floor(Math.random() * (S.players.length - 1));
        catchTimer = setTimeout(() => { if (mode === 'practice' && S && S.vul.includes(0)) act((s) => doCatch(s, by, 0)); }, 1500 + Math.random() * 1500);
      }
    }
    if (!isBot(S.turn)) return;
    botTimer = setTimeout(() => {
      if (mode !== 'practice' || !S || S.seq !== seq || G.modalOpen()) { if (mode === 'practice' && S && S.seq === seq) scheduleBots(); return; }
      const p = S.turn;
      if (S.drawn >= 0) {
        if (Math.random() < 0.9) act((s) => doPlay(s, p, s.drawn, botColor(s, p), Math.random() < 0.8));
        else act((s) => doKeep(s, p));
        return;
      }
      const id = botPick(S, p);
      if (id == null) { act((s) => doDraw(s, p)); return; }
      const said = S.hands[p].length === 2 && Math.random() < 0.75;
      act((s) => { const h = s.hands[p].filter((x) => x !== id); return doPlay(s, p, id, botColor(Object.assign({}, s, { hands: s.hands.map((hh, i) => (i === p ? h : hh)) }), p), said); });
    }, 850 + Math.random() * 650);
  }

  // ---------- Screens ----------
  function startPractice(n) {
    practiceBots = Math.max(1, Math.min(3, n));
    mode = 'practice';
    presentNames = null;
    menuEl.hidden = true;
    G.closeModal();
    closePicker();
    V = null; S = null;
    const players = [G.me() || 'You'].concat(BOTS.slice(0, practiceBots));
    const s = newGame(players, Math.floor(Math.random() * 2 ** 31));
    show(s);
  }

  function showMenu() {
    mode = 'menu';
    clearTimeout(botTimer); clearTimeout(catchTimer);
    presentNames = null;
    closePicker();
    // a friendly table in the background
    V = null; S = null;
    show(newGame([G.me() || 'You', 'Pixel', 'Gizmo'], 12345));
    statusEl.textContent = ''; statusEl.className = 'cc-status';
    actionsEl.innerHTML = '';
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
    root.classList.add('cc-stage');
    const logo = [{ id: 7, r: -14, x: -34 }, { id: 104, r: 0, x: 0 }, { id: 81, r: 14, x: 34 }].map((c) => `<span class="cc-card" style="--lr:${c.r}deg;--lx:${c.x}px">${faceSvg(c.id)}</span>`).join('');
    root.innerHTML = DEFS +
      '<div class="cc-wrap">' +
      '<div class="cc-table"><div class="cc-felt"></div>' +
      '<div class="cc-center"><svg class="cc-ring" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="58 34" stroke-linecap="round"/>' +
      [0, 1, 2, 3].map((k) => `<path transform="rotate(${k * 90 + 18} 100 100)" d="M100 4l11 8-11 8z" fill="currentColor"/>`).join('') + '</svg>' +
      '<button type="button" class="cc-draw" aria-label="Draw a card"></button><div class="cc-pile" role="img"></div>' +
      '<span class="cc-pend" hidden></span><span class="cc-color"></span></div>' +
      '<div class="cc-seats"></div></div>' +
      '<div class="cc-status" aria-live="polite"></div>' +
      '<div class="cc-actions"></div>' +
      '<div class="cc-hand"><div class="cc-fan"></div></div>' +
      '</div>' +
      '<canvas class="cc-fx" aria-hidden="true"></canvas>' +
      `<div class="cc-pick" hidden><div class="cc-pick-box" role="dialog" aria-label="Pick a colour"><div class="cc-pick-card"></div><h3>Pick a colour</h3><div class="cc-pick-grid">${COLS.map((c, i) => `<button type="button" data-c="${c}" style="--a:${HEX[c].a};--b:${HEX[c].b}"><b>${CN[c]}</b><small>${i + 1}</small></button>`).join('')}</div><button type="button" class="cc-pick-cancel" data-c="">${G.icon('close', 18)} Cancel</button></div></div>` +
      '<div class="cc-menu" hidden><div class="cc-menu-card">' +
      `<div class="cc-logo" aria-hidden="true">${logo}</div>` +
      '<h2>Color Clash</h2><p>Match the colour or the symbol. Empty your hand first, and don’t forget to shout <b>Clash!</b></p>' +
      ffButtons({ extra: `<button type="button" class="ff-btn ff-solo" data-a="cpu" aria-expanded="false">${G.icon('cpu', 19)}<span>Practice vs computer</span></button>` }) +
      `<div class="cc-cpu" hidden><h3>How many computer players?</h3><div class="cc-cpu-n">${[1, 2, 3].map((n) => `<button type="button" data-bots="${n}"><span>${G.icon('cpu', 18).repeat(n)}</span><b>${n}</b></button>`).join('')}</div><p class="cg-hint">Practice games don’t count on the leaderboard.</p></div>` +
      '</div></div>';
    tableEl = $('.cc-table', root); seatsEl = $('.cc-seats', root); centerEl = $('.cc-center', root);
    handEl = $('.cc-hand', root); fanEl = $('.cc-fan', root); actionsEl = $('.cc-actions', root); statusEl = $('.cc-status', root);
    menuEl = $('.cc-menu', root); pickEl = $('.cc-pick', root);
    fx = $('.cc-fx', root); fxc = fx.getContext('2d');

    handEl.addEventListener('scroll', () => { if (handEl.scrollTop) handEl.scrollTop = 0; }, { passive: true });   // the strip only scrolls sideways
    fanEl.addEventListener('click', (e) => { const b = e.target.closest('.cc-card'); if (b) onCardTap(Number(b.dataset.id), b); });
    centerEl.querySelector('.cc-draw').addEventListener('click', onDraw);
    centerEl.addEventListener('click', (e) => { if (e.target.closest('.cc-draw')) return; if (e.target.closest('.cc-pile') && S && S.turn === myIdx()) nudge(); });
    actionsEl.addEventListener('click', (e) => { const b = e.target.closest('button[data-a]'); if (b) onAction(b.dataset.a, b.dataset.t); });
    pickEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-c]');
      if (!b && e.target !== pickEl) return;
      const c = b ? b.dataset.c : '';
      const id = pickCard;
      closePicker();
      if (c && id >= 0) { G.sfx('click'); playCard(id, c); }
    });
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      G.sfx('click');
      if (b.dataset.ff === 'family') { b.blur(); G.openLobby(); }
      else if (b.dataset.a === 'cpu') { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); menuEl.querySelector('.cc-cpu').hidden = !open; }
      else if (b.dataset.bots) startPractice(Number(b.dataset.bots));
    });
    window.addEventListener('keydown', (e) => {
      if (mode === 'menu' || !S || G.modalOpen()) return;
      if (!pickEl.hidden) {
        const c = { 1: 'r', 2: 'y', 3: 'g', 4: 'b', r: 'r', y: 'y', g: 'g', b: 'b' }[e.key.toLowerCase()];
        if (c) { const id = pickCard; closePicker(); playCard(id, c); }
        else if (e.key === 'Escape') closePicker();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'd') { e.preventDefault(); onDraw(); }
      else if (k === 'c' && actionsEl.querySelector('[data-a="clash"]')) onAction('clash');
      else if (k === 'k' && actionsEl.querySelector('[data-a="keep"]')) onAction('keep');
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const cards = Array.from(fanEl.children);
        if (!cards.length) return;
        e.preventDefault();
        const i = cards.indexOf(document.activeElement);
        const j = i < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)));
        cards[j].focus();
        cards[j].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
    new ResizeObserver(() => { layoutFx(); sizeHand(); }).observe(root);
    layoutFx();

    // People who left: skip their turn (the first person still here does it), end the game if alone.
    setInterval(() => {
      if (mode !== 'multi' || !S || !V || V.busy || S.phase !== 'play') return;
      const sess = G.session();
      if (!sess) return;
      presentNames = sess.players.slice();
      const me = myIdx();
      if (me < 0) return;
      const firstHere = S.players.find((n, i) => here(S, i));
      const gone = !here(S, S.turn) || (S.players.length > 1 && activeCount(S) === 1);
      if (gone && firstHere === G.me()) act((s) => doGone(s));
      else renderSeats();
    }, 1200);

    showMenu();
  }

  G.on('multiStart', (info) => {
    mode = 'multi';
    clearTimeout(botTimer); clearTimeout(catchTimer);
    menuEl.hidden = true;
    closePicker();
    presentNames = info.players.slice();
    V = null; S = null;
    if (info.shared && info.shared.g === 'clash') show(info.shared);
  });
  G.on('shared', (s, info) => {
    if (mode !== 'multi' || !s || s.g !== 'clash') return;
    if (info && info.players) presentNames = info.players.slice();
    if (V && V.busy && s.gid === V.gid) return;          // our own move is saving; act() sorts it out
    if (S && V && s.gid === V.gid) {
      if (s.seq < S.seq) return;
      if (s.seq === S.seq && JSON.stringify(s) === JSON.stringify(S)) return;
    }
    if (S && V && s.gid === V.gid && s.seq !== S.seq + 1) { S = clone(s); render(); afterShow(null); return; }
    show(s);
  });
  G.on('multiEnd', () => showMenu());

  G.mount({
    id: 'clash', title: 'Color Clash', mode: 'turns', minPlayers: 2, maxPlayers: 6, scoreLabel: 'wins',
    help: '<ul><li>Everyone gets <b>7 cards</b>. On your turn, play a card that matches the top card’s <b>colour</b> or its <b>number or symbol</b>.</li>' +
      '<li>Can’t (or don’t want to)? Tap the deck to draw one. If it fits you can play it straight away, or keep it.</li>' +
      '<li><b>Skip</b>: the next player misses a turn. <b>Reverse</b>: change direction (with two players it works like Skip).</li>' +
      '<li><b>Draw Two</b>: the next player takes 2 and misses their turn – unless they <b>stack</b> another Draw Two (or a Wild Draw Four) to pass it on, bigger!</li>' +
      '<li><b>Wild</b>: pick the colour. <b>Wild Draw Four</b>: pick the colour and the next player takes 4 (only another Wild Draw Four can stack on it).</li>' +
      '<li>Down to your last card? Tap <b>Clash!</b> before (or right after) you play your second-to-last card. Forget, and anyone can tap <b>Caught you!</b> before your next turn – you draw 2.</li>' +
      '<li>First to empty their hand wins!</li>' +
      '<li>Keyboard: Tab or arrows to pick a card, Enter to play, D to draw, C for Clash!, K to keep. In the colour picker press 1–4.</li></ul>',
    initialShared: (players, seed) => newGame(players, seed),
    onReady: build
  });

  window.__clash = {
    DECK, faceSvg, BACK_SVG, legal, newGame, doPlay, doDraw, doKeep, doSay, doCatch, doGone, cardName,
    state: () => (S ? clone(S) : null), mode: () => mode, me: myIdx, busy: () => !!(V && V.busy), armed: () => !!(V && V.armed),
    setPresent: (p) => { presentNames = p; },
    inject: (s) => show(s)
  };
})();
