#!/usr/bin/env node
// ============================================================
// Vigil Platform — one-time remediation: merge LPR masters by plate
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// WHY
// LPR sources carry no national ID, so every source_record became its own
// master — including the 32 plates that appear 2-4 times. The importer now uses
// plate_hash as a fallback match key, but that only affects NEW rows; the 1,080
// already imported still need re-linking. This does that once.
//
// WHAT IT DOES (per plate_hash group, LPR only)
//   1. keep the LOWEST master id as the survivor
//   2. re-point every master_link from the losers onto the survivor
//   3. delete the now-orphaned loser masters
//   4. stamp plate_hash on the survivor so future imports match it
// source_records are never touched — no case is lost, only the identity index
// collapses.
//
// SAFE BY DEFAULT: dry-run unless --apply is passed. Everything runs inside one
// transaction, so a failure mid-way leaves the reservoir exactly as it was.
//
// Usage (central — env comes from the shell, same as the other backfills):
//   cd src && set -a && . ./.env && cd .. && node scripts/blacklist-plate-dedup.js
//   ... && node scripts/blacklist-plate-dedup.js --apply
// BLACKLIST_SECRET_KEY must be in the environment: plate_hash is an HMAC, so
// this cannot be done in pure SQL.
'use strict';

const path = require('path');
// Runtime deps live in src/node_modules, and Node resolves from the SCRIPT's
// directory — not the cwd — so a bare require('pg') from scripts/ never finds
// them. Resolve against src/package.json instead of relying on how it's invoked.
const { createRequire } = require('module');
const srcRequire = createRequire(path.join(__dirname, '..', 'src', 'package.json'));
const { Pool } = srcRequire('pg');
const { plateHash } = require(path.join(__dirname, '..', 'src', 'helpers', 'blacklist-crypto'));

if (!process.env.BLACKLIST_SECRET_KEY) {
  console.error('BLACKLIST_SECRET_KEY not in env — source src/.env first (see usage above)');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const before = await c.query(`
      SELECT COUNT(DISTINCT l.master_id) masters, COUNT(*) recs
      FROM blacklist.master_links l
      JOIN blacklist.source_records r ON r.id = l.source_record_id
      WHERE r.data_type = 'lpr'`);
    console.log(`ก่อน: source_records ${before.rows[0].recs} → master ${before.rows[0].masters}`);

    // ---- 1. backfill plate_hash on source_records (HMAC needs JS, not SQL) ----
    const recs = await c.query(`
      SELECT id, plate_numbers FROM blacklist.source_records
      WHERE data_type = 'lpr' AND COALESCE(array_length(plate_numbers,1),0) > 0`);
    let hashed = 0;
    for (const r of recs.rows) {
      const h = plateHash(r.plate_numbers[0]);
      if (!h) continue;
      await c.query('UPDATE blacklist.source_records SET plate_hash = $2 WHERE id = $1', [r.id, h]);
      hashed++;
    }
    console.log(`ใส่ plate_hash: ${hashed} / ${recs.rowCount} ระเบียน`);

    // ---- 2. find groups where one plate spans more than one master ----
    const groups = await c.query(`
      SELECT r.plate_hash,
             MIN(l.master_id) AS keep_id,
             ARRAY_AGG(DISTINCT l.master_id) AS master_ids,
             COUNT(DISTINCT l.master_id) AS n_masters,
             MIN(r.plate_numbers[1]) AS sample_plate
      FROM blacklist.source_records r
      JOIN blacklist.master_links l ON l.source_record_id = r.id
      WHERE r.data_type = 'lpr' AND r.plate_hash IS NOT NULL
      GROUP BY r.plate_hash
      HAVING COUNT(DISTINCT l.master_id) > 1
      ORDER BY COUNT(DISTINCT l.master_id) DESC`);

    console.log(`\nกลุ่มที่ต้องยุบ: ${groups.rowCount} ทะเบียน`);
    groups.rows.slice(0, 8).forEach(g =>
      console.log(`   ${g.sample_plate}  ${g.n_masters} master → 1`));
    if (groups.rowCount > 8) console.log(`   ... อีก ${groups.rowCount - 8} ทะเบียน`);

    let merged = 0, dropped = 0;
    for (const g of groups.rows) {
      const losers = g.master_ids.filter(id => String(id) !== String(g.keep_id));
      if (!losers.length) continue;
      // move every link onto the survivor; ON CONFLICT covers the case where a
      // record was somehow already linked to it
      await c.query(`
        UPDATE blacklist.master_links SET master_id = $1
        WHERE master_id = ANY($2)`, [g.keep_id, losers]);
      await c.query('DELETE FROM blacklist.master WHERE id = ANY($1)', [losers]);
      await c.query('UPDATE blacklist.master SET plate_hash = $2, updated_at = NOW() WHERE id = $1',
        [g.keep_id, g.plate_hash]);
      merged++; dropped += losers.length;
    }

    // ---- 3. stamp plate_hash on the single-master plates too, so the next
    //         import matches them instead of creating a duplicate ----
    const singles = await c.query(`
      UPDATE blacklist.master m SET plate_hash = sub.plate_hash
      FROM (
        SELECT l.master_id, MIN(r.plate_hash) AS plate_hash
        FROM blacklist.master_links l
        JOIN blacklist.source_records r ON r.id = l.source_record_id
        WHERE r.data_type = 'lpr' AND r.plate_hash IS NOT NULL
        GROUP BY l.master_id HAVING COUNT(DISTINCT r.plate_hash) = 1
      ) sub
      WHERE m.id = sub.master_id AND m.plate_hash IS DISTINCT FROM sub.plate_hash`);

    const after = await c.query(`
      SELECT COUNT(DISTINCT l.master_id) masters, COUNT(*) recs
      FROM blacklist.master_links l
      JOIN blacklist.source_records r ON r.id = l.source_record_id
      WHERE r.data_type = 'lpr'`);

    // no case may be lost — links must still cover every source_record
    const orphanRecs = await c.query(`
      SELECT COUNT(*) n FROM blacklist.source_records r
      WHERE r.data_type = 'lpr'
        AND NOT EXISTS (SELECT 1 FROM blacklist.master_links l WHERE l.source_record_id = r.id)`);
    const orphanMasters = await c.query(`
      SELECT COUNT(*) n FROM blacklist.master m
      WHERE NOT EXISTS (SELECT 1 FROM blacklist.master_links l WHERE l.master_id = m.id)`);

    console.log(`\nยุบ ${merged} กลุ่ม · ลบ master ที่ซ้ำ ${dropped} แถว · stamp plate_hash เพิ่ม ${singles.rowCount}`);
    console.log(`หลัง: source_records ${after.rows[0].recs} → master ${after.rows[0].masters}`);
    console.log(`ตรวจความสมบูรณ์: source_records ที่ไม่มี link = ${orphanRecs.rows[0].n} (ต้องเป็น 0) · master ที่ไม่มี link = ${orphanMasters.rows[0].n} (ต้องเป็น 0)`);

    if (Number(before.rows[0].recs) !== Number(after.rows[0].recs)) {
      throw new Error('source_records count changed — aborting, no case may be lost');
    }
    if (Number(orphanRecs.rows[0].n) !== 0) {
      throw new Error('some source_records lost their link — aborting');
    }

    if (APPLY) {
      await c.query('COMMIT');
      console.log('\n✅ COMMIT — เปลี่ยนแปลงจริงแล้ว');
    } else {
      await c.query('ROLLBACK');
      console.log('\n🔍 DRY RUN — ยังไม่เปลี่ยนอะไร (ใส่ --apply เพื่อทำจริง)');
    }
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('\n❌ ล้มเหลว ยกเลิกทั้งหมด:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
