const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.join(__dirname,'../..');
async function setup(){
 const errors=[],writes=[];const mockRef={collection(){return this},doc(){return this},where(){return this},orderBy(){return this},limit(){return this},get:async()=>({exists:false,empty:true,docs:[]}),onSnapshot(){return()=>{}},set:async()=>{}};
 let html=fs.readFileSync(path.join(root,'cartellaclinica.html'),'utf8').replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g,'');
 html=html.replace(/<\/body>\s*<\/html>\s*$/,()=>`<script>${fs.readFileSync(path.join(root,'ai/clinical-core.js'),'utf8')}</script><script>${fs.readFileSync(path.join(root,'ai/cartella-ai.js'),'utf8')}</script></body></html>`);
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://test.local/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.HTMLElement.prototype.scrollIntoView=function(){};w._fail=false;
  w.firebase={initializeApp(){},firestore:Object.assign(()=>({collection:()=>mockRef,batch:()=>{const pending=[];return{set:(...x)=>pending.push(x),commit:async()=>{if(w._fail)throw new Error('Test failure');writes.push(...pending)}}}}),{FieldValue:{serverTimestamp:()=>123,increment:x=>x}}),storage:()=>({})};
 }});
 await new Promise(r=>dom.window.addEventListener('load',()=>setTimeout(r,20)));
 const w=dom.window;

 w.eval(`currentId='synthetic';TR_ATTUALE=[{id:'sano',label:'Sano',sym:'S',color:'green'},{id:'cariato',label:'Cariato',sym:'C',color:'red'}];TR_PIANO=[{id:'restauro',label:'Restauro composito',scope:'TOOTH_LEVEL',prezzo:100},{id:'endo',label:'Endodonzia',scope:'TOOTH_LEVEL',prezzo:200}];aiProposta.patientId=currentId;aiProposta.context=aiState();aiProposta.input='carie distale 12';`);
 const proposal={ok:true,situazione_attuale:{denti:{12:{stato:'Carie distale',id_listino:'cariato'}}},terapie_da_attuare:{denti:{12:{terapie:[{id_listino:'restauro',label:'Restauro composito',qta:1},{id_listino:'endo',label:'Endodonzia',qta:1}]}}}};
 w.aiApplicaRisposta(proposal);
 return {dom,w,writes,errors};
}
test('real page handles v5 response, moves all tooth therapies and atomically saves corrected memory',async()=>{
 const {dom,w,writes,errors}=await setup();try{
 assert.equal(w.document.getElementById('ai-ter-sel-t0').value,'restauro');assert.equal(w.document.getElementById('ai-results').textContent.includes('undefined'),false);
 w.document.getElementById('ai-ter-num-t0').value='13';w.aiChangeTarget('t0','13');assert.equal(w.document.getElementById('ai-ter-num-t1').value,'13');
 w.document.getElementById('ai-feedback-reason').value='Corretto numero del dente';await w.aiConferma();
 assert.equal(writes.length,2);assert.equal(w.eval('teethPiano[13].length'),2);assert.equal(w.eval('teethPiano[12]'),undefined);assert.equal(writes[1][1].confirmed.treatments[0].target,'13');assert.equal(writes[1][1].proposed.treatments[0].target,'12');assert.equal(writes[1][1].reason,'Corretto numero del dente');assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
test('rejected rows remain absent from phase 2 and present in before/after learning event',async()=>{const {dom,w,writes}=await setup();try{w.aiRemoveTreatment('t1');await w.aiConferma();assert.equal(w.eval('teethPiano[12].length'),1);assert.equal(writes[1][1].proposed.treatments.length,2);assert.equal(writes[1][1].confirmed.treatments.length,1);}finally{dom.window.close();}});
test('failed save changes neither live chart nor memory; new prestation modal initializes creation',async()=>{const {dom,w,writes,errors}=await setup();try{w._fail=true;await w.aiConferma();assert.equal(writes.length,0);assert.equal(w.eval('teethPiano[12]'),undefined);assert.equal(w.document.getElementById('ai-btn-conferma').disabled,false);w.aiApriModalNuovaPrestazione('t0');assert.equal(w.document.getElementById('pe-idx').value,'-1');assert.equal(w.document.getElementById('pe-tipo').value,'piano');assert.equal(w.document.getElementById('prest-form').style.display,'block');assert.deepEqual(errors,[]);}finally{dom.window.close();}});
test('changing patient invalidates old proposals and clears note',async()=>{const {dom,w}=await setup();try{w.document.getElementById('ai-tx-nota').value='old';w.aiInvalidate();assert.equal(w.eval('aiProposta.data'),null);assert.equal(w.document.getElementById('ai-tx-nota').value,'');assert.equal(w.document.getElementById('ai-results').style.display,'none');}finally{dom.window.close();}});
