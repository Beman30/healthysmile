// Read-only Teamup preview. Never used by checkout until booking coordination exists.
const ZONE = 'Europe/Rome';
const MINUTE = 60000;
const formatter = new Intl.DateTimeFormat('sv-SE', {timeZone: ZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
function localParts(ms) {
  const p = Object.fromEntries(formatter.formatToParts(ms).map(p => [p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function romeTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || '')) throw new Error('Data o orario non validi');
  const wanted = `${date}T${time}`;
  const utc = Date.parse(wanted + ':00Z');
  const matches = [utc-60*MINUTE, utc-120*MINUTE].filter(t => Number.isFinite(t) && localParts(t) === wanted);
  if (matches.length !== 1) throw new Error('Data o orario inesistente o ambiguo');
  return matches[0];
}
function timestamp(value) {
  const t = typeof value === 'number' ? value*1000 : typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) throw new Error('Teamup ha restituito un orario non valido');
  return t;
}
export function preview(events, input) {
  const start = romeTime(input.date,input.start), end = romeTime(input.date,input.end);
  if (end-start < 60*MINUTE) throw new Error('La finestra deve durare almeno un’ora');
  const ids = input.subcalendar_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(x => !Number.isSafeInteger(x) || x <= 0)) throw new Error('Seleziona le agende Medici');
  if (input.window_confirmed !== true) throw new Error('Conferma apertura e presenza degli operatori nella finestra scelta');
  if (!Array.isArray(events)) throw new Error('Risposta Teamup incompleta');
  const unique = new Map();
  let review = false;
  for (const e of events) {
    if (!e || !Array.isArray(e.subcalendar_ids)) throw new Error('Evento Teamup incompleto');
    if (!e.subcalendar_ids.some(id => ids.includes(id)) || e.delete_dt) continue;
    if (!e.id) throw new Error('Evento Teamup senza identificativo');
    // All-day entries carry organizational information with different date semantics.
    if (e.all_day) { review = true; continue; }
    const a = timestamp(e.start_dt), b = timestamp(e.end_dt);
    if (b <= a) throw new Error('Durata evento Teamup non valida');
    const text = `${e.title || ''} ${e.notes || e.note || ''}`.replace(/<[^>]*>/g,' ');
    const block = /\b(?:pausa|stop)\b/i.test(text);
    if (/\b(?:apertura|chiusura|apriamo|chiudiamo|apre|chiude|aprire|chiudere)\b/i.test(text)) review = true;
    const item = {a,b,block};
    const prev = unique.get(String(e.id));
    if (prev && JSON.stringify(prev) !== JSON.stringify(item)) throw new Error('Evento duplicato con dati discordanti');
    unique.set(String(e.id),item);
  }
  const intervals = [...unique.values()];
  const slots = [];
  for (let t=start;t+60*MINUTE<=end;t+=15*MINUTE) {
    const finish = t+60*MINUTE;
    const relevant = intervals.filter(e => e.a<finish && e.b>t);
    const points = [...new Set([t,...relevant.flatMap(e => [Math.max(t,e.a),Math.min(finish,e.b)])])].filter(p => p<finish);
    const peak = Math.max(0,...points.map(p => relevant.filter(e => !e.block && e.a<=p && e.b>p).length));
    const blocked = relevant.some(e => e.block);
    slots.push({time:localParts(t).slice(11), end_time:localParts(finish).slice(11), existing_chairs_peak:peak,
      status:review ? 'review' : blocked ? 'blocked' : peak>=2 ? 'full' : 'candidate'});
  }
  return {date:input.date,time_zone:ZONE,duration_minutes:60,mode:'preview_only',slots,
    warnings: review ? ['Note organizzative o eventi giornalieri: verificare gli orari in Teamup. Nessuno slot approvato.'] : [],
    notice:'Solo capienza Teamup nelle agende selezionate. Verificare note, personale e prenotazioni del sito. Gli orari proposti sono alternativi, non prenotazioni confermate.'};
}
async function read(env, resource, params, fetcher) {
  if (!env.TEAMUP_API_KEY || !/^ks[a-zA-Z0-9]+$/.test(env.TEAMUP_CALENDAR_KEY || '')) throw new Error('Configurare i secret TEAMUP_API_KEY e TEAMUP_CALENDAR_KEY nel Worker');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(),10000);
  try {
    const response = await fetcher(`https://api.teamup.com/${env.TEAMUP_CALENDAR_KEY}/${resource}?${params}`, {headers:{'Teamup-Token':env.TEAMUP_API_KEY,Accept:'application/json'},signal:controller.signal,redirect:'error'});
    if (!response.ok) throw new Error('upstream');
    return await response.json();
  } catch { throw new Error('Lettura Teamup non riuscita. Verificare chiave API, accesso al calendario e disponibilità del servizio.'); }
  finally { clearTimeout(timer); }
}
export async function calendars(env, fetcher=fetch) {
  const result = [];
  for (let offset=0;offset<1000;offset+=100) {
    const data = await read(env,'subcalendars',new URLSearchParams({offset:String(offset),limit:'100',includeInactive:'false'}),fetcher);
    if (!Array.isArray(data.subcalendars)) throw new Error('Elenco agende Teamup incompleto');
    for (const c of data.subcalendars) {
      if (!Number.isSafeInteger(c.id)) throw new Error('Identificativo agenda non valido');
      result.push({id:c.id,name:String(c.name || ''),active:c.active!==false});
    }
    if (data.subcalendars.length<100) return result.filter(c=>c.active);
  }
  throw new Error('Troppe agende: restringere il collegamento ai calendari Medici');
}
export async function teamupPreview(env,input,fetcher=fetch) {
  preview([],input); // Validate input before contacting upstream.
  const available = await calendars(env,fetcher);
  if (input.subcalendar_ids.some(id => !available.some(c=>c.id===id))) throw new Error('Una delle agende selezionate non è accessibile');
  const params = new URLSearchParams({startDate:input.date,endDate:input.date,tz:ZONE,format:'markdown'});
  input.subcalendar_ids.forEach(id=>params.append('subcalendarId[]',String(id)));
  const data = await read(env,'events',params,fetcher);
  return preview(data.events,input);
}
