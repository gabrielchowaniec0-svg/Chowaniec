// Checkers rules (American / English draughts) and the computer player. No DOM here, so Node tests can
// load it too: window.CheckersRules in the browser, module.exports in Node.
//
// Board: 64 numbers, row 0 at the top. 0 = empty, 1 = Red man, 2 = Red king, -1 = White man, -2 = White king.
// Red (side 0) starts on rows 5-7 and moves up; White (side 1) starts on rows 0-2 and moves down. Red goes first.
// A move is { from, to, path: [from, ..., to], caps: [captured squares], crown }.
(function (root) {
  'use strict';

  const N = 8;
  const QUIET_LIMIT = 80;            // 40 moves each without a capture = a draw
  const owner = (v) => (v > 0 ? 0 : v < 0 ? 1 : -1);
  const isKing = (v) => v === 2 || v === -2;
  const rc = (i) => [i >> 3, i & 7];
  const at = (r, c) => (r >= 0 && r < N && c >= 0 && c < N ? r * N + c : -1);
  const isDark = (i) => (((i >> 3) + (i & 7)) & 1) === 1;
  const crownRow = (side) => (side === 0 ? 0 : N - 1);

  function initialBoard() {
    const b = new Array(64).fill(0);
    for (let i = 0; i < 64; i++) {
      if (!isDark(i)) continue;
      const r = i >> 3;
      if (r <= 2) b[i] = -1;
      else if (r >= 5) b[i] = 1;
    }
    return b;
  }

  const CH = { 0: '.', 1: 'r', 2: 'R', '-1': 'w', '-2': 'W' };
  const VAL = { '.': 0, r: 1, R: 2, w: -1, W: -2 };
  const encode = (b) => b.map((v) => CH[v]).join('');
  const decode = (s) => String(s).split('').map((ch) => VAL[ch] || 0);

  // Directions a piece may step in: men only forward, kings both ways.
  function dirsFor(v) {
    if (isKing(v)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    return v > 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
  }

  // Every complete jump sequence for the piece on `from`. A sequence must go on while another jump is
  // possible; a man that reaches the far row is crowned and its move ends there. Captured pieces stay on
  // the board (blocking) until the move is over, and can't be jumped twice.
  function capturesFrom(b, from) {
    const v = b[from];
    const side = owner(v);
    const out = [];
    const dirs = dirsFor(v);
    const taken = new Set();
    const path = [from], caps = [];
    (function dfs(pos) {
      const [r, c] = rc(pos);
      let more = false;
      const crownedNow = !isKing(v) && r === crownRow(side) && caps.length > 0;
      if (!crownedNow) {
        for (const [dr, dc] of dirs) {
          const mid = at(r + dr, c + dc), land = at(r + 2 * dr, c + 2 * dc);
          if (mid < 0 || land < 0) continue;
          const mv = b[mid];
          if (mv === 0 || owner(mv) === side || taken.has(mid)) continue;
          if (b[land] !== 0 && land !== from) continue;
          more = true;
          taken.add(mid); caps.push(mid); path.push(land);
          dfs(land);
          taken.delete(mid); caps.pop(); path.pop();
        }
      }
      if (!more && caps.length) {
        const to = path[path.length - 1];
        out.push({ from, to, path: path.slice(), caps: caps.slice(), crown: !isKing(v) && (to >> 3) === crownRow(side) });
      }
    })(from);
    return out;
  }

  function stepsFrom(b, from) {
    const v = b[from];
    const side = owner(v);
    const [r, c] = rc(from);
    const out = [];
    for (const [dr, dc] of dirsFor(v)) {
      const to = at(r + dr, c + dc);
      if (to < 0 || b[to] !== 0) continue;
      out.push({ from, to, path: [from, to], caps: [], crown: !isKing(v) && (to >> 3) === crownRow(side) });
    }
    return out;
  }

  // All legal moves for `side`. Captures are compulsory: if any piece can jump, only jumps are allowed.
  function legalMoves(b, side) {
    const caps = [], steps = [];
    for (let i = 0; i < 64; i++) {
      if (b[i] === 0 || owner(b[i]) !== side) continue;
      const c = capturesFrom(b, i);
      if (c.length) { for (const m of c) caps.push(m); continue; }
      if (!caps.length) for (const m of stepsFrom(b, i)) steps.push(m);
    }
    return caps.length ? caps : steps;
  }

  function applyMove(b, m) {
    const nb = b.slice();
    let v = nb[m.from];
    nb[m.from] = 0;
    for (const c of m.caps) nb[c] = 0;
    if (m.crown) v = v > 0 ? 2 : -2;
    nb[m.to] = v;
    return nb;
  }

  // Squares are numbered 1-32 along the dark squares, from the top-left (White's side).
  const sqNum = (i) => (i >> 3) * 4 + ((i & 7) >> 1) + 1;
  const notation = (m) => m.path.map(sqNum).join(m.caps.length ? 'x' : '-');
  const sameMove = (a, b) => a && b && a.path.length === b.path.length && a.path.every((s, i) => s === b.path[i]);

  function count(b) {
    const n = [{ men: 0, kings: 0 }, { men: 0, kings: 0 }];
    for (const v of b) { if (!v) continue; const o = n[owner(v)]; if (isKing(v)) o.kings++; else o.men++; }
    return n;
  }

  // ---------- Game state (what goes into ChowGames shared) ----------
  function newGame(players, gid) {
    return { v: 1, gid: gid || 1, seq: 0, players: (players || []).slice(0, 2), board: encode(initialBoard()), turn: 0, winner: null, reason: null, last: null, hist: [], quiet: 0, offer: null, declined: null };
  }

  // Plays a move for the side to move. Returns the new state (the old one isn't changed).
  function play(state, m) {
    const b = decode(state.board);
    const side = state.turn;
    const piece = b[m.from];
    const nb = applyMove(b, m);
    const s = Object.assign({}, state);
    s.board = encode(nb);
    s.seq = (state.seq || 0) + 1;
    s.hist = (state.hist || []).concat(notation(m));
    s.last = { side, path: m.path.slice(), caps: m.caps.slice(), crown: !!m.crown, king: isKing(piece), n: s.hist.length };
    s.quiet = m.caps.length ? 0 : (state.quiet || 0) + 1;
    s.offer = null;
    s.declined = null;
    s.turn = 1 - side;
    const reply = legalMoves(nb, s.turn);
    if (!reply.length) {
      s.winner = side;
      s.reason = count(nb)[s.turn].men + count(nb)[s.turn].kings === 0 ? 'captured' : 'blocked';
    } else if (s.quiet >= QUIET_LIMIT) {
      s.winner = 'draw';
      s.reason = 'quiet';
    }
    return s;
  }

  function resign(state, side) { return Object.assign({}, state, { seq: (state.seq || 0) + 1, winner: 1 - side, reason: 'resign', offer: null }); }
  function agreeDraw(state) { return Object.assign({}, state, { seq: (state.seq || 0) + 1, winner: 'draw', reason: 'agreed', offer: null }); }

  // ---------- Computer player: negamax with alpha-beta ----------
  const WIN = 100000;
  const CENTER = new Set([at(3, 2), at(3, 4), at(4, 3), at(4, 5), at(3, 6), at(4, 1)]);
  function evaluate(b, side) {
    let mat = [0, 0], pos = [0, 0], pieces = [0, 0];
    for (let i = 0; i < 64; i++) {
      const v = b[i];
      if (!v) continue;
      const o = owner(v), r = i >> 3, c = i & 7;
      pieces[o]++;
      if (isKing(v)) {
        mat[o] += 165;
        pos[o] += 6 - (Math.abs(3.5 - r) + Math.abs(3.5 - c));      // kings like the middle
      } else {
        mat[o] += 100;
        const adv = o === 0 ? 7 - r : r;
        pos[o] += adv * 3;
        if (adv === 0) pos[o] += 7;                                // back-row guard
        if (c === 0 || c === 7) pos[o] -= 2;
      }
      if (CENTER.has(i)) pos[o] += 4;
    }
    const me = side, op = 1 - side;
    let s = mat[me] - mat[op] + pos[me] - pos[op];
    // when ahead, trading pieces is good
    const tot = pieces[0] + pieces[1];
    if (mat[me] > mat[op]) s += (24 - tot) * 3; else if (mat[me] < mat[op]) s -= (24 - tot) * 3;
    return s;
  }

  function search(b, side, depth, alpha, beta, ply, clock) {
    if ((++clock.n & 511) === 0 && clock.deadline && now() > clock.deadline) clock.out = true;
    if (clock.out) return 0;
    const moves = legalMoves(b, side);
    if (!moves.length) return -WIN + ply;
    // keep searching while jumps are pending (quiescence-lite) so trades aren't cut in half
    if (depth <= 0 && (!moves[0].caps.length || depth < -4)) return evaluate(b, side);
    if (moves.length > 1) moves.sort((x, y) => y.caps.length - x.caps.length || (y.crown ? 1 : 0) - (x.crown ? 1 : 0));
    let best = -Infinity;
    for (const m of moves) {
      const v = -search(applyMove(b, m), 1 - side, depth - 1, -beta, -alpha, ply + 1, clock);
      if (clock.out) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  function rankMoves(b, side, depth, deadline) {
    const moves = legalMoves(b, side);
    const clock = { n: 0, out: false, deadline };
    const out = [];
    for (const m of moves) {
      const v = -search(applyMove(b, m), 1 - side, depth - 1, -Infinity, Infinity, 1, clock);
      if (clock.out) return null;
      out.push({ m, v });
    }
    return out.sort((x, y) => y.v - x.v);
  }

  const LEVELS = {
    easy: { depth: 2, mistake: 0.4, ms: 0 },
    medium: { depth: 4, mistake: 0.1, ms: 0 },
    hard: { depth: 14, mistake: 0, ms: 700 }
  };

  // Picks a move for `side` on board `b` (array) at 'easy' | 'medium' | 'hard'. `rnd` is optional.
  function computerMove(b, side, level, rnd) {
    const L = LEVELS[level] || LEVELS.medium;
    const r = rnd || Math.random;
    const moves = legalMoves(b, side);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    let ranked;
    if (L.ms) {
      const deadline = now() + L.ms;
      ranked = rankMoves(b, side, 3, 0);
      for (let d = 5; d <= L.depth; d += 1) {
        const next = rankMoves(b, side, d, deadline);
        if (!next) break;
        ranked = next;
        if (Math.abs(ranked[0].v) > WIN / 2) break;
      }
    } else ranked = rankMoves(b, side, L.depth, 0);
    if (r() < L.mistake) {
      // a friendly slip: any move that doesn't simply hand over a piece for nothing on Medium
      const pool = level === 'easy' ? ranked : ranked.filter((x) => x.v > ranked[0].v - 90);
      return pool[Math.floor(r() * pool.length)].m;
    }
    const top = ranked.filter((x) => x.v === ranked[0].v);
    return top[Math.floor(r() * top.length)].m;
  }

  // How good the position looks for `side` (used to decide whether the computer accepts a draw).
  function judge(b, side) {
    const r = rankMoves(b, side, 4, 0);
    return r && r.length ? r[0].v : -WIN;
  }

  const api = { N, QUIET_LIMIT, owner, isKing, rc, at, isDark, initialBoard, encode, decode, capturesFrom, stepsFrom, legalMoves, applyMove, sqNum, notation, sameMove, count, newGame, play, resign, agreeDraw, evaluate, computerMove, judge, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CheckersRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
