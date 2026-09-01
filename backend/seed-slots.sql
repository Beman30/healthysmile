-- Slot della giornata di settembre per igiene-sonicare.
--
--   martedì 8 settembre 2026, 10:00–18:00, pausa alle 13:00
--
-- Appuntamenti da un'ora. Se la seduta dura di più — visita completa,
-- 45 minuti di igiene e consegna dello spazzolino non stanno sempre in
-- sessanta minuti — togliere qualche riga qui sotto: meglio pochi slot
-- veri che sette che poi si accavallano.
--
-- Applicare con:
--   wrangler d1 execute healthysmile-checkout-db --remote --file=./seed-slots.sql
--
-- Per aggiungere altre giornate in seguito non serve toccare questo
-- file: si fa dall'area /admin/prenotazioni.

INSERT OR IGNORE INTO slots (service_id, date, time, status, updated_at) VALUES
  ('igiene-sonicare','2026-09-08','10:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-08','11:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-08','12:00','available',datetime('now')),
  -- pausa alle 13:00
  ('igiene-sonicare','2026-09-08','14:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-08','15:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-08','16:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-08','17:00','available',datetime('now'));
