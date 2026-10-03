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
const CACHE = 'sumetec-fact-6444502484';
const CACHE_ASSETS = 'sumetec-fact-assets-c57c6f0dcd';
const PREFIJO = 'sumetec-fact-';

// Versión ACEPTADA (2026-09-29, pedido de Miguel: «que no se actualice sola hasta que le dé
// clic»). Antes, si la versión nueva se descargaba y después se cerraba la app, el navegador la
// activaba sola al abrir y nunca salía «Actualizar» (le pasó a Remisiones). Ahora este worker
// toma control en cuanto se instala, pero sigue sirviendo la caché que el usuario ACEPTÓ: la
// página le pregunta (ESTADO) y bloquea con «Actualizar» hasta que se pulse (ACEPTAR).
// La marca vive en su propia caché, fuera de PREFIJO, para que ninguna limpieza la borre.
const CACHE_CONTROL = PREFIJO.replace(/-$/, '') + '@aceptada';
const CLAVE_ACEPTADA = './__version_aceptada__';
const esCacheDeVersion = k => k.startsWith(PREFIJO) && !k.startsWith(PREFIJO + 'assets-');
const codigoDe = nombre => String(nombre || '').slice(PREFIJO.length);
let aceptadaMemoria = null;
async function leerAceptada() {
  if (aceptadaMemoria !== null) return aceptadaMemoria;
  try {
    const r = await (await caches.open(CACHE_CONTROL)).match(CLAVE_ACEPTADA);
    aceptadaMemoria = r ? await r.text() : '';
  } catch (_) { aceptadaMemoria = ''; }
  return aceptadaMemoria;
}
async function guardarAceptada(nombre) {
  await (await caches.open(CACHE_CONTROL)).put(CLAVE_ACEPTADA, new Response(nombre));
  aceptadaMemoria = nombre;
}
// Se sirve la aceptada mientras exista; si no hay (primera vez) o el navegador la borró
// por falta de espacio, la de esta versión.
async function cacheServida() {
  const aceptada = await leerAceptada();
  return aceptada && aceptada !== CACHE && await caches.has(aceptada) ? aceptada : CACHE;
}
const abrirServida = () => cacheServida().then(nombre => caches.open(nombre));

// Después de precachear: con una versión ya aceptada, este worker toma control de inmediato
// (sigue sirviendo la aceptada y la página ofrece «Actualizar»). Sin marca y sin cachés de
// versiones anteriores, es la primera instalación en este teléfono: se acepta esta. Sin marca
// pero CON cachés anteriores, el teléfono viene de antes de este mecanismo: se espera como
// antes y la página vieja ofrece su propio «Actualizar» (ACTIVAR_ACTUALIZACION).
async function despuesDeInstalar() {
  if (await leerAceptada()) { self.skipWaiting(); return; }
  const previas = (await caches.keys()).filter(k => esCacheDeVersion(k) && k !== CACHE);
  if (!previas.length) await guardarAceptada(CACHE);
}
const MANIFIESTO_PRECACHE = './precache-manifest.json';
const ARCHIVOS_ASSETS = ['./logos/sumetec-facturacion.png'];

async function precachearShell() {
  const cache = await caches.open(CACHE);
  const r = await fetch(MANIFIESTO_PRECACHE, { cache: 'reload' });
  if (!r.ok) throw Error('no se pudo leer precache-manifest.json');
  const manifiesto = await r.json();
  if (!Array.isArray(manifiesto.files)) throw Error('precache-manifest.json inválido');
  // version.js va en cada versión (2026-09-29) para que la etiqueta diga la versión que CORRE
  // (la aceptada), igual que en las otras 4 apps; queda fuera del hash por llevar la hora.
  const rutas = [...new Set([MANIFIESTO_PRECACHE, './version.js', ...manifiesto.files.map(x => './' + x)])];
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
  ]).then(despuesDeInstalar));
});

// Borra las cachés de versiones anteriores de ESTA app.
async function limpiarCachesAnteriores() {
  const aceptada = await leerAceptada();
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== aceptada && k.startsWith(PREFIJO) && k !== CACHE && k !== CACHE_ASSETS).map(k => caches.delete(k)));
}

// Al activarse nunca se borra la versión aceptada: solo lo que no es ni la aceptada ni esta.
// Si viene de antes de este mecanismo (sin marca), queda aceptada esta: es la última vez que
// una versión puede entrar sin el clic (al pulsar el «Actualizar» viejo o al reabrir la app).
// Si se activó por ese botón, la anterior se conserva hasta CONFIRMAR_ARRANQUE (recuperación).
let activadoPorBoton = false;
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    if (!(await leerAceptada())) await guardarAceptada(CACHE);
    await self.clients.claim();
    if (!activadoPorBoton) await limpiarCachesAnteriores();
    (await self.clients.matchAll({ type: 'window' })).forEach(c => c.postMessage({ type: 'VERSION_LISTA' }));
  })());
});

self.addEventListener('message', e => {
  const tipo = e.data?.type;
  const responder = datos => e.ports?.[0]?.postMessage(datos);
  if (tipo === 'ESTADO') e.waitUntil(cacheServida().then(n => responder({ aceptada: codigoDe(n), lista: codigoDe(CACHE) })));
  if (tipo === 'ACEPTAR') e.waitUntil(guardarAceptada(CACHE).then(() => responder({ ok: true, lista: codigoDe(CACHE) })));
  if (tipo === 'ACTIVAR_ACTUALIZACION') { activadoPorBoton = true; self.skipWaiting(); }
  if (tipo === 'CONFIRMAR_ARRANQUE') e.waitUntil(limpiarCachesAnteriores());
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Apps Script: solo red, nunca caché -- son datos fiscales/facturas reales.
  if (url.includes('script.google.com')) return;

  if (e.request.mode === 'navigate') {
    // B9-bis (a, F5N-01): el HTML sale de la caché ACTIVA, igual que sus scripts. Antes iba
    // red primero y además guardaba esa respuesta en la caché vigente: tras publicar, la app
    // abría HTML nuevo con JS viejo (y lo dejaba mezclado en la caché). La versión nueva llega
    // por el aviso "Actualizar", no por la red a media sesión. Solo si la caché no lo tiene
    // (primera instalación) se pide a la red.
    e.respondWith(
      abrirServida().then(c => c.match(e.request, { ignoreSearch: true }))
        .then(hit => hit || fetch(e.request).then(r => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
          }
          return r;
        }))
        .catch(() => caches.match('./facturas.html'))
    );
    return;
  }

  // version.js sale de la versión que CORRE (la aceptada), igual que el HTML y sus scripts:
  // la etiqueta dice lo que está en uso, no lo publicado; la nueva llega con «Actualizar».
  // (Antes iba red primero; con la versión aceptada ya no hace falta: build_deploy.py solo
  // reescribe version.js cuando cambia el código, y entonces cambia también CACHE.)
  if (/\/version\.js(\?|$)/.test(url)) {
    e.respondWith(
      abrirServida().then(c => c.match(e.request, { ignoreSearch: true }))
        .then(r => r || fetch(url, { cache: 'reload' }))
        .catch(() => caches.match(e.request))
    );
    return;
  }

  if (/\/release\.json(\?|$)/.test(url)) {
    e.respondWith(fetch(url, { cache: 'reload' }).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
    return;
  }

  e.respondWith(
    abrirServida().then(c => c.match(e.request))
      .then(r => r || caches.open(CACHE_ASSETS).then(c => c.match(e.request)))
      .then(r => { if (r) return r; return caches.match(e.request).then(r => {
      if (r) return r;
      return fetch(e.request).then(r2 => {
        if (!r2.ok) return r2;
        const clone1 = r2.clone();
        const clone2 = r2.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone1)).catch(() => {});
        return clone2;
      }); });
      })
  );
});
