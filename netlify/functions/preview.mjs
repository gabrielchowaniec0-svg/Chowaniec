// Link previews and the "share" picker for the chat.
//   GET ?url=<link to a note, calendar event, meeting or chat on this site> -> { preview }   (decided per viewer)
//   GET ?share=1 -> { notes, events, meeting }   things this person can share into a chat
// A preview only shows what the person looking at it is allowed to see.
import { getStore } from '@netlify/blobs';
import { getUser, json } from '../lib/auth.mjs';
import { readNote, canView, listVisible, summary } from '../lib/notes-store.mjs';
import { getEvent, canSee, describeWhen, listEvents, todayLocal, addDays, isEventId } from '../lib/calendar-store.mjs';
import { latestMeetingFor, isMeetingCode } from '../lib/meeting-recap.mjs';
import { roomsFor, canAccessRoom, isAnyRoomId, dmParts } from '../lib/rooms.mjs';

const briefs = () => getStore({ name: 'meeting-briefs', consistency: 'strong' });

// "https://chowaniec.net/notes/?id=abc" or "/notes/?id=abc" -> a URL object on a dummy origin, or null
function parse(raw, origin) {
  try {
    const u = new URL(String(raw || ''), 'https://chowaniec.invalid');
    if (u.origin !== 'https://chowaniec.invalid' && !(origin && u.origin === origin) && !/(^|\.)chowaniec\.net$/.test(u.hostname)) return null;
    return u;
  } catch (e) {
    return null;
  }
}

async function previewFor(user, u) {
  const path = u.pathname.replace(/\/+$/, '');
  const href = `${u.pathname}${u.search}`;
  if (path === '/notes') {
    const id = u.searchParams.get('id') || '';
    const found = id ? await readNote(id).catch(() => null) : null;
    if (!found || !canView(user, found.note)) return found ? { kind: 'note', locked: true, title: 'A note', subtitle: 'It isn’t shared with you. Ask its owner.', href } : null;
    const s = summary(found.note);
    return {
      kind: 'note', icon: '📝', title: found.note.title, href,
      subtitle: `Note by ${found.note.owner}${s.tasks.total ? ` · ${s.tasks.done}/${s.tasks.total} to-dos done` : ''}`,
      snippet: s.preview.slice(0, 130),
      buttons: [{ label: 'Open note', href, primary: true }]
    };
  }
  if (path === '/calendar') {
    const id = u.searchParams.get('event') || '';
    const event = isEventId(id) ? await getEvent(id) : null;
    if (!event || !canSee(user, event)) return event ? { kind: 'event', locked: true, title: 'An event', subtitle: 'It isn’t for you.', href } : null;
    const r = event.rsvp || {};
    const names = (k) => Object.keys(r).filter((n) => r[n] === k);
    return {
      kind: 'event', icon: '📅', title: event.title, href,
      subtitle: `${describeWhen(event)}${event.location ? ` · ${event.location}` : ''}`,
      snippet: [names('going').length ? `Going: ${names('going').join(', ')}` : '', names('maybe').length ? `Maybe: ${names('maybe').join(', ')}` : ''].filter(Boolean).join(' · '),
      eventId: event.id, mine: r[user.name] || '',
      buttons: [{ label: 'Open calendar', href }],
      rsvp: true
    };
  }
  if (path === '/meet') {
    const code = u.searchParams.get('room') || '';
    if (!isMeetingCode(code) && !/^[A-Za-z0-9_-]{1,128}$/.test(code)) return null;
    const brief = await briefs().get(code, { type: 'json' }).catch(() => null);
    const joinHref = `/meet/?room=${encodeURIComponent(code)}&join=1`;
    return {
      kind: 'meet', icon: '🎥', title: 'Video meeting', href: joinHref,
      subtitle: brief && brief.startsAt ? `Starts ${new Date(brief.startsAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: Netlify.env.get('FAMILY_TIMEZONE') || 'America/New_York' })}` : 'Tap to join',
      snippet: brief && brief.topics ? String(brief.topics).replace(/\s+/g, ' ').slice(0, 130) : '',
      buttons: [{ label: 'Join meeting', href: joinHref, primary: true }]
    };
  }
  if (path === '/group') {
    const room = u.searchParams.get('room') || 'everyone';
    if (!isAnyRoomId(room) || !canAccessRoom(user.name, room)) return { kind: 'chat', locked: true, title: 'A chat', subtitle: 'You’re not in that chat.', href };
    const dm = dmParts(room);
    const name = dm ? (dm.ai ? 'Chowaniec AI' : dm.people.find((n) => n !== user.name)) : (roomsFor(user.name).find((r) => r.id === room) || {}).name;
    return { kind: 'chat', icon: '💬', title: dm ? `Messages with ${name}` : name || 'Group chat', subtitle: 'Open chat', href, buttons: [{ label: 'Open chat', href, primary: true }] };
  }
  return null;
}

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('share')) {
      const today = todayLocal().date;
      const [notes, events, meeting] = await Promise.all([
        listVisible(user).then((l) => l.slice(0, 15).map((n) => ({ id: n.id, title: n.title, owner: n.owner, path: `/notes/?id=${n.id}` }))),
        listEvents(user, today, addDays(today, 60)).then((l) => l.slice(0, 15).map((e) => ({ id: e.id, title: e.title, when: describeWhen(e), path: `/calendar/?event=${e.id}` }))),
        latestMeetingFor(user.name).catch(() => null)
      ]);
      return json(200, { notes, events, meeting: meeting ? { code: meeting.code || meeting.id || null, path: meeting.code ? `/meet/?room=${meeting.code}&join=1` : null } : null });
    }
    const u = parse(url.searchParams.get('url'), url.origin);
    if (!u) return json(200, { preview: null });
    return json(200, { preview: await previewFor(user, u) });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Preview error:', err);
    return json(200, { preview: null });
  }
};
