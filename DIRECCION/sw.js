// CACHE/CACHE_ASSETS los bumpea build_deploy.py en cada corrida (hash del
// contenido real) -- no se editan a mano, y no cambian si no hay cambios de
// verdad. Dos cachés, no una (punto 7 del checklist pwa-actualizacion-sin-
// cache, 2026-09-11): el shell de código (html/js/css) cambia seguido; las
// fuentes del tema (~220 KB) casi nunca cambian -- solo si el ERP cambia de
// marca. Si compartieran una sola caché, arreglar una coma en caja.js
// forzaría a redescargar las fuentes completas en el siguiente uso.
const CACHE = 'sumetec-direccion-d21157ecb1';
const CACHE_ASSETS = 'sumetec-direccion-assets-089af8bd65';
const PREFIJO = 'sumetec-direccion-';
// Inventario queda explícito además del manifiesto para documentar que la
// pantalla de conteo es indispensable también sin señal.
const SHELL = ['./version.js', './inventario.js'];
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
  // addAll() usa fetch() por dentro, que respeta el Cache-Control del
  // hosting -- si el navegador tenía una copia vieja en su caché HTTP
  // normal, el SW "se instalaba bien" pero guardaba el contenido de
  // siempre. { cache: 'reload' } bypassea esa caché HTTP explícitamente.
  // Las fuentes van aparte: cache.add() normal (SÍ respeta la caché HTTP a
  // propósito) y solo si de verdad faltan -- son pesadas y casi nunca
  // cambian, no hay que insistir en bajarlas de nuevo en cada instalación.
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

  // Apps Script: solo red, nunca caché -- son movimientos de dinero.
  if (url.includes('script.google.com')) return;

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
        .catch(() => caches.match('./direccion.html'))
    );
    return;
  }

  // version.js: RED PRIMERO, caché como fallback (2026-09-12).
  // Es el único archivo del SHELL que NO entra en el hash del CACHE --
  // build_deploy.py lo excluye a propósito porque lleva la hora del build, así
  // que incluirlo haría que el hash cambiara en cada corrida y nunca se
  // estabilizara. Servido caché-primero (como el resto del shell), esa
  // exclusión tenía una consecuencia fea, encontrada en el Cotizador el
  // 2026-09-12: un deploy que solo cambia version.js deja sw.js idéntico byte
  // a byte, el navegador no instala nada, y se sigue sirviendo la copia vieja.
  // La pantalla de versión —justo la que se usa para verificar si la
  // actualización llegó— quedaba congelada en la fecha anterior.
  // { cache: 'reload' } por la misma razón del punto 4 del checklist: sin eso
  // GitHub Pages puede entregar la copia vieja de la caché HTTP del navegador.
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
        // Sin señal: la última copia guardada. version.js solo alimenta la
        // etiqueta de versión en pantalla, nunca un movimiento de dinero.
        .catch(() => caches.match(e.request))
    );
    return;
  }

  if (/\/release\.json(\?|$)/.test(url)) {
    e.respondWith(fetch(url, { cache: 'reload' }).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
    return;
  }

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
