-- ============================================================
-- Migration 171: ตารางสรุปของหน้าป้ายทะเบียน (แผนระดับ 2)
-- ------------------------------------------------------------
-- ที่มา: /api/lpr/stats?period=month ใช้เวลา 162 วินาที (สืบสวน 2026-08-23 ·
-- รายงานเต็มใน docs/reports/2026-08-23-lpr-stats-month-162s.md)
-- ระดับ 0+1 กดลงมาเหลือ 93 วินาที และหยุด duty cycle 99% ของตัว warm ไปแล้ว
-- ระดับ 2 คือการเลิกสแกน 15.8 ล้านแถวเพื่อวาดกราฟที่รวมยอดได้ล่วงหน้า
--
-- ⚠️ ตารางนี้เก็บเฉพาะตัวเลขที่ "บวกข้ามช่วงเวลาได้" เท่านั้น
--   ที่ยังต้องคิดสดเพราะบวกไม่ได้ / เปลี่ยนตามสถานะปัจจุบัน:
--     · unique / ในพื้นที่ / ต่างถิ่น / สงสัยสวมป้าย → เป็น COUNT DISTINCT ระดับป้าย
--       (จะแก้ได้ต้องมีตารางที่ 3 ระดับ วัน x ป้าย ซึ่งเจ้าของสั่งให้ประเมินก่อน)
--     · ตรงเฝ้าระวัง → lpr_watchlist เปลี่ยนได้ตลอดเวลา (คนเพิ่มเอง + bridge เขียนทับ
--       ทุกรอบ sync) ถ้าแช่ตัวเลขไว้ในตารางสรุป มันจะแช่คำตัดสินของเมื่อวานไว้
--       แล้วขัดกับหน้าเฝ้าระวังเงียบ ๆ — คลาสเดียวกับบั๊ก photo_sha1-ตอน-embed-พัง
--     · ยอด KPI ของหมวก (no_helmet / no_helmet_ok) ยังคิดสดเช่นกัน เพราะต้องตรงกับ
--       กราฟ Realtime ของหน้ากวดขันแบบไม่มีหน่วงเลย (ทางเลือก B, 2026-08-22)
--       แต่เก็บไว้ในตารางนี้ด้วยสำหรับมุมมองย้อนหลังที่ไม่ต้องการความสด
--
-- ⚠️ ทุกคอลัมน์ตัวนับเป็น NULL ได้ ไม่มี DEFAULT 0 (กติกาเดียวกับ migration 170)
--   bucket ที่ยัง backfill ไม่ถึงต้องอ่านออกว่า "ไม่มีข้อมูล" ไม่ใช่ "เป็นศูนย์จริง"
--
-- ⚠️ lpr_hourly_stats มี 2 แหล่งเขียนคนละคอลัมน์กัน:
--     · จาก license_plates → n_total / n_noread / n_no_helmet / n_no_helmet_ok / n_riders3
--     · จาก events        → n_vehicle_events (กราฟ "จำนวนรถต่อกล้อง" นับ event ที่
--       ไม่มีป้ายด้วย จึงมาจาก license_plates ไม่ได้)
--   แต่ละรอบ UPSERT ต้องระบุเฉพาะคอลัมน์ของตัวเอง — ถ้าเผลอ SET ครบทุกคอลัมน์
--   จะไปล้างงานของอีกแหล่งทิ้งทุกครั้งที่รัน · และกล้อง-ชั่วโมงที่มี event แต่ไม่มี
--   ป้ายเลย จะมีอยู่เฉพาะในรอบของ events ⇒ รอบนั้นต้อง INSERT แถวใหม่ได้ด้วย
--
-- backfill ก่อนต่อสายหน้าจอ (ไม่งั้นบางช่วงจะอ่านตารางที่เติมไม่ครบ):
--     set -a; . ./src/.env; set +a
--     node scripts/backfill-lpr-rollups.js
-- ============================================================

CREATE TABLE IF NOT EXISTS lpr_hourly_stats (
  camera_id        varchar(100) NOT NULL,
  bucket_hour      timestamptz  NOT NULL,
  n_total          integer,
  n_noread         integer,
  n_no_helmet      integer,
  n_no_helmet_ok   integer,
  n_riders3        integer,
  n_vehicle_events integer,
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (camera_id, bucket_hour)
);

-- ทุก query ของหน้าจอกรองด้วยช่วงเวลาก่อนเสมอ แล้วค่อยรวมตามกล้อง
CREATE INDEX IF NOT EXISTS idx_lpr_hourly_bucket ON lpr_hourly_stats (bucket_hour);

COMMENT ON TABLE lpr_hourly_stats IS
  'สรุปรายชั่วโมง x กล้อง ของหน้าป้ายทะเบียน — ~1,390 แถว/วัน (migration 171)';
COMMENT ON COLUMN lpr_hourly_stats.n_vehicle_events IS
  'นับจาก events ไม่ใช่ license_plates — รวม event ที่อ่านป้ายไม่ออกด้วย (กราฟจำนวนรถต่อกล้อง)';

-- มิติของกราฟวงกลม/แท่ง เก็บเป็น long format: หนึ่งแถว = หนึ่งค่าของหนึ่งมิติ
-- ถ้าเก็บแบบ cross ทุกมิติจะได้ 1.27 ล้านแถว/เดือน · แบบนี้ ~15,000 แถว/วัน
-- ระดับวัน (ไม่ใช่ชั่วโมง) เพราะกราฟพวกนี้ไม่มีแกนเวลา ใช้แค่ยอดรวมของช่วง
CREATE TABLE IF NOT EXISTS lpr_dim_daily (
  day        date         NOT NULL,
  camera_id  varchar(100) NOT NULL,
  dim        text         NOT NULL,   -- region · vehicle_type · plate_color · vehicle_brand
  value      text         NOT NULL,
  n          integer      NOT NULL,
  updated_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (day, camera_id, dim, value)
);

CREATE INDEX IF NOT EXISTS idx_lpr_dim_daily_day ON lpr_dim_daily (day, dim);

COMMENT ON TABLE lpr_dim_daily IS
  'สรุปรายวัน x กล้อง x มิติ ของกราฟจังหวัด/ประเภทรถ/สีป้าย/ยี่ห้อ — ~15,000 แถว/วัน (migration 171)';
