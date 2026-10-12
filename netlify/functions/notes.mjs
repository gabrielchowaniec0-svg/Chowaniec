// Chowaniec Notes API (Markdown notes saved with Netlify Blobs).
//   GET    /.netlify/functions/notes             -> { notes: [summary...] } visible to the caller
//   GET    /.netlify/functions/notes?id=<id>     -> { note, etag }
//   POST   { title, markdown, shared, source?, meetingCode? }  -> { note, etag }
//   PUT    { id, title?, markdown?, shared?, etag? }           -> { note, etag }  (409 if etag is stale)
//   DELETE /.netlify/functions/notes?id=<id>     -> { ok: true }
// Visibility: private notes are only for their owner; shared notes are for everyone signed in.
// Editing: the owner, a host, or anyone for shared notes. Deleting: the owner or a host.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import passwords from '../../passwords.js';

const { PASSCODE_HASHES } = passwords;
const ID_PATTERN = /^[a-z0-9]{12,40}$/;
const MAX_MARKDOWN = 200000;
const store = () => getStore({ name: 'notes', consistency: 'strong' });

function json(status, body) {
  return Response.json(body, { status });
}

function signedInUser(req) {
  const key = req.headers.get('x-chowaniec-key');
  return key && Object.prototype.hasOwnProperty.call(PASSCODE_HASHES, key) ? PASSCODE_HASHES[key] : null;
}

const canView = (user, note) => note.shared || note.owner === user.name;
const canEdit = (user, note) => note.owner === user.name || user.host || note.shared;
const canDelete = (user, note) => note.owner === user.name || user.host;

function summary(note) {
  const { markdown, ...rest } = note;
  return { ...rest, preview: markdown.replace(/[#>*_`|[\]-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) };
}

function cleanTitle(title) {
  return String(title || '').trim().slice(0, 200) || 'Untitled note';
}

async function readNote(id) {
  const entry = await store().getWithMetadata(`note/${id}`, { type: 'json' });
  return entry ? { note: entry.data, etag: entry.etag } : null;
}

export default async (req) => {
  const user = signedInUser(req);
  if (!user) return json(401, { error: 'Please sign in again.' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (id) {
      if (!ID_PATTERN.test(id)) return json(400, { error: 'Invalid note.' });
      const found = await readNote(id);
      if (!found || !canView(user, found.note)) return json(404, { error: 'Note not found.' });
      return json(200, found);
    }
    const { blobs } = await store().list({ prefix: 'note/' });
    const notes = (await Promise.all(blobs.map(async (b) => store().get(b.key, { type: 'json' }))))
      .filter((n) => n && canView(user, n))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summary);
    return json(200, { notes });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!ID_PATTERN.test(id)) return json(400, { error: 'Invalid note.' });
    const found = await readNote(id);
    if (!found || !canView(user, found.note)) return json(404, { error: 'Note not found.' });
    if (!canDelete(user, found.note)) return json(403, { error: 'Only the owner or a host can delete this note.' });
    await store().delete(`note/${id}`);
    return json(200, { ok: true });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { error: 'Invalid request.' });
  }
  if (typeof body.markdown === 'string' && body.markdown.length > MAX_MARKDOWN) {
    return json(413, { error: 'This note is too long to save.' });
  }

  if (req.method === 'POST') {
    const now = new Date().toISOString();
    const note = {
      id: crypto.randomBytes(12).toString('hex'),
      title: cleanTitle(body.title),
      markdown: String(body.markdown || ''),
      shared: !!body.shared,
      owner: user.name,
      source: body.source === 'agent' ? 'agent' : 'manual',
      meetingCode: /^[A-Za-z0-9_-]{1,128}$/.test(body.meetingCode || '') ? body.meetingCode : '',
      createdAt: now,
      updatedAt: now,
      updatedBy: user.name
    };
    const { etag } = await store().setJSON(`note/${note.id}`, note, { onlyIfNew: true });
    return json(200, { note, etag });
  }

  if (req.method === 'PUT') {
    const id = String(body.id || '');
    if (!ID_PATTERN.test(id)) return json(400, { error: 'Invalid note.' });
    const found = await readNote(id);
    if (!found || !canView(user, found.note)) return json(404, { error: 'Note not found.' });
    if (!canEdit(user, found.note)) return json(403, { error: 'You can\'t edit this note.' });
    if (body.etag && body.etag !== found.etag) {
      return json(409, { error: 'Someone else changed this note. Reload to see their changes.', note: found.note, etag: found.etag });
    }

    const note = {
      ...found.note,
      title: body.title !== undefined ? cleanTitle(body.title) : found.note.title,
      markdown: body.markdown !== undefined ? String(body.markdown) : found.note.markdown,
      // Only the owner or a host may change who can see a note.
      shared: body.shared !== undefined && (found.note.owner === user.name || user.host) ? !!body.shared : found.note.shared,
      updatedAt: new Date().toISOString(),
      updatedBy: user.name
    };
    const { modified, etag } = await store().setJSON(`note/${id}`, note, { onlyIfMatch: found.etag });
    if (!modified) return json(409, { error: 'Someone else changed this note. Reload to see their changes.' });
    return json(200, { note, etag });
  }

  return json(405, { error: 'Method not allowed' });
};
