// Lets the page be installed and keeps it opening when the connection is poor. Counting itself always needs the network.
const CACHE = 'tasbeeh-v1';
const SHELL = ['/style.css', '/theme.js', '/app.js', '/stats.js', '/pwa.js', '/favicon.svg', '/pattern.svg', '/cities-ur.json', '/icons/icon-192.png', '/icons/icon-512.png',
  '/fonts/inter-latin.woff2', '/fonts/amiri-durood.woff2', '/fonts/salawat.woff2', '/fonts/nastaliq-ur-400.woff2', '/fonts/nastaliq-ur-700.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => { const c = await caches.open(CACHE); await Promise.allSettled(SHELL.map((u) => c.add(u))); await self.skipWaiting(); })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })());
});

async function refresh(req, cache) {
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') await cache.put(req, res.clone());
  return res;
}
self.addEventListener('fetch', (event) => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // never keep the admin pages, the counting API or the health check
  if (url.pathname.startsWith('/admin') || url.pathname === '/healthz' || (url.pathname.startsWith('/api/') && url.pathname !== '/api/cities')) return;
  if (req.mode === 'navigate') {
    // pages: the network first (so they are always current), the last copy when offline
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try { return await refresh(req, cache); } catch { return (await cache.match(req)) || (await cache.match('/')) || Response.error(); }
    })());
    return;
  }
  // files: show what is kept at once and update it in the background
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), hit = await cache.match(req);
    const update = refresh(req, cache).catch(() => null);
    return hit || (await update) || Response.error();
  })());
});
