// ════════════════════════════════════════════════════════════════════════════
// Worker Cloudflare — odontogramma.nicolapalmia.workers.dev  v2
// Flusso: audio → trascrizione → correzione → estrazione clinica → QC → JSON
// ════════════════════════════════════════════════════════════════════════════

const WHISPER_MODEL  = 'whisper-1';
const REASON_MODEL   = 'gpt-4.1';        // ragionamento clinico
const FAST_MODEL     = 'gpt-4.1-mini';   // QC leggero

// ─────────────────────────────────────────────────────────────────────────────
// CORS helpers
// ─────────────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsResponse(body, status = 200, extra = {}) {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
        ...extra,
      },
    }
  );
}

function errResponse(message, status = 400, detail = null) {
  return corsResponse({ ok: false, error: message, detail }, status);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Trascrizione Whisper
// ─────────────────────────────────────────────────────────────────────────────
async function transcribeAudio(audioBlob, filename, apiKey) {
  const form = new FormData();
  form.append('file', audioBlob, filename || 'recording.webm');
  form.append('model', WHISPER_MODEL);
  form.append('language', 'it');
  form.append('response_format', 'verbose_json'); // include segments + confidence

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Whisper error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return {
    text: data.text || '',
    duration: data.duration || null,
    language: data.language || 'it',
    segments: data.segments || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Correzione trascrizione + estrazione clinica
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_CLINICAL = `Sei un assistente clinico odontoiatrico esperto.
Il dentista parla a voce libera, con pause, ripensamenti, frasi incomplete, errori di pronuncia e parole trascritte male da Whisper.
Comportati come un collega odontoiatra che legge il dettato e lo trasforma in cartella clinica precisa.

═══════════════════════════════════════════
REGOLE DI INTERPRETAZIONE CLINICA
═══════════════════════════════════════════

NUMERAZIONE DENTI (FDI):
- Riconosci i denti anche se espressi verbalmente: "undici"→11, "ventidue"→22, "due due"→22, "quattro sette"→47, "il sette"→37 o 47 (se ambiguo, warning)
- Arcata superiore: 11-18, 21-28. Inferiore: 31-38, 41-48
- "giudizio" o "ottavo" → dente 18/28/38/48 in base al contesto
- Se il numero è ambiguo (es. "il tredici" può essere 13 o 43), segnala con warning

SUPERFICI:
- mesiale, distale, occlusale, vestibolare, buccale, palatale, linguale, cervicale, interapprossimale
- "MOD" = mesio-occlusale-distale, "MO" = mesio-occlusale, "DO" = disto-occlusale

CORREZIONI TRASCRIZIONE:
- "digitalizzazione" → "devitalizzazione" SOLO se il contesto lo supporta (es. vicino a carie/dolore)
- "occusale" / "occlusale" / "okklusale" → "occlusale"
- "carriato" / "carietto" → "cariato"
- "impianto a carico immediato" → mantieni esatto
- "provvisorietto" → "provvisorio"
- Parole completamente fuori contesto dentale: NON interpretare, inserire in warnings
- Se una parola sembra un errore grave di Whisper, metti [?] nella trascrizione corretta e warning

INTERPRETAZIONE DIAGNOSI:
- "endo" / "devitalizzazione" / "canalare" / "terapia canalare" → terapia endodontica
- "prima classe" / "I classe" → otturazione Classe I (occlusale)
- "seconda classe" / "II classe" → otturazione Classe II (approssimale)
- "otturazione complessa" / "multisuperficie" → mantieni come otturazione complessa
- Carie profonda/grande/estesa: metti priorità alta, MA non dedurre endodonzia automaticamente → solo possible_treatment se il medico lo suggerisce
- "da estrarre" / "estratto" / "manca" → estrazione o dente assente

CLASSIFICAZIONE SITUAZIONE ATTUALE vs PIANO:
- current_situation = stato presente del dente (già esistente: otturazione, corona, impianto, carie rilevata all'esame, dente assente)
- treatment_plan = ciò che il medico propone di fare

INCERTEZZA — REGOLA FONDAMENTALE:
- Se il medico dice "potrebbe essere", "forse", "da valutare", "non sono sicuro", "vedremo" → possible_treatment + needs_review: true + warning
- Se il medico NON specifica terapia → non inventare; lascia proposed_treatment vuoto, aggiungi warning
- Se confidence < 0.7 → needs_review: true SEMPRE
- Meglio scrivere "da verificare" che inventare qualcosa di sbagliato

SINTOMI E SEGNI:
- "fa male quando mangia" / "dolore alla masticazione" → symptoms: ["dolore alla masticazione"]
- "non pulsa" / "non dà fastidio" → symptoms: ["assenza di dolore spontaneo"]
- "sensibile al freddo/caldo" → symptoms: ["sensibilità termica"]
- "gonfiore" / "fistola" → symptoms: ["gonfiore", "possibile fistola"] — warning

PRIORITÀ:
- urgente: dolore spontaneo, ascesso, frattura con esposizione pulpare
- alta: carie profonda, dolore alla masticazione, lesione periapicale sospetta
- media: carie media, vecchia otturazione da sostituire, sensibilità lieve
- bassa: igiene, controllo, piccola carie iniziale

PREVENTIVO (quote_items):
- Includi solo ciò che il medico menziona esplicitamente o che è chiaramente implicito dal piano
- Usa nomi semplici e stabili: "Otturazione I classe", "Otturazione II classe", "Devitalizzazione", "Ricostruzione", "Estrazione", "Corona", "Impianto", "Igiene", "Visita", "RX", "OPT", "TAC"
- Non aggiungere voci non citate

DIARIO CLINICO:
- Scrivi un testo fluido in prima persona plurale ("Alla visita odierna...")
- Includi: denti visitati, diagnosi, sintomi, decisioni terapeutiche
- Tono professionale, conciso, max 5-6 righe

MEMORY LEARNING:
- Segnala pattern utili per il futuro (abbreviazioni usate dal medico, termini locali, preferenze terapeutiche)
- Tipo: "abbreviation", "preference", "terminology", "protocol"

═══════════════════════════════════════════
SCHEMA JSON OBBLIGATORIO — RISPONDI SOLO CON JSON VALIDO
═══════════════════════════════════════════

{
  "ok": true,
  "transcription_raw": "testo originale Whisper",
  "transcription_corrected": "testo corretto con [?] per parole dubbie",
  "current_situation": [
    {
      "tooth": "11",
      "finding": "carie mesiale",
      "surfaces": ["mesiale"],
      "status": "presente|assente|impianto|ignoto",
      "notes": "",
      "confidence": 0.95
    }
  ],
  "treatment_plan": [
    {
      "tooth": "11",
      "diagnosis": "carie mesiale",
      "proposed_treatment": "otturazione II classe",
      "possible_treatment": "",
      "surfaces": ["mesiale"],
      "priority": "media",
      "symptoms": ["dolore alla masticazione"],
      "notes": "",
      "status": "da fare",
      "confidence": 0.92,
      "needs_review": false
    }
  ],
  "quote_items": [
    {
      "tooth": "11",
      "item": "Otturazione II classe",
      "quantity": 1,
      "notes": "",
      "confidence": 0.92
    }
  ],
  "clinical_diary_entry": "Alla visita odierna...",
  "summary": "Piano di 3 elementi: otturazione 11, valutazione 22, otturazione 26.",
  "warnings": [],
  "quality_check": {
    "overall_confidence": 0.90,
    "needs_human_review": false,
    "issues": []
  },
  "learning_memory": [
    {
      "type": "terminology",
      "value": "prima classe = otturazione I cl.",
      "reason": "medico usa abbreviazione verbale"
    }
  ]
}

REGOLE OUTPUT:
- Rispondi SOLO con JSON valido. Nessun markdown. Nessuna spiegazione fuori dal JSON.
- Se un campo non è applicabile usa stringa vuota "" o array vuoto [].
- confidence sempre tra 0.0 e 1.0
- tooth sempre come stringa: "11", "22", "AS" (arcata superiore), "AI" (arcata inferiore)
- Aggrega le informazioni dello stesso dente in un solo elemento (non duplicare lo stesso dente)
`;

async function extractClinicalData(transcriptionRaw, apiKey) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:           REASON_MODEL,
      temperature:     0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_CLINICAL },
        {
          role: 'user',
          content:
            `Trascrizione Whisper da correggere e analizzare:\n\n${transcriptionRaw}`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI extraction error ${resp.status}: ${err.slice(0, 300)}`);
  }

  const data   = await resp.json();
  const raw    = data.choices?.[0]?.message?.content || '{}';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`JSON non valido dall'AI: ${raw.slice(0, 300)}`);
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Quality Check interno
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_QC = `Sei un revisore di cartelle cliniche odontoiatriche.
Ricevi un JSON clinico generato da un AI di primo passaggio.
Devi fare un controllo qualità veloce e restituire lo STESSO JSON corretto.

CONTROLLI DA FARE:
1. Numeri FDI validi (11-18, 21-28, 31-38, 41-48). Se trovi numeri fuori range: correggili se puoi intuire il dente, altrimenti aggiungi warning e imposta confidence bassa.
2. needs_review: true per tutti gli item con confidence < 0.70
3. Se overall_confidence < 0.75 → needs_human_review: true
4. Se ci sono denti con proposed_treatment vuoto ma diagnosis presente → aggiungi al quality_check.issues
5. Se trovi duplicati dello stesso dente nel treatment_plan → uniscili
6. Non aggiungere MAI informazioni non presenti nel JSON originale
7. Non rimuovere warnings esistenti, puoi solo aggiungerne

Restituisci il JSON completo corretto. Nessun testo extra.`;

async function qualityCheck(clinicalJson, apiKey) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:           FAST_MODEL,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_QC },
        {
          role: 'user',
          content: `JSON da revisionare:\n\n${JSON.stringify(clinicalJson, null, 2)}`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    // QC fallito: restituiamo il JSON originale con warning
    clinicalJson.warnings = clinicalJson.warnings || [];
    clinicalJson.warnings.push('Quality check interno fallito — revisione manuale raccomandata');
    return clinicalJson;
  }

  const data = await resp.json();
  const raw  = data.choices?.[0]?.message?.content || '{}';

  try {
    return JSON.parse(raw);
  } catch {
    // Se il QC restituisce JSON non parsabile, usiamo l'originale
    clinicalJson.warnings = clinicalJson.warnings || [];
    clinicalJson.warnings.push('Quality check output non parsabile — usato risultato di primo passaggio');
    return clinicalJson;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Normalizza e valida output finale
// ─────────────────────────────────────────────────────────────────────────────
function normalizeOutput(json, transcriptionRaw) {
  const out = {
    ok:                      true,
    transcription_raw:       json.transcription_raw       || transcriptionRaw || '',
    transcription_corrected: json.transcription_corrected || transcriptionRaw || '',
    current_situation:       Array.isArray(json.current_situation)  ? json.current_situation  : [],
    treatment_plan:          Array.isArray(json.treatment_plan)     ? json.treatment_plan     : [],
    quote_items:             Array.isArray(json.quote_items)        ? json.quote_items        : [],
    clinical_diary_entry:    json.clinical_diary_entry || '',
    summary:                 json.summary              || '',
    warnings:                Array.isArray(json.warnings) ? json.warnings : [],
    quality_check: {
      overall_confidence: typeof json.quality_check?.overall_confidence === 'number'
        ? json.quality_check.overall_confidence : 0.8,
      needs_human_review: json.quality_check?.needs_human_review ?? false,
      issues:             Array.isArray(json.quality_check?.issues) ? json.quality_check.issues : [],
    },
    learning_memory: Array.isArray(json.learning_memory) ? json.learning_memory : [],
  };

  // Forza needs_review = true se confidence < 0.70
  out.treatment_plan = out.treatment_plan.map(item => ({
    ...item,
    needs_review: item.needs_review || (item.confidence != null && item.confidence < 0.70),
  }));

  // needs_human_review se almeno un item chiede revisione o confidence globale bassa
  if (out.treatment_plan.some(i => i.needs_review) || out.quality_check.overall_confidence < 0.75) {
    out.quality_check.needs_human_review = true;
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler principale
// ─────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return errResponse('Method not allowed', 405);
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return errResponse('OPENAI_API_KEY non configurata nel Worker', 500);
    }

    // ── Leggi form-data ──────────────────────────────────────────────────────
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return errResponse('Body non è multipart/form-data valido', 400);
    }

    // Supporta sia campo "audio" che "file" (compatibilità con vecchio frontend)
    const audioField = formData.get('audio') || formData.get('file');
    if (!audioField) {
      return errResponse('Campo "audio" mancante nel form-data', 400);
    }

    // Metadati opzionali dal frontend
    const studioId  = formData.get('studio_id')  || 'default_studio';
    const doctorId  = formData.get('doctor_id')  || 'default_doctor';
    const patientId = formData.get('patient_id') || '';

    // audioField può essere un File (Blob con name) o una stringa base64
    let audioBlob;
    let audioFilename = 'recording.webm';

    if (typeof audioField === 'string') {
      // Base64 fallback
      try {
        const b64 = audioField.includes(',') ? audioField.split(',')[1] : audioField;
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        audioBlob = new Blob([bytes], { type: 'audio/webm' });
      } catch {
        return errResponse('Campo "audio" non è un file valido né base64 valido', 400);
      }
    } else {
      audioBlob     = audioField;
      audioFilename = audioField.name || 'recording.webm';
    }

    if (!audioBlob || audioBlob.size === 0) {
      return errResponse('File audio vuoto', 400);
    }

    // ── STEP 1: Trascrizione ────────────────────────────────────────────────
    let transcription;
    try {
      transcription = await transcribeAudio(audioBlob, audioFilename, apiKey);
    } catch (e) {
      return errResponse(`Trascrizione fallita: ${e.message}`, 502);
    }

    if (!transcription.text || transcription.text.trim().length < 3) {
      return errResponse('Trascrizione troppo breve o vuota — riprova con audio più chiaro', 400);
    }

    // ── STEP 2: Estrazione clinica ─────────────────────────────────────────
    let clinicalData;
    try {
      clinicalData = await extractClinicalData(transcription.text, apiKey);
    } catch (e) {
      return errResponse(`Estrazione clinica fallita: ${e.message}`, 502, { raw: transcription.text });
    }

    // Inietta la trascrizione raw se l'AI non l'ha inclusa
    clinicalData.transcription_raw = clinicalData.transcription_raw || transcription.text;

    // ── STEP 3: Quality Check ───────────────────────────────────────────────
    let checkedData;
    try {
      checkedData = await qualityCheck(clinicalData, apiKey);
    } catch {
      checkedData = clinicalData;
    }

    // ── STEP 4: Normalizza ─────────────────────────────────────────────────
    const output = normalizeOutput(checkedData, transcription.text);

    // Aggiungi metadati di contesto (non modificano la logica clinica)
    output._meta = {
      studio_id:    studioId,
      doctor_id:    doctorId,
      patient_id:   patientId,
      audio_duration_sec: transcription.duration,
      whisper_language:   transcription.language,
      generated_at:       new Date().toISOString(),
    };

    return corsResponse(output, 200);
  },
};
