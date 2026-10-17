// Push notification subscriptions for this device.
//   GET                          -> { enabled, publicKey }
//   POST { subscription }        -> { ok }   save this device
//   DELETE { endpoint }          -> { ok }   forget this device
//   POST { action: 'test' }      -> { sent } send a test notification to the caller's devices
import { getUser, json } from '../lib/auth.mjs';
import { pushConfig, saveSubscription, removeSubscription, sendPush } from '../lib/push.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const config = pushConfig();

  if (req.method === 'GET') return json(200, { enabled: !!config, publicKey: config ? config.publicKey : null });
  if (!config) return json(503, { error: 'Notifications are not set up on the server yet.' });

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { error: 'Invalid request.' });
  }

  if (req.method === 'DELETE') {
    if (typeof body.endpoint !== 'string') return json(400, { error: 'Invalid request.' });
    await removeSubscription(user.name, body.endpoint);
    return json(200, { ok: true });
  }

  if (req.method === 'POST' && body.action === 'test') {
    const sent = await sendPush([user.name], {
      title: 'Chowaniec',
      body: `Notifications are working, ${user.name}!`,
      url: '/get-the-app/',
      tag: 'test'
    });
    return json(200, { sent });
  }

  if (req.method === 'POST') {
    const sub = body.subscription;
    const valid = sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) &&
      sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
    if (!valid) return json(400, { error: 'Invalid subscription.' });
    await saveSubscription(user.name, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, req.headers.get('user-agent'));
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
};
