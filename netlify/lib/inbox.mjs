// In-app notifications: when someone has Chowaniec open, a notification shows as a toast on the page they're on
// (with quick buttons like Join game or Reply) instead of a phone notification. Pages pick them up through the
// same check-in that rings calls (GET /.netlify/functions/call?incoming=1&since=<id>).
//   inbox/<user>  { items: [{ id, at, title, body, url, tag, kind, room, from, actions: [{ label, url?, reply? }] }] }
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const KEEP = 30;
const KEEP_MS = 10 * 60 * 1000;
const store = () => getStore({ name: 'calls', consistency: 'strong' });
const key = (name) => `inbox/${encodeURIComponent(name)}`;

// Quick buttons for a notification, worked out from where it leads.
export function actionsFor(url) {
  const u = String(url || '/');
  if (/^\/games\/[\w-]+\/\?s=/.test(u)) return [{ label: 'Join game', url: u, icon: 'gamepad' }];
  if (/^\/meet\/\?room=/.test(u)) return [{ label: 'Join meeting', url: u, icon: 'video' }];
  if (/^\/group\//.test(u)) return [{ label: 'Reply', reply: true, icon: 'reply' }, { label: 'Open chat', url: u, icon: 'chat' }];
  if (/^\/calendar\//.test(u)) return [{ label: 'View event', url: u, icon: 'calendar' }];
  if (/^\/notes\//.test(u)) return [{ label: 'Open note', url: u, icon: 'externalLink' }];
  if (/^\/lists\//.test(u)) return [{ label: 'Open list', url: u, icon: 'externalLink' }];
  return u && u !== '/' ? [{ label: 'Open', url: u, icon: 'externalLink' }] : [];
}

function kindOf(url) {
  const u = String(url || '');
  if (u.startsWith('/games/')) return 'game';
  if (u.startsWith('/meet/')) return 'meeting';
  if (u.startsWith('/group/')) return 'message';
  if (u.startsWith('/calendar/')) return 'event';
  return 'other';
}

export async function addToInbox(names, payload) {
  const url = String(payload.url || '/');
  const room = /^\/group\//.test(url) ? (new URL(url, 'https://x').searchParams.get('room') || 'everyone') : null;
  const item = {
    id: `${Date.now().toString(36).padStart(9, '0')}${crypto.randomBytes(3).toString('hex')}`,
    at: Date.now(),
    title: String(payload.title || 'Chowaniec').slice(0, 120),
    body: String(payload.body || '').slice(0, 300),
    url, tag: payload.tag || null, kind: payload.important || payload.requireInteraction ? 'important' : kindOf(url), room,
    from: payload.from || null,
    actions: actionsFor(url)
  };
  await Promise.all(names.map(async (name) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const entry = await store().getWithMetadata(key(name), { type: 'json' });
      const items = ((entry && entry.data && entry.data.items) || []).filter((i) => Date.now() - i.at < KEEP_MS);
      // A newer notification with the same tag (e.g. the same chat) replaces the older one.
      const kept = item.tag ? items.filter((i) => i.tag !== item.tag) : items;
      kept.push(item);
      const res = await store().setJSON(key(name), { items: kept.slice(-KEEP) }, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
      if (res.modified) return;
    }
  }));
  return names.length;
}

// Notifications newer than `since` (an item id). With no `since`, returns only the newest id, so a page that
// just opened doesn't replay old ones.
export async function readInbox(name, since) {
  const doc = await store().get(key(name), { type: 'json' });
  const items = ((doc && doc.items) || []).filter((i) => Date.now() - i.at < KEEP_MS);
  const last = items.length ? items[items.length - 1].id : '';
  if (!since) return { items: [], cursor: last || '0' };
  return { items: items.filter((i) => i.id > since), cursor: last && last > since ? last : since };
}
