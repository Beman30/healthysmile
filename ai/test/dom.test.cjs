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
test('clarification sends reviewed rows and removals, retains price and records history on confirmation',async()=>{
 const {dom,w,writes}=await setup();try{
 w.aiRemoveTreatment('t1');w.document.getElementById('ai-ter-prezzo-t0').value='75';w.document.getElementById('ai-feedback-reason').value='Scelta del medico';w.document.getElementById('ai-additional-info').value='La carie sul 12 è confermata';
 let sent;w.fetch=async(url,opt)=>{sent=JSON.parse(opt.body);return{ok:true,json:async()=>({findings:sent.reviewed_draft.reviewed.findings,treatments:sent.reviewed_draft.reviewed.treatments})}};
 await w.aiIntegraInformazioni();assert.match(sent.trascrizione,/Integrazione del medico/);assert.equal(sent.reviewed_draft.reviewed.treatments.length,1);assert.equal(sent.reviewed_draft.ignored_suggestions[0].id_listino,'endo');assert.equal(w.document.getElementById('ai-ter-prezzo-t0').value,'75');assert.equal(writes.length,0);assert.equal(w.document.getElementById('ai-additional-info').value,'');
 await w.aiConferma();assert.equal(writes[1][1].clarification_history.length,1);assert.equal(writes[1][1].reason,'Scelta del medico');assert.equal(writes[1][1].confirmed.treatments.length,1);
 }finally{dom.window.close();}
});
test('failed clarification keeps prior draft and typed information; unapplied information blocks confirmation',async()=>{
 const {dom,w,writes}=await setup();try{w.document.getElementById('ai-additional-info').value='Nuove informazioni';w.fetch=async()=>{throw new Error('offline')};await w.aiIntegraInformazioni();assert.equal(w.document.getElementById('ai-results').style.display,'block');assert.equal(w.document.getElementById('ai-results').inert,false);assert.equal(w.document.getElementById('ai-additional-info').value,'Nuove informazioni');assert.equal(w.eval('aiProposta.rows.length'),2);await w.aiConferma();assert.equal(writes.length,0);}finally{dom.window.close();}
});
test('completion group adds correct phase 2 rows and quote only at confirmation',async()=>{
 const {dom,w,writes}=await setup();try{
 w.eval(`TR_PIANO=[{id:'impianto_osteointegrabile',label:'Impianto',prezzo:550},{id:'abutment',label:'Abutment',prezzo:190},{id:'corona_zirconio_su_impianto',label:'Corona zirconio su impianto',prezzo:700}];aiApplicaRisposta({findings:[{target:'25',description:'Assente',id_listino:''}],treatments:[{target:'25',id_listino:'impianto_osteointegrabile',label:'Impianto'}]});`);
 assert.match(w.document.getElementById('ai-dependency-suggestions').textContent,/Aggiungi tutte/);w.aiAcceptSuggestions([0,1]);assert.equal(writes.length,0);assert.equal(w.eval('aiProposta.rows.length'),3);assert.equal(w.eval('aiProposta.suggestions.length'),0);await w.aiConferma();assert.equal(w.eval('teethPiano[25].length'),3);assert.equal(w.eval('prevRows.reduce((s,r)=>s+r.prezzo*r.qta,0)'),1440);assert.equal(writes[1][1].proposed.completion_suggestions.length,2);
 }finally{dom.window.close();}
});
test('note-only teeth display a question marker and escaped readable clinical note',async()=>{
 const {dom,w}=await setup();try{w.eval(`buildSVG('odonto-attuale');teethAttuale={16:[]};teethNote={16:'Terapia da precisare <img src=x onerror=alert(1)>'};refreshOdonto('attuale');selectTooth(16,'attuale');`);assert.equal(w.document.getElementById('odonto-attuale-s-16').textContent,'?');assert.match(w.document.getElementById('popup-attuale').textContent,/Terapia da precisare/);assert.equal(w.document.getElementById('popup-attuale').querySelector('img'),null);}finally{dom.window.close();}
});
test('model exclusions suppress studio completion reminders for that tooth',async()=>{
 const {dom,w}=await setup();try{
 w.eval(`TR_PIANO=[{id:'terapia_endodontica_pluricanal',label:'Endodonzia',prezzo:290},{id:'ricostruzione_moncone_perno_in',label:'Perno in fibra',prezzo:200},{id:'corona_provvisoria_in_resina',label:'Provvisorio',prezzo:90},{id:'corona_zirconio',label:'Corona zirconio',prezzo:700}];aiApplicaRisposta({findings:[],treatments:[{target:'16',id_listino:'terapia_endodontica_pluricanal'}],excluded_suggestions:[{target:'16',id_listino:'ricostruzione_moncone_perno_in',label:'Perno in fibra',rationale:'Escluso dal medico'}]});`);
 assert.equal(w.eval('aiProposta.suggestions.length'),2);assert.equal(w.eval('aiProposta.suggestions.some(s=>s.id_listino==="ricostruzione_moncone_perno_in")'),false);
 }finally{dom.window.close();}
});
