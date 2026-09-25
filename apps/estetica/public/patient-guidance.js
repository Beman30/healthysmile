'use strict';
// Guidance is supplementary to the original-photo contour. Only the after view
// with an actual before photograph is measured. Processing stays on the device.
(()=>{
 const panel=document.createElement('section');panel.id='patientGuidance';panel.className='patient-guidance';panel.hidden=true;
 panel.innerHTML='<div class="patient-guide-header"><span>GUIDA PER IL DOPO</span><button type="button" id="togglePatientGuidance" aria-pressed="true">Spegni</button></div><div role="status" aria-live="polite" aria-atomic="true"><strong id="patientGuideInstruction">Leggo il prima…</strong><p id="patientGuideDetail">La sagoma resta il riferimento visivo.</p></div>';
 $('captureDock').prepend(panel);
 let enabled=true,worker=null,core=null,loading=null,failed=false,busy=false,serial=0,lifecycle=0,contextKey='',candidate='',candidateAt=0,lastFace=null,previousPatient=null;
 const requests=new Map();let cachedReference=null,cachedFace=null,cachedURL='';
 const canvas=document.createElement('canvas');canvas.width=450;canvas.height=600;const ctx=canvas.getContext('2d');
 const reference=()=>activeVisit>0?captureReference():null;
 function key(){return [cloud.patient?.id,activeVisit,current,reference()?.url,stream?.id].join('|');}
 function active(){return enabled&&!!stream&&!pending&&!captureBusy&&view!=='compare'&&activeVisit>0&&!document.hidden;}
 function show(text,detail='',close=false){
  if($('patientGuideInstruction').textContent!==text)$('patientGuideInstruction').textContent=text;
  if($('patientGuideDetail').textContent!==detail)$('patientGuideDetail').textContent=detail;
  panel.classList.toggle('patient-guide-close',close);
 }
 function dispose(){
  lifecycle++;worker?.terminate();worker=null;loading=null;
  for(const r of requests.values()){clearTimeout(r.timer);r.reject(Error('Guida interrotta'));}requests.clear();
 }
 function ask(bitmap,timeout=45000){
  return new Promise((resolve,reject)=>{
   const id=++serial,timer=setTimeout(()=>{requests.delete(id);reject(Error('Guida troppo lenta'));},timeout);
   requests.set(id,{resolve,reject,timer});
   try{worker.postMessage({id,bitmap},bitmap?[bitmap]:[]);}catch(e){clearTimeout(timer);requests.delete(id);bitmap?.close();reject(e);}
  });
 }
 async function load(){
  if(loading)return loading;
  const generation=lifecycle;
  loading=(async()=>{
   if(!window.Worker||!window.OffscreenCanvas||!window.createImageBitmap)throw Error('Guida non supportata');
   core=await import('./patient-guidance-core.mjs?v=20');
   if(generation!==lifecycle)throw Error('Guida interrotta');
   worker=new Worker('/patient-guidance-worker.js?v=20');
   worker.onmessage=({data})=>{const r=requests.get(data.id);if(!r)return;requests.delete(data.id);clearTimeout(r.timer);data.error?r.reject(Error(data.error)):r.resolve(data.face);};
   worker.onerror=()=>{failed=true;dispose();};
   await ask();
  })();return loading;
 }
 async function bitmap(source,width,height){
  const r=cropRect(width,height);ctx.drawImage(source,r.sx,r.sy,r.sw,r.sh,0,0,450,600);return createImageBitmap(canvas);
 }
 async function readReference(ref){
  if(ref===cachedReference&&ref.url===cachedURL)return cachedFace;
  const image=await loadedImage(ref.url);
  const face=await ask(await bitmap(image,image.naturalWidth,image.naturalHeight),10000);
  cachedReference=ref;cachedURL=ref.url;cachedFace=face;return face;
 }
 function availableCamera(ref){
  const now=stream?.getVideoTracks()[0]?.getSettings()||{},old=ref.camera||{};
  if(old.facingMode&&old.facingMode!=='unknown'&&now.facingMode&&old.facingMode!==now.facingMode)return false;
  if(old.deviceId&&now.deviceId&&old.deviceId!==now.deviceId)return false;
  if(Number.isFinite(old.zoom)&&Number.isFinite(now.zoom)&&Math.abs(old.zoom-now.zoom)>.01)return false;
  return true;
 }
 async function tick(){
  panel.hidden=!stream||!!pending||view==='compare'||activeVisit===0;
  document.body.classList.toggle('after-guide-open',!panel.hidden);
  if(panel.hidden||document.hidden)return;
  if(!enabled)return;
  const ref=reference(),currentKey=key();
  if(contextKey!==currentKey){contextKey=currentKey;candidate='';candidateAt=0;lastFace=null;show('Leggo il prima…','Destra e sinistra sono quelle del paziente.');}
  if(!ref){show('Scegli la foto prima per questa vista','La guida confronta il viso con la tua foto originale.');return;}
  if(POSES[current].kind==='profile'){show('Ritrova il profilo nella sagoma','Di profilo non posso stimare con affidabilità tutte le correzioni. Controlla visivamente.');return;}
  if(!availableCamera(ref)){show('Ripristina la fotocamera del prima','Stesso obiettivo e zoom: altrimenti le indicazioni sulla distanza possono ingannare.');return;}
  if(failed){show('Guida non disponibile','Segui la sagoma o premi Riprova. Puoi comunque scattare.');$('togglePatientGuidance').textContent='Riprova';return;}
  if(busy||captureBusy)return;
  const video=$('video');if(video.readyState<2||!video.videoWidth)return;
  const run=lifecycle;busy=true;
  try{
   if(!loading)show('Avvio della guida…','La sagoma è già disponibile; puoi scattare anche durante il caricamento.');
   await load();if(!active()||currentKey!==key()||run!==lifecycle)return;
   const target=await readReference(ref);if(!active()||currentKey!==key())return;
   if(target.error||target.clipped||Math.abs(target.yaw)>55||Math.abs(target.pitch)>35){show('Non riesco a misurare bene il prima','Usa i contorni azzurri: il confronto automatico non è affidabile su questa foto.');return;}
   const live=await ask(await bitmap(video,video.videoWidth,video.videoHeight),10000);
   if(!active()||currentKey!==key()||run!==lifecycle)return;
   const instruction=core.patientInstruction(live,target),now=performance.now(),steady=core.steadyFace(live,lastFace);lastFace=live;
   if(candidate!==instruction.key){candidate=instruction.key;candidateAt=now;panel.classList.remove('patient-guide-close');if(instruction.okay)show('Resta fermo un momento…','Controllo che la posizione sia stabile.');}
   if(instruction.okay&&!steady){candidateAt=now;panel.classList.remove('patient-guide-close');show('Resta fermo un momento…','Controllo che la posizione sia stabile.');}
   if(now-candidateAt>=(instruction.okay?1200:350))show(instruction.text,instruction.detail,instruction.okay);
  }catch{
   if(enabled&&run===lifecycle){failed=true;dispose();show('Guida non disponibile','Segui la sagoma. Puoi comunque scattare.');$('togglePatientGuidance').textContent='Riprova';}
  }finally{busy=false;}
 }
 $('togglePatientGuidance').addEventListener('click',()=>{
  if(failed){failed=false;dispose();enabled=true;}else enabled=!enabled;
  $('togglePatientGuidance').setAttribute('aria-pressed',String(enabled));$('togglePatientGuidance').textContent=enabled?'Spegni':'Accendi';
  contextKey='';candidate='';lastFace=null;if(!enabled){dispose();show('Guida spenta','Segui la sagoma azzurra per ripetere la posa.');}tick();
 });
 setInterval(()=>{if(previousPatient!==cloud.patient?.id){previousPatient=cloud.patient?.id;cachedReference=null;cachedFace=null;cachedURL='';contextKey='';}tick();},350);
 window.addEventListener('pagehide',dispose);
})();
