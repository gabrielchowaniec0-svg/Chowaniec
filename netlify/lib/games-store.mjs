// Chowaniec Games: family high scores and multiplayer sessions (Netlify Blobs store 'games').
//   board/<game>              { rows: { <name>: { score, at, plays } } }   each person's best (or running total)
//   daily/<game>/<day>/<name> { score, at }                  once-a-day games (Daily Word)
//   sess/<id>                 session (see createSession)    lobby, round, shared state for turn games
//   sess/<id>/p/<name>        { state, at, round }           each player's live state in a race
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

// kind: 'max' keeps the best score, 'add' adds every result up (wins), 'min' keeps the lowest.
// daily: one result per person per day. max: the most players in one session.
export const GAMES = {
  dino: { name: 'Dino Dash', emoji: '🦖', kind: 'max', limit: 1e6, mode: 'race', max: 8 },
  road: { name: 'Road Rush', emoji: '🏎️', kind: 'max', limit: 1e7, mode: 'race', max: 8 },
  hop: { name: 'Sky Hop', emoji: '🐤', kind: 'max', limit: 1e5, mode: 'race', max: 8 },
  snake: { name: 'Snake', emoji: '🐍', kind: 'max', limit: 1e5, mode: 'race', max: 8 },
  2048: { name: '2048', emoji: '🔢', kind: 'max', limit: 1e7, mode: 'race', max: 8 },
  four: { name: 'Four in a Row', emoji: '🔴', kind: 'add', limit: 1, mode: 'turns', max: 2 },
  memory: { name: 'Memory Match', emoji: '🃏', kind: 'max', limit: 1e5, mode: 'turns', max: 4 },
  word: { name: 'Daily Word', emoji: '🔤', kind: 'add', limit: 6, mode: 'race', max: 8, daily: true },
  kart: { name: 'Kart Party', emoji: '🏁', kind: 'max', limit: 1e6, mode: 'race', max: 8 },
  style: { name: 'Style Star', emoji: '👗', kind: 'max', limit: 1e5, mode: 'race', max: 8 },
  police: { name: 'Police Patrol', emoji: '🚓', kind: 'max', limit: 1e7, mode: 'race', max: 8 },
  puzzle: { name: 'Picture Puzzle', emoji: '🧩', kind: 'max', limit: 1e6, mode: 'race', max: 8 },
  trivia: { name: 'Trivia Party', emoji: '🧠', kind: 'max', limit: 1e5, mode: 'race', max: 8 },
  doodle: { name: 'Doodle Guess', emoji: '🎨', kind: 'max', limit: 1e5, mode: 'race', max: 8 },
  clash: { name: 'Color Clash', emoji: '🃏', kind: 'add', limit: 1, mode: 'turns', max: 6 },
  dice: { name: 'Dice Party', emoji: '🎲', kind: 'max', limit: 2000, mode: 'turns', max: 6 },
  golf: { name: 'Mini Golf', emoji: '⛳', kind: 'max', limit: 1e5, mode: 'race', max: 8 },
  blocks: { name: 'Block Drop', emoji: '🧱', kind: 'max', limit: 1e7, mode: 'race', max: 8 },
  typing: { name: 'Type Racer', emoji: '⌨️', kind: 'max', limit: 1e4, mode: 'race', max: 8 },
  checkers: { name: 'Checkers', emoji: '⚫', kind: 'add', limit: 1, mode: 'turns', max: 2 },
  ludo: { name: 'Race Home', emoji: '🎯', kind: 'add', limit: 1, mode: 'turns', max: 4 }
};
export const isGame = (id) => Object.prototype.hasOwnProperty.call(GAMES, id);

const store = () => getStore({ name: 'games', consistency: 'strong' });
const enc = encodeURIComponent;
const SESSION_ID = /^[a-f0-9]{10}$/;
export const isSessionId = (id) => SESSION_ID.test(id || '');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STATE_CHARS = 4000;
const MAX_SHARED_CHARS = 20000;
const err = (status, message) => Object.assign(new Error(message), { status });

export function familyDay(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// ---------- High scores ----------

// Each game's leaderboard is ONE record, board/<game> = { rows: { <name>: { score, at, plays } } }, read and
// written as a whole. (Listing keys is only eventually consistent on Netlify, so a board built by listing
// best/<game>/* could miss someone's first score for a while: that was the "score not on the board" bug.)
// Older best/<game>/<name> records are merged in once, the first time a board is read.
const boardKey = (game) => `board/${game}`;

async function readBoard(game) {
  const entry = await store().getWithMetadata(boardKey(game), { type: 'json' });
  if (entry && entry.data && entry.data.migrated) return entry;
  const rows = (entry && entry.data && entry.data.rows) || {};
  const { blobs } = await store().list({ prefix: `best/${game}/` });
  const legacy = (await Promise.all(blobs.map((b) => store().get(b.key, { type: 'json' })))).filter(Boolean);
  for (const r of legacy) {
    const have = rows[r.name];
    if (!have || better(game, r.score, have.score)) rows[r.name] = { score: r.score, at: r.at, plays: Math.max(r.plays || 1, (have && have.plays) || 0) };
  }
  const data = { rows, migrated: true };
  const res = await store().setJSON(boardKey(game), data, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
  if (!res.modified) return store().getWithMetadata(boardKey(game), { type: 'json' });
  return { data, etag: res.etag };
}

// Is score a better than score b for this game?
function better(game, a, b) {
  const kind = GAMES[game].kind;
  return kind === 'min' ? a < b : a > b;
}

function sortedRows(game, rows) {
  const dir = GAMES[game].kind === 'min' ? 1 : -1;
  return Object.entries(rows || {}).map(([name, r]) => ({ name, score: r.score, at: r.at, plays: r.plays || 1 }))
    .sort((a, b) => (a.score === b.score ? (a.at < b.at ? -1 : 1) : (a.score < b.score ? -dir : dir)));
}

// Records a result. Returns { best, previous, isRecord, rank, total }.
export async function recordScore(name, game, rawScore, { day } = {}) {
  if (!isGame(game)) throw err(404, 'Unknown game.');
  const g = GAMES[game];
  const score = Math.round(Number(rawScore));
  if (!Number.isFinite(score) || score < 0 || score > g.limit) throw err(400, 'That score doesn’t look right.');
  if (g.daily) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw err(400, 'Missing day.');
    const { modified } = await store().setJSON(`daily/${game}/${day}/${enc(name)}`, { score, at: new Date().toISOString() }, { onlyIfNew: true });
    if (!modified) throw err(409, 'You already played today’s puzzle.');
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = await readBoard(game);
    const rows = { ...((entry && entry.data && entry.data.rows) || {}) };
    const prev = rows[name] || null;
    const previous = prev ? prev.score : null;
    let best = previous;
    if (g.kind === 'add') best = (previous || 0) + score;
    else best = previous == null || better(game, score, previous) ? score : previous;
    const isRecord = g.kind === 'add' ? score > 0 : best !== previous;
    const now = new Date().toISOString();
    rows[name] = { score: best, at: isRecord || !prev ? now : prev.at, plays: ((prev && prev.plays) || 0) + 1 };
    const { modified } = await store().setJSON(boardKey(game), { rows, migrated: true }, { onlyIfMatch: entry.etag });
    if (!modified) { await new Promise((r) => setTimeout(r, 40 + Math.random() * 120)); continue; }
    const board = sortedRows(game, rows);
    return { best, previous, isRecord, rank: board.findIndex((r) => r.name === name) + 1, total: board.length };
  }
  throw err(503, 'Lots of scores at once. Try again.');
}

export async function leaderboard(game) {
  if (!isGame(game)) throw err(404, 'Unknown game.');
  const entry = await readBoard(game);
  return sortedRows(game, entry && entry.data ? entry.data.rows : {});
}

// Today's results for a daily game (one read per family member: no listing, so nobody is missed).
export async function dailyResults(game, day, names) {
  const rows = await Promise.all(names.map(async (name) => {
    const r = await store().get(`daily/${game}/${day}/${enc(name)}`, { type: 'json' });
    return r ? { name, ...r } : null;
  }));
  return rows.filter(Boolean).sort((a, b) => b.score - a.score);
}

// ---------- Pictures (custom puzzle images) ----------
const IMAGE_ID = /^[a-f0-9]{24}$/;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function saveImage(name, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m || !IMAGE_TYPES.includes(m[1])) throw err(400, 'Pictures must be JPEG, PNG or WebP.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw err(413, 'That picture is too large (max 2 MB).');
  const id = crypto.randomBytes(12).toString('hex');
  await store().set(`img/${id}`, bytes, { metadata: { contentType: m[1], by: name, at: new Date().toISOString() } });
  return id;
}

export async function getImage(id) {
  if (!IMAGE_ID.test(id || '')) return null;
  const entry = await store().getWithMetadata(`img/${id}`, { type: 'arrayBuffer' });
  return entry ? { bytes: entry.data, contentType: entry.metadata.contentType || 'image/jpeg' } : null;
}

// ---------- Sessions ----------

const sessKey = (id) => `sess/${id}`;
const playerKey = (id, name) => `sess/${id}/p/${enc(name)}`;
const newSeed = () => crypto.randomInt(1, 2 ** 31 - 1);

async function readSession(id) {
  if (!isSessionId(id)) return null;
  const entry = await store().getWithMetadata(sessKey(id), { type: 'json' });
  if (!entry || Date.now() - Date.parse(entry.data.createdAt) > SESSION_TTL_MS) return null;
  return entry;
}

// Changes a session with `change(session)` (return false to leave it), retrying on clashes.
async function changeSession(id, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await readSession(id);
    if (!entry) throw err(404, 'That game has ended. Start a new one!');
    const session = entry.data;
    if (change(session) === false) return session;
    const { modified } = await store().setJSON(sessKey(id), session, { onlyIfMatch: entry.etag });
    if (modified) return session;
  }
  throw err(409, 'Lots happening at once. Try again.');
}

export async function createSession(name, game) {
  if (!isGame(game)) throw err(404, 'Unknown game.');
  const session = {
    id: crypto.randomBytes(5).toString('hex'), game, host: name, createdAt: new Date().toISOString(),
    status: 'lobby', round: 0, seed: newSeed(), startAt: null, players: [name], shared: null, version: 0, invitedTo: []
  };
  await store().setJSON(sessKey(session.id), session, { onlyIfNew: true });
  return session;
}

export async function getSession(id) {
  const entry = await readSession(id);
  return entry ? entry.data : null;
}

export function joinSession(id, name) {
  return changeSession(id, (s) => {
    if (s.players.includes(name)) return false;
    if (s.status !== 'lobby' && GAMES[s.game].mode === 'turns') throw err(409, 'This game has already started. You can watch, or start your own!');
    if (s.players.length >= GAMES[s.game].max) throw err(409, 'This game is full.');
    s.players.push(name);
  });
}

export function leaveSession(id, name) {
  return changeSession(id, (s) => {
    if (!s.players.includes(name)) return false;
    s.players = s.players.filter((n) => n !== name);
    if (s.host === name && s.players.length) s.host = s.players[0];
  });
}

// The host starts (or restarts) a round. Turn games pass the opening board as `shared`.
export function startRound(id, name, shared) {
  if (shared !== undefined && JSON.stringify(shared).length > MAX_SHARED_CHARS) throw err(413, 'That game is too big to save.');
  return changeSession(id, (s) => {
    if (s.host !== name) throw err(403, 'Only the person who started the game can start a round.');
    s.status = 'playing';
    s.round += 1;
    s.seed = newSeed();
    s.startAt = new Date(Date.now() + 3500).toISOString();
    s.shared = shared === undefined ? null : shared;
    s.version += 1;
  });
}

export function finishRound(id, name) {
  return changeSession(id, (s) => {
    if (!s.players.includes(name) || s.status !== 'playing') return false;
    s.status = 'done';
  });
}

// A move in a turn game: replaces the shared state if nobody else moved first.
export async function makeMove(id, name, version, shared, done) {
  if (JSON.stringify(shared === undefined ? null : shared).length > MAX_SHARED_CHARS) throw err(413, 'That move is too big to save.');
  return changeSession(id, (s) => {
    if (!s.players.includes(name)) throw err(403, 'You’re not playing in this game.');
    if (s.version !== Number(version)) throw err(409, 'Someone else moved first.');
    s.shared = shared;
    s.version += 1;
    if (done) s.status = 'done';
  });
}

export function noteInvite(id, room) {
  return changeSession(id, (s) => {
    if (s.invitedTo.includes(room)) return false;
    s.invitedTo.push(room);
  });
}

// A player's live state in a race (score, position...). Returns everyone's latest states.
export async function syncPlayer(id, name, state, round, players) {
  const json = JSON.stringify(state === undefined ? null : state);
  if (json.length > MAX_STATE_CHARS) throw err(413, 'That update is too big.');
  if (state !== undefined) await store().setJSON(playerKey(id, name), { state, at: Date.now(), round: Number(round) || 0 });
  return playerStates(id, players);
}

// Reads each player's key directly (listing could miss someone who only just joined).
export async function playerStates(id, players) {
  const out = {};
  await Promise.all((players || []).map(async (name) => {
    const v = await store().get(playerKey(id, name), { type: 'json' });
    if (v) out[name] = v;
  }));
  return out;
}

// For the once-a-minute scheduler: removes sessions older than a day.
export async function sweepSessions() {
  const { blobs } = await store().list({ prefix: 'sess/' });
  const cutoff = Date.now() - SESSION_TTL_MS;
  const old = new Set();
  for (const b of blobs) {
    const id = b.key.split('/')[1];
    if (b.key === sessKey(id)) {
      const s = await store().get(b.key, { type: 'json' });
      if (!s || Date.parse(s.createdAt) < cutoff) old.add(id);
    }
  }
  await Promise.all(blobs.filter((b) => old.has(b.key.split('/')[1])).map((b) => store().delete(b.key)));
  return old.size;
}
