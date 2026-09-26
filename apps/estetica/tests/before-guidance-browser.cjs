/* Optional real-browser regression: install Playwright + Chromium, then run
 * node tests/before-guidance-browser.cjs. Deterministic face-detector fixtures.
 * PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE can point to an existing local installation.
 * All patient records are synthetic; the portrait is supplied only as a test fixture.
 */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const {api}=await import('../server/api.mjs');
 const {DatabaseSync}=require('node:sqlite');
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync('migrations/0001_patients.sql','utf8'));
 const objects=new Map(),env={DB:{prepare(sql){return {bind(...args){const s=db.prepare(sql);return {first:async()=>s.get(...args),all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})};}}}},BUCKET:{put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?{body:objects.get(k)}:null}};
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://'+req.headers.host);
   if(url.pathname==='/api/auth/me'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({username:'test',admin:false,studio:{id:'browser-test',name:'Test'}}));return;}
   if(url.pathname.startsWith('/api/')){
    const chunks=[];for await(const c of req)chunks.push(c);
    const r=await api(new Request(url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),env,{studioId:'browser-test'});
    res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;
   }
   if(url.pathname==='/test-portrait.jpg'&&process.env.FACE_TEST_IMAGE){res.setHeader('Content-Type','image/jpeg');res.end(fs.readFileSync(process.env.FACE_TEST_IMAGE));return;}
   const f=path.resolve('public','.'+(url.pathname==='/'?'/index.html':url.pathname==='/installa'?'/installa.html':url.pathname));
   if(!f.startsWith(path.resolve('public')+path.sep)){res.writeHead(403).end();return;}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));
  }catch(e){res.writeHead(500).end(String(e));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:[...(process.env.SPARTICUZ_MODULE?(await import(process.env.SPARTICUZ_MODULE)).default.args.filter(a=>!a.includes('disable-web-security')):[]), '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const errors=[];
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,permissions:['camera']});
 // Simulate the OS standalone flag while exercising the full photo workflow.
 await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
 const page=await context.newPage();page.on('pageerror',e=>{errors.push(String(e));console.log('ERROR',String(e))});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
 page.setDefaultTimeout(10000);
 const visible=async selector=>{await page.locator(selector).waitFor({state:'visible'});};
 const noOverflow=async selector=>{assert(await page.locator(selector).evaluate(e=>e.scrollWidth<=e.clientWidth+2),'horizontal overflow: '+selector+' at '+JSON.stringify(page.viewportSize()));};
 const inViewport=async selector=>{await visible(selector);const b=await page.locator(selector).boundingBox(),v=page.viewportSize();assert(b&&b.x>=0&&b.y>=0&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1,'outside viewport: '+selector);};
 const previewReachable=async()=>{await page.waitForFunction(()=>{const r=document.getElementById('cameraArea').getBoundingClientRect(),top=document.querySelector('.topbar').getBoundingClientRect().bottom,bottom=document.getElementById('captureDock').getBoundingClientRect().top;return r.top>=top-1&&r.bottom<=bottom+1;});};
 const menu=async()=>{await page.locator('#menuToggle').click();await visible('#appMenu');await noOverflow('#appMenu');};
 const shot=async name=>{if(process.env.UI_SCREENSHOTS){fs.mkdirSync(process.env.UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.UI_SCREENSHOTS,name+'.png')});}};
 try{
  // Deterministic detector fixtures exercise readiness and capture cancellation;
  // the after-guidance test separately exercises the real MediaPipe model.
  await page.addInitScript(()=>{
   window.beforeFixture={face:{cx:.5,cy:.36,size:.35,yaw:0,pitch:0,roll:0,eyeOpen:.25,anchors:[[.325,.48],[.39,.48],[.61,.48],[.675,.48],[.5,.52],[.5,.55],[.5,.58]]},unstable:false};
   const NativeWorker=window.Worker;
   window.Worker=class{
    constructor(url){if(!String(url).includes('patient-guidance-worker'))return new NativeWorker(url);}
    postMessage({id,bitmap}){bitmap?.close();setTimeout(()=>{this.onmessage?.({data:{id,face:id===1?null:{...window.beforeFixture.face,...(window.beforeFixture.unstable?{yaw:22}:{})}}});},20);}
    terminate(){this.onmessage=null;}
   };
   navigator.mediaDevices.getUserMedia=async()=>{
    const c=document.createElement('canvas');c.width=450;c.height=600;const ctx=c.getContext('2d');
    const draw=()=>{ctx.fillStyle='#adbac8';ctx.fillRect(0,0,450,600);ctx.fillStyle='#eee';ctx.fillRect(110,80,230,350);ctx.fillStyle='#303540';ctx.fillRect(146,210,30,12);ctx.fillRect(274,210,30,12);ctx.fillRect(190,320,70,8);};draw();setInterval(draw,100);return c.captureStream(10);
   };
  });
  await page.goto(base);await visible('#patientDialog');await page.locator('.new-patient summary').click();await page.locator('#newPatientName').fill('Guida test');await page.locator('#newPatientCode').fill('GUIDA');await page.locator('#createPatient').click();await page.locator('#patientDialog').waitFor({state:'hidden'});
  await page.locator('#dockStart').click();await visible('#beforeGuideControls');await visible('#beforeEyeGuide');
  assert(await page.locator('#beforeGuidedShot').isDisabled());assert(await page.locator('#guide').isHidden());
  await page.locator('#beforePhoneConfirmed').check();
  await page.waitForFunction(()=>!document.getElementById('beforeGuidedShot').disabled,{},{timeout:15000});
  await inViewport('#beforeGuidedShot');await inViewport('#capture');await shot('before-ready');
  await page.evaluate(()=>{beforeFixture.face.pitch=12;});
  await page.waitForFunction(()=>document.getElementById('beforeGuidedShot').disabled&&document.getElementById('beforeCheck-chin').dataset.state==='wait');
  assert.equal(await page.locator('#beforeCheck-eyes').getAttribute('data-state'),'okay','other checks remain independently visible');
  await page.evaluate(()=>{beforeFixture.face.pitch=0;beforeFixture.face.eyeOpen=.02;});
  await page.waitForFunction(()=>document.getElementById('beforeCheck-eyes').textContent.includes('Apri'));
  await page.evaluate(()=>{beforeFixture.face.eyeOpen=.25;});
  await page.waitForFunction(()=>!document.getElementById('beforeGuidedShot').disabled,{},{timeout:15000});
  await page.locator('#beforeGuidedShot').click();await visible('#accept');assert(await page.locator('#beforeGuideControls').isHidden());
  assert(await page.evaluate(()=>pending?.width===450&&pending?.height===600&&pending?.blob?.size>0),'one original frame is staged');
  await shot('before-selected');await page.locator('#retake').click();
  await page.waitForFunction(()=>!document.getElementById('beforeGuidedShot').disabled,{},{timeout:15000});
  await page.locator('#beforeGuidedShot').click();await page.evaluate(()=>{beforeFixture.unstable=true;});
  await page.waitForFunction(()=>!captureBusy,{},{timeout:10000});assert(await page.locator('#accept').isHidden(),'invalid burst must not stage a photo');
  assert(await page.locator('#capture').isEnabled(),'manual capture remains available');
  await page.evaluate(()=>selectPose(3));await page.waitForTimeout(600);assert(await page.locator('#beforeGuidedShot').isDisabled());assert(await page.locator('#beforeEyeGuide').isHidden());
  await page.locator('#capture').click();await visible('#accept');
  assert.deepEqual(errors,[]);console.log('PASS first-photo phone confirmation, all-axis readiness, blinking, guided burst selection, unstable rejection, profile fallback and manual capture.');
 }catch(e){console.log('LAST GUIDE',await page.locator('#patientGuideInstruction').textContent());throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
