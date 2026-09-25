/* 100 Mimi Games service worker: lets the website be installed as an app and keeps working offline.
 *
 * On install it downloads every file listed in precache.json (written by the build, see vite.config.js), so the whole
 * arcade is available offline after the first visit. After that: pages are network-first (so a new release shows up as soon
 * as you are online), everything else same-origin is cache-first and refreshed in the background. Videos and range
 * requests go straight to the network. Cross-origin requests (the account server, PvP servers) are never touched. */
const CACHE = 'mimi-arcade-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const list = await (await fetch('precache.json', { cache: 'no-cache' })).json();
      // One by one so a single missing file doesn't stop the rest from being saved.
      await Promise.all(list.map((u) => cache.add(u).catch(() => {})));
    } catch { /* no list (dev server): the runtime cache below fills in as you play */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || /\.(mp4|webm)$/i.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put('./', fresh.clone());
        return fresh;
      } catch {
        return (await cache.match('./')) || (await cache.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || refresh;
  })());
});
