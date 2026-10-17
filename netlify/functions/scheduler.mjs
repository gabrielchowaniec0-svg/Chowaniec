// Runs every minute (Netlify scheduled function): sends scheduled group messages that are due.
import { deliverDue } from '../lib/group-store.mjs';
import { publishMessage } from '../lib/group-post.mjs';

export default async () => {
  const sent = await deliverDue(publishMessage);
  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '* * * * *' };
