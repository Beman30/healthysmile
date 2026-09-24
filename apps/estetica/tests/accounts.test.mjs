import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {accountAPI,resolveAccount} from '../server/accounts.mjs';
import {handle} from '../server/worker.mjs';
const origin='https://foto.example.com';
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const f of ['0001_patients.sql','0002_studios.sql'])sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 sql.exec("INSERT INTO studios(id,name,created) VALUES ('owner-studio','Owner','now'); INSERT INTO studio_members(studio_id,email,role) VALUES ('owner-studio','owner@example.com','owner')");
 const DB={prepare(query){const build=args=>({bind:(...next)=>build(next),first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:sql.prepare(query).run(...args)})});return build([]);},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,BUCKET:{},BOOTSTRAP_ADMIN_EMAIL:'owner@example.com',ASSETS:{fetch:async()=>new Response('static')}};
 const owner=async()=>({userEmail:'owner@example.com',role:'owner',studioId:'owner-studio'});
 const req=(path,data,cookie='',extra={})=>new Request(origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-HS-Write':'1',Cookie:cookie,...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const call=(path,data,cookie,extra)=>accountAPI(req(path,data,cookie,extra),env,owner);
 const bootstrap=async()=>{const r=await call('/api/auth/bootstrap',{username:'owner'});assert.equal(r.status,200);return {secret:await r.json(),cookie:r.headers.get('Set-Cookie').split(';')[0]};};
 const login=async(username,password)=>{const r=await call('/api/auth/login',{username,password});return {response:r,cookie:r.headers.get('Set-Cookie')?.split(';')[0]};};
 return {sql,env,req,call,bootstrap,login};
}
test('bootstrap requires verified original owner, creates only one admin and preserves existing studio',async()=>{
 const f=fixture();const request=f.req('/api/auth/bootstrap',{username:'owner'});
 assert.equal((await accountAPI(request,f.env,async()=>({userEmail:'intruder@example.com',role:'owner'}))).status,403);
 assert.equal((await accountAPI(f.req('/api/auth/bootstrap',{username:'owner'}),f.env)).status,503);
 const owner=await f.bootstrap();assert.match(owner.secret.password,/^HS-[A-Za-z0-9_-]{32}$/);
 assert(!JSON.stringify(f.sql.prepare('SELECT * FROM hs_accounts').all()).includes(owner.secret.password));
 const identity=await resolveAccount(f.req('/',undefined,owner.cookie),f.env);assert.equal(identity.studioId,'owner-studio');assert.equal(identity.isAdmin,true);
 assert.equal((await f.call('/api/auth/bootstrap',{username:'second'})).status,409);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM hs_accounts').get().n,1);
});
test('tester credentials, patient isolation, admin restrictions and atomic account creation',async()=>{
 const f=fixture(),owner=await f.bootstrap();
 const created=await f.call('/api/accounts',{username:'tester',name:'Tester'},owner.cookie);assert.equal(created.status,201);const tester=await created.json();
 const second=await f.call('/api/accounts',{username:'tester',name:'Duplicate'},owner.cookie);assert.equal(second.status,409);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM studios').get().n,2);
 const signed=await f.login(tester.username,tester.password);assert.equal(signed.response.status,200);assert.match(signed.response.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const identity=await resolveAccount(f.req('/',undefined,signed.cookie),f.env);assert.notEqual(identity.studioId,'owner-studio');assert.equal(identity.isAdmin,false);
 await assert.rejects(resolveAccount(f.req('/',undefined,signed.cookie,{'X-HS-Studio':'owner-studio'}),f.env),{status:403});
 for(const path of ['/api/accounts','/api/auth/bootstrap'])assert.equal((await accountAPI(f.req(path,path.endsWith('bootstrap')?{username:'evil'}:undefined,signed.cookie),f.env)).status>=400,true);
 assert.equal((await f.call('/api/accounts',{username:'evil',name:'Evil'},signed.cookie)).status,403);
 const id=crypto.randomUUID();const put=new Request(origin+'/api/patients/'+id,{method:'PUT',headers:{Origin:origin,'X-HS-Write':'1','Content-Type':'application/json',Cookie:owner.cookie},body:JSON.stringify({code:'OWNER',name:'Private patient'})});
 assert.equal((await handle(put,f.env)).status,200);
 assert.equal((await handle(f.req('/api/patients/'+id,undefined,signed.cookie),f.env)).status,404);
 assert.deepEqual((await (await handle(f.req('/api/patients',undefined,signed.cookie),f.env)).json()).patients,[]);
 const publicShell=await handle(f.req('/installa'),f.env);assert.equal(publicShell.status,200);
 const anonymous=await handle(f.req('/api/patients'),f.env);assert(anonymous.status>=400);
});
test('invalid passwords, forged/expired cookies, logout and revocation deny access',async()=>{
 const f=fixture(),owner=await f.bootstrap(),created=await(await f.call('/api/accounts',{username:'tester',name:'Tester'},owner.cookie)).json();
 assert.equal((await f.login('tester','incorrect')).response.status,401);
 const a=await f.login('tester',created.password),b=await f.login('tester',created.password);assert.notEqual(a.cookie,b.cookie);
 await assert.rejects(resolveAccount(f.req('/',undefined,'__Host-hs_session='+'a'.repeat(64)),f.env),{status:401});
 assert.equal((await f.call('/api/auth/logout',{},a.cookie)).status,200);await assert.rejects(resolveAccount(f.req('/',undefined,a.cookie),f.env),{status:401});
 const reset=await(await f.call(`/api/accounts/${created.id}/reset`,{},owner.cookie)).json();await assert.rejects(resolveAccount(f.req('/',undefined,b.cookie),f.env),{status:401});assert.equal((await f.login('tester',created.password)).response.status,401);
 const c=await f.login('tester',reset.password);assert.equal(c.response.status,200);
 await f.call(`/api/accounts/${created.id}/active`,{active:false},owner.cookie);await assert.rejects(resolveAccount(f.req('/',undefined,c.cookie),f.env),{status:401});assert.equal((await f.login('tester',reset.password)).response.status,401);
 await f.call(`/api/accounts/${created.id}/active`,{active:true},owner.cookie);await assert.rejects(resolveAccount(f.req('/',undefined,c.cookie),f.env),{status:401});
 const d=await f.login('tester',reset.password);f.sql.prepare('UPDATE hs_sessions SET expires=0 WHERE account_id=?').run(created.id);await assert.rejects(resolveAccount(f.req('/',undefined,d.cookie),f.env),{status:401});
});
test('CSRF protection, account enumeration response and persistent rate limit',async()=>{
 const f=fixture(),owner=await f.bootstrap();
 for(const path of ['/api/auth/login','/api/auth/logout','/api/accounts','/api/auth/bootstrap'])assert.equal((await f.call(path,{},owner.cookie,{Origin:'https://evil.example'})).status,403);
 const unknown=await f.login('missing','bad'),bad=await f.login('owner','bad');assert.deepEqual(await unknown.response.json(),await bad.response.json());
 for(let i=0;i<14;i++)assert.equal((await f.login('owner','bad')).response.status,401);
 assert.equal((await f.login('owner',owner.secret.password)).response.status,429);
 const id=f.sql.prepare('SELECT id FROM hs_accounts WHERE is_admin=1').get().id;assert.equal((await f.call(`/api/accounts/${id}/active`,{active:false},owner.cookie)).status,403);
});
