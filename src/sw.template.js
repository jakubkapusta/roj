// Offline cache for Rój. Generated into dist/sw.js at build time (see vite.config.ts).
const CACHE = 'roj-__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('roj-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // fresh page when online, cached one in a tunnel
    e.respondWith(fetch(req).catch(() => caches.match('./', { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return r;
    })),
  );
});
