// Family Restaurant API (see netlify/lib/restaurant-store.mjs).
//   GET            -> { ...view }        catches the restaurant up to now and returns it
//   POST { action: 'hello'|'seat'|'cook'|'serve'|'clean'|'open'|'buy'|'menu'|'rename', ... } -> { ...view }
import { getUser, json } from '../lib/auth.mjs';
import { peek, mutate, view } from '../lib/restaurant-store.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  try {
    const now = Date.now();
    if (req.method === 'GET') return json(200, view(await peek(now), user.name, now));
    if (req.method !== 'POST') return json(405, { error: 'Not allowed.' });
    let body = {};
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Bad request.' }); }
    return json(200, view(await mutate(user.name, body, now), user.name, now));
  } catch (e) {
    if (e && e.status) return json(e.status, { error: e.message });
    console.error('restaurant failed:', e && e.message);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};

export const config = { rateLimit: { windowLimit: 1200, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
