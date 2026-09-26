function _dineroDireccion(v) { return '$' + Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Propuesta 6 (mejoras ecosistema 2026-09-10): las prioridades que el ERP ya
// calcula (services/estrategia.py::centro_accion), reempaquetadas para el
// celular. Pura -- separada de renderDashboardDireccion para poder probarla
// con listas vacías/varias sin construir todo el snapshot.
// Rediseño 2026-09-24: el nivel va ESCRITO (no solo el color de la orilla).
const _NIVEL_PRIORIDAD_ = { danger: 'Urgente', warning: 'Pronto', info: 'Aviso', secondary: 'Aviso' };
// Auditoría 2026-09-25 (H-11): todo texto que viene del ERP o de un error se
// escapa antes de ir al HTML. Hoy el ERP solo arma avisos con números, pero el
// día que un aviso traiga un nombre capturado en campo sería un XSS dentro de
// la app que guarda el token de Dirección.
function _escDir_(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _htmlPrioridadesDireccion_(prioridades) {
  if (!prioridades || !prioridades.length) {
    return '<p class="sin-prioridades">Sin prioridades pendientes en este momento.</p>';
  }
  return '<ol class="prioridades">' + prioridades.map(p => `<li class="nivel-${_NIVEL_PRIORIDAD_[p.nivel] ? p.nivel : 'info'}">
    <span class="prioridad-cabeza"><span class="prioridad-nivel">${_NIVEL_PRIORIDAD_[p.nivel] || 'Aviso'}</span><strong>${_escDir_(p.motivo)}</strong></span>
    ${p.detalle ? `<span class="detalle">${_escDir_(p.detalle)}</span>` : ''}
    <span class="pantalla">Resolver en ${_escDir_(p.pantalla)} →</span>
  </li>`).join('') + '</ol>';
}

// "hace 12 min" a partir del generadoEn del ERP. Pura: '' si no se entiende.
function _haceCuantoDireccion_(iso, ahora) {
  const t = Date.parse(String(iso || ''));
  if (isNaN(t)) return '';
  const min = Math.round(((ahora || Date.now()) - t) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}

function renderDashboardDireccion(s) {
  if (!s) return '<h1>Resumen</h1><p class="text-muted">Aún no hay una fotografía oficial publicada por el ERP.</p>';
  const p = s.pendienteIntegrar || {};
  const fecha = String(s.generadoEn || '').replace('T', ' ');
  const hace = _haceCuantoDireccion_(s.generadoEn);
  // Rediseño 2026-09-24: una cifra principal (utilidad neta) + cuadrícula
  // compacta; sello de frescura con "hace X" y botón para volver a consultar.
  return `<h1>Resumen</h1>
<div class="dir-sello"><i class="bi bi-check-circle" aria-hidden="true"></i><p class="oficial">Oficial al ${fecha}${hace ? ' · ' + hace : ''}</p><button type="button" class="btn-sello" onclick="activarDashboardDireccion()"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Actualizar</button></div>
<section class="dir-heroe"><span>Utilidad neta</span><strong class="num">${_dineroDireccion(s.utilidadNeta)}</strong></section>
<section class="metricas">
  <article class="metrica">Ventas<strong class="num">${_dineroDireccion(s.ventas)}</strong></article>
  <article class="metrica">Cobrado<strong class="num">${_dineroDireccion(s.cobrado)}</strong></article>
  <article class="metrica">Gastos<strong class="num">${_dineroDireccion(s.gastos)}</strong></article>
  <article class="metrica">Compras<strong class="num">${_dineroDireccion(s.compras)}</strong></article>
  <article class="metrica metrica-ancha">Cartera por cobrar<strong class="num">${_dineroDireccion(s.cartera)}</strong></article>
</section>
<section class="prioridades-erp">
  <h2>Qué necesita tu atención</h2>
  ${_htmlPrioridadesDireccion_(s.prioridades)}
</section>
<section class="pendientes-linea">
  <i class="bi bi-clock-history" aria-hidden="true"></i>
  <div>
    <h2>Pendiente de integrar</h2>
    <p>${Number(p.compras || 0)} compras · ${Number(p.movimientos || 0)} movimientos · ${Number(p.cierres || 0)} cortes</p>
    <small>No se suman a las cifras oficiales.</small>
  </div>
</section>`;
}

// Ecosistema centralizado (2026-09): aplica DENOMINACIONES_MXN/PIN_TIMEOUT_MS
// si el ERP publicó algo válido -- nunca deja los globales en un estado raro
// (lista vacía, timeout en 0), eso congelaría el corte o la sesión.
function _aplicarConfigDireccionPublicada_(direccion) {
  if (!direccion) return;
  if (Array.isArray(direccion.denominaciones_mxn) && direccion.denominaciones_mxn.length) {
    DENOMINACIONES_MXN = direccion.denominaciones_mxn;
  }
  if (typeof direccion.pin_timeout_minutos === 'number' && direccion.pin_timeout_minutos > 0) {
    PIN_TIMEOUT_MS = direccion.pin_timeout_minutos * 60000;
  }
}

async function cargarDashboardDireccion(pin) {
  const url = localStorage.getItem('sumetec_direccion_url');
  const token = await abrirSesionDireccion(pin);
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ tipo: 'dashboard_snapshot', token })
  }).then(x => x.json());
  if (!r.ok) throw Error(r.error || 'No se pudo consultar el resumen');
  // Propuesta 3 (mejoras ecosistema 2026-09-10). Hasta el 2026-09-11 esto lo
  // leía compras.js para su historial reciente -- desde F3 (Compras salió
  // como app propia) ya no aplica: Compras pide su PROPIO dashboard_snapshot
  // (ver 18.- SUMETEC COMPRAS/compras.js::_actualizarSnapshotCompras_), otro
  // origen, otro localStorage. Se conserva el cacheo aquí por si algo más
  // dentro de Dirección lo llega a necesitar; hoy no lo lee nadie más.
  try {
    localStorage.setItem('sumetec_direccion_snapshot_cache',
      JSON.stringify({ ts: new Date().toISOString(), snapshot: r.snapshot }));
  } catch (_) {}
  // Best-effort, en paralelo, nunca bloquea ni rompe el resumen: la sección
  // DIRECCION del ecosistema centralizado (ver services/publicar.py del ERP).
  fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ tipo: 'configuracion', token })
  }).then(x => x.json()).then(rc => {
    if (rc && rc.ok && rc.datos) {
      localStorage.setItem('sumetec_direccion_config_cache', JSON.stringify({ ts: rc.ts || '', datos: rc.datos }));
      _aplicarConfigDireccionPublicada_(rc.datos.DIRECCION);
      if (typeof _aplicarConfigInventarioPublicada_ === 'function') _aplicarConfigInventarioPublicada_(rc.datos.GASTOS);
    }
  }).catch(() => {});
  return r.snapshot;
}

async function activarDashboardDireccion() {
  // Hallazgo 2026-09-10 (Miguel: "Escape cierra el diálogo de vinculación"):
  // no era ese diálogo -- este código pedía el PIN sin fijarse si YA había
  // un teléfono vinculado. La primera vez que se abre la app (o cualquier
  // vez sin sesión), #vincular y #pin-modal terminaban abiertos los dos a
  // la vez, compitiendo; #pin-modal SÍ es cancelable a propósito (uso
  // diario), así que Escape lo cerraba a él, no al de vinculación, dejando
  // "PIN cancelado" en Resumen y la falsa impresión de que el candado de
  // #vincular no servía. Sin sesión, no hay nada que consultar todavía.
  if (!localStorage.getItem(SESION_KEY)) {
    document.querySelector('#app').innerHTML =
      '<h1>Resumen</h1><p>Vincula este teléfono para ver el resumen.</p>';
    return;
  }
  try {
    const pin = await pedirPinDireccion();
    const s = await cargarDashboardDireccion(pin);
    // Mientras el PIN y la consulta estaban pendientes, la navegación
    // (vista()) permite entrar a Compras/Caja/Corte con normalidad. Si el
    // usuario ya no está en Resumen cuando esta respuesta tardía llega, no
    // hay que reemplazar #app -- perdería lo que esté a medio capturar ahí.
    if (typeof vistaActivaDireccion === 'function' && vistaActivaDireccion() !== 'resumen') return;
    document.querySelector('#app').innerHTML = renderDashboardDireccion(s);
  } catch (e) {
    if (typeof vistaActivaDireccion === 'function' && vistaActivaDireccion() !== 'resumen') return;
    // Sin red (o el servidor no contestó): en vez de solo un mensaje de
    // error, se muestra la última fotografía que sí se alcanzó a guardar
    // (cargarDashboardDireccion ya la cachea en cada consulta exitosa),
    // marcada como no oficial en este momento.
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem('sumetec_direccion_snapshot_cache') || 'null'); } catch (_) {}
    if (cache && cache.snapshot) {
      const ts = String(cache.ts || '').replace('T', ' ').slice(0, 16);
      document.querySelector('#app').innerHTML = renderDashboardDireccion(cache.snapshot) +
        `<p class="text-aviso">${_escDir_(e.message)} — mostrando la última consulta guardada en este teléfono (${ts || 'fecha desconocida'}).</p>`;
    } else {
      document.querySelector('#app').innerHTML = `<h1>Resumen</h1><p>${_escDir_(e.message)}</p>`;
    }
  }
}
