-- ============================================================
-- Vigil Platform — Migration 246: bridge_password_enc ต่อไซต์
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เก็บรหัสผ่าน MQTT bridge ของแต่ละไซต์แบบเข้ารหัส (encryptPii, AES-256-GCM —
-- src/helpers/blacklist-crypto.js) ไว้ใน DB เอง เพื่อให้ย้าย broker ครั้งหน้า
-- (mosquitto → broker อื่น) ทำได้โดยไม่ต้อง ssh เข้า edge อ่าน .env อีก
-- (เจ้าของอนุมัติ 2026-09-27 ข้อ 2 ใน mosquitto-migration-plan.md §6.1)
--
-- เขียนครั้งแรกตอน M2 cutover (อ่านรหัสเดิมจาก .env ของแต่ละ edge แล้วเข้ารหัสเก็บ)
-- และทุกครั้งที่ provisionSite() สร้าง/หมุนรหัสใหม่ (src/site-provision.js)
-- คอลัมน์นี้เก็บ ciphertext เท่านั้น — ไม่เคย log ค่า plaintext
-- ============================================================

ALTER TABLE sites ADD COLUMN IF NOT EXISTS bridge_password_enc TEXT;
