PROVA DI COMPRENSIONE LOCALE V4 - HEALTHY SMILE

1. Estrai tutto lo ZIP in una nuova cartella sul PC Windows.
2. Apri Ollama (serve qwen3:4b, gia' usato dall'agente).
3. Fai doppio clic su PROVA-LOCALE.bat e attendi la fine dei tre casi.
4. Carica in chat il file risultato-prova-locale.json creato nella stessa cartella.

Servono Python 3 e Ollama, come per l'agente precedente.
Se manca il modello, il programma indica: ollama pull qwen3:4b.
La prima risposta puo' richiedere piu' tempo per caricare il modello.
La v4 crea automaticamente healthysmile-qwen3-diretto-v1:4b, una copia locale
che riutilizza i pesi di qwen3:4b con il prefisso finale di ragionamento gia'
chiuso. Questo riproduce il prefisso senza thinking previsto dal template Qwen3.
Il modello qwen3:4b originale non viene modificato; non vengono scaricati pesi.
Non e' un addestramento e non migliora automaticamente la comprensione clinica.
Se il template originale e' diverso da quello diagnosticato, la prova si ferma.
Se esiste gia' una copia con configurazione diversa, non viene sovrascritta.
Per rimuovere soltanto la copia creata dalla prova: ollama rm healthysmile-qwen3-diretto-v1:4b
Prima dei casi clinici viene eseguita una prova brevissima, limite 60 secondi.
Solo una risposta completa OK, senza ragionamento, consente di avviare i casi.
Viene aggiunto il comando /no_think previsto da Qwen3 per disattivare il
ragionamento: e' una richiesta al modello, non una garanzia di qualita'.
Ogni caso clinico ha un limite totale di 120 secondi. Ogni 10 secondi viene
mostrato il tempo trascorso e il numero di caratteri ricevuti.
Al primo errore la prova si interrompe; tempi ed errori sono nel risultato.
Versione Ollama e memoria usata dai modelli caricati sono rilevate automaticamente.
Viene registrata anche la configurazione del modello (template e controlli thinking).
Sedi e alcuni numeri di impianti non documentati sono segnalati nel risultato;
questi controlli sono limitati e non rilevano tutti gli errori clinici.
La v4 mantiene contesto 4096 e massimo 1500 token di risposta delle v2/v3;
questo puo' cambiare i risultati rispetto alla prova precedente.

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
