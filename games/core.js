// Chowaniec Games core: the shared frame every game page plugs into (window.ChowGames).
// It draws the top bar, keeps family high scores, shows the game-over card and leaderboard, and runs
// multiplayer: a lobby you can invite any group chat or DM to, a 3-2-1 countdown, live race scores
// (everyone plays the same course from the same seed) and shared boards for turn-based games.
// Talks to /.netlify/functions/games. See games/README.md for how a game uses it.
(function () {
  'use strict';

  const API = '/.netlify/functions/games';
  const RACE_SYNC_MS = 600;
  const LOBBY_POLL_MS = 1500;
  const TURN_POLL_MS = 1000;
  const MUTE_KEY = 'chowaniec_games_muted';
  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => { const u = window.getChowaniecUser ? window.getChowaniecUser() : null; return u && u.name ? u.name : ''; };
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let opts = null;
  let booted = false;
  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, ...args) { (listeners[evt] || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } }); }

  // ---------- API ----------
  async function api(method, query, body) {
    const u = window.getChowaniecUser ? window.getChowaniecUser() : null;
    const res = await fetch(API + (query || ''), {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'X-Chowaniec-Key': (u && u.key) || '' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
    return data;
  }

  // ---------- Seeded random numbers (same seed = same course for everyone) ----------
  function rng(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Sound effects (made on the fly, no files) ----------
  let audio = null;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* ignore */ }
  function unlockAudio() {
    try {
      if (!audio) { const C = window.AudioContext || window.webkitAudioContext; if (C) audio = new C(); }
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) { /* no sound */ }
  }
  ['pointerdown', 'keydown', 'touchend'].forEach((t) => window.addEventListener(t, unlockAudio, { capture: true, passive: true }));
  const SOUNDS = {
    jump: [['square', 520, 880, 0.12, 0.08]],
    flap: [['triangle', 420, 700, 0.09, 0.12]],
    coin: [['square', 988, 988, 0.07, 0.07], ['square', 1319, 1319, 0.18, 0.07, 0.07]],
    score: [['sine', 880, 880, 0.08, 0.1], ['sine', 1175, 1175, 0.12, 0.1, 0.08]],
    point: [['sine', 660, 990, 0.08, 0.08]],
    hit: [['sawtooth', 200, 60, 0.3, 0.16]],
    crash: [['sawtooth', 160, 40, 0.45, 0.18], ['square', 90, 40, 0.4, 0.08]],
    click: [['square', 700, 700, 0.03, 0.05]],
    tick: [['sine', 1200, 1200, 0.04, 0.06]],
    drop: [['triangle', 500, 160, 0.16, 0.14]],
    flip: [['triangle', 600, 900, 0.07, 0.08]],
    match: [['sine', 660, 660, 0.09, 0.1], ['sine', 880, 880, 0.09, 0.1, 0.09], ['sine', 1320, 1320, 0.16, 0.1, 0.18]],
    wrong: [['square', 240, 180, 0.18, 0.08]],
    win: [['square', 523, 523, 0.12, 0.08], ['square', 659, 659, 0.12, 0.08, 0.12], ['square', 784, 784, 0.12, 0.08, 0.24], ['square', 1047, 1047, 0.35, 0.08, 0.36]],
    lose: [['triangle', 392, 392, 0.18, 0.1], ['triangle', 330, 330, 0.18, 0.1, 0.2], ['triangle', 262, 196, 0.4, 0.1, 0.4]],
    go: [['square', 784, 784, 0.25, 0.1]],
    whoosh: [['sawtooth', 300, 900, 0.2, 0.04]]
  };
  function sfx(name) {
    if (muted || !SOUNDS[name]) return;
    unlockAudio();
    if (!audio || audio.state !== 'running') return;
    const t0 = audio.currentTime + 0.01;
    SOUNDS[name].forEach(([type, f1, f2, dur, vol, delay]) => {
      const t = t0 + (delay || 0);
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f1, t);
      if (f2 !== f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    });
  }
  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
    const b = $('#cg-mute');
    if (b) { b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on'); }
  }

  // ---------- Small UI pieces ----------
  let toastTimer = null;
  function toast(msg) {
    let t = $('#cg-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cg-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // A centred card over the game. Returns the card element; close with closeModal().
  function modal(html, { onClose, wide, sticky } = {}) {
    closeModal();
    const back = document.createElement('div');
    back.id = 'cg-modal';
    back.innerHTML = `<div class="cg-card${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    back.addEventListener('click', (e) => {
      if ((e.target === back && !sticky) || e.target.closest('[data-cg="close"]')) { closeModal(); if (onClose) onClose(); }
    });
    const first = back.querySelector('button.primary, button');
    if (first) setTimeout(() => first.focus(), 30);
    return back.querySelector('.cg-card');
  }
  function closeModal() { const m = $('#cg-modal'); if (m) m.remove(); }
  const modalOpen = () => !!$('#cg-modal');

  function medal(i) { return ['🥇', '🥈', '🥉'][i] || `${i + 1}.`; }

  // ---------- High scores ----------
  const unit = () => (opts && opts.scoreLabel) || 'points';

  async function submitScore(score) {
    try {
      return await api('POST', '', { action: 'score', game: opts.id, score: Math.round(score) });
    } catch (e) {
      if (e.status !== 409) toast('Couldn’t save your score: ' + e.message);
      return null;
    }
  }

  async function showLeaderboard() {
    const card = modal(`<h2>🏆 Family leaderboard</h2><p class="cg-sub">${esc(opts.title)}</p><div class="cg-board">Loading…</div><div class="cg-row"><button type="button" class="primary" data-cg="close">Close</button></div>`);
    try {
      const data = await api('GET', `?board=${encodeURIComponent(opts.id)}`);
      const rows = data.top || [];
      let html = rows.length
        ? '<ol class="cg-list">' + rows.map((r, i) => `<li class="${r.name === me() ? 'mine' : ''}"><span class="m">${medal(i)}</span><span class="n">${esc(r.name)}</span><span class="s">${fmt(r.score)}</span></li>`).join('') + '</ol>'
        : `<p class="cg-empty">No scores yet. Be the first!</p>`;
      if (data.today) {
        html += `<h3>Today</h3>` + (data.today.length ? '<ol class="cg-list">' + data.today.map((r, i) => `<li class="${r.name === me() ? 'mine' : ''}"><span class="m">${medal(i)}</span><span class="n">${esc(r.name)}</span><span class="s">${r.score ? `${7 - r.score}/6` : 'X/6'}</span></li>`).join('') + '</ol>' : '<p class="cg-empty">Nobody has played today yet.</p>');
      }
      const box = card.querySelector('.cg-board');
      if (box) box.innerHTML = html;
    } catch (e) {
      const box = card.querySelector('.cg-board');
      if (box) box.textContent = e.message;
    }
  }

  // ---------- Multiplayer ----------
  const multi = {
    session: null,       // the session we're in
    players: {},         // race: name -> { state, at, round }
    round: 0,            // the round we've started locally
    myState: null,
    finished: false,
    timer: null,
    resultsShown: false,
    lastVersion: 0
  };
  const inSession = () => !!multi.session;
  const isHost = () => !!multi.session && multi.session.host === me();
  const colorOf = (name) => {
    const list = multi.session ? multi.session.players : [];
    const i = Math.max(0, list.indexOf(name));
    return COLORS[i % COLORS.length];
  };
  const setUrl = (id) => {
    const u = new URL(location.href);
    if (id) u.searchParams.set('s', id); else u.searchParams.delete('s');
    history.replaceState(null, '', u.pathname + u.search);
  };
  const shareUrl = () => `${location.origin}/games/${opts.id}/?s=${multi.session.id}`;

  function stopTimer() { clearTimeout(multi.timer); multi.timer = null; }

  async function createSession(room) {
    const { session } = await api('POST', '', { action: 'create', game: opts.id, room: room || undefined });
    adopt(session);
    return session;
  }

  async function joinSession(id) {
    try {
      const { session } = await api('POST', '', { action: 'join', id });
      adopt(session);
      return session;
    } catch (e) {
      if (e.status === 409) {
        // Already started: watch (turn games) or join the next round.
        const { session } = await api('GET', `?session=${id}`);
        adopt(session);
        toast(e.message);
        return session;
      }
      setUrl(null);
      throw e;
    }
  }

  function adopt(session) {
    multi.session = session;
    multi.round = 0;     // a round already running (e.g. after a reload) is picked up by the next tick
    multi.lastVersion = session.version;
    setUrl(session.id);
    document.body.classList.add('cg-multi');
    renderBarState();
    tick();
  }

  async function leaveSession() {
    const s = multi.session;
    stopTimer();
    multi.session = null;
    multi.players = {};
    multi.round = 0;
    multi.finished = false;
    document.body.classList.remove('cg-multi');
    hideRaceBoard();
    closeModal();
    setUrl(null);
    renderBarState();
    if (s) api('POST', '', { action: 'leave', id: s.id }).catch(() => {});
    emit('multiEnd');
  }

  // Accepts a session read from the server, unless we left meanwhile or it's older than what we already
  // have (a poll that started before our own move finished). Returns false if we left.
  function take(fresh) {
    const cur = multi.session;
    if (!cur || cur.id !== fresh.id) return false;
    if (fresh.round < cur.round || (fresh.round === cur.round && fresh.version < cur.version)) return true;
    multi.session = fresh;
    return true;
  }

  // One heartbeat: refresh the session, start rounds, sync race states, pick up moves.
  async function tick() {
    stopTimer();
    const s = multi.session;
    if (!s) return;
    let wait = LOBBY_POLL_MS;
    try {
      if (opts.mode === 'race' && s.status === 'playing' && multi.round === s.round && multi.myState) {
        const data = await api('POST', '', { action: 'sync', id: s.id, state: multi.myState, round: s.round });
        if (!take(data.session)) return;
        multi.players = data.players || {};
        wait = RACE_SYNC_MS;
      } else {
        const data = await api('GET', `?session=${s.id}`);
        if (!take(data.session)) return;
        multi.players = data.players || {};
        wait = opts.mode === 'turns' && data.session.status === 'playing' ? TURN_POLL_MS : (multi.round && data.session.status === 'playing' ? RACE_SYNC_MS : LOBBY_POLL_MS);
      }
    } catch (e) {
      if (e.status === 404) { toast(e.message); leaveSession(); return; }
      wait = 3000;
    }
    if (!multi.session) return;
    react();
    if (multi.session) multi.timer = setTimeout(tick, document.visibilityState === 'visible' ? wait : Math.max(wait, 4000));
  }

  function react() {
    const s = multi.session;
    renderBarState();
    if (s.status === 'playing' && s.round !== multi.round && s.players.includes(me())) {
      beginRound(s);
      return;
    }
    if (opts.mode === 'turns' && s.status !== 'lobby' && s.round && s.round !== multi.round && !s.players.includes(me())) {
      // Watching a game you couldn't join: show the board (info.myIndex is -1, so no moves).
      multi.round = s.round;
      multi.lastVersion = s.version;
      closeModal();
      emit('multiStart', Object.assign(turnInfo(), { seed: s.seed, shared: s.shared }));
      emit('shared', s.shared, turnInfo());
    }
    if (opts.mode === 'turns' && s.round === multi.round && s.version !== multi.lastVersion) {
      multi.lastVersion = s.version;
      emit('shared', s.shared, turnInfo());
    }
    if (opts.mode === 'race' && multi.round === s.round) {
      renderRaceBoard();
      if (multi.finished) renderResults();
    }
    if (isLobbyOpen()) renderLobby();
  }

  function turnInfo() {
    const s = multi.session;
    return { players: s.players.slice(), me: me(), myIndex: s.players.indexOf(me()), host: s.host, round: s.round, seed: s.seed, version: s.version, colors: s.players.map(colorOf), status: s.status };
  }

  // Countdown to the shared start time, then hand over to the game.
  async function beginRound(s) {
    multi.round = s.round;
    multi.finished = false;
    multi.resultsShown = false;
    multi.myState = null;
    multi.players = {};
    multi.lastVersion = s.version;
    closeModal();
    const late = Date.parse(s.startAt) - Date.now() < -2000;
    if (!late) {
      const cd = document.createElement('div');
      cd.id = 'cg-countdown';
      document.body.appendChild(cd);
      for (;;) {
        const left = Math.ceil((Date.parse(s.startAt) - Date.now()) / 1000);
        if (left <= 0) break;
        if (cd.textContent !== String(left)) { cd.textContent = String(left); cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop'); sfx('tick'); }
        await sleep(100);
        if (!multi.session || multi.session.round !== s.round) { cd.remove(); return; }
      }
      cd.textContent = 'Go!';
      cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
      sfx('go');
      setTimeout(() => cd.remove(), 650);
    }
    const info = Object.assign(turnInfo(), { seed: s.seed, shared: s.shared });
    if (opts.mode === 'race') {
      multi.myState = { score: 0, alive: true };
      renderRaceBoard();
    }
    emit('multiStart', info);
    if (opts.mode === 'turns') emit('shared', s.shared, turnInfo());
    tick();
  }

  // ----- races -----
  function raceUpdate(state) {
    if (!inSession() || multi.finished) return;
    multi.myState = Object.assign({ alive: true }, state);
  }

  function raceOthers() {
    if (!inSession()) return [];
    const round = multi.session.round;
    return Object.entries(multi.players)
      .filter(([name, p]) => name !== me() && p && p.round === round && p.state)
      .map(([name, p]) => ({ name, color: colorOf(name), state: p.state, age: Date.now() - p.at }));
  }

  function raceStandings() {
    const s = multi.session;
    const rows = s.players.map((name) => {
      const p = name === me() ? { state: multi.myState } : multi.players[name];
      const st = p && p.state && (name === me() || p.round === s.round) ? p.state : null;
      return { name, color: colorOf(name), score: st ? Number(st.score) || 0 : 0, alive: st ? st.alive !== false : true, started: !!st };
    });
    return rows.sort((a, b) => b.score - a.score);
  }

  function renderRaceBoard() {
    if (!inSession() || opts.mode !== 'race') return;
    let el = $('#cg-race');
    if (!el) { el = document.createElement('div'); el.id = 'cg-race'; el.setAttribute('aria-live', 'off'); document.body.appendChild(el); }
    el.innerHTML = raceStandings().map((r) => `<div class="r${r.name === me() ? ' me' : ''}${r.alive ? '' : ' out'}"><i style="background:${r.color}"></i><b>${esc(r.name)}</b><span>${fmt(r.score)}</span>${r.alive ? '' : '<em>🏁</em>'}</div>`).join('');
  }
  function hideRaceBoard() { const el = $('#cg-race'); if (el) el.remove(); }

  async function raceFinish(score, extra) {
    if (!inSession() || multi.finished) return;
    multi.finished = true;
    multi.myState = Object.assign({}, multi.myState, extra || {}, { score: Math.round(score), alive: false, done: true });
    try {
      const data = await api('POST', '', { action: 'sync', id: multi.session.id, state: multi.myState, round: multi.session.round });
      multi.players = data.players || {};
    } catch (e) { /* the next tick retries */ }
    renderRaceBoard();
    renderResults();
  }

  function renderResults() {
    const s = multi.session;
    const rows = raceStandings();
    const allDone = rows.every((r) => !r.alive || !r.started) && rows.some((r) => r.started);
    const html = `<h2>${allDone ? (rows[0].name === me() ? '🏆 You win!' : `🏆 ${esc(rows[0].name)} wins!`) : 'Waiting for the others…'}</h2>` +
      '<ol class="cg-list">' + rows.map((r, i) => `<li class="${r.name === me() ? 'mine' : ''}"><span class="m">${allDone ? medal(i) : (r.alive ? '🏃' : '🏁')}</span><span class="n"><i class="dot" style="background:${r.color}"></i>${esc(r.name)}</span><span class="s">${fmt(r.score)}</span></li>`).join('') + '</ol>' +
      `<div class="cg-row">${isHost() ? `<button type="button" class="primary" data-cg="again"${allDone ? '' : ' disabled'}>Play again</button>` : `<span class="cg-wait">${allDone ? `Waiting for ${esc(s.host)} to start again…` : ''}</span>`}<button type="button" data-cg="leave">Leave</button></div>`;
    let card = $('#cg-modal .cg-card.results');
    if (!card) {
      card = modal(html);
      card.classList.add('results');
      card.addEventListener('click', onResultsClick);
    } else card.innerHTML = html;
    if (allDone && !multi.resultsShown) {
      multi.resultsShown = true;
      sfx(rows[0].name === me() ? 'win' : 'score');
    }
  }
  async function onResultsClick(e) {
    const b = e.target.closest('button[data-cg]');
    if (!b) return;
    if (b.dataset.cg === 'again') { b.disabled = true; await startRound(); }
    if (b.dataset.cg === 'leave') leaveSession();
  }

  // ----- turn games -----
  async function commit(shared, { done } = {}) {
    if (!inSession()) return false;
    try {
      const { session } = await api('POST', '', { action: 'move', id: multi.session.id, version: multi.session.version, shared, done: !!done });
      multi.session = session;
      multi.lastVersion = session.version;
      return true;
    } catch (e) {
      if (e.status === 409 && e.data && e.data.session) {
        multi.session = e.data.session;
        multi.lastVersion = e.data.session.version;
        emit('shared', multi.session.shared, turnInfo());
        toast('Someone else moved first.');
      } else toast(e.message);
      return false;
    }
  }

  // ----- lobby -----
  async function startRound() {
    try {
      const s = multi.session;
      const body = { action: 'start', id: s.id };
      if (opts.mode === 'turns' && opts.initialShared) body.shared = opts.initialShared(s.players.slice(), Math.floor(Math.random() * 2 ** 31));
      const { session } = await api('POST', '', body);
      multi.session = session;
      react();
    } catch (e) { toast(e.message); }
  }

  let chats = null;
  const isLobbyOpen = () => !!$('#cg-modal .cg-card.lobby');

  async function openLobby() {
    unlockAudio();
    if (!inSession()) {
      const card = modal(`<h2>👥 Play together</h2><p class="cg-sub">${esc(opts.title)} · ${opts.mode === 'turns' ? `${opts.minPlayers || 2}${(opts.maxPlayers || 2) > (opts.minPlayers || 2) ? `–${opts.maxPlayers}` : ''} players, take turns` : 'Everyone plays the same course at the same time'}</p>` +
        '<p>Start a game, then send the link to a chat. Anyone who taps it joins you here.</p>' +
        '<div class="cg-row"><button type="button" data-cg="close">Cancel</button><button type="button" class="primary" data-cg="create">Start a game</button></div>');
      card.querySelector('[data-cg="create"]').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Starting…';
        try { await createSession(); openLobby(); } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Start a game'; }
      });
      return;
    }
    const card = modal('<div class="lobby-body"></div>', { wide: true });
    card.classList.add('lobby');
    card.addEventListener('click', onLobbyClick);
    renderLobby();
    if (!chats) {
      try { chats = (await api('GET', '?chats=1')).chats; } catch (e) { chats = []; }
      renderLobby();
    }
  }

  function renderLobby() {
    const card = $('#cg-modal .cg-card.lobby');
    if (!card || !multi.session) return;
    const s = multi.session;
    const min = opts.mode === 'turns' ? (opts.minPlayers || 2) : 1;
    const max = opts.maxPlayers || 8;
    const enough = s.players.length >= min;
    const invited = s.invitedTo || [];
    const chatButtons = (chats || []).map((c) => `<button type="button" class="chip${invited.includes(c.id) ? ' on' : ''}" data-cg="invite" data-room="${esc(c.id)}">${invited.includes(c.id) ? '✓ ' : ''}${c.dm ? '💬 ' : '👪 '}${esc(c.name)}</button>`).join('');
    const playing = s.status === 'playing' && s.round === multi.round;
    card.querySelector('.lobby-body').innerHTML =
      `<h2>${esc(opts.emoji || '🎮')} ${esc(opts.title)}</h2><p class="cg-sub">${playing ? 'Game in progress' : `Lobby · ${s.players.length}/${max} players`}</p>` +
      '<div class="cg-players">' + s.players.map((n) => `<span class="pl"><i style="background:${colorOf(n)}"></i>${esc(n)}${n === s.host ? ' <small>host</small>' : ''}</span>`).join('') + '</div>' +
      `<h3>Invite</h3><p class="cg-hint">Tap a chat to send everyone there a “Join game” link and a notification.</p><div class="cg-chips">${chats ? chatButtons || '<span class="cg-hint">No chats found.</span>' : '<span class="cg-hint">Loading chats…</span>'}</div>` +
      `<div class="cg-row"><button type="button" data-cg="copy">Copy link</button></div>` +
      '<div class="cg-row lobby-actions">' +
      (isHost()
        ? `<button type="button" data-cg="leave">Leave</button><button type="button" class="primary" data-cg="start"${enough ? '' : ' disabled'}>${enough ? (s.round ? 'Start next round' : 'Start the game') : `Waiting for ${min - s.players.length} more…`}</button>`
        : `<button type="button" data-cg="leave">Leave</button><span class="cg-wait">Waiting for ${esc(s.host)} to start…</span>`) +
      '</div>';
  }

  async function onLobbyClick(e) {
    const b = e.target.closest('button[data-cg]');
    if (!b) return;
    const act = b.dataset.cg;
    if (act === 'invite') {
      if (b.classList.contains('on')) return;
      b.disabled = true;
      try {
        await api('POST', '', { action: 'invite', id: multi.session.id, room: b.dataset.room });
        multi.session.invitedTo = (multi.session.invitedTo || []).concat(b.dataset.room);
        toast('Invite sent!');
        renderLobby();
      } catch (err) { toast(err.message); b.disabled = false; }
    } else if (act === 'copy') {
      try { await navigator.clipboard.writeText(shareUrl()); toast('Link copied'); } catch (err) { prompt('Copy this link:', shareUrl()); }
    } else if (act === 'start') {
      b.disabled = true;
      await startRound();
    } else if (act === 'leave') {
      leaveSession();
    }
  }

  // ---------- Game over ----------
  // Solo: saves the score and shows it with the family record. Race: reports your finish and shows the
  // live results. Turn games: pass { title, score } (score 0 = nothing to save).
  async function gameOver({ score = 0, title, detail, again } = {}) {
    if (inSession() && opts.mode === 'race') {
      await raceFinish(score);
      submitScore(score);
      return;
    }
    if (inSession() && opts.mode === 'turns') {
      if (score > 0) submitScore(score);
      const card = modal(`<h2>${esc(title || 'Game over')}</h2>${detail ? `<p class="cg-sub">${esc(detail)}</p>` : ''}` +
        `<div class="cg-row">${isHost() ? '<button type="button" class="primary" data-cg="again">Play again</button>' : `<span class="cg-wait">Waiting for ${esc(multi.session.host)} to start again…</span>`}<button type="button" data-cg="leave">Leave</button></div>`, { sticky: true });
      card.addEventListener('click', onResultsClick);
      return;
    }
    const card = modal(`<h2>${esc(title || 'Game over')}</h2><div class="cg-score">${fmt(score)}<small>${esc(unit())}</small></div><p class="cg-best">Saving…</p>` +
      '<div class="cg-row col"><button type="button" class="primary" data-cg="again">Play again</button>' +
      '<button type="button" data-cg="family">👥 Challenge the family</button><button type="button" data-cg="board">🏆 Leaderboard</button></div>', { onClose: again });
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cg]');
      if (!b) return;
      if (b.dataset.cg === 'again') { closeModal(); if (again) again(); }
      if (b.dataset.cg === 'family') openLobby();
      if (b.dataset.cg === 'board') showLeaderboard();
    });
    const result = score > 0 ? await submitScore(score) : null;
    const best = card.querySelector('.cg-best');
    if (!best) return;
    if (!result) { best.textContent = score > 0 ? '' : 'Keep trying!'; return; }
    if (result.isRecord && result.rank === 1 && result.total > 1) { best.innerHTML = '🎉 <b>New family record!</b>'; sfx('win'); }
    else if (result.isRecord) best.innerHTML = `⭐ <b>New personal best!</b> You’re #${result.rank} in the family.`;
    else best.textContent = `Your best: ${fmt(result.best)} · #${result.rank} in the family`;
  }

  // ---------- Frame ----------
  function renderBarState() {
    const b = $('#cg-together');
    if (!b) return;
    b.classList.toggle('on', inSession());
    b.innerHTML = inSession() ? `👥 <span>${multi.session.players.length}</span>` : '👥 <span>Play together</span>';
  }

  function help() {
    modal(`<h2>${esc(opts.emoji || '')} How to play</h2><div class="cg-help">${opts.help || ''}</div><div class="cg-row"><button type="button" class="primary" data-cg="close">Got it</button></div>`);
  }

  function frame() {
    const root = document.getElementById('app-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'app-root' }));
    root.classList.add('cg-app');
    root.innerHTML = `<header class="cg-bar"><a class="cg-back" href="/games/" aria-label="All games">‹</a>` +
      `<h1><span aria-hidden="true">${esc(opts.emoji || '🎮')}</span> ${esc(opts.title)}</h1>` +
      '<button type="button" id="cg-help" aria-label="How to play">?</button>' +
      '<button type="button" id="cg-board" aria-label="Leaderboard">🏆</button>' +
      `<button type="button" id="cg-mute" aria-label="${muted ? 'Sound off' : 'Sound on'}">${muted ? '🔇' : '🔊'}</button>` +
      '<button type="button" id="cg-together" class="cg-together">👥 <span>Play together</span></button></header>' +
      '<main id="cg-stage"></main>';
    $('#cg-help').addEventListener('click', help);
    $('#cg-board').addEventListener('click', showLeaderboard);
    $('#cg-mute').addEventListener('click', () => setMuted(!muted));
    $('#cg-together').addEventListener('click', openLobby);
    document.title = `${opts.title} · Chowaniec Games`;
    return $('#cg-stage');
  }

  let stage = null;
  async function boot() {
    if (booted || !opts) return;
    booted = true;
    if (!stage) stage = frame();
    const ctx = { root: stage, user: me(), seed: Math.floor(Math.random() * 2 ** 31) };
    if (opts.onReady) opts.onReady(ctx);
    const sid = new URLSearchParams(location.search).get('s');
    if (sid && /^[a-f0-9]{10}$/.test(sid)) {
      try { await joinSession(sid); openLobby(); } catch (e) { toast(e.message); }
    }
  }

  function mount(o) {
    opts = Object.assign({ mode: 'race', minPlayers: 1, maxPlayers: 8, scoreLabel: 'points' }, o);
    const ready = () => {
      if (!stage) stage = frame();
      if (window.isAppAuthorized && window.isAppAuthorized()) boot();
    };
    window.initializeProtectedContent = boot;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
    else ready();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') emit('pause');
    else { emit('resume'); if (inSession()) tick(); }
  });

  window.ChowGames = {
    mount, on, rng, sfx, toast, modal, closeModal, modalOpen, gameOver, submitScore, showLeaderboard, openLobby,
    me, colors: COLORS,
    isMulti: () => inSession() && multi.round > 0 && multi.session.round === multi.round,
    session: () => multi.session,
    muted: () => muted,
    race: { update: raceUpdate, finish: raceFinish, others: raceOthers, standings: () => (inSession() ? raceStandings() : []) },
    turns: { shared: () => (multi.session ? multi.session.shared : null), info: () => (multi.session ? turnInfo() : null), commit }
  };
})();
