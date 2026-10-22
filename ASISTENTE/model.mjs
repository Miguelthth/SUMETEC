export const STORAGE_PREFIX = 'sumetec-asistente:';
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
  const thread={id:uid(), name:text(input.name,120), email, subject:text(input.subject,200), body:text(input.body), source:state.mode==='demo'?'example':'manual', createdAt:now()};
  state.threads.push(thread); state.selectedThread=thread.id;
  return thread;
}

export function createDemo() {
  const state=createState();state.mode='demo';
  addThread(state,{name:'Proveedor de ejemplo · México',email:'proveedor-mx@example.com',subject:'Cotización de tornillo hexagonal',body:'EJEMPLO. Podemos cotizar tornillo hexagonal galvanizado. Para confirmar precio necesitamos medidas, grado y cantidad. El transporte a Tijuana se cotiza por separado.'});
  addThread(state,{name:'Proveedor de ejemplo · Estados Unidos',email:'proveedor-us@example.com',subject:'Disponibilidad y entrega en San Diego',body:'EJEMPLO. Contamos con línea de tornillería métrica e imperial. Favor de enviar especificación y cantidad. La disponibilidad, el precio y el envío están pendientes de cotizar.'});
  addThread(state,{name:'Proveedor de ejemplo · China',email:'proveedor-cn@example.com',subject:'Información para cotizar por volumen',body:'EJEMPLO. Please send specifications, finish, grade and quantity. We will confirm minimum order, production time, packing and shipping terms. No price or landed cost has been confirmed.'});
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
  const draft={id:uid(),threadId,to:thread.email,subject:template.subject?`${template.subject}: ${thread.subject}`:`Re: ${thread.subject}`,body:template.body,action,status:'draft',reviewed:false,version:1,createdAt:now()};
  state.drafts.unshift(draft);return draft;
}

export function editDraft(state,id,changes) {
  const draft=state.drafts.find(d=>d.id===id);
  if(!draft)throw Error('No se encontró el borrador.');
  if(!text(changes.body))throw Error('El mensaje no puede estar vacío.');
  if(changes.subject!==undefined&&!text(changes.subject,200))throw Error('El asunto no puede estar vacío.');
  draft.body=text(changes.body);if(changes.subject!==undefined)draft.subject=text(changes.subject,200);
  draft.version++;draft.reviewed=false;draft.status='draft';return draft;
}

function valid(state,mode) {
  if(!state||state.schema!==1||state.mode!==mode||!['work','demo'].includes(mode))return false;
  if(!['threads','messages','drafts'].every(k=>Array.isArray(state[k])&&state[k].length<10000))return false;
  const str=(obj,k)=>typeof obj?.[k]==='string'&&obj[k].length<=25000;
  if(!state.threads.every(t=>['id','name','email','subject','body'].every(k=>str(t,k))))return false;
  const ids=new Set(state.threads.map(t=>t.id));
  if(state.composerDrafts!==undefined&&(!state.composerDrafts||Array.isArray(state.composerDrafts)||typeof state.composerDrafts!=='object'||!Object.entries(state.composerDrafts).every(([key,value])=>(key==='general'||ids.has(key))&&typeof value==='string'&&value.length<=4000)))return false;
  return state.messages.every(m=>['id','body','role'].every(k=>str(m,k))&&['user','assistant'].includes(m.role)&&(!m.threadId||ids.has(m.threadId)))&&state.drafts.every(d=>['id','to','subject','body'].every(k=>str(d,k))&&ids.has(d.threadId)&&d.status==='draft'&&Number.isInteger(d.version)&&d.version>0)&&(!state.selectedThread||ids.has(state.selectedThread));
}

export function loadState(storage,mode='work') {
  const raw=storage.getItem(key(mode));
  if(!raw)return mode==='demo'?createDemo():createState();
  const state=JSON.parse(raw);
  if(!valid(state,mode))throw Error('El historial guardado no es válido. Exporta un respaldo antes de recuperarlo.');
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

export function summarize(state) {
  return {threads:state.threads.length,drafts:state.drafts.length,pending:state.messages.filter(m=>m.role==='user'&&m.status==='pending').length,sent:0,items:state.drafts.map(d=>({id:d.id,threadId:d.threadId,label:d.subject,to:d.to,reviewed:d.reviewed}))};
}
