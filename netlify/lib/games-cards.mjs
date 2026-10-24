// Live game cards in the chats: an invite posts a card message ({ game: { session, gameId, by, snap } }) that the chat
// page keeps fresh (GET games?cards=...), turns into a results card with a podium when a round is over, and offers
// a one-tap rematch. Also the "new family record" cards. See netlify/functions/games.mjs.
import { postMessage, updateMessage, getMessage, AI_NAME } from './group-store.mjs';
import { roomMembers, canAccessRoom, DEFAULT_ROOM } from './rooms.mjs';
import { sendPush } from './push.mjs';
import { GAMES, getSession, createSession, noteInvite, noteCard, rematchSession, claimRecordPost } from './games-store.mjs';
import { awardRound } from './game-night.mjs';

export const gamePath = (session) => `/games/${session.game}/?s=${session.id}`;
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const err = (status, message) => Object.assign(new Error(message), { status });

// What a card shows (also stored on the message as `snap`, so the card still reads right after the session expires).
export function cardInfo(session) {
  const g = GAMES[session.game];
  return {
    sid: session.id, game: session.game, name: g.name, mode: g.mode, max: g.max,
    status: session.status, round: session.round, players: session.players.slice(), host: session.host,
    results: session.results || null, rematchBy: session.rematchBy || null, rematchAt: session.rematchAt || null,
    label: session.label || '', night: session.night || null, at: new Date().toISOString()
  };
}

// May this person see the card for `session` in `room`?
export const canSeeCard = (name, session, room) =>
  canAccessRoom(name, room) && ((session.invitedTo || []).includes(room) || session.room === room);

// Posts a game card into a chat (an invite). Returns the message.
export async function postGameCard(user, session, room, { text } = {}) {
  const g = GAMES[session.game];
  const message = await postMessage({
    author: user.name, room, kind: 'user',
    text: text || `${user.name} started a game of ${g.name}`,
    game: { session: session.id, gameId: session.game, by: user.name, snap: cardInfo(session) }
  });
  await noteCard(session.id, room, message.id).catch((e) => console.error('Note card failed:', e.message));
  return message;
}

// Copies the session's latest state onto its card messages.
export async function refreshCards(session) {
  const fresh = await getSession(session.id) || session;
  const snap = cardInfo(fresh);
  await Promise.all((fresh.cards || []).map((c) => updateMessage(c.id, c.room, (m) => {
    if (!m.game || m.game.session !== fresh.id) return false;
    m.game = { ...m.game, snap };
  }).catch((e) => console.error('Card update failed:', e.message))));
}

// A round just ended: cards show the results and a game night gets its points.
export async function afterSettle(session) {
  await refreshCards(session);
  if (session.night) {
    try { await awardRound(session); } catch (e) { console.error('Game night points failed:', e.message); }
  }
}

// Invites a chat: posts the live card once per chat and notifies the people there.
export async function inviteChat(user, session, room) {
  const g = GAMES[session.game];
  if ((session.invitedTo || []).includes(room) && (session.cards || []).some((c) => c.room === room)) return null;
  await noteInvite(session.id, room);
  const message = await postGameCard(user, session, room);
  const others = roomMembers(room).filter((n) => n !== user.name);
  if (others.length) {
    await sendPush(others, {
      title: `${user.name} wants to play ${g.name}`,
      body: 'Tap to join the game',
      url: gamePath(session),
      tag: `game-${session.id}`,
      from: user.name
    }, { exclude: user.name, kind: 'message', room }).catch((e) => console.error('Game invite push failed:', e.message));
  }
  return message;
}

// One tap on "Rematch": the same session goes back to its lobby (or, if it has expired, a new one starts with a
// fresh card), the person who tapped hosts it, and the other players are asked to come back.
export async function rematch(user, { id, room, msg }) {
  let session = await getSession(id);
  let prevPlayers = [];
  let gameId = null;
  if (session) {
    if (session.room && !canAccessRoom(user.name, session.room)) throw err(403, 'This game is only for the people in that chat.');
    if (!session.players.includes(user.name) && !canSeeCard(user.name, session, room)) throw err(403, 'You’re not in that chat.');
    gameId = session.game;
    prevPlayers = session.players.slice();
    if (session.status === 'playing' && !(session.results && session.results.round === session.round)) {
      return { url: gamePath(session), session, still: true };
    }
    session = await rematchSession(id, user.name);
  } else {
    const found = msg ? await getMessage(msg, room) : null;
    const card = found && found.message.game;
    if (!card || card.session !== id) throw err(404, 'That game has ended. Start a new one!');
    gameId = card.gameId;
    prevPlayers = (card.snap && card.snap.players) || [];
    session = await createSession(user.name, gameId, { open: true });
    await noteInvite(session.id, room);
    await postGameCard(user, session, room, { text: `${user.name} wants a rematch of ${GAMES[gameId].name}` });
    session = await rematchSession(session.id, user.name);
  }
  await refreshCards(session);
  const g = GAMES[gameId];
  const others = prevPlayers.filter((n) => n !== user.name);
  if (others.length) {
    await sendPush(others, {
      title: `${user.name} wants a rematch!`,
      body: `Tap to play ${g.name} again`,
      url: gamePath(session), tag: `game-${session.id}`, from: user.name
    }, { exclude: user.name, kind: 'mention', room }).catch((e) => console.error('Rematch push failed:', e.message));
  }
  return { url: `${gamePath(session)}&rematch=1`, session };
}

// A score that is a new family #1 gets a celebratory card in the chat the game was played from (or Everyone).
export async function maybePostRecord(user, game, result, session) {
  const g = GAMES[game];
  if (!g || !result || !result.isRecord || result.rank !== 1 || !(result.total > 1)) return null;
  if (g.kind === 'add' && result.wasFirst) return null;      // already the leader: one more win isn't news
  const rooms = (session && (session.room ? [session.room] : session.invitedTo)) || [];
  const room = rooms.find((r) => canAccessRoom(user.name, r)) || (canAccessRoom(user.name, DEFAULT_ROOM) ? DEFAULT_ROOM : null);
  if (!room) return null;
  if (!(await claimRecordPost(game, user.name))) return null;
  const text = g.kind === 'add'
    ? `${user.name} took the lead in ${g.name} with ${fmt(result.best)} win${result.best === 1 ? '' : 's'}!`
    : `${user.name} set a new ${g.name} record: ${fmt(result.best)}!`;
  return postMessage({ author: AI_NAME, kind: 'ai', room, text, record: { game, name: user.name, score: result.best, kind: g.kind } });
}
