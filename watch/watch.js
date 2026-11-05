// Chowaniec Watch Party: watch YouTube together, in sync, on everyone's phone (window.ChowWatch).
//   ChowWatch.mountStart(el)                         the /watch/ start screen (paste a link, invite a chat, recent videos)
//   ChowWatch.mountParty(el, { id, embedded, onClose, title })   a party: synced player, reactions, chat, queue, people
//   ChowWatch.meetParty(code) -> party               the party that belongs to a Meet call (used by meet-watch.js)
// Server: /.netlify/functions/watch (netlify/lib/watch-store.mjs).
//
// How the sync works: the party's state { videoId, playing, position, rate, updatedAt (server ms), version } is the
// single truth. Whoever presses play / pause / seek sends a new state (with the version they saw); everyone polls
// about every 1.5 s (every 0.5 s for a few seconds after a change) and steers their own player toward where the video
// should be right now: position + (serverNow - updatedAt) * rate. Far off (> 1.2 s): seek. A little off: play a touch
// faster or slower (0.95-1.05x) until it converges. While a player is buffering it is left alone. serverNow comes from
// the X-Server-Time header, so a phone whose clock is wrong still lands on the same frame.
(function () {
  'use strict';
  if (window.ChowWatch) return;

  const API = '/.netlify/functions/watch';
  const POLL_MS = 1500;
  const FAST_POLL_MS = 500;
  const HIDDEN_POLL_MS = 5000;
  const FAST_FOR_MS = 4000;
  const TICK_MS = 300;
  const SEEK_AT = 1.2;           // seconds of drift that make us jump
  const SEEK_AT_COARSE = 0.6;    // ... when this player can't do fine speed changes
  const NUDGE_AT = 0.08;         // below this we play at the party's speed
  const NUDGE_GAIN = 0.3;
  const NUDGE_MAX = 0.05;
  const TRIM_GAIN = 0.012;       // learns a player that keeps running fast or slow (per tick)
  const TRIM_MAX = 0.04;
  const SEEK_AT_CHANGE = 0.3;    // right after a play / pause / seek everyone lines up tighter
  const RECENT_KEY = 'chowaniec_watch_recent';
  const REACTIONS = ['heart', 'laugh', 'wow', 'clap'];
  const REACTION_NAMES = { heart: 'Love it', laugh: 'Funny', wow: 'Wow', clap: 'Applause' };
  const RATES = [1, 1.25, 1.5, 2, 0.75];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const user = () => (window.getChowaniecUser ? window.getChowaniecUser() : null) || {};
  const myName = () => user().name || '';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } };

  // ---------- Icons (paths from Lucide, ISC licence) ----------
  const ICONS = {
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
    pause: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
    back10: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    fwd10: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    next: '<path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    chat: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
    list: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
    tv: '<path d="m17 2-5 5-5-5"/><rect width="20" height="15" x="2" y="7" rx="2"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    group: '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
    volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    mute: '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    logOut: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'
  };
  const icon = (name, size) => `<svg class="cw-ic" width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  // ---------- Reactions: little drawings (not emoji) ----------
  const DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="cw-g-heart" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8fb1"/><stop offset="1" stop-color="#e11d48"/></linearGradient>' +
    '<radialGradient id="cw-g-sun" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#fff4a3"/><stop offset=".55" stop-color="#fcd34d"/><stop offset="1" stop-color="#f59e0b"/></radialGradient>' +
    '<linearGradient id="cw-g-hand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>' +
    '<linearGradient id="cw-g-hand2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fcd34d"/><stop offset="1" stop-color="#d97706"/></linearGradient>' +
    '</defs></svg>';
  const ART = {
    heart: '<path d="M24 42C10.5 32.4 4 25.2 4 17.2 4 11 8.8 6 14.8 6c3.9 0 7.2 2 9.2 5.2C26 8 29.3 6 33.2 6 39.2 6 44 11 44 17.2 44 25.2 37.5 32.4 24 42z" fill="url(#cw-g-heart)"/><ellipse cx="14.5" cy="15" rx="5" ry="3.2" fill="#fff" opacity=".45" transform="rotate(-30 14.5 15)"/>',
    laugh: '<circle cx="24" cy="24" r="20" fill="url(#cw-g-sun)"/><path d="M12.5 19.5q4-5 8 0M27.5 19.5q4-5 8 0" fill="none" stroke="#7c2d12" stroke-width="2.8" stroke-linecap="round"/><path d="M12 25.5h24a12 12 0 0 1-24 0z" fill="#7c2d12"/><path d="M18 33.6q6-4.4 12 0a8 5.2 0 0 1-12 0z" fill="#fb7185"/><path d="M7.5 22.5q-3.6 5.4 0 7.6 3.6-2.2 0-7.6zM40.5 22.5q-3.6 5.4 0 7.6 3.6-2.2 0-7.6z" fill="#60a5fa"/>',
    wow: '<circle cx="24" cy="24" r="20" fill="url(#cw-g-sun)"/><path d="M12.5 13.5q4-3.4 8.5-1.6M27 11.9q4.5-1.8 8.5 1.6" fill="none" stroke="#7c2d12" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="17" cy="20.5" rx="3" ry="3.6" fill="#7c2d12"/><ellipse cx="31" cy="20.5" rx="3" ry="3.6" fill="#7c2d12"/><circle cx="18" cy="19.4" r="1" fill="#fff"/><circle cx="32" cy="19.4" r="1" fill="#fff"/><ellipse cx="24" cy="32" rx="5.2" ry="6.6" fill="#7c2d12"/>',
    clap: '<g transform="rotate(-20 24 30)"><rect x="13" y="12" width="14" height="27" rx="7" fill="url(#cw-g-hand2)"/><path d="M16 16v8M20 14v9M24 16v8" stroke="#b45309" stroke-width="1.6" stroke-linecap="round" opacity=".55"/></g><g transform="rotate(16 24 30)"><rect x="20" y="13" width="14" height="27" rx="7" fill="url(#cw-g-hand)"/><path d="M23 17v8M27 15v9M31 17v8" stroke="#b45309" stroke-width="1.6" stroke-linecap="round" opacity=".5"/></g><path d="M9 11 6 6.5M15.5 7 14.6 2M35 8l3.4-4.2M40 13.5l4.6-1.8" stroke="#fbbf24" stroke-width="2.6" stroke-linecap="round"/>'
  };
  const art = (k, size) => `<svg class="cw-art" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${ART[k] || ''}</svg>`;
  function ensureDefs() {
    if (document.getElementById('cw-defs')) return;
    const d = document.createElement('div');
    d.id = 'cw-defs';
    d.innerHTML = DEFS;
    document.body.appendChild(d);
  }

  // ---------- Avatars ----------
  const AV_COLORS = ['#f43f5e', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1'];
  function avColor(name) {
    let h = 0;
    for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }
  const avatar = (name, cls) => `<span class="cw-av${cls ? ' ' + cls : ''}" style="--av:${avColor(name)}" title="${esc(name)}" aria-hidden="true">${esc(String(name || '?').charAt(0).toUpperCase())}</span>`;

  // ---------- Server clock + API ----------
  let clockOffset = 0;
  let bestRtt = Infinity;
  let bestAt = 0;
  function learnClock(header, sent, got) {
    const server = Number(header);
    if (!server) return;
    const rtt = got - sent;
    // Trust the quickest round trip, but let an old best expire so a changed clock is noticed.
    if (rtt > bestRtt * 1.25 && got - bestAt < 60000) return;
    bestRtt = rtt;
    bestAt = got;
    clockOffset = server - (sent + got) / 2;
  }
  const serverNow = () => Date.now() + clockOffset;

  async function api(method, query, body, { keepalive } = {}) {
    const sent = Date.now();
    const res = await fetch(API + (query || ''), {
      method, credentials: 'same-origin', cache: 'no-store', keepalive: !!keepalive,
      headers: Object.assign({ 'X-Chowaniec-Key': user().key || '' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    learnClock(res.headers.get('X-Server-Time'), sent, Date.now());
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
    return data;
  }

  // ---------- YouTube links ----------
  // Accepts watch / youtu.be / shorts / embed / live / music links or a bare 11-character id. Returns { id, t } or null.
  function parseYouTube(text) {
    const s = String(text || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return { id: s, t: 0 };
    let u;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
        if (m) id = m[1];
      }
    }
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const raw = u.searchParams.get('t') || u.searchParams.get('start') || '';
    let t = 0;
    const hms = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if (hms) t = (Number(hms[1]) || 0) * 3600 + (Number(hms[2]) || 0) * 60 + (Number(hms[3]) || 0);
    return { id, t };
  }
  const thumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
  const thumbImg = (id, cls) => `<span class="${cls || 'cw-thumb'}"><img src="${thumb(id)}" alt="" loading="lazy" onerror="this.remove()">${icon('film', 18)}</span>`;
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
  }

  // Recently watched videos on this device (for the start screen).
  function recent() { try { return JSON.parse(lsGet(RECENT_KEY) || '[]').filter((r) => r && r.videoId); } catch (e) { return []; } }
  function remember(videoId, title) {
    if (!videoId) return;
    const list = recent().filter((r) => r.videoId !== videoId);
    list.unshift({ videoId, title: title || 'YouTube video', at: Date.now() });
    lsSet(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
  }

  // ---------- YouTube IFrame API ----------
  let ytPromise = null;
  function loadYouTube() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytPromise) return ytPromise;
    ytPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') try { prev(); } catch (e) { /* ignore */ } resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => { ytPromise = null; reject(new Error('YouTube couldn’t be reached.')); };
      document.head.appendChild(s);
      setTimeout(() => { if (!(window.YT && window.YT.Player)) reject(new Error('YouTube is taking too long to load.')); }, 20000);
    });
    return ytPromise;
  }

  // ---------- Small UI helpers ----------
  function toaster(root) {
    let el = null;
    let timer = null;
    return (text) => {
      if (!el) { el = document.createElement('div'); el.className = 'cw-toast'; el.setAttribute('role', 'status'); root.appendChild(el); }
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('show'), 2800);
    };
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  let chatsCache = null;
  async function loadChats() {
    if (chatsCache) return chatsCache;
    try { chatsCache = (await api('GET', '?chats=1')).chats || []; } catch (e) { chatsCache = []; }
    return chatsCache;
  }

  // =====================================================================================================
  // Start screen
  // =====================================================================================================
  function mountStart(root) {
    ensureDefs();
    const toast = toaster(document.body);
    let picked = null;      // { id, t }
    let room = '';
    let infoTimer = null;
    root.innerHTML = `
      <div class="cw cw-start">
        <header class="cw-top">
          <a class="cw-iconbtn" href="/" aria-label="Back to the hub">${icon('back', 22)}</a>
          <div class="cw-top-title"><strong>Watch party</strong><span>Chowaniec</span></div>
        </header>
        <section class="cw-hero">
          <div class="cw-marquee" aria-hidden="true">${icon('tv', 34)}</div>
          <h1>Watch together</h1>
          <p>Pick a YouTube video and everyone watches it at the same moment, on their own phone. React, chat and line up what’s next.</p>
        </section>
        <form class="cw-card cw-new" novalidate>
          <label class="cw-label" for="cw-link">YouTube link or video ID</label>
          <div class="cw-field">
            <span class="cw-field-ic">${icon('link', 18)}</span>
            <input id="cw-link" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false">
          </div>
          <p class="cw-help" id="cw-link-help">Copy the link from the YouTube app (Share, then Copy link) and paste it here. You can also start empty and add videos later.</p>
          <div class="cw-preview" hidden></div>
          <fieldset class="cw-fs">
            <legend class="cw-label">Invite</legend>
            <div class="cw-chips" role="radiogroup" aria-label="Invite"><span class="cw-help">Loading chats…</span></div>
          </fieldset>
          <label class="cw-switch"><input type="checkbox" id="cw-anyone" checked><span class="cw-knob" aria-hidden="true"></span><span><strong>Anyone can control</strong><small>Everyone can play, pause, skip and seek. Turn off to keep the remote yourself.</small></span></label>
          <button type="submit" class="cw-btn cw-primary cw-go">${icon('play', 18)}<span>Start the party</span></button>
        </form>
        <section class="cw-card cw-live-list" hidden><h2>${icon('users', 18)} Happening now</h2><div class="cw-live-items"></div></section>
        <section class="cw-card cw-recent" hidden><h2>${icon('clock', 18)} Recently watched</h2><div class="cw-recent-items"></div></section>
      </div>`;
    const form = $('.cw-new', root);
    const input = $('#cw-link', root);
    const preview = $('.cw-preview', root);
    const go = $('.cw-go', root);

    function setPicked(p) {
      picked = p;
      clearTimeout(infoTimer);
      if (!p) { preview.hidden = true; preview.innerHTML = ''; return; }
      preview.hidden = false;
      preview.innerHTML = `${thumbImg(p.id, 'cw-thumb cw-thumb-lg')}<div><strong class="cw-pv-title">Finding the video…</strong><small>${p.t ? `Starts at ${fmtTime(p.t)}` : 'YouTube'}</small></div>`;
      infoTimer = setTimeout(async () => {
        try {
          const info = await api('GET', `?info=${encodeURIComponent(p.id)}`);
          if (picked !== p) return;
          $('.cw-pv-title', preview).textContent = info.title;
          if (info.channel) $('small', preview).textContent = info.channel + (p.t ? ` · starts at ${fmtTime(p.t)}` : '');
        } catch (e) {
          if (picked !== p) return;
          $('.cw-pv-title', preview).textContent = e.message;
          preview.classList.add('bad');
        }
      }, 250);
      preview.classList.remove('bad');
    }
    input.addEventListener('input', () => {
      const v = input.value.trim();
      const p = v ? parseYouTube(v) : null;
      $('#cw-link-help', root).classList.toggle('bad', !!v && !p);
      $('#cw-link-help', root).textContent = v && !p ? 'That doesn’t look like a YouTube link. Try copying it again from YouTube.' : 'Copy the link from the YouTube app (Share, then Copy link) and paste it here. You can also start empty and add videos later.';
      if (!p || !picked || p.id !== picked.id || p.t !== picked.t) setPicked(p);
    });

    function renderChips(chats) {
      const opt = (id, label, ic) => `<button type="button" class="cw-chip${room === id ? ' on' : ''}" role="radio" aria-checked="${room === id}" data-room="${esc(id)}">${icon(room === id ? 'check' : ic, 16)}<span>${esc(label)}</span></button>`;
      $('.cw-chips', root).innerHTML = opt('', 'Just a link', 'link') +
        chats.filter((c) => !c.dm).map((c) => opt(c.id, c.name, 'group')).join('') +
        chats.filter((c) => c.dm).map((c) => opt(c.id, c.name, 'chat')).join('');
    }
    $('.cw-chips', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-room]');
      if (!b) return;
      room = b.dataset.room;
      renderChips(chatsCache || []);
    });
    loadChats().then(renderChips);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v && !picked) { input.focus(); return; }
      go.disabled = true;
      $('span', go).textContent = 'Starting…';
      try {
        const body = { action: 'create', anyone: $('#cw-anyone', root).checked };
        if (room) body.room = room;
        if (picked) { body.video = picked.id; body.t = picked.t; }
        const { party } = await api('POST', '', body);
        location.href = `/watch/?p=${party.id}`;
      } catch (err) {
        toast(err.message);
        go.disabled = false;
        $('span', go).textContent = 'Start the party';
      }
    });

    const rec = recent();
    if (rec.length) {
      $('.cw-recent', root).hidden = false;
      $('.cw-recent-items', root).innerHTML = rec.map((r) => `<button type="button" class="cw-row-btn" data-vid="${esc(r.videoId)}">${thumbImg(r.videoId)}<span class="cw-row-text"><strong>${esc(r.title)}</strong><small>Tap to pick it</small></span>${icon('plus', 18)}</button>`).join('');
      $('.cw-recent-items', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-vid]');
        if (!b) return;
        input.value = `https://youtu.be/${b.dataset.vid}`;
        input.dispatchEvent(new Event('input'));
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }

    api('GET', '?active=1').then(({ parties }) => {
      if (!parties || !parties.length) return;
      $('.cw-live-list', root).hidden = false;
      $('.cw-live-items', root).innerHTML = parties.map((p) => `<a class="cw-row-btn" href="/watch/?p=${esc(p.id)}">${p.state.videoId ? thumbImg(p.state.videoId) : `<span class="cw-thumb">${icon('tv', 18)}</span>`}<span class="cw-row-text"><strong>${esc(p.state.title || `${p.host}’s party`)}</strong><small><span class="cw-avs">${p.watchers.slice(0, 5).map((w) => avatar(w.name, 'sm')).join('')}</span>${p.watchers.length} watching</small></span><span class="cw-pill">Join</span></a>`).join('');
    }).catch(() => {});
  }

  // =====================================================================================================
  // A party
  // =====================================================================================================
  function mountParty(root, opts) {
    ensureDefs();
    const o = opts || {};
    const id = o.id;
    const embedded = !!o.embedded;
    const uid = Math.random().toString(36).slice(2, 8);
    const toast = toaster(root);
    let party = null;
    let watchers = [];
    let may = false;
    let cursor = '';
    let destroyed = false;
    let pollTimer = null;
    let tickTimer = null;
    let fastUntil = 0;
    let pending = null;        // { base } while a change we made is on its way
    let joined = false;        // tapped "join" on this device (sound on)
    let player = null;
    let ready = false;
    let loadedId = null;
    let lastSeekAt = 0;
    let lastPlayTry = 0;
    let setRateNow = 1;
    let rateChecks = 0;
    let coarse = false;        // this player ignores small speed changes: correct by seeking only
    let bufferingSince = 0;
    let trim = 0;
    let tightUntil = 0;
    let endedSent = -1;
    let durationSent = -1;
    let dragging = false;
    let muted = true;
    let failed = '';           // a player error for the current video
    let chatSig = '';
    let lastSeenVersion = -1;
    let tab = 'chat';
    const seen = new Set();

    root.innerHTML = `
      <div class="cw cw-party${embedded ? ' cw-embedded' : ''}">
        <header class="cw-top">
          ${embedded ? '' : `<a class="cw-iconbtn" href="/watch/" aria-label="All watch parties">${icon('back', 22)}</a>`}
          <div class="cw-top-title"><strong class="cw-top-name">${esc(o.title || 'Watch party')}</strong><strong class="cw-top-now"></strong><span class="cw-host"></span></div>
          <div class="cw-avs cw-top-avs" aria-label="Watching"></div>
          ${embedded ? `<button type="button" class="cw-iconbtn" data-a="close" aria-label="Close watch together">${icon('close', 20)}</button>`
    : `<button type="button" class="cw-iconbtn" data-a="invite" aria-label="Invite people">${icon('users', 20)}</button><button type="button" class="cw-iconbtn" data-a="leave" aria-label="Leave the party">${icon('logOut', 20)}</button>`}
        </header>
        <div class="cw-body">
          <section class="cw-stage">
            <div class="cw-screen">
              <div class="cw-player"><div id="cw-player-${uid}"></div></div>
              <div class="cw-shield"></div>
              <div class="cw-fx" aria-hidden="true"></div>
              <div class="cw-spin" hidden><i></i></div>
              <div class="cw-empty" hidden>${icon('tv', 40)}<strong>Nothing playing yet</strong><span>Add a YouTube link in the queue to start.</span></div>
              <div class="cw-err" hidden>${icon('alert', 34)}<strong></strong><button type="button" class="cw-btn cw-small" data-a="next">${icon('next', 16)}Skip it</button></div>
              <button type="button" class="cw-join" hidden><span class="cw-join-ring">${icon('play', 34)}</span><strong>Tap to join the party</strong><small>Sound comes on when you tap</small></button>
            </div>
            <div class="cw-bar">
              <button type="button" class="cw-ctl cw-play" data-a="toggle" aria-label="Play">${icon('play', 22)}</button>
              <button type="button" class="cw-ctl" data-a="back10" aria-label="Back 10 seconds">${icon('back10', 19)}<i>10</i></button>
              <button type="button" class="cw-ctl" data-a="fwd10" aria-label="Forward 10 seconds">${icon('fwd10', 19)}<i>10</i></button>
              <div class="cw-seek">
                <label class="cw-sr" for="cw-seek-${uid}">Position in the video</label>
                <input type="range" id="cw-seek-${uid}" min="0" max="100" step="0.1" value="0">
                <span class="cw-time"><b class="cw-cur">0:00</b> / <span class="cw-dur">0:00</span></span>
              </div>
              <button type="button" class="cw-ctl cw-rate" data-a="rate" aria-label="Playback speed">1×</button>
              <button type="button" class="cw-ctl" data-a="mute" aria-label="Sound">${icon('mute', 19)}</button>
              <button type="button" class="cw-ctl" data-a="next" aria-label="Next video in the queue">${icon('next', 19)}</button>
            </div>
            <div class="cw-now">
              <div class="cw-now-text"><strong class="cw-title">Watch party</strong><small class="cw-by"></small></div>
              <span class="cw-lock" hidden>${icon('lock', 14)}<span></span></span>
            </div>
            <div class="cw-reacts" role="group" aria-label="Reactions">
              ${REACTIONS.map((k) => `<button type="button" class="cw-react" data-k="${k}" aria-label="${REACTION_NAMES[k]}">${art(k, 30)}</button>`).join('')}
            </div>
          </section>
          <aside class="cw-side">
            <div class="cw-tabs" role="tablist">
              <button type="button" role="tab" data-tab="chat" aria-selected="true">${icon('chat', 16)}<span>Chat</span><i class="cw-badge" hidden></i></button>
              <button type="button" role="tab" data-tab="queue" aria-selected="false">${icon('list', 16)}<span>Up next</span><i class="cw-count"></i></button>
              <button type="button" role="tab" data-tab="people" aria-selected="false">${icon('users', 16)}<span>People</span><i class="cw-count"></i></button>
            </div>
            <div class="cw-pane" data-pane="chat">
              <ol class="cw-msgs" aria-live="polite"></ol>
              <form class="cw-say">
                <label class="cw-label" for="cw-say-${uid}">Message the party</label>
                <div class="cw-say-row"><input id="cw-say-${uid}" type="text" maxlength="300" autocomplete="off" enterkeyhint="send"><button type="submit" class="cw-send" aria-label="Send">${icon('send', 18)}</button></div>
              </form>
            </div>
            <div class="cw-pane" data-pane="queue" hidden>
              <form class="cw-add" novalidate>
                <label class="cw-label" for="cw-add-${uid}">Add a YouTube link or video ID</label>
                <div class="cw-field"><span class="cw-field-ic">${icon('link', 18)}</span><input id="cw-add-${uid}" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
                <div class="cw-add-row"><button type="submit" class="cw-btn cw-primary">${icon('plus', 16)}<span>Add to queue</span></button><button type="button" class="cw-btn" data-a="playnow">${icon('play', 16)}<span>Play now</span></button></div>
              </form>
              <ol class="cw-queue"></ol>
              <h3 class="cw-h3 cw-played-h" hidden>Played earlier</h3>
              <ol class="cw-queue cw-played"></ol>
            </div>
            <div class="cw-pane" data-pane="people" hidden>
              <ul class="cw-people"></ul>
              <label class="cw-switch cw-anyone"><input type="checkbox"><span class="cw-knob" aria-hidden="true"></span><span><strong>Anyone can control</strong><small class="cw-anyone-hint"></small></span></label>
              ${embedded ? '' : `<h3 class="cw-h3">Invite</h3><p class="cw-help">Posts “Watch party · Join” in that chat and lets everyone there know.</p><div class="cw-chips cw-invite"><span class="cw-help">Loading chats…</span></div>`}
              <button type="button" class="cw-btn cw-copy" data-a="copy">${icon('copy', 16)}<span>Copy link</span></button>
            </div>
          </aside>
        </div>
      </div>`;
    const el = $('.cw-party', root);
    const screen = $('.cw-screen', el);
    const seek = $('input[type=range]', el);

    // ----- state helpers -----
    const S = () => (party && party.state) || null;
    function expected(s) {
      if (!s || !s.videoId) return 0;
      const p = s.playing ? s.position + Math.max(0, serverNow() - s.updatedAt) / 1000 * (s.rate || 1) : s.position;
      return s.duration ? Math.min(p, s.duration) : p;
    }
    function localTime() {
      try { if (player && ready && loadedId) return player.getCurrentTime() || 0; } catch (e) { /* not ready */ }
      return expected(S());
    }
    const duration = () => {
      const s = S();
      let d = (s && s.duration) || 0;
      try { if (!d && player && ready && loadedId) d = player.getDuration() || 0; } catch (e) { /* not ready */ }
      return d;
    };
    function pState() { try { return player && ready ? player.getPlayerState() : -1; } catch (e) { return -1; } }

    // ----- applying the party state to the player -----
    function setRate(r) {
      if (!player || !ready) return;
      if (Math.abs(r - setRateNow) < 0.004) return;
      try { player.setPlaybackRate(r); } catch (e) { return; }
      setRateNow = r;
      // Some players only take whole steps (0.25x): if a gentle nudge never sticks, fall back to seeking.
      const base = (S() && S().rate) || 1;
      if (Math.abs(r - base) > 0.01) {
        setTimeout(() => {
          try {
            const got = player.getPlaybackRate();
            if (Math.abs(got - r) > 0.01 && Math.abs(got - base) < 0.01) { setRateNow = got; if (++rateChecks >= 2) coarse = true; } else rateChecks = 0;
          } catch (e) { /* ignore */ }
        }, 250);
      }
    }

    // A seek while playing usually buffers for a moment, so we aim ahead by how long the last ones took here.
    let seekLead = 0.15;
    let seekStartedAt = 0;
    function hardSeek(to) {
      try { player.seekTo(Math.max(0, to), true); } catch (e) { return; }
      lastSeekAt = Date.now();
      seekStartedAt = S() && S().playing ? Date.now() : 0;
    }
    function catchUp(exp) { hardSeek(exp + seekLead); }

    function tick() {
      if (destroyed) return;
      renderTime();
      const s = S();
      if (!player || !ready || !s) return;
      if (!s.videoId) {
        if (loadedId) { try { player.stopVideo(); } catch (e) { /* ignore */ } loadedId = null; }
        return;
      }
      const exp = expected(s);
      if (loadedId !== s.videoId) {
        loadedId = s.videoId;
        failed = '';
        coarse = false;
        rateChecks = 0;
        setRateNow = 1;
        trim = 0;
        try { player.loadVideoById({ videoId: s.videoId, startSeconds: exp }); } catch (e) { return; }
        lastSeekAt = Date.now();
        remember(s.videoId, s.title);
        renderState();
        return;
      }
      if (failed) return;
      const ps = pState();
      const base = s.rate || 1;
      let cur = 0;
      try { cur = player.getCurrentTime() || 0; } catch (e) { cur = 0; }
      if (ps === 3) { if (!bufferingSince) bufferingSince = Date.now(); } else bufferingSince = 0;
      $('.cw-spin', el).hidden = !(ps === 3 && Date.now() - bufferingSince > 400);

      if (!s.playing) {
        if (ps === 1 || ps === 3) { try { player.pauseVideo(); } catch (e) { /* ignore */ } }
        if (Math.abs(cur - exp) > 0.12 && Date.now() - lastSeekAt > 700) hardSeek(exp);
        setRate(base);
        return;
      }
      if (ps === 0) {
        // Ended here. If the party thinks there's more to go, catch up; otherwise tell the server (it moves on).
        if (s.duration && exp < s.duration - 2) { hardSeek(exp); try { player.playVideo(); } catch (e) { /* ignore */ } } else reportEnded(s);
        return;
      }
      if (ps === 2 || ps === 5 || ps === -1) {
        if (Date.now() - lastPlayTry > 1200) {
          lastPlayTry = Date.now();
          if (Math.abs(cur - exp) > 0.25) catchUp(exp);
          try { player.playVideo(); } catch (e) { /* ignore */ }
        }
        return;
      }
      if (ps === 3) return;                                 // buffering: don't fight it
      if (seekStartedAt && ps === 1) {
        const took = (Date.now() - seekStartedAt) / 1000;
        if (took < 8) seekLead = clamp(seekLead * 0.4 + took * 0.6, 0.15, 4);
        seekStartedAt = 0;
      }
      if (Date.now() - lastSeekAt < 1500) return;          // let a seek settle
      if (!s.duration && durationSent !== s.version) reportDuration(s);
      const drift = cur - exp;
      const limit = Date.now() < tightUntil ? SEEK_AT_CHANGE : coarse ? SEEK_AT_COARSE : SEEK_AT;
      if (Math.abs(drift) > limit) {
        catchUp(exp);
        setRate(base * (1 - trim));
      } else if (!coarse) {
        // Proportional nudge for the current gap plus a learned trim for a player that keeps drifting the same way.
        trim = clamp(trim + drift * TRIM_GAIN, -TRIM_MAX, TRIM_MAX);
        const nudge = Math.abs(drift) > NUDGE_AT ? drift * NUDGE_GAIN : 0;
        setRate(clamp(base * (1 - trim - nudge), base * (1 - NUDGE_MAX), base * (1 + NUDGE_MAX)));
      } else setRate(base);
    }

    // The first person in the watcher list tells the server a video ended; everyone else only does if that
    // hasn't happened a few seconds later (so the server isn't told three times).
    let endedAt = 0;
    const leader = () => { const ok = watchers.filter((w) => w.s === 'ok'); return !ok.length || ok[0].name === myName(); };
    function reportEnded(s) {
      if (endedSent === s.version) return;
      if (!leader()) {
        if (!endedAt) endedAt = Date.now();
        if (Date.now() - endedAt < 3000) return;
      }
      endedAt = 0;
      endedSent = s.version;
      api('POST', '', { action: 'control', id, version: s.version, op: 'ended' }).then((d) => adopt(d.party)).catch(() => {});
    }
    function reportDuration(s) {
      const d = duration();
      if (!(d > 0) || !leader()) return;
      durationSent = s.version;
      api('POST', '', { action: 'control', id, version: s.version, op: 'duration', duration: d }).then((r) => adopt(r.party)).catch(() => {});
    }

    // ----- taking in a fresh party from the server -----
    function adopt(p) {
      if (!p || destroyed) return;
      const prev = party;
      const prevState = prev && prev.state;
      if (pending && prevState && p.state.version <= pending.base && p.state.version < prevState.version + 1 && Date.now() - pending.at < 6000) {
        p = { ...p, state: prevState };                     // our own change hasn't reached the server yet
      }
      party = p;
      if (p.state.version !== lastSeenVersion) {
        if (lastSeenVersion >= 0 && p.state.by && p.state.by !== myName() && prevState) announce(prevState, p.state);
        lastSeenVersion = p.state.version;
        fastUntil = Date.now() + FAST_FOR_MS;
        tightUntil = Date.now() + 3000;
        endedAt = 0;
      }
      renderState();
      renderQueue();
      renderPeople();
      tick();
    }

    function announce(a, b) {
      const who = b.by === 'auto' ? '' : b.by;
      if (!who) { if (a.videoId !== b.videoId && b.videoId) toast(`Up next: ${b.title}`); return; }
      if (a.videoId !== b.videoId) toast(`${who} put on ${b.title}`);
      else if (a.playing && !b.playing) toast(`${who} paused`);
      else if (!a.playing && b.playing) toast(`${who} pressed play`);
      else if (a.rate !== b.rate) toast(`${who} changed the speed to ${b.rate}×`);
      else toast(`${who} jumped to ${fmtTime(b.position)}`);
    }

    // ----- changing the party (play / pause / seek / ...) -----
    async function commit(op, extra, retried) {
      const s = S();
      if (!s) return;
      if (!may) { toast(`Only ${party.host} can control this party.`); return; }
      const body = Object.assign({ action: 'control', id, version: s.version, op }, extra || {});
      // Show it straight away on this device.
      if (op === 'play' || op === 'pause' || op === 'seek' || op === 'rate') {
        const nowS = serverNow();
        const next = { ...s, position: 'position' in body ? body.position : expected(s), updatedAt: nowS, version: s.version + 1, by: myName() };
        if (op === 'play') next.playing = true;
        if (op === 'pause') next.playing = false;
        if (op === 'rate') { next.rate = body.rate; next.position = expected(s); }
        pending = { base: s.version, at: Date.now() };
        party = { ...party, state: next };
        lastSeenVersion = next.version;
        if (op === 'seek' || op === 'play') { if (player && ready && loadedId) hardSeek(next.position); }
        if (op === 'pause' && player && ready) { try { player.pauseVideo(); } catch (e) { /* ignore */ } hardSeek(next.position); }
        renderState();
        tick();
      }
      fastUntil = Date.now() + FAST_FOR_MS;
      try {
        const d = await api('POST', '', body);
        pending = null;
        lastSeenVersion = -1;
        adopt(d.party);
        lastSeenVersion = d.party.state.version;
      } catch (e) {
        pending = null;
        if (e.status === 409 && e.data && e.data.party) {
          lastSeenVersion = -1;
          adopt(e.data.party);
          // Someone changed it a moment before us: our press is still the newest wish, so apply it on top.
          if (!retried && op !== 'next') { const fresh = { ...extra }; if (op === 'play' || op === 'pause') delete fresh.position; return commit(op, fresh, true); }
          return;
        }
        toast(e.message);
        poll();
      }
    }

    // ----- polling -----
    let polling = false;
    let pollAgain = false;
    async function poll() {
      if (destroyed) return;
      if (polling) { pollAgain = true; return; }
      polling = true;
      clearTimeout(pollTimer);
      const s = !joined ? 'tap' : (pState() === 3 ? 'buf' : 'ok');
      try {
        const d = await api('GET', `?party=${encodeURIComponent(id)}&since=${encodeURIComponent(cursor)}&s=${s}`);
        if (destroyed) return;
        may = !!d.canControl;
        watchers = d.watchers || [];
        const first = !cursor;
        cursor = d.cursor || cursor;
        adopt(d.party);
        takeFeed(d.feed || [], first);
        renderWatchers();
      } catch (e) {
        if (e.status === 404 || e.status === 403) { polling = false; showGone(e.message); return; }
      } finally {
        polling = false;
      }
      if (destroyed) return;
      const wait = pollAgain ? 0 : document.visibilityState === 'hidden' ? HIDDEN_POLL_MS : (Date.now() < fastUntil ? FAST_POLL_MS : POLL_MS);
      pollAgain = false;
      clearTimeout(pollTimer);
      pollTimer = setTimeout(poll, wait);
    }

    function showGone(message) {
      destroyed = true;
      clearTimeout(pollTimer);
      clearInterval(tickTimer);
      try { if (player) player.destroy(); } catch (e) { /* ignore */ }
      el.innerHTML = `<div class="cw-gone">${icon('tv', 44)}<h2>${esc(message)}</h2>${embedded ? '' : `<a class="cw-btn cw-primary" href="/watch/">${icon('play', 16)}<span>Start a watch party</span></a>`}</div>`;
    }

    // ----- feed: chat + reactions -----
    function takeFeed(items, first) {
      const now = serverNow();
      let newChat = false;
      for (const it of items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        if (it.t === 'r') {
          if (it.by !== myName() && now - it.at < 8000) float(it.k, it.by);
        } else if (it.t === 'c') {
          addMsg(it);
          if (!first && it.by !== myName()) newChat = true;
        }
      }
      if (newChat && tab !== 'chat') $('[data-tab=chat] .cw-badge', el).hidden = false;
    }

    function addMsg(it) {
      const list = $('.cw-msgs', el);
      const empty = $('.cw-msgs-empty', list);
      if (empty) empty.remove();
      const t = new Date(it.at - clockOffset);
      const li = document.createElement('li');
      li.className = 'cw-msg' + (it.by === myName() ? ' mine' : '');
      li.dataset.id = it.id;
      li.innerHTML = `${avatar(it.by, 'sm')}<div><b>${esc(it.by)}</b><time>${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><p>${esc(it.text)}</p></div>`;
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      list.appendChild(li);
      while (list.children.length > 120) list.firstChild.remove();
      if (nearBottom || it.by === myName()) list.scrollTop = list.scrollHeight;
    }

    function float(k, by) {
      if (!ART[k]) return;
      const fx = $('.cw-fx', el);
      if (fx.children.length > 30) fx.firstChild.remove();
      const n = document.createElement('div');
      n.className = 'cw-float';
      const x = 55 + Math.random() * 38;
      n.style.left = `${x}%`;
      n.style.setProperty('--sway', `${(Math.random() * 40 - 20).toFixed(0)}px`);
      n.style.setProperty('--dur', `${(2.4 + Math.random() * 0.9).toFixed(2)}s`);
      n.innerHTML = art(k, embedded ? 34 : 44) + (by && by !== myName() ? `<span>${esc(by)}</span>` : '');
      fx.appendChild(n);
      n.addEventListener('animationend', () => n.remove());
    }

    async function react(k) {
      float(k, '');
      try {
        const { item } = await api('POST', '', { action: 'react', id, k });
        seen.add(item.id);
      } catch (e) { toast(e.message); }
    }

    async function say(text) {
      try {
        const { item } = await api('POST', '', { action: 'chat', id, text });
        if (!seen.has(item.id)) { seen.add(item.id); addMsg(item); }
      } catch (e) { toast(e.message); throw e; }
    }

    // ----- rendering -----
    function renderState() {
      const s = S();
      if (!s) return;
      const has = !!s.videoId;
      $('.cw-empty', el).hidden = has;
      $('.cw-join', el).hidden = !has || joined;
      const errBox = $('.cw-err', el);
      errBox.hidden = !failed;
      if (failed) { $('strong', errBox).textContent = failed; $('[data-a=next]', errBox).hidden = !may || !party.queue.length; }
      const playBtn = $('.cw-play', el);
      playBtn.innerHTML = icon(s.playing ? 'pause' : 'play', 22);
      playBtn.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      $('.cw-title', el).textContent = has ? s.title : 'Nothing playing yet';
      const host = may ? `Hosted by ${party.host}${party.host === myName() ? ' (you)' : ''}` : `${party.host} has the remote`;
      $('.cw-top-now', el).textContent = has ? s.title : (o.title || 'Watch party');
      $('.cw-by', el).textContent = has ? [s.channel, s.by && s.by !== 'auto' ? `put on by ${s.by}` : ''].filter(Boolean).join(' · ') || 'YouTube' : 'Add a video from the Up next tab';
      const hostEl = $('.cw-host', el);
      hostEl.textContent = host;
      hostEl.classList.toggle('locked', !may);
      $('.cw-rate', el).textContent = `${s.rate || 1}×`;
      $$('.cw-bar .cw-ctl', el).forEach((b) => {
        const a = b.dataset.a;
        if (a === 'mute') return;
        b.disabled = !may || !has || (a === 'next' && !party.queue.length);
      });
      seek.disabled = !may || !has;
      const lock = $('.cw-lock', el);
      lock.hidden = may;
      $('span', lock).textContent = 'View only';
      $('.cw-play', el).classList.toggle('on', !!s.playing);
      $('[data-a=mute]', el).innerHTML = icon(muted ? 'mute' : 'volume', 19);
      $('[data-a=mute]', el).setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute');
    }

    function renderTime() {
      const s = S();
      if (!s) return;
      const d = duration();
      const cur = s.videoId ? (dragging ? Number(seek.value) : clamp(localTime(), 0, d || Infinity)) : 0;
      $('.cw-cur', el).textContent = fmtTime(cur);
      $('.cw-dur', el).textContent = fmtTime(d);
      if (!dragging) {
        seek.max = String(Math.max(1, d));
        seek.value = String(cur);
      }
      seek.style.setProperty('--fill', `${d ? clamp(cur / d * 100, 0, 100) : 0}%`);
    }

    let queueSig = '';
    function renderQueue() {
      if (!party) return;
      const sig = JSON.stringify([party.queue.map((q) => q.qid), party.played.map((p) => p.videoId), may]);
      $('[data-tab=queue] .cw-count', el).textContent = party.queue.length ? String(party.queue.length) : '';
      if (sig === queueSig) return;
      queueSig = sig;
      $('[data-a=playnow]', el).hidden = !may;
      $('.cw-queue:not(.cw-played)', el).innerHTML = party.queue.length ? party.queue.map((q, i) => `
        <li class="cw-qi">${thumbImg(q.videoId)}<span class="cw-row-text"><strong>${esc(q.title)}</strong><small>${i === 0 ? 'Next · ' : ''}added by ${esc(q.by)}</small></span>
          <span class="cw-qa">${may && i > 0 ? `<button type="button" class="cw-mini" data-q="up" data-qid="${esc(q.qid)}" aria-label="Play this next">${icon('up', 16)}</button>` : ''}${may ? `<button type="button" class="cw-mini" data-q="play" data-qid="${esc(q.qid)}" aria-label="Play this now">${icon('play', 16)}</button>` : ''}${may || q.by === myName() ? `<button type="button" class="cw-mini" data-q="remove" data-qid="${esc(q.qid)}" aria-label="Remove from the queue">${icon('trash', 16)}</button>` : ''}</span></li>`).join('')
        : '<li class="cw-none">The queue is empty. Add a video and it plays when this one ends.</li>';
      const played = party.played || [];
      $('.cw-played-h', el).hidden = !played.length;
      $('.cw-played', el).innerHTML = played.map((p) => `<li class="cw-qi">${thumbImg(p.videoId)}<span class="cw-row-text"><strong>${esc(p.title)}</strong></span><span class="cw-qa"><button type="button" class="cw-mini" data-again="${esc(p.videoId)}" aria-label="Add again">${icon('plus', 16)}</button></span></li>`).join('');
    }

    function statusText(w) {
      if (w.s === 'tap') return 'Hasn’t tapped in yet';
      if (w.s === 'buf') return 'Loading…';
      return 'Watching';
    }
    function renderWatchers() {
      const top = $('.cw-top-avs', el);
      const shown = watchers.slice(0, embedded ? 4 : 6);
      top.innerHTML = shown.map((w) => avatar(w.name, `sm s-${w.s}`)).join('') + (watchers.length > shown.length ? `<span class="cw-av sm more">+${watchers.length - shown.length}</span>` : '');
      top.setAttribute('aria-label', `${watchers.length} watching: ${watchers.map((w) => w.name).join(', ')}`);
      $('[data-tab=people] .cw-count', el).textContent = watchers.length ? String(watchers.length) : '';
      renderPeople();
    }
    let peopleSig = '';
    function renderPeople() {
      if (!party) return;
      const sig = JSON.stringify([watchers.map((w) => [w.name, w.s]), party.host, party.anyone, may]);
      if (sig === peopleSig) return;
      peopleSig = sig;
      $('.cw-people', el).innerHTML = watchers.length ? watchers.map((w) => `<li>${avatar(w.name, `s-${w.s}`)}<span class="cw-row-text"><strong>${esc(w.name)}${w.name === myName() ? ' (you)' : ''}</strong><small>${statusText(w)}</small></span>${w.name === party.host ? `<span class="cw-pill gold">${icon('crown', 13)}Host</span>` : ''}</li>`).join('') : '<li class="cw-none">Nobody else is here yet.</li>';
      const sw = $('.cw-anyone input', el);
      sw.checked = !!party.anyone;
      sw.disabled = party.host !== myName();
      $('.cw-anyone-hint', el).textContent = party.host === myName()
        ? (party.anyone ? 'Everyone can play, pause, skip and seek. Turn off to keep the remote yourself.' : 'Only you can control the video. Turn on to let everyone help.')
        : (party.anyone ? 'Everyone can play, pause, skip and seek.' : `Only ${party.host} can control the video.`);
    }

    async function renderInvites() {
      const box = $('.cw-invite', el);
      if (!box) return;
      const chats = await loadChats();
      box.innerHTML = chats.map((c) => `<button type="button" class="cw-chip" data-invite="${esc(c.id)}">${icon(c.dm ? 'chat' : 'group', 16)}<span>${esc(c.name)}</span></button>`).join('') || '<span class="cw-help">No chats found.</span>';
    }

    function setTab(t) {
      tab = t;
      $$('.cw-tabs [role=tab]', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
      $$('.cw-pane', el).forEach((p) => { p.hidden = p.dataset.pane !== t; });
      if (t === 'chat') { $('[data-tab=chat] .cw-badge', el).hidden = true; const l = $('.cw-msgs', el); l.scrollTop = l.scrollHeight; }
      if (t === 'people') renderInvites();
    }

    // ----- joining (the tap that lets the video play with sound) -----
    function join() {
      joined = true;
      muted = false;
      try {
        if (player && ready) {
          player.unMute();
          player.setVolume(100);
          const s = S();
          if (s && s.playing) { hardSeek(expected(s)); player.playVideo(); }
        }
      } catch (e) { /* ignore */ }
      renderState();
      poll();
      // Some phones only allow sound after a tap on the video itself: let the next tap through to it.
      setTimeout(() => {
        try {
          if (player && ready && player.isMuted && player.isMuted()) {
            toast('Tap the video once more to turn the sound on');
            const sh = $('.cw-shield', el);
            sh.classList.add('pass');
            setTimeout(() => sh.classList.remove('pass'), 6000);
          }
        } catch (e) { /* ignore */ }
      }, 900);
    }

    // ----- events -----
    el.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('.cw-join')) { join(); return; }
      const tb = t.closest('[data-tab]');
      if (tb) { setTab(tb.dataset.tab); return; }
      const rb = t.closest('.cw-react');
      if (rb) { rb.classList.remove('pop'); void rb.offsetWidth; rb.classList.add('pop'); react(rb.dataset.k); return; }
      const qb = t.closest('[data-q]');
      if (qb) {
        qb.disabled = true;
        try { adopt((await api('POST', '', { action: 'queue', id, op: qb.dataset.q, qid: qb.dataset.qid })).party); } catch (err) { toast(err.message); qb.disabled = false; }
        return;
      }
      const again = t.closest('[data-again]');
      if (again) {
        again.disabled = true;
        try { adopt((await api('POST', '', { action: 'queue', id, op: 'add', video: again.dataset.again })).party); toast('Added to the queue'); } catch (err) { toast(err.message); }
        again.disabled = false;
        return;
      }
      const inv = t.closest('[data-invite]');
      if (inv) {
        if (inv.classList.contains('on')) return;
        inv.disabled = true;
        try {
          const r = await api('POST', '', { action: 'invite', id, room: inv.dataset.invite });
          inv.classList.add('on');
          inv.querySelector('svg').outerHTML = icon('check', 16);
          toast(r.already ? 'Already invited a moment ago' : 'Invite sent');
        } catch (err) { toast(err.message); }
        inv.disabled = false;
        return;
      }
      if (t.closest('.cw-shield')) { el.classList.toggle('cw-show-bar'); return; }
      const b = t.closest('[data-a]');
      if (!b) return;
      const s = S();
      switch (b.dataset.a) {
        case 'toggle':
          if (!joined) join();
          if (s.playing) commit('pause', { position: localTime() });
          else commit('play', { position: s.duration && expected(s) >= s.duration - 0.5 ? 0 : localTime() });
          break;
        case 'back10': commit('seek', { position: Math.max(0, localTime() - 10) }); break;
        case 'fwd10': commit('seek', { position: Math.min(duration() || Infinity, localTime() + 10) }); break;
        case 'rate': commit('rate', { rate: RATES[(RATES.indexOf(s.rate || 1) + 1) % RATES.length] }); break;
        case 'next': commit('next'); break;
        case 'mute':
          if (!joined) { join(); break; }
          muted = !muted;
          try { if (muted) player.mute(); else { player.unMute(); player.setVolume(100); } } catch (err) { /* ignore */ }
          renderState();
          break;
        case 'invite': setTab('people'); $('.cw-side', el).scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
        case 'copy': {
          const ok = await copyText(`${location.origin}/watch/?p=${id}`);
          toast(ok ? 'Link copied' : `${location.origin}/watch/?p=${id}`);
          break;
        }
        case 'leave':
          destroyed = true;
          clearTimeout(pollTimer);
          clearInterval(tickTimer);
          try { if (player) player.pauseVideo(); } catch (err) { /* ignore */ }
          await leave();
          location.href = '/watch/';
          break;
        case 'close': if (o.onClose) o.onClose(); break;
        case 'playnow': addVideo(true); break;
        default: break;
      }
    });

    seek.addEventListener('input', () => { dragging = true; renderTime(); });
    seek.addEventListener('change', () => {
      dragging = false;
      commit('seek', { position: Number(seek.value) });
    });
    seek.addEventListener('pointerup', () => { if (dragging) { dragging = false; commit('seek', { position: Number(seek.value) }); } });

    $('.cw-say', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('.cw-say input', el);
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try { await say(text); } catch (err) { input.value = text; }
    });

    async function addVideo(now) {
      const input = $('.cw-add input', el);
      const p = parseYouTube(input.value);
      if (!p) { toast('Paste a YouTube link or video ID first'); input.focus(); return; }
      const btns = $$('.cw-add button', el);
      btns.forEach((x) => { x.disabled = true; });
      try {
        const typed = input.value;
        const d = await api('POST', '', { action: 'queue', id, op: 'add', video: p.id, t: p.t, playNow: !!now });
        if (input.value === typed) input.value = '';
        adopt(d.party);
        toast(now || d.party.state.videoId === p.id ? 'Playing now' : 'Added to the queue');
      } catch (err) { toast(err.message); }
      btns.forEach((x) => { x.disabled = false; });
    }
    $('.cw-add', el).addEventListener('submit', (e) => { e.preventDefault(); addVideo(false); });

    $('.cw-anyone input', el).addEventListener('change', async (e) => {
      try { adopt((await api('POST', '', { action: 'settings', id, anyone: e.target.checked })).party); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
    });

    const onVis = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', onVis);
    const onHide = () => { api('POST', '', { action: 'leave', id }, { keepalive: true }).catch(() => {}); };
    window.addEventListener('pagehide', onHide);

    function leave() {
      return api('POST', '', { action: 'leave', id }).catch(() => {});
    }

    // ----- the player -----
    function makePlayer() {
      loadYouTube().then((YT) => {
        if (destroyed) return;
        player = new YT.Player(`cw-player-${uid}`, {
          width: '100%', height: '100%',
          playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, mute: 1, autoplay: 0, origin: location.origin },
          events: {
            onReady: () => {
              ready = true;
              try { player.mute(); } catch (e) { /* ignore */ }
              tick();
            },
            onStateChange: () => { tick(); },
            onError: (e) => {
              const code = Number(e && e.data);
              failed = code === 101 || code === 150 ? 'This video’s owner doesn’t allow it to play outside YouTube.' : code === 100 ? 'This video is private or was removed.' : 'This video can’t be played here.';
              renderState();
            }
          }
        });
      }).catch((e) => {
        failed = e.message;
        $('.cw-err', el).hidden = false;
        $('.cw-err strong', el).textContent = e.message;
      });
    }

    // ----- start -----
    $('.cw-msgs', el).innerHTML = '<li class="cw-msgs-empty">Say hi! Messages here stay in this watch party.</li>';
    api('POST', '', { action: 'join', id, s: 'tap' }).catch(() => {});
    makePlayer();
    poll();
    tickTimer = setInterval(tick, TICK_MS);

    const api_ = {
      id,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(pollTimer);
        clearInterval(tickTimer);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', onHide);
        leave();
        try { if (player) player.destroy(); } catch (e) { /* ignore */ }
        root.innerHTML = '';
      },
      // For tests and debugging.
      debug: () => ({ party, joined, coarse, offset: clockOffset, expected: expected(S()), local: localTime(), rate: setRateNow, ps: pState(), may })
    };
    root.__cw = api_;
    return api_;
  }

  async function meetParty(code) {
    const { party } = await api('POST', '', { action: 'meet', code });
    return party;
  }

  window.ChowWatch = { mountStart, mountParty, meetParty, parseYouTube, art };
})();
