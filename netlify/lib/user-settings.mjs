// Per-person settings that the server needs to know about (notification choices and quiet hours).
// Stored in Netlify Blobs under settings/<name>. Appearance choices live on each device instead.
import { getStore } from '@netlify/blobs';

const store = () => getStore({ name: 'user-settings', consistency: 'strong' });
const keyFor = (name) => `settings/${encodeURIComponent(name)}`;

export const DEFAULT_SETTINGS = {
  notifications: {
    messages: 'all',                                   // 'all' | 'mentions' | 'off'
    quietHours: { on: false, start: '22:00', end: '07:00', tz: 'America/New_York' }
  },
  ai: { digest: false }                                // a short morning summary from the AI
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return typeof tz === 'string' && tz.length < 80;
  } catch (e) {
    return false;
  }
}

// Keeps only known fields with valid values. Anything missing or invalid falls back to `base`
// (the person's current settings, or the defaults).
export function cleanSettings(input, base = DEFAULT_SETTINGS) {
  const n = (input && input.notifications) || {};
  const q = n.quietHours || {};
  const d = base.notifications;
  const a = (input && input.ai) || {};
  return {
    ai: { digest: typeof a.digest === 'boolean' ? a.digest : !!(base.ai && base.ai.digest) },
    notifications: {
      messages: ['all', 'mentions', 'off'].includes(n.messages) ? n.messages : d.messages,
      quietHours: {
        on: typeof q.on === 'boolean' ? q.on : d.quietHours.on,
        start: TIME.test(q.start) ? q.start : d.quietHours.start,
        end: TIME.test(q.end) ? q.end : d.quietHours.end,
        tz: validZone(q.tz) ? q.tz : d.quietHours.tz
      }
    }
  };
}

export async function getSettings(name) {
  const saved = await store().get(keyFor(name), { type: 'json' });
  return cleanSettings(saved);
}

export async function saveSettings(name, patch) {
  const current = await getSettings(name);
  const next = cleanSettings(patch, current);
  await store().setJSON(keyFor(name), next);
  return next;
}

function minutesNow(tz, now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get('hour') * 60 + get('minute');
}

export function inQuietHours(quiet, now = new Date()) {
  if (!quiet || !quiet.on) return false;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);
  if (start === end) return false;
  const nowMin = minutesNow(quiet.tz, now);
  return start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
}

// kind: 'message' | 'mention' | 'other'. Returns the subset of `names` who should get this push.
export async function whoWantsPush(names, kind, now = new Date()) {
  const all = await Promise.all(names.map(async (name) => {
    try {
      const n = (await getSettings(name)).notifications;
      if (n.messages === 'off') return null;
      if (kind === 'important') return name;           // an @important ping gets through quiet hours and "mentions only"
      if (n.messages === 'mentions' && kind === 'message') return null;
      if (inQuietHours(n.quietHours, now)) return null;
      return name;
    } catch (e) {
      return name;   // if settings can't be read, notify rather than silently drop
    }
  }));
  return all.filter(Boolean);
}
