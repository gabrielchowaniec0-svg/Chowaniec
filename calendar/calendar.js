// Chowaniec Calendar: month view, a list of what's coming up, and add/edit/delete.
(function () {
    'use strict';
    const API = '/.netlify/functions/calendar';
    const $ = (id) => document.getElementById(id);
    const state = { user: null, today: null, month: null, selected: null, events: [], rooms: [], editing: null, flash: null };

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const icons = () => { try { window.lucide && window.lucide.createIcons(); } catch (e) { /* ignore */ } };
    const getUser = () => (typeof window.getChowaniecUser === 'function' ? window.getChowaniecUser() : null);

    function toast(msg) {
        const t = $('toast');
        t.textContent = msg;
        t.classList.remove('gone');
        clearTimeout(toast.t);
        toast.t = setTimeout(() => t.classList.add('gone'), 3200);
    }

    async function api(url, opts) {
        const o = opts || {};
        const user = getUser();
        if (!user || !user.key) { $('signin-modal').classList.remove('gone'); throw new Error('Please sign in again.'); }
        const headers = { 'X-Chowaniec-Key': user.key };
        if (o.body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetch(url, { method: o.method || 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, cache: 'no-store' });
        } catch (e) { throw new Error('Could not reach the server. Check your connection.'); }
        let data = {};
        try { data = await res.json(); } catch (e) { data = {}; }
        if (res.status === 401) { $('signin-modal').classList.remove('gone'); throw new Error('Please sign in again.'); }
        if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
        return data;
    }

    // ---- dates (all plain YYYY-MM-DD strings, the family's local days) ----
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
    const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m: m - 1, d }; };
    const dow = (s) => new Date(`${s}T12:00:00Z`).getUTCDay();
    const monthName = (y, m) => new Date(Date.UTC(y, m, 1, 12)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const dayLabel = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const timeLabel = (t) => { if (!t) return 'All day'; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
    const whenLabel = (e) => (e.time ? `${timeLabel(e.time)}${e.endTime ? ` – ${timeLabel(e.endTime)}` : ''}` : 'All day');
    const roomName = (id) => { const r = state.rooms.find((x) => x.id === id); return r ? r.name : ''; };

    function monthRange() {
        const { y, m } = state.month;
        const first = ymd(y, m, 1);
        const start = new Date(`${first}T12:00:00Z`);
        start.setUTCDate(1 - start.getUTCDay());
        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + 41);
        return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
    }

    async function load() {
        const { from, to } = monthRange();
        const upcomingEnd = new Date(`${state.today}T12:00:00Z`);
        upcomingEnd.setUTCDate(upcomingEnd.getUTCDate() + 60);
        const hi = upcomingEnd.toISOString().slice(0, 10) > to ? upcomingEnd.toISOString().slice(0, 10) : to;
        const lo = from < state.today ? from : state.today;
        const data = await api(`${API}?from=${lo}&to=${hi}`);
        state.events = data.events || [];
        state.today = data.today || state.today;
    }

    // ---- birthdays (from Settings > Birthdays) show up as all-day entries and a countdown ----
    function birthdayEvents() {
        const out = [];
        const { from } = monthRange();
        const start = new Date(`${from}T12:00:00Z`).getUTCFullYear();
        (state.bdays || []).forEach((b) => {
            [start, start + 1].forEach((yr) => {
                const date = ymd(yr, b.month - 1, b.day);
                out.push({ id: `bday-${b.name}-${date}`, virtual: true, title: `🎂 ${b.name}’s birthday`, date, time: null, room: 'everyone', turns: b.year ? yr - b.year : null });
            });
        });
        return out;
    }
    const allEvents = () => state.events.concat(birthdayEvents().filter((b) => !state.events.some((e) => e.id === b.id)));

    function renderBirthdayStrip() {
        const el = $('bday-strip');
        if (!el) return;
        const P = window.ChowaniecPolish;
        const soon = (state.bdays || []).map((b) => ({ b, d: P ? P.daysUntil(b, new Date(`${state.today}T12:00:00`)) : 999 })).filter((x) => x.d <= 45).sort((a, b) => a.d - b.d).slice(0, 3);
        el.classList.toggle('gone', !soon.length);
        el.innerHTML = soon.map(({ b, d }) => `<span class="bd-chip" aria-label="${esc(b.name)}’s birthday ${d === 0 ? 'is today' : d === 1 ? 'is tomorrow' : `is in ${d} days`}">🎂 ${esc(b.name)} <b>${d === 0 ? 'today!' : d === 1 ? 'tomorrow' : `in ${d} days`}</b></span>`).join('');
    }

    function render() {
        const { y, m } = state.month;
        $('month-title').textContent = monthName(y, m);
        const { from } = monthRange();
        const byDay = {};
        allEvents().forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
        let html = '';
        const cur = new Date(`${from}T12:00:00Z`);
        for (let i = 0; i < 42; i++) {
            const s = cur.toISOString().slice(0, 10);
            const p = parse(s);
            const n = (byDay[s] || []).length;
            const cls = ['day', p.m !== m ? 'other' : '', s === state.today ? 'today' : '', s === state.selected ? 'sel' : ''].filter(Boolean).join(' ');
            html += `<button type="button" class="${cls}" data-day="${s}" aria-label="${esc(dayLabel(s))}${n ? `, ${n} event${n > 1 ? 's' : ''}` : ''}"><span>${p.d}</span><span class="dots">${'<i class="dot"></i>'.repeat(Math.min(n, 3))}</span></button>`;
            cur.setUTCDate(cur.getUTCDate() + 1);
        }
        $('grid').innerHTML = html;
        renderBirthdayStrip();
        renderList();
    }

    function rsvpHtml(e) {
        const r = e.rsvp || {};
        const mine = state.user && r[state.user.name];
        const names = (k) => Object.keys(r).filter((n) => r[n] === k);
        const parts = [];
        if (names('going').length) parts.push(`Going: ${names('going').map(esc).join(', ')}`);
        if (names('maybe').length) parts.push(`Maybe: ${names('maybe').map(esc).join(', ')}`);
        if (names('no').length) parts.push(`Can’t: ${names('no').map(esc).join(', ')}`);
        const btn = (k, label) => `<button type="button" class="rsvp-btn${mine === k ? ' on' : ''}" data-rsvp="${k}" data-eid="${esc(e.id)}" aria-pressed="${mine === k}">${label}</button>`;
        return `<div class="rsvp"><div class="rsvp-row">${btn('going', 'Going')}${btn('maybe', 'Maybe')}${btn('no', 'Can’t go')}</div>${parts.length ? `<div class="rsvp-who">${parts.join(' · ')}</div>` : ''}</div>`;
    }

    // Rehearsal call sheet: on the day of an event, everyone taps "On my way" / "I'm here".
    function callSheetHtml(e) {
        if (e.date !== state.today || !e.time) return '';
        const room = state.rooms.find((r) => r.id === e.room);
        const members = (room && room.members) || [];
        const c = e.checkins || {};
        const mine = state.user && c[state.user.name] && c[state.user.name].status;
        const names = (k) => Object.keys(c).filter((n) => c[n].status === k);
        const waiting = members.filter((n) => !c[n] && (!e.rsvp || e.rsvp[n] !== 'no'));
        const btn = (k, label) => `<button type="button" class="rsvp-btn${mine === k ? ' on' : ''}" data-checkin="${k}" data-eid="${esc(e.id)}" aria-pressed="${mine === k}">${label}</button>`;
        const parts = [];
        if (names('here').length) parts.push(`✅ Here: ${names('here').map(esc).join(', ')}`);
        if (names('onway').length) parts.push(`🚗 On the way: ${names('onway').map(esc).join(', ')}`);
        if (waiting.length) parts.push(`⏳ Not yet: ${waiting.map(esc).join(', ')}`);
        return `<div class="rsvp callsheet" role="group" aria-label="Call sheet for ${esc(e.title)}"><div class="rsvp-who" style="font-weight:600;margin-bottom:6px">Call sheet · today</div><div class="rsvp-row">${btn('onway', 'On my way')}${btn('here', 'I’m here')}</div>${parts.length ? `<div class="rsvp-who" style="margin-top:6px">${parts.join('<br>')}</div>` : ''}</div>`;
    }

    function eventCard(e) {
        if (e.virtual) {
            return `<div class="ev-wrap"><div class="ev bday" role="note"><div class="font-medium text-[15px]">${esc(e.title)}</div><div class="text-xs text-gray-500 mt-0.5">All day${e.turns ? ` · turns ${e.turns}` : ''}</div></div></div>`;
        }
        return `<div class="ev-wrap">${eventCardInner(e)}${rsvpHtml(e)}${callSheetHtml(e)}</div>`;
    }

    function eventCardInner(e) {
        return `<button type="button" class="ev${state.flash === e.id ? ' flash' : ''}" data-id="${esc(e.id)}">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0"><div class="font-medium text-[15px] truncate">${esc(e.title)}</div>
                <div class="text-xs text-gray-500 mt-0.5">${esc(whenLabel(e))}${e.location ? ` · ${esc(e.location)}` : ''}</div></div>
                <span class="shrink-0 text-[10px] font-mono uppercase tracking-widest text-gray-400 mt-1">${esc(roomName(e.room))}</span>
            </div>${e.notes ? `<div class="text-xs text-gray-400 mt-2 line-clamp-2">${esc(e.notes)}</div>` : ''}</button>`;
    }

    function renderList() {
        const list = $('list');
        let items;
        if (state.selected) {
            $('list-title').textContent = dayLabel(state.selected);
            $('show-upcoming').classList.remove('gone');
            items = allEvents().filter((e) => e.date === state.selected);
            list.innerHTML = items.length ? items.map(eventCard).join('') : '<p class="text-sm text-gray-400 py-6 text-center">Nothing planned this day.</p>';
        } else {
            $('list-title').textContent = 'Coming up';
            $('show-upcoming').classList.add('gone');
            const soonEnd = new Date(`${state.today}T12:00:00Z`); soonEnd.setUTCDate(soonEnd.getUTCDate() + 60);
            const soonStr = soonEnd.toISOString().slice(0, 10);
            items = allEvents().filter((e) => e.date >= state.today && (!e.virtual || e.date <= soonStr)).sort((a, b) => `${a.date} ${a.time || ''}` < `${b.date} ${b.time || ''}` ? -1 : 1).slice(0, 30);
            if (!items.length) { list.innerHTML = '<p class="text-sm text-gray-400 py-6 text-center">Nothing coming up. Tap New Event to add something.</p>'; return; }
            let last = '';
            list.innerHTML = items.map((e) => {
                const head = e.date !== last ? `<h3 class="text-[11px] font-mono uppercase tracking-widest text-gray-400 pt-2">${esc(e.date === state.today ? 'Today' : dayLabel(e.date))}</h3>` : '';
                last = e.date;
                return head + eventCard(e);
            }).join('');
        }
        icons();
    }

    // ---- form ----
    function openForm(event, date) {
        state.editing = event || null;
        $('form-title').textContent = event ? 'Edit event' : 'New event';
        $('f-title').value = event ? event.title : '';
        $('f-date').value = event ? event.date : (date || state.selected || state.today);
        const allDay = event ? !event.time : false;
        $('f-allday').checked = allDay;
        $('f-time').value = event && event.time ? event.time : (allDay ? '' : '18:00');
        $('f-end').value = event && event.endTime ? event.endTime : '';
        $('f-location').value = event ? event.location : '';
        $('f-notes').value = event ? event.notes : '';
        $('f-room').innerHTML = state.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
        $('f-room').value = event ? event.room : 'everyone';
        $('f-remind').value = event ? (event.remind == null ? 'none' : String(event.remind)) : '60';
        $('time-row').classList.toggle('gone', allDay);
        const mine = !event || event.createdBy === (state.user && state.user.name) || (state.user && state.user.host);
        $('form-delete').classList.toggle('gone', !event || !mine);
        $('form-save').classList.toggle('gone', !mine);
        $('form-error').classList.add('gone');
        $('form-modal').classList.remove('gone');
        icons();
        setTimeout(() => $('f-title').focus(), 50);
    }
    const closeForm = () => $('form-modal').classList.add('gone');

    async function save(ev) {
        ev.preventDefault();
        const allDay = $('f-allday').checked;
        const remind = $('f-remind').value;
        const body = {
            title: $('f-title').value, date: $('f-date').value,
            time: allDay ? null : $('f-time').value || null, endTime: allDay ? null : $('f-end').value || null,
            location: $('f-location').value, notes: $('f-notes').value, room: $('f-room').value,
            remind: remind === 'none' ? null : Number(remind)
        };
        $('form-save').disabled = true;
        try {
            const data = state.editing
                ? await api(API, { method: 'PUT', body: { id: state.editing.id, ...body } })
                : await api(API, { method: 'POST', body });
            closeForm();
            state.flash = data.event.id;
            state.selected = data.event.date;
            const p = parse(data.event.date);
            state.month = { y: p.y, m: p.m };
            await load();
            render();
            toast(data.clashes && data.clashes.length ? `Saved. Heads up: it overlaps with ${data.clashes.map((c) => c.title).join(', ')}.` : (state.editing ? 'Event saved' : 'Event added. Everyone invited was notified.'));
        } catch (e) {
            $('form-error').textContent = e.message;
            $('form-error').classList.remove('gone');
        } finally { $('form-save').disabled = false; }
    }

    async function remove() {
        if (!state.editing || !window.confirm('Delete this event for everyone?')) return;
        try {
            await api(`${API}?id=${encodeURIComponent(state.editing.id)}`, { method: 'DELETE' });
            closeForm();
            await load();
            render();
            toast('Event deleted');
        } catch (e) {
            $('form-error').textContent = e.message;
            $('form-error').classList.remove('gone');
        }
    }

    function bind() {
        $('btn-new').addEventListener('click', () => openForm(null));
        $('prev').addEventListener('click', () => shift(-1));
        $('next').addEventListener('click', () => shift(1));
        $('show-upcoming').addEventListener('click', () => { state.selected = null; render(); });
        $('grid').addEventListener('click', (e) => {
            const b = e.target.closest('[data-day]');
            if (!b) return;
            state.selected = state.selected === b.dataset.day ? null : b.dataset.day;
            const p = parse(b.dataset.day);
            if (p.m !== state.month.m) { state.month = { y: p.y, m: p.m }; load().then(render); } else render();
        });
        $('list').addEventListener('click', async (e) => {
            const r = e.target.closest('[data-rsvp]');
            if (r) {
                const ev = state.events.find((x) => x.id === r.dataset.eid);
                const mine = ev && (ev.rsvp || {})[state.user.name];
                const response = mine === r.dataset.rsvp ? '' : r.dataset.rsvp;
                try {
                    const data = await api(API, { method: 'POST', body: { action: 'rsvp', id: r.dataset.eid, response } });
                    state.events = state.events.map((x) => (x.id === data.event.id ? data.event : x));
                    renderList();
                    if (data.clashes && data.clashes.length) toast(`Heads up: that overlaps with ${data.clashes.map((c) => c.title).join(', ')}.`);
                } catch (err) { toast(err.message); }
                return;
            }
            const ck = e.target.closest('[data-checkin]');
            if (ck) {
                const ev = state.events.find((x) => x.id === ck.dataset.eid);
                const mine = ev && ev.checkins && ev.checkins[state.user.name] && ev.checkins[state.user.name].status;
                const status = mine === ck.dataset.checkin ? 'clear' : ck.dataset.checkin;
                try {
                    const data = await api(API, { method: 'POST', body: { action: 'checkin', id: ck.dataset.eid, status } });
                    state.events = state.events.map((x) => (x.id === data.event.id ? data.event : x));
                    renderList();
                    if (window.ChowaniecHaptics) window.ChowaniecHaptics.tap('light');
                } catch (err) { toast(err.message); }
                return;
            }
            const b = e.target.closest('[data-id]');
            const found = b && state.events.find((x) => x.id === b.dataset.id);
            if (found) openForm(found);
        });
        $('form').addEventListener('submit', save);
        $('form-close').addEventListener('click', closeForm);
        $('form-delete').addEventListener('click', remove);
        $('f-allday').addEventListener('change', () => {
            $('time-row').classList.toggle('gone', $('f-allday').checked);
            if (!$('f-allday').checked && !$('f-time').value) $('f-time').value = '18:00';
            $('f-remind').value = $('f-allday').checked ? '1440' : '60';
        });
        $('btn-signin').addEventListener('click', () => { try { window.clearChowaniecSession(); } catch (e) { /* ignore */ } location.reload(); });
        setInterval(() => { if (document.visibilityState === 'visible' && $('form-modal').classList.contains('gone')) load().then(render).catch(() => {}); }, 30000);
    }

    async function shift(n) {
        let { y, m } = state.month;
        m += n;
        if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
        state.month = { y, m };
        state.selected = null;
        await load().catch(() => {});
        render();
    }

    async function loadBirthdays() {
        for (let i = 0; i < 20 && !window.ChowaniecPolish; i++) await new Promise((r) => setTimeout(r, 100));
        if (!window.ChowaniecPolish) return;
        state.bdays = await window.ChowaniecPolish.birthdays();
        render();
    }

    async function start() {
        state.user = getUser();
        if (!state.user || !state.user.key) { $('signin-modal').classList.remove('gone'); return; }
        bind();
        try {
            const rooms = await api('/.netlify/functions/group?rooms=1');
            state.rooms = rooms.rooms || [];
        } catch (e) { state.rooms = [{ id: 'everyone', name: 'Everyone' }]; }
        const first = await api(API);
        state.today = first.today;
        const p = parse(state.today);
        state.month = { y: p.y, m: p.m };
        const params = new URLSearchParams(location.search);
        const deep = params.get('event');
        await load();
        render();
        loadBirthdays();
        // "Add to calendar?" from a chat message opens the form already filled in.
        if (params.get('add') === '1') {
            openForm(null, /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : null);
            if (params.get('title')) $('f-title').value = params.get('title').slice(0, 120);
            if (/^\d{2}:\d{2}$/.test(params.get('time') || '')) { $('f-allday').checked = false; $('time-row').classList.remove('gone'); $('f-time').value = params.get('time'); }
            if (params.get('room') && state.rooms.some((r) => r.id === params.get('room'))) $('f-room').value = params.get('room');
        }
        if (deep) {
            const found = state.events.find((e) => e.id === deep);
            if (found) { state.selected = found.date; render(); openForm(found); }
        }
        icons();
    }

    window.returnToHub = () => { location.href = ['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:' ? '../index.html' : '/'; };
    window.initializeProtectedContent = start;
    window.addEventListener('DOMContentLoaded', () => { icons(); if (window.isAppAuthorized && window.isAppAuthorized()) start(); });
})();
