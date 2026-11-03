-- ============================================================
-- Vigil Platform — BS2 · ย้ายแถวที่ต้นทางลบแล้วลงถังขยะย้อนหลัง
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- BS1 (commit b8bad78) ทำเครื่องหมาย `source_records.vanished_at` ไว้แล้ว และ
-- commit 4154b69 ให้ bridge อ่านคอลัมน์นั้นตรง ๆ เพื่อถอนป้ายออกจากการเฝ้าระวัง
--
-- BS2 เปลี่ยนกลไกให้เหลือจุดตัดสินจุดเดียว: `overrides.excluded` — เพราะถังขยะมี
-- ปุ่ม "เอากลับเข้าถังกลาง" ที่แก้ได้แค่ `excluded` ถ้า bridge ยังดู `vanished_at`
-- ด้วย การกดกู้คืนจะไม่ทำให้ป้ายกลับมาเฝ้าระวัง = ปุ่มโกหก
--
-- ⚠️ ตัว migration นี้ **จำเป็น** ไม่ใช่ของแถม: เมื่อ bridge เลิกดู `vanished_at`
-- แถวที่ถูกทำเครื่องหมายไว้ **ก่อน** การเปลี่ยนแปลงนี้จะยังไม่มีแถวถังขยะรองรับ
-- และจะไหลกลับเข้า `lpr_watchlist` ทันทีในรอบ sync ถัดไป
--
-- idempotent: รันซ้ำได้ · ไม่แตะการยกเว้นที่ "คน" ตั้งไว้ (WHERE excluded = FALSE)
-- ============================================================

INSERT INTO blacklist.overrides (source_id, external_id, excluded, exclude_reason, updated_by, updated_at)
SELECT r.source_id, r.external_id, TRUE,
       COALESCE(r.vanish_reason, 'ต้นทางไม่ส่งรายการนี้มาแล้ว'),
       'system:vanish', NOW()
  FROM blacklist.source_records r
 WHERE r.vanished_at IS NOT NULL
ON CONFLICT (source_id, external_id) DO UPDATE
   SET excluded       = TRUE,
       exclude_reason = COALESCE(blacklist.overrides.exclude_reason, EXCLUDED.exclude_reason),
       updated_by     = 'system:vanish',
       updated_at     = NOW()
 WHERE blacklist.overrides.excluded = FALSE;
