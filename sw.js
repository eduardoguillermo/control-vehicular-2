const CACHE = 'control-vehicular-v0.48-dev';
const ASSETS = [
  '/control-vehicular-2/',
  '/control-vehicular-2/index.html',
  '/control-vehicular-2/app.js',
  '/control-vehicular-2/drive-sync.js',
  '/control-vehicular-2/style.css',
  '/control-vehicular-2/manifest.json',
  '/control-vehicular-2/instructivo.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, {cache:'no-store'}).then(res => {
      if(res && res.status === 200){
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
