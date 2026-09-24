/* Optional real Chromium integration. Synthetic credentials and patient data only.
 * PLAYWRIGHT_MODULE=/path/to/playwright BROWSER_EXECUTABLE=/path/to/chromium
 * node tests/accounts-browser.cjs
 */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const {DatabaseSync}=require('node:sqlite'),{handle}=await import('../server/worker.mjs'),{accountAPI}=await import('../server/accounts.mjs');
 const sql=new DatabaseSync(':memory:');for(const f of ['0001_patients.sql','0002_studios.sql'])sql.exec(fs.readFileSync('migrations/'+f,'utf8'));
 sql.exec("INSERT INTO studios(id,name,created) VALUES ('owner-studio','Owner','now'); INSERT INTO studio_members(studio_id,email,role) VALUES ('owner-studio','owner@example.com','owner')");
 const DB={prepare(query){const build=args=>({bind:(...next)=>build(next),first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:sql.prepare(query).run(...args)})});return build([]);},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,BUCKET:{},BOOTSTRAP_ADMIN_EMAIL:'owner@example.com',ACCESS_TEAM_DOMAIN:'https://test.cloudflareaccess.com',ACCESS_AUD:'test',ASSETS:{fetch:async request=>{
  let p=new URL(request.url).pathname;if(p==='/')p='/index.html';else if(['/login','/account','/installa'].includes(p))p+='.html';
  const f=path.resolve('public','.'+p);if(!f.startsWith(path.resolve('public')+path.sep)||!fs.existsSync(f))return new Response('Missing',{status:404});
  return new Response(fs.readFileSync(f),{headers:{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(f)]||'application/octet-stream'}});
 }}};
 const seeded=await accountAPI(new Request('https://test/api/auth/bootstrap',{method:'POST',headers:{Origin:'https://test','X-HS-Write':'1','Content-Type':'application/json'},body:JSON.stringify({username:'owner'})}),env,async()=>({userEmail:'owner@example.com',role:'owner',studioId:'owner-studio'}));assert.equal(seeded.status,200);const owner=await seeded.json();
 const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const response=await handle(new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500).end('Test server error');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const errors=[];
 async function context(installed){const c=await browser.newContext({viewport:{width:390,height:844}});if(installed)await c.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));return c;}
 async function login(p,name,password){await p.locator('#username').fill(name);await p.locator('#password').fill(password);await p.locator('#loginSubmit').click();}
 try{
  const c=await context(true),p=await c.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(base);await p.waitForURL('**/login');
  await login(p,'owner','incorrect');await p.locator('#authStatus').filter({hasText:'non validi'}).waitFor();
  await login(p,owner.username,owner.password);await p.locator('#patientDialog').waitFor({state:'visible'});
  await p.locator('#patientAccount').click();await p.waitForURL('**/account');await p.locator('#adminSection').waitFor({state:'visible'});
  await p.locator('#testerName').fill('Studio beta');await p.locator('#testerUsername').fill('beta');await p.locator('#createAccountForm button').click();await p.locator('#credentialsSection').waitFor({state:'visible'});
  const text=await p.locator('#credentialsText').inputValue(),password=text.match(/Password: (\S+)/)[1];assert(text.includes('Username: beta'));
  assert(await p.locator('html').evaluate(e=>e.scrollWidth<=e.clientWidth+2));
  if(process.env.UI_SCREENSHOTS){fs.mkdirSync(process.env.UI_SCREENSHOTS,{recursive:true});await p.screenshot({path:path.join(process.env.UI_SCREENSHOTS,'accounts.png'),fullPage:true});}
  const t=await context(true),q=await t.newPage();q.on('pageerror',e=>errors.push(String(e)));await q.goto(base);await q.waitForURL('**/login');await login(q,'beta',password);await q.locator('#patientDialog').waitFor({state:'visible'});await q.locator('#patientListStatus').filter({hasText:'Nessun paziente'}).waitFor();
  await q.locator('#patientAccount').click();await q.waitForURL('**/account');await q.locator('#accountLabel').filter({hasText:'beta'}).waitFor();assert.equal(await q.locator('#adminSection').isVisible(),false);
  await p.locator('#dismissCredentials').click();await p.locator('.account-row').filter({hasText:'beta'}).getByText('Sospendi accesso').click();await p.locator('.account-row').filter({hasText:'beta'}).getByText('Riattiva accesso').waitFor();
  await q.reload();await q.waitForURL('**/login?next=account');
  await p.locator('#recoverySection').waitFor({state:'visible'});
  const before=sql.prepare('SELECT id,studio_id FROM hs_accounts WHERE is_admin=1').get();
  p.once('dialog',dialog=>dialog.accept());await p.locator('#recoverPassword').click();await p.locator('#credentialsSection').waitFor({state:'visible'});
  const recovered=(await p.locator('#credentialsText').inputValue()).match(/Password: (\S+)/)[1];assert.notEqual(recovered,owner.password);
  assert.deepEqual(sql.prepare('SELECT id,studio_id FROM hs_accounts WHERE is_admin=1').get(),before);
  await p.locator('#authStatus').filter({hasText:'Nuova password generata'}).waitFor();
  await p.locator('#logout').click();await p.waitForURL('**/login');await p.goto(base+'/account');await p.waitForURL('**/login?next=account');
  await login(p,'owner',recovered);await p.waitForURL('**/account');await p.locator('#adminSection').waitFor({state:'visible'});
  const anon=await context(false),r=await anon.newPage();await r.goto(base);await r.waitForURL('**/installa');assert.equal(await r.locator('#password').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: browser login, generated tester credentials, separated empty archive, admin UI, suspension, logout and public install page.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));sql.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
