-- ============================================================
-- Vigil Platform — migration 282: appearance_dim_hourly (ตารางสรุปของหน้าสถิติลักษณะบุคคล)
-- ที่มา (2026-10-27 · เจ้าของอนุมัติ · ข้อ 5 หลัง perfWatch 26 ต.ค.):
--   /api/appearances/stats 7 วันทุกไซต์อ่าน appearances 1.37 ล้านแถวเต็มคอลัมน์ทุกครั้ง
--   cache เย็น 6.3 วิ / อุ่น 3.9 วิ (query-probe ตี 1:15 เตือน) · 30 วัน 16 วิ
--   ลองรวม 14 คิวรีเป็น GROUPING SETS แล้วไม่ช่วย (3.85 → 3.87 วิ) — ต้นทุนคือจำนวนแถวที่อ่าน
--   ⇒ สรุปรายชั่วโมงต่อกล้อง/ชนิดวัตถุ/มิติ ไว้ล่วงหน้า (~46,000 แถว/วัน วัดจาก 25 ต.ค.)
--
-- dim / value (ตรงกับคิวรีเดิมใน routes/appearances.js ทุกตัว):
--   all ''                  ทุกแถว (ยอดรวม · รายวัน · ช่วงพีค · รายกล้อง · ชนิดวัตถุ)
--   gender · top · bottom · hair_color · hair_length · age (COALESCE(age_group, rj_age_group))
--   expr (rj_expression) · dir (attributes->>'direction')        เฉพาะค่าไม่ว่าง
--   color  json_build_array(upper_color, lower_color)::text      เมื่อสีใดสีหนึ่งไม่ว่าง (JSON กัน NULL ชนกับ '')
--   flag   bag · backpack · shoulder · glasses · helmet · mask · hat   (เงื่อนไขเดียวกับ accessories เดิม)
-- object_class เก็บเป็น COALESCE(object_class, 'unknown') · camera_id เก็บ '' แทน NULL (ตอนนี้ไม่มีสักแถว)
-- เติมโดย src/appearance-rollup-refresher.js (ตัวจัดคิว src/jobs/rollups.js) · ตารางเล็ก ไม่มี backfill ใน migration
-- Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS appearance_dim_hourly (
  bucket_hour   TIMESTAMPTZ NOT NULL,
  camera_id     TEXT        NOT NULL,
  object_class  TEXT        NOT NULL,
  dim           TEXT        NOT NULL,
  value         TEXT        NOT NULL,
  n             INTEGER     NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_hour, camera_id, object_class, dim, value)
);
