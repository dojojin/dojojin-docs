// ============================================================
// Vigil Platform — Routes: LPR Alerts (RF-ALERT — watch-list hits)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// An "alert" = an anprAlarm event whose plate matches an ACTIVE lpr_watchlist
// entry. The match condition reuses the exact, proven join already used by the
// /api/lpr/stats watch KPI: w.plate_number = UPPER(lp.plate_number) AND w.active.
// Ack state lives in lpr_alert_acks (mirror of face_event_acks / FP5).
'use strict';

const { siteWhere } = require('../auth');

// Asia/Bangkok local day boundary (api-server forces session TZ = UTC; see lpr-query.js).
const BKK_DAY = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date::timestamp AT TIME ZONE 'Asia/Bangkok'`;

module.exports = function lprAlertRoutes(app, pool) {
  // Shared FROM + watch-list match (the proven join) — anprAlarm ⨝ active watch-list.
  const BASE =
    `FROM events e
       JOIN license_plates lp ON lp.event_id = e.id
       JOIN lpr_watchlist  w  ON w.plate_number = UPPER(lp.plate_number) AND w.active
       LEFT JOIN lpr_alert_acks ack ON ack.event_id = e.id
      WHERE e.event_type = 'anprAlarm'`;

  // GET /api/lpr/alerts — paginated watch-list hits. Filters: group_id, q, from, to.
  app.get('/api/lpr/alerts', async (req, res) => {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const where = [];
    const args = [];
    const add = (clause, val) => { args.push(val); where.push(clause.replace('$$', `$${args.length}`)); };
    if (req.query.group_id) add(`w.group_id = $$`, req.query.group_id);
    if (req.query.q) {
      // one value across 4 columns → push once, reference $N four times
      args.push(`%${String(req.query.q).trim()}%`);
      const p = `$${args.length}`;
      where.push(`(lp.plate_number ILIKE ${p} OR lp.region ILIKE ${p} OR w.label ILIKE ${p} OR w.notes ILIKE ${p})`);
    }
    if (req.query.from)     add(`e.event_time >= $$`, req.query.from);
    if (req.query.to)       add(`e.event_time <= $$`, req.query.to);
    if (req.query.cameras) {
      const a = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (a.length) add(`e.camera_id = ANY($$)`, a);
    }
    // Site-RBAC P2
    const swA = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', args.length + 1);
    if (swA.sql) { where.push(swA.sql.replace(/^AND /, '')); args.push(...swA.args); }
    const whereSql = where.length ? ' AND ' + where.join(' AND ') : '';
    try {
      const [rows, cnt] = await Promise.all([
        pool.query(
          `SELECT e.id, e.event_time, e.camera_id,
                  e.snapshot_filename AS snapshot_file, e.raw_json,
                  lp.plate_number, lp.region, lp.vehicle_type, lp.vehicle_color,
                  lp.vehicle_brand, lp.plate_image, lp.confidence,
                  w.label AS wl_label, w.group_id, w.notes AS wl_notes,
                  w.ref_image, w.alert_mode,
                  ack.acked_by, ack.acked_at
             ${BASE}${whereSql}
            ORDER BY e.event_time DESC
            LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
          [...args, limit, offset]
        ),
        pool.query(`SELECT COUNT(*) ${BASE}${whereSql}`, args),
      ]);
      res.set('X-Total-Count', cnt.rows[0].count);
      res.json(rows.rows);
    } catch (e) {
      console.error('[lpr-alerts] GET /api/lpr/alerts:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/alerts/count — badge: today's hits + unacknowledged total.
  app.get('/api/lpr/alerts/count', async (req, res) => {
    try {
      const swC = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', 1);
      const r = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE e.event_time >= ${BKK_DAY})::int AS today,
                COUNT(*) FILTER (WHERE ack.event_id IS NULL)::int         AS unacked
           ${BASE} ${swC.sql}`,
        swC.args
      );
      res.json(r.rows[0] || { today: 0, unacked: 0 });
    } catch (e) {
      console.error('[lpr-alerts] GET /api/lpr/alerts/count:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /api/lpr/alerts/:id/ack — acknowledge a hit (upsert; mirror FP5 face ack).
  app.post('/api/lpr/alerts/:id/ack', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    try {
      if (req.user?.isSiteScoped) {
        const chk = await pool.query(
          'SELECT 1 FROM events WHERE id = $1 AND camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($2))',
          [id, req.user.allowedSites]);
        if (!chk.rowCount) return res.status(403).json({ error: 'forbidden' });
      }
      const r = await pool.query(
        `INSERT INTO lpr_alert_acks (event_id, acked_by, acked_by_id, acked_at)
              VALUES ($1, $2, $3, now())
         ON CONFLICT (event_id) DO UPDATE
              SET acked_by = EXCLUDED.acked_by, acked_by_id = EXCLUDED.acked_by_id, acked_at = now()
         RETURNING acked_by, acked_at`,
        [id, req.user?.username || null, req.user?.id || null]);
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[lpr-alerts] POST /api/lpr/alerts/:id/ack:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });
};
