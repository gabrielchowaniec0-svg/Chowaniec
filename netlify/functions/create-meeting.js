// Creates a private Daily.co room with a generated code (e.g. "abc-defg-hij").
// Participants join it with a token from meeting-token.js.
const crypto = require('crypto');
const { json, dailyRequest, precheck } = require('../lib/common.js');

const ROOM_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
// Director + Co-Director + 4 guests
const MAX_PARTICIPANTS = 6;

function generateMeetingCode() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const part = (len) => Array.from({ length: len }, () => letters[crypto.randomInt(letters.length)]).join('');
  return `${part(3)}-${part(4)}-${part(3)}`;
}

exports.handler = async (event) => {
  const rejection = precheck(event);
  if (rejection) return rejection;

  // Retry on the rare chance a generated code is already taken.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateMeetingCode();
    const res = await dailyRequest('/rooms', {
      name: code,
      privacy: 'private',
      properties: {
        exp: Math.floor(Date.now() / 1000) + ROOM_LIFETIME_SECONDS,
        max_participants: MAX_PARTICIPANTS
      }
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
