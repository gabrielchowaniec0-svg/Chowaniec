// Chowaniec Games API (see ../lib/games-store.mjs).
//   GET  ?boards=1                     -> { games: { <id>: { name, emoji, top: [3], mine } } }   for the games page
//   GET  ?board=<game>                 -> { top: [...], mine, today? }   today = Daily Word results
//   GET  ?chats=1                      -> { chats: [{ id, name, dm }] }  where invites can go
//   GET  ?session=<id>                 -> { session, players }           players = live race states
//   GET  ?cards=<sid,sid>&room=<room>  -> { cards: { <sid>: info | null } }   live game cards in a chat (members only)
//   GET  ?night=<id>                   -> { night }                      a game night card (members of its chat only)
//   GET  ?trophies=1                   -> { trophies: { <name>: { title, until } } }   game night champions
//   POST { action: 'score', game, score, day?, session? } -> { best, previous, isRecord, rank, total }
//        (a new family #1 posts a record card to the session's chat or Everyone, at most hourly)
//   POST { action: 'create', game, room? }           -> { session }   room: also invite that chat
//   POST { action: 'invite', id, room }              -> { ok }        posts a live game card and notifies the chat
//   POST { action: 'result', id, round, score, winner? } -> { session } turn games: my result for the round
//   POST { action: 'rematch', id, room, msg? }       -> { url, session } back to the lobby (or a new session), others asked
//   POST { action: 'night-create', room, date, time, games?, title? } -> { night }
//   POST { action: 'night-start' | 'night-next' | 'night-skip', night, from? } -> { night, url }
//   POST { action: 'join' | 'leave', id }            -> { session }
//   POST { action: 'start', id, shared? }            -> { session }   host only; a 3-second countdown follows
//   POST { action: 'sync', id, state, round }        -> { session, players }
//   POST { action: 'move', id, version, shared, done? } -> { session }  (409 + session if someone moved first)
//   POST { action: 'finish', id }                    -> { session }
//   POST { action: 'image', data (data: URL) }       -> { id }        a custom puzzle picture; GET ?image=<id> returns it
import { getUser, json, familyNames } from '../lib/auth.mjs';
import { resolveRoom, roomsFor, dmPartners, isDmId, canAccessRoom } from '../lib/rooms.mjs';
import { familyTimeZone } from '../lib/group-store.mjs';
import {
  GAMES, isGame, isSessionId, recordScore, leaderboard, dailyResults, familyDay, createSession, getSession, joinSession, leaveSession,
  startRound, finishRound, makeMove, syncPlayer, playerStates, saveImage, getImage, reportResult, settleRound, settleIfOver, listTrophies
} from '../lib/games-store.mjs';
import { inviteChat, cardInfo, canSeeCard, afterSettle, refreshCards, rematch, maybePostRecord } from '../lib/games-cards.mjs';
import { getNight, nightInfo, createGameNight, startNight, nextGame } from '../lib/game-night.mjs';

// A round that just ended is settled here (whoever's request notices first): results are saved, chat cards
// updated and game night points awarded.
async function settle(session, states) {
  if (!session || !settleRound(session, states || {})) return session;
  const { session: fresh, settled } = await settleIfOver(session.id);
  if (settled) await afterSettle(fresh);
  return fresh || session;
}

// Game night sessions belong to one chat: only its members may see or join them.
function guard(session, user) {
  if (session && session.room && !canAccessRoom(user.name, session.room)) throw Object.assign(new Error('This game is only for the people in that chat.'), { status: 403 });
  return session;
}

// Every response carries the server clock, so devices with a wrong clock still start rounds together.
export default async (req) => {
  const res = await handle(req);
  try { res.headers.set('X-Server-Time', String(Date.now())); } catch (e) { /* immutable headers: skip */ }
  return res;
};

async function handle(req) {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);

  try {
    if (req.method === 'GET') {
      if (q('boards')) {
        const games = {};
        await Promise.all(Object.entries(GAMES).map(async ([id, g]) => {
          const board = await leaderboard(id);
          games[id] = { name: g.name, emoji: g.emoji, kind: g.kind, top: board.slice(0, 3), mine: board.find((r) => r.name === user.name) || null, players: board.length };
        }));
        return json(200, { games });
      }
      if (q('board')) {
        const game = q('board');
        if (!isGame(game)) return json(404, { error: 'Unknown game.' });
        const top = await leaderboard(game);
        const out = { top: top.slice(0, 20), mine: top.find((r) => r.name === user.name) || null };
        if (GAMES[game].daily) {
          const day = familyDay(familyTimeZone());
          out.day = day;
          out.today = await dailyResults(game, day, familyNames());
        }
        return json(200, out);
      }
      if (q('chats')) {
        const chats = roomsFor(user.name).map((r) => ({ id: r.id, name: r.name, dm: false }))
          .concat(dmPartners(user.name).filter((p) => !p.ai).map((p) => ({ id: p.id, name: p.name, dm: true })));
        return json(200, { chats });
      }
      if (q('image')) {
        const img = await getImage(q('image'));
        if (!img) return json(404, { error: 'Picture not found.' });
        return new Response(img.bytes, { headers: { 'Content-Type': img.contentType, 'Cache-Control': 'private, max-age=31536000, immutable' } });
      }
      if (q('session')) {
        let session = guard(await getSession(q('session')), user);
        if (!session) return json(404, { error: 'That game has ended. Start a new one!' });
        const players = await playerStates(session.id, session.players);
        session = await settle(session, players);
        return json(200, { session, players });
      }
      if (q('cards')) {
        const room = resolveRoom(q('room'), user);
        const ids = String(q('cards')).split(',').filter(isSessionId).slice(0, 20);
        const cards = {};
        await Promise.all(ids.map(async (sid) => {
          let s = await getSession(sid);
          if (!s || !canSeeCard(user.name, s, room)) { cards[sid] = null; return; }
          const mode = GAMES[s.game].mode;
          if ((mode === 'race' && s.status === 'playing') || (mode === 'turns' && s.status === 'done')) s = await settle(s, mode === 'race' ? await playerStates(s.id, s.players) : {});
          cards[sid] = cardInfo(s);
        }));
        return json(200, { cards });
      }
      if (q('night')) {
        const night = await getNight(q('night'));
        if (!night || !canAccessRoom(user.name, night.room)) return json(404, { error: 'That game night is gone.' });
        return json(200, { night: await nightInfo(night) });
      }
      if (q('trophies')) {
        const all = await listTrophies();
        const trophies = {};
        for (const [name, t] of Object.entries(all)) if (!t.room || canAccessRoom(user.name, t.room)) trophies[name] = { title: t.title, until: t.until };
        return json(200, { trophies });
      }
      return json(400, { error: 'Unknown request.' });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json(400, { error: 'Invalid request.' });
    }
    const id = String(body.id || '');

    switch (body.action) {
      case 'score': {
        const game = String(body.game || '');
        const day = isGame(game) && GAMES[game].daily ? familyDay(familyTimeZone()) : undefined;
        const result = await recordScore(user.name, game, body.score, { day });
        try {
          const session = isSessionId(String(body.session || '')) ? await getSession(String(body.session)) : null;
          await maybePostRecord(user, game, result, session && session.players.includes(user.name) ? session : null);
        } catch (e) { console.error('Record card failed:', e.message); }
        return json(200, result);
      }
      case 'create': {
        const room = body.room ? resolveRoom(body.room, user) : null;
        const session = await createSession(user.name, String(body.game || ''));
        if (room) await inviteChat(user, session, room);
        return json(200, { session: await getSession(session.id) });
      }
      case 'invite': {
        const session = guard(await getSession(id), user);
        if (!session) return json(404, { error: 'That game has ended. Start a new one!' });
        if (!session.players.includes(user.name)) return json(403, { error: 'Join the game first.' });
        await inviteChat(user, session, resolveRoom(body.room, user));
        return json(200, { ok: true, dm: isDmId(String(body.room || '')) });
      }
      case 'image': return json(200, { id: await saveImage(user.name, body.data) });
      case 'join': {
        const session = await joinSession(id, user.name, { canJoinRoom: (room) => canAccessRoom(user.name, room) });
        await refreshCards(session);
        return json(200, { session });
      }
      case 'leave': {
        const session = await leaveSession(id, user.name);
        await refreshCards(session);
        return json(200, { session });
      }
      case 'start': {
        const session = await startRound(id, user.name, body.shared);
        await refreshCards(session);
        return json(200, { session });
      }
      case 'finish': return json(200, { session: await finishRound(id, user.name) });
      case 'result': {
        let session = guard(await getSession(id), user);
        if (!session) return json(404, { error: 'That game has ended.' });
        if (GAMES[session.game].mode === 'turns') session = await reportResult(id, user.name, { round: body.round, score: body.score, winner: body.winner });
        session = await settle(session, GAMES[session.game].mode === 'race' ? await playerStates(id, session.players) : {});
        return json(200, { session });
      }
      case 'rematch': {
        const room = resolveRoom(body.room, user);
        if (!isSessionId(id)) return json(400, { error: 'Unknown game.' });
        return json(200, await rematch(user, { id, room, msg: String(body.msg || '') }));
      }
      case 'night-create': {
        const room = resolveRoom(body.room, user);
        const { night } = await createGameNight(user, { room, date: String(body.date || ''), time: String(body.time || ''), games: body.games, title: body.title, via: 'manual' });
        return json(200, { night: await nightInfo(night) });
      }
      case 'night-start':
      case 'night-next':
      case 'night-skip': {
        const nid = String(body.night || '');
        const found = await getNight(nid);
        if (!found || !canAccessRoom(user.name, found.room)) return json(404, { error: 'That game night is gone.' });
        const res = body.action === 'night-start' ? await startNight(nid, user.name) : await nextGame(nid, user, { from: body.from, skip: body.action === 'night-skip' });
        return json(200, { night: await nightInfo(await getNight(nid)), url: res.url || null });
      }
      case 'sync': {
        const session = guard(await getSession(id), user);
        if (!session) return json(404, { error: 'That game has ended.' });
        if (!session.players.includes(user.name)) return json(403, { error: 'Join the game first.' });
        const players = await syncPlayer(id, user.name, body.state, body.round, session.players);
        return json(200, { session: await settle(session, players), players });
      }
      case 'move': {
        try {
          const session = await makeMove(id, user.name, body.version, body.shared, !!body.done);
          if (session.status === 'done') await refreshCards(session);
          return json(200, { session });
        } catch (e) {
          if (e.status === 409) return json(409, { error: e.message, session: await getSession(id) });
          throw e;
        }
      }
      default: return json(400, { error: 'Unknown action.' });
    }
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Games error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}

export const config = {
  // Races sync a few times a second from every player.
  rateLimit: { windowLimit: 2400, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
