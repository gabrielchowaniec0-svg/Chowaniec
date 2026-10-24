// Chowaniec Games API (see ../lib/games-store.mjs).
//   GET  ?boards=1                     -> { games: { <id>: { name, emoji, top: [3], mine } } }   for the games page
//   GET  ?board=<game>                 -> { top: [...], mine, today? }   today = Daily Word results
//   GET  ?chats=1                      -> { chats: [{ id, name, dm }] }  where invites can go
//   GET  ?session=<id>                 -> { session, players }           players = live race states
//   POST { action: 'score', game, score, day? }      -> { best, previous, isRecord, rank, total }
//   POST { action: 'create', game, room? }           -> { session }   room: also invite that chat
//   POST { action: 'invite', id, room }              -> { ok }        posts a "Join game" link and notifies the chat
//   POST { action: 'join' | 'leave', id }            -> { session }
//   POST { action: 'start', id, shared? }            -> { session }   host only; a 3-second countdown follows
//   POST { action: 'sync', id, state, round }        -> { session, players }
//   POST { action: 'move', id, version, shared, done? } -> { session }  (409 + session if someone moved first)
//   POST { action: 'finish', id }                    -> { session }
//   POST { action: 'image', data (data: URL) }       -> { id }        a custom puzzle picture; GET ?image=<id> returns it
import { getUser, json, familyNames } from '../lib/auth.mjs';
import { resolveRoom, roomsFor, dmPartners, isDmId, roomMembers } from '../lib/rooms.mjs';
import { postMessage, familyTimeZone } from '../lib/group-store.mjs';
import { sendPush } from '../lib/push.mjs';
import {
  GAMES, isGame, recordScore, leaderboard, dailyResults, familyDay, createSession, getSession, joinSession, leaveSession,
  startRound, finishRound, makeMove, noteInvite, syncPlayer, playerStates, saveImage, getImage
} from '../lib/games-store.mjs';

const gamePath = (session) => `/games/${session.game}/?s=${session.id}`;

async function invite(user, session, rawRoom) {
  const room = resolveRoom(rawRoom, user);
  const game = GAMES[session.game];
  const fresh = !(session.invitedTo || []).includes(room);
  await noteInvite(session.id, room);
  if (!fresh) return;
  await postMessage({
    author: 'Chowaniec', room, kind: 'system',
    text: `${user.name} started a game of ${game.name}`,
    link: { href: gamePath(session), label: 'Join game' }
  });
  const others = roomMembers(room).filter((n) => n !== user.name);
  if (others.length) {
    await sendPush(others, {
      title: `${user.name} wants to play ${game.name}`,
      body: 'Tap to join the game',
      url: gamePath(session),
      tag: `game-${session.id}`,
      from: user.name
    }, { exclude: user.name, kind: 'message', room }).catch((e) => console.error('Game invite push failed:', e.message));
  }
}

export default async (req) => {
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
        const session = await getSession(q('session'));
        if (!session) return json(404, { error: 'That game has ended. Start a new one!' });
        return json(200, { session, players: await playerStates(session.id, session.players) });
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
        return json(200, await recordScore(user.name, game, body.score, { day }));
      }
      case 'create': {
        const session = await createSession(user.name, String(body.game || ''));
        if (body.room) await invite(user, session, body.room);
        return json(200, { session: await getSession(session.id) });
      }
      case 'invite': {
        const session = await getSession(id);
        if (!session) return json(404, { error: 'That game has ended. Start a new one!' });
        if (!session.players.includes(user.name)) return json(403, { error: 'Join the game first.' });
        await invite(user, session, body.room);
        return json(200, { ok: true, dm: isDmId(String(body.room || '')) });
      }
      case 'image': return json(200, { id: await saveImage(user.name, body.data) });
      case 'join': return json(200, { session: await joinSession(id, user.name) });
      case 'leave': return json(200, { session: await leaveSession(id, user.name) });
      case 'start': return json(200, { session: await startRound(id, user.name, body.shared) });
      case 'finish': return json(200, { session: await finishRound(id, user.name) });
      case 'sync': {
        const session = await getSession(id);
        if (!session) return json(404, { error: 'That game has ended.' });
        if (!session.players.includes(user.name)) return json(403, { error: 'Join the game first.' });
        return json(200, { session, players: await syncPlayer(id, user.name, body.state, body.round, session.players) });
      }
      case 'move': {
        try {
          return json(200, { session: await makeMove(id, user.name, body.version, body.shared, !!body.done) });
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
};

export const config = {
  // Races sync a few times a second from every player.
  rateLimit: { windowLimit: 2400, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
