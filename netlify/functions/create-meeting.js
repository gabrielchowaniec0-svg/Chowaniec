// Creates a Daily.co room with a generated code (e.g. "abc-defg-hij").
// Requires the DAILY_API_KEY environment variable in Netlify.
const crypto = require('crypto');
const { PASSCODE_HASHES } = require('../../passwords.js');

const ROOM_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

function generateMeetingCode() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const part = (len) => Array.from({ length: len }, () => letters[crypto.randomInt(letters.length)]).join('');
  return `${part(3)}-${part(4)}-${part(3)}`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const key = event.headers['x-chowaniec-key'];
  if (!key || !Object.prototype.hasOwnProperty.call(PASSCODE_HASHES, key)) {
    return json(401, { error: 'Please sign in again to create a meeting.' });
  }

  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'Meeting creation is not configured (missing DAILY_API_KEY).' });
  }

  // Retry on the rare chance a generated code is already taken.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateMeetingCode();
    const res = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: code,
        privacy: 'public',
        properties: { exp: Math.floor(Date.now() / 1000) + ROOM_LIFETIME_SECONDS }
      })
    });

    if (res.ok) {
      return json(200, { code });
    }

    const detail = await res.text();
    if (!(res.status === 400 && /already exists/i.test(detail))) {
      console.error('Daily room creation failed:', res.status, detail);
      return json(502, { error: 'Could not create the meeting room. Please try again.' });
    }
  }

  return json(502, { error: 'Could not generate a unique meeting code. Please try again.' });
};
