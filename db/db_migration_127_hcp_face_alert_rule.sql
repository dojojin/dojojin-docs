-- ============================================================
-- Vigil Platform — HC1: กฎแจ้งเตือนสำหรับ face match ที่มาจาก HCP
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- ทำไมต้องมีกฎใหม่ ไม่ใช้ของเดิม (ตรวจแล้ว 2026-08-08):
--   alert_rules ที่มีอยู่ 3 ข้อ · enabled = false ทุกข้อ · แต่ละข้อระบุ camera_ids
--   ไว้กล้องเดียว ⇒ ไม่มีข้อไหนครอบ 25+ กล้องที่ HCP ส่ง match มา
--
-- เงื่อนไขที่ alert-engine.js:69-79 ใช้จับคู่ และเหตุผลของแต่ละค่า:
--   camera_ids = {}                      ว่าง = ทุกกล้อง · HCP ส่งมาจาก 25 กล้องใน
--                                        การ backfill วันเดียว และจะเพิ่มอีก
--   rule_names = {Face Recognition Match} ตรงกับ rule_name ที่ ingester ตั้งให้ทุกแถว
--   list_types = {blackList}             เฉพาะบัญชีดำ · กลุ่มที่ชื่อขึ้นต้น Whitelist
--                                        ถูก ingester ติดป้าย whiteList ไว้แล้ว
--
-- ⚠️ ตั้งใจให้ enabled = false และ recipient_ids ว่าง (เจ้าของสั่ง 2026-08-08)
--    สองชั้นนี้แปลว่าเปิดสวิตช์อย่างเดียวยังไม่ส่งอะไรออกไป ต้องเลือกผู้รับก่อน —
--    ใครควรได้รับแจ้งเตือนจริงเป็นการตัดสินใจของเจ้าของ ไม่ใช่ค่า default ของ migration
--    ปริมาณที่คาด ~4.6 ครั้ง/วัน (จาก 556 ครั้ง/120 วันที่วัดได้จาก HCP ภูเก็ต)
-- ============================================================

INSERT INTO alert_rules (name, enabled, camera_ids, rule_names, list_types, recipient_ids, cooldown_seconds)
SELECT 'HCP · พบใบหน้าในบัญชีดำ (ภูเก็ต)', FALSE,
       ARRAY[]::text[], ARRAY['Face Recognition Match'], ARRAY['blackList'], ARRAY[]::text[], 60
 WHERE NOT EXISTS (
   SELECT 1 FROM alert_rules WHERE name = 'HCP · พบใบหน้าในบัญชีดำ (ภูเก็ต)');
