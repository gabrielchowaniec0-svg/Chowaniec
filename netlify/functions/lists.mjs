// Shared lists (see ../lib/lists-store.mjs).
//   GET                                          -> { lists }
//   POST { action:'create', title, room, items } -> { list }
//   POST { action:'add', id, items:[..] }        -> { list }
//   POST { action:'toggle', id, item, done? }    -> { list }
//   POST { action:'remove', id, items:[ids] }    -> { list }
//   POST { action:'clear', id }                  -> { list }   (removes ticked items)
//   DELETE ?id=<id>                              -> { ok }
import { getUser, json } from '../lib/auth.mjs';
import { resolveRoom } from '../lib/rooms.mjs';
import { listLists, createList, addItems, toggleItem, removeItems, clearDone, deleteList } from '../lib/lists-store.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') return json(200, { lists: await listLists(user) });
    if (req.method === 'DELETE') {
      await deleteList(user, url.searchParams.get('id') || '');
      return json(200, { ok: true });
    }
    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    const id = String(body.id || '');
    if (body.action === 'create') return json(200, { list: await createList(user, { title: body.title, room: resolveRoom(body.room, user), items: body.items }) });
    if (body.action === 'add') return json(200, { list: (await addItems(user, id, body.items)).list });
    if (body.action === 'toggle') return json(200, { list: (await toggleItem(user, id, String(body.item || ''), body.done)).list });
    if (body.action === 'remove') return json(200, { list: (await removeItems(user, id, Array.isArray(body.items) ? body.items.map(String) : [])).list });
    if (body.action === 'clear') return json(200, { list: (await clearDone(user, id)).list });
    return json(400, { error: 'Unknown request.' });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Lists error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
