import {calendars,readDay} from '../../backend/src/teamup.js';
import {interpretDay,validateConfig,rollingDates} from './engine.js';
import {PAGE} from './page.js';
const VERSION='agenda-reader-3';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function authorized(req,env) {
 const a=req.headers.get('Authorization')||'',b='Bearer '+(env.ADMIN_TOKEN||'');
 if(!env.ADMIN_TOKEN||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
async function setup(env) {
 if(!env.DB)throw Error('Collega il database D1 con nome DB per configurazione e risultati');
 await env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS agenda_reader_config(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, revision TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS agenda_reader_reports(date TEXT PRIMARY KEY, value TEXT NOT NULL, checked_at TEXT NOT NULL, revision TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS agenda_reader_run(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, until_ms INTEGER NOT NULL DEFAULT 0, attempted_at TEXT, finished_at TEXT, error TEXT)')
 ]);
}
async function config(env){return env.DB.prepare('SELECT * FROM agenda_reader_config WHERE id=1').first();}
async function scan(env,date=null) {
 await setup(env);const row=await config(env);if(!row)throw Error('Salva prima la configurazione del lettore');
 const c=validateConfig(JSON.parse(row.value)),owner=crypto.randomUUID(),ts=new Date().toISOString();
 const lock=await env.DB.prepare(`INSERT INTO agenda_reader_run(id,owner,until_ms,attempted_at,error) VALUES(1,?,?,?,NULL)
 ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms,attempted_at=excluded.attempted_at,error=NULL WHERE agenda_reader_run.until_ms<?`).bind(owner,Date.now()+240000,ts,Date.now()).run();
 if(lock.meta.changes!==1)throw Error('Lettura già in corso: attendi e carica i risultati');
 try {
  const days=date?[date]:rollingDates();
  if(date&&!rollingDates().includes(date))throw Error('Scegli una data nei prossimi 14 giorni');
  const ids=[...c.medical_ids,...c.site_id?[c.site_id]:[]],visible=await calendars(env);
  if(ids.some(id=>!visible.some(v=>v.id===id)))throw Error('Una delle agende configurate non è accessibile');
  const reports=[];
  for(const day of days) {
   let report;
   try { report=interpretDay(await readDay(env,day,ids),day,c); }
   catch(error){report={date:day,error:error.message,slots:[],events:[],issues:[],candidate_count:0,mode:'read_only_review'};}
   const checked_at=new Date().toISOString();
   reports.push({...report,checked_at});
   await env.DB.prepare(`INSERT INTO agenda_reader_reports(date,value,checked_at,revision)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM agenda_reader_config WHERE id=1 AND revision=?)
    AND EXISTS(SELECT 1 FROM agenda_reader_run WHERE id=1 AND owner=?)
    ON CONFLICT(date) DO UPDATE SET value=excluded.value,checked_at=excluded.checked_at,revision=excluded.revision`)
    .bind(day,JSON.stringify(report),checked_at,row.revision,row.revision,owner).run();
  }
  await env.DB.prepare("DELETE FROM agenda_reader_reports WHERE date<?").bind(rollingDates()[0]).run();
  return {version:VERSION,reports};
 }catch(error){await env.DB.prepare('UPDATE agenda_reader_run SET error=? WHERE id=1 AND owner=?').bind(error.message,owner).run();throw error;}
 finally {await env.DB.prepare('UPDATE agenda_reader_run SET until_ms=0,finished_at=? WHERE id=1 AND owner=?').bind(new Date().toISOString(),owner).run();}
}
export default {
 async fetch(req,env) {
  const u=new URL(req.url);
  if(req.method==='GET'&&u.pathname==='/')return new Response(PAGE,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}});
  if(req.method==='GET'&&u.pathname==='/api/health')return json({version:VERSION,mode:'read_only',database_configured:!!env.DB});
  if(!authorized(req,env))return json({error:'Non autorizzato'},401);
  try {
   await setup(env);
   if(req.method==='GET'&&u.pathname==='/api/config') {
    const saved=await config(env);return json({config:saved?JSON.parse(saved.value):null,calendars:await calendars(env),version:VERSION});
   }
   if(req.method==='POST'&&u.pathname==='/api/config') {
    const c=validateConfig(await req.json()),visible=await calendars(env);
    if([...c.medical_ids,...c.site_id?[c.site_id]:[]].some(id=>!visible.some(v=>v.id===id)))throw Error('Agenda non accessibile');
    await env.DB.prepare('INSERT INTO agenda_reader_config(id,value,revision) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision').bind(JSON.stringify(c),crypto.randomUUID()).run();
    return json({saved:true});
   }
   if(req.method==='POST'&&u.pathname==='/api/scan')return json(await scan(env,(await req.json()).date||null));
   if(req.method==='GET'&&u.pathname==='/api/reports') {
    const c=await config(env);const {results}=await env.DB.prepare('SELECT * FROM agenda_reader_reports ORDER BY date').all();
    const run=await env.DB.prepare('SELECT attempted_at,finished_at,error,until_ms FROM agenda_reader_run WHERE id=1').first();
    return json({version:VERSION,run,reports:results.map(r=>({...JSON.parse(r.value),checked_at:r.checked_at,stale:!!run?.error||r.revision!==c?.revision||Date.now()-Date.parse(r.checked_at)>10*60000}))});
   }
   return json({error:'Endpoint non trovato'},404);
  }catch(error){return json({error:error.message},400);}
 },
 async scheduled(event,env,ctx){ctx.waitUntil(scan(env).catch(()=>{console.error('agenda-reader: ciclo fallito; controllare configurazione e stato lettura');}));}
};
