'use strict';
// Guidance is supplementary to the original-photo contour. First-photo frontal guidance and after-photo reference measurements. Processing stays on the device.
(()=>{
 const panel=document.createElement('section');panel.id='patientGuidance';panel.className='patient-guidance';panel.hidden=true;
 panel.innerHTML='<div class="patient-guide-header"><span>GUIDA PER IL DOPO</span><button type="button" id="togglePatientGuidance" aria-pressed="true">Spegni</button></div><div role="status" aria-live="polite" aria-atomic="true"><strong id="patientGuideInstruction">Leggo il prima…</strong><p id="patientGuideDetail">La sagoma resta il riferimento visivo.</p></div>';
 $('captureDock').prepend(panel);
 let enabled=true,worker=null,core=null,beforeCore=null,loading=null,failed=false,busy=false,serial=0,lifecycle=0,contextKey='',candidate='',candidateAt=0,lastFace=null,previousPatient=null;
 const requests=new Map();let cachedReference=null,cachedFace=null,cachedURL='';
 const canvas=document.createElement('canvas');canvas.width=450;canvas.height=600;const ctx=canvas.getContext('2d');
 const reference=()=>activeVisit>0?captureReference():null;
 function key(){return [cloud.patient?.id,activeVisit,current,reference()?.url,stream?.id].join('|');}
 function active(){return enabled&&!!stream&&!pending&&!captureBusy&&view!=='compare'&&!document.hidden;}
 function show(text,detail='',close=false){
  if($('patientGuideInstruction').textContent!==text)$('patientGuideInstruction').textContent=text;
  if($('patientGuideDetail').textContent!==detail)$('patientGuideDetail').textContent=detail;
  panel.classList.toggle('patient-guide-close',close);
 }
 function dispose(){
  window.dispatchEvent(new CustomEvent('hs-before-guide',{detail:{unavailable:true}}));
  window.dispatchEvent(new CustomEvent('hs-face-guide',{detail:{unavailable:true}}));
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
   [core,beforeCore]=await Promise.all([import('./patient-guidance-core.mjs?v=31'),import('./before-guidance-core.mjs?v=31')]);
   if(generation!==lifecycle)throw Error('Guida interrotta');
   worker=new Worker('/patient-guidance-worker.js?v=31');
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
  panel.hidden=!stream||!!pending||view==='compare';
  panel.querySelector('.patient-guide-header span').textContent=activeVisit===0?'GUIDA PER IL PRIMA':'GUIDA PER IL DOPO';
  document.body.classList.toggle('after-guide-open',!panel.hidden);
  if(panel.hidden||document.hidden)return;
  if(!enabled)return;
  const ref=reference(),currentKey=key();
  if(contextKey!==currentKey){window.dispatchEvent(new CustomEvent('hs-before-guide',{detail:{unavailable:true}}));window.dispatchEvent(new CustomEvent('hs-face-guide',{detail:{unavailable:true}}));contextKey=currentKey;candidate='';candidateAt=0;lastFace=null;show(activeVisit===0?'Preparo la guida del prima…':'Leggo il prima…','Destra e sinistra sono quelle del paziente.');}
  if(activeVisit>0&&!ref){show('Scegli la foto prima per questa vista','La guida confronta il viso con la tua foto originale.');return;}
  if(activeVisit>0&&POSES[current].kind==='profile'){show('Ritrova il profilo nella sagoma','Di profilo non posso stimare con affidabilità tutte le correzioni. Controlla visivamente.');return;}
  if(activeVisit>0&&!availableCamera(ref)){show('Ripristina la fotocamera del prima','Stesso obiettivo e zoom: altrimenti le indicazioni sulla distanza possono ingannare.');return;}
  if(failed){show('Guida non disponibile','Usa lo scatto manuale o premi Riprova.');$('togglePatientGuidance').textContent='Riprova';return;}
  if(busy||captureBusy)return;
  const video=$('video');if(video.readyState<2||!video.videoWidth)return;
  const run=lifecycle;busy=true;
  try{
   if(!loading)show('Avvio della guida…','Puoi usare lo scatto manuale anche durante il caricamento.');
   await load();if(!active()||currentKey!==key()||run!==lifecycle)return;
   if(activeVisit===0){
    const measuredAt=performance.now(),live=await ask(await bitmap(video,video.videoWidth,video.videoHeight),10000);
    if(!active()||currentKey!==key()||run!==lifecycle)return;
    const state=beforeCore.beforePoseState(live,beforeOptions()),now=performance.now(),steady=core.steadyFace(live,lastFace);lastFace=live;
    if(candidate!==state.key||!steady){candidate=state.key;candidateAt=now;}
    const stable=state.ready&&steady&&now-candidateAt>=core.POSE_HOLD_MS;
    window.dispatchEvent(new CustomEvent('hs-before-guide',{detail:{state,live,stable,measuredAt,context:currentKey}}));
    show(stable?'Pronto per lo scatto guidato':state.text,stable?'Premi Scatto guidato: sceglierò una foto reale dalla breve raffica.':state.detail,stable);
    return;
   }
   const target=await readReference(ref);if(!active()||currentKey!==key())return;
   if(target.error||target.clipped||Math.abs(target.yaw)>55||Math.abs(target.pitch)>35){show('Non riesco a misurare bene il prima','Usa i contorni azzurri: il confronto automatico non è affidabile su questa foto.');return;}
   const measuredAt=performance.now(),live=await ask(await bitmap(video,video.videoWidth,video.videoHeight),10000);
   if(!active()||currentKey!==key()||run!==lifecycle)return;
   const instruction=core.patientInstruction(live,target),now=performance.now(),steady=core.steadyFace(live,lastFace);lastFace=live;
   if(candidate!==instruction.key){candidate=instruction.key;candidateAt=now;panel.classList.remove('patient-guide-close');if(instruction.okay)show('Resta fermo un momento…','Controllo che la posizione sia stabile.');}
   if(instruction.okay&&!steady){candidateAt=now;panel.classList.remove('patient-guide-close');show('Resta fermo un momento…','Controllo che la posizione sia stabile.');}
   if(now-candidateAt>=(instruction.okay?core.POSE_HOLD_MS:350))show(instruction.text,instruction.detail,instruction.okay);
   const eyes=core.eyeAlignmentStatus(live,target);
   if(instruction.okay&&!eyes.ready)show(eyes.eyes,'Controlla la trasparenza; lo scatto manuale resta disponibile.');
   const stable=!!instruction.okay&&steady&&now-candidateAt>=core.POSE_HOLD_MS&&!!core.afterFrameRank(live,target);
   window.dispatchEvent(new CustomEvent('hs-face-guide',{detail:{target,live,stable,eyes,measuredAt,context:currentKey,referenceURL:ref.url,patientId:cloud.patient?.id}}));
  }catch{
   if(enabled&&run===lifecycle){failed=true;dispose();show('Guida non disponibile','Puoi comunque usare lo scatto manuale.');$('togglePatientGuidance').textContent='Riprova';}
  }finally{busy=false;}
 }

 function beforeOptions(){return {phoneConfirmed:$('beforePhoneConfirmed')?.checked||false,level:currentLevel(),screenAngle:screen.orientation?.angle??window.orientation??0,kind:POSES[current].kind};}
 // Snapshot first, then evaluate that exact frame. Only the selected original is kept.
 async function captureBurst({valid},after){
  if(!enabled||failed||(after?(activeVisit===0||POSES[current].kind==='profile'):(activeVisit!==0||POSES[current].kind!=='front')))throw Error('Guida non disponibile. Puoi usare lo scatto manuale.');
  const currentKey=key(),video=$('video'),start=performance.now();
  while(busy){if(!valid()||performance.now()-start>2500)throw Error('Attendi che la guida sia pronta.');await new Promise(r=>setTimeout(r,40));}
  busy=true;
  const source=document.createElement('canvas'),best=document.createElement('canvas');let result=null,score=-1,bestRank=null,previous=null,goodFrames=0;
  try{
   await load();
   const ref=after?reference():null,target=after&&ref?await readReference(ref):null;
   if(after&&(!target||target.error||!availableCamera(ref)))throw Error('Prima o fotocamera non confrontabili. Verifica i riferimenti prima di riprovare.');
   for(let i=0;i<6;i++){
    if(!valid()||currentKey!==key()||document.hidden||!stream||video.readyState<2)throw Error('Raffica interrotta. Riprendi la posa e riprova.');
    if(performance.now()-start>4500)break;
    const rect=cropRect(video.videoWidth,video.videoHeight);source.width=rect.width;source.height=rect.height;source.getContext('2d').drawImage(video,rect.sx,rect.sy,rect.sw,rect.sh,0,0,rect.width,rect.height);
    const takenAt=new Date().toISOString(),level=currentLevel(),options={...beforeOptions(),level};
    const live=await ask(await bitmap(source,source.width,source.height),2500),rank=after?core.afterFrameRank(live,target):null;
    const phone=after?capturePositionState(level,ref,screen.orientation?.angle??window.orientation??0):null;
    const ready=after?!!rank&&availableCamera(ref)&&(!phone.recorded||(phone.usable&&phone.okay)):beforeCore.beforePoseState(live,options).ready;
    const steady=core.steadyFace(live,previous);previous=live;
    if(ready&&steady){
     goodFrames++;const sharp=beforeCore.faceSharpness(ctx.getImageData(0,0,450,600).data,450,600,live);
     const ranked=rank?{...rank,sharpness:sharp}:null;
     if(after?core.betterAfterFrame(ranked,bestRank):sharp>score){score=sharp;bestRank=ranked;best.width=source.width;best.height=source.height;best.getContext('2d').drawImage(source,0,0);result={canvas:best,rect,takenAt,level};}
    }
    window.dispatchEvent(new CustomEvent(after?'hs-after-burst-progress':'hs-before-burst-progress',{detail:{count:i+1}}));
    await new Promise(r=>setTimeout(r,120));
   }
   if(!valid()||currentKey!==key())throw Error('Raffica interrotta.');
   if(!result||goodFrames<2)throw Error('Posa non abbastanza stabile nella raffica. Riprova oppure usa lo scatto manuale.');
   return result;
  }finally{busy=false;source.width=0;lastFace=null;candidate='';candidateAt=0;}
 }
 window.hsBeforeBurst=options=>captureBurst(options,false);
 window.hsAfterBurst=options=>captureBurst(options,true);
 $('togglePatientGuidance').addEventListener('click',()=>{
  if(failed){failed=false;dispose();enabled=true;}else enabled=!enabled;
  $('togglePatientGuidance').setAttribute('aria-pressed',String(enabled));$('togglePatientGuidance').textContent=enabled?'Spegni':'Accendi';
  contextKey='';candidate='';lastFace=null;if(!enabled){dispose();show('Guida spenta','Segui la sagoma azzurra per ripetere la posa.');}tick();
 });
 setInterval(()=>{if(previousPatient!==cloud.patient?.id){previousPatient=cloud.patient?.id;cachedReference=null;cachedFace=null;cachedURL='';contextKey='';}tick();},350);
 window.addEventListener('pagehide',dispose);
})();
