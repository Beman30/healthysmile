import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {api} from '../server/api.mjs';

const origin='https://estetica.example.com';
const request=(path,method='GET',body)=>new Request(origin+path,{method,headers:{Origin:origin,'X-HS-Write':'1','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
test('four after-zone crops persist with one original before photo; invalid crops are rejected',async()=>{
 const sql=new DatabaseSync(':memory:');
 try{
  sql.exec(readFileSync(new URL('../migrations/0001_patients.sql',import.meta.url),'utf8'));
  const DB={prepare(query){return {bind(...args){const statement=sql.prepare(query);return {first:async()=>statement.get(...args),all:async()=>({results:statement.all(...args)}),run:async()=>({meta:statement.run(...args)})};}}}};
  const id=crypto.randomUUID(),before=crypto.randomUUID(),after=crypto.randomUUID(),hashes=Array.from({length:5},(_,i)=>String(i+1).repeat(64));
  const env={DB,BUCKET:{}},who={studioId:'test-studio'},path='/api/patients/'+id;
  assert.equal((await api(request(path,'PUT',{code:'ZONE-1',name:'Test'}),env,who)).status,200);
  for(const hash of hashes)sql.prepare('INSERT INTO images (id,patient,hash,mime,size) VALUES (?,?,?,?,?)').run('patients/'+id+'/'+hash,id,hash,'image/jpeg',12345);
  const photo=(pose,hash,zone=null)=>({pose,hash,width:900,height:1200,takenAt:'2026-09-29T10:00:00.000Z',zone});
  const zones=['eyes','left','right','forehead'].map((name,i)=>photo('front-neutral--'+name,hashes[i+1],{source:'front-neutral',id:name,roi:{x:.1+i*.1,y:.1,w:.4,h:.3}}));
  const manifest={visits:[{id:before,date:'2026-09-29',phase:'before',treatment:'',photos:[photo('front-neutral',hashes[0])]},
   {id:after,date:'2026-09-29',phase:'followup',treatment:'',photos:zones}]};
  const put=(version,value)=>api(request(path+'/manifest','PUT',{version,manifest:value}),env,who);
  assert.equal((await put(0,manifest)).status,200);
  const saved=(await(await api(request(path),env,who)).json()).manifest;
  assert.equal(saved.visits[0].photos.length,1);
  assert.deepEqual(saved.visits[1].photos.map(p=>[p.pose,p.zone.roi]),zones.map(p=>[p.pose,p.zone.roi]));
  for(const bad of [
   {...manifest,visits:[{...manifest.visits[0],photos:zones},manifest.visits[1]]},
   {...manifest,visits:[manifest.visits[0],{...manifest.visits[1],photos:zones.map((p,i)=>i===0?{...p,zone:{...p.zone,roi:{...p.zone.roi,x:.9}}}:p)}]},
   {...manifest,visits:[manifest.visits[0],{...manifest.visits[1],photos:zones.map((p,i)=>i===0?{...p,zone:null}:p)}]}
  ])assert.equal((await put(1,bad)).status,400);
 }finally{sql.close();}
});
