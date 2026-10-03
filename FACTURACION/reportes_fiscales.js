/**
 * reportes_fiscales.js — Reportes derivados de las remisiones/facturas ya
 * cargadas en facturas.html (menú FACTURACION mejoras #14/#15/#16).
 *
 * Funciones PURAS (no leen red ni DOM) → se prueban con `node --test` y se
 * usan igual en el navegador. No recalculan IVA/total (regla de dinero de
 * SUMETEC): utilidadFacturada() suma subtotal-antes-de-IVA y costo por línea,
 * que son datos NUEVOS derivados (utilidad), no una re-multiplicación del IVA.
 */

// Menú #14: ¿a qué clientes les debo facturar más este mes? Ranking por monto
// SIN facturar (usa r.total, el total ESPEJO que ya trae la remisión del ERP).
function rankingClientesSinFacturar(remisionesDelMes) {
  const porCliente = {};
  (remisionesDelMes || []).forEach(r => {
    if (r.facturada) return;
    const nombre = (r.cliente && r.cliente.nombre) || String(r.cliente || '—');
    const monto = +r.total || 0;
    porCliente[nombre] = (porCliente[nombre] || 0) + monto;
  });
  return Object.entries(porCliente)
    .map(([cliente, monto]) => ({ cliente, monto }))
    .filter(r => r.monto > 0)
    .sort((a, b) => b.monto - a.monto);
}

// Menú #15: utilidad real de lo YA facturado -- ingreso (subtotal después de
// descuento, sin IVA) menos costo (cant × costo por línea). Excluye regalo
// (no se cobra) y líneas sin qty/precio, mismo criterio que _calcTot.
// Requiere que las líneas traigan `costo` (ver fix en ventas_erp_loader.js);
// si NINGUNA línea trae costo (dato viejo sin republicar), margenPct sale null
// en vez de 0%, para no mentir "utilidad cero" cuando en realidad falta el dato.
function utilidadFacturada(remisionesFacturadas) {
  let ingreso = 0, ingresoConCosto = 0, costo = 0, tieneCosto = false, todasConCosto = true;
  (remisionesFacturadas || []).forEach(r => {
    const descPct = (+r.descPct || 0) / 100;
    (r.items || []).forEach(it => {
      const q = +it.qty || 0, p = +it.precio || 0, c = +it.costo || 0;
      if (!(q > 0) || !(p > 0) || it.regalo) return;
      const importeC = Math.round(q * p * 100 + 1e-7);
      const neto = (importeC - Math.round(importeC * descPct + 1e-7)) / 100;
      ingreso += neto;
      const ce = +(it.costoEfectivo != null ? it.costoEfectivo
        : ((+it.iva > 0) ? c : (+it.costoIva || c))) || 0;
      if (ce > 0) { costo += q * ce; ingresoConCosto += neto; tieneCosto = true; }
      else todasConCosto = false;
    });
  });
  ingreso = Math.round(ingreso * 100) / 100;
  ingresoConCosto = Math.round(ingresoConCosto * 100) / 100;
  costo = Math.round(costo * 100) / 100;
  const completa = ingreso > 0 && todasConCosto;
  const utilidadParcial = tieneCosto ? Math.round((ingresoConCosto - costo) * 100) / 100 : null;
  const margenParcialPct = (tieneCosto && ingresoConCosto > 0)
    ? Math.round((utilidadParcial / ingresoConCosto) * 1000) / 10 : null;
  const utilidad = completa ? utilidadParcial : null;
  return {
    ingreso, costo, completa,
    coberturaCostoPct: ingreso > 0 ? Math.round((ingresoConCosto / ingreso) * 1000) / 10 : 0,
    utilidad, utilidadParcial,
    margenPct: completa ? margenParcialPct : null,
    margenParcialPct,
  };
}

// Menú #16: huecos en la serie de folio fiscal propio ("F-0001", "F-0002"…).
// Un hueco real solo puede pasar si el contador (Apps Script) se incrementó
// pero la fila nunca se escribió (error entre asignar el número y guardar) --
// cancelar una factura NO borra su fila ni su número (ver cancelarFactura_),
// así que las canceladas NO cuentan como hueco.
function huecosFolioFiscal(facturas) {
  const nums = (facturas || [])
    .map(f => {
      const m = String((f && f['Serie/Folio']) || '').trim().match(/^F-(\d+)$/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter(n => n !== null);
  if (!nums.length) return { max: 0, n: 0, huecos: [] };
  const set = new Set(nums);
  const max = Math.max(...nums);
  const huecos = [];
  for (let i = 1; i <= max; i++) if (!set.has(i)) huecos.push(i);
  return { max, n: nums.length, huecos, huecosFmt: huecos.map(n => 'F-' + String(n).padStart(4, '0')) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rankingClientesSinFacturar, utilidadFacturada, huecosFolioFiscal };
}
