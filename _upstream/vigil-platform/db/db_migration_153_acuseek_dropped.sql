-- ============================================================
-- Vigil Platform — AcuSeek: บันทึกคำที่ "รู้จักแต่ไม่ได้ใช้"
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ============================================================
-- คอลัมน์ unknown เดิมเก็บ "คำที่ระบบไม่รู้จัก" ซึ่งจับได้เฉพาะคำนอกตาราง
-- แต่จากการวัด 28 คำค้น (2026-08-14) พบว่าคำค้นพลาด ~10 รายการ และ 4 รายการ
-- ที่พลาดหนักที่สุดมี unknown = ว่าง เพราะระบบ *อ่านคำออก* แต่ *ไม่ได้ใช้*:
--
--   คนอุ้มแมว            → a cat carrying a child   (ประธานสลับ คนหาย)
--   คนจูงหมา             → a dog                    (คนหายทั้งคน)
--   คนเข็นรถเข็น          → a street food stall cart (คนหายทั้งคน)
--   คนใส่หมวกกันน็อคสีขาว → a person wearing a helmet (สีขาวหาย)
--
-- เก็บเป็น JSONB เพราะต้องรู้ทั้ง "ประเภทที่หาย" (person/color/collapse) และ
-- "คำไหนที่หาย" เพื่อเอาไปตัดสินใจเรื่องตัวแปลภาษาในอีก 1-2 สัปดาห์
-- ============================================================

ALTER TABLE acuseek_queries
  ADD COLUMN IF NOT EXISTS dropped JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN acuseek_queries.dropped IS
  'คำที่ระบบอ่านออกแต่ไม่ได้ส่งไปค้น — [{why,th,note}] · why = person|color|collapse';
