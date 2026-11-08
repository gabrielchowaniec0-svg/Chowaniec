// Note Uploader: meeting notes the kids send to the family heads (Netlify Blobs, store "uploads").
//   index            { items: [summary…] }  one record the list/unread calls read (no list() needed for freshness)
//   sub/<id>         the whole submission: { id, meeting, author, createdAt, markdown, todos, photos: [{ id, w, h, size }],
//                    seenBy: { name: iso }, reviewedBy: { name: iso }, replies: [{ id, by, at, text }], authorSeenAt, noteId }
//   photo/<pid>      JPEG/PNG/WebP bytes
//   pmeta/<pid>      { owner, sub|null, type, size, at }  who may see the photo (owner until it is sent, then the submission's readers)
//   rate/<name>      { at: [ms…] }  recent sends/photo uploads, for the per-person rate limit
// Who may do what lives here (and only here), so the lists are easy to change.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { isHostName, resolveName, familyNames } from './auth.mjs';

// ---- roles ----
export const UPLOADERS = ['Liliana', 'Amelia', 'Emilia'];
export const RECIPIENTS = ['Gabriel', 'Victoria', 'Nicole'];

export const MAX_MARKDOWN = 50000;
export const MAX_PHOTOS = 8;
export const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
export const MAX_TODOS = 30;
const KEEP = 400;                       // submissions kept in the index
const SENDS_PER_HOUR = 12;
const PHOTOS_PER_HOUR = 80;

export const store = () => getStore({ name: 'uploads', consistency: 'strong' });
export const ID = /^[a-f0-9]{20}$/;
export const PHOTO_ID = /^[a-f0-9]{24}$/;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const newId = (bytes) => crypto.randomBytes(bytes).toString('hex');

export const recipients = () => RECIPIENTS.filter((n) => isHostName(n));
export const isRecipient = (user) => !!user && user.name !== 'Guest' && recipients().includes(user.name);
export const isUploader = (user) => !!user && user.name !== 'Guest' && UPLOADERS.includes(user.name) && familyNames().includes(user.name);
export const canPost = (user) => isUploader(user) || isRecipient(user);
export const roleOf = (user) => (isRecipient(user) ? 'recipient' : isUploader(user) ? 'uploader' : 'none');
// Heads see everything; anyone else only what they sent themselves.
export const canSee = (user, sub) => !!sub && (isRecipient(user) || (canPost(user) && sub.author === user.name));
export const canDelete = (user) => isRecipient(user) && !!user.host;

// ---- index ----
export function summaryOf(sub) {
  const plain = String(sub.markdown || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#>*_`|[\]-]/g, ' ').replace(/\s+/g, ' ').trim();
  const last = (sub.replies || []).slice(-1)[0] || null;
  return {
    id: sub.id, meeting: sub.meeting, author: sub.author, createdAt: sub.createdAt,
    preview: plain.slice(0, 160), photoCount: (sub.photos || []).length, todoCount: (sub.todos || []).length,
    cover: (sub.photos || [])[0] ? sub.photos[0].id : null,
    seenBy: sub.seenBy || {}, reviewedBy: sub.reviewedBy || {},
    replyCount: (sub.replies || []).length, lastReply: last ? { by: last.by, at: last.at, text: last.text.slice(0, 140) } : null,
    activityAt: sub.activityAt || sub.createdAt, authorSeenAt: sub.authorSeenAt || sub.createdAt, noteId: sub.noteId || null
  };
}

async function readIndex() {
  const entry = await store().getWithMetadata('index', { type: 'json' });
  return entry ? { items: (entry.data && entry.data.items) || [], etag: entry.etag } : { items: [], etag: null };
}

// Applies `change(items) -> items` to the index, retrying when someone else writes at the same moment.
async function updateIndex(change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { items, etag } = await readIndex();
    const next = change(items.slice()).slice(0, KEEP);
    const res = await store().setJSON('index', { items: next }, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (res.modified) return next;
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 40 * (attempt + 1)));
  }
  throw bad('Lots of people are sending at once. Please try again.', 409);
}
const upsert = (sub) => updateIndex((items) => [summaryOf(sub), ...items.filter((i) => i.id !== sub.id)].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));

export async function listFor(user) {
  const { items } = await readIndex();
  return items.filter((i) => canSee(user, i));
}

// Recipients: submissions from others they haven't opened. Uploaders: their submissions with a reply or review they haven't seen.
export function isUnread(user, item) {
  if (isRecipient(user) && item.author !== user.name) return !item.seenBy[user.name];
  if (item.author === user.name) return (item.activityAt || '') > (item.authorSeenAt || '');
  return false;
}
export async function unreadCount(user) {
  if (!canPost(user)) return 0;
  return (await listFor(user)).filter((i) => isUnread(user, i)).length;
}

// ---- submissions ----
export async function readSub(id) {
  if (!ID.test(id || '')) return null;
  const entry = await store().getWithMetadata(`sub/${id}`, { type: 'json' });
  return entry ? { sub: entry.data, etag: entry.etag } : null;
}

// Changes one submission (`change(sub)` mutates and returns true to save), with etag retries, then refreshes the index.
async function updateSub(user, id, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const found = await readSub(id);
    if (!found || !canSee(user, found.sub)) throw bad('Those notes were not found.', 404);
    const sub = found.sub;
    if (change(sub) === false) return sub;
    const res = await store().setJSON(`sub/${id}`, sub, { onlyIfMatch: found.etag });
    if (res.modified) { await upsert(sub); return sub; }
  }
  throw bad('Someone else just changed these notes. Please try again.', 409);
}

async function rateLimit(name, kind, max) {
  const key = `rate/${kind}/${encodeURIComponent(name)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const entry = await store().getWithMetadata(key, { type: 'json' });
    const at = ((entry && entry.data && entry.data.at) || []).filter((t) => Date.now() - t < 60 * 60 * 1000);
    if (at.length >= max) throw bad(kind === 'send' ? 'That is a lot of notes in one hour. Take a break and try again a bit later.' : 'Too many photos in one hour. Try again a bit later.', 429);
    at.push(Date.now());
    const res = await store().setJSON(key, { at }, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (res.modified) return;
  }
}

// A photo as a data URL -> { bytes, type }, checking the type really matches the bytes.
export function decodePhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Photos must be JPEG, PNG or WebP pictures.');
  if (m[2].length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 8) throw bad('One of the photos is too big (the limit is 1.5 MB).', 413);
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) throw bad('One of the photos is empty.');
  if (bytes.length > MAX_PHOTO_BYTES) throw bad('One of the photos is too big (the limit is 1.5 MB).', 413);
  const type = m[1];
  const ok = type === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
    : type === 'image/png' ? bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP';
  if (!ok) throw bad('That file is not a picture.');
  return { bytes, type };
}

async function savePhoto(user, dataUrl, sub = null) {
  const { bytes, type } = decodePhoto(dataUrl);
  const id = newId(12);
  await store().set(`photo/${id}`, bytes);
  await store().setJSON(`pmeta/${id}`, { owner: user.name, sub, type, size: bytes.length, at: new Date().toISOString() });
  return { id, size: bytes.length };
}

// Uploads one photo ahead of sending (so a big batch never hits the request size limit). Only its owner sees it until it is sent.
export async function uploadPhoto(user, dataUrl) {
  if (!canPost(user)) throw bad('Only Liliana, Amelia and Emilia can send meeting notes.', 403);
  decodePhoto(dataUrl);
  await rateLimit(user.name, 'photo', PHOTOS_PER_HOUR);
  return savePhoto(user, dataUrl);
}

// The bytes of a photo if `user` may see it.
export async function readPhoto(user, pid) {
  if (!PHOTO_ID.test(pid || '')) return null;
  const meta = await store().get(`pmeta/${pid}`, { type: 'json' });
  if (!meta) return null;
  if (meta.sub) {
    const found = await readSub(meta.sub);
    if (!found || !canSee(user, found.sub)) return null;
  } else if (meta.owner !== user.name) return null;
  const bytes = await store().get(`photo/${pid}`, { type: 'arrayBuffer' });
  return bytes ? { bytes, type: meta.type || 'image/jpeg' } : null;
}

function cleanTodos(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_TODOS).map((t) => {
    const what = String((t && t.what) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const rawWho = String((t && t.who) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return what ? { who: resolveName(rawWho) || rawWho || 'Everyone', what } : null;
  }).filter(Boolean);
}

/**
 * Stores new notes. `input` = { meeting: { title, eventId?, meetingCode? }, markdown, todos, photos: [dataURL | photo id] }.
 * `checkEvent(id)` returns the calendar event if the sender can see it (null otherwise).
 */
export async function createSubmission(user, input, { checkEvent = async () => null, isMeetingCode = () => false } = {}) {
  if (!canPost(user)) throw bad('Only Liliana, Amelia and Emilia can send meeting notes.', 403);
  const meetingIn = (input && input.meeting) || {};
  const title = String(meetingIn.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!title) throw bad('Pick or type which meeting these notes are for.');
  const markdown = String((input && input.markdown) || '');
  if (markdown.length > MAX_MARKDOWN) throw bad('These notes are too long (the limit is 50,000 characters).', 413);
  const todos = cleanTodos(input && input.todos);
  const photosIn = Array.isArray(input && input.photos) ? input.photos : [];
  if (photosIn.length > MAX_PHOTOS) throw bad(`You can attach up to ${MAX_PHOTOS} photos.`);
  if (!markdown.trim() && !photosIn.length && !todos.length) throw bad('Write some notes or add a photo first.');
  photosIn.forEach((p) => { if (typeof p === 'string' && p.startsWith('data:')) decodePhoto(p); else if (!PHOTO_ID.test(String((p && p.id) || p))) throw bad('One of the photos is missing. Add it again.'); });

  const meeting = { title };
  if (meetingIn.eventId) { const ev = await checkEvent(String(meetingIn.eventId)); if (ev) { meeting.eventId = ev.id; meeting.date = ev.date; } }
  if (meetingIn.meetingCode && isMeetingCode(String(meetingIn.meetingCode))) meeting.meetingCode = String(meetingIn.meetingCode);

  await rateLimit(user.name, 'send', SENDS_PER_HOUR);
  const id = newId(10);
  const photos = [];
  for (const p of photosIn) {
    if (typeof p === 'string' && p.startsWith('data:')) { photos.push(await savePhoto(user, p, id)); continue; }
    const pid = String((p && p.id) || p);
    const meta = await store().get(`pmeta/${pid}`, { type: 'json' });
    if (!meta || meta.owner !== user.name || meta.sub) throw bad('One of the photos is missing. Add it again.');
    await store().setJSON(`pmeta/${pid}`, { ...meta, sub: id });
    photos.push({ id: pid, size: meta.size });
  }
  const now = new Date().toISOString();
  const sub = {
    id, meeting, author: user.name, createdAt: now, markdown, todos, photos,
    seenBy: {}, reviewedBy: {}, replies: [], activityAt: now, authorSeenAt: now, noteId: null
  };
  await store().setJSON(`sub/${id}`, sub, { onlyIfNew: true });
  await upsert(sub);
  return sub;
}

// Opening notes: a head marks them seen; the author catches up on replies and reviews.
export function markSeen(user, id) {
  return updateSub(user, id, (sub) => {
    const now = new Date().toISOString();
    let changed = false;
    if (isRecipient(user) && sub.author !== user.name && !sub.seenBy[user.name]) { sub.seenBy[user.name] = now; changed = true; }
    if (sub.author === user.name && (sub.activityAt || '') > (sub.authorSeenAt || '')) { sub.authorSeenAt = now; changed = true; }
    return changed;
  });
}

export function review(user, id, on = true) {
  if (!isRecipient(user)) return Promise.reject(bad('Only Gabriel, Vicky and Nicole can review notes.', 403));
  return updateSub(user, id, (sub) => {
    const now = new Date().toISOString();
    if (on) { if (sub.reviewedBy[user.name]) return false; sub.reviewedBy[user.name] = now; } else { if (!sub.reviewedBy[user.name]) return false; delete sub.reviewedBy[user.name]; }
    if (sub.author !== user.name) sub.seenBy[user.name] = sub.seenBy[user.name] || now;
    if (on && sub.author !== user.name) sub.activityAt = now;
    return true;
  });
}

export function reply(user, id, text) {
  const t = String(text || '').trim().slice(0, 1000);
  if (!t) return Promise.reject(bad('Write a message first.'));
  return updateSub(user, id, (sub) => {
    if (!isRecipient(user) && sub.author !== user.name) throw bad('You can’t reply to these notes.', 403);
    if ((sub.replies || []).length >= 100) throw bad('This conversation is full.');
    const now = new Date().toISOString();
    sub.replies = [...(sub.replies || []), { id: newId(6), by: user.name, at: now, text: t }];
    if (sub.author !== user.name) { sub.activityAt = now; sub.seenBy[user.name] = sub.seenBy[user.name] || now; } else sub.authorSeenAt = now;
    return true;
  });
}

export function linkNote(user, id, noteId) {
  return updateSub(user, id, (sub) => { sub.noteId = noteId; sub.savedBy = user.name; return true; });
}

export async function deleteSubmission(user, id) {
  if (!canDelete(user)) throw bad('Only Gabriel, Vicky and Nicole can delete notes.', 403);
  const found = await readSub(id);
  if (!found) throw bad('Those notes were not found.', 404);
  await Promise.all((found.sub.photos || []).flatMap((p) => [store().delete(`photo/${p.id}`), store().delete(`pmeta/${p.id}`)]));
  await store().delete(`sub/${id}`);
  await updateIndex((items) => items.filter((i) => i.id !== id));
}

// Markdown for the Notes app: the notes, the to-dos as a checklist, and the photos (served to the same people).
export function noteMarkdown(sub) {
  const when = new Date(sub.createdAt).toLocaleDateString('en-US', { dateStyle: 'long' });
  const lines = [`# ${sub.meeting.title}`, '', `*Meeting notes from ${sub.author}, ${when}*`, ''];
  if (sub.markdown.trim()) lines.push(sub.markdown.trim(), '');
  if (sub.todos.length) lines.push('## Things to do', '', ...sub.todos.map((t) => `- [ ] **${t.who}**: ${t.what}`), '');
  if (sub.photos.length) lines.push('## Photos', '', ...sub.photos.map((p, i) => `![Photo ${i + 1}](/.netlify/functions/uploads?photo=${p.id})`), '');
  return lines.join('\n');
}

// Recent Meet meetings (from attendance) for the meeting picker: the ones this person was in, or any for a head.
export async function recentMeets(user, days = 4) {
  const att = getStore({ name: 'meeting-attendance', consistency: 'strong' });
  const { blobs } = await att.list();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const records = (await Promise.all(blobs.slice(-200).map((b) => att.get(b.key, { type: 'json' })))).filter(Boolean);
  return records
    .filter((r) => r.attendees && Date.parse(r.lastSeen || r.firstJoinedAt || 0) > since && (isRecipient(user) || r.attendees[user.name]))
    .sort((a, b) => ((a.lastSeen || '') < (b.lastSeen || '') ? 1 : -1))
    .slice(0, 6)
    .map((r) => ({ code: r.code, at: r.lastSeen || r.firstJoinedAt, attendees: Object.keys(r.attendees) }));
}
