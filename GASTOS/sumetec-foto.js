/* sumetec-foto.js -- visor flotante de la foto del ticket + realce tipo escáner.
 *
 * Fuente ÚNICA: 12.- GASTOS/sumetec-foto.js. Las demás apps llevan copia idéntica
 * (herramientas/sincronizar_sumetec_foto.py la reparte y una prueba exige que sigan iguales).
 *
 * Qué hace (pedido de Miguel, 2026-10-26):
 *  1. Realce sobre la MISMA foto, con interruptor: Original · Realce (color, luz pareja, papel
 *     blanco) · Blanco y negro (umbral local, como las apps de escáner). Se puede alternar las
 *     veces que haga falta para ver cuál conviene.
 *  2. Ventana flotante: la foto queda a la mano mientras se revisan los datos que llenó la IA.
 *     Se arrastra, se hace zoom (botones, rueda o pellizco), se minimiza a una burbuja y NO se
 *     pierde al navegar; la app la cierra con SumetecFoto.cerrar() cuando el dato se guarda.
 *  3. Opcional: «Leer con este filtro» reintenta la lectura de la IA con la versión realzada.
 *
 * Regla de evidencia: el realce es SOLO para ver y, si el usuario lo pide, para leer. La foto que
 * se guarda (Drive / ERP) siempre es la original; ver fotoParaOcr().
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SumetecFoto = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';

  const MODOS = ['original', 'realce', 'bn'];
  const ETIQUETA = { original: 'Original', realce: 'Realce', bn: 'Blanco y negro' };
  const LADO_MAX = 1600; // mismo tope que la compresión que ya usan las apps

  /* ───────────── Procesamiento de píxeles (puro, probado en Node) ───────────── */

  // Suma acumulada para promedios locales en O(1) por píxel.
  function integral(lum, w, h) {
    const W = w + 1, s = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let fila = 0;
      for (let x = 0; x < w; x++) {
        fila += lum[y * w + x];
        s[(y + 1) * W + x + 1] = s[y * W + x + 1] + fila;
      }
    }
    return s;
  }

  function luminancia(rgba, w, h) {
    const lum = new Float32Array(w * h);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    return lum;
  }

  const suave = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // rgba: Uint8ClampedArray (w*h*4). Devuelve una COPIA procesada; nunca modifica la entrada.
  //  - original: copia tal cual.
  //  - realce:   divide cada píxel entre el brillo promedio de su vecindario (quita sombras y
  //              viñeteo), manda el papel a blanco y oscurece la tinta; conserva el color.
  //  - bn:       umbral local (el píxel es tinta si es claramente más oscuro que su vecindario).
  function procesar(rgba, w, h, modo) {
    const out = new Uint8ClampedArray(rgba);
    if (modo !== 'realce' && modo !== 'bn') return out;
    const lum = luminancia(rgba, w, h), S = integral(lum, w, h), W = w + 1;
    const r = Math.max(7, Math.round(Math.min(w, h) / 12));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const area = (x1 - x0) * (y1 - y0);
        const media = (S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0]) / area;
        const i = y * w + x, p = i * 4, l = lum[i], ratio = l / Math.max(media, 1);
        if (modo === 'bn') {
          const v = ratio < 0.86 ? 0 : 255;
          out[p] = out[p + 1] = out[p + 2] = v;
        } else {
          const t = suave(0.42, 0.97, ratio);       // 0 = tinta, 1 = papel
          const lumSalida = 255 * t;
          const ganancia = Math.min(6, lumSalida / Math.max(l, 1));
          out[p] = rgba[p] * ganancia; out[p + 1] = rgba[p + 1] * ganancia; out[p + 2] = rgba[p + 2] * ganancia;
        }
      }
    }
    return out;
  }

  /* ───────────── Estado del visor (solo existe en el navegador) ───────────── */

  let modo = 'original';
  let ui = null;           // {panel, burbuja, lienzo, ...}
  let origen = null;       // {imagenData, w, h, url, titulo, alLeer}
  const cache = {};        // modo -> ImageData ya procesado de la foto actual
  let zoom = 1, desx = 0, desy = 0;
  const oyentes = [];

  const CSS = `
.sfoto-panel{position:fixed;z-index:2147482000;right:10px;bottom:10px;width:min(94vw,380px);height:min(58vh,460px);display:flex;flex-direction:column;background:var(--sm-bg,#fff);color:var(--sm-body-text,#17202a);border:1px solid var(--sm-border-soft,#b9c4cf);border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.35);overflow:hidden;font:14px/1.3 system-ui,sans-serif;touch-action:none}
.sfoto-panel[hidden],.sfoto-burbuja[hidden]{display:none}
.sfoto-cab{display:flex;align-items:center;gap:6px;padding:6px 8px;background:#023561;color:#fff;cursor:grab;user-select:none;-webkit-user-select:none}
.sfoto-cab:active{cursor:grabbing}
.sfoto-tit{flex:1;min-width:0;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sfoto-btn{min-width:36px;min-height:36px;border:0;border-radius:8px;background:rgba(255,255,255,.16);color:inherit;font:700 16px/1 system-ui,sans-serif;cursor:pointer}
.sfoto-btn:focus-visible,.sfoto-modo button:focus-visible{outline:3px solid #76B82A;outline-offset:1px}
.sfoto-visor{position:relative;flex:1;min-height:0;overflow:hidden;background:#2b3138;touch-action:none}
.sfoto-visor canvas{position:absolute;left:0;top:0;transform-origin:0 0;image-rendering:auto;max-width:none}
.sfoto-pie{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;border-top:1px solid var(--sm-border-soft,#b9c4cf)}
.sfoto-modo{display:flex;flex:1 1 auto;gap:4px}
.sfoto-modo button{flex:1;min-height:38px;padding:0 6px;border:1px solid var(--sm-border-soft,#9aa8b5);border-radius:8px;background:transparent;color:inherit;font:600 12px/1.1 system-ui,sans-serif;cursor:pointer}
.sfoto-modo button[aria-pressed="true"]{background:#057448;border-color:#057448;color:#fff}
.sfoto-zoom{display:flex;gap:4px}
.sfoto-zoom button,.sfoto-leer{min-height:38px;min-width:38px;border:1px solid var(--sm-border-soft,#9aa8b5);border-radius:8px;background:transparent;color:inherit;font:700 15px/1 system-ui,sans-serif;cursor:pointer}
.sfoto-leer{flex:1 1 100%;font-size:12px;font-weight:600;background:#0D3B66;border-color:#0D3B66;color:#fff}
.sfoto-leer[hidden]{display:none}
.sfoto-burbuja{position:fixed;z-index:2147482000;right:12px;bottom:84px;width:58px;height:58px;border-radius:50%;border:3px solid #fff;background:#023561 center/cover no-repeat;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer;touch-action:none;padding:0;color:#fff;font-size:22px}
.sfoto-burbuja span{position:absolute;right:-4px;top:-4px;min-width:20px;height:20px;border-radius:10px;background:#76B82A;color:#0b2a14;font:700 12px/20px system-ui,sans-serif;text-align:center}
@media (prefers-reduced-motion:no-preference){.sfoto-panel,.sfoto-burbuja{animation:sfoto-entra .18s ease-out}@keyframes sfoto-entra{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}}
`;

  function el(tag, attrs, hijos) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'texto') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
    }
    (hijos || []).forEach(h => e.appendChild(h));
    return e;
  }

  function guardarPos(clave, x, y) { try { sessionStorage.setItem('sfoto_' + clave, JSON.stringify([x, y])); } catch (_) {} }
  function leerPos(clave) { try { return JSON.parse(sessionStorage.getItem('sfoto_' + clave) || 'null'); } catch (_) { return null; } }

  // Mueve un elemento con el dedo/ratón. `agarre` es lo que se toca; `mover` es lo que se desplaza.
  function hacerArrastrable(agarre, mover, clave, alToque) {
    let ini = null, movio = false;
    agarre.addEventListener('pointerdown', e => {
      if (e.target.closest && e.target.closest('button') && e.target !== agarre) return;
      const r = mover.getBoundingClientRect();
      ini = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width, h: r.height }; movio = false;
      try { agarre.setPointerCapture(e.pointerId); } catch (_) {}
    });
    agarre.addEventListener('pointermove', e => {
      if (!ini) return;
      const dx = e.clientX - ini.x, dy = e.clientY - ini.y;
      if (!movio && Math.abs(dx) + Math.abs(dy) < 6) return;
      movio = true;
      const l = Math.min(Math.max(0, ini.l + dx), Math.max(0, innerWidth - ini.w));
      const t = Math.min(Math.max(0, ini.t + dy), Math.max(0, innerHeight - ini.h));
      mover.style.left = l + 'px'; mover.style.top = t + 'px'; mover.style.right = 'auto'; mover.style.bottom = 'auto';
    });
    const fin = e => {
      if (!ini) return;
      const r = mover.getBoundingClientRect();
      if (movio) guardarPos(clave, r.left, r.top); else if (alToque) alToque();
      ini = null;
    };
    agarre.addEventListener('pointerup', fin);
    agarre.addEventListener('pointercancel', () => { ini = null; });
  }

  function aplicarPos(nodo, clave) {
    const p = leerPos(clave);
    if (!p) return;
    const w = nodo.offsetWidth || 60, h = nodo.offsetHeight || 60;
    nodo.style.left = Math.min(Math.max(0, p[0]), Math.max(0, innerWidth - w)) + 'px';
    nodo.style.top = Math.min(Math.max(0, p[1]), Math.max(0, innerHeight - h)) + 'px';
    nodo.style.right = 'auto'; nodo.style.bottom = 'auto';
  }

  function construir() {
    if (ui) return ui;
    const estilo = el('style', { 'data-sumetec-foto': '1' }); estilo.textContent = CSS; document.head.appendChild(estilo);

    const titulo = el('div', { class: 'sfoto-tit', texto: 'Foto del documento' });
    const bMin = el('button', { type: 'button', class: 'sfoto-btn', 'aria-label': 'Minimizar la foto', title: 'Minimizar', texto: '–' });
    const bCerrar = el('button', { type: 'button', class: 'sfoto-btn', 'aria-label': 'Cerrar la foto', title: 'Cerrar', texto: '×' });
    const cab = el('div', { class: 'sfoto-cab' }, [titulo, bMin, bCerrar]);

    const lienzo = el('canvas', { 'aria-label': 'Foto del documento' });
    const visor = el('div', { class: 'sfoto-visor' }, [lienzo]);

    const botonesModo = MODOS.map(m => el('button', { type: 'button', 'data-modo': m, 'aria-pressed': 'false', texto: ETIQUETA[m] }));
    const grupoModo = el('div', { class: 'sfoto-modo', role: 'group', 'aria-label': 'Cómo ver la foto' }, botonesModo);
    const bMenos = el('button', { type: 'button', 'aria-label': 'Alejar', texto: '−' });
    const bMas = el('button', { type: 'button', 'aria-label': 'Acercar', texto: '+' });
    const bAjustar = el('button', { type: 'button', 'aria-label': 'Ajustar al ancho', title: 'Ajustar', texto: '⤢' });
    const grupoZoom = el('div', { class: 'sfoto-zoom' }, [bMenos, bMas, bAjustar]);
    const bLeer = el('button', { type: 'button', class: 'sfoto-leer', hidden: '', texto: 'Leer otra vez con este filtro' });
    const pie = el('div', { class: 'sfoto-pie' }, [grupoModo, grupoZoom, bLeer]);

    const panel = el('div', { class: 'sfoto-panel', role: 'dialog', 'aria-label': 'Foto del documento', hidden: '' }, [cab, visor, pie]);
    const burbuja = el('button', { type: 'button', class: 'sfoto-burbuja', 'aria-label': 'Abrir la foto del documento', hidden: '', texto: '📷' });
    document.body.appendChild(panel); document.body.appendChild(burbuja);

    ui = { panel, burbuja, lienzo, visor, titulo, botonesModo, bLeer };

    bMin.onclick = minimizar; bCerrar.onclick = cerrar; bAjustar.onclick = ajustar;
    bMas.onclick = () => acercar(1.35); bMenos.onclick = () => acercar(1 / 1.35);
    botonesModo.forEach(b => { b.onclick = () => fijarModo(b.getAttribute('data-modo')); });
    bLeer.onclick = () => { if (origen && typeof origen.alLeer === 'function') origen.alLeer(modo); };
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); minimizar(); } });

    hacerArrastrable(cab, panel, 'panel');
    hacerArrastrable(burbuja, burbuja, 'burbuja', restaurar);
    conectarGestos(visor);
    return ui;
  }

  // Zoom con rueda, pellizco de dos dedos y arrastre de un dedo dentro de la foto.
  function conectarGestos(visor) {
    const punteros = new Map();
    let dist0 = 0, zoom0 = 1;
    visor.addEventListener('wheel', e => { e.preventDefault(); acercar(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    visor.addEventListener('pointerdown', e => { punteros.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { visor.setPointerCapture(e.pointerId); } catch (_) {}
      if (punteros.size === 2) { const [a, b] = [...punteros.values()]; dist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; zoom0 = zoom; } });
    visor.addEventListener('pointermove', e => {
      const p = punteros.get(e.pointerId); if (!p) return;
      if (punteros.size === 2) {
        punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...punteros.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        zoomA(zoom0 * d / dist0, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else { desx += e.clientX - p.x; desy += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; pintarTransform(); }
    });
    const suelta = e => { punteros.delete(e.pointerId); };
    visor.addEventListener('pointerup', suelta); visor.addEventListener('pointercancel', suelta);
    visor.addEventListener('dblclick', () => ajustar());
  }

  function pintarTransform() {
    if (!ui) return;
    ui.lienzo.style.transform = `translate(${desx}px,${desy}px) scale(${zoom})`;
  }
  function zoomA(nuevo, cx, cy) {
    nuevo = Math.min(8, Math.max(0.2, nuevo));
    const r = ui.visor.getBoundingClientRect(), px = (cx == null ? r.left + r.width / 2 : cx) - r.left, py = (cy == null ? r.top + r.height / 2 : cy) - r.top;
    desx = px - (px - desx) * (nuevo / zoom); desy = py - (py - desy) * (nuevo / zoom); zoom = nuevo; pintarTransform();
  }
  function acercar(f, cx, cy) { if (ui && origen) zoomA(zoom * f, cx, cy); }
  // Ajusta al ancho del visor (los tickets son altos y angostos: se recorre hacia abajo con el dedo).
  function ajustar() {
    if (!ui || !origen) return;
    const ancho = ui.visor.clientWidth || 300;
    zoom = ancho / origen.w; desx = 0; desy = 0; pintarTransform();
  }

  /* ───────────── Carga y dibujo ───────────── */

  function cargarImagen(fuente) {
    return new Promise((ok, mal) => {
      const url = typeof fuente === 'string' ? fuente : URL.createObjectURL(fuente);
      const img = new Image();
      img.onload = () => ok({ img, url, propia: typeof fuente !== 'string' });
      img.onerror = () => { if (typeof fuente !== 'string') URL.revokeObjectURL(url); mal(Error('IMAGEN_ILEGIBLE')); };
      img.src = url;
    });
  }

  function dibujarModo() {
    if (!ui || !origen) return;
    if (!cache[modo]) {
      const d = procesar(origen.imagenData.data, origen.w, origen.h, modo);
      cache[modo] = new ImageData(d, origen.w, origen.h);
    }
    ui.lienzo.width = origen.w; ui.lienzo.height = origen.h;
    ui.lienzo.getContext('2d').putImageData(cache[modo], 0, 0);
    ui.botonesModo.forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-modo') === modo)));
  }

  function fijarModo(m) {
    if (MODOS.indexOf(m) < 0) return modo;
    modo = m;
    dibujarModo();
    oyentes.forEach(f => { try { f(modo); } catch (_) {} });
    return modo;
  }

  // Muestra la foto (File/Blob o URL) en la ventana flotante. Devuelve false si no es una imagen que
  // el navegador pueda dibujar (por ejemplo un PDF): la app sigue como antes, sin ventana.
  async function mostrar(fuente, opciones) {
    opciones = opciones || {};
    if (!fuente || (fuente.type && !/^image\//.test(fuente.type))) { cerrar(); return false; }
    let carga;
    try { carga = await cargarImagen(fuente); } catch (_) { cerrar(); return false; }
    const { img, url, propia } = carga;
    const ladoMayor = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height) || 1;
    const k = Math.min(1, LADO_MAX / ladoMayor);
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * k)), h = Math.max(1, Math.round((img.naturalHeight || img.height) * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
    const datos = cx.getImageData(0, 0, w, h);
    liberar();
    origen = { imagenData: datos, w, h, url: propia ? url : null, urlMini: url, titulo: opciones.titulo || 'Foto del documento', alLeer: opciones.alLeer };
    Object.keys(cache).forEach(k2 => delete cache[k2]);
    construir();
    modo = 'original'; // cada foto nueva parte sin filtro: la primera lectura de la IA siempre es sobre la original
    ui.titulo.textContent = origen.titulo;
    ui.bLeer.hidden = typeof origen.alLeer !== 'function';
    ui.burbuja.style.backgroundImage = `url("${url}")`;
    ui.burbuja.textContent = '';
    dibujarModo();
    ui.panel.hidden = false; ui.burbuja.hidden = true;
    aplicarPos(ui.panel, 'panel');
    ajustar();
    return true;
  }

  function liberar() {
    if (origen && origen.url) { try { URL.revokeObjectURL(origen.url); } catch (_) {} }
    origen = null;
  }

  function minimizar() { if (!ui || !origen) return; ui.panel.hidden = true; ui.burbuja.hidden = false; aplicarPos(ui.burbuja, 'burbuja'); }
  function restaurar() { if (!ui || !origen) return; ui.burbuja.hidden = true; ui.panel.hidden = false; aplicarPos(ui.panel, 'panel'); }
  // La app lo llama cuando el dato se guardó (o se canceló la captura): la ventana y la burbuja se van.
  function cerrar() {
    if (ui) { ui.panel.hidden = true; ui.burbuja.hidden = true; }
    liberar();
    Object.keys(cache).forEach(k => delete cache[k]);
  }
  const abierta = () => !!(ui && origen && (!ui.panel.hidden || !ui.burbuja.hidden));

  /* ───────────── Para la IA ───────────── */

  // b64Original: JPEG ya comprimido por la app (sin prefijo data:). Con el filtro en «original» se
  // devuelve tal cual; con realce/bn se devuelve otra versión. NUNCA reemplaza la foto de evidencia.
  async function fotoParaOcr(b64Original) {
    if (!b64Original || modo === 'original' || typeof document === 'undefined') return b64Original;
    try {
      const { img } = await cargarImagen('data:image/jpeg;base64,' + b64Original);
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, w, h);
      cx.putImageData(new ImageData(procesar(d.data, w, h, modo), w, h), 0, 0);
      const salida = c.toDataURL('image/jpeg', 0.8).split(',')[1];
      return salida || b64Original;
    } catch (_) { return b64Original; }
  }

  return {
    MODOS, procesar, fijarModo, mostrar, cerrar, minimizar, restaurar, abierta, fotoParaOcr,
    modo: () => modo,
    alCambiarModo: f => { if (typeof f === 'function') oyentes.push(f); },
  };
});
