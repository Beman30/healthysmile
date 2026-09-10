# Lettore Teamup separato — versione 3

Worker di diagnosi in sola lettura. Non sostituisce healthysmile-checkout.
Non contiene chiamate Stripe/PayPal, né POST/PUT/DELETE verso Teamup.
Non pubblica slot. I risultati sono candidati alternativi e non disponibilità vendibili:
i blocchi di pagamento D1 del sito non sono inclusi.

## Prima prova live

1. Creare un nuovo Worker **healthysmile-agenda-reader** e incollare il bundle
   `releases/healthysmile-agenda-reader-v3.mjs` in Edit code, quindi Deploy.
2. Aggiungere i secret `TEAMUP_API_KEY`, `TEAMUP_CALENDAR_KEY`, `ADMIN_TOKEN`.
   Usare le credenziali già funzionanti del Worker attuale. Il token admin resta nel browser
   solo in memoria; non inviarlo in chat. Il collegamento Teamup può essere di sola lettura.
3. Aggiungere un binding D1 denominato `DB`, scegliendo il database esistente
   `healthysmile-checkout-db`, oppure uno dedicato. Vengono scritte esclusivamente
   tre nuove tabelle `agenda_reader_*`; nessuna modifica a bookings/slots/teamup_settings.
4. Aprire l'indirizzo del nuovo Worker. Inserire il token, Connetti, selezionare tutte
   le agende Medici e Palmia; facoltativamente Prenotazioni sito. Palmia viene preselezionato
   se il nome è univoco. Non serve configurare agende o presenza dell’igienista.
5. Salvare e premere **Leggi questa giornata adesso**. Controllare prima 10, 11, 22 settembre
   se compresi nei prossimi 14 giorni. Ogni data è visibile anche con zero candidati.
6. Dopo la prima lettura verificata, aggiungere un Cron Trigger `*/5 * * * *` al nuovo
   Worker. Il file wrangler.toml lo dichiara per chi usa il deploy da CLI.
   Il ciclo legge 14 giornate, con richieste sequenziali e una richiesta di configurazione.
   Non avviare più letture contemporanee: il database coordina le esecuzioni.

## Cosa interpreta

Titoli come `CC/ PALMIA 10-19`, anche con altre sigle prima della barra e minuti
`10:30`/`10.30`. Un avviso identico nella descrizione è riconosciuto se costituisce
l'intera descrizione. Apertura valida soltanto nel calendario Palmia configurato.
STOP/PAUSA nel titolo sono indisponibilità, non pazienti. Quelli Palmia riducono
l'apertura; quelli degli altri operatori sono mostrati come avvisi.
In assenza di avviso, sono possibili solo finestre tra due STOP/PAUSA Palmia.
Avvisi non compresi o contraddittori sono elencati esplicitamente come problemi.
La lettura è basata su regole, non usa ancora un modello AI per testo libero.
Non deduce nuove convenzioni e non scarta silenziosamente i problemi.

Ogni evento clinico distinto occupa una poltrona; duplicati con stesso ID contano una
volta; ricorrenze sono lette come occorrenze restituite dall'API. Un candidato richiede
60 minuti di capienza nell’apertura Palmia. Non viene verificata la disponibilità del personale. Due pazienti già presenti
in qualsiasi segmento dell'ora escludono lo slot. Gli eventi sito sovrapposti sono esclusi.

La pagina è protetta via API con ADMIN_TOKEN. Titoli e note sono mostrati solo dopo
autenticazione, inseriti nel DOM con textContent. Nessun dato dell'agenda appare
nella pagina pubblica iniziale. I report contengono dati dello studio: non condividerli.

## Validazione e limiti

Test locali su orari, pause, occupazione, duplicati, assenza di requisiti sull’igienista, spostamenti e
cancellazioni; integrazione simulata Worker/D1/API con sole GET verso Teamup.
La verifica live richiede il deploy e i secret dell'account, non disponibili alla chat.
I risultati vecchi oltre 10 minuti o da configurazione precedente sono marcati come
da aggiornare. Errori di lettura restano visibili; non autorizzano pubblicazione.
Un errore di configurazione del ciclo è riportato nella pagina dell'ultima lettura.
Il sistema non considera un cron un aggiornamento istantaneo: il checkout futuro
richiederà una lettura e prenotazione coordinate, progettate separatamente.

## Output v3
La pagina mostra giorno, apertura, chiusura, pause e intervalli con una o due poltrone libere. Gli intervalli seguono gli orari effettivi degli eventi, anche se più brevi di un trattamento. Nessun dettaglio tecnico o elenco di esclusioni nella pagina. La disponibilità del personale e i pagamenti non sono verificati. I report v2 richiedono una nuova lettura.
