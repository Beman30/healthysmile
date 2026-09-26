'use strict';
(()=>{
 const box=document.createElement('div');box.id='afterBurstControls';box.hidden=true;
 box.innerHTML='<button type="button" id="afterGuidedShot" disabled>Attendo la posa del prima…</button><small id="afterBurstHint">Scelgo la posa più vicina al prima; a parità di posa, la foto più nitida.</small>';
 $('patientGuidance').append(box);
 const zoneButton=document.createElement('button');zoneButton.type='button';zoneButton.id='zoneBurst';zoneButton.textContent='Raffica guidata';zoneButton.hidden=true;$('zoneGuide').querySelector('footer').append(zoneButton);
 let sample=null,wasBusy=false;
 const context=()=>[cloud.patient?.id,activeVisit,current,captureReference()?.url,stream?.id].join('|');
 function state(){
  const ref=captureReference(),after=activeVisit>0&&!!stream&&!pending&&view!=='compare',on=$('togglePatientGuidance').getAttribute('aria-pressed')==='true';
  const fresh=sample&&sample.context===context()&&performance.now()-sample.measuredAt<1800;
  const phone=capturePositionState(currentLevel(),ref,screen.orientation?.angle??window.orientation??0);
  const phoneOkay=!phone.recorded||phone.okay,cameraOkay=!cameraMatchState(ref,stream?.getVideoTracks()[0]).warning;
  const ready=after&&on&&fresh&&sample.stable&&phoneOkay&&cameraOkay&&POSES[current].kind!=='profile'&&!captureBusy;
  return {after,ready,on,phone,phoneOkay,cameraOkay};
 }
 function update(){
  const s=state();box.hidden=!s.after;
  $('afterGuidedShot').disabled=!s.ready;zoneButton.disabled=!s.ready;
  zoneButton.hidden=!$('zoneGuide').open||!$('zoneZoom').disabled;
  if(!captureBusy){
   $('afterGuidedShot').textContent=!s.on?'Attiva la guida per la raffica':POSES[current].kind==='profile'?'Profilo: usa lo scatto manuale':!s.phoneOkay?(s.phone.usable?'Ripeti l’inclinazione del telefono':'Attiva la livella del telefono'):!s.cameraOkay?'Ripristina la fotocamera del prima':s.ready?'Scatto guidato del dopo · raffica':'Attendo la posa del prima…';
   zoneButton.textContent='Raffica guidata';
  }
  if(wasBusy&&!captureBusy)sample=null;wasBusy=captureBusy;
 }
 function take(){
  if(!state().ready)return;
  $('zoneGuide').close();window.hsAfterCaptureRequested=true;$('afterGuidedShot').textContent='Resta fermo…';$('capture').click();update();
 }
 $('afterGuidedShot').onclick=take;zoneButton.onclick=take;
 window.addEventListener('hs-face-guide',({detail})=>{sample=detail.unavailable?null:detail;update();});
 window.addEventListener('hs-after-burst-progress',({detail})=>{$('afterGuidedShot').textContent='Resta fermo · '+detail.count+'/6';});
 setInterval(update,200);update();
})();
