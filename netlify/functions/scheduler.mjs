// Runs every minute (Netlify scheduled function): sends scheduled group messages and calendar reminders that are due,
// and starts game nights whose time has come.
import { deliverDue } from '../lib/group-store.mjs';
import { publishMessage } from '../lib/group-post.mjs';
import { sendDueReminders } from '../lib/calendar-store.mjs';
import { runAiAuto } from '../lib/ai-auto.mjs';
import { sweepCalls } from '../lib/calls.mjs';
import { sweepSessions } from '../lib/games-store.mjs';
import { sweepUploads } from '../lib/video-store.mjs';
import { runDueNights } from '../lib/game-night.mjs';

export default async () => {
  const sent = await deliverDue(publishMessage);
  let reminders = 0;
  try {
    reminders = await sendDueReminders();
  } catch (e) {
    console.error('Calendar reminders failed:', e.message);
  }
  let nights = 0;
  try {
    nights = await runDueNights();     // game nights whose start time has come
  } catch (e) {
    console.error('Game nights failed:', e.message);
  }
  try {
    await sweepCalls();
  } catch (e) {
    console.error('Call sweep failed:', e.message);
  }
  if (new Date().getMinutes() === 17) {
    try {
      await sweepSessions();     // old game sessions, once an hour
    } catch (e) {
      console.error('Game session sweep failed:', e.message);
    }
    try {
      await sweepUploads();      // video uploads that were never finished
    } catch (e) {
      console.error('Video upload sweep failed:', e.message);
    }
  }
  // The AI's own jobs (briefings, follow-ups, ...) look at the whole calendar and chats, so they run every 5 minutes.
  let auto = null;
  try {
    const override = Netlify.env.get('CHOWANIEC_TEST_NOW');     // only ever set in tests
    const now = override ? new Date(override) : new Date();
    if (override || now.getMinutes() % 5 === 0) auto = await runAiAuto(now);
  } catch (e) {
    console.error('AI auto jobs failed:', e.message);
  }
  return new Response(JSON.stringify({ sent, reminders, auto, nights }), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '* * * * *' };
