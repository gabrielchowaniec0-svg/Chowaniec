// Family birthdays. GET -> { birthdays }. POST { birthdays: [{ name, month, day, year? }] } (heads only).
import { getUser, json } from '../lib/auth.mjs';
import { getBirthdays, setBirthdays } from '../lib/birthdays-store.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  if (req.method === 'GET') return json(200, { birthdays: await getBirthdays() });
  if (req.method === 'POST') {
    if (!user.host) return json(403, { error: 'Only a head of the family can change birthdays.' });
    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    return json(200, { birthdays: await setBirthdays(body.birthdays) });
  }
  return json(405, { error: 'Method not allowed' });
};
