'use strict';
// Compact capture presentation. Original camera, sensor and burst handlers stay authoritative.
(()=>{
 const bar=document.createElement('div');bar.id='captureScreenBar';bar.hidden=true;
 bar.innerHTML='<button type="button" id="closeCaptureScreen" aria-label="Esci dallo schermo intero">← Esci</button><select id="capturePose" aria-label="Vista frontale"></select><button type="button" id="captureOptions">Opzioni</button>';
 document.body.append(bar);
 const enter=document.createElement('button');enter.id='openCaptureScreen';enter.className='secondary';enter.textContent='Schermo intero';$('cameraStatus').after(enter);
 const compact=document.createElement('section');compact.id='compactCapture';compact.hidden=true;
 compact.innerHTML='<div id="compactLevel"><button type="button" id="compactEnableLevel">Attiva livella</button><div id="compactAxes"><span>Laterale <b id="compactRoll">—</b><i><em id="compactRollDot"></em></i></span><span>Avanti / indietro <b id="compactPitch">—</b><i><em id="compactPitchDot"></em></i></span></div></div><p id="compactInstruction" role="status" aria-live="polite"></p><label id="compactSetup"><input type="checkbox" id="compactPhoneConfirmed"> Lente all’altezza degli occhi, telefono dritto</label><div id="compactActions"><button type="button" id="compactShot" disabled>Attendi la posa…</button><button type="button" id="compactManual">Scatto manuale</button></div>';
 $('captureDock').prepend(compact);
 const dialog=document.createElement('dialog');dialog.id='captureOptionsDialog';dialog.innerHTML='<div class="dialog-heading"><h2>Opzioni fotocamera</h2><button type="button" id="closeCaptureOptions" class="secondary">Chiudi</button></div><div id="captureOptionsContent"></div>';
 document.body.append(dialog);
 let lastStream=null,full=false;
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
 $('capturePose').onchange=()=>{selectPose(Number($('capturePose').value));update();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.open)setFull(false);});
 function update(){
  const active=!!cloud.patient&&view!=='compare'&&(!!stream||!!pending);
  if(stream&&stream!==lastStream){lastStream=stream;full=true;}
  if(!active)full=false;
  document.body.classList.toggle('capture-full',full);document.body.classList.toggle('compact-capture-active',active);
  bar.hidden=!full;enter.hidden=full||!active;compact.hidden=!active||!!pending;
  if(!active&&dialog.open)options(true);
  const ids=sequenceIds(),signature=ids.join('|');
  if($('capturePose').dataset.ids!==signature){$('capturePose').replaceChildren(...ids.map(id=>new Option(POSES.find(p=>p.id===id).title,String(POSES.findIndex(p=>p.id===id)))));$('capturePose').dataset.ids=signature;}
  $('capturePose').value=String(current);$('capturePose').disabled=!!pending||captureBusy;
  const ref=captureReference(),s=capturePositionState(currentLevel(),ref,screen.orientation?.angle??window.orientation??0);
  $('compactEnableLevel').hidden=s.usable;$('compactAxes').classList.toggle('level-okay',s.okay);
  for(const [axis,val]of [['Roll',s.roll],['Pitch',s.pitch]]){$('compact'+axis).textContent=val===null?'—':Math.abs(val).toFixed(0)+'°';$('compact'+axis+'Dot').hidden=val===null;$('compact'+axis+'Dot').style.left=(50+Math.max(-20,Math.min(20,val||0))*2)+'%';}
  $('compactLevel').title=ref?.level?'Differenza rispetto all’inclinazione del prima':'Porta i due indicatori al centro';
  const confirmed=$('beforePhoneConfirmed').checked;
  $('compactPhoneConfirmed').checked=confirmed;$('compactSetup').hidden=activeVisit!==0||confirmed;
  const source=$(activeVisit?'afterGuidedShot':'beforeGuidedShot'),ready=!source.disabled&&!captureBusy;
  $('compactShot').disabled=source.disabled||captureBusy;
  $('compactShot').classList.toggle('ready',ready);
  $('compactShot').textContent=captureBusy?source.textContent:ready?'Scatta ora · raffica':'Attendi la posa…';
  $('compactManual').disabled=$('capture').disabled;
  let message=captureBusy?'Resta fermo: scelgo la foto migliore.':ready?'Posa stabile. Premi Scatta ora.':$('patientGuideInstruction').textContent;
  if(!captureBusy&&!ready&&activeVisit===0&&!confirmed)message='Sistema il telefono all’altezza degli occhi e conferma sotto.';
  else if(!captureBusy&&!ready&&activeVisit>0&&source.textContent!=='Attendo la posa del prima…')message=source.textContent;
  if($('compactInstruction').textContent!==message)$('compactInstruction').textContent=message;
  // Size the preview to the remaining space without changing its 3:4 crop.
  if(full){const height=window.visualViewport?.height||window.innerHeight,top=bar.getBoundingClientRect().height,bottom=$('captureDock').getBoundingClientRect().height;document.documentElement.style.setProperty('--capture-screen-height',height+'px');document.documentElement.style.setProperty('--capture-screen-top',top+'px');document.documentElement.style.setProperty('--capture-screen-bottom',bottom+'px');}
 }
 const prior=renderFlow;renderFlow=function(){prior();update();};
 window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);
 setInterval(update,200);update();
})();
