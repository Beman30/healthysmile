# Lettore Teamup separato — versione 8

Worker di diagnosi in sola lettura. Non sostituisce healthysmile-checkout.
Non contiene chiamate Stripe/PayPal, né POST/PUT/DELETE verso Teamup.
Non pubblica slot. I risultati sono candidati alternativi e non disponibilità vendibili:
i blocchi di pagamento D1 del sito non sono inclusi.

## Prima prova live

1. Creare un nuovo Worker **healthysmile-agenda-reader** e incollare il bundle
   `releases/healthysmile-agenda-reader-v8.mjs` in Edit code, quindi Deploy.
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

## Lettura avvisi v4
Riconosce nell’agenda Palmia anche intervalli senza la parola PALMIA, come CC-10.00-16.00, NB-10.00-16.00 e 10:00-16:00. Le sigle o i nomi davanti a barra o trattino sono ignorati; gli orari sono ricavati dal testo. CC- PAUSA è riconosciuta usando la durata effettiva dell’evento. Test del formato reale dell’11 settembre superato localmente.

## Correzione v5
Le parole organizzative nelle note di un appuntamento non bloccano tutta la giornata. Il paziente resta conteggiato per la durata effettiva. Apertura e avvisi STOP/PAUSA continuano a essere interpretati; le aperture discordanti restano da verificare.

## Pagamenti v6
Pulsanti Igieni sito e Pagamenti. Fonte importi: campo Teamup who (Deve pagare) e importi espliciti EUR/€ nel titolo. Nel campo sono accettati anche numeri senza valuta; nel titolo i numeri senza valuta non sono interpretati come importi per evitare numeri di denti o cartella. Valori identici non si sommano. Più valori, discordanze e indicazioni di pagamenti effettuati richiedono verifica. Nessuna scrittura o riscossione. Elenco per appuntamento nelle giornate lette, non estratto conto del paziente; nessuna deduplicazione del debito tra diversi appuntamenti. I vecchi report richiedono una nuova lettura per aggiungere i pagamenti.

## Periodi e somme v7
Dal/Al inclusivi, fino a 366 giorni per lettura manuale, inclusi giorni passati se accessibili in Teamup. Il browser suddivide la lettura in gruppi di sette giorni; lasciare aperta la pagina. Totali per giornata e periodo in centesimi interi, valori da verificare esclusi e conteggiati separatamente. Giorni mancanti o non aggiornati producono un totale parziale. Il totale somma gli importi degli appuntamenti, non rappresenta un saldo contabile univoco per paziente. Mostra ultima lettura filtra il periodo selezionato. Cron invariato sui prossimi 14 giorni.

## Prime visite v8
Terza vista Prime visite. Il lettore individua un solo calendario con nome Prime Visite (anche sotto un gruppo) tra quelli accessibili e legge gli eventi separatamente dalla capienza. Conteggia eventi per data di inizio Europe/Rome, deduplicando ID e inizio, escludendo cancellazioni API; non deduce presenze reali o annullamenti scritti nel titolo. Totale giornaliero e del periodo. Calendario assente/ambiguo o letture fallite sono segnalati come mancanti, non come zero. Le viste esistenti continuano a funzionare se il calendario Prime Visite non è accessibile. Nessuna modifica di permessi Teamup da parte del Worker.
