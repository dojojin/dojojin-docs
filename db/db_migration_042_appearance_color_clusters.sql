-- ============================================================
-- Vigil Platform — Migration 042: full appearance color clusters
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- Ph.3 (2026-06-10): migration 041 เก็บเฉพาะสีเด่นอันดับ 1 — กล้องส่ง
-- ColorCluster มา 2-3 สีพร้อม weight (เช่น ขาว 43% / ดำ 30%) → เก็บครบเป็น
-- JSONB array [{xyz, name, weight}] เรียงตาม weight เพื่อค้น "คนใส่ดำ-ขาว"
-- ผ่าน containment (@>). overall_color ยังเป็น top-1 เหมือนเดิม (display หลัก)
-- idempotent: ADD COLUMN IF NOT EXISTS

ALTER TABLE appearances ADD COLUMN IF NOT EXISTS color_clusters JSONB;
