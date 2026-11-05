// Family XP, levels, achievements and monthly seasons. XP is only ever granted here, on the server, from things
// the server saw happen (a score saved, a round settled, a game night finished, a chat message stored, a reaction).
// Every grant has a dedup key and most have a daily cap, so replaying requests can't farm XP.
//
// Storage (Netlify Blobs store 'xp'):
//   user/<name>     { name, xp, seasons: { <YYYY-MM>: points }, events: [{ kind, xp, at, label, game? }] (newest first, 40),
//                     seen: { <dedup key>: ms } (8 days), day: { id, c: { <cap bucket>: n } }, stats: {...},
//                     ach: { <achievement id>: ISO time }, trophies: [{ kind: 'season'|'night', id, title, at, room? }] }
//   season/<YYYY-MM> { id, name, closedAt, standings: [{ name, points, place, level, title }], winners: [names] }
//   card/<bucket>   { at }   when a celebratory chat card was last posted (rate limit)
//
// XP rules (see RULES): a game round +10 (10 rounds a day per game), finishing a multiplayer round +15, winning one
// +25, a personal best +20 / a family record +50 (once a day per game), Daily Word solved +15 plus 5 per streak day
// (max +30), game night +40 / champion +150, the first chat message of the day +5 with streak bonuses at 3, 7 and
// every 30 days, and +2 per reaction your messages receive (10 a day).
// Seasons are calendar months in the family time zone; season points are the XP earned that month. The first
// request after a month ends closes it (idempotent): final standings are stored, the winner gets a season trophy
// and the Everyone chat gets a results card.
import { getStore } from '@netlify/blobs';
import { familyNames } from './auth.mjs';
import { GAMES, leaderboard } from './games-store.mjs';
import { familyTimeZone, postMessage } from './group-store.mjs';
import { sendPush } from './push.mjs';

const store = () => getStore({ name: 'xp', consistency: 'strong' });
const enc = encodeURIComponent;
const DAY_MS = 86400000;
const SEEN_KEEP_MS = 8 * DAY_MS;
const MAX_EVENTS = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A clock the tests can move (seasons, streaks, caps).
let clock = () => Date.now();
export function _setClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }
export const nowMs = () => clock();

export const RULES = {
  play: 10, playCap: 10,           // per game per day
  finish: 15, finishCap: 20,       // multiplayer rounds per day
  win: 25, winCap: 15,
  pb: 20, record: 50,              // once a day per game
  word: 15, wordStreakStep: 5, wordStreakMax: 30,
  night: 40, champion: 150,
  chat: 5, chatStreak: { 3: 15, 7: 40, 30: 150 },
  react: 2, reactCap: 10           // reactions per day
};

// ---------- Levels ----------
// Total XP needed to reach level n: 100·(n-1)^1.5, rounded to tens (L2 100, L3 280, L5 800, L10 2,700, L20 8,280).
export function xpForLevel(n) { return n <= 1 ? 0 : Math.round((100 * Math.pow(n - 1, 1.5)) / 10) * 10; }
export function levelFor(xp) {
  let n = 1;
  while (n < 300 && xpForLevel(n + 1) <= xp) n++;
  return n;
}
export const TITLES = [
  [1, 'Rookie'], [3, 'Player'], [5, 'Rising Star'], [8, 'Contender'], [12, 'Pro'], [16, 'All-Star'],
  [20, 'Ace'], [25, 'Master'], [30, 'Legend'], [40, 'Family Champion'], [50, 'Hall of Famer']
];
export function titleFor(level) {
  let t = TITLES[0][1];
  for (const [n, name] of TITLES) if (level >= n) t = name;
  return t;
}
export function levelInfo(xp) {
  const level = levelFor(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, levelXp: xp - base, nextXp: next - base, toNext: next - xp, title: titleFor(level) };
}

// ---------- Family time ----------
function parts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return p;
}
export const dayId = (ms, tz = familyTimeZone()) => { const p = parts(ms, tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
export const hourOf = (ms, tz = familyTimeZone()) => parts(ms, tz).hour % 24;
const prevDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
// The UTC time of a wall-clock time in the family zone.
function zonedToUtc(y, m, d, tz) {
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const p = parts(guess, tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    const want = Date.UTC(y, m - 1, d, 0, 0, 0);
    if (shown === want) break;
    guess += want - shown;
  }
  return guess;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function seasonOf(ms = nowMs(), tz = familyTimeZone()) {
  const p = parts(ms, tz);
  return seasonById(`${p.year}-${String(p.month).padStart(2, '0')}`, tz);
}
export function seasonById(id, tz = familyTimeZone()) {
  const [y, m] = id.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { id, name: `${MONTHS[m - 1]} ${y}`, startsAt: new Date(zonedToUtc(y, m, 1, tz)).toISOString(), endsAt: new Date(zonedToUtc(ny, nm, 1, tz)).toISOString() };
}
const prevSeasonId = (id) => { const [y, m] = id.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

// ---------- Achievements ----------
// val(stats, rec) is a number; the achievement unlocks when it reaches need. hint is shown while locked.
const n = (v) => Number(v || 0);
const count = (o) => Object.keys(o || {}).length;
const best = (g) => (s) => n(s.bestBy && s.bestBy[g]);
const winsIn = (g) => (s) => n(s.winsBy && s.winsBy[g]);
const A = (id, name, hint, icon, rarity, need, val, group) => ({ id, name, hint, icon, rarity, need, val, group });
export const ACHIEVEMENTS = [
  // Playing
  A('first-game', 'First Steps', 'Play your first game round', 'gamepad', 'common', 1, (s) => n(s.plays), 'Playing'),
  A('plays-50', 'Regular', 'Play 50 game rounds', 'refresh', 'common', 50, (s) => n(s.plays), 'Playing'),
  A('plays-250', 'Arcade Addict', 'Play 250 game rounds', 'zap', 'rare', 250, (s) => n(s.plays), 'Playing'),
  A('plays-1000', 'Joystick Legend', 'Play 1,000 game rounds', 'rocket', 'epic', 1000, (s) => n(s.plays), 'Playing'),
  A('variety-5', 'Explorer', 'Play 5 different games', 'map', 'common', 5, (s) => count(s.playsBy), 'Playing'),
  A('variety-10', 'Globetrotter', 'Play 10 different games', 'route', 'rare', 10, (s) => count(s.playsBy), 'Playing'),
  A('variety-all', 'Completionist', 'Play every game in the arcade', 'grid', 'epic', Object.keys(GAMES).length, (s) => count(s.playsBy), 'Playing'),
  A('marathon', 'Marathon', 'Play 20 rounds in one day', 'footprints', 'rare', 20, (s) => n(s.maxDayRounds), 'Playing'),
  A('night-owl', 'Night Owl', 'Play a round between midnight and 4 AM', 'moon', 'rare', 1, (s) => n(s.nightOwl), 'Playing'),
  A('early-bird', 'Early Bird', 'Play a round between 5 and 7 AM', 'sun', 'rare', 1, (s) => n(s.earlyBird), 'Playing'),
  // Winning
  A('first-win', 'First Victory', 'Win a round against the family', 'medal', 'common', 1, (s) => n(s.wins), 'Winning'),
  A('wins-10', 'Winner Winner', 'Win 10 rounds against the family', 'award', 'rare', 10, (s) => n(s.wins), 'Winning'),
  A('wins-50', 'Unstoppable', 'Win 50 rounds against the family', 'flame', 'epic', 50, (s) => n(s.wins), 'Winning'),
  A('wins-5-games', 'All-Rounder', 'Win in 5 different games', 'layers', 'rare', 5, (s) => count(s.winsBy), 'Winning'),
  A('mp-25', 'Team Player', 'Finish 25 multiplayer rounds', 'users', 'common', 25, (s) => n(s.finishes), 'Winning'),
  A('mp-100', 'Party Animal', 'Finish 100 multiplayer rounds', 'party', 'rare', 100, (s) => n(s.finishes), 'Winning'),
  A('rematch-champ', 'Rematch Champion', 'Win a rematch', 'swords', 'rare', 1, (s) => n(s.rematchWins), 'Winning'),
  A('pb-1', 'Personal Best', 'Beat your own best score', 'star', 'common', 1, (s) => n(s.pbs), 'Winning'),
  A('pb-25', 'Always Improving', 'Beat your own best 25 times', 'gauge', 'rare', 25, (s) => n(s.pbs), 'Winning'),
  A('record-1', 'Family Record', 'Set a family record', 'crown', 'rare', 1, (s) => n(s.records), 'Winning'),
  A('record-5', 'Record Breaker', 'Set 5 family records', 'gem', 'epic', 5, (s) => n(s.records), 'Winning'),
  // Games
  A('kart-win', 'Pole Position', 'Win a Kart Party race', 'flag', 'rare', 1, winsIn('kart'), 'Games'),
  A('kart-10', 'Kart King', 'Win 10 Kart Party races', 'carFront', 'epic', 10, winsIn('kart'), 'Games'),
  A('golf-win', 'Clubhouse Hero', 'Win a Mini Golf round', 'target', 'rare', 1, winsIn('golf'), 'Games'),
  A('trivia-win', 'Brainiac', 'Win Trivia Party', 'brain', 'rare', 1, winsIn('trivia'), 'Games'),
  A('doodle-win', 'Picasso', 'Win Doodle Guess', 'palette', 'rare', 1, winsIn('doodle'), 'Games'),
  A('four-win', 'Four Sight', 'Win Four in a Row against the family', 'circleDot', 'common', 1, winsIn('four'), 'Games'),
  A('checkers-win', 'King Me', 'Win Checkers against the family', 'crown', 'common', 1, winsIn('checkers'), 'Games'),
  A('ludo-win', 'Home Run', 'Win Race Home', 'home', 'common', 1, winsIn('ludo'), 'Games'),
  A('clash-win', 'Colour Master', 'Win Color Clash', 'spade', 'common', 1, winsIn('clash'), 'Games'),
  A('dino-1000', 'Dino Runner', 'Score 1,000 in Dino Dash', 'egg', 'common', 1000, best('dino'), 'Games'),
  A('dino-5000', 'Dino Legend', 'Score 5,000 in Dino Dash', 'egg', 'epic', 5000, best('dino'), 'Games'),
  A('hop-20', 'Sky High', 'Fly through 20 clouds in Sky Hop', 'bird', 'common', 20, best('hop'), 'Games'),
  A('hop-50', 'Cloud Surfer', 'Fly through 50 clouds in Sky Hop', 'bird', 'epic', 50, best('hop'), 'Games'),
  A('snake-300', 'Long Snake', 'Score 300 in Snake', 'worm', 'rare', 300, best('snake'), 'Games'),
  A('2048-10k', 'Big Merger', 'Score 10,000 in 2048', 'grid2', 'rare', 10000, best('2048'), 'Games'),
  A('typing-600', 'Speed Typist', 'Score 600 in Type Racer', 'keyboard', 'rare', 600, best('typing'), 'Games'),
  A('chef-1000', 'Five-Star Kitchen', 'Earn all three stars in Kitchen Rush', 'flame', 'rare', 1000, best('chef'), 'Games'),
  A('dice-250', 'Lucky Roller', 'Score 250 in Dice Party', 'dice', 'rare', 250, best('dice'), 'Games'),
  A('style-450', 'Runway Star', 'Get 4.5 stars in Style Star', 'shirt', 'rare', 450, best('style'), 'Games'),
  A('memory-1000', 'Elephant Memory', 'Score 1,000 in Memory Match', 'layers', 'common', 1000, best('memory'), 'Games'),
  // Daily Word
  A('word-1', 'Word Nerd', 'Solve the Daily Word', 'word', 'common', 1, (s) => n(s.wordSolved), 'Daily Word'),
  A('word-3', 'On a Roll', 'Solve the Daily Word 3 days in a row', 'calendar', 'common', 3, (s) => n(s.wordBest), 'Daily Word'),
  A('word-7', 'Word of the Week', 'Solve the Daily Word 7 days in a row', 'flame', 'rare', 7, (s) => n(s.wordBest), 'Daily Word'),
  A('word-30', 'Lexicon Legend', 'Solve the Daily Word 30 days in a row', 'gem', 'legendary', 30, (s) => n(s.wordBest), 'Daily Word'),
  A('word-genius', 'Genius', 'Solve the Daily Word in two guesses', 'lightbulb', 'epic', 1, (s) => n(s.wordGenius), 'Daily Word'),
  // Game night
  A('night-1', 'Game Night!', 'Play in a family game night', 'party', 'common', 1, (s) => n(s.nights), 'Game night'),
  A('nights-5', 'Party Regular', 'Play in 5 game nights', 'calendar', 'rare', 5, (s) => n(s.nights), 'Game night'),
  A('night-champ', 'Champion', 'Win a family game night', 'trophy', 'epic', 1, (s) => n(s.nightChamps), 'Game night'),
  A('night-champ-3', 'Dynasty', 'Win 3 family game nights', 'crown', 'legendary', 3, (s) => n(s.nightChamps), 'Game night'),
  // Chat
  A('chat-1', 'Hello!', 'Send a message in the family chat', 'chat', 'common', 1, (s) => n(s.chatDays), 'Family chat'),
  A('chat-3', 'Chatterbox', 'Chat 3 days in a row', 'send', 'common', 3, (s) => n(s.chatBest), 'Family chat'),
  A('chat-7', 'Keeping in Touch', 'Chat 7 days in a row', 'heart', 'rare', 7, (s) => n(s.chatBest), 'Family chat'),
  A('chat-30', 'Heart of the Family', 'Chat 30 days in a row', 'sparkles', 'legendary', 30, (s) => n(s.chatBest), 'Family chat'),
  A('reactions-25', 'Crowd Pleaser', 'Get 25 reactions on your messages', 'thumbsUp', 'rare', 25, (s) => n(s.reactions), 'Family chat'),
  A('reactions-100', 'Fan Favourite', 'Get 100 reactions on your messages', 'star', 'epic', 100, (s) => n(s.reactions), 'Family chat'),
  // Levels and seasons
  A('level-5', 'Rising Star', 'Reach level 5', 'star', 'common', 5, (s, r) => levelFor(n(r.xp)), 'Levels'),
  A('level-10', 'Pro', 'Reach level 10', 'zap', 'rare', 10, (s, r) => levelFor(n(r.xp)), 'Levels'),
  A('level-25', 'Legend', 'Reach level 25', 'rocket', 'epic', 25, (s, r) => levelFor(n(r.xp)), 'Levels'),
  A('level-40', 'Family Champion', 'Reach level 40', 'crown', 'legendary', 40, (s, r) => levelFor(n(r.xp)), 'Levels'),
  A('season-podium', 'Podium Finish', 'Finish a season in the top 3', 'medal', 'rare', 1, (s) => n(s.podiums), 'Levels'),
  A('season-champ', 'Season Champion', 'Win a monthly season', 'trophy', 'legendary', 1, (s) => n(s.seasonWins), 'Levels')
];
const ACH = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
export const RARITY = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
const CELEBRATE = new Set(['epic', 'legendary']);

// ---------- Person records ----------
const userKey = (name) => `user/${enc(name)}`;
const blank = (name) => ({ name, xp: 0, seasons: {}, events: [], seen: {}, day: { id: '', c: {} }, stats: {}, ach: {}, trophies: [] });
export const isPerson = (name) => familyNames().includes(name);

async function readUser(name) {
  const entry = await store().getWithMetadata(userKey(name), { type: 'json' });
  return entry ? { rec: { ...blank(name), ...entry.data }, etag: entry.etag } : { rec: blank(name), etag: null };
}
export async function getRecord(name) { return (await readUser(name)).rec; }

const RANK = { play: 0, finish: 1, pb: 2, word: 3, win: 4, record: 5 };
const MERGE = {
  react: { ms: 6 * 3600e3, label: (k) => `${k} reactions on your messages` },
  play: { ms: 2 * 3600e3, label: (k, game) => `Played ${gname(game)} ${k} times` },
  finish: { ms: 2 * 3600e3, label: (k, game) => `Finished ${k} ${gname(game)} rounds with the family` },
  win: { ms: 2 * 3600e3, label: (k, game) => `Won ${gname(game)} ${k} times` }
};

// The grant context handed to change(): add() applies one XP item, honouring its dedup key and cap.
function context(rec, now) {
  const tz = familyTimeZone();
  const day = dayId(now, tz);
  if (rec.day.id !== day) rec.day = { id: day, c: {} };
  for (const [k, t] of Object.entries(rec.seen)) if (now - t > SEEN_KEEP_MS) delete rec.seen[k];
  const gained = [];
  const ctx = {
    now, day, tz, gained,
    seen: (key) => !!rec.seen[key],
    mark: (key) => { rec.seen[key] = now; },
    bump: (bucket, by = 1) => { rec.day.c[bucket] = (rec.day.c[bucket] || 0) + by; return rec.day.c[bucket]; },
    used: (bucket) => rec.day.c[bucket] || 0,
    // Returns true if the XP was granted.
    add({ key, kind, xp, label, game, cap, capMax }) {
      if (key) { if (rec.seen[key]) return false; rec.seen[key] = now; }
      if (cap) { if ((rec.day.c[cap] || 0) >= capMax) return false; rec.day.c[cap] = (rec.day.c[cap] || 0) + 1; }
      if (!(xp > 0)) return false;
      rec.xp = n(rec.xp) + xp;
      const season = seasonOf(now, tz).id;
      rec.seasons[season] = n(rec.seasons[season]) + xp;
      const ev = { kind, xp, at: new Date(now).toISOString(), label, ...(game ? { game } : {}) };
      gained.push({ ...ev });
      // Repeats close together (reactions, another round of the same game) fold into one feed line.
      const last = (rec.events || [])[0];
      // One round's pieces (played + finished + won, a record, the Daily Word) make one line with the best label.
      if (last && game && last.game === game && last.at === ev.at && !last.n && RANK[kind] != null && RANK[last.kind] != null) {
        last.xp += xp;
        if (RANK[kind] > RANK[last.kind]) { last.kind = kind; last.label = label; }
        return true;
      }
      const fold = MERGE[kind];
      if (fold && last && last.kind === kind && (last.game || '') === (game || '') && now - Date.parse(last.firstAt || last.at) < fold.ms) {
        last.n = (last.n || 1) + 1;
        last.xp += xp;
        last.firstAt = last.firstAt || last.at;
        last.at = ev.at;
        last.label = fold.label(last.n, game, label);
        return true;
      }
      rec.events = [ev].concat(rec.events || []).slice(0, MAX_EVENTS);
      return true;
    }
  };
  return ctx;
}

function unlockAll(rec, now) {
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (rec.ach[a.id]) continue;
    let v = 0;
    try { v = a.val(rec.stats, rec); } catch (e) { v = 0; }
    if (v >= a.need) { rec.ach[a.id] = new Date(now).toISOString(); fresh.push(a); }
  }
  return fresh;
}

// Changes one person's record with change(rec, ctx) (CAS, retried). Returns { rec, gained, unlocked, before, after }
// or null for someone who isn't a family member.
async function change(name, fn, { quiet = false } = {}) {
  if (!isPerson(name)) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { rec, etag } = await readUser(name);
    rec.stats = rec.stats || {};
    const now = nowMs();
    const beforeXp = n(rec.xp);
    const ctx = context(rec, now);
    if ((await fn(rec, ctx)) === false && !ctx.gained.length) return { rec, gained: [], unlocked: [], before: levelFor(beforeXp), after: levelFor(beforeXp) };
    const unlocked = unlockAll(rec, now);
    const res = await store().setJSON(userKey(name), rec, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (!res.modified) { await sleep(25 + Math.random() * 90); continue; }
    const out = { rec, gained: ctx.gained, unlocked, before: levelFor(beforeXp), after: levelFor(n(rec.xp)) };
    await announce(name, out, { quiet }).catch((e) => console.error('XP announce failed:', e.message));
    return out;
  }
  throw Object.assign(new Error('Lots happening at once. Try again.'), { status: 409 });
}

// Achievements and level-ups: a push / in-app toast (unless the game page shows its own), and for epic and
// legendary unlocks a celebratory card in the Everyone chat (at most one card every 20 minutes for the family).
async function announce(name, { unlocked, before, after }, { quiet }) {
  if (!quiet) {
    for (const a of unlocked.slice(0, 3)) {
      await sendPush([name], { title: 'Achievement unlocked', body: `${a.name}: ${a.hint}`, url: '/trophies/', tag: `ach-${a.id}` }, { kind: 'other' }).catch(() => 0);
    }
    if (after > before) await sendPush([name], { title: `Level ${after}!`, body: `You are now a ${titleFor(after)}.`, url: '/trophies/', tag: 'xp-level' }, { kind: 'other' }).catch(() => 0);
  }
  const big = unlocked.filter((a) => CELEBRATE.has(a.rarity));
  if (big.length && (await claimCard('ach', 20 * 60 * 1000))) {
    const a = big.sort((x, y) => (x.rarity === 'legendary' ? -1 : 0) - (y.rarity === 'legendary' ? -1 : 0))[0];
    await postMessage({
      author: 'Chowaniec', kind: 'system', room: 'everyone',
      text: `${name} unlocked ${a.name}, a ${RARITY[a.rarity].toLowerCase()} achievement: ${a.hint.charAt(0).toLowerCase()}${a.hint.slice(1)}.`,
      link: { href: `/trophies/?p=${enc(name)}`, label: 'See trophies' }
    }).catch((e) => console.error('Achievement card failed:', e.message));
  }
}

async function claimCard(bucket, gapMs) {
  const key = `card/${bucket}`;
  const entry = await store().getWithMetadata(key, { type: 'json' });
  const now = nowMs();
  if (entry && entry.data && now - entry.data.at < gapMs) return false;
  const res = await store().setJSON(key, { at: now }, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
  return !!res.modified;
}

// ---------- Stats helpers ----------
function countPlay(rec, ctx, game) {
  const s = rec.stats;
  // Stats stop counting after 30 rounds of one game a day, so spamming scores can't farm achievements either.
  if (ctx.bump(`statplay:${game}`) > RULES.playCap * 3) return false;
  s.plays = n(s.plays) + 1;
  s.playsBy = { ...(s.playsBy || {}), [game]: n(s.playsBy && s.playsBy[game]) + 1 };
  const today = ctx.bump('rounds');
  s.maxDayRounds = Math.max(n(s.maxDayRounds), today);
  const h = hourOf(ctx.now, ctx.tz);
  if (h < 4) s.nightOwl = n(s.nightOwl) + 1;
  if (h >= 5 && h < 7) s.earlyBird = n(s.earlyBird) + 1;
  return true;
}
const gname = (game) => (GAMES[game] ? GAMES[game].name : game);

function playItem(rec, ctx, game, key) {
  if (key && ctx.seen(key)) return;
  if (key) ctx.mark(key);
  if (!countPlay(rec, ctx, game)) return;
  ctx.add({ kind: 'play', xp: RULES.play, label: `Played ${gname(game)}`, game, cap: `play:${game}`, capMax: RULES.playCap });
}

// ---------- Hooks ----------

// A score was saved (POST games { action: 'score' }). result is recordScore's answer; session the multiplayer
// session the score came from (or null). Never throws.
export async function xpForScore(name, game, score, result, session) {
  try {
    if (!GAMES[game] || !result) return null;
    const g = GAMES[game];
    return await change(name, (rec, ctx) => {
      const s = rec.stats;
      const sc = Math.round(Number(score)) || 0;
      // The round itself (a session round is granted once, here or when it settles).
      playItem(rec, ctx, game, session ? `play:${session.id}:${session.round}` : null);
      if (g.kind !== 'add') s.bestBy = { ...(s.bestBy || {}), [game]: Math.max(n(s.bestBy && s.bestBy[game]), n(result.best)) };
      const familyRecord = !g.daily && result.isRecord && result.rank === 1 && result.total > 1 && !(g.kind === 'add' && result.wasFirst);
      if (familyRecord) {
        if (!ctx.seen(`recstat:${game}:${ctx.day}`)) { ctx.mark(`recstat:${game}:${ctx.day}`); s.records = n(s.records) + 1; }
        ctx.add({ key: `record:${game}:${ctx.day}`, kind: 'record', xp: RULES.record, label: g.kind === 'add' ? `Took the lead in ${g.name}` : `New family record in ${g.name}`, game });
      } else if (g.kind !== 'add' && result.isRecord && result.previous != null) {
        if (!ctx.seen(`pbstat:${game}:${ctx.day}`)) { ctx.mark(`pbstat:${game}:${ctx.day}`); s.pbs = n(s.pbs) + 1; }
        ctx.add({ key: `pb:${game}:${ctx.day}`, kind: 'pb', xp: RULES.pb, label: `New personal best in ${g.name}`, game });
      }
      if (g.daily && sc > 0 && !ctx.seen(`word:${ctx.day}`)) {
        const streak = s.wordLast === prevDay(ctx.day) ? n(s.wordStreak) + 1 : 1;
        s.wordStreak = streak;
        s.wordLast = ctx.day;
        s.wordBest = Math.max(n(s.wordBest), streak);
        s.wordSolved = n(s.wordSolved) + 1;
        if (sc >= 5) s.wordGenius = n(s.wordGenius) + 1;      // 7 - guesses: solved in 1 or 2
        const bonus = Math.min(RULES.wordStreakMax, (streak - 1) * RULES.wordStreakStep);
        ctx.add({ key: `word:${ctx.day}`, kind: 'word', xp: RULES.word + bonus, label: streak > 1 ? `Solved the Daily Word (${streak}-day streak)` : 'Solved the Daily Word', game });
      }
    }, { quiet: true });
  } catch (e) {
    console.error('XP for score failed:', e.message);
    return null;
  }
}

// A multiplayer (or solo session) round was settled: play / finish / win for everyone in it. Never throws.
export async function xpForRound(session) {
  const r = session && session.results;
  if (!r || !GAMES[r.game]) return [];
  const multi = r.standings.length > 1;
  const g = GAMES[r.game];
  const tag = `${session.id}:${r.round}`;
  const rematch = !!session.rematchBy && r.round >= 2;
  // Each player has their own record, so they are updated side by side.
  return Promise.all(r.standings.map(async (row) => {
    try {
      return await change(row.name, (rec, ctx) => {
        playItem(rec, ctx, r.game, `play:${tag}`);
        if (!multi) return;
        const s = rec.stats;
        if (!ctx.seen(`fstat:${tag}`)) { ctx.mark(`fstat:${tag}`); s.finishes = n(s.finishes) + 1; }
        ctx.add({ key: `fin:${tag}`, kind: 'finish', xp: RULES.finish, label: `Finished ${g.name} with the family`, game: r.game, cap: 'finish', capMax: RULES.finishCap });
        if (r.winner === row.name) {
          if (!ctx.seen(`wstat:${tag}`)) {
            ctx.mark(`wstat:${tag}`);
            s.wins = n(s.wins) + 1;
            s.winsBy = { ...(s.winsBy || {}), [r.game]: n(s.winsBy && s.winsBy[r.game]) + 1 };
            if (rematch) s.rematchWins = n(s.rematchWins) + 1;
          }
          ctx.add({ key: `win:${tag}`, kind: 'win', xp: RULES.win, label: `Won ${g.name}`, game: r.game, cap: 'win', capMax: RULES.winCap });
        }
      }, { quiet: true });
    } catch (e) { console.error('XP for round failed:', e.message); return null; }
  }));
}

// A game night ended: everyone who scored gets the participation XP, the champions the big prize and a trophy.
export async function xpForNight(night) {
  if (!night || !night.id) return [];
  const out = [];
  const champs = new Set(night.champions || []);
  for (const [name, points] of Object.entries(night.scores || {})) {
    if (!(points > 0)) continue;
    try {
      out.push(await change(name, (rec, ctx) => {
        const s = rec.stats;
        if (!ctx.seen(`nstat:${night.id}`)) { ctx.mark(`nstat:${night.id}`); s.nights = n(s.nights) + 1; }
        ctx.add({ key: `night:${night.id}`, kind: 'night', xp: RULES.night, label: `Played ${night.title || 'game night'}` });
        if (champs.has(name)) {
          if (!ctx.seen(`cstat:${night.id}`)) {
            ctx.mark(`cstat:${night.id}`);
            s.nightChamps = n(s.nightChamps) + 1;
            rec.trophies = (rec.trophies || []).concat([{ kind: 'night', id: night.id, title: night.title || 'Family Game Night', at: new Date(ctx.now).toISOString(), room: night.room }]);
          }
          ctx.add({ key: `champ:${night.id}`, kind: 'champion', xp: RULES.champion, label: `Champion of ${night.title || 'game night'}` });
        }
      }));
    } catch (e) { console.error('XP for game night failed:', e.message); }
  }
  return out;
}

// A family member's chat message was stored. Only the first message of each day does anything, and a warm
// function remembers who already chatted today, so most messages cost nothing. Never throws.
const chattedToday = new Map();
export async function xpForChat(name, at) {
  try {
    if (!isPerson(name)) return null;
    const now = Number.isFinite(Date.parse(at)) ? Math.min(Date.parse(at), nowMs()) : nowMs();
    const day = dayId(now);
    if (chattedToday.get(name) === day) return null;
    const res = await change(name, (rec, ctx) => {
      const s = rec.stats;
      if (s.chatLast === ctx.day) return false;
      const streak = s.chatLast === prevDay(ctx.day) ? n(s.chatStreak) + 1 : 1;
      s.chatStreak = streak;
      s.chatLast = ctx.day;
      s.chatBest = Math.max(n(s.chatBest), streak);
      s.chatDays = n(s.chatDays) + 1;
      ctx.add({ key: `chat:${ctx.day}`, kind: 'chat', xp: RULES.chat, label: 'First chat message today' });
      const bonus = RULES.chatStreak[streak] || (streak > 30 && streak % 30 === 0 ? RULES.chatStreak[30] : 0);
      if (bonus) ctx.add({ key: `chatstreak:${ctx.day}`, kind: 'streak', xp: bonus, label: `${streak}-day chat streak` });
    });
    chattedToday.set(name, day);
    return res;
  } catch (e) {
    console.error('XP for chat failed:', e.message);
    return null;
  }
}

// Someone reacted to `author`'s message (only additions, never your own message; one per person per message).
export async function xpForReaction(author, reactor, messageId) {
  try {
    if (!isPerson(author) || author === reactor || !isPerson(reactor)) return null;
    return await change(author, (rec, ctx) => {
      const key = `react:${messageId}:${reactor}`;
      if (ctx.seen(key)) return false;
      ctx.mark(key);
      rec.stats.reactions = n(rec.stats.reactions) + 1;
      ctx.add({ kind: 'react', xp: RULES.react, label: `${reactor} reacted to your message`, cap: 'react', capMax: RULES.reactCap });
    });
  } catch (e) {
    console.error('XP for reaction failed:', e.message);
    return null;
  }
}

// ---------- Seasons ----------
let closedThrough = '';   // the newest season this warm function knows is closed

export async function seasonStandings(id, recs) {
  const list = recs || (await Promise.all(familyNames().map(getRecord)));
  const rows = list.map((r) => ({ name: r.name, points: n(r.seasons && r.seasons[id]), xp: n(r.xp) }))
    .sort((a, b) => b.points - a.points || b.xp - a.xp || (a.name < b.name ? -1 : 1));
  let place = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.points !== rows[i - 1].points) place = i + 1;
    const li = levelInfo(r.xp);
    return { name: r.name, points: r.points, place, level: li.level, title: li.title };
  });
}

// Closes every finished season that isn't closed yet (normally just last month). Idempotent: the season record
// is created with onlyIfNew, so only one request awards the trophy and posts the card.
export async function closeSeasons() {
  const current = seasonOf(nowMs()).id;
  const prev = prevSeasonId(current);
  if (closedThrough >= prev) return [];
  const have = await store().get(`season/${prev}`, { type: 'json' });
  if (have) { closedThrough = prev; return []; }
  const recs = await Promise.all(familyNames().map(getRecord));
  const ids = new Set([prev]);
  for (const r of recs) for (const id of Object.keys(r.seasons || {})) if (id < current) ids.add(id);
  const closed = [];
  for (const id of [...ids].sort()) {
    if (id !== prev && (await store().get(`season/${id}`, { type: 'json' }))) continue;
    const standings = (await seasonStandings(id, recs)).filter((r) => r.points > 0);
    const winners = standings.filter((r) => r.place === 1).map((r) => r.name);
    const info = seasonById(id);
    const doc = { id, name: info.name, closedAt: new Date(nowMs()).toISOString(), standings, winners };
    const res = await store().setJSON(`season/${id}`, doc, { onlyIfNew: true });
    if (!res.modified || !standings.length) continue;
    closed.push(doc);
    await rewardSeason(doc).catch((e) => console.error('Season rewards failed:', e.message));
  }
  closedThrough = prev;
  return closed;
}

async function rewardSeason(doc) {
  if (!doc.standings.length) return;
  for (const row of doc.standings) {
    const podium = doc.standings.length > 1 && row.place <= 3;
    const champ = doc.winners.includes(row.name);
    if (!podium && !champ) continue;
    await change(row.name, (rec, ctx) => {
      if (ctx.seen(`season:${doc.id}`) || (rec.trophies || []).some((t) => t.kind === 'season' && t.id === doc.id)) return false;
      ctx.mark(`season:${doc.id}`);
      if (podium) rec.stats.podiums = n(rec.stats.podiums) + 1;
      if (champ) {
        rec.stats.seasonWins = n(rec.stats.seasonWins) + 1;
        rec.trophies = (rec.trophies || []).concat([{ kind: 'season', id: doc.id, title: `${doc.name} Champion`, points: row.points, at: new Date(ctx.now).toISOString() }]);
      }
    }, { quiet: true }).catch((e) => console.error('Season reward failed:', e.message));
  }
  const top = doc.standings.slice(0, 3).map((r) => `${r.place}. ${r.name} (${r.points.toLocaleString('en-US')})`).join(', ');
  const who = doc.winners.length > 1 ? `${doc.winners.join(' and ')} share the crown` : `${doc.winners[0]} is the season champion`;
  await postMessage({
    author: 'Chowaniec', kind: 'system', room: 'everyone',
    text: `The ${doc.name} season is over! ${who}. Final standings: ${top}. A new season starts now.`,
    link: { href: `/trophies/?season=${doc.id}`, label: 'See the results' }
  }).catch((e) => console.error('Season card failed:', e.message));
  await sendPush(doc.winners, { title: 'Season champion!', body: `You won the ${doc.name} season. Your trophy is in the cabinet.`, url: '/trophies/', tag: `season-${doc.id}` }, { kind: 'other' }).catch(() => 0);
}

export async function pastSeasons(limit = 12) {
  const { blobs } = await store().list({ prefix: 'season/' });
  const ids = blobs.map((b) => b.key.slice(7)).filter((id) => /^\d{4}-\d{2}$/.test(id)).sort().reverse().slice(0, limit);
  return (await Promise.all(ids.map((id) => store().get(`season/${id}`, { type: 'json' })))).filter((d) => d && d.standings && d.standings.length);
}

// ---------- Views (the xp function) ----------
const achView = (a, at, s, rec) => {
  const v = Math.min(a.need, Math.max(0, Math.floor((() => { try { return a.val(s, rec); } catch (e) { return 0; } })())));
  return { id: a.id, name: a.name, hint: a.hint, icon: a.icon, rarity: a.rarity, group: a.group, unlockedAt: at || null, progress: at ? a.need : v, need: a.need };
};

export async function meView(name) {
  const rec = await getRecord(name);
  const season = seasonOf(nowMs());
  const standings = await seasonStandings(season.id);
  const mine = standings.find((r) => r.name === name);
  const li = levelInfo(n(rec.xp));
  const latest = Object.entries(rec.ach || {}).sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 5)
    .filter(([id]) => ACH[id]).map(([id, at]) => ({ id, name: ACH[id].name, hint: ACH[id].hint, icon: ACH[id].icon, rarity: ACH[id].rarity, at }));
  return {
    name, ...li,
    season: { id: season.id, name: season.name, endsAt: season.endsAt, points: mine ? mine.points : 0, rank: mine ? mine.place : standings.length, total: standings.length },
    recent: (rec.events || []).slice(0, 12).map((e) => ({ kind: e.kind, xp: e.xp, at: e.at, label: e.label, ...(e.game ? { game: e.game } : {}), ...(e.n ? { count: e.n } : {}) })),
    achievements: { unlocked: Object.keys(rec.ach || {}).filter((id) => ACH[id]).length, total: ACHIEVEMENTS.length },
    latest
  };
}

export async function boardView(kind) {
  const season = seasonOf(nowMs());
  const recs = await Promise.all(familyNames().map(getRecord));
  if (kind === 'all') {
    const rows = recs.map((r) => ({ name: r.name, xp: n(r.xp), ...levelInfo(n(r.xp)), achievements: Object.keys(r.ach || {}).filter((id) => ACH[id]).length }))
      .sort((a, b) => b.xp - a.xp || (a.name < b.name ? -1 : 1));
    let place = 0;
    return { board: 'all', standings: rows.map((r, i) => { if (i === 0 || r.xp !== rows[i - 1].xp) place = i + 1; return { name: r.name, place, xp: r.xp, level: r.level, title: r.title, levelXp: r.levelXp, nextXp: r.nextXp, achievements: r.achievements }; }) };
  }
  const standings = await seasonStandings(season.id, recs);
  return { board: 'season', season, standings };
}

export async function profileView(name) {
  const rec = await getRecord(name);
  const s = rec.stats || {};
  const bests = (await Promise.all(Object.keys(GAMES).map(async (game) => {
    const rows = await leaderboard(game).catch(() => []);
    const i = rows.findIndex((r) => r.name === name);
    return i < 0 ? null : { game, name: GAMES[game].name, kind: GAMES[game].kind, score: rows[i].score, rank: i + 1, total: rows.length, plays: rows[i].plays };
  }))).filter(Boolean).sort((a, b) => a.rank - b.rank || b.plays - a.plays);
  return {
    name, ...levelInfo(n(rec.xp)),
    achievements: ACHIEVEMENTS.map((a) => achView(a, rec.ach && rec.ach[a.id], s, rec)),
    trophies: (rec.trophies || []).slice().sort((a, b) => (a.at < b.at ? 1 : -1)),
    bests,
    stats: {
      plays: n(s.plays), wins: n(s.wins), games: count(s.playsBy), finishes: n(s.finishes), records: n(s.records),
      wordStreak: s.wordLast && (s.wordLast === dayId(nowMs()) || s.wordLast === prevDay(dayId(nowMs()))) ? n(s.wordStreak) : 0, wordBest: n(s.wordBest),
      chatStreak: s.chatLast && (s.chatLast === dayId(nowMs()) || s.chatLast === prevDay(dayId(nowMs()))) ? n(s.chatStreak) : 0, chatBest: n(s.chatBest),
      nights: n(s.nights), nightChamps: n(s.nightChamps), seasonWins: n(s.seasonWins), reactions: n(s.reactions)
    },
    recent: (rec.events || []).slice(0, 20)
  };
}
