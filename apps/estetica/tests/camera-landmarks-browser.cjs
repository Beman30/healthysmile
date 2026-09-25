/* Optional real-browser regression: install Playwright + Chromium, then run
 * node tests/mobile-browser.cjs. PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE can
 * point to an existing local installation. All records/photos are synthetic.
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
  await page.addInitScript(()=>{window.cameraRequests=[];const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=c=>{window.cameraRequests.push(c);return gum(c)};});
  await page.goto(base);await visible('#patientDialog');await page.locator('.new-patient summary').click();await page.locator('#newPatientName').fill('Test reperi');await page.locator('#newPatientCode').fill('TEST-REPERI');await page.locator('#createPatient').click();await page.locator('#patientDialog').waitFor({state:'hidden'}).catch(async e=>{console.log(await page.locator('#patientDialog').innerText());throw e});
  if(process.env.FACE_TEST_IMAGE){const measurement=await page.evaluate(async()=>{const im=new Image();im.src='/test-portrait.jpg';await im.decode();const bm=await createImageBitmap(im);const w=new Worker('/patient-guidance-worker.js');return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{w.terminate();reject(Error('model timeout'))},60000);w.onmessage=({data})=>{clearTimeout(timer);w.terminate();resolve(data)};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message))};w.postMessage({id:1,bitmap:bm},[bm])});});assert(measurement.face&&!measurement.face.error,'real face model must initialize and detect');}
  await inViewport('#cameraFacing');await page.locator('#cameraFacing').selectOption('user');await page.locator('#dockStart').click();await page.waitForFunction(()=>!document.getElementById('capture').disabled);assert.equal(await page.evaluate(()=>cameraRequests.at(-1).video.facingMode.ideal),'user');
  await page.locator('#cameraFacing').selectOption('environment');await page.waitForFunction(()=>!document.getElementById('cameraFacing').disabled);assert.equal(await page.evaluate(()=>cameraRequests.at(-1).video.facingMode.ideal),'environment');await inViewport('#capture');await page.waitForFunction(()=>document.getElementById('patientGuideInstruction').textContent.includes('Non vedo bene il viso'),{},{timeout:60000});assert(await page.locator('#capture').isEnabled());await shot('mobile-patient-guide');
  await page.locator('#capture').click();await visible('#accept');assert(await page.locator('#cameraFacing').isDisabled());await page.locator('#accept').click();await page.locator('#cloudStatus').filter({hasText:'Salvato nel cloud'}).waitFor();
  await page.locator('#tabAfter').click();await page.waitForFunction(()=>!document.getElementById('capture').disabled);await page.locator('#capture').click();await page.locator('#accept').click();await page.locator('#cloudStatus').filter({hasText:'Salvato nel cloud'}).waitFor();
  await page.locator('#tabCompare').click();await page.locator('#comparisonAdjustments summary').click();await page.locator('#alignFaces').click();await visible('#alignmentDialog');await page.locator('#addAlignmentPoint').click();assert.equal(await page.locator('#alignmentPointSelect option').count(),3);
  for(const id of ['alignBeforeCanvas','alignAfterCanvas'])for(let i=0;i<3;i++){
   await page.locator('#alignmentPointSelect').selectOption(String(i));const r=await page.locator('#'+id).boundingBox();await page.locator('#'+id).click({position:{x:r.width*[.3,.65,.5][i],y:r.height*[.35,.35,.6][i]}});await visible('#alignmentPointDialog');assert((await page.locator('#alignmentPointTitle').textContent()).includes('reperto '+(i+1)));await page.locator('#confirmAlignmentPoint').click();
  }
  assert(await page.locator('#applyAlignment').isEnabled());await noOverflow('#alignmentDialog');await page.locator('#addAlignmentPoint').click();assert(await page.locator('#applyAlignment').isDisabled());await page.locator('#removeAlignmentPoint').click();assert(await page.locator('#applyAlignment').isEnabled());await page.locator('#applyAlignment').click();await page.locator('#alignmentDialog').waitFor({state:'hidden'});await page.locator('#cloudStatus').filter({hasText:'Salvato nel cloud'}).waitFor();
  await page.locator('#alignFaces').click();assert.equal(await page.locator('#alignmentPointSelect option').count(),3);assert.equal(await page.locator('#alignBeforeCount').textContent(),'3 / 3 reperi');await page.locator('#cancelAlignment').click();
  assert.deepEqual(errors,[]);console.log('PASS mobile front/rear selection, capture/review, 3 paired landmarks with magnifier, add/remove, persistence and reopening.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
