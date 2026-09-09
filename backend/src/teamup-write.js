import {romeTime, readDay} from './teamup.js';

export const WRITE_SCHEMA=`CREATE TABLE IF NOT EXISTS teamup_owned_events (
 booking_id TEXT PRIMARY KEY, event_id TEXT UNIQUE, remote_id TEXT NOT NULL UNIQUE,
 calendar_id INTEGER NOT NULL, key_hash TEXT NOT NULL, version TEXT,
 state TEXT NOT NULL, busy INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`;
const now=()=>new Date().toISOString();
const apiDate=ms=>new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00');
function writeError(code) {const e=new Error(code);e.teamupCode=code;return e;}

async function digest(s) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function key(env) {const k=String(env.TEAMUP_CALENDAR_KEY||'').trim();if(!/^ks[a-zA-Z0-9]+$/.test(k))throw Error('Collegamento Teamup non configurato');return k;}
async function request(env,method,path,body,version,fetcher=fetch) {
 const token=String(env.TEAMUP_API_KEY||'').trim();if(!token||/\s/.test(token))throw Error('Chiave API Teamup non valida');
 const params=new URLSearchParams({inputFormat:'markdown',format:'markdown'});if(version)params.set('version',version);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try {
  const r=await fetcher(`https://api.teamup.com/${key(env)}/${path}?${params}`,{method,redirect:'manual',signal:controller.signal,
   headers:{'Teamup-Token':token,Accept:'application/json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok) {
   const data=await r.json().catch(()=>null);
   const error=data?.error||data?.key?.error||data?.key||data;
   const candidates=[error?.id,error?.code,data?.code];
   const id=candidates.find(x=>typeof x==='string'&&/^[a-z][a-z0-9_-]{0,95}$/.test(x)&&![token,key(env)].some(secret=>x.includes(secret)||secret.includes(x)));
   const failure=writeError('TEAMUP_HTTP_'+r.status+(id?'_'+id:''));
   // Detailed upstream diagnostics are restricted to synthetic probe payloads.
   if(typeof body?.title==='string'&&body.title.startsWith('PROVA TECNICA SITO')) {
    let detail=JSON.stringify(error??{response:'non_json'});
    for(const secret of [token,key(env)])detail=detail.split(secret).join('[omesso]');
    failure.probeDetail=detail.replace(/https?:\/\/[^\s"<>]+/g,'[URL omesso]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email omessa]').slice(0,1500);
   }
   throw failure;
  }
  try {return await r.json();}catch {throw writeError('TEAMUP_RESPONSE_NOT_JSON');}
 } catch(e) {if(e.teamupCode)throw e;throw writeError(controller.signal.aborted?'TEAMUP_TIMEOUT':'TEAMUP_NETWORK');}
 finally {clearTimeout(timer);}
}
export async function owned(db,id) {
 if(!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teamup_owned_events'").first())return null;
 return db.prepare('SELECT * FROM teamup_owned_events WHERE booking_id=?').bind(id).first();
}
export async function validateWriteAccess(env,calendarId,fetcher=fetch) {
 const d=await request(env,'GET','configuration',null,null,fetcher);
 const c=d.configuration?.subcalendars?.find(c=>c.id===calendarId);
 if(!c||c.readonly!==false)throw Error('Il calendario del sito deve essere accessibile con il permesso Modify from same link.');
}
function identity(e,row) {
 return e && /^\d+$/.test(String(e.id)) && (!row.event_id||String(e.id)===row.event_id) && e.remote_id===row.remote_id &&
  Array.isArray(e.subcalendar_ids)&&e.subcalendar_ids.length===1&&e.subcalendar_ids[0]===row.calendar_id &&
  !e.rrule&&!e.series_id&&!e.all_day&&!e.delete_dt && typeof e.version==='string'&&e.version.length>0;
}
async function current(env,row,fetcher) {
 if(!row.event_id||row.key_hash!==await digest(key(env)))throw Error('Evento non associato a questo collegamento del sito');
 const {event}=await request(env,'GET','events/'+row.event_id,null,null,fetcher);
 if(!identity(event,row)||event.version!==row.version||event.readonly)throw Error('Evento modificato fuori dal sito o non più verificabile: intervento dello studio necessario.');
 return event;
}
export async function omitOwnEvent(db,bookingId,events) {
 if(bookingId==='-none-')return events;
 const row=await owned(db,bookingId);if(!row)return events;
 if(!row.event_id||!['held','confirmed','review'].includes(row.state))throw Error('Sincronizzazione Teamup da verificare');
 const e=events.find(e=>String(e.id)===row.event_id);
 if(!e||!identity(e,row)||e.version!==row.version)throw Error('Appuntamento Teamup cambiato: verifica necessaria');
 return events.filter(e=>String(e.id)!==row.event_id);
}

export async function createOwnedHold(env,b,config,fetcher=fetch) {
 if(!config?.write_enabled)return false;
 if(await owned(env.DB,b.booking_id))throw Error('Inserimento Teamup già tentato: non viene duplicato');
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS teamup_write_errors (booking_id TEXT PRIMARY KEY, code TEXT NOT NULL)').run();
 const marker='hs-site-'+crypto.randomUUID();
 const row={booking_id:b.booking_id,remote_id:marker,calendar_id:config.write_calendar_id,key_hash:await digest(key(env))};
 // Journal BEFORE the POST. A timeout must never cause a blind second creation.
 await env.DB.prepare(`INSERT INTO teamup_owned_events(booking_id,remote_id,calendar_id,key_hash,state,busy,updated_at)
  VALUES(?,?,?,?,'creating',1,?)`).bind(row.booking_id,marker,row.calendar_id,row.key_hash,now()).run();
 const date=b.date||b.appointment_date,time=b.time||b.appointment_time,start=romeTime(date,time);
 const payload={subcalendar_ids:[row.calendar_id],remote_id:marker,title:b.teamup_test?'PROVA TECNICA SITO — da rimuovere':'Sito · in attesa di pagamento · '+b.booking_id.slice(0,8),
  start_dt:apiDate(start),end_dt:apiDate(start+3600000),all_day:false,
  who:b.teamup_test?'Prova tecnica - nessun importo':'Pagamento online in attesa',
  notes:'Prenotazione sito '+b.booking_id,signup_enabled:false,comments_enabled:false,attachments:[]};
 try {
  const {event}=await request(env,'POST','events',payload,null,fetcher);
  if(!identity(event,row)||Date.parse(event.start_dt)!==start||Date.parse(event.end_dt)!==start+3600000)throw writeError(!identity(event,row)?'TEAMUP_EVENT_IDENTITY_MISMATCH':'TEAMUP_EVENT_TIME_MISMATCH');
  await env.DB.prepare("UPDATE teamup_owned_events SET event_id=?,version=?,state='held',busy=0,updated_at=? WHERE booking_id=?")
   .bind(String(event.id),event.version,now(),b.booking_id).run();
  return true;
 } catch(e) {
  await env.DB.prepare('INSERT OR REPLACE INTO teamup_write_errors(booking_id,code) VALUES(?,?)').bind(b.booking_id,e.teamupCode||'TEAMUP_LOCAL_WRITE_FAILURE').run();
  await env.DB.prepare("UPDATE teamup_owned_events SET state='uncertain',busy=0,updated_at=? WHERE booking_id=?").bind(now(),b.booking_id).run();
  throw e;
 }
}

export async function syncOwnedEvent(env,b,action,fetcher=fetch) {
 let row=await owned(env.DB,b.booking_id);if(!row)return false;
 if(!['confirm','delete'].includes(action))throw Error('Operazione Teamup non consentita');
 if(action==='delete'&&row.state==='deleted')return true;
 if(!['held','confirmed','review'].includes(row.state))throw Error('Evento Teamup da verificare: nessuna modifica automatica consentita');
 const lock=await env.DB.prepare('UPDATE teamup_owned_events SET busy=1 WHERE booking_id=? AND busy=0').bind(b.booking_id).run();
 if(lock.meta.changes!==1){const error=Error('Aggiornamento Teamup già in corso');error.code='TEAMUP_BUSY';throw error;}
 try {
  row=await owned(env.DB,b.booking_id);
  const event=await current(env,row,fetcher);
  if(action==='confirm'&&row.state==='confirmed')return true;
  if(action==='delete') {
   await request(env,'DELETE','events/'+row.event_id,null,event.version,fetcher);
   await env.DB.prepare("UPDATE teamup_owned_events SET state='deleted',updated_at=? WHERE booking_id=?").bind(now(),b.booking_id).run();
  } else {
   // Preserve fields the API requires; do not provide an event ID from a client request.
   const payload={id:row.event_id,version:event.version,subcalendar_ids:[row.calendar_id],remote_id:row.remote_id,
    start_dt:event.start_dt,end_dt:event.end_dt,all_day:false,signup_enabled:event.signup_enabled,
    comments_enabled:event.comments_enabled,attachments:event.attachments,
    title:b.teamup_test?'PROVA TECNICA SITO — modifica verificata':`Sito · ${b.last_name} ${b.first_name} · Visita + Igiene`,
    notes:b.teamup_test?'Prova tecnica senza paziente o pagamento.':`Prenotazione sito ${b.booking_id}\nTelefono: ${b.phone}\nAcconto ricevuto.`,
    location:event.location,who:b.teamup_test?'Prova tecnica - nessun importo':(Number.isFinite(Number(b.balance_due))&&Number(b.balance_due)>0?'Saldo in studio: '+Number(b.balance_due).toFixed(2)+' EUR':'Pagamento ricevuto - nessun saldo'),custom:event.custom};
   const {event:updated}=await request(env,'PUT','events/'+row.event_id,payload,null,fetcher);
   if(!identity(updated,row))throw Error('Aggiornamento Teamup non verificabile');
   await env.DB.prepare("UPDATE teamup_owned_events SET version=?,state='confirmed',updated_at=? WHERE booking_id=?")
    .bind(updated.version,now(),b.booking_id).run();
  }
  return true;
 } catch(error) {
  await env.DB.prepare("UPDATE teamup_owned_events SET state='review',updated_at=? WHERE booking_id=? AND state<>'deleted'").bind(now(),b.booking_id).run();
  throw error;
 } finally {await env.DB.prepare('UPDATE teamup_owned_events SET busy=0 WHERE booking_id=?').bind(b.booking_id).run();}
}

export async function cleanupOwnedEvents(env) {
 if(!await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teamup_owned_events'").first())return;
 const {results}=await env.DB.prepare(`SELECT e.booking_id FROM teamup_owned_events e LEFT JOIN bookings b ON b.booking_id=e.booking_id
  WHERE e.state IN ('held','confirmed','review') AND e.busy=0 AND (b.booking_status='cancelled' OR b.booking_id IS NULL) LIMIT 10`).all();
 for(const b of results||[]) {try {await syncOwnedEvent(env,b,'delete');}catch{/* Keep event and journal for staff review. */}}
}

// Isolated admin probe: no patient booking, slot, payment or settings mutation.
export async function testWrite(env, config) {
 if(!config?.write_calendar_id)throw Error('Salva prima il calendario dedicato al sito.');
 if(config.write_enabled)throw Error('Disattiva e salva la scrittura automatica prima della prova.');
 if(config.subcalendar_ids?.includes(config.write_calendar_id))throw Error('Il calendario della prova deve essere separato dalle agende Medici.');
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS teamup_write_probe (
 id INTEGER PRIMARY KEY CHECK(id=1), booking_id TEXT NOT NULL, busy INTEGER NOT NULL,
 step TEXT NOT NULL, code TEXT, updated_at TEXT NOT NULL)`).run();
 // Retry a rejected historical probe only after an authoritative read finds no trace.
 const previous=await env.DB.prepare('SELECT * FROM teamup_write_probe WHERE id=1').first();
 if(previous&&!previous.busy&&previous.step==='create'&&/^TEAMUP_HTTP_400(?:_|$)/.test(previous.code||'')) {
  const held=await env.DB.prepare('UPDATE teamup_write_probe SET busy=1 WHERE id=1 AND busy=0 AND booking_id=?').bind(previous.booking_id).run();
  if(held.meta.changes!==1)throw Error('Prova già in corso.');
  try {
   const row=await owned(env.DB,previous.booking_id);
   if(!row||row.state!=='uncertain'||row.event_id||row.key_hash!==await digest(key(env))||row.calendar_id!==config.write_calendar_id)throw Error('Prova precedente da verificare: configurazione cambiata.');
   await validateWriteAccess(env,config.write_calendar_id);
   const events=await readDay(env,'2020-01-02',[config.write_calendar_id]);
   if(events.some(e=>e.remote_id===row.remote_id||String(e.title||'').startsWith('PROVA TECNICA SITO')||String(e.notes||e.note||'').includes(previous.booking_id)))throw Error('Evento tecnico presente: nessuna nuova creazione.');
   await env.DB.prepare("UPDATE teamup_owned_events SET state='deleted',updated_at=? WHERE booking_id=? AND state='uncertain'").bind(now(),previous.booking_id).run();
  }finally{await env.DB.prepare('UPDATE teamup_write_probe SET busy=0 WHERE id=1 AND booking_id=?').bind(previous.booking_id).run();}
 }
 const id='write-test-'+crypto.randomUUID();
 const lock=await env.DB.prepare(`INSERT INTO teamup_write_probe(id,booking_id,busy,step,updated_at)
 VALUES(1,?,1,'access',?) ON CONFLICT(id) DO UPDATE SET booking_id=excluded.booking_id,busy=1,step='access',code=NULL,updated_at=excluded.updated_at
 WHERE teamup_write_probe.busy=0 AND (teamup_write_probe.step='done' OR NOT EXISTS(
 SELECT 1 FROM teamup_owned_events WHERE booking_id=teamup_write_probe.booking_id AND state<>'deleted'))`).bind(id,now()).run();
 if(lock.meta.changes!==1)throw Error('Una prova è in corso o ha lasciato un evento da verificare. Nessun nuovo evento creato.');
 let step='access';
 const progress=async value=>{step=value;await env.DB.prepare('UPDATE teamup_write_probe SET step=?,updated_at=? WHERE id=1 AND booking_id=?').bind(step,now(),id).run();};
 // Fixed historical date: probe never occupies a currently bookable slot.
 const b={booking_id:id,date:'2020-01-02',time:'12:00',teamup_test:true};
 try {
  await validateWriteAccess(env,config.write_calendar_id);
  await progress('create');
  await createOwnedHold(env,b,{...config,write_enabled:true});
  await progress('update');await syncOwnedEvent(env,b,'confirm');
  await progress('delete');await syncOwnedEvent(env,b,'delete');
  await progress('done');
  return {ok:true,step,booking_id:id,message:'Prova riuscita: evento creato, modificato e cancellato. Nessun pagamento avviato.'};
 } catch(e) {
  const code=e.teamupCode||'TEAMUP_'+step.toUpperCase()+'_CHECK_FAILED';
  await env.DB.prepare('UPDATE teamup_write_probe SET code=? WHERE id=1 AND booking_id=?').bind(code,id).run();
  return {ok:false,step,code,booking_id:id,message:'Prova fermata: '+step+' · '+code+(e.probeDetail?' · '+e.probeDetail:'')+'. La scrittura delle prenotazioni resta disattivata.'};
 } finally {await env.DB.prepare('UPDATE teamup_write_probe SET busy=0,updated_at=? WHERE id=1 AND booking_id=?').bind(now(),id).run();}
}
