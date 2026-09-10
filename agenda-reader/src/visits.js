export function findVisitsCalendar(calendars){
 const found=calendars.filter(c=>String(c.name).split('>').at(-1).trim().replace(/\s+/g,' ').toLocaleLowerCase('it-IT')==='prime visite');
 if(found.length!==1)throw Error(found.length?'Più calendari si chiamano Prime Visite: occorre distinguerli.':'Il collegamento Teamup non mostra il calendario Prime Visite. Abilita la lettura di quel calendario nel collegamento usato dal Worker.');
 return found[0].id;
}
export function readVisits(events,date,calendarId){
 if(!Array.isArray(events))throw Error('Elenco Prime Visite incompleto');
 const out=[],seen=new Set();
 for(const e of events){
  if(e?.delete_dt)continue;
  if(!e?.id||!Array.isArray(e.subcalendar_ids))throw Error('Evento Prime Visite incompleto');
  if(!e.subcalendar_ids.includes(calendarId))continue;
  let day;
  if(e.all_day)day=String(e.start_dt).slice(0,10);
  else {if(typeof e.start_dt!=='number'&&!(typeof e.start_dt==='string'&&/(Z|[+-]\d{2}:?\d{2})$/.test(e.start_dt)))throw Error('Orario Prime Visite non valido');const t=new Date(typeof e.start_dt==='number'?e.start_dt*1000:e.start_dt);if(!Number.isFinite(t.getTime()))throw Error('Orario Prime Visite non valido');day=t.toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'});}
  if(day!==date)continue;
  const key=String(e.id)+'|'+String(e.start_dt);if(seen.has(key))continue;seen.add(key);
  out.push({event_id:String(e.id),start_dt:typeof e.start_dt==='number'?new Date(e.start_dt*1000).toISOString():e.start_dt,all_day:!!e.all_day,appointment:String(e.title||'Senza titolo').replace(/<[^>]*>/g,' ').trim()});
 }
 return out.sort((a,b)=>String(a.start_dt).localeCompare(String(b.start_dt)));
}
export function visitsTotal(reports){
 const seen=new Set();let missing=0;
 for(const r of reports){if(r.stale||r.visits_error||!Array.isArray(r.visits)){missing++;continue;}for(const v of r.visits)seen.add(v.event_id+'|'+v.start_dt);}
 return {count:seen.size,missing};
}
