// Dirección → Permisos (2026-10-20). Lo que los vendedores piden permiso para hacer (cancelar o eliminar una remisión,
// anular un pago, cerrar un conteo…) llega aquí. El dueño lo aprueba con su huella o Face ID (o con el PIN de
// Dirección si su teléfono no tiene sensor), o lo rechaza. El teléfono que lo pidió sigue solo en cuanto se aprueba.
// Solo un teléfono APROBADOR ve la lista (se marca en el ERP: Ecosistema → Acceso de las apps); el servidor lo revisa.
// La lógica común (pedir, esperar, resolver, huella) vive en acceso.js; aquí solo va la pantalla.

// A qué servidor y con qué token: el token de Dirección sale con su PIN o su huella.
if (typeof sumetecRegistrarServidor === 'function') sumetecRegistrarServidor('direccion', async () => {
  const url = localStorage.getItem('sumetec_direccion_url');
  if (!url) return null;
  return { url, token: await abrirSesionDireccion(await pedirPinDireccion()) };
});

const _ACCIONES_PERMISO_ = {
  cancelar_remision: 'Cancelar remisión', eliminar_remision: 'Eliminar remisión', modificar_remision: 'Modificar remisión',
  anular_pago: 'Anular un pago', abrir_cotizacion: 'Abrir cotización', convertir_cotizacion: 'Convertir cotización',
  quitar_cotizacion: 'Quitar cotización', cerrar_conteo: 'Cerrar conteo', editar_conteo_cerrado: 'Editar conteo cerrado',
  descartar_pendiente: 'Descartar pendiente', descartar_compra: 'Descartar compra', descartar_abono: 'Descartar abono',
  anular_movimiento_caja: 'Corregir movimiento de caja', timbrar_global: 'Factura global', cancelar_factura: 'Cancelar factura'
};
const _APPS_PERMISO_ = { cotizador: 'Cotizador', gastos: 'Gastos', direccion: 'Dirección', compras: 'Compras', fact: 'Facturación', logistica: 'Logística' };
let _permisosReloj = null, _permisosUltimos = [];

function _escPermiso_(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _haceCuanto_(ms) {
  const min = Math.max(0, Math.round((Date.now() - (Number(ms) || 0)) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.round(min / 60);
  return h < 24 ? 'hace ' + h + ' h' : 'hace ' + Math.round(h / 24) + ' d';
}

function formularioPermisosDireccion() {
  return '<h1>Permisos</h1>'
    + '<p class="text-muted" style="font-size:13px">Lo que los teléfonos te piden permiso para hacer. Al aprobar, confirma con tu huella o Face ID; el teléfono que lo pidió sigue solo. Cada permiso vale solo para ese documento durante 24 h.</p>'
    + '<div id="permisos-lista"><p class="text-muted">Cargando…</p></div>';
}

function _pintarPermisos_(caja, lista) {
  _permisosUltimos = lista;
  const pendientes = lista.filter(a => a.estado === 'PENDIENTE'), resueltos = lista.filter(a => a.estado !== 'PENDIENTE');
  _marcarInsigniaPermisos_(pendientes.length);
  const tarjeta = (a, conBotones) => {
    const accion = _ACCIONES_PERMISO_[a.accion] || String(a.accion || '').replace(/_/g, ' ');
    const estado = { APROBADA: '✔ Aprobado', RECHAZADA: '✖ Rechazado', VENCIDA: 'Vencido' }[a.estado] || '';
    return '<div class="card" style="margin-bottom:10px"><div class="card-body">'
      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><strong>' + _escPermiso_(accion) + '</strong>'
      + '<small class="text-muted">' + _escPermiso_(_APPS_PERMISO_[a.app] || a.app) + '</small></div>'
      + (a.detalle ? '<div style="margin-top:4px">' + _escPermiso_(a.detalle) + '</div>' : '')
      + '<small class="text-muted">' + _escPermiso_(a.pedidoPor || 'Un teléfono') + ' · ' + _haceCuanto_(a.pedido) + '</small>'
      + (conBotones
        ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">'
          + '<button type="button" class="btn btn-outline-secondary" data-rechazar="' + _escPermiso_(a.id) + '">Rechazar</button>'
          + '<button type="button" class="btn btn-success" data-aprobar="' + _escPermiso_(a.id) + '">Aprobar</button></div>'
        : '<div style="margin-top:6px;font-weight:600">' + _escPermiso_(estado) + (a.resueltoPor ? ' <small class="text-muted">· ' + _escPermiso_(a.resueltoPor) + '</small>' : '') + '</div>')
      + '</div></div>';
  };
  caja.innerHTML = (pendientes.length ? pendientes.map(a => tarjeta(a, true)).join('') : '<p class="text-muted">No hay permisos esperando. 👍</p>')
    + (resueltos.length ? '<h2 style="font-size:15px;margin:18px 0 8px">Últimas 24 h</h2>' + resueltos.map(a => tarjeta(a, false)).join('') : '');
  caja.querySelectorAll('[data-aprobar]').forEach(b => b.onclick = () => _resolverPermisoDireccion_(b, true));
  caja.querySelectorAll('[data-rechazar]').forEach(b => b.onclick = () => _resolverPermisoDireccion_(b, false));
}

async function _resolverPermisoDireccion_(boton, aprobar) {
  const id = boton.dataset.aprobar || boton.dataset.rechazar;
  boton.closest('.card').querySelectorAll('button').forEach(b => { b.disabled = true; });
  // El toque de «Aprobar» abre el sensor (iPhone exige que sea un toque). Sin huella activa, pide el PIN de Dirección.
  const r = await sumetecResolverPermiso('direccion', id, aprobar,
    () => pedirPinDireccion().then(pin => abrirSesionDireccion(pin)).then(() => true, () => false));
  if (r && r.ok) toast(aprobar ? '✔ Aprobado: el teléfono que lo pidió ya puede seguir.' : 'Rechazado.', 3500);
  else if (!(r && r.cancelado)) toast((r && (r.sinRed ? 'Sin señal: intenta de nuevo.' : r.error)) || 'No se pudo guardar.', 6000);
  await _cargarPermisosDireccion_();
}

async function _cargarPermisosDireccion_() {
  const caja = document.getElementById('permisos-lista');
  if (!caja) return;
  let r;
  try { r = await sumetecPermisosPendientes('direccion'); }
  catch (e) { r = { ok: false, error: typeof clasificarErrorAcceso === 'function' ? clasificarErrorAcceso(e) : String(e && e.message || e) }; }
  if (vistaActivaDireccion() !== 'permisos') return;
  if (r && r.sinRed) { caja.innerHTML = '<p class="text-muted">Sin señal: se vuelve a revisar sola en cuanto haya internet.</p>'; return; }
  if (!r || !r.ok) {
    caja.innerHTML = '<div class="card"><div class="card-body">' + _escPermiso_((r && r.error) || 'No se pudo leer la lista.') + '</div></div>';
    return;
  }
  // No repintar si nada cambió (no mover la pantalla mientras se lee).
  const firma = JSON.stringify((r.aprobaciones || []).map(a => [a.id, a.estado]));
  if (caja.dataset.firma === firma) return;
  caja.dataset.firma = firma;
  _pintarPermisos_(caja, r.aprobaciones || []);
}

function activarPermisosDireccion() {
  _cargarPermisosDireccion_();
  if (_permisosReloj) clearInterval(_permisosReloj);
  _permisosReloj = setInterval(() => {
    if (vistaActivaDireccion() !== 'permisos') { clearInterval(_permisosReloj); _permisosReloj = null; return; }
    if (!document.hidden) _cargarPermisosDireccion_();
  }, 8000);
}

// Insignia en el botón de abajo: cuántos esperan. Se revisa sola cada minuto, pero solo si el PIN sigue vigente
// (nunca abre el teclado de PIN por su cuenta) y solo en el teléfono del dueño.
function _marcarInsigniaPermisos_(n) {
  const b = document.querySelector('[data-vista="permisos"]');
  if (!b) return;
  let i = b.querySelector('.insignia-permisos');
  if (!i) { i = document.createElement('b'); i.className = 'insignia-permisos'; b.appendChild(i); }
  i.textContent = n > 9 ? '9+' : String(n || '');
  i.hidden = !n;
}
async function _revisarInsigniaPermisos_() {
  if (document.hidden || !navigator.onLine || vistaActivaDireccion() === 'permisos') return;
  if (typeof sumetecSoyAprobador === 'function' && !sumetecSoyAprobador('direccion')) return;
  const vigente = (typeof _pinVigente === 'function' && _pinVigente()) || (typeof sumetecPinGuardado === 'function' && sumetecPinGuardado('direccion'));
  if (!vigente) return;
  try {
    const r = await sumetecPermisosPendientes('direccion');
    if (r && r.ok) _marcarInsigniaPermisos_((r.aprobaciones || []).filter(a => a.estado === 'PENDIENTE').length);
  } catch (_) { /* la insignia nunca interrumpe */ }
}
if (typeof document !== 'undefined' && typeof setInterval === 'function') {
  setInterval(_revisarInsigniaPermisos_, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _revisarInsigniaPermisos_(); });
}
