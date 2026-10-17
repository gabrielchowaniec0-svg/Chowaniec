// Chowaniec Notes API (Markdown notes saved with Netlify Blobs).
//   GET    /.netlify/functions/notes             -> { notes: [summary...] } visible to the caller
//   GET    /.netlify/functions/notes?id=<id>     -> { note, etag }
//   POST   { title, markdown, shared, source?, meetingCode? }  -> { note, etag }
//   PUT    { id, title?, markdown?, shared?, sharedWith?, lockEdit?, lockCheck?, etag? } -> { note, etag }  (409 if etag is stale)
//   PUT    { id, action: 'toggle', index, checked, text? }     -> { note, etag }  tick/untick one checklist item
//   DELETE /.netlify/functions/notes?id=<id>     -> { ok: true }
// Permission rules live in ../lib/notes-store.mjs.
import { getUser, json } from '../lib/auth.mjs';
import {
  ID_PATTERN, MAX_MARKDOWN, store, canView, canEdit, canDelete, summary, readNote, listVisible, createNote, writeNote, toggleTask
} from '../lib/notes-store.mjs';
import { sendPush } from '../lib/push.mjs';

// Tells people who were just added to a note's "shared with" list.
async function announceShare(user, before, note) {
  const added = (note.sharedWith || []).filter((n) => !(before || []).includes(n));
  if (!added.length) return;
  try {
    await sendPush(added, { title: `${user.name} shared a note with you`, body: note.title, url: `/notes/?id=${note.id}` }, { exclude: user.name, kind: 'other' });
  } catch (e) {
    console.error('Share notification failed:', e.message);
  }
}

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (id) {
      if (!ID_PATTERN.test(id)) return json(400, { error: 'Invalid note.' });
      const found = await readNote(id);
      if (!found || !canView(user, found.note)) return json(404, { error: 'Note not found.' });
      return json(200, found);
    }
    return json(200, { notes: (await listVisible(user)).map(summary) });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!ID_PATTERN.test(id)) return json(400, { error: 'Invalid note.' });
    const found = await readNote(id);
    if (!found || !canView(user, found.note)) return json(404, { error: 'Note not found.' });
    if (!canDelete(user, found.note)) return json(403, { error: 'Only the owner or a host can delete this note.' });
    await store().delete(`note/${id}`);
    return json(200, { ok: true });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { error: 'Invalid request.' });
  }
  if (typeof body.markdown === 'string' && body.markdown.length > MAX_MARKDOWN) {
    return json(413, { error: 'This note is too long to save.' });
  }

  if (req.method === 'POST') {
    const created = await createNote(user, body);
    await announceShare(user, [], created.note);
    return json(200, created);
  }

  if (req.method === 'PUT') {
    const id = String(body.id || '');
    if (!ID_PATTERN.test(id)) return json(400, { error: 'Invalid note.' });
    const found = await readNote(id);
    if (!found || !canView(user, found.note)) return json(404, { error: 'Note not found.' });
    if (body.action === 'toggle') {
      const result = await toggleTask(user, id, { index: Number(body.index), checked: !!body.checked, text: body.text });
      if (result.error) return json(result.status, result);
      return json(200, result);
    }
    if (!canEdit(user, found.note)) return json(403, { error: found.note.lockEdit ? 'Editing is locked on this note.' : 'You can\'t edit this note.' });
    if (body.etag && body.etag !== found.etag) {
      return json(409, { error: 'Someone else changed this note. Reload to see their changes.', note: found.note, etag: found.etag });
    }
    const result = await writeNote(user, found, body);
    if (result.error) return json(result.status || 403, { error: result.error });
    if (!result.conflict) await announceShare(user, found.note.sharedWith, result.note);
    if (result.conflict) return json(409, { error: 'Someone else changed this note. Reload to see their changes.' });
    return json(200, result);
  }

  return json(405, { error: 'Method not allowed' });
};
