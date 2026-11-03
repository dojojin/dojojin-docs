-- ============================================================
-- Vigil Platform — Migration 250: license_plates — autovacuum ANALYZE ถี่ขึ้น
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ค่าเริ่มต้น autovacuum_analyze_scale_factor = 0.1 ⇒ ตาราง ~53 ล้านแถวต้องเปลี่ยน ~5.3 ล้านแถว
-- ถึงจะ analyze ใหม่ (รับป้าย ~800k/วัน = ~6–7 วันครั้ง) · histogram ของ detected_at จึงจบก่อน
-- "ช่วงล่าสุด" เสมอ planner ประมาณแถว 1 วันได้ 35,515 ทั้งที่จริง 873,881 (ตรวจ 2026-10-02 ·
-- histogram ค้างที่ 18 ก.ย.) → เลือกแผนผิดในหน้าสรุป/facets (audit O6 · GOTCHAS #219)
-- 0.005 ≈ 265k แถว ≈ ทุก ~8 ชม. · ANALYZE แค่สุ่มตัวอย่าง (~30k แถว) ใช้ไม่กี่วินาที
-- เปลี่ยนเฉพาะ storage parameter ของตาราง (metadata) — ไม่ rewrite ไม่ล็อกนาน · รันซ้ำได้
-- ============================================================

ALTER TABLE license_plates SET (autovacuum_analyze_scale_factor = 0.005);
