-- ============================================================
-- Vigil Platform — migration 111: per-folder image inventory from the edge
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- R3 lets a site prune lpr/ and face/, and the first run at the agreed 6-day
-- baseline is not something to find out about afterwards. Rather than build a
-- dry-run mode on the edge — a simulate-a-delete path is one more thing that
-- can be wrong in the direction that destroys data — the edge reports which
-- date-dirs each folder actually holds, and central works out what a proposed
-- retention would remove from numbers the site really has.
--
-- Names only, no byte sizes: `du` over hkt's 178 GB of small LPR files is not
-- an hourly operation, and "24 of 30 days would go" is the actionable number
-- anyway.
-- ============================================================

ALTER TABLE edge_status
  ADD COLUMN IF NOT EXISTS inventory_json jsonb;

COMMENT ON COLUMN edge_status.inventory_json IS
  'โฟลเดอร์รูปที่ edge มีจริง แยกตามชนิด → { events|lpr|face: { oldest, dirs, dates[] } } ใช้คำนวณว่าถ้าตั้ง N วันจะลบกี่วัน';
