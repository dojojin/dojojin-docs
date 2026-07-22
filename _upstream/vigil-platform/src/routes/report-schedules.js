// ============================================================
// Vigil Platform — Routes: Report Schedules + Run
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const http = require('http');
const routeError = require('../helpers/routeError');
const normalizeTimeOfDay = require('../helpers/normalizeTimeOfDay');

const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'health'];
const REPORT_FAMILIES = ['analytics', 'health', 'face', 'lpr'];
const HEALTH_SECTION_KEYS = ['camera_status', 'camera_uptime', 'alerts', 'storage', 'system'];

function normalizeHealthSections(v) {
  if (!Array.isArray(v) || v.length === 0) return null;
  const expanded = [];
  for (const key of v) {
    if (key === 'cameras') expanded.push('camera_status', 'camera_uptime');
    else expanded.push(String(key));
  }
  const cleaned = [...new Set(expanded)].filter(k => HEALTH_SECTION_KEYS.includes(k));
  return cleaned.length ? cleaned : null;
}

function normalizeSendDayOfWeek(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0 || n > 6) {
    throw new Error('send_day_of_week must be 0..6 (0=Mon..6=Sun) or null');
  }
  return n;
}

function normalizeSendDaysOfMonth(v) {
  if (v === undefined || v === null || v === '') return null;
  const tokens = String(v).split(',').map(x => x.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const cleaned = [];
  for (const t of tokens) {
    if (t.toUpperCase() === 'L') { cleaned.push('L'); continue; }
    const n = parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1 || n > 31) {
      throw new Error('send_days_of_month tokens must be 1..31 or "L"');
    }
    cleaned.push(String(n));
  }
  // Dedupe + canonical order (numeric asc, L last) so the same selection
  // always stores the same string regardless of UI click order.
  const uniq = [...new Set(cleaned)];
  uniq.sort((a, b) => {
    if (a === 'L') return 1;
    if (b === 'L') return -1;
    return parseInt(a, 10) - parseInt(b, 10);
  });
  return uniq.join(',');
}

module.exports = function reportSchedulesRoutes(app, pool, { WORKER_PORT, INTERNAL_API_TOKEN }) {

  app.get('/api/report-schedules', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM report_schedules ORDER BY id');
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/report-schedules'); }
  });

  app.post('/api/report-schedules', async (req, res) => {
    try {
      const { report_type, enabled = true, send_time, recipients = '', image_layout = 'compact' } = req.body;
      if (!REPORT_TYPES.includes(report_type)) {
        return res.status(400).json({ error: 'report_type must be daily|weekly|monthly|health' });
      }
      // R4: infer family from request, or fallback to legacy (health type → health family)
      const report_family = req.body.report_family || (report_type === 'health' ? 'health' : 'analytics');
      if (!REPORT_FAMILIES.includes(report_family)) {
        return res.status(400).json({ error: 'report_family must be analytics|health|face|lpr' });
      }
      const isHealth = report_family === 'health';
      const isFaceOrLpr = report_family === 'face' || report_family === 'lpr';
      // image_layout: only for analytics; null for health/face/lpr
      const resolvedLayout = isHealth || isFaceOrLpr ? null : (image_layout || 'compact');
      if (!resolvedLayout && !isHealth && !isFaceOrLpr && !['compact', 'full'].includes(resolvedLayout)) {
        return res.status(400).json({ error: 'image_layout must be compact|full' });
      }
      let st;
      try { st = normalizeTimeOfDay(send_time); }
      catch (e) { return res.status(400).json({ error: 'send_time: ' + e.message }); }
      if (!st) return res.status(400).json({ error: 'send_time required' });
      let sdow, sdom;
      try {
        sdow = normalizeSendDayOfWeek(req.body.send_day_of_week);
        sdom = normalizeSendDaysOfMonth(req.body.send_days_of_month);
      } catch (e) { return res.status(400).json({ error: e.message }); }
      const healthSections = isHealth ? normalizeHealthSections(req.body.health_sections) : null;
      const section_config = (isFaceOrLpr && req.body.section_config) ? req.body.section_config : null;
      const site_id = req.body.site_id != null ? (parseInt(req.body.site_id) || null) : null;
      const { rows } = await pool.query(
        `INSERT INTO report_schedules (report_type, enabled, send_time, recipients, image_layout,
                                       send_day_of_week, send_days_of_month, health_sections, report_family, section_config, site_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [report_type, !!enabled, st, String(recipients || '').trim(), resolvedLayout, sdow, sdom, healthSections ? JSON.stringify(healthSections) : null, report_family, section_config ? JSON.stringify(section_config) : null, site_id]
      );
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'POST /api/report-schedules'); }
  });

  app.put('/api/report-schedules/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = [];
      const values = [];
      let idx = 1;
      if (req.body.report_type !== undefined) {
        if (!REPORT_TYPES.includes(req.body.report_type)) {
          return res.status(400).json({ error: 'report_type must be daily|weekly|monthly|health' });
        }
        updates.push(`report_type = $${idx++}`); values.push(req.body.report_type);
      }
      if (req.body.enabled !== undefined) {
        updates.push(`enabled = $${idx++}`); values.push(!!req.body.enabled);
      }
      if (req.body.send_time !== undefined) {
        let st;
        try { st = normalizeTimeOfDay(req.body.send_time); }
        catch (e) { return res.status(400).json({ error: 'send_time: ' + e.message }); }
        if (!st) return res.status(400).json({ error: 'send_time cannot be empty' });
        updates.push(`send_time = $${idx++}`); values.push(st);
      }
      if (req.body.recipients !== undefined) {
        updates.push(`recipients = $${idx++}`); values.push(String(req.body.recipients || '').trim());
      }
      if (req.body.image_layout !== undefined && req.body.image_layout !== null) {
        if (!['compact', 'full'].includes(req.body.image_layout)) {
          return res.status(400).json({ error: 'image_layout must be compact|full' });
        }
        updates.push(`image_layout = $${idx++}`); values.push(req.body.image_layout);
      }
      if (req.body.health_sections !== undefined) {
        const hs = normalizeHealthSections(req.body.health_sections);
        updates.push(`health_sections = $${idx++}`); values.push(hs ? JSON.stringify(hs) : null);
      }
      if (req.body.send_day_of_week !== undefined) {
        let sdow;
        try { sdow = normalizeSendDayOfWeek(req.body.send_day_of_week); }
        catch (e) { return res.status(400).json({ error: e.message }); }
        updates.push(`send_day_of_week = $${idx++}`); values.push(sdow);
      }
      if (req.body.send_days_of_month !== undefined) {
        let sdom;
        try { sdom = normalizeSendDaysOfMonth(req.body.send_days_of_month); }
        catch (e) { return res.status(400).json({ error: e.message }); }
        updates.push(`send_days_of_month = $${idx++}`); values.push(sdom);
      }
      // R4: report_family
      if (req.body.report_family !== undefined) {
        if (!REPORT_FAMILIES.includes(req.body.report_family)) {
          return res.status(400).json({ error: 'report_family must be analytics|health|face|lpr' });
        }
        updates.push(`report_family = $${idx++}`); values.push(req.body.report_family);
      }
      // R4: section_config
      if (req.body.section_config !== undefined) {
        updates.push(`section_config = $${idx++}`);
        values.push(req.body.section_config != null ? JSON.stringify(req.body.section_config) : null);
      }
      // R5: site_id
      if (req.body.site_id !== undefined) {
        updates.push(`site_id = $${idx++}`);
        values.push(req.body.site_id != null ? (parseInt(req.body.site_id) || null) : null);
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(id);
      const { rows } = await pool.query(
        `UPDATE report_schedules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) return res.status(404).json({ error: 'schedule not found' });
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'PUT /api/report-schedules/:id'); }
  });

  app.delete('/api/report-schedules/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM report_schedules WHERE id = $1', [parseInt(req.params.id)]);
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'DELETE /api/report-schedules/:id'); }
  });

  // POST /api/report-schedules/:id/run — manual "run now"
  // api-server owns the 404 check; proxies to report-worker (fire-and-forget inside worker).
  app.post('/api/report-schedules/:id/run', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { rows } = await pool.query('SELECT * FROM report_schedules WHERE id = $1', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Schedule not found' });

      await new Promise((resolve, reject) => {
        const workerReq = http.request(
          { host: '127.0.0.1', port: WORKER_PORT, path: `/run/${id}`, method: 'POST',
            headers: { 'X-Internal-Token': INTERNAL_API_TOKEN }, timeout: 5000 },
          (workerRes) => {
            workerRes.resume();
            if (workerRes.statusCode === 200) resolve();
            else reject(Object.assign(new Error(`worker ${workerRes.statusCode}`), { workerStatus: workerRes.statusCode }));
          }
        );
        workerReq.on('timeout', () => {
          workerReq.destroy();
          reject(Object.assign(new Error('worker timeout'), { workerStatus: 503 }));
        });
        workerReq.on('error', (e) => reject(Object.assign(e, { workerStatus: 503 })));
        workerReq.end();
      });

      res.json({ ok: true });
    } catch (e) {
      if (e.workerStatus === 503) {
        return res.status(503).json({ error: 'Report worker is not available — try again shortly' });
      }
      routeError(res, e, 'POST /api/report-schedules/:id/run');
    }
  });
};
