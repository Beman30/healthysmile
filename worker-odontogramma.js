// ════════════════════════════════════════════════════════════════════════════
// Worker Cloudflare — odontogramma.nicolapalmia.workers.dev
// Analisi nota clinica vocale con GPT-4.1-mini
// Versione: multi-studio con ai_rule_preferences
// ════════════════════════════════════════════════════════════════════════════

const OPENAI_MODEL = 'gpt-4.1-mini';

// ── Regole cliniche base ─────────────────────────────────────────────────────
const BASE_CLINICAL_RULES = [
  {
    id: 'crown_temporary',
    text: 'Corona definitiva → suggerisci provvisorio se assente nel piano per lo stesso dente',
    defaultEnabled: true,
    strength: 'strong'
  },
  {
    id: 'root_canal_reconstruction',
    text: 'Terapia canalare / devitalizzazione / ritrattamento canalare → suggerisci ricostruzione post-endodontica e/o perno moncone se assenti per lo stesso dente',
    defaultEnabled: true,
    strength: 'medium'
  },
  {
    id: 'implant_abutment_crown',
    text: 'Impianto osteointegrato → suggerisci abutment + corona su impianto se assenti per lo stesso dente',
    defaultEnabled: true,
    strength: 'strong'
  },
  {
    id: 'implant_tac',
    text: 'Caso implantare (uno o più impianti) → suggerisci TAC cone beam UNA SOLA VOLTA per il caso, mai per ogni singolo dente (scope: CASE_LEVEL)',
    defaultEnabled: true,
    strength: 'strong'
  },
  {
    id: 'extraction_followup_check',
    text: 'Estrazione / avulsione → suggerisci controllo post-estrattivo se previsto dalle preferenze dello studio',
    defaultEnabled: false,
    strength: 'soft'
  }
];

// ── Filtra regole in base alle preferenze studio ─────────────────────────────
function getEnabledClinicalRules(preferences = []) {
  return BASE_CLINICAL_RULES.filter(rule => {
    const pref = preferences.find(p => p.rule_id === rule.id);
    if (pref && pref.enabled === false) return false;
    if (pref && pref.enabled === true)  return true;
    return rule.defaultEnabled;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// buildSystemPrompt
// ════════════════════════════════════════════════════════════════════════════
function buildSystemPrompt(
  tipo,
  listino,
  esempi,
  listino_attuale,
  listino_piano,
  esempi_attuale,
  esempi_piano,
  protocolli = [],
  clinical_deps = [],
  ai_rule_preferences = []
) {

  // ── Sezione protocolli appresi ──────────────────────────────────────────
  let protocolliBlock = '';
  if (protocolli.length > 0) {
    protocolliBlock = `
PROTOCOLLI TERAPEUTICI APPRESI (preferenze dello studio — usa come guida):
${protocolli.slice(0, 20).map(p => {
  const variante = p.varianti?.[0];
  if (!variante) return '';
  const terapie = (variante.terapie || []).map(t => t.label || t.id).join(' + ');
  return `- ${p.trigger_label || p.trigger_id}: ${terapie} (confermato ${variante.count || 1}x)`;
}).filter(Boolean).join('\n')}
`;
  }

  // ── Sezione dipendenze cliniche apprese ─────────────────────────────────
  let clinicalDepsBlock = '';
  if (clinical_deps.length > 0) {
    clinicalDepsBlock = `
DIPENDENZE CLINICHE APPRESE (aggiunte dal medico in passato):
${clinical_deps.slice(0, 30).map(d =>
  `- ${d.trigger_label || d.trigger_id} → suggerisci ${d.suggested_label || d.suggested_id} (${d.count || 1}x)`
).join('\n')}
`;
  }

  // ── Regole cliniche abilitate per questo studio ─────────────────────────
  const enabledRules = getEnabledClinicalRules(ai_rule_preferences);
  const clinicalRulesBlock = enabledRules.length > 0
    ? enabledRules.map(r => `- [${r.id}] ${r.text}`).join('\n')
    : '- Nessun suggerimento clinico automatico attivo per questo studio.';

  // ── Listini per scope ───────────────────────────────────────────────────
  const listinoAttualeBlock = listino_attuale?.length
    ? listino_attuale.map(t => `  ${t.id}: "${t.label}"`).join('\n')
    : (listino?.length ? listino.map(t => `  ${t.id}: "${t.label}"`).join('\n') : '  (nessuna voce)');

  const listinoPianoTooth = listino_piano?.filter(t => !t.scope || t.scope === 'TOOTH_LEVEL') || [];
  const listinoPianoArch  = listino_piano?.filter(t => t.scope === 'ARCH_LEVEL') || [];
  const listinoPianoCase  = listino_piano?.filter(t => t.scope === 'CASE_LEVEL') || [];
  const listinoPianoSess  = listino_piano?.filter(t => t.scope === 'SESSION_LEVEL') || [];

  const fmtListino = arr => arr.length
    ? arr.map(t => `  ${t.id}: "${t.label}"`).join('\n')
    : '  (nessuna voce)';

  // ── Esempi mapping ──────────────────────────────────────────────────────
  const esempiAttualeBlock = esempi_attuale?.length
    ? esempi_attuale.slice(0, 15).map(e =>
        `  "${e.stato_ai}" → ${e.id_listino} "${e.label_listino}" (${e.count || 1}x)`
      ).join('\n')
    : '';

  const esempiPianoBlock = esempi_piano?.length
    ? esempi_piano.slice(0, 15).map(e =>
        `  "${e.stato_ai}" → ${e.id_listino} "${e.label_listino}" (${e.count || 1}x)`
      ).join('\n')
    : '';

  // ════════════════════════════════════════════════════════════════════════
  // PROMPT NOTA_COMPLETA
  // ════════════════════════════════════════════════════════════════════════
  if (tipo === 'nota_completa') {
    return `Sei un assistente per studi dentistici italiani. Analizzi la nota clinica vocale del dentista e restituisci JSON strutturato.

LISTINO SITUAZIONE ATTUALE (per identificare lo stato del dente):
${listinoAttualeBlock}
${esempiAttualeBlock ? `\nMAPPING APPRESI (situazione attuale):\n${esempiAttualeBlock}` : ''}

LISTINO PIANO TERAPIE — TOOTH_LEVEL (ripetuto per ogni dente coinvolto):
${fmtListino(listinoPianoTooth)}

LISTINO PIANO TERAPIE — ARCH_LEVEL (una sola volta per arcata, mai per ogni dente):
${fmtListino(listinoPianoArch)}

LISTINO PIANO TERAPIE — CASE_LEVEL (una sola volta per caso clinico):
${fmtListino(listinoPianoCase)}

LISTINO PIANO TERAPIE — SESSION_LEVEL (una sola volta per seduta):
${fmtListino(listinoPianoSess)}
${esempiPianoBlock ? `\nMAPPING APPRESI (piano terapie):\n${esempiPianoBlock}` : ''}
${protocolliBlock}${clinicalDepsBlock}

════════════════════════════════════════════════════════════
REGOLE FONDAMENTALI SCOPE:
════════════════════════════════════════════════════════════

TOOTH_LEVEL → va in "denti" con il numero FDI del dente (es. dente 36, 46, 11...)
  ✅ si ripete per ogni dente: otturazione, corona, impianto, abutment, devitalizzazione, estrazione...
  ❌ NON mettere in denti: TAC, bite, ablazione, bonifica arcata, protesi totale, rialzo seno

ARCH_LEVEL → va in "generali" con arcata (AS=superiore, AI=inferiore) — UNA VOLTA
  ✅ bonifica_arcata, grande_rialzo_seno_mascellare, rialzo_seno_mascellare, protesi_totale_definitiva
  ✅ se hai impianti sia in 36 che in 46 → abutment e corona vanno ENTRAMBI in "denti" (uno per 36, uno per 46)
  ❌ abutment e corona NON vanno in "generali" (sono TOOTH_LEVEL, si ripetono per ogni dente)

CASE_LEVEL → va in "generali" senza arcata — UNA SOLA VOLTA per tutto il caso
  ✅ tac_cone_beam, tac_3d, bite, consulenza_specialistica
  ❌ la TAC non va per ogni dente implantare — va UNA VOLTA in "generali"

SESSION_LEVEL → va in "generali" — UNA VOLTA per seduta
  ✅ ablazione, levigature_radicolari, ablazione_pediatrica

════════════════════════════════════════════════════════════
ESEMPIO CORRETTO (caso con 2 impianti: dente 36 e dente 46):
════════════════════════════════════════════════════════════
{
  "denti": {
    "36": { "terapie": [
      {"id_listino": "impianto_osteointegrabile", "label": "Impianto osteointegrato"},
      {"id_listino": "abutment", "label": "Abutment"},
      {"id_listino": "corona_zirconio_su_impianto", "label": "Corona su impianto"}
    ]},
    "46": { "terapie": [
      {"id_listino": "impianto_osteointegrabile", "label": "Impianto osteointegrato"},
      {"id_listino": "abutment", "label": "Abutment"},
      {"id_listino": "corona_zirconio_su_impianto", "label": "Corona su impianto"}
    ]}
  },
  "generali": [
    {"id_listino": "tac_cone_beam", "label": "TAC Cone Beam", "arcata": "", "scope": "CASE_LEVEL"}
  ]
}
❌ SBAGLIATO: mettere TAC in "denti" → la TAC va in "generali" UNA VOLTA
❌ SBAGLIATO: mettere abutment/corona in "generali" → vanno in "denti" per ogni dente

════════════════════════════════════════════════════════════
SUGGERIMENTI CLINICI ABILITATI PER QUESTO STUDIO:
════════════════════════════════════════════════════════════
${clinicalRulesBlock}

Per ogni suggerimento clinico restituisci SEMPRE anche il campo "rule_id" con l'id della regola.
Esempio suggerimento:
{
  "rule_id": "crown_temporary",
  "dente": "16",
  "prestazione": "Provvisorio",
  "id_listino": "provvisorio",
  "motivo": "Corona definitiva pianificata: valutare provvisorio per protezione e test estetico",
  "scope": "TOOTH_LEVEL"
}
Se il suggerimento è CASE_LEVEL (es. TAC) il campo "dente" deve essere vuoto "".

════════════════════════════════════════════════════════════
FORMATO RISPOSTA JSON:
════════════════════════════════════════════════════════════
Restituisci SOLO JSON valido, senza markdown, senza spiegazioni.

{
  "situazione_attuale": {
    "denti": {
      "11": { "stato": "cariato", "id_listino": "carie", "note": "" },
      "36": { "stato": "mancante", "id_listino": "dente_mancante", "note": "" }
    }
  },
  "terapie_da_attuare": {
    "valutazione": "Breve riassunto clinico del caso (1-2 frasi)",
    "denti": {
      "11": { "terapie": [
        { "id_listino": "otturazione_composito", "label": "Otturazione in composito", "qta": 1 }
      ]},
      "36": { "terapie": [
        { "id_listino": "impianto_osteointegrabile", "label": "Impianto osteointegrato", "qta": 1 },
        { "id_listino": "abutment", "label": "Abutment", "qta": 1 },
        { "id_listino": "corona_zirconio_su_impianto", "label": "Corona su impianto", "qta": 1 }
      ]}
    },
    "generali": [
      { "id_listino": "tac_cone_beam", "label": "TAC Cone Beam", "arcata": "", "scope": "CASE_LEVEL", "qta": 1 }
    ]
  },
  "suggerimenti_clinici": [
    {
      "rule_id": "crown_temporary",
      "dente": "16",
      "prestazione": "Provvisorio",
      "id_listino": "provvisorio",
      "motivo": "Corona definitiva: valutare provvisorio",
      "scope": "TOOTH_LEVEL"
    }
  ]
}

REGOLE FINALI:
- Usa SOLO id_listino presenti nel listino fornito. Se non trovi corrispondenza usa id_listino: "".
- I numeri dente sono FDI (11-18, 21-28, 31-38, 41-48).
- Non inventare prestazioni non presenti nel listino.
- Sii proattivo nei suggerimenti_clinici: meglio suggerire e sbagliare che non suggerire.
- Se il medico dice "arcata" senza specificare il numero dente → usa "generali" con arcata AS o AI.
- temperature: 0 — sii deterministico e coerente.`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PROMPT SITUAZIONE_ATTUALE (legacy, mantenuto per compatibilità)
  // ════════════════════════════════════════════════════════════════════════
  if (tipo === 'situazione_attuale') {
    return `Sei un assistente per studi dentistici italiani. Analizza la nota clinica e restituisci SOLO JSON.

LISTINO STATI DENTE DISPONIBILI:
${listinoAttualeBlock}
${esempiAttualeBlock ? `\nMAPPING APPRESI:\n${esempiAttualeBlock}` : ''}

Formato risposta:
{
  "denti": {
    "11": { "stato": "descrizione breve", "id_listino": "id_dal_listino", "note": "" }
  }
}
Usa SOLO id_listino dal listino. Numeri dente FDI (11-48). Solo JSON.`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PROMPT PIANO_TERAPIE (legacy)
  // ════════════════════════════════════════════════════════════════════════
  if (tipo === 'piano_terapie') {
    return `Sei un assistente per studi dentistici italiani. Analizza la nota e restituisci SOLO JSON.

LISTINO PIANO TERAPIE — TOOTH_LEVEL:
${fmtListino(listinoPianoTooth)}

LISTINO PIANO TERAPIE — ARCH_LEVEL / CASE_LEVEL / SESSION_LEVEL:
${fmtListino([...listinoPianoArch, ...listinoPianoCase, ...listinoPianoSess])}
${esempiPianoBlock ? `\nMAPPING APPRESI:\n${esempiPianoBlock}` : ''}

Formato risposta:
{
  "denti": {
    "36": { "terapie": [{ "id_listino": "id", "label": "label", "qta": 1 }] }
  },
  "generali": [
    { "id_listino": "id", "label": "label", "arcata": "AS|AI|", "scope": "ARCH_LEVEL|CASE_LEVEL|SESSION_LEVEL", "qta": 1 }
  ]
}
Usa ONLY id dal listino. Numeri FDI. Solo JSON.`;
  }

  return 'Sei un assistente odontoiatrico. Rispondi in JSON.';
}

// ════════════════════════════════════════════════════════════════════════════
// Handler principale
// ════════════════════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Body JSON non valido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const {
      tipo                = 'nota_completa',
      trascrizione        = '',
      studio_id           = 'default_studio',
      doctor_id           = 'default_doctor',
      codice_paziente     = '',
      listino             = [],
      esempi              = [],
      listino_attuale     = [],
      listino_piano       = [],
      esempi_attuale      = [],
      esempi_piano        = [],
      protocolli          = [],
      clinical_deps       = [],
      ai_rule_preferences = []
    } = body;

    if (!trascrizione || trascrizione.trim().length < 3) {
      return new Response(JSON.stringify({ error: 'Trascrizione vuota o troppo breve' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const systemPrompt = buildSystemPrompt(
      tipo,
      listino,
      esempi,
      listino_attuale,
      listino_piano,
      esempi_attuale,
      esempi_piano,
      protocolli,
      clinical_deps,
      ai_rule_preferences
    );

    const userMessage = tipo === 'nota_completa'
      ? `Studio: ${studio_id} | Paziente: ${codice_paziente || 'N/D'}\n\nNOTA CLINICA:\n${trascrizione.trim()}`
      : trascrizione.trim();

    try {
      const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userMessage }
          ]
        })
      });

      if (!openaiResp.ok) {
        const errText = await openaiResp.text();
        console.error('OpenAI error:', openaiResp.status, errText);
        return new Response(JSON.stringify({ error: `OpenAI error ${openaiResp.status}` }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const openaiData = await openaiResp.json();
      const content = openaiData.choices?.[0]?.message?.content || '{}';

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        console.error('JSON parse error:', content);
        return new Response(JSON.stringify({ error: 'Risposta AI non parsabile', raw: content }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Normalizza risposta nota_completa
      if (tipo === 'nota_completa') {
        const out = {
          situazione_attuale: parsed.situazione_attuale || { denti: {} },
          terapie_da_attuare: {
            valutazione: parsed.terapie_da_attuare?.valutazione || '',
            denti:       parsed.terapie_da_attuare?.denti    || {},
            generali:    parsed.terapie_da_attuare?.generali || []
          },
          suggerimenti_clinici: parsed.suggerimenti_clinici || []
        };
        return new Response(JSON.stringify(out), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      return new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

    } catch (err) {
      console.error('Worker error:', err);
      return new Response(JSON.stringify({ error: err.message || 'Errore interno' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
