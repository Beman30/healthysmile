'use strict';
(()=>{
 const controls=document.createElement('div');controls.id='beforeGuideControls';controls.hidden=true;
 controls.innerHTML=`<div id="beforeChecklist" aria-label="Controlli contemporanei della posa"></div>
 <details id="beforeSetup" open><summary>Postazione</summary><p>Lente all’altezza degli occhi, telefono verticale sul supporto. Sguardo verso l’obiettivo.</p><button type="button" id="beforeLevel">Attiva livella</button><label><input id="beforePhoneConfirmed" type="checkbox"> Ho verificato altezza e telefono dritto</label></details>
 <button type="button" id="beforeGuidedShot" disabled>Attendo una posa stabile…</button><small id="beforeGuideNote">Stima della posa frontale. Il pulsante rotondo resta lo scatto manuale.</small>`;
 $('patientGuidance').append(controls);
 const labels={phone:'Telefono',distance:'Distanza',eyes:'Occhi',center:'Centratura',yaw:'Rotazione',chin:'Mento'};
 for(const [key,label]of Object.entries(labels)){const el=document.createElement('div');el.innerHTML='<small></small><span></span>';el.firstChild.textContent=label;el.lastChild.textContent='Da verificare';el.id='beforeCheck-'+key;$('beforeChecklist').append(el);}
 const canvas=document.createElement('canvas');canvas.id='beforeEyeGuide';canvas.width=450;canvas.height=600;canvas.hidden=true;canvas.setAttribute('aria-hidden','true');$('cameraArea').append(canvas);const ctx=canvas.getContext('2d');
 let sample=null,phoneKey='',wasBusy=false;
 const context=()=>[cloud.patient?.id,activeVisit,current,undefined,stream?.id].join('|');
 const first=()=>activeVisit===0&&!!stream&&!pending&&view!=='compare';
 function draw(){
  ctx.clearRect(0,0,450,600);
  // Framing marks are separate from anatomy; no generic oval or artificial symmetry.
  ctx.strokeStyle='#26ffe0';ctx.lineWidth=2;ctx.setLineDash([6,6]);ctx.beginPath();ctx.moveTo(130,216);ctx.lineTo(320,216);ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(225,199);ctx.lineTo(225,233);ctx.stroke();
  if(sample?.context!==context()||performance.now()-sample.measuredAt>1800||sample.live?.error)return;
  const a=sample.live.anchors;if(!a)return;
  ctx.strokeStyle='#ffd166';ctx.fillStyle='#ffd166';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(a[0][0]*450,a[0][1]*450);ctx.lineTo(a[3][0]*450,a[3][1]*450);ctx.stroke();
  for(const i of [0,3]){ctx.beginPath();ctx.arc(a[i][0]*450,a[i][1]*450,4,0,Math.PI*2);ctx.fill();}
 }
 function update(){
  const before=first(),front=POSES[current].kind==='front',on=$('togglePatientGuidance').getAttribute('aria-pressed')==='true';
  controls.hidden=!before;document.body.classList.toggle('before-guided',before&&front&&on);
  canvas.hidden=!before||!front||!on;draw();
  const newKey=[cloud.patient?.id,stream?.id,stream?.getVideoTracks()[0]?.getSettings()?.zoom].join('|');
  if(newKey!==phoneKey){phoneKey=newKey;$('beforePhoneConfirmed').checked=false;$('beforeSetup').open=true;sample=null;}
  const fresh=on&&sample&&sample.context===context()&&performance.now()-sample.measuredAt<1800&&!sample.unavailable;
  for(const key of Object.keys(labels)){
   const status=fresh?sample.state.checks[key]:null,el=$('beforeCheck-'+key);el.dataset.state=status?.okay?'okay':'wait';const text=status?.text||'Da verificare';if(el.lastChild.textContent!==text)el.lastChild.textContent=text;
  }
  const ready=before&&front&&fresh&&sample.stable&&$('beforePhoneConfirmed').checked;
  $('beforeGuidedShot').disabled=!ready||captureBusy;
  if(!captureBusy)$('beforeGuidedShot').textContent=!on?'Attiva la guida per lo scatto':!front?'Questa vista usa lo scatto manuale':ready?'Scatto guidato · breve raffica':'Attendo una posa stabile…';
  if(wasBusy&&!captureBusy){sample=null;}wasBusy=captureBusy;
 }
 $('beforeLevel').onclick=()=>enableLevel();
 $('beforePhoneConfirmed').onchange=()=>{sample=null;if($('beforePhoneConfirmed').checked)$('beforeSetup').open=false;update();};
 $('beforeGuidedShot').onclick=()=>{if($('beforeGuidedShot').disabled)return;window.hsBeforeCaptureRequested=true;$('beforeGuidedShot').textContent='Resta fermo…';$('capture').click();};
 window.addEventListener('hs-before-guide',({detail})=>{sample=detail.unavailable?null:detail;update();});
 window.addEventListener('hs-before-burst-progress',({detail})=>{$('beforeGuidedShot').textContent='Resta fermo · '+detail.count+'/6';});
 setInterval(update,200);update();
})();
