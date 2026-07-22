-- ============================================================
-- Vigil Platform — migration 064: LPR plate-swap dismissals
-- Operator-in-the-loop override for the "สงสัยสวมทะเบียน" (plate-swap) heuristic.
-- The heuristic (same plate, ≥2 vehicle types in 30d) has false positives (OCR
-- misreads vehicle type/province), so an operator can review a plate and dismiss
-- the suspicion. Dismissed plates drop from the suspect KPI, card badge, and the
-- mismatch search filter. Re-armable (DELETE the row). Per-plate, audited.
-- Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS lpr_mismatch_dismissals (
  plate_number    TEXT PRIMARY KEY,
  dismissed_by    TEXT,
  dismissed_by_id INTEGER,
  dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason          TEXT
);
