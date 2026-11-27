// direccion-ui.js · Acomodo, hojas y gestos del diseño «mejorado» (2026-11-26). Va antes de que se abra la sesión
// y solo reacomoda lo que ya pintan caja.js, corte.js, dashboard.js, inventario.js y aprobaciones.js: las cifras,
// los envíos, el PIN y los permisos siguen siendo de esos archivos.
(function () {
  'use strict';
  const q = s => document.querySelector(s);
  const todas = (s, c) => [...(c || document).querySelectorAll(s)];
  const e = v => SMX.esc(v);
  const nodo = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const irA = nombre => { const b = q('.sm-nav [data-vista="' + nombre + '"]'); if (b) b.click(); };
  const pinVigente = () => typeof _pinVigente === 'function' && _pinVigente();
  let permisos = null;   // cuántos esperan; null = todavía no se ha consultado

  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  SMX.texto(q('#smxFecha'), hoy.charAt(0).toUpperCase() + hoy.slice(1));

  // ── Avisos = permisos esperando ──
  const insigniaOriginal = window._marcarInsigniaPermisos_;
  window._marcarInsigniaPermisos_ = function (n) { const r = insigniaOriginal.apply(this, arguments); permisos = Number(n) || 0; SMX.avisos(permisos); pintarPermisosResumen(); return r; };
  q('#smxAvisos').addEventListener('click', () => irA('permisos'));

  // ── Cuentas de los movimientos de Caja que ya se consultaron (anulados y anulaciones no suman) ──
  function cuentas(movs) {
    const vivos = movs.filter(m => !m.anulado && m.tipo !== 'ANULACION');
    const entra = vivos.filter(m => m.signo === '+'), sale = vivos.filter(m => m.signo !== '+');
    const t = l => l.reduce((a, m) => a + Number(m.monto || 0), 0);
    return { n: vivos.length, nEntra: entra.length, nSale: sale.length, entra: t(entra), sale: t(sale) };
  }

  // ── RESUMEN ──
  const kpi = (icono, etiqueta, valor, nota, extra) => '<article class="dv-kpi' + (extra || '') + '"><span class="lbl"><i class="bi ' + icono + '" aria-hidden="true"></i>' + etiqueta + '</span><strong class="val">' + valor + '</strong><span class="sub">' + nota + '</span></article>';
  const atajos = [['caja', 'bi-plus-lg', 'Movimiento'], ['corte', 'bi-calculator', 'Hacer corte'], ['inventario', 'bi-box-seam', 'Inventario'], ['permisos', 'bi-lock', 'Permisos']];
  const resumenOriginal = window.renderDashboardDireccion;
  window.renderDashboardDireccion = function (s) {
    const html = resumenOriginal.apply(this, arguments);
    const caja = s && s.tablero && s.tablero.dinero ? s.tablero.dinero.efectivoCaja : null;
    const rapido = '<div class="dv-rapido">' + atajos.map(a => '<button type="button" data-ir="' + a[0] + '" aria-label="Atajo: ' + a[2] + '"><span class="qi" aria-hidden="true"><i class="bi ' + a[1] + '"></i></span>' + a[2] + '</button>').join('') + '</div>';
    const recientes = '<section class="dv-tarjeta"><div style="display:flex;align-items:center;gap:10px"><h2 style="flex:1">Movimientos recientes</h2><button type="button" class="smx-mini" data-ir="caja" aria-label="Ir a todos los de hoy">Ver todos</button></div><div id="dv-recientes"><p class="smx-hint">Abre Caja para consultarlos.</p></div></section>';
    if (!s) return html + rapido + recientes;
    const doc = document.createElement('div');
    doc.innerHTML = html;
    const kpis = nodo('<div class="dv-kpis">' +
      kpi('bi-graph-down', 'Ventas', _dineroDireccion(s.ventas), 'Cobrado ' + _dineroDireccion(s.cobrado)) +
      kpi('bi-cash-stack', 'Caja actual', caja === null ? '—' : _dineroDireccion(caja), caja === null ? 'La calcula el ERP' : 'Efectivo estimado') +
      kpi('bi-list-check', 'Movimientos', '<span id="dv-movs">—</span>', '<span id="dv-movs-sub">Hoy en Caja</span>') +
      kpi('bi-exclamation-triangle', 'Permisos', '<span id="dv-permisos">' + (permisos === null ? '—' : permisos) + '</span>', 'Esperando tu aprobación', ' alerta') +
      '</div>');
    const despues = doc.querySelector('.dir-sello');
    if (despues) despues.after(kpis, nodo(rapido), nodo(recientes));
    const heroe = doc.querySelector('.dir-heroe'), metricas = doc.querySelector('.metricas');
    if (heroe && metricas) {
      const t = nodo('<section class="dv-tarjeta"><h2>Cifras oficiales del ERP</h2></section>');
      heroe.before(t); t.append(heroe, metricas);
    }
    const panel = nodo('<section class="dv-tarjeta"><h2>Panel del negocio</h2><p class="smx-hint">Margen, meta, cartera, flujo de 30 días e impuestos están en <b>Panel</b>.</p><button type="button" class="btn btn-primary btn-bloque" data-ir="panel" aria-label="Abrir el detalle del negocio" style="margin-top:10px">Ver Panel</button></section>');
    doc.appendChild(panel);
    return doc.innerHTML;
  };
  function pintarPermisosResumen() { SMX.texto(q('#dv-permisos'), permisos === null ? '—' : permisos); }
  let pidiendoMovs = false;
  async function cargarRecientes() {
    const caja = q('#dv-recientes');
    if (!caja || caja.dataset.listo || pidiendoMovs || !pinVigente()) return;
    pidiendoMovs = true;
    if (permisos === null) _revisarInsigniaPermisos_();   // la cifra de «Permisos» sin esperar el minuto
    try {
      const movs = await cargarMovimientosCajaDireccion(await pedirPinDireccion(), _fechaLocalDireccion_());
      const el = q('#dv-recientes');
      if (!el) return;
      el.dataset.listo = '1';
      const c = cuentas(movs);
      SMX.texto(q('#dv-movs'), c.n);
      SMX.texto(q('#dv-movs-sub'), c.nEntra + ' entradas · ' + c.nSale + ' salidas');
      el.innerHTML = movs.length ? movs.slice(-3).reverse().map(m => '<div class="smx-renglon"><span>' + e(_etiquetaClaseCaja(m.tipo)) + (m.anulado ? ' (anulado)' : '') + '<br><small>' + e(m.metodo) + ' · ' + e(_horaCaja(m.hora)) + '</small></span><b class="' + (m.signo === '+' ? 'text-verde' : 'text-rojo') + '">' + (m.tipo === 'ANULACION' ? '' : e(m.signo)) + _dineroDireccion(m.monto) + '</b></div>').join('') : '<p class="smx-hint">Sin movimientos capturados hoy.</p>';
    } catch (_) { /* sin señal: queda la nota */ } finally { pidiendoMovs = false; }
  }
  document.addEventListener('click', ev => { const b = ev.target.closest('[data-ir]'); if (b) irA(b.dataset.ir); });
  // Solo si de verdad te quedas en Resumen: quien pasa de largo a Caja o Inventario no dispara consultas de más a
  // Google ni le quita tiempo a la sección a la que va.
  let relojRecientes = null;
  function programarRecientes() {
    const caja = q('#dv-recientes');
    if (!caja) { clearTimeout(relojRecientes); relojRecientes = null; return; }
    if (caja.dataset.listo || relojRecientes) return;
    relojRecientes = setTimeout(() => { relojRecientes = null; cargarRecientes(); }, 2500);
  }

  // ── CAJA: cifras del día, método y fecha a la vista, filtro Entradas / Salidas ──
  let movimientos = null, filtroCaja = '';
  const movsOriginal = window.renderMovimientosCaja;
  window.renderMovimientosCaja = function (movs) { movimientos = movs; return movsOriginal.apply(this, arguments); };
  function acomodarCaja() {
    const f = q('#form-caja');
    if (!f || f.dataset.dv) return;
    f.dataset.dv = '1';
    movimientos = null; filtroCaja = '';
    f.before(nodo('<div class="dv-kpis tres" id="dv-caja-kpis">' + [['Entradas', 'dv-entra', ' sube'], ['Salidas', 'dv-sale', ' baja'], ['Neto', 'dv-neto', '']].map(k => '<article class="dv-kpi"><span class="lbl">' + k[0] + '</span><strong class="val' + k[2] + '" id="' + k[1] + '">—</strong></article>').join('') + '</div>'));
    // La tarjeta lleva su título, y la nota de arriba («no son ventas ni gastos») pasa adentro, como en el diseño.
    const cuerpo = f.querySelector('.card-body'), nota = f.previousElementSibling && f.previousElementSibling.previousElementSibling;
    if (cuerpo) {
      cuerpo.prepend(nodo('<h2 class="smx-h2" style="margin:0">Registrar movimiento</h2>'));
      if (nota && nota.matches('p.text-muted')) { nota.className = 'smx-hint'; cuerpo.appendChild(nota); }
    }
    const metodo = f.querySelector('label[for="caja-metodo"]'), fecha = f.querySelector('label[for="caja-fecha"]'), boton = f.querySelector('#btn-mas-campos-caja');
    if (metodo && fecha && boton) { const par = nodo('<div class="smx-par"></div>'); par.append(metodo, fecha); boton.before(par); }
    const lista = q('#lista-caja');
    if (lista) {
      lista.before(nodo('<div class="smx-chips" id="dv-filtro-caja" role="group" aria-label="Filtrar movimientos">' + [['', 'Todos'], ['pos', 'Entradas'], ['neg', 'Salidas']].map(c => '<button type="button" data-filtro-caja="' + c[0] + '" aria-pressed="' + (!c[0]) + '">' + c[1] + '</button>').join('') + '</div>'));
      lista.after(nodo('<p class="smx-hint" style="text-align:center">Desliza un movimiento a la izquierda para corregirlo.</p>'));
    }
  }
  function pintarCaja() {
    if (!q('#dv-caja-kpis')) return;
    if (movimientos) {
      const c = cuentas(movimientos);
      SMX.texto(q('#dv-entra'), SMX.dinero(c.entra)); SMX.texto(q('#dv-sale'), SMX.dinero(c.sale)); SMX.texto(q('#dv-neto'), SMX.dinero(c.entra - c.sale));
    }
    todas('#lista-caja li[data-id]').forEach(li => { const fuera = !!filtroCaja && !li.querySelector('.mov-monto.' + filtroCaja); if (li.hidden !== fuera) li.hidden = fuera; });
  }
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-filtro-caja]');
    if (!b) return;
    filtroCaja = b.dataset.filtroCaja;
    todas('[data-filtro-caja]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    pintarCaja();
  });

  // ── CORTE: tres tarjetas (datos, conteo, previa en vivo) ──
  function acomodarCorte() {
    const f = q('#form-corte');
    if (!f || f.dataset.dv) return;
    f.dataset.dv = '1';
    const cuerpo = f.querySelector('.card-body'), datos = f.querySelector('.corte-datos'), billetes = f.querySelector('#denominaciones-corte'), contado = f.querySelector('.corte-contado'), botones = f.querySelector('.fila'), arqueo = q('#arqueo-vivo');
    if (!cuerpo || !datos || !billetes || !contado || !botones || !arqueo) return;
    f.classList.remove('card');
    const uno = nodo('<div class="card"><h2 class="smx-h2">Corte de caja</h2></div>');
    const dos = nodo('<div class="card"><div style="display:flex;align-items:center;gap:10px"><h2 class="smx-h2" style="flex:1">Efectivo contado</h2><button type="button" class="smx-mini" id="dv-limpiar">Limpiar conteo</button></div><p class="smx-hint" style="margin:0 0 8px">Escribe la cantidad de cada denominación o ajusta con − / +.</p></div>');
    const tres = nodo('<div class="card"><h2 class="smx-h2">Previa del corte · en vivo</h2></div>');
    uno.append(datos);
    dos.append(billetes, contado);
    tres.append(arqueo, nodo('<div class="dv-botones"><button type="button" class="btn btn-outline-secondary" id="dv-copiar">Copiar</button><button type="button" class="btn btn-primary" id="dv-whats">WhatsApp</button></div>'), botones);
    botones.classList.add('dv-botones');
    cuerpo.append(uno, dos, tres);
  }
  function textoCorte() {
    const f = q('#form-corte'), t = id => ((q('#' + id) || {}).textContent || '').trim();
    return 'CORTE SUMETEC · ' + f.fecha.value + '\nFondo inicial: ' + SMX.dinero(f.fondo.value) + '\nContado: ' + t('arqueo-contado') + '\nEsperado: ' + t('arqueo-esperado') + '\n' + t('arqueo-dif-etiqueta') + ': ' + t('arqueo-dif');
  }
  document.addEventListener('click', async ev => {
    if (ev.target.closest('#dv-copiar')) {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textoCorte()).then(() => toast('Resumen del corte copiado'), () => toast('No se pudo copiar.'));
      else toast('Copiar no está disponible en este navegador.');
    } else if (ev.target.closest('#dv-whats')) {
      window.open('https://wa.me/?text=' + encodeURIComponent(textoCorte()), '_blank', 'noopener');
    } else if (ev.target.closest('#dv-limpiar')) {
      if (!await sumetecConfirmar('Se ponen en cero todas las denominaciones.\n\n¿Limpiar el conteo?')) return;
      todas('#denominaciones-corte .cant-denominacion').forEach(i => { i.value = 0; i.dispatchEvent(new Event('input', { bubbles: true })); });
    }
  });

  // ── INVENTARIO: cada producto con ERP · Conteo · Diferencia ──
  function acomodarConteo() {
    todas('#listaItemsConteo .inv-cantidad').forEach(input => {
      if (input.parentElement.parentElement.classList.contains('dv-conteo')) return;
      const grid = nodo('<div class="dv-conteo"><div><span class="dv-lbl">ERP</span><span class="dv-erp">—</span></div><div><span class="dv-lbl">Conteo</span></div><div><span class="dv-lbl">Diferencia</span><span class="dv-dif">—</span></div></div>');
      input.before(grid);
      grid.children[1].appendChild(input);
    });
    todas('#listaItemsConteo .dv-conteo').forEach(g => {
      const input = g.querySelector('.inv-cantidad'), item = typeof CONTEO_ACTUAL !== 'undefined' && CONTEO_ACTUAL && CONTEO_ACTUAL.items[Number(input.dataset.idx)];
      const teo = item && typeof STOCK_TEORICO !== 'undefined' ? STOCK_TEORICO.get(String(item.codigo || '').toLowerCase()) : null;
      SMX.texto(g.querySelector('.dv-erp'), teo ? teo.stock : '—');
      const dif = g.querySelector('.dv-dif'), d = teo && input.value !== '' ? Math.round((Number(input.value) - teo.stock) * 10000) / 10000 : null;
      SMX.texto(dif, d === null ? '—' : (d > 0 ? '+' : '') + d);
      const clase = 'dv-dif' + (d === null ? '' : d === 0 ? ' cero' : d < 0 ? ' neg' : ' pos');
      if (dif.className !== clase) dif.className = clase;
    });
  }
  document.addEventListener('input', ev => { if (ev.target.classList.contains('inv-cantidad')) acomodarConteo(); });

  // ── PERMISOS: quién lo pide, con sus iniciales ──
  function acomodarPermisos() {
    todas('#permisos-lista .card .card-body').forEach(c => {
      if (c.querySelector('.dv-quien')) return;
      const quien = [...c.children].find(x => x.tagName === 'SMALL');
      if (!quien) return;
      const nombre = quien.textContent.split(' · ')[0].trim();
      const iniciales = nombre.split(/\s+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase();
      c.prepend(nodo('<div class="dv-quien"><span class="dv-avatar" aria-hidden="true">' + e(iniciales || '?') + '</span><span style="font-size:12.5px;font-weight:700">Solicita: ' + e(nombre) + '</span></div>'));
    });
  }

  // Las pantallas se vuelven a pintar solas (respuestas del servidor, filtros): se reacomodan cuando cambian.
  let pendiente = false;
  const acomodar = () => { pendiente = false; acomodarCaja(); pintarCaja(); acomodarCorte(); acomodarConteo(); acomodarPermisos(); programarRecientes(); };
  new MutationObserver(() => { if (!pendiente) { pendiente = true; queueMicrotask(acomodar); } }).observe(q('#app'), { childList: true, subtree: true });

  // ── Menú «Más» ──
  SMX.menu(q('#masMenu'), { boton: '#btnMasMenu', desc: 'Dirección · SUMETEC' });
  const alTocar = (id, fn) => { const b = q(id); if (b) b.addEventListener('click', () => setTimeout(fn, 30)); };
  const fila = (a, b) => '<div class="smx-renglon"><span>' + a + '</span><b>' + e(b) + '</b></div>';
  alTocar('#mEstado', () => {
    const n = k => leer(COLAS[k]).length;
    const total = n('movimientos') + n('anulaciones') + n('cortes') + (typeof _pendientesInventario_ === 'function' ? _pendientesInventario_() : 0);
    SMX.hoja('Estado de sincronización', fila('Conexión', navigator.onLine ? 'En línea' : 'Sin conexión') + fila('Movimientos por enviar', n('movimientos')) + fila('Correcciones por enviar', n('anulaciones')) + fila('Cortes por enviar', n('cortes')) + fila('Conteos por enviar', typeof _pendientesInventario_ === 'function' ? _pendientesInventario_() : 0),
      total ? [{ texto: 'Cerrar' }, { texto: 'Enviar ahora', clase: 'btn-success', alTocar: () => enviarPendientesDireccion() }] : undefined);
  });
  alTocar('#mCopiar', () => {
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem('sumetec_direccion_snapshot_cache') || 'null'); } catch (_) {}
    const s = snap && snap.snapshot;
    if (!s) { toast('Abre Resumen para consultar las cifras primero.'); return; }
    const texto = 'RESUMEN SUMETEC · oficial al ' + String(s.generadoEn || '').replace('T', ' ') + '\nVentas: ' + _dineroDireccion(s.ventas) + '\nCobrado: ' + _dineroDireccion(s.cobrado) + '\nGastos: ' + _dineroDireccion(s.gastos) + '\nUtilidad neta: ' + _dineroDireccion(s.utilidadNeta) + '\nCartera por cobrar: ' + _dineroDireccion(s.cartera) + (permisos ? '\nPermisos esperando: ' + permisos : '');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(() => toast('Resumen copiado'), () => toast('No se pudo copiar.'));
    else toast('Copiar no está disponible en este navegador.');
  });
  alTocar('#mGestos', () => SMX.gestos('Gestos de la app', [
    ['↔', 'Desliza a los lados en un espacio vacío', 'Cambia de sección (si no hay algo a medio capturar).'],
    ['←', 'Desliza un movimiento de Caja a la izquierda', 'Abre su corrección.'],
    ['↓', 'Tira hacia abajo arriba de todo', 'Actualiza la sección y envía lo pendiente.'],
    ['×', 'Desliza una hoja hacia abajo', 'La cierra.'],
    ['⇡', 'Doble toque en el encabezado', 'Vuelve arriba.']]));
  alTocar('#mAyuda', () => SMX.gestos('¿Cómo usar Dirección?', [
    ['1', 'Resumen y Panel', 'Cifras oficiales que publica el ERP.'],
    ['2', 'Caja', 'Movimientos físicos del cajón; no son ventas ni gastos.'],
    ['3', 'Corte', 'Cuenta por denominación y compara contra lo esperado.'],
    ['4', 'Inventario', 'Cuenta contra la lista del ERP y envía el conteo.'],
    ['5', 'Permisos', 'Aprueba o rechaza lo que piden los teléfonos.']]));
  alTocar('#mBloquear', async () => {
    if (hayTrabajoSinGuardarDireccion() && !await sumetecConfirmar('Tienes algo a medio capturar y se perderá.\n\n¿Bloquear de todos modos?')) return;
    location.reload();
  });

  // ── Gestos ──
  const ORDEN = ['resumen', 'panel', 'caja', 'corte', 'inventario', 'permisos'];
  SMX.lados(dir => {
    const k = ORDEN.indexOf(vistaActivaDireccion());
    if (k < 0 || (typeof hayTrabajoSinGuardarDireccion === 'function' && hayTrabajoSinGuardarDireccion())) return;
    if (ORDEN[k + dir]) irA(ORDEN[k + dir]);
  }, '#form-corte,#form-caja,#app input');
  SMX.deslizar('#lista-caja li[data-id]', li => { const b = li.querySelector('button.anular'); if (b) b.click(); });
  SMX.jalar(() => {
    const v = vistaActivaDireccion();
    if (v === 'resumen') return activarDashboardDireccion();
    if (v === 'panel') return activarPanelDireccion();
    if (v === 'caja' && window._refrescarCajaDireccion_) return window._refrescarCajaDireccion_();
    if (v === 'corte' && window._refrescarCorteDireccion_) return window._refrescarCorteDireccion_();
    if (v === 'permisos') return _cargarPermisosDireccion_();
    if (v === 'inventario') return _actualizarStockTeoricoAhora_();
  });
  SMX.avisos(0);
})();
