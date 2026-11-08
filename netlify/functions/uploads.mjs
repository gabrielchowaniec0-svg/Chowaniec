// Note Uploader API: Liliana, Amelia and Emilia send meeting notes to Gabriel, Vicky and Nicole.
//   GET  ?list=1        -> { role, items: [summary…], unread }   heads: everything; uploaders: what they sent
//   GET  ?id=<id>       -> { submission }
//   GET  ?unread=1      -> { unread }
//   GET  ?photo=<pid>   -> the picture (only for people who may see its notes; the cookie works for <img>)
//   GET  ?meetings=1    -> { events: [...], meets: [...] }  today's and recent calendar events and Meet meetings, for the picker
//   POST { action: 'photo', data: dataURL }                     -> { photo: { id, size } }   (upload ahead of sending)
//   POST { action: 'send', meeting: { title, eventId?, meetingCode? }, markdown, todos: [{ who, what }], photos: [dataURL | id] }
//   POST { action: 'seen' | 'review' | 'unreview' | 'reply' | 'delete' | 'save-to-notes', id, text? }
// Roles and storage: ../lib/uploads-store.mjs.
import { getUser, json } from '../lib/auth.mjs';
import { sendPush } from '../lib/push.mjs';
import { createNote, readNote } from '../lib/notes-store.mjs';
import { getEvent, canSee as canSeeEvent, listEvents, todayLocal, addDays } from '../lib/calendar-store.mjs';
import { isMeetingCode } from '../lib/meeting-recap.mjs';
import {
  roleOf, canPost, canSee, isRecipient, recipients, listFor, isUnread, unreadCount, readSub, readPhoto, uploadPhoto,
  createSubmission, markSeen, review, reply, linkNote, deleteSubmission, noteMarkdown, recentMeets, ID, PHOTO_ID
} from '../lib/uploads-store.mjs';

const fail = (e) => {
  if (!e.status) console.error('Uploads error:', e);
  return json(e.status || 500, { error: e.status ? e.message : 'Something went wrong. Please try again.' });
};
const nice = (name) => (name === 'Victoria' ? 'Vicky' : name);
const urlFor = (id) => `/uploader/?id=${id}`;

async function notify(names, payload, exclude) {
  const to = names.filter((n) => n && n !== exclude);
  if (!to.length) return 0;
  try { return await sendPush(to, payload, { exclude, kind: 'other' }); } catch (e) { console.error('Uploader notification failed:', e.message); return 0; }
}

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);
  const q = (k) => url.searchParams.get(k);

  try {
    if (req.method === 'GET') {
      if (q('photo') !== null) {
        if (!PHOTO_ID.test(q('photo'))) return json(400, { error: 'Invalid photo.' });
        const photo = await readPhoto(user, q('photo'));
        if (!photo) return json(404, { error: 'Photo not found.' });
        return new Response(photo.bytes, { status: 200, headers: { 'content-type': photo.type, 'cache-control': 'private, max-age=604800, immutable', 'x-content-type-options': 'nosniff' } });
      }
      if (q('unread') !== null) return json(200, { unread: await unreadCount(user) });
      if (q('meetings') !== null) {
        if (!canPost(user)) return json(403, { error: 'Only Liliana, Amelia and Emilia can send meeting notes.' });
        const today = todayLocal().date;
        const [events, meets] = await Promise.all([
          listEvents(user, addDays(today, -3), today).catch(() => []),
          recentMeets(user).catch(() => [])
        ]);
        return json(200, {
          today,
          events: events.reverse().slice(0, 8).map((e) => ({ id: e.id, title: e.title, date: e.date, time: e.time })),
          meets
        });
      }
      if (q('id') !== null) {
        if (!ID.test(q('id'))) return json(400, { error: 'Invalid notes.' });
        const found = await readSub(q('id'));
        if (!found || !canSee(user, found.sub)) return json(404, { error: 'Those notes were not found. They may have been deleted.' });
        return json(200, { submission: found.sub });
      }
      const role = roleOf(user);
      if (role === 'none') return json(200, { role, items: [], unread: 0 });
      const items = await listFor(user);
      return json(200, {
        role, me: user.name, recipients: recipients(),
        items: items.map((i) => ({ ...i, unread: isUnread(user, i) })),
        unread: items.filter((i) => isUnread(user, i)).length
      });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    if (!body || typeof body !== 'object') return json(400, { error: 'Invalid request.' });
    if (!canPost(user)) return json(403, { error: 'This is for Liliana, Amelia and Emilia to send meeting notes to Gabriel, Vicky and Nicole.' });

    switch (body.action) {
      case 'photo': {
        return json(200, { photo: await uploadPhoto(user, body.data) });
      }
      case 'send': {
        const sub = await createSubmission(user, body, {
          checkEvent: async (id) => { const ev = await getEvent(id); return ev && canSeeEvent(user, ev) ? ev : null; },
          isMeetingCode
        });
        const first = sub.markdown.replace(/[#>*_`|[\]]/g, ' ').replace(/\s+/g, ' ').trim();
        const extras = [sub.photos.length ? `${sub.photos.length} photo${sub.photos.length === 1 ? '' : 's'}` : '', sub.todos.length ? `${sub.todos.length} thing${sub.todos.length === 1 ? '' : 's'} to do` : ''].filter(Boolean).join(', ');
        const delivered = await notify(recipients(), {
          title: `${nice(user.name)} sent meeting notes: ${sub.meeting.title}`.slice(0, 120),
          body: (first.slice(0, 140) || extras || 'Tap to read them.') + (first && extras ? ` (${extras})` : ''),
          url: urlFor(sub.id), tag: `upload-${sub.id}`, from: user.name
        }, user.name);
        return json(200, { submission: sub, delivered });
      }
      case 'seen': return json(200, { submission: await markSeen(user, String(body.id || '')) });
      case 'review':
      case 'unreview': {
        const before = await readSub(String(body.id || ''));
        const sub = await review(user, String(body.id || ''), body.action === 'review');
        if (body.action === 'review' && before && !before.sub.reviewedBy[user.name]) {
          await notify([sub.author], { title: `${nice(user.name)} reviewed your notes`, body: sub.meeting.title, url: urlFor(sub.id), tag: `upload-${sub.id}-review`, from: user.name }, user.name);
        }
        return json(200, { submission: sub });
      }
      case 'reply': {
        const sub = await reply(user, String(body.id || ''), body.text);
        const last = sub.replies[sub.replies.length - 1];
        // A head's reply goes to the author; the author's answer goes to the heads who replied.
        const to = sub.author === user.name ? [...new Set(sub.replies.map((r) => r.by))] : [sub.author];
        await notify(to, { title: `${nice(user.name)} replied about ${sub.meeting.title}`.slice(0, 120), body: last.text.slice(0, 200), url: urlFor(sub.id), tag: `upload-${sub.id}-reply`, from: user.name }, user.name);
        return json(200, { submission: sub });
      }
      case 'delete': {
        await deleteSubmission(user, String(body.id || ''));
        return json(200, { ok: true });
      }
      case 'save-to-notes': {
        if (!isRecipient(user)) return json(403, { error: 'Only Gabriel, Vicky and Nicole can save notes to Notes.' });
        const found = await readSub(String(body.id || ''));
        if (!found || !canSee(user, found.sub)) return json(404, { error: 'Those notes were not found.' });
        const sub = found.sub;
        if (sub.noteId && (await readNote(sub.noteId))) return json(200, { noteId: sub.noteId, existing: true, submission: sub });
        const { note } = await createNote(user, {
          title: `Meeting notes: ${sub.meeting.title}`,
          markdown: noteMarkdown(sub),
          sharedWith: [...recipients(), sub.author],
          meetingCode: sub.meeting.meetingCode || ''
        });
        const linked = await linkNote(user, sub.id, note.id);
        return json(200, { noteId: note.id, submission: linked });
      }
      default: return json(400, { error: 'Unknown action.' });
    }
  } catch (e) {
    return fail(e);
  }
};

export const config = {
  rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
