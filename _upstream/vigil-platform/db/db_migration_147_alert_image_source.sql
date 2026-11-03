-- ============================================================
-- Vigil Platform — migration 147: อายุลิงก์รูปของเราเอง + ทางสำรอง imgbb ที่ตรวจได้
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- เจ้าของถาม 2026-08-13: "แนบรูปทำไมยังเป็น imgbb ไม่ใช่จาก platform เรา?"
-- ตรวจแล้วพบว่า**เสิร์ฟจากโดเมนเราอยู่แล้ว** (signedImageUrl) imgbb เป็นแค่ทางสำรอง
-- แต่มีปัญหาจริง 2 ข้อ:
--
--   1) ลิงก์ของเราไม่มีที่ตั้งอายุ — ใช้ค่าตายตัว 48 ชม. ในโค้ด ขณะที่ฝั่ง imgbb
--      มี `lpr_line_image_expire_hours` ให้ตั้งได้ตั้งแต่แรก
--   2) ทางสำรองทำงานกรณีเดียว (env ไม่ได้ตั้ง) · ถ้าลิงก์เราตอบ 403/404/502
--      LINE จะได้ลิงก์เสีย การ์ดขึ้นรูปว่าง **ไม่มี log อะไรเลย**
--
-- migration นี้เตรียมของให้ทั้งสองข้อ ส่วนตรรกะอยู่ใน helpers/signedImage.js
-- และ line-sender.js

-- ── 1. รูปในการ์ดใบนี้มาจากไหน ────────────────────────────────
-- ไม่มีคอลัมน์นี้ = ตอบไม่ได้ว่าทางสำรองเคยทำงานกี่ครั้ง ซึ่งเป็นข้อมูลเดียวที่จะ
-- บอกได้ว่าควรถอด imgbb ทิ้งได้หรือยัง
--   signed = ลิงก์เซ็นชื่อจากโดเมนเรา · imgbb = ทางสำรอง · none = ส่งโดยไม่มีรูป
--   NULL   = แถวเก่าก่อน migration นี้ (ไม่ใช่ "ไม่มีรูป")
ALTER TABLE alert_logs
  ADD COLUMN IF NOT EXISTS image_source VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_logs_image_source_chk') THEN
    ALTER TABLE alert_logs
      ADD CONSTRAINT alert_logs_image_source_chk
      CHECK (image_source IS NULL OR image_source IN ('signed', 'imgbb', 'none'));
  END IF;
END $$;

-- นับ fallback ใน 24 ชม. บนหน้า config — partial index เพราะแถวส่วนใหญ่เป็น 'signed'
CREATE INDEX IF NOT EXISTS idx_alert_logs_image_source
  ON alert_logs (sent_at DESC) WHERE image_source IN ('imgbb', 'none');

COMMENT ON COLUMN alert_logs.image_source IS
  'รูปในการ์ดมาจากไหน: signed (โดเมนเรา) | imgbb (ทางสำรอง) | none (ส่งไม่มีรูป) · NULL = ก่อน migration 147';

-- ── 2. ค่าตั้งใหม่ 2 ตัว ──────────────────────────────────────
INSERT INTO system_settings (key, value, description) VALUES
  -- อายุลิงก์ของเราเอง · เดิมตายตัว 48 ชม. ในโค้ด (signedImage.js) แก้ไม่ได้
  -- ต่างจาก imgbb ตรงที่ไฟล์ไม่ได้ออกไปไหน — หมดอายุ = ลิงก์ใช้ไม่ได้ ไฟล์ยังอยู่ที่เรา
  ('signed_image_expire_hours', '48',
   'อายุลิงก์รูปในการ์ด LINE ที่เสิร์ฟจากโดเมนเราเอง (ชั่วโมง, 1-720) · หมดอายุแล้วลิงก์เปิดไม่ได้ แต่ไฟล์ยังอยู่ในระบบ'),
  -- สวิตช์ PDPA: ทางสำรองแปลว่าภาพออกไปอยู่บน host ภายนอก ลูกค้าบางรายห้าม
  -- ปิดแล้ว = ถ้าลิงก์เราใช้ไม่ได้ จะส่งการ์ดแบบไม่มีรูป (ยังส่ง ไม่ใช่เงียบ)
  ('imgbb_fallback_enabled', 'true',
   'อนุญาตให้ใช้ imgbb เป็นทางสำรองเมื่อลิงก์รูปของเราเองใช้ไม่ได้ · ปิด = ส่งการ์ดโดยไม่มีรูปแทน')
ON CONFLICT (key) DO NOTHING;
