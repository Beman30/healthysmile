-- Slot delle due giornate di settembre per igiene-sonicare.
-- ATTENZIONE: le date vanno confermate prima di lanciare la campagna.
--   wrangler d1 execute healthysmile-checkout-db --remote --file=./seed-slots.sql
INSERT OR IGNORE INTO slots (service_id, date, time, status, updated_at) VALUES
  ('igiene-sonicare','2026-09-10','09:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-10','10:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-10','11:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-10','14:30','available',datetime('now')),
  ('igiene-sonicare','2026-09-10','15:30','available',datetime('now')),
  ('igiene-sonicare','2026-09-10','16:30','available',datetime('now')),
  ('igiene-sonicare','2026-09-24','09:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-24','10:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-24','11:00','available',datetime('now')),
  ('igiene-sonicare','2026-09-24','14:30','available',datetime('now')),
  ('igiene-sonicare','2026-09-24','15:30','available',datetime('now')),
  ('igiene-sonicare','2026-09-24','16:30','available',datetime('now'));
