-- ============================================================
-- Vigil Platform — migration 286: truck_ban_rejections.kind (สถานะ "ไม่แน่ใจ" คู่กับ Reject)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของสั่ง 2026-11-02 — เจ้าหน้าที่ยังไม่แน่ใจว่าเป็นรถเป้าหมายหรือไม่ (เช่น รถหกล้อที่อาจเข้าเกณฑ์ ≥3 เพลา/≥10 ล้อ)
--   reject = ซ่อนถาวร (เหมือนเดิม) · defer = ไม่นับในอันดับ/KPI/PDF/กราฟ เหมือน reject แต่อยู่ในกล่อง "ไม่แน่ใจ" ให้กลับมาตัดสินได้
-- แถวเดิมทุกแถวเป็น 'reject' ผ่าน DEFAULT (ไม่มี UPDATE/backfill) · ตาราง 1 แถวต่อป้าย · Idempotent.
-- ============================================================
ALTER TABLE truck_ban_rejections ADD COLUMN IF NOT EXISTS kind VARCHAR(8) NOT NULL DEFAULT 'reject';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'truck_ban_rejections_kind_chk') THEN
    ALTER TABLE truck_ban_rejections ADD CONSTRAINT truck_ban_rejections_kind_chk CHECK (kind IN ('reject', 'defer'));
  END IF;
END $$;
