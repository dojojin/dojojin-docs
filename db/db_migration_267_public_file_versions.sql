-- ============================================================
-- Vigil Platform — Migration 267: แทนที่ไฟล์ (ลิงก์เดิม) + ประวัติเวอร์ชัน
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของสั่ง 2026-10-17: อัปเวอร์ชันใหม่ทับไฟล์เดิมโดยลิงก์สั้น/ลิงก์ลงชื่อไม่เปลี่ยน + แก้วันหมดอายุทีหลัง
-- • public_files.stored_name ไม่เปลี่ยน (ลิงก์ลงชื่อผูกกับชื่อนี้) — เนื้อหาเดิมถูกย้ายไปเป็น <uuid>.v<N>.<ext>
--   ซึ่ง /pub/fil ไม่เสิร์ฟ (regex ชื่อไฟล์ใน routes/media-files.js รับเฉพาะ <uuid>.<ext>)
-- • version = เลขเวอร์ชันของเนื้อหาปัจจุบัน · แถวใน public_file_versions = เนื้อหาเก่าที่เก็บไว้ย้อนคืนได้
-- • เก็บย้อนหลัง 10 เวอร์ชันต่อไฟล์ (routes/files.js) · ไฟล์ถูกเพิกถอน/หมดอายุ → ลบสำเนาเก่าทิ้งตาม
-- ============================================================

ALTER TABLE public_files ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public_file_versions (
  id            SERIAL PRIMARY KEY,
  file_id       INT NOT NULL REFERENCES public_files(id) ON DELETE CASCADE,
  version       INT NOT NULL,
  stored_name   TEXT NOT NULL,
  bytes         BIGINT,
  sha256        TEXT,
  allow_scripts BOOLEAN NOT NULL DEFAULT FALSE,
  replaced_by   TEXT,
  replaced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (file_id, version)
);
