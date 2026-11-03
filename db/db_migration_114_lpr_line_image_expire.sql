-- ============================================================
-- Vigil Platform — migration 114: how long a plate photo lives on imgbb
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- LINE cannot display an image from a private host, so an alert photo is
-- uploaded to imgbb and the message points at that copy. Every alert has used a
-- hardcoded 48h expiry since the feature existed.
--
-- LPR now gets its own, at the owner's request (2026-08-04), because the two are
-- not the same kind of data: a doorway alert frame is a person in a corridor,
-- while an ANPR frame is a readable plate belonging to an identifiable citizen,
-- and this platform holds those for a government customer. Leaving them on a
-- third-party host for the same duration is a decision nobody had made — it was
-- just the number that was already there.
--
-- 24h by default: watch-list hits are acted on within a shift, and the alert
-- history in alert_logs keeps the record regardless. The image is a convenience
-- for the person reading the message, not the record.
--
-- Range is 1..720h, enforced in routes/settings.js. imgbb's own limit is
-- 60s..180d, and line-sender clamps to it as well — a value outside that range
-- makes imgbb reject the whole upload rather than fall back to a default, which
-- would turn every alert into text-only with no obvious cause.
-- ============================================================

INSERT INTO system_settings (key, value, description)
VALUES ('lpr_line_image_expire_hours', '24',
        'ชั่วโมงที่รูป LPR อยู่บน imgbb ก่อนถูกลบอัตโนมัติ (แจ้งเตือนชนิดอื่นใช้ 48 ชม.) — ตั้งได้ที่ ตั้งค่า › ระบบ LPR › แสดงผล/จัดเก็บ')
ON CONFLICT (key) DO NOTHING;
