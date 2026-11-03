// ============================================================
// Vigil Platform — Blacklist reservoir -> face_blacklist bridge (FB)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// Face's equivalent of blacklistBridge.js (LPR). Same shape, same
// invariants — read that file's header first, this one only calls out
// where face genuinely differs:
//
//   1. No plate_number-shaped natural key. face_blacklist's PK is a bare
//      id, so blacklist_master_id (migration 161) plus a partial unique
//      index (migration 162) does the job plate_number does for free on
//      lpr_watchlist — one bridge-owned row per identity, upsertable by
//      ON CONFLICT (blacklist_master_id) WHERE origin='blacklist_bridge'.
//
//   2. No province gate. LPR's "must have a province to enter" rule exists
//      because a bare plate repeats across provinces; a face embedding is
//      already the identity check, so there is nothing analogous to gate on.
//
//   3. Enrollment needs a synchronous edge round-trip. Copying LPR's ref
//      photo is a filesystem copy; enrolling a face means reading the
//      winning source record's photo, sending it to the edge's
//      /face-engine-embed-query, and storing the embedding it returns.
//      That call can fail or find no usable face — per-row, not fatal to
//      the sync, same posture as materializeBridgePhoto()'s try/catch.
//
//   4. ONE INVARIANT, same as the LPR file: origin='blacklist_bridge' is
//      what makes this safe to auto-apply. A row an operator enrolled by
//      hand (origin='manual', the default) is never read, written, or
//      deleted by anything below.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { visibleRecordSql } = require('./blacklistVisibility');
const { edgeCall } = require('./edgeCall');
const { PHOTO_DIR } = require('./blacklistImport');
const { snapshotDir } = require('./snapshotDir');
const sharp = require('sharp');

// Mirrors face-embed-worker.js's MODEL/SITE constants exactly — the Lab Test
// pipeline is hardcoded to this one site/model throughout (checked: no
// per-source config for it anywhere), so hardcoding here too rather than
// threading a new config path through for a pipeline that has never had one.
const SITE = 'hkt';
const MODEL_NAME = 'auraface-v1';

const REF_DIR = path.join(snapshotDir(), 'face-blacklist');

// The only signal that says "the source photo itself changed" (migration 169).
// Not mtime and not source_records.updated_at: savePhoto() rewrites the file
// unconditionally on every import, so both move for every row every run —
// measured 2026-08-22, a source file and its copy with identical md5 and mtimes
// three hours apart. Null when the DB names a photo the disk does not have;
// diffFace() treats that as "no opinion", never as "changed", or the row would
// re-embed on every sync forever.
function sourcePhotoSha1(photoPath) {
  if (!photoPath) return null;
  const src = path.join(PHOTO_DIR, photoPath);
  if (!src.startsWith(PHOTO_DIR)) return null;
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex');
  } catch {
    return null;                       // missing/unreadable — embedPhoto() reports it
  }
}

// Was every active rule named? Same reasoning as blacklistBridge.js's
// coversEveryActiveRule() — a narrowed diff cannot see whether some other
// rule still claims an identity, so it must never propose removing one.
async function coversEveryActiveRule(pool, ruleIds) {
  const given = new Set((ruleIds || []).map(String));
  const { rows } = await pool.query('SELECT id FROM blacklist.face_bridge_rules WHERE active');
  return rows.every((r) => given.has(String(r.id)));
}

// Richest-wins per master: has a usable photo first (nothing to enroll
// without one), then the longer case narrative. No province term — face has
// nothing analogous to gate on.
async function bestFaceRecordsByMaster(pool, masterIds) {
  if (!masterIds.length) return new Map();
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (l.master_id)
           l.master_id, s.label AS source_label, r.source_id, r.name,
           COALESCE(o.case_note, r.case_note) AS case_note,
           r.case_ref, r.photo_path
      FROM blacklist.source_records r
      JOIN blacklist.master_links l ON l.source_record_id = r.id
      JOIN blacklist.sources s ON s.id = r.source_id
      LEFT JOIN blacklist.overrides o ON o.source_id = r.source_id AND o.external_id = r.external_id
     WHERE l.master_id = ANY($1) AND r.data_type = 'face' AND COALESCE(o.excluded, FALSE) = FALSE
       AND ${visibleRecordSql('r')}
     ORDER BY l.master_id,
       (r.photo_path IS NOT NULL) DESC,
       length(COALESCE(o.case_note, r.case_note, '')) DESC,
       r.source_id`,
    [masterIds]);
  return new Map(rows.map((r) => [r.master_id, r]));
}

// Identities the active rules currently select. Exclusions and local
// corrections are honoured, same as desiredRows() (LPR).
async function desiredFaceRows(pool, ruleIds) {
  const { rows: rules } = await pool.query(`
    SELECT r.*, s.label AS source_label
      FROM blacklist.face_bridge_rules r
      JOIN blacklist.sources s ON s.id = r.source_id
     WHERE r.active ${ruleIds && ruleIds.length ? 'AND r.id = ANY($1)' : ''}
     ORDER BY r.id`,
    ruleIds && ruleIds.length ? [ruleIds] : []);

  const { rows: groupRows } = await pool.query('SELECT id, notify_line FROM face_blacklist_groups');
  const groupNotify = new Map(groupRows.map((g) => [g.id, g.notify_line]));

  const byMaster = new Map();
  for (const rule of rules) {
    const params = [rule.source_id];
    const cond = [];
    if (rule.group_names && rule.group_names.length) {
      params.push(rule.group_names);
      cond.push(`r.raw_json->>'group_name' = ANY($${params.length})`);
    }
    if (rule.external_ids && rule.external_ids.length) {
      params.push(rule.external_ids);
      cond.push(`r.external_id = ANY($${params.length})`);
    }
    const { rows } = await pool.query(`
      SELECT DISTINCT l.master_id
        FROM blacklist.source_records r
        JOIN blacklist.master_links l ON l.source_record_id = r.id
        LEFT JOIN blacklist.overrides o
          ON o.source_id = r.source_id AND o.external_id = r.external_id
       WHERE r.source_id = $1
         AND r.data_type = 'face'
         AND ${visibleRecordSql('r')}
         AND COALESCE(o.excluded, FALSE) = FALSE
         ${cond.length ? 'AND ' + cond.join(' AND ') : ''}`, params);

    if (!rows.length) continue;
    const masterIds = rows.map((r) => r.master_id);
    const best = await bestFaceRecordsByMaster(pool, masterIds);

    for (const masterId of masterIds) {
      // First rule to claim an identity wins — same reason as LPR: two
      // overlapping rules must not produce a row that flaps between them.
      if (byMaster.has(masterId)) continue;
      const b = best.get(masterId);
      if (!b || !b.photo_path) continue; // nothing to embed — skip, don't half-enroll
      byMaster.set(masterId, {
        blacklist_master_id: masterId,
        group_id: rule.target_group_id || null,
        notify_line: rule.target_group_id ? (groupNotify.get(rule.target_group_id) ?? true) : true,
        label: [b.source_label || rule.source_label, b.case_ref].filter(Boolean).join(' · ')
          || b.name || `master-${masterId}`,
        notes: b.case_note || null,
        photo_source: b.photo_path,
        // Reading the file here keeps this a pure read — it backs the preview
        // GET, so hashing (cheap) is fine where copying or embedding would not be.
        photo_sha1: sourcePhotoSha1(b.photo_path),
      });
    }
  }
  return byMaster;
}

// Does this identity need rewriting? Its own function so a test can pin the
// photo rule without standing up a pool — see test/blacklist-bridge-photo.test.js.
//
// photo_sha1 is what makes a photo-only correction visible (migration 169).
// ref_image still isn't compared: it is our own output filename, derived from
// master_id, so it never changes when the picture behind it does.
//
// The photo test is one-directional on purpose. A null WANT hash means the file
// is missing or unreadable, not that it changed — comparing it plainly would
// put the row in update on every sync, embed would fail every time, forever.
// A null HAVE hash does count: those are rows predating the column, and one
// backfill re-embed is exactly what they need.
function faceRowChanged(have, want) {
  const photoChanged = !!want.photo_sha1 && have.photo_sha1 !== want.photo_sha1;
  return have.label !== want.label || have.notes !== want.notes ||
    have.group_id !== want.group_id || have.notify_line !== want.notify_line ||
    photoChanged;
}

// What a sync would change. Pure read — safe to call from a preview endpoint.
async function diffFace(pool, ruleIds) {
  const desired = await desiredFaceRows(pool, ruleIds);
  const { rows: current } = await pool.query(`
    SELECT id, blacklist_master_id, label, notes, group_id, notify_line, ref_image, photo_sha1
      FROM face_blacklist WHERE origin = 'blacklist_bridge'`);
  const cur = new Map(current.map((r) => [String(r.blacklist_master_id), r]));

  const { rows: manual } = await pool.query(
    `SELECT blacklist_master_id FROM face_blacklist WHERE origin <> 'blacklist_bridge' AND blacklist_master_id IS NOT NULL`);
  const manualSet = new Set(manual.map((r) => String(r.blacklist_master_id)));

  const add = [], update = [], remove = [], skipped = [];
  for (const [masterId, want] of desired) {
    const key = String(masterId);
    if (manualSet.has(key)) { skipped.push(masterId); continue; }
    const have = cur.get(key);
    if (!have) { add.push(want); continue; }
    if (faceRowChanged(have, want)) update.push(want);
  }
  // Same narrowed-diff hazard as blacklistBridge.js's diff() — see its
  // 481-row-incident comment. Only a full sync (no ruleIds, or ruleIds that
  // cover every active rule) can see whether some other rule still claims
  // an identity, so only a full sync ever proposes removals.
  const partial = !!(ruleIds && ruleIds.length) && !(await coversEveryActiveRule(pool, ruleIds));
  if (!partial) {
    for (const [key, have] of cur) {
      if (!desired.has(Number(key))) remove.push({ blacklist_master_id: have.blacklist_master_id, label: have.label, id: have.id });
    }
  }
  return { add, update, remove, skipped, partial, desired_total: desired.size, current_total: cur.size, desired };
}

// Reads the winning photo off disk, sends it to the edge, and returns the
// embedding — or null if the file is missing or the edge found no usable
// face. Never throws: a bad photo must not sink the rest of the sync.
async function embedPhoto(photoPath) {
  const src = path.join(PHOTO_DIR, photoPath);
  if (!src.startsWith(PHOTO_DIR) || !fs.existsSync(src)) return null;
  try {
    const buf = fs.readFileSync(src);
    const r = await edgeCall(SITE, '/face-engine-embed-query', { image_b64: buf.toString('base64') }, 20000);
    if (r.code === 200 && r.body?.ok === false) return null; // no face detected — not an error
    if (r.code !== 200 || !r.body?.ok) {
      console.warn(`[blacklistFaceBridge] embed failed for ${photoPath}: ${r.body?.error || `http_${r.code}`}`);
      return null;
    }
    // Display-size copy, same treatment face-blacklist.js's manual upload
    // gives one, saved under a name fixed to the master (like LPR's
    // wl_bridge_<master_id>.jpg) so re-syncing the same winner is a no-op
    // write, not a growing pile of files.
    return { embedding: r.body.embedding, dim: r.body.dim, buf };
  } catch (e) {
    console.warn(`[blacklistFaceBridge] embed error for ${photoPath}:`, e.message);
    return null;
  }
}

async function materializeFaceRef(masterId, buf) {
  try {
    fs.mkdirSync(REF_DIR, { recursive: true });
    const destName = `fb_bridge_${masterId}.jpg`;
    await sharp(buf, { failOn: 'none' })
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(path.join(REF_DIR, destName));
    return `face-blacklist/${destName}`;
  } catch (e) {
    console.error(`[blacklistFaceBridge] ref image write failed for master ${masterId}:`, e.message);
    return null;
  }
}

// Apply the diff. One transaction for row writes; the edge embed calls
// happen before it starts (they are the slow, fallible part, and there is
// nothing to roll back about calling an external API).
async function syncFace(pool, ruleIds, actor) {
  const d = await diffFace(pool, ruleIds);
  const skippedSet = new Set(d.skipped.map(String));

  // Only the rows actually being written. This used to embed EVERY desired row
  // on every sync — the only way to notice a source photo correction back when
  // the diff could not see one. photo_sha1 (migration 169) makes such a
  // correction land in d.update by itself, so a sync that renames one label no
  // longer fires an edge embed for the whole roster.
  const embedded = new Map();
  for (const r of [...d.add, ...d.update]) {
    if (skippedSet.has(String(r.blacklist_master_id))) continue;
    const e = await embedPhoto(r.photo_source);
    if (e) embedded.set(r.blacklist_master_id, e);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let added = 0, updated = 0;
    for (const r of d.add) {
      const e = embedded.get(r.blacklist_master_id);
      if (!e) continue; // could not embed — do not half-enroll; next sync retries
      const refImage = await materializeFaceRef(r.blacklist_master_id, e.buf);
      await client.query(`
        INSERT INTO face_blacklist
          (site_id, label, model_name, dim, embedding, active, created_by,
           group_id, notes, notify_line, ref_image, origin, blacklist_master_id,
           photo_sha1)
        VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,$8,$9,$10,'blacklist_bridge',$11,$12)
        ON CONFLICT (blacklist_master_id) WHERE origin = 'blacklist_bridge' DO NOTHING`,
        [SITE, r.label, MODEL_NAME, e.dim, e.embedding, actor?.username || 'auto-sync',
         r.group_id, r.notes, r.notify_line, refImage, r.blacklist_master_id,
         r.photo_sha1]);
      added++;
    }
    for (const r of d.update) {
      const e = embedded.get(r.blacklist_master_id);
      const refImage = e ? await materializeFaceRef(r.blacklist_master_id, e.buf) : null;
      await client.query(`
        UPDATE face_blacklist
           SET label = $2, notes = $3, group_id = $4, notify_line = $5,
               dim = COALESCE($6, dim), embedding = COALESCE($7, embedding),
               ref_image = COALESCE($8, ref_image),
               -- ⚠️ ต้อง COALESCE คู่กับ embedding เสมอ: ถ้า embed พัง ($9 = null)
               --    แล้วเขียน hash ใหม่ลงไป แถวจะอ้างว่าถือรูปใหม่ทั้งที่ vector
               --    ยังเป็นของเก่า · diff รอบต่อ ๆ ไปจะเห็นว่า hash ตรงกันแล้ว
               --    ⇒ ไม่มีวัน retry อีกเลย เงียบและถาวร
               photo_sha1 = COALESCE($9, photo_sha1), updated_at = NOW()
         WHERE blacklist_master_id = $1 AND origin = 'blacklist_bridge'`,
        [r.blacklist_master_id, r.label, r.notes, r.group_id, r.notify_line,
         e?.dim || null, e?.embedding || null, refImage,
         e ? r.photo_sha1 : null]);
      updated++;
    }
    if (d.remove.length) {
      // The origin guard is what makes removal safe — see the file header.
      await client.query(
        `DELETE FROM face_blacklist WHERE origin = 'blacklist_bridge' AND blacklist_master_id = ANY($1)`,
        [d.remove.map((r) => r.blacklist_master_id)]);
    }
    await client.query(
      `UPDATE blacklist.sources SET last_face_bridge_sync_at = NOW()
        WHERE id IN (SELECT source_id FROM blacklist.face_bridge_rules
                      WHERE active ${ruleIds && ruleIds.length ? 'AND id = ANY($1)' : ''})`,
      ruleIds && ruleIds.length ? [ruleIds] : []);
    await client.query('COMMIT');

    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
      [actor?.id || null, actor?.username || 'system', 'face_blacklist_bridge_sync',
       JSON.stringify({ rule_ids: ruleIds || 'all', added, updated, removed: d.remove.length,
                        skipped_manual: d.skipped.length,
                        embed_failed: d.add.length - added })]
    ).catch(() => {});

    return { added, updated, removed: d.remove.length, skipped_manual: d.skipped.length,
             embed_failed: d.add.length - added };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Which of `masterIds` (a proposed removal set) are NOT yet confirmed safe
// to drop — same two reasons blacklistImport.js's unconfirmedRemovals()
// accepts for LPR (vanished_at OR operator-excluded), checked against every
// source_record linked to the identity rather than a plate string.
async function unconfirmedFaceRemovals(pool, masterIds) {
  if (!masterIds || !masterIds.length) return [];
  const { rows } = await pool.query(
    `SELECT m FROM unnest($1::bigint[]) AS m
      WHERE NOT EXISTS (
        SELECT 1 FROM blacklist.master_links ml
          JOIN blacklist.source_records sr ON sr.id = ml.source_record_id
          LEFT JOIN blacklist.overrides o
            ON o.source_id = sr.source_id AND o.external_id = sr.external_id
         WHERE ml.master_id = m
           AND (sr.vanished_at IS NOT NULL OR COALESCE(o.excluded, FALSE) = TRUE))`,
    [masterIds]);
  return rows.map((r) => r.m);
}

// Mirrors blacklistBridge.js's attemptAutoSync(): one confirmed-safe sync
// attempt, called after an import's face vanish-scan. Never throws.
async function attemptAutoFaceSync(pool, { username } = {}) {
  try {
    const d = await diffFace(pool, null);
    if (!d.remove.length && !d.add.length && !d.update.length) {
      return { ok: true, skipped: 'nothing to sync' };
    }
    const pending = await unconfirmedFaceRemovals(pool, d.remove.map((r) => r.blacklist_master_id));
    if (pending.length) {
      return { ok: true, skipped: `${pending.length} identity(ies) pending review` };
    }
    const r = await syncFace(pool, null, { username: username || 'auto-sync' });
    return { ok: true, ...r };
  } catch (e) {
    console.warn('[blacklistFaceBridge] attemptAutoFaceSync failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  desiredFaceRows, diffFace, syncFace, attemptAutoFaceSync, unconfirmedFaceRemovals,
  SITE, MODEL_NAME,
  __test: { faceRowChanged, sourcePhotoSha1 },
};
