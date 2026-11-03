-- ============================================================
-- Vigil Platform — migration 109: per-site image retention (R1)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- Every edge prunes on the same number, set through an environment variable
-- that no machine actually sets — so all three run the built-in default of 7
-- days. Their disks differ by 31x:
--
--   hkt   RAID 3.6 TB, 4% used     — kept to 7 days for no reason
--   hdy   NVMe 938 GB, 58% used    — grows ~110 GB/day, 380 GB free
--   vss   NVMe 117 GB, 22% used
--
-- Columns on `sites` rather than a `site_retention` table: it is one row per
-- site either way, and every reader already has the site row in hand.
--
-- NULL means "not set" and the edge keeps its current behaviour — the default
-- is deliberately not written into the rows, so a site nobody has configured
-- behaves exactly as it did before this migration ran.
--
-- lpr/face land here now because R3 is agreed work with a decided baseline
-- (6 days, owner 2026-07-31), not because they might be useful later. R1 wires
-- only events_days and min_free_gb; the other two stay unread until the pruner
-- learns to walk those folders, which is a change that has to be testable on
-- its own — hkt has 111 GB of lpr/ that has never been eligible for deletion.
-- ============================================================

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS retention_events_days integer,
  ADD COLUMN IF NOT EXISTS retention_lpr_days    integer,
  ADD COLUMN IF NOT EXISTS retention_face_days   integer,
  ADD COLUMN IF NOT EXISTS retention_min_free_gb integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_retention_sane_chk') THEN
    -- Bounded in the database as well as the route: these values drive an
    -- unattended `rm -rf` on a remote box. 0 would mean "delete everything".
    ALTER TABLE sites ADD CONSTRAINT sites_retention_sane_chk CHECK (
      (retention_events_days IS NULL OR retention_events_days BETWEEN 1 AND 3650) AND
      (retention_lpr_days    IS NULL OR retention_lpr_days    BETWEEN 1 AND 3650) AND
      (retention_face_days   IS NULL OR retention_face_days   BETWEEN 1 AND 3650) AND
      (retention_min_free_gb IS NULL OR retention_min_free_gb BETWEEN 1 AND 100000)
    );
  END IF;
END $$;

COMMENT ON COLUMN sites.retention_events_days IS
  'อายุรูป events ที่ edge ของไซต์นี้ (วัน) — NULL = ใช้ค่าเดิมของ edge (7 วัน)';
COMMENT ON COLUMN sites.retention_min_free_gb IS
  'ถ้าพื้นที่ว่างต่ำกว่านี้ ให้ลบวันเก่าสุดเพิ่มทันทีโดยไม่รอครบอายุ — NULL = ปิด';
