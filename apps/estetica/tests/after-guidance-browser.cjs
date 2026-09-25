/* Optional real-browser regression: install Playwright + Chromium, then run
 * FACE_TEST_IMAGE=/path/to/non-patient-portrait.jpg node tests/after-guidance-browser.cjs.
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
  if(!process.env.FACE_TEST_IMAGE)throw Error('Set FACE_TEST_IMAGE to a non-patient portrait fixture');
  await page.addInitScript(()=>{
   window.guideTest={x:0,y:0,scale:1,roll:0,blank:false};
   navigator.mediaDevices.getUserMedia=async()=>{
    const im=new Image();im.src='/test-portrait.jpg';await im.decode();const c=document.createElement('canvas');c.width=450;c.height=600;const ctx=c.getContext('2d');
    const ratio=.75,w=im.naturalWidth,h=im.naturalHeight,sw=w/h>ratio?h*ratio:w,sh=w/h>ratio?h:w/ratio;
    const draw=()=>{const t=window.guideTest;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#aaa';ctx.fillRect(0,0,450,600);if(t.blank)return;ctx.translate(225+t.x*450,100+t.y*600);ctx.rotate(t.roll*Math.PI/180);ctx.scale(t.scale,t.scale);ctx.drawImage(im,(w-sw)/2,(h-sh)/2,sw,sh,-225,-100,450,600);};draw();setInterval(draw,100);return c.captureStream(10);
   };
  });
  await page.goto(base);await visible('#patientDialog');await page.locator('.new-patient summary').click();await page.locator('#newPatientName').fill('Guida test');await page.locator('#newPatientCode').fill('GUIDA');await page.locator('#createPatient').click();await page.locator('#patientDialog').waitFor({state:'hidden'});
  assert(await page.locator('#patientGuidance').isHidden(),'no automatic guide for the first photo');
  await page.locator('#previousPhotoInput').setInputFiles(process.env.FACE_TEST_IMAGE);await visible('#referenceContour');await page.locator('#dockStart').click();
  await page.waitForFunction(()=>document.getElementById('patientGuideInstruction').textContent.includes('Posizione vicina'),{},{timeout:60000});assert(await page.locator('#referenceContour').isVisible());assert(await page.locator('#capture').isEnabled());await shot('after-guide-matched');
  await page.evaluate(()=>{guideTest.x=.08;});await page.waitForFunction(()=>document.getElementById('patientGuideInstruction').textContent.includes('Spostati un poco alla tua destra'),{},{timeout:20000});await shot('after-guide-right');
  await page.evaluate(()=>{guideTest.x=-.08;});await page.waitForFunction(()=>document.getElementById('patientGuideInstruction').textContent.includes('Spostati un poco alla tua sinistra'),{},{timeout:20000});
  await page.evaluate(()=>{guideTest.x=0;guideTest.scale=1.15;});await page.waitForFunction(()=>document.getElementById('patientGuideInstruction').textContent.includes('Allontanati'),{},{timeout:20000});
  await page.evaluate(()=>{guideTest.scale=.85;});await page.waitForFunction(()=>document.getElementById('patientGuideInstruction').textContent.includes('Avvicinati'),{},{timeout:20000});
  await page.evaluate(()=>{guideTest.scale=1;guideTest.roll=8;});await page.waitForFunction(()=>document.getElementById('patientGuideInstruction').textContent.includes('Inclina la testa verso la tua destra'),{},{timeout:20000});
  await page.evaluate(()=>{guideTest.blank=true;});await page.waitForFunction(()=>document.getElementById('patientGuideInstruction').textContent.includes('Non vedo bene'),{},{timeout:20000});assert(await page.locator('#capture').isEnabled());assert(await page.locator('#referenceContour').isVisible());
  await page.locator('#togglePatientGuidance').click();assert(await page.locator('#referenceContour').isVisible());assert(await page.locator('#capture').isEnabled());
  assert.deepEqual(errors,[]);console.log('PASS actual model on reference/live frames: stable match, left/right, distance, tilt, lost-face fallback, contour retained and shutter usable.');
 }catch(e){console.log('LAST GUIDE',await page.locator('#patientGuideInstruction').textContent());throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
