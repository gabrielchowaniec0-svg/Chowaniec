// Meeting attendance and recaps.
//   POST { action: 'joined', code }                  -> { ok }   (the person's Meet page reports they joined)
//   GET  ?code=<code>                                -> { attendees, suggested, chats, posted }   (hosts)
//   POST { action: 'post', code, chat: 'auto'|<chat id> } -> { room, text, links }   (hosts)
// The recap is written from the meeting's shared note, then posted in a chat as Chowaniec AI on the host's behalf.
import { getUser, json } from '../lib/auth.mjs';
import { logAction } from '../lib/ai-policy.mjs';
import { recordJoin, getAttendance, chatForAttendees, postMeetingRecap, isMeetingCode, chatsForHost } from '../lib/meeting-recap.mjs';

export default async (req) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  try {
    if (req.method === 'GET') {
      if (!user.host) return json(403, { error: 'Only a host can use meeting recaps.' });
      const code = new URL(req.url).searchParams.get('code') || '';
      if (!isMeetingCode(code)) return json(400, { error: 'Invalid meeting code.' });
      const record = await getAttendance(code);
      const attendees = record ? Object.keys(record.attendees) : [];
      return json(200, { attendees, suggested: chatForAttendees(record && record.attendees), chats: chatsForHost(user), posted: (record && record.posted) || null });
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'Invalid request.' }); }
    if (body.action === 'joined') {
      if (!isMeetingCode(body.code)) return json(400, { error: 'Invalid meeting code.' });
      await recordJoin(body.code, user.name);
      return json(200, { ok: true });
    }
    if (body.action === 'post') {
      if (!user.host) return json(403, { error: 'Only a host can post a meeting recap.' });
      const result = await postMeetingRecap(user, { code: String(body.code || ''), chat: String(body.chat || 'auto'), origin: new URL(req.url).origin });
      await logAction({ user: user.name, action: 'meeting_recap', summary: 'Posted a meeting recap', room: (result && result.chat) || '' });
      return json(200, result);
    }
    return json(400, { error: 'Unknown request.' });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Meeting recap error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
