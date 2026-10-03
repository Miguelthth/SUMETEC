const CLASES_CAJA_DIRECCION = [
  'APORTE_SOCIO', 'RETIRO_SOCIO', 'DEPOSITO_BANCO',
  'DEVOLUCION_CLIENTE', 'ENTRADA_AJUSTE', 'SALIDA_AJUSTE'
];

function validarMovimientoDireccion(d) {
  const clase = String(d.clase || '').trim().toUpperCase();
  const monto = Number(d.monto);
  const concepto = String(d.concepto || '').trim();
  const cuentaSocio = String(d.cuentaSocio || '').trim();

  if (!CLASES_CAJA_DIRECCION.includes(clase)) throw Error('Clase de movimiento no permitida');
  if (!d.fecha || !Number.isFinite(monto) || monto <= 0 || !d.metodo || !concepto) {
    throw Error('Completa fecha, monto, método y concepto');
  }
  if (['APORTE_SOCIO', 'RETIRO_SOCIO'].includes(clase) && !cuentaSocio) {
    throw Error('Selecciona el socio responsable');
  }
  if (['ENTRADA_AJUSTE', 'SALIDA_AJUSTE'].includes(clase) && concepto.length < 10) {
    throw Error('El ajuste requiere explicación de al menos 10 caracteres');
  }
  return {
    id: d.id || crypto.randomUUID(), fecha: d.fecha, hora: d.hora || new Date().toISOString(),
    tipoMovimiento: clase, monto, metodo: String(d.metodo).toUpperCase(),
    referencia: String(d.referencia || ''), notas: concepto, cuentaSocio
  };
}

// Etiquetas legibles para la persona que captura -- el valor que viaja al
// servidor sigue siendo la clave interna (option value), sin tocar
// validarMovimientoDireccion ni el ERP del otro lado.
const _ETIQUETA_CLASE_CAJA = {
  APORTE_SOCIO: 'Aporte de socio', RETIRO_SOCIO: 'Retiro de socio',
  DEPOSITO_BANCO: 'Depósito a banco', DEVOLUCION_CLIENTE: 'Devolución a cliente',
  ENTRADA_AJUSTE: 'Entrada (ajuste)', SALIDA_AJUSTE: 'Salida (ajuste)'
};
function _etiquetaClaseCaja(clase) { return _ETIQUETA_CLASE_CAJA[clase] || clase; }

function formularioCajaDireccion() {
  return `<h1>Caja</h1>
<p class="text-muted">Movimientos físicos del cajón. No son ventas ni gastos.</p>
<form id="form-caja" class="card"><div class="card-body" style="display:grid;gap:12px">
  <div class="caja-clases" role="group" aria-label="Tipo de movimiento">${CLASES_CAJA_DIRECCION.map(x => `<button type="button" class="caja-chip" data-clase="${x}" aria-pressed="false">${_etiquetaClaseCaja(x)}</button>`).join('')}</div>
  <select id="caja-clase" name="clase" class="form-select sm-oculto" aria-hidden="true" tabindex="-1">${CLASES_CAJA_DIRECCION.map(x => `<option value="${x}">${_etiquetaClaseCaja(x)}</option>`).join('')}</select>
  <label class="form-label" for="caja-monto">Monto<input id="caja-monto" class="form-control caja-monto" name="monto" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required></label>
  <label class="form-label" for="caja-concepto">Concepto / explicación<textarea id="caja-concepto" class="form-control" name="concepto" rows="2" required></textarea></label>
  <label class="form-label" for="caja-socio" id="campo-socio">Socio (aporte/retiro)<input id="caja-socio" class="form-control" name="cuentaSocio" value="JOSE MIGUEL"></label>
  <button type="button" class="btn-mas-campos" id="btn-mas-campos-caja" aria-expanded="false" aria-controls="campos-mas-caja">
    <span class="toggle-texto">▾ Más campos</span><span class="resumen-campos" id="resumen-campos-caja"></span>
  </button>
  <div class="campos-mas" id="campos-mas-caja">
    <label class="form-label" for="caja-fecha">Fecha<input id="caja-fecha" class="form-control" name="fecha" type="date" required></label>
    <label class="form-label" for="caja-metodo">Método
      <select id="caja-metodo" name="metodo" class="form-select"><option>EFECTIVO</option><option>TRANSFERENCIA</option><option>TARJETA</option></select>
    </label>
    <label class="form-label" for="caja-referencia">Referencia (si aplica)<input id="caja-referencia" class="form-control" name="referencia"></label>
  </div>
  <button class="btn btn-success btn-bloque"><i class="bi bi-check-circle"></i> Guardar movimiento</button>
</div></form>
<p id="resultado-caja" class="text-muted" role="status"></p>
<section id="lista-caja" class="card"><div id="lista-caja-cuerpo" class="card-body">
  <h2>Movimientos de hoy</h2>
  <p class="text-muted">Toca "Ver movimientos" para consultarlos.</p>
  <button id="ver-movimientos" type="button" class="btn btn-outline-secondary">Ver movimientos</button>
</div></section>`;
}

// ── Cola de Caja: guardar SIEMPRE antes de enviar y reenviar sola ───────────────
// (A-COLAS, auditoría incremental 2026-09-28, F5N-06 + B11). Una captura entra a su cola
// ANTES de tocar la red y sale solo cuando el servidor confirma. Sin señal o con la conexión
// cortada a la mitad se queda guardada y se reenvía sola (al volver la señal y cada 30 s con la
// app desbloqueada); un solo transmisor a la vez por cola. Un CONFLICTO_ID (mismo ID con otros
// datos) no se reenvía ni se descarta: queda marcado para que Miguel lo revise.
function _guardarCola_(clave, cola) { localStorage.setItem(clave, JSON.stringify(cola)); }
function _encolar_(clave, item) {
  _guardarCola_(clave, leer(clave).filter(x => x.id !== item.id).concat([item]));
  if (typeof estado === 'function') estado();
}
function _quitarDeCola_(clave, id) {
  _guardarCola_(clave, leer(clave).filter(x => x.id !== id));
  if (typeof estado === 'function') estado();
}
// 2026-09-29 (incidente REM-0020 del Cotizador, misma clase de fallo): una captura que el SERVIDOR contestó
// con error se reintentaba cada 30 s para siempre y sin decir por qué. Ahora cada fallo que el servidor SÍ contestó
// se cuenta (y se guarda su motivo); al tope, la captura pasa a «rechazada» con ese motivo a la vista y un botón
// «Reintentar». Sin señal, tiempo agotado, servidor ocupado o token vencido NO cuentan.
function _fallaServidorCola_(clave, id, motivo, transitorio) {
  _guardarCola_(clave, leer(clave).map(x => {
    if (x.id !== id) return x;
    const y = { ...x };
    if (sumetecAnotarFallo(y, motivo, !transitorio)) y.rechazo = String(motivo || 'El servidor la rechazó varias veces');
    return y;
  }));
  if (typeof estado === 'function') estado();
}
function _marcarRechazoCola_(clave, id, motivo) {
  _guardarCola_(clave, leer(clave).map(x => x.id === id ? { ...x, rechazo: String(motivo || 'Rechazado') } : x));
  if (typeof estado === 'function') estado();
}

let _enviandoMovimientos = false;
async function enviarMovimientosDireccion(pin) {
  const url = localStorage.getItem('sumetec_direccion_url');
  if (!url) throw Error('Vincula el teléfono primero');
  const token = await abrirSesionDireccion(pin);
  if (_enviandoMovimientos) return leer(COLAS.movimientos).length;   // B11: un solo transmisor
  _enviandoMovimientos = true;
  try {
    // La cola se vuelve a leer por cada movimiento y solo se quita el confirmado: mientras el envío
    // (uno por uno) está en curso se pudo capturar algo nuevo (hallazgo DIR-K01/H-01).
    for (const mov of leer(COLAS.movimientos)) {
      if (mov.rechazo) continue;
      const { rechazo, _try, _srv, _lastError, ...limpio } = mov;
      // D-02: sin red se detiene el envío; una respuesta que no es JSON cuenta como fallo de ESTE movimiento.
      const { r, sinRed } = await sumetecPostJsonSeguro(url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...limpio, tipo: 'movimiento_caja', token, origen: 'direccion' })
      });
      if (sinRed) break;   // sin red: el resto sigue en la cola para el siguiente intento
      // El servidor dedupe por id (registrarMovimientoCaja_): CREADO o YA_EXISTIA son los dos
      // resultados en los que el movimiento YA está registrado y puede salir de la cola.
      if (r.ok && (r.estado === 'CREADO' || r.estado === 'YA_EXISTIA')) _quitarDeCola_(COLAS.movimientos, mov.id);
      else if (r.estado === 'CONFLICTO_ID') _marcarRechazoCola_(COLAS.movimientos, mov.id, r.error || 'Ese movimiento ya existe en la nube con otros datos');
      else _fallaServidorCola_(COLAS.movimientos, mov.id, sumetecMotivoRespuesta(r), sumetecFalloTransitorio(r));
    }
  } finally { _enviandoMovimientos = false; }
  const pendientes = leer(COLAS.movimientos).length;
  estado();
  return pendientes;
}

let _enviandoAnulaciones = false;
async function enviarAnulacionesDireccion(pin) {
  const url = localStorage.getItem('sumetec_direccion_url');
  if (!url) throw Error('Vincula el teléfono primero');
  const token = await abrirSesionDireccion(pin);
  if (_enviandoAnulaciones) return leer(COLAS.anulaciones).length;
  _enviandoAnulaciones = true;
  try {
    for (const a of leer(COLAS.anulaciones)) {
      if (a.rechazo) continue;
      const { r, sinRed } = await sumetecPostJsonSeguro(url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ tipo: 'anular_movimiento_caja', id: a.id, anulaA: a.anulaA, motivo: a.motivo, token, origen: 'direccion' })
      });
      if (sinRed) break;
      if (r.ok) _quitarDeCola_(COLAS.anulaciones, a.id);   // CREADO o YA_ANULADO: ya quedó corregido
      else if (/no existe|no encontrado/.test(String(r.error || ''))) _marcarRechazoCola_(COLAS.anulaciones, a.id, String(r.error));
      else _fallaServidorCola_(COLAS.anulaciones, a.id, sumetecMotivoRespuesta(r), sumetecFalloTransitorio(r));
    }
  } finally { _enviandoAnulaciones = false; }
  const pendientes = leer(COLAS.anulaciones).length;
  estado();
  return pendientes;
}

// Reenvío solo: al volver la señal y cada 30 s, SIN pedir el PIN -- solo si ya está vigente en memoria.
async function procesarColaCaja(pedir) {
  if (typeof COLAS === 'undefined' || typeof leer !== 'function') return;
  const hay = k => COLAS[k] && leer(COLAS[k]).some(x => !x.rechazo);
  if (!hay('movimientos') && !hay('anulaciones')) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (!localStorage.getItem('sumetec_direccion_url')) return;
  if (!pedir && !(typeof _pinVigente === 'function' && _pinVigente())) return;
  try {
    const pin = await pedirPinDireccion();
    await enviarMovimientosDireccion(pin);   // primero lo creado, después sus correcciones
    await enviarAnulacionesDireccion(pin);
  } catch (_) { /* se reintenta en el siguiente ciclo */ }
  if (typeof estado === 'function') estado();
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => { procesarColaCaja(false); });
}
if (typeof setInterval === 'function') setInterval(() => { procesarColaCaja(false); }, 30000);

// Identidad estable de UNA captura de caja (hallazgo DIR-01, 2026-09-09).
//
// El servidor deduplica movimientos por `id` (apps_script.js::
// registrarMovimientoCaja_). Pero el id se generaba dentro de
// validarMovimientoDireccion en CADA envío, y en el camino con conexión no
// quedaba rastro local de nada: si la respuesta se perdía (conexión
// intermitente) y Miguel volvía a dar Guardar con los mismos datos, salía un
// UUID distinto y la caja registraba el aporte DOS veces. $200 por uno de $100.
//
// Ahora el id se ata a la CAPTURA, no al envío: se conserva mientras ese
// movimiento no se haya confirmado, así el reintento es el mismo movimiento
// para el servidor. Se suelta al confirmar, y también cuando el servidor
// respondió explícitamente que NO se guardó (ahí sí sabemos que no quedó
// nada, y una corrección debe salir como movimiento nuevo).
const _CLAVE_ID_CAPTURA_CAJA = 'sumetec_direccion_id_captura_caja';
let _idCapturaCaja = typeof localStorage !== 'undefined'
  ? (localStorage.getItem(_CLAVE_ID_CAPTURA_CAJA) || null) : null;
function idCapturaCaja() {
  if (!_idCapturaCaja) {
    _idCapturaCaja = crypto.randomUUID();
    localStorage.setItem(_CLAVE_ID_CAPTURA_CAJA, _idCapturaCaja);
  }
  return _idCapturaCaja;
}
function soltarCapturaCaja() {
  _idCapturaCaja = null;
  localStorage.removeItem(_CLAVE_ID_CAPTURA_CAJA);
}

async function guardarMovimientoDireccion(pin, datos) {
  const movimiento = validarMovimientoDireccion(datos);
  const url = localStorage.getItem('sumetec_direccion_url');

  // A-COLAS: primero al teléfono, después a la red.
  _encolar_(COLAS.movimientos, movimiento);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: true, estado: 'EN_COLA' };

  let token;
  try { token = await abrirSesionDireccion(pin); }
  catch (err) { _quitarDeCola_(COLAS.movimientos, movimiento.id); throw err; }   // PIN mal: nada que reenviar
  let r;
  try {
    r = await sumetecFetchLimite(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ ...movimiento, tipo: 'movimiento_caja', token, origen: 'direccion' })
    }).then(x => x.json());
  } catch (_) {
    // Conexión cortada a la mitad: no sabemos si llegó. Se queda en la cola con su ID y se reenvía sola
    // (el servidor contesta YA_EXISTIA si sí llegó): nunca se pierde ni se duplica.
    return { ok: true, estado: 'EN_COLA' };
  }
  if (!r.ok) {
    // El servidor SÍ contestó, y contestó que no: no queda nada guardado que reenviar. Se marca para que
    // quien llama suelte el id; el formulario conserva lo capturado.
    _quitarDeCola_(COLAS.movimientos, movimiento.id);
    const e = Error(r.error || (r.estado === 'CONFLICTO_ID' ? 'Ese movimiento ya existe con otros datos' : 'No se pudo guardar el movimiento'));
    e.respondioServidor = true;
    throw e;
  }
  _quitarDeCola_(COLAS.movimientos, movimiento.id);
  return r;
}

// Tarea 16: corregir sin editar/borrar la fila original -- validación pura,
// probada sin red igual que validarMovimientoDireccion.
function validarAnulacionDireccion(d) {
  const anulaA = String(d.anulaA || '').trim();
  const motivo = String(d.motivo || '').trim();
  if (!anulaA) throw Error('Falta el movimiento a corregir');
  if (motivo.length < 10) throw Error('La corrección requiere explicación de al menos 10 caracteres');
  return { anulaA, motivo };
}

async function cargarMovimientosCajaDireccion(pin, fecha) {
  const url = localStorage.getItem('sumetec_direccion_url');
  if (!url) throw Error('Vincula el teléfono primero');
  const token = await abrirSesionDireccion(pin);
  const r = await sumetecFetchLimite(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ tipo: 'movimientos_del_dia', fecha, token })
  }).then(x => x.json());
  if (!r.ok) throw Error(r.error || 'No se pudieron consultar los movimientos');
  return r.movimientos;
}

async function anularMovimientoDireccion(pin, anulaA, motivo) {
  const { anulaA: id, motivo: m } = validarAnulacionDireccion({ anulaA, motivo });
  const url = localStorage.getItem('sumetec_direccion_url');
  // A-COLAS: la corrección también se guarda antes de enviarse y se reenvía sola (el servidor es idempotente:
  // YA_ANULADO). Una corrección pendiente del mismo movimiento se reutiliza, no se duplica.
  const previa = leer(COLAS.anulaciones).find(x => x.anulaA === id);
  const item = previa || { id: 'ANUL-DIR:' + crypto.randomUUID(), anulaA: id, motivo: m };
  _encolar_(COLAS.anulaciones, item);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: true, estado: 'EN_COLA' };
  let token;
  try { token = await abrirSesionDireccion(pin); }
  catch (err) { _quitarDeCola_(COLAS.anulaciones, item.id); throw err; }
  let r;
  try {
    r = await sumetecFetchLimite(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ tipo: 'anular_movimiento_caja', id: item.id, anulaA: id, motivo: item.motivo, token, origen: 'direccion' })
    }).then(x => x.json());
  } catch (_) { return { ok: true, estado: 'EN_COLA' }; }
  _quitarDeCola_(COLAS.anulaciones, item.id);
  if (!r.ok) throw Error(r.error || 'No se pudo corregir el movimiento');
  return r;
}

function _horaCaja(h) {
  const s = String(h || '');
  const m = s.match(/(\d{1,2}:\d{2})(?::\d{2})?\s*$/) || s.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

function _dineroCaja(v) { return '$' + Number(v || 0).toFixed(2); }
function _escCaja(v) {
  if (typeof _escDir_ === 'function') return _escDir_(v);
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderMovimientosCaja(movs) {
  if (!movs.length) return '<p>Sin movimientos capturados hoy.</p>';
  const filas = movs.map(m => {
    const corregible = !m.anulado && m.tipo !== 'ANULACION';
    const ref = m.tipo === 'ANULACION' ? `corrige ${m.anulaA}` : (m.referencia || m.cuentaSocio || '—');
    const idSeguro = _escCaja(m.id);
    const boton = corregible ? `<button type="button" class="anular" data-id="${idSeguro}">Corregir</button>` : '';
    const esAnul = m.tipo === 'ANULACION';
    const clasePos = m.signo === '+' ? 'pos' : (esAnul ? 'neutro' : 'neg');
    const signoTxt = esAnul ? '' : m.signo;
    return `<li data-id="${idSeguro}" class="${m.anulado ? 'anulado' : ''}">` +
      `<div class="mov-info"><div class="mov-linea1">` +
      `<span class="mov-monto ${clasePos}">${signoTxt}${_dineroCaja(m.monto)}</span>` +
      `<span class="mov-tipo">${_escCaja(_etiquetaClaseCaja(m.tipo))}</span>` +
      `${m.anulado ? '<span class="mov-anulado-tag">ANULADO</span>' : ''}</div>` +
      `<span class="mov-linea2">${_escCaja(m.metodo)} · ${_escCaja(_horaCaja(m.hora) || m.origen)} · ${_escCaja(ref)}</span>` +
      `</div>${boton}</li>`;
  }).join('');
  return `<ul>${filas}</ul>`;
}

// Capturas que la nube rechazó por contenido: no se descartan solas ni se reintentan. Se listan con su motivo
// para que Miguel decida (todo se dibuja con textContent: el motivo es texto libre del servidor).
function _pintarRechazadosCaja_(despuesDe) {
  if (!despuesDe || typeof leer !== 'function' || typeof COLAS === 'undefined') return;
  const filas = [];
  [['movimientos', 'Movimiento'], ['anulaciones', 'Corrección']].forEach(([k, etiqueta]) => {
    if (COLAS[k]) leer(COLAS[k]).filter(x => x.rechazo).forEach(x => filas.push({ k, etiqueta, x }));
  });
  if (!filas.length) return;
  const caja = document.createElement('div');
  caja.className = 'card-body';
  filas.forEach(({ k, etiqueta, x }) => {
    const p = document.createElement('p');
    p.textContent = `${etiqueta} ${x.tipoMovimiento || x.anulaA || ''} ${x.monto ? '$' + Number(x.monto).toFixed(2) : ''} no se guardó: ${x.rechazo}. `;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-outline-secondary'; b.textContent = 'Descartar';
    b.onclick = () => {
      if (!confirm('¿Descartar esta captura pendiente? NO llegará al servidor.')) return;
      _quitarDeCola_(COLAS[k], x.id); p.remove();
    };
    // «Reintentar» suelta el freno (sirve cuando el rechazo fue por fallos del servidor, no por datos distintos).
    const r2 = document.createElement('button');
    r2.type = 'button'; r2.className = 'btn btn-outline-secondary'; r2.textContent = 'Reintentar';
    r2.onclick = () => {
      _guardarCola_(COLAS[k], leer(COLAS[k]).map(y => { if (y.id !== x.id) return y; const z = { ...y, _srv: 0, _try: 0 }; delete z.rechazo; return z; }));
      if (typeof procesarColaCaja === 'function') procesarColaCaja(true);
      p.remove();
    };
    p.appendChild(r2); p.appendChild(b); caja.appendChild(p);
  });
  despuesDe.insertAdjacentElement('afterend', caja);
}

function activarCajaDireccion() {
  const f = document.querySelector('#form-caja');
  if (!f) return;
  f.fecha.value = _fechaLocalDireccion_();

  // Campos secundarios colapsados en celular (siempre visibles en
  // escritorio, ver estilos.css @media min-width:640px): solo Movimiento,
  // Monto y Concepto quedan siempre a la vista. Ningún campo se elimina.
  const btnMas = document.querySelector('#btn-mas-campos-caja');
  const camposMas = document.querySelector('#campos-mas-caja');
  const campoSocio = document.querySelector('#campo-socio');
  const resumenCampos = document.querySelector('#resumen-campos-caja');

  function actualizarResumenCampos() {
    if (!resumenCampos) return;
    const esHoy = f.fecha.value === _fechaLocalDireccion_();
    const partes = [esHoy ? 'hoy' : f.fecha.value, f.metodo.value.toLowerCase(), f.referencia.value ? 'ref. ' + f.referencia.value : 'sin referencia'];
    resumenCampos.textContent = partes.filter(Boolean).join(' · ');
  }
  function actualizarCampoSocio() {
    const necesitaSocio = ['APORTE_SOCIO', 'RETIRO_SOCIO'].includes(f.clase.value);
    if (campoSocio) campoSocio.style.display = necesitaSocio ? '' : 'none';
    f.querySelectorAll('.caja-chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.clase === f.clase.value)));
    actualizarResumenCampos();
  }
  // Rediseño 2026-09-24: el tipo se elige con chips; el <select name="clase">
  // sigue siendo el valor que viaja (FormData), sin tocar la validación.
  f.querySelectorAll('.caja-chip').forEach(c => c.onclick = () => {
    f.clase.value = c.dataset.clase;
    actualizarCampoSocio();
  });
  f.clase.onchange = actualizarCampoSocio;
  f.metodo.onchange = actualizarResumenCampos;
  f.fecha.onchange = actualizarResumenCampos;
  f.referencia.oninput = actualizarResumenCampos;
  actualizarCampoSocio();

  if (btnMas && camposMas) btnMas.onclick = () => {
    const abierto = camposMas.classList.toggle('abierto');
    btnMas.setAttribute('aria-expanded', String(abierto));
    btnMas.querySelector('.toggle-texto').textContent = abierto ? '▴ Menos campos' : '▾ Más campos';
  };

  f.onsubmit = async e => {
    e.preventDefault();
    // El botón de guardar (los chips y "Más campos" también son <button>,
    // pero type="button": solo el de submit se bloquea).
    const boton = f.querySelector('button:not([type="button"])');
    if (boton) boton.disabled = true; // sin esto, dos toques = dos peticiones
    try {
      const d = Object.fromEntries(new FormData(f));
      d.id = idCapturaCaja(); // el reintento debe ser el MISMO movimiento
      const pin = await pedirPinDireccion();
      const r = await guardarMovimientoDireccion(pin, d);
      soltarCapturaCaja();
      f.reset();
      f.fecha.value = _fechaLocalDireccion_();
      actualizarCampoSocio();
      document.querySelector('#resultado-caja').textContent = r.estado === 'EN_COLA'
        ? 'Guardado en este teléfono. Se enviará solo al volver la conexión (con la app desbloqueada) o al tocar el aviso de pendientes.'
        : 'Movimiento registrado.';
      estado();
    } catch (err) {
      // Solo se suelta el id si el servidor dijo que NO se guardó. Ante un
      // fallo de red no sabemos si llegó, así que se conserva para que el
      // reintento no cuente como un movimiento distinto.
      if (err && err.respondioServidor) soltarCapturaCaja();
      document.querySelector('#resultado-caja').textContent = err.message;
    } finally {
      if (boton) boton.disabled = false;
    }
  };

  _pintarRechazadosCaja_(document.querySelector('#resultado-caja'));
  const lista = document.querySelector('#lista-caja-cuerpo');

  async function refrescarLista(pin) {
    try {
      const movs = await cargarMovimientosCajaDireccion(pin, f.fecha.value || _fechaLocalDireccion_());
      lista.innerHTML = `<h2>Movimientos de hoy</h2>${renderMovimientosCaja(movs)}`;
      lista.querySelectorAll('button.anular').forEach(b => b.onclick = async () => {
        const motivo = prompt('Explica la corrección (mínimo 10 caracteres)');
        if (motivo === null) return;
        try {
          const rAnul = await anularMovimientoDireccion(pin, b.dataset.id, motivo);
          if (rAnul.estado === 'EN_COLA' && typeof toast === 'function') toast('Corrección guardada en este teléfono; se enviará sola al volver la conexión.');
          await refrescarLista(pin);
        } catch (err) {
          if (typeof toast === 'function') toast(err.message); else alert(err.message);
        }
      });
    } catch (err) {
      lista.innerHTML = `<h2>Movimientos de hoy</h2><p>${_escCaja(err.message)}</p>`;
    }
  }

  const verBtn = document.querySelector('#ver-movimientos');
  if (verBtn) verBtn.onclick = async () => {
    try {
      const pin = await pedirPinDireccion();
      refrescarLista(pin);
    } catch (err) {
      // PIN cancelado -- no hacer nada.
    }
  };

  // Si el PIN sigue vigente en memoria (sesión reciente), no tiene sentido
  // que Miguel tenga que tocar "Ver movimientos" y esperar un PIN que ya
  // dio hace un minuto -- se carga sola. Sin PIN vigente, se queda como
  // estaba: pedirlo es cosa de un toque, no de adivinar si vale la pena.
  if (typeof _pinVigente === 'function' && _pinVigente()) {
    pedirPinDireccion().then(refrescarLista).catch(() => {});
  }
}
