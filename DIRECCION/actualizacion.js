/* Actualización segura: conserva la pantalla y sus campos sin guardar secretos ni archivos. */
(function(){
  const CLAVE = 'sumetec_direccion_actualizacion'; const OMITIR = /(?:token|password|pin|codigo)/i;
  const SELECTOR = 'input:not([type="file"]):not([type="password"]),textarea,select,[contenteditable="true"]'; let aplicando = false;
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
    try { localStorage.setItem('direccion_ultima_actualizacion', String(Date.now())); } catch (_) {}
    document.getElementById('sumetecActualizacionTitulo').textContent = 'SUMETEC actualizado';
    document.getElementById('sumetecActualizacionMensaje').textContent = 'Versión ' + VERSION_CODIGO + ' instalada.';
    document.getElementById('sumetecActualizarBoton').hidden = true;
    capa(true);
    requestAnimationFrame(() => setTimeout(() => capa(false), 3000));
  }

  function guardarContexto(buildDestino) {
    if ([...document.querySelectorAll('input[type="file"]')].some(el => el.files?.length)) throw Error('hay un archivo que no se puede restaurar con seguridad');
    const campos = [...document.querySelectorAll(SELECTOR)].filter(el => !OMITIR.test(el.id || el.name || '')).map(el => ({ id: el.id || '', name: el.name || '', tag: el.tagName, type: el.type || '', valor: el.isContentEditable ? el.textContent : el.value, marcado: /checkbox|radio/.test(el.type) ? el.checked : undefined }));
    return { schema: 2, buildDestino, vista: typeof vistaActivaDireccion === 'function' ? vistaActivaDireccion() : null, campos, guardadoEn: Date.now() };
  }
  // Auditoría 2026-09-25 (H-23): el campo se busca por id (o name), NO por su
  // posición. La restauración ocurre justo cuando cambió la versión -- que es
  // cuando el formulario puede traer un campo nuevo o en otro orden -- y por
  // posición un monto podía caer en la casilla del total. Solo si el campo no
  // tiene id ni name, y el formulario conserva exactamente la misma forma, se
  // usa la posición (patrón schema 2 del Cotizador).
  function _destinoCampo_(campos, dato, i, total) {
    if (dato.id) return campos.find(el => el.id === dato.id) || null;
    if (dato.name) return campos.find(el => el.name === dato.name) || null;
    return total === campos.length ? campos[i] : null;
  }
  function restaurarContexto() {
    const raw = sessionStorage.getItem(CLAVE); if (!raw) return false; let estado; try { estado = JSON.parse(raw); } catch (_) { sessionStorage.removeItem(CLAVE); return false; }
    if (![1, 2].includes(estado.schema) || estado.buildDestino !== VERSION_CODIGO || !Array.isArray(estado.campos)) { sessionStorage.removeItem(CLAVE); return false; }
    if (estado.vista && typeof vista === 'function' && estado.vista !== vistaActivaDireccion()) vista(estado.vista);
    const campos = [...document.querySelectorAll(SELECTOR)].filter(el => !OMITIR.test(el.id || el.name || ''));
    estado.campos.forEach((dato, i) => { const el = _destinoCampo_(campos, dato, i, estado.campos.length); if (!el || el.tagName !== dato.tag || (el.type || '') !== dato.type) return; if (el.isContentEditable) el.textContent = dato.valor; else if (/checkbox|radio/.test(el.type)) el.checked = !!dato.marcado; else el.value = dato.valor; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    sessionStorage.removeItem(CLAVE); navigator.serviceWorker.controller?.postMessage({ type: 'CONFIRMAR_ARRANQUE' }); return true;
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

  async function iniciarActualizaciones() {
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
  }
  iniciarActualizaciones().catch(e => console.warn('Actualización:', e));
})();