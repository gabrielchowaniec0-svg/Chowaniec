// Chowaniec Group chat storage (Netlify Blobs) and notifications.
// Messages: group-chat store, key msg/<YYYY-MM-DD>/<id>, where id = <13-digit ms>-<random>
// so keys sort by time. Photos: group-media store, key <mediaId>.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { familyNames } from './auth.mjs';
import { sendPush } from './push.mjs';

export const MAX_TEXT = 4000;
export const AI_NAME = 'Chowaniec AI';
const ID_PATTERN = /^\d{13}-[a-f0-9]{8}$/;
const MEDIA_PATTERN = /^[a-f0-9]{32}$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const messages = () => getStore({ name: 'group-chat', consistency: 'strong' });
const media = () => getStore({ name: 'group-media', consistency: 'strong' });

export const isMessageId = (id) => ID_PATTERN.test(id || '');
export const isMediaId = (id) => MEDIA_PATTERN.test(id || '');
const dayOf = (id) => new Date(Number(id.slice(0, 13))).toISOString().slice(0, 10);
const keyOf = (id) => `msg/${dayOf(id)}/${id}`;

function newId() {
  return `${String(Date.now()).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`;
}

// Days that have messages, newest first.
async function days() {
  const { directories } = await messages().list({ prefix: 'msg/', directories: true });
  return directories.map((d) => d.replace(/^msg\//, '').replace(/\/$/, '')).sort().reverse();
}

async function idsForDay(day) {
  const { blobs } = await messages().list({ prefix: `msg/${day}/` });
  return blobs.map((b) => b.key.split('/').pop()).sort();
}

async function load(ids) {
  const list = await Promise.all(ids.map((id) => messages().get(keyOf(id), { type: 'json' })));
  return list.filter(Boolean);
}

export async function latest(limit = 50) {
  const collected = [];
  for (const day of await days()) {
    collected.unshift(...(await idsForDay(day)));
    if (collected.length >= limit) break;
  }
  return load(collected.slice(-limit));
}

export async function since(sinceId, limit = 200) {
  const sinceDay = dayOf(sinceId);
  const recentDays = (await days()).filter((d) => d >= sinceDay).reverse();
  const ids = [];
  for (const day of recentDays) ids.push(...(await idsForDay(day)).filter((id) => id > sinceId));
  return load(ids.slice(0, limit));
}

export async function before(beforeId, limit = 50) {
  const beforeDay = dayOf(beforeId);
  const olderDays = (await days()).filter((d) => d <= beforeDay);
  const collected = [];
  for (const day of olderDays) {
    collected.unshift(...(await idsForDay(day)).filter((id) => id < beforeId));
    if (collected.length > limit) break;
  }
  return { messages: await load(collected.slice(-limit)), hasMore: collected.length > limit };
}

export async function getMessage(id) {
  if (!isMessageId(id)) return null;
  const entry = await messages().getWithMetadata(keyOf(id), { type: 'json' });
  return entry ? { message: entry.data, etag: entry.etag } : null;
}

// Finds @Name, @everyone and @AI mentions (case-insensitive).
export function parseMentions(text) {
  const names = familyNames();
  const found = new Set();
  for (const match of text.matchAll(/@([A-Za-z][\w-]*)/g)) {
    const word = match[1].toLowerCase();
    if (word === 'everyone') found.add('everyone');
    else if (word === 'ai' || word === 'agent') found.add('AI');
    else {
      const name = names.find((n) => n.toLowerCase() === word);
      if (name) found.add(name);
    }
  }
  return [...found];
}

async function saveImage(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match || !IMAGE_TYPES.includes(match[1])) throw Object.assign(new Error('Photos must be JPEG, PNG or WebP.'), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('That photo is too large (max 2 MB).'), { status: 413 });
  const id = crypto.randomBytes(16).toString('hex');
  await media().set(id, bytes, { metadata: { contentType: match[1] } });
  return id;
}

export async function getImage(id) {
  if (!isMediaId(id)) return null;
  const entry = await media().getWithMetadata(id, { type: 'arrayBuffer' });
  return entry ? { bytes: entry.data, contentType: entry.metadata.contentType || 'image/jpeg' } : null;
}

// Stores a message and returns it. `author` is a family name or AI_NAME.
export async function postMessage({ author, text, image, replyTo, kind = 'user' }) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean && !image) throw Object.assign(new Error('Write a message or add a photo.'), { status: 400 });

  let reply = null;
  if (replyTo) {
    const found = await getMessage(replyTo);
    if (found) reply = { id: found.message.id, user: found.message.user, text: found.message.text.slice(0, 200) };
  }

  const message = {
    id: newId(),
    user: author,
    text: clean,
    createdAt: new Date().toISOString(),
    kind,
    mentions: parseMentions(clean),
    replyTo: reply,
    image: image ? await saveImage(image) : null,
    reactions: {}
  };
  await messages().setJSON(keyOf(message.id), message, { onlyIfNew: true });
  return message;
}

export async function deleteMessage(id) {
  const found = await getMessage(id);
  if (!found) return;
  await messages().delete(keyOf(id));
  if (found.message.image) await media().delete(found.message.image);
}

// Toggles `user`'s reaction, retrying if someone else reacted at the same moment.
export async function toggleReaction(id, user, emoji) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await getMessage(id);
    if (!found) return null;
    const message = found.message;
    const people = new Set(message.reactions[emoji] || []);
    if (people.has(user)) people.delete(user);
    else people.add(user);
    if (people.size) message.reactions[emoji] = [...people];
    else delete message.reactions[emoji];
    const { modified } = await messages().setJSON(keyOf(id), message, { onlyIfMatch: found.etag });
    if (modified) return message;
  }
  throw Object.assign(new Error('Too many reactions at once. Try again.'), { status: 409 });
}

// Push notifications for a new message: mentioned people get "X mentioned you",
// everyone else a normal message notification. The author is never notified.
export async function notifyMessage(message) {
  const preview = message.text ? message.text.slice(0, 140) : 'Sent a photo';
  const body = message.image && message.text ? `📷 ${preview}` : preview;
  const everyone = familyNames();
  const mentioned = message.mentions.includes('everyone')
    ? everyone
    : message.mentions.filter((m) => everyone.includes(m));
  const others = everyone.filter((n) => !mentioned.includes(n));
  const url = '/group/';
  await Promise.all([
    mentioned.length ? sendPush(mentioned, { title: `${message.user} mentioned you`, body, url }, { exclude: message.user }) : 0,
    others.length ? sendPush(others, { title: message.user, body, url }, { exclude: message.user }) : 0
  ]);
}

// The family's time zone for times shown to the AI (FAMILY_TIMEZONE, default US Eastern).
export function familyTimeZone() {
  const zone = Netlify.env.get('FAMILY_TIMEZONE') || 'America/New_York';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch (e) {
    return 'America/New_York';
  }
}

// Recent messages as plain text for the AI.
export function transcriptOf(list) {
  return list.map((m) => {
    const when = new Date(m.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: familyTimeZone() });
    const reply = m.replyTo ? ` (replying to ${m.replyTo.user}: "${m.replyTo.text.slice(0, 80)}")` : '';
    return `[${when}] ${m.user}${reply}: ${m.text || ''}${m.image ? ' [photo]' : ''}`;
  }).join('\n');
}

// --- Presence (online / typing / read receipts) and the pinned message ---
// presence/<user>: { user, lastSeen, typingUntil, lastReadId }. Only that person's devices write it.

const ONLINE_MS = 60 * 1000;
const SEEN_REFRESH_MS = 25 * 1000;
const TYPING_MS = 6 * 1000;
const presenceKey = (user) => `presence/${encodeURIComponent(user)}`;

async function updatePresence(user, change) {
  const key = presenceKey(user);
  const current = (await messages().get(key, { type: 'json' })) || { user, lastSeen: null, typingUntil: null, lastReadId: null };
  const next = change(current);
  if (next) await messages().setJSON(key, next);
}

// Marks `user` as online; writes at most every 25s to keep polling cheap.
export function touchPresence(user) {
  return updatePresence(user, (p) => {
    if (p.lastSeen && Date.now() - Date.parse(p.lastSeen) < SEEN_REFRESH_MS) return null;
    return { ...p, lastSeen: new Date(Date.now()).toISOString() };
  });
}

export function setTyping(user) {
  const now = Date.now();
  return updatePresence(user, (p) => ({ ...p, lastSeen: new Date(now).toISOString(), typingUntil: new Date(now + TYPING_MS).toISOString() }));
}

// Sending a message ends that person's typing indicator straight away.
export function clearTyping(user) {
  return updatePresence(user, (p) => (p.typingUntil ? { ...p, typingUntil: null } : null));
}

// Read receipts only move forward (ids sort by time).
export function setRead(user, id) {
  return updatePresence(user, (p) => {
    if (p.lastReadId && p.lastReadId >= id) return null;
    return { ...p, lastReadId: id, lastSeen: new Date(Date.now()).toISOString() };
  });
}

export async function listPresence() {
  const { blobs } = await messages().list({ prefix: 'presence/' });
  const now = Date.now();
  return (await Promise.all(blobs.map((b) => messages().get(b.key, { type: 'json' }))))
    .filter(Boolean)
    .map((p) => ({
      user: p.user,
      lastSeen: p.lastSeen,
      online: !!p.lastSeen && now - Date.parse(p.lastSeen) < ONLINE_MS,
      typing: !!p.typingUntil && Date.parse(p.typingUntil) > now,
      lastReadId: p.lastReadId || null
    }));
}

export async function getPinned() {
  return (await messages().get('meta/pinned', { type: 'json' })) || null;
}

export async function pinMessage(id, user) {
  const found = await getMessage(id);
  if (!found) return null;
  const { message } = found;
  const pinned = {
    id: message.id, user: message.user, text: message.text.slice(0, 300), image: message.image,
    pinnedBy: user, pinnedAt: new Date().toISOString()
  };
  await messages().setJSON('meta/pinned', pinned);
  return pinned;
}

export async function unpin() {
  await messages().delete('meta/pinned');
}
