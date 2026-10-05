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

let _sumetecPinPromesa = null;
function sumetecPedirPinToken(nombre, crear=false, mensaje='') {
  if (_sumetecPinPromesa) return _sumetecPinPromesa;
  _sumetecPinPromesa = new Promise(resolve=>{
    const dlg=document.createElement('dialog');
    dlg.className='sumetec-pin-dialogo';
    dlg.style.setProperty('--acento', ({Cotizador:'#2aaeeb', Remisiones:'#2aaeeb', Gastos:'#f06452', Facturación:'#d99c2b', Dirección:'#8750df', Compras:'#54c99a'})[nombre]||'#76b82a');
    dlg.innerHTML='<form method="dialog">'
      +'<h2></h2><p></p><label><span></span><input type="password" required minlength="4" autocomplete="off" inputmode="numeric"></label>'
      +(crear?'<label>Confirmar PIN<input type="password" required minlength="4" autocomplete="off" inputmode="numeric"></label>':'')
      +'<button class="sumetec-pin-mostrar" type="button" aria-pressed="false">Mostrar PIN</button>'
      +'<small class="sumetec-pin-error" role="alert"></small><div class="sumetec-pin-acciones">'
      +'<button class="sumetec-pin-volver" type="button">Volver</button><button class="sumetec-pin-guardar" value="ok" type="submit"></button></div></form>';
    dlg.querySelector('h2').textContent=crear?'Protege este teléfono':'Ingresa tu PIN';
    dlg.querySelector('p').textContent=crear?'Crea el PIN para '+nombre+'. Lo usarás al abrir la app.':'Desbloquea '+nombre+' en este teléfono.';
    dlg.querySelector('label span').textContent=crear?'Crear PIN':'PIN';
    dlg.querySelector('.sumetec-pin-guardar').textContent=crear?'Guardar PIN':'Desbloquear';
    const form=dlg.querySelector('form'), ins=dlg.querySelectorAll('input'), error=dlg.querySelector('.sumetec-pin-error');
    error.textContent=mensaje;
    dlg.querySelector('.sumetec-pin-volver').onclick=()=>dlg.close('cancelar');
    dlg.querySelector('.sumetec-pin-mostrar').onclick=e=>{
      const visible=ins[0].type==='password';
      ins.forEach(input=>{input.type=visible?'text':'password';});
      e.currentTarget.textContent=visible?'Ocultar PIN':'Mostrar PIN';
      e.currentTarget.setAttribute('aria-pressed',String(visible));
    };
    form.addEventListener('submit',e=>{
      if(crear && ins[0].value!==ins[1].value){e.preventDefault();error.textContent='Los PIN no coinciden';ins[1].focus();}
    });
    dlg.addEventListener('close',()=>{
      const pin=dlg.returnValue==='ok'?ins[0].value:null;
      ins.forEach(input=>{input.value='';});
      dlg.remove(); _sumetecPinPromesa=null; resolve(pin);
    },{once:true});
    document.body.appendChild(dlg); dlg.showModal(); ins[0].focus();
  });
  return _sumetecPinPromesa;
}

async function sumetecRestaurarTokenApp(app,nombre,claveLegada) {
  const cifrado=localStorage.getItem(_sumetecClaveToken(app));
  if (cifrado) {
    let mensaje='';
    for (let intento=0;intento<3;intento++) {
      const pin=await sumetecPedirPinToken(nombre,false,mensaje);
      if (pin===null) return '';
      try { return await sumetecAbrirTokenCifrado(app,pin); }
      catch (e) { mensaje=e.message||'PIN incorrecto'; }
    }
    return '';
  }
  const legado=(localStorage.getItem(claveLegada)||'').trim();
  if (!legado) return '';
  const pin=await sumetecPedirPinToken(nombre,true);
  if (pin===null) return '';
  await sumetecGuardarTokenCifrado(app,legado,pin);
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
