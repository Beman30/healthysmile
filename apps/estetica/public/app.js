'use strict';
// Camera capture keeps originals unchanged. Cloud persistence is handled by cloud.js.
const $ = id => document.getElementById(id);
const POSES = [
 {id:'front-neutral',title:'Frontale a riposo',note:'Viso rilassato',kind:'front',instruction:'Spalle rilassate, sguardo dritto, labbra a riposo senza stringerle.'},
 {id:'front-smile',title:'Frontale con sorriso',note:'Sorriso naturale',kind:'front',instruction:'Mantieni testa e spalle nella stessa posizione. Sorridi mostrando i denti, senza forzare.'},
 {id:'oblique-right',title:'Tre quarti destro',note:'Lato destro · gira circa a metà',kind:'oblique',instruction:'Mostra il lato destro del paziente: naso verso la destra dello schermo. Gira busto e testa insieme, a metà tra frontale e profilo. Devono vedersi entrambi gli occhi; non serve il grado esatto.'},
 {id:'profile-right',title:'Profilo destro',note:'Lato destro del paziente · 90°',kind:'profile',instruction:'Mostra il lato destro del paziente: naso verso la destra dello schermo. Ruota insieme busto e testa di 90°. Sguardo orizzontale.'},
 {id:'oblique-left',title:'Tre quarti sinistro',note:'Lato sinistro · gira circa a metà',kind:'oblique',flip:true,instruction:'Mostra il lato sinistro del paziente: naso verso la sinistra dello schermo. Gira busto e testa insieme, a metà tra frontale e profilo. Devono vedersi entrambi gli occhi; non serve il grado esatto.'},
 {id:'profile-left',title:'Profilo sinistro',note:'Lato sinistro del paziente · 90°',kind:'profile',flip:true,instruction:'Mostra il lato sinistro del paziente: naso verso la sinistra dello schermo. Ruota insieme busto e testa di 90°. Sguardo orizzontale.'},
 {id:'front-brows',title:'Sopracciglia sollevate',note:'Mimica frontale · facoltativa',kind:'front',instruction:'Torna frontale. Solleva le sopracciglia senza inclinare la testa. Vista aggiuntiva per documentare la mimica della fronte.'}
];
const OUTLINES = {
 front:'M80 182 C69 88 99 60 150 60 C201 60 231 88 220 182 C237 173 233 220 214 224 C207 268 185 301 150 305 C115 301 93 268 86 224 C67 220 63 173 80 182 Z M107 157h25 M168 157h25',
 oblique:'M87 181 C70 125 81 79 123 62 C170 44 210 78 215 120 C219 146 221 176 216 207 C210 256 190 293 163 303 C128 297 107 273 95 230 C77 228 71 177 87 181 Z M99 185 C86 171 81 187 90 211 L98 216 M128 157 Q144 148 160 157 Q146 166 128 157 M190 156 Q201 149 211 156 Q202 164 190 156 M175 156 Q181 178 201 190 Q211 202 191 205 L181 203 M157 235 Q176 240 192 234',
 profile:'M90 200 C57 161 66 95 108 70 C156 41 208 68 207 117 L204 145 L218 172 L235 190 Q237 199 213 201 L214 218 L221 223 L213 234 Q222 255 202 268 L184 276 M91 216 Q97 235 113 244 M107 168 Q89 157 91 188 Q91 214 106 207 M189 155h14'
};
const SHOULDERS = {
 front:'M111 283 L108 323 Q76 338 -20 351 Q-59 357 -65 392 L-68 440 M189 283 L192 323 Q224 338 320 351 Q359 357 365 392 L368 440',
 oblique:'M117 280 L113 326 Q73 344 3 362 Q-27 380 -35 440 M191 280 L191 315 Q232 333 263 361 Q283 391 286 440',
 profile:'M184 276 Q170 292 177 323 Q232 340 285 363 Q313 380 315 440 M113 244 L111 319 Q68 343 35 365 Q12 385 10 440'
};
let current = 0, stream = null, pending = null, cameraBusy = false, cameraChoiceExplicit = false, captureBusy = false;
let cameraGeneration = 0, countdownGeneration = 0, revision = 0, exportRevision = -1;
let photos = new Map(); const references = new Map();
let lastLevel = null, sensorActive = false, sensorTimer, toastTimer;
const localDate = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
$('visitDate').value = localDate();
function notify(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,6500); }
function revoke(item) { if(item?.url) URL.revokeObjectURL(item.url); }
function currentLevel() { return lastLevel && Date.now()-lastLevel.at<1500 ? {...lastLevel} : null; }
function stationValues() {return {name:$('station').value.trim(),lights:$('lights').value.trim(),guideScale:Number($('guideScale').value),shoulderWidth:Number($('shoulderWidth').value),guideVersion:3};}
function cancelCountdown() {countdownGeneration++; captureBusy=false; document.querySelector('.countdown')?.remove();}
function discardPending() {revoke(pending); pending=null; $('reviewImage').removeAttribute('src');}
function render() {
 $('cameraFacing').disabled=cameraBusy||captureBusy||!!pending;
 const p=POSES[current], count=photos.size; $('patientCode').readOnly=!!count||!!pending||captureBusy; $('visitDate').readOnly=!!count||!!pending||captureBusy;
 $('poseTitle').textContent=p.title; $('instruction').textContent=p.instruction;
 $('stepCount').textContent=`SCATTO ${current+1} DI ${POSES.length}`;
 $('progressText').textContent=`${count} / ${POSES.length}`;
 $('completionLabel').textContent=count===7?'Completata':`${count} confermate`;
 $('outline').innerHTML=`<g${p.flip?' transform="translate(300 0) scale(-1 1)"':''}><path class="guide-margin" d="${OUTLINES[p.kind].split(' M')[0]}"/><path d="${OUTLINES[p.kind]}"/><g transform="translate(150 0) scale(${Number($('shoulderWidth').value)/100} 1) translate(-150 0)"><path class="shoulder-guide" d="${SHOULDERS[p.kind]}"/></g></g>`;
 $('poseList').replaceChildren(...POSES.map((pose,i)=>{
  const li=document.createElement('li'), b=document.createElement('button');b.className='pose-button'+(photos.has(pose.id)?' complete':''); b.type='button';b.setAttribute('aria-current',String(i===current));
  const n=document.createElement('span');n.className='pose-number';n.textContent=photos.has(pose.id)?'✓':String(i+1);
  const label=document.createElement('span');label.className='pose-name';label.textContent=pose.title;
  const note=document.createElement('span');note.className='pose-note';note.textContent=pose.note;label.append(note);b.append(n,label);
  if(photos.has(pose.id)){const thumb=document.createElement('img');thumb.className='pose-thumb';thumb.src=photos.get(pose.id).url;thumb.alt='Foto confermata';b.append(thumb);}
  b.addEventListener('click',()=>selectPose(i));li.append(b);return li;
 }));
 $('reviewImage').hidden=!pending; if(pending) $('reviewImage').src=pending.url;
 $('guideAdjustment').hidden=!stream||!!pending; $('reviewControls').hidden=!pending; $('liveControls').hidden=!!pending;
 $('cameraEmpty').hidden=!!stream||!!pending;
 $('guide').hidden=!$('showGuide').checked||!!pending; $('guideFrame').setAttribute('transform',`translate(150 165) scale(${Number($('guideScale').value)/100}) translate(-150 -157)`); $('shoulderWidthValue').textContent=`${$('shoulderWidth').value}%`; $('guideScaleValue').textContent=`${$('guideScale').value}%`; $('levelOverlay').hidden=!!pending||!currentLevel();
 $('cameraBadge').hidden=!stream||!!pending; $('stopCamera').hidden=!stream;
 $('capture').disabled=!stream||captureBusy||$('video').readyState<2;
 $('prevPose').disabled=current===0; $('nextPose').disabled=current===POSES.length-1;
 $('accept').textContent=current===POSES.length-1?'Conferma foto':'Conferma e continua';
 $('exportZip').disabled=!count; $('sharePhotos').disabled=!count;$('saveSessionPhotos').disabled=!count;$('saveSinglePhoto').disabled=!pending&&!photos.has(p.id);
 $('sharePhotos').hidden=false;
 $('captureHint').textContent=pending?'Controlla nitidezza, luce, posa e occhi aperti prima di confermare.':photos.has(p.id)?'Vista già acquisita. Un nuovo scatto la sostituisce solo dopo conferma.':'Scatto manuale · controlla posa e luce prima di confermare';
 $('framingLabel').textContent=p.kind==='front'?'Viso dentro la fascia guida':'Naso, occhi e spalle come in sagoma';
 $('exportTitle').textContent=count?`${count} foto pronte da salvare`:'Conserva le foto';
 renderReference();
}
function renderReference(){const ref=references.get(POSES[current].id);$('referenceControls').hidden=!ref;$('referenceImage').hidden=!ref||!!pending;if(ref){$('referenceImage').src=ref.url;$('referenceImage').style.opacity=Number($('opacity').value)/100;$('referenceLabel').textContent=ref.label; const s=ref.station; $('referenceSetup').textContent=s?`Postazione: ${s.name||'—'} · sagoma ${s.guideScale??55}% · spalle ${s.shoulderWidth??100}%. Luci: ${s.lights||'non annotate'}. Fotocamera: ${ref.camera?.label||'non annotata'}.`:''; $('applyReferenceSetup').hidden=!s;}else $('referenceImage').removeAttribute('src');}
function selectPose(index) {if(!Number.isInteger(index)||index<0||index>=6)throw new Error('Vista non valida');if(pending){notify('Conferma lo scatto oppure premi Rifai prima di cambiare vista.');return false;}cancelCountdown();current=index;render();return true;}
function stopCamera(message='Fotocamera non attiva') {
 cameraGeneration++;cancelCountdown();const old=stream;stream=null;old?.getTracks().forEach(t=>t.stop());$('video').srcObject=null;cameraBusy=false;$('startCamera').disabled=false;$('startCamera').textContent='Attiva fotocamera';$('cameraStatus').textContent=message;render();
}
async function startCamera() {
 if(cameraBusy)return;
 if(!navigator.mediaDevices?.getUserMedia){notify('Apri il sito HTTPS direttamente in Safari su iPhone o Chrome su Android e consenti la fotocamera.');return;}
 stopCamera();cameraBusy=true;const gen=cameraGeneration;$('startCamera').disabled=true;$('startCamera').textContent='Attendo il permesso…';$('cameraFacing').disabled=true;$('cameraStatus').textContent='Connessione alla fotocamera…';
 try {
  let selected=$('cameraSelect').value;
  const cameraRef=typeof captureReference==='function'?captureReference():null;
  if(!selected&&!cameraChoiceExplicit&&cameraRef?.camera?.deviceId){try{const available=await navigator.mediaDevices.enumerateDevices();if(available.some(d=>d.deviceId===cameraRef.camera.deviceId))selected=cameraRef.camera.deviceId;}catch{}}

  const source=selected?{deviceId:{exact:selected}}:{facingMode:{ideal:$('cameraFacing').value||'environment'}};
  let media;
  try {media=await navigator.mediaDevices.getUserMedia({audio:false,video:{...source,width:{ideal:1920},height:{ideal:2560},aspectRatio:{ideal:.75}}});}
  catch(e){if(e.name!=='OverconstrainedError')throw e;media=await navigator.mediaDevices.getUserMedia({audio:false,video:source});}
  if(gen!==cameraGeneration||document.hidden){media.getTracks().forEach(t=>t.stop());return;}
  stream=media;$('video').srcObject=media;await $('video').play();
  if(gen!==cameraGeneration)return;
  const track=media.getVideoTracks()[0];
  if(Number.isFinite(cameraRef?.camera?.zoom)){try{const range=track.getCapabilities?.().zoom,target=cameraRef.camera.zoom;if(range&&target>=range.min&&target<=range.max)await track.applyConstraints({advanced:[{zoom:target}]});}catch{/* Keep preview available; matching status reports the actual setting. */}}
  const settings=track.getSettings();
  $('cameraBadge').textContent=settings.facingMode==='user'?'CAMERA ANTERIORE · NON SPECCHIATA':settings.facingMode==='environment'?'CAMERA POSTERIORE':'CAMERA · VERIFICA OBIETTIVO';
  $('cameraStatus').textContent=`${settings.width||$('video').videoWidth} × ${settings.height||$('video').videoHeight} · ritaglio 3:4`;
  if(['user','environment'].includes(settings.facingMode))$('cameraFacing').value=settings.facingMode;
  track.addEventListener('ended',()=>{if(stream===media)stopCamera('Fotocamera interrotta: riattivala.');});
  try {const devices=await navigator.mediaDevices.enumerateDevices();if(gen!==cameraGeneration)return;const old=$('cameraSelect').value;$('cameraSelect').replaceChildren(new Option('Posteriore automatica',''));devices.filter(d=>d.kind==='videoinput').forEach((d,i)=>$('cameraSelect').add(new Option(d.label||`Fotocamera ${i+1}`,d.deviceId)));$('cameraSelect').value=settings.deviceId||old;}catch{/* Camera works even if device listing is unavailable. */}
 } catch(e) {
  if(gen!==cameraGeneration)return;stopCamera('Fotocamera non disponibile');
  const messages={NotAllowedError:'Permesso fotocamera negato. Abilitalo nelle impostazioni del sito e riapri la pagina in Safari o Chrome.',NotFoundError:'Nessuna fotocamera trovata su questo dispositivo.',NotReadableError:'Fotocamera occupata o non disponibile. Chiudi altre app che la usano e riprova.'};
  notify(messages[e.name]||'Non riesco ad avviare la fotocamera. Apri il link direttamente in Safari o Chrome e riprova.');
 } finally {if(gen===cameraGeneration){cameraBusy=false;$('startCamera').disabled=false;$('startCamera').textContent='Attiva fotocamera';render();}}
}
function cropRect(width,height){const ratio=.75;let sw=width,sh=height;if(width/height>ratio)sw=height*ratio;else sh=width/ratio;return {sx:(width-sw)/2,sy:(height-sh)/2,sw,sh,width:Math.floor(sw),height:Math.floor(sh)};}
async function capture() {
 const guided=window.hsBeforeCaptureRequested?'before':window.hsAfterCaptureRequested?'after':null;window.hsBeforeCaptureRequested=false;window.hsAfterCaptureRequested=false;
 if(!stream||captureBusy||pending)return;
 if(!$('patientCode').value.trim()||!$('visitDate').value){notify('Inserisci codice paziente e data visita prima del primo scatto.');(!$('patientCode').value.trim()?$('patientCode'):$('visitDate')).focus();return;}
 captureBusy=true;const gen=++countdownGeneration;render();
 const counter=document.createElement('div');counter.className='countdown';counter.setAttribute('aria-live','assertive');$('cameraArea').append(counter);
 try {
  counter.remove();const video=$('video');if(!stream||video.readyState<2||!video.videoWidth)throw Error('Attendi che la fotocamera mostri il viso.');
  const chosen=guided?await (guided==='after'?window.hsAfterBurst:window.hsBeforeBurst)({valid:()=>gen===countdownGeneration&&!!stream&&!pending}):null;
  if(gen!==countdownGeneration)return;
  const rect=chosen?.rect||cropRect(video.videoWidth,video.videoHeight), canvas=chosen?.canvas||document.createElement('canvas');
  if(!chosen){canvas.width=rect.width;canvas.height=rect.height;canvas.getContext('2d').drawImage(video,rect.sx,rect.sy,rect.sw,rect.sh,0,0,rect.width,rect.height);}
  const takenAt=chosen?.takenAt||new Date().toISOString(), level=chosen?chosen.level:currentLevel(), settings=stream.getVideoTracks()[0].getSettings();
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Scatto non riuscito. Riprova.')),'image/jpeg',.95));
  if(gen!==countdownGeneration)return;
  pending={blob,url:URL.createObjectURL(blob),width:rect.width,height:rect.height,takenAt,level,station:stationValues(),camera:{label:stream.getVideoTracks()[0].label,width:settings.width,height:settings.height,facingMode:settings.facingMode||'unknown',frameRate:settings.frameRate,deviceId:settings.deviceId||null,zoom:Number.isFinite(settings.zoom)?settings.zoom:null},crop:rect};
  if(chosen)notify('Foto scelta dalla raffica. Controllala prima di confermare.');
  $('flashEffect').animate?.([{opacity:.6},{opacity:0}],{duration:200});
 }catch(e){notify(e.message||'Scatto non riuscito. Riprova.');}
 finally{counter.remove();if(gen===countdownGeneration){captureBusy=false;render();}}
}
function acceptPhoto(){if(!pending)return;const id=POSES[current].id;revoke(photos.get(id));photos.set(id,pending);pending=null;revision++;$('saveStatus').textContent='Foto in memoria: esporta la sessione prima di chiudere.';if(current<5)current++;render();if(photos.size===7)notify('Sequenza completa. Esporta la sessione per conservarla.');}
function onMotion(event){
 const a=event.accelerationIncludingGravity;if(!a||![a.x,a.y,a.z].every(Number.isFinite))return;
 const norm=Math.hypot(a.x,a.y,a.z);if(norm<7||norm>12){lastLevel=null;return;}
 const roll=Math.atan2(a.x,Math.abs(a.y))*180/Math.PI,pitch=Math.atan2(a.z,Math.hypot(a.x,a.y))*180/Math.PI;
 lastLevel={roll:Math.round(roll*10)/10,pitch:Math.round(pitch*10)/10,at:Date.now(),screenAngle:screen.orientation?.angle??window.orientation??0};
 clearTimeout(sensorTimer);$('enableLevel').hidden=true;$('levelText').hidden=false;
 const angle=screen.orientation?.angle??window.orientation??0;const portrait=Math.abs(angle)%180===0;
 const okay=portrait&&Math.abs(roll)<=5&&Math.abs(pitch)<=5;
 $('levelText').textContent=portrait?`Laterale ${Math.abs(roll).toFixed(0)}° · avanti ${Math.abs(pitch).toFixed(0)}°`:'Ruota il telefono in verticale';
 $('levelText').className=okay?'ok-text':'warn-text';$('levelOverlay').hidden=!!pending;$('levelOverlay').classList.toggle('ok',okay);$('levelNeedle').style.transform=`rotate(${-roll}deg)`;
 $('levelHint').textContent=okay?'Telefono abbastanza dritto. Controlla la posa nella sagoma: non serve coincidere al millimetro.':'Raddrizza il telefono sul supporto. La livella misura il telefono, non la posizione della testa.';
}
async function enableLevel(){
 if(!window.DeviceMotionEvent){notify('Sensore non disponibile. Usa una livella sul supporto e le guide visive.');return;}
 try{if(typeof DeviceMotionEvent.requestPermission==='function'&&await DeviceMotionEvent.requestPermission()!=='granted'){notify('Sensore non autorizzato. Le guide visive restano disponibili.');return;}
 if(!sensorActive){window.addEventListener('devicemotion',onMotion);sensorActive=true;}
 $('enableLevel').textContent='Attendo il sensore…';clearTimeout(sensorTimer);sensorTimer=setTimeout(()=>{if(!currentLevel()){$('enableLevel').textContent='Riprova sensore';$('enableLevel').hidden=false;$('levelText').hidden=true;$('levelOverlay').hidden=true;notify('Nessun dato dal sensore: usa le guide visive o una livella sul supporto.');}},3000);
 }catch{notify('Il browser non consente il sensore. Apri il sito in Safari o Chrome.');}
}
setInterval(()=>{if(sensorActive&&lastLevel&&!currentLevel()){$('levelText').textContent='Sensore in pausa';$('levelText').className='warn-text';$('levelOverlay').hidden=true;}},1500);
// Minimal STORE-only ZIP: interoperable exports, deterministic imports, no network libraries.
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function zipStore(entries){
 const encoder=new TextEncoder(),chunks=[],directory=[];let offset=0,dirSize=0;
 for(const {name,data} of entries){const filename=encoder.encode(name),crc=crc32(data),local=new Uint8Array(30+filename.length),lv=new DataView(local.buffer);lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint16(12,33,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,filename.length,true);local.set(filename,30);chunks.push(local,data);
 const central=new Uint8Array(46+filename.length),cv=new DataView(central.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(14,33,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,filename.length,true);cv.setUint32(42,offset,true);central.set(filename,46);directory.push(central);dirSize+=central.length;offset+=local.length+data.length;
 }
 const end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,entries.length,true);ev.setUint16(10,entries.length,true);ev.setUint32(12,dirSize,true);ev.setUint32(16,offset,true);
 return new Blob([...chunks,...directory,end],{type:'application/zip'});
}
function unzipStore(buffer){
 const view=new DataView(buffer),bytes=new Uint8Array(buffer),entries=new Map();let offset=0;
 while(offset+4<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
 if(offset+30>bytes.length)throw Error('Archivio incompleto.');
 const flags=view.getUint16(offset+6,true),method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),rawSize=view.getUint32(offset+22,true),nameLen=view.getUint16(offset+26,true),extraLen=view.getUint16(offset+28,true),start=offset+30+nameLen+extraLen;
 if(flags&9||method!==0||size!==rawSize)throw Error('Carica un archivio ZIP esportato direttamente da questa app, senza ricomprimerlo.');
 if(size>25*1024*1024||start+size>bytes.length||entries.size>=200)throw Error('Archivio troppo grande o non valido.');
 const name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLen));if(entries.has(name))throw Error('Archivio con file duplicati.');const data=bytes.slice(start,start+size);
 if(crc32(data)!==view.getUint32(offset+14,true))throw Error('Archivio danneggiato: verifica il file.');entries.set(name,data);offset=start+size;
 }
 if(!entries.size||offset+4>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw Error('Archivio non riconosciuto.');return entries;
}
function safeName(value){return value.normalize('NFKD').replace(/[^a-zA-Z0-9_-]/g,'-').replace(/-+/g,'-').slice(0,50)||'senza-codice';}
function filePrefix(){return `${safeName($('patientCode').value.trim())}_${$('visitDate').value||localDate()}`;}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function exportZip(){
 if(!photos.size)return;
 if(!$('patientCode').value.trim()){notify('Inserisci il codice paziente prima di esportare.');$('patientCode').focus();return;}
 if(!$('visitDate').value){notify('Inserisci la data della visita.');$('visitDate').focus();return;}
 $('exportZip').disabled=true;const snapshotRevision=revision,prefix=filePrefix();
 const session={app:'healthy-smile-foto',schema:1,protocol:'viso-1.0',patientCode:$('patientCode').value.trim(),visitDate:$('visitDate').value,exportedAt:new Date().toISOString(),station:stationValues(),complete:photos.size===7,missing:POSES.filter(p=>!photos.has(p.id)).map(p=>p.id),processing:'Video frame, center crop 3:4, JPEG quality 0.95. No retouching, overlays or mirroring. Browser camera processing may vary.',photos:[]};
 try{
 const snapshot=[...photos.entries()];const entries=await Promise.all(snapshot.map(async([id,p])=>{const filename=`${prefix}_${id}.jpg`;session.photos.push({pose:id,title:POSES.find(p=>p.id===id).title,filename,width:p.width,height:p.height,takenAt:p.takenAt,level:p.level,station:p.station,camera:p.camera,crop:p.crop});return {name:filename,data:new Uint8Array(await p.blob.arrayBuffer())};}));
 entries.push({name:'session.json',data:new TextEncoder().encode(JSON.stringify(session,null,2))});download(zipStore(entries),`${prefix}_sessione.zip`);exportRevision=snapshotRevision;$('saveStatus').textContent='Download avviato. Verifica l’archivio in File / Download prima di chiudere.';notify('Archivio preparato. Controlla che il file ZIP sia stato salvato sul dispositivo.');
 }catch{notify('Esportazione non riuscita. Mantieni aperta la pagina e riprova.');}
 finally{render();}
}
function phonePhotoFile(id,p){const ext=p.blob.type==='image/png'?'png':p.blob.type==='image/webp'?'webp':'jpg';return new File([p.blob],`${filePrefix()}_${id}.${ext}`,{type:p.blob.type||'image/jpeg'});}
function showGalleryFallback(entries){
 $('galleryPhotos').replaceChildren(...entries.map(([id,p])=>{const card=document.createElement('article'),img=document.createElement('img'),open=document.createElement('a'),save=document.createElement('button');img.src=p.url;img.alt=POSES.find(x=>x.id===id)?.title||'Foto';open.href=p.url;open.target='_blank';open.rel='noopener';open.textContent='Apri foto';save.className='secondary';save.textContent='Scarica foto';save.addEventListener('click',()=>download(p.blob,phonePhotoFile(id,p).name));card.append(img,open,save);return card;}));
 $('galleryDialog').showModal();
}
function savePhonePhotos(entries){
 if(!entries.length)return;const files=entries.map(([id,p])=>phonePhotoFile(id,p));
 if(navigator.share&&navigator.canShare?.({files})){
  try{navigator.share({files}).catch(e=>{if(e.name!=='AbortError')showGalleryFallback(entries);});}catch{showGalleryFallback(entries);}
 }else showGalleryFallback(entries);
}
function sharePhotos(){savePhonePhotos([...photos]);}
$('saveSessionPhotos').addEventListener('click',sharePhotos);
$('saveSinglePhoto').addEventListener('click',()=>{const id=POSES[current].id,p=pending||photos.get(id);if(p)savePhonePhotos([[id,p]]);});
$('closeGallery').addEventListener('click',()=>$('galleryDialog').close());
async function validatedImage(blob){if(!blob.size||blob.size>25*1024*1024)throw Error('Immagine troppo grande (massimo 25 MB).');const url=URL.createObjectURL(blob);try{await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth&&img.naturalHeight?resolve():reject(Error('Immagine vuota.'));img.onerror=()=>reject(Error('Immagine non leggibile. Usa JPG, PNG o WebP.'));img.src=url;});return url;}catch(e){URL.revokeObjectURL(url);throw e;}}
let referenceGeneration=0;
async function importReference(event){
 const file=event.target.files?.[0];if(!file)return;event.target.value='';const generation=++referenceGeneration,poseId=POSES[current].id,staged=[];
 try{
 if(file.size>120*1024*1024)throw Error('Archivio troppo grande (massimo 120 MB).');
 if(file.name.toLowerCase().endsWith('.zip')){
 const entries=unzipStore(await file.arrayBuffer()),raw=entries.get('session.json');if(!raw||raw.length>200000)throw Error('Manca il riepilogo session.json di questa app.');const data=JSON.parse(new TextDecoder().decode(raw));
 if(data.app!=='healthy-smile-foto'||data.schema!==1||!Array.isArray(data.photos)||data.photos.length>7)throw Error('Archivio di sessione non compatibile.');
 const seen=new Set();for(const p of data.photos){if(!POSES.some(x=>x.id===p.pose)||seen.has(p.pose)||typeof p.filename!=='string'||!entries.has(p.filename))throw Error('Riferimenti della sessione non validi.');seen.add(p.pose);const blob=new Blob([entries.get(p.filename)],{type:'image/jpeg'}),url=await validatedImage(blob);staged.push({id:p.pose,url,label:`Visita ${String(data.visitDate||'precedente').slice(0,20)} · ${String(data.patientCode||'').slice(0,40)}`,station:normalizeStation(p.station||data.station),camera:{label:typeof p.camera?.label==='string'?p.camera.label.slice(0,160):''}});}
 if(!staged.length)throw Error('L’archivio non contiene fotografie.');
 if(generation!==referenceGeneration){staged.forEach(revoke);return;}
 for(const item of references.values())revoke(item);references.clear();for(const item of staged)references.set(item.id,item);
 if(!$('patientCode').value.trim()&&typeof data.patientCode==='string')$('patientCode').value=data.patientCode.slice(0,40);
 notify(`${staged.length} riferimenti caricati. Verifica il codice paziente e riprendi l’inquadratura della visita precedente.`);
 }else{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Usa un’immagine JPG, PNG o WebP oppure il ZIP della sessione.');const url=await validatedImage(file);staged.push({url});if(generation!==referenceGeneration){revoke({url});return;}revoke(references.get(poseId));references.set(poseId,{url,label:`${file.name.slice(0,80)} · ${POSES.find(p=>p.id===poseId).title}`});notify('Riferimento caricato per questa vista. Se il formato è diverso, l’anteprima viene ritagliata al centro.');
 }
 renderReference();
 }catch(e){staged.forEach(revoke);notify(e.message||'Non riesco a leggere il riferimento.');}
}
function normalizeStation(s){if(!s||typeof s!=='object')return null;const bounded=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;return {name:typeof s.name==='string'?s.name.slice(0,80):'',distanceCm:bounded(s.distanceCm,30,400),lensHeightCm:bounded(s.lensHeightCm,30,250),lights:typeof s.lights==='string'?s.lights.slice(0,200):'',guideScale:bounded(s.guideScale,25,100)||55,shoulderWidth:bounded(s.shoulderWidth,80,130)||100,guideVersion:bounded(s.guideVersion,1,3)||1};}
function applyReferenceSetup(){const s=references.get(POSES[current].id)?.station;if(!s)return;$('station').value=s.name;$('lights').value=s.lights;$('guideScale').value=s.guideScale;$('shoulderWidth').value=s.shoulderWidth;revision++;render();notify('Impostazioni riprese. Usa il riferimento in trasparenza e la stessa luce della visita precedente.');}
function resetSession(){referenceGeneration++;cancelCountdown();discardPending();for(const p of photos.values())revoke(p);for(const p of references.values())revoke(p);photos.clear();references.clear();current=0;revision=0;exportRevision=-1;$('patientCode').value='';$('visitDate').value=localDate();$('saveStatus').textContent='Nessuna foto inviata a un server.';$('resetDialog').close();render();}
function showSettings(show){$('settings').hidden=!show;$('settingsButton').setAttribute('aria-expanded',String(show));if(show)$('settings').scrollIntoView({behavior:'smooth',block:'start'});}
$('startCamera').addEventListener('click',startCamera);$('stopCamera').addEventListener('click',()=>stopCamera());$('cameraSelect').addEventListener('change',()=>{cameraChoiceExplicit=true;if(stream)startCamera();});$('cameraFacing').addEventListener('change',()=>{cameraChoiceExplicit=true;$('cameraSelect').value='';if(stream)startCamera();});$('video').addEventListener('loadeddata',render);
$('capture').addEventListener('click',capture);$('accept').addEventListener('click',acceptPhoto);$('retake').addEventListener('click',()=>{discardPending();render();});$('prevPose').addEventListener('click',()=>typeof stepPose==='function'?stepPose(-1):selectPose(current-1));$('nextPose').addEventListener('click',()=>typeof stepPose==='function'?stepPose(1):selectPose(current+1));
$('shoulderWidth').addEventListener('input',()=>{revision++;render();});$('setupSettings').addEventListener('click',()=>showSettings(true));$('guideScale').addEventListener('input',()=>{$('showGuide').checked=true;revision++;render();});$('loadReference').addEventListener('click',()=>$('referenceInput').click());$('applyReferenceSetup').addEventListener('click',applyReferenceSetup);$('enableLevel').addEventListener('click',enableLevel);$('showGuide').addEventListener('change',render);$('opacity').addEventListener('input',renderReference);$('referenceInput').addEventListener('change',importReference);$('removeReference').addEventListener('click',()=>{const id=POSES[current].id;revoke(references.get(id));references.delete(id);renderReference();});
$('exportZip').addEventListener('click',exportZip);$('sharePhotos').addEventListener('click',sharePhotos);$('settingsButton').addEventListener('click',()=>showSettings($('settings').hidden));$('closeSettings').addEventListener('click',()=>showSettings(false));
$('newSession').addEventListener('click',()=>{if((typeof totalPhotos==='function'?totalPhotos():photos.size)||pending)$('resetDialog').showModal();else resetSession();});$('cancelReset').addEventListener('click',()=>$('resetDialog').close());$('confirmReset').addEventListener('click',resetSession);
for(const id of ['patientCode','visitDate','station','lights'])$(id).addEventListener('input',()=>{revision++;});
window.addEventListener('beforeunload',e=>{if(pending||(photos.size&&revision!==exportRevision)){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>stopCamera());document.addEventListener('visibilitychange',()=>{if(document.hidden&&(stream||cameraBusy))stopCamera('Fotocamera in pausa: premi Attiva per riprendere.');});
// WebMCP is optional; no camera permission or photo data is exposed through tools.
const modelContext=document.modelContext;
if(modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});const register=tool=>{try{Promise.resolve(modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 register({name:'read_photo_session_progress',description:'Legge vista attuale e numero di foto confermate; non restituisce foto o codice paziente.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('Nessun parametro previsto');return {pose:POSES[current].id,confirmed:photos.size,total:POSES.length,pending:!!pending};}});
 register({name:'select_photo_pose',description:'Seleziona una vista nella sequenza guidata. Non scatta fotografie e non attiva la camera.',inputSchema:{type:'object',properties:{pose:{type:'string',enum:POSES.map(p=>p.id)}},required:['pose'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length!==1||typeof input.pose!=='string')throw Error('Specificare una sola vista');const i=POSES.findIndex(p=>p.id===input.pose);if(i<0)throw Error('Vista non valida');if(!selectPose(i))throw Error('Scatto da confermare');return {pose:POSES[current].id};}});
}
render();
