// ============================================================
// Vigil Platform — Backfill appearances (one-off, migration 031)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================
// PURPOSE: กู้ appearance records ของ events ที่มาก่อน migration 031
//          (extractAppearance() เคย INSERT ล้มเหลวเงียบ — ดู BOSCH_IVA_Appearance.MD §2.3)
//
// SAFETY:  idempotent — INSERT...WHERE NOT EXISTS กัน duplicate
//          run ซ้ำได้ไม่มีผลข้างเคียง
//
// RUN:     node db/backfill_appearances_031.js
//          (ต้องตั้ง env DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD ก่อน)
// ============================================================

const path = require('path');
require(path.join(__dirname, '..', 'src', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', 'src', '.env') });
const { Pool } = require(path.join(__dirname, '..', 'src', 'node_modules', 'pg'));

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on('connect', async (c) => {
  try { await c.query("SET TIME ZONE 'UTC'"); } catch (_) {}
});

const colorStr = (c) => {
  const cc = c?.ColorCluster?.Color;
  return cc ? `${cc['@X']},${cc['@Y']},${cc['@Z']}` : null;
};

async function backfill() {
  const { rows } = await pool.query(`
    SELECT e.id, e.camera_id, e.object_id, e.snapshot_filename, e.raw_json
    FROM events e
    WHERE (e.raw_json::text ILIKE '%HumanBody%' OR e.raw_json::text ILIKE '%HumanFace%')
      AND NOT EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = e.id)
    ORDER BY e.id
  `);

  console.log(`Found ${rows.length} events to backfill`);
  if (rows.length === 0) { await pool.end(); return; }

  let ok = 0, skip = 0, fail = 0;

  for (const row of rows) {
    const obj        = row.raw_json?.Data?.Object?.Object;
    const appearance = obj?.Appearance;
    if (!appearance) { skip++; continue; }

    const objectId  = row.object_id ?? obj?.['@ObjectId'] ?? null;
    const face      = appearance.HumanFace  || {};
    const body      = appearance.HumanBody  || {};
    const clothing  = body.Clothing         || {};
    const objectClass = appearance.Class?.Type?.['#text'] || null;
    const confidence  = appearance.Class?.Type?.['@Likelihood'] != null
      ? parseFloat(appearance.Class.Type['@Likelihood']) : null;

    try {
      await pool.query(
        `INSERT INTO appearances
         (event_id, camera_id, object_id, object_class, confidence,
          gender, hair_length, hair_color_xyz,
          top_category, top_color_xyz, bottom_category, bottom_color_xyz,
          glasses, bag_category, helmet_wear, helmet_subtype, vest_style)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
         WHERE NOT EXISTS (SELECT 1 FROM appearances WHERE event_id = $1)`,
        [row.id, row.camera_id, objectId, objectClass, confidence,
         face.Gender||null, face.Hair?.Length||null, colorStr(face.Hair?.Color),
         clothing.Tops?.Category||null,    colorStr(clothing.Tops?.Color),
         clothing.Bottoms?.Category||null, colorStr(clothing.Bottoms?.Color),
         face.Accessory?.Opticals?.Wear==='true', body.Belonging?.Bag?.Category||null,
         face.Accessory?.Helmet?.Wear==='true',   face.Accessory?.Helmet?.Subtype||null,
         clothing.Tops?.Style||null]
      );
      ok++;
    } catch (e) {
      console.error(`  FAIL event ${row.id}: ${e.message}`);
      fail++;
    }
  }

  console.log(`Done — inserted: ${ok}, skipped (no Appearance): ${skip}, failed: ${fail}`);
  await pool.end();
}

backfill().catch(e => { console.error(e); process.exit(1); });
