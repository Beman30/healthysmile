# Cartella clinica — comprensione API e compilazione locale v8

## Integrazione v8

La sezione AI della cartella esistente ora offre «OpenAI API + agente sul PC». Usa il bridge della demo con supporto al sito `healthysmile.it`/`www.healthysmile.it`, al listino corrente della cartella e ai rilievi attuali con dente esplicito. Il listino resta sul PC; l'API riceve solo le frasi minimizzate. Il motore precedente rimane selezionabile e il Worker esistente non richiede un aggiornamento per questa modalità.

La trascrizione si incolla da Buzz o si carica da un file `.txt`; l'invio automatico da Buzz non è implementato. Il diario è modificabile e può essere confermato da solo se una prestazione richiede ancora tipo o sede. Le attività senza voce commerciale rimangono nel diario/eventi. Solo prestazioni future risolte e confermate entrano nel preventivo; quelle eseguite aggiornano il piano senza nuovi addebiti. Nella modalità API un controllo non riempie i denti non valutati con lo stato Sano.

La bozza è conservata come `ai_visit_draft` nel documento del paziente e ripristinata alla riapertura. La conferma API salva diario, odontogramma, piano, preventivo e revisione in una transazione Firestore; verifiche sul paziente, sulle modifiche concorrenti e sull'identificativo della visita impediscono conferme duplicate o la sovrascrittura di una cartella modificata nel frattempo. La conferma del solo diario mantiene la parte ancora da completare.

### Aggiornamento sul PC

Scaricare `agente-healthysmile-v8.zip` dalla cartella clinica, chiudere il vecchio agente e sostituire gli otto file del programma nella medesima cartella. Conservare `api-settings.local.json` e `api-key.local.bin`: non sono inclusi nella distribuzione. Avviare nuovamente `AVVIA-AGENTE.bat`. Con la configurazione 1 rimane obbligatorio utilizzare esclusivamente casi fittizi e selezionare la relativa casella. L'opzione 2 richiede requisiti API europei e trattamento verificati dallo studio; non abilita da sola il progetto né certifica GDPR.

Il nuovo schema di comprensione include anche i rilievi attuali confermati, oltre a diario e azioni. I test di integrazione usano API e Firebase simulate e un bridge HTTP locale: non verificano la qualità del modello reale né scrivono pazienti. La chiave è protetta con DPAPI sul PC; `store=false` e rimozione identificativi non garantiscono rispettivamente ZDR e anonimizzazione.

La memoria delle correzioni viene conservata alla conferma. In questa modalità non viene inviata all'API e non viene utilizzata per riaddestrare automaticamente il modello.

### Verifiche v8

`NODE_PATH=/percorso/deps/node_modules node --test ai/test/*.cjs ai/test/*.mjs`

`python -m unittest discover -s ai/local-agent -p 'test_*.py'`

Copertura aggiunta: controllo senza preventivo, suture eseguite e ribasatura futura, conferma parziale, ripristino bozza, prezzi del listino locale, più denti con stessa prestazione, fonti distanti, conflitti tra operatori, fallimento salvataggio, selezione paziente, barriera test-only, CORS e distribuzione senza chiavi.

## Aggiornamento 6.1

- Riquadro «Integra e aggiorna la proposta»: invia la nota cumulativa e la bozza revisionata; conserva i prezzi modificati per le stesse prestazioni. Le revisioni intermedie sono registrate nella memoria solo alla conferma. Se la richiesta fallisce, proposta e integrazione restano disponibili.
- Stati non abbinati al listino sono evidenziati prima della conferma. Nell'odontogramma un dente con sola nota clinica mostra `?`; cliccandolo si legge la nota. Non diventa sano in analisi successive solo perché non menzionato.
- Percorsi richiesti dallo studio, proposti come gruppi da accettare: impianto singolo → abutment + corona zirconio su impianto; terapia endodontica → perno in fibra + provvisorio in resina + corona zirconio. Voci già presenti, rifiutate o escluse dall'AI su indicazione del medico non sono riproposte. Nessuna fase è aggiunta al preventivo prima della conferma.
- Pubblicare anche il Worker rigenerato: il formato rimane compatibile con v6, con il campo aggiuntivo `excluded_suggestions` e il contesto `reviewed_draft`. Le nuove esclusioni e la gestione delle correzioni nella rianalisi richiedono questo aggiornamento del Worker.

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
