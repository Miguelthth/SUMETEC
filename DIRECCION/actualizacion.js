/* Actualización segura: conserva la pantalla y sus campos sin guardar secretos ni archivos. */
(function(){
  const CLAVE = 'sumetec_direccion_actualizacion'; const OMITIR = /(?:token|password|pin|codigo)/i;
  const SELECTOR = 'input:not([type="file"]):not([type="password"]),textarea,select,[contenteditable="true"]'; let aplicando = false;
  const capa = mostrar => document.getElementById('sumetecActualizacion')?.classList.toggle('activo', !!mostrar);
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
  async function releaseDisponible(){ const r = await fetch('./release.json', { cache: 'no-store' }); if (!r.ok) throw Error('release no disponible'); return r.json(); }
  function esperar(r){ if(r.waiting) return Promise.resolve(r.waiting); return new Promise(ok=>{ const ver=w=>w?.addEventListener('statechange',()=>{if(w.state==='installed'&&r.waiting)ok(r.waiting)}); ver(r.installing); r.addEventListener('updatefound',()=>ver(r.installing),{once:true}); }); }
  async function revisar(r){ if(!navigator.onLine||aplicando||sessionStorage.getItem(CLAVE))return; let release;try{release=await releaseDisponible()}catch(_){return} if(!release.build||release.build===VERSION_CODIGO)return; await r.update(); const w=await esperar(r);if(!w||aplicando)return; let estado;try{estado=guardarContexto(release.build)}catch(e){console.warn('Actualización aplazada:',e.message);return} aplicando=true;sessionStorage.setItem(CLAVE,JSON.stringify(estado));capa(true);w.postMessage({type:'ACTIVAR_ACTUALIZACION'}); }
  async function iniciar(){ if(!('serviceWorker'in navigator))return; if(restaurarContexto()){capa(true);requestAnimationFrame(()=>setTimeout(()=>capa(false),3000));} const r=await navigator.serviceWorker.register('./sw.js');navigator.serviceWorker.addEventListener('controllerchange',()=>{if(sessionStorage.getItem(CLAVE))location.reload()},{once:true});const ejecutar=()=>revisar(r).catch(e=>console.warn('Actualización:',e));ejecutar();setInterval(ejecutar,5*60*1000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')ejecutar()});window.addEventListener('online',ejecutar); }
  iniciar().catch(e=>console.warn('Actualización:',e));
})();
