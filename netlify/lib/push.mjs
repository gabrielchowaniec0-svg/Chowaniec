// Web Push for Chowaniec (VAPID keys in VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
// Subscriptions live in Netlify Blobs under sub/<user>/<hash of endpoint>.
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';
import crypto from 'node:crypto';
import { whoWantsPush } from './user-settings.mjs';

const store = () => getStore({ name: 'push-subscriptions', consistency: 'strong' });

// Values are trimmed: a stray space or line break pasted into Netlify would otherwise break the keys.
const envValue = (name) => (Netlify.env.get(name) || '').trim();

export function pushConfig() {
  const publicKey = envValue('VAPID_PUBLIC_KEY');
  const privateKey = envValue('VAPID_PRIVATE_KEY');
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

// Names (never values) of the settings the server can't see, to help fix a setup problem.
export function missingPushSettings() {
  return ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter((n) => !envValue(n));
}

const keyFor = (user, endpoint) => `sub/${encodeURIComponent(user)}/${crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32)}`;

export async function saveSubscription(user, subscription, userAgent) {
  await store().setJSON(keyFor(user, subscription.endpoint), {
    user, subscription, userAgent: String(userAgent || '').slice(0, 200), savedAt: new Date().toISOString()
  });
}

export async function removeSubscription(user, endpoint) {
  await store().delete(keyFor(user, endpoint));
}

const deviceId = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

// The signed-in person's own devices (never the secret keys).
export async function listDevices(user) {
  const { blobs } = await store().list({ prefix: `sub/${encodeURIComponent(user)}/` });
  const records = await Promise.all(blobs.map((b) => store().get(b.key, { type: 'json' })));
  return records.filter(Boolean).map((r) => ({
    id: deviceId(r.subscription.endpoint), userAgent: r.userAgent || '', savedAt: r.savedAt
  })).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export async function removeDeviceById(user, id) {
  if (!/^[0-9a-f]{32}$/.test(id)) return;
  await store().delete(`sub/${encodeURIComponent(user)}/${id}`);
}

// Sends `payload` ({ title, body, url, tag }) to every device of the given users
// (or everyone when users is '*'), skipping `exclude`. `kind` ('message', 'mention' or 'other')
// lets each person's own notification settings and quiet hours apply; 'test' always goes through.
// Returns how many were delivered.
// Notifications from the same chat stack under one tag, and chat notifications get a "Reply" button.
export function withChatTag(payload) {
  const url = String((payload && payload.url) || '');
  const m = url.match(/^\/group\/(?:\?room=([a-z0-9-]+))?(?:&|$)/);
  if (!m) return payload;
  return { ...payload, tag: payload.tag || `chat-${m[1] || 'everyone'}`, replyable: true };
}

export async function sendPush(users, payload, { exclude, kind = 'other', room = null } = {}) {
  const config = pushConfig();
  if (!config) return 0;
  webpush.setVapidDetails(Netlify.env.get('VAPID_SUBJECT') || 'https://chowaniec.net', config.publicKey, config.privateKey);

  const { blobs } = await store().list({ prefix: 'sub/' });
  let targets = blobs.filter((b) => {
    const user = decodeURIComponent(b.key.split('/')[1]);
    if (exclude && user === exclude) return false;
    return users === '*' || users.includes(user);
  });
  if (kind !== 'test') {
    const names = [...new Set(targets.map((b) => decodeURIComponent(b.key.split('/')[1])))];
    const allowed = new Set(await whoWantsPush(names, kind, new Date(), room));
    targets = targets.filter((b) => allowed.has(decodeURIComponent(b.key.split('/')[1])));
  }

  const body = JSON.stringify(withChatTag(payload));
  const results = await Promise.all(targets.map(async (b) => {
    const record = await store().get(b.key, { type: 'json' });
    if (!record) return 0;
    try {
      await webpush.sendNotification(record.subscription, body, { TTL: 60 * 60 * 24 });
      return 1;
    } catch (err) {
      // 404/410: the device unsubscribed or the subscription expired.
      if (err.statusCode === 404 || err.statusCode === 410) await store().delete(b.key);
      else console.error('Push failed:', err.statusCode, err.body || err.message);
      return 0;
    }
  }));
  return results.reduce((a, b) => a + b, 0);
}
