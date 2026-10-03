// Billetes y monedas de circulación en México. El "Efectivo contado" del
// formulario se calcula SOLO a partir de estas cantidades -- así la suma de
// denominaciones y el efectivo contado coinciden al centavo por
// construcción, en vez de depender de que Miguel sume bien a mano (plan
// §9, línea 730).
// Ecosistema centralizado (2026-09): mismo valor de fábrica de siempre --
// ver _aplicarConfigDireccionPublicada_ en dashboard.js, que lo puede
// reemplazar con lo que publique el ERP.
let DENOMINACIONES_MXN = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];

// Fecha LOCAL, nunca UTC. toISOString() da la fecha en UTC: en Tijuana
// (UTC-7/-8) a partir de las ~17:00 ya devuelve la de MAÑANA. Un corte
// cerrado a la hora de cerrar la tienda pedía por eso los movimientos de un
// día que todavía no existe -- esperado = solo el fondo inicial, así que el
// efectivo del día entero salía como "sobrante" -- y la fila quedaba
// archivada en CortesCaja con la fecha equivocada. Caja y Compras tenían el
// mismo defecto. Mismo arreglo que Gastos ya traía (_fechaLocal_ en
// gastos.html). Vive aquí porque el Corte es quien más duele.
function _fechaLocalDireccion_(d) {
  d = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// El corte se compara contra lo que el SERVIDOR tiene de ese día. Si el
// teléfono todavía trae capturas en cola (un movimiento de caja, un corte
// previo sin subir), el arqueo se hace contra una foto incompleta y la
// diferencia que salga es falsa. Plan §9, línea 732.
//
// Desde que Compras salió como app propia (F3 del plan de diseño,
// 2026-09-11), su cola vive en OTRA app -- este teléfono puede tener
// compras sin enviar ahí que Dirección ya NO puede ver (localStorage por
// origen). El chip de "N pendientes" de Compras es ahora la única señal:
// revísalo ahí antes de cerrar un corte aquí.
function _pendientesSinEnviarDireccion_() {
  if (typeof COLAS === 'undefined' || typeof leer !== 'function') return 0;
  return Object.values(COLAS).reduce((total, k) => total + leer(k).length, 0);
}

function calcularCorte(m) {
  const esperado = Number(m.fondo || 0) + Number(m.entradasEfectivo || 0) - Number(m.salidasEfectivo || 0);
  const contado = Number(m.contado || 0);
  return { ...m, esperado, diferencia: contado - esperado };
}

const _CLAVE_ID_CAPTURA_CORTE = 'sumetec_direccion_id_captura_corte';
const _CLAVE_FIRMA_CAPTURA_CORTE = 'sumetec_direccion_firma_captura_corte';
// Contenido que identifica UN corte: fecha, fondo y efectivo contado. El ID
// persistido solo vale para esa misma captura (A5-bis, F5N-02): si el corte
// que se va a guardar es otro (otro día, un recuento), sale con ID nuevo en vez
// de reusar el de una captura anterior que se quedó sin acuse.
function _firmaCorte_(d) {
  return [String(d.fecha || ''), Number(d.fondo || 0).toFixed(2), Number(d.contado || 0).toFixed(2)].join('|');
}
function _idCapturaCorte_(firma) {
  let id = localStorage.getItem(_CLAVE_ID_CAPTURA_CORTE);
  if (id && firma && localStorage.getItem(_CLAVE_FIRMA_CAPTURA_CORTE) !== firma) id = null;
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(_CLAVE_ID_CAPTURA_CORTE, id);
  }
  if (firma) localStorage.setItem(_CLAVE_FIRMA_CAPTURA_CORTE, firma);
  return id;
}
function _soltarCapturaCorte_() {
  localStorage.removeItem(_CLAVE_ID_CAPTURA_CORTE);
  localStorage.removeItem(_CLAVE_FIRMA_CAPTURA_CORTE);
}

async function previaCorteDireccion(pin, fecha) {
  const url = localStorage.getItem('sumetec_direccion_url');
  const token = await abrirSesionDireccion(pin);
  return sumetecFetchLimite(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ tipo: 'corte_previo_cloud', fecha, token })
  }).then(r => r.json());
}

// Si el servidor contesta explícitamente que NO (ok:false), el error lleva
// `respondioServidor` y `codigo`: nada quedó guardado. Un fallo de red no los
// lleva, y quien llama debe conservar el corte para reintentarlo.
async function cerrarCorteDireccion(pin, datos) {
  const url = localStorage.getItem('sumetec_direccion_url');
  const token = await abrirSesionDireccion(pin);
  let corte = { ...datos, id: datos.id || crypto.randomUUID(), tipo: 'cerrar_corte_cloud', token, origen: 'direccion' };
  const enviar = c => sumetecFetchLimite(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(c)
  }).then(x => x.json());
  let r = await enviar(corte);
  if (!r.ok && (r.estado === 'CONFLICTO_ID' || r.error === 'CONFLICTO_ID')) {
    // Ese ID ya lo usó otro corte con otros datos: ESTE no se guardó. Se suelta
    // el ID y se reintenta una vez como corte nuevo -- el arqueo no se pierde.
    const nuevo = crypto.randomUUID();
    localStorage.setItem(_CLAVE_ID_CAPTURA_CORTE, nuevo);
    corte = { ...corte, id: nuevo };
    r = await enviar(corte);
  }
  if (!r.ok) {
    const e = Error(r.mensaje || r.error || 'No se pudo cerrar');
    e.respondioServidor = true;
    e.codigo = r.error || r.estado || '';
    throw e;
  }
  return r;
}

// ── Cola de cortes (A5-bis / F5N-02) ────────────────────────────────────────
// Todo corte se guarda en el teléfono ANTES de enviarse (COLAS.cortes) y sale
// de la cola solo cuando el servidor lo confirma. Un corte que llegó pero cuya
// respuesta se perdió se reenvía solo (YA_EXISTIA lo saca de la cola); un
// corte que el servidor rechazó por contenido se queda marcado para revisión.
function _guardarColaCortes_(cola) { localStorage.setItem(COLAS.cortes, JSON.stringify(cola)); }
function _encolarCorte_(corte) {
  _guardarColaCortes_(leer(COLAS.cortes).filter(c => c.id !== corte.id).concat([corte]));
  if (typeof estado === 'function') estado();
}
function _quitarCorteCola_(id) {
  _guardarColaCortes_(leer(COLAS.cortes).filter(c => c.id !== id));
  if (typeof estado === 'function') estado();
}
// Igual que las capturas de Caja (caja.js::_fallaServidorCola_): un fallo que el servidor contestó se cuenta y,
// al tope, el corte pasa a «rechazado» con su motivo a la vista (2026-09-29, incidente REM-0020).
function _falloServidorCorte_(id, motivo, transitorio) {
  _guardarColaCortes_(leer(COLAS.cortes).map(c => {
    if (c.id !== id) return c;
    const y = { ...c };
    if (sumetecAnotarFallo(y, motivo, !transitorio)) y.rechazo = String(motivo || 'El servidor lo rechazó varias veces');
    return y;
  }));
  if (typeof estado === 'function') estado();
}
function _marcarCorteRechazado_(id, motivo) {
  _guardarColaCortes_(leer(COLAS.cortes).map(c => c.id === id ? { ...c, rechazo: String(motivo || 'Rechazado') } : c));
  if (typeof estado === 'function') estado();
}

let _enviandoCortes = false;
// Un solo transmisor a la vez. Devuelve cuántos cortes siguen en la cola.
async function enviarCortesDireccion(pin) {
  if (_enviandoCortes) return leer(COLAS.cortes).length;
  _enviandoCortes = true;
  try {
    for (const c of leer(COLAS.cortes)) {
      if (c.rechazo) continue;
      try {
        await cerrarCorteDireccion(pin, { id: c.id, fecha: c.fecha, fondo: c.fondo, contado: c.contado, hashResumen: c.hashResumen });
        _quitarCorteCola_(c.id);
      } catch (e) {
        if (!e.respondioServidor) continue; // sin respuesta: se queda para el siguiente intento
        // Ya hay un corte igual guardado (mismo fondo, contado y movimientos): nada se pierde.
        if (e.codigo === 'CORTE_DUPLICADO') _quitarCorteCola_(c.id);
        else if (e.codigo === 'MOVIMIENTOS_CAMBIARON' || e.codigo === 'CONFLICTO_ID') _marcarCorteRechazado_(c.id, e.message);
        // cualquier otra respuesta se cuenta: lo transitorio ("servidor ocupado, reintenta") no suma, lo demás llega al tope
        else _falloServidorCorte_(c.id, e.message, sumetecFalloTransitorio({ error: e.message, estado: e.codigo }));
      }
    }
  } finally { _enviandoCortes = false; }
  return leer(COLAS.cortes).length;
}

// Reenvío solo, sin pedir el PIN: únicamente si ya está vigente en memoria y hay red.
async function procesarColaCortes(pedir) {
  if (typeof COLAS === 'undefined' || typeof leer !== 'function') return;
  if (!leer(COLAS.cortes).some(c => !c.rechazo)) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (!localStorage.getItem('sumetec_direccion_url')) return;
  if (!pedir && !(typeof _pinVigente === 'function' && _pinVigente())) return;
  try { await enviarCortesDireccion(await pedirPinDireccion()); } catch (_) {}
  if (typeof estado === 'function') estado();
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => { procesarColaCortes(false); });
}
if (typeof setInterval === 'function') setInterval(() => { procesarColaCortes(false); }, 30000);

// Cortes que el servidor rechazó por contenido: no se descartan solos. Se
// listan con su motivo para que Miguel decida (los datos se dibujan con
// textContent: el motivo es texto libre del servidor).
function _pintarCortesRechazados_(out) {
  if (!out || typeof leer !== 'function' || typeof COLAS === 'undefined') return;
  const rechazados = leer(COLAS.cortes).filter(c => c.rechazo);
  if (!rechazados.length) return;
  const caja = document.createElement('div');
  caja.className = 'card-body';
  rechazados.forEach(c => {
    const p = document.createElement('p');
    p.textContent = `El corte del ${c.fecha} (contado $${Number(c.contado).toFixed(2)}) no se guardó: ${c.rechazo}. `;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-outline-secondary';
    const r2 = document.createElement('button');
    r2.type = 'button'; r2.className = 'btn btn-outline-secondary'; r2.textContent = 'Reintentar';
    r2.onclick = () => {
      _guardarColaCortes_(leer(COLAS.cortes).map(y => { if (y.id !== c.id) return y; const z = { ...y, _srv: 0, _try: 0 }; delete z.rechazo; return z; }));
      if (typeof procesarColaCortes === 'function') procesarColaCortes(true);
      p.remove();
    };
    p.appendChild(r2);
    b.textContent = 'Descartar y volver a contar';
    b.onclick = () => {
      if (!confirm('¿Descartar este corte pendiente? Esos datos NO llegarán al servidor y tendrás que contar de nuevo.')) return;
      _quitarCorteCola_(c.id);
      _soltarCapturaCorte_();
      p.remove();
    };
    p.appendChild(b);
    caja.appendChild(p);
  });
  out.appendChild(caja);
}

// "El cajón" (F2 del plan de diseño, 2026-09-11): cada denominación tiene el
// color real del billete/moneda -- lo único de las apps que NO sale del tema
// del ERP (decisión explícita de Miguel, ver PLAN_DISENO_TEMA_ERP §1).
// Token CSS por denominación (definidos en estilos.css); un valor que el ERP
// llegara a publicar sin color propio (billete que no existe hoy) cae en
// --sm-muted -- nunca se rompe, solo se ve neutro.
const _COLOR_DENOMINACION_MXN = {
  1000: '--billete-1000', 500: '--billete-500', 200: '--billete-200',
  100: '--billete-100', 50: '--billete-50', 20: '--billete-20',
  10: '--billete-10', 5: '--billete-5', 2: '--billete-2', 0.5: '--billete-0-5'
};
function _colorDenominacion(valor) {
  return `var(${_COLOR_DENOMINACION_MXN[valor] || '--sm-muted'})`;
}

function _filaDenominacion(valor) {
  const etiqueta = valor >= 1 ? `$${valor}` : `${valor * 100}¢`;
  // Rediseño 2026-09-24: una fila por denominación (−, cantidad, +, subtotal),
  // sin el color del billete -- decisión de Miguel al aprobar la propuesta.
  // _colorDenominacion/_htmlBarraEfectivo se conservan (pruebas y por si se
  // quiere volver a mostrar la barra de composición).
  // La cantidad SIGUE siendo un <input type=number> real (no solo +/-):
  // Miguel puede escribir "37" directamente para cantidades grandes en vez
  // de tocar 37 veces (plan: "tocar = +1; botón − para restar; teclado para
  // cantidades grandes"). data-valor es lo que lee _recalcularContadoDesde-
  // Denominaciones -- sin cambios ahí.
  return `<div class="denominacion" data-valor="${valor}">
    <span class="billete-etiqueta">${etiqueta}</span>
    <button type="button" class="billete-boton billete-menos" aria-label="Quitar un ${etiqueta}">−</button>
    <input type="number" min="0" step="1" value="0" inputmode="numeric" class="cant-denominacion" aria-label="Cantidad de ${etiqueta}">
    <button type="button" class="billete-boton billete-mas" aria-label="Agregar un ${etiqueta}">+</button>
    <span class="billete-subtotal">—</span>
  </div>`;
}

function formularioCorteDireccion() {
  return `<h1>Corte</h1>
<div id="arqueo-vivo" class="arqueo-vivo" role="status" aria-live="polite">
  <div class="arqueo-cifras">
    <div><span>Esperado</span><strong id="arqueo-esperado" class="num">—</strong></div>
    <div><span>Contado</span><strong id="arqueo-contado" class="num">$0.00</strong></div>
    <div><span id="arqueo-dif-etiqueta">Diferencia</span><strong id="arqueo-dif" class="num">—</strong></div>
  </div>
  <div class="arqueo-barra"><span id="arqueo-barra-relleno"></span></div>
  <p id="arqueo-nota" class="arqueo-nota">Toca «Ver previa» para traer lo esperado del servidor.</p>
</div>
<p class="text-muted">Compara únicamente el efectivo contado contra los movimientos de efectivo del día.</p>
<div class="aviso-banner" role="note"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span>Revisa también Compras: sus pendientes sin enviar ya no se ven desde aquí.</span></div>
<div class="corte-layout">
<form id="form-corte" class="card"><div class="card-body" style="display:grid;gap:10px">
  <div class="corte-datos">
    <label class="form-label" for="corte-fecha">Fecha<input id="corte-fecha" class="form-control" name="fecha" type="date" required></label>
    <label class="form-label" for="corte-fondo">Fondo inicial<input id="corte-fondo" class="form-control" name="fondo" type="number" min="0" step="0.01" value="0" inputmode="decimal"></label>
  </div>
  <fieldset id="denominaciones-corte" class="billetero">
    <legend class="form-label">Efectivo contado, billete por billete</legend>
    ${DENOMINACIONES_MXN.map(_filaDenominacion).join('')}
  </fieldset>
  <label class="form-label corte-contado" for="corte-contado">Efectivo contado (suma de arriba)
    <input id="corte-contado" class="form-control num" name="contado" type="number" min="0" step="0.01" required readonly>
  </label>
  <div class="fila">
    <button type="button" id="ver-previa" class="btn btn-outline-secondary"><i class="bi bi-search"></i> Ver previa</button>
    <button class="btn btn-success"><i class="bi bi-check-circle"></i> Cerrar corte</button>
  </div>
</div></form>
<div id="resultado-corte" class="card" style="padding:12px 14px" role="status"></div>
</div>`;
}

// Umbral desde el que una diferencia pide confirmación explícita antes de
// cerrar (plan de mejoras 2026-09-14): un corte descuadrado por unos
// centavos es normal; uno descuadrado por cientos de pesos merece una
// pausa, no un guardado de un solo toque.
const UMBRAL_CONFIRMAR_DIFERENCIA = 100;

// Separada de la lectura del DOM para poder probarla sin navegador: dado
// [{valor, cantidad}, ...] regresa el total en efectivo -- exactamente lo
// que exige el plan (denominaciones y "efectivo contado" deben coincidir al
// centavo, línea 730).
function _sumaDenominaciones(pares) {
  return pares.reduce((suma, p) => suma + Number(p.valor) * (Number(p.cantidad) || 0), 0);
}

// Pura y testable, igual que _sumaDenominaciones: dado el mismo [{valor,
// cantidad}] y el total ya calculado, regresa los segmentos de la barra
// (uno por denominación con cantidad > 0), como % del total. El color nunca
// es la única señal -- la denominación sigue escrita en cada ficha de
// arriba (plan §3), esta barra es solo composición visual.
function _segmentosEfectivo(pares, total) {
  if (!(total > 0)) return [];
  return pares
    .map(p => ({ valor: Number(p.valor), monto: Number(p.valor) * (Number(p.cantidad) || 0) }))
    .filter(s => s.monto > 0)
    .map(s => ({ valor: s.valor, pct: (s.monto / total) * 100 }));
}

function _htmlBarraEfectivo(segmentos) {
  if (!segmentos.length) return '';
  return segmentos.map(s =>
    `<span style="width:${s.pct.toFixed(3)}%;background:${_colorDenominacion(s.valor)}"></span>`
  ).join('');
}

function _recalcularContadoDesdeDenominaciones(f) {
  const pares = [...f.querySelectorAll('#denominaciones-corte .denominacion')].map(label => ({
    valor: label.dataset.valor,
    cantidad: label.querySelector('.cant-denominacion').value
  }));
  const total = _sumaDenominaciones(pares);
  f.contado.value = total.toFixed(2);
  const barra = f.querySelector('#barra-efectivo');
  if (barra) barra.innerHTML = _htmlBarraEfectivo(_segmentosEfectivo(pares, total));
  f.querySelectorAll('#denominaciones-corte .denominacion').forEach(d => {
    const monto = Number(d.dataset.valor) * (Number(d.querySelector('.cant-denominacion').value) || 0);
    const sub = d.querySelector('.billete-subtotal');
    if (sub) sub.textContent = monto ? '$' + monto.toFixed(2) : '—';
    d.classList.toggle('con-cantidad', monto > 0);
  });
  _pintarArqueoVivo_(f);
}

// Rediseño 2026-09-24: diferencia EN VIVO mientras se cuenta. Lo esperado
// sale de la previa del servidor (corte_previo_cloud) -- se pide una vez y
// se reusa en cada toque; si cambia la fecha, se vuelve a pedir. Sin previa
// todavía, se muestra solo lo contado (nunca una diferencia inventada).
let _previaCorteVigente = null;
function _pintarArqueoVivo_(f) {
  const el = id => document.getElementById(id);
  const contado = Number(f.contado.value) || 0;
  if (el('arqueo-contado')) el('arqueo-contado').textContent = '$' + contado.toFixed(2);
  const p = _previaCorteVigente;
  const vigente = p && p.fecha === f.fecha.value;
  if (el('arqueo-nota')) el('arqueo-nota').hidden = !!vigente;
  if (!vigente) {
    if (el('arqueo-esperado')) el('arqueo-esperado').textContent = '—';
    if (el('arqueo-dif')) { el('arqueo-dif').textContent = '—'; el('arqueo-dif').className = 'num'; }
    if (el('arqueo-dif-etiqueta')) el('arqueo-dif-etiqueta').textContent = 'Diferencia';
    if (el('arqueo-barra-relleno')) el('arqueo-barra-relleno').style.width = '0%';
    return;
  }
  const c = calcularCorte({ fondo: f.fondo.value, entradasEfectivo: p.entradasEfectivo, salidasEfectivo: p.salidasEfectivo, contado });
  if (el('arqueo-esperado')) el('arqueo-esperado').textContent = '$' + c.esperado.toFixed(2);
  if (el('arqueo-dif-etiqueta')) el('arqueo-dif-etiqueta').textContent = _etiquetaDiferencia(c.diferencia);
  if (el('arqueo-dif')) {
    el('arqueo-dif').textContent = (Math.abs(c.diferencia) < 0.005 ? '' : c.diferencia > 0 ? '+' : '−') + '$' + Math.abs(c.diferencia).toFixed(2);
    el('arqueo-dif').className = 'num ' + _claseDiferencia(c.diferencia);
  }
  if (el('arqueo-barra-relleno')) {
    const pct = c.esperado > 0 ? Math.min(100, (contado / c.esperado) * 100) : (contado > 0 ? 100 : 0);
    el('arqueo-barra-relleno').style.width = pct.toFixed(1) + '%';
  }
}

// Tocar +/- suma o resta un billete a la vez (plan §3); dispatchEvent
// 'input' reusa el mismo oninput que ya escucha cada campo más abajo -- no
// hay dos caminos distintos para el mismo recálculo.
function _ajustarDenominacion(boton, delta) {
  const chip = boton.closest('.denominacion');
  const input = chip && chip.querySelector('.cant-denominacion');
  if (!input) return;
  input.value = Math.max(0, (Number(input.value) || 0) + delta);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Verde (cuadra), latón/aviso (sobra) u óxido/rojo (falta) -- mismos tres
// tokens del tema que usa el resto de las apps para "diferencia" (plan §1).
function _claseDiferencia(diferencia) {
  if (Math.abs(diferencia) < 0.005) return 'text-verde';
  return diferencia > 0 ? 'text-aviso' : 'text-rojo';
}
function _etiquetaDiferencia(diferencia) {
  if (Math.abs(diferencia) < 0.005) return '✓ Cuadra';
  return diferencia > 0 ? 'Sobra' : 'Falta';
}

// Todo lo interpolado aquí es numérico (Number()/toFixed ya lo garantiza) --
// nunca texto libre del servidor, así que innerHTML es seguro. Los mensajes
// de error (texto libre: r.error, e.message) se siguen mostrando con
// textContent más abajo, nunca con innerHTML.
function _htmlResumenCorte(c, n) {
  return `<p>Esperado: <strong class="num">$${c.esperado.toFixed(2)}</strong></p>
<p>Diferencia: <strong class="num ${_claseDiferencia(c.diferencia)}">${_etiquetaDiferencia(c.diferencia)} $${Math.abs(c.diferencia).toFixed(2)}</strong></p>
<p class="text-muted">Movimientos incluidos: ${Number(n) || 0}</p>`;
}

function activarCorteDireccion() {
  const f = document.querySelector('#form-corte');
  const out = document.querySelector('#resultado-corte');
  if (!f) return;
  f.fecha.value = _fechaLocalDireccion_();
  _previaCorteVigente = null;
  _pintarCortesRechazados_(out);
  f.fondo.oninput = () => _pintarArqueoVivo_(f);
  f.fecha.onchange = () => _pintarArqueoVivo_(f);
  _pintarArqueoVivo_(f);

  f.querySelectorAll('.cant-denominacion').forEach(input => {
    input.oninput = () => _recalcularContadoDesdeDenominaciones(f);
  });
  document.querySelector('#denominaciones-corte').addEventListener('click', e => {
    const menos = e.target.closest('.billete-menos');
    const mas = e.target.closest('.billete-mas');
    if (menos) _ajustarDenominacion(menos, -1);
    else if (mas) _ajustarDenominacion(mas, 1);
  });

  // Un solo PIN por sesión (cacheado en memoria hasta por 10 min): antes se
  // pedía hasta 3 veces para cerrar un mismo corte (previa, submit, y una
  // "confirmación" repetida que no agregaba seguridad real).
  const previa = async pin => {
    const p = await previaCorteDireccion(pin, f.fecha.value);
    if (!p.ok) throw Error(p.error || 'No se pudo consultar la previa');
    const c = calcularCorte({
      fondo: f.fondo.value, entradasEfectivo: p.entradasEfectivo,
      salidasEfectivo: p.salidasEfectivo, contado: f.contado.value
    });
    _previaCorteVigente = { fecha: f.fecha.value, entradasEfectivo: p.entradasEfectivo, salidasEfectivo: p.salidasEfectivo };
    _pintarArqueoVivo_(f);
    out.innerHTML = _htmlResumenCorte(c, p.n);
    return p;
  };

  // Con PIN vigente en memoria, la previa se trae sola al entrar -- así la
  // diferencia en vivo arranca de inmediato (mismo criterio que Caja).
  if (typeof _pinVigente === 'function' && _pinVigente()) {
    pedirPinDireccion().then(previa).catch(() => {});
  }

  document.querySelector('#ver-previa').onclick = async () => {
    try {
      const pin = await pedirPinDireccion();
      await previa(pin);
    } catch (e) {
      out.textContent = e.message;
    }
  };

  f.onsubmit = async e => {
    e.preventDefault();
    try {
      const pendientes = _pendientesSinEnviarDireccion_();
      if (pendientes) {
        // 2026-09-09 (DIR-K01): el mensaje solo mandaba a Compras, pero la
        // cola sin enviar puede ser de un movimiento de Caja -- que hasta
        // hoy no tenía a dónde enviarse. Ahora Caja también tiene su botón.
        // 2026-09-11 (F3): esto ya NO incluye Compras -- su cola vive en su
        // propia app desde que se separó, invisible aquí. El texto ya no la
        // menciona como si Dirección la pudiera detectar (sería mentira);
        // el aviso fijo de arriba en el formulario cubre ese recordatorio.
        throw Error(`No se puede cerrar: hay ${pendientes} captura(s) sin enviar en este ` +
          `teléfono. El arqueo se compara contra el servidor, así que la diferencia ` +
          `saldría falsa. Envíalas primero (toca el aviso de pendientes o Caja → "Enviar movimientos pendientes").`);
      }
      const pin = await pedirPinDireccion();
      const p = await previa(pin);
      const cSinGuardar = calcularCorte({
        fondo: f.fondo.value, entradasEfectivo: p.entradasEfectivo,
        salidasEfectivo: p.salidasEfectivo, contado: f.contado.value
      });
      if (Math.abs(cSinGuardar.diferencia) >= UMBRAL_CONFIRMAR_DIFERENCIA) {
        const sigue = confirm(`${_etiquetaDiferencia(cSinGuardar.diferencia)} ` +
          `$${Math.abs(cSinGuardar.diferencia).toFixed(2)}. ¿Cerrar el corte de todas formas?`);
        if (!sigue) return;
      }
      const corte = {
        fecha: f.fecha.value, fondo: f.fondo.value, contado: f.contado.value,
        hashResumen: p.hashResumen || ''
      };
      corte.id = _idCapturaCorte_(_firmaCorte_(corte));
      _encolarCorte_(corte); // primero al teléfono, luego al servidor
      let r;
      try {
        r = await cerrarCorteDireccion(pin, corte);
      } catch (errEnvio) {
        if (errEnvio.respondioServidor) { _quitarCorteCola_(corte.id); throw errEnvio; } // el servidor dijo que NO: nada quedó guardado
        throw Error('Sin respuesta del servidor. El corte quedó guardado en este teléfono y se enviará solo al volver la señal ' +
          '(o toca el aviso de pendientes). No lo captures otra vez.');
      }
      _quitarCorteCola_(corte.id);
      _soltarCapturaCorte_();
      const dif = Number(r.diferencia);
      out.innerHTML = `<p><strong class="text-verde">Corte guardado.</strong></p>` +
        `<p>Esperado: <strong class="num">$${Number(r.esperado).toFixed(2)}</strong></p>` +
        `<p>Diferencia: <strong class="num ${_claseDiferencia(dif)}">${_etiquetaDiferencia(dif)} $${Math.abs(dif).toFixed(2)}</strong></p>`;
      estado();
    } catch (err) {
      out.textContent = err.message;
    }
  };
}
