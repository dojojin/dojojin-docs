// ============================================================
// Vigil Platform — Routes: LPR Watchlist
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const { auditChange } = require('../helpers/auditTrail');

const fs     = require('fs');
const path   = require('path');
const multer = require('multer');
const sharp  = require('sharp');

// The alert join is `w.plate_number = UPPER(lp.plate_number)` over 2.9M
// license_plates rows — a REGEXP_REPLACE there would kill the index, so both
// sides have to be canonical BEFORE they are stored. Cameras already emit clean
// plates (0 of 2,930,621 reads contained a separator); what is not clean is
// human entry — 146 of the 1,596 imported roster plates carry a space or dash.
// Hence: normalize at every write gate, never at the join.
const { normalizePlate } = require('../helpers/blacklist-crypto');
const { assertImageBuffer } = require('../helpers/imageMagic');
const lprLineAlert = require('../helpers/lprLineAlert');
const { visibleSites, bodySiteId, watchSiteOk } = require('../helpers/watchScope');
const { scrubRawJsonSql } = require('../helpers/scrubRawJson');

// Normalize + tell us when the input was not already canonical. Log-only: an
// operator typing "1กค 9136" must still get their entry saved, not an error.
function canonicalPlate(raw, where) {
  const norm = normalizePlate(raw);
  const plain = String(raw || '').trim().toUpperCase();
  if (norm !== plain) {
    console.warn(`[lpr-watchlist] normalized plate at ${where}: ${JSON.stringify(plain)} -> ${JSON.stringify(norm)}`);
  }
  return norm;
}

const VALID_MODES = new Set(['plate', 'plate_region']);

module.exports = function lprWatchlistRoutes(app, pool, { SNAPSHOT_DIR }) {
  // Reference images live in a snapshots subdir → auth-gated via /snapshots/ +
  // skipped by retention (it only scans top-level files). PDPA: plate = personal data.
  const refDir = path.join(SNAPSHOT_DIR, 'lpr-watchlist');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  // ── Groups ──────────────────────────────────────────────────────
  app.get('/api/lpr/watchlist/groups', async (req, res) => {
    try {
      // site_id: NULL = Global · มีค่า = เฉพาะ Site (migration 261) — ผู้ใช้ที่ถูกจำกัด Site เห็น Global + ของตัวเอง
      const r = await pool.query(
        `SELECT id, name, color, default_alert_mode, notify_line, site_id FROM lpr_watchlist_groups
          WHERE ($1::int[] IS NULL OR site_id IS NULL OR site_id = ANY($1)) ORDER BY created_at`, [visibleSites(req)]);
      res.json(r.rows);
    } catch (e) {
      console.error('[lpr-watchlist] GET groups:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/lpr/watchlist/groups', async (req, res) => {
    const { name, color, default_alert_mode } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const mode = VALID_MODES.has(default_alert_mode) ? default_alert_mode : 'plate';
    const site = bodySiteId(req.body);
    if (site.error) return res.status(400).json({ error: site.error });
    const id = 'g' + Date.now().toString(36);
    try {
      const r = await pool.query(
        'INSERT INTO lpr_watchlist_groups (id, name, color, default_alert_mode, site_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, color, default_alert_mode, site_id',
        [id, String(name).trim(), (color || '#5b8def').trim(), mode, site.value ?? null]
      );
      await auditChange(req, 'lpr_watch_group_create', { after: r.rows[0], target: id });
      res.status(201).json(r.rows[0]);
    } catch (e) {
      if (e.code === '23503') return res.status(400).json({ error: 'unknown site_id' });
      console.error('[lpr-watchlist] POST groups:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // RF2 — rename / recolor a group (partial)
  app.patch('/api/lpr/watchlist/groups/:id', async (req, res) => {
    const { name, color, default_alert_mode, notify_line } = req.body || {};
    const sets = [], vals = [];
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'name required' });
      vals.push(String(name).trim()); sets.push(`name = $${vals.length}`);
    }
    if (color !== undefined) { vals.push(String(color || '#5b8def').trim()); sets.push(`color = $${vals.length}`); }
    // Master switch for LINE alerts on this category. Off by default and only
    // ever flipped here — messages go to real phones, so it is a decision
    // someone makes, never an upgrade side effect.
    if (notify_line !== undefined) {
      vals.push(!!notify_line); sets.push(`notify_line = $${vals.length}`);
    }
    if (default_alert_mode !== undefined) {
      if (!VALID_MODES.has(default_alert_mode)) return res.status(400).json({ error: 'invalid default_alert_mode' });
      vals.push(default_alert_mode); sets.push(`default_alert_mode = $${vals.length}`);
    }
    // Global ↔ เฉพาะ Site — เปลี่ยนว่า "กล้องไหนจับคู่ได้" ของทุกป้ายในกลุ่มทันที (มีผลภายใน 5 นาทีที่ฝั่ง LINE)
    const site = bodySiteId(req.body);
    if (site.error) return res.status(400).json({ error: site.error });
    if (site.present) { vals.push(site.value); sets.push(`site_id = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    vals.push(req.params.id);
    try {
      const { rows: before } = await pool.query(
        'SELECT id, name, color, default_alert_mode, notify_line, site_id FROM lpr_watchlist_groups WHERE id = $1', [req.params.id]);
      const r = await pool.query(
        `UPDATE lpr_watchlist_groups SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, name, color, default_alert_mode, notify_line, site_id`,
        vals
      );
      if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
      await auditChange(req, 'lpr_watch_group_update', { before: before[0], after: r.rows[0], target: req.params.id });
      // Cascade to member plates — the group's mode is now the only place this
      // is decided, so a plate must not keep pointing at whatever mode happened
      // to be picked back when the per-plate selector still existed.
      let warning = null;
      if (default_alert_mode !== undefined) {
        await pool.query(
          'UPDATE lpr_watchlist SET alert_mode = $2 WHERE group_id = $1',
          [req.params.id, default_alert_mode]
        );
        // Switching a group to plate_region silently stops alerting for any
        // member plate with no region on file — a matching condition that can
        // never be satisfied is not a validation error, so nothing else would
        // surface it. Warn rather than block: some groups (e.g. one sourced
        // entirely from a feed with no province field) may legitimately have
        // no region-bearing rows yet, and the caller should see the number
        // before deciding, not be stopped from ever setting the mode.
        if (default_alert_mode === 'plate_region') {
          const { rows: cnt } = await pool.query(
            `SELECT count(*) FILTER (WHERE region IS NULL) AS no_region, count(*) AS total
               FROM lpr_watchlist WHERE group_id = $1`, [req.params.id]);
          const { no_region, total } = cnt[0];
          if (Number(no_region) > 0) {
            warning = `${no_region} of ${total} plates in this group have no province on file — `
              + `those will not alert until a province is added`;
            console.warn(`[lpr-watchlist] group ${req.params.id} set to plate_region: ${warning}`);
          }
        }
      }
      res.json({ ...r.rows[0], warning });
    } catch (e) {
      console.error('[lpr-watchlist] PATCH groups:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/lpr/watchlist/groups/:id', async (req, res) => {
    try {
      // FK ของป้ายเป็น ON DELETE SET NULL = ป้ายไม่มีกลุ่ม = Global · ลบกลุ่มเฉพาะ Site ที่ยังมีป้าย
      // จะทำให้ป้ายของไซต์หนึ่งไปแจ้งเตือนทุกไซต์เงียบ ๆ — ต้องย้าย/ลบป้ายก่อน
      const { rows: chk } = await pool.query(
        `SELECT g.site_id, (SELECT count(*) FROM lpr_watchlist w WHERE w.group_id = g.id)::int AS n
           FROM lpr_watchlist_groups g WHERE g.id = $1`, [req.params.id]);
      if (chk[0] && chk[0].site_id != null && chk[0].n > 0) {
        return res.status(409).json({ error: 'site list still has plates — move or delete them first', count: chk[0].n });
      }
      const { rows: gone } = await pool.query('DELETE FROM lpr_watchlist_groups WHERE id = $1 RETURNING *', [req.params.id]);
      if (gone[0]) await auditChange(req, 'lpr_watch_group_delete', { before: gone[0], target: req.params.id });
      res.json({ ok: true });
    } catch (e) {
      console.error('[lpr-watchlist] DELETE groups:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── Reference image upload ──────────────────────────────────────
  // Returns { filename } to store in lpr_watchlist.ref_image. Magic-byte
  // validated (Content-Type is spoofable) — GOTCHAS #50-57 / SEC-005, via the
  // shared helpers/imageMagic.js.
  app.post('/api/lpr/watchlist/image', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'image file required (field: "image")' });
    const buf = req.file.buffer;
    try { assertImageBuffer(buf); }
    catch (e) { return res.status(415).json({ error: e.message }); }
    try {
      fs.mkdirSync(refDir, { recursive: true });
      const outName = `wl_${Date.now()}.jpg`;
      await sharp(buf, { failOn: 'none' })
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(path.join(refDir, outName));
      res.json({ filename: `lpr-watchlist/${outName}` });
    } catch (e) {
      console.error('[lpr-watchlist] image upload:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── Entries ─────────────────────────────────────────────────────
  app.get('/api/lpr/watchlist', async (req, res) => {
    try {
      // origin/blacklist_master_id let the frontend tell a bridge-managed row
      // (edit province/group/photo at the source instead — bridge.sync() would
      // just overwrite them here) from a hand-added one. last_bridge_sync_at
      // lives on blacklist.sources, not this table — not selected here.
      const r = await pool.query(
        `SELECT w.plate_number, w.label, w.notes, w.active, w.created_at,
                w.group_id, w.alert_mode, w.region, w.ref_image, w.notify_line,
                w.origin, w.blacklist_master_id, g.site_id
           FROM lpr_watchlist w LEFT JOIN lpr_watchlist_groups g ON g.id = w.group_id
          WHERE ($1::int[] IS NULL OR g.site_id IS NULL OR g.site_id = ANY($1))
          ORDER BY w.created_at DESC`, [visibleSites(req)]
      );
      res.json(r.rows);
    } catch (e) {
      console.error('[lpr-watchlist] GET:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/lpr/watchlist', async (req, res) => {
    const { plate_number, label, notes, group_id, region, ref_image, notify_line } = req.body || {};
    if (!plate_number || typeof plate_number !== 'string' || !plate_number.trim()) {
      return res.status(400).json({ error: 'plate_number required' });
    }
    const plate = canonicalPlate(plate_number, 'POST');
    if (!plate) return res.status(400).json({ error: 'plate_number has no usable characters' });
    // alert_mode is no longer a client choice (2026-07-27) — it is the group's
    // policy, not something picked per plate. A plate with no group falls back
    // to 'plate', the same default the mode column always had.
    let mode = 'plate';
    if (group_id) {
      const { rows } = await pool.query(
        'SELECT default_alert_mode FROM lpr_watchlist_groups WHERE id = $1', [group_id]);
      if (rows[0]) mode = rows[0].default_alert_mode;
    }
    try {
      const r = await pool.query(
        `INSERT INTO lpr_watchlist
           (plate_number, label, notes, active, group_id, alert_mode, region, ref_image, notify_line)
         VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8)
         ON CONFLICT (plate_number) DO UPDATE
           SET label = EXCLUDED.label, notes = EXCLUDED.notes, active = TRUE,
               group_id = EXCLUDED.group_id, alert_mode = EXCLUDED.alert_mode,
               region = EXCLUDED.region, ref_image = EXCLUDED.ref_image,
               notify_line = EXCLUDED.notify_line
         RETURNING *`,
        [plate, (label || '').trim() || null, (notes || '').trim() || null,
         group_id || null, mode, (region || '').trim() || null,
         ref_image || null, notify_line !== false]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) {
      console.error('[lpr-watchlist] POST:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Change one switch on an existing row, in place. `notify_line` joined
  // `active` here on 2026-08-13: the per-plate LINE mute had no write path at
  // all for bridge-managed rows, so a plate the bridge muted on import ('กร6',
  // and eight others) could be seen as muted but never un-muted from the UI.
  //
  // Deliberately NOT routed through POST /api/lpr/watchlist, which is the door
  // the hand-added rows' edit modal uses. That one is a full upsert: it forces
  // active = TRUE (silently re-enabling a plate someone had disabled) and
  // rewrites label/notes/group_id/region/ref_image from the request body —
  // which the next bridge sync then overwrites straight back, since the row is
  // still origin='blacklist_bridge'. PATCH touches only what was asked for.
  //
  // Un-muting survives every later sync without any extra guard, and that is a
  // property of the bridge rather than a promise made here: bridgeNotifyLine()
  // is called from the INSERT branch of sync() only (blacklistBridge.js), and
  // the UPDATE branch does not carry the column at all.
  // ── ปิดเสียงชั่วคราวรายป้าย (migration 207) ─────────────────
  // แยกจาก notify_line ที่เป็นเปิด/ปิดถาวรโดยตั้งใจ: อันนี้ **ต้องมีวันหมดอายุเสมอ**
  // เพราะสั่งจากในแชทได้ · การ์ดที่ปิดเสียงอาจเป็นรถหายพร้อมเบอร์ตำรวจ ปิดถาวรจาก
  // แชทแล้วลืมคือความเสียหายที่ไม่มีใครสังเกต
  app.post('/api/lpr/watchlist/:plate/mute', async (req, res) => {
    const plate = canonicalPlate(req.params.plate, 'MUTE');
    const hours = Math.min(Math.max(parseInt(req.body?.hours, 10) || 24, 1), 168);   // 1 ชม. - 7 วัน
    try {
      const { rows } = await pool.query(
        `INSERT INTO lpr_plate_mutes (plate_number, muted_until, muted_by, source, reason)
         VALUES ($1, now() + ($2 || ' hours')::interval, $3, $4, $5)
         ON CONFLICT (plate_number) DO UPDATE SET
           muted_until = EXCLUDED.muted_until, muted_by = EXCLUDED.muted_by,
           source = EXCLUDED.source, reason = EXCLUDED.reason, created_at = now()
         RETURNING muted_until`,
        [plate, String(hours), req.user?.username || null,
         req.body?.source === 'dashboard' ? 'dashboard' : 'line', req.body?.reason || null]);
      const state = await require('../helpers/lprLineAlert').plateAlertState(pool, plate);
      res.json({ ok: true, plate, muted_until: rows[0].muted_until, hours, state });
    } catch (e) {
      console.error('[lpr-watchlist] POST mute:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/lpr/watchlist/:plate/mute', async (req, res) => {
    const plate = canonicalPlate(req.params.plate, 'UNMUTE');
    try {
      await pool.query('DELETE FROM lpr_plate_mutes WHERE plate_number = $1', [plate]);
      // ตอบด้วย "สถานะจริง" ไม่ใช่ "สิ่งที่เพิ่งเขียนลงไป" — ป้ายอาจยังเงียบอยู่เพราะ
      // ช่องทางหรือกลุ่มถูกปิด ซึ่งเป็นคนละสวิตช์กัน
      const state = await require('../helpers/lprLineAlert').plateAlertState(pool, plate);
      res.json({ ok: true, plate, state });
    } catch (e) {
      console.error('[lpr-watchlist] DELETE mute:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.patch('/api/lpr/watchlist/:plate', async (req, res) => {
    const plate = canonicalPlate(req.params.plate, 'PATCH');
    const { active, notify_line, group_id } = req.body || {};
    const hasActive = typeof active === 'boolean';
    const hasNotify = typeof notify_line === 'boolean';
    // group_id is nullable on purpose — null means "no group", a real state a
    // plate can be in. `undefined` is the absent-field case and leaves it alone.
    const hasGroup = 'group_id' in (req.body || {});
    // All optional, but at least one required — an empty PATCH is a caller bug
    // (a typo'd field name silently succeeding is how "I clicked it and nothing
    // happened" bugs start), not a no-op worth a 200.
    if (!hasActive && !hasNotify && !hasGroup) {
      return res.status(400).json({ error: 'active, notify_line (boolean) or group_id required' });
    }
    if (hasGroup && group_id !== null && typeof group_id !== 'string') {
      return res.status(400).json({ error: 'group_id must be a string or null' });
    }
    try {
      if (hasGroup && group_id !== null) {
        const g = await pool.query('SELECT 1 FROM lpr_watchlist_groups WHERE id = $1', [group_id]);
        if (!g.rowCount) return res.status(400).json({ error: 'unknown group_id' });
      }
      const sets = [], vals = [];
      if (hasActive) { vals.push(active); sets.push(`active = $${vals.length}`); }
      if (hasNotify) { vals.push(notify_line); sets.push(`notify_line = $${vals.length}`); }
      if (hasGroup) {
        vals.push(group_id);
        sets.push(`group_id = $${vals.length}`);
        // The group's own policy comes with it. Matching by the old group's
        // rules while displaying under the new one is the kind of mismatch
        // nobody would think to look for.
        sets.push(`alert_mode = COALESCE((SELECT default_alert_mode FROM lpr_watchlist_groups
                                           WHERE id = $${vals.length}), alert_mode)`);
        // Pinning is what makes the move survive the next roster refresh
        // (migration 166). Only meaningful for bridge-owned rows — a hand-added
        // plate is already exempt, and a pin there would advertise a protection
        // that was never doing any work.
        sets.push(`group_pinned = (origin = 'blacklist_bridge')`);
      }
      vals.push(plate);
      // Previous values come back in the same statement, so the audit row can
      // say what actually changed rather than what was requested — a PATCH that
      // sets a flag to the value it already had should not read as a change.
      const r = await pool.query(
        `UPDATE lpr_watchlist SET ${sets.join(', ')}
          FROM (SELECT plate_number, active AS was_active, notify_line AS was_notify,
                       group_id AS was_group
                  FROM lpr_watchlist WHERE plate_number = $${vals.length}) prev
         WHERE lpr_watchlist.plate_number = prev.plate_number
         RETURNING lpr_watchlist.*, prev.was_active, prev.was_notify, prev.was_group`,
        vals
      );
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      const row = r.rows[0];

      // Audited because the dashboard already tells users every blacklist edit
      // is logged ("ทุกการแก้ไขถูกบันทึกใน Audit Log รวมถึงที่ทำโดย admin",
      // page-blacklist.js) — and silencing a warrant plate is squarely inside
      // that promise. `active` is logged in the same breath even though it is
      // the older switch: logging only the new one would produce a trail
      // asserting nobody ever disabled a plate, while a second door that leaves
      // no trace stayed open. A half-kept audit trail invites more misplaced
      // confidence than none at all.
      const changed = {};
      if (hasActive && row.was_active !== row.active) changed.active = row.active;
      if (hasNotify && row.was_notify !== row.notify_line) changed.notify_line = row.notify_line;
      if (hasGroup && row.was_group !== row.group_id) {
        changed.group_id = row.group_id;
        changed.group_from = row.was_group;
        // Worth its own line in the trail: pinning is what stops the roster
        // from putting the plate back, so it is a lasting decision about how
        // this plate behaves, not a display preference.
        changed.group_pinned = row.group_pinned;
      }
      if (Object.keys(changed).length) {
        await pool.query(
          `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
          [req.user?.id || null, req.user?.username || 'unknown', 'lpr_watchlist_update',
           JSON.stringify({ plate, changed, origin: row.origin, group_id: row.group_id, ip: req.ip })]
        ).catch(() => {});   // never fail the edit because the trail could not be written
      }
      delete row.was_active; delete row.was_notify; delete row.was_group;
      res.json(row);
    } catch (e) {
      console.error('[lpr-watchlist] PATCH:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Preview what a watch-list hit WOULD do, without doing any of it. Exists
  // because line_config.enabled is deliberately still false: the send path has
  // run twice against real hits and logged `line_disabled` both times, which
  // proves the wiring and tells you nothing about who would have received it or
  // what it would have said. This answers that, and stays useful afterwards —
  // "if this car passed that camera right now, whose phone buzzes?"
  //
  // Reads only. It runs the real sendLprAlert in dry mode rather than a copy of
  // its logic, because a copy is how a preview ends up agreeing with itself and
  // disagreeing with production.
  //
  // Admin-only: the reply contains watch-list notes (case officers' names and
  // phone numbers) and the LINE recipient list.
  app.post('/api/lpr/alert-preview', async (req, res) => {
    // unscoped: กันด้วย role !== 'admin' → 403 ที่บรรทัดถัดไป (ไม่ได้ใช้ requireAdmin middleware)
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'ต้องเป็นผู้ดูแลระบบเท่านั้น' });
    }
    const { event_id, plate: rawPlate, limit } = req.body || {};
    try {
      // Either replay one specific event, or sample the most recent real hits.
      // Sampling is the default because the question is usually "what do our
      // alerts look like", not "what about this one".
      const n = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
      const days = Math.min(Math.max(parseInt(req.body?.days, 10) || 7, 1), 90);

      // Driven from license_plates, not events. Watch-list hits run 4.6 a day
      // against 862,903 events a day, so scanning events backwards for six of
      // them means ~190,000 rows per hit — the first version of this query timed
      // out at 30s. license_plates is indexed on plate_number and detected_at,
      // which is also why every other watch-list query in lpr-query.js joins
      // this way. The time window is not optional for the same reason.
      const params = [days];
      let where = `lp.detected_at > now() - ($1 || ' days')::interval`;
      if (event_id) { params.push(parseInt(event_id, 10)); where += ` AND e.id = $${params.length}`; }
      if (rawPlate) { params.push(canonicalPlate(rawPlate, 'alert-preview')); where += ` AND UPPER(lp.plate_number) = $${params.length}`; }
      params.push(n);

      const { rows } = await pool.query(
        // ปิดบัง IP/MAC ของกล้องใน rawXml สำหรับผู้ที่ไม่ใช่ admin (security backlog
        // 2026-08-12 · S1 — เหมือน /api/lpr, commit d3fe320) · เส้นทางนี้มีด่าน admin
        // อยู่แล้วที่หัว route สาขาที่ไม่ใช่ admin จึงยังไปไม่ถึง — ใส่ไว้กันด่านนั้นหลุด
        `SELECT e.id, e.camera_id, e.event_time,
                ${req.user?.role === 'admin' ? 'e.raw_json' : `${scrubRawJsonSql('e.raw_json')} AS raw_json`},
                lp.plate_number, lp.region, lp.vehicle_type, lp.vehicle_color,
                w.group_id
           FROM license_plates lp
           JOIN events e ON e.id = lp.event_id
           JOIN lpr_watchlist w
             ON w.plate_number = UPPER(lp.plate_number) AND w.active
            AND (w.alert_mode <> 'plate_region' OR w.region = lp.region)
            AND ${watchSiteOk('w', 'e.camera_id')}
          WHERE ${where}
          ORDER BY lp.detected_at DESC
          LIMIT $${params.length}`, params);

      const previews = [];
      for (const row of rows) {
        previews.push(await lprLineAlert.sendLprAlert({
          pool, lineSender: null, dryRun: true,
          // license_plates is the canonical read; raw_json fills in whatever the
          // vendor sent that we did not columnise.
          event: { ...row.raw_json, ...row },
          plate: canonicalPlate(row.plate_number, 'alert-preview'),
          region: row.region || '',
          siteCode: null, groupId: row.group_id,
        }));
      }
      res.json({ sampled: rows.length, previews });
    } catch (e) {
      console.error('[lpr-watchlist] alert-preview:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Bulk delete. The caller sends the exact plates it displayed rather than a
  // filter for the server to re-evaluate: the operator confirmed a specific
  // list and a count, and a server-side re-derivation of "the current filter"
  // could quietly delete a different set than the one on screen.
  //
  // Admin-only, explicitly. /api/lpr as a whole is not behind
  // requireAdminForWrites (unlike /api/blacklist), and while removing one plate
  // is recoverable, clearing the roster in a single request is not the kind of
  // thing that should inherit that looser posture. Existing per-plate routes
  // are left as they are — tightening them is a separate decision.
  app.post('/api/lpr/watchlist/bulk-delete', async (req, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'ต้องเป็นผู้ดูแลระบบเท่านั้น' });
    }
    const { plates, confirm } = req.body || {};
    if (confirm !== 'CONFIRM') {
      return res.status(400).json({ error: 'ต้องพิมพ์ CONFIRM เพื่อยืนยันการลบข้อมูลถาวร' });
    }
    if (!Array.isArray(plates) || !plates.length) {
      return res.status(400).json({ error: 'plates required' });
    }
    const canon = [...new Set(plates.map(p => canonicalPlate(p, 'BULK')).filter(Boolean))];
    if (!canon.length) return res.status(400).json({ error: 'no usable plate numbers' });
    try {
      // Counted before the delete: how many of these the bridge will simply
      // re-create at the next sync. The operator is told, not stopped — an
      // empty roster until the next sync is a legitimate thing to want.
      const bridged = await pool.query(
        `SELECT COUNT(*)::int n FROM lpr_watchlist
          WHERE plate_number = ANY($1) AND origin = 'blacklist_bridge'`, [canon]);
      const r = await pool.query('DELETE FROM lpr_watchlist WHERE plate_number = ANY($1)', [canon]);
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'lpr_watchlist_bulk_delete',
         JSON.stringify({ requested: canon.length, deleted: r.rowCount,
                          from_bridge: bridged.rows[0].n, ip: req.ip })]
      ).catch(() => {});
      console.warn(`[lpr-watchlist] bulk delete by ${req.user?.username || 'unknown'}: ${r.rowCount} row(s), ${bridged.rows[0].n} of them bridge-managed`);
      res.json({ ok: true, deleted: r.rowCount, from_bridge: bridged.rows[0].n });
    } catch (e) {
      console.error('[lpr-watchlist] bulk delete:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/lpr/watchlist/:plate', async (req, res) => {
    const plate = canonicalPlate(req.params.plate, 'DELETE');
    try {
      await pool.query('DELETE FROM lpr_watchlist WHERE plate_number = $1', [plate]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[lpr-watchlist] DELETE:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });
};
