// CACHE/CACHE_ASSETS los bumpea build_deploy.py en cada corrida (hash del
// contenido real) -- no se editan a mano, y no cambian si no hay cambios de
// verdad. Dos cachés, no una (F5b, 2026-09-11, punto 7 del checklist
// pwa-actualizacion-sin-cache): el shell de código (el HTML) cambia seguido;
// las fuentes del tema (~220 KB) casi nunca cambian -- solo si el ERP
// cambia de marca. Si compartieran una sola caché, corregir una coma en el
// HTML forzaría a redescargar las fuentes completas en el siguiente uso.
const CACHE = 'sumetec-gas-08c924071b'; // bump obligatorio o los celulares siguen con la app vieja
const CACHE_ASSETS = 'sumetec-gas-assets-089af8bd65';
const PREFIJO = 'sumetec-gas-';
// version.js se agrego al SHELL el 2026-09-12: ya se copiaba al deploy y el
// HTML lo carga, pero al no precachearse la primera apertura sin senal mostraba
// "Sin informacion" en vez de la ultima version conocida. Se sirve RED PRIMERO
// (ver el fetch mas abajo), no cache-primero como el resto del shell.
const SHELL = ['./version.js'];
const MANIFIESTO_PRECACHE = './precache-manifest.json';
const ARCHIVOS_ASSETS = [
  './fonts/ibm-plex-sans-variable.woff2', './fonts/ibm-plex-mono-400.woff2',
  './fonts/ibm-plex-mono-500.woff2', './fonts/ibm-plex-mono-600.woff2',
  './fonts/bootstrap-icons.woff2'
];

async function precachearShell() {
  const cache = await caches.open(CACHE);
  const r = await fetch(MANIFIESTO_PRECACHE, { cache: 'reload' });
  if (!r.ok) throw Error('no se pudo leer precache-manifest.json');
  const manifiesto = await r.json();
  if (!Array.isArray(manifiesto.files)) throw Error('precache-manifest.json inválido');
  const rutas = [...new Set([MANIFIESTO_PRECACHE, ...SHELL, ...manifiesto.files.map(x => './' + x)])];
  await Promise.all(rutas.map(async url => { const respuesta = await fetch(url, { cache: 'reload' }); if (!respuesta.ok) throw Error('shell incompleto: ' + url); await cache.put(url, respuesta); }));
}

self.addEventListener('install', e => {
  // GI1 (plan 2026-08-19): antes era caches.open(CACHE).then(c => c.addAll(SHELL))
  // -- addAll() usa fetch() por dentro, que respeta el Cache-Control del
  // hosting: si GitHub Pages entregaba una copia vieja de la caché HTTP
  // normal del navegador, el service worker "se instalaba bien" (nombre de
  // caché nuevo, skipWaiting disparado) pero guardaba el contenido de
  // siempre. { cache: 'reload' } bypassea esa caché HTTP explícitamente.
  // Las fuentes van aparte: cache.add() normal (SÍ respeta la caché HTTP a
  // propósito) y solo si de verdad faltan.
  e.waitUntil(Promise.all([
    precachearShell(),
    caches.open(CACHE_ASSETS).then(c => Promise.all(
      ARCHIVOS_ASSETS.map(url => c.match(url).then(hit => hit || c.add(url)))
    ))
  ]));
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('message', e => {
  if (e.data?.type === 'ACTIVAR_ACTUALIZACION') self.skipWaiting();
  if (e.data?.type === 'CONFIRMAR_ARRANQUE') e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith(PREFIJO) && k !== CACHE && k !== CACHE_ASSETS).map(k => caches.delete(k)))
  ));
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Apps Script: solo red, nunca cache (igual que sw.js de remisiones).
  if (url.includes('script.google.com')) return;

  // HTML principal: red primero, cache como fallback.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return r;
        })
        .catch(() => caches.match('./gastos.html'))
    );
    return;
  }

  // version.js: RED PRIMERO, cache como fallback (2026-09-12).
  // Es el unico archivo del SHELL que NO entra en el hash del CACHE --
  // build_deploy.py lo excluye a proposito porque lleva la hora del build, asi
  // que incluirlo haria que el hash cambiara en cada corrida y nunca se
  // estabilizara. Servido cache-primero (como el resto), esa exclusion tenia
  // una consecuencia fea, encontrada en el Cotizador el 2026-09-12: un deploy
  // que solo cambia version.js deja sw.js identico byte a byte, el navegador
  // no instala nada, y se sigue sirviendo la copia vieja. La pantalla de
  // version -- justo la que se usa para verificar si la actualizacion llego --
  // quedaba congelada en la fecha anterior.
  // { cache: 'reload' } por la misma razon del punto 4 del checklist: sin eso
  // GitHub Pages puede entregar la copia vieja de la cache HTTP del navegador.
  if (/\/version\.js(\?|$)/.test(url)) {
    e.respondWith(
      fetch(url, { cache: 'reload' })
        .then(r => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
          }
          return r;
        })
        // Sin senal: la ultima copia guardada. version.js solo alimenta la
        // etiqueta de version en pantalla, nunca un movimiento de dinero.
        .catch(() => caches.match(e.request))
    );
    return;
  }

  if (/\/release\.json(\?|$)/.test(url)) {
    e.respondWith(fetch(url, { cache: 'reload' }).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
    return;
  }

  // Assets estaticos: cache primero, red como fallback.
  e.respondWith(
    caches.match(e.request).then(r => {
      if (r) return r;
      return fetch(e.request).then(r2 => {
        if (!r2.ok) return r2;
        const clone1 = r2.clone();
        const clone2 = r2.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone1)).catch(() => {});
        return clone2;
      });
    })
  );
});
