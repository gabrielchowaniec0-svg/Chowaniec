// Chowaniec Watch Party API (see ../lib/watch-store.mjs). Every response carries X-Server-Time (server clock),
// so phones whose clocks are off still play the video at the same moment.
//   GET  ?party=<id>&since=<feed id>&s=ok|tap|buf  -> { party, feed, cursor, watchers, canControl }   (also checks you in)
//   GET  ?chats=1                                 -> { chats: [{ id, name, dm }] }   where invites can go
//   GET  ?active=1                                -> { parties }   running parties you can join
//   GET  ?info=<videoId>                          -> { title, channel }
//   POST { action: 'create', room?, video?, t?, anyone? } -> { party }   room: members only, and that chat is invited
//   POST { action: 'meet', code }                 -> { party }   the party for a Meet call (made on first use)
//   POST { action: 'control', id, version, op: play|pause|seek|rate|next|ended|duration, position?, rate?, duration? } -> { party }
//        (409 + party if someone changed the video first)
//   POST { action: 'queue', id, op: add|remove|up|play, video?, t?, qid?, playNow? } -> { party }
//   POST { action: 'react', id, k: heart|laugh|wow|clap } -> { item }
//   POST { action: 'chat', id, text }             -> { item }
//   POST { action: 'join' | 'leave', id }         -> { ok }
//   POST { action: 'invite', id, room }           -> { ok, already }   posts "X started a watch party" in that chat and notifies it
//   POST { action: 'settings', id, anyone }       -> { party }   host only
import { getUser, json } from '../lib/auth.mjs';
import { resolveRoom, roomsFor, dmPartners, roomMembers, isDmId } from '../lib/rooms.mjs';
import { postMessage } from '../lib/group-store.mjs';
import { sendPush } from '../lib/push.mjs';
import {
  isPartyId, isVideoId, videoInfo, getParty, guard, createParty, meetParty, activeParties, control, queueOp, setSettings,
  addFeed, readFeed, checkIn, leave, watchersFrom, canControl, noteInvite, publicParty, partyPath
} from '../lib/watch-store.mjs';

export default async (req) => {
  const res = await handle(req);
  try { res.headers.set('X-Server-Time', String(Date.now())); } catch (e) { /* immutable headers: skip */ }
  try { res.headers.set('Cache-Control', 'no-store'); } catch (e) { /* skip */ }
  return res;
};

const err = (status, message) => Object.assign(new Error(message), { status });

async function video(body) {
  const id = String(body.video || '');
  if (!isVideoId(id)) throw err(400, 'That doesn’t look like a YouTube link.');
  const info = await videoInfo(id);
  const t = Math.max(0, Math.min(Number(body.t) || 0, 24 * 3600));
  return { videoId: id, ...info, startAt: t };
}

async function invite(user, party, room) {
  if (!(await noteInvite(user, party.id, room))) return { ok: true, already: true };
  const title = party.state.videoId ? party.state.title : '';
  const text = (party.host === user.name ? `${user.name} started a watch party` : `${user.name} invited you to a watch party`) + (title ? `: ${title}` : '');
  await postMessage({ author: 'Chowaniec', room, kind: 'system', text, link: { href: partyPath(party.id), label: 'Join' } });
  const others = roomMembers(room).filter((n) => n !== user.name);
  if (others.length) {
    await sendPush(others, {
      title: `${user.name} started a watch party`,
      body: title ? `${title} · Tap to watch together` : 'Tap to watch together',
      url: partyPath(party.id), tag: `watch-${party.id}`, from: user.name
    }, { exclude: user.name, kind: isDmId(room) ? 'mention' : 'message', room }).catch((e) => console.error('Watch invite push failed:', e.message));
  }
  return { ok: true, already: false };
}

async function handle(req) {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);

  try {
    if (req.method === 'GET') {
      if (q('party')) {
        const id = q('party');
        const party = guard(user, isPartyId(id) ? await getParty(id) : null);
        const [live, feed, may] = await Promise.all([
          checkIn(user.name, id, q('s') || 'ok'), readFeed(id, q('since') || ''), canControl(user.name, party)
        ]);
        return json(200, { party: publicParty(party), feed: feed.items, cursor: feed.cursor, watchers: watchersFrom(live), canControl: may, me: user.name });
      }
      if (q('chats')) {
        const chats = roomsFor(user.name).map((r) => ({ id: r.id, name: r.name, dm: false, members: r.members }))
          .concat(dmPartners(user.name).filter((p) => !p.ai).map((p) => ({ id: p.id, name: p.name, dm: true })));
        return json(200, { chats });
      }
      if (q('active')) return json(200, { parties: await activeParties(user) });
      if (q('info')) return json(200, await videoInfo(q('info')));
      return json(400, { error: 'Unknown request.' });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    const id = String(body.id || '');
    const known = async () => guard(user, isPartyId(id) ? await getParty(id) : null);

    switch (body.action) {
      case 'create': {
        const room = body.room ? resolveRoom(body.room, user) : null;
        const v = body.video ? await video(body) : null;
        const party = await createParty(user, { room, video: v, startAt: v ? v.startAt : 0, anyone: body.anyone !== false });
        await checkIn(user.name, party.id, 'ok');
        if (room) await invite(user, party, room);
        return json(200, { party: publicParty(await getParty(party.id)) });
      }
      case 'meet': {
        const { party } = await meetParty(user, String(body.code || ''));
        return json(200, { party: publicParty(party) });
      }
      case 'control': {
        try {
          const party = await control(user, id, { version: body.version, op: String(body.op || ''), position: body.position, rate: body.rate, duration: body.duration });
          return json(200, { party: publicParty(party) });
        } catch (e) {
          if (e.status === 409) return json(409, { error: e.message, party: publicParty(await known()) });
          throw e;
        }
      }
      case 'queue': {
        const op = String(body.op || '');
        const v = op === 'add' ? await video(body) : null;
        const party = await queueOp(user, id, { op, video: v, qid: String(body.qid || ''), playNow: !!body.playNow });
        return json(200, { party: publicParty(party) });
      }
      case 'react': return json(200, { item: await addFeed(user, id, { t: 'r', k: String(body.k || '') }) });
      case 'chat': return json(200, { item: await addFeed(user, id, { t: 'c', text: body.text }) });
      case 'join': {
        await known();
        await checkIn(user.name, id, String(body.s || 'tap'));
        return json(200, { ok: true });
      }
      case 'leave': {
        if (isPartyId(id)) await leave(user.name, id);
        return json(200, { ok: true });
      }
      case 'invite': {
        const party = await known();
        const room = resolveRoom(body.room, user);
        return json(200, await invite(user, party, room));
      }
      case 'settings': return json(200, { party: publicParty(await setSettings(user, id, { anyone: body.anyone })) });
      default: return json(400, { error: 'Unknown action.' });
    }
  } catch (e) {
    if (e.status) return json(e.status, { error: e.message });
    console.error('Watch error:', e);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}

export const config = {
  // Everyone watching checks in about once a second and a half.
  rateLimit: { windowLimit: 1500, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
