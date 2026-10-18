// Chowaniec Search: one box over notes, group chats you are in, meetings and the calendar.
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const icons = () => { try { window.lucide && window.lucide.createIcons(); } catch (e) { /* ignore */ } };
    const getUser = () => (typeof window.getChowaniecUser === 'function' ? window.getChowaniecUser() : null);
    let seq = 0;

    function mark(text, q) {
        let html = esc(text);
        q.toLowerCase().split(/\s+/).filter((w) => w.length > 1).forEach((w) => {
            const safe = esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            html = html.replace(new RegExp(`(${safe})(?![^<]*>)`, 'gi'), '<mark>$1</mark>');
        });
        return html;
    }

    function when(iso) {
        const t = Date.parse(iso);
        if (!t) return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
        return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const GROUPS = [
        ['notes', 'Notes', (r) => ({ title: r.title, sub: r.snippet, meta: `${r.owner ? `${r.owner} · ` : ''}${when(r.when)}` })],
        ['chats', 'Group chats', (r) => ({ title: `${r.user} in ${r.roomName}`, sub: r.snippet, meta: when(r.when) })],
        ['events', 'Calendar', (r) => ({ title: r.title, sub: r.snippet, meta: when(r.when) })],
        ['meetings', 'Meetings', (r) => ({ title: r.title, sub: r.snippet, meta: when(r.when) })]
    ];

    function show(data, q) {
        $('status').textContent = data.total ? `${data.total} result${data.total === 1 ? '' : 's'}` : 'Nothing found';
        $('results').innerHTML = GROUPS.map(([key, label, fmt]) => {
            const list = data[key] || [];
            if (!list.length) return '';
            return `<section><h2 class="font-serif text-xl mb-3">${label}</h2><div class="space-y-3">${list.map((r) => {
                const v = fmt(r);
                return `<a class="hit" href="${esc(r.url)}"><div class="font-medium text-[15px]">${mark(v.title, q)}</div>${v.sub ? `<div class="text-sm text-gray-500 mt-1">${mark(v.sub, q)}</div>` : ''}<div class="text-[11px] font-mono uppercase tracking-widest text-gray-400 mt-2">${esc(v.meta)}</div></a>`;
            }).join('')}</div></section>`;
        }).join('') || (data.total ? '' : '<p class="text-sm text-gray-400 py-6 text-center">Try different words. You only see notes shared with you, chats you are in, and events for you.</p>');
    }

    async function run(q) {
        const mine = ++seq;
        history.replaceState(null, '', q ? `?q=${encodeURIComponent(q)}` : location.pathname);
        if (q.trim().length < 2) { $('results').innerHTML = ''; $('status').textContent = q ? 'Type at least two letters' : ''; return; }
        const user = getUser();
        if (!user || !user.key) { $('signin-modal').classList.remove('gone'); return; }
        $('status').textContent = 'Searching…';
        try {
            const res = await fetch(`/.netlify/functions/search?q=${encodeURIComponent(q)}`, { headers: { 'X-Chowaniec-Key': user.key }, cache: 'no-store' });
            if (res.status === 401) { $('signin-modal').classList.remove('gone'); return; }
            const data = await res.json();
            if (mine !== seq) return;
            if (!res.ok) throw new Error(data.error || 'Search failed.');
            show(data, q);
        } catch (e) {
            if (mine === seq) { $('status').textContent = e.message || 'Search failed.'; $('results').innerHTML = ''; }
        }
        icons();
    }

    function start() {
        const q = new URLSearchParams(location.search).get('q') || '';
        $('q').value = q;
        $('form').addEventListener('submit', (e) => { e.preventDefault(); run($('q').value); });
        let timer;
        $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run($('q').value), 350); });
        $('btn-signin').addEventListener('click', () => { try { window.clearChowaniecSession(); } catch (e) { /* ignore */ } location.reload(); });
        if (q) run(q); else $('q').focus();
        icons();
    }

    window.returnToHub = () => { location.href = ['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:' ? '../index.html' : '/'; };
    window.initializeProtectedContent = start;
    let started = false;
    const once = () => { if (!started) { started = true; start(); } };
    window.initializeProtectedContent = once;
    window.addEventListener('DOMContentLoaded', () => { icons(); if (window.isAppAuthorized && window.isAppAuthorized()) once(); });
})();
