// build_deploy.py actualiza estos hashes a partir del contenido del paquete.
const CACHE = 'sumetec-pedidos-5416ca8af5';
const CACHE_ASSETS = 'sumetec-pedidos-assets-683bfdff97';
const PREFIJO = 'sumetec-pedidos-';
const CACHE_CONTROL = 'sumetec-pedidos@aceptada';
const CLAVE_ACEPTADA = './__version_aceptada__';
const MANIFIESTO_PRECACHE = './precache-manifest.json';
const ARCHIVOS_ASSETS = [
  './fonts/ibm-plex-sans-variable.woff2', './fonts/ibm-plex-mono-400.woff2',
  './fonts/ibm-plex-mono-500.woff2', './fonts/ibm-plex-mono-600.woff2'
];
const codigoDe = nombre => String(nombre || '').slice(PREFIJO.length);
let aceptadaMemoria = null;
async function leerAceptada() {
  if (aceptadaMemoria !== null) return aceptadaMemoria;
  const r = await (await caches.open(CACHE_CONTROL)).match(CLAVE_ACEPTADA);
  return (aceptadaMemoria = r ? await r.text() : '');
}
async function guardarAceptada(nombre) {
  await (await caches.open(CACHE_CONTROL)).put(CLAVE_ACEPTADA, new Response(nombre));
  aceptadaMemoria = nombre;
}
async function cacheServida() {
  const aceptada = await leerAceptada();
  return aceptada && await caches.has(aceptada) ? aceptada : CACHE;
}
const abrirServida = () => cacheServida().then(nombre => caches.open(nombre));

// Esperar todas las escrituras antes de retirar una instalación incompleta.
async function completar(tareas) {
  const resultados = await Promise.allSettled(tareas);
  const fallo = resultados.find(r => r.status === 'rejected');
  if (fallo) throw fallo.reason;
}

async function precachearShell() {
  const r = await fetch(MANIFIESTO_PRECACHE, { cache: 'reload' });
  if (!r.ok) throw Error('No se pudo leer el manifiesto de la aplicación.');
  const manifiesto = await r.json();
  // Sólo archivos públicos del paquete: nunca URLs, parámetros ni rutas de API.
  if (!Array.isArray(manifiesto.files) || manifiesto.files.some(x => typeof x !== 'string' || !/^[a-zA-Z0-9_/-]+\.(?:html|js|css|json|webmanifest|png|svg|ico|woff2)$/.test(x) || x.includes('..'))) throw Error('Manifiesto inválido.');
  const cache = await caches.open(CACHE);
  const rutas = [...new Set([MANIFIESTO_PRECACHE, './version.js', ...manifiesto.files.filter(x => !x.startsWith('fonts/')).map(x => './' + x)])];
  await completar(rutas.map(async url => {
    const respuesta = await fetch(url, { cache: 'reload' });
    if (!respuesta.ok) throw Error('Aplicación incompleta: ' + url);
    await cache.put(url, respuesta);
  }));
}
self.addEventListener('install', e => {
  e.waitUntil(completar([
    precachearShell(),
    caches.open(CACHE_ASSETS).then(c => completar(ARCHIVOS_ASSETS.map(url => c.match(url).then(hit => hit || c.add(url)))))
  ]).then(async () => {
    if (!(await leerAceptada())) await guardarAceptada(CACHE);
    // El worker nuevo sirve la versión aceptada hasta el clic explícito.
    await self.skipWaiting();
  }).catch(async error => {
    const aceptada = await caches.has(CACHE_CONTROL) ? await leerAceptada() : '';
    if (aceptada !== CACHE) await caches.delete(CACHE);
    throw error;
  }));
});
async function limpiarCachesAnteriores() {
  const aceptada = await leerAceptada();
  await Promise.all((await caches.keys()).filter(k => k.startsWith(PREFIJO) && k !== aceptada && k !== CACHE && k !== CACHE_ASSETS).map(k => caches.delete(k)));
}
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    if (!(await leerAceptada())) await guardarAceptada(CACHE);
    await self.clients.claim();
    await limpiarCachesAnteriores();
    (await self.clients.matchAll({ type: 'window' })).forEach(c => c.postMessage({ type: 'VERSION_LISTA' }));
  })());
});
self.addEventListener('message', e => {
  const responder = datos => e.ports?.[0]?.postMessage(datos);
  if (e.data?.type === 'ESTADO') e.waitUntil(cacheServida().then(n => responder({ aceptada: codigoDe(n), lista: codigoDe(CACHE) })));
  if (e.data?.type === 'ACEPTAR') e.waitUntil(guardarAceptada(CACHE).then(() => responder({ ok: true, lista: codigoDe(CACHE) })));
  if (e.data?.type === 'CONFIRMAR_ARRANQUE') e.waitUntil(limpiarCachesAnteriores());
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const scope = new URL('./', self.location.href);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const ruta = url.pathname.slice(scope.pathname.length);
  if (e.request.mode === 'navigate') {
    if (ruta && ruta !== 'pedidos.html') return;
    // El HTML siempre corresponde a sus scripts. Jamás guardamos la URL del cliente.
    e.respondWith(abrirServida().then(c => c.match('./pedidos.html')).then(hit => hit || fetch(e.request)));
    return;
  }
  if (ruta === 'release.json' && !url.search) {
    e.respondWith(fetch(e.request, { cache: 'reload' }).catch(() => abrirServida().then(c => c.match('./release.json'))));
    return;
  }
  // Fuera del shell y las fuentes conocidas, la petición sigue sólo por red.
  if (!/^(?:pedidos\.html|portal\.js|pwa\.js|config\.js|version\.js|estilos\.css|pedidos-estandar\.css|sumetec-tema\.css|sumetec-v3\.css|sumetec-atras\.js|manifest\.json|precache-manifest\.json|logos\/[a-zA-Z0-9_-]+\.(?:png|svg|ico)|fonts\/ibm-plex-(?:sans-variable|mono-400|mono-500|mono-600)\.woff2)$/.test(ruta) || url.search) return;
  e.respondWith(abrirServida().then(c => c.match(e.request)).then(hit => hit || caches.open(CACHE_ASSETS).then(c => c.match(e.request))).then(hit => hit || fetch(e.request)));
});
