import {createState,loadState,saveState,addThread,addInstruction,prepareDraft,editDraft,saveDraftEdit,reviewDraft,summarize,setComposerDraft,getComposerDraft,parseBackup,replaceFromBackup,updateFollowup,followupAgenda,PREIMPORT_KEY} from './model.mjs';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let mode='work',state,view='chat',blockedStorage=false,toastTimer,canWrite=false,releaseWriter,importedSpaces;
// Mantener el candado durante toda la página evita la carrera de leer y después sobrescribir localStorage.
await new Promise(resolve=>{
  if(!navigator.locks?.request){resolve();return;}
  navigator.locks.request('sumetec-asistente:writer',{ifAvailable:true},lock=>{
    canWrite=!!lock;resolve();
    if(lock)return new Promise(release=>{releaseWriter=release;});
  }).catch(()=>resolve());
});
try{mode=sessionStorage.getItem('sumetec-asistente:mode')==='demo'?'demo':'work';state=loadState(localStorage,mode);}catch(error){state=createState();blockedStorage=true;showStorageError(error.message);}

function requireWriter(){if(canWrite)return true;toast('Esta ventana es de consulta. Cierra la otra ventana y pulsa Retomar edición.');return false;}
function reflectWriter(){
  $('#writer-warning').hidden=canWrite;
  $('#writer-message').textContent=navigator.locks?.request?'Otra ventana de Asistente está editando. Aquí puedes consultar; para escribir, cierra la otra ventana y retoma la edición.':'Este navegador no permite proteger la escritura entre ventanas. Usa una versión actual de Chrome, Edge o Safari para editar. Puedes consultar y exportar tus datos.';
  const editable=canWrite&&!blockedStorage;
  document.querySelectorAll('[data-write],#instruction,#draft-form input,#draft-form textarea,#followup-form input,#followup-form select').forEach(control=>{control.disabled=!editable;});
  document.querySelectorAll('[data-action="import"]').forEach(control=>{control.disabled=!canWrite;});
  if(!canWrite)$('#save-state').textContent='Consulta · edición bloqueada';
}

function showStorageError(message){$('#storage-warning').hidden=false;$('#storage-warning').textContent=message;$('#save-state').textContent='Sin guardar';}
function persist(){
  if(!canWrite)return false;
  if(blockedStorage){showStorageError('El historial anterior no se puede leer. No se sobrescribirá: exporta un respaldo y conserva esta pestaña.');return false;}
  const result=saveState(localStorage,state);
  if(!result.ok){showStorageError(result.error);return false;}
  $('#storage-warning').hidden=true;$('#save-state').textContent='Guardado en este navegador';return true;
}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4500);}
function threadFor(id){return state.threads.find(t=>t.id===id);}
function currentThread(){return threadFor(state.selectedThread);}
function time(value){const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});}
function setView(next){view=['chat','mail','summary'].includes(next)?next:'chat';render();}
function draftCard(draft){return `<button class="draft-card" data-draft="${esc(draft.id)}"><small>${draft.reviewed?'REVISADO POR TI':'BORRADOR · SIN ENVIAR'}</small><strong>${esc(draft.subject)}</strong><p>${esc(draft.to)}</p><span>Abrir borrador →</span></button>`;}
function empty(title,body,button=''){return `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(body)}</p>${button}</div>`;}

function render(){
  for(const name of ['chat','mail','summary'])$(`#${name}-view`).hidden=name!==view;
  document.querySelectorAll('[data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===view);if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('#page-title').textContent={chat:'Tu asistente comercial',mail:'Correos y proveedores',summary:'Resumen comercial'}[view];
  $('#mail-count').textContent=state.threads.length;$('#draft-count').textContent=state.drafts.length;
  $('.modebar').classList.toggle('demo',state.mode==='demo');
  $('#mode-label').textContent=state.mode==='demo'?'Ejemplos de prueba':'Tu espacio de trabajo';
  $('#mode-description').textContent=state.mode==='demo'?'Datos ilustrativos. No hay correos ni cotizaciones reales.':'Gmail e IA pendientes. Tus indicaciones se conservan aquí.';
  $('#mode-toggle').textContent=state.mode==='demo'?'Volver a mi trabajo →':'Probar con ejemplos →';
  $('#context-select').innerHTML='<option value="">Conversación general</option>'+state.threads.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  $('#context-select').value=state.selectedThread||'';
  $('#instruction').value=getComposerDraft(state,state.selectedThread);
  $('[data-action="open-context"]').disabled=!currentThread();
  renderChat();renderReview();renderMail();renderSummary();
  reflectWriter();
}

function renderChat(){
  const messages=state.messages.filter(m=>(m.threadId||null)===(state.selectedThread||null));
  const thread=currentThread();
  if(!messages.length){
    $('#chat-log').innerHTML=`<div class="welcome"><div class="assistant-mark" aria-hidden="true"><img src="icons/asistente-192.png" alt=""></div><h2>${thread?'Un correo. Tu siguiente paso.':'¿Qué necesitas resolver hoy, Miguel?'}</h2><p>${thread?`Estás trabajando con ${esc(thread.name)}. Revisa el mensaje y prepara la pregunta que sigue.`:'Un lugar para tus proveedores, cotizaciones e indicaciones. Tú marcas el rumbo; tu asistente reúne el trabajo.'}</p><div class="suggestions"><button class="suggestion" data-action="${thread?'open-context':'add-mail'}"><span class="suggestion-icon" aria-hidden="true">✉</span><span><strong>${thread?'Revisar el correo de este proveedor':'Trabajar sobre un correo'}</strong><small>${thread?'Lee el mensaje antes de dar una indicación.':'Agrega un mensaje y conserva el contexto.'}</small></span><span class="arrow" aria-hidden="true">↗</span></button><button class="suggestion" data-template="quote"><span class="suggestion-icon" aria-hidden="true">＋</span><span><strong>Preparar una solicitud de cotización</strong><small>Precio, cantidad, condiciones y entrega a Tijuana.</small></span><span class="arrow" aria-hidden="true">↗</span></button><button class="suggestion" data-view="summary"><span class="suggestion-icon" aria-hidden="true">≡</span><span><strong>Ver qué sigue pendiente</strong><small>Revisa tus indicaciones y borradores guardados.</small></span><span class="arrow" aria-hidden="true">↗</span></button></div></div>`;
    return;
  }
  $('#chat-log').innerHTML=messages.map(m=>`<article class="message ${m.role==='user'?'user':'assistant'}"><span class="message-icon" aria-hidden="true">${m.role==='user'?'M':'S'}</span><div class="bubble"><p>${esc(m.body)}</p>${m.draftId&&state.drafts.some(d=>d.id===m.draftId)?`<button class="button subtle" data-draft="${esc(m.draftId)}">Revisar borrador →</button>`:''}<div class="message-meta"><span>${m.role==='user'?'Tú':'Asistente'}</span><span>${esc(time(m.createdAt))}</span>${m.role==='user'?'<span class="tag">En espera de conexión</span>':'<span>Respuesta del recorrido de prueba</span>'}</div></div></article>`).join('');
  $('#chat-log').scrollTop=$('#chat-log').scrollHeight;
}

function renderReview(){
  const drafts=state.drafts.filter(d=>!state.selectedThread||d.threadId===state.selectedThread);
  $('#review-count').textContent=drafts.length;
  $('#review-list').innerHTML=drafts.length?drafts.slice(0,5).map(draftCard).join(''):'<div class="empty-review"><span aria-hidden="true">▤</span><strong>Todo listo para empezar</strong><p>Cuando prepares un mensaje, podrás revisarlo aquí.</p></div>';
}

function renderMail(){
  const query=$('#mail-search').value.toLocaleLowerCase('es');
  const threads=state.threads.filter(t=>`${t.name} ${t.subject} ${t.email}`.toLocaleLowerCase('es').includes(query));
  $('#mail-list').innerHTML=threads.length?threads.map((t,i)=>`<button class="mail-card" data-thread="${esc(t.id)}"><span class="mail-avatar" aria-hidden="true">${esc(t.name.slice(0,2).toUpperCase())}</span><div><small>${esc(t.name)} <span class="source-label">${t.source==='example'?'Ejemplo':'Agregado manualmente'}</span></small><h3>${esc(t.subject)}</h3><p>${esc(t.body.slice(0,140))}${t.body.length>140?'…':''}</p></div><span aria-hidden="true">↗</span></button>`).join(''):empty(state.threads.length?'Sin coincidencias':'Tus conversaciones van aquí',state.threads.length?'Prueba con otro proveedor o asunto.':'Agrega un correo manualmente o prueba con ejemplos. La conexión con Gmail está pendiente.','<button class="button primary" data-action="add-mail">Agregar un correo</button>');
}

function renderSummary(){
  const summary=summarize(state);
  $('#summary-stats').innerHTML=[[summary.threads,'Conversaciones'],[summary.drafts,'Borradores sin enviar'],[summary.pending,'Indicaciones pendientes']].map(([value,label])=>`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  $('#summary-drafts').innerHTML=state.drafts.length?state.drafts.map(draftCard).join(''):empty('Sin borradores todavía','Prepara una pregunta desde el chat o un correo.');
  const tasks=state.messages.filter(m=>m.role==='user'&&m.status==='pending').slice().reverse();
  $('#summary-tasks').innerHTML=tasks.length?tasks.map(m=>`<button class="task-row" data-task-thread="${esc(m.threadId||'')}"><p>${esc(m.body)}</p><span>${esc(threadFor(m.threadId)?.name||'Conversación general')} · En espera de IA</span></button>`).join(''):empty('Sin indicaciones pendientes','Las instrucciones que escribas aparecerán aquí.');
  const labels={pending:'Pendiente',waiting:'Esperando proveedor',resolved:'Resuelto'};
  const agenda=followupAgenda(state,{status:$('#followup-filter').value});
  $('#followup-list').innerHTML=agenda.length?agenda.map(item=>`<article class="followup-card ${item.overdue?'overdue':''}"><div><strong>${esc(item.thread.name)}</strong><p>${esc(item.thread.subject)}</p><span class="tag">${labels[item.status]}</span><p class="followup-meta">${item.nextContactAt?`${item.overdue?'Contacto vencido':'Próximo contacto'}: ${esc(item.nextContactAt)}`:'Sin fecha de próximo contacto'} · ${item.daysOpen===null?'Fecha de captura no disponible':`${item.daysOpen} días desde la captura`}</p></div><div class="followup-actions"><button class="button subtle" data-followup-thread="${esc(item.thread.id)}">Abrir hilo</button><button class="button subtle" data-edit-followup="${esc(item.thread.id)}" data-write>Editar seguimiento</button></div></article>`).join(''):empty('Sin proveedores en este filtro','Agrega un correo o cambia el estado elegido.');
}

function modal(title,html){
  if(!closeModal())return;
  $('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal').showModal();reflectWriter();
}
function closeModal(){
  const draftForm=$('#draft-form');
  if(draftForm?.dataset.dirty==='true'&&!saveDraftForm(false))return false;
  $('#modal').close();return true;
}
function showConnections(){modal('Conexiones del asistente',`<p class="dialog-hint">Esta primera versión permite organizar el trabajo y probar el recorrido. Todavía no lee tu bandeja ni ejecuta una IA.</p><div class="connection-row"><div><strong>Gmail</strong><p>Consultar hilos, solicitar cotizaciones y dar seguimiento.</p></div><span>Pendiente</span></div><div class="connection-row"><div><strong>Inteligencia artificial</strong><p>Interpretar tus indicaciones y preparar respuestas con contexto.</p></div><span>Pendiente</span></div><div class="connection-row"><div><strong>Historial local</strong><p>Instrucciones y borradores en este navegador. No se sincroniza entre dispositivos.</p></div><span>Local</span></div><p class="dialog-hint">La conexión real necesita un servicio seguro y autorización de tu cuenta. No pegues contraseñas ni claves privadas en el chat.</p><div class="dialog-actions"><button class="button subtle" data-action="close-modal">Entendido</button><button class="button primary" data-action="demo-from-modal">Probar el recorrido</button></div>`);}
function showRules(){modal('Así trabajará tu asistente',`<p class="dialog-hint">Reglas acordadas para SUMETEC. Definen el alcance de la futura conexión real.</p><ul class="rules-list"><li>Buscar clientes en Tijuana y alrededores.</li><li>Investigar proveedores de México, Estados Unidos y China.</li><li>Solicitar cotizaciones y dar seguimiento a proveedores.</li><li>Presentarte precios de venta y compromisos para revisión.</li><li>Comparar productos equivalentes y distinguir precios, estimaciones y cotizaciones confirmadas.</li></ul><div class="notice">Hoy puedes guardar indicaciones, preparar plantillas y revisar borradores. Los envíos y la interpretación con IA aún no están activos.</div><div class="dialog-actions"><button class="button primary" data-action="close-modal">Entendido</button></div>`);}

function showAddMail(){
  if(!requireWriter())return;
  modal('Agregar una conversación',`<p class="dialog-hint">Copia un correo para trabajar sobre él. Se guardará ${state.mode==='demo'?'en los ejemplos de prueba':'en tu espacio de trabajo de este navegador'}.</p><form id="mail-form"><label class="field">Nombre del proveedor<input name="name" required maxlength="120" autocomplete="organization" placeholder="Nombre de la empresa"></label><label class="field">Correo del proveedor<input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="ventas@proveedor.com"></label><label class="field">Asunto<input name="subject" required maxlength="200" placeholder="Cotización o consulta"></label><label class="field">Mensaje recibido<textarea name="body" required maxlength="20000" placeholder="Pega aquí el texto del correo…"></textarea></label><p id="form-error" class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="button subtle" data-action="close-modal">Cancelar</button><button type="submit" class="button primary">Guardar conversación</button></div></form>`);
}
function showThread(id){
  const t=threadFor(id);if(!t)return;
  modal(t.subject,`<p class="mail-details"><strong>${esc(t.name)}</strong><br>${esc(t.email)}<br>${t.source==='example'?'Ejemplo ilustrativo':'Agregado manualmente; no sincronizado con Gmail'}</p><div class="mail-body">${esc(t.body)}</div><div class="dialog-actions"><button class="button subtle" data-use-thread="${esc(t.id)}" data-next-template="shipping">Preguntar por el envío</button><button class="button primary" data-use-thread="${esc(t.id)}">Dar una indicación →</button></div>`);
}

function showDraft(id){
  const draft=state.drafts.find(d=>d.id===id);if(!draft)return;
  modal('Revisar borrador',`<div class="notice">Plantilla editable, sin IA. ${state.mode==='demo'?'Estás en el espacio de ejemplos. ':''}Gmail está pendiente de conectar; este mensaje no se ha enviado.</div><form id="draft-form" data-id="${esc(draft.id)}" data-dirty="false"><label class="field">Para<span class="readonly">${esc(draft.to)}</span></label><label class="field">Asunto<input name="subject" required maxlength="200" value="${esc(draft.subject)}"></label><label class="field">Mensaje<textarea name="body" class="long" required maxlength="20000">${esc(draft.body)}</textarea></label><p id="draft-error" class="error" role="alert"></p><div class="dialog-actions"><button type="submit" class="button subtle">Guardar cambios</button><button type="button" class="button subtle" data-action="copy-draft">Copiar texto</button><button type="button" class="button primary" data-action="review-draft">Marcar revisado</button><button type="button" class="button subtle" data-action="export">Exportar respaldo</button></div><p class="footnote">Los cambios se guardan al escribir. Si aparece «Sin guardar», conserva esta ventana y exporta un respaldo. Marcar revisado no envía el correo.</p></form>`);
  $('#draft-form')?.addEventListener('input',()=>{
    if(!requireWriter())return;
    const form=$('#draft-form'),values=new FormData(form);
    saveDraftEdit(state,form.dataset.id,{subject:values.get('subject'),body:values.get('body')});
    form.dataset.dirty=String(!persist());renderReview();renderSummary();reflectWriter();
  });
  $('#draft-form [type="submit"]').disabled=!canWrite||blockedStorage;
  $('[data-action="review-draft"]').disabled=!canWrite||blockedStorage;
}
function saveDraftForm(notify=true){
  const form=$('#draft-form');if(!form)return false;
  if(!requireWriter())return false;
  if(!form.reportValidity())return false;
  try{
    if(form.dataset.dirty==='true'){const values=new FormData(form);editDraft(state,form.dataset.id,{subject:values.get('subject'),body:values.get('body')});form.dataset.dirty='false';}
    const saved=persist();form.dataset.dirty=String(!saved);render();if(notify)toast(saved?'Borrador guardado. No se ha enviado.':'Borrador en memoria: exporta un respaldo.');return saved;
  }catch(error){$('#draft-error').textContent=error.message;return false;}
}
function makeDraft(action,open=true){
  if(!requireWriter())return null;
  if(!currentThread()){toast('Selecciona o agrega primero el correo del proveedor.');setView('mail');return null;}
  const draft=prepareDraft(state,state.selectedThread,action);persist();render();if(open)showDraft(draft.id);return draft;
}
function sendInstruction(){
  if(!requireWriter())return;
  const textarea=$('#instruction'),value=textarea.value.trim();if(!value)return;
  try{
    addInstruction(state,state.selectedThread,value);
    if(state.mode==='demo'){
      let response='Guardé tu indicación en los ejemplos. En la versión conectada, el agente la interpretará usando el correo elegido. Esta prueba no usa IA ni envía mensajes.',draft;
      const normalized=value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      const action=/envio|entrega|transporte/.test(normalized)?'shipping':/precio|descuento|volumen/.test(normalized)?'price':/cotiz/.test(normalized)?'quote':/seguimiento|respond/.test(normalized)?'followup':null;
      if(action&&currentThread()){draft=prepareDraft(state,state.selectedThread,action);response=`Preparé una plantilla de ejemplo para ${currentThread().name}. Revísala y ajústala con las medidas y cantidades que correspondan. No se ha enviado ningún correo.`;}
      if(/resumen|resume/.test(normalized)){const summary=summarize(state);response=`En estos ejemplos tienes ${summary.threads} conversaciones y ${summary.drafts} borradores sin enviar. No hay precios confirmados ni un costo de importación calculado. Puedes abrir el Resumen para revisar cada pendiente.`;}
      state.messages.push({id:crypto.randomUUID(),role:'assistant',threadId:state.selectedThread||null,body:response,draftId:draft?.id||null,createdAt:new Date().toISOString()});
    }
    textarea.value='';setComposerDraft(state,state.selectedThread,'');const saved=persist();render();if(state.mode==='work')toast(saved?'Indicación guardada como pendiente. La IA aún no está conectada.':'Indicación en memoria: exporta un respaldo.');
  }catch(error){toast(error.message);}
}

function toggleDemo(){
  if(!closeModal())return;
  if(canWrite&&!persist()){toast('Exporta un respaldo antes de cambiar de espacio. Hay datos sin guardar.');return;}
  mode=state.mode==='demo'?'work':'demo';
  try{state=loadState(localStorage,mode);sessionStorage.setItem('sumetec-asistente:mode',mode);}catch(error){showStorageError(error.message);return;}
  view='chat';if(canWrite)persist();render();toast(mode==='demo'?'Ejemplos de prueba. Tu trabajo propio sigue separado.':'Volviste a tu espacio de trabajo.');
}
function download(filename,content,type='application/json'){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
function exportBackup(){
  const raw={};try{for(const space of ['work','demo'])raw[space]=localStorage.getItem(`sumetec-asistente:${space}:v1`);}catch{/* El estado en memoria se conserva incluso si el almacenamiento está bloqueado. */}
  download(`sumetec-asistente-respaldo-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({exportedAt:new Date().toISOString(),current:state,stored:raw},null,2));toast('Respaldo preparado para descargar.');
}

function showFollowup(id){
  if(!requireWriter())return;
  const thread=threadFor(id);if(!thread)return;
  const followup=thread.followup||{status:'pending',nextContactAt:''};
  modal('Seguimiento del proveedor',`<p class="dialog-hint">${esc(thread.name)} · ${esc(thread.subject)}. Esta agenda es manual; no envía correos ni crea recordatorios externos.</p><form id="followup-form" data-id="${esc(thread.id)}"><label class="field">Estado<select name="status"><option value="pending">Pendiente</option><option value="waiting">Esperando proveedor</option><option value="resolved">Resuelto</option></select></label><label class="field">Próximo contacto<input name="nextContactAt" type="date" value="${esc(followup.nextContactAt)}"></label><p class="footnote">La antigüedad se calcula desde que agregaste este correo a la app, no desde su recepción en Gmail.</p><p class="error" id="followup-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button subtle" data-action="export">Exportar respaldo</button><button type="button" class="button subtle" data-action="close-modal">Cancelar</button><button type="submit" class="button primary" data-write>Guardar seguimiento</button></div></form>`);
  $('#followup-form [name="status"]').value=followup.status;
}
function reflectImport(){
  const mode=$('#import-space').value,selected=importedSpaces?.[mode];
  $('#import-preview').textContent=selected?`${mode==='work'?'Trabajo propio':'Ejemplos de prueba'}: ${selected.threads.length} conversaciones, ${selected.messages.length} mensajes y ${selected.drafts.length} borradores. Se reemplazará solamente este espacio; el otro seguirá igual.`:'Selecciona un respaldo y el espacio que deseas recuperar.';
  $('[data-action="confirm-import"]').disabled=!canWrite||!selected||!$('#import-confirm').checked;
}
function showImport(){
  if(!requireWriter())return;
  importedSpaces=null;
  modal('Importar respaldo',`<p class="dialog-hint">Elige un JSON exportado por Asistente. Trabajo propio y ejemplos se recuperan en su mismo espacio. Antes de reemplazar, se comprobará una copia local del historial anterior y se preparará su descarga.</p><label class="field">Respaldo JSON<input id="backup-file" type="file" accept=".json,application/json"></label><label class="field">Espacio que se reemplazará<select id="import-space" disabled><option value="">Elige un espacio</option></select></label><p id="import-preview" class="notice"></p><label class="import-check"><input id="import-confirm" type="checkbox"> Confirmo reemplazar el espacio elegido con el historial de este respaldo.</label><p id="import-error" class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="button subtle" data-action="previous-backup">Descargar respaldo previo local</button><button type="button" class="button primary" data-action="confirm-import" disabled>Reemplazar espacio elegido</button></div><p class="footnote">La copia local previa conserva el último reemplazo. Guarda también los archivos descargados fuera de este navegador.</p>`);
  reflectImport();
  $('#backup-file').addEventListener('change',async event=>{
    importedSpaces=null;$('#import-error').textContent='';$('#import-confirm').checked=false;$('#import-space').disabled=true;reflectImport();
    const file=event.target.files[0];if(!file)return;
    try{
      if(file.size>10*1024*1024)throw Error('El respaldo supera 10 MB.');
      const parsed=parseBackup(await file.text());
      if(event.target!==$('#backup-file')||event.target.files[0]!==file)return;
      importedSpaces=parsed;$('#import-space').innerHTML='<option value="">Elige un espacio</option>'+Object.keys(parsed).map(mode=>`<option value="${mode}">${mode==='work'?'Trabajo propio':'Ejemplos de prueba'}</option>`).join('');$('#import-space').disabled=false;reflectImport();
    }catch(error){if(event.target===$('#backup-file')&&event.target.files[0]===file)$('#import-error').textContent=error.message;}
  });
  $('#import-space').addEventListener('change',()=>{$('#import-confirm').checked=false;reflectImport();});
  $('#import-confirm').addEventListener('change',reflectImport);
}
function confirmImport(){
  if(!requireWriter())return;
  const target=$('#import-space').value,selected=importedSpaces?.[target];
  if(!selected||!$('#import-confirm').checked)return;
  if(!blockedStorage&&!persist()){$('#import-error').textContent='Hay cambios sin guardar. Exporta un respaldo y resuelve el almacenamiento antes de reemplazar.';return;}
  const result=replaceFromBackup(localStorage,selected,target);
  if(!result.ok){$('#import-error').textContent=result.error;return;}
  download(`sumetec-asistente-antes-importar-${new Date().toISOString().replace(/[:.]/g,'-')}.json`,result.backup);
  if(target===mode||blockedStorage){mode=target;state=loadState(localStorage,target);blockedStorage=false;sessionStorage.setItem('sumetec-asistente:mode',mode);}
  $('#storage-warning').hidden=true;$('#save-state').textContent='Guardado en este navegador';closeModal();render();toast('Espacio restaurado. Se conservó el respaldo previo local y se preparó su descarga.');
}

document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  try{
    if(button.dataset.view){setView(button.dataset.view);return;}
    if(button.dataset.template){makeDraft(button.dataset.template);return;}
    if(button.dataset.draft){showDraft(button.dataset.draft);return;}
    if(button.dataset.thread){showThread(button.dataset.thread);return;}
    if(button.dataset.editFollowup){showFollowup(button.dataset.editFollowup);return;}
    if(button.dataset.followupThread){state.selectedThread=button.dataset.followupThread;persist();setView('chat');return;}
    if(button.hasAttribute('data-task-thread')){state.selectedThread=button.dataset.taskThread||null;persist();setView('chat');return;}
    if(button.dataset.useThread){const action=button.dataset.nextTemplate;state.selectedThread=button.dataset.useThread;persist();closeModal();setView('chat');if(action)makeDraft(action);else $('#instruction').focus();return;}
    switch(button.dataset.action){
      case 'general':state.selectedThread=null;persist();setView('chat');$('#instruction').focus();break;
      case 'add-mail':showAddMail();break;
      case 'open-context':if(currentThread())showThread(state.selectedThread);break;
      case 'connections':showConnections();break;
      case 'rules':showRules();break;
      case 'close-modal':closeModal();break;
      case 'toggle-demo':toggleDemo();break;
      case 'demo-from-modal':closeModal();if(state.mode==='demo')setView('chat');else toggleDemo();break;
      case 'export':exportBackup();break;
      case 'import':showImport();break;
      case 'confirm-import':confirmImport();break;
      case 'resume-writer':location.reload();break;
      case 'previous-backup':{const raw=localStorage.getItem(PREIMPORT_KEY);if(raw)download('sumetec-asistente-antes-importar.json',raw);else toast('Todavía no hay un reemplazo con respaldo previo en este navegador.');break;}
      case 'copy-draft':{
        if(canWrite&&!saveDraftForm(false))break;
        const form=$('#draft-form'),draft=state.drafts.find(d=>d.id===form.dataset.id);
        try{await navigator.clipboard.writeText(`Para: ${draft.to}\nAsunto: ${draft.subject}\n\n${draft.body}`);toast('Texto copiado. El correo no se ha enviado.');}
        catch{$('#draft-error').textContent='El navegador no permitió copiar. Selecciona el texto y cópialo manualmente.';}break;
      }
      case 'review-draft':{
        if(!requireWriter())break;
        if(!saveDraftForm(false))break;
        const draft=state.drafts.find(d=>d.id===$('#draft-form').dataset.id);
        try{reviewDraft(state,draft.id);}catch(error){$('#draft-error').textContent=error.message;break;}
        const saved=persist();render();toast(saved?'Borrador marcado como revisado. Sigue sin enviarse.':'Revisión en memoria: exporta un respaldo.');break;
      }
    }
  }catch(error){toast(error.message);}
});
document.addEventListener('submit',event=>{
  if(event.target.id==='chat-form'){event.preventDefault();sendInstruction();}
  if(event.target.id==='draft-form'){event.preventDefault();saveDraftForm();}
  if(event.target.id==='mail-form'){
    event.preventDefault();if(!requireWriter())return;try{const values=Object.fromEntries(new FormData(event.target));addThread(state,values);const saved=persist();closeModal();setView('chat');toast(saved?'Conversación guardada. Ya puedes darle una indicación.':'Conversación en memoria: exporta un respaldo.');}catch(error){$('#form-error').textContent=error.message;}
  }
  if(event.target.id==='followup-form'){
    event.preventDefault();if(!requireWriter())return;
    try{updateFollowup(state,event.target.dataset.id,Object.fromEntries(new FormData(event.target)));if(!persist()){$('#followup-error').textContent='Seguimiento sin guardar. Exporta un respaldo antes de salir.';return;}closeModal();render();toast('Seguimiento guardado.');}catch(error){$('#followup-error').textContent=error.message;}
  }
});
$('#context-select').addEventListener('change',event=>{state.selectedThread=event.target.value||null;persist();render();});
$('#mail-search').addEventListener('input',renderMail);
$('#followup-filter').addEventListener('change',()=>{renderSummary();reflectWriter();});
$('#instruction').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendInstruction();}});
$('#instruction').addEventListener('input',()=>{if(!canWrite)return;setComposerDraft(state,state.selectedThread,$('#instruction').value);persist();});
window.sumetecAsistenteGuardarParaActualizar=()=>{
  if(!canWrite||document.querySelector('dialog[open]'))return false;
  setComposerDraft(state,state.selectedThread,$('#instruction').value);return persist();
};
$('#modal').addEventListener('cancel',event=>{event.preventDefault();closeModal();});
window.addEventListener('storage',event=>{
  if(canWrite||event.key!==`sumetec-asistente:${mode}:v1`)return;
  try{state=loadState(localStorage,mode);$('#modal').close();render();}catch(error){showStorageError(error.message);}
});
window.addEventListener('beforeunload',event=>{if($('#save-state').textContent==='Sin guardar'||$('#draft-form')?.dataset.dirty==='true'){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{canWrite=false;releaseWriter?.();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
if(canWrite&&!blockedStorage)persist();
render();
