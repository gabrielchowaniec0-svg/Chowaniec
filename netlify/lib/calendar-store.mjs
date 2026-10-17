// The family calendar (Netlify Blobs, store "calendar").
// event/<date>/<id>: { id, title, date 'YYYY-MM-DD', time 'HH:MM'|null, endTime, location, notes, room,
//   createdBy, createdVia, createdAt, remind (minutes before, or null), remindAt (ISO), reminded }
// Dates and times are the family's local wall-clock time (FAMILY_TIMEZONE, default US Eastern).
// meta/next-remind: { at } the earliest reminder still to send, so the scheduler can skip listing most minutes.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { sendPush } from './push.mjs';
import { DEFAULT_ROOM, canAccessRoom, isRoomId, roomMembers } from './rooms.mjs';
import { familyTimeZone } from './group-store.mjs';

const store = () => getStore({ name: 'calendar', consistency: 'strong' });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^\d{4}-\d{2}-\d{2}_[a-f0-9]{8}$/;
const REMIND_CHOICES = [0, 15, 30, 60, 120, 1440, 2880];
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export const isEventId = (id) => ID.test(id || '');
const keyOf = (id) => `event/${id.slice(0, 10)}/${id}`;

function validDate(date) {
  if (!DATE.test(date || '')) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

// Offset (ms) of `zone` from UTC at the instant `ms`.
function zoneOffset(ms, zone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(ms / 1000) * 1000;
}

// The UTC instant (ms) for a local date + time in the family's zone.
export function localToUtc(date, time) {
  const zone = familyTimeZone();
  const [y, m, d] = date.split('-').map(Number);
  const [H, M] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, H, M);
  let utc = guess - zoneOffset(guess, zone);
  utc = guess - zoneOffset(utc, zone);
  return utc;
}

// Today's date (and the weekday number, 0 = Sunday) in the family's zone.
export function todayLocal(now = Date.now()) {
  const zone = familyTimeZone();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { date, weekday };
}

export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "Fri, Oct 23 at 6:00 PM" for notifications and chat notes.
export function describeWhen(event) {
  const day = new Date(`${event.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (!event.time) return `${day} (all day)`;
  const [H, M] = event.time.split(':').map(Number);
  const h12 = ((H + 11) % 12) + 1;
  return `${day} at ${h12}:${String(M).padStart(2, '0')} ${H >= 12 ? 'PM' : 'AM'}`;
}

function remindAtFor(event) {
  if (event.remind == null) return null;
  const base = localToUtc(event.date, event.time || '09:00');
  return new Date(base - event.remind * 60 * 1000).toISOString();
}

// Checks and tidies user input for an event; `base` is the existing event when editing.
export function cleanEvent(input, base = {}) {
  const pick = (name, fallback) => (input[name] === undefined ? fallback : input[name]);
  const title = String(pick('title', base.title) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!title) throw bad('Give the event a name.');
  const date = String(pick('date', base.date) || '');
  if (!validDate(date)) throw bad('Pick a date.');
  let time = pick('time', base.time);
  time = time ? String(time) : null;
  if (time && !TIME.test(time)) throw bad('That time isn’t valid.');
  let endTime = time ? pick('endTime', base.endTime) : null;
  endTime = endTime ? String(endTime) : null;
  if (endTime && !TIME.test(endTime)) throw bad('That end time isn’t valid.');
  const room = String(pick('room', base.room || DEFAULT_ROOM));
  if (!isRoomId(room)) throw bad('Pick who the event is for.');
  let remind = pick('remind', base.remind === undefined ? (time ? 60 : 1440) : base.remind);
  remind = remind === null || remind === '' || remind === 'none' ? null : Number(remind);
  if (remind !== null && !REMIND_CHOICES.includes(remind)) throw bad('That reminder isn’t available.');
  return {
    title, date, time, endTime,
    location: String(pick('location', base.location) || '').trim().slice(0, 120),
    notes: String(pick('notes', base.notes) || '').trim().slice(0, 1000),
    room, remind
  };
}

export const canSee = (user, event) => canAccessRoom(user.name, event.room || DEFAULT_ROOM);
export const canChange = (user, event) => canSee(user, event) && (event.createdBy === user.name || user.host);

async function bumpNextRemind(at) {
  const hint = await store().get('meta/next-remind', { type: 'json' });
  if (!hint || at < hint.at) await store().setJSON('meta/next-remind', { at });
}

// Creates an event and tells the people it is for. `via` is 'manual', 'chat' or 'ai'.
export async function createEvent(user, input, { via = 'manual', notify = true } = {}) {
  const fields = cleanEvent(input);
  if (!canAccessRoom(user.name, fields.room)) throw bad('You’re not in that chat.', 403);
  const id = `${fields.date}_${crypto.randomBytes(4).toString('hex')}`;
  const event = { id, ...fields, createdBy: user.name, createdVia: via, createdAt: new Date().toISOString(), reminded: false };
  event.remindAt = remindAtFor(event);
  await store().setJSON(keyOf(id), event, { onlyIfNew: true });
  if (event.remindAt) await bumpNextRemind(Date.parse(event.remindAt));
  if (notify) await announce(user.name, event, 'added');
  return event;
}

async function announce(actor, event, verb) {
  try {
    await sendPush(roomMembers(event.room || DEFAULT_ROOM), {
      title: `${actor} ${verb} an event`,
      body: `${event.title}: ${describeWhen(event)}`,
      url: `/calendar/?event=${event.id}`, tag: `event-${event.id}`
    }, { exclude: actor, kind: 'other' });
  } catch (e) {
    console.error('Calendar notification failed:', e.message);
  }
}

export async function getEvent(id) {
  if (!isEventId(id)) return null;
  return (await store().get(keyOf(id), { type: 'json' })) || null;
}

// Events between two dates (inclusive) the person can see, oldest first.
export async function listEvents(user, from, to) {
  const { blobs } = await store().list({ prefix: 'event/' });
  const keys = blobs.map((b) => b.key).filter((k) => {
    const date = k.split('/')[1];
    return date >= from && date <= to;
  });
  const events = (await Promise.all(keys.map((k) => store().get(k, { type: 'json' })))).filter(Boolean);
  return events.filter((e) => canSee(user, e)).sort((a, b) => `${a.date} ${a.time || ''}` < `${b.date} ${b.time || ''}` ? -1 : 1);
}

export async function updateEvent(user, id, input) {
  const existing = await getEvent(id);
  if (!existing || !canSee(user, existing)) throw bad('Event not found.', 404);
  if (!canChange(user, existing)) throw bad('Only the person who added this event or a host can change it.', 403);
  const fields = cleanEvent(input, existing);
  if (!canAccessRoom(user.name, fields.room)) throw bad('You’re not in that chat.', 403);
  const moved = fields.date !== existing.date;
  const newId = moved ? `${fields.date}_${crypto.randomBytes(4).toString('hex')}` : id;
  const next = { ...existing, ...fields, id: newId };
  next.remindAt = remindAtFor(next);
  const timeChanged = moved || fields.time !== existing.time || fields.remind !== existing.remind;
  if (timeChanged) next.reminded = false;
  await store().setJSON(keyOf(newId), next);
  if (moved) await store().delete(keyOf(id));
  if (next.remindAt && !next.reminded) await bumpNextRemind(Date.parse(next.remindAt));
  if (timeChanged) await announce(user.name, next, 'changed');
  return next;
}

export async function deleteEvent(user, id) {
  const existing = await getEvent(id);
  if (!existing || !canSee(user, existing)) throw bad('Event not found.', 404);
  if (!canChange(user, existing)) throw bad('Only the person who added this event or a host can delete it.', 403);
  await store().delete(keyOf(id));
  return existing;
}

// Sends reminders that are due (called every minute by the scheduler). Returns how many were sent.
export async function sendDueReminders() {
  const hint = await store().get('meta/next-remind', { type: 'json' });
  const now = Date.now();
  if (!hint || hint.at > now) return 0;
  const { blobs } = await store().list({ prefix: 'event/' });
  const today = todayLocal(now).date;
  let sent = 0;
  let next = null;
  for (const b of blobs) {
    if (b.key.split('/')[1] < addDays(today, -2)) continue;   // long past
    const entry = await store().getWithMetadata(b.key, { type: 'json' });
    const event = entry && entry.data;
    if (!event || event.reminded || !event.remindAt) continue;
    const at = Date.parse(event.remindAt);
    if (at > now) { next = next == null ? at : Math.min(next, at); continue; }
    const claim = await store().setJSON(b.key, { ...event, reminded: true }, { onlyIfMatch: entry.etag });
    if (!claim.modified) continue;
    try {
      await sendPush(roomMembers(event.room || DEFAULT_ROOM), {
        title: `Coming up: ${event.title}`, body: describeWhen(event) + (event.location ? ` · ${event.location}` : ''),
        url: `/calendar/?event=${event.id}`, tag: `event-${event.id}`
      }, { kind: 'other' });
      sent++;
    } catch (e) {
      console.error('Reminder failed:', e.message);
    }
  }
  if (next == null) await store().delete('meta/next-remind');
  else await store().setJSON('meta/next-remind', { at: next });
  return sent;
}
