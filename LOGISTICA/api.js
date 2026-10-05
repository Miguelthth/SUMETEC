/* El token permanece en memoria; nunca forma parte de una URL ni de la cola. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LogisticaAPI=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 function validarURL(url){const u=new URL(url);if(u.search||u.hash||u.username||u.password||u.protocol!=='https:'||u.hostname!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(u.pathname))throw Error('Usa la dirección /exec del Apps Script compartido');return u.href;}
 function crear({url,token,fetch:enviar=globalThis.fetch,base}){
  validarURL(url);let enviando=false;
  async function post(datos,sinToken=false){const control=new AbortController(),timer=setTimeout(()=>control.abort(),45000);try{const r=await enviar(url,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...datos,...(!sinToken?{token:typeof token==='function'?await token():token}: {})}),signal:control.signal,cache:'no-store'});if(!r.ok)throw Error(`Servidor HTTP ${r.status}`);const d=await r.json();if(d.ok===false||d.error){const e=Error(d.mensaje||d.error?.mensaje||d.error||'El servidor rechazó la solicitud');e.respuesta=d;throw e;}return d;}finally{clearTimeout(timer);}}
  async function comprobar(){const d=await post({tipo:'ping'});if(!(Number(d.comercialContrato)>=1))throw Error('El servidor compartido necesita la actualización de Logística. Tus capturas siguen guardadas.');await post({tipo:'comercial_resumen'});return d;}
  async function descargar(){const desdeRevision=Number(await base.meta('syncCursor')||0);let cursor='',revision=desdeRevision,cambios=[],paginas=0;do{const d=await post({tipo:'comercial_sync',desdeRevision,...(cursor?{cursor}:{})});cambios.push(...(d.cambios||[]));cursor=d.cursorSiguiente||'';revision=d.siguienteRevision??revision;if(++paginas>1000)throw Error('Sincronización demasiado grande; conserva el cursor anterior');}while(cursor);const cfg=await post({tipo:'configuracion'});if(cfg.datos?.LOGISTICA)await base.guardarMeta('parametros',cfg.datos.LOGISTICA);await base.aplicarSync(cambios,revision);return cambios.length;}
  async function sincronizar(){if(enviando)return {ocupado:true};enviando=true;let confirmadas=0;try{await comprobar();for(const op of await base.pendientes()){
    if(['CONFLICTO','RECHAZADA'].includes(op.estadoLocal))continue;
    const {estadoLocal,creadoTs,intentos,detalle,...sobre}=op;
    try{const d=await post(sobre);if(d.operationId!==op.operationId||!(Number(d.revision||d.revisionServidor)>0))throw Error('Acuse distinto de la operación enviada');await base.marcarOperacion(op.operationId,'CONFIRMADA',{revision:d.revision});confirmadas++;}
    catch(e){const r=e.respuesta,conflicto=r?.codigo==='CONFLICTO_REVISION'||r?.conflicto||r?.error?.codigo==='CONFLICTO_REVISION';if(conflicto){await base.marcarOperacion(op.operationId,'CONFLICTO',{detalle:r});continue;}if(r?.reintentable){await base.marcarOperacion(op.operationId,'PENDIENTE',{detalle:r});throw e;}if(r){await base.marcarOperacion(op.operationId,'RECHAZADA',{detalle:r});continue;}await base.marcarOperacion(op.operationId,'PENDIENTE',{detalle:{mensaje:e.message}});throw e;}
   }const recibidas=await descargar();return {confirmadas,recibidas};}finally{enviando=false;}}
  return {post,comprobar,descargar,sincronizar,vincular:datos=>post({tipo:'vincular_dispositivo',app:'LOGISTICA',...datos},true)};
 }
 return {crear,validarURL};
});
