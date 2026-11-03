-- ============================================================
-- Vigil Platform — ลด index ของตาราง cameras + เปิดทางให้ HOT update
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- ที่มา: วัดจากของจริง 2026-08-27 ตาราง cameras มี 144 แถว แต่:
--   ขนาด 2,687 MB · dead tuple 99.9% · HOT update แค่ 5.6%
--   SELECT id, site_id FROM cameras (144 แถว) ใช้ 396 ms
--
-- HOT update ทำไม่ได้เพราะทุก UPDATE ของ last_seen_at ต้องไปเขียน index ด้วย
-- พอเป็น non-HOT ทุกครั้ง แถวเก่าก็กลายเป็น dead tuple สะสมไปเรื่อย ๆ
-- (ตัวคิวรีที่ยิงถี่ถูกลดลง 82% ไปแล้วใน commit ก่อนหน้า — ไฟล์นี้แก้อีกครึ่งหนึ่ง)
--
-- สถิติ index ของฐานนี้ **ไม่เคยถูก reset** ⇒ เลข idx_scan = ยอดสะสมตลอดอายุฐาน
-- ตัวที่เป็น 0 จึงแปลว่าไม่เคยถูกใช้จริง ๆ ไม่ใช่แค่ "ช่วงนี้ไม่ได้ใช้":
--   idx_cameras_paused    0 ครั้ง
--   idx_cameras_device    0 ครั้ง
--   idx_cameras_sd_state  0 ครั้ง
--   idx_cameras_group     1 ครั้ง
--   idx_cameras_lastseen  16,544 ครั้ง  ← ถูกใช้จริง แต่ดูเหตุผลข้างล่าง
--
-- ทำไมทิ้ง idx_cameras_lastseen ทั้งที่มีคนใช้: ตารางมี 144 แถว การไล่อ่านทั้ง
-- ตารางเร็วกว่าการเปิด index อยู่แล้วเมื่อ heap กลับมาเล็กตามที่ควรเป็น ส่วนต้นทุน
-- ของมันคือทำให้ UPDATE ทุกครั้งเป็น non-HOT ซึ่งคือต้นเหตุของ 2.7 GB ทั้งก้อน
--
-- ⚠️ ไฟล์นี้ **ไม่มี VACUUM FULL** โดยตั้งใจ — migrate.js ห่อทุก migration ด้วย
-- BEGIN/COMMIT และ VACUUM รันใน transaction block ไม่ได้ จะ error แล้วทำให้
-- api-server บูตไม่ขึ้น (STUBBORN_FACT #81) · การคืนพื้นที่ต้องรันแยกเป็นขั้นตอน
-- ปฏิบัติการ ดู scripts/vacuum-cameras.js
--
-- ⚠️ ลำดับสำคัญ: ตั้ง fillfactor **ก่อน** VACUUM FULL เสมอ — ALTER TABLE ไม่ได้
-- เขียนหน้าเดิมใหม่ มันมีผลกับหน้าที่ถูกเขียนหลังจากนี้เท่านั้น ส่วน VACUUM FULL
-- คือตัวที่เขียนใหม่ทั้งตาราง ถ้าสลับลำดับจะได้ตารางที่อัดแน่นจนไม่เหลือที่ให้ HOT
-- ============================================================

-- ── ทิ้ง index ที่ไม่เคยถูกใช้ ────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_cameras_paused;
DROP INDEX IF EXISTS idx_cameras_device;
DROP INDEX IF EXISTS idx_cameras_sd_state;
DROP INDEX IF EXISTS idx_cameras_group;

-- ── ทิ้งตัวที่บล็อก HOT update ───────────────────────────────────────────────
DROP INDEX IF EXISTS idx_cameras_lastseen;

-- ── เหลือที่ว่างในหน้าให้ HOT update ทำงาน ──────────────────────────────────
ALTER TABLE cameras SET (fillfactor = 70);
