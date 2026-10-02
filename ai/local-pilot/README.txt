PROVA DI COMPRENSIONE LOCALE - HEALTHY SMILE

1. Estrai tutto lo ZIP in una nuova cartella sul PC Windows.
2. Apri Ollama (il modello previsto e' qwen3:4b, gia' usato dall'agente).
3. Fai doppio clic su PROVA-LOCALE.bat e attendi la fine dei tre casi.
4. Carica in chat il file risultato-prova-locale.json creato nella stessa cartella.

Servono Python 3 e Ollama, come per l'agente precedente.
Se manca il modello, il programma indica: ollama pull qwen3:4b.
La prima risposta puo' richiedere piu' tempo per caricare il modello.
Ogni caso ha un limite di attesa di 6 minuti; tempi ed errori sono nel risultato.

Questa e' una prova iniziale, NON un modello addestrato.
I tre casi sono esempi fittizi adattati ai problemi discussi: non sono una
validazione clinica e non rappresentano tutta la casistica dello studio.
La validita' del JSON non e' un giudizio sulla correttezza clinica.
Gli aspetti attesi sono nel risultato, per la revisione da parte del medico;
non vengono mostrati al modello durante l'analisi.

Il programma usa soltanto http://127.0.0.1:11434 sul PC, senza proxy o redirect.
Non chiama OpenAI, non legge chiavi e non scrive nel gestionale.
Non sostituisce l'agente v8: tieni le due cartelle separate.
Non inserire trascrizioni reali in questo pacchetto di prova.

protocollo.json contiene una copia delle istruzioni e del formato usati
dalla comprensione API, per confrontare il modello locale sullo stesso compito.
Non trasferisce pesi o capacita' del modello OpenAI.
