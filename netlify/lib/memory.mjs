// The Family Memory Keeper: one search over the family's past for the AI ("When did we last go to the lake?",
// "What did Grandma say about the recipe?", "Who won game night in October?").
//
//   searchMemories(user, { query, from, to, person, kinds }) -> { query, from, to, results: [source], scanned, complete }
//   source = { ref, type: 'chat'|'note'|'event'|'gamenight'|'record', title, snippet, when, who, room, roomName, url, score }
//
// Privacy: only what the asker can already open themselves.
//   chats  the group chats they are in (roomsFor) and their OWN direct messages (dmPartners builds the ids from the
//          asker's name, so another person's DMs can never be named here). Nothing else is read.
//   notes  listVisible (their notes, notes shared with everyone, notes shared with them by name).
//   events calendar events for chats they are in (listEvents checks canSee), up to today.
//   game nights in chats they are in; family high-score records (shown to the whole family on /games).
import { getStore } from '@netlify/blobs';
import { listVisible } from './notes-store.mjs';
import { searchMessages } from './group-store.mjs';
import { roomsFor, dmPartners, canAccessRoom, DEFAULT_ROOM } from './rooms.mjs';
import { listEvents, todayLocal, describeWhen } from './calendar-store.mjs';
import { resolveName } from './auth.mjs';
import { GAMES, leaderboard } from './games-store.mjs';

export const MEMORY_KINDS = ['chats', 'notes', 'events', 'game_nights', 'records'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Most messages looked at in one chat, newest first. A date range lets it reach further back cheaply,
// because days outside the range are skipped without being read.
const SCAN_PER_ROOM = 600;
const SCAN_PER_ROOM_RANGED = 2000;
const MAX_RESULTS = 12;

// Words that carry no meaning for matching (English and Polish), so "when did we last go to the lake" looks for "lake".
const STOP = new Set(`a an the and or but if of to in on at by for from with about into over after before up down out off is are was were be been being am do does did done have has had having i me my mine we us our ours you your yours he him his she her hers it its they them their what which who whom whose when where why how this that these those there here then than so not no yes can could would should will shall may might must just also very too much many more most some any all each every last first ever again said say says tell told talk talked mention mentioned bob hey ok okay please family remember remind recall time times day days go went going gone get got make made thing things anything something
i w we na z ze do od po o u za przez dla jak kiedy gdzie co czy kto kogo komu jest był była było byli były są się nie tak to ten ta te tam tu już jeszcze ostatnio ostatni ostatnia raz mówił mówiła powiedział powiedziała nasz nasza nasze nam nas my wy oni one`.split(/\s+/));

export function memoryWords(query) {
  const raw = String(query || '').toLowerCase().split(/[\s,.;:!?()"“”„]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/, ''))
    .filter((w) => w.length > 1 && !STOP.has(w));
  return [...new Set(raw)].slice(0, 8);
}

// A light stem so "recipes" finds "recipe", "baking" finds "bake", "lakes" finds "lake".
function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3);
  if (w.length > 4 && (w.endsWith('es') || w.endsWith('ed'))) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

// 0..1: how much of the query a text covers (every word found = 1). Whole-word hits count a little more.
function scoreText(text, words) {
  if (!words.length) return 0;
  const hay = String(text || '').toLowerCase();
  let hit = 0;
  for (const w of words) {
    const s = stem(w);
    if (hay.includes(s)) hit += new RegExp(`(^|[^\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(hay) ? 1 : 0.6;
  }
  return hit / words.length;
}

function snippet(text, words, size = 180) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const low = flat.toLowerCase();
  const at = Math.max(0, words.map((w) => low.indexOf(stem(w))).filter((i) => i >= 0).sort((a, b) => a - b)[0] || 0);
  const from = at > 60 ? at - 50 : 0;
  return (from > 0 ? '…' : '') + flat.slice(from, from + size) + (from + size < flat.length ? '…' : '');
}

const dayOfIso = (iso) => String(iso || '').slice(0, 10);
const inRange = (day, from, to) => (!from || day >= from) && (!to || day <= to);

// The chats this person may search: their group chats and their own direct messages (never anyone else's).
export function memoryRooms(name) {
  const groups = roomsFor(name).map((r) => ({ id: r.id, name: r.name }));
  const direct = dmPartners(name).filter((p) => p.id).map((p) => ({ id: p.id, name: p.ai ? 'your chat with Chowaniec AI' : `your messages with ${p.name}`, other: p.ai ? 'Chowaniec AI' : p.name, dm: true }));
  return groups.concat(direct).filter((r) => canAccessRoom(name, r.id));
}

export const messageLink = (room, id) => `/group/?room=${encodeURIComponent(room || DEFAULT_ROOM)}&msg=${encodeURIComponent(id)}`;

async function chatMemories(user, words, { from, to, person }) {
  const rooms = memoryRooms(user.name);
  let scanned = 0;
  let complete = true;
  const lists = await Promise.all(rooms.map(async (room) => {
    const { hits, scanned: n, complete: done } = await searchMessages(room.id, { q: '', from, to, limit: from || to ? SCAN_PER_ROOM_RANGED : SCAN_PER_ROOM });
    scanned += n;
    if (!done) complete = false;
    return hits.map((m) => {
      if (m.kind === 'system') return null;
      const who = m.onBehalfOf && m.user !== m.onBehalfOf ? `${m.user} for ${m.onBehalfOf}` : m.user;
      if (person && m.user !== person && m.onBehalfOf !== person) return null;
      const text = `${m.text || ''} ${(m.voice && m.voice.transcript) || ''}${m.poll ? ` ${m.poll.question || ''} ${(m.poll.options || []).map((o) => o.text).join(' ')}` : ''}`.trim();
      const score = words.length ? scoreText(text, words) : (person ? 0.5 : 0);
      if (score < (words.length > 2 ? 0.5 : 0.34)) return null;
      // Direct messages read as "You to Amelia" / "Amelia to you"; group chats as "Victoria in Everyone".
      const title = room.dm ? (m.user === user.name ? `You to ${room.other}` : `${m.user === room.other ? who : m.user} to you`) : `${who} in ${room.name}`;
      return {
        type: 'chat', id: m.id, title, snippet: snippet(text, words), when: m.createdAt,
        who: m.user, room: room.id, roomName: room.name, url: messageLink(room.id, m.id), score
      };
    }).filter(Boolean);
  }));
  return { list: lists.flat(), scanned, complete };
}

async function noteMemories(user, words, { from, to, person }) {
  const notes = await listVisible(user);
  return notes.map((n) => {
    const day = dayOfIso(n.updatedAt || n.createdAt);
    const created = dayOfIso(n.createdAt || n.updatedAt);
    // A note counts for a date range if it was written or last changed inside it.
    if ((from || to) && !inRange(day, from, to) && !inRange(created, from, to)) return null;
    if (person && n.owner !== person) return null;
    const score = words.length ? scoreText(`${n.title}\n${n.title}\n${n.markdown}`, words) : (person ? 0.5 : 0);
    if (score < (words.length > 2 ? 0.5 : 0.34)) return null;
    return { type: 'note', id: n.id, title: n.title || 'Untitled note', snippet: snippet(n.markdown, words), when: n.updatedAt || n.createdAt, who: n.owner, url: `/notes/?id=${encodeURIComponent(n.id)}`, score };
  }).filter(Boolean);
}

async function eventMemories(user, words, { from, to, person }) {
  const today = todayLocal().date;
  const end = to && to < today ? to : today;
  const events = await listEvents(user, from || '2000-01-01', end);
  return events.map((e) => {
    if (person && e.createdBy !== person && !(e.rsvp && e.rsvp[person] === 'going')) return null;
    const text = `${e.title}\n${e.title}\n${e.location || ''}\n${e.notes || ''}`;
    const score = words.length ? scoreText(text, words) : (person ? 0.5 : 0);
    if (score < (words.length > 2 ? 0.5 : 0.34)) return null;
    return {
      type: 'event', id: e.id, title: e.title, snippet: `${describeWhen(e)}${e.location ? ` · ${e.location}` : ''}${e.notes ? ` · ${e.notes.slice(0, 120)}` : ''}`,
      when: e.date, who: e.createdBy, room: e.room, url: `/calendar/?event=${encodeURIComponent(e.id)}`, score
    };
  }).filter(Boolean);
}

const GAME_WORDS = /^(game|games|night|nights|won|win|wins|winner|champion|champions|played|play|score|scores|points|gra|gry|wieczór|wygrał|wygrała)$/;

async function gameNightMemories(user, words, { from, to, person }) {
  const store = getStore({ name: 'games', consistency: 'strong' });
  const { blobs } = await store.list({ prefix: 'night/' });
  const nights = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);
  const topical = words.filter((w) => !GAME_WORDS.test(w));
  return nights.map((n) => {
    if (!n.room || !canAccessRoom(user.name, n.room)) return null;
    if (!inRange(n.date, from, to)) return null;
    if (n.date > todayLocal().date) return null;
    const board = Object.entries(n.scores || {}).sort((a, b) => b[1] - a[1]);
    if (person && !board.some(([name]) => name === person)) return null;
    const games = (n.picks && n.picks.length ? n.picks : n.games || []).map((g) => (GAMES[g] ? GAMES[g].name : g));
    const text = `${n.title} game night ${games.join(' ')} ${(n.champions || []).join(' ')} ${board.map(([name]) => name).join(' ')} ${n.wrap || ''}`;
    // "Who won game night?" matches every game night; other words (a game, a person) narrow it down.
    const score = topical.length ? scoreText(text, topical) : 0.8;
    if (score < 0.34) return null;
    const champs = (n.champions || []).length ? `Champion: ${n.champions.join(' and ')}` : (n.status === 'done' ? 'No champion (no games finished)' : `Status: ${n.status}`);
    const standings = board.length ? ` · ${board.slice(0, 5).map(([name, pts]) => `${name} ${pts}`).join(', ')} points` : '';
    const played = (n.rounds || []).filter((r) => r.status === 'done').map((r) => (GAMES[r.game] ? GAMES[r.game].name : r.game));
    return {
      type: 'gamenight', id: n.id, title: n.title || 'Game night', snippet: `${champs}${standings}${played.length ? ` · Played ${played.join(', ')}` : ''}`,
      when: n.date, who: (n.champions || []).join(', '), room: n.room,
      url: n.cardId ? messageLink(n.room, n.cardId) : n.eventId ? `/calendar/?event=${encodeURIComponent(n.eventId)}` : messageLink(n.room, ''),
      score
    };
  }).filter(Boolean);
}

const RECORD_WORDS = /^(record|records|best|highest|high|top|score|scores|rekord|najlepszy|najwyższy|wynik)$/;

async function recordMemories(user, words, { person }) {
  const wantsRecords = words.some((w) => RECORD_WORDS.test(w));
  const named = Object.keys(GAMES).filter((id) => words.some((w) => GAMES[id].name.toLowerCase().split(/\s+/).some((p) => p.length > 2 && stem(p) === stem(w)) || id === w));
  if (!named.length && !wantsRecords) return [];
  const ids = named.length ? named : Object.keys(GAMES).filter((id) => !GAMES[id].daily);
  const out = [];
  for (const id of ids.slice(0, 24)) {
    const rows = await leaderboard(id).catch(() => []);
    if (!rows.length) continue;
    const top = person ? rows.filter((r) => r.name === person) : rows.slice(0, 3);
    if (!top.length) continue;
    out.push({
      type: 'record', id, title: `${GAMES[id].name} family records`,
      snippet: top.map((r) => `${rows.indexOf(r) + 1}. ${r.name} ${r.score}`).join(', '),
      when: top[0].at, who: top[0].name, url: `/games/${id}/`, score: named.includes(id) ? 0.9 : 0.4
    });
  }
  return out;
}

function cleanDate(d) {
  const s = String(d || '').trim();
  return DATE.test(s) ? s : '';
}

// The main search. `kinds` empty = everything. Results are the best matches, newest first among equals.
export async function searchMemories(user, { query = '', from = '', to = '', person = '', kinds = [] } = {}) {
  const words = memoryWords(query);
  let f = cleanDate(from);
  let t = cleanDate(to);
  if (f && t && f > t) [f, t] = [t, f];
  const who = person ? resolveName(person) : null;
  const want = new Set((Array.isArray(kinds) && kinds.length ? kinds : MEMORY_KINDS).filter((k) => MEMORY_KINDS.includes(k)));
  if (!words.length && !who && !want.has('game_nights')) return { query, from: f, to: t, words, results: [], scanned: 0, complete: true };
  const opts = { from: f, to: t, person: who };
  const [chats, notes, events, nights, records] = await Promise.all([
    want.has('chats') ? chatMemories(user, words, opts) : { list: [], scanned: 0, complete: true },
    want.has('notes') ? noteMemories(user, words, opts) : [],
    want.has('events') ? eventMemories(user, words, opts) : [],
    want.has('game_nights') ? gameNightMemories(user, words, opts) : [],
    want.has('records') ? recordMemories(user, words, opts) : []
  ]);
  const all = [...chats.list, ...notes, ...events, ...nights, ...records]
    .sort((a, b) => (b.score - a.score) || (String(b.when) < String(a.when) ? -1 : 1));
  // Keep a mix: no single kind may take every slot.
  const picked = [];
  const perType = {};
  for (const r of all) {
    if (picked.length >= MAX_RESULTS) break;
    perType[r.type] = (perType[r.type] || 0) + 1;
    if (perType[r.type] > 8) continue;
    picked.push(r);
  }
  return { query, from: f, to: t, words, results: picked, scanned: chats.scanned, complete: chats.complete };
}
