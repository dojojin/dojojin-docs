-- ============================================================
-- Vigil Platform — Migration 188: สถานะ "ขาดการติดต่อ" ของ edge แบบคงทน
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ 2026-08-31 (วัดจาก alert_logs 17 วัน):
--   1) rmutr-v ดับต่อเนื่อง ~24 ชม. ระบบส่งข้อความ "ขาดการติดต่อ" หน้าตาเหมือนกัน
--      6 ใบ ห่างกัน 4h05m เป๊ะ (= cooldown 4 ชม. + รอบเช็ค 5 นาที) โดยไม่มีอะไร
--      แยกให้ออกว่า "ยังดับอยู่" กับ "ดับใหม่อีกแล้ว"
--   2) ไม่เคยมีข้อความตอนกลับมาออนไลน์เลย — checkEdgeStale() query เฉพาะแถวที่
--      stale ไซต์ที่กลับมาจึงหลุดออกจากผลลัพธ์เงียบ ๆ ไม่มี code path ไหนเห็นมัน
--   3) สถานะเดิมอยู่ใน Map ในหน่วยความจำ (alert-engine.js:539) หายทุกครั้งที่
--      restart — ข้อจำกัดนี้ถูกบันทึกไว้เองตั้งแต่ 2026-08-13 แต่ยังไม่ได้แก้
--
-- สี่คอลัมน์นี้ทำให้ state machine อยู่รอด restart ได้ · วางบน edge_status เพราะ
-- มีแถวละไซต์อยู่แล้ว และมี FK ON DELETE CASCADE จาก sites อยู่แล้ว
--
-- ⚠️ ไม่ backfill โดยตั้งใจ: ทุกไซต์ตอนนี้ heartbeat ปกติ ค่าทั้งสี่จึงเป็น NULL
--    และรอบตรวจแรกหลัง deploy จะไม่ส่งอะไรเลย · ไซต์ที่ "ดับอยู่จริง" ตอน deploy
--    จะถูกจับเป็นเหตุใหม่แล้วแจ้ง ซึ่งเป็นพฤติกรรมที่ถูก
-- ============================================================

ALTER TABLE edge_status ADD COLUMN IF NOT EXISTS offline_since        timestamptz;
ALTER TABLE edge_status ADD COLUMN IF NOT EXISTS offline_notified_at  timestamptz;
ALTER TABLE edge_status ADD COLUMN IF NOT EXISTS offline_notify_count integer NOT NULL DEFAULT 0;
ALTER TABLE edge_status ADD COLUMN IF NOT EXISTS recovered_at         timestamptz;

COMMENT ON COLUMN edge_status.offline_since IS
  'heartbeat สุดท้ายก่อนถือว่าขาดการติดต่อ · NULL = ถือว่าออนไลน์อยู่';
COMMENT ON COLUMN edge_status.offline_notify_count IS
  '0=ยังไม่เคยแจ้ง 1=แจ้งใบแรกแล้ว >=2=แจ้งซ้ำไปแล้ว (ใบแรกซ้ำที่ cooldown_hours จากนั้นวันละครั้ง)';
COMMENT ON COLUMN edge_status.recovered_at IS
  'ครั้งแรกที่เห็นกลับมาออนไลน์ระหว่างที่ offline_since ยังตั้งอยู่ · ใช้กันแกว่ง ต้องนิ่ง 10 นาทีก่อนแจ้งว่ากลับมาแล้ว';
