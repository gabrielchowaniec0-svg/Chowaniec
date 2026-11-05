// Family Trophies: your level, the monthly season, the trophy cabinet, achievements and everyone's profiles.
// Data: /.netlify/functions/xp (?me, ?profile, ?board, ?seasons, ?rules). Read-only: XP is earned elsewhere.
(function () {
  'use strict';
  const API = '/.netlify/functions/xp';
  const CG = window.ChowGames;
  const icon = (n, s) => (CG ? CG.icon(n, s) : '');
  const badge = (id, s) => (CG ? CG.badge(id, s) : '');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const RARITY = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
  const GROUPS = ['All', 'Playing', 'Winning', 'Games', 'Daily Word', 'Game night', 'Family chat', 'Levels'];
  const KIND_ICON = { play: 'gamepad', finish: 'flag', win: 'crown', pb: 'star', record: 'trophy', word: 'word', night: 'party', champion: 'trophy', chat: 'chat', streak: 'flame', react: 'heart' };
  const PALETTE = [['#fb7185', '#e11d48'], ['#60a5fa', '#4f46e5'], ['#34d399', '#0d9488'], ['#fbbf24', '#ea580c'], ['#c084fc', '#9333ea'], ['#f472b6', '#db2777'], ['#38bdf8', '#0891b2'], ['#a3e635', '#16a34a']];

  const state = { me: null, mine: null, season: null, all: null, past: [], people: [], filter: 'All', board: 'season', profiles: {}, rules: null };

  function user() { return window.getChowaniecUser ? window.getChowaniecUser() : null; }
  async function get(q) {
    const u = user();
    const res = await fetch(`${API}?${q}`, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Chowaniec-Key': (u && u.key) || '' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
    return data;
  }

  // ---------- Little pieces ----------
  function hash(name) { let h = 0; for (const ch of String(name || '').toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  function colorsFor(name) {
    const i = state.people.indexOf(name);
    return PALETTE[(i >= 0 ? i : hash(name)) % PALETTE.length];
  }
  // A round avatar with a level ring around it (frac = progress through the level) and a level badge.
  function avatar(name, size, { level, frac } = {}) {
    const [a, b] = colorsFor(name);
    const ring = level != null;
    const r = size / 2 - 2;
    const c = 2 * Math.PI * r;
    const initial = esc(Array.from(String(name || '?'))[0].toUpperCase());
    return `<span class="av${ring ? ' ringed' : ''}" style="--s:${size}px;--a:${a};--b:${b}" aria-hidden="true">` +
      (ring ? `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="rt"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="rf" style="stroke-dasharray:${c.toFixed(1)};stroke-dashoffset:${(c * (1 - Math.max(0, Math.min(1, frac || 0)))).toFixed(1)}"/></svg>` : '') +
      `<span class="in">${initial}</span>${ring ? `<b class="lv">${level}</b>` : ''}</span>`;
  }
  function medal(place) { return `<span class="pl${place <= 3 ? ` p${place}` : ''}">${place}</span>`; }
  function ago(iso) {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    const d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  const dateLabel = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  function timeLeft(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (ms <= 0) return 'Ending now';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (d >= 2) return `${d} days ${h} h left`;
    if (d === 1) return `1 day ${h} h left`;
    return h ? `${h} h ${m} min left` : `${m} min left`;
  }

  // The big level ring (gradient stroke).
  function bigRing(level, frac) {
    const size = 140;
    const r = 60;
    const c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(1, frac)));
    return `<div class="lvring" style="--c:${c.toFixed(1)};--off:${off.toFixed(1)}"><svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><defs><linearGradient id="tp-rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset=".55" stop-color="#f43f5e"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>` +
      `<circle cx="70" cy="70" r="${r}" class="rt"/><circle cx="70" cy="70" r="${r}" class="rf"/></svg><div class="rl"><small>Level</small><b>${level}</b></div></div>`;
  }

  // A trophy cup, drawn. kind 'season' = gold, 'night' = silver-teal.
  function cup(kind, label) {
    const g = kind === 'season' ? ['#fde68a', '#f59e0b', '#b45309'] : ['#e0f2fe', '#7dd3fc', '#0e7490'];
    const id = `cg${Math.random().toString(36).slice(2, 8)}`;
    return `<svg class="cup" viewBox="0 0 80 96" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${g[0]}"/><stop offset=".5" stop-color="${g[1]}"/><stop offset="1" stop-color="${g[2]}"/></linearGradient></defs>` +
      `<path d="M18 10h44v18c0 14-9 25-22 25S18 42 18 28z" fill="url(#${id})"/>` +
      `<path d="M18 16H9c0 12 5 19 13 20M62 16h9c0 12-5 19-13 20" fill="none" stroke="url(#${id})" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="M35 52h10l3 16H32z" fill="url(#${id})"/><rect x="22" y="68" width="36" height="8" rx="3" fill="${g[2]}"/><rect x="16" y="76" width="48" height="12" rx="4" fill="${g[2]}" opacity=".85"/>` +
      `<path d="M27 15c0 10 2 18 8 24" stroke="#fff" stroke-opacity=".55" stroke-width="4" stroke-linecap="round" fill="none"/>` +
      (label ? `<text x="40" y="85.5" text-anchor="middle" font-size="8" font-weight="800" fill="#fff" font-family="Outfit, system-ui, sans-serif">${esc(label)}</text>` : '') +
      `<path d="M40 22l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#fff" fill-opacity=".85"/></svg>`;
  }

  // An achievement medallion.
  function medallion(a, size) {
    const locked = !a.unlockedAt;
    return `<span class="md r-${esc(a.rarity)}${locked ? ' locked' : ''}" style="--s:${size}px" aria-hidden="true">${icon(a.icon, Math.round(size * 0.46))}${locked ? `<span class="lk">${icon('lock', Math.max(10, Math.round(size * 0.22)))}</span>` : ''}</span>`;
  }

  // ---------- Hero ----------
  function renderHero() {
    const m = state.me;
    const p = state.mine;
    const frac = m.nextXp ? m.levelXp / m.nextXp : 0;
    const st = (p && p.stats) || {};
    const chips = [
      ['gamepad', `${fmt(st.plays)} rounds`], ['crown', `${fmt(st.wins)} wins`],
      ['award', `${m.achievements.unlocked} of ${m.achievements.total} achievements`]
    ];
    if (st.wordStreak > 1) chips.push(['flame', `${st.wordStreak}-day word streak`]);
    if (st.chatStreak > 1) chips.push(['chat', `${st.chatStreak}-day chat streak`]);
    $('tp-hero').innerHTML = `<div class="hero-glow" aria-hidden="true"></div>${bigRing(m.level, frac)}` +
      `<div class="hero-body"><span class="who">${esc(m.name)}</span><h2 class="title">${esc(m.title)}</h2>` +
      `<div class="xpbar" role="progressbar" aria-label="Progress to level ${m.level + 1}" aria-valuemin="0" aria-valuemax="${m.nextXp}" aria-valuenow="${m.levelXp}"><i style="--w:${(frac * 100).toFixed(1)}%"></i></div>` +
      `<p class="xpline"><b>${fmt(m.xp)} XP</b><span>${fmt(m.toNext)} XP to level ${m.level + 1}</span></p>` +
      `<div class="chips">${chips.map(([ic, t]) => `<span class="chip">${icon(ic, 14)}${esc(t)}</span>`).join('')}</div></div>`;
    requestAnimationFrame(() => setTimeout(() => $('tp-hero').classList.add('go'), reduced() ? 0 : 60));
  }

  // ---------- Season ----------
  function renderSeason() {
    const m = state.me;
    const s = m.season;
    const rows = state.board === 'all' ? (state.all ? state.all.standings : []) : (state.season ? state.season.standings : []);
    const key = state.board === 'all' ? 'xp' : 'points';
    const top = Math.max(1, ...rows.map((r) => r[key] || 0));
    const list = rows.map((r) => `<li><button type="button" class="row${r.name === m.name ? ' me' : ''}" data-person="${esc(r.name)}">${medal(r.place)}${avatar(r.name, 36)}` +
      `<span class="nm"><b>${esc(r.name)}${r.name === m.name ? ' <em>you</em>' : ''}</b><small>Level ${r.level} · ${esc(r.title)}</small></span>` +
      `<span class="pts"><b>${fmt(r[key])}</b><small>${key === 'xp' ? 'XP' : 'pts'}</small></span><span class="bar" aria-hidden="true"><i style="width:${((r[key] || 0) / top * 100).toFixed(1)}%"></i></span></button></li>`).join('');
    $('tp-season').innerHTML = `<div class="season-art" aria-hidden="true">${cup('season')}</div>` +
      `<div class="season-head"><span class="pill">${icon('calendar', 13)} Season</span><h2>${esc(s.name)}</h2><p class="left" id="tp-left">${icon('clock', 14)} ${esc(timeLeft(s.endsAt))}</p></div>` +
      `<div class="season-stats"><div><small>Your rank</small><b>#${s.rank}<span> of ${s.total}</span></b></div><div><small>Season points</small><b>${fmt(s.points)}</b></div></div>` +
      `<div class="seg" role="tablist" aria-label="Standings"><button type="button" role="tab" data-board="season" aria-selected="${state.board === 'season'}">This season</button><button type="button" role="tab" data-board="all" aria-selected="${state.board === 'all'}">All time</button></div>` +
      `<ol class="standings">${list || '<li class="empty">No points yet this season. Play a game to get on the board!</li>'}</ol>` +
      `<p class="season-note">Season points are the XP you earn this month. The winner takes home the season trophy.</p>`;
  }

  // ---------- Cabinet ----------
  function renderCabinet() {
    const trophies = (state.mine && state.mine.trophies) || [];
    $('tp-cab-count').textContent = trophies.length ? `${trophies.length} trophies` : '';
    if (!trophies.length) {
      $('tp-cabinet').innerHTML = `<div class="shelf empty">${[0, 1, 2].map(() => `<div class="slot ghost">${cup('night')}</div>`).join('')}</div><p class="cab-empty">${icon('trophy', 16)} Win a monthly season or a family game night to put a trophy here.</p>`;
    } else {
      $('tp-cabinet').innerHTML = `<div class="shelf">${trophies.map((t) => `<div class="slot k-${esc(t.kind)}">${cup(t.kind, t.kind === 'season' ? monthShort(t.id) : '')}<b>${esc(t.title)}</b><small>${t.kind === 'season' ? `${fmt(t.points)} season points` : 'Game night champion'} · ${esc(dateLabel(t.at))}</small></div>`).join('')}</div>`;
    }
    const past = state.past || [];
    $('tp-past').innerHTML = past.length ? `<h3>Past seasons</h3><ul>${past.map((s) => `<li id="season-${esc(s.id)}"><span class="mo">${esc(s.name)}</span><span class="win">${s.winners.map((w) => `${avatar(w, 24)}<b>${esc(w)}</b>`).join('')}</span><span class="podium">${s.standings.slice(0, 3).map((r) => `<span>${medal(r.place)}${esc(r.name)} · ${fmt(r.points)}</span>`).join('')}</span></li>`).join('')}</ul>` : '';
  }
  function monthShort(id) {
    const m = Number(String(id).slice(5, 7));
    return ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m - 1] || '';
  }

  // ---------- Family ----------
  function renderFamily() {
    const rows = (state.all && state.all.standings) || [];
    const me = state.me.name;
    $('tp-family').innerHTML = rows.map((r) => `<button type="button" class="person${r.name === me ? ' me' : ''}" data-person="${esc(r.name)}">` +
      `${avatar(r.name, 58, { level: r.level, frac: r.nextXp ? r.levelXp / r.nextXp : 0 })}<b>${esc(r.name)}</b><small>${esc(r.title)}</small>` +
      `<span class="mini">${icon('award', 12)}${r.achievements}<span class="dotsep"></span>${fmt(r.xp)} XP</span></button>`).join('');
  }

  // ---------- Feed ----------
  function renderFeed() {
    const list = (state.mine && state.mine.recent) || [];
    const today = list.filter((e) => Date.now() - Date.parse(e.at) < 86400000).reduce((a, e) => a + e.xp, 0);
    $('tp-feed-sum').textContent = today ? `+${fmt(today)} XP today` : '';
    $('tp-feed').innerHTML = list.length ? list.slice(0, 12).map((e) => `<li class="k-${esc(e.kind)}">${e.game ? badge(e.game, 34) : `<span class="ki">${icon(KIND_ICON[e.kind] || 'zap', 17)}</span>`}` +
      `<span class="lb"><b>${esc(e.label)}</b><small>${esc(ago(e.at))}</small></span><span class="gain">+${fmt(e.xp)}</span></li>`).join('')
      : `<li class="empty">${icon('sparkles', 16)} Your XP will show up here. Play a round, chat with the family or solve the Daily Word.</li>`;
  }

  // ---------- Achievements ----------
  function achTile(a) {
    const locked = !a.unlockedAt;
    const prog = locked && a.need > 1 ? `<span class="prog"><i style="width:${(a.progress / a.need * 100).toFixed(1)}%"></i></span><small class="pn">${fmt(a.progress)} / ${fmt(a.need)}</small>` : '';
    return `<div class="ach${locked ? ' locked' : ''} r-${esc(a.rarity)}" role="listitem">${medallion(a, 54)}<b>${esc(a.name)}</b><span class="hint">${esc(a.hint)}</span>${prog}` +
      `<span class="foot"><span class="rar">${RARITY[a.rarity]}</span>${locked ? '' : `<span class="dt">${esc(dateLabel(a.unlockedAt))}</span>`}</span></div>`;
  }
  function renderAchievements() {
    const all = (state.mine && state.mine.achievements) || [];
    const unlocked = all.filter((a) => a.unlockedAt).length;
    $('tp-ach-count').textContent = `${unlocked} of ${all.length} unlocked`;
    $('tp-filters').innerHTML = GROUPS.map((g) => {
      const n = g === 'All' ? all.length : all.filter((a) => a.group === g).length;
      return `<button type="button" role="tab" data-filter="${esc(g)}" aria-selected="${state.filter === g}">${esc(g)}<span>${n}</span></button>`;
    }).join('');
    const order = { legendary: 0, epic: 1, rare: 2, common: 3 };
    const shown = all.filter((a) => state.filter === 'All' || a.group === state.filter)
      .sort((x, y) => (!!y.unlockedAt - !!x.unlockedAt) || (x.unlockedAt && y.unlockedAt ? (x.unlockedAt < y.unlockedAt ? 1 : -1) : (y.progress / y.need) - (x.progress / x.need)) || order[x.rarity] - order[y.rarity]);
    $('tp-ach').setAttribute('role', 'list');
    // Collapsed: the newest unlocks next to the locked ones that are closest to done.
    const collapsed = !state.allAch && shown.length > 16;
    const cut = collapsed ? 12 : shown.length;
    const got = shown.filter((a) => a.unlockedAt);
    const next = shown.filter((a) => !a.unlockedAt);
    const first = collapsed ? got.slice(0, Math.max(6, 12 - next.length)).concat(next.slice(0, 12)).slice(0, 12) : shown;
    $('tp-ach').innerHTML = first.map(achTile).join('');
    $('tp-ach-more').innerHTML = cut < shown.length ? `<button type="button" data-more="1">${icon('grid', 16)} Show all ${shown.length}</button>` : '';
  }

  // ---------- Rules ----------
  function renderRules() {
    const r = state.rules ? state.rules.rules : null;
    if (!r) { $('tp-rules').innerHTML = ''; return; }
    const items = [
      ['gamepad', `+${r.play}`, 'Play a round', `Up to ${r.playCap} rounds a day per game`],
      ['flag', `+${r.finish}`, 'Finish a family game', 'Races and turn games with others'],
      ['crown', `+${r.win}`, 'Win a family game', 'Beat everyone in the round'],
      ['star', `+${r.pb}`, 'Personal best', 'Once a day per game'],
      ['trophy', `+${r.record}`, 'Family record', 'Take the number one spot'],
      ['word', `+${r.word}`, 'Solve the Daily Word', `Plus ${r.wordStreakStep} for every streak day`],
      ['party', `+${r.night}`, 'Join a game night', `Champion takes +${r.champion}`],
      ['chat', `+${r.chat}`, 'Chat every day', 'Streak bonus at 3, 7 and 30 days'],
      ['heart', `+${r.react}`, 'Get a reaction', `Up to ${r.reactCap} a day`]
    ];
    $('tp-rules').innerHTML = items.map(([ic, xp, t, d]) => `<div class="rule"><span class="ri">${icon(ic, 18)}</span><span><b>${esc(t)}</b><small>${esc(d)}</small></span><em>${xp}</em></div>`).join('') +
      `<div class="titles">${state.rules.titles.map(([lv, t]) => `<span><b>${lv}</b>${esc(t)}</span>`).join('')}</div>`;
  }

  // ---------- Profiles (sheet) ----------
  async function openProfile(name) {
    if (!name) return;
    const sheet = $('tp-sheet');
    const body = $('tp-sheet-body');
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    requestAnimationFrame(() => sheet.classList.add('open'));
    body.innerHTML = `<div class="sk tall"></div>`;
    try {
      const p = state.profiles[name] || (state.profiles[name] = await get(`profile=${encodeURIComponent(name)}`));
      renderProfile(p);
    } catch (e) {
      body.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
    $('tp-sheet-x').focus({ preventScroll: true });
  }
  function closeProfile() {
    const sheet = $('tp-sheet');
    sheet.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => { sheet.hidden = true; }, reduced() ? 0 : 260);
    if (/[?&]p=/.test(location.search)) history.replaceState(null, '', location.pathname);
  }
  function renderProfile(p) {
    const frac = p.nextXp ? p.levelXp / p.nextXp : 0;
    const st = p.stats || {};
    const unlocked = p.achievements.filter((a) => a.unlockedAt).sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1));
    const stats = [
      ['gamepad', fmt(st.plays), 'rounds'], ['crown', fmt(st.wins), 'wins'], ['grid', fmt(st.games), 'games played'],
      ['trophy', fmt(st.records), 'family records'], ['flame', fmt(st.wordBest), 'best word streak'], ['chat', fmt(st.chatBest), 'best chat streak'],
      ['party', fmt(st.nights), 'game nights'], ['heart', fmt(st.reactions), 'reactions']
    ];
    const isMe = state.me && p.name === state.me.name;
    $('tp-sheet-body').innerHTML = `<div class="pf-head">${avatar(p.name, 84, { level: p.level, frac })}<div><h2 id="tp-sheet-name">${esc(p.name)}${isMe ? ' <em>you</em>' : ''}</h2><p class="pf-title">${esc(p.title)}</p>` +
      `<div class="xpbar sm"><i style="--w:${(frac * 100).toFixed(1)}%"></i></div><p class="pf-xp">Level ${p.level} · ${fmt(p.xp)} XP</p></div></div>` +
      `<div class="pf-stats">${stats.map(([ic, v, t]) => `<div>${icon(ic, 16)}<b>${v}</b><small>${t}</small></div>`).join('')}</div>` +
      (p.trophies.length ? `<h3>Trophies</h3><div class="pf-trophies">${p.trophies.map((t) => `<div class="slot k-${esc(t.kind)}">${cup(t.kind, t.kind === 'season' ? monthShort(t.id) : '')}<b>${esc(t.title)}</b><small>${esc(dateLabel(t.at))}</small></div>`).join('')}</div>` : '') +
      `<h3>Achievements <span>${unlocked.length} of ${p.achievements.length}</span></h3>` +
      (unlocked.length ? `<div class="pf-ach">${unlocked.map((a) => `<div class="pa r-${esc(a.rarity)}" title="${esc(a.hint)}">${medallion(a, 44)}<b>${esc(a.name)}</b><small>${RARITY[a.rarity]}</small></div>`).join('')}</div>` : `<p class="muted">No achievements yet.</p>`) +
      `<h3>Best scores</h3>` +
      (p.bests.length ? `<ul class="pf-bests">${p.bests.map((b) => `<li>${badge(b.game, 32)}<span class="nm"><b>${esc(b.name)}</b><small>${fmt(b.plays)} ${b.plays === 1 ? 'play' : 'plays'}</small></span><span class="sc">${fmt(b.score)}${b.kind === 'add' ? '<small> wins</small>' : ''}</span>${medal(b.rank)}</li>`).join('')}</ul>` : `<p class="muted">No scores yet.</p>`);
    requestAnimationFrame(() => $('tp-sheet-body').classList.add('go'));
  }

  // ---------- Events ----------
  document.addEventListener('click', (e) => {
    const person = e.target.closest('[data-person]');
    if (person) { openProfile(person.dataset.person); return; }
    if (e.target.closest('[data-close]')) { closeProfile(); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { state.filter = f.dataset.filter; renderAchievements(); return; }
    if (e.target.closest('[data-more]')) { state.allAch = true; renderAchievements(); return; }
    const b = e.target.closest('[data-board]');
    if (b && b.dataset.board !== state.board) { state.board = b.dataset.board; renderSeason(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('tp-sheet').hidden) closeProfile(); });

  // ---------- Load ----------
  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    $('tp-back').innerHTML = icon('back', 22);
    $('tp-games').insertAdjacentHTML('afterbegin', icon('gamepad', 18));
    $('tp-sheet-x').innerHTML = icon('close', 20);
    const u = user();
    try {
      const [me, season, all, seasons, rules] = await Promise.all([get('me=1'), get('board=season'), get('board=all'), get('seasons=1').catch(() => ({ seasons: [] })), get('rules=1').catch(() => null)]);
      state.me = me; state.season = season; state.all = all; state.past = seasons.seasons || []; state.rules = rules;
      state.people = all.standings.map((r) => r.name).sort();
      if (me.guest) {
        $('tp-hero').innerHTML = `<p class="guest">${icon('lock', 18)} Trophies are for family members. Sign in with your own passcode to earn XP.</p>`;
      } else {
        state.mine = await get(`profile=${encodeURIComponent(me.name)}`);
        state.profiles[me.name] = state.mine;
        renderHero();
      }
      if (me.season) renderSeason(); else $('tp-season').innerHTML = '';
      renderCabinet(); renderFamily(); renderFeed(); renderAchievements(); renderRules();
      setInterval(() => { const el = $('tp-left'); if (el && state.me && state.me.season) el.innerHTML = `${icon('clock', 14)} ${esc(timeLeft(state.me.season.endsAt))}`; }, 30000);
      const params = new URLSearchParams(location.search);
      if (params.get('p')) openProfile(params.get('p'));
      const sid = params.get('season');
      if (sid) { const row = document.getElementById(`season-${sid}`); if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } }
    } catch (e) {
      loaded = false;
      $('tp-hero').innerHTML = `<p class="err">${icon('info', 18)} ${esc(e.message)} <button type="button" id="tp-retry">Try again</button></p>`;
      $('tp-retry').addEventListener('click', load);
    }
    if (u && !u.name) loaded = false;
  }
  window.initializeProtectedContent = load;
  window.addEventListener('DOMContentLoaded', () => { if (window.isAppAuthorized && window.isAppAuthorized()) load(); });
})();
