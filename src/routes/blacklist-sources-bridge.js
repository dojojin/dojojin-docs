// ============================================================
// Vigil Platform — Routes: Blacklist bridge to lpr_watchlist + manual entry
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แยกออกจาก routes/blacklist-sources.js — route ทั้งหมดในไฟล์นี้ยังลงทะเบียนที่
// ตำแหน่งเดิมเป๊ะ (ลำดับการลงทะเบียนคือพฤติกรรม) โดยไฟล์แม่เรียก factory นี้
// คั่นระหว่างกลุ่ม /api/blacklist/stats กับกลุ่ม /api/blacklist/settings
'use strict';
const { visibleSites } = require('../helpers/watchScope');

const { idHash, checkThaiNationalId, normalizePlate } = require('../helpers/blacklist-crypto');
const { upsertRecord, unconfirmedRemovals } = require('../helpers/blacklistImport');
const { assertImageBuffer } = require('../helpers/imageMagic');
const bridge = require('../helpers/blacklistBridge');

module.exports = function registerBridgeAndManual(app, pool) {

  // ---------- bridge to lpr_watchlist (B3) ----------
  // The reservoir does not alert. These routes are how roster plates become
  // live watch-list entries — and how they stop being one when the source drops
  // them. Preview is always available; sync is a separate, explicit call.

  // Everything the selection UI needs: rules, target groups (by NAME — group ids
  // are internal and renameable), and the group facet per source so the UI can
  // hide the risk filter for a source that reports no groups.
  app.get('/api/blacklist/bridge/rules', async (req, res) => {
    try {
      const rules = await pool.query(`
        SELECT r.*, s.label AS source_label, s.source_type, s.site_code,
               g.name AS target_group_name, g.color AS target_group_color
          FROM blacklist.bridge_rules r
          JOIN blacklist.sources s ON s.id = r.source_id
          LEFT JOIN lpr_watchlist_groups g ON g.id = r.target_group_id
         ORDER BY r.id`);
      const groups = await pool.query(
        `SELECT id, name, color, site_id FROM lpr_watchlist_groups
          WHERE ($1::int[] IS NULL OR site_id IS NULL OR site_id = ANY($1)) ORDER BY created_at`, [visibleSites(req)]);
      const facets = await pool.query(`
        SELECT r.source_id, COALESCE(r.raw_json->>'group_name', '__none__') AS group_name,
               COUNT(*) AS n
          FROM blacklist.source_records r
         WHERE r.data_type = 'lpr'
         GROUP BY 1, 2 ORDER BY 1, 3 DESC`);
      const live = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE origin = 'blacklist_bridge') AS bridged,
               COUNT(*) FILTER (WHERE origin <> 'blacklist_bridge') AS manual
          FROM lpr_watchlist`);
      // BS3 — sync status, so an operator sees a stuck auto-sync without having
      // to open the preview to find out. diff() is a pure read (safe here), and
      // unconfirmedRemovals() is the exact same check finishImport()'s auto-sync
      // gate runs — this reports what is ALREADY blocking the next tick, not a
      // separate opinion about it.
      const d = await bridge.diff(pool, null);
      const pendingPlates = await unconfirmedRemovals(pool, d.remove.map(r => r.plate_number));
      const lastSync = await pool.query(`
        SELECT MAX(s.last_bridge_sync_at) AS t
          FROM blacklist.sources s JOIN blacklist.bridge_rules r ON r.source_id = s.id
         WHERE r.active`);
      res.json({
        rules: rules.rows,
        groups: groups.rows,
        facets: facets.rows.map(f => ({ ...f, n: Number(f.n) })),
        watchlist: { bridged: Number(live.rows[0].bridged), manual: Number(live.rows[0].manual) },
        pending: { count: pendingPlates.length, plates: pendingPlates.slice(0, 50) },
        last_sync_at: lastSync.rows[0]?.t || null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/blacklist/bridge/rules', async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.source_id) return res.status(400).json({ error: 'source_id required' });
      const { rows } = await pool.query(`
        INSERT INTO blacklist.bridge_rules
          (source_id, group_names, external_ids, target_group_id, notify_line, active, label, created_by)
        VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE),$7,$8) RETURNING *`,
        [b.source_id, b.group_names || null, b.external_ids || null,
         b.target_group_id || null, !!b.notify_line, b.active, b.label || null,
         req.user?.username || null]);
      res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/blacklist/bridge/rules/:id', async (req, res) => {
    try {
      const b = req.body || {};
      const sets = [], vals = [req.params.id];
      const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if ('group_names' in b)     set('group_names', b.group_names || null);
      if ('external_ids' in b)    set('external_ids', b.external_ids || null);
      if ('target_group_id' in b) set('target_group_id', b.target_group_id || null);
      if ('notify_line' in b)     set('notify_line', !!b.notify_line);
      if ('active' in b)          set('active', !!b.active);
      if ('label' in b)           set('label', b.label || null);
      if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
      sets.push('updated_at = NOW()');
      const { rows } = await pool.query(
        `UPDATE blacklist.bridge_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/blacklist/bridge/rules/:id', async (req, res) => {
    try {
      // Deleting the rule does NOT remove the plates it created — the next sync
      // does, and only after the operator has seen them listed under "จะถูกลบ".
      // Silent alert removal is exactly as dangerous as silent alert creation.
      await pool.query('DELETE FROM blacklist.bridge_rules WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // B3.3 — dry run. Writes nothing.
  app.get('/api/blacklist/bridge/preview', async (req, res) => {
    try {
      const ids = req.query.rule_ids
        ? String(req.query.rule_ids).split(',').map(s => s.trim()).filter(Boolean) : null;
      const d = await bridge.diff(pool, ids);
      res.json({
        add: d.add.slice(0, 200), update: d.update.slice(0, 200),
        remove: d.remove.slice(0, 200), skipped: d.skipped.slice(0, 200),
        takeover: (d.takeover || []).slice(0, 200),
        counts: {
          add: d.add.length, update: d.update.length, remove: d.remove.length,
          skipped_manual: d.skipped.length, takeover: (d.takeover || []).length,
          desired_total: d.desired_total, current_total: d.current_total,
        },
        // A rule-narrowed run cannot see whether another rule still claims a
        // plate, so it withdraws nothing. Reported rather than left to look
        // like "there is nothing to withdraw", which is a different fact.
        partial: d.partial,
        truncated: d.add.length > 200 || d.remove.length > 200,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // B3.4 — the real thing. Requires the operator to echo the exact add/remove
  // counts they were shown, so a preview that went stale cannot be confirmed
  // blind (same guard as push-back's checksum).
  app.post('/api/blacklist/bridge/sync', async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.rule_ids) && req.body.rule_ids.length
        ? req.body.rule_ids : null;
      const d = await bridge.diff(pool, ids);
      const c = req.body?.confirm || {};
      if (Number(c.add) !== d.add.length || Number(c.remove) !== d.remove.length) {
        return res.status(409).json({
          error: 'รายการเปลี่ยนไปหลังจากที่คุณตรวจสอบ — กรุณาดูรายการใหม่แล้วยืนยันอีกครั้ง',
          counts: { add: d.add.length, remove: d.remove.length },
        });
      }
      const result = await bridge.sync(pool, ids, req.user);
      res.json({ ok: true, partial: d.partial, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- BM1a — add one plate by hand ----------
  // POST /api/blacklist/manual/lpr
  //
  // lpr_watchlist held 481 rows and every one came from an import, because
  // POST /api/lpr/watchlist writes straight into that table and can therefore
  // only carry a plate and a label. An imported plate carries an identity, a
  // case reference, a province and a photo because it travelled through
  // source_records -> master -> the bridge. This route puts a typed plate on
  // that same road instead of building a second one, by calling the importer's
  // own upsertRecord().
  //
  // It deliberately does NOT sync. bridge.sync() is an operator action behind a
  // preview, and both ways of calling it from here are wrong: a full sync would
  // also commit whatever other rosters have pending, unpreviewed, and a sync
  // narrowed to this rule hits the bug reproduced 2026-08-07 — diff() narrows
  // `desired` by rule but reads `current` unscoped, so its remove pass deletes
  // every plate the other rules own (rule 9 alone: remove 481). So the plate
  // lands in the reservoir and the response says how many rows are now pending;
  // the operator applies it from the bridge screen exactly as with an import.
  //
  // Admin-only already: app.use('/api/blacklist', requireAdminForWrites('/')).
  app.post('/api/blacklist/manual/lpr', async (req, res) => {
    const client = await pool.connect();
    try {
      const b = req.body || {};
      const plate = normalizePlate(b.plate);
      if (!plate) return res.status(400).json({ error: 'ต้องระบุเลขทะเบียน' });

      const { rows: [src] } = await pool.query(
        `SELECT id FROM blacklist.sources WHERE source_type = 'manual'`);
      if (!src) return res.status(412).json({ error: "ยังไม่มีแหล่งข้อมูล 'manual' — migration 124 ยังไม่ได้รัน" });

      // A group is a policy, not a label: lpr_watchlist_groups.default_alert_mode
      // decides whether a match needs the province to agree. Validate it here so
      // a typo cannot create a rule pointing at a group that does not exist.
      const groupId = (b.group_id || '').trim() || null;
      let mode = 'plate';
      if (groupId) {
        const { rows: [g] } = await pool.query(
          'SELECT default_alert_mode FROM lpr_watchlist_groups WHERE id = $1', [groupId]);
        if (!g) return res.status(400).json({ error: `ไม่รู้จักกลุ่ม "${groupId}"` });
        mode = g.default_alert_mode || 'plate';
      }
      const province = (b.province || '').trim() || null;
      // The bridge drops a plate_region row whose province is unknown, on
      // purpose (a bare plate match cannot confirm the vehicle). Refusing here
      // is the difference between the operator seeing why and the plate simply
      // never appearing.
      if (mode === 'plate_region' && !province) {
        return res.status(400).json({
          error: `กลุ่มนี้ตรวจทั้งทะเบียนและจังหวัด — ต้องระบุจังหวัดด้วย ไม่งั้นรายการจะไม่ถูกนำไปเฝ้าระวัง`,
        });
      }

      // Validate photo_b64 BEFORE transaction starts (no record created if invalid)
      let photoB64 = null;
      if (b.photo_b64) {
        const raw = String(b.photo_b64).replace(/^data:image\/[a-z+]+;base64,/i, '');
        // cap BEFORE decode — base64 is 4/3 of bytes, so 8MB limit → ~6MB base64
        if (raw.length > 8 * 1024 * 1024 / 3 * 4) {
          return res.status(413).json({ error: 'ขนาดรูปเกิน 8 MB' });
        }
        const buf = Buffer.from(raw, 'base64');
        try {
          assertImageBuffer(buf);
          photoB64 = raw;
        } catch (e) {
          return res.status(415).json({ error: e.message });
        }
      }

      // group_name is what bridge rules filter on. Ungrouped entries still need
      // a value so one rule cannot accidentally swallow another's plates.
      const groupName = groupId || '_ungrouped';

      await client.query('BEGIN');
      // external_id = the normalized plate. It is the only stable key a typed
      // entry has, and it makes re-adding the same plate an edit rather than a
      // duplicate. normalizePlate strips spaces and upper-cases, and plateHash()
      // applies it again internally, so "1กธ 4047" and "1กธ4047" are one record
      // and one master.
      const r = await upsertRecord(client, src.id, {
        external_id: plate,
        data_type: 'lpr',
        id_type: null, id_country: null, id_number: null,
        name: (b.name || '').trim() || null,
        case_ref: (b.case_ref || '').trim() || null,
        case_note: (b.case_note || '').trim() || null,
        plate_numbers: [plate],
        photo_b64: photoB64,
        raw_json: {
          province,
          group_name: groupName,
          added_by: req.user?.username || null,
          carbrand: (b.brand || '').trim() || null,
          cartype: (b.vehicle_type || '').trim() || null,
          carcolor: (b.vehicle_color || '').trim() || null,
          platetype: (b.plate_type || '').trim() || null,
          owner_detail: (b.case_kind || '').trim() || null,
        },
      });
      if (r.excluded) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'ทะเบียนนี้เคยถูกนำออกไว้ — กู้คืนจากถังขยะก่อน' });
      }

      // One rule per group, created on demand so the operator never has to know
      // that bridge rules exist. New rules get the highest id, and desiredRows()
      // is first-rule-wins ordered by id — so a plate that a roster already
      // claims keeps the roster's group. That is the safe default (adding a
      // source can add plates but never re-classify existing ones) but it does
      // mean a hand-typed group loses to a roster silently. Revisit if operators
      // report it.
      const { rows: [rule] } = await client.query(`
        WITH ins AS (
          INSERT INTO blacklist.bridge_rules
            (source_id, group_names, target_group_id, notify_line, active, label, created_by)
          SELECT $1, ARRAY[$2], $3, FALSE, TRUE, $4, $5
           WHERE NOT EXISTS (
             SELECT 1 FROM blacklist.bridge_rules
              WHERE source_id = $1 AND group_names = ARRAY[$2])
          RETURNING id
        )
        SELECT id FROM ins
        UNION ALL
        SELECT id FROM blacklist.bridge_rules
         WHERE source_id = $1 AND group_names = ARRAY[$2]
         LIMIT 1`,
        [src.id, groupName, groupId,
         `เพิ่มด้วยตนเอง → ${groupId || 'ไม่ระบุกลุ่ม'}`, req.user?.username || null]);
      await client.query('COMMIT');

      // BM3 — who added this, and when. raw_json.added_by already carries the
      // name, but that is provenance on one row, not a trail you can query:
      // "what did this officer add last month" would have to scan every
      // source_record's JSON. audit_log is the sink the rest of the system
      // already answers that question from, and blacklist writes to it for
      // id reveals, so this reuses it rather than inventing a second place.
      //
      // Deliberately after COMMIT and never awaited into the failure path: an
      // audit write that fails must not roll back a plate an officer believes
      // they saved. The reveal route below takes the same position.
      //
      // No plate-holder name or case note in the details — the audit trail says
      // WHO DID WHAT, and the what is already stored, keyed by record_id.
      pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'blacklist_manual_add',
         JSON.stringify({
           plate, record_id: r.srecId, master_id: r.masterId,
           group_id: groupId, created: r.wasInserted, ip: req.ip,
         })]
      ).catch((e) => console.warn('[manual/lpr] audit write failed:', e.message));

      // Pure read, after the commit. "บันทึกแล้ว" on its own is not enough: the
      // bridge decides the group from the rules but takes the province, note,
      // label and photo from whichever linked record is richest, so a plate a
      // roster already carries WITH A PHOTO keeps the roster's province and
      // note no matter what was typed. Saying so beats letting an officer walk
      // away believing the form did what it looked like it did.
      const d = await bridge.diff(pool);
      const willBe = [...d.add, ...d.update].find((x) => x.plate_number === plate) || null;
      const { rows: alsoIn } = await pool.query(`
        SELECT DISTINCT s.label, s.source_type
          FROM blacklist.master_links l
          JOIN blacklist.source_records rr ON rr.id = l.source_record_id
          JOIN blacklist.sources s ON s.id = rr.source_id
         WHERE l.master_id = $1 AND s.source_type <> 'manual'`, [r.masterId]);

      res.status(201).json({
        ok: true,
        plate,
        record_id: r.srecId,
        master_id: r.masterId,
        rule_id: rule?.id || null,
        created: r.wasInserted,
        // Sources other than us that already hold this plate. Empty is the
        // ordinary case; non-empty is the one worth a line on screen.
        also_in: alsoIn.map((x) => x.label),
        // What the watch-list row will actually look like once applied — read
        // off the bridge itself rather than echoing the form back, so the two
        // cannot drift. null means nothing will change (the row already matches).
        will_be: willBe && {
          group_id: willBe.group_id, region: willBe.region,
          label: willBe.label, notes: willBe.notes,
        },
        // Fields where another source outranks what was just typed. This is the
        // sentence the operator needs, and it is derived, not guessed.
        overridden: willBe ? [
          province && willBe.region !== province ? 'จังหวัด' : null,
          (b.case_note || '').trim() && willBe.notes !== (b.case_note || '').trim() ? 'หมายเหตุ' : null,
        ].filter(Boolean) : [],
        pending: { add: d.add.length, update: d.update.length, remove: d.remove.length },
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // ---------- BM1b — add one face by hand ----------
  // POST /api/blacklist/manual/face
  //
  // Similar to BM1a (manual LPR) but for faces. Faces enter the reservoir
  // (blacklist.master) but have no bridge to a watch mechanism — they stay
  // "ยังไม่เฝ้า" (not yet watched) until an operator manually links them to an
  // alert rule elsewhere.
  //
  // Admin-only already: app.use('/api/blacklist', requireAdminForWrites('/')).
  app.post('/api/blacklist/manual/face', async (req, res) => {
    const client = await pool.connect();
    try {
      const b = req.body || {};
      const name = (b.name || '').trim() || null;
      if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อ' });

      const nationalId = (b.national_id || '').trim() || null;
      if (!nationalId) return res.status(400).json({ error: 'ต้องระบุเลขบัตรประชาชน' });

      // Validate the national ID format and checksum
      const idCheck = checkThaiNationalId(nationalId);
      if (!idCheck.ok) {
        return res.status(400).json({
          error: idCheck.reason === 'length'
            ? `เลขบัตรต้องมี 13 หลัก (ได้ ${idCheck.length} หลัก)`
            : idCheck.reason === 'checksum'
            ? 'เลขบัตรไม่ถูกต้อง (checksum ไม่ตรง)'
            : 'เลขบัตรขาดหรือไม่ถูกต้อง',
        });
      }

      const { rows: [src] } = await pool.query(
        `SELECT id FROM blacklist.sources WHERE source_type = 'manual'`);
      if (!src) return res.status(412).json({ error: "ยังไม่มีแหล่งข้อมูล 'manual' — migration 124 ยังไม่ได้รัน" });

      // For faces, we use 'national_id' as id_type and Thailand as id_country
      const caseRef = (b.case_ref || '').trim() || null;
      const caseNote = (b.case_note || '').trim() || null;

      await client.query('BEGIN');

      // Use the national ID hash as external_id for idempotency — re-adding the
      // same ID becomes an edit rather than a duplicate.
      const idHashVal = idHash(nationalId, 'national_id', null);
      const r = await upsertRecord(client, src.id, {
        external_id: idHashVal,
        data_type: 'face',
        id_type: 'national_id',
        id_country: null,
        id_number: nationalId,  // plaintext — upsertRecord encrypts it internally
        name,
        case_ref: caseRef,
        case_note: caseNote,
        plate_numbers: [],
        photo_b64: b.photo_b64 || null,
        raw_json: {
          added_by: req.user?.username || null,
        },
      });

      if (r.excluded) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'บุคคลนี้เคยถูกนำออกไว้ — กู้คืนจากถังขยะก่อน' });
      }

      await client.query('COMMIT');

      // Audit after COMMIT, unawaited, never blocking on failure
      pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        // No name here, for the same reason BM1a keeps the plate-holder's name
        // out: the trail answers WHO DID WHAT, and the what is already stored
        // and keyed by record_id. A suspect's name in audit_log is a second
        // copy of the sensitive part, in the one table read by people who are
        // auditing operators rather than investigating cases.
        [req.user?.id || null, req.user?.username || 'unknown', 'blacklist_manual_add_face',
         JSON.stringify({
           record_id: r.srecId, master_id: r.masterId,
           created: r.wasInserted, ip: req.ip,
         })]
      ).catch((e) => console.warn('[manual/face] audit write failed:', e.message));

      res.status(201).json({
        ok: true,
        name,
        record_id: r.srecId,
        master_id: r.masterId,
        created: r.wasInserted,
        status: 'ยังไม่เฝ้า',  // not yet watched — faces have no bridge
        // Faces do not go to a watch mechanism, so there is no bridge diff.
        // The response simply confirms entry into the reservoir.
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });
};
