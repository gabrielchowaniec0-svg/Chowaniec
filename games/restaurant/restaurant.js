// Family Restaurant: one restaurant that the whole family runs together. The server keeps the truth and keeps the
// restaurant going while nobody is looking (see netlify/lib/restaurant-store.mjs). This page shows it and sends taps.
(function () {
  'use strict';
  const CG = window.ChowGames;
  const API = '/.netlify/functions/restaurant';
  const FOOD = { fries: '🍟', salad: '🥗', soup: '🍲', burger: '🍔', pasta: '🍝', cake: '🍰', steak: '🥩' };
  const FACES = ['🙂', '😀', '🧑‍🦰', '👵', '🧔', '👩‍🦱', '🧒', '🧓'];
  const STAFF = { host: ['Host', 'Seats waiting guests for you.'], cook: ['Cook', 'Starts orders on free stoves.'], waiter: ['Waiter', 'Brings finished dishes to tables.'], busser: ['Busser', 'Clears dirty tables.'] };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let root, body, statsEl, toastEl, tab = 'floor', S = null, sig = '', offset = 0, busy = false, pollT = 0, helloAt = 0, posted = -1;
  const now = () => Date.now() + offset;

  async function call(method, payload) {
    const u = window.getChowaniecUser ? window.getChowaniecUser() : null;
    const t0 = Date.now();
    const res = await fetch(API, {
      method, cache: 'no-store', credentials: 'same-origin',
      headers: Object.assign({ 'X-Chowaniec-Key': (u && u.key) || '' }, payload ? { 'Content-Type': 'application/json' } : {}),
      body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status });
    offset = data.now - (t0 + Date.now()) / 2;
    return data;
  }
  function say(text) {
    toastEl.textContent = text; toastEl.classList.add('show');
    clearTimeout(say.t); say.t = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  async function act(payload, ok) {
    if (busy) return;
    busy = true;
    try { S = await call('POST', payload); render(true); if (ok) CG.sfx(ok); }
    catch (e) { say(e.message); CG.sfx('wrong'); await refresh(); }
    busy = false;
  }
  async function refresh() {
    try { S = await call('GET'); render(false); } catch (e) { /* offline: keep the last picture */ }
  }
  async function hello() {
    if (Date.now() - helloAt < 25000) return;
    helloAt = Date.now();
    try { S = await call('POST', { action: 'hello' }); render(false); } catch (e) { /* ignore */ }
  }

  // ---------- Drawing ----------
  const structure = () => JSON.stringify([tab, S.phase, S.cash, S.rep.toFixed(1), S.day, S.customers.map((c) => [c.id, c.state, c.table]), S.tables.map((t) => [t.cust, t.dirty]), S.stoves, S.staff, S.menu, S.crew, S.log.length && S.log[0].t, S.summary && S.summary.day]);
  function render(force) {
    if (!S) return;
    const s = structure();
    if (!force && s === sig) return updateBars();
    sig = s;
    const day = S.phase === 'open' ? Math.max(0, 1 - (now() - S.dayStartAt) / S.dayMs) : 0;
    statsEl.innerHTML = `<span class="fr-pill">${CG.icon('gem', 16)}$${S.cash}</span>
      <span class="fr-pill">${CG.icon('star', 16)}${S.rep.toFixed(1)}</span>
      <div class="fr-day">${S.day ? 'Day ' + S.day : 'Not open yet'}${S.phase === 'closing' ? ' · closing' : ''}<div class="bar"><i id="fr-daybar" style="width:${(day * 100).toFixed(0)}%"></i></div></div>`;
    root.querySelectorAll('.fr-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const keep = body.scrollTop;
    body.innerHTML = ({ floor: drawFloor, shop: drawShop, menu: drawMenu, crew: drawCrew }[tab])();
    body.scrollTop = keep;
    updateBars();
    if (S.summary && S.summary.day !== posted) { posted = S.summary.day; if (S.summary.revenue > 0) CG.submitScore && CG.submitScore(S.summary.revenue).catch(() => {}); }
  }
  function updateBars() {
    const t = now();
    body.querySelectorAll('[data-until]').forEach((el) => {
      const until = Number(el.dataset.until), total = Number(el.dataset.total), from = Number(el.dataset.from || 0);
      const k = el.dataset.fill === '1' ? Math.min(1, Math.max(0, (t - from) / total)) : Math.min(1, Math.max(0, (until - t) / total));
      el.firstElementChild.style.width = (k * 100).toFixed(1) + '%';
      if (el.dataset.fill !== '1') { el.classList.toggle('warn', k < 0.5 && k >= 0.25); el.classList.toggle('late', k < 0.25); }
    });
    const bar = document.getElementById('fr-daybar');
    if (bar && S.phase === 'open') bar.style.width = (Math.max(0, 1 - (t - S.dayStartAt) / S.dayMs) * 100).toFixed(0) + '%';
  }

  function drawFloor() {
    if (S.phase === 'closed') {
      const sm = S.summary;
      return `<div class="fr-hero"><div style="font-size:54px">🍽️</div><h2>${esc(S.name)}</h2>
        ${sm ? `<p><b>Day ${sm.day} is over.</b><br>${sm.served} served · $${sm.revenue} earned (tips $${sm.tips}) · ${sm.lost} guests lost<br>Best day so far: $${S.best.revenue}</p>` : `<p>A restaurant for the whole family. Seat guests, cook their orders and serve them before they lose patience. Hire staff, add tables and keep it running together.</p>`}
        <button type="button" class="fr-btn big" data-do="open">${S.day ? 'Open for day ' + (S.day + 1) : 'Open the restaurant'}</button></div>${logHtml()}`;
    }
    const waiting = S.customers.filter((c) => c.state === 'waiting');
    const used = S.customers.filter((c) => c.state === 'cooking').length;
    return `<h3>Waiting for a table</h3><div class="fr-queue">${waiting.map((c) => `<button type="button" class="fr-party" data-do="seat" data-cust="${c.id}"><b>${FACES[c.look % 8]}</b><small>${c.size > 1 ? 'Party of ' + c.size : 'Just one'} · ${FOOD[c.dish]}</small><div class="fr-bar" data-until="${c.until}" data-total="45000"><i></i></div></button>`).join('')}</div>
      <h3>Dining room</h3><div class="fr-tables">${S.tables.map(tableHtml).join('')}</div>
      <h3>Kitchen · ${used} of ${S.stoves} stove${S.stoves > 1 ? 's' : ''} busy</h3>
      ${S.phase === 'closing' ? '<p class="cg-hint">Closing time. Finish the last orders.</p>' : ''}${logHtml()}`;
  }
  function tableHtml(t) {
    const c = t.cust ? S.customers.find((x) => x.id === t.cust) : null;
    const head = `<span class="no">Table ${t.id}</span>`;
    if (!c) {
      if (t.dirty) return `<button type="button" class="fr-table dirty" data-do="clean" data-table="${t.id}">${head}<span class="who">🧽</span><span class="what">Needs clearing</span><span class="do">Clear it</span></button>`;
      return `<button type="button" class="fr-table free" data-do="free" data-table="${t.id}">${head}<span class="who">🪑</span><span class="what">Free</span><span class="do">Tap a waiting party</span></button>`;
    }
    const dish = S.dishes[c.dish].name.toLowerCase();
    const who = FACES[c.look % 8] + (c.size > 1 ? ' ×' + c.size : '');
    const pat = `<div class="fr-bar" data-until="${c.until}" data-total="65000"><i></i></div>`;
    if (c.state === 'thinking') return `<button type="button" class="fr-table" data-do="none">${head}<span class="who">${who}</span><span class="what">Choosing…</span><span class="do">…</span></button>`;
    if (c.state === 'ordered') return `<button type="button" class="fr-table act" data-do="cook" data-cust="${c.id}">${head}<span class="who">${who} ${FOOD[c.dish]}</span><span class="what">Wants ${dish}</span>${pat}<span class="do">Start cooking</span></button>`;
    if (c.state === 'cooking') return `<button type="button" class="fr-table" data-do="none">${head}<span class="who">${who} ${FOOD[c.dish]}</span><span class="what">Cooking…</span><div class="fr-bar" data-fill="1" data-from="${c.cookDone - S.dishes[c.dish].cookMs * (1 + 0.35 * (c.size - 1))}" data-until="${c.cookDone}" data-total="${S.dishes[c.dish].cookMs * (1 + 0.35 * (c.size - 1))}"><i></i></div>${pat}</button>`;
    if (c.state === 'ready') return `<button type="button" class="fr-table ready" data-do="serve" data-cust="${c.id}">${head}<span class="who">${who} ${FOOD[c.dish]}</span><span class="what">Ready!</span>${pat}<span class="do">Serve it</span></button>`;
    return `<button type="button" class="fr-table" data-do="none">${head}<span class="who">${who} 😋</span><span class="what">Eating</span><div class="fr-bar" data-fill="1" data-from="${c.eatDone - 14000}" data-until="${c.eatDone}" data-total="14000"><i></i></div></button>`;
  }
  const logHtml = () => `<h3>What is happening</h3><ul class="fr-log">${S.log.length ? S.log.map((l) => `<li class="${l.kind}">${esc(l.text)}</li>`).join('') : '<li>Nothing yet.</li>'}</ul>`;

  function drawShop() {
    const buy = (what, em, title, sub, cost) => `<div class="fr-card"><span class="em">${em}</span><div class="txt"><b>${title}</b><small>${sub}</small></div><button type="button" class="fr-btn" data-do="buy" data-what="${what}" ${cost == null || S.cash < cost ? 'disabled' : ''}>${cost == null ? 'Maxed' : '$' + cost}</button></div>`;
    let h = '<h3>Restaurant</h3>';
    h += buy('table', '🪑', `Table ${S.tables.length + 1}`, `${S.tables.length} tables now. More tables seat more guests.`, S.shop.tables);
    h += buy('stove', '🔥', `Stove ${S.stoves + 1}`, `${S.stoves} stove${S.stoves > 1 ? 's' : ''} now. Cook more dishes at once.`, S.shop.stoves);
    h += buy('decor', '🖼️', 'Decorations', `Level ${S.decor} of 5. Nicer rooms bring guests faster.`, S.shop.decor);
    h += '<h3>Staff</h3>';
    Object.keys(STAFF).forEach((r) => { h += buy('staff:' + r, S.staff[r] ? '🧑‍🍳' : '➕', (S.staff[r] ? 'Train the ' : 'Hire a ') + STAFF[r][0].toLowerCase(), `${STAFF[r][1]} Level ${S.staff[r]} of 3. Higher levels work faster.`, S.shop.staff[r]); });
    h += '<h3>New dishes</h3>';
    const locked = Object.keys(S.dishes).filter((d) => !S.menu[d]);
    h += locked.length ? locked.map((d) => buy('dish:' + d, FOOD[d], S.dishes[d].name, `Sells for about $${S.dishes[d].price}. Takes ${Math.round(S.dishes[d].cookMs / 1000)} seconds to cook.`, S.dishes[d].unlock)).join('') : '<p class="cg-hint">Every dish is on your menu.</p>';
    return h;
  }
  function drawMenu() {
    return '<h3>Menu and prices</h3>' + Object.keys(S.menu).map((d) => {
      const m = S.menu[d], dish = S.dishes[d];
      return `<div class="fr-card"><span class="em">${FOOD[d]}</span><div class="txt"><b>${dish.name}</b><small>$${Math.round(dish.price * m.mult)} each · ${Math.round(dish.cookMs / 1000)}s to cook. Pricey dishes earn more but guests like them less.</small></div>
        <div class="fr-step"><button type="button" data-do="mult" data-dish="${d}" data-d="-0.1" aria-label="Lower the price of ${dish.name}">−</button><span>${Math.round(m.mult * 100)}%</span><button type="button" data-do="mult" data-dish="${d}" data-d="0.1" aria-label="Raise the price of ${dish.name}">+</button></div>
        <button type="button" class="fr-btn ${m.on ? '' : 'ghost'}" data-do="dish-on" data-dish="${d}">${m.on ? 'On' : 'Off'}</button></div>`;
    }).join('');
  }
  function drawCrew() {
    const rows = Object.entries(S.by).sort((a, b) => (b[1].served + b[1].cooked + b[1].seated + b[1].cleaned) - (a[1].served + a[1].cooked + a[1].seated + a[1].cleaned));
    return `<h3>In the restaurant now</h3><div class="fr-crew">${S.crew.length ? S.crew.map((c) => `<span>${esc(c.name)}</span>`).join('') : '<p class="cg-hint">Just you.</p>'}</div>
      <h3>Hired staff</h3>${Object.keys(STAFF).map((r) => `<div class="fr-card"><div class="txt"><b>${STAFF[r][0]}</b><small>${S.staff[r] ? 'Level ' + S.staff[r] + ' of 3' : 'Not hired'}</small></div></div>`).join('')}
      <h3>Who did the work</h3>${rows.length ? `<table class="fr-rank"><tr><th>Name</th><th>Seated</th><th>Cooked</th><th>Served</th><th>Cleared</th></tr>${rows.map(([n, b]) => `<tr><td>${esc(n)}</td><td>${b.seated}</td><td>${b.cooked}</td><td>${b.served}</td><td>${b.cleaned}</td></tr>`).join('')}</table>` : '<p class="cg-hint">Nobody yet.</p>'}
      <h3>Name</h3><div class="fr-card"><div class="txt"><b>${esc(S.name)}</b><small>The name everyone sees.</small></div><button type="button" class="fr-btn ghost" data-do="rename">Rename</button></div>`;
  }

  // ---------- Taps ----------
  function onTap(e) {
    const b = e.target.closest('[data-do]');
    if (!b || !S) return;
    const d = b.dataset;
    switch (d.do) {
      case 'open': return act({ action: 'open' }, 'start');
      case 'seat': return act({ action: 'seat', cust: Number(d.cust) }, 'click');
      case 'cook': return act({ action: 'cook', cust: Number(d.cust) }, 'click');
      case 'serve': return act({ action: 'serve', cust: Number(d.cust) }, 'coin');
      case 'clean': return act({ action: 'clean', table: Number(d.table) }, 'click');
      case 'free': return say('Tap a waiting guest above to seat them.');
      case 'buy': return act({ action: 'buy', what: d.what }, 'coin');
      case 'mult': return act({ action: 'menu', dish: d.dish, mult: S.menu[d.dish].mult + Number(d.d) }, 'click');
      case 'dish-on': return act({ action: 'menu', dish: d.dish, on: !S.menu[d.dish].on }, 'click');
      case 'rename': return CG.modal && renameDialog();
      default: return null;
    }
  }
  function renameDialog() {
    CG.modal(`<h2>Name the restaurant</h2><p><input id="fr-name" type="text" maxlength="28" value="${esc(S.name)}" aria-label="Restaurant name" style="width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid var(--cg-line);font:inherit;font-size:16px;background:var(--cg-soft);color:var(--cg-ink);user-select:text"></p>
      <div style="display:flex;gap:8px"><button type="button" class="fr-btn ghost" id="fr-cancel" style="flex:1">Cancel</button><button type="button" class="fr-btn" id="fr-save" style="flex:1">Save</button></div>`);
    document.getElementById('fr-cancel').onclick = () => CG.closeModal();
    document.getElementById('fr-save').onclick = () => { const v = document.getElementById('fr-name').value; CG.closeModal(); act({ action: 'rename', name: v }); };
  }

  // ---------- Boot ----------
  CG.mount({
    id: 'restaurant', title: 'Family Restaurant', mode: 'race', scoreLabel: 'best day ($)',
    help: '<ul><li>One restaurant for the whole family. It keeps running while nobody is playing, and everyone sees the same thing.</li>' +
      '<li><b>Seat</b> waiting guests (tap them), <b>cook</b> their order when a stove is free, <b>serve</b> it while they are still happy, and <b>clear</b> the table afterwards.</li>' +
      '<li>Fast service means bigger tips and a better star rating. Angry guests who leave cost you stars.</li>' +
      '<li>Spend cash in the <b>Shop</b> on tables, stoves, decorations, new dishes and staff who do the boring jobs for you.</li>' +
      '<li>Change <b>prices</b> and turn dishes on or off in the <b>Menu</b> tab. Each day lasts 4 minutes. Your best day goes on the family scoreboard.</li></ul>',
    onReady(ctx) {
      root = document.createElement('div');
      root.className = 'fr';
      root.innerHTML = `<div class="fr-stats" id="fr-stats"></div><div class="fr-body" id="fr-body"><p class="cg-hint" style="text-align:center;padding:30px">Opening the kitchen…</p></div>
        <nav class="fr-tabs" aria-label="Restaurant sections">${[['floor', 'users', 'Floor'], ['shop', 'gem', 'Shop'], ['menu', 'hat', 'Menu'], ['crew', 'user', 'Crew']].map(([id, ic, t]) => `<button type="button" data-tab="${id}">${CG.icon(ic, 22)}${t}</button>`).join('')}</nav><div class="fr-toast" id="fr-toast" role="status"></div>`;
      ctx.root.appendChild(root);
      statsEl = root.querySelector('#fr-stats'); body = root.querySelector('#fr-body'); toastEl = root.querySelector('#fr-toast');
      root.querySelector('.fr-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; sig = ''; render(true); body.scrollTop = 0; } });
      body.addEventListener('click', onTap);
      const loop = async () => {
        if (document.visibilityState === 'visible') { await refresh(); hello(); }
        pollT = setTimeout(loop, 2000);
      };
      loop();
      setInterval(() => { if (S) updateBars(); }, 250);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    }
  });
  window.Restaurant = { state: () => S, tab: (t) => { tab = t; sig = ''; render(true); } };
})();
