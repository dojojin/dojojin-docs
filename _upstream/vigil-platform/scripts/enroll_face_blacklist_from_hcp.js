#!/usr/bin/env node
// ============================================================
// Vigil Platform — face_blacklist enrollment from HCP source photos
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// Runs ON CENTRAL. Embeds every 'active' blacklist.source_records photo from
// the HCP source (source_id=14, data_type='face') with AuraFace-v1 (via the
// hkt edge's /embed-query) and inserts one face_blacklist row per photo,
// resolved into the HCP group it actually came from (raw_json.group_name —
// e.g. "BLACKLIST 3จว.", "BLACKLIST TCC") via face_blacklist_groups. Group
// rows must already exist (id → matches GROUP_MAP below) — this script only
// assigns, it does not create groups, so a name typo fails loud instead of
// silently spawning a duplicate group.
//
// v2 (2026-08-10): rewritten after the owner asked to wipe and redo the
// first batch with real groups + guaranteed reference photos. enrolled_ref
// = sr.id is set correctly on every row from the start this time — v1 set
// it only from a later migration and had to backfill 1,428/1,496 by fragile
// label-matching (68 stayed unresolved, see migration 136). Re-running now
// (ON CONFLICT-free — see NOT EXISTS guard below) skips anything already
// enrolled, so a second run after an HCP re-sync only picks up new records.
//
// Usage (central, where src/.env has DB_* and SNAPSHOT_PROXY_SECRET):
//   cd src && set -a && . ./.env && cd .. && node scripts/enroll_face_blacklist_from_hcp.js
// Options: LIMIT (default: all) — e.g. LIMIT=5 for a dry run
'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'src', 'node_modules', 'pg'));
const { edgeCall } = require('../src/helpers/edgeCall');

const SITE = 'hkt';
const MODEL = 'auraface-v1';
const PHOTOS_DIR = path.join(__dirname, '..', 'blacklist-photos');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 2,
});

async function main() {
  const { rows: groupRows } = await pool.query('SELECT id, name FROM face_blacklist_groups');
  const groupByName = new Map(groupRows.map((g) => [g.name, g.id]));
  console.log(`โหลดกลุ่มแล้ว ${groupByName.size} กลุ่ม`);

  const { rows } = await pool.query(`
    SELECT sr.id, sr.photo_path, COALESCE(m.display_name, sr.name) AS label,
           sr.raw_json->>'group_name' AS group_name
      FROM blacklist.source_records sr
      JOIN blacklist.master_links ml ON ml.source_record_id = sr.id
      JOIN blacklist.master m ON m.id = ml.master_id
     WHERE sr.source_id = 14 AND sr.data_type = 'face'
       AND m.status = 'active' AND sr.photo_path IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM face_blacklist fb WHERE fb.enrolled_ref = sr.id::text)
     ORDER BY sr.id
     ${process.env.LIMIT ? `LIMIT ${Number(process.env.LIMIT) || 5}` : ''}`);
  console.log(`พบ ${rows.length} รูปที่ active — เริ่ม embed ทีละรูป (edge ตัวเดียวกับที่ worker ใช้อยู่ ช้ากว่าปกติได้บ้างช่วงนี้)`);

  let ok = 0, noFace = 0, missing = 0, failed = 0, noGroup = 0;
  for (const [i, r] of rows.entries()) {
    const file = path.join(PHOTOS_DIR, r.photo_path);
    if (!fs.existsSync(file)) { missing++; continue; }
    let b64;
    try { b64 = fs.readFileSync(file).toString('base64'); }
    catch (e) { failed++; console.error(`  [${r.id}] อ่านไฟล์ไม่ได้: ${e.message}`); continue; }

    const res = await edgeCall(SITE, '/face-engine-embed-query', { image_b64: b64 }, 20000);
    if (res.code === 200 && res.body?.ok === false) { noFace++; continue; }
    if (res.code !== 200 || !res.body?.ok) {
      failed++; console.error(`  [${r.id}] embed ล้มเหลว: ${res.body?.error || `HTTP ${res.code}`}`); continue;
    }
    const groupId = groupByName.get(r.group_name) || null;
    if (!groupId) noGroup++;
    await pool.query(
      `INSERT INTO face_blacklist (site_id, label, model_name, dim, embedding, active, created_by, enrolled_ref, group_id)
       VALUES ($1,$2,$3,$4,$5,true,'enroll_face_blacklist_from_hcp.js',$6,$7)`,
      [SITE, r.label, MODEL, res.body.dim, res.body.embedding, String(r.id), groupId]);
    ok++;
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${rows.length} · ok=${ok} no_face=${noFace} missing=${missing} failed=${failed} no_group=${noGroup}`);
  }
  console.log(`เสร็จ: ok=${ok} no_face=${noFace} missing_file=${missing} failed=${failed} no_group=${noGroup} / ${rows.length}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
