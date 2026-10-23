// Generado por build.mjs: el caché cambia con el contenido completo del paquete.
const BUILD = 'f42515cefd17d7a5';
const ASSETS = ["asistente.html","styles.css","app.mjs","model.mjs","pwa.js","manifest.json","favicon.png","icons/asistente-192.png","icons/asistente-512.png","icons/asistente-maskable-512.png","icons/asistente-180.png"];
const BASE = new URL('./',self.registration.scope);
const PREFIX = 'sumetec-asistente-'+encodeURIComponent(BASE.pathname)+'-';
const CACHE = PREFIX+BUILD;
const allowed = new Set(ASSETS.map(file=>new URL(file,BASE).href));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...allowed].map(url=>new Request(url,{cache:'reload'})))).catch(async error=>{
    await caches.delete(CACHE);throw error;
  }));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await Promise.all((await caches.keys()).filter(name=>name.startsWith(PREFIX)&&name!==CACHE).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type!=='ACTIVATE_UPDATE')return;
  event.waitUntil((async()=>{
    const windows=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(client=>{
      const url=new URL(client.url);return url.origin===BASE.origin&&url.pathname.startsWith(BASE.pathname);
    });
    if(windows.length>1){event.ports?.[0]?.postMessage({ok:false,message:'Cierra las otras ventanas de esta app antes de actualizar.'});return;}
    event.ports?.[0]?.postMessage({ok:true});await self.skipWaiting();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==BASE.origin||url.search)return;
  const home=request.mode==='navigate'&&(url.pathname===BASE.pathname||url.href===new URL('asistente.html',BASE).href);
  if(!home&&!allowed.has(url.href))return;
  const resource=home?new URL('asistente.html',BASE).href:url.href;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(resource)).then(hit=>hit||fetch(request)));
});
