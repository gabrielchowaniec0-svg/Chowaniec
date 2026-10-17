// One search box for the whole portal.
//   GET ?q=<words> -> { query, notes, chats, meetings, events, total }
// Only things the caller can see: their notes and shared notes, the group chats they are in, meetings, and
// calendar events for their audiences.
import { getUser, json } from '../lib/auth.mjs';
import { searchEverything } from '../lib/search.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
  const q = (new URL(req.url).searchParams.get('q') || '').slice(0, 100);
  try {
    return json(200, await searchEverything(user, q));
  } catch (err) {
    console.error('Search error:', err);
    return json(500, { error: 'Search failed. Please try again.' });
  }
};
