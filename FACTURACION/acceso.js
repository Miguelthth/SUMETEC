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
  if (!/^[0-9]{6}$/.test(String(pin || ''))) throw Error('El PIN debe ser de 6 dígitos');
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
  _sumetecHuellaTrasPin(app, pin);
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
      equipos_sin_pin: Array.isArray(acceso.equipos_sin_pin) ? acceso.equipos_sin_pin.map(String) : [],
      permisos: (acceso.permisos && typeof acceso.permisos === 'object' && !Array.isArray(acceso.permisos)) ? acceso.permisos : {},
      aprobadores: Array.isArray(acceso.aprobadores) ? acceso.aprobadores.map(String) : [],
      saltar_hasta: (acceso.saltar_hasta && typeof acceso.saltar_hasta === 'object' && !Array.isArray(acceso.saltar_hasta)) ? acceso.saltar_hasta : {},
      hash_codigo: typeof acceso.hash_codigo === 'string' ? acceso.hash_codigo : '' }));
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
      catch (e) { sumetecHuellaPinFallo(app, pin); mensaje = e.message || 'PIN incorrecto'; }
    }
    estado.ultima = Date.now(); estado.bloqueada = false;
    return true;
  };
  setInterval(estado.revisar, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') estado.revisar(); });
}

// ═══ Permisos por acción (Ecosistema → pestaña de cada app → Permisos, 2026-10-14) ═══
// El dueño decide en el ERP, con su PIN maestro, si cada acción delicada pide su permiso ('codigo': el nombre se
// conservó para no romper configuraciones guardadas; desde el 2026-10-20 significa «permiso del dueño con su huella»),
// pasa sin pedirlo ('libre') o no se permite en esta app ('bloqueado'). Llega dentro de ACCESO. Sin dato publicado,
// cada llamada usa `porDefecto`: lo que la app hacía antes.
const SUMETEC_MODOS_PERMISO = ['codigo', 'libre', 'bloqueado'];
function sumetecPermiso(app, accion, porDefecto) {
  const c = sumetecAccesoGuardado(), clave = _sumetecAppAcceso(app), p = c && c.permisos ? c.permisos[clave] : null;
  // «Saltar en pruebas» (ERP → Ecosistema → Permisos, 2026-10-21): mientras no llegue la hora en que vence (la fija el
  // ERP a 24 h), la acción se comporta como 'libre' sin perder el modo guardado. El reloj de este teléfono decide cuándo
  // vence, así que se apaga sola aunque no se vuelva a sincronizar.
  const hasta = c && c.saltar_hasta && typeof c.saltar_hasta === 'object' && c.saltar_hasta[clave] ? c.saltar_hasta[clave][accion] : 0;
  if (typeof hasta === 'number' && hasta > Date.now()) return 'libre';
  const v = p && typeof p === 'object' ? p[accion] : undefined;
  return SUMETEC_MODOS_PERMISO.includes(v) ? v : porDefecto;
}
function sumetecHashCodigoPublicado() {
  const c = sumetecAccesoGuardado();
  return (c && typeof c.hash_codigo === 'string') ? c.hash_codigo : '';
}
// Pide el código de seguridad con el mismo teclado de las apps y lo compara con la huella publicada.
// `hash` opcional: la app que ya tenía su propia copia de la huella la pasa. Devuelve true si es correcto.
function sumetecPedirCodigoAccion(nombre, texto, hash) {
  const h = hash || sumetecHashCodigoPublicado();
  if (!h) { if (typeof alert === 'function') alert('Aún no hay código de seguridad en este teléfono: en el ERP entra a Administración → Ecosistema y sincroniza; luego abre la app con señal.'); return Promise.resolve(false); }
  return _sumetecPopupCodigo_({ titulo: 'Código de seguridad', texto: texto || 'Escribe el código de seguridad.', largo: 0,
    validar: async v => (await sumetecHuellaAcceso('sumetec-campo|' + v.trim())) === h ? { ok: true } : { ok: false, error: 'Código incorrecto, intenta de nuevo.' } }).then(r => r !== null);
}
// Punto único para las acciones delicadas: true si puede seguir.
// 2026-10-20: el modo 'codigo' ya no pide teclear un código (se adivinaba desde su huella pública, F2-COD-R): pide
// PERMISO AL DUEÑO, que lo aprueba desde su teléfono con su huella o Face ID (sumetecPedirPermisoDueno).
// op: { nombre, documento, detalle, avisar(m), respaldo() } — `documento` = qué se toca (el permiso vale solo para
// eso); `respaldo` = cómo confirma el propio dueño en un teléfono sin huella (su PIN).
async function sumetecAutorizarAccion(app, accion, porDefecto, op = {}) {
  const modo = sumetecPermiso(app, accion, porDefecto);
  if (modo === 'libre') return true;
  if (modo === 'bloqueado') {
    const m = 'Esta acción no está permitida en esta app (se cambia en el ERP: Ecosistema → ' + (op.nombre || app) + ' → Permisos).';
    if (typeof op.avisar === 'function') op.avisar(m); else if (typeof alert === 'function') alert(m);
    return false;
  }
  return sumetecPedirPermisoDueno(Object.assign({}, op, { app, accion }));
}

// ═══ Huella o Face ID (2026-10-20) ═══
// Lo que use el teléfono para desbloquearse (huella, cara o el patrón del propio teléfono), vía WebAuthn con
// «verificación del usuario» obligatoria. Sirve para dos cosas:
//  1) ABRIR la app sin teclear el PIN: tras un PIN correcto se ofrece una vez activarla; el PIN queda cifrado con una
//     llave que el navegador guarda sin dejarla copiar (IndexedDB, no extraíble), y solo se usa después de que el
//     sensor reconoce a la persona. El PIN sigue sirviendo siempre (respaldo).
//  2) CONFIRMAR que es el dueño quien aprueba un permiso desde SU teléfono (Dirección).
// Lo que NO hace: el servidor no puede comprobar la huella (Apps Script no verifica esas firmas). La huella prueba que
// quien tiene el teléfono en la mano es su dueño; el servidor confía en el teléfono APROBADOR vinculado.
const SUMETEC_APP_NOMBRE = {Cotizador:'cotizador', Remisiones:'cotizador', Gastos:'gastos', 'Facturación':'fact', 'Logística':'logistica', 'Dirección':'direccion', Compras:'compras'};
let _sumetecPinDeHuella = null, _sumetecHuellaOfrecida = {};
const _sumetecB64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const _sumetecDeB64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
function _sumetecEsApple() {
  return typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
}
function _sumetecClaveHuella(app) { return `sumetec_huella_${_sumetecAppAcceso(app)}`; }
function _sumetecRegistroHuella(app) {
  try { const r = JSON.parse(localStorage.getItem(_sumetecClaveHuella(app)) || 'null'); return r && r.id ? r : null; } catch (_) { return null; }
}
function sumetecHuellaActiva(app) { return !!_sumetecRegistroHuella(app); }
// ¿El teléfono tiene sensor y la app corre donde el navegador lo deja usar? (Facturación dentro de Google: no.)
async function sumetecHuellaPosible() {
  try {
    if (typeof window === 'undefined' || !window.isSecureContext || window.top !== window.self) return false;
    if (!window.PublicKeyCredential || !navigator.credentials || !globalThis.indexedDB || !crypto.subtle) return false;
    return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (_) { return false; }
}
function _sumetecIdb(modo, hacer) {
  return new Promise((ok, mal) => {
    const abrir = indexedDB.open('sumetec-huella', 1);
    abrir.onupgradeneeded = () => abrir.result.createObjectStore('llaves');
    abrir.onerror = () => mal(abrir.error);
    abrir.onsuccess = () => {
      const db = abrir.result, tx = db.transaction('llaves', modo), req = hacer(tx.objectStore('llaves'));
      tx.oncomplete = () => { db.close(); ok(req ? req.result : undefined); };
      tx.onerror = tx.onabort = () => { db.close(); mal(tx.error); };
    };
  });
}
// Pide al sensor que reconozca a la persona. true solo si el teléfono confirma que la verificó (bandera UV).
async function _sumetecSensor(registro) {
  try {
    const cred = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), timeout: 60000, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: _sumetecDeB64(registro.id), transports: ['internal', 'hybrid'] }] } });
    const datos = cred && cred.response && cred.response.authenticatorData ? new Uint8Array(cred.response.authenticatorData) : null;
    return !!(datos && datos.length > 32 && (datos[32] & 0x04));
  } catch (_) { return false; }
}
async function _sumetecEnvolverPin(app, pin) {
  const llave = await _sumetecIdb('readonly', st => st.get(app));
  if (!llave) throw Error('sin llave');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, llave, new TextEncoder().encode(pin));
  return { iv: _sumetecB64(iv), c: _sumetecB64(c) };
}
// Activa la huella para esta app con el PIN que se acaba de comprobar. Llamar desde un toque (iPhone lo exige).
async function sumetecActivarHuella(app, nombre, pin) {
  _sumetecAppAcceso(app);
  if (!pin || !(await sumetecHuellaPosible())) return false;
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'SUMETEC' }, challenge: crypto.getRandomValues(new Uint8Array(32)), timeout: 60000,
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'sumetec-' + app, displayName: (nombre || app) + ' · SUMETEC' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none' } });
    if (!cred) return false;
    const llave = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await _sumetecIdb('readwrite', st => st.put(llave, app));
    const sobre = await _sumetecEnvolverPin(app, pin);
    localStorage.setItem(_sumetecClaveHuella(app), JSON.stringify({ id: _sumetecB64(cred.rawId), iv: sobre.iv, c: sobre.c, desde: Date.now() }));
    localStorage.removeItem(_sumetecClaveHuella(app) + '_no');
    return true;
  } catch (_) { return false; }
}
function sumetecOlvidarHuella(app) {
  localStorage.removeItem(_sumetecClaveHuella(app));
  try { _sumetecIdb('readwrite', st => st.delete(app)).catch(() => {}); } catch (_) {}
}
// Sensor → PIN guardado de esta app, o null (canceló, no la reconoció, o ya no hay registro).
async function sumetecPinConHuella(app) {
  const reg = _sumetecRegistroHuella(app);
  if (!reg || !(await _sumetecSensor(reg))) return null;
  try {
    const llave = await _sumetecIdb('readonly', st => st.get(app));
    if (!llave) { sumetecOlvidarHuella(app); return null; }
    const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _sumetecDeB64(reg.iv) }, llave, _sumetecDeB64(reg.c));
    return (_sumetecPinDeHuella = new TextDecoder().decode(plano));
  } catch (_) { sumetecOlvidarHuella(app); return null; }
}
// El PIN que dio la huella ya no abre (se cambió al volver a vincular): se apaga y se vuelve a ofrecer con el nuevo.
function sumetecHuellaPinFallo(app, pin) {
  if (pin && pin === _sumetecPinDeHuella) { _sumetecPinDeHuella = null; sumetecOlvidarHuella(app); }
}
// Confirmar con el sensor (sin sacar el PIN). Sin huella activa: `respaldo()` (el PIN de la app) si se da.
async function sumetecConfirmarConHuella(app, respaldo) {
  const reg = _sumetecRegistroHuella(app);
  if (reg && await _sumetecSensor(reg)) return true;
  return typeof respaldo === 'function' ? !!(await respaldo()) : false;
}
// Tras un PIN correcto: si la huella ya está, se actualiza el PIN guardado; si no, se ofrece una vez por sesión.
function _sumetecHuellaTrasPin(app, pin) {
  if (sumetecHuellaActiva(app)) {
    _sumetecEnvolverPin(app, pin).then(s => {
      const reg = _sumetecRegistroHuella(app);
      if (reg) localStorage.setItem(_sumetecClaveHuella(app), JSON.stringify(Object.assign(reg, s)));
    }).catch(() => {});
    return;
  }
  if (_sumetecHuellaOfrecida[app] || localStorage.getItem(_sumetecClaveHuella(app) + '_no') || typeof document === 'undefined') return;
  _sumetecHuellaOfrecida[app] = true;
  sumetecHuellaPosible().then(si => { if (si) setTimeout(() => sumetecOfrecerHuella(app, pin), 400); });
}
function sumetecOfrecerHuella(app, pin) {
  const nombre = Object.keys(SUMETEC_APP_NOMBRE).find(n => SUMETEC_APP_NOMBRE[n] === app && n !== 'Remisiones') || app;
  const dlg = _sumetecDialogoSimple('◉', '¿Abrir ' + nombre + ' con tu huella o Face ID?',
    'La próxima vez entras sin escribir el PIN: solo pones el dedo o la cara. El PIN sigue sirviendo por si acaso.',
    [['si', 'Sí, usar huella o Face ID'], ['no', 'Ahora no']]);
  const si = dlg.querySelector('[data-r="si"]');
  si.onclick = async () => {   // el toque abre el sensor (iPhone lo exige)
    si.disabled = true;
    const ok = await sumetecActivarHuella(app, nombre, pin);
    dlg.close(ok ? 'listo' : 'fallo');
    if (!ok && typeof alert === 'function') alert('No se pudo activar la huella en este teléfono. Puedes seguir con tu PIN.');
  };
  dlg.querySelector('[data-r="no"]').onclick = () => { localStorage.setItem(_sumetecClaveHuella(app) + '_no', '1'); dlg.close('no'); };
}
function _sumetecDialogoSimple(icono, titulo, texto, botones) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sumetec-permiso';
  dlg.innerHTML = '<div class="sumetec-permiso-icono" aria-hidden="true"></div><h2></h2><p class="sumetec-permiso-texto"></p><p class="sumetec-permiso-estado" role="status"></p><div class="sumetec-permiso-botones"></div>';
  dlg.querySelector('.sumetec-permiso-icono').textContent = icono;
  dlg.querySelector('h2').textContent = titulo;
  dlg.querySelector('.sumetec-permiso-texto').textContent = texto;
  const caja = dlg.querySelector('.sumetec-permiso-botones');
  botones.forEach(([r, t], i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.r = r; b.textContent = t; b.className = i ? 'secundario' : 'principal';
    caja.appendChild(b);
  });
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0), { once: true });
  document.body.appendChild(dlg); dlg.showModal();
  return dlg;
}

// ═══ Permiso del dueño (2026-10-20) ═══
// Una acción delicada (modo 'codigo' en Ecosistema) ya no se desbloquea con un código: el teléfono pide permiso y el
// dueño lo aprueba desde SU teléfono (Dirección → Permisos) con su huella o Face ID. El permiso vale para ESA acción
// y ESE documento durante 24 h. Las acciones que revisa el servidor (cancelar/eliminar remisión) las vuelve a revisar
// allá: aunque alguien se brinque esta pantalla, sin permiso aprobado no pasan.
// Cada app dice a qué servidor y con qué token pedirlo: sumetecRegistrarServidor('cotizador', () => ({url, token}))
// (la función puede ser async: Dirección y Compras sacan el token con su PIN o huella).
const _sumetecServidores = {};
function sumetecRegistrarServidor(app, obtener) { _sumetecServidores[_sumetecAppAcceso(app)] = obtener; }
async function _sumetecPostPermiso(app, cuerpo, silencioso = false) {
  // Facturación habla con el servidor fiscal, que no guarda permisos: ahí no se registra y se avisa.
  if (!_sumetecServidores[app]) return { ok: false, error: 'Esta app no puede pedir permiso al dueño: hazlo desde el ERP o pide que esta acción quede «Sin permiso» (Ecosistema → Permisos).' };
  let s = null;
  try { s = await _sumetecServidores[app](silencioso); } catch (_) { s = null; }
  if (!s || !s.url || !s.token) return { ok: false, error: 'Este teléfono aún no está vinculado al servidor (o canceló el PIN).' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { sinRed: true };
  const x = await sumetecPostJsonSeguro(s.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(Object.assign({ token: s.token }, cuerpo)) });
  return x.sinRed ? { sinRed: true } : (x.r || { ok: false });
}
// ¿Este teléfono es del dueño? Lo marca el ERP (ACCESO.aprobadores); sin lista publicada, solo Dirección.
function sumetecSoyAprobador(app) {
  const c = sumetecAccesoGuardado(), lista = c && Array.isArray(c.aprobadores) ? c.aprobadores : [];
  const id = localStorage.getItem(`sumetec_${_sumetecAppAcceso(app)}_dispositivo`) || '';
  return lista.length ? (!!id && lista.includes(id)) : app === 'direccion';
}
function _sumetecDocumentoPermiso(app, op) {
  if (op.documento) return String(op.documento).slice(0, 120);
  // Sin documento concreto: el permiso vale para este teléfono y este día.
  const id = localStorage.getItem(`sumetec_${app}_dispositivo`) || 'equipo';
  return ('dia-' + new Date().toISOString().slice(0, 10) + '-' + id).slice(0, 120);
}
async function sumetecPedirPermisoDueno(op = {}) {
  const app = _sumetecAppAcceso(op.app), nombre = op.nombre || 'SUMETEC';
  const avisar = m => { if (typeof op.avisar === 'function') op.avisar(m); else if (typeof alert === 'function') alert(m); };
  const base = { app, accion: String(op.accion || ''), documento: _sumetecDocumentoPermiso(app, op), detalle: String(op.detalle || '').slice(0, 300) };
  // En el teléfono del dueño, su propia huella (o su PIN) basta. 2026-10-21: como el servidor de Google también revisa
  // estas acciones, el permiso queda registrado ahí a su nombre (si hay señal) para que no tenga que aprobarse a sí mismo
  // en Dirección → Permisos. Sin señal pasa igual en el teléfono; el servidor lo revisará cuando se envíe.
  if (sumetecSoyAprobador(app)) {
    const ok = await sumetecConfirmarConHuella(app, op.respaldo);
    if (ok) {
      let hecho = false;
      try { hecho = await _sumetecAprobarPropio(app, base); } catch (_) {}
      if (!hecho) _sumetecPropiasGuardar(_sumetecPropiasLeer().concat([{ app, base }]));   // sin señal: se registra al volver
    }
    return ok;
  }
  const r = await _sumetecPostPermiso(app, Object.assign({ tipo: 'solicitar_aprobacion' }, base));
  if (r.sinRed) { avisar('Se necesita señal para pedir permiso al dueño. Intenta cuando haya internet.'); return false; }
  if (!r.ok || !r.aprobacion) { avisar(r.error || 'No se pudo pedir el permiso al dueño.'); return false; }
  if (r.aprobacion.estado === 'APROBADA') return true;
  return _sumetecEsperarPermiso(app, base, r.aprobacion, nombre);
}
// Devuelve true si la aprobación del dueño quedó registrada en el servidor (o ya lo estaba); false si no hubo señal o falló.
async function _sumetecAprobarPropio(app, base) {
  let r = await _sumetecPostPermiso(app, Object.assign({ tipo: 'solicitar_aprobacion' }, base));
  if (r && r.ok && r.aprobacion && (r.aprobacion.estado === 'RECHAZADA' || r.aprobacion.estado === 'VENCIDA')) {
    r = await _sumetecPostPermiso(app, Object.assign({ tipo: 'solicitar_aprobacion', nueva: true }, base));
  }
  if (!r || r.sinRed || !r.ok || !r.aprobacion) return false;
  if (r.aprobacion.estado === 'APROBADA') return true;
  if (r.aprobacion.estado !== 'PENDIENTE') return false;
  const x = await _sumetecPostPermiso(app, { tipo: 'resolver_aprobacion', id: r.aprobacion.id, decision: 'APROBADA' });
  return !!(x && x.ok);
}
// Aprobaciones propias del dueño que no se pudieron registrar por falta de señal: se reintentan solas.
const SUMETEC_CLAVE_APROB_PROPIAS = 'sumetec_aprobaciones_propias_pendientes';
function _sumetecPropiasLeer() {
  try { const v = JSON.parse(localStorage.getItem(SUMETEC_CLAVE_APROB_PROPIAS) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}
function _sumetecPropiasGuardar(lista) {
  try { localStorage.setItem(SUMETEC_CLAVE_APROB_PROPIAS, JSON.stringify(lista.slice(-50))); } catch (_) {}
}
let _sumetecPropiasVaciando = false;
async function sumetecVaciarAprobacionesPropias() {
  if (_sumetecPropiasVaciando) return;
  const lista = _sumetecPropiasLeer();
  if (!lista.length) return;
  _sumetecPropiasVaciando = true;
  try {
    const quedan = [];
    for (const it of lista) {
      let hecho = false;
      try { hecho = await _sumetecAprobarPropio(it.app, it.base); } catch (_) {}
      if (!hecho) quedan.push(it);
    }
    _sumetecPropiasGuardar(quedan);
  } finally { _sumetecPropiasVaciando = false; }
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => { sumetecVaciarAprobacionesPropias(); });
  setInterval(() => { sumetecVaciarAprobacionesPropias(); }, 15000);
}
const _SUMETEC_TEXTO_ACCION = a => String(a || '').replace(/_/g, ' ');
function _sumetecEsperarPermiso(app, base, aprobacion, nombre) {
  return new Promise(resolve => {
    const dlg = _sumetecDialogoSimple('🔐', 'Esperando permiso del dueño',
      'Se le avisó para que autorice «' + _SUMETEC_TEXTO_ACCION(base.accion) + '»' + (base.detalle ? ' (' + base.detalle + ')' : '') +
      '. Lo aprueba desde su teléfono con su huella. Puedes esperar aquí o cerrar: si lo aprueba después, vuelve a intentarlo y pasará directo.',
      [['otra', 'Pedir otra vez'], ['cerrar', 'Cerrar']]);
    const estado = dlg.querySelector('.sumetec-permiso-estado'), otra = dlg.querySelector('[data-r="otra"]');
    let actual = aprobacion, terminado = false, reloj = null;
    const pintar = () => {
      const e = actual && actual.estado;
      estado.textContent = e === 'RECHAZADA' ? '✖ El dueño no lo autorizó.' : e === 'VENCIDA' ? 'El permiso anterior venció; pide otro.' : '⏳ Esperando… (se revisa solo cada pocos segundos)';
      estado.dataset.estado = e || '';
      otra.hidden = !(e === 'RECHAZADA' || e === 'VENCIDA');
    };
    const fin = ok => { if (terminado) return; terminado = true; clearInterval(reloj); if (dlg.open) dlg.close(ok ? 'ok' : 'no'); resolve(ok); };
    const revisar = async () => {
      if (terminado || (typeof document !== 'undefined' && document.hidden)) return;
      const r = await _sumetecPostPermiso(app, Object.assign({ tipo: 'estado_aprobacion' }, base));
      if (terminado || !r || !r.ok) return;
      actual = r.aprobacion || actual;
      if (actual && actual.estado === 'APROBADA') { fin(true); return; }
      pintar();
    };
    otra.onclick = async () => {
      otra.disabled = true;
      const r = await _sumetecPostPermiso(app, Object.assign({ tipo: 'solicitar_aprobacion', nueva: true }, base));
      otra.disabled = false;
      if (r && r.ok && r.aprobacion) { actual = r.aprobacion; if (actual.estado === 'APROBADA') { fin(true); return; } }
      pintar();
    };
    dlg.querySelector('[data-r="cerrar"]').onclick = () => fin(false);
    dlg.addEventListener('cancel', () => fin(false));
    pintar();
    reloj = setInterval(revisar, 4000);
  });
}

// ═══ Lado del dueño: lista y decisión (lo usa Dirección → Permisos) ═══
async function sumetecPermisosPendientes(app) {
  return _sumetecPostPermiso(app, { tipo: 'aprobaciones_pendientes' });
}
// Confirma con la huella (o el PIN de respaldo) y manda la decisión. Devuelve la respuesta del servidor.
async function sumetecResolverPermiso(app, id, aprobar, respaldo) {
  if (aprobar && !(await sumetecConfirmarConHuella(app, respaldo))) return { ok: false, cancelado: true, error: 'No se confirmó con la huella.' };
  return _sumetecPostPermiso(app, { tipo: 'resolver_aprobacion', id, decision: aprobar ? 'APROBADA' : 'RECHAZADA' });
}

let _sumetecPinPromesa = null;
// ═══ Teclado de PIN estándar v3 (2026-10, propuesta 1b «pantalla completa») ═══
// UNA sola pantalla para los 4 usos: crear (2 pasos: escribir → Continuar → confirmar), desbloquear,
// código de seguridad (Dirección, Gastos) y código de borrado (Cotizador). PIN de 6 dígitos fijos (el modo 'codigo' tiene su propio largo).
// sumetecTecladoPin(dlg, op) solo pinta y conecta el teclado dentro de un <dialog>; quien lo llama lo abre
// y lee el PRIMER <input> al cerrarse con returnValue 'ok', igual que antes. inputId/errorId/textoId
// conservan los IDs de #pin-modal y #codigo-modal. Con teclado físico: dígitos, Borrar y Enter.
// op: { modo:'crear'|'desbloquear'|'codigo', nombre, mensaje, titulo, texto, min, max, olvidar(), inputId, errorId, textoId }
const SUMETEC_ACENTO_PIN = {Cotizador:'#2aaeeb', Remisiones:'#2aaeeb', Gastos:'#f06452', 'Facturación':'#d99c2b', 'Dirección':'#8750df', Compras:'#54c99a', 'Logística':'#e5609f'};
const SUMETEC_APP_TOKEN = {Cotizador:'cotizador', Remisiones:'cotizador', Gastos:'gastos', 'Facturación':'fact', 'Logística':'logistica'};
// PIN de las apps: SIEMPRE 6 dígitos (2026-11-16, pedido de Miguel); sin selector de longitud. El modo 'codigo' conserva su largo propio.
const SUMETEC_PIN_LARGO = 6;
function sumetecTecladoPin(dlg, op = {}) {
  const modo = op.modo || 'desbloquear', crear = modo === 'crear', codigo = modo === 'codigo';
  const nombre = op.nombre || 'SUMETEC', min = op.min || (codigo ? 1 : SUMETEC_PIN_LARGO), max = op.max || (codigo ? 12 : SUMETEC_PIN_LARGO);
  // Huella o Face ID (2026-10-20): al desbloquear, si este teléfono ya la activó para esta app.
  const appHuella = modo === 'desbloquear' ? (op.app || SUMETEC_APP_NOMBRE[nombre] || '') : '';
  const conHuella = !!appHuella && sumetecHuellaActiva(appHuella);
  const quieto = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (dlg._sumetecObs) dlg._sumetecObs.disconnect();
  if (dlg._sumetecTeclas) dlg.removeEventListener('keydown', dlg._sumetecTeclas);
  dlg.style.cssText = '';
  // 2026-11-17 (Miguel): la pantalla del código de Dirección NO debe verse como el bloqueo de la app: ámbar + escudo + «No es tu PIN».
  dlg.style.setProperty('--acento', codigo ? '#f5a623' : (SUMETEC_ACENTO_PIN[nombre] || '#76b82a'));
  dlg.style.setProperty('--pin-texto', codigo ? '#2b1a00' : (nombre === 'Dirección' ? '#fff' : '#102335'));
  dlg.classList.add('sumetec-pin-dialogo', 'sumetec-pin-teclado');
  dlg.classList.toggle('sumetec-pin-autoriza', codigo);
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
    + (conHuella ? '<button type="button" class="sumetec-pin-huella"><span aria-hidden="true">◉</span> Usar huella o Face ID</button>' : '')
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
  conexion.textContent = codigo ? '⚠ Autorización requerida' : (enLinea ? '● En línea' : '● Sin conexión');
  if (!enLinea) conexion.style.color = '#ffce82';
  q('.sumetec-pin-pasos').hidden = !crear;
  if (!crear) q('.sumetec-pin-texto').textContent = op.texto || (codigo ? 'Escribe el código de seguridad.' : 'Desbloquea ' + nombre + ' en este teléfono.');
  let paso = 0, visible = false, libre = false;
  const animar = (el, cuadros, ms) => { if (!quieto && el && el.animate) el.animate(cuadros, { duration: ms, easing: 'ease-out' }); };
  const textos = () => {
    q('.sumetec-pin-eyebrow').textContent = crear ? 'Paso ' + (paso + 1) + ' de 2' : codigo ? 'No es tu PIN · Autorización' : nombre;
    form.querySelector('h2').textContent = crear ? (paso ? 'Confirma tu PIN' : 'Crea tu PIN') : (op.titulo || (codigo ? 'Código de seguridad' : 'Ingresa tu PIN'));
    if (crear) q('.sumetec-pin-texto').textContent = paso ? 'Escríbelo otra vez para confirmarlo.' : 'Lo usarás para abrir ' + nombre + ' en este teléfono.';
    guardar.textContent = crear ? (paso ? 'Guardar PIN' : 'Continuar') : codigo ? 'Autorizar' : 'Desbloquear';
    const marcas = q('.sumetec-pin-pasos').children;
    marcas[0].className = 'activa'; marcas[1].className = paso ? 'activa' : '';
    let t = '', nota = false;
    if (crear) { t = paso ? '← Cambiar el PIN' : (min === max ? min : 'De ' + min + ' a ' + max) + ' dígitos · no se puede recuperar'; nota = !paso; }
    else if (codigo) t = libre ? 'Usar el teclado numérico' : 'Usar el teclado del teléfono';
    else if (op.olvidar) t = '¿Olvidaste tu PIN?';
    enlace.textContent = t; enlace.classList.toggle('nota', nota); enlace.disabled = nota;
    enlace.style.visibility = t ? '' : 'hidden';
  };
  const pintar = () => {
    const v = ins[paso].value, n = (codigo && !op.max) ? Math.max(4, v.length) : max, hijos = [];
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
    if (v.length < min) { parar(codigo ? 'Escribe el código' : (min === max ? 'El PIN debe tener ' + min : 'El PIN debe tener al menos ' + min) + ' dígitos'); return; }
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
  dlg.addEventListener('sumetec-limpiar', () => irPaso(0));   // 2026-11-17: borra lo escrito Y repinta los puntos (tras un código incorrecto)
  ins[0].addEventListener('input', pintar);
  textos(); pintar();
  if (op.mensaje) error.textContent = op.mensaje;
  const botonHuella = q('.sumetec-pin-huella');
  if (botonHuella) {
    // El sensor del teléfono confirma a la persona; con eso se saca el PIN guardado y el teclado se cierra como si lo
    // hubiera escrito. Si falla o se cancela, el PIN sigue a la mano.
    const usar = async auto => {
      if (botonHuella.disabled) return;
      botonHuella.disabled = true;
      const pin = await sumetecPinConHuella(appHuella);
      botonHuella.disabled = false;
      if (pin) { ins[0].value = pin; if (dlg.open) dlg.close('ok'); return; }
      if (!auto && dlg.open) error.textContent = 'No se pudo con la huella. Escribe tu PIN.';
    };
    botonHuella.onclick = () => usar(false);
    // Android lo permite sin tocar nada; en iPhone el sensor solo abre con un toque (botón).
    if (!op.mensaje && !_sumetecEsApple()) setTimeout(() => { if (dlg.open) usar(true); }, 250);
  }
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
      catch (e) { sumetecHuellaPinFallo(app,pin); const quedan=2-intento; mensaje=(e.message||'PIN incorrecto')+(quedan>0?' · te quedan '+quedan+' intento'+(quedan===1?'':'s'):''); }
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
const SUMETEC_TIEMPO_ENVIO_MS = 30000;

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
  item._retryAt = Date.now() + Math.min(120000, 30000 * Math.pow(2, Math.min(item._try - 1, 2)))
    + Math.floor(Math.random() * 5000);
  if (!servidor) return false;
  item._srv = (item._srv || 0) + 1;
  return item._srv >= SUMETEC_MAX_FALLOS_SERVIDOR;
}
function sumetecPuedeReintentar(item) { return !item._retryAt || Date.now() >= item._retryAt; }

// Timbre propio: consulta versiones ligeras al servidor actual, sin otro servicio.
let _sumetecTimbre = { ultimo: {}, callback: null, respaldo: null, observando: false, intervalo: null, consultando: false };
function _sumetecTimbreAplicar_(recibidos) {
  if (!recibidos || typeof recibidos !== 'object') return;
  const cambiados = [];
  for (const tema of ['datos', 'catalogo', 'erp', 'configuracion', 'pendientes', 'resumen']) {
    const valor = recibidos[tema];
    if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) continue;
    const version = String(valor);
    if (_sumetecTimbre.ultimo[tema] !== version) {
      _sumetecTimbre.ultimo[tema] = version;
      cambiados.push(tema);
    }
  }
  if (cambiados.length && _sumetecTimbre.callback) {
    try { _sumetecTimbre.callback(cambiados); } catch (_) { /* el aviso no afecta la captura */ }
  }
}
async function _sumetecTimbreRespaldo_() {
  if (document.hidden || !_sumetecTimbre.respaldo || _sumetecTimbre.consultando) return false;
  _sumetecTimbre.consultando = true;
  try { const r=await _sumetecTimbre.respaldo(); if(!r)return false; _sumetecTimbreAplicar_(r); return true; } catch (_) { return false; }
  finally { _sumetecTimbre.consultando = false; }
}
function sumetecEscucharTimbre(alCambiar, respaldo) {
  _sumetecTimbre.callback = typeof alCambiar === 'function' ? alCambiar : null;
  _sumetecTimbre.respaldo = typeof respaldo === 'function' ? respaldo : null;
  if (!_sumetecTimbre.observando) {
    _sumetecTimbre.observando = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) _sumetecTimbreRespaldo_();
    });
  }
  if (!_sumetecTimbre.intervalo && typeof SumetecSync !== 'undefined') {
    _sumetecTimbre.intervalo = SumetecSync.reloj(_sumetecTimbreRespaldo_);
  }
  return true;
}

async function sumetecVersionesTimbre(url, token) {
  if (!url || !token || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
  try {
    const res = await sumetecFetchLimite(url, {method:'POST', headers:{'Content-Type':'text/plain'},
      body:JSON.stringify({tipo:'ping', token})}, 12000);
    const r = await res.json();
    if (!r || r.ok !== true) return null;
    return {datos:r.ver, catalogo:r.catVer, erp:r.erpVer,
      configuracion:r.configVer, pendientes:r.pendientesVer, resumen:r.resumenVer};
  } catch (_) { return null; }
}

// ═══ Borrar los datos guardados en este teléfono (2026-11-16, pedido de Miguel) ═══
// Botón de «Configuración» de cada app. Pide el permiso de la acción `borrar_datos_locales` (ERP o Dirección → Permisos:
// 'codigo' = permiso del dueño con su huella, 'libre' o 'bloqueado') y, con él, deja el teléfono como recién instalado
// PERO SIN DESVINCULARLO: se conservan el nombre, la dirección del servidor, el token cifrado, el id del dispositivo, el PIN
// y la huella. No borra nada si hay cosas sin enviar (`op.pendientes()` devuelve cuántas) para no perder ventas ni gastos.
const SUMETEC_CONSERVAR_LOCAL = [
  /^sumetec_(cotizador|gastos|compras|direccion|logistica|fact)_(dispositivo|token_cifrado|url|nombre|sesion)$/,
  /^sumetec_sinpin_/, /^sumetec_huella_/, /^sumetec_sync_equipo$/, /^sumetec_acceso_cfg$/,
  /^device_id$/, /^drive_url$/, /^gs_url$/, /^sumetec_borrado_confirmar(?:_|$)/
];
function sumetecClaveConservada(clave) { return SUMETEC_CONSERVAR_LOCAL.some(r => r.test(String(clave))); }
// Autoriza borrar los datos de ESTE teléfono (2026-11-16). 'libre'/'bloqueado' como cualquier permiso. En 'codigo' (lo normal):
// el teléfono pide a Dirección un código de 6 DÍGITOS de un solo uso; el dueño lo ve en Dirección → Permisos y se lo
// dicta al teléfono; al usarse, el servidor lo borra (vale 10 min, 5 intentos). El código nunca viaja a este teléfono.
// 2026-11-17 (Miguel): un código equivocado SE AVISA ADENTRO de la misma pantalla (mensaje rojo, puntos sacudidos y limpios)
// en vez de cerrarla y avisar con un alert que muchas veces no se ve. `validar(codigo)` -> {ok, error, fatal}.
// 2026-11-17 (Miguel): pedir el código de Dirección ya NO es una pantalla completa tipo bloqueo: es un popup centrado, igual que
// los demás avisos de las apps (dialog.sumetec-permiso), con un campo para el código y Autorizar / Cancelar.
// `validar(codigo)` -> {ok, error, fatal}; un código equivocado se avisa ADENTRO del mismo popup. Devuelve el código (o 'ok') si
// se autorizó, null si se canceló.
function _sumetecPopupCodigo_({ titulo, texto, largo, validar }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sumetec-permiso sumetec-codigo-popup';
    dlg.innerHTML = '<div class="sumetec-permiso-icono" aria-hidden="true"></div><h2></h2><p class="sumetec-permiso-texto"></p>' +
      '<form class="sumetec-codigo-form" autocomplete="off"><input class="sumetec-codigo-campo" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" aria-label="Código" placeholder="Código">' +
      '<p class="sumetec-permiso-estado" role="status"></p>' +
      '<div class="sumetec-permiso-botones"><button type="submit" class="principal">Autorizar</button><button type="button" class="secundario" data-r="cancelar">Cancelar</button></div></form>';
    dlg.querySelector('.sumetec-permiso-icono').textContent = '🔐';
    dlg.querySelector('h2').textContent = titulo || 'Código de Dirección';
    dlg.querySelector('.sumetec-permiso-texto').textContent = texto || '';
    const form = dlg.querySelector('form'), input = dlg.querySelector('input'), estado = dlg.querySelector('.sumetec-permiso-estado'), boton = dlg.querySelector('.principal');
    input.maxLength = largo || 12;
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, largo || 12); estado.textContent = ''; });
    dlg.querySelector('[data-r="cancelar"]').onclick = () => dlg.close('cancelar');
    let ocupado = false;
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (ocupado) return;
      if (input.value.length < (largo || 1)) { estado.textContent = largo ? 'Escribe los ' + largo + ' dígitos.' : 'Escribe el código.'; return; }
      ocupado = true; boton.disabled = true; estado.textContent = 'Verificando…';
      let r; try { r = await validar(input.value); } catch (_) { r = { ok: false, error: 'No se pudo validar el código. Intenta de nuevo.' }; }
      ocupado = false; boton.disabled = false;
      if (r && r.ok) { dlg.close('ok'); return; }
      input.value = ''; input.focus();
      estado.textContent = (r && r.error) || 'Código incorrecto.';
      estado.dataset.estado = 'RECHAZADA';
      if (r && r.fatal) setTimeout(() => { if (dlg.open) dlg.close('cancelar'); }, 2500);
    });
    dlg.addEventListener('close', () => { const ok = dlg.returnValue === 'ok', v = input.value; input.value = ''; dlg.remove(); resolve(ok ? (v || 'ok') : null); }, { once: true });
    document.body.appendChild(dlg); dlg.showModal(); input.focus();
  });
}
function _sumetecTecladoCodigoDireccion(nombre, texto, validar) {
  return _sumetecPopupCodigo_({ titulo: 'Código de Dirección', texto, largo: 6, validar });
}
async function sumetecAutorizarBorrado(app, op = {}) {
  const modo = sumetecPermiso(app, 'borrar_datos_locales', 'codigo');
  if (modo !== 'codigo') return sumetecAutorizarAccion(app, 'borrar_datos_locales', 'codigo', op);
  const avisar = m => { if (typeof op.avisar === 'function') op.avisar(m); else if (typeof alert === 'function') alert(m); };
  const equipo = localStorage.getItem('sumetec_' + _sumetecAppAcceso(app) + '_dispositivo') || 'equipo';
  const base = { app, accion: 'borrar_datos_locales', documento: ('datos-locales-' + equipo).slice(0, 100), detalle: 'Borrar los datos guardados en este teléfono' };
  const r = await _sumetecPostPermiso(app, Object.assign({ tipo: 'solicitar_aprobacion' }, base));
  if (r.sinRed) { avisar('Se necesita señal para pedir el código a Dirección. Intenta cuando haya internet.'); return false; }
  if (!r.ok || !r.aprobacion) { avisar(r.error || 'No se pudo pedir el código a Dirección.'); return false; }
  // El servidor guarda el código de UN SOLO USO: se borra al validarse bien, vale 10 min y se agota a los 5 intentos.
  const validar = async codigo => {
    const v = await _sumetecPostPermiso(app, Object.assign({ tipo: 'validar_codigo_borrado', codigo }, base));
    if (v.sinRed) return { ok: false, error: 'Sin señal: no se pudo validar el código. Intenta con internet.' };
    if (v.ok) return { ok: true };
    return { ok: false, fatal: !v.incorrecto,
      error: v.incorrecto ? 'Código incorrecto. Revisa los 6 dígitos con Dirección e inténtalo otra vez.' : (v.error || 'Código incorrecto.') };
  };
  const hecho = await _sumetecTecladoCodigoDireccion(op.nombre || app, 'Dirección tiene un código de 6 dígitos para este teléfono (Dirección → Permisos). Escríbelo aquí. Sirve una sola vez.', validar);
  return hecho !== null;
}
// 2026-11-17 (Miguel): al terminar de borrar los datos de un teléfono SIEMPRE se dice «Contenido borrado» en un popup centrado
// (antes era un aviso que se iba solo o la app recargaba sin decir nada). Devuelve una promesa que se cumple al tocar Entendido.
function sumetecAvisoContenidoBorrado(detalle) {
  return new Promise(resolve => {
    const dlg = _sumetecDialogoSimple('🗑️', 'Contenido borrado', detalle || 'Los datos de este teléfono se borraron. Lo enviado sigue en el servidor y se vuelve a bajar.', [['ok', 'Entendido']]);
    dlg.querySelector('[data-r="ok"]').onclick = () => dlg.close('ok');
    dlg.addEventListener('close', () => resolve(true), { once: true });
  });
}
// GitHub Pages comparte almacenamiento entre las apps. Cada orden limpia solo sus propios datos.
const SUMETEC_DATOS_LOCALES = {
  cotizador: /^(?:sumetec_(?:cotizador_|remisiones_|folio_epoca$|productos_generacion$)|r_|cot_|_cot_historial$|buzon_ids_enviados$|cola_(?:cancel|cot_r|devoluciones|elim|nuevos|offline|pdf|remisiones|resultado_cot)$|cache_cobros|cat_(?:ok_ts|ver)$|data_ver$|erp_(?:auto_n|auto_ts|catalogo_ts)$|excepciones_activas$|fallas_erp$|gs_(?:cc|cfg|cfg_ts|cp|hp|sync|sync_ts)$|pdf_(?:boletos|previo_traza)$|portal_pedidos_borradores$|prod_capturados$|rem_ultima_actualizacion$|tmp_(?:letras|n)$|ultimo_respaldo_ts$|_respaldo_antes_de_restaurar$)/,
  gastos: /^(?:sumetec_gastos_|cola_(?:gastos|conteo)$|conteo_actual$|gasto_ultimo_proveedor$|gastos_recientes$|inv_|listas_gasto_cache$|stock_teorico_cache$|config_ecosistema_cache$)/,
  direccion: /^(?:sumetec_direccion_|direccion_ultima_actualizacion$)/,
  compras: /^(?:sumetec_compras_|compras_ultima_actualizacion$|sfoto_)/,
  logistica: /^(?:sumetec_logistica_|logistica_(?:ultima_actualizacion|acceso_validado)$)/,
  fact: /^sumetec_fact(?:_|uras_demo$)/,
};
async function sumetecVaciarLocal(app, revisarPendientes) {
  const resumen = { claves: 0, sesion: 0, caches: 0, bases: 0 };
  try {
    const claves = SUMETEC_DATOS_LOCALES[app];
    if (!claves) throw Error('Aplicación desconocida para el borrado.');
    const servidor = await _sumetecServidores[app]?.(true);
    if (revisarPendientes && await revisarPendientes()) return { ok: false, pendientes: true };
    if (servidor?.token && typeof SumetecSync !== 'undefined' && SumetecSync.borrarLocal) {
      if (await SumetecSync.borrarLocal(servidor.url, servidor.token, app)) resumen.bases++;
    }
    if (revisarPendientes && await revisarPendientes()) return { ok: false, pendientes: true };
    if (app === 'logistica') {
      if (typeof window.sumetecVaciarBaseApp !== 'function') throw Error('La base de Logística aún no está disponible.');
      if (await window.sumetecVaciarBaseApp(!!revisarPendientes) === false) return { ok: false, pendientes: true };
      resumen.bases++;
    }
    const quitar = almacenamiento => {
      let n = 0;
      for (const k of Object.keys(almacenamiento)) if (claves.test(k) && !sumetecClaveConservada(k)) {
        almacenamiento.removeItem(k);
        n++;
      }
      return n;
    };
    resumen.claves = quitar(localStorage);
    if (typeof sessionStorage !== 'undefined') resumen.sesion = quitar(sessionStorage);
  } catch (e) { return { ok: false, error: String(e && e.message || e), resumen }; }
  return { ok: true, resumen };
}
async function sumetecBorrarDatosLocales(app, op = {}) {
  const avisar = m => { if (typeof op.avisar === 'function') op.avisar(m); else if (typeof alert === 'function') alert(m); };
  _sumetecAppAcceso(app);
  let pend = 0;
  try { pend = typeof op.pendientes === 'function' ? Number(await op.pendientes()) || 0 : 0; } catch (_) { pend = 1; }
  if (pend > 0) { avisar('Hay ' + pend + ' cosa(s) sin enviar en este teléfono. Envíalas o descártalas antes de borrar los datos.'); return { ok: false, motivo: 'PENDIENTES' }; }
  const permitido = await sumetecAutorizarBorrado(app, Object.assign({}, op, {
    nombre: op.nombre || app, documento: 'datos-locales', detalle: 'Borrar los datos guardados en este teléfono', avisar }));
  if (!permitido) return { ok: false, motivo: 'SIN_PERMISO' };
  if (typeof op.confirmar === 'function' ? !(await op.confirmar()) : !(await sumetecConfirmarBorrado({ verbo: 'Borrar', objeto: 'los datos de este teléfono', detalle: 'Se borran las copias guardadas aquí (catálogo, clientes, historial). La app sigue vinculada y todo lo enviado sigue en el servidor.', irreversible: false })))
    return { ok: false, motivo: 'CANCELADO' };
  const v = await sumetecVaciarLocal(app, async () => typeof op.pendientes === 'function' && Number(await op.pendientes()) > 0);
  if (v.pendientes) { avisar('Entraron cosas sin enviar. Envíalas antes de borrar los datos.'); return { ok: false, motivo: 'PENDIENTES' }; }
  if (!v.ok) { avisar('No se pudo borrar todo: ' + v.error); return { ok: false, motivo: 'ERROR', resumen: v.resumen }; }
  const resumen = v.resumen;
  await sumetecAvisoContenidoBorrado();
  if (op.recargar !== false && typeof location !== 'undefined' && location.reload) location.reload();
  return { ok: true, resumen };
}

// ═══ Borrado remoto central (2026-11-20, pedido de Miguel) ═══
// Dirección da UNA orden (con código del ERP) y cada teléfono vinculado la ejecuta solo: borra sus datos locales (como «Borrar datos de este
// teléfono») pero NO toca el vínculo, el PIN ni la huella, y no borra nada en el servidor. Reglas del lado teléfono:
//  - Consulta `borrado_estado` al abrir, cada minuto con la app visible, y al volver la señal. Manda cuántas cosas tiene sin enviar.
//  - Antes de la hora de arranque (cuenta atrás) o con pendientes sin enviar NO borra: solo avisa con una franja. Si Dirección decide «Forzar»
//    (otro código de un uso), descarta lo pendiente; si decide «Revisar» sigue esperando.
//  - Al terminar confirma a Dirección. Si no hubo señal para confirmar, lo reintenta al volver a abrir.
// Cada app dice cuántas cosas tiene sin enviar con `window.sumetecPendientesApp` o, si no, con `_pendientesParaLimpiar_` (las que ya usa su menú).
const _sumetecBorradoRemoto = { app: '', timer: null, ocupado: false, iniciado: false };
async function _sumetecPendientesBorrado() {
  const f = (typeof window !== 'undefined') && (window.sumetecPendientesApp || window._pendientesParaLimpiar_ || window._pendientesParaLimpiar);
  if (typeof f !== 'function') return 1;       // sin contador: por seguridad se trata como «hay pendientes»
  try { const n = Number(await f()); return Number.isSafeInteger(n) && n >= 0 ? n : 1; } catch (_) { return 1; }
}
function _sumetecFranjaBorrado(texto) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('sumetec-borrado-franja');
  if (!texto) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'sumetec-borrado-franja'; el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#b3261e;color:#fff;font:600 14px/1.35 system-ui,sans-serif;padding:10px 14px;text-align:center';
    (document.body || document.documentElement).appendChild(el);
  }
  el.textContent = texto;
}
async function _sumetecConfirmarBorradoRemoto(app) {
  const clave = 'sumetec_borrado_confirmar_' + app;
  let c = null; try { c = JSON.parse(localStorage.getItem(clave) || 'null'); } catch (_) {}
  if (!c || !c.id) return 'sin_acuse';
  const r = await _sumetecPostPermiso(app, { tipo: 'borrado_confirmar', id: c.id, resumen: c.resumen, forzado: c.forzado }, true);
  if (!r?.confirmado && r?.codigo !== 'ORDEN_INACTIVA') return 'acuse_pendiente';
  localStorage.removeItem(clave);
  return 'acuse_enviado';
}
async function sumetecSondearBorradoRemoto(app) {
  const E = _sumetecBorradoRemoto;
  if (E.ocupado) return { estado: 'ocupado' };
  E.ocupado = true;
  try {
    if (await _sumetecConfirmarBorradoRemoto(app) === 'acuse_pendiente') return { estado: 'acuse_pendiente' };
    const pend = await _sumetecPendientesBorrado();
    const r = await _sumetecPostPermiso(app, { tipo: 'borrado_estado', pendientes: pend }, true);
    if (!r || r.sinRed || !r.ok || !r.orden) { _sumetecFranjaBorrado(''); return { estado: 'sin_orden' }; }
    const o = r.orden;
    if (!o.ejecutar) {
      const cuando = new Date(Date.now() + Math.max(0, (o.desde || 0) - (o.ahora || 0)));
      _sumetecFranjaBorrado((o.ahora || 0) < (o.desde || 0)
        ? 'Dirección ordenó borrar los datos de este teléfono. Empieza a las ' + cuando.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) + '. Envía lo pendiente.'
        : 'Dirección ordenó borrar los datos de este teléfono. Tienes ' + pend + ' cosa(s) sin enviar: envíalas para que se borre.');
      return { estado: 'en_espera', pendientes: pend };
    }
    // Revisión final justo antes de borrar: lo pendiente solo se descarta si Dirección decidió «Forzar».
    const pend2 = await _sumetecPendientesBorrado();
    if (pend2 > 0 && !o.forzar) { _sumetecFranjaBorrado('Dirección ordenó borrar los datos de este teléfono. Tienes ' + pend2 + ' cosa(s) sin enviar: envíalas para que se borre.'); return { estado: 'en_espera', pendientes: pend2 }; }
    _sumetecFranjaBorrado('Borrando los datos de este teléfono por orden de Dirección…');
    const v = await sumetecVaciarLocal(app, o.forzar ? null : async () => await _sumetecPendientesBorrado() > 0);
    if (v.pendientes) { _sumetecFranjaBorrado('Entraron datos por enviar. El borrado sigue en espera.'); return { estado: 'en_espera' }; }
    if (!v.ok) { _sumetecFranjaBorrado('No se pudo borrar: ' + v.error); return { estado: 'error' }; }
    localStorage.setItem('sumetec_borrado_confirmar_' + app, JSON.stringify({
      id: o.id, forzado: !!o.forzar && pend2 > 0, resumen: 'claves ' + v.resumen.claves + ', bases ' + v.resumen.bases
    }));
    await _sumetecConfirmarBorradoRemoto(app);
    _sumetecFranjaBorrado('');
    await sumetecAvisoContenidoBorrado('Dirección ordenó borrar los datos de este teléfono. La app sigue vinculada y todo lo enviado sigue en el servidor.');
    if (typeof location !== 'undefined' && location.reload) location.reload();
    return { estado: 'borrado', resumen: v.resumen };
  } catch (e) { return { estado: 'error', error: String(e && e.message || e) }; }
  finally { E.ocupado = false; }
}
function sumetecIniciarBorradoRemoto(app) {
  const E = _sumetecBorradoRemoto;
  if (E.iniciado || typeof document === 'undefined' || typeof setInterval === 'undefined') return;
  E.iniciado = true; E.app = app;
  const sondear = () => {
    if (document.visibilityState === 'hidden' || navigator.onLine === false || E.ocupado) return;
    if (navigator.locks) navigator.locks.request('sumetec-borrado-' + app, { ifAvailable: true }, lock => lock && sumetecSondearBorradoRemoto(app)).catch(() => {});
    else sumetecSondearBorradoRemoto(app);
  };
  setTimeout(sondear, 6000);
  E.timer = setInterval(sondear, 60000);
  document.addEventListener('visibilitychange', sondear);
  window.addEventListener('online', sondear);
}

// ═══ Menú de Ajustes estándar (2026-11-16, pedido de Miguel) ═══
// Las 6 apps tienen el MISMO grupo «Ajustes» en su menú: Modo claro / oscuro (donde la app ya tiene tema), Actualización de
// software y Borrar datos de este teléfono. Esta función es la «Actualización de software» común.
const SUMETEC_CLAVE_ULTIMA_ACTUALIZACION = { cotizador: 'rem_ultima_actualizacion', gastos: 'inv_ultima_actualizacion', compras: 'compras_ultima_actualizacion',
  direccion: 'direccion_ultima_actualizacion', logistica: 'logistica_ultima_actualizacion', fact: 'sumetec_fact_ultima_actualizacion' };
function sumetecTextoVersionInstalada(app) {
  const codigo = (typeof VERSION_CODIGO !== 'undefined' && VERSION_CODIGO) ? VERSION_CODIGO : null;
  const v = (typeof VERSION_DEPLOY !== 'undefined' && VERSION_DEPLOY)
    ? new Date(VERSION_DEPLOY).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin información';
  let ultima = 0; try { ultima = Number(localStorage.getItem(SUMETEC_CLAVE_ULTIMA_ACTUALIZACION[_sumetecAppAcceso(app)]) || 0); } catch (_) {}
  const u = ultima ? new Date(ultima).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Aún no se ha detectado una actualización nueva en este dispositivo.';
  return 'Versión instalada: ' + (codigo ? codigo + ' · ' : '') + v + '. Última actualización: ' + u;
}
// 2026-11-17 (Miguel): «Actualización de software» ya NO solo muestra la versión: BUSCA la actualización de verdad. Le pide al
// navegador que revise sw.js en el servidor; si hay versión nueva, la propia app abre su aviso «Actualizar» (actualizacion.js);
// si no, un popup dice que ya tiene la última. Recargar con F5 también la busca, pero la versión nueva solo se aplica al pulsar «Actualizar».
async function sumetecBuscarActualizacion(app) {
  const final = (titulo, texto, icono) => new Promise(r => {
    const d = _sumetecDialogoSimple(icono || 'ℹ️', titulo, texto, [['ok', 'Entendido']]);
    d.querySelector('[data-r="ok"]').onclick = () => d.close('ok'); d.addEventListener('close', () => r(true), { once: true });
  });
  const info = sumetecTextoVersionInstalada(app);
  if (!('serviceWorker' in navigator)) { await final('Actualización de software', info); return; }
  if (navigator.onLine === false) { await final('Sin internet', 'Conéctate para buscar actualizaciones. ' + info, '📡'); return; }
  const espera = _sumetecDialogoSimple('🔄', 'Buscando actualización…', 'Un momento, preguntando al servidor por una versión nueva.', []);
  const cerrarEspera = () => { try { if (espera.open) espera.close(); } catch (_) {} };
  let reg = null;
  try {
    reg = await navigator.serviceWorker.getRegistration();
    if (reg) await Promise.race([reg.update(), new Promise((_, no) => setTimeout(() => no(new Error('tiempo')), 15000))]);
  } catch (_) { /* sin respuesta: se avisa abajo */ }
  const hayAviso = () => { const b = document.getElementById('sumetecActualizarBoton'); return !!b && !b.hidden; };
  if (reg) {
    try { window.dispatchEvent(new Event('online')); } catch (_) {}   // hace que actualizacion.js vuelva a revisar y abra el aviso si toca
    for (let i = 0; i < 24 && !hayAviso(); i++) {     // hasta ~12 s: da tiempo a que la versión nueva se descargue y se instale
      if (i > 3 && !reg.installing && !reg.waiting) break;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  cerrarEspera();
  if (hayAviso()) return;   // la app ya muestra «Actualización disponible»
  if (!reg) { await final('Actualización de software', info); return; }
  await final('Ya tienes la última versión', info, '✅');
}
function sumetecMostrarVersionInstalada(app) { return sumetecBuscarActualizacion(app); }

// ═══ Vínculo vigente (2026-11-17, pedido de Miguel: las 6 apps se comportan igual) ═══
// Al abrir, cada app le pregunta al servidor si ESTE teléfono sigue reconocido (lectura «configuracion», la puede hacer cualquier
// teléfono vinculado). Si contesta «no autorizado» el vínculo se da por muerto y la app vuelve a pedir vincular, como hace Gastos.
// Sin respuesta (sin señal, servidor ocupado) NO se desvincula nada. Devuelve 'vigente' | 'rechazado' | 'sin_respuesta'.
async function sumetecComprobarVinculo(url, token) {
  if (!url || !token) return 'sin_respuesta';
  let t = null;
  try {
    const ctrl = new AbortController(); t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ tipo: 'configuracion', token }), signal: ctrl.signal });
    if (!r.ok) return 'sin_respuesta';
    const d = await r.json();
    if (d && d.ok === false && /no autorizado/i.test(String(d.error || ''))) return 'rechazado';
    return (d && d.ok !== false) ? 'vigente' : 'sin_respuesta';
  } catch (_) { return 'sin_respuesta'; } finally { if (t) clearTimeout(t); }
}

// ═══ Popups de la app (2026-11-17, pedido de Miguel) ═══
// NINGUNA app usa los cuadros genéricos del navegador (alert / confirm / prompt): todo aviso, confirmación o captura sale
// como popup propio de la app. alert() queda reemplazado aquí mismo (no espera respuesta); confirm() y prompt() se usan como
//   if (!(await sumetecConfirmar('texto'))) return;      const t = await sumetecPedirTexto('texto', 'valor inicial');
// Es un <dialog> modal, así que queda por encima de cualquier otra ventana abierta (PIN, vincular, etc.).
function _sumetecPopupEstilos() {
  if (typeof document === 'undefined' || document.getElementById('sumetec-popup-css')) return;
  const st = document.createElement('style'); st.id = 'sumetec-popup-css';
  st.textContent = [
    'dialog.sumetec-popup{border:0;padding:0;border-radius:18px;max-width:min(92vw,400px);width:100%;background:#fff;color:#0D3B66;box-shadow:0 18px 48px rgba(13,59,102,.28);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    'dialog.sumetec-popup::backdrop{background:rgba(8,24,40,.55);backdrop-filter:blur(2px)}',
    'dialog.sumetec-popup .sp-caja{padding:22px 20px 16px}',
    'dialog.sumetec-popup .sp-icono{font-size:30px;text-align:center;margin-bottom:6px}',
    'dialog.sumetec-popup .sp-titulo{margin:0 0 8px;font-size:17px;font-weight:800;text-align:center;color:#0D3B66}',
    'dialog.sumetec-popup .sp-msg{margin:0 0 14px;white-space:pre-line;word-break:break-word;color:#33475b;max-height:46vh;overflow:auto;text-align:left}',
    'dialog.sumetec-popup .sp-input{width:100%;box-sizing:border-box;padding:11px 12px;margin:0 0 14px;border:1.5px solid #c9d3de;border-radius:10px;font:inherit;background:#fff;color:#0D3B66}',
    'dialog.sumetec-popup .sp-input:focus{outline:2px solid #057448;border-color:#057448}',
    'dialog.sumetec-popup .sp-botones{display:flex;gap:10px}',
    'dialog.sumetec-popup .sp-btn{flex:1;padding:12px;border:0;border-radius:11px;font:inherit;font-weight:700;cursor:pointer;background:#eef2f6;color:#0D3B66}',
    'dialog.sumetec-popup .sp-btn.sp-ok{background:#057448;color:#fff}',
    'dialog.sumetec-popup .sp-btn.sp-peligro{background:#b3261e;color:#fff}',
    ':root[data-theme="dark"] dialog.sumetec-popup,html.dark dialog.sumetec-popup,body.dark dialog.sumetec-popup{background:#16202b;color:#e8eef5}',
    ':root[data-theme="dark"] dialog.sumetec-popup .sp-titulo,html.dark dialog.sumetec-popup .sp-titulo,body.dark dialog.sumetec-popup .sp-titulo{color:#e8eef5}',
    ':root[data-theme="dark"] dialog.sumetec-popup .sp-msg,html.dark dialog.sumetec-popup .sp-msg,body.dark dialog.sumetec-popup .sp-msg{color:#b9c6d4}',
    ':root[data-theme="dark"] dialog.sumetec-popup .sp-input,html.dark dialog.sumetec-popup .sp-input,body.dark dialog.sumetec-popup .sp-input{background:#0f1720;color:#e8eef5;border-color:#33475b}',
    ':root[data-theme="dark"] dialog.sumetec-popup .sp-btn:not(.sp-ok):not(.sp-peligro),html.dark dialog.sumetec-popup .sp-btn:not(.sp-ok):not(.sp-peligro),body.dark dialog.sumetec-popup .sp-btn:not(.sp-ok):not(.sp-peligro){background:#243242;color:#e8eef5}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(st);
}
// cfg: { icono, titulo, mensaje, input:{valor}, botones:[{texto, valor, clase, usaInput}], cancelar: valor al pulsar Esc }
function _sumetecPopup(cfg) {
  return new Promise(resolve => { try {
    if (typeof document === 'undefined' || !document.body) { resolve(cfg.cancelar); return; }
    _sumetecPopupEstilos();
    const dlg = document.createElement('dialog'); dlg.className = 'sumetec-popup'; dlg.setAttribute('aria-modal', 'true');
    const caja = document.createElement('div'); caja.className = 'sp-caja';
    const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    if (cfg.icono) caja.appendChild(mk('div', 'sp-icono', cfg.icono));
    if (cfg.titulo) caja.appendChild(mk('h2', 'sp-titulo', cfg.titulo));
    caja.appendChild(mk('p', 'sp-msg', cfg.mensaje == null ? '' : String(cfg.mensaje)));
    let input = null;
    if (cfg.input) { input = mk('input', 'sp-input'); input.type = 'text'; input.autocomplete = 'off'; input.value = cfg.input.valor == null ? '' : String(cfg.input.valor); caja.appendChild(input); }
    const fila = mk('div', 'sp-botones');
    let cerrado = false;
    const cerrar = v => { if (cerrado) return; cerrado = true; try { dlg.close(); } catch (_) {} dlg.remove(); resolve(v); };
    (cfg.botones || [{ texto: 'Entendido', valor: true, clase: 'sp-ok' }]).forEach(b => {
      const btn = mk('button', 'sp-btn' + (b.clase ? ' ' + b.clase : ''), b.texto); btn.type = 'button';
      btn.onclick = () => cerrar(b.usaInput && input ? input.value : b.valor); fila.appendChild(btn);
    });
    caja.appendChild(fila); dlg.appendChild(caja);
    dlg.addEventListener('cancel', e => { e.preventDefault(); cerrar(cfg.cancelar); });
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); cerrar(input.value); } });
    document.body.appendChild(dlg);
    try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); }
    setTimeout(() => { try { (input || fila.lastElementChild).focus(); } catch (_) {} }, 30);
  } catch (_) { resolve(cfg.cancelar); } });
}
// Aviso con un solo botón. No hace falta esperarlo.
function sumetecAviso(mensaje, titulo) {
  return _sumetecPopup({ icono: 'ℹ️', titulo: titulo || 'Aviso', mensaje, cancelar: true, botones: [{ texto: 'Entendido', valor: true, clase: 'sp-ok' }] });
}
// Sí / No. Devuelve true o false. opts: { si, no, peligro }
function sumetecConfirmar(mensaje, titulo, opts) {
  opts = opts || {};
  return _sumetecPopup({ icono: opts.peligro ? '⚠️' : '❓', titulo: titulo || '¿Confirmar?', mensaje, cancelar: false,
    botones: [{ texto: opts.no || 'Cancelar', valor: false }, { texto: opts.si || 'Continuar', valor: true, clase: opts.peligro ? 'sp-peligro' : 'sp-ok' }] });
}
// 2026-11-17 (Miguel): UN SOLO formato para todo lo que borra, descarta, cancela o desvincula, igual en las 6 apps:
// icono 🗑️, título «¿Verbo objeto?», detalle de qué pasa y, si no hay vuelta atrás, la línea fija «Esta acción no se puede deshacer.»
// Botones: «Volver» (izquierda, neutro) y el verbo en rojo (derecha). «Volver» y no «Cancelar» para no confundirse con «Cancelar factura».
// o: { verbo:'Borrar'|'Descartar'|'Cancelar'|'Desvincular'|'Anular', objeto:'esta compra', detalle:'qué pasa', irreversible:true|false }
function sumetecConfirmarBorrado(o) {
  o = o || {};
  const verbo = o.verbo || 'Borrar', objeto = o.objeto || 'esto';
  const msg = [o.detalle || '', o.irreversible ? 'Esta acción no se puede deshacer.' : ''].filter(Boolean).join('\n\n');
  return _sumetecPopup({ icono: '🗑️', titulo: '¿' + verbo + ' ' + objeto + '?', mensaje: msg, cancelar: false,
    botones: [{ texto: 'Volver', valor: false }, { texto: verbo, valor: true, clase: 'sp-peligro' }] });
}
// Captura de texto. Devuelve el texto, o null si cancela.
function sumetecPedirTexto(mensaje, valor, titulo) {
  return _sumetecPopup({ icono: '✏️', titulo: titulo || 'Escribe', mensaje, input: { valor }, cancelar: null,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Aceptar', usaInput: true, clase: 'sp-ok' }] });
}
if (typeof window !== 'undefined') { window.alert = function (m) { sumetecAviso(m == null ? '' : String(m)); }; }

// 2026-11-18 (Miguel): vinculación por QR. La dirección trae ?vincular=CÓDIGO (lo genera Dirección o el ERP); se escribe en el campo del código y se quita de la barra de direcciones.
(function () {
  if (typeof window === 'undefined' || typeof location === 'undefined') return;
  let codigo = '';
  try { codigo = (new URLSearchParams(location.search).get('vincular') || '').trim().toUpperCase(); } catch (_) {}
  if (!/^[A-Z0-9]{6,12}$/.test(codigo)) return;
  try { const u = new URL(location.href); u.searchParams.delete('vincular'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } catch (_) {}
  let intentos = 0;
  const poner = () => {
    const campo = ['#codigo', '#tg_codigo'].map(s => document.querySelector(s)).find(e => e && e.offsetParent !== null);
    if (campo) { campo.value = codigo; campo.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (++intentos < 40) setTimeout(poner, 500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poner); else poner();
})();
