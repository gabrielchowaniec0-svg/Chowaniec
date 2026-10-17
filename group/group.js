// Chowaniec Group: the family group chat. Talks to /.netlify/functions/group (see API spec).
(function () {
    'use strict';

    const API = '/.netlify/functions/group';
    const POLL_VISIBLE_MS = 3000;
    const POLL_HIDDEN_MS = 30000;
    const FULL_SYNC_MS = 20000;           // re-read the latest 50 to pick up reactions & deletions
    const GROUP_GAP_MS = 5 * 60 * 1000;   // consecutive messages within 5 min are grouped
    const NEAR_BOTTOM_PX = 120;
    const MAX_IMAGE_EDGE = 1600;
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
    const QUICK_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🎉'];
    const AI_NAME = 'Chowaniec AI';
    const AVATAR_COLORS = [
        ['#fee2e2', '#991b1b'], ['#ffedd5', '#9a3412'], ['#dcfce7', '#166534'], ['#dbeafe', '#1e40af'],
        ['#fce7f3', '#9d174d'], ['#e0f2fe', '#075985'], ['#fef9c3', '#854d0e'], ['#ccfbf1', '#115e59'],
        ['#ede9fe', '#5b21b6'], ['#f1f5f9', '#334155']
    ];

    const state = {
        started: false,
        user: null,
        people: [],
        byId: new Map(),
        messages: [],          // server messages, sorted oldest -> newest
        pending: [],           // optimistic messages not yet confirmed by the server
        latestId: null,
        lastFull: 0,
        hasMore: false,
        loaded: false,
        loadingOlder: false,
        olderError: false,
        polling: false,
        pollTimer: null,
        failures: 0,
        stopped: false,
        stick: true,
        unseen: 0,
        hiddenUnseen: 0,
        replyTo: null,
        image: null,           // { dataUrl, width, height, bytes }
        mention: null,         // { start, query, options, index }
        menuFor: null,
        confirmId: null,
        aiThinkingUntil: 0,
        push: 'loading',
        pushBusy: false,
        nodeCache: new Map()
    };

    const $ = (id) => document.getElementById(id);
    const isFinePointer = () => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // ---------- helpers ----------
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function icons(root) {
        if (!window.lucide) return;
        try {
            window.lucide.createIcons(root ? { root } : undefined);
        } catch (e) { /* ignore */ }
    }

    let toastTimer = null;
    function toast(message, kind) {
        const el = $('toast');
        el.innerHTML = `<i data-lucide="${kind === 'error' ? 'circle-alert' : 'check'}" class="w-4 h-4 shrink-0 ${kind === 'error' ? 'text-red-300' : 'text-emerald-300'}"></i><span>${escapeHtml(message)}</span>`;
        el.classList.remove('hidden');
        el.classList.add('flex');
        icons(el);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('flex'); }, 3200);
    }

    function show(el, display) { el.classList.remove('hidden'); el.classList.add(display || 'flex'); }
    function hide(el, display) { el.classList.add('hidden'); el.classList.remove(display || 'flex'); }

    function ts(m) {
        const v = m && m.createdAt;
        if (typeof v === 'number') return v;
        const t = Date.parse(v);
        return isNaN(t) ? 0 : t;
    }

    function compareMsgs(a, b) {
        const d = ts(a) - ts(b);
        if (d) return d;
        const ai = String(a.id), bi = String(b.id);
        return ai < bi ? -1 : ai > bi ? 1 : 0;
    }

    function sameName(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }
    function isMine(m) { return !!state.user && m.kind !== 'ai' && m.kind !== 'system' && sameName(m.user, state.user.name); }
    function displayName(m) { return m.kind === 'ai' ? (m.user || AI_NAME) : (m.user || 'Someone'); }

    function avatarColors(name) {
        let h = 0;
        const s = String(name || '?');
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return AVATAR_COLORS[h % AVATAR_COLORS.length];
    }

    function initial(name) {
        const s = String(name || '?').trim();
        return s ? Array.from(s)[0].toUpperCase() : '?';
    }

    function dayKey(t) {
        const d = new Date(t);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }

    function dayLabel(t) {
        const d = new Date(t);
        const today = new Date();
        const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const startD = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diff = Math.round((startToday - startD) / 86400000);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
        const opts = { weekday: 'short', month: 'short', day: 'numeric' };
        if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
        return d.toLocaleDateString([], opts);
    }

    function timeLabel(t) {
        return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function fullTime(t) {
        return new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function mediaUrl(id) { return `${API}?media=${encodeURIComponent(id)}`; }

    function snippet(text, n) {
        const s = String(text || '').replace(/\s+/g, ' ').trim();
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    function loadPeople() {
        let names = [];
        try {
            if (typeof window.chowaniecPeople === 'function') names = window.chowaniecPeople() || [];
        } catch (e) { names = []; }
        if (!names.length) {
            const hashes = (window.CHOWANIEC_CONFIG && window.CHOWANIEC_CONFIG.PASSCODE_HASHES) || {};
            names = Object.values(hashes).map((u) => u && u.name).filter((n) => n && n !== 'Guest');
        }
        return [...new Set(names.filter(Boolean).map(String))];
    }

    // ---------- text formatting (escape everything; only http/https links) ----------
    function knownMentionNames() {
        const set = new Set(state.people.map((n) => n.toLowerCase()));
        set.add('everyone');
        set.add('ai');
        return set;
    }

    function mentionsMe(m) {
        if (!state.user || isMine(m) || m.kind === 'system') return false;
        const me = state.user.name.toLowerCase();
        const list = (Array.isArray(m.mentions) ? m.mentions : []).map((n) => String(n).toLowerCase());
        if (list.includes(me) || list.includes('everyone')) return true;
        const re = /@([A-Za-z][A-Za-z0-9_-]*)/g;
        let x;
        while ((x = re.exec(m.text || ''))) {
            const n = x[1].toLowerCase();
            if (n === me || n === 'everyone') return true;
        }
        return false;
    }

    function safeHttpUrl(raw) {
        try {
            const u = new URL(raw);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
            return u.href;
        } catch (e) {
            return null;
        }
    }

    function formatText(text, extraNames) {
        const src = String(text || '');
        const known = knownMentionNames();
        (extraNames || []).forEach((n) => known.add(String(n).toLowerCase()));
        const me = state.user ? state.user.name.toLowerCase() : '';
        const re = /(https?:\/\/[^\s<>"'`]+)|@([A-Za-z][A-Za-z0-9_-]*)/gi;
        let out = '';
        let last = 0;
        let x;
        while ((x = re.exec(src))) {
            const idx = x.index;
            if (x[1]) {
                let url = x[1];
                let trail = '';
                while (/[.,!?;:'")\]}]$/.test(url)) {
                    const ch = url.slice(-1);
                    if (ch === ')' && (url.split('(').length > url.split(')').length - 1)) break;
                    trail = ch + trail;
                    url = url.slice(0, -1);
                }
                const href = safeHttpUrl(url);
                out += escapeHtml(src.slice(last, idx));
                if (href) out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
                else out += escapeHtml(url);
                out += escapeHtml(trail);
                last = idx + x[0].length;
            } else {
                const prev = idx > 0 ? src[idx - 1] : '';
                const name = x[2];
                if (/[\w@]/.test(prev) || !known.has(name.toLowerCase())) continue;
                const lower = name.toLowerCase();
                const isMe = lower === me || (lower === 'everyone');
                out += escapeHtml(src.slice(last, idx));
                out += `<span class="mention${isMe ? ' me' : ''}">@${escapeHtml(name)}</span>`;
                last = idx + x[0].length;
            }
        }
        out += escapeHtml(src.slice(last));
        return out;
    }

    function isEmojiOnly(text) {
        const s = String(text || '').replace(/\s+/g, '');
        if (!s || s.length > 32) return false;
        let pics;
        try {
            pics = s.match(/\p{Extended_Pictographic}/gu);
            if (!pics || pics.length > 3) return false;
            const rest = s.replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|[‍️⃣]|\p{Regional_Indicator}/gu, '');
            return rest.length === 0;
        } catch (e) {
            return false;
        }
    }

    // ---------- API ----------
    class ApiError extends Error {
        constructor(status, message) {
            super(message);
            this.status = status;
        }
    }

    function getUser() {
        return typeof window.getChowaniecUser === 'function' ? window.getChowaniecUser() : null;
    }

    function handleUnauthorized() {
        if (state.stopped) return;
        state.stopped = true;
        clearTimeout(state.pollTimer);
        try {
            if (typeof window.clearChowaniecSession === 'function') window.clearChowaniecSession();
            else {
                sessionStorage.removeItem('chowaniec_authenticated');
                sessionStorage.removeItem('chowaniec_user');
            }
        } catch (e) { /* ignore */ }
        show($('signin-modal'));
        icons($('signin-modal'));
    }

    async function api(url, options) {
        const opts = options || {};
        const user = getUser();
        if (!user || !user.key) {
            handleUnauthorized();
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
                cache: 'no-store'
            });
        } catch (e) {
            throw new ApiError(0, 'Could not reach the server. Check your connection.');
        }
        let data = {};
        try { data = await res.json(); } catch (e) { data = {}; }
        if (res.status === 401) {
            handleUnauthorized();
            throw new ApiError(401, data.error || 'Please sign in again.');
        }
        if (!res.ok) throw new ApiError(res.status, data.error || `Something went wrong (${res.status}).`);
        return data;
    }

    // ---------- message store ----------
    function resort() {
        state.messages = Array.from(state.byId.values()).sort(compareMsgs);
    }

    // Adds/replaces messages. Returns the number of brand-new messages from other people.
    function upsert(list) {
        let freshFromOthers = 0;
        let aiArrived = false;
        (list || []).forEach((m) => {
            if (!m || m.id == null) return;
            if (!state.byId.has(m.id)) {
                if (!isMine(m)) freshFromOthers++;
                if (m.kind === 'ai') aiArrived = true;
            }
            state.byId.set(m.id, m);
        });
        if (aiArrived) state.aiThinkingUntil = 0;
        resort();
        return freshFromOthers;
    }

    function reconcileLatest(list) {
        const msgs = Array.isArray(list) ? list.slice().sort(compareMsgs) : [];
        if (!msgs.length) {
            state.byId.clear();
        } else {
            const oldest = msgs[0];
            const keep = new Set(msgs.map((m) => m.id));
            state.messages.forEach((m) => {
                if (compareMsgs(m, oldest) >= 0 && !keep.has(m.id)) state.byId.delete(m.id);
            });
        }
        const fresh = upsert(msgs);
        if (msgs.length) state.latestId = msgs[msgs.length - 1].id;
        else state.latestId = null;
        return fresh;
    }

    // ---------- rendering ----------
    function hoverActionsHtml(id) {
        return `<div class="hover-actions" aria-hidden="false">
            <button type="button" data-act="menu" data-id="${escapeHtml(id)}" title="React"><i data-lucide="smile-plus" class="w-4 h-4"></i></button>
            <button type="button" data-act="reply" data-id="${escapeHtml(id)}" title="Reply"><i data-lucide="reply" class="w-4 h-4"></i></button>
            <button type="button" data-act="menu" data-id="${escapeHtml(id)}" title="More"><i data-lucide="ellipsis" class="w-4 h-4"></i></button>
        </div>`;
    }

    function avatarHtml(m) {
        if (m.kind === 'ai') {
            return `<div class="avatar" style="background:#7c3aed;color:#fff" aria-hidden="true"><i data-lucide="sparkles" class="w-4 h-4"></i></div>`;
        }
        const [bg, fg] = avatarColors(m.user);
        return `<div class="avatar" style="background:${bg};color:${fg}" aria-hidden="true">${escapeHtml(initial(m.user))}</div>`;
    }

    function reactionsHtml(m) {
        const r = m.reactions && typeof m.reactions === 'object' ? m.reactions : {};
        const me = state.user ? state.user.name : '';
        const chips = Object.keys(r)
            .filter((emoji) => Array.isArray(r[emoji]) && r[emoji].length)
            .map((emoji) => {
                const names = r[emoji].map(String);
                const on = names.some((n) => sameName(n, me));
                return `<button type="button" class="react-chip${on ? ' on' : ''}" data-act="react" data-id="${escapeHtml(m.id)}" data-emoji="${escapeHtml(emoji)}" title="${escapeHtml(names.join(', '))}" aria-pressed="${on}"><span>${escapeHtml(emoji)}</span><span class="n">${names.length}</span></button>`;
            });
        return chips.length ? `<div class="reactions">${chips.join('')}</div>` : '';
    }

    function messageHtml(m, flags) {
        const mine = flags.mine;
        const t = ts(m);
        const classes = ['msg-row', mine ? 'mine' : 'theirs'];
        if (m.kind === 'ai') classes.push('ai');
        if (flags.start) classes.push('group-start');
        if (flags.end) classes.push('group-end');
        if (m._pending) classes.push(m._pending === 'failed' ? 'failed' : 'pending');

        let meta = '';
        if (flags.start) {
            meta = mine
                ? `<div class="msg-meta"><span class="when">${escapeHtml(timeLabel(t))}</span></div>`
                : `<div class="msg-meta"><span class="who">${escapeHtml(displayName(m))}</span><span class="when">${escapeHtml(timeLabel(t))}</span></div>`;
        }

        const hasImage = !!(m.image || m._localImage);
        const text = String(m.text || '');
        const emojiOnly = !hasImage && !m.replyTo && isEmojiOnly(text);
        const bubbleCls = ['bubble'];
        if (hasImage) bubbleCls.push('has-image');
        if (emojiOnly) bubbleCls.push('emoji-only');
        if (flags.mentionsMe) bubbleCls.push('mentions-me');

        let inner = '';
        if (m.replyTo && typeof m.replyTo === 'object') {
            const rt = m.replyTo;
            const rtText = rt.text ? snippet(rt.text, 140) : 'Photo';
            inner += `<button type="button" class="reply-quote" data-act="jump" data-id="${escapeHtml(rt.id)}" title="Show original message"><b>${escapeHtml(rt.user || 'Message')}</b><span>${escapeHtml(rtText)}</span></button>`;
        }
        if (hasImage) {
            const src = m._localImage || mediaUrl(m.image);
            inner += `<button type="button" class="msg-img-btn" data-act="lightbox" data-src="${escapeHtml(src)}" data-caption="${escapeHtml(displayName(m) + ' · ' + fullTime(t))}" title="Open photo"><img src="${escapeHtml(src)}" alt="Photo from ${escapeHtml(displayName(m))}" loading="lazy" decoding="async"></button>`;
        }
        if (text) inner += `<span class="msg-text">${formatText(text, m.mentions)}</span>`;

        let status = '';
        if (m._pending === 'sending') status = `<div class="msg-status">Sending…</div>`;
        else if (m._pending === 'failed') {
            status = `<button type="button" class="msg-status failed" data-act="retry" data-id="${escapeHtml(m.id)}"><i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i> Failed — tap to retry</button>`;
        }

        return `<div class="${classes.join(' ')}" data-id="${escapeHtml(m.id)}">
            ${mine ? '' : (flags.start ? avatarHtml(m) : '<div class="avatar-spacer"></div>')}
            <div class="msg-col">
                ${meta}
                <div class="${bubbleCls.join(' ')}" data-bubble="1" data-id="${escapeHtml(m.id)}" title="${escapeHtml(fullTime(t))}">${inner}</div>
                ${reactionsHtml(m)}
                ${status}
            </div>
            ${m._pending ? '' : hoverActionsHtml(m.id)}
        </div>`;
    }

    function pendingAsMessage(p) {
        return {
            id: p.tempId,
            user: state.user ? state.user.name : '',
            text: p.text,
            createdAt: p.createdAt,
            kind: 'user',
            mentions: [],
            replyTo: p.replyTo,
            image: null,
            reactions: {},
            _localImage: p.imageData || null,
            _pending: p.status
        };
    }

    function buildItems() {
        const all = state.messages.concat(state.pending.map(pendingAsMessage));
        const items = [];
        const groupKey = (m) => (m.kind === 'system' ? null : `${m.kind || 'user'}|${String(m.user || '').toLowerCase()}`);
        const continues = (a, b) => !!a && !!b && a.kind !== 'system' && b.kind !== 'system' &&
            groupKey(a) === groupKey(b) && dayKey(ts(a)) === dayKey(ts(b)) && Math.abs(ts(b) - ts(a)) <= GROUP_GAP_MS;

        for (let i = 0; i < all.length; i++) {
            const m = all[i];
            const prev = all[i - 1];
            const next = all[i + 1];
            const t = ts(m);
            if (!prev || dayKey(ts(prev)) !== dayKey(t)) {
                const label = dayLabel(t);
                items.push({ key: `day:${dayKey(t)}`, sig: label, html: `<div class="day-sep" role="separator"><span>${escapeHtml(label)}</span></div>` });
            }
            if (m.kind === 'system') {
                items.push({ key: `m:${m.id}`, sig: `sys|${m.text}`, html: `<div class="sys-row" data-id="${escapeHtml(m.id)}">${formatText(m.text, m.mentions)}</div>` });
                continue;
            }
            const flags = {
                mine: isMine(m),
                start: !continues(prev, m),
                end: !continues(m, next),
                mentionsMe: mentionsMe(m)
            };
            const sig = JSON.stringify([m.text, m.image, m._localImage ? m._localImage.length : 0, m.replyTo, m.reactions, m._pending, m.user, m.kind, flags, dayLabel(t)]);
            items.push({ key: `m:${m.id}`, sig, html: messageHtml(m, flags) });
        }

        if (state.aiThinkingUntil > Date.now()) {
            items.push({
                key: 'ai-typing',
                sig: 'typing',
                html: `<div class="msg-row theirs ai group-start group-end" aria-label="Chowaniec AI is thinking">
                    ${avatarHtml({ kind: 'ai' })}
                    <div class="msg-col"><div class="msg-meta"><span class="who">${AI_NAME}</span></div>
                    <div class="bubble"><span class="inline-flex items-center gap-2 text-violet-700"><i data-lucide="loader-circle" class="w-4 h-4 spin"></i> Thinking…</span></div></div>
                </div>`
            });
        }
        return items;
    }

    function htmlToEl(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html.trim();
        return tpl.content.firstElementChild;
    }

    function distanceFromBottom() {
        const sc = $('scroller');
        return sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    }

    function scrollToBottom(smooth) {
        const sc = $('scroller');
        if (smooth && sc.scrollTo) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
        else sc.scrollTop = sc.scrollHeight;
        state.stick = true;
        state.unseen = 0;
        renderPill();
    }

    function findAnchor() {
        const sc = $('scroller');
        const top = sc.getBoundingClientRect().top;
        const rows = $('messages').children;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect();
            if (r.bottom > top + 1) return { el: rows[i], top: r.top };
        }
        return null;
    }

    // mode: 'auto' (keep position, follow bottom if already there) | 'bottom' (force scroll to newest)
    function render(mode) {
        const sc = $('scroller');
        const wasNearBottom = state.stick || distanceFromBottom() < NEAR_BOTTOM_PX;
        const anchor = wasNearBottom ? null : findAnchor();

        const items = buildItems();
        const container = $('messages');
        const nextCache = new Map();
        const nodes = items.map((it) => {
            let c = state.nodeCache.get(it.key);
            if (!c || c.sig !== it.sig) {
                const el = htmlToEl(it.html);
                el.dataset.key = it.key;
                icons(el);
                c = { sig: it.sig, el };
            }
            nextCache.set(it.key, c);
            return c.el;
        });
        for (let i = 0; i < nodes.length; i++) {
            const cur = container.children[i];
            if (cur !== nodes[i]) container.insertBefore(nodes[i], cur || null);
        }
        while (container.children.length > nodes.length) container.lastElementChild.remove();
        state.nodeCache = nextCache;

        const hasAny = items.length > 0;
        if (state.loaded) {
            hide($('initial-loading'));
            if (hasAny) hide($('empty')); else show($('empty'));
        }
        renderOlder();

        if (mode === 'bottom' || wasNearBottom) {
            sc.scrollTop = sc.scrollHeight;
            state.stick = true;
            state.unseen = 0;
        } else if (anchor && anchor.el.isConnected) {
            const delta = anchor.el.getBoundingClientRect().top - anchor.top;
            if (Math.abs(delta) > 0.5) sc.scrollTop += delta;
        }
        renderPill();
    }

    function renderOlder() {
        const el = $('older');
        if (!state.loaded || !state.messages.length) { el.innerHTML = ''; return; }
        if (state.loadingOlder) {
            el.innerHTML = `<span class="inline-flex items-center gap-2"><i data-lucide="loader-circle" class="w-3.5 h-3.5 spin"></i> Loading earlier</span>`;
        } else if (state.hasMore) {
            el.innerHTML = `<button type="button" data-act="older" class="min-h-[40px] px-4 rounded-full hover:bg-white hover:text-black border border-transparent hover:border-gray-100 transition-colors">${state.olderError ? 'Couldn’t load — try again' : 'Load earlier messages'}</button>`;
        } else {
            el.innerHTML = `<span>Beginning of the family chat</span>`;
        }
        icons(el);
    }

    function renderPill() {
        const pill = $('new-pill');
        if (state.unseen > 0 && !state.stick) {
            $('new-pill-text').textContent = state.unseen === 1 ? '1 new message' : `${state.unseen} new messages`;
            show(pill);
        } else {
            hide(pill);
        }
    }

    function updateTitle() {
        document.title = state.hiddenUnseen > 0 ? `(${state.hiddenUnseen}) Chowaniec Group` : 'Chowaniec Group';
    }

    function noteFresh(fresh) {
        if (!fresh) return;
        if (document.visibilityState === 'hidden') {
            state.hiddenUnseen += fresh;
            updateTitle();
        }
        if (!state.stick && distanceFromBottom() >= NEAR_BOTTOM_PX) state.unseen += fresh;
    }

    // ---------- polling ----------
    function showBanner(text) {
        $('error-text').textContent = text;
        show($('error-banner'), 'block');
    }
    function hideBanner() { hide($('error-banner'), 'block'); }

    function schedulePoll(ms) {
        clearTimeout(state.pollTimer);
        if (state.stopped) return;
        let delay = ms;
        if (delay == null) {
            if (state.failures > 0) delay = Math.min(30000, 2000 * Math.pow(2, state.failures - 1));
            else delay = document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
        }
        state.pollTimer = setTimeout(poll, delay);
    }

    async function poll() {
        if (state.stopped) return;
        if (state.polling) { schedulePoll(); return; }
        state.polling = true;
        clearTimeout(state.pollTimer);
        try {
            const full = !state.latestId || !state.loaded || Date.now() - state.lastFull > FULL_SYNC_MS;
            const data = await api(full ? API : `${API}?since=${encodeURIComponent(state.latestId)}`);
            const list = Array.isArray(data.messages) ? data.messages : [];
            let fresh;
            if (full) {
                const first = !state.loaded;
                fresh = reconcileLatest(list);
                state.lastFull = Date.now();
                if (first) {
                    state.loaded = true;
                    state.hasMore = list.length >= 50;
                    fresh = 0;
                    render('bottom');
                    requestAnimationFrame(fillViewport);
                } else {
                    noteFresh(fresh);
                    render('auto');
                }
            } else {
                fresh = upsert(list);
                if (list.length) state.latestId = list.slice().sort(compareMsgs)[list.length - 1].id;
                noteFresh(fresh);
                if (list.length || state.aiThinkingUntil) render('auto');
            }
            if (state.aiThinkingUntil && state.aiThinkingUntil <= Date.now()) {
                state.aiThinkingUntil = 0;
                render('auto');
            }
            state.failures = 0;
            hideBanner();
        } catch (e) {
            if (e.status === 401) return;
            state.failures++;
            const wait = Math.round(Math.min(30000, 2000 * Math.pow(2, state.failures - 1)) / 1000);
            showBanner(`${state.loaded ? 'Can’t reach the chat' : 'Couldn’t load messages'}: ${e.message.replace(/\.$/, '')}. Retrying in ${wait}s.`);
            if (!state.loaded) {
                $('initial-loading').innerHTML = `<i data-lucide="wifi-off" class="w-6 h-6 text-gray-300"></i>Waiting for connection&hellip;`;
                icons($('initial-loading'));
            }
        } finally {
            state.polling = false;
            schedulePoll();
        }
    }

    async function loadOlder() {
        if (!state.loaded || !state.hasMore || state.loadingOlder || !state.messages.length) return;
        state.loadingOlder = true;
        state.olderError = false;
        renderOlder();
        try {
            const oldest = state.messages[0];
            const data = await api(`${API}?before=${encodeURIComponent(oldest.id)}`);
            const list = Array.isArray(data.messages) ? data.messages : [];
            upsert(list);
            state.hasMore = !!data.hasMore && list.length > 0;
        } catch (e) {
            state.olderError = true;
        } finally {
            state.loadingOlder = false;
            render('auto');
        }
        if (!state.olderError) requestAnimationFrame(fillViewport);
    }

    // Keep loading history while the screen isn't full yet (or the user is parked at the top).
    function fillViewport() {
        const sc = $('scroller');
        if (state.hasMore && !state.loadingOlder && sc.scrollHeight <= sc.clientHeight + 40) loadOlder();
    }

    // ---------- sending ----------
    function autosize() {
        const ta = $('composer-input');
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
        ta.style.overflowY = ta.scrollHeight > 160 ? 'auto' : 'hidden';
    }

    function updateSendButton() {
        $('btn-send').disabled = !($('composer-input').value.trim() || state.image);
    }

    function renderAttachments() {
        const row = $('attach-row');
        let html = '';
        if (state.replyTo) {
            const r = state.replyTo;
            html += `<div class="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-2xl pl-3 pr-1 py-1 fade-in">
                <i data-lucide="reply" class="w-4 h-4 text-gray-400 shrink-0"></i>
                <div class="min-w-0 flex-1 border-l-2 border-gray-300 pl-2.5 py-0.5">
                    <div class="text-[10px] font-mono uppercase tracking-widest text-gray-400">Replying to <span class="text-gray-700">${escapeHtml(displayName(r))}</span></div>
                    <div class="text-xs text-gray-500 truncate">${escapeHtml(r.text ? snippet(r.text, 120) : (r.image ? 'Photo' : ''))}</div>
                </div>
                <button type="button" data-act="cancel-reply" title="Cancel reply" class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-white"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>`;
        }
        if (state.image) {
            const im = state.image;
            const kb = Math.round(im.bytes / 1024);
            html += `<div class="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-2xl p-1.5 pr-1 fade-in">
                <img src="${escapeHtml(im.dataUrl)}" alt="Selected photo" class="w-12 h-12 rounded-xl object-cover shrink-0 bg-gray-100">
                <div class="min-w-0 flex-1">
                    <div class="text-xs font-medium text-gray-700">Photo ready to send</div>
                    <div class="text-[10px] font-mono uppercase tracking-widest text-gray-400">${im.width}×${im.height} · ${kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'}</div>
                </div>
                <button type="button" data-act="remove-image" title="Remove photo" class="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-white"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>`;
        }
        row.innerHTML = html;
        if (html) show(row); else hide(row);
        icons(row);
    }

    function setReply(m) {
        state.replyTo = m ? { id: m.id, user: displayName(m), text: m.text || '', image: m.image || null, kind: m.kind } : null;
        renderAttachments();
        const ta = $('composer-input');
        if (m) ta.focus();
    }

    function sendFromComposer() {
        const ta = $('composer-input');
        const text = ta.value.trim();
        const img = state.image;
        if (!text && !img) return;
        const p = {
            tempId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text,
            imageData: img ? img.dataUrl : null,
            replyTo: state.replyTo ? { id: state.replyTo.id, user: state.replyTo.user, text: state.replyTo.text } : null,
            createdAt: new Date().toISOString(),
            status: 'sending'
        };
        state.pending.push(p);
        if (/(^|[^\w@])@ai\b/i.test(text)) state.aiThinkingUntil = Date.now() + 60000;
        ta.value = '';
        state.image = null;
        state.replyTo = null;
        closeMention();
        autosize();
        updateSendButton();
        renderAttachments();
        render('bottom');
        deliver(p);
    }

    async function deliver(p) {
        p.status = 'sending';
        render('auto');
        const body = { text: p.text };
        if (p.imageData) body.image = p.imageData;
        if (p.replyTo) body.replyTo = p.replyTo.id;
        try {
            const data = await api(API, { method: 'POST', body });
            state.pending = state.pending.filter((x) => x !== p);
            if (data && data.message) upsert([data.message]);
            render('auto');
        } catch (e) {
            p.status = 'failed';
            p.error = e.message;
            if (/@ai\b/i.test(p.text)) state.aiThinkingUntil = 0;
            render('auto');
            if (e.status !== 401) toast(e.message || 'Message not sent', 'error');
        }
    }

    function retryPending(id) {
        const p = state.pending.find((x) => x.tempId === id);
        if (!p || p.status === 'sending') return;
        if (/(^|[^\w@])@ai\b/i.test(p.text)) state.aiThinkingUntil = Date.now() + 60000;
        deliver(p);
    }

    // ---------- images ----------
    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { resolve({ img, url }); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as a photo.')); };
            img.src = url;
        });
    }

    async function resizeImage(file) {
        const { img, url } = await loadImageFromFile(file);
        try {
            const w0 = img.naturalWidth || img.width;
            const h0 = img.naturalHeight || img.height;
            if (!w0 || !h0) throw new Error('That photo looks empty.');
            let edge = MAX_IMAGE_EDGE;
            let quality = 0.82;
            for (let attempt = 0; attempt < 5; attempt++) {
                const scale = Math.min(1, edge / Math.max(w0, h0));
                const w = Math.max(1, Math.round(w0 * scale));
                const h = Math.max(1, Math.round(h0 * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
                if (bytes <= MAX_IMAGE_BYTES * 0.95) return { dataUrl, width: w, height: h, bytes };
                edge = Math.round(edge * 0.8);
                quality = Math.max(0.6, quality - 0.06);
            }
            throw new Error('That photo is too large to send.');
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async function attachFile(file) {
        if (!file) return;
        if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i.test(file.name || '')) {
            toast('Please choose a photo.', 'error');
            return;
        }
        const btn = $('btn-photo');
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-circle" class="w-5 h-5 spin"></i>';
        icons(btn);
        try {
            state.image = await resizeImage(file);
            renderAttachments();
            updateSendButton();
            if (isFinePointer()) $('composer-input').focus();
        } catch (e) {
            toast(e.message || 'Could not use that photo.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="image-plus" class="w-5 h-5"></i>';
            icons(btn);
        }
    }

    // ---------- mentions autocomplete ----------
    function mentionOptions() {
        const me = state.user ? state.user.name : '';
        const opts = state.people.filter((n) => !sameName(n, me)).map((n) => ({ name: n, hint: '', kind: 'person' }));
        opts.push({ name: 'everyone', hint: 'Notify the whole family', kind: 'everyone' });
        opts.push({ name: 'AI', hint: 'Ask Chowaniec AI', kind: 'ai' });
        return opts;
    }

    function detectMention() {
        const ta = $('composer-input');
        if (ta.selectionStart !== ta.selectionEnd) return closeMention();
        const caret = ta.selectionStart;
        const before = ta.value.slice(0, caret);
        const x = /(^|[\s(])@([A-Za-z0-9_-]{0,24})$/.exec(before);
        if (!x) return closeMention();
        const query = x[2].toLowerCase();
        const all = mentionOptions();
        const starts = all.filter((o) => o.name.toLowerCase().startsWith(query));
        const contains = all.filter((o) => !o.name.toLowerCase().startsWith(query) && o.name.toLowerCase().includes(query));
        const options = starts.concat(contains);
        if (!options.length) return closeMention();
        const prevIndex = state.mention && state.mention.query === query ? state.mention.index : 0;
        state.mention = { start: caret - x[2].length - 1, end: caret, query, options, index: Math.min(prevIndex, options.length - 1) };
        renderMention();
    }

    function renderMention() {
        const pop = $('mention-popup');
        const m = state.mention;
        if (!m) { hide(pop, 'block'); return; }
        pop.innerHTML = `<p class="px-3 pt-1.5 pb-1 text-[10px] font-mono uppercase tracking-widest text-gray-400">Mention</p>` + m.options.map((o, i) => {
            let av;
            if (o.kind === 'ai') av = `<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style="background:#7c3aed;color:#fff"><i data-lucide="sparkles" class="w-4 h-4"></i></span>`;
            else if (o.kind === 'everyone') av = `<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-black text-white"><i data-lucide="users" class="w-4 h-4"></i></span>`;
            else {
                const [bg, fg] = avatarColors(o.name);
                av = `<span class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[13px] font-semibold" style="background:${bg};color:${fg}">${escapeHtml(initial(o.name))}</span>`;
            }
            const active = i === m.index;
            return `<button type="button" role="option" aria-selected="${active}" data-mention="${escapeHtml(o.name)}" class="w-full min-h-[44px] px-2 rounded-xl flex items-center gap-3 text-left text-sm ${active ? 'bg-gray-100 text-black' : 'text-gray-700 hover:bg-gray-50'}">
                ${av}<span class="min-w-0 flex-1"><span class="font-medium">@${escapeHtml(o.name)}</span>${o.hint ? `<span class="block text-[11px] text-gray-400 truncate">${escapeHtml(o.hint)}</span>` : ''}</span>
            </button>`;
        }).join('');
        show(pop, 'block');
        icons(pop);
        const act = pop.querySelector('[aria-selected="true"]');
        if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    }

    function closeMention() {
        state.mention = null;
        hide($('mention-popup'), 'block');
    }

    function insertMention(name) {
        const m = state.mention;
        const ta = $('composer-input');
        if (!m) return;
        const after = ta.value.slice(m.end);
        const insert = `@${name}` + (after.startsWith(' ') ? '' : ' ');
        ta.value = ta.value.slice(0, m.start) + insert + after;
        const pos = m.start + insert.length + (after.startsWith(' ') ? 1 : 0);
        ta.setSelectionRange(pos, pos);
        closeMention();
        autosize();
        updateSendButton();
        ta.focus();
    }

    // ---------- actions ----------
    function findMessage(id) {
        if (state.byId.has(id)) return state.byId.get(id);
        const p = state.pending.find((x) => x.tempId === id);
        return p ? pendingAsMessage(p) : null;
    }

    function canDelete(m) {
        if (!m || !state.user) return false;
        if (m._pending) return m._pending === 'failed';
        return !!state.user.host || isMine(m);
    }

    function rowEl(id) {
        const c = state.nodeCache.get(`m:${id}`);
        return c ? c.el : null;
    }

    function openActions(id, anchorEl) {
        const m = findMessage(id);
        if (!m || m.kind === 'system') return;
        closeActions();
        state.menuFor = id;
        const menu = $('action-menu');
        const pendingMsg = !!m._pending;
        let html = '';
        if (!pendingMsg) {
            html += `<div class="flex items-center justify-between gap-1 px-1 pb-2 mb-1 border-b border-gray-100">` +
                QUICK_EMOJI.map((e) => {
                    const on = ((m.reactions || {})[e] || []).some((n) => sameName(n, state.user.name));
                    return `<button type="button" role="menuitem" data-act="react" data-id="${escapeHtml(m.id)}" data-emoji="${e}" title="React ${e}" class="w-11 h-11 rounded-full text-2xl flex items-center justify-center transition-transform hover:scale-110 ${on ? 'bg-gray-100 ring-1 ring-gray-300' : 'hover:bg-gray-50'}">${e}</button>`;
                }).join('') + `</div>`;
        }
        const item = (act, icon, label, extra) => `<button type="button" role="menuitem" data-act="${act}" data-id="${escapeHtml(m.id)}" class="w-full min-h-[44px] px-3 rounded-xl flex items-center gap-3 text-sm ${extra || 'text-gray-700 hover:bg-gray-50 hover:text-black'}"><i data-lucide="${icon}" class="w-4 h-4 ${extra ? '' : 'text-gray-400'}"></i> ${label}</button>`;
        if (!pendingMsg) html += item('reply', 'reply', 'Reply');
        if (m._pending === 'failed') html += item('retry', 'rotate-cw', 'Retry sending');
        if (m.text) html += item('copy', 'copy', 'Copy text');
        if (canDelete(m)) html += item('delete', 'trash-2', pendingMsg ? 'Discard' : 'Delete', 'text-red-600 hover:bg-red-50');
        menu.innerHTML = html;
        icons(menu);

        const backdrop = $('action-backdrop');
        show(backdrop, 'block');
        show(menu, 'block');
        menu.classList.add('sheet-enter');

        const row = rowEl(id);
        if (row) row.classList.add('press');

        // Desktop / tablet: float next to the bubble. Phones: bottom sheet (CSS).
        if (window.innerWidth >= 640) {
            const target = anchorEl || (row && row.querySelector('.bubble'));
            const r = target ? target.getBoundingClientRect() : { top: window.innerHeight / 2, bottom: window.innerHeight / 2, left: window.innerWidth / 2, right: window.innerWidth / 2 };
            const mw = menu.offsetWidth;
            const mh = menu.offsetHeight;
            const mine = row && row.classList.contains('mine');
            let left = mine ? r.right - mw : r.left;
            left = Math.max(12, Math.min(left, window.innerWidth - mw - 12));
            let top = r.bottom + 8;
            if (top + mh > window.innerHeight - 12) top = Math.max(12, r.top - mh - 8);
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
        } else {
            menu.style.left = '';
            menu.style.top = '';
        }
        const first = menu.querySelector('button');
        if (first && isFinePointer()) first.focus({ preventScroll: true });
    }

    function closeActions() {
        if (!state.menuFor) return;
        const row = rowEl(state.menuFor);
        if (row) row.classList.remove('press');
        state.menuFor = null;
        hide($('action-menu'), 'block');
        hide($('action-backdrop'), 'block');
        $('action-menu').classList.remove('sheet-enter');
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            toast('Copied');
        } catch (e) {
            toast('Could not copy', 'error');
        }
    }

    async function toggleReaction(id, emoji) {
        const m = state.byId.get(id);
        if (!m || !state.user) return;
        const me = state.user.name;
        const before = m.reactions || {};
        const next = {};
        Object.keys(before).forEach((k) => { next[k] = (before[k] || []).slice(); });
        const list = next[emoji] || [];
        const had = list.some((n) => sameName(n, me));
        next[emoji] = had ? list.filter((n) => !sameName(n, me)) : list.concat([me]);
        if (!next[emoji].length) delete next[emoji];
        state.byId.set(id, Object.assign({}, m, { reactions: next }));
        resort();
        render('auto');
        try {
            const data = await api(API, { method: 'POST', body: { action: 'react', id, emoji } });
            if (data && data.message) upsert([data.message]);
        } catch (e) {
            const cur = state.byId.get(id);
            if (cur) state.byId.set(id, Object.assign({}, cur, { reactions: before }));
            resort();
            if (e.status !== 401) toast(e.message, 'error');
        }
        render('auto');
    }

    function askDelete(id) {
        const m = findMessage(id);
        if (!m) return;
        if (m._pending) {
            state.pending = state.pending.filter((x) => x.tempId !== id);
            render('auto');
            return;
        }
        state.confirmId = id;
        $('confirm-detail').textContent = isMine(m)
            ? 'It will be removed for everyone in the family chat.'
            : `This is ${displayName(m)}’s message. As a host, you can remove it for everyone.`;
        show($('confirm-modal'));
        $('confirm-cancel').focus();
    }

    async function doDelete() {
        const id = state.confirmId;
        hide($('confirm-modal'));
        state.confirmId = null;
        if (!id) return;
        const m = state.byId.get(id);
        if (!m) return;
        state.byId.delete(id);
        resort();
        render('auto');
        try {
            await api(`${API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (state.latestId === id) state.latestId = state.messages.length ? state.messages[state.messages.length - 1].id : null;
            toast('Message deleted');
        } catch (e) {
            state.byId.set(id, m);
            resort();
            render('auto');
            if (e.status !== 401) toast(e.message, 'error');
        }
    }

    function jumpTo(id) {
        const row = rowEl(id);
        if (!row) {
            toast(state.hasMore ? 'That message is further back. Scroll up to load more.' : 'That message is no longer here.');
            return;
        }
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.remove('flash');
        void row.offsetWidth;
        row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1500);
    }

    // ---------- lightbox ----------
    function openLightbox(src, caption) {
        const lb = $('lightbox');
        $('lightbox-img').src = src;
        const open = $('lightbox-open');
        if (/^data:/.test(src)) open.classList.add('hidden'); else { open.classList.remove('hidden'); open.href = src; }
        $('lightbox-caption').textContent = caption || '';
        show(lb);
        try { history.pushState({ chowaniecLightbox: true }, ''); } catch (e) { /* ignore */ }
    }

    function closeLightbox(fromPop) {
        const lb = $('lightbox');
        if (lb.classList.contains('hidden')) return;
        hide(lb);
        $('lightbox-img').removeAttribute('src');
        if (!fromPop && history.state && history.state.chowaniecLightbox) {
            try { history.back(); } catch (e) { /* ignore */ }
        }
    }

    // ---------- notifications bell ----------
    function pwa() {
        const P = window.ChowaniecPWA;
        return P && typeof P.pushStatus === 'function' ? P : null;
    }

    async function refreshBell() {
        const P = pwa();
        if (!P) {
            state.push = 'loading';
        } else {
            try { state.push = await P.pushStatus(); } catch (e) { state.push = 'unsupported'; }
        }
        renderBell();
        if (!$('bell-panel').classList.contains('hidden')) renderBellPanel();
    }

    function renderBell() {
        const btn = $('btn-bell');
        const s = state.push;
        let icon = 'bell';
        let title = 'Notifications';
        let cls = 'border-gray-200 bg-white text-gray-600 hover:border-black hover:text-black';
        if (state.pushBusy) { icon = 'loader-circle'; title = 'Working…'; }
        else if (s === 'enabled') { icon = 'bell-ring'; title = 'Notifications are on'; cls = 'border-black bg-black text-white hover:bg-gray-800'; }
        else if (s === 'disabled') { icon = 'bell'; title = 'Turn on notifications'; }
        else if (s === 'needs-install') { icon = 'bell-plus'; title = 'Install the app to get notifications'; }
        else if (s === 'denied') { icon = 'bell-off'; title = 'Notifications are blocked'; cls = 'border-gray-200 bg-white text-gray-400 hover:border-black hover:text-black'; }
        else if (s === 'unsupported' || s === 'not-configured') { icon = 'bell-off'; title = 'Notifications unavailable'; cls = 'border-gray-200 bg-white text-gray-400 hover:border-black hover:text-black'; }
        btn.className = `w-10 h-10 rounded-full border flex items-center justify-center transition-colors relative ${cls}`;
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.dataset.status = s;
        const dot = s === 'disabled' || s === 'needs-install' ? '<span class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white"></span>' : '';
        btn.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4 ${state.pushBusy ? 'spin' : ''}"></i>${dot}`;
        icons(btn);
    }

    function deniedSteps() {
        const P = pwa();
        const plat = P && typeof P.platform === 'function' ? P.platform() : 'desktop';
        if (plat === 'ios') return 'Open the iPhone <b>Settings</b> app → <b>Notifications</b> → <b>Chowaniec</b>, and turn on <b>Allow Notifications</b>. Then come back and tap “Check again”.';
        if (plat === 'android') return 'Tap the <b>⋮</b> menu or the icon left of the address bar → <b>Site settings</b> (or <b>App info</b>) → <b>Notifications</b> → <b>Allow</b>. Then tap “Check again”.';
        return 'Click the icon to the left of the address bar → <b>Site settings</b> → <b>Notifications</b> → <b>Allow</b>, then reload this page or tap “Check again”.';
    }

    function renderBellPanel() {
        const panel = $('bell-panel');
        const s = state.push;
        const head = (icon, title, tone) => `<div class="flex items-center gap-3 mb-2"><div class="w-9 h-9 rounded-full ${tone || 'bg-gray-50 border border-gray-100 text-black'} flex items-center justify-center shrink-0"><i data-lucide="${icon}" class="w-4 h-4"></i></div><h3 class="font-serif text-lg text-black leading-tight">${title}</h3></div>`;
        const p = (t) => `<p class="text-xs text-gray-500 font-light leading-relaxed">${t}</p>`;
        const pill = (attrs, label, dark) => `<button type="button" ${attrs} class="min-h-[40px] px-4 rounded-full text-xs font-medium transition-colors ${dark ? 'bg-black text-white hover:bg-gray-800 shadow-md' : 'border border-gray-200 text-gray-700 hover:border-black hover:text-black'}">${label}</button>`;
        let html = '';
        if (s === 'enabled') {
            html = head('bell-ring', 'Notifications are on', 'bg-black text-white') +
                p('You’ll get a notification for new family messages and when someone @mentions you.') +
                `<div class="flex flex-wrap gap-2 mt-4">${pill('data-bell="test"', 'Send a test')}${pill('data-bell="disable"', 'Turn off', true)}</div>`;
        } else if (s === 'needs-install') {
            html = head('smartphone', 'Install the app first') +
                p('On iPhone and iPad, notifications only work when Chowaniec is opened from your Home Screen.') +
                `<div class="mt-4"><a href="/get-the-app/" class="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full bg-black text-white text-xs font-medium hover:bg-gray-800 shadow-md">How to install <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i></a></div>`;
        } else if (s === 'denied') {
            html = head('bell-off', 'Notifications are blocked', 'bg-amber-50 border border-amber-100 text-amber-700') +
                p('Your browser is blocking notifications for this site. To turn them back on:') +
                `<p class="text-xs text-gray-600 leading-relaxed mt-2">${deniedSteps()}</p>` +
                `<div class="mt-4">${pill('data-bell="check"', 'Check again')}</div>`;
        } else if (s === 'disabled') {
            html = head('bell', 'Get notified') + p('Turn on notifications to hear about new messages and @mentions.') +
                `<div class="mt-4">${pill('data-bell="enable"', 'Turn on notifications', true)}</div>`;
        } else if (s === 'not-configured') {
            html = head('bell-off', 'Not set up yet') + p('Notifications haven’t been switched on for the family site yet. Check back soon.');
        } else if (s === 'unsupported') {
            html = head('bell-off', 'Not available here') + p('This browser can’t show notifications. Installing the Chowaniec app usually fixes that.') +
                `<div class="mt-4"><a href="/get-the-app/" class="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full border border-gray-200 text-gray-700 text-xs font-medium hover:border-black hover:text-black">Get the app</a></div>`;
        } else {
            html = head('loader-circle', 'One moment…') + p('Notifications are still loading. Try again in a second.');
        }
        panel.innerHTML = html;
        icons(panel);
    }

    function toggleBellPanel(force) {
        const panel = $('bell-panel');
        const open = force != null ? force : panel.classList.contains('hidden');
        if (open) {
            renderBellPanel();
            show(panel, 'block');
        } else {
            hide(panel, 'block');
        }
        $('btn-bell').setAttribute('aria-expanded', String(open));
    }

    async function onBellClick() {
        if (state.pushBusy) return;
        const P = pwa();
        if (!P) {
            await refreshBell();
            toggleBellPanel();
            return;
        }
        if (state.push === 'disabled') {
            toggleBellPanel(false);
            state.pushBusy = true;
            renderBell();
            let result = 'error';
            try { result = await P.enablePush(); } catch (e) { result = 'error'; }
            state.pushBusy = false;
            await refreshBell();
            if (result === 'enabled') toast('Notifications are on');
            else if (result === 'denied') toggleBellPanel(true);
            else toast('Couldn’t turn on notifications. Please try again.', 'error');
            return;
        }
        toggleBellPanel();
    }

    async function onBellPanelAction(action) {
        const P = pwa();
        if (!P) return;
        if (action === 'disable') {
            state.pushBusy = true;
            renderBell();
            try { await P.disablePush(); toast('Notifications are off'); } catch (e) { toast('Couldn’t turn off notifications', 'error'); }
            state.pushBusy = false;
            toggleBellPanel(false);
            await refreshBell();
        } else if (action === 'test') {
            try {
                const r = await P.sendTestPush();
                toast(r && r.sent ? 'Test notification sent' : 'No devices to notify yet');
            } catch (e) { toast('Couldn’t send a test', 'error'); }
        } else if (action === 'check') {
            await refreshBell();
            if (state.push !== 'denied') toggleBellPanel(state.push !== 'disabled' && state.push !== 'enabled' ? true : false);
            if (state.push === 'disabled') toast('Unblocked — tap the bell to turn on');
        } else if (action === 'enable') {
            state.push = 'disabled';
            toggleBellPanel(false);
            onBellClick();
        }
    }

    // ---------- header ----------
    function renderHeader() {
        const names = state.people;
        const line = $('member-line');
        line.textContent = names.length ? `${names.length} members · ${names.join(', ')}` : 'Family chat';
        line.title = names.join(', ');
    }

    // ---------- events ----------
    function bindEvents() {
        const sc = $('scroller');
        const ta = $('composer-input');

        sc.addEventListener('scroll', () => {
            const near = distanceFromBottom() < NEAR_BOTTOM_PX;
            state.stick = near;
            if (near && state.unseen) state.unseen = 0;
            renderPill();
            if (sc.scrollTop < 300) loadOlder();
            if (state.menuFor && window.innerWidth >= 640) closeActions();
        }, { passive: true });

        // Images change height when they load: stay pinned to the bottom if we were there.
        $('messages').addEventListener('load', () => {
            if (state.stick) sc.scrollTop = sc.scrollHeight;
        }, true);

        // The composer grows (reply chip, photo, multi-line text) or the keyboard opens: stay pinned.
        if (window.ResizeObserver) {
            new ResizeObserver(() => { if (state.stick) sc.scrollTop = sc.scrollHeight; }).observe(sc);
        }

        $('new-pill').addEventListener('click', () => scrollToBottom(true));
        $('btn-retry').addEventListener('click', () => { state.failures = 0; hideBanner(); poll(); });

        // Delegated clicks inside the message list + composer extras
        document.addEventListener('click', (e) => {
            if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
            const t = e.target.closest('[data-act]');
            if (!t) return;
            const act = t.dataset.act;
            const id = t.dataset.id;
            switch (act) {
                case 'menu': openActions(id, t.closest('.msg-row') && t.closest('.msg-row').querySelector('.bubble')); break;
                case 'reply': closeActions(); setReply(findMessage(id)); break;
                case 'react': closeActions(); toggleReaction(id, t.dataset.emoji); break;
                case 'copy': { closeActions(); const m = findMessage(id); if (m) copyText(m.text || ''); break; }
                case 'delete': closeActions(); askDelete(id); break;
                case 'retry': closeActions(); retryPending(id); break;
                case 'jump': jumpTo(id); break;
                case 'lightbox': openLightbox(t.dataset.src, t.dataset.caption); break;
                case 'older': loadOlder(); break;
                case 'cancel-reply': setReply(null); break;
                case 'remove-image': state.image = null; renderAttachments(); updateSendButton(); break;
                default: break;
            }
        }, true);

        // Long-press (touch) and right-click open the action menu.
        let pressTimer = null;
        let pressStart = null;
        let suppressClick = false;
        const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; pressStart = null; };
        sc.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') return;
            const bubble = e.target.closest('.bubble[data-bubble]');
            if (!bubble) return;
            pressStart = { x: e.clientX, y: e.clientY };
            const row = bubble.closest('.msg-row');
            if (row) row.classList.add('press');
            pressTimer = setTimeout(() => {
                pressTimer = null;
                suppressClick = true;
                setTimeout(() => { suppressClick = false; }, 700);
                if (row) row.classList.remove('press');
                if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* ignore */ } }
                openActions(bubble.dataset.id, bubble);
            }, 450);
        });
        sc.addEventListener('pointermove', (e) => {
            if (!pressStart) return;
            if (Math.abs(e.clientX - pressStart.x) > 10 || Math.abs(e.clientY - pressStart.y) > 10) {
                const row = e.target.closest && e.target.closest('.msg-row');
                if (row && state.menuFor !== row.dataset.id) row.classList.remove('press');
                cancelPress();
            }
        });
        const endPress = (e) => {
            if (pressTimer) {
                const row = e.target.closest && e.target.closest('.msg-row');
                if (row && state.menuFor !== row.dataset.id) row.classList.remove('press');
            }
            cancelPress();
        };
        sc.addEventListener('pointerup', endPress);
        sc.addEventListener('pointercancel', endPress);
        sc.addEventListener('contextmenu', (e) => {
            const bubble = e.target.closest('.bubble[data-bubble]');
            if (!bubble) return;
            if (e.target.closest('a') && isFinePointer()) return; // allow native menu on links (desktop)
            e.preventDefault();
            if (state.menuFor === bubble.dataset.id) return;
            cancelPress();
            openActions(bubble.dataset.id, bubble);
        });

        $('action-backdrop').addEventListener('click', closeActions);
        $('action-backdrop').addEventListener('contextmenu', (e) => { e.preventDefault(); closeActions(); });

        // Composer
        $('composer').addEventListener('submit', (e) => { e.preventDefault(); sendFromComposer(); });
        $('btn-send').addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') e.preventDefault(); });
        $('btn-send').addEventListener('click', (e) => { e.preventDefault(); sendFromComposer(); });
        ta.addEventListener('input', () => { autosize(); updateSendButton(); detectMention(); });
        ta.addEventListener('click', detectMention);
        ta.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detectMention(); });
        ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== ta) closeMention(); }, 150));
        ta.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            const m = state.mention;
            if (m) {
                if (e.key === 'ArrowDown') { e.preventDefault(); m.index = (m.index + 1) % m.options.length; renderMention(); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); m.index = (m.index - 1 + m.options.length) % m.options.length; renderMention(); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(m.options[m.index].name); return; }
                if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
            }
            if (e.key === 'Escape' && state.replyTo) { setReply(null); return; }
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey && isFinePointer()) {
                e.preventDefault();
                sendFromComposer();
            }
        });
        ta.addEventListener('paste', (e) => {
            const items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
            const img = items.find((it) => it.kind === 'file' && /^image\//.test(it.type));
            if (img) { e.preventDefault(); attachFile(img.getAsFile()); }
        });

        const pop = $('mention-popup');
        pop.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the textarea focused
        pop.addEventListener('mousedown', (e) => e.preventDefault());
        pop.addEventListener('click', (e) => {
            const b = e.target.closest('[data-mention]');
            if (b) insertMention(b.dataset.mention);
        });

        $('btn-photo').addEventListener('click', () => $('file-input').click());
        $('file-input').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            attachFile(f);
        });

        // Drag & drop a photo onto the page (desktop)
        document.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
        document.addEventListener('drop', (e) => {
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) { e.preventDefault(); attachFile(f); }
        });

        // Confirm modal
        $('confirm-cancel').addEventListener('click', () => { hide($('confirm-modal')); state.confirmId = null; });
        $('confirm-ok').addEventListener('click', doDelete);
        $('confirm-modal').addEventListener('click', (e) => { if (e.target === $('confirm-modal')) { hide($('confirm-modal')); state.confirmId = null; } });

        // Lightbox
        $('lightbox-close').addEventListener('click', () => closeLightbox(false));
        $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox') || e.target === $('lightbox-img')) closeLightbox(false); });
        window.addEventListener('popstate', () => closeLightbox(true));

        // Sign in again
        $('btn-signin').addEventListener('click', () => {
            try { if (typeof window.clearChowaniecSession === 'function') window.clearChowaniecSession(); } catch (e) { /* ignore */ }
            window.location.reload();
        });

        // Bell
        $('btn-bell').addEventListener('click', (e) => { e.stopPropagation(); onBellClick(); });
        $('bell-panel').addEventListener('click', (e) => {
            e.stopPropagation();
            const b = e.target.closest('[data-bell]');
            if (b) onBellPanelAction(b.dataset.bell);
        });
        document.addEventListener('click', (e) => {
            if (!$('bell-panel').classList.contains('hidden') && !e.target.closest('#bell-panel') && !e.target.closest('#btn-bell')) toggleBellPanel(false);
        });
        window.addEventListener('chowaniec-pwa-change', refreshBell);
        window.addEventListener('load', refreshBell);

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!$('lightbox').classList.contains('hidden')) closeLightbox(false);
            else if (state.menuFor) closeActions();
            else if (!$('confirm-modal').classList.contains('hidden')) { hide($('confirm-modal')); state.confirmId = null; }
            else if (!$('bell-panel').classList.contains('hidden')) toggleBellPanel(false);
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                state.hiddenUnseen = 0;
                updateTitle();
                if (!state.polling) poll();
            } else {
                schedulePoll();
            }
        });
        window.addEventListener('online', () => { state.failures = 0; poll(); });
        window.addEventListener('resize', () => { if (state.menuFor) closeActions(); });

        // iOS: keep the composer above the on-screen keyboard.
        if (window.visualViewport) {
            const shell = $('app-shell');
            const fit = () => {
                const vv = window.visualViewport;
                const h = Math.round(vv.height);
                if (Math.abs(h - window.innerHeight) > 1) shell.style.height = h + 'px';
                else shell.style.height = '';
                if (window.scrollY) window.scrollTo(0, 0);
                if (state.stick) sc.scrollTop = sc.scrollHeight;
            };
            window.visualViewport.addEventListener('resize', fit);
        }
    }

    // Day labels ("Today") must roll over at midnight.
    function scheduleMidnightRefresh() {
        const now = new Date();
        const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
        setTimeout(() => { render('auto'); scheduleMidnightRefresh(); }, next - now);
    }

    function start() {
        if (state.started) return;
        state.user = getUser();
        if (!state.user || !state.user.key) { handleUnauthorized(); return; }
        state.started = true;
        state.people = loadPeople();
        renderHeader();
        renderBell();
        bindEvents();
        autosize();
        updateSendButton();
        refreshBell();
        // /pwa.js is deferred: check again shortly in case it arrives without an event.
        [600, 2000, 5000].forEach((ms) => setTimeout(() => { if (!pwa() || state.push === 'loading') refreshBell(); }, ms));
        scheduleMidnightRefresh();
        poll();
    }

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
