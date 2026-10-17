// Chowaniec shared calendar API. Events are for one of the group chats' audiences (see ../lib/rooms.mjs).
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD -> { events, today }   events the caller can see (default: next 90 days)
//   GET ?id=<id>                        -> { event }
//   POST { title, date, time?, endTime?, location?, notes?, room?, remind? } -> { event }   (notifies the audience)
//   PUT { id, ...changed fields }       -> { event }   (the person who added it, or a host)
//   POST { action: 'rsvp', id, response: 'going'|'maybe'|'no'|'' } -> { event, clashes }
//   (create and change also return { clashes }: events at the same time the person is going to)
//   DELETE ?id=<id>                     -> { ok }
import { getUser, json } from '../lib/auth.mjs';
import { createEvent, updateEvent, rsvpEvent, clashesFor, deleteEvent, getEvent, listEvents, canSee, todayLocal, addDays, isEventId } from '../lib/calendar-store.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        const event = isEventId(id) ? await getEvent(id) : null;
        return event && canSee(user, event) ? json(200, { event }) : json(404, { error: 'Event not found.' });
      }
      const today = todayLocal().date;
      const date = /^\d{4}-\d{2}-\d{2}$/;
      const from = date.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : today;
      const to = date.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : addDays(from, 90);
      return json(200, { events: await listEvents(user, from, to), today });
    }
    if (req.method === 'DELETE') {
      await deleteEvent(user, url.searchParams.get('id') || '');
      return json(200, { ok: true });
    }
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json(400, { error: 'Invalid request.' });
    }
    if (req.method === 'POST' && body.action === 'rsvp') {
      const event = await rsvpEvent(user, String(body.id || ''), String(body.response || ''));
      return json(200, { event, clashes: body.response === 'going' ? await clashesFor(user, event) : [] });
    }
    if (req.method === 'POST') {
      const event = await createEvent(user, body);
      return json(200, { event, clashes: await clashesFor(user, event) });
    }
    if (req.method === 'PUT') {
      const event = await updateEvent(user, String(body.id || ''), body);
      return json(200, { event, clashes: await clashesFor(user, event) });
    }
    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Calendar error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
