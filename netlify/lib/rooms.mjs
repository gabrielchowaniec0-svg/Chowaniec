// The family's group chats ("rooms") and who may see each one.
// "everyone" keeps the original storage keys, so all earlier messages stay in it.
import { familyNames } from './auth.mjs';

export const DEFAULT_ROOM = 'everyone';

const ROOMS = [
  { id: 'everyone', name: 'Everyone', blurb: 'The whole family', members: () => familyNames() },
  { id: 'no-emilia', name: 'Everyone but Emilia', blurb: 'Everyone except Emilia', members: () => familyNames().filter((n) => n !== 'Emilia') },
  { id: 'core', name: 'Vicky, Gabriel & Nicole', blurb: 'Only Vicky, Gabriel and Nicole', members: () => ['Victoria', 'Gabriel', 'Nicole'].filter((n) => familyNames().includes(n)) }
];

export const isRoomId = (id) => ROOMS.some((r) => r.id === id);
export const roomMembers = (id) => (ROOMS.find((r) => r.id === id) || ROOMS[0]).members();
export const canAccessRoom = (name, id) => isRoomId(id) && roomMembers(id).includes(name);

// Rooms this person is in, for the switcher.
export function roomsFor(name) {
  return ROOMS.filter((r) => r.members().includes(name)).map((r) => ({ id: r.id, name: r.name, blurb: r.blurb, count: r.members().length, members: r.members() }));
}

// Reads ?room= or body.room; a missing value means the main room. Throws 400/403 for bad or forbidden rooms.
export function resolveRoom(raw, user) {
  const id = raw == null || raw === '' ? DEFAULT_ROOM : String(raw);
  if (!isRoomId(id)) throw Object.assign(new Error('That chat doesn’t exist.'), { status: 404 });
  if (!canAccessRoom(user.name, id)) throw Object.assign(new Error('You’re not in that chat.'), { status: 403 });
  return id;
}

// Storage key prefix for a room ('' for the main room).
export const prefixOf = (room) => (!room || room === DEFAULT_ROOM ? '' : `room/${room}/`);
