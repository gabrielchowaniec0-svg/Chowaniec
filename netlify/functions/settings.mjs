// Per-person settings.
//   GET           -> { name, host, settings }
//   POST { settings: { notifications: {...} } } -> { settings }
import { getUser, json } from '../lib/auth.mjs';
import { getSettings, saveSettings } from '../lib/user-settings.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });

  if (req.method === 'GET') {
    return json(200, { name: user.name, host: !!user.host, settings: await getSettings(user.name) });
  }
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    if (!body || typeof body.settings !== 'object' || body.settings === null) return json(400, { error: 'Invalid request.' });
    return json(200, { settings: await saveSettings(user.name, body.settings) });
  }
  return json(405, { error: 'Method not allowed' });
};
