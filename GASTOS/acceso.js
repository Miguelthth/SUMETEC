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
        if (elemento !== gate && elemento.tagName !== 'SCRIPT') {
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
