// ============================================================
// Vigil Platform — Routes: Report Schedules + Run
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const { auditChange } = require('../helpers/auditTrail');

const http = require('http');
const routeError = require('../helpers/routeError');
const normalizeTimeOfDay = require('../helpers/normalizeTimeOfDay');
const { validateApprovedTelegramChatIds } = require('../helpers/reportTelegramLeg');

const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'summary', 'health'];
const REPORT_FAMILIES = ['analytics', 'health', 'face', 'lpr'];
const HEALTH_SECTION_KEYS = ['camera_status', 'camera_uptime', 'alerts', 'storage', 'system'];

// T5: telegram_chat_ids ต้องเป็นแชทที่ "อนุมัติแล้ว" เท่านั้น — validateApprovedTelegramChatIds
// (helpers/reportTelegramLeg.js) ใช้ร่วมกับ routes/reports.js + routes/health-reporting.js
async function normalizeTelegramChatIds(pool, v) {
  try { return await validateApprovedTelegramChatIds(pool, v); }
  catch (e) { throw new Error(`telegram_chat_ids: ${e.message}`); }
}

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

function normalizeSectionConfig(sc) {
  if (!sc || typeof sc !== 'object') return null;
  // Validate tod if present: must be {from, to} matching HH:MM on 30-min steps with from < to
  if (sc.tod) {
    if (typeof sc.tod !== 'object' || !sc.tod.from || !sc.tod.to) {
      throw new Error('section_config.tod must be {from, to} with HH:MM strings');
    }
    const timeRegex = /^([01]\d|2[0-3]):(00|30)$/;
    if (!timeRegex.test(sc.tod.from) || !timeRegex.test(sc.tod.to)) {
      throw new Error('section_config.tod from/to must be HH:MM on 30-minute steps');
    }
    if (sc.tod.from >= sc.tod.to) {
      throw new Error('section_config.tod from must be before to');
    }
  }
  return sc;
}

module.exports = function reportSchedulesRoutes(app, pool, { WORKER_PORT, INTERNAL_API_TOKEN }) {

  app.get('/api/report-schedules', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM report_schedules ORDER BY id');
      // Site Admin เห็นเฉพาะตารางรายงานของไซต์ตัวเอง
      if (req.user?.role === 'site_admin') {
        const mine = new Set(Array.from(req.user.allowedSites || [], Number));
        return res.json(rows.filter(r => r.site_id != null && mine.has(Number(r.site_id))));
      }
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/report-schedules'); }
  });

  app.post('/api/report-schedules', async (req, res) => {
    try {
      const { report_type, enabled = true, send_time, recipients = '', image_layout = 'compact' } = req.body;
      if (!REPORT_TYPES.includes(report_type)) {
        return res.status(400).json({ error: `report_type must be one of: ${REPORT_TYPES.join('|')}` });
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
      // section_config carries the face/lpr section toggles and, since 2026-08-23, the
      // analytics option set (domains/kpis/catsort/title/tod). It used to be gated on
      // isFaceOrLpr, so creating an analytics schedule silently dropped the operator's
      // choices while editing that same row kept them — PUT below has never had the gate.
      // Health is the one family that stays null here; it has its own health_sections column.
      let section_config = null;
      if (!isHealth && req.body.section_config) {
        try { section_config = normalizeSectionConfig(req.body.section_config); }
        catch (e) { return res.status(400).json({ error: 'section_config: ' + e.message }); }
      }
      const site_id = req.body.site_id != null ? (parseInt(req.body.site_id) || null) : null;
      let telegramChatIds;
      try { telegramChatIds = await normalizeTelegramChatIds(pool, req.body.telegram_chat_ids); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      const { rows } = await pool.query(
        `INSERT INTO report_schedules (report_type, enabled, send_time, recipients, image_layout,
                                       send_day_of_week, send_days_of_month, health_sections, report_family, section_config, site_id, telegram_chat_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [report_type, !!enabled, st, String(recipients || '').trim(), resolvedLayout, sdow, sdom, healthSections ? JSON.stringify(healthSections) : null, report_family, section_config ? JSON.stringify(section_config) : null, site_id, telegramChatIds || []]
      );
      await auditChange(req, 'report_schedule_create', { after: rows[0], target: rows[0].id });
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
          return res.status(400).json({ error: `report_type must be one of: ${REPORT_TYPES.join('|')}` });
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
        let sc = null;
        if (req.body.section_config != null) {
          try { sc = normalizeSectionConfig(req.body.section_config); }
          catch (e) { return res.status(400).json({ error: 'section_config: ' + e.message }); }
        }
        updates.push(`section_config = $${idx++}`);
        values.push(sc != null ? JSON.stringify(sc) : null);
      }
      // R5: site_id
      if (req.body.site_id !== undefined) {
        updates.push(`site_id = $${idx++}`);
        values.push(req.body.site_id != null ? (parseInt(req.body.site_id) || null) : null);
      }
      // T5: telegram_chat_ids — undefined = ไม่แตะค่าที่บันทึกไว้ (โดยเฉพาะตอนโหลด
      // checklist ฝั่ง UI ไม่สำเร็จ — ดู dashboard/page-reports.js saveReportSchedule)
      if (req.body.telegram_chat_ids !== undefined) {
        let telegramChatIds;
        try { telegramChatIds = await normalizeTelegramChatIds(pool, req.body.telegram_chat_ids); }
        catch (e) { return res.status(400).json({ error: e.message }); }
        updates.push(`telegram_chat_ids = $${idx++}`); values.push(telegramChatIds || []);
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(id);
      const { rows: before } = await pool.query('SELECT * FROM report_schedules WHERE id = $1', [id]);
      const { rows } = await pool.query(
        `UPDATE report_schedules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) return res.status(404).json({ error: 'schedule not found' });
      await auditChange(req, 'report_schedule_update', { before: before[0], after: rows[0], target: id });
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'PUT /api/report-schedules/:id'); }
  });

  app.delete('/api/report-schedules/:id', async (req, res) => {
    try {
      const { rows: gone } = await pool.query('DELETE FROM report_schedules WHERE id = $1 RETURNING *', [parseInt(req.params.id)]);
      if (gone[0]) await auditChange(req, 'report_schedule_delete', { before: gone[0], target: gone[0].id });
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

      await auditChange(req, 'report_schedule_run', { target: id, extra: { site_id: rows[0].site_id, recipients: rows[0].recipients } });
      res.json({ ok: true });
    } catch (e) {
      if (e.workerStatus === 503) {
        return res.status(503).json({ error: 'Report worker is not available — try again shortly' });
      }
      routeError(res, e, 'POST /api/report-schedules/:id/run');
    }
  });
};
