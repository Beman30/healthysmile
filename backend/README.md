# Healthy Smile — checkout universale

Backend unico per tutti i pagamenti del sito. Una landing non conosce mai
un prezzo: manda un `service_id`, questo Worker decide quanto si paga.

    /checkout.html?service=igiene-sonicare&date=2026-09-10&time=10:00

## Perché un Worker e non il sito

healthysmile.it è un sito statico su GitHub Pages: non può eseguire codice
lato server, né custodire una chiave segreta, né ricevere webhook. Il
frontend resta su Pages, l'API vive su Cloudflare Workers (dove hai già
`cartella-backend` e il D1 `cartella-clinica-db`).

## Struttura

    backend/
      src/services.js   ← FONTE AUTOREVOLE DEI PREZZI
      src/index.js      ← router, slot, webhook
      src/stripe.js     ← Stripe REST + verifica firma
      src/paypal.js     ← PayPal Orders v2 + verifica firma
      schema.sql        ← tabelle D1
      seed-slots.sql    ← slot di settembre (DATE DA CONFERMARE)
      wrangler.toml

## Messa in opera

    cd backend
    npm install

    # 1. database
    npx wrangler d1 create healthysmile-checkout-db
    # copiare l'id restituito in wrangler.toml → database_id
    npm run db:schema
    npm run db:seed          # solo se le date in seed-slots.sql sono corrette

    # 2. chiavi (mai nel repo, mai nel browser)
    npx wrangler secret put STRIPE_SECRET_KEY
    npx wrangler secret put STRIPE_WEBHOOK_SECRET
    npx wrangler secret put PAYPAL_CLIENT_ID
    npx wrangler secret put PAYPAL_CLIENT_SECRET
    npx wrangler secret put PAYPAL_WEBHOOK_ID

    # 3. pubblicazione
    npm run deploy

Poi in `checkout.html` e `checkout-success.html` aggiornare la costante
`API` con l'indirizzo reale del Worker.

## Webhook da registrare

Stripe → Developers → Webhooks:

    https://<worker>/api/webhooks/stripe
    eventi: checkout.session.completed, checkout.session.expired,
            payment_intent.payment_failed, charge.refunded

PayPal → Apps & Credentials → Webhooks:

    https://<worker>/api/webhooks/paypal
    eventi: CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED,
            PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.REFUNDED,
            CHECKOUT.ORDER.VOIDED

## Aggiungere un servizio

Una sola voce in `src/services.js`, poi `npm run deploy`. Nessuna pagina
nuova, nessun bottone nuovo, nessuna logica di pagamento duplicata.

    'sbiancamento': {
      name: 'Sbiancamento',
      totalPrice: 188,
      paymentMode: 'full',     // paga tutto online
      amountDueNow: 188,
      balanceDueLater: 0,
      requiresAppointment: false
    }

La landing punta a `/checkout.html?service=sbiancamento`. Fine.

## Acconto o prezzo intero

È `paymentMode` a deciderlo:

| valore   | cosa succede                                        |
|----------|-----------------------------------------------------|
| `fixed`  | online si paga `amountDueNow`, il resto in studio    |
| `full`   | online si paga tutto                                 |
| `custom` | lo sceglie il paziente, entro minimum/maximumAmount  |

`custom` va abilitato esplicitamente: un servizio `fixed` o `full` non è
modificabile dal paziente nemmeno manomettendo la richiesta.

## La via semplice: gli avvisi di Stripe

Prima di configurare Resend, valuta gli avvisi che Stripe manda da solo.
Nessun codice, nessun DNS, due spunte:

- **Settings → Notifications → Successful payments**: mail a ogni incasso
- **app Stripe sul telefono**: notifica push istantanea
- **Settings → Customer emails → Successful payments**: ricevuta
  automatica al paziente (non è la conferma dell'appuntamento, ma almeno
  chi paga riceve subito qualcosa di scritto)

Perché basti, mandiamo a Stripe anche i dati della prenotazione. Nella
colonna *Description* dell'elenco pagamenti compare direttamente:

    Rossi Mario · 10/09 ore 10:00 · +39 333 1234567

e aprendo il pagamento trovi nei metadati paziente, telefono,
appuntamento, servizio e saldo da incassare in studio.

Il telefono finisce solo lì: la Description del payment intent non è
visibile al paziente. Su PayPal, dove la descrizione la vede anche lui,
mettiamo servizio e appuntamento ma non il numero.

Con questo l'avviso di Stripe è autosufficiente: sai chi viene, quando e
come richiamarlo senza aprire il database. La mail con il pulsante
WhatsApp precompilato resta disponibile quando la vuoi.

## Avviso allo studio (opzionale)

Quando un pagamento va a buon fine parte una mail **a te**, non al
paziente: la conferma la inoltri tu, così resti in controllo.

Nella mail trovi nome, telefono, email, appuntamento, quanto è stato
incassato e quanto resta da pagare in studio. In fondo c'è un pulsante
che apre WhatsApp verso il paziente con il messaggio di conferma già
scritto: lo rileggi, lo modifichi se vuoi, e invii.

Il numero di telefono viene normalizzato: `333 1234567`, `+39 333-1234567`
e `00393331234567` finiscono tutti sullo stesso link.

### Configurazione

Serve un servizio di posta con API HTTP: i Worker non possono usare SMTP.
Il codice usa **Resend** (piano gratuito 3.000 mail/mese).

1. registrarsi su resend.com e verificare `healthysmile.it` aggiungendo i
   record DNS che indica (SPF e DKIM). Senza, le mail finiscono in spam.
2. impostare le variabili:

       npx wrangler secret put RESEND_API_KEY

   e in `wrangler.toml`, sotto `[vars]`:

       NOTIFY_EMAIL_TO   = "tua@email.it"
       NOTIFY_EMAIL_FROM = "Healthy Smile <prenotazioni@healthysmile.it>"

`NOTIFY_EMAIL_TO` accetta più indirizzi separati da virgola.

### Se la mail non parte

Il pagamento resta valido comunque. L'invio gira in background con
`waitUntil` e ogni errore viene ingoiato dopo essere finito nei log:
un problema con la posta non deve mai far risultare fallito un incasso.
Verificato: con provider irraggiungibile, Stripe riceve `200` e la
prenotazione resta `paid` / `confirmed`.

Per leggere i log:

    npx wrangler tail

Se `RESEND_API_KEY` non è configurata, l'avviso viene semplicemente
saltato: utile per far girare il sistema prima di occuparsi della posta.

## Slot e area amministrativa

Gli orari non stanno piu' in un array dentro la landing: li tiene la
tabella `slots`. La landing chiama `GET /api/slots?service=...` e riceve
solo cio' che e' ancora prenotabile. Uno slot pagato sparisce da solo.

Stati: `available` → `held` (durante il pagamento, con scadenza) →
`booked` (solo dal webhook). `blocked` e' il blocco manuale, per quando
lo studio e' chiuso.

Se il backend non risponde, la landing non resta muta: mostra un invito a
scrivere su WhatsApp invece di un elenco vuoto.

### /admin/prenotazioni

Pagina protetta da una password condivisa, confrontata a tempo costante
lato Worker:

    npx wrangler secret put ADMIN_TOKEN

Senza `ADMIN_TOKEN` configurata l'area resta chiusa a tutti.

Due viste: **Elenco** con filtri per data, servizio e stato, e totali di
incassato e da incassare in studio; **Calendario** con ogni giornata e i
suoi orari, occupati e liberi.

Azioni: cancellare una prenotazione (lo slot torna prenotabile),
segnare no-show, segnare completata, liberare o bloccare uno slot a mano,
aggiungere uno slot nuovo. I numeri di telefono sono link WhatsApp.

La pagina HTML e' pubblica ma non contiene dati: tutto arriva dagli
endpoint autenticati. Per alzare l'asticella si puo' mettere davanti
Cloudflare Access, che aggiunge il login con la mail dello studio.

### Aggiungere date

Dall'area admin, oppure via SQL:

    npx wrangler d1 execute healthysmile-checkout-db --remote \
      --command="INSERT INTO slots (service_id,date,time,status,updated_at)
                 VALUES ('igiene-sonicare','2026-10-08','09:30','available',datetime('now'))"

### Rapporto con TeamUp

Nessuno, per ora, ed e' voluto: il database Healthy Smile e' la fonte
autorevole per gli slot delle landing e il checkout non dipende da
TeamUp. Una sincronizzazione futura puo' leggere `bookings` e scrivere su
TeamUp senza toccare nulla di quanto c'e' qui.

## Slot: dettaglio tecnico

Per i servizi con `requiresAppointment`, una riga per orario in `slots`.
Il passaggio `available → held` è una UPDATE condizionale: se due persone
cliccano nello stesso istante la corsa la risolve il database, non il
codice. `held → confirmed` avviene solo dal webhook, a incasso avvenuto.
Un cron ogni 10 minuti rimette `available` gli hold scaduti.
