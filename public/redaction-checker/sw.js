// Redaction Checker offline support. Caches only the app's own files.
// PDFs you check are never cached, stored or sent anywhere.
const CACHE = 'redaction-checker-v2';
const CORE = [
  '/redaction-checker/',
  '/redaction-checker/vendor/pdf.min.js',
  '/redaction-checker/vendor/pdf.worker.min.js',
  '/redaction-checker/vendor/pdf-lib.min.js',
  '/redaction-checker/manifest.webmanifest',
  '/redaction-checker/icons/icon-192.png',
  '/redaction-checker/icons/icon-512.png',
  '/redaction-checker/icons/favicon-64.png',
  '/sentinel/assets/sentinel_logo.JPG'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('redaction-checker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The page itself: try the network first so updates show up, fall back to the saved copy offline.
  if (req.mode === 'navigate' && url.origin === location.origin && url.pathname.startsWith('/redaction-checker')) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/redaction-checker/', copy)); }
        return res;
      }).catch(() => caches.match('/redaction-checker/'))
    );
    return;
  }

  // App files and fonts: saved copy first, refreshed in the background.
  const ours = url.origin === location.origin && CORE.includes(url.pathname);
  const fonts = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (ours || fonts) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
