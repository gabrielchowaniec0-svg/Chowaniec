// Chowaniec Group: the family group chat. Talks to /.netlify/functions/group (see API spec + v2 additions).
(function () {
    'use strict';

    const API = '/.netlify/functions/group';
    // Which group chat this page shows (switching chats reloads the page with ?room=).
    const ROOM_KEY = 'chowaniec_group_room';
    let ROOM = 'everyone';
    try {
        ROOM = new URLSearchParams(location.search).get('room') || localStorage.getItem(ROOM_KEY) || 'everyone';
    } catch (e) { ROOM = 'everyone'; }
    if (!/^[a-z-]{1,20}$/.test(ROOM)) ROOM = 'everyone';
    const POLL_VISIBLE_MS = 3000;
    const POLL_HIDDEN_MS = 30000;
    const FULL_SYNC_MS = 20000;           // re-read the latest 50 to pick up reactions & deletions
    const GROUP_GAP_MS = 5 * 60 * 1000;   // consecutive messages within 5 min are grouped
    const NEAR_BOTTOM_PX = 120;
    const JUMP_SHOW_PX = 360;
    const MAX_IMAGE_EDGE = 1600;
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
    const TYPING_EVERY_MS = 3000;
    const READ_EVERY_MS = 3000;
    const SWIPE_REPLY_PX = 60;
    const QUICK_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🎉'];
    const EMOJI = [
        '😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😉', '😎', '🤩', '🥳', '😇', '🙂', '🤔', '🤗', '😴',
        '😅', '😭', '😢', '😮', '😱', '😡', '🙄', '😬', '🤪', '😋', '🥺', '🤭', '👍', '👎', '👏', '🙌',
        '🙏', '💪', '👋', '🤝', '✌️', '👌', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💕', '🔥', '✨',
        '🎉', '🎂', '🎁', '🌹', '☀️', '🌙', '⭐', '🍝', '🍕', '☕', '🍷', '🏠', '🚗', '✈️', '📸', '✅'
    ];
    const AI_NAME = 'Chowaniec AI';
    const PALETTE = 8;
    const THEME_KEY = 'chowaniec_theme';            // shared with Settings → Appearance
    const OLD_THEME_KEY = 'chowaniec_group_theme';

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
        menuEmojiOpen: false,
        confirmId: null,
        aiThinkingUntil: 0,
        push: 'loading',
        pushBusy: false,
        nodeCache: new Map(),
        // v2
        presence: [],
        pinned: null,
        typingSentAt: 0,
        readSentId: null,
        readSentAt: 0,
        readTimer: null,
        extrasSig: '',
        rendered: false,
        newestTs: 0,
        confirmed: new Set(),
        caret: { start: 0, end: 0 },
        sheetOpen: false,
        search: { q: '', busy: false, timer: null },
        theme: 'auto'
    };

    let suppressClick = false;   // swallow the click that follows a long-press, swipe or double-tap

    const $ = (id) => document.getElementById(id);
    const isFinePointer = () => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        el.innerHTML = `<i data-lucide="${kind === 'error' ? 'circle-alert' : 'check'}" class="${kind === 'error' ? 'err' : 'ok'}"></i><span>${escapeHtml(message)}</span>`;
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
    function myName() { return state.user ? state.user.name : ''; }
    function isMine(m) { return !!state.user && m.kind !== 'ai' && m.kind !== 'system' && sameName(m.user, state.user.name); }
    function displayName(m) { return m.kind === 'ai' ? (m.user || AI_NAME) : (m.user || 'Someone'); }
    function isAiName(name) { return sameName(name, AI_NAME); }

    function hashName(name) {
        let h = 0;
        const s = String(name || '?').toLowerCase();
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return h;
    }

    // Fixed palette: family members get distinct colours by their position in the people list.
    function personClass(name) {
        const idx = state.people.findIndex((n) => sameName(n, name));
        return 'p' + ((idx >= 0 ? idx : hashName(name)) % PALETTE);
    }

    function initial(name) {
        const s = String(name || '?').trim();
        return s ? Array.from(s)[0].toUpperCase() : '?';
    }

    function avatarHtml(name, size, opts) {
        const o = opts || {};
        const sz = size ? ' ' + size : '';
        if (o.ai || isAiName(name)) return `<span class="av ai-av${sz}" aria-hidden="true"><i data-lucide="sparkles"></i></span>`;
        if (o.everyone) return `<span class="av all-av${sz}" aria-hidden="true"><i data-lucide="users"></i></span>`;
        return `<span class="av ${personClass(name)}${sz}" data-user="${escapeHtml(String(name || '').toLowerCase())}" aria-hidden="true">${escapeHtml(initial(name))}<span class="dot"></span></span>`;
    }

    function dayKey(t) {
        const d = new Date(t);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }

    function dayDiff(t) {
        const d = new Date(t);
        const today = new Date();
        const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const startD = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        return Math.round((startToday - startD) / 86400000);
    }

    function dayLabel(t) {
        const d = new Date(t);
        const diff = dayDiff(t);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
        const opts = { weekday: 'short', month: 'short', day: 'numeric' };
        if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
        return d.toLocaleDateString([], opts);
    }

    function timeLabel(t) {
        return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function fullTime(t) {
        return new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function shortWhen(t) {
        const diff = dayDiff(t);
        if (diff === 0) return timeLabel(t);
        if (diff === 1) return 'Yesterday';
        if (diff > 1 && diff < 7) return new Date(t).toLocaleDateString([], { weekday: 'short' });
        return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function lastSeenLabel(iso) {
        const t = Date.parse(iso);
        if (!t) return '';
        const ago = Date.now() - t;
        if (ago < 90 * 1000) return 'Last seen just now';
        if (ago < 60 * 60 * 1000) return `Last seen ${Math.round(ago / 60000)} min ago`;
        const diff = dayDiff(t);
        if (diff === 0) return `Last seen today at ${timeLabel(t)}`;
        if (diff === 1) return `Last seen yesterday at ${timeLabel(t)}`;
        return `Last seen ${new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    }

    function mediaUrl(id) { return `${API}?media=${encodeURIComponent(id)}&room=${encodeURIComponent(ROOM)}`; }

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

    // Returns 0 when not emoji-only, otherwise the number of emoji (1-3).
    function emojiOnlyCount(text) {
        const s = String(text || '').replace(/\s+/g, '');
        if (!s || s.length > 32) return 0;
        try {
            const pics = s.match(/\p{Extended_Pictographic}/gu);
            if (!pics || pics.length > 3) return 0;
            const rest = s.replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|[‍️⃣]|\p{Regional_Indicator}/gu, '');
            return rest.length === 0 ? pics.length : 0;
        } catch (e) {
            return 0;
        }
    }

    // Escaped text with every case-insensitive occurrence of q wrapped in <mark>.
    function highlight(text, q) {
        const src = String(text || '');
        if (!q) return escapeHtml(src);
        const lower = src.toLowerCase();
        let out = '';
        let i = 0;
        for (;;) {
            const j = lower.indexOf(q, i);
            if (j < 0) break;
            out += escapeHtml(src.slice(i, j)) + '<mark>' + escapeHtml(src.slice(j, j + q.length)) + '</mark>';
            i = j + q.length;
        }
        return out + escapeHtml(src.slice(i));
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
        // Every request names the chat it belongs to.
        const method = opts.method || 'GET';
        if (method === 'POST' && opts.body && typeof opts.body === 'object' && !opts.body.room) opts.body = { ...opts.body, room: ROOM };
        else if (method !== 'POST' && !/[?&]room=/.test(url)) url += `${url.includes('?') ? '&' : '?'}room=${encodeURIComponent(ROOM)}`;
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

    // Presence + pinned come back with every GET.
    function applyExtras(data) {
        if (!data) return;
        if (Array.isArray(data.presence)) state.presence = data.presence.filter((p) => p && p.user);
        if (Object.prototype.hasOwnProperty.call(data, 'pinned')) state.pinned = data.pinned || null;
        renderHeader();
        renderPinned();
        applyPresenceDots();
        if (state.sheetOpen) {
            $('sheet-sub').innerHTML = subtitleHtml().html;
            renderSheetMembers();
        }
    }

    // ---------- presence ----------
    function presenceOf(name) {
        return state.presence.find((p) => sameName(p.user, name)) || null;
    }
    function onlineNames() {
        return new Set(state.presence.filter((p) => p.online).map((p) => String(p.user).toLowerCase()));
    }
    function typingOthers() {
        return state.presence.filter((p) => p.typing && !sameName(p.user, myName()) && !isAiName(p.user)).map((p) => String(p.user));
    }
    function typingLabel(names) {
        if (names.length === 1) return `${names[0]} is typing…`;
        if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
        return `${names.length} people are typing…`;
    }

    function applyPresenceDots(root) {
        const online = onlineNames();
        (root || document).querySelectorAll('.av[data-user]').forEach((el) => {
            el.classList.toggle('online', online.has(el.dataset.user));
        });
    }

    function receiptInfo() {
        if (!state.user) return null;
        let mine = null;
        for (let i = state.messages.length - 1; i >= 0; i--) {
            if (isMine(state.messages[i])) { mine = state.messages[i]; break; }
        }
        if (!mine) return null;
        const id = String(mine.id);
        const seen = state.presence
            .filter((p) => !sameName(p.user, myName()) && !isAiName(p.user) && p.lastReadId != null && String(p.lastReadId) >= id)
            .map((p) => String(p.user));
        return { id: mine.id, seen };
    }

    // ---------- rendering ----------
    function hoverActionsHtml(id) {
        return `<div class="hover-actions">
            <button type="button" data-act="menu" data-id="${escapeHtml(id)}" title="React" aria-label="React"><i data-lucide="smile-plus"></i></button>
            <button type="button" data-act="reply" data-id="${escapeHtml(id)}" title="Reply" aria-label="Reply"><i data-lucide="reply"></i></button>
            <button type="button" data-act="menu" data-id="${escapeHtml(id)}" title="More" aria-label="More actions"><i data-lucide="ellipsis"></i></button>
        </div>`;
    }

    function reactionsHtml(m) {
        const r = m.reactions && typeof m.reactions === 'object' ? m.reactions : {};
        const me = myName();
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
        const reacts = reactionsHtml(m);
        if (reacts) classes.push('has-reacts');

        const hasImage = !!(m.image || m._localImage);
        const text = String(m.text || '');
        const ex = window.GroupExtras;
        const rich = ex && ex.richHtml ? ex.richHtml(m, { mine }) : '';     // polls and voice messages
        const emojiCount = !hasImage && !m.replyTo && !rich ? emojiOnlyCount(text) : 0;
        const photoOnly = hasImage && !text && !m.replyTo;
        const bubbleCls = ['bubble'];
        if (hasImage) bubbleCls.push('has-image');
        if (photoOnly) bubbleCls.push('photo-only');
        if (emojiCount) bubbleCls.push('emoji-only', 'e' + emojiCount);
        if (flags.mentionsMe) bubbleCls.push('mentions-me');
        if (rich) bubbleCls.push('rich', ex.richClass(m));
        if (flags.end && !emojiCount && !photoOnly) bubbleCls.push('tail');

        const time = escapeHtml(timeLabel(t));
        // NB: the bubble is white-space: pre-wrap, so its inner HTML must not contain stray whitespace.
        let inner = '';
        if (m.replyTo && typeof m.replyTo === 'object') {
            const rt = m.replyTo;
            const rtText = rt.text ? snippet(rt.text, 140) : 'Photo';
            inner += `<button type="button" class="reply-quote ${isAiName(rt.user) ? '' : personClass(rt.user)}" data-act="jump" data-id="${escapeHtml(rt.id)}" title="Show original message"><b class="acc-text">${escapeHtml(rt.user || 'Message')}</b><span>${escapeHtml(rtText)}</span></button>`;
        }
        if (hasImage) {
            const src = m._localImage || mediaUrl(m.image);
            inner += `<button type="button" class="msg-img-btn shimmer" data-act="lightbox" data-src="${escapeHtml(src)}" data-caption="${escapeHtml(displayName(m) + ' · ' + fullTime(t))}" title="Open photo"><img src="${escapeHtml(src)}" alt="Photo from ${escapeHtml(displayName(m))}" loading="lazy" decoding="async"></button>`;
        }
        if (rich) inner += rich;
        else if (text) inner += `<span class="msg-text">${formatText(text, m.mentions)}${emojiCount ? '' : `<span class="stamp-gap" aria-hidden="true">${time}</span>`}</span>`;
        inner += `<span class="stamp">${time}</span>`;

        let status = '';
        if (m._pending === 'sending') status = `<div class="msg-status">Sending…</div>`;
        else if (m._pending === 'failed') {
            status = `<button type="button" class="msg-status failed" data-act="retry" data-id="${escapeHtml(m.id)}"><i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i> Failed — tap to retry</button>`;
        }

        let name = '';
        if (!mine && flags.start) {
            name = m.kind === 'ai'
                ? `<div class="msg-name"><i data-lucide="sparkles" class="w-3 h-3"></i>${escapeHtml(displayName(m))}</div>`
                : `<div class="msg-name acc-text ${personClass(m.user)}">${escapeHtml(displayName(m))}</div>`;
        }
        const avatar = mine ? '' : `<div class="av-slot">${flags.end ? avatarHtml(m.user, '', { ai: m.kind === 'ai' }) : ''}</div>`;
        const swipe = m._pending ? '' : `<span class="swipe-ic" aria-hidden="true"><i data-lucide="reply"></i></span>`;

        return `<div class="${classes.join(' ')}" data-id="${escapeHtml(m.id)}">${swipe}${avatar}<div class="msg-col">${name}<div class="${bubbleCls.join(' ')}" data-bubble="1" data-id="${escapeHtml(m.id)}" title="${escapeHtml(fullTime(t))}">${inner}</div>${reacts}${status}</div>${m._pending ? '' : hoverActionsHtml(m.id)}</div>`;
    }

    function pendingAsMessage(p) {
        return {
            id: p.tempId,
            user: myName(),
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

    function typingRowHtml(names, ai) {
        const avs = ai ? avatarHtml(AI_NAME, '', { ai: true }) : names.slice(0, 2).map((n) => avatarHtml(n)).join('');
        const label = ai ? 'Chowaniec AI is thinking' : typingLabel(names);
        return `<div class="msg-row theirs group-start group-end typing-row${ai ? ' ai' : ''}" aria-label="${escapeHtml(label)}">
            <div class="av-slot"><span class="theirs-stack">${avs}</span></div>
            <div class="msg-col">
                <div class="bubble tail typing-bubble"><span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span></div>
            </div>
        </div>`;
    }

    function receiptHtml(info) {
        if (!info.seen.length) return `<div class="receipt" data-receipt="1"><span>Delivered</span></div>`;
        const names = info.seen;
        let label;
        if (names.length === 1) label = `Seen by ${names[0]}`;
        else if (names.length === 2) label = `Seen by ${names[0]} & ${names[1]}`;
        else label = `Seen by ${names.length}`;
        const avs = names.slice(0, 5).map((n) => avatarHtml(n, 'av-xs')).join('');
        return `<div class="receipt" data-receipt="1" title="${escapeHtml('Seen by ' + names.join(', '))}"><span>${escapeHtml(label)}</span><span class="avs">${avs}</span></div>`;
    }

    function buildItems() {
        const all = state.messages.concat(state.pending.map(pendingAsMessage));
        const items = [];
        const groupKey = (m) => (m.kind === 'system' ? null : `${m.kind || 'user'}|${String(m.user || '').toLowerCase()}`);
        const continues = (a, b) => !!a && !!b && a.kind !== 'system' && b.kind !== 'system' &&
            groupKey(a) === groupKey(b) && dayKey(ts(a)) === dayKey(ts(b)) && Math.abs(ts(b) - ts(a)) <= GROUP_GAP_MS;
        const receipt = receiptInfo();

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
                items.push({ key: `m:${m.id}`, sig: `sys|${m.text}|${m.link ? m.link.href : ''}`, t, html: `<div class="sys-row" data-id="${escapeHtml(m.id)}"><span>${formatText(m.text, m.mentions)}${m.link && /^\/[a-z]/.test(m.link.href || '') ? ` <a class="sys-link" href="${escapeHtml(m.link.href)}">${escapeHtml(m.link.label || 'Open')}</a>` : ''}</span></div>` });
                continue;
            }
            const flags = {
                mine: isMine(m),
                start: !continues(prev, m),
                end: !continues(m, next),
                mentionsMe: mentionsMe(m)
            };
            const sig = JSON.stringify([m.text, m.image, m._localImage ? m._localImage.length : 0, m.replyTo, m.reactions, m._pending, m.user, m.kind, flags, dayLabel(t), timeLabel(t), state.people.length, m.poll, m.voice]);
            items.push({ key: `m:${m.id}`, sig, t, id: m.id, html: messageHtml(m, flags) });
            if (receipt && receipt.id === m.id) {
                items.push({ key: 'receipt', sig: 'r|' + receipt.seen.join(','), html: receiptHtml(receipt) });
            }
        }

        if (state.aiThinkingUntil > Date.now()) {
            items.push({ key: 'ai-typing', sig: 'typing', anim: true, html: typingRowHtml([], true) });
        }
        const typing = typingOthers();
        if (typing.length) {
            items.push({ key: 'typing', sig: typing.join('|'), anim: true, html: typingRowHtml(typing, false) });
        }
        return items;
    }

    function extrasSignature() {
        const r = receiptInfo();
        return JSON.stringify([typingOthers(), r ? [r.id, r.seen] : null]);
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
        if (smooth && sc.scrollTo && !reducedMotion()) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
        else sc.scrollTop = sc.scrollHeight;
        state.stick = true;
        state.unseen = 0;
        renderJump();
        maybeSendRead();
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
        state.extrasSig = extrasSignature();
        const container = $('messages');
        const prevCache = state.nodeCache;
        const nextCache = new Map();
        let newest = state.newestTs;
        const nodes = items.map((it) => {
            let c = prevCache.get(it.key);
            if (!c || c.sig !== it.sig) {
                const el = htmlToEl(it.html);
                el.dataset.key = it.key;
                icons(el);
                const isNew = !prevCache.has(it.key);
                const freshMsg = it.t != null && it.t > state.newestTs && !(it.id != null && state.confirmed.has(it.id));
                if (state.rendered && isNew && (freshMsg || it.anim) && !reducedMotion()) {
                    el.classList.add('enter');
                    el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
                }
                c = { sig: it.sig, el };
            }
            if (it.t != null && it.t > newest) newest = it.t;
            nextCache.set(it.key, c);
            return c.el;
        });
        for (let i = 0; i < nodes.length; i++) {
            const cur = container.children[i];
            if (cur !== nodes[i]) container.insertBefore(nodes[i], cur || null);
        }
        while (container.children.length > nodes.length) container.lastElementChild.remove();
        state.nodeCache = nextCache;
        state.newestTs = newest;
        if (state.loaded) state.rendered = true;
        applyPresenceDots(container);

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
        renderJump();
        maybeSendRead();
        if (state.sheetOpen) renderSheetPhotos();
        if (window.GroupExtras && window.GroupExtras.afterRender) window.GroupExtras.afterRender();
    }

    function renderOlder() {
        const el = $('older');
        if (!state.loaded || !state.messages.length) { el.innerHTML = ''; return; }
        if (state.loadingOlder) {
            el.innerHTML = `<span class="inline-flex items-center gap-2"><i data-lucide="loader-circle" class="w-3.5 h-3.5 spin"></i> Loading earlier</span>`;
        } else if (state.hasMore) {
            el.innerHTML = `<button type="button" data-act="older">${state.olderError ? 'Couldn’t load — try again' : 'Load earlier messages'}</button>`;
        } else {
            el.innerHTML = `<span class="begin">Beginning of the family chat</span>`;
        }
        icons(el);
    }

    function renderJump() {
        const btn = $('jump-btn');
        const badge = $('jump-badge');
        const far = distanceFromBottom() > JUMP_SHOW_PX;
        const showIt = (state.unseen > 0 && !state.stick) || (far && state.loaded);
        btn.classList.toggle('show', !!showIt);
        if (state.unseen > 0 && !state.stick) {
            badge.textContent = state.unseen > 99 ? '99+' : String(state.unseen);
            badge.classList.remove('hidden');
            btn.setAttribute('aria-label', state.unseen === 1 ? '1 new message — jump to newest' : `${state.unseen} new messages — jump to newest`);
        } else {
            badge.classList.add('hidden');
            btn.setAttribute('aria-label', 'Jump to newest messages');
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

    // ---------- header / pinned ----------
    function subtitleHtml() {
        const typing = typingOthers();
        if (typing.length) return { html: escapeHtml(typingLabel(typing)), typing: true };
        const me = myName();
        const onlineOthers = state.presence.filter((p) => p.online && !sameName(p.user, me) && !isAiName(p.user)).length;
        const n = state.people.length;
        const base = n ? `${n} members` : 'Family chat';
        return { html: onlineOthers ? `${escapeHtml(base)}, <span class="on">${onlineOthers} online</span>` : escapeHtml(base), typing: false };
    }

    function groupAvatarHtml(size) {
        const me = myName();
        const others = state.people.filter((n) => !sameName(n, me));
        const pick = (others.length ? others : state.people).slice(0, 2);
        if (!pick.length) return avatarHtml('C', size);
        return pick.map((n) => avatarHtml(n, size)).join('');
    }

    function renderHeader() {
        const line = $('member-line');
        const sub = subtitleHtml();
        line.innerHTML = sub.html;
        line.classList.toggle('typing', sub.typing);
        line.title = state.people.join(', ');
        const ga = $('group-avatar');
        const html = groupAvatarHtml('');
        if (ga.dataset.sig !== html) { ga.innerHTML = html; ga.dataset.sig = html; }
    }

    function canUnpin() {
        const p = state.pinned;
        return !!(p && state.user && (state.user.host || sameName(p.pinnedBy, myName())));
    }

    function renderPinned() {
        const bar = $('pinned-bar');
        const p = state.pinned;
        if (!p || !p.id) { bar.classList.add('hidden'); bar.innerHTML = ''; bar.dataset.sig = ''; return; }
        const sig = JSON.stringify([p.id, p.text, p.image, p.pinnedBy, canUnpin()]);
        bar.classList.remove('hidden');
        if (bar.dataset.sig === sig) return;
        bar.dataset.sig = sig;
        const text = p.text ? snippet(p.text, 160) : (p.image ? 'Photo' : 'Message');
        bar.innerHTML = `<div class="wrap">
            <button type="button" class="pinned-main" data-act="jump-pinned" title="Show pinned message">
                <span class="pinned-bar-line"></span>
                <span class="pinned-body">
                    <span class="pinned-label"><i data-lucide="pin"></i>Pinned<span class="by">${p.pinnedBy ? '· by ' + escapeHtml(p.pinnedBy) : ''}</span></span>
                    <span class="pinned-text">${p.user ? `<b style="font-weight:500;color:var(--text-2)">${escapeHtml(p.user)}:</b> ` : ''}${escapeHtml(text)}</span>
                </span>
                ${p.image ? `<img class="pinned-thumb" src="${escapeHtml(mediaUrl(p.image))}" alt="">` : ''}
            </button>
            ${canUnpin() ? `<button type="button" class="icon-btn" data-act="unpin" title="Unpin" aria-label="Unpin message"><i data-lucide="x"></i></button>` : ''}
        </div>`;
        icons(bar);
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
            applyExtras(data);
            let fresh;
            let rendered = false;
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
                rendered = true;
            } else {
                fresh = upsert(list);
                if (list.length) state.latestId = list.slice().sort(compareMsgs)[list.length - 1].id;
                noteFresh(fresh);
                if (list.length || state.aiThinkingUntil) { render('auto'); rendered = true; }
            }
            if (state.aiThinkingUntil && state.aiThinkingUntil <= Date.now()) {
                state.aiThinkingUntil = 0;
                render('auto');
                rendered = true;
            }
            if (!rendered && extrasSignature() !== state.extrasSig) render('auto');
            state.failures = 0;
            hideBanner();
        } catch (e) {
            if (e.status === 401) return;
            state.failures++;
            const wait = Math.round(Math.min(30000, 2000 * Math.pow(2, state.failures - 1)) / 1000);
            showBanner(`${state.loaded ? 'Can’t reach the chat' : 'Couldn’t load messages'}: ${e.message.replace(/\.$/, '')}. Retrying in ${wait}s.`);
            if (!state.loaded) {
                $('initial-loading').innerHTML = `<i data-lucide="wifi-off" class="w-6 h-6"></i><span class="eyebrow mt-3">Waiting for connection&hellip;</span>`;
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

    async function loadOlderAndWait() {
        while (state.loadingOlder) await sleep(80);
        await loadOlder();
        while (state.loadingOlder) await sleep(80);
    }

    // Keep loading history while the screen isn't full yet (or the user is parked at the top).
    function fillViewport() {
        const sc = $('scroller');
        if (state.hasMore && !state.loadingOlder && sc.scrollHeight <= sc.clientHeight + 40) loadOlder();
    }

    // ---------- typing + read receipts ----------
    function noteTyping() {
        if (!state.loaded || state.stopped) return;
        if (!$('composer-input').value.trim()) return;
        const now = Date.now();
        if (now - state.typingSentAt < TYPING_EVERY_MS) return;
        state.typingSentAt = now;
        api(API, { method: 'POST', body: { action: 'typing' } }).catch(() => { /* best effort */ });
    }

    function maybeSendRead() {
        if (!state.loaded || state.stopped || document.visibilityState !== 'visible') return;
        if (distanceFromBottom() >= NEAR_BOTTOM_PX) return;
        const last = state.messages[state.messages.length - 1];
        if (!last) return;
        const id = String(last.id);
        if (id === state.readSentId) return;
        const wait = READ_EVERY_MS - (Date.now() - state.readSentAt);
        if (wait > 0) {
            if (!state.readTimer) state.readTimer = setTimeout(() => { state.readTimer = null; maybeSendRead(); }, wait + 20);
            return;
        }
        state.readSentId = id;
        state.readSentAt = Date.now();
        api(API, { method: 'POST', body: { action: 'read', id } }).catch(() => {
            if (state.readSentId === id) state.readSentId = null;
        });
    }

    // ---------- sending ----------
    function autosize() {
        const ta = $('composer-input');
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
        ta.style.overflowY = ta.scrollHeight > 160 ? 'auto' : 'hidden';
    }

    function updateSendButton() {
        const hasText = !!$('composer-input').value.trim();
        const has = hasText || !!state.image;
        $('btn-send').disabled = !has;
        $('composer').classList.toggle('has-content', has);
        $('composer').classList.toggle('has-text', !!$('composer-input').value);
    }

    function renderAttachments() {
        const row = $('attach-row');
        let html = '';
        if (state.replyTo) {
            const r = state.replyTo;
            const pc = r.kind === 'ai' ? '' : personClass(r.user);
            html += `<div class="chip-card chip-reply ${pc} fade-in">
                <div class="min-w-0 flex-1 pl-1.5">
                    <div class="chip-k"><span style="color:var(--muted);font-weight:400">Replying to</span> <span class="acc-text">${escapeHtml(displayName(r))}</span></div>
                    <div class="chip-t">${escapeHtml(r.text ? snippet(r.text, 120) : (r.image ? 'Photo' : ''))}</div>
                </div>
                ${r.image ? `<img class="chip-img" style="width:40px;height:40px" src="${escapeHtml(mediaUrl(r.image))}" alt="">` : ''}
                <button type="button" data-act="cancel-reply" title="Cancel reply" aria-label="Cancel reply" class="x"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>`;
        }
        if (state.image) {
            const im = state.image;
            const kb = Math.round(im.bytes / 1024);
            html += `<div class="chip-card fade-in">
                <img src="${escapeHtml(im.dataUrl)}" alt="Selected photo" class="chip-img">
                <div class="min-w-0 flex-1">
                    <div class="chip-k">Photo ready to send</div>
                    <div class="chip-t font-mono" style="font-size:11px">${im.width}×${im.height} · ${kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'}</div>
                </div>
                <button type="button" data-act="remove-image" title="Remove photo" aria-label="Remove photo" class="x"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>`;
        }
        row.innerHTML = html;
        if (html) row.classList.remove('hidden'); else row.classList.add('hidden');
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
        state.caret = { start: 0, end: 0 };
        state.image = null;
        state.replyTo = null;
        state.typingSentAt = 0;
        closeMention();
        closeEmoji();
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
        try { if (localStorage.getItem('chowaniec_group_smart') === 'off') body.smart = false; } catch (e) { /* ignore */ }
        if (p.imageData) body.image = p.imageData;
        if (p.replyTo) body.replyTo = p.replyTo.id;
        try {
            const data = await api(API, { method: 'POST', body });
            state.pending = state.pending.filter((x) => x !== p);
            if (data && data.message) {
                const all = Array.isArray(data.messages) && data.messages.length ? data.messages : [data.message];
                all.forEach((m) => state.confirmed.add(m.id));
                upsert(all);
                const last = all[all.length - 1];
                if (last && (!state.latestId || last.id > state.latestId)) state.latestId = last.id;
            }
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
        btn.innerHTML = '<i data-lucide="loader-circle" class="spin"></i>';
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
            btn.innerHTML = '<i data-lucide="image-plus"></i>';
            icons(btn);
        }
    }

    // ---------- mentions autocomplete ----------
    function mentionOptions() {
        const me = myName();
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
        closeEmoji();
        renderMention();
    }

    function renderMention() {
        const pop = $('mention-popup');
        const m = state.mention;
        if (!m) { pop.classList.add('hidden'); return; }
        const online = onlineNames();
        pop.innerHTML = `<p class="pop-title">Mention</p>` + m.options.map((o, i) => {
            const av = o.kind === 'ai' ? avatarHtml(AI_NAME, 'av-md', { ai: true })
                : o.kind === 'everyone' ? avatarHtml('', 'av-md', { everyone: true })
                    : avatarHtml(o.name, 'av-md');
            const hint = o.hint || (online.has(o.name.toLowerCase()) ? 'Online' : '');
            const active = i === m.index;
            return `<button type="button" role="option" aria-selected="${active}" data-mention="${escapeHtml(o.name)}" class="opt">
                ${av}<span class="min-w-0 flex-1"><span class="font-medium">@${escapeHtml(o.name)}</span>${hint ? `<span class="hint truncate">${escapeHtml(hint)}</span>` : ''}</span>
            </button>`;
        }).join('');
        pop.classList.remove('hidden');
        icons(pop);
        applyPresenceDots(pop);
        const act = pop.querySelector('[aria-selected="true"]');
        if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    }

    function closeMention() {
        state.mention = null;
        $('mention-popup').classList.add('hidden');
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
        state.caret = { start: pos, end: pos };
        closeMention();
        autosize();
        updateSendButton();
        ta.focus();
    }

    // ---------- emoji picker ----------
    // Only trust the selection while the textarea is focused (or just blurring): an unfocused
    // textarea can report a reset selection, which would make emoji land at the start.
    function rememberCaret(force) {
        const ta = $('composer-input');
        if (force !== true && document.activeElement !== ta) return;
        if (typeof ta.selectionStart === 'number') state.caret = { start: ta.selectionStart, end: ta.selectionEnd };
    }

    function openEmoji() {
        const pop = $('emoji-popup');
        if (!pop.dataset.built) {
            pop.innerHTML = `<p class="pop-title">Emoji</p><div class="emoji-grid">${EMOJI.map((e) => `<button type="button" data-emoji-insert="${e}" aria-label="${e}">${e}</button>`).join('')}</div>`;
            pop.dataset.built = '1';
        }
        closeMention();
        pop.classList.remove('hidden');
        $('btn-emoji').setAttribute('aria-expanded', 'true');
        $('btn-emoji').classList.add('on');
    }

    function closeEmoji() {
        $('emoji-popup').classList.add('hidden');
        $('btn-emoji').setAttribute('aria-expanded', 'false');
        $('btn-emoji').classList.remove('on');
    }

    function insertAtCaret(text) {
        const ta = $('composer-input');
        const len = ta.value.length;
        const start = Math.min(state.caret.start == null ? len : state.caret.start, len);
        const end = Math.min(Math.max(start, state.caret.end == null ? start : state.caret.end), len);
        ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
        const pos = start + text.length;
        state.caret = { start: pos, end: pos };
        try { ta.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
        autosize();
        updateSendButton();
        noteTyping();
        if (isFinePointer()) ta.focus();
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

    function actionMenuHtml(m) {
        const pendingMsg = !!m._pending;
        let html = `<div class="grabber"></div>`;
        const t = ts(m);
        const pv = m.text ? snippet(m.text, 120) : (m.image || m._localImage ? 'Photo' : '');
        html += `<div class="menu-preview">${avatarHtml(m.user, 'av-sm', { ai: m.kind === 'ai' })}<div class="min-w-0 flex-1"><div class="n">${escapeHtml(displayName(m))} <span style="font-weight:400;color:var(--faint)">· ${escapeHtml(fullTime(t))}</span></div><div class="t">${escapeHtml(pv)}</div></div></div>`;
        if (!pendingMsg) {
            const mineReacts = (e) => ((m.reactions || {})[e] || []).some((n) => sameName(n, myName()));
            if (state.menuEmojiOpen) {
                html += `<div class="menu-emoji"><div class="emoji-grid">${EMOJI.map((e) => `<button type="button" role="menuitem" data-act="react" data-id="${escapeHtml(m.id)}" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div></div>`;
            } else {
                html += `<div class="quick-react">` +
                    QUICK_EMOJI.map((e) => `<button type="button" role="menuitem" data-act="react" data-id="${escapeHtml(m.id)}" data-emoji="${e}" title="React ${e}" class="${mineReacts(e) ? 'on' : ''}">${e}</button>`).join('') +
                    `<button type="button" role="menuitem" data-act="react-more" data-id="${escapeHtml(m.id)}" class="more" title="More reactions" aria-label="More reactions"><i data-lucide="plus"></i></button></div>`;
            }
        }
        const item = (act, icon, label, extra) => `<button type="button" role="menuitem" data-act="${act}" data-id="${escapeHtml(m.id)}" class="mi${extra ? ' ' + extra : ''}"><i data-lucide="${icon}"></i>${label}</button>`;
        let items = '';
        if (!pendingMsg) items += item('reply', 'reply', 'Reply');
        if (!pendingMsg) {
            const isPinned = state.pinned && String(state.pinned.id) === String(m.id);
            if (isPinned) { if (canUnpin()) items += item('unpin', 'pin-off', 'Unpin'); }
            else items += item('pin', 'pin', 'Pin');
        }
        if (m._pending === 'failed') items += item('retry', 'rotate-cw', 'Retry sending');
        if (m.text) items += item('copy', 'copy', 'Copy text');
        if (window.GroupExtras && window.GroupExtras.menuItems && !pendingMsg) items += window.GroupExtras.menuItems(m);
        if (canDelete(m)) items += item('delete', 'trash-2', pendingMsg ? 'Discard' : 'Delete', 'danger');
        html += `<div class="menu-items">${items}</div>`;
        return html;
    }

    function positionMenu(anchorEl) {
        const menu = $('action-menu');
        const row = rowEl(state.menuFor);
        if (window.innerWidth >= 640) {
            const target = anchorEl || (row && row.querySelector('.bubble'));
            const r = target && target.isConnected ? target.getBoundingClientRect() : { top: window.innerHeight / 2, bottom: window.innerHeight / 2, left: window.innerWidth / 2, right: window.innerWidth / 2 };
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
    }

    function openActions(id, anchorEl) {
        const m = findMessage(id);
        if (!m || m.kind === 'system') return;
        closeActions();
        closeEmoji();
        state.menuFor = id;
        state.menuEmojiOpen = false;
        state.menuAnchor = anchorEl || null;
        const menu = $('action-menu');
        menu.innerHTML = actionMenuHtml(m);
        icons(menu);

        show($('action-backdrop'), 'block');
        show(menu, 'block');
        menu.classList.add('sheet-enter');

        const row = rowEl(id);
        if (row) row.classList.add('press');
        positionMenu(anchorEl);
        const first = menu.querySelector('button');
        if (first && isFinePointer()) first.focus({ preventScroll: true });
    }

    function expandMenuEmoji() {
        const m = findMessage(state.menuFor);
        if (!m) return;
        state.menuEmojiOpen = true;
        const menu = $('action-menu');
        menu.innerHTML = actionMenuHtml(m);
        icons(menu);
        positionMenu(state.menuAnchor);
    }

    function closeActions() {
        if (!state.menuFor) return;
        const row = rowEl(state.menuFor);
        if (row) row.classList.remove('press');
        state.menuFor = null;
        state.menuAnchor = null;
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
        return !had;
    }

    function heartPop(id) {
        const row = rowEl(id);
        const bubble = row && row.querySelector('.bubble');
        if (!bubble) return;
        const h = document.createElement('span');
        h.className = 'heart-pop';
        h.setAttribute('aria-hidden', 'true');
        h.textContent = '❤️';
        bubble.appendChild(h);
        setTimeout(() => h.remove(), 800);
    }

    async function doubleTapHeart(id) {
        const m = state.byId.get(id);
        if (!m) return;
        const had = ((m.reactions || {})['❤️'] || []).some((n) => sameName(n, myName()));
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* ignore */ } }
        const p = toggleReaction(id, '❤️');
        if (!had) heartPop(id);
        await p;
    }

    async function pinMessage(id) {
        const m = state.byId.get(id);
        if (!m) return;
        const prev = state.pinned;
        state.pinned = { id: m.id, user: displayName(m), text: m.text || '', image: m.image || null, pinnedBy: myName(), pinnedAt: new Date().toISOString() };
        renderPinned();
        try {
            const data = await api(API, { method: 'POST', body: { action: 'pin', id } });
            if (data && Object.prototype.hasOwnProperty.call(data, 'pinned')) state.pinned = data.pinned;
            renderPinned();
            toast('Message pinned');
        } catch (e) {
            state.pinned = prev;
            renderPinned();
            if (e.status !== 401) toast(e.message, 'error');
        }
    }

    async function unpinMessage() {
        if (!state.pinned) return;
        const prev = state.pinned;
        state.pinned = null;
        renderPinned();
        try {
            const data = await api(API, { method: 'POST', body: { action: 'unpin' } });
            if (data && Object.prototype.hasOwnProperty.call(data, 'pinned')) state.pinned = data.pinned;
            renderPinned();
            toast('Message unpinned');
        } catch (e) {
            state.pinned = prev;
            renderPinned();
            if (e.status !== 401) toast(e.message, 'error');
        }
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
            if (state.pinned && String(state.pinned.id) === String(id)) { state.pinned = null; renderPinned(); }
            toast('Message deleted');
        } catch (e) {
            state.byId.set(id, m);
            resort();
            render('auto');
            if (e.status !== 401) toast(e.message, 'error');
        }
    }

    function flashRow(row) {
        row.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        row.classList.remove('flash');
        void row.offsetWidth;
        row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1600);
    }

    // Scrolls to a message, loading earlier pages if needed (bounded).
    async function revealMessage(id) {
        let row = rowEl(id);
        if (row) { flashRow(row); return true; }
        if (!state.hasMore) { toast('That message is no longer here.'); return false; }
        toast('Finding that message…');
        for (let i = 0; i < 20 && !row && state.hasMore; i++) {
            await loadOlderAndWait();
            if (state.olderError) break;
            row = rowEl(id);
        }
        if (row) { requestAnimationFrame(() => flashRow(row)); return true; }
        toast(state.olderError ? 'Couldn’t load older messages.' : 'That message is no longer here.', state.olderError ? 'error' : undefined);
        return false;
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
        if (state.pushBusy) { icon = 'loader-circle'; title = 'Working…'; }
        else if (s === 'enabled') { icon = 'bell-ring'; title = 'Notifications are on'; }
        else if (s === 'disabled') { icon = 'bell'; title = 'Turn on notifications'; }
        else if (s === 'needs-install') { icon = 'bell-plus'; title = 'Install the app to get notifications'; }
        else if (s === 'denied') { icon = 'bell-off'; title = 'Notifications are blocked'; }
        else if (s === 'unsupported' || s === 'not-configured') { icon = 'bell-off'; title = 'Notifications unavailable'; }
        else if (s === 'error') { icon = 'bell'; title = 'Couldn’t check notifications'; }
        btn.className = `icon-btn${s === 'enabled' ? ' on' : ''}`;
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.dataset.status = s;
        const dot = s === 'disabled' || s === 'needs-install' ? '<span class="attn"></span>' : '';
        btn.innerHTML = `<i data-lucide="${icon}" class="${state.pushBusy ? 'spin' : ''}"></i>${dot}`;
        icons(btn);
        if (state.sheetOpen) renderSheetNotify();
    }

    function deniedSteps() {
        const P = pwa();
        const plat = P && typeof P.platform === 'function' ? P.platform() : 'desktop';
        if (plat === 'ios') return 'Open the iPhone <b>Settings</b> app → <b>Notifications</b> → <b>Chowaniec</b>, and turn on <b>Allow Notifications</b>. Then come back and tap “Check again”.';
        if (plat === 'android') return 'Tap the <b>⋮</b> menu or the icon left of the address bar → <b>Site settings</b> (or <b>App info</b>) → <b>Notifications</b> → <b>Allow</b>. Then tap “Check again”.';
        return 'Click the icon to the left of the address bar → <b>Site settings</b> → <b>Notifications</b> → <b>Allow</b>, then reload this page or tap “Check again”.';
    }

    function bellPanelHtml(inSheet) {
        const s = state.push;
        const head = (icon, title, tone) => `<div class="np-head"><div class="np-ic ${tone || ''}"><i data-lucide="${icon}"></i></div><h3 class="np-title">${title}</h3></div>`;
        const p = (t) => `<p class="np-p">${t}</p>`;
        const pill = (attrs, label, dark) => `<button type="button" ${attrs} class="btn ${dark ? 'btn-solid' : 'btn-ghost'}">${label}</button>`;
        if (state.pushBusy) return head('loader-circle', 'Working…') + p('One moment while we update your notifications.');
        if (s === 'enabled') {
            return head('bell-ring', 'Notifications are on', 'solid') +
                p('You’ll get a notification for new family messages and when someone @mentions you.') +
                `<div class="np-actions">${pill('data-bell="test"', 'Send a test')}${pill('data-bell="disable"', 'Turn off', true)}</div>`;
        }
        if (s === 'needs-install') {
            return head('smartphone', 'Install the app first') +
                p('On iPhone and iPad, notifications only work when Chowaniec is opened from your Home Screen.') +
                `<div class="np-actions"><a href="/get-the-app/" class="btn btn-solid">How to install <i data-lucide="arrow-right"></i></a></div>`;
        }
        if (s === 'denied') {
            return head('bell-off', 'Notifications are blocked', 'warn') +
                p('Your browser is blocking notifications for this site. To turn them back on:') +
                `<p class="np-p" style="margin-top:8px;color:var(--text-2)">${deniedSteps()}</p>` +
                `<div class="np-actions">${pill('data-bell="check"', 'Check again')}</div>`;
        }
        if (s === 'disabled') {
            return head('bell', 'Get notified') + p('Turn on notifications to hear about new messages and @mentions.') +
                `<div class="np-actions">${pill('data-bell="enable"', 'Turn on notifications', true)}</div>`;
        }
        if (s === 'error') {
            return head('bell', 'Couldn’t check notifications') +
                p('We couldn’t reach the server just now. Check your connection and try again.') +
                `<div class="np-actions">${pill('data-bell="check"', 'Try again', true)}</div>`;
        }
        if (s === 'not-configured') return head('bell-off', 'Not set up yet') + p('Notifications haven’t been switched on for the family site yet. Check back soon.');
        if (s === 'unsupported') {
            return head('bell-off', 'Not available here') + p('This browser can’t show notifications. Installing the Chowaniec app usually fixes that.') +
                `<div class="np-actions"><a href="/get-the-app/" class="btn btn-ghost">Get the app</a></div>`;
        }
        return head('loader-circle', 'One moment…') + p(inSheet ? 'Notifications are still loading.' : 'Notifications are still loading. Try again in a second.');
    }

    function renderBellPanel() {
        const panel = $('bell-panel');
        panel.innerHTML = bellPanelHtml(false);
        icons(panel);
    }

    function toggleBellPanel(force) {
        const panel = $('bell-panel');
        const open = force != null ? force : panel.classList.contains('hidden');
        if (open) {
            renderBellPanel();
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
        $('btn-bell').setAttribute('aria-expanded', String(open));
    }

    async function enablePushFlow(fromSheet) {
        const P = pwa();
        if (!P || state.pushBusy) return;
        toggleBellPanel(false);
        state.pushBusy = true;
        renderBell();
        let result = 'error';
        try { result = await P.enablePush(); } catch (e) { result = 'error'; }
        state.pushBusy = false;
        await refreshBell();
        if (result === 'enabled') toast('Notifications are on');
        else if (result === 'denied') { if (!fromSheet) toggleBellPanel(true); }
        else toast('Couldn’t turn on notifications. Please try again.', 'error');
    }

    async function onBellClick() {
        if (state.pushBusy) return;
        const P = pwa();
        if (!P) {
            await refreshBell();
            toggleBellPanel();
            return;
        }
        if (state.push === 'disabled') { await enablePushFlow(false); return; }
        toggleBellPanel();
    }

    async function onBellPanelAction(action, fromSheet) {
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
            if (!fromSheet && state.push !== 'denied') toggleBellPanel(state.push !== 'disabled' && state.push !== 'enabled');
            if (state.push === 'disabled') toast(fromSheet ? 'Unblocked — you can turn them on now' : 'Unblocked — tap the bell to turn on');
        } else if (action === 'enable') {
            state.push = 'disabled';
            await enablePushFlow(fromSheet);
        }
    }

    // ---------- theme ----------
    const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function readTheme() {
        try {
            const v = localStorage.getItem(THEME_KEY) || localStorage.getItem(OLD_THEME_KEY);
            return v === 'light' || v === 'dark' ? v : 'auto';
        } catch (e) {
            return 'auto';
        }
    }

    function applyTheme() {
        const pref = state.theme;
        const dark = pref === 'dark' || (pref === 'auto' && !!(darkQuery && darkQuery.matches));
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', dark ? '#141417' : '#ffffff');
    }

    function setTheme(pref) {
        state.theme = pref === 'light' || pref === 'dark' ? pref : 'auto';
        try {
            if (state.theme === 'auto') { localStorage.removeItem(THEME_KEY); localStorage.removeItem(OLD_THEME_KEY); }
            else localStorage.setItem(THEME_KEY, state.theme);
        } catch (e) { /* storage blocked: still applies for this visit */ }
        applyTheme();
        renderThemeSeg();
    }

    function renderThemeSeg() {
        document.querySelectorAll('#theme-seg [data-theme-choice]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.themeChoice === state.theme));
        });
    }

    // ---------- chat info sheet ----------
    function openSheet(focusSearch) {
        if (state.sheetOpen) { if (focusSearch) $('search-input').focus(); return; }
        closeActions();
        toggleBellPanel(false);
        closeEmoji();
        state.sheetOpen = true;
        renderSheet();
        renderThemeSeg();
        show($('sheet-backdrop'), 'block');
        const sheet = $('info-sheet');
        show(sheet);
        sheet.classList.remove('sheet-enter');
        void sheet.offsetWidth;
        sheet.classList.add('sheet-enter');
        $('btn-info').setAttribute('aria-expanded', 'true');
        try { history.pushState({ chowaniecSheet: true }, ''); } catch (e) { /* ignore */ }
        if (focusSearch) setTimeout(() => $('search-input').focus(), 60);
        else if (isFinePointer()) $('sheet-close').focus({ preventScroll: true });
    }

    function closeSheet(fromPop) {
        if (!state.sheetOpen) return;
        state.sheetOpen = false;
        hide($('info-sheet'));
        hide($('sheet-backdrop'), 'block');
        $('btn-info').setAttribute('aria-expanded', 'false');
        if (!fromPop && history.state && history.state.chowaniecSheet) {
            try { history.back(); } catch (e) { /* ignore */ }
        }
    }

    function renderSheet() {
        const ga = $('sheet-avatar');
        ga.innerHTML = groupAvatarHtml('');
        const sub = subtitleHtml();
        $('sheet-sub').innerHTML = sub.html;
        renderSheetMembers();
        renderSheetNotify();
        renderSheetPhotos();
        if (state.search.q) renderSearch();
        icons($('info-sheet'));
        applyPresenceDots($('info-sheet'));
    }

    function memberEntries() {
        const names = state.people.slice();
        state.presence.forEach((p) => { if (!isAiName(p.user) && !names.some((n) => sameName(n, p.user))) names.push(String(p.user)); });
        if (state.user && !names.some((n) => sameName(n, myName()))) names.push(myName());
        return names.map((n) => {
            const p = presenceOf(n);
            const isMe = sameName(n, myName());
            const online = !!(p && p.online) || isMe;
            const t = p && p.lastSeen ? Date.parse(p.lastSeen) || 0 : 0;
            return { name: n, p, isMe, online, t };
        }).sort((a, b) => (Number(b.online) - Number(a.online)) || (b.t - a.t) || a.name.localeCompare(b.name));
    }

    function renderSheetMembers() {
        const list = memberEntries();
        $('members-count').textContent = String(list.length);
        $('sheet-members').innerHTML = list.map((e) => {
            let st;
            let on = false;
            if (e.p && e.p.typing && !e.isMe) { st = 'typing…'; on = true; }
            else if (e.online) { st = 'Online'; on = true; }
            else if (e.p && e.p.lastSeen) st = lastSeenLabel(e.p.lastSeen);
            else st = 'Hasn’t opened the chat yet';
            return `<div class="member" data-member="${escapeHtml(e.name)}">${avatarHtml(e.name, 'av-lg')}<div class="min-w-0 flex-1"><div class="nm">${escapeHtml(e.name)}${e.isMe ? '<span class="you">You</span>' : ''}</div><div class="st${on ? ' on' : ''}">${escapeHtml(st)}</div></div></div>`;
        }).join('');
        // You are always shown as online in your own list.
        const meEl = $('sheet-members').querySelector('.av[data-user="' + (window.CSS && CSS.escape ? CSS.escape(myName().toLowerCase()) : myName().toLowerCase()) + '"]');
        applyPresenceDots($('sheet-members'));
        if (meEl) meEl.classList.add('online');
    }

    function renderSheetNotify() {
        const el = $('sheet-notify');
        el.innerHTML = bellPanelHtml(true);
        icons(el);
    }

    function renderSheetPhotos() {
        const photos = state.messages.filter((m) => m.image).slice().reverse();
        $('photos-count').textContent = photos.length ? String(photos.length) + (state.hasMore ? '+' : '') : '';
        const el = $('sheet-photos');
        const sig = photos.map((m) => m.id).join(',');
        if (el.dataset.sig === sig) return;
        el.dataset.sig = sig;
        if (!photos.length) {
            el.innerHTML = `<div class="card"><p class="muted-note">Photos shared in the chat will show up here.</p></div>`;
            return;
        }
        el.innerHTML = `<div class="photo-grid">${photos.map((m) => {
            const src = mediaUrl(m.image);
            return `<button type="button" class="shimmer" data-act="lightbox" data-src="${escapeHtml(src)}" data-caption="${escapeHtml(displayName(m) + ' · ' + fullTime(ts(m)))}" title="${escapeHtml('Photo from ' + displayName(m))}"><img src="${escapeHtml(src)}" alt="${escapeHtml('Photo from ' + displayName(m))}" loading="lazy" decoding="async"></button>`;
        }).join('')}</div>`;
    }

    function searchMatches(q) {
        return state.messages.filter((m) => m.kind !== 'system' && String(m.text || '').toLowerCase().includes(q)).reverse();
    }

    function hitSnippet(text, q) {
        const s = String(text || '').replace(/\s+/g, ' ');
        const i = s.toLowerCase().indexOf(q);
        if (i > 48) return '…' + s.slice(i - 36);
        return s;
    }

    function renderSearch() {
        const q = state.search.q.trim().toLowerCase();
        const res = $('search-results');
        const sections = $('sheet-sections');
        $('search-field').classList.toggle('has-value', !!state.search.q);
        if (!q) {
            res.classList.add('hidden');
            res.innerHTML = '';
            sections.classList.remove('hidden');
            return;
        }
        sections.classList.add('hidden');
        res.classList.remove('hidden');
        const hits = searchMatches(q);
        const oldest = state.messages[0];
        let html = `<div class="sec-title"><span>${hits.length === 1 ? '1 result' : hits.length + ' results'}</span></div>`;
        if (hits.length) {
            html += `<div class="card">${hits.slice(0, 200).map((m) => `<button type="button" class="hit" data-act="search-hit" data-id="${escapeHtml(m.id)}">${avatarHtml(m.user, 'av-md', { ai: m.kind === 'ai' })}<span class="min-w-0 flex-1"><span class="top"><b class="${m.kind === 'ai' ? '' : 'acc-text ' + personClass(m.user)}">${escapeHtml(displayName(m))}</b><time>${escapeHtml(shortWhen(ts(m)))}</time></span><span class="tx">${highlight(hitSnippet(m.text, q), q)}</span></span></button>`).join('')}</div>`;
        } else {
            html += `<div class="card"><p class="muted-note">No messages match “${escapeHtml(state.search.q.trim())}”${state.hasMore ? ' in the loaded history yet' : ''}.</p></div>`;
        }
        html += `<div class="search-foot">`;
        if (state.search.busy) {
            html += `<span class="inline-flex items-center gap-2"><i data-lucide="loader-circle" class="w-4 h-4 spin"></i> Searching older messages…</span>`;
        } else if (state.hasMore) {
            html += `<span>Searched back to ${escapeHtml(oldest ? dayLabel(ts(oldest)) : 'the start')}</span><button type="button" class="btn btn-ghost" data-act="search-older"><i data-lucide="history"></i>Search older messages</button>`;
        } else {
            html += `<span>Searched the whole chat</span>`;
        }
        html += `</div>`;
        res.innerHTML = html;
        icons(res);
        applyPresenceDots(res);
    }

    async function searchOlder() {
        if (state.search.busy) return;
        const q = state.search.q.trim().toLowerCase();
        if (!q) return;
        state.search.busy = true;
        renderSearch();
        const before = searchMatches(q).length;
        for (let i = 0; i < 10 && state.hasMore; i++) {
            await loadOlderAndWait();
            if (state.olderError) break;
            if (searchMatches(q).length > before) break;
        }
        state.search.busy = false;
        if (state.olderError) toast('Couldn’t load older messages.', 'error');
        if (state.sheetOpen) renderSearch();
    }

    // ---------- events ----------
    function bindEvents() {
        const sc = $('scroller');
        const ta = $('composer-input');

        sc.addEventListener('scroll', () => {
            const near = distanceFromBottom() < NEAR_BOTTOM_PX;
            state.stick = near;
            if (near && state.unseen) state.unseen = 0;
            renderJump();
            if (near) maybeSendRead();
            if (sc.scrollTop < 300) loadOlder();
            if (state.menuFor && window.innerWidth >= 640) closeActions();
        }, { passive: true });

        // Images change height when they load: stay pinned to the bottom if we were there. Also stop the shimmer.
        const onImg = (e) => {
            const t = e.target;
            if (!t || t.tagName !== 'IMG') return;
            const sh = t.closest('.shimmer');
            if (sh) sh.classList.add('loaded');
            if (state.stick && $('messages').contains(t)) sc.scrollTop = sc.scrollHeight;
        };
        document.addEventListener('load', onImg, true);
        document.addEventListener('error', onImg, true);

        // The composer grows (reply chip, photo, multi-line text) or the keyboard opens: stay pinned.
        if (window.ResizeObserver) {
            new ResizeObserver(() => { if (state.stick) sc.scrollTop = sc.scrollHeight; }).observe(sc);
        }

        $('jump-btn').addEventListener('click', () => scrollToBottom(true));
        $('btn-retry').addEventListener('click', () => { state.failures = 0; hideBanner(); poll(); });

        // Delegated clicks inside the message list, sheets + composer extras
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
                case 'react-more': expandMenuEmoji(); break;
                case 'copy': { closeActions(); const m = findMessage(id); if (m) copyText(m.text || ''); break; }
                case 'delete': closeActions(); askDelete(id); break;
                case 'retry': closeActions(); retryPending(id); break;
                case 'pin': closeActions(); pinMessage(id); break;
                case 'unpin': closeActions(); unpinMessage(); break;
                case 'jump': revealMessage(id); break;
                case 'jump-pinned': if (state.pinned) revealMessage(state.pinned.id); break;
                case 'lightbox': openLightbox(t.dataset.src, t.dataset.caption); break;
                case 'older': loadOlder(); break;
                case 'cancel-reply': setReply(null); break;
                case 'remove-image': state.image = null; renderAttachments(); updateSendButton(); break;
                case 'search-hit': closeSheet(false); setTimeout(() => revealMessage(id), 80); break;
                case 'search-older': searchOlder(); break;
                default: break;
            }
        }, true);

        // ----- Touch gestures: long-press (actions), swipe right (reply), double-tap (❤️) -----
        let pressTimer = null;
        let pressVisual = null;
        let g = null;              // current gesture
        let lastTap = null;
        const clearPressTimers = () => { clearTimeout(pressTimer); pressTimer = null; clearTimeout(pressVisual); pressVisual = null; };
        const unpress = () => {
            if (g && g.row && state.menuFor !== g.id) g.row.classList.remove('press');
        };
        const resetSwipe = (row, animate) => {
            if (!row) return;
            row.classList.remove('swiping', 'armed');
            if (animate) {
                row.classList.add('settle');
                setTimeout(() => row.classList.remove('settle'), 280);
            }
            row.style.transform = '';
            row.style.removeProperty('--swipe');
        };

        sc.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') return;
            const row = e.target.closest('.msg-row[data-id]');
            if (!row || row.classList.contains('typing-row')) { g = null; return; }
            const bubble = e.target.closest('.bubble[data-bubble]');
            // A double-tap on the empty space beside a bubble counts too (hearts the whole message).
            const tapTarget = bubble || row.querySelector('.bubble[data-bubble]');
            const m = findMessage(row.dataset.id);
            g = {
                id: row.dataset.id, row, bubble, tapTarget, x: e.clientX, y: e.clientY, t: Date.now(), mode: null, dx: 0,
                canReply: !!m && !m._pending && m.kind !== 'system',
                interactive: !!e.target.closest('a, .msg-img-btn, .reply-quote, .react-chip, .msg-status, .hover-actions, [data-x]')
            };
            if (!bubble) return;
            pressVisual = setTimeout(() => { if (g && !g.mode) row.classList.add('press'); }, 140);
            pressTimer = setTimeout(() => {
                pressTimer = null;
                if (!g || g.mode) return;
                g.mode = 'long';
                suppressClick = true;
                setTimeout(() => { suppressClick = false; }, 700);
                row.classList.remove('press');
                if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* ignore */ } }
                openActions(bubble.dataset.id, bubble);
            }, 450);
        });

        sc.addEventListener('pointermove', (e) => {
            if (!g || g.mode === 'long' || e.pointerType === 'mouse') return;
            const dx = e.clientX - g.x;
            const dy = e.clientY - g.y;
            if (!g.mode) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                clearPressTimers();
                unpress();
                g.mode = (g.canReply && dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.3) ? 'swipe' : 'scroll';
                if (g.mode === 'swipe') g.row.classList.add('swiping');
            }
            if (g.mode !== 'swipe') return;
            const raw = Math.max(0, dx);
            const off = raw <= SWIPE_REPLY_PX ? raw : SWIPE_REPLY_PX + Math.min(30, (raw - SWIPE_REPLY_PX) * 0.3);
            g.dx = raw;
            g.row.style.transform = `translateX(${off.toFixed(1)}px)`;
            g.row.style.setProperty('--swipe', Math.min(1, raw / SWIPE_REPLY_PX).toFixed(3));
            const armed = raw >= SWIPE_REPLY_PX;
            if (armed !== g.row.classList.contains('armed')) {
                g.row.classList.toggle('armed', armed);
                if (armed && navigator.vibrate) { try { navigator.vibrate(6); } catch (err) { /* ignore */ } }
            }
        });

        const endGesture = (e, cancelled) => {
            if (!g || e.pointerType === 'mouse') return;
            const cur = g;
            clearPressTimers();
            unpress();
            if (cur.mode === 'swipe') {
                resetSwipe(cur.row, true);
                if (!cancelled && cur.dx >= SWIPE_REPLY_PX) {
                    suppressClick = true;
                    setTimeout(() => { suppressClick = false; }, 400);
                    setReply(findMessage(cur.id));
                }
            } else if (!cur.mode && !cancelled && cur.tapTarget && !cur.interactive && Date.now() - cur.t < 350 && cur.canReply) {
                const now = Date.now();
                if (lastTap && lastTap.id === cur.id && now - lastTap.t < 340 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
                    lastTap = null;
                    // The browser still sends a "click" after this tap. By then the new ❤️ chip can sit under
                    // the finger, so that click would press the chip and take the heart straight back off.
                    suppressClick = true;
                    setTimeout(() => { suppressClick = false; }, 450);
                    if (window.getSelection) { try { window.getSelection().removeAllRanges(); } catch (err) { /* ignore */ } }
                    doubleTapHeart(cur.id);
                } else {
                    lastTap = { id: cur.id, t: now, x: e.clientX, y: e.clientY };
                }
            }
            g = null;
        };
        sc.addEventListener('pointerup', (e) => endGesture(e, false));
        sc.addEventListener('pointercancel', (e) => endGesture(e, true));

        sc.addEventListener('contextmenu', (e) => {
            const bubble = e.target.closest('.bubble[data-bubble]');
            if (!bubble) return;
            if (e.target.closest('a') && isFinePointer()) return; // allow native menu on links (desktop)
            e.preventDefault();
            if (state.menuFor === bubble.dataset.id) return;
            clearPressTimers();
            openActions(bubble.dataset.id, bubble);
        });

        $('action-backdrop').addEventListener('click', closeActions);
        $('action-backdrop').addEventListener('contextmenu', (e) => { e.preventDefault(); closeActions(); });

        // Composer
        $('composer').addEventListener('submit', (e) => { e.preventDefault(); sendFromComposer(); });
        $('btn-send').addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') e.preventDefault(); });
        $('btn-send').addEventListener('click', (e) => { e.preventDefault(); sendFromComposer(); });
        ta.addEventListener('input', () => { autosize(); updateSendButton(); rememberCaret(); detectMention(); noteTyping(); });
        ta.addEventListener('click', () => { rememberCaret(); detectMention(); if (!isFinePointer()) closeEmoji(); });
        ta.addEventListener('focus', () => { if (!isFinePointer()) closeEmoji(); });
        ta.addEventListener('select', rememberCaret);
        ta.addEventListener('keyup', (e) => { rememberCaret(); if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detectMention(); });
        ta.addEventListener('blur', () => { rememberCaret(true); setTimeout(() => { if (document.activeElement !== ta) closeMention(); }, 150); });
        ta.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            const m = state.mention;
            if (m) {
                if (e.key === 'ArrowDown') { e.preventDefault(); m.index = (m.index + 1) % m.options.length; renderMention(); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); m.index = (m.index - 1 + m.options.length) % m.options.length; renderMention(); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(m.options[m.index].name); return; }
                if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
            }
            if (e.key === 'Escape' && !$('emoji-popup').classList.contains('hidden')) { closeEmoji(); return; }
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

        // Emoji picker
        const emojiBtn = $('btn-emoji');
        emojiBtn.addEventListener('mousedown', (e) => e.preventDefault());
        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if ($('emoji-popup').classList.contains('hidden')) {
                if (document.activeElement === ta) rememberCaret();
                openEmoji();
                if (!isFinePointer()) ta.blur();
            } else {
                closeEmoji();
                if (isFinePointer()) ta.focus();
            }
        });
        const ep = $('emoji-popup');
        ep.addEventListener('mousedown', (e) => e.preventDefault());
        ep.addEventListener('click', (e) => {
            e.stopPropagation();
            const b = e.target.closest('[data-emoji-insert]');
            if (b) insertAtCaret(b.dataset.emojiInsert);
        });
        document.addEventListener('click', (e) => {
            if (!ep.classList.contains('hidden') && !e.target.closest('#emoji-popup') && !e.target.closest('#btn-emoji') && e.target !== ta) closeEmoji();
        });

        $('btn-photo').addEventListener('click', () => $('file-input').click());
        $('btn-camera').addEventListener('click', () => $('camera-input').click());
        ['file-input', 'camera-input'].forEach((fid) => {
            $(fid).addEventListener('change', (e) => {
                const f = e.target.files && e.target.files[0];
                e.target.value = '';
                attachFile(f);
            });
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
        window.addEventListener('popstate', () => {
            const st = history.state || {};
            if (!$('lightbox').classList.contains('hidden') && !st.chowaniecLightbox) closeLightbox(true);
            if (state.sheetOpen && !st.chowaniecSheet && !st.chowaniecLightbox) closeSheet(true);
        });

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
            if (b) onBellPanelAction(b.dataset.bell, false);
        });
        document.addEventListener('click', (e) => {
            if (!$('bell-panel').classList.contains('hidden') && !e.target.closest('#bell-panel') && !e.target.closest('#btn-bell')) toggleBellPanel(false);
        });
        window.addEventListener('chowaniec-pwa-change', refreshBell);
        window.addEventListener('load', refreshBell);

        // Chat info sheet
        $('btn-info').addEventListener('click', () => openSheet(false));
        $('btn-search').addEventListener('click', () => openSheet(true));
        $('sheet-close').addEventListener('click', () => closeSheet(false));
        $('sheet-backdrop').addEventListener('click', () => closeSheet(false));
        $('sheet-notify').addEventListener('click', (e) => {
            const b = e.target.closest('[data-bell]');
            if (b) onBellPanelAction(b.dataset.bell, true);
        });
        $('theme-seg').addEventListener('click', (e) => {
            const b = e.target.closest('[data-theme-choice]');
            if (b) setTheme(b.dataset.themeChoice);
        });
        const si = $('search-input');
        si.addEventListener('input', () => {
            state.search.q = si.value;
            $('search-field').classList.toggle('has-value', !!si.value);
            clearTimeout(state.search.timer);
            state.search.timer = setTimeout(renderSearch, 120);
        });
        si.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(state.search.timer); renderSearch(); si.blur(); } });
        $('search-clear').addEventListener('click', () => { si.value = ''; state.search.q = ''; renderSearch(); si.focus(); });
        if (darkQuery) {
            const onScheme = () => { if (state.theme === 'auto') applyTheme(); };
            if (darkQuery.addEventListener) darkQuery.addEventListener('change', onScheme);
            else if (darkQuery.addListener) darkQuery.addListener(onScheme);
        }

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!$('lightbox').classList.contains('hidden')) closeLightbox(false);
            else if (state.menuFor) closeActions();
            else if (!$('confirm-modal').classList.contains('hidden')) { hide($('confirm-modal')); state.confirmId = null; }
            else if (!$('bell-panel').classList.contains('hidden')) toggleBellPanel(false);
            else if (state.sheetOpen) {
                if (document.activeElement === si && si.value) { si.value = ''; state.search.q = ''; renderSearch(); }
                else closeSheet(false);
            } else if (!$('emoji-popup').classList.contains('hidden')) closeEmoji();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                state.hiddenUnseen = 0;
                updateTitle();
                if (!state.polling) poll();
                maybeSendRead();
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

    // Finds the chats this person is in, shows the switcher, and limits @mentions to this chat's members.
    async function loadRooms() {
        try {
            const data = await api(`${API}?rooms=1`);
            state.rooms = Array.isArray(data.rooms) ? data.rooms : [];
        } catch (e) { return; }
        const mine = state.rooms.find((r) => r.id === ROOM);
        if (!mine) {
            const first = state.rooms.find((r) => r.id === 'everyone') || state.rooms[0];
            if (first && first.id !== ROOM) { try { localStorage.setItem(ROOM_KEY, first.id); } catch (e) { /* ignore */ } location.replace(`/group/?room=${first.id}`); }
            return;
        }
        try { localStorage.setItem(ROOM_KEY, ROOM); } catch (e) { /* ignore */ }
        if (Array.isArray(mine.members) && mine.members.length) state.people = mine.members;
        renderHeader();
        renderRoomBar();
    }

    function renderRoomBar() {
        const bar = $('room-bar');
        if (!bar) return;
        if (state.rooms.length < 2) { bar.classList.add('hidden'); return; }
        bar.classList.remove('hidden');
        bar.innerHTML = '<div class="wrap room-row">' + state.rooms.map((r) =>
            `<a class="room-chip${r.id === ROOM ? ' on' : ''}" href="/group/?room=${encodeURIComponent(r.id)}" data-room="${escapeHtml(r.id)}" title="${escapeHtml(r.blurb)}"${r.id === ROOM ? ' aria-current="page"' : ''}>${escapeHtml(r.name)}</a>`
        ).join('') + '</div>';
        bar.querySelectorAll('a[data-room]').forEach((a) => a.addEventListener('click', () => {
            try { localStorage.setItem(ROOM_KEY, a.dataset.room); } catch (e) { /* ignore */ }
        }));
    }

    function start() {
        if (state.started) return;
        state.user = getUser();
        if (!state.user || !state.user.key) { handleUnauthorized(); return; }
        state.started = true;
        state.people = loadPeople();
        state.rooms = [];
        loadRooms();
        state.theme = readTheme();
        applyTheme();
        renderHeader();
        renderBell();
        bindEvents();
        autosize();
        updateSendButton();
        refreshBell();
        // /pwa.js is deferred: check again shortly in case it arrives without an event.
        [600, 2000, 5000].forEach((ms) => setTimeout(() => { if (!pwa() || state.push === 'loading') refreshBell(); }, ms));
        // Keep "last seen" labels fresh while the sheet is open.
        setInterval(() => { if (state.sheetOpen) renderSheetMembers(); }, 30000);
        scheduleMidnightRefresh();
        poll();
        window.dispatchEvent(new Event('chowaniec-group-started'));
    }

    function clearComposer() {
        const ta = $('composer-input');
        ta.value = '';
        state.caret = { start: 0, end: 0 };
        state.image = null;
        state.replyTo = null;
        state.typingSentAt = 0;
        closeMention();
        closeEmoji();
        autosize();
        updateSendButton();
        renderAttachments();
    }

    // What group/extras.js (polls, voice messages, scheduled messages) is allowed to use.
    window.ChowaniecGroup = {
        API, state, api, toast, icons, render, upsert, findMessage, setReply, clearComposer, closeActions, closeEmoji,
        escapeHtml, sameName, myName, isMine, mediaUrl, show, hide, ts,
        clickSuppressed: () => suppressClick
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
