// Runs every minute (Netlify scheduled function): sends scheduled group messages and calendar reminders that are due.
import { deliverDue } from '../lib/group-store.mjs';
import { publishMessage } from '../lib/group-post.mjs';
import { sendDueReminders } from '../lib/calendar-store.mjs';

export default async () => {
  const sent = await deliverDue(publishMessage);
  let reminders = 0;
  try {
    reminders = await sendDueReminders();
  } catch (e) {
    console.error('Calendar reminders failed:', e.message);
  }
  return new Response(JSON.stringify({ sent, reminders }), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '* * * * *' };
