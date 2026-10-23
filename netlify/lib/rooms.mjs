// The family's group chats ("rooms") and who may see each one.
// "everyone" keeps the original storage keys, so all earlier messages stay in it.
import { familyNames } from './auth.mjs';

export const DEFAULT_ROOM = 'everyone';

const ROOMS = [
  { id: 'everyone', name: 'Everyone', blurb: 'The whole family', members: () => familyNames() },
  { id: 'no-emilia', name: 'Everyone but Emilia', blurb: 'Everyone except Emilia', members: () => familyNames().filter((n) => n !== 'Emilia') },
  { id: 'core', name: 'Vicky, Gabriel & Nicole', blurb: 'Only Vicky, Gabriel and Nicole', members: () => ['Victoria', 'Gabriel', 'Nicole'].filter((n) => familyNames().includes(n)) },
  { id: 'gel', name: 'Gabriel, Emilia & Liliana', blurb: 'Only Gabriel, Emilia and Liliana', members: () => ['Gabriel', 'Emilia', 'Liliana'].filter((n) => familyNames().includes(n)) }
];

export const ROOM_IDS = ROOMS.map((r) => r.id);
export const isRoomId = (id) => ROOMS.some((r) => r.id === id);     // the group chats only

// --- Direct messages ---
// A direct message chat is a room too: 'dm-<a>-<b>' (two family members, names in lower case and A-Z order)
// or 'dm-ai-<name>' (one person chatting with the AI). Only those people can open it.
const DM = /^dm-([a-z]+)-([a-z]+)$/;
const findName = (lower) => familyNames().find((n) => n.toLowerCase() === lower) || null;
export const isDmId = (id) => DM.test(id || '');
export function dmParts(id) {
  const m = DM.exec(id || '');
  if (!m) return null;
  if (m[1] === 'ai') {
    const person = findName(m[2]);
    return person ? { ai: true, people: [person] } : null;
  }
  const a = findName(m[1]);
  const b = findName(m[2]);
  return a && b && a !== b && m[1] < m[2] ? { ai: false, people: [a, b] } : null;
}
export const isAiDm = (id) => { const p = dmParts(id); return !!(p && p.ai); };
// The room id for a chat between two people ('AI' for the AI), or null if either isn't a family member.
export function dmId(a, b) {
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  if (x === 'ai' || y === 'ai') {
    const person = findName(x === 'ai' ? y : x);
    return person ? `dm-ai-${person.toLowerCase()}` : null;
  }
  const na = findName(x);
  const nb = findName(y);
  if (!na || !nb || na === nb) return null;
  return x < y ? `dm-${x}-${y}` : `dm-${y}-${x}`;
}
export const isAnyRoomId = (id) => isRoomId(id) || !!dmParts(id);
export const roomMembers = (id) => {
  const dm = dmParts(id);
  if (dm) return dm.people;
  return (ROOMS.find((r) => r.id === id) || ROOMS[0]).members();
};
export const canAccessRoom = (name, id) => isAnyRoomId(id) && roomMembers(id).includes(name);

// Other people this person can message directly (everyone in the family but them), plus the AI.
export function dmPartners(name) {
  return familyNames().filter((n) => n !== name).map((n) => ({ id: dmId(name, n), name: n, ai: false }))
    .concat([{ id: dmId(name, 'AI'), name: 'Chowaniec AI', ai: true }]);
}

// Rooms this person is in, for the switcher.
export function roomsFor(name) {
  return ROOMS.filter((r) => r.members().includes(name)).map((r) => ({ id: r.id, name: r.name, blurb: r.blurb, count: r.members().length, members: r.members() }));
}

// Reads ?room= or body.room; a missing value means the main room. Throws 400/403 for bad or forbidden rooms.
export function resolveRoom(raw, user) {
  const id = raw == null || raw === '' ? DEFAULT_ROOM : String(raw);
  if (!isAnyRoomId(id)) throw Object.assign(new Error('That chat doesn’t exist.'), { status: 404 });
  if (!canAccessRoom(user.name, id)) throw Object.assign(new Error('You’re not in that chat.'), { status: 403 });
  return id;
}

// Storage key prefix for a room ('' for the main room).
export const prefixOf = (room) => (!room || room === DEFAULT_ROOM ? '' : `room/${room}/`);
