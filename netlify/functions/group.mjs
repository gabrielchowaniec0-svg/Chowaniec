// Chowaniec Group chat API.
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

const EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🎉'];

export default async (req, context) => {
  const user = getUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      const mediaId = url.searchParams.get('media');
      if (mediaId) {
        const image = await getImage(mediaId);
        if (!image) return json(404, { error: 'Photo not found.' });
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
      if (url.searchParams.get('scheduled')) return json(200, { scheduled: await listScheduled(user.name) });
      const sinceId = url.searchParams.get('since');
      const beforeId = url.searchParams.get('before');
      if ((sinceId && !isMessageId(sinceId)) || (beforeId && !isMessageId(beforeId))) {
        return json(400, { error: 'Invalid cursor.' });
      }
      await touchPresence(user.name);
      // Send any scheduled messages that are due (the once-a-minute scheduler also does this).
      context.waitUntil(nextScheduledAt().then((at) => (at != null && at <= Date.now() ? deliverDue(publishMessage) : null)).catch((e) => console.error('Scheduled check failed:', e.message)));
      const [page, presence, pinned] = await Promise.all([
        sinceId ? since(sinceId).then((messages) => ({ messages }))
          : beforeId ? before(beforeId)
            : latest(50).then((messages) => ({ messages })),
        listPresence(),
        getPinned()
      ]);
      return json(200, { ...page, presence, pinned });
    }

    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id') || '';
      const found = await getMessage(id);
      if (!found) return json(404, { error: 'Message not found.' });
      if (found.message.user !== user.name && !user.host) return json(403, { error: 'You can only delete your own messages.' });
      await deleteMessage(id);
      const pinned = await getPinned();
      if (pinned && pinned.id === id) await unpin();
      return json(200, { ok: true });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json(400, { error: 'Invalid request.' });
    }

    if (body.action === 'typing') {
      await setTyping(user.name);
      return json(200, { ok: true });
    }
    if (body.action === 'read') {
      if (!isMessageId(body.id)) return json(400, { error: 'Invalid message.' });
      await setRead(user.name, body.id);
      return json(200, { ok: true });
    }
    if (body.action === 'pin') {
      const pinned = await pinMessage(String(body.id || ''), user.name);
      if (!pinned) return json(404, { error: 'Message not found.' });
      return json(200, { pinned });
    }
    if (body.action === 'unpin') {
      const pinned = await getPinned();
      if (pinned && pinned.pinnedBy !== user.name && !user.host) {
        return json(403, { error: 'Only the person who pinned it or a host can unpin.' });
      }
      await unpin();
      return json(200, { pinned: null });
    }

    if (body.action === 'poll') {
      const poll = buildPoll(body.question, body.options, body.multi);
      const message = await postMessage({
        author: user.name, text: `📊 ${poll.question}`, poll,
        replyTo: isMessageId(body.replyTo) ? body.replyTo : null
      });
      context.waitUntil(publishMessage(message));
      return json(200, { message });
    }
    if (body.action === 'vote') {
      const message = await votePoll(String(body.id || ''), user.name, String(body.option || ''));
      if (!message) return json(404, { error: 'Poll not found.' });
      return json(200, { message });
    }
    if (body.action === 'closepoll') {
      const message = await closePoll(String(body.id || ''), user.name, user.host);
      if (!message) return json(404, { error: 'Poll not found.' });
      return json(200, { message });
    }
    if (body.action === 'voice') {
      const duration = Math.round(Number(body.duration));
      if (!(duration >= 1)) return json(400, { error: 'That voice message is too short.' });
      if (duration > MAX_VOICE_SECONDS) return json(400, { error: 'Voice messages can be up to 5 minutes.' });
      const mediaId = await saveAudio(body.audio);
      const message = await postMessage({
        author: user.name, text: '🎤 Voice message', voice: { id: mediaId, duration },
        replyTo: isMessageId(body.replyTo) ? body.replyTo : null
      });
      context.waitUntil(publishMessage(message));
      return json(200, { message });
    }
    if (body.action === 'schedule') {
      const scheduled = await scheduleMessage({ user: user.name, text: body.text, replyTo: body.replyTo, sendAt: body.sendAt });
      return json(200, { scheduled });
    }
    if (body.action === 'unschedule') {
      const ok = await cancelScheduled(user.name, String(body.id || ''));
      if (!ok) return json(404, { error: 'That scheduled message was already sent or cancelled.' });
      return json(200, { ok: true });
    }

    if (body.action === 'react') {
      if (!EMOJI.includes(body.emoji)) return json(400, { error: 'Unsupported reaction.' });
      const message = await toggleReaction(String(body.id || ''), user.name, body.emoji);
      if (!message) return json(404, { error: 'Message not found.' });
      return json(200, { message });
    }

    const message = await postMessage({
      author: user.name,
      text: body.text,
      image: body.image || null,
      replyTo: isMessageId(body.replyTo) ? body.replyTo : null
    });
    await clearTyping(user.name);
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
