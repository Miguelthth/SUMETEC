// compras-ui.js · Navegación, hojas y gestos del diseño «mejorado» (2026-11-26). Usa los mismos botones y
// funciones de compras.js / app.js; aquí no se calcula ni se envía nada.
(function () {
  'use strict';
  const q = s => document.querySelector(s);
  const form = () => q('#form-compra');

  // ── Barra de abajo ↔ pestañas de siempre ──
  const tab = nombre => q('.compras-tab[data-panel=' + nombre + ']');
  function sincronizarNav() {
    const historial = !!q('.compras-tab.activa[data-panel=historial]');
    q('#navCap').classList.toggle('activo', !historial);
    q('#navHis').classList.toggle('activo', historial);
    const avance = q('.cv-avance');
    if (avance) avance.hidden = historial;
  }
  const ir = nombre => { const t = tab(nombre); if (t) { t.click(); window.scrollTo(0, 0); } };
  q('#navCap').addEventListener('click', () => ir('capturar'));
  q('#navHis').addEventListener('click', () => ir('historial'));
  document.addEventListener('click', e => { if (e.target.closest('.compras-tab')) sincronizarNav(); });

  // ── Avisos: lo que sigue en este teléfono sin llegar al ERP ──
  const pendientes = () => leer(COLAS.compras).length + (typeof _leerAbonosCompra_ === 'function' ? _leerAbonosCompra_().length : 0);
  const estadoOriginal = window.estado;
  window.estado = function () { const r = estadoOriginal.apply(this, arguments); SMX.avisos(pendientes()); return r; };

  function hojaEstado() {
    const cola = leer(COLAS.compras), detenidas = cola.filter(c => c && c.rechazo).length, abonos = _leerAbonosCompra_().length;
    const ultimo = leer(CLAVE_HISTORIAL_COMPRAS)[0];
    const fila = (a, b) => '<div class="smx-renglon"><span>' + a + '</span><b>' + SMX.esc(b) + '</b></div>';
    SMX.hoja('Estado de envío',
      fila('Conexión', navigator.onLine ? 'En línea' : 'Sin conexión') + fila('Compras en cola', cola.length - detenidas) +
      fila('Detenidas por el servidor', detenidas) + fila('Abonos pendientes', abonos) +
      fila('Último envío', ultimo && ultimo.fechaEnvio ? new Date(ultimo.fechaEnvio).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Todavía no hay'),
      pendientes() ? [{ texto: 'Cerrar' }, { texto: 'Enviar ahora', clase: 'btn-success', alTocar: () => q('#enviar-compras').click() }] : undefined);
  }
  q('#smxAvisos').addEventListener('click', hojaEstado);

  // ── Menú «Más» ──
  SMX.menu(q('#masMenu'), { boton: '#btnMasMenu', desc: 'Compras · SUMETEC' });
  const alTocar = (id, fn) => { const b = q(id); if (b) b.addEventListener('click', () => setTimeout(fn, 30)); };
  alTocar('#mEstado', hojaEstado);
  alTocar('#mFacturas', () => { if (!form()) return; ir('historial'); _cargarPendientesFactura_(); });
  alTocar('#mCalculadora', hojaCalculadora);
  alTocar('#mGestos', () => SMX.gestos('Gestos de la app', [
    ['←', 'Desliza una línea o un pago a la izquierda', 'Lo elimina (pide confirmación).'],
    ['⧉', 'Mantén presionada una línea', 'La duplica.'],
    ['⠿', 'Arrastra el asa de una línea', 'Cambia su orden.'],
    ['↓', 'Tira hacia abajo estando arriba', 'Actualiza el historial y envía lo pendiente.'],
    ['↔', 'Desliza en un espacio vacío', 'Cambia entre Capturar e Historial.'],
    ['↑', 'Toca la barra del total', 'Abre el desglose de la compra.'],
    ['⇡', 'Doble toque en el encabezado', 'Vuelve arriba.']]));
  alTocar('#mErp', () => SMX.hoja('¿Qué es ERP?', '<p>El ERP es el sistema central de SUMETEC. Cuando guardas una compra queda como <b>pendiente</b>: se envía, administración la revisa y la importa, y entonces cambia a <b>Integrada en el ERP</b>.</p><p>Por eso cada compra pide proveedor, evidencia y situación de factura.</p>'));
  alTocar('#mAyuda', () => SMX.gestos('¿Cómo usar Compras?', [
    ['1', 'Toma la foto del ticket', 'La IA llena proveedor, fecha, subtotal, IVA y total; tú los revisas.'],
    ['2', 'Escribe el proveedor', 'Se autocompleta con los del ERP.'],
    ['3', 'Agrega líneas (opcional)', 'Código, descripción, cantidad y costo.'],
    ['4', 'Elige IVA y condición, revisa el total', 'De contado, los pagos deben cubrir el total.'],
    ['5', 'Guarda', 'Queda pendiente y aparece en Historial.']]));
  alTocar('#mLimpiar', async () => {
    const f = form();
    if (!f || !await sumetecConfirmar('Se borrará lo que llevas capturado en esta compra.\n\n¿Limpiar el formulario?')) return;
    localStorage.removeItem(CLAVE_BORRADOR_COMPRA);
    _generacionOcrCompra++;
    _resetFotoCompra_();
    iniciar();
  });
  alTocar('#mBloquear', () => { if (form()) _guardarBorradorCompra_(form()); location.reload(); });

  // ── Calculadora (el resultado se puede mandar al costo de la última línea) ──
  function hojaCalculadora() {
    let valor = '0', previo = null, op = null, limpio = true;
    const teclas = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='];
    const d = SMX.hoja('Calculadora', '<div class="cv-calc-pantalla">0</div><div class="cv-calc">' +
      teclas.map(t => '<button type="button" class="' + ('÷×−+'.includes(t) ? 'op' : t === '=' ? 'igual' : t === '0' ? 'ancho' : '') + '">' + t + '</button>').join('') + '</div>',
      [{ texto: 'Cerrar' }, { texto: 'Usar en la última línea', clase: 'btn-success', alTocar: () => {
        const lineas = q('#lineas-compra');
        if (!lineas) return;
        if (!lineas.querySelector('li.linea')) q('#agregar-linea').click();
        const costo = [...lineas.querySelectorAll('li.linea .costo')].pop();
        costo.value = String(Number(valor) || 0);
        costo.dispatchEvent(new Event('input', { bubbles: true }));
      } }]);
    const igual = () => {
      if (previo === null || !op) return;
      const b = Number(valor) || 0;
      const r = op === '+' ? previo + b : op === '−' ? previo - b : op === '×' ? previo * b : (b ? previo / b : 0);
      valor = String(Math.round(r * 100) / 100); previo = null; op = null; limpio = true;
    };
    d.querySelector('.cv-calc').addEventListener('click', e => {
      const t = e.target.textContent;
      if (!e.target.matches('button')) return;
      if (t === 'C') { valor = '0'; previo = null; op = null; limpio = true; }
      else if (t === '⌫') valor = valor.length > 1 ? valor.slice(0, -1) : '0';
      else if (t === '%') valor = String(Math.round((Number(valor) || 0)) / 100);
      else if ('÷×−+'.includes(t)) { if (op && !limpio) igual(); previo = Number(valor) || 0; op = t; limpio = true; }
      else if (t === '=') igual();
      else if (limpio) { valor = t === '.' ? '0.' : t; limpio = false; }
      else if (!(t === '.' && valor.includes('.'))) valor += t;
      d.querySelector('.cv-calc-pantalla').textContent = valor;
    });
  }

  // ── Desglose al tocar la barra del total ──
  function hojaDesglose() {
    const f = form();
    if (!f) return;
    const d = _detalleDeCompra_(Object.assign(Object.fromEntries(new FormData(f)), { lineas: _leerLineasCompra(q('#lineas-compra')), pagos: _leerPagosCompra(q('#pagos-compra')) }));
    const it = { proveedor: d.proveedor, total: d.total, estado: '', detalle: d };
    const fila = (a, b, c) => '<div class="smx-renglon' + (c || '') + '"><span>' + a + '</span><b>' + b + '</b></div>';
    SMX.hoja('Desglose de la compra',
      '<p class="smx-desc">' + SMX.esc(d.proveedor ? 'Proveedor: ' + d.proveedor : 'Sin proveedor todavía') + '</p>' +
      d.lineas.map(l => fila(SMX.esc(l.cantidad + ' × ' + (l.descripcion || l.codigo)), SMX.dinero(l.cantidad * l.costoUnitario))).join('') +
      fila('Subtotal', SMX.dinero(d.subtotal)) + fila('IVA', SMX.dinero(d.iva)) + fila('Pagado', SMX.dinero(d.pagos.reduce((a, p) => a + p.monto, 0))) + fila('Total', SMX.dinero(d.total), ' grande'),
      [{ texto: 'WhatsApp', queda: true, alTocar: () => _whatsCompra_(_textoCompra_(it)) }, { texto: 'Copiar', queda: true, alTocar: () => _copiarTextoCompra_(_textoCompra_(it)) }, { texto: 'Cerrar', clase: 'btn-primary' }]);
  }
  document.addEventListener('click', e => { if (e.target.closest('.compras-barra-total')) hojaDesglose(); });

  // ── Proveedores recientes y productos usados: solo lo que este teléfono ha capturado ──
  function pintarSugerencias() {
    const caja = q('#cv-prov-chips'), cat = q('#cv-catalogo');
    if (!caja || !cat) return;
    const detalles = Object.values(_leerDetallesCompras_()).reverse();
    const enCola = leer(COLAS.compras).slice().reverse();
    const todas = enCola.map(_detalleDeCompra_).concat(detalles);
    const provs = [...new Set(todas.map(d => d.proveedor).filter(Boolean))].slice(0, 3);
    caja.innerHTML = provs.map(p => '<button type="button" data-proveedor="' + SMX.esc(p) + '" aria-pressed="false">' + SMX.esc(p) + '</button>').join('');
    const vistos = new Map();
    todas.forEach(d => d.lineas.forEach(l => { if (l.codigo && l.costoUnitario > 0 && !vistos.has(l.codigo)) vistos.set(l.codigo, l); }));
    cat.innerHTML = [...vistos.values()].slice(0, 6).map(l => '<button type="button" data-producto="' + SMX.esc(l.codigo) + '" title="' + SMX.esc(l.descripcion) + '">' + SMX.esc(l.codigo) + ' · ' + SMX.dinero(l.costoUnitario) + '</button>').join('');
    cat._productos = vistos;
  }
  document.addEventListener('click', e => {
    const p = e.target.closest('[data-proveedor]');
    if (p && form()) {
      form().proveedor.value = p.dataset.proveedor;
      form().proveedor.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelectorAll('[data-proveedor]').forEach(x => x.setAttribute('aria-pressed', String(x === p)));
      return;
    }
    const c = e.target.closest('[data-producto]');
    if (!c) return;
    const l = q('#cv-catalogo')._productos.get(c.dataset.producto);
    q('#agregar-linea').click();
    const li = [...document.querySelectorAll('#lineas-compra li.linea')].pop();
    li.querySelector('.descripcion').value = l.descripcion;
    li.querySelector('.costo').value = l.costoUnitario;
    li.querySelector('.cantidad').value = 1;
    const codigo = li.querySelector('.codigo');
    codigo.value = l.codigo;
    codigo.dispatchEvent(new Event('change', { bubbles: true }));
    codigo.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const renderOriginal = window._renderHistorialComprasDireccion_;
  window._renderHistorialComprasDireccion_ = function () { const r = renderOriginal.apply(this, arguments); pintarSugerencias(); SMX.avisos(pendientes()); return r; };
  const iniciarOriginal = window.iniciar;
  window.iniciar = function () { const r = iniciarOriginal.apply(this, arguments); pintarSugerencias(); sincronizarNav(); SMX.avisos(pendientes()); return r; };

  // ── Gestos ──
  const quitarFila = async li => {
    const queEs = li.classList.contains('pago') ? 'este pago' : 'esta línea';
    if (await sumetecConfirmarBorrado({ verbo: 'Eliminar', objeto: queEs, detalle: 'Se quita de la compra que estás capturando.', irreversible: false })) li.querySelector('.quitar').click();
  };
  SMX.deslizar('#lineas-compra li, #pagos-compra li', quitarFila);
  SMX.lados(dir => { if (form()) ir(dir > 0 ? 'historial' : 'capturar'); }, '#panel-historial li');
  SMX.jalar(() => {
    if (!form()) return;
    _renderHistorialComprasDireccion_();
    return procesarColaCompras(false);
  });
  SMX.barraQueSeEsconde('.compras-barra-guardar');

  // Mantener presionada una línea: duplicarla.
  let reloj = null;
  const soltar = () => { clearTimeout(reloj); reloj = null; };
  document.addEventListener('touchstart', e => {
    const li = e.target.closest('#lineas-compra li');
    if (!li || e.target.closest('input,button,select')) return;
    reloj = setTimeout(() => {
      reloj = null;
      q('#agregar-linea').click();
      const copia = [...document.querySelectorAll('#lineas-compra li.linea')].pop();
      ['codigo', 'descripcion', 'cantidad', 'costo'].forEach(c => { copia.querySelector('.' + c).value = li.querySelector('.' + c).value; });
      Object.assign(copia.dataset, li.dataset);
      li.after(copia);
      copia.querySelector('.costo').dispatchEvent(new Event('input', { bubbles: true }));
    }, 550);
  }, { passive: true });
  document.addEventListener('touchmove', soltar, { passive: true });
  document.addEventListener('touchend', soltar, { passive: true });

  // Arrastrar el asa ⠿ para reordenar.
  document.addEventListener('pointerdown', e => {
    const asa = e.target.closest('#lineas-compra .cv-asa');
    if (!asa) return;
    e.preventDefault();
    const li = asa.closest('li'), lista = li.parentElement;
    li.style.boxShadow = '0 10px 26px rgba(16,40,63,.22)';
    const mover = ev => {
      const sobre = [...lista.children].find(x => x !== li && ev.clientY > x.getBoundingClientRect().top && ev.clientY < x.getBoundingClientRect().bottom);
      if (sobre) { const r = sobre.getBoundingClientRect(); lista.insertBefore(li, ev.clientY > r.top + r.height / 2 ? sobre.nextSibling : sobre); }
    };
    const fin = () => {
      li.style.boxShadow = '';
      document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', fin); document.removeEventListener('pointercancel', fin);
      if (form()) _guardarBorradorCompra_(form());
    };
    document.addEventListener('pointermove', mover); document.addEventListener('pointerup', fin); document.addEventListener('pointercancel', fin);
  });

  SMX.avisos(pendientes());
})();
