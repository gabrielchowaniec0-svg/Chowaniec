// Unread counts for the signed-in person: every group chat they are in plus their direct messages.
// A message is unread when someone else sent it after the person's read receipt (presence lastReadId, the same
// rule as dm.mjs). System notes don't count. Muted chats are listed but left out of the total.
import { getStore } from '@netlify/blobs';
import { latest, since } from './group-store.mjs';
import { roomsFor, dmPartners, prefixOf } from './rooms.mjs';
import { getMutes } from './user-settings.mjs';
import { setBadge } from './badge.mjs';

export const MAX_COUNT = 50;          // per chat; the page shows "50+" beyond that
const CACHE_MS = 10 * 1000;

const messages = () => getStore({ name: 'group-chat', consistency: 'strong' });
// Same key as group-store.mjs presenceKey(): only this person's own receipt is read, not the whole room.
const presenceKey = (user, room) => `${prefixOf(room)}presence/${encodeURIComponent(user)}`;

// Warm-instance memo: per user, the last answer; per user+room, the last count for a given (latest id, read id),
// so an unchanged chat costs two small reads instead of loading its messages again.
const answers = new Map();
const roomMemo = new Map();

async function roomUnread(name, room) {
  const [mine, recent] = await Promise.all([
    messages().get(presenceKey(name, room), { type: 'json' }).catch(() => null),
    latest(1, room)
  ]);
  const last = recent[0] || null;
  const readId = (mine && mine.lastReadId) || null;
  if (!last || (readId && readId >= last.id)) return 0;
  const memoKey = `${name}|${room}`;
  const memo = roomMemo.get(memoKey);
  if (memo && memo.lastId === last.id && memo.readId === readId) return memo.n;
  let n;
  if (!readId) n = last.user !== name && last.kind !== 'system' && !last.thread ? 1 : 0;   // never opened: like dm.mjs, count the newest only
  else {
    const fresh = await since(readId, MAX_COUNT, room);
    n = fresh.filter((m) => m.user !== name && m.kind !== 'system' && !m.thread).length;
  }
  roomMemo.set(memoKey, { lastId: last.id, readId, n });
  return n;
}

// { total, chats: { <room>: n }, dms: n, dmRooms: { <dm id>: n }, muted: [ids], at }
export async function unreadFor(name, { fresh = false } = {}) {
  const cached = answers.get(name);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const rooms = roomsFor(name).map((r) => r.id);
  const dmRooms = dmPartners(name).map((p) => p.id);
  const [mutes, roomCounts, dmCounts] = await Promise.all([
    getMutes(name).catch(() => ({})),
    Promise.all(rooms.map((r) => roomUnread(name, r).catch(() => 0))),
    Promise.all(dmRooms.map((r) => roomUnread(name, r).catch(() => 0)))
  ]);
  const chats = {};
  rooms.forEach((r, i) => { chats[r] = roomCounts[i]; });
  const dmMap = {};
  dmRooms.forEach((r, i) => { if (dmCounts[i]) dmMap[r] = dmCounts[i]; });
  const muted = Object.keys(mutes).filter((r) => rooms.includes(r) || dmRooms.includes(r));
  const counted = (r, n) => (muted.includes(r) ? 0 : n);
  const dms = Object.entries(dmMap).reduce((a, [r, n]) => a + counted(r, n), 0);
  const total = Object.entries(chats).reduce((a, [r, n]) => a + counted(r, n), 0) + dms;
  const value = { total, chats, dms, dmRooms: dmMap, muted, at: new Date().toISOString() };
  answers.set(name, { at: Date.now(), value });
  // Re-base the push badge counter on the true number.
  await setBadge(name, total);
  return value;
}
