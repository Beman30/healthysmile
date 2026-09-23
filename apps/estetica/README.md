# Healthy Smile · Estetica

Base autonoma dell’app fotografica, predisposta per il Cloudflare già usato da Healthy Smile. Dominio iniziale proposto: `estetica.healthysmile.it`. Codice indipendente da ChatGPT e dal servizio Sites. Questa cartella può essere trasferita interamente in un altro repository.

**Stato:** configurazione e integrazione iniziali, non ancora pubblicate. Nessun database, bucket, dominio o account reale viene creato da questo commit. Il prototipo attuale resta separato. Prima di usare pazienti reali occorre completare il deployment e la verifica sul telefono.

## Cosa contiene

- Ricerca paziente e “Nuovo paziente” immediatamente sotto la ricerca.
- Schede con visite e foto originali in D1 + bucket R2 privato; salvataggio automatico, recupero, gestione errori e conflitti tra dispositivi.
- Sei pose, riferimento precedente trasparente, allineamento mediante scala uniforme/rotazione/traslazione, luminosità del confronto separata dagli originali.
- Slider, foto affiancate, metà prima/metà dopo, PDF/JPG e link cifrati con scadenza/revoca.
- Accesso operatori con Cloudflare Access; firma, scadenza, issuer e audience del JWT verificati dal Worker. Appartenenza allo studio verificata nel database a ogni richiesta.
- Identificativo stabile dello studio, indipendente dal dominio e dall’email. Pazienti e condivisioni separati tra studi. L’interfaccia iniziale gestisce un solo studio per operatore; selettore multi-studio, inviti e abbonamenti non sono implementati.

## Avvio nel proprio account Cloudflare

Richiede Node 22.13+ (consigliato 24), accesso amministrativo al proprio account Cloudflare e DNS del dominio. Non usare database o bucket di checkout esistenti. Non inserire foto, dati pazienti o credenziali in GitHub, che è pubblico.

1. In questa cartella eseguire `npm ci` e `npx wrangler login`.
2. Nel proprio account creare **nuove** risorse dedicate:
   ```sh
   npx wrangler d1 create healthy-smile-estetica
   npx wrangler r2 bucket create healthy-smile-estetica-foto
   ```
   Tenere R2 privato: nessun accesso pubblico o dominio R2. Scegliere consapevolmente regione/giurisdizione richieste dallo studio in fase di creazione; il codice non impone una residenza geografica.
3. Configurare Cloudflare Zero Trust / Access per il dominio scelto, con login email o provider dello studio e policy **Allow** limitata agli operatori autorizzati. Registrare team domain e audience dell’app. La membership nel database è un secondo controllo: essere ammessi da Access non concede da solo accesso alle schede.
4. Per il visualizzatore paziente configurare applicazioni/policy **Bypass** solo sui percorsi `/s/*`, `/viewer.js`, `/viewer.css`, `/api/shares/*`. Mantenere `/api/shares` (senza slash finale), `/api/patients*` e il resto del sito protetti. Il Worker valida inoltre formato esatto del token, metodo e scadenza. Sulle rotte bypass un’eventuale revoca autentica e verifica il cookie firmato `CF_Authorization`. Verificare che il cookie abbia copertura su tutto il dominio; in caso contrario la revoca deve fallire chiusa.
5. Copiare `deployment.example.json` in `deployment.local.json`, compilare account ID, database ID, bucket, dominio e parametri Access. Il file locale è escluso da Git.
   ```sh
   npm run configure -- deployment.local.json
   npm run check:config
   npm run db:migrate
   node scripts/bootstrap-studio.mjs operatore@example.com "Healthy Smile"
   npx wrangler d1 execute DB --remote --config wrangler.local.json --file bootstrap.local.sql
   npm run deploy
   ```
   Il bootstrap genera un nuovo UUID studio: eseguirlo una sola volta. Per aggiungere operatori inserire membership nello **stesso** studio, con email lowercase e ruolo `editor`. Disabilitare una membership (`active=0`) revoca immediatamente l’accesso applicativo. Entrambi i ruoli possono gestire foto; l’amministrazione membri resta fuori dall’app in questa versione.
6. Verificare login/logout e negazione accesso senza login, un secondo account non autorizzato, isolamento tra studi, acquisizione e riapertura sul telefono, salvataggio offline interrotto, creazione/revoca/scadenza link e PDF. Nessun dato reale prima di questa verifica.

`run_worker_first: true` è essenziale: impedisce che gli asset dell’app aggirino l’autenticazione. `workers_dev` e preview URL sono disattivati. Non attivare hosting statico diretto della cartella `public`.

## Cambio dominio o sito

**Stesso account e stesso archivio:** modificare `domain` nel file locale, configurare DNS e Access del nuovo hostname, rigenerare la configurazione e pubblicare. Mantenere invariati database ID, bucket e UUID studio. Le schede usano percorsi relativi; non contengono il vecchio dominio. L’accesso richiederà un nuovo login sul nuovo hostname.

**Nuovo repository:** copiare questa cartella con codice, lockfile e migrazioni. Trasferire in modo riservato i parametri di deployment, non i file paziente dentro Git.

**Nuovo account/fornitore:** serve una migrazione separata di D1, originali R2, oggetti cifrati e relativi metadati, oltre alla sostituzione dell’autenticazione/storage. Non è un semplice cambio URL né un procedimento automatico implementato qui. Conservare gli identificativi e verificare hash, numero di file e ripristino prima del passaggio.

**Vecchi link condivisi:** sono legati all’hostname. Conservare il vecchio hostname/Worker oppure predisporre un redirect testato che mantenga percorso e frammento `#` (chiave di decifratura). I link del prototipo Sites continuano a dipendere dal suo archivio: non vengono migrati da questo pacchetto.

**Foto locali già esistenti:** esportare il ZIP dal prototipo e importarlo nella nuova app (crea una scheda distinta per codice). I dati IndexedDB non passano automaticamente da un dominio all’altro. L’importazione di singole foto resta disponibile per ciascuna posa; l’importazione batch del “prima” è nascosta in questa prima integrazione cloud.

## Limiti operativi prima della vendita

È una base fotografica, non un gestionale clinico completo o un SaaS pronto alla vendita. Mancano onboarding autonomo degli studi, fatturazione, interfaccia gestione operatori, audit clinico, eliminazione/retention automatizzata e backup/ripristino operativo. D1 + R2 costituiscono l’archivio, **non** una strategia di backup da soli: predisporre backup separati e provare il ripristino. I link scaduti diventano illeggibili; la pulizia periodica degli oggetti scaduti va ancora automatizzata. Per dati sanitari reali definire accordi del fornitore, residenza, accessi, consenso/condivisione e conservazione prima dell’attivazione.

La condivisione espone copie cifrate a chi possiede il link completo fino a scadenza/revoca; una copia già scaricata non può essere revocata. Gli originali restano privati. Regolazioni di luminosità sono indicate nell’esportazione; l’allineamento non ricostruisce prospettive o pose differenti.

## Verifiche

`npm test`: verifica JWT reali, membership, isolamento pazienti, conflitti, origine scritture, protezione percorsi, portabilità dominio; harness client/API con SQLite verifica scatto, salvataggio, riapertura, allineamento/luminosità, ghost, errori offline e PDF. Non sostituisce il collaudo hardware e Cloudflare reale.

Documentazione ufficiale: [Access JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [asset protetti](https://developers.cloudflare.com/workers/static-assets/binding/), [domini Worker](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
