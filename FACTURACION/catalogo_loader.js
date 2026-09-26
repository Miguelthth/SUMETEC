/**
 * catalogo_loader.js — Convierte el CSV del catálogo fiscal en el objeto que
 * espera el motor: { CODIGO: { claveProdServ, claveUnidad, confianza, estatus } }.
 *
 * El catálogo NO trae tasa de IVA -- motor_cfdi.js siempre la toma del renglón
 * de la remisión ("espejo de la remisión"), nunca de aquí. Hubo una columna
 * IVA_TASA hasta 2026-09-01: se parseaba pero ningún código la leía -- quedó
 * como dato muerto que podía confundir a quien la viera y asumiera que ahí se
 * controlaba el IVA. Se quitó del CSV, del generador y de este loader.
 *
 * Función PURA (recibe el texto del CSV, no lee archivos ni red) → se prueba con
 * `node --test` y se usa igual en el navegador (tras hacer fetch del CSV) y en
 * Apps Script. Parsea CSV con comillas (las descripciones traen comas).
 */

// Parser CSV mínimo pero correcto: respeta comillas, comas y CRLF/LF. Quita BOM.
function parseCSV(text){
  text = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (inQ){
      if (c === '"'){ if (text[i+1] === '"'){ field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* ignora */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// CSV → { map, total, porConfirmar }. `map` es lo que consume el motor.
//
// Dos formatos de CSV conviven a propósito (2026-09-23): el de red
// (CODIGO,DESCRIPCION,CLAVE_PRODSERV,CLAVE_UNIDAD,ESTATUS_SAT -- publicado por
// el ERP, services/publicar.py::csv_catalogo_fiscal, SUGERIDA/CONFIRMADA) y el
// viejo respaldo local generado por generar_catalogo.py (trae además
// CLAVE_PRODSERV_DESC/CONFIANZA/ESTATUS="POR CONFIRMAR" fijo) para cuando
// facturas.html abre sin conexión al backend. Se detecta por la columna
// ESTATUS_SAT: si está, manda; si no, cae al criterio viejo.
function cargarCatalogo(csvText){
  const rows = parseCSV(csvText).filter(r => r.length > 1 && (r[0] || '').trim() !== '');
  if (!rows.length) return { map: {}, total: 0, porConfirmar: 0 };
  const head = rows[0].map(h => h.trim().toUpperCase());
  const col = name => head.indexOf(name);
  const iCod = col('CODIGO'), iPS = col('CLAVE_PRODSERV'), iU = col('CLAVE_UNIDAD'),
        iConf = col('CONFIANZA'), iEst = col('ESTATUS'), iEstSat = col('ESTATUS_SAT');
  const map = {};
  const duplicados = [];
  let porConfirmar = 0;
  for (let i = 1; i < rows.length; i++){
    const r = rows[i];
    const cod = (r[iCod] || '').trim();
    if (!cod) continue;
    if (map[cod] && duplicados.indexOf(cod) === -1) duplicados.push(cod); // código repetido: dato a corregir en el ERP
    const estatusSat = iEstSat >= 0 ? (r[iEstSat] || '').trim() : '';
    const estatus = iEst >= 0 ? (r[iEst] || '').trim() : '';
    if (iEstSat >= 0 ? estatusSat !== 'CONFIRMADA' : /CONFIRMAR/i.test(estatus)) porConfirmar++;
    map[cod] = {
      claveProdServ: iPS >= 0 ? (r[iPS] || '').trim() : '',
      claveUnidad:   iU  >= 0 ? (r[iU]  || '').trim() : 'H87',
      confianza:     iConf>= 0 ? (r[iConf] || '').trim() : '',
      estatus: estatusSat || estatus,
    };
  }
  return { map, total: Object.keys(map).length, porConfirmar, duplicados };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCSV, cargarCatalogo };
}
