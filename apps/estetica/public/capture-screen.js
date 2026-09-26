'use strict';
// Compact capture presentation. Original camera, sensor and burst handlers stay authoritative.
(()=>{
 const bar=document.createElement('div');bar.id='captureScreenBar';bar.hidden=true;
 bar.innerHTML='<button type="button" id="closeCaptureScreen" aria-label="Esci dallo schermo intero">← Esci</button><select id="capturePose" aria-label="Vista frontale"></select><button type="button" id="captureOptions">Opzioni</button>';
 document.body.append(bar);
 const enter=document.createElement('button');enter.id='openCaptureScreen';enter.className='secondary';enter.textContent='Schermo intero';$('cameraStatus').after(enter);
 const compact=document.createElement('section');compact.id='compactCapture';compact.hidden=true;
 compact.innerHTML='<small id="compactLevelLabel">Livella telefono</small><div id="compactLevel"><button type="button" id="compactEnableLevel">Attiva livella</button><div id="compactAxes"><span>Laterale <b id="compactRoll">—</b><i><em id="compactRollDot"></em></i></span><span>Avanti / indietro <b id="compactPitch">—</b><i><em id="compactPitchDot"></em></i></span></div></div><p id="compactInstruction" role="status" aria-live="polite"></p><label id="compactSetup"><input type="checkbox" id="compactPhoneConfirmed"> Lente all’altezza degli occhi, telefono dritto</label><div id="compactActions"><button type="button" id="compactShot" disabled>Attendi la posa…</button><button type="button" id="compactManual">Scatto manuale</button></div>';
 $('captureDock').prepend(compact);
 // Keep the existing zone workflow one tap away from live after capture.
 const zoneStart=$('startZoneGuide');zoneStart.textContent='Controlla occhi · profilo · fronte';
 $('compactActions').before(zoneStart);
 const zoneLevel=document.createElement('div');zoneLevel.id='zoneLevel';$('zoneGuide').querySelector('header').after(zoneLevel);
 const levelSlots=new Map(),openZones=zoneStart.onclick;
 let autoZoneKey='',zoneTimer=null;
 const zoneContext=()=>[cloud.patient?.id,activeVisit,current,captureReference()?.url,stream?.id].join('|');
 function restoreLevel(){for(const [node,slot]of levelSlots)slot.replaceWith(node);levelSlots.clear();}
 zoneStart.onclick=()=>{
  if(!stream||pending||captureBusy||activeVisit===0||!captureReference()||handoff||$('zoneGuide').open)return;
  autoZoneKey=zoneContext();
  for(const node of [$('compactLevelLabel'),$('compactLevel')]){const slot=document.createComment('live level');node.before(slot);levelSlots.set(node,slot);zoneLevel.append(node);}
  openZones();
  if(!$('zoneGuide').open)restoreLevel();
 };
 $('zoneGuide').addEventListener('close',()=>{restoreLevel();update();});

 const handoffBox=document.createElement('section');handoffBox.id='captureHandoff';handoffBox.hidden=true;
 handoffBox.innerHTML='<strong id="captureHandoffTitle" role="status"></strong><p id="captureHandoffHint"></p><button type="button" id="captureNextPhase" class="primary"></button><button type="button" id="captureRedo" class="text-button">Rifai la foto</button>';
 $('captureDock').prepend(handoffBox);
 const savedImage=document.createElement('img');savedImage.id='captureSavedImage';savedImage.alt='Foto appena acquisita';savedImage.hidden=true;$('cameraArea').append(savedImage);
 let handoff=null;
 const acceptBeforeHandoff=acceptPhoto;
 acceptPhoto=function(){
  if(!pending)return;
  const pose=current,visit=activeVisit,photo=pending,patientId=cloud.patient?.id;
  acceptBeforeHandoff();
  // Pause on the accepted pose instead of silently advancing to another expression.
  if(visits[visit]?.photos.get(POSES[pose].id)===photo){
   current=pose;handoff={patientId,visit,pose,photo};
   clearTimeout(toastTimer);$('toast').hidden=true;render();
  }
 };
 $('captureRedo').onclick=()=>{handoff=null;render();};
 $('captureNextPhase').onclick=()=>{
  if(!handoff||pending||captureBusy)return;
  const completed=handoff;
  if(completed.visit===0){
   if(!setView('after'))return;
   const selected=visits[activeVisit].selected,id=POSES[completed.pose].id;
   if(Array.isArray(selected)&&!selected.includes(id)){selected.push(id);revision++;}
   current=completed.pose;ghostVisible=true;render();if(!stream)startCamera();
  }else{
   if(!setView('compare'))return;
   compareA=0;compareB=completed.visit;comparePose=POSES[completed.pose].id;customSlots=[];renderComparison();
  }
  handoff=null;update();
 };

 const dialog=document.createElement('dialog');dialog.id='captureOptionsDialog';dialog.innerHTML='<div class="dialog-heading"><h2>Opzioni fotocamera</h2><button type="button" id="closeCaptureOptions" class="secondary">Chiudi</button></div><div id="captureOptionsContent"></div>';
 document.body.append(dialog);
 let lastStream=null,lastCaptureContext='',full=false;
 const originalParents=new Map();
 function options(close=false){
  if(close){dialog.close();for(const [node,slot]of originalParents){slot.replaceWith(node);}originalParents.clear();return;}
  for(const node of [$('cameraTools'),$('patientGuidance')]){const slot=document.createComment('capture options');node.before(slot);originalParents.set(node,slot);$('captureOptionsContent').append(node);}
  dialog.showModal();
 }
 dialog.addEventListener('close',()=>{for(const [node,slot]of originalParents)slot.replaceWith(node);originalParents.clear();});
 $('captureOptions').onclick=()=>options();$('closeCaptureOptions').onclick=()=>options(true);
 function setFull(value){full=value;document.body.classList.toggle('capture-full',full);bar.hidden=!full;enter.hidden=full;update();}
 $('closeCaptureScreen').onclick=()=>setFull(false);enter.onclick=()=>setFull(true);
 $('compactEnableLevel').onclick=()=>enableLevel();
 $('compactPhoneConfirmed').onchange=()=>{$('beforePhoneConfirmed').checked=$('compactPhoneConfirmed').checked;$('beforePhoneConfirmed').dispatchEvent(new Event('change'));update();};
 $('compactManual').onclick=()=>{if(!$('capture').disabled)$('capture').click();};
 $('compactShot').onclick=()=>{const b=$(activeVisit?'afterGuidedShot':'beforeGuidedShot');if(!b.disabled)b.click();update();};
 $('capturePose').onchange=()=>{handoff=null;selectPose(Number($('capturePose').value));update();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.open)setFull(false);});
 function update(){
  if(handoff&&(handoff.patientId!==cloud.patient?.id||handoff.visit!==activeVisit||handoff.pose!==current||view==='compare'||pending||visits[handoff.visit]?.photos.get(POSES[handoff.pose].id)!==handoff.photo))handoff=null;
  const active=!!cloud.patient&&view!=='compare'&&(!!stream||!!pending||!!handoff);
  const captureContext=active?[cloud.patient.id,activeVisit,view].join('|'):'';
  // Enter capture again when moving from before to after, even if the same stream stays open.
  if(active&&(captureContext!==lastCaptureContext||(stream&&stream!==lastStream)))full=true;
  lastCaptureContext=captureContext;lastStream=stream;
  if(!active)full=false;
  document.body.classList.toggle('capture-full',full);document.body.classList.toggle('compact-capture-active',active);
  bar.hidden=!full;enter.hidden=full||!active;compact.hidden=!active||!!pending;
  handoffBox.hidden=!handoff;savedImage.hidden=!handoff;
  document.body.classList.toggle('capture-handoff',!!handoff);
  if(handoff){
   if(savedImage.getAttribute('src')!==handoff.photo.url)savedImage.src=handoff.photo.url;
   const before=handoff.visit===0;
   $('captureHandoffTitle').textContent=before?'Prima foto acquisita':'Foto del dopo acquisita';
   $('captureHandoffHint').textContent=before?'Lascia il telefono in posizione. Per il dopo, mantieni lo stesso obiettivo e la stessa luce.':'Ora puoi vedere le due foto a confronto.';
   $('captureNextPhase').textContent=before?'Scatta il dopo quando sei pronto':'Confronta prima e dopo';
  }else savedImage.removeAttribute('src');
  if(handoff)$('cameraFacing').disabled=true;
  if(!active&&dialog.open)options(true);
  const ids=sequenceIds(),signature=ids.join('|');
  if($('capturePose').dataset.ids!==signature){$('capturePose').replaceChildren(...ids.map(id=>new Option(POSES.find(p=>p.id===id).title,String(POSES.findIndex(p=>p.id===id)))));$('capturePose').dataset.ids=signature;}
  $('capturePose').value=String(current);$('capturePose').disabled=!!pending||captureBusy;
  const ref=captureReference(),s=capturePositionState(currentLevel(),ref,screen.orientation?.angle??window.orientation??0);
  $('compactEnableLevel').hidden=s.usable;$('compactAxes').classList.toggle('level-okay',s.okay);
  for(const [axis,val]of [['Roll',s.roll],['Pitch',s.pitch]]){$('compact'+axis).textContent=val===null?'—':Math.abs(val).toFixed(0)+'°';$('compact'+axis+'Dot').hidden=val===null;$('compact'+axis+'Dot').style.left=(50+Math.max(-20,Math.min(20,val||0))*2)+'%';}
  $('compactLevel').title=ref?.level?'Differenza rispetto all’inclinazione del prima':'Porta i due indicatori al centro';
  $('compactLevelLabel').textContent=!s.usable?'Livella telefono · attiva il sensore':!s.portrait?'Livella · tieni il telefono verticale':!s.compatible?'Livella · orientamento del prima diverso':s.recorded?(s.okay?'Livella · inclinazione del prima ritrovata':'Livella · ripeti l’inclinazione del prima'):(s.okay?'Livella · telefono dritto':'Livella · porta gli indicatori al centro');
  const confirmed=$('beforePhoneConfirmed').checked;
  $('compactPhoneConfirmed').checked=confirmed;$('compactSetup').hidden=activeVisit!==0||confirmed;
  const source=$(activeVisit?'afterGuidedShot':'beforeGuidedShot'),ready=!source.disabled&&!captureBusy;
  $('compactShot').disabled=source.disabled||captureBusy;
  $('compactShot').classList.toggle('ready',ready);
  $('compactShot').textContent=captureBusy?source.textContent:ready?'Scatta ora · raffica':'Attendi la posa…';
  $('compactManual').disabled=$('capture').disabled;
  zoneStart.disabled=captureBusy||!!handoff;
  // Start the actual magnified eye/contour workflow when entering after capture.
  // Defer until the navigation has finished choosing the matching pose.
  if(activeVisit===0||view==='compare'||!stream)autoZoneKey='';
  if(full&&activeVisit>0&&stream&&!pending&&!handoff&&!captureBusy&&ref&&!dialog.open&&!$('zoneGuide').open&&autoZoneKey!==zoneContext()&&!zoneTimer){
   zoneTimer=setTimeout(()=>{
    zoneTimer=null;
    if(full&&activeVisit>0&&stream&&!pending&&!handoff&&!captureBusy&&captureReference()&&!dialog.open&&!$('zoneGuide').open&&autoZoneKey!==zoneContext())zoneStart.click();
   },250);
  }
  let message=captureBusy?'Resta fermo: scelgo la foto migliore.':ready?'Posa stabile. Premi Scatta ora.':$('patientGuideInstruction').textContent;
  if(!captureBusy&&!ready&&activeVisit===0&&!confirmed)message='Sistema il telefono all’altezza degli occhi e conferma sotto.';
  // Phone corrections stay in the level strip, leaving facial guidance visible at the same time.
  else if(!captureBusy&&!ready&&activeVisit>0&&source.textContent==='Ripristina la fotocamera del prima')message=source.textContent;
  else if(!captureBusy&&!ready&&activeVisit>0&&$('togglePatientGuidance').getAttribute('aria-pressed')!=='true')message='Attiva la guida in Opzioni per le indicazioni sulla posa.';
  if($('compactInstruction').textContent!==message)$('compactInstruction').textContent=message;
  // Size the preview to the remaining space without changing its 3:4 crop.
  if(full){const height=window.visualViewport?.height||window.innerHeight,top=bar.getBoundingClientRect().height,bottom=$('captureDock').getBoundingClientRect().height;document.documentElement.style.setProperty('--capture-screen-height',height+'px');document.documentElement.style.setProperty('--capture-screen-top',top+'px');document.documentElement.style.setProperty('--capture-screen-bottom',bottom+'px');}
 }
 const prior=renderFlow;renderFlow=function(){prior();update();};
 window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);
 setInterval(update,200);update();
})();
