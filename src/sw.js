const CACHE = 'deadair-v1-prototype-001';
const FILES = ['./', './index.html', './field.css', './app.mjs', './engine.mjs', './lending.mjs', './transport.mjs', './vendor/qrcode.js', './vendor/jsQR.js', './apps/reception/', './apps/reception/index.html', './apps/lending/', './apps/lending/index.html'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(cached => cached || fetch(event.request)));
});
