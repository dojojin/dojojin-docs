-- ============================================================
-- Vigil Platform — migration 073: LPR no_seatbelt column (P2/2A)
-- The seatbelt filter (belt=no) was the ONLY filter matching on the rawXml
-- text slice (LIKE '%<pilotsafebelt>no%'), a seq scan that won't scale. Parse
-- it to an indexed column so the filter is fast AND so rawXml can later expire
-- (class D retention) without breaking the filter. Additive + idempotent.
-- ============================================================

ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS no_seatbelt boolean;

-- Backfill from the stored rawXml slice (pilot/vicepilot flags sit within the
-- 2000-char slice — verified). Sets only true rows; non-matches stay NULL and
-- read as "not flagged" via the `= true` filter. Idempotent.
UPDATE license_plates lp SET no_seatbelt = true
  FROM events e
 WHERE lp.event_id = e.id
   AND (e.raw_json->>'rawXml' LIKE '%<pilotsafebelt>no</pilotsafebelt>%'
     OR e.raw_json->>'rawXml' LIKE '%<vicepilotsafebelt>no</vicepilotsafebelt>%')
   AND lp.no_seatbelt IS DISTINCT FROM true;

-- Partial index — only the (few) flagged rows, keyed by event_id for the join.
CREATE INDEX IF NOT EXISTS idx_plates_no_seatbelt ON license_plates (event_id) WHERE no_seatbelt;
