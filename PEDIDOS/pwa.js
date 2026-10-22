(function () {
  'use strict';
  const demo = new URLSearchParams(location.search).get('demo') === '1' && /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (demo) return;
  let registro, pendiente = '', aplicando = false, aviso, boton, mensaje, instalacion;
  const puedeActualizar = () => typeof window.sumetecPedidosPuedeActualizar === 'function' && window.sumetecPedidosPuedeActualizar() === true;
  const dialogoAbierto = () => !!document.querySelector('dialog[open]');

  function pintarAviso() {
    if (!aviso) return;
    const oculto = !pendiente || dialogoAbierto();
    if (aviso.hidden !== oculto) aviso.hidden = oculto;
    const desactivado = aplicando || !puedeActualizar();
    if (boton.disabled !== desactivado) boton.disabled = desactivado;
  }
  function crearAviso() {
    if (aviso) return;
    aviso = document.createElement('section');
    aviso.className = 'pedidos-actualizacion';
    aviso.setAttribute('role', 'status');
    aviso.setAttribute('aria-live', 'polite');
    aviso.setAttribute('aria-label', 'Actualización de SUMETEC Pedidos');
    const titulo = document.createElement('strong'); titulo.textContent = 'Actualización disponible';
    mensaje = document.createElement('p'); mensaje.textContent = 'Tu pedido se conserva. Actualiza cuando termines.';
    boton = document.createElement('button'); boton.id = 'pedidos-actualizar'; boton.className = 'button primary'; boton.type = 'button'; boton.textContent = 'Actualizar app';
    boton.addEventListener('click', aplicarActualizacion);
    aviso.append(titulo, mensaje, boton); document.body.appendChild(aviso); pintarAviso();
  }
  function preguntarSW(type) {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return Promise.resolve(null);
    return new Promise(resolve => {
      const canal = new MessageChannel();
      const terminar = dato => { clearTimeout(espera); canal.port1.close(); resolve(dato); };
      const espera = setTimeout(() => terminar(null), 5000);
      canal.port1.onmessage = e => terminar(e.data || null);
      try { worker.postMessage({ type }, [canal.port2]); } catch (_) { terminar(null); }
    });
  }
  async function revisar() {
    if (aplicando) return;
    const estado = await preguntarSW('ESTADO');
    if (!estado?.lista) return;
    const actual = String(window.SUMETEC_VERSION || '');
    pendiente = estado.lista !== actual ? estado.lista : '';
    if (pendiente) crearAviso();
    else if (actual === estado.aceptada && typeof window.sumetecPedidosGuardarParaActualizar === 'function') navigator.serviceWorker.controller?.postMessage({ type: 'CONFIRMAR_ARRANQUE' });
    pintarAviso();
  }
  async function aplicarActualizacion() {
    if (!pendiente || aplicando || dialogoAbierto() || !puedeActualizar()) return;
    aplicando = true; pintarAviso();
    try {
      if (typeof window.sumetecPedidosGuardarParaActualizar !== 'function' || await window.sumetecPedidosGuardarParaActualizar() !== true || !puedeActualizar()) throw Error('No se pudo guardar tu pedido. Intenta nuevamente antes de actualizar.');
      const respuesta = await preguntarSW('ACEPTAR');
      if (!respuesta?.ok) throw Error('No se pudo preparar la actualización. Intenta nuevamente.');
      // reload conserva el fragmento del enlace privado sin copiarlo a almacenamiento.
      location.reload();
    } catch (error) { mensaje.textContent = error.message; aplicando = false; pintarAviso(); }
  }

  async function prepararManifiestoPersonal() {
    const enlace = document.querySelector('link[rel="manifest"]');
    if (!enlace || !location.hash.startsWith('#token=')) return;
    try {
      const origen = new URL(enlace.href, location.href);
      const r = await fetch(origen.href); if (!r.ok) return;
      const config = await r.json();
      config.id = new URL(config.id || './', origen).href;
      config.scope = new URL(config.scope || './', origen).href;
      config.start_url = location.href;
      config.icons = (config.icons || []).map(icono => ({ ...icono, src: new URL(icono.src, origen).href }));
      // El acceso instalado conserva el enlace. El manifiesto sólo vive en memoria.
      const blob = URL.createObjectURL(new Blob([JSON.stringify(config)], { type: 'application/manifest+json' }));
      enlace.href = blob;
    } catch (_) { /* El manifiesto estático sigue disponible si el navegador lo requiere. */ }
  }
  function mostrarInstalacion(e) {
    e.preventDefault(); instalacion = e;
    if (document.getElementById('pedidos-instalar')) return;
    const instalar = document.createElement('button');
    instalar.id = 'pedidos-instalar'; instalar.className = 'pedidos-instalar button secondary'; instalar.type = 'button'; instalar.textContent = 'Instalar app';
    instalar.addEventListener('click', async () => {
      if (!instalacion) return;
      const evento = instalacion; instalacion = null;
      try { await evento.prompt(); await evento.userChoice; } catch (_) {}
      instalar.remove();
    });
    (document.querySelector('footer') || document.body).appendChild(instalar);
  }
  window.addEventListener('beforeinstallprompt', mostrarInstalacion);
  window.addEventListener('appinstalled', () => { document.getElementById('pedidos-instalar')?.remove(); instalacion = null; });

  async function iniciar() {
    prepararManifiestoPersonal();
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
      registro = await navigator.serviceWorker.register('./sw.js');
      navigator.serviceWorker.addEventListener('controllerchange', revisar);
      navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'VERSION_LISTA') revisar(); });
      new MutationObserver(pintarAviso).observe(document.body, { attributes: true, childList: true, subtree: true });
      document.addEventListener('input', pintarAviso);
      document.addEventListener('change', pintarAviso);
      const comprobar = () => { registro.update().catch(() => {}); revisar(); };
      window.addEventListener('online', comprobar);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') comprobar(); });
      setInterval(comprobar, 5 * 60 * 1000);
      await revisar();
    } catch (_) { /* El portal online funciona también sin service worker. */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
})();
