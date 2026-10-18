// Family birthdays (Netlify Blobs, store "birthdays", one blob "all"): [{ name, month, day, year? }].
// Anyone signed in can read them; only heads can change the list.
import { getStore } from '@netlify/blobs';

const store = () => getStore({ name: 'birthdays', consistency: 'strong' });

export function cleanBirthdays(input) {
  const out = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const name = String((raw && raw.name) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const month = Number(raw && raw.month);
    const day = Number(raw && raw.day);
    if (!name || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) continue;
    if (new Date(Date.UTC(2024, month - 1, day)).getUTCDate() !== day) continue;     // e.g. Feb 31
    const year = Number(raw.year);
    out.push({ name, month, day, ...(Number.isInteger(year) && year > 1900 && year < 2100 ? { year } : {}) });
    if (out.length >= 40) break;
  }
  return out;
}

export async function getBirthdays() {
  return cleanBirthdays(await store().get('all', { type: 'json' }));
}

export async function setBirthdays(list) {
  const clean = cleanBirthdays(list);
  await store().setJSON('all', clean);
  return clean;
}

// Whose birthday is on this local date (YYYY-MM-DD)?
export const birthdaysOn = (list, date) => list.filter((b) => b.month === Number(date.slice(5, 7)) && b.day === Number(date.slice(8, 10)));
