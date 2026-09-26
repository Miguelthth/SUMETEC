/**
 * pac_adapter.js — Adaptador de PAC INTERCAMBIABLE para timbrar.
 *
 * Idea: el resto del sistema llama a `timbrar(cfdi, cfg)` sin saber qué PAC hay
 * detrás. Hoy usa un PAC SIMULADO (mock) que regresa UUID y XML de práctica, SIN
 * validez fiscal y SIN gastar timbres. El día que haya token, se cambia `modo:'real'`
 * y se completa timbrarFacturapi() — nada más del sistema cambia.
 *
 * Funciones puras (construirXML) + el mock determinista salvo el UUID → se prueban
 * con `node --test`.
 */

function _x(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// UUID v4 (suficiente para simular el folio fiscal en práctica).
function _uuid(){
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  }).toUpperCase();
}

// Representación XML tipo CFDI 4.0 (SIMULADA, sin sello del SAT). Para practicar y
// ver "los dos archivos". NO es un comprobante válido ante el SAT.
function construirXML(cfdi, emisor, meta){
  const t = cfdi.totales;
  const conceptos = cfdi.conceptos.map(c => {
    const imp = c.impuestos
      ? `\n      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="${c.impuestos.base.toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${c.impuestos.tasa.toFixed(6)}" Importe="${c.impuestos.importe.toFixed(2)}"/></cfdi:Traslados></cfdi:Impuestos>`
      : '';
    return `    <cfdi:Concepto ClaveProdServ="${c.claveProdServ}" ClaveUnidad="${c.claveUnidad}" Cantidad="${c.cantidad}" Descripcion="${_x(c.descripcion)}" ValorUnitario="${(c.valorUnitario||0).toFixed(2)}" Importe="${c.importe.toFixed(2)}"${c.descuento?` Descuento="${c.descuento.toFixed(2)}"`:''}>${imp}\n    </cfdi:Concepto>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- SIMULADO: representación de práctica, SIN validez fiscal (sin sello del SAT). -->
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="4.0" TipoDeComprobante="I" Moneda="MXN" SubTotal="${t.subtotal.toFixed(2)}"${t.descuento?` Descuento="${t.descuento.toFixed(2)}"`:''} Total="${t.total.toFixed(2)}" MetodoPago="${cfdi.metodoPago}" FormaPago="${_x(cfdi.formaPago)}" Fecha="${meta.fecha}">
  <cfdi:Emisor Rfc="${_x(emisor.rfc)}" Nombre="${_x(emisor.nombre)}" RegimenFiscal="${_x(emisor.regimenFiscal)}"/>
  <cfdi:Receptor Rfc="${_x(cfdi.receptor.rfc)}" Nombre="${_x(cfdi.receptor.nombre)}" RegimenFiscalReceptor="${_x(cfdi.receptor.regimenFiscal)}" UsoCFDI="${_x(cfdi.receptor.usoCFDI)}" DomicilioFiscalReceptor="${_x(cfdi.receptor.domicilioFiscalReceptor)}"/>
  <cfdi:Conceptos>
${conceptos}
  </cfdi:Conceptos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${meta.uuid}" FechaTimbrado="${meta.fecha}" SelloSAT="SIMULADO"/></cfdi:Complemento>
</cfdi:Comprobante>`;
}

// PAC SIMULADO: arma una respuesta como si el timbrado hubiera sido exitoso.
function timbrarMock(cfdi, emisor){
  const uuid = _uuid();
  const fecha = new Date().toISOString().slice(0, 19);
  return { ok: true, simulado: true, uuid, fecha, sello: 'SIMULADO',
           xml: construirXML(cfdi, emisor, { uuid, fecha }) };
}

// timbrar (modo demo, navegador): SIEMPRE simulado. El timbrado REAL vive en el
// backend (apps_script_facturacion.gs), donde el token del PAC está seguro y nunca
// llega al navegador. Por eso aquí no hay llamada real al PAC.
function timbrar(cfdi, emisor){
  return Promise.resolve(timbrarMock(cfdi, emisor));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { timbrar, timbrarMock, construirXML };
}
