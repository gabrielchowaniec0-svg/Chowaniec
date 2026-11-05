// Live location sharing in the chats (store and privacy rules: netlify/lib/location-store.mjs).
//   POST { action: 'start', room, minutes: 15|60|480, lat?, lng?, acc? } -> { share, message, existing }  posts the live card
//   POST { action: 'update', id, lat, lng, acc, heading?, speed? }      -> { share }   the sharer only, at most every 10 s (429)
//   POST { action: 'stop', id }                                         -> { share }   the sharer only
//   POST { action: 'extend', id, minutes: 15|60|480 }                   -> { share }   never past 8 hours from now
//   POST { action: 'home', room }                                       -> { message, stopped }  "I'm home safe" (stops sharing there)
//   GET ?room=<id>   -> { shares, now }    every share in that chat (members only)
//   GET ?active=1    -> { sharing: [{ id, name, until, room, roomName, mine, paused }], now }  across my chats
//   GET ?id=<share>  -> { share, now }
import { getUser, json } from '../lib/auth.mjs';
import { resolveRoom, canAccessRoom } from '../lib/rooms.mjs';
import { publishMessage } from '../lib/group-post.mjs';
import {
  clock, isShareId, getShare, sharesInRoom, activeFor, publicShare,
  startShare, notifyStart, updateShare, stopShare, extendShare, homeSafe
} from '../lib/location-store.mjs';

const now = () => new Date(clock.now()).toISOString();

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  if (user.name === 'Guest') return json(403, { error: 'Location sharing is for the family.' });
  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      if (url.searchParams.get('active')) return json(200, { sharing: await activeFor(user.name), now: now() });
      const id = url.searchParams.get('id');
      if (id) {
        const rec = isShareId(id) ? await getShare(id) : null;
        if (!rec || !canAccessRoom(user.name, rec.room)) return json(404, { error: 'That location share isn’t there any more.' });
        return json(200, { share: publicShare(rec), now: now() });
      }
      const room = resolveRoom(url.searchParams.get('room'), user);
      return json(200, { shares: (await sharesInRoom(room)).map(publicShare), now: now() });
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });

    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    if (!body || typeof body !== 'object') return json(400, { error: 'Invalid request.' });

    if (body.action === 'start') {
      const room = resolveRoom(body.room, user);
      const out = await startShare(user.name, room, body.minutes, body.lat != null ? body : null);
      if (!out.existing) await notifyStart(out.share, out.minutes);
      return json(200, { share: publicShare(out.share), message: out.message || null, existing: out.existing, now: now() });
    }
    if (body.action === 'home') {
      const room = resolveRoom(body.room, user);
      const out = await homeSafe(user.name, room);
      await publishMessage(out.message);
      return json(200, { message: out.message, stopped: out.stopped.map(publicShare), now: now() });
    }

    // The rest act on one share, which must be in a chat the caller is in.
    const id = String(body.id || '');
    const rec = isShareId(id) ? await getShare(id) : null;
    if (!rec || !canAccessRoom(user.name, rec.room)) return json(404, { error: 'That location share isn’t there any more.' });
    let out;
    if (body.action === 'update') out = await updateShare(user.name, id, body);
    else if (body.action === 'stop') out = await stopShare(user.name, id);
    else if (body.action === 'extend') out = await extendShare(user.name, id, body.minutes);
    else return json(400, { error: 'Unknown action.' });
    return json(200, { share: publicShare(out), now: now() });
  } catch (e) {
    if (e.status) return json(e.status, { error: e.message, ...(e.retryIn ? { retryIn: e.retryIn } : {}) });
    console.error('Location error:', e);
    return json(500, { error: 'Something went wrong with location sharing.' });
  }
};
