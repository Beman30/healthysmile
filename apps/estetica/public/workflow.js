'use strict';
// Paired visit workflow. Cloud persistence is integrated by cloud.js; ZIP remains a backup.
const FLOW_POSES = POSES.slice(0,6);
let visits=[{date:$('visitDate').value,phase:'before',photos}], activeVisit=0, lastFollowup=1;
let view='before', comparisonLayout='slider', compareA=0, compareB=1, comparePose=POSES[0].id;
let customSlots=[], archiveBusy=false, importBusy=false, importGeneration=0, ghostVisible=true;
const phaseLabel=phase=>({before:'Prima',immediate:'Subito dopo',followup:'Controllo'})[phase]||'Controllo';
const dateLabel=date=>/^\d{4}-\d{2}-\d{2}$/.test(date)?date.split('-').reverse().join('/'):'Data da indicare';
const visitLabel=i=>visits[i]?`${phaseLabel(visits[i].phase)} · ${dateLabel(visits[i].date)}`:'Visita mancante';
const totalPhotos=()=>visits.reduce((sum,v)=>sum+v.photos.size,0);
const hasSix=map=>FLOW_POSES.every(p=>map.has(p.id));
function rememberVisit(){if($('treatment'))visits[activeVisit].treatment=$('treatment').value;visits[activeVisit].date=$('visitDate').value;visits[activeVisit].phase=$('visitPhase').value;}
function optionList(select,rows,value){select.replaceChildren(...rows.map(([v,label])=>new Option(label,String(v))));select.value=String(value);}
function readyToNavigate(){if(importBusy){notify('Attendi che il caricamento sia completato.');return false;}if(pending){notify('Conferma la foto oppure premi Rifai prima di cambiare sezione.');return false;}cancelCountdown();return true;}
function addFollowup(){if(!readyToNavigate())return;if(!visits[0].photos.size){notify('Acquisisci o carica prima le fotografie iniziali.');return;}if(visits.length>=20){notify('Questo archivio contiene già 20 visite. Conserva il ZIP e avvia un nuovo archivio.');return;}rememberVisit();visits.push({date:localDate(),phase:'followup',photos:new Map()});lastFollowup=visits.length-1;revision++;compareB=lastFollowup;customSlots=[];setView('after');}
function setView(next){
 if(!readyToNavigate())return false;rememberVisit();
 if(next==='after'){
  if(!visits[0].photos.size){notify('Prima scatta le foto iniziali oppure apri il loro archivio ZIP.');return false;}
  if(visits.length===1){visits.push({date:localDate(),phase:'followup',photos:new Map()});compareB=1;revision++;}
  lastFollowup=Math.min(Math.max(1,lastFollowup),visits.length-1);activeVisit=lastFollowup;
 }else if(next==='before')activeVisit=0;
 view=next;photos=visits[activeVisit].photos;if($('treatment'))$('treatment').value=visits[activeVisit].treatment||'';$('visitDate').value=visits[activeVisit].date;$('visitPhase').value=visits[activeVisit].phase;
 if(next==='compare'){stopCamera();compareB=Math.min(Math.max(1,compareB),visits.length-1);renderComparison();}
 else {if(next==='after'){ghostVisible=true;if(Number($('opacity').value)<10||Number($('opacity').value)>85)$('opacity').value=40;}current=Math.max(0,POSES.findIndex(p=>!photos.has(p.id)));if(current>5&&hasSix(photos))current=0;render();}
 renderFlow();return true;
}
const captureRender=render;
render=function(){captureRender();renderFlow();};
function renderFlow(){
 const comparing=view==='compare';document.querySelector('main').hidden=comparing;$('comparePage').hidden=!comparing;
 $('tabBefore').setAttribute('aria-current',view==='before'?'page':'false');$('tabAfter').setAttribute('aria-current',view==='after'?'page':'false');$('tabCompare').setAttribute('aria-current',comparing?'page':'false');
 $('patientCode').readOnly=!!totalPhotos()||!!pending||captureBusy||importBusy;$('visitDate').readOnly=!!pending||captureBusy||importBusy;
 $('visitPhase').disabled=activeVisit===0||importBusy;$('followupControls').hidden=activeVisit===0;
 optionList($('followupSelect'),visits.slice(1).map((v,i)=>[i+1,visitLabel(i+1)]),activeVisit);
 const mainCount=FLOW_POSES.filter(p=>photos.has(p.id)).length;
 $('stepCount').textContent=`${activeVisit===0?'PRIMA':'DOPO'} · ${current===6?'VISTA FACOLTATIVA':`SCATTO ${current+1} DI 6`}`;
 $('progressText').textContent=`${mainCount} / 6`;$('completionLabel').textContent=hasSix(photos)?'6 viste completate':`${mainCount} di 6`;
 $('saveArchiveTop').disabled=!totalPhotos()||archiveBusy||importBusy;$('exportZip').disabled=!totalPhotos()||archiveBusy||importBusy;
 if(importBusy)$('capture').disabled=true;
 $('choosePrevious').disabled=!!pending||captureBusy||importBusy;
 $('usePendingBefore').hidden=!pending||pending.camera?.label!=='Foto importata';
 $('importCurrent').textContent=activeVisit?'Importa una foto del DOPO già scattata':'Importa una foto del PRIMA già scattata';
 $('importCurrent').disabled=!!pending||captureBusy||importBusy;$('openArchive').disabled=importBusy;
 $('exportTitle').textContent=totalPhotos()?`${totalPhotos()} foto · ${visits.length} ${visits.length===1?'visita':'visite'}`:'Conserva il prima e il dopo';
 $('exportCopy').textContent='Salva il ZIP completo prima di chiudere. Contiene tutte le visite e si riapre da “Apri archivio ZIP”. Le foto non vengono archiviate automaticamente online.';
 $('archiveHint').textContent=totalPhotos()?`${visits.length} ${visits.length===1?'visita':'visite'} · ${totalPhotos()} foto. ${revision===exportRevision?'Archivio caricato o download avviato: verifica il file salvato.':'Modifiche da salvare nel ZIP prima di uscire.'}`:'Apri il ZIP del paziente oppure inizia le foto del prima. Salva il ZIP prima di chiudere.';
 $('poseHelp').textContent=activeVisit===0?'Viso nella sagoma, telefono dritto. Lascia visibili collo e spalle. Non serve combaciare al millimetro.':'Ritrova occhi, naso, mento e spalle della foto precedente. Ripeti espressione e luce. Regola la trasparenza direttamente sull’inquadratura.';
 $('loadReference').hidden=activeVisit!==0;$('removeReference').hidden=activeVisit!==0;
 $('framingLabel').textContent=activeVisit&&visits[0].photos.has(POSES[current].id)?'Segui il prima in trasparenza':activeVisit?'Prima mancante per questa posa':'Viso dentro la fascia guida';
 if(!comparing)renderReference();
}
const oldReferenceRender=renderReference;
renderReference=function(){
 if(activeVisit===0){oldReferenceRender();const ref=references.get(POSES[current].id);$('ghostControls').hidden=!ref||!!pending;if(ref){$('guideAdjustment').hidden=true;$('referenceImage').hidden=!ghostVisible||!!pending;$('ghostOpacityValue').textContent=`${$('opacity').value}%`;$('ghostDate').textContent='Riferimento';$('toggleGhost').textContent=ghostVisible?'Nascondi prima':'Mostra prima';}return;}
 const ref=visits[0].photos.get(POSES[current].id), visible=!!ref&&!pending;
 $('referenceImage').hidden=!visible||!ghostVisible;$('guideAdjustment').hidden=true;$('guide').hidden=!!ref||!!pending||!$('showGuide').checked;
 $('ghostControls').hidden=!ref||!!pending;$('referenceControls').hidden=!ref;$('referenceLabel').textContent=ref?`${visitLabel(0)} · ${POSES[current].title}`:'';
 $('ghostDate').textContent=visitLabel(0);$('ghostOpacityValue').textContent=`${$('opacity').value}%`;
 $('toggleGhost').textContent=ghostVisible?'Nascondi prima':'Mostra prima';$('toggleGhost').setAttribute('aria-pressed',String(ghostVisible));
 if(ref){$('referenceImage').src=ref.url;$('referenceImage').style.opacity=Number($('opacity').value)/100;$('referenceSetup').textContent=`Luci: ${ref.station?.lights||'non annotate'} · Fotocamera: ${ref.camera?.label||'non annotata'}`;$('applyReferenceSetup').hidden=!ref.station;}
 else {$('referenceImage').removeAttribute('src');$('referenceSetup').textContent='Manca la foto iniziale per questa posa. Torna a Prima per aggiungerla.';}
 $('levelOverlay').classList.toggle('above-ghost',!!ref);
};
$('opacity').removeEventListener('input',oldReferenceRender);$('opacity').addEventListener('input',renderReference);
$('toggleGhost').addEventListener('click',()=>{ghostVisible=!ghostVisible;renderReference();});
$('applyReferenceSetup').removeEventListener('click',applyReferenceSetup);
$('applyReferenceSetup').addEventListener('click',()=>{if(!activeVisit){applyReferenceSetup();return;}const s=visits[0].photos.get(POSES[current].id)?.station;if(!s)return;$('station').value=s.name||'';$('lights').value=s.lights||'';$('guideScale').value=s.guideScale||70;$('shoulderWidth').value=s.shoulderWidth||100;revision++;render();notify('Impostazioni del prima riprese. Verifica la stessa luce e lo stesso obiettivo.');});
$('accept').removeEventListener('click',acceptPhoto);
$('accept').addEventListener('click',()=>{
 if(!pending)return;const old=current;acceptPhoto();rememberVisit();
 if(old===5&&hasSix(photos)){current=5;render();notify(activeVisit?'Sei viste completate. Apri Confronto per vedere il prima e dopo.':'Sei viste completate. Dopo il trattamento usa Ripeti queste foto.');}
});
$('importCurrent').addEventListener('click',()=>{if(!$('patientCode').value.trim()||!$('visitDate').value){notify('Inserisci codice paziente e data prima di caricare le foto.');$('patientCode').focus();return;}$('photoInput').click();});
$('photoInput').addEventListener('change',async e=>{
 const file=e.target.files?.[0];e.target.value='';if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){notify('Usa JPG, PNG o WebP.');return;}
 if(!readyToNavigate())return;importBusy=true;const gen=++importGeneration;render();let url;
 try{url=await validatedImage(file);const img=new Image();img.src=url;await img.decode();if(gen!==importGeneration){revoke({url});return;}
 pending={blob:file,url,width:img.naturalWidth,height:img.naturalHeight,takenAt:null,station:stationValues(),camera:{label:'Foto importata'},crop:null};render();
 }catch(err){if(url)revoke({url});notify(err.message||'Foto non leggibile.');}finally{importBusy=false;render();}
});
function installPreviousPhoto(item,poseIndex){
 const id=POSES[poseIndex].id;
 if(visits[0].photos.has(id)&&!window.confirm('Sostituire la foto del prima per questa posa?'))return false;
 rememberVisit();revoke(visits[0].photos.get(id));visits[0].photos.set(id,item);revision++;
 if(!setView('after'))return false;
 current=poseIndex;ghostVisible=true;$('opacity').value=40;render();
 notify('Foto precedente mantenuta in trasparenza. Attiva la fotocamera e scatta il dopo.');return true;
}
$('choosePrevious').addEventListener('click',()=>{
 if(!$('patientCode').value.trim()||!$('visitDate').value){notify('Inserisci codice paziente e data prima di scegliere la foto.');$('patientCode').focus();return;}
 $('previousPhotoInput').click();
});
$('previousPhotoInput').addEventListener('change',async e=>{
 const file=e.target.files?.[0];e.target.value='';if(!file||!readyToNavigate())return;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)){notify('Usa una foto JPG, PNG o WebP.');return;}
 const poseIndex=current,gen=++importGeneration;importBusy=true;render();let url;
 try{
  url=await validatedImage(file);const img=new Image();img.src=url;await img.decode();
  if(gen!==importGeneration){revoke({url});return;}
  const item={blob:file,url,width:img.naturalWidth,height:img.naturalHeight,takenAt:null,station:null,camera:{label:'Foto importata'},crop:null};
  importBusy=false;if(!installPreviousPhoto(item,poseIndex))revoke(item);
 }catch(err){if(url)revoke({url});notify(err.message||'Foto non leggibile.');}finally{importBusy=false;render();}
});
$('usePendingBefore').addEventListener('click',()=>{
 if(!pending)return;const item=pending,poseIndex=current;pending=null;
 if(!installPreviousPhoto(item,poseIndex))pending=item;
 render();
});
function imageMime(bytes){if(bytes[0]===0xff&&bytes[1]===0xd8)return'image/jpeg';if(bytes[0]===137&&bytes[1]===80)return'image/png';if(String.fromCharCode(...bytes.slice(0,4))==='RIFF')return'image/webp';throw Error('Formato immagine non riconosciuto.');}
function photoMeta(id,p,filename){return {pose:id,title:POSES.find(x=>x.id===id).title,filename,width:p.width,height:p.height,takenAt:p.takenAt,level:p.level,station:p.station,camera:p.camera,crop:p.crop,alignment:p.alignment,brightness:p.brightness};}
async function saveArchive(){
 if(archiveBusy||!totalPhotos())return;if(pending){notify('Conferma o scarta la foto in anteprima prima di salvare.');return;}
 if(!$('patientCode').value.trim()){notify('Inserisci il codice paziente.');return;}rememberVisit();
 const snap=revision,code=$('patientCode').value.trim(),snapshot=visits.map(v=>({...v,photos:[...v.photos]}));
 if(snapshot.some(v=>!/^\d{4}-\d{2}-\d{2}$/.test(v.date))){notify('Inserisci una data valida per ogni visita.');return;}
 if(snapshot.reduce((sum,v)=>sum+v.photos.reduce((n,[id,p])=>n+p.blob.size,0),0)>249*1024*1024){notify('Archivio oltre 250 MB. Conserva le visite già esportate prima di proseguire.');return;}
 archiveBusy=true;renderFlow();
 try{
 const data={app:'healthy-smile-foto',schema:2,protocol:'viso-1.0',patientCode:code,notes:typeof cloud!=='undefined'?cloud.patient?.notes||'':'',exportedAt:new Date().toISOString(),visits:[]},entries=[];
 for(let i=0;i<snapshot.length;i++){
  const v=snapshot[i],meta={date:v.date,phase:v.phase,treatment:v.treatment||'',selected:v.selected||null,photos:[]};
  for(const [id,p] of v.photos){const mime=p.blob.type,ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';const filename=`visita-${String(i+1).padStart(2,'0')}_${v.date}_${id}.${ext}`;entries.push({name:filename,data:new Uint8Array(await p.blob.arrayBuffer())});meta.photos.push(photoMeta(id,p,filename));}
  data.visits.push(meta);
 }
 entries.push({name:'session.json',data:new TextEncoder().encode(JSON.stringify(data,null,2))});
 download(zipStore(entries),`${safeName(code)}_archivio_prima_dopo.zip`);exportRevision=snap;$('saveStatus').textContent='Download avviato: verifica il ZIP in File / Download.';notify('Archivio completo preparato. Verifica il file ZIP prima di chiudere.');
 }catch(err){notify('Salvataggio non riuscito. Mantieni aperta la pagina e riprova.');}finally{archiveBusy=false;renderFlow();}
}
async function parseArchive(file){
 if(file.size>250*1024*1024)throw Error('Archivio troppo grande: massimo 250 MB.');const entries=unzipStore(await file.arrayBuffer()),raw=entries.get('session.json');
 if(!raw||raw.length>1000000)throw Error('Manca un session.json valido.');const data=JSON.parse(new TextDecoder().decode(raw));
 if(data.app!=='healthy-smile-foto'||![1,2].includes(data.schema))throw Error('Apri un archivio esportato da Healthy Smile Foto.');
 if(typeof data.patientCode!=='string'||!data.patientCode.trim()||data.patientCode.length>40)throw Error('Codice paziente mancante o non valido.');
 if(data.notes!==undefined&&(typeof data.notes!=='string'||data.notes.length>10000))throw Error('Note paziente non valide.');
 const items=data.schema===1?[{date:data.visitDate,phase:'before',photos:data.photos,station:data.station}]:data.visits;
 if(!Array.isArray(items)||!items.length||items.length>20)throw Error('Numero di visite non valido.');
 const staged=[];
 try{
  for(let i=0;i<items.length;i++){
   const v=items[i];if(!v||!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||!Array.isArray(v.photos)||v.photos.length>7)throw Error('Dati della visita non validi.');
   if(i===0&&v.phase!=='before'||i>0&&!['immediate','followup'].includes(v.phase))throw Error('Fase della visita non valida.');
   const map=new Map();staged.push({date:v.date,phase:v.phase,treatment:String(v.treatment||'').slice(0,200),selected:Array.isArray(v.selected)?v.selected.filter(id=>POSES.some(p=>p.id===id)):null,photos:map});
   for(const p of v.photos){
    if(!p||!POSES.some(x=>x.id===p.pose)||map.has(p.pose)||typeof p.filename!=='string'||!entries.has(p.filename))throw Error('Fotografie duplicate o mancanti nell’archivio.');
    const bytes=entries.get(p.filename),blob=new Blob([bytes],{type:imageMime(bytes)}),url=await validatedImage(blob);
    const decoded=new Image();decoded.src=url;await decoded.decode();
    map.set(p.pose,{blob,url,width:decoded.naturalWidth,height:decoded.naturalHeight,takenAt:p.takenAt||null,station:normalizeStation(p.station||v.station),camera:{label:String(p.camera?.label||'').slice(0,160),deviceId:typeof p.camera?.deviceId==='string'?p.camera.deviceId.slice(0,256):null,zoom:Number.isFinite(p.camera?.zoom)?p.camera.zoom:null,facingMode:p.camera?.facingMode||'unknown'},crop:p.crop||null,level:p.level||null,alignment:p.alignment||null,brightness:brightnessPercent(p)});
   }
  }
  if(!staged[0].photos.size)throw Error('L’archivio non contiene foto del prima.');return {code:data.patientCode,notes:data.notes||'',visits:staged};
 }catch(e){staged.forEach(v=>v.photos.forEach(revoke));throw e;}
}
function releaseVisits(){visits.forEach(v=>v.photos.forEach(revoke));references.forEach(revoke);references.clear();}
async function loadArchive(file){
 if(!file||!readyToNavigate())return;if(totalPhotos()&&!window.confirm('Aprire questo archivio al posto del paziente corrente? Salva prima il ZIP se hai modifiche da conservare.'))return;
 importBusy=true;const gen=++importGeneration;renderFlow();let staged;
 try{staged=await parseArchive(file);if(gen!==importGeneration){staged.visits.forEach(v=>v.photos.forEach(revoke));return;}
 stopCamera();releaseVisits();visits=staged.visits;activeVisit=0;lastFollowup=Math.max(1,visits.length-1);photos=visits[0].photos;view='before';current=0;
 $('patientCode').value=staged.code;$('visitDate').value=visits[0].date;$('visitPhase').value='before';if($('treatment'))$('treatment').value=visits[0].treatment||'';compareA=0;compareB=Math.max(1,visits.length-1);customSlots=[];revision++;exportRevision=revision;
 notify(`${visits.length} visite caricate. Apri Dopo per ripetere le pose oppure Confronto per confrontarle.`);
 }catch(e){notify(e.message||'Archivio non leggibile.');}finally{importBusy=false;render();}
}
$('exportZip').removeEventListener('click',exportZip);$('exportZip').addEventListener('click',saveArchive);$('saveArchiveTop').addEventListener('click',saveArchive);
$('openArchive').addEventListener('click',()=>$('archiveInput').click());$('archiveInput').addEventListener('change',e=>{const file=e.target.files?.[0];e.target.value='';loadArchive(file);});
$('referenceInput').removeEventListener('change',importReference);$('referenceInput').addEventListener('change',e=>{const file=e.target.files?.[0];if(file?.name.toLowerCase().endsWith('.zip')){e.target.value='';loadArchive(file);}else importReference(e);});
$('tabBefore').addEventListener('click',()=>setView('before'));$('tabAfter').addEventListener('click',()=>setView('after'));$('tabCompare').addEventListener('click',()=>setView('compare'));
$('newFollowup').addEventListener('click',addFollowup);$('followupSelect').addEventListener('change',e=>{if(!readyToNavigate()){renderFlow();return;}lastFollowup=Number(e.target.value);setView('after');});
$('visitPhase').addEventListener('change',()=>{rememberVisit();revision++;renderFlow();});$('visitDate').addEventListener('input',()=>{rememberVisit();renderFlow();});
$('patientCode').addEventListener('input',renderFlow);
$('confirmReset').removeEventListener('click',resetSession);
const oldResetSession=resetSession;
resetSession=function(){if(importBusy){notify('Attendi il caricamento prima di cambiare paziente.');return;}importGeneration++;stopCamera();discardPending();releaseVisits();visits=[{date:localDate(),phase:'before',photos:new Map()}];photos=visits[0].photos;activeVisit=0;lastFollowup=1;view='before';compareA=0;compareB=1;customSlots=[];current=0;revision=0;exportRevision=-1;$('patientCode').value='';$('visitDate').value=localDate();$('visitPhase').value='before';if($('treatment'))$('treatment').value='';$('resetDialog').close();render();};
$('confirmReset').addEventListener('click',resetSession);
// The original click handler refers to resetSession dynamically. Guard other visits too.

window.addEventListener('beforeunload',e=>{if(totalPhotos()&&revision!==exportRevision){e.preventDefault();e.returnValue='';}});
function availableSnapshots(){const out=[];visits.forEach((v,i)=>POSES.forEach(p=>{if(v.photos.has(p.id))out.push([`${i}|${p.id}`,`${visitLabel(i)} · ${p.title}`]);}));return out;}
function snapshot(key){const [v,id]=String(key).split('|'),i=Number(v);return {visit:i,id,photo:visits[i]?.photos.get(id),label:`${visitLabel(i)} · ${POSES.find(p=>p.id===id)?.title||''}`};}
function slotDefaults(){const alternate=FLOW_POSES.find(p=>p.id!==comparePose&&visits[compareB]?.photos.has(p.id))?.id||comparePose;return comparisonLayout==='grid'?[`${compareA}|${comparePose}`,`${compareB}|${comparePose}`,`${compareA}|${alternate}`,`${compareB}|${alternate}`]:[`${compareA}|${comparePose}`,`${compareB}|${comparePose}`];}
// Whole-image brightness only; original blobs and geometric landmarks stay untouched.
function brightnessPercent(photo){const n=photo?.brightness;return typeof n==='number'&&Number.isFinite(n)?Math.max(-50,Math.min(50,Math.round(n))):0;}
function brightnessFilter(photo){return `brightness(${1+brightnessPercent(photo)/100})`;}
function adjustBrightnessPixels(data,percent){const factor=1+percent/100;for(let i=0;i<data.length;i+=4){data[i]=Math.min(255,Math.round(data[i]*factor));data[i+1]=Math.min(255,Math.round(data[i+1]*factor));data[i+2]=Math.min(255,Math.round(data[i+2]*factor));}return data;}
async function loadedComparisonImage(photo){const image=await loadedImage(photo.url),percent=brightnessPercent(photo);if(!percent)return image;
 const canvas=document.createElement('canvas'),scale=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);adjustBrightnessPixels(pixels.data,percent);ctx.putImageData(pixels,0,0);canvas.naturalWidth=canvas.width;canvas.naturalHeight=canvas.height;return canvas;
}
function brightnessSummary(photos,labels=['Prima','Dopo']){const changed=photos.map((p,i)=>{const n=brightnessPercent(p);return n?`${labels[i]||'Foto '+(i+1)} ${n>0?'+':''}${n}%`:'';}).filter(Boolean);return changed.length?'Luminosità regolata: '+changed.join(' · '):'';}
function photoPanel(key,index,allowSelect){
 const snap=snapshot(key),panel=document.createElement('article');panel.className='comparison-panel';
 const frame=document.createElement('div');frame.className='comparison-photo';
 if(snap.photo){const img=document.createElement('img');img.src=snap.photo.url;img.alt=snap.label;img.dataset.photoKey=key;img.style.filter=brightnessFilter(snap.photo);frame.append(img);}else{const empty=document.createElement('p');empty.className='empty-photo';empty.textContent='Foto non ancora acquisita';frame.append(empty);}
 const caption=document.createElement('div');caption.className='comparison-caption';
 if(allowSelect){const select=document.createElement('select');select.setAttribute('aria-label',`Foto nel riquadro ${index+1}`);const options=availableSnapshots();if(!options.some(([k])=>k===key))options.unshift([key,`${snap.label} · mancante`]);optionList(select,options,key);select.addEventListener('change',()=>{customSlots[index]=select.value;renderComparison();});caption.append(select);}
 else caption.textContent=snap.label;
 panel.append(frame,caption);return panel;
}
function renderComparison(){
 rememberVisit();$('comparePatient').textContent=$('patientCode').value.trim()?`Paziente ${$('patientCode').value.trim()}`:'Apri un archivio o acquisisci le foto';
 const rows=visits.map((v,i)=>[i,visitLabel(i)]);optionList($('compareBefore'),rows,compareA);optionList($('compareAfter'),rows,Math.min(compareB,visits.length-1));
 optionList($('comparePose'),POSES.map(p=>[p.id,p.title]),comparePose);
 document.querySelectorAll('[data-layout]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layout===comparisonLayout)));
 $('layoutHint').textContent={slider:'Trascina la linea per passare dal prima al dopo della stessa posa.',two:'Stessa posa, due visite affiancate. Lo zoom si applica a entrambe.',half:'Metà sinistra del prima e metà destra del dopo, nella stessa inquadratura.',grid:'Due coppie di foto. Puoi scegliere posa e visita in ogni riquadro.'}[comparisonLayout];
 const surface=$('comparisonSurface');surface.replaceChildren();surface.className=`comparison-surface layout-${comparisonLayout}`;
 if(!totalPhotos()){const p=document.createElement('p');p.className='comparison-empty';p.textContent='Acquisisci le sei foto del prima oppure apri il ZIP del paziente.';surface.append(p);$('exportComparison').disabled=true;return;}
 if(visits.length<2){const p=document.createElement('p');p.className='comparison-empty';p.textContent='Il prima è pronto. Apri Dopo per scattare la stessa sequenza al termine del trattamento.';surface.append(p);$('exportComparison').disabled=true;return;}
 if(compareA===compareB){const p=document.createElement('p');p.className='same-visit';p.textContent='Stai mostrando la stessa visita in entrambi i lati. Scegli due visite diverse per il prima e dopo.';surface.append(p);}
 if(comparisonLayout==='slider'||comparisonLayout==='half'){
  const a=snapshot(`${compareA}|${comparePose}`),b=snapshot(`${compareB}|${comparePose}`);
  if(!a.photo||!b.photo){surface.append(photoPanel(`${compareA}|${comparePose}`,0,false),photoPanel(`${compareB}|${comparePose}`,1,false));$('exportComparison').disabled=true;return;}
  const box=document.createElement('div');box.className='wipe-box';box.style.setProperty('--wipe','50%');
  const base=document.createElement('div');base.className='wipe-layer';const ai=document.createElement('img');ai.src=b.photo.url;ai.alt=b.label;ai.dataset.photoKey=`${compareB}|${comparePose}`;ai.style.filter=brightnessFilter(b.photo);base.append(ai);
  const over=document.createElement('div');over.className='wipe-layer wipe-after';const bi=document.createElement('img');bi.src=a.photo.url;bi.alt=a.label;bi.dataset.photoKey=`${compareA}|${comparePose}`;bi.style.filter=brightnessFilter(a.photo);over.append(bi);
  const divider=document.createElement('div');divider.className='wipe-divider';divider.setAttribute('aria-hidden','true');const handle=document.createElement('span');handle.textContent='↔';if(comparisonLayout==='slider')divider.append(handle);
  const range=document.createElement('input');range.type='range';range.min=0;range.max=100;range.value=50;range.className='wipe-range';range.setAttribute('aria-label','Scorri tra prima e dopo');range.addEventListener('input',()=>box.style.setProperty('--wipe',`${range.value}%`));
  const tags=document.createElement('div');tags.className='wipe-tags';for(const snap of [a,b]){const tag=document.createElement('span');tag.textContent=visitLabel(snap.visit);tags.append(tag);}
  box.append(base,over,divider);if(comparisonLayout==='slider')box.append(range);box.append(tags);surface.append(box);
  const note=document.createElement('p');note.className='wipe-caption';note.textContent=`${POSES.find(p=>p.id===comparePose).title} · Sinistra: ${visitLabel(compareA)} · Destra: ${visitLabel(compareB)}`;surface.append(note);
 }else{
  if(customSlots.length!==(comparisonLayout==='grid'?4:2))customSlots=slotDefaults();
  customSlots.forEach((key,i)=>surface.append(photoPanel(key,i,comparisonLayout!=='two')));
 }
 const keys=['slider','half'].includes(comparisonLayout)?[`${compareA}|${comparePose}`,`${compareB}|${comparePose}`]:customSlots;
 $('exportComparison').disabled=!keys.every(key=>snapshot(key).photo);applyZoom();
}
function applyZoom(){const zoom=Number($('compareZoom').value);$('zoomValue').textContent=`${zoom.toFixed(1).replace('.0','')}×`;$('comparisonSurface').style.setProperty('--zoom',String(zoom));}
for(const id of ['compareBefore','compareAfter','comparePose'])$(id).addEventListener('change',()=>{compareA=Number($('compareBefore').value);compareB=Number($('compareAfter').value);comparePose=$('comparePose').value;customSlots=[];renderComparison();});
document.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>{comparisonLayout=b.dataset.layout;customSlots=[];renderComparison();}));
$('compareZoom').addEventListener('input',applyZoom);$('resetZoom').addEventListener('click',()=>{$('compareZoom').value=1;applyZoom();});
$('backToPhotos').addEventListener('click',()=>{document.body.classList.remove('comparison-full');setView(visits.length>1?'after':'before');});
$('compareFullscreen').addEventListener('click',()=>{const full=document.body.classList.toggle('comparison-full');$('compareFullscreen').textContent=full?'Chiudi schermo intero':'Schermo intero';});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){document.body.classList.remove('comparison-full');$('compareFullscreen').textContent='Schermo intero';}});
async function loadedImage(url){const image=new Image();image.src=url;await image.decode();return image;}
function drawContain(ctx,img,x,y,w,h,zoom){ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();const scale=Math.min(w/img.naturalWidth,h/img.naturalHeight)*zoom,iw=img.naturalWidth*scale,ih=img.naturalHeight*scale;ctx.drawImage(img,x+(w-iw)/2,y+(h-ih)/2,iw,ih);ctx.restore();}
function drawHalfComparison(ctx,before,after,x,y,w,h,zoom=1){
 drawContain(ctx,after,x,y,w,h,zoom);ctx.save();ctx.beginPath();ctx.rect(x,y,w/2,h);ctx.clip();drawContain(ctx,before,x,y,w,h,zoom);ctx.restore();
 ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+w/2,y);ctx.lineTo(x+w/2,y+h);ctx.stroke();ctx.restore();
}
async function exportComparison(){
 if(typeof ensureAlignmentViews==='function'&&await ensureAlignmentViews()===false)return;
 const layout=comparisonLayout,keys=['slider','half'].includes(layout)?[`${compareA}|${comparePose}`,`${compareB}|${comparePose}`]:[...customSlots],snaps=keys.map(snapshot);
 if(snaps.some(s=>!s.photo))return;const patient=$('patientCode').value.trim(),zoom=Number($('compareZoom').value),wipe=layout==='half'?50:Number(document.querySelector('.wipe-range')?.value??50);
 $('exportComparison').disabled=true;
 try{
  const images=await Promise.all(snaps.map(s=>loadedComparisonImage(s.photo))),canvas=document.createElement('canvas');canvas.width=1800;canvas.height=layout==='grid'?2380:['slider','half'].includes(layout)?2420:1450;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#22252b';ctx.font='bold 40px sans-serif';ctx.fillText('Healthy Smile · Prima e dopo',50,70);ctx.font='26px sans-serif';ctx.fillText(`Paziente ${patient}`,50,113);
  const cell=(i,x,y,w,h)=>{ctx.fillStyle='#15171c';ctx.fillRect(x,y,w,h-96);drawContain(ctx,images[i],x,y,w,h-96,zoom);ctx.fillStyle='#22252b';ctx.font='bold 25px sans-serif';ctx.fillText(visitLabel(snaps[i].visit),x+10,y+h-60);ctx.font='24px sans-serif';ctx.fillText(POSES.find(p=>p.id===snaps[i].id).title,x+10,y+h-24);};
  if(layout==='slider'||layout==='half'){
   const x=50,y=150,w=1700,h=2110;ctx.fillStyle='#15171c';ctx.fillRect(x,y,w,h);drawContain(ctx,images[1],x,y,w,h,zoom);ctx.save();ctx.beginPath();ctx.rect(x,y,w*wipe/100,h);ctx.clip();drawContain(ctx,images[0],x,y,w,h,zoom);ctx.restore();ctx.strokeStyle='white';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x+w*wipe/100,y);ctx.lineTo(x+w*wipe/100,y+h);ctx.stroke();ctx.fillStyle='#22252b';ctx.font='24px sans-serif';ctx.fillText(`Sinistra: ${visitLabel(snaps[0].visit)}   |   Destra: ${visitLabel(snaps[1].visit)}`,50,2310);
  }else if(layout==='two'){cell(0,50,150,835,1200);cell(1,915,150,835,1200);}
  else {cell(0,50,150,835,1050);cell(1,915,150,835,1050);cell(2,50,1220,835,1050);cell(3,915,1220,835,1050);}
  const brightnessNote=brightnessSummary(snaps.map(s=>s.photo),snaps.map(s=>visitLabel(s.visit)));ctx.fillStyle='#606773';ctx.font='22px sans-serif';if(brightnessNote)ctx.fillText(brightnessNote,50,canvas.height-55);ctx.fillText(snaps.some(s=>s.photo.alignment)?'Inquadrature allineate (scala, rotazione, posizione) · Originali conservati':brightnessNote?'Luminosità uniforme regolata · Originali conservati':'Fotografie senza ritocchi · posa e luce possono influenzare il confronto',50,canvas.height-25);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error()),'image/jpeg',.95));download(blob,`${safeName(patient)}_confronto_${layout}.jpg`);notify('Confronto preparato. Gli originali restano nell’archivio ZIP.');
 }catch{notify('Non riesco a esportare il confronto. Riprova mantenendo aperta la pagina.');}finally{renderComparison();}
}
$('exportComparison').addEventListener('click',exportComparison);
$('visitPhase').value='before';render();
