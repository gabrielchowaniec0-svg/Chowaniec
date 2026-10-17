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

  async function getServerInfo() {
    if (serverInfo) return serverInfo;
    try {
      const res = await fetch(PUSH_API, { headers: authHeaders() });
      serverInfo = res.ok ? await res.json() : { enabled: false };
    } catch (e) {
      serverInfo = { enabled: false };
    }
    return serverInfo;
  }

  async function pushStatus() {
    if (!pushSupported()) return platform() === 'ios' && !isStandalone() ? 'needs-install' : 'unsupported';
    const info = await getServerInfo();
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

  window.ChowaniecPWA = {
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
    enablePush,
    disablePush,
    sendTestPush
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      registration = reg;
      resyncSubscription();
      changed();
    }).catch(() => {});
  }
})();
