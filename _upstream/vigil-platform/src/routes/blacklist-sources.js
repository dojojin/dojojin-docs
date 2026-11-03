// ============================================================
// Vigil Platform — Routes: Blacklist reservoir (sources + master data)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Spec: docs/superpowers/specs/2026-07-24-blacklist-central-database-design.md
//
// Two groups of routes:
//   /api/blacklist/sources/*  — connection instances (CRUD + test + import)
//   /api/blacklist/master*    — the reservoir, read side, feeding the two
//                                dashboard pages (Face / LPR blacklist DB)
//
// PII posture: national IDs are stored enc:v1: and are NEVER returned in list
// or detail responses — only a mask. Every write is admin-gated upstream by
// requireAdminForWrites('/api/blacklist') in api-server.js. Photos are served
// through an auth-gated route, never as static files.
//
// แยกไฟล์ 2026-09-07 — ไฟล์นี้ยังเป็นจุดเข้าเดียวที่ api-server.js require และเก็บ
// ฝั่งอ่านของอ่างเก็บข้อมูล (master / stats / ถังขยะ) ไว้เอง ส่วนที่เหลือเรียก
// factory ย่อย **ตรงตำแหน่งที่ route กลุ่มนั้นเคยลงทะเบียน** — ลำดับคือพฤติกรรม
'use strict';

const crypto = require('crypto');
const { decryptPii, maskId, checkThaiNationalId } = require('../helpers/blacklist-crypto');
const { visibleRecordSql, liveRecordSql } = require('../helpers/blacklistVisibility');
const registerSourcesAndImport = require('./blacklist-sources-import');
const registerBridgeAndManual = require('./blacklist-sources-bridge');
const { registerCorrections, registerRemovalAndPhotos } = require('./blacklist-sources-curation');

module.exports = function blacklistSourcesRoutes(app, pool) {

  // ต้องเป็นคำสั่งแรก — กลุ่มนี้ถือตัวล้าง last_import_status ค้างตอนบูต และ
  // ตัวตั้งเวลา auto-sync จึงต้องอยู่ที่จังหวะเดิมของลำดับการบูต
  registerSourcesAndImport(app, pool);

  // ---------- data-quality triage (face) ----------
  // Two distinct problems, deliberately NOT merged into one "problems" list —
  // they need different judgements from the operator:
  //
  //   dup_name    same name, DIFFERENT national ID. Either two people who share
  //               a name, or one person entered twice with a typo. Only a human
  //               comparing the photos can tell; the platform cannot compare
  //               faces (spec §6.2), so it must not guess.
  //   invalid_id  the national ID fails the ทะเบียนราษฎร์ check digit. This is the
  //               more damaging one: id_hash derives from this number, so the
  //               record can never dedup against a correctly-keyed source.
  async function faceQuality(dataType) {
    const { rows } = await pool.query(`
      SELECT r.id, r.external_id, r.name, r.case_ref, r.photo_path, r.id_number_enc,
             r.raw_json, s.label AS source_label, l.master_id
      FROM blacklist.source_records r
      JOIN blacklist.sources s ON s.id = r.source_id
      LEFT JOIN blacklist.master_links l ON l.source_record_id = r.id
      WHERE r.data_type = $1 AND ${liveRecordSql('r')}`, [dataType]);

    const shape = (r, extra) => ({
      id: r.id, master_id: r.master_id, external_id: r.external_id,
      name: r.name, org: r.case_ref, photo_path: r.photo_path,
      group_name: (r.raw_json || {}).group_name || null,
      source_label: r.source_label, ...extra,
    });

    // same name → group; only a real conflict when the IDs differ
    const byName = new Map();
    const invalid = [];
    for (const r of rows) {
      let plain = null;
      try { plain = r.id_number_enc ? decryptPii(r.id_number_enc) : null; } catch { plain = null; }
      const v = checkThaiNationalId(plain);
      if (r.id_number_enc && !v.ok) {
        invalid.push(shape(r, { id_masked: maskId(plain), reason: v.reason, length: v.length ?? null }));
      }
      if (r.name) {
        const k = r.name.trim();
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push(shape(r, { id_masked: plain ? maskId(plain) : null, id_valid: v.ok }));
      }
    }
    const dupNames = [...byName.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([name, records]) => ({ name, records }))
      .sort((a, b) => b.records.length - a.records.length || a.name.localeCompare(b.name));

    return { dup_names: dupNames, invalid_ids: invalid };
  }

  // ตัวช่วยตัวเดียวที่ข้ามไฟล์ — /api/blacklist/stats (ไฟล์นี้) กับ
  // /api/blacklist/quality (blacklist-sources-curation.js) ต้องใช้ตัวเดียวกัน
  //
  // ⚠️ ตำแหน่งของ faceQuality ข้างบนเป็นข้อบังคับ ไม่ใช่รสนิยม: test/blacklist-
  // stats-live-only.test.js อ่านไฟล์นี้เป็น "ข้อความ" และตัด handler ด้วย
  // `\n  app.` ตัวถัดไป ⇒ ช่วงของ GET /api/blacklist/removed ลากยาวถึงท้ายไฟล์
  // และเทสต์ข้อ 6 บังคับว่าช่วงนั้นต้องไม่มีคำว่า liveRecordSql. ย้าย faceQuality
  // ไปไว้ท้ายไฟล์รวมกับ helper ตัวอื่น = เทสต์แดงโดยไม่มีอะไรโยงให้เห็น
  const subDeps = { faceQuality };

  // ---------- reservoir: list ----------
  // data_type filters which page is asking: 'lpr' => ฐานข้อมูลป้ายทะเบียน,
  // 'face' => ฐานข้อมูลใบหน้า. A master qualifies if ANY linked source_record
  // is of that type, so an identity known to both systems shows on both pages.
  app.get('/api/blacklist/master', async (req, res) => {
    try {
      const dataType = req.query.data_type === 'face' ? 'face' : 'lpr';
      const q = (req.query.q || '').trim();
      const sourceId = req.query.source_id ? Number(req.query.source_id) : null;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const page = Math.max(Number(req.query.page) || 1, 1);
      const offset = (page - 1) * limit;

      // Excluded records must never reach the operator-facing list, and neither
      // must records whose type the owning source no longer imports — deselecting
      // LPR on a connection used to leave its rows listed and alerting.
      const where = ['r.data_type = $1', liveRecordSql('r')];
      const params = [dataType];
      if (sourceId) { params.push(sourceId); where.push(`r.source_id = $${params.length}`); }
      // Facets that reflect the only two real dimensions the face roster has:
      // watch group (High Risk / Blacklist HDY / none) and owning org.
      // '__none__' selects records the source left ungrouped — 105 of 957 live,
      // a data-quality signal worth being able to isolate, not hide.
      const groups = [].concat(req.query.group || []).filter(Boolean);
      if (groups.length) {
        const real = groups.filter(g => g !== '__none__');
        const wantNone = groups.includes('__none__');
        const parts = [];
        if (real.length) { params.push(real); parts.push(`r.raw_json->>'group_name' = ANY($${params.length})`); }
        if (wantNone) parts.push(`r.raw_json->>'group_name' IS NULL`);
        where.push(`(${parts.join(' OR ')})`);
      }
      // master_only: identities that genuinely merged across >1 source. This is
      // what "ฐานข้อมูลกลาง (Master)" means — not "everything", which would make
      // the pill meaningless since every row is already in master.
      if (String(req.query.master_only) === '1') {
        where.push(`(SELECT COUNT(*)
                     FROM blacklist.master_links l2
                     JOIN blacklist.source_records r2 ON r2.id = l2.source_record_id
                     WHERE l2.master_id = m.id) > 1`);
      }
      const orgs = [].concat(req.query.org || []).filter(Boolean);
      if (orgs.length) { params.push(orgs); where.push(`r.case_ref = ANY($${params.length})`); }
      if (q) {
        params.push(`%${q}%`);
        where.push(`(m.display_name ILIKE $${params.length} OR COALESCE(o.name, r.name) ILIKE $${params.length}
                     OR EXISTS (SELECT 1 FROM unnest(COALESCE(o.plate_numbers, r.plate_numbers)) p WHERE p ILIKE $${params.length}))`);
      }
      const whereSql = where.join(' AND ');

      const countQ = await pool.query(`
        SELECT COUNT(DISTINCT m.id) AS n FROM blacklist.master m
        JOIN blacklist.master_links l ON l.master_id = m.id
        JOIN blacklist.source_records r ON r.id = l.source_record_id
        LEFT JOIN blacklist.overrides o
          ON o.source_id = r.source_id AND o.external_id = r.external_id
        WHERE ${whereSql}`, params);

      params.push(limit, offset);
      // dup_count: how many records across the whole roster carry this row's
      // plate. Drives the "ซ้ำ" badge on the grid tile — computed per plate, not
      // per master, because two records with the same plate are two masters
      // (no auto-merge by design, spec §4.3).
      // name_freq: how many records in the whole roster share this row's name.
      // >1 means the "ชื่อซ้ำ แต่เลขบัตรไม่ตรง" tag applies (IDs are unique by
      // construction — a shared id_hash would have merged into one master).
      const { rows } = await pool.query(`
        WITH name_freq AS (
          SELECT rr.name AS nm, COUNT(*) AS n
          FROM blacklist.source_records rr
          WHERE rr.data_type = $1 AND rr.name IS NOT NULL
          GROUP BY rr.name
        ), plate_freq AS (
          SELECT pp AS plate, COUNT(*) AS n
          FROM blacklist.source_records rr, LATERAL unnest(rr.plate_numbers) pp
          WHERE rr.data_type = $1 GROUP BY pp
        )
        SELECT m.id, m.display_name, m.status, m.id_type, m.id_number_enc, m.created_at,
               -- รูปที่เราแก้ทับต้องชนะรูปต้นทาง แบบเดียวกับที่ blacklistBridge ใช้
               -- ตอนประกอบการ์ดแจ้งเตือน · เดิมอ่าน r.photo_path ตรง ๆ ⇒ อัปรูปแล้ว
               -- การ์ดกับหน้ารายละเอียดยังโชว์รูปเดิม (หรือไม่โชว์เลยถ้าต้นทางไม่มีรูป)
               MAX(COALESCE(NULLIF(o.photo_path,''), r.photo_path)) AS photo_path,
               COUNT(DISTINCT r.id) AS case_count,
               ARRAY_AGG(DISTINCT s.label) AS source_labels,
               COUNT(DISTINCT s.id)        AS source_count,
               ARRAY_AGG(DISTINCT s.source_type) AS source_types,
               ARRAY_AGG(DISTINCT COALESCE(s.site_code,'')) AS site_codes,
               ARRAY_AGG(DISTINCT p) FILTER (WHERE p IS NOT NULL) AS plates,
               -- ค่าที่เราแก้ทับต้องชนะค่าต้นทางในทุกทางอ่าน ไม่ใช่แค่ตอนส่งเข้า bridge
               -- (ตารางแมป override → คีย์ใน raw_json อยู่ใน db_migration_149)
               MAX(COALESCE(NULLIF(o.plate_type,''),    r.raw_json->>'platetype')) AS platetype,
               MAX(COALESCE(NULLIF(o.vehicle_type,''),  r.raw_json->>'cartype'))   AS cartype,
               MAX(COALESCE(NULLIF(o.vehicle_color,''), r.raw_json->>'carcolor'))  AS carcolor,
               MAX(COALESCE(NULLIF(o.brand,''),         r.raw_json->>'carbrand'))  AS carbrand,
               MAX(r.raw_json->>'group_name') AS group_name,
               -- case_ref is the REPORTING UNIT (สภ.นราธิวาส / หน่วยเฝ้าตรวจ_B01),
               -- never a province. It was aliased as province here, so DSS Pro
               -- rows printed a police unit onto the mock plate's province slot.
               -- Province only ever comes from the source payload, and only
               -- GuruSquare supplies one — DSS Pro sends no province at all.
               MAX(r.case_ref)                 AS org,
               MAX(COALESCE(NULLIF(o.province,''), r.raw_json->>'province')) AS province,
               MAX(COALESCE(o.name, r.name)) AS reported_by,
               BOOL_OR(o.name IS NOT NULL OR o.plate_numbers IS NOT NULL OR o.case_note IS NOT NULL) AS edited,
               COALESCE(MAX(pf.n), 1)        AS dup_count,
               COALESCE(MAX(nf.n), 1)        AS name_count,
               -- BS1 marks a source record when the source stops sending it. The
               -- tile is per IDENTITY, and an identity can be carried by several
               -- records: BOOL_AND, not BOOL_OR — one source dropping a plate that
               -- another source still sends is not "removed at source", and the
               -- bridge still watches it. Only when every record is gone is the
               -- badge true, which is exactly when the plate leaves lpr_watchlist.
               BOOL_AND(r.vanished_at IS NOT NULL) AS vanished,
               MAX(r.vanished_at)            AS vanished_at,
               MAX(r.id_number_enc)          AS _id_enc
        FROM blacklist.master m
        JOIN blacklist.master_links l ON l.master_id = m.id
        JOIN blacklist.source_records r ON r.id = l.source_record_id
        JOIN blacklist.sources s ON s.id = r.source_id
        LEFT JOIN blacklist.overrides o
          ON o.source_id = r.source_id AND o.external_id = r.external_id
        LEFT JOIN LATERAL unnest(COALESCE(o.plate_numbers, r.plate_numbers)) p ON TRUE
        LEFT JOIN plate_freq pf ON pf.plate = p
        LEFT JOIN name_freq nf ON nf.nm = r.name
        WHERE ${whereSql}
        GROUP BY m.id
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

      res.json({
        total: Number(countQ.rows[0].n),
        page, limit,
        rows: rows.map(r => ({
          id: r.id,
          display_name: r.display_name,
          status: r.status,
          id_type: r.id_type,
          id_masked: r.id_number_enc ? maskId(safeDecrypt(r.id_number_enc)) : null,
          photo_path: r.photo_path,
          case_count: Number(r.case_count),
          source_labels: r.source_labels || [],
          source_count: Number(r.source_count),
          source_types: r.source_types || [],
          site_codes: (r.site_codes || []).filter(Boolean),
          plates: r.plates || [],
          platetype: r.platetype, cartype: r.cartype, carcolor: r.carcolor,
          carbrand: r.carbrand, reported_by: r.reported_by,
          // two distinct things that shared one field until 2026-07-26:
          // province = where the vehicle is registered (source payload, Guru only)
          // org      = the unit that reported the case (case_ref, both sources)
          province: r.province, org: r.org,
          group_name: r.group_name,
          edited: !!r.edited,
          vanished: !!r.vanished,
          vanished_at: r.vanished_at,
          dup_name: Number(r.name_count) > 1,
          invalid_id: (() => { if (!r._id_enc) return false;
            try { return !checkThaiNationalId(decryptPii(r._id_enc)).ok; } catch { return false; } })(),
          dup_count: Number(r.dup_count),
          created_at: r.created_at,
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- reservoir: one identity with all its source records ----------
  app.get('/api/blacklist/master/:id', async (req, res) => {
    try {
      const m = await pool.query('SELECT * FROM blacklist.master WHERE id = $1', [req.params.id]);
      if (!m.rows[0]) return res.status(404).json({ error: 'not found' });
      const recs = await pool.query(`
        SELECT r.*, s.label AS source_label, s.source_type, s.site_code,
               COALESCE(o.name, r.name)                   AS res_name,
               COALESCE(o.plate_numbers, r.plate_numbers) AS res_plates,
               COALESCE(o.case_note, r.case_note)         AS res_note,
               COALESCE(NULLIF(o.photo_path,''), r.photo_path) AS res_photo,
               o.brand AS o_brand, o.vehicle_type AS o_vtype, o.vehicle_color AS o_vcolor,
               o.plate_type AS o_ptype, o.case_kind AS o_ckind, o.province AS o_province,
               (o.name IS NOT NULL OR o.plate_numbers IS NOT NULL OR o.case_note IS NOT NULL) AS edited,
               ch.n AS change_count, ch.last_detected, ch.last_source_time
        FROM blacklist.master_links l
        JOIN blacklist.source_records r ON r.id = l.source_record_id
        JOIN blacklist.sources s ON s.id = r.source_id
        LEFT JOIN blacklist.overrides o
          ON o.source_id = r.source_id AND o.external_id = r.external_id
        -- CH1 — สรุปประวัติการแก้จากต้นทาง · LATERAL เพื่อไม่ให้ GROUP BY ทั้งคิวรี
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS n, max(detected_at) AS last_detected,
                 max(source_time) AS last_source_time
            FROM blacklist.record_changes c
           WHERE c.source_id = r.source_id AND c.external_id = r.external_id
        ) ch ON TRUE
        WHERE l.master_id = $1 ORDER BY r.imported_at`, [req.params.id]);
      const row = m.rows[0];
      res.json({
        id: row.id,
        display_name: row.display_name,
        status: row.status,
        id_type: row.id_type,
        id_country: row.id_country,
        id_masked: row.id_number_enc ? maskId(safeDecrypt(row.id_number_enc)) : null,
        photo_path: row.photo_path,
        created_at: row.created_at,
        records: recs.rows.map(r => ({
          id: r.id, source_label: r.source_label, source_type: r.source_type, site_code: r.site_code,
          data_type: r.data_type, external_id: r.external_id,
          name: r.res_name, case_ref: r.case_ref, case_note: r.res_note,
          plate_numbers: r.res_plates || [], photo_path: r.res_photo,
          edited: !!r.edited,
          // BS1 — this record is one the source has stopped sending. Surfaced per
          // record (not just per identity) because the detail view is where an
          // operator asks "why did this stop alerting"; the answer is per source.
          vanished_at: r.vanished_at, vanish_reason: r.vanish_reason,
          // CH1 — "ต้นทางแก้มาแล้วกี่ครั้ง / ครั้งล่าสุดเมื่อไหร่"
          // last_source_time = เวลาที่ต้นทางบอก · last_detected = เวลาที่เราเห็น
          change_count: Number(r.change_count) || 0,
          last_change_at: r.last_detected || null,
          last_source_change_at: r.last_source_time || null,
          id_masked: r.id_number_enc ? maskId(safeDecrypt(r.id_number_enc)) : null,
          // raw_json = payload ดิบของต้นทาง เก็บไว้เหมือนเดิมเพื่อไม่ให้ใครเข้าใจผิดว่า
          // ต้นทางส่งอะไรมา · `eff` = ค่าที่ควรเอาไปแสดงผล (override ชนะต้นทาง)
          // หน้าจอต้องอ่าน eff ไม่ใช่ raw_json ไม่งั้นสิ่งที่ผู้ใช้เพิ่งพิมพ์แก้จะไม่โผล่
          raw_json: r.raw_json,
          eff: _blEffective(r),
          imported_at: r.imported_at,
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- reservoir: KPI counts for the page header ----------
  app.get('/api/blacklist/stats', async (req, res) => {
    try {
      const dataType = req.query.data_type === 'face' ? 'face' : 'lpr';
      const { rows } = await pool.query(`
        SELECT COUNT(DISTINCT m.id) AS identities,
               COUNT(DISTINCT r.id) AS records,
               COUNT(DISTINCT p) FILTER (WHERE p IS NOT NULL) AS plates
        FROM blacklist.master m
        JOIN blacklist.master_links l ON l.master_id = m.id
        JOIN blacklist.source_records r ON r.id = l.source_record_id
        -- s ไม่ได้ถูก SELECT แล้ว (SOURCES ย้ายไปนับจาก blacklist.sources ตรง ๆ
        -- ข้างล่าง) แต่คง INNER JOIN ไว้เพราะมันทำหน้าที่กรองด้วย: record ที่ชี้ไป
        -- หา source ที่ไม่มีอยู่จริงจะไม่ถูกนับ เอาออกแล้วตัวเลขอาจขยับโดยไม่ตั้งใจ
        JOIN blacklist.sources s ON s.id = r.source_id
        LEFT JOIN LATERAL unnest(r.plate_numbers) p ON TRUE
        WHERE r.data_type = $1 AND ${liveRecordSql('r')}`, [dataType]);
      // SOURCES = "แหล่งที่ตั้งค่าไว้สำหรับชนิดนี้" ไม่ใช่ "แหล่งที่บังเอิญยังมี record เหลือ"
      // ถามจาก blacklist.sources ตรง ๆ แยกจากคิวรีข้างบน เพราะถ้านับจาก record ที่
      // join มา แหล่งที่ของถูกโยนถังหมดจะหายไปจาก badge ทั้งที่ยังมี pill ของตัวเอง
      // อยู่บนหน้าจอ — เลขกับสิ่งที่ตาเห็นจะขัดกันเอง
      // ใช้ data_types อย่างเดียวไม่รวม kept_types ให้ตรงกับเงื่อนไขที่หน้าจอใช้
      // เลือกว่าจะโชว์ pill ไหน (page-blacklist.js: s.data_types.includes(dataType))
      const srcCount = await pool.query(
        `SELECT COUNT(*) AS n FROM blacklist.sources WHERE $1 = ANY(data_types)`, [dataType]);
      const bySource = await pool.query(`
        SELECT s.label, COUNT(DISTINCT r.id) AS n
        FROM blacklist.source_records r JOIN blacklist.sources s ON s.id = r.source_id
        WHERE r.data_type = $1 AND ${liveRecordSql('r')}
        GROUP BY s.label ORDER BY n DESC`, [dataType]);
      // Plates carried by more than one record — surfaced as a clickable KPI so
      // an operator can triage them (see /api/blacklist/duplicates).
      // Same normalized key /duplicates groups on, and the same one master
      // merges on. Counting raw strings here made the KPI say 255 while the
      // page it opens listed 283 — two numbers for one thing, on one screen.
      // Excluded records are left out: the KPI must count work still to do.
      const dup = await pool.query(`
        SELECT COUNT(*) AS n FROM (
          SELECT UPPER(REGEXP_REPLACE(p, '[^0-9A-Za-zก-๙]', '', 'g'))
            FROM blacklist.source_records r
            CROSS JOIN LATERAL unnest(r.plate_numbers) p
           WHERE r.data_type = $1 AND ${liveRecordSql('r')}
           GROUP BY 1 HAVING COUNT(DISTINCT r.id) > 1
        ) d`, [dataType]);
      // Facet breakdowns — these back the clickable KPI row and the filter
      // pickers, so the UI never has to hardcode a value the data might not have.
      const byGroup = await pool.query(`
        SELECT COALESCE(r.raw_json->>'group_name', '__none__') AS k, COUNT(DISTINCT r.id) AS n
        FROM blacklist.source_records r
        WHERE r.data_type = $1 AND ${liveRecordSql('r')} GROUP BY 1 ORDER BY n DESC`, [dataType]);
      const byOrg = await pool.query(`
        SELECT COALESCE(r.case_ref, '__none__') AS k, COUNT(DISTINCT r.id) AS n
        FROM blacklist.source_records r
        WHERE r.data_type = $1 AND ${liveRecordSql('r')} GROUP BY 1 ORDER BY n DESC`, [dataType]);
      // Quality counters back the two triage badges. Only computed for face —
      // the LPR roster carries no national ID to validate.
      let quality = { dup_name_groups: 0, dup_name_records: 0, invalid_id_count: 0 };
      if (dataType === 'face') {
        const q = await faceQuality('face');
        quality = {
          dup_name_groups: q.dup_names.length,
          dup_name_records: q.dup_names.reduce((s, g) => s + g.records.length, 0),
          invalid_id_count: q.invalid_ids.length,
        };
      }
      // Counts behind the source pills: total, merged-across-sources, per source.
      const perSource = await pool.query(`
        SELECT s.id, COUNT(DISTINCT m.id) AS n
        FROM blacklist.master m
        JOIN blacklist.master_links l ON l.master_id = m.id
        JOIN blacklist.source_records r ON r.id = l.source_record_id
        JOIN blacklist.sources s ON s.id = r.source_id
        WHERE r.data_type = $1 AND ${liveRecordSql('r')} GROUP BY s.id`, [dataType]);
      const mergedQ = await pool.query(`
        SELECT COUNT(*) n FROM (
          SELECT l.master_id
          FROM blacklist.master_links l
          JOIN blacklist.source_records r ON r.id = l.source_record_id
          WHERE r.data_type = $1 AND ${liveRecordSql('r')}
          GROUP BY l.master_id HAVING COUNT(DISTINCT r.id) > 1) t`, [dataType]);

      res.json({
        pill_all: Number(rows[0].identities),
        pill_master: Number(mergedQ.rows[0].n),
        pill_by_source: perSource.rows.reduce((a, r) => (a[r.id] = Number(r.n), a), {}),
        identities: Number(rows[0].identities), records: Number(rows[0].records),
        sources: Number(srcCount.rows[0].n), plates: Number(rows[0].plates),
        dup_plates: Number(dup.rows[0].n),
        ...quality,
        by_source: bySource.rows.map(r => ({ label: r.label, n: Number(r.n) })),
        by_group: byGroup.rows.map(r => ({ key: r.k, n: Number(r.n) })),
        by_org: byOrg.rows.map(r => ({ key: r.k, n: Number(r.n) })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  registerBridgeAndManual(app, pool);

  registerCorrections(app, pool, subDeps);

  // ---------- the bin: everything currently excluded ----------
  // Removal used to be visible only from the duplicate page's "show removed"
  // toggle — which meant a record removed from the detail modal (not a
  // duplicate) could not be found in the UI at all, only in audit_log. In a
  // wanted-person database, "deleted and unfindable" is how a wrong removal
  // goes unnoticed. This lists every exclusion regardless of where it came
  // from, with who did it and when.
  app.get('/api/blacklist/removed', async (req, res) => {
    try {
      const dataType = req.query.data_type === 'face' ? 'face'
                     : req.query.data_type === 'lpr'  ? 'lpr' : null;
      const limit  = Math.min(200, Math.max(5, parseInt(req.query.limit, 10) || 50));
      const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
      const q      = String(req.query.q || '').trim();
      const by     = String(req.query.by || '').trim();

      const where = ['o.excluded'];
      const args = [];
      if (dataType) { args.push(dataType); where.push(`r.data_type = $${args.length}`); }
      if (by)       { args.push(by);       where.push(`o.updated_by = $${args.length}`); }
      if (q) {
        args.push(`%${q}%`);
        where.push(`(r.name ILIKE $${args.length}
                     OR array_to_string(r.plate_numbers, ',') ILIKE $${args.length}
                     OR o.exclude_reason ILIKE $${args.length})`);
      }
      const whereSql = where.join(' AND ');
      const base = `FROM blacklist.overrides o
                    JOIN blacklist.source_records r
                      ON r.source_id = o.source_id AND r.external_id = o.external_id
                    JOIN blacklist.sources s ON s.id = r.source_id
                   WHERE ${whereSql}`;

      const cnt = await pool.query(`SELECT COUNT(*)::int AS n ${base}`, args);
      const { rows } = await pool.query(`
        SELECT r.id, r.external_id, r.data_type, r.name, r.plate_numbers, r.case_ref,
               r.photo_path, r.raw_json, s.label AS source_label,
               o.exclude_reason, o.updated_by, o.updated_at
        ${base}
        ORDER BY o.updated_at DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, limit, (page - 1) * limit]);

      // Who has removed things — drives the "removed by" filter without the UI
      // having to know the user list.
      const actors = await pool.query(`
        SELECT o.updated_by AS k, COUNT(*)::int AS n
          FROM blacklist.overrides o
          JOIN blacklist.source_records r
            ON r.source_id = o.source_id AND r.external_id = o.external_id
         WHERE o.excluded ${dataType ? 'AND r.data_type = $1' : ''}
         GROUP BY 1 ORDER BY 2 DESC`, dataType ? [dataType] : []);

      const kinds = await pool.query(`
        SELECT r.data_type AS k, COUNT(*)::int AS n
          FROM blacklist.overrides o
          JOIN blacklist.source_records r
            ON r.source_id = o.source_id AND r.external_id = o.external_id
         WHERE o.excluded GROUP BY 1`);

      const total = cnt.rows[0].n;
      res.json({
        total, page, limit, pages: Math.max(1, Math.ceil(total / limit)),
        actors: actors.rows, kinds: kinds.rows,
        rows: rows.map(r => ({
          id: r.id, external_id: r.external_id, data_type: r.data_type,
          name: r.name, plate: (r.plate_numbers || [])[0] || null,
          case_ref: r.case_ref, photo_path: r.photo_path,
          raw_json: r.raw_json, source_label: r.source_label,
          exclude_reason: r.exclude_reason,
          removed_by: r.updated_by, removed_at: r.updated_at,
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  registerRemovalAndPhotos(app, pool);

  // raw_json ของต้นทาง + ค่าที่เราแก้ทับ = สิ่งที่ควรเห็นบนหน้าจอ
  // คีย์ปลายทางต้องเป็นชื่อเดียวกับที่ต้นทางใช้ (carbrand/cartype/…) เพื่อให้ตัว
  // render ตัวเดียวกันใช้ได้ ไม่ต้องแยกกรณี "ระเบียนที่ถูกแก้" (db_migration_149)
  function _blEffective(r) {
    const eff = { ...(r.raw_json || {}) };
    const put = (k, v) => { if (v != null && v !== '') eff[k] = v; };
    put('carbrand', r.o_brand);
    put('cartype', r.o_vtype);
    put('carcolor', r.o_vcolor);
    put('platetype', r.o_ptype);
    put('owner_detail', r.o_ckind);
    put('province', r.o_province);
    return eff;
  }

  function safeDecrypt(v) {
    try { return decryptPii(v); } catch { return ''; }
  }
};
