// Calls from a chat (see ../lib/calls.mjs).
//   GET  ?incoming=1&since=<id>      -> { call | null, inbox: { items, cursor } }  the call ringing for you and new
//                                       in-app notifications (see ../lib/inbox.mjs); also marks you as "online"
//   GET  ?id=<callId>                -> { call }          how a call you're in is going (the caller's screen)
//   POST { action: 'start', room }   -> { call }          rings everyone else in that chat
//   POST { action: 'answer' | 'decline' | 'cancel', id } -> { call }
import { getUser, json } from '../lib/auth.mjs';
import { resolveRoom } from '../lib/rooms.mjs';
import { startCall, incomingFor, respond, sendMissed, markSeen, publicCall } from '../lib/calls.mjs';
import { readInbox } from '../lib/inbox.mjs';

const MIN_GAP_MS = 10 * 1000;   // one call at a time per person (guards against double taps)
const lastStart = new Map();

export default async (req, context) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      if (url.searchParams.get('incoming')) {
        const [call, inbox] = await Promise.all([incomingFor(user.name), readInbox(user.name, url.searchParams.get('since') || ''), markSeen(user.name)]);
        return json(200, { call, inbox });
      }
      const result = await respond(user.name, url.searchParams.get('id') || '', 'check');
      if (!result) return json(404, { error: 'Call not found.' });
      if (result.stopped) context.waitUntil(sendMissed(result.call.id).catch((e) => console.error('Missed call push failed:', e.message)));
      return json(200, { call: result.call });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json(400, { error: 'Invalid request.' });
    }

    if (body.action === 'start') {
      const room = resolveRoom(body.room, user);
      if (Date.now() - (lastStart.get(user.name) || 0) < MIN_GAP_MS) return json(429, { error: 'You just started a call. Give it a few seconds.' });
      lastStart.set(user.name, Date.now());
      const { call, tasks } = await startCall(user, room);
      context.waitUntil(Promise.all(tasks));
      return json(200, { call: publicCall(call) });
    }

    if (['answer', 'decline', 'cancel'].includes(body.action)) {
      const result = await respond(user.name, String(body.id || ''), body.action);
      if (!result) return json(404, { error: 'Call not found.' });
      if (result.stopped) context.waitUntil(sendMissed(result.call.id).catch((e) => console.error('Missed call push failed:', e.message)));
      return json(200, { call: result.call });
    }

    return json(400, { error: 'Unknown action.' });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Call error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};

export const config = {
  // Every open page checks for incoming calls every few seconds, and the family shares one home IP.
  rateLimit: { windowLimit: 900, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
