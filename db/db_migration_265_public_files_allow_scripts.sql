-- ============================================================
-- Vigil Platform — Migration 265: ไฟล์ HTML แบบโต้ตอบได้ (public_files.allow_scripts)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของสั่ง 2026-10-17: หน้า HTML ที่มีฟังก์ชัน (iPhone Price Atlas) ต้องกดใช้งานได้บน upl.dojojin.tech
-- ค่าเริ่มต้น FALSE = พฤติกรรมเดิมทุกไฟล์ (ตัดสคริปต์ตอนอัป + CSP sandbox ไม่มี allow-scripts)
-- TRUE = แอดมินติ๊กเองตอนอัป → ไม่ตัดสคริปต์ · เสิร์ฟด้วย sandbox allow-scripts (ไม่มี allow-same-origin
-- = origin ลับ) + connect-src 'none' + form-action 'none' — ดู routes/media-files.js /pub/fil/
-- ตารางเล็ก (หลักสิบแถว) · ADD COLUMN ที่ default เป็นค่าคงที่ = แก้ metadata อย่างเดียว
-- ============================================================

ALTER TABLE public_files ADD COLUMN IF NOT EXISTS allow_scripts BOOLEAN NOT NULL DEFAULT FALSE;
