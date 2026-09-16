/* Actualización segura: la nueva app toma control sólo después de guardar
   una captura serializable. Nunca guarda archivos, PIN ni token. */
(function(){
  const CLAVE = 'sumetec_gastos_actualizacion';
  const OMITIR = /(?:token|password|pin|codigo)/i;
  const SELECTOR = 'input:not([type="file"]):not([type="password"]),textarea,select,[contenteditable="true"]';
  let aplicando = false;

  const capa = mostrar => document.getElementById('sumetecActualizacion')?.classList.toggle('activo', !!mostrar);
  function guardarContexto(buildDestino) {
    if ((typeof _guardandoGasto !== 'undefined' && _guardandoGasto) ||
        [...document.querySelectorAll('input[type="file"]')].some(el => el.files?.length)) {
      throw new Error('hay una captura o envío que no se puede restaurar con seguridad');
    }
    const campos = [...document.querySelectorAll(SELECTOR)].filter(el => !OMITIR.test(el.id || el.name || ''))
      .map(el => ({ tag: el.tagName, type: el.type || '', valor: el.isContentEditable ? el.textContent : el.value,
        marcado: /checkbox|radio/.test(el.type) ? el.checked : undefined }));
    return { schema: 1, buildDestino, campos, guardadoEn: Date.now() };
  }
  function restaurarContexto() {
    const raw = sessionStorage.getItem(CLAVE); if (!raw) return false;
    let estado; try { estado = JSON.parse(raw); } catch (_) { sessionStorage.removeItem(CLAVE); return false; }
    if (estado.schema !== 1 || estado.buildDestino !== VERSION_CODIGO || !Array.isArray(estado.campos)) { sessionStorage.removeItem(CLAVE); return false; }
    const campos = [...document.querySelectorAll(SELECTOR)].filter(el => !OMITIR.test(el.id || el.name || ''));
    estado.campos.forEach((dato, i) => { const el = campos[i]; if (!el || el.tagName !== dato.tag || (el.type || '') !== dato.type) return;
      if (el.isContentEditable) el.textContent = dato.valor; else if (/checkbox|radio/.test(el.type)) el.checked = !!dato.marcado; else el.value = dato.valor;
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    sessionStorage.removeItem(CLAVE); navigator.serviceWorker.controller?.postMessage({ type: 'CONFIRMAR_ARRANQUE' }); return true;
  }
  async function releaseDisponible() { const r = await fetch('./release.json', { cache: 'no-store' }); if (!r.ok) throw Error('release no disponible'); return r.json(); }
  function esperar(registro) { if (registro.waiting) return Promise.resolve(registro.waiting); return new Promise(resolve => {
    const ver = worker => worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && registro.waiting) resolve(registro.waiting); });
    ver(registro.installing); registro.addEventListener('updatefound', () => ver(registro.installing), { once: true }); }); }
  async function revisar(registro) {
    if (!navigator.onLine || aplicando || sessionStorage.getItem(CLAVE)) return;
    let release; try { release = await releaseDisponible(); } catch (_) { return; }
    if (!release.build || release.build === VERSION_CODIGO) return;
    await registro.update(); const worker = await esperar(registro); if (!worker || aplicando) return;
    let estado; try { estado = guardarContexto(release.build); } catch (e) { console.warn('Actualización aplazada:', e.message); return; }
    aplicando = true; sessionStorage.setItem(CLAVE, JSON.stringify(estado)); capa(true); worker.postMessage({ type: 'ACTIVAR_ACTUALIZACION' });
  }
  async function iniciarActualizaciones() {
    if (!('serviceWorker' in navigator)) return;
    if (restaurarContexto()) { capa(true); requestAnimationFrame(() => setTimeout(() => capa(false), 3000)); }
    const registro = await navigator.serviceWorker.register('./sw.js');
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (sessionStorage.getItem(CLAVE)) location.reload(); }, { once: true });
    const ejecutar = () => revisar(registro).catch(e => console.warn('Actualización:', e)); ejecutar();
    setInterval(ejecutar, 5 * 60 * 1000); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ejecutar(); }); window.addEventListener('online', ejecutar);
  }
  iniciarActualizaciones().catch(e => console.warn('Actualización:', e));
})();
