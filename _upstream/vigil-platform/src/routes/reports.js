// ============================================================
// Vigil Platform — Report Routes
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const path = require('path');
const fs   = require('fs');
const { siteWhere } = require('../auth');

const PORT = process.env.API_PORT || 3000;

const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'health'];

const REPORT_TITLE_TH = {
  daily: 'รายงานประจำวัน', weekly: 'รายงานรายสัปดาห์', monthly: 'รายงานรายเดือน',
  health: 'รายงานสุขภาพระบบ',
};

module.exports = function reportsRoutes(app, pool, {
  routeError,
  REPORTS_DIR, getBrandForReport, INTERNAL_API_TOKEN,
}) {

  // GET /api/report-history/stats — aggregate counts for summary strip
  app.get('/api/report-history/stats', async (req, res) => {
    try {
      const WINDOWS = { '30d': '30 days', '90d': '90 days' };
      const win = WINDOWS[req.query.window];
      const whereClause = win ? `WHERE created_at >= NOW() - $1::INTERVAL` : '';
      const values = win ? [win] : [];
      const { rows } = await pool.query(`
        SELECT
          COUNT(*)                                               AS total,
          COUNT(*) FILTER (WHERE status='success')              AS success,
          COUNT(*) FILTER (WHERE status<>'success')             AS failed,
          COALESCE(SUM(sent_count) FILTER (WHERE status='success'), 0) AS total_recipients_sent,
          COUNT(*) FILTER (WHERE report_type='daily')           AS type_daily,
          COUNT(*) FILTER (WHERE report_type='weekly')          AS type_weekly,
          COUNT(*) FILTER (WHERE report_type='monthly')         AS type_monthly,
          COUNT(*) FILTER (WHERE report_type='health')          AS type_health
        FROM report_history ${whereClause}`, values);
      const r = rows[0];
      const success = parseInt(r.success, 10);
      const failed  = parseInt(r.failed,  10);
      const denom   = success + failed;
      res.json({
        window:                req.query.window || 'all',
        total:                 parseInt(r.total,                  10),
        success,
        failed,
        success_rate:          denom > 0 ? Math.round(success / denom * 100) : null,
        total_recipients_sent: parseInt(r.total_recipients_sent, 10),
        by_type: {
          daily:   parseInt(r.type_daily,   10),
          weekly:  parseInt(r.type_weekly,  10),
          monthly: parseInt(r.type_monthly, 10),
          health:  parseInt(r.type_health,  10),
        },
      });
    } catch (e) { routeError(res, e, 'GET /api/report-history/stats'); }
  });

  // GET /api/report-history — Ph.2 Report History list (paginated)
  app.get('/api/report-history', async (req, res) => {
    try {
      const limit = Math.min(200, parseInt(req.query.limit) || 50);
      const offset = Math.max(0, parseInt(req.query.offset) || 0);
      const { rows } = await pool.query(
        `SELECT rh.*, rs.report_type AS schedule_type
         FROM report_history rh
         LEFT JOIN report_schedules rs ON rs.id = rh.schedule_id
         ORDER BY rh.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      const { rows: cnt } = await pool.query('SELECT COUNT(*) FROM report_history');
      res.json({ items: rows, total: parseInt(cnt[0].count) });
    } catch (e) { routeError(res, e, 'GET /api/report-history'); }
  });

  // GET /api/report-history/:id/image — stream PNG file (Ph.2)
  app.get('/api/report-history/:id/image', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT file_path FROM report_history WHERE id = $1', [parseInt(req.params.id)]
      );
      if (!rows.length || !rows[0].file_path) return res.status(404).json({ error: 'Not found' });
      const full = path.join(REPORTS_DIR, rows[0].file_path);
      if (!fs.existsSync(full)) return res.status(404).json({ error: 'File not found on disk' });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${rows[0].file_path}"`);
      fs.createReadStream(full).pipe(res);
    } catch (e) { routeError(res, e, 'GET /api/report-history/:id/image'); }
  });

  // GET /api/reports/pdf?type=daily|weekly|monthly  (or explicit &from=&to=)
  //                     [&cameras=csv][&title=...][&label=...][&download=1]
  // Returns the report as an application/pdf stream. Used for on-demand
  // download/preview; the scheduler calls renderReportPdf directly below.
  // Custom title/label override the type-derived defaults — sent by the web
  // "ดาวน์โหลด PDF" button so the PDF matches the page's active range view.
  app.get('/api/reports/pdf', async (req, res) => {
    try {
      const reportRenderer = require('../report-renderer');
      const type = REPORT_TYPES.includes(req.query.type) ? req.query.type : 'daily';
      let { from, to } = req.query;
      let rangeLabel = req.query.label;
      if (from && to) {
        if (!rangeLabel) rangeLabel = `${new Date(from).toLocaleDateString('th-TH')} – ${new Date(to).toLocaleDateString('th-TH')}`;
      } else {
        const r = reportRenderer.computeScheduledRange(type);
        from = r.from; to = r.to; rangeLabel = rangeLabel || r.label;
      }
      let cameras = req.query.cameras
        ? String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean)
        : null;
      if (req.user?.isSiteScoped) {
        const { rows: camRows } = await pool.query(
          'SELECT id FROM cameras WHERE site_id = ANY($1)', [req.user.allowedSites]
        );
        const allowed = camRows.map(r => r.id);
        cameras = cameras ? cameras.filter(id => allowed.includes(id)) : allowed;
      }
      const domains = req.query.domains || null;
      const site_id = req.query.site_id ? String(req.query.site_id) : null;
      const pdf = await reportRenderer.renderReportPdf({
        baseUrl: `http://localhost:${PORT}`,
        internalToken: INTERNAL_API_TOKEN,
        from, to, cameras, domains, site_id,
        brand: await getBrandForReport(),
        title: req.query.title || REPORT_TITLE_TH[type],
        rangeLabel,
      });
      const disposition = req.query.download ? 'attachment' : 'inline';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="report-${type}.pdf"`);
      res.send(pdf);
    } catch (e) {
      console.error('📅 /api/reports/pdf failed:', e.message);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  app.get('/api/reports/daily', async (req, res) => {
    const { date = new Date().toISOString().split('T')[0] } = req.query;
    try {
      const swDR = siteWhere(req.user?.allowedSites ?? null, 'camera_id', 2);
      const summary = await pool.query(`
        SELECT camera_id, event_category, event_type, object_class, COUNT(*)::int AS total
        FROM events WHERE DATE(event_time) = $1
          ${swDR.sql}
        GROUP BY camera_id, event_category, event_type, object_class
        ORDER BY camera_id, total DESC
      `, [date, ...swDR.args]);

      const totals = await pool.query(`
        SELECT
          COUNT(*)::int AS total_events,
          COUNT(DISTINCT camera_id)::int AS active_cameras,
          COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons,
          COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle'))::int AS vehicles
        FROM events WHERE DATE(event_time) = $1
          ${swDR.sql}
      `, [date, ...swDR.args]);

      res.json({ date, totals: totals.rows[0], summary: summary.rows });
    } catch (err) { routeError(res, err, 'GET /api/reports/daily'); }
  });

  app.get('/api/reports/weekly', async (req, res) => {
    const { endDate = new Date().toISOString().split('T')[0] } = req.query;
    try {
      const swWR = siteWhere(req.user?.allowedSites ?? null, 'camera_id', 2);
      const daily = await pool.query(`
        SELECT DATE(event_time) AS date,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons,
          COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle'))::int AS vehicles
        FROM events
        WHERE event_time >= ($1::date - INTERVAL '6 days') AND event_time < ($1::date + INTERVAL '1 day')
          ${swWR.sql}
        GROUP BY DATE(event_time) ORDER BY date
      `, [endDate, ...swWR.args]);

      const byCamera = await pool.query(`
        SELECT camera_id, COUNT(*)::int AS total FROM events
        WHERE event_time >= ($1::date - INTERVAL '6 days') AND event_time < ($1::date + INTERVAL '1 day')
          ${swWR.sql}
        GROUP BY camera_id ORDER BY total DESC
      `, [endDate, ...swWR.args]);

      const totals = await pool.query(`
        SELECT
          COUNT(*)::int AS total_events,
          COUNT(DISTINCT camera_id)::int AS active_cameras,
          COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons,
          COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle'))::int AS vehicles
        FROM events
        WHERE event_time >= ($1::date - INTERVAL '6 days') AND event_time < ($1::date + INTERVAL '1 day')
          ${swWR.sql}
      `, [endDate, ...swWR.args]);

      res.json({ endDate, totals: totals.rows[0], daily: daily.rows, byCamera: byCamera.rows });
    } catch (err) { routeError(res, err, 'GET /api/reports/weekly'); }
  });

  // R3 — Face report PNG/PDF download
  // ponytail: renderer fetches data via INTERNAL_API_TOKEN (server-to-server, no user context) —
  //   site isolation here requires structural renderer change; deferred to SC3+renderer phase
  // GET /api/reports/face/image?period=...&group=...&min_score=...&sections=...&lang=...
  app.get('/api/reports/face/image', async (req, res) => {
    try {
      const { renderFaceReportImage } = require('../report-renderer');
      const period   = String(req.query.period   || 'today');
      const group    = String(req.query.group    || 'all');
      const min_score = parseInt(req.query.min_score || '80', 10);
      const lang     = req.query.lang === 'en' ? 'en' : 'th';
      const sections = req.query.sections
        ? Object.fromEntries(String(req.query.sections).split(',').map(s => [s.trim(), true]))
        : {};
      const png = await renderFaceReportImage({
        baseUrl: `http://localhost:${PORT}`, internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(), period, group, min_score, sections, lang,
        from: req.query.from || null, to: req.query.to || null,
        title: String(req.query.title || ''),
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="face_report_${Date.now()}.png"`);
      res.send(png);
    } catch (e) { routeError(res, e, 'GET /api/reports/face/image'); }
  });

  app.get('/api/reports/face/pdf', async (req, res) => {
    try {
      const { renderFaceReportPdf } = require('../report-renderer');
      const period    = String(req.query.period   || 'today');
      const group     = String(req.query.group    || 'all');
      const min_score = parseInt(req.query.min_score || '80', 10);
      const lang      = req.query.lang === 'en' ? 'en' : 'th';
      const sections  = req.query.sections
        ? Object.fromEntries(String(req.query.sections).split(',').map(s => [s.trim(), true]))
        : {};
      const pdf = await renderFaceReportPdf({
        baseUrl: `http://localhost:${PORT}`, internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(), period, group, min_score, sections, lang,
        from: req.query.from || null, to: req.query.to || null,
        title: String(req.query.title || ''),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="face_report_${Date.now()}.pdf"`);
      res.send(pdf);
    } catch (e) { routeError(res, e, 'GET /api/reports/face/pdf'); }
  });

  // R3 — LPR report PNG/PDF download
  // ponytail: same as face renderer — INTERNAL_API_TOKEN path; deferred to renderer phase
  // GET /api/reports/lpr/image?period=...&group=...&sections=...&lang=...
  app.get('/api/reports/lpr/image', async (req, res) => {
    try {
      const { renderLprReportImage } = require('../report-renderer');
      const period   = String(req.query.period || 'today');
      const group    = String(req.query.group  || 'all');
      const lang     = req.query.lang === 'en' ? 'en' : 'th';
      const sections = req.query.sections
        ? Object.fromEntries(String(req.query.sections).split(',').map(s => [s.trim(), true]))
        : {};
      const png = await renderLprReportImage({
        baseUrl: `http://localhost:${PORT}`, internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(), period, group, sections, lang,
        from: req.query.from || null, to: req.query.to || null,
        title: String(req.query.title || ''),
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="lpr_report_${Date.now()}.png"`);
      res.send(png);
    } catch (e) { routeError(res, e, 'GET /api/reports/lpr/image'); }
  });

  app.get('/api/reports/lpr/pdf', async (req, res) => {
    try {
      const { renderLprReportPdf } = require('../report-renderer');
      const period   = String(req.query.period || 'today');
      const group    = String(req.query.group  || 'all');
      const lang     = req.query.lang === 'en' ? 'en' : 'th';
      const sections = req.query.sections
        ? Object.fromEntries(String(req.query.sections).split(',').map(s => [s.trim(), true]))
        : {};
      const pdf = await renderLprReportPdf({
        baseUrl: `http://localhost:${PORT}`, internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(), period, group, sections, lang,
        from: req.query.from || null, to: req.query.to || null,
        title: String(req.query.title || ''),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="lpr_report_${Date.now()}.pdf"`);
      res.send(pdf);
    } catch (e) { routeError(res, e, 'GET /api/reports/lpr/pdf'); }
  });

};
