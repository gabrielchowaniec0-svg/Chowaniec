// Starts a private, single-device Daily room for Live Notes on /notes.
// The browser joins it audio-only and turns on transcription with speaker separation
// (diarization), so an in-person conversation on one phone can be split by voice.
// Any signed-in family member may start one; rooms expire after 4 hours.
const crypto = require('crypto');
const { json, getUser, dailyRequest, precheck } = require('../lib/common.js');

const ROOM_LIFETIME_SECONDS = 4 * 60 * 60;

exports.handler = async (event) => {
  const rejection = precheck(event);
  if (rejection) return rejection;
  const user = getUser(event);
  const exp = Math.floor(Date.now() / 1000) + ROOM_LIFETIME_SECONDS;

  const roomRes = await dailyRequest('/rooms', {
    name: `notes-${crypto.randomBytes(8).toString('hex')}`,
    privacy: 'private',
    properties: { exp, max_participants: 2 }
  });
  if (!roomRes.ok) {
    console.error('Live notes room creation failed:', roomRes.status, await roomRes.text());
    return json(502, { error: 'Could not start live transcription. Please try again.' });
  }
  const room = await roomRes.json();

  // Owner of their own private room, so this device can start transcription.
  const tokenRes = await dailyRequest('/meeting-tokens', {
    properties: { room_name: room.name, user_name: user.name, is_owner: true, exp }
  });
  if (!tokenRes.ok) {
    console.error('Live notes token creation failed:', tokenRes.status, await tokenRes.text());
    return json(502, { error: 'Could not start live transcription. Please try again.' });
  }
  const { token } = await tokenRes.json();
  return json(200, { url: room.url, token });
};
