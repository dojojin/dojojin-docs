-- ============================================================
-- Vigil Platform — Migration 191: PassengerCar ของ Dahua คือรถบัส ไม่ใช่รถเก๋ง
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ 2026-08-31 (เจ้าของแจ้งว่า "รถบัสมีนะครับใน HDY" พร้อมภาพจากระบบของ สภ.):
-- dahua-protocol.js แปลง Category 'PassengerCar' เป็น 'vehicle' พร้อมคอมเมนต์ว่า
-- "generic car, same bucket as SaloonCar" ซึ่งผิด — ชื่อเป็นเพื่อนปลอม รถเก๋งจริง ๆ
-- คือ SaloonCar ที่มีช่องของตัวเองอยู่แล้ว ส่วนชุดนี้เป็นบันไดขนาดของรถโดยสาร
-- (Microbus → MidPassengerCar → PassengerCar)
--
-- หลักฐาน: กล้อง Dahua เผาคลาสลงบนภาพผ่าน OSD เอง และในตัวอย่างที่ตรวจ OSD เขียนว่า
-- "Vehicle Type:Large Bus" ขณะที่ field ส่ง PassengerCar มา · ตรวจภาพ 10 คันสุ่มจาก
-- hdy กับเจ้าของ: 8 ใน 10 เป็นรถบัส/รถทัวร์ · ยี่ห้อที่ทำรถบัสอย่างเดียว
-- (YuTong/JingLong/Sunlong) พบใน PassengerCar 4.6% เทียบกับ SaloonCar 0.006%
--
-- 🔴🔴 บทเรียนจากรอบแรกของไฟล์นี้เอง (2026-08-31 18:07 — อ่านก่อนแก้ไฟล์นี้):
--   เวอร์ชันแรกเขียน UPDATE ... FROM events แบบไม่มีขอบเขต · บน central ที่มี
--   license_plates 27 ล้านแถว + events 33 ล้านแถวแบบ partition มันต้องสแกนทั้งคู่
--   เพื่อจะพบว่าไม่มีอะไรต้องแก้ (backfill ทำด้วยมือไปแล้ว) · migrate.js ครอบทุกไฟล์
--   ด้วย transaction และ **migration ที่ล้มเหลวทำให้ api-server ไม่ขึ้น** โดยตั้งใจ
--   (STUBBORN_FACT #81) ผลคือ api-server เข้าลูป restart จนต้องยกเลิก query ด้วยมือ
--
--   ⚠️ migration ที่ "ถูกต้อง" แต่กินเวลาเป็นนาทีบนตารางใหญ่ = migration ที่พัง
--      เพราะมันบล็อกการบูตของทั้งระบบ ไม่ใช่แค่ช้า
--
-- จึงเปลี่ยนเป็น: ทำอัตโนมัติเฉพาะตารางที่ยังเล็ก (เครื่องติดตั้งใหม่ ซึ่งเป็นกลุ่ม
-- เดียวที่ไฟล์นี้มีไว้ให้) · เครื่องที่มีข้อมูลจริงให้ทำด้วยมือแบบแบ่งก้อน:
--
--   CREATE TABLE _bus_backfill AS
--     SELECT lp.id FROM events e JOIN license_plates lp ON lp.event_id = e.id
--      WHERE lp.vehicle_type = 'vehicle'
--        AND e.raw_json #>> '{data,Vehicle,Category}' = 'PassengerCar';
--   -- แล้ววน UPDATE ... WHERE id IN (SELECT id FROM _bus_backfill LIMIT 5000)
--   -- พร้อม DELETE ก้อนที่ทำแล้วออก จนหมด (central: 25,202 แถว เสร็จในไม่กี่วินาที)
--
-- 🔴 ด่านกันพลาดคือ `vehicle_type = 'vehicle'` ไม่ใช่ลำดับการรัน: แตะเฉพาะค่าที่
--    mapping ผิดสร้างไว้ · รันซ้ำไม่เปลี่ยนอะไรเพราะแถวนั้นเป็น largeBus ไปแล้ว
-- 🔴 ห้ามแตะแถวที่ vehicle_type เป็น NULL (พบ 277 แถว 17-18 ก.ค. ที่ hdy) — NULL
--    ไม่ใช่ผลผลิตของ mapping ที่ผิด จึงมาจากเส้นทางอื่น การแก้ให้ด้วยคือการเดา
-- 🔴 ห้ามแก้ raw_json — มันคือหลักฐานดิบว่ากล้องส่งอะไรมา ย้ายเฉพาะคอลัมน์ที่ derive
-- ============================================================

DO $$
DECLARE est bigint;
BEGIN
  SELECT reltuples::bigint INTO est FROM pg_class WHERE relname = 'license_plates';
  IF est IS NULL OR est < 1000000 THEN
    UPDATE license_plates lp SET vehicle_type = 'largeBus'
      FROM events e
     WHERE e.id = lp.event_id
       AND lp.vehicle_type = 'vehicle'
       AND e.raw_json #>> '{data,Vehicle,Category}' = 'PassengerCar';
    RAISE NOTICE 'PassengerCar backfill: applied (license_plates ~% rows)', est;
  ELSE
    RAISE NOTICE 'PassengerCar backfill: SKIPPED — license_plates ~% rows, run the batched backfill by hand (see header)', est;
  END IF;
END $$;
