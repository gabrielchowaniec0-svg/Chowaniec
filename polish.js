// Shared polish for every Chowaniec page (loaded by pwa.js):
//   - appearance choices kept on this device: accent colour and text size (reduce-motion lives in pwa.js)
//   - an "offline" banner, skeleton loaders (CSS classes .sk / .sk-line) and confetti
//   - a birthday banner on the day, and a few accessibility fixes (names for icon-only buttons)
// Exposes window.ChowaniecPolish { accent, confetti, birthdays, celebrate, skeleton }.
(function () {
  'use strict';
  const path = location.pathname;
  const isMeet = path.startsWith('/meet');
  const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } };

  // ---- Appearance
  const ACCENTS = {
    violet: '#6d28d9', blue: '#2563eb', teal: '#0f766e', green: '#15803d', rose: '#be123c', orange: '#c2410c'
  };
  const TEXT_SIZES = { normal: '100%', large: '112.5%', xl: '125%' };

  function applyAppearance() {
    const root = document.documentElement;
    const accent = get('chowaniec_accent', '');
    if (ACCENTS[accent]) {
      root.setAttribute('data-accent', accent);
      root.style.setProperty('--chowaniec-accent', ACCENTS[accent]);
    } else {
      root.removeAttribute('data-accent');
      root.style.removeProperty('--chowaniec-accent');
    }
    const size = get('chowaniec_textsize', 'normal');
    root.style.fontSize = TEXT_SIZES[size] && size !== 'normal' ? TEXT_SIZES[size] : '';
  }

  const css = document.createElement('style');
  css.id = 'polish-css';
  css.textContent = `
html[data-accent] { accent-color: var(--chowaniec-accent); --accent: var(--chowaniec-accent); --accent-ink: #fff; }
html[data-accent] ::selection { background: color-mix(in srgb, var(--chowaniec-accent) 30%, transparent); }
html[data-accent] .mine .bubble { background: var(--chowaniec-accent); color: #fff; }
.sk, .sk-line { background: linear-gradient(90deg, rgba(128,128,128,.14) 25%, rgba(128,128,128,.26) 37%, rgba(128,128,128,.14) 63%); background-size: 400% 100%; animation: sk-shimmer 1.4s ease infinite; border-radius: 10px; }
.sk-line { height: 14px; margin: 10px 0; }
.sk-line.short { width: 55%; }
@keyframes sk-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
#cz-offline { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 8px); transform: translate(-50%, -140%); z-index: 2147483000; max-width: calc(100vw - 24px); padding: 8px 16px; border-radius: 999px; background: #111827; color: #fff; font: 500 13px/1.3 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.25); transition: transform .35s cubic-bezier(.34,1.3,.5,1), opacity .25s; opacity: 0; pointer-events: none; text-align: center; }
#cz-offline.show { transform: translate(-50%, 0); opacity: 1; }
#cz-offline.back { background: #166534; }
#cz-bday { position: fixed; left: 12px; right: 12px; top: calc(env(safe-area-inset-top, 0px) + 8px); z-index: 2147482000; margin: 0 auto; max-width: 460px; display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px; border-radius: 16px; background: linear-gradient(135deg, #fde68a, #fbcfe8); color: #3b0764; font: 600 14px/1.35 system-ui, sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.2); animation: cz-drop .5s cubic-bezier(.34,1.3,.5,1); }
#cz-bday button { margin-left: auto; min-width: 36px; min-height: 36px; border: 0; border-radius: 999px; background: rgba(255,255,255,.6); color: inherit; font-size: 16px; cursor: pointer; }
@keyframes cz-drop { from { transform: translateY(-120%); opacity: 0; } to { transform: none; opacity: 1; } }
#cz-confetti { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483100; }
`;
  document.head.appendChild(css);
  applyAppearance();
  window.addEventListener('storage', applyAppearance);

  // ---- Offline banner
  let offlineEl = null;
  let offlineTimer = null;
  function banner(text, cls, autoHide) {
    if (!offlineEl) {
      offlineEl = document.createElement('div');
      offlineEl.id = 'cz-offline';
      offlineEl.setAttribute('role', 'status');
      offlineEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(offlineEl);
    }
    offlineEl.textContent = text;
    offlineEl.className = (cls || '');
    void offlineEl.offsetWidth;
    offlineEl.classList.add('show');
    clearTimeout(offlineTimer);
    if (autoHide) offlineTimer = setTimeout(() => offlineEl.classList.remove('show'), autoHide);
  }
  function onlineChange() {
    if (navigator.onLine) { if (offlineEl && offlineEl.classList.contains('show')) banner('Back online', 'back', 2200); }
    else banner('You’re offline. Some things may not load or send until you’re back.', '');
  }
  window.addEventListener('online', onlineChange);
  window.addEventListener('offline', onlineChange);
  document.addEventListener('DOMContentLoaded', () => { if (!navigator.onLine) onlineChange(); });

  // ---- Skeletons
  function skeleton(el, lines) {
    if (!el) return;
    const n = lines || 4;
    el.setAttribute('aria-busy', 'true');
    el.innerHTML = Array.from({ length: n }, (_, i) => `<div class="sk-line${i % 3 === 2 ? ' short' : ''}"></div>`).join('');
  }

  // ---- Confetti (a short burst, skipped for people who prefer less motion)
  function confetti(count) {
    const reduce = get('chowaniec_reduce_motion', '') === '1' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduce) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'cz-confetti';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    canvas.width = innerWidth * ratio;
    canvas.height = innerHeight * ratio;
    const colors = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
    const bits = Array.from({ length: count || 90 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * .65,
      vx: (Math.random() - .5) * 11, vy: -Math.random() * 13 - 5,
      s: Math.random() * 6 + 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[Math.floor(Math.random() * colors.length)]
    }));
    const start = performance.now();
    (function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      bits.forEach((b) => {
        b.vy += .35; b.x += b.vx; b.y += b.vy; b.vx *= .99; b.r += b.vr;
        ctx.save();
        ctx.translate(b.x * ratio, b.y * ratio);
        ctx.rotate(b.r);
        ctx.globalAlpha = Math.max(0, 1 - t / 2600);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.s * ratio / 2, -b.s * ratio / 4, b.s * ratio, b.s * ratio / 2);
        ctx.restore();
      });
      if (t < 2600) requestAnimationFrame(frame); else canvas.remove();
    })(start);
  }

  // Tells Bob and the page that something worth celebrating happened.
  function celebrate(why) {
    confetti();
    if (window.ChowaniecHaptics) window.ChowaniecHaptics.tap('success');
    window.dispatchEvent(new CustomEvent('chowaniec-celebrate', { detail: { why: why || '' } }));
  }

  // ---- Birthdays
  const signedIn = () => (window.getChowaniecUser ? window.getChowaniecUser() : null);
  async function birthdays() {
    const user = signedIn();
    if (!user || !user.key) return [];
    try {
      const cached = JSON.parse(sessionStorage.getItem('chowaniec_birthdays') || 'null');
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.list;
    } catch (e) { /* ignore */ }
    try {
      const res = await fetch('/.netlify/functions/birthdays', { headers: { 'X-Chowaniec-Key': user.key }, credentials: 'same-origin' });
      if (!res.ok) return [];
      const list = (await res.json()).birthdays || [];
      try { sessionStorage.setItem('chowaniec_birthdays', JSON.stringify({ at: Date.now(), list })); } catch (e) { /* ignore */ }
      return list;
    } catch (e) {
      return [];
    }
  }
  const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  // Days until the next birthday (0 = today).
  function daysUntil(b, from) {
    const now = from || new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let next = new Date(now.getFullYear(), b.month - 1, b.day);
    if (next < today) next = new Date(now.getFullYear() + 1, b.month - 1, b.day);
    return Math.round((next - today) / 86400000);
  }
  async function birthdayBanner() {
    if (isMeet || get('chowaniec_bday_seen', '') === dayKey()) return;
    const today = (await birthdays()).filter((b) => daysUntil(b) === 0);
    if (!today.length) return;
    const names = today.map((b) => b.name);
    const el = document.createElement('div');
    el.id = 'cz-bday';
    el.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = `🎂 Happy birthday, ${names.join(' and ')}!`;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss the birthday banner');
    close.addEventListener('click', () => { el.remove(); set('chowaniec_bday_seen', dayKey()); });
    el.append(text, close);
    document.body.appendChild(el);
    celebrate('birthday');
  }

  // ---- Accessibility: give icon-only buttons and links a spoken name
  const ICON_NAMES = { x: 'Close', plus: 'Add', search: 'Search', settings: 'Settings', trash: 'Delete', 'trash-2': 'Delete', pencil: 'Edit', 'square-pen': 'New', send: 'Send', mic: 'Microphone', 'chevron-left': 'Back', 'chevron-right': 'Next', 'arrow-left': 'Back', menu: 'Menu', copy: 'Copy', 'more-horizontal': 'More options', 'more-vertical': 'More options', bell: 'Notifications', share: 'Share', 'share-2': 'Share', check: 'Done', image: 'Photo', paperclip: 'Attach', smile: 'Emoji', link: 'Link', calendar: 'Calendar', 'calendar-days': 'Calendar', 'panel-left': 'Open menu' };
  function labelIcons(root) {
    (root || document).querySelectorAll('button:not([aria-label]):not([aria-labelledby]), a[href]:not([aria-label]):not([aria-labelledby]), [role="button"]:not([aria-label])').forEach((el) => {
      if ((el.textContent || '').trim()) return;
      const title = el.getAttribute('title');
      if (title) { el.setAttribute('aria-label', title); return; }
      const icon = el.querySelector('[data-lucide]');
      const name = icon && ICON_NAMES[icon.getAttribute('data-lucide')];
      if (name) el.setAttribute('aria-label', name);
    });
  }
  let labelTimer = null;
  function watchLabels() {
    labelIcons();
    new MutationObserver(() => { clearTimeout(labelTimer); labelTimer = setTimeout(labelIcons, 400); }).observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    watchLabels();
    // Come back from a notification's "Reply" button straight into the box (group chat).
    if (path.startsWith('/group') && /[?&]reply=1\b/.test(location.search)) {
      let tries = 0;
      const t = setInterval(() => {
        const box = document.getElementById('composer-input') || document.querySelector('textarea');
        if (box && box.offsetParent) { box.focus(); clearInterval(t); }
        if (++tries > 40) clearInterval(t);
      }, 250);
    }
    setTimeout(birthdayBanner, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.ChowaniecPolish = { ACCENTS, TEXT_SIZES, applyAppearance, confetti, celebrate, skeleton, birthdays, daysUntil, get, set };
})();
