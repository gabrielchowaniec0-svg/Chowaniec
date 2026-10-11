// Shared helpers for the Chowaniec Netlify Functions.
const { PASSCODE_HASHES } = require('../../passwords.js');

const DAILY_API = 'https://api.daily.co/v1';
const ROOM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

// Returns the signed-in user ({ name, host }) for the request's passcode hash, or null.
function getUser(event) {
  const key = event.headers['x-chowaniec-key'];
  if (!key || !Object.prototype.hasOwnProperty.call(PASSCODE_HASHES, key)) return null;
  return PASSCODE_HASHES[key];
}

// POSTs `body` to the Daily REST API, or GETs when no body is given.
function dailyRequest(path, body) {
  const options = { headers: { Authorization: `Bearer ${process.env.DAILY_API_KEY}` } };
  if (body !== undefined) {
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(`${DAILY_API}${path}`, options);
}

// Common checks for every function; returns an error response, or null to continue.
function precheck(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!getUser(event)) return json(401, { error: 'Please sign in again to join or create meetings.' });
  if (!process.env.DAILY_API_KEY) {
    return json(500, { error: 'Meetings are not configured (missing DAILY_API_KEY).' });
  }
  return null;
}

module.exports = { json, getUser, dailyRequest, precheck, ROOM_NAME_PATTERN };
