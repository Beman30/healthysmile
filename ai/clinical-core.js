/* Shared contract: browser + standalone Cloudflare Worker. No network or storage. */
(function (root) {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const text = x => typeof x === 'string' ? x.trim() : '';
  const key = x => text(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const isTooth = x => /^[1-4][1-8]$/.test(String(x));
  const target = x => {const value=String(x || '').trim().toUpperCase();return ({SUP:'AS', INF:'AI', SUPERIORE:'AS', INFERIORE:'AI','ARCATA SUPERIORE':'AS','ARCATA INFERIORE':'AI'}[value] || value);};
  const status = x => ({'da fare':'dafare','in corso':'incorso','completato':'eseguito','eseguita':'eseguito'}[x] || (['dafare','incorso','eseguito'].includes(x) ? x : 'dafare'));
  // Only explicit equivalences; ambiguous partial substrings never select a price-list item.
  const aliases = [['assente','mancante','estratto','estratto assente'],['devitalizzato','devitaliz'],['coroato','corona'],['carie','cariato']];
  function match(catalog, id, label, diagnostic = false) {
    const direct = catalog.find(t => t.id === id);
    if (direct) return direct;
    const names = [key(label), key(id)].filter(Boolean);
    let hits = catalog.filter(t => names.includes(key(t.label)) || names.includes(key(t.id)));
    if (hits.length === 1) return hits[0];
    if (diagnostic) {
      const family = aliases.find(a => a.some(n => names.includes(n)));
      if (family) hits = catalog.filter(t => family.includes(key(t.id)) || family.includes(key(t.label)));
      if (family && hits.length === 1) return hits[0];
    }
    return null;
  }
  function effectiveScope(item, location) {
    const allowed = item.allowed_scopes || [item.scope || 'TOOTH_LEVEL'];
    if (/^Q[1-4]$/.test(location) && allowed.includes('QUADRANT_LEVEL')) return 'QUADRANT_LEVEL';
    if (['AS','AI'].includes(location) && allowed.includes('ARCH_LEVEL')) return 'ARCH_LEVEL';
    return item.scope || 'TOOTH_LEVEL';
  }
  function normalize(raw, currentCatalog = [], planCatalog = []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Risposta AI non valida');
    const warnings = (raw.warnings || []).filter(x => typeof x === 'string');
    const issues = (raw.issues || raw.dubbi_da_revisionare || []).map(x => typeof x === 'string' ? x : JSON.stringify(x));
    let findings = Array.isArray(raw.findings) ? raw.findings : [];
    let treatments = Array.isArray(raw.treatments) ? raw.treatments : [];
    if (!Array.isArray(raw.findings)) {
      findings = Object.entries(raw.situazione_attuale?.denti || {}).flatMap(([tooth,d]) =>
        (Array.isArray(d.stati) ? d.stati : [d]).map(f => ({...f, target:tooth, description:f.stato || f.label || f.finding, note:f.note || f.problema})));
    }
    if (!Array.isArray(raw.treatments)) {
      treatments = Object.entries(raw.terapie_da_attuare?.denti || {}).flatMap(([tooth,d]) =>
        (Array.isArray(d.terapie) ? d.terapie : [d]).map(t => ({...t, target:tooth, label:t.label || t.stato || t.proposed_treatment})));
      treatments.push(...(raw.terapie_da_attuare?.generali || []).map(t => ({...t,target:t.target || t.dente || t.arcata || t.quadrante || '',label:t.label || t.stato})));
      if (!treatments.length && Array.isArray(raw.treatment_plan)) treatments = raw.treatment_plan.map(t => ({...t,target:t.tooth,label:t.proposed_treatment}));
    }
    findings = findings.map(f => {
      const description = text(f.description || f.stato || f.finding || f.label);
      const item = match(currentCatalog, f.id_listino, description, true);
      const loc=target(f.target || f.tooth),scope=['AS','AI'].includes(loc)||item?.scope==='ARCH_LEVEL'?'ARCH_LEVEL':f.scope || 'TOOTH_LEVEL';
      return {target:loc, description, id_listino:item?.id || '', scope, note:text(f.note || f.notes), evidence:text(f.evidence), confidence:typeof f.confidence === 'number' ? f.confidence : null,
        implant_count:f.implant_count ?? null, count_confirmed:f.count_confirmed===true, implant_targets:Array.isArray(f.implant_targets)?f.implant_targets:[],
        prosthesis_review:f.prosthesis_review===true,prosthesis_confirmed:f.prosthesis_confirmed===true};
    });
    treatments = treatments.map(t => {
      const label = text(t.label || t.stato || t.proposed_treatment);
      const item = match(planCatalog, t.id_listino, label);
      const loc = target(t.target || t.tooth || t.dente);
      const scope = item ? effectiveScope(item,loc) : t.scope || 'TOOTH_LEVEL';
      if (!item) warnings.push(`Prestazione da abbinare al listino: ${label || '(descrizione mancante)'}`);
      return {target:loc, id_listino:item?.id || '', label:label || item?.label || 'Terapia da precisare', scope,
        status:status(t.status || t.stato_esecuzione), qta:Number.isFinite(Number(t.qta ?? t.quantity)) && Number(t.qta ?? t.quantity)>0 ? Number(t.qta ?? t.quantity) : 1,
        prezzo:Number(item?.prezzo || 0), diagnosis:text(t.diagnosis), rationale:text(t.rationale || t.motivo), note:text(t.note || t.notes), evidence:text(t.evidence),
        needs_review:!!t.needs_review || !item, confidence:typeof t.confidence==='number' ? t.confidence : null};
    });
    const suggestions = (raw.suggestions || raw.suggerimenti_clinici || raw.suggerimenti_clinici_opzionali || []).map(t => {
      const item = match(planCatalog,t.id_listino,t.label || t.prestazione);
      return {target:target(t.target || t.dente),id_listino:item?.id || '',label:text(t.label || t.prestazione),scope:item?.scope || t.scope || 'TOOTH_LEVEL',rationale:text(t.rationale || t.motivo),rule_id:text(t.rule_id)};
    });
    const diary = text(typeof raw.diary === 'string' ? raw.diary : raw.diary?.text);
    const events = (Array.isArray(raw.events) ? raw.events : []).map(e=>({label:text(e.label),status:status(e.status),timing:text(e.timing),evidence:text(e.evidence)})).filter(e=>e.label);
    if (!findings.length && !treatments.length && !diary && !issues.length) issues.push('Nessun risultato clinico: precisare la nota e ripetere l’analisi.');
    findings.filter(f => f.scope==='ARCH_LEVEL'?!['AS','AI'].includes(f.target):!isTooth(f.target)).forEach(f=>issues.push(`Sede non valida: ${f.target || 'mancante'}`));
    const excluded_suggestions=(raw.excluded_suggestions||[]).map(s=>({target:target(s.target),id_listino:text(s.id_listino),label:text(s.label),rationale:text(s.rationale),rule_id:text(s.rule_id)}));
    return {version:6, findings, treatments, suggestions, excluded_suggestions, diary, events, source:text(raw.source), warnings:[...new Set(warnings)], issues:[...new Set(issues)], summary:text(raw.summary || raw.sommario || raw.terapie_da_attuare?.valutazione), transcription:text(raw.transcription_corrected || raw.transcription_raw)};
  }
  function validate(selection, currentCatalog, planCatalog) {
    const errors = [];
    for (const f of selection.findings) {
      const arch=f.scope==='ARCH_LEVEL';
      if (arch?!['AS','AI'].includes(f.target):!isTooth(f.target)) errors.push(`Sede non valida: ${f.target}`);
      if (!f.description) errors.push(`Descrizione clinica mancante sul ${f.target}`);
      if (f.id_listino && !currentCatalog.some(t=>t.id===f.id_listino)) errors.push(`Stato non presente nel listino: ${f.id_listino}`);
      const item=currentCatalog.find(t=>t.id===f.id_listino);
      if(item && (item.scope==='ARCH_LEVEL')!==arch)errors.push(`Stato non applicabile a questa sede: ${item.label}`);
      if(arch && f.id_listino && f.prosthesis_review && !f.prosthesis_confirmed)errors.push('Conferma il tipo di protesi proposto, correggilo oppure elimina la riga.');
      if(arch && f.count_confirmed && (!Number.isInteger(f.implant_count) || f.implant_count<1 || f.implant_count>16))errors.push('Conferma un numero di impianti valido (1–16).');
      const positions=f.implant_targets||[];
      if(positions.length && (!arch || !f.count_confirmed || positions.length>f.implant_count || new Set(positions).size!==positions.length || positions.some(t=>!isTooth(t) || (f.target==='AI'?!/^[34]/.test(t):!/^[12]/.test(t)))))errors.push('Le sedi degli impianti devono essere distinte, coerenti con l’arcata e con il numero confermato.');
    }
    const seen = new Set();
    for (const t of selection.treatments) {
      const item = planCatalog.find(i=>i.id===t.id_listino);
      if (!item) { errors.push(`Seleziona la prestazione per «${t.label}» oppure elimina la riga.`); continue; }
      const scope = effectiveScope(item,t.target);
      if (scope==='TOOTH_LEVEL' && !isTooth(t.target)) errors.push(`«${item.label}»: indica un dente FDI valido.`);
      if (scope==='ARCH_LEVEL' && !['AS','AI'].includes(t.target)) errors.push(`«${item.label}»: scegli AS o AI.`);
      if (scope==='QUADRANT_LEVEL' && !/^Q[1-4]$/.test(t.target)) errors.push(`«${item.label}»: scegli Q1–Q4.`);
      if (['CASE_LEVEL','SESSION_LEVEL'].includes(scope) && t.target) errors.push(`«${item.label}»: usa la sede Generale.`);
      if (!['TOOTH_LEVEL','ARCH_LEVEL','QUADRANT_LEVEL','CASE_LEVEL','SESSION_LEVEL'].includes(scope)) errors.push(`Ambito non valido per ${item.label}`);
      if (!['dafare','incorso','eseguito'].includes(t.status)) errors.push('Stato terapia non valido');
      if (!Number.isFinite(t.qta) || t.qta<=0 || !Number.isFinite(t.prezzo) || t.prezzo<0) errors.push(`Quantità o prezzo non validi: ${item.label}`);
      const sig = t.target+'|'+t.id_listino;
      if (seen.has(sig)) errors.push(`Prestazione duplicata: ${item.label} ${t.target}`);
      seen.add(sig);
    }
    return [...new Set(errors)];
  }
  function apply(state, selection, currentCatalog, planCatalog, mentioned = [], options = {}) {
    const errors = validate(selection,currentCatalog,planCatalog);
    if (errors.length) throw new Error(errors.join('\n'));
    const next = copy(state);
    for (const field of ['teethAttuale','teethNote','teethPiano','arcateAttuale','arcateAttualePresta','arcateCliniche','arcatePiano','arcatePianoPresta','quadrantePiano']) next[field] ||= {};
    next.prevRows ||= [];
    const mentionedSet = new Set([...mentioned,...selection.findings.map(f=>f.target),...selection.treatments.map(t=>t.target)]);
    const sano = match(currentCatalog,'sano','Sano',true)?.id;
    for (const f of selection.findings) {
      if(f.scope==='ARCH_LEVEL') {
        const loc=f.target==='AS'?'sup':'inf',values=next.arcateAttuale[loc] ||= [];
        if(f.id_listino && !values.includes(f.id_listino))values.push(f.id_listino);
        const facts=next.arcateCliniche[loc] ||= {};
        facts.notes=[...new Set([...(facts.notes||[]),[f.description,f.note].filter(Boolean).join(' — ')].filter(Boolean))];
        if(f.count_confirmed){facts.implant_count=f.implant_count;facts.implant_targets=copy(f.implant_targets||[]);}
        const implant=match(currentCatalog,'impianto','Impianto',true)?.id;
        if(implant && f.count_confirmed)for(const tooth of f.implant_targets||[]){const ids=next.teethAttuale[tooth] ||= [];if(!ids.includes(implant))ids.push(implant);next.teethAttuale[tooth]=ids.filter(id=>id!==sano);}
        continue;
      }
      const values = next.teethAttuale[f.target] ||= [];
      if (f.id_listino && !values.includes(f.id_listino)) values.push(f.id_listino);
      if (f.id_listino!==sano) next.teethAttuale[f.target] = values.filter(id=>id!==sano);
    }
    // Preserve all findings for a tooth in its note; do not erase earlier clinical notes.
    for (const tooth of new Set(selection.findings.filter(f=>f.scope!=='ARCH_LEVEL').map(f=>f.target))) {
      const additions = selection.findings.filter(f=>f.target===tooth).map(f=>[f.description,f.note].filter(Boolean).join(' — '));
      next.teethNote[tooth] = [...new Set([next.teethNote[tooth],...additions].filter(Boolean))].join('\n');
    }
    // Deliberate studio convention: only unmentioned, previously empty teeth default to healthy.
    if (options.defaultHealthy !== false && sano && (selection.findings.length || selection.treatments.length)) {
      for(let q=1;q<=4;q++) for(let d=1;d<=8;d++) {
        const tooth=String(q*10+d);
        if(!mentionedSet.has(tooth) && !next.teethAttuale[tooth]?.length && !next.teethNote[tooth]) next.teethAttuale[tooth]=[sano];
      }
    }
    for (const t of selection.treatments) {
      const item = planCatalog.find(i=>i.id===t.id_listino);
      const scope = effectiveScope(item,t.target);
      let map,loc=t.target;
      if(scope==='TOOTH_LEVEL') map=next.teethPiano;
      if(scope==='ARCH_LEVEL') {map=item.catalog==='arch' ? next.arcatePiano : next.arcatePianoPresta;loc=t.target==='AS'?'sup':'inf';}
      if(scope==='QUADRANT_LEVEL') {map=next.quadrantePiano;loc=t.target.toLowerCase();}
      if(map) {
        const rows=map[loc] ||= [];
        const row=rows.find(r=>(r.tid||r)===t.id_listino);
        if(row && typeof row==='object') row.stato=t.status;
        else if(!row) rows.push({tid:t.id_listino,stato:t.status});
      }
      const prev=next.prevRows.find(r=>String(r.dente||'').toUpperCase()===t.target && r.tid===t.id_listino);
      // Completed work is recorded in phase 2, never added as a new charge automatically.
      if(t.status!=='eseguito') {
        if(prev) Object.assign(prev,{qta:t.qta,prezzo:t.prezzo,scope});
        else next.prevRows.push({id:'ai_'+Date.now()+'_'+next.prevRows.length,dente:t.target,tid:t.id_listino,label:item.label,qta:t.qta,prezzo:t.prezzo,sconto:0,scope});
      }
    }
    if (text(selection.diary)) {
      next.diary ||= [];
      if (selection.visit_id && next.diary.some(d=>d.ai_visit_id===selection.visit_id)) throw new Error('Questa visita è già stata confermata.');
      next.diary.push({ts:selection.ts,author:text(selection.author)||'Medico',text:text(selection.diary),ai_visit_id:selection.visit_id||'',events:copy(selection.events||[])});
    }
    return next;
  }
  const tokens = s => new Set(key(s).split(' ').filter(x=>x.length>2));
  // Studio-requested completion checklists. They remain optional proposals, never diagnoses.
  function completionSuggestions(treatments, catalog, state = {}, preferences = [], ignored = []) {
    const rules = [
      {id:'path_implant',title:'Percorso implantare',triggers:['impianto_osteointegrabile'],ids:['abutment','corona_zirconio_su_impianto']},
      {id:'path_endodontics',title:'Percorso post-endodontico',triggers:['terapia_endodontica_monocanala','terapia_endodontica_bicanalare','terapia_endodontica_pluricanal','ritrattamento_monocanalare','ritrattamento_pluricanalare'],ids:['ricostruzione_moncone_perno_in','corona_provvisoria_in_resina','corona_zirconio']}
    ];
    const result=[];
    for (const rule of rules) {
      if (preferences.some(p=>(p.rule_id||p.id)===rule.id && p.enabled===false)) continue;
      const locations = new Set(treatments.filter(t=>rule.triggers.includes(t.id_listino) && t.status!=='eseguito' && isTooth(t.target)).map(t=>t.target));
      for (const loc of locations) for (const id of rule.ids) {
        if (treatments.some(t=>t.target===loc && t.id_listino===id) || ignored.some(t=>t.target===loc && t.id_listino===id)) continue;
        const existing=state.teethPiano?.[loc] || [];
        if (existing.some(t=>(t.tid||t)===id) || (state.prevRows||[]).some(t=>String(t.dente)===loc && t.tid===id)) continue;
        const item=catalog.find(t=>t.id===id);
        result.push({target:loc,id_listino:item?.id||'',label:item?.label||({abutment:'Abutment',corona_zirconio_su_impianto:'Corona zirconio su impianto',ricostruzione_moncone_perno_in:'Ricostruzione moncone con perno in fibra',corona_provvisoria_in_resina:'Corona provvisoria in resina',corona_zirconio:'Corona zirconio'}[id]),scope:'TOOTH_LEVEL',rule_id:rule.id,
          rationale:rule.title+' dello studio: verifica indicazione, restaurabilità e fasi già eseguite prima di aggiungere.',completion:true});
      }
    }
    return result;
  }
  function clarificationIssues(findings, treatments, state = {}) {
    const locations=new Set(findings.filter(f=>!f.id_listino && isTooth(f.target)).map(f=>f.target));
    for(const t of treatments) if(isTooth(t.target) && !findings.some(f=>f.target===t.target) && !(state.teethAttuale?.[t.target]||[]).some(id=>id!=='sano')) locations.add(t.target);
    return [...locations].map(t=>`Dente ${t}: stato dell’odontogramma non definito. Precisa il rilievo/diagnosi e se la terapia è da fare, in corso o già eseguita, oppure conserva solo la nota clinica.`);
  }
  // Local interpretation of already understood, completed procedures. No API call or diagnosis.
  function currentProposals(data, transcript, catalog) {
    const result=copy(data.findings||[]);
    const add=f=>{if(!result.some(r=>r.target===f.target && r.id_listino===f.id_listino))result.push(f);};
    const number=s=>{const m=key(s).match(/\b(\d+|uno|due|tre|quattro|cinque|sei|sette|otto)\s+(?:gommini|impianti|attacchi|locator)\b/);return m?Number(({uno:1,due:2,tre:3,quattro:4,cinque:5,sei:6,sette:7,otto:8})[m[1]]||m[1]):null;};
    for(const t of data.treatments||[]) {
      const states={impianto_osteointegrabile:'impianto',corona_zirconio:'corona',corona_zirconio_su_impianto:'corona'};
      const id=states[t.id_listino];
      if(t.status==='eseguito' && isTooth(t.target) && id && catalog.some(c=>c.id===id))add({target:t.target,id_listino:id,description:catalog.find(c=>c.id===id).label+' presente dopo la procedura eseguita',note:'Derivato dalla prestazione eseguita; verificare.',evidence:t.evidence||t.rationale,scope:'TOOTH_LEVEL'});
    }
    const events=(data.events||[]).filter(e=>e.status==='eseguito' && /ribasatur|gommin|cappett/.test(key(e.label)));
    if(!events.length)return result;
    // A single prosthesis context can link distant clauses. Multiple contexts require clarification.
    const contexts=[...String(transcript||'').matchAll(/over\s*denture[^.!?\n;]{0,100}/gi)].map(m=>{
      const before=String(transcript).slice(Math.max(0,m.index-65),m.index).split(/[.!?\n;]/).pop(),phrase=before+m[0];
      if(/\b(non ha|senza|non c e|da fare|da realizzare|da consegnare|faremo|metteremo|nuova)\b/.test(key(phrase)))return null;
      const locs=[/inferior|\binf\b/.test(key(phrase))?'AI':'',/superior|\bsup\b/.test(key(phrase))?'AS':''].filter(Boolean);
      return {quote:m[0],target:locs.length===1?locs[0]:''};
    }).filter(Boolean);
    if(!contexts.length){
      // Retentive components imply an existing attachment-supported device, not a certain subtype.
      const retained=events.filter(e=>/gommin|cappett/.test(key(e.label)) && /gommin|cappett/.test(key(e.evidence)));
      const reline=events.filter(e=>/ribasatur/.test(key(e.label)));
      if(!retained.length || !reline.length || /over\s*denture/i.test(transcript))return result;
      const quotes=[...retained,...reline].map(e=>e.evidence).filter(Boolean),source=quotes.join(' ');
      const diary=typeof data.diary==='string'?data.diary:data.diary?.text||'';
      const area=/inferior|superior/.test(key(source))?source:/protesi/.test(key(diary))?diary:'';
      const locs=[/inferior/.test(key(area))?'AI':'',/superior/.test(key(area))?'AS':''].filter(Boolean);
      if(locs.length!==1)return result;
      const loc=locs[0],counts=[...new Set(retained.map(e=>number(e.evidence)).filter(n=>n!==null))];
      add({target:loc,scope:'ARCH_LEVEL',id_listino:'overdenture',description:'Overdenture '+(loc==='AI'?'inferiore':'superiore'),note:'Tipo proposto dalla ribasatura e dai gommini ritentivi: confermare che sia effettivamente un’overdenture.',evidence:source,
        prosthesis_review:true,prosthesis_confirmed:false,implant_count:counts.length===1?counts[0]:null,count_confirmed:false,implant_targets:[]});
      return result;
    }
    const keys=new Set(contexts.map(c=>c.target));
    if(contexts.length && keys.size===1 && keys.has(''))return result; // No invented arch.
    if(keys.size!==1)return result;
    const loc=[...keys][0];
    const quotes=events.map(e=>e.evidence).filter(Boolean);
    // Do not attach maintenance of the opposite arch to this prosthesis.
    const opposite=loc==='AI'?/superior/:/inferior/;
    const bothArches=/inferior/.test(key(transcript)) && /superior/.test(key(transcript));
    const same=loc==='AI'?/inferior/:/superior/;
    const linked=quotes.filter(q=>!opposite.test(key(q)) && (!bothArches || same.test(key(q))));
    if(!linked.length)return result;
    const quote=[...contexts.map(c=>c.quote),...linked].join(' ');
    const counts=linked.map(number).filter(n=>n!==null),uniqueCounts=[...new Set(counts)];
    const count=uniqueCounts.length===1?uniqueCounts[0]:null;
    add({target:loc,scope:'ARCH_LEVEL',id_listino:'overdenture',description:'Overdenture '+(loc==='AI'?'inferiore':'superiore')+' presente',note:'Presenza ricavata dalla manutenzione eseguita sulla protesi.',evidence:quote,
      implant_count:count,count_confirmed:false,implant_targets:[]});
    return result;
  }
  function relevant(memories,note,limit=16) {
    const query=tokens(note);
    return memories.filter(m=>m.reusable!==false).map((m,i)=>{
      const words=tokens(m.input || m.stato_ai || m.trigger_label || '');
      const overlap=[...words].filter(w=>query.has(w)).length;
      return {m,i,score:overlap/Math.max(1,words.size),overlap};
    }).filter(r=>r.overlap>0).sort((a,b)=>b.score-a.score || a.i-b.i).slice(0,limit).map(r=>r.m);
  }
  root.HSClinical = {copy,key,text,isTooth,target,status,match,normalize,validate,apply,relevant,effectiveScope,completionSuggestions,clarificationIssues,currentProposals};
  if(typeof module!=='undefined' && module.exports) module.exports=root.HSClinical;
})(globalThis);
