// Chowaniec Watch Party: watch YouTube videos together in sync (Netlify Blobs store 'watch').
//   p/<id>        the party: { id, createdAt, expiresAt, host, rooms, meet, anyone, state, queue, played, invited, rev }
//   p/<id>/feed   { items: [{ id, at, by, t: 'c' | 'r', text?, k? }] }   the party's own chat and live reactions
//   p/<id>/live   { <name>: { at, s } }                                  who is watching (s: 'ok' | 'tap' | 'buf')
//   index         { items: [{ id, rooms, meet, expiresAt }] }            parties still running (for "Happening now")
//   rl/<name>     { at: [ms...] }                                         parties this person started lately
//
// state = { videoId, title, playing, position, rate, updatedAt, version, by }
//   position is where the video was (seconds) at server time updatedAt; while playing it moves on at `rate`.
//   Every play / pause / seek / skip makes a new state with version + 1. A change sent with an older version
//   is refused (409) so nobody undoes a newer change by accident.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { canAccessRoom } from './rooms.mjs';

const store = () => getStore({ name: 'watch', consistency: 'strong' });
export const PARTY_TTL_MS = 12 * 60 * 60 * 1000;
const LIVE_MS = 20 * 1000;            // someone counts as watching if their page checked in this recently
const LIVE_WRITE_MS = 8 * 1000;       // how often a watcher's check-in is written
const HOST_AWAY_MS = 90 * 1000;       // host gone this long: anyone may drive, even with "anyone can control" off
const MAX_QUEUE = 50;
const MAX_CHAT = 100;
const REACTION_KEEP_MS = 60 * 1000;
const MAX_TEXT = 300;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const err = (status, message) => Object.assign(new Error(message), { status });
const enc = encodeURIComponent;
const pause = () => new Promise((r) => setTimeout(r, 25 + Math.random() * 90));

const PARTY_ID = /^(?:[a-f0-9]{10}|m[a-f0-9]{15})$/;
export const isPartyId = (id) => PARTY_ID.test(id || '');
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (id) => VIDEO_ID.test(id || '');
export const REACTIONS = ['heart', 'laugh', 'wow', 'clap'];
export const meetPartyId = (code) => 'm' + crypto.createHash('sha256').update('meet:' + String(code).toLowerCase()).digest('hex').slice(0, 15);
const newItemId = () => `${Date.now().toString(36).padStart(9, '0')}${crypto.randomBytes(3).toString('hex')}`;
export const partyPath = (id) => `/watch/?p=${id}`;

// ---------- Video titles (YouTube oEmbed: no API key needed) ----------
export async function videoInfo(videoId) {
  if (!isVideoId(videoId)) throw err(400, 'That doesn’t look like a YouTube video.');
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${enc(`https://www.youtube.com/watch?v=${videoId}`)}`, { signal: AbortSignal.timeout(2500) });
    if (res.status === 401 || res.status === 403) throw err(422, 'That video’s owner doesn’t allow it to be played outside YouTube.');
    if (res.status === 404 || res.status === 400) throw err(404, 'That video couldn’t be found. It may be private or removed.');
    if (!res.ok) return { title: 'YouTube video', channel: '' };
    const data = await res.json();
    return { title: String(data.title || 'YouTube video').slice(0, 140), channel: String(data.author_name || '').slice(0, 80) };
  } catch (e) {
    if (e.status) throw e;
    return { title: 'YouTube video', channel: '' };   // YouTube unreachable: the player still knows the video
  }
}

// ---------- Reading and changing a party ----------
async function readParty(id) {
  if (!isPartyId(id)) return null;
  const entry = await store().getWithMetadata(`p/${id}`, { type: 'json' });
  if (!entry || !entry.data || Date.now() > entry.data.expiresAt) return null;
  return entry;
}

export async function getParty(id) {
  const entry = await readParty(id);
  return entry ? entry.data : null;
}

// May `user` see this party? Parties started from a chat are for the people in that chat (or any chat it was
// shared to); parties started from a link or a Meet call are for anyone signed in who has the link.
export function canSee(user, party) {
  if (!party) return false;
  if (!party.rooms || !party.rooms.length) return true;
  return party.rooms.some((r) => canAccessRoom(user.name, r)) || party.host === user.name;
}

export function guard(user, party) {
  if (!party) throw err(404, 'That watch party has ended. Start a new one!');
  if (!canSee(user, party)) throw err(403, 'This watch party is only for the people in that chat.');
  return party;
}

async function changeParty(id, user, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const entry = await readParty(id);
    const party = guard(user, entry && entry.data);
    if (change(party) === false) return party;
    party.rev = (party.rev || 0) + 1;
    const { modified } = await store().setJSON(`p/${id}`, party, { onlyIfMatch: entry.etag });
    if (modified) return party;
    await pause();
  }
  throw err(503, 'Lots happening at once. Try again.');
}

// Changes a small side record (feed, live) with retries. `make(data)` returns the new data or false.
async function changeDoc(key, make) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const entry = await store().getWithMetadata(key, { type: 'json' });
    const data = (entry && entry.data) || {};
    const next = make(data);
    if (next === false) return data;
    const res = await store().setJSON(key, next, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (res.modified) return next;
    await pause();
  }
  throw err(503, 'Lots happening at once. Try again.');
}

// Where the video is (seconds) at server time `t`.
export function positionAt(state, t = Date.now()) {
  if (!state || !state.videoId) return 0;
  const p = state.playing ? state.position + Math.max(0, t - state.updatedAt) / 1000 * (state.rate || 1) : state.position;
  return state.duration ? Math.min(p, state.duration) : p;
}

const emptyState = () => ({ videoId: null, title: '', channel: '', playing: false, position: 0, rate: 1, duration: 0, updatedAt: Date.now(), version: 0, by: null });

function setVideo(party, item, by, startAt = 0) {
  const prev = party.state;
  if (prev.videoId) {
    party.played = [{ videoId: prev.videoId, title: prev.title, at: Date.now() }]
      .concat((party.played || []).filter((p) => p.videoId !== prev.videoId)).slice(0, 20);
  }
  party.state = {
    videoId: item.videoId, title: item.title, channel: item.channel || '', playing: true, position: Math.max(0, startAt || 0),
    rate: prev.rate || 1, duration: 0, updatedAt: Date.now(), version: prev.version + 1, by
  };
}

const hostHere = async (party) => {
  const live = (await store().get(`p/${party.id}/live`, { type: 'json' })) || {};
  return !!(live[party.host] && Date.now() - live[party.host].at < HOST_AWAY_MS);
};

// Is `name` allowed to play / pause / seek / skip?
export async function canControl(name, party) {
  if (party.anyone || name === party.host) return true;
  return !(await hostHere(party));
}

async function mustControl(name, party) {
  if (!(await canControl(name, party))) throw err(403, `Only ${party.host} can control this party. Ask them to turn on “Anyone can control”.`);
}

// ---------- Creating ----------
async function noteCreate(name) {
  await changeDoc(`rl/${enc(name)}`, (d) => {
    const recent = (d.at || []).filter((t) => Date.now() - t < 60 * 60 * 1000);
    if (recent.length >= 20) throw err(429, 'You’ve started a lot of watch parties. Try again in a little while.');
    return { at: recent.concat(Date.now()) };
  });
}

async function addToIndex(party) {
  await changeDoc('index', (d) => ({
    items: (d.items || []).filter((i) => i.expiresAt > Date.now() && i.id !== party.id)
      .concat({ id: party.id, rooms: party.rooms, meet: !!party.meet, expiresAt: party.expiresAt }).slice(-200)
  }));
}

export async function createParty(user, { room = null, video = null, startAt = 0, anyone = true } = {}) {
  await noteCreate(user.name);
  const party = {
    id: crypto.randomBytes(5).toString('hex'), createdAt: Date.now(), expiresAt: Date.now() + PARTY_TTL_MS,
    host: user.name, rooms: room ? [room] : [], meet: null, anyone: anyone !== false, state: emptyState(),
    queue: [], played: [], invited: {}, rev: 1
  };
  if (video) setVideo(party, video, user.name, startAt);
  await store().setJSON(`p/${party.id}`, party, { onlyIfNew: true });
  await addToIndex(party);
  return party;
}

// The party that belongs to a Meet call (one per meeting code). Started the first time anyone opens it.
export async function meetParty(user, code) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(code || ''))) throw err(400, 'That meeting code doesn’t look right.');
  const id = meetPartyId(code);
  const found = await getParty(id);
  if (found) return { party: found, created: false };
  const entry = await store().getWithMetadata(`p/${id}`, { type: 'json' });   // maybe an expired one
  const party = {
    id, createdAt: Date.now(), expiresAt: Date.now() + PARTY_TTL_MS, host: user.name, rooms: [], meet: String(code).slice(0, 128),
    anyone: true, state: emptyState(), queue: [], played: [], invited: {}, rev: 1
  };
  const res = await store().setJSON(`p/${id}`, party, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
  if (!res.modified) return { party: await getParty(id), created: false };
  await store().delete(`p/${id}/feed`).catch(() => {});
  await store().delete(`p/${id}/live`).catch(() => {});
  await addToIndex(party);
  return { party, created: true };
}

// Parties this person can join that are still running, newest first.
export async function activeParties(user) {
  const index = (await store().get('index', { type: 'json' })) || {};
  const ids = (index.items || []).filter((i) => i.expiresAt > Date.now() && !i.meet).map((i) => i.id).slice(-30).reverse();
  const out = [];
  await Promise.all(ids.map(async (id) => {
    const party = await getParty(id);
    if (!party || !canSee(user, party)) return;
    const watchers = await watchersOf(id);
    if (!watchers.length && !party.state.videoId) return;
    out.push({ ...publicParty(party), watchers });
  }));
  return out.filter((p) => p.watchers.length).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
}

// ---------- Playback ----------
// op: 'play' | 'pause' | 'seek' | 'rate' | 'next' | 'ended' | 'duration'
export async function control(user, id, { version, op, position, rate, duration }) {
  const party0 = guard(user, await getParty(id));
  if (op !== 'ended' && op !== 'duration') await mustControl(user.name, party0);
  const pos = Number(position);
  return changeParty(id, user, (party) => {
    const s = party.state;
    if (op === 'duration') {   // the first player to learn the length tells the server (no version bump)
      const d = Number(duration);
      if (!s.videoId || s.duration || !(d > 0 && d < 24 * 3600) || Number(version) !== s.version) return false;
      s.duration = Math.round(d * 10) / 10;
      return undefined;
    }
    if (Number(version) !== s.version) throw err(409, 'Someone else changed the video first.');
    if (!s.videoId && op !== 'next') throw err(400, 'Pick a video first.');
    const now = Date.now();
    const here = positionAt(s, now);
    const clampPos = (p) => Math.max(0, Math.min(Number.isFinite(p) ? p : here, s.duration || 24 * 3600));
    if (op === 'play') Object.assign(s, { playing: true, position: clampPos(pos) });
    else if (op === 'pause') Object.assign(s, { playing: false, position: clampPos(pos) });
    else if (op === 'seek') Object.assign(s, { position: clampPos(pos) });
    else if (op === 'rate') {
      const r = Number(rate);
      if (!RATES.includes(r)) throw err(400, 'That speed isn’t available.');
      Object.assign(s, { position: here, rate: r });
    } else if (op === 'next' || op === 'ended') {
      const next = party.queue.shift();
      if (next) { setVideo(party, next, op === 'next' ? user.name : 'auto'); return undefined; }
      if (op === 'next') throw err(400, 'Nothing in the queue yet.');
      Object.assign(s, { playing: false, position: s.duration || here });
    } else throw err(400, 'Unknown control.');
    Object.assign(s, { updatedAt: now, version: s.version + 1, by: user.name });
    return undefined;
  });
}

// ---------- Queue ----------
// op: 'add' (video, playNow?) | 'remove' (qid) | 'up' (qid: play it next) | 'play' (qid: play it now)
export async function queueOp(user, id, { op, video, qid, playNow }) {
  const party0 = guard(user, await getParty(id));
  const driving = await canControl(user.name, party0);
  if ((op === 'up' || op === 'play' || playNow) && !driving) await mustControl(user.name, party0);
  return changeParty(id, user, (party) => {
    if (op === 'add') {
      if (party.queue.length >= MAX_QUEUE) throw err(400, 'The queue is full.');
      const item = { qid: crypto.randomBytes(4).toString('hex'), videoId: video.videoId, title: video.title, channel: video.channel || '', by: user.name, at: Date.now() };
      if (!party.state.videoId || playNow) setVideo(party, item, user.name, video.startAt || 0);
      else party.queue.push(item);
      return undefined;
    }
    const i = party.queue.findIndex((q) => q.qid === qid);
    if (i < 0) return false;
    const [item] = party.queue.splice(i, 1);
    if (op === 'remove') {
      if (!driving && item.by !== user.name) throw err(403, 'Only the person who added it (or someone in control) can remove it.');
    } else if (op === 'up') party.queue.unshift(item);
    else if (op === 'play') setVideo(party, item, user.name);
    else throw err(400, 'Unknown queue change.');
    return undefined;
  });
}

export async function setSettings(user, id, { anyone }) {
  return changeParty(id, user, (party) => {
    if (party.host !== user.name) throw err(403, `Only ${party.host} can change who controls the party.`);
    party.anyone = !!anyone;
  });
}

// ---------- Chat and reactions (kept in the party, not the family chat) ----------
export async function addFeed(user, id, { t, text, k }) {
  guard(user, await getParty(id));
  let item;
  if (t === 'c') {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!clean) throw err(400, 'Write a message first.');
    item = { id: newItemId(), at: Date.now(), by: user.name, t: 'c', text: clean };
  } else {
    if (!REACTIONS.includes(k)) throw err(400, 'Unknown reaction.');
    item = { id: newItemId(), at: Date.now(), by: user.name, t: 'r', k };
  }
  await changeDoc(`p/${id}/feed`, (d) => {
    const items = (d.items || []).filter((x) => x.t === 'c' || Date.now() - x.at < REACTION_KEEP_MS);
    const mine = items.filter((x) => x.by === user.name && x.t === item.t);
    if (item.t === 'r' && mine.filter((x) => Date.now() - x.at < 4000).length >= 10) throw err(429, 'Easy there! Too many reactions at once.');
    if (item.t === 'c' && mine.filter((x) => Date.now() - x.at < 30000).length >= 12) throw err(429, 'Slow down a little: too many messages at once.');
    const chat = items.filter((x) => x.t === 'c');
    const keepChat = new Set(chat.slice(-(MAX_CHAT - 1)).map((x) => x.id));
    return { items: items.filter((x) => x.t === 'r' || keepChat.has(x.id)).concat(item) };
  });
  return item;
}

// Feed items newer than `since` (an item id). With no `since`: the recent chat and the last few seconds of reactions.
export async function readFeed(id, since) {
  const d = (await store().get(`p/${id}/feed`, { type: 'json' })) || {};
  const items = d.items || [];
  const last = items.length ? items[items.length - 1].id : '';
  if (!since) return { items: items.filter((x) => x.t === 'c' || Date.now() - x.at < 3000).slice(-60), cursor: last || '0' };
  return { items: items.filter((x) => x.id > since), cursor: last && last > since ? last : since };
}

// ---------- Who is watching ----------
export async function checkIn(name, id, s) {
  const status = ['ok', 'tap', 'buf'].includes(s) ? s : 'ok';
  const key = `p/${id}/live`;
  const live = (await store().get(key, { type: 'json' })) || {};
  const mine = live[name];
  if (mine && mine.s === status && Date.now() - mine.at < LIVE_WRITE_MS) return live;
  return changeDoc(key, (d) => {
    const out = {};
    for (const [n, v] of Object.entries(d)) if (Date.now() - v.at < PARTY_TTL_MS && n !== name) out[n] = v;
    out[name] = { at: Date.now(), s: status, since: (d[name] && Date.now() - d[name].at < LIVE_MS && d[name].since) || Date.now() };
    return out;
  });
}

export async function leave(name, id) {
  await changeDoc(`p/${id}/live`, (d) => {
    if (!d[name]) return false;
    const out = { ...d };
    delete out[name];
    return out;
  });
}

export function watchersFrom(live) {
  return Object.entries(live || {}).filter(([, v]) => Date.now() - v.at < LIVE_MS)
    .map(([name, v]) => ({ name, s: v.s, since: v.since || v.at })).sort((a, b) => a.since - b.since);
}
export async function watchersOf(id) {
  return watchersFrom(await store().get(`p/${id}/live`, { type: 'json' }));
}

// Remembers that the party was shared to a chat (also lets that chat's members in). Returns false if it was
// shared there in the last few minutes already.
export async function noteInvite(user, id, room) {
  let fresh = true;
  await changeParty(id, user, (party) => {
    const last = (party.invited || {})[room];
    if (last && Date.now() - last < 5 * 60 * 1000) { fresh = false; return false; }
    party.invited = { ...(party.invited || {}), [room]: Date.now() };
    if (party.rooms.length && !party.rooms.includes(room)) party.rooms.push(room);
    return undefined;
  });
  return fresh;
}

// What the pages see.
export function publicParty(party) {
  return {
    id: party.id, host: party.host, createdAt: party.createdAt, expiresAt: party.expiresAt, rooms: party.rooms, meet: party.meet ? true : false,
    anyone: party.anyone, state: party.state, queue: party.queue, played: (party.played || []).slice(0, 10), rev: party.rev
  };
}
