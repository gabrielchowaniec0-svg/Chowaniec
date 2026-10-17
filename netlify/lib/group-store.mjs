// Chowaniec Group chat storage (Netlify Blobs) and notifications.
// Messages: group-chat store, key msg/<YYYY-MM-DD>/<id>, where id = <13-digit ms>-<random>
// so keys sort by time. Photos and voice messages: group-media store, key <mediaId>.
// Scheduled messages wait in the group-chat store under sched/<user>/<sendAt>-<random>.
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
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/x-wav'];
const MAX_AUDIO_BYTES = 2.5 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 300;
export const MAX_SCHEDULED_PER_USER = 20;

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

// Voice messages arrive as a data URL from the phone's recorder (e.g. data:audio/webm;codecs=opus;base64,...).
export async function saveAudio(dataUrl) {
  const match = /^data:(audio\/[\w.+-]+)(?:;[\w.=+-]+)*;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  const type = match && match[1].toLowerCase();
  if (!match || !AUDIO_TYPES.includes(type)) throw Object.assign(new Error('That voice message couldn’t be read.'), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 200) throw Object.assign(new Error('That voice message is empty.'), { status: 400 });
  if (bytes.length > MAX_AUDIO_BYTES) throw Object.assign(new Error('That voice message is too long.'), { status: 413 });
  const id = crypto.randomBytes(16).toString('hex');
  await media().set(id, bytes, { metadata: { contentType: type } });
  return id;
}

// Photos and voice messages share one store; the stored content type tells them apart.
export async function getImage(id) {
  if (!isMediaId(id)) return null;
  const entry = await media().getWithMetadata(id, { type: 'arrayBuffer' });
  return entry ? { bytes: entry.data, contentType: entry.metadata.contentType || 'image/jpeg' } : null;
}

// Stores a message and returns it. `author` is a family name or AI_NAME.
export async function postMessage({ author, text, image, replyTo, kind = 'user', poll, voice }) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean && !image && !poll && !voice) throw Object.assign(new Error('Write a message or add a photo.'), { status: 400 });

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
    reactions: {},
    ...(poll ? { poll } : {}),
    ...(voice ? { voice } : {})
  };
  await messages().setJSON(keyOf(message.id), message, { onlyIfNew: true });
  return message;
}

export async function deleteMessage(id) {
  const found = await getMessage(id);
  if (!found) return;
  await messages().delete(keyOf(id));
  if (found.message.image) await media().delete(found.message.image);
  if (found.message.voice) await media().delete(found.message.voice.id);
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
    mentioned.length ? sendPush(mentioned, { title: `${message.user} mentioned you`, body, url }, { exclude: message.user, kind: 'mention' }) : 0,
    others.length ? sendPush(others, { title: message.user, body, url }, { exclude: message.user, kind: 'message' }) : 0
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
    const poll = m.poll ? ` [poll options: ${m.poll.options.map((o) => `${o.text} (${o.votes.length})`).join(', ')}${m.poll.closed ? '; closed' : ''}]` : '';
    return `[${when}] ${m.user}${reply}: ${m.text || ''}${m.image ? ' [photo]' : ''}${m.voice ? ' [voice message]' : ''}${poll}`;
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


// --- Polls ---
// A poll is a normal message with message.poll = { question, multi, closed, options: [{ id, text, votes: [names] }] }.

export function buildPoll(question, options, multi) {
  const q = String(question || '').trim().slice(0, 200);
  const texts = (Array.isArray(options) ? options : []).map((o) => String(o || '').trim().slice(0, 100)).filter(Boolean);
  if (!q) throw Object.assign(new Error('Add a question for the poll.'), { status: 400 });
  if (texts.length < 2) throw Object.assign(new Error('Add at least two answers.'), { status: 400 });
  if (texts.length > 8) throw Object.assign(new Error('A poll can have up to 8 answers.'), { status: 400 });
  if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) throw Object.assign(new Error('Each answer needs to be different.'), { status: 400 });
  return { question: q, multi: !!multi, closed: false, options: texts.map((text, i) => ({ id: `o${i + 1}`, text, votes: [] })) };
}

// Adds or removes `user`'s vote. Single-choice polls move the vote; multi-choice polls toggle.
export async function votePoll(id, user, optionId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await getMessage(id);
    if (!found || !found.message.poll) return null;
    const message = found.message;
    const poll = message.poll;
    if (poll.closed) throw Object.assign(new Error('This poll is closed.'), { status: 409 });
    const option = poll.options.find((o) => o.id === optionId);
    if (!option) throw Object.assign(new Error('That answer isn’t in this poll.'), { status: 400 });
    const had = option.votes.includes(user);
    if (!poll.multi) poll.options.forEach((o) => { o.votes = o.votes.filter((v) => v !== user); });
    if (poll.multi) option.votes = had ? option.votes.filter((v) => v !== user) : [...option.votes, user];
    else if (!had) option.votes.push(user);
    const { modified } = await messages().setJSON(keyOf(id), message, { onlyIfMatch: found.etag });
    if (modified) return message;
  }
  throw Object.assign(new Error('Lots of votes at once. Try again.'), { status: 409 });
}

export async function closePoll(id, user, isHost) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await getMessage(id);
    if (!found || !found.message.poll) return null;
    const message = found.message;
    if (message.user !== user && !isHost) throw Object.assign(new Error('Only the person who made the poll or a host can close it.'), { status: 403 });
    message.poll.closed = true;
    message.poll.closedAt = new Date().toISOString();
    const { modified } = await messages().setJSON(keyOf(id), message, { onlyIfMatch: found.etag });
    if (modified) return message;
  }
  throw Object.assign(new Error('Please try again.'), { status: 409 });
}

// --- Scheduled messages ---
// sched/<user>/<sendAt 13 digits>-<random>: { id, user, text, replyTo (message id or null), sendAt, createdAt, claimedAt? }
// meta/next-sched: { at } — the earliest pending send time, so chat polls can skip the listing when nothing is due.

const schedPrefix = (user) => `sched/${encodeURIComponent(user)}/`;
const SCHED_CLAIM_MS = 2 * 60 * 1000;

async function setNextSched(at) {
  if (at == null) await messages().delete('meta/next-sched');
  else await messages().setJSON('meta/next-sched', { at });
}

export async function nextScheduledAt() {
  const hint = await messages().get('meta/next-sched', { type: 'json' });
  return hint ? hint.at : null;
}

export async function scheduleMessage({ user, text, replyTo, sendAt }) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean) throw Object.assign(new Error('Write a message to schedule.'), { status: 400 });
  const when = Date.parse(sendAt);
  const now = Date.now();
  if (isNaN(when)) throw Object.assign(new Error('Pick a date and time.'), { status: 400 });
  if (when < now + 30 * 1000) throw Object.assign(new Error('Pick a time in the future.'), { status: 400 });
  if (when > now + 366 * 24 * 60 * 60 * 1000) throw Object.assign(new Error('Pick a time within the next year.'), { status: 400 });
  const { blobs } = await messages().list({ prefix: schedPrefix(user) });
  if (blobs.length >= MAX_SCHEDULED_PER_USER) throw Object.assign(new Error(`You can have up to ${MAX_SCHEDULED_PER_USER} scheduled messages.`), { status: 409 });
  const id = `${String(when).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`;
  const record = { id, user, text: clean, replyTo: isMessageId(replyTo) ? replyTo : null, sendAt: new Date(when).toISOString(), createdAt: new Date(now).toISOString() };
  await messages().setJSON(`${schedPrefix(user)}${id}`, record);
  const next = await nextScheduledAt();
  if (next == null || when < next) await setNextSched(when);
  return record;
}

export async function listScheduled(user) {
  const { blobs } = await messages().list({ prefix: schedPrefix(user) });
  const list = (await Promise.all(blobs.map((b) => messages().get(b.key, { type: 'json' })))).filter(Boolean);
  return list.sort((a, b) => (a.sendAt < b.sendAt ? -1 : 1));
}

export async function cancelScheduled(user, id) {
  if (!/^\d{13}-[a-f0-9]{8}$/.test(id || '')) return false;
  const key = `${schedPrefix(user)}${id}`;
  const exists = await messages().get(key, { type: 'json' });
  if (!exists) return false;
  await messages().delete(key);
  return true;
}

// Sends every scheduled message whose time has come. `publish(message)` does the notifications.
export async function deliverDue(publish) {
  const { blobs } = await messages().list({ prefix: 'sched/' });
  const now = Date.now();
  let delivered = 0;
  let nextAt = null;
  for (const b of blobs) {
    const id = b.key.split('/').pop();
    const at = Number(id.slice(0, 13));
    if (at > now) { nextAt = nextAt == null ? at : Math.min(nextAt, at); continue; }
    const entry = await messages().getWithMetadata(b.key, { type: 'json' });
    if (!entry) continue;
    const record = entry.data;
    if (record.claimedAt && now - record.claimedAt < SCHED_CLAIM_MS) continue;   // another request is sending it
    const claim = await messages().setJSON(b.key, { ...record, claimedAt: now }, { onlyIfMatch: entry.etag });
    if (!claim.modified) continue;
    try {
      const message = await postMessage({ author: record.user, text: record.text, replyTo: record.replyTo });
      await messages().delete(b.key);
      delivered++;
      await publish(message);
    } catch (err) {
      console.error('Scheduled message failed:', err.message);   // stays claimed; retried after two minutes
      nextAt = nextAt == null ? now + SCHED_CLAIM_MS : Math.min(nextAt, now + SCHED_CLAIM_MS);
    }
  }
  await setNextSched(nextAt);
  return delivered;
}
