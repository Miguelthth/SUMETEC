/* Capturas persistentes y navegación principal de Logística. */
'use strict';
let demoLogistica=['127.0.0.1','localhost'].includes(location.hostname)&&new URLSearchParams(location.search).get('demo')==='1';
window.logisticaAccesoPermitido=()=>demoLogistica;
const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fechaVisible = valor => new Intl.DateTimeFormat('es-MX', { dateStyle:'medium', timeStyle:'short', timeZone:'America/Tijuana' }).format(new Date(valor));
const diaVisible = valor => new Intl.DateTimeFormat('es-MX', { dateStyle:'medium', timeZone:'America/Tijuana' }).format(new Date(valor + 'T12:00:00-07:00'));
const fechaTijuana = () => {
  const partes = new Intl.DateTimeFormat('sv-SE', { timeZone:'America/Tijuana', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
// Resuelve el desfase de Tijuana para la fecha elegida, incluso al cambiar horario de verano.
const hechoDesdeCampo = valor => LogisticaAlmacen.fechaDesdeTijuana(valor);
let baseLocal, modo = 'RUTAS', seleccionado = null, negocioCaptura = null, guardando = false;
let negociosActuales = [], timerMensaje;
const basePromesa = LogisticaAlmacen.abrir();
function avisar(texto) { $('mensaje').textContent=texto; $('mensaje').hidden=false; clearTimeout(timerMensaje); timerMensaje=setTimeout(()=>{$('mensaje').hidden=true;},4500); }
async function actualizarEstado() { const n=(await baseLocal.pendientes()).length; $('pendientes').textContent=n ? `${n} pendientes` : 'Datos locales'; }
function vacio(titulo, texto, boton, accion) { return `<section class="vacio"><h2>${titulo}</h2><p>${texto}</p><button type="button" data-accion="${accion}">${boton}</button></section>`; }
function tarjetaNegocio(n) { return `<article class="negocio"><span class="etiqueta ${n.noContacto?'no-contacto':''}">${n.noContacto?'No contactar':esc(n.clase)}</span><div><button class="nombre" type="button" data-negocio="${esc(n.id)}">${esc(n.nombre)}</button></div><p>${esc([n.contacto,n.zona].filter(Boolean).join(' · ') || 'Contacto y zona por completar')}</p></article>`; }
async function pintarDirectorio() {
  negociosActuales = await baseLocal.negocios();
  const contactos=await baseLocal.listar('contacto'),necesidades=await baseLocal.listar('necesidad');
  $('app').innerHTML=`<div class="encabezado"><div><span class="eyebrow">Prospectos · Directorio compartido</span><h1>Negocios</h1><p>Lo que sabes de cada negocio, antes de la próxima visita.</p></div><button type="button" data-accion="nuevo">Nuevo negocio</button></div>${negociosActuales.length?'<label class="busqueda" for="buscar-negocio">Buscar negocio, contacto o zona<input id="buscar-negocio" type="search" placeholder="Nombre, contacto, zona o giro"></label><div id="lista-negocios" class="lista-negocios"></div>':vacio('Empieza con lo que ya sabes','Un nombre provisional y lo que ocurrió en la visita son suficientes. El contacto y la ubicación pueden completarse después.','Registrar primer negocio','nuevo')}`;
  if (negociosActuales.length) {
    const filtrar=()=>{const q=$('buscar-negocio').value.trim().toLocaleLowerCase('es');const lista=negociosActuales.filter(n=>[n.nombre,n.contacto,n.zona,n.giro,...contactos.filter(c=>c.negocioId===n.id).flatMap(c=>[c.nombre,c.telefono,c.puesto]),...necesidades.filter(c=>c.negocioId===n.id).flatMap(c=>[c.producto,c.codigo,c.especificacion])].join(' ').toLocaleLowerCase('es').includes(q));$('lista-negocios').innerHTML=lista.map(tarjetaNegocio).join('')||'<p>No se encontraron negocios. Prueba otro nombre o zona.</p>';};
    $('buscar-negocio').oninput=filtrar;filtrar();
  }
}
async function pintarHoy() {
  const [negocios,visitas]=await Promise.all([baseLocal.negocios(),baseLocal.visitas()]);
  const hoy=fechaTijuana().slice(0,10);
  const elegibles=new Set(negocios.filter(n=>!n.noContacto&&!n.archivado).map(n=>n.id));
  const pendientes=visitas.filter(v=>elegibles.has(v.negocioId)&&(v.proximaAccion||v.seguimientoFecha)).sort((a,b)=>(a.seguimientoFecha||'9999').localeCompare(b.seguimientoFecha||'9999'));
  $('app').innerHTML=`<div class="encabezado"><div><span class="eyebrow">Rutas · Hoy</span><h1>Próximos pasos</h1><p>Prepara lo que acordaste antes de salir.</p></div><button type="button" data-accion="directorio">Ver negocios</button></div>${pendientes.length?'<div class="lista-negocios">'+pendientes.map(v=>{const n=negocios.find(n=>n.id===v.negocioId);if(!n)return '';return `<article class="negocio"><span class="etiqueta">${v.seguimientoFecha?(v.seguimientoFecha<hoy?'Seguimiento vencido':diaVisible(v.seguimientoFecha)):'Sin fecha acordada'}</span><div><button class="nombre" data-negocio="${esc(n.id)}" type="button">${esc(n.nombre)}</button></div><p>${esc(v.proximaAccion||'Contactar al negocio')}</p><button type="button" data-cerrar-seguimiento="${esc(v.id)}">Cerrar seguimiento</button></article>`;}).join('')+'</div>':vacio('Antes de salir','Elige los negocios que visitarás, confirma el material y registra cada parada. Tus compromisos y citas aparecerán aquí.','Organizar mi salida','preparar')}`;
}
async function pintarExpediente(id) {
  if(!window.logisticaAccesoPermitido()){avisar('Desbloquea el teléfono para consultar expedientes');return;}
  seleccionado=id;
  const {negocio:n,visitas,precios}=await baseLocal.expediente(id);
  const advertencia = precios.some((p,i)=>precios.slice(i+1).some(x=>x.producto.toLowerCase()===p.producto.toLowerCase()&&x.unidad.toLowerCase()===p.unidad.toLowerCase()));
  $('app').innerHTML=`<button class="volver" type="button" data-accion="volver">← Volver</button><div class="encabezado"><div><span class="eyebrow">${esc(n.clase)}${n.noContacto?' · No contactar':''}</span><h1>${esc(n.nombre)}</h1><p>${esc([n.contacto,n.telefono,n.zona].filter(Boolean).join(' · ')||'Contacto y ubicación por completar')}</p></div><div class="acciones-principales"><button type="button" data-accion="visita">Registrar visita</button><button class="secundario" type="button" data-accion="precio">Registrar precio</button></div></div><div class="bloques"><section class="panel"><h2>Visitas y próximos pasos</h2><div class="timeline">${visitas.map(v=>`<article class="evento"><time datetime="${esc(v.fechaHecho)}">${fechaVisible(v.fechaHecho)}</time><strong>${esc(LogisticaAlmacen.RESULTADOS[v.resultado])}</strong>${v.nota?`<p>${esc(v.nota)}</p>`:''}${v.proximaAccion||v.seguimientoFecha?`<p class="paso">${esc(v.proximaAccion||'Seguimiento')}${v.seguimientoFecha?`<br><small>${diaVisible(v.seguimientoFecha)}</small>`:''}</p>`:''}</article>`).join('')}</div></section><section class="panel"><h2>Precios ofrecidos</h2>${advertencia?'<p class="aviso-ofertas">Hay varias ofertas para el mismo producto y unidad. Revisa sus condiciones antes de preparar una propuesta.</p>':''}${precios.length?precios.map(p=>`<article class="precio-card"><strong>${esc(p.producto)}</strong><span class="importe">${esc(p.precio)} <small>${p.moneda}</small></span><p>Por ${esc(p.unidad)} · ${p.ivaIncluido?'IVA incluido':'Más IVA'} (${p.ivaTasa}%)</p><p>${p.vigenciaHasta?'Vigente hasta '+diaVisible(p.vigenciaHasta):'Sin vigencia acordada'}</p>${p.condiciones?`<p>${esc(p.condiciones)}</p>`:''}<p class="ayuda">Ofrecido · ${fechaVisible(p.fechaHecho)}</p></article>`).join(''):'<p class="ayuda">Todavía no hay precios registrados para este negocio.</p>'}<p class="ayuda">La captura de una visita no registra una compra. Consulta el consumo ERP en Compras confirmadas.</p></section></div>`;
}
async function pintar() {
  if(!window.logisticaAccesoPermitido()){if(typeof mostrarAccesoLogistica==='function')await mostrarAccesoLogistica();return;}
  $('app').setAttribute('aria-busy','true');
  try { if(typeof actualizarNavegacion==='function')actualizarNavegacion(); document.querySelectorAll('[data-modo]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.modo===modo)));if(seleccionado)await pintarExpediente(seleccionado);else if(typeof mostrarPantalla==='function')await mostrarPantalla(modo==='PROSPECTOS'?'directorio':'hoy');else if(modo==='PROSPECTOS')await pintarDirectorio();else await pintarHoy();await actualizarEstado(); }
  finally { $('app').setAttribute('aria-busy','false'); }
}
function abrirCaptura(id=null) {
  if(guardando||!window.logisticaAccesoPermitido())return;
  negocioCaptura=id;$('form-captura').reset();$('captura-error').textContent='';$('campos-negocio').hidden=!!id;$('negocio-nombre').required=!id;$('titulo-captura').textContent=id?'Registrar visita':'Nuevo negocio';$('guardar-captura').textContent=id?'Guardar visita':'Guardar negocio y visita';$('visita-fecha').value=fechaTijuana();$('captura').showModal();$(id?'visita-resultado':'negocio-nombre').focus();
}
document.querySelectorAll('[data-cerrar]').forEach(b=>b.onclick=()=>{if(!guardando)$(b.dataset.cerrar).close();});
for(const id of ['captura','precio'])$(id).addEventListener('cancel',e=>{if(guardando)e.preventDefault();});
document.querySelectorAll('[data-modo]').forEach(b=>b.onclick=async()=>{modo=b.dataset.modo;seleccionado=null;await baseLocal.guardarModo(modo);await pintar();});
$('app').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||guardando)return;
  try { if(b.dataset.negocio)return await pintarExpediente(b.dataset.negocio);switch(b.dataset.accion){case'preparar':seleccionado=null;await mostrarPantalla('preparar');break;case'nuevo':abrirCaptura();break;case'visita':abrirCaptura(seleccionado);break;case'precio':$('form-precio').reset();$('precio-error').textContent='';$('precio').showModal();await prepararCatalogoPrecio();$('precio-producto').focus();break;case'directorio':modo='PROSPECTOS';seleccionado=null;await baseLocal.guardarModo(modo);await pintar();break;case'volver':seleccionado=null;await pintar();break;} }catch(error){avisar(error.message);}
});
$('form-captura').onsubmit=async e=>{
  e.preventDefault();if(guardando)return;guardando=true;$('guardar-captura').disabled=true;$('captura-error').textContent='';
  try { const visita={decisorCompras:$('visita-decisor').checked,canal:$('visita-canal').value,resultado:$('visita-resultado').value,nota:$('visita-nota').value,proximaAccion:$('visita-accion').value,seguimientoFecha:$('visita-seguimiento').value||null,fechaHecho:hechoDesdeCampo($('visita-fecha').value)};if(negocioCaptura)await baseLocal.registrarVisita({...visita,negocioId:negocioCaptura});else await baseLocal.guardarAlta(Object.fromEntries(new FormData($('form-captura'))),visita);$('captura').close();await pintar();avisar('Negocio y visita guardados en este navegador'); }catch(error){$('captura-error').textContent=error.message;}finally{guardando=false;$('guardar-captura').disabled=false;}
};
$('form-precio').onsubmit=async e=>{
  e.preventDefault();if(guardando)return;const b=e.submitter;guardando=true;b.disabled=true;$('precio-error').textContent='';
  try {const incluido=$('precio-incluido').value;if(!$('precio-iva').value||!incluido)throw Error('Elige la tasa y cómo se ofreció el IVA');await baseLocal.guardarPrecio({negocioId:seleccionado,producto:$('precio-producto').value,codigo:$('precio-codigo').value||null,unidad:$('precio-unidad').value,precio:$('precio-importe').value,moneda:$('precio-moneda').value,ivaTasa:Number($('precio-iva').value),ivaIncluido:incluido==='si',condiciones:$('precio-condiciones').value,vigenciaHasta:$('precio-vigencia').value||null});$('precio').close();await pintar();avisar('Precio ofrecido guardado');}catch(error){$('precio-error').textContent=error.message;}finally{guardando=false;b.disabled=false;}
};
$('pendientes').onclick=async()=>{if(!baseLocal)return;if(!window.logisticaAccesoPermitido()){avisar('Desbloquea el teléfono para consultar capturas');return;}const cola=await baseLocal.pendientes();$('lista-cola').innerHTML=cola.length?cola.map(o=>`<div class="cola-fila">${({negocio:'Negocio',visita:'Visita',precio:'Precio ofrecido'})[o.entidad]||esc(o.entidad)} · ${esc(o.estadoLocal)}${o.detalle?'<p>'+esc(o.detalle.mensaje||o.detalle.codigo||'Revisar rechazo')+'</p>':''}${o.estadoLocal==='CONFLICTO'?'<button type="button" data-conflicto="'+esc(o.operationId)+'">Revisar conflicto</button>':''}<small>${fechaVisible(o.creadoTs)}</small></div>`).join(''):'<p>No hay capturas pendientes.</p>';$('cola').showModal();};
$('exportar').onclick=async()=>{try{if(!window.logisticaAccesoPermitido())throw Error('Desbloquea el teléfono antes de exportar');const copia=await baseLocal.exportar();const url=URL.createObjectURL(new Blob([JSON.stringify(copia,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`logistica-respaldo-${fechaTijuana().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);avisar('Respaldo descargado');}catch(e){avisar(e.message);}};
for(const [valor,nombre] of Object.entries(LogisticaAlmacen.RESULTADOS)){const o=document.createElement('option');o.value=valor;o.textContent=nombre;$('visita-resultado').appendChild(o);}
async function iniciar(){try{baseLocal=await basePromesa;modo=await baseLocal.modo();await pintar();}catch(e){$('app').textContent=e.message;$('app').setAttribute('aria-busy','false');$('pendientes').textContent='Guardado no disponible';}}
// Las pantallas y el acceso se cargan después de este archivo.
document.addEventListener('DOMContentLoaded',()=>iniciar().then(()=>iniciarExtras()).catch(e=>avisar(e.message)),{once:true});
