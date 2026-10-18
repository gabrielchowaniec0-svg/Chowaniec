// Sign-up sheets (see ../lib/signup-store.mjs).
//   GET  ?room=<id>                                 -> { sheets }
//   POST { action:'create', title, slots:[..], room, eventId? } -> { sheet, message }  (posts it in the chat)
//   POST { action:'claim', id, slot }               -> { sheet }
//   POST { action:'release', id, slot }             -> { sheet }
//   DELETE ?id=<id>                                 -> { ok }
import { getUser, json } from '../lib/auth.mjs';
import { resolveRoom } from '../lib/rooms.mjs';
import { createSheet, listSheets, claimSlot, deleteSheet } from '../lib/signup-store.mjs';
import { publishMessage } from '../lib/group-post.mjs';

export default async (req, context) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const room = resolveRoom(url.searchParams.get('room'), user);
      return json(200, { sheets: await listSheets(user, room) });
    }
    if (req.method === 'DELETE') {
      await deleteSheet(user, url.searchParams.get('id') || '');
      return json(200, { ok: true });
    }
    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    if (req.method === 'POST' && body.action === 'create') {
      const room = resolveRoom(body.room, user);
      const { sheet, message } = await createSheet(user, { title: body.title, slots: body.slots, room, eventId: body.eventId });
      context.waitUntil(publishMessage(message));
      return json(200, { sheet, message });
    }
    if (req.method === 'POST' && (body.action === 'claim' || body.action === 'release')) {
      return json(200, { sheet: await claimSlot(user, String(body.id || ''), String(body.slot || ''), body.action === 'release') });
    }
    return json(400, { error: 'Unknown request.' });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Sign-up error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
