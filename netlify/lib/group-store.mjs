// Chowaniec Group chat storage (Netlify Blobs) and notifications.
// Messages: group-chat store, key msg/<YYYY-MM-DD>/<id>, where id = <13-digit ms>-<random>
// so keys sort by time. Photos and voice messages: group-media store, key <mediaId>.
// Scheduled messages wait in the group-chat store under sched/<user>/<sendAt>-<random>.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { familyNames, resolveName, isHostName } from './auth.mjs';
import { sendPush } from './push.mjs';
import { DEFAULT_ROOM, prefixOf, roomMembers, isDmId, isAiDm } from './rooms.mjs';
import { deleteVideo } from './video-store.mjs';

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

// The family sticker pack: big picture + a short label. Ids are what gets stored and sent.
export const STICKERS = [
  { id: 'bravo', emoji: '👏', label: 'Bravo!' },
  { id: 'break-a-leg', emoji: '🎭', label: 'Break a leg!' },
  { id: 'curtain-up', emoji: '🎬', label: 'Curtain up!' },
  { id: 'standing-o', emoji: '🙌', label: 'Standing ovation' },
  { id: 'on-my-way', emoji: '🚗', label: 'On my way' },
  { id: 'running-late', emoji: '⏰', label: 'Running late' },
  { id: 'dinner', emoji: '🍝', label: 'Dinner time' },
  { id: 'love-you', emoji: '❤️', label: 'Love you' },
  { id: 'thank-you', emoji: '🙏', label: 'Thank you' },
  { id: 'congrats', emoji: '🎉', label: 'Congrats!' },
  { id: 'need-help', emoji: '🆘', label: 'Need a hand' },
  { id: 'good-night', emoji: '🌙', label: 'Good night' },
  { id: 'good-morning', emoji: '☀️', label: 'Good morning' },
  { id: 'rehearsal', emoji: '🎤', label: 'Rehearsal time' },
  { id: 'hug', emoji: '🤗', label: 'Big hug' },
  { id: 'cheers', emoji: '🥂', label: 'Cheers!' }
];
export const stickerById = (id) => STICKERS.find((x) => x.id === id) || null;

const messages = () => getStore({ name: 'group-chat', consistency: 'strong' });
const media = () => getStore({ name: 'group-media', consistency: 'strong' });

export const isMessageId = (id) => ID_PATTERN.test(id || '');
export const isMediaId = (id) => MEDIA_PATTERN.test(id || '');
const dayOf = (id) => new Date(Number(id.slice(0, 13))).toISOString().slice(0, 10);
const keyOf = (id, room = DEFAULT_ROOM) => `${prefixOf(room)}msg/${dayOf(id)}/${id}`;

function newId() {
  return `${String(Date.now()).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`;
}

// Days that have messages, newest first.
async function days(room = DEFAULT_ROOM) {
  const base = `${prefixOf(room)}msg/`;
  const { directories } = await messages().list({ prefix: base, directories: true });
  return directories.map((d) => d.slice(base.length).replace(/\/$/, '')).sort().reverse();
}

async function idsForDay(day, room = DEFAULT_ROOM) {
  const { blobs } = await messages().list({ prefix: `${prefixOf(room)}msg/${day}/` });
  return blobs.map((b) => b.key.split('/').pop()).sort();
}

async function load(ids, room = DEFAULT_ROOM) {
  const list = await Promise.all(ids.map((id) => messages().get(keyOf(id, room), { type: 'json' })));
  return list.filter(Boolean);
}

export async function latest(limit = 50, room = DEFAULT_ROOM) {
  const collected = [];
  for (const day of await days(room)) {
    collected.unshift(...(await idsForDay(day, room)));
    if (collected.length >= limit) break;
  }
  return load(collected.slice(-limit), room);
}

export async function since(sinceId, limit = 200, room = DEFAULT_ROOM) {
  const sinceDay = dayOf(sinceId);
  const recentDays = (await days(room)).filter((d) => d >= sinceDay).reverse();
  const ids = [];
  for (const day of recentDays) ids.push(...(await idsForDay(day, room)).filter((id) => id > sinceId));
  return load(ids.slice(0, limit), room);
}

export async function before(beforeId, limit = 50, room = DEFAULT_ROOM) {
  const beforeDay = dayOf(beforeId);
  const olderDays = (await days(room)).filter((d) => d <= beforeDay);
  const collected = [];
  for (const day of olderDays) {
    collected.unshift(...(await idsForDay(day, room)).filter((id) => id < beforeId));
    if (collected.length > limit) break;
  }
  return { messages: await load(collected.slice(-limit), room), hasMore: collected.length > limit };
}

export async function getMessage(id, room = DEFAULT_ROOM) {
  if (!isMessageId(id)) return null;
  const entry = await messages().getWithMetadata(keyOf(id, room), { type: 'json' });
  return entry ? { message: entry.data, etag: entry.etag } : null;
}

// Finds @Name (or nickname), @everyone, @important and @AI mentions (case-insensitive).
// @important pings everyone, so it is returned as 'everyone' here; use hasImportant() to tell them apart.
export function parseMentions(text) {
  const found = new Set();
  for (const match of text.matchAll(/@([A-Za-z][\w-]*)/g)) {
    const word = match[1].toLowerCase();
    if (word === 'everyone' || word === 'important') found.add('everyone');
    else if (word === 'ai' || word === 'agent' || word === 'bob') found.add('AI');
    else {
      const name = resolveName(word);
      if (name) found.add(name);
    }
  }
  return [...found];
}

export const hasImportant = (text) => /(^|[^\w])@important\b/i.test(String(text || ''));

export async function saveImage(dataUrl, room = DEFAULT_ROOM) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match || !IMAGE_TYPES.includes(match[1])) throw Object.assign(new Error('Photos must be JPEG, PNG or WebP.'), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('That photo is too large (max 2 MB).'), { status: 413 });
  const id = crypto.randomBytes(16).toString('hex');
  await media().set(id, bytes, { metadata: { contentType: match[1], room } });
  return id;
}

// Voice messages arrive as a data URL from the phone's recorder (e.g. data:audio/webm;codecs=opus;base64,...).
export async function saveAudio(dataUrl, room = DEFAULT_ROOM) {
  const match = /^data:(audio\/[\w.+-]+)(?:;[\w.=+-]+)*;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  const type = match && match[1].toLowerCase();
  if (!match || !AUDIO_TYPES.includes(type)) throw Object.assign(new Error('That voice message couldn’t be read.'), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 200) throw Object.assign(new Error('That voice message is empty.'), { status: 400 });
  if (bytes.length > MAX_AUDIO_BYTES) throw Object.assign(new Error('That voice message is too long.'), { status: 413 });
  const id = crypto.randomBytes(16).toString('hex');
  await media().set(id, bytes, { metadata: { contentType: type, room } });
  return id;
}

// Photos and voice messages share one store; the stored content type tells them apart.
export async function getImage(id) {
  if (!isMediaId(id)) return null;
  const entry = await media().getWithMetadata(id, { type: 'arrayBuffer' });
  return entry ? { bytes: entry.data, contentType: entry.metadata.contentType || 'image/jpeg', room: entry.metadata.room || DEFAULT_ROOM } : null;
}

// Stores a message and returns it. `author` is a family name or AI_NAME.
export async function postMessage({ author, text, image, replyTo, kind = 'user', poll, voice, video, gif, link, onBehalfOf, sticker, thread, sheet, important, game, gamenight, record, room = DEFAULT_ROOM }) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  const wantsImportant = kind !== 'system' && !!(important || hasImportant(clean));
  if (wantsImportant && !isHostName(onBehalfOf || author)) {
    throw Object.assign(new Error('Only Victoria, Gabriel or Nicole can send an @important ping.'), { status: 403 });
  }
  if (!clean && !image && !poll && !voice && !video && !gif && !sticker && !sheet) throw Object.assign(new Error('Write a message or add a photo.'), { status: 400 });

  let reply = null;
  if (replyTo) {
    const found = await getMessage(replyTo, room);
    if (found) reply = { id: found.message.id, user: found.message.user, text: (found.message.text || (found.message.video ? '🎬 Video' : found.message.gif ? 'GIF' : '')).slice(0, 200) };
  }

  const message = {
    id: newId(),
    user: author,
    text: clean,
    createdAt: new Date().toISOString(),
    kind,
    room,
    mentions: parseMentions(clean),
    replyTo: reply,
    image: image ? await saveImage(image, room) : null,
    reactions: {},
    ...(poll ? { poll } : {}),
    ...(voice ? { voice } : {}),
    ...(video ? { video } : {}),
    ...(gif ? { gif } : {}),
    ...(link ? { link } : {}),
    ...(onBehalfOf ? { onBehalfOf } : {}),
    ...(sticker ? { sticker } : {}),
    ...(sheet ? { sheet } : {}),
    ...(game ? { game } : {}),            // a live game card: { session, gameId, by, snap? } (see games-cards.mjs)
    ...(gamenight ? { gamenight } : {}),  // a game night card: { id, view: 'card' | 'score', after? }
    ...(record ? { record } : {}),        // a "new family record" card: { game, name, score }
    ...(wantsImportant ? { important: true } : {}),
    ...(thread ? { thread } : {})
  };
  await messages().setJSON(keyOf(message.id, room), message, { onlyIfNew: true });
  if (thread) await bumpThread(thread, room, author, message.createdAt);
  return message;
}

// Changes a stored message with `change(message)` (return false to leave it). Returns the message or null.
export async function updateMessage(id, room, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = await getMessage(id, room);
    if (!found) return null;
    const message = found.message;
    if (change(message) === false) return message;
    const { modified } = await messages().setJSON(keyOf(id, room), message, { onlyIfMatch: found.etag });
    if (modified) return message;
  }
  return null;
}

// --- Threads: side conversations under one message ---
// A reply in a thread is a normal message with message.thread = <root id>. The root keeps threadCount and threadLast.

// Checks that `rootId` can have a thread (it exists in this chat and is itself not a thread reply).
export async function threadRoot(rootId, room = DEFAULT_ROOM) {
  const found = await getMessage(rootId, room);
  if (!found || found.message.thread || found.message.kind === 'system') throw Object.assign(new Error('That message can’t have a thread.'), { status: 404 });
  return found.message;
}

async function bumpThread(rootId, room, user, at) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await getMessage(rootId, room);
    if (!found) return;
    const root = found.message;
    root.threadCount = (root.threadCount || 0) + 1;
    root.threadLast = { user, at };
    const { modified } = await messages().setJSON(keyOf(rootId, room), root, { onlyIfMatch: found.etag });
    if (modified) return;
  }
}

export async function listThread(rootId, room = DEFAULT_ROOM) {
  const root = await threadRoot(rootId, room);
  const replies = (await since(rootId, 500, room)).filter((m) => m.thread === rootId);
  return { root, replies };
}

// Who is in a thread: the person who started it and everyone who has replied.
export async function threadParticipants(rootId, room = DEFAULT_ROOM) {
  try {
    const { root, replies } = await listThread(rootId, room);
    return [...new Set([root.user, ...replies.map((m) => m.user)])];
  } catch (e) {
    return [];
  }
}

// Looks through a chat's history for messages matching the words, optionally from one person and between two dates.
export async function searchMessages(room, { q = '', user = '', from = '', to = '', limit = 100 } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  let scanned = 0;
  const allDays = await days(room);
  for (const day of allDays) {
    if (to && day > to) continue;
    if (from && day < from) break;
    const ids = (await idsForDay(day, room)).reverse();
    const list = await load(ids, room);
    scanned += list.length;
    for (const m of list.reverse()) {
      if (m.kind === 'system') continue;
      if (user && m.user !== user) continue;
      const hay = `${m.text || ''} ${(m.voice && m.voice.transcript) || ''}`.toLowerCase();
      if (words.length && !words.every((w) => hay.includes(w))) continue;
      hits.push(m);
      if (hits.length >= limit) return { hits, scanned, complete: false };
    }
    if (scanned > 3000) return { hits, scanned, complete: false };
  }
  return { hits, scanned, complete: true };
}

export async function deleteMessage(id, room = DEFAULT_ROOM) {
  const found = await getMessage(id, room);
  if (!found) return;
  await messages().delete(keyOf(id, room));
  if (found.message.image) await media().delete(found.message.image);
  if (found.message.voice) await media().delete(found.message.voice.id);
  if (found.message.video) {
    await deleteVideo(found.message.video.id);
    if (found.message.video.poster) await media().delete(found.message.video.poster);
  }
}

// Toggles `user`'s reaction, retrying if someone else reacted at the same moment.
export async function toggleReaction(id, user, emoji, room = DEFAULT_ROOM) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await getMessage(id, room);
    if (!found) return null;
    const message = found.message;
    const people = new Set(message.reactions[emoji] || []);
    if (people.has(user)) people.delete(user);
    else people.add(user);
    if (people.size) message.reactions[emoji] = [...people];
    else delete message.reactions[emoji];
    const { modified } = await messages().setJSON(keyOf(id, room), message, { onlyIfMatch: found.etag });
    if (modified) return message;
  }
  throw Object.assign(new Error('Too many reactions at once. Try again.'), { status: 409 });
}

// Someone played a voice message: remember who has listened (the sender sees "Heard by ...").
export async function markListened(id, user, room = DEFAULT_ROOM) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await getMessage(id, room);
    if (!found || !found.message.voice) return null;
    const message = found.message;
    const heard = new Set(message.listenedBy || []);
    if (heard.has(user) || message.user === user) return message;
    heard.add(user);
    message.listenedBy = [...heard];
    const { modified } = await messages().setJSON(keyOf(id, room), message, { onlyIfMatch: found.etag });
    if (modified) return message;
  }
  return null;
}

// Push notifications for a new message: mentioned people get "X mentioned you",
// everyone else a normal message notification. The author is never notified.
export async function notifyMessage(message) {
  const preview = message.text ? message.text.slice(0, 140)
    : message.sticker ? 'Sent a sticker' : message.video ? 'Sent a video' : message.gif ? 'Sent a GIF' : 'Sent a photo';
  const body = message.image && message.text ? `📷 ${preview}` : message.video ? `🎬 ${preview}` : message.gif && message.text ? `🎞️ ${preview}` : preview;
  let everyone = roomMembers(message.room || DEFAULT_ROOM);
  let threadTitle = '';
  if (message.thread) {
    // A thread reply goes to the people in that thread (and anyone @mentioned), not the whole chat.
    const inThread = await threadParticipants(message.thread, message.room || DEFAULT_ROOM);
    const mentionedNames = message.mentions.includes('everyone') ? everyone : message.mentions;
    everyone = everyone.filter((n) => inThread.includes(n) || mentionedNames.includes(n));
    threadTitle = ' in a thread';
  }
  const mentioned = message.mentions.includes('everyone')
    ? everyone
    : message.mentions.filter((m) => everyone.includes(m));
  const others = everyone.filter((n) => !mentioned.includes(n));
  const skip = message.onBehalfOf || message.user;   // the person an AI message was sent for already knows
  const url = message.room && message.room !== DEFAULT_ROOM ? `/group/?room=${message.room}` : '/group/';
  if (isAiDm(message.room)) return;                      // the AI's own chat: replyAsAi notifies the person
  if (isDmId(message.room)) {
    // A direct message: always treated like a mention (it is for them), never a group-style notification.
    const to = everyone.filter((n) => n !== skip);
    if (to.length) await sendPush(to, { title: message.onBehalfOf ? `${AI_NAME} for ${message.onBehalfOf}` : message.user, body, url, tag: `dm-${message.room}`, from: message.onBehalfOf ? AI_NAME : message.user }, { exclude: skip, room: message.room, kind: message.important ? 'important' : 'mention' });
    return;
  }
  if (message.important) {
    // Everyone in the chat is pinged, whatever their notification mode (only a full "off" is respected).
    await sendPush(everyone, { title: `🚨 Important from ${message.onBehalfOf || message.user}`, body, url, tag: `important-${message.id}`, requireInteraction: true, from: message.onBehalfOf || message.user }, { exclude: skip, kind: 'important' });
    return;
  }
  await Promise.all([
    mentioned.length ? sendPush(mentioned, { title: `${message.user} mentioned you`, body, url, from: message.user }, { exclude: skip, kind: 'mention', room: message.room || DEFAULT_ROOM }) : 0,
    others.length ? sendPush(others, { title: `${message.user}${threadTitle}`, body, url, from: message.user }, { exclude: skip, kind: 'message', room: message.room || DEFAULT_ROOM }) : 0
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
    return `[${when}] ${m.user}${reply}: ${m.text || ''}${m.image ? ' [photo]' : ''}${m.voice ? ` [voice message${m.voice.transcript ? `: "${m.voice.transcript.slice(0, 300)}"` : ''}]` : ''}${m.sticker ? ' [sticker]' : ''}${m.video ? ' [video]' : ''}${m.gif ? ` [GIF: ${m.gif.title}]` : ''}${poll}`;
  }).join('\n');
}

// --- Presence (online / typing / read receipts) and the pinned message ---
// presence/<user>: { user, lastSeen, typingUntil, lastReadId }. Only that person's devices write it.

const ONLINE_MS = 60 * 1000;
const SEEN_REFRESH_MS = 25 * 1000;
const TYPING_MS = 6 * 1000;
const presenceKey = (user, room = DEFAULT_ROOM) => `${prefixOf(room)}presence/${encodeURIComponent(user)}`;

async function updatePresence(user, change, room = DEFAULT_ROOM) {
  const key = presenceKey(user, room);
  const current = (await messages().get(key, { type: 'json' })) || { user, lastSeen: null, typingUntil: null, lastReadId: null };
  const next = change(current);
  if (next) await messages().setJSON(key, next);
}

// Marks `user` as online; writes at most every 25s to keep polling cheap.
export function touchPresence(user, room = DEFAULT_ROOM) {
  return updatePresence(user, (p) => {
    if (p.lastSeen && Date.now() - Date.parse(p.lastSeen) < SEEN_REFRESH_MS) return null;
    return { ...p, lastSeen: new Date(Date.now()).toISOString() };
  }, room);
}

export function setTyping(user, room = DEFAULT_ROOM) {
  const now = Date.now();
  return updatePresence(user, (p) => ({ ...p, lastSeen: new Date(now).toISOString(), typingUntil: new Date(now + TYPING_MS).toISOString() }), room);
}

// Sending a message ends that person's typing indicator straight away.
export function clearTyping(user, room = DEFAULT_ROOM) {
  return updatePresence(user, (p) => (p.typingUntil ? { ...p, typingUntil: null } : null), room);
}

// Read receipts only move forward (ids sort by time).
export function setRead(user, id, room = DEFAULT_ROOM) {
  return updatePresence(user, (p) => {
    if (p.lastReadId && p.lastReadId >= id) return null;
    return { ...p, lastReadId: id, lastSeen: new Date(Date.now()).toISOString() };
  }, room);
}

export async function listPresence(room = DEFAULT_ROOM) {
  const { blobs } = await messages().list({ prefix: `${prefixOf(room)}presence/` });
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

export async function getPinned(room = DEFAULT_ROOM) {
  return (await messages().get(`${prefixOf(room)}meta/pinned`, { type: 'json' })) || null;
}

export async function pinMessage(id, user, room = DEFAULT_ROOM) {
  const found = await getMessage(id, room);
  if (!found) return null;
  const { message } = found;
  const pinned = {
    id: message.id, user: message.user, text: message.text.slice(0, 300), image: message.image,
    pinnedBy: user, pinnedAt: new Date().toISOString()
  };
  await messages().setJSON(`${prefixOf(room)}meta/pinned`, pinned);
  return pinned;
}

export async function unpin(room = DEFAULT_ROOM) {
  await messages().delete(`${prefixOf(room)}meta/pinned`);
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
export async function votePoll(id, user, optionId, room = DEFAULT_ROOM) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await getMessage(id, room);
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
    const { modified } = await messages().setJSON(keyOf(id, room), message, { onlyIfMatch: found.etag });
    if (modified) return message;
  }
  throw Object.assign(new Error('Lots of votes at once. Try again.'), { status: 409 });
}

export async function closePoll(id, user, isHost, room = DEFAULT_ROOM) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await getMessage(id, room);
    if (!found || !found.message.poll) return null;
    const message = found.message;
    if (message.user !== user && !isHost) throw Object.assign(new Error('Only the person who made the poll or a host can close it.'), { status: 403 });
    message.poll.closed = true;
    message.poll.closedAt = new Date().toISOString();
    const { modified } = await messages().setJSON(keyOf(id, room), message, { onlyIfMatch: found.etag });
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

export async function scheduleMessage({ user, text, replyTo, sendAt, room = DEFAULT_ROOM, asAi = false }) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (hasImportant(clean) && !isHostName(user)) throw Object.assign(new Error('Only Victoria, Gabriel or Nicole can send an @important ping.'), { status: 403 });
  if (!clean) throw Object.assign(new Error('Write a message to schedule.'), { status: 400 });
  const when = Date.parse(sendAt);
  const now = Date.now();
  if (isNaN(when)) throw Object.assign(new Error('Pick a date and time.'), { status: 400 });
  if (when < now + 30 * 1000) throw Object.assign(new Error('Pick a time in the future.'), { status: 400 });
  if (when > now + 366 * 24 * 60 * 60 * 1000) throw Object.assign(new Error('Pick a time within the next year.'), { status: 400 });
  const { blobs } = await messages().list({ prefix: schedPrefix(user) });
  if (blobs.length >= MAX_SCHEDULED_PER_USER) throw Object.assign(new Error(`You can have up to ${MAX_SCHEDULED_PER_USER} scheduled messages.`), { status: 409 });
  const id = `${String(when).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`;
  const record = { id, user, room, ...(asAi ? { asAi: true } : {}), text: clean, replyTo: isMessageId(replyTo) ? replyTo : null, sendAt: new Date(when).toISOString(), createdAt: new Date(now).toISOString() };
  await messages().setJSON(`${schedPrefix(user)}${id}`, record);
  const next = await nextScheduledAt();
  if (next == null || when < next) await setNextSched(when);
  return record;
}

export async function listScheduled(user, room = DEFAULT_ROOM) {
  const { blobs } = await messages().list({ prefix: schedPrefix(user) });
  const list = (await Promise.all(blobs.map((b) => messages().get(b.key, { type: 'json' })))).filter((r) => r && (r.room || DEFAULT_ROOM) === room);
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
      const message = await postMessage({
        author: record.asAi ? AI_NAME : record.user, kind: record.asAi ? 'ai' : 'user', onBehalfOf: record.asAi ? record.user : undefined,
        text: record.text, replyTo: record.replyTo, room: record.room || DEFAULT_ROOM
      });
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


// ---- Starred (saved) messages: a personal list of { room, id, at }, newest first.
const starsKey = (name) => `stars/${encodeURIComponent(name)}`;
const MAX_STARS = 300;

export async function getStarRefs(name) {
  return (await messages().get(starsKey(name), { type: 'json' })) || [];
}

// Adds or removes a star. Returns { starred, refs }.
export async function toggleStar(name, room, id) {
  const refs = await getStarRefs(name);
  const has = refs.some((r) => r.room === room && r.id === id);
  const next = has ? refs.filter((r) => !(r.room === room && r.id === id)) : [{ room, id, at: new Date().toISOString() }, ...refs].slice(0, MAX_STARS);
  await messages().setJSON(starsKey(name), next);
  return { starred: !has, refs: next };
}
