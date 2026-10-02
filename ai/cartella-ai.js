/* Reviewed proposals: local OpenAI comprehension bridge + existing Worker. */
const AI_WORKER_STRUTTURA = 'https://odontogramma.nicolapalmia.workers.dev';
const AI_LOCAL_AGENT = 'http://127.0.0.1:8765';
const aiProposta = { data:null, patientId:null, request:0, rows:[], findings:[], saving:false, applied:false };
const AIR = {recorder:null,chunks:[],timer:null,secs:0,active:false};
function aiEl(id) { return document.getElementById(id); }
function aiEsc(x) { return String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function aiCatalog() {
  return [...TR_PIANO.map(t=>({...t,scope:t.scope||'TOOTH_LEVEL',catalog:'plan'})),
    ...ARCH_TR.filter(t=>!TR_PIANO.some(p=>p.id===t.id)).map(t=>({...t,scope:'ARCH_LEVEL',catalog:'arch'})),
    ...QUAD_TR.map(t=>({...t,scope:'QUADRANT_LEVEL',catalog:'quad'}))]
    .filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i).map(t=>({...t,allowed_scopes:[...new Set([t.scope,...(QUAD_TR.some(q=>q.id===t.id)?['QUADRANT_LEVEL']:[]),...(ARCH_TR.some(q=>q.id===t.id)?['ARCH_LEVEL']:[])])]}));
}
function aiState() { return HSClinical.copy({teethAttuale,teethNote,teethPiano,arcatePiano,arcatePianoPresta,quadrantePiano,prevRows,diary}); }
function aiEngine() {return aiEl('ai-engine')?.value || 'worker';}
function aiEngineChanged() {
  const local=aiEngine()==='local-openai';
  aiEl('ai-local-settings').style.display=local?'block':'none';
  aiEl('ai-btn-rec-nota').style.display=local?'none':'';
  aiEl('ai-btn-file').style.display=local?'':'none';
}
async function aiImportTranscript(input) {
  const file=input.files?.[0];if(!file)return;
  try {if(file.size>500000)throw new Error('File troppo lungo');aiEl('ai-tx-nota').value=await file.text();}
  catch(e){notify(e.message,'err');}finally{input.value='';}
}
function aiFields(state) {
  const keys={odontogramma:'teethAttuale',note_cliniche_denti:'teethNote',piano:'teethPiano',arcate_piano:'arcatePiano',arcate_piano_presta:'arcatePianoPresta',quad_piano:'quadrantePiano',preventivi:'prevRows',diario:'diary'};
  return Object.fromEntries(Object.entries(keys).map(([field,key])=>[field,JSON.stringify(state[key]||(['prevRows','diary'].includes(key)?[]:{}))]));
}
function aiStoredFields(doc) {
  const defaults=aiFields({});return Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,JSON.stringify(safeJson(doc[k],JSON.parse(v)))]));
}
async function aiLocalComprehension(note, audio) {
  if(audio)throw new Error('Per questo motore incolla o carica la trascrizione di Buzz.');
  let version;
  try {const r=await fetch(AI_LOCAL_AGENT+'/version');version=await r.json();if(!r.ok)throw new Error(version.error);}
  catch(e){throw new Error('Agente sul PC non disponibile. Avvia AVVIA-AGENTE.bat della versione 8.');}
  if(Number(version.release)<8)throw new Error('Scarica l’agente v8 dalla cartella clinica. Conserva i due file della configurazione API.');
  if(version.provider!=='openai')throw new Error('Configura la chiave API sul PC con CONFIGURA-API.bat.');
  const fictional=aiEl('ai-fictional').checked;
  if(version.test_only && !fictional)throw new Error('La configurazione API è per prove: usa un caso fittizio e spunta la casella.');
  const ids=['f-nome','f-cognome','f-codice','f-cf','f-telefono','f-dob','f-via'].map(gv).filter(Boolean);
  const r=await fetch(AI_LOCAL_AGENT+'/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transcript:note,provider:'openai',fictional,identifiers:ids,catalog:{plan:aiCatalog()}})});
  const result=await r.json();if(!r.ok || !result.proposal)throw new Error(result.error||'Analisi API non completata');
  return {...result.proposal,findings:(result.proposal.findings||[]).map(f=>({...f,id_listino:HSClinical.match(TR_ATTUALE,'',f.state,true)?.id||''})),source:'local-openai',issues:result.proposal.questions||[],warnings:[]};
}
function aiRestoreDraft(draft) {
  if(!draft?.proposal || !draft.input || !currentId)return;
  aiProposta.patientId=currentId;aiProposta.input=draft.input;aiProposta.context=draft.context;
  aiProposta.serverContext=draft.serverContext;aiEl('ai-tx-nota').value=draft.input;
  if(draft.proposal.source==='local-openai'){aiEl('ai-engine').value='local-openai';aiEngineChanged();}
  aiApplicaRisposta(draft.proposal);aiProposta.visitId=draft.visitId;
}
function aiInvalidate() {
  aiProposta.request++; aiProposta.data=null; aiProposta.patientId=null; aiProposta.applied=false;
  if(aiEl('ai-results')) {aiEl('ai-results').style.display='none';aiEl('ai-results').inert=false;}
  if(aiEl('ai-tx-nota')) aiEl('ai-tx-nota').value='';
  if(aiEl('ai-additional-info')) aiEl('ai-additional-info').value='';
  aiProposta.history=[];aiProposta.rulePreferences=[];
  aiProposta.serverContext=null;aiProposta.visitId=null;
  if(aiEl('ai-diary'))aiEl('ai-diary').value='';
  if(aiEl('ai-fictional'))aiEl('ai-fictional').checked=false;
  if(AIR.active) aiStopRec();
  if(aiEl('ai-btn-analizza')) aiEl('ai-btn-analizza').disabled=false;
}
function aiStatus(id,label) { const e=aiEl(id); if(e) e.textContent=label; }
async function aiContext() {
  let memories=[], legacy=[], prefs=[], protocols=[], deps=[];
  const results=await Promise.allSettled([
    aiCol('ai_corrections_v6').where('doctor_id','==',DOCTOR_ID).get(),
    aiCol('ai_mapping').get(),aiCol('ai_rule_preferences').get(),aiCol('ai_protocols').get(),aiCol('ai_clinical_deps').get()
  ]);
  if(results[0].status==='fulfilled') memories=results[0].value.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.created_ms||0)-(a.created_ms||0));
  else notify('Memoria correzioni non disponibile: questa analisi non potrà usarla.','err');
  if(results[1].status==='fulfilled') legacy=results[1].value.docs.map(d=>d.data());
  if(results[2].status==='fulfilled') prefs=results[2].value.docs.map(d=>({rule_id:d.id,...d.data()}));
  if(results[3].status==='fulfilled') protocols=results[3].value.docs.map(d=>d.data());
  if(results[4].status==='fulfilled') deps=results[4].value.docs.map(d=>d.data());
  return {protocolli:protocols,clinical_deps:deps,studio_id:STUDIO_ID,doctor_id:DOCTOR_ID,codice_paziente:gv('f-codice')||currentId,
    listino_attuale:TR_ATTUALE.map(({id,label})=>({id,label})),listino_piano:aiCatalog(),
    patient_context:{...aiState(),alerts:HSClinical.copy(alerts),note_generali:gv('f-note')},
    correction_memory:memories,esempi_attuale:legacy.filter(m=>m.tipo==='situazione_attuale'),esempi_piano:legacy.filter(m=>m.tipo==='terapie_da_attuare'),ai_rule_preferences:prefs};
}
async function aiRequest(note, audio=null, expectedPatient=currentId, expectedRequest=null, revision=null) {
  if(!expectedPatient) {notify('Apri prima una cartella paziente','err');return;}
  const req=expectedRequest ?? ++aiProposta.request;
  const before=aiState();
  aiEl('ai-btn-analizza').disabled=true;
  aiEl('ai-btn-conferma').disabled=true;
  aiEl('ai-results').style.display=revision?'block':'none';
  aiEl('ai-results').inert=!!revision;
  aiStatus('ai-st-nota','Analisi in corso…');
  try {
    const local=aiEngine()==='local-openai';
    let serverContext=null;
    if(local){const doc=await patientsCol().doc(expectedPatient).get();if(!doc.exists)throw new Error('Cartella paziente non trovata');serverContext=aiStoredFields(doc.data());}
    const context=local?{ai_rule_preferences:[]}:await aiContext();
    if(currentId!==expectedPatient || aiProposta.request!==req) return;
    if(revision) context.reviewed_draft=revision;
    // Retrieve against the full dictated text. For audio, the Worker ranks after transcription.
    if(!audio && !local) context.correction_memory=HSClinical.relevant(context.correction_memory,note,16);
    let body,headers;
    if(audio) {
      body=new FormData(); body.append('audio',audio,'recording.'+(audio.type.includes('mp4')?'mp4':'webm'));
      body.append('note_prefix',note);
      Object.entries(context).forEach(([k,v])=>body.append(k,typeof v==='string'?v:JSON.stringify(v)));
    } else {body=JSON.stringify({...context,tipo:'nota_completa',trascrizione:note});headers={'Content-Type':'application/json'};}
    let data;
    if(local)data=await aiLocalComprehension(note,audio);
    else {const resp=await fetch(AI_WORKER_STRUTTURA,{method:'POST',headers,body});data=await resp.json();if(!resp.ok || data.ok===false)throw new Error(data.error || 'Risposta AI non disponibile');}
    if(currentId!==expectedPatient || aiProposta.request!==req) return;
    const normalized=HSClinical.normalize(data,TR_ATTUALE,aiCatalog());
    const visitId=globalThis.crypto?.randomUUID?.() || 'visit_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    if(local){_lastSaveTime=Date.now();await patientsCol().doc(expectedPatient).set({ai_visit_draft:{input:note,proposal:normalized,context:before,serverContext,visitId}},{merge:true});if(currentId!==expectedPatient || aiProposta.request!==req)return;}
    aiProposta.patientId=expectedPatient;aiProposta.context=before;
    aiProposta.serverContext=serverContext;
    aiProposta.rulePreferences=context.ai_rule_preferences;
    aiProposta.history=revision?[...(aiProposta.history||[]),HSClinical.copy(revision)]:[];
    aiProposta.input=audio?(data.transcription_corrected || note):note;
    if(audio && !data._meta?.contract_version && note.trim()) {
      // Old Worker does not support prefix: re-analyse the complete accumulated dictation.
      const joined=[note,data.transcription_corrected||data.transcription_raw||''].filter(Boolean).join('\n');
      aiEl('ai-tx-nota').value=joined;
      return await aiRequest(joined,null,expectedPatient,req);
    }
    if(audio) aiEl('ai-tx-nota').value=aiProposta.input;
    aiApplicaRisposta(data);
    aiProposta.visitId=visitId;
    if(revision){
      // Prices are edited by the doctor; the model contract deliberately does not set them.
      for(const t of aiProposta.rows){const prior=revision.reviewed.treatments.find(r=>r.target===t.target && r.id_listino===t.id_listino);if(prior)t.prezzo=prior.prezzo;}
      aiProposta.ignoredSuggestions.push(...revision.ignored_suggestions);
      if(local)aiProposta.rows=aiProposta.rows.filter(t=>!revision.ignored_suggestions.some(s=>aiSuggestionKey(t)===aiSuggestionKey(s)));
      aiRenderTreatments();aiEl('ai-tx-nota').value=note;aiEl('ai-feedback-reason').value=revision.reason;aiEl('ai-feedback-reuse').checked=revision.reusable;
    }
    aiEl('ai-additional-info').value='';
    aiStatus('ai-st-nota','Analisi completata');
  } catch(e) { if(currentId===expectedPatient && aiProposta.request===req) {notify('Errore AI: '+e.message,'err');aiStatus('ai-st-nota','Analisi non completata');if(aiProposta.data && aiProposta.patientId===expectedPatient){aiEl('ai-results').style.display='block';aiEl('ai-btn-conferma').disabled=aiProposta.applied;}} }
  finally {if(aiProposta.request===req){aiEl('ai-btn-analizza').disabled=false;aiEl('ai-results').inert=false;}}
}
async function aiIntegraInformazioni(){
  if(aiProposta.saving || aiEl('ai-btn-analizza').disabled || currentId!==aiProposta.patientId)return;
  const addition=aiEl('ai-additional-info').value.trim();
  if(!addition)return notify('Aggiungi le informazioni cliniche da precisare','err');
  aiSyncFindings();aiSyncRows();
  const revision={input:aiProposta.input,proposed:aiProposta.data,reviewed:{findings:aiProposta.findings,treatments:aiProposta.rows,diary:aiEl('ai-diary').value},ignored_suggestions:aiProposta.ignoredSuggestions||[],additional_info:addition,reason:aiEl('ai-feedback-reason').value,reusable:aiEl('ai-feedback-reuse').checked};
  return aiRequest(aiProposta.input+'\n\nIntegrazione del medico:\n'+addition,null,currentId,null,revision);
}
function aiAvviaAnalisi() {
  const note=aiEl('ai-tx-nota').value.trim();
  if(!note) return notify('Scrivi o detta la problematica del paziente','err');
  if(aiProposta.saving) return;
  return aiRequest(note);
}
function aiApplicaRisposta(raw) {
  const data=HSClinical.normalize(raw,TR_ATTUALE,aiCatalog());
  aiProposta.data=HSClinical.copy(data);aiProposta.applied=false;
  aiProposta.findings=data.findings.map((f,i)=>({...f,key:'s'+i}));
  aiProposta.rows=data.treatments.map((t,i)=>({...t,key:'t'+i,group:t.target}));
  aiProposta.sourceSuggestions=data.suggestions;aiProposta.ignoredSuggestions=HSClinical.copy(data.excluded_suggestions||[]);
  aiEl('ai-orig-nota').textContent=aiProposta.input;
  aiEl('ai-results').style.display='block';
  aiProposta.visitId=globalThis.crypto?.randomUUID?.() || 'visit_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  aiEl('ai-btn-conferma').textContent='Conferma visita e aggiorna cartella';
  aiEl('ai-diary-box').style.display=data.diary?'block':'none';aiEl('ai-diary').value=data.diary;
  aiEl('ai-btn-diary').disabled=!data.diary;
  aiEl('ai-events').innerHTML=data.events.map(e=>`<div style="margin-top:6px"><strong>${aiEsc(e.label)}</strong> · ${aiEsc({eseguito:'Eseguito oggi',incorso:'In corso',dafare:'Da eseguire'}[e.status])}${e.timing?' · '+aiEsc(e.timing):''}</div>`).join('');
  aiEl('ai-feedback-reason').value='';aiEl('ai-feedback-reuse').checked=true;
  aiRenderFindings();aiRenderTreatments();aiRenderSuggestions();
  aiEl('ai-sommario-nota').textContent=data.summary;
  aiUpdateWarnings();
  aiStatus('ai-badge-sit','Da verificare');aiStatus('ai-badge-ter',data.treatments.length?'Da verificare':'Piano assente');
  aiEl('ai-btn-conferma').disabled=!data.findings.length&&!data.treatments.length&&!data.diary;
  if(typeof renderAlertSuggestions==='function') renderAlertSuggestions(aiProposta.input);
  aiEl('ai-results').scrollIntoView({behavior:'smooth'});
}
function aiOptions(catalog,id,empty) {return `<option value="">${empty}</option>`+catalog.map(t=>`<option value="${aiEsc(t.id)}" ${t.id===id?'selected':''}>${aiEsc(t.label)}${t.prezzo!=null?' — €'+t.prezzo:''}</option>`).join('');}
function aiUpdateWarnings() {
  const data=aiProposta.data;if(!data)return;
  const issues=data.source==='local-openai'?HSClinical.validate({findings:aiProposta.findings,treatments:aiProposta.rows},TR_ATTUALE,aiCatalog()):data.issues;
  const warnings=[...new Set([...HSClinical.clarificationIssues(aiProposta.findings,aiProposta.rows,aiState()),...data.warnings,...issues])];
  if(!aiProposta.rows.length && data.source!=='local-openai')warnings.push('Nessuna terapia proposta: verifica se è appropriato o aggiungi una prestazione.');
  aiEl('ai-quality-box').style.display=warnings.length?'block':'none';
  aiEl('ai-quality-box').innerHTML=warnings.length?'<div class="ai-orig-box"><strong>Da verificare</strong><ul>'+warnings.map(w=>'<li>'+aiEsc(w)+'</li>').join('')+'</ul></div>':'';
}
function aiRenderFindings() {
  aiEl('ai-table-sit').innerHTML='<table class="ai-table"><thead><tr><th>Dente</th><th>Descrizione clinica (correggibile)</th><th>Stato odontogramma</th><th></th></tr></thead><tbody>'+aiProposta.findings.map(f=>`<tr id="ai-sit-row-${f.key}" style="${f.id_listino?'':'background:var(--amber-light)'}"><td><input id="ai-sit-num-${f.key}" value="${aiEsc(f.target)}" style="width:55px"></td><td><input id="ai-sit-desc-${f.key}" value="${aiEsc(f.description)}" style="width:100%;min-width:180px"><small>${aiEsc(f.note)}</small>${f.id_listino?'':'<small style="display:block;color:#92400e">Stato da precisare: puoi aggiungere informazioni nel riquadro sopra.</small>'}</td><td><select id="ai-sit-sel-${f.key}">${aiOptions(TR_ATTUALE,f.id_listino,'Solo nota clinica')}</select></td><td><button onclick="aiRemoveFinding('${f.key}')">✕</button></td></tr>`).join('')+'</tbody></table><button class="ai-btn ai-btn-outline" onclick="aiAddFinding()">+ Aggiungi rilievo clinico</button>';
}
function aiSyncFindings() {for(const f of aiProposta.findings){f.target=HSClinical.target(aiEl('ai-sit-num-'+f.key)?.value);f.description=aiEl('ai-sit-desc-'+f.key)?.value.trim()||'';f.id_listino=aiEl('ai-sit-sel-'+f.key)?.value||'';}}
function aiAddFinding(){aiSyncFindings();aiProposta.findings.push({key:'s'+Date.now(),target:'',description:'',id_listino:'',note:''});aiRenderFindings();aiEl('ai-btn-conferma').disabled=false;}
function aiRemoveFinding(k){aiSyncFindings();aiProposta.findings=aiProposta.findings.filter(f=>f.key!==k);aiRenderFindings();}
function aiSyncRows() {
  for(const t of aiProposta.rows) {
    t.target=HSClinical.target(aiEl('ai-ter-num-'+t.key)?.value);
    t.id_listino=aiEl('ai-ter-sel-'+t.key)?.value||'';
    t.label=aiCatalog().find(c=>c.id===t.id_listino)?.label||t.label;
    t.status=aiEl('ai-ter-status-'+t.key)?.value||'dafare';
    t.qta=Number(aiEl('ai-ter-qta-'+t.key)?.value);t.prezzo=Number(aiEl('ai-ter-prezzo-'+t.key)?.value);
  }
}
function aiRenderTreatments() {
  aiEl('ai-table-gen').innerHTML='';
  const statusOptions=t=>['dafare','incorso','eseguito'].map((s,i)=>`<option value="${s}" ${s===t.status?'selected':''}>${['Da fare','In corso','Eseguito'][i]}</option>`).join('');
  aiEl('ai-table-ter').innerHTML='<div style="overflow-x:auto"><table class="ai-table"><thead><tr><th>Dente / sede</th><th>Proposta AI</th><th>Prestazione listino</th><th>Stato</th><th>Q.tà</th><th>€ unit.</th><th></th></tr></thead><tbody id="ai-ter-tbody">'+aiProposta.rows.map(t=>`<tr id="ai-ter-row-${t.key}" style="${t.id_listino?'':'background:var(--amber-light)'}"><td><input id="ai-ter-num-${t.key}" value="${aiEsc(t.target)}" onchange="aiChangeTarget('${t.key}',this.value)" list="ai-locations" placeholder="Generale" style="width:80px"></td><td>${aiEsc(t.label)}<small style="display:block">${aiEsc(t.diagnosis)} ${aiEsc(t.rationale)}</small></td><td><select id="ai-ter-sel-${t.key}" onchange="aiSelectTreatment('${t.key}',this.value)">${aiOptions(aiCatalog(),t.id_listino,'— seleziona o elimina la riga —')}</select>${t.id_listino?'':`<button onclick="aiApriModalNuovaPrestazione('${t.key}')">+ Nuova prestazione</button>`}</td><td><select id="ai-ter-status-${t.key}">${statusOptions(t)}</select></td><td><input id="ai-ter-qta-${t.key}" type="number" min="1" value="${t.qta}" style="width:52px"></td><td><input id="ai-ter-prezzo-${t.key}" type="number" min="0" step="0.01" value="${t.prezzo}" style="width:75px"></td><td><button onclick="aiRemoveTreatment('${t.key}')">✕</button></td></tr>`).join('')+'</tbody></table></div><p style="font-size:11px">Sede: numero del dente, AS/AI per arcata, Q1–Q4 per quadrante; vuota per prestazioni generali.</p><button class="ai-btn ai-btn-outline" onclick="aiAggiungiRigaLibera()">+ Aggiungi terapia</button>';
  for(const t of aiProposta.rows)aiEl('ai-ter-status-'+t.key).onchange=()=>{aiSyncRows();aiRenderSuggestions();};
  aiRenderSuggestions();
  aiUpdateWarnings();
}
function aiChangeTarget(k,value) {
  const row=aiProposta.rows.find(t=>t.key===k);if(!row)return;
  const old=row.target;aiSyncRows();
  // All rows originally referring to the same tooth move together when still on that tooth.
  for(const t of aiProposta.rows) if(t.group===row.group && (t.key===k || t.target===old)) t.target=HSClinical.target(value);
  aiRenderTreatments();
}
function aiSelectTreatment(k,id){aiSyncRows();const t=aiProposta.rows.find(r=>r.key===k);const item=aiCatalog().find(r=>r.id===id);if(t&&item){t.prezzo=Number(item.prezzo||0);t.scope=item.scope;if(['CASE_LEVEL','SESSION_LEVEL'].includes(t.scope))t.target='';}aiRenderTreatments();}
function aiRemoveTreatment(k){aiSyncRows();const removed=aiProposta.rows.find(t=>t.key===k);if(removed)aiProposta.ignoredSuggestions.push(HSClinical.copy(removed));aiProposta.rows=aiProposta.rows.filter(t=>t.key!==k);aiRenderTreatments();}
function aiAggiungiRigaLibera(){aiSyncRows();aiProposta.rows.push({key:'m'+Date.now(),group:'manual'+Date.now(),target:'',id_listino:'',label:'Terapia aggiunta dal medico',qta:1,prezzo:0,status:'dafare',scope:'TOOTH_LEVEL'});aiRenderTreatments();aiEl('ai-btn-conferma').disabled=false;}
function aiSuggestionKey(s){return s.target+'|'+(s.id_listino||HSClinical.key(s.label));}
function aiRenderSuggestions(){
  const completion=HSClinical.completionSuggestions(aiProposta.rows,aiCatalog(),aiState(),aiProposta.rulePreferences||[],aiProposta.ignoredSuggestions||[]);
  const used=new Set([...aiProposta.rows,...(aiProposta.ignoredSuggestions||[])].map(aiSuggestionKey));
  aiProposta.suggestions=[...completion,...(aiProposta.sourceSuggestions||[])].filter(s=>{const k=aiSuggestionKey(s);if(used.has(k))return false;used.add(k);return true;});
  if(aiProposta.data){const seen=new Set((aiProposta.data.completion_suggestions||[]).map(aiSuggestionKey));aiProposta.data.completion_suggestions=[...(aiProposta.data.completion_suggestions||[]),...HSClinical.copy(completion.filter(s=>!seen.has(aiSuggestionKey(s))))];}
  const groups=new Map();
  aiProposta.suggestions.forEach((s,i)=>{const key=s.completion?s.rule_id+'|'+s.target:'single'+i;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({s,i});});
  aiEl('ai-dependency-suggestions').innerHTML=[...groups.values()].map(items=>{
    const first=items[0].s,indices=items.map(x=>x.i);
    return `<div class="ai-orig-box"><strong>Dente ${aiEsc(first.target)||'—'} · ${first.completion?'Completa il percorso terapeutico':'Suggerimento da valutare'}</strong><p>${aiEsc(first.rationale)}</p>`+items.map(({s,i})=>`<div style="margin:8px 0">${aiEsc(s.label)} ${s.id_listino?'':'(da abbinare al listino)'} <button class="ai-btn ai-btn-outline" onclick="aiAcceptSuggestion(${i})">Aggiungi</button> <button class="ai-btn ai-btn-outline" onclick="aiIgnoreSuggestion(${i})">Escludi</button></div>`).join('')+(items.length>1?`<button class="ai-btn ai-btn-primary" onclick="aiAcceptSuggestions([${indices.join(',')}])">Aggiungi tutte le fasi proposte</button>`:'')+'</div>';
  }).join('');
}
function aiAcceptSuggestions(indices){
  aiSyncRows();const selected=indices.map(i=>aiProposta.suggestions[i]).filter(Boolean);
  for(const s of selected)if(!aiProposta.rows.some(t=>aiSuggestionKey(t)===aiSuggestionKey(s)))aiProposta.rows.push({...s,key:'a'+Date.now()+'_'+aiProposta.rows.length,group:s.target,qta:1,prezzo:Number(aiCatalog().find(t=>t.id===s.id_listino)?.prezzo||0),status:'dafare'});
  aiRenderTreatments();if(selected.length)aiEl('ai-btn-conferma').disabled=false;
}
function aiAcceptSuggestion(i){aiAcceptSuggestions([i]);}
function aiIgnoreSuggestion(i){const s=aiProposta.suggestions[i];if(s)(aiProposta.ignoredSuggestions||=[]).push(s);aiRenderSuggestions();}
function aiApriModalNuovaPrestazione(rowKey){const row=aiProposta.rows.find(t=>t.key===rowKey);_apriModalNuovaPrestazione(rowKey,row?.label||'','piano');}
function aiApriModalNuovaPrestazioneTipo(tipo){_apriModalNuovaPrestazione('','',tipo);}
function _apriModalNuovaPrestazione(rowKey,label,tipo){renderPrestazioniModal();newPrestazioneUnified();aiEl('pe-ai-rowkey').value=rowKey;const radio=document.querySelector(`input[name="pe-dest"][value="${tipo}"]`);if(radio)radio.checked=true;updatePrestDest();aiEl('pe-label').value=label;aiEl('prest-modal').classList.add('open');}
async function aiConferma(diaryOnly=false) {
  if(aiProposta.saving || aiProposta.applied)return;
  if(aiEl('ai-additional-info').value.trim())return notify('Premi «Integra e aggiorna la proposta» per usare le informazioni aggiunte, oppure svuota il campo.','err');
  if(!aiProposta.data || currentId!==aiProposta.patientId)return notify('Ripeti l’analisi nella cartella aperta','err');
  if(aiEl('ai-tx-nota').value.trim() && aiEl('ai-tx-nota').value.trim()!==aiProposta.input.trim())return notify('La trascrizione è cambiata: ripeti l’analisi prima di confermare.','err');
  aiSyncFindings();aiSyncRows();
  const diaryText=aiEl('ai-diary').value.trim();if(diaryOnly && !diaryText)return;
  const catalog=aiCatalog();
  const selection={findings:diaryOnly?[]:aiProposta.findings.map(({key,...f})=>f),treatments:diaryOnly?[]:aiProposta.rows.map(({key,group,...t})=>({...t,label:catalog.find(c=>c.id===t.id_listino)?.label||t.label})),diary:diaryText,events:aiProposta.data.events||[],visit_id:aiProposta.visitId,ts:new Date().toLocaleString('it-IT',{dateStyle:'short',timeStyle:'short'}),author:gv('f-op')||'Medico'};
  if(!selection.findings.length && !selection.treatments.length && !diaryText)return;
  const before=aiState(),local=aiProposta.data.source==='local-openai';
  let next;
  try {next=HSClinical.apply(before,selection,TR_ATTUALE,catalog,aiProposta.data.findings.map(f=>f.target),{defaultHealthy:!local});}
  catch(e){notify(e.message,'err');return;}
  const capturedId=currentId;
  const memory={doctor_id:DOCTOR_ID,created_ms:Date.now(),created_at:firebase.firestore.FieldValue.serverTimestamp(),input:aiProposta.input,
    patient_context:aiProposta.context,proposed:aiProposta.data,confirmed:selection,ignored_suggestions:aiProposta.ignoredSuggestions||[],
    reason:aiEl('ai-feedback-reason').value.trim(),reusable:aiEl('ai-feedback-reuse').checked,clarification_history:aiProposta.history||[]};
  const remaining={...aiProposta.data,diary:'',findings:HSClinical.copy(aiProposta.findings),treatments:HSClinical.copy(aiProposta.rows)};
  const hasRemaining=diaryOnly&&(remaining.findings.length||remaining.treatments.length);
  const fields={...aiFields(next),ai_visit_draft:hasRemaining?{input:aiProposta.input,proposal:remaining,context:next,serverContext:aiFields(next),visitId:aiProposta.visitId}:null};
  aiProposta.saving=true;aiEl('ai-results').inert=true;aiEl('ai-btn-conferma').disabled=true;aiEl('ai-btn-analizza').disabled=true;
  clearTimeout(_odSaveTimer);
  try {
    // Chart and correction are committed together: no false "learned" success on a failed write.
    _lastSaveTime=Date.now();
    if(local){
      const patientRef=patientsCol().doc(capturedId),memoryRef=aiCol('ai_corrections_v6').doc(aiProposta.visitId+(diaryOnly?'_diary':'_all'));
      await db.runTransaction(async tx=>{
        const saved=await tx.get(patientRef),prior=await tx.get(memoryRef);
        if(!saved.exists)throw new Error('Cartella paziente non trovata');
        if(prior.exists)throw new Error('Questa conferma è già stata salvata. Riapri la cartella.');
        const remote=aiStoredFields(saved.data()),initial=aiProposta.serverContext,live=aiFields(before);
        if(!initial || !Object.keys(live).every(k=>remote[k]===initial[k] || remote[k]===live[k]))throw new Error('La cartella è stata modificata durante l’analisi. Riaprila e ripeti l’analisi.');
        tx.set(patientRef,fields,{merge:true});tx.set(memoryRef,memory);
      });
    }else{const batch=db.batch();batch.set(patientsCol().doc(capturedId),fields,{merge:true});batch.set(aiCol('ai_corrections_v6').doc(),memory);await batch.commit();}
    if(currentId===capturedId){
      ({teethAttuale,teethNote,teethPiano,arcatePiano,arcatePianoPresta,quadrantePiano,prevRows,diary}=next);renderDiary();
      refreshOdonto('attuale');refreshOdonto('piano');refreshArcate('piano');refreshQuadranti();renderPianoRiepilogo();renderPrevRows();
      aiProposta.applied=!hasRemaining;aiEl('ai-btn-conferma').textContent=hasRemaining?'Conferma le prestazioni rimanenti':'✓ Visita confermata';setSyncPill('ok');
      aiProposta.serverContext=aiFields(next);aiEl('ai-btn-diary').disabled=true;
      if(diaryOnly)aiEl('ai-diary').value='';
      aiEl('ai-btn-conferma').disabled=!hasRemaining;
    }
    notify('Cartella aggiornata e revisione memorizzata','ok');
  } catch(e){notify('Nessuna modifica salvata: '+e.message,'err');if(currentId===capturedId)aiEl('ai-btn-conferma').disabled=false;}
  finally{aiProposta.saving=false;aiEl('ai-results').inert=false;aiEl('ai-btn-analizza').disabled=false;}
}
async function aiStartRec(){
  if(aiEngine()==='local-openai')return notify('Incolla o carica la trascrizione di Buzz.','err');
  if(AIR.active || aiProposta.saving || aiEl('ai-btn-analizza').disabled || !currentId)return;
  const patient=currentId,req=++aiProposta.request;
  try {
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(currentId!==patient || req!==aiProposta.request){stream.getTracks().forEach(t=>t.stop());return;}
    const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    const rec=new MediaRecorder(stream,mime?{mimeType:mime}:{});AIR.recorder=rec;AIR.chunks=[];AIR.secs=0;
    rec.ondataavailable=e=>{if(e.data.size)AIR.chunks.push(e.data);};
    rec.onstop=()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(AIR.timer);AIR.active=false;aiEl('ai-btn-rec-nota').style.display='';aiEl('ai-btn-stop-nota').style.display='none';if(currentId!==patient||req!==aiProposta.request)return;const blob=new Blob(AIR.chunks,{type:rec.mimeType});if(blob.size)aiRequest(aiEl('ai-tx-nota').value.trim(),blob,patient,req);};
    rec.start(200);AIR.active=true;aiEl('ai-btn-rec-nota').style.display='none';aiEl('ai-btn-stop-nota').style.display='';aiStatus('ai-st-nota','In registrazione');
    AIR.timer=setInterval(()=>{AIR.secs++;aiStatus('ai-tm-nota',AIR.secs+' s');},1000);
  }catch(e){notify('Microfono non disponibile: '+e.message,'err');}
}
function aiStopRec(){if(AIR.recorder?.state==='recording')AIR.recorder.stop();}
aiEngineChanged();
