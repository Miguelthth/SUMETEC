// CACHE/CACHE_ASSETS los bumpea build_deploy.py en cada corrida (hash del
// contenido real) -- no se editan a mano, y no cambian si no hay cambios de
// verdad. Dos cachés, no una (punto 7 del checklist pwa-actualizacion-sin-
// cache): el shell de código (html/js) cambia seguido; el logo (~930 KB)
// casi nunca cambia. Si compartieran una sola caché, arreglar una coma en
// motor_cfdi.js forzaría a redescargar el logo completo en el siguiente uso.
// Solo tiene efecto real cuando esta app se sirve desde su propio origen
// (GitHub Pages) -- ver actualizacion.js::iniciarActualizacionesFact, que
// SOLO registra este archivo en modo 'fetch'. Bajo Apps Script (modo
// 'google') nunca se registra: Apps Script sirve el HTML dentro de un
// iframe sandbox, no un documento de nivel superior que un Service Worker
// pueda controlar (mismo motivo por el que el ícono de instalación tampoco
// funciona ahí -- ver FACTURACION-threat-model.md).
const CACHE = 'sumetec-fact-ea34db495e';
const CACHE_ASSETS = 'sumetec-fact-assets-c57c6f0dcd';
const PREFIJO = 'sumetec-fact-';
const MANIFIESTO_PRECACHE = './precache-manifest.json';
const ARCHIVOS_ASSETS = ['./logos/sumetec-facturacion.png'];

async function precachearShell() {
  const cache = await caches.open(CACHE);
  const r = await fetch(MANIFIESTO_PRECACHE, { cache: 'reload' });
  if (!r.ok) throw Error('no se pudo leer precache-manifest.json');
  const manifiesto = await r.json();
  if (!Array.isArray(manifiesto.files)) throw Error('precache-manifest.json inválido');
  const rutas = [...new Set([MANIFIESTO_PRECACHE, ...manifiesto.files.map(x => './' + x)])];
  await Promise.all(rutas.map(async url => { const respuesta = await fetch(url, { cache: 'reload' }); if (!respuesta.ok) throw Error('shell incompleto: ' + url); await cache.put(url, respuesta); }));
}

self.addEventListener('install', e => {
  // addAll() usa fetch() por dentro, que respeta el Cache-Control del
  // hosting -- si el navegador tenía una copia vieja en su caché HTTP
  // normal, el SW "se instalaba bien" pero guardaba el contenido de
  // siempre. { cache: 'reload' } bypassea esa caché HTTP explícitamente.
  // El logo va aparte: cache.add() normal (SÍ respeta la caché HTTP a
  // propósito) y solo si de verdad falta -- es pesado y casi nunca
  // cambia, no hay que insistir en bajarlo de nuevo en cada instalación.
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

  // Apps Script: solo red, nunca caché -- son datos fiscales/facturas reales.
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
        .catch(() => caches.match('./facturas.html'))
    );
    return;
  }

  // version.js: RED PRIMERO, caché como fallback -- mismo motivo que en las
  // otras 3 apps (2026-09-12): es el único archivo del SHELL que NO entra en
  // el hash del CACHE (build_deploy.py lo excluye a propósito porque lleva la
  // hora del build, así que incluirlo haría que el hash nunca se
  // estabilizara). Servido caché-primero como el resto del shell, esa
  // exclusión dejaba la etiqueta "Última act." congelada en la fecha
  // anterior tras un deploy que solo cambiaba version.js.
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
