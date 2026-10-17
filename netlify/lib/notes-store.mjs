// Chowaniec Notes storage and permission rules (shared by the notes API and the AI agent).
// Private notes are visible only to their owner; shared notes to everyone signed in.
// Editing: owner, host, or anyone for shared notes. Deleting / changing sharing: owner or host.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export const ID_PATTERN = /^[a-z0-9]{12,40}$/;
export const MAX_MARKDOWN = 200000;
export const store = () => getStore({ name: 'notes', consistency: 'strong' });

export const canView = (user, note) => note.shared || note.owner === user.name;
export const canEdit = (user, note) => note.owner === user.name || user.host || note.shared;
export const canDelete = (user, note) => note.owner === user.name || user.host;
export const canShare = (user, note) => note.owner === user.name || user.host;

export function summary(note) {
  const { markdown, ...rest } = note;
  return { ...rest, preview: markdown.replace(/[#>*_`|[\]-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) };
}

export function cleanTitle(title) {
  return String(title || '').trim().slice(0, 200) || 'Untitled note';
}

export async function readNote(id) {
  if (!ID_PATTERN.test(id || '')) return null;
  const entry = await store().getWithMetadata(`note/${id}`, { type: 'json' });
  return entry ? { note: entry.data, etag: entry.etag } : null;
}

export async function listVisible(user) {
  const { blobs } = await store().list({ prefix: 'note/' });
  return (await Promise.all(blobs.map((b) => store().get(b.key, { type: 'json' }))))
    .filter((n) => n && canView(user, n))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createNote(user, fields) {
  const now = new Date().toISOString();
  const note = {
    id: crypto.randomBytes(12).toString('hex'),
    title: cleanTitle(fields.title),
    markdown: String(fields.markdown || '').slice(0, MAX_MARKDOWN),
    shared: !!fields.shared,
    owner: user.name,
    source: ['agent', 'ai'].includes(fields.source) ? fields.source : 'manual',
    meetingCode: /^[A-Za-z0-9_-]{1,128}$/.test(fields.meetingCode || '') ? fields.meetingCode : '',
    createdAt: now,
    updatedAt: now,
    updatedBy: user.name
  };
  const { etag } = await store().setJSON(`note/${note.id}`, note, { onlyIfNew: true });
  return { note, etag };
}

// Applies `changes` ({ title?, markdown?, shared? }) if `etag` still matches. Returns
// { note, etag } or { conflict: true }.
export async function writeNote(user, found, changes) {
  const note = {
    ...found.note,
    title: changes.title !== undefined ? cleanTitle(changes.title) : found.note.title,
    markdown: changes.markdown !== undefined ? String(changes.markdown) : found.note.markdown,
    shared: changes.shared !== undefined && canShare(user, found.note) ? !!changes.shared : found.note.shared,
    updatedAt: new Date().toISOString(),
    updatedBy: user.name
  };
  const { modified, etag } = await store().setJSON(`note/${note.id}`, note, { onlyIfMatch: found.etag });
  return modified ? { note, etag } : { conflict: true };
}
