import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preview,romeTime,calendars,teamupPreview} from '../src/teamup.js';
const input={date:'2026-09-11',start:'10:00',end:'13:00',subcalendar_ids:[1,2],window_confirmed:true};
const event=(id,start,end,extra={})=>({id,subcalendar_ids:[1],start_dt:`2026-09-11T${start}:00+02:00`,end_dt:`2026-09-11T${end}:00+02:00`,...extra});
const status=(events,time,overrides={})=>preview(events,{...input,...overrides}).slots.find(s=>s.time===time).status;
test('same doctor: long appointment and overlapping patients occupy two chairs',()=>{
 const events=[event('long','10:00','13:00'),event('short1','10:00','10:30'),event('short2','11:00','11:45')];
 assert.equal(status(events,'10:00'),'full');assert.equal(status(events,'11:00'),'full');assert.equal(status(events,'12:00'),'candidate');
 assert.equal(status(events,'10:30'),'full'); // whole hour, not just start
});
test('deduplicates same event across subcalendars, ignores other categories',()=>{
 const e=event('a','10:00','13:00',{subcalendar_ids:[1,2,99]});
 assert.equal(status([e,e,event('b','10:00','13:00',{subcalendar_ids:[99]})],'10:00'),'candidate');
});
test('back-to-back appointments do not overlap at end boundary',()=>{
 const events=[event('a','16:30','17:15'),event('b','17:15','17:45'),event('c','17:30','18:30',{subcalendar_ids:[2]})];
 assert.equal(status(events,'16:30',{start:'16:30',end:'18:30'}),'candidate');
 assert.equal(status(events,'16:45',{start:'16:30',end:'18:30'}),'full');
});
test('timed pause/stop conservatively block overlapping slots',()=>assert.equal(status([event('a','10:30','11:00',{title:'CC- PAUSA'})],'10:00'),'blocked'));
test('organizational notes and all-day events require review',()=>{
 assert.equal(status([event('a','12:00','13:00',{notes:'Oggi chiudiamo alle 16'})],'10:00'),'review');
 assert.equal(status([{id:'day',subcalendar_ids:[1],all_day:true}],'10:00'),'review');
});
test('invalid events fail closed, including conflicting duplicate ids',()=>{
 assert.throws(()=>preview([event('a','12:00','10:00')],input));
 assert.throws(()=>preview([event('a','10:00','11:00'),event('a','11:00','12:00')],input));
 assert.throws(()=>preview(undefined,input));
});
test('requires explicit opening and staff confirmation and selected calendars',()=>{
 assert.throws(()=>preview([],{...input,window_confirmed:false}));
 assert.throws(()=>preview([],{...input,subcalendar_ids:[]}));
});
test('Rome timezone supports summer/winter, rejects invalid and ambiguous times',()=>{
 assert.equal(new Date(romeTime('2026-09-11','10:00')).toISOString(),'2026-09-11T08:00:00.000Z');
 assert.equal(new Date(romeTime('2026-12-11','10:00')).toISOString(),'2026-12-11T09:00:00.000Z');
 for(const [d,t] of [['2026-02-30','10:00'],['2026-03-29','02:30'],['2026-10-25','02:30']]) assert.throws(()=>romeTime(d,t));
});
const env={TEAMUP_API_KEY:'test-key',TEAMUP_CALENDAR_KEY:'kstest'};
test('API requests use secret header, selected calendars, and sanitize output',async()=>{
 const urls=[];
 const result=await teamupPreview(env,input,async(url,opts)=>{
  assert.equal(opts.headers['Teamup-Token'],'test-key');urls.push(url);
  return Response.json(url.includes('/subcalendars?')?{subcalendars:[{id:1,name:'Medici > A'},{id:2,name:'Medici > B'}]}:{events:[event('a','10:00','11:00',{title:'PRIVATE',notes:'PRIVATE NOTES'})]});
 });
 assert.ok(urls[1].includes('subcalendarId%5B%5D=1'));assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('upstream errors never disclose credentials, URLs, or patient response',async()=>{
 await assert.rejects(()=>calendars(env,async()=>{throw new Error('kstest test-key patient');}),e=>!e.message.includes('kstest')&&!e.message.includes('patient'));
 await assert.rejects(()=>calendars(env,async()=>Response.json({error:'secret'},{status:403})));
});

test('Worker rejects unauthenticated access before reading Teamup',async()=>{
 const {default:worker}=await import('../src/index.js');
 for(const path of ['calendars','preview']){
  const response=await worker.fetch(new Request('https://worker.test/api/admin/teamup/'+path),{ADMIN_TOKEN:'admin-test'},{});
  assert.equal(response.status,401);
 }
 const response=await worker.fetch(new Request('https://worker.test/api/admin/teamup/calendars',{headers:{Authorization:'Bearer admin-test'}}),{ADMIN_TOKEN:'admin-test'},{});
 assert.equal(response.status,400);assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.match((await response.json()).error,/Configurare i secret/);
});

test('diagnostics expose status and stage, never upstream body or credentials',async()=>{
 for(const code of [400,401,403,404,429,500,503]) {
  await assert.rejects(()=>calendars(env,async()=>new Response('private patient kstest test-key',{status:code})),e=>e.message.includes(`HTTP ${code} (subcalendars)`)&&!/private|kstest|test-key/.test(e.message));
 }
 await assert.rejects(()=>calendars(env,async()=>new Response('<html>private</html>')),/formato risposta non valido/);
 await assert.rejects(()=>calendars(env,async()=>{throw Error('private kstest')}),/connessione non riuscita/);
});
test('trims accidental outer whitespace on secrets without disclosing them',async()=>{
 await calendars({TEAMUP_API_KEY:' test-key\n',TEAMUP_CALENDAR_KEY:' kstest '},async(url,options)=>{
  assert.ok(url.startsWith('https://api.teamup.com/kstest/'));assert.equal(options.headers['Teamup-Token'],'test-key');return Response.json({subcalendars:[]});
 });
 await assert.rejects(()=>calendars({...env,TEAMUP_API_KEY:'bad\nkey'}),/spazi o ritorni/);
});
