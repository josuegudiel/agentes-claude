/*
 * Service worker de ScannerFree (generado por scripts/copy-pdfjs.mjs).
 *
 * Objetivo: que la app abra sin conexion (escuela, datos agotados) y que
 * una actualizacion no deje sin funcionar a una pestana ya abierta. Es
 * conservador a proposito:
 *   - Paginas (navegacion): RED PRIMERO. Con conexion siempre se ve la
 *     ultima version; sin conexion, la copia guardada.
 *   - /_next/static y /pdfjs/<version>: archivos con hash o version en el
 *     nombre (nunca cambian): CACHE PRIMERO, en un cache por version (se
 *     guarda tambien el de la version anterior).
 *   - Todo lo demas: pasa directo a la red.
 */
const BUILD = '__BUILD__';
const SHELL = `shell-${BUILD}`;
// Un cache de estaticos POR VERSION: si alguna vez alguien lograra meter un
// archivo alterado en el cache, desaparece con la siguiente version. Se
// conserva solo el de la version anterior (pestanas abiertas antes de
// actualizar todavia piden sus archivos).
const STATIC = `static-${BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Si no se puede guardar la pagina, la instalacion FALLA a proposito:
      // asi sigue el service worker anterior con su copia (si no, se borraba
      // la unica copia sin conexion).
      const res = await fetch('/', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`install: / respondio ${res.status}`);
      const shell = await caches.open(SHELL);
      await shell.put('/', res.clone());
      const html = await res.text();
      const urls = new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]));
      for (const extra of ['/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png']) urls.add(extra);
      const stat = await caches.open(STATIC);
      await Promise.all([...urls].map((u) => stat.add(u).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys(); // en orden de creacion
      for (const key of keys) {
        if (key.startsWith('shell-') && key !== `shell-${BUILD}`) await caches.delete(key);
      }
      // Estaticos: esta version y la inmediatamente anterior; el resto fuera
      // (incluido el cache 'static' compartido de versiones viejas).
      const statics = keys.filter((k) => k.startsWith('static'));
      const previous = statics.filter((k) => k !== STATIC && k !== 'static').slice(-1);
      for (const key of statics) {
        if (key !== STATIC && !previous.includes(key)) await caches.delete(key);
      }
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

  if (/^\/(_next\/static|pdfjs)\//.test(url.pathname)) {
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
