// ============================================================
// Vigil Platform — Report Worker
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Standalone PM2 process that owns the scheduled-report loop.
// Crash-isolates Puppeteer from api-server: if Chrome dies here,
// PM2 restarts this worker; api-server stays online.
//
// Exposes a minimal HTTP server on 127.0.0.1:REPORT_WORKER_PORT for
// on-demand "run now" requests proxied from api-server (Option B, Step 3).
// ============================================================
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ── DB pool ────────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 3,
  application_name: 'report-worker',
});

pool.on('error', (err) => {
  console.error('[report-worker] pg pool error:', err.message);
});

const _workerStartedAt = Date.now();
let _lastSchedulerCheckAt = null;

// ── Constants ──────────────────────────────────────────────
// Base URL pointing back to api-server (not this worker).
// The report-renderer fetches stats data via HTTP — it must hit api-server.
const API_BASE_URL = `http://localhost:${process.env.API_PORT || 3000}`;

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// Hard-fail if secret is missing: worker cannot render without a shared token.
const INTERNAL_API_TOKEN = (() => {
  const s = process.env.INTERNAL_API_SECRET;
  if (!s || s.length < 32) {
    console.error('[report-worker] INTERNAL_API_SECRET not set or too short — exiting');
    process.exit(1);
  }
  return s;
})();

const WORKER_PORT = parseInt(process.env.REPORT_WORKER_PORT || '3001', 10);

const REPORT_TITLE_TH = {
  daily: 'รายงานประจำวัน',
  weekly: 'รายงานรายสัปดาห์',
  monthly: 'รายงานรายเดือน',
  health: 'รายงานสุขภาพระบบ',
};

// ── Helpers (copied from api-server — NOT moved to avoid touching those call sites) ──

async function getBrandForReport() {
  const b = {};
  try {
    const r = await pool.query("SELECT key, value FROM system_settings WHERE key LIKE 'brand_%'");
    for (const row of r.rows) {
      if (row.key === 'brand_name')          b.name = row.value;
      if (row.key === 'brand_primary_color') b.primary_color = row.value;
      if (row.key === 'brand_logo_path' && row.value) {
        b.logo_url = `${API_BASE_URL}/branding/${row.value}`;
      }
    }
  } catch { /* defaults */ }
  return b;
}

let _displayTz = 'Asia/Bangkok';
let _displayTzAt = 0;
async function getDisplayTz() {
  if (Date.now() - _displayTzAt < 60_000) return _displayTz;
  try {
    const r = await pool.query("SELECT value FROM system_settings WHERE key='display_timezone'");
    const v = r.rows[0]?.value;
    if (typeof v === 'string' && v.trim()) _displayTz = v.trim();
  } catch {}
  _displayTzAt = Date.now();
  return _displayTz;
}

// ── Date helpers (moved from api-server) ──────────────────

function todayDayOfMonthInTz(tz) {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  return parseInt(ymd.slice(8, 10), 10);
}

function todayDayOfWeekInTz(tz) {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const d = new Date(ymd + 'T00:00:00Z');
  return (d.getUTCDay() + 6) % 7;
}

function isLastDayOfMonthInTz(tz) {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const [y, m, d] = ymd.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d === lastDay;
}

// ── Scheduled report runner (moved from api-server) ───────

async function runScheduledReport(schedule) {
  const reportRenderer = require('./report-renderer');
  const lineSender = require('./line-sender');
  const record = (status, err) => pool.query(
    `UPDATE report_schedules SET last_run_at = NOW(), last_status = $2, last_error = $3 WHERE id = $1`,
    [schedule.id, status, err ? String(err).slice(0, 500) : null]
  ).catch(() => {});
  const logHistory = (fields) => pool.query(
    `INSERT INTO report_history
       (schedule_id, report_type, range_from, range_to, image_layout,
        file_path, recipients_sent, sent_count, total_recipients, status, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      schedule.id, fields.report_type, fields.range_from || null, fields.range_to || null,
      fields.image_layout || null, fields.file_path || null, fields.recipients_sent || null,
      fields.sent_count || 0, fields.total_recipients || 0,
      fields.status, fields.error_message ? String(fields.error_message).slice(0, 500) : null,
    ]
  ).catch(() => {});

  try {
    const cfgRes = await pool.query('SELECT * FROM line_config WHERE id = 1');
    const cfg = cfgRes.rows[0];
    if (!cfg || !cfg.enabled || !cfg.channel_access_token) {
      await record('failed', 'LINE is not enabled / no channel access token');
      await logHistory({ report_type: schedule.report_type, image_layout: schedule.image_layout, status: 'failed', error_message: 'LINE is not enabled / no channel access token' });
      console.warn(`📅 schedule #${schedule.id}: LINE not configured — skipped`);
      return;
    }
    const roster = Array.isArray(cfg.recipients) ? cfg.recipients : [];
    let wanted = String(schedule.recipients || '').split(',').map(s => s.trim()).filter(Boolean);
    if (wanted.length === 0) wanted = roster.filter(r => r.enabled).map(r => r.id);
    const recipientIds = roster.filter(r => r.enabled && wanted.includes(r.id)).map(r => r.id);
    if (recipientIds.length === 0) {
      await record('failed', 'no enabled LINE recipients');
      await logHistory({ report_type: schedule.report_type, image_layout: schedule.image_layout, status: 'failed', error_message: 'no enabled LINE recipients' });
      console.warn(`📅 schedule #${schedule.id}: no recipients — skipped`);
      return;
    }

    const title = REPORT_TITLE_TH[schedule.report_type] || schedule.report_type;
    const brand = await getBrandForReport();
    let png, fname, rangeFrom, rangeTo, rangeLabel;

    if (schedule.report_type === 'health') {
      const sections = Array.isArray(schedule.health_sections) && schedule.health_sections.length
        ? schedule.health_sections : null;
      png = await reportRenderer.renderHealthReportImage({
        baseUrl: API_BASE_URL,
        internalToken: INTERNAL_API_TOKEN,
        brand, sections,
        range: { preset: '7d' },
        lang: 'th',
      });
      rangeFrom  = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      rangeTo    = new Date().toISOString();
      rangeLabel = '7 วันล่าสุด';
    } else {
      const range = reportRenderer.computeScheduledRange(schedule.report_type);
      rangeFrom  = range.from;
      rangeTo    = range.to;
      rangeLabel = range.label;
      png = await reportRenderer.renderReportImage({
        baseUrl: API_BASE_URL,
        internalToken: INTERNAL_API_TOKEN,
        from: range.from, to: range.to,
        brand, title, rangeLabel,
        layout: schedule.image_layout || 'compact',
      });
    }

    const tzForName = await getDisplayTz();
    const fnameDate = new Date(rangeFrom).toLocaleDateString('sv', { timeZone: tzForName });
    fname = `report_${schedule.report_type}_${fnameDate}_${Date.now()}.png`;
    await fs.promises.writeFile(path.join(REPORTS_DIR, fname), png).catch(() => {});

    const result = await lineSender.sendReportToLine({
      token: cfg.channel_access_token,
      imgbbKey: cfg.imgbb_api_key,
      recipients: recipientIds,
      pngBuffer: png,
      caption: `📊 ${title}\n${rangeLabel}`,
    });
    if (result.success) {
      await record('success', null);
      await logHistory({
        report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
        image_layout: schedule.image_layout || null, file_path: fname,
        recipients_sent: recipientIds.join(','), sent_count: result.sentCount,
        total_recipients: result.totalRecipients || recipientIds.length, status: 'success',
      });
      console.log(`📅 schedule #${schedule.id} (${schedule.report_type}) → sent to ${result.sentCount} LINE recipient(s)`);
    } else {
      const errMsg = result.error || `sent ${result.sentCount}/${result.totalRecipients}`;
      await record('failed', errMsg);
      await logHistory({
        report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
        image_layout: schedule.image_layout || null, file_path: fname,
        recipients_sent: recipientIds.join(','), sent_count: result.sentCount || 0,
        total_recipients: result.totalRecipients || recipientIds.length,
        status: 'failed', error_message: errMsg,
      });
      console.error(`📅 schedule #${schedule.id} → LINE send failed:`, result.error);
    }
  } catch (e) {
    await record('failed', e.message);
    await logHistory({ report_type: schedule.report_type, image_layout: schedule.image_layout, status: 'failed', error_message: e.message });
    console.error(`📅 schedule #${schedule.id} failed:`, e.message);
  }
}

// ── Scheduler loop (moved from api-server) ────────────────

async function checkReportSchedules() {
  _lastSchedulerCheckAt = new Date().toISOString();
  try {
    const tz = await getDisplayTz();
    const nowHHMM = new Date().toLocaleTimeString('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    const { rows } = await pool.query('SELECT * FROM report_schedules WHERE enabled = true');
    for (const s of rows) {
      const sendHHMM = String(s.send_time).slice(0, 5);
      if (sendHHMM !== nowHHMM) continue;
      if (s.last_run_at) {
        const ranStr = new Date(s.last_run_at).toLocaleDateString('en-CA', { timeZone: tz });
        if (ranStr === todayStr) continue;
      }
      if ((s.report_type === 'weekly' || s.report_type === 'health') &&
          s.send_day_of_week !== null && s.send_day_of_week !== undefined) {
        if (todayDayOfWeekInTz(tz) !== s.send_day_of_week) continue;
      }
      if (s.report_type === 'monthly' && s.send_days_of_month) {
        const todayDom = todayDayOfMonthInTz(tz);
        const isLast = isLastDayOfMonthInTz(tz);
        const days = String(s.send_days_of_month).split(',').map(x => x.trim()).filter(Boolean);
        const match = days.some(spec => {
          if (spec.toUpperCase() === 'L') return isLast;
          const n = parseInt(spec, 10);
          return Number.isFinite(n) && n === todayDom;
        });
        if (!match) continue;
      }
      await runScheduledReport(s);
    }
  } catch (e) { console.error('📅 scheduler check failed:', e.message); }
}

setInterval(checkReportSchedules, 60 * 1000);

// ── On-demand HTTP server (Step 3) ────────────────────────
// Binds to 127.0.0.1 only — never reachable from outside the host.

function isValidInternalToken(token) {
  if (typeof token !== 'string' || token.length !== INTERNAL_API_TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(INTERNAL_API_TOKEN));
  } catch { return false; }
}

const workerServer = http.createServer(async (req, res) => {
  // Health endpoint — no token required, loopback-only
  if (req.method === 'GET' && req.url === '/health') {
    const t0 = Date.now();
    pool.query('SELECT 1')
      .then(() => {
        const body = {
          ok: true,
          worker: 'report-worker',
          uptime_sec: Math.floor((Date.now() - _workerStartedAt) / 1000),
          pid: process.pid,
          memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          db: { ok: true, latency_ms: Date.now() - t0 },
          scheduler: { last_check_at: _lastSchedulerCheckAt },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      })
      .catch((e) => {
        const body = {
          ok: false,
          worker: 'report-worker',
          uptime_sec: Math.floor((Date.now() - _workerStartedAt) / 1000),
          pid: process.pid,
          memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          db: { ok: false, latency_ms: null, error: e.message },
          scheduler: { last_check_at: _lastSchedulerCheckAt },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    return;
  }

  const match = req.method === 'POST' && /^\/run\/(\d+)$/.exec(req.url);
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  if (!isValidInternalToken(req.headers['x-internal-token'])) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const id = parseInt(match[1], 10);
  let row;
  try {
    const { rows } = await pool.query('SELECT * FROM report_schedules WHERE id = $1', [id]);
    if (!rows.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'schedule not found' }));
      return;
    }
    row = rows[0];
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
  runScheduledReport(row).catch((e) =>
    console.error(`[report-worker] on-demand run #${id} failed:`, e.message)
  );
});

workerServer.listen(WORKER_PORT, '127.0.0.1', () => {
  console.log(`[report-worker] HTTP listening on 127.0.0.1:${WORKER_PORT}`);
});

console.log(`[report-worker] started — scheduler 60s, api-server at ${API_BASE_URL}`);
