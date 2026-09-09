import {WRITE_SCHEMA, validateWriteAccess, omitOwnEvent, syncOwnedEvent} from './teamup-write.js';
import {calendars, preview, readDay, romeTime} from './teamup.js';

export const TEAMUP_SERVICE = 'igiene-sonicare';
const stamp = () => new Date().toISOString();
const ACTIVE = "('held','booked','review')";
// Appointment lengths for existing website services are treated conservatively as 60 minutes.
const overlap = (alias, date='NEW.date', start='NEW.time', end='NEW.end_time') =>
  `${alias}.date=${date} AND ${alias}.time<${end} AND strftime('%H:%M',${alias}.time,'+60 minutes')>${start}`;

export async function installed(db) {
  return !!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teamup_settings'").first();
}
export async function settings(db) {
  if (!await installed(db)) return null;
  const row = await db.prepare('SELECT value, revision FROM teamup_settings WHERE id=1').first();
  return row ? {...JSON.parse(row.value),revision:row.revision} : null;
}
export async function reservation(db,id) {
  if (!await installed(db)) return null;
  return db.prepare('SELECT * FROM teamup_reservations WHERE booking_id=?').bind(id).first();
}

// Called only after authentication. DDL and triggers are installed in one transaction.
export async function install(db) {
  const commands = [WRITE_SCHEMA,
    'CREATE TABLE IF NOT EXISTS teamup_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, revision INTEGER NOT NULL)',
    `CREATE TABLE IF NOT EXISTS teamup_reservations (
      booking_id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL, end_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('held','booked','review','released')),
      checkout_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS teamup_reservations_date ON teamup_reservations(date,status)',
    `CREATE TRIGGER IF NOT EXISTS teamup_claim_conflict BEFORE INSERT ON teamup_reservations
     WHEN NEW.status IN ${ACTIVE} BEGIN
       SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
         SELECT 1 FROM teamup_reservations r WHERE r.status IN ${ACTIVE} AND r.date=NEW.date
         AND r.time<NEW.end_time AND r.end_time>NEW.time AND r.booking_id<>NEW.booking_id);
       SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
         SELECT 1 FROM slots s WHERE s.status IN ('held','booked','blocked') AND ${overlap('s')}
         AND COALESCE(s.booking_id,'')<>NEW.booking_id);
       SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
         SELECT 1 FROM bookings b WHERE b.appointment_date=NEW.date AND b.appointment_time<NEW.end_time
         AND strftime('%H:%M',b.appointment_time,'+60 minutes')>NEW.time AND b.booking_id<>NEW.booking_id
         AND b.booking_status NOT IN ('cancelled','no_show','completed'));
     END`,
    ...['INSERT','UPDATE'].map(action=>`CREATE TRIGGER IF NOT EXISTS teamup_slots_${action.toLowerCase()}
      BEFORE ${action} ON slots WHEN NEW.status IN ('held','booked') BEGIN
      SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
        SELECT 1 FROM teamup_reservations r WHERE r.status IN ${ACTIVE} AND r.date=NEW.date
        AND r.time<strftime('%H:%M',NEW.time,'+60 minutes') AND r.end_time>NEW.time
        AND r.booking_id<>COALESCE(NEW.booking_id,'')); END`),
    ...['INSERT','UPDATE'].map(action=>`CREATE TRIGGER IF NOT EXISTS teamup_bookings_${action.toLowerCase()}
      BEFORE ${action} ON bookings WHEN NEW.booking_status NOT IN ('cancelled','no_show','completed','needs_review') BEGIN
      SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
        SELECT 1 FROM teamup_reservations r WHERE r.status IN ${ACTIVE} AND r.date=NEW.appointment_date
        AND r.time<strftime('%H:%M',NEW.appointment_time,'+60 minutes') AND r.end_time>NEW.appointment_time
        AND r.booking_id<>NEW.booking_id); END`),
    `CREATE TRIGGER IF NOT EXISTS teamup_cancel AFTER UPDATE OF booking_status ON bookings
     WHEN NEW.booking_status IN ('cancelled','no_show','completed') BEGIN
       UPDATE teamup_reservations SET status='released',updated_at=NEW.updated_at WHERE booking_id=NEW.booking_id;
     END`,
    `CREATE TRIGGER IF NOT EXISTS teamup_delete AFTER DELETE ON bookings BEGIN
       UPDATE teamup_reservations SET status='released' WHERE booking_id=OLD.booking_id;
     END`
  ];
  await db.batch(commands.map(sql=>db.prepare(sql)));
}

export function validateSettings(body, currentTime=Date.now()) {
  if (typeof body.enabled!=='boolean' || !Number.isSafeInteger(body.revision) || body.revision<0) throw new Error('Configurazione non valida');
  const ids = [...new Set(body.subcalendar_ids || [])].sort((a,b)=>a-b);
  if (!Array.isArray(body.subcalendar_ids) || !ids.length || ids.some(id=>!Number.isSafeInteger(id)||id<=0)) throw new Error('Seleziona tutte le agende Medici');
  if (!Array.isArray(body.windows) || body.windows.length>40 || (body.enabled&&!body.windows.length)) throw new Error('Aggiungi le fasce da aprire (massimo 40)');
  const windows = body.windows.map(w=>{
    preview([],{...w,subcalendar_ids:ids});
    if (body.enabled && (romeTime(w.date,w.end)<=currentTime || romeTime(w.date,w.start)>currentTime+60*86400000)) throw new Error('Scegli date future entro 60 giorni');
    return {date:w.date,start:w.start,end:w.end,window_confirmed:true};
  }).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
  if (new Set(windows.map(w=>w.date)).size>14) throw new Error('Pubblica al massimo 14 giornate per volta');
  for(let i=1;i<windows.length;i++) if(windows[i].date===windows[i-1].date && windows[i].start<windows[i-1].end) throw new Error('Le fasce della stessa giornata non devono sovrapporsi');
  const write_enabled=body.write_enabled===true;
  const write_calendar_id=Number(body.write_calendar_id)||null;
  if(write_enabled && (!Number.isSafeInteger(write_calendar_id)||write_calendar_id<=0)) throw new Error('Seleziona il calendario Prenotazioni sito');
  return {enabled:body.enabled,subcalendar_ids:ids,windows,write_enabled,write_calendar_id};
}
async function accessible(env,ids,fetcher) {
  const visible=await calendars(env,fetcher);
  if(ids.some(id=>!visible.some(c=>c.id===id))) throw new Error('Una delle agende Medici non è più accessibile');
}
export async function saveSettings(env,body,fetcher=fetch) {
  const config=validateSettings(body);
  if(config.enabled) await accessible(env,[...config.subcalendar_ids,...(config.write_calendar_id?[config.write_calendar_id]:[])],fetcher);
  if(config.write_enabled) await validateWriteAccess(env,config.write_calendar_id,fetcher);
  await install(env.DB);
  const active=await env.DB.prepare("SELECT calendar_id FROM teamup_owned_events WHERE state<>'deleted' LIMIT 1").first();
  if(active && active.calendar_id!==config.write_calendar_id) throw new Error('Mantieni il calendario del sito: contiene eventi ancora gestiti dal collegamento.');
  const sql=body.revision===0 ? 'INSERT OR IGNORE INTO teamup_settings(id,value,revision) VALUES(1,?,1)' :
    'UPDATE teamup_settings SET value=?,revision=revision+1 WHERE id=1 AND revision=?';
  const args=body.revision===0 ? [JSON.stringify(config)] : [JSON.stringify(config),body.revision];
  const r=await env.DB.prepare(sql).bind(...args).run();
  if(r.meta.changes!==1) throw new Error('Configurazione cambiata in un’altra finestra. Ricarica prima di salvare.');
  return {...config,revision:body.revision+1};
}

async function siteBusy(db,date,ignoreId='-none-') {
  const {results}=await db.prepare(`
    SELECT time,end_time FROM teamup_reservations WHERE date=? AND status IN ${ACTIVE} AND booking_id<>?
    UNION ALL SELECT time,strftime('%H:%M',time,'+60 minutes') FROM slots
      WHERE date=? AND status IN ('held','booked','blocked') AND COALESCE(booking_id,'')<>?
    UNION ALL SELECT appointment_time,strftime('%H:%M',appointment_time,'+60 minutes') FROM bookings
      WHERE appointment_date=? AND booking_status NOT IN ('cancelled','no_show','completed') AND booking_id<>?
  `).bind(date,ignoreId,date,ignoreId,date,ignoreId).all();
  return results || [];
}

// null means legacy mode; an empty array means automation is installed but paused/full.
export async function liveSlots(env,date=null,ignoreId='-none-',fetcher=fetch,clock=Date.now()) {
  const config=await settings(env.DB);
  if(!config) return null;
  if(!config.enabled) return [];
  if(date) romeTime(date,'12:00');
  const windows=config.windows.filter(w=>(!date||w.date===date)&&romeTime(w.date,w.end)>clock);
  if(!windows.length) return [];
  const calendarIds=[...new Set([...config.subcalendar_ids,...(config.write_calendar_id?[config.write_calendar_id]:[])])];
  await accessible(env,calendarIds,fetcher);
  const dates=[...new Set(windows.map(w=>w.date))];
  const slots=[];
  // At most 14 days; one upstream events request per day, no patient data in output/cache.
  for(const day of dates) {
    const events=await omitOwnEvent(env.DB,ignoreId,await readDay(env,day,calendarIds,fetcher));
    const busy=await siteBusy(env.DB,day,ignoreId);
    for(const w of windows.filter(w=>w.date===day)) {
      const result=preview(events,{...w,subcalendar_ids:calendarIds});
      for(const s of result.slots) if(s.status==='candidate' && romeTime(day,s.time)>clock &&
        !busy.some(b=>b.time<s.end_time && b.end_time>s.time)) slots.push({date:day,time:s.time});
    }
  }
  return slots;
}

export async function claimSlot(env,service,date,time,id) {
  if(service!==TEAMUP_SERVICE) return null;
  const config=await settings(env.DB);
  if(!config) return null;
  const slots=await liveSlots(env,date);
  if(slots===null) return null;
  if(!slots.some(s=>s.time===time)) throw new Error('Questo orario non è più disponibile. Scegline un altro.');
  const end=new Date(romeTime(date,time)+3600000).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const t=stamp();
  try {
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO teamup_reservations(booking_id,date,time,end_time,status,created_at,updated_at)
        SELECT ?,?,?,?,'held',?,? WHERE EXISTS(SELECT 1 FROM teamup_settings WHERE id=1 AND revision=?)`).bind(id,date,time,end,t,t,config.revision),
      env.DB.prepare(`INSERT INTO slots(service_id,date,time,status,booking_id,held_until,updated_at)
        SELECT ?,?,?,'held',?,'9999-12-31T23:59:59.000Z',? WHERE EXISTS(SELECT 1 FROM teamup_reservations WHERE booking_id=?)
        ON CONFLICT(service_id,date,time) DO UPDATE SET status='held',booking_id=excluded.booking_id,
          held_until=excluded.held_until,updated_at=excluded.updated_at`).bind(service,date,time,id,t,id)
    ]);
    if(result[0].meta.changes!==1) throw new Error('Disponibilità modificate. Aggiorna gli orari.');
  } catch(error) {
    if(String(error.message).includes('TEAMUP_SLOT_CONFLICT')) throw new Error('Questo orario è appena stato prenotato. Scegline un altro.');
    throw error;
  }
  return true;
}

export async function rememberCheckout(db,id,checkoutId) {
  if(!await installed(db)) return;
  await db.prepare('UPDATE teamup_reservations SET checkout_id=?,updated_at=? WHERE booking_id=?').bind(checkoutId,stamp(),id).run();
}

// Called before recording a managed payment. Rechecks the calendar and preserves money
// received even if a secretary changed Teamup or a cancelled checkout paid late.
export async function settlePayment(env,booking,amount,paymentId) {
  const r=await reservation(env.DB,booking.booking_id);
  if(!r) return undefined;
  let confirmed=false;
  if(r.status==='held') {
    try {
      const slots=await liveSlots(env,r.date,r.booking_id);
      confirmed=!!slots?.some(s=>s.time===r.time);
      if(confirmed) await syncOwnedEvent(env,booking,'confirm');
    } catch(error) { if(error.code==='TEAMUP_BUSY') throw error; confirmed=false; /* Fail closed: payment is real, appointment needs staff review. */ }
  }
  const status=confirmed?'confirmed':'needs_review';
  const balance=Math.round((booking.total_price-amount)*100)/100;
  const t=stamp();
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE bookings SET amount_paid=?,balance_due=?,payment_status='paid',booking_status=CASE WHEN ?='confirmed' AND EXISTS(SELECT 1 FROM teamup_reservations r WHERE r.booking_id=bookings.booking_id AND r.status='held') THEN 'confirmed' ELSE 'needs_review' END,
      payment_id=COALESCE(?,payment_id),updated_at=? WHERE booking_id=? AND payment_status<>'paid'`)
      .bind(amount,balance,status,paymentId||null,t,booking.booking_id),
    env.DB.prepare(`UPDATE teamup_reservations SET status=CASE WHEN status='released' THEN 'released'
      WHEN (SELECT booking_status FROM bookings WHERE booking_id=?)='confirmed' THEN 'booked' ELSE 'review' END,
      updated_at=? WHERE booking_id=?`).bind(booking.booking_id,t,booking.booking_id),
    env.DB.prepare("UPDATE slots SET status='booked',held_until=NULL,updated_at=? WHERE booking_id=?")
      .bind(t,booking.booking_id)
  ]);
  if(results[0].meta.changes!==1) return null;
  return env.DB.prepare('SELECT * FROM bookings WHERE booking_id=?').bind(booking.booking_id).first();
}
