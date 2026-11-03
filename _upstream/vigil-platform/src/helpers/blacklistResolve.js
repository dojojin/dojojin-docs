// ============================================================
// Vigil Platform — Blacklist override resolution
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ONE place where "what the source said" + "what we corrected" become "what the
// operator sees". Every read path must go through this — if some query joins
// source_records directly it will silently show uncorrected data and resurrect
// records the operator already excluded.
//
// Layering (migration 094):
//   source_records  faithful mirror, overwritten by every import
//   overrides       our corrections, keyed the same way, survive re-import
//   => resolved     source_records with any non-NULL override applied
'use strict';

// SQL fragment: LEFT JOIN the override layer onto a `source_records r` alias.
// Kept as a string constant rather than repeated inline so a new query cannot
// accidentally omit it.
const OVERRIDE_JOIN = `
  LEFT JOIN blacklist.overrides o
    ON o.source_id = r.source_id AND o.external_id = r.external_id`;

// SQL fragment: the resolved (corrected) value of each overridable column.
// COALESCE order is override-first — that is the whole point of the layer.
const RESOLVED_COLS = `
  COALESCE(o.name, r.name)                   AS name,
  COALESCE(o.plate_numbers, r.plate_numbers) AS plate_numbers,
  COALESCE(o.case_note, r.case_note)         AS case_note,
  COALESCE(o.excluded, FALSE)                AS excluded`;

// Predicate: rows that belong in master / the operator-facing lists.
// `bl_respect_exclusions` can turn this off, but the default is ON — an
// exclusion the operator made must not quietly stop applying.
const NOT_EXCLUDED = `COALESCE(o.excluded, FALSE) = FALSE`;

// Did we change anything for this record? Drives the "แก้ไขโดยเรา" marker so an
// operator can always tell a corrected value from the source's own.
function overrideSummary(row) {
  if (!row) return { edited: false, fields: [] };
  const fields = [];
  if (row.o_name != null) fields.push('name');
  if (row.o_plate_numbers != null) fields.push('plate_numbers');
  if (row.o_case_note != null) fields.push('case_note');
  return { edited: fields.length > 0, fields, excluded: !!row.excluded };
}

// Load the override row for one record (used by the edit UI to show
// source-value vs our-value side by side).
async function getOverride(pool, sourceId, externalId) {
  const { rows } = await pool.query(
    `SELECT * FROM blacklist.overrides WHERE source_id = $1 AND external_id = $2`,
    [sourceId, externalId]);
  return rows[0] || null;
}

// Upsert an override. Passing null for a field CLEARS that override (falls back
// to the source value) — distinct from passing '' which would override with an
// empty string, so the caller must be deliberate.
async function setOverride(pool, sourceId, externalId, patch, actor) {
  const { rows } = await pool.query(`
    INSERT INTO blacklist.overrides
      (source_id, external_id, name, plate_numbers, case_note, excluded, exclude_reason, note, updated_by, updated_at)
    VALUES ($1,$2,$3,$4,$5,COALESCE($6,FALSE),$7,$8,$9,NOW())
    ON CONFLICT (source_id, external_id) DO UPDATE SET
      name           = EXCLUDED.name,
      plate_numbers  = EXCLUDED.plate_numbers,
      case_note      = EXCLUDED.case_note,
      excluded       = EXCLUDED.excluded,
      exclude_reason = EXCLUDED.exclude_reason,
      note           = EXCLUDED.note,
      updated_by     = EXCLUDED.updated_by,
      updated_at     = NOW()
    RETURNING *`,
    [sourceId, externalId, patch.name ?? null, patch.plate_numbers ?? null,
     patch.case_note ?? null, patch.excluded ?? false,
     patch.exclude_reason ?? null, patch.note ?? null, actor || null]);
  return rows[0];
}

// An override row that overrides nothing is noise — drop it so "is this record
// edited?" stays a simple existence check.
async function pruneEmptyOverride(pool, sourceId, externalId) {
  await pool.query(`
    DELETE FROM blacklist.overrides
    WHERE source_id = $1 AND external_id = $2
      AND name IS NULL AND plate_numbers IS NULL AND case_note IS NULL
      AND excluded = FALSE`, [sourceId, externalId]);
}

// How many records of this source are currently excluded — surfaced in the
// import summary so a re-import can say "4 excluded records were refreshed but
// stayed out", instead of the operator wondering why counts don't add up.
async function excludedCount(pool, sourceId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) n FROM blacklist.overrides WHERE source_id = $1 AND excluded`, [sourceId]);
  return Number(rows[0].n);
}

module.exports = {
  OVERRIDE_JOIN, RESOLVED_COLS, NOT_EXCLUDED,
  overrideSummary, getOverride, setOverride, pruneEmptyOverride, excludedCount,
};
