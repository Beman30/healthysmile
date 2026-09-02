/**
 * Healthy Smile — checkout universale
 *
 * Un solo Worker per tutti i servizi. Le landing non sanno nulla di
 * prezzi: mandano un service_id e questo backend decide il resto.
 */
import { getService, resolveAmounts, publicService, SERVICES } from './services.js';
import { createCheckoutSession, getSession, verifyStripeSignature } from './stripe.js';
import { createOrder, captureOrder, getOrder, verifyWebhook as verifyPaypal } from './paypal.js';
import { notifyStudio } from './notify.js';

const HOLD_MINUTES = 20; // quanto resta bloccato uno slot durante il pagamento

/* ── utilita' ─────────────────────────────────────────────── */

const now = () => new Date().toISOString();

function cors(env, request) {
  const allowed = (env.ALLOWED_ORIGINS || 'https://healthysmile.it')
    .split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    // Authorization serve all'area admin: senza, il preflight del
    // browser blocca ogni chiamata autenticata.
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, env, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env, request) },
  });
}

const ok = (d, env, r) => json(d, 200, env, r);
const bad = (m, env, r, s = 400) => json({ error: m }, s, env, r);

/* ── validazione dei dati paziente ────────────────────────── */

function validatePatient(b) {
  const errs = [];
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const first = s(b.first_name), last = s(b.last_name);
  const phone = s(b.phone), email = s(b.email);

  if (first.length < 2) errs.push('Nome mancante o troppo corto');
  if (last.length < 2) errs.push('Cognome mancante o troppo corto');
  if (!/^[+0-9 ().-]{6,25}$/.test(phone)) errs.push('Telefono non valido');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) errs.push('Email non valida');
  if (b.terms_accepted !== true) errs.push('Devi accettare le condizioni di prenotazione');

  return { errs, clean: { first_name: first, last_name: last, phone, email } };
}

/* ── slot: available → held → confirmed ───────────────────── */

async function holdSlot(db, serviceId, date, time, bookingId) {
  const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60000).toISOString();
  // Una sola UPDATE condizionale: se due persone cliccano nello stesso
  // istante, solo una trova la riga ancora prenotabile. La corsa la
  // risolve il database, non il codice.
  const r = await db
    .prepare(
      `UPDATE slots SET status='held', booking_id=?, held_until=?, updated_at=?
         WHERE service_id=? AND date=? AND time=?
           AND (status='available' OR (status='held' AND held_until < ?))`
    )
    .bind(bookingId, heldUntil, now(), serviceId, date, time, now())
    .run();
  return r.meta.changes === 1;
}

async function bookSlot(db, bookingId) {
  await db.prepare(
    `UPDATE slots SET status='booked', held_until=NULL, updated_at=? WHERE booking_id=?`
  ).bind(now(), bookingId).run();
}

/** Rimette in vendita uno slot, qualunque sia lo stato di partenza. */
async function freeSlot(db, { bookingId, serviceId, date, time }) {
  if (bookingId) {
    return db.prepare(
      `UPDATE slots SET status='available', booking_id=NULL, held_until=NULL, updated_at=?
         WHERE booking_id=?`
    ).bind(now(), bookingId).run();
  }
  return db.prepare(
    `UPDATE slots SET status='available', booking_id=NULL, held_until=NULL, updated_at=?
       WHERE service_id=? AND date=? AND time=?`
  ).bind(now(), serviceId, date, time).run();
}

/** Annulla un hold non pagato. Diversa da freeSlot: agisce solo se lo
 *  slot e' ancora 'held', quindi non puo' liberare per sbaglio uno slot
 *  gia' pagato da qualcun altro. */
async function releaseSlot(db, bookingId) {
  await db.prepare(
    `UPDATE slots SET status='available', booking_id=NULL, held_until=NULL, updated_at=?
       WHERE booking_id=? AND status='held'`
  ).bind(now(), bookingId).run();
}

/* ── creazione prenotazione + avvio pagamento ─────────────── */

async function startCheckout(request, env, provider) {
  const body = await request.json().catch(() => null);
  if (!body) return bad('Richiesta non valida', env, request);

  const service = getService(body.service_id);
  if (!service) return bad('Servizio non riconosciuto', env, request);

  const { errs, clean } = validatePatient(body);
  if (errs.length) return bad(errs.join('. '), env, request);

  let amounts;
  try {
    // requestedAmount viene guardato SOLO se il servizio e' "custom"
    amounts = resolveAmounts(service, body.requested_amount);
  } catch (e) {
    return bad(e.message, env, request);
  }

  let date = null, time = null;
  if (service.requiresAppointment) {
    date = String(body.date || '');
    time = String(body.time || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return bad('Data o ora mancanti', env, request);
    }
  }

  const bookingId = crypto.randomUUID();
  const db = env.DB;

  if (service.requiresAppointment) {
    const held = await holdSlot(db, body.service_id, date, time, bookingId);
    if (!held) return bad('Questo orario è appena stato prenotato. Scegline un altro.', env, request, 409);
  }

  await db.prepare(
    `INSERT INTO bookings (
       booking_id, service_id, first_name, last_name, phone, email,
       appointment_date, appointment_time,
       total_price, amount_due_now, amount_paid, balance_due,
       payment_mode, payment_provider, payment_status, booking_status,
       terms_accepted, terms_version, terms_accepted_at, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,'pending',?,1,?,?,?,?)`
  ).bind(
    bookingId, body.service_id, clean.first_name, clean.last_name, clean.phone, clean.email,
    date, time,
    amounts.totalPrice, amounts.amountDueNow, amounts.balanceDueLater,
    service.paymentMode, provider,
    service.requiresAppointment ? 'held' : 'awaiting_payment',
    service.termsVersion, now(), now(), now()
  ).run();

  const successUrl = `${env.SITE_URL}/checkout-success.html`;
  const cancelUrl = `${env.SITE_URL}/checkout.html?service=${encodeURIComponent(body.service_id)}`
    + (date ? `&date=${date}&time=${encodeURIComponent(time)}` : '')
    + '&annullato=1';

  // passato ai provider: serve a far comparire nome, telefono e
  // appuntamento nelle loro dashboard, cosi' l'avviso automatico di
  // Stripe basta senza consultare il nostro database
  const booking = {
    booking_id: bookingId,
    service_id: body.service_id,
    email: clean.email,
    first_name: clean.first_name,
    last_name: clean.last_name,
    phone: clean.phone,
    date, time,
  };

  try {
    const session = provider === 'stripe'
      ? await createCheckoutSession(env, { booking, service, amounts, successUrl, cancelUrl })
      : await createOrder(env, { booking, service, amounts, successUrl, cancelUrl });

    await db.prepare(`UPDATE bookings SET payment_id=?, updated_at=? WHERE booking_id=?`)
      .bind(session.id, now(), bookingId).run();

    return ok({ booking_id: bookingId, redirect_url: session.url }, env, request);
  } catch (e) {
    await releaseSlot(db, bookingId);
    await db.prepare(
      `UPDATE bookings SET payment_status='failed', booking_status='cancelled', updated_at=? WHERE booking_id=?`
    ).bind(now(), bookingId).run();
    return bad(`Non riusciamo ad avviare il pagamento. ${e.message}`, env, request, 502);
  }
}

/* ── esito pagamento (chiamato dai webhook) ───────────────── */

async function markPaid(db, bookingId, paidAmount, providerPaymentId) {
  const b = await db.prepare(`SELECT * FROM bookings WHERE booking_id=?`).bind(bookingId).first();
  if (!b) return null;
  if (b.payment_status === 'paid') return null; // idempotente: webhook ripetuto = niente

  const balance = Math.round((b.total_price - paidAmount) * 100) / 100;
  await db.prepare(
    `UPDATE bookings SET amount_paid=?, balance_due=?, payment_status='paid',
       booking_status='confirmed', payment_id=COALESCE(?,payment_id), updated_at=?
     WHERE booking_id=?`
  ).bind(paidAmount, balance, providerPaymentId || null, now(), bookingId).run();

  await bookSlot(db, bookingId);

  // restituita al chiamante, che ci manda l'avviso allo studio.
  // Torna null se era gia' pagata: cosi' l'avviso parte una volta sola.
  return { ...b, amount_paid: paidAmount, balance_due: balance };
}

async function markFailed(db, bookingId) {
  await db.prepare(
    `UPDATE bookings SET payment_status='failed', booking_status='cancelled', updated_at=?
       WHERE booking_id=? AND payment_status='pending'`
  ).bind(now(), bookingId).run();
  await releaseSlot(db, bookingId);
}

async function seen(db, eventId, provider, type, bookingId, payload) {
  try {
    await db.prepare(
      `INSERT INTO webhook_events (event_id, provider, event_type, booking_id, received_at, payload)
       VALUES (?,?,?,?,?,?)`
    ).bind(eventId, provider, type, bookingId || null, now(), payload.slice(0, 8000)).run();
    return false; // non ancora visto
  } catch {
    return true;  // chiave duplicata: evento gia' processato
  }
}


/**
 * Manda l'avviso allo studio. Gira in background con waitUntil: il
 * provider riceve subito il 200 e non riprova. Qualsiasi errore viene
 * ingoiato: un problema con la posta non deve mai trasformarsi in un
 * pagamento che risulta fallito.
 */
function alertStudio(ctx, env, booking) {
  const service = getService(booking.service_id);
  const name = service ? service.name : booking.service_id;
  const p = notifyStudio(env, booking, name).catch(() => false);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}


/* ── AREA AMMINISTRATIVA ──────────────────────────────────────
   Protetta da un token condiviso (ADMIN_TOKEN, secret del Worker).
   Il confronto e' a tempo costante: un confronto normale con === puo'
   rivelare quanti caratteri iniziali sono corretti.
   Per alzare l'asticella si puo' mettere davanti Cloudflare Access.  */

function adminOk(request, env) {
  if (!env.ADMIN_TOKEN) return false;               // niente token = area chiusa
  const h = request.headers.get('Authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(env.ADMIN_TOKEN);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function adminRoutes(request, env, url, path) {
  if (!adminOk(request, env)) return bad('Non autorizzato', env, request, 401);
  const db = env.DB;

  // elenco prenotazioni, con filtri
  if (request.method === 'GET' && path === '/api/admin/bookings') {
    const cond = [], args = [];
    const date = url.searchParams.get('date');
    const service = url.searchParams.get('service');
    const status = url.searchParams.get('status');
    const from = url.searchParams.get('from');
    if (date) { cond.push('appointment_date=?'); args.push(date); }
    if (from) { cond.push('(appointment_date IS NULL OR appointment_date>=?)'); args.push(from); }
    if (service) { cond.push('service_id=?'); args.push(service); }
    if (status) { cond.push('booking_status=?'); args.push(status); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const { results } = await db.prepare(
      `SELECT booking_id, service_id, first_name, last_name, phone, email,
              appointment_date, appointment_time, total_price, amount_due_now,
              amount_paid, balance_due,
              payment_provider, payment_status, booking_status, created_at
         FROM bookings ${where}
        ORDER BY appointment_date IS NULL, appointment_date, appointment_time, created_at`
    ).bind(...args).all();
    const rows = (results || []).map((r) => {
      const svc = getService(r.service_id);
      return { ...r, service_name: svc ? svc.name : r.service_id };
    });
    return ok({ bookings: rows }, env, request);
  }

  // calendario: ogni slot con, se occupato, chi lo occupa
  if (request.method === 'GET' && path === '/api/admin/calendar') {
    const service = url.searchParams.get('service');
    const cond = [], args = [];
    if (service) { cond.push('s.service_id=?'); args.push(service); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const { results } = await db.prepare(
      `SELECT s.service_id, s.date, s.time, s.status, s.booking_id, s.held_until,
              b.first_name, b.last_name, b.phone, b.amount_paid, b.payment_status, b.booking_status
         FROM slots s LEFT JOIN bookings b ON b.booking_id = s.booking_id
         ${where}
        ORDER BY s.date, s.time`
    ).bind(...args).all();
    const rows = (results || []).map((r) => {
      const svc = getService(r.service_id);
      // un hold scaduto e' di fatto libero: mostralo per quello che e'
      const scaduto = r.status === 'held' && r.held_until && r.held_until < now();
      return { ...r, status: scaduto ? 'available' : r.status,
               service_name: svc ? svc.name : r.service_id };
    });
    return ok({ calendar: rows }, env, request);
  }

  // cambia stato a una prenotazione
  if (request.method === 'POST' && path === '/api/admin/booking-status') {
    const body = await request.json().catch(() => ({}));
    const valid = ['confirmed', 'cancelled', 'no_show', 'completed'];
    if (!valid.includes(body.status)) return bad('Stato non valido', env, request);
    const b = await db.prepare(`SELECT * FROM bookings WHERE booking_id=?`).bind(body.booking_id).first();
    if (!b) return bad('Prenotazione non trovata', env, request, 404);

    await db.prepare(`UPDATE bookings SET booking_status=?, updated_at=? WHERE booking_id=?`)
      .bind(body.status, now(), body.booking_id).run();

    // cancellata: lo slot torna in vendita. no_show e completata invece
    // restano occupati, sono appuntamenti passati.
    if (body.status === 'cancelled') await freeSlot(db, { bookingId: body.booking_id });

    return ok({ booking_id: body.booking_id, booking_status: body.status }, env, request);
  }

  /* Registra a mano un incasso avvenuto fuori dal sistema.

     Serve quando il pagamento e' andato a buon fine dal fornitore ma la
     notifica non e' arrivata o e' stata scartata: senza questo, il paziente
     ha pagato e per lo studio non esiste, e il suo orario resta in vendita.
     Usa la stessa funzione dei webhook, quindi prenota lo slot e segna la
     prenotazione confermata esattamente allo stesso modo. */
  if (request.method === 'POST' && path === '/api/admin/booking-mark-paid') {
    const body = await request.json().catch(() => ({}));
    const importo = Number(body.amount_paid);
    if (!Number.isFinite(importo) || importo <= 0) return bad('Importo non valido', env, request);

    const b = await db.prepare(`SELECT payment_status FROM bookings WHERE booking_id=?`)
      .bind(body.booking_id).first();
    if (!b) return bad('Prenotazione non trovata', env, request, 404);
    if (b.payment_status === 'paid') return bad('Risulta gia' + String.fromCharCode(39) + ' pagata', env, request);

    const paid = await markPaid(db, body.booking_id, importo, body.payment_id || null);
    if (!paid) return bad('Non e' + String.fromCharCode(39) + ' stato possibile registrare il pagamento', env, request);

    /* Riaggancio dell'orario.

       markPaid prenota lo slot cercandolo per booking_id. Ma se il lavoro
       automatico ha gia' scaduto la prenotazione, quel collegamento e' stato
       azzerato: la ricerca non trova nulla e l'orario resterebbe in vendita
       anche dopo aver registrato l'incasso. Qui lo si ritrova per data e ora.

       Se nel frattempo l'orario e' stato preso da qualcun altro non lo si
       tocca: si registra comunque il pagamento e si avvisa, perche' e' una
       sovrapposizione che deve risolvere una persona, non il codice.        */
    let avviso = null;
    if (paid.appointment_date && paid.appointment_time) {
      const slot = await db.prepare(
        `SELECT status, booking_id FROM slots WHERE service_id=? AND date=? AND time=?`
      ).bind(paid.service_id, paid.appointment_date, paid.appointment_time).first();

      if (!slot) {
        avviso = 'Registrata, ma quell' + String.fromCharCode(39) + 'orario non esiste piu' + String.fromCharCode(39) + ' in calendario.';
      } else if (slot.booking_id && slot.booking_id !== body.booking_id) {
        avviso = 'ATTENZIONE: quell' + String.fromCharCode(39) + 'orario risulta gia' + String.fromCharCode(39) + ' assegnato a un' + String.fromCharCode(39) + 'altra prenotazione.';
      } else {
        await db.prepare(
          `UPDATE slots SET status='booked', booking_id=?, held_until=NULL, updated_at=?
             WHERE service_id=? AND date=? AND time=?`
        ).bind(body.booking_id, now(), paid.service_id, paid.appointment_date, paid.appointment_time).run();
      }
    }

    return ok({ booking_id: body.booking_id, amount_paid: importo,
                payment_status: 'paid', avviso }, env, request);
  }

  /* Elimina definitivamente una prenotazione. Serve per ripulire le righe
     di prova: "cancellata" libera l'orario ma lascia la riga in elenco.

     L'orario va liberato PRIMA di cancellare la riga: farlo dopo, o non
     farlo, lascerebbe uno slot segnato come occupato da una prenotazione
     che non esiste piu' — invisibile in elenco e non piu' recuperabile.

     Le righe di webhook_events restano dove sono: sono il registro di cio'
     che i fornitori di pagamento hanno comunicato, non dati della
     prenotazione, e servono a non riprocessare due volte la stessa notifica. */
  if (request.method === 'POST' && path === '/api/admin/booking-delete') {
    const body = await request.json().catch(() => ({}));
    const b = await db.prepare(`SELECT booking_id FROM bookings WHERE booking_id=?`)
      .bind(body.booking_id).first();
    if (!b) return bad('Prenotazione non trovata', env, request, 404);

    await freeSlot(db, { bookingId: b.booking_id });
    await db.prepare(`DELETE FROM bookings WHERE booking_id=?`).bind(b.booking_id).run();

    return ok({ booking_id: b.booking_id, deleted: true }, env, request);
  }

  // libera uno slot a mano, o lo blocca perche' lo studio e' chiuso
  if (request.method === 'POST' && path === '/api/admin/slot-status') {
    const body = await request.json().catch(() => ({}));
    const { service_id, date, time } = body;
    if (!service_id || !date || !time) return bad('Dati slot mancanti', env, request);

    if (body.status === 'available') {
      await freeSlot(db, { serviceId: service_id, date, time });
    } else if (body.status === 'blocked') {
      await db.prepare(
        `UPDATE slots SET status='blocked', booking_id=NULL, held_until=NULL, updated_at=?
           WHERE service_id=? AND date=? AND time=?`
      ).bind(now(), service_id, date, time).run();
    } else return bad('Stato non valido', env, request);

    return ok({ service_id, date, time, status: body.status }, env, request);
  }

  // aggiunge uno slot nuovo
  if (request.method === 'POST' && path === '/api/admin/slot-create') {
    const body = await request.json().catch(() => ({}));
    const { service_id, date, time } = body;
    if (!getService(service_id)) return bad('Servizio non riconosciuto', env, request);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) {
      return bad('Data o ora non valide', env, request);
    }
    await db.prepare(
      `INSERT OR IGNORE INTO slots (service_id,date,time,status,updated_at) VALUES (?,?,?,'available',?)`
    ).bind(service_id, date, time, now()).run();
    return ok({ service_id, date, time, status: 'available' }, env, request);
  }

  return bad('Endpoint non trovato', env, request, 404);
}

/* ── router ───────────────────────────────────────────────── */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env, request) });
    }

    // GET /api/services/:id — il frontend chiede nome e prezzi
    if (request.method === 'GET' && path.startsWith('/api/services/')) {
      const id = decodeURIComponent(path.slice('/api/services/'.length));
      const s = getService(id);
      if (!s) return bad('Servizio non riconosciuto', env, request, 404);
      return ok(publicService(id, s), env, request);
    }

    // GET /api/slots?service=..&date=.. — orari ancora liberi
    if (request.method === 'GET' && path === '/api/slots') {
      const service = url.searchParams.get('service');
      const date = url.searchParams.get('date');
      if (!getService(service)) return bad('Servizio non riconosciuto', env, request, 404);
      const q = date
        ? env.DB.prepare(
            `SELECT date, time FROM slots
               WHERE service_id=? AND date=?
                 AND (status='available' OR (status='held' AND held_until < ?))
               ORDER BY time`
          ).bind(service, date, now())
        : env.DB.prepare(
            `SELECT date, time FROM slots
               WHERE service_id=?
                 AND (status='available' OR (status='held' AND held_until < ?))
               ORDER BY date, time`
          ).bind(service, now());
      const { results } = await q.all();
      return ok({ slots: results || [] }, env, request);
    }

    // GET /api/bookings/:id — la success page legge i dati reali
    if (request.method === 'GET' && path.startsWith('/api/bookings/')) {
      const id = decodeURIComponent(path.slice('/api/bookings/'.length));
      const b = await env.DB.prepare(
        `SELECT booking_id, service_id, first_name, appointment_date, appointment_time,
                total_price, amount_paid, balance_due, payment_status, booking_status
           FROM bookings WHERE booking_id=?`
      ).bind(id).first();
      if (!b) return bad('Prenotazione non trovata', env, request, 404);
      const s = getService(b.service_id);
      return ok({ ...b, service_name: s ? s.name : b.service_id }, env, request);
    }

    if (path.startsWith('/api/admin/')) return adminRoutes(request, env, url, path);

    if (request.method === 'POST' && path === '/api/checkout/stripe') return startCheckout(request, env, 'stripe');
    if (request.method === 'POST' && path === '/api/checkout/paypal') return startCheckout(request, env, 'paypal');

    /* Verifica al ritorno da Stripe.

       Stessa lezione imparata con PayPal: un pagamento non deve dipendere
       da un solo canale. Se il webhook si perde, senza questo il paziente
       ha pagato e il sistema non lo sa — e un'ora dopo il lavoro
       automatico gli cancella pure la prenotazione. Qui andiamo a
       chiedere a Stripe direttamente, e se risulta incassato lo
       registriamo. Il webhook resta, come seconda strada.              */
    if (request.method === 'POST' && path === '/api/checkout/stripe/verify') {
      const body = await request.json().catch(() => ({}));
      if (!body.booking_id) return bad('Dati mancanti', env, request);

      const b = await env.DB.prepare(
        `SELECT payment_id, payment_status FROM bookings WHERE booking_id=?`
      ).bind(body.booking_id).first();
      if (!b) return bad('Prenotazione non trovata', env, request, 404);
      if (b.payment_status === 'paid') return ok({ payment_status: 'paid' }, env, request);
      if (!b.payment_id) return ok({ payment_status: 'pending' }, env, request);

      let s;
      try { s = await getSession(env, b.payment_id); }
      catch (e) { return bad(e.message, env, request, 502); }

      // l'importo lo prendiamo da Stripe, mai da chi ci sta chiamando
      if (s.payment_status === 'paid') {
        const paid = await markPaid(env.DB, body.booking_id,
          (s.amount_total || 0) / 100, s.payment_intent || s.id);
        if (paid) alertStudio(ctx, env, paid);
        return ok({ payment_status: 'paid' }, env, request);
      }
      return ok({ payment_status: s.payment_status || 'pending' }, env, request);
    }

    /* Cattura al ritorno dal sito di PayPal.

       PayPal riporta il compratore qui appena approva, ma approvato non vuol
       dire incassato: la cattura va chiesta noi. Farla dipendere solo dal
       webhook lascia la prenotazione in sospeso ogni volta che quello tarda,
       si perde o non e' configurato — e il paziente vede "pagamento in
       verifica" all'infinito con i soldi mai presi. Il webhook resta come
       rete di sicurezza per chi chiude il browser durante il rientro.      */
    if (request.method === 'POST' && path === '/api/checkout/paypal/capture') {
      const body = await request.json().catch(() => ({}));
      const bookingId = body.booking_id, orderId = body.order_id;
      if (!bookingId || !orderId) return bad('Dati mancanti', env, request);

      const b = await env.DB.prepare(`SELECT payment_status FROM bookings WHERE booking_id=?`)
        .bind(bookingId).first();
      if (!b) return bad('Prenotazione non trovata', env, request, 404);
      if (b.payment_status === 'paid') return ok({ payment_status: 'paid' }, env, request);

      let order;
      try {
        order = await captureOrder(env, orderId);
      } catch (e) {
        // tipicamente ORDER_ALREADY_CAPTURED: il webhook e' arrivato prima.
        // Non e' un errore, si rilegge l'ordine per vedere com'e' andata.
        order = await getOrder(env, orderId).catch(() => null);
        if (!order) return bad('Pagamento non completato', env, request);
      }

      // L'ordine deve appartenere a questa prenotazione: senza questo
      // controllo chiunque potrebbe far risultare pagata la prenotazione di
      // un altro passando un order_id qualsiasi.
      const unit = order.purchase_units?.[0];
      if (unit?.custom_id !== bookingId) return bad('Ordine non corrispondente', env, request, 403);

      const cap = unit?.payments?.captures?.[0];
      if (order.status === 'COMPLETED' && cap) {
        const paid = await markPaid(env.DB, bookingId, Number(cap.amount.value), cap.id);
        if (paid) alertStudio(ctx, env, paid);
        return ok({ payment_status: 'paid' }, env, request);
      }
      return ok({ payment_status: 'pending' }, env, request);
    }

    // ── WEBHOOK STRIPE ──
    if (request.method === 'POST' && path === '/api/webhooks/stripe') {
      const raw = await request.text();
      const valid = await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
      if (!valid) return new Response('firma non valida', { status: 400 });

      const event = JSON.parse(raw);
      const obj = event.data?.object || {};
      const bookingId = obj.metadata?.booking_id || obj.client_reference_id;
      if (await seen(env.DB, event.id, 'stripe', event.type, bookingId, raw)) {
        return new Response('gia processato', { status: 200 });
      }

      if (event.type === 'checkout.session.completed' && obj.payment_status === 'paid') {
        const paid = await markPaid(env.DB, bookingId, (obj.amount_total || 0) / 100, obj.payment_intent || obj.id);
        if (paid) alertStudio(ctx, env, paid);
      } else if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
        await markFailed(env.DB, bookingId);
      } else if (event.type === 'charge.refunded') {
        const full = obj.amount_refunded >= obj.amount;
        await env.DB.prepare(
          `UPDATE bookings SET payment_status=?, booking_status='cancelled', updated_at=? WHERE booking_id=?`
        ).bind(full ? 'refunded' : 'partially_refunded', now(), bookingId).run();
        await releaseSlot(env.DB, bookingId);
      }
      return new Response('ok', { status: 200 });
    }

    // ── WEBHOOK PAYPAL ──
    if (request.method === 'POST' && path === '/api/webhooks/paypal') {
      const raw = await request.text();
      if (!(await verifyPaypal(env, request.headers, raw))) {
        return new Response('firma non valida', { status: 400 });
      }
      const event = JSON.parse(raw);
      const res = event.resource || {};
      const bookingId =
        res.custom_id ||
        res.purchase_units?.[0]?.custom_id ||
        res.purchase_units?.[0]?.reference_id;

      if (await seen(env.DB, event.id, 'paypal', event.event_type, bookingId, raw)) {
        return new Response('gia processato', { status: 200 });
      }

      if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
        // approvato non vuol dire incassato: si cattura e si aspetta l'esito
        const cap = await captureOrder(env, res.id);
        const unit = cap.purchase_units?.[0]?.payments?.captures?.[0];
        if (cap.status === 'COMPLETED' && unit) {
          const paid = await markPaid(env.DB, bookingId, Number(unit.amount.value), unit.id);
          if (paid) alertStudio(ctx, env, paid);
        }
      } else if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const paid = await markPaid(env.DB, bookingId, Number(res.amount?.value || 0), res.id);
        if (paid) alertStudio(ctx, env, paid);
      } else if (['PAYMENT.CAPTURE.DENIED', 'CHECKOUT.ORDER.VOIDED'].includes(event.event_type)) {
        await markFailed(env.DB, bookingId);
      } else if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
        await env.DB.prepare(
          `UPDATE bookings SET payment_status='refunded', booking_status='cancelled', updated_at=? WHERE booking_id=?`
        ).bind(now(), bookingId).run();
        await releaseSlot(env.DB, bookingId);
      }
      return new Response('ok', { status: 200 });
    }

    if (path === '/api/health') {
      return ok({ status: 'ok', services: Object.keys(SERVICES) }, env, request);
    }

    return bad('Endpoint non trovato', env, request, 404);
  },

  /**
   * Cron: libera gli slot il cui hold e' scaduto senza pagamento.
   * Senza questo, un checkout abbandonato terrebbe l'orario occupato
   * per sempre.
   */
  async scheduled(_event, env) {
    const scaduto = new Date(Date.now() - 60 * 60000).toISOString();

    /* Prima di dare per abbandonata una prenotazione, si chiede a Stripe
       se per caso il pagamento e' andato a buon fine e la notifica si e'
       persa per strada. Senza questo controllo il sistema archivia come
       "fallito" un incasso realmente avvenuto, libera l'orario venduto e
       cancella l'unica traccia che il paziente esiste: e' esattamente
       quello che e' successo in produzione. */
    const { results } = await env.DB.prepare(
      `SELECT booking_id, payment_id, payment_provider FROM bookings
        WHERE booking_status='held' AND payment_status='pending' AND created_at < ?`
    ).bind(scaduto).all();

    const abbandonate = [];
    for (const b of results || []) {
      let incassato = false;
      if (b.payment_provider === 'stripe' && b.payment_id) {
        try {
          const s = await getSession(env, b.payment_id);
          if (s.payment_status === 'paid') {
            await markPaid(env.DB, b.booking_id, (s.amount_total || 0) / 100,
                           s.payment_intent || s.id);
            incassato = true;
          }
        } catch (e) {
          // Stripe irraggiungibile: nel dubbio non si cancella nulla,
          // si riprova al giro dopo. Meglio un orario fermo dieci minuti
          // in piu' che una prenotazione pagata buttata via.
          incassato = true;
        }
      }
      if (!incassato) abbandonate.push(b.booking_id);
    }

    for (const id of abbandonate) {
      await env.DB.prepare(
        `UPDATE bookings SET booking_status='cancelled', payment_status='failed', updated_at=?
           WHERE booking_id=?`
      ).bind(now(), id).run();
    }

    // gli orari si liberano solo dopo aver deciso, non prima
    await env.DB.prepare(
      `UPDATE slots SET status='available', booking_id=NULL, held_until=NULL, updated_at=?
         WHERE status='held' AND held_until < ?`
    ).bind(now(), now()).run();
  },
};
