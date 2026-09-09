// Read-only Teamup access. Booking coordination lives in availability.js.
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
function palmiaHours(e, date, palmiaId) {
  if (!palmiaId || !e.subcalendar_ids?.includes(palmiaId)) return null;
  const title=String(e.title||'').trim();
  const m=/^PALMIA\s+(\d{1,2})(?:[:.](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?$/i.exec(title);
  if (!m) return null;
  const a=romeTime(date,`${m[1].padStart(2,'0')}:${m[2]||'00'}`);
  const b=romeTime(date,`${m[3].padStart(2,'0')}:${m[4]||'00'}`);
  if(b<=a) throw new Error('Orario PALMIA non valido: verificare apertura e chiusura');
  return {a,b};
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
    if (palmiaHours(e,input.date,input.palmia_calendar_id)) continue;
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
class TeamupReadError extends Error {}
async function read(env, resource, params, fetcher) {
  const apiKey = String(env.TEAMUP_API_KEY || '').trim();
  const calendarKey = String(env.TEAMUP_CALENDAR_KEY || '').trim();
  if (!apiKey || !/^ks[a-zA-Z0-9]+$/.test(calendarKey)) throw new Error('Configurare i secret TEAMUP_API_KEY e TEAMUP_CALENDAR_KEY nel Worker');
  if (/\s/.test(apiKey)) throw new Error('TEAMUP_API_KEY contiene spazi o ritorni a capo interni. Ricopiare la chiave API.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(),10000);
  try {
    const response = await fetcher(`https://api.teamup.com/${calendarKey}/${resource}?${params}`, {headers:{'Teamup-Token':apiKey,Accept:'application/json'},signal:controller.signal,redirect:'manual'});
    if (response.status >= 300 && response.status < 400) throw new TeamupReadError(`Teamup HTTP ${response.status} (${resource}): reindirizzamento bloccato. Nessuna credenziale inoltrata.`);
    if (!response.ok) {
      const hints = {
        400: 'Richiesta rifiutata da Teamup: verificare i parametri dell’integrazione.',
        401: 'Autenticazione rifiutata da Teamup: verificare chiave API e accesso al calendario.',
        403: 'Accesso negato da Teamup: verificare permessi del collegamento e abilitazione della chiave API.',
        404: 'Risorsa non trovata o non accessibile: verificare il collegamento del calendario.',
        429: 'Limite di richieste Teamup raggiunto. Riprovare più tardi.'
      };
      // Return machine error codes only; never upstream messages, titles or account data.
      let detail = 'dettaglio non disponibile';
      try {
        const raw = await response.text();
        if (raw.length <= 65536) {
          try {
            const body = JSON.parse(raw);
            const known = {
              invalid_api_key: 'invalid_api_key: chiave API non riconosciuta',
              account_no_permission: 'account_no_permission: accesso al calendario negato',
              login_required: 'login_required: questo accesso richiede autenticazione Teamup',
              password_required: 'password_required: collegamento protetto da password',
              calendar_not_found: 'calendar_not_found: calendario non trovato',
              key_not_found: 'key_not_found: collegamento non trovato'
            };
            const candidates = [body?.error?.id, body?.error?.code, body?.code, body?.id, body?.errors?.[0]?.code, body?.error];
            const id = candidates.find(value => {
              const code = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
              return typeof code === 'string' && /^(?:[a-z][a-z0-9_-]{0,95}|[0-9]{1,8})$/.test(code) &&
                ![apiKey, calendarKey].some(secret => code.includes(secret) || secret.includes(code));
            });
            detail = id !== undefined ? (Object.hasOwn(known, id) ? known[id] : `codice API: ${id}`) :
              'JSON senza codice identificativo utilizzabile; verificare la risposta con il supporto Teamup';
          } catch {
            detail = /<html|<!doctype html/i.test(raw) ? 'risposta HTML, non errore JSON dell’API' : 'risposta non JSON';
          }
        }
      } catch { /* Preserve the HTTP status even when the error body cannot be read. */ }
      throw new TeamupReadError(`Teamup HTTP ${response.status} (${resource}; ${detail}). ${hints[response.status] || (response.status >= 500 ? 'Errore del servizio Teamup. Riprovare più tardi.' : 'Risposta inattesa da Teamup.')}`);
    }
    try { return await response.json(); }
    catch {
      if (controller.signal.aborted) throw new TeamupReadError(`Teamup timeout (${resource}): nessuna risposta completa entro 10 secondi.`);
      throw new TeamupReadError(`Teamup formato risposta non valido (${resource}): atteso JSON.`);
    }
  } catch (error) {
    if (error instanceof TeamupReadError) throw error;
    if (controller.signal.aborted) throw new TeamupReadError(`Teamup timeout (${resource}): nessuna risposta completa entro 10 secondi.`);
    throw new TeamupReadError(`Teamup connessione non riuscita (${resource}): errore di rete o reindirizzamento inatteso.`);
  } finally { clearTimeout(timer); }
}
export async function calendars(env, fetcher=fetch) {
  // The documented configuration response lists calendars visible to this same key.
  // Do not request inactive calendars or use an administrator credential.
  const data = await read(env,'configuration',new URLSearchParams(),fetcher);
  const items = data?.configuration?.subcalendars;
  if (!Array.isArray(items)) throw new Error('Elenco agende Teamup incompleto nella configurazione');
  const result = [];
  for (const c of items) {
    if (!c || !Number.isSafeInteger(c.id)) throw new Error('Identificativo agenda non valido');
    if (c.active !== false) result.push({id:c.id,name:String(c.name || ''),active:true});
  }
  return result;
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

export async function readDay(env,date,ids,fetcher=fetch) {
  romeTime(date,'12:00');
  const params = new URLSearchParams({startDate:date,endDate:date,tz:ZONE,format:'markdown'});
  ids.forEach(id=>params.append('subcalendarId[]',String(id)));
  const data = await read(env,'events',params,fetcher);
  if (!Array.isArray(data.events)) throw new Error('Risposta Teamup incompleta');
  return data.events;
}

// Opening is inferred only between explicit Palmia STOP/PAUSA blocks.
// Never infer opening from appointments or from an empty calendar.
export function automaticWindows(events,date,palmiaId) {
  const dayStart=romeTime(date,'00:00');
  const nextDate=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  const dayEnd=romeTime(nextDate,'00:00');
  const blocks=[];
  const openings=[];
  for(const e of events) {
    if(e.delete_dt || !e.subcalendar_ids?.includes(palmiaId)) continue;
    const hours=palmiaHours(e,date,palmiaId);
    if(hours) { openings.push(hours); continue; }
    if(e.all_day) return [];
    const a=timestamp(e.start_dt),b=timestamp(e.end_dt);
    if(b<=a) throw new Error('Durata evento Teamup non valida');
    if(a>=dayEnd || b<=dayStart) continue;
    const title=String(e.title||'').replace(/<[^>]*>/g,' ');
    if(/\b(?:STOP|PAUSA)\b/i.test(title)) blocks.push({a:Math.max(a,dayStart),b:Math.min(b,dayEnd)});
  }
  blocks.sort((a,b)=>a.a-b.a);
  const merged=[];
  for(const block of blocks) {
    const last=merged.at(-1);
    if(last && block.a<=last.b) last.b=Math.max(last.b,block.b);
    else merged.push({...block});
  }
  const windows=[];
  if(openings.length) {
    if(openings.some(w=>w.a!==openings[0].a || w.b!==openings[0].b)) throw new Error('Orari PALMIA discordanti: verificare la giornata');
    let cursor=openings[0].a;
    const closing=openings[0].b;
    const append=(a,b)=>{
      a=Math.ceil(a/(15*MINUTE))*15*MINUTE;
      if(b-a>=60*MINUTE) windows.push({date,start:localParts(a).slice(11),end:localParts(b).slice(11),window_confirmed:true});
    };
    for(const block of merged) {
      if(block.b<=cursor || block.a>=closing) continue;
      append(cursor,Math.min(block.a,closing));
      cursor=Math.max(cursor,block.b);
    }
    append(cursor,closing);
    return windows;
  }
  for(let i=1;i<merged.length;i++) {
    // Round candidate starts up to the next quarter hour, keeping the real closing boundary.
    const a=Math.ceil(merged[i-1].b/(15*MINUTE))*15*MINUTE,b=merged[i].a;
    if(b-a>=60*MINUTE) windows.push({date,start:localParts(a).slice(11),end:localParts(b).slice(11),window_confirmed:true});
  }
  return windows;
}
export function rollingDates(clock=Date.now(),count=14) {
  const today=localParts(clock).slice(0,10);
  const base=Date.parse(today+'T12:00:00Z');
  return Array.from({length:count},(_,i)=>new Date(base+i*86400000).toISOString().slice(0,10));
}

export async function teamupAutomaticPreview(env,input,fetcher=fetch) {
  const ids=input.subcalendar_ids;
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||!ids.includes(input.palmia_calendar_id)) throw new Error('Seleziona tutte le agende Medici e Palmia');
  if(input.staff_follows_palmia!==true) throw new Error('Conferma che l’igienista segue gli orari Palmia');
  romeTime(input.date,'12:00');
  const visible=await calendars(env,fetcher);
  if(ids.some(id=>!visible.some(c=>c.id===id))) throw new Error('Agenda non accessibile');
  const events=await readDay(env,input.date,ids,fetcher);
  const windows=automaticWindows(events,input.date,input.palmia_calendar_id);
  const results=windows.map(w=>preview(events,{...w,subcalendar_ids:ids,palmia_calendar_id:input.palmia_calendar_id}));
  return {date:input.date,windows,slots:results.flatMap(r=>r.slots),warnings:[...new Set(results.flatMap(r=>r.warnings))],
    notice:windows.length?'Verifica della capienza Teamup. Le prenotazioni e i pagamenti in corso sul sito vengono controllati anche prima di vendere lo slot.':'Nessuna apertura ricavabile: servono blocchi STOP/PAUSA prima dell’apertura e dalla chiusura, con almeno un’ora libera tra i blocchi. Eventi giornalieri richiedono verifica.'};
}
