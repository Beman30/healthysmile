'use strict';
// Capture guidance uses gravity readings, never a perspective warp of patient images.
function captureReference(){return activeVisit>0?visits[0].photos.get(POSES[current].id):null;}
function validCaptureLevel(level){return !!level&&Number.isFinite(level.roll)&&Number.isFinite(level.pitch)&&Math.abs(level.roll)<=90&&Math.abs(level.pitch)<=90;}
function capturePositionState(live,reference,screenAngle=0){
 const recorded=validCaptureLevel(reference?.level)?reference.level:null;
 const target=recorded||{roll:0,pitch:0};
 const usable=validCaptureLevel(live);
 const portrait=((screenAngle%360)+360)%360===0;
 const compatible=!recorded||recorded.screenAngle===undefined||recorded.screenAngle===0;
 const roll=usable?live.roll-target.roll:null,pitch=usable?live.pitch-target.pitch:null;
 // 3 degrees is an operator aid, not a validated clinical equivalence threshold.
 return {recorded:!!recorded,usable,portrait,compatible,roll,pitch,okay:usable&&portrait&&compatible&&Math.abs(roll)<=3&&Math.abs(pitch)<=3};
}
function cameraMatchState(reference,track){
 if(!reference||!track)return {text:'',warning:false};
 const previous=reference.camera||{},now=track.getSettings();
 const different=previous.deviceId&&now.deviceId?previous.deviceId!==now.deviceId:previous.label&&previous.label!=='Foto importata'&&track.label?previous.label!==track.label:false;
 const zoomDifferent=Number.isFinite(previous.zoom)&&Number.isFinite(now.zoom)&&Math.abs(previous.zoom-now.zoom)>.01;
 if(different)return {text:'da verificare',warning:true,detail:'La fotocamera risulta diversa dal prima. Seleziona lo stesso obiettivo; usa lo stesso telefono.'};
 if(zoomDifferent)return {text:'zoom diverso',warning:true,detail:'Lo zoom risulta diverso dal prima. Riprendi la stessa regolazione prima di scattare.'};
 if(!previous.deviceId)return {text:'da verificare',warning:false,detail:'Obiettivo del prima non verificabile. Usa lo stesso telefono e zoom; confronta occhi, naso e mento in trasparenza.'};
 return {text:'stesso obiettivo',warning:false,detail:'Mantieni la distanza dal paziente. Chiedi al paziente di seguire la guida. Confronta occhi, naso e mento, senza cambiare zoom.'};
}
function paintCapturePosition(){
 const panel=$('captureMatch');panel.hidden=!!pending||view==='compare';
 if(panel.hidden)return;
 const ref=captureReference(),live=stream?currentLevel():null,state=capturePositionState(live,ref,screen.orientation?.angle??window.orientation??0);
 $('matchTitle').textContent=state.recorded?'Ripeti l’inclinazione del prima':'Telefono dritto';
 panel.classList.toggle('position-ok',state.okay);panel.classList.toggle('position-warn',state.usable&&!state.okay);
 for(const [key,delta]of [['Roll',state.roll],['Pitch',state.pitch]]){
  $('match'+key).textContent=delta===null?'—':`${Math.abs(delta).toFixed(0)}°`;
  $('match'+key+'Dot').hidden=delta===null;
  $('match'+key+'Dot').style.left=`${50+Math.max(-20,Math.min(20,delta||0))*2}%`;
 }
 $('enableLevel').hidden=state.usable;
 if(!state.usable&&$('enableLevel').textContent!=='Attendo il sensore…')$('enableLevel').textContent='Attiva livella';
 let status=!stream?'Avvia la fotocamera e attiva la livella.':!state.usable?'Inclinazione non verificata: attiva la livella o usa il supporto in bolla.':!state.portrait?'Tieni il telefono verticale, con la parte alta verso l’alto.':!state.compatible?'Il prima è stato scattato con un orientamento diverso. Usa il riferimento visivo.':state.okay?(state.recorded?'Inclinazione simile al prima. Controlla anche la testa.':'Telefono in bolla. Controlla anche la testa.'):'Muovi lentamente il telefono: porta entrambi gli indicatori al centro.';
 if(ref&&!state.recorded)status+=' Il prima non contiene dati di inclinazione: non posso recuperarli dalla foto.';
 $('matchStatus').textContent=status;
 $('matchPoseHint').textContent=ref?'Sistema la fotocamera all’altezza del viso. Poi il paziente segue le indicazioni della guida: controlla anche il prima in trasparenza ed espressione.':'Lente all’altezza degli occhi, testa naturale. Alza o abbassa il supporto senza inclinare il telefono.';
 const camera=cameraMatchState(ref,stream?.getVideoTracks()[0]);
 $('matchCameraStatus').textContent=camera.text;$('matchCameraStatus').className=camera.warning?'warn-text':'';
 $('matchCameraHint').textContent=camera.detail||'Puoi scegliere frontale o posteriore. Per il dopo ripeti lo stesso obiettivo e zoom del prima.';
 if(camera.warning)$('matchStatus').textContent+=' Attenzione: obiettivo o zoom diversi.';
 // Old one-axis needle would imply an absolute level even when matching a tilted reference.
 $('levelOverlay').hidden=true;
}
const renderBeforePosition=renderFlow;
renderFlow=function(){renderBeforePosition();paintCapturePosition();};
setInterval(paintCapturePosition,200);
paintCapturePosition();
