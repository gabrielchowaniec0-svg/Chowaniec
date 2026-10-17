// Chowaniec Notes storage and permission rules (shared by the notes API and the AI agent).
// Who can see a note: its owner, everyone (shared), or only the people listed in `sharedWith`.
// Editing: anyone who can see it, unless `lockEdit` is on (then only the owner or a host).
// Checking off checklist items: anyone who can see it, unless `lockCheck` is on (owner or host only).
// Deleting / changing sharing and locks: owner or host.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { familyNames } from './auth.mjs';

export const ID_PATTERN = /^[a-z0-9]{12,40}$/;
export const MAX_MARKDOWN = 200000;
export const store = () => getStore({ name: 'notes', consistency: 'strong' });

const sharedWith = (note) => (Array.isArray(note.sharedWith) ? note.sharedWith : []);
export const isPrivileged = (user, note) => note.owner === user.name || !!user.host;
export const canView = (user, note) => !!note.shared || note.owner === user.name || sharedWith(note).includes(user.name);
export const canEdit = (user, note) => canView(user, note) && (isPrivileged(user, note) || !note.lockEdit);
export const canCheck = (user, note) => canView(user, note) && (isPrivileged(user, note) || !note.lockCheck);
export const canDelete = (user, note) => note.owner === user.name || user.host;
export const canShare = (user, note) => note.owner === user.name || user.host;

// Checklist lines ("- [ ] text" / "- [x] text"), ignoring anything inside fenced code blocks.
export function taskItems(markdown) {
  const items = [];
  let fence = null;
  String(markdown || '').split('\n').forEach((line, lineNo) => {
    const f = line.match(/^\s*(```|~~~)/);
    if (f) { fence = fence === f[1] ? null : fence || f[1]; return; }
    if (fence) return;
    const m = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s?)(.*)$/);
    if (m) items.push({ lineNo, checked: m[2] !== ' ', text: m[4].trim(), head: m[1], tail: m[3], rest: m[4] });
  });
  return items;
}

// For people who may not check items off: their edit may add unchecked items and change text, but
// every item that already existed must keep its checked state.
export function checkStatesPreserved(oldMarkdown, newMarkdown) {
  const before = new Map();
  taskItems(oldMarkdown).forEach((i) => { before.set(i.text, [...(before.get(i.text) || []), i.checked]); });
  const used = new Map();
  for (const item of taskItems(newMarkdown)) {
    const states = before.get(item.text);
    if (!states) { if (item.checked) return false; continue; }   // brand-new item must start unchecked
    const n = used.get(item.text) || 0;
    used.set(item.text, n + 1);
    if (n < states.length && states[n] !== item.checked) return false;
    if (n >= states.length && item.checked) return false;
  }
  return true;
}

export function summary(note) {
  const { markdown, ...rest } = note;
  const tasks = taskItems(markdown);
  return { ...rest, tasks: { done: tasks.filter((t) => t.checked).length, total: tasks.length }, preview: markdown.replace(/[#>*_`|[\]-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) };
}

export function cleanTitle(title) {
  return String(title || '').trim().slice(0, 200) || 'Untitled note';
}

// Only real family members, not the owner, no repeats.
export function cleanPeople(list, ownerName) {
  const family = familyNames();
  return [...new Set((Array.isArray(list) ? list : []).filter((n) => typeof n === 'string' && family.includes(n) && n !== ownerName))];
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
    sharedWith: cleanPeople(fields.sharedWith, user.name),
    lockEdit: !!fields.lockEdit,
    lockCheck: !!fields.lockCheck,
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

// Applies `changes` ({ title?, markdown?, shared?, sharedWith?, lockEdit?, lockCheck? }) if `etag`
// still matches. Sharing and locks are only changed by the owner or a host. Returns { note, etag },
// { conflict: true } or { error }.
export async function writeNote(user, found, changes) {
  const old = found.note;
  const markdown = changes.markdown !== undefined ? String(changes.markdown) : old.markdown;
  if (markdown !== old.markdown && old.lockCheck && !isPrivileged(user, old) && !checkStatesPreserved(old.markdown, markdown)) {
    return { error: 'Checking items off is locked on this note.', status: 403 };
  }
  const may = canShare(user, old);
  const note = {
    ...old,
    title: changes.title !== undefined ? cleanTitle(changes.title) : old.title,
    markdown,
    shared: changes.shared !== undefined && may ? !!changes.shared : old.shared,
    sharedWith: changes.sharedWith !== undefined && may ? cleanPeople(changes.sharedWith, old.owner) : sharedWith(old),
    lockEdit: changes.lockEdit !== undefined && may ? !!changes.lockEdit : !!old.lockEdit,
    lockCheck: changes.lockCheck !== undefined && may ? !!changes.lockCheck : !!old.lockCheck,
    updatedAt: new Date().toISOString(),
    updatedBy: user.name
  };
  const { modified, etag } = await store().setJSON(`note/${note.id}`, note, { onlyIfMatch: found.etag });
  return modified ? { note, etag } : { conflict: true };
}

// Ticks or un-ticks one checklist item (the `index`-th "- [ ]" line). `text` guards against the note
// having been reordered meanwhile. Retries when someone else saves at the same moment.
export async function toggleTask(user, id, { index, checked, text }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await readNote(id);
    if (!found || !canView(user, found.note)) return { status: 404, error: 'Note not found.' };
    if (!canCheck(user, found.note)) return { status: 403, error: 'Checking items off is locked on this note.' };
    const items = taskItems(found.note.markdown);
    const item = items[index];
    if (!item || (typeof text === 'string' && item.text !== text.trim())) {
      return { status: 409, error: 'This list just changed. Reloading it.', note: found.note, etag: found.etag };
    }
    if (item.checked === !!checked) return found;               // already in that state
    const lines = found.note.markdown.split('\n');
    lines[item.lineNo] = `${item.head}${checked ? 'x' : ' '}${item.tail}${item.rest}`;
    const note = { ...found.note, markdown: lines.join('\n'), updatedAt: new Date().toISOString(), updatedBy: user.name };
    const { modified, etag } = await store().setJSON(`note/${id}`, note, { onlyIfMatch: found.etag });
    if (modified) return { note, etag };
  }
  return { status: 409, error: 'Someone else is editing this note. Try again.' };
}
