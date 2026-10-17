// Push notification subscriptions for this device.
//   GET                          -> { enabled, publicKey }
//   POST { subscription }        -> { ok }   save this device
//   DELETE { endpoint }          -> { ok }   forget this device
//   GET ?devices=1               -> { devices }  this person's saved devices
//   DELETE { id }                -> { ok }   forget one of this person's devices by id
//   POST { action: 'test' }      -> { sent } send a test notification to the caller's devices
import { getUser, json } from '../lib/auth.mjs';
import { pushConfig, missingPushSettings, saveSubscription, removeSubscription, removeDeviceById, listDevices, sendPush } from '../lib/push.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const config = pushConfig();

  if (req.method === 'GET' && new URL(req.url).searchParams.get('devices')) {
    return json(200, { devices: config ? await listDevices(user.name) : [] });
  }
  if (req.method === 'GET') return json(200, { enabled: !!config, publicKey: config ? config.publicKey : null, missing: config ? [] : missingPushSettings() });
  if (!config) return json(503, { error: 'Notifications are not set up on the server yet.' });

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { error: 'Invalid request.' });
  }

  if (req.method === 'DELETE') {
    if (typeof body.id === 'string') {
      await removeDeviceById(user.name, body.id);
      return json(200, { ok: true });
    }
    if (typeof body.endpoint !== 'string') return json(400, { error: 'Invalid request.' });
    await removeSubscription(user.name, body.endpoint);
    return json(200, { ok: true });
  }

  if (req.method === 'POST' && body.action === 'test') {
    const sent = await sendPush([user.name], {
      title: 'Chowaniec',
      body: `Notifications are working, ${user.name}!`,
      url: '/settings/notifications/',
      tag: 'test'
    }, { kind: 'test' });
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
