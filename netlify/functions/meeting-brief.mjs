// Meeting briefings for Chowaniec Meet: when it starts, what will be discussed and
// anything important. Shown to guests on the lobby (waiting) screen.
//   GET  ?code=<meeting code>  -> { brief } (null if none)
//   POST { code, startsAt, topics, important } -> { brief }
// Any signed-in user can read. The person who creates a meeting can set its briefing
// once; hosts can create or update any briefing.
import { getStore } from '@netlify/blobs';
import passwords from '../../passwords.js';

const { PASSCODE_HASHES } = passwords;
const ROOM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const store = () => getStore({ name: 'meeting-briefs', consistency: 'strong' });

function json(status, body) {
  return Response.json(body, { status });
}

function signedInUser(req) {
  const key = req.headers.get('x-chowaniec-key');
  return key && Object.prototype.hasOwnProperty.call(PASSCODE_HASHES, key) ? PASSCODE_HASHES[key] : null;
}

export default async (req) => {
  const user = signedInUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });

  if (req.method === 'GET') {
    const code = new URL(req.url).searchParams.get('code') || '';
    if (!ROOM_NAME_PATTERN.test(code)) return json(400, { error: 'Invalid meeting code.' });
    const brief = await store().get(code, { type: 'json' });
    return json(200, { brief: brief || null });
  }

  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { error: 'Invalid request.' });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!ROOM_NAME_PATTERN.test(code)) return json(400, { error: 'Invalid meeting code.' });

  let startsAt = '';
  if (body.startsAt) {
    const date = new Date(body.startsAt);
    if (Number.isNaN(date.getTime())) return json(400, { error: 'Please enter a valid start time.' });
    startsAt = date.toISOString();
  }

  const brief = {
    code,
    startsAt,
    topics: String(body.topics || '').trim().slice(0, 1500),
    important: String(body.important || '').trim().slice(0, 1000),
    createdBy: user.name,
    updatedAt: new Date().toISOString()
  };

  const { modified } = await store().setJSON(code, brief, user.host ? {} : { onlyIfNew: true });
  if (!modified) return json(409, { error: 'This meeting already has a briefing. Ask a host to change it.' });
  return json(200, { brief });
};
