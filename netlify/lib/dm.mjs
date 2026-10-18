// Direct messages: the list of someone's one-to-one chats with the family and the AI.
// The chats themselves are ordinary rooms (see rooms.mjs: 'dm-<a>-<b>' and 'dm-ai-<name>').
import { dmPartners, dmParts } from './rooms.mjs';
import { latest, since, listPresence } from './group-store.mjs';

// [{ id, name, ai, last: { user, text, createdAt, onBehalfOf? } | null, unread }] newest conversation first,
// then everyone else (so the page can offer "start a chat").
export async function listDms(user) {
  const items = await Promise.all(dmPartners(user.name).map(async (p) => {
    const [recent, presence] = await Promise.all([latest(1, p.id), listPresence(p.id)]);
    const last = recent[0] || null;
    const mine = presence.find((x) => x.user === user.name);
    let unread = 0;
    if (last && last.user !== user.name && !(mine && mine.lastReadId && mine.lastReadId >= last.id)) {
      const fresh = mine && mine.lastReadId ? await since(mine.lastReadId, 50, p.id) : [last];
      unread = fresh.filter((m) => m.user !== user.name && m.kind !== 'system').length;
    }
    return {
      id: p.id, name: p.name, ai: p.ai,
      last: last ? { user: last.user, text: (last.text || (last.image ? '📷 Photo' : '')).slice(0, 120), createdAt: last.createdAt, ...(last.onBehalfOf ? { onBehalfOf: last.onBehalfOf } : {}) } : null,
      unread
    };
  }));
  const talked = items.filter((i) => i.last).sort((a, b) => (a.last.createdAt < b.last.createdAt ? 1 : -1));
  return talked.concat(items.filter((i) => !i.last));
}

// What the chat page needs to draw a direct message chat's header.
export function dmInfo(user, room) {
  const parts = dmParts(room);
  if (!parts) return null;
  const other = parts.ai ? 'Chowaniec AI' : parts.people.find((n) => n !== user.name);
  return { id: room, name: other, ai: parts.ai, members: parts.ai ? [user.name] : parts.people, with: other };
}
