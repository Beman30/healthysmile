const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.join(__dirname,'../..');
async function setup(){
 const errors=[],writes=[];let win;
 const mockRef={collection(){return this},doc(id){return {...this,id:id||'correction'}},where(){return this},orderBy(){return this},limit(){return this},async get(){return this.id==='synthetic'?{exists:true,data:()=>win._storedPatient}:{exists:false,empty:true,docs:[]}},onSnapshot(){return()=>{}},async set(data){if(this.id==='synthetic')Object.assign(win._storedPatient,data)}};
 let html=fs.readFileSync(path.join(root,'cartellaclinica.html'),'utf8').replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g,'');
 html=html.replace(/<\/body>\s*<\/html>\s*$/,()=>`<script>${fs.readFileSync(path.join(root,'ai/clinical-core.js'),'utf8')}</script><script>${fs.readFileSync(path.join(root,'ai/cartella-ai.js'),'utf8')}</script></body></html>`);
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://test.local/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  win=w;w._storedPatient={};w.HTMLElement.prototype.scrollIntoView=function(){};w._fail=false;
  const commit=pending=>{if(w._fail)throw new Error('Test failure');writes.push(...pending);for(const [ref,data] of pending)if(ref.id==='synthetic')Object.assign(w._storedPatient,data)};
  w.firebase={initializeApp(){},firestore:Object.assign(()=>({collection:()=>mockRef,batch:()=>{const pending=[];return{set:(...x)=>pending.push(x),commit:async()=>commit(pending)}},runTransaction:async fn=>{const pending=[];await fn({get:ref=>ref.get(),set:(...x)=>pending.push(x)});commit(pending)}}),{FieldValue:{serverTimestamp:()=>123,increment:x=>x}}),storage:()=>({})};
 }});
 await new Promise(r=>dom.window.addEventListener('load',()=>setTimeout(r,20)));
 const w=dom.window;

 w.eval(`currentId='synthetic';document.getElementById('ai-engine').value='worker';aiEngineChanged();TR_ATTUALE=[{id:'sano',label:'Sano',sym:'S',color:'green'},{id:'cariato',label:'Cariato',sym:'C',color:'red'}];TR_PIANO=[{id:'restauro',label:'Restauro composito',scope:'TOOTH_LEVEL',prezzo:100},{id:'endo',label:'Endodonzia',scope:'TOOTH_LEVEL',prezzo:200}];aiProposta.patientId=currentId;aiProposta.context=aiState();aiProposta.input='carie distale 12';_storedPatient=aiFields(aiState());`);
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

async function hybridSetup(proposal, options={}) {
 const ctx=await setup(),{w}=ctx;
 w.document.getElementById('ai-engine').value='local-openai';w.aiEngineChanged();
 w.document.getElementById('ai-fictional').checked=options.fictional!==false;
 w.document.getElementById('ai-tx-nota').value='Trascrizione del caso interamente fittizio.';
 if(options.initialDiary)w.eval(`diary=${JSON.stringify(options.initialDiary)};_storedPatient=aiFields(aiState());`);
 const requests=[];
 w.fetch=async(url,opt)=>{requests.push({url,body:opt?.body?JSON.parse(opt.body):null});return{ok:true,json:async()=>url.endsWith('/version')?{release:options.release||8,provider:'openai',test_only:true}:{proposal}};};
 await w.aiAvviaAnalisi();return {...ctx,requests};
}
test('hybrid control persists draft and diary without a quote or chart changes; repeat confirmation is ignored',async()=>{
 const note='Gonfiore gengivale risolto dopo terapia riferita. Monitoraggio, senza nuove cure.';
 const {dom,w,writes,requests,errors}=await hybridSetup({diary:{text:note},findings:[],treatments:[],events:[],questions:[]},{initialDiary:[{ts:'ieri',author:'Medico',text:'Nota precedente'}]});
 try{
 assert.equal(requests.length,2);assert.equal(requests[1].body.provider,'openai');assert.ok(requests[1].body.catalog.plan.some(t=>t.id==='restauro'));
 assert.equal(requests[1].body.patient_context,undefined);assert.equal(requests[1].body.correction_memory,undefined);
 assert.ok(w._storedPatient.ai_visit_draft);assert.equal(writes.length,0);assert.equal(w.document.getElementById('ai-diary').value,note);
 assert.equal(w.document.getElementById('ai-btn-conferma').disabled,false);assert.doesNotMatch(w.document.getElementById('ai-quality-box').textContent,/Nessuna terapia/);
 await w.aiConferma();assert.equal(writes.length,2);assert.equal(JSON.parse(writes[0][1].diario).length,2);assert.equal(JSON.parse(writes[0][1].diario)[1].text,note);
 assert.equal(w.eval('prevRows.length'),0);assert.equal(w.eval('Object.keys(teethAttuale).length'),0);assert.equal(w._storedPatient.ai_visit_draft,null);
 await w.aiConferma();assert.equal(writes.length,2);assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
test('hybrid distinguishes sutures today and future reline; missing type blocks full confirmation but diary can be saved',async()=>{
 const {dom,w,writes}=await hybridSetup({diary:{text:'Rimosse le suture. Ribasatura programmata tra 7–10 giorni.'},findings:[],treatments:[{target:'',id_listino:'',label:'Ribasatura',status:'dafare'}],events:[{label:'Rimozione suture',status:'eseguito'},{label:'Ribasatura',status:'dafare',timing:'tra 7–10 giorni'}],questions:['Precisare tipo e arcata']});
 try{
 assert.match(w.document.getElementById('ai-events').textContent,/Eseguito oggi/);assert.match(w.document.getElementById('ai-events').textContent,/7–10/);
 await w.aiConferma();assert.equal(writes.length,0);await w.aiConferma(true);assert.equal(writes.length,2);assert.equal(w.eval('diary.length'),1);assert.equal(w.eval('prevRows.length'),0);
 w.eval(`TR_PIANO.push({id:'ribasatura',label:'Ribasatura diretta',scope:'ARCH_LEVEL',prezzo:180});`);
 w.aiRenderTreatments();w.document.getElementById('ai-ter-sel-t0').value='ribasatura';
 w.aiSelectTreatment('t0','ribasatura');w.aiChangeTarget('t0','AS');await w.aiConferma();
 assert.equal(writes.length,4);assert.equal(w.eval('diary.length'),1);assert.equal(w.eval('prevRows.length'),1);assert.equal(w.eval('prevRows[0].prezzo'),180);assert.equal(w.eval('arcatePianoPresta.sup[0].stato'),'dafare');assert.equal(w.eval('Object.keys(teethAttuale).length'),0);
 }finally{dom.window.close();}
});
test('hybrid completed treatment is recorded without a new charge and uses current catalog prices for future work',async()=>{
 const {dom,w,writes}=await hybridSetup({diary:{text:'Restauro eseguito sul 12. Endodonzia programmata sul 13.'},findings:[],treatments:[{target:'12',id_listino:'restauro',label:'Restauro composito',status:'eseguito',prezzo:99999},{target:'13',id_listino:'endo',label:'Endodonzia',status:'dafare',prezzo:99999}],events:[],questions:[]});
 try{assert.equal(w.document.getElementById('ai-ter-prezzo-t1').value,'200');await w.aiConferma();assert.equal(writes.length,2);assert.equal(w.eval('teethPiano[12][0].stato'),'eseguito');assert.equal(w.eval('prevRows.length'),1);assert.equal(w.eval('prevRows[0].dente'),'13');assert.equal(w.eval('prevRows[0].prezzo'),200);assert.equal(w.eval('Object.keys(teethAttuale).length'),0);}finally{dom.window.close();}
});
test('hybrid restores pending visit after opening the chart and saves clinician-edited diary',async()=>{
 const {dom,w,writes}=await hybridSetup({diary:{text:'Controllo.'},findings:[],treatments:[],events:[],questions:[]});
 try{const draft=JSON.parse(JSON.stringify(w._storedPatient.ai_visit_draft));w.aiInvalidate();w.aiRestoreDraft(draft);assert.equal(w.document.getElementById('ai-diary').value,'Controllo.');w.document.getElementById('ai-diary').value='Controllo postoperatorio. Decorso regolare.';await w.aiConferma();assert.equal(JSON.parse(writes[0][1].diario)[0].text,'Controllo postoperatorio. Decorso regolare.');}finally{dom.window.close();}
});
test('hybrid rejects another operator’s concurrent chart changes without overwriting anything',async()=>{
 const {dom,w,writes}=await hybridSetup({diary:{text:'Controllo.'},findings:[],treatments:[],events:[],questions:[]});
 try{w._storedPatient.diario=JSON.stringify([{ts:'oggi',text:'Nota altro operatore'}]);await w.aiConferma();assert.equal(writes.length,0);assert.equal(w.eval('diary.length'),0);assert.match(w.document.getElementById('notif').textContent,/modificata durante/);}finally{dom.window.close();}
});
test('hybrid failure or patient switch cannot save the result to a different chart',async()=>{
 const {dom,w,writes}=await hybridSetup({diary:{text:'Controllo.'},findings:[],treatments:[],events:[],questions:[]});
 try{w._fail=true;await w.aiConferma();assert.equal(writes.length,0);assert.equal(w.eval('diary.length'),0);assert.ok(w._storedPatient.ai_visit_draft);w._fail=false;w.eval(`currentId='another'`);await w.aiConferma();assert.equal(writes.length,0);}finally{dom.window.close();}
});
test('hybrid test guard and old bridge block before the paid API request',async()=>{
 for(const options of [{fictional:false},{release:7}]){const {dom,w,requests,writes}=await hybridSetup({diary:{text:'Controllo.'},findings:[],treatments:[],events:[]},options);try{assert.equal(requests.length,1);assert.equal(writes.length,0);assert.equal(w._storedPatient.ai_visit_draft,undefined);}finally{dom.window.close();}}
});
test('hybrid confirmed tooth findings map clinical state to the local odontogramma catalog',async()=>{
 const {dom,w,writes}=await hybridSetup({diary:{text:'Carie distale sul 12.'},findings:[{target:'12',state:'Cariato',description:'Carie distale sul 12',id_listino:''}],treatments:[],events:[],questions:[]});
 try{assert.equal(w.document.getElementById('ai-sit-sel-s0').value,'cariato');await w.aiConferma();assert.equal(writes.length,2);assert.equal(w.eval('teethAttuale[12][0]'),'cariato');assert.equal(w.eval('teethAttuale[11]'),undefined);}finally{dom.window.close();}
});
