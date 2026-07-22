-- ============================================================
-- Vigil Platform — Migration 045: alert min_likelihood threshold
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- 2026-06-12: ghost detection (เคสจริง: likelihood 0.34 หลัง GlobalSceneChange
-- — "ผีเสื้อเหลือง") ไม่ควรยิง LINE. rule ตั้ง min_likelihood (0..1) แล้ว
-- event ที่ likelihood ต่ำกว่าจะถูกข้าม; event ที่ไม่มี likelihood
-- (Hikvision/Dahua ไม่ส่ง) ผ่านเสมอ — ห้าม threshold ไปบล็อก vendor อื่น.
-- NULL = ไม่กรอง (พฤติกรรมเดิม). idempotent.

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS min_likelihood REAL;
