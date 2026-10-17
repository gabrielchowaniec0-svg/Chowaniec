// Chowaniec shared calendar API. Events are for one of the group chats' audiences (see ../lib/rooms.mjs).
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD -> { events, today }   events the caller can see (default: next 90 days)
//   GET ?id=<id>                        -> { event }
//   POST { title, date, time?, endTime?, location?, notes?, room?, remind? } -> { event }   (notifies the audience)
//   PUT { id, ...changed fields }       -> { event }   (the person who added it, or a host)
//   DELETE ?id=<id>                     -> { ok }
import { getUser, json } from '../lib/auth.mjs';
import { createEvent, updateEvent, deleteEvent, getEvent, listEvents, canSee, todayLocal, addDays, isEventId } from '../lib/calendar-store.mjs';

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
    if (req.method === 'POST') return json(200, { event: await createEvent(user, body) });
    if (req.method === 'PUT') return json(200, { event: await updateEvent(user, String(body.id || ''), body) });
    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Calendar error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
