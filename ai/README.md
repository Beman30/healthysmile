# Cartella clinica — AI v6

La nota clinica produce una proposta di rilievi e terapie, revisionata dal medico prima della scrittura. I denti non menzionati e senza dati precedenti rimangono sani per convenzione dello studio.

## Componenti

- `clinical-core.js`: formato condiviso, abbinamenti esatti, validazione e aggiornamento del piano/preventivo.
- `cartella-ai.js`: UI, contesto della cartella, conferma e memoria delle revisioni.
- `worker-entry.js`: dettatura, proposta GPT-4.1 e controllo GPT-4.1-mini. Il controllo segnala problemi senza riscrivere la proposta.
- `odontogramma-v6.mjs`: Worker completo, generato da `node ai/build-worker.mjs`; non richiede import o dipendenze su Cloudflare.

## Attivazione

1. Pubblicare `cartellaclinica.html` e la cartella `ai` sul sito. La nuova pagina legge anche le risposte del Worker v5 (`label` o `stato`).
2. In Cloudflare → Workers & Pages → `odontogramma` → Edit code, sostituire il modulo con tutto il contenuto di `odontogramma-v6.mjs`, quindi Deploy. Conservare il secret esistente `OPENAI_API_KEY` e l'URL del Worker.
3. Ricaricare la cartella clinica e provare su una cartella fittizia la nota «carie distale 12». Verificare proposta, abbinamento con il listino reale, correzione, fase 2 e memoria. I test automatici non verificano la correttezza clinica del modello vivo.
4. Verificare che le regole Firestore già usate dallo studio consentano al medesimo operatore autorizzato di leggere/scrivere `studios/{studio}/ai_corrections_v6`. Non allargare l'accesso pubblico. In assenza del permesso la conferma fallisce esplicitamente e non modifica la cartella.

## Memoria

Ogni conferma salva in un unico batch Firestore la cartella e la revisione: nota, contesto clinico iniziale, proposta, versione confermata, eliminazioni deducibili dal confronto, suggerimenti ignorati e motivo facoltativo. Il medico può escludere un caso dal riuso mantenendolo registrato. Le revisioni sono separate per studio/medico e vengono recuperate per pertinenza lessicale (fino a 16 per analisi), con precedenza temporale per casi equivalenti; non sono un riaddestramento del modello né una garanzia di generalizzazione clinica. Le memorie precedenti non vengono eliminate.

Il client legge la memoria dello studio/medico, poi seleziona gli esempi pertinenti. In dettatura audio il Worker seleziona dopo la trascrizione. Per archivi molto grandi sostituire la lettura completa con un indice di ricerca mantenendo le stesse regole di accesso. Non vengono inviate anagrafica, documenti o immagini; la nota e le note cliniche libere possono naturalmente contenere quanto inserito dal medico.

## Verifiche

Da `ai`: `npm install`, poi `npm test`. I test API/Firebase usano simulazioni: non consumano API e non leggono/scrivono pazienti reali. `npm run build` rigenera il Worker standalone.

Copertura: incompatibilità `label/stato`, ID inesistenti, ambiguità, più rilievi/terapie per dente, convenzione sano, arcate/quadranti, stato eseguito, preventivi senza duplicati, memoria contestuale, risposta troncata, QC fallito, dettatura cumulativa e pagina completa con DOM simulato.

Per il rollback ripristinare i file dal commit precedente in GitHub e ripristinare la versione precedente del Worker dalla cronologia Cloudflare. I documenti della memoria v6 possono rimanere: non modificano il funzionamento del v5.
