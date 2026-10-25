// Family Restaurant: one shared restaurant for the whole family (Netlify Blobs store 'restaurant', record 'main').
// The server keeps the truth. Nothing "ticks" in the background: every request first catches the restaurant up to
// the present (advance), so it keeps running while nobody is looking, and everyone sees the same thing.
// All timers are absolute server times (ms), so phones only have to show countdowns.
import { getStore } from '@netlify/blobs';

export const DAY_MS = 4 * 60 * 1000;          // a restaurant day is 4 real minutes of opening hours
const CATCH_UP_MS = 15 * 60 * 1000;           // never simulate more than this in one go
const WAIT_PATIENCE = 45000;                  // a waiting party leaves after this long without a table
const THINK_MS = 4000;                        // the time a seated party takes to choose
const ORDER_PATIENCE = 65000;                 // from ordering to being served
const EAT_MS = 14000;
const MAX_WAITING = 6;
const MAX_LOG = 14;

export const DISHES = {
  fries: { name: 'Fries', price: 18, cookMs: 6000, unlock: 0 },
  salad: { name: 'Salad', price: 26, cookMs: 7000, unlock: 0 },
  soup: { name: 'Tomato soup', price: 32, cookMs: 9000, unlock: 0 },
  burger: { name: 'Burger', price: 38, cookMs: 10000, unlock: 0 },
  pasta: { name: 'Pasta', price: 55, cookMs: 12000, unlock: 300 },
  cake: { name: 'Chocolate cake', price: 70, cookMs: 10000, unlock: 600 },
  steak: { name: 'Steak', price: 90, cookMs: 16000, unlock: 900 }
};
export const STAFF = { host: 'Host seats guests', cook: 'Cook starts orders', waiter: 'Waiter serves food', busser: 'Busser clears tables' };
export const LIMITS = { tables: 12, stoves: 6, decor: 5, staff: 3 };
export const cost = {
  tables: (n) => 100 + 60 * n,
  stoves: (n) => 120 + 90 * n,
  decor: (n) => 200 * (n + 1),
  staff: (lvl) => 150 * (lvl + 1)
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = (status, message) => Object.assign(new Error(message), { status });

export function freshState(now = Date.now()) {
  return {
    v: 1, seed: Math.floor(Math.random() * 1e9), rc: 0, at: now, created: now,
    name: 'The Chowaniec Kitchen',
    cash: 100, rep: 2.5, day: 0, phase: 'closed', dayStartAt: 0, nextArrival: 0, nid: 1,
    tables: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, cust: null, dirty: false })),
    stoves: 1, decor: 0, staff: { host: 0, cook: 0, waiter: 0, busser: 0 }, auto: { host: 0, cook: 0, waiter: 0, busser: 0 },
    menu: { fries: { on: true, mult: 1 }, salad: { on: true, mult: 1 }, soup: { on: true, mult: 1 }, burger: { on: true, mult: 1 } },
    customers: [], daily: { served: 0, revenue: 0, lost: 0, tips: 0 }, summary: null,
    by: {}, crew: {}, log: [], best: { revenue: 0, day: 0 }
  };
}

// A small deterministic random stream kept inside the state, so every catch-up gives the same result.
function rand(S) {
  S.rc++;
  let a = (S.seed + S.rc * 0x9e3779b9) >>> 0;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

function log(S, t, text, kind) {
  S.log.unshift({ t, text, kind: kind || '' });
  if (S.log.length > MAX_LOG) S.log.length = MAX_LOG;
}
const credit = (S, name, what) => { if (!name) return; const b = S.by[name] || (S.by[name] = { seated: 0, cooked: 0, served: 0, cleaned: 0 }); b[what]++; };
const table = (S, id) => S.tables.find((x) => x.id === id);
const cust = (S, id) => S.customers.find((c) => c.id === id);
const priceOf = (S, dish, qty) => Math.round(DISHES[dish].price * (S.menu[dish] ? S.menu[dish].mult : 1) * qty);
const cookTime = (c) => DISHES[c.dish].cookMs * (1 + 0.35 * (c.size - 1));
const onMenu = (S) => Object.keys(S.menu).filter((d) => S.menu[d].on);

function changeRep(S, d) { S.rep = clamp(S.rep + d, 0.5, 5); }

function removeCustomer(S, c, leaveTable) {
  S.customers = S.customers.filter((x) => x !== c);
  if (c.table) { const tb = table(S, c.table); if (tb && tb.cust === c.id) { tb.cust = null; tb.dirty = !!leaveTable; } }
}

// ---------- The actions (used by people and by hired staff) ----------
function doSeat(S, t, c, tb, who) {
  if (!c || c.state !== 'waiting') throw err(409, 'That party is not waiting any more.');
  if (!tb) { tb = S.tables.find((x) => !x.cust && !x.dirty); if (!tb) throw err(409, 'There is no free table. Clear a dirty one or wait.'); }
  if (tb.cust || tb.dirty) throw err(409, tb.dirty ? 'That table needs clearing first.' : 'That table is taken.');
  tb.cust = c.id; c.table = tb.id; c.state = 'thinking'; c.until = t + THINK_MS;
  credit(S, who, 'seated');
  return tb;
}
function doCook(S, t, c, who) {
  if (!c || c.state !== 'ordered') throw err(409, 'That order is not waiting to be cooked.');
  const busy = S.customers.filter((x) => x.state === 'cooking').length;
  if (busy >= S.stoves) throw err(409, 'Every stove is busy. Wait for a dish to finish.');
  c.state = 'cooking'; c.cookDone = t + cookTime(c);
  credit(S, who, 'cooked');
}
function doServe(S, t, c, who) {
  if (!c || c.state !== 'ready') throw err(409, 'That dish is not ready yet.');
  c.state = 'eating'; c.eatDone = t + EAT_MS;
  c.sat = clamp((c.until - t) / ORDER_PATIENCE, 0, 1);
  credit(S, who, 'served');
}
function doClean(S, tb, who) {
  if (!tb || !tb.dirty) throw err(409, 'That table is already clean.');
  tb.dirty = false; credit(S, who, 'cleaned');
}

// ---------- One second of restaurant life ----------
function step(S, t) {
  if (S.phase === 'open' && t - S.dayStartAt >= DAY_MS) { S.phase = 'closing'; log(S, t, 'Closing time. Finishing the last orders.', 'info'); }
  if (S.phase === 'open' && t >= S.nextArrival) {
    const interval = clamp(11000 - S.rep * 1000 - S.decor * 600, 3800, 12000);
    S.nextArrival = t + interval * (0.6 + rand(S) * 0.8);
    const waiting = S.customers.filter((c) => c.state === 'waiting').length;
    if (waiting >= MAX_WAITING) { S.daily.lost++; changeRep(S, -0.03); }
    else {
      const menu = onMenu(S);
      const dish = menu[Math.floor(rand(S) * menu.length)];
      const size = 1 + Math.floor(rand(S) * rand(S) * 3.2);
      S.customers.push({ id: S.nid++, size, dish, state: 'waiting', table: null, until: t + WAIT_PATIENCE, look: Math.floor(rand(S) * 8), arrived: t });
    }
  }
  for (const c of S.customers.slice()) {
    if (c.state === 'waiting' && t >= c.until) { S.daily.lost++; changeRep(S, -0.12); removeCustomer(S, c, false); log(S, t, 'A party gave up waiting for a table.', 'bad'); }
    else if (c.state === 'thinking' && t >= c.until) { c.state = 'ordered'; c.until = t + ORDER_PATIENCE; }
    else if ((c.state === 'ordered' || c.state === 'cooking' || c.state === 'ready') && t >= c.until) {
      S.daily.lost++; changeRep(S, -0.18); removeCustomer(S, c, false);
      log(S, t, `Guests left angry without their ${DISHES[c.dish].name.toLowerCase()}.`, 'bad');
    } else if (c.state === 'cooking' && t >= c.cookDone) { c.state = 'ready'; }
    else if (c.state === 'eating' && t >= c.eatDone) {
      const base = priceOf(S, c.dish, c.size);
      const tip = Math.round(base * 0.3 * c.sat);
      S.cash += base + tip; S.daily.revenue += base + tip; S.daily.tips += tip; S.daily.served++;
      const mult = S.menu[c.dish] ? S.menu[c.dish].mult : 1;
      changeRep(S, (c.sat - 0.4) * 0.09 - Math.max(0, mult - 1) * 0.05);
      log(S, t, `Paid $${base + tip}${tip ? ` (tip $${tip})` : ''} for ${c.size > 1 ? c.size + ' × ' : ''}${DISHES[c.dish].name.toLowerCase()}.`, 'good');
      removeCustomer(S, c, true);
    }
  }
  // hired staff do the boring parts
  for (const role of Object.keys(STAFF)) {
    const lvl = S.staff[role];
    if (!lvl || t < S.auto[role]) continue;
    try {
      if (role === 'host') { const c = S.customers.find((x) => x.state === 'waiting'); if (c) doSeat(S, t, c, null, null); else continue; }
      else if (role === 'cook') { const c = S.customers.find((x) => x.state === 'ordered'); if (c) doCook(S, t, c, null); else continue; }
      else if (role === 'waiter') { const c = S.customers.find((x) => x.state === 'ready'); if (c) doServe(S, t, c, null); else continue; }
      else { const tb = S.tables.find((x) => x.dirty); if (tb) doClean(S, tb, null); else continue; }
      S.auto[role] = t + 15000 - 3500 * lvl;
    } catch (e) { S.auto[role] = t + 2000; }
  }
  if (S.phase === 'closing' && !S.customers.length) {
    S.phase = 'closed';
    S.summary = { day: S.day, ...S.daily, rep: Math.round(S.rep * 10) / 10 };
    if (S.daily.revenue > S.best.revenue) S.best = { revenue: S.daily.revenue, day: S.day };
    log(S, t, `Day ${S.day} is over: $${S.daily.revenue} earned, ${S.daily.served} served.`, 'info');
  }
}

export function advance(S, now) {
  let t = S.at;
  const end = Math.min(now, t + CATCH_UP_MS);
  if (end <= t) return S;
  while (t + 1000 <= end) { t += 1000; step(S, t); }
  S.at = t;
  if (now - end > 0) S.at = now;     // a very long absence: skip the rest of the gap
  return S;
}

// ---------- Player actions ----------
export function apply(S, name, body, now) {
  advance(S, now);
  const t = S.at;
  const a = String(body.action || '');
  const num = (v) => Number(v) | 0;
  switch (a) {
    case 'hello': S.crew[name] = { at: now, role: String(body.role || '').slice(0, 12) }; return S;
    case 'seat': { const c = cust(S, num(body.cust)); const tb = body.table ? table(S, num(body.table)) : null; const used = doSeat(S, t, c, tb, name); log(S, t, `${name} seated a party at table ${used.id}.`); break; }
    case 'cook': doCook(S, t, cust(S, num(body.cust)), name); break;
    case 'serve': doServe(S, t, cust(S, num(body.cust)), name); break;
    case 'clean': doClean(S, table(S, num(body.table)), name); break;
    case 'open': {
      if (S.phase !== 'closed') throw err(409, 'The restaurant is already open.');
      S.day++; S.phase = 'open'; S.dayStartAt = t; S.nextArrival = t + 2500; S.daily = { served: 0, revenue: 0, lost: 0, tips: 0 }; S.summary = null;
      log(S, t, `${name} opened the doors for day ${S.day}.`, 'info'); break;
    }
    case 'buy': {
      const what = String(body.what || '');
      const spend = (c) => { if (S.cash < c) throw err(409, `You need $${c}. You have $${S.cash}.`); S.cash -= c; };
      if (what === 'table') { if (S.tables.length >= LIMITS.tables) throw err(409, 'That is the biggest dining room.'); spend(cost.tables(S.tables.length)); S.tables.push({ id: S.tables.length + 1, cust: null, dirty: false }); log(S, t, `${name} added table ${S.tables.length}.`, 'info'); }
      else if (what === 'stove') { if (S.stoves >= LIMITS.stoves) throw err(409, 'The kitchen is full.'); spend(cost.stoves(S.stoves)); S.stoves++; log(S, t, `${name} bought stove ${S.stoves}.`, 'info'); }
      else if (what === 'decor') { if (S.decor >= LIMITS.decor) throw err(409, 'It is already gorgeous.'); spend(cost.decor(S.decor)); S.decor++; log(S, t, `${name} redecorated. More guests will come.`, 'info'); }
      else if (what.startsWith('staff:')) {
        const role = what.slice(6); if (!STAFF[role]) throw err(400, 'Unknown job.');
        if (S.staff[role] >= LIMITS.staff) throw err(409, 'They are fully trained.');
        spend(cost.staff(S.staff[role])); S.staff[role]++; S.auto[role] = t + 3000;
        log(S, t, `${name} ${S.staff[role] === 1 ? 'hired a' : 'trained the'} ${role}.`, 'info');
      } else if (what.startsWith('dish:')) {
        const d = what.slice(5); if (!DISHES[d] || S.menu[d]) throw err(409, 'You already have that dish.');
        spend(DISHES[d].unlock); S.menu[d] = { on: true, mult: 1 }; log(S, t, `${name} added ${DISHES[d].name.toLowerCase()} to the menu.`, 'info');
      } else throw err(400, 'Unknown purchase.');
      break;
    }
    case 'menu': {
      const d = String(body.dish || ''); const m = S.menu[d]; if (!m) throw err(400, 'Unknown dish.');
      if (body.mult != null) m.mult = clamp(Math.round(Number(body.mult) * 20) / 20, 0.6, 1.6);
      if (body.on != null) { m.on = !!body.on; if (!onMenu(S).length) { m.on = true; throw err(409, 'Keep at least one dish on the menu.'); } }
      break;
    }
    case 'rename': { const n = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 28); if (!n) throw err(400, 'Give it a name.'); S.name = n; break; }
    default: throw err(400, 'Unknown action.');
  }
  S.v++;
  return S;
}

// The version of the state that goes to phones.
export function view(S, name, now) {
  const crew = Object.entries(S.crew).filter(([, c]) => now - c.at < 70000).map(([n, c]) => ({ name: n, role: c.role }));
  return {
    now, v: S.v, name: S.name, cash: S.cash, rep: Math.round(S.rep * 100) / 100, day: S.day, phase: S.phase, dayStartAt: S.dayStartAt, dayMs: DAY_MS,
    tables: S.tables, stoves: S.stoves, decor: S.decor, staff: S.staff, menu: S.menu, customers: S.customers, daily: S.daily, summary: S.summary,
    by: S.by, crew, log: S.log, best: S.best, me: name,
    shop: { tables: S.tables.length < LIMITS.tables ? cost.tables(S.tables.length) : null, stoves: S.stoves < LIMITS.stoves ? cost.stoves(S.stoves) : null,
      decor: S.decor < LIMITS.decor ? cost.decor(S.decor) : null, staff: Object.fromEntries(Object.keys(STAFF).map((r) => [r, S.staff[r] < LIMITS.staff ? cost.staff(S.staff[r]) : null])) },
    dishes: Object.fromEntries(Object.entries(DISHES).map(([id, d]) => [id, { name: d.name, price: d.price, cookMs: d.cookMs, unlock: d.unlock }]))
  };
}

// ---------- Storage ----------
const store = () => getStore({ name: 'restaurant', consistency: 'strong' });
const KEY = 'main';

export async function load() {
  const entry = await store().getWithMetadata(KEY, { type: 'json' });
  if (entry && entry.data) return { S: entry.data, etag: entry.etag };
  return { S: freshState(), etag: null };
}
export async function save(S, etag) {
  const r = etag ? await store().setJSON(KEY, S, { onlyIfMatch: etag }) : await store().setJSON(KEY, S, { onlyIfNew: true });
  return !!r.modified;
}

// Run one change with a few retries if two people press at the same moment.
export async function mutate(name, body, now = Date.now()) {
  for (let i = 0; i < 6; i++) {
    const { S, etag } = await load();
    apply(S, name, body, now);
    if (await save(S, etag)) return S;
  }
  throw err(409, 'The restaurant was busy. Try again.');
}

// A look at the present. Saves the catch-up when something happened, but never fails if it loses a race.
export async function peek(now = Date.now()) {
  const { S, etag } = await load();
  const before = JSON.stringify([S.cash, S.customers.length, S.phase, S.log[0] && S.log[0].t, S.customers.map((c) => c.state).join()]);
  advance(S, now);
  const after = JSON.stringify([S.cash, S.customers.length, S.phase, S.log[0] && S.log[0].t, S.customers.map((c) => c.state).join()]);
  if (before !== after || !etag) { try { await save(S, etag); } catch (e) { /* someone else saved first: fine */ } }
  return S;
}
