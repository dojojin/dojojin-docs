-- ============================================================
-- Vigil Platform — migration 172: ลิงก์รายงาน PNG จากโดเมนเรา
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- 2026-08-24:
-- เดิม: ส่งรายงาน PNG ทุกใบให้ imgbb (1.4-10 วิ ต่อภาพ, จำนวนรวม 20-27 วิ/การแจ้งเตือน)
-- ใหม่: ส่งลิงก์เซ็นชื่อจากโดเมนเราเอง (ทันที ไม่ต้องอัปโหลด) ใช้ imgbb เป็นทางสำรองเท่านั้น
--
-- คอลัมน์นี้ทำแบบเดียวกับ alert_logs.image_source (migration 147) — เป็นข้อมูลชุดเดียว
-- ที่ตอบได้ว่าทางสำรอง imgbb ถูกใช้บ่อยแค่ไหน และถอดออกได้หรือยัง

ALTER TABLE report_history ADD COLUMN IF NOT EXISTS image_source VARCHAR(16);

COMMENT ON COLUMN report_history.image_source IS
  'signed | imgbb | none — which host served the image to LINE. Mirrors alert_logs.image_source (migration 147); the only data that answers "can imgbb be dropped yet".';
