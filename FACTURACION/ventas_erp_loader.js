/**
 * ventas_erp_loader.js — Convierte las filas del Sheets "Ventas para ERP" (hoja
 * "Ventas") en objetos de remisión que entiende el motor de facturación, y los
 * enriquece con los datos fiscales del Cliente Maestro.
 *
 * El ERP guarda UNA FILA POR ARTÍCULO; la cabecera (ID Venta, Folio, Fecha,
 * Cliente, IVA %, Subtotal, Descuento, Total) se repite en cada fila. Aquí se
 * agrupan por venta. Funciones PURAS (no leen red ni archivos) → `node --test`.
 *
 * Columnas (ERP_HDR del apps_script):
 *   ID Venta | Folio | Fecha | Cliente | IVA % | Subtotal | Descuento |
 *   IVA (monto) | Total | Código | Descripción | Cant. | P. Esp. | Costo |
 *   Total línea | Regalo
 */

function _num(v){
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// "dd/mm/aaaa" (formato del ERP) → Date. También acepta ISO. null si no se entiende.
function _parseFechaMX(s){
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Filas (array de objetos por encabezado, o array-de-arrays con encabezado en [0])
// → [ { folio, fecha:Date, cliente:{nombre}, ivaPct, subtotal, descMonto, total,
//       descPct, items:[{qty,clave,desc,precio,iva,regalo}] } ]  (orden de aparición)
function remisionesDeVentasERP(rows){
  if (!rows || !rows.length) return [];
  let objs;
  if (Array.isArray(rows[0])){
    const hdr = rows[0].map(h => String(h).trim());
    objs = rows.slice(1).map(r => { const o = {}; hdr.forEach((h, i) => o[h] = r[i]); return o; });
  } else objs = rows;

  const porVenta = {}, orden = [];
  objs.forEach(o => {
    const id = String(o['ID Venta'] || '').trim();
    const folio = String(o['Folio'] || '').trim();
    const key = id || folio;
    if (!key) return;
    if (!porVenta[key]){
      const subtotal = _num(o['Subtotal']), descMonto = _num(o['Descuento']);
      porVenta[key] = {
        id, folio, fecha: _parseFechaMX(o['Fecha']),
        cliente: { nombre: String(o['Cliente'] || '').trim() }, // fiscal: se completa del maestro
        ivaPct: _num(o['IVA %']), subtotal, descMonto, total: _num(o['Total']),
        // Sin redondear a 2 decimales de %: con descuentos grandes/muchas líneas ese
        // redondeo desviaba el total varios pesos y el motor lo reportaba como "revisa
        // IVA mixto" (no tenía nada que ver). Precisión completa -> el motor cuadra
        // exacto y su absorción de residuo (≤5¢) cubre lo que sobre de float.
        descPct: subtotal > 0 ? (descMonto / subtotal * 100) : 0,
        items: [],
      };
      orden.push(key);
    }
    const v = porVenta[key];
    const qty = _num(o['Cant.']);
    const clave = String(o['Código'] || '').trim();
    const desc = String(o['Descripción'] || '').trim();
    if (qty <= 0 && !clave && !desc) return;
    const regalo = /^s[ií]$/i.test(String(o['Regalo'] || '').trim());
    // Menú FACTURACION mejora #15: "Costo" ya venía en la fila (ERP_HDR del
    // apps_script del cotizador) pero se ignoraba -- sin él no se puede
    // calcular utilidad real de lo facturado, solo el importe cobrado.
    // "IVA línea" (auditoría 2026-09-25, H-13): la tasa de ESTE renglón. Antes
    // todos heredaban "IVA %" de la cabecera -- promediada en remisiones con
    // tasas mezcladas: 16 %+0 % llegaba como 8 %, una tasa válida, y el CFDI
    // salía con los dos conceptos al 8 % sin ningún aviso. Filas viejas sin
    // esa columna (o con la celda vacía) siguen usando "IVA %" como antes.
    const celdaIvaLinea = o['IVA línea'];
    const ivaRenglon = (celdaIvaLinea == null || String(celdaIvaLinea).trim() === '')
      ? v.ivaPct : _num(celdaIvaLinea);
    v.items.push({ qty, clave, desc, precio: _num(o['P. Esp.']), iva: ivaRenglon, regalo,
                   costo: _num(o['Costo']) });
  });
  return orden.map(k => porVenta[k]);
}

// Completa los datos fiscales del cliente de cada remisión desde el Cliente Maestro.
// Match por nombre normalizado (la remisión del ERP no trae RFC en este punto, solo
// el nombre del cliente). El maestro puede traer las columnas fiscales nuevas
// (RAZON_SOCIAL/REGIMEN/USO_CFDI); si no, quedan vacías y el semáforo las pedirá
// (y luego se escriben de vuelta — bidireccional).
function _norm(s){ return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function enriquecerClientes(remisiones, maestro){
  const porNombre = {};
  (maestro || []).forEach(c => {
    if (c.NOMBRE) porNombre[_norm(c.NOMBRE)] = c;
  });
  (remisiones || []).forEach(r => {
    const m = porNombre[_norm(r.cliente.nombre)] || null;
    if (!m) return;
    // F-importante: Sheets convierte celdas de aspecto numérico (CP, a veces
    // Régimen) a NÚMERO -- (m.CP || '').trim() truena (".trim is not a
    // function") sobre un número, incluso guardado desde la propia app vía
    // setValue. String(...) antes de trim() lo vuelve inmune al tipo real de
    // la celda; degradaba TODO el modo conectado a demo con un toast confuso.
    r.cliente.rfc           = String(m.RFC || '').trim();
    r.cliente.razonSocial   = String(m.RAZON_SOCIAL || m.NOMBRE || '').trim();
    // F-menor: si no hay Razón social fiscal capturada, se cae al nombre
    // comercial en silencio -- podría meterse en el CFDI un nombre distinto al
    // de la Constancia del cliente. Se marca para avisar en la UI (no bloquea).
    r.cliente.razonSocialEsFallback = !String(m.RAZON_SOCIAL || '').trim();
    r.cliente.regimenFiscal = String(m.REGIMEN || '').trim();
    r.cliente.usoCFDI       = String(m.USO_CFDI || '').trim();
    r.cliente.cp            = String(m.CP || '').trim();
    r.cliente.email         = String(m.CORREO || '').trim();
  });
  return remisiones;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { remisionesDeVentasERP, enriquecerClientes, _parseFechaMX };
}
