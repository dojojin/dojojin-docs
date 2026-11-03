-- ============================================================
-- Vigil Platform — AcuSeek Query Logging
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ============================================================
-- เก็บ log คำค้นที่ผู้ใช้พิมพ์ในช่อง Smart Search (AcuSeek)
--
-- เหตุผล: ตัดสินใจว่าต้องลงทุนแปลภาษาไทย→อังกฤษอัตโนมัติหรือเปล่า
-- โดยเก็บตัวอย่างคำค้นจริงจากผู้ใช้ (ทีละสัปดาห์) แล้ววิเคราะห์ว่า
-- "คำไหนแปลไม่ออก (unknown)" มากที่สุด
--
-- ผลการวิเคราะห์เหล่านี้จะบอกว่า "แปล" คุ้มค่าแค่ไหน
-- ============================================================

CREATE TABLE IF NOT EXISTS acuseek_queries (
  id          BIGSERIAL PRIMARY KEY,
  text        TEXT NOT NULL,          -- ข้อความไทยที่ผู้ใช้พิมพ์
  english     TEXT,                   -- วลีอังกฤษที่ส่งไปให้เครื่องค้น (null ถ้าแปลไม่ออก/ถูกบล็อก)
  user_english BOOLEAN NOT NULL DEFAULT FALSE, -- ผู้ใช้แก้ประโยคอังกฤษเองหรือเปล่า
  unknown     TEXT[] NOT NULL DEFAULT '{}',    -- คำที่แปลไม่ออก (ตกหลุดจากการแปล)
  warn_ids    TEXT[] NOT NULL DEFAULT '{}',    -- id ของคำเตือน unsupported (UNSUPPORTED[].id)
  ok          BOOLEAN NOT NULL,                -- ค้นได้สำเร็จหรือเปล่า (ok=true ในผลลัพธ์ route)
  reason      TEXT,                   -- ถ้า ok=false: 'blocked' / 'unknown' / 'futureWindow' / 'noCameras'
  band        TEXT,                   -- ช่วงเวลา ('day' / 'night' / ... จากฟอร์ม)
  days        INT,                    -- จำนวนวันย้อนหลัง
  username    TEXT,                   -- ชื่อผู้ใช้ที่ค้น (null = ยังไม่ผ่าน auth)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS acuseek_queries_at_idx
  ON acuseek_queries (created_at DESC);

CREATE INDEX IF NOT EXISTS acuseek_queries_user_idx
  ON acuseek_queries (username, created_at DESC);
