// Family heads' controls over the AI: what it may do for each person, when it may speak up on its own,
// and a log of what it has done. Stored in Netlify Blobs (ai-policy store).
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { familyNames } from './auth.mjs';

const store = () => getStore({ name: 'ai-policy', consistency: 'strong' });

// The kinds of things the AI can do for someone. Heads can switch each one off per person.
export const CAPABILITIES = {
  post: 'Post or schedule messages and polls in chats',
  calendar: 'Add events to the calendar',
  notify: 'Notify other people (meeting alerts)',
  notes: 'Create or change notes',
  meetings: 'Start meetings'
};

export const TOOL_CAPABILITY = {
  post_to_group: 'post', schedule_group_message: 'post', create_poll: 'post',
  add_calendar_event: 'calendar',
  notify_meeting: 'notify',
  create_note: 'notes', append_to_note: 'notes',
  create_meeting: 'meetings'
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_POLICY = {
  restricted: {},                                         // { <name>: ['post', ...] } things the AI will not do for that person
  quiet: { on: true, start: '21:30', end: '07:00' },       // the AI doesn't speak up on its own during these hours
  features: { looseEnds: true, briefings: true, digest: true }
};

export function cleanPolicy(input, base = DEFAULT_POLICY) {
  const i = input || {};
  const restricted = {};
  const names = familyNames();
  const src = i.restricted && typeof i.restricted === 'object' ? i.restricted : base.restricted;
  for (const [name, list] of Object.entries(src)) {
    if (!names.includes(name) || !Array.isArray(list)) continue;
    const caps = [...new Set(list.filter((c) => c in CAPABILITIES))];
    if (caps.length) restricted[name] = caps;
  }
  const q = i.quiet || {};
  const f = i.features || {};
  return {
    restricted,
    quiet: {
      on: typeof q.on === 'boolean' ? q.on : base.quiet.on,
      start: TIME.test(q.start) ? q.start : base.quiet.start,
      end: TIME.test(q.end) ? q.end : base.quiet.end
    },
    features: {
      looseEnds: typeof f.looseEnds === 'boolean' ? f.looseEnds : base.features.looseEnds,
      briefings: typeof f.briefings === 'boolean' ? f.briefings : base.features.briefings,
      digest: typeof f.digest === 'boolean' ? f.digest : base.features.digest
    }
  };
}

export async function getPolicy() {
  return cleanPolicy(await store().get('policy', { type: 'json' }));
}

export async function setPolicy(patch) {
  const next = cleanPolicy(patch, await getPolicy());
  await store().setJSON('policy', next);
  return next;
}

// Is the AI allowed to do this thing for this person? Returns '' if yes, otherwise a reason.
export async function whyBlocked(userName, toolName) {
  const cap = TOOL_CAPABILITY[toolName];
  if (!cap) return '';
  const policy = await getPolicy();
  if ((policy.restricted[userName] || []).includes(cap)) {
    return `The family heads have turned this off for ${userName}, so I can't ${CAPABILITIES[cap].charAt(0).toLowerCase()}${CAPABILITIES[cap].slice(1)} for you. A head can change it in Settings.`;
  }
  return '';
}

// True when the AI should stay quiet on its own (not when someone asks it for something).
export async function aiQuietNow(tz, now = new Date(), policy = null) {
  const p = policy || await getPolicy();
  if (!p.quiet.on) return false;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => Number(parts.find((x) => x.type === t).value);
  const cur = get('hour') * 60 + get('minute');
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const start = toMin(p.quiet.start);
  const end = toMin(p.quiet.end);
  if (start === end) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

// --- Action log: what the AI did and for whom ---
const dayKey = (d) => d.toISOString().slice(0, 10);

export async function logAction({ user, action, summary, room = '', auto = false }) {
  try {
    const now = new Date();
    const id = `${String(now.getTime()).padStart(13, '0')}-${crypto.randomBytes(3).toString('hex')}`;
    await store().setJSON(`log/${dayKey(now)}/${id}`, {
      id, at: now.toISOString(), user, action, summary: String(summary || '').slice(0, 300), room, auto
    });
  } catch (e) {
    console.error('AI log failed:', e.message);
  }
}

export async function listLog(limit = 100, daysBack = 30) {
  const out = [];
  for (let i = 0; i < daysBack && out.length < limit; i++) {
    const day = dayKey(new Date(Date.now() - i * 86400000));
    const { blobs } = await store().list({ prefix: `log/${day}/` });
    const entries = (await Promise.all(blobs.map((b) => store().get(b.key, { type: 'json' })))).filter(Boolean);
    out.push(...entries.sort((a, b) => (a.at < b.at ? 1 : -1)));
  }
  return out.slice(0, limit);
}
