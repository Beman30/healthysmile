# Teamup: disponibilità pubbliche per l’offerta 98 €

Il Worker legge Teamup e genera le disponibilità della pagina `visita-igiene-spazzolino.html`. L’attivazione è esplicita: prima del primo salvataggio restano gli slot manuali precedenti. Dopo il salvataggio, per `igiene-sonicare` vengono usate esclusivamente le fasce configurate; disattivare la pubblicazione restituisce zero disponibilità e non ripristina gli slot manuali.

## Attivazione

1. Nel Worker Cloudflare `healthysmile-checkout`, aprire **Edit code**, sostituire tutto il modulo con `backend/releases/healthysmile-worker-teamup-slot.mjs` e premere **Deploy**. Conservare il binding D1 `DB` e i secret esistenti. In alternativa: dalla cartella backend, `npm install`, `npm run build:teamup`, `npx wrangler deploy`.
2. Aprire `/admin/teamup.html` e accedere con il token amministratore esistente.
3. Selezionare **tutte** le agende Medici, compresa l’igienista. Non selezionare Prestazioni, Laboratori o Caduti.
4. Per ogni fascia: scegliere data, inizio e fine, verificare note e presenza del personale, spuntare la conferma, usare **Verifica la capienza**, poi **Aggiungi fascia**. Inserire fasce separate prima e dopo le pause.
5. Spuntare **Pubblica queste fasce sul sito con verifica automatica Teamup**, poi **Salva disponibilità**. Verificare gli orari sulla pagina dei 98 €.

Il primo salvataggio autenticato installa automaticamente due tabelle aggiuntive e i vincoli nel database; non richiede di incollare SQL. Nessuna modifica ai secret `ADMIN_TOKEN`, `TEAMUP_API_KEY`, `TEAMUP_CALENDAR_KEY`. Le chiavi Teamup devono restare secret del Worker. L’API key identifica l’applicazione; il collegamento `ks...` determina le agende accessibili. L’elenco è letto da `/configuration`, compatibile con il collegamento di sola lettura già verificato.

## Regole e protezioni

- Due poltrone totali. Appuntamenti distinti sovrapposti nella stessa agenda contano separatamente. Lo stesso evento, presente in più agende selezionate, conta una sola volta.
- Ogni nuovo appuntamento occupa 60 minuti continuativi: 45 igienista + 15 medico. Non si richiede l’agenda libera del medico negli ultimi 15 minuti. La presenza degli operatori nella fascia viene confermata dallo studio.
- Nessuna assegnazione fissa medico/poltrona. Inizio ogni 15 minuti; tutta l’ora deve stare nella fascia. Chiusura alle 19:00 implica ultimo inizio alle 18:00.
- PAUSA/STOP bloccano gli intervalli interessati. Eventi giornalieri e note riconosciute di apertura/chiusura escludono prudenzialmente la giornata. Il software legge titoli e note degli eventi, non allegati/commenti separati, e non interpreta qualsiasi possibile formulazione: la verifica umana delle note resta necessaria.
- Pubblicabili fino a 14 giornate, 40 fasce, entro 60 giorni. La disponibilità si aggiorna a ogni richiesta del sito; non serve un cron di copia degli slot. Un problema Teamup non fa apparire disponibilità vecchie come valide.
- Le prenotazioni e i blocchi del sito sono controllati oltre a Teamup. Per prudenza, ogni prenotazione del sito con appuntamento viene considerata lunga 60 minuti. Non si vendono due appuntamenti online sovrapposti, neppure se Teamup mostra entrambe le poltrone libere. Gli orari alternativi non sono presentati come numero di posti/pazienti.
- Una transazione D1 e vincoli SQL bloccano anche due richieste contemporanee su inizi diversi ma sovrapposti. I vincoli proteggono le prenotazioni automatiche anche dalle altre prenotazioni del sito e dalle modifiche nell’area amministrativa.
- Prima del pagamento viene riletto Teamup. Al pagamento viene verificata nuovamente la disponibilità: se l’agenda è cambiata, manca l’accesso o la prenotazione era stata cancellata, si registra il denaro ricevuto con stato **Da verificare**, senza confermare l’appuntamento. La pagina non propone il calendario e non invia la conversione “prenotazione confermata”. Nell’area prenotazioni il pulsante **Verifica e conferma** ripete il controllo.

## Checkout abbandonati

Una prenotazione automatica in pagamento non viene liberata solo perché sono trascorsi 20 minuti: potrebbe essere ancora pagabile. Le sessioni Stripe nuove scadono dopo 35 minuti; il webhook di scadenza oppure il cron esistente liberano la prenotazione. Il cron controlla le prenotazioni pendenti create da oltre un’ora. Se il provider è irraggiungibile mantiene il blocco e riprova.

Gli ordini PayPal aperti e gli avvii di pagamento con esito tecnico incerto restano bloccati fino a un esito definitivo o alla gestione dello studio. Si vedono come prenotazioni bloccate nell’area amministrativa. Una cancellazione libera l’intervallo; se successivamente arriva un pagamento tardivo, viene registrato **Da verificare**, senza sottrarre il posto a una nuova prenotazione. Non si eseguono rimborsi automatici.

## Limite del collegamento di sola lettura

Il Worker **non crea appuntamenti in Teamup**. Lo studio deve continuare a inserirli. Il sistema protegge le prenotazioni che passano dal sito, ma non può impedire a una persona di inserire manualmente in Teamup un altro paziente dopo l’ultimo controllo. Non costituisce una prenotazione atomica condivisa con Teamup.

Per sospendere nuovi ingressi, disattivare la pubblicazione e salvare. Le prenotazioni esistenti restano registrate. Dopo l’attivazione non tornare al vecchio Worker per sospendere il servizio: il vecchio codice non conosce queste protezioni sui pagamenti e sulle sovrapposizioni.

L’obiettivo di 30 pazienti/settimana non è un limite automatico né una previsione garantita: dipende da ore di igienista/poltrona effettivamente disponibili, acquisizione e presenze.

## API e verifica

- `GET /api/admin/teamup/calendars`, `POST /api/admin/teamup/preview`: verifica riservata della capienza Teamup.
- `GET/POST /api/admin/teamup/settings`: configurazione autenticata con revisione per evitare sovrascritture da finestre concorrenti.
- `GET /api/slots?service=igiene-sonicare`: solo `{date,time}`, senza dati dei pazienti, credenziali o testi dell’agenda. Risposte non memorizzabili in cache.

Eseguire `npm run build:teamup` e `npm test`. I test usano dati fittizi, Miniflare/workerd e D1: nessuna chiamata di pagamento o scrittura su calendari reali. Sono coperti intervalli adiacenti e sovrapposti, pause/chiusura, note, errori Teamup, prenotazioni concorrenti, cambio agenda durante checkout, pagamento tardivo, Stripe/PayPal e rilascio dei blocchi.

Riferimenti tecnici: [transazioni D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [scadenza delle sessioni Stripe](https://docs.stripe.com/payments/checkout/managing-limited-inventory).
