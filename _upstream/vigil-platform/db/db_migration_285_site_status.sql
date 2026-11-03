-- ============================================================
-- Vigil Platform — migration 285: sites.status (สถานะวงจรชีวิตของไซต์)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของขอ 2026-10-31 — ยก vss3 กลับจากไซต์ โดยไม่ลบข้อมูล
-- (284 เว้นไว้ให้ migration public_holidays ในอนาคต)
--   active      = ปกติ
--   maintenance = ปิดปรับปรุงชั่วคราว: ไม่เตือน · ค้นได้ · retention ไม่ลบข้อมูลของไซต์ · ค่าเริ่มต้นไม่รับข้อมูลใหม่ (pause ทุกกล้อง)
--   archived    = เก็บถาวรอ่านอย่างเดียว: เหมือน maintenance + ซ่อนจากหน้าจอสด + ถอนรหัส edge
-- sites 7 แถว · cameras ~170 แถว · ไม่มี UPDATE/backfill (DEFAULT 'active' = ทุกไซต์เดิมคงเดิม) · Idempotent.
-- ============================================================
ALTER TABLE sites ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS status_since TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS status_by VARCHAR(64);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS status_note TEXT;

-- maintenance แบบรับข้อมูลต่อ (ตอนซ่อมแล้วอยากเห็นผล) · ค่าเริ่มต้น FALSE = ไม่รับข้อมูลใหม่
ALTER TABLE sites ADD COLUMN IF NOT EXISTS maintenance_ingest BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_status_chk') THEN
    ALTER TABLE sites ADD CONSTRAINT sites_status_chk CHECK (status IN ('active', 'maintenance', 'archived'));
  END IF;
END $$;

-- กล้องที่ระบบ pause ให้เพราะไซต์เข้า maintenance — เลิก maintenance คืนเฉพาะตัวที่ระบบตั้ง
-- (กล้องที่แอดมิน pause เองไว้ก่อนแล้วต้อง pause ต่อ)
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS paused_by_site BOOLEAN NOT NULL DEFAULT FALSE;
