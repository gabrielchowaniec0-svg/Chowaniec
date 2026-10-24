// Trivia Party: a family quiz show. Ten questions a round, 15 seconds each, four colourful answers.
// Points: 500 for a right answer + up to 500 for speed + a streak bonus (100 per answer in a row after the
// first, up to 500). Solo: pick topics and difficulty. Play together (race): everyone gets the same ten
// questions from the round's seed, on a shared clock (question i opens at t0 + i × 19 s), and after
// each question sees who got it right and the live scores.
// Family Edition: the AI writes the questions about the family itself (see netlify/functions/trivia-ai.mjs).
// In a family race the host's device fetches them and sends them to everyone in info.shared; the reveal is
// longer (6.5 s) so there's time to read the fun fact.
(function () {
  'use strict';

  const G = window.ChowGames;
  const { CATEGORIES, QUESTIONS } = window.TRIVIA;

  const ROUND = 10;
  const Q_MS = 15000;               // time to answer
  const REV_MS = 4000;              // reveal + scores (multiplayer)
  const LEAD_MS = 2600;             // the opening wheel spin before question 1 (multiplayer)
  const SOLO_SPIN_MS = 1500;
  const SOLO_HOLD_MS = 650;         // the wheel rests on the topic for a moment
  const SOLO_REV_MS = 3000;
  const LOCK_MS = 450;              // solo: a beat between locking in and the reveal
  const END_DELAY_MS = 3800;        // multiplayer: how long the podium shows before the results card
  const SETUP_KEY = 'chowaniec_trivia_setup';
  const SEEN_KEY = 'chowaniec_trivia_seen';
  const PLAYED_KEY = 'chowaniec_trivia_family_played';
  const FAMILY_API = '/.netlify/functions/trivia-ai';
  const FAMILY_REV_MS = 6500;       // multiplayer reveal when the question has a fun fact to read
  const FAMILY_SOLO_REV_MS = 5200;
  const MAX_SHARED = 19000;         // the core keeps info.shared under 20 KB

  const CAT_STYLE = {
    animals: { color: '#f97316', icon: 'cat' },
    space: { color: '#6366f1', icon: 'rocket' },
    geo: { color: '#0d9488', icon: 'globe' },
    food: { color: '#ef4444', icon: 'apple' },
    music: { color: '#ec4899', icon: 'music' },
    sports: { color: '#0284c7', icon: 'medal' },
    history: { color: '#b45309', icon: 'landmark' },
    nature: { color: '#16a34a', icon: 'leaf' },
    art: { color: '#9333ea', icon: 'palette' },
    brain: { color: '#ca8a04', icon: 'lightbulb' }
  };
  const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, Object.assign({}, c, CAT_STYLE[c.id])]));
  const ALL_CATS = CATEGORIES.map((c) => c.id);
  // Family Edition: the wheel shows where each question came from. Bonus = a regular question used to fill up.
  const FAMILY_CATS = [
    { id: 'fam-chat', name: 'Family chat', color: '#0ea5e9', icon: 'chat', tag: 'From the family chat' },
    { id: 'fam-calendar', name: 'Calendar', color: '#f43f5e', icon: 'calendar', tag: 'From the calendar' },
    { id: 'fam-note', name: 'Shared notes', color: '#f59e0b', icon: 'note', tag: 'From a shared note' },
    { id: 'fam-general', name: 'Family fun', color: '#16a34a', icon: 'heart', tag: 'Family fun' },
    { id: 'fam-bonus', name: 'Bonus question', color: '#8b5cf6', icon: 'star', tag: 'Bonus question' }
  ];
  FAMILY_CATS.forEach((c) => { CAT[c.id] = c; });
  const FAM_IDS = FAMILY_CATS.map((c) => c.id);
  const SRC_CAT = { chat: 'fam-chat', calendar: 'fam-calendar', note: 'fam-note', general: 'fam-general' };
  const DIFFS = [
    { id: 'easy', name: 'Easy', tip: 'Great for younger players' },
    { id: 'medium', name: 'Medium', tip: 'A little bit trickier' },
    { id: 'hard', name: 'Hard', tip: 'For trivia experts' },
    { id: 'mixed', name: 'Mixed', tip: 'Starts easy, ends hard' }
  ];
  const ANS = [
    { color: '#e21b3c', shape: '<path d="M12 3.2 21.6 20.2H2.4z"/>', name: 'Triangle' },
    { color: '#1368ce', shape: '<path d="M12 2.2 21.8 12 12 21.8 2.2 12z"/>', name: 'Diamond' },
    { color: '#c98a00', shape: '<circle cx="12" cy="12" r="9.6"/>', name: 'Circle' },
    { color: '#26890c', shape: '<rect x="3" y="3" width="18" height="18" rx="2.5"/>', name: 'Square' }
  ];
  const KEYS = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // ---------- Icons ----------
  // Topic art the core doesn't have (Lucide paths, ISC licence), drawn the same way as ChowGames.icon.
  const EXTRA = {
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    landmark: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>',
    note: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h5"/>'
  };
  function ic(name, size) {
    if (!EXTRA[name]) return G.icon(name, size);
    const px = size || 20;
    return `<svg class="cg-ic" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXTRA[name]}</svg>`;
  }
  const shape = (k, size) => `<svg class="tv-shape" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">${ANS[k].shape}</g></svg>`;
  const catBadge = (id, size) => `<span class="tv-cb" style="background:${CAT[id].color};width:${size}px;height:${size}px">${ic(CAT[id].icon, Math.round(size * 0.6))}</span>`;

  // Quizzy, the show's host: a cheerful round fellow with a party hat, bow tie and microphone.
  let hostN = 0;
  function hostSvg() {
    const n = ++hostN;
    return `<svg class="tv-host-svg" viewBox="0 0 140 150" aria-hidden="true">
      <defs>
        <linearGradient id="tvHostBody${n}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde047"/><stop offset="1" stop-color="#f472b6"/></linearGradient>
        <linearGradient id="tvHostHat${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#6366f1"/></linearGradient>
      </defs>
      <ellipse cx="70" cy="142" rx="38" ry="6" fill="rgba(0,0,0,.14)"/>
      <g class="tv-host-hat"><path d="M52 40 70 4 88 40z" fill="url(#tvHostHat${n})"/><path d="M58 28 82 28M62 18 78 18" stroke="#fde68a" stroke-width="4" stroke-linecap="round"/><circle cx="70" cy="5" r="6" fill="#f472b6"/></g>
      <circle cx="70" cy="84" r="50" fill="url(#tvHostBody${n})"/>
      <ellipse cx="50" cy="58" rx="16" ry="10" fill="#fff" opacity=".35" transform="rotate(-25 50 58)"/>
      <g class="tv-host-eyes">
        <ellipse cx="53" cy="76" rx="11" ry="12.5" fill="#fff"/><ellipse cx="87" cy="76" rx="11" ry="12.5" fill="#fff"/>
        <circle class="tv-pupil" cx="55" cy="78" r="6" fill="#1e1b4b"/><circle class="tv-pupil" cx="89" cy="78" r="6" fill="#1e1b4b"/>
        <circle cx="57" cy="75" r="2.2" fill="#fff"/><circle cx="91" cy="75" r="2.2" fill="#fff"/>
      </g>
      <circle cx="40" cy="96" r="7" fill="#fb7185" opacity=".45"/><circle cx="100" cy="96" r="7" fill="#fb7185" opacity=".45"/>
      <path class="tv-m tv-m-happy" d="M56 98 Q70 114 84 98" fill="none" stroke="#1e1b4b" stroke-width="5" stroke-linecap="round"/>
      <ellipse class="tv-m tv-m-wow" cx="70" cy="104" rx="8" ry="10" fill="#1e1b4b"/>
      <path class="tv-m tv-m-oops" d="M58 108 Q70 99 82 108" fill="none" stroke="#1e1b4b" stroke-width="5" stroke-linecap="round"/>
      <g class="tv-host-bow"><path d="M70 130 52 120 52 140z M70 130 88 120 88 140z" fill="#7c3aed"/><circle cx="70" cy="130" r="5.5" fill="#a78bfa"/></g>
      <g class="tv-host-mic">
        <rect x="113" y="92" width="8" height="34" rx="4" fill="#3f3f46" transform="rotate(18 117 109)"/>
        <circle cx="122" cy="86" r="11" fill="#a1a1aa"/><path d="M114 82h16M113 87h18M115 92h14" stroke="#71717a" stroke-width="1.6"/>
        <circle cx="112" cy="112" r="9" fill="#fbbf24"/>
      </g>
    </svg>`;
  }

  // ---------- Questions ----------
  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function diffPlan(diff) {
    if (diff === 'easy' || diff === 'medium' || diff === 'hard') return Array(ROUND).fill(diff);
    return ['easy', 'easy', 'easy', 'medium', 'medium', 'medium', 'medium', 'hard', 'hard', 'hard'];
  }
  function cleanSetup(s) {
    const cats = s && Array.isArray(s.cats) ? s.cats.filter((c) => CAT[c]) : [];
    const diff = s && DIFFS.some((d) => d.id === s.diff) ? s.diff : 'mixed';
    return { cats: cats.length ? Array.from(new Set(cats)) : ALL_CATS.slice(), diff, family: !!(s && s.family) };
  }
  // Ten questions for a setup. With the same rand (seed) and setup every device gets the same list, with
  // the answers in the same order. `avoid` (solo only) holds recently seen ids, used only when possible.
  function pickQuestions(rand, setup, avoid) {
    const plan = diffPlan(setup.diff);
    let order = [];
    while (order.length < ROUND) order = order.concat(shuffle(setup.cats, rand));
    const used = new Set();
    const fresh = (q) => !used.has(q.id);
    const out = [];
    for (let i = 0; i < ROUND; i++) {
      const d = plan[i], cat = order[i];
      const tiers = [
        (q) => q.cat === cat && q.d === d,
        (q) => setup.cats.includes(q.cat) && q.d === d,
        (q) => setup.cats.includes(q.cat),
        () => true
      ];
      let pool = [];
      for (const t of tiers) {
        pool = QUESTIONS.filter((q) => t(q) && fresh(q));
        if (avoid && pool.length) { const f = pool.filter((q) => !avoid.has(q.id)); if (f.length) pool = f; }
        if (pool.length) break;
      }
      const q = pool[Math.floor(rand() * pool.length)];
      used.add(q.id);
      const idx = shuffle([0, 1, 2, 3], rand);
      out.push({ id: q.id, cat: q.cat, d: q.d, q: q.q, a: idx.map((k) => q.a[k]), c: idx.indexOf(q.c) });
    }
    return out;
  }
  const setupLabel = (s) => s.family ? `Family Edition · ${DIFFS.find((d) => d.id === s.diff).name}` : `${DIFFS.find((d) => d.id === s.diff).name} · ${s.cats.length === ALL_CATS.length ? 'All topics' : s.cats.length <= 2 ? s.cats.map((c) => CAT[c].name).join(' & ') : `${s.cats.length} topics`}`;

  // ---------- Family Edition: questions the AI writes from what the players already share ----------
  // The server (netlify/functions/trivia-ai.mjs) only reads the group chats every player is in, those chats'
  // calendar events and notes shared with the whole family. Never direct messages or private notes.
  const userKey = () => { const u = window.getChowaniecUser ? window.getChowaniecUser() : null; return (u && u.key) || ''; };
  const playedBatches = () => new Set(store.get(PLAYED_KEY) || []);
  function markPlayed(id) {
    if (!id) return;
    const list = (store.get(PLAYED_KEY) || []).filter((x) => x !== id);
    list.push(id);
    store.set(PLAYED_KEY, list.slice(-40));
  }
  const DIFF_IDS = ['easy', 'medium', 'hard'];
  const validQ = (q) => !!q && typeof q.q === 'string' && !!q.q.trim() && Array.isArray(q.a) && q.a.length === 4 &&
    q.a.every((x) => typeof x === 'string' && x.trim()) && Number.isInteger(q.c) && q.c >= 0 && q.c < 4;
  // Tops a short list up to ten with regular questions (shown as "Bonus question").
  function padFamily(qs, diff, rand) {
    let out = qs.slice(0, ROUND);
    if (out.length < ROUND) {
      const extra = pickQuestions(rand, { cats: ALL_CATS, diff }, null).slice(out.length);
      out = out.concat(extra.map((q) => Object.assign({}, q, { cat: 'fam-bonus', f: '' })));
    }
    return out;
  }
  async function askFamily(body, signal) {
    let res, data = {};
    try {
      res = await fetch(FAMILY_API, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { 'X-Chowaniec-Key': userKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      return { error: 'Couldn’t reach the question writer.' };
    }
    if (!res.ok) return { error: data.error || 'The question writer had a problem.' };
    return data;
  }
  // Ten questions about the family for `players`: { qs, batch, notice } or { error }.
  async function familyQuestions(players, diff, signal) {
    const body = { players, count: ROUND, difficulty: diff };
    let data = await askFamily(body, signal);
    // Already played today's batch for these chats: ask for a new one.
    if (data.id && playedBatches().has(data.id)) data = await askFamily(Object.assign({ fresh: true }, body), signal);
    if (data.error) return { error: data.error };
    if (!Array.isArray(data.questions) || !data.questions.length) return { error: data.notice || 'There wasn’t enough to write about.' };
    const qs = data.questions.map((x, k) => ({
      id: `fam-${data.id}-${k}`, cat: SRC_CAT[x.source] || 'fam-general', d: DIFF_IDS.includes(x.difficulty) ? x.difficulty : 'medium',
      q: String(x.q || ''), a: Array.isArray(x.answers) ? x.answers.map(String) : [], c: Number(x.correct), f: String(x.fact || '')
    })).filter(validQ);
    if (!qs.length) return { error: 'The questions came back empty.' };
    return { qs: padFamily(qs, diff, Math.random), batch: data.id, notice: data.notice || '' };
  }
  // What the host sends to everyone (info.shared), kept under the core's 20 KB limit.
  function packFamily(diff, fam) {
    const qs = fam.qs.map((q) => ({ q: q.q, a: q.a, c: q.c, d: q.d, cat: q.cat, f: q.f || '' }));
    const shared = { family: true, diff, batch: fam.batch, notice: String(fam.notice || '').slice(0, 200), qs };
    for (let max = 200; JSON.stringify(shared).length > MAX_SHARED && max >= 0; max -= 50) qs.forEach((q) => { q.f = q.f.slice(0, max); });
    return JSON.stringify(shared).length > MAX_SHARED ? null : shared;
  }
  function unpackFamily(sh, diff, rand) {
    const qs = (Array.isArray(sh.qs) ? sh.qs : []).map((x, k) => ({
      id: `fam-${String(sh.batch || 'x').slice(0, 20)}-${k}`, cat: FAM_IDS.includes(x && x.cat) ? x.cat : 'fam-bonus',
      d: DIFF_IDS.includes(x && x.d) ? x.d : 'medium', q: String((x && x.q) || ''),
      a: x && Array.isArray(x.a) ? x.a.map(String) : [], c: Number(x && x.c), f: String((x && x.f) || '')
    })).filter(validQ);
    return qs.length ? padFamily(qs, diff, rand) : null;
  }

  const WRITING_STEPS = ['Reading your shared chats…', 'Peeking at the family calendar…', 'Flipping through shared notes…', 'Thinking up tricky answers…', 'Adding a sprinkle of fun…'];
  function writingHtml() {
    return `<div class="tv-writing" role="status" aria-live="polite">
      <div class="tv-wr-art" aria-hidden="true">
        <span class="tv-wr-card c1"></span><span class="tv-wr-card c2"></span>
        <span class="tv-wr-card c3"><b>?</b><i></i><i></i><i></i></span>
        <span class="tv-wr-wand">${ic('wand', 34)}</span>
        <span class="tv-wr-sp s1">${ic('sparkles', 20)}</span><span class="tv-wr-sp s2">${ic('sparkles', 15)}</span><span class="tv-wr-sp s3">${ic('star', 13)}</span>
      </div>
      <h2>Writing questions about your family…</h2>
      <p class="tv-wr-step in">${WRITING_STEPS[0]}</p>
      <div class="tv-wr-dots"><i></i><i></i><i></i></div>
    </div>`;
  }
  // Cycles the little status line; returns a stop function.
  function runWriting(box) {
    const step = $('.tv-wr-step', box);
    let k = 0;
    const t = setInterval(() => {
      k = (k + 1) % WRITING_STEPS.length;
      step.classList.remove('in'); void step.offsetWidth;
      step.textContent = WRITING_STEPS[k];
      step.classList.add('in');
    }, 1900);
    return () => clearInterval(t);
  }

  // ---------- Setup picker (menu, and the host's round setup) ----------
  function setupHtml(s) {
    return `<div class="tv-setup">
      <div class="tv-lbl"><span>Difficulty</span></div>
      <div class="tv-seg" role="radiogroup" aria-label="Difficulty">${DIFFS.map((d, i) => `<button type="button" role="radio" data-diff="${d.id}" aria-checked="${s.diff === d.id}" class="${s.diff === d.id ? 'on' : ''}"><span class="tv-pips">${d.id === 'mixed' ? ic('shuffle', 14) : '<i></i>'.repeat(i + 1)}</span>${d.name}</button>`).join('')}</div>
      <p class="tv-tip">${esc(DIFFS.find((d) => d.id === s.diff).tip)}</p>
      <div class="tv-lbl"><span>Topics</span><button type="button" class="tv-link" data-all>${s.family ? 'Regular topics' : s.cats.length === ALL_CATS.length ? 'Clear' : 'Select all'}</button></div>
      <button type="button" class="tv-fam${s.family ? ' on' : ''}" data-family aria-pressed="${s.family}">
        <span class="tv-fam-ic">${ic('sparkles', 24)}<i>${ic('users', 13)}</i></span>
        <span class="tv-fam-tx"><b>Family Edition</b><small>Questions about your own family, from the chats, calendar and notes you share</small></span>
        <em>${G.icon('check', 14)}</em>
      </button>
      <div class="tv-cats${s.family ? ' muted' : ''}">${CATEGORIES.map((c) => `<button type="button" class="tv-cat${s.cats.includes(c.id) ? ' on' : ''}" data-cat="${c.id}" aria-pressed="${s.cats.includes(c.id)}" style="--c:${CAT[c.id].color}">${catBadge(c.id, 30)}<span>${esc(c.name)}</span><em>${G.icon('check', 14)}</em></button>`).join('')}</div>
    </div>`;
  }
  // Wires up a picker inside `box`; `s` is updated in place, onChange re-renders.
  function bindSetup(box, s, onChange) {
    box.addEventListener('click', (e) => {
      const d = e.target.closest('[data-diff]');
      const c = e.target.closest('[data-cat]');
      const all = e.target.closest('[data-all]');
      const fam = e.target.closest('[data-family]');
      if (d) { s.diff = d.dataset.diff; }
      else if (fam) { s.family = !s.family; }
      else if (all) {
        if (s.family) s.family = false;
        else if (s.cats.length === ALL_CATS.length) s.cats = [ALL_CATS[0]]; else s.cats = ALL_CATS.slice();
      } else if (c) {
        const id = c.dataset.cat;
        if (s.family) { s.family = false; if (!s.cats.includes(id)) s.cats = ALL_CATS.filter((x) => x === id || s.cats.includes(x)); }
        else if (s.cats.includes(id)) {
          if (s.cats.length === 1) { G.toast('Pick at least one topic'); G.sfx('wrong'); return; }
          s.cats = s.cats.filter((x) => x !== id);
        } else s.cats = ALL_CATS.filter((x) => x === id || s.cats.includes(x));
      } else return;
      G.sfx('click');
      onChange();
    });
  }

  // ---------- Page ----------
  let el = {};
  let user = '';
  let setup = cleanSetup(store.get(SETUP_KEY));
  let R = null;            // the round being played
  let raf = 0;
  let wheelAngle = 0;
  let wheelIds = ALL_CATS; // the slices on the wheel (topics, or Family Edition sources)
  let writingAbort = null; // solo Family Edition: the request being written

  function build(root) {
    root.innerHTML = `<div class="tv">
      <div class="tv-bg" aria-hidden="true"><i class="tv-beam b1"></i><i class="tv-beam b2"></i><i class="tv-beam b3"></i><div class="tv-dots"></div></div>
      <section class="tv-menu" aria-label="Trivia Party">
        <div class="tv-menu-in">
          <div class="tv-stage">
            <div class="tv-host" data-mood="happy">${hostSvg()}</div>
            <div class="tv-bubble" aria-live="polite"><span class="tv-say"></span></div>
          </div>
          <h2 class="tv-title" aria-label="Trivia Party">${'Trivia'.split('').map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('')}<span class="sp"></span>${'Party'.split('').map((ch, i) => `<span style="--i:${i + 7}">${ch}</span>`).join('')}</h2>
          <p class="tv-tag">${G.icon('timer', 15)}<span>10 questions · 15 seconds · speed bonus</span></p>
          <div class="tv-setupbox"></div>
          <div class="tv-actions">
            <button type="button" class="tv-btn primary" data-act="family">${G.icon('users', 22)}<span>Play with the family</span></button>
            <button type="button" class="tv-btn" data-act="play">${G.icon('play', 18)}<span>Practice alone</span></button>
          </div>
        </div>
      </section>
      <section class="tv-play" hidden>
        <div class="tv-hud">
          <div class="tv-hud-l">
            <div class="tv-qno"><span>Question </span><b>1</b>/${ROUND}</div>
            <div class="tv-chip tv-catchip"></div>
            <span class="tv-streak" hidden>${G.icon('flame', 16)}<b>0</b></span>
          </div>
          <div class="tv-hud-r">
            <span class="tv-score" aria-label="Score"><b>0</b><small>points</small></span>
            <button type="button" class="tv-quit" aria-label="Back to the menu">${G.icon('home', 20)}</button>
          </div>
        </div>
        <div class="tv-progress" aria-hidden="true">${'<i></i>'.repeat(ROUND)}</div>
        <div class="tv-card">
          <div class="tv-ring" aria-hidden="true"><svg viewBox="0 0 64 64"><circle class="tr-bg" cx="32" cy="32" r="27"/><circle class="tr-fg" cx="32" cy="32" r="27"/></svg><b>15</b></div>
          <div class="tv-diff"></div>
          <div class="tv-qtext" aria-live="polite"></div>
          <div class="tv-fact" hidden></div>
        </div>
        <div class="tv-mid"><div class="tv-status" aria-live="polite"></div><div class="tv-banner" aria-live="assertive"></div></div>
        <div class="tv-answers">${ANS.map((a, k) => `<button type="button" class="tv-ans" data-k="${k}" style="--a:${a.color}" aria-label="${a.name}">${shape(k, 30)}<span class="tx"></span><kbd>${k + 1}</kbd><span class="who"></span><span class="mark"></span></button>`).join('')}</div>
        <div class="tv-sheet" aria-live="polite"></div>
        <div class="tv-wheelwrap" hidden>
          <p class="tv-wh-top"></p>
          <div class="tv-wheel"><div class="tv-pointer"></div><svg class="tv-wheel-svg" viewBox="-100 -100 200 200" aria-hidden="true"></svg><div class="tv-hub">${G.icon('sparkles', 26)}</div></div>
          <p class="tv-wh-label"></p>
          <p class="tv-wh-note" hidden></p>
        </div>
      </section>
      <section class="tv-end" hidden></section>
      <div class="tv-wrwrap" hidden><div class="tv-wrwrap-in">${writingHtml()}<button type="button" class="tv-btn" data-act="cancel-writing">${G.icon('close', 18)}<span>Cancel</span></button></div></div>
      <div class="tv-pause" hidden><div class="tv-pause-card">${G.icon('pause', 30)}<h3>Paused</h3><button type="button" class="tv-btn primary" data-act="resume">${G.icon('play', 18)}<span>Keep playing</span></button></div></div>
      <canvas class="tv-fx" aria-hidden="true"></canvas>
    </div>`;
    el = {
      wrap: $('.tv', root), menu: $('.tv-menu', root), play: $('.tv-play', root), end: $('.tv-end', root),
      setupbox: $('.tv-setupbox', root), say: $('.tv-say', root), host: $('.tv-host', root),
      qno: $('.tv-qno b', root), catchip: $('.tv-catchip', root), score: $('.tv-score b', root), streak: $('.tv-streak', root),
      progress: $$('.tv-progress i', root), card: $('.tv-card', root), ring: $('.tv-ring', root), ringFg: $('.tr-fg', root), ringNum: $('.tv-ring b', root),
      diff: $('.tv-diff', root), qtext: $('.tv-qtext', root), status: $('.tv-status', root), answers: $('.tv-answers', root), btns: $$('.tv-ans', root),
      banner: $('.tv-banner', root), sheet: $('.tv-sheet', root), wheelwrap: $('.tv-wheelwrap', root), wheel: $('.tv-wheel-svg', root),
      whTop: $('.tv-wh-top', root), whLabel: $('.tv-wh-label', root), whNote: $('.tv-wh-note', root), fact: $('.tv-fact', root), writing: $('.tv-wrwrap', root), pause: $('.tv-pause', root), fx: $('.tv-fx', root), quit: $('.tv-quit', root)
    };
    setWheel(ALL_CATS);
    renderSetup();

    el.menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'play') startSolo();
      if (b.dataset.act === 'family') G.openLobby();
    });
    el.answers.addEventListener('click', (e) => {
      const b = e.target.closest('.tv-ans');
      if (b) { b.blur(); choose(Number(b.dataset.k)); }
    });
    el.quit.addEventListener('click', () => { G.sfx('click'); showMenu(); });
    el.pause.addEventListener('click', (e) => { if (e.target.closest('[data-act="resume"]')) resume(); });
    el.writing.addEventListener('click', (e) => { if (e.target.closest('[data-act="cancel-writing"]') && writingAbort) { G.sfx('click'); writingAbort.abort(); } });
    el.end.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'again') startSolo();
      if (b.dataset.act === 'menu') showMenu();
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { sizeFx(); if (R && R.renderedQ >= 0) fitAnswers(); });
    sizeFx();
  }

  function renderSetup() {
    el.setupbox.innerHTML = setupHtml(setup);
  }

  // ---------- Menu ----------
  const GREETINGS = [
    (n) => `Hi ${n}! I’m Quizzy, your host. Pick your topics and let’s play!`,
    (n) => `Welcome back to Trivia Party, ${n}! Ready to test that big brain?`,
    (n) => `${n}, the spotlight is on you! Try Family Edition: questions about your own family!`,
    (n) => `Ooh, a challenger! Hello ${n}. Ten questions are waiting for you.`
  ];
  let sayTimer = 0;
  function say(text, mood) {
    clearInterval(sayTimer);
    if (mood) el.host.dataset.mood = mood;
    let i = 0;
    el.say.textContent = '';
    el.say.parentElement.classList.remove('pop'); void el.say.offsetWidth; el.say.parentElement.classList.add('pop');
    sayTimer = setInterval(() => {
      i += 2;
      el.say.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(sayTimer);
    }, 28);
  }
  function showMenu() {
    stopRound();
    el.play.hidden = true;
    el.end.hidden = true;
    el.menu.hidden = false;
    el.wrap.classList.remove('multi', 'playing');
    el.menu.classList.remove('in'); void el.menu.offsetWidth; el.menu.classList.add('in');
    renderSetup();
    say(GREETINGS[Math.floor(Math.random() * GREETINGS.length)](user || 'friend'), 'happy');
  }

  // ---------- Rounds ----------
  function stopRound() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (R && R.endTimer) clearTimeout(R.endTimer);
    R = null;
    el.pause.hidden = true;
    el.wheelwrap.hidden = true;
  }

  function newRound(o) {
    stopRound();
    R = Object.assign({
      multi: false, qs: [], setup, i: -1, phase: '', phaseAt: 0, qOpenAt: 0, renderedQ: -1,
      ans: {}, pts: {}, results: Array(ROUND).fill(undefined), answer: null,
      score: 0, shownScore: 0, streak: 0, bestStreak: 0, correct: 0,
      spin: null, awarded: {}, paused: false, lastTick: 0, lastSheet: 0, lastBoard: 0,
      family: false, batch: null, notice: '', revMs: REV_MS, soloRevMs: SOLO_REV_MS
    }, o);
    R.slot = Q_MS + R.revMs;
    setWheel(R.family ? FAM_IDS : ALL_CATS);
    R.wheelOn = R.family ? FAM_IDS.filter((id) => R.qs.some((q) => q.cat === id)) : R.setup.cats;
    if (R.family) markPlayed(R.batch);
    el.menu.hidden = true;
    el.end.hidden = true;
    el.play.hidden = false;
    el.wrap.classList.add('playing');
    el.wrap.classList.toggle('multi', R.multi);
    el.quit.hidden = R.multi;
    el.score.textContent = '0';
    el.streak.hidden = true;
    el.progress.forEach((p) => { p.className = ''; });
    el.sheet.classList.remove('show');
    el.banner.className = 'tv-banner';
    raf = requestAnimationFrame(loop);
  }

  function startSolo() {
    G.closeModal();
    store.set(SETUP_KEY, setup);
    if (setup.family) startFamilySolo();
    else playRegularSolo(setup);
  }
  function playRegularSolo(s) {
    const seen = new Set(store.get(SEEN_KEY) || []);
    const qs = pickQuestions(Math.random, s, seen);
    store.set(SEEN_KEY, Array.from(seen).concat(qs.map((q) => q.id)).slice(-360));
    G.sfx('go');
    newRound({ qs, setup: s });
    goTo(0, 'spin');
  }
  // Solo Family Edition: questions from what you share with the whole family (your own group chats).
  async function startFamilySolo() {
    if (writingAbort) return;
    const ac = new AbortController();
    writingAbort = ac;
    el.writing.hidden = false;
    G.sfx('whoosh');
    const stop = runWriting(el.writing);
    let fam;
    try { fam = await familyQuestions([user], setup.diff, ac.signal); } catch (e) { fam = { aborted: true }; }
    stop();
    if (writingAbort === ac) writingAbort = null;
    el.writing.hidden = true;
    if (fam.aborted || ac.signal.aborted) return;
    const s = Object.assign({}, setup);
    if (fam.qs) {
      G.sfx('go');
      newRound({ qs: fam.qs, setup: s, family: true, batch: fam.batch, notice: fam.notice, soloRevMs: FAMILY_SOLO_REV_MS });
      goTo(0, 'spin');
      return;
    }
    G.toast(`${fam.error} Playing regular questions instead.`);
    playRegularSolo(Object.assign(s, { family: false }));
  }

  function startMulti(info) {
    G.closeModal();
    if (writingAbort) { writingAbort.abort(); writingAbort = null; el.writing.hidden = true; }
    const sh = info.shared || {};
    const s = cleanSetup(sh);
    const rand = G.rng(info.seed);
    // Family Edition: everyone plays the exact questions the host's device fetched.
    const famQs = s.family ? unpackFamily(sh, s.diff, rand) : null;
    if (!famQs) s.family = false;
    const session = G.session();
    const startAt = info.startAt || (session && session.startAt ? Date.parse(session.startAt) : Date.now());
    newRound({
      multi: true, setup: s, qs: famQs || pickQuestions(rand, s, null),
      family: !!famQs, batch: famQs ? String(sh.batch || '') : null, notice: famQs ? String(sh.notice || '').slice(0, 200) : '',
      revMs: famQs ? FAMILY_REV_MS : REV_MS,
      players: info.players.slice(), colors: info.colors.slice(), me: info.me, t0: startAt + LEAD_MS
    });
    measureBoard();
    // Joined late (e.g. after a reload): jump straight into the current question.
    const p = multiPhase(Date.now());
    if (p.phase === 'spin') goTo(0, 'spin'); else goTo(p.i, p.phase);
  }

  function multiPhase(now) {
    const rel = now - R.t0;
    if (rel < 0) return { i: 0, phase: 'spin' };
    const i = Math.floor(rel / R.slot);
    if (i >= ROUND) return { i: ROUND, phase: 'end' };
    return { i, phase: rel - i * R.slot < Q_MS ? 'q' : 'rev' };
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!R) return;
    const now = Date.now();
    if (R.paused) return;
    if (R.multi) {
      const p = multiPhase(now);
      if (p.i !== R.i || p.phase !== R.phase) {
        if (!(R.phase === 'spin' && p.phase === 'spin')) goTo(p.i, p.phase);
      }
    } else if (R.phase === 'spin' && now - R.phaseAt >= SOLO_SPIN_MS + SOLO_HOLD_MS) goTo(R.i, 'q');
    else if (R.phase === 'q' && ((R.answer && now - R.answer.at >= LOCK_MS) || now - R.qOpenAt >= Q_MS)) goTo(R.i, 'rev');
    else if (R.phase === 'rev' && now - R.phaseAt >= (R.qs[R.i] && R.qs[R.i].f ? R.soloRevMs : SOLO_REV_MS)) goTo(R.i + 1, R.i + 1 >= ROUND ? 'end' : 'spin');
    if (!R) return;
    if (R.spin) spinFrame(now);
    if (R.phase === 'q') timerFrame(now);
    if (R.multi && now - R.lastSheet > 300) {
      R.lastSheet = now;
      if (R.phase === 'q') renderLocked();
      if (R.phase === 'rev') renderSheet();
    }
    if (R.multi && now - R.lastBoard > 500) { R.lastBoard = now; measureBoard(); }
    if (R.shownScore !== R.score) {
      R.shownScore += Math.ceil((R.score - R.shownScore) * 0.18);
      if (Math.abs(R.score - R.shownScore) < 3) R.shownScore = R.score;
      el.score.textContent = fmt(R.shownScore);
    }
  }

  function goTo(i, phase) {
    const now = Date.now();
    if (R.answer && R.answer.q < i && !R.awarded[R.answer.q]) award(R.answer.q);
    R.i = i;
    R.phase = phase;
    R.phaseAt = now;
    if (phase === 'spin') return enterSpin(i, now);
    if (phase === 'q') return enterQuestion(i, now);
    if (phase === 'rev') return enterReveal(i, now);
    if (phase === 'end') return finish();
  }

  // ----- the wheel -----
  function wheelSvg(ids) {
    const n = ids.length, r = 96, step = 360 / n;
    const pt = (a, rad) => [Math.cos(a * Math.PI / 180) * rad, Math.sin(a * Math.PI / 180) * rad];
    const big = n <= 6;
    let out = `<circle r="99" fill="#fff" opacity=".9"/>`;
    ids.forEach((id, k) => {
      const a0 = k * step - 90, a1 = a0 + step, am = a0 + step / 2;
      const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r), [ix, iy] = pt(am, big ? 60 : 63);
      const sz = big ? 30 : 24;
      out += `<path class="sl" data-cat="${id}" d="M0 0L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z" fill="${CAT[id].color}" stroke="#fff" stroke-width="2"/>`;
      out += `<g transform="rotate(${(am + 90).toFixed(1)} ${ix.toFixed(2)} ${iy.toFixed(2)})" color="#fff">${ic(CAT[id].icon, sz).replace('<svg ', `<svg x="${(ix - sz / 2).toFixed(2)}" y="${(iy - sz / 2).toFixed(2)}" `)}</g>`;
    });
    for (let k = 0; k < n; k++) { const [x, y] = pt(k * step - 90, 90); out += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.6" fill="#fff"/>`; }
    return out;
  }
  function setWheel(ids) {
    const key = ids.join(',');
    wheelIds = ids;
    if (el.wheel.dataset.ids === key) return;
    el.wheel.dataset.ids = key;
    el.wheel.innerHTML = wheelSvg(ids);
  }
  function enterSpin(i, now) {
    const q = R.qs[i];
    const k = Math.max(0, wheelIds.indexOf(q.cat));
    const step = 360 / wheelIds.length;
    let dur = SOLO_SPIN_MS;
    if (R.multi) dur = clamp(R.t0 - now - 600, 0, 2000);
    const from = wheelAngle % 360;
    const jitter = (Math.random() - 0.5) * step * 0.55;
    const to = from + 360 * (dur > 1200 ? 3 : 2) + (((-(k * step + step / 2) + jitter - from) % 360) + 360) % 360;
    R.spin = { from, to, start: now, dur, landed: false, last: null, cat: q.cat };
    el.sheet.classList.remove('show');
    el.banner.className = 'tv-banner';
    el.wheelwrap.hidden = false;
    el.wheelwrap.classList.remove('landed');
    el.whTop.innerHTML = i === 0
      ? `${R.multi ? `${ic('users', 16)} ${esc(setupLabel(R.setup))}` : `${ic('sparkles', 16)} ${esc(setupLabel(R.setup))}`}`
      : `Question ${i + 1} of ${ROUND}`;
    el.whLabel.textContent = 'Spinning…';
    el.whLabel.style.removeProperty('--c');
    el.whNote.hidden = !(i === 0 && R.notice);
    el.whNote.textContent = i === 0 ? R.notice : '';
    $$('.sl', el.wheel).forEach((p) => p.classList.toggle('off', !R.wheelOn.includes(p.dataset.cat)));
    if (dur <= 0) spinFrame(now + 1);
    else G.sfx('whoosh');
  }
  const easeOut = (p) => 1 - Math.pow(1 - p, 3.4);
  function spinFrame(now) {
    const s = R.spin;
    const p = s.dur > 0 ? clamp((now - s.start) / s.dur, 0, 1) : 1;
    const a = s.from + (s.to - s.from) * easeOut(p);
    wheelAngle = a;
    el.wheel.style.transform = `rotate(${a.toFixed(2)}deg)`;
    const slice = Math.floor(a / (360 / wheelIds.length));
    if (s.last !== null && slice !== s.last && p < 1 && now - (s.tickAt || 0) > 70) { s.tickAt = now; G.sfx('tick'); }
    s.last = slice;
    if (p >= 1 && !s.landed) {
      s.landed = true;
      const c = CAT[s.cat];
      el.wheelwrap.classList.add('landed');
      el.whLabel.innerHTML = `${catBadge(s.cat, 30)}<span>${esc(c.name)}!</span>`;
      el.whLabel.style.setProperty('--c', c.color);
      G.sfx('flip');
    }
  }

  // ----- a question -----
  function renderQuestion(i) {
    const q = R.qs[i];
    const c = CAT[q.cat];
    R.renderedQ = i;
    el.qno.textContent = String(i + 1);
    el.catchip.innerHTML = `${catBadge(q.cat, 22)}<span>${esc(c.name)}</span>`;
    el.catchip.style.setProperty('--c', c.color);
    el.card.style.setProperty('--c', c.color);
    el.diff.innerHTML = `<span class="tv-pips">${'<i></i>'.repeat(q.d === 'easy' ? 1 : q.d === 'medium' ? 2 : 3)}</span>${q.d === 'easy' ? 'Easy' : q.d === 'medium' ? 'Medium' : 'Hard'}`;
    el.qtext.textContent = q.q;
    el.fact.hidden = true;
    el.fact.innerHTML = '';
    el.qtext.className = 'tv-qtext' + (q.q.length > 80 ? ' long' : q.q.length > 55 ? ' mid' : '');
    el.btns.forEach((b, k) => {
      b.className = 'tv-ans';
      b.disabled = false;
      $('.tx', b).textContent = q.a[k];
      b.classList.toggle('long', q.a[k].length > 22);
      setHtml($('.who', b), '');
      $('.mark', b).innerHTML = '';
      b.setAttribute('aria-label', `${ANS[k].name}: ${q.a[k]}`);
    });
    el.progress.forEach((p, k) => { p.classList.toggle('now', k === i); });
    fitAnswers();
    el.card.classList.remove('in'); void el.card.offsetWidth; el.card.classList.add('in');
    el.answers.classList.remove('in'); void el.answers.offsetWidth; el.answers.classList.add('in');
  }
  // Shrinks an answer's text until it fits its button (long words on narrow phones).
  function fitAnswers() {
    el.btns.forEach((b) => {
      const t = $('.tx', b);
      t.style.fontSize = '';
      let size = parseFloat(getComputedStyle(t).fontSize) || 18;
      for (let n = 0; n < 12 && size > 12 && (t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > b.clientHeight - 14); n++) {
        size -= 1;
        t.style.fontSize = size + 'px';
      }
    });
  }
  function enterQuestion(i, now) {
    R.spin = null;
    el.wheelwrap.hidden = true;
    el.sheet.classList.remove('show');
    el.banner.className = 'tv-banner';
    R.qOpenAt = R.multi ? R.t0 + i * R.slot : now;
    R.answer = null;
    R.lastTick = 0;
    renderQuestion(i);
    setHtml(el.status, R.multi ? '' : `<span class="tv-hint">${G.icon('zap', 15)} Answer fast for bonus points!</span>`);
    G.sfx('whoosh');
    push();
    timerFrame(now);
    if (R.multi) renderLocked();
  }
  const RING_C = 2 * Math.PI * 27;
  function timerFrame(now) {
    const left = clamp(Q_MS - (now - R.qOpenAt), 0, Q_MS);
    const frac = left / Q_MS;
    el.ringFg.style.strokeDasharray = RING_C.toFixed(2);
    el.ringFg.style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(2);
    const secs = Math.ceil(left / 1000);
    el.ringNum.textContent = String(secs);
    el.ring.dataset.level = left > 8000 ? 'ok' : left > 4000 ? 'mid' : 'low';
    if (secs <= 5 && secs > 0 && secs !== R.lastTick && !R.answer) { R.lastTick = secs; G.sfx('tick'); el.ring.classList.remove('beat'); void el.ring.offsetWidth; el.ring.classList.add('beat'); }
  }

  function choose(k) {
    if (!R || R.phase !== 'q' || R.answer || R.paused || !(k >= 0 && k < 4)) return;
    if (G.modalOpen() || G.countingDown()) return;
    const now = Date.now();
    const ms = now - R.qOpenAt;
    if (ms < 0 || ms > Q_MS) return;
    R.answer = { k, ms, at: now, q: R.i };
    R.ans[R.i] = k;
    el.btns.forEach((b, j) => { b.classList.add(j === k ? 'chosen' : 'dim'); b.disabled = true; });
    setHtml(el.status, `<span class="tv-locked">${G.icon('lock', 15)} Locked in${R.multi ? '! Waiting for the timer…' : '!'}</span>`);
    G.sfx('click');
    push();
    if (R.multi) renderLocked();
  }

  // Race state: my score only changes at the reveal, so nobody's board gives the answer away early.
  function push() {
    if (!R || !R.multi) return;
    G.race.update({ score: R.score, alive: true, q: R.i, ans: R.ans, streak: R.streak, pts: R.pts });
  }

  // ----- the reveal -----
  // Scores question i once (also used to catch up if this device slept through a reveal).
  function award(i) {
    if (R.awarded[i]) return R.awarded[i];
    const q = R.qs[i];
    const a = R.answer && R.answer.q === i ? R.answer : null;
    const right = !!a && a.k === q.c;
    let gain = 0, speed = 0, bonus = 0;
    if (right) {
      speed = Math.round(500 * clamp(1 - a.ms / Q_MS, 0, 1));
      R.streak += 1;
      bonus = R.streak >= 2 ? Math.min(500, (R.streak - 1) * 100) : 0;
      gain = 500 + speed + bonus;
      R.correct += 1;
      R.bestStreak = Math.max(R.bestStreak, R.streak);
    } else R.streak = 0;
    R.score += gain;
    R.pts[i] = gain;
    R.results[i] = a ? right : null;
    el.progress[i].className = right ? 'ok' : a ? 'no' : 'skip';
    R.awarded[i] = { a, right, gain, speed, bonus };
    return R.awarded[i];
  }
  function enterReveal(i, now) {
    if (R.renderedQ !== i) { el.wheelwrap.hidden = true; R.spin = null; renderQuestion(i); }
    const q = R.qs[i];
    const { a, right, gain, speed, bonus } = award(i);
    push();

    // Buttons: the right one glows, the rest fade; a wrong pick shakes.
    el.btns.forEach((b, k) => {
      b.disabled = true;
      b.classList.remove('dim', 'chosen');
      if (k === q.c) { b.classList.add('right'); $('.mark', b).innerHTML = G.icon('check', 20); }
      else if (a && k === a.k) { b.classList.add('wrong'); $('.mark', b).innerHTML = G.icon('close', 20); }
      else b.classList.add('fade');
      if (a && k === a.k) b.classList.add('mine');
    });
    // Family Edition: where the question came from, and the fun fact.
    if (R.family && FAM_IDS.includes(q.cat)) {
      const c = CAT[q.cat];
      el.fact.innerHTML = `<span class="tv-src" style="--c:${c.color}">${ic(c.icon, 13)}${esc(c.tag)}</span>${q.f ? `<span class="tv-fact-tx">${esc(q.f)}</span>` : ''}`;
      el.fact.hidden = false;
      fitAnswers();
    }
    el.ringNum.innerHTML = `<span class="ri ${right ? 'ok' : 'no'}">${G.icon(right ? 'check' : a ? 'close' : 'timer', 26)}</span>`;
    el.ring.dataset.level = right ? 'ok' : 'low';
    el.ringFg.style.strokeDashoffset = '0';
    el.streak.hidden = R.streak < 2;
    $('b', el.streak).textContent = String(R.streak);

    const praise = ['Brilliant!', 'Correct!', 'Nailed it!', 'Superstar!', 'Yes!', 'Spot on!'];
    const comfort = a ? ['Not quite!', 'So close!', 'Oops!', 'Nice try!'] : ['Time’s up!'];
    const pick = (list) => list[(i + R.score) % list.length];
    el.banner.className = 'tv-banner show ' + (right ? 'ok' : 'no');
    el.banner.innerHTML = right
      ? `<b>${G.icon('check', 22)} ${pick(praise)}</b><span class="pts">+${fmt(gain)}</span><span class="br">500 right${speed ? ` · +${speed} speed` : ''}${bonus ? ` · <em>${G.icon('flame', 13)} +${bonus} streak</em>` : ''}</span>`
      : `<b>${G.icon(a ? 'close' : 'timer', 22)} ${pick(comfort)}</b><span class="br">The answer was <strong>${esc(q.a[q.c])}</strong></span>`;
    setHtml(el.status, '');
    if (right) {
      G.sfx('match');
      if (R.streak >= 3) setTimeout(() => G.sfx('coin'), 260);
      const r = el.btns[q.c].getBoundingClientRect();
      const w = el.wrap.getBoundingClientRect();
      burst(r.left - w.left + r.width / 2, r.top - w.top + r.height / 2, 34 + R.streak * 6);
      floatPoints(el.btns[q.c], `+${fmt(gain)}`);
    } else G.sfx('wrong');
    if (R.multi) { renderWho(i); setTimeout(() => { if (R && R.phase === 'rev' && R.i === i) { el.sheet.classList.add('show'); renderSheet(); } }, 1100); }
  }

  // ----- multiplayer: who has locked in, who got it right, the live scores -----
  function othersMap() {
    const m = {};
    G.race.others().forEach((o) => { m[o.name] = o; });
    return m;
  }
  const colorOf = (name) => { const k = R.players.indexOf(name); return k >= 0 ? R.colors[k] : '#a1a1aa'; };
  const initial = (name) => esc(String(name || '?').trim().charAt(0).toUpperCase());
  function renderLocked() {
    if (!R || R.phase !== 'q') return;
    const m = othersMap();
    const names = R.players.filter((n) => n !== R.me && m[n] && m[n].state && m[n].state.ans && m[n].state.ans[R.i] != null);
    const others = R.players.filter((n) => n !== R.me).length;
    if (!others) return;
    const mine = R.answer ? `<span class="tv-locked">${G.icon('lock', 15)} Locked in!</span>` : '';
    setHtml(el.status, `${mine}<span class="tv-lockers">${names.map((n) => `<i style="background:${colorOf(n)}" title="${esc(n)}">${initial(n)}</i>`).join('')}<span>${names.length ? `${names.length} of ${others} ${others === 1 ? 'player' : 'others'} answered` : 'Nobody else has answered yet'}</span></span>`);
  }
  // Only touches the DOM when the content really changed (so pop-in animations don't restart).
  function setHtml(node, html) {
    if (node.__html === html) return;
    node.__html = html;
    node.innerHTML = html;
  }
  // Each player's result for question i: { right, choice, gain, pending }.
  function resultFor(name, i, m) {
    if (!R.qs[i]) {
      const st = name === R.me ? { score: R.score } : m[name] && m[name].state;
      return { score: st ? Number(st.score) || 0 : 0, pending: !st };
    }
    if (name === R.me) return { choice: R.ans[i], right: R.ans[i] === R.qs[i].c, gain: R.pts[i] || 0, score: R.score };
    const o = m[name];
    const st = o && o.state;
    if (!st) return { pending: true, score: 0 };
    const choice = st.ans ? st.ans[i] : undefined;
    const gain = st.pts && st.pts[i] != null ? Number(st.pts[i]) || 0 : null;
    if (choice != null) return { choice: Number(choice), right: Number(choice) === R.qs[i].c, gain, score: Number(st.score) || 0 };
    if ((Number(st.q) || 0) > i || gain != null || Date.now() - R.phaseAt > 1500) return { choice: undefined, right: false, gain: 0, score: Number(st.score) || 0 };
    return { pending: true, score: Number(st.score) || 0 };
  }
  function renderWho(i) {
    const m = othersMap();
    const html = ['', '', '', ''];
    R.players.forEach((n) => {
      const r = resultFor(n, i, m);
      if (r.choice == null || !el.btns[r.choice]) return;
      html[r.choice] += `<i style="background:${colorOf(n)}" title="${esc(n)}">${initial(n)}</i>`;
    });
    el.btns.forEach((b, k) => setHtml($('.who', b), html[k]));
  }
  function standings() {
    const m = othersMap();
    return R.players.map((n) => {
      const r = resultFor(n, R.i, m);
      return Object.assign({ name: n, color: colorOf(n), me: n === R.me }, r);
    }).sort((a, b) => b.score - a.score || (a.me ? -1 : 1));
  }
  function renderSheet() {
    if (!R || R.phase !== 'rev') return;
    const i = R.i, q = R.qs[i];
    renderWho(i);
    if (!el.sheet.classList.contains('show')) return;
    const rows = standings();
    const next = i + 1 < ROUND ? R.qs[i + 1] : null;
    const rightCount = rows.filter((r) => r.right).length;
    setHtml(el.sheet, `<div class="tv-sh-h"><span class="tv-sh-ans" style="--a:${ANS[q.c].color}">${shape(q.c, 18)}${esc(q.a[q.c])}</span><span class="tv-sh-n">${rightCount === rows.length ? 'Everyone got it!' : rightCount ? `${rightCount} of ${rows.length} got it` : 'Nobody got this one!'}</span></div>` +
      '<ol class="tv-rank">' + rows.map((r, k) => `<li class="${r.me ? 'me' : ''}"><span class="rk">${k + 1}</span><i class="dot" style="background:${r.color}"></i><span class="nm">${esc(r.name)}${r.me ? ' <small>you</small>' : ''}</span>` +
        `<span class="res ${r.pending ? 'wait' : r.right ? 'ok' : 'no'}">${r.pending ? G.icon('clock', 16) : r.right ? G.icon('check', 16) : r.choice == null ? G.icon('timer', 16) : G.icon('close', 16)}</span>` +
        `<span class="gn">${r.pending || r.gain == null ? '' : r.gain ? `+${fmt(r.gain)}` : ''}</span><span class="sc">${fmt(r.score)}</span></li>`).join('') + '</ol>' +
      (next ? `<div class="tv-next">Next up ${catBadge(next.cat, 22)}<b>${esc(CAT[next.cat].name)}</b></div>` : `<div class="tv-next">${G.icon('trophy', 18)}<b>Final scores coming up!</b></div>`));
  }
  // Leaves room at the top right for the core's live scoreboard.
  function measureBoard() {
    const b = document.getElementById('cg-race');
    const st = el.wrap.getBoundingClientRect();
    const col = el.play.hidden ? el.end.firstElementChild : el.play;
    const cr = col ? col.getBoundingClientRect() : st;
    const r = b ? b.getBoundingClientRect() : null;
    // Only when the board actually sits over our column (phones); on wide screens it's off to the side.
    if (!r || !R || !R.multi || r.left >= cr.right - 4) { el.wrap.style.removeProperty('--board-w'); el.wrap.style.removeProperty('--board-h'); return; }
    el.wrap.style.setProperty('--board-w', Math.max(0, cr.right - r.left + 6) + 'px');
    el.wrap.style.setProperty('--board-h', Math.max(0, r.bottom - st.top + 4) + 'px');
  }

  // ----- the end -----
  function finish() {
    R.spin = null;
    el.wheelwrap.hidden = true;
    el.play.hidden = true;
    el.end.hidden = false;
    el.sheet.classList.remove('show');
    if (R.multi) return podium();
    const n = R.correct;
    const title = n >= 9 ? 'Trivia champion!' : n >= 7 ? 'Brilliant game!' : n >= 4 ? 'Well played!' : 'Good try!';
    const mood = n >= 4 ? 'happy' : 'oops';
    el.end.innerHTML = `<div class="tv-end-in">
      <div class="tv-host small" data-mood="${n >= 7 ? 'wow' : mood}">${hostSvg()}</div>
      <h2>${esc(title)}</h2>
      <div class="tv-bigscore"><b>0</b><small>points</small></div>
      <div class="tv-stats">
        <span>${G.icon('check', 18)}<b>${n}/${ROUND}</b><small>right</small></span>
        <span>${G.icon('flame', 18)}<b>${R.bestStreak}</b><small>best streak</small></span>
        <span>${G.icon('target', 18)}<b>${esc(DIFFS.find((d) => d.id === R.setup.diff).name)}</b><small>difficulty</small></span>
      </div>
      <div class="tv-recap">${R.qs.map((q, k) => `<span style="--n:${k}" class="${R.results[k] ? 'ok' : R.results[k] === false ? 'no' : 'skip'}" title="${esc(q.q)}">${catBadge(q.cat, 26)}<em>${G.icon(R.results[k] ? 'check' : R.results[k] === false ? 'close' : 'timer', 12)}</em></span>`).join('')}</div>
    </div>`;
    countUp($('.tv-bigscore b', el.end), R.score);
    G.sfx(n >= 7 ? 'win' : 'score');
    if (n >= 7) rain(90);
    const score = R.score;
    R.endTimer = setTimeout(() => {
      if (!R || R.multi) return;
      G.gameOver({ score, title, again: startSolo });
    }, 2600);
  }

  function podium() {
    const rows = standings();
    const top = rows[0];
    const tie = rows.length > 1 && rows[1].score === top.score;
    const meWon = !tie && top.me;
    const title = rows.length === 1 ? 'Round complete!' : tie ? 'It’s a tie at the top!' : meWon ? 'You win!' : `${esc(top.name)} wins!`;
    const order = [1, 0, 2].filter((k) => rows[k]);
    el.end.innerHTML = `<div class="tv-end-in podium">
      <h2>${title}</h2>
      <p class="tv-sub">${esc(setupLabel(R.setup))} · you got ${R.correct}/${ROUND} right</p>
      <div class="tv-podium">${order.map((k) => { const r = rows[k]; return `<div class="pd p${k + 1}${r.me ? ' me' : ''}" style="--c:${r.color}">
        <div class="av">${k === 0 ? `<span class="crown">${G.icon('crown', 26)}</span>` : ''}<i>${initial(r.name)}</i></div>
        <div class="nm">${esc(r.name)}</div><div class="sc" data-to="${r.score}">0</div>
        <div class="blk"><span>${k + 1}</span></div></div>`; }).join('')}</div>
      ${rows.length > 3 ? `<ol class="tv-rank rest" start="4">${rows.slice(3).map((r, k) => `<li class="${r.me ? 'me' : ''}"><span class="rk">${k + 4}</span><i class="dot" style="background:${r.color}"></i><span class="nm">${esc(r.name)}</span><span class="sc">${fmt(r.score)}</span></li>`).join('')}</ol>` : ''}
    </div>`;
    $$('.tv-podium .sc', el.end).forEach((s) => countUp(s, Number(s.dataset.to)));
    G.sfx(meWon ? 'win' : 'score');
    rain(meWon ? 140 : 80);
    const score = R.score;
    R.endTimer = setTimeout(() => { if (R && R.multi) G.gameOver({ score }); }, END_DELAY_MS);
  }

  function countUp(node, to) {
    const t0 = performance.now();
    const step = (t) => {
      const p = clamp((t - t0) / 1100, 0, 1);
      node.textContent = fmt(Math.round(to * easeOut(p)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ----- pause (solo) -----
  function pause() {
    if (!R || R.multi || R.paused || R.phase === 'end' || !R.phase) return;
    R.paused = true;
    R.pausedAt = Date.now();
    el.pause.hidden = false;
  }
  function resume() {
    if (!R || !R.paused) return;
    const d = Date.now() - R.pausedAt;
    R.phaseAt += d; R.qOpenAt += d;
    if (R.answer) R.answer.at += d;
    if (R.spin) R.spin.start += d;
    R.paused = false;
    el.pause.hidden = true;
    G.sfx('click');
  }

  // ---------- Keys ----------
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || G.modalOpen()) return;
    const k = e.key.toLowerCase();
    if (R && R.paused) { if (k === 'enter' || k === ' ') { e.preventDefault(); resume(); } return; }
    if (R && R.phase === 'q' && KEYS[k] !== undefined) { e.preventDefault(); choose(KEYS[k]); return; }
    if (!R && !el.menu.hidden && el.writing.hidden && k === 'enter' && (document.activeElement === document.body || !document.activeElement)) { e.preventDefault(); G.openLobby(); }
  }

  // ---------- Effects: confetti on a canvas over the stage ----------
  const fx = { parts: [], raf: 0, w: 0, h: 0, dpr: 1 };
  const FX_COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#facc15'];
  function sizeFx() {
    if (!el.fx) return;
    const r = el.wrap.getBoundingClientRect();
    fx.dpr = Math.min(2, window.devicePixelRatio || 1);
    fx.w = r.width; fx.h = r.height;
    el.fx.width = Math.round(r.width * fx.dpr);
    el.fx.height = Math.round(r.height * fx.dpr);
    if (R && R.multi) measureBoard();
  }
  function addPart(x, y, vx, vy) {
    fx.parts.push({ x, y, vx, vy, r: 3 + Math.random() * 4, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.4, c: FX_COLORS[Math.floor(Math.random() * FX_COLORS.length)], life: 1, round: Math.random() < 0.3 });
  }
  function burst(x, y, n) {
    for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 7; addPart(x, y, Math.cos(a) * s, Math.sin(a) * s - 4); }
    runFx();
  }
  function rain(n) {
    for (let k = 0; k < n; k++) addPart(Math.random() * fx.w, -20 - Math.random() * fx.h * 0.6, (Math.random() - 0.5) * 2, 1 + Math.random() * 3);
    runFx();
  }
  function runFx() {
    if (fx.raf) return;
    const ctx = el.fx.getContext('2d');
    const step = () => {
      ctx.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
      ctx.clearRect(0, 0, fx.w, fx.h);
      fx.parts = fx.parts.filter((p) => p.life > 0 && p.y < fx.h + 30);
      for (const p of fx.parts) {
        p.vy += 0.22; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.a += p.va;
        if (p.y > 0) p.life -= 0.006;
        ctx.globalAlpha = clamp(p.life * 1.5, 0, 1);
        ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.r * 0.7, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (fx.parts.length) fx.raf = requestAnimationFrame(step);
      else { fx.raf = 0; ctx.clearRect(0, 0, fx.w, fx.h); }
    };
    fx.raf = requestAnimationFrame(step);
  }
  function floatPoints(btn, text) {
    const w = el.wrap.getBoundingClientRect(), r = btn.getBoundingClientRect();
    const p = document.createElement('div');
    p.className = 'tv-float';
    p.textContent = text;
    p.style.left = (r.left - w.left + r.width / 2) + 'px';
    p.style.top = (r.top - w.top + r.height / 2) + 'px';
    el.wrap.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }

  // ---------- Frame ----------
  G.mount({
    id: 'trivia', title: 'Trivia Party', mode: 'race', scoreLabel: 'points',
    help: '<ul>' +
      '<li>Ten questions a round. You have <b>15 seconds</b> for each one.</li>' +
      '<li>Tap one of the four coloured answers, or press <b>1–4</b> (or <b>A–D</b>) on a keyboard. Once you tap, it’s locked in!</li>' +
      '<li>A right answer scores <b>500</b>, plus up to <b>500 more</b> for answering quickly.</li>' +
      '<li>Get answers right in a row for a <b>streak bonus</b>: +100, +200… up to +500 a question.</li>' +
      '<li>Choose your topics and a difficulty. <b>Easy</b> is great for younger players; <b>Mixed</b> starts easy and gets harder.</li>' +
      '<li><b>Family Edition</b>: the AI writes questions about your own family from things you already share with each other: the group chats everyone playing is in, their calendar events and notes shared with the whole family. Never private messages or private notes.</li>' +
      '<li><b>Play together</b>: everyone gets the same questions at the same time. After each one you’ll see who got it right and the scores.</li>' +
      '</ul>',
    roundSetup(players) {
      // The host picks the topics and difficulty for everyone. Family Edition: the host's device fetches the
      // questions (from chats ALL the players share) and sends them to everyone in info.shared.
      return new Promise((resolve) => {
        const s = cleanSetup(setup);
        let done = false;
        const finish = (v) => { if (done) return; done = true; resolve(v); };
        const card = G.modal(`<div class="cg-hero plain">${G.badge('trivia', 52)}</div><h2>Round setup</h2><p class="cg-sub">Everyone plays the same 10 questions</p><div class="tv-modal-setup"></div>` +
          `<div class="cg-row"><button type="button" data-cg="close">Cancel</button><button type="button" class="primary" data-tv="go">${G.icon('play', 18)} Start the round</button></div>`, { wide: true, onClose: () => finish(null) });
        card.classList.add('tv-setupcard');
        const box = $('.tv-modal-setup', card);
        const paint = () => { box.innerHTML = setupHtml(s); };
        paint();
        bindSetup(box, s, paint);
        $('[data-tv="go"]', card).addEventListener('click', async () => {
          Object.assign(setup, cleanSetup(s));
          store.set(SETUP_KEY, setup);
          if (!setup.family) { G.closeModal(); finish({ cats: setup.cats, diff: setup.diff }); return; }
          const ac = new AbortController();
          const wcard = G.modal(`${writingHtml()}<div class="cg-row"><button type="button" data-cg="close">Cancel</button></div>`,
            { sticky: true, onClose: () => { ac.abort(); finish(null); } });
          wcard.classList.add('tv-writingcard');
          const stop = runWriting(wcard);
          let fam;
          try { fam = await familyQuestions((players || []).slice(), setup.diff, ac.signal); } catch (e) { fam = { aborted: true }; }
          stop();
          if (done || fam.aborted) return;
          G.closeModal();
          if (fam.qs) {
            const packed = packFamily(setup.diff, fam);
            if (packed) { finish(packed); return; }
            fam = { error: 'Those questions were too long to share.' };
          }
          G.toast(`${fam.error} Playing regular questions instead.`);
          finish({ cats: setup.cats, diff: setup.diff });
        });
      });
    },
    onReady(ctx) {
      user = ctx.user;
      build(ctx.root);
      bindSetup(el.setupbox, setup, () => { store.set(SETUP_KEY, setup); renderSetup(); });
      showMenu();
    }
  });

  G.on('multiStart', (info) => { if (el.wrap) startMulti(info); });
  G.on('multiEnd', () => { if (el.wrap) showMenu(); });
  G.on('pause', pause);

  // Read-only peek for automated tests.
  window.__trivia = {
    bank: () => ({ CATEGORIES, QUESTIONS }),
    pick: (seed, s) => pickQuestions(G.rng(seed), cleanSetup(s), null),
    fit: () => fitAnswers(),
    round: () => (R ? { multi: R.multi, family: R.family, batch: R.batch, notice: R.notice, slot: R.slot, i: R.i, phase: R.phase, score: R.score, correct: R.correct, t0: R.t0, qOpenAt: R.qOpenAt, setup: R.setup, qs: R.qs.map((q) => ({ id: q.id, c: q.c, a: q.a, q: q.q, cat: q.cat, f: q.f || '' })), ans: Object.assign({}, R.ans), pts: Object.assign({}, R.pts) } : null)
  };
})();
