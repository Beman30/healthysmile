import {readPayments} from './payments.js';
import {romeTime, rollingDates} from '../../backend/src/teamup.js';
export {rollingDates};
const MIN=60000;
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').trim();
const bare=s=>clean(s).replace(/^[^/\r\n]{1,40}\/\s*/, '').replace(/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .]{0,39}\s*[-–—]\s*(?=\d|PALMIA\b|STOP\b|PAUSA\b)/i,'').trim();
const clock=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const hit=(e,a,b)=>e.a<b&&e.b>a;
function parseTime(s) {
 const m=/^(\d{1,2})(?:[.:](\d{2}))?$/.exec(s);
 if(!m||+m[1]>23||+(m[2]||0)>59)throw Error('Orario non valido');
 return +m[1]*60+ +(m[2]||0);
}
export function openingText(text) {
 const m=/^(?:(?:DOTT\.?\s*)?PALMIA\s+)?(\d{1,2}(?:[.:]\d{2})?)\s*[-–—]\s*(\d{1,2}(?:[.:]\d{2})?)\s*$/i.exec(bare(text));
 if(!m)return null;
 const a=parseTime(m[1]),b=parseTime(m[2]);
 if(b<=a)throw Error('Apertura e chiusura discordanti');
 return {start:clock(a),end:clock(b)};
}
function merge(items) {
 const out=[];
 for(const e of [...items].sort((x,y)=>x.a-y.a)) {
  const last=out.at(-1);
  if(last&&e.a<=last.b)last.b=Math.max(last.b,e.b);else out.push({a:e.a,b:e.b});
 }
 return out;
}
function peak(items,a,b) {
 const relevant=items.filter(e=>hit(e,a,b));
 return Math.max(0,...[a,...relevant.map(e=>Math.max(a,e.a))].map(t=>relevant.filter(e=>e.a<=t&&e.b>t).length));
}
export function validateConfig(c) {
 const ids=c.medical_ids;
 if(!Array.isArray(ids)||!ids.length||ids.length>30||ids.some(x=>!Number.isSafeInteger(x)||x<=0))throw Error('Seleziona le agende Medici');
 if(!ids.includes(c.palmia_id))throw Error('Seleziona Dott. Palmia tra le agende Medici');
 const site=c.site_id||null;
 if(site&&(!Number.isSafeInteger(site)||site<=0||ids.includes(site)))throw Error('Il calendario del sito deve essere distinto dalle agende Medici');
 return {medical_ids:[...new Set(ids)],palmia_id:c.palmia_id,site_id:site};
}
export function interpretDay(raw,date,input,now=Date.now()) {
 const c=validateConfig(input),start=romeTime(date,'00:00');
 const next=new Date(Date.parse(date+'T12:00Z')+86400000).toISOString().slice(0,10),end=romeTime(next,'00:00');
 if(!Array.isArray(raw))throw Error('Elenco eventi incompleto');
 const allowed=[...c.medical_ids,...c.site_id?[c.site_id]:[]];
 const seen=new Map(),records=[],issues=[],openings=[],blocks=[],patients=[],staffBlocks=[],site=[];
 const issue=(id,reason)=>issues.push({event_id:id,reason});
 for(const e of raw) {
  if(e?.delete_dt)continue;
  if(!e||!e.id||!Array.isArray(e.subcalendar_ids))throw Error('Evento Teamup incompleto');
  if(!e.subcalendar_ids.some(x=>allowed.includes(x)))continue;
  const id=String(e.id),signature=JSON.stringify([e.start_dt,e.end_dt,e.title,e.notes,e.all_day,[...e.subcalendar_ids].sort()]);
  if(seen.has(id)){if(seen.get(id)!==signature)throw Error('Evento duplicato discordante: '+id);continue;}seen.set(id,signature);
  const parse=v=>typeof v==='number'?v*1000:Date.parse(v);
  let a,b;
  if(e.all_day) {
   const from=String(e.start_dt).slice(0,10),to=String(e.end_dt).slice(0,10);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw Error('Data evento giornaliero non valida');
   if(date<from||date>to)continue;
   a=start;b=end;
  } else {
   if([e.start_dt,e.end_dt].some(v=>typeof v!=='number'&&!(typeof v==='string'&&/(Z|[+-]\d{2}:?\d{2})$/.test(v))))throw Error('Fuso orario evento mancante');
   a=parse(e.start_dt);b=parse(e.end_dt);
   if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)throw Error('Durata evento non valida');
   if(a>=end||b<=start)continue;
  }
  const title=clean(e.title),notes=clean(e.notes||e.note);
  const r={event_id:id,title,notes,calendar_ids:e.subcalendar_ids,start_dt:e.start_dt,end_dt:e.end_dt,kind:'appointment',reason:'Evento clinico: occupa una poltrona'};
  records.push(r);
  let hours=null;
  if(e.subcalendar_ids.includes(c.palmia_id)) {
   try {hours=openingText(title)||openingText(notes);}catch(err){r.kind='ambiguous';r.reason=err.message;issue(id,r.reason);continue;}
  }
  if(hours){r.kind='opening';r.reason=`Apertura ${hours.start}–${hours.end}`;openings.push({a:romeTime(date,hours.start),b:romeTime(date,hours.end),event_id:id});continue;}
  if(/^(?:STOP|PAUSA)\b/i.test(bare(title))) {
   r.kind='pause';r.reason=e.subcalendar_ids.includes(c.palmia_id)?'Intervallo escluso dall’apertura Palmia':'Indisponibilità operatore, non paziente';
   const block={a,b,ids:e.subcalendar_ids,event_id:id};staffBlocks.push(block);
   if(e.subcalendar_ids.includes(c.palmia_id))blocks.push(block);
   continue;
  }
  if(e.all_day||/^(?:PALMIA|DOTT\.?\s+PALMIA|APERTURA|CHIUSURA|APRIAMO|CHIUDIAMO|ASSENTE|FERIE)\b/i.test(bare(title))) {
   r.kind='ambiguous';r.reason='Avviso organizzativo non interpretato: verifica necessaria';issue(id,r.reason);continue;
  }
  const p={a,b,ids:e.subcalendar_ids,event_id:id};patients.push(p);
  if(c.site_id&&e.subcalendar_ids.includes(c.site_id))site.push(p);
 }
 let windows=[],source='none';
 if(openings.length) {
  source='explicit';
  if(openings.some(o=>o.a!==openings[0].a||o.b!==openings[0].b))issue(null,'Più avvisi di apertura discordanti');
  else windows=[{a:openings[0].a,b:openings[0].b}];
 } else {
  source='between_blocks';const m=merge(blocks);
  for(let i=1;i<m.length;i++)if(m[i].a>m[i-1].b)windows.push({a:m[i-1].b,b:m[i].a});
 }
 if(!windows.length)issue(null,'Apertura non ricavabile dai dati letti');
 for(const block of merge(blocks))windows=windows.flatMap(w=>!hit(block,w.a,w.b)?[w]:[{a:w.a,b:Math.min(w.b,block.a)},{a:Math.max(w.a,block.b),b:w.b}].filter(x=>x.b>x.a));
 const capacity=[];
 for(const w of windows) {
  const points=[...new Set([w.a,w.b,...patients.filter(e=>hit(e,w.a,w.b)).flatMap(e=>[Math.max(w.a,e.a),Math.min(w.b,e.b)])])].sort((a,b)=>a-b);
  for(let i=1;i<points.length;i++) {
   const a=points[i-1],b=points[i],free=Math.max(0,2-patients.filter(e=>hit(e,a,b)).length);
   const previous=capacity.at(-1);
   if(previous&&previous.b===a&&previous.free===free)previous.b=b;
   else capacity.push({a,b,free});
  }
 }
 const free_intervals=issues.length?[]:capacity.filter(e=>e.free>0).map(e=>({start_dt:new Date(e.a).toISOString(),end_dt:new Date(e.b).toISOString(),free_chairs:e.free}));
 const slots=[];
 for(let minute=0;minute<1440;minute+=15) {
  let a;try{a=romeTime(date,clock(minute));}catch{continue;}
  const b=a+60*MIN,why=[];
  if(a<=now)why.push('Orario passato');
  if(!windows.some(w=>a>=w.a&&b<=w.b))why.push('Fuori apertura o meno di 60 minuti prima di pausa/chiusura');
  if(issues.length)why.push('Interpretazione da verificare');
  const chairs=peak(patients,a,b);
  if(chairs>=2)why.push('Due poltrone occupate durante l’ora');
  if(site.some(e=>hit(e,a,b)))why.push('Prenotazione sito sovrapposta');
  slots.push({time:clock(minute),status:why.length?'excluded':'candidate',chairs_peak:chairs,reasons:why,event_ids:patients.filter(e=>hit(e,a,b)).map(e=>e.event_id)});
 }
 return {date,payments:readPayments(raw,records),free_intervals,opening_source:source,windows:windows.map(w=>({start_dt:new Date(w.a).toISOString(),end_dt:new Date(w.b).toISOString()})),issues,events:records,slots,candidate_count:slots.filter(s=>s.status==='candidate').length,mode:'read_only_review',note:'Lettura di apertura, pause e capienza delle agende selezionate. Nessuna verifica del personale o dei pagamenti. Nessuno slot pubblicato.'};
}
