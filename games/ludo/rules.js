// Race Home rules (a Ludo-style race game) and the computer player. No DOM here, so Node tests can load it
// too: window.RaceHomeRules in the browser, module.exports in Node.
//
// The board is a 15×15 grid. Colours: 0 Red (top-left yard), 1 Green (top-right), 2 Yellow (bottom-right),
// 3 Blue (bottom-left); everyone travels clockwise. A token's progress p: -1 = in the yard, 0..50 = on the
// shared track (p steps past its colour's start square), 51..55 = its colour's home column, 56 = home.
(function (root) {
  'use strict';

  const HOME = 56;
  const TRACK_LEN = 52;
  // The shared track as [x, y] cells, starting from Red's start square and going clockwise.
  const TRACK = [
    [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
    [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
    [7, 0],
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
    [14, 7],
    [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
    [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
    [7, 14],
    [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    [0, 7],
    [0, 6]
  ];
  const START = [0, 13, 26, 39];
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);   // the start squares and the stars
  const HOME_COL = [
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]]
  ];
  const YARD_ORIGIN = [[0, 0], [9, 0], [9, 9], [0, 9]];
  const NAMES = ['Red', 'Green', 'Yellow', 'Blue'];
  // Which colours play for 2, 3 or 4 players (2 players sit opposite each other).
  const SEATS = { 1: [0], 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

  const trackIndex = (color, p) => (p >= 0 && p <= 50 ? (START[color] + p) % TRACK_LEN : -1);

  // Where a token is, in grid units (the centre of its cell, or its yard spot / home triangle).
  function tokenCell(color, p, t) {
    if (p < 0) {
      const [ox, oy] = YARD_ORIGIN[color];
      return [ox + (t % 2 ? 4.1 : 1.9), oy + (t < 2 ? 1.9 : 4.1)];
    }
    if (p <= 50) { const [x, y] = TRACK[trackIndex(color, p)]; return [x + 0.5, y + 0.5]; }
    if (p < HOME) { const [x, y] = HOME_COL[color][p - 51]; return [x + 0.5, y + 0.5]; }
    const c = [[6.55, 7.5], [7.5, 6.55], [8.45, 7.5], [7.5, 8.45]][color];
    return c.slice();
  }

  function newGame(players, gid, bots) {
    const n = Math.max(1, Math.min(4, players.length));
    const colors = SEATS[n].slice();
    return {
      v: 1, gid: gid || 1, seq: 0,
      players: players.slice(0, 4), bots: players.slice(0, 4).map((_, i) => !!(bots && bots[i])), colors,
      tokens: players.slice(0, 4).map(() => [-1, -1, -1, -1]), out: players.slice(0, 4).map(() => false),
      turn: 0, phase: 'roll', die: null, sixes: 0, roll: null, last: null, winner: null, reason: null
    };
  }

  const active = (s, i) => !s.out[i];
  function nextPlayer(s, from) {
    const n = s.players.length;
    for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (active(s, i)) return i; }
    return from;
  }

  // Legal moves for player `pl` with die value `die`: [{ t, from, to }].
  function legalMoves(s, pl, die) {
    const out = [];
    const toks = s.tokens[pl];
    for (let t = 0; t < 4; t++) {
      const p = toks[t];
      if (p === -1) { if (die === 6) out.push({ t, from: -1, to: 0 }); }
      else if (p < HOME && p + die <= HOME) out.push({ t, from: p, to: p + die });
    }
    return out;
  }
  // The same moves with tokens sharing a square counted once (they'd do exactly the same thing).
  function distinctMoves(s, pl, die) {
    const seen = new Set();
    return legalMoves(s, pl, die).filter((m) => { const k = m.from + ':' + m.to; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  const clone = (s) => Object.assign({}, s, { tokens: s.tokens.map((t) => t.slice()), out: s.out.slice() });

  // The player whose turn it is rolls `value`. Returns the new state; state.roll says what happened:
  // { pl, v, n, result: 'move' | 'pass' | 'again' | 'forfeit' }.
  function doRoll(s0, value) {
    const s = clone(s0);
    const pl = s.turn;
    const n = ((s0.roll && s0.roll.n) || 0) + 1;
    s.seq = (s0.seq || 0) + 1;
    s.sixes = value === 6 ? (s0.sixes || 0) + 1 : 0;
    let result;
    if (s.sixes >= 3) {
      result = 'forfeit';
      s.turn = nextPlayer(s, pl); s.phase = 'roll'; s.die = null; s.sixes = 0;
    } else if (!legalMoves(s, pl, value).length) {
      if (value === 6) { result = 'again'; s.phase = 'roll'; s.die = null; }
      else { result = 'pass'; s.turn = nextPlayer(s, pl); s.phase = 'roll'; s.die = null; s.sixes = 0; }
    } else {
      result = 'move'; s.phase = 'move'; s.die = value;
    }
    s.roll = { pl, v: value, n, result };
    return s;
  }

  // Moves token m.t of the player to move by the current die. Returns the new state; state.last
  // describes the move: { pl, t, from, to, caps: [[player, token, from]], n }.
  function doMove(s0, m) {
    const s = clone(s0);
    const pl = s.turn, color = s.colors[pl];
    const die = s0.die;
    const toks = s.tokens[pl];
    const from = toks[m.t];
    const to = from === -1 ? 0 : from + die;
    toks[m.t] = to;
    const caps = [];
    const idx = trackIndex(color, to);
    if (idx >= 0 && !SAFE.has(idx)) {
      s.players.forEach((_, q) => {
        if (q === pl || s.out[q]) return;
        s.tokens[q].forEach((p, t) => {
          if (trackIndex(s.colors[q], p) === idx) { caps.push([q, t, p]); s.tokens[q][t] = -1; }
        });
      });
    }
    s.seq = (s0.seq || 0) + 1;
    s.last = { pl, t: m.t, from, to, caps, n: ((s0.last && s0.last.n) || 0) + 1 };
    s.die = null;
    if (toks.every((p) => p === HOME)) {
      s.winner = pl; s.reason = 'home'; s.phase = 'over';
      return s;
    }
    if (die === 6) { s.phase = 'roll'; }
    else { s.turn = nextPlayer(s, pl); s.phase = 'roll'; s.sixes = 0; }
    return s;
  }

  // Someone left: their colour is skipped from now on and their tokens leave the board.
  function markOut(s0, pls) {
    const s = clone(s0);
    let changed = false;
    for (const pl of pls) if (!s.out[pl]) { s.out[pl] = true; s.tokens[pl] = [-1, -1, -1, -1]; changed = true; }
    if (!changed) return s0;
    s.seq = (s0.seq || 0) + 1;
    const left = s.players.map((_, i) => i).filter((i) => !s.out[i]);
    if (left.length <= 1 && s.winner == null) { s.winner = left.length ? left[0] : null; s.reason = 'left'; s.phase = 'over'; return s; }
    if (s.out[s.turn]) { s.turn = nextPlayer(s, s.turn); s.phase = 'roll'; s.die = null; s.sixes = 0; }
    return s;
  }

  // ---------- Computer player ----------
  // Scores each move with simple, friendly priorities: capture, get home, leave the yard, stay safe, run.
  function scoreMove(s, pl, m) {
    const color = s.colors[pl];
    const die = s.die;
    const to = m.from === -1 ? 0 : m.from + die;
    let v = 0;
    const idx = trackIndex(color, to);
    const fromIdx = trackIndex(color, m.from);
    const danger = (ix) => {
      if (ix < 0 || SAFE.has(ix)) return 0;
      let d = 0;
      s.players.forEach((_, q) => {
        if (q === pl || s.out[q]) return;
        s.tokens[q].forEach((p) => {
          const qi = trackIndex(s.colors[q], p);
          if (qi < 0) return;
          const gap = (ix - qi + TRACK_LEN) % TRACK_LEN;
          if (gap >= 1 && gap <= 6 && p + gap <= 50) d += 1;
        });
      });
      return d;
    };
    // capture
    if (idx >= 0 && !SAFE.has(idx)) {
      s.players.forEach((_, q) => {
        if (q === pl || s.out[q]) return;
        s.tokens[q].forEach((p) => { if (trackIndex(s.colors[q], p) === idx) v += 60 + p; });
      });
    }
    if (to === HOME) v += 55;
    else if (to > 50 && m.from <= 50) v += 35;     // into the home column (safe)
    if (m.from === -1) v += 40;
    if (idx >= 0 && SAFE.has(idx)) v += 14;
    v -= danger(idx) * 16;
    v += danger(fromIdx) * 12;                     // escaping a chaser
    v += to * 0.25;
    return v;
  }
  function pickMove(s, rnd) {
    const r = rnd || Math.random;
    const moves = distinctMoves(s, s.turn, s.die);
    if (!moves.length) return null;
    let best = null, bv = -Infinity;
    for (const m of moves) { const v = scoreMove(s, s.turn, m) + r() * 3; if (v > bv) { bv = v; best = m; } }
    return best;
  }

  const api = { HOME, TRACK, TRACK_LEN, START, SAFE, HOME_COL, YARD_ORIGIN, NAMES, SEATS, trackIndex, tokenCell, newGame, nextPlayer, legalMoves, distinctMoves, doRoll, doMove, markOut, scoreMove, pickMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RaceHomeRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
