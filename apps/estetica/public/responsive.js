'use strict';
// Reuse the existing controls and navigation guards in the compact layout.
(() => {
 const menu=$('appMenu'),toggle=$('menuToggle');
 const mobile=matchMedia('(max-width: 900px)');
 const compact=()=>mobile.matches;
 function placeCameraTools(){
  const target=compact()?$('cameraTools'):$('cameraArea');
  target.append($('guideAdjustment'),$('ghostControls'));
 }
 mobile.addEventListener('change',placeCameraTools);placeCameraTools();
 function closeMenu(){if(menu.open)menu.close();toggle.setAttribute('aria-expanded','false');}
 function focusSection(element){element.scrollIntoView({block:'start',behavior:'auto'});}
 toggle.addEventListener('click',()=>{
  $('menuPatient').textContent=$('cloudPatientLabel').textContent;
  for(const button of menu.querySelectorAll('[data-patient-action]'))button.disabled=!cloud.patient||cloud.loading;
  $('menuPatients').disabled=$('patientPicker').disabled;
  $('menuVisit').disabled=!cloud.patient||cloud.loading||!!pending||captureBusy||importBusy;
  $('menuSequence').disabled=!cloud.patient||cloud.loading||!!pending||captureBusy||importBusy;
  $('settingsButton').disabled=!!pending||captureBusy||importBusy;
  menu.showModal();toggle.setAttribute('aria-expanded','true');
 });
 $('dockStart').addEventListener('click',()=>$('startCamera').click());
 $('closeMenu').addEventListener('click',closeMenu);
 menu.addEventListener('close',()=>toggle.setAttribute('aria-expanded','false'));
 menu.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(button&&!button.disabled&&button.id!=='closeMenu'){
   closeMenu();
   if(button.id==='importCurrent'&&view==='compare')setView(activeVisit?'after':'before');
  }
 },true);
 menu.addEventListener('click',event=>{
  if(event.target===menu){const r=menu.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeMenu();}
 });
 $('menuPatients').addEventListener('click',()=>$('patientPicker').click());
 $('menuNotes').addEventListener('click',()=>{
  $('patientNotesPanel').open=true;focusSection($('patientNotesPanel'));$('patientNotes').focus({preventScroll:true});
 });
 $('poseList').addEventListener('click',()=>{if(compact()&&stream&&!pending)requestAnimationFrame(()=>focusSection($('cameraArea')));});
 $('menuVisit').addEventListener('click',()=>{if(readyToNavigate())$('visitDialog').showModal();});
 $('closeVisit').addEventListener('click',()=>$('visitDialog').close());
 $('newFollowup').addEventListener('click',()=>$('visitDialog').close());
 $('menuSequence').addEventListener('click',()=>{
  if(view==='compare'&&!setView(activeVisit?'after':'before'))return;
  const sequence=document.querySelector('.sequence');focusSection(sequence);sequence.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
 });
 showSettings=function(show){
  $('settings').hidden=!show;
  if(show&&!$('stationDialog').open){$('stationDialog').showModal();}
  else if(!show&&$('stationDialog').open)$('stationDialog').close();
  $('settingsButton').setAttribute('aria-expanded',String(show));
 };
 $('stationDialog').addEventListener('close',()=>{$('settings').hidden=true;$('settingsButton').setAttribute('aria-expanded','false');});
 // Do not let the shutter overlap a keyboard used for patient notes or forms.
 const editing=()=>document.body.classList.toggle('editing-field',!!document.activeElement?.matches('textarea,input:not([type=range]):not([type=checkbox]):not([type=hidden]),[contenteditable=true]'));
 document.addEventListener('focusin',editing);document.addEventListener('focusout',()=>requestAnimationFrame(editing));
 let hadStream=false,hadPending=false;
 const previousFlow=renderFlow;
 renderFlow=function(){
  previousFlow();
  document.body.classList.toggle('capture-view',!!cloud.patient&&view!=='compare');
  document.body.classList.toggle('camera-idle',!stream&&!pending);
  $('dockStart').disabled=$('startCamera').disabled;
  $('dockStart').textContent=cameraBusy?'Attendo il permesso…':'Attiva fotocamera';
  $('dockPose').textContent=pending?'Controlla la foto prima di confermare':`${activeVisit?'Dopo':'Prima'} · ${POSES[current].title}`;
  if(compact()&&view!=='compare'&&((stream&&!hadStream)||(!!pending!==hadPending))){
   requestAnimationFrame(()=>focusSection($('cameraArea')));
  }
  hadStream=!!stream;hadPending=!!pending;
 };
 // Account for text wrapping, browser text scaling and the phone's bottom inset.
 const dockObserver=new ResizeObserver(()=>document.documentElement.style.setProperty('--capture-dock-height',`${$('captureDock').getBoundingClientRect().height}px`));
 dockObserver.observe($('captureDock'));
 renderFlow();
})();
