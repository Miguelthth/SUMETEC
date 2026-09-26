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
  if (!['cotizador','gastos','fact'].includes(app)) throw Error('Aplicación desconocida');
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

function sumetecPedirPinToken(nombre,crear=false) {
  return new Promise(resolve=>{
    const dlg=document.createElement('dialog');
    dlg.style.cssText='border:0;border-radius:16px;padding:24px;max-width:340px;width:calc(100% - 32px);box-shadow:0 16px 48px #0005;z-index:2147483647';
    dlg.innerHTML='<form method="dialog" style="display:grid;gap:12px;font:16px sans-serif">'
      +'<strong></strong><label>PIN <input type="password" required minlength="4" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px"></label>'
      +(crear?'<label>Repite el PIN <input type="password" required minlength="4" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px"></label>':'')
      +'<small style="color:#b42318;min-height:1em"></small><div style="display:flex;gap:8px;justify-content:end">'
      +'<button value="cancelar" type="button">Cancelar</button><button value="ok" type="submit">Continuar</button></div></form>';
    dlg.querySelector('strong').textContent=(crear?'Crea un PIN para ':'Abre ')+nombre;
    const form=dlg.querySelector('form'),ins=dlg.querySelectorAll('input'),error=dlg.querySelector('small');
    dlg.querySelector('button[value="cancelar"]').onclick=()=>dlg.close('cancelar');
    form.addEventListener('submit',e=>{
      if(crear && ins[0].value!==ins[1].value){e.preventDefault();error.textContent='Los PIN no coinciden';}
    });
    dlg.addEventListener('close',()=>{const pin=dlg.returnValue==='ok'?ins[0].value:null;dlg.remove();resolve(pin);},{once:true});
    document.body.appendChild(dlg);dlg.showModal();ins[0].focus();
  });
}

async function sumetecRestaurarTokenApp(app,nombre,claveLegada) {
  const cifrado=localStorage.getItem(_sumetecClaveToken(app));
  if (cifrado) {
    for (let intento=0;intento<3;intento++) {
      const pin=await sumetecPedirPinToken(nombre);
      if (pin===null) return '';
      try { return await sumetecAbrirTokenCifrado(app,pin); }
      catch (e) { alert(e.message); }
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

function sumetecAbrirAyuda(id) {
  const ayuda = document.getElementById(id);
  const control = document.querySelector(`[aria-controls="${id}"]`);
  if (ayuda) {
    ayuda.open = !ayuda.open;
    control?.setAttribute('aria-expanded', String(ayuda.open));
    control?.focus();
  }
}

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
        if (elemento !== gate && elemento.tagName !== 'SCRIPT' && elemento.tagName !== 'DIALOG') {
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
