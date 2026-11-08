// Service worker de JMPERFORMANCE: permite instalar la app y abrirla sin conexión.
// Estrategia: siempre intenta la red primero (para ver lo último publicado);
// si no hay internet, usa la última copia guardada.
// Nunca guarda datos de Supabase, PayPhone ni de /api (información privada y en vivo).
const CACHE = 'jmp-v2';
const PRECACHE = ['/', '/portal.html', '/index.html', '/config.js', '/logo.png?v=4', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (sameOrigin && url.pathname.startsWith('/api/')) return;            // datos en vivo
  if (!sameOrigin && !isCdn) return;                                      // Supabase, PayPhone, Analytics, etc.
  if (sameOrigin && /\.(mp4|webm)$/i.test(url.pathname)) return;         // videos: no guardar

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (sameOrigin || res.type === 'cors' || res.type === 'basic')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || (req.mode === 'navigate' ? caches.match(url.pathname.startsWith('/portal') ? '/portal.html' : '/index.html') : undefined)))
  );
});
