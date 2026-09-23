import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPair,SignJWT,exportJWK,createLocalJWKSet} from 'jose';
import {verifyAccess,resolveStudio} from '../server/auth.mjs';
import {handle} from '../server/worker.mjs';
import {api} from '../server/api.mjs';
import {makeConfig} from '../scripts/configure.mjs';
const origin='https://estetica.example.com';
function database(){const sql=new DatabaseSync(':memory:');for(const f of ['0001_patients.sql','0002_studios.sql'])sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));return {sql,DB:{prepare(query){return {bind(...args){const s=sql.prepare(query);return {first:async()=>s.get(...args),all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})};}}}}};}
const req=(path,method='GET',body)=>new Request(origin+path,{method,headers:{Origin:origin,'X-HS-Write':'1','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
test('initial cloud deployment denies studio access before Access configuration',async()=>{
 const c=JSON.parse(readFileSync(new URL('../wrangler.cloud.json',import.meta.url),'utf8'));
 assert.equal(c.assets.run_worker_first,true);
 assert.equal(c.r2_buckets[0].jurisdiction,'eu');
 const unexpected=()=>{throw Error('Storage must not be reached before authentication');};
 const env={ASSETS:{fetch:unexpected},DB:{prepare:unexpected},BUCKET:{get:unexpected}};
 for(const path of ['/','/app.js','/api/session','/api/patients']){
  const response=await handle(req(path),env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'Accesso studio non ancora configurato.');
 }
});
test('signed Access identity: issuer, audience, expiry and cookies validated; spoofed identity rejected',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='test';const keys=createLocalJWKSet({keys:[jwk]}),env={ACCESS_TEAM_DOMAIN:'https://studio.cloudflareaccess.com',ACCESS_AUD:'a'.repeat(64)};
 const token=async(aud=env.ACCESS_AUD,exp='2h')=>new SignJWT({email:'Owner@Example.com'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('owner').setIssuer(env.ACCESS_TEAM_DOMAIN).setAudience(aud).setExpirationTime(exp).sign(privateKey);
 const r=t=>new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':t}});
 assert.equal((await verifyAccess(r(await token()),env,keys)).email,'owner@example.com');
 assert.equal((await verifyAccess(new Request(origin,{headers:{cookie:'CF_Authorization='+await token()}}),env,keys)).subject,'owner');
 for(const t of [await token('wrong'),await token(env.ACCESS_AUD,'-1h'),'forged'])await assert.rejects(verifyAccess(r(t),env,keys),{status:401});
 await assert.rejects(verifyAccess(new Request(origin,{headers:{'oai-authenticated-user-id':'owner'}}),env,keys),{status:401});
});
test('studio membership cannot be selected without authorization; inactive members denied',async()=>{
 const {sql,DB}=database();sql.exec("INSERT INTO studios VALUES ('a','Studio A',1,'now'),('b','Studio B',1,'now'); INSERT INTO studio_members VALUES ('a','a@example.com','owner',1),('b','disabled@example.com','editor',0)");
 const verify=async()=>({email:'a@example.com',subject:'u'});
 assert.equal((await resolveStudio(req('/'),{DB},verify)).studioId,'a');
 await assert.rejects(resolveStudio(new Request(origin,{headers:{'X-HS-Studio':'b'}}),{DB},verify),{status:403});
 await assert.rejects(resolveStudio(req('/'),{DB},async()=>({email:'disabled@example.com'})),{status:403});
});
test('patient records and photos are scoped by studio; stale writes cannot overwrite',async()=>{
 const {DB}=database(),env={DB,BUCKET:{}},a={studioId:'a'},b={studioId:'b'},id=crypto.randomUUID();
 assert.equal((await api(req('/api/patients/'+id,'PUT',{code:'P1',name:'Test'}),env,a)).status,200);
 for(const path of ['/api/patients/'+id,'/api/patients/'+id+'/images/'+'a'.repeat(64)])assert.equal((await api(req(path),env,b)).status,404);
 assert.deepEqual((await (await api(req('/api/patients'),env,b)).json()).patients,[]);
 const manifest={visits:[]};assert.equal((await api(req('/api/patients/'+id+'/manifest','PUT',{version:0,manifest}),env,a)).status,200);
 assert.equal((await api(req('/api/patients/'+id+'/manifest','PUT',{version:0,manifest}),env,a)).status,409);
 assert.equal((await api(new Request(origin+'/api/patients/'+id,{method:'PUT',headers:{Origin:'https://other.example','X-HS-Write':'1'},body:'{}'}),env,a)).status,403);
});
test('all studio assets and APIs require auth; only exact viewer routes bypass it',async()=>{
 const deny=async()=>{throw Object.assign(Error('Login required'),{status:401});},env={ASSETS:{fetch:async()=>new Response('viewer')},BUCKET:{get:async()=>null}};
 for(const path of ['/','/app.js','/viewer.html','/api/patients','/api/session','/s/nope'])assert.equal((await handle(req(path),env,deny)).status,401);
 assert.equal((await handle(req('/s/'+'a'.repeat(48)),env,deny)).status,200);
 assert.equal((await handle(req('/api/shares/'+'a'.repeat(48)),env,deny)).status,404);
 assert.equal((await handle(req('/api/shares/'+'a'.repeat(48),'DELETE'),env,deny)).status,401);
});
test('domain change preserves storage identifiers and auth-first routing',()=>{
 const s={accountId:'a'.repeat(32),databaseId:crypto.randomUUID(),databaseName:'test',bucket:'test-photos',domain:'one.example.com',accessTeamDomain:'https://studio.cloudflareaccess.com',accessAudience:'b'.repeat(64)};
 const a=makeConfig(s),b=makeConfig({...s,domain:'two.example.com'});assert.deepEqual(a.d1_databases,b.d1_databases);assert.deepEqual(a.r2_buckets,b.r2_buckets);assert.equal(b.assets.run_worker_first,true);assert.equal(b.workers_dev,false);assert.throws(()=>makeConfig({...s,accountId:''}));
});
