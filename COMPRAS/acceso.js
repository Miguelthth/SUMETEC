// MISMO archivo en las 6 PWAs (2026-09-29): Cotizador, Gastos, Dirección, Compras Facturación y Logística.
// Si cambias algo aquí, cópialo a las otras 5 -- tests/acceso_alineado.test.js (Gastos) lo exige.
// Ayudas de presentación y recuerdo de una validación real del servidor.
// La huella no concede permisos en el servidor: solo conserva el acceso sin red
// a un token que este dispositivo ya confirmó mientras estaba conectado.
async function sumetecHuellaAcceso(token) {
  if (!globalThis.crypto || !crypto.subtle || !globalThis.TextEncoder) return '';
  const bytes = new TextEncoder().encode(String(token || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function sumetecAccesoValidadoAntes(token, clave) {
  if (!token) return false;
  const huella = await sumetecHuellaAcceso(token);
  return !!huella && localStorage.getItem(clave) === huella;
}

async function sumetecMarcarAccesoValidado(token, clave) {
  const huella = await sumetecHuellaAcceso(token);
  if (huella) localStorage.setItem(clave, huella);
}

function sumetecEntrando(boton, activo) {
  if (!boton) return;
  if (activo) {
    boton.dataset.textoReposo = boton.textContent;
    boton.disabled = true;
    boton.classList.add('sumetec-entrando');
    boton.textContent = 'Entrando…';
  } else {
    boton.disabled = false;
    boton.classList.remove('sumetec-entrando');
    boton.textContent = boton.dataset.textoReposo || 'Vincular';
  }
}

// B5: cada app cifra su propio token. El PIN vive sólo durante esta sesión;
// la clave se deriva igual que en Dirección/Compras (PBKDF2 + AES-GCM).
function _sumetecClaveToken(app) {
  if (!['cotizador','gastos','fact','logistica'].includes(app)) throw Error('Aplicación desconocida');
  return `sumetec_${app}_token_cifrado`;
}
async function _sumetecClavePin(pin, salt) {
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},
    material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function sumetecGuardarTokenCifrado(app,token,pin) {
  if (!crypto.subtle) throw Error('Este navegador no permite cifrar el token');
  if (!pin || pin.length<4) throw Error('El PIN debe tener al menos 4 caracteres');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await _sumetecClavePin(pin,salt);
  const c=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(token));
  localStorage.setItem(_sumetecClaveToken(app),JSON.stringify({salt:[...salt],iv:[...iv],c:[...new Uint8Array(c)]}));
}
async function sumetecAbrirTokenCifrado(app,pin) {
  const raw=localStorage.getItem(_sumetecClaveToken(app));
  if (!raw) return '';
  const r=JSON.parse(raw),key=await _sumetecClavePin(pin,new Uint8Array(r.salt));
  try {
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(r.iv)},key,new Uint8Array(r.c));
    return new TextDecoder().decode(plain);
  } catch (_) { throw Error('PIN incorrecto'); }
}
function sumetecOlvidarTokenCifrado(app) { localStorage.removeItem(_sumetecClaveToken(app)); }

// ═══ Acceso configurable desde el ERP (Ecosistema → Acceso de las apps, 2026-10-09) ═══
// El dueño decide en el ERP, con su PIN maestro: (1) a los cuántos minutos sin uso cada app vuelve a pedir el PIN
// (0 = no se bloquea por inactividad) y (2) en qué equipos NO se pide el PIN. Esa sección (ACCESO) llega con la
// configuración publicada y cada app se la pasa a sumetecAplicarAcceso().
// En un equipo autorizado el PIN de ESE equipo se guarda aquí, en localStorage, para abrir sin preguntarlo: quien
// tenga el equipo en la mano entra directo. Por eso solo se activa desde el ERP y equipo por equipo; al quitar la
// autorización, la siguiente configuración que llega borra el PIN guardado. En los demás equipos nada cambia: el
// PIN sigue viviendo solo en memoria.
const SUMETEC_CLAVE_ACCESO = 'sumetec_acceso_cfg';
const SUMETEC_APPS_ACCESO = ['cotizador', 'gastos', 'compras', 'direccion', 'logistica', 'fact'];
const _sumetecPinSesion = {};
function _sumetecAppAcceso(app) {
  if (!SUMETEC_APPS_ACCESO.includes(app)) throw Error('Aplicación desconocida');
  return app;
}
function sumetecAccesoGuardado() {
  try { const c = JSON.parse(localStorage.getItem(SUMETEC_CLAVE_ACCESO) || 'null'); return c && typeof c === 'object' ? c : null; }
  catch (_) { return null; }
}
// ¿El dueño autorizó ESTE equipo (por su ID de vinculación) a entrar sin PIN en esta app?
function sumetecEquipoSinPin(app) {
  const c = sumetecAccesoGuardado(), id = localStorage.getItem(`sumetec_${_sumetecAppAcceso(app)}_dispositivo`) || '';
  return !!(id && c && Array.isArray(c.equipos_sin_pin) && c.equipos_sin_pin.includes(id));
}
// Minutos de inactividad antes de volver a pedir el PIN; `respaldo` si el ERP no ha publicado nada. 0 = no se bloquea.
function sumetecMinutosBloqueo(app, respaldo) {
  const c = sumetecAccesoGuardado(), v = c && c.bloqueo_minutos ? c.bloqueo_minutos[_sumetecAppAcceso(app)] : undefined;
  return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : respaldo;
}
// El PIN guardado de este equipo, o '' si el equipo no está (o ya no está) autorizado. Si dejó de estarlo, se borra.
function sumetecPinGuardado(app) {
  const clave = `sumetec_sinpin_${_sumetecAppAcceso(app)}`;
  if (!sumetecEquipoSinPin(app)) { localStorage.removeItem(clave); return ''; }
  return localStorage.getItem(clave) || '';
}
// Tras un PIN correcto: se recuerda en memoria y, solo si el equipo está autorizado, también en el equipo.
function sumetecRecordarPin(app, pin) {
  if (!pin) return;
  _sumetecPinSesion[_sumetecAppAcceso(app)] = pin;
  if (sumetecEquipoSinPin(app)) localStorage.setItem(`sumetec_sinpin_${app}`, pin);
}
function sumetecOlvidarPinGuardado(app) {
  localStorage.removeItem(`sumetec_sinpin_${_sumetecAppAcceso(app)}`);
  delete _sumetecPinSesion[app];
}
// Recibe la sección ACCESO de la configuración publicada (o nada, si el servidor aún no la trae: se conserva la
// última). Devuelve { sinPin, minutos } ya resueltos para esta app en este equipo.
function sumetecAplicarAcceso(app, acceso) {
  _sumetecAppAcceso(app);
  if (acceso && typeof acceso === 'object' && !Array.isArray(acceso)) {
    localStorage.setItem(SUMETEC_CLAVE_ACCESO, JSON.stringify({
      bloqueo_minutos: (acceso.bloqueo_minutos && typeof acceso.bloqueo_minutos === 'object') ? acceso.bloqueo_minutos : {},
      equipos_sin_pin: Array.isArray(acceso.equipos_sin_pin) ? acceso.equipos_sin_pin.map(String) : [] }));
  }
  const sinPin = sumetecEquipoSinPin(app);
  if (!sinPin) localStorage.removeItem(`sumetec_sinpin_${app}`);
  else if (_sumetecPinSesion[app]) localStorage.setItem(`sumetec_sinpin_${app}`, _sumetecPinSesion[app]);
  return { sinPin, minutos: sumetecMinutosBloqueo(app, undefined) };
}
// Bloqueo por inactividad para las apps que cifran su token aquí (Cotizador, Gastos, Logística): pasado el tiempo
// que fijó el ERP sin tocar la pantalla, se pide el PIN encima de lo que haya. No recarga ni borra nada: lo que
// estaba a medio capturar sigue ahí al desbloquear. Dirección y Compras tienen su propio bloqueo (seguridad.js).
let _sumetecInactividad = null;
function sumetecVigilarInactividad(app, nombre) {
  _sumetecAppAcceso(app);
  if (_sumetecInactividad || typeof document === 'undefined') return;
  const estado = _sumetecInactividad = { ultima: Date.now(), bloqueada: false };
  const tocar = () => { if (!estado.bloqueada) estado.ultima = Date.now(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, tocar, { capture: true, passive: true }));
  estado.revisar = async () => {
    const min = sumetecMinutosBloqueo(app, 0);
    if (estado.bloqueada || !min || sumetecEquipoSinPin(app) || !localStorage.getItem(_sumetecClaveToken(app))) return false;
    if (Date.now() - estado.ultima < min * 60000) return false;
    estado.bloqueada = true;
    let mensaje = 'Se bloqueó por inactividad.';
    for (;;) {
      const pin = await sumetecPedirPinToken(nombre, false, mensaje);
      if (pin === null) { mensaje = 'Escribe tu PIN para seguir.'; continue; }
      try { await sumetecAbrirTokenCifrado(app, pin); sumetecRecordarPin(app, pin); break; }
      catch (e) { mensaje = e.message || 'PIN incorrecto'; }
    }
    estado.ultima = Date.now(); estado.bloqueada = false;
    return true;
  };
  setInterval(estado.revisar, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') estado.revisar(); });
}

let _sumetecPinPromesa = null;
// ═══ Teclado de PIN estándar v3 (2026-10, propuesta 1b «pantalla completa») ═══
// UNA sola pantalla para los 4 usos: crear (2 pasos: escribir → Continuar → confirmar), desbloquear,
// código de seguridad (Dirección, Gastos) y código de borrado (Cotizador). Largo libre de 4 a 12, con botón.
// sumetecTecladoPin(dlg, op) solo pinta y conecta el teclado dentro de un <dialog>; quien lo llama lo abre
// y lee el PRIMER <input> al cerrarse con returnValue 'ok', igual que antes. inputId/errorId/textoId
// conservan los IDs de #pin-modal y #codigo-modal. Con teclado físico: dígitos, Borrar y Enter.
// op: { modo:'crear'|'desbloquear'|'codigo', nombre, mensaje, titulo, texto, min, max, olvidar(), inputId, errorId, textoId }
const SUMETEC_ACENTO_PIN = {Cotizador:'#2aaeeb', Remisiones:'#2aaeeb', Gastos:'#f06452', 'Facturación':'#d99c2b', 'Dirección':'#8750df', Compras:'#54c99a', 'Logística':'#e5609f'};
const SUMETEC_APP_TOKEN = {Cotizador:'cotizador', Remisiones:'cotizador', Gastos:'gastos', 'Facturación':'fact', 'Logística':'logistica'};
function sumetecTecladoPin(dlg, op = {}) {
  const modo = op.modo || 'desbloquear', crear = modo === 'crear', codigo = modo === 'codigo';
  const nombre = op.nombre || 'SUMETEC', min = op.min || (codigo ? 1 : 4), max = op.max || 12;
  const quieto = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (dlg._sumetecObs) dlg._sumetecObs.disconnect();
  if (dlg._sumetecTeclas) dlg.removeEventListener('keydown', dlg._sumetecTeclas);
  dlg.style.cssText = '';
  dlg.style.setProperty('--acento', SUMETEC_ACENTO_PIN[nombre] || '#76b82a');
  dlg.style.setProperty('--pin-texto', nombre === 'Dirección' ? '#fff' : '#102335');
  dlg.classList.add('sumetec-pin-dialogo', 'sumetec-pin-teclado');
  const id = (n, v) => v ? ' ' + n + '="' + v + '"' : '';
  const campo = (i, etiqueta) => '<input type="password" maxlength="' + max + '" autocomplete="off" inputmode="none" tabindex="-1" class="sumetec-pin-oculto" aria-label="' + etiqueta + '"' + (i ? ' name="sumetec-pin-confirmar"' : id('id', op.inputId)) + '>';
  const teclas = ['1','2','3','4','5','6','7','8','9','ver','0','borrar'].map(k =>
    k === 'ver' ? '<button type="button" class="sumetec-tecla sumetec-tecla-ver" data-k="ver" aria-pressed="false">Ver</button>'
    : k === 'borrar' ? '<button type="button" class="sumetec-tecla sumetec-tecla-borrar" data-k="borrar" aria-label="Borrar">⌫</button>'
    : '<button type="button" class="sumetec-tecla" data-k="' + k + '">' + k + '</button>').join('');
  dlg.innerHTML = '<form method="dialog" class="sumetec-pin-panel">'
    + '<div class="sumetec-pin-cabecera"><span class="sumetec-pin-logo" aria-hidden="true"></span><span class="sumetec-pin-app"><strong></strong><small></small></span><button type="button" class="sumetec-pin-cerrar" aria-label="Volver">×</button></div>'
    + '<div class="sumetec-pin-cuerpo"><div class="sumetec-pin-pasos" aria-hidden="true"><i></i><i></i></div><div class="sumetec-pin-eyebrow"></div><h2></h2><p class="sumetec-pin-texto"' + id('id', op.textoId) + '></p>'
    + campo(0, codigo ? 'Código' : 'PIN') + campo(1, 'Confirmar PIN')
    + '<div class="sumetec-pin-puntos" aria-hidden="true"></div><small class="sumetec-pin-error" role="alert"' + id('id', op.errorId) + '></small></div>'
    + '<div class="sumetec-pin-teclas">' + teclas + '</div>'
    + '<button class="sumetec-pin-guardar" value="ok" type="submit"></button><button type="button" class="sumetec-pin-enlace"></button></form>'
    + '<div class="sumetec-pin-aviso" hidden><div class="sumetec-pin-aviso-icono" aria-hidden="true">?</div><h2>¿Olvidaste tu PIN?</h2>'
    + '<p>No se puede recuperar. Vincula este teléfono otra vez con un PIN nuevo. Lo pendiente de enviar no se pierde.</p>'
    + '<button type="button" class="sumetec-pin-guardar listo">Vincular de nuevo</button><button type="button" class="sumetec-pin-volver">Volver</button></div>';
  const q = s => dlg.querySelector(s);
  const form = q('form'), ins = form.querySelectorAll('input'), puntos = q('.sumetec-pin-puntos'), error = q('.sumetec-pin-error');
  const cuerpo = q('.sumetec-pin-cuerpo'), guardar = form.querySelector('.sumetec-pin-guardar'), enlace = q('.sumetec-pin-enlace'), ver = q('[data-k="ver"]'), aviso = q('.sumetec-pin-aviso');
  const enLinea = typeof navigator === 'undefined' || navigator.onLine !== false;
  q('.sumetec-pin-app strong').textContent = nombre + ' · SUMETEC';
  const conexion = q('.sumetec-pin-app small');
  conexion.textContent = enLinea ? '● En línea' : '● Sin conexión';
  if (!enLinea) conexion.style.color = '#ffce82';
  q('.sumetec-pin-pasos').hidden = !crear;
  if (!crear) q('.sumetec-pin-texto').textContent = op.texto || (codigo ? 'Escribe el código de seguridad.' : 'Desbloquea ' + nombre + ' en este teléfono.');
  let paso = 0, visible = false, libre = false;
  const animar = (el, cuadros, ms) => { if (!quieto && el && el.animate) el.animate(cuadros, { duration: ms, easing: 'ease-out' }); };
  const textos = () => {
    q('.sumetec-pin-eyebrow').textContent = crear ? 'Paso ' + (paso + 1) + ' de 2' : codigo ? 'Autorización' : nombre;
    form.querySelector('h2').textContent = crear ? (paso ? 'Confirma tu PIN' : 'Crea tu PIN') : (op.titulo || (codigo ? 'Código de seguridad' : 'Ingresa tu PIN'));
    if (crear) q('.sumetec-pin-texto').textContent = paso ? 'Escríbelo otra vez para confirmarlo.' : 'Lo usarás para abrir ' + nombre + ' en este teléfono.';
    guardar.textContent = crear ? (paso ? 'Guardar PIN' : 'Continuar') : codigo ? 'Autorizar' : 'Desbloquear';
    const marcas = q('.sumetec-pin-pasos').children;
    marcas[0].className = 'activa'; marcas[1].className = paso ? 'activa' : '';
    let t = '', nota = false;
    if (crear) { t = paso ? '← Cambiar el PIN' : 'De ' + min + ' a ' + max + ' dígitos · no se puede recuperar'; nota = !paso; }
    else if (codigo) t = libre ? 'Usar el teclado numérico' : 'Usar el teclado del teléfono';
    else if (op.olvidar) t = '¿Olvidaste tu PIN?';
    enlace.textContent = t; enlace.classList.toggle('nota', nota); enlace.disabled = nota;
    enlace.style.visibility = t ? '' : 'hidden';
  };
  const pintar = () => {
    const v = ins[paso].value, n = Math.max(4, v.length), hijos = [];
    for (let k = 0; k < n; k++) {
      const i = document.createElement('i');
      if (k < v.length) { i.className = 'lleno'; if (visible) i.textContent = v[k]; }
      hijos.push(i);
    }
    puntos.replaceChildren(...hijos);
    puntos.classList.toggle('visible', visible); puntos.classList.toggle('largo', n > 8);
    guardar.classList.toggle('listo', (libre ? v.trim().length : v.length) >= min);
  };
  const teclear = k => {
    if (libre) return;
    if (k === 'ver') {
      visible = !visible;
      ins.forEach(i => { i.type = visible ? 'text' : 'password'; });
      ver.textContent = visible ? 'Ocultar' : 'Ver'; ver.setAttribute('aria-pressed', String(visible));
      pintar(); return;
    }
    const inp = ins[paso]; error.textContent = '';
    if (k === 'borrar') inp.value = inp.value.slice(0, -1);
    else if (inp.value.length < max) inp.value += k;
    pintar();
  };
  const irPaso = p => {
    paso = p; ins[1].value = ''; if (!p) ins[0].value = '';
    error.textContent = ''; textos(); pintar();
    animar(cuerpo, [{ opacity: 0, transform: 'translateX(' + (p ? 28 : -28) + 'px)' }, { opacity: 1, transform: 'none' }], 220);
  };
  q('.sumetec-pin-teclas').addEventListener('click', e => { const b = e.target.closest('.sumetec-tecla'); if (b) teclear(b.dataset.k); });
  q('.sumetec-pin-cerrar').onclick = () => dlg.close('cancelar');
  enlace.onclick = () => {
    if (crear) { if (paso) irPaso(0); return; }
    if (codigo) {
      // Por si el código publicado lleva letras: campo normal con el teclado del teléfono.
      libre = !libre; form.classList.toggle('sumetec-pin-libre', libre);
      const c = ins[0];
      c.classList.toggle('sumetec-pin-oculto', !libre); c.classList.toggle('sumetec-pin-campo', libre);
      c.inputMode = libre ? 'text' : 'none'; c.tabIndex = libre ? 0 : -1; c.value = ''; error.textContent = '';
      textos(); pintar(); if (libre) c.focus();
      return;
    }
    if (op.olvidar) { form.hidden = true; aviso.hidden = false; aviso.querySelector('.sumetec-pin-guardar').focus(); }
  };
  aviso.querySelector('.sumetec-pin-volver').onclick = () => { aviso.hidden = true; form.hidden = false; q('.sumetec-tecla').focus(); };
  aviso.querySelector('.sumetec-pin-guardar').onclick = () => { if (op.olvidar) op.olvidar(); };
  form.addEventListener('submit', e => {
    const v = ins[paso].value;
    const parar = m => { e.preventDefault(); e.stopImmediatePropagation(); error.textContent = m; };
    if (libre) { if (!v.trim()) parar('Escribe el código'); return; }
    if (v.length < min) { parar(codigo ? 'Escribe el código' : 'El PIN debe tener al menos ' + min + ' dígitos'); return; }
    if (crear && !paso) { e.preventDefault(); e.stopImmediatePropagation(); irPaso(1); return; }
    if (crear && ins[0].value !== ins[1].value) { ins[1].value = ''; parar('Los PIN no coinciden. Escríbelo otra vez.'); }
  });
  // Cualquier aviso en el renglón de error (propio, del llamador o de app.js) repinta y sacude los puntos.
  dlg._sumetecObs = new MutationObserver(() => {
    pintar();
    if (!error.textContent) return;
    animar(libre ? ins[0] : puntos, [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], 340);
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (_) {}
  });
  dlg._sumetecObs.observe(error, { childList: true, characterData: true, subtree: true });
  dlg._sumetecTeclas = e => {
    if (libre || form.hidden) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); teclear(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); teclear('borrar'); }
    else if (e.key === 'Enter') { e.preventDefault(); guardar.click(); }
  };
  dlg.addEventListener('keydown', dlg._sumetecTeclas);
  ins[0].addEventListener('input', pintar);
  textos(); pintar();
  if (op.mensaje) error.textContent = op.mensaje;
  return dlg;
}

// Crear o desbloquear el token cifrado de cada app. Misma promesa que antes: el PIN o null.
function sumetecPedirPinToken(nombre, crear=false, mensaje='') {
  if (_sumetecPinPromesa) return _sumetecPinPromesa;
  _sumetecPinPromesa = new Promise(resolve=>{
    const dlg=document.createElement('dialog'), app=SUMETEC_APP_TOKEN[nombre];
    // «¿Olvidaste tu PIN?»: borra SOLO el token cifrado (las colas pendientes se conservan) y recarga en Vincular.
    const olvidar=!crear&&app?()=>{ sumetecOlvidarTokenCifrado(app); dlg.close('cancelar'); location.reload(); }:null;
    sumetecTecladoPin(dlg,{modo:crear?'crear':'desbloquear',nombre,mensaje,olvidar});
    dlg.addEventListener('close',()=>{
      const ins=dlg.querySelectorAll('input');
      const pin=dlg.returnValue==='ok'?ins[0].value:null;
      ins.forEach(input=>{input.value='';});
      dlg.remove(); _sumetecPinPromesa=null; resolve(pin);
    },{once:true});
    document.body.appendChild(dlg); dlg.showModal(); dlg.querySelector('.sumetec-tecla').focus();
  });
  return _sumetecPinPromesa;
}

async function sumetecRestaurarTokenApp(app,nombre,claveLegada) {
  const cifrado=localStorage.getItem(_sumetecClaveToken(app));
  if (cifrado) {
    // Equipo autorizado desde el ERP: se abre con el PIN guardado, sin preguntar. Si ya no sirve, se pregunta.
    const guardado=sumetecPinGuardado(app);
    if (guardado) {
      try { const t=await sumetecAbrirTokenCifrado(app,guardado); _sumetecPinSesion[app]=guardado; return t; }
      catch (_) { sumetecOlvidarPinGuardado(app); }
    }
    let mensaje='';
    for (let intento=0;intento<3;intento++) {
      const pin=await sumetecPedirPinToken(nombre,false,mensaje);
      if (pin===null) return '';
      try { const t=await sumetecAbrirTokenCifrado(app,pin); sumetecRecordarPin(app,pin); return t; }
      catch (e) { const quedan=2-intento; mensaje=(e.message||'PIN incorrecto')+(quedan>0?' · te quedan '+quedan+' intento'+(quedan===1?'':'s'):''); }
    }
    return '';
  }
  const legado=(localStorage.getItem(claveLegada)||'').trim();
  if (!legado) return '';
  const pin=await sumetecPedirPinToken(nombre,true);
  if (pin===null) return '';
  await sumetecGuardarTokenCifrado(app,legado,pin);
  sumetecRecordarPin(app,pin);
  localStorage.removeItem(claveLegada);
  return legado;
}

function sumetecAbrirAyuda(id, cerrar=false) {
  const ayuda=document.getElementById(id);
  const control=document.querySelector(`[aria-controls="${id}"]`);
  if (!ayuda) return;
  ayuda.open=cerrar?false:!ayuda.open;
  control?.setAttribute('aria-expanded',String(ayuda.open));
  if (ayuda.open) ayuda.querySelector('[aria-label="Cerrar ayuda"]')?.focus();
  else control?.focus();
}
if(typeof document!=='undefined') document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  const ayuda=document.querySelector('.sumetec-acceso-ayuda[open]');
  if(ayuda){e.preventDefault();e.stopPropagation();sumetecAbrirAyuda(ayuda.id,true);}
},true);

let _sumetecObservadorFondo = null;
function sumetecBloquearFondo(gate, bloquear) {
  if (!gate) return;
  if (_sumetecObservadorFondo) {
    _sumetecObservadorFondo.disconnect();
    _sumetecObservadorFondo = null;
  }
  if (bloquear) {
    const proteger = () => {
      for (const elemento of document.body.children) {
        if (elemento !== gate && !['sumetecCargaAcceso','sumetecAccesoBloqueado','sumetecActualizacion'].includes(elemento.id) && elemento.tagName !== 'SCRIPT' && elemento.tagName !== 'DIALOG') {
          if (!elemento.inert) elemento.dataset.sumetecInert = '';
          elemento.inert = true;
        }
      }
    };
    proteger();
    _sumetecObservadorFondo = new MutationObserver(proteger);
    _sumetecObservadorFondo.observe(document.body, { childList: true });
  } else {
    for (const elemento of document.querySelectorAll('[data-sumetec-inert]')) {
      elemento.inert = false;
      delete elemento.dataset.sumetecInert;
    }
  }
  gate.inert = false;
}

function sumetecActualizarEstadoConexion() {
  if (typeof navigator === 'undefined') return;
  document.querySelectorAll('.sumetec-acceso-marca small').forEach(el => {
    el.textContent = navigator.onLine ? '● En línea' : '● Sin conexión';
    el.style.color = navigator.onLine ? '#8ee6bd' : '#ffce82';
  });
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sumetecActualizarEstadoConexion);
  else sumetecActualizarEstadoConexion();
  window.addEventListener('online', sumetecActualizarEstadoConexion);
  window.addEventListener('offline', sumetecActualizarEstadoConexion);
}


// Pantallas comunes de espera y bloqueo; el token permanece cifrado en cada app.
function sumetecMostrarCargaAcceso(mostrar) {
  let capa = document.getElementById('sumetecCargaAcceso');
  if (!capa) {
    capa = document.createElement('div');
    capa.id = 'sumetecCargaAcceso';
    capa.className = 'sumetec-acceso-espera';
    capa.setAttribute('role', 'status');
    capa.setAttribute('aria-live', 'polite');
    capa.innerHTML = '<div class="sumetec-acceso-espera-icono" aria-hidden="true">⚙</div><strong>Verificando acceso…</strong><p>Espera un momento.</p>';
    document.body.appendChild(capa);
  }
  capa.hidden = !mostrar;
}
function sumetecMostrarAccesoBloqueado(reintentar, mensaje = 'Ingresa tu PIN para continuar.') {
  let capa = document.getElementById('sumetecAccesoBloqueado');
  if (!capa) {
    capa = document.createElement('div');
    capa.id = 'sumetecAccesoBloqueado';
    capa.className = 'sumetec-acceso-espera';
    capa.innerHTML = '<div class="sumetec-acceso-espera-icono" aria-hidden="true">🔒</div><strong>Acceso bloqueado</strong><p>Ingresa tu PIN para continuar.</p><button type="button">Desbloquear</button>';
    document.body.appendChild(capa);
  }
  capa.querySelector('p').textContent = mensaje;
  capa.querySelector('button').textContent = mensaje.startsWith('Ingresa') ? 'Desbloquear' : 'Reintentar';
  capa.querySelector('button').onclick = () => { capa.hidden = true; reintentar(); };
  capa.hidden = false;
  capa.querySelector('button').focus();
}

// ── Reintentos con criterio (2026-09-29, incidente REM-0020: un cobro se reintentó 58 veces idéntico) ──
// Regla común de las 5 apps: un pendiente que el SERVIDOR contestó con error se reintenta unas cuantas
// veces; si sigue igual, se DETIENE con su motivo a la vista (no gasta cuota de Apps Script ni bloquea a
// los demás). Sin señal, tiempo agotado, servidor ocupado o token vencido NO cuentan: eso se arregla esperando.
const SUMETEC_MAX_FALLOS_SERVIDOR = 6;
const SUMETEC_TIEMPO_ENVIO_MS = 120000;

// fetch con tope de tiempo: una petición colgada ya no detiene para siempre la fila de envíos.
// Si vence, lanza AbortError (las apps ya lo tratan como «sin respuesta» y reintentan luego).
function sumetecFetchLimite(url, opciones, ms) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), ms || SUMETEC_TIEMPO_ENVIO_MS) : null;
  const limpiar = () => { if (t) clearTimeout(t); };
  const p = fetch(url, ctrl ? Object.assign({}, opciones || {}, { signal: ctrl.signal }) : opciones);
  // El límite cubre también la LECTURA del cuerpo (json/text): si la respuesta llega con encabezados pero se corta
  // a la mitad, antes la lectura esperaba para siempre y dejaba trabada la cola (auditoría D01, 2026-09-29).
  return p.then(r => {
    ['json', 'text'].forEach(m => {
      if (r && typeof r[m] === 'function') { const f = r[m].bind(r); r[m] = () => f().finally(limpiar); }
    });
    return r;
  }, e => { limpiar(); throw e; });
}

// D-02 (revisión de conexiones 2026-10-01): separa «no hay red» de «Google contestó algo que no es JSON».
// Antes `.then(x => x.json())` dentro de un `try { … } catch (_) { break; }` trataba igual los dos casos:
// una página de error de Google detenía TODA la cola sin contarse como fallo. Ahora:
//   · sin red / tiempo agotado  -> { sinRed: true }  (el envío se detiene y se reintenta luego, como siempre);
//   · respuesta que no es JSON  -> { r: { ok:false, error } }  (fallo PASAJERO de ESA captura: no cuenta para el
//                                  tope de 6 -- una página de error de Google en una caída no debe detener la
//                                  cola para siempre, igual que en Gastos -- y el envío sigue con la siguiente).
async function sumetecPostJsonSeguro(url, opciones) {
  let resp;
  try { resp = await sumetecFetchLimite(url, opciones); } catch (_) { return { sinRed: true }; }
  try { return { r: await resp.json() }; }
  catch (_) { return { r: { ok: false, error: 'respuesta ilegible del servidor (HTTP ' + (resp && resp.status) + '); temporal, se reintenta' } }; }
}

// D-03: una lista que el servidor devuelve VACÍA (o que pierde más de la mitad) no reemplaza a la copia buena
// del teléfono: un archivo en blanco en Drive dejaba a la app sin productos/proveedores sin avisar.
// Devuelve la lista que se debe guardar (la nueva, o la previa si la nueva es sospechosa).
function sumetecListaSegura(nueva, previa) {
  if (!Array.isArray(nueva)) return previa;
  const n = Array.isArray(previa) ? previa.length : 0;
  if (n > 0 && (nueva.length === 0 || (n >= 10 && nueva.length < n / 2))) return previa;
  return nueva;
}

// ¿La respuesta es un fallo que se arregla esperando o reconectando? (no cuenta para el tope)
function sumetecFalloTransitorio(r) {
  const t = String((r && (r.error || r.mensaje || r.estado)) || '');
  return /ocupado|reintenta|intenta de nuevo|tiempo|timeout|cuota|quota|too many|limit exceeded|temporal|no autorizado|token/i.test(t);
}

// Texto corto y legible de por qué falló, tomado de lo que contestó el servidor.
function sumetecMotivoRespuesta(r, respaldo) {
  const m = r && (r.motivo || r.cajaMotivo || r.pdfMotivo || r.mensaje || r.error || r.estado);
  // D-08: un teléfono revocado o con token vencido seguía reintentando sin decirle nada al usuario.
  if (/no autorizado|token inv|token venc|token incorrecto/i.test(String(m || ''))) {
    return 'Este teléfono ya no está autorizado: vuelve a vincularlo (Código de vinculación)';
  }
  return String(m || respaldo || 'el servidor no dio detalle').slice(0, 200);
}

// Anota un fallo en un pendiente (guarda el motivo y cuenta los que sí contestó el servidor).
// Devuelve true cuando llegó al tope y el pendiente debe DETENERSE (su motivo queda a la vista).
function sumetecAnotarFallo(item, motivo, servidor) {
  item._try = (item._try || 0) + 1;
  if (motivo) item._lastError = String(motivo).slice(0, 200);
  if (!servidor) return false;
  item._srv = (item._srv || 0) + 1;
  return item._srv >= SUMETEC_MAX_FALLOS_SERVIDOR;
}
