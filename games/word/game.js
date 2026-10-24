// Daily Word: a five-letter word puzzle that is the same for the whole family each day (family time zone),
// plus endless practice words and a "Play together" race where everyone guesses the same practice word.
// Scoring (daily): 7 - guesses used (6 for a first-try solve ... 1 on the 6th try), 0 for a miss, once per day.
(function () {
  'use strict';

  const G = window.ChowGames;
  const { ANSWERS, GUESSES } = window.WORD_LISTS;
  const VALID = new Set(GUESSES.concat(ANSWERS));
  const TZ = 'America/New_York';
  const ROWS = 6;
  const LEN = 5;
  const FIRST_DAY = '2026-10-01';       // puzzle #1
  const CB_KEY = 'chowaniec_word_cb';
  const FLIP_MS = 260;                  // delay between tiles when a row turns over
  const PRAISE = ['Genius!', 'Amazing!', 'Brilliant!', 'Super!', 'Great job!', 'Phew, just in time!'];
  const RANK = { miss: 1, near: 2, hit: 3 };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // ---------- Days and answers ----------
  const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const familyDay = (d) => DAY_FMT.format(d || new Date());
  const dayNumber = (day) => { const [y, m, d] = day.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const puzzleNo = (day) => dayNumber(day) - dayNumber(FIRST_DAY) + 1;
  // A hash of the day string picks the starting point; stepping by a prime keeps the next ~3 years free of repeats.
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const OFFSET = hash('chowaniec-daily-word') % ANSWERS.length;
  const dailyAnswer = (day) => ANSWERS[(dayNumber(day) * 7919 + OFFSET) % ANSWERS.length];
  function randomAnswer(rand, avoid) {
    let w = ANSWERS[Math.floor(rand() * ANSWERS.length)];
    if (w === avoid) w = ANSWERS[(ANSWERS.indexOf(w) + 1) % ANSWERS.length];
    return w;
  }
  // Time until the next family-day starts (handles daylight-saving days).
  function msToNextDay() {
    const now = Date.now();
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    const today = familyDay(new Date(now));
    let t = now + (86400 - (Number(p.hour) % 24) * 3600 - Number(p.minute) * 60 - Number(p.second)) * 1000;
    for (let i = 0; i < 3 && familyDay(new Date(t)) === today; i++) t += 3600e3;
    for (let i = 0; i < 3 && familyDay(new Date(t - 3600e3)) !== today; i++) t -= 3600e3;
    return Math.max(0, t - now);
  }
  const clock = (ms) => { const s = Math.ceil(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':'); };

  // Wordle colouring, with repeated letters handled properly.
  function evaluate(guess, answer) {
    const res = Array(LEN).fill('miss');
    const left = {};
    for (let i = 0; i < LEN; i++) {
      if (guess[i] === answer[i]) res[i] = 'hit';
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < LEN; i++) {
      if (res[i] !== 'hit' && left[guess[i]]) { res[i] = 'near'; left[guess[i]] -= 1; }
    }
    return res;
  }

  // ---------- State ----------
  const S = {
    mode: 'daily',        // 'daily' | 'practice' | 'race'
    day: '', answer: '', guesses: [], cur: '', done: false, won: false, busy: false,
    remote: null,         // today's score saved from another device (no local board)
    submitted: false,
    race: null            // { players, colors, me }
  };
  let user = '';
  let el = {};
  let practiceWord = '';
  const dailyKey = (day) => `chowaniec_word_${encodeURIComponent(user)}_${day}`;
  const pointsFor = (won, n) => (won ? 7 - n : 0);

  function saveDaily() {
    if (S.mode !== 'daily') return;
    store.set(dailyKey(S.day), { answer: S.answer, guesses: S.guesses, done: S.done, won: S.won, submitted: S.submitted });
  }

  // ---------- Building the page ----------
  function build(root) {
    root.innerHTML = `<div class="wd">
      <div class="wd-top">
        <div class="wd-tabs" role="tablist">
          <button type="button" role="tab" data-mode="daily">${G.icon('calendar', 17)}<span>Today</span></button>
          <button type="button" role="tab" data-mode="practice">${G.icon('dice', 17)}<span>Practice</span></button>
        </div>
        <button type="button" class="wd-icon" data-act="results" aria-label="Today’s family results">${G.icon('users', 22)}</button>
        <button type="button" class="wd-icon" data-act="settings" aria-label="Settings">${G.icon('settings', 22)}</button>
      </div>
      <p class="wd-info"></p>
      <div class="wd-race"><h2>${G.icon('flag', 18)}<span>Word race!</span></h2><p>Same word for everyone. Fewest tries wins.</p><div class="wd-ghosts"></div></div>
      <div class="wd-boardwrap"><div class="wd-board" aria-label="Guesses"></div></div>
      <div class="wd-bottom">
        <div class="wd-kb" aria-label="Keyboard"></div>
        <div class="wd-done" aria-live="polite"></div>
      </div>
    </div>`;
    el = {
      wrap: $('.wd', root), info: $('.wd-info', root), board: $('.wd-board', root), kb: $('.wd-kb', root),
      done: $('.wd-done', root), boardwrap: $('.wd-boardwrap', root), ghosts: $('.wd-ghosts', root), race: $('.wd-race', root)
    };
    el.board.innerHTML = Array.from({ length: ROWS }, () => `<div class="wd-row">${'<div class="wd-tile"></div>'.repeat(LEN)}</div>`).join('');
    el.rows = Array.from(el.board.children);
    const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    el.kb.innerHTML = rows.map((r, i) => `<div class="kr">${i === 1 ? '<span class="wd-key spacer"></span>' : ''}${i === 2 ? '<button type="button" class="wd-key wide" data-k="enter">Enter</button>' : ''}` +
      r.split('').map((c) => `<button type="button" class="wd-key" data-k="${c}" aria-label="${c.toUpperCase()}">${c}</button>`).join('') +
      `${i === 2 ? '<button type="button" class="wd-key wide back" data-k="back" aria-label="Delete"><svg class="cg-ic" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><path d="m12 9 6 6"/><path d="m18 9-6 6"/></svg></button>' : ''}${i === 1 ? '<span class="wd-key spacer"></span>' : ''}</div>`).join('');
    el.keys = {};
    el.kb.querySelectorAll('[data-k]').forEach((b) => { el.keys[b.dataset.k] = b; });

    el.kb.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      b.blur();
      press(b.dataset.k);
    });
    $('.wd-tabs', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b || b.dataset.mode === S.mode) return;
      G.sfx('click');
      if (b.dataset.mode === 'daily') loadDaily(); else loadPractice(false);
    });
    $('[data-act="settings"]', root).addEventListener('click', openSettings);
    $('[data-act="results"]', root).addEventListener('click', () => showResults());
    el.done.addEventListener('click', onDoneClick);
    window.addEventListener('resize', fit);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(el.boardwrap);
  }

  // Tile size: as big as fits the space between the top strip and the keyboard.
  function fit() {
    if (!el.boardwrap) return;
    const w = el.boardwrap.clientWidth - 28;
    const h = el.boardwrap.clientHeight - 12;
    const gap = Math.max(4, Math.min(7, Math.round(h / 70)));
    const size = Math.max(30, Math.floor(Math.min((w - gap * (LEN - 1)) / LEN, (h - gap * (ROWS - 1)) / ROWS, 68)));
    el.board.style.setProperty('--wd-size', size + 'px');
    el.board.style.setProperty('--wd-gap', gap + 'px');
  }

  // ---------- Drawing ----------
  function paintAll() {
    S.guesses.forEach((g, r) => paintRow(r, g, evaluate(g, S.answer)));
    for (let r = S.guesses.length; r < ROWS; r++) paintRow(r, r === S.guesses.length ? S.cur : '', null);
    paintKeys();
  }

  function paintRow(r, word, states) {
    const tiles = el.rows[r].children;
    for (let i = 0; i < LEN; i++) {
      const t = tiles[i];
      t.textContent = word[i] || '';
      t.classList.remove('typed', 'flip', 'jump');
      t.classList.toggle('filled', !states && !!word[i]);
      if (states) t.dataset.s = states[i]; else delete t.dataset.s;
    }
  }

  function paintKeys() {
    const best = {};
    S.guesses.forEach((g) => evaluate(g, S.answer).forEach((s, i) => { if (!best[g[i]] || RANK[s] > RANK[best[g[i]]]) best[g[i]] = s; }));
    Object.entries(el.keys).forEach(([k, b]) => { if (best[k]) b.dataset.s = best[k]; else delete b.dataset.s; });
  }

  function info() {
    if (S.mode === 'daily') el.info.innerHTML = `<b>Puzzle #${puzzleNo(S.day)}</b> · same word for the whole family`;
    else if (S.mode === 'practice') el.info.innerHTML = '<b>Practice</b> · as many words as you like (no points)';
    else el.info.textContent = '';
    document.querySelectorAll('.wd-tabs [data-mode]').forEach((b) => { b.classList.toggle('on', b.dataset.mode === S.mode); b.setAttribute('aria-selected', b.dataset.mode === S.mode ? 'true' : 'false'); });
  }

  let msgTimer = null;
  function say(text) {
    let t = $('.wd-msg');
    if (!t) {
      t = document.createElement('div');
      t.className = 'wd-msg';
      t.setAttribute('role', 'status');
      Object.assign(t.style, { position: 'absolute', left: '50%', top: '8px', transform: 'translateX(-50%)', zIndex: 20, padding: '10px 16px', borderRadius: '14px', background: 'var(--cg-ink)', color: 'var(--cg-bg)', fontWeight: 700, fontSize: '16px', pointerEvents: 'none', transition: 'opacity .2s', whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,.25)' });
      el.boardwrap.style.position = 'relative';
      el.boardwrap.appendChild(t);
    }
    t.textContent = text;
    t.style.opacity = '1';
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { t.style.opacity = '0'; }, 1800);
  }

  function shake() {
    const row = el.rows[S.guesses.length];
    row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
    setTimeout(() => row.classList.remove('shake'), 520);
    G.sfx('wrong');
    if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { /* ignore */ }
  }

  // ---------- Input ----------
  function press(k) {
    if (S.done || S.busy || S.remote != null || G.modalOpen()) return;
    const r = S.guesses.length;
    if (k === 'enter') return submitGuess();
    if (k === 'back') {
      if (!S.cur) return;
      S.cur = S.cur.slice(0, -1);
      paintRow(r, S.cur, null);
      return;
    }
    if (!/^[a-z]$/.test(k) || S.cur.length >= LEN) return;
    S.cur += k;
    paintRow(r, S.cur, null);
    const t = el.rows[r].children[S.cur.length - 1];
    t.classList.remove('typed'); void t.offsetWidth; t.classList.add('typed');
    G.sfx('click');
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !el.board || G.modalOpen()) return;
    let k = null;
    if (e.key === 'Enter') k = 'enter';
    else if (e.key === 'Backspace' || e.key === 'Delete') k = 'back';
    else if (/^[a-zA-Z]$/.test(e.key)) k = e.key.toLowerCase();
    if (!k) return;
    e.preventDefault();
    const b = el.keys[k];
    if (b) { b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 110); }
    press(k);
  });

  function submitGuess() {
    const word = S.cur;
    if (word.length < LEN) { shake(); say('Not enough letters'); return; }
    if (!VALID.has(word)) { shake(); say('Not in the word list'); return; }
    const r = S.guesses.length;
    const states = evaluate(word, S.answer);
    S.guesses.push(word);
    S.cur = '';
    S.won = word === S.answer;
    S.done = S.won || S.guesses.length >= ROWS;
    S.busy = true;
    saveDaily();
    const mode = S.mode;
    const answer = S.answer;
    reveal(r, word, states, () => {
      if (S.mode !== mode || S.answer !== answer) return;   // switched games mid-flip
      S.busy = false;
      paintKeys();
      if (S.mode === 'race') raceUpdate();
      if (S.done) finish(true);
      else if (S.mode === 'daily') saveDaily();
    });
    if (S.mode === 'race') raceUpdate();
  }

  function reveal(r, word, states, then) {
    const tiles = el.rows[r].children;
    for (let i = 0; i < LEN; i++) {
      const t = tiles[i];
      setTimeout(() => {
        t.classList.remove('typed');
        t.classList.add('flip');
        G.sfx('flip');
      }, i * FLIP_MS);
      setTimeout(() => { t.dataset.s = states[i]; t.classList.remove('filled'); }, i * FLIP_MS + 250);
      setTimeout(() => t.classList.remove('flip'), i * FLIP_MS + 520);
    }
    setTimeout(then, (LEN - 1) * FLIP_MS + 560);
  }

  function celebrate(r) {
    const tiles = el.rows[r].children;
    for (let i = 0; i < LEN; i++) setTimeout(() => { tiles[i].classList.add('jump'); setTimeout(() => tiles[i].classList.remove('jump'), 650); }, i * 90);
    const colors = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (let i = 0; i < 36; i++) {
      const c = document.createElement('i');
      c.className = 'wd-confetti';
      const a = Math.random() * Math.PI * 2;
      const d = 120 + Math.random() * 200;
      c.style.setProperty('--dx', Math.cos(a) * d + 'px');
      c.style.setProperty('--dy', Math.sin(a) * d * 0.8 + 180 + 'px');
      c.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 120 + 'ms';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 1700);
    }
  }

  // ---------- Finishing ----------
  function finish(fresh) {
    const n = S.guesses.length;
    const score = pointsFor(S.won, n);
    if (fresh) {
      if (S.won) { celebrate(n - 1); G.sfx('win'); say(PRAISE[n - 1]); } else { G.sfx('lose'); say(S.answer.toUpperCase()); }
    }
    if (S.mode === 'race') {
      G.race.update({ score, alive: false, row: n, solved: S.won });
      G.race.finish(score, { row: n, solved: S.won });
      showDone();
      return;
    }
    showDone();
    if (S.mode === 'daily' && fresh) {
      saveDaily();
      submitDaily().then(() => setTimeout(() => { if (S.mode === 'daily' && S.done) showResults(); }, S.won ? 900 : 500));
    }
  }

  async function submitDaily() {
    if (S.submitted) return;
    const day = S.day;
    const score = pointsFor(S.won, S.guesses.length);
    const res = await G.submitScore(score);
    if (S.day !== day) return;
    if (res) { S.submitted = true; saveDaily(); return; }
    // null = already played today (409, e.g. on another device) or a network problem: ask the server.
    const today = await fetchToday();
    if (today && today.today.some((r) => r.name === user)) { S.submitted = true; saveDaily(); }
  }

  function showDone() {
    el.wrap.classList.add('finished');
    const n = S.guesses.length;
    let html = '';
    el.wrap.classList.toggle('remote', S.mode === 'daily' && S.remote != null);
    if (S.mode === 'daily' && S.remote != null) {
      html = `<h2>You’ve played today’s word</h2><p>${S.remote ? `Solved in ${7 - S.remote}/6 · ${S.remote} point${S.remote === 1 ? '' : 's'}` : 'Not this time (X/6)'} on another device.</p>` +
        `<div class="wd-btns"><button type="button" class="primary" data-act="results">${G.icon('users', 19)}<span>Family results</span></button><button type="button" data-act="practice">${G.icon('dice', 19)}<span>Practice</span></button></div>`;
    } else if (S.mode === 'daily') {
      const pts = pointsFor(S.won, n);
      html = `<h2>${S.won ? `Solved in ${n}/6!` : 'So close!'}</h2><p>${S.won ? `+${pts} point${pts === 1 ? '' : 's'} for the family leaderboard` : `The word was <span class="ans">${S.answer.toUpperCase()}</span>`}</p>` +
        `<div class="wd-btns three"><button type="button" class="primary" data-act="results">${G.icon('users', 18)}<span>Results</span></button><button type="button" data-act="share">${G.icon('share', 18)}<span>Share</span></button><button type="button" data-act="practice">${G.icon('dice', 18)}<span>Practice</span></button></div>`;
    } else if (S.mode === 'practice') {
      html = `<h2>${S.won ? `Got it in ${n}!` : 'Nice try!'}</h2><p>The word was <span class="ans">${S.answer.toUpperCase()}</span></p>` +
        `<div class="wd-btns"><button type="button" class="primary" data-act="again">${G.icon('dice', 19)}<span>New word</span></button><button type="button" data-act="daily">${G.icon('calendar', 19)}<span>Today’s word</span></button></div>`;
    } else {
      html = `<h2>${S.won ? `Solved in ${n}!` : 'Out of tries!'}</h2><p>The word was <span class="ans">${S.answer.toUpperCase()}</span> · ${pointsFor(S.won, n)} point${pointsFor(S.won, n) === 1 ? '' : 's'}</p>` +
        '<p class="wd-next">Race points don’t count towards today’s puzzle.</p>';
    }
    if (S.mode === 'daily') html += `<p class="wd-next">Next word in <b class="wd-countdown">${clock(msToNextDay())}</b></p>`;
    el.done.innerHTML = html;
  }

  function hideDone() { el.wrap.classList.remove('finished', 'remote'); el.done.innerHTML = ''; }

  function onDoneClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    G.sfx('click');
    const a = b.dataset.act;
    if (a === 'results') showResults();
    else if (a === 'share') share();
    else if (a === 'practice' || a === 'again') loadPractice(true);
    else if (a === 'daily') loadDaily();
  }

  // ---------- Sharing ----------
  function shareText() {
    const cb = document.body.classList.contains('wd-cb');
    const sq = { hit: cb ? '🟧' : '🟩', near: cb ? '🟦' : '🟨', miss: '⬛' };
    const rows = S.guesses.map((g) => evaluate(g, S.answer).map((s) => sq[s]).join(''));
    return `🔤 Daily Word #${puzzleNo(S.day)} ${S.won ? S.guesses.length : 'X'}/6\n\n${rows.join('\n')}`;
  }

  async function share() {
    const text = shareText();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0' });
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (e2) { ok = false; }
    }
    G.toast(ok ? 'Copied! Paste it in a family chat.' : 'Couldn’t copy. Try again.');
  }

  // ---------- Family results ----------
  async function fetchToday() {
    try {
      const u = window.getChowaniecUser ? window.getChowaniecUser() : null;
      const res = await fetch('/.netlify/functions/games?board=word', { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Chowaniec-Key': (u && u.key) || '' } });
      if (!res.ok) return null;
      const data = await res.json();
      data.today = data.today || [];
      return data;
    } catch (e) { return null; }
  }

  function gridHtml() {
    return '<div class="wd-grid" aria-hidden="true">' + S.guesses.map((g) => '<div class="gr">' + evaluate(g, S.answer).map((s) => `<i class="${s}"></i>`).join('') + '</div>').join('') + '</div>';
  }

  async function showResults() {
    const day = S.mode === 'daily' ? S.day : familyDay();
    const mine = S.mode === 'daily' && S.done;
    const n = S.guesses.length;
    let head;
    if (mine) head = `<h2>${S.won ? `Solved in ${n}/6!` : `The word was ${esc(S.answer.toUpperCase())}`}</h2><p class="cg-sub">Daily Word #${puzzleNo(day)}</p>${gridHtml()}<p class="wd-pts">${S.won ? `+${pointsFor(true, n)} point${pointsFor(true, n) === 1 ? '' : 's'}` : 'No points this time. Try again tomorrow!'}</p>`;
    else if (S.remote != null) head = `<h2>Today’s word</h2><p class="cg-sub">Daily Word #${puzzleNo(day)}</p>`;
    else head = `<h2>Today’s word</h2><p class="cg-sub">Daily Word #${puzzleNo(day)} · finish it to see how you compare</p>`;
    const card = G.modal(`<div class="wd-card">${head}<h3>Today in the family</h3><div class="wd-fam"><p class="cg-empty">Loading…</p></div>` +
      `<p class="cg-sub">Next word in <b class="wd-countdown">${clock(msToNextDay())}</b></p>` +
      `<div class="cg-row">${mine ? `<button type="button" class="primary" data-x="share">${G.icon('share', 18)} Share to chat</button>` : ''}<button type="button" data-x="practice">${G.icon('dice', 18)} Practice</button><button type="button"${mine ? '' : ' class="primary"'} data-cg="close">Close</button></div></div>`, { wide: true });
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'share') share();
      if (b.dataset.x === 'practice') { G.closeModal(); loadPractice(true); }
    });
    const data = await fetchToday();
    const box = card.querySelector('.wd-fam');
    if (!box || !card.isConnected) return;
    if (!data) { box.innerHTML = '<p class="cg-empty">Couldn’t load the family’s results. Check your connection.</p>'; return; }
    const rows = data.today.slice().sort((a, b) => b.score - a.score || (a.at < b.at ? -1 : 1));
    box.innerHTML = rows.length
      ? '<ol class="cg-list">' + rows.map((r, i) => `<li class="${r.name === user ? 'mine' : ''}"><span class="m">${r.score ? `<span class="cg-rank${i < 3 ? ` r${i + 1}` : ''}">${i + 1}</span>` : `<span class="cg-rank wd-x">${G.icon('close', 13)}</span>`}</span><span class="n">${esc(r.name)}${r.name === user ? ' (you)' : ''}</span><span class="s">${r.score ? `${7 - r.score}/6` : 'X/6'}<small>${r.score} pt${r.score === 1 ? '' : 's'}</small></span></li>`).join('') + '</ol>'
      : '<p class="cg-empty">Nobody has played today yet. Be the first!</p>';
  }

  // ---------- Settings ----------
  function setCb(on) {
    document.body.classList.toggle('wd-cb', !!on);
    store.set(CB_KEY, !!on);
  }
  function openSettings() {
    G.sfx('click');
    const on = document.body.classList.contains('wd-cb');
    const card = G.modal(`<div class="cg-hero">${G.icon('settings', 26)}</div><h2>Settings</h2>` +
      `<label class="wd-switch"><span>Colour-blind colours<small>Orange for the right spot, blue for the wrong spot <span class="wd-swatch"><i style="background:#f0782f"></i><i style="background:#4f9fe8"></i></span></small></span><input type="checkbox" id="wd-cb"${on ? ' checked' : ''}></label>` +
      '<div class="cg-row"><button type="button" class="primary" data-cg="close">Done</button></div>');
    card.querySelector('#wd-cb').addEventListener('change', (e) => setCb(e.target.checked));
  }

  // ---------- Games ----------
  function reset(answer) {
    S.answer = answer;
    S.guesses = [];
    S.cur = '';
    S.done = false;
    S.won = false;
    S.busy = false;
    S.remote = null;
    S.submitted = false;
    hideDone();
    el.rows.forEach((r) => r.classList.remove('shake'));
  }

  function loadDaily() {
    stopRace();
    S.mode = 'daily';
    S.day = familyDay();
    reset(dailyAnswer(S.day));
    const saved = store.get(dailyKey(S.day));
    if (saved && saved.answer === S.answer && Array.isArray(saved.guesses)) {
      S.guesses = saved.guesses.filter((g) => typeof g === 'string' && g.length === LEN).slice(0, ROWS);
      S.won = S.guesses.includes(S.answer);
      S.done = S.won || S.guesses.length >= ROWS;
      S.submitted = !!saved.submitted;
    }
    info();
    paintAll();
    if (S.done) {
      showDone();
      if (!S.submitted) submitDaily();
      return;
    }
    // Played already on another device? Then show that result instead of a fresh board.
    const day = S.day;
    fetchToday().then((data) => {
      if (!data || S.mode !== 'daily' || S.day !== day || S.done) return;
      const row = data.today.find((r) => r.name === user);
      if (!row) return;
      S.remote = Number(row.score) || 0;
      S.cur = '';
      paintAll();
      showDone();
    });
  }

  function loadPractice(fresh) {
    stopRace();
    S.mode = 'practice';
    if (fresh || !practiceWord) practiceWord = randomAnswer(Math.random, dailyAnswer(familyDay()));
    reset(practiceWord);
    info();
    paintAll();
  }

  // ---------- Race (Play together) ----------
  let ghostTimer = null;
  function raceUpdate() {
    const n = S.guesses.length;
    G.race.update({ score: pointsFor(S.won, n), alive: !S.done, row: n, solved: S.won });
  }
  function stopRace() {
    clearInterval(ghostTimer);
    ghostTimer = null;
    el.wrap.classList.remove('racing');
    el.race.style.minHeight = '';
  }
  function drawGhosts() {
    const others = G.race.others();
    el.ghosts.innerHTML = others.map((o) => {
      const st = o.state || {};
      const used = Math.min(ROWS, Number(st.row) || 0);
      const dots = Array.from({ length: ROWS }, (_, i) => `<i class="${i < used ? (st.solved && i === used - 1 ? 'w' : 'u') : ''}"></i>`).join('');
      return `<div class="wd-ghost"><i style="width:9px;height:9px;border-radius:50%;background:${esc(o.color)};flex:none"></i><span class="nm">${esc(o.name)}</span><span class="dots">${dots}</span>${st.solved ? `<span class="ok">${G.icon('check', 15)}</span>` : (st.alive === false ? G.icon('flag', 14) : '')}</div>`;
    }).join('');
  }
  G.on('multiStart', (info) => {
    G.closeModal();
    S.mode = 'race';
    S.race = info;
    reset(randomAnswer(G.rng(info.seed), dailyAnswer(familyDay())));
    el.wrap.classList.add('racing');
    // Room on the right for the core's live scoreboard (one line per player).
    el.race.style.minHeight = Math.max(64, 14 + 24 * (info.players || []).length) + 'px';
    paintAll();
    raceUpdate();
    drawGhosts();
    clearInterval(ghostTimer);
    ghostTimer = setInterval(drawGhosts, 500);
    fit();
  });
  G.on('multiEnd', () => { if (S.mode === 'race') loadDaily(); fit(); });

  // ---------- Clock ----------
  setInterval(() => {
    if (!el.board) return;
    const left = clock(msToNextDay());
    document.querySelectorAll('.wd-countdown').forEach((c) => { c.textContent = left; });
    if (S.mode === 'daily' && S.day && familyDay() !== S.day && !S.busy) {
      loadDaily();
      say('A new word is ready!');
    }
  }, 1000);

  // ---------- Mount ----------
  G.mount({
    id: 'word', title: 'Daily Word', mode: 'race', scoreLabel: 'points',
    help: '<p>Guess the secret <b>5-letter word</b> in 6 tries. Everyone in the family gets the <b>same word</b> each day.</p>' +
      '<p>Type a word and press <b>Enter</b>. The tiles change colour to help you:</p>' +
      '<div class="wd-ex"><div class="wd-tile" data-s="hit">c</div><div class="wd-tile">l</div><div class="wd-tile">o</div><div class="wd-tile">u</div><div class="wd-tile">d</div></div>' +
      '<p><b>Green</b> (orange in colour-blind mode): C is in the word, in the right spot.</p>' +
      '<div class="wd-ex"><div class="wd-tile">p</div><div class="wd-tile" data-s="near">i</div><div class="wd-tile">a</div><div class="wd-tile">n</div><div class="wd-tile">o</div></div>' +
      '<p><b>Yellow</b> (blue in colour-blind mode): I is in the word, but in another spot.</p>' +
      '<div class="wd-ex"><div class="wd-tile">s</div><div class="wd-tile">m</div><div class="wd-tile">i</div><div class="wd-tile" data-s="miss">l</div><div class="wd-tile">e</div></div>' +
      '<p><b>Grey</b>: L is not in the word.</p>' +
      '<ul><li>Points for the family leaderboard: 6 for a first-try solve, down to 1 on the last try.</li>' +
      '<li>You get one go at the daily word. <b>Practice</b> has endless words (no points).</li>' +
      '<li><b>Play together</b> races everyone on the same word.</li>' +
      `<li>Colour-blind colours are in ${G.icon('settings', 17)} <b>Settings</b>.</li></ul>`,
    onReady(ctx) {
      user = ctx.user;
      if (store.get(CB_KEY)) document.body.classList.add('wd-cb');
      build(ctx.root);
      fit();
      if (S.mode !== 'race') loadDaily();
      requestAnimationFrame(fit);
    }
  });
})();
