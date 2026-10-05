/* Datos comerciales locales. El shell y sus actualizaciones nunca borran esta base. */
(function (root, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LogisticaAlmacen = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const RESULTADOS = {
    NO_ESTABA_COMPRADOR: 'No estaba quien compra',
    NO_SE_PUDO_CONVERSAR: 'No se pudo conversar',
    PIDIO_REGRESAR: 'Pidió regresar o contactar',
    NECESIDAD_IDENTIFICADA: 'Necesidad identificada',
    PIDIO_COTIZACION: 'Pidió muestra o cotización',
    OFERTA_EN_EVALUACION: 'Oferta en evaluación',
    SIN_NECESIDAD_ACTUAL: 'Tiene proveedor y no tiene necesidad actual',
    RECHAZO_OFERTA: 'Rechazó la oferta',
    NO_CONTACTAR: 'Pidió que no lo contacten'
  };
  const ENTIDADES = {negocio:'negocios',visita:'visitas',precio:'precios',compromiso:'compromisos',ubicacion:'ubicaciones',contacto:'contactos',entrevista:'entrevistas',necesidad:'necesidades',oportunidad:'oportunidades',solicitud:'solicitudes',ruta:'rutas',parada:'paradas',evento_ruta:'eventosRuta',carga:'cargas',tiempo:'tiempos',propuesta:'propuestas',documento:'documentos',consumo:'consumo',vinculo:'vinculos',catalogo:'catalogo',evidencia:'evidencias'};
  const TABLAS = [...new Set(Object.values(ENTIDADES)), 'operaciones', 'meta'];
  const texto = (valor, max = 2000) => { const t = String(valor ?? '').trim(); if (t.length > max) throw Error(`Se superó el límite de ${max} caracteres`); return t; };
  const exigir = (valor, nombre, max) => { const t = texto(valor, max); if (!t) throw Error(`Falta ${nombre}`); return t; };
  const contextoDefecto = () => ({ uuid: () => crypto.randomUUID(), ahora: () => new Date().toISOString(), dispositivoId: '' });
  function diaValido(valor) {
    if (typeof valor !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(valor)) return false;
    const [a, m, d] = valor.split('-').map(Number);
    return a >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(a, m, 0)).getUTCDate();
  }
  function fecha(valor) {
    if (typeof valor !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(valor) || !diaValido(valor.slice(0, 10)) || !Number.isFinite(Date.parse(valor))) throw Error('Fecha del hecho inválida');
    return valor;
  }
  function fechaDesdeTijuana(valor) {
    if (typeof valor !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(valor) || !diaValido(valor.slice(0,10))) throw Error('Fecha del hecho inválida');
    const utc = Date.parse(valor + ':00Z');
    if (!Number.isFinite(utc)) throw Error('Fecha del hecho inválida');
    const formato = new Intl.DateTimeFormat('en-US', { timeZone:'America/Tijuana', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'longOffset' });
    let instante = utc;
    let desfase = '';
    for (let i=0; i<3; i++) {
      const partes = Object.fromEntries(formato.formatToParts(new Date(instante)).map(p=>[p.type,p.value]));
      desfase = partes.timeZoneName.replace('GMT','') || '+00:00';
      const [h,m] = desfase.slice(1).split(':').map(Number);
      instante = utc - (desfase[0]==='-'?-1:1)*(h*60+m)*60000;
    }
    const partes = Object.fromEntries(formato.formatToParts(new Date(instante)).map(p=>[p.type,p.value]));
    const local = `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
    if (local !== valor) throw Error('Esa hora no existe en Tijuana por el cambio de horario; elige otra hora');
    return valor + ':00' + (partes.timeZoneName.replace('GMT','') || '+00:00');
  }
  function base(datos, c) {
    return { id: datos.id || c.uuid(), capturadoTs: c.ahora(), fechaHecho: fecha(datos.fechaHecho || c.ahora()), dispositivoId: c.dispositivoId, revisionServidor: 0 };
  }
  function crearNegocio(datos, c = contextoDefecto()) {
    const clase = datos.clase || 'PROSPECTO';
    if (!['CLIENTE', 'PROSPECTO', 'PROVEEDOR'].includes(clase)) throw Error('Clase de negocio inválida');
    return { ...base(datos, c), nombre: exigir(datos.nombre, 'nombre del negocio', 160), clase,
      giro: texto(datos.giro, 160), zona: texto(datos.zona, 160), contacto: texto(datos.contacto, 160), telefono: texto(datos.telefono, 40),
      clienteERP: null, archivado: false, noContacto: false };
  }
  function crearVisita(datos, c = contextoDefecto()) {
    const negocioId = exigir(datos.negocioId, 'negocio');
    if (!Object.hasOwn(RESULTADOS, datos.resultado)) throw Error('Resultado de visita inválido');
    if (datos.seguimientoFecha && !diaValido(datos.seguimientoFecha)) throw Error('Fecha de seguimiento inválida');
    const canal=datos.canal||'PRESENCIAL';if(!['PRESENCIAL','TELEFONO','WHATSAPP','CORREO'].includes(canal))throw Error('Canal de contacto inválido');
    return { ...base(datos, c), negocioId, resultado: datos.resultado, canal, nota: texto(datos.nota),
      decisorCompras:datos.decisorCompras===true,proximaAccion: texto(datos.proximaAccion, 300), seguimientoFecha: datos.seguimientoFecha || null };
  }
  function crearPrecio(datos, c = contextoDefecto()) {
    const precio = texto(datos.precio);
    if (!/^\d+(?:\.\d{1,2})?$/.test(precio) || precio.length > 14) throw Error('Precio inválido: usa un importe con punto y hasta dos decimales');
    if (![0, 8, 16].includes(datos.ivaTasa)) throw Error('La tasa de IVA debe ser 0, 8 o 16');
    if (!['MXN', 'USD'].includes(datos.moneda)) throw Error('Moneda inválida');
    if (typeof datos.ivaIncluido !== 'boolean') throw Error('Indica si el IVA está incluido');
    if (datos.vigenciaHasta && !diaValido(datos.vigenciaHasta)) throw Error('Vigencia inválida');
    return { ...base(datos, c), negocioId: exigir(datos.negocioId, 'negocio'), producto: exigir(datos.producto, 'producto', 200),
      codigo: texto(datos.codigo, 40) || null, unidad: exigir(datos.unidad, 'unidad', 80), precio, moneda: datos.moneda,
      ivaTasa: datos.ivaTasa, ivaIncluido: datos.ivaIncluido, condiciones: texto(datos.condiciones, 1000),
      vigenciaHasta: datos.vigenciaHasta || null, estado: 'OFRECIDO' };
  }
  function crearOperacion(entidad, registro, c = contextoDefecto()) {
    const { id, capturadoTs, dispositivoId, revisionServidor, fechaHecho, ...payload } = registro;
    return { tipo: 'comercial_operacion', versionContrato: 1, operationId: c.uuid(), entidad, accion: 'agregar',
      registroId: id, fechaHecho, payload, estadoLocal: 'PENDIENTE', creadoTs: capturadoTs, intentos: 0 };
  }
  function peticion(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
  function ordenarOperaciones(filas) {
    const restantes=filas.slice().sort((a,b)=>a.creadoTs.localeCompare(b.creadoTs)),orden=[];
    while(restantes.length){const i=restantes.findIndex(op=>{const refs=Object.entries(op.payload||op).filter(([k])=>/Id$/.test(k)&&!['registroId','operationId'].includes(k)).map(([,v])=>v);return !restantes.some(otra=>otra!==op&&refs.includes(otra.registroId)&&otra.accion==='agregar');});if(i<0)throw Error('Hay referencias circulares en la cola; las capturas se conservaron');orden.push(restantes.splice(i,1)[0]);}
    return orden;
  }
  async function abrir(opciones = {}) {
    const idb = opciones.indexedDB || globalThis.indexedDB;
    if (!idb) throw Error('Este navegador no permite guardar los datos comerciales');
    const req = idb.open(opciones.nombre || 'sumetec-logistica', 2);
    req.onupgradeneeded = () => {
      for (const tabla of TABLAS) if (!req.result.objectStoreNames.contains(tabla)) req.result.createObjectStore(tabla, { keyPath: tabla === 'operaciones' ? 'operationId' : tabla === 'meta' ? 'clave' : 'id' });
    };
    const db = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(Error('Cierra las otras pestañas de Logística para abrir los datos'));
    });
    db.onversionchange = () => db.close();
    const leer = (tabla, id) => peticion(db.transaction(tabla).objectStore(tabla).get(id));
    const todos = tabla => peticion(db.transaction(tabla).objectStore(tabla).getAll());
    function escribir(tablas, trabajo) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(tablas, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || Error('No se pudo guardar; la captura sigue abierta'));
        tx.onabort = () => reject(tx.error || Error('No se pudo guardar; la captura sigue abierta'));
        try { trabajo(Object.fromEntries(tablas.map(t => [t, tx.objectStore(t)]))); }
        catch (e) { tx.abort(); reject(e); }
      });
    }
    // Una transacción evita que dos pestañas creen identidades distintas al abrir por primera vez.
    const dispositivo = await new Promise((resolve, reject) => {
      const tx=db.transaction('meta','readwrite'), store=tx.objectStore('meta');
      let registro;
      const lectura=store.get('dispositivo');
      lectura.onsuccess=()=>{registro=lectura.result;if(!registro){registro={clave:'dispositivo',valor:crypto.randomUUID()};store.add(registro);}};
      tx.oncomplete=()=>resolve(registro);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error || Error('No se pudo abrir la identidad local'));
    });
    const c = { ...contextoDefecto(), ...opciones.contexto, dispositivoId: dispositivo.valor };
    async function comprobarNegocio(id) { if (!(await leer('negocios', id))) throw Error('El negocio ya no está en este teléfono'); }
    async function agregarEvento(tabla, entidad, registro) {
      await comprobarNegocio(registro.negocioId);
      const op = crearOperacion(entidad, registro, c);
      await escribir([tabla, 'operaciones'], t => { t[tabla].add(registro); t.operaciones.add(op); });
      return registro;
    }
    async function guardarEvento(entidad, datos) {
      const tabla=ENTIDADES[entidad];
      if(!tabla || ['negocio','documento','consumo','vinculo','catalogo'].includes(entidad)) throw Error('Tipo de captura inválido');
      if(datos.negocioId) await comprobarNegocio(datos.negocioId);
      const registro={...datos,...base(datos,c)};
      if(entidad==='ubicacion') {
        if(!Number.isFinite(registro.lat)||!Number.isFinite(registro.lng)||Math.abs(registro.lat)>90||Math.abs(registro.lng)>180) throw Error('Coordenadas inválidas');
        if(registro.estado!=='CONFIRMADA') throw Error('Confirma el pin antes de guardar');
      }
      if(entidad==='compromiso'&&!texto(registro.accion)) throw Error('Describe la acción acordada');
      if(entidad==='necesidad'&&!texto(registro.producto)) throw Error('Describe el producto necesario');
      const op=crearOperacion(entidad,registro,c);
      if(entidad==='ruta') {
        // La salida y su marcador se reservan juntos, también entre pestañas.
        await new Promise((resolve,reject)=>{
          const tx=db.transaction([tabla,'operaciones','meta'],'readwrite');
          tx.oncomplete=()=>resolve();
          tx.onerror=()=>reject(tx.error||Error('No se pudo iniciar la salida'));
          tx.onabort=()=>reject(tx.error||Error('No se pudo iniciar la salida'));
          const activa=tx.objectStore('meta').get('rutaActiva');
          activa.onsuccess=()=>{
            if(activa.result?.valor){reject(Error('Ya hay una salida activa; ciérrala antes de iniciar otra'));tx.abort();return;}
            tx.objectStore(tabla).add(registro);
            tx.objectStore('operaciones').add(op);
            tx.objectStore('meta').put({clave:'rutaActiva',valor:registro.id});
          };
        });
        return registro;
      }
      await escribir([tabla,'operaciones'],t=>{t[tabla].add(registro);t.operaciones.add(op);});
      return registro;
    }
    return {
      guardarEvento,
      async guardarSitio(datos) {
        await comprobarNegocio(datos.negocioPrincipalId);
        if(!['SUCURSAL','OBRA_TEMPORAL'].includes(datos.tipoSitio))throw Error('Elige sucursal u obra temporal');
        const registro={...crearNegocio(datos,c),negocioPrincipalId:datos.negocioPrincipalId,tipoSitio:datos.tipoSitio,clienteERP:datos.clienteERP||null};
        await escribir(['negocios','operaciones'],t=>{t.negocios.add(registro);t.operaciones.add(crearOperacion('negocio',registro,c));});
        return registro;
      },
      async guardarEntrevista(datos,items=[]) {
        await comprobarNegocio(datos.negocioId);
        const entrevista={...datos,...base(datos,c)};
        const necesidades=items.map(p=>{if(!texto(p.producto))throw Error('Describe el producto');if(p.cantidad!==null&&(!Number.isFinite(p.cantidad)||p.cantidad<0))throw Error('Cantidad inválida');if(p.cantidadConfirmada&&(!p.unidad||!(p.cantidad>0)))throw Error('Confirma cantidad y unidad');return {...p,negocioId:datos.negocioId,entrevistaId:entrevista.id,...base(p,c)};});
        await escribir(['entrevistas','necesidades','operaciones'],t=>{t.entrevistas.add(entrevista);t.operaciones.add(crearOperacion('entrevista',entrevista,c));for(const r of necesidades){t.necesidades.add(r);t.operaciones.add(crearOperacion('necesidad',r,c));}});
        return entrevista;
      },
      async guardarEventos(entidad,datos) {
        const tabla=ENTIDADES[entidad];if(!['evento_ruta','tiempo','carga'].includes(entidad))throw Error('Grupo de eventos inválido');
        const registros=datos.map(d=>({...d,...base(d,c)}));
        await escribir([tabla,'operaciones'],t=>{for(const r of registros){t[tabla].add(r);t.operaciones.add(crearOperacion(entidad,r,c));}});return registros;
      },
      async cerrarParada(datos,visita) {
        const eventos=datos.map(d=>({...d,...base(d,c)})),v=visita?crearVisita(visita,c):null;
        const negocio=v?await leer('negocios',v.negocioId):null;if(v&&!negocio)throw Error('Falta el negocio de la visita');
        await escribir(['eventosRuta','visitas','negocios','operaciones'],t=>{for(const r of eventos){t.eventosRuta.add(r);t.operaciones.add(crearOperacion('evento_ruta',r,c));}if(v){t.visitas.add(v);t.operaciones.add(crearOperacion('visita',v,c));if(v.resultado==='NO_CONTACTAR')t.negocios.put({...negocio,noContacto:true});}});
      },
      async guardarEvidencia(datos) {
        await comprobarNegocio(datos.negocioId);
        if(!['image/jpeg','image/png'].includes(datos.mimeType)||typeof datos.base64!=='string'||datos.base64.length>2800000)throw Error('Usa una foto JPEG o PNG de hasta 2 MB');
        const registro={...datos,...base(datos,c)},operationId=c.uuid();
        const op={tipo:'comercial_evidencia',operationId,registroId:registro.id,negocioId:datos.negocioId,fechaHecho:registro.fechaHecho,nombre:datos.nombre,mimeType:datos.mimeType,base64:datos.base64,entidad:'evidencia',estadoLocal:'PENDIENTE',creadoTs:registro.capturadoTs,intentos:0};
        await escribir(['evidencias','operaciones'],t=>{t.evidencias.add(registro);t.operaciones.add(op);});return registro;
      },
      listar: entidad=>{if(!ENTIDADES[entidad])throw Error('Entidad inválida');return todos(ENTIDADES[entidad]);},
      obtener: (entidad,id)=>leer(ENTIDADES[entidad],id),
      meta: async clave=>(await leer('meta',clave))?.valor,
      guardarMeta:(clave,valor)=>escribir(['meta'],t=>t.meta.put({clave,valor})),
      async editar(entidad,id,cambios) {
        if(!['negocio','ubicacion'].includes(entidad)) throw Error('El historial se corrige con un evento nuevo');
        const tabla=ENTIDADES[entidad], anterior=await leer(tabla,id);
        if(!anterior)throw Error('No se encontró el registro');
        const registro={...anterior,...cambios,id,fechaHecho:c.ahora()};
        const op={...crearOperacion(entidad,registro,c),accion:'editar',expectedRevision:anterior.revisionServidor||0};
        await escribir([tabla,'operaciones'],t=>{t[tabla].put(registro);t.operaciones.add(op);});return registro;
      },
      async marcarOperacion(operationId,estadoLocal,detalle={}) {
        const op=await leer('operaciones',operationId);if(!op)return;
        await escribir(['operaciones'],t=>t.operaciones.put({...op,...detalle,estadoLocal,intentos:op.intentos+1}));
      },
      async resolverConflicto(operationId,reaplicar) {
        const op=await leer('operaciones',operationId);if(op?.estadoLocal!=='CONFLICTO'||!['negocio','ubicacion'].includes(op.entidad)||!op.detalle?.actual)throw Error('Este rechazo necesita revisar el contrato con administración');
        const tabla=ENTIDADES[op.entidad],actual=op.detalle.actual,registro=reaplicar?{...actual,...op.payload,id:op.registroId,fechaHecho:c.ahora(),revisionServidor:op.detalle.revision}:actual;
        const nueva=reaplicar?{...crearOperacion(op.entidad,registro,c),accion:'editar',expectedRevision:op.detalle.revision}:null;
        await escribir([tabla,'operaciones'],t=>{t[tabla].put(registro);t.operaciones.put({...op,estadoLocal:'DESCARTADA',resueltoTs:c.ahora(),resolucion:reaplicar?'REAPLICAR_CONFIRMADO':'CONSERVAR_SERVIDOR'});if(nueva)t.operaciones.add(nueva);});
      },
      async aplicarSync(cambios,cursor) {
        const grupos=new Map(),normales=[];
        for(const cambio of cambios){const d=cambio.datos;if(['consumo','vinculo','catalogo'].includes(cambio.entidad)&&d?.fragmentos){const key=`${cambio.entidad}:${d.snapshotId}`,g=grupos.get(key)||[];g.push(cambio);grupos.set(key,g);}else normales.push(cambio);}
        for(const partes of grupos.values()){
          partes.sort((a,b)=>a.datos.fragmento-b.datos.fragmento);const d=partes[0].datos,n=d.fragmentos;
          if(partes.length!==n||partes.some((p,i)=>p.datos.fragmento!==i||p.datos.fragmentos!==n))throw Error('Resumen incompleto; no se modificaron los datos locales');
          normales.push({...partes.at(-1),registroId:d.snapshotId,datos:{...d,id:d.snapshotId,filas:partes.flatMap(p=>p.datos.filas||[]),documentos:partes.flatMap(p=>p.datos.documentos||[]),fragmento:undefined,fragmentos:undefined}});
        }
        cambios=normales;
        const pendientes=(await todos('operaciones')).filter(o=>!['CONFIRMADA','DESCARTADA'].includes(o.estadoLocal));
        const protegidos=new Set(pendientes.map(o=>`${o.entidad}:${o.registroId}`));
        for(const cambio of cambios)if(!ENTIDADES[cambio.entidad]||!cambio.registroId||!cambio.datos)throw Error('Respuesta de sincronización inválida');
        await escribir(TABLAS,t=>{
          for(const cambio of cambios) {
            if(['consumo','vinculo','catalogo'].includes(cambio.entidad))t[ENTIDADES[cambio.entidad]].clear();
            if(protegidos.has(`${cambio.entidad}:${cambio.registroId}`)) {
              t.meta.put({clave:`remoto:${cambio.entidad}:${cambio.registroId}`,valor:cambio});continue;
            }
            t[ENTIDADES[cambio.entidad]].put({...cambio.datos,id:cambio.registroId,revisionServidor:cambio.revision});
          }
          t.meta.put({clave:'syncCursor',valor:cursor});t.meta.put({clave:'syncTs',valor:c.ahora()});
        });
      },
      async restaurar(copia) {
        if(copia?.app!=='logistica'||![1,2].includes(copia.schema)||!copia.tablas)throw Error('No es un respaldo de Logística');
        for(const [tabla,filas]of Object.entries(copia.tablas)) {
          if(!TABLAS.includes(tabla)||!Array.isArray(filas))throw Error('Respaldo inválido');
          const key=tabla==='operaciones'?'operationId':tabla==='meta'?'clave':'id';
          const ids=new Set();for(const fila of filas){if(!fila||typeof fila[key]!=='string'||ids.has(fila[key]))throw Error('Respaldo con identificadores inválidos');if(!['meta','documentos','consumo','vinculos','catalogo'].includes(tabla)&&!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(fila[key]))throw Error('Respaldo con UUID inválido');ids.add(fila[key]);}
        }
        // La identidad, credenciales y cursor del teléfono receptor no se restauran.
        const locales=await todos('operaciones');const idsLocales=new Set(locales.map(o=>o.operationId));
        await escribir(TABLAS,t=>{for(const[tabla,filas]of Object.entries(copia.tablas))if(tabla!=='meta')for(const fila of filas){if(tabla==='operaciones'&&idsLocales.has(fila.operationId))continue;const clave=tabla==='operaciones'?fila.operationId:fila.id;const r=t[tabla].get(clave);r.onsuccess=()=>{if(!r.result)t[tabla].add(fila);};}});
      },
      async guardarAlta(datos, visita) {
        const negocio = crearNegocio(datos, c);
        const evento = crearVisita({ ...visita, negocioId: negocio.id }, c);
        if (evento.resultado === 'NO_CONTACTAR') negocio.noContacto = true;
        const operaciones = [crearOperacion('negocio', negocio, c), crearOperacion('visita', evento, c)];
        await escribir(['negocios', 'visitas', 'operaciones'], t => {
          t.negocios.add(negocio); t.visitas.add(evento); operaciones.forEach(op => t.operaciones.add(op));
        });
        return { negocio, visita: evento };
      },
      async registrarVisita(datos) {
        const visita = crearVisita(datos, c);
        await comprobarNegocio(visita.negocioId);
        const negocio = await leer('negocios', visita.negocioId);
        const op = crearOperacion('visita', visita, c);
        await escribir(['visitas', 'operaciones', 'negocios'], t => {
          t.visitas.add(visita); t.operaciones.add(op);
          if (visita.resultado === 'NO_CONTACTAR') t.negocios.put({ ...negocio, noContacto: true });
        });
        return visita;
      },
      guardarPrecio: datos => agregarEvento('precios', 'precio', crearPrecio(datos, c)),
      negocios: async () => (await todos('negocios')).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      visitas: () => todos('visitas'),
      precios: () => todos('precios'),
      pendientes: async () => ordenarOperaciones((await todos('operaciones')).filter(o=>!['CONFIRMADA','DESCARTADA'].includes(o.estadoLocal))),
      async expediente(id) {
        const [negocio, visitas, precios] = await Promise.all([leer('negocios', id), todos('visitas'), todos('precios')]);
        if (!negocio) throw Error('No se encontró el negocio');
        return { negocio, visitas: visitas.filter(v => v.negocioId === id).sort((a, b) => Date.parse(b.fechaHecho)-Date.parse(a.fechaHecho)), precios: precios.filter(p => p.negocioId === id).sort((a, b) => Date.parse(b.capturadoTs)-Date.parse(a.capturadoTs)) };
      },
      guardarModo: modo => {
        if (!['RUTAS', 'PROSPECTOS'].includes(modo)) throw Error('Modo inválido');
        return escribir(['meta'], t => t.meta.put({ clave: 'modo', valor: modo }));
      },
      modo: async () => (await leer('meta', 'modo'))?.valor || 'RUTAS',
      async exportar() {
        const tx=db.transaction(TABLAS,'readonly');
        const datos = await Promise.all(TABLAS.map(t=>peticion(tx.objectStore(t).getAll())));
        return { schema: 2, app: 'logistica', exportadoTs: c.ahora(), tablas: Object.fromEntries(TABLAS.map((t, i) => [t, datos[i]])) };
      },
      cerrar: () => db.close()
    };
  }
  return { abrir, RESULTADOS, crearNegocio, crearVisita, crearPrecio, crearOperacion, fechaDesdeTijuana, ordenarOperaciones };
});
