-- ============================================================
-- Vigil Platform — Migration 044: dwell alert threshold on alert_rules
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- 2026-06-11: alert "อยู่นานผิดปกติ" — rule ที่ตั้ง dwell_threshold_sec
-- จะเปลี่ยนพฤติกรรม: ไม่ยิงต่อ event แต่ alert-worker เช็คทุก 1 นาทีว่า
-- มี open episode (FieldDetector true ที่ยังไม่มี false) อยู่นานเกิน
-- threshold แล้วยิง LINE ผ่าน pipeline เดิม (recipients/cooldown/quiet
-- hours/log ใช้ของ rule ตามปกติ; cooldown = ระยะเตือนซ้ำระหว่างยังอยู่).
-- NULL = rule ปกติ (ยิงต่อ event เหมือนเดิม). idempotent.

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS dwell_threshold_sec INTEGER;
