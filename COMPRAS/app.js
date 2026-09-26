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

let _accesoInicialValidado = false;
async function vincular() {
  const url = $('#url').value.trim();
  const codigo = $('#codigo').value.trim();
  const pin = $('#pin').value;
  const _est = $('#vincular-estado');
  if (!url || !codigo || pin.length < 4) { _est.textContent = 'Faltan datos: URL, código y un PIN de mínimo 4 dígitos.'; return; }
  if (!_urlAppsScriptValida(url)) { _est.textContent = 'Esa no es una URL de Apps Script. Debe ser https://script.google.com/macros/s/…/exec'; return; }
  _est.textContent = '';
  sumetecEntrando($('#enlazar'), true);

  const dispositivo = localStorage.getItem('sumetec_compras_dispositivo') || crypto.randomUUID();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      tipo: 'vincular_dispositivo', codigo, dispositivo,
      nombre: navigator.userAgent.slice(0, 60)
    })
  }).then(x => x.json());
  if (!r.ok) throw Error(r.error);

  await guardarSesionDireccion(pin, r.token);
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
      aviso = clasificarErrorAcceso(e);
      await new Promise(r => setTimeout(r, 150));
    }
  }
}
document.body.classList.add('sin-sesion');
if (!localStorage.getItem(SESION_KEY)) $('#vincular').showModal();
else _abrirAccesoInicial();

// Registro + actualización activa del service worker -- mismo patrón que
// Dirección/Gastos/Cotizador.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(registro => {
    const revisar = () => registro.update().catch(() => {});
    setInterval(revisar, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revisar();
    });
    window.addEventListener('online', revisar);
  });

  let huboControlador = !!navigator.serviceWorker.controller;
  let recargaPendiente = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!huboControlador) { huboControlador = true; return; }
    localStorage.setItem('compras_ultima_actualizacion', String(Date.now()));
    if (sessionStorage.getItem('sumetec_compras_actualizacion')) return;
    if (hayTrabajoSinGuardarCompras()) { recargaPendiente = true; return; }
    window.location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (!recargaPendiente || document.visibilityState !== 'hidden') return;
    if (hayTrabajoSinGuardarCompras()) return;
    window.location.reload();
  });
}

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
  alert(`Act. software: ${codigo ? codigo + ' · ' : ''}${v}\nÚltima actualización: ${u}`);
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
