// ============================================================
// Vigil Platform — Routes: Alert Rules
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const normalizeTimeOfDay = require('../helpers/normalizeTimeOfDay');

module.exports = function alertRulesRoutes(app, pool) {

  // ── Alert Rules (CRUD) ──────────────────────────────────────
  app.get('/api/alert-rules', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM alert_rules ORDER BY enabled DESC, id DESC');
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/alert-rules'); }
  });

  app.post('/api/alert-rules', async (req, res) => {
    try {
      const {
        name, enabled = true,
        camera_ids = [], rule_names = [], recipient_ids = [],
        cooldown_seconds = 60, send_snapshot = true, push_user_ids = [],
        message_template, active_from, active_to, dwell_threshold_sec,
        list_types = null
      } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
      // dwell threshold (044): int > 0 หรือ NULL (= rule ปกติ)
      const dwellSec = parseInt(dwell_threshold_sec, 10) > 0 ? parseInt(dwell_threshold_sec, 10) : null;
      // min likelihood (045): 0 < x <= 1 หรือ NULL
      const minLh = (() => {
        const v = parseFloat(req.body.min_likelihood);
        return Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
      })();
      let af, at;
      try { af = normalizeTimeOfDay(active_from); at = normalizeTimeOfDay(active_to); }
      catch (e) { return res.status(400).json({ error: 'active window: ' + e.message }); }
      // Default template: {camera} renders real camera name, {location} install location.
      const tpl = message_template
        || '🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}\n👤 {object_class} ({likelihood})';
      const { rows } = await pool.query(
        `INSERT INTO alert_rules (name, enabled, camera_ids, rule_names, recipient_ids,
          cooldown_seconds, send_snapshot, push_user_ids, message_template, active_from, active_to,
          dwell_threshold_sec, min_likelihood, list_types)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [name.trim(), enabled, camera_ids, rule_names, recipient_ids, cooldown_seconds, send_snapshot, push_user_ids, tpl, af, at, dwellSec, minLh,
         Array.isArray(list_types) && list_types.length > 0 ? list_types : null]
      );
      pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'POST /api/alert-rules'); }
  });

  app.put('/api/alert-rules/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const fields = ['name', 'enabled', 'camera_ids', 'rule_names', 'recipient_ids',
                      'cooldown_seconds', 'send_snapshot', 'push_user_ids', 'message_template'];
      const updates = [];
      const values = [];
      let idx = 1;
      for (const f of fields) {
        if (req.body[f] !== undefined) {
          updates.push(`${f} = $${idx++}`);
          values.push(req.body[f]);
        }
      }
      // list_types (047): ว่าง/[] → NULL (= ไม่กรอง)
      if (req.body.list_types !== undefined) {
        const lt = req.body.list_types;
        updates.push(`list_types = $${idx++}`);
        values.push(Array.isArray(lt) && lt.length > 0 ? lt : null);
      }
      // dwell threshold (044): int > 0 หรือ NULL (ส่งค่าว่าง/0 = ปิด dwell mode)
      if (req.body.dwell_threshold_sec !== undefined) {
        const ds = parseInt(req.body.dwell_threshold_sec, 10);
        updates.push(`dwell_threshold_sec = $${idx++}`);
        values.push(ds > 0 ? ds : null);
      }
      // min likelihood (045): 0 < x <= 1 หรือ NULL (ว่าง/0 = ไม่กรอง)
      if (req.body.min_likelihood !== undefined) {
        const v = parseFloat(req.body.min_likelihood);
        updates.push(`min_likelihood = $${idx++}`);
        values.push(Number.isFinite(v) && v > 0 && v <= 1 ? v : null);
      }
      // active_from / active_to need normalization (HH:MM, empty → NULL),
      // so they're handled outside the generic field loop.
      for (const f of ['active_from', 'active_to']) {
        if (req.body[f] !== undefined) {
          let v;
          try { v = normalizeTimeOfDay(req.body[f]); }
          catch (e) { return res.status(400).json({ error: `${f}: ${e.message}` }); }
          updates.push(`${f} = $${idx++}`);
          values.push(v);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(id);
      const { rows } = await pool.query(
        `UPDATE alert_rules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
      pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'PUT /api/alert-rules/:id'); }
  });

  app.delete('/api/alert-rules/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await pool.query('DELETE FROM alert_rules WHERE id = $1', [id]);
      pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'DELETE /api/alert-rules/:id'); }
  });

  // ── Helper: ดึง rule_names ที่มีใน DB (สำหรับ UI dropdown) ─
  app.get('/api/alert-rules-suggestions', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT DISTINCT rule_name FROM events
        WHERE rule_name IS NOT NULL AND rule_name != ''
          AND event_time > NOW() - INTERVAL '30 days'
        ORDER BY rule_name
      `);
      // Bosch tampering rule names เป็น synthetic (ยิงผ่าน alert_event โดยไม่
      // แก้ events.rule_name) — เติม static ให้เลือกตั้ง rule ได้ก่อน fire ครั้งแรก
      const TAMPER_NAMES = ['Camera Tampering (Scene Change)', 'Camera Tampering (Defocus)',
        'Camera Tampering (Image Dark)', 'Camera Tampering (Image Bright)', 'Camera Tampering (Covered)'];
      res.json([...new Set([...rows.map(r => r.rule_name), ...TAMPER_NAMES])].sort());
    } catch (e) { routeError(res, e, 'GET /api/alert-rules-suggestions'); }
  });
};
