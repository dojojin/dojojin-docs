-- ============================================================
-- Migration 200: ยอด "อ่านป้ายไม่ได้" ที่นับจาก events ⇒ เห็นครบทั้งสองยี่ห้อ
-- ------------------------------------------------------------
-- ปัญหา: หน้า LPR นับ "อ่านป้ายไม่ได้" อยู่ 2 ที่ และแต่ละที่ตาบอดคนละยี่ห้อ
--   · Dahua (hdy/nrw/rmutr-v) — event `anprAlarm` **ไม่มีฟิลด์ `plate` มาเลย**
--     และ **ไม่สร้างแถวใน license_plates**
--   · Hikvision (hkt)         — ส่ง `plate = "unknown"` มา **และ** สร้างแถวใน
--     license_plates ที่ plate_number = 'unknown'
--   ⇒ แท็บ "ไม่ทราบทะเบียน" (นับจาก events ที่ plate ว่าง) เห็นแต่ Dahua
--     ส่วนการ์ด KPI (นับจาก license_plates ที่ plate_number='unknown') เห็นแต่ Hikvision
--   วัดจริง 2026-09-08 หน้าต่างเดียวกัน 24 ชม.:
--     ไซต์      แท็บโชว์   KPI โชว์   ความจริง
--     hkt            0     12,397     12,397
--     hdy       18,790          0     18,790
--     nrw        1,001          0      1,001
--     rmutr-v    3,908          0      3,908
--
-- ⚠️ n_noread เดิม **ไม่แตะและไม่ลบ** — มันคือยอดจาก license_plates ซึ่งแปลว่า
--    "Hikvision อย่างเดียว" ตามนิยาม ใครที่อยากได้เลขนั้นยังได้เหมือนเดิม
--    คอลัมน์ใหม่ n_noread_ev นับจาก events จึงครอบทั้งสองรูป
--
-- ⚠️ n_vehicle_events ใช้แทนตัวหารไม่ได้ — มันนับ object_class IN
--    ('Car','Truck','Vehicle','Bicycle') รวมเข้ามาด้วย (กราฟ "จำนวนรถต่อกล้อง")
--    จึงใหญ่กว่ายอด anprAlarm จริง ⇒ ต้องมี n_anpr_ev แยกเป็นตัวหารของตัวเอง
--
-- ⚠️ ทั้งสองคอลัมน์ NULL ได้ ไม่มี DEFAULT 0 (กติกาเดียวกับ migration 170/171)
--    bucket ที่ยัง backfill ไม่ถึงต้องอ่านออกว่า "ไม่มีข้อมูล" ไม่ใช่ "เป็นศูนย์จริง"
--
-- ⚠️ ไฟล์นี้ **ไม่มี UPDATE ย้อนหลัง** โดยตั้งใจ — ADD COLUMN แบบไม่มี DEFAULT
--    เป็นงานระดับ metadata ล้วน (ไม่ rewrite ตาราง) จบในหลักมิลลิวินาที
--    migration ที่ UPDATE ก้อนใหญ่ = api-server ไม่บูตจนกว่าจะเสร็จ (บทเรียนเดิม)
--    เติมของเก่าด้วยสคริปต์แยก หลัง migration ผ่านแล้ว:
--        set -a; . ./src/.env; set +a
--        node scripts/backfill-lpr-rollups.js
--    (สคริปต์นั้นเรียก refreshLprWindow ตัวเดียวกับ refresher จึงได้คอลัมน์ใหม่ฟรี)
--
-- 🔴 predicate ของ "อ่านป้ายไม่ได้" ต้องเขียนเป็น OR สองขา **ห้ามเขียนเป็น
--    IN ('', 'unknown')** — มีดัชนีบางส่วนสองตัวรองรับคนละขา
--    (idx_events_anpr_noread_time · idx_events_anpr_unknown_time สร้าง 2026-09-08)
--    เขียนเป็น OR planner ต่อ BitmapOr ใช้ได้ทั้งคู่ · เขียนเป็น IN planner
--    เลิกใช้ทั้งคู่เงียบ ๆ · วัดจริงบน central คิวรีเดียวกัน หน้าต่าง 24 ชม.:
--      OR                    →   98.9 ms
--      IN ('','unknown')     → 2,439   ms
--    เหตุผลเดียวกับ migration 199: Postgres จับคู่ partial index จาก expression tree
-- ============================================================

ALTER TABLE lpr_hourly_stats ADD COLUMN IF NOT EXISTS n_noread_ev integer;
ALTER TABLE lpr_hourly_stats ADD COLUMN IF NOT EXISTS n_anpr_ev   integer;

COMMENT ON COLUMN lpr_hourly_stats.n_noread_ev IS
  'นับจาก events: anprAlarm ที่อ่านป้ายไม่ได้ทั้งสองรูป — plate ว่าง (Dahua) OR plate=''unknown'' (Hikvision). ต่างจาก n_noread ที่นับจาก license_plates เท่านั้น จึงเห็นแค่ Hikvision (migration 200)';
COMMENT ON COLUMN lpr_hourly_stats.n_anpr_ev IS
  'นับจาก events: anprAlarm ทั้งหมด — ตัวหารของ n_noread_ev. ใช้ n_vehicle_events แทนไม่ได้ เพราะตัวนั้นรวม object_class ของรถทั่วไปเข้ามาด้วย (migration 200)';
