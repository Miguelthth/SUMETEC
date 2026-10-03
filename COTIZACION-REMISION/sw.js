const CACHE = 'sumetec-rem-aa979d39f6';
const PREFIJO = 'sumetec-rem-';

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
// Assets pesados (jsPDF ~400 KB) en su PROPIA caché, versionada aparte del shell.
// Antes vivían dentro de CACHE: como ese nombre es un hash del shell, cambiar una
// coma del HTML tiraba la caché entera y el celular volvía a bajar los 400 KB de
// jsPDF aunque no hubiera cambiado. Esta versión solo se sube si de verdad se
// cambia de versión de jsPDF (checklist pwa-actualizacion-sin-cache, punto 7).
const CACHE_ASSETS = 'sumetec-rem-assets-jspdf251';
const PREFIJO_ASSETS = 'sumetec-rem-assets-';
const STATIC = [
  './version.js'
];
const MANIFIESTO_PRECACHE = './precache-manifest.json';
// H5: jsPDF servido LOCAL (vendor/) → los PDF funcionan sin internet y sin depender
// de un CDN externo. Las URLs del CDN quedan como respaldo (la app las usa solo si
// el archivo local falla; si llegan a pedirse, también se cachean).
const ASSETS = [
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.29/jspdf.plugin.autotable.min.js'
];

// Instalar: cachear el shell + (si faltan) los assets pesados.
// Se cachea cada recurso por separado (no addAll) para que un fallo puntual del
// CDN —p. ej. jsPDF no disponible en ese instante— NO aborte toda la instalación
// y deje la app sin nada en caché. Lo que sí se baje queda guardado.
//
// checklist pwa-actualizacion-sin-cache, punto 4 (2026-09-01): c.add(u) usa
// fetch() por dentro, que respeta la caché HTTP normal del navegador -- si
// GitHub Pages entregaba una copia vieja de esa caché, el SW "se instalaba
// bien" (nombre de caché nuevo, skipWaiting disparado) pero guardaba el
// contenido de siempre. { cache: 'reload' } bypassea esa caché HTTP
// explícitamente, sin perder la tolerancia a fallos de CDN de arriba.
async function precachearShell() {
  const cache = await caches.open(CACHE);
  const respuesta = await fetch(MANIFIESTO_PRECACHE, { cache: 'reload' });
  if (!respuesta.ok) throw new Error('no se pudo leer precache-manifest.json');
  const manifiesto = await respuesta.json();
  if (!Array.isArray(manifiesto.files)) throw new Error('precache-manifest.json inválido');
  const rutas = [...new Set([MANIFIESTO_PRECACHE, ...STATIC, ...manifiesto.files.map(ruta => './' + ruta)])];
  let faltante = false;
  await Promise.allSettled(rutas.map(async (url) => {
    try {
      const resp = await fetch(url, { cache: 'reload' });
      // Hallazgo 4 (auditoría Cotizador, 2026-09-10): fetch() NO lanza en un 404/500 --
      // solo resuelve con ok:false. Sin este chequeo, un archivo nuevo (sync_audit.js,
      // version.js) que todavía no existiera en el hosting en el momento exacto del
      // deploy se guardaba en caché COMO SI fuera el archivo real, y ya no se
      // corregía solo hasta el próximo cambio de versión del shell.
      if (resp.ok) {
        await cache.put(url, resp);
      } else {
        faltante = true;
        console.warn('SW: respuesta no-ok al precachear (no se guarda)', url, resp.status);
      }
    } catch (err) {
      faltante = true;
      console.warn('SW: no se pudo precachear', url, err);
    }
  }));
  // M-12 (auditoría de robustez, 2026-09-10): si faltó CUALQUIER pieza del shell,
  // la instalación FALLA a propósito. Antes solo se anotaba en el log y el SW se
  // activaba igual: con activate() ya corriendo se borraban las cachés anteriores,
  // así que el celular se quedaba con una versión nueva incompleta y sin la vieja
  // a la que volver. Al lanzar aquí, install() se rechaza, este SW se descarta y el
  // anterior sigue mandando intacto; el navegador reintenta en la próxima carga.
  if (faltante) {
    console.warn('SW: precacheo del shell incompleto -- se conserva la versión anterior');
    throw new Error('precacheo del shell incompleto');
  }
}

// Punto 7 del checklist: los assets pesados se bajan SOLO si de verdad faltan, y
// con la caché HTTP normal (aquí sí conviene: el objetivo es no re-bajar lo que
// no cambió). Si ya están de una versión anterior del shell, no se toca nada.
async function precachearAssets() {
  const cache = await caches.open(CACHE_ASSETS);
  await Promise.allSettled(ASSETS.map(async (url) => {
    try {
      if (!(await cache.match(url))) await cache.add(url);
    } catch (err) {
      console.warn('SW: no se pudo precachear asset', url, err);
    }
  }));
}

// M-12: el shell es indispensable y su fallo ABORTA la instalación (ver arriba).
// Los assets pesados NO: precachearAssets() se traga sus errores a propósito, para
// que un CDN caído no impida instalar una versión nueva del shell — jsPDF se baja
// después, en el primer fetch que lo pida.
self.addEventListener('install', e => {
  e.waitUntil(precachearShell().then(() => precachearAssets()).then(despuesDeInstalar));
});

// Activar: limpiar cachés viejos DE ESTA APP. CacheStorage es por ORIGEN, no
// por scope: en GitHub Pages, Cotizador e Inventario comparten origen, así
// que borrar "todo lo que no sea mi CACHE" también borraba el caché offline
// del otro (jsPDF, HTML) hasta su próxima visita con señal.
//
// Ojo con el orden: PREFIJO ('sumetec-rem-') también casa con el nombre de la
// caché de assets ('sumetec-rem-assets-...'), así que la de assets se evalúa
// PRIMERO -- si no, cada deploy del shell borraría justo lo que el punto 7
// intenta conservar.
// Borra las cachés de versiones anteriores de ESTA app.
async function limpiarCachesAnteriores() {
  const aceptada = await leerAceptada();
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => {
    if (k === aceptada) return false;
    if (k.startsWith(PREFIJO_ASSETS)) return k !== CACHE_ASSETS;
    return k.startsWith(PREFIJO) && k !== CACHE;
  }).map(k => caches.delete(k)));
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

  // Apps Script y Google Fonts: solo red, nunca caché
  if (url.includes('script.google.com') || url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    return;
  }

  // HTML principal: red primero, caché como fallback
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
        .catch(() => caches.match('./remision.html'))
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

  // release.json decide si hay un worker nuevo; se consulta por red y sólo usa
  // una copia anterior como respaldo cuando no hay señal.
  if (/\/release\.json(\?|$)/.test(url)) {
    e.respondWith(
      fetch(url, { cache: 'reload' })
        .then(r => {
          if(r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())).catch(()=>{});
          return r;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./release.json')))
    );
    return;
  }

  // Assets estáticos: la versión actual gana. Las cachés anteriores quedan
  // únicamente como recuperación si el recurso no existe en el shell ni en
  // los assets actuales.
  e.respondWith(
    abrirServida().then(c => c.match(e.request))
      .then(r => r || caches.open(CACHE_ASSETS).then(c => c.match(e.request)))
      .then(r => { if (r) return r; return caches.match(e.request).then(r => {
      if (r) return r;
      return fetch(e.request).then(r2 => {
        if (!r2.ok) return r2;   // A1: un error del CDN/Pages no se guarda en caché
        // Lo que viene de vendor/ o del CDN de jsPDF va a la caché de assets (no se
        // tira en cada deploy); todo lo demás, a la del shell.
        const esAsset = /\/vendor\/|cdnjs\.cloudflare\.com/.test(e.request.url);
        const destino = esAsset ? CACHE_ASSETS : CACHE;
        // Clonar ANTES de usar: una para caché, una para retornar
        const clone1 = r2.clone();
        const clone2 = r2.clone();
        caches.open(destino).then(c => c.put(e.request, clone1)).catch(()=>{});
        return clone2;
      }); });
      })
  );
});
