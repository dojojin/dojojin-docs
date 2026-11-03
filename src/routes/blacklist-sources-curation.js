// ============================================================
// Vigil Platform — Routes: Blacklist curation (settings · overrides · triage · photos)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แยกออกจาก routes/blacklist-sources.js — route ทั้งหมดในไฟล์นี้ยังลงทะเบียนที่
// ตำแหน่งเดิมเป๊ะ (ลำดับการลงทะเบียนคือพฤติกรรม) จึงต้อง export สองตัว เพราะ
// กลุ่มนี้ถูกคั่นกลางด้วย GET /api/blacklist/removed (ฝั่งอ่านของอ่างเก็บข้อมูล
// ซึ่งอยู่ในไฟล์แม่) ในไฟล์เดิม
'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { decryptPii, maskId, checkThaiNationalId } = require('../helpers/blacklist-crypto');
const { PHOTO_DIR, savePhoto } = require('../helpers/blacklistImport');
const { assertImageBuffer } = require('../helpers/imageMagic');
const bridge = require('../helpers/blacklistBridge');

// กลุ่มที่ 1 — settings / reveal-id / override ของระเบียน / คุณภาพข้อมูล / ทะเบียนซ้ำ
// (faceQuality อยู่ในไฟล์แม่ เพราะ /api/blacklist/stats ใช้ตัวเดียวกัน)
function registerCorrections(app, pool, { faceQuality }) {

  // ---------- page settings ----------
  // Privacy defaults live server-side, not in localStorage: they are an
  // organisational policy ("faces stay blurred until an operator asks"), so they
  // must apply to every browser and every user, not just the one that set them.
  const BL_SETTING_DEFAULTS = {
    bl_face_blur_default: 'true',   // blur head-shots until explicitly revealed
    bl_id_mask_default:   'true',   // keep national IDs masked until revealed
    bl_face_page_size:    '50',
    bl_lpr_page_size:     '50',
    bl_dup_page_size:     '25',   // duplicate-triage page: groups per page
  };

  app.get('/api/blacklist/settings', async (req, res) => {
    try {
      const keys = Object.keys(BL_SETTING_DEFAULTS);
      const { rows } = await pool.query(
        'SELECT key, value FROM system_settings WHERE key = ANY($1)', [keys]);
      const out = { ...BL_SETTING_DEFAULTS };
      for (const r of rows) out[r.key] = r.value;
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/blacklist/settings', async (req, res) => {
    try {
      const body = req.body || {};
      for (const k of Object.keys(BL_SETTING_DEFAULTS)) {
        if (!(k in body)) continue;
        const v = String(body[k]);
        await pool.query(`
          INSERT INTO system_settings (key, value, updated_at) VALUES ($1,$2,NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [k, v]);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- reveal a full national ID (audited) ----------
  // Spec §4.2: masking is a display default, not a permission boundary — an
  // authorised operator can see the real number. Because that IS the sensitive
  // moment, it is a separate admin-only call that always writes an audit row
  // naming who revealed whose record.
  app.post('/api/blacklist/master/:id/reveal-id', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT r.id_number_enc, r.name FROM blacklist.master_links l
        JOIN blacklist.source_records r ON r.id = l.source_record_id
        WHERE l.master_id = $1 AND r.id_number_enc IS NOT NULL LIMIT 1`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'no id on this record' });

      let plain;
      try { plain = decryptPii(rows[0].id_number_enc); }
      catch { return res.status(500).json({ error: 'decrypt failed' }); }

      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'blacklist_id_reveal',
         JSON.stringify({ master_id: req.params.id, name: rows[0].name, ip: req.ip })]
      ).catch(() => { /* never block the reveal on an audit write failure */ });

      res.json({ id_number: plain });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- local corrections (overrides) ----------
  // We have no authority to edit DSS Pro / GuruSquare, so corrections live here
  // instead. source_records stays a faithful mirror — editing it in place would
  // be wiped by the next import — and master is computed from mirror+override.
  //
  // EVERY write here is audited with before/after, including admin writes. On a
  // wanted-persons roster "an admin did it" is exactly the case you most need a
  // record of, not an exemption from one.
  async function auditOverride(req, action, srec, before, after) {
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
      [req.user?.id || null, req.user?.username || 'unknown', action,
       JSON.stringify({
         source_id: srec.source_id, external_id: srec.external_id,
         source_record_id: srec.id, data_type: srec.data_type,
         subject: srec.name, plate: (srec.plate_numbers || [])[0] || null,
         before, after, ip: req.ip,
       })]
    ).catch(() => { /* never block the correction on an audit write failure */ });
  }

  // Re-link (or unlink) one record after its exclusion state changed, so master
  // reflects the decision immediately instead of waiting for the next import.
  async function relinkRecord(srecId) {
    const { rows } = await pool.query(`
      SELECT r.*, COALESCE(o.excluded, FALSE) AS excluded
      FROM blacklist.source_records r
      LEFT JOIN blacklist.overrides o
        ON o.source_id = r.source_id AND o.external_id = r.external_id
      WHERE r.id = $1`, [srecId]);
    const r = rows[0];
    if (!r) return;

    if (r.excluded) {
      await pool.query('DELETE FROM blacklist.master_links WHERE source_record_id = $1', [srecId]);
    } else {
      const has = await pool.query('SELECT 1 FROM blacklist.master_links WHERE source_record_id = $1', [srecId]);
      if (!has.rows[0]) {
        // same key precedence the importer uses: person ID beats plate
        let mid = null;
        if (r.id_hash) {
          const h = await pool.query('SELECT id FROM blacklist.master WHERE id_hash = $1', [r.id_hash]);
          if (h.rows[0]) mid = h.rows[0].id;
        }
        if (!mid && r.plate_hash) {
          const h = await pool.query('SELECT id FROM blacklist.master WHERE plate_hash = $1', [r.plate_hash]);
          if (h.rows[0]) mid = h.rows[0].id;
        }
        if (!mid) {
          const ins = await pool.query(
            `INSERT INTO blacklist.master (id_hash, plate_hash, id_type, id_country, id_number_enc, display_name, photo_path)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [r.id_hash, r.plate_hash, r.id_type, r.id_country, r.id_number_enc, r.name, r.photo_path]);
          mid = ins.rows[0].id;
        }
        await pool.query(
          `INSERT INTO blacklist.master_links (master_id, source_record_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`, [mid, srecId]);
      }
    }
    // sweep masters nothing points at any more
    await pool.query(`DELETE FROM blacklist.master m
      WHERE NOT EXISTS (SELECT 1 FROM blacklist.master_links l WHERE l.master_id = m.id)`);
  }

  // What the source says vs what we corrected — the edit UI shows both.
  app.get('/api/blacklist/record/:id', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT r.*, s.label AS source_label, s.source_type,
               o.name AS o_name, o.plate_numbers AS o_plate_numbers, o.case_note AS o_case_note,
               COALESCE(o.excluded,FALSE) AS excluded, o.exclude_reason, o.note AS o_note,
               o.updated_by AS o_by, o.updated_at AS o_at,
               o.brand AS o_brand, o.vehicle_type AS o_vehicle_type, o.vehicle_color AS o_vehicle_color,
               o.plate_type AS o_plate_type, o.case_kind AS o_case_kind, o.province AS o_province,
               o.photo_path AS o_photo_path
        FROM blacklist.source_records r
        JOIN blacklist.sources s ON s.id = r.source_id
        LEFT JOIN blacklist.overrides o
          ON o.source_id = r.source_id AND o.external_id = r.external_id
        WHERE r.id = $1`, [req.params.id]);
      const r = rows[0];
      if (!r) return res.status(404).json({ error: 'not found' });
      res.json({
        id: r.id, source_id: r.source_id, external_id: r.external_id,
        source_label: r.source_label, data_type: r.data_type,
        // BS1 — the edit form should say so before an operator spends time
        // correcting a record the source has already dropped.
        vanished_at: r.vanished_at, vanish_reason: r.vanish_reason,
        source: {
          name: r.name, plate_numbers: r.plate_numbers || [], case_note: r.case_note,
          brand: r.raw_json?.carbrand || null,
          vehicle_type: r.raw_json?.cartype || null,
          vehicle_color: r.raw_json?.carcolor || null,
          plate_type: r.raw_json?.platetype || null,
          case_kind: r.raw_json?.owner_detail || null,
          province: r.raw_json?.province || null,
          photo_path: r.photo_path || null,
        },
        override: {
          name: r.o_name, plate_numbers: r.o_plate_numbers, case_note: r.o_case_note,
          excluded: r.excluded, exclude_reason: r.exclude_reason, note: r.o_note,
          updated_by: r.o_by, updated_at: r.o_at,
          brand: r.o_brand, vehicle_type: r.o_vehicle_type, vehicle_color: r.o_vehicle_color,
          plate_type: r.o_plate_type, case_kind: r.o_case_kind, province: r.o_province,
          photo_path: r.o_photo_path,
        },
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // CH2/CH3 — ประวัติที่ต้นทางแก้ระเบียนนี้ + ธงว่าช่องไหนชนกับ override ของเรา
  //
  // CH3 คือเหตุผลที่ประวัตินี้คุ้มค่ากว่าการเป็น audit log เฉย ๆ: `pick()` ทำให้ค่า
  // ที่เราแก้ทับชนะตลอดกาล ⇒ ถ้าต้นทางแก้ช่องเดียวกัน**ทีหลัง** ค่าใหม่ของเขาจะ
  // ไม่มีวันโผล่ให้ใครเห็น · เทียบ detected_at กับ overrides.updated_at คือวิธีเดียว
  // ที่รู้ว่า "เขาเปลี่ยนใจหลังจากที่เราแก้ไปแล้ว"
  const OVERRIDE_FIELD_OF = {
    name: 'name', case_note: 'case_note', plate_numbers: 'plate_numbers',
    carbrand: 'brand', cartype: 'vehicle_type', carcolor: 'vehicle_color',
    platetype: 'plate_type', owner_detail: 'case_kind', province: 'province',
  };
  app.get('/api/blacklist/record/:id/changes', async (req, res) => {
    try {
      const { rows: recs } = await pool.query(
        `SELECT source_id, external_id FROM blacklist.source_records WHERE id = $1`, [req.params.id]);
      if (!recs[0]) return res.status(404).json({ error: 'not found' });
      const { source_id, external_id } = recs[0];

      const { rows: ovr } = await pool.query(
        `SELECT * FROM blacklist.overrides WHERE source_id = $1 AND external_id = $2`,
        [source_id, external_id]);
      const o = ovr[0] || null;

      const { rows } = await pool.query(
        `SELECT field, old_value, new_value, source_time, detected_at
           FROM blacklist.record_changes
          WHERE source_id = $1 AND external_id = $2
          ORDER BY detected_at DESC, id DESC
          LIMIT 200`, [source_id, external_id]);

      const conflicts = [];
      const changes = rows.map(c => {
        const ovField = OVERRIDE_FIELD_OF[c.field];
        // ชนก็ต่อเมื่อ (ก) เรามี override ของช่องนั้นจริง และ
        // (ข) ต้นทางแก้ **หลัง** เวลาที่เราแก้ทับ — แก้ก่อนหน้าเราคือของที่เราเห็นแล้ว
        const stale = !!(ovField && o && o[ovField] != null && o.updated_at
          && new Date(c.detected_at) > new Date(o.updated_at));
        if (stale && !conflicts.includes(c.field)) conflicts.push(c.field);
        return { ...c, override_field: ovField || null, overridden: stale };
      });

      res.json({ record_id: Number(req.params.id), total: changes.length, changes, conflicts });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/blacklist/record/:id/override', async (req, res) => {
    try {
      const cur = await pool.query(`
        SELECT r.*, o.name AS o_name, o.plate_numbers AS o_plate_numbers,
               o.case_note AS o_case_note, COALESCE(o.excluded,FALSE) AS excluded,
               o.brand AS o_brand, o.vehicle_type AS o_vehicle_type, o.vehicle_color AS o_vehicle_color, o.plate_type AS o_plate_type, o.case_kind AS o_case_kind, o.province AS o_province, o.photo_path AS o_photo_path
        FROM blacklist.source_records r
        LEFT JOIN blacklist.overrides o
          ON o.source_id = r.source_id AND o.external_id = r.external_id
        WHERE r.id = $1`, [req.params.id]);
      const r = cur.rows[0];
      if (!r) return res.status(404).json({ error: 'not found' });

      const b = req.body || {};
      // A field sent as null CLEARS the override (back to the source value);
      // omitting it leaves the existing override alone.
      const pick = (k, oldVal) => (k in b) ? (b[k] === '' ? null : b[k]) : oldVal;
      const next = {
        name: pick('name', r.o_name),
        plate_numbers: pick('plate_numbers', r.o_plate_numbers),
        case_note: pick('case_note', r.o_case_note),
        excluded: ('excluded' in b) ? !!b.excluded : r.excluded,
        exclude_reason: ('exclude_reason' in b) ? b.exclude_reason : undefined,
        note: b.note,
        // migration 149 — ช่องที่เหลือของโรสเตอร์ · กติกาเดียวกับด้านบน:
        // ส่งค่าว่างมา = ล้าง override กลับไปใช้ค่าต้นทาง · ไม่ส่งมา = ไม่แตะ
        brand: pick('brand', r.o_brand),
        vehicle_type: pick('vehicle_type', r.o_vehicle_type),
        vehicle_color: pick('vehicle_color', r.o_vehicle_color),
        plate_type: pick('plate_type', r.o_plate_type),
        case_kind: pick('case_kind', r.o_case_kind),
        province: pick('province', r.o_province),
        photo_path: pick('photo_path', r.o_photo_path),
      };
      const before = { name: r.o_name, plate_numbers: r.o_plate_numbers, case_note: r.o_case_note, excluded: r.excluded };

      await pool.query(`
        INSERT INTO blacklist.overrides
          (source_id, external_id, name, plate_numbers, case_note, excluded, exclude_reason, note, updated_by, brand, vehicle_type, vehicle_color, plate_type, case_kind, province, photo_path, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, $11, $12, $13, $14, $15, $16,NOW())
        ON CONFLICT (source_id, external_id) DO UPDATE SET
          name = EXCLUDED.name, plate_numbers = EXCLUDED.plate_numbers,
          brand = EXCLUDED.brand, vehicle_type = EXCLUDED.vehicle_type, vehicle_color = EXCLUDED.vehicle_color, plate_type = EXCLUDED.plate_type, case_kind = EXCLUDED.case_kind, province = EXCLUDED.province, photo_path = EXCLUDED.photo_path,
          case_note = EXCLUDED.case_note, excluded = EXCLUDED.excluded,
          exclude_reason = COALESCE(EXCLUDED.exclude_reason, blacklist.overrides.exclude_reason),
          note = COALESCE(EXCLUDED.note, blacklist.overrides.note),
          updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [r.source_id, r.external_id, next.name, next.plate_numbers, next.case_note,
         next.excluded, next.exclude_reason ?? null, next.note ?? null,
         req.user?.username || 'unknown',
         next.brand ?? null, next.vehicle_type ?? null, next.vehicle_color ?? null, next.plate_type ?? null, next.case_kind ?? null, next.province ?? null, next.photo_path ?? null]);

      // an override that overrides nothing is noise — drop it
      await pool.query(`
        DELETE FROM blacklist.overrides
        WHERE source_id = $1 AND external_id = $2
          AND name IS NULL AND plate_numbers IS NULL AND case_note IS NULL AND excluded = FALSE
          AND brand IS NULL AND vehicle_type IS NULL AND vehicle_color IS NULL AND plate_type IS NULL AND case_kind IS NULL AND province IS NULL AND photo_path IS NULL`,
        [r.source_id, r.external_id]);

      await relinkRecord(r.id);
      await auditOverride(req,
        next.excluded !== before.excluded
          ? (next.excluded ? 'blacklist_record_exclude' : 'blacklist_record_restore')
          : 'blacklist_record_edit',
        r, before, next);

      // Owner's call 2026-08-18: a manual exclude is a full human confirmation
      // for THIS record already — it should not also sit blocked behind the
      // bridge preview screen. finishImport()'s auto-sync only fires as a side
      // effect of an import, so an exclude done between import ticks used to
      // wait up to the source's pull interval before it actually stopped
      // alerting. FB (2026-08-19) extends this to face.
      if (next.excluded && next.excluded !== before.excluded) {
        if (r.data_type === 'lpr') {
          const s = await bridge.attemptAutoSync(pool, { username: req.user?.username || 'admin' });
          if (s.ok && !s.skipped) {
            console.log(`[blacklist-bridge] sync after manual exclude: +${s.added} ~${s.updated} -${s.removed}`);
          }
        } else if (r.data_type === 'face') {
          const faceBridge = require('../helpers/blacklistFaceBridge');
          const s = await faceBridge.attemptAutoFaceSync(pool, { username: req.user?.username || 'admin' });
          if (s.ok && !s.skipped) {
            console.log(`[face-blacklist-bridge] sync after manual exclude: +${s.added} ~${s.updated} -${s.removed}`);
          }
        }
      }

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/blacklist/quality', async (req, res) => {
    try {
      const dataType = req.query.data_type === 'lpr' ? 'lpr' : 'face';
      const q = await faceQuality(dataType);
      res.json({
        dup_name_groups: q.dup_names.length,
        dup_name_records: q.dup_names.reduce((s, g) => s + g.records.length, 0),
        invalid_id_count: q.invalid_ids.length,
        ...q,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- duplicate plates (operator triage) ----------
  // The roster holds the same plate more than once with DIFFERENT details
  // (different province / brand / reporting unit) — sometimes a genuine second
  // case on the same vehicle, sometimes junk test data from the source. The
  // platform deliberately does NOT auto-merge these (spec §4.3: no fuzzy
  // matching); this endpoint surfaces them so a human can classify.
  // Fields worth comparing across the rows of one plate. Everything else is
  // either identical by construction (the plate) or free text nobody can diff.
  const DUP_KEYS = ['province', 'carbrand', 'carcolor', 'cartype', 'platetype'];

  // Classify a group. Measured against the real roster (2026-07-26): of 255
  // duplicate plates only 32 hold an actual disagreement — 223 are one source
  // simply not carrying a field the other does. Highlighting "differs" without
  // that split made every group look like a decision; it made the page 8x
  // bigger than the work in it.
  function classifyDupGroup(records) {
    let conflict = false, gap = false;
    const conflictFields = [];
    for (const k of DUP_KEYS) {
      const vals = records.map(r => String((r.raw_json || {})[k] || '').trim().toLowerCase());
      const present = [...new Set(vals.filter(Boolean))];
      if (present.length > 1) { conflict = true; conflictFields.push(k); }
      else if (present.length === 1 && vals.some(v => !v)) gap = true;
    }
    // A Thai plate always carries letters. All-digits (1234, 123456) or a
    // 1-3 character stub is malformed — almost always test data left in the
    // source. Flagged for REVIEW only; nothing is ever removed automatically.
    const plate = String(records[0]?._plate || '');
    const malformed = !/[\u0E00-\u0E7FA-Za-z]/.test(plate) || plate.length <= 3;
    const singleSource = new Set(records.map(r => r.source_id)).size === 1;
    return {
      kind: conflict ? 'conflict' : (gap ? 'complement' : 'same'),
      conflict_fields: conflictFields,
      malformed, single_source: singleSource,
    };
  }

  app.get('/api/blacklist/duplicates', async (req, res) => {
    try {
      const dataType = req.query.data_type === 'face' ? 'face' : 'lpr';
      const limit  = Math.min(200, Math.max(5, parseInt(req.query.limit, 10) || 25));
      const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
      const withRemoved = req.query.with_removed === '1';
      const filter = String(req.query.filter || 'all');

      const notExcluded = withRemoved ? '' : 'AND COALESCE(o.excluded, FALSE) = FALSE';
      // Group on the NORMALIZED plate, the same key master merges on. Grouping
      // on the raw string hid 31 groups where one source wrote "1กข 7135" and
      // the other "1กข7135" — and made this page report 255 while the KPI on
      // the page that links to it said 286. Safe to compute inline: this runs
      // over ~1,600 roster rows, not the 2.9M-row events table.
      const NP = `UPPER(REGEXP_REPLACE(p, '[^0-9A-Za-zก-๙]', '', 'g'))`;

      // Pass 1 — light rows for EVERY duplicate, so the filter chip counts
      // describe the whole set rather than the page you happen to be on.
      const { rows: lite } = await pool.query(`
        WITH dup AS (
          SELECT ${NP} AS plate
            FROM blacklist.source_records r
            LEFT JOIN blacklist.overrides o
              ON o.source_id = r.source_id AND o.external_id = r.external_id
            CROSS JOIN LATERAL unnest(r.plate_numbers) p
           WHERE r.data_type = $1 ${notExcluded}
           GROUP BY 1 HAVING COUNT(*) > 1
        )
        SELECT ${NP} AS plate, r.id, r.source_id,
               jsonb_build_object(
                 'province',  r.raw_json->>'province',
                 'carbrand',  r.raw_json->>'carbrand',
                 'carcolor',  r.raw_json->>'carcolor',
                 'cartype',   r.raw_json->>'cartype',
                 'platetype', r.raw_json->>'platetype') AS raw_json
          FROM blacklist.source_records r
          LEFT JOIN blacklist.overrides o
            ON o.source_id = r.source_id AND o.external_id = r.external_id
          CROSS JOIN LATERAL unnest(r.plate_numbers) p
          JOIN dup ON dup.plate = ${NP}
         WHERE r.data_type = $1 ${notExcluded}`, [dataType]);

      const byPlate = new Map();
      for (const r of lite) {
        if (!byPlate.has(r.plate)) byPlate.set(r.plate, []);
        byPlate.get(r.plate).push({ ...r, _plate: r.plate });
      }
      const classified = [...byPlate.entries()].map(([plate, recs]) => ({
        plate, n: recs.length, ...classifyDupGroup(recs),
      }));

      const counts = {
        all: classified.length,
        conflict:   classified.filter(g => g.kind === 'conflict').length,
        complement: classified.filter(g => g.kind === 'complement').length,
        same:       classified.filter(g => g.kind === 'same').length,
        malformed:  classified.filter(g => g.malformed).length,
        single_source: classified.filter(g => g.single_source).length,
      };

      const match = (g) => filter === 'all' ? true
        : filter === 'malformed' ? g.malformed
        : filter === 'single_source' ? g.single_source
        : g.kind === filter;
      const selected = classified.filter(match).sort((a, b) => b.n - a.n || a.plate.localeCompare(b.plate));

      const totalGroups = selected.length;
      const pagePlates = selected.slice((page - 1) * limit, page * limit).map(g => g.plate);
      const meta = new Map(selected.map(g => [g.plate, g]));

      // Pass 2 — full rows (photos, notes, ids) for this page only.
      let groups = [];
      if (pagePlates.length) {
        const { rows } = await pool.query(`
          SELECT ${NP} AS plate, r.id, r.external_id, r.name, r.case_ref, r.case_note,
                 r.photo_path, r.imported_at, r.raw_json, s.label AS source_label,
                 l.master_id, COALESCE(o.excluded, FALSE) AS excluded, o.exclude_reason
            FROM blacklist.source_records r
            LEFT JOIN blacklist.overrides o
              ON o.source_id = r.source_id AND o.external_id = r.external_id
            CROSS JOIN LATERAL unnest(r.plate_numbers) p
            JOIN blacklist.sources s ON s.id = r.source_id
            LEFT JOIN blacklist.master_links l ON l.source_record_id = r.id
           WHERE r.data_type = $1 AND ${NP} = ANY($2) ${notExcluded}
           ORDER BY 1, r.external_id`, [dataType, pagePlates]);
        const m = new Map();
        for (const r of rows) {
          if (!m.has(r.plate)) m.set(r.plate, []);
          m.get(r.plate).push({
            id: r.id, master_id: r.master_id, external_id: r.external_id,
            name: r.name, case_ref: r.case_ref, case_note: r.case_note,
            photo_path: r.photo_path, source_label: r.source_label,
            imported_at: r.imported_at, raw_json: r.raw_json,
            excluded: r.excluded, exclude_reason: r.exclude_reason,
          });
        }
        groups = pagePlates.map(pl => ({ plate: pl, records: m.get(pl) || [], ...meta.get(pl) }));
      }

      res.json({
        total_plates: totalGroups,
        total_records: selected.reduce((s, g) => s + g.n, 0),
        page, limit, pages: Math.max(1, Math.ceil(totalGroups / limit)),
        filter, counts, groups,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

// กลุ่มที่ 2 — คัดออก/กู้คืน + รูปที่แก้ทับ (ต่อจาก GET /api/blacklist/removed ในไฟล์แม่)
function registerRemovalAndPhotos(app, pool) {

  // Remove records from the working set. This is an EXCLUSION, not a DELETE:
  // the raw row stays as evidence, drops out of master and every operator view,
  // cannot be resurrected by a re-import, and can be restored. A hard DELETE of
  // a wanted-vehicle record would be unrecoverable AND would come straight back
  // on the next import — the worst of both.
  app.post('/api/blacklist/duplicates/remove', async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.record_ids) ? req.body.record_ids : [];
      const restore = req.body?.restore === true;
      if (!ids.length) return res.status(400).json({ error: 'record_ids required' });

      const { rows } = await pool.query(
        `SELECT r.id, r.source_id, r.external_id, r.name, r.plate_numbers
           FROM blacklist.source_records r WHERE r.id = ANY($1)`, [ids]);
      if (!rows.length) return res.status(404).json({ error: 'no matching records' });

      for (const r of rows) {
        await pool.query(`
          INSERT INTO blacklist.overrides
            (source_id, external_id, excluded, exclude_reason, updated_by, updated_at)
          VALUES ($1,$2,$3,$4,$5,NOW())
          ON CONFLICT (source_id, external_id) DO UPDATE
            SET excluded = EXCLUDED.excluded,
                exclude_reason = EXCLUDED.exclude_reason,
                updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [r.source_id, r.external_id, !restore,
           restore ? null : (req.body?.reason || 'ทะเบียนซ้ำ — คัดออกจากหน้าตรวจสอบ'),
           req.user?.username || 'unknown']);
      }

      // master_links are deliberately NOT touched. Every read path already
      // filters on COALESCE(o.excluded, FALSE) = FALSE (see the master list
      // query and blacklistResolve.NOT_EXCLUDED), so the override alone is
      // enough to hide the record everywhere. Deleting the link instead would
      // work for hiding but leave the row orphaned on restore — un-excluded and
      // still invisible, because nothing would re-attach it to an identity.
      // Flipping one boolean is reversible; unpicking a graph is not.

      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown',
         restore ? 'blacklist_dup_restore' : 'blacklist_dup_remove',
         JSON.stringify({
           count: rows.length, ip: req.ip,
           records: rows.map(r => ({ id: r.id, external_id: r.external_id,
                                     plate: (r.plate_numbers || [])[0], name: r.name })),
         })]
      ).catch(() => { /* never block the operator on an audit write failure */ });

      res.json({ ok: true, affected: rows.length, restored: restore });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- override photo upload (admin-only, decision #152) ----------
  // Multer memory storage + magic-byte validation + resize via sharp.
  // Stored with '_ov' suffix so source photo is not overwritten and can be restored.
  const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.post('/api/blacklist/record/:id/photo', photoUpload.single('photo'), async (req, res) => {
    try {
      // Admin gating (already enforced by middleware, but explicit for safety)
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin role required' });
      }

      if (!req.file) return res.status(400).json({ error: 'photo file required (field: "photo")' });

      // Validate image magic bytes (not MIME type — GOTCHAS #55)
      try {
        assertImageBuffer(req.file.buffer);
      } catch (e) {
        return res.status(415).json({ error: e.message });
      }

      // Get the source record to find source_id and external_id
      const { rows } = await pool.query(
        'SELECT source_id, external_id FROM blacklist.source_records WHERE id = $1',
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'not found' });

      const sourceId = rows[0].source_id;
      const externalId = rows[0].external_id;

      // Resize and encode as base64
      const resized = await sharp(req.file.buffer, { failOn: 'none' })
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      const b64 = resized.toString('base64');

      // Save with '_ov' suffix so operator override doesn't clobber source photo
      const photoPath = savePhoto(sourceId, `${externalId}_ov`, b64);

      res.json({ photo_path: photoPath });
    } catch (e) {
      console.error('[blacklist-sources] photo upload:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ---------- auth-gated photo serving (never static — these are PII) ----------
  app.get('/api/blacklist/photo/:sourceId/:file', (req, res) => {
    const { sourceId, file } = req.params;
    if (!/^\d+$/.test(sourceId) || !/^[0-9A-Za-z_-]+\.jpg$/.test(file)) {
      return res.status(400).end();
    }
    const p = path.join(PHOTO_DIR, sourceId, file);
    if (!p.startsWith(PHOTO_DIR) || !fs.existsSync(p)) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type('jpeg').send(fs.readFileSync(p));
  });
}

module.exports = { registerCorrections, registerRemovalAndPhotos };
