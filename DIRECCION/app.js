// 'compras' salió de aquí (F3 del plan de diseño, 2026-09-11): Compras es
// ahora su propia app (18.- SUMETEC COMPRAS/), con su propia cola. Ver la
// nota en corte.js sobre lo que eso cambia en el aviso de "pendientes sin
// enviar" antes de cerrar un corte.
const COLAS = {
  movimientos: 'sumetec_direccion_cola_movimientos',
  cortes: 'sumetec_direccion_cola_cortes',
  // Correcciones (anulaciones) de movimientos de Caja: también se guardan antes de enviarse.
  anulaciones: 'sumetec_direccion_cola_anulaciones'
};

const $ = s => document.querySelector(s);
const leer = k => JSON.parse(localStorage.getItem(k) || '[]');

let _enviandoDireccion = false;
function estado() {
  // Los conteos de Inventario se suman al chip pero NO viven en COLAS: un
  // conteo sin enviar no mueve efectivo y no debe bloquear el corte (ver
  // corte.js::_pendientesSinEnviarDireccion_ e inventario.js).
  const pendientes = Object.values(COLAS).reduce((total, k) => total + leer(k).length, 0) +
    (typeof _pendientesInventario_ === 'function' ? _pendientesInventario_() : 0);
  const chip = $('#estado');
  const texto = $('#estado-texto');
  chip.classList.remove('chip-en-linea', 'chip-pendientes', 'chip-sin-red', 'chip-enviando', 'chip-detenida');
  // D-05: una captura que el servidor rechazó varias veces se DETIENE y antes se veía igual que «1 pendiente».
  const detenidas = Object.values(COLAS).reduce((total, k) => total + leer(k).filter(x => x && x.rechazo).length, 0);
  if (detenidas && !_enviandoDireccion) {
    texto.textContent = `⚠ ${detenidas} detenida(s)`;
    chip.classList.add('chip-detenida');
  } else if (_enviandoDireccion) {
    texto.textContent = `Enviando ${pendientes}…`;
    chip.classList.add('chip-enviando');
  } else if (!navigator.onLine) {
    texto.textContent = pendientes ? `Sin red · ${pendientes}` : 'Sin red';
    chip.classList.add('chip-sin-red');
  } else if (pendientes) {
    texto.textContent = `${pendientes} pendiente(s)`;
    chip.classList.add('chip-pendientes');
  } else {
    texto.textContent = 'En línea';
    chip.classList.add('chip-en-linea');
  }
}

// El chip es también el botón de "enviar ahora" (antes solo vivía en un
// botón grande dentro de Caja) -- mismo enviarMovimientosDireccion de
// siempre, solo que ahora es alcanzable desde cualquier pantalla.
async function enviarPendientesDireccion() {
  const pendientes = Object.values(COLAS).reduce((total, k) => total + leer(k).length, 0);
  if (!pendientes) return;
  // El aviso solo promete lo que de verdad ocurre: las capturas ya están guardadas en el teléfono y se
  // reenvían solas al volver la señal SI el PIN sigue vigente (sesión desbloqueada); si no, con este toque.
  if (!navigator.onLine) { if (typeof toast === 'function') toast('Sin conexión: tus capturas quedan guardadas en este teléfono. Se envían solas al volver la señal con la app desbloqueada, o toca este aviso.'); return; }
  try {
    const pin = await pedirPinDireccion();
    _enviandoDireccion = true; estado();
    const nMov = await enviarMovimientosDireccion(pin);
    const nAnul = typeof enviarAnulacionesDireccion === 'function' ? await enviarAnulacionesDireccion(pin) : 0;
    const nCortes = typeof enviarCortesDireccion === 'function' ? await enviarCortesDireccion(pin) : 0;
    const n = nMov + nAnul + nCortes;
    // El chip también cuenta los conteos de Inventario (cola aparte): sin esto
    // pedía el PIN, decía "todo enviado" y el conteo seguía pendiente.
    if (typeof procesarColaConteo === 'function') await procesarColaConteo(false);
    _enviandoDireccion = false; estado();
    const nConteos = typeof _pendientesInventario_ === 'function' ? _pendientesInventario_() : 0;
    if (typeof toast === 'function') toast((n || nConteos) ? `${n + nConteos} envío(s) siguen pendientes.` : 'Todo se envió.');
  } catch (err) {
    _enviandoDireccion = false; estado();
    if (typeof toast === 'function') toast(err.message); else alert(err.message);
  }
}

// ── Borrar copias locales (2026-09-24) ──────────────────────────────────────
// Para cuando se borra algo en el servidor (p. ej. la carpeta de Drive) y el
// teléfono sigue mostrando la copia vieja. SOLO borra caché que se vuelve a
// bajar del servidor. Bloquea si hay algo sin enviar, si no hay señal o si el
// servidor no contesta (la comprobación pide el PIN y usa el token real, así
// que también confirma que la sesión sirve). Doble confirmación: aviso +
// teclear BORRAR. Nunca toca colas, conteo en curso, contador de conteos, PIN ni vinculación.
const _CLAVES_CACHE_DIRECCION = ['sumetec_direccion_snapshot_cache', 'sumetec_direccion_config_cache', 'sumetec_direccion_inv_catalogo', 'sumetec_direccion_inv_stock_teorico'];
function _pendientesParaLimpiar_() {
  return Object.values(COLAS).reduce((n, k) => n + leer(k).length, 0) +
    leer(CLAVE_INV_COLA).length + (localStorage.getItem(CLAVE_INV_CONTEO_ACTUAL) ? 1 : 0);
}
async function _servidorEnLinea_() {
  const url = localStorage.getItem('sumetec_direccion_url');
  if (!url || !navigator.onLine) return false;
  try {
    const pin = await pedirPinDireccion();
    const token = await abrirSesionDireccion(pin);
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ tipo: 'configuracion', token }), signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.ok !== false);
  } catch (_) { return false; }
}
async function limpiarCacheLocal() {
  if (!navigator.onLine) { _avisoLimpiar_('Sin conexión — conéctate para poder borrar.'); return; }
  const pend = _pendientesParaLimpiar_();
  if (pend > 0) { _avisoLimpiar_('Hay ' + pend + ' pendiente(s) sin enviar o algo a medio capturar — no se borró nada.'); return; }
  _avisoLimpiar_('Confirmando con el servidor…');
  if (!(await _servidorEnLinea_())) { _avisoLimpiar_('El servidor no contestó (o se canceló el PIN) — no se borró nada.'); return; }
  if (!confirm('Se borrarán las copias guardadas en ESTE teléfono (resúmenes, listas y configuración en caché).\n\nTodo lo enviado sigue en el servidor y se vuelve a bajar. Colas, PIN y vinculación NO se borran.\n\n¿Continuar?')) return;
  const txt = prompt('Segunda confirmación: escribe BORRAR para continuar.');
  if (String(txt || '').trim().toUpperCase() !== 'BORRAR') { _avisoLimpiar_('Cancelado — no se borró nada.'); return; }
  if (_pendientesParaLimpiar_() > 0) { _avisoLimpiar_('Entró algo a la cola mientras confirmabas — no se borró nada.'); return; }
  _CLAVES_CACHE_DIRECCION.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
  _avisoLimpiar_('Copias borradas ✓ — recargando…');
  setTimeout(() => location.reload(), 900);
}
function _avisoLimpiar_(m) { if (typeof toast === 'function') toast(m); else alert(m); }

// Sección visible ahora mismo (hallazgo DIR-02, 2026-09-09). El resumen pide
// datos al servidor de forma asíncrona; si el usuario ya navegó a otra
// pantalla cuando la respuesta llega, esa respuesta tardía no debe pisar lo
// que haya en #app (un formulario de compra a medio llenar, por ejemplo).
let _vistaActivaDireccion = null;
function vistaActivaDireccion() { return _vistaActivaDireccion; }

// Rediseño 2026-09-24: la barra de arriba dice en qué sección estás (el
// <h1> dentro de cada vista queda oculto por CSS, ver estilos.css).
const _TITULOS_VISTA_ = { resumen: 'Resumen', caja: 'Caja', corte: 'Corte del día', inventario: 'Inventario' };

function vista(nombre) {
  _vistaActivaDireccion = nombre;
  document.querySelectorAll('[data-vista]').forEach(b => {
    const activo = b.dataset.vista === nombre;
    b.classList.toggle('activo', activo);
    if (activo) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const titulo = $('#tituloVista');
  if (titulo) titulo.textContent = _TITULOS_VISTA_[nombre] || (nombre[0].toUpperCase() + nombre.slice(1));
  window.scrollTo(0, 0);
  const vistas = {
    caja: formularioCajaDireccion,
    corte: formularioCorteDireccion,
    resumen: () => '<h1>Resumen</h1><p class="text-muted">Cargando fotografía oficial…</p>',
    inventario: () => '<h1>Inventario</h1><p class="text-muted">Cargando catálogo…</p>'
  };
  const generador = vistas[nombre];
  $('#app').innerHTML = generador
    ? generador()
    : `<h1>${nombre[0].toUpperCase() + nombre.slice(1)}</h1><p></p>`;

  if (nombre === 'caja') activarCajaDireccion();
  if (nombre === 'corte') activarCorteDireccion();
  if (nombre === 'resumen') activarDashboardDireccion();
  if (nombre === 'inventario') activarInventarioDireccion();
}

// Bug #4 (2026-09-23): igual que el Cotizador -- hostname EXACTO, no "contiene": una URL mal
// pegada mandaría el código de vinculación y el token a un sitio ajeno.
function _urlAppsScriptValida(u) {
  let p;
  try { p = new URL(String(u == null ? '' : u).trim()); } catch (_) { return false; }
  if (p.protocol !== 'https:' || p.hostname !== 'script.google.com') return false;
  return /^\/macros\/s\/[A-Za-z0-9_-]+\/(exec|dev)$/.test(p.pathname);
}

// Servidor compartido de fábrica (el mismo de Cotizador, Gastos y el ERP). 2026-09-29: ya no se
// pide en pantalla -- las 5 apps piden lo mismo: «Tu nombre + Código», y después el PIN.
const URL_SERVIDOR_FABRICA = 'https://script.google.com/macros/s/AKfycbxQ3o4Fapo78sEbAAsMoGjyjMrcsL7lMXRwwig0r2ZhRAwi_Ukdi3CHkGrilpcTsgrK/exec';

let _accesoInicialValidado = false;
// Token recién entregado por el servidor mientras se crea el PIN: si se cancela la ventana
// del PIN, volver a pulsar «Vincular» lo reusa y no gasta otro código (vale una sola vez).
let _tokenVinculadoPendiente = '';
async function vincular() {
  const url = localStorage.getItem('sumetec_direccion_url') || URL_SERVIDOR_FABRICA;
  const nombre = $('#nombre-vincular').value.trim();
  const codigo = $('#codigo').value.trim();
  const _est = $('#vincular-estado');
  if (!nombre) { _est.textContent = 'Escribe tu nombre primero.'; $('#nombre-vincular').focus(); return; }
  if (!codigo && !_tokenVinculadoPendiente) { _est.textContent = 'Escribe el código de vinculación.'; $('#codigo').focus(); return; }
  if (!_urlAppsScriptValida(url)) { _est.textContent = 'La dirección del servidor guardada no es válida. Pide ayuda a administración.'; return; }
  _est.textContent = '';
  sumetecEntrando($('#enlazar'), true);

  const dispositivo = localStorage.getItem('sumetec_direccion_dispositivo') || crypto.randomUUID();
  if (!_tokenVinculadoPendiente) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ tipo: 'vincular_dispositivo', app: 'DIRECCION', codigo, dispositivo, nombre })
    }).then(x => x.json());
    if (!r.ok) throw Error(r.error);
    _tokenVinculadoPendiente = r.token;
  }
  const pin = await sumetecPedirPinToken('Dirección', true);
  if (pin === null) {
    sumetecEntrando($('#enlazar'), false);
    _est.textContent = 'Falta crear tu PIN. Pulsa «Vincular» otra vez; no necesitas otro código.';
    return;
  }

  await guardarSesionDireccion(pin, _tokenVinculadoPendiente);
  _tokenVinculadoPendiente = '';
  localStorage.setItem('sumetec_direccion_nombre', nombre);
  localStorage.setItem('sumetec_direccion_dispositivo', dispositivo);
  localStorage.setItem('sumetec_direccion_url', url);
  recordarPinDireccion(pin);
  _accesoInicialValidado = true;
  document.body.classList.remove('sin-sesion');
  sumetecEntrando($('#enlazar'), false);
  _est.textContent = '';
  $('#vincular').close();
  estado();
  vista(vistaActivaDireccion() || 'resumen');
}

// Ecosistema centralizado (2026-09): aplica lo cacheado de la ÚLTIMA vez
// (antes de pedir el PIN) para que Corte no arranque con denominaciones
// viejas si el ERP publicó algo distinto en la sesión anterior. Sin caché
// aún (primera vez), sigue con los valores de fábrica de corte.js/seguridad.js.
try {
  const cacheCfg = JSON.parse(localStorage.getItem('sumetec_direccion_config_cache') || 'null');
  if (cacheCfg && cacheCfg.datos) { _aplicarConfigDireccionPublicada_(cacheCfg.datos.DIRECCION); _aplicarAccesoDireccion_(cacheCfg.datos); }
  // Umbral de "stock teórico viejo" de Inventario: vive en la sección GASTOS
  // de la configuración central (así lo publica el ERP desde antes de F4).
  if (cacheCfg && cacheCfg.datos && typeof _aplicarConfigInventarioPublicada_ === 'function') {
    _aplicarConfigInventarioPublicada_(cacheCfg.datos.GASTOS);
  }
} catch (_) {}

document.querySelectorAll('[data-vista]').forEach(b => b.onclick = () => vista(b.dataset.vista));
$('#estado').onclick = () => enviarPendientesDireccion();
$('#enlazar').onclick = e => {
  e.preventDefault();
  vincular().catch(x => { sumetecEntrando($('#enlazar'), false); $('#vincular-estado').textContent = 'Falló: ' + clasificarErrorAcceso(x); });
};
window.addEventListener('online', estado);
window.addEventListener('offline', estado);

// Menú "☰ Más": agrupa tema/versión/vincular y "enviar pendientes", que
// antes vivían sueltos en la barra o como botón grande dentro de Caja.
{
  const btnMasMenu = $('#btnMasMenu');
  const masMenu = $('#masMenu');
  btnMasMenu.onclick = () => {
    const abrir = masMenu.hidden;
    masMenu.hidden = !abrir;
    masMenu.style.display = abrir ? 'flex' : 'none';
    btnMasMenu.setAttribute('aria-expanded', String(abrir));
  };
  document.addEventListener('click', e => {
    if (masMenu.hidden || masMenu.contains(e.target) || btnMasMenu.contains(e.target)) return;
    masMenu.hidden = true;
    masMenu.style.display = 'none';
    btnMasMenu.setAttribute('aria-expanded', 'false');
  });
  $('#menuEnviarPendientes').onclick = () => { masMenu.hidden = true; masMenu.style.display = 'none'; enviarPendientesDireccion(); };
  $('#menuVincular').onclick = () => { masMenu.hidden = true; masMenu.style.display = 'none'; $('#vincular').showModal(); };
}

// El contenido se dibuja después de confirmar la vinculación o el PIN.
// Hallazgo 2026-09-10 (Miguel: "me dijo código incorrecto pero me dejó
// pasar"): <dialog> se cierra solo con Escape o el botón atrás de Android
// (evento nativo 'cancel'), y como #app ya tiene la pantalla de Resumen
// dibujada DETRÁS de este modal (vista('resumen') corrió arriba), cerrarlo
// así -- sin que vincular() haya tenido éxito -- deja ver la app entera sin
// ninguna sesión ni token guardado. Parece que "ya funcionó" y no vinculó
// nada. Bloqueado aquí: mientras no haya sesión, este diálogo no se puede
// descartar sin completar la vinculación de verdad.
$('#vincular').addEventListener('cancel', e => e.preventDefault());
// Segundo candado, y el que de verdad aguanta (2026-09-11, probado contra
// el sitio real): el preventDefault de arriba NO siempre se respeta.
// Chrome tiene una regla anti-abuso (CloseWatcher) por la que un diálogo
// abierto SIN que el usuario haya interactuado todavía con la página --
// justo este caso, se abre solo al cargar -- no puede bloquear el Escape,
// y se cierra aunque 'cancel' esté cancelado.
//
// Se vigila el atributo `open` del <dialog>, NO el evento 'close': medido
// en el navegador real, ese evento no llega de forma confiable cuando el
// cierre lo fuerza el navegador, así que un listener de 'close' dejaba el
// hueco abierto igual. El atributo sí cambia siempre, se cierre como se
// cierre (Escape, botón atrás de Android, o lo que venga después).
//
// Al vincular con éxito, vincular() guarda la sesión ANTES de llamar
// close(), así que aquí ya hay sesión y el diálogo se queda cerrado.
new MutationObserver(() => {
  if (!$('#vincular').open && !localStorage.getItem(SESION_KEY)) $('#vincular').showModal();
  document.body.classList.toggle('sin-sesion', !_accesoInicialValidado);
}).observe($('#vincular'), { attributes: true, attributeFilter: ['open'] });
async function _abrirAccesoInicial() {
  let aviso = '';
  while (localStorage.getItem(SESION_KEY) && !_accesoInicialValidado) {
    const intento = pedirPinDireccion();
    if (aviso) $('#pin-modal-error').textContent = aviso;
    try {
      const pin = await intento;
      sumetecMostrarCargaAcceso(true);
      await abrirSesionDireccion(pin);
      _accesoInicialValidado = true;
      document.body.classList.remove('sin-sesion');
      estado();
      vista(vistaActivaDireccion() || 'resumen');
      return;
    } catch (e) {
      if (e.message === 'PIN cancelado') {
        sumetecMostrarAccesoBloqueado(_abrirAccesoInicial);
        return;
      }
      aviso = clasificarErrorAcceso(e);
      await new Promise(r => setTimeout(r, 150));
    } finally { sumetecMostrarCargaAcceso(false); }
  }
}
document.body.classList.add('sin-sesion');
if (!localStorage.getItem(SESION_KEY)) $('#vincular').showModal();
else _abrirAccesoInicial();

// Registro del service worker, revisión cada 5 min y el aviso «Actualizar»: todo en
// actualizacion.js (2026-09-29). Aquí había un segundo registro que RECARGABA la app cuando
// un worker nuevo tomaba control; con la versión aceptada eso recargaría a media captura sin
// traer nada nuevo, y marcaba «Última actualización» sin que se hubiera aceptado nada.

// VERSION_DEPLOY y VERSION_CODIGO vienen de version.js (los escribe
// build_deploy.py en cada corrida): la hora real del build y el mismo hash
// que sw.js usa como nombre de caché ('sumetec-direccion-<código>'). "Última
// actualización" es la última vez que un service worker NUEVO tomó control
// en ESTE dispositivo -- si nunca ha habido una, se avisa en vez de mentir.
// Mismo patrón que 2.- COTIZADOR/remision.html y 12.- GASTOS.
function _mostrarVersionInstalada() {
  const codigo = (typeof VERSION_CODIGO !== 'undefined' && VERSION_CODIGO) ? VERSION_CODIGO : null;
  const v = (typeof VERSION_DEPLOY !== 'undefined' && VERSION_DEPLOY)
    ? new Date(VERSION_DEPLOY).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Sin información';
  const ultima = Number(localStorage.getItem('direccion_ultima_actualizacion') || 0);
  const u = ultima
    ? new Date(ultima).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Aún no se ha detectado una actualización nueva en este dispositivo.';
  const msg = `Versión del software: ${codigo ? codigo + ' · ' : ''}${v} — Última actualización: ${u}`;
  if (typeof toast === 'function') toast(msg, 6000); else alert(msg);
}

// Bug #1 (2026-09-23): antes cualquier campo con valor contaba como captura en curso, y la
// pantalla siempre trae valores puestos por la app (fecha de hoy, modo A/B/C, socio, fondo 0):
// la recarga por actualización se aplazaba para siempre. Ahora solo cuenta lo que el usuario CAMBIÓ.
function _campoEditadoPorUsuario_(el) {
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return false;
  if (['file', 'date', 'radio', 'checkbox', 'hidden', 'button', 'submit'].includes(el.type)) return false;
  return !!el.value && el.value !== el.defaultValue;
}
function hayTrabajoSinGuardarDireccion() {
  if (_campoEditadoPorUsuario_(document.activeElement)) return true;
  const form = document.querySelector('#app form');
  if (!form) return false;
  return [...form.elements].some(_campoEditadoPorUsuario_);
}
