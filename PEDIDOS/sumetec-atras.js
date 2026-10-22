// sumetec-atras.js · MISMO archivo en las 6 apps (2026-10).
// El gesto o botón «Atrás» del teléfono cierra lo último que se abrió (pantalla, ventana o menú)
// en vez de salirse de la app. Solo navegación: no toca datos, colas, PIN ni cálculos.
// El acceso (Vincular) y el teclado del PIN NO se cierran con Atrás.
(function () {
  if (window.__sumetecAtras || !window.history || !history.pushState) return;
  window.__sumetecAtras = true;
  const EXCLUIR = '.sumetec-acceso,.sumetec-pin-dialogo,.sumetec-pin-teclado,#vincular,#pin-modal';
  const TXT_CERRAR = /^(✕|×|x|cancelar|cerrar|volver|← volver|←|no)$/i;
  const fn = n => (typeof window[n] === 'function' ? window[n] : null);
  function boton(el) {
    const id = el.id, bs = [...el.querySelectorAll('button,[role=button]')];
    const directo = id && bs.find(b => (b.getAttribute('onclick') || '').replace(/\s/g, '') === "closeOv('" + id + "')");
    return directo || bs.find(b => b.matches('.modal-close,.cerrar,.close,.btn-cerrar,[value=cancel],[value=cancelar],[data-cerrar]')
      || /cerrar|volver|cancelar/i.test(b.getAttribute('aria-label') || '') || TXT_CERRAR.test((b.textContent || '').trim()));
  }
  function cerrarOv(el) { const b = boton(el); if (b) { b.click(); return; } const c = fn('closeOv'); if (c && el.id) c(el.id); else el.classList.remove('open'); }
  function cerrarDialogo(el) { const b = boton(el); if (b) { b.click(); if (!el.open) return; } try { el.close('cancel'); } catch (_) {} }
  function capas() {
    const r = [];
    document.querySelectorAll('.ov.open').forEach(el => r.push({ k: el, cerrar: () => cerrarOv(el) }));
    document.querySelectorAll('dialog[open]').forEach(el => { if (!el.matches(EXCLUIR)) r.push({ k: el, cerrar: () => cerrarDialogo(el) }); });
    const mm = document.querySelector('#menuMas.open');
    if (mm) r.push({ k: mm, cerrar: () => { const c = fn('_cerrarMenuMas'); if (c) c(); else mm.classList.remove('open'); } });
    // Facturación en el teléfono: del detalle de una remisión regresa a la lista.
    if (document.body.dataset.factView === 'detail' && fn('mostrarListaMovil') && matchMedia('(max-width:700px)').matches) r.push({ k: 'fact-detalle', cerrar: () => window.mostrarListaMovil() });
    // Dirección: de Caja, Corte o Inventario regresa a Resumen.
    if (fn('vistaActivaDireccion') && fn('vista')) { const v = window.vistaActivaDireccion(); if (v && v !== 'resumen') r.push({ k: 'dir-' + v, cerrar: () => window.vista('resumen') }); }
    // Logística: del expediente regresa al directorio (su propio botón «← Volver»).
    const vol = document.querySelector('#app > .volver[data-accion="volver"]');
    if (vol) r.push({ k: 'log-volver', cerrar: () => vol.click() });
    return r;
  }
  let orden = [], mapa = new Map(), prof = 0, ignorar = 0, pend = false, url = location.href;
  function sync() {
    pend = false;
    const cs = capas(), ks = cs.map(c => c.k);
    mapa = new Map(cs.map(c => [c.k, c]));
    orden = orden.filter(k => ks.includes(k));
    ks.forEach(k => { if (!orden.includes(k)) orden.push(k); });
    const d = orden.length;
    if (d > prof) { for (; prof < d; prof++) history.pushState({ sumetecCapa: prof + 1 }, ''); }
    else if (d < prof) { const n = prof - d; prof = d; ignorar++; history.go(-n); }
    url = location.href;
  }
  function pedir() { if (!pend) { pend = true; setTimeout(sync, 30); } }
  addEventListener('popstate', () => {
    if (ignorar > 0) { ignorar--; return; }
    if (location.href !== url) { url = location.href; return; } // cambio de #ancla, no es nuestro
    if (!prof) return;
    prof--;
    const k = orden.pop(), c = k && mapa.get(k);
    try { if (c) c.cerrar(); } catch (_) {}
    pedir();
  });
  function iniciar() {
    new MutationObserver(pedir).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open', 'hidden', 'data-fact-view', 'aria-current'] });
    sync();
  }
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
})();
