// Issues a Daily.co meeting token so signed-in users can join private rooms.
// Hosts (per passwords.js) join as room owners.
const { json, getUser, dailyRequest, precheck, ROOM_NAME_PATTERN } = require('../lib/common.js');

const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

exports.handler = async (event) => {
  const rejection = precheck(event);
  if (rejection) return rejection;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid request.' });
  }

  const room = typeof body.room === 'string' ? body.room.trim() : '';
  if (!ROOM_NAME_PATTERN.test(room)) {
    return json(400, { error: 'Meeting codes may only contain letters, numbers, dashes and underscores.' });
  }

  const user = getUser(event);
  const userName = (typeof body.userName === 'string' ? body.userName.trim() : '').slice(0, 40) || user.name;

  const res = await dailyRequest('/meeting-tokens', {
    properties: {
      room_name: room,
      user_name: userName,
      is_owner: !!user.host,
      exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS
    }
  });

  if (!res.ok) {
    console.error('Daily token creation failed:', res.status, await res.text());
    return json(502, { error: 'Could not authorize you for this meeting. Please try again.' });
  }

  const { token } = await res.json();
  return json(200, { token });
};
