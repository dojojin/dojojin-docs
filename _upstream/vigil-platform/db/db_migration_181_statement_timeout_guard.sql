-- ============================================================
-- Vigil Platform — migration 181: ตาข่ายกัน query ค้างระดับ role
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- เหตุจริง 2026-08-27: query หนึ่งค้าง **34 ชั่วโมง** (pid 892927 เริ่ม 25 ส.ค. 17:48)
-- transaction ที่เปิดค้างทำให้ autovacuum เก็บ dead tuple ไม่ได้ → events_y2026m08
-- สะสมแถวตาย 2.3 ล้าน (9.4%) → ทุก query อ่านหน้าที่บวมขึ้น → หน้าสถิติว่างเปล่า
--
-- 🔴 หา query ต้นทางไม่ได้ — ไม่อยู่ในซอร์สปัจจุบัน และ pg_stat_statements ถูก reset
-- ทุก 08:03 โดย cron · แปลว่าเป็น ad-hoc ที่ใครสักคนรันแล้วทิ้ง ⇒ **แก้ที่ pool ในโค้ด
-- อย่างเดียวไม่พอ** ต้องมีเพดานที่ role ซึ่งครอบทุก connection รวมของที่รันมือ
--
-- ค่าที่เลือก — วัดจากของจริง ไม่ได้เดา:
--   statement_timeout = 15 นาที
--     · งานที่ยาวที่สุดที่ "ถูกต้อง" ในระบบคือ reconcile รายวัน วัดได้ 35 วินาที/ก้อน
--       หลังซอยเป็นวัน (ก่อนซอยคือ 168 วินาที)
--     · backfill ที่หนักที่สุดที่เคยรัน (30 วัน) ซอยเป็นก้อนละ 7 วันแล้วก้อนละ ~250 วินาที
--     · 15 นาทีจึงเผื่อไว้ 3 เท่าของงานหนักสุดที่รู้จัก แต่ยังตัด runaway ได้ใน 15 นาที
--       แทนที่จะเป็น 34 ชั่วโมง
--   idle_in_transaction_session_timeout = 5 นาที
--     · ไม่มีงานปกติที่เปิด transaction ค้างไว้เฉย ๆ นานขนาดนั้น
--     · เคสนี้เป็น "active" ไม่ใช่ "idle" แต่ transaction ที่ถูกลืมเปิดทิ้งไว้
--       บล็อก vacuum ได้เท่ากัน จึงปิดทั้งสองทาง
--
-- ⚠️ ค่าที่ pool ตั้งเอง (`options: '-c statement_timeout=...'`) **ชนะค่านี้เสมอ**
--    เพราะ connection option ถูกใช้หลัง role default ⇒ api-server ยังได้ 120 วินาที
--    ตามเดิม และ report-worker ยังได้ 600 วินาที · ตัวนี้เป็นตาข่าย ไม่ใช่ค่ากลาง
--
-- ⚠️ มีผลกับ connection **ใหม่** เท่านั้น — ของที่ต่ออยู่แล้วต้องต่อใหม่ถึงจะได้ค่านี้
-- ============================================================

DO $$
DECLARE r text;
BEGIN
  -- ตั้งให้ทุก role ที่แอปใช้ · ไม่ตั้งกับ superuser เพราะงานซ่อมฉุกเฉินต้องไม่ถูกตัด
  FOREACH r IN ARRAY ARRAY['vigil_sql'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r, '15min');
      EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', r, '5min');
      RAISE NOTICE 'ตั้งเพดานให้ role % แล้ว', r;
    END IF;
  END LOOP;
END $$;
