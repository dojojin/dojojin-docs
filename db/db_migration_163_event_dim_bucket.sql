-- ============================================================
-- Vigil Platform — migration 163: event_dim_bucket
-- สรุปจำนวน event ต่อ 30 นาที "ตามมิติที่กฎหมวดหมู่ใช้ตัดสิน"
-- ============================================================
--
-- ปัญหาที่แก้ (incident 2026-08-19): หน้าสถิติเลือก "รายเดือน" แล้ว query ค้าง
-- เกิน 5 นาที กิน connection pool จนหน้าอื่นพลอยช้า. ต้นเหตุคือ 3 endpoint
-- (categories / timeline-by-category / per-camera-counts) join event ทุกแถวกับ
-- ตารางกฎแบบ nested-loop: เดือนนี้ 15.0 ล้าน event × 20 กฎ = ~300 ล้านครั้ง.
--
-- ทำไมแก้ด้วย index ไม่ได้: วัดแล้ว 11.58 จาก 15.0 ล้านแถว (77%) มี vehicle_type
-- และกฎหมวดรถ (cat 28–34) ไม่จำกัดกล้อง — คือ "ตรงเกือบทุกแถว" จึงไม่มี index ใด
-- ช่วยได้ ต้องเลิกนับตอน query แทน.
--
-- ทำไมเก็บ "มิติ" ไม่ใช่ category_id ที่ resolve แล้ว:
--   ถ้าเก็บ category_id ไว้เลย พอเจ้าของแก้กฎหมวดหมู่ ข้อมูลย้อนหลังทั้งก้อนจะผิด
--   ทันทีและต้อง rebuild ใหม่ทั้งหมด (วัดจริง ~8 นาทีที่ 57 วัน · จะโตเป็น ~50 นาที
--   เมื่อข้อมูลครบปี). เก็บเป็นมิติดิบแทน แล้วค่อยเอาไปเทียบกฎตอนอ่าน ⇒ แก้กฎเมื่อไหร่
--   ตัวเลขย้อนหลังถูกต้องทันทีโดยไม่ต้อง rebuild อะไรเลย.
--   ต้นทุนที่จ่ายแลก: จำนวนแถวมากกว่าแบบผูก category 1.68 เท่า (วัดจริง 20,974
--   vs 12,513 แถวต่อวัน) — ยอมรับได้ เพราะยังเป็นตารางเล็ก (~7.7 ล้านแถวต่อปี)
--   และการอ่านเดือนหนึ่งเหลือ ~377k แถว × 20 กฎ = ~7.5 ล้านครั้ง (น้อยลง 40 เท่า).
--
-- ทำไม 30 นาที ไม่ใช่รายชั่วโมงตาม event_kpi_hourly / traffic_hourly_stats:
--   กราฟ "วันนี้"/"เมื่อวานนี้" ใช้ถัง 30 นาที (แก้ 2026-08-19) — rollup รายชั่วโมง
--   ตอบไม่ได้ ต้องเหลือทางอ่าน raw ไว้อีกทาง ซึ่งแปลว่ามีสองเส้นทางนับที่ต้องตรงกัน
--   ตลอดไป (คลาสบั๊กเดียวกับที่เพิ่งแก้ไป 2 รอบคืนนี้). 30 นาทีตอบได้ทั้ง 30 นาที /
--   ราย ชม. / รายวัน ด้วยการ SUM จึงเหลือเส้นทางเดียว.
--
-- NULL ถูกเก็บเป็น '' เพราะ NULL ใน UNIQUE key ไม่ชนกันเอง ⇒ ON CONFLICT ใช้ไม่ได้
-- (ฝั่งอ่านต้องแปลงกลับด้วย NULLIF ให้ตรงกับ semantics เดิมของกฎ)

CREATE TABLE IF NOT EXISTS event_dim_bucket (
  bucket       TIMESTAMPTZ  NOT NULL,
  camera_id    VARCHAR(80)  NOT NULL,
  rule_name    VARCHAR(200) NOT NULL DEFAULT '',
  event_type   VARCHAR(80)  NOT NULL DEFAULT '',
  object_class VARCHAR(40)  NOT NULL DEFAULT '',
  vehicle_type VARCHAR(30)  NOT NULL DEFAULT '',
  event_state  VARCHAR(10)  NOT NULL DEFAULT '',
  n            INTEGER      NOT NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT event_dim_bucket_pk PRIMARY KEY
    (bucket, camera_id, rule_name, event_type, object_class, vehicle_type, event_state)
);

-- อ่านเป็นช่วงเวลาเสมอ (from → to) จึงต้องมี index นำด้วย bucket
CREATE INDEX IF NOT EXISTS idx_event_dim_bucket_time
  ON event_dim_bucket (bucket);

-- per-camera-counts กรองด้วยรายชื่อกล้องก่อนแล้วค่อยรวมยอด
CREATE INDEX IF NOT EXISTS idx_event_dim_bucket_cam
  ON event_dim_bucket (camera_id, bucket);
