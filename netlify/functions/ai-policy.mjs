// Family heads' AI controls.
//   GET           -> { policy, capabilities, people, mine }   (everyone: `mine` = what the AI won't do for them)
//   GET ?log=1    -> { log }                                   (heads only)
//   PUT { policy: { restricted, quiet, features } } -> { policy }   (heads only)
import { getUser, json, familyNames } from '../lib/auth.mjs';
import { getPolicy, setPolicy, listLog, CAPABILITIES } from '../lib/ai-policy.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (url.searchParams.get('log')) {
      if (!user.host) return json(403, { error: 'Only the family heads can see the AI log.' });
      return json(200, { log: await listLog(100) });
    }
    const policy = await getPolicy();
    const mine = policy.restricted[user.name] || [];
    if (!user.host) return json(200, { mine, capabilities: CAPABILITIES, quiet: policy.quiet });
    return json(200, { policy, capabilities: CAPABILITIES, people: familyNames(), mine });
  }
  if (req.method === 'PUT') {
    if (!user.host) return json(403, { error: 'Only the family heads can change this.' });
    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    if (!body || typeof body.policy !== 'object' || body.policy === null) return json(400, { error: 'Invalid request.' });
    return json(200, { policy: await setPolicy(body.policy) });
  }
  return json(405, { error: 'Method not allowed' });
};
