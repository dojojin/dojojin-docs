-- ============================================================
-- Vigil Platform — Phase 1: กฎแจ้งเตือนสำหรับ face match ที่มาจาก AuraFace-v1
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- คู่กับ face-embed-worker.js — rule_name แยกจาก HCP โดยตั้งใจ ('AuraFace
-- Blacklist Match' ไม่ใช่ 'Face Recognition Match' ของ migration 127) กันสอง
-- ระบบ blacklist (HCP vs AuraFace-v1) มา match ข้ามกันโดยไม่ได้ตั้งใจ
--
-- ⚠️ ตั้งใจให้ enabled = false และ recipient_ids ว่าง เหมือนกฎ HCP เดิม —
--    threshold ยังไม่ผ่านการ calibrate (ดู face-embed-worker.js) และ detection
--    model ของ AuraFace-v1 ยังมีปัญหา license ค้างอยู่ (§14-15) เปิดสวิตช์นี้
--    เป็นการตัดสินใจแยกต่างหากของเจ้าของ ไม่ใช่ default ของ migration
-- ============================================================

INSERT INTO alert_rules (name, enabled, camera_ids, rule_names, list_types, recipient_ids, cooldown_seconds)
SELECT 'AuraFace-v1 · พบใบหน้าในบัญชีดำ (Internal Test Only)', FALSE,
       ARRAY[]::text[], ARRAY['AuraFace Blacklist Match'], ARRAY['blackList'], ARRAY[]::text[], 60
 WHERE NOT EXISTS (
   SELECT 1 FROM alert_rules WHERE name = 'AuraFace-v1 · พบใบหน้าในบัญชีดำ (Internal Test Only)');
