// Keeps the app shell available when the phone has a weak or no connection.
// Network first, so users always get the latest version when online. Only static
// files are stored; data from the server (marks, fees, messages...) is never cached.
const CACHE = 'acalyze-shell-v2';
const STATIC = /\.(?:css|js|png|svg|webmanifest|woff2?)$/;

self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.add('/app/'))); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const isPage = req.mode === 'navigate' && url.pathname.startsWith('/app'), isStatic = STATIC.test(url.pathname);
  if (!isPage && !isStatic) return;   // API calls go straight to the network
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(isPage ? '/app/' : req, copy)); }
    return res;
  }).catch(async () => (await caches.match(isPage ? '/app/' : req)) || Response.error()));
});
