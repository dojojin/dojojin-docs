-- ============================================================
-- Vigil Platform — migration 108: columnise the last rawXml-only ANPR fields
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- enforceRawXmlRetention() strips raw_json.rawXml after rawxml_retention_days
-- (90). The note above it has warned since it was written that four fields live
-- only inside that XML and are lost on expiry:
--   plateType / plateCharBelieve / tailandStateID / licenseBright
--
-- Measured 2026-07-31 against live rows — the note overstates it. Two of the
-- four already survive:
--   plateType      → present at the TOP level of raw_json, 45,196/45,196 rows
--   tailandStateID → parsed into `region` (license_plates.region) at ingest
-- The other two are genuinely rawXml-only and have never been persisted:
--   plateCharBelieve  per-character OCR confidence, e.g. "92,92,92,92,92,92"
--   licenseBright     plate brightness, e.g. "166"
--
-- Oldest data is 28 days old, so nothing has expired yet — there are roughly 62
-- days before the first row crosses 90 and takes these with it. This is why the
-- columns land now: it is data-loss prevention on a clock, not a space saving.
-- Stripping rawXml turns out to be worth only ~3.9% of the events table
-- (Hikvision ANPR is 5.9% of stored bytes), so there is no space argument for
-- shrinking that window at all.
--
-- Nullable with no backfill: every existing row still carries its rawXml, so the
-- values are recoverable from history if they are ever wanted, and a 5.4M-row
-- UPDATE to fill them would cost more in dead tuples than the columns are worth.
-- ============================================================

ALTER TABLE license_plates
  ADD COLUMN IF NOT EXISTS plate_char_believe text,
  ADD COLUMN IF NOT EXISTS license_bright     smallint;

COMMENT ON COLUMN license_plates.plate_char_believe IS
  'ความมั่นใจ OCR รายตัวอักษรจากกล้อง Hikvision (plateCharBelieve) เช่น "92,92,92" — ตัวเลขต่ำแปลว่าอักษรตัวนั้นน่าสงสัย';
COMMENT ON COLUMN license_plates.license_bright IS
  'ความสว่างของป้ายที่กล้องวัดได้ (licenseBright 0-255) — ใช้วิเคราะห์ว่าอ่านพลาดเพราะแสงหรือไม่';
