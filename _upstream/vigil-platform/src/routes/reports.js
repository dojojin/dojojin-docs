// ============================================================
// Vigil Platform — Report Routes
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const path = require('path');
const fs   = require('fs');
const { siteWhere, scopedCameraIds } = require('../auth');
const { brandLogos } = require('../helpers/brandLogos');
const { getSystemSetting } = require('../helpers/getSystemSetting');
// ดาวน์โหลดด้วยมือเรนเดอร์ที่ report-worker ไม่ใช่ในโปรเซสนี้ (VMOD-03)
// อาร์กิวเมนต์ทุกตัวที่ส่งเข้า render() ต้องเป็น JSON ล้วน เพราะเดินทางข้ามโปรเซส
const renderViaWorker = require('../helpers/renderViaWorker');
const { sendTelegramReport, validateApprovedTelegramChatIds } = require('../helpers/reportTelegramLeg');

const PORT = process.env.API_PORT || 3000;

const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'summary', 'health'];

const REPORT_TITLE_TH = {
  daily: 'รายงานประจำวัน', weekly: 'รายงานรายสัปดาห์', monthly: 'รายงานรายเดือน',
  summary: 'รายงานสรุป', health: 'รายงานสุขภาพระบบ',
};

module.exports = function reportsRoutes(app, pool, {
  routeError,
  REPORTS_DIR, getBrandForReport, INTERNAL_API_TOKEN, getDisplayTz,
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
        const allowed = [...(await scopedCameraIds(req.user.allowedSites, pool) || [])];
        cameras = cameras ? cameras.filter(id => allowed.includes(id)) : allowed;
      }
      const domains = req.query.domains || null;
      const site_id = req.query.site_id ? String(req.query.site_id) : null;
      const todFrom = req.query.tod_from ? String(req.query.tod_from) : null;
      const todTo = req.query.tod_to ? String(req.query.tod_to) : null;
      const rtype = req.query.rtype || null;
      const anchor = req.query.anchor || null;
      const pdf = await renderViaWorker.render('renderReportPdf', {
        baseUrl: `http://localhost:${PORT}`,
        internalToken: INTERNAL_API_TOKEN,
        from, to, cameras, domains, site_id, todFrom, todTo, rtype, anchor,
        brand: await getBrandForReport(),
        title: req.query.title || REPORT_TITLE_TH[type],
        rangeLabel,
        // footer ต่อหน้าใช้โลโก้พาร์ตเนอร์ชุดเดียวกับ PDF ของหน้ากวดขันวินัยจราจร
        footerLogoB64: (await brandLogos(pool)).footer,
        // ตัวเลือกจากหน้ารายงาน — ส่งดิบ ๆ ต่อไป หน้าพิมพ์เป็นคนตรวจค่าเอง
        // (normalizeOpts ใน report-template.js ทิ้งคีย์ที่ไม่รู้จักและบังคับ catsort ให้อยู่ 2 ค่า)
        // ⚠️ kpis='' = "ติ๊กออกหมด ซ่อนทั้งหัวข้อ" ซึ่งต่างจาก "ไม่ได้ส่งมา = แสดงครบ"
        //    ใช้ || ตรงนี้จะกลืนค่าว่างเป็น null แล้วซ่อนไม่ได้ (เจอจริงตอนทดสอบ)
        kpis: req.query.kpis != null ? String(req.query.kpis) : null,
        secs: req.query.secs != null ? String(req.query.secs) : null,
        catsort: req.query.catsort || null,
        // cats ว่าง/ไม่ส่ง = ทุกหมวด (ต่างจาก kpis ที่ '' มีความหมาย — หมวดที่
        // "ไม่เลือกเลย" ฝั่ง UI จะไม่ส่ง cats มา เพราะรายงานเปล่าไม่มีประโยชน์)
        catsHide: req.query.cats_hide ? String(req.query.cats_hide) : null,
        catsLegacyShown: req.query.cats ? String(req.query.cats) : null,
        showDelta: req.query.showDelta !== 'false',
        showPct: req.query.showPct !== 'false',
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

  // PNG of the same report the PDF renders — layout:'full' screenshots the very
  // same /report-print.html, so the image and the PDF cannot drift apart. The
  // renderer and the scheduler have produced this for LINE delivery since Phase
  // 7.3; there was simply no route for the UI to ask for one (found 2026-08-03).
  app.get('/api/reports/image', async (req, res) => {
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
      // Same site-scope narrowing the PDF route applies — a scoped user must not
      // widen their view by asking for the picture instead of the document.
      if (req.user?.isSiteScoped) {
        const allowed = [...(await scopedCameraIds(req.user.allowedSites, pool) || [])];
        cameras = cameras ? cameras.filter(id => allowed.includes(id)) : allowed;
      }
      const todFrom = req.query.tod_from ? String(req.query.tod_from) : null;
      const todTo = req.query.tod_to ? String(req.query.tod_to) : null;
      const rtype = req.query.rtype || null;
      const anchor = req.query.anchor || null;
      const png = await renderViaWorker.render('renderReportImage', {
        baseUrl: `http://localhost:${PORT}`,
        internalToken: INTERNAL_API_TOKEN,
        from, to, cameras, todFrom, todTo, rtype, anchor,
        domains: req.query.domains || null,
        site_id: req.query.site_id ? String(req.query.site_id) : null,
        brand: await getBrandForReport(),
        title: req.query.title || REPORT_TITLE_TH[type],
        rangeLabel,
        layout: 'full',
        // ⚠️ kpis='' = "ติ๊กออกหมด ซ่อนทั้งหัวข้อ" ซึ่งต่างจาก "ไม่ได้ส่งมา = แสดงครบ"
        //    ใช้ || ตรงนี้จะกลืนค่าว่างเป็น null แล้วซ่อนไม่ได้ (เจอจริงตอนทดสอบ)
        kpis: req.query.kpis != null ? String(req.query.kpis) : null,
        secs: req.query.secs != null ? String(req.query.secs) : null,
        catsort: req.query.catsort || null,
        // cats ว่าง/ไม่ส่ง = ทุกหมวด (ต่างจาก kpis ที่ '' มีความหมาย — หมวดที่
        // "ไม่เลือกเลย" ฝั่ง UI จะไม่ส่ง cats มา เพราะรายงานเปล่าไม่มีประโยชน์)
        catsHide: req.query.cats_hide ? String(req.query.cats_hide) : null,
        catsLegacyShown: req.query.cats ? String(req.query.cats) : null,
        showDelta: req.query.showDelta !== 'false',
        showPct: req.query.showPct !== 'false',
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition',
        `${req.query.download ? 'attachment' : 'inline'}; filename="report-${type}.png"`);
      res.send(png);
    } catch (e) {
      console.error('📅 /api/reports/image failed:', e.message);
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
      const period   = String(req.query.period   || 'today');
      const group    = String(req.query.group    || 'all');
      const min_score = parseInt(req.query.min_score || '80', 10);
      const lang     = req.query.lang === 'en' ? 'en' : 'th';
      const sections = req.query.sections
        ? Object.fromEntries(String(req.query.sections).split(',').map(s => [s.trim(), true]))
        : {};
      const png = await renderViaWorker.render('renderFaceReportImage', {
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
      const period    = String(req.query.period   || 'today');
      const group     = String(req.query.group    || 'all');
      const min_score = parseInt(req.query.min_score || '80', 10);
      const lang      = req.query.lang === 'en' ? 'en' : 'th';
      const sections  = req.query.sections
        ? Object.fromEntries(String(req.query.sections).split(',').map(s => [s.trim(), true]))
        : {};
      const pdf = await renderViaWorker.render('renderFaceReportPdf', {
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
      const period   = String(req.query.period || 'today');
      const group    = String(req.query.group  || 'all');
      const lang     = req.query.lang === 'en' ? 'en' : 'th';
      const sections = req.query.sections
        ? Object.fromEntries(String(req.query.sections).split(',').map(s => [s.trim(), true]))
        : {};
      const png = await renderViaWorker.render('renderLprReportImage', {
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
      const period   = String(req.query.period || 'today');
      const group    = String(req.query.group  || 'all');
      const lang     = req.query.lang === 'en' ? 'en' : 'th';
      const sections = req.query.sections
        ? Object.fromEntries(String(req.query.sections).split(',').map(s => [s.trim(), true]))
        : {};
      const pdf = await renderViaWorker.render('renderLprReportPdf', {
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

  // POST /api/reports/send-now — Render and send analytics or LPR report to LINE
  // (Health has its own endpoint: POST /api/health/report/send-now)
  // Family must be 'analytics' or 'lpr'. Recipients is REQUIRED and must match
  // enabled LINE recipients — deliberately unlike the schedule path, which treats
  // empty list as "everyone enabled". For an immediate fire-and-forget button,
  // knowing who receives it is non-negotiable (incident 2026-08-23: accidental
  // test pushed to seven real groups including police).
  app.post('/api/reports/send-now', async (req, res) => {
    try {
      const lineSender = require('../line-sender');
      const { family } = req.body;

      if (!['analytics', 'lpr'].includes(family)) {
        return res.status(400).json({ error: 'family must be analytics or lpr' });
      }

      // T5: telegram_chat_ids — เช็คก่อนเรนเดอร์/ส่ง LINE เลย กัน render ทิ้งเปล่าๆ
      // ถ้า chat_id ผิด · undefined = ไม่ได้ขอส่ง Telegram เลย ไม่แตะ telegram_config
      let telegramChatIds;
      try { telegramChatIds = await validateApprovedTelegramChatIds(pool, req.body.telegram_chat_ids); }
      catch (e) { return res.status(400).json({ error: `telegram_chat_ids: ${e.message}` }); }

      // LINE config guard (same as Health)
      const cfgRes = await pool.query('SELECT * FROM line_config WHERE id = 1');
      const cfg = cfgRes.rows[0];
      if (!cfg || !cfg.enabled || !cfg.channel_access_token) {
        return res.status(400).json({ error: 'LINE is not enabled / no channel access token' });
      }

      const roster = Array.isArray(cfg.recipients) ? cfg.recipients : [];
      const enabledIds = roster.filter(r => r.enabled).map(r => r.id);
      const requested = Array.isArray(req.body.recipients) ? req.body.recipients.filter(Boolean) : [];

      if (!requested.length) {
        return res.status(400).json({ error: 'recipients required' });
      }

      const recipientIds = enabledIds.filter(id => requested.includes(id));
      if (!recipientIds.length) {
        return res.status(400).json({ error: 'no enabled recipient matched' });
      }

      const lang = req.body.lang === 'en' ? 'en' : 'th';
      let png, caption;

      if (family === 'analytics') {
        // Analytics: render via the shared report template
        const range = req.body;  // contains: from, to, title, layout, site_id, domains, kpis, catsort
        png = await renderViaWorker.render('renderReportImage', {
          baseUrl: `http://localhost:${PORT}`,
          internalToken: INTERNAL_API_TOKEN,
          from: range.from,
          to: range.to,
          brand: await getBrandForReport(),
          title: range.title || 'รายงานวิเคราะห์',
          rangeLabel: range.label || null,
          layout: range.layout || 'full',
          site_id: range.site_id || null,
          domains: range.domains || null,
          kpis: range.kpis !== undefined ? range.kpis : null,
          secs: range.secs !== undefined ? range.secs : null,
          catsort: range.catsort || null,
        });
        caption = `📊 ${lang === 'en' ? 'Analytics Report' : 'รายงานวิเคราะห์'}\n${lang === 'en' ? 'Manual send' : 'ส่งทันที'}`;
      } else {
        // LPR: render via lpr-specific renderer
        png = await renderViaWorker.render('renderLprReportImage', {
          baseUrl: `http://localhost:${PORT}`,
          internalToken: INTERNAL_API_TOKEN,
          brand: await getBrandForReport(),
          period: req.body.period || 'today',
          group: req.body.group || 'all',
          sections: req.body.sections ? Object.fromEntries(String(req.body.sections).split(',').map(s => [s.trim(), true])) : {},
          lang,
          from: req.body.from || null,
          to: req.body.to || null,
          title: req.body.title || 'รายงานป้ายทะเบียน',
        });
        caption = `🚗 ${lang === 'en' ? 'License Plate Report' : 'รายงานป้ายทะเบียน'}\n${lang === 'en' ? 'Manual send' : 'ส่งทันที'}`;
      }

      const tzForName = await getDisplayTz?.() || 'Asia/Bangkok';
      const dateStr = new Date().toLocaleDateString('sv', { timeZone: tzForName });
      const fname = `report_${family}_${dateStr}_${Date.now()}.png`;
      // เขียนไฟล์ไม่สำเร็จ = เสียแค่สำเนาในหน้าประวัติ ยังส่ง LINE ต่อได้ (ส่งจาก buffer)
      // แต่ต้องเห็นใน log — ไม่กลืนเงียบ เพราะเมื่อย้ายไปใช้ลิงก์ของเราเอง ไฟล์นี้จะกลายเป็นตัวจริงที่ LINE มาดึง
      let fileOk = true;
      try { await fs.promises.writeFile(path.join(REPORTS_DIR, fname), png); }
      catch (e) { fileOk = false; console.error('[reports] เขียนไฟล์รายงานไม่สำเร็จ:', e.message); }

      // 2026-08-24: ลองลิงก์เซ็นชื่อจากโดเมนเราก่อน · ถ้าล้มใช้ imgbb ตามการตั้งค่า
      let allowImgbb = true;
      try { allowImgbb = (await getSystemSetting(pool, 'imgbb_fallback_enabled')) !== 'false'; }
      catch (e) { console.warn('[reports] อ่าน imgbb_fallback_enabled ล้ม โดยค่าเริ่มต้นให้เปิด'); }

      const result = await lineSender.sendReportToLine({
        token: cfg.channel_access_token,
        imgbbKey: cfg.imgbb_api_key,
        recipients: recipientIds,
        pngBuffer: png,
        caption,
        reportFile: fileOk ? fname : null,
        allowImgbb,
        signedTtlSec: 172800,  // 48 ชม.
      });

      // T5: ขา Telegram ต่อท้าย LINE เสมอ — telegramChatIds undefined = ไม่ได้ขอส่ง
      // Telegram เลย ไม่แตะ telegram_config
      const telegram = telegramChatIds && telegramChatIds.length
        ? await sendTelegramReport({ pool, telegramChatIds, pngBuffer: png, caption })
        : null;

      // Write report_history row
      const rangeFrom = req.body.from ? new Date(req.body.from).toISOString() : new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const rangeTo = req.body.to ? new Date(req.body.to).toISOString() : new Date().toISOString();

      await pool.query(
        `INSERT INTO report_history
           -- report_type เป็น NOT NULL และ enum ของมันคือ cadence (daily/weekly/monthly/health)
           -- การส่งด้วยมือไม่ใช่ cadence จึงใช้ 'manual' — ไม่มี CHECK constraint บนคอลัมน์นี้
           (schedule_id, report_type, report_family, range_from, range_to, image_layout,
            file_path, recipients_sent, sent_count, total_recipients, status, error_message, image_source,
            telegram_sent_count, telegram_total_recipients, telegram_error_message)
         VALUES (NULL, 'manual', $1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [family, rangeFrom, rangeTo, fileOk ? fname : null, recipientIds.join(','),
         result.sentCount || 0, result.totalRecipients || recipientIds.length,
         result.success ? 'success' : 'failed',
         result.success ? null : String(result.error || 'send failed').slice(0, 500),
         result.imageSource || null,
         telegram ? telegram.sentCount : null, telegram ? telegram.totalRecipients : null,
         telegram && telegram.error ? String(telegram.error).slice(0, 500) : null]
      ).catch((e) => console.error('[reports] บันทึก report_history ไม่สำเร็จ:', e.message));

      res.json({
        success: result.success,
        sent_count: result.sentCount || 0,
        total_recipients: result.totalRecipients || recipientIds.length,
        error: result.error || null,
        telegram: telegram ? { sent_count: telegram.sentCount, total_recipients: telegram.totalRecipients, error: telegram.error } : null,
      });
    } catch (e) { routeError(res, e, 'POST /api/reports/send-now'); }
  });

};
