// ============================================================
// Vigil Platform — Routes: AuraFace-v1 Blacklist (Internal Test & Development)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// Deliberately separate from faces.js / /api/face-matches: that route hard-
// filters event_type IN ('FaceRecognition','FaceDetector/Comparison'), but
// AuraFace-v1's source events are 'FaceCapture' — widening that shared
// filter would touch every production HCP-native query in faces.js for a
// pipeline that's explicitly Internal Test Only (owner decision, 2026-08-10).
// See db_migration_134_face_blacklist_hits.sql for the durable-write side
// (face-embed-worker.js writes here on match, alongside its LINE pg_notify).

'use strict';
const { auditChange } = require('../helpers/auditTrail');

const { visibleSites, bodySiteId } = require('../helpers/watchScope');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const routeError = require('../helpers/routeError');
const { siteWhere } = require('../auth');
const { edgeCall } = require('../helpers/edgeCall');
const { assertImageBuffer } = require('../helpers/imageMagic');
const bridge = require('../helpers/blacklistFaceBridge');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

module.exports = function faceBlacklistRoutes(app, pool, { SNAPSHOT_DIR }) {
  // Same layout convention as lpr_watchlist's ref_image: a snapshots subdir,
  // auth-gated via /snapshots/, skipped by retention (top-level scan only).
  const refDir = path.join(SNAPSHOT_DIR, 'face-blacklist');

  // ── Hits — matches AuraFace-v1 has actually fired on ────────
  app.get('/api/face-blacklist/hits', async (req, res) => {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit,  10) || 60));
    const offset = Math.max(0,                parseInt(req.query.offset, 10) || 0);
    try {
      const clauses = ['1=1'];
      const params = [];
      let n = 0;
      if (req.query.from) { clauses.push(`h.event_time >= $${++n}`); params.push(req.query.from); }
      if (req.query.to)   { clauses.push(`h.event_time <= $${++n}`); params.push(req.query.to); }
      const sw = siteWhere(req.user?.allowedSites ?? null, 'h.camera_id', n + 1);
      if (sw.sql) { clauses.push(sw.sql.replace(/^AND /, '')); params.push(...sw.args); n += sw.args.length; }
      const where = clauses.join(' AND ');
      const { rows } = await pool.query(
        `SELECT h.id, h.event_id, h.event_time, h.camera_id, h.camera_name,
                h.blacklist_id, h.label, h.similarity, h.snapshot_filename,
                COUNT(*) OVER() ::int AS _total
           FROM face_blacklist_hits h
          WHERE ${where}
          ORDER BY h.event_time DESC, h.id DESC
          LIMIT $${++n} OFFSET $${++n}`,
        [...params, limit, offset]);
      res.set('X-Total-Count', String(rows[0] ? rows[0]._total : 0));
      res.json(rows.map(({ _total, ...row }) => row));
    } catch (err) { routeError(res, err, 'GET /api/face-blacklist/hits'); }
  });

  // ── Hit detail — enriches with the source event's face attributes for the
  // detail modal (gender/age/expression/full scene). Not on the list query:
  // only needed once, on click. Composite (event_id, event_time) hits the
  // events partition directly instead of scanning — see migration 134.
  app.get('/api/face-blacklist/hits/:id', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT h.id, h.event_id, h.event_time, h.camera_id, h.camera_name,
                h.blacklist_id, h.label, h.similarity, h.snapshot_filename,
                e.raw_json->>'gender' AS gender, e.raw_json->>'age' AS age,
                e.raw_json->>'faceExpression' AS expression,
                e.raw_json->>'_snapshot_full' AS snapshot_full,
                e.raw_json->'faceRect' AS face_rect,
                fb.ref_image AS ref_image, sr.photo_path AS ref_photo_path
           FROM face_blacklist_hits h
           LEFT JOIN events e ON e.id = h.event_id AND e.event_time = h.event_time
           LEFT JOIN face_blacklist fb ON fb.id = h.blacklist_id
           LEFT JOIN blacklist.source_records sr ON sr.id::text = fb.enrolled_ref
          WHERE h.id = $1`,
        [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'GET /api/face-blacklist/hits/:id'); }
  });

  // ── Roster — who's enrolled into face_blacklist ─────────────
  app.get('/api/face-blacklist/roster', async (req, res) => {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit,  10) || 60));
    const offset = Math.max(0,                parseInt(req.query.offset, 10) || 0);
    try {
      // กลุ่มเฉพาะ Site (migration 261) — ผู้ใช้ที่ถูกจำกัด Site เห็น Global + ของตัวเอง
      const params = [visibleSites(req)];
      let n = 1;
      const clauses = ['($1::int[] IS NULL OR g.site_id IS NULL OR g.site_id = ANY($1))'];
      if (req.query.q) { clauses.push(`fb.label ILIKE $${++n}`); params.push(`%${req.query.q}%`); }
      if (req.query.group) { clauses.push(`fb.group_id = $${++n}`); params.push(req.query.group); }
      const where = clauses.join(' AND ');
      const { rows } = await pool.query(
        `SELECT fb.id, fb.label, fb.model_name, fb.active, fb.created_at,
                fb.group_id, fb.notify_line, fb.notes, fb.ref_image,
                g.name AS group_name, g.color AS group_color,
                sr.photo_path AS ref_photo_path,
                COUNT(*) OVER() ::int AS _total
           FROM face_blacklist fb
           LEFT JOIN face_blacklist_groups g ON g.id = fb.group_id
           LEFT JOIN blacklist.source_records sr ON sr.id::text = fb.enrolled_ref
          WHERE ${where}
          ORDER BY fb.active DESC, fb.created_at DESC, fb.id DESC
          LIMIT $${++n} OFFSET $${++n}`,
        [...params, limit, offset]);
      res.set('X-Total-Count', String(rows[0] ? rows[0]._total : 0));
      res.json(rows.map(({ _total, ...row }) => row));
    } catch (err) { routeError(res, err, 'GET /api/face-blacklist/roster'); }
  });

  // ── Roster detail — for the click-through modal, PDPA hide-face toggle ──
  app.get('/api/face-blacklist/roster/:id', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT fb.id, fb.label, fb.active, fb.created_at, fb.group_id, fb.notify_line,
                fb.notes, fb.ref_image, fb.enrolled_ref,
                g.name AS group_name, g.color AS group_color,
                sr.photo_path AS ref_photo_path
           FROM face_blacklist fb
           LEFT JOIN face_blacklist_groups g ON g.id = fb.group_id
           LEFT JOIN blacklist.source_records sr ON sr.id::text = fb.enrolled_ref
          WHERE fb.id = $1 AND ($2::int[] IS NULL OR g.site_id IS NULL OR g.site_id = ANY($2))`,
        [req.params.id, visibleSites(req)]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'GET /api/face-blacklist/roster/:id'); }
  });

  // ── Roster — toggle active (stop/resume matching a specific person without deleting) ──
  app.put('/api/face-blacklist/roster/:id/active', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE face_blacklist SET active = $1, updated_at = now() WHERE id = $2 RETURNING id, active`,
        [!!req.body?.active, req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'PUT /api/face-blacklist/roster/:id/active'); }
  });

  // ── Roster — edit group/notes/notify_line on an existing entry ──
  app.put('/api/face-blacklist/roster/:id', async (req, res) => {
    const { group_id, notes, notify_line } = req.body || {};
    const sets = [], vals = [];
    if (group_id !== undefined) { vals.push(group_id || null); sets.push(`group_id = $${vals.length}`); }
    if (notes !== undefined)    { vals.push((notes || '').trim() || null); sets.push(`notes = $${vals.length}`); }
    if (notify_line !== undefined) { vals.push(!!notify_line); sets.push(`notify_line = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    sets.push('updated_at = now()');
    vals.push(req.params.id);
    try {
      const { rows } = await pool.query(
        `UPDATE face_blacklist SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, group_id, notes, notify_line`,
        vals);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'PUT /api/face-blacklist/roster/:id'); }
  });

  // ── Reference photo upload — embeds via the edge FIRST (no point saving a
  // file with no usable face), then saves a display-size copy. Magic-byte
  // validated (Content-Type is spoofable) — GOTCHAS #50-57 / SEC-005. The check
  // itself lives in helpers/imageMagic.js so every upload gate shares one copy.
  app.post('/api/face-blacklist/roster/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'image file required (field: "image")' });
    const buf = req.file.buffer;
    try { assertImageBuffer(buf); }
    catch (e) { return res.status(415).json({ error: e.message }); }
    try {
      const embedRes = await edgeCall('hkt', '/face-engine-embed-query', { image_b64: buf.toString('base64') }, 20000);
      if (embedRes.code === 200 && embedRes.body?.ok === false) {
        return res.status(422).json({ error: embedRes.body.error || 'ไม่พบใบหน้าในภาพ' });
      }
      if (embedRes.code !== 200 || !embedRes.body?.ok) {
        return res.status(502).json({ error: embedRes.body?.error || 'embed failed' });
      }
      fs.mkdirSync(refDir, { recursive: true });
      const outName = `fb_${Date.now()}.jpg`;
      await sharp(buf, { failOn: 'none' })
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(path.join(refDir, outName));
      res.json({ ref_image: `face-blacklist/${outName}`, embedding: embedRes.body.embedding, dim: embedRes.body.dim });
    } catch (err) { routeError(res, err, 'POST /api/face-blacklist/roster/upload'); }
  });

  // ── Manual enroll — creates a face_blacklist row from an already-uploaded
  // photo (call /roster/upload first to get embedding + ref_image).
  app.post('/api/face-blacklist/roster', async (req, res) => {
    const { label, group_id, notes, notify_line, ref_image, embedding, dim } = req.body || {};
    if (!label || !String(label).trim()) return res.status(400).json({ error: 'label required' });
    if (!Array.isArray(embedding) || !dim) return res.status(400).json({ error: 'embedding required — upload a photo first' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO face_blacklist
           (site_id, label, model_name, dim, embedding, active, created_by, group_id, notes, notify_line, ref_image)
         VALUES ('hkt',$1,'auraface-v1',$2,$3,true,$4,$5,$6,$7,$8) RETURNING id`,
        [String(label).trim(), dim, embedding, req.user?.username || 'manual',
         group_id || null, (notes || '').trim() || null, notify_line !== false, ref_image || null]);
      res.status(201).json(rows[0]);
    } catch (err) { routeError(res, err, 'POST /api/face-blacklist/roster'); }
  });

  // ── Groups ────────────────────────────────────────────────
  app.get('/api/face-blacklist/groups', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT g.id, g.name, g.color, g.notify_line, g.site_id,
                COUNT(fb.id) ::int AS member_count
           FROM face_blacklist_groups g
           LEFT JOIN face_blacklist fb ON fb.group_id = g.id
          WHERE ($1::int[] IS NULL OR g.site_id IS NULL OR g.site_id = ANY($1))
          GROUP BY g.id ORDER BY g.created_at`, [visibleSites(req)]);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/face-blacklist/groups'); }
  });

  app.post('/api/face-blacklist/groups', async (req, res) => {
    const { name, color } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const site = bodySiteId(req.body);
    if (site.error) return res.status(400).json({ error: site.error });
    const id = 'g' + Date.now().toString(36);
    try {
      const { rows } = await pool.query(
        `INSERT INTO face_blacklist_groups (id, name, color, site_id) VALUES ($1,$2,$3,$4) RETURNING id, name, color, notify_line, site_id`,
        [id, String(name).trim(), (color || '#5b8def').trim(), site.value ?? null]);
      await auditChange(req, 'face_list_group_create', { after: rows[0], target: id });
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23503') return res.status(400).json({ error: 'unknown site_id' });
      routeError(res, err, 'POST /api/face-blacklist/groups');
    }
  });

  // Master switch for LINE alerts on this group — off by default, same
  // convention as lpr_watchlist_groups.notify_line (lpr-watchlist.js).
  app.patch('/api/face-blacklist/groups/:id', async (req, res) => {
    const { name, color, notify_line } = req.body || {};
    const sets = [], vals = [];
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'name required' });
      vals.push(String(name).trim()); sets.push(`name = $${vals.length}`);
    }
    if (color !== undefined) { vals.push((color || '#5b8def').trim()); sets.push(`color = $${vals.length}`); }
    if (notify_line !== undefined) { vals.push(!!notify_line); sets.push(`notify_line = $${vals.length}`); }
    const site = bodySiteId(req.body);
    if (site.error) return res.status(400).json({ error: site.error });
    if (site.present) { vals.push(site.value); sets.push(`site_id = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    vals.push(req.params.id);
    try {
      const { rows: before } = await pool.query('SELECT id, name, color, notify_line, site_id FROM face_blacklist_groups WHERE id = $1', [req.params.id]);
      const { rows } = await pool.query(
        `UPDATE face_blacklist_groups SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, name, color, notify_line, site_id`,
        vals);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await auditChange(req, 'face_list_group_update', { before: before[0], after: rows[0], target: req.params.id });
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'PATCH /api/face-blacklist/groups/:id'); }
  });

  app.delete('/api/face-blacklist/groups/:id', async (req, res) => {
    try {
      // เหตุผลเดียวกับกลุ่มป้ายทะเบียน: FK เป็น SET NULL → คนในกลุ่มเฉพาะ Site กลายเป็น Global
      const { rows: chk } = await pool.query(
        `SELECT g.site_id, (SELECT count(*) FROM face_blacklist fb WHERE fb.group_id = g.id)::int AS n
           FROM face_blacklist_groups g WHERE g.id = $1`, [req.params.id]);
      if (chk[0] && chk[0].site_id != null && chk[0].n > 0) {
        return res.status(409).json({ error: 'site list still has people — move or delete them first', count: chk[0].n });
      }
      const { rows: gone } = await pool.query('DELETE FROM face_blacklist_groups WHERE id = $1 RETURNING *', [req.params.id]);
      if (gone[0]) await auditChange(req, 'face_list_group_delete', { before: gone[0], target: req.params.id });
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/face-blacklist/groups/:id'); }
  });

  // ── FB5 — blacklist reservoir -> face_blacklist bridge ───────
  // Same route shape as /api/blacklist/bridge/* (blacklist-sources.js, LPR) —
  // see blacklistFaceBridge.js's header for what genuinely differs.
  app.get('/api/face-blacklist/bridge/rules', async (req, res) => {
    try {
      const rules = await pool.query(`
        SELECT r.*, s.label AS source_label, s.source_type, s.site_code,
               g.name AS target_group_name, g.color AS target_group_color
          FROM blacklist.face_bridge_rules r
          JOIN blacklist.sources s ON s.id = r.source_id
          LEFT JOIN face_blacklist_groups g ON g.id = r.target_group_id
         ORDER BY r.id`);
      const groups = await pool.query(
        'SELECT id, name, color FROM face_blacklist_groups ORDER BY created_at');
      const facets = await pool.query(`
        SELECT r.source_id, COALESCE(r.raw_json->>'group_name', '__none__') AS group_name,
               COUNT(*) AS n
          FROM blacklist.source_records r
         WHERE r.data_type = 'face'
         GROUP BY 1, 2 ORDER BY 1, 3 DESC`);
      const live = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE origin = 'blacklist_bridge') AS bridged,
               COUNT(*) FILTER (WHERE origin <> 'blacklist_bridge') AS manual
          FROM face_blacklist`);
      const d = await bridge.diffFace(pool, null);
      const pendingMasters = await bridge.unconfirmedFaceRemovals(pool, d.remove.map(r => r.blacklist_master_id));
      const lastSync = await pool.query(`
        SELECT MAX(s.last_face_bridge_sync_at) AS t
          FROM blacklist.sources s JOIN blacklist.face_bridge_rules r ON r.source_id = s.id
         WHERE r.active`);
      res.json({
        rules: rules.rows,
        groups: groups.rows,
        facets: facets.rows.map(f => ({ ...f, n: Number(f.n) })),
        roster: { bridged: Number(live.rows[0].bridged), manual: Number(live.rows[0].manual) },
        pending: { count: pendingMasters.length, masters: pendingMasters.slice(0, 50) },
        last_sync_at: lastSync.rows[0]?.t || null,
      });
    } catch (err) { routeError(res, err, 'GET /api/face-blacklist/bridge/rules'); }
  });

  app.post('/api/face-blacklist/bridge/rules', async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.source_id) return res.status(400).json({ error: 'source_id required' });
      const { rows } = await pool.query(`
        INSERT INTO blacklist.face_bridge_rules
          (source_id, group_names, external_ids, target_group_id, notify_line, active, label, created_by)
        VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE),$7,$8) RETURNING *`,
        [b.source_id, b.group_names || null, b.external_ids || null,
         b.target_group_id || null, !!b.notify_line, b.active, b.label || null,
         req.user?.username || null]);
      res.status(201).json(rows[0]);
    } catch (err) { routeError(res, err, 'POST /api/face-blacklist/bridge/rules'); }
  });

  app.put('/api/face-blacklist/bridge/rules/:id', async (req, res) => {
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
        `UPDATE blacklist.face_bridge_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'PUT /api/face-blacklist/bridge/rules/:id'); }
  });

  app.delete('/api/face-blacklist/bridge/rules/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM blacklist.face_bridge_rules WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/face-blacklist/bridge/rules/:id'); }
  });

  app.get('/api/face-blacklist/bridge/preview', async (req, res) => {
    try {
      const ids = req.query.rule_ids
        ? String(req.query.rule_ids).split(',').map(s => s.trim()).filter(Boolean) : null;
      const d = await bridge.diffFace(pool, ids);
      res.json({
        add: d.add.slice(0, 200), update: d.update.slice(0, 200),
        remove: d.remove.slice(0, 200), skipped: d.skipped.slice(0, 200),
        counts: {
          add: d.add.length, update: d.update.length, remove: d.remove.length,
          skipped_manual: d.skipped.length,
          desired_total: d.desired_total, current_total: d.current_total,
        },
        partial: d.partial,
        truncated: d.add.length > 200 || d.remove.length > 200,
      });
    } catch (err) { routeError(res, err, 'GET /api/face-blacklist/bridge/preview'); }
  });

  // Requires the operator to echo the exact add/remove counts they were
  // shown — same stale-preview guard as the LPR bridge's /bridge/sync.
  app.post('/api/face-blacklist/bridge/sync', async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.rule_ids) && req.body.rule_ids.length
        ? req.body.rule_ids : null;
      const d = await bridge.diffFace(pool, ids);
      const c = req.body?.confirm || {};
      if (Number(c.add) !== d.add.length || Number(c.remove) !== d.remove.length) {
        return res.status(409).json({
          error: 'รายการเปลี่ยนไปหลังจากที่คุณตรวจสอบ — กรุณาดูรายการใหม่แล้วยืนยันอีกครั้ง',
          counts: { add: d.add.length, remove: d.remove.length },
        });
      }
      const result = await bridge.syncFace(pool, ids, req.user);
      res.json({ ok: true, partial: d.partial, ...result });
    } catch (err) { routeError(res, err, 'POST /api/face-blacklist/bridge/sync'); }
  });
};
