// Chowaniec service worker: app shell for offline use, runtime caching, push notifications and the app icon badge.
//   Pages        network first, but after 3 s (or with no signal) the saved copy is shown; offline.html as a last resort
//   Scripts, styles, fonts (ours and the CDNs')   stale-while-revalidate, in a size-capped runtime cache
//   Chat photos  (/.netlify/functions/group?media=…, immutable)   cache first, capped
//   Other API calls are never cached here (the pages keep their own offline copies of chats and notes).
// Bumping VERSION throws the old caches away and re-downloads the shell, so every deploy busts stale scripts.
const VERSION = 'v8';
const SHELL_CACHE = `chowaniec-shell-${VERSION}`;
const RUNTIME_CACHE = `chowaniec-rt-${VERSION}`;
const MEDIA_CACHE = `chowaniec-media-${VERSION}`;
const RUNTIME_MAX = 80;
const MEDIA_MAX = 120;
const PAGE_TIMEOUT_MS = 3000;

// Must succeed for the worker to install.
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/badge-96.png', '/manifest.webmanifest'];
// The main pages: each is cached along with the scripts and styles it links to. Missing pages (a 404) are skipped.
const PAGES = ['/', '/group/', '/messages/', '/notes/', '/calendar/', '/lists/', '/games/', '/ai/', '/settings/', '/watch/', '/trophies/'];
// Shared scripts that pages add at run time (pwa.js loadExtras and friends), so they aren't in any page's HTML.
const SHARED = ['/theme.js', '/theme.css', '/theme-fx.js', '/onboarding.js', '/polish.js', '/quickjump.js', '/robot-float.js', '/robot.js', '/robot.css',
  '/haptics.js', '/pwa.js', '/calls.js', '/appnav.js', '/voice.js', '/design.css', '/passwords.js', '/auth-gate.js', '/directory.js', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

const sameOrigin = (url) => url.origin === self.location.origin;
// Pages are stored by path, so /group/?room=core opens from the saved /group/ shell.
const pageKey = (url) => {
  const p = url.pathname.replace(/index\.html$/, '');
  return new URL(p.endsWith('/') || /\.[a-z0-9]+$/i.test(p) ? p : `${p}/`, self.location.origin).href;
};

// Outside hosts whose scripts and styles the pages load (saved with the shell so pages work offline after one visit).
const CDN_HOSTS = ['cdn.tailwindcss.com', 'unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'cdnjs.cloudflare.com'];

// Scripts, styles and icons a page links to: ours, plus the CDN scripts and styles.
function assetsIn(html, base) {
  const out = new Set();
  const re = /<(script[^>]*?\ssrc|link[^>]*?\shref)=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[2], base);
      if (sameOrigin(u)) { if (/\.(js|css|png|svg|webmanifest|woff2?)$/i.test(u.pathname)) out.add(u.href); }
      else if (CDN_HOSTS.includes(u.hostname) && (/^script/i.test(m[1]) || /stylesheet/i.test(m[0]))) out.add(u.href);
    } catch (e) { /* ignore odd URLs */ }
  }
  return [...out];
}

// CDN files are fetched with CORS when the CDN allows it (a normal response), otherwise as an opaque one.
async function fetchAsset(href) {
  const url = new URL(href);
  if (sameOrigin(url)) return fetch(new Request(href, { cache: 'reload' }));
  try {
    const res = await fetch(new Request(href, { mode: 'cors', credentials: 'omit', cache: 'reload' }));
    if (res.ok) return res;
  } catch (e) { /* no CORS: fall back */ }
  return fetch(new Request(href, { mode: 'no-cors', cache: 'reload' }));
}

async function cacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
  const assets = new Set(SHARED.map((u) => new URL(u, self.location.origin).href));
  await Promise.all(PAGES.map(async (path) => {
    try {
      const res = await fetch(new Request(path, { cache: 'reload', credentials: 'same-origin' }));
      if (!res.ok || !/text\/html/.test(res.headers.get('content-type') || '')) return;
      const html = await res.clone().text();
      await cache.put(pageKey(new URL(path, self.location.origin)), res);
      assetsIn(html, new URL(path, self.location.origin)).forEach((a) => assets.add(a));
    } catch (e) { /* offline or missing: skip */ }
  }));
  await Promise.all([...assets].map(async (href) => {
    try {
      const res = await fetchAsset(href);
      if (res.ok || res.type === 'opaque') await cache.put(href, res);
    } catch (e) { /* skip */ }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE, MEDIA_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('chowaniec-') && !keep.includes(k)).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* ignore */ } }
    await self.clients.claim();
  })());
});

// Keeps a cache to at most `max` entries (oldest first out).
async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

async function handlePage(event) {
  const url = new URL(event.request.url);
  const key = pageKey(url);
  const shell = await caches.open(SHELL_CACHE);
  const network = (async () => {
    const preload = event.preloadResponse ? await event.preloadResponse.catch(() => null) : null;
    const res = preload || await fetch(event.request);
    if (res && res.ok && /text\/html/.test(res.headers.get('content-type') || '')) await shell.put(key, res.clone());
    return res;
  })();
  network.catch(() => null);
  event.waitUntil(network.catch(() => null));
  const cached = await shell.match(key) || await shell.match(event.request, { ignoreSearch: true });
  if (!cached) {
    try { return await network; } catch (e) { return (await shell.match('/offline.html')) || Response.error(); }
  }
  // Network first, but don't keep someone staring at a blank screen on a weak signal.
  const winner = await Promise.race([network.catch(() => null), timeout(PAGE_TIMEOUT_MS)]);
  return winner || cached;
}

async function staleWhileRevalidate(event, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then(async (res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(event.request, res.clone());
      trim(cacheName, max);
    }
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => null));
    return cached;
  }
  return network;
}

async function cacheFirst(event, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const res = await fetch(event.request);
  if (res.ok && res.status === 200) {
    await cache.put(event.request, res.clone());
    trim(cacheName, max);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!/^https?:$/.test(url.protocol)) return;

  if (sameOrigin(url) && url.pathname.startsWith('/.netlify/')) {
    // Chat photos never change: keep them for offline reading. Everything else from the API goes straight through.
    if (url.pathname === '/.netlify/functions/group' && url.searchParams.get('media') && !request.headers.get('range')) {
      event.respondWith(cacheFirst(event, MEDIA_CACHE, MEDIA_MAX));
    }
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(handlePage(event));
    return;
  }
  if (request.headers.get('range')) return;   // audio/video seeking: leave to the browser
  const dest = request.destination;
  const isAsset = ['script', 'style', 'font', 'image', 'manifest'].includes(dest) || /\.(js|css|woff2?|png|svg|jpg|webp|webmanifest)$/i.test(url.pathname);
  if (!isAsset) return;
  event.respondWith((async () => {
    // Shell files (ours and the CDN scripts the pages link to): serve the saved copy and refresh it quietly.
    const shell = await caches.open(SHELL_CACHE);
    const cached = await shell.match(request);
    if (cached) {
      event.waitUntil((sameOrigin(url) ? fetch(request) : fetchAsset(request.url))
        .then((res) => (res.ok || res.type === 'opaque' ? shell.put(request, res) : null)).catch(() => null));
      return cached;
    }
    // Everything else (fonts, images, scripts added later): stale-while-revalidate in the capped runtime cache.
    return staleWhileRevalidate(event, RUNTIME_CACHE, RUNTIME_MAX);
  })().catch(() => caches.match(request).then((r) => r || Response.error())));
});

// ---------- the app icon badge ----------
// Push payloads carry `badge` (the recipient's unread count, see netlify/lib/badge.mjs).
function setBadge(n) {
  const nav = self.navigator;
  try {
    if (typeof n !== 'number' || !isFinite(n)) return Promise.resolve();
    if (n > 0) {
      if (nav && nav.setAppBadge) return nav.setAppBadge(n).catch(() => {});
      if (self.registration.setAppBadge) return self.registration.setAppBadge(n).catch(() => {});
    } else {
      if (nav && nav.clearAppBadge) return nav.clearAppBadge().catch(() => {});
      if (self.registration.clearAppBadge) return self.registration.clearAppBadge().catch(() => {});
    }
  } catch (e) { /* not supported */ }
  return Promise.resolve();
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'badge') event.waitUntil(setBadge(Number(data.count) || 0));
  if (data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const badge = typeof data.badge === 'number' ? setBadge(data.badge) : Promise.resolve();
  const title = data.title || 'Chowaniec';
  if (data.call && data.call.id) {
    // An incoming call: stays on screen until answered or dismissed, with a long buzz on phones that allow it.
    event.waitUntil(Promise.all([badge, self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag || `call-${data.call.id}`,
      renotify: true,
      requireInteraction: true,
      vibrate: [600, 250, 600, 250, 600, 250, 600, 250, 600],
      data: { url: data.url || '/', callId: data.call.id },
      actions: [{ action: 'answer', title: 'Answer' }, { action: 'decline', title: 'Decline' }]
    })]));
    return;
  }
  event.waitUntil(Promise.all([badge, self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: !!data.tag && !data.silent,
    silent: !!data.silent,
    data: { url: data.url || '/', replyUrl: data.replyable ? `${data.url}${String(data.url).includes('?') ? '&' : '?'}reply=1` : null },
    actions: data.replyable ? [{ action: 'reply', title: 'Reply' }] : []
  })]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const info = event.notification.data || {};
  if (info.callId) {
    // Answer (or a tap on the notification) joins the call; Decline tells the caller and opens nothing.
    const action = event.action === 'decline' ? 'decline' : 'answer';
    const told = fetch('/.netlify/functions/call', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id: info.callId })
    }).catch(() => null);
    if (action === 'decline') { event.waitUntil(told); return; }
    event.waitUntil(Promise.all([told, openPage(new URL(info.url || '/', self.location.origin).href)]));
    return;
  }
  const wanted = event.action === 'reply' && info.replyUrl ? info.replyUrl : (info.url || '/');
  event.waitUntil(openPage(new URL(wanted, self.location.origin).href));
});

// Focuses an open Chowaniec window (moving it to `target`) or opens a new one.
function openPage(target) {
  return (async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if (client.url !== target && 'navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })();
}

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
