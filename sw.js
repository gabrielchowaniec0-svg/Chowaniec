// Chowaniec service worker: offline fallback, light caching, and push notifications.
const VERSION = 'v3';
const CACHE = `chowaniec-${VERSION}`;
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/badge-96.png', '/manifest.webmanifest'];
// The app shell: shared scripts and the main pages, cached on a best-effort basis so the app opens instantly
// and still shows something when you have no signal.
const SHELL = ['/', '/group/', '/messages/', '/ai/', '/notes/', '/calendar/', '/lists/', '/settings/',
  '/polish.js', '/quickjump.js', '/robot-float.js', '/robot.js', '/robot.css', '/haptics.js', '/pwa.js', '/passwords.js', '/auth-gate.js', '/directory.js',
  '/group/group.js', '/group/extras.js', '/group/group.css', '/calendar/calendar.js', '/lists/lists.js', '/settings/settings.js', '/settings/settings.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(PRECACHE);
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('chowaniec-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache API calls.
  if (url.origin === self.location.origin && url.pathname.startsWith('/.netlify/')) return;

  if (request.mode === 'navigate') {
    // Pages: always try the network first so updates show up immediately.
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
        return response;
      } catch (e) {
        return (await caches.match(request)) || (await caches.match('/offline.html'));
      }
    })());
    return;
  }

  // Our own scripts and styles: network first (so an update is never hidden behind an old copy), cache when offline or slow.
  if (url.origin === self.location.origin && /\.(js|css)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await Promise.race([
          fetch(request),
          new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 5000))
        ]);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (e) {
        return (await cache.match(request)) || fetch(request);
      }
    })());
    return;
  }

  // Fonts and images: serve from cache when available, refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
      if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached || network;
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Chowaniec';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/', replyUrl: data.replyable ? `${data.url}${String(data.url).includes('?') ? '&' : '?'}reply=1` : null },
    actions: data.replyable ? [{ action: 'reply', title: 'Reply' }] : []
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const info = event.notification.data || {};
  const wanted = event.action === 'reply' && info.replyUrl ? info.replyUrl : (info.url || '/');
  const target = new URL(wanted, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if (client.url !== target && 'navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// Browsers occasionally rotate push subscriptions; renew it with the server (signed in via cookie).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('/.netlify/functions/push', { credentials: 'same-origin' });
    const { publicKey } = await res.json();
    if (!publicKey) return;
    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToBytes(publicKey)
    });
    await fetch('/.netlify/functions/push', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });
  })());
});

function base64ToBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
