// Dirección → «Borrar datos de todas las apps» (2026-11-20, pedido de Miguel).
// UNA orden borra los datos locales de los teléfonos vinculados (no el vínculo, PIN ni huella; nada del servidor). Reglas:
//  - Ordenar pide el código de 6 dígitos de UN solo uso que genera el ERP (Administración → «Código para borrado remoto») y escribir BORRAR TODO.
//  - Hay una cuenta atrás (10 min) para cancelar. Un teléfono con cosas sin enviar NO se borra: aquí aparece «En espera» y se decide
//    Revisar (seguir esperando) o Forzar (descartar lo pendiente; otro código del ERP).
//  - La pantalla es la bitácora: quién ordenó, y qué teléfonos ya confirmaron. El servidor lo valida todo (solo Dirección puede ordenar).

const _BORRADO_ESTADOS_ = { PENDIENTE: 'Esperando la hora', EN_ESPERA: 'En espera: tiene pendientes', LISTO: 'Listo para borrar', BORRADO: 'Borrado ✔' };

async function _borradoPost_(cuerpo) {
  let r;
  try { r = await _sumetecPostPermiso('direccion', cuerpo); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  if (r && r.sinRed) return { ok: false, error: 'Sin señal: necesitas internet.' };
  return r || { ok: false, error: 'Sin respuesta del servidor.' };
}
function _borradoEsc_(t) { return typeof _escPermiso_ === 'function' ? _escPermiso_(t) : String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function borradoRemotoDireccion() {
  let dlg = document.getElementById('dlgBorradoRemoto');
  if (dlg) dlg.remove();
  dlg = document.createElement('dialog');
  dlg.id = 'dlgBorradoRemoto';
  dlg.className = 'sumetec-acceso';
  dlg.style.cssText = 'width:100%;height:100%;max-width:none;max-height:none;margin:0;';
  dlg.innerHTML = '<form method="dialog" style="display:flex;flex-direction:column;gap:12px;box-sizing:border-box;width:100%;max-width:480px;margin:0 auto;padding:max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))">'
    + '<h2 style="margin:0;text-align:center">Borrar datos de todas las apps</h2>'
    + '<div id="borradoCuerpo" role="status" aria-live="polite"><small>Consultando…</small></div>'
    + '<button value="cerrar" class="btn">Cerrar</button></form>';
  document.body.appendChild(dlg);
  dlg.showModal();
  const cuerpo = () => dlg.querySelector('#borradoCuerpo');
  let ultima = null, reloj = null, ocupado = false, mostrando = '';
  const faltaSeg = o => Math.max(0, Math.round((o.desde - (Date.now() - (o._desfase || 0))) / 1000));
  const textoFalta = o => { const f = faltaSeg(o); return f > 0 ? 'Empieza en ' + Math.floor(f / 60) + ':' + String(f % 60).padStart(2, '0') + ' (aún se puede cancelar).' : 'En marcha: cada teléfono borra al abrir la app o con señal.'; };
  const aviso = (m, error) => { const a = dlg.querySelector('#borradoAviso'); if (a) { a.textContent = m || ''; a.style.color = error ? '#c0392b' : 'inherit'; } };
  const pintarSinOrden = () => {
    mostrando = 'form';
    cuerpo().innerHTML = '<p style="margin:0;font-size:13px;opacity:.85">Borra las copias guardadas en cada teléfono vinculado (colas, borradores, cachés). La app sigue vinculada y todo lo ya enviado sigue en el servidor. Si un teléfono tiene cosas sin enviar, no se borra hasta que tú decidas.</p>'
      + '<p style="margin:8px 0 0;font-size:13px">1. En el ERP genera el <b>código para borrado remoto</b> (vale 10 min, un solo uso).</p>'
      + '<input id="borradoCodigo" inputmode="numeric" maxlength="6" placeholder="Código de 6 dígitos del ERP" autocomplete="off" style="padding:10px;border-radius:10px;margin-top:6px;width:100%;box-sizing:border-box">'
      + '<p style="margin:8px 0 0;font-size:13px">2. Escribe <b>BORRAR TODO</b>.</p>'
      + '<input id="borradoFrase" placeholder="BORRAR TODO" autocomplete="off" style="padding:10px;border-radius:10px;margin-top:6px;width:100%;box-sizing:border-box">'
      + '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:8px"><input type="checkbox" id="borradoIncluir"> Borrar también este teléfono de Dirección</label>'
      + '<button type="button" id="borradoOrdenar" class="btn" style="margin-top:10px;background:#b3261e;color:#fff">Ordenar el borrado</button>'
      + '<small id="borradoAviso" style="display:block;margin-top:6px"></small>';
    dlg.querySelector('#borradoOrdenar').onclick = async () => {
      if (ocupado) return; ocupado = true; aviso('Enviando la orden…');
      const r = await _borradoPost_({ tipo: 'borrado_ordenar', codigoAuth: dlg.querySelector('#borradoCodigo').value.trim(), frase: dlg.querySelector('#borradoFrase').value, incluirDireccion: dlg.querySelector('#borradoIncluir').checked });
      ocupado = false;
      if (!r.ok) { aviso(r.error || 'No se pudo dar la orden.', true); return; }
      ultima = r.orden; pintarOrden();
    };
  };
  const pintarOrden = () => {
    const o = ultima; if (!o) { pintarSinOrden(); return; }
    mostrando = 'orden';
    const activa = o.estado === 'PROGRAMADA';
    const estado = { CERRADA: 'Borrado confirmado por todas las apps.', CANCELADA: 'Orden cancelada.', VENCIDA: 'Orden vencida.', REEMPLAZADA: 'Orden reemplazada.' };
    const previo = (dlg.querySelector('#borradoAviso') || {}).textContent || '';
    const filas = (o.equipos || []).map(e => '<tr><td>' + _borradoEsc_(e.nombre) + ' <small>(' + _borradoEsc_(e.app) + ')</small></td><td>' + _borradoEsc_(_BORRADO_ESTADOS_[e.estado] || e.estado)
      + (activa && e.estado === 'EN_ESPERA' ? ' <small>(' + e.pendientes + ')</small><br><button type="button" class="btn" data-decidir="REVISAR" data-id="' + _borradoEsc_(e.dispositivo) + '" data-app="' + _borradoEsc_(e.app) + '">Revisar</button> <button type="button" class="btn" data-decidir="FORZAR" data-id="' + _borradoEsc_(e.dispositivo) + '" data-app="' + _borradoEsc_(e.app) + '" style="background:#b3261e;color:#fff">Forzar</button>' : '')
      + (e.decision === 'FORZAR' && e.estado !== 'BORRADO' ? ' <small>Forzado: se descarta lo pendiente</small>' : '') + '</td></tr>').join('');
    cuerpo().innerHTML = '<p style="margin:0;font-size:13px">Orden <b>' + _borradoEsc_(o.id) + '</b> de ' + _borradoEsc_(o.ordeno) + '. <span id="borradoFaltan">' + (activa ? textoFalta(o) : _borradoEsc_(estado[o.estado] || o.estado)) + '</span></p>'
      + '<table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:8px"><tbody>' + filas + '</tbody></table>'
      + (activa ? '<p style="margin:8px 0 0;font-size:12px;opacity:.8">«Revisar» espera a que la app envíe lo pendiente. «Forzar» lo descarta y pide otro código del ERP.</p>'
        + '<button type="button" id="borradoCancelar" class="btn" style="margin-top:8px">Cancelar la orden</button>'
        : '<button type="button" id="borradoNueva" class="btn" style="margin-top:8px">Preparar otra orden</button>')
      + '<small id="borradoAviso" style="display:block;margin-top:6px"></small>';
    if (previo) aviso(previo);
    if (!activa) { dlg.querySelector('#borradoNueva').onclick = pintarSinOrden; return; }
    dlg.querySelector('#borradoCancelar').onclick = async () => {
      if (!(await sumetecConfirmar('¿Cancelar la orden de borrado? Los teléfonos que aún no borraron ya no lo harán.'))) return;
      const r = await _borradoPost_({ tipo: 'borrado_cancelar', id: o.id });
      if (!r.ok) { aviso(r.error, true); return; }
      await refrescar();
    };
    dlg.querySelectorAll('[data-decidir]').forEach(b => b.onclick = async () => {
      const decision = b.dataset.decidir; let codigo = '';
      if (decision === 'FORZAR') {
        if (!(await sumetecConfirmar('Forzar descarta lo que este teléfono tiene sin enviar. No se puede deshacer. ¿Continuar?'))) return;
        codigo = await sumetecPedirTexto('Código de 6 dígitos nuevo generado en el ERP (borrado remoto):');
        if (!codigo) return;
      }
      const r = await _borradoPost_({ tipo: 'borrado_decidir', id: o.id, dispositivo: b.dataset.id, appDestino: b.dataset.app, decision, codigoAuth: String(codigo).trim() });
      aviso(r.ok ? (decision === 'FORZAR' ? 'Listo: ese teléfono borrará todo en cuanto abra la app.' : 'Se queda esperando a que envíe lo pendiente.') : (r.error || 'No se pudo.'), !r.ok);
    });
  };
  const refrescar = async () => {
    if (ocupado) return;
    const anterior = ultima;
    const r = await _borradoPost_({ tipo: 'borrado_ver' });
    if (ocupado || anterior !== ultima || !dlg.open) return;
    if (!r.ok) {
      if (mostrando) aviso(r.error || 'No se pudo consultar.', true);
      else cuerpo().innerHTML = '<small style="color:#c0392b">' + _borradoEsc_(r.error || 'No se pudo consultar.') + '</small>';
      return;
    }
    ultima = r.orden; if (ultima) ultima._desfase = Date.now() - ultima.ahora;
    if (mostrando === 'form' && ultima?.estado !== 'PROGRAMADA') return;
    pintarOrden();
  };
  reloj = setInterval(() => { const f = dlg.querySelector('#borradoFaltan'); if (ultima?.estado === 'PROGRAMADA' && f) f.textContent = textoFalta(ultima); }, 1000);
  const sondeo = setInterval(refrescar, 8000);
  dlg.addEventListener('close', () => { clearInterval(reloj); clearInterval(sondeo); dlg.remove(); }, { once: true });
  await refrescar();
}
