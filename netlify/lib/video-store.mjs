// Chat videos (Netlify Blobs store 'group-video'). A single function request or response can't carry more
// than about 6 MB, so videos go up in 3 MB parts and are played back with range requests, at most one part
// per response (browsers ask for the next range by themselves).
//   up/<uploadId>        { user, room, size, type, duration, width, height, parts, createdAt }  an upload in progress
//   v/<videoId>/meta     { size, type, room, parts, duration, width, height, by, createdAt }
//   v/<videoId>/<n>      bytes of part n (n = 0..parts-1)
// The upload id becomes the video id once every part has arrived.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { isHostName } from './auth.mjs';

export const PART_BYTES = 3 * 1024 * 1024;
const TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const ID = /^[a-f0-9]{24}$/;
const UPLOAD_TTL_MS = 6 * 60 * 60 * 1000;

const store = () => getStore({ name: 'group-video', consistency: 'strong' });
const err = (status, message) => Object.assign(new Error(message), { status });
export const isVideoId = (id) => ID.test(id || '');

// Family heads (Gabriel, Victoria, Nicole) can send longer videos.
export function videoLimits(name) {
  return isHostName(name)
    ? { seconds: 10 * 60, bytes: 1024 * 1024 * 1024 }
    : { seconds: 2 * 60, bytes: 300 * 1024 * 1024 };
}

const fmtMin = (s) => (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} minute${s === 60 ? '' : 's'}`);

export async function startUpload(user, room, { size, type, duration, width, height }) {
  const limits = videoLimits(user);
  const bytes = Math.floor(Number(size));
  const seconds = Number(duration);
  const kind = String(type || '').toLowerCase().split(';')[0];
  if (!TYPES.includes(kind)) throw err(400, 'Videos must be MP4, MOV or WebM.');
  if (!(seconds > 0)) throw err(400, 'That video couldn’t be read.');
  if (seconds > limits.seconds + 0.5) throw err(413, `Videos can be up to ${fmtMin(limits.seconds)} long.`);
  if (!(bytes > 0)) throw err(400, 'That video is empty.');
  if (bytes > limits.bytes) throw err(413, `That video is too large (max ${Math.round(limits.bytes / 1024 / 1024)} MB).`);
  const id = crypto.randomBytes(12).toString('hex');
  const upload = {
    user, room, size: bytes, type: kind, duration: Math.round(seconds * 10) / 10,
    width: Math.max(0, Math.round(Number(width) || 0)), height: Math.max(0, Math.round(Number(height) || 0)),
    parts: Math.ceil(bytes / PART_BYTES), createdAt: new Date().toISOString()
  };
  await store().setJSON(`up/${id}`, upload);
  return { id, partBytes: PART_BYTES, parts: upload.parts };
}

async function readUpload(user, id) {
  if (!isVideoId(id)) throw err(400, 'Invalid upload.');
  const upload = await store().get(`up/${id}`, { type: 'json' });
  if (!upload || upload.user !== user || Date.now() - Date.parse(upload.createdAt) > UPLOAD_TTL_MS) throw err(404, 'That upload expired. Please try again.');
  return upload;
}

export async function putPart(user, id, n, bytes) {
  const upload = await readUpload(user, id);
  const part = Number(n);
  if (!Number.isInteger(part) || part < 0 || part >= upload.parts) throw err(400, 'Invalid part.');
  const expected = part === upload.parts - 1 ? upload.size - PART_BYTES * part : PART_BYTES;
  if (bytes.byteLength !== expected) throw err(400, `That part is the wrong size (${bytes.byteLength}, expected ${expected}).`);
  await store().set(`v/${id}/${part}`, bytes);
}

// Checks every part arrived, turns the upload into a video and returns its details for the message.
export async function finishUpload(user, id, room) {
  const upload = await readUpload(user, id);
  if (upload.room !== room) throw err(400, 'That video was started in a different chat.');
  const { blobs } = await store().list({ prefix: `v/${id}/` });
  const have = new Set(blobs.map((b) => b.key.split('/').pop()));
  for (let i = 0; i < upload.parts; i++) if (!have.has(String(i))) throw err(400, 'Part of the video is missing. Please try again.');
  const meta = { size: upload.size, type: upload.type, room: upload.room, parts: upload.parts, duration: upload.duration, width: upload.width, height: upload.height, by: user, createdAt: new Date().toISOString() };
  await store().setJSON(`v/${id}/meta`, meta);
  await store().delete(`up/${id}`);
  return { id, duration: meta.duration, width: meta.width, height: meta.height, size: meta.size, type: meta.type };
}

export async function videoMeta(id) {
  if (!isVideoId(id)) return null;
  return store().get(`v/${id}/meta`, { type: 'json' });
}

// The bytes for a range request, trimmed to a single part. Returns { status, headers, body }.
export async function videoRange(meta, id, rangeHeader) {
  const size = meta.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  let from = 0;
  let to = size - 1;
  if (m && (m[1] || m[2])) {
    if (m[1]) { from = Number(m[1]); if (m[2]) to = Number(m[2]); }
    else from = Math.max(0, size - Number(m[2]));
  }
  to = Math.min(to, size - 1);
  if (from > to || from >= size) return { status: 416, headers: { 'Content-Range': `bytes */${size}` }, body: null };
  const part = Math.floor(from / PART_BYTES);
  to = Math.min(to, (part + 1) * PART_BYTES - 1);
  const bytes = await store().get(`v/${id}/${part}`, { type: 'arrayBuffer' });
  if (!bytes) return { status: 404, headers: {}, body: null };
  const offset = from - part * PART_BYTES;
  return {
    status: 206,
    headers: {
      'Content-Type': meta.type === 'video/quicktime' ? 'video/mp4' : meta.type,
      'Content-Range': `bytes ${from}-${to}/${size}`,
      'Content-Length': String(to - from + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000, immutable'
    },
    body: bytes.slice(offset, offset + (to - from + 1))
  };
}

export async function deleteVideo(id) {
  if (!isVideoId(id)) return;
  const { blobs } = await store().list({ prefix: `v/${id}/` });
  await Promise.all(blobs.map((b) => store().delete(b.key)));
}

// Uploads that were never finished (for the hourly sweep).
export async function sweepUploads() {
  const { blobs } = await store().list({ prefix: 'up/' });
  for (const b of blobs) {
    const up = await store().get(b.key, { type: 'json' });
    if (up && Date.now() - Date.parse(up.createdAt) < UPLOAD_TTL_MS) continue;
    const id = b.key.split('/')[1];
    await deleteVideo(id);
    await store().delete(b.key);
  }
}
