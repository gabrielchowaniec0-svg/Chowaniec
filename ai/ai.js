// Chowaniec AI: chat with the family assistant (streams NDJSON from /.netlify/functions/ai-agent).
(function () {
    'use strict';

    const AGENT_URL = '/.netlify/functions/ai-agent';
    const NOTES_URL = '/.netlify/functions/notes';

    const COMMANDS = [
        { name: 'summarize', args: '#note', desc: 'Summarize a note', server: true },
        { name: 'note', args: 'text', desc: 'Save a new note', server: true },
        { name: 'meet', args: 'topic', desc: 'Create a meeting link', server: true },
        { name: 'group', args: 'message', desc: 'Post to the family group chat (sent by me for you)', server: true },
        { name: 'remind', args: '@person message', desc: 'Remind someone in the group chat', server: true },
        { name: 'recap', args: '', desc: 'Catch up on the group chats you are in', server: true },
        { name: 'meeting-recap', args: 'optional code', desc: 'Recap the latest meeting you were in and post it to a chat', server: true },
        { name: 'calendar', args: 'event details', desc: 'Add something to the family calendar', server: true },
        { name: 'poll', args: 'question and answers', desc: 'Create a poll in a group chat', server: true },
        { name: 'messages', args: 'person and what to tell them', desc: 'Send a direct message, or catch up on yours', server: true },
        { name: 'signup', args: 'title and slots', desc: 'Create a sign-up sheet people can tap to claim', server: true },
        { name: 'new', args: '', desc: 'Start a new chat', server: false },
        { name: 'help', args: '', desc: 'Show what I can do', server: false },
        { name: 'clear', args: '', desc: 'Clear this chat from view', server: false }
    ];
    const COMMAND_ICONS = {
        summarize: 'scroll-text', note: 'notebook-pen', meet: 'video', group: 'messages-square',
        remind: 'bell-ring', recap: 'history', 'meeting-recap': 'clipboard-list', calendar: 'calendar-days', poll: 'chart-no-axes-column', signup: 'clipboard-check', messages: 'message-circle', new: 'square-pen', help: 'circle-help', clear: 'eraser'
    };

    const SUGGESTIONS = [
        { icon: 'scroll-text', title: 'Summarize a note', sub: 'Pick a note and get the gist', insert: '/summarize #' },
        { icon: 'video', title: 'Plan a meeting', sub: 'Create a Chowaniec Meet link', insert: '/meet ' },
        { icon: 'history', title: 'Catch me up on the group chat', sub: 'What did I miss?', insert: '/recap' },
        { icon: 'bell-ring', title: 'Remind someone', sub: 'Nudge a family member', insert: '/remind @' }
    ];

    const state = {
        user: null,
        people: [],
        conversations: [],
        convLoaded: false,
        convId: null,
        messages: [], // {role:'user'|'assistant'|'local', text, command?, actions?, el}
        refs: [], // {type:'note', id, label} | {type:'group'} | {type:'meeting', code}
        notes: null,
        notesPromise: null,
        stream: null, // { controller, view, stopped }
        lastRequest: null,
        ac: { open: false, kind: null, items: [], index: 0, start: 0, end: 0 }
    };

    const $ = (id) => document.getElementById(id);

    // --- UTIL ---
    function icons() {
        if (window.lucide) window.lucide.createIcons();
    }

    function isDesktop() {
        return window.matchMedia('(min-width: 1024px)').matches;
    }

    function coarsePointer() {
        return window.matchMedia('(pointer: coarse)').matches;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Only allow same-site paths and http(s) links (never javascript:, data:, ...).
    function safeUrl(url) {
        if (typeof url !== 'string' || !url.trim()) return null;
        try {
            const u = new URL(url, window.location.origin);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
            return u.origin === window.location.origin ? u.pathname + u.search + u.hash : u.href;
        } catch (e) {
            return null;
        }
    }

    function isExternal(url) {
        return /^https?:\/\//i.test(url);
    }

    function relTime(iso) {
        const t = Date.parse(iso);
        if (isNaN(t)) return '';
        const diff = Date.now() - t;
        const min = Math.round(diff / 60000);
        if (min < 1) return 'just now';
        if (min < 60) return min + 'm ago';
        const h = Math.round(min / 60);
        if (h < 24) return h + 'h ago';
        const d = Math.round(h / 24);
        if (d < 7) return d + 'd ago';
        return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function renderMarkdown(md) {
        if (!window.marked || !window.DOMPurify) return '<p>' + escapeHtml(md).replace(/\n/g, '<br>') + '</p>';
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

    function configureSanitizer() {
        if (!window.DOMPurify || configureSanitizer.done) return;
        configureSanitizer.done = true;
        DOMPurify.addHook('afterSanitizeAttributes', (node) => {
            if (node.tagName === 'A' && node.getAttribute('href') && isExternal(node.getAttribute('href'))) {
                node.setAttribute('target', '_blank');
                node.setAttribute('rel', 'noopener noreferrer');
            }
        });
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

    // --- AUTH & API ---
    function getUser() {
        return typeof window.getChowaniecUser === 'function' ? window.getChowaniecUser() : null;
    }

    function showSignInAgain() {
        const m = $('signin-modal');
        m.classList.remove('hidden');
        m.classList.add('flex');
        icons();
    }

    function signInAgain() {
        try {
            if (typeof window.clearChowaniecSession === 'function') window.clearChowaniecSession();
            else {
                sessionStorage.removeItem('chowaniec_authenticated');
                sessionStorage.removeItem('chowaniec_user');
            }
        } catch (e) { /* ignore */ }
        window.location.reload();
    }

    class ApiError extends Error {
        constructor(status, message, data) {
            super(message);
            this.status = status;
            this.data = data || {};
        }
    }

    function authHeaders(json) {
        const user = getUser();
        if (!user || !user.key) {
            showSignInAgain();
            throw new ApiError(401, 'Please sign in again.');
        }
        const headers = { 'X-Chowaniec-Key': user.key };
        if (json) headers['Content-Type'] = 'application/json';
        return headers;
    }

    async function api(url, options) {
        const opts = options || {};
        const headers = authHeaders(opts.body !== undefined);
        let res;
        try {
            res = await fetch(url, {
                method: opts.method || 'GET',
                headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                cache: 'no-store'
            });
        } catch (e) {
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

    // --- PEOPLE & NOTES ---
    function loadPeople() {
        let list = [];
        try {
            if (typeof window.chowaniecPeople === 'function') list = window.chowaniecPeople() || [];
        } catch (e) { list = []; }
        if (!list.length && window.CHOWANIEC_CONFIG && window.CHOWANIEC_CONFIG.PASSCODE_HASHES) {
            list = Object.values(window.CHOWANIEC_CONFIG.PASSCODE_HASHES)
                .map((u) => u && u.name)
                .filter((n) => n && n !== 'Guest');
        }
        return [...new Set(list.map(String))];
    }

    function findPerson(name) {
        const lower = String(name).toLowerCase();
        return state.people.find((p) => p.toLowerCase() === lower) || null;
    }

    function ensureNotes() {
        if (state.notes) return Promise.resolve(state.notes);
        if (!state.notesPromise) {
            state.notesPromise = api(NOTES_URL)
                .then((data) => {
                    state.notes = Array.isArray(data.notes) ? data.notes : [];
                    return state.notes;
                })
                .catch((e) => {
                    state.notesPromise = null;
                    throw e;
                });
        }
        return state.notesPromise;
    }

    function noteToken(title) {
        const slug = String(title || 'Untitled').trim()
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48);
        return '#' + (slug || 'note');
    }

    // --- CONVERSATION LIST ---
    async function loadConversations() {
        try {
            const data = await api(AGENT_URL);
            state.conversations = Array.isArray(data.conversations) ? data.conversations : [];
        } catch (e) {
            if (e.status !== 401) toast(e.message, 'error');
        }
        state.convLoaded = true;
        renderConversations();
    }

    function renderConversations() {
        const nav = $('conv-list');
        if (!state.convLoaded) {
            nav.innerHTML = '<div class="px-3 py-3 space-y-2">' +
                '<div class="h-10 rounded-xl bg-gray-50 animate-pulse"></div>'.repeat(4) + '</div>';
            return;
        }
        if (!state.conversations.length) {
            nav.innerHTML = '<p class="px-3 py-6 text-xs text-gray-400 font-light leading-relaxed">No conversations yet. Your chats with Chowaniec AI will appear here.</p>';
            return;
        }
        nav.innerHTML = state.conversations.map((c) => {
            const active = c.id === state.convId;
            return `<div class="group relative flex items-center rounded-xl ${active ? 'bg-gray-100' : 'hover:bg-gray-50'}" data-conv-row="${escapeHtml(c.id)}">
                <button type="button" data-conv="${escapeHtml(c.id)}" ${active ? 'aria-current="true"' : ''} class="flex-1 min-w-0 min-h-[48px] text-left pl-3 pr-12 py-2.5">
                    <span class="block text-sm truncate ${active ? 'text-black font-medium' : 'text-gray-700'}">${escapeHtml(c.title || 'New chat')}</span>
                    <span class="block text-[10px] font-mono uppercase tracking-wider text-gray-400 mt-0.5">${escapeHtml(relTime(c.updatedAt))}</span>
                </button>
                <button type="button" data-del="${escapeHtml(c.id)}" title="Delete conversation" aria-label="Delete conversation" class="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-gray-300 hover:text-red-600 hover:bg-red-50 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-opacity">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>`;
        }).join('');
        icons();
    }

    function upsertConversation(id, title, touch) {
        let c = state.conversations.find((x) => x.id === id);
        if (!c) {
            c = { id, title: title || 'New chat', updatedAt: new Date().toISOString() };
            state.conversations.unshift(c);
        } else if (title) {
            c.title = title;
        }
        if (touch) {
            c.updatedAt = new Date().toISOString();
            state.conversations = [c].concat(state.conversations.filter((x) => x !== c));
        }
        renderConversations();
    }

    let pendingDelete = null;
    async function onDeleteClick(btn) {
        const id = btn.getAttribute('data-del');
        if (pendingDelete !== id) {
            // First tap arms the button; second tap deletes.
            pendingDelete = id;
            btn.classList.remove('text-gray-300', 'lg:opacity-0');
            btn.classList.add('text-white', 'bg-red-600', 'hover:bg-red-700', 'hover:text-white');
            btn.setAttribute('aria-label', 'Tap again to delete');
            btn.title = 'Tap again to delete';
            setTimeout(() => {
                if (pendingDelete === id) {
                    pendingDelete = null;
                    renderConversations();
                }
            }, 3000);
            return;
        }
        pendingDelete = null;
        try {
            await api(`${AGENT_URL}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            state.conversations = state.conversations.filter((c) => c.id !== id);
            if (state.convId === id) newChat({ keepDrawer: true });
            renderConversations();
            toast('Conversation deleted');
        } catch (e) {
            if (e.status !== 401) toast(e.message, 'error');
            renderConversations();
        }
    }

    function setUrlConversation(id) {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set('c', id);
        else url.searchParams.delete('c');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    async function openConversation(id) {
        if (state.stream) stopStream();
        closeDrawer();
        state.convId = id;
        renderConversations();
        clearMessages();
        $('welcome').classList.add('hidden');
        $('messages').innerHTML = '<div class="flex justify-center py-16"><i data-lucide="loader-circle" class="w-6 h-6 text-gray-300 spin"></i></div>';
        icons();
        setUrlConversation(id);
        try {
            const data = await api(`${AGENT_URL}?id=${encodeURIComponent(id)}`);
            if (state.convId !== id) return;
            const conv = data.conversation || {};
            $('messages').innerHTML = '';
            if (conv.title) upsertConversation(id, conv.title, false);
            const all = conv.messages || [];
            all.forEach((m, i) => {
                if (m.role === 'user') addUserMessage(m.text || '', null);
                else addAssistantFinal(m.text || '', m.actions || [], i === all.length - 1 ? m.quickAnswers : null);
            });
            updateWelcome();
            scrollToBottom(true);
        } catch (e) {
            if (state.convId !== id) return;
            $('messages').innerHTML = '';
            if (e.status === 401) return;
            toast(e.status === 404 ? 'That conversation no longer exists.' : e.message, 'error');
            state.conversations = e.status === 404 ? state.conversations.filter((c) => c.id !== id) : state.conversations;
            newChat({ keepDrawer: true });
        }
    }

    function newChat(opts) {
        if (state.stream) stopStream();
        state.convId = null;
        state.lastRequest = null;
        clearMessages();
        setUrlConversation(null);
        renderConversations();
        updateWelcome();
        if (!(opts && opts.keepDrawer)) closeDrawer();
        if (!(opts && opts.noFocus) && !coarsePointer()) $('composer-input').focus();
    }

    // --- DRAWER ---
    function openDrawer() {
        const sb = $('sidebar');
        sb.classList.remove('invisible', '-translate-x-full');
        $('drawer-backdrop').classList.remove('hidden');
        $('btn-drawer').setAttribute('aria-expanded', 'true');
        setTimeout(() => $('btn-new').focus(), 50);
    }

    function closeDrawer() {
        if (isDesktop()) return;
        const sb = $('sidebar');
        if (sb.classList.contains('-translate-x-full')) return;
        sb.classList.add('-translate-x-full');
        $('drawer-backdrop').classList.add('hidden');
        $('btn-drawer').setAttribute('aria-expanded', 'false');
        setTimeout(() => { if (sb.classList.contains('-translate-x-full')) sb.classList.add('invisible'); }, 300);
    }

    // --- MESSAGES ---
    function clearMessages() {
        state.messages = [];
        $('messages').innerHTML = '';
    }

    function updateWelcome() {
        const empty = !$('messages').children.length;
        $('welcome').classList.toggle('hidden', !empty);
    }

    function nearBottom() {
        const s = $('scroller');
        return s.scrollHeight - s.scrollTop - s.clientHeight < 120;
    }

    function scrollToBottom(force) {
        const s = $('scroller');
        if (force || nearBottom()) s.scrollTop = s.scrollHeight;
    }

    // Splits user text into plain / @mention / #reference pieces (built with textContent, never innerHTML).
    function appendTokenized(parent, text) {
        const re = /(@[\p{L}\p{N}_-]+|#[\p{L}\p{N}_:.-]+)/gu;
        let last = 0;
        let m;
        while ((m = re.exec(text))) {
            if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
            const tok = m[0];
            const span = document.createElement('span');
            if (tok[0] === '@') {
                if (findPerson(tok.slice(1)) || tok.slice(1).toLowerCase() === 'ai') span.className = 'tok tok-mention';
            } else {
                span.className = 'tok tok-ref';
            }
            span.textContent = tok;
            parent.appendChild(span);
            last = m.index + tok.length;
        }
        if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    }

    function addUserMessage(text, command) {
        let cmd = command;
        let body = String(text || '');
        if (!cmd) {
            const parsed = parseCommand(body);
            if (parsed.cmd) {
                cmd = parsed.cmd.name;
                body = parsed.rest;
            }
        }
        const row = document.createElement('div');
        row.className = 'flex justify-end fade-in';
        row.setAttribute('data-role', 'user');
        const bubble = document.createElement('div');
        bubble.className = 'max-w-[85%] bg-black text-white rounded-3xl rounded-br-lg px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap shadow-sm';
        bubble.style.overflowWrap = 'anywhere';
        if (cmd) {
            const chip = document.createElement('span');
            chip.className = 'inline-flex items-center gap-1 mr-1.5 px-2 py-0.5 rounded-full bg-white text-black text-[11px] font-mono align-[1px]';
            chip.textContent = '/' + cmd;
            chip.setAttribute('data-cmd-chip', cmd);
            bubble.appendChild(chip);
        }
        appendTokenized(bubble, body);
        row.appendChild(bubble);
        $('messages').appendChild(row);
        state.messages.push({ role: 'user', text: body, command: cmd || null, el: row });
        updateWelcome();
        return row;
    }

    function assistantShell() {
        const row = document.createElement('div');
        row.className = 'flex gap-3 fade-in';
        row.setAttribute('data-role', 'assistant');
        row.innerHTML = `
            <div class="w-8 h-8 shrink-0 rounded-full bg-violet-600 flex items-center justify-center mt-0.5 p-1 bob-avatar">${window.ChowaniecRobot ? window.ChowaniecRobot.face() : ''}</div>
            <div class="flex-1 min-w-0 space-y-3">
                <div data-slot="tools" class="hidden flex-wrap gap-2"></div>
                <div data-slot="typing" class="hidden typing-dots items-center gap-1 h-7"><span></span><span></span><span></span></div>
                <div data-slot="body" class="md-preview"></div>
                <div data-slot="error" class="hidden"></div>
                <div data-slot="actions" class="hidden flex-wrap gap-2"></div>
                <div data-slot="quick" class="hidden flex-wrap gap-2" role="group" aria-label="Quick answers"></div>
                <div data-slot="footer" class="hidden items-center gap-1 -ml-2"></div>
            </div>`;
        $('messages').appendChild(row);
        updateWelcome();
        const slot = (n) => row.querySelector(`[data-slot="${n}"]`);
        return {
            row,
            tools: slot('tools'),
            typing: slot('typing'),
            body: slot('body'),
            error: slot('error'),
            actions: slot('actions'),
            quick: slot('quick'),
            footer: slot('footer'),
            text: '',
            toolChips: []
        };
    }

    function renderActions(view, actions) {
        const list = (actions || []).filter((a) => a && a.label && safeUrl(a.url));
        view.actions.innerHTML = '';
        if (!list.length) {
            view.actions.classList.add('hidden');
            view.actions.classList.remove('flex');
            return;
        }
        list.forEach((a, i) => {
            const href = safeUrl(a.url);
            const link = document.createElement('a');
            link.href = href;
            link.setAttribute('data-action-link', '');
            if (isExternal(href)) {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }
            link.className = (i === 0
                ? 'bg-black text-white hover:bg-gray-800 shadow-md border-black'
                : 'bg-white text-gray-700 hover:text-black hover:border-black border-gray-200') +
                ' min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-medium transition-colors max-w-full';
            const label = document.createElement('span');
            label.className = 'truncate';
            label.textContent = a.label;
            link.appendChild(label);
            const ic = document.createElement('i');
            ic.setAttribute('data-lucide', isExternal(href) ? 'external-link' : 'arrow-up-right');
            ic.className = 'w-3.5 h-3.5 shrink-0';
            link.appendChild(ic);
            view.actions.appendChild(link);
        });
        view.actions.classList.remove('hidden');
        view.actions.classList.add('flex');
        icons();
    }

    // Tappable answers the AI offers under its reply. Tapping one sends it as the person's next message.
    function renderQuickAnswers(view, answers) {
        const list = (Array.isArray(answers) ? answers : []).filter((a) => a && a.label && a.reply).slice(0, 4);
        view.quick.innerHTML = '';
        if (!list.length) {
            view.quick.classList.add('hidden');
            view.quick.classList.remove('flex');
            return;
        }
        list.forEach((a) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('data-quick', '');
            btn.className = 'min-h-[44px] px-5 py-2 rounded-full border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:border-black hover:text-black transition-colors max-w-full';
            btn.textContent = a.label;
            btn.addEventListener('click', () => {
                if (state.stream) return;
                view.quick.querySelectorAll('button').forEach((b) => { b.disabled = true; b.classList.add('opacity-40'); });
                btn.classList.remove('opacity-40');
                btn.classList.add('bg-black', 'text-white', 'border-black');
                const input = $('composer-input');
                input.value = a.reply;
                send();
            });
            view.quick.appendChild(btn);
        });
        view.quick.classList.remove('hidden');
        view.quick.classList.add('flex');
    }

    // Quick answers only make sense for the newest reply: older ones are answered or stale.
    function clearOldQuickAnswers() {
        document.querySelectorAll('[data-slot="quick"]').forEach((el) => { el.innerHTML = ''; el.classList.add('hidden'); el.classList.remove('flex'); });
    }

    function renderFooter(view) {
        view.footer.innerHTML = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Copy';
        btn.setAttribute('aria-label', 'Copy response');
        btn.setAttribute('data-copy', '');
        btn.className = 'min-h-[40px] px-3 rounded-full inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-gray-400 hover:text-black hover:bg-gray-100 transition-colors';
        btn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i><span>Copy</span>';
        btn.addEventListener('click', async () => {
            const ok = await copyText(view.text);
            if (ok) {
                btn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i><span>Copied</span>';
                icons();
                setTimeout(() => {
                    btn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i><span>Copy</span>';
                    icons();
                }, 1600);
            } else {
                toast('Could not copy', 'error');
            }
        });
        view.footer.appendChild(btn);
        view.footer.classList.remove('hidden');
        view.footer.classList.add('flex');
        icons();
    }

    function addAssistantFinal(text, actions, quickAnswers) {
        const view = assistantShell();
        view.text = String(text || '');
        setMarkdownHtml(view.body, view.text);
        renderActions(view, actions);
        renderQuickAnswers(view, quickAnswers);
        if (view.text) renderFooter(view);
        state.messages.push({ role: 'assistant', text: view.text, actions, el: view.row });
        icons();
        return view;
    }

    function addHelpCard() {
        const row = document.createElement('div');
        row.className = 'fade-in';
        row.setAttribute('data-role', 'local');
        row.setAttribute('data-help-card', '');
        const cmds = COMMANDS.map((c) => `
            <li class="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <span class="w-8 h-8 shrink-0 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-600"><i data-lucide="${COMMAND_ICONS[c.name]}" class="w-4 h-4"></i></span>
                <span class="min-w-0">
                    <span class="font-mono text-[13px] text-black">/${c.name}</span>${c.args ? ` <span class="font-mono text-[11px] text-gray-400">${escapeHtml(c.args)}</span>` : ''}
                    <span class="block text-xs text-gray-500 font-light">${escapeHtml(c.desc)}</span>
                </span>
            </li>`).join('');
        row.innerHTML = `
            <div class="bg-white border border-gray-100 rounded-3xl p-5 sm:p-6 shadow-sm">
                <div class="flex items-center justify-between gap-3 mb-3">
                    <div>
                        <p class="text-[10px] font-mono uppercase tracking-widest text-gray-400 font-medium">Help</p>
                        <h3 class="text-xl font-serif text-black">What I can do</h3>
                    </div>
                    <button type="button" data-dismiss title="Dismiss" aria-label="Dismiss help" class="w-10 h-10 rounded-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-50"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>
                <p class="text-[10px] font-mono uppercase tracking-widest text-gray-400 mt-4 mb-1">Commands</p>
                <ul>${cmds}</ul>
                <div class="grid sm:grid-cols-2 gap-3 mt-4">
                    <div class="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                        <p class="font-mono text-[13px] text-black mb-1">@person</p>
                        <p class="text-xs text-gray-500 font-light leading-relaxed">Mention ${escapeHtml(state.people.join(', ') || 'a family member')} so I know who you mean, e.g. for reminders.</p>
                    </div>
                    <div class="rounded-2xl bg-gray-50 border border-gray-100 p-4">
                        <p class="font-mono text-[13px] text-black mb-1">#reference</p>
                        <p class="text-xs text-gray-500 font-light leading-relaxed">Point me at <span class="font-mono">#group</span> (the group chat), one of your notes, or a meeting with <span class="font-mono">#meeting:code</span>.</p>
                    </div>
                </div>
            </div>`;
        row.querySelector('[data-dismiss]').addEventListener('click', () => {
            row.remove();
            updateWelcome();
        });
        $('messages').appendChild(row);
        updateWelcome();
        icons();
        scrollToBottom(true);
    }

    // --- STREAMING ---
    function toolChip(view, name, label) {
        const chip = document.createElement('div');
        chip.className = 'inline-flex items-center gap-2 min-h-[32px] max-w-full px-3 py-1.5 rounded-full bg-white border border-gray-200 text-xs text-gray-600 fade-in';
        chip.setAttribute('data-tool', name || '');
        chip.setAttribute('data-state', 'running');
        chip.innerHTML = '<i data-lucide="loader-circle" class="w-3.5 h-3.5 shrink-0 spin text-gray-400"></i><span class="truncate"></span>';
        chip.querySelector('span').textContent = label || (name ? `Running ${name}…` : 'Working…');
        view.tools.appendChild(chip);
        view.tools.classList.remove('hidden');
        view.tools.classList.add('flex');
        view.toolChips.push(chip);
        icons();
        return chip;
    }

    function finishToolChip(view, evt) {
        let chip = null;
        for (let i = view.toolChips.length - 1; i >= 0; i--) {
            const c = view.toolChips[i];
            if (c.getAttribute('data-state') === 'running' && c.getAttribute('data-tool') === (evt.name || '')) { chip = c; break; }
        }
        if (!chip) {
            chip = view.toolChips.slice().reverse().find((c) => c.getAttribute('data-state') === 'running') || toolChip(view, evt.name, '');
        }
        const ok = evt.ok !== false;
        chip.setAttribute('data-state', ok ? 'ok' : 'failed');
        chip.className = 'inline-flex items-center gap-2 min-h-[32px] max-w-full px-3 py-1.5 rounded-full border text-xs ' +
            (ok ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-700');
        chip.innerHTML = '';
        const ic = document.createElement('i');
        ic.setAttribute('data-lucide', ok ? 'check' : 'x');
        ic.className = 'w-3.5 h-3.5 shrink-0';
        chip.appendChild(ic);
        const summary = evt.summary || (ok ? 'Done' : 'Failed');
        const href = safeUrl(evt.url);
        if (href) {
            const a = document.createElement('a');
            a.href = href;
            a.className = 'truncate underline underline-offset-2 decoration-current/30 hover:decoration-current';
            if (isExternal(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
            a.textContent = summary;
            chip.appendChild(a);
            const arrow = document.createElement('i');
            arrow.setAttribute('data-lucide', 'arrow-up-right');
            arrow.className = 'w-3 h-3 shrink-0';
            chip.appendChild(arrow);
        } else {
            const s = document.createElement('span');
            s.className = 'truncate';
            s.textContent = summary;
            chip.appendChild(s);
        }
        icons();
    }

    function scheduleRender(view) {
        if (view.renderTimer) return;
        view.renderTimer = setTimeout(() => {
            view.renderTimer = null;
            const stick = nearBottom();
            setMarkdownHtml(view.body, view.text);
            view.body.classList.add('streaming-caret');
            if (stick) scrollToBottom(true);
        }, 70);
    }

    function flushRender(view) {
        clearTimeout(view.renderTimer);
        view.renderTimer = null;
        setMarkdownHtml(view.body, view.text);
        view.body.classList.remove('streaming-caret');
    }

    function showStreamError(view, message, retryable) {
        view.typing.classList.add('hidden');
        view.typing.classList.remove('flex');
        view.error.innerHTML = `
            <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3">
                <i data-lucide="circle-alert" class="w-4 h-4 text-red-500 shrink-0"></i>
                <p class="flex-1 min-w-[10rem] text-sm text-red-700" data-error-text></p>
                ${retryable ? '<button type="button" data-retry class="min-h-[40px] px-4 rounded-full bg-black text-white text-xs font-medium hover:bg-gray-800 inline-flex items-center gap-2"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Retry</button>' : ''}
            </div>`;
        view.error.querySelector('[data-error-text]').textContent = message;
        view.error.classList.remove('hidden');
        const retry = view.error.querySelector('[data-retry]');
        if (retry) retry.addEventListener('click', () => {
            if (state.stream) return;
            view.row.remove();
            state.messages = state.messages.filter((m) => m.el !== view.row);
            if (state.lastRequest) runStream(state.lastRequest);
        });
        icons();
    }

    function setStreamingUi(on) {
        $('btn-send').classList.toggle('hidden', on);
        $('btn-stop').classList.toggle('hidden', !on);
        $('btn-stop').classList.toggle('flex', on);
    }

    function stopStream() {
        if (!state.stream) return;
        state.stream.stopped = true;
        try { state.stream.controller.abort(); } catch (e) { /* ignore */ }
    }

    function handleEvent(view, evt, ctx) {
        if (!evt || typeof evt !== 'object') return;
        switch (evt.type) {
            case 'start':
                if (evt.conversationId) {
                    const isNew = state.convId !== evt.conversationId;
                    state.convId = evt.conversationId;
                    if (state.lastRequest) state.lastRequest.conversationId = evt.conversationId;
                    upsertConversation(evt.conversationId, evt.title, true);
                    if (isNew) setUrlConversation(evt.conversationId);
                }
                break;
            case 'text':
                if (typeof evt.text === 'string' && evt.text) {
                    view.typing.classList.add('hidden');
                    view.typing.classList.remove('flex');
                    view.text += evt.text;
                    scheduleRender(view);
                }
                break;
            case 'tool':
                toolChip(view, evt.name, evt.label);
                scrollToBottom(false);
                break;
            case 'tool_result':
                finishToolChip(view, evt);
                break;
            case 'done': {
                ctx.done = true;
                const msg = evt.message || {};
                if (typeof msg.text === 'string' && msg.text) view.text = msg.text;
                flushRender(view);
                renderActions(view, msg.actions);
                renderQuickAnswers(view, msg.quickAnswers);
                ctx.actions = msg.actions || [];
                break;
            }
            case 'error':
                ctx.errored = true;
                flushRender(view);
                showStreamError(view, evt.error || 'Something went wrong.', true);
                break;
            default:
                break;
        }
    }

    async function runStream(request) {
        state.lastRequest = request;
        clearOldQuickAnswers();
        const view = assistantShell();
        view.typing.classList.remove('hidden');
        view.typing.classList.add('flex');
        icons();
        scrollToBottom(true);

        const controller = new AbortController();
        const streamState = { controller, view, stopped: false };
        state.stream = streamState;
        setStreamingUi(true);
        const ctx = { done: false, errored: false, actions: [] };

        const body = { message: request.message };
        if (request.conversationId) body.conversationId = request.conversationId;
        if (request.command) body.command = request.command;
        if (request.references && request.references.length) body.references = request.references;
        if (request.mentions && request.mentions.length) body.mentions = request.mentions;
        body.chat = chatChoice();

        try {
            const res = await fetch(AGENT_URL, {
                method: 'POST',
                headers: Object.assign(authHeaders(true), { Accept: 'application/x-ndjson' }),
                body: JSON.stringify(body),
                signal: controller.signal,
                cache: 'no-store'
            });
            if (!res.ok) {
                let data = {};
                try { data = await res.json(); } catch (e) { data = {}; }
                if (res.status === 401) {
                    showSignInAgain();
                    throw new ApiError(401, data.error || 'Please sign in again.');
                }
                throw new ApiError(res.status, data.error || `Something went wrong (${res.status}).`);
            }
            if (!res.body || !res.body.getReader) {
                // Very old browsers: no streaming, parse the whole thing.
                const all = await res.text();
                all.split('\n').forEach((line) => {
                    if (line.trim()) { try { handleEvent(view, JSON.parse(line), ctx); } catch (e) { /* skip */ } }
                });
            } else {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    let nl;
                    while ((nl = buf.indexOf('\n')) >= 0) {
                        const line = buf.slice(0, nl).trim();
                        buf = buf.slice(nl + 1);
                        if (!line) continue;
                        let evt;
                        try { evt = JSON.parse(line); } catch (e) { continue; }
                        handleEvent(view, evt, ctx);
                    }
                }
                buf += decoder.decode();
                if (buf.trim()) {
                    try { handleEvent(view, JSON.parse(buf.trim()), ctx); } catch (e) { /* ignore partial */ }
                }
            }
            if (!ctx.done && !ctx.errored) {
                flushRender(view);
                showStreamError(view, view.text ? 'The response was cut off.' : 'No response from the assistant.', true);
                ctx.errored = true;
            }
        } catch (e) {
            flushRender(view);
            view.typing.classList.add('hidden');
            view.typing.classList.remove('flex');
            if (e && e.name === 'AbortError') {
                const note = document.createElement('p');
                note.className = 'text-[10px] font-mono uppercase tracking-widest text-gray-400';
                note.setAttribute('data-stopped', '');
                note.textContent = 'Stopped';
                view.error.innerHTML = '';
                view.error.appendChild(note);
                view.error.classList.remove('hidden');
                view.toolChips.forEach((c) => {
                    if (c.getAttribute('data-state') === 'running') {
                        c.setAttribute('data-state', 'stopped');
                        const ic = c.querySelector('i, svg');
                        if (ic) ic.classList.remove('spin');
                    }
                });
            } else if (e && e.status === 401) {
                showStreamError(view, 'Please sign in again.', false);
            } else {
                showStreamError(view, e && e.status ? e.message : 'Could not reach the assistant. Check your connection.', true);
            }
            ctx.errored = true;
        } finally {
            if (state.stream === streamState) state.stream = null;
            setStreamingUi(false);
            view.typing.classList.add('hidden');
            view.typing.classList.remove('flex');
            view.body.classList.remove('streaming-caret');
            if (view.text) renderFooter(view);
            if (view.text || ctx.done) {
                state.messages.push({ role: 'assistant', text: view.text, actions: ctx.actions, el: view.row });
            }
            if (ctx.done && state.convId) upsertConversation(state.convId, null, true);
            if (!view.text && ctx.done && !ctx.actions.length && !view.toolChips.length) {
                view.body.innerHTML = '<p class="text-gray-400">(No reply)</p>';
            }
            icons();
            scrollToBottom(false);
        }
    }

    // --- COMMAND PARSING & SEND ---
    function parseCommand(text) {
        const m = /^\s*\/([a-z-]+)(?=\s|$)\s*/i.exec(text);
        if (!m) return { cmd: null, rest: text };
        const cmd = COMMANDS.find((c) => c.name === m[1].toLowerCase());
        if (!cmd) return { cmd: null, rest: text };
        return { cmd, rest: text.slice(m[0].length) };
    }

    function collectMentions(text) {
        const out = [];
        const re = /@([\p{L}\p{N}_-]+)/gu;
        let m;
        while ((m = re.exec(text))) {
            const p = findPerson(m[1]);
            if (p && !out.includes(p)) out.push(p);
        }
        return out;
    }

    function refKey(r) {
        return r.type === 'note' ? 'note:' + r.id : r.type === 'meeting' ? 'meeting:' + r.code : r.type;
    }

    function collectReferences(text) {
        const refs = state.refs.map((r) => {
            if (r.type === 'note') return { type: 'note', id: r.id };
            if (r.type === 'meeting') return { type: 'meeting', code: r.code };
            return { type: 'group' };
        });
        const keys = new Set(refs.map(refKey));
        const add = (r) => { if (!keys.has(refKey(r))) { keys.add(refKey(r)); refs.push(r); } };
        // Typed-in references that were not picked from the popup.
        if (/(^|\s)#group(?=$|[\s.,!?;:])/i.test(text)) add({ type: 'group' });
        const meetRe = /(?:^|\s)#meeting:([A-Za-z0-9_-]+)/g;
        let m;
        while ((m = meetRe.exec(text))) add({ type: 'meeting', code: m[1] });
        if (state.notes) {
            const tagRe = /(?:^|\s)(#[\p{L}\p{N}_-]+)/gu;
            while ((m = tagRe.exec(text))) {
                const tok = m[1].toLowerCase();
                const note = state.notes.find((n) => noteToken(n.title).toLowerCase() === tok);
                if (note) add({ type: 'note', id: note.id });
            }
        }
        return refs;
    }

    function send() {
        const input = $('composer-input');
        const raw = input.value;
        const text = raw.trim();
        if (state.stream) return;
        if (!text && !state.refs.length) return;
        closeAutocomplete();

        const { cmd, rest } = parseCommand(text);
        if (cmd && !cmd.server) {
            input.value = '';
            autoGrow();
            if (cmd.name === 'new') newChat();
            else if (cmd.name === 'help') addHelpCard();
            else if (cmd.name === 'clear') {
                clearMessages();
                updateWelcome();
                toast('Cleared from view');
            }
            return;
        }

        const message = (cmd ? rest : text).trim();
        const mentions = collectMentions(message);
        const references = collectReferences(message);

        if (cmd) {
            const hasNote = references.some((r) => r.type === 'note');
            if (cmd.name === 'summarize' && !hasNote && !message) return toast('Add a note with # to summarize', 'error');
            if (cmd.name === 'note' && !message) return toast('Write the note text after /note', 'error');
            if (cmd.name === 'group' && !message) return toast('Write a message after /group', 'error');
            if (cmd.name === 'calendar' && !message) return toast('Say what to add after /calendar', 'error');
            if (cmd.name === 'poll' && !message) return toast('Write the question and answers after /poll', 'error');
            if (cmd.name === 'signup' && !message) return toast('Write the title and the slots after /signup', 'error');
            if (cmd.name === 'remind' && !mentions.length) return toast('Mention someone with @ to remind', 'error');
        }

        addUserMessage(message, cmd ? cmd.name : null);
        input.value = '';
        state.refs = [];
        renderRefChips();
        autoGrow();
        scrollToBottom(true);
        runStream({
            conversationId: state.convId || undefined,
            message,
            command: cmd ? cmd.name : undefined,
            mentions,
            references
        });
    }

    // --- REFERENCE CHIPS ---
    function refLabel(r) {
        if (r.type === 'group') return 'Group chat';
        if (r.type === 'meeting') return 'Meeting ' + r.code;
        return r.label || 'Note';
    }

    function addRef(r) {
        if (state.refs.some((x) => refKey(x) === refKey(r))) return;
        state.refs.push(r);
        renderRefChips();
    }

    function renderRefChips() {
        const wrap = $('ref-chips');
        wrap.innerHTML = '';
        if (!state.refs.length) {
            wrap.classList.add('hidden');
            wrap.classList.remove('flex');
            return;
        }
        state.refs.forEach((r, i) => {
            const chip = document.createElement('span');
            chip.className = 'inline-flex items-center gap-1.5 max-w-full pl-3 pr-1 py-1 rounded-full bg-gray-50 border border-gray-200 text-xs text-gray-700';
            chip.setAttribute('data-ref-chip', refKey(r));
            const ic = document.createElement('i');
            ic.setAttribute('data-lucide', r.type === 'group' ? 'messages-square' : r.type === 'meeting' ? 'video' : 'file-text');
            ic.className = 'w-3.5 h-3.5 shrink-0 text-gray-400';
            chip.appendChild(ic);
            const label = document.createElement('span');
            label.className = 'truncate max-w-[12rem]';
            label.textContent = refLabel(r);
            chip.appendChild(label);
            const x = document.createElement('button');
            x.type = 'button';
            x.title = 'Remove';
            x.setAttribute('aria-label', 'Remove reference ' + refLabel(r));
            x.className = 'w-7 h-7 -my-1 rounded-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-200 relative after:absolute after:-inset-1.5 after:content-[\'\']';
            x.innerHTML = '<i data-lucide="x" class="w-3.5 h-3.5"></i>';
            x.addEventListener('click', () => removeRef(i));
            chip.appendChild(x);
            wrap.appendChild(chip);
        });
        wrap.classList.remove('hidden');
        wrap.classList.add('flex');
        icons();
    }

    function removeRef(i) {
        const r = state.refs[i];
        if (!r) return;
        state.refs.splice(i, 1);
        // Also drop the matching token from the text if it is still there.
        const input = $('composer-input');
        if (r.token) {
            const esc = r.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            input.value = input.value.replace(new RegExp('(^|\\s)' + esc + '(?=\\s|$) ?'), '$1');
            autoGrow();
        }
        renderRefChips();
        input.focus();
    }

    // --- AUTOCOMPLETE ---
    function tokenAtCursor() {
        const input = $('composer-input');
        const pos = input.selectionStart;
        if (pos !== input.selectionEnd) return null;
        const before = input.value.slice(0, pos);
        const m = /(^|\s)([/@#][^\s]*)$/.exec(before);
        if (!m) return null;
        const token = m[2];
        const start = pos - token.length;
        // Extend to the end of the word after the caret.
        const after = input.value.slice(pos);
        const tail = /^[^\s]*/.exec(after)[0];
        if (token[0] === '/' && before.slice(0, start).trim() !== '') return null;
        return { kind: token[0], query: token.slice(1), start, end: pos + tail.length };
    }

    function updateAutocomplete() {
        const tok = tokenAtCursor();
        if (!tok) return closeAutocomplete();
        const q = tok.query.toLowerCase();
        let items = [];
        let head = '';

        if (tok.kind === '/') {
            head = 'Commands';
            items = COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({
                kind: 'command', icon: COMMAND_ICONS[c.name], label: '/' + c.name,
                hint: c.args, desc: c.desc, value: c
            }));
        } else if (tok.kind === '@') {
            head = 'People';
            items = state.people.filter((p) => p.toLowerCase().startsWith(q) || p.toLowerCase().includes(q))
                .map((p) => ({ kind: 'person', initial: p.charAt(0), label: '@' + p, desc: '', value: p }));
        } else if (tok.kind === '#') {
            head = 'References';
            const meet = /^meeting:([A-Za-z0-9_-]+)$/i.exec(tok.query);
            if (meet) {
                items.push({ kind: 'meeting', icon: 'video', label: '#meeting:' + meet[1], desc: 'Meeting ' + meet[1], value: meet[1] });
            } else if ('meeting:'.startsWith(q) && q.length >= 2) {
                items.push({ kind: 'meeting-hint', icon: 'video', label: '#meeting:', hint: 'code', desc: 'Type a meeting code', value: null });
            }
            if ('group'.startsWith(q) || 'group chat'.includes(q)) {
                items.push({ kind: 'group', icon: 'messages-square', label: '#group', desc: 'Group chat', value: null });
            }
            if (!meet) {
                if (state.notes) {
                    const words = q.replace(/[-_]+/g, ' ').trim();
                    state.notes
                        .filter((n) => !words || String(n.title || '').toLowerCase().includes(words) ||
                            noteToken(n.title).toLowerCase().slice(1).startsWith(q))
                        .slice(0, 30)
                        .forEach((n) => items.push({
                            kind: 'note', icon: 'file-text', label: n.title || 'Untitled',
                            desc: n.owner && state.user && n.owner !== state.user.name ? 'Note · ' + n.owner : 'Note',
                            value: n
                        }));
                } else {
                    items.push({ kind: 'loading', icon: 'loader-circle', label: 'Loading notes…', desc: '', value: null });
                    ensureNotes().then(() => {
                        if (state.ac.open && state.ac.kindChar === '#') updateAutocomplete();
                    }).catch((e) => {
                        if (state.ac.open && state.ac.kindChar === '#') {
                            state.notesError = e.message;
                            updateAutocomplete();
                        }
                    });
                }
            }
            if (state.notesError && !state.notes) {
                items = items.filter((i) => i.kind !== 'loading');
                items.push({ kind: 'loading', icon: 'circle-alert', label: 'Could not load notes', desc: '', value: null });
                state.notesError = null;
            }
        }

        const selectable = items.filter((i) => i.kind !== 'loading');
        if (!items.length || (!selectable.length && tok.kind !== '#')) return closeAutocomplete();

        const sameKind = state.ac.open && state.ac.kindChar === tok.kind && state.ac.query === tok.query;
        state.ac = {
            open: true, kindChar: tok.kind, query: tok.query, items, start: tok.start, end: tok.end,
            index: sameKind ? Math.min(state.ac.index, Math.max(0, items.length - 1)) : firstSelectable(items)
        };
        renderAutocomplete(head);
    }

    function firstSelectable(items) {
        const i = items.findIndex((x) => x.kind !== 'loading');
        return i < 0 ? 0 : i;
    }

    function renderAutocomplete(head) {
        const pop = $('ac-popup');
        const list = $('ac-list');
        $('ac-head').textContent = head;
        list.innerHTML = '';
        state.ac.items.forEach((it, i) => {
            const li = document.createElement('li');
            li.id = 'ac-opt-' + i;
            li.setAttribute('role', 'option');
            li.setAttribute('data-ac-index', String(i));
            const active = i === state.ac.index && it.kind !== 'loading';
            li.setAttribute('aria-selected', active ? 'true' : 'false');
            li.className = 'flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-xl ' +
                (it.kind === 'loading' ? 'text-gray-400 cursor-default' : 'cursor-pointer ') +
                (active ? 'bg-gray-100' : (it.kind === 'loading' ? '' : 'hover:bg-gray-50'));
            const lead = document.createElement('span');
            lead.className = 'w-8 h-8 shrink-0 rounded-full flex items-center justify-center ' +
                (it.kind === 'person' ? 'bg-black text-white font-serif text-sm' : 'bg-gray-50 border border-gray-100 text-gray-600');
            if (it.kind === 'person') lead.textContent = it.initial;
            else lead.innerHTML = `<i data-lucide="${it.icon}" class="w-4 h-4 ${it.kind === 'loading' && it.icon === 'loader-circle' ? 'spin' : ''}"></i>`;
            li.appendChild(lead);
            const textWrap = document.createElement('span');
            textWrap.className = 'min-w-0 flex-1';
            const main = document.createElement('span');
            main.className = 'block truncate text-sm ' + (it.kind === 'note' || it.kind === 'loading' ? '' : 'font-mono text-[13px]') + ' text-black';
            main.textContent = it.label;
            if (it.hint) {
                const h = document.createElement('span');
                h.className = 'ml-1.5 font-mono text-[11px] text-gray-400';
                h.textContent = it.hint;
                main.appendChild(h);
            }
            textWrap.appendChild(main);
            if (it.desc) {
                const d = document.createElement('span');
                d.className = 'block truncate text-xs text-gray-500 font-light';
                d.textContent = it.desc;
                textWrap.appendChild(d);
            }
            li.appendChild(textWrap);
            list.appendChild(li);
        });
        pop.classList.remove('hidden');
        const input = $('composer-input');
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('aria-activedescendant', 'ac-opt-' + state.ac.index);
        const act = $('ac-opt-' + state.ac.index);
        if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
        icons();
    }

    function closeAutocomplete() {
        if (!state.ac.open && $('ac-popup').classList.contains('hidden')) return;
        state.ac = { open: false, kind: null, items: [], index: 0, start: 0, end: 0 };
        $('ac-popup').classList.add('hidden');
        const input = $('composer-input');
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }

    function moveAc(delta) {
        const n = state.ac.items.length;
        if (!n) return;
        let i = state.ac.index;
        for (let k = 0; k < n; k++) {
            i = (i + delta + n) % n;
            if (state.ac.items[i].kind !== 'loading') break;
        }
        state.ac.index = i;
        renderAutocomplete($('ac-head').textContent);
    }

    function replaceToken(text, keepOpen) {
        const input = $('composer-input');
        const v = input.value;
        const before = v.slice(0, state.ac.start);
        let after = v.slice(state.ac.end);
        let insert = text;
        if (!keepOpen) {
            if (after.startsWith(' ')) after = after.slice(1);
            insert += ' ';
        }
        input.value = before + insert + after;
        const caret = before.length + insert.length;
        input.setSelectionRange(caret, caret);
        autoGrow();
    }

    function selectAc(index) {
        const it = state.ac.items[index];
        if (!it || it.kind === 'loading') return;
        const input = $('composer-input');
        if (it.kind === 'command') {
            const c = it.value;
            if (!c.server) {
                // Client-side commands run right away.
                input.value = '/' + c.name;
                closeAutocomplete();
                send();
                return;
            }
            replaceToken('/' + c.name);
            closeAutocomplete();
            // Chain into the natural next token.
            if (c.name === 'summarize' || c.name === 'remind') {
                const ch = c.name === 'summarize' ? '#' : '@';
                const pos = input.selectionStart;
                input.value = input.value.slice(0, pos) + ch + input.value.slice(pos);
                input.setSelectionRange(pos + 1, pos + 1);
                autoGrow();
                updateAutocomplete();
            }
        } else if (it.kind === 'person') {
            replaceToken('@' + it.value);
            closeAutocomplete();
        } else if (it.kind === 'group') {
            replaceToken('#group');
            addRef({ type: 'group', token: '#group' });
            closeAutocomplete();
        } else if (it.kind === 'meeting') {
            const token = '#meeting:' + it.value;
            replaceToken(token);
            addRef({ type: 'meeting', code: it.value, token });
            closeAutocomplete();
        } else if (it.kind === 'meeting-hint') {
            replaceToken('#meeting:', true);
            closeAutocomplete();
        } else if (it.kind === 'note') {
            const token = noteToken(it.value.title);
            replaceToken(token);
            addRef({ type: 'note', id: it.value.id, label: it.value.title || 'Untitled', token });
            closeAutocomplete();
        }
        input.focus();
    }

    // --- COMPOSER ---
    function autoGrow() {
        const ta = $('composer-input');
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
    }

    function insertSuggestion(text) {
        const input = $('composer-input');
        input.value = text;
        autoGrow();
        input.focus();
        input.setSelectionRange(text.length, text.length);
        updateAutocomplete();
    }

    function renderSuggestions() {
        $('suggestions').innerHTML = SUGGESTIONS.map((s, i) => `
            <button type="button" data-suggest="${i}" class="group text-left bg-white border border-gray-100 rounded-3xl p-4 sm:p-5 min-h-[44px] hover:border-gray-300 hover:shadow-md transition-all flex items-start gap-3">
                <span class="w-10 h-10 shrink-0 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-600 group-hover:bg-black group-hover:text-white group-hover:border-black transition-colors"><i data-lucide="${s.icon}" class="w-4 h-4"></i></span>
                <span class="min-w-0">
                    <span class="block text-sm font-medium text-black">${escapeHtml(s.title)}</span>
                    <span class="block text-xs text-gray-400 font-light mt-0.5">${escapeHtml(s.sub)}</span>
                    <span class="block font-mono text-[11px] text-gray-500 mt-2">${escapeHtml(s.insert.trim())}</span>
                </span>
            </button>`).join('');
    }

    function renderUserChip() {
        const chip = $('user-chip');
        if (!state.user) return;
        chip.innerHTML = `<span class="w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center text-black font-serif text-xs">${escapeHtml(String(state.user.name || '?').charAt(0))}</span><span class="truncate hidden sm:inline">${escapeHtml(state.user.name)}</span>`;
        chip.classList.remove('hidden');
        chip.classList.add('flex');
        $('welcome-title').textContent = `How can I help, ${state.user.name}?`;
    }

    function bindEvents() {
        const input = $('composer-input');
        $('composer').addEventListener('submit', (e) => {
            e.preventDefault();
            send();
        });
        input.addEventListener('input', () => {
            autoGrow();
            updateAutocomplete();
        });
        input.addEventListener('click', updateAutocomplete);
        input.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') updateAutocomplete();
        });
        input.addEventListener('blur', () => setTimeout(() => {
            if (document.activeElement !== input) closeAutocomplete();
        }, 150));
        input.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (state.ac.open) {
                if (e.key === 'ArrowDown') { e.preventDefault(); moveAc(1); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); moveAc(-1); return; }
                if (e.key === 'Escape') { e.preventDefault(); closeAutocomplete(); return; }
                if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                    const it = state.ac.items[state.ac.index];
                    if (it && it.kind !== 'loading') {
                        e.preventDefault();
                        selectAc(state.ac.index);
                        return;
                    }
                    if (e.key === 'Tab') return;
                }
            }
            if (e.key === 'Enter' && !e.shiftKey && !coarsePointer()) {
                e.preventDefault();
                send();
            }
            if (e.key === 'Escape' && state.stream) stopStream();
        });

        const list = $('ac-list');
        $('ac-popup').addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the textarea
        list.addEventListener('click', (e) => {
            const li = e.target.closest('[data-ac-index]');
            if (li) selectAc(Number(li.getAttribute('data-ac-index')));
        });

        $('btn-stop').addEventListener('click', stopStream);
        $('btn-new').addEventListener('click', () => newChat());
        $('btn-new-header').addEventListener('click', () => newChat());
        $('btn-drawer').addEventListener('click', openDrawer);
        $('btn-drawer-close').addEventListener('click', closeDrawer);
        $('drawer-backdrop').addEventListener('click', closeDrawer);
        $('btn-signin').addEventListener('click', signInAgain);

        $('conv-list').addEventListener('click', (e) => {
            const del = e.target.closest('[data-del]');
            if (del) { onDeleteClick(del); return; }
            const open = e.target.closest('[data-conv]');
            if (open) {
                const id = open.getAttribute('data-conv');
                if (id === state.convId && $('messages').children.length) { closeDrawer(); return; }
                openConversation(id);
            }
        });

        $('suggestions').addEventListener('click', (e) => {
            const b = e.target.closest('[data-suggest]');
            if (b) insertSuggestion(SUGGESTIONS[Number(b.getAttribute('data-suggest'))].insert);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !$('sidebar').classList.contains('-translate-x-full') && !isDesktop()) closeDrawer();
        });

        window.matchMedia('(min-width: 1024px)').addEventListener('change', () => {
            const sb = $('sidebar');
            $('drawer-backdrop').classList.add('hidden');
            sb.classList.add('-translate-x-full');
            if (!isDesktop()) sb.classList.add('invisible');
            $('btn-drawer').setAttribute('aria-expanded', 'false');
        });
        window.addEventListener('resize', autoGrow);
    }

    let started = false;
    // ---------- which group chat the AI posts to (the one without Emilia unless you change it) ----------
    const CHAT_KEY = 'chowaniec_ai_chat';
    function chatChoice() {
        const sel = document.getElementById('chat-pick');
        if (sel && sel.value) return sel.value;
        try { return localStorage.getItem(CHAT_KEY) || 'no-emilia'; } catch (e) { return 'no-emilia'; }
    }
    async function loadChatPicker() {
        const sel = document.getElementById('chat-pick');
        if (!sel) return;
        try {
            const data = await api('/.netlify/functions/group?rooms=1');
            const rooms = data.rooms || [];
            if (rooms.length < 2) return;
            let saved = 'no-emilia';
            try { saved = localStorage.getItem(CHAT_KEY) || 'no-emilia'; } catch (e) { /* ignore */ }
            if (!rooms.some((r) => r.id === saved)) saved = (rooms.find((r) => r.id === 'no-emilia') || rooms[0]).id;
            sel.innerHTML = rooms.map((r) => `<option value="${r.id}">${String(r.name).replace(/[<>&"]/g, '')}</option>`).join('');
            sel.value = saved;
            sel.addEventListener('change', () => { try { localStorage.setItem(CHAT_KEY, sel.value); } catch (e) { /* ignore */ } });
            const wrap = document.getElementById('chat-pick-wrap');
            wrap.classList.remove('hidden'); wrap.classList.add('flex');
        } catch (e) { /* the picker just stays hidden */ }
    }

    async function start() {
        if (started) return;
        state.user = getUser();
        if (!state.user || !state.user.key) {
            showSignInAgain();
            return;
        }
        started = true;
        state.people = loadPeople();
        configureSanitizer();
        bindEvents();
        loadChatPicker();
        const hb = document.getElementById('hdr-bob');
        if (hb && window.ChowaniecRobot) hb.innerHTML = window.ChowaniecRobot.face();
        renderUserChip();
        renderSuggestions();
        renderConversations();
        autoGrow();

        const deepId = new URLSearchParams(window.location.search).get('c');
        const listPromise = loadConversations();
        if (deepId) await openConversation(deepId);
        else updateWelcome();
        icons();
        await listPromise;
        if (!coarsePointer()) $('composer-input').focus();
    }

    // Test/debug hook (read-only view of state).
    window.ChowaniecAI = {
        state: () => ({ convId: state.convId, refs: state.refs.slice(), streaming: !!state.stream, people: state.people.slice() })
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
