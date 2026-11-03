// ============================================================
// Vigil Platform — Routes: Cameras (httpHost backup / repoint / restore)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แยกออกจาก routes/cameras.js — ลงทะเบียนที่ตำแหน่งเดิมเป๊ะ (คั่นกลางระหว่างสองกลุ่ม
// ของ cameras-probe.js) · `_edgeCall` ยังอยู่ที่ cameras.js เพราะ sd-status ใช้ร่วมกัน
'use strict';

const https = require('https');
const routeError = require('../helpers/routeError');
const { parseSlots: parseHttpHostSlots } = require('../helpers/httpHostXml');
const { edgeProxyBaseUrl } = require('../helpers/edgeProxyBaseUrl');
const env = require('../config');

module.exports = function camerasHttphostRoutes(app, pool, {
  auth, logCameraAudit: _logCameraAudit, resolveSiteCode, _edgeCall,
}) {

  // POST /api/cameras/:id/event-broker-status — proxy to edge lpr-receiver.
  // Edge reads the Bosch camera's ONVIF Event Broker (MQTT) config and compares
  // vs the edge's own broker. Read-only. :id is the saved camera_id when
  // editing; for a camera not saved yet it's just the typed draft id, so the
  // ── httpHost backup / repoint / restore (proxied to the owning edge) ──────
  // Central can't reach a camera on a site LAN, so all three of these are thin
  // proxies; the edge does the ISAPI work (see lpr-receiver.js). What lives
  // HERE is the durable part: the backup blob goes in postgres, not on the edge
  // box, because the whole point is to survive that box being rebuilt.
  //
  // Every mutation is audited — repointing an ANPR camera moves a live
  // government feed, so "who did this, when, and to what" has to be answerable.

  // GET /api/cameras/:id/httphost-backups — list what we already hold.
  // raw_xml is deliberately NOT returned here (it's bulky and the UI only needs
  // to know a backup exists + when); restore reads it server-side by id.
  app.get('/api/cameras/:id/httphost-backups', auth.requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, note, captured_by, captured_at,
                (SELECT count(*)::int FROM camera_httphost_backups b2 WHERE b2.camera_id = $1) AS total
           FROM camera_httphost_backups
          WHERE camera_id = $1
          ORDER BY captured_at ASC`, [req.params.id]);
      res.json({ backups: rows });
    } catch (e) { routeError(res, e, 'GET /api/cameras/:id/httphost-backups'); }
  });

  // POST /api/cameras/:id/httphost-backup — read the camera's CURRENT config
  // and store it. Refuses to add a second capture unless ?force=1: a careless
  // click AFTER cutover would otherwise bury the original CIB-pointing config
  // under a Vigil-pointing one, and the operator would never know.
  app.post('/api/cameras/:id/httphost-backup', auth.requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const { rows: existing } = await pool.query(
        `SELECT id, raw_xml, captured_at,
                (SELECT count(*)::int FROM camera_httphost_backups WHERE camera_id = $1) AS n
           FROM camera_httphost_backups WHERE camera_id = $1
          ORDER BY captured_at ASC LIMIT 1`, [id]);
      if (existing.length && req.query.force !== '1') {
        // Say WHAT is already held, not just that something is. A camera can be
        // deleted and re-added under the same id, which leaves a backup behind —
        // the operator then has to judge whether that older capture is still the
        // right thing to restore to, and "a backup exists" does not help them.
        return res.status(409).json({
          error: 'backup_exists',
          count: existing[0].n,
          existing: {
            id: existing[0].id,
            captured_at: existing[0].captured_at,
            slots: parseHttpHostSlots(existing[0].raw_xml),
          },
        });
      }

      const siteCode = await resolveSiteCode(pool, { camera_id: id });
      if (!siteCode) return res.status(404).json({ error: 'no edge site for this camera' });
      const r = await _edgeCall(siteCode, `/httphost-backup?camera_id=${encodeURIComponent(id)}`);
      // A camera-side failure arrives as 200 + ok:false (see _camFail on the
      // edge — 5xx would be replaced by a Cloudflare error page in transit).
      if (r.code !== 200 || r.json.ok === false) return res.status(r.code === 200 ? 502 : r.code).json(r.json);
      if (!r.json.raw_xml) return res.status(502).json({ error: 'edge returned no xml' });

      const { rows } = await pool.query(
        `INSERT INTO camera_httphost_backups (camera_id, raw_xml, note, captured_by)
         VALUES ($1,$2,$3,$4) RETURNING id, captured_at`,
        [id, r.json.raw_xml, (req.body?.note || '').slice(0, 200) || null, req.user?.username || null]);
      await _logCameraAudit(req, 'httphost_backup', id, { backup_id: rows[0].id, slots: r.json.slots });
      res.json({ ok: true, backup_id: rows[0].id, captured_at: rows[0].captured_at, slots: r.json.slots });
    } catch (e) { routeError(res, e, 'POST /api/cameras/:id/httphost-backup'); }
  });

  // POST /api/cameras/:id/httphost-set — repoint a slot at the owning edge's
  // own lpr-receiver. Gated on a backup existing: there is no undo for this
  // otherwise, and the config it overwrites is the only record of where the
  // camera used to push.
  app.post('/api/cameras/:id/httphost-set', auth.requireAdmin, async (req, res) => {
    try {
      const id   = req.params.id;
      const slot = parseInt(req.body?.slot, 10) || 1;
      // kind/format are pass-through, both optional. Omitted means the ANPR
      // behaviour this endpoint has always had: the LPR token, and the camera's
      // existing payload format left alone.
      const kind   = req.body?.kind === 'face' ? 'face' : 'lpr';
      const format = ['XML', 'JSON'].includes(String(req.body?.format || '').toUpperCase())
        ? String(req.body.format).toUpperCase() : undefined;
      const { rows: existing } = await pool.query(
        'SELECT count(*)::int AS n FROM camera_httphost_backups WHERE camera_id = $1', [id]);
      if (existing[0].n === 0) return res.status(412).json({ error: 'no_backup' });

      const siteCode = await resolveSiteCode(pool, { camera_id: id });
      if (!siteCode) return res.status(404).json({ error: 'no edge site for this camera' });
      const r = await _edgeCall(siteCode, '/httphost-set', { method: 'POST', body: JSON.stringify({ camera_id: id, slot, kind, format }) });
      if (r.code !== 200 || r.json.ok === false) return res.status(r.code === 200 ? 502 : r.code).json(r.json);
      await _logCameraAudit(req, 'httphost_repointed', id, { slot, kind, format, before: r.json.before, after: r.json.after });
      res.json(r.json);
    } catch (e) { routeError(res, e, 'POST /api/cameras/:id/httphost-set'); }
  });

  // POST /api/cameras/:id/httphost-restore — push a stored capture back to the
  // camera. Defaults to the OLDEST backup (the pre-cutover original), which is
  // what "undo" means here; an explicit backup_id overrides.
  app.post('/api/cameras/:id/httphost-restore', auth.requireAdmin, async (req, res) => {
    try {
      const id   = req.params.id;
      const slot = parseInt(req.body?.slot, 10) || 1;
      const bId  = parseInt(req.body?.backup_id, 10) || null;
      const { rows } = bId
        ? await pool.query('SELECT id, raw_xml FROM camera_httphost_backups WHERE id = $1 AND camera_id = $2', [bId, id])
        : await pool.query('SELECT id, raw_xml FROM camera_httphost_backups WHERE camera_id = $1 ORDER BY captured_at ASC LIMIT 1', [id]);
      if (!rows.length) return res.status(404).json({ error: 'no_backup' });

      const siteCode = await resolveSiteCode(pool, { camera_id: id });
      if (!siteCode) return res.status(404).json({ error: 'no edge site for this camera' });
      const r = await _edgeCall(siteCode, '/httphost-restore',
        { method: 'POST', body: JSON.stringify({ camera_id: id, slot, raw_xml: rows[0].raw_xml }) });
      if (r.code !== 200 || r.json.ok === false) return res.status(r.code === 200 ? 502 : r.code).json(r.json);
      await _logCameraAudit(req, 'httphost_restored', id, { slot, backup_id: rows[0].id, after: r.json.after });
      res.json({ ...r.json, backup_id: rows[0].id });
    } catch (e) { routeError(res, e, 'POST /api/cameras/:id/httphost-restore'); }
  });

  // body also carries site_id + raw ip/user/pass gathered straight from the
  // form — the edge tries the saved-camera lookup first, then falls back to
  // those inline credentials (see lpr-receiver.js).
  app.post('/api/cameras/:id/event-broker-status', auth.requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const { site_id, ip_address, http_port, username, password } = req.body || {};
      const siteCode = await resolveSiteCode(pool, { camera_id: id, site_id });
      if (!siteCode) return res.status(404).json({ error: 'no edge site — select a site, or save the camera first' });
      const edgeUrl  = edgeProxyBaseUrl(siteCode, env.str('SNAPSHOT_PROXY_DOMAIN'));
      const secret   = env.str('SNAPSHOT_PROXY_SECRET');
      if (!secret) return res.status(503).json({ error: 'SNAPSHOT_PROXY_SECRET not configured' });
      const body = JSON.stringify({ camera_id: id, ip_address, http_port, username, password });
      const url  = `${edgeUrl}/event-broker-status`;
      const preq = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${secret}` }, timeout: 8000 }, (pr) => {
        let b = '';
        pr.on('data', d => { b += d; });
        pr.on('end', () => {
          try { res.status(pr.statusCode).json(JSON.parse(b)); }
          catch { res.status(502).json({ error: 'bad edge response' }); }
        });
      });
      preq.on('error', (e) => res.status(502).json({ error: e.message }));
      preq.write(body); preq.end();
    } catch (e) { routeError(res, e, 'POST /api/cameras/:id/event-broker-status'); }
  });
};
