-- ============================================================
-- Vigil Platform — Migration 189: ลำดับการแสดง site
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เดิมทุกหน้าที่มีแถบ site เรียงตาม s.id = ลำดับที่สร้าง · site ใหม่จึงไปต่อท้าย
-- เสมอและย้ายไม่ได้ (Naratiwas ต่อจาก RMUTR-V ทั้งที่ควรอยู่ข้าง HatYai)
--
-- backfill = id เพื่อให้ "หลัง migrate ทันที" ลำดับเหมือนเดิมเป๊ะ ไม่มีอะไรขยับ
-- ใต้มือเจ้าของโดยไม่ได้สั่ง · การจัดลำดับใหม่เกิดจากการกดปุ่มเท่านั้น
--
-- 🔴 ทุก query ที่เรียง site ต้องใช้ `ORDER BY sort_order, id` เหมือนกันทุกที่
--    (5 จุด: sites.js:57 + traffic.js:175/291/952/1300)
--    · NOT NULL + DEFAULT ทำให้ไม่มีทางเป็น NULL จึงไม่ต้องมี NULLS LAST ที่ไหนเลย
--    · `, id` ต่อท้ายคือตัวตัดสินเมื่อ sort_order ซ้ำกัน — ห้ามตัดออก ไม่งั้นลำดับ
--      จะไม่นิ่งและสองหน้าจะแสดงคนละลำดับโดยไม่มีอะไรฟ้อง
-- ============================================================

ALTER TABLE sites ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- idempotent: รันซ้ำไม่เปลี่ยนอะไร เพราะแตะเฉพาะแถวที่ยังเป็นค่า default 0
UPDATE sites SET sort_order = id WHERE sort_order = 0;

COMMENT ON COLUMN sites.sort_order IS
  'ลำดับที่แสดงในทุกแถบเลือก site · เรียงด้วย ORDER BY sort_order, id เสมอ (id = ตัวตัดสินเมื่อซ้ำ)';
