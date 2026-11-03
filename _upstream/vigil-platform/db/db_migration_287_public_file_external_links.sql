-- ============================================================
-- Vigil Platform — migration 287: ลิงก์สั้นไปไฟล์ภายนอก (Google Drive / OneDrive) บนระบบแชร์ไฟล์เดิม
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- แถว public_files เป็นได้ 2 แบบ: ไฟล์ที่เก็บเอง (stored_name) หรือ ลิงก์ภายนอก (target_url) — อย่างใดอย่างหนึ่งเท่านั้น
-- • ลิงก์ภายนอกไม่มีไฟล์บนดิสก์ ⇒ stored_name/mime/bytes/sha256 เป็น NULL · ลิงก์สั้น + บันทึกการกดใช้ตารางเดิม (266)
-- • /pub/fil/<code> ของแถวลิงก์ = 302 ไปปลายทาง (คน) / หน้าพรีวิว og (บอท) · ปลายทางตรวจ allowlist ซ้ำตอนเสิร์ฟ
--   (helpers/externalLink.js) · stored_name UNIQUE คงเดิม (NULL ซ้ำกันได้)
-- แถวเดิม ~48 แถวเป็นไฟล์ทั้งหมด ผ่าน CHECK อยู่แล้ว · ไม่มี UPDATE/backfill · Idempotent.
-- ============================================================
ALTER TABLE public_files ADD COLUMN IF NOT EXISTS target_url TEXT;

ALTER TABLE public_files ALTER COLUMN stored_name DROP NOT NULL;
ALTER TABLE public_files ALTER COLUMN mime        DROP NOT NULL;
ALTER TABLE public_files ALTER COLUMN bytes       DROP NOT NULL;
ALTER TABLE public_files ALTER COLUMN sha256      DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_files_kind_chk') THEN
    ALTER TABLE public_files ADD CONSTRAINT public_files_kind_chk CHECK ((target_url IS NULL) <> (stored_name IS NULL));
  END IF;
END $$;
