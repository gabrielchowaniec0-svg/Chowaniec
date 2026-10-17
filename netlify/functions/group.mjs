// Chowaniec Group chat API.
//   Every request takes a room (?room=<id> or body.room); the default is 'everyone'.
//   GET ?rooms=1             -> { rooms }               the chats the caller is in
//   GET                      -> { messages }            latest 50, oldest first
//   GET ?since=<id>          -> { messages }            newer than id
//   GET ?before=<id>         -> { messages, hasMore }   up to 50 older
//   GET ?media=<mediaId>     -> image bytes (works with the sign-in cookie, for <img>)
//   GET ?scheduled=1         -> { scheduled }           the caller's scheduled messages
//   POST { text, image?, replyTo? }          -> { message }  (notifies others; @AI gets a reply)
//   POST { action: 'poll', question, options: [..], multi?, replyTo? } -> { message }
//   POST { action: 'vote', id, option }      -> { message }   (tap again to take a vote back)
//   POST { action: 'closepoll', id }         -> { message }   (author or host)
//   POST { action: 'voice', audio (data URL), duration, replyTo? } -> { message }
//   POST { action: 'schedule', text, sendAt (ISO time), replyTo? } -> { scheduled }
//   POST { action: 'unschedule', id }        -> { ok }
//   POST { action: 'react', id, emoji }      -> { message }
//   POST { action: 'typing' } | { action: 'read', id }   -> { ok }
//   POST { action: 'pin', id } -> { pinned }   POST { action: 'unpin' } -> { pinned: null }
//   DELETE ?id=<id>                          -> { ok }        (author or host)
// Every message GET also returns { presence, pinned } and marks the caller online.
import { getUser, json } from '../lib/auth.mjs';
import {
  isMessageId, latest, since, before, getMessage, getImage, postMessage, deleteMessage,
  toggleReaction, touchPresence, setTyping, clearTyping, setRead, listPresence,
  getPinned, pinMessage, unpin, saveAudio, MAX_VOICE_SECONDS, buildPoll, votePoll, closePoll,
  scheduleMessage, listScheduled, cancelScheduled, nextScheduledAt, deliverDue
} from '../lib/group-store.mjs';
import { publishMessage } from '../lib/group-post.mjs';
import { analyzeMessage } from '../lib/smart-message.mjs';
import { createEvent, describeWhen } from '../lib/calendar-store.mjs';
import { resolveRoom, roomsFor, canAccessRoom } from '../lib/rooms.mjs';

const EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🎉'];

export default async (req, context) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);

  try {
    if (req.method === 'GET' && url.searchParams.get('rooms')) return json(200, { rooms: roomsFor(user.name) });
    let body = null;
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch (e) {
        return json(400, { error: 'Invalid request.' });
      }
    }
    const room = resolveRoom(req.method === 'POST' ? (body && body.room) : url.searchParams.get('room'), user);

    if (req.method === 'GET') {
      const mediaId = url.searchParams.get('media');
      if (mediaId) {
        const image = await getImage(mediaId);
        if (!image || !canAccessRoom(user.name, image.room)) return json(404, { error: 'Photo not found.' });
        const headers = { 'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=31536000, immutable', 'Accept-Ranges': 'bytes' };
        // Voice messages are played with range requests (Safari insists on them).
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
        if (range && (range[1] || range[2])) {
          const size = image.bytes.byteLength;
          let from = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          let to = range[1] && range[2] ? Number(range[2]) : size - 1;
          to = Math.min(to, size - 1);
          if (from > to || from >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
          return new Response(image.bytes.slice(from, to + 1), {
            status: 206,
            headers: { ...headers, 'Content-Range': `bytes ${from}-${to}/${size}`, 'Content-Length': String(to - from + 1) }
          });
        }
        return new Response(image.bytes, { headers });
      }
      if (url.searchParams.get('scheduled')) return json(200, { scheduled: await listScheduled(user.name, room) });
      const sinceId = url.searchParams.get('since');
      const beforeId = url.searchParams.get('before');
      if ((sinceId && !isMessageId(sinceId)) || (beforeId && !isMessageId(beforeId))) {
        return json(400, { error: 'Invalid cursor.' });
      }
      await touchPresence(user.name, room);
      // Send any scheduled messages that are due (the once-a-minute scheduler also does this).
      context.waitUntil(nextScheduledAt().then((at) => (at != null && at <= Date.now() ? deliverDue(publishMessage) : null)).catch((e) => console.error('Scheduled check failed:', e.message)));
      const [page, presence, pinned] = await Promise.all([
        sinceId ? since(sinceId, 200, room).then((messages) => ({ messages }))
          : beforeId ? before(beforeId, 50, room)
            : latest(50, room).then((messages) => ({ messages })),
        listPresence(room),
        getPinned(room)
      ]);
      return json(200, { ...page, presence, pinned });
    }

    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id') || '';
      const found = await getMessage(id, room);
      if (!found) return json(404, { error: 'Message not found.' });
      if (found.message.user !== user.name && !user.host) return json(403, { error: 'You can only delete your own messages.' });
      await deleteMessage(id, room);
      const pinned = await getPinned(room);
      if (pinned && pinned.id === id) await unpin(room);
      return json(200, { ok: true });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    if (body.action === 'typing') {
      await setTyping(user.name, room);
      return json(200, { ok: true });
    }
    if (body.action === 'read') {
      if (!isMessageId(body.id)) return json(400, { error: 'Invalid message.' });
      await setRead(user.name, body.id, room);
      return json(200, { ok: true });
    }
    if (body.action === 'pin') {
      const pinned = await pinMessage(String(body.id || ''), user.name, room);
      if (!pinned) return json(404, { error: 'Message not found.' });
      return json(200, { pinned });
    }
    if (body.action === 'unpin') {
      const pinned = await getPinned(room);
      if (pinned && pinned.pinnedBy !== user.name && !user.host) {
        return json(403, { error: 'Only the person who pinned it or a host can unpin.' });
      }
      await unpin(room);
      return json(200, { pinned: null });
    }

    if (body.action === 'poll') {
      const poll = buildPoll(body.question, body.options, body.multi);
      const message = await postMessage({
        author: user.name, room, text: `📊 ${poll.question}`, poll,
        replyTo: isMessageId(body.replyTo) ? body.replyTo : null
      });
      context.waitUntil(publishMessage(message));
      return json(200, { message });
    }
    if (body.action === 'vote') {
      const message = await votePoll(String(body.id || ''), user.name, String(body.option || ''), room);
      if (!message) return json(404, { error: 'Poll not found.' });
      return json(200, { message });
    }
    if (body.action === 'closepoll') {
      const message = await closePoll(String(body.id || ''), user.name, user.host, room);
      if (!message) return json(404, { error: 'Poll not found.' });
      return json(200, { message });
    }
    if (body.action === 'voice') {
      const duration = Math.round(Number(body.duration));
      if (!(duration >= 1)) return json(400, { error: 'That voice message is too short.' });
      if (duration > MAX_VOICE_SECONDS) return json(400, { error: 'Voice messages can be up to 5 minutes.' });
      const mediaId = await saveAudio(body.audio, room);
      const message = await postMessage({
        author: user.name, room, text: '🎤 Voice message', voice: { id: mediaId, duration },
        replyTo: isMessageId(body.replyTo) ? body.replyTo : null
      });
      context.waitUntil(publishMessage(message));
      return json(200, { message });
    }
    if (body.action === 'schedule') {
      const scheduled = await scheduleMessage({ user: user.name, room, text: body.text, replyTo: body.replyTo, sendAt: body.sendAt });
      return json(200, { scheduled });
    }
    if (body.action === 'unschedule') {
      const ok = await cancelScheduled(user.name, String(body.id || ''));
      if (!ok) return json(404, { error: 'That scheduled message was already sent or cancelled.' });
      return json(200, { ok: true });
    }

    if (body.action === 'react') {
      if (!EMOJI.includes(body.emoji)) return json(400, { error: 'Unsupported reaction.' });
      const message = await toggleReaction(String(body.id || ''), user.name, body.emoji, room);
      if (!message) return json(404, { error: 'Message not found.' });
      return json(200, { message });
    }

    // Smart detect (plain rules, no AI): plans become calendar events and group questions become polls.
    const smart = body.smart === false || body.image ? null : analyzeMessage(body.text);
    if (smart && (smart.event || smart.polls.length)) {
      const posted = [];
      const replyTo = isMessageId(body.replyTo) ? body.replyTo : null;
      const pause = () => new Promise((r) => setTimeout(r, 3));   // keeps the messages in order
      if (smart.text) posted.push(await postMessage({ author: user.name, room, text: smart.text, replyTo }));
      if (smart.event) {
        try {
          const event = await createEvent(user, { ...smart.event, room }, { via: 'chat', notify: false });
          await pause();
          posted.push(await postMessage({
            author: 'Chowaniec', room, kind: 'system',
            text: `📅 ${user.name}’s plan was added to the calendar: ${event.title}, ${describeWhen(event)}`,
            link: { href: `/calendar/?event=${event.id}`, label: 'Open calendar' }
          }));
        } catch (e) {
          console.error('Smart event failed:', e.message);
        }
      }
      for (const poll of smart.polls) {
        await pause();
        const built = buildPoll(poll.question, poll.options, poll.multi);
        posted.push(await postMessage({ author: user.name, room, text: `📊 ${built.question}`, poll: built }));
      }
      await clearTyping(user.name, room);
      for (const m of posted) if (m.kind !== 'system') context.waitUntil(publishMessage(m));
      return json(200, { message: posted[0], messages: posted });
    }

    const message = await postMessage({
      author: user.name,
      room,
      text: body.text,
      image: body.image || null,
      replyTo: isMessageId(body.replyTo) ? body.replyTo : null
    });
    await clearTyping(user.name, room);
    // Notifications and the AI's reply run after the response is sent.
    context.waitUntil(publishMessage(message));
    return json(200, { message });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error('Group chat error:', err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};

export const config = {
  // Generous: everyone at home shares one IP and each open chat polls every 3 seconds.
  rateLimit: { windowLimit: 600, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
