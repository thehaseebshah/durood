// App-shell cache so the app opens offline; API calls always go to the network.
const CACHE = 'quest-v5';
const SHELL = ['/', '/app.js', '/style.css', '/i18n.js', '/icons.js', '/fonts/amiri-arabic.woff2', '/fonts/inter-latin.woff2', '/fonts/salawat.woff2', '/fonts/nastaliq-400.woff2', '/fonts/nastaliq-700.woff2', '/icons/icon-512.png', '/privacy.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/photos/')) return;
  // network first so deploys show up immediately; cache is the offline fallback. Pages are stored under '/' only, so a link's
  // ?reset= or ?confirm= token never stays on the device, and only good copies of the app's own files are kept.
  const page = e.request.mode === 'navigate';
  const key = page ? '/' : url.pathname;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && (page || SHELL.includes(key))) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return r;
    }).catch(() => caches.match(key).then((m) => m || caches.match('/'))),
  );
});

// push messages are encrypted by the server and carry a title, body and tag
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* plain text */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Seerah Quest', { body: d.body || '', tag: d.tag || 'quest', icon: '/icons/icon-192.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow(e.notification.data?.url || '/'))));
});
