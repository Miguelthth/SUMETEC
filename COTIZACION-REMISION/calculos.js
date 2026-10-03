/**
 * calculos.js — Funciones PURAS de remisión/cotización.
 *
 * Aquí viven los cálculos de dinero, formato y texto: las únicas funciones del
 * sistema sin efectos secundarios (no tocan el DOM, ni la red, ni localStorage).
 * Se extrajeron de remision.html para poder:
 *   1) probarlas directo con `node --test` (ver tests/calculos.test.js), y
 *   2) cambiarlas en UN solo lugar sin bucear en las 5,800 líneas del HTML.
 *
 * Se carga en el navegador con  <script src="./calculos.js"></script>  ANTES del
 * <script> principal de remision.html, así que estas funciones quedan como
 * globales (window.esc, window._calcTot, …) igual que antes — el resto del
 * código las usa sin cambiar nada.
 *
 * IMPORTANTE: este archivo debe estar cacheado por el Service Worker (sw.js)
 * para que la app siga funcionando sin internet. Si renombras o mueves este
 * archivo, actualiza la lista STATIC de sw.js y sube la versión del caché.
 */

// Escapa un valor para contexto de TEXTO o ATRIBUTO HTML normal.
function esc(v){return v==null?'':String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

// Escapa un valor para incrustarlo dentro de una cadena JS entre comillas SIMPLES
// que a su vez vive en un atributo HTML entre comillas DOBLES, p. ej.:
//   onclick="f('AQUÍ')"
// Cubre el doble contexto (HTML + JS) para que nombres con ' " < > \ o saltos de
// línea no rompan el markup ni la llamada. Nota: NO uses esc() en este contexto —
// esc() convierte ' en &#39;, que el navegador decodifica a ' y cierra la cadena JS.
function escAttr(v){return v==null?'':String(v)
  .replace(/&/g,'&amp;')
  .replace(/\\/g,'\\\\')
  .replace(/'/g,"\\'")
  .replace(/"/g,'&quot;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/\r?\n/g,' ');}

// Núcleo del dinero: cada importe, descuento e IVA se redondea por renglón.
// `historico` conserva el cálculo anterior SOLO al reimprimir una remisión vieja.
function _calcTot(arr,descPct,redondear,historico){
  const pct=(+descPct||0)/100;
  let subC=0,descC=0,ivaC=0,arts=0,pzs=0;
  let subViejo=0,ivaViejo=0;
  (arr||[]).forEach(it=>{
    const q=+it.qty||0,p=+it.precio||0,v=+it.iva||0;
    if(q>0)pzs+=q;
    if(!(q>0&&p>0)||it.regalo)return;
    arts++;
    if(historico===true){subViejo+=q*p;ivaViejo+=q*p*(1-pct)*(v/100);return;}
    const importeC=Math.round(q*p*100+1e-7);
    const descuentoC=Math.round(importeC*pct+1e-7);
    const baseC=importeC-descuentoC;
    subC+=importeC;descC+=descuentoC;
    ivaC+=Math.round(baseC*v/100+1e-7);
  });
  if(historico===true){
    const descViejo=subViejo*pct, bruto=subViejo-descViejo+ivaViejo;
    const redon=!!redondear && (historico===true || !(ivaViejo>0));
    return{sub:subViejo,iva:ivaViejo,desc:descViejo,
           tot:redon?Math.round(bruto):Math.round(bruto*100)/100,arts,pzs};
  }
  return{sub:subC/100,iva:ivaC/100,desc:descC/100,
         tot:(subC-descC+ivaC)/100,arts,pzs};
}

function redondeoEfectivo(){return false;}

// Costo correcto para medir margen (2026-07-30, pedido de Miguel): el IVA que
// pagas al comprar solo se recupera si la venta también lleva IVA (se acredita
// contra el que cobras). Si vendes esa misma pieza al 0% (sin factura, la
// mayoría de sus ventas), ese IVA de compra NUNCA se recupera y se vuelve
// costo real. Por eso el margen usa un costo distinto según el IVA de LA
// VENTA, no un costo fijo por producto:
//   venta CON IVA (8/16%) → costo SIN IVA (it.costo) — se acredita.
//   venta AL 0%           → costo CON IVA (it.costoIva) — no se acredita.
// it.costoIva llega vacío para productos capturados a mano (Productos
// Maestro) o catálogos viejos sin publicar todavía la columna nueva — en ese
// caso cae a it.costo, mismo comportamiento que antes de este cambio.
function costoEfectivo(it){
  const sinIva=+it.costo||0, conIva=+it.costoIva||sinIva;
  return (+it.iva>0)?sinIva:conIva;
}

function margenLinea(it, descPct){
  const q=+it.qty||0;
  const tot=_calcTot([it], descPct, false);
  const ingreso=Math.round((tot.sub-tot.desc)*100)/100;
  const costo=q*costoEfectivo(it);
  const utilidad=ingreso-costo;
  return {ingreso,costo,utilidad,
    margenPct:ingreso>0?Math.round(utilidad/ingreso*1000)/10:null};
}

// Regla de pago válido (R-02). Un abono/pago_completo debe ser un número finito > 0.
// Una anulación es válida con cualquier monto (revierte un pago previo por su pago_ref).
// La usa el cliente (aplicarPago) y el servidor la replica como última línea de defensa
// contra items de cola corruptos/reenviados que traigan monto 0, negativo, NaN o Infinity.
function pagoValido(monto, tipo){
  if(tipo==='anulacion') return true;
  const m=+monto;
  return Number.isFinite(m) && m>0;
}

// Tasa de IVA a MOSTRAR en un documento (PDF de remisión, PDF de cotización,
// popup de confirmación). Se deriva SIEMPRE de las líneas realmente cobradas de
// ESE documento -- nunca de la variable global de sesión (ivaGlobal): al
// reimprimir una remisión vieja la global ya vale otra cosa y el PDF salía con
// una tasa que no era la de esa venta (el monto sí era correcto, la etiqueta no).
// Mismo filtro de dinero que _calcTot: sin cantidad, sin precio o REGALO no cuenta.
// Todas iguales -> "16%" · distintas -> "mixto" · ninguna línea cobrada -> "0%".
function tasaIvaLbl(arr){
  const cobradas=(arr||[]).filter(it=>(+it.qty>0)&&(+it.precio>0)&&!it.regalo);
  const tasas=new Set(cobradas.map(it=>Math.round(+it.iva||0)));
  if(tasas.size===0) return '0%';
  return tasas.size===1 ? ([...tasas][0])+'%' : 'mixto';
}

// Formato de moneda: $1,234.50
// H7: un valor no finito (NaN/Infinity, p. ej. dato corrupto) se trata como 0 para
// que NUNCA aparezca "$NaN" en pantalla o en un PDF.
function fmt(n){const x=Number.isFinite(+n)?+n:0;return'$'+x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',')}

// MC-04: parser ÚNICO del campo de monto a abonar. Antes el input era type=number
// (sin $ ni comas); al volverlo texto para poder mostrar "$1,234.56" mientras se
// escribe, parseFloat() ya no basta -- "1,234.56" con parseFloat da 1. Todo el
// código que lee montoAbono debe pasar por AQUÍ, nunca por su propio parseFloat.
// "PENDIENTE" no es un monto -- es la señal de que se registra SIN pago (a
// crédito), así que vale 0 a propósito.
function parseMonto(v){
  if(v==null)return 0;
  const s=String(v).trim();
  if(!s||/^pendiente$/i.test(s))return 0;
  const limpio=s.replace(/[^0-9.]/g,'');
  const n=parseFloat(limpio);
  return Number.isFinite(n)?Math.round(n*100)/100:0;
}
// Formatea lo que el usuario escribe con "$" y comas EN VIVO (doc COTIZADOR:
// "$ y comas mientras se escribe"). "PENDIENTE" se deja tal cual, sin tocarlo.
// Puramente texto->texto -- parseMonto() sigue leyendo el resultado sin problema.
function formatearMontoTexto(v){
  const s=String(v==null?'':v);
  if(/^pendiente$/i.test(s.trim()))return s;
  const limpio=s.replace(/[^0-9.]/g,'');
  if(!limpio)return '';
  const partes=limpio.split('.');
  const entero=(partes[0].replace(/^0+(?=\d)/,'')||'0');
  const dec=partes.length>1?'.'+partes.slice(1).join('').slice(0,2):'';
  const conComas=entero.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return '$'+conComas+dec;
}

// Importe a letras con centavos: 232 → "DOSCIENTOS TREINTA Y DOS PESOS 00/100 MXN"
// H6/H7: protege contra valores no finitos y negativos. `words` cubre 0…999,999,999;
// arriba de eso degrada de forma legible (no devuelve "undefined").
function n2l(n){let v=Number.isFinite(+n)?+n:0;if(v<0)v=0;let e=Math.floor(v),d=Math.round((v-e)*100);if(d>=100){e+=Math.floor(d/100);d=d%100;}return words(e)+' PESOS '+String(d).padStart(2,'0')+'/100 MXN'}

// Entero a palabras en español (0 … 999,999,999).
function words(n){
  if(n===0)return'CERO';
  const U=['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE'];
  const D=['','DIEZ','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
  const C=['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
  const V=['VEINTE','VEINTIUNO','VEINTIDÓS','VEINTITRÉS','VEINTICUATRO','VEINTICINCO','VEINTISÉIS','VEINTISIETE','VEINTIOCHO','VEINTINUEVE'];
  if(n<0)return'MENOS '+words(-n);if(n<20)return U[n];
  if(n<30)return V[n-20];
  if(n<100){const d=Math.floor(n/10),u=n%10;return u===0?D[d]:D[d]+' Y '+U[u]}
  if(n===100)return'CIEN';if(n<1000){const c=Math.floor(n/100),r=n%100;return C[c]+(r>0?' '+words(r):'')}
  if(n<2000)return'MIL'+(n%1000>0?' '+words(n%1000):'');
  if(n<1000000){const m=Math.floor(n/1000),r=n%1000;return words(m)+' MIL'+(r>0?' '+words(r):'')}
  const m=Math.floor(n/1000000),r=n%1000000;return(m===1?'UN MILLÓN':words(m)+' MILLONES')+(r>0?' '+words(r):'');
}

// Normaliza un teléfono a formato wa.me (dígitos con lada de país).
// "664 123 4567" → "526641234567" · "+52 664..." → "52664..." · inválido → "".
// México: 10 dígitos locales; con 52/521 delante ya trae país.
function telWA(tel){
  const d=String(tel==null?'':tel).replace(/\D/g,'');
  if(d.length===10)return'52'+d;
  if((d.length===12&&d.startsWith('52'))||(d.length===13&&d.startsWith('521')))return d;
  return'';
}

// Mensaje de recordatorio de cobro para WhatsApp. Campos opcionales se omiten.
// {cliente, saldo, folio?, fecha?, dias?, nRem?} → texto listo para encodeURIComponent.
function msgCobroWA(o){
  const quien=(o.cliente||'').trim();
  let que;
  if(o.folio){
    que='la remisión *'+o.folio+'*'+(o.fecha?' del '+o.fecha:'');
  }else if(o.nRem>1){
    que=o.nRem+' remisiones pendientes';
  }else{
    que='tu cuenta pendiente';
  }
  return'Hola'+(quien?' '+quien:'')+' 👋\n'
    +'Te recuerdo el saldo de '+que+':\n'
    +'💰 *'+fmt(o.saldo)+' MXN*'
    +(o.dias>0?'  (hace '+o.dias+' día'+(o.dias===1?'':'s')+')':'')+'\n'
    +'¿Me confirmas cuándo podrías cubrirlo? ¡Gracias! — SUMETEC';
}

// Menú COTIZADOR mejoras #3/#4 (2026-07-14): agrega TODAS las líneas de producto de
// un conjunto de remisiones locales (rem.data.items) por código -- volumen ($, sin
// IVA) y margen. Mismo criterio de dinero que _calcTot: excluye regalo (no se cobra)
// y líneas sin cantidad/precio. Sirve tanto para "dona de rentabilidad" (agrupada por
// tier) como "dispersión volumen×margen" (misma agregación, ordenada distinto).
// Un ítem sin costo capturado (costo<=0 en TODAS sus líneas) no tiene margen
// calculable -- se marca tier:'sinCosto' en vez de inventar un número.
function rentabilidadPorProducto(remisionesConItems){
  const porCodigo={};
  (remisionesConItems||[]).forEach(rem=>{
    const items=(rem&&rem.data&&rem.data.items)||[];
    const pct=(+(rem&&rem.data&&rem.data.descPct)||0)/100;
    items.forEach(it=>{
      const q=+it.qty||0, p=+it.precio||0;
      if(!(q>0)||!(p>0)||it.regalo) return;
      const clave=String(it.clave||it.desc||'(sin código)').trim()||'(sin código)';
      const costo=costoEfectivo(it);
      const e=porCodigo[clave]||(porCodigo[clave]={clave,desc:it.desc||clave,volumen:0,costoTot:0,ingresoConCosto:0,tieneCosto:false});
      const importeC=Math.round(q*p*100+1e-7);
      const neto=(importeC-Math.round(importeC*pct+1e-7))/100;
      e.volumen+=neto;
      if(costo>0){ e.costoTot+=q*costo; e.ingresoConCosto+=neto; e.tieneCosto=true; }
    });
  });
  return Object.values(porCodigo).map(e=>{
    const completa=e.volumen>0 && Math.abs(e.volumen-e.ingresoConCosto)<0.005;
    const utilidadParcial=e.tieneCosto?Math.round((e.ingresoConCosto-e.costoTot)*100)/100:null;
    const margenParcialPct=(e.tieneCosto&&e.ingresoConCosto>0)
      ?Math.round((utilidadParcial/e.ingresoConCosto)*1000)/10:null;
    const margenPct=completa?margenParcialPct:null;
    const coberturaCostoPct=e.volumen>0?Math.round(e.ingresoConCosto/e.volumen*1000)/10:0;
    const tier=!completa?(e.tieneCosto?'incompleto':'sinCosto')
      :(margenPct>=40?'alto':(margenPct>=15?'medio':'bajo'));
    return {clave:e.clave,desc:e.desc,volumen:Math.round(e.volumen*100)/100,
      costoConocido:Math.round(e.costoTot*100)/100,utilidadParcial,
      margenPct,margenParcialPct,coberturaCostoPct,completa,tier};
  }).sort((a,b)=>b.volumen-a.volumen);
}

// Menú COTIZADOR mejora #6 (2026-07-14): simulador de escenario de precio -- puro,
// no toca el catálogo real ni ninguna remisión. Mismo margen=(precio-costo)/precio
// que ya usa _infoMargen. precio<=0 (sin dato) devuelve null en vez de forzar 0/NaN.
function simulaEscenarioPrecio(costo, precioActual, precioNuevo){
  const c=Math.max(0,+costo||0), pa=+precioActual||0, pn=+precioNuevo||0;
  const margen=p=>p>0?((p-c)/p*100):null;
  const util =p=>p>0?(p-c):null;
  const ma=margen(pa), mn=margen(pn), ua=util(pa), un=util(pn);
  return {
    margenActual:ma==null?null:Math.round(ma*10)/10,
    margenNuevo:mn==null?null:Math.round(mn*10)/10,
    utilidadActual:ua==null?null:Math.round(ua*100)/100,
    utilidadNueva:un==null?null:Math.round(un*100)/100,
    deltaUtilidadPct:(ua!=null&&un!=null&&ua!==0)?Math.round((un-ua)/Math.abs(ua)*1000)/10:null
  };
}

// ════════════════════════════════════════════════════════════════════════════
// MENÚ COTIZADOR 2026-09-02 — funciones puras de las 4 mejoras nuevas.
// Viven aquí (y no en remision.html) por la misma razón que el resto del
// archivo: son las que tocan dinero, así que tienen que poder probarse con
// `node --test` sin abrir un navegador.
// ════════════════════════════════════════════════════════════════════════════

// Fecha "dd/mm/aaaa" (el formato de todo el sistema) -> Date local, o null.
// Se parte el texto a mano, NUNCA new Date(str): eso corre el día por zona
// horaria (ya mordió a INVENTARIO, ver ESTADO_PROYECTOS 2026-07-13).
function parseFechaMX(s){
  if(s instanceof Date) return s;
  const m=String(s==null?'':s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if(!m) return null;
  let y=+m[3]; if(y<100) y+=2000;
  return new Date(y,(+m[2])-1,+m[1]);
}

// Los pagos que DE VERDAD entraron: sin las anulaciones, sin los pagos que una
// anulación revirtió (pago_ref) y sin los que el servidor rechazó.
// Este filtro ya vivía copiado en 5 lugares de remision.html; el "cierre del
// día" era el único que se lo saltaba, así que un pago ya anulado seguía
// contando como cobrado. Ahora la regla vive en un solo lugar.
function pagosValidosDe(rem){
  const ps=(rem&&rem.pagos)||[];
  const anulados=new Set(ps.filter(p=>p&&p.tipo==='anulacion').map(p=>p.pago_ref));
  return ps.filter(p=>p&&p.tipo!=='anulacion'&&!p._rechazado&&!anulados.has(p.uuid));
}

// Pagos que de verdad entraron POR ESTE CELULAR (para corte de caja y "cobrado
// hoy"). Re-auditoría 2026-09-25 (N-19, mejora B7): el renglón `ajuste_erp` ("Saldo
// inicial ERP") NO es un cobro de hoy -- resume lo que se cobró en el mostrador
// del ERP, sin método y con la fecha en que se PUBLICÓ la venta. Cuenta para el
// saldo (por eso pagosValidosDe lo conserva), pero no para el efectivo del día.
function pagosDeCajaDe(rem){
  return pagosValidosDe(rem).filter(p=>p.tipo!=='ajuste_erp');
}

// ── #1 CORTE DE CAJA ────────────────────────────────────────────────────────
// "¿cuánto efectivo debe haber en la caja AHORA?" — pagos de UNA fecha, dentro
// de un rango de horas (hFin exclusivo), agrupados por método de pago.
// ponytail: un pago sin `hora` (capturado antes de que se empezara a guardar)
// cae siempre en "todo el día" -- no se reparte a un turno. Sencillo y correcto
// para el caso que hoy existe; si algún día vuelven a faltar horas masivamente,
// revisar aquí primero.
function corteDeCaja(remisiones, fechaTxt, hIni, hFin){
  const ini=(hIni==null?0:+hIni), fin=(hFin==null?24:+hFin);
  const porMetodo={}; const detalle=[]; let total=0;
  (remisiones||[]).forEach(r=>{
    pagosDeCajaDe(r).forEach(p=>{
      if(p.fecha!==fechaTxt) return;
      const monto=+p.monto||0; if(!(monto>0)) return;
      const hh = p.hora ? parseInt(String(p.hora).split(':')[0],10) : NaN;
      if(!isNaN(hh)&&(hh<ini||hh>=fin)) return; // sin hora -> nunca se excluye de un turno
      const met=p.metodo||'Efectivo';
      porMetodo[met]=Math.round(((porMetodo[met]||0)+monto)*100)/100;
      total+=monto;
      detalle.push({folio:r.folio||'', cliente:r.cliente||'', hora:p.hora||'',
                    metodo:met, monto:Math.round(monto*100)/100});
    });
  });
  detalle.sort((a,b)=>String(a.hora).localeCompare(String(b.hora)));
  // H-16: mismos alias que _FORMAS_PAGO_ALIAS_.EFECTIVO y formas_pago.py;
  // conservar nombres originales en el desglose, normalizar solo el cálculo.
  const efectivo=Object.entries(porMetodo).reduce((s,[met,monto])=>
    s+(['efectivo','efvo','en efectivo','efectivo mxn','cash'].includes(_normNombre(met))?monto:0),0);
  return {porMetodo, efectivo:Math.round(efectivo*100)/100,
          total:Math.round(total*100)/100, n:detalle.length, detalle};
}

// ── #2 COSTOS QUE SUBIERON Y PRECIOS QUE NO ─────────────────────────────────
// Cruza el catálogo (precio de venta + el costo con el que se fijó ese precio)
// contra el historial de compras REALES del ERP. Devuelve los productos cuyo
// último costo pagado subió más de `umbralPct` sobre el costo del catálogo:
// ahí el margen se está encogiendo solo y nadie se entera.
// `hist` acepta Map u objeto llano: clave(minúsculas) -> [{fecha,costo,distribuidor}]
// del más viejo al más nuevo (el mismo HISTORIAL_PRECIOS que ya carga la app).
// ponytail: no calcula precio sugerido -- eso ya lo hace 💲 Simulador de precio
// con el costo nuevo pegado ahí. Duplicarlo aquí era la misma cuenta dos veces.
function costosQueSubieron(productos, hist, umbralPct){
  const umbral=(umbralPct==null?3:+umbralPct);
  const get=k=>{ if(!hist) return []; return (typeof hist.get==='function'? hist.get(k) : hist[k])||[]; };
  const filas=[];
  (productos||[]).forEach(p=>{
    const h=get(String(p.clave==null?'':p.clave).toLowerCase());
    if(!h.length) return;
    const ult=h[h.length-1];
    const costoNuevo=+ult.costo||0, costoCat=+p.costo||0;
    if(!(costoNuevo>0)||!(costoCat>0)) return;
    const subioPct=(costoNuevo-costoCat)/costoCat*100;
    if(!(subioPct>umbral)) return;
    const precio=+p.precio||0;
    const mAntes = precio>0 ? (precio-costoCat)/precio*100 : null;
    const mAhora = precio>0 ? (precio-costoNuevo)/precio*100 : null;
    filas.push({
      clave:p.clave, desc:p.desc||p.clave, precio,
      costoCatalogo:Math.round(costoCat*100)/100,
      costoNuevo:Math.round(costoNuevo*100)/100,
      subioPct:Math.round(subioPct*10)/10,
      margenAntes:mAntes==null?null:Math.round(mAntes*10)/10,
      margenAhora:mAhora==null?null:Math.round(mAhora*10)/10,
      fecha:ult.fecha||'', distribuidor:ult.distribuidor||''
    });
  });
  return filas.sort((a,b)=>b.subioPct-a.subioPct);
}

// Nombre de cliente normalizado (sin acentos, sin mayúsculas, sin espacios
// dobles) para que "Ferretería López" y "FERRETERIA LOPEZ" no se cuenten como
// dos clientes distintos al sumar su deuda.
function _normNombre(s){
  return String(s==null?'':s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
}

// ── #3 DEUDA DE UN CLIENTE (aviso antes de darle más crédito) ───────────────
// Suma lo que ese cliente ya debe en la cartera y qué tan vieja es la más vieja.
function deudaCliente(cobros, cliente, hoy){
  const nom=_normNombre(cliente);
  if(!nom) return {saldo:0,n:0,maxDias:0};
  const ahora=hoy||new Date();
  let saldo=0,n=0,maxDias=0;
  (cobros||[]).forEach(c=>{
    if(_normNombre(c.cliente)!==nom) return;
    const s=+c.saldo||0; if(!(s>0)) return;
    saldo+=s; n++;
    const f=parseFechaMX(c.fecha);
    const d=f?Math.floor((ahora-f)/86400000):0;
    if(d>maxDias)maxDias=d;
  });
  return {saldo:Math.round(saldo*100)/100, n, maxDias};
}

// ── #4 QUIÉN ME PAGA RÁPIDO Y QUIÉN NO ──────────────────────────────────────
// Días entre la fecha de la remisión y la fecha del pago que la LIQUIDÓ, por
// cliente. Solo cuenta remisiones ya liquidadas: si todavía te debe, aún no
// sabes cuánto tarda — eso es cartera, no historial de pago (y ya se ve en
// "Antigüedad de la deuda"). Ordena del más lento al más rápido, que es el
// orden en el que sirve para decidir a quién le das crédito.
function diasPagoPorCliente(remisiones){
  const porCli={};
  (remisiones||[]).forEach(r=>{
    if(!r||r.estado==='cancelada') return;
    const fRem=parseFechaMX(r.fecha); if(!fRem) return;
    // N-19b (2026-09-25): sin el renglón técnico `ajuste_erp` -- su fecha es la de PUBLICACIÓN,
    // no la del cobro, y falsearía los días de cobro (una venta cobrada en mostrador sin fecha
    // conocida simplemente no entra a la estadística).
    const validos=pagosDeCajaDe(r);
    const liquida=validos.filter(p=>p.tipo==='pago_completo'||(+p.saldo_despues)===0);
    if(!liquida.length) return;
    const fPago=parseFechaMX(liquida[liquida.length-1].fecha); if(!fPago) return;
    const dias=Math.max(0,Math.round((fPago-fRem)/86400000));
    const nom=(r.cliente||'').trim()||'(sin nombre)';
    const e=porCli[nom]||(porCli[nom]={cliente:nom,n:0,suma:0,diasMax:0,monto:0});
    e.n++; e.suma+=dias; e.monto+=(+r.total||0);
    if(dias>e.diasMax)e.diasMax=dias;
  });
  return Object.values(porCli).map(e=>({
    cliente:e.cliente, n:e.n,
    diasProm:Math.round(e.suma/e.n*10)/10,
    diasMax:e.diasMax, monto:Math.round(e.monto*100)/100
  })).sort((a,b)=>b.diasProm-a.diasProm);
}

// ── Propuesta 5 (mejoras ecosistema 2026-09-10): utilidad de la operación ──
// "Después del descuento y los regalos, ¿cuánto me deja esta venta?" -- SOLO
// informativo, no cambia el IVA ni el total de la remisión.
//   ingreso = subtotal SIN IVA ya descontado (el IVA no es tuyo: se entera).
//   costo   = cantidad × costoEfectivo() de cada pieza que SALE, regalos
//             incluidos (se regalan pero sí te costaron). costoEfectivo ya
//             aplica la regla de Miguel: venta con IVA → costo sin IVA,
//             venta al 0% → costo con IVA.
// Una pieza sin costo capturado NO cuenta como $0: marca completa=false para
// que la pantalla diga "estimación incompleta" en vez de inflar la utilidad.
function utilidadOperacion(arr, descPct){
  const t=_calcTot(arr||[],descPct,false);
  const ingreso=t.sub-t.desc;
  let costo=0, sinCosto=0;
  (arr||[]).forEach(it=>{
    const q=+it.qty||0;
    if(!(q>0)) return;
    if(!(+it.precio>0)&&!it.regalo) return;   // mismo filtro de renglón activo que registrarTodo
    const c=costoEfectivo(it);
    if(c>0) costo+=q*c; else sinCosto++;
  });
  const r2=n=>Math.round(n*100)/100;
  const utilidad=ingreso-costo;
  return {ingreso:r2(ingreso), costo:r2(costo), utilidad:r2(utilidad),
          margenPct: ingreso>0 ? Math.round(utilidad/ingreso*1000)/10 : null,
          sinCosto, completa: sinCosto===0};
}

// Regla de DESCUENTO GLOBAL válido (M-05, auditoría de robustez 2026-09-10).
// Con 150% de descuento sobre un producto de $100 al 8% el celular llegaba a crear
// una remisión de −$54, y el servidor convertía ese total negativo a cero en
// silencio: además de ser un importe incoherente, celular y servidor dejaban de
// cuadrar. Los límites min/max del campo HTML no bastan — no impiden que los
// botones ejecuten el guardado. La usan el cliente (antes de calcular y registrar)
// y el servidor (última línea de defensa contra un payload corrupto o reenviado).
function descuentoValido(descPct){
  const d = +descPct;
  return Number.isFinite(d) && d >= 0 && d <= 100;
}

// Un renglón cobrable necesita cantidad y precio finitos y no negativos.
// Infinity/NaN entran por un campo pegado a mano o por una cola corrupta.
function renglonValido(it){
  if (!it) return false;
  const q = +it.qty, p = +it.precio;
  return Number.isFinite(q) && q >= 0 && Number.isFinite(p) && p >= 0;
}

// FIRMA-01 (auditoría incremental 2026-09-28): la firma se guardaba con la forma del LIENZO (que toma el
// tamaño de la pantalla) y el PDF la estiraba a un recuadro fijo de 52×18 mm: un círculo salía comprimido
// 15-28 % (giro horizontal) o estirado ~380 % (vertical). Estas dos funciones puras arreglan las dos mitades.
//
// recortarTrazoFirma: rectángulo (con margen) que ocupa la TINTA de la firma en un RGBA de ancho×alto.
// Tinta = píxel opaco y oscuro; la guía gris punteada del lienzo no cuenta. null si no hay trazo.
function recortarTrazoFirma(datos, ancho, alto, margen){
  let x0=ancho, y0=alto, x1=-1, y1=-1;
  for(let y=0;y<alto;y++){
    for(let x=0;x<ancho;x++){
      const i=(y*ancho+x)*4;
      if(datos[i+3]>40 && (datos[i]+datos[i+1]+datos[i+2])/3<170){
        if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
      }
    }
  }
  if(x1<0) return null;
  const m=Math.max(0,margen|0);
  x0=Math.max(0,x0-m); y0=Math.max(0,y0-m); x1=Math.min(ancho-1,x1+m); y1=Math.min(alto-1,y1+m);
  return {x:x0, y:y0, w:x1-x0+1, h:y1-y0+1};
}
// encajarImagen: tamaño y posición para meter una imagen w×h en una caja sin deformarla (escala uniforme).
// apoyada=true: centrada a lo ancho y apoyada abajo (la firma "sobre la línea"); false: centrada en ambos ejes.
function encajarImagen(w, h, cajaW, cajaH, apoyada){
  if(!(w>0 && h>0 && cajaW>0 && cajaH>0)) return {w:cajaW, h:cajaH, dx:0, dy:0};
  const esc=Math.min(cajaW/w, cajaH/h), ew=w*esc, eh=h*esc;
  return {w:ew, h:eh, dx:(cajaW-ew)/2, dy:apoyada===false ? (cajaH-eh)/2 : cajaH-eh};
}

// F3N-04 (auditoría incremental 2026-09-28): cuánto se cobró de una remisión. Cancelarla sin
// revertir esos cobros dejaba el dinero vivo en Pagos y en la Caja de la nube. Toma lo mayor entre
// la suma de los cobros vigentes (sin anulaciones) y lo que dice el saldo del servidor, para que
// una remisión traída del servidor (sin lista de pagos) también se detecte.
function cobradoDeRemision(r){
  if(!r) return 0;
  const porPagos=pagosValidosDe(r).reduce((s,p)=>s+(Number(p.monto)||0),0);
  const saldo=Number(r.saldo), total=Number(r.total);
  const porSaldo=(Number.isFinite(saldo)&&Number.isFinite(total)&&r.estado!=='pendiente')?Math.max(0,total-saldo):0;
  return Math.max(porPagos,porSaldo);
}

// Exportar para los tests de Node sin afectar al navegador (allí no existe `module`).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, escAttr, fmt, n2l, words, _calcTot, redondeoEfectivo, costoEfectivo, margenLinea, pagoValido,
                      descuentoValido, renglonValido, telWA, msgCobroWA, tasaIvaLbl,
                      rentabilidadPorProducto, simulaEscenarioPrecio,
                      parseFechaMX, pagosValidosDe, cobradoDeRemision, recortarTrazoFirma, encajarImagen, pagosDeCajaDe, corteDeCaja, costosQueSubieron,
                      deudaCliente, diasPagoPorCliente, utilidadOperacion,
                      parseMonto, formatearMontoTexto };
}
