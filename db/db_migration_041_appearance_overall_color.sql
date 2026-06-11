-- ============================================================
-- Vigil Platform — Migration 041: appearance overall (dominant) color
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- กล้อง IVA ที่ไม่ใช่ Pro (เช่น BOSCH_3100i) ส่ง Appearance แค่ Class + Color
-- (ColorCluster สีเด่นทั้งตัว) — ไม่มี HumanBody/HumanFace รายชิ้น.
-- เก็บ dominant cluster เป็นแถว low-fidelity ให้ Person Data ค้นแบบหยาบได้
-- ("คนโทนเสื้อขาวข้ามเส้น") โดย garment columns เป็น NULL ตามจริง.
-- idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- ดู BOSCH_IVA_Appearance.MD + session 2026-06-10

ALTER TABLE appearances ADD COLUMN IF NOT EXISTS overall_color     VARCHAR(20);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS overall_color_xyz VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_appearances_overall_color ON appearances(overall_color);
