// Compras -- app propia (F3 del plan de diseño, 2026-09-11), extraída de
// 14.- SUMETEC DIRECCION/compras.js. Mismos campos, mismo orden, misma
// lógica de negocio -- solo cambian las claves de localStorage (para no
// chocar con Dirección si algún día comparten dominio de GitHub Pages) y
// que aquí "el historial reciente" pide su PROPIO dashboard_snapshot (en
// Dirección lo leía del caché que dashboard.js ya había descargado para el
// Resumen; aquí no hay Resumen, así que _actualizarSnapshotCompras_ lo pide
// aparte, ver más abajo).
//
// Mismo backend, sin cambios: el servidor ya autoriza por DISPOSITIVO
// vinculado, no por app (ver apps_script.js::_direccionAutorizada_) -- el
// mismo Apps Script que usa Dirección sirve a Compras con su propio token.

const COLAS = { compras: 'sumetec_compras_cola_compras' };
const $ = s => document.querySelector(s);
const leer = k => JSON.parse(localStorage.getItem(k) || '[]');

// Fecha LOCAL, nunca UTC -- mismo motivo que Dirección (Tijuana UTC-7/-8):
// toISOString() da la fecha en UTC y desde las ~17:00 ya devuelve la de
// MAÑANA. Copiada aquí porque en Dirección vivía en corte.js, que Compras
// no incluye.
function _fechaLocalDireccion_(d) {
  d = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const SITUACIONES_FACTURA_DIRECCION = ['ESPERANDO_FACTURA', 'FACTURADO', 'NO_SE_FACTURARA'];
const EVIDENCIAS_COMPRA_DIRECCION = ['TICKET', 'CFDI', 'FOTO', 'OTRO'];

function nuevaCompraCampo(datos) {
  const id = datos.id || crypto.randomUUID();
  const total = Number(datos.total || 0);
  const pagos = datos.pagos || [];
  if (!datos.proveedor || !datos.fecha || total <= 0) throw Error('Faltan proveedor, fecha o total');

  const suma = pagos.reduce((a, p) => a + Number(p.monto || 0), 0);
  if (suma > total + 0.005) throw Error('Los pagos superan el total');
  if (datos.condicion === 'CONTADO' && Math.abs(suma - total) > 0.005) {
    throw Error('Una compra de contado debe quedar liquidada');
  }
  if (datos.situacionFactura === 'FACTURADO' && !String(datos.uuidCfdi || '').trim()) {
    throw Error('Un documento facturado requiere el UUID del CFDI');
  }

  const compra = {
    ...datos, id,
    situacionFactura: datos.situacionFactura || 'ESPERANDO_FACTURA',
    estado: 'PENDIENTE_ERP'
  };
  const cola = leer(COLAS.compras);
  if (!cola.some(x => x.id === id)) cola.push(compra);
  localStorage.setItem(COLAS.compras, JSON.stringify(cola));
  estado();
  return id;
}

function _pedirEvidenciaCompra_() {
  return new Promise(resolve => {
    const dlg = document.querySelector('#evidencia-modal');
    dlg.returnValue = '';
    const alCerrar = () => { dlg.removeEventListener('close', alCerrar); resolve(dlg.returnValue || 'cancel'); };
    dlg.addEventListener('close', alCerrar);
    dlg.showModal();
  });
}

// Recibo local de cada envío confirmado -- lo que permite mostrar "enviada,
// esperando revisión" antes de que exista otra fuente de verdad (el
// snapshot del ERP, que puede tardar en publicarse). Acotado a las últimas
// MAX_HISTORIAL_COMPRAS: es un historial reciente, no un archivo completo.
const CLAVE_HISTORIAL_COMPRAS = 'sumetec_compras_historial_compras';
const MAX_HISTORIAL_COMPRAS = 30;
const CLAVE_BORRADOR_COMPRA = 'sumetec_compras_borrador';

function _leerBorradorCompra_() {
  try { return JSON.parse(localStorage.getItem(CLAVE_BORRADOR_COMPRA) || 'null'); }
  catch (_) { return null; }
}

function _guardarBorradorCompra_(formulario) {
  const borrador = Object.fromEntries(new FormData(formulario));
  localStorage.setItem(CLAVE_BORRADOR_COMPRA, JSON.stringify(borrador));
}

function _restaurarBorradorCompra_(formulario) {
  const borrador = _leerBorradorCompra_();
  if (!borrador || typeof borrador !== 'object') return false;
  Object.entries(borrador).forEach(([nombre, valor]) => {
    const campo = formulario.elements.namedItem(nombre);
    if (campo && typeof campo.value !== 'undefined') campo.value = valor;
  });
  return true;
}

function _registrarEnvioCompras_(compras) {
  if (!compras || !compras.length) return;
  const historial = leer(CLAVE_HISTORIAL_COMPRAS);
  const ahora = new Date().toISOString();
  compras.forEach(c => {
    const entrada = { id: c.id, proveedor: c.proveedor || '', total: Number(c.total || 0), fechaEnvio: ahora };
    const idx = historial.findIndex(h => h.id === c.id);
    if (idx >= 0) historial.splice(idx, 1);
    historial.unshift(entrada);
  });
  localStorage.setItem(CLAVE_HISTORIAL_COMPRAS, JSON.stringify(historial.slice(0, MAX_HISTORIAL_COMPRAS)));
}

async function enviarComprasCampo(pin) {
  const url = localStorage.getItem('sumetec_compras_url');
  if (!url) throw Error('Vincula el teléfono primero');
  const token = await abrirSesionDireccion(pin);
  const cola = leer(COLAS.compras);
  const idsEnviados = [];
  const enviadasOk = [];

  for (const compra of cola) {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ ...compra, tipo: 'compra_campo', token })
    }).then(x => x.json());
    if (r.ok && (r.estado === 'CREADO' || r.estado === 'YA_EXISTIA')) {
      idsEnviados.push(compra.id);
      enviadasOk.push(compra);
    }
  }

  // No sobrescribir con la foto de `cola`: mientras el envío estaba en curso
  // (fetch por compra, uno por uno) se pudo haber guardado una compra nueva.
  // Se vuelve a leer la cola vigente y solo se quitan los ids que de verdad
  // se confirmaron (H-01, hallazgo 2026-09-09 de Dirección, aplica igual aquí).
  const colaVigente = leer(COLAS.compras);
  const pendientes = colaVigente.filter(c => idsEnviados.indexOf(c.id) === -1);
  localStorage.setItem(COLAS.compras, JSON.stringify(pendientes));
  _registrarEnvioCompras_(enviadasOk);
  estado();
  return pendientes.length;
}

// ── Historial reciente ──────────────────────────────────────────────────
// Tres estados posibles por compra: PENDIENTE_ENVIO (sigue en la cola local,
// nunca tocó el servidor), ESPERANDO_REVISION (se mandó -- hay recibo local
// -- pero la última fotografía del ERP no la reporta IMPORTADO, o no hay
// fotografía todavía) e IMPORTADO (el snapshot SÍ la reporta integrada).
// Puro y testable: recibe la cola, el historial y el caché de snapshot ya
// leídos, no toca localStorage ni el DOM.
function _historialComprasDireccion_(cola, historialEnviadas, snapshotCache) {
  const recientesERP = (snapshotCache && snapshotCache.snapshot && snapshotCache.snapshot.comprasRecientes) || [];
  const porId = new Map(recientesERP.map(r => [r.id, r]));
  const snapshotTs = snapshotCache ? snapshotCache.ts : '';

  const pendientes = (cola || []).map(c => ({
    id: c.id, proveedor: c.proveedor || '', total: Number(c.total || 0),
    estado: 'PENDIENTE_ENVIO', fecha: '', snapshotTs: '',
  }));

  const enviadas = (historialEnviadas || []).map(h => {
    const erp = porId.get(h.id);
    return {
      id: h.id, proveedor: h.proveedor || '', total: Number(h.total || 0),
      estado: erp ? erp.estado : 'ESPERANDO_REVISION',
      fecha: erp ? erp.actualizadoEn : h.fechaEnvio,
      snapshotTs,
    };
  });

  return pendientes.concat(enviadas);
}

function _badgeEstadoCompraDireccion_(estado) {
  if (estado === 'PENDIENTE_ENVIO') return '⏳ Pendiente de envío';
  if (estado === 'IMPORTADO') return '✅ Integrada en el ERP';
  return '📨 Enviada, esperando revisión';
}

function _htmlHistorialComprasDireccion_(items) {
  if (!items.length) return '<p class="vacio">Sin compras recientes.</p>';
  const filas = items.map(it => `<li class="historial-item">
    <span class="proveedor">${it.proveedor || '(sin proveedor)'}</span>
    <span class="total">$${it.total.toFixed(2)}</span>
    <span class="badge">${_badgeEstadoCompraDireccion_(it.estado)}</span>
    ${it.fecha ? `<small class="fecha">${String(it.fecha).replace('T', ' ')}</small>` : ''}
  </li>`).join('');
  // La leyenda dice explícitamente de cuándo es el estado del ERP -- nunca se
  // presenta como "así está ahora mismo" si el snapshot ya lleva rato viejo.
  const primeraConTs = items.find(it => it.snapshotTs);
  const leyenda = primeraConTs
    ? `<p class="leyenda">Estado del ERP según el último resumen (${String(primeraConTs.snapshotTs).replace('T', ' ')}).</p>`
    : '<p class="leyenda">Aún no se ha podido consultar el ERP en este teléfono.</p>';
  return leyenda + `<ul class="historial-compras">${filas}</ul>`;
}

function _leerSnapshotCacheDireccion_() {
  try { return JSON.parse(localStorage.getItem('sumetec_compras_snapshot_cache') || 'null'); }
  catch (_) { return null; }
}

function _renderHistorialComprasDireccion_() {
  const el = document.querySelector('#historial-compras');
  if (!el) return;
  const items = _historialComprasDireccion_(leer(COLAS.compras), leer(CLAVE_HISTORIAL_COMPRAS), _leerSnapshotCacheDireccion_());
  el.innerHTML = _htmlHistorialComprasDireccion_(items);
}

// Compras no tiene un Resumen propio (esa pantalla se quedó en Dirección) --
// pide su propio dashboard_snapshot para poder mostrar el historial
// reciente. Best-effort: si falla, el historial simplemente se queda con lo
// que ya haya en caché (o vacío la primera vez); nunca bloquea la pantalla.
// ── Mejora 7 (2026-09-23): proveedores y productos sugeridos ───────────────
// Proveedores: los del ERP + los escritos en campo por cualquier teléfono
// (tipo listas_gasto). Productos: el catálogo del ERP (tipo catalogo). Todo se
// cachea para funcionar sin señal; un proveedor nuevo escrito aquí se recuerda
// en este teléfono al guardar, y al llegar al ERP se da de alta al confirmar.
const CLAVE_LISTAS_COMPRAS = 'sumetec_compras_listas_cache';
function _leerListasCompras_() {
  try { return JSON.parse(localStorage.getItem(CLAVE_LISTAS_COMPRAS) || 'null') || { proveedores: [], productos: [] }; }
  catch (_) { return { proveedores: [], productos: [] }; }
}
function _pintarListasCompras_() {
  const l = _leerListasCompras_();
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const dlp = document.getElementById('dl-proveedores-compra');
  if (dlp) dlp.innerHTML = l.proveedores.map(p => `<option value="${esc(p)}">`).join('');
  const dlc = document.getElementById('dl-productos-compra');
  if (dlc) dlc.innerHTML = l.productos.map(p => `<option value="${esc(p.c)}">${esc(p.d)}</option>`).join('');
}
function _recordarProveedorCompra_(nombre) {
  nombre = String(nombre || '').replace(/\s+/g, ' ').trim();
  if (!nombre) return;
  const l = _leerListasCompras_();
  if (l.proveedores.some(p => p.toLowerCase() === nombre.toLowerCase())) return;
  l.proveedores.push(nombre);
  l.proveedores.sort((a, b) => a.localeCompare(b, 'es'));
  localStorage.setItem(CLAVE_LISTAS_COMPRAS, JSON.stringify(l));
  _pintarListasCompras_();
}
function _equivalenciaCompra_(proveedor, codigoProv) {
  const p = String(proveedor || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const c = String(codigoProv || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!p || !c) return null;
  return (_leerListasCompras_().equivalencias || []).find(e => e.p === p && e.c === c) || null;
}
function _codigoCompraElegido_(input) {
  const li = input.closest('li');
  const prov = (document.getElementById('compra-proveedor') || {}).value;
  const eq = _equivalenciaCompra_(prov, input.value);
  if (eq && li) {
    // Código del proveedor conocido: se traduce al mío y se recuerda el factor.
    li.dataset.cprov = String(input.value).trim();
    li.dataset.factor = String(eq.f);
    input.value = eq.m;
    const d = li.querySelector('.descripcion');
    const prod = _leerListasCompras_().productos.find(x => String(x.c).toLowerCase() === String(eq.m).toLowerCase());
    if (d && !d.value) d.value = (prod && prod.d) || eq.d || '';
    const aviso = li.querySelector('.aviso-matriz') || li.appendChild(Object.assign(document.createElement('div'), { className: 'aviso-matriz text-success', style: 'font-size:11px;grid-column:1/-1' }));
    aviso.textContent = eq.f !== 1
      ? `✓ Traducido por matriz: cantidad y costo son del proveedor; se convierten ×${eq.f} al guardar.`
      : '✓ Traducido por matriz.';
    return;
  }
  if (li) { delete li.dataset.factor; delete li.dataset.cprov; const a = li.querySelector('.aviso-matriz'); if (a) a.remove(); }
  const cod = String(input.value || '').trim().toLowerCase();
  const p = _leerListasCompras_().productos.find(x => String(x.c).toLowerCase() === cod);
  const desc = input.closest('li') && input.closest('li').querySelector('.descripcion');
  if (p && desc && !desc.value) desc.value = p.d;
  // 9c: código que no es mío ni está en la matriz de este proveedor -> ofrecer vincularlo.
  if (li && cod && !p && String(prov || '').trim()) {
    const box = li.querySelector('.aviso-matriz') || li.appendChild(Object.assign(document.createElement('div'), { className: 'aviso-matriz', style: 'font-size:12px;grid-column:1/-1' }));
    box.className = 'aviso-matriz text-warning-emphasis';
    box.innerHTML = '';
    box.append('Este código no está en tu catálogo ni en la matriz. ');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-outline-secondary btn-sm';
    b.textContent = '➕ Vincular o registrar';
    b.onclick = () => _abrirEquivalenciaCompra_(li);
    box.appendChild(b);
  }
}

// ── Mejora 9c: vincular/registrar desde Compras ─────────────────────────────
// <<MEDIDAS
// Mejora 9d: medidas de tornillería a partir de la descripción -- COPIA en JavaScript de
// 1.- SUMETEC-PY-SQL/services/medidas.py (mismas reglas, mismos casos de prueba:
// tests/medidas_vectores.json). Si cambias una regla, cámbiala en las dos.
const _MED_TIPOS = [['pija', ['pija', 'pijas']], ['tirafondo', ['tirafondo', 'tirafondos']],
  ['tornillo', ['tornillo', 'tornillos', 'tor']], ['perno', ['perno', 'pernos', 'birlo', 'birlos', 'esparrago', 'esparragos']],
  ['tuerca', ['tuerca', 'tuercas']], ['rondana', ['rondana', 'rondanas', 'arandela', 'arandelas']],
  ['taquete', ['taquete', 'taquetes', 'ancla', 'anclas']], ['remache', ['remache', 'remaches']],
  ['clavo', ['clavo', 'clavos']], ['broca', ['broca', 'brocas']]];
const _MED_CABEZAS = [['hex', ['hexagonal', 'hex']], ['allen', ['allen', 'socket', 'hueco']],
  ['phillips', ['phillips', 'philips', 'ph', 'cruz']], ['torx', ['torx']], ['boton', ['boton', 'button']],
  ['plana', ['plana', 'avellanada']], ['redonda', ['redonda', 'pan', 'bola']]];
const _MED_MATERIALES = [['inox', ['inoxidable', 'inox', 'ss', '304', '316']], ['laton', ['laton']],
  ['aluminio', ['aluminio']], ['nylon', ['nylon', 'nailon']], ['acero', ['acero']]];
const _MED_ACABADOS = [['zinc', ['zinc', 'zincado', 'zincada']], ['galvanizado', ['galvanizado', 'galvanizada', 'galv']],
  ['negro', ['negro', 'negra', 'pavonado', 'pavonada']], ['cromado', ['cromado', 'cromada']],
  ['fosfatado', ['fosfatado', 'fosfatada']], ['natural', ['natural', 'pulido']]];
const _MED_NUM = '(?:\\d+\\s*-\\s*\\d+/\\d+|\\d+/\\d+|\\d+(?:[.,]\\d+)?)';
const _MED_UNI = '(?:"|mm\\b|cm\\b|in\\b|pulg\\w*)';
const _MED_DIM = new RegExp(`(?<d>${_MED_NUM})\\s*(?<du>${_MED_UNI})?\\s*(?:x|por)\\s*(?<l>${_MED_NUM})\\s*(?<lu>${_MED_UNI})?`);
const _MED_METRICA = /\bm\s?(\d+(?:[.,]\d+)?)\b/;
const _MED_LARGO_X = new RegExp(`\\bx\\s*(?<l>${_MED_NUM})\\s*(?<lu>${_MED_UNI})?`);
const _MED_CALIBRE = /(?:#|\bno\.?\s*)(\d{1,2})\b/;
const _MED_SOLO_PULG = new RegExp(`(?<d>${_MED_NUM})\\s*(?:"|in\\b|pulg\\w*)`);
const _MED_SOLO_MM = /(?<d>\d+(?:[.,]\d+)?)\s*mm\b/;
const _MED_SOLO_FRAC = /(?<![\d/.])(?<d>\d+\s*-\s*\d+\/\d+|\d+\/\d+)(?![\d/])/;
const _MED_PULG = 25.4;

function _medNorm(texto) {
  let t = String(texto || '').replace(/×/g, 'x').replace(/″/g, '"').replace(/”/g, '"').replace(/“/g, '"').replace(/''/g, '"');
  t = t.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase();
  return t.replace(/\s+/g, ' ').trim();
}
function _medNum(tok) {
  tok = tok.replace(/ /g, '').replace(/,/g, '.');
  if (tok.includes('-') && tok.includes('/')) { const [e, f] = tok.split('-'); const [a, b] = f.split('/'); return Number(e) + Number(a) / Number(b); }
  if (tok.includes('/')) { const [a, b] = tok.split('/'); return Number(a) / Number(b); }
  return Number(tok);
}
function _medMm(v, u) { return u === 'cm' ? v * 10 : (u === 'mm' ? v : v * _MED_PULG); }
function _medUni(u) { if (!u) return null; if (u.startsWith('mm')) return 'mm'; if (u.startsWith('cm')) return 'cm'; return 'in'; }
function _medDesde(re, t, pos) { const g = new RegExp(re.source, 'g'); g.lastIndex = pos; return g.exec(t); }
function _medR2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
function _medBuscar(t, tabla) {
  const palabras = new Set(t.match(/[a-z0-9]+/g) || []);
  for (const [nombre, claves] of tabla) if (claves.some(c => palabras.has(c))) return nombre;
  return null;
}
function _medRosca(t) {
  if (/\bunc\b|\bnc\b/.test(t)) return 'UNC';
  if (/\bunf\b|\bnf\b/.test(t)) return 'UNF';
  const m = t.match(/(\d+)\s*(?:hilos|hpp|tpi)/);
  return m ? `${m[1]}h` : null;
}
function _medGrado(t) {
  let m = t.match(/\bg(?:rado)?\s?(2|5|8)\b/) || t.match(/\bsae\s?(2|5|8)\b/);
  if (m) return 'G' + m[1];
  m = t.match(/\b(a307|a325|a490)\b/);
  if (m) return m[1].toUpperCase();
  m = t.match(/\b(8\.8|10\.9|12\.9)\b/);
  return m ? m[1] : null;
}
function extraerMedidas(descripcion) {
  const t = _medNorm(descripcion);
  const out = { tipo: _medBuscar(t, _MED_TIPOS), cabeza: _medBuscar(t, _MED_CABEZAS), diametro_mm: null, largo_mm: null,
    rosca: _medRosca(t), grado: _medGrado(t), material: _medBuscar(t, _MED_MATERIALES), acabado: _medBuscar(t, _MED_ACABADOS) };
  const m = t.match(_MED_DIM);
  if (m) {
    const dtok = m.groups.d, ltok = m.groups.l;
    const du = _medUni(m.groups.du), lu = _medUni(m.groups.lu);
    const dIn = dtok.includes('/'), lIn = ltok.includes('/');
    const ud = du || (dIn ? 'in' : (lu || 'mm'));
    const ul = lu || (lIn ? 'in' : (du || (dIn ? 'in' : 'mm')));
    out.diametro_mm = _medR2(_medMm(_medNum(dtok), ud));
    out.largo_mm = _medR2(_medMm(_medNum(ltok), ul));
    const pre = t.slice(0, m.index);
    if (/(?:#|\bno\.?)\s*$/.test(pre)) out.diametro_mm = _medR2((0.060 + 0.013 * _medNum(dtok)) * _MED_PULG);
  } else {
    const mm = t.match(_MED_METRICA), cal = t.match(_MED_CALIBRE);
    if (mm) {
      out.diametro_mm = _medR2(_medNum(mm[1]));
      const lx = _medDesde(_MED_LARGO_X, t, mm.index + mm[0].length);
      if (lx) out.largo_mm = _medR2(_medMm(_medNum(lx.groups.l), _medUni(lx.groups.lu) || 'mm'));
    } else if (cal) {
      out.diametro_mm = _medR2((0.060 + 0.013 * Number(cal[1])) * _MED_PULG);
      const lx = _medDesde(_MED_LARGO_X, t, cal.index + cal[0].length);
      if (lx) out.largo_mm = _medR2(_medMm(_medNum(lx.groups.l), _medUni(lx.groups.lu) || 'in'));
    } else {
      const sp = t.match(_MED_SOLO_PULG);
      if (sp) out.diametro_mm = _medR2(_medMm(_medNum(sp.groups.d), 'in'));
      else {
        const sm = t.match(_MED_SOLO_MM), sf = t.match(_MED_SOLO_FRAC);
        if (sm) out.diametro_mm = _medR2(_medNum(sm.groups.d));
        else if (sf) out.diametro_mm = _medR2(_medMm(_medNum(sf.groups.d), 'in'));
      }
    }
  }
  return out;
}
const _MED_PESOS = { tipo: 3, diametro_mm: 3, largo_mm: 2, cabeza: 1, rosca: 1, grado: 1.5, material: 1, acabado: 0.5 };
function _medIguales(campo, a, b) {
  if (campo === 'diametro_mm') return Math.abs(a - b) <= Math.max(0.15, 0.02 * Math.max(a, b));
  if (campo === 'largo_mm') return Math.abs(a - b) <= Math.max(0.6, 0.015 * Math.max(a, b));
  return a === b;
}
function similitudMedidas(a, b) {
  let ok = 0, mal = 0, desc = 0;
  for (const [campo, peso] of Object.entries(_MED_PESOS)) {
    const x = a[campo], y = b[campo];
    if (x == null || y == null) desc += peso * 0.35;
    else if (_medIguales(campo, x, y)) ok += peso;
    else if (campo === 'tipo' || campo === 'diametro_mm' || campo === 'largo_mm') return 0;
    else mal += peso * 1.5;
  }
  if (ok === 0) return 0;
  return Math.round(ok / (ok + mal + desc) * 1000) / 1000;
}
function sugerirPorMedidas(descripcion, productos, n = 3, minimo = 0.55) {
  const ref = extraerMedidas(descripcion);
  if (ref.diametro_mm == null && ref.tipo == null) return [];
  return productos.map(p => ({ codigo: p.c, descripcion: p.d, score: similitudMedidas(ref, extraerMedidas(p.d)) }))
    .filter(r => r.score >= minimo).sort((a, b) => b.score - a.score || (a.codigo < b.codigo ? -1 : 1)).slice(0, n);
}
// MEDIDAS>>

const CLAVE_COLA_EQUIV = 'sumetec_compras_cola_equiv';
let _eqLinea = null;
function _leerColaEquiv_() { try { return JSON.parse(localStorage.getItem(CLAVE_COLA_EQUIV) || '[]'); } catch (_) { return []; } }
function _abrirEquivalenciaCompra_(li) {
  _eqLinea = li;
  const d = document.getElementById('eq-modal');
  document.getElementById('eq-cprov').value = li.querySelector('.codigo').value.trim();
  document.getElementById('eq-mio').value = '';
  document.getElementById('eq-nuevo').checked = false;
  document.getElementById('eq-desc').value = li.querySelector('.descripcion').value.trim();
  document.getElementById('eq-factor').value = '1';
  document.getElementById('eq-error').textContent = '';
  _eqMioCambio_();
  _eqSugerir_(li);
  d.showModal();
}
function _eqSugerir_(li) {
  const box = document.getElementById('eq-sugerencias');
  if (!box) return;
  box.innerHTML = '';
  // La descripción del renglón es la que trae la factura del proveedor.
  const desc = (li.querySelector('.descripcion').value || '') + ' ' + (li.querySelector('.codigo').value || '');
  const sug = sugerirPorMedidas(desc, _leerListasCompras_().productos);
  if (!sug.length) return;
  box.append('¿Será…? (por medidas) ');
  sug.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-outline-secondary btn-sm'; b.style.margin = '2px 4px 2px 0';
    b.textContent = `${s.codigo} · ${Math.round(s.score * 100)}%`;
    b.title = s.descripcion;
    b.onclick = () => { document.getElementById('eq-mio').value = s.codigo; _eqMioCambio_(); };
    box.appendChild(b);
  });
}
function _eqMioCambio_() {
  const mio = document.getElementById('eq-mio').value.trim().toLowerCase();
  const nuevo = document.getElementById('eq-nuevo').checked;
  const p = _leerListasCompras_().productos.find(x => String(x.c).toLowerCase() === mio);
  document.getElementById('eq-desc-wrap').style.display = nuevo ? '' : 'none';
  document.getElementById('eq-mio-ayuda').textContent = !mio ? '' : (p ? `✓ ${p.d}` : (nuevo ? 'Se creará como producto nuevo.' : 'No está en tu catálogo: elige uno de la lista o marca "producto nuevo".'));
}
async function _guardarEquivalenciaCompra_() {
  const err = document.getElementById('eq-error');
  const prov = (document.getElementById('compra-proveedor') || {}).value || '';
  const cprov = document.getElementById('eq-cprov').value.trim();
  const mio = document.getElementById('eq-mio').value.trim();
  const nuevo = document.getElementById('eq-nuevo').checked;
  const desc = document.getElementById('eq-desc').value.trim();
  const factor = Number(document.getElementById('eq-factor').value);
  const l = _leerListasCompras_();
  const existe = l.productos.some(x => String(x.c).toLowerCase() === mio.toLowerCase());
  if (!mio) { err.textContent = 'Escribe tu código.'; return; }
  if (!(factor > 0)) { err.textContent = 'El factor debe ser mayor que 0.'; return; }
  if (nuevo && existe) { err.textContent = 'Ese código ya existe: desmarca "producto nuevo".'; return; }
  if (nuevo && !desc) { err.textContent = 'Escribe la descripción del producto nuevo.'; return; }
  if (!nuevo && !existe) { err.textContent = 'Ese código no está en tu catálogo: elige uno de la lista o marca "producto nuevo".'; return; }
  const par = { id: crypto.randomUUID(), proveedor: String(prov).replace(/\s+/g, ' ').trim(), codigoProveedor: cprov,
                codigo: mio, factor, productoNuevo: nuevo, descripcionNueva: nuevo ? desc : '', descripcionProveedor: '' };
  // Efecto inmediato en ESTE teléfono (los demás lo ven cuando llegue a Drive).
  _aplicarParLocal_(par);
  const cola = _leerColaEquiv_(); cola.push(par);
  localStorage.setItem(CLAVE_COLA_EQUIV, JSON.stringify(cola));
  document.getElementById('eq-modal').close();
  if (_eqLinea) { const inp = _eqLinea.querySelector('.codigo'); inp.value = cprov; _codigoCompraElegido_(inp); }
  pedirPinDireccion().then(pin => _enviarColaEquiv_(pin)).catch(() => {});
}
function _aplicarParLocal_(par) {
  const l = _leerListasCompras_();
  const norm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  l.equivalencias = (l.equivalencias || []).filter(e => !(e.p === norm(par.proveedor) && e.c === norm(par.codigoProveedor)));
  l.equivalencias.push({ p: norm(par.proveedor), c: norm(par.codigoProveedor), m: par.codigo, f: par.factor, d: par.descripcionProveedor || '' });
  if (par.productoNuevo && !l.productos.some(x => String(x.c).toLowerCase() === par.codigo.toLowerCase())) {
    l.productos.push({ c: par.codigo, d: par.descripcionNueva });
  }
  localStorage.setItem(CLAVE_LISTAS_COMPRAS, JSON.stringify(l));
  _pintarListasCompras_();
}
async function _enviarColaEquiv_(pin) {
  const url = localStorage.getItem('sumetec_compras_url');
  let cola = _leerColaEquiv_();
  if (!url || !cola.length || !navigator.onLine) return;
  try {
    const token = await abrirSesionDireccion(pin);
    for (const par of [...cola]) {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ tipo: 'registrar_equivalencia_campo', token, ...par }) }).then(x => x.json());
      if (r && r.ok) {
        cola = cola.filter(x => x.id !== par.id);
        localStorage.setItem(CLAVE_COLA_EQUIV, JSON.stringify(cola));
      }
    }
  } catch (_) { /* se reintenta al abrir la app o al actualizar listas */ }
}
async function _actualizarListasCompras_(pin) {
  const url = localStorage.getItem('sumetec_compras_url');
  if (!url || !navigator.onLine) { _pintarListasCompras_(); return; }
  try {
    const token = await abrirSesionDireccion(pin);
    const pedir = tipo => fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ tipo, token }) }).then(x => x.json());
    const [listas, catalogo, equivs] = await Promise.all([pedir('listas_gasto'), pedir('catalogo'), pedir('equivalencias')]);
    const previa = _leerListasCompras_();
    const out = { ts: Date.now(), proveedores: previa.proveedores, productos: previa.productos };
    if (Array.isArray(listas)) {
      const vistos = new Set();
      out.proveedores = listas.filter(f => String(f.CLASE || '').toUpperCase() === 'PROVEEDOR')
        .map(f => String(f.NOMBRE || '').trim()).filter(n => n && !vistos.has(n.toLowerCase()) && vistos.add(n.toLowerCase()))
        .sort((a, b) => a.localeCompare(b, 'es'));
    }
    if (Array.isArray(catalogo)) {
      out.productos = catalogo.map(f => ({ c: String(f.CODIGO || '').trim(), d: String(f.DESCRIPCION || '').trim() })).filter(p => p.c);
    }
    out.equivalencias = previa.equivalencias || [];
    if (Array.isArray(equivs)) {
      const norm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
      out.equivalencias = equivs.map(f => ({
        p: norm(f.PROVEEDOR), c: norm(f.CODIGO_PROVEEDOR), m: String(f.CODIGO || '').trim(),
        f: Number(f.FACTOR) > 0 ? Number(f.FACTOR) : 1, d: String(f.DESCRIPCION_PROVEEDOR || '').trim()
      })).filter(e => e.p && e.c && e.m);
    }
    localStorage.setItem(CLAVE_LISTAS_COMPRAS, JSON.stringify(out));
    _enviarColaEquiv_(pin).then(() => _leerColaEquiv_().forEach(_aplicarParLocal_));
  } catch (_) { /* sin señal o sin permiso: se queda la última copia */ }
  _pintarListasCompras_();
}

async function _actualizarSnapshotCompras_(pin) {
  const url = localStorage.getItem('sumetec_compras_url');
  if (!url) return;
  try {
    const token = await abrirSesionDireccion(pin);
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ tipo: 'dashboard_snapshot', token })
    }).then(x => x.json());
    if (r && r.ok) {
      localStorage.setItem('sumetec_compras_snapshot_cache',
        JSON.stringify({ ts: new Date().toISOString(), snapshot: r.snapshot }));
      _renderHistorialComprasDireccion_();
    }
  } catch (_) { /* best-effort -- el historial se queda con lo que ya había */ }
}

function _filaLineaCompra() {
  return `<li class="linea">
    <input placeholder="Código" aria-label="Código del producto" class="codigo form-control mono" list="dl-productos-compra" onchange="_codigoCompraElegido_(this)">
    <input placeholder="Descripción" aria-label="Descripción del producto" class="descripcion form-control">
    <input placeholder="Cant." aria-label="Cantidad" type="number" min="0" step="0.01" class="cantidad form-control">
    <input placeholder="Costo" aria-label="Costo unitario" type="number" min="0" step="0.01" class="costo form-control">
    <button type="button" aria-label="Eliminar línea" class="quitar btn btn-outline-secondary"><i class="bi bi-x-lg"></i></button>
  </li>`;
}

function _filaPagoCompra() {
  return `<li class="pago">
    <input placeholder="Fecha" aria-label="Fecha del pago" type="date" class="fecha form-control">
    <input placeholder="Monto" aria-label="Monto del pago" type="number" min="0.01" step="0.01" class="monto form-control">
    <select aria-label="Método de pago" class="metodo form-select"><option>EFECTIVO</option><option>TRANSFERENCIA</option><option>TARJETA</option><option>CHEQUE</option></select>
    <button type="button" aria-label="Eliminar pago" class="quitar btn btn-outline-secondary"><i class="bi bi-x-lg"></i></button>
  </li>`;
}

function _leerLineasCompra(ul) {
  return [...ul.querySelectorAll('li.linea')].map(li => {
    const cantidad = Number(li.querySelector('.cantidad').value) || 0;
    const costo = Number(li.querySelector('.costo').value) || 0;
    const linea = {
      codigo: li.querySelector('.codigo').value.trim(),
      descripcion: li.querySelector('.descripcion').value.trim(),
      cantidad, costoUnitario: costo
    };
    // 9b: si el código se tradujo con la matriz (data-factor), el renglón viaja
    // ya en piezas propias: cantidad x factor, costo / factor (el total no cambia).
    const factor = Number(li.dataset.factor) || 0;
    if (factor > 0 && factor !== 1) {
      linea.cantidad = cantidad * factor;
      linea.costoUnitario = Math.round(costo / factor * 10000) / 10000;
    }
    if (factor > 0) { linea.porMatriz = true; linea.codigoProveedor = li.dataset.cprov || ''; }
    return linea;
  }).filter(l => l.codigo || l.descripcion);
}

function _leerPagosCompra(ul) {
  return [...ul.querySelectorAll('li.pago')].map(li => ({
    id: crypto.randomUUID(),
    fecha: li.querySelector('.fecha').value,
    monto: Number(li.querySelector('.monto').value) || 0,
    metodo: li.querySelector('.metodo').value
  })).filter(p => p.monto > 0);
}

function formularioComprasDireccion() {
  return `<h1>Compras</h1>
<p class="text-muted">Queda "Pendiente de ERP" hasta que se revise e importe -- no mueve el stock teórico.</p>
<div class="compras-tabs" role="tablist" aria-label="Sección">
  <button type="button" class="compras-tab activa" data-panel="capturar" role="tab" aria-selected="true">Capturar</button>
  <button type="button" class="compras-tab" data-panel="historial" role="tab" aria-selected="false">Historial</button>
</div>
<div id="panel-capturar" class="compras-panel">
<form id="form-compra" class="card"><div class="card-body compras-form-grid">
  <div class="compras-campos">
    <div class="compras-foto-cta">
      <label class="btn btn-primary btn-bloque compras-foto-btn" for="compra_foto"><i class="bi bi-camera"></i> Tomar foto del ticket</label>
      <input type="file" id="compra_foto" class="visually-oculto" accept="image/*" capture="environment" onchange="_onFotoCompraElegida_()">
      <label class="btn btn-outline-secondary btn-bloque" for="compra_archivo" style="margin-top:6px"><i class="bi bi-paperclip"></i> Elegir archivo (foto, HEIC o PDF)</label>
      <input type="file" id="compra_archivo" class="visually-oculto" accept="image/*,.heic,.heif,application/pdf" onchange="_archivoCompraElegido_()">
      <p class="text-muted" style="font-size:12px;margin:6px 0 0">La IA llena proveedor, fecha, subtotal, IVA y total -- tú los revisas.</p>
      <img id="compraFotoPreview" style="display:none;max-height:160px;border-radius:var(--sm-r-sm);margin-top:8px;object-fit:contain">
      <!-- Sin ícono: _onFotoCompraElegida_/_leerTicketCompraConIA_ (abajo) fijan
           el texto completo del botón con .textContent -- un ícono aquí
           desaparecería en cuanto cualquiera de esas dos lo tocara. -->
      <button id="compraBtnOcr" type="button" class="btn btn-primary" style="width:100%;margin-top:8px;display:none" onclick="_leerTicketCompraConIA_()">🔍 Leer ticket</button>
      <div id="compraOcrEstado" class="text-muted" style="font-size:12px;margin-top:4px"></div>
    </div>
    <label class="form-label" for="compra-proveedor">Proveedor<input id="compra-proveedor" class="form-control" name="proveedor" required list="dl-proveedores-compra" autocomplete="off"><datalist id="dl-proveedores-compra"></datalist><datalist id="dl-productos-compra"></datalist></label>
    <label class="form-label" for="compra-fecha">Fecha<input id="compra-fecha" class="form-control" name="fecha" type="date" required></label>
    <details id="mas-campos-compra" class="compras-detalles">
      <summary>Más campos<span class="compras-detalles-resumen">Folio · Evidencia · Factura · UUID</span></summary>
      <div class="compras-detalles-body">
        <label class="form-label" for="compra-folio">Folio del proveedor<input id="compra-folio" class="form-control mono" name="folio"></label>
        <label class="form-label" for="compra-evidencia">Evidencia
          <select id="compra-evidencia" name="evidencia" class="form-select">${EVIDENCIAS_COMPRA_DIRECCION.map(x => `<option>${x}</option>`).join('')}</select>
        </label>
        <label class="form-label" for="compra-situacion">Situación de factura
          <select id="compra-situacion" name="situacionFactura" class="form-select">${SITUACIONES_FACTURA_DIRECCION.map(x => `<option>${x}</option>`).join('')}</select>
        </label>
        <label class="form-label" id="compra-uuid-wrap" for="compra-uuid" style="display:none">UUID CFDI (documento facturado)<input id="compra-uuid" class="form-control mono" name="uuidCfdi"></label>
      </div>
    </details>
    <details class="compras-detalles">
      <summary>Líneas<span class="compras-detalles-resumen">opcional, se revisan en el ERP</span></summary>
      <div class="compras-detalles-body">
        <ul id="lineas-compra"></ul>
        <button type="button" id="agregar-linea" class="btn btn-outline-secondary"><i class="bi bi-plus-lg"></i> Agregar línea</button>
      </div>
    </details>
    <details class="compras-detalles">
      <summary>Pagos<span class="compras-detalles-resumen">si ya se pagó algo desde el cajón</span></summary>
      <div class="compras-detalles-body">
        <ul id="pagos-compra"></ul>
        <button type="button" id="agregar-pago" class="btn btn-outline-secondary"><i class="bi bi-plus-lg"></i> Agregar pago</button>
      </div>
    </details>
  </div>
  <div class="compras-resumen">
    <label class="form-label" for="compra-subtotal">Subtotal<input id="compra-subtotal" class="form-control compras-monto" name="subtotal" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required></label>
    <div class="compras-iva-chips" role="group" aria-label="Calcular IVA sobre el subtotal">
      <span class="compras-iva-etiqueta">IVA</span>
      <button type="button" class="compras-chip" data-pct="0.16" aria-pressed="false">16%</button>
      <button type="button" class="compras-chip" data-pct="0.08" aria-pressed="false">8%</button>
      <button type="button" class="compras-chip" data-pct="0" aria-pressed="false">0%</button>
    </div>
    <div class="compras-importes">
      <label class="form-label" for="compra-iva">IVA en pesos<input id="compra-iva" class="form-control" name="iva" type="number" min="0" step="0.01" inputmode="decimal" value="0"></label>
      <label class="form-label" for="compra-total">Total<input id="compra-total" class="form-control" name="total" type="number" min="0.01" step="0.01" inputmode="decimal" required></label>
    </div>
    <div class="compras-condicion" role="group" aria-label="Condición">
      <button type="button" class="compras-seg" data-condicion="CREDITO" aria-pressed="true">Crédito</button>
      <button type="button" class="compras-seg" data-condicion="CONTADO" aria-pressed="false">Contado</button>
    </div>
    <select id="compra-condicion" name="condicion" class="form-select sm-oculto" aria-hidden="true" tabindex="-1"><option>CREDITO</option><option>CONTADO</option></select>
    <div id="compras-pagado-resta" class="text-muted" style="font-size:12px"></div>
    <div class="compras-barra-guardar">
      <div class="compras-barra-total" aria-live="polite"><strong id="compras-total-vivo">$0.00</strong><span id="compras-desglose-vivo">Captura subtotal e IVA</span></div>
      <button class="btn btn-success"><i class="bi bi-check-circle"></i> Guardar</button>
    </div>
  </div>
</div></form>
<p id="resultado-compra" class="text-muted" role="status"></p>
</div>
<div id="panel-historial" class="compras-panel" hidden>
<section aria-label="Historial reciente de compras" class="card"><div class="card-body">
  <div id="historial-compras"></div>
</div></section>
</div>`;
}

// Rediseño 2026-09-24: "Enviar compras pendientes" vive en el menú ⋮ (y el
// chip de estado lo dispara también); aquí solo se refleja cuántas hay.
function _actualizarBotonEnviar_() {
  const btn = document.querySelector('#enviar-compras');
  if (!btn) return;
  const pendientes = leer(COLAS.compras).length;
  btn.dataset.pendientes = String(pendientes);
  btn.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Enviar compras pendientes' + (pendientes ? ` <span class="mas-menu-cuenta">${pendientes}</span>` : '');
}

// Total en vivo en la barra fija de abajo, junto a Guardar. Solo lectura:
// el valor que viaja sigue siendo el <input name="total">.
function _pintarTotalVivoCompra_() {
  const f = document.querySelector('#form-compra');
  const tot = document.querySelector('#compras-total-vivo');
  const des = document.querySelector('#compras-desglose-vivo');
  if (!f || !tot || !des) return;
  const n = v => Number(v || 0);
  const total = n(f.total.value);
  tot.textContent = '$' + total.toFixed(2);
  des.textContent = (f.subtotal.value || f.total.value)
    ? `Subtotal $${n(f.subtotal.value).toFixed(2)} · IVA $${n(f.iva.value).toFixed(2)} · ${f.condicion.value === 'CONTADO' ? 'contado' : 'crédito'}`
    : 'Captura subtotal e IVA';
  const sub = n(f.subtotal.value), iva = n(f.iva.value);
  document.querySelectorAll('.compras-chip').forEach(b => {
    const pct = Number(b.dataset.pct);
    b.setAttribute('aria-pressed', String(sub > 0 && Math.abs(sub * pct - iva) < 0.005));
  });
  document.querySelectorAll('.compras-seg').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.condicion === f.condicion.value)));
}

function _mostrarResultadoCompra_(msg, esError) {
  const el = document.querySelector('#resultado-compra');
  el.textContent = msg;
  el.classList.toggle('text-rojo', !!esError);
  el.classList.toggle('text-muted', !esError);
}

// Puro cálculo de lectura (lo ya capturado contra el total) -- no toca la
// validación real, que sigue viviendo solo en nuevaCompraCampo.
function _actualizarResumenPagos_() {
  const el = document.querySelector('#compras-pagado-resta');
  const f = document.querySelector('#form-compra');
  const pagos = document.querySelector('#pagos-compra');
  if (!el || !f || !pagos) return;
  const pagado = _leerPagosCompra(pagos).reduce((a, p) => a + p.monto, 0);
  if (!pagado) { el.textContent = ''; return; }
  const total = Number(f.total.value || 0);
  el.textContent = `Pagado $${pagado.toFixed(2)} · Resta $${Math.max(0, total - pagado).toFixed(2)}`;
}

function activarComprasDireccion() {
  const f = document.querySelector('#form-compra');
  if (!f) return;
  f.fecha.value = _fechaLocalDireccion_();
  _restaurarBorradorCompra_(f);
  _renderHistorialComprasDireccion_();
  _actualizarBotonEnviar_();

  // IVA en chips: calcula el IVA sobre el subtotal y lo escribe en el mismo
  // campo de siempre (se puede corregir a mano con el del ticket).
  document.querySelectorAll('.compras-chip').forEach(b => b.onclick = () => {
    const sub = Number(f.subtotal.value || 0);
    f.iva.value = (sub * Number(b.dataset.pct)).toFixed(2);
    f.iva.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Condición segmentada: escribe el mismo <select name="condicion">.
  document.querySelectorAll('.compras-seg').forEach(b => b.onclick = () => {
    f.condicion.value = b.dataset.condicion;
    f.condicion.dispatchEvent(new Event('change', { bubbles: true }));
  });
  f.addEventListener('input', _pintarTotalVivoCompra_);
  f.addEventListener('change', _pintarTotalVivoCompra_);
  _pintarTotalVivoCompra_();

  document.querySelectorAll('.compras-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.compras-tab').forEach(b => {
        b.classList.toggle('activa', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      document.querySelector('#panel-capturar').hidden = btn.dataset.panel !== 'capturar';
      document.querySelector('#panel-historial').hidden = btn.dataset.panel !== 'historial';
    };
  });

  // El UUID del CFDI solo aplica cuando ya está facturado -- mismo criterio
  // que ya valida nuevaCompraCampo, aquí solo se refleja en la vista.
  const situacion = document.querySelector('#compra-situacion');
  const uuidWrap = document.querySelector('#compra-uuid-wrap');
  const sincronizarUuid = () => { uuidWrap.style.display = situacion.value === 'FACTURADO' ? '' : 'none'; };
  situacion.onchange = sincronizarUuid;
  sincronizarUuid();

  // Si falta un campo obligatorio dentro de un <details> cerrado (p.ej.
  // Subtotal en "Más campos"), el navegador no puede enfocar su aviso
  // nativo con el bloque oculto -- se abre antes de que lo intente.
  f.addEventListener('invalid', e => {
    const detalles = e.target.closest('details');
    if (detalles) detalles.open = true;
  }, true);

  const lineas = document.querySelector('#lineas-compra');
  const pagos = document.querySelector('#pagos-compra');
  // closest('.quitar'), no e.target.classList: el botón lleva un ícono
  // adentro (<i class="bi ...">) -- un toque justo sobre el ícono pone el
  // ícono como e.target, no el botón.
  const quitar = e => { const b = e.target.closest('.quitar'); if (b) b.closest('li').remove(); _actualizarResumenPagos_(); };

  document.querySelector('#agregar-linea').onclick = () => lineas.insertAdjacentHTML('beforeend', _filaLineaCompra());
  document.querySelector('#agregar-pago').onclick = () => { pagos.insertAdjacentHTML('beforeend', _filaPagoCompra()); _actualizarResumenPagos_(); };
  lineas.onclick = quitar;
  pagos.onclick = quitar;
  pagos.oninput = _actualizarResumenPagos_;

  f.subtotal.oninput = f.iva.oninput = () => {
    f.total.value = (Number(f.subtotal.value || 0) + Number(f.iva.value || 0)).toFixed(2);
    _actualizarResumenPagos_();
  };
  f.total.addEventListener('input', _actualizarResumenPagos_);
  f.addEventListener('input', () => _guardarBorradorCompra_(f));
  f.addEventListener('change', () => _guardarBorradorCompra_(f));

  f.onsubmit = async e => {
    e.preventDefault();
    // C4 (2026-09-23): al guardar SIEMPRE se pide la foto de evidencia; omitirla
    // es válido pero queda registrado como "sin evidencia".
    let sinEvidencia = false;
    // Foto elegida pero nunca comprimida (sin señal: la lectura con IA no corrió)
    // -- se comprime aquí para que viaje como evidencia y no se vuelva a pedir.
    const fotoSinLeer = document.getElementById('compra_foto');
    if (!_compraFotoComprimidaB64 && fotoSinLeer && fotoSinLeer.files && fotoSinLeer.files[0]) {
      _compraFotoComprimidaB64 = await _comprimirImagenCompra_(fotoSinLeer.files[0]);
    }
    if (!_compraFotoComprimidaB64) {
      const eleccion = await _pedirEvidenciaCompra_();
      if (eleccion === 'foto') {
        _soloEvidenciaCompra = true;
        document.getElementById('compra_foto').click();
        return;
      }
      if (eleccion !== 'omitir') return;
      sinEvidencia = true;
    }
    try {
      const d = Object.fromEntries(new FormData(f));
      d.lineas = _leerLineasCompra(lineas);
      d.pagos = _leerPagosCompra(pagos);
      // La foto ya viaja comprimida (_comprimirImagenCompra_, cacheada al
      // elegirla o al leerla con IA) -- nunca se manda el File crudo del
      // input, que FormData habría ignorado de todos modos por no tener
      // atributo `name`.
      const huboFoto = !!_compraFotoComprimidaB64;
      if (huboFoto) d.foto = _compraFotoComprimidaB64;
      if (sinEvidencia) d.sinEvidencia = true;
      nuevaCompraCampo(d);
      _recordarProveedorCompra_(d.proveedor);
      _mostrarResultadoCompra_(
        'Compra guardada. Se enviará al vincular conexión, o pulsa "Enviar compras pendientes".' + (huboFoto ? ' Ticket adjunto ✓.' : ''),
        false
      );
      f.reset();
      f.fecha.value = _fechaLocalDireccion_();
      localStorage.removeItem(CLAVE_BORRADOR_COMPRA);
      lineas.innerHTML = '';
      pagos.innerHTML = '';
      document.querySelectorAll('#form-compra details').forEach(d => { d.open = false; });
      sincronizarUuid();
      _resetFotoCompra_();
      _renderHistorialComprasDireccion_();
      _actualizarBotonEnviar_();
      _actualizarResumenPagos_();
      _pintarTotalVivoCompra_();
    } catch (err) {
      _mostrarResultadoCompra_(err.message, true);
    }
  };

  document.querySelector('#enviar-compras').onclick = async () => {
    if (typeof _cerrarMasMenu_ === 'function') _cerrarMasMenu_();
    try {
      _comprasEnviando = leer(COLAS.compras).length;
      estado();
      const pin = await pedirPinDireccion();
      const n = await enviarComprasCampo(pin);
      _comprasUltimoError = '';
      _mostrarResultadoCompra_(n
        ? `${n} compra(s) siguen pendientes de enviar.`
        : 'Todas las compras en cola se enviaron.', false);
      _renderHistorialComprasDireccion_();
      _actualizarBotonEnviar_();
    } catch (err) {
      _comprasUltimoError = clasificarErrorAcceso(err).slice(0, 40);
      _mostrarResultadoCompra_(clasificarErrorAcceso(err), true);
    } finally {
      _comprasEnviando = 0;
      estado();
    }
  };
}

// ── OCR de tickets (2026-09-10, estandarizado con Gastos/Dirección) ─────────
// Mismo patrón exacto: botón EXPLÍCITO, nunca automático ni dentro del
// guardado/reintento -- cada reintento offline volvería a cobrar la lectura
// de la imagen.
const FOTO_TOPE_KB_COMPRA = 250;
let _compraTocadaPorOcr = false;
let _compraFotoComprimidaB64 = ''; // cache: evita comprimir 2 veces (preview + OCR)

function _leerArchivoComoB64Compra_(file) {
  return new Promise((resolve) => {
    if (!file) { resolve(''); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function _escalarLadoCompra_(ancho, alto, maxLado) {
  const mayor = Math.max(ancho, alto);
  if (mayor <= maxLado) return { w: ancho, h: alto }; // nunca agrandar
  const factor = maxLado / mayor;
  return { w: Math.round(ancho * factor), h: Math.round(alto * factor) };
}

function _exportarConCalidadDecrecienteCompra_(canvas, calidadInicial) {
  const TOPE_BYTES = FOTO_TOPE_KB_COMPRA * 1024;
  const PISO_CALIDAD = 0.45;
  return new Promise((resolve, reject) => {
    const intentar = (q) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('toBlob vacío')); return; }
        if (blob.size > TOPE_BYTES && q > PISO_CALIDAD) {
          intentar(Math.max(PISO_CALIDAD, +(q - 0.1).toFixed(2)));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('FileReader falló'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', q);
    };
    intentar(calidadInicial);
  });
}

function _comprimirImagenCompra_(file, maxLado, calidad) {
  maxLado = maxLado || 1600;
  calidad = calidad || 0.72;
  return new Promise((resolve) => {
    if (!file) { resolve(''); return; }
    const fallback = () => _leerArchivoComoB64Compra_(file).then(resolve);
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const { w, h } = _escalarLadoCompra_(img.naturalWidth || img.width, img.naturalHeight || img.height, maxLado);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          // C4: filtro tipo escáner (gris + contraste) -- si el navegador no soporta
          // ctx.filter (Safari), simplemente no se aplica.
          try { ctx.filter = 'grayscale(1) contrast(1.35) brightness(1.05)'; } catch (_) {}
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          _exportarConCalidadDecrecienteCompra_(canvas, calidad).then(resolve).catch(fallback);
        } catch (e) { URL.revokeObjectURL(url); fallback(); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); fallback(); };
      img.src = url;
    } catch (e) { fallback(); }
  });
}

function _parsearFechaOcrCompra_(str) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(str || '').trim());
  if (!m) return null;
  const dd = +m[1], mm = +m[2], yyyy = +m[3];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const p = n => String(n).padStart(2, '0');
  return `${yyyy}-${p(mm)}-${p(dd)}`;
}

// Traduce la respuesta del OCR a qué llenar en el formulario -- función pura
// (sin tocar el DOM). Nunca lanza; ante cualquier duda, { aplicado:false } y
// el formulario se queda como estaba (captura manual).
function _aplicarOcrACompra_(resp) {
  const NADA = { aplicado: false };
  if (!resp || resp.ok !== true || !resp.campos) return NADA;
  if (resp.confianza == null || resp.confianza < 50) return NADA;
  const c = resp.campos;
  const total = Number(c.total);
  if (!(total > 0)) return NADA;
  const out = { aplicado: true, proveedor: String(c.proveedor || '').trim(), fecha: null, total };
  const fechaOk = _parsearFechaOcrCompra_(c.fecha);
  if (fechaOk && fechaOk <= _fechaLocalDireccion_()) out.fecha = fechaOk;
  const iva = Number(c.iva);
  const subtotal = Number(c.subtotal);
  if (iva >= 0 && subtotal > 0) {
    // Subtotal + IVA exactos del papel -- nunca se recalculan (regla del
    // espejo: el total se toma tal cual, no se vuelve a sumar).
    out.subtotal = subtotal;
    out.iva = iva;
  } else if (iva >= 0) {
    // Solo vino IVA + total -> el subtotal se deriva una sola vez aquí.
    out.subtotal = total - iva;
    out.iva = iva;
  }
  return out;
}

// A2: el selector de archivos (galería/HEIC/PDF) pasa su archivo al mismo flujo de la cámara.
function _archivoCompraElegido_() {
  const src = document.getElementById('compra_archivo');
  const dst = document.getElementById('compra_foto');
  if (!src || !dst || !src.files || !src.files[0]) return;
  try { const dt = new DataTransfer(); dt.items.add(src.files[0]); dst.files = dt.files; } catch (_) { return; }
  src.value = '';
  _onFotoCompraElegida_();
}

// C4: la foto elegida desde el aviso de evidencia NO dispara la lectura con IA
// (no debe pisar lo ya capturado).
let _soloEvidenciaCompra = false;

function _onFotoCompraElegida_() {
  _compraTocadaPorOcr = false;
  _compraFotoComprimidaB64 = '';
  const fotoInput = document.getElementById('compra_foto');
  const file = fotoInput && fotoInput.files ? fotoInput.files[0] : null;
  const preview = document.getElementById('compraFotoPreview');
  const btnOcr = document.getElementById('compraBtnOcr');
  const estado = document.getElementById('compraOcrEstado');
  if (estado) estado.textContent = '';
  if (!file) {
    if (preview) { preview.style.display = 'none'; preview.src = ''; }
    if (btnOcr) btnOcr.style.display = 'none';
    return;
  }
  if (preview) {
    if (file.type === 'application/pdf') { preview.style.display = 'none'; preview.src = ''; }
    else { preview.src = URL.createObjectURL(file); preview.style.display = 'block'; }
  }
  if (btnOcr) {
    btnOcr.style.display = 'block';
    const online = navigator.onLine;
    btnOcr.disabled = !online;
    btnOcr.textContent = online ? '🔍 Leer ticket otra vez' : '🔍 Leer ticket (sin señal)';
  }
  // El botón principal ya es "Tomar foto y leer ticket" -- elegir la foto
  // desde ahí dispara la lectura sola, sin un segundo toque (2026-09-21,
  // igualado con Gastos). "Leer ticket otra vez" queda visible solo para
  // reintentar si la primera lectura falló. El PIN de Compras sigue
  // pidiéndose igual: si ya estaba vigente (pedirPinDireccion cachea 10 min),
  // no vuelve a interrumpir; si no, lo pide una sola vez, aquí en vez de al
  // pulsar el botón.
  if (_soloEvidenciaCompra) {
    _soloEvidenciaCompra = false;
    if (estado) estado.textContent = '📎 Foto lista como evidencia. Pulsa Guardar otra vez.';
    return;
  }
  if (navigator.onLine) _leerTicketCompraConIA_();
}

function _resetFotoCompra_() {
  _compraTocadaPorOcr = false;
  _compraFotoComprimidaB64 = '';
  const preview = document.getElementById('compraFotoPreview');
  const btnOcr = document.getElementById('compraBtnOcr');
  const estado = document.getElementById('compraOcrEstado');
  if (preview) { preview.style.display = 'none'; preview.src = ''; }
  if (btnOcr) btnOcr.style.display = 'none';
  if (estado) estado.textContent = '';
}

function _marcarTocadoPorIACompra_(el) {
  if (!el) return;
  el.classList.add('ia-tocado');
  _pintarTotalVivoCompra_();
  const quitar = () => el.classList.remove('ia-tocado');
  el.addEventListener('input', quitar, { once: true });
  el.addEventListener('change', quitar, { once: true });
}

async function _leerTicketCompraConIA_() {
  const btnOcr = document.getElementById('compraBtnOcr');
  const estado = document.getElementById('compraOcrEstado');
  const fotoInput = document.getElementById('compra_foto');
  const file = fotoInput && fotoInput.files ? fotoInput.files[0] : null;
  if (!file || !navigator.onLine) return;
  const url = localStorage.getItem('sumetec_compras_url');
  if (!url) { if (estado) estado.textContent = 'Vincula el teléfono primero.'; return; }
  if (btnOcr) { btnOcr.disabled = true; btnOcr.textContent = 'Leyendo…'; }
  if (estado) estado.textContent = '';
  try {
    const pin = await pedirPinDireccion();
    const token = await abrirSesionDireccion(pin);
    // Comprime UNA vez y la reusa para el guardado -- así el ticket no se
    // comprime dos veces ni se lee dos veces por accidente.
    if (!_compraFotoComprimidaB64) _compraFotoComprimidaB64 = await _comprimirImagenCompra_(file);
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ tipo: 'ocr_ticket', token, foto: _compraFotoComprimidaB64 }),
    });
    const resp = await res.json();
    const r = _aplicarOcrACompra_(resp);
    if (!r.aplicado) {
      _compraTocadaPorOcr = false;
      if (estado) estado.textContent = '⚠️ No se pudo leer, captura a mano.';
      return;
    }
    _compraTocadaPorOcr = true;
    const f = document.querySelector('#form-compra');
    if (r.proveedor && f.proveedor) { f.proveedor.value = r.proveedor; _marcarTocadoPorIACompra_(f.proveedor); }
    if (r.fecha && f.fecha) { f.fecha.value = r.fecha; _marcarTocadoPorIACompra_(f.fecha); }
    if (r.subtotal != null && f.subtotal) { f.subtotal.value = r.subtotal.toFixed(2); _marcarTocadoPorIACompra_(f.subtotal); }
    if (r.iva != null && f.iva) { f.iva.value = r.iva.toFixed(2); _marcarTocadoPorIACompra_(f.iva); }
    // El total se toma tal cual lo dice el papel -- NUNCA se recalcula de
    // subtotal+iva aunque el listener de arriba (f.subtotal.oninput) exista
    // para la captura manual. Es la regla del espejo de la remisión.
    if (f.total) { f.total.value = r.total.toFixed(2); _marcarTocadoPorIACompra_(f.total); }
    if (estado) estado.textContent = '✅ IA — revísalo antes de guardar.';
  } catch (e) {
    _compraTocadaPorOcr = false;
    if (estado) estado.textContent = '⚠️ Error de lectura, captura a mano.';
  } finally {
    if (btnOcr) { btnOcr.disabled = !navigator.onLine; btnOcr.textContent = navigator.onLine ? '🔍 Leer ticket' : '🔍 Leer ticket (sin señal)'; }
  }
}

// ── Borrar copias locales (2026-09-24) ──────────────────────────────────────
// Para cuando se borra algo en el servidor (p. ej. la carpeta de Drive) y el
// teléfono sigue mostrando la copia vieja. SOLO borra caché que se vuelve a
// bajar del servidor. Bloquea si hay algo sin enviar, si no hay señal o si el
// servidor no contesta (la comprobación pide el PIN y usa el token real, así
// que también confirma que la sesión sirve). Doble confirmación: aviso +
// teclear BORRAR. Nunca toca colas, borrador de compra, PIN ni vinculación.
const _CLAVES_CACHE_COMPRAS = ['sumetec_compras_snapshot_cache', 'sumetec_compras_listas_cache', 'sumetec_compras_historial_compras'];
function _pendientesParaLimpiar_() {
  return leer(COLAS.compras).length + _leerColaEquiv_().length + (localStorage.getItem(CLAVE_BORRADOR_COMPRA) ? 1 : 0);
}
async function _servidorEnLinea_() {
  const url = localStorage.getItem('sumetec_compras_url');
  if (!url || !navigator.onLine) return false;
  try {
    const pin = await pedirPinDireccion();
    const token = await abrirSesionDireccion(pin);
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ tipo: 'configuracion', token }), signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.ok !== false);
  } catch (_) { return false; }
}
async function limpiarCacheLocal() {
  if (!navigator.onLine) { alert('Sin conexión — conéctate para poder borrar.'); return; }
  const pend = _pendientesParaLimpiar_();
  if (pend > 0) { alert('Hay ' + pend + ' pendiente(s) sin enviar o algo a medio capturar — no se borró nada.'); return; }
  alert('Confirmando con el servidor…');
  if (!(await _servidorEnLinea_())) { alert('El servidor no contestó (o se canceló el PIN) — no se borró nada.'); return; }
  if (!confirm('Se borrarán las copias guardadas en ESTE teléfono (resúmenes, listas y configuración en caché).\n\nTodo lo enviado sigue en el servidor y se vuelve a bajar. Colas, PIN y vinculación NO se borran.\n\n¿Continuar?')) return;
  const txt = prompt('Segunda confirmación: escribe BORRAR para continuar.');
  if (String(txt || '').trim().toUpperCase() !== 'BORRAR') { alert('Cancelado — no se borró nada.'); return; }
  if (_pendientesParaLimpiar_() > 0) { alert('Entró algo a la cola mientras confirmabas — no se borró nada.'); return; }
  _CLAVES_CACHE_COMPRAS.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
  alert('Copias borradas ✓ — recargando…');
  setTimeout(() => location.reload(), 900);
}
