// Live location sharing in the chats (see netlify/functions/location.mjs and group/location.js).
// Netlify Blobs store 'location', key share/<id>: one record per share
//   { id, user, room, msg, startedAt, until, seenAt, pos: { lat, lng, acc, heading, speed, at }, endedAt?, reason?, coarse? }
// Privacy:
//   - Only the latest position is kept (no trail / history). Each update overwrites it.
//   - A share lasts at most 8 hours; it can be extended, but never to more than 8 hours from now.
//   - When a share ends (stopped, "home safe" or expired) the precise position is thrown away: only a coarse
//     last spot is kept (rounded to 3 decimals, about 100 m, shown with a 150 m+ circle) and heading/speed go.
//   - Ended shares are deleted completely after 7 days (checked whenever shares are read), after which the
//     card only says that the sharing ended.
// Expiry is checked on every read (no scheduler needed): an expired share is ended there and then.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { postMessage, updateMessage } from './group-store.mjs';
import { roomMembers, canAccessRoom, roomsFor, dmParts, DEFAULT_ROOM } from './rooms.mjs';
import { sendPush } from './push.mjs';

export const DURATIONS = [15, 60, 480];        // minutes the chooser offers
export const MAX_MINUTES = 480;                 // 8 hours, for privacy
export const MIN_UPDATE_MS = 10 * 1000;         // the page sends at most every 15 s; the server allows 10 s
export const PAUSED_MS = 2 * 60 * 1000;         // no update for this long (page closed or hidden) -> "paused"
export const KEEP_ENDED_MS = 7 * 24 * 60 * 60 * 1000;
const COARSE_ACC = 150;
const ID = /^[a-f0-9]{16}$/;

// The clock (tests move it).
export const clock = { offset: 0, now: () => Date.now() + clock.offset };
const iso = (t) => new Date(t).toISOString();
const ms = (s) => (s ? Date.parse(s) : 0);
const err = (status, message) => Object.assign(new Error(message), { status });

const store = () => getStore({ name: 'location', consistency: 'strong' });
const keyOf = (id) => `share/${id}`;
export const isShareId = (id) => ID.test(String(id || ''));
const chatUrl = (room) => (!room || room === DEFAULT_ROOM ? '/group/' : `/group/?room=${room}`);

// ---------------------------------------------------------------- reading

async function load(id) {
  if (!isShareId(id)) return null;
  const entry = await store().getWithMetadata(keyOf(id), { type: 'json' });
  return entry ? { rec: entry.data, etag: entry.etag } : null;
}

// Changes a share with `change(rec)` (return false to leave it). Returns the record or null.
async function mutate(id, change) {
  for (let i = 0; i < 5; i++) {
    const found = await load(id);
    if (!found) return null;
    const rec = found.rec;
    if (change(rec) === false) return rec;
    const { modified } = await store().setJSON(keyOf(id), rec, { onlyIfMatch: found.etag });
    if (modified) return rec;
  }
  throw err(409, 'Someone else changed this at the same moment. Try again.');
}

const coarse = (n) => Math.round(n * 1000) / 1000;

// Ends a record in place: the precise spot is replaced by a coarse one.
function endRecord(rec, reason, at) {
  rec.endedAt = iso(at);
  rec.reason = reason;
  if (rec.pos) rec.pos = { lat: coarse(rec.pos.lat), lng: coarse(rec.pos.lng), acc: Math.max(COARSE_ACC, Math.round(rec.pos.acc || 0)), at: rec.pos.at };
  rec.coarse = true;
  return rec;
}

// The card message says the sharing has ended.
async function markMessageEnded(rec) {
  if (!rec.msg) return;
  await updateMessage(rec.msg, rec.room, (m) => {
    if (m.location && m.location.ended) return false;
    m.location = { ...(m.location || {}), shareId: rec.id, ended: true };
    m.text = `${rec.user} shared live location`;
  }).catch((e) => console.error('Location card update failed:', e.message));
}

// Ends a share that ran out (expiry-on-read). Returns the fresh record.
async function settle(rec) {
  if (!rec || rec.endedAt || ms(rec.until) > clock.now()) return rec;
  const ended = await mutate(rec.id, (r) => { if (r.endedAt) return false; endRecord(r, 'expired', ms(r.until)); });
  if (ended) await markMessageEnded(ended);
  return ended || rec;
}

export async function getShare(id) {
  const found = await load(id);
  return found ? settle(found.rec) : null;
}

// Every share still stored (ended ones are removed after 7 days).
export async function allShares() {
  const { blobs } = await store().list({ prefix: 'share/' });
  const recs = await Promise.all(blobs.map((b) => store().get(b.key, { type: 'json' }).catch(() => null)));
  const now = clock.now();
  const out = [];
  for (const r of recs) {
    if (!r) continue;
    if (r.endedAt && now - ms(r.endedAt) > KEEP_ENDED_MS) { await store().delete(keyOf(r.id)); continue; }
    out.push(await settle(r));
  }
  return out;
}

// What the chat page sees.
export function publicShare(rec) {
  const now = clock.now();
  const active = !rec.endedAt;
  const seen = ms(rec.seenAt) || ms(rec.startedAt);
  return {
    id: rec.id, user: rec.user, room: rec.room, msg: rec.msg || null,
    startedAt: rec.startedAt, until: rec.until, endedAt: rec.endedAt || null, reason: rec.reason || null,
    active, paused: active && now - seen > PAUSED_MS, seenAt: rec.seenAt || null,
    pos: rec.pos || null, coarse: !!rec.coarse
  };
}

export async function sharesInRoom(room) {
  return (await allShares()).filter((r) => r.room === room).sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
}

// Display name of a chat for `name` (the other person for a direct message).
function roomNameFor(name, room) {
  const dm = dmParts(room);
  if (dm) return dm.ai ? 'Chowaniec AI' : dm.people.find((p) => p !== name) || room;
  const r = roomsFor(name).find((x) => x.id === room);
  return r ? r.name : room;
}

// Shares going on right now in any chat `name` is in (for the home dashboard).
export async function activeFor(name) {
  const now = clock.now();
  return (await allShares())
    .filter((r) => !r.endedAt && ms(r.until) > now && canAccessRoom(name, r.room))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .map((r) => ({ id: r.id, name: r.user, mine: r.user === name, until: r.until, room: r.room, roomName: roomNameFor(name, r.room), paused: publicShare(r).paused }));
}

// ---------------------------------------------------------------- validation

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

export function cleanFix(body) {
  const lat = num(body.lat);
  const lng = num(body.lng);
  const acc = body.acc == null ? 0 : num(body.acc);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw err(400, 'That location isn’t valid.');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw err(400, 'That location isn’t valid.');
  if (!Number.isFinite(acc) || acc < 0 || acc > 100000) throw err(400, 'That location accuracy isn’t valid.');
  const opt = (v, max) => { if (v == null || v === '') return null; const n = num(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null; };
  return {
    lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: Math.round(acc),
    heading: opt(body.heading, 360), speed: opt(body.speed, 500), at: iso(clock.now())
  };
}

function cleanMinutes(v, list) {
  const n = Math.round(num(v));
  if (!list.includes(n)) throw err(400, `Choose ${list.map((m) => (m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`)).join(', ')}.`);
  return n;
}

// ---------------------------------------------------------------- actions

function ownActive(rec, name) {
  if (!rec) throw err(404, 'That location share isn’t there any more.');
  if (rec.user !== name) throw err(403, 'Only the person sharing can change this.');
  if (rec.endedAt) throw err(409, 'This location share has already ended.');
  return rec;
}

// Starts sharing in a chat and posts the live card. Returns { share, message, existing }.
export async function startShare(name, room, minutes, fix) {
  const mins = cleanMinutes(minutes, DURATIONS);
  const pos = fix && fix.lat != null ? cleanFix(fix) : null;
  const mineHere = (await sharesInRoom(room)).find((r) => r.user === name && !r.endedAt);
  if (mineHere) return { share: mineHere, existing: true };

  const now = clock.now();
  const rec = {
    id: crypto.randomBytes(8).toString('hex'), user: name, room, msg: null,
    startedAt: iso(now), until: iso(now + mins * 60000), seenAt: iso(now), pos
  };
  await store().setJSON(keyOf(rec.id), rec, { onlyIfNew: true });
  const posted = await postMessage({ author: name, room, kind: 'user', text: `${name} is sharing live location` });
  // group-store's postMessage has no `location` field, so the card marker is added straight after.
  const message = await updateMessage(posted.id, room, (m) => { m.location = { shareId: rec.id }; }) || { ...posted, location: { shareId: rec.id } };
  const saved = await mutate(rec.id, (r) => { r.msg = message.id; });
  return { share: saved, message, existing: false, minutes: mins };
}

export function durationLabel(mins) {
  return mins < 60 ? `${mins} minutes` : mins === 60 ? '1 hour' : `${mins / 60} hours`;
}

// Tells the others in the chat. Never throws.
export async function notifyStart(rec, minutes) {
  try {
    const to = roomMembers(rec.room).filter((n) => n !== rec.user);
    if (!to.length) return;
    await sendPush(to, {
      title: `${rec.user} is sharing location`,
      body: `Live for ${durationLabel(minutes)}. Tap to see where.`,
      url: chatUrl(rec.room), tag: `location-${rec.id}`, from: rec.user
    }, { exclude: rec.user, kind: 'other', room: rec.room });
  } catch (e) {
    console.error('Location notify failed:', e.message);
  }
}

export async function updateShare(name, id, body) {
  const fix = cleanFix(body);
  ownActive(await getShare(id), name);
  let tooSoon = 0;
  const rec = await mutate(id, (r) => {
    ownActive(r, name);
    const last = ms(r.seenAt);
    if (r.pos && clock.now() - last < MIN_UPDATE_MS) { tooSoon = MIN_UPDATE_MS - (clock.now() - last); return false; }
    r.pos = fix;
    r.seenAt = fix.at;
  });
  if (tooSoon) throw Object.assign(err(429, 'Too many location updates. Wait a few seconds.'), { retryIn: Math.ceil(tooSoon / 1000) });
  return rec;
}

export async function stopShare(name, id, reason = 'stopped') {
  ownActive(await getShare(id), name);
  const rec = await mutate(id, (r) => { ownActive(r, name); endRecord(r, reason, clock.now()); });
  await markMessageEnded(rec);
  return rec;
}

// Adds time, but never past 8 hours from now.
export async function extendShare(name, id, minutes) {
  const mins = cleanMinutes(minutes, DURATIONS);
  ownActive(await getShare(id), name);
  return mutate(id, (r) => {
    ownActive(r, name);
    const now = clock.now();
    r.until = iso(Math.min(Math.max(ms(r.until), now) + mins * 60000, now + MAX_MINUTES * 60000));
  });
}

// "I'm home safe": stops my sharing in this chat and posts a friendly message.
export async function homeSafe(name, room) {
  const mine = (await sharesInRoom(room)).filter((r) => r.user === name && !r.endedAt);
  const stopped = [];
  for (const r of mine) stopped.push(await stopShare(name, r.id, 'home'));
  const posted = await postMessage({ author: name, room, kind: 'user', text: 'I’m home safe' });
  const message = await updateMessage(posted.id, room, (m) => { m.location = { home: true, ...(stopped[0] ? { shareId: stopped[0].id } : {}) }; }) || { ...posted, location: { home: true } };
  return { message, stopped };
}
