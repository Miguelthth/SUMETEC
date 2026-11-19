// Dirección → «Generar código de vinculación» (2026-11-18, pedido de Miguel).
// Desde el teléfono de Dirección se genera el código de UN SOLO USO (10 min, 5 intentos) para vincular cualquier otro teléfono, sin entrar al editor de Apps Script.
// Se muestra el código Y un QR: el QR abre la app elegida con el código ya escrito (la app lo lee de la dirección y lo borra de ella).
// Solo un teléfono Dirección vinculado puede pedirlo: lo valida el servidor (generar_codigo_vinculo).

const _VINCULO_APPS_ = [
  { clave: 'GASTOS', nombre: 'Gastos', ruta: 'GASTOS/gastos.html' },
  { clave: 'COTIZADOR', nombre: 'Cotizador', ruta: 'COTIZACION-REMISION/remision.html' },
  { clave: 'COMPRAS', nombre: 'Compras', ruta: 'COMPRAS/compras.html' },
  { clave: 'DIRECCION', nombre: 'Dirección', ruta: 'DIRECCION/direccion.html' },
];

// Dirección de la app elegida: misma base que esta app (…/SUMETEC/) y el código como parámetro `vincular`.
function _urlVinculoApp_(app, codigo) {
  const m = /^(.*\/SUMETEC\/)/.exec(location.href);
  const base = m ? m[1] : 'https://miguelthth.github.io/SUMETEC/';
  return base + app.ruta + '?vincular=' + encodeURIComponent(codigo);
}

function _svgQrVinculo_(texto) {
  if (typeof qrcode !== 'function') return '';
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

async function generarCodigoVinculacionDireccion() {
  let dlg = document.getElementById('dlgCodigoVinculo');
  if (dlg) dlg.remove();
  dlg = document.createElement('dialog');
  dlg.id = 'dlgCodigoVinculo';
  dlg.className = 'sumetec-acceso';
  dlg.style.cssText = 'width:100%;height:100%;max-width:none;max-height:none;margin:0;';   // pantalla completa como las demás pantallas «sumetec-acceso» (un <dialog> sin ancho se encoge y deja un hueco a la derecha)
  dlg.innerHTML = '<form method="dialog" style="display:flex;flex-direction:column;gap:12px;text-align:center;box-sizing:border-box;width:100%;max-width:440px;margin:0 auto;padding:max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))">'
    + '<h2 style="margin:0;text-align:center">Vincular otro teléfono</h2>'
    + '<p style="margin:0;font-size:13px;opacity:.8">Elige la app del teléfono nuevo. Escanea el QR con ese teléfono (o escribe el código). Vale 10 minutos y sirve una sola vez.</p>'
    + '<select id="vinculoApp" aria-label="App a vincular" style="padding:10px;border-radius:10px">'
    + _VINCULO_APPS_.map(a => '<option value="' + a.clave + '">' + a.nombre + '</option>').join('') + '</select>'
    + '<div id="vinculoResultado" role="status" aria-live="polite" style="min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px"><small>Generando código…</small></div>'
    + '<div style="display:flex;gap:8px"><button type="button" id="vinculoNuevo" class="btn" style="flex:1">Código nuevo</button><button value="cerrar" class="btn" style="flex:1">Cerrar</button></div>'
    + '</form>';
  document.body.appendChild(dlg);
  dlg.showModal();
  let reloj = null, codigoActual = null, expira = 0;
  const caja = () => dlg.querySelector('#vinculoResultado');
  const pintar = () => {
    if (!codigoActual) return;
    const app = _VINCULO_APPS_.find(a => a.clave === dlg.querySelector('#vinculoApp').value) || _VINCULO_APPS_[0];
    const quedan = Math.max(0, Math.round((expira - Date.now()) / 1000));
    const agrupado = String(codigoActual).replace(/(.{4})(.{4})/, '$1 $2');
    caja().innerHTML = '<div style="width:200px;max-width:70vw">' + _svgQrVinculo_(_urlVinculoApp_(app, codigoActual)) + '</div>'
      + '<div style="font-size:30px;font-weight:800;letter-spacing:5px;font-family:monospace" data-codigo-vinculo>' + agrupado + '</div>'
      + '<small>' + (quedan > 0 ? 'Vence en ' + Math.floor(quedan / 60) + ':' + String(quedan % 60).padStart(2, '0') : 'Venció: genera uno nuevo') + '</small>';
  };
  const pedir = async () => {
    codigoActual = null;   // el reloj repinta cada segundo: sin esto volvía a dibujar el código ANTERIOR mientras llegaba el nuevo
    caja().innerHTML = '<small>Generando código…</small>';
    let r;
    try { r = await _sumetecPostPermiso('direccion', { tipo: 'generar_codigo_vinculo' }); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    if (!r || !r.ok || !r.codigo) {
      codigoActual = null;
      caja().innerHTML = '<small style="color:#c0392b">' + _escPermiso_(r && (r.sinRed ? 'Sin señal: necesitas internet para generar el código.' : r.error) || 'No se pudo generar el código.') + '</small>';
      return;
    }
    codigoActual = r.codigo; expira = Number(r.expira) || (Date.now() + 600000);
    pintar();
  };
  dlg.querySelector('#vinculoApp').onchange = pintar;
  dlg.querySelector('#vinculoNuevo').onclick = pedir;
  reloj = setInterval(pintar, 1000);
  dlg.addEventListener('close', () => { clearInterval(reloj); dlg.remove(); }, { once: true });
  await pedir();
}
