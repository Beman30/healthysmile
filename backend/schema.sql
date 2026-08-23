-- Healthy Smile — checkout universale
-- D1 (SQLite). Applicare con:
--   wrangler d1 execute healthysmile-checkout-db --remote --file=./schema.sql

-- ─────────────────────────────────────────────────────────────
-- PRENOTAZIONI / PAGAMENTI
-- Generica: vale per igiene, sbiancamento, acconti, qualsiasi servizio.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  booking_id        TEXT PRIMARY KEY,          -- uuid v4, non enumerabile
  service_id        TEXT NOT NULL,

  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  phone             TEXT NOT NULL,
  email             TEXT NOT NULL,

  appointment_date  TEXT,                      -- YYYY-MM-DD, null se non serve
  appointment_time  TEXT,                      -- HH:MM

  total_price       REAL NOT NULL,
  amount_due_now    REAL NOT NULL,
  amount_paid       REAL NOT NULL DEFAULT 0,
  balance_due       REAL NOT NULL,

  payment_mode      TEXT NOT NULL,             -- fixed | full | custom
  payment_provider  TEXT,                      -- stripe | paypal
  payment_id        TEXT,                      -- id sessione/ordine del provider
  payment_status    TEXT NOT NULL DEFAULT 'pending',
                    -- pending | paid | failed | refunded | partially_refunded

  booking_status    TEXT NOT NULL DEFAULT 'awaiting_payment',
                    -- awaiting_payment | held | confirmed | cancelled | no_show | completed

  terms_accepted    INTEGER NOT NULL DEFAULT 0,
  terms_version     TEXT,
  terms_accepted_at TEXT,

  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_payment  ON bookings(payment_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service  ON bookings(service_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status   ON bookings(booking_status);
CREATE INDEX IF NOT EXISTS idx_bookings_email    ON bookings(email);

-- ─────────────────────────────────────────────────────────────
-- SLOT
-- Solo per i servizi con requiresAppointment. Una riga per orario.
-- L'unicita' su (service_id, date, time) e' cio' che impedisce
-- fisicamente la doppia prenotazione.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slots (
  service_id   TEXT NOT NULL,
  date         TEXT NOT NULL,                  -- YYYY-MM-DD
  time         TEXT NOT NULL,                  -- HH:MM
  status       TEXT NOT NULL DEFAULT 'available',
               -- available | held | confirmed | blocked
  booking_id   TEXT,
  held_until   TEXT,                           -- ISO, oltre il quale l'hold scade
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (service_id, date, time)
);

CREATE INDEX IF NOT EXISTS idx_slots_lookup ON slots(service_id, date, status);

-- ─────────────────────────────────────────────────────────────
-- LOG WEBHOOK
-- Serve a due cose: idempotenza (stesso evento consegnato due volte non
-- deve pagare due volte) e diagnosi quando un pagamento "non risulta".
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id     TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  event_type   TEXT,
  booking_id   TEXT,
  received_at  TEXT NOT NULL,
  payload      TEXT
);
