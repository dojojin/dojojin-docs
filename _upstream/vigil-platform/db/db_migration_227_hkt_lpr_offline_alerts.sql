-- ============================================================
-- Vigil Platform — migration 227: เปิดแจ้งเตือนออฟไลน์ให้กล้อง LPR ทั้งหมดที่ HKT
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา 2026-09-14: เจ้าของสั่งเปิดแจ้งเตือน LINE เมื่อกล้องดับ เฉพาะกล้อง LPR
-- (cam_role='lpr') ที่ไซต์ HKT (ภูเก็ต, site_id=18) ทั้งหมด — เงื่อนไข:
--   1. แจ้งซ้ำทุก 120 นาที (escalate_interval_min)
--   2. แจ้งครั้งแรกหลังออฟไลน์ 300 วินาที (notify_after_sec, ค่า default อยู่แล้ว)
--   3. ผู้รับ: กลุ่ม "CCTV HKT" + "Dojo-mAn ♡ 🍊"
--
-- ตรวจก่อนเขียน (2026-09-14): 18 กล้อง LPR ที่ HKT ทั้งหมดมีแถวใน camera_offline_alerts
-- อยู่แล้วจากการ upsert ของ checkOfflineCameras (ค่า default ทุกตัว enabled=false,
-- ไม่มี custom setting ใด ๆ ค้างอยู่ — ไม่มีของใครที่ตั้งไว้ก่อนหน้าจะถูกเขียนทับ)
--
-- ตัว recipient_ids ต้องอ้าง id จาก line_config.recipients ตรง ๆ (เทียบด้วย string
-- ทั้งก้อน คนละแบบกับ jsonb array) — ค้นแล้วมีทั้งคู่จริง enabled=true:
--   CCTV HKT              → C407b15147bc1e6043491792d04362ddd (group)
--   Dojo-mAn ♡ 🍊          → U0ee506e05ee15d8c6ab29c72340c1304 (user)
--
-- ⚠️ 2 ใน 18 ตัว (C9-KAR-SB-04, C10-KAR-SB-04) กำลังออฟไลน์อยู่จริง ณ ตอนที่เขียน
-- migration นี้ (ดู GOTCHAS #209 / camera-quiet-watch) ⇒ เปิดใช้แล้วจะมีข้อความ
-- แจ้งเตือนออกไปเกือบทันที (ภายใน notify_after_sec) ไม่ใช่บั๊ก — เป็นพฤติกรรมที่ตั้งใจ
-- ============================================================

UPDATE camera_offline_alerts o
   SET enabled = TRUE,
       notify_after_sec = 300,
       escalate_interval_min = 120,
       escalate_once = FALSE,
       recipient_ids = 'C407b15147bc1e6043491792d04362ddd,U0ee506e05ee15d8c6ab29c72340c1304',
       updated_at = NOW()
  FROM cameras c
 WHERE c.id = o.camera_id
   AND c.site_id = 18
   AND c.cam_role = 'lpr';

-- กันกรณีมีกล้อง LPR ตัวไหนที่ยังไม่เคยมีแถวเลย (ไม่ควรมี ตรวจแล้วมีครบ 18/18
-- แต่ใส่ไว้กันเหตุ — checkOfflineCameras ที่ยังไม่เคยเห็นกล้องตัวนั้นออฟไลน์เลยสักครั้ง)
INSERT INTO camera_offline_alerts
  (camera_id, enabled, notify_after_sec, escalate_interval_min, escalate_once, recipient_ids, updated_at)
SELECT c.id, TRUE, 300, 120, FALSE,
       'C407b15147bc1e6043491792d04362ddd,U0ee506e05ee15d8c6ab29c72340c1304', NOW()
  FROM cameras c
 WHERE c.site_id = 18 AND c.cam_role = 'lpr'
   AND NOT EXISTS (SELECT 1 FROM camera_offline_alerts o WHERE o.camera_id = c.id);
