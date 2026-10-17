// Chowaniec Notes front end. Talks to /.netlify/functions/notes and /.netlify/functions/notes-ai.
(function () {
    'use strict';

    const API = '/.netlify/functions/notes';
    const AI_API = '/.netlify/functions/notes-ai';
    const AUTOSAVE_MS = 1200;
    const AI_TIMEOUT_MS = 90000;

    const FILTERS = [
        { id: 'all', name: 'All', icon: 'notebook' },
        { id: 'mine', name: 'Mine', icon: 'pencil' },
        { id: 'shared', name: 'Shared', icon: 'users' },
        { id: 'meeting', name: 'Meeting Notes', icon: 'video' }
    ];

    const AI_LABELS = {
        summarize: 'Summary',
        cleanup: 'Cleaned-up note',
        action_items: 'Action items',
        ask: 'AI answer'
    };

    const state = {
        user: null,
        notes: [],
        listLoaded: false,
        listError: '',
        filter: 'all',
        search: '',
        current: null,      // { id, title, markdown, shared, owner, source, meetingCode, createdAt, updatedAt, updatedBy, etag }
        dirty: false,
        saving: false,
        saveAgain: false,
        saveError: '',
        conflict: null,
        saveTimer: null,
        view: 'edit',
        pane: 'list',
        openSeq: 0,
        ai: null,           // { mode, status: 'loading'|'done'|'error', markdown, truncated, error, controller }
        liveLock: false,    // Live Notes (live.js) is writing this note
        peopleOpen: false   // the "specific people" picker is open
    };

    const $ = (id) => document.getElementById(id);

    // --- HELPERS ---
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function icons() {
        if (window.lucide) window.lucide.createIcons();
    }

    function isDesktop() {
        return window.matchMedia('(min-width: 1024px)').matches;
    }

    function relativeTime(iso) {
        const t = Date.parse(iso);
        if (isNaN(t)) return '';
        const diff = Math.max(0, Date.now() - t) / 1000;
        if (diff < 45) return 'just now';
        if (diff < 3600) return Math.round(diff / 60) + 'm ago';
        if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
        if (diff < 86400 * 7) return Math.round(diff / 86400) + 'd ago';
        const d = new Date(t);
        const opts = { month: 'short', day: 'numeric' };
        if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
        return d.toLocaleDateString('en-US', opts);
    }

    function fullTime(iso) {
        const t = Date.parse(iso);
        return isNaN(t) ? '' : new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function previewOf(markdown) {
        return String(markdown || '').replace(/[#>*_`|[\]-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    }

    function renderMarkdown(md) {
        if (!window.marked || !window.DOMPurify) return '<p>' + escapeHtml(md) + '</p>';
        return DOMPurify.sanitize(marked.parse(String(md || ''), { gfm: true, breaks: true }));
    }

    function setMarkdownHtml(el, md) {
        el.innerHTML = renderMarkdown(md);
        el.querySelectorAll('table').forEach((table) => {
            if (table.parentElement && table.parentElement.classList.contains('table-wrap')) return;
            const wrap = document.createElement('div');
            wrap.className = 'table-wrap';
            table.parentNode.insertBefore(wrap, table);
            wrap.appendChild(table);
        });
    }

    function fileNameFor(title) {
        const base = String(title || '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
        return (base || 'note') + '.md';
    }

    let toastTimer = null;
    function toast(message, kind) {
        const el = $('toast');
        const icon = kind === 'error' ? 'circle-alert' : 'check';
        el.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4 shrink-0 ${kind === 'error' ? 'text-red-300' : 'text-emerald-300'}"></i><span>${escapeHtml(message)}</span>`;
        el.classList.remove('hidden');
        el.classList.add('flex');
        icons();
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.classList.add('hidden');
            el.classList.remove('flex');
        }, kind === 'error' ? 5000 : 2400);
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) { /* fall back below */ }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        return ok;
    }

    function showModal(id) {
        const m = $(id);
        m.classList.remove('hidden');
        m.classList.add('flex');
    }

    function hideModal(id) {
        const m = $(id);
        m.classList.add('hidden');
        m.classList.remove('flex');
    }

    function isModalOpen(id) {
        return !$(id).classList.contains('hidden');
    }

    // --- AUTH & API ---
    function getUser() {
        return typeof window.getChowaniecUser === 'function' ? window.getChowaniecUser() : null;
    }

    function showSignInAgain() {
        showModal('signin-modal');
        icons();
    }

    function signInAgain() {
        try {
            window.clearChowaniecSession();
        } catch (e) { /* ignore */ }
        state.dirty = false;
        window.location.reload();
    }

    class ApiError extends Error {
        constructor(status, message, data) {
            super(message);
            this.status = status;
            this.data = data || {};
        }
    }

    async function api(url, options) {
        const opts = options || {};
        const user = getUser();
        if (!user || !user.key) {
            showSignInAgain();
            throw new ApiError(401, 'Please sign in again.');
        }
        const headers = { 'X-Chowaniec-Key': user.key };
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetch(url, {
                method: opts.method || 'GET',
                headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                signal: opts.signal,
                cache: 'no-store'
            });
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            throw new ApiError(0, 'Could not reach the server. Check your connection.');
        }
        let data = {};
        try { data = await res.json(); } catch (e) { data = {}; }
        if (res.status === 401) {
            showSignInAgain();
            throw new ApiError(401, data.error || 'Please sign in again.', data);
        }
        if (!res.ok) throw new ApiError(res.status, data.error || `Something went wrong (${res.status}).`, data);
        return data;
    }

    // --- PERMISSIONS ---
    function isOwner(note) {
        return !!note && !!state.user && note.owner === state.user.name;
    }
    // Everyone who can open a note can edit it, unless the owner or a host locked editing.
    function canEdit(note) {
        if (!note) return false;
        return !note.id || isOwner(note) || !!state.user.host || !note.lockEdit;
    }
    function canCheck(note) {
        if (!note) return false;
        return !note.id || isOwner(note) || !!state.user.host || !note.lockCheck;
    }
    function peopleList(note) {
        return Array.isArray(note && note.sharedWith) ? note.sharedWith : [];
    }
    function visibilityOf(note) {
        if (note.shared) return 'shared';
        return peopleList(note).length || state.peopleOpen ? 'people' : 'private';
    }
    function visibilityLabel(note) {
        const v = visibilityOf(note);
        if (v === 'shared') return 'Shared with everyone';
        if (v === 'people') {
            const who = peopleList(note);
            return who.length ? 'Shared with ' + who.join(', ') : 'Shared with specific people';
        }
        return 'Private';
    }
    function familyOthers(note) {
        const all = window.chowaniecPeople ? window.chowaniecPeople() : [];
        return all.filter((name) => name !== note.owner);
    }
    function canShare(note) {
        return !!note && (!note.id || isOwner(note) || !!state.user.host);
    }
    function canDelete(note) {
        return !!note && !!note.id && (isOwner(note) || !!state.user.host);
    }

    // --- LIST ---
    function filteredNotes() {
        const q = state.search.trim().toLowerCase();
        return state.notes.filter((n) => {
            if (state.filter === 'mine' && n.owner !== state.user.name) return false;
            if (state.filter === 'shared' && !n.shared && !peopleList(n).length) return false;
            if (state.filter === 'meeting' && n.source !== 'agent') return false;
            if (!q) return true;
            return String(n.title || '').toLowerCase().includes(q) || String(n.preview || '').toLowerCase().includes(q);
        });
    }

    function renderFilters() {
        $('filter-chips').innerHTML = FILTERS.map((f) => {
            const active = f.id === state.filter;
            return `
                <button type="button" data-filter="${f.id}" aria-pressed="${active}" class="filter-chip shrink-0 whitespace-nowrap min-h-[40px] px-4 py-2 rounded-full border text-xs font-medium transition-colors flex items-center gap-1.5 ${active ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:border-black'}">
                    <i data-lucide="${f.icon}" class="w-3.5 h-3.5"></i>${escapeHtml(f.name)}
                </button>`;
        }).join('');
    }

    function renderList() {
        renderFilters();
        const container = $('notes-list');
        const countEl = $('list-count');

        if (!state.listLoaded) {
            countEl.textContent = state.listError ? 'Could not load' : 'Loading…';
            container.innerHTML = state.listError ? `
                <div class="bg-white p-6 rounded-3xl border border-red-100 text-center space-y-3">
                    <i data-lucide="circle-alert" class="w-6 h-6 text-red-400 mx-auto"></i>
                    <p class="text-sm text-red-600">${escapeHtml(state.listError)}</p>
                    <button type="button" data-action="reload-list" class="min-h-[40px] px-5 rounded-full border border-gray-200 text-xs font-medium hover:border-black">Try again</button>
                </div>` : [1, 2, 3].map(() => `
                <div class="bg-white p-5 rounded-3xl border border-gray-100 space-y-3 animate-pulse">
                    <div class="h-4 bg-gray-100 rounded-full w-2/3"></div>
                    <div class="h-3 bg-gray-50 rounded-full w-full"></div>
                    <div class="h-3 bg-gray-50 rounded-full w-1/2"></div>
                </div>`).join('');
            icons();
            return;
        }

        const list = filteredNotes();
        countEl.textContent = `${list.length} ${list.length === 1 ? 'note' : 'notes'}`;

        if (state.notes.length === 0) {
            container.innerHTML = `
                <div class="bg-white p-8 rounded-3xl border border-gray-100 text-center space-y-4">
                    <i data-lucide="notebook-pen" class="w-8 h-8 text-gray-300 mx-auto"></i>
                    <h3 class="text-lg font-medium text-black">No notes yet</h3>
                    <p class="text-xs text-gray-400 font-light">Write down rehearsal plans, meeting minutes or anything the family should remember.</p>
                    <button type="button" data-action="new-note" class="mt-1 min-h-[40px] px-6 py-2.5 rounded-full bg-black text-white text-xs font-medium hover:bg-gray-800 transition-colors">Write your first note</button>
                </div>`;
            icons();
            return;
        }

        if (list.length === 0) {
            container.innerHTML = `
                <div class="bg-white p-8 rounded-3xl border border-dashed border-gray-200 text-center space-y-3">
                    <i data-lucide="search-x" class="w-7 h-7 text-gray-300 mx-auto"></i>
                    <h3 class="text-base font-medium text-black">Nothing matches</h3>
                    <p class="text-xs text-gray-400 font-light">Try another word or a different filter.</p>
                    <button type="button" data-action="clear-search" class="min-h-[40px] px-5 rounded-full border border-gray-200 text-xs font-medium hover:border-black">Clear search &amp; filters</button>
                </div>`;
            icons();
            return;
        }

        const activeId = state.current && state.current.id;
        container.innerHTML = list.map((n) => {
            const active = n.id === activeId;
            const mine = n.owner === state.user.name;
            return `
                <button type="button" data-id="${escapeHtml(n.id)}" class="note-item w-full text-left bg-white p-5 rounded-3xl border transition-all block ${active ? 'border-black shadow-md' : 'border-gray-100 hover:border-gray-300 hover:shadow-lg hover:shadow-gray-200/50'}" ${active ? 'aria-current="true"' : ''}>
                    <div class="flex items-start justify-between gap-3">
                        <h3 class="note-item-title font-serif text-lg text-black leading-snug break-words min-w-0">${escapeHtml(n.title || 'Untitled note')}</h3>
                        <span class="shrink-0 mt-1 text-gray-400" title="${escapeHtml(n.shared ? 'Shared with everyone' : peopleList(n).length ? 'Shared with ' + peopleList(n).join(', ') : 'Private')}">
                            <i data-lucide="${n.shared ? 'users' : peopleList(n).length ? 'user-check' : 'lock'}" class="w-3.5 h-3.5"></i>
                        </span>
                    </div>
                    ${n.preview ? `<p class="clamp-2 text-sm text-gray-500 font-light mt-1 break-words">${escapeHtml(n.preview)}</p>` : '<p class="text-sm text-gray-300 font-light mt-1 italic">Empty note</p>'}
                    <div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono uppercase tracking-widest text-gray-400">
                        <span>${mine ? 'You' : escapeHtml(n.owner)}</span>
                        <span>&bull;</span>
                        <span title="${escapeHtml(fullTime(n.updatedAt))}">${escapeHtml(relativeTime(n.updatedAt))}</span>
                        ${n.tasks && n.tasks.total ? `<span class="inline-flex items-center gap-1 normal-case tracking-normal font-sans text-[11px] font-medium ${n.tasks.done === n.tasks.total ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-gray-600 bg-gray-50 border-gray-100'} border rounded-full px-2 py-0.5" title="Checklist progress"><i data-lucide="list-checks" class="w-3 h-3"></i>${n.tasks.done}/${n.tasks.total}</span>` : ''}
                        ${n.source === 'agent' ? '<span class="ml-auto inline-flex items-center gap-1 normal-case tracking-normal font-sans text-[11px] font-medium text-violet-700 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5"><i data-lucide="video" class="w-3 h-3"></i>Meeting</span>' : ''}
                    </div>
                </button>`;
        }).join('');
        icons();
    }

    async function loadList() {
        try {
            const data = await api(API);
            state.notes = Array.isArray(data.notes) ? data.notes : [];
            state.listLoaded = true;
            state.listError = '';
        } catch (e) {
            if (!state.listLoaded) state.listError = e.message;
            else if (e.status !== 401) toast(e.message, 'error');
        }
        renderList();
    }

    function upsertSummary(note) {
        const summary = Object.assign({}, note, { preview: previewOf(note.markdown) });
        delete summary.markdown;
        delete summary.etag;
        state.notes = state.notes.filter((n) => n.id !== note.id);
        state.notes.unshift(summary);
        state.notes.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }

    // --- PANES / LAYOUT ---
    function setPane(pane) {
        state.pane = pane;
        $('list-pane').classList.toggle('hidden', pane !== 'list');
        $('editor-pane').classList.toggle('hidden', pane !== 'editor');
        if (!isDesktop()) window.scrollTo(0, 0);
    }

    function showEditorState(which) {
        $('editor-empty').classList.toggle('hidden', which !== 'empty');
        $('editor-empty').classList.toggle('flex', which === 'empty');
        $('editor-loading').classList.toggle('hidden', which !== 'loading');
        $('editor-loading').classList.toggle('flex', which === 'loading');
        $('editor').classList.toggle('hidden', which !== 'editor');
    }

    function setUrlId(id) {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set('id', id);
        else url.searchParams.delete('id');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    // --- EDITOR ---
    function applyView() {
        let view = state.view;
        if (view === 'split' && !isDesktop()) view = 'edit';
        document.querySelectorAll('.view-tab').forEach((tab) => {
            const active = tab.dataset.view === view;
            tab.setAttribute('aria-selected', String(active));
            tab.classList.toggle('bg-white', active);
            tab.classList.toggle('text-black', active);
            tab.classList.toggle('shadow-sm', active);
            tab.classList.toggle('text-gray-500', !active);
        });
        const body = $('editor-body');
        body.classList.toggle('lg:grid-cols-2', view === 'split');
        $('pane-write').classList.toggle('hidden', view === 'preview');
        $('pane-preview').classList.toggle('hidden', view === 'edit');
        const box = $('preview-box');
        box.classList.toggle('lg:h-[60vh]', view === 'split');
        box.classList.toggle('overflow-y-auto', view === 'split');
        $('md-toolbar').classList.toggle('hidden', view === 'preview');
        document.querySelectorAll('.fmt-btn').forEach((b) => {
            b.disabled = view === 'preview' || !canEdit(state.current);
        });
        if (view !== 'edit') renderPreview();
    }

    function renderPreview() {
        if (!state.current) return;
        const md = $('note-body').value;
        const box = $('preview-box');
        if (!md.trim()) {
            box.innerHTML = '<p class="text-gray-300 italic font-light">Nothing to preview yet.</p>';
            return;
        }
        setMarkdownHtml(box, md);
        enhanceChecklist(box);
    }

    let previewFrame = null;
    function schedulePreview() {
        if (state.view === 'edit' && !(state.view === 'split' && isDesktop())) return;
        if (previewFrame) return;
        previewFrame = requestAnimationFrame(() => {
            previewFrame = null;
            renderPreview();
        });
    }

    function renderMeta() {
        const n = state.current;
        const meta = $('note-meta');
        if (!n) { meta.innerHTML = ''; return; }
        const parts = [];
        parts.push(`<span class="inline-flex items-center gap-1 font-mono uppercase tracking-widest text-[10px]">By ${isOwner(n) ? 'you' : escapeHtml(n.owner)}</span>`);
        if (n.id && n.updatedAt) {
            const by = n.updatedBy && n.updatedBy !== n.owner ? ` by ${escapeHtml(n.updatedBy === state.user.name ? 'you' : n.updatedBy)}` : '';
            parts.push(`<span class="font-mono uppercase tracking-widest text-[10px]" title="${escapeHtml(fullTime(n.updatedAt))}">Updated ${escapeHtml(relativeTime(n.updatedAt))}${by}</span>`);
        } else {
            parts.push('<span class="font-mono uppercase tracking-widest text-[10px]">New note</span>');
        }
        if (n.source === 'agent') {
            parts.push(`<span class="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5"><i data-lucide="video" class="w-3 h-3"></i>Meeting${n.meetingCode ? ' &middot; ' + escapeHtml(n.meetingCode) : ''}</span>`);
        }
        meta.innerHTML = parts.join('<span class="text-gray-200">/</span>');
    }

    function renderShareControl() {
        const n = state.current;
        const el = $('share-control');
        if (!n) { el.innerHTML = ''; return; }
        const mode = visibilityOf(n);
        if (canShare(n)) {
            const opt = (value, label, icon) => {
                const active = mode === value;
                return `<button type="button" data-share="${value}" aria-pressed="${active}" class="share-opt min-h-[40px] px-3.5 sm:px-4 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${active ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-black'}"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i>${label}</button>`;
            };
            let html = `<div class="inline-flex bg-gray-50 border border-gray-100 rounded-full p-1" role="group" aria-label="Who can see this note">${opt('private', 'Only me', 'lock')}${opt('people', 'Specific people', 'user-check')}${opt('shared', 'Everyone', 'users')}</div>`;
            if (mode === 'people') {
                const chosen = peopleList(n);
                html += `<div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="People who can see this note">` + familyOthers(n).map((name) => {
                    const on = chosen.includes(name);
                    return `<button type="button" data-person="${escapeHtml(name)}" aria-pressed="${on}" class="person-chip min-h-[40px] px-4 rounded-full border text-xs font-medium flex items-center gap-1.5 transition-colors ${on ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:border-black'}"><i data-lucide="${on ? 'check' : 'plus'}" class="w-3.5 h-3.5"></i>${escapeHtml(name)}</button>`;
                }).join('') + `</div>`;
                if (!chosen.length) html += `<p class="mt-2 text-xs text-gray-400 font-light">Tap the people who should see this note.</p>`;
            }
            if (mode !== 'private') {
                const sw = (kind, label, hint, on) => `<label class="flex items-center justify-between gap-4 min-h-[44px] py-1 cursor-pointer"><span><span class="block text-sm text-gray-800">${label}</span><span class="block text-xs text-gray-400 font-light">${hint}</span></span><input type="checkbox" role="switch" data-lock="${kind}" ${on ? 'checked' : ''} class="lock-switch shrink-0 w-5 h-5 accent-black"></label>`;
                html += `<div class="mt-3 border-t border-gray-100 pt-2">${sw('edit', 'Lock editing', 'Only you or a host can change the text.', !!n.lockEdit)}${sw('check', 'Lock checking off', 'Only you or a host can tick checklist items.', !!n.lockCheck)}</div>`;
            }
            el.innerHTML = html;
        } else {
            const locks = [n.lockEdit ? 'editing is locked' : '', n.lockCheck ? 'checking off is locked' : ''].filter(Boolean).join(' · ');
            el.innerHTML = `
                <div id="share-readonly" class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[40px] px-4 py-2 rounded-2xl bg-gray-50 border border-gray-100 text-xs text-gray-600">
                    <i data-lucide="${mode === 'shared' ? 'users' : mode === 'people' ? 'user-check' : 'lock'}" class="w-3.5 h-3.5"></i>
                    <span class="font-medium">${escapeHtml(visibilityLabel(n))}</span>
                    ${locks ? `<span class="text-gray-400 font-light">&middot; ${escapeHtml(locks)}</span>` : ''}
                    <span class="text-gray-400 font-light hidden sm:inline">&middot; only ${escapeHtml(n.owner)} or a host can change this</span>
                </div>`;
        }
        icons();
    }

    function renderStatus() {
        const el = $('save-status');
        const n = state.current;
        if (!n) { el.innerHTML = ''; return; }
        let html;
        if (state.conflict) {
            html = '<i data-lucide="triangle-alert" class="w-3.5 h-3.5 shrink-0 text-amber-500"></i><span class="truncate text-amber-600">Conflict &mdash; choose a version</span>';
        } else if (state.saving) {
            html = '<i data-lucide="loader-circle" class="w-3.5 h-3.5 shrink-0 spin"></i><span class="truncate">Saving&hellip;</span>';
        } else if (state.saveError) {
            html = `<i data-lucide="circle-alert" class="w-3.5 h-3.5 shrink-0 text-red-500"></i><span class="truncate text-red-600">Not saved: ${escapeHtml(state.saveError)} &middot; tap to retry</span>`;
        } else if (state.dirty) {
            html = '<span class="w-2 h-2 rounded-full bg-amber-400 shrink-0"></span><span class="truncate">Unsaved changes</span>';
        } else if (!n.id) {
            html = '<span class="w-2 h-2 rounded-full bg-gray-300 shrink-0"></span><span class="truncate">Draft &middot; saves as you type</span>';
        } else {
            html = '<i data-lucide="cloud-check" class="w-3.5 h-3.5 shrink-0 text-emerald-500"></i><span class="truncate">Saved</span>';
        }
        el.innerHTML = html;
        el.dataset.state = state.conflict ? 'conflict' : state.saving ? 'saving' : state.saveError ? 'error' : state.dirty ? 'dirty' : n.id ? 'saved' : 'draft';
        icons();
    }

    function renderEditor() {
        const n = state.current;
        if (!n) {
            showEditorState('empty');
            return;
        }
        showEditorState('editor');
        const editable = canEdit(n);
        const title = $('note-title');
        const body = $('note-body');
        if (title.value !== n.title) title.value = n.title;
        if (body.value !== n.markdown) body.value = n.markdown;
        title.readOnly = !editable;
        body.readOnly = !editable || state.liveLock;
        $('readonly-banner').classList.toggle('hidden', editable);
        $('readonly-banner').classList.toggle('flex', !editable);
        $('readonly-text').textContent = !n.lockCheck
            ? `Editing is locked on this note. You can still tick checklist items in the Preview tab. Only ${n.owner} or a host can change this.`
            : `Editing and checking off are locked on this note. Only ${n.owner} or a host can change this.`;

        const del = $('btn-delete');
        del.classList.toggle('hidden', !canDelete(n));
        del.classList.toggle('flex', canDelete(n));
        document.querySelector('[data-action="copy-link"]').disabled = !n.id;

        renderMeta();
        renderShareControl();
        renderStatus();
        applyView();
        icons();
    }

    function openNoteObject(note, etag) {
        state.current = {
            id: note.id || null,
            title: note.title || '',
            markdown: note.markdown || '',
            shared: !!note.shared,
            sharedWith: peopleList(note).slice(),
            lockEdit: !!note.lockEdit,
            lockCheck: !!note.lockCheck,
            owner: note.owner,
            source: note.source || 'manual',
            meetingCode: note.meetingCode || '',
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            updatedBy: note.updatedBy,
            etag: etag || null
        };
        state.dirty = false;
        state.peopleOpen = false;
        state.saveError = '';
        state.conflict = null;
        clearTimeout(state.saveTimer);
        renderEditor();
        renderList();
    }

    // Saves pending changes before switching away. Resolves to true when it is safe to leave.
    async function flushBeforeLeaving() {
        if (state.liveLock) {
            toast('Stop Live Notes before switching notes.');
            return false;
        }
        if (state.conflict) {
            return confirm('This note has a conflict that is not resolved. Leave it and lose your unsaved changes?');
        }
        if (state.dirty || state.saving) {
            state.saveError = '';
            for (let i = 0; i < 1200 && (state.saving || state.dirty) && !state.saveError && !state.conflict; i++) {
                if (state.saving) {
                    await new Promise((r) => setTimeout(r, 50));
                } else {
                    clearTimeout(state.saveTimer);
                    await saveNow({ force: true });
                }
            }
            clearTimeout(state.saveTimer);
            if (state.conflict) {
                return confirm('Someone else changed this note. Leave it and lose your unsaved changes?');
            }
            if (state.dirty || state.saveError) {
                return confirm('Your latest changes could not be saved. Leave this note anyway?');
            }
        }
        return true;
    }

    async function openNote(id, opts) {
        const options = opts || {};
        if (state.current && state.current.id === id && !options.force) {
            setPane('editor');
            return;
        }
        if (!(await flushBeforeLeaving())) return;
        const seq = ++state.openSeq;
        state.current = null;
        showEditorState('loading');
        setPane('editor');
        renderList();
        try {
            const data = await api(`${API}?id=${encodeURIComponent(id)}`);
            if (seq !== state.openSeq) return;
            openNoteObject(data.note, data.etag);
            setUrlId(data.note.id);
            if (!state.notes.some((n) => n.id === data.note.id)) {
                upsertSummary(data.note);
                renderList();
            }
        } catch (e) {
            if (seq !== state.openSeq) return;
            state.current = null;
            setUrlId(null);
            renderEditor();
            if (!isDesktop()) setPane('list');
            if (e.status !== 401) toast(e.message, 'error');
        }
    }

    async function newNote() {
        if (!(await flushBeforeLeaving())) return;
        state.openSeq++;
        openNoteObject({ id: null, title: '', markdown: '', shared: false, sharedWith: [], lockEdit: false, lockCheck: false, owner: state.user.name, source: 'manual' }, null);
        setUrlId(null);
        setPane('editor');
        setTimeout(() => $('note-title').focus(), 30);
    }

    function closeToList() {
        setPane('list');
        renderList();
    }

    // --- SAVING ---
    function markDirty() {
        const n = state.current;
        if (!n || !canEdit(n)) return;
        n.title = $('note-title').value;
        n.markdown = $('note-body').value;
        state.dirty = true;
        state.saveError = '';
        renderStatus();
        scheduleSave();
    }

    function scheduleSave(delay) {
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(saveNow, delay === undefined ? AUTOSAVE_MS : delay);
    }

    async function saveNow(opts) {
        const options = opts || {};
        const n = state.current;
        clearTimeout(state.saveTimer);
        if (!n || state.conflict) return;
        if (state.saving) {
            state.saveAgain = true;
            return;
        }
        if (!state.dirty && !options.force) return;
        if (!n.id && !n.title.trim() && !n.markdown.trim() && !options.force) {
            // Nothing worth creating yet.
            state.dirty = false;
            renderStatus();
            return;
        }

        const snapshot = { title: n.title, markdown: n.markdown, shared: n.shared, sharedWith: peopleList(n).slice(), lockEdit: !!n.lockEdit, lockCheck: !!n.lockCheck };
        const note = n;
        state.saving = true;
        state.saveAgain = false;
        state.saveError = '';
        renderStatus();
        try {
            let data;
            if (!note.id) {
                data = await api(API, { method: 'POST', body: { title: snapshot.title, markdown: snapshot.markdown, shared: snapshot.shared, sharedWith: snapshot.sharedWith, lockEdit: snapshot.lockEdit, lockCheck: snapshot.lockCheck } });
            } else {
                const body = { id: note.id, title: snapshot.title, markdown: snapshot.markdown };
                if (canShare(note)) Object.assign(body, { shared: snapshot.shared, sharedWith: snapshot.sharedWith, lockEdit: snapshot.lockEdit, lockCheck: snapshot.lockCheck });
                if (!options.overwrite && note.etag) body.etag = note.etag;
                data = await api(API, { method: 'PUT', body });
            }
            if (state.current !== note) {
                // User moved on; just keep the list in sync.
                upsertSummary(data.note);
                return;
            }
            const wasNew = !note.id;
            note.id = data.note.id;
            note.etag = data.etag;
            note.owner = data.note.owner;
            note.shared = !!data.note.shared;
            note.sharedWith = peopleList(data.note).slice();
            note.lockEdit = !!data.note.lockEdit;
            note.lockCheck = !!data.note.lockCheck;
            note.createdAt = data.note.createdAt;
            note.updatedAt = data.note.updatedAt;
            note.updatedBy = data.note.updatedBy;
            note.source = data.note.source;
            note.meetingCode = data.note.meetingCode;
            if ((snapshot.shared !== note.shared || snapshot.lockEdit !== note.lockEdit || snapshot.lockCheck !== note.lockCheck) && canShare(note)) {
                // The server refused the change.
                toast('Only the owner or a host can change sharing.', 'error');
            }
            state.dirty = note.title !== snapshot.title || note.markdown !== snapshot.markdown;
            upsertSummary(Object.assign({}, data.note, { title: data.note.title, markdown: snapshot.markdown }));
            if (wasNew) setUrlId(note.id);
            renderMeta();
            renderShareControl();
            const del = $('btn-delete');
            del.classList.toggle('hidden', !canDelete(note));
            del.classList.toggle('flex', canDelete(note));
            document.querySelector('[data-action="copy-link"]').disabled = !note.id;
            renderList();
        } catch (e) {
            if (state.current !== note) return;
            if (e.status === 409) {
                state.conflict = { note: e.data.note || null, etag: e.data.etag || null };
                showModal('conflict-modal');
                icons();
            } else {
                state.saveError = e.message;
            }
        } finally {
            if (state.current === note) {
                state.saving = false;
                renderStatus();
                if (!state.conflict && !state.saveError && (state.saveAgain || state.dirty)) {
                    scheduleSave(state.saveAgain ? 0 : AUTOSAVE_MS);
                }
            } else {
                state.saving = false;
            }
            state.saveAgain = false;
        }
    }

    async function resolveConflict(choice) {
        const n = state.current;
        const conflict = state.conflict;
        hideModal('conflict-modal');
        if (!n || !conflict) return;
        state.conflict = null;
        if (choice === 'theirs') {
            if (conflict.note && conflict.etag) {
                openNoteObject(conflict.note, conflict.etag);
                toast('Loaded the latest version');
            } else {
                await openNote(n.id, { force: true });
            }
            return;
        }
        state.dirty = true;
        await saveNow({ overwrite: true, force: true });
        if (!state.dirty && !state.saveError) toast('Your version was saved');
    }

    // Saves a sharing or lock change right away (a brand-new empty note keeps it until it is first saved).
    async function persistSharing(message) {
        const n = state.current;
        renderShareControl();
        if (!n.id && !n.title.trim() && !n.markdown.trim()) return;
        state.dirty = true;
        await saveNow({ force: true });
        if (message && !state.saveError && !state.conflict) toast(message);
        renderEditor();
    }

    async function setVisibility(mode) {
        const n = state.current;
        if (!n || !canShare(n) || visibilityOf(n) === mode) return;
        if (mode === 'private') { n.shared = false; n.sharedWith = []; state.peopleOpen = false; }
        else if (mode === 'people') { n.shared = false; state.peopleOpen = true; }
        else { n.shared = true; state.peopleOpen = false; }
        await persistSharing(mode === 'shared' ? 'Shared with everyone' : mode === 'private' ? 'Note is now private' : null);
    }

    async function togglePerson(name) {
        const n = state.current;
        if (!n || !canShare(n)) return;
        const set = new Set(peopleList(n));
        if (set.has(name)) set.delete(name); else set.add(name);
        n.sharedWith = [...set];
        await persistSharing(set.has(name) ? `Shared with ${name}` : `${name} can no longer see this note`);
    }

    async function setLock(kind, on) {
        const n = state.current;
        if (!n || !canShare(n)) return;
        if (kind === 'edit') n.lockEdit = on; else n.lockCheck = on;
        await persistSharing(kind === 'edit' ? (on ? 'Editing locked' : 'Editing unlocked') : (on ? 'Checking off locked' : 'Checking off unlocked'));
    }

    // --- CHECKLISTS ---
    // Mirrors the server's reading of "- [ ] item" lines, so the n-th tick box is the n-th item.
    function taskItemsOf(markdown) {
        const items = [];
        let fence = null;
        String(markdown || '').split('\n').forEach((line) => {
            const f = line.match(/^\s*(```|~~~)/);
            if (f) { fence = fence === f[1] ? null : fence || f[1]; return; }
            if (fence) return;
            const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s?(.*)$/);
            if (m) items.push({ checked: m[1] !== ' ', text: m[2].trim() });
        });
        return items;
    }

    function enhanceChecklist(box) {
        const n = state.current;
        const boxes = box.querySelectorAll('input[type="checkbox"]');
        if (!n || !boxes.length) return;
        const items = taskItemsOf($('note-body').value);
        const usable = n.id && !state.liveLock && canCheck(n) && boxes.length === items.length;
        boxes.forEach((cb, i) => {
            cb.dataset.task = String(i);
            cb.disabled = !usable;
            cb.style.cursor = usable ? 'pointer' : 'default';
            cb.style.width = cb.style.height = '1.25rem';
            if (!usable) cb.title = !n.id ? 'Save the note first' : !canCheck(n) ? 'Checking off is locked on this note' : '';
        });
        box.querySelectorAll('li:has(> input[type="checkbox"])').forEach((li) => {
            const cb = li.querySelector(':scope > input[type="checkbox"]');
            li.classList.toggle('task-done', !!cb && cb.checked);
        });
    }

    // Adopts a newer saved version of the open note (from a tick, or another device).
    function applyServerNote(note, etag) {
        const n = state.current;
        if (!n || n.id !== note.id) return;
        Object.assign(n, {
            title: note.title, markdown: note.markdown, etag,
            shared: !!note.shared, sharedWith: peopleList(note).slice(), lockEdit: !!note.lockEdit, lockCheck: !!note.lockCheck,
            updatedAt: note.updatedAt, updatedBy: note.updatedBy
        });
        const body = $('note-body');
        const title = $('note-title');
        if (body.value !== n.markdown) {
            const s = body.selectionStart, e = body.selectionEnd;
            body.value = n.markdown;
            try { body.setSelectionRange(Math.min(s, n.markdown.length), Math.min(e, n.markdown.length)); } catch (err) { /* not focused */ }
        }
        if (title.value !== n.title && document.activeElement !== title) title.value = n.title;
        upsertSummary(note);
        renderMeta();
        renderEditor();
        renderList();
    }

    async function tickItem(index, checked, cb) {
        const n = state.current;
        if (!n || !n.id) return;
        try {
            // Make sure the server has what is on screen first, so the item numbers agree.
            if (state.dirty || state.saving) {
                await saveNow({ force: true });
                for (let i = 0; i < 40 && state.saving; i++) await new Promise((r) => setTimeout(r, 100));
                if (state.conflict || state.saveError) { cb.checked = !checked; return; }
            }
            const items = taskItemsOf($('note-body').value);
            const data = await api(API, { method: 'PUT', body: { id: n.id, action: 'toggle', index, checked, text: items[index] && items[index].text } });
            applyServerNote(data.note, data.etag);
        } catch (e) {
            if (e.status === 409 && e.data && e.data.note) {
                applyServerNote(e.data.note, e.data.etag);
                toast('The list just changed, so I refreshed it. Tap again.');
            } else {
                cb.checked = !checked;
                if (e.status !== 401) toast(e.message, 'error');
            }
        }
    }

    // Keeps the open note up to date when someone else ticks or edits it on another device.
    let syncBusy = false;
    async function syncOpenNote() {
        const n = state.current;
        if (syncBusy || !n || !n.id || state.dirty || state.saving || state.conflict || state.liveLock || document.hidden) return;
        syncBusy = true;
        try {
            const data = await api(`${API}?id=${encodeURIComponent(n.id)}`);
            if (state.current === n && !state.dirty && !state.saving && data.etag !== n.etag) applyServerNote(data.note, data.etag);
        } catch (e) {
            if (e.status === 404 && state.current === n) {
                toast('This note was deleted or is no longer shared with you.', 'error');
                state.current = null;
                state.dirty = false;
                setUrlId(null);
                renderEditor();
                await loadList();
                closeToList();
            }
        } finally {
            syncBusy = false;
        }
    }

    async function deleteNote() {
        const n = state.current;
        if (!n || !canDelete(n)) return;
        const label = n.title.trim() || 'Untitled note';
        if (!confirm(`Delete “${label}”? This cannot be undone.`)) return;
        clearTimeout(state.saveTimer);
        try {
            await api(`${API}?id=${encodeURIComponent(n.id)}`, { method: 'DELETE' });
            state.notes = state.notes.filter((x) => x.id !== n.id);
            state.current = null;
            state.dirty = false;
            setUrlId(null);
            renderEditor();
            closeToList();
            toast('Note deleted');
        } catch (e) {
            if (e.status !== 401) toast(e.message, 'error');
        }
    }

    // --- FORMATTING TOOLBAR ---
    function replaceRange(ta, start, end, text, selStart, selEnd) {
        ta.focus();
        ta.setSelectionRange(start, end);
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
        if (!ok || ta.value.slice(start, start + text.length) !== text) {
            ta.setRangeText(text, start, end, 'end');
        }
        ta.setSelectionRange(selStart, selEnd);
        markDirty();
        schedulePreview();
    }

    function wrapSelection(ta, before, after, fallback) {
        const s = ta.selectionStart;
        const e = ta.selectionEnd;
        const selected = ta.value.slice(s, e) || fallback;
        replaceRange(ta, s, e, before + selected + after, s + before.length, s + before.length + selected.length);
    }

    function prefixLines(ta, prefix, pattern) {
        const v = ta.value;
        const s = ta.selectionStart;
        const e = ta.selectionEnd;
        const lineStart = v.lastIndexOf('\n', s - 1) + 1;
        let lineEnd = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
        if (lineEnd === -1) lineEnd = v.length;
        const lines = v.slice(lineStart, lineEnd).split('\n');
        const all = lines.every((l) => pattern.test(l));
        const out = lines.map((l) => (all ? l.replace(pattern, '') : prefix + l.replace(/^(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+)/, ''))).join('\n');
        replaceRange(ta, lineStart, lineEnd, out, lineStart + out.length, lineStart + out.length);
    }

    function insertBlock(ta, block, selectFrom, selectLen) {
        const v = ta.value;
        const s = ta.selectionStart;
        const e = ta.selectionEnd;
        const before = v.slice(0, s);
        let lead = '';
        if (before.length && !before.endsWith('\n\n')) lead = before.endsWith('\n') ? '\n' : '\n\n';
        const after = v.slice(e);
        const trail = after.startsWith('\n') ? '\n' : '\n\n';
        const text = lead + block + (after.length ? trail : '\n');
        const at = s + lead.length + selectFrom;
        replaceRange(ta, s, e, text, at, at + selectLen);
    }

    function applyFormat(kind) {
        const ta = $('note-body');
        if (!state.current || !canEdit(state.current) || ta.readOnly) return;
        if (state.view === 'preview') { state.view = 'edit'; applyView(); }
        switch (kind) {
            case 'bold': return wrapSelection(ta, '**', '**', 'bold text');
            case 'italic': return wrapSelection(ta, '_', '_', 'italic text');
            case 'heading': return prefixLines(ta, '## ', /^#{1,6}\s+/);
            case 'bullet': return prefixLines(ta, '- ', /^[-*+]\s+(?!\[[ xX]\])/);
            case 'checklist': return prefixLines(ta, '- [ ] ', /^[-*+]\s+\[[ xX]\]\s+/);
            case 'table': {
                const table = '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |';
                return insertBlock(ta, table, 2, 8);
            }
            case 'link': {
                const s = ta.selectionStart;
                const e = ta.selectionEnd;
                const text = ta.value.slice(s, e);
                if (/^https?:\/\/\S+$/.test(text)) {
                    const out = `[link text](${text})`;
                    return replaceRange(ta, s, e, out, s + 1, s + 10);
                }
                const label = text || 'link text';
                const out = `[${label}](https://)`;
                const urlAt = s + label.length + 3;
                return replaceRange(ta, s, e, out, urlAt, urlAt + 8);
            }
            default: return undefined;
        }
    }

    // --- SHARE ACTIONS ---
    async function shareAction(action) {
        const n = state.current;
        if (!n) return;
        closeMenus();
        if (action === 'copy-link') {
            if (!n.id) { toast('Save the note first', 'error'); return; }
            const ok = await copyText(`${window.location.origin}/notes/?id=${encodeURIComponent(n.id)}`);
            toast(ok ? (n.shared ? 'Link copied' : 'Link copied · only the people it is shared with can open it') : 'Could not copy', ok ? undefined : 'error');
        } else if (action === 'copy-markdown') {
            const ok = await copyText($('note-body').value);
            toast(ok ? 'Markdown copied' : 'Could not copy', ok ? undefined : 'error');
        } else if (action === 'download') {
            const md = $('note-body').value;
            const title = $('note-title').value;
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileNameFor(title);
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast('Download started');
        }
    }

    // --- MENUS ---
    function closeMenus() {
        ['share', 'ai'].forEach((name) => {
            $(`menu-${name}`).classList.add('hidden');
            $(`btn-${name}`).setAttribute('aria-expanded', 'false');
        });
    }

    function toggleMenu(name) {
        const menu = $(`menu-${name}`);
        const open = menu.classList.contains('hidden');
        closeMenus();
        if (open) {
            menu.classList.remove('hidden');
            $(`btn-${name}`).setAttribute('aria-expanded', 'true');
        }
    }

    // --- AI ---
    function openAsk() {
        closeMenus();
        showModal('ask-modal');
        icons();
        setTimeout(() => $('ask-instruction').focus(), 30);
    }

    function runAi(mode, instruction) {
        const n = state.current;
        if (!n) return;
        closeMenus();
        if (state.ai && state.ai.controller) state.ai.controller.abort();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
        const ai = { mode, status: 'loading', markdown: '', truncated: false, error: '', controller, noteRef: n };
        state.ai = ai;
        renderAi();
        showModal('ai-modal');
        setAiBusy(true);

        api(AI_API, {
            method: 'POST',
            body: { mode, markdown: $('note-body').value, title: $('note-title').value, instruction: mode === 'ask' ? instruction : undefined },
            signal: controller.signal
        }).then((data) => {
            if (state.ai !== ai) return;
            ai.status = 'done';
            ai.markdown = String(data.markdown || '');
            ai.truncated = !!data.truncated;
        }).catch((e) => {
            if (state.ai !== ai) return;
            ai.status = 'error';
            ai.error = e && e.name === 'AbortError' ? 'The AI took too long to answer. Please try again.' : (e.message || 'Something went wrong.');
        }).finally(() => {
            clearTimeout(timer);
            if (state.ai !== ai) return;
            ai.controller = null;
            setAiBusy(false);
            renderAi();
        });
    }

    function setAiBusy(busy) {
        const btn = $('btn-ai');
        btn.disabled = busy;
        btn.innerHTML = busy
            ? '<i data-lucide="loader-circle" class="w-4 h-4 spin"></i><span>Working…</span>'
            : '<i data-lucide="sparkles" class="w-4 h-4"></i><span>AI</span>';
        icons();
    }

    function aiButton(action, label, icon, primary, disabled) {
        return `<button type="button" data-action="${action}" ${disabled ? 'disabled' : ''} class="min-h-[44px] px-4 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-30 disabled:pointer-events-none ${primary ? 'bg-black text-white hover:bg-gray-800 shadow-md' : 'border border-gray-200 text-gray-700 hover:border-black hover:text-black'}"><i data-lucide="${icon}" class="w-4 h-4"></i>${label}</button>`;
    }

    function renderAi() {
        const ai = state.ai;
        if (!ai) return;
        $('ai-title').textContent = AI_LABELS[ai.mode] || 'Result';
        const body = $('ai-body');
        const actions = $('ai-actions');
        if (ai.status === 'loading') {
            body.innerHTML = `
                <div class="py-10 flex flex-col items-center justify-center gap-3 text-center">
                    <div class="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center"><i data-lucide="loader-circle" class="w-5 h-5 spin text-black"></i></div>
                    <p class="text-sm text-black font-medium">Working on it&hellip;</p>
                    <p class="text-xs text-gray-400 font-light">This can take up to a minute for long notes.</p>
                </div>`;
            actions.innerHTML = '<div class="hidden sm:block"></div>' + aiButton('ai-discard', 'Cancel', 'x', false);
        } else if (ai.status === 'error') {
            body.innerHTML = `
                <div class="bg-red-50 border border-red-100 text-red-600 rounded-2xl p-4 text-sm flex items-start gap-2">
                    <i data-lucide="circle-alert" class="w-4 h-4 shrink-0 mt-0.5"></i><span id="ai-error">${escapeHtml(ai.error)}</span>
                </div>`;
            actions.innerHTML = '<div class="hidden sm:block"></div>' + aiButton('ai-discard', 'Close', 'x', false);
        } else {
            const editable = canEdit(state.current) && state.current === ai.noteRef;
            body.innerHTML = (ai.truncated ? '<div class="mb-4 bg-amber-50 border border-amber-100 text-amber-700 rounded-2xl p-3 text-xs flex items-center gap-2"><i data-lucide="triangle-alert" class="w-3.5 h-3.5 shrink-0"></i>The answer was cut short because it was very long.</div>' : '') +
                '<div id="ai-result" class="md-preview"></div>';
            setMarkdownHtml($('ai-result'), ai.markdown);
            const insertLabel = ai.mode === 'summarize' ? 'Insert summary' : ai.mode === 'action_items' ? 'Insert items' : 'Insert at end';
            actions.innerHTML =
                aiButton('ai-replace', 'Replace note', 'replace', true, !editable) +
                aiButton('ai-insert', insertLabel, 'list-plus', false, !editable) +
                aiButton('ai-copy', 'Copy', 'copy', false) +
                aiButton('ai-discard', 'Discard', 'x', false);
        }
        icons();
    }

    function closeAi() {
        if (state.ai && state.ai.controller) state.ai.controller.abort();
        state.ai = null;
        setAiBusy(false);
        hideModal('ai-modal');
    }

    function setBody(markdown) {
        const ta = $('note-body');
        ta.focus();
        ta.select();
        let ok = false;
        try { ok = document.execCommand('insertText', false, markdown); } catch (e) { ok = false; }
        if (!ok || ta.value !== markdown) ta.value = markdown;
        markDirty();
        renderPreview();
    }

    function applyAi(how) {
        const ai = state.ai;
        if (!ai || ai.status !== 'done' || state.current !== ai.noteRef || !canEdit(state.current)) return;
        const result = ai.markdown.trim();
        if (how === 'replace') {
            setBody(result + '\n');
            toast('Note replaced');
        } else {
            let block = result;
            const heading = ai.mode === 'summarize' ? '## Summary' : ai.mode === 'action_items' ? '## Action Items' : '';
            if (heading && !/^#{1,6}\s/.test(block)) block = heading + '\n\n' + block;
            const current = $('note-body').value.replace(/\s+$/, '');
            setBody((current ? current + '\n\n' : '') + block + '\n');
            toast('Added to the end of the note');
        }
        closeAi();
        scheduleSave(0);
        if (!isDesktop() && state.view === 'edit') $('note-body').blur();
    }

    // --- EVENTS ---
    function bindEvents() {
        $('btn-new').addEventListener('click', newNote);
        $('btn-refresh').addEventListener('click', () => loadList());
        $('btn-back').addEventListener('click', async () => {
            if (state.liveLock) {
                toast('Stop Live Notes before leaving this note.');
                return;
            }
            if (state.dirty || state.saving) {
                clearTimeout(state.saveTimer);
                saveNow();
            }
            closeToList();
            setUrlId(null);
        });
        $('btn-delete').addEventListener('click', deleteNote);
        $('btn-signin').addEventListener('click', signInAgain);
        $('save-status').addEventListener('click', () => {
            if (state.saveError || state.dirty) {
                state.saveError = '';
                state.dirty = true;
                saveNow({ force: true });
            }
        });

        $('search').addEventListener('input', (e) => {
            state.search = e.target.value;
            renderList();
        });

        $('filter-chips').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-filter]');
            if (!chip) return;
            state.filter = chip.dataset.filter;
            renderList();
        });

        $('notes-list').addEventListener('click', (e) => {
            const item = e.target.closest('.note-item');
            if (item) openNote(item.dataset.id);
        });

        $('note-title').addEventListener('input', markDirty);
        $('note-body').addEventListener('input', () => {
            markDirty();
            schedulePreview();
        });
        $('note-title').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                $('note-body').focus();
            }
        });
        $('note-body').addEventListener('keydown', (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); applyFormat('bold'); }
            else if (mod && !e.shiftKey && !e.altKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); applyFormat('italic'); }
            else if (e.key === 'Tab' && !mod && !e.altKey && !e.shiftKey && !$('note-body').readOnly) {
                e.preventDefault();
                const ta = $('note-body');
                const s = ta.selectionStart;
                replaceRange(ta, s, ta.selectionEnd, '  ', s + 2, s + 2);
            }
        });

        document.querySelectorAll('.view-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                state.view = tab.dataset.view;
                applyView();
            });
        });

        $('md-toolbar').addEventListener('mousedown', (e) => {
            // Keep the textarea selection when clicking toolbar buttons.
            if (e.target.closest('[data-format]')) e.preventDefault();
        });
        $('md-toolbar').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-format]');
            if (btn) applyFormat(btn.dataset.format);
        });

        $('share-control').addEventListener('click', (e) => {
            const person = e.target.closest('[data-person]');
            if (person) { togglePerson(person.dataset.person); return; }
            const btn = e.target.closest('[data-share]');
            if (btn) setVisibility(btn.dataset.share);
        });
        $('share-control').addEventListener('change', (e) => {
            const sw = e.target.closest('[data-lock]');
            if (sw) setLock(sw.dataset.lock, sw.checked);
        });
        $('preview-box').addEventListener('change', (e) => {
            const cb = e.target.closest('input[type="checkbox"][data-task]');
            if (cb) tickItem(Number(cb.dataset.task), cb.checked, cb);
        });
        setInterval(syncOpenNote, 4000);
        setInterval(() => { if (!document.hidden && state.listLoaded) { const keep = state.notes; loadList().catch(() => { state.notes = keep; }); } }, 20000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) syncOpenNote(); });

        $('btn-share').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu('share'); });
        $('btn-ai').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu('ai'); });
        $('menu-ai').addEventListener('click', (e) => {
            const item = e.target.closest('[data-ai]');
            if (!item) return;
            if (item.dataset.ai === 'ask') openAsk();
            else runAi(item.dataset.ai);
        });

        $('ask-submit').addEventListener('click', () => {
            const text = $('ask-instruction').value.trim();
            if (!text) {
                $('ask-instruction').focus();
                toast('Tell the AI what to do', 'error');
                return;
            }
            hideModal('ask-modal');
            runAi('ask', text);
        });
        $('ask-instruction').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('ask-submit').click();
        });

        $('conflict-load').addEventListener('click', () => resolveConflict('theirs'));
        $('conflict-keep').addEventListener('click', () => resolveConflict('mine'));

        document.addEventListener('click', async (e) => {
            const closer = e.target.closest('[data-close]');
            if (closer) { hideModal(closer.dataset.close); return; }
            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                const action = actionEl.dataset.action;
                if (action === 'new-note') return newNote();
                if (action === 'reload-list') { state.listError = ''; renderList(); return loadList(); }
                if (action === 'clear-search') {
                    state.search = '';
                    state.filter = 'all';
                    $('search').value = '';
                    return renderList();
                }
                if (action === 'copy-link' || action === 'copy-markdown' || action === 'download') return shareAction(action);
                if (action === 'ai-discard') return closeAi();
                if (action === 'ai-replace') return applyAi('replace');
                if (action === 'ai-insert') return applyAi('insert');
                if (action === 'ai-copy') {
                    const ok = state.ai ? await copyText(state.ai.markdown) : false;
                    return toast(ok ? 'Copied' : 'Could not copy', ok ? undefined : 'error');
                }
            }
            if (!e.target.closest('#menu-share') && !e.target.closest('#menu-ai')) closeMenus();
        });

        // Click on modal backdrop closes the ask dialog.
        $('ask-modal').addEventListener('click', (e) => { if (e.target === $('ask-modal')) hideModal('ask-modal'); });

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                if (state.current && canEdit(state.current)) {
                    if (!state.dirty && state.current.id && !state.saveError) toast('All changes saved');
                    else { state.dirty = true; saveNow({ force: true }); }
                }
                return;
            }
            if (e.key === 'Escape') {
                closeMenus();
                if (isModalOpen('ask-modal')) hideModal('ask-modal');
                else if (isModalOpen('ai-modal')) closeAi();
            }
        });

        window.addEventListener('beforeunload', (e) => {
            if (state.dirty || state.saving || state.conflict) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
            return undefined;
        });

        window.matchMedia('(min-width: 1024px)').addEventListener('change', () => {
            if (isDesktop()) {
                $('list-pane').classList.remove('hidden');
                $('editor-pane').classList.remove('hidden');
            } else {
                setPane(state.current ? state.pane : 'list');
            }
            applyView();
        });

        // Keep relative times fresh.
        setInterval(() => {
            if (state.listLoaded && !document.hidden) {
                renderList();
                renderMeta();
                icons();
            }
        }, 60000);
    }

    // Open links in rendered Markdown in a new tab.
    function configureSanitizer() {
        if (!window.DOMPurify || configureSanitizer.done) return;
        configureSanitizer.done = true;
        DOMPurify.addHook('afterSanitizeAttributes', (node) => {
            if (node.tagName === 'A' && node.getAttribute('href')) {
                node.setAttribute('target', '_blank');
                node.setAttribute('rel', 'noopener noreferrer');
            }
        });
    }

    function renderUserChip() {
        const chip = $('user-chip');
        if (!state.user) return;
        chip.innerHTML = `<span class="w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center text-black font-serif text-xs">${escapeHtml(String(state.user.name || '?').charAt(0))}</span><span class="truncate">${escapeHtml(state.user.name)}</span>${state.user.host ? '<span class="text-[9px] uppercase tracking-widest text-gray-400 hidden sm:inline">Host</span>' : ''}`;
        chip.classList.remove('hidden');
        chip.classList.add('flex');
    }

    let started = false;
    async function start() {
        if (started) return;
        state.user = getUser();
        if (!state.user || !state.user.key) {
            showSignInAgain();
            return;
        }
        started = true;
        configureSanitizer();
        bindEvents();
        renderUserChip();
        renderList();
        showEditorState('empty');
        setPane('list');
        applyView();
        icons();

        const deepId = new URLSearchParams(window.location.search).get('id');
        const listPromise = loadList();
        if (deepId) await openNote(deepId);
        await listPromise;
    }

    // Bridge for Live Notes (notes/live.js).
    window.NotesBridge = {
        user: () => state.user,
        current: () => state.current,
        canEditCurrent: () => !!state.current && canEdit(state.current),
        toast,
        newNote,
        // Replaces the note body without moving focus, then auto-saves.
        setBodyQuiet(markdown) {
            const ta = $('note-body');
            ta.value = markdown;
            markDirty();
            renderPreview();
        },
        setLocked(locked) {
            state.liveLock = locked;
            renderEditor();
        },
        saveNow: () => saveNow({ force: true })
    };

    window.returnToHub = function () {
        const isLocal =
            window.location.protocol === 'file:' ||
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1';
        window.location.href = isLocal ? '../index.html' : '/';
    };

    window.initializeProtectedContent = function () {
        start();
        icons();
    };

    window.addEventListener('DOMContentLoaded', () => {
        icons();
        if (window.isAppAuthorized && window.isAppAuthorized()) {
            window.initializeProtectedContent();
        }
    });
})();
