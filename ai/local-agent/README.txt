HEALTHY SMILE — AGENTE v8, CARTELLA CLINICA

AGGIORNAMENTO DAL v7
Chiudi la finestra del vecchio agente. Estrai questi file nella stessa cartella
del v7, sostituendo il programma. Conserva api-settings.local.json e
api-key.local.bin: la chiave resta cifrata sul PC e non devi riconfigurarla.
Avvia AVVIA-AGENTE.bat e lascia la finestra aperta.

UTILIZZO
Apri https://healthysmile.it/cartellaclinica e la scheda del paziente.
Nella sezione AI Dettatura scegli OpenAI API + agente sul PC.
Incolla la trascrizione di Buzz oppure carica il suo file .txt.
Premi Analizza con AI: la bozza viene conservata nella cartella aperta.
Rivedi il diario, le prestazioni e le eventuali sedi mancanti.
Conferma visita aggiorna diario, piano e preventivo in un'unica operazione.
Conferma solo il diario permette di precisare le prestazioni successivamente.
Le prestazioni eseguite non creano nuovi addebiti. Controlli e attività senza
voce commerciale restano nel diario; non vengono inventati prezzi o codici.

CHI FA COSA
L'API comprende il testo minimizzato e prepara fatti clinici, diario e azioni.
Solo condizioni attuali confermate e con dente esplicito possono aggiornare
l'odontogramma. Il PC riceve il listino corrente dalla cartella: listino, prezzi,
anagrafica separata e memoria delle correzioni non vengono inviati all'API.
Il browser propone gli abbinamenti e il medico conferma la scrittura in Firebase.
La bozza online contiene trascrizione e risultato; la cartella mantiene il diario.
Il passaggio da Buzz è ancora tramite testo/file, non un invio automatico.
L'agente v8 funziona anche con la precedente demo privata.

PRIMA CONFIGURAZIONE E PROVE
Serve Python 3 per Windows. CONFIGURA-API.bat salva la chiave tramite DPAPI.
Opzione 1: esclusivamente casi fittizi; spunta la relativa casella nel sito.
Opzione 2: progetto API europeo già abilitato e trattamento verificato dallo studio.
La sola scelta 2 non certifica la conformità GDPR né abilita il progetto europeo.
La rimozione di identificativi riduce la condivisione, ma non garantisce anonimato.
store=false non equivale a Zero Data Retention. Verificare i requisiti del
trattamento prima dell'uso clinico reale. Il modello iniziale resta gpt-6-astra;
serve accesso al modello e credito. L'API è a consumo.
Non incollare la chiave in chat, trascrizioni o cartella clinica.
I test automatici dell'integrazione usano risposte simulate, non dati di pazienti.
