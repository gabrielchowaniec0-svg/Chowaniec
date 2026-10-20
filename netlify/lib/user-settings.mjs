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
  ai: { digest: false },                               // a short morning summary from the AI
  // How the app looks for this person (follows them to every device). See /theme.js and /robot.js.
  look: { theme: 'classic', mode: 'auto', custom: { accent: '#7c3aed', bg: '#ffffff', bg2: '#f4f4f5', gradient: false }, season: 'auto', motion: 'full', onboarded: 0 },
  robot: { type: 'bob', accessories: [], seasonal: true }
};
const ID = /^[a-z0-9-]{1,40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

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
  const lk = (input && input.look) || {}, lb = base.look || DEFAULT_SETTINGS.look, lc = lk.custom || {}, lbc = lb.custom || DEFAULT_SETTINGS.look.custom;
  const rb = (input && input.robot) || {}, rbase = base.robot || DEFAULT_SETTINGS.robot;
  return {
    look: {
      theme: ID.test(lk.theme) ? lk.theme : lb.theme,
      mode: ['auto', 'light', 'dark'].includes(lk.mode) ? lk.mode : lb.mode,
      custom: {
        accent: HEX.test(lc.accent) ? lc.accent : lbc.accent,
        bg: HEX.test(lc.bg) ? lc.bg : lbc.bg,
        bg2: HEX.test(lc.bg2) ? lc.bg2 : lbc.bg2,
        gradient: typeof lc.gradient === 'boolean' ? lc.gradient : !!lbc.gradient
      },
      season: lk.season === 'auto' || lk.season === 'off' || ID.test(lk.season) ? lk.season : lb.season,
      motion: ['full', 'reduced'].includes(lk.motion) ? lk.motion : lb.motion,
      onboarded: Number.isInteger(lk.onboarded) && lk.onboarded >= 0 && lk.onboarded < 1000 ? lk.onboarded : lb.onboarded
    },
    robot: {
      type: ID.test(rb.type) ? rb.type : rbase.type,
      accessories: Array.isArray(rb.accessories) ? [...new Set(rb.accessories.filter((x) => ID.test(x)))].slice(0, 6) : rbase.accessories,
      seasonal: typeof rb.seasonal === 'boolean' ? rb.seasonal : !!rbase.seasonal
    },
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

// ---- Muted chats: { <room id>: <ISO time the mute ends> }, kept apart from the settings so saving
// the settings page can never wipe them. An @important ping always gets through a mute.
const mutesKey = (name) => `mutes/${encodeURIComponent(name)}`;
export const MUTE_HOURS = { '1h': 1, '8h': 8, week: 24 * 7 };

export async function getMutes(name, now = Date.now()) {
  const saved = (await store().get(mutesKey(name), { type: 'json' })) || {};
  const live = {};
  for (const [room, until] of Object.entries(saved)) if (Date.parse(until) > now) live[room] = until;
  return live;
}

// duration: '1h' | '8h' | 'week' | 'off' (unmute). Returns the person's current mutes.
export async function setMute(name, room, duration, now = Date.now()) {
  const mutes = await getMutes(name, now);
  if (duration === 'off') delete mutes[room];
  else if (MUTE_HOURS[duration]) mutes[room] = new Date(now + MUTE_HOURS[duration] * 3600 * 1000).toISOString();
  else throw Object.assign(new Error('Pick how long to mute.'), { status: 400 });
  await store().setJSON(mutesKey(name), mutes);
  return mutes;
}

// kind: 'message' | 'mention' | 'other'. Returns the subset of `names` who should get this push.
// `room`: the chat the push is about, so that person's mute for it can apply.
export async function whoWantsPush(names, kind, now = new Date(), room = null) {
  const all = await Promise.all(names.map(async (name) => {
    try {
      if (room && kind !== 'important' && kind !== 'test') {
        const mutes = await getMutes(name, now.getTime());
        if (mutes[room]) return null;
      }
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
