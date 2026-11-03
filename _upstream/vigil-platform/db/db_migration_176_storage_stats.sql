-- ============================================================
-- Vigil Platform — migration 176: ตาราง storage_stats สำหรับเก็บสถิติพื้นที่จัดเก็บ
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- 2026-08-24:
-- Phase 1a: Storage Overview — ตัวเก็บสถิติพื้นที่ใช้จริง (bytes, files, oldest_at) ต่อหมวด
-- เพื่อให้หน้าจอแสดงข้อมูลโดยไม่ต้องรัน du ทุกครั้งที่เปิด (hkt du timeout > 100 วิ)
--
-- partial=TRUE เมื่อสแกนโดนจำกัดเวลา (budget exceeded) ตัวเลขจึงเป็นพื้นต่ำ ไม่ใช่ค่าสมบูรณ์
-- oldest_at = NULL หากไดเรกทอรีว่างเปล่า

CREATE TABLE IF NOT EXISTS storage_stats (
  machine     TEXT NOT NULL,
  category    TEXT NOT NULL,
  bytes       BIGINT NOT NULL DEFAULT 0,
  files       BIGINT NOT NULL DEFAULT 0,
  oldest_at   TIMESTAMPTZ,
  partial     BOOLEAN NOT NULL DEFAULT FALSE,
  disk_total  BIGINT,
  disk_used   BIGINT,
  scan_ms     INTEGER,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (machine, category)
);

COMMENT ON TABLE storage_stats IS
  'สถิติการใช้พื้นที่จัดเก็บ — ต่อเครื่อง (central / site code) ต่อหมวด (events/lpr/lpr-watchlist/face-blacklist/root-flat/blacklist-photos/reports)';

COMMENT ON COLUMN storage_stats.partial IS
  'TRUE = การสแกนถูกหยุดเมื่อหมดเวลา — ตัวเลข bytes/files เป็นพื้นต่ำเท่านั้น ไม่ใช่ค่าสมบูรณ์';

COMMENT ON COLUMN storage_stats.oldest_at IS
  'วันที่ของไฟล์เก่าสุดในหมวดนี้ — NULL หากหมวดว่างเปล่า';

COMMENT ON COLUMN storage_stats.scan_ms IS
  'เวลาที่ใช้ในการสแกน (มิลลิวินาที) — ถ้า partial=TRUE อาจหยุดก่อนครบเวลา budget';

-- bytes = ผลรวมขนาดไฟล์ · bytes_disk = บล็อกที่ถูกจับจองจริง (st.blocks * 512)
-- ทั้งสองค่าต่างกันมากเมื่อไฟล์เล็กจำนวนมาก: snapshots/events 112,958 ไฟล์
-- apparent 230 MB แต่กินดิสก์ 488 MB (2.1 เท่า) เพราะแต่ละไฟล์ปัดขึ้นเป็นบล็อก 4 KB
-- หน้าจอต้องนำเสนอ bytes_disk เป็นตัวหลัก เพราะคำถามคือ "ดิสก์หายไปไหน"
ALTER TABLE storage_stats ADD COLUMN IF NOT EXISTS bytes_disk BIGINT NOT NULL DEFAULT 0;
COMMENT ON COLUMN storage_stats.bytes_disk IS
  'บล็อกที่ถูกจับจองจริง (st.blocks*512) — ตัวเลขที่ตรงกับ du -s และกับพื้นที่ที่หายไปจากดิสก์';
