// Sign-up sheets: a list of slots (e.g. "Bring drinks") that family members tap to claim.
// Stored in Netlify Blobs (store "signups"), one blob per sheet: sheet/<id>
//   { id, title, room, createdBy, createdAt, eventId?, slots: [{ id, label, claimedBy|null }], nudgedAt? }
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { canAccessRoom, isRoomId, DEFAULT_ROOM } from './rooms.mjs';
import { postMessage, AI_NAME } from './group-store.mjs';

const store = () => getStore({ name: 'signups', consistency: 'strong' });
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const ID = /^[a-f0-9]{10}$/;
export const isSheetId = (id) => ID.test(id || '');
const key = (id) => `sheet/${id}`;

export function cleanSlots(labels) {
  const seen = new Set();
  const slots = [];
  for (const raw of Array.isArray(labels) ? labels : []) {
    const label = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    slots.push({ id: crypto.randomBytes(3).toString('hex'), label, claimedBy: null });
  }
  if (slots.length < 1) throw bad('Add at least one slot.');
  if (slots.length > 30) throw bad('A sheet can have up to 30 slots.');
  return slots;
}

// Creates the sheet and posts it into the chat (as `author`, optionally as the AI for someone).
export async function createSheet(user, { title, slots, room = DEFAULT_ROOM, eventId = null, asAi = false }) {
  if (!isRoomId(room) || !canAccessRoom(user.name, room)) throw bad('You’re not in that chat.', 403);
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!cleanTitle) throw bad('Give the sheet a name.');
  const id = crypto.randomBytes(5).toString('hex');
  const sheet = { id, title: cleanTitle, room, createdBy: user.name, createdAt: new Date().toISOString(), eventId: eventId || null, slots: cleanSlots(slots) };
  await store().setJSON(key(id), sheet, { onlyIfNew: true });
  const message = await postMessage({
    author: asAi ? AI_NAME : user.name, kind: asAi ? 'ai' : 'user', onBehalfOf: asAi ? user.name : undefined,
    room, text: `📝 Sign-up: ${sheet.title}`, sheet: sheet.id
  });
  return { sheet, message };
}

export async function getSheet(id) {
  return isSheetId(id) ? (await store().get(key(id), { type: 'json' })) || null : null;
}

export async function listSheets(user, room) {
  const { blobs } = await store().list({ prefix: 'sheet/' });
  const all = (await Promise.all(blobs.map((b) => store().get(b.key, { type: 'json' })))).filter(Boolean);
  return all.filter((s) => s.room === room && canAccessRoom(user.name, s.room)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).slice(-40);
}

// Claim (or give back) one slot. A slot can only be held by one person; people can hold several slots.
export async function claimSlot(user, id, slotId, release = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!isSheetId(id)) throw bad('Sheet not found.', 404);
    const entry = await store().getWithMetadata(key(id), { type: 'json' });
    const sheet = entry && entry.data;
    if (!sheet || !canAccessRoom(user.name, sheet.room)) throw bad('Sheet not found.', 404);
    const slot = sheet.slots.find((s) => s.id === slotId);
    if (!slot) throw bad('That slot is gone.', 404);
    if (release) {
      if (slot.claimedBy && slot.claimedBy !== user.name && !user.host) throw bad('Only the person who took it (or a head) can give it back.', 403);
      slot.claimedBy = null;
    } else {
      if (slot.claimedBy && slot.claimedBy !== user.name) throw bad(`${slot.claimedBy} already took that one.`, 409);
      slot.claimedBy = user.name;
    }
    const { modified } = await store().setJSON(key(id), sheet, { onlyIfMatch: entry.etag });
    if (modified) return sheet;
  }
  throw bad('Please try again.', 409);
}

export async function deleteSheet(user, id) {
  const sheet = await getSheet(id);
  if (!sheet || !canAccessRoom(user.name, sheet.room)) throw bad('Sheet not found.', 404);
  if (sheet.createdBy !== user.name && !user.host) throw bad('Only the person who made it or a head can delete it.', 403);
  await store().delete(key(id));
}

export async function allSheets() {
  const { blobs } = await store().list({ prefix: 'sheet/' });
  return (await Promise.all(blobs.map(async (b) => {
    const entry = await store().getWithMetadata(b.key, { type: 'json' });
    return entry && entry.data ? { sheet: entry.data, etag: entry.etag, key: b.key } : null;
  }))).filter(Boolean);
}
export const markNudged = (item) => store().setJSON(item.key, { ...item.sheet, nudgedAt: new Date().toISOString() }, { onlyIfMatch: item.etag });
