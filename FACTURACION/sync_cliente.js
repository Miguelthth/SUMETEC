(function(root){
  'use strict';
  const TEMAS={
    cotizador:['catalogo','clientes','clientes_maestro','productos_maestro','historial_precios','cobros_pendientes','configuracion'],
    gastos:['catalogo','listas_gasto','pendientes_factura','configuracion'],
    compras:['catalogo','listas_gasto','equivalencias','pendientes_factura','dashboard_snapshot','configuracion'],
    direccion:['catalogo','listas_gasto','equivalencias','dashboard_snapshot','configuracion'],
    logistica:['configuracion','comercial_revision'],
    facturacion:['ventas','clientes_maestro','facturadas','catalogo_fiscal','configuracion']
  };
  function segundosConsulta(s){
    if(!s.visible || !s.online)return null;
    if(s.fallos>0)return [30,60,120,300][Math.min(s.fallos-1,3)];
    return s.activo?(s.rapido?15:30):120;
  }
  function reconstruir(map){
    if(!map || !map._meta)throw new Error('SYNC_FOTOGRAFIA_INCOMPLETA');
    function expandir(v){
      if(v && typeof v==='object' && v.__syncArray!=null)return Object.keys(map).filter(k=>k!=='_meta' && map[k].path===v.__syncArray)
        .map(k=>map[k]).sort((a,b)=>a.orden-b.orden).map(x=>x.dato);
      if(v && typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expandir(x)]));
      return v;
    }
    const s=map._meta.esquema;if(s && s.__syncArray!=null)return expandir(s);
    if(s && s.__syncTexto)return expandir(s.__syncTexto).join('\n');
    return Object.fromEntries(Object.entries(s).map(([k,v])=>[k,expandir(v)]));
  }
  async function hash(s){
    const b=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
    return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function validarPagina(r,estado){
    if(!r || r.ok!==true || r.protocolo!==1 || !Array.isArray(r.eventos) || !r.epochs || !r.hasta || !r.horizonte)throw new Error('SYNC_RESPUESTA_INVALIDA');
    const siguiente=structuredClone(estado);
    for(const [t,ep] of Object.entries(r.epochs)){
      if(!siguiente.temas[t] || siguiente.temas[t].epoch!==ep)throw new Error('SYNC_EPOCH_INVALIDO');
    }
    for(const e of r.eventos){
      const t=siguiente.temas[e.tema];
      if(!t || !Number.isSafeInteger(e.seq) || e.seq!==t.cursor+1 || !['UPSERT','DELETE'].includes(e.accion) || typeof e.id!=='string')throw new Error('SYNC_SECUENCIA_INVALIDA');
      if(await hash(JSON.stringify(e.dato))!==e.checksum)throw new Error('SYNC_CHECKSUM_INVALIDO');
      if(e.accion==='DELETE')delete t.map[e.id];else t.map[e.id]=e.dato;
      t.cursor=e.seq;
    }
    for(const [t,c] of Object.entries(r.hasta))if(!siguiente.temas[t] || siguiente.temas[t].cursor!==c || c>r.horizonte[t])throw new Error('SYNC_CURSOR_INVALIDO');
    return siguiente;
  }
  function abrirDB(){return new Promise((resolve,reject)=>{
    const req=root.indexedDB.open('sumetec-sync-v1',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('estado');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });}
  async function leerDB(key){const db=await abrirDB();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('estado','readonly'),req=tx.objectStore('estado').get(key);let valor;
    req.onsuccess=()=>{valor=req.result;};tx.oncomplete=()=>resolve(valor);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}}
  async function guardarDB(key,valor){const db=await abrirDB();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('estado','readwrite');tx.objectStore('estado').put(valor,key);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('SYNC_ALMACENAMIENTO'));
  });}finally{db.close();}}
  const nativo=typeof root.fetch==='function'?root.fetch.bind(root):null;
  const sesiones=new Map();let escribiendo=0,actividad=Date.now(),rapidoAutorizado=false;
  let equipo='';
  if(root.document && root.crypto && root.crypto.randomUUID){try{equipo=root.localStorage.getItem('sumetec_sync_equipo') || root.crypto.randomUUID();root.localStorage.setItem('sumetec_sync_equipo',equipo);}catch(_){equipo=root.crypto.randomUUID();}}
  function appActual(){
    const fija=root.document && root.document.documentElement && root.document.documentElement.dataset.syncApp;if(fija)return fija;
    const p=String(root.location && root.location.pathname || '').toLowerCase();
    return p.includes('factur')?'facturacion':p.includes('logistica')?'logistica':p.includes('compras')?'compras':p.includes('gastos')?'gastos':(/dashboard|caja|direccion|inventario/.test(p)?'direccion':'cotizador');
  }
  function medir(m){
    const xs=api.metricas;xs.push({...m,origen:'navegador',fecha:new Date().toISOString()});if(xs.length>5000)xs.splice(0,xs.length-5000);
  }
  async function consultar(url,token,app,transporte){
    app=app || appActual();if(!url || !token)return null;
    if(!nativo || !root.indexedDB || !root.crypto || !root.crypto.subtle)return null;
    const key=await hash(url+'\n'+token+'\n'+app);let ses=sesiones.get(key);
    if(!ses){ses={key,url,app,enVuelo:null,activo:null,ultimo:0,invalido:false};sesiones.set(key,ses);}
    if(ses.legadoHasta && Date.now()<ses.legadoHasta)return null;
    if(ses.enVuelo)return ses.enVuelo;
    async function trabajo(){
      if(escribiendo)throw new Error('SYNC_CAPTURA_PRIORITARIA');
      let almacen=await leerDB(key) || {activo:{temas:{}},etapa:null,ultimo:0,versiones:{}};
      if((almacen.integridadActivo && await hash(JSON.stringify(almacen.activo))!==almacen.integridadActivo) ||
         (almacen.etapa && almacen.integridadEtapa && await hash(JSON.stringify(almacen.etapa))!==almacen.integridadEtapa)){
        almacen.requiereCompleto=true;almacen.ultimo=0;almacen.etapa=null;almacen.horizonte=null;
      }
      // navigator.locks permite que pestañas del mismo origen y credencial compartan la descarga.
      if(almacen.ultimo && Date.now()-almacen.ultimo<5000 && !ses.invalido){ses.activo=almacen.activo;ses.ultimo=almacen.ultimo;return almacen.versiones;}
      // F7-LOCAL: la hora del último «sin cambios» vive en memoria; vale mientras el almacén guardado sea el mismo.
      if(ses.sinCambiosTs && Date.now()-ses.sinCambiosTs<5000 && !ses.invalido && ses.sinCambiosHuella===almacen.integridadActivo){ses.activo=almacen.activo;return ses.sinCambiosR;}
      let temas=ses.temas || TEMAS[app] || [];let paginas=0;
      while(paginas++<1000){
        if(escribiendo)throw new Error('SYNC_CAPTURA_PRIORITARIA');
        const trabajo=almacen.etapa || almacen.activo,desde={},epochs={};
        temas.forEach(t=>{if(trabajo.temas[t]){desde[t]=trabajo.temas[t].cursor;epochs[t]=trabajo.temas[t].epoch;}});
        const body={tipo:'sync_cambios',token,app,equipo,temas,desde,epochs,limite:100};
        if(almacen.requiereCompleto){body.desde={};body.epochs={};}
        if(almacen.etapa)body.completo=true;
        if(almacen.horizonte)body.horizonte=almacen.horizonte;
        const inicio=Date.now();
        let r;const reintento=(ses.fallos||0)>0;
        try{
          if(transporte)r=await transporte(body);
          else{const ctrl=typeof root.AbortController==='function'?new root.AbortController():null;
            const limite=ctrl?root.setTimeout(()=>ctrl.abort(),60000):null;
            try{r=await (await nativo(url,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(body),...(ctrl?{signal:ctrl.signal}:{})})).json();}
            finally{if(limite)root.clearTimeout(limite);}
          }
        }
        catch(e){ses.fallos=(ses.fallos||0)+1;medir({app,equipo,clase:'sondeo',reintento,ms:Date.now()-inicio,bytes:0,eventos:0,ok:false});throw e;}
        ses.fallos=r.ok===true?0:(ses.fallos||0)+1;
        medir({app,equipo,clase:'sondeo',reintento,ms:Date.now()-inicio,bytes:new TextEncoder().encode(JSON.stringify(r)).length,eventos:(r.eventos||[]).length,ok:r.ok===true});
        if(r.codigo==='TEMAS_NO_AUTORIZADOS'){
          temas=(r.permitidos || []).filter(t=>(TEMAS[app] || []).includes(t));
          if(!temas.length)throw new Error('SYNC_NO_AUTORIZADO');
          ses.temas=temas;ses.activo=null;
          for(const t of Object.keys(almacen.activo.temas))if(!temas.includes(t))delete almacen.activo.temas[t];
          almacen.etapa=null;almacen.horizonte=null;await guardarDB(key,almacen);continue;
        }
        if(r.codigo==='ACTUALIZAR_SERVIDOR' || r.codigo==='SYNC_DESACTIVADO' || (r.ok===false && /tipo desconocido|tipo no reconocido/.test(r.error||''))){ses.legadoHasta=Date.now()+300000;return null;}
        if(r.codigo==='REQUIERE_COMPLETO'){
          const estado={temas:{},horizonte:{}};temas.forEach(t=>{const m=r.metas && r.metas[t];if(!m)throw new Error('SYNC_META_INVALIDA');estado.temas[t]={epoch:m.epoch,cursor:m.min,map:{}};estado.horizonte[t]=m.seq;});
          almacen.etapa=estado;almacen.horizonte=estado.horizonte;almacen.requiereCompleto=false;await guardarDB(key,almacen);continue;
        }
        if(r.ok!==true)throw new Error(r.codigo || r.error || 'SYNC_NO_AUTORIZADO');
        if(r.sinCambios===true){
          if(r.mas || r.eventos.length || almacen.etapa)throw new Error('SYNC_VACIO_INVALIDO');
          // F7-LOCAL (auditoría 2026-10-14, B2): nada cambió desde los cursores guardados, así que el almacén ya validado
          // (su huella se comprobó al leerlo) sigue siendo el vigente: no se clona, no se reconstruye ni se reescribe
          // completo en cada sondeo. Solo se recuerda en memoria cuándo se consultó.
          if(temas.every(t=>trabajo.temas[t])){
            rapidoAutorizado=r.siguienteSegundos===15;
            ses.activo=almacen.activo;ses.ultimo=Date.now();ses.invalido=false;
            ses.sinCambiosTs=ses.ultimo;ses.sinCambiosR=r;ses.sinCambiosHuella=almacen.integridadActivo;return r;
          }
          r.epochs=Object.fromEntries(Object.entries(trabajo.temas).map(([t,v])=>[t,v.epoch]));
          r.hasta=Object.fromEntries(Object.entries(trabajo.temas).map(([t,v])=>[t,v.cursor]));r.horizonte={...r.hasta};
        }
        rapidoAutorizado=r.siguienteSegundos===15;
        let siguiente;
        try{siguiente=await validarPagina(r,trabajo);}catch(e){almacen.requiereCompleto=true;await guardarDB(key,almacen);throw e;}
        almacen.horizonte=r.horizonte;
        if(almacen.etapa){siguiente.horizonte=r.horizonte;almacen.etapa=siguiente;}
        else almacen.activo=siguiente;
        if(!r.mas){
          Object.values(siguiente.temas).forEach(t=>reconstruir(t.map));
          almacen.activo=siguiente;almacen.etapa=null;almacen.ultimo=Date.now();
          almacen.horizonte=null;
          almacen.versiones=r;
        }
        // Entidades y cursor se confirman juntos; no se modifica una cola ni un PIN.
        almacen.integridadActivo=await hash(JSON.stringify(almacen.activo));
        almacen.integridadEtapa=almacen.etapa?await hash(JSON.stringify(almacen.etapa)):null;
        await guardarDB(key,almacen);
        if(!r.mas){ses.activo=almacen.activo;ses.ultimo=almacen.ultimo;ses.invalido=false;return r;}
        if(root.document && root.document.hidden)throw new Error('SYNC_PAUSA_OCULTA');
      }
      throw new Error('SYNC_DEMASIADAS_PAGINAS');
    }
    ses.enVuelo=(root.navigator && root.navigator.locks?root.navigator.locks.request('sumetec-sync-'+key,trabajo):trabajo());
    try{return await ses.enVuelo;}finally{ses.enVuelo=null;}
  }
  function reloj(fn,opciones){
    opciones=opciones || {};let timer=null,enVuelo=false,fallos=0,ultima=0,detenido=false;
    function intervalo(){return segundosConsulta({visible:!root.document.hidden,online:root.navigator.onLine,activo:Date.now()-actividad<120000,fallos,rapido:opciones.rapido===true || rapidoAutorizado});}
    function programar(){if(timer)root.clearTimeout(timer);const s=intervalo();if(s!=null&&!detenido)timer=root.setTimeout(tick,s*1000*(0.9+Math.random()*0.2));}
    async function tick(){
      if(detenido||enVuelo)return;
      if(intervalo()==null || escribiendo || Date.now()-ultima<5000){programar();return;}
      enVuelo=true;ultima=Date.now();
      try{const r=await fn();if(r===false || r===null)throw new Error('SYNC_SIN_RESULTADO');fallos=0;}catch(_){fallos++;}
      finally{enVuelo=false;programar();}
    }
    function despertar(){if(intervalo()!=null)tick();else if(timer)root.clearTimeout(timer);}
    root.document.addEventListener('visibilitychange',despertar);root.addEventListener('online',despertar);root.addEventListener('offline',despertar);
    programar();return {consultar:tick,detener(){detenido=true;if(timer)root.clearTimeout(timer);root.document.removeEventListener('visibilitychange',despertar);root.removeEventListener('online',despertar);root.removeEventListener('offline',despertar);}};
  }
  async function leer(url,token,app,tema,transporte){
    const r=await consultar(url,token,app,transporte);if(!r)return null;
    const key=await hash(url+'\n'+token+'\n'+app),s=sesiones.get(key);
    return reconstruir(s.activo.temas[tema].map);
  }
  const api={segundosConsulta,reconstruir,validarPagina,consultar,leer,reloj,metricas:[],appActual,invalidar(){sesiones.forEach(s=>{s.invalido=true;});},exportarMetricas(){return api.metricas.map(x=>JSON.stringify(x)).join('\n');}};
  root.SumetecSync=api;
  if(root.document){['pointerdown','keydown','touchstart'].forEach(e=>root.document.addEventListener(e,()=>{actividad=Date.now();},{passive:true}));}
  // El adaptador reutiliza las lecturas existentes: las pantallas reciben su contrato habitual.
  // Solo tipos de lectura sin parámetros se sirven del diario. Escrituras usan el transporte original.
  if(nativo && root.document && root.Response){root.fetch=async function(input,options){
    let d;try{d=options && typeof options.body==='string'?JSON.parse(options.body):null;}catch(_){}
    if(!d || !d.token || options.method!=='POST')return nativo(input,options);
    const app=appActual(),tipos=TEMAS[app] || [],lectura=tipos.includes(d.tipo) && !d.mes && !d.folio && !d.fecha;
    if(d.tipo==='ping' || lectura){
      if(d.tipo==='ping'){const k=await hash(String(input)+'\n'+d.token+'\n'+app),ses=sesiones.get(k);if(ses && ses.acuse && Date.now()-ses.acuseTs<5000)return new root.Response(JSON.stringify(ses.acuse),{status:200,headers:{'Content-Type':'application/json'}});}
      // F7-SOND (auditoría 2026-10-19): si el diario no puede contestar (tema pendiente, una escritura en vuelo, red),
      // el ping o la lectura siguen por el camino de siempre. Antes se rechazaban: la app marcaba «servidor lento»,
      // se saltaba los reintentos de sus colas y dejaba de bajar los cobros de los demás teléfonos.
      let r=null;
      try{r=await consultar(String(input),d.token,app);}catch(_){r=null;}
      if(r){
        if(d.tipo==='ping')return new root.Response(JSON.stringify(r),{status:200,headers:{'Content-Type':'application/json'}});
        const key=await hash(String(input)+'\n'+d.token+'\n'+app),ses=sesiones.get(key),t=ses && ses.activo && (!ses.temas || ses.temas.includes(d.tipo)) && ses.activo.temas[d.tipo];
        if(t)return new root.Response(JSON.stringify(reconstruir(t.map)),{status:200,headers:{'Content-Type':'application/json'}});
      }
      return nativo(input,options);
    }
    // Las consultas ajenas al diario no son escrituras: este contador solo prioriza capturas conocidas.
    const escritura=/^(actualizar_|nuevo_|remision$|cotizacion$|gasto$|compra_campo$|abono_|devolucion_|movimiento_|anular_|cancelar_|eliminar_|cerrar_|facturar$|guardar_|comercial_operacion$|buzon_recibir$|buzon_procesar$)/.test(d.tipo || '');
    if(!escritura)return nativo(input,options);
    escribiendo++;actividad=Date.now();const inicio=Date.now();
    let resultado=false,tamano=0;
    try{const r=await nativo(input,options);try{const datos=await r.clone().json();resultado=datos.ok===true;tamano=new TextEncoder().encode(JSON.stringify(datos)).length;if(resultado && typeof datos.ver==='number' && typeof datos.configVer==='number'){const k=await hash(String(input)+'\n'+d.token+'\n'+app);let ses=sesiones.get(k);if(!ses){ses={key:k,url:String(input),app,enVuelo:null,activo:null,ultimo:0,invalido:true};sesiones.set(k,ses);}ses.acuse=datos;ses.acuseTs=Date.now();}}catch(_){}return r;}
    finally{escribiendo--;sesiones.forEach(s=>{s.invalido=true;});medir({app,equipo,clase:'envio',ms:Date.now()-inicio,bytes:tamano,entradaBytes:new TextEncoder().encode(options.body).length,ok:resultado});}
  };}
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
