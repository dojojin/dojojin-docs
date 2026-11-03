-- ============================================================
-- Vigil Platform — migration 144: ยอดสรุป KPI รายชั่วโมง
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- ทำไม: KPI ของหน้าสรุป (เหตุการณ์ / แจ้งเตือน / รถ / คน / ใบหน้า · วันนี้ vs เมื่อวาน)
-- สแกน `events` ประมาณ 1.6 ล้านแถวทุกครั้งที่ cache หมด — วัดจริง 2026-08-12 ได้ 3.3–6.1 วินาที
-- และเพราะ Node เป็น process เดียว มันลากหน้าอื่นช้าตาม (หน้า Health 600ms → 11 วินาที)
-- ใช้วิธีเดียวกับที่ได้ผลแล้วกับหน้ากวดขันวินัยจราจร (`traffic_hourly_stats`, migration 142)
--
-- ── ทำไมเก็บ event_type ไว้ด้วย ────────────────────────────────
-- ผู้ดูแลเปิด/ปิดได้ว่าจะนับ analytics event ชนิดไหน (`analytics_event_display`)
-- ถ้าอบตัวเลขรวมไว้เลย พอสลับสวิตช์ตัวเลขจะไม่เปลี่ยน — ต้องแยกตามชนิดไว้
-- แล้วค่อยกรองตอนอ่าน · แตกละเอียดขนาดนี้ยังเล็กมาก (วัดจริง ~2,553 แถว/วัน)
--
-- ── ชั่วโมงปัจจุบันไม่ได้อ่านจากตารางนี้ ────────────────────────
-- refresher เดินทุก 5 นาที ถ้าอ่านชั่วโมงปัจจุบันจากที่นี่ ตัวเลข "วันนี้" จะค้าง
-- ให้ผู้ใช้เห็นว่าไม่ขยับ · endpoint จึงอ่านชั่วโมงที่ปิดแล้วจากตารางนี้ แล้วนับ
-- ชั่วโมงปัจจุบันสดจาก events (วัดแล้ว 55ms — ถูกกว่าการสแกนสองวันมาก)

CREATE TABLE IF NOT EXISTS event_kpi_hourly (
  camera_id    VARCHAR(100) NOT NULL,
  bucket_hour  TIMESTAMPTZ  NOT NULL,
  event_type   VARCHAR(120) NOT NULL,
  n_total      INTEGER      NOT NULL DEFAULT 0,
  n_alerts     INTEGER      NOT NULL DEFAULT 0,
  n_traffic    INTEGER      NOT NULL DEFAULT 0,
  n_people     INTEGER      NOT NULL DEFAULT 0,
  n_faces      INTEGER      NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (camera_id, bucket_hour, event_type)
);

-- อ่านเป็นช่วงเวลาเสมอ (วันนี้/เมื่อวาน) แล้วค่อยรวมตามกล้อง
CREATE INDEX IF NOT EXISTS idx_ekh_bucket ON event_kpi_hourly (bucket_hour DESC);

COMMENT ON TABLE event_kpi_hourly IS
  'ยอดสรุป KPI รายชั่วโมงจาก events สำหรับหน้าสรุป — เติมโดย src/kpi-stats-refresher.js (migration 144)';
