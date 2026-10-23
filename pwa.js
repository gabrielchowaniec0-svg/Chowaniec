// Chowaniec app helper (loaded on every page): registers the service worker, captures the
// install prompt and manages push notifications. Exposes window.ChowaniecPWA.
(function () {
  'use strict';

  const PUSH_API = '/.netlify/functions/push';
  let installPrompt = null;
  let registration = null;
  let serverInfo = null;

  const changed = () => window.dispatchEvent(new Event('chowaniec-pwa-change'));

  function authHeaders(extra) {
    const user = window.getChowaniecUser ? window.getChowaniecUser() : null;
    return Object.assign({ 'X-Chowaniec-Key': (user && user.key) || '' }, extra || {});
  }

  function platform() {
    const ua = navigator.userAgent || '';
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function base64ToBytes(base64) {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  }

  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  async function getRegistration() {
    if (registration) return registration;
    if (!('serviceWorker' in navigator)) return null;
    registration = await navigator.serviceWorker.ready;
    return registration;
  }

  // Asks the server whether notifications are set up. Only a clear answer is remembered: if the
  // check itself fails (bad connection, expired sign-in) we say so and try again next time, instead
  // of wrongly telling people the family host still has to switch notifications on.
  async function getServerInfo() {
    if (serverInfo) return serverInfo;
    let failed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(PUSH_API, { headers: authHeaders(), credentials: 'same-origin', cache: 'no-store' });
        if (res.ok) {
          serverInfo = await res.json();
          return serverInfo;
        }
        failed = true;
      } catch (e) {
        failed = true;
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
    return failed ? { enabled: false, failed: true } : { enabled: false };
  }

  async function pushStatus() {
    if (!pushSupported()) return platform() === 'ios' && !isStandalone() ? 'needs-install' : 'unsupported';
    const info = await getServerInfo();
    if (info.failed) return 'error';
    if (!info.enabled || !info.publicKey) return 'not-configured';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'enabled' : 'disabled';
  }

  async function saveSubscription(subscription) {
    const res = await fetch(PUSH_API, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ subscription })
    });
    if (!res.ok) throw new Error('Could not save the subscription');
  }

  async function enablePush() {
    try {
      if (!pushSupported()) return 'error';
      const info = await getServerInfo();
      if (!info.publicKey) return 'error';
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        changed();
        return permission === 'denied' ? 'denied' : 'error';
      }
      const reg = await getRegistration();
      const subscription = (await reg.pushManager.getSubscription()) ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(info.publicKey) });
      await saveSubscription(subscription);
      changed();
      return 'enabled';
    } catch (e) {
      changed();
      return 'error';
    }
  }

  async function disablePush() {
    const reg = await getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      try {
        await fetch(PUSH_API, {
          method: 'DELETE',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
      } catch (e) {
        // Unsubscribing locally is enough; the server drops dead endpoints on the next send.
      }
      await sub.unsubscribe();
    }
    changed();
  }

  async function sendTestPush() {
    const res = await fetch(PUSH_API, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'test' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send a test notification');
    return { sent: data.sent || 0 };
  }

  // Keep the server's copy of this device's subscription fresh (once a day).
  async function resyncSubscription() {
    try {
      if (!pushSupported() || Notification.permission !== 'granted') return;
      const last = Number(localStorage.getItem('chowaniec_push_sync') || 0);
      if (Date.now() - last < 24 * 60 * 60 * 1000) return;
      const reg = await getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (!sub || !(window.getChowaniecUser && window.getChowaniecUser())) return;
      await saveSubscription(sub);
      localStorage.setItem('chowaniec_push_sync', String(Date.now()));
    } catch (e) {
      // try again next visit
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    changed();
  });


  // ---------- Friendly "turn on notifications" card ----------
  // Browsers only show their real "Allow notifications?" box after a tap, so we show a small card
  // with a button; tapping it opens that box. It appears on the hub and Group Chat until the person
  // allows or blocks notifications, or taps "Not now" (we then wait three days before asking again).
  const PROMPT_PAUSE_KEY = 'chowaniec_notify_prompt_until';
  const PROMPT_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
  let promptEl = null;

  function promptPaused() {
    try { return Date.now() < Number(localStorage.getItem(PROMPT_PAUSE_KEY) || 0); } catch (e) { return false; }
  }

  function promptPage() {
    const path = location.pathname.replace(/index\.html$/, '');
    return path === '/' ? 'hub' : /^\/group\/?$/.test(path) ? 'group' : null;
  }

  function removePrompt() {
    if (promptEl) { promptEl.remove(); promptEl = null; }
  }

  function showPrompt(page) {
    if (promptEl || document.getElementById('chowaniec-notify-card')) return;
    if (!document.getElementById('chowaniec-notify-style')) {
      const style = document.createElement('style');
      style.id = 'chowaniec-notify-style';
      style.textContent = [
        '#chowaniec-notify-card{position:fixed;left:12px;right:12px;z-index:9000;max-width:420px;margin:0 auto;padding:14px 14px 12px;border-radius:18px;',
        'background:#fff;color:#111;border:1px solid rgba(0,0,0,.08);box-shadow:0 12px 40px rgba(0,0,0,.22);font:14px/1.4 Outfit,system-ui,-apple-system,sans-serif;',
        'animation:chNotifyIn .35s cubic-bezier(.2,.9,.3,1.1)}',
        '#chowaniec-notify-card.at-top{top:calc(env(safe-area-inset-top,0px) + 66px)}',
        '#chowaniec-notify-card.at-bottom{bottom:calc(env(safe-area-inset-bottom,0px) + 14px)}',
        '#chowaniec-notify-card .cn-row{display:flex;gap:12px;align-items:flex-start}',
        '#chowaniec-notify-card .cn-ic{flex:none;width:38px;height:38px;border-radius:12px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px}',
        '#chowaniec-notify-card .cn-t{font-weight:600;font-size:15px;margin:0 0 2px}',
        '#chowaniec-notify-card .cn-p{margin:0;color:#555;font-size:13px}',
        '#chowaniec-notify-card .cn-actions{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}',
        '#chowaniec-notify-card button{font:inherit;font-weight:600;font-size:13px;border-radius:12px;padding:9px 16px;border:1px solid transparent;cursor:pointer;min-height:40px}',
        '#chowaniec-notify-card .cn-yes{background:#111;color:#fff}',
        '#chowaniec-notify-card .cn-no{background:transparent;color:#555;border-color:rgba(0,0,0,.14)}',
        '#chowaniec-notify-card button[disabled]{opacity:.6;cursor:default}',
        '@keyframes chNotifyIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}',
        '@media (prefers-color-scheme:dark){#chowaniec-notify-card{background:#1c1c20;color:#f2f2f4;border-color:rgba(255,255,255,.1)}',
        '#chowaniec-notify-card .cn-ic{background:#f2f2f4;color:#111}#chowaniec-notify-card .cn-p{color:#a8a8b0}',
        '#chowaniec-notify-card .cn-yes{background:#f2f2f4;color:#111}#chowaniec-notify-card .cn-no{color:#a8a8b0;border-color:rgba(255,255,255,.18)}}',
        'html[data-theme="dark"] #chowaniec-notify-card{background:#1c1c20;color:#f2f2f4;border-color:rgba(255,255,255,.1)}',
        'html[data-theme="dark"] #chowaniec-notify-card .cn-ic{background:#f2f2f4;color:#111}html[data-theme="dark"] #chowaniec-notify-card .cn-p{color:#a8a8b0}',
        'html[data-theme="dark"] #chowaniec-notify-card .cn-yes{background:#f2f2f4;color:#111}html[data-theme="dark"] #chowaniec-notify-card .cn-no{color:#a8a8b0;border-color:rgba(255,255,255,.18)}',
        'html[data-theme="light"] #chowaniec-notify-card{background:#fff;color:#111;border-color:rgba(0,0,0,.08)}',
        'html[data-theme="light"] #chowaniec-notify-card .cn-ic{background:#111;color:#fff}html[data-theme="light"] #chowaniec-notify-card .cn-p{color:#555}',
        'html[data-theme="light"] #chowaniec-notify-card .cn-yes{background:#111;color:#fff}html[data-theme="light"] #chowaniec-notify-card .cn-no{color:#555;border-color:rgba(0,0,0,.14)}'
      ].join('');
      document.head.appendChild(style);
    }
    const card = document.createElement('div');
    card.id = 'chowaniec-notify-card';
    card.className = page === 'group' ? 'at-top' : 'at-bottom';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Turn on notifications');
    card.innerHTML = '<div class="cn-row"><div class="cn-ic" aria-hidden="true">🔔</div><div>' +
      '<p class="cn-t">Get notified</p>' +
      '<p class="cn-p cn-msg">Hear about new family messages and @mentions, even when the app is closed.</p></div></div>' +
      '<div class="cn-actions"><button type="button" class="cn-no">Not now</button><button type="button" class="cn-yes">Turn on</button></div>';
    document.body.appendChild(card);
    promptEl = card;
    const yes = card.querySelector('.cn-yes');
    const no = card.querySelector('.cn-no');
    const msg = card.querySelector('.cn-msg');
    no.addEventListener('click', () => {
      try { localStorage.setItem(PROMPT_PAUSE_KEY, String(Date.now() + PROMPT_DELAY_MS)); } catch (e) { /* ignore */ }
      removePrompt();
    });
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      no.disabled = true;
      const result = await enablePush();   // this opens the browser's own "Allow notifications?" box
      if (result === 'enabled') {
        msg.textContent = 'Notifications are on ✓';
        card.querySelector('.cn-actions').remove();
        setTimeout(removePrompt, 1800);
      } else if (result === 'denied') {
        removePrompt();
      } else {
        msg.textContent = 'That didn’t work this time. You can try again from Settings → Notifications.';
        yes.disabled = false;
        no.disabled = false;
        yes.textContent = 'Try again';
      }
    });
  }

  let promptTries = 0;
  async function maybePrompt() {
    try {
      const page = promptPage();
      if (!page || promptEl || promptPaused()) return;
      if (!pushSupported() || Notification.permission !== 'default') return;
      const user = window.getChowaniecUser ? window.getChowaniecUser() : null;
      if (!user) {
        // Not signed in yet (the passcode box may be showing): look again shortly.
        if (promptTries++ < 30) setTimeout(maybePrompt, 2000);
        return;
      }
      if ((await pushStatus()) === 'disabled') showPrompt(page);
    } catch (e) {
      // never get in the way of the page
    }
  }
  window.addEventListener('chowaniec-pwa-change', () => {
    if (promptEl && Notification.permission !== 'default') removePrompt();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(maybePrompt, 1500));
  else setTimeout(maybePrompt, 1500);

  // ---------- Appearance (Settings → Appearance) ----------
  // Saved on this device. The theme is used by Group Chat and the Settings pages; "reduce animations"
  // calms movement on every page.
  const THEME_KEY = 'chowaniec_theme';
  const MOTION_KEY = 'chowaniec_reduce_motion';
  const readKey = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };

  function getTheme() {
    if (window.ChowaniecTheme) return window.ChowaniecTheme.current().mode;
    const v = readKey(THEME_KEY) || readKey('chowaniec_group_theme');
    return v === 'light' || v === 'dark' ? v : 'auto';
  }

  function applyTheme() {
    if (window.ChowaniecTheme) return;   // /theme.js owns light/dark when it is on the page
    const pref = getTheme();
    const dark = pref === 'dark' || (pref === 'auto' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && /^\/(group|settings)(\/|$)/.test(location.pathname)) meta.setAttribute('content', dark ? '#141417' : '#ffffff');
  }

  function setTheme(pref) {
    if (window.ChowaniecTheme) { window.ChowaniecTheme.setMode(pref === 'light' || pref === 'dark' ? pref : 'auto'); return; }
    try {
      if (pref === 'light' || pref === 'dark') localStorage.setItem(THEME_KEY, pref);
      else { localStorage.removeItem(THEME_KEY); localStorage.removeItem('chowaniec_group_theme'); }
    } catch (e) { /* storage blocked: still applies for this visit */ }
    applyTheme();
  }

  const getReduceMotion = () => (window.ChowaniecTheme ? window.ChowaniecTheme.current().motion === 'reduced' : readKey(MOTION_KEY) === '1');

  function applyReduceMotion() {
    let style = document.getElementById('chowaniec-reduce-motion');
    if (getReduceMotion()) {
      if (!style) {
        style = document.createElement('style');
        style.id = 'chowaniec-reduce-motion';
        style.textContent = '*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}';
        document.head.appendChild(style);
      }
    } else if (style) style.remove();
  }

  function setReduceMotion(on) {
    if (window.ChowaniecTheme) { const c = window.ChowaniecTheme.current(); window.ChowaniecTheme.save(Object.assign({}, c, { motion: on ? 'reduced' : 'full' })); return; }
    try { if (on) localStorage.setItem(MOTION_KEY, '1'); else localStorage.removeItem(MOTION_KEY); } catch (e) { /* ignore */ }
    applyReduceMotion();
  }

  applyReduceMotion();
  if (window.matchMedia) {
    const q = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => { if (getTheme() === 'auto' && /^\/settings(\/|$)/.test(location.pathname)) applyTheme(); };
    if (q.addEventListener) q.addEventListener('change', onScheme);
  }

  window.ChowaniecPWA = {
    getTheme, setTheme, getReduceMotion, setReduceMotion,
    isStandalone,
    platform,
    canPromptInstall: () => !!installPrompt,
    async promptInstall() {
      if (!installPrompt) return 'unavailable';
      const prompt = installPrompt;
      installPrompt = null;
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      changed();
      return outcome;
    },
    pushStatus,
    serverInfo: getServerInfo,
    enablePush,
    disablePush,
    sendTestPush
  };

  // Shared extras on every page: appearance, offline banner, quick jump, calls, and Bob the helper.
  (function loadExtras() {
    const add = (src) => { const el = document.createElement('script'); el.src = src; el.defer = true; document.head.appendChild(el); };
    add('/polish.js');
    add('/quickjump.js');
    add('/calls.js');
    if (/^\/(group|notes|calendar|lists)(\/|$)/.test(location.pathname)) add('/robot-float.js');
  })();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      registration = reg;
      resyncSubscription();
      changed();
    }).catch(() => {});
  }
})();
