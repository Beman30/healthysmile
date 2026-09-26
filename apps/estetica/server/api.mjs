const POSES=new Set(['front-neutral','front-smile','oblique-right','profile-right','oblique-left','profile-left','front-brows']);
const UUID=/^[a-f0-9-]{36}$/i, HASH=/^[a-f0-9]{64}$/;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(x,status=200)=>Response.json(x,{status,headers});
const fault=(status,message)=>{throw Object.assign(new Error(message),{status});};
function db(env){if(!env.DB||!env.BUCKET)fault(503,'Archivio temporaneamente non disponibile. Riprova.');return env.DB;}
async function owned(env,id,user){if(!UUID.test(id))fault(404,'Paziente non trovato.');const p=await db(env).prepare('SELECT * FROM patients WHERE id = ? AND owner = ?').bind(id,user).first();if(!p)fault(404,'Paziente non trovato.');return p;}
async function bounded(request,limit){const reader=request.body?.getReader();if(!reader)return new Uint8Array();let total=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();fault(413,'File troppo grande.');}chunks.push(value);}const out=new Uint8Array(total);let off=0;for(const c of chunks){out.set(c,off);off+=c.length;}return out;}
async function bodyJSON(r){try{return JSON.parse(new TextDecoder().decode(await bounded(r,500000)));}catch(e){if(e.status)throw e;fault(400,'Dati non validi.');}}
const short=(v,max)=>typeof v==='string'&&v.length<=max;
function validDate(value){const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
function cleanAlignment(a){
 const points=Array.isArray(a?.points)&&a.points.length>=2&&a.points.length<=32&&a.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1));
 if(!points)return null;
 if(a.version===1&&a.points.length===2&&Number.isFinite(a.angle)&&Math.abs(a.angle)<=Math.PI)return {version:1,angle:a.angle,points:a.points};
 if(a.version===2&&Array.isArray(a.targets)&&a.targets.length===a.points.length&&a.targets.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=100)))return {version:2,points:a.points,targets:a.targets};
 return null;
}
function cleanManifest(m,previousNotes=''){
 if(!m||!Array.isArray(m.visits)||m.visits.length>20)fault(400,'Numero di visite non valido.');
 if(m.notes!==undefined&&!short(m.notes,10000))fault(400,'Le note possono contenere al massimo 10000 caratteri.');
 const seen=new Set();let total=0;
 return {notes:m.notes===undefined?previousNotes:m.notes,visits:m.visits.map((v,i)=>{
  if(!UUID.test(v.id)||seen.has(v.id)||!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||!validDate(v.date)||!(i===0?v.phase==='before':['immediate','followup'].includes(v.phase))||!short(v.treatment,200)||!Array.isArray(v.photos)||v.photos.length>7)fault(400,'Dati della visita non validi.');
  seen.add(v.id);const poses=new Set();
  const photos=v.photos.map(p=>{
   if(!POSES.has(p.pose)||poses.has(p.pose)||!HASH.test(p.hash)||!Number.isInteger(p.width)||p.width<1||p.width>20000||!Number.isInteger(p.height)||p.height<1||p.height>20000)fault(400,'Foto non valida.');
   poses.add(p.pose);return {pose:p.pose,hash:p.hash,width:p.width,height:p.height,takenAt:short(p.takenAt,40)?p.takenAt:null,station:p.station&&typeof p.station==='object'?{name:String(p.station.name||'').slice(0,80),lights:String(p.station.lights||'').slice(0,200),guideScale:Number(p.station.guideScale)||70,shoulderWidth:Number(p.station.shoulderWidth)||100}:null,camera:{label:String(p.camera?.label||'').slice(0,160),deviceId:typeof p.camera?.deviceId==='string'?p.camera.deviceId.slice(0,256):null,zoom:Number.isFinite(p.camera?.zoom)?p.camera.zoom:null},crop:null,level:p.level&&typeof p.level==='object'?{roll:Number.isFinite(p.level.roll)?p.level.roll:null,pitch:Number.isFinite(p.level.pitch)?p.level.pitch:null,screenAngle:Number.isFinite(p.level.screenAngle)?p.level.screenAngle:null}:null,alignment:cleanAlignment(p.alignment),brightness:Number.isFinite(p.brightness)?Math.max(-50,Math.min(50,Math.round(p.brightness))):0};
  });
  const selected=Array.isArray(v.selected)?[...new Set(v.selected.filter(x=>POSES.has(x)))]:null;
  return {id:v.id,date:v.date,phase:v.phase,treatment:v.treatment,selected,photos};
 })};
}
export async function api(request,env,identity){
 try{
  const user=identity?.studioId;if(!user)return json({error:'Accedi con il tuo account dello studio.'},401);
  const url=new URL(request.url),method=request.method;
  if(!['GET','HEAD'].includes(method)&&(request.headers.get('X-HS-Write')!=='1'||request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')!==url.origin))return json({error:'Richiesta non autorizzata.'},403);
  const database=db(env),parts=url.pathname.split('/').filter(Boolean);
  if(parts[1]!=='patients')return json({error:'Non trovato.'},404);
  if(parts.length===2&&method==='GET'){
   const rows=await database.prepare('SELECT id, code, name, version, updated FROM patients WHERE owner = ? ORDER BY updated DESC').bind(user).all();return json({patients:rows.results});
  }
  const id=parts[2];if(!UUID.test(id||''))return json({error:'Non trovato.'},404);
  if(parts.length===3&&method==='PUT'){
   const data=await bodyJSON(request);if(!short(data.code,40)||!data.code.trim()||!short(data.name,100))fault(400,'Inserisci un codice valido (massimo 40 caratteri).');
   const code=data.code.trim().toUpperCase(),name=data.name.trim();
   await database.prepare('INSERT INTO patients (id, owner, code, name, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(id,user,code,name,new Date().toISOString()).run();
   const p=await database.prepare('SELECT id, code, name, version, updated FROM patients WHERE id = ? AND owner = ?').bind(id,user).first();
   if(!p||p.code!==code)fault(409,'Codice già presente. Apri il paziente dall’archivio.');return json(p);
  }
  const patient=await owned(env,id,user);
  if(parts.length===3&&method==='GET')return json({...patient,owner:undefined,manifest:JSON.parse(patient.manifest)});
  if(parts[3]==='images'&&parts.length===5){
   const hash=parts[4];if(!HASH.test(hash))fault(404,'Foto non trovata.');const key=`patients/${id}/${hash}`;
   if(method==='GET'){
    const row=await database.prepare('SELECT mime FROM images WHERE patient = ? AND hash = ?').bind(id,hash).first();if(!row)fault(404,'Foto non trovata.');
    const obj=await env.BUCKET.get(key);if(!obj)fault(503,'Foto temporaneamente non disponibile. Riprova.');return new Response(obj.body,{headers:{...headers,'Content-Type':row.mime}});
   }
   if(method==='PUT'){
    const bytes=await bounded(request,25*1024*1024),actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(actual!==hash)fault(400,'Verifica del file non riuscita.');
    const mime=bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'?'image/webp':null;
    if(!mime)fault(415,'Usa JPG, PNG o WebP.');
    await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:mime}});
    await database.prepare('INSERT INTO images (id, patient, hash, mime, size) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(key,id,hash,mime,bytes.length).run();return json({hash});
   }
  }
  if(parts[3]==='manifest'&&parts.length===4&&method==='PUT'){
   const data=await bodyJSON(request);if(!Number.isInteger(data.version)||data.version<0)fault(400,'Versione non valida.');
   const manifest=cleanManifest(data.manifest,JSON.parse(patient.manifest).notes||''),refs=new Set(manifest.visits.flatMap(v=>v.photos.map(p=>p.hash)));
   const stored=await database.prepare('SELECT hash, size FROM images WHERE patient = ?').bind(id).all(),known=new Map(stored.results.map(r=>[r.hash,r.size]));let total=0;
   for(const hash of refs){if(!known.has(hash))fault(400,'Attendi il caricamento di tutte le foto.');total+=known.get(hash);}if(total>250*1024*1024)fault(413,'Archivio oltre 250 MB. Esporta una copia prima di proseguire.');
   const result=await database.prepare('UPDATE patients SET manifest = ?, version = version + 1, updated = ? WHERE id = ? AND owner = ? AND version = ?').bind(JSON.stringify(manifest),new Date().toISOString(),id,user,data.version).run();
   if(result.meta.changes!==1)fault(409,'Il paziente è stato aggiornato su un altro dispositivo. Esporta le modifiche locali, poi riapri il paziente.');
   return json({version:data.version+1});
  }
  return json({error:'Non trovato.'},404);
 }catch(e){if(e.status)return json({error:e.message},e.status);console.error('Archive storage operation failed');return json({error:'Salvataggio non riuscito. Mantieni aperta la pagina e riprova.'},503);}
}
