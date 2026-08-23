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

## Slot

Per i servizi con `requiresAppointment`, una riga per orario in `slots`.
Il passaggio `available → held` è una UPDATE condizionale: se due persone
cliccano nello stesso istante la corsa la risolve il database, non il
codice. `held → confirmed` avviene solo dal webhook, a incasso avvenuto.
Un cron ogni 10 minuti rimette `available` gli hold scaduti.
