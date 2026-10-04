/*
 * Service worker de ScannerFree (generado por scripts/copy-pdfjs.mjs).
 *
 * Objetivo: que la app abra sin conexion (escuela, datos agotados) y que
 * una actualizacion no deje sin funcionar a una pestana ya abierta. Es
 * conservador a proposito:
 *   - Paginas (navegacion): RED PRIMERO. Con conexion siempre se ve la
 *     ultima version; sin conexion, la copia guardada.
 *   - /_next/static, /pdfjs/<version>, /icons: archivos con hash o version
 *     en el nombre (nunca cambian): CACHE PRIMERO. Se conservan entre
 *     versiones (una pestana vieja aun puede pedir los suyos).
 *   - Todo lo demas: pasa directo a la red.
 */
const BUILD = '__BUILD__';
const SHELL = `shell-${BUILD}`;
const STATIC = 'static';
const STATIC_MAX_ENTRIES = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/', { cache: 'no-cache' });
        if (res.ok) {
          const shell = await caches.open(SHELL);
          await shell.put('/', res.clone());
          const html = await res.text();
          const urls = new Set(
            [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]),
          );
          for (const extra of ['/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png']) urls.add(extra);
          const stat = await caches.open(STATIC);
          await Promise.all([...urls].map((u) => stat.add(u).catch(() => {})));
        }
      } catch {
        /* sin conexion al instalar: se cachea al navegar */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
      }
      // Tope del cache de estaticos: se borran los mas viejos.
      const stat = await caches.open(STATIC);
      const keys = await stat.keys();
      for (const req of keys.slice(0, Math.max(0, keys.length - STATIC_MAX_ENTRIES))) await stat.delete(req);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.get('RSC') || url.searchParams.has('_rsc')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok && url.pathname === '/') {
            const shell = await caches.open(SHELL);
            await shell.put('/', res.clone());
          }
          return res;
        } catch {
          const cached = (await caches.match('/', { cacheName: SHELL })) || (await caches.match('/'));
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  if (/^\/(_next\/static|pdfjs|icons)\//.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const stat = await caches.open(STATIC);
        const hit = await stat.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await stat.put(req, res.clone());
        return res;
      })(),
    );
  }
});
