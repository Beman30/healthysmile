'use strict';
// Patient identity is bound before capture; the cloud is the durable source of truth.
const cloud={patient:null,version:0,saved:'',saving:null,loading:false,error:'',conflict:false,timer:null,rows:[],blobIds:new WeakMap(),nextBlob:0,createKey:null,switching:false,creating:false};
function visitIdentity(v){v.id ||=crypto.randomUUID();v.treatment ||= '';}
function localSignature(){return JSON.stringify({notes:cloud.patient?.notes||'',visits:visits.map(v=>{visitIdentity(v);return {id:v.id,date:v.date,phase:v.phase,treatment:v.treatment,selected:v.selected||null,photos:[...v.photos].map(([id,p])=>{if(!cloud.blobIds.has(p.blob))cloud.blobIds.set(p.blob,++cloud.nextBlob);return [id,cloud.blobIds.get(p.blob),p.alignment||null,p.brightness||0];})};})});}
const cloudDirty=()=>!!cloud.patient&&localSignature()!==cloud.saved;
async function cloudRequest(path,options={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{const r=await fetch('/api/patients'+path,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{...(options.method?{'X-HS-Write':'1'}:{}),...options.headers}});
 if(!r.ok){let data;try{data=await r.json();}catch{}throw Object.assign(Error(data?.error||'Archivio non raggiungibile. Mantieni aperta la pagina e riprova.'),{status:r.status});}return r;
 }finally{clearTimeout(timer);}
}
const cloudJSON=async(path,data)=>{const r=await cloudRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return r.json();};
function paintCloud(){
 const dirty=cloudDirty();if(cloud.patient&&!dirty&&!cloud.saving)exportRevision=revision;document.body.classList.toggle('no-patient',!cloud.patient);
 $('cloudPatientLabel').textContent=cloud.patient?`${cloud.patient.name?cloud.patient.name+' · ':''}${cloud.patient.code}`:'Seleziona un paziente';
 $('cloudStatus').textContent=cloud.loading?'Caricamento…':cloud.error?`Da salvare · ${cloud.error}`:cloud.saving?'Salvataggio…':dirty?'Da salvare…':cloud.patient?'Salvato nel cloud':'Apri o crea il paziente';
 $('cloudStatus').className=cloud.error?'cloud-error':dirty||cloud.saving?'cloud-pending':'cloud-saved';
 $('retryCloud').hidden=!cloud.error||cloud.conflict||!cloud.patient;$('reloadCloud').hidden=!cloud.conflict;
 $('patientPicker').disabled=cloud.loading||!!cloud.saving;$('closePatients').hidden=!cloud.patient;
 $('patientCode').readOnly=true;$('patientNotes').disabled=!cloud.patient||cloud.loading;
 $('saveStatus').textContent=cloud.patient?(dirty?'Modifiche da salvare nel cloud.':cloud.saving?'Salvataggio in corso…':'Foto archiviate nel cloud. Il ZIP è una copia aggiuntiva.'):'Seleziona un paziente prima di scattare.';
 $('exportCopy').textContent='Le foto confermate vengono salvate automaticamente nel cloud. Puoi scaricare un ZIP completo come copia aggiuntiva.';
 $('archiveHint').textContent=cloud.patient?`${visits.length} visite · ${totalPhotos()} foto · ${cloud.patient.code}`:'Scegli il paziente per iniziare.';
 $('saveArchiveTop').textContent='Scarica copia ZIP';$('exportZip').textContent='Scarica copia completa ZIP';$('openArchive').hidden=true;
 $('newSession').textContent='Cambia paziente';
 if(!cloud.patient||cloud.loading){$('capture').disabled=true;$('startCamera').disabled=true;$('importCurrent').disabled=true;$('choosePrevious').disabled=true;}else $('startCamera').disabled=false;
 if(cloud.patient&&!cloud.loading&&!cloud.saving&&!cloud.error&&dirty){clearTimeout(cloud.timer);cloud.timer=setTimeout(()=>syncCloud(),700);}
}
const flowBeforeCloud=renderFlow;renderFlow=function(){flowBeforeCloud();paintCloud();};
async function fileHash(p){if(!p.cloudHash){const b=await crypto.subtle.digest('SHA-256',await p.blob.arrayBuffer());p.cloudHash=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}return p.cloudHash;}
async function syncCloud(){
 clearTimeout(cloud.timer);if(cloud.saving)return cloud.saving;if(!cloud.patient||cloud.loading||cloud.conflict)return false;
 rememberVisit();if(!cloudDirty()){paintCloud();return true;}
 cloud.error='';
 cloud.saving=(async()=>{
  try{
   while(cloudDirty()){
    const patient=cloud.patient.id,signature=localSignature();
    const snap=visits.map(v=>({...v,photos:[...v.photos]}));
    if(snap.reduce((n,v)=>n+v.photos.reduce((s,[id,p])=>s+p.blob.size,0),0)>250*1024*1024)throw Error('Archivio oltre 250 MB. Scarica il ZIP.');
    const manifest={notes:cloud.patient.notes||'',visits:[]};
    for(const v of snap){const meta={id:v.id,date:v.date,phase:v.phase,treatment:v.treatment||'',selected:v.selected||null,photos:[]};
     for(const [pose,p]of v.photos){const hash=await fileHash(p);if(p.cloudPatient!==patient){await cloudRequest(`/${patient}/images/${hash}`,{method:'PUT',headers:{'Content-Type':p.blob.type},body:p.blob});p.cloudPatient=patient;}
      meta.photos.push({...photoMeta(pose,p,''),hash});
     }manifest.visits.push(meta);
    }
    const result=await cloudJSON(`/${patient}/manifest`,{version:cloud.version,manifest});
    cloud.version=result.version;cloud.saved=signature;if(localSignature()===signature)exportRevision=revision;
   }return true;
  }catch(e){cloud.error=e.name==='AbortError'?'Connessione lenta o interrotta. Premi Riprova.':e.message;cloud.conflict=e.status===409;return false;}
 })();paintCloud();const result=await cloud.saving;cloud.saving=null;paintCloud();return result;
}
async function safePatientChange(){if(!readyToNavigate()||cloud.loading)return false;if(cloudDirty()||cloud.saving){if(!await syncCloud()){notify('Completa il salvataggio prima di cambiare paziente.');return false;}}stopCamera();return true;}
async function refreshPatients(){
 $('patientListStatus').textContent='Caricamento archivio…';$('refreshPatients').disabled=true;
 try{const data=await(await cloudRequest('')).json();cloud.rows=data.patients;$('patientListStatus').textContent=cloud.rows.length?'':'Nessun paziente. Crea il primo oppure importa un ZIP.';renderPatients();}
 catch(e){$('patientListStatus').textContent=e.message;}
 finally{$('refreshPatients').disabled=false;}
}
function renderPatients(){
 const query=$('patientSearch').value.trim().toLocaleLowerCase('it'),rows=cloud.rows.filter(p=>`${p.name} ${p.code}`.toLocaleLowerCase('it').includes(query));
 $('patientResults').replaceChildren(...rows.map(p=>{const button=document.createElement('button');button.className='patient-row';const title=document.createElement('strong'),info=document.createElement('span');title.textContent=p.name||p.code;info.textContent=`${p.name?p.code+' · ':''}Aggiornato ${dateLabel(p.updated.slice(0,10))}`;button.append(title,info);button.addEventListener('click',()=>{if(!cloud.creating)openCloudPatient(p.id);});return button;}));
 if(query&&!rows.length)$('patientListStatus').textContent='Nessuna corrispondenza.';else if(rows.length)$('patientListStatus').textContent=`${rows.length} pazienti`;
}
async function showPatients(){if(cloud.creating||cloud.switching||!await safePatientChange())return;$('closePatients').hidden=!cloud.patient;if(!$('patientDialog').open)$('patientDialog').showModal();refreshPatients();}
function installCloudVisits(patient,staged,version){
 stopCamera();discardPending();releaseVisits();visits=staged.length?staged:[{id:crypto.randomUUID(),date:localDate(),phase:'before',treatment:'',photos:new Map()}];
 activeVisit=0;lastFollowup=Math.max(1,visits.length-1);photos=visits[0].photos;current=0;view='before';compareA=0;compareB=Math.max(1,visits.length-1);customSlots=[];
 $('patientCode').value=patient.code;$('visitDate').value=visits[0].date;$('visitPhase').value='before';$('treatment').value=visits[0].treatment||'';
 cloud.patient={...patient,notes:patient.notes||''};$('patientNotes').value=cloud.patient.notes;$('patientNotesPanel').open=false;cloud.version=version;cloud.error='';cloud.conflict=false;cloud.saved=staged.length?localSignature():'';revision=0;exportRevision=0;
 document.body.classList.remove('comparison-full','patient-mode');$('patientNavigation').hidden=true;
}
async function openCloudPatient(id,{force=false}={}){
 if(cloud.loading||cloud.switching)return;cloud.switching=true;if(!force&&!await safePatientChange()){cloud.switching=false;return;}
 cloud.loading=true;paintCloud();$('patientListStatus').textContent='Caricamento delle visite e delle foto…';const staged=[];
 try{const data=await(await cloudRequest('/'+id)).json();
  for(const v of data.manifest.visits){const visit={...v,photos:new Map()};staged.push(visit);for(const meta of v.photos){const blob=await(await cloudRequest(`/${id}/images/${meta.hash}`)).blob();const url=await validatedImage(blob);visit.photos.set(meta.pose,{...meta,blob,url,cloudHash:meta.hash,cloudPatient:id});}}
  installCloudVisits({id:data.id,code:data.code,name:data.name,notes:data.manifest.notes||''},staged,data.version);$('patientDialog').close();
 }catch(e){staged.forEach(v=>v.photos.forEach(revoke));$('patientListStatus').textContent=e.message;notify(e.message);}
 finally{cloud.loading=false;cloud.switching=false;render();}
}
$('patientPicker').addEventListener('click',showPatients);$('refreshPatients').addEventListener('click',refreshPatients);$('patientSearch').addEventListener('input',renderPatients);
$('closePatients').addEventListener('click',()=>{if(cloud.patient)$('patientDialog').close();});$('patientDialog').addEventListener('cancel',e=>{if(!cloud.patient||cloud.loading)e.preventDefault();});
$('newPatientForm').addEventListener('submit',async e=>{
 e.preventDefault();if(cloud.loading||cloud.switching||cloud.creating)return;const code=$('newPatientCode').value.trim().toUpperCase(),name=$('newPatientName').value.trim();if(!code)return;if(!await safePatientChange())return;
 const signature=code+'|'+name;if(cloud.createKey?.signature!==signature)cloud.createKey={signature,id:crypto.randomUUID()};
 cloud.creating=true;$('createPatient').disabled=true;$('createPatientStatus').textContent='Creazione…';
 try{const p=await cloudJSON('/'+cloud.createKey.id,{code,name});await openCloudPatient(p.id);$('newPatientCode').value='';$('newPatientName').value='';cloud.createKey=null;$('createPatientStatus').textContent='';}
 catch(e){$('createPatientStatus').textContent=e.message;}finally{cloud.creating=false;$('createPatient').disabled=false;}
});
$('retryCloud').addEventListener('click',()=>{cloud.error='';syncCloud();});
$('reloadCloud').addEventListener('click',()=>{if(pending||cloud.loading)return;if(window.confirm('Riaprire la versione cloud? Le modifiche locali non salvate saranno rimosse. Scarica prima il ZIP se vuoi conservarle.'))openCloudPatient(cloud.patient.id,{force:true});});
window.addEventListener('online',()=>{if(cloud.error&&!cloud.conflict){cloud.error='';syncCloud();}});
window.addEventListener('beforeunload',e=>{if(cloudDirty()||cloud.saving){e.preventDefault();e.returnValue='';}});
$('patientNotes').addEventListener('input',()=>{if(!cloud.patient||cloud.loading)return;cloud.patient.notes=$('patientNotes').value;revision++;paintCloud();});
$('patientNotes').addEventListener('blur',()=>{if(cloudDirty()&&!cloud.error)syncCloud();});
$('treatment').addEventListener('input',()=>{rememberVisit();revision++;paintCloud();});
// Existing reset buttons now open the patient chooser, never erase the cloud record.
$('confirmReset').removeEventListener('click',resetSession);
resetSession=function(){$('resetDialog').close();showPatients();};$('confirmReset').addEventListener('click',resetSession);
// ZIP imports create a distinct patient and never overwrite an open cloud patient.
loadArchive=async function(file){
 if(!file||cloud.loading||cloud.switching||cloud.creating)return;cloud.switching=true;if(!await safePatientChange()){cloud.switching=false;return;}let staged;cloud.loading=true;paintCloud();$('patientListStatus').textContent='Importazione ZIP…';
 try{staged=await parseArchive(file);const code=staged.code.trim().toUpperCase();
  const rows=(await(await cloudRequest('')).json()).patients;if(rows.some(p=>p.code===code))throw Error('Questo codice esiste già nel cloud. Apri il paziente dall’elenco; l’importazione non lo sovrascrive.');
  const p=await cloudJSON('/'+crypto.randomUUID(),{code,name:''});staged.visits.forEach(visitIdentity);installCloudVisits({...p,notes:staged.notes},staged.visits,0);cloud.saved='';$('patientDialog').close();
 }catch(e){staged?.visits.forEach(v=>{if(!visits.includes(v))v.photos.forEach(revoke);});$('patientListStatus').textContent=e.message;notify(e.message);}
 finally{cloud.loading=false;cloud.switching=false;render();}
};
$('importPatientZip').addEventListener('click',()=>$('patientZipInput').click());$('patientZipInput').addEventListener('change',e=>{const f=e.target.files?.[0];e.target.value='';loadArchive(f);});
render();$('patientDialog').showModal();refreshPatients();
