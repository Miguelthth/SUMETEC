export const STORAGE_PREFIX = 'sumetec-asistente:';
export const PREIMPORT_KEY = `${STORAGE_PREFIX}before-import:v1`;
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const text = (value, max = 20000) => String(value ?? '').trim().slice(0, max);
const key = mode => `${STORAGE_PREFIX}${mode}:v1`;

export function createState() {
  return {schema:1, mode:'work', threads:[], messages:[], drafts:[], selectedThread:null};
}

export function addThread(state, input) {
  const email = text(input.email, 254);
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) throw Error('Escribe un correo válido, sin saltos de línea.');
  if (!text(input.name,120) || !text(input.subject,200)) throw Error('Escribe el proveedor y el asunto.');
  const thread={id:uid(), name:text(input.name,120), email, subject:text(input.subject,200), body:text(input.body), source:'manual', createdAt:now()};
  state.threads.push(thread); state.selectedThread=thread.id;
  return thread;
}

export function createDemo() {
  const state=createState();state.mode='demo';
  addThread(state,{name:'Proveedor de ejemplo · México',email:'proveedor-mx@example.com',subject:'Cotización de tornillo hexagonal',body:'EJEMPLO. Podemos cotizar tornillo hexagonal galvanizado. Para confirmar precio necesitamos medidas, grado y cantidad. El transporte a Tijuana se cotiza por separado.'});
  addThread(state,{name:'Proveedor de ejemplo · Estados Unidos',email:'proveedor-us@example.com',subject:'Disponibilidad y entrega en San Diego',body:'EJEMPLO. Contamos con línea de tornillería métrica e imperial. Favor de enviar especificación y cantidad. La disponibilidad, el precio y el envío están pendientes de cotizar.'});
  addThread(state,{name:'Proveedor de ejemplo · China',email:'proveedor-cn@example.com',subject:'Información para cotizar por volumen',body:'EJEMPLO. Please send specifications, finish, grade and quantity. We will confirm minimum order, production time, packing and shipping terms. No price or landed cost has been confirmed.'});
  for(const thread of state.threads)thread.source='example';
  state.selectedThread=state.threads[0].id;return state;
}

export function addInstruction(state,threadId,value) {
  const body=text(value,4000);
  if(!body) throw Error('Escribe una indicación.');
  if(threadId&&!state.threads.some(t=>t.id===threadId)) throw Error('Elige una conversación disponible.');
  const message={id:uid(),threadId:threadId||null,role:'user',body,status:'pending',createdAt:now()};
  state.messages.push(message);return message;
}

export function setComposerDraft(state,threadId,value){
  if(threadId&&!state.threads.some(thread=>thread.id===threadId))throw Error('Conversación no disponible.');
  state.composerDrafts ||= {};
  const key=threadId||'general',body=String(value??'').slice(0,4000);
  if(body)state.composerDrafts[key]=body;else delete state.composerDrafts[key];
}
export function getComposerDraft(state,threadId){return state.composerDrafts?.[threadId||'general']||'';}

export const ACTIONS={
  quote:{label:'Pedir cotización',subject:'Solicitud de cotización',body:'Buen día.\n\n¿Podrían compartir su cotización indicando precio por pieza, moneda, IVA, presentación, mínimo de compra, disponibilidad y vigencia?\n\nProducto, medidas, material y grado: [completar]\nCantidad: [completar]\nDestino: Tijuana, Baja California, México.\n\nFavor de separar el transporte e indicar las condiciones de entrega y pago.\n\nGracias.\nMiguel | SUMETEC'},
  shipping:{label:'Preguntar por el envío',body:'Buen día.\n\n¿Podrían confirmar el costo y tiempo de entrega a Tijuana, Baja California, México? Favor de indicar desde dónde se embarca, condiciones de entrega y qué gastos incluye su propuesta.\n\nGracias.\nMiguel | SUMETEC'},
  price:{label:'Consultar precio por volumen',body:'Buen día.\n\n¿Manejan una mejor condición de precio por volumen? Favor de indicar las cantidades mínimas por nivel, moneda, impuestos y vigencia.\n\nEsta consulta es informativa y no confirma una compra.\n\nGracias.\nMiguel | SUMETEC'},
  followup:{label:'Dar seguimiento',body:'Buen día.\n\nLes escribo para dar seguimiento a nuestra solicitud. ¿Podrían confirmar si cuentan con la información necesaria para cotizar y cuándo podríamos recibir su propuesta?\n\nGracias.\nMiguel | SUMETEC'}
};

export function prepareDraft(state,threadId,action) {
  const thread=state.threads.find(t=>t.id===threadId), template=ACTIONS[action];
  if(!thread)throw Error('Selecciona primero el correo del proveedor.');
  if(!template)throw Error('Elige una plantilla disponible.');
  const draft={id:uid(),threadId,to:thread.email,subject:text(template.subject?`${template.subject}: ${thread.subject}`:`Re: ${thread.subject}`,200),body:template.body,action,status:'draft',reviewed:false,reviewedVersion:null,version:1,createdAt:now()};
  state.drafts.unshift(draft);return draft;
}

export function editDraft(state,id,changes) {
  const draft=state.drafts.find(d=>d.id===id);
  if(!draft)throw Error('No se encontró el borrador.');
  if(!text(changes.body))throw Error('El mensaje no puede estar vacío.');
  if(changes.subject!==undefined&&!text(changes.subject,200))throw Error('El asunto no puede estar vacío.');
  return saveDraftEdit(state,id,{subject:changes.subject===undefined?draft.subject:text(changes.subject,200),body:text(changes.body)});
}

export function saveDraftEdit(state,id,changes){
  const draft=state.drafts.find(item=>item.id===id);
  if(!draft)throw Error('No se encontró el borrador.');
  const subject=String(changes.subject??draft.subject).slice(0,300),body=String(changes.body??draft.body).slice(0,20000);
  if(subject!==draft.subject||body!==draft.body){draft.subject=subject;draft.body=body;draft.version++;draft.reviewed=false;draft.reviewedVersion=null;}
  return draft;
}
export function reviewDraft(state,id){
  const draft=state.drafts.find(item=>item.id===id);
  if(!draft||!text(draft.body)||!text(draft.subject))throw Error('El asunto y el mensaje no pueden estar vacíos.');
  if(/\[completar\]/i.test(draft.body))throw Error('Completa las medidas y cantidades antes de marcarlo revisado.');
  draft.reviewed=true;draft.reviewedVersion=draft.version;return draft;
}

const emailValid=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const dateOnly=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const timestampValid=value=>value===undefined||(typeof value==='string'&&value.length<=40&&!Number.isNaN(Date.parse(value)));
const followupValid=value=>value===undefined||(value&&typeof value==='object'&&!Array.isArray(value)&&['pending','waiting','resolved'].includes(value.status)&&(value.nextContactAt===''||dateValid(value.nextContactAt))&&timestampValid(value.updatedAt));

export function updateFollowup(state,id,changes){
  const thread=state.threads.find(item=>item.id===id);
  if(!thread)throw Error('Conversación no disponible.');
  const followup={status:changes.status,nextContactAt:changes.nextContactAt||'',updatedAt:now()};
  if(!followupValid(followup))throw Error('Elige un estado y una fecha de contacto válidos.');
  thread.followup=followup;return followup;
}
export function followupAgenda(state,{today=dateOnly(new Date()),status='open'}={}){
  return state.threads.map(thread=>{
    const followup=thread.followup||{status:'pending',nextContactAt:''};
    const created=dateOnly(thread.createdAt),daysOpen=created?Math.max(0,Math.floor((Date.parse(today+'T12:00:00Z')-Date.parse(created+'T12:00:00Z'))/86400000)):null;
    return {thread,...followup,daysOpen,overdue:followup.status!=='resolved'&&!!followup.nextContactAt&&followup.nextContactAt<today};
  }).filter(item=>status==='all'||(status==='open'?item.status!=='resolved':item.status===status)).sort((a,b)=>(a.nextContactAt||'9999').localeCompare(b.nextContactAt||'9999')||(a.thread.createdAt||'').localeCompare(b.thread.createdAt||'')||a.thread.name.localeCompare(b.thread.name));
}

function valid(state,mode) {
  if(!state||state.schema!==1||state.mode!==mode||!['work','demo'].includes(mode))return false;
  if(!['threads','messages','drafts'].every(k=>Array.isArray(state[k])&&state[k].length<10000))return false;
  const str=(obj,k,max=20000)=>typeof obj?.[k]==='string'&&obj[k].length<=max;
  const unique=items=>new Set(items.map(item=>item?.id)).size===items.length;
  const idValid=value=>typeof value==='string'&&value.length>0&&value.length<=100&&!['general','__proto__','constructor','prototype'].includes(value);
  if(!['threads','messages','drafts'].every(key=>unique(state[key])))return false;
  if(!state.threads.every(t=>idValid(t?.id)&&str(t,'name',120)&&!!t.name.trim()&&emailValid(t.email)&&str(t,'subject',200)&&!!t.subject.trim()&&str(t,'body')&&['manual','example'].includes(t.source)&&timestampValid(t.createdAt)&&followupValid(t.followup)&&(t.source!=='example'||t.email.endsWith('@example.com'))))return false;
  const ids=new Set(state.threads.map(t=>t.id));
  const draftIds=new Set(state.drafts.map(d=>d?.id));
  if(state.composerDrafts!==undefined&&(!state.composerDrafts||Array.isArray(state.composerDrafts)||typeof state.composerDrafts!=='object'||!Object.entries(state.composerDrafts).every(([key,value])=>(key==='general'||ids.has(key))&&typeof value==='string'&&value.length<=4000)))return false;
  return state.messages.every(m=>idValid(m?.id)&&str(m,'body',4000)&&['user','assistant'].includes(m.role)&&(m.threadId===null||ids.has(m.threadId))&&(m.role==='user'?m.status==='pending':m.status===undefined)&&(!m.draftId||draftIds.has(m.draftId))&&timestampValid(m.createdAt))&&state.drafts.every(d=>idValid(d?.id)&&emailValid(d.to)&&str(d,'subject',300)&&str(d,'body')&&ids.has(d.threadId)&&d.to===state.threads.find(t=>t.id===d.threadId)?.email&&d.status==='draft'&&Object.hasOwn(ACTIONS,d.action)&&typeof d.reviewed==='boolean'&&Number.isInteger(d.version)&&d.version>0&&(d.reviewedVersion===undefined||d.reviewedVersion===(d.reviewed?d.version:null))&&timestampValid(d.createdAt))&&(state.selectedThread===null||ids.has(state.selectedThread));
}

function migrateState(state){
  if(state?.schema===1&&Array.isArray(state.threads))for(const thread of state.threads){
    if(thread?.source==='example'&&emailValid(thread.email)&&!thread.email.endsWith('@example.com'))thread.source='manual';
  }
  return state;
}

export function loadState(storage,mode='work') {
  const raw=storage.getItem(key(mode));
  if(!raw)return mode==='demo'?createDemo():createState();
  const state=migrateState(JSON.parse(raw));
  if(!valid(state,mode))throw Error('El historial guardado no es válido. Exporta un respaldo antes de recuperarlo.');
  for(const draft of state.drafts)draft.reviewedVersion=draft.reviewed?draft.version:null;
  return state;
}

export function saveState(storage,state) {
  try {
    if(!valid(state,state.mode))throw Error('Estado no válido');
    const raw=JSON.stringify(state);storage.setItem(key(state.mode),raw);
    if(storage.getItem(key(state.mode))!==raw)throw Error('No se pudo comprobar la escritura');
    return {ok:true};
  }catch{return {ok:false,error:'No se pudo guardar en este navegador. Conserva esta pestaña y exporta un respaldo.'};}
}

export function parseBackup(content){
  if(typeof content!=='string'||content.length>10*1024*1024)throw Error('El respaldo no es válido o supera 10 MB.');
  let backup;try{backup=JSON.parse(content);}catch{throw Error('El respaldo no contiene JSON válido.');}
  if(!backup||typeof backup!=='object'||Array.isArray(backup)||(!backup.current&&!backup.stored))throw Error('El respaldo no tiene un historial válido.');
  const spaces={};
  if(backup.stored!==undefined){
    if(!backup.stored||typeof backup.stored!=='object'||Array.isArray(backup.stored)||Object.keys(backup.stored).some(mode=>!['work','demo'].includes(mode)))throw Error('Los espacios del respaldo no son válidos.');
    for(const mode of ['work','demo']){
      const raw=backup.stored[mode];if(raw==null)continue;
      if(typeof raw!=='string')throw Error('El historial almacenado no es válido.');
      let state;try{state=migrateState(JSON.parse(raw));}catch{throw Error(`El historial de ${mode} no es válido.`);}
      if(!valid(state,mode))throw Error(`El historial de ${mode} no es válido.`);spaces[mode]=state;
    }
  }
  if(Object.hasOwn(backup,'current')){migrateState(backup.current);if(!valid(backup.current,backup.current?.mode))throw Error('El historial actual del respaldo no es válido.');spaces[backup.current.mode]=backup.current;}
  if(!Object.keys(spaces).length)throw Error('El respaldo no contiene un historial válido.');
  for(const state of Object.values(spaces))for(const draft of state.drafts)draft.reviewedVersion=draft.reviewed?draft.version:null;
  return spaces;
}

export function replaceFromBackup(storage,imported,mode){
  if(!valid(imported,mode))return {ok:false,error:'El historial elegido no es válido para ese espacio.'};
  let previous;
  try{
    const stored={};for(const space of ['work','demo'])stored[space]=storage.getItem(key(space));
    const backup=JSON.stringify({exportedAt:now(),stored});
    storage.setItem(PREIMPORT_KEY,backup);
    if(storage.getItem(PREIMPORT_KEY)!==backup)throw Error('No se pudo comprobar el respaldo previo.');
    previous=stored[mode];
    const raw=JSON.stringify(imported);storage.setItem(key(mode),raw);
    if(storage.getItem(key(mode))!==raw)throw Error('No se pudo comprobar la restauración.');
    return {ok:true,backup};
  }catch{
    if(previous!==undefined)try{if(previous===null)storage.removeItem(key(mode));else storage.setItem(key(mode),previous);}catch{/* El respaldo previo conserva el original. */}
    return {ok:false,error:'No se pudo importar con un respaldo previo comprobado. Conserva el archivo; no cierres los datos sin guardar.'};
  }
}

export function summarize(state) {
  return {threads:state.threads.length,drafts:state.drafts.length,pending:state.messages.filter(m=>m.role==='user'&&m.status==='pending').length,sent:0,items:state.drafts.map(d=>({id:d.id,threadId:d.threadId,label:d.subject,to:d.to,reviewed:d.reviewed}))};
}
