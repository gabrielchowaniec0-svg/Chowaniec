// Unread counts for the app icon badge and the Chats tab.
//   GET            -> { total, chats: { <room>: n }, dms: n, dmRooms: { <dm id>: n }, muted: [ids], at }
//   GET ?fresh=1   -> the same, skipping the ~10 s cache (after reading a chat)
// `total` leaves out muted chats; each chat counts at most 50.
import { getUser, json } from '../lib/auth.mjs';
import { unreadFor } from '../lib/unread.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
  if (user.name === 'Guest') return json(200, { total: 0, chats: {}, dms: 0, dmRooms: {}, muted: [], at: new Date().toISOString() });
  try {
    const fresh = !!new URL(req.url).searchParams.get('fresh');
    const value = await unreadFor(user.name, { fresh });
    return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('Unread count failed:', err);
    return json(500, { error: 'Could not count unread messages.' });
  }
};

export const config = {
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
