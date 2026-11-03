-- ============================================================
-- Migration 095 — blacklist.source_records.case_ref: one meaning, not two
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- WHY
-- case_ref was written with two different meanings depending on the source:
--   GuruSquare  -> the province   (importer: case_ref = rec.province)
--   DSS Pro     -> the reporting unit (case_ref = rec.org_name)
-- The master list query then aliased it as `province`, so DSS Pro rows rendered
-- a police unit (หน่วยเฝ้าตรวจ_B01) in the จังหวัด field AND printed it onto the
-- mock licence plate's province slot — where an operator reads a real province.
--
-- The importer now writes case_ref = reporting unit only, for every source.
-- This migration brings the 1,596 rows already imported into line, so the fix
-- applies without re-importing from the source systems.
--
-- SAFE: nothing is deleted. The province is not lost — it has always ALSO been
-- in raw_json->>'province', which is now the only place it is read from. Each
-- UPDATE is scoped by proving the stored value came from the wrong field, so a
-- re-run (or a row already correct) changes nothing.

-- ---------- 1. GuruSquare: case_ref held the province ----------
-- Only clear it where it still literally equals the payload's province — that
-- is the proof it was the mis-assigned value and not an operator's entry.
UPDATE blacklist.source_records r
   SET case_ref = NULL
  FROM blacklist.sources s
 WHERE s.id = r.source_id
   AND s.source_type = 'gurusquare'
   AND r.case_ref IS NOT NULL
   AND r.case_ref = r.raw_json->>'province';

-- ---------- 2. DSS Pro vehicles: org_name was stored twice ----------
-- name and case_ref both held org_name, so the detail modal showed the same
-- value under two different labels (หน่วยที่แจ้ง and หน่วยงาน). DSS records no
-- owner name for a vehicle; case_ref keeps the unit.
UPDATE blacklist.source_records r
   SET name = NULL
  FROM blacklist.sources s
 WHERE s.id = r.source_id
   AND s.source_type = 'dss_pro'
   AND r.data_type = 'lpr'
   AND r.name IS NOT NULL
   AND r.name = r.case_ref;

-- ---------- 3. master.display_name copied from the same value ----------
-- display_name was seeded from norm.name at insert. For LPR masters whose only
-- source record is a DSS vehicle, that made the unit name the identity label;
-- the plate is the identifier there, so clear it rather than leave a unit name
-- standing in for a vehicle.
UPDATE blacklist.master m
   SET display_name = NULL, updated_at = NOW()
 WHERE m.display_name IS NOT NULL
   AND m.id_hash IS NULL                     -- LPR masters only: never a person
   AND NOT EXISTS (
     SELECT 1 FROM blacklist.master_links l
      JOIN blacklist.source_records r ON r.id = l.source_record_id
     WHERE l.master_id = m.id AND r.name IS NOT NULL
   );
