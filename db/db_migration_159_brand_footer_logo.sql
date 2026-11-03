-- ============================================================
-- Vigil Platform — Brand Footer Logo Setting
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================

-- ⚠️ ค่าเริ่มต้นต้องเป็น 'logo-partner.png' ไม่ใช่ค่าว่าง
-- เดิมรายงานอ่านชื่อไฟล์นี้แบบ hardcode อยู่แล้ว ถ้า seed เป็นค่าว่าง โลโก้ท้ายเอกสาร
-- จะหายจากรายงานทันทีที่ deploy ทั้งที่ไฟล์ยังอยู่ครบ — เป็นการถอยหลังโดยไม่ได้ตั้งใจ
-- เครื่องที่ยังไม่มีไฟล์นี้ไม่พัง: _brandLogos() คืน null เมื่อหาไฟล์ไม่เจอ
INSERT INTO system_settings(key, value, description)
  VALUES ('brand_footer_logo_path', 'logo-partner.png',
          'โลโก้ที่แสดงที่ท้ายเอกสาร PDF (เช่น รายงาน) — อัปโหลดได้ที่ ตั้งค่า › ระบบ › Branding')
  ON CONFLICT (key) DO NOTHING;
