// Group chat helpers that sit on top of the chat without touching its code:
//   - smart suggestions under messages ("Add to calendar?" when a message mentions a day and time,
//     "Create a sign-up sheet?" when someone asks who can bring something)
//   - celebrations (confetti + Bob) when a poll has everyone's vote, or a sign-up sheet gets full
(function () {
  'use strict';
  const G = () => window.ChowaniecGroup;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } return null; };

  // ---- understanding a message
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const EVENT_WORDS = /\b(dinner|lunch|brunch|breakfast|rehearsal|practice|meeting|call|party|show|performance|shoot|recital|game|appointment|trip|birthday|class|dress rehearsal|tech|audition|picnic|movie|concert)\b/i;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function findDate(text, now) {
    const t = text.toLowerCase();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const plus = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
    if (/\btonight\b|\btoday\b/.test(t)) return plus(0);
    if (/\btomorrow\b/.test(t)) return plus(1);
    const mon = t.match(new RegExp(`\\b(${MONTHS.map((m) => m.slice(0, 3)).join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
    if (mon) {
      const month = MONTHS.findIndex((m) => m.startsWith(mon[1]));
      let d = new Date(base.getFullYear(), month, Number(mon[2]));
      if (d < base) d = new Date(base.getFullYear() + 1, month, Number(mon[2]));
      if (d.getMonth() === month) return d;
    }
    const num = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (num && Number(num[1]) >= 1 && Number(num[1]) <= 12 && Number(num[2]) >= 1 && Number(num[2]) <= 31) {
      let d = new Date(base.getFullYear(), Number(num[1]) - 1, Number(num[2]));
      if (d < base) d = new Date(base.getFullYear() + 1, Number(num[1]) - 1, Number(num[2]));
      return d;
    }
    const wd = t.match(new RegExp(`\\b(next\\s+|this\\s+|on\\s+)?(${DAYS.join('|')})\\b`));
    if (wd) {
      const target = DAYS.indexOf(wd[2]);
      let diff = (target - base.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      return plus(diff);
    }
    return null;
  }

  function findTime(text) {
    const t = text.toLowerCase();
    let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/);
    if (m) {
      let h = Number(m[1]) % 12;
      if (/^p/.test(m[3])) h += 12;
      if (Number(m[1]) > 12 || Number(m[1]) < 1) return '';
      return `${pad(h)}:${m[2] || '00'}`;
    }
    m = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:\/|people|of|items|dollars|%))/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
      const h = Number(m[1]);
      return `${pad(h < 7 ? h + 12 : h)}:${m[2] || '00'}`;       // "at 6" most likely means the evening
    }
    if (/\bnoon\b/.test(t)) return '12:00';
    return '';
  }

  function eventIdea(text) {
    if (text.length < 8 || text.length > 600) return null;
    const date = findDate(text, new Date());
    if (!date) return null;
    const time = findTime(text);
    if (!time && !EVENT_WORDS.test(text)) return null;
    const word = text.match(EVENT_WORDS);
    let title = word ? word[1].replace(/^./, (c) => c.toUpperCase()) : text.replace(/\s+/g, ' ').slice(0, 50);
    return { title, date: ymd(date), time };
  }

  const BRING = /\b(who(?:'s| is| can| could| wants to| will)?\s+(?:bring|make|get|pick up|host|drive|help|cook|bake|volunteer)\w*|(?:can|could|will)\s+(?:someone|anyone|somebody|anybody)\s+(?:bring|make|get|pick up|drive|help|cook|bake)\w*|(?:need|looking for)\s+(?:someone|volunteers?|a driver|help)|who(?:'s| is) bringing|sign[- ]?up)\b/i;
  const sheetIdea = (text) => (text.length >= 10 && text.length <= 400 && BRING.test(text) && /\?|need|looking/i.test(text) ? text : null);

  // ---- drawing the chips
  const dismissed = () => new Set(store('chowaniec_suggest_off') || []);
  function dismiss(id) { const d = [...dismissed(), id].slice(-300); store('chowaniec_suggest_off', d); }

  function scan() {
    const g = G();
    if (!g || !g.state || !g.state.messages) return;
    const off = dismissed();
    g.state.messages.slice(-25).forEach((m) => {
      if (!m || !m.id || m.kind !== 'user' || !m.text || m._pending || m.poll || m.sheet || off.has(m.id)) return;
      const row = document.querySelector(`#messages .msg-row[data-id="${CSS.escape(m.id)}"] .msg-col`);
      if (!row || row.querySelector('.sg-bar')) return;
      const ev = eventIdea(m.text);
      const sheet = !ev && sheetIdea(m.text);
      if (!ev && !sheet) return;
      const bar = document.createElement('div');
      bar.className = 'sg-bar';
      bar.dataset.id = m.id;
      if (ev) {
        const nice = new Date(`${ev.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        bar.innerHTML = `<button type="button" class="sg-chip" data-sg="event" aria-label="Add ${esc(ev.title)} on ${esc(nice)} to the calendar">📅 Add to calendar? <span>${esc(nice)}${ev.time ? ' · ' + esc(ev.time) : ''}</span></button><button type="button" class="sg-x" data-sg="x" aria-label="Dismiss this suggestion">×</button>`;
        bar._ev = ev;
      } else {
        bar.innerHTML = `<button type="button" class="sg-chip" data-sg="sheet" aria-label="Create a sign-up sheet from this message">📝 Create a sign-up sheet?</button><button type="button" class="sg-x" data-sg="x" aria-label="Dismiss this suggestion">×</button>`;
        bar._text = m.text;
      }
      row.appendChild(bar);
    });
  }

  function openSheetForm(bar) {
    if (bar.querySelector('form')) return;
    const g = G();
    const form = document.createElement('form');
    form.className = 'sg-form';
    const guess = String(bar._text || '').replace(/^(hey|hi|so)[ ,]+/i, '').replace(/\?+$/, '').slice(0, 60);
    form.innerHTML = `<label>Sheet name<input type="text" name="title" maxlength="100" value="${esc(guess)}"></label>
      <label>What people can sign up for (one per line)<textarea name="slots" rows="3" maxlength="800"></textarea></label>
      <div class="sg-row"><button type="submit" class="sg-chip sg-go">Create sheet</button><button type="button" class="sg-chip" data-sg="cancel">Cancel</button></div><div class="sg-msg" role="alert"></div>`;
    bar.appendChild(form);
    form.querySelector('textarea').focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const slots = form.slots.value.split('\n').map((x) => x.trim()).filter(Boolean);
      const msg = form.querySelector('.sg-msg');
      if (!form.title.value.trim() || !slots.length) { msg.textContent = 'Add a name and at least one thing to sign up for.'; return; }
      try {
        await g.api('/.netlify/functions/signup', { method: 'POST', body: { action: 'create', title: form.title.value, slots, room: g.room() } });
        dismiss(bar.dataset.id);
        bar.remove();
        if (g.toast) g.toast('Sign-up sheet posted.');
        if (g.hap) g.hap('success');
      } catch (err) { msg.textContent = (err && err.message) || 'Could not create the sheet.'; }
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sg]');
    if (!b) return;
    const bar = b.closest('.sg-bar');
    if (!bar) return;
    e.stopPropagation();
    const kind = b.dataset.sg;
    if (kind === 'x') { dismiss(bar.dataset.id); bar.remove(); }
    else if (kind === 'cancel') { const f = bar.querySelector('form'); if (f) f.remove(); }
    else if (kind === 'sheet') openSheetForm(bar);
    else if (kind === 'event' && bar._ev) {
      const ev = bar._ev;
      const q = new URLSearchParams({ add: '1', title: ev.title, date: ev.date, room: G().room() });
      if (ev.time) q.set('time', ev.time);
      location.href = `/calendar/?${q}`;
    }
  }, true);

  // ---- celebrations
  const seen = () => store('chowaniec_celebrated') || {};
  let baseline = false;
  const pending = {};
  async function celebrationsScan() {
    const g = G();
    if (!g || !g.state || !g.state.loaded) return;
    const done = seen();
    const mark = (key) => { done[key] = Date.now(); const keys = Object.keys(done); if (keys.length > 200) delete done[keys[0]]; store('chowaniec_celebrated', done); };
    const fire = (key, why) => {
      if (done[key]) return;
      mark(key);
      if (baseline && window.ChowaniecPolish) window.ChowaniecPolish.celebrate(why);
    };
    const family = (g.state.people || []).filter((n) => !g.isAiName || !g.isAiName(n));
    g.state.messages.slice(-60).forEach((m) => {
      if (!m.poll || !family.length) return;
      const voters = new Set();
      m.poll.options.forEach((o) => o.votes.forEach((v) => voters.add(v)));
      const everyone = family.every((n) => [...voters].some((v) => g.sameName(v, n)));
      if (m.poll.closed || everyone) fire(`poll:${m.id}`, 'poll');
    });
    try {
      const data = await g.api(`/.netlify/functions/signup?room=${encodeURIComponent(g.room())}`);
      (data.sheets || []).forEach((sh) => { if (sh.slots.length && sh.slots.every((s) => s.claimedBy)) fire(`sheet:${sh.id}`, 'sheet'); });
    } catch (e) { /* offline: try next time */ }
    baseline = true;
  }

  function start() {
    const css = document.createElement('style');
    css.textContent = `
.sg-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 8px 0; max-width: 100%; }
.sg-chip { min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid rgba(124,58,237,.35); background: rgba(124,58,237,.08); color: inherit; font: 600 12.5px system-ui, sans-serif; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background .2s, transform .2s; }
.sg-chip span { font-weight: 500; opacity: .7; }
.sg-chip:hover, .sg-chip:focus-visible { background: rgba(124,58,237,.18); outline: none; }
.sg-chip:active { transform: scale(.96); }
.sg-go { background: var(--accent, #6d28d9); color: var(--accent-ink, #fff); border-color: transparent; }
.sg-x { width: 36px; height: 36px; border: 0; background: transparent; color: inherit; opacity: .5; font-size: 18px; border-radius: 999px; cursor: pointer; }
.sg-x:hover { opacity: 1; }
.sg-form { display: grid; gap: 8px; width: min(340px, 100%); padding: 10px; border-radius: 14px; border: 1px solid rgba(128,128,128,.3); background: rgba(128,128,128,.08); font-size: 12px; }
.sg-form label { display: grid; gap: 4px; }
.sg-form input, .sg-form textarea { font: 16px system-ui, sans-serif; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
.sg-row { display: flex; gap: 6px; } .sg-msg { color: #dc2626; min-height: 0; }
.sg-bar { animation: sg-in .3s ease; } @keyframes sg-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }`;
    document.head.appendChild(css);
    const list = document.getElementById('messages');
    let t = null;
    const again = () => { clearTimeout(t); t = setTimeout(scan, 250); };
    if (list) new MutationObserver(again).observe(list, { childList: true, subtree: true });
    setInterval(() => { scan(); }, 4000);
    setTimeout(celebrationsScan, 3000);
    setInterval(() => { if (!document.hidden) celebrationsScan(); }, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
