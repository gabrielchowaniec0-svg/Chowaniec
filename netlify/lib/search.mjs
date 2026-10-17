// One search across everything a person can see: notes, group chats (only the chats they are in),
// meeting briefings and calendar events. Used by /search and by the AI.
import { getStore } from '@netlify/blobs';
import { listVisible } from './notes-store.mjs';
import { latest } from './group-store.mjs';
import { roomsFor } from './rooms.mjs';
import { listEvents, todayLocal, addDays, describeWhen } from './calendar-store.mjs';

const CHAT_SCAN = 300;     // most recent messages looked at per chat
const PER_GROUP = 8;

function words(query) {
  return String(query || '').toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'’@#-]/gu, '')).filter((w) => w.length > 0).slice(0, 6);
}

const matches = (hay, ws) => ws.every((w) => hay.includes(w));

// A short piece of text around the first match.
function snippet(text, ws, size = 140) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const at = Math.max(0, ws.map((w) => flat.toLowerCase().indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] || 0);
  const from = Math.max(0, at - 40);
  return (from > 0 ? '…' : '') + flat.slice(from, from + size) + (from + size < flat.length ? '…' : '');
}

export async function searchEverything(user, query) {
  const ws = words(query);
  if (!ws.length || ws.join('').length < 2) return { query: String(query || ''), notes: [], chats: [], meetings: [], events: [], total: 0 };
  const today = todayLocal().date;

  const notesPromise = listVisible(user).then((list) => list
    .filter((n) => matches(`${n.title}\n${n.markdown}`.toLowerCase(), ws))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, PER_GROUP)
    .map((n) => ({ type: 'note', id: n.id, title: n.title || 'Untitled note', snippet: snippet(n.markdown, ws), when: n.updatedAt, owner: n.owner, url: `/notes/?id=${n.id}` })));

  const chatsPromise = Promise.all(roomsFor(user.name).map(async (room) => {
    const recent = await latest(CHAT_SCAN, room.id);
    return recent.filter((m) => m.kind !== 'system' && matches(`${m.text || ''}`.toLowerCase(), ws)).map((m) => ({
      type: 'chat', id: m.id, room: room.id, roomName: room.name, user: m.user, snippet: snippet(m.text, ws), when: m.createdAt,
      url: room.id === 'everyone' ? '/group/' : `/group/?room=${room.id}`
    }));
  })).then((groups) => groups.flat().sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, PER_GROUP));

  const meetingsPromise = (async () => {
    const store = getStore({ name: 'meeting-briefs', consistency: 'strong' });
    const { blobs } = await store.list();
    const briefs = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);
    return briefs.filter((b) => matches(`${b.topics || ''}\n${b.important || ''}`.toLowerCase(), ws))
      .sort((a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1)).slice(0, PER_GROUP)
      .map((b) => ({ type: 'meeting', code: b.code, title: String(b.topics || 'Meeting').split('\n')[0].slice(0, 100), snippet: snippet(`${b.topics || ''} ${b.important || ''}`, ws), when: b.startsAt || b.updatedAt, url: `/meet/?room=${encodeURIComponent(b.code)}` }));
  })();

  const eventsPromise = listEvents(user, addDays(today, -60), addDays(today, 365)).then((list) => list
    .filter((e) => matches(`${e.title}\n${e.location}\n${e.notes}`.toLowerCase(), ws))
    .slice(0, PER_GROUP)
    .map((e) => ({ type: 'event', id: e.id, title: e.title, snippet: `${describeWhen(e)}${e.location ? ` · ${e.location}` : ''}`, when: e.date, url: `/calendar/?event=${e.id}` })));

  const [notes, chats, meetings, events] = await Promise.all([notesPromise, chatsPromise, meetingsPromise, eventsPromise]);
  return { query: String(query || ''), notes, chats, meetings, events, total: notes.length + chats.length + meetings.length + events.length };
}
