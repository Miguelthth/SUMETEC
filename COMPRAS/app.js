// Compras -- app propia (F3 del plan de diseño, 2026-09-11). Una sola
// pantalla (no hay nav ni vista() como en Dirección): vincular, capturar,
// enviar. Copiado y recortado de 14.- SUMETEC DIRECCION/app.js.

// Chip permanente (siempre visible, no un aviso que desaparece): En línea /
// Enviando / Sin red / Error, con un punto de color. _comprasEnviando y
// _comprasUltimoError los fija activarComprasDireccion() en compras.js
// alrededor del botón "Enviar compras pendientes".
let _comprasEnviando = 0;
let _comprasUltimoError = '';

function estado() {
  const el = $('#estado');
  const pendientes = leer(COLAS.compras).length;
  const fijar = (variante, texto) => {
    el.className = 'sm-chip sm-chip-boton' + (variante ? ' sm-chip--' + variante : '');
    el.innerHTML = `<span class="sm-chip-punto"></span>${texto}`;
  };
  if (_comprasEnviando) return fijar('info', `Enviando ${_comprasEnviando}…`);
  if (_comprasUltimoError) return fijar('err', _comprasUltimoError);
  // D-05 (revisión 2026-10-01): lo que el servidor rechazó varias veces se DETIENE; antes se veía como «1 pendiente».
  const detenidas = leer(COLAS.compras).filter(c => c && c.rechazo).length;
  if (detenidas) return fijar('err', `⚠ ${detenidas} detenida(s)`);
  if (pendientes) return fijar('warn', navigator.onLine ? `${pendientes} pendientes` : `Sin red · ${pendientes}`);
  return fijar(navigator.onLine ? 'ok' : '', navigator.onLine ? 'Al día' : 'Sin conexión');
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
  const url = localStorage.getItem('sumetec_compras_url') || URL_SERVIDOR_FABRICA;
  const nombre = $('#nombre-vincular').value.trim();
  const codigo = $('#codigo').value.trim();
  const _est = $('#vincular-estado');
  if (!nombre) { _est.textContent = 'Escribe tu nombre primero.'; $('#nombre-vincular').focus(); return; }
  if (!codigo && !_tokenVinculadoPendiente) { _est.textContent = 'Escribe el código de vinculación.'; $('#codigo').focus(); return; }
  if (!_urlAppsScriptValida(url)) { _est.textContent = 'La dirección del servidor guardada no es válida. Pide ayuda a administración.'; return; }
  _est.textContent = '';
  sumetecEntrando($('#enlazar'), true);

  const dispositivo = localStorage.getItem('sumetec_compras_dispositivo') || crypto.randomUUID();
  if (!_tokenVinculadoPendiente) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ tipo: 'vincular_dispositivo', app: 'COMPRAS', codigo, dispositivo, nombre })
    }).then(x => x.json());
    if (!r.ok) throw Error(r.error);
    _tokenVinculadoPendiente = r.token;
  }
  const pin = await sumetecPedirPinToken('Compras', true);
  if (pin === null) {
    sumetecEntrando($('#enlazar'), false);
    _est.textContent = 'Falta crear tu PIN. Pulsa «Vincular» otra vez; no necesitas otro código.';
    return;
  }

  await guardarSesionDireccion(pin, _tokenVinculadoPendiente);
  _tokenVinculadoPendiente = '';
  localStorage.setItem('sumetec_compras_nombre', nombre);
  _comprasUltimoError = '';
  localStorage.setItem('sumetec_compras_dispositivo', dispositivo);
  localStorage.setItem('sumetec_compras_url', url);
  recordarPinDireccion(pin);
  _accesoInicialValidado = true;
  document.body.classList.remove('sin-sesion');
  iniciar();
  sumetecEntrando($('#enlazar'), false);
  _est.textContent = '';
  $('#vincular').close();
  estado();
  _actualizarSnapshotCompras_(pin).catch(() => {});
  _actualizarListasCompras_(pin).catch(() => {});
}

function iniciar() {
  $('#app').innerHTML = formularioComprasDireccion();
  activarComprasDireccion();
}

// Menú ⋮ (rediseño 2026-09-24)
function _cerrarMasMenu_() {
  const m = $('#masMenu'), b = $('#btnMasMenu');
  if (!m) return;
  m.hidden = true;
  if (b) b.setAttribute('aria-expanded', 'false');
}
$('#btnMasMenu').onclick = () => {
  const m = $('#masMenu');
  const abrir = m.hidden;
  m.hidden = !abrir;
  $('#btnMasMenu').setAttribute('aria-expanded', String(abrir));
};
document.addEventListener('click', e => {
  const m = $('#masMenu'), b = $('#btnMasMenu');
  if (!m || m.hidden || m.contains(e.target) || b.contains(e.target)) return;
  _cerrarMasMenu_();
});
// El contenido se prepara después de validar el acceso.
// El chip de estado también envía: mismo botón del menú, mismo flujo.
$('#estado').onclick = () => { if (leer(COLAS.compras).length) $('#enviar-compras').click(); };

$('#enlazar').onclick = e => {
  e.preventDefault();
  vincular().catch(x => { sumetecEntrando($('#enlazar'), false); $('#vincular-estado').textContent = 'Falló: ' + clasificarErrorAcceso(x); });
};
window.addEventListener('online', estado);
window.addEventListener('offline', estado);

// Mismo candado que Dirección (hallazgo 2026-09-10/11): el diálogo de
// vinculación no se puede descartar con Escape/atrás sin vincular de
// verdad -- ver el comentario largo en 14.- SUMETEC DIRECCION/app.js.
$('#vincular').addEventListener('cancel', e => e.preventDefault());
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
      iniciar();
      estado();
      _pintarListasCompras_();
      _actualizarSnapshotCompras_(pin).catch(() => {});
      _actualizarListasCompras_(pin).catch(() => {});
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
// build_deploy.py en cada corrida). Mismo patrón que Dirección/Gastos/Cotizador.
function _mostrarVersionInstalada() {
  const codigo = (typeof VERSION_CODIGO !== 'undefined' && VERSION_CODIGO) ? VERSION_CODIGO : null;
  const v = (typeof VERSION_DEPLOY !== 'undefined' && VERSION_DEPLOY)
    ? new Date(VERSION_DEPLOY).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Sin información';
  const ultima = Number(localStorage.getItem('compras_ultima_actualizacion') || 0);
  const u = ultima
    ? new Date(ultima).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Aún no se ha detectado una actualización nueva en este dispositivo.';
  alert(`Versión del software: ${codigo ? codigo + ' · ' : ''}${v}\nÚltima actualización: ${u}`);
}

// Bug #1 (2026-09-23): antes cualquier campo con valor contaba como captura en curso, y la
// pantalla siempre trae valores puestos por la app (fecha de hoy, modo A/B/C, socio, fondo 0):
// la recarga por actualización se aplazaba para siempre. Ahora solo cuenta lo que el usuario CAMBIÓ.
function _campoEditadoPorUsuario_(el) {
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return false;
  if (['file', 'date', 'radio', 'checkbox', 'hidden', 'button', 'submit'].includes(el.type)) return false;
  return !!el.value && el.value !== el.defaultValue;
}
function hayTrabajoSinGuardarCompras() {
  if (_campoEditadoPorUsuario_(document.activeElement)) return true;
  const form = document.querySelector('#app form');
  if (!form) return false;
  return [...form.elements].some(_campoEditadoPorUsuario_);
}
