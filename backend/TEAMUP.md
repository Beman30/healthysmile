# Teamup: verifica riservata della capienza

Questa prima fase aggiunge una lettura in tempo reale di Teamup e un'anteprima amministrativa. Non sincronizza gli slot pubblici, non modifica appuntamenti, non prenota e non cambia il checkout.

## Configurazione e pubblicazione

Nel Worker `healthysmile-checkout` impostare come **secret** `TEAMUP_API_KEY` e `TEAMUP_CALENDAR_KEY`. Il secondo è la chiave del collegamento `ks...`, con lettura dei dettagli per tutte le agende del gruppo Medici. Nessuna chiave deve comparire nel repository o nel codice pubblico.

Dopo avere integrato la modifica nel repository, dalla cartella `backend` eseguire `npm install`, autenticarsi a Cloudflare con `npx wrangler login` se necessario e pubblicare con `npx wrangler deploy`. La pubblicazione del solo sito statico non aggiorna il Worker. I secret già presenti nel Worker vengono conservati.

Aprire `/admin/prenotazioni.html`, accedere con il token amministratore esistente e seguire **Verifica Teamup**. Selezionare tutte le agende Medici e una data/finestra esplicitamente abilitata, verificando note di apertura e presenza del personale. Se il collegamento non consente di leggere i dettagli, correggerne l'accesso prima della verifica.

Le API sono protette dall'autenticazione amministratore esistente e rispondono con `Cache-Control: no-store`:

- `GET /api/admin/teamup/calendars`: identificativi e nomi delle agende accessibili.
- `POST /api/admin/teamup/preview`: `date`, `start`, `end`, `subcalendar_ids` (interi), `window_confirmed: true`.

## Regole

Il controllo considera solo gli eventi delle agende selezionate. Deduplica per ID evento; le istanze ricorrenti hanno ID distinti forniti da Teamup. Due appuntamenti distinti sovrapposti nella stessa agenda occupano entrambe le poltrone. Prestazioni e Laboratori non vanno selezionati.

Ogni proposta dura 60 minuti: 45 minuti igienista e 15 minuti visita. I possibili inizi sono distanziati di 15 minuti rispetto all'inizio della finestra. Per ogni proposta si misura l'occupazione massima durante l'intera ora, con intervalli [inizio, fine): un appuntamento che termina quando l'altro inizia non crea sovrapposizione. Non si assegna una poltrona fissa a un medico. Non si richiede che il medico sia libero negli ultimi 15 minuti, ma la sua presenza e quella dell'igienista devono essere confermate nella finestra scelta.

PAUSA/STOP bloccano conservativamente gli intervalli interessati. Eventi giornalieri o parole organizzative relative ad apertura/chiusura richiedono revisione di tutta la giornata. Il riconoscimento è prudenziale e non comprende ogni formulazione possibile: la conferma umana delle note resta obbligatoria. La lettura riguarda titolo e note degli eventi, non allegati o commenti separati. Nessun testo clinico o nome paziente viene restituito alla pagina amministrativa.

## Limiti intenzionali prima della prenotazione automatica

Le proposte sono alternative tra loro. L'anteprima verifica soltanto la capienza Teamup: non riconcilia le prenotazioni e i blocchi del database del sito. Gli slot pubblici esistenti restano indipendenti. Il limite di 30 pazienti/settimana non è ancora applicato: sarà un limite di prenotazioni confermate, non del numero di orari alternativi mostrati.

Prima di attivare slot pubblici automatici occorre verificare dal vivo le agende selezionate e i casi organizzativi, coordinare le prenotazioni del sito con Teamup, introdurre prenotazioni atomiche su intervalli sovrapposti e una riconciliazione degli errori. Il collegamento di sola lettura non può riservare un appuntamento. Un errore API non deve mai trasformarsi in disponibilità pubblica.

## Verifica

`node --test test/teamup.test.js` dalla cartella backend.

I test coprono pazienti sovrapposti nella stessa agenda, deduplicazione, confini degli intervalli, PAUSA/STOP, note organizzative, fuso Europe/Rome e cambio ora, dati malformati, autenticazione dell'API Teamup e assenza di dati paziente nei risultati.

Verifica dal vivo: confrontare una giornata piena e una parzialmente libera con Teamup, incluso il caso 10–13 con altri pazienti alle 10 e alle 11. Nessuna disponibilità deve essere pubblicata sulla base dei soli test simulati.
