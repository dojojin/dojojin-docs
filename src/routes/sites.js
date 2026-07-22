// ============================================================
// Vigil Platform — Routes: Sites
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const { provisionSite, emqxLogin } = require('../site-provision');
const publishSiteConfig = require('../helpers/publishSiteConfig');

module.exports = function sitesRoutes(app, pool, { auth, loadCameraConfig } = {}) {
  // GET /api/sites — list sites with camera count + capability flags.
  // Site-scoped viewers (allowedSites = [ids]) only get their own sites, so
  // scope bars never render — or even leak the names of — sites they can't
  // access. admin/auditor (allowedSites = null) get all sites.
  // has_face/has_lpr/has_appearance let the frontend hide Face/LPR/Person nav
  // pages and report domains when none of the visible sites have that camera
  // type — single source used by both nav-hide (session-static) and the
  // reports scope bar (per active site chip). Each flag maps to exactly one
  // cam_role: face events come from cam_role='face' cameras, LPR plates from
  // cam_role='lpr', and appearance/person-detection data comes from
  // cam_role='standard' cameras' VCA (verified: face/lpr cameras produce 0
  // Person-class events on this platform) — NOT from face cameras, so
  // appearance is its own flag rather than reusing has_face.
  app.get('/api/sites', async (req, res) => {
    try {
      const allowed = req.user?.allowedSites ?? null;
      const params = [];
      let where = '';
      if (allowed !== null) { params.push(allowed); where = 'WHERE s.id = ANY($1)'; }
      const { rows } = await pool.query(
        `SELECT s.id, s.code, s.name, s.color,
                COUNT(c.id)::int AS camera_count,
                COALESCE(bool_or(c.cam_role = 'face'),     false) AS has_face,
                COALESCE(bool_or(c.cam_role = 'lpr'),      false) AS has_lpr,
                COALESCE(bool_or(c.cam_role = 'standard'), false) AS has_appearance
         FROM sites s
         LEFT JOIN cameras c ON c.site_id = s.id
         ${where}
         GROUP BY s.id
         ORDER BY s.id`,
        params
      );
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/sites'); }
  });

  // POST /api/sites — create site (admin only)
  app.post('/api/sites', auth.requireAdmin, async (req, res) => {
    try {
      const code  = String(req.body.code  || '').trim().toLowerCase();
      const name  = String(req.body.name  || '').trim();
      const color = String(req.body.color || '#6366f1').trim();
      if (!code || !/^[a-z0-9_-]{1,30}$/.test(code)) return res.status(400).json({ error: 'รหัส site ต้องเป็นตัวเล็ก a-z 0-9 _ - และยาวไม่เกิน 30 ตัว' });
      if (!name) return res.status(400).json({ error: 'กรุณาใส่ชื่อ Site' });
      const { rows } = await pool.query(
        `INSERT INTO sites (code, name, color) VALUES ($1,$2,$3) RETURNING id, code, name, color`,
        [code, name, color]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'รหัส site นี้มีอยู่แล้ว' });
      routeError(res, err, 'POST /api/sites');
    }
  });

  // PUT /api/sites/:id — edit name/color only (code is immutable after create)
  app.put('/api/sites/:id', auth.requireAdmin, async (req, res) => {
    try {
      const id    = parseInt(req.params.id, 10);
      const name  = String(req.body.name  || '').trim();
      const color = String(req.body.color || '').trim();
      if (!name) return res.status(400).json({ error: 'กรุณาใส่ชื่อ Site' });
      const { rows, rowCount } = await pool.query(
        `UPDATE sites SET name=$2, color=$3 WHERE id=$1 RETURNING id, code, name, color`,
        [id, name, color]
      );
      if (!rowCount) return res.status(404).json({ error: 'ไม่พบ Site' });
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'PUT /api/sites/:id'); }
  });

  // DELETE /api/sites/:id — delete site with guards (admin only)
  app.delete('/api/sites/:id', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const siteRow = await pool.query(`SELECT code FROM sites WHERE id=$1`, [id]);
      if (!siteRow.rowCount) return res.status(404).json({ error: 'ไม่พบ Site' });
      if (siteRow.rows[0].code === 'main') return res.status(400).json({ error: 'ไม่สามารถลบ Site หลักได้' });
      const camCount = await pool.query(`SELECT COUNT(*)::int AS n FROM cameras WHERE site_id=$1`, [id]);
      if (camCount.rows[0].n > 0) return res.status(409).json({ error: `ไม่สามารถลบได้ — มีกล้อง ${camCount.rows[0].n} ตัวอยู่ใน Site นี้ ย้ายกล้องออกก่อน` });
      await pool.query(`DELETE FROM sites WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/sites/:id'); }
  });

  // POST /api/sites/:id/provision-edge — create/rotate this site's edge MQTT
  // bridge identity (EMQX user edge-<code> + ACL projects/<code>/#). Admin only.
  // Reuses src/site-provision (same engine as the CLI). Returns credentials ONCE
  // (password is never stored); re-running ROTATES the password.
  app.post('/api/sites/:id/provision-edge', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const sr = await pool.query(`SELECT id, code, name, color FROM sites WHERE id=$1`, [id]);
      if (!sr.rowCount) return res.status(404).json({ error: 'ไม่พบ Site' });
      const site = sr.rows[0];
      const token = await emqxLogin(process.env.EMQX_DASHBOARD_PASSWORD);
      const out = await provisionSite(pool, token, { code: site.code, name: site.name, color: site.color });
      // audit — record who/which site; NEVER log the password
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || null, 'site_provision_edge',
         JSON.stringify({ site_id: site.id, code: site.code, mqtt_username: out.mqtt.username })]);
      res.json(out);
    } catch (err) { routeError(res, err, 'POST /api/sites/:id/provision-edge'); }
  });

  // POST /api/sites/:id/push-config — manually push cameras-config to edge
  // (initial bootstrap or force-resync). EC1 auto-fires on every camera save;
  // this endpoint handles the first-time push before any camera is edited.
  app.post('/api/sites/:id/push-config', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const sr = await pool.query(`SELECT id, code FROM sites WHERE id=$1`, [id]);
      if (!sr.rowCount) return res.status(404).json({ error: 'ไม่พบ Site' });
      const cameras = loadCameraConfig ? loadCameraConfig().cameras : [];
      const result = await publishSiteConfig(id, cameras, pool);
      res.json({ ok: true, ...result });
    } catch (err) { routeError(res, err, 'POST /api/sites/:id/push-config'); }
  });
};
