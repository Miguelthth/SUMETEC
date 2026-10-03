/**
 * motor_cfdi.js — Núcleo PURO de facturación: remisión → CFDI 4.0 + validación.
 *
 * Funciones SIN efectos secundarios (no tocan DOM, red, ni Sheets). Se pueden:
 *   1) probar con `node --test` (ver motor_cfdi.test.js), y
 *   2) usar igual en el navegador (creador de facturas) y en Apps Script.
 *
 * MODELO DE CUADRE — "ESPEJO DE LA REMISIÓN" (confirmado por el usuario 2026-06-28):
 *   En la remisión el `precio` es la BASE y el IVA (8%/16%) YA se aplica por renglón
 *   (columna IVA). Entonces el total de la remisión ya incluye el IVA = lo que paga
 *   el cliente. La factura es un ESPEJO: usa el IVA de cada renglón tal cual, con
 *   ValorUnitario = precio (base). Así Total factura = total remisión, exacto, y
 *   pedir factura NO le cuesta más al cliente. El objetivo de cuadre es SIEMPRE el
 *   total de la remisión (nunca se vuelve a multiplicar el IVA).
 *
 *   Modo alterno (opc.precioIncluyeIVA=true): si algún día el precio fuera el final
 *   con IVA por dentro y la remisión llevara IVA 0, se saca el IVA del precio. No es
 *   el caso actual; queda como opción.
 *
 * Reusa _calcTot (calculos.js) como única fuente del total de la remisión: NO se
 * duplica la fórmula del dinero (ver COTIZADOR/calculos.js).
 */

// _calcTot: global en el navegador (calculos.js cargado antes); require en Node.
let _calcTot_;
if (typeof module !== 'undefined' && module.exports) {
  _calcTot_ = require('../../2.- COTIZADOR/calculos.js')._calcTot;
} else {
  _calcTot_ = _calcTot; // global del navegador
}

function _r2(n){ return Math.round((+n) * 100 + 1e-7) / 100; }

// RFC válido: persona moral (3 letras) o física (4) + 6 dígitos fecha + 3 homoclave.
// Acepta el genérico nacional XAXX010101000 (factura global / público en general).
const RFC_RE = /^([A-ZÑ&]{3,4})\d{6}[A-Z0-9]{3}$/;
function rfcValido(rfc){ return RFC_RE.test(String(rfc || '').trim().toUpperCase()); }

const TASAS_OK = [0, 0.08, 0.16];

/**
 * Construye los conceptos del CFDI espejando la remisión.
 * Cada concepto usa la tasa del propio renglón (it.iva %), salvo que se fuerce una
 * con opc.tasaForzada. Mantiene la estructura CFDI (ValorUnitario base, Descuento e
 * Impuestos por línea) para que Total = Σ(Importe − Descuento + IVA) = total remisión.
 */
function construirConceptos(items, descPct, catalogo, opc){
  opc = opc || {};
  const pct = (+descPct || 0) / 100;
  const precioIncluyeIVA = !!opc.precioIncluyeIVA; // default false: precio = base
  const conceptos = [];
  const faltanClave = [];
  const tasasMal = [];
  const porConfirmar = [];
  (items || []).forEach(it => {
    const q = +it.qty || 0, p = +it.precio || 0;
    if (!(q > 0 && p > 0) || it.regalo) return; // regalos y vacíos no se facturan
    const fis = catalogo[it.clave] || catalogo[String(it.clave || '').toUpperCase()] || null;
    if (!fis || !fis.claveProdServ) faltanClave.push(it.clave || it.desc || '(sin clave)');
    else if (fis.estatus && /CONFIRMAR/i.test(fis.estatus)) porConfirmar.push(it.clave); // A-4

    // Tasa: la del renglón (espejo) o una forzada para casos especiales.
    const tasa = (opc.tasaForzada != null) ? +opc.tasaForzada : (+it.iva || 0) / 100;
    if (TASAS_OK.indexOf(tasa) === -1) tasasMal.push(String(it.iva) + '%');

    const vuBase = precioIncluyeIVA ? p / (1 + tasa) : p; // default: precio ya es base
    const valorUnitario = Math.round(vuBase * 1e6) / 1e6; // CFDI permite 6 decimales
    const importe   = _r2(q * valorUnitario);
    const descuento = _r2(importe * pct);
    const base      = _r2(importe - descuento);
    const ivaImp    = _r2(base * tasa);
    conceptos.push({
      claveProdServ: fis ? fis.claveProdServ : null,
      claveUnidad:   fis && fis.claveUnidad ? fis.claveUnidad : 'H87',
      cantidad:      q,
      descripcion:   it.desc || '',
      valorUnitario, importe, descuento, tasa,
      impuestos: tasa > 0 ? { base, tipo: '002', tasa, importe: ivaImp } : null,
    });
  });
  return { conceptos, faltanClave, tasasMal, porConfirmar };
}

// Suma los totales del CFDI a partir de los conceptos.
function _totales(conceptos){
  const subtotal  = _r2(conceptos.reduce((s,c)=>s + c.importe, 0));
  const descTotal = _r2(conceptos.reduce((s,c)=>s + c.descuento, 0));
  const ivaTotal  = _r2(conceptos.reduce((s,c)=>s + (c.impuestos ? c.impuestos.importe : 0), 0));
  const total     = _r2(subtotal - descTotal + ivaTotal);
  return { subtotal, descuento: descTotal, iva: ivaTotal, total };
}

/**
 * construirCFDI(remision, opciones) → resultado con semáforo.
 *
 * remision = {
 *   folio, uuidFiscal?,                       // uuidFiscal: ya facturada (anti-doble)
 *   cliente: { rfc, razonSocial, regimenFiscal, usoCFDI, cp, email },
 *   items: [{ qty, clave, desc, precio, iva, regalo }],  // iva = tasa del renglón (%)
 *   descPct, redondear?
 * }
 * opciones = {
 *   catalogoFiscal: { CLAVE: { claveProdServ, claveUnidad } },
 *   formaPago, metodoPago = 'PUE',
 *   precioIncluyeIVA = false,   // ver MODELO DE CUADRE
 *   tasaForzada = null,         // fuerza una tasa a todos los renglones (excepcional)
 *   yaFacturados = []           // folios o UUIDs ya facturados
 * }
 *
 * Devuelve { ok, errores[], advertencias[], cfdi, cuadre }.
 *   ok=false ⇒ NO timbrar. errores son rojos (bloquean); advertencias son amarillos.
 */
function construirCFDI(remision, opciones){
  const o = opciones || {};
  const cat = o.catalogoFiscal || {};
  const metodoPago = o.metodoPago || 'PUE';
  const yaFact = o.yaFacturados || [];
  const errores = [], advertencias = [];
  const cli = (remision && remision.cliente) || {};
  const items = (remision && remision.items) || [];

  // ── Validación del cliente (Cliente Maestro debe estar completo) ──
  if (!rfcValido(cli.rfc))        errores.push('RFC del cliente inválido o vacío.');
  if (!String(cli.razonSocial || '').trim()) errores.push('Falta la razón social del cliente (exacta como su Constancia).');
  if (!String(cli.regimenFiscal || '').trim()) errores.push('Falta el régimen fiscal del cliente.');
  if (!String(cli.usoCFDI || '').trim())       errores.push('Falta el uso de CFDI.');
  if (!String(cli.cp || '').trim())            errores.push('Falta el código postal del cliente.');
  else if (!/^\d{5}$/.test(String(cli.cp).trim())) errores.push('El código postal debe ser de 5 dígitos.');

  // ── Validación de pago ──
  if (!String(o.formaPago || '').trim()) errores.push('Falta la forma de pago (efectivo, transferencia, tarjeta…).');
  if (!metodoPago) errores.push('Falta el método de pago (PUE/PPD).');

  // ── Anti-doble-facturación ──
  const idRem = remision && (remision.uuidFiscal || remision.folio);
  if (remision && remision.uuidFiscal) errores.push('Esta remisión YA tiene factura (UUID ' + remision.uuidFiscal + '). No se puede facturar dos veces.');
  else if (idRem && yaFact.indexOf(idRem) !== -1) errores.push('Esta remisión ya fue facturada (folio ' + idRem + ').');

  // ── Conceptos (espejo de la remisión) ──
  const { conceptos, faltanClave, tasasMal, porConfirmar } = construirConceptos(items, remision && remision.descPct, cat, o);
  if (conceptos.length === 0) errores.push('La remisión no tiene productos facturables (cantidades/precios en 0 o solo regalos).');
  if (faltanClave.length) errores.push('Productos sin clave SAT en el catálogo: ' + [...new Set(faltanClave)].join(', '));
  if (tasasMal.length) errores.push('Tasas de IVA no válidas o IVA mixto en la remisión: ' + [...new Set(tasasMal)].join(', ') + ' (cada renglón debe ser 0, 8% o 16%).'); // A-2
  if (porConfirmar.length) advertencias.push('Hay claves SAT POR CONFIRMAR con tu contador: ' + [...new Set(porConfirmar)].join(', ') + '.'); // A-4
  if (conceptos.length && conceptos.every(c => c.tasa === 0)) advertencias.push('La factura saldrá SIN IVA (todos los renglones en 0%). Confirma que es correcto.');

  // ── Cuadre EXACTO contra el total REAL que pagó el cliente ──
  // Objetivo = total guardado de la remisión. Con la regla por renglón de A1,
  // cualquier diferencia es un dato inconsistente y bloquea la factura.
  const objetivo = (remision && remision.total != null && +remision.total > 0)
    ? _r2(+remision.total)
    : _calcTot_(items, remision && remision.descPct, !!(remision && remision.redondear)).tot;
  const tot = _totales(conceptos);
  const diff = _r2(objetivo - tot.total);
  if (diff !== 0) {
    errores.push('El total de la factura ($' + tot.total + ') no cuadra con la remisión ($' + objetivo + '). Diferencia: $' + diff + '. Revisa los importes, descuentos e IVA por renglón.');
  }

  const ok = errores.length === 0;
  return {
    ok, errores, advertencias,
    cuadre: { totalRemision: objetivo, totalCFDI: tot.total, diferencia: diff },
    cfdi: ok ? {
      tipoComprobante: 'I',           // Ingreso
      metodoPago, formaPago: o.formaPago,
      moneda: 'MXN',
      receptor: {
        rfc: String(cli.rfc).trim().toUpperCase(),
        nombre: String(cli.razonSocial).trim(),
        regimenFiscal: String(cli.regimenFiscal).trim(),
        usoCFDI: String(cli.usoCFDI).trim(),
        domicilioFiscalReceptor: String(cli.cp).trim(),
      },
      conceptos,
      totales: tot,
    } : null,
  };
}

/**
 * construirFacturaGlobal(remisiones, opciones) → factura global (público en
 * general), diferida a propósito hasta ahora (ver documentacion/2026-06-28-
 * facturacion-cfdi-design.md). Junta TODAS las remisiones pendientes del
 * periodo bajo el RFC genérico XAXX010101000, agrupando por TASA (no por
 * remisión): un concepto "Venta global 0/8/16%" por cada tasa que aparezca,
 * en vez de un concepto por línea (así no importa cuántas remisiones ni
 * líneas traiga cada una, el CFDI queda corto). Modo simulado: sin
 * "Información Global" (Periodicidad/Meses/Año) del complemento real del SAT
 * -- eso se agrega cuando haya PAC de paga conectado.
 *
 * remisiones = [ { folio, uuidFiscal?, items, descPct, total } ]
 * opciones = { catalogoFiscal, formaPago, metodoPago='PUE', cp, yaFacturados=[] }
 * Devuelve { ok, errores[], advertencias[], cfdi, cuadre } — mismo contrato que
 * construirCFDI, salvo que cfdi.receptor siempre es el genérico y
 * cfdi.folios trae los folios de remisión incluidos.
 */
function construirFacturaGlobal(remisiones, opciones){
  const o = opciones || {};
  const cat = o.catalogoFiscal || {};
  const metodoPago = o.metodoPago || 'PUE';
  const yaFact = o.yaFacturados || [];
  const errores = [], advertencias = [];

  const validas = (remisiones || []).filter(r => {
    const id = r && (r.uuidFiscal || r.folio);
    return r && !r.uuidFiscal && yaFact.indexOf(id) === -1;
  });
  if (!validas.length) {
    errores.push('No hay remisiones pendientes para incluir en la factura global (todas ya facturadas o la lista viene vacía).');
    return { ok: false, errores, advertencias, cfdi: null, cuadre: null };
  }
  if (!String(o.formaPago || '').trim()) errores.push('Falta la forma de pago.');
  if (!String(o.cp || '').trim()) errores.push('Falta el código postal del domicilio fiscal del receptor.');
  else if (!/^\d{5}$/.test(String(o.cp).trim())) errores.push('El código postal debe ser de 5 dígitos.');

  const porTasa = {};      // { '0'|'0.08'|'0.16': {base, iva} }
  const faltanClave = [], tasasMal = [], porConfirmar = [];
  let objetivo = 0, renglonesConIva = 0;
  validas.forEach(r => {
    const pct = (+r.descPct || 0) / 100;
    (r.items || []).forEach(it => {
      const q = +it.qty || 0, p = +it.precio || 0;
      if (!(q > 0 && p > 0) || it.regalo) return;
      const fis = cat[it.clave] || cat[String(it.clave || '').toUpperCase()] || null;
      if (!fis || !fis.claveProdServ) faltanClave.push(it.clave || it.desc || '(sin clave)');
      else if (fis.estatus && /CONFIRMAR/i.test(fis.estatus)) porConfirmar.push(it.clave);
      const tasa = (+it.iva || 0) / 100;
      if (TASAS_OK.indexOf(tasa) === -1) tasasMal.push(String(it.iva) + '%');
      if (tasa > 0) renglonesConIva++;
      const importe = _r2(q * p), desc = _r2(importe * pct), base = _r2(importe - desc);
      const iva = _r2(base * tasa);
      const key = String(tasa);
      if (!porTasa[key]) porTasa[key] = { tasa, base: 0, iva: 0 };
      porTasa[key].base = _r2(porTasa[key].base + base);
      porTasa[key].iva  = _r2(porTasa[key].iva + iva);
    });
    objetivo += (+r.total > 0) ? +r.total : _calcTot_(r.items, r.descPct, false).tot;
  });
  objetivo = _r2(objetivo);

  const conceptos = Object.keys(porTasa).filter(k => porTasa[k].base > 0).map(k => {
    const t = porTasa[k];
    return {
      claveProdServ: '01010101', claveUnidad: 'ACT', cantidad: 1,
      descripcion: 'Venta global — ' + (t.tasa * 100) + '% IVA (' + validas.length + ' remisión/es)',
      valorUnitario: t.base, importe: t.base, descuento: 0, tasa: t.tasa,
      impuestos: t.tasa > 0 ? { base: t.base, tipo: '002', tasa: t.tasa, importe: t.iva } : null,
    };
  });
  if (conceptos.length === 0) errores.push('Las remisiones seleccionadas no tienen productos facturables.');
  if (faltanClave.length) errores.push('Productos sin clave SAT en el catálogo: ' + [...new Set(faltanClave)].join(', '));
  if (tasasMal.length) errores.push('Tasas de IVA no válidas en alguna remisión: ' + [...new Set(tasasMal)].join(', ') + '.');
  if (porConfirmar.length) advertencias.push('Hay claves SAT POR CONFIRMAR con tu contador: ' + [...new Set(porConfirmar)].join(', ') + '.');

  const tot = _totales(conceptos);
  const diff = _r2(objetivo - tot.total);
  if (diff !== 0) {
    errores.push('El total de la factura global ($' + tot.total + ') no cuadra contra la suma de remisiones ($' + objetivo + '). Diferencia: $' + diff + '.');
  }

  const ok = errores.length === 0;
  return {
    ok, errores, advertencias,
    cuadre: { totalRemision: objetivo, totalCFDI: tot.total, diferencia: diff },
    cfdi: ok ? {
      tipoComprobante: 'I', metodoPago, formaPago: o.formaPago, moneda: 'MXN',
      receptor: { rfc: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL', regimenFiscal: '616', usoCFDI: 'S01', domicilioFiscalReceptor: String(o.cp || '').trim() },
      conceptos, totales: tot,
      folios: validas.map(r => r.folio),
    } : null,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { construirCFDI, construirConceptos, construirFacturaGlobal, rfcValido, _r2 };
}
