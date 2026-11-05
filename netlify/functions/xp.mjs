// Family XP & seasons API (see ../lib/xp.mjs). Read-only: XP is only granted by the server itself.
//   GET ?me=1             -> { name, level, xp, levelXp, nextXp, toNext, title, season: { id, name, endsAt, points, rank, total },
//                              recent: [{ kind, xp, at, label, game? }], achievements: { unlocked, total }, latest: [last 5 unlocks] }
//   GET ?board=season|all -> { board, season?, standings: [{ name, place, points | xp, level, title, ... }] }
//   GET ?profile=<name>   -> { name, level, xp, levelXp, nextXp, title, achievements: [...], trophies: [...], bests: [...], stats, recent }
//   GET ?seasons=1        -> { seasons: [{ id, name, closedAt, standings, winners }] }   finished seasons, newest first
//   GET ?rules=1          -> { rules, titles, levels: [{ level, xp, title }] }
// Every request first closes any season that has ended (idempotent), so the results card appears on the first
// visit after the month changes.
import { getUser, json } from '../lib/auth.mjs';
import { meView, boardView, profileView, pastSeasons, closeSeasons, isPerson, RULES, TITLES, xpForLevel, titleFor } from '../lib/xp.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  if (req.method !== 'GET') return json(405, { error: 'XP is earned by playing, not posted.' });
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);
  try {
    await closeSeasons().catch((e) => console.error('Season close failed:', e.message));
    if (q('me')) {
      if (!isPerson(user.name)) return json(200, { name: user.name, guest: true, level: 1, xp: 0, levelXp: 0, nextXp: xpForLevel(2), toNext: xpForLevel(2), title: titleFor(1), season: null, recent: [], achievements: { unlocked: 0, total: 0 }, latest: [] });
      return json(200, await meView(user.name));
    }
    if (q('board')) {
      const kind = q('board') === 'all' ? 'all' : 'season';
      return json(200, await boardView(kind));
    }
    if (q('profile')) {
      const name = String(q('profile'));
      if (!isPerson(name)) return json(404, { error: 'No one by that name in the family.' });
      return json(200, await profileView(name));
    }
    if (q('seasons')) return json(200, { seasons: await pastSeasons() });
    if (q('rules')) {
      const levels = [];
      for (let n = 1; n <= 50; n++) levels.push({ level: n, xp: xpForLevel(n), title: titleFor(n) });
      return json(200, { rules: RULES, titles: TITLES, levels });
    }
    return json(400, { error: 'Unknown request.' });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('XP error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};

export const config = {
  rateLimit: { windowLimit: 600, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
