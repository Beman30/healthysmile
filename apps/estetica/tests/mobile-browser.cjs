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
   if(url.pathname.startsWith('/api/')){
    const chunks=[];for await(const c of req)chunks.push(c);
    const r=await api(new Request(url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),env,{studioId:'browser-test'});
    res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;
   }
   const f=path.resolve('public','.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!f.startsWith(path.resolve('public')+path.sep)){res.writeHead(403).end();return;}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));
  }catch(e){res.writeHead(500).end(String(e));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const errors=[];
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,permissions:['camera']});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 page.setDefaultTimeout(10000);
 const visible=async selector=>{await page.locator(selector).waitFor({state:'visible'});};
 const noOverflow=async selector=>{assert(await page.locator(selector).evaluate(e=>e.scrollWidth<=e.clientWidth+2),'horizontal overflow: '+selector+' at '+JSON.stringify(page.viewportSize()));};
 const inViewport=async selector=>{await visible(selector);const b=await page.locator(selector).boundingBox(),v=page.viewportSize();assert(b&&b.x>=0&&b.y>=0&&b.x+b.width<=v.width+1&&b.y+b.height<=v.height+1,'outside viewport: '+selector);};
 const previewReachable=async()=>{await page.waitForFunction(()=>{const r=document.getElementById('cameraArea').getBoundingClientRect(),top=document.querySelector('.topbar').getBoundingClientRect().bottom,bottom=document.getElementById('captureDock').getBoundingClientRect().top;return r.top>=top-1&&r.bottom<=bottom+1;});};
 const menu=async()=>{await page.locator('#menuToggle').click();await visible('#appMenu');await noOverflow('#appMenu');};
 const shot=async name=>{if(process.env.UI_SCREENSHOTS){fs.mkdirSync(process.env.UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.UI_SCREENSHOTS,name+'.png')});}};
 try{
  await page.goto(base);await visible('#patientDialog');await noOverflow('#patientDialog');
  await page.locator('.new-patient summary').click();await page.locator('#newPatientName').fill('Paziente dimostrativo con nome lungo');await page.locator('#newPatientCode').fill('MOBILE-TEST');await page.locator('#createPatient').click();
  await page.locator('#patientDialog').waitFor({state:'hidden'});
  await shot('mobile-home');await noOverflow('html');
  await menu();await shot('mobile-menu');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('menuToggle').getAttribute('aria-expanded')==='false');
  assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'false');
  assert(await page.locator('#menuToggle').evaluate(e=>e===document.activeElement),'focus returns to Menu');
  await menu();await page.locator('#menuNotes').click();await page.locator('#patientNotes').fill('Nota mobile\nSeconda riga');
  assert(await page.locator('body').evaluate(e=>e.classList.contains('editing-field')));
  assert.equal(await page.locator('#captureDock').isVisible(),false,'dock does not cover keyboard');
  await page.locator('#patientNotesPanel summary').click();await page.locator('#cloudStatus').filter({hasText:'Salvato nel cloud'}).waitFor();
  await menu();await page.locator('#menuVisit').click();await visible('#visitDialog');await noOverflow('#visitDialog');await page.locator('#treatment').fill('Visita di prova');await page.locator('#closeVisit').click();
  await menu();await page.locator('#settingsButton').click();await visible('#stationDialog');await page.locator('#closeSettings').click();
  await page.locator('#dockStart').click();await page.waitForFunction(()=>!document.getElementById('capture').disabled);
  await inViewport('#capture');await shot('mobile-camera');
  await page.locator('#capture').click();await visible('#accept');await inViewport('#accept');await shot('mobile-confirm');await page.locator('#accept').click();
  await page.locator('#cloudStatus').filter({hasText:'Salvato nel cloud'}).waitFor();
  await page.locator('#tabAfter').click();await page.waitForFunction(()=>!document.getElementById('capture').disabled);
  await page.locator('#capture').click();await page.locator('#accept').click();
  await page.locator('#cloudStatus').filter({hasText:'Salvato nel cloud'}).waitFor();
  await page.locator('#tabCompare').click();await page.locator('.wipe-box').waitFor();await noOverflow('html');
  for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:768,height:1024},{width:1280,height:800}]){
   await page.setViewportSize(size);await noOverflow('html');
   for(const layout of ['slider','two','half','grid']){await page.locator(`[data-layout="${layout}"]`).click();await noOverflow('html');}
   await page.locator('[data-layout="slider"]').click();
   await page.locator('#comparisonAdjustments summary').click();await page.locator('#afterBrightness').fill('12');await page.locator('#afterBrightness').dispatchEvent('change');
   assert.equal(await page.locator('#brightnessValue').textContent(),'+12%');await page.locator('#resetBrightness').click();await page.locator('#comparisonAdjustments summary').click();
   await page.locator('#pdfCompare').click();await visible('#pdfDialog');await noOverflow('#pdfDialog');await page.locator('#cancelPdf').click();
   await page.locator('#comparisonAdjustments summary').click();await page.locator('#alignFaces').click();await visible('#alignmentDialog');await noOverflow('#alignmentDialog');await page.locator('#cancelAlignment').click();await page.locator('#comparisonAdjustments summary').click();
   await page.locator('#patientMode').click();await inViewport('#exitPatientMode');await shot(`presentation-${size.width}`);await page.locator('#exitPatientMode').click();
   await page.locator('#compareFullscreen').click();await inViewport('#compareFullscreen');await shot(`fullscreen-${size.width}`);await page.locator('#compareFullscreen').click();
   await menu();await page.locator('#menuVisit').click();await noOverflow('#visitDialog');await page.locator('#closeVisit').click();
   await page.locator('#patientPicker').click();await noOverflow('#patientDialog');await page.locator('#closePatients').click();
   await page.locator('#tabBefore').click();await page.locator('#startCamera').click();await page.waitForFunction(()=>!document.getElementById('capture').disabled);
   if(size.width<=900)await inViewport('#capture');
   await page.locator('#capture').click();if(size.width<=900)await inViewport('#accept');await page.locator('#retake').click();
   if(size.width<=900)await previewReachable();
   await noOverflow('html');await shot(`capture-${size.width}`);
   await page.locator('#tabCompare').click();
  }
  // Import from the comparison menu must return to a visible capture/review view.
  await page.setViewportSize({width:390,height:844});await menu();
  const chooser=page.waitForEvent('filechooser');await page.locator('#importCurrent').click();await chooser;
  assert.equal(await page.locator('main').isVisible(),true);
  assert.deepEqual(errors,[]);console.log('PASS: responsive capture/review, menu, notes, visits, dialogs, all comparison layouts, brightness and presentation at five viewport sizes.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
