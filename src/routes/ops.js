// ============================================================
// Vigil Platform — Routes: Ops (Push tokens, Alert logs, Backups)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const path = require('path');
const fs   = require('fs');
const { execFile } = require('child_process');
const routeError = require('../helpers/routeError');
const { siteWhere } = require('../auth');

const BACKUPS_DIR = path.join(__dirname, '..', '..', 'backups');
const BACKUP_RE   = /^vigil_platform_[0-9_-]+\.dump$/;

module.exports = function opsRoutes(app, pool, { auth, getIP }) {

  // ── Push notification token registry (mobile app) ───────────
  // Mobile ส่ง Expo push token หลัง login. UPSERT by token —
  // re-register อัปเดต last_seen + เปิดใหม่ถ้าเคยถูกปิด.
  app.post('/api/push/register', auth.requireAuth, async (req, res) => {
    try {
      const { token, platform, notify_alert, notify_face } = req.body || {};
      if (!token || typeof token !== 'string' || !token.startsWith('ExponentPushToken')) {
        return res.status(400).json({ error: 'invalid token' });
      }
      const nAlert = notify_alert !== false;   // default true
      const nFace  = notify_face  !== false;
      await pool.query(
        `INSERT INTO push_tokens (token, user_id, platform, enabled, notify_alert, notify_face, last_seen_at)
           VALUES ($1, $2, $3, TRUE, $4, $5, NOW())
         ON CONFLICT (token) DO UPDATE
           SET user_id = $2, platform = $3, enabled = TRUE,
               notify_alert = $4, notify_face = $5, last_seen_at = NOW()`,
        [token, req.user?.id ?? null, (platform || '').slice(0, 10), nAlert, nFace]
      );
      res.json({ success: true });
    } catch (err) { routeError(res, err, 'POST /api/push/register'); }
  });

  // ปิด token (logout) — ไม่ลบ เผื่อ re-login device เดิม
  app.post('/api/push/unregister', auth.requireAuth, async (req, res) => {
    try {
      const { token } = req.body || {};
      if (token) await pool.query(`UPDATE push_tokens SET enabled = FALSE WHERE token = $1`, [token]);
      res.json({ success: true });
    } catch (err) { routeError(res, err, 'POST /api/push/unregister'); }
  });

  // ── Alert Logs (read + filter) ──────────────────────────────
  // Site-scoped: a viewer only sees alert log entries for cameras in their
  // allowedSites (same pattern as events/faces/appearances/lpr routes).
  app.get('/api/alert-logs', async (req, res) => {
    try {
      const { limit = 100, ruleId, cameraId, status, since } = req.query;
      const where = [];
      const values = [];
      let idx = 1;
      if (ruleId)   { where.push(`rule_id = $${idx++}`);   values.push(parseInt(ruleId)); }
      if (cameraId) { where.push(`camera_id = $${idx++}`); values.push(cameraId); }
      if (status)   { where.push(`status = $${idx++}`);    values.push(status); }
      if (since)    { where.push(`sent_at >= $${idx++}`);  values.push(since); }
      const sw = siteWhere(req.user?.allowedSites ?? null, 'camera_id', idx);
      if (sw.sql) { where.push(sw.sql.replace(/^AND /, '')); values.push(...sw.args); idx += sw.args.length; }
      const sql = `SELECT * FROM alert_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sent_at DESC LIMIT $${idx}`;
      values.push(parseInt(limit));
      const { rows } = await pool.query(sql, values);
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/alert-logs'); }
  });

  app.get('/api/alert-logs/stats', async (req, res) => {
    try {
      const WINDOWS = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
      const win = WINDOWS[req.query.window] || '24 hours';
      const sw = siteWhere(req.user?.allowedSites ?? null, 'camera_id', 2);
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status='success')            AS success,
          COUNT(*) FILTER (WHERE status='failed')             AS failed,
          COUNT(*) FILTER (WHERE status='cooldown_skip')      AS cooldown_skip,
          COUNT(*) FILTER (WHERE status='quiet_hours_skip')   AS quiet_hours_skip,
          COUNT(*) FILTER (WHERE status='no_recipients')      AS no_recipients,
          COUNT(*) FILTER (WHERE status='disabled')           AS disabled,
          COUNT(*)                                            AS total,
          COALESCE(SUM(recipient_count) FILTER (WHERE status='success'), 0) AS line_messages_sent,
          ROUND(AVG(duration_ms) FILTER (WHERE status='success'))           AS avg_duration_ms
        FROM alert_logs
        WHERE sent_at >= NOW() - $1::INTERVAL ${sw.sql}`, [win, ...sw.args]);
      const r = rows[0];
      const success = parseInt(r.success, 10);
      const failed  = parseInt(r.failed,  10);
      const denom   = success + failed;
      res.json({
        window:             req.query.window || '24h',
        success,
        failed,
        cooldown_skip:      parseInt(r.cooldown_skip,    10),
        quiet_hours_skip:   parseInt(r.quiet_hours_skip, 10),
        no_recipients:      parseInt(r.no_recipients,    10),
        disabled:           parseInt(r.disabled,         10),
        total:              parseInt(r.total,             10),
        line_messages_sent: parseInt(r.line_messages_sent, 10),
        avg_duration_ms:    r.avg_duration_ms ? parseInt(r.avg_duration_ms, 10) : null,
        success_rate:       denom > 0 ? Math.round(success / denom * 100) : null,
      });
    } catch (e) { routeError(res, e, 'GET /api/alert-logs/stats'); }
  });

  // Admin-only: was reachable by any authenticated user (including viewer) —
  // the "ลบ Log เก่า" button is hidden client-side for viewers via
  // .admin-only CSS, but the endpoint itself had no server-side gate, so a
  // viewer could TRUNCATE alert_logs directly via the API.
  app.delete('/api/alert-logs', auth.requireAdmin, async (req, res) => {
    try {
      const { olderThanDays } = req.query;
      if (olderThanDays) {
        await pool.query(`DELETE FROM alert_logs WHERE sent_at < NOW() - ($1 * INTERVAL '1 day')`,
          [parseInt(olderThanDays, 10) || 90]);
      } else {
        await pool.query('TRUNCATE alert_logs');
      }
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'DELETE /api/alert-logs'); }
  });

  // ── Backup / Restore (admin-gated) ─────────────────────────
  // List + trigger pg_dump (scripts/backup.sh). Restore stays CLI-only
  // (destructive — see scripts/restore.sh); the UI only shows the command.
  app.get('/api/backups', auth.requireAdminOrAuditor, (req, res) => {
    try {
      const files = fs.existsSync(BACKUPS_DIR)
        ? fs.readdirSync(BACKUPS_DIR).filter(f => BACKUP_RE.test(f)) : [];
      const list = files.map(f => {
        const st = fs.statSync(path.join(BACKUPS_DIR, f));
        return { filename: f, size: st.size, mtime: st.mtime };
      }).sort((a, b) => b.mtime - a.mtime);
      res.json({ backups: list });
    } catch (e) { routeError(res, e, 'GET /api/backups'); }
  });

  app.post('/api/backups/run', auth.requireAdmin, (req, res) => {
    const script = path.join(__dirname, '..', '..', 'scripts', 'backup.sh');
    execFile('bash', [script], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[POST /api/backups/run] backup failed:', stderr || err.message);
        return res.status(500).json({ ok: false, error: 'Internal server error', code: 'ERR_INTERNAL' });
      }
      res.json({ ok: true, output: (stdout || '').trim() });
    });
  });

  app.get('/api/backups/:filename', auth.requireAdmin, async (req, res) => {
    const fn = req.params.filename;
    if (!BACKUP_RE.test(fn)) return res.status(400).end();
    const file = path.join(BACKUPS_DIR, fn);
    if (!fs.existsSync(file)) return res.status(404).end();
    try {
      const stat = fs.statSync(file);
      await auth.logAudit(req.user?.id, req.user?.username, 'backup_download', null, null, getIP(req), req.headers['user-agent'], {
        filename: fn, size_bytes: stat.size,
      });
    } catch (e) {
      console.error('audit log failed for backup download:', e.message);
    }
    res.download(file);
  });

};
