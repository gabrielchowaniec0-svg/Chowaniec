// Who has Chowaniec open right now. Every open, visible page checks in every few seconds
// (GET /.netlify/functions/call?incoming=1, from /calls.js), which records seen/<user> in the calls store.
import { getStore } from '@netlify/blobs';

export const ONLINE_MS = 15 * 1000;
const store = () => getStore({ name: 'calls', consistency: 'strong' });
const key = (name) => `seen/${encodeURIComponent(name)}`;

export async function markSeen(user) {
  await store().setJSON(key(user), { at: Date.now() });
}

export async function isOnline(user) {
  const seen = await store().get(key(user), { type: 'json' });
  return !!seen && Date.now() - seen.at < ONLINE_MS;
}

// The subset of `names` with Chowaniec open.
export async function onlineAmong(names) {
  const flags = await Promise.all(names.map(isOnline));
  return names.filter((_, i) => flags[i]);
}
