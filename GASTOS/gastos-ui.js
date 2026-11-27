// gastos-ui.js · Vistas Capturar / Historial / Resumen, hojas y gestos del diseño «mejorado» (2026-11-26).
// Lee lo que gastos.html ya guarda (gastos_recientes y cola_gastos) y usa sus mismas funciones para repetir,
// descartar y exportar; aquí no se calcula lo que se envía ni se toca la cola.
(function () {
  'use strict';
  const q = s => document.querySelector(s);
  const todas = s => [...document.querySelectorAll(s)];
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  const suma = l => l.reduce((a, g) => a + (+g.total || 0), 0);
  const fechaBonita = iso => { const d = new Date(String(iso) + 'T12:00:00'); return isNaN(d) ? String(iso || '') : DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()]; };
  const haceDias = n => { const d = new Date(); d.setDate(d.getDate() - n); const p = x => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

  let vista = 'capturar', rango = '7';
  const filtros = { texto: '', periodo: 'todo', desde: '', hasta: '', tipo: '', forma: '', estado: '' };

  function gastos() {
    const cola = leerSeguro('cola_gastos', []) || [];
    const ids = new Set(cola.map(x => x && x.id));
    return (leerSeguro('gastos_recientes', []) || []).map((g, i) => Object.assign({}, g, { _i: i, _pendiente: !!(g.id && ids.has(g.id)) }));
  }

  // ── Cifras de arriba, avisos e insignia ──
  function pintarCifras() {
    const cola = (leerSeguro('cola_gastos', []) || []).concat(leerSeguro('cola_conteo', []) || []);
    const porEnviar = leerSeguro('cola_gastos', []) || [];
    const mes = _fechaLocal_().slice(0, 7), delMes = gastos().filter(g => String(g.fecha).slice(0, 7) === mes);
    SMX.texto(q('#gvMes'), SMX.dinero(suma(delMes)));
    SMX.texto(q('#gvMesN'), plural(delMes.length, 'gasto', 'gastos'));
    SMX.texto(q('#gvPend'), SMX.dinero(suma(porEnviar)));
    SMX.texto(q('#gvPendN'), plural(porEnviar.length, 'pendiente', 'pendientes'));
    SMX.avisos(cola.length);
    const i = q('#gvInsignia');
    if (i) { SMX.texto(i, cola.length); i.hidden = !cola.length; }
  }

  // ── Desglose y barra de avance ──
  function pintarCaptura() {
    if (!q('#gvTotal')) return;
    const v = id => ((q('#' + id) || {}).value || '').trim();
    const modo = (q('input[name="gasModo"]:checked') || {}).value || 'A';
    const r = _calcularMontosGasto_(modo, v('gas_montoA'), modo === 'A' ? v('gas_ivaA') : v('gas_ivaB'), modo === 'C' ? v('gas_totalC') : v('gas_totalBC'), v('gas_ivaC'));
    const vacio = modo === 'A' ? !v('gas_montoA') : modo === 'B' ? !v('gas_totalBC') : (!v('gas_totalC') && !v('gas_ivaC'));
    const bien = !vacio && !(r.errores && r.errores.length);
    SMX.texto(q('#gvBase'), bien ? SMX.dinero(r.monto) : vacio ? '$0.00' : '—');
    SMX.texto(q('#gvIva'), bien ? SMX.dinero(r.ivaMonto) : vacio ? '$0.00' : '—');
    SMX.texto(q('#gvTotal'), bien ? SMX.dinero(r.total) : vacio ? '$0.00' : '—');
    const datos = !!(v('gas_fecha') && v('gas_forma') && v('gas_concepto') && v('gas_tipo'));
    const importe = bien && r.total > 0;
    [datos, importe, datos && importe].forEach((ok, k) => {
      const paso = q('.gv-paso[data-paso="' + (k + 1) + '"]');
      if (!paso) return;
      paso.classList.toggle('hecho', ok);
      SMX.texto(paso.querySelector('i'), ok ? '✓' : k + 1);
      const linea = q('.gv-linea[data-linea="' + (k + 1) + '"]');
      if (linea) linea.classList.toggle('hecho', ok);
    });
  }

  // ── Cambio de vista ──
  function mostrar() {
    ['capturar', 'historial', 'resumen'].forEach(n => { const el = q('#gv-' + n); if (el) el.hidden = n !== vista; });
    todas('.smx-nav [data-vista-gasto]').forEach(b => {
      const activo = b.dataset.vistaGasto === vista;
      b.classList.toggle('activo', activo);
      if (activo) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (vista === 'historial') pintarHistorial();
    if (vista === 'resumen') pintarResumen();
  }
  function ir(nombre) {
    vista = nombre;
    if (!q('#gv-capturar')) renderGastos(); else mostrar();   // desde la cola pendiente se regresa a la pantalla de siempre
    window.scrollTo(0, 0);
  }
  todas('.smx-nav [data-vista-gasto]').forEach(b => b.addEventListener('click', () => { if (_gastosAccesoAutorizado) ir(b.dataset.vistaGasto); }));

  // ── Historial ──
  const ICONOS = [[/gasolin|combust|di[eé]sel/i, 'bi-speedometer2'], [/papel|oficina/i, 'bi-file-earmark-text'], [/manten|herram|refacc/i, 'bi-box-seam'], [/renta|local/i, 'bi-shop'], [/n[oó]mina|sueldo/i, 'bi-cash-stack']];
  const icono = tipo => (ICONOS.find(x => x[0].test(tipo || '')) || [0, 'bi-receipt'])[1];

  function armarHistorial(caja) {
    const op = (lista, vacio) => '<option value="">' + vacio + '</option>' + lista.map(x => '<option>' + esc(x) + '</option>').join('');
    const chip = (v, t) => '<button type="button" data-periodo="' + v + '" aria-pressed="' + (filtros.periodo === v) + '">' + t + '</button>';
    caja.innerHTML = '<div class="card"><h2 class="smx-h2"><i class="bi bi-clock-history" aria-hidden="true"></i> Historial<span class="smx-der" id="gvCuenta"></span></h2>' +
      '<input type="search" id="gvBuscar" placeholder="Buscar por concepto o proveedor…" aria-label="Buscar en el historial" autocomplete="off">' +
      '<div class="smx-chips" role="group" aria-label="Periodo" style="margin:8px 0">' + chip('todo', 'Todo') + chip('hoy', 'Hoy') + chip('7d', 'Semana') + chip('mes', 'Mes') + chip('rango', 'Rango') + '</div>' +
      '<div class="smx-par" id="gvRango" hidden style="margin-bottom:8px"><label class="form-label">Desde<input type="date" id="gvDesde"></label><label class="form-label">Hasta<input type="date" id="gvHasta"></label></div>' +
      '<div class="gv-filtros"><select id="gvEstado" aria-label="Filtrar por estado"><option value="">Estado: todos</option><option value="pendiente">Pendientes</option><option value="enviado">Enviados</option></select>' +
      '<select id="gvTipo" aria-label="Filtrar por tipo">' + op(TIPOS_GASTO, 'Tipo: todos') + '</select><select id="gvForma" aria-label="Filtrar por forma de pago">' + op(FORMAS_PAGO, 'Forma: todas') + '</select></div>' +
      '<div class="smx-renglon"><span class="smx-hint">Toca un gasto para ver el detalle · deslízalo a la izquierda</span><b id="gvSuma"></b></div></div><div id="gvLista"></div>';
    q('#gvBuscar').value = filtros.texto; q('#gvEstado').value = filtros.estado; q('#gvTipo').value = filtros.tipo; q('#gvForma').value = filtros.forma;
    q('#gvDesde').value = filtros.desde; q('#gvHasta').value = filtros.hasta; q('#gvRango').hidden = filtros.periodo !== 'rango';
    const cambio = () => {
      Object.assign(filtros, { texto: q('#gvBuscar').value, estado: q('#gvEstado').value, tipo: q('#gvTipo').value, forma: q('#gvForma').value, desde: q('#gvDesde').value, hasta: q('#gvHasta').value });
      pintarLista();
    };
    caja.querySelectorAll('input, select').forEach(el => { el.addEventListener('input', cambio); el.addEventListener('change', cambio); });
    caja.querySelectorAll('[data-periodo]').forEach(b => b.addEventListener('click', () => {
      filtros.periodo = b.dataset.periodo;
      caja.querySelectorAll('[data-periodo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      q('#gvRango').hidden = filtros.periodo !== 'rango';
      pintarLista();
    }));
  }
  function pintarHistorial() {
    const caja = q('#gv-historial');
    if (!caja) return;
    if (!q('#gvLista')) armarHistorial(caja);
    pintarLista();
  }
  function pintarLista() {
    const lista = q('#gvLista');
    if (!lista) return;
    const r = _filtrarGastos_(gastos(), filtros);
    SMX.texto(q('#gvCuenta'), plural(r.length, 'gasto', 'gastos'));
    SMX.texto(q('#gvSuma'), SMX.dinero(suma(r)));
    lista.innerHTML = r.length ? r.map(g => '<div class="gv-fila-wrap" data-i="' + g._i + '"><div class="gv-fila-acciones">' +
      '<button type="button" data-repetir>Repetir</button>' + (g._pendiente ? '<button type="button" class="borrar" data-descartar>Descartar</button>' : '') + '</div>' +
      '<div class="gv-fila" role="button" tabindex="0" aria-label="Ver detalle: ' + esc(g.concepto) + '"><span class="gv-ic" aria-hidden="true"><i class="bi ' + icono(g.tipoGasto) + '"></i></span>' +
      '<span class="gv-medio"><b>' + esc(g.concepto) + '</b><small>' + esc([fechaBonita(g.fecha), g.tipoGasto, g.proveedor, g.formaPago].filter(Boolean).join(' · ')) + '</small></span>' +
      '<span class="gv-lado"><b>' + SMX.dinero(g.total) + '</b><span class="smx-sello' + (g._pendiente ? ' pend' : '') + '">' + (g._pendiente ? 'Pendiente' : g.id ? 'Enviado' : 'Guardado') + '</span></span></div></div>').join('')
      : '<div class="smx-vacio"><b>Sin gastos aquí</b><p>No hay gastos con estos filtros.</p><button type="button" class="btn btn-primary" data-capturar>Capturar un gasto</button></div>';
  }
  function repetir(i) { ir('capturar'); _duplicarGastoReciente_(i); }
  function detalle(i) {
    const g = gastos()[i];
    if (!g) return;
    const fila = (a, b, c) => b ? '<div class="smx-renglon' + (c || '') + '"><span>' + a + '</span><b>' + esc(b) + '</b></div>' : '';
    const botones = [{ texto: 'Cerrar' }, { texto: 'Repetir', clase: 'btn-success', alTocar: () => repetir(i) }];
    if (g._pendiente) botones.splice(1, 0, { texto: 'Descartar', clase: 'btn-danger', alTocar: () => _descartarUno_(g.id, 'gasto') });
    SMX.hoja('Detalle del gasto', '<p class="smx-desc">' + (g._pendiente ? 'Pendiente de enviar al ERP' : 'Ya salió de este teléfono') + '</p>' +
      fila('Concepto', g.concepto) + fila('Fecha', fechaBonita(g.fecha)) + fila('Tipo', g.tipoGasto) + fila('Forma de pago', g.formaPago) + fila('Proveedor', g.proveedor) + fila('Total', SMX.dinero(g.total), ' grande'), botones);
  }

  // Deslizar un gasto a la izquierda descubre «Repetir» y «Descartar» (solo los pendientes se pueden descartar).
  let sx = null, sy = 0, deslizado = false;
  document.addEventListener('touchstart', e => { const f = e.target.closest('.gv-fila'); sx = f ? e.touches[0].clientX : null; sy = f ? e.touches[0].clientY : 0; deslizado = false; }, { passive: true });
  document.addEventListener('touchend', e => {
    const f = e.target.closest('.gv-fila');
    if (sx === null || !f) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) < 45 || Math.abs(dy) > Math.abs(dx)) return;
    deslizado = true;
    abrirFila(f.parentElement, dx < 0);
    setTimeout(() => { deslizado = false; }, 350);
  }, { passive: true });
  function abrirFila(w, abrir) {
    todas('.gv-fila-wrap.abierta').forEach(x => { if (x !== w) abrirFila(x, false); });
    const n = w.querySelectorAll('.gv-fila-acciones button').length, f = w.querySelector('.gv-fila');
    f.style.transition = 'transform .25s cubic-bezier(.3,.9,.3,1)';
    if (abrir) w.classList.add('abierta');
    f.style.transform = abrir ? 'translate3d(' + (-76 * n) + 'px,0,0)' : '';
    if (!abrir) setTimeout(() => { if (!f.style.transform) w.classList.remove('abierta'); }, 260);
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-capturar]')) { ir('capturar'); return; }
    const w = e.target.closest('.gv-fila-wrap');
    if (!w) return;
    const i = Number(w.dataset.i);
    if (e.target.closest('[data-repetir]')) { repetir(i); return; }
    if (e.target.closest('[data-descartar]')) { const g = gastos()[i]; if (g) _descartarUno_(g.id, 'gasto'); return; }
    if (deslizado) return;
    if (w.classList.contains('abierta')) { abrirFila(w, false); return; }
    detalle(i);
  });
  document.addEventListener('keydown', e => { const f = e.target.closest && e.target.closest('.gv-fila'); if (f && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); detalle(Number(f.parentElement.dataset.i)); } });

  // ── Resumen ──
  function pintarResumen() {
    const caja = q('#gv-resumen');
    if (!caja) return;
    const lista = gastos(), hoy = _fechaLocal_(), mes = hoy.slice(0, 7);
    const delMes = lista.filter(g => String(g.fecha).slice(0, 7) === mes), porEnviar = leerSeguro('cola_gastos', []) || [];
    const provs = {};
    lista.forEach(g => { if (g.proveedor) provs[g.proveedor] = (provs[g.proveedor] || 0) + 1; });
    const top = Object.entries(provs).sort((a, b) => b[1] - a[1])[0];
    const etiqueta = rango === '7' ? 'últimos 7 días' : rango === '15' ? 'últimos 15 días' : 'este mes';
    const dias = [];
    const n = rango === 'mes' ? Number(hoy.slice(8)) : Number(rango);
    for (let i = n - 1; i >= 0; i--) { const iso = haceDias(i); dias.push({ iso, total: suma(lista.filter(g => g.fecha === iso)) }); }
    const delRango = lista.filter(g => g.fecha >= dias[0].iso && g.fecha <= hoy);
    const max = Math.max(1, ...dias.map(d => d.total)), W = 340, H = 128, base = 104;
    const ancho = rango === '7' ? 30 : rango === '15' ? 15 : Math.max(5, Math.floor((W - (dias.length + 1) * 3) / dias.length));
    const hueco = (W - dias.length * ancho) / (dias.length + 1);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfica de gastos, ' + etiqueta + '"><line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="var(--line)" stroke-width="1.5"/>';
    dias.forEach((d, i) => {
      const h = Math.max(3, Math.round(d.total / max * 74)), x = hueco + i * (ancho + hueco), y = base - h, esHoy = d.iso === hoy, f = new Date(d.iso + 'T12:00:00');
      svg += '<rect x="' + x + '" y="' + y + '" width="' + ancho + '" height="' + h + '" rx="' + (rango === '7' ? 5 : 2) + '" fill="' + (esHoy ? 'var(--green)' : 'var(--titulo)') + '" opacity="' + (esHoy ? 1 : .78) + '"/>';
      if (d.total && (rango !== 'mes' || esHoy || d.total === max)) svg += '<text x="' + (x + ancho / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="' + (rango === '7' ? 9.5 : 7.5) + '" font-weight="700" fill="var(--ink2)">$' + Math.round(d.total).toLocaleString('es-MX') + '</text>';
      if (rango !== 'mes' || esHoy || f.getDate() === 1 || f.getDate() % 5 === 0) svg += '<text x="' + (x + ancho / 2) + '" y="' + (base + 15) + '" text-anchor="middle" font-size="' + (rango === 'mes' ? 8.5 : 10) + '" font-weight="' + (esHoy ? 800 : 600) + '" fill="' + (esHoy ? 'var(--green)' : 'var(--ink3)') + '">' + (esHoy ? 'hoy' : rango === '7' ? DIAS[f.getDay()] : f.getDate()) + '</text>';
    });
    svg += '</svg>';
    const porTipo = {};
    delRango.forEach(g => { porTipo[g.tipoGasto || 'Sin tipo'] = (porTipo[g.tipoGasto || 'Sin tipo'] || 0) + (+g.total || 0); });
    const tipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);
    const stat = (t, v, s, chico) => '<div class="smx-stat"><small>' + t + '</small><b' + (chico ? ' style="font-size:15px"' : '') + '>' + esc(v) + '</b><span>' + esc(s) + '</span></div>';
    const seg = (v, t) => '<button type="button" data-rango="' + v + '" aria-pressed="' + (rango === v) + '" style="flex:1">' + t + '</button>';
    caja.innerHTML = '<div class="gv-rejilla">' +
      stat('Total del mes', SMX.dinero(suma(delMes)), plural(delMes.length, 'gasto', 'gastos') + ' en ' + MESES[Number(mes.slice(5)) - 1]) +
      stat('Promedio por gasto', SMX.dinero(delMes.length ? suma(delMes) / delMes.length : 0), 'En lo que va del mes') +
      stat('Por enviar al ERP', SMX.dinero(suma(porEnviar)), plural(porEnviar.length, 'pendiente', 'pendientes')) +
      stat('Proveedor más frecuente', top ? top[0] : '—', top ? plural(top[1], 'gasto registrado', 'gastos registrados') : '', true) + '</div>' +
      '<div class="card"><h2 class="smx-h2"><i class="bi bi-graph-down" aria-hidden="true"></i> Gastos · ' + etiqueta + '</h2><div class="smx-chips" role="group" aria-label="Periodo de la gráfica" style="flex-wrap:nowrap;margin-bottom:10px">' + seg('7', '7 días') + seg('15', '15 días') + seg('mes', 'Mes') + '</div>' +
      '<div class="gv-grafica">' + svg + '</div><p class="smx-hint" style="text-align:center">' + SMX.dinero(suma(delRango)) + ' en ' + plural(delRango.length, 'gasto', 'gastos') + ' de este teléfono</p></div>' +
      '<div class="card"><h2 class="smx-h2"><i class="bi bi-receipt" aria-hidden="true"></i> Por tipo de gasto · ' + etiqueta + '</h2>' +
      (tipos.length ? tipos.map(([t, v]) => '<div class="smx-barra-fila"><span>' + esc(t) + '</span><span><i style="width:' + Math.max(4, v / (tipos[0][1] || 1) * 100) + '%"></i></span><b>' + SMX.dinero(v) + '</b></div>').join('') : '<p class="smx-hint">Todavía no hay gastos en este periodo.</p>') + '</div>' +
      '<div class="card"><h2 class="smx-h2"><i class="bi bi-download" aria-hidden="true"></i> Sacar los datos</h2><div class="smx-par"><button type="button" class="btn btn-primary" data-csv>Exportar CSV</button><button type="button" class="btn secondary" data-copiar>Copiar resumen</button></div><p class="smx-hint">Son los gastos guardados en este teléfono (hasta 200).</p></div>';
    caja.querySelectorAll('[data-rango]').forEach(b => b.addEventListener('click', () => { rango = b.dataset.rango; pintarResumen(); }));
    caja.querySelector('[data-csv]').addEventListener('click', () => exportarGastosCSV());
    caja.querySelector('[data-copiar]').addEventListener('click', () => {
      const texto = 'SUMETEC · Gastos ' + MESES[Number(mes.slice(5)) - 1] + ' ' + mes.slice(0, 4) + '\nTotal del mes: ' + SMX.dinero(suma(delMes)) + ' (' + plural(delMes.length, 'gasto', 'gastos') + ')\nPendientes de enviar: ' + porEnviar.length + ' (' + SMX.dinero(suma(porEnviar)) + ')\nHoy: ' + SMX.dinero(suma(lista.filter(g => g.fecha === hoy)));
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(() => toast('Resumen copiado ✓'), () => toast('No se pudo copiar.'));
      else toast('Copiar no está disponible en este navegador.');
    });
  }

  // ── Estado de envío y menú «Más» ──
  function enviar() {
    if (!(leerSeguro('cola_gastos', []).length + leerSeguro('cola_conteo', []).length)) { toast('No hay nada pendiente de enviar.'); return; }
    if (!navigator.onLine) { toast('Sin conexión: se envía solo al volver la señal.', 4000); return; }
    toast('Enviando pendientes…');
    procesarColaConteo(); procesarColaGastos();
  }
  function hojaEstado() {
    const cola = (leerSeguro('cola_gastos', []) || []).concat(leerSeguro('cola_conteo', []) || []);
    const detenidos = cola.filter(e => e._detenido).length;
    const fila = (a, b) => '<div class="smx-renglon"><span>' + a + '</span><b>' + esc(b) + '</b></div>';
    SMX.hoja('Estado', '<p class="smx-desc">Cómo va este teléfono con el ERP.</p>' + fila('Conexión', navigator.onLine ? 'En línea' : 'Sin conexión') +
      fila('Teléfono', _leerVendedorCompartido() || '—') + fila('En cola por enviar', plural(cola.length, 'pendiente', 'pendientes')) + fila('Detenidos por el servidor', String(detenidos)),
      cola.length ? [{ texto: 'Ver la cola', alTocar: () => verColaPendiente() }, { texto: 'Enviar ahora', clase: 'btn-success', alTocar: enviar }] : undefined);
  }
  q('#smxAvisos').addEventListener('click', hojaEstado);
  SMX.menu(q('#menuGastos'), { boton: '#btnMenuGastos', desc: 'Todo lo demás de Gastos, en un solo lugar.' });
  const alTocar = (id, fn) => { const b = q(id); if (b) b.addEventListener('click', () => setTimeout(() => { if (_gastosAccesoAutorizado) fn(); }, 30)); };
  alTocar('#mEnviar', enviar);
  alTocar('#mEstado', hojaEstado);
  alTocar('#mResumen', () => ir('resumen'));
  alTocar('#mBloquear', async () => {
    if (hayTrabajoSinGuardarGastos() && !await sumetecConfirmar('Tienes un gasto a medio capturar y se perderá.\n\n¿Bloquear de todos modos?')) return;
    location.reload();
  });
  alTocar('#mGestos', () => SMX.gestos('Gestos de la app', [
    ['←', 'Desliza un gasto a la izquierda', 'En el Historial aparecen Repetir y, si sigue pendiente, Descartar.'],
    ['↓', 'Tira hacia abajo desde arriba', 'Actualiza las listas y envía lo pendiente.'],
    ['↑', 'La barra del total se esconde sola', 'Al bajar o al escribir se guarda para no tapar campos; vuelve al subir.'],
    ['↔', 'Desliza en un espacio vacío', 'Cambia entre Capturar, Historial y Resumen.'],
    ['×', 'Desliza una hoja hacia abajo', 'La cierra.'],
    ['⇡', 'Doble toque en el encabezado', 'Vuelve arriba.']]));
  alTocar('#mAyuda', () => SMX.gestos('¿Cómo usar?', [
    ['1', 'Toma la foto del ticket', 'La IA llena fecha, total, IVA y proveedor. Revisa siempre antes de guardar.'],
    ['2', 'Completa los datos', 'Forma de pago, concepto y tipo son obligatorios. El proveedor es opcional.'],
    ['3', 'Elige cómo capturas el importe', 'Base + IVA, Total con IVA, o Total + IVA exacto si el ticket trae el IVA separado.'],
    ['4', 'Guarda y envía', 'Queda pendiente en este teléfono y se envía al ERP en cuanto hay internet.']]));
  alTocar('#mErp', () => SMX.hoja('¿Qué es ERP?', '<p>El ERP es el sistema central de SUMETEC: ahí vive la contabilidad, el inventario y los reportes del negocio.</p><p>Esta app captura los gastos en el teléfono y los deja en cola. Al enviarse, el ERP los recibe, administración los revisa y quedan en la contabilidad. Por eso cada teléfono se vincula con código y PIN.</p>'));

  // ── Enganches con las funciones de siempre ──
  const renderOriginal = window.renderGastos;
  window.renderGastos = function () { const r = renderOriginal.apply(this, arguments); mostrar(); pintarCifras(); pintarCaptura(); return r; };
  const previewOriginal = window._actualizarPreviewGasto_;
  window._actualizarPreviewGasto_ = function () { const r = previewOriginal.apply(this, arguments); pintarCaptura(); return r; };
  const insigniaOriginal = window.actualizarBadgePendientes;
  window.actualizarBadgePendientes = function () { const r = insigniaOriginal.apply(this, arguments); pintarCifras(); if (vista === 'historial') pintarLista(); return r; };
  window._abrirHistorialGastos_ = () => ir('historial');
  document.addEventListener('click', e => { if (e.target.closest('.gasto-resumen')) q('.gv-desglose') && q('.gv-desglose').scrollIntoView({ behavior: 'smooth', block: 'center' }); });

  SMX.jalar(() => {
    if (!_gastosAccesoAutorizado) return;
    _cargarListasGasto_(); _cargarPendientesFactura_(); procesarColaConteo(); procesarColaGastos();
    if (vista === 'historial') pintarLista();
    if (vista === 'resumen') pintarResumen();
  });
  SMX.lados(dir => {
    if (!_gastosAccesoAutorizado || !q('#gv-capturar')) return;
    const orden = ['capturar', 'historial', 'resumen'], k = orden.indexOf(vista) + dir;
    if (k >= 0 && k < orden.length) ir(orden[k]);
  });
  SMX.barraQueSeEsconde('.gasto-barra-guardar');
  pintarCifras();
})();
