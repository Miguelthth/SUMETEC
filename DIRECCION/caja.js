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
<form id="form-caja" class="card"><div class="card-body" style="display:grid;gap:10px">
  <label class="form-label" for="caja-clase">Movimiento
    <select id="caja-clase" name="clase" class="form-select">${CLASES_CAJA_DIRECCION.map(x => `<option value="${x}">${_etiquetaClaseCaja(x)}</option>`).join('')}</select>
  </label>
  <label class="form-label" for="caja-monto">Monto<input id="caja-monto" class="form-control" name="monto" type="number" min="0.01" step="0.01" required></label>
  <label class="form-label" for="caja-concepto">Concepto / explicación<textarea id="caja-concepto" class="form-control" name="concepto" required></textarea></label>
  <button type="button" class="btn-mas-campos" id="btn-mas-campos-caja" aria-expanded="false" aria-controls="campos-mas-caja">
    <span class="toggle-texto">▾ Más campos</span><span class="resumen-campos" id="resumen-campos-caja"></span>
  </button>
  <div class="campos-mas" id="campos-mas-caja">
    <label class="form-label" for="caja-fecha">Fecha<input id="caja-fecha" class="form-control" name="fecha" type="date" required></label>
    <label class="form-label" for="caja-metodo">Método
      <select id="caja-metodo" name="metodo" class="form-select"><option>EFECTIVO</option><option>TRANSFERENCIA</option><option>TARJETA</option></select>
    </label>
    <label class="form-label" for="caja-socio" id="campo-socio">Socio (aporte/retiro)<input id="caja-socio" class="form-control" name="cuentaSocio" value="JOSE MIGUEL"></label>
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

// Hallazgo DIR-K01 (auditoría de ecosistema 2026-09-09): un movimiento
// guardado offline (COLAS.movimientos, arriba) no tenía NINGUNA función que
// lo enviara -- ni un botón manual como el de Compras, ni el evento
// `online`. Se quedaba atorado para siempre, y `_pendientesSinEnviarDireccion_`
// (corte.js) bloqueaba el cierre del corte por una cola que nadie podía
// vaciar desde la app. Mismo patrón que compras.js::enviarComprasCampo: se
// vuelve a leer la cola VIGENTE antes de guardar, por si se capturó algo
// nuevo mientras el envío (uno por uno) estaba en curso.
async function enviarMovimientosDireccion(pin) {
  const url = localStorage.getItem('sumetec_direccion_url');
  if (!url) throw Error('Vincula el teléfono primero');
  const token = await abrirSesionDireccion(pin);
  const cola = leer(COLAS.movimientos);
  const idsEnviados = [];

  for (const mov of cola) {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ ...mov, tipo: 'movimiento_caja', token, origen: 'direccion' })
    }).then(x => x.json());
    // El servidor dedupe por id (registrarMovimientoCaja_): CREADO o
    // YA_EXISTIA son los dos resultados en los que el movimiento YA está
    // registrado y puede salir de la cola.
    if (r.ok && (r.estado === 'CREADO' || r.estado === 'YA_EXISTIA')) idsEnviados.push(mov.id);
  }

  const colaVigente = leer(COLAS.movimientos);
  const pendientes = colaVigente.filter(m => idsEnviados.indexOf(m.id) === -1);
  localStorage.setItem(COLAS.movimientos, JSON.stringify(pendientes));
  estado();
  return pendientes.length;
}

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
let _idCapturaCaja = null;
function idCapturaCaja() {
  if (!_idCapturaCaja) _idCapturaCaja = crypto.randomUUID();
  return _idCapturaCaja;
}
function soltarCapturaCaja() { _idCapturaCaja = null; }

async function guardarMovimientoDireccion(pin, datos) {
  const movimiento = validarMovimientoDireccion(datos);
  const url = localStorage.getItem('sumetec_direccion_url');

  if (!navigator.onLine) {
    const cola = leer(COLAS.movimientos);
    cola.push(movimiento);
    localStorage.setItem(COLAS.movimientos, JSON.stringify(cola));
    estado();
    return { ok: true, estado: 'EN_COLA' };
  }

  const token = await abrirSesionDireccion(pin);
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ ...movimiento, tipo: 'movimiento_caja', token, origen: 'direccion' })
  }).then(x => x.json());
  if (!r.ok) {
    // El servidor SÍ contestó, y contestó que no. Se marca para que quien
    // llama pueda soltar el id: no hay nada guardado que reintentar.
    const e = Error(r.error || 'No se pudo guardar el movimiento');
    e.respondioServidor = true;
    throw e;
  }
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
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ tipo: 'movimientos_del_dia', fecha, token })
  }).then(x => x.json());
  if (!r.ok) throw Error(r.error || 'No se pudieron consultar los movimientos');
  return r.movimientos;
}

async function anularMovimientoDireccion(pin, anulaA, motivo) {
  const { anulaA: id, motivo: m } = validarAnulacionDireccion({ anulaA, motivo });
  const url = localStorage.getItem('sumetec_direccion_url');
  if (!navigator.onLine) throw Error('Se necesita conexión para corregir un movimiento ya enviado');
  const token = await abrirSesionDireccion(pin);
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ tipo: 'anular_movimiento_caja', anulaA: id, motivo: m, token, origen: 'direccion' })
  }).then(x => x.json());
  if (!r.ok) throw Error(r.error || 'No se pudo corregir el movimiento');
  return r;
}

function _dineroCaja(v) { return '$' + Number(v || 0).toFixed(2); }

function renderMovimientosCaja(movs) {
  if (!movs.length) return '<p>Sin movimientos capturados hoy.</p>';
  const filas = movs.map(m => {
    const corregible = !m.anulado && m.tipo !== 'ANULACION';
    const ref = m.tipo === 'ANULACION' ? `corrige ${m.anulaA}` : (m.referencia || m.cuentaSocio || '—');
    const boton = corregible ? `<button type="button" class="anular" data-id="${m.id}">Corregir</button>` : '';
    const clasePos = m.signo === '+' ? 'pos' : 'neg';
    return `<li data-id="${m.id}" class="${m.anulado ? 'anulado' : ''}">` +
      `<div class="mov-info"><div class="mov-linea1">` +
      `<span class="mov-monto ${clasePos}">${m.signo}${_dineroCaja(m.monto)}</span>` +
      `<span class="mov-tipo">${_etiquetaClaseCaja(m.tipo)}</span>` +
      `${m.anulado ? '<span class="mov-anulado-tag">ANULADO</span>' : ''}</div>` +
      `<span class="mov-linea2">${m.metodo} · ${m.hora ? String(m.hora).slice(11, 16) : m.origen} · ${ref}</span>` +
      `</div>${boton}</li>`;
  }).join('');
  return `<ul>${filas}</ul>`;
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
    const partes = [f.metodo.value.toLowerCase()];
    if (campoSocio && campoSocio.style.display !== 'none') partes.push(f.cuentaSocio.value);
    resumenCampos.textContent = partes.filter(Boolean).join(' · ');
  }
  function actualizarCampoSocio() {
    const necesitaSocio = ['APORTE_SOCIO', 'RETIRO_SOCIO'].includes(f.clase.value);
    if (campoSocio) campoSocio.style.display = necesitaSocio ? '' : 'none';
    actualizarResumenCampos();
  }
  f.clase.onchange = actualizarCampoSocio;
  f.metodo.onchange = actualizarResumenCampos;
  f.cuentaSocio.oninput = actualizarResumenCampos;
  actualizarCampoSocio();

  if (btnMas && camposMas) btnMas.onclick = () => {
    const abierto = camposMas.classList.toggle('abierto');
    btnMas.setAttribute('aria-expanded', String(abierto));
    btnMas.querySelector('.toggle-texto').textContent = abierto ? '▴ Menos campos' : '▾ Más campos';
  };

  f.onsubmit = async e => {
    e.preventDefault();
    const boton = f.querySelector('button');
    if (boton) boton.disabled = true; // sin esto, dos toques = dos peticiones
    try {
      const d = Object.fromEntries(new FormData(f));
      d.id = idCapturaCaja(); // el reintento debe ser el MISMO movimiento
      const pin = await pedirPinDireccion();
      const r = await guardarMovimientoDireccion(pin, d);
      soltarCapturaCaja();
      f.reset();
      f.fecha.value = _fechaLocalDireccion_();
      document.querySelector('#resultado-caja').textContent = r.estado === 'EN_COLA'
        ? 'Guardado para enviar cuando vuelva la conexión.'
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

  const lista = document.querySelector('#lista-caja-cuerpo');

  async function refrescarLista(pin) {
    try {
      const movs = await cargarMovimientosCajaDireccion(pin, f.fecha.value || _fechaLocalDireccion_());
      lista.innerHTML = `<h2>Movimientos de hoy</h2>${renderMovimientosCaja(movs)}`;
      lista.querySelectorAll('button.anular').forEach(b => b.onclick = async () => {
        const motivo = prompt('Explica la corrección (mínimo 10 caracteres)');
        if (motivo === null) return;
        try {
          await anularMovimientoDireccion(pin, b.dataset.id, motivo);
          await refrescarLista(pin);
        } catch (err) {
          if (typeof toast === 'function') toast(err.message); else alert(err.message);
        }
      });
    } catch (err) {
      lista.innerHTML = `<h2>Movimientos de hoy</h2><p>${err.message}</p>`;
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
