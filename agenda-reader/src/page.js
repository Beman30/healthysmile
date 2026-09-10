export const PAGE=String.raw`<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lettore agenda Healthy Smile</title>
<style>body{font:16px system-ui;max-width:1100px;margin:30px auto;padding:0 20px;color:#20252b;background:#f5f7fa}fieldset,article{background:white;border:1px solid #ccc;border-radius:8px;padding:18px;margin:16px 0}button{padding:12px;margin:8px 8px 8px 0;cursor:pointer}label{display:block;margin:10px 0}select,input{padding:8px;max-width:100%}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}#message{font-weight:bold;white-space:pre-wrap}.warn{color:#9a3412}summary{cursor:pointer;padding:8px}.scroll{overflow:auto}</style>
<h1>Lettore agenda · v3</h1><p>Apertura, pause e poltrone libere nelle agende selezionate. Solo lettura.</p>

<label>Token amministratore <input id="token" type="password" autocomplete="off"></label><button id="connect">Connetti</button><p id="message" role="status"></p>
<fieldset id="config" hidden><legend>Agende</legend><p>Apertura e pause vengono lette dall’agenda Palmia. Le agende Medici selezionate servono a leggere gli appuntamenti e la capienza.</p><div id="choices"></div>
<label>Dott. Palmia: apertura e pause <select id="palmia"></select></label><label>Prenotazioni sito (facoltativo) <select id="site"></select></label>
<button id="save">Salva configurazione lettore</button></fieldset>
<section id="actions" hidden><label>Giornata <input id="date" type="date"></label><button id="day">Leggi questa giornata adesso</button><button id="all">Leggi prossimi 14 giorni</button><button id="reload">Mostra ultima lettura</button><p id="last"></p></section><div id="reports"></div>
<script>
const $=id=>document.getElementById(id);let token='',busy=false;
async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Errore '+r.status);return d;}
async function run(fn){if(busy)return;busy=true;$('message').textContent='Lettura in corso…';try{await fn();}catch(e){$('message').textContent=e.message;}finally{busy=false;}}
function text(tag,value,parent){const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;}
const hour=v=>new Date(v).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'});
function render(d){
 $('reports').replaceChildren();
 if(!d.reports.length)text('p','Premi Leggi questa giornata adesso.',$('reports'));
 for(const r of d.reports){
  const a=document.createElement('article');$('reports').append(a);
  text('h2',new Date(r.date+'T12:00:00Z').toLocaleDateString('it-IT',{timeZone:'Europe/Rome',weekday:'long',day:'numeric',month:'long',year:'numeric'}),a);
  if(r.error||r.issues?.length){text('p','Orari da verificare: '+(r.error||r.issues.map(i=>i.reason).join('; ')),a);continue;}
  const windows=r.windows||[];
  if(!windows.length){text('p','Nessun orario di apertura riconosciuto.',a);continue;}
  text('p','Apertura '+hour(windows[0].start_dt)+' · Chiusura '+hour(windows.at(-1).end_dt),a);
  const pauses=windows.slice(1).map((w,i)=>hour(windows[i].end_dt)+'–'+hour(w.start_dt));
  if(pauses.length)text('p','Pausa '+pauses.join(', '),a);
  if(r.stale){text('p','Lettura da aggiornare: premi Leggi questa giornata adesso.',a);continue;}
  if(!Array.isArray(r.free_intervals)){text('p','Premi Leggi questa giornata adesso per aggiornare il risultato.',a);continue;}
  if(!r.free_intervals.length){text('p','Nessuna poltrona libera durante l’apertura.',a);continue;}
  const table=document.createElement('table');a.append(table);
  const head=document.createElement('tr');table.append(head);text('th','Orario',head);text('th','Poltrone libere',head);
  for(const f of r.free_intervals){const tr=document.createElement('tr');table.append(tr);text('td',hour(f.start_dt)+'–'+hour(f.end_dt),tr);text('td',f.free_chairs===2?'2 libere':'1 libera',tr);}
 }
}
$('connect').onclick=()=>run(async()=>{token=$('token').value;const d=await api('config');$('choices').replaceChildren();$('palmia').replaceChildren(new Option('Seleziona',''));$('site').replaceChildren(new Option('Nessuno',''));for(const c of d.calendars){const row=document.createElement('div');$('choices').append(row);const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.medical=c.id;check.checked=d.config?d.config.medical_ids.includes(c.id):/^Medici\b/i.test(c.name);label.append(check,document.createTextNode(c.name+' ['+c.id+']'));row.append(label);$('palmia').add(new Option(c.name,c.id));$('site').add(new Option(c.name,c.id));}
const palmias=d.calendars.filter(c=>/\bPalmia\b/i.test(c.name));$('palmia').value=d.config?.palmia_id||(palmias.length===1?palmias[0].id:'');$('site').value=d.config?.site_id||'';$('config').hidden=false;$('actions').hidden=false;$('date').value=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'});$('message').textContent='Connesso. Configura le agende e avvia una lettura.';});
$('save').onclick=()=>run(async()=>{await api('config',{medical_ids:[...document.querySelectorAll('[data-medical]:checked')].map(x=>+x.dataset.medical),palmia_id:+$('palmia').value,site_id:+$('site').value||null});$('message').textContent='Configurazione del lettore salvata. Nessuna modifica al sito.';});
$('day').onclick=()=>run(async()=>{if(!$('date').value)throw Error('Scegli la giornata');render(await api('scan',{date:$('date').value}));$('message').textContent='Lettura completata. Controlla interpretazione e motivi qui sotto.';});
$('all').onclick=()=>run(async()=>{render(await api('scan',{}));$('message').textContent='Lettura completata.';});
$('reload').onclick=()=>run(async()=>{render(await api('reports'));$('message').textContent='Risultati caricati.';});
</script></html>`;
