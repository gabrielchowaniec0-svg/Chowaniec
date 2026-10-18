// Chowaniec Group polish: little things that make the chat feel native.
//   hold-and-slide menus (send button, profile pictures), link long-press menu, saved (starred) messages,
//   mute a chat, drafts, photo viewer (pinch / swipe), voice "heard" ticks.
// Loaded after group.js and extras.js; talks to them through window.ChowaniecGroup.
(function () {
    'use strict';

    const G = window.ChowaniecGroup;
    if (!G) return;
    const $ = (id) => document.getElementById(id);
    const esc = G.escapeHtml;
    const API = G.API;
    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
    };
    const hap = (k) => { if (G.hap) G.hap(k); };

    // ------------------------------------------------------------ small pop-up menu (with slide-to-select)
    let pop = null;
    function closePop() {
        if (!pop) return;
        pop.el.remove();
        document.removeEventListener('pointerdown', pop.outside, true);
        document.removeEventListener('keydown', pop.key, true);
        pop = null;
    }

    // items: [{ label, icon?, run, danger? }]. When `slideFrom` is given (a finger is still down), the
    // person can slide onto an item and let go to choose it; otherwise it is a normal tap menu.
    function popMenu(items, x, y, slideFrom) {
        closePop();
        const el = document.createElement('div');
        el.className = 'gp-pop';
        el.setAttribute('role', 'menu');
        el.innerHTML = items.map((it, i) => `<button type="button" role="menuitem" class="gp-item${it.danger ? ' danger' : ''}" data-i="${i}">${it.icon ? `<i data-lucide="${it.icon}"></i>` : ''}<span>${esc(it.label)}</span></button>`).join('');
        document.body.appendChild(el);
        G.icons(el);
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const left = Math.max(10, Math.min(x - w / 2, window.innerWidth - w - 10));
        let top = y - h - 14;
        if (top < 10) top = Math.min(y + 18, window.innerHeight - h - 10);
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        requestAnimationFrame(() => el.classList.add('show'));

        const choose = (i) => { closePop(); hap('medium'); const it = items[i]; if (it && it.run) it.run(); };
        el.addEventListener('click', (e) => {
            const b = e.target.closest('.gp-item');
            if (b) { e.preventDefault(); choose(Number(b.dataset.i)); }
        });
        const outside = (e) => { if (!el.contains(e.target)) closePop(); };
        const key = (e) => { if (e.key === 'Escape') closePop(); };
        pop = { el, outside, key };
        // Listen for outside taps a moment later, so the press that opened the menu doesn't close it.
        setTimeout(() => { if (pop && pop.el === el) { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true); } }, 60);

        if (slideFrom) {
            let hot = null;
            let moved = false;
            const start = { x: slideFrom.x, y: slideFrom.y };
            const over = (px, py) => {
                const t = document.elementFromPoint(px, py);
                return t && t.closest ? t.closest('.gp-item') : null;
            };
            const move = (e) => {
                if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 12) return;
                moved = true;
                const b = over(e.clientX, e.clientY);
                if (b !== hot) {
                    if (hot) hot.classList.remove('hot');
                    hot = b;
                    if (b) { b.classList.add('hot'); hap('light'); }
                }
            };
            const noScroll = (e) => { if (e.cancelable) e.preventDefault(); };
            const done = (e) => {
                document.removeEventListener('pointermove', move, true);
                document.removeEventListener('pointerup', done, true);
                document.removeEventListener('pointercancel', done, true);
                document.removeEventListener('touchmove', noScroll, { capture: true });
                if (hot) hot.classList.remove('hot');
                if (e.type === 'pointerup' && moved && pop && pop.el === el) {
                    const b = over(e.clientX, e.clientY);
                    if (b) { e.preventDefault(); choose(Number(b.dataset.i)); }
                }
            };
            document.addEventListener('pointermove', move, true);
            document.addEventListener('pointerup', done, true);
            document.addEventListener('pointercancel', done, true);
            document.addEventListener('touchmove', noScroll, { passive: false, capture: true });
        }
        return el;
    }

    // ------------------------------------------------------------ send button: hold and slide
    function sendMenu(x, y, openSchedule) {
        const u = G.state.user || {};
        const items = [{ label: 'Send later…', icon: 'clock', run: openSchedule }];
        if (u.host) {
            items.unshift({
                label: 'Send as @important', icon: 'siren',
                run: () => {
                    const ta = $('composer-input');
                    if (!ta.value.trim()) { G.toast('Write a message first.'); return; }
                    if (!/@important\b/i.test(ta.value)) ta.value = '@important ' + ta.value;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    $('composer').requestSubmit();
                }
            });
        }
        const btn = $('btn-send').getBoundingClientRect();
        popMenu(items, btn.left + btn.width / 2 - 40, btn.top, { x, y });
    }

    // ------------------------------------------------------------ profile pictures: tap or hold and slide
    function profileMenu(name, x, y, slideFrom) {
        if (G.isAiName(name) || G.sameName(name, G.myName())) return;
        const items = [];
        if (!G.state.dm) items.push({ label: 'Message ' + name, icon: 'message-circle', run: () => { location.href = '/group/?room=' + G.dmRoomFor(G.myName(), name); } });
        items.push({ label: 'View in chat info', icon: 'user-round', run: () => G.openSheet(false) });
        popMenu(items, x, y - 6, slideFrom);
    }

    function bindAvatars() {
        const sc = $('scroller');
        let timer = null;
        let held = false;
        sc.addEventListener('pointerdown', (e) => {
            const av = e.target.closest && e.target.closest('.msg-row .av-slot .av');
            if (!av || (e.pointerType === 'mouse' && e.button !== 0)) return;
            const row = av.closest('.msg-row');
            const m = row && G.findMessage(row.dataset.id);
            if (!m || m.kind === 'ai') return;
            held = false;
            clearTimeout(timer);
            const x = e.clientX; const y = e.clientY;
            timer = setTimeout(() => {
                held = true;
                hap('medium');
                profileMenu(m.user, x, y, e.pointerType === 'mouse' ? null : { x, y });
            }, 300);
        });
        const cancel = () => clearTimeout(timer);
        ['pointerup', 'pointercancel', 'pointermove'].forEach((ev) => sc.addEventListener(ev, (e) => {
            if (ev === 'pointermove' && Math.hypot(e.movementX || 0, e.movementY || 0) < 3) return;
            if (ev === 'pointermove' && held) return;
            cancel();
        }));
        sc.addEventListener('click', (e) => {
            const av = e.target.closest && e.target.closest('.msg-row .av-slot .av');
            if (!av) return;
            if (held) { held = false; e.preventDefault(); e.stopPropagation(); return; }
            const row = av.closest('.msg-row');
            const m = row && G.findMessage(row.dataset.id);
            if (m && m.kind !== 'ai') profileMenu(m.user, e.clientX, e.clientY, null);
        }, true);
    }

    // ------------------------------------------------------------ links: long-press menu
    function linkMenu(a, x, y) {
        const href = a.href;
        const items = [
            { label: 'Open link', icon: 'external-link', run: () => { window.open(href, '_blank', 'noopener'); } },
            { label: 'Copy link', icon: 'copy', run: async () => { try { await navigator.clipboard.writeText(href); G.toast('Link copied'); } catch (e) { G.toast('Could not copy', 'error'); } } }
        ];
        if (navigator.share) items.push({ label: 'Share…', icon: 'share', run: () => { navigator.share({ url: href }).catch(() => {}); } });
        popMenu(items, x, y, { x, y });
    }

    // ------------------------------------------------------------ saved (starred) messages
    const stars = { ids: new Set(), loaded: false, list: [] };
    async function loadStars() {
        try {
            const data = await G.api(`${API}?stars=1`);
            stars.list = Array.isArray(data.stars) ? data.stars : [];
            stars.ids = new Set(stars.list.map((m) => String(m.id)));
            stars.loaded = true;
        } catch (e) { /* the list is simply empty until the next try */ }
    }
    async function toggleStar(id) {
        const had = stars.ids.has(String(id));
        if (had) stars.ids.delete(String(id)); else stars.ids.add(String(id));
        try {
            const data = await G.api(API, { method: 'POST', body: { action: 'star', id } });
            if (data.starred) { G.toast('Saved. Find it under + › Saved messages.'); hap('success'); } else G.toast('Removed from saved');
            loadStars();
        } catch (e) {
            if (had) stars.ids.add(String(id)); else stars.ids.delete(String(id));
            if (e.status !== 401) G.toast(e.message, 'error');
        }
    }
    function whenLabel(iso) {
        const d = new Date(iso);
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    function roomName(room) {
        const r = (G.state.rooms || []).find((x) => x.id === room);
        return r ? r.name : (room.startsWith('dm-') ? 'Direct message' : 'Chat');
    }
    function buildModal(id, title) {
        let el = $(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.className = 'modal sheet-modal hidden';
            el.style.zIndex = '70';
            el.innerHTML = `<div class="modal-card form-card sheet-card fade-in" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="gp-modal-body"></div></div>`;
            document.body.appendChild(el);
            el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-gp="close"]')) G.hide(el); });
            el.addEventListener('keydown', (e) => { if (e.key === 'Escape') G.hide(el); });
        }
        return el;
    }
    async function openSaved() {
        const el = buildModal('saved-modal', 'Saved messages');
        const body = el.querySelector('.gp-modal-body');
        body.innerHTML = '<h3>Saved messages</h3><p class="gp-empty">Loading…</p>';
        G.show(el);
        await loadStars();
        const rows = stars.list.map((m) => `<button type="button" class="gp-saved" data-gp="open" data-room="${esc(m.room)}" data-id="${esc(m.id)}"><span class="gp-saved-top"><b>${esc(m.user)}</b><span>${esc(roomName(m.room))} · ${esc(whenLabel(m.createdAt))}</span></span><span class="gp-saved-text">${esc(m.text ? m.text.slice(0, 200) : (m.image ? 'Photo' : (m.voice ? 'Voice message' : 'Message')))}</span></button>`).join('');
        body.innerHTML = `<h3>Saved messages</h3>${rows ? `<div class="gp-saved-list">${rows}</div>` : '<p class="gp-empty">Nothing saved yet. Press and hold a message, then choose Star.</p>'}<div class="modal-actions"><button type="button" class="btn btn-solid" data-gp="close">Done</button></div>`;
        body.querySelectorAll('[data-gp="open"]').forEach((b) => b.addEventListener('click', () => {
            G.hide(el);
            if (b.dataset.room === G.room()) G.revealMessage(b.dataset.id);
            else location.href = '/group/?room=' + encodeURIComponent(b.dataset.room);
        }));
    }

    // ------------------------------------------------------------ mute a chat
    const muting = { until: null };
    function muteLabel(iso) {
        const d = new Date(iso);
        const sameDay = d.toDateString() === new Date().toDateString();
        return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    function renderMute() {
        document.body.dataset.muted = muting.until ? '1' : '';
        const el = $('sheet-mute');
        if (!el) return;
        const opts = [['1h', '1 hour'], ['8h', '8 hours'], ['week', '1 week']];
        el.innerHTML = muting.until
            ? `<div class="gp-mute-row"><span><b>Muted</b> until ${esc(muteLabel(muting.until))}. @important pings still come through.</span><button type="button" class="btn btn-ghost" data-mute="off">Unmute</button></div>`
            : `<div class="gp-mute-title">Mute this chat</div><div class="gp-mute-opts">${opts.map(([v, l]) => `<button type="button" class="btn btn-ghost" data-mute="${v}">${l}</button>`).join('')}</div>`;
    }
    async function loadMute() {
        try {
            const data = await G.api(`${API}?mutes=1`);
            muting.until = (data.mutes || {})[G.room()] || null;
            renderMute();
        } catch (e) { /* leave as is */ }
    }
    async function setMute(duration) {
        try {
            const data = await G.api(API, { method: 'POST', body: { action: 'mute', room: G.room(), duration } });
            muting.until = (data.mutes || {})[G.room()] || null;
            renderMute();
            G.toast(muting.until ? 'Chat muted' : 'Chat unmuted');
        } catch (e) { if (e.status !== 401) G.toast(e.message, 'error'); }
    }

    // ------------------------------------------------------------ drafts (one per chat)
    const draftKey = () => `chowaniec_draft_${G.room()}`;
    function bindDrafts() {
        const ta = $('composer-input');
        const saved = store.get(draftKey());
        if (saved && !ta.value) { ta.value = saved; ta.dispatchEvent(new Event('input', { bubbles: true })); }
        let t = null;
        const save = () => { clearTimeout(t); t = setTimeout(() => { if (ta.value.trim()) store.set(draftKey(), ta.value); else store.del(draftKey()); }, 250); };
        ta.addEventListener('input', save);
        $('composer').addEventListener('submit', () => setTimeout(save, 0));
        window.addEventListener('pagehide', () => { if (ta.value.trim()) store.set(draftKey(), ta.value); else store.del(draftKey()); });
    }

    // ------------------------------------------------------------ photo viewer
    const photo = { list: [], i: 0, s: 1, x: 0, y: 0 };
    function photosInChat() {
        return Array.from(document.querySelectorAll('#messages [data-act="lightbox"]')).map((b) => ({ src: b.dataset.src, caption: b.dataset.caption || '' }));
    }
    function paintPhoto(animate) {
        const img = $('lightbox-img');
        img.style.transition = animate ? 'transform .22s ease, opacity .22s ease' : 'none';
        img.style.transform = `translate(${photo.x}px, ${photo.y}px) scale(${photo.s})`;
    }
    function resetPhoto() { photo.s = 1; photo.x = 0; photo.y = 0; const img = $('lightbox-img'); img.style.opacity = ''; $('lightbox').style.background = ''; paintPhoto(false); }
    function showPhotoAt(i) {
        const p = photo.list[i];
        if (!p) return;
        photo.i = i;
        const img = $('lightbox-img');
        img.src = p.src;
        const open = $('lightbox-open');
        if (/^data:/.test(p.src)) open.classList.add('hidden'); else { open.classList.remove('hidden'); open.href = p.src; }
        $('lightbox-caption').textContent = (photo.list.length > 1 ? `${i + 1} / ${photo.list.length} · ` : '') + p.caption;
        resetPhoto();
    }
    function photoOpened(src) {
        photo.list = photosInChat();
        const i = photo.list.findIndex((p) => p.src === src);
        if (i >= 0) { photo.i = i; $('lightbox-caption').textContent = (photo.list.length > 1 ? `${i + 1} / ${photo.list.length} · ` : '') + photo.list[i].caption; }
        resetPhoto();
    }
    function bindPhotoViewer() {
        const lb = $('lightbox');
        const img = $('lightbox-img');
        lb.style.touchAction = 'none';
        const pts = new Map();
        let g = null;
        let lastTap = 0;
        const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
        const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const close = () => { const b = $('lightbox-close'); if (b) b.click(); };
        lb.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.lb-btn')) return;
            try { lb.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or finished pointer */ }
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size === 2) g = { kind: 'pinch', d0: dist(), s0: photo.s, m0: mid(), x0: photo.x, y0: photo.y };
            else if (pts.size === 1) g = { kind: 'one', x0: e.clientX, y0: e.clientY, px: photo.x, py: photo.y, t0: Date.now(), moved: false };
        });
        lb.addEventListener('pointermove', (e) => {
            if (!pts.has(e.pointerId) || !g) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (g.kind === 'pinch' && pts.size >= 2) {
                photo.s = clamp(g.s0 * (dist() / g.d0), 1, 6);
                const m = mid();
                photo.x = g.x0 + (m.x - g.m0.x);
                photo.y = g.y0 + (m.y - g.m0.y);
                paintPhoto(false);
            } else if (g.kind === 'one') {
                const dx = e.clientX - g.x0;
                const dy = e.clientY - g.y0;
                if (Math.hypot(dx, dy) > 6) g.moved = true;
                if (photo.s > 1.02) {
                    photo.x = g.px + dx; photo.y = g.py + dy; paintPhoto(false);
                } else if (g.moved) {
                    if (!g.axis) g.axis = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
                    if (g.axis === 'v') {
                        photo.y = dy; photo.x = 0;
                        lb.style.background = `rgba(0,0,0,${Math.max(0.2, 0.95 - Math.abs(dy) / 500)})`;
                    } else { photo.x = dx; photo.y = 0; }
                    paintPhoto(false);
                }
            }
        });
        const end = (e) => {
            if (!pts.has(e.pointerId)) return;
            pts.delete(e.pointerId);
            if (!g) return;
            if (g.kind === 'pinch') {
                if (photo.s < 1.05) { photo.s = 1; photo.x = 0; photo.y = 0; }
                paintPhoto(true);
                g = pts.size === 1 ? { kind: 'one', x0: [...pts.values()][0].x, y0: [...pts.values()][0].y, px: photo.x, py: photo.y, t0: Date.now(), moved: true } : null;
                return;
            }
            const cur = g;
            g = null;
            const dx = e.clientX - cur.x0;
            const dy = e.clientY - cur.y0;
            if (!cur.moved) {
                // a tap: double-tap zooms, tapping the dark area closes
                const now = Date.now();
                if (now - lastTap < 320) {
                    lastTap = 0;
                    photo.s = photo.s > 1.2 ? 1 : 2.5; photo.x = 0; photo.y = 0; paintPhoto(true);
                } else {
                    lastTap = now;
                    if (e.target === lb) close();
                }
                return;
            }
            if (photo.s > 1.02) { paintPhoto(true); return; }
            if (cur.axis === 'v' && Math.abs(dy) > 110) { close(); return; }
            if (cur.axis === 'h' && Math.abs(dx) > 70 && photo.list.length > 1) {
                const next = dx < 0 ? photo.i + 1 : photo.i - 1;
                if (next >= 0 && next < photo.list.length) {
                    hap('light');
                    img.style.transition = 'transform .12s ease, opacity .12s ease';
                    img.style.opacity = '0';
                    setTimeout(() => { showPhotoAt(next); img.style.transition = 'opacity .18s ease'; img.style.opacity = '1'; }, 110);
                    return;
                }
            }
            lb.style.background = '';
            photo.x = 0; photo.y = 0; paintPhoto(true);
        };
        lb.addEventListener('pointerup', end);
        lb.addEventListener('pointercancel', end);
        lb.addEventListener('wheel', (e) => {
            e.preventDefault();
            photo.s = clamp(photo.s * (e.deltaY < 0 ? 1.15 : 0.87), 1, 6);
            if (photo.s === 1) { photo.x = 0; photo.y = 0; }
            paintPhoto(false);
        }, { passive: false });
        document.addEventListener('keydown', (e) => {
            if (lb.classList.contains('hidden') || !photo.list.length) return;
            if (e.key === 'ArrowRight' && photo.i < photo.list.length - 1) showPhotoAt(photo.i + 1);
            if (e.key === 'ArrowLeft' && photo.i > 0) showPhotoAt(photo.i - 1);
        });
        new MutationObserver(() => { if (lb.classList.contains('hidden')) { pts.clear(); g = null; resetPhoto(); } }).observe(lb, { attributes: true, attributeFilter: ['class'] });
    }

    // ------------------------------------------------------------ voice messages: heard ticks
    const heardKey = 'chowaniec_heard_voice';
    let heard = new Set();
    try { heard = new Set(JSON.parse(store.get(heardKey) || '[]')); } catch (e) { heard = new Set(); }
    function rememberHeard(id) {
        heard.add(id);
        store.set(heardKey, JSON.stringify([...heard].slice(-300)));
    }
    function decorateVoices() {
        document.querySelectorAll('#messages .voice[data-mid]').forEach((v) => {
            const id = v.dataset.mid;
            const m = G.findMessage(id);
            if (!m) return;
            const mine = G.isMine(m);
            const play = v.querySelector('.v-play');
            if (play) play.classList.toggle('unheard', !mine && !heard.has(id) && !(m.listenedBy || []).some((n) => G.sameName(n, G.myName())));
            const row = v.querySelector('.v-row');
            let tag = v.querySelector('.v-heard');
            const names = (m.listenedBy || []).filter((n) => !G.sameName(n, m.user));
            if (mine && names.length && row) {
                const text = '✓✓ Heard by ' + (names.length > 2 ? names.length + ' people' : names.join(' & '));
                if (!tag) { tag = document.createElement('span'); tag.className = 'v-heard'; row.appendChild(tag); }
                if (tag.textContent !== text) tag.textContent = text;
            } else if (tag) tag.remove();
        });
    }
    function bindVoice() {
        let raf = 0;
        const run = () => { raf = 0; decorateVoices(); };
        new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(run); }).observe($('messages'), { childList: true, subtree: true });
        document.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-x="voice-play"]');
            if (!b) return;
            const id = b.dataset.mid;
            const m = G.findMessage(id);
            if (!m || G.isMine(m) || heard.has(id)) return;
            rememberHeard(id);
            decorateVoices();
            G.api(API, { method: 'POST', body: { action: 'listened', id } }).catch(() => {});
        }, true);
        decorateVoices();
    }

    // ------------------------------------------------------------ wiring
    function init() {
        bindAvatars();
        bindDrafts();
        bindPhotoViewer();
        bindVoice();
        const savedBtn = $('btn-saved');
        if (savedBtn) savedBtn.addEventListener('click', () => { G.hide($('plus-popup'), 'block'); openSaved(); });
        const mute = $('sheet-mute');
        if (mute) mute.addEventListener('click', (e) => { const b = e.target.closest('[data-mute]'); if (b) setMute(b.dataset.mute); });
        renderMute();
        loadStars();
        loadMute();
    }

    window.GroupPolish = { popMenu, sendMenu, linkMenu, profileMenu, isStarred: (id) => stars.ids.has(String(id)), toggleStar, photoOpened, openSaved };
    if (G.state.started) init(); else window.addEventListener('chowaniec-group-started', init, { once: true });
})();
