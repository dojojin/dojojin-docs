-- ============================================================
-- Vigil Platform — Migration 236: ตั้งค่า backup ที่ปรับได้ (เดิมเป็นค่าคงที่ในสคริปต์)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา 2026-09-22: backup ขึ้น Google Drive หยุดทำงานมา 15 วัน (8-22 ก.ย.) เพราะ
-- TimeoutStartSec=3600 ของ vigil-backup.service เป็นเพดานคงที่ตั้งแต่ 27 ก.ค. ตอน DB
-- ยังเล็ก พอ DB โตถึง 189 GB เวลารวม (pg_dump ในเครื่อง + อัปโหลดไฟล์ 25-31 GB) ก็เกิน
-- 1 ชั่วโมงทุกวัน ถูก systemd ฆ่ากลางคันก่อนอัปโหลดจะเสร็จ (local backup เองยังทำสำเร็จ
-- ดี ปัญหาอยู่ที่ขา offsite เท่านั้น) — แก้โดยแยก local backup กับ offsite upload เป็นคน
-- ละ service ไม่ให้ตัวที่ช้ากว่าไปฆ่าตัวที่เสร็จแล้ว พร้อมเปิดให้ตั้งค่า 3 อย่างนี้ได้แทน
-- ค่าคงที่ในโค้ด ตามที่เจ้าของสั่ง
--
-- เจ้าของลดค่าเริ่มต้นทั้งสองฝั่งจากเดิม (offsite 30 วัน / local 14 วัน) เพราะ "เปลือง":
--   backup_cloud_retain_days : 30 -> 3
--   backup_local_retain_days : 14 -> 7
-- ============================================================

INSERT INTO system_settings (key, value, description) VALUES
  ('backup_local_retain_days', '7',
   'เก็บไฟล์ backup ในเครื่อง (on-premise) ย้อนหลังกี่วัน ก่อนลบทิ้งอัตโนมัติ'),
  ('backup_cloud_retain_days', '3',
   'เก็บไฟล์ backup บน Google Drive ย้อนหลังกี่วัน ก่อนลบทิ้งอัตโนมัติ'),
  ('backup_schedule_time', '03:00',
   'เวลาที่เริ่ม backup อัตโนมัติทุกวัน รูปแบบ HH:MM ตามเวลาเครื่อง (คลาดเคลื่อนได้ไม่เกิน 5 นาทีตามรอบตรวจของ timer)')
ON CONFLICT (key) DO NOTHING;
