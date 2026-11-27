// sumetec-mejorada.js · Piezas comunes del diseño «mejorado» (2026-11-26) de Compras, Gastos y Dirección.
// MISMO archivo en las 3 apps (la fuente es 12.- GASTOS). Solo interfaz: hojas, avisos, gestos y dibujos.
// No toca colas, token, PIN ni cálculos de dinero.
(function () {
  'use strict';
  const SMX = window.SMX = {};
  const $ = s => document.querySelector(s);

  SMX.esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  SMX.dinero = n => (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  SMX.hoy = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

  const I = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  SMX.icono = I;

  // Solo se escribe cuando cambia (así los observadores no se llaman a sí mismos).
  SMX.texto = (el, t) => { if (el && el.textContent !== String(t)) el.textContent = String(t); };
  SMX.html = (el, h) => { if (el && el._smx !== h) { el._smx = h; el.innerHTML = h; } };

  SMX.avisos = n => {
    const b = $('#smxAvisos');
    if (!b) return;
    SMX.texto(b.querySelector('b'), n);
    if (b.lastChild && b.lastChild.nodeType === 3) { const t = n === 1 ? ' aviso' : ' avisos'; if (b.lastChild.data !== t) b.lastChild.data = t; }
    b.classList.toggle('has', n > 0);
    b.setAttribute('aria-label', n + (n === 1 ? ' aviso pendiente' : ' avisos pendientes'));
  };

  // ── Deslizar hacia abajo una hoja para cerrarla ──
  function cerrarAlBajar(el, cerrar) {
    let y = null, dy = 0;
    el.addEventListener('touchstart', e => { if (el.scrollTop <= 0) { y = e.touches[0].clientY; dy = 0; } }, { passive: true });
    el.addEventListener('touchmove', e => { if (y !== null) { dy = e.touches[0].clientY - y; if (dy > 0) el.style.transform = 'translateY(' + dy + 'px)'; } }, { passive: true });
    el.addEventListener('touchend', () => { el.style.transform = ''; if (y !== null && dy > 90) cerrar(); y = null; dy = 0; });
  }

  // El menú ⋮ de siempre (mismos botones y funciones) se ve como la hoja «Más».
  SMX.menu = (menu, opciones) => {
    if (!menu) return;
    const o = opciones || {};
    menu.classList.add('smx-hoja-menu');
    menu.insertAdjacentHTML('afterbegin', '<div class="smx-asa" aria-hidden="true"></div><h3>' + (o.titulo || 'Más opciones') + '</h3><p class="smx-desc">' + (o.desc || '') + '</p>');
    const velo = document.createElement('div');
    velo.className = 'smx-velo';
    document.body.appendChild(velo);
    const cerrar = () => { menu.hidden = true; menu.style.display = 'none'; const b = o.boton && $(o.boton); if (b) b.setAttribute('aria-expanded', 'false'); };
    const pintar = () => velo.classList.toggle('ver', !menu.hidden);
    new MutationObserver(() => { if (!menu.hidden && menu.style.display === 'none') menu.style.display = ''; pintar(); }).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
    velo.addEventListener('click', e => { e.stopPropagation(); cerrar(); });
    menu.addEventListener('click', e => { if (e.target.closest('button')) setTimeout(cerrar, 0); });
    cerrarAlBajar(menu, cerrar);
    SMX.cerrarMenu = cerrar;
  };

  // Hoja de información (es un <dialog>: Atrás del teléfono y Escape la cierran).
  SMX.hoja = (titulo, cuerpo, botones) => {
    document.querySelectorAll('dialog.smx-hoja').forEach(d => d.close());
    const d = document.createElement('dialog');
    d.className = 'smx-hoja';
    d.setAttribute('aria-label', titulo);
    d.innerHTML = '<div class="smx-asa" aria-hidden="true"></div><h3>' + SMX.esc(titulo) + '</h3><div class="smx-cuerpo">' + cuerpo + '</div><div class="smx-botones"></div>';
    const pie = d.querySelector('.smx-botones');
    (botones || [{ texto: 'Entendido', clase: 'btn-primary' }]).forEach(b => {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'btn ' + (b.clase || 'btn-outline-secondary'); x.textContent = b.texto;
      x.addEventListener('click', () => { if (!b.queda) d.close(); if (b.alTocar) b.alTocar(d); });
      pie.appendChild(x);
    });
    d.addEventListener('click', e => { if (e.target === d && e.clientY < d.getBoundingClientRect().top) d.close(); });
    d.addEventListener('close', () => d.remove(), { once: true });
    cerrarAlBajar(d, () => d.close());
    document.body.appendChild(d);
    d.showModal();
    return d;
  };

  SMX.gestos = (titulo, lista) => SMX.hoja(titulo, lista.map(g => '<div class="smx-gesto"><i>' + g[0] + '</i><span><b>' + g[1] + '</b><small>' + g[2] + '</small></span></div>').join(''));

  // Palomita de «guardado»: no tapa el resto de la pantalla y se quita sola.
  let quitaExito = null;
  SMX.exito = (titulo, mensaje, botones) => {
    document.querySelectorAll('.smx-exito').forEach(x => x.remove());
    const d = document.createElement('div');
    d.className = 'smx-exito';
    d.innerHTML = '<div aria-hidden="' + (botones ? 'false' : 'true') + '"><svg viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="34"/><path d="M24 39.5 34 49 53 29"/></svg><h3></h3><p></p><div class="smx-botones"></div></div>';
    d.querySelector('h3').textContent = titulo;
    d.querySelector('p').textContent = mensaje || '';
    const pie = d.querySelector('.smx-botones');
    (botones || []).forEach(b => {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'btn ' + (b.clase || 'btn-outline-secondary'); x.textContent = b.texto;
      x.addEventListener('click', () => { d.remove(); if (b.alTocar) b.alTocar(); });
      pie.appendChild(x);
    });
    if (!botones) { pie.remove(); d.firstElementChild.style.pointerEvents = 'none'; }
    document.body.appendChild(d);
    clearTimeout(quitaExito);
    quitaExito = setTimeout(() => d.remove(), botones ? 2600 : 1500);
    return d;
  };

  const encimaDeTodo = () => document.querySelector('dialog[open], .smx-velo.ver') || (document.querySelector('.sumetec-acceso') && [...document.querySelectorAll('.sumetec-acceso')].some(e => e.offsetParent !== null));

  // ── Tirar hacia abajo para actualizar ──
  SMX.jalar = alSoltar => {
    const caja = document.createElement('div');
    caja.className = 'smx-jalar';
    caja.setAttribute('aria-hidden', 'true');
    caja.innerHTML = '<i></i><span>Suelta para actualizar</span>';
    const cabeza = document.querySelector('header');
    if (cabeza) cabeza.insertAdjacentElement('afterend', caja);
    let y = null, alto = 0, ocupado = false;
    document.addEventListener('touchstart', e => { y = (window.scrollY <= 0 && !ocupado && !encimaDeTodo() && !e.target.closest('input,select,textarea')) ? e.touches[0].clientY : null; alto = 0; }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (y === null || window.scrollY > 0) return;
      alto = Math.max(0, Math.min((e.touches[0].clientY - y) * .45, 60));
      caja.style.height = alto + 'px';
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (y === null) return;
      y = null;
      if (alto < 52) { caja.style.height = '0'; return; }
      ocupado = true; caja.classList.add('cargando'); caja.style.height = '44px';
      Promise.resolve().then(alSoltar).catch(() => {}).then(() => setTimeout(() => { caja.classList.remove('cargando'); caja.style.height = '0'; ocupado = false; }, 500));
    });
  };

  // ── Deslizar un renglón a la izquierda ──
  SMX.deslizar = (selector, alDeslizar) => {
    let el = null, x = 0, y = 0, dx = 0;
    document.addEventListener('touchstart', e => {
      el = e.target.closest(selector);
      if (!el || e.target.closest('input,select,textarea,button')) { el = null; return; }
      x = e.touches[0].clientX; y = e.touches[0].clientY; dx = 0; el.style.transition = 'none';
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!el) return;
      dx = e.touches[0].clientX - x;
      if (Math.abs(e.touches[0].clientY - y) > Math.abs(dx)) { el.style.transform = ''; return; }
      el.style.transform = dx < 0 ? 'translate3d(' + Math.max(dx, -110) + 'px,0,0)' : '';
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (!el) return;
      const item = el; el = null;
      item.style.transition = 'transform .28s cubic-bezier(.22,.9,.3,1)';
      item.style.transform = '';
      if (dx < -78) alDeslizar(item);
    });
  };

  // ── Deslizar en un espacio vacío para cambiar de sección ──
  SMX.lados = (alDeslizar, ignorar) => {
    let x = null, y = 0;
    const fuera = 'input,select,textarea,button,label,summary,dialog,li,.card,.smx-hoja-menu,.sumetec-acceso,.gv-fila-wrap' + (ignorar ? ',' + ignorar : '');
    document.addEventListener('touchstart', e => { x = (e.target.closest(fuera) || encimaDeTodo()) ? null : e.touches[0].clientX; y = x === null ? 0 : e.touches[0].clientY; }, { passive: true });
    document.addEventListener('touchend', e => {
      if (x === null) return;
      const dx = e.changedTouches[0].clientX - x, dy = e.changedTouches[0].clientY - y;
      x = null;
      if (Math.abs(dx) > 80 && Math.abs(dy) < 45) alDeslizar(dx < 0 ? 1 : -1);
    }, { passive: true });
  };

  // La barra del total se guarda al bajar o al escribir para no tapar campos (como en el prototipo).
  // Bajo automatización (robots de pruebas) se queda fija: un botón que se esconde les haría fallar el clic.
  SMX.barraQueSeEsconde = selector => {
    if (navigator.webdriver) return;
    let ultimo = 0;
    const barra = () => document.querySelector(selector);
    window.addEventListener('scroll', () => {
      const b = barra(), y = window.scrollY;
      if (!b) return;
      const alFinal = y + window.innerHeight >= document.documentElement.scrollHeight - 40;
      if (y > ultimo + 8 && y > 140 && !alFinal) b.classList.add('oculta'); else if (y < ultimo - 4 || alFinal) b.classList.remove('oculta');
      ultimo = y;
    }, { passive: true });
    document.addEventListener('focusin', e => { const b = barra(); if (b && e.target.matches('input:not([type=radio],[type=checkbox]),textarea')) b.classList.add('oculta'); });
    document.addEventListener('focusout', () => setTimeout(() => { const b = barra(); if (b && !document.activeElement.matches('input,textarea')) b.classList.remove('oculta'); }, 250));
  };

  // Doble toque en el encabezado: arriba.
  document.addEventListener('dblclick', e => { if (e.target.closest('.smx-top') && !e.target.closest('button')) window.scrollTo({ top: 0, behavior: 'smooth' }); });
})();
