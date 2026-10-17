// Who is calling: the X-Chowaniec-Key header, or the remembered-sign-in cookie
// (needed for <img> requests and the service worker, which can't add headers).
import passwords from '../../passwords.js';

export const { PASSCODE_HASHES } = passwords;

export function userForKey(key) {
  return key && Object.prototype.hasOwnProperty.call(PASSCODE_HASHES, key) ? { key, ...PASSCODE_HASHES[key] } : null;
}

export function getUser(req) {
  const header = req.headers.get('x-chowaniec-key');
  if (header) return userForKey(header);
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)chowaniec_auth=([0-9a-f]{64})(?:;|$)/);
  return match ? userForKey(match[1]) : null;
}

export function familyNames() {
  return [...new Set(Object.values(PASSCODE_HASHES).map((u) => u.name).filter((n) => n !== 'Guest'))];
}

// Nicknames the family uses. A nickname works anywhere a name does: @mentions, asking the AI, and so on.
export const ALIASES = {
  Victoria: ['Vicky'],
  Nicole: [],
  Gabriel: ['Gabe'],
  Liliana: ['Lily'],
  Amelia: ['Mimi'],
  Emilia: ['Emilka', 'Pawlik']
};

// "vicky" -> "Victoria", "Gabe" -> "Gabriel", "nicole" -> "Nicole"; anything else -> null.
export function resolveName(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return null;
  for (const name of familyNames()) {
    if (name.toLowerCase() === w) return name;
    if ((ALIASES[name] || []).some((a) => a.toLowerCase() === w)) return name;
  }
  return null;
}

// The family heads who may send an @important ping.
export const canPingImportant = (user) => !!user && !!user.host && user.name !== 'Guest';
export const isHostName = (name) => Object.values(PASSCODE_HASHES).some((u) => u.name === name && u.host && u.name !== 'Guest');

export function json(status, body) {
  return Response.json(body, { status });
}
