/* AI v6: reviewed proposals, one contract, contextual correction memory. */
const AI_WORKER_STRUTTURA = 'https://odontogramma.nicolapalmia.workers.dev';
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
function aiState() { return HSClinical.copy({teethAttuale,teethNote,teethPiano,arcatePiano,arcatePianoPresta,quadrantePiano,prevRows}); }
function aiInvalidate() {
  aiProposta.request++; aiProposta.data=null; aiProposta.patientId=null; aiProposta.applied=false;
  if(aiEl('ai-results')) aiEl('ai-results').style.display='none';
  if(aiEl('ai-tx-nota')) aiEl('ai-tx-nota').value='';
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
async function aiRequest(note, audio=null, expectedPatient=currentId, expectedRequest=null) {
  if(!expectedPatient) {notify('Apri prima una cartella paziente','err');return;}
  const req=expectedRequest ?? ++aiProposta.request;
  const before=aiState();
  aiEl('ai-btn-analizza').disabled=true;
  aiEl('ai-btn-conferma').disabled=true;
  aiEl('ai-results').style.display='none';
  aiStatus('ai-st-nota','Analisi in corso…');
  try {
    const context=await aiContext();
    if(currentId!==expectedPatient || aiProposta.request!==req) return;
    // Retrieve against the full dictated text. For audio, the Worker ranks after transcription.
    if(!audio) context.correction_memory=HSClinical.relevant(context.correction_memory,note,16);
    let body,headers;
    if(audio) {
      body=new FormData(); body.append('audio',audio,'recording.'+(audio.type.includes('mp4')?'mp4':'webm'));
      body.append('note_prefix',note);
      Object.entries(context).forEach(([k,v])=>body.append(k,typeof v==='string'?v:JSON.stringify(v)));
    } else {body=JSON.stringify({...context,tipo:'nota_completa',trascrizione:note});headers={'Content-Type':'application/json'};}
    const resp=await fetch(AI_WORKER_STRUTTURA,{method:'POST',headers,body});
    const data=await resp.json();
    if(!resp.ok || data.ok===false) throw new Error(data.error || 'Risposta AI non disponibile');
    if(currentId!==expectedPatient || aiProposta.request!==req) return;
    aiProposta.patientId=expectedPatient;aiProposta.context=before;
    aiProposta.input=data.transcription_corrected || note;
    if(audio && !data._meta?.contract_version && note.trim()) {
      // Old Worker does not support prefix: re-analyse the complete accumulated dictation.
      const joined=[note,data.transcription_corrected||data.transcription_raw||''].filter(Boolean).join('\n');
      aiEl('ai-tx-nota').value=joined;
      return await aiRequest(joined,null,expectedPatient,req);
    }
    if(audio) aiEl('ai-tx-nota').value=aiProposta.input;
    aiApplicaRisposta(data);
    aiStatus('ai-st-nota','Analisi completata');
  } catch(e) { if(currentId===expectedPatient && aiProposta.request===req) {notify('Errore AI: '+e.message,'err');aiStatus('ai-st-nota','Analisi non completata');} }
  finally {if(aiProposta.request===req) aiEl('ai-btn-analizza').disabled=false;}
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
  aiProposta.suggestions=data.suggestions;aiProposta.ignoredSuggestions=[];
  aiEl('ai-orig-nota').textContent=aiProposta.input;
  aiEl('ai-results').style.display='block';
  aiEl('ai-btn-conferma').textContent='Conferma e compila odontogramma e preventivo';
  aiEl('ai-feedback-reason').value='';aiEl('ai-feedback-reuse').checked=true;
  aiRenderFindings();aiRenderTreatments();aiRenderSuggestions();
  aiEl('ai-sommario-nota').textContent=data.summary;
  const warnings=[...data.warnings,...data.issues];
  if(!data.treatments.length) warnings.push('Nessuna terapia proposta: verifica se è appropriato o aggiungi una prestazione.');
  aiEl('ai-quality-box').style.display=warnings.length?'block':'none';
  aiEl('ai-quality-box').innerHTML=warnings.length?'<div class="ai-orig-box"><strong>Da verificare</strong><ul>'+warnings.map(w=>'<li>'+aiEsc(w)+'</li>').join('')+'</ul></div>':'';
  aiStatus('ai-badge-sit','Da verificare');aiStatus('ai-badge-ter',data.treatments.length?'Da verificare':'Piano assente');
  aiEl('ai-btn-conferma').disabled=!data.findings.length&&!data.treatments.length;
  if(typeof renderAlertSuggestions==='function') renderAlertSuggestions(aiProposta.input);
  aiEl('ai-results').scrollIntoView({behavior:'smooth'});
}
function aiOptions(catalog,id,empty) {return `<option value="">${empty}</option>`+catalog.map(t=>`<option value="${aiEsc(t.id)}" ${t.id===id?'selected':''}>${aiEsc(t.label)}${t.prezzo!=null?' — €'+t.prezzo:''}</option>`).join('');}
function aiRenderFindings() {
  aiEl('ai-table-sit').innerHTML='<table class="ai-table"><thead><tr><th>Dente</th><th>Descrizione clinica (correggibile)</th><th>Stato odontogramma</th><th></th></tr></thead><tbody>'+aiProposta.findings.map(f=>`<tr id="ai-sit-row-${f.key}"><td><input id="ai-sit-num-${f.key}" value="${aiEsc(f.target)}" style="width:55px"></td><td><input id="ai-sit-desc-${f.key}" value="${aiEsc(f.description)}" style="width:100%;min-width:180px"><small>${aiEsc(f.note)}</small></td><td><select id="ai-sit-sel-${f.key}">${aiOptions(TR_ATTUALE,f.id_listino,'Solo nota clinica')}</select></td><td><button onclick="aiRemoveFinding('${f.key}')">✕</button></td></tr>`).join('')+'</tbody></table><button class="ai-btn ai-btn-outline" onclick="aiAddFinding()">+ Aggiungi rilievo clinico</button>';
}
function aiSyncFindings() {for(const f of aiProposta.findings){f.target=HSClinical.target(aiEl('ai-sit-num-'+f.key)?.value);f.description=aiEl('ai-sit-desc-'+f.key)?.value.trim()||'';f.id_listino=aiEl('ai-sit-sel-'+f.key)?.value||'';}}
function aiAddFinding(){aiSyncFindings();aiProposta.findings.push({key:'s'+Date.now(),target:'',description:'',id_listino:'',note:''});aiRenderFindings();aiEl('ai-btn-conferma').disabled=false;}
function aiRemoveFinding(k){aiSyncFindings();aiProposta.findings=aiProposta.findings.filter(f=>f.key!==k);aiRenderFindings();}
function aiSyncRows() {
  for(const t of aiProposta.rows) {
    t.target=HSClinical.target(aiEl('ai-ter-num-'+t.key)?.value);
    t.id_listino=aiEl('ai-ter-sel-'+t.key)?.value||'';
    t.status=aiEl('ai-ter-status-'+t.key)?.value||'dafare';
    t.qta=Number(aiEl('ai-ter-qta-'+t.key)?.value);t.prezzo=Number(aiEl('ai-ter-prezzo-'+t.key)?.value);
  }
}
function aiRenderTreatments() {
  aiEl('ai-table-gen').innerHTML='';
  const statusOptions=t=>['dafare','incorso','eseguito'].map((s,i)=>`<option value="${s}" ${s===t.status?'selected':''}>${['Da fare','In corso','Eseguito'][i]}</option>`).join('');
  aiEl('ai-table-ter').innerHTML='<div style="overflow-x:auto"><table class="ai-table"><thead><tr><th>Dente / sede</th><th>Proposta AI</th><th>Prestazione listino</th><th>Stato</th><th>Q.tà</th><th>€ unit.</th><th></th></tr></thead><tbody id="ai-ter-tbody">'+aiProposta.rows.map(t=>`<tr id="ai-ter-row-${t.key}" style="${t.id_listino?'':'background:var(--amber-light)'}"><td><input id="ai-ter-num-${t.key}" value="${aiEsc(t.target)}" onchange="aiChangeTarget('${t.key}',this.value)" list="ai-locations" placeholder="Generale" style="width:80px"></td><td>${aiEsc(t.label)}<small style="display:block">${aiEsc(t.diagnosis)} ${aiEsc(t.rationale)}</small></td><td><select id="ai-ter-sel-${t.key}" onchange="aiSelectTreatment('${t.key}',this.value)">${aiOptions(aiCatalog(),t.id_listino,'— seleziona o elimina la riga —')}</select>${t.id_listino?'':`<button onclick="aiApriModalNuovaPrestazione('${t.key}')">+ Nuova prestazione</button>`}</td><td><select id="ai-ter-status-${t.key}">${statusOptions(t)}</select></td><td><input id="ai-ter-qta-${t.key}" type="number" min="1" value="${t.qta}" style="width:52px"></td><td><input id="ai-ter-prezzo-${t.key}" type="number" min="0" step="0.01" value="${t.prezzo}" style="width:75px"></td><td><button onclick="aiRemoveTreatment('${t.key}')">✕</button></td></tr>`).join('')+'</tbody></table></div><p style="font-size:11px">Sede: numero del dente, AS/AI per arcata, Q1–Q4 per quadrante; vuota per prestazioni generali.</p><button class="ai-btn ai-btn-outline" onclick="aiAggiungiRigaLibera()">+ Aggiungi terapia</button>';
}
function aiChangeTarget(k,value) {
  const row=aiProposta.rows.find(t=>t.key===k);if(!row)return;
  const old=row.target;aiSyncRows();
  // All rows originally referring to the same tooth move together when still on that tooth.
  for(const t of aiProposta.rows) if(t.group===row.group && (t.key===k || t.target===old)) t.target=HSClinical.target(value);
  aiRenderTreatments();
}
function aiSelectTreatment(k,id){aiSyncRows();const t=aiProposta.rows.find(r=>r.key===k);const item=aiCatalog().find(r=>r.id===id);if(t&&item){t.prezzo=Number(item.prezzo||0);t.scope=item.scope;if(['CASE_LEVEL','SESSION_LEVEL'].includes(t.scope))t.target='';}aiRenderTreatments();}
function aiRemoveTreatment(k){aiSyncRows();aiProposta.rows=aiProposta.rows.filter(t=>t.key!==k);aiRenderTreatments();}
function aiAggiungiRigaLibera(){aiSyncRows();aiProposta.rows.push({key:'m'+Date.now(),group:'manual'+Date.now(),target:'',id_listino:'',label:'Terapia aggiunta dal medico',qta:1,prezzo:0,status:'dafare',scope:'TOOTH_LEVEL'});aiRenderTreatments();aiEl('ai-btn-conferma').disabled=false;}
function aiRenderSuggestions(){aiEl('ai-dependency-suggestions').innerHTML=(aiProposta.suggestions||[]).map((s,i)=>`<div class="ai-orig-box">${aiEsc(s.target)} ${aiEsc(s.label)} — ${aiEsc(s.rationale)} <button onclick="aiAcceptSuggestion(${i})">Aggiungi alla proposta</button> <button onclick="aiIgnoreSuggestion(${i})">Ignora</button></div>`).join('');}
function aiAcceptSuggestion(i){aiSyncRows();const s=aiProposta.suggestions.splice(i,1)[0];if(!s)return;aiProposta.rows.push({...s,key:'a'+Date.now(),group:s.target,qta:1,prezzo:Number(aiCatalog().find(t=>t.id===s.id_listino)?.prezzo||0),status:'dafare'});aiRenderTreatments();aiRenderSuggestions();}
function aiIgnoreSuggestion(i){const s=aiProposta.suggestions.splice(i,1)[0];(aiProposta.ignoredSuggestions||=[]).push(s);aiRenderSuggestions();}
function aiApriModalNuovaPrestazione(rowKey){const row=aiProposta.rows.find(t=>t.key===rowKey);_apriModalNuovaPrestazione(rowKey,row?.label||'','piano');}
function aiApriModalNuovaPrestazioneTipo(tipo){_apriModalNuovaPrestazione('','',tipo);}
function _apriModalNuovaPrestazione(rowKey,label,tipo){renderPrestazioniModal();newPrestazioneUnified();aiEl('pe-ai-rowkey').value=rowKey;const radio=document.querySelector(`input[name="pe-dest"][value="${tipo}"]`);if(radio)radio.checked=true;updatePrestDest();aiEl('pe-label').value=label;aiEl('prest-modal').classList.add('open');}
async function aiConferma() {
  if(aiProposta.saving || aiProposta.applied)return;
  if(!aiProposta.data || currentId!==aiProposta.patientId)return notify('Ripeti l’analisi nella cartella aperta','err');
  aiSyncFindings();aiSyncRows();
  const catalog=aiCatalog();
  const selection={findings:aiProposta.findings.map(({key,...f})=>f),treatments:aiProposta.rows.map(({key,group,...t})=>({...t,label:catalog.find(c=>c.id===t.id_listino)?.label||t.label}))};
  let next;
  try {next=HSClinical.apply(aiState(),selection,TR_ATTUALE,catalog,aiProposta.data.findings.map(f=>f.target));}
  catch(e){notify(e.message,'err');return;}
  const capturedId=currentId;
  const memory={doctor_id:DOCTOR_ID,created_ms:Date.now(),created_at:firebase.firestore.FieldValue.serverTimestamp(),input:aiProposta.input,
    patient_context:aiProposta.context,proposed:aiProposta.data,confirmed:selection,ignored_suggestions:aiProposta.ignoredSuggestions||[],
    reason:aiEl('ai-feedback-reason').value.trim(),reusable:aiEl('ai-feedback-reuse').checked};
  const fields={odontogramma:JSON.stringify(next.teethAttuale),note_cliniche_denti:JSON.stringify(next.teethNote),piano:JSON.stringify(next.teethPiano),arcate_piano:JSON.stringify(next.arcatePiano),arcate_piano_presta:JSON.stringify(next.arcatePianoPresta),quad_piano:JSON.stringify(next.quadrantePiano),preventivi:JSON.stringify(next.prevRows)};
  aiProposta.saving=true;aiEl('ai-results').inert=true;aiEl('ai-btn-conferma').disabled=true;aiEl('ai-btn-analizza').disabled=true;
  clearTimeout(_odSaveTimer);
  try {
    // Chart and correction are committed together: no false "learned" success on a failed write.
    const batch=db.batch();batch.set(patientsCol().doc(capturedId),fields,{merge:true});
    batch.set(aiCol('ai_corrections_v6').doc(),memory);
    _lastSaveTime=Date.now();await batch.commit();
    if(currentId===capturedId){
      ({teethAttuale,teethNote,teethPiano,arcatePiano,arcatePianoPresta,quadrantePiano,prevRows}=next);
      refreshOdonto('attuale');refreshOdonto('piano');refreshArcate('piano');refreshQuadranti();renderPianoRiepilogo();renderPrevRows();
      aiProposta.applied=true;aiEl('ai-btn-conferma').textContent='✓ Applicato e correzione memorizzata';setSyncPill('ok');
    }
    notify('Cartella aggiornata e revisione memorizzata','ok');
  } catch(e){notify('Nessuna modifica salvata: '+e.message,'err');if(currentId===capturedId)aiEl('ai-btn-conferma').disabled=false;}
  finally{aiProposta.saving=false;aiEl('ai-results').inert=false;aiEl('ai-btn-analizza').disabled=false;}
}
async function aiStartRec(){
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
