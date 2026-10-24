// Calls from a group chat or direct message: a fresh private Daily room that rings everyone else in the chat.
// People with Chowaniec open right now get a ringing popup (they check in every few seconds through
// GET /call?incoming=1); everyone else gets a "… is calling" push notification with Answer and Decline buttons.
//   calls store: call/<id>      { id, code, room, roomName, from, people, startedAt, endsAt, status, pushed, answered, declined }
//                ringing/<user> { id }   the call ringing for that person (at most one)
//                seen/<user>    { at }   when that person last had Chowaniec open and visible
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import common from './common.js';
import { sendPush } from './push.mjs';
import { markSeen, isOnline } from './presence.mjs';

export { markSeen };
import { postMessage } from './group-store.mjs';
import { roomMembers, roomsFor, dmParts } from './rooms.mjs';

const { dailyRequest } = common;
export const RING_MS = 45 * 1000;                 // how long a call rings before it counts as missed
const CALL_ROOM_SECONDS = 3 * 60 * 60;           // the call's room stays open for late joiners
const ID_PATTERN = /^[a-f0-9]{16}$/;

const store = () => getStore({ name: 'calls', consistency: 'strong' });
const key = (kind, name) => `${kind}/${encodeURIComponent(name)}`;

export const isCallId = (id) => ID_PATTERN.test(id || '');
export const joinPath = (call) => `/meet/?room=${encodeURIComponent(call.code)}&join=1&call=${call.id}`;
const chatPath = (room) => (room === 'everyone' ? '/group/' : `/group/?room=${room}`);

function roomCode() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const part = (n) => Array.from({ length: n }, () => letters[crypto.randomInt(26)]).join('');
  return `${part(3)}-${part(4)}-${part(3)}`;
}

// What the caller sees as the chat's name ("Amelia" for a direct message).
function chatName(user, room) {
  const dm = dmParts(room);
  if (dm) return dm.people.find((n) => n !== user) || user;
  const found = roomsFor(user).find((r) => r.id === room);
  return found ? found.name : 'Family chat';
}

// A call rings until the caller hangs up, everyone has answered or declined, or RING_MS passes.
const waiting = (call) => call.people.filter((n) => !call.answered.includes(n) && !call.declined.includes(n));
const isRinging = (call) => !!call && call.status === 'ringing' && Date.now() < Date.parse(call.startedAt) + RING_MS && waiting(call).length > 0;

// 'ringing', 'cancelled' (the caller hung up first), 'answered' (someone picked up), 'declined' or 'missed'.
function stateOf(call) {
  if (isRinging(call)) return 'ringing';
  if (call.answered.length) return 'answered';
  if (call.status === 'cancelled') return 'cancelled';
  return call.declined.length === call.people.length ? 'declined' : 'missed';
}


export async function getCall(id) {
  if (!isCallId(id)) return null;
  return store().get(`call/${id}`, { type: 'json' });
}

async function saveCall(call) {
  await store().setJSON(`call/${call.id}`, call);
}

// Starts a call from `room` (the caller must already be allowed in it). Throws { status } errors.
export async function startCall(user, room) {
  if (!process.env.DAILY_API_KEY) throw Object.assign(new Error('Calls need meetings to be set up (DAILY_API_KEY).'), { status: 500 });
  const people = roomMembers(room).filter((n) => n !== user.name);
  if (!people.length) throw Object.assign(new Error('There’s nobody else in this chat to call.'), { status: 400 });

  let code = '';
  for (let attempt = 0; attempt < 3 && !code; attempt++) {
    const candidate = roomCode();
    const res = await dailyRequest('/rooms', {
      name: candidate,
      privacy: 'private',
      properties: { exp: Math.floor(Date.now() / 1000) + CALL_ROOM_SECONDS, max_participants: Math.max(people.length + 1, 2) }
    });
    if (res.ok) code = candidate;
    else {
      const detail = await res.text();
      if (!(res.status === 400 && /already exists/i.test(detail))) {
        console.error('Call room creation failed:', res.status, detail);
        throw Object.assign(new Error('Could not start the call. Please try again.'), { status: 502 });
      }
    }
  }
  if (!code) throw Object.assign(new Error('Could not start the call. Please try again.'), { status: 502 });

  const startedAt = new Date().toISOString();
  const call = {
    id: crypto.randomBytes(8).toString('hex'), code, room, roomName: chatName(user.name, room), from: user.name, people,
    startedAt, status: 'ringing', pushed: [], answered: [], declined: []
  };
  const online = await Promise.all(people.map(isOnline));
  call.pushed = people.filter((_, i) => !online[i]);
  await saveCall(call);
  await Promise.all(people.map((name) => store().setJSON(key('ringing', name), { id: call.id })));

  const where = dmParts(room) ? '' : ` · ${call.roomName}`;
  const tasks = [];
  if (call.pushed.length) {
    tasks.push(sendPush(call.pushed, {
      title: `📞 ${user.name} is calling`,
      body: `Tap to answer${where}`,
      url: joinPath(call),
      tag: `call-${call.id}`,
      call: { id: call.id }
    }, { kind: 'call' }).catch((e) => console.error('Call push failed:', e.message)));
  }
  tasks.push(postMessage({
    author: 'Chowaniec', room, kind: 'system',
    text: `📞 ${user.name} started a call`,
    link: { href: joinPath(call), label: 'Join call' }
  }).catch((e) => console.error('Call message failed:', e.message)));
  return { call, tasks };
}

// The call ringing for `user` right now, or null.
export async function incomingFor(user) {
  const ring = await store().get(key('ringing', user), { type: 'json' });
  if (!ring) return null;
  const call = await getCall(ring.id);
  if (!isRinging(call) || call.answered.includes(user) || call.declined.includes(user)) return null;
  return publicCall(call);
}

// What the people in the call may see (no internals).
export function publicCall(call) {
  return {
    id: call.id, from: call.from, room: call.room, roomName: call.roomName, people: call.people,
    startedAt: call.startedAt, ringsUntil: new Date(Date.parse(call.startedAt) + RING_MS).toISOString(),
    status: stateOf(call), answered: call.answered, declined: call.declined, join: joinPath(call), chat: chatPath(call.room)
  };
}

const inCall = (call, name) => !!call && (call.from === name || call.people.includes(name));

// Answer or decline (anyone who was rung), cancel (the caller) or just check. Returns { call, stopped } where
// `stopped` means the call no longer rings (so the "Missed call" notifications can go out), or null.
export async function respond(user, id, action) {
  if (!isCallId(id)) return null;
  // Two people can answer at the same moment, so only save over the version we read.
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await store().getWithMetadata(`call/${id}`, { type: 'json' });
    const call = entry && entry.data;
    if (!inCall(call, user)) return null;
    let changed = true;
    if (action === 'answer' && call.people.includes(user)) {
      if (!call.answered.includes(user)) call.answered.push(user);
      call.declined = call.declined.filter((n) => n !== user);
    } else if (action === 'decline' && call.people.includes(user) && !call.answered.includes(user)) {
      if (!call.declined.includes(user)) call.declined.push(user);
    } else if (action === 'cancel' && call.from === user && isRinging(call)) {
      call.status = 'cancelled';
    } else {
      changed = false;
    }
    if (changed) {
      const { modified } = await store().setJSON(`call/${id}`, call, { onlyIfMatch: entry.etag });
      if (!modified) continue;
    }
    return { call: publicCall(call), stopped: !isRinging(call) && !call.missedSent };
  }
  throw Object.assign(new Error('Too many people answered at once. Try again.'), { status: 409 });
}

// Once ringing has stopped, people who got a push and never picked up get a quiet "Missed call"
// notification in its place (same tag, so it replaces the ringing one). Sent once per call.
export async function sendMissed(id) {
  if (!isCallId(id)) return 0;
  const entry = await store().getWithMetadata(`call/${id}`, { type: 'json' });
  const call = entry && entry.data;
  if (!call || isRinging(call) || call.missedSent) return 0;
  call.missedSent = true;
  const { modified } = await store().setJSON(`call/${id}`, call, { onlyIfMatch: entry.etag });
  if (!modified) return 0;   // someone else changed it first; the next check sends it
  const missed = call.pushed.filter((n) => !call.answered.includes(n) && !call.declined.includes(n));
  if (!missed.length) return 0;
  return sendPush(missed, {
    title: `Missed call from ${call.from}`,
    body: call.answered.length ? `${call.answered.join(', ')} picked up · tap to join` : 'Tap to open the chat',
    url: call.answered.length ? joinPath(call) : chatPath(call.room),
    tag: `call-${call.id}`,
    silent: true
  }, { kind: 'call' });
}

// For the once-a-minute scheduler: missed-call notifications for calls that rang out with nobody watching.
export async function sweepCalls() {
  const { blobs } = await store().list({ prefix: 'call/' });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const b of blobs) {
    const call = await store().get(b.key, { type: 'json' });
    if (!call) continue;
    if (Date.parse(call.startedAt) < cutoff) { await store().delete(b.key); continue; }
    if (!call.missedSent && !isRinging(call)) await sendMissed(call.id).catch((e) => console.error('Missed call push failed:', e.message));
  }
}
