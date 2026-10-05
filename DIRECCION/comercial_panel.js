/* Lectura comercial separada del snapshot financiero. */
(function(root){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function renderComercialResumen(r){
    const c=r.conteos||{}, meta=(r.cobertura||{}).consumo||{};
    return '<section id="comercialDireccion"><h2>Actividad comercial</h2><p>Consulta '+esc(r.servidorTs)+' · revisión '+esc(r.revision)+'</p><p>'+esc(c.negocio||0)+' establecimientos · '+esc(c.visita||0)+' visitas · '+esc(c.oportunidad||0)+' oportunidades · '+esc(c.compromiso||0)+' compromisos</p><p>Consumo ERP: '+esc(meta.estado||'NO_PUBLICADO')+' · '+esc(meta.publicadoTs||'sin publicación')+'</p><button type="button" id="comercialDireccionActualizar">Actualizar actividad comercial</button></section>';
  }
  async function leerComercialResumen(pedir){const r=await pedir({tipo:'comercial_resumen'});if(!r.ok)throw Error(r.error||r.codigo||'Consulta comercial rechazada');return r;}
  if(typeof module!=='undefined')module.exports={renderComercialResumen,leerComercialResumen};
  root.COMERCIAL_HABILITADO=false;
  root.mostrarPanelComercialDireccion=async function(pin){
    if(!root.COMERCIAL_HABILITADO)return;
    let host=document.getElementById('comercialDireccionHost');
    if(!host){host=document.createElement('div');host.id='comercialDireccionHost';document.querySelector('#app').append(host);}
    host.textContent='Consultando actividad comercial…';
    try{const token=await abrirSesionDireccion(pin);const r=await leerComercialResumen(async d=>{
      const controller=new AbortController(), reloj=setTimeout(()=>controller.abort(),20000);
      try{return await fetch(localStorage.getItem('sumetec_direccion_url'),{method:'POST',cache:'no-store',headers:{'Content-Type':'text/plain'},body:JSON.stringify({...d,token}),signal:controller.signal}).then(x=>x.json());}finally{clearTimeout(reloj);}
    });
      if(typeof vistaActivaDireccion==='function'&&vistaActivaDireccion()!=='resumen')return;
      host.innerHTML=renderComercialResumen(r);host.querySelector('button').onclick=async()=>{try{await root.mostrarPanelComercialDireccion(await pedirPinDireccion());}catch(e){host.textContent=e.message;}};
    }catch(e){host.textContent='Actividad comercial sin consultar: '+e.message;}
  };
})(typeof window==='undefined'?globalThis:window);
