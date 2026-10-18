// Things the AI does on its own, run every few minutes by the scheduler:
//   - morning-of event briefings posted in the event's chat
//   - an optional morning summary notification for people who turned it on
//   - a gentle follow-up on group questions nobody has answered
//   - a nudge for sign-up sheets that still have open slots
// Everything respects the heads' switches and the AI quiet hours (see ai-policy.mjs), and each thing happens once.
import { getPolicy, aiQuietNow, claimOnce, logAction } from './ai-policy.mjs';
import { eventsOn, todayLocal, addDays, describeWhen, localToUtc, canSee } from './calendar-store.mjs';
import { postMessage, latest, AI_NAME, familyTimeZone } from './group-store.mjs';
import { notifyMessage } from './group-store.mjs';
import { allSheets, markNudged } from './signup-store.mjs';
import { ROOM_IDS, roomMembers } from './rooms.mjs';
import { familyNames } from './auth.mjs';
import { getSettings } from './user-settings.mjs';
import { sendPush } from './push.mjs';

const BRIEF_HOUR = 7.5;    // 7:30 a.m. family time
const localHour = (now, tz) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get('hour') + get('minute') / 60;
};

async function aiPost(room, text, extra = {}) {
  const message = await postMessage({ author: AI_NAME, kind: 'ai', room, text, ...extra });
  await notifyMessage(message);
  return message;
}

const list = (names) => names.join(', ');

// ---- briefings
async function briefings(now, today, policy) {
  let posted = 0;
  const sheets = await allSheets();
  for (const event of await eventsOn(today)) {
    if (Date.parse(event.createdAt) >= localToUtc(today, '07:30')) continue;     // added after the morning: no briefing
    if (!(await claimOnce(`${today}/brief-${event.id}`))) continue;
    const members = roomMembers(event.room);
    const r = event.rsvp || {};
    const going = Object.keys(r).filter((n) => r[n] === 'going');
    const maybe = Object.keys(r).filter((n) => r[n] === 'maybe');
    const no = Object.keys(r).filter((n) => r[n] === 'no');
    const quiet = members.filter((n) => !r[n]);
    const lines = [`📅 Today: ${event.title}, ${describeWhen(event).replace(/^.*? at /, 'at ')}${event.location ? ` · ${event.location}` : ''}`];
    const who = [];
    if (going.length) who.push(`Going: ${list(going)}`);
    if (maybe.length) who.push(`Maybe: ${list(maybe)}`);
    if (no.length) who.push(`Can’t make it: ${list(no)}`);
    if (quiet.length && quiet.length < members.length) who.push(`Haven’t answered: ${list(quiet)}`);
    if (who.length) lines.push(who.join(' · '));
    for (const { sheet } of sheets.filter((x) => x.sheet.eventId === event.id)) {
      const open = sheet.slots.filter((s) => !s.claimedBy).map((s) => s.label);
      if (open.length) lines.push(`Still unclaimed on “${sheet.title}”: ${list(open)}`);
    }
    await aiPost(event.room, lines.join('\n'));
    await logAction({ user: event.createdBy, action: 'briefing', summary: `Posted a briefing for "${event.title}"`, room: event.room, auto: true });
    posted++;
  }
  return posted;
}

// ---- morning summary (opt-in per person)
async function digests(now, today) {
  let sent = 0;
  const events = await eventsOn(today);
  for (const name of familyNames()) {
    const settings = await getSettings(name);
    if (!(settings.ai && settings.ai.digest)) continue;
    if (!(await claimOnce(`${today}/digest-${name}`))) continue;
    const user = { name };
    const mine = events.filter((e) => canSee(user, e) && (e.rsvp || {})[name] !== 'no');
    if (!mine.length) continue;
    const unanswered = mine.filter((e) => !(e.rsvp || {})[name]).length;
    const body = mine.slice(0, 4).map((e) => `${e.title} ${e.time ? `(${describeWhen(e).replace(/^.* at /, '')})` : '(all day)'}`).join(' · ') +
      (unanswered ? ` — ${unanswered} waiting on your answer` : '');
    await sendPush([name], { title: 'Good morning! Today in the family', body, url: '/calendar/', tag: `digest-${today}` }, { kind: 'other' });
    await logAction({ user: name, action: 'digest', summary: 'Sent the morning summary', auto: true });
    sent++;
  }
  return sent;
}

// ---- unanswered questions
const ASKING = /\b(can (someone|anyone|somebody)|could (someone|anyone|somebody)|does (anyone|anybody|someone)|who (can|could|wants|will|is able)|anyone (able|free|got|want|can|know)|need (someone|a ride|help))\b/i;
export const isOpenQuestion = (m) => m.kind === 'user' && !m.thread && !m.sticker && !m.poll && !!m.text && m.text.includes('?') && ASKING.test(m.text);

async function looseEnds(now) {
  let posted = 0;
  for (const room of ROOM_IDS) {
    const recent = await latest(80, room);
    for (let i = 0; i < recent.length; i++) {
      const m = recent[i];
      if (!isOpenQuestion(m)) continue;
      const age = now.getTime() - Date.parse(m.createdAt);
      if (age < 3 * 3600e3 || age > 48 * 3600e3) continue;
      if (recent.slice(i + 1).some((x) => x.user !== m.user && x.kind === 'user')) continue;   // a family member has spoken since
      if (recent.slice(i + 1).some((x) => x.replyTo && x.replyTo.id === m.id)) continue;
      if (!(await claimOnce(`loose/${room}-${m.id}`))) continue;
      await aiPost(room, `Still waiting on an answer to ${m.user}’s question: “${m.text.slice(0, 140)}” Can anyone help?`, { replyTo: m.id });
      await logAction({ user: m.user, action: 'follow_up', summary: `Followed up on ${m.user}’s unanswered question`, room, auto: true });
      posted++;
      break;                                               // one nudge per chat per run
    }
  }
  return posted;
}

// ---- sign-up sheets with open slots
async function sheetNudges(now) {
  let posted = 0;
  const events = {};
  for (const item of await allSheets()) {
    const { sheet } = item;
    if (sheet.nudgedAt) continue;
    const open = sheet.slots.filter((s) => !s.claimedBy).map((s) => s.label);
    if (!open.length) continue;
    let due = now.getTime() - Date.parse(sheet.createdAt) > 24 * 3600e3;
    if (sheet.eventId) {
      const date = sheet.eventId.slice(0, 10);
      events[date] = events[date] || await eventsOn(date);
      const ev = events[date].find((e) => e.id === sheet.eventId);
      if (ev) due = due || localToUtc(ev.date, ev.time || '09:00') - now.getTime() < 24 * 3600e3;
    }
    if (!due) continue;
    const claimed = await markNudged(item);
    if (!claimed.modified) continue;
    await aiPost(sheet.room, `📝 “${sheet.title}” still needs someone for: ${list(open)}. Tap “I’ll do it” on the sheet to claim one.`);
    await logAction({ user: sheet.createdBy, action: 'sheet_nudge', summary: `Reminded the chat about open slots on "${sheet.title}"`, room: sheet.room, auto: true });
    posted++;
  }
  return posted;
}

export async function runAiAuto(now = new Date()) {
  const out = { briefings: 0, digests: 0, followUps: 0, sheetNudges: 0 };
  const tz = familyTimeZone();
  const policy = await getPolicy();
  const hour = localHour(now, tz);
  const today = todayLocal(now.getTime()).date;
  const quiet = await aiQuietNow(tz, now, policy);
  const run = async (name, fn) => { try { out[name] = await fn(); } catch (e) { console.error(`AI auto ${name} failed:`, e.message); } };
  if (hour >= BRIEF_HOUR && hour < 22) {
    if (policy.features.briefings && !quiet) await run('briefings', () => briefings(now, today, policy));
    if (policy.features.digest && hour < 11) await run('digests', () => digests(now, today));
  }
  if (!quiet) {
    if (policy.features.looseEnds && await claimOnce(`${today}/loose-${Math.floor(hour * 2)}`)) await run('followUps', () => looseEnds(now));
    await run('sheetNudges', () => sheetNudges(now));
  }
  return out;
}
