'use strict';
(()=>{
 const canvas=document.createElement('canvas');canvas.id='referenceContour';canvas.hidden=true;canvas.setAttribute('aria-hidden','true');$('cameraArea').append(canvas);
 const badge=document.createElement('p');badge.id='contourLegend';badge.hidden=true;badge.textContent='Linee azzurre = foto prima';$('cameraArea').append(badge);
 const tools=document.createElement('div');tools.className='contour-controls';
 tools.innerHTML='<label for="referenceStyle">Riferimento del prima</label><select id="referenceStyle"><option value="contour">Sagoma dalla foto prima</option><option value="both">Sagoma + foto trasparente</option><option value="photo">Foto trasparente</option></select><p id="contourStatus" role="status">Preparo la sagoma…</p><details id="contourSettings"><summary>Regola sagoma</summary><label for="contourDetail">Dettagli: <output id="contourDetailValue">35</output></label><input id="contourDetail" type="range" min="0" max="100" value="35"><p class="hint">Meno dettagli per linee più pulite; più dettagli per recuperare i contorni deboli. Anche ombre e sfondo possono comparire.</p><label for="contourOpacity">Visibilità sagoma</label><input id="contourOpacity" type="range" min="15" max="100" value="90"></details><button id="holdReferencePhoto" class="ghost-toggle" type="button">Tieni premuto: vedi il prima</button>';
 $('ghostControls').prepend(tools);
 const opacityLabel=$('opacity').previousElementSibling;
 let worker=null,serial=0,generation=0,currentRef=null,resultRef=null,resultDetail=null,processing=false,preview=false,failed=false,detailTimer;
 const waiters=new Map(),cache=new WeakMap();
 function ref(){return activeVisit>0?visits[0].photos.get(POSES[current].id):references.get(POSES[current].id);}
 function show(){
  const source=ref(),mode=$('referenceStyle').value,visible=!!source&&!pending&&view!=='compare'&&ghostVisible;
  const ready=resultRef===source&&!failed;
  canvas.hidden=!visible||mode==='photo'||!ready||preview;badge.hidden=canvas.hidden;
  canvas.style.opacity=Number($('contourOpacity').value)/100;
  $('referenceImage').hidden=!visible||(!preview&&mode==='contour'&&ready);
  $('referenceImage').style.opacity=preview?1:Number($('opacity').value)/100;
  $('opacity').hidden=mode==='contour';opacityLabel.hidden=mode==='contour';
  $('contourSettings').hidden=mode==='photo';$('contourStatus').hidden=mode==='photo';
  $('toggleGhost').textContent=ghostVisible?(mode==='photo'?'Nascondi prima':'Nascondi sagoma'):(mode==='photo'?'Mostra prima':'Mostra sagoma');
  $('guide').toggleAttribute('hidden',!!source||!!pending||!$('showGuide').checked);
  $('cameraArea').classList.toggle('contour-reference',!canvas.hidden);
  if(mode!=='photo')$('contourStatus').textContent=failed?'Sagoma non disponibile: uso la foto trasparente.':ready?'Fai coincidere le linee con occhi, naso e profilo del paziente.':'Preparo i contorni della foto prima…';
 }
 function analyze(rgba,width,height,detail){
  if(!window.Worker)return import('./reference-contour-core.mjs?v=19').then(m=>m.photoEdges(rgba,width,height,detail));
  if(!worker){
   worker=new Worker('/reference-contour-worker.js?v=19');
   worker.onmessage=({data})=>{const task=waiters.get(data.id);if(!task)return;waiters.delete(data.id);clearTimeout(task.timer);data.error?task.reject(Error('Contorni non disponibili')):task.resolve(new Uint8Array(data.edges));};
   worker.onerror=()=>{for(const task of waiters.values()){clearTimeout(task.timer);task.reject(Error('Contorni non disponibili'));}waiters.clear();worker.terminate();worker=null;};
  }
  return new Promise((resolve,reject)=>{
   const id=++serial,timer=setTimeout(()=>{waiters.delete(id);reject(Error('Tempo scaduto'));},10000);waiters.set(id,{resolve,reject,timer});
   worker.postMessage({id,rgba:rgba.buffer,width,height,detail},[rgba.buffer]);
  });
 }
 function paint(edges,width,height){
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d'),image=ctx.createImageData(width,height),p=image.data;
  for(let i=0;i<edges.length;i++)if(edges[i]){
   // A subtle dark halo keeps a one-pixel contour visible on bright skin.
   for(const j of [i-1,i+1,i-width,i+width])if(j>=0&&j<edges.length&&!edges[j]){p[j*4+3]=75;}
   p[i*4]=38;p[i*4+1]=255;p[i*4+2]=224;p[i*4+3]=255;
  }
  ctx.putImageData(image,0,0);
 }
 async function prepare(source){
  const gen=++generation,detail=Number($('contourDetail').value);processing=true;failed=false;resultRef=null;show();
  try{
   let result=cache.get(source);
   if(!result||result.url!==source.url||result.detail!==detail){
    const image=await loadedImage(source.url);if(gen!==generation)return;
    const r=cropRect(image.naturalWidth,image.naturalHeight),width=Math.min(1050,Math.floor(r.sw)),height=Math.round(width/ .75);
    const work=document.createElement('canvas');work.width=width;work.height=height;const ctx=work.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(image,r.sx,r.sy,r.sw,r.sh,0,0,width,height);
    const edges=await analyze(ctx.getImageData(0,0,width,height).data,width,height,detail);
    if(edges.reduce((n,v)=>n+(v?1:0),0)<32)throw Error('Contorni insufficienti');
    result={edges,width,height,url:source.url,detail};cache.set(source,result);
   }
   if(gen!==generation||ref()!==source)return;
   paint(result.edges,result.width,result.height);resultRef=source;resultDetail=detail;
  }catch{if(gen===generation&&ref()===source)failed=true;}
  finally{if(gen===generation){processing=false;show();}}
 }
 function update(){
  const source=ref();
  if(source!==currentRef){currentRef=source;resultRef=null;failed=false;generation++;processing=false;preview=false;}
  show();if(source&&!processing&&!failed&&$('referenceStyle').value!=='photo'&&(source!==resultRef||resultDetail!==Number($('contourDetail').value)))prepare(source);
 }
 const prior=renderReference;renderReference=function(){prior();update();};
 $('referenceStyle').addEventListener('change',update);
 $('contourOpacity').addEventListener('input',show);
 $('contourDetail').addEventListener('input',()=>{$('contourDetailValue').textContent=$('contourDetail').value;clearTimeout(detailTimer);detailTimer=setTimeout(()=>{failed=false;generation++;processing=false;update();},180);});
 const hold=$('holdReferencePhoto');
 hold.addEventListener('pointerdown',e=>{e.preventDefault();hold.setPointerCapture(e.pointerId);preview=true;show();});
 for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])hold.addEventListener(name,()=>{preview=false;show();});
 hold.addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();preview=true;show();}});
 hold.addEventListener('keyup',()=>{preview=false;show();});
 $('toggleGhost').addEventListener('click',show);$('opacity').addEventListener('input',show);
 // Existing listeners retain their original callback; refresh after photo imports
 // and camera/patient changes, while expensive work only happens once per photo.
 setInterval(update,500);
 update();
})();
