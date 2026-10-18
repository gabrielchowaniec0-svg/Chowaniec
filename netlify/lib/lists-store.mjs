// Shared lists (groceries, packing, costumes...). Stored in Netlify Blobs (store "lists"), one blob per list:
//   list/<id>: { id, title, room, createdBy, createdAt, updatedAt, items: [{ id, text, done, addedBy, doneBy }] }
// A list belongs to a chat ("room"): only people in that chat can see or change it.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { canAccessRoom, isRoomId, DEFAULT_ROOM, roomsFor } from './rooms.mjs';

const store = () => getStore({ name: 'lists', consistency: 'strong' });
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const ID = /^[a-f0-9]{10}$/;
const key = (id) => `list/${id}`;
export const MAX_ITEMS = 100;

const cleanText = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
const cleanTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 60);

export async function getList(id) {
  return ID.test(id || '') ? (await store().get(key(id), { type: 'json' })) || null : null;
}

export async function listLists(user) {
  const { blobs } = await store().list({ prefix: 'list/' });
  const all = (await Promise.all(blobs.map((b) => store().get(b.key, { type: 'json' })))).filter(Boolean);
  return all.filter((l) => canAccessRoom(user.name, l.room)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function createList(user, { title, room = DEFAULT_ROOM, items = [] }) {
  if (!isRoomId(room) || !canAccessRoom(user.name, room)) throw bad('You’re not in that chat.', 403);
  const name = cleanTitle(title);
  if (!name) throw bad('Give the list a name.');
  const now = new Date().toISOString();
  const list = { id: crypto.randomBytes(5).toString('hex'), title: name, room, createdBy: user.name, createdAt: now, updatedAt: now, items: [] };
  addTo(list, items, user.name);
  await store().setJSON(key(list.id), list, { onlyIfNew: true });
  return list;
}

function addTo(list, texts, who) {
  const added = [];
  const have = new Set(list.items.map((i) => i.text.toLowerCase()));
  for (const raw of Array.isArray(texts) ? texts : []) {
    const text = cleanText(raw);
    if (!text || have.has(text.toLowerCase())) continue;
    if (list.items.length >= MAX_ITEMS) throw bad(`A list can have up to ${MAX_ITEMS} items.`);
    have.add(text.toLowerCase());
    const item = { id: crypto.randomBytes(3).toString('hex'), text, done: false, addedBy: who, doneBy: null };
    list.items.push(item);
    added.push(item);
  }
  return added;
}

// Changes a list safely even if two people edit at once.
async function change(user, id, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!ID.test(id || '')) throw bad('List not found.', 404);
    const entry = await store().getWithMetadata(key(id), { type: 'json' });
    const list = entry && entry.data;
    if (!list || !canAccessRoom(user.name, list.room)) throw bad('List not found.', 404);
    const extra = fn(list);
    list.updatedAt = new Date().toISOString();
    const { modified } = await store().setJSON(key(id), list, { onlyIfMatch: entry.etag });
    if (modified) return { list, extra };
  }
  throw bad('Please try again.', 409);
}

export const addItems = (user, id, texts) => change(user, id, (list) => addTo(list, texts, user.name));

export const toggleItem = (user, id, itemId, done) => change(user, id, (list) => {
  const item = list.items.find((i) => i.id === itemId);
  if (!item) throw bad('Item not found.', 404);
  item.done = typeof done === 'boolean' ? done : !item.done;
  item.doneBy = item.done ? user.name : null;
});

export const removeItems = (user, id, itemIds) => change(user, id, (list) => {
  const drop = new Set(itemIds);
  list.items = list.items.filter((i) => !drop.has(i.id));
});

export const clearDone = (user, id) => change(user, id, (list) => { list.items = list.items.filter((i) => !i.done); });

export async function deleteList(user, id) {
  const list = await getList(id);
  if (!list || !canAccessRoom(user.name, list.room)) throw bad('List not found.', 404);
  if (list.createdBy !== user.name && !user.host) throw bad('Only the person who made it or a head can delete it.', 403);
  await store().delete(key(id));
}

// Finds a list by (part of) its name among the chats this person is in, optionally within one chat.
export async function findList(user, name, room = null) {
  const want = cleanTitle(name).toLowerCase();
  if (!want) return null;
  const mine = (await listLists(user)).filter((l) => !room || l.room === room);
  return mine.find((l) => l.title.toLowerCase() === want) || mine.find((l) => l.title.toLowerCase().includes(want) || want.includes(l.title.toLowerCase())) || null;
}

export { roomsFor };
