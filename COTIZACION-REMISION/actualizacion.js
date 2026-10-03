/* Actualización segura: conserva una captura serializable antes de activar
   un Service Worker ya descargado. No guarda token, contraseña ni archivos. */
(function(){
  let aplicando = false;
  const CLAVE = 'sumetec_remisiones_actualizacion';
  const OMITIR = new Set(['api_token_input', '_pinInp']);
  const selectorCampos = 'input:not([type="file"]):not([type="password"]),textarea,select,[contenteditable="true"]';

  // F5N-04 (auditoría incremental 2026-09-28): un <dialog> modal (el del PIN) vive en la capa superior del
  // navegador y deja INERTE todo lo que no es él: el aviso «Actualizar» quedaba tapado y sin poder pulsarse
  // (ni el z-index máximo ni un popover lo arreglan). Mientras haya un diálogo modal abierto, el aviso se
  // mete DENTRO de él -- su subtree sí es interactivo y se pinta encima -- y al ocultarse vuelve al <body>.
  const capa = mostrar => {
    const el = document.getElementById('sumetecActualizacion');
    if (!el) return;
    el.classList.toggle('activo', !!mostrar);
    try {
      if (mostrar) {
        const dialogo = [...document.querySelectorAll('dialog[open]')].filter(d => d.matches(':modal')).pop();   // el modal (el que deja inerte el resto)
        if (dialogo && el.parentNode !== dialogo) dialogo.appendChild(el);
      } else if (el.parentNode !== document.body) {
        document.body.appendChild(el);
      }
    } catch (_) { /* si algo falla queda donde estaba */ }
  };


  // 2026-09-29 (Miguel: «que no se actualice sola hasta que le dé clic»): «Actualizar» se ofrece
  // por dos caminos. El normal: el service worker ya tomó control pero sigue sirviendo la versión
  // ACEPTADA y contesta ESTADO con otra lista -> al pulsar se ACEPTA y se recarga. El de transición:
  // un worker en espera (el teléfono venía de antes de este mecanismo) -> ACTIVAR_ACTUALIZACION.
  let aceptarPendiente = null;
  let buildPendiente = '';
  function mostrarDisponible(build, aceptar) {
    // No interrumpir fotos ni envíos que no se pueden restaurar.
    try { guardarContexto(build); }
    catch (error) { console.warn('Actualización aplazada:', error.message); return; }
    aceptarPendiente = aceptar;
    buildPendiente = build;
    document.getElementById('sumetecActualizacionTitulo').textContent = 'Actualización disponible';
    document.getElementById('sumetecActualizacionMensaje').textContent = 'Versión ' + (build || 'nueva') + '. Actualiza para seguir usando la app.';
    const boton = document.getElementById('sumetecActualizarBoton');
    boton.hidden = false;
    boton.disabled = false;
    boton.onclick = aplicarActualizacion;
    capa(true);
  }
  function aplicarActualizacion() {
    if (!aceptarPendiente) return;
    let contexto;
    try { contexto = guardarContexto(buildPendiente); }
    catch (error) {
      document.getElementById('sumetecActualizacionMensaje').textContent = 'Termina o guarda la captura actual para actualizar: ' + error.message;
      return;
    }
    const boton = document.getElementById('sumetecActualizarBoton');
    boton.disabled = true;
    boton.hidden = true;
    document.getElementById('sumetecActualizacionTitulo').textContent = 'Actualizando SUMETEC';
    document.getElementById('sumetecActualizacionMensaje').textContent = 'Espera un momento…';
    aplicando = true;
    sessionStorage.setItem(CLAVE, JSON.stringify(contexto));
    const aceptar = aceptarPendiente;
    aceptarPendiente = null;
    aceptar();
  }
  function mostrarActualizada() {
    try { localStorage.setItem('rem_ultima_actualizacion', String(Date.now())); } catch (_) {}
    document.getElementById('sumetecActualizacionTitulo').textContent = 'SUMETEC actualizado';
    document.getElementById('sumetecActualizacionMensaje').textContent = 'Versión ' + VERSION_CODIGO + ' instalada.';
    document.getElementById('sumetecActualizarBoton').hidden = true;
    capa(true);
    requestAnimationFrame(() => setTimeout(() => capa(false), 3000));
  }

  function serializarCampo(el){
    return {
      id: el.id || '', name: el.name || '', tag: el.tagName, type: el.type || '',
      valor: el.isContentEditable ? el.textContent : el.value,
      marcado: el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined
    };
  }

  function guardarContexto(buildDestino){
    if([...document.querySelectorAll('input[type="file"]')].some(el => el.files && el.files.length)) {
      throw new Error('hay un archivo que el navegador no puede restaurar de forma segura');
    }
    const campos = [...document.querySelectorAll(selectorCampos)]
      .filter(el => !OMITIR.has(el.id))
      .map(serializarCampo);
    return { schema: 2, buildDestino, campos, guardadoEn: Date.now() };
  }

  function restaurarContexto(){
    const raw = sessionStorage.getItem(CLAVE);
    if(!raw) return false;
    let contexto;
    try { contexto = JSON.parse(raw); } catch(_) { sessionStorage.removeItem(CLAVE); return false; }
    if(![1,2].includes(contexto.schema) || !Array.isArray(contexto.campos)) { sessionStorage.removeItem(CLAVE); return false; }
    // B9/M-13: un contexto guardado para OTRA versión no es basura: se conserva
    // (sin restaurar) hasta que arranque la versión a la que iba dirigido.
    if(contexto.buildDestino !== VERSION_CODIGO) return false;
    const campos = [...document.querySelectorAll(selectorCampos)].filter(el => !OMITIR.has(el.id));
    const porId = new Map(campos.filter(el => el.id).map(el => [el.id, el]));
    contexto.campos.forEach((dato, i) => {
      const el = contexto.schema === 2 && dato.id ? porId.get(dato.id) : campos[i];
      if(!el || el.tagName !== dato.tag || (el.type || '') !== dato.type) return;
      if(el.isContentEditable) el.textContent = dato.valor;
      else if(el.type === 'checkbox' || el.type === 'radio') el.checked = !!dato.marcado;
      else el.value = dato.valor;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    sessionStorage.removeItem(CLAVE);
    navigator.serviceWorker.controller?.postMessage({ type: 'CONFIRMAR_ARRANQUE' });
    return true;
  }

  // Pregunta al service worker que controla la página; null si no hay o no contesta.
  function preguntarSW(tipo) {
    const sw = navigator.serviceWorker.controller;
    if (!sw) return Promise.resolve(null);
    return new Promise(resolve => {
      const canal = new MessageChannel();
      const espera = setTimeout(() => resolve(null), 5000);
      canal.port1.onmessage = e => { clearTimeout(espera); resolve(e.data || null); };
      sw.postMessage({ type: tipo }, [canal.port2]);
    });
  }
  async function buildPublicado() {
    try { const r = await fetch('./release.json', { cache: 'no-store' }); return r.ok ? ((await r.json()).build || '') : ''; }
    catch (_) { return ''; }
  }
  // Sin red también funciona: si la versión nueva ya se descargó, se ofrece igual.
  async function revisar(registro) {
    if (aplicando || aceptarPendiente || sessionStorage.getItem(CLAVE)) return;
    if (navigator.onLine) { try { await registro.update(); } catch (_) {} }
    if (aplicando || aceptarPendiente) return;
    const enEspera = registro.waiting;
    if (enEspera) { mostrarDisponible(await buildPublicado(), () => enEspera.postMessage({ type: 'ACTIVAR_ACTUALIZACION' })); return; }
    const estado = await preguntarSW('ESTADO');
    if (!estado || !estado.lista || estado.lista === estado.aceptada || aplicando || aceptarPendiente) return;
    mostrarDisponible(estado.lista, () => preguntarSW('ACEPTAR').then(() => location.reload()));
  }

  window.iniciarActualizaciones = async function iniciarActualizaciones(){
    if (!('serviceWorker' in navigator)) return;
    if (restaurarContexto()) mostrarActualizada();
    const registro = await navigator.serviceWorker.register('./sw.js');
    const ejecutar = () => revisar(registro).catch(e => console.warn('Actualización:', e));
    // Un worker nuevo tomó control, o avisa que ya tiene otra versión lista: se vuelve a preguntar.
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (sessionStorage.getItem(CLAVE)) location.reload(); else ejecutar(); });
    navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'VERSION_LISTA') ejecutar(); });
    ejecutar();
    setInterval(ejecutar, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ejecutar(); });
    window.addEventListener('online', ejecutar);
  };
})();