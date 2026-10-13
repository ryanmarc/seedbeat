/**
 * Seedbeat service worker: precaches the app shell so the game runs offline after one online load
 * (ARCHITECTURE.md §8). Built separately from the app by vite-plugin-sw.ts, which fills in
 * `__PRECACHE__` (every file the shell needs, hashed names) and `__VERSION__` (a hash of that list).
 *
 * Strategy: hashed assets are served cache-first (their names change when their contents do);
 * navigations are network-first with the cached index.html as the offline fallback, so an online
 * reload always sees the newest build. Everything else goes to the network untouched.
 */
/// <reference lib="webworker" />
declare const __PRECACHE__: string[];
declare const __VERSION__: string;
declare const __BASE__: string;

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `seedbeat-${__VERSION__}`;
const PRECACHE = __PRECACHE__;
const INDEX = __BASE__ + 'index.html';

sw.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('seedbeat-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match(INDEX)) ?? Response.error()));
    return;
  }
  if (!PRECACHE.includes(url.pathname)) return;
  e.respondWith(
    caches.match(url.pathname).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) void caches.open(CACHE).then((c) => c.put(url.pathname, res.clone()));
          return res;
        }),
    ),
  );
});
