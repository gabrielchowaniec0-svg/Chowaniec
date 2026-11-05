// The number on the home-screen app icon while Chowaniec is closed.
// Working out the real unread count (see unread.mjs) reads every chat, which is too slow to do for each push,
// so each person keeps a small counter: GET /.netlify/functions/unread sets it to the true total, and every chat
// push sent to their phone adds one. The service worker shows it with setAppBadge (payload field `badge`).
//   badges store, key badge/<user>: { n, at }
import { getStore } from '@netlify/blobs';

const store = () => getStore({ name: 'badges', consistency: 'strong' });
const key = (name) => `badge/${encodeURIComponent(name)}`;

// Adds `by` to each person's counter and returns { name: newCount }. Never throws: a badge is a nicety.
export async function bumpBadges(names, by = 1) {
  const out = {};
  await Promise.all([...new Set(names)].map(async (name) => {
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const entry = await store().getWithMetadata(key(name), { type: 'json' });
        const n = Math.max(0, Math.min(999, Number((entry && entry.data && entry.data.n) || 0) + by));
        const res = await store().setJSON(key(name), { n, at: Date.now() }, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
        if (!res || res.modified !== false) { out[name] = n; return; }
      }
    } catch (e) {
      console.error('Badge count failed:', e.message);
    }
  }));
  return out;
}

export async function readBadge(name) {
  try {
    const doc = await store().get(key(name), { type: 'json' });
    return Math.max(0, Number((doc && doc.n) || 0));
  } catch (e) {
    return 0;
  }
}

// Sets the counter to the real total (written only when it changed).
export async function setBadge(name, n) {
  try {
    const value = Math.max(0, Math.min(999, Math.round(Number(n) || 0)));
    const doc = await store().get(key(name), { type: 'json' });
    if (doc && doc.n === value) return value;
    await store().setJSON(key(name), { n: value, at: Date.now() });
    return value;
  } catch (e) {
    return n;
  }
}
