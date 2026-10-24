// Trivia Party "Family Edition": the AI writes quiz questions about the family's own life.
//   POST { players: [names], count?: 10, difficulty?: 'easy'|'medium'|'hard'|'mixed', fresh?: bool }
//     -> { id, questions: [{ q, answers[4], correct, fact, source, difficulty }], notice, cached }
//     -> { questions: [], notice, fallback: true } when there isn't enough shared material
//   Errors carry { error, fallback: true } so the game can play regular questions instead.
// Uses only what EVERY listed player can already see (see netlify/lib/trivia-family.mjs): the group chats
// they are all in, those chats' calendar events, and notes shared with the whole family. Never DMs.
// One batch is cached per (chat set, day, difficulty, count), so pressing Start twice doesn't pay twice;
// `fresh` asks for a new batch (e.g. a second round the same day). Each person may make 10 new batches an hour.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { getUser, json, familyNames } from '../lib/auth.mjs';
import { Anthropic, aiClient, aiConfigured, textOf } from '../lib/ai.mjs';
import { todayLocal } from '../lib/calendar-store.mjs';
import {
  DIFFICULTIES, cleanPlayers, sharedChats, gatherMaterial, hasEnough, SYSTEM, buildPrompt,
  outputFormat, AiSchema, cleanQuestions, noticeFor, cacheKey
} from '../lib/trivia-family.mjs';

const store = () => getStore({ name: 'trivia-ai', consistency: 'strong' });
export const PER_HOUR = 10;
const LOCK_MS = 90 * 1000;
const WAIT_MS = 45 * 1000;

const fail = (status, error, extra = {}) => json(status, { error, fallback: true, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const publicBatch = (b, cached) => ({ id: b.id, questions: b.questions, notice: b.notice, cached });

// Counts a new batch for `name`; false when they've used up this hour's allowance.
async function takeRate(name) {
  const key = `rate/${encodeURIComponent(name)}`;
  const now = Date.now();
  for (let i = 0; i < 4; i++) {
    const entry = await store().getWithMetadata(key, { type: 'json' });
    const times = ((entry && entry.data && entry.data.times) || []).filter((t) => now - t < 3600 * 1000);
    if (times.length >= PER_HOUR) return false;
    const next = { times: [...times, now] };
    const res = entry ? await store().setJSON(key, next, { onlyIfMatch: entry.etag }) : await store().setJSON(key, next, { onlyIfNew: true });
    if (res.modified) return true;
  }
  return false;
}

// Removes batches from earlier days.
async function sweep(day) {
  try {
    const { blobs } = await store().list({ prefix: 'cache/' });
    await Promise.all(blobs.filter((b) => b.key.split('/')[1] < day).map((b) => store().delete(b.key)));
  } catch (e) { /* not important */ }
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });

  let body;
  try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
  body = body && typeof body === 'object' ? body : {};
  const players = cleanPlayers(body.players, user.name);
  const count = Math.max(3, Math.min(12, Math.round(Number(body.count) || 10)));
  const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : 'mixed';
  const chats = sharedChats(players);
  const notesAllowed = players.every((p) => familyNames().includes(p));
  if (!chats.length) {
    return json(200, { questions: [], fallback: true, notice: 'Family Edition only uses chats everyone here shares, and there aren’t any, so this round uses regular questions.' });
  }

  const day = todayLocal().date;
  const key = cacheKey({ chats, notesAllowed, day, difficulty, count });
  const lockKey = key.replace(/^cache\//, 'lock/');
  if (!body.fresh) {
    const hit = await store().get(key, { type: 'json' });
    if (hit) return json(200, publicBatch(hit, true));
  }

  if (!aiConfigured()) return fail(503, 'Family Edition needs the AI helper, which isn’t set up yet.', { code: 'ai_off' });

  // Someone (e.g. the same host tapping Start twice) is already writing this batch: wait for it.
  const got = await store().setJSON(lockKey, { at: Date.now(), by: user.name }, { onlyIfNew: true });
  if (!got.modified) {
    const lock = await store().get(lockKey, { type: 'json' });
    if (lock && Date.now() - lock.at < LOCK_MS) {
      const until = Date.now() + WAIT_MS;
      while (Date.now() < until) {
        await sleep(1000);
        const hit = await store().get(key, { type: 'json' });
        if (hit && (!body.fresh || hit.createdAt >= lock.at)) return json(200, publicBatch(hit, true));
        if (!(await store().get(lockKey, { type: 'json' }))) break;
      }
      return fail(409, 'Still writing questions. Try again in a moment.');
    }
    await store().setJSON(lockKey, { at: Date.now(), by: user.name });
  }

  try {
    const material = await gatherMaterial(user, players);
    if (!hasEnough(material)) {
      return json(200, { questions: [], fallback: true, notice: 'There isn’t much shared in your chats lately, so this round uses regular questions.' });
    }
    if (!(await takeRate(user.name))) return fail(429, `That’s a lot of trivia! Family Edition can write ${PER_HOUR} new rounds an hour. Try again a bit later.`);

    let response;
    try {
      response = await aiClient(55_000).messages.create({
        model: Netlify.env.get('TRIVIA_AI_MODEL') || 'claude-haiku-5-5',
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(material, { players, count, difficulty }) }],
        output_config: { format: outputFormat(), effort: 'low' }
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return fail(503, 'Family Edition needs the AI helper, which isn’t set up yet.', { code: 'ai_off' });
      if (error instanceof Anthropic.RateLimitError) return fail(429, 'The AI is busy right now. Try again in a moment.');
      if (error instanceof Anthropic.APIError) { console.error('Trivia AI error:', error.status, error.message); return fail(502, 'The AI couldn’t write questions right now.'); }
      console.error('Trivia AI error:', error);
      return fail(502, 'The AI couldn’t write questions right now.');
    }
    if (response.stop_reason === 'refusal') return fail(422, 'The AI couldn’t write questions from this material.');
    let parsed;
    try { parsed = AiSchema.safeParse(JSON.parse(textOf(response))); } catch (e) { parsed = { success: false }; }
    if (!parsed.success) return fail(502, 'The AI’s questions came back garbled. Please try again.');
    const questions = cleanQuestions(parsed.data.questions, { count, difficulty });
    if (questions.length < Math.min(5, count)) return fail(502, 'The AI couldn’t write enough good questions.');

    const batch = { id: crypto.randomBytes(8).toString('hex'), questions, notice: noticeFor(questions), day, chats, createdAt: Date.now(), by: user.name };
    await store().setJSON(key, batch);
    sweep(day);
    return json(200, publicBatch(batch, false));
  } finally {
    await store().delete(lockKey).catch(() => {});
  }
};

export const config = {
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
