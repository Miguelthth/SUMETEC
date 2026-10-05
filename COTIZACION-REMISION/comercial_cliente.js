/* Integración comercial optativa. Su cola nunca contiene pagos ni inventario. */
(function(root){
  'use strict';
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function borradorPropuesta(propuesta,catalogo){
    return (propuesta.items||[]).map(i=>{
      const p=catalogo.find(p=>p.clave===i.codigo);
      return {clave:p?p.clave:'',desc:p?p.desc:i.descripcion||i.codigo||'',
        qty:Number(i.cantidad)>0?Number(i.cantidad):'',precio:'',
        unidadPropuesta:i.unidad||'',acuerdoId:i.acuerdoId||null,revisarUnidad:true};
    });
  }
  function crearComercialCliente(deps){
    const store=deps.storage, clave='sumetec_cot_comercial_v1';
    let estado=JSON.parse(store.getItem(clave)||'{"revision":0,"registros":{},"cola":[],"referencia":null}');
    let enviando=false;
    const guardar=()=>store.setItem(clave,JSON.stringify(estado));
    const activo=()=>deps.habilitado()===true;
    async function sync(){
      if(!activo())return {ok:false,estado:'DESACTIVADO'};
      let cursor='', registros={...estado.registros}, revision=estado.revision, fragmentos={};
      do{
        const r=await deps.pedir({tipo:'comercial_sync',desdeRevision:estado.revision,cursor});
        if(!r.ok)throw Error(r.error||r.codigo||'Consulta comercial rechazada');
        for(const c of r.cambios||[]){
          if(c.entidad==='vinculo'&&c.datos.fragmentos){
            const id=c.datos.snapshotId, grupo=fragmentos[id]||(fragmentos[id]={partes:[],revision:c.revision});
            grupo.partes[c.datos.fragmento]=c.datos;
            if(grupo.partes.filter(Boolean).length===c.datos.fragmentos){
              for(const k of Object.keys(registros))if(k.startsWith('vinculo:'))delete registros[k];
              registros['vinculo:'+id]={id,entidad:'vinculo',revisionServidor:c.revision,
                filas:grupo.partes.flatMap(p=>p.filas||[])};
            }
          }else registros[c.entidad+':'+c.registroId]={...c.datos,id:c.registroId,entidad:c.entidad,revisionServidor:c.revision};
        }
        cursor=r.cursorSiguiente||'';revision=r.siguienteRevision==null?revision:r.siguienteRevision;
      }while(cursor);
      estado.registros=registros;estado.revision=revision;guardar();return {ok:true};
    }
    function referenciaURL(url){
      const q=new URL(url).searchParams, negocioId=q.get('negocioId'),propuestaId=q.get('propuestaId');
      if(!UUID.test(negocioId||'')||!UUID.test(propuestaId||''))return null;
      return {negocioId,propuestaId};
    }
    function seleccionar(nombre){
      if(!activo())return null;
      const registros=Object.values(estado.registros);
      const negocios=registros.filter(r=>r.entidad==='negocio'&&(r.clienteERP===nombre||r.nombre===nombre));
      const vinculos=registros.filter(r=>r.entidad==='vinculo').flatMap(r=>r.filas||[])
        .filter(r=>r.clienteERP===nombre||(r.alias||[]).includes(nombre));
      const ids=[...new Set([...negocios.map(r=>r.id),...vinculos.map(r=>r.negocioId)])];
      const anterior=estado.referencia;
      estado.referencia=ids.length===1?{negocioId:ids[0],
        propuestaId:anterior&&anterior.negocioId===ids[0]?anterior.propuestaId:null,cliente:nombre}:null;
      guardar();return estado.referencia;
    }
    function preparar(url){
      const ref=referenciaURL(url);if(!activo()||!ref)return null;
      const propuesta=estado.registros['propuesta:'+ref.propuestaId];
      if(!propuesta||propuesta.negocioId!==ref.negocioId)throw Error('Propuesta no encontrada para este establecimiento');
      estado.referencia={...ref,cliente:propuesta.clienteERP||propuesta.nombreNegocio||''};guardar();
      return {referencia:{...estado.referencia},propuesta};
    }
    function restaurar(ref){estado.referencia=ref&&UUID.test(ref.negocioId)?{...ref}:null;guardar();}
    function referencia(nombre){const r=estado.referencia;return activo()&&r&&(!nombre||!r.cliente||r.cliente===nombre)?{...r}:null;}
    function consulta(){
      const ref=referencia();if(!ref)return {precios:[],ubicaciones:[]};
      const registros=Object.values(estado.registros).filter(r=>r.negocioId===ref.negocioId);
      return {precios:registros.filter(r=>r.entidad==='precio'),ubicaciones:registros.filter(r=>r.entidad==='ubicacion'&&r.confirmada===true)};
    }
    function referenciaDocumento(folio){
      const docs=Object.values(estado.registros).filter(r=>r.entidad==='documento'&&r.folio===folio&&r.tipoDocumento==='COTIZACION')
        .sort((a,b)=>b.revisionServidor-a.revisionServidor);
      const d=docs[0];return d?{negocioId:d.negocioId,propuestaId:d.propuestaId||null}:null;
    }
    function encolar(entidad,payload){
      if(!activo())return null;
      const op={tipo:'comercial_operacion',entidad,accion:'agregar',operationId:deps.uuid(),registroId:deps.uuid(),fechaHecho:new Date().toISOString(),payload};
      estado.cola.push(op);guardar();return op;
    }
    function documento(tipo,localId,folio,ref){
      ref=ref||referencia();if(!ref||!activo())return null;
      const llave=tipo+':'+localId+':'+folio;
      if((estado.documentos||[]).includes(llave))return null;
      const op=encolar('documento',{negocioId:ref.negocioId,propuestaId:ref.propuestaId||undefined,tipoDocumento:tipo,documentoLocal:String(localId),folio});
      estado.documentos=[...(estado.documentos||[]),llave];guardar();return op;
    }
    function ubicacion(lat,lng){const ref=referencia();if(!ref)throw Error('Selecciona un establecimiento vinculado');
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw Error('Coordenada inválida');
      return encolar('ubicacion',{negocioId:ref.negocioId,lat,lng,confirmada:true,procedencia:'CONFIRMADA_COTIZADOR'});
    }
    async function enviar(){
      if(!activo()||enviando)return;enviando=true;
      try{for(const op of [...estado.cola]){
        const r=await deps.pedir(op);
        if(!r.ok||r.operationId!==op.operationId)break;
        estado.cola=estado.cola.filter(x=>x.operationId!==op.operationId);guardar();
      }}finally{enviando=false;}
    }
    return {sync,seleccionar,preparar,referencia,restaurar,consulta,documento,ubicacion,enviar,referenciaURL,referenciaDocumento,pendientes:()=>estado.cola.length};
  }
  if(typeof module!=='undefined')module.exports={crearComercialCliente,borradorPropuesta};
  root.crearComercialCliente=crearComercialCliente;
  if(!root.document)return;
  root.COMERCIAL_HABILITADO=false; // activar conscientemente tras aceptación local
  const cliente=crearComercialCliente({storage:localStorage,habilitado:()=>root.COMERCIAL_HABILITADO,
    uuid:()=>crypto.randomUUID(),pedir:async datos=>{
      if(typeof API_TOKEN==='undefined'||!API_TOKEN)throw Error('Vincula este Cotizador');
      const r=await sumetecFetchLimite(getScriptUrl(),{method:'POST',cache:'no-store',headers:{'Content-Type':'text/plain'},body:JSON.stringify({...datos,token:API_TOKEN})});return r.json();
    }});
  root.ComercialCliente=cliente;
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function panel(){
    let el=document.getElementById('comercialClientePanel');
    if(!el){el=document.createElement('section');el.id='comercialClientePanel';el.className='card';document.body.append(el);}
    el.hidden=!root.COMERCIAL_HABILITADO;if(el.hidden)return;
    const datos=cliente.consulta();
    el.innerHTML='<h3>Expediente comercial</h3><p>Los precios siguientes son referencias con sus condiciones. Confirma cada precio en la cotización.</p>'+
      datos.precios.map(p=>'<p>'+esc(p.codigo||p.producto||p.descripcion)+' · '+esc(p.precio)+' '+esc(p.moneda)+' / '+esc(p.unidad)+' · IVA '+esc(p.ivaTasa)+'% '+(p.ivaIncluido?'incluido':'adicional')+' · '+esc(p.vigenciaHasta||'sin vigencia pactada')+' · '+esc(p.condiciones||'')+'</p>').join('')+
      '<p>'+datos.ubicaciones.length+' ubicación(es) confirmada(s) · '+cliente.pendientes()+' pendiente(s)</p><button type="button" id="comercialConsultar">Consultar expediente</button> <button type="button" id="comercialConfirmarGPS">Confirmar ubicación actual</button>';
    document.getElementById('comercialConsultar').onclick=()=>root.consultarComercialCliente();
    document.getElementById('comercialConfirmarGPS').onclick=()=>{
      if(!confirm('¿Estás en el establecimiento seleccionado y confirmas guardar su ubicación?'))return;
      navigator.geolocation.getCurrentPosition(p=>{try{cliente.ubicacion(p.coords.latitude,p.coords.longitude);cliente.enviar().catch(e=>toast(e.message,'err'));panel();}catch(e){toast(e.message,'err');}},e=>toast(e.message,'err'),{enableHighAccuracy:true,timeout:10000,maximumAge:0});
    };
  }
  root.consultarComercialCliente=async function(nombre){
    if(!root.COMERCIAL_HABILITADO)return;
    try{await cliente.sync();cliente.seleccionar(nombre||document.getElementById(_enModoCotizacion()?'cot_c_nombre':'c_nombre')?.value||'');await cliente.enviar();panel();}catch(e){toast(e.message,'err');}
  };
  root.prepararPropuestaComercial=async function(){
    if(!root.COMERCIAL_HABILITADO)return;
    try{await cliente.sync();const data=cliente.preparar(location.href);if(!data)return;
      if(!confirm('¿Abrir una cotización nueva para esta propuesta? Revisa cliente, productos y precios antes de guardar.'))return;
      // Abrir el modo existente conserva sus reglas de moneda e IVA.
      if(typeof _activarModoCot==='function')_activarModoCot();
      const nombre=data.referencia.cliente;
      const sugeridas=borradorPropuesta(data.propuesta,typeof PRODUCTOS==='undefined'?[]:PRODUCTOS);
      restoreCotDraft({c_nombre:nombre,comercial:data.referencia,items:sugeridas,
        obs:'Revisar unidades, códigos, precios y condiciones: '+(data.propuesta.items||[]).map(i=>String(i.cantidad||'')+' '+String(i.unidad||'')+' de '+String(i.descripcion||i.codigo||'')).join('; ')});
      autosaveCot();
      panel();toast('Propuesta vinculada. Captura y confirma los productos y precios en Cotizador.','ok');
    }catch(e){toast(e.message,'err');}
  };
  root.addEventListener('online',()=>cliente.enviar().catch(()=>{}));
  root.addEventListener('DOMContentLoaded',()=>{panel();if(root.COMERCIAL_HABILITADO)root.prepararPropuestaComercial();});
})(typeof window==='undefined'?globalThis:window);
