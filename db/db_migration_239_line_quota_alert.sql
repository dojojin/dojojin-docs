-- ============================================================
-- Vigil Platform — Migration 239: แจ้งเตือนเมื่อโควตา LINE ใกล้หมด/เต็ม
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา 2026-09-24: LINE ปฏิเสธ push ไปกลุ่ม "Phuket Eyes Police-VSS" (185 คน) เวลา
-- 13:23/13:26 ด้วย "You have reached your monthly limit." ทั้งที่หน้า Settings ตอนนั้น
-- ขึ้นว่าเหลือ 1,046 ข้อความ — ตัวเลข consumption ของ LINE ไม่ real-time พอจะเชื่อ
-- เพียงอย่างเดียว (กลุ่มใหญ่คิดโควตาเป็นรายสมาชิก) ต้องฟังจาก error จริงตอนส่งด้วย
--
-- ค่าตั้งเก็บเป็น system_settings (ตามแบบ backup_* migration 236) ไม่ใช่คอลัมน์ใหม่ใน
-- line_config เพราะเป็นเรื่อง "ระบบเตือนตัวเอง" คนละชั้นกับค่าตั้งการเชื่อมต่อ LINE
--
--   line_quota_alert_enabled    : เปิด/ปิดการเตือนนี้
--   line_quota_alert_threshold  : เหลือน้อยกว่ากี่ข้อความ ถึงเตือน (ไม่นับกรณีโดนบล็อกเต็ม
--                                  ซึ่งเตือนทันทีเสมอไม่ต้องรอ threshold)
--   line_quota_alert_recipients : JSON array ของ line_config.recipients[].id ที่จะได้รับ
--                                  คำเตือนนี้ (ว่าง = ยังไม่ได้เลือกใคร ไม่ส่ง)
--   line_quota_alert_state      : JSON {month, sent_at, reason, results} — กันส่งซ้ำ
--                                  เกินเดือนละ 1 ครั้ง (เขียนก็ต่อเมื่อส่งสำเร็จอย่างน้อย 1 คน)
--   line_quota_last             : JSON snapshot ล่าสุดที่ใช้วาดการ์ดในหน้า Settings —
--                                  กันหน้าเว็บต้องยิง LINE API ตรงทุกครั้งที่เปิดหน้า
-- ============================================================

INSERT INTO system_settings (key, value, description) VALUES
  ('line_quota_alert_enabled', 'true',
   'เปิดแจ้งเตือนเมื่อโควตา LINE ใกล้หมดหรือถูกปฏิเสธเพราะโควตาเต็ม'),
  ('line_quota_alert_threshold', '200',
   'เหลือน้อยกว่ากี่ข้อความ (ตามตัวเลขของ LINE) ถึงส่งคำเตือน'),
  ('line_quota_alert_recipients', '[]',
   'JSON array ของ recipient id ที่จะได้รับคำเตือนโควตา'),
  ('line_quota_alert_state', '{}',
   'JSON: เดือนล่าสุดที่แจ้งไปแล้ว ({month, sent_at, reason, results}) — กันแจ้งซ้ำเกินเดือนละครั้ง'),
  ('line_quota_last', '{}',
   'JSON snapshot ผลตรวจโควตาล่าสุด ใช้วาดการ์ดหน้า Settings')
ON CONFLICT (key) DO NOTHING;
