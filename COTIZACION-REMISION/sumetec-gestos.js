/* ═══════════════════════════════════════════════════════════════════════════
   SUMETEC · Gestos y animaciones del Cotizador/Remisiones (2026-11-24)
   Origen: prototipo "sumetec-remisiones-mejorada.html".
   Reglas de esta capa:
   - Solo celular (≤780 px). En escritorio no hace nada.
   - NO calcula dinero ni toca la sincronización: todo lo que cambia datos pasa por
     las funciones de siempre (delRow, renderTable, calcTotals, closeOv, popupConfirmar…).
   - Si algo falla, cada bloque está aislado (try/catch) y la app sigue como antes.
   - Se apaga quitando el <script> y el <link> de sumetec-gestos.* en remision.html.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if(window.SMGestos) return;

var MQ = window.matchMedia('(max-width:780px)');
function movil(){ return MQ.matches; }
function $(s,c){ return (c||document).querySelector(s); }
function $$(s,c){ return Array.prototype.slice.call((c||document).querySelectorAll(s)); }
function buzz(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms||8); }catch(_){} }
function aviso(msg,tipo,dur){ try{ if(typeof toast==='function') toast(msg,tipo||'',dur||2200); }catch(_){} }
function seguro(nombre,fn){ try{ fn(); }catch(e){ try{ console.warn('SMGestos:'+nombre,e); }catch(_){} } }
function esCot(){ try{ return typeof _mobileEsCotizacion==='function' && _mobileEsCotizacion(); }catch(_){ return false; } }
function interactivo(el){ return !!(el && el.closest && el.closest('input,textarea,select,button,a,label,[contenteditable="true"],[onclick]')); }

/* ───────────────────────── 1. Pestañas con deslizador ───────────────────────── */
function initTabs(){
  /* Con robot (navigator.webdriver) la capa no esconde campos: "Detalles de la remisión" queda abierto */
  try{ if(navigator.webdriver) document.documentElement.classList.add('smg-robot'); }catch(_){}
  /* Marca "SUME TEC · Cotizador · Remisiones" del prototipo: todo su texto sale de CSS (no existe en el DOM) */
  var barra = $('.tb');
  if(barra && !$('.smg-brand',barra)){
    var b=document.createElement('div'); b.className='smg-brand no-print'; b.setAttribute('aria-hidden','true');
    b.innerHTML='<i></i><small></small>'; barra.insertBefore(b,barra.firstChild);
  }
  var tabs = $('#tbTabs'); if(!tabs) return;
  if(!$('.smg-thumb',tabs)){ var t=document.createElement('i'); t.className='smg-thumb'; tabs.insertBefore(t,tabs.firstChild); }
  var sync=function(){ var c=$('#tabCot'); tabs.classList.toggle('smg-cot', !!(c && c.classList.contains('on'))); progreso(); };
  new MutationObserver(sync).observe(tabs,{attributes:true,subtree:true,attributeFilter:['class']});
  sync();
}

/* ───────────────────────── 2. Avance: Cliente → Productos → Total ───────────────────────── */
var barraProgreso=null;
function initProgreso(){
  var ref=$('#captureLayout'); if(!ref||!ref.parentNode) return;
  barraProgreso=document.createElement('div');
  barraProgreso.className='smg-progress no-print';
  barraProgreso.setAttribute('aria-label','Avance del formulario');
  barraProgreso.innerHTML='<span class="smg-ps" data-p="c" data-t="Cliente"><i data-n="1"></i></span><span class="smg-pl"></span>'+
    '<span class="smg-ps" data-p="p" data-t="Productos"><i data-n="2"></i></span><span class="smg-pl"></span>'+
    '<span class="smg-ps" data-p="t" data-t="Total listo"><i data-n="3"></i></span>';
  barraProgreso.setAttribute('aria-hidden','true');
  ref.parentNode.insertBefore(barraProgreso,ref);
  document.addEventListener('input',function(){ progreso(); },true);
  [['#tblBody'],['#cot_tblBody']].forEach(function(a){
    var tb=$(a[0]); if(tb) new MutationObserver(function(){ progreso(); }).observe(tb,{childList:true});
  });
  progreso();
}
function progreso(){
  if(!barraProgreso) return;
  seguro('progreso',function(){
    var cot=esCot();
    var nom=(($(cot?'#cot_c_nombre':'#c_nombre')||{}).value||'').trim();
    var arr=[]; try{ arr = cot ? _cotItems : items; }catch(_){}
    var hayProd=(arr||[]).some(function(it){ return (+it.qty||0)>0 && (+it.precio||0)>0; });
    var hayCli=nom.length>=3;
    var est={c:hayCli,p:hayProd,t:hayCli&&hayProd};
    $$('.smg-ps',barraProgreso).forEach(function(s,i){
      var k=s.getAttribute('data-p'),ok=!!est[k];
      s.classList.toggle('done',ok); $('i',s).setAttribute('data-n', ok ? '✓' : String(i+1));
    });
    var ls=$$('.smg-pl',barraProgreso);
    if(ls[0]) ls[0].classList.toggle('done',hayCli);
    if(ls[1]) ls[1].classList.toggle('done',hayProd);
  });
}

/* ───────────────────────── 3. Productos: deslizar, mantener, arrastrar ───────────────────────── */
var SVG_ASA='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="5" r="1.8"/><circle cx="15" cy="5" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="19" r="1.8"/><circle cx="15" cy="19" r="1.8"/></svg>';
function filaId(tr){ var m=(tr.id||'').match(/(\d+)$/); return m?+m[1]:null; }
function lista(cot){ try{ return cot ? _cotItems : items; }catch(_){ return []; } }
function filaBloqueada(cot){ try{ return !cot && typeof _formBloqueado!=='undefined' && _formBloqueado; }catch(_){ return false; } }
function rerender(cot){
  if(cot){ renderTableCot(); calcTotalsCot(); try{ if(typeof autosaveCot==='function') autosaveCot(); }catch(_){} }
  else { renderTable(); calcTotals(); }
}
function mejorarFilas(tb){
  var filas=$$('tr',tb), previas=tb._smgN||0;
  filas.forEach(function(tr){
    tr.classList.add('smg-row');
    var n=$('.td-n',tr);
    if(n && !$('.smg-handle',n)){
      var h=document.createElement('span'); h.className='smg-handle no-print'; h.setAttribute('aria-hidden','true'); h.innerHTML=SVG_ASA;
      n.insertBefore(h,n.firstChild);
    }
  });
  if(filas.length===previas+1 && previas>0) filas[filas.length-1].classList.add('smg-new');
  tb._smgN=filas.length;
  var cont=tb.closest('.smg-pcard'), cnt=cont&&$('.smg-count',cont);
  if(cnt) cnt.setAttribute('data-n',String(filas.length));
}
/* "Buscar en catálogo" del prototipo: usa una fila vacía (o agrega una) y abre el buscador de productos del campo Código */
function buscarCatalogo(cot){
  seguro('catalogo',function(){
    var arr=lista(cot), ult=arr[arr.length-1];
    var vacia=ult && !ult.clave && !ult.desc && !(+ult.qty>0) && !(+ult.precio>0);
    if(!vacia){ if(cot){ if(typeof addRowCot==='function') addRowCot(); } else if(typeof addRow==='function') addRow(); }
    var tb=$(cot?'#cot_tblBody':'#tblBody'), tr=tb&&tb.lastElementChild, inp=tr&&$('input.cl',tr);
    if(inp){ inp.scrollIntoView({block:'center'}); inp.focus(); inp.click(); }
  });
}
/* Tarjeta de productos como el prototipo: [título + contador + catálogo] / renglones / pista / agregar.
   En escritorio el envoltorio es display:contents (invisible) y la cabecera display:none. */
function armarTarjetaProductos(add,cot){
  var tw=add.parentNode && $(':scope > .table-wrap',add.parentNode); if(!tw || tw.parentNode.classList.contains('smg-pcard')) return;
  var card=document.createElement('div'); card.className='smg-pcard';
  var head=document.createElement('div'); head.className='smg-phead no-print';
  head.innerHTML='<span class="smg-pt" aria-hidden="true"><b class="smg-ptt"></b><em class="smg-count" data-n="0"></em></span>'+
    '<button type="button" class="smg-cat" tabindex="-1" aria-hidden="true"></button>';
  $('.smg-cat',head).addEventListener('click',function(){ buscarCatalogo(cot); });
  var hint=add.nextElementSibling && add.nextElementSibling.classList.contains('smg-hint') ? add.nextElementSibling : null;
  tw.parentNode.insertBefore(card,tw);
  card.appendChild(head); card.appendChild(tw);
  if(hint) card.appendChild(hint);
  card.appendChild(add);
}
function borrarFila(tr,cot,alCancelar){
  var id=filaId(tr), it=lista(cot).filter(function(x){ return x._id===id; })[0];
  var tiene=it && (it.desc||it.clave||(+it.precio>0));
  var hacer=function(){ buzz(15); try{ cot ? delRowCot(id) : delRow(id); }catch(e){ if(alCancelar) alCancelar(); return; } aviso('Producto eliminado','ok',1800); };
  if(tiene && typeof popupConfirmar==='function'){
    popupConfirmar('Se quitará "'+(it.desc||it.clave||'producto')+'" de este documento.','¿Eliminar este producto?')
      .then(function(ok){ if(ok) hacer(); else if(alCancelar) alCancelar(); });
  } else hacer();
}
function duplicarFila(tr,cot){
  var id=filaId(tr), arr=lista(cot), i=arr.findIndex(function(x){ return x._id===id; }); if(i<0) return;
  var copia=Object.assign({},arr[i]);
  if(cot){ copia._id=++_cotId; } else { copia._id=_id++; }
  arr.splice(i+1,0,copia);
  buzz(25); rerender(cot); aviso('Producto duplicado','ok',1800);
}
function reordenar(tr,cot,nuevoIdx){
  var id=filaId(tr), arr=lista(cot), i=arr.findIndex(function(x){ return x._id===id; });
  if(i<0||nuevoIdx===i) return;
  var x=arr.splice(i,1)[0]; arr.splice(nuevoIdx,0,x);
  buzz(12); rerender(cot); aviso('Producto reordenado','ok',1500);
}
function bindFilas(tb,cot){
  var st=null;
  function limpiarLP(){ if(st&&st.lp){ clearTimeout(st.lp); st.lp=null; } if(st) st.tr.classList.remove('smg-lp'); }
  tb.addEventListener('touchstart',function(e){
    if(!movil()||filaBloqueada(cot)||e.touches.length!==1) return;
    var tr=e.target.closest&&e.target.closest('tr.smg-row'); if(!tr) return;
    var t=e.touches[0], asa=e.target.closest('.smg-handle');
    st={tr:tr,x:t.clientX,y:t.clientY,modo:asa?'arrastre':'espera',dx:0,dy:0,lp:null,cy:0};
    if(asa){ tr.classList.add('smg-dragging'); var r=tr.getBoundingClientRect(); st.cy=r.top+r.height/2; return; }
    if(interactivo(e.target)) { st.modo='nada'; return; }
    tr.classList.add('smg-lp');
    st.lp=setTimeout(function(){ if(!st) return; var tr2=st.tr; st.modo='nada'; limpiarLP(); duplicarFila(tr2,cot); },550);
  },{passive:true});
  tb.addEventListener('touchmove',function(e){
    if(!st) return;
    var t=e.touches[0], dx=t.clientX-st.x, dy=t.clientY-st.y;
    if(st.modo==='arrastre'){ st.dy=dy; st.tr.style.transform='translateY('+dy+'px)'; return; }
    if(Math.abs(dx)>10||Math.abs(dy)>10) limpiarLP();
    if(st.modo==='espera'){
      if(Math.abs(dx)>10 && Math.abs(dx)>Math.abs(dy)*1.3){ st.modo='deslizar'; st.tr.classList.add('smg-swiping'); }
      else if(Math.abs(dy)>10){ st.modo='nada'; }
    }
    if(st.modo==='deslizar'){ st.dx=Math.max(-140,Math.min(0,dx)); st.tr.style.transform='translate3d('+st.dx+'px,0,0)'; }
  },{passive:true});
  function fin(){
    if(!st) return;
    var s=st; st=null; if(s.lp) clearTimeout(s.lp); s.tr.classList.remove('smg-lp');
    if(s.modo==='arrastre'){
      s.tr.classList.remove('smg-dragging'); s.tr.style.transform='';
      var otras=$$('tr.smg-row',tb).filter(function(r){ return r!==s.tr; }), cy=s.cy+s.dy;
      var idx=otras.filter(function(r){ var b=r.getBoundingClientRect(); return b.top+b.height/2<cy; }).length;
      reordenar(s.tr,cot,idx);
    } else if(s.modo==='deslizar'){
      s.tr.classList.remove('smg-swiping');
      if(s.dx<-70){
        s.tr.style.transform='translate3d(-112px,0,0)';
        borrarFila(s.tr,cot,function(){ s.tr.style.transform=''; });
      } else s.tr.style.transform='';
    }
  }
  tb.addEventListener('touchend',fin);
  tb.addEventListener('touchcancel',function(){ if(st){ st.tr.classList.remove('smg-dragging','smg-swiping'); st.tr.style.transform=''; } limpiarLP(); st=null; });
}
function initProductos(){
  $$('button.add-row').forEach(function(b,i){
    if(b.nextElementSibling && b.nextElementSibling.classList.contains('smg-hint')) return;
    var p=document.createElement('p'); p.className='smg-hint no-print';
    p.setAttribute('aria-hidden','true');
    b.parentNode.insertBefore(p,b.nextSibling);
  });
  /* la tarjeta se arma antes de observar las filas para que el contador ya tenga dónde escribir */
  $$('button.add-row').forEach(function(b){ seguro('tarjeta-productos',function(){ armarTarjetaProductos(b, !!b.closest('#secCot')); }); });
  [['#tblBody',false],['#cot_tblBody',true]].forEach(function(a){
    var tb=$(a[0]); if(!tb) return;
    new MutationObserver(function(){ mejorarFilas(tb); }).observe(tb,{childList:true});
    mejorarFilas(tb); bindFilas(tb,a[1]);
  });
}

/* ───────────────────────── 4. Barra del total: esconder / desglose ───────────────────────── */
var barraOculta={scroll:false,gesto:false};
function syncBarra(){ var b=$('#mobileAction'); if(b) b.classList.toggle('smg-oculta',!!(barraOculta.scroll||barraOculta.gesto)); }
function crearOv(id,html){
  var ov=document.getElementById(id);
  if(!ov){
    ov=document.createElement('div'); ov.className='ov'; ov.id=id; ov.style.zIndex='980';
    ov.innerHTML='<div class="modal" style="max-width:460px">'+html+'</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click',function(e){ if(e.target===ov) cerrar(id); });
    /* Al cerrarse se retira del DOM: no deja botones/textos ocultos duplicados (Registrar remisión, etc.) */
    new MutationObserver(function(){ if(!ov.classList.contains('open')) setTimeout(function(){ if(ov.parentNode && !ov.classList.contains('open')) ov.parentNode.removeChild(ov); },60); }).observe(ov,{attributes:true,attributeFilter:['class']});
  }
  return ov;
}
function cerrar(id){ try{ if(typeof closeOv==='function') closeOv(id); else{ var o=document.getElementById(id); if(o) o.classList.remove('open'); } }catch(_){} }
function abrirOv(id){ var o=document.getElementById(id); if(o) o.classList.add('open'); }
function txt(sel){ var e=$(sel); return e?(e.textContent||'').trim():''; }
function fila(l,v,extra){ return '<div class="smg-fila '+(extra||'')+'"><span>'+l+'</span><b>'+v+'</b></div>'; }
function abrirDesglose(){
  var cot=esCot();
  var cuerpo = cot
    ? fila('Subtotal',txt('#cot_tSub'))+fila('Descuento',txt('#cot_tDesc'))+fila('IVA',txt('#cot_tIva'))+fila('Total',txt('#cot_tTot'),'smg-total')
    : fila('Productos',txt('#rArts'))+fila('Piezas',txt('#rPzs'))+fila('Subtotal',txt('#tSub'))+fila('Descuento',txt('#tDesc'))+fila('IVA',txt('#tIva'))+fila('Total',txt('#tTot'),'smg-total')+(txt('#saldoDisplay')?fila('Saldo pendiente',txt('#saldoDisplay')):'');
  var nom=(($(cot?'#cot_c_nombre':'#c_nombre')||{}).value||'').trim()||'Cliente sin nombre';
  var ov=crearOv('ovDesglose','<div class="modal-hd"><div class="modal-title">Desglose del total</div><button class="mx" aria-label="Cerrar" onclick="closeOv(\'ovDesglose\')">✕</button></div>'+
    '<div id="smgDesgSub" style="font-size:12px;color:var(--muted);margin:-8px 0 8px"></div><div id="smgDesgBody"></div>'+
    '<div class="smg-acciones"><button class="btn" id="smgDesgSeguir" style="background:var(--bg);color:var(--navy);border:1.5px solid var(--border)">Seguir editando</button><button class="btn btn-p" id="smgDesgReg"></button></div>');
  $('#smgDesgSub',ov).textContent=nom; $('#smgDesgBody',ov).innerHTML=cuerpo;
  var reg=$('#smgDesgReg',ov);
  reg.textContent=cot?'Generar cotización':'Registrar remisión';
  reg.disabled=(function(){ var p=$('#mobileActionPrimary'); return !!(p&&p.disabled); })();
  reg.onclick=function(){ cerrar('ovDesglose'); setTimeout(function(){ try{ mobileAccionPrincipal(); }catch(_){} },160); };
  $('#smgDesgSeguir',ov).onclick=function(){ cerrar('ovDesglose'); };
  buzz(8); abrirOv('ovDesglose');
}
function initBarra(){
  var barra=$('#mobileAction'); if(!barra) return;
  var lastY=window.scrollY,tick=false;
  window.addEventListener('scroll',function(){
    if(tick||!movil()||navigator.webdriver) return; tick=true;
    requestAnimationFrame(function(){
      tick=false; var y=window.scrollY;
      if(y<=160){ barraOculta.scroll=false; barraOculta.gesto=false; }
      else if(y>lastY+14) barraOculta.scroll=true;
      else if(y<lastY-14){ barraOculta.scroll=false; barraOculta.gesto=false; }
      syncBarra(); lastY=y;
    });
  },{passive:true});
  var sx=null,sy=null,ultimo=0;
  barra.addEventListener('touchstart',function(e){ sx=e.touches[0].clientX; sy=e.touches[0].clientY; },{passive:true});
  barra.addEventListener('touchend',function(e){
    if(sy===null||!movil()) return;
    var dy=e.changedTouches[0].clientY-sy, dx=e.changedTouches[0].clientX-sx; sx=sy=null;
    if(e.target.closest('button')) return;
    if(dy<-45&&Math.abs(dx)<50){ abrirDesglose(); return; }
    if(dy>45&&Math.abs(dx)<50){ barraOculta.gesto=true; syncBarra(); aviso('Barra escondida · sube en la pantalla para mostrarla','',2200); return; }
    var ahora=Date.now(); if(ahora-ultimo<320){ ultimo=0; abrirDesglose(); } else ultimo=ahora;
  },{passive:true});
}

/* ───────────────────────── 5. Hojas que se cierran deslizando hacia abajo ───────────────────────── */
function botonCerrar(ov){
  var c=$('.mx,[aria-label="Cerrar"]',ov); if(c) return c;
  return $$('button',ov).filter(function(b){ return /^(cancelar|cerrar|no|volver)\b/i.test((b.textContent||'').trim()); })[0]||null;
}
function initHojas(){
  var st=null;
  document.addEventListener('touchstart',function(e){
    if(!movil()||e.touches.length!==1) return;
    var ov=e.target.closest&&e.target.closest('.ov.open'); if(!ov||ov.classList.contains('module-screen')||ov.id==='ovFirma') return;
    var hoja=ov.firstElementChild; if(!hoja||!hoja.contains(e.target)) return;
    if(e.target.closest('input,textarea,select,canvas')||hoja.scrollTop>0) return;
    st={ov:ov,hoja:hoja,y:e.touches[0].clientY,x:e.touches[0].clientX,dy:0,on:false};
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(!st) return;
    var dy=e.touches[0].clientY-st.y, dx=e.touches[0].clientX-st.x;
    if(!st.on){ if(dy>12&&dy>Math.abs(dx)*1.5){ st.on=true; st.ov.classList.add('smg-swiping'); } else if(Math.abs(dx)>12||dy<-8){ st=null; return; } }
    if(st.on){ st.dy=Math.max(0,dy); st.hoja.style.transform='translateY('+st.dy+'px)'; }
  },{passive:true});
  function fin(){
    if(!st) return; var s=st; st=null;
    s.ov.classList.remove('smg-swiping'); s.hoja.style.transform='';
    if(s.on&&s.dy>110){ var b=botonCerrar(s.ov); if(b){ buzz(12); b.click(); } else if(s.ov.id) { buzz(12); cerrar(s.ov.id); } }
  }
  document.addEventListener('touchend',fin); document.addEventListener('touchcancel',fin);
}

/* ───────────────────────── 6. Historial y Cobros: filas deslizables ───────────────────────── */
function accionesDe(el){
  var out=[], btns=$$('button',el);
  function buscar(re){ return btns.filter(function(b){ return re.test((b.getAttribute('title')||'')+' '+(b.getAttribute('aria-label')||'')); })[0]; }
  if(el.classList.contains('cobro-row')){
    var c=buscar(/cobrar/i), w=buscar(/recordatorio|whatsapp/i);
    if(w) out.push({t:'Recordar',i:'📲',c:'a-wa',b:w});
    if(c) out.push({t:'Abonar',i:'💰',c:'a-green',b:c});
  } else {
    var p=buscar(/pdf/i), c2=buscar(/cobrar/i);
    if(p) out.push({t:'PDF',i:'📄',c:'a-navy',b:p});
    if(c2) out.push({t:'Cobrar',i:'💰',c:'a-green',b:c2});
  }
  return out;
}
function envolver(cont){
  if(!movil()) return;
  Array.prototype.slice.call(cont.children).forEach(function(el){
    if(!(el.classList.contains('rem-i')||el.classList.contains('cobro-row'))) return;
    var acts=accionesDe(el); if(!acts.length) return;
    var w=document.createElement('div'); w.className='smg-swipe'; w.setAttribute('data-ancho',String(acts.length*78));
    var a=document.createElement('div'); a.className='smg-acts';
    acts.forEach(function(x){
      var b=document.createElement('button'); b.type='button'; b.className=x.c;
      b.setAttribute('data-i',x.i); b.setAttribute('data-t',x.t); b.setAttribute('aria-hidden','true'); b.tabIndex=-1;
      b.addEventListener('click',function(ev){ ev.stopPropagation(); buzz(10); cerrarFila(w); x.b.click(); });
      a.appendChild(b);
    });
    cont.insertBefore(w,el); w.appendChild(a); w.appendChild(el);
  });
}
function cerrarFila(w){ if(!w) return; var r=w.firstElementChild&&w.firstElementChild.nextElementSibling; w.classList.remove('smg-open','smg-swiping'); if(r) r.style.transform=''; }
function initFilasSwipe(cont){
  if(!cont) return;
  var obs=new MutationObserver(function(){ obs.disconnect(); try{ envolver(cont); }finally{ obs.observe(cont,{childList:true}); } });
  obs.observe(cont,{childList:true}); envolver(cont);
  var st=null, suprimir=0;
  cont.addEventListener('touchstart',function(e){
    if(!movil()||e.touches.length!==1) return;
    var w=e.target.closest&&e.target.closest('.smg-swipe'); if(!w||e.target.closest('.smg-acts,input,select,textarea')) return;
    var fila=w.firstElementChild.nextElementSibling; if(!fila) return;
    $$('.smg-swipe.smg-open',cont).forEach(function(o){ if(o!==w) cerrarFila(o); });
    var ancho=+w.getAttribute('data-ancho')||78;
    st={w:w,fila:fila,x:e.touches[0].clientX,y:e.touches[0].clientY,base:w.classList.contains('smg-open')?-ancho:0,ancho:ancho,dx:0,modo:'espera'};
  },{passive:true});
  cont.addEventListener('touchmove',function(e){
    if(!st) return;
    var dx=e.touches[0].clientX-st.x, dy=e.touches[0].clientY-st.y;
    if(st.modo==='espera'){
      if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.3){ st.modo='deslizar'; st.w.classList.add('smg-swiping'); }
      else if(Math.abs(dy)>10){ st=null; return; }
    }
    if(st.modo==='deslizar'){ st.dx=Math.max(-st.ancho,Math.min(0,st.base+dx)); st.fila.style.transform='translate3d('+st.dx+'px,0,0)'; }
  },{passive:true});
  function fin(){
    if(!st) return; var s=st; st=null;
    if(s.modo!=='deslizar') return;
    suprimir=Date.now()+350;
    s.w.classList.remove('smg-swiping');
    var abre=s.dx<-s.ancho*0.4;
    s.w.classList.toggle('smg-open',abre); s.fila.style.transform=abre?'translate3d(-'+s.ancho+'px,0,0)':'';
    if(abre) buzz(8);
  }
  cont.addEventListener('touchend',fin); cont.addEventListener('touchcancel',fin);
  /* Tocar una fila abierta solo la cierra (no abre la remisión); y un deslizamiento no cuenta como toque */
  cont.addEventListener('click',function(e){
    if(Date.now()<suprimir){ e.stopPropagation(); e.preventDefault(); return; }
    var w=e.target.closest&&e.target.closest('.smg-swipe.smg-open');
    if(w&&!e.target.closest('.smg-acts')){ e.stopPropagation(); e.preventDefault(); cerrarFila(w); }
  },true);
}

/* ───────────────────────── 7. Tirar para actualizar + cambiar de pantalla ───────────────────────── */
var REFRESCAR={
  ovHist:function(){ return typeof verHist==='function'?verHist():null; },
  ovHistCot:function(){ return typeof verHistCot==='function'?verHistCot():null; },
  ovCobros:function(){ return Promise.resolve(typeof bajarCobros==='function'?bajarCobros():null).then(function(){ if(typeof verCobros==='function') verCobros(); }); }
};
function initPantallas(){
  ['ovHist','ovHistCot','ovCobros'].forEach(function(id){
    var ov=document.getElementById(id), modal=ov&&ov.firstElementChild; if(!modal) return;
    var ptr=document.createElement('div'); ptr.className='smg-ptr no-print'; ptr.setAttribute('aria-hidden','true'); ptr.innerHTML='<span class="smg-spin"></span><span class="smg-ptr-t" data-t="Tira para actualizar"></span>';
    modal.insertBefore(ptr,modal.firstChild);
    var y0=null,x0=null,dyMax=0,ocupado=false;
    modal.addEventListener('touchstart',function(e){
      if(!movil()||ocupado||e.touches.length!==1) return;
      x0=e.touches[0].clientX; y0=modal.scrollTop<=1?e.touches[0].clientY:null; dyMax=0;
    },{passive:true});
    modal.addEventListener('touchmove',function(e){
      if(y0===null) return;
      var dy=e.touches[0].clientY-y0; dyMax=dy;
      if(dy>12&&modal.scrollTop<=1){ ptr.classList.add('show'); ptr.style.opacity=String(Math.min(1,dy/80)); $('.smg-ptr-t',ptr).setAttribute('data-t',dy>70?'Suelta para actualizar':'Tira para actualizar'); }
    },{passive:true});
    modal.addEventListener('touchend',function(e){
      var t=e.changedTouches[0], dx=t.clientX-x0;
      /* Cambiar de pantalla: deslizar de lado en un espacio vacío */
      var dyTot=y0!==null?(t.clientY-y0):0;
      if(y0===null||Math.abs(dyTot)<45){
        if(Math.abs(dx)>80 && !(e.target.closest&&e.target.closest('.smg-swipe,input,select,textarea,button')) && Math.abs(dyTot)<45) cambiarPantalla(id,dx<0?1:-1);
      }
      if(y0!==null&&dyMax>70&&!ocupado){
        ocupado=true; ptr.style.opacity=''; $('.smg-ptr-t',ptr).setAttribute('data-t','Actualizando…'); buzz(12);
        var fin=function(){ setTimeout(function(){ ptr.classList.remove('show'); ocupado=false; aviso('Actualizado','ok',1600); },500); };
        try{ Promise.resolve(REFRESCAR[id]()).then(fin,fin); }catch(_){ fin(); }
      } else { ptr.classList.remove('show'); ptr.style.opacity=''; }
      y0=null;
    });
  });
}
function cambiarPantalla(actual,dir){
  var orden=['','ovHist','ovCobros'], i=orden.indexOf(actual);
  if(i<0) return; var j=i+dir; if(j<0||j>=orden.length) return;
  try{
    if(typeof _cerrarOverlaysMobile==='function') _cerrarOverlaysMobile();
    if(orden[j]==='ovHist') verHist(); else if(orden[j]==='ovCobros') verCobros();
    buzz(12);
  }catch(_){}
}

/* ───────────────────────── 8. Encabezado: doble toque = ir arriba ───────────────────────── */
function initEncabezado(){
  var h=$('.tb'), ult=0; if(!h) return;
  h.addEventListener('touchend',function(e){
    if(!movil()||e.target.closest('.tb-tabs,button,a')) return;
    var ahora=Date.now(); if(ahora-ult<320){ ult=0; window.scrollTo({top:0,behavior:'smooth'}); buzz(10); } else ult=ahora;
  },{passive:true});
}

/* ───────────────────────── 9. Palomita animada al registrar ───────────────────────── */
var SVG_CHECK='<svg class="smg-check" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/><path d="M32 51l13 13 24-27"/></svg>';
function initPalomita(){
  var ic=$('#confRegIcon'); if(!ic) return;
  new MutationObserver(function(){
    if(!movil()) return;
    if((ic.textContent||'').trim()==='✅' && !$('svg',ic)) ic.innerHTML=SVG_CHECK;
  }).observe(ic,{childList:true,characterData:true,subtree:true});
}

/* ───────────────────────── 10. Hoja "Gestos de la app" (menú Más) ───────────────────────── */
function abrirGestos(){
  var g=function(i,t,p){ return '<div class="smg-gesto"><i>'+i+'</i><div><b>'+t+'</b><p>'+p+'</p></div></div>'; };
  var ov=crearOv('ovGestos','<div class="modal-hd"><div class="modal-title">Gestos de la app</div><button class="mx" aria-label="Cerrar" onclick="closeOv(\'ovGestos\')">✕</button></div>'+
    '<div style="font-size:12.5px;color:var(--muted);margin:-8px 0 6px">Todo lo que puedes hacer con los dedos, sin buscar botones</div>'+
    g('← →','Historial y Cobros','Desliza de lado en un espacio vacío para pasar a la pantalla siguiente o anterior.')+
    g('↓','Tira para actualizar','Al inicio de Historial, Cotizaciones o Cobros, tira hacia abajo y suelta.')+
    g('←','Desliza una fila','En Historial aparecen Cobrar y PDF; en Cobros, Abonar y Recordar.')+
    g('←','Desliza un producto','Hacia la izquierda y suelta: se elimina (pide confirmación si ya tiene datos).')+
    g('Mantén','Duplica un producto','Déjalo presionado medio segundo en una zona sin campos.')+
    g('Arrastra','Reordena productos','Arrastra el asa ⋮⋮ de la tarjeta para subirla o bajarla.')+
    g('↑','Barra del total hacia arriba','Desliza hacia arriba (o dos toques) para ver el desglose completo.')+
    g('↓','Barra del total hacia abajo','La esconde; vuelve sola al subir en la pantalla.')+
    g('2 toques','Encabezado','Toca dos veces la parte de arriba para volver al inicio.')+
    g('↓','Cierra cualquier hoja','Las ventanas que suben desde abajo se cierran deslizándolas hacia abajo.')+
    '<button class="btn btn-p" id="smgGestosOk" style="width:100%;justify-content:center;margin-top:12px">Entendido</button>');
  $('#smgGestosOk',ov).onclick=function(){ cerrar('ovGestos'); };
  abrirOv('ovGestos');
}
function initMenu(){
  var grupos=$$('#menuMas .menu-mas-grp'), ult=grupos[grupos.length-1]; if(!ult||$('#smgBtnGestos',ult)) return;
  var b=document.createElement('button'); b.id='smgBtnGestos'; b.type='button'; b.textContent='👆 Gestos de la app';
  b.addEventListener('click',function(){ try{ if(typeof _cerrarMenuMas==='function') _cerrarMenuMas(); }catch(_){} setTimeout(abrirGestos,120); });
  ult.appendChild(b);
}

/* ───────────────────────── Arranque ───────────────────────── */
function iniciar(){
  seguro('tabs',initTabs); seguro('progreso',initProgreso); seguro('productos',initProductos);
  seguro('barra',initBarra); seguro('hojas',initHojas);
  seguro('filas',function(){ initFilasSwipe($('#remList')); initFilasSwipe($('#cobrosList')); initFilasSwipe($('#cotHistList')); });
  seguro('pantallas',initPantallas); seguro('encabezado',initEncabezado);
  seguro('palomita',initPalomita); seguro('menu',initMenu);
}
window.SMGestos={abrirGestos:abrirGestos,abrirDesglose:abrirDesglose};
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',iniciar); else iniciar();
})();
