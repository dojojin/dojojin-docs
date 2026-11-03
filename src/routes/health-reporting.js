// ============================================================
// Vigil Platform — Health Check Routes (report / relay)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แยกออกจาก routes/health.js — route ทั้งหมดในไฟล์นี้ยังลงทะเบียนที่ตำแหน่งเดิมเป๊ะ
// (ลำดับการลงทะเบียนคือพฤติกรรม: Express จับคู่ตามลำดับที่ลงทะเบียน)
// helper ที่ใช้ร่วมกับไฟล์แม่รับผ่าน deps ตัวเดียว ไม่ทำสำเนา
'use strict';

const fs   = require('fs');
const path = require('path');
const { getSystemSetting } = require('../helpers/getSystemSetting');
const { sendTelegramReport, validateApprovedTelegramChatIds } = require('../helpers/reportTelegramLeg');

const { OFFLINE_THRESHOLD_SEC } = require('../constants');
const env = require('../config');

const PORT                   = env.int('API_PORT');
const HEALTH_REPORT_TITLE_TH = 'รายงานสุขภาพระบบ';

module.exports = function healthReportingRoutes(app, pool, {
  auth, routeError,
  loadCameraConfig, getBrandForReport, REPORTS_DIR, getDisplayTz,
  INTERNAL_API_TOKEN,
  // ตัวเดียวกับที่ /api/health/details ใช้ — ประกาศไว้ที่ routes/health.js ที่เดียว
  _alertHealth,
}) {

  // Ph.3 — health report data endpoints (internal token only, called by report-renderer)
  // Cameras: current online/offline status (from cameras.last_seen_at) + uptime % over range
  // + offline duration (NOW - last_seen_at) so the report can show how long offline.
  app.get('/api/health/report-data/cameras', async (req, res) => {
    try {
      const hours = Math.max(1, Math.min(8760, parseInt(req.query.range_hours, 10) || 24));
      const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const config = loadCameraConfig();
      // Field is `camera_name` in cameras-config.json (not `name`).
      let cams = (config.cameras || [])
        .map(c => ({
          id:   c.camera_id || c.id,
          name: c.camera_name || c.name || c.camera_id || c.id,
        }))
        .filter(c => c.id);
      const allowedSites = req.user?.allowedSites ?? null;
      if (allowedSites !== null) {
        if (allowedSites.length === 0) return res.json({ summary: { total: 0, online: 0, offline: 0 }, list: [] });
        const allowedCamIds = await auth.scopedCameraIds(allowedSites, pool);   // รวมแกนกล้อง (GOTCHAS #166)
        cams = cams.filter(c => allowedCamIds.has(c.id));
      }
      // Report-level site pick, separate from the permission scope above: an
      // admin who can see every site still wants a report about one of them.
      // Applied after the permission filter so it can only ever narrow further.
      if (req.query.site_id) {
        const { rows: pickRows } = await pool.query(
          'SELECT id FROM cameras WHERE site_id = $1', [req.query.site_id]);
        const pickIds = new Set(pickRows.map(r => r.id));
        cams = cams.filter(c => pickIds.has(c.id));
      }
      const ids = cams.map(c => c.id);

      // Current online flag + last_seen_at + created_at (when added to system)
      const onlineSet = new Set();
      const pausedSet = new Set();
      const lastSeenByCamera = {};
      const createdByCamera = {};
      if (ids.length) {
        const r = await pool.query(
          `SELECT c.id, c.last_seen_at, c.created_at, c.paused,
                  (c.last_seen_at > NOW() - INTERVAL '${OFFLINE_THRESHOLD_SEC} seconds') AS is_online
           FROM cameras c
           WHERE c.id = ANY($1::text[])`,
          [ids]
        );
        for (const row of r.rows) {
          if (row.paused) { pausedSet.add(row.id); continue; } // paused cameras excluded from health report
          if (row.is_online) onlineSet.add(row.id);
          if (row.last_seen_at) lastSeenByCamera[row.id] = row.last_seen_at;
          if (row.created_at)   createdByCamera[row.id]  = row.created_at;
        }
      }

      // Last event and last event snapshot per camera. Snapshot is distinct
      // from "latest event": an event can exist even when snapshot capture
      // was disabled or failed.
      const lastEventByCamera = {};
      if (ids.length) {
        const ev = await pool.query(
          // ทีละกล้อง ORDER BY … LIMIT 1 ตาม idx (camera_id, event_time DESC) — 0.4 ms แทน MAX+GROUP BY
          // ที่ไม่มีขอบเวลาและกวาดทุก partition · ขอบบนกันเวลาอนาคต (GOTCHAS #217) · 120 วัน > อายุเก็บ
          // CROSS JOIN LATERAL ทิ้งกล้องที่ไม่มี event เหมือน GROUP BY เดิม
          `SELECT c.id AS camera_id, x.t AS last_event_at
             FROM unnest($1::text[]) AS c(id)
             CROSS JOIN LATERAL (
               SELECT e.event_time AS t FROM events e
                WHERE e.camera_id = c.id
                  AND e.event_time > now() - interval '120 days'
                  AND e.event_time <= now() + interval '5 minutes'
                ORDER BY e.event_time DESC LIMIT 1) x`, [ids]
        );
        for (const row of ev.rows) lastEventByCamera[row.camera_id] = row.last_event_at;
      }

      // Last snapshot (event with snapshot) per camera — proxy for "last image
      // the system actually captured from this camera", distinct from heartbeat.
      // Ingester updates keep has_snapshot/snapshot_filename in sync with
      // raw_json._snapshot; the partial index keeps this query cheap.
      const lastSnapshotByCamera = {};
      if (ids.length) {
        const fr = await pool.query(
          `SELECT c.id AS camera_id, x.t AS last_snapshot_at
             FROM unnest($1::text[]) AS c(id)
             CROSS JOIN LATERAL (
               SELECT e.event_time AS t FROM events e
                WHERE e.camera_id = c.id AND e.has_snapshot = TRUE
                  AND e.event_time > now() - interval '120 days'
                  AND e.event_time <= now() + interval '5 minutes'
                ORDER BY e.event_time DESC LIMIT 1) x`, [ids]   // รูปแบบเดียวกับข้างบน
        );
        for (const row of fr.rows) lastSnapshotByCamera[row.camera_id] = row.last_snapshot_at;
      }

      // Snapshot quality diagnostics — per camera over query range.
      // Populated only for cameras that set raw_json._snapshot_status (Dahua ingester).
      const snapDiagByCamera = {};
      if (ids.length) {
        const sd = await pool.query(
          `SELECT camera_id, raw_json->>'_snapshot_status' AS snap_status, COUNT(*)::int AS cnt
           FROM events
           WHERE camera_id = ANY($1::text[])
             AND event_time >= $2
             AND raw_json ? '_snapshot_status'
           GROUP BY camera_id, raw_json->>'_snapshot_status'`,
          [ids, sinceIso]
        );
        for (const row of sd.rows) {
          if (!snapDiagByCamera[row.camera_id])
            snapDiagByCamera[row.camera_id] = { ok: 0, low_confidence: 0, missing: 0, failed: 0 };
          const k = row.snap_status;
          if (k in snapDiagByCamera[row.camera_id]) snapDiagByCamera[row.camera_id][k] = row.cnt;
        }
      }

      // Live ingester connection state — written by dahua-cgi.js process, null for other vendors.
      const ingesterStatusByCamera = {};
      if (ids.length) {
        const is = await pool.query(
          `SELECT camera_id, event_stream, snap_stream, retry_count,
                  last_event_http_status, last_snap_http_status, last_error_code, updated_at
           FROM ingester_camera_status
           WHERE camera_id = ANY($1::text[])`,
          [ids]
        );
        for (const row of is.rows) ingesterStatusByCamera[row.camera_id] = row;
      }

      // Uptime % over range from camera_status_log
      const uptimeR = await pool.query(`
        WITH log_range AS (
          SELECT camera_id, status, changed_at,
            LEAD(changed_at) OVER (PARTITION BY camera_id ORDER BY changed_at) AS next_at
          FROM camera_status_log
          WHERE changed_at >= $1
        ),
        durations AS (
          SELECT camera_id,
            SUM(CASE WHEN status='offline' THEN
              EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - changed_at)) ELSE 0 END
            ) AS offline_sec
          FROM log_range GROUP BY camera_id
        )
        SELECT camera_id, ROUND(((1 - offline_sec / ($2::float * 3600.0))*100)::numeric, 1) AS uptime_pct
        FROM durations`, [sinceIso, hours]);
      const uptimeByCamera = {};
      for (const r of uptimeR.rows) uptimeByCamera[r.camera_id] = parseFloat(r.uptime_pct);

      const nowMs = Date.now();
      const list = cams.map(c => {
        const isOnline = onlineSet.has(c.id);
        const lastSeen = lastSeenByCamera[c.id];
        const created  = createdByCamera[c.id];
        const lastEvent = lastEventByCamera[c.id];
        const lastSnapshot = lastSnapshotByCamera[c.id];
        // offline_for_sec: how long this camera has been offline
        //   null  = currently online (irrelevant)
        //   -1    = never seen (no row in `cameras` table at all)
        //   N>=0  = seconds since last_seen_at
        let offline_for_sec = null;
        if (!isOnline) {
          offline_for_sec = lastSeen
            ? Math.max(0, Math.floor((nowMs - new Date(lastSeen).getTime()) / 1000))
            : -1;
        }
        return {
          camera_id: c.id, name: c.name,
          status: pausedSet.has(c.id) ? 'paused' : (isOnline ? 'online' : 'offline'),
          uptime_pct: uptimeByCamera[c.id] === undefined ? null : uptimeByCamera[c.id],
          offline_for_sec,
          added_at:           created   ? new Date(created).toISOString()   : null,
          last_heartbeat_at:  lastSeen  ? new Date(lastSeen).toISOString()  : null,
          last_event_at:      lastEvent ? new Date(lastEvent).toISOString() : null,
          last_snapshot_at:   lastSnapshot ? new Date(lastSnapshot).toISOString() : null,
          snapshot_diag:      snapDiagByCamera[c.id] || null,
          ingester_status:    ingesterStatusByCamera[c.id] || null,
        };
      }).sort((a, b) => {
        if (a.status !== b.status) return a.status === 'online' ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });

      res.json({
        summary: {
          total: list.length,
          online: list.filter(c => c.status === 'online').length,
          offline: list.filter(c => c.status === 'offline').length,
        },
        list,
      });
    } catch (e) {
      console.error('[health/report-data/cameras] error:', e.message);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // Ph.3 — On-demand health report preview (PNG)
  // ponytail: renderer fetches data via INTERNAL_API_TOKEN (no user context); site isolation deferred to renderer phase
  // id -> code for the report site pick. Null id (all sites) stays null, which
  // is what keeps the central figures in place for a whole-platform report.
  async function _siteCodeOf(siteId) {
    if (!siteId) return null;
    try {
      const { rows } = await pool.query('SELECT code FROM sites WHERE id = $1', [siteId]);
      return rows[0]?.code || null;
    } catch { return null; }
  }

  // GET /api/health/report/preview
  //   ?sections=camera_status,camera_uptime,alerts,storage,system
  //     (legacy "cameras" expands to camera_status + camera_uptime)
  //   &range=24h|7d|30d|custom    (default 24h)
  //   &from=ISO&to=ISO            (when range=custom)
  //   &lang=th|en                 (default th)
  //   &download=1                 (force download)
  app.get('/api/health/report/preview', async (req, res) => {
    try {
      const reportRenderer = require('../report-renderer');
      const sectionsParam = String(req.query.sections || '').split(',').map(s => s.trim()).filter(Boolean);
      const sections = sectionsParam.length ? sectionsParam : null;
      const range = req.query.range === 'custom' && req.query.from && req.query.to
        ? { from: req.query.from, to: req.query.to, label: req.query.label || null }
        : { preset: req.query.range || '24h' };
      const lang = req.query.lang === 'en' ? 'en' : 'th';
      const png = await reportRenderer.renderHealthReportImage({
        baseUrl: `http://localhost:${PORT}`,
        internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(),
        sections, range, lang,
        // Report-level site pick. Narrows the whole report — summary counts and
        // camera lists alike — so "HDY" means HDY everywhere, not just in the
        // camera table (asked for 2026-08-03).
        site_id: req.query.site_id || req.body?.site_id || null,
        // The code, resolved here because the renderer has no database: it
        // reaches the platform over HTTP. edge_status keys on the code ('hkt'),
        // the UI sends the numeric id, and without the translation the storage
        // and system sections keep reporting central while everything else on
        // the page is about the chosen site.
        site_code: await _siteCodeOf(req.query.site_id || req.body?.site_id),
        title: String(req.query.title || ''),
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      if (req.query.download) {
        res.setHeader('Content-Disposition', `attachment; filename="health_report_${Date.now()}.png"`);
      }
      res.send(png);
    } catch (e) {
      console.error('[health/report/preview] error:', e.message);
      routeError(res, e, 'GET /api/health/report/preview');
    }
  });

  // Ph.3 — Health report as A4 PDF with page numbers
  // ponytail: same as preview — INTERNAL_API_TOKEN path; deferred to renderer phase
  // GET /api/health/report/pdf?sections=...&range=...&from=&to=&lang=...
  app.get('/api/health/report/pdf', async (req, res) => {
    try {
      const reportRenderer = require('../report-renderer');
      const sectionsParam = String(req.query.sections || '').split(',').map(s => s.trim()).filter(Boolean);
      const sections = sectionsParam.length ? sectionsParam : null;
      const range = req.query.range === 'custom' && req.query.from && req.query.to
        ? { from: req.query.from, to: req.query.to, label: req.query.label || null }
        : { preset: req.query.range || '24h' };
      const lang = req.query.lang === 'en' ? 'en' : 'th';
      const pdf = await reportRenderer.renderHealthReportPdf({
        baseUrl: `http://localhost:${PORT}`,
        internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(),
        sections, range, lang,
        // Report-level site pick. Narrows the whole report — summary counts and
        // camera lists alike — so "HDY" means HDY everywhere, not just in the
        // camera table (asked for 2026-08-03).
        site_id: req.query.site_id || req.body?.site_id || null,
        // The code, resolved here because the renderer has no database: it
        // reaches the platform over HTTP. edge_status keys on the code ('hkt'),
        // the UI sends the numeric id, and without the translation the storage
        // and system sections keep reporting central while everything else on
        // the page is about the chosen site.
        site_code: await _siteCodeOf(req.query.site_id || req.body?.site_id),
        title: String(req.query.title || ''),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="health_report_${Date.now()}.pdf"`);
      res.send(pdf);
    } catch (e) {
      console.error('[health/report/pdf] error:', e.message);
      routeError(res, e, 'GET /api/health/report/pdf');
    }
  });

  // Ph.3 — Send health report to LINE NOW (admin only) + log to report_history
  // body: { sections: [...], range: {preset|from+to}, recipients: ["U1","C2"], lang: 'th'|'en' }
  //   recipients: optional. If omitted/empty → defaults to all enabled in line_config
  //   (admin can pre-pick a subset on the Reports page)
  app.post('/api/health/report/send-now', async (req, res) => {
    try {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin role required' });
      }
      // T5: telegram_chat_ids — เช็คก่อนเรนเดอร์เลย กัน render ทิ้งเปล่าๆ ถ้า chat_id
      // ผิด · undefined = ไม่ได้ขอส่ง Telegram เลย ไม่แตะ telegram_config
      let telegramChatIds;
      try { telegramChatIds = await validateApprovedTelegramChatIds(pool, req.body.telegram_chat_ids); }
      catch (e) { return res.status(400).json({ error: `telegram_chat_ids: ${e.message}` }); }
      const reportRenderer = require('../report-renderer');
      const lineSender = require('../line-sender');
      const sectionsParam = Array.isArray(req.body.sections) ? req.body.sections : null;
      const sections = sectionsParam && sectionsParam.length ? sectionsParam : null;
      const range = (req.body.range && req.body.range.from && req.body.range.to)
        ? { from: req.body.range.from, to: req.body.range.to, label: req.body.range.label || null }
        : { preset: (req.body.range && req.body.range.preset) || '24h' };
      const lang = req.body.lang === 'en' ? 'en' : 'th';

      const cfgRes = await pool.query('SELECT * FROM line_config WHERE id = 1');
      const cfg = cfgRes.rows[0];
      if (!cfg || !cfg.enabled || !cfg.channel_access_token) {
        return res.status(400).json({ error: 'LINE is not enabled / no channel access token' });
      }
      const roster = Array.isArray(cfg.recipients) ? cfg.recipients : [];
      const enabledIds = roster.filter(r => r.enabled).map(r => r.id);
      const requested = Array.isArray(req.body.recipients) ? req.body.recipients.filter(Boolean) : [];
      // ไม่ระบุผู้รับ = ส่งให้ผู้รับเริ่มต้นรายเดียว ไม่ใช่ทุกคนที่เปิดใช้งาน (2026-08-24)
      // ปุ่มนี้ยิงทันทีแล้วเรียกคืนไม่ได้ ค่า default ที่กระจายทุกคนจึงไม่ควรมีตั้งแต่แรก
      const dflt = (await getSystemSetting(pool, 'line_default_recipient') || '').trim();
      const recipientIds = requested.length
        ? enabledIds.filter(id => requested.includes(id))  // intersection: enabled + requested
        : enabledIds.filter(id => id === dflt);
      if (recipientIds.length === 0) {
        return res.status(400).json({ error: 'no enabled LINE recipients selected' });
      }
      const png = await reportRenderer.renderHealthReportImage({
        baseUrl: `http://localhost:${PORT}`,
        internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(),
        sections, range, lang,
        // Report-level site pick. Narrows the whole report — summary counts and
        // camera lists alike — so "HDY" means HDY everywhere, not just in the
        // camera table (asked for 2026-08-03).
        site_id: req.query.site_id || req.body?.site_id || null,
        // The code, resolved here because the renderer has no database: it
        // reaches the platform over HTTP. edge_status keys on the code ('hkt'),
        // the UI sends the numeric id, and without the translation the storage
        // and system sections keep reporting central while everything else on
        // the page is about the chosen site.
        site_code: await _siteCodeOf(req.query.site_id || req.body?.site_id),
        title: String(req.query.title || ''),
      });
      const tzForName = await getDisplayTz();
      const dateStr = new Date().toLocaleDateString('sv', { timeZone: tzForName });
      const fname = `report_health_${dateStr}_${Date.now()}.png`;
      await fs.promises.writeFile(path.join(REPORTS_DIR, fname), png).catch(() => {});
      const caption = `📊 ${HEALTH_REPORT_TITLE_TH}\n${lang === 'en' ? 'Manual send' : 'ส่งทันที'}`;
      const result = await lineSender.sendReportToLine({
        token: cfg.channel_access_token,
        imgbbKey: cfg.imgbb_api_key,
        recipients: recipientIds,
        pngBuffer: png,
        caption,
      });
      // T5: ขา Telegram ต่อท้าย LINE เสมอ — telegramChatIds undefined = ไม่ได้ขอส่ง
      // Telegram เลย ไม่แตะ telegram_config
      const telegram = telegramChatIds && telegramChatIds.length
        ? await sendTelegramReport({ pool, telegramChatIds, pngBuffer: png, caption })
        : null;
      // History row uses the actual rendered range (resolved via the renderer's
      // _normalizeRange — we duplicate the logic here so the row stores real
      // boundaries, not the preset string).
      let rangeFrom, rangeTo;
      if (range.from && range.to) {
        rangeFrom = new Date(range.from).toISOString();
        rangeTo   = new Date(range.to).toISOString();
      } else {
        const h = range.preset === '7d' ? 168 : range.preset === '30d' ? 720 : 24;
        rangeFrom = new Date(Date.now() - h * 3600 * 1000).toISOString();
        rangeTo   = new Date().toISOString();
      }
      await pool.query(
        `INSERT INTO report_history
           (schedule_id, report_type, range_from, range_to, image_layout,
            file_path, recipients_sent, sent_count, total_recipients, status, error_message,
            telegram_sent_count, telegram_total_recipients, telegram_error_message)
         VALUES (NULL, 'health', $1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [rangeFrom, rangeTo, fname, recipientIds.join(','),
         result.sentCount || 0, result.totalRecipients || recipientIds.length,
         result.success ? 'success' : 'failed',
         result.success ? null : String(result.error || 'send failed').slice(0, 500),
         telegram ? telegram.sentCount : null, telegram ? telegram.totalRecipients : null,
         telegram && telegram.error ? String(telegram.error).slice(0, 500) : null]
      ).catch(() => {});
      res.json({
        success: result.success,
        sent_count: result.sentCount || 0,
        total_recipients: result.totalRecipients || recipientIds.length,
        error: result.error || null,
        telegram: telegram ? { sent_count: telegram.sentCount, total_recipients: telegram.totalRecipients, error: telegram.error } : null,
      });
    } catch (e) { routeError(res, e, 'POST /api/health/report/send-now'); }
  });

  // Alerts: success/failed/cooldown counts over a range_hours window (default 24h)
  app.get('/api/health/report-data/alerts', async (req, res) => {
    try {
      const hours = Math.max(1, Math.min(8760, parseInt(req.query.range_hours, 10) || 24));
      res.json(await _alertHealth(pool, hours));
    } catch (e) { routeError(res, e, 'GET /api/health/report-data/alerts'); }
  });

  // ── Relay evidence (2026-09-02) ─────────────────────────────
  // Per-camera proof sheet for downstream relays (today: the government CIB
  // feed at hkt): which cameras relay, to which destination URL (the URL
  // carries the receiver's own per-camera identifier — CIB's UUID for face),
  // and whether data actually moved in the last 24h. Built after CIB reported
  // receiving "only 6 cameras" while every check on our side showed a healthy
  // fleet — this is the mapping table both sides reconcile against.
  // Config truth = cameras-config.json; activity truth = license_plates /
  // appearances. Tokens are never returned, only their presence as a boolean.
  // Grouped by site; sites with no relay-related cameras are omitted so the
  // page hides them (owner ask 2026-09-02). Cameras deliberately not forwarded
  // (UVSS pair at hkt, owner decision 2026-09-02) are omitted entirely — they
  // push to us for our own ingest only and showing them "creates questions".
  const RELAY_HIDDEN = /^HKT-ANPR-UVSS/;
  // requireAuth (not admin): the audience of this tab includes a viewer
  // account handed to the CIB team so they can reconcile the feed themselves
  // (owner ask 2026-09-03). Authorization comes from the view allowlist —
  // a restricted viewer reaches this route only when an admin ticked the
  // Relay tab for them (P4 default-deny) — and rows are site-scoped below,
  // so that account sees only its own site's relay table.
  async function _relayData(req) {
    const cfgById = new Map((loadCameraConfig().cameras || [])
      .filter(c => c && c.camera_id).map(c => [c.camera_id, c]));
    const allowedSites = req.user?.allowedSites ?? null;   // null = ไม่จำกัด site
    if (allowedSites !== null && allowedSites.length === 0) {
      return { generated_at: new Date().toISOString(), sites: [] };
    }
    const siteFilter = allowedSites !== null ? 'AND s.id = ANY($1)' : '';
    const [cams, lpr24, face24] = await Promise.all([
      pool.query(`SELECT c.id, c.name, c.ip_address, c.cam_role, c.enabled, c.paused,
                         c.last_seen_at, s.code AS site_code, s.name AS site_name
                    FROM cameras c JOIN sites s ON s.id = c.site_id
                   WHERE c.cam_role IN ('lpr','face') ${siteFilter}
                   ORDER BY s.code, c.cam_role, c.id`,
                 allowedSites !== null ? [allowedSites] : []),
      pool.query(`SELECT camera_id, COUNT(*)::int AS n, MAX(detected_at) AS last
                    FROM license_plates WHERE detected_at > now() - interval '24 hours'
                   GROUP BY camera_id`),
      pool.query(`SELECT camera_id, COUNT(*)::int AS n, MAX(detected_at) AS last
                    FROM appearances WHERE detected_at > now() - interval '24 hours'
                   GROUP BY camera_id`),
    ]);
    const lprMap  = new Map(lpr24.rows.map(r => [r.camera_id, r]));
    const faceMap = new Map(face24.rows.map(r => [r.camera_id, r]));
    const bySite = new Map();
    for (const c of cams.rows) {
      if (RELAY_HIDDEN.test(c.id)) continue;
      const cfg = cfgById.get(c.id) || {};
      const isFace = c.cam_role === 'face';
      const dest = (isFace ? cfg.face_forward_url : cfg.lpr_forward_url) || null;
      const hasToken = Boolean(isFace ? cfg.face_push_token : cfg.lpr_push_token);
      // A camera with neither destination nor token has nothing to do with
      // relaying — it stays off this page rather than padding it with noise.
      if (!dest && !hasToken) continue;
      const status = (dest && hasToken) ? 'relay' : dest ? 'unconfigured' : 'ingest_only';
      const a = (isFace ? faceMap : lprMap).get(c.id);
      if (!bySite.has(c.site_code)) {
        bySite.set(c.site_code, { code: c.site_code, name: c.site_name, rows: [] });
      }
      bySite.get(c.site_code).rows.push({
        camera_id: c.id, name: c.name, ip: c.ip_address, role: c.cam_role,
        enabled: c.enabled, paused: c.paused, last_seen_at: c.last_seen_at,
        // mac_address มาจาก cameras-config.json (ไม่มีในตาราง cameras) — ยังไม่ได้
        // เก็บทุกกล้อง มีเฉพาะตัวที่ตรวจสอบแล้วจริง (เจ้าของสั่ง 2026-09-04 หลังเทียบ
        // UUID กับ CIB ด้วย MAC) · null = ยังไม่มีข้อมูล ไม่ใช่ "ไม่มี MAC"
        mac: cfg.mac_address || null,
        status, dest_url: dest,
        events_24h: a ? a.n : 0, last_event_at: a ? a.last : null,
      });
    }
    const sites = [...bySite.values()].map(s => {
      const summary = { total: s.rows.length, active_24h: s.rows.filter(r => r.events_24h > 0).length };
      for (const r of s.rows) summary[r.status] = (summary[r.status] || 0) + 1;
      return { ...s, summary };
    });
    return { generated_at: new Date().toISOString(), sites };
  }

  app.get('/api/health/relay', auth.requireAuth, async (req, res) => {
    try {
      res.json(await _relayData(req));
    } catch (e) { routeError(res, e, 'GET /api/health/relay'); }
  });

  // PDF edition of the same table (owner ask 2026-09-03: helmet-report format,
  // A4) — the artifact the CIB team is actually handed. Same guard and the same
  // site scoping as the JSON route because it runs on the same _relayData();
  // ?site=<code> narrows to one site (the picker the user is looking at).
  app.get('/api/health/relay/report.pdf', auth.requireAuth, async (req, res) => {
    try {
      const data = await _relayData(req);
      let sites = data.sites;
      const pick = String(req.query.site || '').trim();
      if (pick) sites = sites.filter(s => s.code === pick);
      if (!sites.length) return res.status(404).json({ error: 'no relay data in scope' });
      const reportRenderer = require('../report-renderer');
      const { brandLogos } = require('../helpers/brandLogos');
      const logos = await brandLogos(pool);
      const pdf = await reportRenderer.renderRelayPdf({
        sites, brand: await getBrandForReport(),
        logoB64: logos.header, footerLogoB64: logos.footer,
      });
      // เหตุผลเดียวกับรายงานหมวกนิรภัย: path .pdf โดน Cloudflare/เบราว์เซอร์แคช
      // ตามนามสกุล ทั้งที่เนื้อหาเปลี่ยนตลอด — ห้ามแคชเด็ดขาด
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition',
        `inline; filename="relay-${pick || 'all'}-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdf);
    } catch (e) { routeError(res, e, 'GET /api/health/relay/report.pdf'); }
  });
};
