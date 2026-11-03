// ============================================================
// Vigil Platform — Routes: Statistics (occupancy / density)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แยกออกจาก routes/stats.js — route ทั้งหมดในไฟล์นี้ยังลงทะเบียนที่ตำแหน่งเดิมเป๊ะ
// (ลำดับการลงทะเบียนคือพฤติกรรม: Express จับคู่ตามลำดับที่ลงทะเบียน)
// helper ที่ใช้ร่วมกับไฟล์แม่รับผ่าน deps ตัวเดียว ไม่ทำสำเนา
'use strict';

const routeError = require('../helpers/routeError');
const { siteWhere, resolveSiteScope, scopedCameraIds } = require('../auth');

module.exports = function statsOccupancyRoutes(app, pool, {
  parseRange,
  getDisplayTz,
  occupancy,
  occupancySmoothMs,
}) {

  // ── Occupancy routes ──────────────────────────────────────────

  // GET /api/stats/occupancy — snapshot of current "People in Area" per
  // camera/rule. Smoothed `current` is what the UI should display; `raw` is
  // the latest unsmoothed sample for diagnostics.
  app.get('/api/stats/occupancy', async (req, res) => {
    try {
      const allowedSites = resolveSiteScope(req);
      let allowedCams = null;
      if (allowedSites !== null) {
        if (allowedSites.length === 0) return res.json({ cameras: [], smoothing_window_ms: occupancySmoothMs });
        allowedCams = await scopedCameraIds(allowedSites, pool);   // รวมแกนกล้องด้วย (GOTCHAS #166)
      }
      const cams = [];
      const now = Date.now();
      for (const [cameraId, perCam] of occupancy.entries()) {
        if (allowedCams && !allowedCams.has(cameraId)) continue;
        for (const [ruleName, entry] of perCam.entries()) {
          cams.push({
            camera_id: cameraId,
            rule_name: ruleName,
            current: entry.smoothed,
            raw: entry.raw,
            samples: entry.samples.length,
            last_update: entry.lastUpdate ? new Date(entry.lastUpdate).toISOString() : null,
            stale_sec: entry.lastUpdate ? Math.floor((now - entry.lastUpdate) / 1000) : null,
          });
        }
      }
      res.json({ cameras: cams, smoothing_window_ms: occupancySmoothMs });
    } catch (err) { routeError(res, err, 'GET /api/stats/occupancy', req); }
  });

  // GET /api/stats/occupancy/sources?from=ISO&to=ISO
  // Distinct (camera_id, rule_name) pairs that have CountAggregation/Counter
  // samples in the range — used by the Density charts' camera+rule dropdown.
  // Was previously sourced from the in-memory occupancy tracker, but that
  // Map is emptied on every api-server restart and only repopulates when new
  // events arrive, so the dropdown looked empty even when DB had thousands of
  // historical samples. DB is the source of truth here.
  app.get('/api/stats/occupancy/sources', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      if (to.getTime() <= from.getTime()) return res.status(400).json({ error: 'to must be after from' });
      const swOCCS = siteWhere(resolveSiteScope(req), 'camera_id', 3);
      const { rows } = await pool.query(`
        SELECT camera_id,
               (raw_json->'Source'->>'Rule') AS rule_name,
               COUNT(*)::int                 AS samples,
               MAX(event_time)::text         AS last_seen
          FROM events
         WHERE event_type = 'CountAggregation/Counter'
           AND event_time >= $1::timestamptz
           AND event_time <  $2::timestamptz
           AND (raw_json->'Source'->>'Rule') IS NOT NULL
           ${swOCCS.sql}
         GROUP BY camera_id, (raw_json->'Source'->>'Rule')
         ORDER BY samples DESC`, [from.toISOString(), to.toISOString(), ...swOCCS.args]);
      res.json({ sources: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/occupancy/sources', req); }
  });

  // GET /api/stats/occupancy/timeline?from=ISO&to=ISO[&camera_id=X][&rule_name=Y]
  // Historical density: aggregates CountAggregation/Counter samples into time
  // buckets (auto-picked from range length) and returns avg + max per bucket.
  // Driven by the raw events already stored — no schema change.
  //   - avg = "typical density during that period" (smoothed)
  //   - max = "peak density during that period" (worst-case)
  //   - samples = how many Bosch fires landed in the bucket (data quality)
  // Buckets are aligned to the display_timezone so a Thai user sees their
  // own calendar hours, matching the existing Activity Heatmap card.
  app.get('/api/stats/occupancy/timeline', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      if (to.getTime() <= from.getTime()) return res.status(400).json({ error: 'to must be after from' });

      const rangeMs = to.getTime() - from.getTime();
      let bucketSec;
      if      (rangeMs <=   4 * 3600 * 1000) bucketSec = 60;     // ≤4h  → 1m
      else if (rangeMs <=  24 * 3600 * 1000) bucketSec = 300;    // ≤24h → 5m
      else if (rangeMs <=   7 * 86400 * 1000) bucketSec = 3600;  // ≤7d  → 1h
      else                                    bucketSec = 86400; // >7d  → 1d

      const cameraId = req.query.camera_id || null;
      const ruleName = req.query.rule_name || null;

      const params = [from.toISOString(), to.toISOString(), `${bucketSec} seconds`];
      let where = `event_type = 'CountAggregation/Counter'
                   AND event_time >= $1::timestamptz
                   AND event_time <  $2::timestamptz`;
      if (cameraId) { params.push(cameraId); where += ` AND camera_id = $${params.length}`; }
      if (ruleName) { params.push(ruleName); where += ` AND raw_json->'Source'->>'Rule' = $${params.length}`; }
      const swOCCTL = siteWhere(resolveSiteScope(req), 'camera_id', params.length + 1);
      if (swOCCTL.sql) { where += ` ${swOCCTL.sql}`; params.push(...swOCCTL.args); }

      // date_bin (PG14+) buckets timestamps to fixed-width intervals. Anchored
      // at the unix epoch in UTC so buckets align with wall-clock minutes/hours.
      const sql = `
        SELECT date_bin($3::interval, event_time, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket,
               AVG((raw_json->'Data'->>'Count')::int)::numeric(10,2) AS avg_count,
               MAX((raw_json->'Data'->>'Count')::int)                AS max_count,
               COUNT(*)::int                                          AS samples
          FROM events
         WHERE ${where}
         GROUP BY 1
         ORDER BY 1`;
      const { rows } = await pool.query(sql, params);

      res.json({
        from: from.toISOString(),
        to:   to.toISOString(),
        bucket_sec: bucketSec,
        camera_id: cameraId,
        rule_name: ruleName,
        buckets: rows.map(r => ({
          ts: new Date(r.bucket).toISOString(),
          avg: parseFloat(r.avg_count) || 0,
          max: r.max_count,
          samples: r.samples,
        })),
      });
    } catch (err) { routeError(res, err, 'GET /api/stats/occupancy/timeline', req); }
  });

  // GET /api/stats/occupancy/heatmap?from=ISO&to=ISO[&camera_id=X][&rule_name=Y]
  // Phase 2 of density viz: 7×24 grid of avg + peak occupancy by
  // (day-of-week × hour), aligned to display_timezone. Uses the same source
  // rows as /api/stats/occupancy/timeline (CountAggregation/Counter) but
  // groups by dow+hour so you can spot weekly patterns ("Mondays at 10am
  // are always busy"). dow uses ISO ordering (0=Mon..6=Sun).
  app.get('/api/stats/occupancy/heatmap', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      if (to.getTime() <= from.getTime()) return res.status(400).json({ error: 'to must be after from' });
      const cameraId = req.query.camera_id || null;
      const ruleName = req.query.rule_name || null;
      const tz       = await getDisplayTz();

      const params = [from.toISOString(), to.toISOString(), tz];
      let where = `event_type = 'CountAggregation/Counter'
                   AND event_time >= $1::timestamptz
                   AND event_time <  $2::timestamptz`;
      if (cameraId) { params.push(cameraId); where += ` AND camera_id = $${params.length}`; }
      if (ruleName) { params.push(ruleName); where += ` AND raw_json->'Source'->>'Rule' = $${params.length}`; }
      const swOCCHM = siteWhere(resolveSiteScope(req), 'camera_id', params.length + 1);
      if (swOCCHM.sql) { where += ` ${swOCCHM.sql}`; params.push(...swOCCHM.args); }

      const { rows } = await pool.query(`
        SELECT (EXTRACT(isodow FROM event_time AT TIME ZONE $3)::int - 1) AS dow,
                EXTRACT(hour   FROM event_time AT TIME ZONE $3)::int      AS hour,
                AVG((raw_json->'Data'->>'Count')::int)::numeric(10,2)     AS avg_count,
                MAX((raw_json->'Data'->>'Count')::int)                    AS max_count,
                COUNT(*)::int                                              AS samples
          FROM events
         WHERE ${where}
         GROUP BY dow, hour
         ORDER BY dow, hour`, params);

      res.json({
        from: from.toISOString(),
        to:   to.toISOString(),
        tz,
        camera_id: cameraId,
        rule_name: ruleName,
        cells: rows.map(r => ({
          dow:  r.dow,
          hour: r.hour,
          avg:  parseFloat(r.avg_count) || 0,
          max:  r.max_count,
          samples: r.samples,
        })),
      });
    } catch (err) { routeError(res, err, 'GET /api/stats/occupancy/heatmap', req); }
  });
};
