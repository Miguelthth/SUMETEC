/* Pedidos de clientes: solicitudes sin dinero; la atención siempre es explícita. */
(function (root) {
  'use strict';
  function crearBorrador(pedido, catalogo) {
    if (!pedido || !pedido.id || !pedido.cliente || !Array.isArray(pedido.lineas) ||
        !pedido.lineas.length || pedido.lineas.length > 100) throw Error('El pedido no está completo. Actualiza la bandeja.');
    const items = pedido.lineas.map(linea => {
      if (!linea.codigo || !Number.isInteger(linea.cantidad) || linea.cantidad < 1 || linea.cantidad > 1000000)
        throw Error('Revisa las cantidades del pedido.');
      const producto = catalogo.find(p => String(p.clave) === linea.codigo);
      return {clave:linea.codigo,desc:producto?.desc || linea.descripcion || linea.codigo,
        qty:linea.cantidad,precio:0,iva:8};
    });
    return {portalPedidoId:pedido.id,c_nombre:pedido.cliente,descPct:0,ivaGlobal:8,items,
      obs:'Solicitud '+pedido.folio+'. Confirmar precio y existencia.'+(pedido.nota?'\n'+pedido.nota:''),ts:Date.now()};
  }
  function guardarBorrador(storage, borrador, conservarActual = false) {
    try {
      const anterior = storage.getItem('cot_draft_r');
      if (anterior && (conservarActual || JSON.parse(anterior).portalPedidoId !== borrador.portalPedidoId)) {
        const copias=JSON.parse(storage.getItem('portal_pedidos_borradores')||'[]');
        if(!Array.isArray(copias))throw Error('Copias no disponibles');
        if(!copias.some(c=>JSON.stringify(c)===anterior))copias.push(JSON.parse(anterior));
        storage.setItem('portal_pedidos_borradores',JSON.stringify(copias));
      }
      const texto = JSON.stringify(borrador);
      storage.setItem('cot_draft_r',texto);
      if (storage.getItem('cot_draft_r') !== texto) throw Error('Sin persistencia');
    } catch (_) { throw Error('No se pudo guardar el borrador. Libera espacio o exporta tus datos antes de continuar.'); }
  }
  const api = {crearBorrador,guardarBorrador};
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  let dialogo, lista, mensaje, contador, ultimaConsulta = 0, consultando = false, origen = null;
  const $ = id => document.getElementById(id);
  function nodo(tag,texto,clase) {
    const n=document.createElement(tag);if(texto!=null)n.textContent=texto;if(clase)n.className=clase;return n;
  }
  function boton(texto,accion) {
    const b=nodo('button',texto,'portal-boton');b.type='button';b.addEventListener('click',()=>ejecutar(accion));return b;
  }
  function aviso(texto) { mensaje.textContent=texto; }
  async function ejecutar(accion) {
    if(dialogo.dataset.ocupado==='1')return;
    dialogo.dataset.ocupado='1';
    const botones=[...dialogo.querySelectorAll('button:not([data-cerrar])')];
    botones.forEach(b=>b.disabled=true);
    try { await accion(); } catch(e) { aviso(e.message || 'No se pudo completar la operación. Intenta otra vez.'); }
    finally { dialogo.dataset.ocupado='';botones.forEach(b=>b.disabled=false); }
  }
  async function consultar(accion,campos={}) {
    const url=typeof getScriptUrl==='function'?getScriptUrl():'';
    const token=typeof API_TOKEN==='string'?API_TOKEN:'';
    if(!url||!token)throw Error('Abre el Cotizador con tu PIN antes de consultar pedidos.');
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),25000);
    try {
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},
        body:JSON.stringify({tipo:'portal_pedidos',accion,token,...campos}),signal:ctrl.signal,cache:'no-store'});
      if(!r.ok)throw Error('sin respuesta');
      const d=await r.json();
      if(!d.ok)throw Error(d.codigo==='PORTAL_NO_CONFIGURADO'?
        'Falta conectar el portal. Sigue la guía de instalación de SUMETEC Pedidos.':
        (d.error || 'El portal no aceptó la operación. Actualiza la bandeja.'));
      return d;
    } catch(e) {
      if(e.name==='AbortError'||e instanceof TypeError||e.message==='sin respuesta')
        throw Error('No se recibió respuesta. Tus pedidos siguen guardados; vuelve a intentar.');
      throw e;
    } finally { clearTimeout(timer); }
  }
  function montar() {
    if(dialogo)return;
    dialogo=nodo('dialog',null,'portal-pedidos');dialogo.id='portalPedidosDialogo';
    dialogo.setAttribute('aria-labelledby','portalPedidosTitulo');
    const cabecera=nodo('header');const titulo=nodo('h2','Pedidos de clientes');titulo.id='portalPedidosTitulo';
    const cerrar=boton('Cerrar',()=>dialogo.close());cerrar.dataset.cerrar='1';
    cabecera.append(titulo,cerrar);dialogo.append(cabecera);
    dialogo.append(nodo('p','Revisa precio y existencia antes de confirmar cada solicitud.','portal-ayuda'));
    const nav=nodo('nav');nav.append(boton('Pedidos pendientes',cargar),boton('Enlaces de clientes',enlaces),boton('Borradores anteriores',recuperar));dialogo.append(nav);
    mensaje=nodo('p','', 'portal-mensaje');mensaje.setAttribute('role','status');mensaje.setAttribute('aria-live','polite');
    lista=nodo('div');dialogo.append(mensaje,lista);document.body.append(dialogo);
  }
  function pintar(pedidos,total) {
    lista.replaceChildren();
    if(!pedidos.length)lista.append(nodo('p','No hay pedidos pendientes. Comparte su enlace con un cliente para recibir el primero.'));
    for(const pedido of pedidos) {
      const fila=nodo('article',null,'portal-fila');fila.append(nodo('small',pedido.folio+' · '+pedido.fecha),nodo('h3',pedido.cliente));
      fila.append(nodo('p',pedido.lineas.length+' productos · Pendiente de revisar'));
      fila.append(boton('Revisar pedido',()=>detalle(pedido.id)));lista.append(fila);
    }
    aviso(total>pedidos.length?'Se muestran '+pedidos.length+' de '+total+' pendientes. Atiende los primeros y actualiza.':'');
  }
  async function cargar() {
    aviso('Buscando pedidos…');
    const d=await consultar('pendientes');pintar(d.pedidos||[],d.total||0);actualizarBadge(d.total||0);
  }
  function actualizarBadge(total) {
    contador=$('portalPedidosContador');if(contador)contador.textContent=total?' ('+total+')':'';
    const menu=$('portalPedidosContadorMenu');if(menu)menu.textContent=total?' ('+total+')':'';
    const previo=Number($('btnPedidosPortal')?.dataset.total||0);
    if(total>previo&&ultimaConsulta&&typeof toast==='function')toast('Tienes pedidos de clientes por revisar.','ok');
    if($('btnPedidosPortal'))$('btnPedidosPortal').dataset.total=String(total);
  }
  async function detalle(id) {
    const {pedido}=await consultar('detalle',{id});
    lista.replaceChildren();lista.append(nodo('h3',pedido.folio+' · '+pedido.cliente));
    for(const linea of pedido.lineas)lista.append(nodo('p',linea.cantidad+' '+(linea.unidad||'')+' · '+linea.codigo+' · '+linea.descripcion));
    if(pedido.nota)lista.append(nodo('p',pedido.nota,'portal-nota'));
    if(pedido.estado!=='PENDIENTE'){aviso('Este pedido ya fue atendido. Actualiza la bandeja.');return;}
    lista.append(boton('Preparar cotización',()=>preparar(pedido)));
    const campo=nodo('label','Folio de la cotización con que lo atendiste');
    const input=nodo('input');input.id='portalReferencia';input.maxLength=120;input.placeholder='Ejemplo: SUM-0101';campo.append(input);lista.append(campo);
    lista.append(nodo('p','Preparar el borrador conserva el pedido pendiente. Márcalo atendido cuando hayas generado y revisado la cotización.','portal-ayuda'));
    lista.append(boton('Marcar atendido',async()=>{
      const referencia=input.value.trim();if(!referencia)throw Error('Escribe el folio de la cotización antes de marcarlo atendido.');
      await consultar('atender',{id:pedido.id,referencia});await cargar();aviso('Pedido marcado atendido con '+referencia+'.');
    }));
    aviso('El pedido no registra una venta ni reserva inventario.');
  }
  function preparar(pedido) {
    const actual=typeof snapCot==='function'?snapCot():null;
    const guardado=JSON.parse(localStorage.getItem('cot_draft_r')||'null');
    const tieneContenido=d=>d&&(d.c_nombre||d.items?.some(i=>i.clave||i.desc));
    const contenido=tieneContenido(actual)||tieneContenido(guardado);
    if(contenido&&origen!==pedido.id) {
      lista.replaceChildren();lista.append(nodo('h3','Hay una cotización abierta'));
      lista.append(nodo('p','Se conservará una copia del borrador anterior antes de abrir este pedido.'));
      lista.append(boton('Conservar copia y abrir pedido',()=>aplicar(pedido)),boton('Volver al pedido',()=>detalle(pedido.id)));
      aviso('Si estabas editando una cotización, termina esa edición antes de continuar.');return;
    }
    aplicar(pedido);
  }
  function aplicar(pedido) {
    // Una edición existente no se puede convertir accidentalmente en otra cotización.
    if(typeof _cotModoEdicion!=='undefined'&&_cotModoEdicion)throw Error('Termina o cancela la edición de la cotización actual antes de abrir este pedido.');
    if(origen===pedido.id&&typeof snapCot==='function'&&snapCot().items.some(i=>i.clave||i.desc)) {
      dialogo.close();return;
    }
    const borrador=crearBorrador(pedido,typeof PRODUCTOS!=='undefined'?PRODUCTOS:[]);
    if(typeof snapCot==='function') {
      const actual=snapCot();
      if(actual.c_nombre||actual.items?.some(i=>i.clave||i.desc))localStorage.setItem('cot_draft_r',JSON.stringify(actual));
    }
    guardarBorrador(localStorage,borrador);
    activarPreparado(borrador);origen=pedido.id;
    // snapCot añade la procedencia para que la próxima recarga no se la lleve.
    guardarBorrador(localStorage,snapCot());
    dialogo.close();if(typeof toast==='function')toast('Pedido precargado. Captura precios y confirma la tasa de IVA.','ok',6000);
  }
  function activarPreparado(borrador) {
    _activarModoCot();
    // La activación restaura un draft reciente y no crea su folio: inicializarlo aquí para un pedido nuevo.
    if(!borrador.folio)_cotCargarFolio();
    const fecha=$('cot_fechaDisp');
    if(fecha)fecha.textContent=new Date().toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
    refreshVigCot();renderFooterCot();restoreCotDraft(borrador);
  }
  function recuperar() {
    const copias=JSON.parse(localStorage.getItem('portal_pedidos_borradores')||'[]');
    lista.replaceChildren();aviso('Se conservan las copias que hicimos antes de abrir otro pedido.');
    if(!copias.length){lista.append(nodo('p','Todavía no hay borradores anteriores guardados.'));return;}
    for(const copia of [...copias].reverse()) {
      const fila=nodo('article',null,'portal-fila');fila.append(nodo('h3',copia.c_nombre||'Sin cliente'));
      fila.append(nodo('p',(copia.folio||'Borrador')+' · '+(copia.items||[]).filter(i=>i.clave||i.desc).length+' productos'));
      fila.append(boton('Abrir este borrador',()=>{
        if(typeof _cotModoEdicion!=='undefined'&&_cotModoEdicion)throw Error('Termina la edición actual antes de recuperar el borrador.');
        const actual=snapCot();
        if(actual.c_nombre||actual.items?.some(i=>i.clave||i.desc))localStorage.setItem('cot_draft_r',JSON.stringify(actual));
        guardarBorrador(localStorage,copia,true);activarPreparado(copia);guardarBorrador(localStorage,snapCot());dialogo.close();
      }));lista.append(fila);
    }
  }
  async function enlaces() {
    aviso('Cargando clientes publicados…');const d=await consultar('clientes');lista.replaceChildren();
    const label=nodo('label','Cliente');const select=nodo('select');select.id='portalCliente';
    select.append(new Option('Elige un cliente',''));
    for(const nombre of d.clientes||[])select.append(new Option(nombre,nombre));label.append(select);lista.append(label);
    lista.append(nodo('p','Cada enlace abre sólo el historial de ese cliente. Generar otro enlace desactiva el anterior.','portal-ayuda'));
    const salida=nodo('textarea');salida.readOnly=true;salida.rows=3;salida.setAttribute('aria-label','Enlace privado para compartir');
    lista.append(boton('Generar enlace privado',async()=>{
      if(!select.value)throw Error('Elige un cliente.');
      const r=await consultar('crear_enlace',{cliente:select.value});salida.value=r.enlace||'';
      aviso('Enlace creado. Cópialo y compártelo únicamente con '+select.value+'.');
    }),salida,boton('Copiar enlace',async()=>{
      if(!salida.value)throw Error('Primero genera el enlace.');
      try {await navigator.clipboard.writeText(salida.value);aviso('Enlace copiado.');}
      catch(_){salida.focus();salida.select();aviso('Selecciona el enlace y cópialo para compartirlo.');}
    }),boton('Desactivar enlace',async()=>{
      if(!select.value)throw Error('Elige un cliente.');
      await consultar('revocar_enlace',{cliente:select.value});salida.value='';aviso('Enlace desactivado para '+select.value+'.');
    }));aviso(d.clientes?.length?'':'Publica los clientes desde el ERP antes de generar enlaces.');
    select.addEventListener('change',()=>{salida.value='';});
  }
  Object.assign(api,{
    abrir(){if(typeof _cerrarMenuMas==='function')_cerrarMenuMas();montar();if(!dialogo.open)dialogo.showModal();ejecutar(cargar);},
    async actualizarContador(){
      if(consultando||Date.now()-ultimaConsulta<120000||typeof API_TOKEN!=='string'||!API_TOKEN||!navigator.onLine)return;
      consultando=true;ultimaConsulta=Date.now();
      try {const d=await consultar('estado');actualizarBadge(d.total||0);}catch(_){/* La bandeja muestra el error al abrirla. */}
      finally{consultando=false;}
    },
    referencia:()=>origen,
    restaurar(id){origen=typeof id==='string'?id:null;},
    cotizacionPreparada(entry){
      if(origen&&entry?.folio&&typeof toast==='function')toast('Cotización preparada. En Pedidos puedes marcar atendido con '+entry.folio+'.','ok',6000);
    }
  });
  root.SumetecPortalPedidos=api;
})(typeof globalThis==='object'?globalThis:this);
