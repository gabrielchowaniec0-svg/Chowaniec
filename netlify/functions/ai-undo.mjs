// Undo for things the AI just did for someone (the "Undo" button on the AI page, available for a short while).
//   POST { kind: 'message'|'sheet'|'event'|'note'|'list', id, room?, message?, items?, created? } -> { ok: true }
// Only works on things that really came from the AI for this person (or that they made), and only recent ones.
import { getUser, json } from '../lib/auth.mjs';
import { deleteMessage, getMessage, AI_NAME } from '../lib/group-store.mjs';
import { resolveRoom } from '../lib/rooms.mjs';
import { deleteEvent, getEvent } from '../lib/calendar-store.mjs';
import { ID_PATTERN, readNote, canDelete, store as notesStore } from '../lib/notes-store.mjs';
import { deleteSheet } from '../lib/signup-store.mjs';
import { getList, removeItems, deleteList } from '../lib/lists-store.mjs';
import { logAction } from '../lib/ai-policy.mjs';

const WINDOW_MS = 10 * 60 * 1000;      // the button only lasts seconds; the server allows a little longer
const fresh = (iso) => !iso || Date.now() - Date.parse(iso) < WINDOW_MS;
const fail = (status, error) => Object.assign(new Error(error), { status });

async function undoMessage(user, id, roomRaw) {
  const room = resolveRoom(roomRaw, user);
  const found = await getMessage(String(id || ''), room);
  if (!found) return;                                                  // already gone
  const m = found.message;
  if (m.user !== AI_NAME || m.onBehalfOf !== user.name) throw fail(403, 'That message wasn’t sent by the AI for you.');
  if (!fresh(m.createdAt)) throw fail(409, 'It’s too late to undo that one.');
  await deleteMessage(m.id, room);
}

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  let b;
  try { b = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  try {
    if (b.kind === 'message') await undoMessage(user, b.id, b.room);
    else if (b.kind === 'sheet') {
      await undoMessage(user, b.message, b.room);
      await deleteSheet(user, String(b.id || '')).catch((e) => { if (e.status !== 404) throw e; });
    } else if (b.kind === 'event') {
      const ev = await getEvent(String(b.id || ''));
      if (ev && (ev.createdBy !== user.name || ev.createdVia !== 'ai' || !fresh(ev.createdAt))) throw fail(403, 'That event wasn’t added by the AI for you just now.');
      if (ev) await deleteEvent(user, ev.id);
    } else if (b.kind === 'note') {
      const id = String(b.id || '');
      if (!ID_PATTERN.test(id)) throw fail(400, 'Invalid note.');
      const found = await readNote(id);
      if (found) {
        if (found.note.owner !== user.name || found.note.source !== 'ai' || !fresh(found.note.createdAt) || !canDelete(user, found.note)) throw fail(403, 'That note wasn’t created by the AI for you just now.');
        await notesStore().delete(`note/${id}`);
      }
    } else if (b.kind === 'list') {
      const list = await getList(String(b.id || ''));
      if (list) {
        if (b.created && list.createdBy === user.name && fresh(list.createdAt)) await deleteList(user, list.id);
        else await removeItems(user, list.id, Array.isArray(b.items) ? b.items.map(String).slice(0, 30) : []);
      }
    } else throw fail(400, 'Unknown request.');
    await logAction({ user: user.name, action: 'undo', summary: `Undid an AI ${b.kind}`, room: '' });
    return json(200, { ok: true });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Undo error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
