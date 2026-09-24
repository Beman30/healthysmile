import {resolveStudio} from './auth.mjs';

// Credentials are server-generated 192-bit random secrets, not user-chosen
// passwords. SHA-256 storage is appropriate for this token-sized entropy.
// Do not add a user-chosen password endpoint without a password KDF.
const COOKIE='__Host-hs_session',TTL=86400;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{...headers,...extra}});
const now=()=>Math.floor(Date.now()/1000);
const hex=bytes=>[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
const random=n=>hex(crypto.getRandomValues(new Uint8Array(n)));
const digest=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const equal=(a,b)=>{let diff=a.length^b.length;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^(b.charCodeAt(i)||0);return diff===0;};
const sessionToken=request=>request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
const cookie=(token,age=TTL)=>`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const schemas=[
 'CREATE TABLE IF NOT EXISTS hs_accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, studio_id TEXT NOT NULL REFERENCES studios(id), is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created TEXT NOT NULL)',
 'CREATE UNIQUE INDEX IF NOT EXISTS hs_one_admin ON hs_accounts(is_admin) WHERE is_admin=1',
 'CREATE TABLE IF NOT EXISTS hs_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES hs_accounts(id), expires INTEGER NOT NULL)',
 'CREATE INDEX IF NOT EXISTS hs_sessions_account ON hs_sessions(account_id)',
 'CREATE TABLE IF NOT EXISTS hs_login_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, hits INTEGER NOT NULL)'
];
const initialized=new WeakMap();
export async function ensureAccounts(env){
 if(!env.DB)fail(503,'Archivio non disponibile.');
 if(!initialized.has(env.DB))initialized.set(env.DB,env.DB.batch(schemas.map(sql=>env.DB.prepare(sql))).catch(e=>{initialized.delete(env.DB);throw e;}));
 await initialized.get(env.DB);
}
async function session(request,env){
 const token=sessionToken(request);if(!token)return null;
 if(!/^[a-f0-9]{64}$/.test(token))fail(401,'Sessione scaduta. Accedi nuovamente.');
 await ensureAccounts(env);
 const row=await env.DB.prepare('SELECT a.id, a.username, a.studio_id, a.is_admin, s.name FROM hs_sessions t JOIN hs_accounts a ON a.id=t.account_id JOIN studios s ON s.id=a.studio_id WHERE t.token_hash=? AND t.expires>? AND a.active=1 AND s.active=1').bind(await digest(token),now()).first();
 if(!row)fail(401,'Sessione scaduta. Accedi nuovamente.');
 const wanted=request.headers.get('X-HS-Studio');if(wanted&&wanted!==row.studio_id)fail(403,'Studio non autorizzato.');
 return {accountId:row.id,username:row.username,isAdmin:row.is_admin===1,studioId:row.studio_id,studioName:row.name,role:'owner',subject:row.id};
}
export async function resolveAccount(request,env){
 const account=await session(request,env);if(account)return account;
 // Retain the existing signed Access login during the owner's transition.
 return resolveStudio(request,env);
}
async function admin(request,env){const user=await session(request,env);if(!user?.isAdmin)fail(403,'Accesso riservato all’amministratore.');return user;}
function username(value){const v=typeof value==='string'?value.trim().toLowerCase():'';if(!/^[a-z0-9][a-z0-9._@+-]{2,63}$/.test(v))fail(400,'Username: da 3 a 64 caratteri, lettere, numeri, punto, trattino o email.');return v;}
async function input(request){
 if(request.method!=='POST')fail(405,'Metodo non consentito.');
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-HS-Write')!=='1'||request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'Richiesta non autorizzata.');
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Formato non valido.');
 const reader=request.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();fail(413,'Richiesta troppo grande.');}text+=decoder.decode(value,{stream:true});}
 try{const data=JSON.parse(text+decoder.decode());if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}catch{fail(400,'Dati non validi.');}
}
async function limit(env,key,max){
 const window=Math.floor(now()/900);
 const row=await env.DB.prepare('INSERT INTO hs_login_limits(key,window,hits) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN window=excluded.window THEN hits+1 ELSE 1 END,window=excluded.window RETURNING hits').bind(await digest(key),window).first();
 if(row.hits>max)fail(429,'Troppi tentativi. Riprova tra 15 minuti.');
}
async function issueSession(env,id){
 const token=random(32);await env.DB.prepare('INSERT INTO hs_sessions(token_hash,account_id,expires) VALUES (?,?,?)').bind(await digest(token),id,now()+TTL).run();return cookie(token);
}
async function credentials(){const password='HS-'+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replaceAll('+','-').replaceAll('/','_');return {password,hash:await digest(password)};}
function summary(identity){return {username:identity.username||identity.userEmail,admin:!!identity.isAdmin,studio:{id:identity.studioId,name:identity.studioName}};}

export async function accountAPI(request,env,accessResolver=resolveStudio){
 try{
  const path=new URL(request.url).pathname;
  if(path==='/api/auth/me'&&request.method==='GET'){
   const identity=await resolveAccount(request,env);return json({...summary(identity),setupAllowed:!identity.accountId&&identity.role==='owner'&&!!env.BOOTSTRAP_ADMIN_EMAIL&&identity.userEmail===env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()});
  }
  if(path==='/api/auth/bootstrap'){
   const data=await input(request);
   // Never a public "first user wins" setup: a verified owner JWT is required.
   const owner=await accessResolver(request,env);
   if(!env.BOOTSTRAP_ADMIN_EMAIL||owner.userEmail!==env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()||owner.role!=='owner')fail(403,'Configurazione riservata al titolare.');
   await ensureAccounts(env);
   if(await env.DB.prepare('SELECT id FROM hs_accounts WHERE is_admin=1').bind().first())fail(409,'Account amministratore già configurato. Accedi con username e password.');
   const name=username(data.username),secret=await credentials(),id=crypto.randomUUID();
   try{await env.DB.prepare('INSERT INTO hs_accounts(id,username,password_hash,studio_id,is_admin,created) VALUES (?,?,?,?,1,?)').bind(id,name,secret.hash,owner.studioId,new Date().toISOString()).run();}catch(e){if(/UNIQUE/i.test(e.message))fail(409,'Account già configurato.');throw e;}
   return json({username:name,password:secret.password},200,{'Set-Cookie':await issueSession(env,id)});
  }
  if(path==='/api/auth/login'){
   const data=await input(request);await ensureAccounts(env);
   const name=typeof data.username==='string'?data.username.trim().toLowerCase().slice(0,64):'';
   await limit(env,'ip:'+ (request.headers.get('CF-Connecting-IP')||'unknown'),40);await limit(env,'user:'+name,15);
   await env.DB.batch([env.DB.prepare('DELETE FROM hs_login_limits WHERE window<?').bind(Math.floor(now()/900)-1),env.DB.prepare('DELETE FROM hs_sessions WHERE expires<=?').bind(now())]);
   const row=await env.DB.prepare('SELECT a.id,a.password_hash,a.active,s.active AS studio_active FROM hs_accounts a JOIN studios s ON s.id=a.studio_id WHERE a.username=?').bind(name).first();
   const supplied=await digest(typeof data.password==='string'?data.password:'');
   if(!equal(supplied,row?.password_hash||'0'.repeat(64))||!row?.active||!row.studio_active)fail(401,'Username o password non validi.');
   return json({ok:true},200,{'Set-Cookie':await issueSession(env,row.id)});
  }
  if(path==='/api/auth/logout'){
   await input(request);const token=sessionToken(request);if(token&&/^[a-f0-9]{64}$/.test(token)){await ensureAccounts(env);await env.DB.prepare('DELETE FROM hs_sessions WHERE token_hash=?').bind(await digest(token)).run();}
   return json({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if(path==='/api/accounts'&&request.method==='GET'){
   await admin(request,env);const rows=await env.DB.prepare('SELECT a.id,a.username,a.active,a.is_admin,s.name AS studio_name FROM hs_accounts a JOIN studios s ON s.id=a.studio_id ORDER BY a.created DESC').bind().all();return json({accounts:rows.results});
  }
  if(path==='/api/accounts'){
   const data=await input(request);await admin(request,env);
   const name=username(data.username),label=typeof data.name==='string'?data.name.trim():'';if(!label||label.length>100)fail(400,'Inserisci il nome del tester (massimo 100 caratteri).');
   const id=crypto.randomUUID(),studio=crypto.randomUUID(),secret=await credentials(),created=new Date().toISOString();
   try{await env.DB.batch([
    env.DB.prepare('INSERT INTO studios(id,name,created) VALUES (?,?,?)').bind(studio,label,created),
    env.DB.prepare('INSERT INTO hs_accounts(id,username,password_hash,studio_id,created) VALUES (?,?,?,?,?)').bind(id,name,secret.hash,studio,created)
   ]);}catch(e){if(/UNIQUE/i.test(e.message))fail(409,'Username già utilizzato.');throw e;}
   return json({id,username:name,password:secret.password},201);
  }
  const match=path.match(/^\/api\/accounts\/([a-f0-9-]{36})\/(active|reset)$/);
  if(match){
   const data=await input(request);await admin(request,env);
   const row=await env.DB.prepare('SELECT id,username,is_admin FROM hs_accounts WHERE id=?').bind(match[1]).first();
   if(!row)fail(404,'Account non trovato.');if(row.is_admin)fail(403,'Questa azione è disponibile solo per i tester.');
   if(match[2]==='active'){
    if(typeof data.active!=='boolean')fail(400,'Stato non valido.');
    await env.DB.batch([env.DB.prepare('UPDATE hs_accounts SET active=? WHERE id=?').bind(data.active?1:0,row.id),env.DB.prepare('DELETE FROM hs_sessions WHERE account_id=?').bind(row.id)]);return json({ok:true});
   }
   const secret=await credentials();await env.DB.batch([env.DB.prepare('UPDATE hs_accounts SET password_hash=? WHERE id=?').bind(secret.hash,row.id),env.DB.prepare('DELETE FROM hs_sessions WHERE account_id=?').bind(row.id)]);return json({username:row.username,password:secret.password});
  }
  return json({error:'Non trovato.'},404);
 }catch(e){return json({error:e.status?e.message:'Servizio temporaneamente non disponibile.'},e.status||503);}
}
