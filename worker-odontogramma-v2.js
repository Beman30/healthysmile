// ════════════════════════════════════════════════════════════════════════════
// Worker Cloudflare — odontogramma.nicolapalmia.workers.dev  v2
// Path A: POST multipart/form-data { audio, listino_attuale?, listino_piano?, ... }
//         → Whisper + GPT-4.1 estrazione + QC → unified response
// Path B: POST application/json { tipo:'nota_completa', trascrizione, listino_*, ... }
//         → backward compat con frontend esistente → stessa risposta arricchita
// ════════════════════════════════════════════════════════════════════════════

const WHISPER_MODEL = 'whisper-1';
const REASON_MODEL  = 'gpt-4.1';
const FAST_MODEL    = 'gpt-4.1-mini';

// ─── CORS ────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
function errResp(message, status = 400, extra = {}) {
  return jsonResp({ ok: false, error: message, ...extra }, status);
}

// ─── STEP 1: Trascrizione Whisper ────────────────────────────────────────────
async function transcribeAudio(audioBlob, filename, apiKey) {
  const form = new FormData();
  form.append('file', audioBlob, filename || 'recording.webm');
  form.append('model', WHISPER_MODEL);
  form.append('language', 'it');
  form.append('response_format', 'verbose_json');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`Whisper ${resp.status}: ${(await resp.text()).slice(0,200)}`);
  const d = await resp.json();
  return { text: d.text || '', duration: d.duration || null, language: d.language || 'it' };
}

// ─── STEP 2 + 3: Estrazione clinica unificata con mapping listino ─────────────
// Questo prompt fa UNA sola chiamata e restituisce ENTRAMBI gli schemi:
// - nuovo schema ricco (current_situation, treatment_plan, warnings, quality_check)
// - vecchio schema (situazione_attuale, terapie_da_attuare) per compatibilità frontend
function buildExtractionPrompt(listinoAttuale, listinoPiano, esempiAttuale, esempiPiano, protocolli, clinicalDeps, rulePrefs) {

  const listinoAttBlock = listinoAttuale?.length
    ? listinoAttuale.map(t => `  ${t.id}: "${t.label}"`).join('\n')
    : '  (usa testo libero)';

  const listinoPianoTooth = listinoPiano?.filter(t => !t.scope || t.scope === 'TOOTH_LEVEL') || [];
  const listinoPianoArch  = listinoPiano?.filter(t => t.scope === 'ARCH_LEVEL') || [];
  const listinoPianoCase  = listinoPiano?.filter(t => t.scope === 'CASE_LEVEL') || [];
  const listinoPianoSess  = listinoPiano?.filter(t => t.scope === 'SESSION_LEVEL') || [];

  const fmtL = arr => arr.length ? arr.map(t => `  ${t.id}: "${t.label}"`).join('\n') : '  (nessuno)';

  const esempiBlock = [
    ...(esempiAttuale||[]).slice(0,10).map(e => `  [attuale] "${e.stato_ai}" → ${e.id_listino}`),
    ...(esempiPiano||[]).slice(0,10).map(e => `  [piano]   "${e.stato_ai}" → ${e.id_listino}`),
  ].join('\n');

  const protocolliBlock = (protocolli||[]).slice(0,10).map(p => {
    const v = p.varianti?.[0]; if (!v) return '';
    return `  ${p.trigger_label}: ${(v.terapie||[]).map(t=>t.label||t.id).join(' + ')}`;
  }).filter(Boolean).join('\n');

  const depsBlock = (clinicalDeps||[]).slice(0,15).map(d =>
    `  ${d.trigger_label||d.trigger_id} → suggerisci ${d.suggested_label||d.suggested_id}`
  ).join('\n');

  // Regole cliniche abilitate
  const BASE_RULES = [
    { id:'crown_temporary',        text:'Corona DEFINITIVA nel piano per un dente → suggerisci PROVVISORIO se non già presente per quel dente', enabled: true },
    { id:'provisional_definitive', text:'PROVVISORIO (o perno+provvisorio) nel piano per un dente → suggerisci CORONA DEFINITIVA se non già presente per quel dente', enabled: true },
    { id:'root_canal_reconstruction', text:'Endodonzia → suggerisci ricostruzione post-endo se assente', enabled: true },
    { id:'implant_abutment_crown', text:'Impianto → suggerisci abutment + corona se assenti', enabled: true },
    { id:'implant_tac',            text:'Caso implantare → TAC una sola volta (CASE_LEVEL), mai per dente', enabled: true },
    { id:'extraction_followup_check', text:'Estrazione → controllo post-estrattivo', enabled: false },
  ];
  const prefs = rulePrefs || [];
  const enabledRules = BASE_RULES.filter(r => {
    const p = prefs.find(x => x.rule_id === r.id);
    if (p?.enabled === false) return false;
    if (p?.enabled === true)  return true;
    return r.enabled;
  });
  const rulesBlock = enabledRules.map(r => `  [${r.id}] ${r.text}`).join('\n');

  return `Sei un assistente clinico odontoiatrico esperto.
Il dentista parla a voce libera, con pause, ripensamenti, frasi incomplete ed errori di Whisper.
Comportati come un collega odontoiatra: leggi il dettato e produci cartella clinica precisa.

════ REGOLE DI INTERPRETAZIONE ════

FDI: "undici"→11, "ventidue"→22, "due due"→22, "quattro sette"→47, "il sette"→37 o 47 (ambiguo → warning)
Superfici: mesiale, distale, occlusale, vestibolare, palatale, linguale, cervicale, MOD, MO, DO
Correzioni Whisper: "digitalizzazione"→"devitalizzazione" solo se contesto lo giustifica; "carriato"→"cariato"; "occusale"→"occlusale"
"prima classe"→ I cl., "seconda classe"→ II cl., "endo/canalare/devitalizzazione"→ terapia endodontica
Carie profonda ≠ endodonzia automatica: solo possible_treatment se il medico lo suggerisce
"potrebbe essere / forse / da valutare" → possible_treatment + needs_review:true + warning
Non inventare terapie non dette. Se incerto → confidence bassa + warning.

════ LISTINO SITUAZIONE ATTUALE ════
${listinoAttBlock}

════ LISTINO PIANO TERAPIE ════
TOOTH_LEVEL (si ripete per dente):
${fmtL(listinoPianoTooth)}

ARCH_LEVEL (una volta per arcata, non per ogni dente):
${fmtL(listinoPianoArch)}

CASE_LEVEL (una volta per caso):
${fmtL(listinoPianoCase)}

SESSION_LEVEL (una volta per seduta):
${fmtL(listinoPianoSess)}

${esempiBlock ? `════ MAPPING APPRESI ════\n${esempiBlock}` : ''}
${protocolliBlock ? `════ PROTOCOLLI STUDIO ════\n${protocolliBlock}` : ''}
${depsBlock ? `════ DIPENDENZE CLINICHE APPRESE ════\n${depsBlock}` : ''}

════ REGOLE CLINICHE ATTIVE ════
${rulesBlock || '  Nessuna regola attiva'}

REGOLE ANTI-DUPLICATO PER suggerimenti_clinici:
- Non includere MAI in suggerimenti_clinici una prestazione già presente nel piano dello stesso dente.
- "Corona provvisoria / provvisorio" e "Corona definitiva" sono prestazioni DISTINTE — non confonderle.
- Se il piano contiene PROVVISORIO ma NON corona definitiva → rule_id: provisional_definitive → suggerisci corona definitiva.
- Se il piano contiene CORONA DEFINITIVA ma NON provvisorio → rule_id: crown_temporary → suggerisci provvisorio.
- Se il piano contiene già ENTRAMBI → non suggerire nulla per quella regola.
- Se il listino contiene una voce "corona definitiva", usa il suo id_listino. Altrimenti label "Corona definitiva" + needs_review:true.

════ REGOLE SCOPE ════
TOOTH_LEVEL → "denti" con numero FDI (es.:"36") — si ripete per ogni dente
ARCH_LEVEL / CASE_LEVEL / SESSION_LEVEL → "generali" — una sola volta
TAC, bite, ablazione → generali; impianto, abutment, corona su impianto → denti

════ ISTRUZIONI OUTPUT ════
Restituisci SOLO JSON valido con esattamente questi campi.
Per ogni suggerimento_clinico includi rule_id.
confidence tra 0.0 e 1.0. needs_review:true se confidence < 0.70.

{
  "transcription_corrected": "testo corretto, [?] per parole dubbie",

  "situazione_attuale": {
    "denti": {
      "11": { "stato": "cariato", "id_listino": "cariato", "note": "" }
    }
  },

  "terapie_da_attuare": {
    "valutazione": "riassunto clinico 1-2 frasi",
    "denti": {
      "11": { "terapie": [
        { "id_listino": "otturazione_composito", "label": "Otturazione composito", "qta": 1 }
      ]}
    },
    "generali": [
      { "id_listino": "tac_cone_beam", "label": "TAC Cone Beam", "arcata": "", "scope": "CASE_LEVEL", "qta": 1 }
    ]
  },

  "suggerimenti_clinici": [
    { "rule_id": "crown_temporary", "dente": "11", "prestazione": "Provvisorio", "id_listino": "provvisorio", "motivo": "...", "scope": "TOOTH_LEVEL" }
  ],

  "current_situation": [
    { "tooth": "11", "finding": "carie mesiale", "surfaces": ["mesiale"], "status": "presente", "notes": "", "confidence": 0.95 }
  ],

  "treatment_plan": [
    { "tooth": "11", "diagnosis": "carie mesiale", "proposed_treatment": "otturazione II classe", "possible_treatment": "", "surfaces": ["mesiale"], "priority": "media", "symptoms": [], "notes": "", "status": "da fare", "confidence": 0.92, "needs_review": false }
  ],

  "quote_items": [
    { "tooth": "11", "item": "Otturazione II classe", "quantity": 1, "notes": "", "confidence": 0.92 }
  ],

  "clinical_diary_entry": "Alla visita odierna...",
  "summary": "Piano di N elementi: ...",

  "warnings": [],

  "quality_check": {
    "overall_confidence": 0.90,
    "needs_human_review": false,
    "issues": []
  },

  "learning_memory": [
    { "type": "terminology", "value": "prima classe = otturazione I cl.", "reason": "abbreviazione verbale" }
  ]
}`;
}

// ─── Chiamata AI unificata ────────────────────────────────────────────────────
async function extractAndBuild(trascrizione, context, apiKey) {
  const systemPrompt = buildExtractionPrompt(
    context.listino_attuale,
    context.listino_piano,
    context.esempi_attuale,
    context.esempi_piano,
    context.protocolli,
    context.clinical_deps,
    context.ai_rule_preferences
  );

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:           REASON_MODEL,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `Studio: ${context.studio_id||''} | Paziente: ${context.codice_paziente||''}\n\nNOTA CLINICA:\n${trascrizione.trim()}` },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${(await resp.text()).slice(0,300)}`);
  const d   = await resp.json();
  const raw = d.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(raw); } catch { throw new Error(`JSON non valido: ${raw.slice(0,300)}`); }
}

// ─── QC leggero ───────────────────────────────────────────────────────────────
async function quickQC(json, apiKey) {
  const SYSTEM_QC = `Sei un revisore di cartelle cliniche odontoiatriche. Ricevi un JSON clinico e devi fare un QC rapido.
Controlla:
1. Numeri FDI validi (11-18, 21-28, 31-38, 41-48). Fuori range → warning + confidence bassa
2. needs_review: true per tutti gli item con confidence < 0.70
3. Se overall_confidence < 0.75 → needs_human_review: true
4. Denti duplicati nel treatment_plan → uniscili
5. NON aggiungere informazioni non presenti. NON rimuovere warnings.
Restituisci il JSON completo corretto. Nessun testo extra.`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: FAST_MODEL, temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_QC },
        { role: 'user', content: JSON.stringify(json, null, 2) },
      ],
    }),
  });

  if (!resp.ok) {
    json.warnings = json.warnings || [];
    json.warnings.push('QC interno fallito — revisione manuale raccomandata');
    return json;
  }
  const d = await resp.json();
  try { return JSON.parse(d.choices?.[0]?.message?.content || '{}'); }
  catch { return json; }
}

// ─── Normalizza output finale ─────────────────────────────────────────────────
function normalize(json, transcriptionRaw) {
  const out = {
    ok:                      true,
    transcription_raw:       json.transcription_raw       || transcriptionRaw || '',
    transcription_corrected: json.transcription_corrected || transcriptionRaw || '',

    // Vecchio schema (compatibilità frontend)
    situazione_attuale:  json.situazione_attuale  || { denti: {} },
    terapie_da_attuare:  json.terapie_da_attuare  || { valutazione: '', denti: {}, generali: [] },
    suggerimenti_clinici: Array.isArray(json.suggerimenti_clinici) ? json.suggerimenti_clinici : [],
    sommario:            json.terapie_da_attuare?.valutazione || json.summary || '',

    // Nuovo schema ricco
    current_situation: Array.isArray(json.current_situation)  ? json.current_situation  : [],
    treatment_plan:    Array.isArray(json.treatment_plan)     ? json.treatment_plan     : [],
    quote_items:       Array.isArray(json.quote_items)        ? json.quote_items        : [],
    clinical_diary_entry: json.clinical_diary_entry || '',
    summary:           json.summary              || '',
    warnings:          Array.isArray(json.warnings) ? json.warnings : [],
    quality_check: {
      overall_confidence: typeof json.quality_check?.overall_confidence === 'number'
        ? json.quality_check.overall_confidence : 0.8,
      needs_human_review: json.quality_check?.needs_human_review ?? false,
      issues: Array.isArray(json.quality_check?.issues) ? json.quality_check.issues : [],
    },
    learning_memory: Array.isArray(json.learning_memory) ? json.learning_memory : [],
  };

  // Forza needs_review se confidence bassa
  out.treatment_plan = out.treatment_plan.map(i => ({
    ...i, needs_review: i.needs_review || (i.confidence != null && i.confidence < 0.70),
  }));
  if (out.treatment_plan.some(i => i.needs_review) || out.quality_check.overall_confidence < 0.75) {
    out.quality_check.needs_human_review = true;
  }

  return out;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    if (request.method !== 'POST')    return errResp('Method not allowed', 405);

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return errResp('OPENAI_API_KEY non configurata', 500);

    const contentType = request.headers.get('Content-Type') || '';

    // ══════════════════════════════════════════════════════════════
    // PATH B — JSON body (compatibilità con frontend esistente)
    //          tipo:'nota_completa' + trascrizione + listino + ...
    // ══════════════════════════════════════════════════════════════
    if (contentType.includes('application/json')) {
      let body;
      try { body = await request.json(); } catch { return errResp('JSON non valido', 400); }

      const {
        tipo = 'nota_completa', trascrizione = '',
        studio_id = 'default_studio', doctor_id = 'default_doctor',
        codice_paziente = '',
        listino_attuale = [], listino_piano = [],
        esempi_attuale = [], esempi_piano = [],
        protocolli = [], clinical_deps = [], ai_rule_preferences = []
      } = body;

      if (!trascrizione.trim()) return errResp('Trascrizione vuota', 400);

      const context = { studio_id, doctor_id, codice_paziente, listino_attuale, listino_piano, esempi_attuale, esempi_piano, protocolli, clinical_deps, ai_rule_preferences };

      let extracted;
      try { extracted = await extractAndBuild(trascrizione, context, apiKey); }
      catch (e) { return errResp(`Estrazione fallita: ${e.message}`, 502); }

      let checked;
      try { checked = await quickQC(extracted, apiKey); } catch { checked = extracted; }

      const output = normalize(checked, trascrizione);
      output._meta = { studio_id, doctor_id, codice_paziente, generated_at: new Date().toISOString() };
      return jsonResp(output);
    }

    // ══════════════════════════════════════════════════════════════
    // PATH A — FormData con audio
    // ══════════════════════════════════════════════════════════════
    let formData;
    try { formData = await request.formData(); }
    catch { return errResp('Body non è multipart/form-data valido', 400); }

    const audioField = formData.get('audio') || formData.get('file');
    if (!audioField) return errResp('Campo "audio" mancante', 400);

    const studioId      = formData.get('studio_id')      || 'default_studio';
    const doctorId      = formData.get('doctor_id')      || 'default_doctor';
    const patientId     = formData.get('patient_id')     || '';
    const codicePaz     = formData.get('codice_paziente') || '';

    // Listino e contesto opzionali
    const safeParse = (s, def) => { try { return s ? JSON.parse(s) : def; } catch { return def; } };
    const listinoAtt   = safeParse(formData.get('listino_attuale'),    []);
    const listinoPia   = safeParse(formData.get('listino_piano'),      []);
    const esempiAtt    = safeParse(formData.get('esempi_attuale'),     []);
    const esempiPia    = safeParse(formData.get('esempi_piano'),       []);
    const protocolli   = safeParse(formData.get('protocolli'),         []);
    const clinDeps     = safeParse(formData.get('clinical_deps'),      []);
    const rulePrefs    = safeParse(formData.get('ai_rule_preferences'), []);

    // Audio blob
    let audioBlob, audioFilename = 'recording.webm';
    if (typeof audioField === 'string') {
      try {
        const b64 = audioField.includes(',') ? audioField.split(',')[1] : audioField;
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        audioBlob = new Blob([bytes], { type: 'audio/webm' });
      } catch { return errResp('Campo audio non è un file valido né base64', 400); }
    } else {
      audioBlob = audioField;
      audioFilename = audioField.name || 'recording.webm';
    }
    if (!audioBlob || audioBlob.size === 0) return errResp('File audio vuoto', 400);

    // Step 1: Trascrizione
    let transcription;
    try { transcription = await transcribeAudio(audioBlob, audioFilename, apiKey); }
    catch (e) { return errResp(`Trascrizione fallita: ${e.message}`, 502); }

    if (!transcription.text?.trim() || transcription.text.trim().length < 3)
      return errResp('Trascrizione vuota o troppo breve — riprova con audio più chiaro', 400);

    // Step 2+3: Estrazione + QC
    const context = {
      studio_id: studioId, doctor_id: doctorId, codice_paziente: codicePaz,
      listino_attuale: listinoAtt, listino_piano: listinoPia,
      esempi_attuale: esempiAtt, esempi_piano: esempiPia,
      protocolli, clinical_deps: clinDeps, ai_rule_preferences: rulePrefs
    };

    let extracted;
    try { extracted = await extractAndBuild(transcription.text, context, apiKey); }
    catch (e) { return errResp(`Estrazione clinica fallita: ${e.message}`, 502, { transcription_raw: transcription.text }); }

    extracted.transcription_raw = extracted.transcription_raw || transcription.text;

    let checked;
    try { checked = await quickQC(extracted, apiKey); } catch { checked = extracted; }

    const output = normalize(checked, transcription.text);
    output._meta = {
      studio_id: studioId, doctor_id: doctorId, patient_id: patientId,
      audio_duration_sec: transcription.duration,
      whisper_language: transcription.language,
      generated_at: new Date().toISOString(),
    };

    return jsonResp(output);
  },
};
