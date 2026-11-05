// Chowaniec Group: live location sharing. "Share live location" in the + menu posts a live card (a message with
// m.location = { shareId }) that shows everyone sharing in this chat on one map (Leaflet + OpenStreetMap), with
// "updated … ago", time left, distance from you and "Open in Maps". The sharer's page sends its position to
// /.netlify/functions/location while Chowaniec is open (at most every 15 s, and only after moving 20 m, plus a
// heartbeat every minute). When sharing ends the card shows only an approximate last spot.
// A message with m.location.home is the "I'm home safe" card. Loaded after extras.js/gamecards.js; wraps their hooks.
(function () {
    'use strict';

    const G = window.ChowaniecGroup;
    const X = window.GroupExtras;
    if (!G || !X) return;
    const esc = G.escapeHtml;
    const API = '/.netlify/functions/location';
    const POLL_MS = 10000;
    const SEND_MIN_MS = 15000;      // never send more often than this
    const MOVE_M = 20;              // ... and only after moving this far
    const HEARTBEAT_MS = 60000;     // ... or once a minute so the others know it is still live
    const PAUSED_MS = 120000;       // same as the server: no update for 2 minutes -> paused
    const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    const SRI_JS = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    const SRI_CSS = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
    const DIST_KEY = 'chowaniec_loc_distance';
    const geo = navigator.geolocation;

    const live = { shares: {}, loaded: false, off: 0, busy: false, timer: null, lastFetch: 0 };
    const me = { share: null, watchId: null, hb: null, fix: null, lastSent: null, sending: false, blockedUntil: 0, wake: null, wantWake: false, resumeTried: false };
    const dist = { watchId: null, fix: null, asked: false };
    const maps = new Map();     // message id -> { mode, el, map, layers: Map(shareId -> { marker, circle }), me, touched, fitKey }

    const nowS = () => Date.now() + live.off;          // the server's clock
    const ms = (s) => (s ? Date.parse(s) : 0);
    const mine = (name) => G.sameName(name, G.myName());
    const icon = (name, cls) => `<i data-lucide="${name}"${cls ? ` class="${cls}"` : ''}></i>`;
    const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };

    // ---------------------------------------------------------------- helpers

    function meters(a, b) {
        const R = 6371000;
        const rad = (d) => (d * Math.PI) / 180;
        const dLat = rad(b.lat - a.lat);
        const dLng = rad(b.lng - a.lng);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    function distLabel(m) {
        if (m < 50) return 'Right by you';
        if (m < 1000) return `${Math.round(m / 10) * 10} m away`;
        if (m < 10000) return `${(m / 1000).toFixed(1)} km away`;
        return `${Math.round(m / 1000).toLocaleString('en-US')} km away`;
    }
    function agoLabel(t) {
        const s = Math.max(0, Math.round((nowS() - t) / 1000));
        if (s < 10) return 'Updated just now';
        if (s < 60) return `Updated ${s} s ago`;
        const m = Math.round(s / 60);
        if (m < 60) return `Updated ${m} min ago`;
        return `Updated ${Math.floor(m / 60)} h ${m % 60} min ago`;
    }
    function leftLabel(until) {
        const m = Math.max(0, Math.ceil((ms(until) - nowS()) / 60000));
        if (m < 1) return 'Ending';
        if (m < 60) return `${m} min left`;
        const h = Math.floor(m / 60);
        return m % 60 ? `${h} h ${m % 60} min left` : `${h} h left`;
    }
    const clock = (s) => new Date(ms(s)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const durLabel = (n) => (n < 60 ? `${n} minutes` : n === 60 ? '1 hour' : `${n / 60} hours`);

    function isApple() { return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints > 0 || /iPhone|iPad|iPod/.test(navigator.userAgent)); }
    function mapsHref(pos, name) {
        const ll = `${pos.lat},${pos.lng}`;
        if (isApple()) return `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(name || 'Shared location')}`;
        if (/Android/i.test(navigator.userAgent)) return `geo:${ll}?q=${ll}(${encodeURIComponent(name || 'Shared location')})`;
        return `https://www.google.com/maps/search/?api=1&query=${ll}`;
    }

    // Where a share is drawn: the sharer's own page uses its freshest fix.
    function posOf(s) {
        if (s && s.active && me.share === s.id && me.fix) return { lat: me.fix.lat, lng: me.fix.lng, acc: me.fix.acc, at: me.fix.t + live.off };
        return s && s.pos ? { ...s.pos, at: ms(s.pos.at) } : null;
    }
    const seenOf = (s) => (me.share === s.id && me.lastSent ? me.lastSent.t + live.off : ms(s.seenAt) || ms(s.startedAt));
    const isPaused = (s) => !!s && s.active && !(me.share === s.id && me.fix && document.visibilityState === 'visible') && nowS() - seenOf(s) > PAUSED_MS;
    const myFix = () => me.fix || dist.fix;
    const roomShares = () => Object.values(live.shares).filter((s) => s.room === G.room());
    const activeShares = () => roomShares().filter((s) => s.active && ms(s.until) > nowS()).sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    const myActive = () => activeShares().find((s) => mine(s.user)) || null;

    // ---------------------------------------------------------------- server

    async function call(body) {
        const data = await G.api(API, { method: 'POST', body: { room: G.room(), ...body } });
        if (data.now) live.off = Date.parse(data.now) - Date.now();
        if (data.share) live.shares[data.share.id] = data.share;
        (data.stopped || []).forEach((s) => { live.shares[s.id] = s; });
        return data;
    }

    function cardMessages() { return G.state.messages.filter((m) => m && m.location && m.location.shareId && !m.location.home); }
    function needsPoll() {
        if (me.share) return true;
        return cardMessages().some((m) => { const s = live.shares[m.location.shareId]; return !s || (s.active && !s.gone); }) || !live.loaded;
    }

    async function refresh(force) {
        if (live.busy || (!force && document.visibilityState === 'hidden')) return;
        if (!force && !needsPoll()) return;
        live.busy = true;
        let changed = false;
        try {
            const before = sigAll();
            const data = await G.api(`${API}?room=${encodeURIComponent(G.room())}`);
            if (data.now) live.off = Date.parse(data.now) - Date.now();
            const seen = new Set();
            (data.shares || []).forEach((s) => { live.shares[s.id] = s; seen.add(s.id); });
            // Cards whose share was deleted (7 days after it ended), or never loaded.
            cardMessages().forEach((m) => { const id = m.location.shareId; if (!seen.has(id) && !(live.shares[id] && live.shares[id].room !== G.room())) live.shares[id] = { id, gone: true, active: false, room: G.room(), user: m.user }; });
            // A card message read in the moment between it being posted and marked: mark it here.
            const patch = [];
            (data.shares || []).forEach((s) => {
                const m = s.msg && G.state.byId && G.state.byId.get(s.msg);
                if (m && !m.location) patch.push({ ...m, location: { shareId: s.id, ...(s.active ? {} : { ended: true }) } });
            });
            if (patch.length) G.upsert(patch);
            live.loaded = true;
            live.lastFetch = Date.now();
            changed = before !== sigAll() || patch.length > 0;
            resumeIfSharing();
            const mineNow = myActive();
            if (me.share && (!mineNow || mineNow.id !== me.share)) stopWatch();
        } catch (e) { /* try again next time */ }
        live.busy = false;
        if (changed) G.render('auto');
        updateAll();
    }
    function schedule() {
        clearTimeout(live.timer);
        live.timer = setTimeout(() => { refresh(false).finally(schedule); }, POLL_MS);
    }
    const sigAll = () => JSON.stringify(roomShares().map((s) => [s.id, s.active, s.endedAt, s.until, s.reason, s.gone, isPaused(s)]));

    // ---------------------------------------------------------------- sharing (the sharer's page)

    function getFix(timeout) {
        return new Promise((resolve, reject) => {
            if (!geo) { reject(Object.assign(new Error('This browser can’t share location.'), { code: 0 })); return; }
            geo.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: timeout || 15000, maximumAge: 10000 });
        });
    }
    const fixOf = (p) => ({
        lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0),
        heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
        speed: Number.isFinite(p.coords.speed) ? p.coords.speed : null, t: Date.now()
    });
    function geoError(e) {
        if (e && e.code === 1) return isApple()
            ? 'Location is blocked. On iPhone: Settings, Privacy & Security, Location Services, then allow it for Safari Websites (or Chowaniec).'
            : 'Location is blocked for Chowaniec. Allow it in your browser’s site settings and try again.';
        if (e && e.code === 3) return 'Couldn’t find your location in time. Try again outside or near a window.';
        return (e && e.message) || 'Couldn’t get your location.';
    }

    function startWatch(shareId, firstFix) {
        me.share = shareId;
        if (firstFix) { me.fix = firstFix; me.lastSent = { lat: firstFix.lat, lng: firstFix.lng, t: Date.now() }; }
        if (geo && me.watchId == null) {
            me.watchId = geo.watchPosition((p) => { me.fix = fixOf(p); maybeSend(); updateAll(); }, (e) => {
                if (e.code === 1) { G.toast(geoError(e), 'error'); stopWatch(); G.render('auto'); }
            }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
        }
        clearInterval(me.hb);
        me.hb = setInterval(maybeSend, 5000);
        if (me.wantWake) wakeOn();
    }
    function stopWatch() {
        if (me.watchId != null && geo) geo.clearWatch(me.watchId);
        me.watchId = null;
        clearInterval(me.hb);
        me.hb = null;
        me.share = null;
        me.lastSent = null;
        wakeOff();
    }

    async function maybeSend() {
        if (!me.share || !me.fix || me.sending) return;
        const now = Date.now();
        if (now < me.blockedUntil) return;
        const last = me.lastSent;
        if (last && now - last.t < SEND_MIN_MS) return;
        const moved = !last || meters(last, me.fix) > MOVE_M;
        if (!moved && now - last.t < HEARTBEAT_MS) return;
        me.sending = true;
        const f = me.fix;
        try {
            await call({ action: 'update', id: me.share, lat: f.lat, lng: f.lng, acc: f.acc, heading: f.heading, speed: f.speed });
            me.lastSent = { lat: f.lat, lng: f.lng, t: Date.now() };
        } catch (e) {
            if (e.status === 429) me.blockedUntil = Date.now() + 10000;
            else if (e.status === 404 || e.status === 409 || e.status === 403) { stopWatch(); refresh(true); }
            else me.blockedUntil = Date.now() + 15000;
        }
        me.sending = false;
        updateAll();
    }

    // Back on the chat while a share of mine is still live: carry on sending (only if location is already allowed;
    // otherwise the card offers "Resume on this device").
    async function resumeIfSharing() {
        const s = myActive();
        if (!s || me.share || me.resumeTried) return;
        me.resumeTried = true;
        let granted = false;
        try { granted = navigator.permissions && (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch (e) { granted = false; }
        if (granted && !me.share) { startWatch(s.id); G.render('auto'); }
    }

    async function resume(btn) {
        const s = myActive();
        if (!s) return;
        if (btn) btn.disabled = true;
        try {
            const f = fixOf(await getFix());
            me.fix = f;
            startWatch(s.id);
            me.lastSent = null;
            maybeSend();
            G.render('auto');
        } catch (e) { G.toast(geoError(e), 'error'); if (btn) btn.disabled = false; }
    }

    async function startSharing(minutes, btn) {
        if (btn) btn.disabled = true;
        // A fresh position from this page (the distance check) is good enough to start; the watch refines it.
        const cached = myFix();
        let f = cached && Date.now() - cached.t < 60000 ? cached : null;
        if (!f) {
            try { f = fixOf(await getFix()); } catch (e) { if (btn) btn.disabled = false; G.toast(geoError(e), 'error'); return; }
        }
        try {
            const data = await call({ action: 'start', minutes, lat: f.lat, lng: f.lng, acc: f.acc, heading: f.heading, speed: f.speed });
            closeModal();
            if (data.message) G.upsert([data.message]);
            startWatch(data.share.id, f);
            G.render('bottom');
            G.toast(data.existing ? 'You’re already sharing your location here.' : `Sharing your live location for ${durLabel(minutes)}.`);
            if (G.hap) G.hap('light');
        } catch (e) { G.toast(e.message || 'Couldn’t start sharing.', 'error'); }
        if (btn) btn.disabled = false;
    }

    async function stopSharing(id, btn) {
        if (btn) btn.disabled = true;
        try {
            await call({ action: 'stop', id });
            if (me.share === id) stopWatch();
            G.render('auto');
            G.toast('You stopped sharing your location.');
        } catch (e) { G.toast(e.message || 'Couldn’t stop sharing.', 'error'); refresh(true); }
        if (btn) btn.disabled = false;
    }

    async function extend(id, minutes, btn) {
        if (btn) btn.disabled = true;
        try {
            const data = await call({ action: 'extend', id, minutes });
            closeModal();
            G.render('auto');
            updateAll();
            G.toast(`Sharing until ${clock(data.share.until)}.`);
        } catch (e) { G.toast(e.message || 'Couldn’t extend.', 'error'); }
        if (btn) btn.disabled = false;
    }

    async function homeSafe(btn) {
        if (btn) btn.disabled = true;
        try {
            const data = await call({ action: 'home' });
            closeModal();
            stopWatch();
            if (data.message) G.upsert([data.message]);
            G.render('bottom');
            if (G.hap) G.hap('medium');
        } catch (e) { G.toast(e.message || 'Couldn’t send that.', 'error'); }
        if (btn) btn.disabled = false;
    }

    // Keep the screen on while sharing (where the browser allows it).
    async function wakeOn() {
        me.wantWake = true;
        if (!('wakeLock' in navigator) || me.wake || document.visibilityState !== 'visible') return;
        try { me.wake = await navigator.wakeLock.request('screen'); me.wake.addEventListener('release', () => { me.wake = null; updateAll(); }); } catch (e) { me.wake = null; }
        updateAll();
    }
    function wakeOff() { me.wantWake = false; if (me.wake) { me.wake.release().catch(() => {}); me.wake = null; } }

    // Distance from you: your own position, only on this device (never sent).
    async function distanceOn(btn) {
        if (btn) btn.disabled = true;
        try {
            const f = fixOf(await getFix(12000));
            dist.fix = f;
            store.set(DIST_KEY, '1');
            watchDistance();
            G.render('auto');
        } catch (e) { G.toast(geoError(e), 'error'); if (btn) btn.disabled = false; }
    }
    function watchDistance() {
        if (!geo || dist.watchId != null) return;
        dist.watchId = geo.watchPosition((p) => { dist.fix = fixOf(p); updateAll(); }, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 60000 });
    }
    async function distanceIfAllowed() {
        if (dist.asked || store.get(DIST_KEY) !== '1' || !activeShares().some((s) => !mine(s.user))) return;
        dist.asked = true;
        try {
            if (navigator.permissions && (await navigator.permissions.query({ name: 'geolocation' })).state !== 'granted') return;
        } catch (e) { return; }
        watchDistance();
    }

    // ---------------------------------------------------------------- the chooser

    let modal = null;
    function buildModal() {
        const el = document.createElement('div');
        el.id = 'loc-modal';
        el.className = 'modal hidden';
        el.style.zIndex = '70';
        el.innerHTML = '<div class="modal-card form-card lc-modal fade-in" role="dialog" aria-modal="true" aria-labelledby="loc-title"><div id="loc-modal-body"></div></div>';
        document.body.appendChild(el);
        el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
        el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
        return el;
    }
    function closeModal() { if (modal) G.hide(modal); }
    function openModal(mode, id) {
        if (!modal) modal = buildModal();
        const body = modal.querySelector('#loc-modal-body');
        const s = id ? live.shares[id] : myActive();
        const opts = (x) => [15, 60, 480].map((n) => `<button type="button" class="lc-opt" data-x="${x}" data-min="${n}"${id ? ` data-id="${esc(id)}"` : ''}><span class="lc-opt-ic">${icon(n === 15 ? 'timer' : n === 60 ? 'clock' : 'clock-8')}</span><span class="lc-opt-t"><b>${x === 'lc-extend' ? (n === 480 ? 'Up to 8 hours' : `${durLabel(n)} more`) : durLabel(n)}</b><span>${x === 'lc-extend' ? (n === 480 ? 'The longest allowed' : '') : `Until ${new Date(Date.now() + n * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</span></span>${icon('chevron-right', 'lc-opt-go')}</button>`).join('');
        const note = `<div class="lc-hint">${icon('smartphone')}<span>Sharing only works while Chowaniec is open on this phone. Phones and browsers can’t send your location in the background, so keep this screen open.</span></div>`;
        if (mode === 'extend' && s) {
            body.innerHTML = `<div class="modal-ic lc-mic">${icon('timer-reset')}</div><h3 id="loc-title">Share for longer</h3><p class="lc-sub">Now sharing until ${esc(clock(s.until))}. For privacy, sharing never runs more than 8 hours ahead.</p><div class="lc-opts">${opts('lc-extend')}</div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-x="lc-close">Cancel</button></div>`;
        } else if (s && mine(s.user)) {
            body.innerHTML = `<div class="modal-ic lc-mic on">${icon('map-pin')}</div><h3 id="loc-title">You’re sharing your location</h3><p class="lc-sub">Live in this chat until ${esc(clock(s.until))}.</p><div class="lc-opts"><button type="button" class="lc-opt home" data-x="lc-home"><span class="lc-opt-ic">${icon('house')}</span><span class="lc-opt-t"><b>I’m home safe</b><span>Tells the chat and stops sharing</span></span></button><button type="button" class="lc-opt" data-x="lc-extend-open" data-id="${esc(s.id)}"><span class="lc-opt-ic">${icon('timer-reset')}</span><span class="lc-opt-t"><b>Share for longer</b><span>Up to 8 hours</span></span></button><button type="button" class="lc-opt stop" data-x="lc-stop" data-id="${esc(s.id)}"><span class="lc-opt-ic">${icon('circle-stop')}</span><span class="lc-opt-t"><b>Stop sharing</b><span>Your card shows only a rough last spot</span></span></button></div>${note}<div class="modal-actions"><button type="button" class="btn btn-ghost" data-x="lc-close">Close</button></div>`;
        } else {
            body.innerHTML = `<div class="modal-ic lc-mic">${icon('map-pin')}</div><h3 id="loc-title">Share live location</h3><p class="lc-sub">Everyone in this chat sees where you are on a map, live, until the time runs out or you stop.</p><div class="lc-opts">${opts('lc-start')}</div>${note}<div class="lc-or"><span>or</span></div><button type="button" class="lc-opt home" data-x="lc-home"><span class="lc-opt-ic">${icon('house')}</span><span class="lc-opt-t"><b>I’m home safe</b><span>Send a quick check-in</span></span></button><div class="modal-actions"><button type="button" class="btn btn-ghost" data-x="lc-close">Cancel</button></div>`;
        }
        G.icons(body);
        G.show(modal);
        const first = body.querySelector('.lc-opt');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 60);
    }

    // ---------------------------------------------------------------- cards

    function personRow(s, primary) {
        const who = mine(s.user) ? 'You' : s.user;
        return `<div class="lc-row${primary ? ' primary' : ''}" data-lc-row="${esc(s.id)}">${G.avatarHtml(s.user, 'av-md')}<div class="lc-rt"><b>${esc(who)}</b><span class="lc-meta"><span data-lc-ago="${esc(s.id)}"></span><span data-lc-dist="${esc(s.id)}"></span></span></div>${isPaused(s) ? `<span class="lc-chip paused">${icon('pause')}Paused</span>` : `<span class="lc-chip" data-lc-left="${esc(s.id)}"></span>`}</div>`;
    }

    function liveCardHtml(m, s) {
        const own = mine(s.user);
        const others = activeShares().filter((x) => x.id !== s.id);
        const paused = isPaused(s);
        const sending = own && me.share === s.id;
        const title = own ? 'You’re sharing live location' : `${s.user} is sharing live location`;
        const head = `<div class="lc-head"><span class="lc-live${paused ? ' paused' : ''}"><i></i></span><div class="lc-tt"><span class="lc-eyebrow">${paused ? 'Live location · paused' : 'Live location'}</span><b>${esc(title)}</b></div></div>`;
        const map = `<div class="lc-mapwrap" data-x="lc-map" data-loc-map="${esc(m.id)}" data-mode="live"><div class="lc-map-fallback">${icon('map')}<span>Loading map…</span></div>${paused ? `<div class="lc-paused">${icon('pause')}<span>${own ? 'Paused: Chowaniec was closed or hidden' : `Paused: Chowaniec isn’t open on ${esc(s.user)}’s phone`}</span></div>` : ''}<button type="button" class="lc-expand" data-x="lc-expand" data-mid="${esc(m.id)}" title="Bigger map" aria-label="Show a bigger map">${icon('maximize-2')}</button></div>`;
        const rows = `<div class="lc-people">${personRow(s, true)}${others.map((x) => personRow(x, false)).join('')}</div>`;
        const openLink = `<a class="lc-btn ghost" data-lc-open="${esc(s.id)}" href="#" target="_blank" rel="noopener">${icon('navigation')}Open in Maps</a>`;
        let acts;
        let note;
        if (own) {
            acts = `<div class="lc-acts"><button type="button" class="lc-btn home" data-x="lc-home">${icon('house')}I’m home safe</button></div><div class="lc-acts">${!sending ? `<button type="button" class="lc-btn primary" data-x="lc-resume">${icon('locate-fixed')}Resume on this device</button>` : ''}<button type="button" class="lc-btn ghost" data-x="lc-extend-open" data-id="${esc(s.id)}">${icon('timer-reset')}Extend</button><button type="button" class="lc-btn ghost danger" data-x="lc-stop" data-id="${esc(s.id)}">${icon('circle-stop')}Stop sharing</button></div>`;
            note = `<div class="lc-note">${icon('smartphone')}<span>${sending ? 'Keep this screen open. Sharing pauses if you close Chowaniec or lock your phone.' : 'Not sending from this device. Sharing only works while Chowaniec is open.'}</span>${sending && 'wakeLock' in navigator ? `<button type="button" class="lc-wake${me.wake ? ' on' : ''}" data-x="lc-wake" aria-pressed="${!!me.wake}">${icon(me.wake ? 'sun' : 'sun-dim')}<span>${me.wake ? 'Screen stays on' : 'Keep screen on'}</span></button>` : ''}</div>`;
        } else {
            acts = `<div class="lc-acts">${openLink}${myFix() ? '' : `<button type="button" class="lc-btn ghost" data-x="lc-distance">${icon('locate')}How far?</button>`}</div>`;
            note = `<div class="lc-note">${icon('smartphone')}<span>Updates while Chowaniec is open on ${esc(s.user)}’s phone.</span></div>`;
        }
        return `<div class="lc" data-lc="${esc(m.id)}">${head}${map}${rows}<div class="lc-body">${acts}${note}</div></div>`;
    }

    function endedCardHtml(m, s) {
        const own = s && mine(s.user);
        const who = own ? 'You' : (s && s.user) || m.user;
        let sub = 'This location is no longer available.';
        if (s && !s.gone) {
            const at = clock(s.endedAt);
            sub = s.reason === 'home' ? `${who} got home safe · ${at}` : s.reason === 'expired' ? `Time ran out at ${at}` : `${who} stopped sharing at ${at}`;
        }
        const has = s && !s.gone && s.pos;
        const map = has ? `<div class="lc-mapwrap small" data-loc-map="${esc(m.id)}" data-mode="ended"><div class="lc-map-fallback">${icon('map')}<span>Loading map…</span></div></div><div class="lc-cap">${icon('circle-dashed')}<span>Approximate last spot. The exact one isn’t kept.</span></div>` : '';
        return `<div class="lc ended" data-lc="${esc(m.id)}"><div class="lc-head"><span class="lc-endic">${icon('map-pin-off')}</span><div class="lc-tt"><span class="lc-eyebrow">Location</span><b>Shared location ended</b><span class="lc-sub2">${esc(sub)}</span></div></div>${map}${has ? `<div class="lc-body"><div class="lc-acts"><a class="lc-btn ghost" href="${esc(mapsHref(s.pos, s.user))}" target="_blank" rel="noopener">${icon('navigation')}Open in Maps</a></div></div>` : ''}</div>`;
    }

    function homeCardHtml(m) {
        const own = mine(m.user);
        return `<div class="lc-homecard"><span class="lc-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span><div class="lc-ht"><b>Home safe</b><span>${own ? 'You let everyone know you got home.' : `${esc(m.user)} got home safe.`}</span></div>${icon('house', 'lc-house')}</div>`;
    }

    function cardHtml(m) {
        if (!m || !m.location) return '';
        const s = live.shares[m.location.shareId];
        // The message says it ended (or "home safe") but the share still looks live here: fetch now.
        if (s && s.active && (m.location.ended || m.location.home)) want();
        if (m.location.home) return homeCardHtml(m);
        if (!s) {
            if (!live.loaded) want();
            if (m.location.ended) return endedCardHtml(m, null);
            return `<div class="lc" data-lc="${esc(m.id)}"><div class="lc-head"><span class="lc-live"><i></i></span><div class="lc-tt"><span class="lc-eyebrow">Live location</span><b>${esc(mine(m.user) ? 'You’re sharing live location' : `${m.user} is sharing live location`)}</b></div></div><div class="lc-mapwrap"><div class="lc-map-fallback">${icon('map')}<span>Loading…</span></div></div></div>`;
        }
        if (s.active && ms(s.until) > nowS()) return liveCardHtml(m, s);
        return endedCardHtml(m, s);
    }

    let soon = null;
    function want() { if (!soon) soon = setTimeout(() => { soon = null; refresh(true); }, 60); }

    function cardSig(m) {
        if (!m || !m.location || m.location.home) return '';
        const s = live.shares[m.location.shareId];
        if (!s) return `loc|none|${!!m.location.ended}`;
        const act = s.active && ms(s.until) > nowS();
        const rows = act ? activeShares().map((x) => `${x.id}:${isPaused(x) ? 1 : 0}`).join(',') : '';
        return `loc|${act}|${s.endedAt}|${s.reason}|${!!s.gone}|${isPaused(s)}|${rows}|${me.share === s.id}|${!!me.wake}|${!!myFix()}|${!!s.pos}`;
    }

    // ---------------------------------------------------------------- maps

    let leaflet = null;
    function loadLeaflet() {
        if (window.L && window.L.map) return Promise.resolve(window.L);
        if (leaflet) return leaflet;
        leaflet = new Promise((resolve, reject) => {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = LEAFLET_CSS;
            css.integrity = SRI_CSS;
            css.crossOrigin = '';
            document.head.appendChild(css);
            const js = document.createElement('script');
            js.src = LEAFLET_JS;
            js.integrity = SRI_JS;
            js.crossOrigin = '';
            js.onload = () => (window.L ? resolve(window.L) : reject(new Error('no leaflet')));
            js.onerror = () => { leaflet = null; reject(new Error('Map didn’t load')); };
            document.head.appendChild(js);
        });
        return leaflet;
    }

    function pinIcon(L, s, paused) {
        return L.divIcon({
            className: 'lc-pin' + (paused ? ' paused' : ''),
            html: `<span class="lc-pin-in">${G.avatarHtml(s.user, 'av-md')}</span><i class="lc-pin-tip"></i>`,
            iconSize: [40, 50], iconAnchor: [20, 50]
        });
    }
    function colorOf(name) {
        const probe = document.createElement('span');
        probe.innerHTML = G.avatarHtml(name, 'av-xs');
        const av = probe.firstElementChild;
        av.style.position = 'absolute';
        av.style.visibility = 'hidden';
        document.body.appendChild(av);
        const c = getComputedStyle(av).getPropertyValue('--acc2').trim() || '#2563eb';
        av.remove();
        return c;
    }

    function drawTargets(m, mode) {
        if (mode === 'ended') {
            const s = live.shares[m.location.shareId];
            return s && s.pos ? [{ s, pos: { ...s.pos, at: ms(s.pos.at) } }] : [];
        }
        const s = live.shares[m.location.shareId];
        const list = activeShares();
        if (s && s.active && !list.includes(s)) list.unshift(s);
        return list.map((x) => ({ s: x, pos: posOf(x) })).filter((x) => x.pos);
    }

    function makeMap(L, el, mode, big) {
        const touch = matchMedia('(pointer: coarse)').matches;
        const interactive = big || (mode === 'live' && !touch);
        const map = L.map(el, {
            zoomControl: mode === 'live' || big, attributionControl: true, scrollWheelZoom: big, doubleClickZoom: interactive,
            dragging: interactive, touchZoom: big || (mode === 'live' && !touch), boxZoom: false, keyboard: big, tap: false,
            zoomSnap: 0.5, fadeAnimation: true
        });
        map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
        L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
        return map;
    }

    function paint(entry, targets, L) {
        const seen = new Set();
        targets.forEach(({ s, pos }) => {
            seen.add(s.id);
            const paused = entry.mode === 'live' && isPaused(s);
            let lay = entry.layers.get(s.id);
            const ll = [pos.lat, pos.lng];
            if (!lay) {
                const color = colorOf(s.user);
                lay = {
                    circle: L.circle(ll, { radius: Math.max(5, pos.acc || 0), color, weight: 1.5, opacity: 0.7, fillColor: color, fillOpacity: entry.mode === 'ended' ? 0.18 : 0.12, dashArray: entry.mode === 'ended' ? '4 4' : null, interactive: false }).addTo(entry.map),
                    marker: entry.mode === 'ended' ? null : L.marker(ll, { icon: pinIcon(L, s, paused), keyboard: false, title: s.user }).addTo(entry.map),
                    paused
                };
                entry.layers.set(s.id, lay);
            } else {
                lay.circle.setLatLng(ll);
                lay.circle.setRadius(Math.max(5, pos.acc || 0));
                if (lay.marker) {
                    lay.marker.setLatLng(ll);
                    if (lay.paused !== paused) { lay.marker.setIcon(pinIcon(L, s, paused)); lay.paused = paused; }
                }
            }
        });
        entry.layers.forEach((lay, id) => {
            if (seen.has(id)) return;
            lay.circle.remove();
            if (lay.marker) lay.marker.remove();
            entry.layers.delete(id);
        });
        // You (only on your screen, only for live cards of others).
        const f = entry.mode === 'live' ? myFix() : null;
        const showMe = f && !targets.some((t) => mine(t.s.user));
        if (showMe) {
            if (!entry.me) entry.me = L.circleMarker([f.lat, f.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).addTo(entry.map);
            else entry.me.setLatLng([f.lat, f.lng]);
        } else if (entry.me) { entry.me.remove(); entry.me = null; }
        // Fit everyone in view (until someone moves the map by hand).
        if (!targets.length) return;
        const key = targets.map((t) => `${t.pos.lat.toFixed(4)},${t.pos.lng.toFixed(4)},${Math.round(t.pos.acc / 25)}`).join('|');
        if (entry.touched || key === entry.fitKey) return;
        const first = !entry.fitKey;
        entry.fitKey = key;
        if (targets.length === 1) {
            const acc = targets[0].pos.acc || 30;
            const zoom = entry.mode === 'ended' ? 14 : acc > 1000 ? 13 : acc > 200 ? 15 : 16;
            entry.map.setView([targets[0].pos.lat, targets[0].pos.lng], zoom, { animate: !first });
        } else {
            entry.map.fitBounds(L.latLngBounds(targets.map((t) => [t.pos.lat, t.pos.lng])).pad(0.25), { maxZoom: 16, animate: !first, padding: [24, 24] });
        }
    }

    function attach(slot, L) {
        const id = slot.dataset.locMap;
        const mode = slot.dataset.mode || 'live';
        const m = G.state.byId ? G.state.byId.get(id) : null;
        if (!m) return;
        let entry = maps.get(id);
        if (entry && entry.mode !== mode) { entry.map.remove(); maps.delete(id); entry = null; }
        if (!entry) {
            const el = document.createElement('div');
            el.className = 'lc-map';
            slot.prepend(el);
            entry = { mode, el, map: null, layers: new Map(), me: null, touched: false, fitKey: '' };
            entry.map = makeMap(L, el, mode, false);
            const touchedIt = () => { entry.touched = true; };
            el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.leaflet-control')) touchedIt(); });
            el.addEventListener('wheel', touchedIt, { passive: true });
            maps.set(id, entry);
        } else if (entry.el.parentNode !== slot) {
            slot.prepend(entry.el);
        }
        const fb = slot.querySelector('.lc-map-fallback');
        if (fb) fb.remove();
        entry.map.invalidateSize(false);
        paint(entry, drawTargets(m, mode), L);
    }

    let painting = false;
    function attachAll() {
        const slots = document.querySelectorAll('#messages [data-loc-map]');
        if (!slots.length) { cleanup(); return; }
        loadLeaflet().then((L) => {
            if (painting) return;
            painting = true;
            try { document.querySelectorAll('#messages [data-loc-map]').forEach((slot) => attach(slot, L)); } finally { painting = false; }
            cleanup();
            if (big) paintBig();
        }).catch(() => {
            document.querySelectorAll('#messages [data-loc-map] .lc-map-fallback span').forEach((s) => { s.textContent = 'The map couldn’t load. Open in Maps still works.'; });
        });
    }
    function cleanup() {
        maps.forEach((entry, id) => {
            if (entry.el.isConnected) return;
            // Kept a moment: group.js may be about to put the bubble back.
            if (!entry.goneAt) { entry.goneAt = Date.now(); return; }
            if (Date.now() - entry.goneAt < 1500) return;
            entry.map.remove();
            maps.delete(id);
        });
        maps.forEach((entry) => { if (entry.el.isConnected) entry.goneAt = 0; });
    }

    // The bigger map (a full-screen sheet; it can be dragged and pinched on phones too).
    let big = null;
    function openBig(mid) {
        const m = G.state.byId && G.state.byId.get(mid);
        if (!m) return;
        loadLeaflet().then((L) => {
            closeBig();
            const el = document.createElement('div');
            el.className = 'lc-big';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-modal', 'true');
            el.setAttribute('aria-label', 'Live location map');
            el.innerHTML = `<div class="lc-big-map"></div><div class="lc-big-top"><span class="lc-big-title">${icon('map-pin')}<span>Live location</span></span><button type="button" class="lc-big-x" data-x="lc-big-close" title="Close" aria-label="Close map">${icon('x')}</button></div>`;
            document.body.appendChild(el);
            G.icons(el);
            const map = makeMap(L, el.querySelector('.lc-big-map'), 'live', true);
            big = { mid, el, entry: { mode: 'live', el, map, layers: new Map(), me: null, touched: false, fitKey: '' } };
            el.querySelector('.lc-big-map').addEventListener('pointerdown', (e) => { if (!e.target.closest('.leaflet-control') && big) big.entry.touched = true; });
            requestAnimationFrame(() => { map.invalidateSize(false); paintBig(); });
            el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBig(); });
            el.querySelector('.lc-big-x').focus({ preventScroll: true });
        }).catch(() => G.toast('The map couldn’t load right now.', 'error'));
    }
    function paintBig() {
        if (!big || !window.L) return;
        const m = G.state.byId && G.state.byId.get(big.mid);
        if (m) paint(big.entry, drawTargets(m, 'live'), window.L);
    }
    function closeBig() { if (!big) return; big.entry.map.remove(); big.el.remove(); big = null; }

    // Text that changes every few seconds is written in place (no re-render), and the maps move.
    function updateAll() {
        document.querySelectorAll('#messages [data-lc-ago]').forEach((el) => {
            const s = live.shares[el.dataset.lcAgo];
            if (!s) return;
            const p = posOf(s);
            el.textContent = isPaused(s) ? `Last seen ${agoLabel(seenOf(s)).replace('Updated ', '')}` : p ? agoLabel(Math.max(p.at || 0, seenOf(s))) : 'Finding location…';
        });
        document.querySelectorAll('#messages [data-lc-left]').forEach((el) => { const s = live.shares[el.dataset.lcLeft]; if (s) el.textContent = leftLabel(s.until); });
        const f = myFix();
        document.querySelectorAll('#messages [data-lc-dist]').forEach((el) => {
            const s = live.shares[el.dataset.lcDist];
            const p = s && posOf(s);
            const txt = s && p && f && !mine(s.user) ? distLabel(meters(f, p)) : '';
            el.textContent = txt;
            el.hidden = !txt;
        });
        document.querySelectorAll('#messages [data-lc-open]').forEach((el) => {
            const s = live.shares[el.dataset.lcOpen];
            const p = s && posOf(s);
            if (p) { el.href = mapsHref(p, s.user); el.classList.remove('off'); } else { el.removeAttribute('href'); el.classList.add('off'); }
        });
        if (window.L) {
            maps.forEach((entry, id) => { const m = G.state.byId && G.state.byId.get(id); if (m && entry.el.isConnected) paint(entry, drawTargets(m, entry.mode), window.L); });
            paintBig();
        }
    }

    // Each 5 s: refresh the labels, and re-draw a card whose state changed (paused, ran out).
    let lastSig = '';
    setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        const sig = sigAll();
        if (sig !== lastSig) { lastSig = sig; if (document.querySelector('#messages .lc')) G.render('auto'); }
        if (activeShares().some((s) => ms(s.until) <= nowS())) refresh(true);
        updateAll();
    }, 5000);

    // ---------------------------------------------------------------- events

    document.addEventListener('click', (e) => {
        if (G.clickSuppressed()) return;
        if (e.target.closest && e.target.closest('#btn-location')) { e.preventDefault(); openModal(); return; }
        const t = e.target.closest && e.target.closest('[data-x^="lc-"]');
        if (!t || t.disabled) return;
        const x = t.dataset.x;
        if (x === 'lc-map') return;
        e.preventDefault();
        const min = Number(t.dataset.min);
        if (x === 'lc-start') startSharing(min, t);
        else if (x === 'lc-extend') extend(t.dataset.id, min, t);
        else if (x === 'lc-extend-open') openModal('extend', t.dataset.id);
        else if (x === 'lc-stop') { closeModal(); stopSharing(t.dataset.id, t); }
        else if (x === 'lc-home') homeSafe(t);
        else if (x === 'lc-resume') resume(t);
        else if (x === 'lc-distance') distanceOn(t);
        else if (x === 'lc-close') closeModal();
        else if (x === 'lc-expand') openBig(t.dataset.mid);
        else if (x === 'lc-big-close') closeBig();
        else if (x === 'lc-wake') { if (me.wake) wakeOff(); else wakeOn(); setTimeout(() => G.render('auto'), 50); }
    }, true);
    // "Open in Maps" before a position arrived does nothing.
    document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[data-lc-open].off'); if (a) e.preventDefault(); }, true);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        refresh(true);
        if (me.share) { if (me.wantWake) wakeOn(); maybeSend(); }
    });
    window.addEventListener('chowaniec-group-started', () => { setTimeout(() => refresh(true), 300); schedule(); });

    // ---------------------------------------------------------------- hooks
    const base = { richHtml: X.richHtml, richClass: X.richClass, sig: X.sig, afterRender: X.afterRender };
    X.richHtml = function (m, o) { return cardHtml(m) || base.richHtml.call(X, m, o); };
    X.richClass = function (m) {
        if (m && m.location && m.location.home) return 'rich-home';
        if (m && m.location) return 'rich-loc';
        return base.richClass.call(X, m);
    };
    X.sig = function (m) { return (base.sig ? base.sig.call(X, m) : '') + cardSig(m); };
    X.afterRender = function () {
        if (base.afterRender) base.afterRender.call(X);
        attachAll();
        updateAll();
        distanceIfAllowed();
    };
    window.GroupLocation = { refresh, live, me, maps, open: openModal };
})();
