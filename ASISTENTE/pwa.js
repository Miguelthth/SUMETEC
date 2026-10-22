let registration,installPrompt,applying=false;
const installButton=document.querySelector('#install-app');
const updateBanner=document.querySelector('#pwa-update');
const updateButton=document.querySelector('#pwa-update-button');
const updateText=document.querySelector('#pwa-update-text');
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function reflectInstallation(){installButton.hidden=standalone();}
reflectInstallation();
matchMedia('(display-mode: standalone)').addEventListener('change',reflectInstallation);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;installButton.dataset.ready='true';reflectInstallation();});
window.addEventListener('appinstalled',()=>{installPrompt=null;installButton.hidden=true;});
installButton.addEventListener('click',async()=>{
  if(installPrompt){
    const prompt=installPrompt;installPrompt=null;delete installButton.dataset.ready;
    try{await prompt.prompt();await prompt.userChoice;}catch{/* La ayuda manual permanece disponible. */}
    return;
  }
  document.querySelector('#install-help').showModal();
});
document.querySelector('#close-install-help').addEventListener('click',()=>document.querySelector('#install-help').close());

function showUpdate(){
  updateBanner.hidden=!registration?.waiting;
  updateButton.disabled=applying||!!document.querySelector('dialog[open]');
}
function askWorker(worker){
  return new Promise(resolve=>{
    const channel=new MessageChannel();
    const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};
    const timer=setTimeout(()=>finish({ok:false,message:'No se pudo preparar la actualización. Intenta nuevamente.'}),5000);
    channel.port1.onmessage=event=>finish(event.data);
    worker.postMessage({type:'ACTIVATE_UPDATE'},[channel.port2]);
  });
}
updateButton.addEventListener('click',async()=>{
  if(applying||!registration?.waiting||document.querySelector('dialog[open]'))return;
  if(typeof window.sumetecAsistenteGuardarParaActualizar!=='function'||window.sumetecAsistenteGuardarParaActualizar()!==true){
    updateText.textContent='No se pudo guardar tu trabajo. Exporta un respaldo antes de actualizar.';return;
  }
  applying=true;showUpdate();
  try{
    const result=await askWorker(registration.waiting);
    if(!result?.ok)throw Error(result?.message||'No se pudo actualizar.');
  }catch(error){applying=false;updateText.textContent=error.message;showUpdate();}
});
navigator.serviceWorker?.addEventListener('controllerchange',()=>{
  if(applying)location.reload();
});
if('serviceWorker' in navigator&&window.isSecureContext){
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(value=>{
    registration=value;showUpdate();
    registration.addEventListener('updatefound',()=>{
      const worker=registration.installing;
      worker?.addEventListener('statechange',()=>{if(worker.state==='installed')showUpdate();});
    });
    window.addEventListener('online',()=>registration.update().catch(()=>{}));
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')registration.update().catch(()=>{});});
    new MutationObserver(showUpdate).observe(document.body,{attributes:true,attributeFilter:['open'],subtree:true});
  }).catch(()=>{
    document.querySelector('#pwa-status').hidden=false;
    document.querySelector('#pwa-status').textContent='La app abre en línea, pero no se pudo preparar el acceso sin conexión. Vuelve a abrirla con internet.';
  });
}
