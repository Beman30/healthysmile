import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpretDay,openingText,rollingDates} from '../src/engine.js';
import {romeTime} from '../../backend/src/teamup.js';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../backend/package.json',import.meta.url));
const {Miniflare}=require('miniflare');
const date=rollingDates()[1];
const cfg={medical_ids:[1,2],palmia_id:1,site_id:3};
const event=(id,a,b,title='Paziente',ids=[1])=>({id,start_dt:new Date(romeTime(date,a)).toISOString(),end_dt:new Date(romeTime(date,b)).toISOString(),title,subcalendar_ids:ids});
const base=()=>[event('opening','06:00','10:00','CC/ PALMIA 10-19'),event('pause','13:00','14:00','NB/ PAUSA'),event('stop','19:00','23:00','STOP')];
const at=(r,t)=>r.slots.find(x=>x.time===t);
test('real opening convention, operator prefixes, full hour and lunch',()=>{
 for(const s of ['PALMIA 10-19','CC/ PALMIA 10-19','Nina/ PALMIA 10-19'])assert.deepEqual(openingText(s),{start:'10:00',end:'19:00'});
 const r=interpretDay(base(),date,cfg,0);
 assert.equal(at(r,'10:00').status,'candidate');assert.equal(at(r,'12:15').status,'excluded');assert.equal(at(r,'13:00').status,'excluded');assert.equal(at(r,'18:00').status,'candidate');assert.equal(at(r,'18:15').status,'excluded');
 assert.equal(r.events[0].kind,'opening');assert.equal(r.issues.length,0);
});
test('same event deduplicates; overlapping same doctor fills two chairs',()=>{
 const p=event('p','10:00','13:00');
 let r=interpretDay([...base(),p,p],date,cfg,0);assert.equal(at(r,'10:00').chairs_peak,1);assert.equal(at(r,'10:00').status,'candidate');
 r=interpretDay([...base(),p,event('q','10:30','11:00')],date,cfg,0);assert.equal(at(r,'10:00').status,'excluded');assert.equal(at(r,'11:00').status,'candidate');
});
test('reader needs no hygienist configuration',()=>{
 const r=interpretDay([...base(),event('h','10:30','11:00','Paziente',[2])],date,cfg,0);
 assert.equal(at(r,'10:00').status,'candidate');
 assert.ok(!r.slots.some(s=>s.reasons.some(x=>/igienista/i.test(x))));
});
test('unknown opening remains visible with reason; no silent missing date',()=>{
 const r=interpretDay([event('o','06:00','10:00','CC/ PALMIA dalle dieci fino a sera')],date,cfg,0);
 assert.equal(r.candidate_count,0);assert.ok(r.issues.length);assert.equal(r.slots.length,96);assert.equal(r.events[0].kind,'ambiguous');
});
test('move and delete change calculated slots without old holds',()=>{
 const p=event('p','10:00','11:00','Sito',[3]);
 assert.equal(at(interpretDay([...base(),p],date,cfg,0),'10:00').status,'excluded');
 assert.equal(at(interpretDay([...base(),{...p,delete_dt:'deleted'}],date,cfg,0),'10:00').status,'candidate');
 assert.equal(at(interpretDay([...base(),event('p','12:00','13:00','Sito',[3])],date,cfg,0),'10:00').status,'candidate');
});
test('contradictory openings are reported; legacy hygiene fields are ignored',()=>{
 assert.ok(interpretDay([...base(),event('other','06:00','10:00','PALMIA 11-19')],date,cfg,0).issues.some(x=>/discordanti/.test(x.reason)));
 assert.ok(interpretDay(base(),date,{...cfg,hygienist_ids:[],staff_follows_palmia:false},0).candidate_count>0);
});
test('worker endpoints, persistent reports and repeated updates are read-only upstream',async t=>{
 let events=base(),fail=false,calls=[];
 const mf=new Miniflare({modules:true,compatibilityDate:'2025-09-01',scriptPath:new URL('../releases/healthysmile-agenda-reader-v7.mjs',import.meta.url).pathname,d1Databases:['DB'],bindings:{ADMIN_TOKEN:'admin',TEAMUP_API_KEY:'key',TEAMUP_CALENDAR_KEY:'kstest'},outboundService:async req=>{
  calls.push(req.method);assert.equal(req.method,'GET');
  if(fail)return new Response('{}',{status:503});
  if(new URL(req.url).pathname.endsWith('/configuration'))return Response.json({configuration:{subcalendars:[{id:1,name:'Medici Palmia'},{id:2,name:'Medici Igienista'},{id:3,name:'Sito'}]}});
  return Response.json({events});
 }});t.after(()=>mf.dispose());
 const request=(path,body,auth=true)=>mf.dispatchFetch('https://reader.test/api/'+path,{method:body?'POST':'GET',headers:auth?{Authorization:'Bearer admin','Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 assert.equal((await request('reports',null,false)).status,401);
 assert.equal((await request('config',cfg)).status,200);
 let r=await(await request('scan',{date})).json();assert.equal(at(r.reports[0],'10:00').status,'candidate');
 events=[...base(),event('a','10:00','11:00'),event('b','10:00','11:00')];
 r=await(await request('scan',{date})).json();assert.equal(at(r.reports[0],'10:00').status,'excluded');
 r=await(await request('reports')).json();assert.equal(r.reports.length,1);assert.equal(r.reports[0].stale,false);
 r=await(await request('scan',{})).json();assert.equal(r.reports.length,14);assert.equal(new Set(r.reports.map(x=>x.date)).size,14);
 r=await(await request('scan',{from:'2026-08-01',to:'2026-08-03'})).json();assert.equal(r.reports.length,3);assert.equal(r.reports[0].date,'2026-08-01');
 fail=true;assert.equal((await request('scan',{date})).status,400);
 r=await(await request('reports')).json();assert.ok(r.run.error);assert.ok(r.reports.every(x=>x.stale));
 const db=await mf.getD1Database('DB');const tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();assert.ok(!tables.results.some(x=>x.name==='bookings'));
 assert.ok(calls.length>0);assert.ok(calls.every(x=>x==='GET'));
});

test('free chair intervals use actual event boundaries, merge equal capacity and omit lunch',()=>{
 const r=interpretDay([...base(),event('a','10:00','10:20'),event('b','10:10','10:40')],date,cfg,0);
 const spans=r.free_intervals.map(f=>[new Date(f.start_dt).getTime(),new Date(f.end_dt).getTime(),f.free_chairs]);
 assert.deepEqual(spans,[['10:00','10:10',1],['10:20','10:40',1],['10:40','13:00',2],['14:00','19:00',2]].map(([a,b,n])=>[romeTime(date,a),romeTime(date,b),n]));
});

test('September 11 actual notice and prefixed lunch read opening from title, not event position',()=>{
 for(const title of ['CC-10.00-16.00','NB-10.00-16.00','Nina / 10:00-16:00','10.00-16.00'])assert.deepEqual(openingText(title),{start:'10:00',end:'16:00'});
 const events=[event('o','06:00','10:00','CC-10.00-16.00'),event('l','13:00','14:00','CC- PAUSA')];
 const r=interpretDay(events,date,cfg,0);
 assert.equal(r.issues.length,0);
 assert.deepEqual(r.events.map(e=>e.kind),['opening','pause']);
 assert.deepEqual(r.free_intervals.map(f=>[Date.parse(f.start_dt),Date.parse(f.end_dt),f.free_chairs]),[['10:00','13:00'],['14:00','16:00']].map(([a,b])=>[romeTime(date,a),romeTime(date,b),2]));
 const other=interpretDay(events.map(e=>({...e,subcalendar_ids:[2]})),date,cfg,0);
 assert.ok(other.issues.length);assert.equal(other.windows.length,0);
 assert.equal(openingText('CC- Rossi 10.00-16.00 visita'),null);
});

test('patient notes do not close the day and patient still occupies a chair',()=>{
 for(const notes of ['paziente in ferie','stop terapia','telefonare in pausa','apertura bocca limitata']) {
  const r=interpretDay([...base(),{...event('patient','10:00','11:00'),notes}],date,cfg,0);
  assert.equal(r.issues.length,0);
  assert.equal(r.free_intervals[0].free_chairs,1);
  assert.equal(Date.parse(r.free_intervals[0].end_dt),romeTime(date,'11:00'));
  assert.ok(!r.free_intervals.some(f=>Date.parse(f.start_dt)<romeTime(date,'14:00')&&Date.parse(f.end_dt)>romeTime(date,'13:00')));
 }
});

import {paymentFor,readPayments} from '../src/payments.js';
test('payments reconcile both fields without adding them or reading tooth numbers',()=>{
 const p=(title,who)=>paymentFor({id:'p',title,who});
 assert.equal(p('CC/Rossi (85/22) ott 26','-'),null);
 assert.equal(p('Rossi','150').amount_due,150);
 assert.equal(p('Rossi €150','150').amount_due,150);
 assert.equal(p('Rossi €150','200').status,'review');
 assert.equal(p('Rossi €150','0').status,'review');
 assert.equal(p('Rossi €150 pagato','-').status,'review');
 assert.equal(p('Rossi','1.200,50 €').amount_due,1200.5);
 assert.equal(p('Rossi €200 e €50','-').status,'review');
 assert.equal(p('Rossi non saldato','-').amount_due,null);
 const e={...event('p','10:00','11:00','Rossi'),who:'188'};
 const r=interpretDay([...base(),e,e],date,cfg,0);
 assert.equal(r.payments.length,1);assert.equal(r.payments[0].amount_due,188);
 assert.equal(r.free_intervals[0].free_chairs,1);
});

import {dateRange,paymentTotal} from '../src/range.js';
test('inclusive ranges and totals exclude uncertain amounts and duplicate events',()=>{
 assert.deepEqual(dateRange('2026-09-10','2026-09-12'),['2026-09-10','2026-09-11','2026-09-12']);
 assert.throws(()=>dateRange('2026-02-30','2026-03-01'));assert.throws(()=>dateRange('2026-09-12','2026-09-10'));
 const p={event_id:'a',start_dt:'x',amount_due:10.1,status:'due'};
 const result=paymentTotal([{payments:[p,p,{...p,event_id:'b',amount_due:20.2},{...p,event_id:'c',status:'review',amount_due:null}]},{error:'failed'}]);
 assert.deepEqual(result,{amount:30.3,review:1,missing:1});
});
