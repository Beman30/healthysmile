'use strict';
// Independent from capture: model failure, slow phones and lost detections never
// disable the shutter or alter a saved image. Analysis runs off the UI thread.
(()=>{
 const panel=document.createElement('section');panel.id='patientGuidance';panel.className='patient-guidance';panel.hidden=true;
 panel.innerHTML='<div class="patient-guide-header"><span>GUIDA PAZIENTE</span><button type="button" id="togglePatientGuidance" aria-pressed="true">Spegni</button></div><div role="status" aria-live="polite" aria-atomic="true"><strong id="patientGuideInstruction">Avvio della guida…</strong><p id="patientGuideDetail">Puoi già scattare.</p></div>';
 $('cameraArea').append(panel);
 let lifecycle=0;
 let enabled=true,worker=null,core=null,loading=null,failed=false,busy=false,serial=0,contextKey='',candidate='',candidateAt=0,shown='';
 const requests=new Map();let cachedReference=null,cachedFace=null;
 const canvas=document.createElement('canvas');canvas.width=360;canvas.height=480;
 const ctx=canvas.getContext('2d');
 function show(text,detail='',okay=false){
  if(text===shown&&$('patientGuideDetail').textContent===detail)return;
  shown=text;$('patientGuideInstruction').textContent=text;$('patientGuideDetail').textContent=detail;panel.classList.toggle('patient-guide-okay',okay);
 }
 function dispose(){
  lifecycle++;
  worker?.terminate();worker=null;loading=null;
  for(const r of requests.values()){clearTimeout(r.timer);r.reject(Error('Guida interrotta'));}requests.clear();
 }
 function ask(bitmap,timeout=45000){
  return new Promise((resolve,reject)=>{
   const id=++serial;
   const timer=setTimeout(()=>{requests.delete(id);reject(Error('Guida troppo lenta'));},timeout);
   requests.set(id,{resolve,reject,timer});
   try{worker.postMessage({id,bitmap},bitmap?[bitmap]:[]);}catch(e){clearTimeout(timer);requests.delete(id);bitmap?.close();reject(e);}
  });
 }
 async function load(){
  if(loading)return loading;
  const generation=lifecycle;
  loading=(async()=>{
   if(!window.Worker||!window.OffscreenCanvas||!window.createImageBitmap)throw Error('Guida non supportata');
   core=await import('./patient-guidance-core.mjs?v=18');
   if(generation!==lifecycle)throw Error('Guida interrotta');
   worker=new Worker('/patient-guidance-worker.js?v=18');
   worker.onmessage=({data})=>{const r=requests.get(data.id);if(!r)return;requests.delete(data.id);clearTimeout(r.timer);data.error?r.reject(Error(data.error)):r.resolve(data.face);};
   worker.onerror=()=>{failed=true;dispose();show('Guida non disponibile','Usa la foto in trasparenza. Lo scatto resta disponibile.');};
   await ask();
  })();return loading;
 }
 function active(){return enabled&&!!stream&&!pending&&!captureBusy&&view!=='compare'&&!document.hidden;}
 function identity(ref){return [cloud.patient?.id,activeVisit,current,ref?.url,stream?.id,$('guideScale').value].join('|');}
 async function croppedBitmap(source,width,height){
  const r=cropRect(width,height);ctx.drawImage(source,r.sx,r.sy,r.sw,r.sh,0,0,360,480);
  return createImageBitmap(canvas);
 }
 async function referenceFace(ref){
  if(ref===cachedReference)return cachedFace;
  const im=new Image();im.src=ref.url;await im.decode();
  const face=await ask(await croppedBitmap(im,im.naturalWidth,im.naturalHeight),8000);
  cachedReference=ref;cachedFace=face;return face;
 }
 async function tick(){
  panel.hidden=!stream||!!pending||view==='compare';
  if(!enabled||panel.hidden||document.hidden)return;
  if(busy||captureBusy)return;
  const pose=POSES[current],ref=captureReference()||references.get(pose.id),key=identity(ref);
  if(contextKey!==key){contextKey=key;candidate='';candidateAt=0;show('Leggo la posizione…','Destra e sinistra sono quelle del paziente.');}
  if(pose.kind==='profile'){
   show('Gira testa e busto verso la tua '+(pose.flip?'destra':'sinistra'),ref?'Riprendi il profilo del prima in trasparenza. Guida automatica non disponibile di profilo.':'Mostra il profilo, con lo sguardo orizzontale. Guida automatica non disponibile di profilo.');return;
  }
  if(failed){show('Guida non disponibile','Usa la sagoma o la trasparenza. Premi Riprova per riattivarla.');$('togglePatientGuidance').textContent='Riprova';return;}
  const video=$('video');if(video.readyState<2||!video.videoWidth)return;
  busy=true;
  try{
   if(!loading)show('Avvio della guida…','La prima apertura può richiedere qualche secondo. Puoi già scattare.');
   await load();if(!active()||key!==contextKey)return;
   let target;
   if(ref){
    target=await referenceFace(ref);
    if(!active()||key!==contextKey)return;
    if(target.error||target.clipped||Math.abs(target.yaw)>55||Math.abs(target.pitch)>35){show('Usa il prima in trasparenza','Non riesco a misurare bene il volto nella foto prima. Nessuna corrispondenza automatica verificata.');return;}
   }else if(activeVisit>0){show('Manca il prima per questa vista','Scegli una foto prima per ricevere indicazioni di confronto.');return;}
   else target=core.targetForPose(pose,Number($('guideScale').value)/100);
   const live=await ask(await croppedBitmap(video,video.videoWidth,video.videoHeight),8000);
   if(!active()||key!==identity(ref))return;
   const instruction=core.patientInstruction(live,target),now=performance.now();
   if(candidate!==instruction.key){candidate=instruction.key;candidateAt=now;panel.classList.remove('patient-guide-okay');if(instruction.okay)show('Mantieni la posizione…','Attendo che il viso sia fermo.');}
   if(now-candidateAt>=(instruction.okay?1000:250)){
    show(!ref&&instruction.okay?'In posizione: resta fermo':instruction.text,instruction.detail+(ref?'':' Segui anche la posa indicata.'),instruction.okay);
   }
  }catch{
   if(enabled){failed=true;dispose();show('Guida non disponibile','Puoi comunque scattare. Premi Riprova per riattivarla.');$('togglePatientGuidance').textContent='Riprova';}
  }finally{busy=false;}
 }
 $('togglePatientGuidance').addEventListener('click',()=>{
  if(failed){failed=false;dispose();enabled=true;}else enabled=!enabled;
  $('togglePatientGuidance').setAttribute('aria-pressed',String(enabled));$('togglePatientGuidance').textContent=enabled?'Spegni':'Accendi';
  contextKey='';candidate='';if(!enabled){dispose();show('Guida spenta','Scatta seguendo la sagoma o la foto prima in trasparenza.');}tick();
 });
 // Clear patient-derived reference measurements when changing records; nothing
 // is saved in storage or transmitted to an external face-analysis service.
 let patientId=cloud.patient?.id;
 setInterval(()=>{if(patientId!==cloud.patient?.id){patientId=cloud.patient?.id;cachedReference=null;cachedFace=null;contextKey='';}tick();},350);
 window.addEventListener('pagehide',dispose);
})();
