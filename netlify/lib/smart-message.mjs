// Reads a group-chat message with plain rules (no AI) and finds plans and questions inside it:
//   - a plan with a day, e.g. "We're hanging out at Nicole's house on Friday"  -> a calendar event
//   - a group question, e.g. "Should we google meet before then?" or "Pizza or tacos?"  -> a real poll
// Returns { text, event, polls }: `text` is the message with the poll sentences taken out.
// It is deliberately cautious: when unsure it does nothing, so normal chatting is never changed.
import { addDays, todayLocal } from './calendar-store.mjs';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_WORD = `(?:${DAYS.join('|')}|mon|tues?|wed|thurs?|fri|sat|sun)`;

const PLAN_WORDS = /\b(hang(?:ing)? out|get ?together|dinner|lunch|breakfast|brunch|rehearsal|rehearse|rehearsing|practice|party|birthday|game night|game|movie|show|trip|appointment|picnic|call|meeting|meet(?:ing)? up|pick ?up|fitting|opening|performance|recital|visit(?:ing)?|coming over|come over|going to|heading to|having|celebrat\w+|sleepover|play|concert|BBQ|cookout|workshop|class|audition|dress rehearsal|tech)\b/i;
const SUBJECT = /^(?:so |ok(?:ay)?,? |hey,? |just a heads up,? |reminder:? )?(?:we(?:'|’)re|we are|we will|we(?:'|’)ll|let(?:'|’)s|i(?:'|’)m|i am|i will|i(?:'|’)ll|everyone is|everybody is|the family is|there(?:'|’)s|there is|we have|we(?:'|’)ve got|we got)\s+/i;
const NOT_A_PLAN = /\b(if|maybe|might|probably|can(?:'|’)t|cannot|won(?:'|’)t|wasn(?:'|’)t|didn(?:'|’)t|yesterday|last (?:night|week|month|year)|used to|wish|wanna|should have|would have)\b/i;
const GERUNDS = {
  'hanging out': 'Hang out', 'having': 'Have', 'going to': 'Go to', 'heading to': 'Head to', 'meeting up': 'Meet up', 'meeting': 'Meet',
  'eating': 'Eat', 'watching': 'Watch', 'playing': 'Play', 'celebrating': 'Celebrate', 'rehearsing': 'Rehearse', 'getting': 'Get',
  'doing': 'Do', 'visiting': 'Visit', 'coming over': 'Come over', 'picking up': 'Pick up', 'seeing': 'See', 'making': 'Make', 'cooking': 'Cook',
  'baking': 'Bake', 'practicing': 'Practice', 'going': 'Go', 'having a': 'Have a', 'taking': 'Take', 'driving': 'Drive', 'singing': 'Sing', 'shooting': 'Shoot'
};

// ---- day and time ----

function weekdayIndex(word) {
  const w = word.toLowerCase();
  return DAYS.findIndex((d) => d === w || (w.length >= 3 && d.startsWith(w.slice(0, 3)) && (w.length <= 3 || d.startsWith(w))));
}

// Finds the day a sentence talks about. Returns { date, matched } or null.
function findDay(sentence, today) {
  const lower = sentence.toLowerCase();
  let m;
  if ((m = /\b(tonight|today)\b/.exec(lower))) return { date: today.date, matched: m[0], tonight: m[1] === 'tonight' };
  if ((m = /\b(day after tomorrow)\b/.exec(lower))) return { date: addDays(today.date, 2), matched: m[0] };
  if ((m = /\btomorrow(?: (?:night|morning|afternoon|evening))?\b/.exec(lower))) return { date: addDays(today.date, 1), matched: m[0] };
  if ((m = new RegExp(`\\b(?:(this|next|on)\\s+)?(${DAY_WORD})\\b(?:\\s+(?:night|morning|afternoon|evening))?`, 'i').exec(sentence))) {
    const idx = weekdayIndex(m[2]);
    if (idx >= 0 && !(m[2].toLowerCase() === 'sat' && /\bsat\s+(?:on|in|at)\b/i.test(sentence) === false && m[2].length === 3 && !m[1] && false)) {
      let ahead = (idx - today.weekday + 7) % 7;
      if (ahead === 0) ahead = 7;
      let date = addDays(today.date, ahead);
      if ((m[1] || '').toLowerCase() === 'next' && ahead <= 6 - today.weekday) date = addDays(date, 7);
      return { date, matched: m[0] };
    }
  }
  const monthRe = new RegExp(`\\b(${MONTHS.join('|')}|${MONTH_ABBR.join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
  if ((m = monthRe.exec(sentence))) {
    const name = m[1].toLowerCase();
    const mi = MONTHS.indexOf(name) >= 0 ? MONTHS.indexOf(name) : MONTH_ABBR.indexOf(name.slice(0, 3));
    return { date: monthDay(today, mi + 1, Number(m[2])), matched: m[0] };
  }
  if ((m = /\b(\d{1,2})\/(\d{1,2})\b(?!\/)/.exec(sentence))) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { date: monthDay(today, mo, d), matched: m[0] };
  }
  return null;
}

function monthDay(today, month, day) {
  const year = Number(today.date.slice(0, 4));
  const make = (y) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const valid = (s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
  let date = make(year);
  if (!valid(date)) return null;
  if (date < today.date) date = make(year + 1);
  return valid(date) ? date : null;
}

// "at 6", "at 6:30pm", "6 pm", "noon". Returns { time: 'HH:MM', matched } or null.
function findTime(sentence) {
  let m;
  if ((m = /\b(?:at\s+)?noon\b/i.exec(sentence))) return { time: '12:00', matched: m[0] };
  if ((m = /\b(?:at\s+)?midnight\b/i.exec(sentence))) return { time: '23:59', matched: m[0] };
  m = /\b(?:at\s+|around\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(sentence);
  if (!m) m = /\b(?:at|around|@)\s*(\d{1,2})(?::(\d{2}))\b/i.exec(sentence);
  if (!m) m = /\bat\s+(\d{1,2})\b(?!\s*(?:people|of|years|min|hour))/i.exec(sentence);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3] ? m[3].toLowerCase().replace(/\./g, '') : '';
  if (min > 59 || h > 24 || h === 0 && !ampm) return null;
  if (ampm === 'pm' && h < 12) h += 12;
  else if (ampm === 'am' && h === 12) h = 0;
  else if (!ampm && h >= 1 && h <= 11) h += /\b(morning|breakfast|brunch)\b/i.test(sentence) ? 0 : 12;
  if (h > 23) return null;
  return { time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, matched: m[0] };
}

function tidyTitle(sentence, day, time) {
  let t = sentence.replace(/[.!]+$/, '').trim();
  for (const part of [day && day.matched, time && time.matched]) {
    if (part) t = t.replace(new RegExp(`(?:\\b(?:on|this|next|at|for|around|by)\\s+)?${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ' ');
  }
  t = t.replace(/\b(?:on|this|next|at|for|around|by)\s*$/i, '').replace(/\s+(?:on|this|next|at|for|around|by)(?=[\s,]|$)/gi, (s, off, all) => (/(^|\s)(?:on|this|next)\s*$/i.test(all.slice(0, off + s.length)) ? ' ' : s));
  t = t.replace(/^(?:so |ok(?:ay)?,? |hey,? |just a heads up,? |reminder:? )/i, '').replace(SUBJECT, '').replace(/^going to\s+(?=\w+ing\b)/i, '');
  t = t.replace(/\s*[,;]\s*(?=$)/, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.!])/g, '$1').trim();
  const lowerStart = t.toLowerCase();
  for (const key of Object.keys(GERUNDS).sort((a, b) => b.length - a.length)) {
    if (lowerStart.startsWith(`${key} `) || lowerStart === key) { t = GERUNDS[key] + t.slice(key.length); break; }
  }
  t = t.replace(/^(?:a|an|the)\s+(?=\w)/i, (s) => s).trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// A plan in one sentence -> { title, date, time } or null.
function findEvent(sentence, today) {
  const s = sentence.trim();
  if (s.length < 8 || s.length > 220 || /\?\s*$/.test(s) || /https?:\/\//i.test(s) || NOT_A_PLAN.test(s)) return null;
  if (!PLAN_WORDS.test(s)) return null;
  const day = findDay(s, today);
  if (!day || !day.date) return null;
  const time = findTime(s);
  const title = tidyTitle(s, day, time);
  if (title.length < 3 || title.split(/\s+/).length > 14) return null;
  return { title: title.slice(0, 120), date: day.date, time: time ? time.time : null };
}

// ---- polls ----

const YES_NO_FRAME = /^(?:(?:so|ok(?:ay)?|hey|also|and|oh|btw),?\s+)*(?:should we|shall we|do we want to|do we need to|are we|can we|could we|would everyone|does everyone|is everyone|can everyone|who(?:'|’)s (?:in|coming|down|free|available)|who is (?:in|coming|down|free|available)|who wants to|who can make it|who(?:'|’)s going|is anyone|does anyone want|want to|wanna)\b/i;
const CHOICE_FRAME = /^(?:(?:so|ok(?:ay)?|hey|also|and|oh|btw),?\s+)*(?:should we|shall we|do we want to|do you want to|would you rather|what should we|where should we|which|where do we|what do we|let(?:'|’)s (?:decide|pick|vote))\s*/i;
const STRONG_FRAME = /^(?:(?:so|ok(?:ay)?|hey|also|and|oh|btw),?\s+)*(?:should we|shall we|do we want to|would everyone|does everyone|who(?:'|’)s (?:in|coming|down)|who wants to|who can make it)\b/i;
const VERB_ONLY = /^(?:eat|go|get|do|have|meet|watch|play|order|see|try|make|cook|pick|choose|visit|head|book|use|grab)$/i;
const FIRST_VERBS = /^(?:get|eat|have|order|go to|go|do|watch|play|meet at|meet|see|try|make|cook|pick|choose|bring|grab|visit|hit|head to|book|use|do a|do an)\s+/i;

function cleanOption(raw) {
  let o = raw.trim().replace(/^(?:or|and)\s+/i, '').replace(/[?.!]+$/, '').trim();
  o = o.replace(/\s+(?:for|on|at|this|tonight|today|tomorrow|before|after|when)\b.*$/i, '').trim();
  return o;
}

function choiceOptions(sentence) {
  if (!/\sor\s/i.test(sentence)) return null;
  const body = sentence.replace(/[?\s]+$/, '').replace(CHOICE_FRAME, '').trim();
  if (!body) return null;
  const parts = body.split(/\s*,\s*|\s+or\s+/i).map((p, i) => cleanOption(i === 0 ? p.replace(FIRST_VERBS, '') : p)).filter(Boolean);
  if (parts.length > 2 && VERB_ONLY.test(parts[0])) parts.shift();
  const unique = [...new Map(parts.map((p) => [p.toLowerCase(), p])).values()];
  if (unique.length < 2 || unique.length > 6) return null;
  if (unique.some((p) => p.split(/\s+/).length > 4 || p.length > 60)) return null;
  return unique.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
}

function pollFromQuestion(sentence) {
  const q = sentence.trim();
  // Group questions typed without a question mark ("Should we google meet before then") still count.
  const bare = !/\?\s*$/.test(q) && STRONG_FRAME.test(q) && q.split(/\s+/).length >= 4;
  if ((!/\?\s*$/.test(q) && !bare) || q.length < 8 || q.length > 200 || /@AI\b/i.test(q) || /https?:\/\//i.test(q)) return null;
  const isGroupFrame = YES_NO_FRAME.test(q) || CHOICE_FRAME.test(q) || /^(?:so |also |and )?(?:pizza|tacos|pasta|friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b/i.test(q);
  if (!isGroupFrame) return null;
  const options = choiceOptions(q);
  const question = (q.charAt(0).toUpperCase() + q.slice(1)).replace(/[.!]*$/, bare ? '?' : '');
  if (options) return { question, options, multi: false };
  if (YES_NO_FRAME.test(q) && !/^(?:who|is anyone|does anyone)/i.test(q.replace(/^(?:(?:so|ok(?:ay)?|hey|also|and|oh|btw),?\s+)+/i, ''))) {
    return { question, options: ['Yes', 'No'], multi: false };
  }
  if (/^(?:(?:so|also|and),?\s+)?(?:who(?:'|’)s|who is|who wants|who can|is anyone|does anyone)/i.test(q)) {
    return { question, options: ['I’m in', 'Can’t make it', 'Maybe'], multi: false };
  }
  return null;
}

// "poll: Pizza or tacos?" or a "poll:" line followed by bullet lines.
function explicitPoll(lines, start) {
  const m = /^\s*(?:poll|vote)\s*[:\-–]\s*(.*)$/i.exec(lines[start]);
  if (!m) return null;
  const bullets = [];
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const b = /^\s*(?:[-•*]|\d+[.)])\s+(.+)$/.exec(lines[i]);
    if (!b) break;
    bullets.push(b[1].trim().slice(0, 100));
    end = i;
  }
  const question = m[1].trim().replace(/\s+/g, ' ');
  if (bullets.length >= 2) return { poll: { question: (question || 'Vote').slice(0, 200), options: bullets.slice(0, 8), multi: false }, end };
  if (!question) return null;
  const options = choiceOptions(question.endsWith('?') ? question : `${question}?`);
  return { poll: { question: question.replace(/\?*$/, '?').slice(0, 200), options: options || ['Yes', 'No'], multi: false }, end };
}

// Splits a line into sentences, keeping the punctuation with each.
function sentences(line) {
  return line.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [line];
}

/**
 * @param {string} text   what the person typed
 * @param {number} [now]  time to use as "now" (for tests)
 * @returns {{ text: string, event: object|null, polls: object[] }}
 */
export function analyzeMessage(text, now = Date.now()) {
  const original = String(text || '');
  const none = { text: original, event: null, polls: [] };
  if (original.trim().length < 12 || /@(?:ai|agent)\b/i.test(original)) return none;
  const today = todayLocal(now);
  const lines = original.split('\n');
  const keep = [];
  const polls = [];
  let event = null;
  for (let i = 0; i < lines.length; i++) {
    const explicit = explicitPoll(lines, i);
    if (explicit) { polls.push(explicit.poll); i = explicit.end; continue; }
    const kept = [];
    for (const raw of sentences(lines[i])) {
      const poll = polls.length < 2 ? pollFromQuestion(raw) : null;
      if (poll) { polls.push(poll); continue; }
      if (!event) event = findEvent(raw, today);
      kept.push(raw);
    }
    keep.push(kept.join('').trim());
  }
  if (!event && !polls.length) return none;
  const remaining = keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: remaining, event, polls };
}
