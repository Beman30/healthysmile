# Avvio dal dashboard Cloudflare

Risorse create manualmente il 23 settembre 2026. Questa configurazione usa il
sottodominio workers.dev iniziale, senza cambiare DNS o sito healthysmile.it.

- Repository: Beman30/healthysmile
- Ramo: codex/estetica-portable-cloud
- Project name: healthy-smile-estetica
- Path: apps/estetica
- Build command: npm ci
- Deploy command: npx wrangler deploy --config wrangler.cloud.json
- Preview builds: disattivate

Il file wrangler.cloud.json contiene i binding alle risorse esistenti, incluso
il bucket R2 nella giurisdizione eu. Non contiene credenziali o dati paziente.
Il deploy non esegue migrazioni SQL. Le quattro tabelle sono già state create
e verificate nel dashboard: prima di usare Wrangler migrations occorre
riconciliare lo schema esistente con la cronologia delle migrazioni.

## Accesso ancora da completare

Al primo deploy, senza ACCESS_TEAM_DOMAIN e ACCESS_AUD, le pagine dello studio
e le API rispondono 503, "Accesso studio non ancora configurato.". Questo è
voluto: nessun archivio viene aperto senza verifica dell'identità.

Configurare Cloudflare Access per il nome effettivo workers.dev, impostare
ACCESS_TEAM_DOMAIN e ACCESS_AUD nelle variabili runtime del Worker e creare
studio e membership per l'email verificata dell'operatore. keep_vars conserva
le variabili del dashboard ai deploy successivi. Le regole per le rotte del
viewer condiviso sono descritte nel README. Verificare login, logout, rifiuto
degli accessi non autorizzati, caricamento e riapertura di una sessione di
prova prima di usare dati paziente reali.

## Dominio definitivo

Il percorso configure/deploy del README resta disponibile per un dominio
personalizzato. Prima di passare a quel percorso conservare gli stessi ID
D1/R2, specificare anche jurisdiction: "eu" nel binding R2, aggiornare Access
e pianificare il mantenimento dei link condivisi già emessi.

## Primo tentativo eseguito sul ramo sbagliato

Se il log riporta `Failed: root directory not found`, controllare il ramo
mostrato nel dettaglio del tentativo: `apps/estetica` è nel ramo
`codex/estetica-portable-cloud`, non nel ramo `main` del sito.
Dopo aver selezionato il ramo corretto in Settings > Builds > Branch control,
un nuovo commit su quel ramo consente di richiedere una nuova build tramite
l'integrazione GitHub. Verificare il ramo nella nuova riga di Build history.
