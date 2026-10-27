// App-shell cache so the app opens offline; API calls always go to the network.
const CACHE = 'durood-v1';
// fetched on install: what every member needs
const SHELL = ['/', '/app.js', '/style.css', '/i18n.js', '/icons.js', '/fonts/inter-latin.woff2', '/fonts/salawat.woff2', '/icons/icon-512.png', '/privacy.html', '/manifest.webmanifest', '/icons/icon-192.png'];
// kept once used, never fetched ahead: Urdu text and fonts, and the welcome durood's font (an English member would otherwise download ~250 KB for nothing)
const ON_USE = ['/i18n-ur.js', '/fonts/nastaliq-ur-400.woff2', '/fonts/nastaliq-ur-700.woff2', '/fonts/amiri-durood.woff2'];

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
      if (r.ok && (page || SHELL.includes(key) || ON_USE.includes(key))) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return r;
    }).catch(() => caches.match(key).then((m) => m || caches.match('/'))),
  );
});
