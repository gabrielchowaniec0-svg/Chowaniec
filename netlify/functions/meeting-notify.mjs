// "Meeting started" notification, sent manually by a host from inside Chowaniec Meet.
//   POST { code, people: ['Amelia', ...] | 'all', postToChat?: boolean }
//        -> { sent, people, posted }
// `sent` is how many devices got the notification. Hosts only. Tapping it opens the meeting and
// joins straight away. With postToChat the join link is also posted in the group chat (without a
// second notification).
import { getStore } from '@netlify/blobs';
import { getUser, json, familyNames } from '../lib/auth.mjs';
import { sendPush } from '../lib/push.mjs';
import { postMessage } from '../lib/group-store.mjs';

const ROOM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MIN_GAP_MS = 20 * 1000;                       // guards against double taps
const meetingStore = () => getStore({ name: 'meeting-briefs', consistency: 'strong' });
const throttleStore = () => getStore({ name: 'meeting-notify', consistency: 'strong' });

export const joinPath = (code) => `/meet/?room=${encodeURIComponent(code)}&join=1`;

// Sends the notification (shared with the AI). Returns { status, error } or { sent, people, posted }.
export async function notifyMeeting(user, body, origin) {
  if (!user.host) return { status: 403, error: 'Only a host can send meeting notifications.' };
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!ROOM_NAME_PATTERN.test(code)) return { status: 400, error: 'Invalid meeting code.' };

  const family = familyNames().filter((n) => n !== user.name);
  const people = body.people === 'all' || body.people === undefined
    ? family
    : [...new Set((Array.isArray(body.people) ? body.people : []).filter((n) => family.includes(n)))];
  if (!people.length && !body.postToChat) return { status: 400, error: 'Pick at least one person.' };

  const last = await throttleStore().get(`last/${code}`, { type: 'json' });
  if (last && Date.now() - last.at < MIN_GAP_MS) return { status: 429, error: 'You just sent this. Give it a few seconds.' };
  await throttleStore().setJSON(`last/${code}`, { at: Date.now(), by: user.name });

  let topic = '';
  try {
    const brief = await meetingStore().get(code, { type: 'json' });
    topic = brief && brief.topics ? String(brief.topics).split('\n')[0].trim().slice(0, 100) : '';
  } catch (e) { /* the notification still works without a topic */ }

  let sent = 0;
  if (people.length) {
    sent = await sendPush(people, {
      title: `${user.name} started a meeting`,
      body: topic ? `${topic} · tap to join` : 'Tap to join now',
      url: joinPath(code),
      tag: `meeting-${code}`
    }, { exclude: user.name, kind: 'other' });
  }

  let posted = false;
  if (body.postToChat) {
    await postMessage({ author: user.name, text: `📹 ${user.name} started a meeting${topic ? ` — ${topic}` : ''}. Tap to join: ${origin}${joinPath(code)}` });
    posted = true;
  }
  return { sent, people, posted };
}

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  let body;
  try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  const result = await notifyMeeting(user, body, new URL(req.url).origin);
  return result.error ? json(result.status, { error: result.error }) : json(200, result);
};
