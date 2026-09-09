import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {validateSettings} from '../src/availability.js';
import {romeTime} from '../src/teamup.js';

const day=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const config={enabled:true,revision:0,subcalendar_ids:[1,2],windows:[{date:day,start:'10:00',end:'13:00',window_confirmed:true}]};
const patient={service_id:'igiene-sonicare',date:day,first_name:'Test',last_name:'Fittizio',email:'test@example.test',phone:'+390000000000',terms_accepted:true};
function event(id,start,end,extra={}) {return {id,subcalendar_ids:[1],start_dt:new Date(romeTime(day,start)).toISOString(),end_dt:new Date(romeTime(day,end)).toISOString(),title:'Test',...extra};}

async function fixture(t,write=false) {
 let events=[],broken=false,paid=false,expired=false,count=0;
 const sessions=new Map(),created=new Map(),writes=[];let serial=1000,conflict=false,uncertainCreate=false;
 const mf=new Miniflare({modules:true,compatibilityDate:'2025-09-01',scriptPath:new URL('../releases/healthysmile-worker-teamup-scrittura.mjs',import.meta.url).pathname,
   d1Databases:['DB'],bindings:{ADMIN_TOKEN:'test-admin',TEAMUP_API_KEY:'test-api',TEAMUP_CALENDAR_KEY:'kstest',STRIPE_SECRET_KEY:'sk_test',PAYPAL_CLIENT_ID:'test',PAYPAL_CLIENT_SECRET:'test',SITE_URL:'https://example.test'},
   outboundService:async req=>{
     const u=new URL(req.url);
     if(u.hostname==='api.teamup.com') {
       if(broken)return Response.json({error:{id:'no_permission'}},{status:403});
       if(u.pathname.endsWith('/configuration'))return Response.json({configuration:{subcalendars:[{id:1,name:'Medici A',readonly:true},{id:2,name:'Medici B',readonly:true},{id:3,name:'Prenotazioni sito',readonly:false}]}});
       if(req.method==='POST') {
         writes.push('POST');const body=await req.json();assert.deepEqual(body.subcalendar_ids,[3]);
         // Teamup write requests use whole seconds, not JS millisecond timestamps.
         assert.match(body.start_dt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
         assert.match(body.end_dt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
         assert.equal(body.signup_enabled,false);assert.equal(body.comments_enabled,false);assert.deepEqual(body.attachments,[]);
         const event={...body,id:String(++serial),version:'v1',readonly:false};created.set(event.id,event);
         if(uncertainCreate)return Response.json({error:'uncertain'},{status:503});
         return Response.json({event},{status:201});
       }
       const event=created.get(u.pathname.split('/').at(-1));
       if(req.method==='PUT'||req.method==='DELETE') {
         writes.push(req.method);if(!event)return Response.json({error:'missing'},{status:404});
         const body=req.method==='PUT'?await req.json():null,version=body?.version||u.searchParams.get('version');
         assert.ok(version);if(conflict||version!==event.version)return Response.json({error:'version_mismatch'},{status:409});
         if(req.method==='DELETE'){created.delete(event.id);return Response.json({undo_id:'fake'});}
         assert.equal(body.id,event.id);assert.equal(body.remote_id,event.remote_id);
         const next={...event,...body,version:'v2'};created.set(next.id,next);return Response.json({event:next});
       }
       if(/\/events\/[^/]+$/.test(u.pathname))return event?Response.json({event}):Response.json({error:'missing'},{status:404});
       return Response.json({events:[...events,...created.values()]});
     }
     if(u.hostname==='api.stripe.com') {
       if(req.method==='POST') {
         const body=new URLSearchParams(await req.text());
         assert.ok(Number(body.get('expires_at'))>Date.now()/1000+30*60);
         const id='cs_'+(++count);sessions.set(id,{id,amount_total:1500,payment_intent:'pi_'+count,metadata:{booking_id:body.get('metadata[booking_id]')}});
         return Response.json({id,url:'https://checkout.stripe.test/'+id});
       }
       const session=sessions.get(u.pathname.split('/').pop());
       return Response.json({...session,payment_status:paid?'paid':'unpaid',status:paid?'complete':expired?'expired':'open'});
     }
     if(u.hostname==='api-m.sandbox.paypal.com') {
       if(u.pathname.endsWith('/token')) return Response.json({access_token:'fake'});
       if(u.pathname.endsWith('/orders') && req.method==='POST') {
         const body=await req.json(),id='pp_'+(++count);sessions.set(id,body);
         return Response.json({id,links:[{rel:'payer-action',href:'https://paypal.test/'+id}]});
       }
       const parts=u.pathname.split('/'),capture=parts.at(-1)==='capture',id=capture?parts.at(-2):parts.at(-1);
       const body=sessions.get(id);if(capture)paid=true;
       return Response.json({id,status:paid?'COMPLETED':'CREATED',purchase_units:[{...body.purchase_units[0],...(paid?{payments:{captures:[{id:'cap_'+id,status:'COMPLETED',amount:{value:'15.00',currency_code:'EUR'}}]}}:{})}]});
     }
     throw Error('Unexpected external request');
   }});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
 await db.batch(schema.split(';').map(x=>x.trim()).filter(Boolean).map(sql=>db.prepare(sql)));
 const request=async(path,body,admin=false)=>{
   const r=await mf.dispatchFetch('https://worker.test/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(admin?{Authorization:'Bearer test-admin'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:r.status,data:await r.json()};
 };
 const save=await request('admin/teamup/settings',write?{...config,write_enabled:true,write_calendar_id:3}:config,true);assert.equal(save.status,200,JSON.stringify(save.data));
 return {db,request,mf,created,writes,conflict:x=>{conflict=x;},uncertainCreate:x=>{uncertainCreate=x;},events:x=>{events=x;},broken:x=>{broken=x;},paid:x=>{paid=x;},expired:x=>{expired=x;}};
}

test('validates explicit staffing, dates, full hour and separate opening windows',()=>{
 assert.throws(()=>validateSettings({...config,windows:[{...config.windows[0],window_confirmed:false}]}));
 assert.throws(()=>validateSettings({...config,windows:[{...config.windows[0],start:'12:45'}]}));
 assert.throws(()=>validateSettings({...config,windows:[config.windows[0],{...config.windows[0],start:'11:00'}]}));
 assert.equal(validateSettings(config).windows.length,1);
});

test('runtime: full hour, selected windows, closure, pause, two overlapping patients, fail closed',async t=>{
 const f=await fixture(t);
 let r=await f.request('slots?service=igiene-sonicare');
 assert.equal(r.status,200);assert.equal(r.data.slots.at(-1).time,'12:00');assert.equal(r.data.slots.length,9);
 f.events([event('long','10:00','13:00'),event('short','10:00','10:30'),event('short2','11:00','11:30')]);
 r=await f.request('slots?service=igiene-sonicare');
 assert.deepEqual(r.data.slots.map(s=>s.time),['11:30','11:45','12:00']);
 f.events([event('pause','11:00','12:00',{title:'PAUSA'})]);
 r=await f.request('slots?service=igiene-sonicare');assert.deepEqual(r.data.slots.map(s=>s.time),['10:00','12:00']);
 f.events([event('note','10:00','10:15',{notes:'Chiudiamo prima'})]);
 r=await f.request('slots?service=igiene-sonicare');assert.deepEqual(r.data.slots,[]);
 f.broken(true);r=await f.request('slots?service=igiene-sonicare');assert.equal(r.status,503);assert.ok(!JSON.stringify(r.data).includes('test-api'));
});

test('runtime: concurrent overlapping starts sell once; adjacent full hour remains available',async t=>{
 const f=await fixture(t);
 const results=await Promise.all(['10:00','10:15'].map(time=>f.request('checkout/stripe',{...patient,time})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const winner=results.find(r=>r.status===200).data.booking_id;
 const claim=await f.db.prepare('SELECT * FROM teamup_reservations WHERE booking_id=?').bind(winner).first();
 const r=await f.request('slots?service=igiene-sonicare');
 assert.ok(r.data.slots.every(s=>s.time>=claim.end_time));
 assert.ok(r.data.slots.some(s=>s.time===claim.end_time));
 const adjacent=await f.request('checkout/stripe',{...patient,time:claim.end_time});assert.equal(adjacent.status,200);
 const manual=await f.request('admin/booking-create',{service_id:'allineatori-visita',first_name:'Test',last_name:'Other',phone:'0000000000',appointment_date:day,appointment_time:claim.time},true);
 assert.equal(manual.status,409);
});

test('runtime: stale selection is rejected before starting payment',async t=>{
 const f=await fixture(t);await f.request('slots?service=igiene-sonicare');
 f.events([event('a','10:00','11:00'),event('b','10:00','11:00')]);
 const r=await f.request('checkout/stripe',{...patient,time:'10:00'});assert.equal(r.status,409);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM bookings').first()).n,0);
});

test('runtime: payment succeeds, rechecks calendar, duplicate verification stays idempotent',async t=>{
 const f=await fixture(t);const checkout=await f.request('checkout/stripe',{...patient,time:'10:00'});
 assert.equal(checkout.status,200,JSON.stringify(checkout.data));f.paid(true);
 await Promise.all([1,2].map(()=>f.request('checkout/stripe/verify',{booking_id:checkout.data.booking_id})));
 const result=await f.request('bookings/'+checkout.data.booking_id);
 assert.equal(result.data.payment_status,'paid');assert.equal(result.data.booking_status,'confirmed');
 const slots=await f.request('slots?service=igiene-sonicare');assert.ok(slots.data.slots.every(s=>s.time>='11:00'));
});

test('runtime: changed calendar during payment records money but does not confirm appointment',async t=>{
 const f=await fixture(t);const checkout=await f.request('checkout/stripe',{...patient,time:'10:00'});
 f.events([event('a','10:00','11:00'),event('b','10:00','11:00')]);f.paid(true);
 const paid=await f.request('checkout/stripe/verify',{booking_id:checkout.data.booking_id});assert.equal(paid.status,200);
 const result=await f.request('bookings/'+checkout.data.booking_id);
 assert.equal(result.data.payment_status,'paid');assert.equal(result.data.amount_paid,15);assert.equal(result.data.booking_status,'needs_review');
 const confirm=await f.request('admin/booking-status',{booking_id:checkout.data.booking_id,status:'confirmed'},true);assert.equal(confirm.status,409);
});

test('runtime: cancelled checkout paid late cannot take a replacement reservation',async t=>{
 const f=await fixture(t);const a=await f.request('checkout/stripe',{...patient,time:'10:00'});
 await f.request('admin/booking-status',{booking_id:a.data.booking_id,status:'cancelled'},true);
 const b=await f.request('checkout/stripe',{...patient,time:'10:00'});assert.equal(b.status,200);
 f.paid(true);await f.request('checkout/stripe/verify',{booking_id:a.data.booking_id});
 const old=await f.request('bookings/'+a.data.booking_id);assert.equal(old.data.booking_status,'needs_review');assert.equal(old.data.payment_status,'paid');
 const slot=await f.db.prepare('SELECT booking_id FROM slots WHERE date=? AND time=?').bind(day,'10:00').first();assert.equal(slot.booking_id,b.data.booking_id);
});

test('runtime: admin-only settings, revision conflict and pause close public availability',async t=>{
 const f=await fixture(t);const unauthorized=await f.request('admin/teamup/settings',{...config,revision:1,enabled:false});assert.equal(unauthorized.status,401);
 const stale=await f.request('admin/teamup/settings',config,true);assert.equal(stale.status,400);
 f.broken(true); // Pausing must work even if Teamup access was revoked.
 const paused=await f.request('admin/teamup/settings',{...config,revision:1,enabled:false},true);assert.equal(paused.status,200);
 assert.deepEqual((await f.request('slots?service=igiene-sonicare')).data.slots,[]);
 assert.equal((await f.request('checkout/stripe',{...patient,time:'10:00'})).status,409);
});

test('runtime: cron preserves open checkouts and releases only expired Stripe sessions',async t=>{
 const f=await fixture(t),checkout=await f.request('checkout/stripe',{...patient,time:'10:00'});
 await f.db.prepare('UPDATE bookings SET created_at=? WHERE booking_id=?').bind(new Date(Date.now()-7200000).toISOString(),checkout.data.booking_id).run();
 const worker=await f.mf.getWorker();
 await worker.scheduled({cron:'*/10 * * * *',scheduledTime:Date.now()});
 let b=await f.request('bookings/'+checkout.data.booking_id);assert.equal(b.data.booking_status,'held');
 f.expired(true);await worker.scheduled({cron:'*/10 * * * *',scheduledTime:Date.now()});
 b=await f.request('bookings/'+checkout.data.booking_id);assert.equal(b.data.booking_status,'cancelled');
 const slots=await f.request('slots?service=igiene-sonicare');assert.ok(slots.data.slots.some(s=>s.time==='10:00'));
});

test('runtime: an explicit website block and existing booking exclude overlapping choices',async t=>{
 const f=await fixture(t);
 await f.db.prepare("INSERT INTO slots(service_id,date,time,status,updated_at) VALUES('igiene-sonicare',?,'10:00','blocked',?)").bind(day,new Date().toISOString()).run();
 let slots=await f.request('slots?service=igiene-sonicare');assert.ok(slots.data.slots.every(s=>s.time>='11:00'));
 const manual=await f.request('admin/booking-create',{service_id:'allineatori-visita',first_name:'Test',last_name:'Existing',phone:'0000000000',appointment_date:day,appointment_time:'11:00'},true);assert.equal(manual.status,200);
 slots=await f.request('slots?service=igiene-sonicare');assert.deepEqual(slots.data.slots,[{date:day,time:'12:00'}]);
});

test('runtime: PayPal hold survives an open order and capture confirms after rechecking Teamup',async t=>{
 const f=await fixture(t),checkout=await f.request('checkout/paypal',{...patient,time:'10:00'});
 assert.equal(checkout.status,200,JSON.stringify(checkout.data));
 await f.db.prepare('UPDATE bookings SET created_at=? WHERE booking_id=?').bind(new Date(Date.now()-7200000).toISOString(),checkout.data.booking_id).run();
 const worker=await f.mf.getWorker();await worker.scheduled({cron:'*/10 * * * *',scheduledTime:Date.now()});
 let b=await f.request('bookings/'+checkout.data.booking_id);assert.equal(b.data.booking_status,'held');
 const claim=await f.db.prepare('SELECT checkout_id FROM teamup_reservations WHERE booking_id=?').bind(checkout.data.booking_id).first();
 const capture=await f.request('checkout/paypal/capture',{booking_id:checkout.data.booking_id,order_id:claim.checkout_id});assert.equal(capture.status,200);
 b=await f.request('bookings/'+checkout.data.booking_id);assert.equal(b.data.payment_status,'paid');assert.equal(b.data.booking_status,'confirmed');
});


test('runtime: database refusal before contacting payment provider releases the reservation',async t=>{
 const f=await fixture(t);
 await f.db.prepare("CREATE TRIGGER refuse_test_booking BEFORE INSERT ON bookings BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
 const result=await f.request('checkout/stripe',{...patient,time:'10:00'});assert.equal(result.status,503);
 const slots=await f.request('slots?service=igiene-sonicare');assert.ok(slots.data.slots.some(s=>s.time==='10:00'));
});


test('write runtime: creates hold, confirms with version and deletes only its mapped event',async t=>{
 const f=await fixture(t,true);
 f.events([event('staff','10:00','13:00')]);
 const r=await f.request('checkout/stripe',{...patient,time:'10:00'});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(f.created.size,1);assert.deepEqual(f.writes,['POST']);
 f.paid(true);await f.request('checkout/stripe/verify',{booking_id:r.data.booking_id});
 const b=await f.request('bookings/'+r.data.booking_id);assert.equal(b.data.booking_status,'confirmed');assert.deepEqual(f.writes,['POST','PUT']);
 const cancel=await f.request('admin/booking-status',{booking_id:r.data.booking_id,status:'cancelled',event_id:'staff'},true);
 assert.equal(cancel.status,200,JSON.stringify(cancel.data));assert.deepEqual(f.writes,['POST','PUT','DELETE']);assert.equal(f.created.size,0);
});

test('write runtime: foreign booking and a client-supplied event ID never authorize a Teamup mutation',async t=>{
 const f=await fixture(t,true);f.events([event('staff','10:00','11:00')]);
 const manual=await f.request('admin/booking-create',{service_id:'allineatori-visita',first_name:'Test',last_name:'Manuale',phone:'0000000000',appointment_date:day,appointment_time:'12:00'},true);
 assert.equal(manual.status,200);
 const cancel=await f.request('admin/booking-status',{booking_id:manual.data.booking_id,status:'cancelled',event_id:'staff'},true);
 assert.equal(cancel.status,200);assert.deepEqual(f.writes,[]);
});

test('write runtime: staff edits block update/delete and preserve the real payment',async t=>{
 const f=await fixture(t,true),r=await f.request('checkout/stripe',{...patient,time:'10:00'});
 assert.equal(r.status,200);const e=[...f.created.values()][0];e.version='staff-v2';e.title='Modificato dalla segreteria';
 f.paid(true);await f.request('checkout/stripe/verify',{booking_id:r.data.booking_id});
 const b=await f.request('bookings/'+r.data.booking_id);assert.equal(b.data.payment_status,'paid');assert.equal(b.data.booking_status,'needs_review');
 const cancel=await f.request('admin/booking-status',{booking_id:r.data.booking_id,status:'cancelled'},true);assert.equal(cancel.status,409);assert.deepEqual(f.writes,['POST']);
});

test('write runtime: version conflict between GET and PUT cannot become a confirmed appointment',async t=>{
 const f=await fixture(t,true),r=await f.request('checkout/stripe',{...patient,time:'10:00'});assert.equal(r.status,200);
 f.conflict(true);f.paid(true);await f.request('checkout/stripe/verify',{booking_id:r.data.booking_id});
 const b=await f.request('bookings/'+r.data.booking_id);assert.equal(b.data.payment_status,'paid');assert.equal(b.data.booking_status,'needs_review');
});

test('write runtime: uncertain create never starts payment or blindly creates a duplicate',async t=>{
 const f=await fixture(t,true);f.uncertainCreate(true);
 const a=await f.request('checkout/stripe',{...patient,time:'10:00'});assert.equal(a.status,502);
 const b=await f.request('checkout/stripe',{...patient,time:'10:00'});assert.equal(b.status,409);
 assert.equal(f.created.size,1);assert.deepEqual(f.writes,['POST']);
 const booking=await f.db.prepare('SELECT payment_id,payment_status FROM bookings').first();assert.equal(booking.payment_id,null);assert.equal(booking.payment_status,'pending');
});

test('automatic Palmia: merges STOP blocks, excludes breaks and requires full hour',async()=>{
 const {automaticWindows}=await import('../src/teamup.js');
 const blocks=[event('a','08:00','10:00',{title:'CC STOP'}),event('p','13:00','14:00',{title:'PAUSA'}),event('z','19:00','20:00',{title:'STOP'})];
 const w=automaticWindows(blocks,day,1);
 assert.deepEqual(w.map(x=>[x.start,x.end]),[['10:00','13:00'],['14:00','19:00']]);
 assert.deepEqual(automaticWindows([],day,1),[]);
 assert.deepEqual(automaticWindows(blocks.slice(0,1),day,1),[]);
 assert.deepEqual(automaticWindows(blocks,day,2),[]);
 assert.deepEqual(automaticWindows([...blocks,event('closed','08:00','20:00',{title:'STOP'})],day,1),[]);
 assert.deepEqual(automaticWindows([...blocks,{id:'all',subcalendar_ids:[1],all_day:true}],day,1),[]);
 assert.deepEqual(automaticWindows([blocks[0],event('overlap','09:00','10:15',{title:'STOP'}),blocks[2]],day,1).map(x=>x.start),['10:15']);
});

test('automatic config requires explicit Palmia and shared staffing, accepts no manual windows',()=>{
 const auto={...config,schedule_mode:'palmia',palmia_calendar_id:1,staff_follows_palmia:true,windows:[]};
 assert.equal(validateSettings(auto).windows.length,0);
 assert.throws(()=>validateSettings({...auto,palmia_calendar_id:3}));
 assert.throws(()=>validateSettings({...auto,staff_follows_palmia:false}));
});

test('automatic dates roll in Rome across midnight and DST without gaps',async()=>{
 const {rollingDates}=await import('../src/teamup.js');
 assert.equal(rollingDates(Date.parse('2026-09-09T22:30:00Z'))[0],'2026-09-10');
 const dates=rollingDates(Date.parse('2026-10-24T22:30:00Z'));
 assert.equal(dates.length,14);assert.equal(new Set(dates).size,14);
 assert.equal(dates[0],'2026-10-25');assert.equal(dates[1],'2026-10-26');
});

test('runtime automatic publication: closure, live changes, date horizon and authenticated preview',async t=>{
 const f=await fixture(t);
 const a={...config,revision:1,schedule_mode:'palmia',palmia_calendar_id:1,staff_follows_palmia:true,windows:[]};
 let r=await f.request('admin/teamup/settings',a,true);assert.equal(r.status,200);
 const blocks=[event('am','08:00','10:00',{title:'STOP'}),event('pm','13:00','20:00',{title:'STOP'})];
 f.events(blocks);
 r=await f.request('slots?service=igiene-sonicare&date='+day);
 assert.equal(r.status,200);assert.equal(r.data.slots.at(-1).time,'12:00');
 assert.ok(!r.data.slots.some(s=>s.time==='12:15'));
 const far=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 r=await f.request('slots?service=igiene-sonicare&date='+far);assert.deepEqual(r.data.slots,[]);
 r=await f.request('slots?service=igiene-sonicare');assert.deepEqual([...new Set(r.data.slots.map(s=>s.date))],[day]);
 f.events([...blocks,event('a','10:00','13:00'),event('b','10:00','11:00')]);
 r=await f.request('slots?service=igiene-sonicare&date='+day);assert.equal(r.data.slots[0].time,'11:00');
 f.events([blocks[0]]);
 r=await f.request('checkout/stripe',{...patient,time:'11:00'});assert.equal(r.status,409);
 const preview={date:day,subcalendar_ids:[1,2],palmia_calendar_id:1,staff_follows_palmia:true};
 r=await f.request('admin/teamup/auto-preview',preview);assert.equal(r.status,401);
 r=await f.request('admin/teamup/auto-preview',preview,true);assert.equal(r.status,200);assert.deepEqual(r.data.windows,[]);
});

test('runtime automatic + own events: payment confirms without double counting hold',async t=>{
 const f=await fixture(t,true);
 const r=await f.request('admin/teamup/settings',{...config,revision:1,schedule_mode:'palmia',palmia_calendar_id:1,staff_follows_palmia:true,windows:[],write_enabled:true,write_calendar_id:3},true);
 assert.equal(r.status,200);
 f.events([event('am','08:00','10:00',{title:'STOP'}),event('pm','13:00','20:00',{title:'STOP'})]);
 const checkout=await f.request('checkout/stripe',{...patient,time:'10:00'});assert.equal(checkout.status,200);
 f.paid(true);
 const paid=await f.request('checkout/stripe/verify',{booking_id:checkout.data.booking_id});assert.equal(paid.status,200);
 const b=await f.db.prepare('SELECT booking_status FROM bookings WHERE booking_id=?').bind(checkout.data.booking_id).first();
 assert.equal(b.booking_status,'confirmed');assert.deepEqual(f.writes,['POST','PUT']);
});


test('write failure records a safe diagnostic for admin without launching payment or retrying',async t=>{
 const f=await fixture(t,true);f.uncertainCreate(true);
 const r=await f.request('checkout/stripe',{...patient,time:'10:00'});
 assert.equal(r.status,502);
 const sync=await f.request('admin/teamup/sync',null,true);
 assert.equal(sync.status,200);assert.equal(sync.data.events[0].state,'uncertain');
 assert.equal(sync.data.events[0].error_code,'TEAMUP_HTTP_503');
 assert.deepEqual(f.writes,['POST']);
 const booking=await f.db.prepare('SELECT payment_id FROM bookings').first();assert.equal(booking.payment_id,null);
 assert.ok(!JSON.stringify(sync.data).includes('test-api'));
});


test('admin probe creates updates deletes a technical event with website writes disabled; no payment or slots',async t=>{
 const f=await fixture(t,true);
 const save=await f.request('admin/teamup/settings',{...config,revision:1,write_enabled:false,write_calendar_id:3},true);assert.equal(save.status,200);
 const r=await f.request('admin/teamup/write-test',{},true);
 assert.equal(r.status,200);assert.equal(r.data.ok,true,JSON.stringify(r.data));assert.deepEqual(f.writes,['POST','PUT','DELETE']);
 assert.equal(f.created.size,0);
 for(const table of ['bookings','slots','teamup_reservations'])assert.equal((await f.db.prepare('SELECT count(*) AS n FROM '+table).first()).n,0);
 const saved=await f.request('admin/teamup/settings',null,true);assert.equal(saved.data.settings.write_enabled,false);
});

test('probe rejects unauthenticated calls and live write mode; uncertain probe cannot create another event',async t=>{
 const f=await fixture(t,true);
 assert.equal((await f.request('admin/teamup/write-test',{})).status,401);
 assert.equal((await f.request('admin/teamup/write-test',{},true)).status,409);assert.deepEqual(f.writes,[]);
 await f.request('admin/teamup/settings',{...config,revision:1,write_enabled:false,write_calendar_id:3},true);
 f.uncertainCreate(true);
 const r=await f.request('admin/teamup/write-test',{},true);
 assert.equal(r.data.ok,false);assert.equal(r.data.step,'create');assert.equal(r.data.code,'TEAMUP_HTTP_503');
 assert.equal((await f.request('admin/teamup/write-test',{},true)).status,409);assert.deepEqual(f.writes,['POST']);
});
