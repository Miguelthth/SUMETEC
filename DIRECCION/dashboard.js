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
// Qué pestaña de dinero se vuelve a pedir al servidor cuando suena el timbre (pura y probada):
// 'datos' = cobros/anulaciones/cancelaciones de las remisiones, 'erp' = lo que publica el ERP.
function _vistaARefrescarPorTimbre_(temas, vista) {
  const t = temas || [];
  if ((t.includes('datos') || t.includes('erp')) && (vista === 'caja' || vista === 'corte')) return vista;
  return null;
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

// Compra sugerida (2026-10-01): lo que falta por comprar, ya calculado por el
// ERP (90% del máximo). Pura, para probarla sin el snapshot completo.
function _htmlCompraSugeridaDireccion_(c) {
  if (!c) return '';
  if (!c.items || !c.items.length) {
    return '<section class="compra-sugerida"><h2>Falta por comprar</h2><p class="sin-prioridades">Nada por reordenar por ahora.</p></section>';
  }
  const urg = Number(c.nAgotados || 0);
  return `<section class="compra-sugerida">
  <h2>Falta por comprar</h2>
  <p class="compra-total">Total del pedido <strong class="num">${_dineroDireccion(c.total)}</strong> · ${Number(c.nProductos || 0)} productos${urg ? ` · <span class="compra-urgente">${urg} agotado${urg === 1 ? '' : 's'}</span>` : ''}</p>
  <ul class="compra-lista">${c.items.map(i => `<li class="${i.agotado ? 'agotado' : ''}">
    <span class="compra-desc"><strong>${_escDir_(i.descripcion || i.codigo)}</strong><small>${_escDir_(i.proveedor)} · ${_escDir_(i.codigo)}${i.agotado ? ' · URGENTE — agotado' : ''}</small></span>
    <span class="compra-cant num">${Number(i.cantidad || 0)} × ${_dineroDireccion(i.costoUnit)}<strong>${_dineroDireccion(i.importe)}</strong></span>
  </li>`).join('')}</ul>
  ${c.hayMas ? `<small>y ${Number(c.hayMas)} productos más (ver el ERP).</small>` : ''}
  ${c.nSinCosto ? `<small>${Number(c.nSinCosto)} sin costo registrado: no suman al total.</small>` : ''}
</section>`;
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
${_htmlCompraSugeridaDireccion_(s.compraSugerida)}
<section class="pendientes-linea">
  <i class="bi bi-clock-history" aria-hidden="true"></i>
  <div>
    <h2>Pendiente de integrar</h2>
    <p>${Number(p.compras || 0)} compras · ${Number(p.movimientos || 0)} movimientos · ${Number(p.cierres || 0)} cortes${Number(p.anulacionesPorRevisar || 0) ? ' · ' + Number(p.anulacionesPorRevisar) + ' anulaciones por revisar' : ''}</p>
    <small>No se suman a las cifras oficiales.</small>
  </div>
</section>`;
}

// ── Panel (2026-10-14, pedido de Miguel) ─────────────────────────────────────
// «Lo más importante que siempre debo saber» como dueño, administrador y
// contador. Todo viene YA calculado en snapshot.tablero (ERP:
// services/dashboard_snapshot.py::_tablero); aquí solo se dibuja. Puro.
function _pctDir_(v) { return (Number(v || 0) * 100).toFixed(1) + '%'; }
function _filaDir_(etiqueta, valor, clase) {
  return `<article class="metrica${clase ? ' ' + clase : ''}">${etiqueta}<strong class="num">${valor}</strong></article>`;
}
function _bloqueFaltaDir_(titulo, err) {
  return `<section class="panel-bloque"><h2>${titulo}</h2><p class="text-aviso">No se pudo calcular en el ERP${err ? ': ' + _escDir_(err) : ''}.</p></section>`;
}

function _htmlPanelNegocio_(n) {
  const ant = Number(n.ventasMesAnterior || 0);
  let comp = 'sin ventas el mes pasado a estas alturas';
  if (ant > 0) {
    const d = (Number(n.ventas || 0) - ant) / ant;
    comp = `<span class="${d >= 0 ? 'text-verde' : 'text-rojo'}">${d >= 0 ? '▲' : '▼'} ${_pctDir_(Math.abs(d))}</span> vs. mes pasado al mismo día (${_dineroDireccion(ant)})`;
  }
  const meta = n.meta
    ? `<p class="panel-nota">Meta ${_dineroDireccion(n.meta.meta)}: vas en ${_pctDir_(n.meta.avance)} · al ritmo de hoy cierras en ${_dineroDireccion(n.meta.proyeccion)}</p>`
    : '';
  return `<section class="panel-bloque"><h2><i class="bi bi-graph-up-arrow" aria-hidden="true"></i> Negocio <small>dueño</small></h2>
<section class="metricas">
  ${_filaDir_('Ventas del mes', _dineroDireccion(n.ventas))}
  ${_filaDir_('Utilidad neta', _dineroDireccion(n.utilidadNeta), Number(n.utilidadNeta) < 0 ? 'metrica-mal' : '')}
  ${_filaDir_('Margen bruto', _pctDir_(n.margenBruto))}
  ${_filaDir_('Gastos', _dineroDireccion(n.gastos))}
  ${_filaDir_('Ventas', Number(n.nVentas || 0))}
  ${_filaDir_('Ticket promedio', _dineroDireccion(n.ticket))}
</section>
<p class="panel-nota">${comp}</p>${meta}</section>`;
}

function _htmlPanelDinero_(d) {
  const deudores = (d.deudores || []).map(x => `<li><span>${_escDir_(x.cliente)}<small>${Number(x.dias)} días vencido</small></span><strong class="num">${_dineroDireccion(x.saldo)}</strong></li>`).join('');
  const acreedores = (d.acreedores || []).map(x => `<li class="${x.vencido ? 'vencido' : ''}"><span>${_escDir_(x.proveedor)}<small>${Number(x.dias)} días${x.vencido ? ' · vencido' : ''}</small></span><strong class="num">${_dineroDireccion(x.saldo)}</strong></li>`).join('');
  const f = d.flujo30 || {};
  const neto = Number(f.entra || 0) - Number(f.sale || 0);
  const corte = d.nuncaCorte ? 'nunca se ha hecho corte' : (Number(d.diasSinCorte) === 0 ? 'corte al día' : `${Number(d.diasSinCorte)} día(s) sin corte`);
  return `<section class="panel-bloque"><h2><i class="bi bi-wallet2" aria-hidden="true"></i> Dinero <small>administrador</small></h2>
<section class="metricas">
  ${_filaDir_('Efectivo en caja (estimado)', _dineroDireccion(d.efectivoCaja))}
  ${_filaDir_('Corte de caja', corte, Number(d.diasSinCorte) > 2 || d.nuncaCorte ? 'metrica-aviso' : '')}
  ${_filaDir_('Me deben (vencido)', _dineroDireccion(d.carteraVencida), Number(d.carteraUrgente) > 0 ? 'metrica-mal' : '')}
  ${_filaDir_('Me deben (en plazo)', _dineroDireccion(d.carteraAlCorriente))}
  ${_filaDir_('Debo a proveedores', _dineroDireccion(d.porPagar))}
  ${_filaDir_('De eso, ya vencido', _dineroDireccion(d.porPagarVencido), Number(d.porPagarVencido) > 0 ? 'metrica-aviso' : '')}
  ${_filaDir_('Inventario a costo', _dineroDireccion(d.inventarioCosto))}
  ${_filaDir_('Sin venderse en 90 días', _dineroDireccion(d.inventarioParado))}
  ${_filaDir_('Próximos 30 días: entra − sale', `<span class="${neto >= 0 ? 'text-verde' : 'text-rojo'}">${_dineroDireccion(neto)}</span>`, 'metrica-ancha')}
</section>
${Number(d.carteraUrgente) > 0 ? `<p class="panel-nota text-rojo">${_dineroDireccion(d.carteraUrgente)} con más de ${Number(d.diasUrgente)} días vencido: cobrar ya.</p>` : ''}
${deudores ? `<h3>Quién me debe más</h3><ul class="panel-lista">${deudores}</ul>` : ''}
${acreedores ? `<h3>A quién le debo más</h3><ul class="panel-lista">${acreedores}</ul>` : ''}
<p class="panel-nota">Entra = cartera esperada · sale = gasto promedio + IVA pendiente + proveedores${f.saldoInicialCapturado ? '' : ' (no incluye tu saldo de banco)'}.</p></section>`;
}

function _htmlPanelImpuestos_(t, mes) {
  const dec = t.declaracion || {};
  const dias = Number(dec.dias);
  const urg = dias <= 3 ? 'nivel-danger' : (dias <= 7 ? 'nivel-warning' : 'nivel-info');
  const cuando = dias < 0 ? `venció hace ${Math.abs(dias)} día(s)` : (dias === 0 ? 'vence HOY' : `vence en ${dias} día(s)`);
  const avisos = [];
  if ((t.mesesSinCerrar || []).length) avisos.push(`<li class="nivel-danger"><strong>Meses sin cerrar en Impuestos: ${t.mesesSinCerrar.map(_escDir_).join(', ')}</strong></li>`);
  if (Number(t.isrPendienteMeses)) avisos.push(`<li class="nivel-warning"><strong>ISR sin marcar pagado: ${Number(t.isrPendienteMeses)} mes(es)</strong><span class="detalle">${_dineroDireccion(t.isrPendienteMonto)}</span></li>`);
  if (Number(t.gastosSinFactura)) avisos.push(`<li class="nivel-warning"><strong>${Number(t.gastosSinFactura)} gasto(s) sin factura este mes</strong><span class="detalle">${_dineroDireccion(t.ivaEnRiesgo)} de IVA que no podrás acreditar</span></li>`);
  return `<section class="panel-bloque"><h2><i class="bi bi-bank2" aria-hidden="true"></i> Impuestos <small>contador</small></h2>
<ol class="prioridades"><li class="${urg}"><span class="prioridad-cabeza"><span class="prioridad-nivel">SAT</span><strong>Declaración de ${_escDir_(dec.mes)}: ${cuando}</strong></span><span class="detalle">Límite ${_escDir_(dec.vence)} (día 17)</span></li>${avisos.join('')}</ol>
<h3>Lo que va de ${_escDir_(mes)} (estimado)</h3>
<section class="metricas">
  ${_filaDir_('IVA cobrado', _dineroDireccion(t.ivaTrasladado))}
  ${_filaDir_('IVA acreditable', _dineroDireccion(t.ivaAcreditable))}
  ${_filaDir_('IVA a pagar', _dineroDireccion(t.ivaAPagar), Number(t.ivaAPagar) > 0 ? 'metrica-aviso' : '')}
  ${_filaDir_('IVA a favor', _dineroDireccion(t.ivaAFavor))}
  ${_filaDir_('ISR RESICO (' + _pctDir_(t.isrTasa) + ' de lo cobrado)', _dineroDireccion(t.isrAPagar), 'metrica-ancha')}
</section>
<p class="panel-nota">Base ISR: ${_dineroDireccion(t.isrBase)} cobrados sin IVA. Las cifras del mes en curso cambian hasta que cierres el mes en Impuestos.</p></section>`;
}

function renderPanelDireccion(s) {
  if (!s) return '<h1>Panel</h1><p class="text-muted">Aún no hay una fotografía oficial publicada por el ERP.</p>';
  const t = s.tablero;
  const fecha = String(s.generadoEn || '').replace('T', ' ');
  const hace = _haceCuantoDireccion_(s.generadoEn);
  const sello = `<div class="dir-sello"><i class="bi bi-check-circle" aria-hidden="true"></i><p class="oficial">Oficial al ${fecha}${hace ? ' · ' + hace : ''}</p><button type="button" class="btn-sello" onclick="activarPanelDireccion()"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Actualizar</button></div>`;
  if (!t) return `<h1>Panel</h1>${sello}<p class="text-aviso">El ERP todavía no manda el panel. Actualiza el ERP y vuelve a publicar el resumen.</p>`;
  const err = t.errores || {};
  return `<h1>Panel</h1>${sello}
<p class="panel-mes">Mes de ${_escDir_(t.mes)} · día ${Number(t.dia || 0)}</p>
${t.negocio ? _htmlPanelNegocio_(t.negocio) : _bloqueFaltaDir_('Negocio', err.negocio)}
${t.dinero ? _htmlPanelDinero_(t.dinero) : _bloqueFaltaDir_('Dinero', err.dinero)}
${t.impuestos ? _htmlPanelImpuestos_(t.impuestos, t.mes) : _bloqueFaltaDir_('Impuestos', err.impuestos)}`;
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
  if (typeof direccion.umbral_diferencia_corte === 'number' && direccion.umbral_diferencia_corte > 0
      && typeof UMBRAL_CONFIRMAR_DIFERENCIA !== 'undefined') {
    UMBRAL_CONFIRMAR_DIFERENCIA = direccion.umbral_diferencia_corte;
  }
}

// Acceso (2026-10-09): minutos de bloqueo y equipos sin PIN que fijó el ERP (Ecosistema → Acceso de las apps).
// seguridad.js los consulta en cada pedirPinDireccion(); aquí solo se guarda lo que llegó. Ver acceso.js.
function _aplicarAccesoDireccion_(datos) {
  if (typeof sumetecAplicarAcceso !== 'function' || !datos) return;
  try { sumetecAplicarAcceso('direccion', datos.ACCESO); } catch (_) { }
}

async function cargarDashboardDireccion(pin) {
  const url = localStorage.getItem('sumetec_direccion_url');
  const token = await abrirSesionDireccion(pin);
  if(typeof _actualizarFormasCaja_==='function') _actualizarFormasCaja_().catch(()=>{});
  if (typeof sumetecEscucharTimbre === 'function') sumetecEscucharTimbre(temas => {
    if (!(typeof _pinVigente === 'function' && _pinVigente())) return;
    const _v = _vistaARefrescarPorTimbre_(temas, vistaActivaDireccion());
    if (_v === 'caja' && typeof window._refrescarCajaDireccion_ === 'function') window._refrescarCajaDireccion_();
    if (_v === 'corte' && typeof window._refrescarCorteDireccion_ === 'function') window._refrescarCorteDireccion_();
    if (temas.includes('resumen') && vistaActivaDireccion() === 'resumen') activarDashboardDireccion();
    if (temas.includes('resumen') && vistaActivaDireccion() === 'panel') activarPanelDireccion();
    if(temas.includes('catalogo') && typeof _actualizarFormasCaja_==='function') _actualizarFormasCaja_().catch(()=>{});
    if (temas.includes('catalogo') && vistaActivaDireccion() === 'inventario') cargarCatalogoInventario();
    if (temas.includes('configuracion') && vistaActivaDireccion() === 'resumen') activarDashboardDireccion();
  }, async () => {
    if (!(typeof _pinVigente === 'function' && _pinVigente())) return null;
    return sumetecVersionesTimbre(url, await abrirSesionDireccion(await pedirPinDireccion()));
  });
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
      _aplicarAccesoDireccion_(rc.datos);
      if (typeof _aplicarConfigInventarioPublicada_ === 'function') _aplicarConfigInventarioPublicada_(rc.datos.GASTOS);
    }
  }).catch(() => {});
  return r.snapshot;
}

// Resumen y Panel (2026-10-14) piden la MISMA fotografía; solo cambia cómo se dibuja.
async function activarDashboardDireccion() { return _activarVistaSnapshot_('resumen', 'Resumen', renderDashboardDireccion); }
async function activarPanelDireccion() { return _activarVistaSnapshot_('panel', 'Panel', renderPanelDireccion); }

async function _activarVistaSnapshot_(nombreVista, titulo, render) {
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
      `<h1>${titulo}</h1><p>Vincula este teléfono para ver el ${titulo.toLowerCase()}.</p>`;
    return;
  }
  try {
    const pin = await pedirPinDireccion();
    const s = await cargarDashboardDireccion(pin);
    // Mientras el PIN y la consulta estaban pendientes, la navegación
    // (vista()) permite entrar a Compras/Caja/Corte con normalidad. Si el
    // usuario ya no está en Resumen cuando esta respuesta tardía llega, no
    // hay que reemplazar #app -- perdería lo que esté a medio capturar ahí.
    if (typeof vistaActivaDireccion === 'function' && vistaActivaDireccion() !== nombreVista) return;
    document.querySelector('#app').innerHTML = render(s);
    if(nombreVista==='resumen'&&typeof mostrarPanelComercialDireccion==='function')mostrarPanelComercialDireccion(pin);
  } catch (e) {
    if (typeof vistaActivaDireccion === 'function' && vistaActivaDireccion() !== nombreVista) return;
    // Sin red (o el servidor no contestó): en vez de solo un mensaje de
    // error, se muestra la última fotografía que sí se alcanzó a guardar
    // (cargarDashboardDireccion ya la cachea en cada consulta exitosa),
    // marcada como no oficial en este momento.
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem('sumetec_direccion_snapshot_cache') || 'null'); } catch (_) {}
    if (cache && cache.snapshot) {
      const ts = String(cache.ts || '').replace('T', ' ').slice(0, 16);
      document.querySelector('#app').innerHTML = render(cache.snapshot) +
        `<p class="text-aviso">${_escDir_(e.message)} — mostrando la última consulta guardada en este teléfono (${ts || 'fecha desconocida'}).</p>`;
    } else {
      document.querySelector('#app').innerHTML = `<h1>${titulo}</h1><p>${_escDir_(e.message)}</p>`;
    }
  }
}
