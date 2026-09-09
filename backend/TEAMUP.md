## Orari automatici da Palmia (aggiornamento)

Il Worker aggiornato supporta `schedule_mode: "palmia"`, `palmia_calendar_id` e
`staff_follows_palmia: true`. Il consenso alla presenza riguarda la regola stabile:
l'igienista segue gli orari di Palmia, come confermato dal titolare. Nessuna fascia
giornaliera manuale è necessaria. Le impostazioni esistenti restano in modalità
manuale finché l'amministratore seleziona e salva la nuova modalità.

### Attivazione

1. Distribuire la nuova versione di `releases/healthysmile-worker-teamup-scrittura.mjs`
   nel Worker esistente (Edit code, sostituire tutto, Deploy). Nessun nuovo secret.
2. Ricaricare `/admin/teamup.html`, selezionare tutte le agende Medici.
3. Scegliere modalità **Automatica da STOP/PAUSA Palmia**, selezionare l'agenda
   Medici → Palmia e confermare una volta che l'igienista ne segue gli orari.
4. Mantenere il calendario dedicato alle prenotazioni e il permesso di modifica
   dei soli eventi creati dal medesimo collegamento. Attivare la pubblicazione e salvare.
5. Per verificare una giornata basta scegliere la data e premere Verifica la capienza.

### Confini e disponibilità

- Orizzonte mobile: oggi e i successivi 13 giorni, fuso Europe/Rome. Non occorre
  aggiungere nuove date quando trascorre una giornata.
- Per ricavare l'apertura si considerano solo eventi con STOP o PAUSA nel titolo
  appartenenti all'agenda Palmia selezionata. I blocchi sovrapposti vengono uniti.
- Le finestre possibili sono gli intervalli fra la fine di un blocco e l'inizio
  del successivo. I blocchi prima dell'apertura e dalla chiusura devono essere
  presenti in Teamup. Non si pubblicano orari prima del primo blocco o dopo l'ultimo.
- Una giornata vuota, con un solo blocco o con un evento giornaliero Palmia
  non genera disponibilità. Non si inferiscono turni da primo/ultimo paziente.
- Gli altri controlli restano attivi: 60 minuti interi (45+15), massimo due poltrone,
  eventi distinti sovrapposti nella stessa agenda, deduplicazione per ID,
  note organizzative, pause, prenotazioni sito e pagamenti in corso.
- Il pubblico riceve soltanto date e orari. Lettura senza cache all'apertura della
  pagina, al ritorno sulla scheda dopo almeno un minuto e con Aggiorna disponibilità.
  La selezione viene azzerata se l'elenco cambia; un errore nasconde le scelte obsolete.
  Il controllo prima del checkout e il blocco atomico continuano a essere obbligatori.
- Il pannello riconosce un Worker precedente e impedisce di salvare la modalità
  automatica finché non è stata distribuita la versione compatibile.

Validazione: 39 test, inclusi modalità automatica, STOP mancanti, pause, ora intera,
orizzonte mobile e cambio ora, autenticazione, aggiornamenti Teamup, checkout e
conferma del solo evento creato dal sito. Test eseguiti con dati fittizi e API simulate.
Nessuna prova di scrittura o pagamento su servizi reali.

---

# Teamup: disponibilità pubbliche per l’offerta 98 €

Il Worker legge Teamup e genera le disponibilità della pagina `visita-igiene-spazzolino.html`. L’attivazione è esplicita: prima del primo salvataggio restano gli slot manuali precedenti. Dopo il salvataggio, per `igiene-sonicare` vengono usate esclusivamente le fasce configurate; disattivare la pubblicazione restituisce zero disponibilità e non ripristina gli slot manuali.

## Attivazione

1. Nel Worker Cloudflare `healthysmile-checkout`, aprire **Edit code**, sostituire tutto il modulo con `backend/releases/healthysmile-worker-teamup-scrittura.mjs` e premere **Deploy**. Conservare il binding D1 `DB` e i secret esistenti. In alternativa: dalla cartella backend, `npm install`, `npm run build:teamup`, `npx wrangler deploy`.
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

## Limite rispetto alle modifiche manuali

Con **scrittura disattivata**, il Worker non crea appuntamenti in Teamup e lo studio deve inserirli. Con scrittura attiva, gli eventi nuovi dell’offerta 98 € vengono inseriti e aggiornati come descritto sotto. Il sistema protegge le prenotazioni che passano dal sito, ma non può impedire a una persona di inserire manualmente in Teamup un altro paziente dopo l’ultimo controllo. Non costituisce una prenotazione atomica condivisa con Teamup.

Per sospendere nuovi ingressi, disattivare la pubblicazione e salvare. Le prenotazioni esistenti restano registrate. Dopo l’attivazione non tornare al vecchio Worker per sospendere il servizio: il vecchio codice non conosce queste protezioni sui pagamenti e sulle sovrapposizioni.

L’obiettivo di 30 pazienti/settimana non è un limite automatico né una previsione garantita: dipende da ore di igienista/poltrona effettivamente disponibili, acquisizione e presenze.

## API e verifica

- `GET /api/admin/teamup/calendars`, `POST /api/admin/teamup/preview`: verifica riservata della capienza Teamup.
- `GET/POST /api/admin/teamup/settings`: configurazione autenticata con revisione per evitare sovrascritture da finestre concorrenti.
- `GET /api/slots?service=igiene-sonicare`: solo `{date,time}`, senza dati dei pazienti, credenziali o testi dell’agenda. Risposte non memorizzabili in cache.

Eseguire `npm run build:teamup` e `npm test`. I test usano dati fittizi, Miniflare/workerd e D1: nessuna chiamata di pagamento o scrittura su calendari reali. Sono coperti intervalli adiacenti e sovrapposti, pause/chiusura, note, errori Teamup, prenotazioni concorrenti, cambio agenda durante checkout, pagamento tardivo, Stripe/PayPal e rilascio dei blocchi.

Riferimenti tecnici: [transazioni D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [scadenza delle sessioni Stripe](https://docs.stripe.com/payments/checkout/managing-limited-inventory).


## Scrittura limitata agli eventi del sito

### Configurazione

1. In Teamup creare un sottocalendario **Prenotazioni sito**.
2. Nel collegamento riservato al Worker, rendere questo sottocalendario accessibile con **Modify from same link**. Le agende Medici rimangono **Read-only** con dettagli. Non usare il collegamento del sito per inserimenti manuali della segreteria: la titolarità nativa è legata al collegamento. Non usare Add-only, che permette modifiche solo per un breve periodo.
3. Pubblicare il bundle `releases/healthysmile-worker-teamup-scrittura.mjs` nel Worker. Non occorre una nuova chiave API.
4. In `/admin/teamup.html` mantenere tutte le agende Medici selezionate, scegliere **Prenotazioni sito** nel nuovo elenco **Calendario dedicato al sito**, attivare **Inserisci e aggiorna automaticamente gli eventi creati dal sito**, quindi salvare. Il calendario di destinazione viene incluso automaticamente nei controlli di capienza. Nessun evento reale viene creato dal salvataggio.

Il primo salvataggio crea il registro privato `teamup_owned_events`. Le impostazioni esistenti hanno scrittura disattivata per impostazione predefinita. Le prenotazioni precedenti all’attivazione non vengono importate né convertite in eventi di proprietà del sito.

### Funzionamento e confini

- Prima del pagamento viene creato un blocco Teamup di 60 minuti. Il calendario viene ricontrollato anche dopo l’inserimento, escludendo soltanto il blocco verificato della stessa prenotazione.
- Al pagamento il sito aggiorna titolo e note del proprio evento con nome e telefono del paziente. Nessun dato clinico viene trasferito. Un errore di aggiornamento impedisce la conferma automatica e conserva il pagamento come **Da verificare**.
- La cancellazione dalla gestione prenotazioni rimuove prima l’evento verificato. Se la rimozione fallisce, l’operazione si ferma. Il cron elimina anche i blocchi delle prenotazioni cancellate o scadute. Appuntamenti completati o non presentati restano in agenda.
- Il registro associa un codice prenotazione a un ID Teamup, a un identificativo remoto casuale e al collegamento che ha creato l’evento. Gli ID inviati dal browser non autorizzano alcuna modifica. Non sono gestite serie ricorrenti.
- Prima di modificare o eliminare vengono controllati ID, identificativo remoto, calendario, collegamento e versione dell’evento. La richiesta include obbligatoriamente la versione Teamup: una modifica concorrente viene rifiutata anche se avviene dopo la lettura.
- Una creazione dall’esito incerto non viene ripetuta alla cieca e non avvia il pagamento. Un aggiornamento dall’esito incerto non sovrascrive la versione eventualmente modificata. Il blocco rimane prudenzialmente riservato e richiede verifica dello studio.
- **Controlla sincronizzazione** mostra gli esiti nel registro. Eventi con stato **Esito incerto** o **Conflitto** vanno verificati prima di procedere. Non esiste un comando che adotti arbitrariamente eventi preesistenti o ignori il controllo di proprietà/versione.
- Questa versione automatizza inserimento, conferma e cancellazione. Non introduce uno spostamento automatico di data/ora: spostare manualmente l’evento in Teamup viene rilevato come modifica esterna e sospende gli aggiornamenti automatici.
- I controlli proteggono gli eventi gestiti dal sito. Non impediscono alla segreteria di creare altri appuntamenti direttamente in Teamup dopo l’ultimo controllo di disponibilità.

Fonti: [permesso Modify from same link](https://calendar.teamup.com/kb/how-to-use-the-modify-my-events-access-permission/), [specifica API ufficiale, version per aggiornamenti e cancellazioni](https://stoplight.io/api/v1/projects/teamup/api/nodes/reference/generated_docs_public.yaml).
