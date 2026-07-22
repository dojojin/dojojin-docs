// ============================================================
// Vigil Platform — Routes: Statistics
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const { siteWhere, resolveSiteScope } = require('../auth');

module.exports = function statsRoutes(app, pool, {
  getDisplayTz,
  METRIC_EVENT_TYPE_PATTERN,
  analyticsEventClause,
  occupancy,          // _occupancy Map from api-server.js (written by MQTT ingester)
  occupancySmoothMs,  // OCC_SMOOTH_WINDOW_MS
  loadCameraConfig,
}) {

  // ── Helpers (local to stats routes) ──────────────────────────

  function parseRange(q) {
    // Accept (a) explicit from/to ISO  (b) range= "1h"|"1d"|"7d"|"30d"
    let to   = q.to   ? new Date(q.to)   : new Date();
    let from = q.from ? new Date(q.from) : null;
    if (!from) {
      const r = q.range || '1d';
      const map = { '1h': 3600e3, '1d': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
      from = new Date(to.getTime() - (map[r] || map['1d']));
    }
    return { from, to };
  }

  function pickTruncUnit(fromMs, toMs) {
    const spanH = (toMs - fromMs) / 3600e3;
    if (spanH <= 48)  return 'hour';
    if (spanH <= 24 * 60) return 'day';   // up to 60 days
    return 'week';
  }

  // 30s TTL cache for today-counts (frontend polls every 60s)
  let _todayCountsCache = null, _todayCountsCacheAt = 0;
  const TODAY_COUNTS_TTL_MS = 30_000;

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
        const r = await pool.query('SELECT id FROM cameras WHERE site_id = ANY($1)', [allowedSites]);
        allowedCams = new Set(r.rows.map(row => row.id));
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
    } catch (err) { routeError(res, err, 'GET /api/stats/occupancy'); }
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
    } catch (err) { routeError(res, err, 'GET /api/stats/occupancy/sources'); }
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
    } catch (err) { routeError(res, err, 'GET /api/stats/occupancy/timeline'); }
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
    } catch (err) { routeError(res, err, 'GET /api/stats/occupancy/heatmap'); }
  });

  // ── Core statistics routes ────────────────────────────────────

  // Time series: TOTAL EVENTS + ALERTS (2 lines)
  // Alerts = events with rule_name set (intentional alerts)
  app.get('/api/stats/timeline', async (req, res) => {
    const { from, to, cameras, granularity = 'hour' } = req.query;
    try {
      const truncUnit = granularity === 'hour' ? 'hour' : granularity === 'day' ? 'day' : 'week';
      let sql = `SELECT
                   DATE_TRUNC('${truncUnit}', event_time) AS bucket,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name != '')::int AS alerts
                 FROM events WHERE 1=1`;
      const params = [];
      let n = 0;
      if (from) { sql += ` AND event_time >= $${++n}`; params.push(from); }
      if (to)   { sql += ` AND event_time <= $${++n}`; params.push(to); }
      if (cameras) {
        sql += ` AND camera_id = ANY($${++n})`;
        params.push(cameras.split(','));
      }
      const swTL = siteWhere(req.user?.allowedSites ?? null, 'camera_id', n + 1);
      if (swTL.sql) { sql += ` ${swTL.sql}`; params.push(...swTL.args); n += swTL.args.length; }
      sql += ` GROUP BY bucket ORDER BY bucket ASC`;
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/stats/timeline'); }
  });

  // Per-camera "today" counts — used by Camera Status dashboard.
  // "Today" = midnight in display_timezone (Asia/Bangkok by default) → now.
  // Replaces the buggy client-side filter from allEvents (capped at 300 = severe undercount).
  // 30s TTL cache: frontend polls every 60s; data doesn't need sub-minute freshness (Phase 3 opt, O6)
  app.get('/api/stats/today-counts', async (req, res) => {
    try {
      const now = Date.now();
      const isScoped = req.user?.isSiteScoped;
      if (!isScoped && _todayCountsCache && now - _todayCountsCacheAt < TODAY_COUNTS_TTL_MS) {
        return res.json(_todayCountsCache);
      }
      const tz = await getDisplayTz();
      const swTC = siteWhere(req.user?.allowedSites ?? null, 'camera_id', 2);
      const r = await pool.query(`
        SELECT camera_id,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE object_class = 'Person' AND event_type NOT LIKE 'FaceDetector/%')::int AS persons,
               COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle') OR event_type = 'anprAlarm')::int AS vehicles,
               COUNT(*) FILTER (WHERE event_type LIKE 'FaceCapture%')::int AS faces,
               -- Dahua NVR face channels: FaceDetector/Comparison is the recognition
               -- result (twin of FaceDetector/Recognized — count only Comparison so a
               -- face isn't double-counted). listType set → blacklist (known/watch),
               -- null → miss (ไม่รู้จัก).
               COUNT(*) FILTER (WHERE event_type IN ('FaceRecognition','FaceDetector/Comparison') AND raw_json->>'listType' IS NOT NULL)::int AS face_matches,
               COUNT(*) FILTER (WHERE event_type IN ('FaceRecognition','FaceDetector/Comparison') AND raw_json->>'listType' IS NULL)::int AS face_miss,
               MAX(event_time) AS last_event
          FROM events
         WHERE event_time >= date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1
           AND event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
           ${swTC.sql}
         GROUP BY camera_id`, [tz, ...swTC.args]);

      const cameras = {};
      let totalAll = 0;
      for (const row of r.rows) {
        cameras[row.camera_id] = {
          total: row.total,
          persons: row.persons,
          vehicles: row.vehicles,
          faces: row.faces,
          face_matches: row.face_matches,
          face_miss: row.face_miss,
          last_event: row.last_event ? new Date(row.last_event).toISOString() : null,
        };
        totalAll += row.total;
      }
      if (!isScoped) { _todayCountsCache = { total: totalAll, cameras, tz }; _todayCountsCacheAt = now; }
      res.json({ total: totalAll, cameras, tz });
    } catch (err) { routeError(res, err, 'GET /api/stats/today-counts'); }
  });

  // KPI Cards
  app.get('/api/stats/kpi', async (req, res) => {
    const { from, to, cameras } = req.query;
    try {
      let sql = `
        SELECT
          COUNT(*)::int AS total_events,
          COUNT(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name != '')::int AS alerts,
          COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons,
          COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle'))::int AS vehicles,
          COUNT(*) FILTER (WHERE event_type LIKE '%Crossed%' OR event_type LIKE '%Recognition%')::int AS traffic_violations
        FROM events WHERE 1=1`;
      const params = [];
      let n = 0;
      if (from) { sql += ` AND event_time >= $${++n}`; params.push(from); }
      if (to)   { sql += ` AND event_time <= $${++n}`; params.push(to); }
      if (cameras) {
        sql += ` AND camera_id = ANY($${++n})`;
        params.push(cameras.split(','));
      }
      const swKPI = siteWhere(req.user?.allowedSites ?? null, 'camera_id', n + 1);
      if (swKPI.sql) { sql += ` ${swKPI.sql}`; params.push(...swKPI.args); n += swKPI.args.length; }
      const { rows } = await pool.query(sql, params);
      res.json(rows[0] || {});
    } catch (err) { routeError(res, err, 'GET /api/stats/kpi'); }
  });

  // Event Breakdown by rule_name
  app.get('/api/stats/breakdown', async (req, res) => {
    const { from, to, cameras } = req.query;
    try {
      let sql = `
        SELECT
          COALESCE(NULLIF(rule_name, ''), event_type) AS name,
          event_type,
          COUNT(*)::int AS count
        FROM events
        WHERE 1=1`;
      const params = [];
      let n = 0;
      if (from) { sql += ` AND event_time >= $${++n}`; params.push(from); }
      if (to)   { sql += ` AND event_time <= $${++n}`; params.push(to); }
      if (cameras) {
        sql += ` AND camera_id = ANY($${++n})`;
        params.push(cameras.split(','));
      }
      const swBD = siteWhere(req.user?.allowedSites ?? null, 'camera_id', n + 1);
      if (swBD.sql) { sql += ` ${swBD.sql}`; params.push(...swBD.args); n += swBD.args.length; }
      sql += ` GROUP BY name, event_type ORDER BY count DESC LIMIT 20`;
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/stats/breakdown'); }
  });

  // Original endpoints (kept for compatibility)
  app.get('/api/stats/timeseries-rules', async (req, res) => {
    const { from, to, cameras, rules, granularity = 'day' } = req.query;
    try {
      const truncUnit = granularity === 'hour' ? 'hour' : 'day';
      let sql = `SELECT
                   DATE_TRUNC('${truncUnit}', event_time) AS bucket,
                   COALESCE(NULLIF(rule_name, ''), event_type) AS rule_name,
                   COUNT(*)::int AS count
                 FROM events WHERE rule_name IS NOT NULL`;
      const params = [];
      let n = 0;
      if (from) { sql += ` AND event_time >= $${++n}`; params.push(from); }
      if (to)   { sql += ` AND event_time <= $${++n}`; params.push(to); }
      if (cameras) { sql += ` AND camera_id = ANY($${++n})`; params.push(cameras.split(',')); }
      if (rules) { sql += ` AND rule_name = ANY($${++n})`; params.push(rules.split(',')); }
      const swTSR = siteWhere(req.user?.allowedSites ?? null, 'camera_id', n + 1);
      if (swTSR.sql) { sql += ` ${swTSR.sql}`; params.push(...swTSR.args); n += swTSR.args.length; }
      sql += ` GROUP BY bucket, rule_name ORDER BY bucket ASC`;
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/stats/timeseries-rules'); }
  });

  // Map activity intensity — event density per camera, excludes metric events
  // so the map heatmap reflects real incidents, not counter samples.
  app.get('/api/heatmap', async (req, res) => {
    const { hours = 24 } = req.query;
    try {
      const hoursVal = Math.max(1, parseInt(hours, 10) || 24);
      const swMapHM = siteWhere(req.user?.allowedSites ?? null, 'camera_id', 2);
      const { rows } = await pool.query(`
        SELECT camera_id, COUNT(*)::int AS count
        FROM events
        WHERE event_time > NOW() - ($1 * INTERVAL '1 hour')
          AND event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
          ${swMapHM.sql}
        GROUP BY camera_id
      `, [hoursVal, ...swMapHM.args]);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/heatmap'); }
  });

  // ── Data Enrichment routes ────────────────────────────────────

  // GET /api/stats/dwell?from=ISO&to=ISO[&camera_id=..][&episodes=true][&limit=50]
  // Zone dwell time — จับคู่ FieldDetector/ObjectsInside event_state true→false
  // ต่อ (camera, rule) ด้วย window function: "คนอยู่หน้าตู้เย็นนานเท่าไหร่"
  // (Data Enrichment Ph.1, 2026-06-10). หมายเหตุ: Dahua ส่งแต่ enter (true)
  // จึงยังไม่เกิดคู่ — รองรับอัตโนมัติเมื่อ Ph.2 เพิ่ม leave ฝั่ง Dahua.
  // คู่ที่ห่างเกิน 24 ชม. ถือว่า state หลุด (กล้อง reboot ฯลฯ) — ตัดทิ้ง
  app.get('/api/stats/dwell', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const args = [from.toISOString(), to.toISOString()];
      let camFilter = '';
      if (req.query.cameras) { args.push(req.query.cameras.split(',')); camFilter = ` AND camera_id = ANY($${args.length})`; }
      else if (req.query.camera_id) { args.push(req.query.camera_id); camFilter = ` AND camera_id = $${args.length}`; }
      const swDW = siteWhere(resolveSiteScope(req), 'camera_id', args.length + 1);
      if (swDW.sql) { camFilter += ` ${swDW.sql}`; args.push(...swDW.args); }
      const baseCte = `
        WITH z AS (
          SELECT camera_id, rule_name, event_time, event_state,
                 LEAD(event_time)  OVER w AS next_time,
                 LEAD(event_state) OVER w AS next_state
          FROM events
          WHERE event_type = 'FieldDetector/ObjectsInside'
            AND event_state IN ('true','false')
            AND event_time >= $1 AND event_time <= $2${camFilter}
          WINDOW w AS (PARTITION BY camera_id, rule_name ORDER BY event_time)
        ), ep AS (
          SELECT camera_id, rule_name, event_time AS start_time, next_time AS end_time,
                 EXTRACT(EPOCH FROM (next_time - event_time)) AS dwell_sec
          FROM z
          WHERE event_state = 'true' AND next_state = 'false'
            AND next_time - event_time <= INTERVAL '24 hours'
        )`;
      if (req.query.episodes === 'true') {
        const lim = Math.min(parseInt(req.query.limit) || 50, 500);
        args.push(lim);
        const { rows } = await pool.query(
          `${baseCte}
           SELECT camera_id, rule_name, start_time, end_time, ROUND(dwell_sec)::int AS dwell_sec
           FROM ep ORDER BY start_time DESC LIMIT $${args.length}`, args);
        return res.json(rows);
      }
      const { rows } = await pool.query(
        `${baseCte}
         SELECT camera_id, rule_name,
                COUNT(*)::int            AS episodes,
                ROUND(AVG(dwell_sec))::int AS avg_sec,
                MAX(dwell_sec)::int      AS max_sec,
                MIN(dwell_sec)::int      AS min_sec,
                ROUND(SUM(dwell_sec))::int AS total_sec
         FROM ep GROUP BY camera_id, rule_name
         ORDER BY camera_id, rule_name`, args);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/stats/dwell'); }
  });

  // GET /api/stats/people-counting?from=ISO&to=ISO[&cameras=a,b]
  // Traffic เข้า-ออกจาก Hikvision People Counting (PC.1, 2026-06-12) —
  // source = CountAggregation/PeopleCounting rows (กล้องสรุปทุก 15 นาที,
  // event_time = จุดจบ window). bucket อัตโนมัติตามช่วง: 15m / 1h / 1d
  app.get('/api/stats/people-counting', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const rangeMs = to.getTime() - from.getTime();
      let bucketSec;
      if      (rangeMs <= 1.5 * 86400 * 1000) bucketSec = 900;    // ≤1.5d → 15m (native)
      else if (rangeMs <=   8 * 86400 * 1000) bucketSec = 3600;   // ≤8d  → 1h
      else                                    bucketSec = 86400;  // >8d  → 1d
      const params = [from.toISOString(), to.toISOString()];
      let where = `event_type = 'CountAggregation/PeopleCounting'
                   AND event_time >= $1::timestamptz
                   AND event_time <= $2::timestamptz`;
      if (req.query.cameras) {
        const ids = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length) { params.push(ids); where += ` AND camera_id = ANY($${params.length})`; }
      }
      const swPC = siteWhere(resolveSiteScope(req), 'camera_id', params.length + 1);
      if (swPC.sql) { where += ` ${swPC.sql}`; params.push(...swPC.args); }
      const bucketParam = [...params, `${bucketSec} seconds`];
      const { rows } = await pool.query(`
        SELECT date_bin($${bucketParam.length}::interval, event_time,
                        TIMESTAMPTZ '1970-01-01 00:00:00+00')     AS bucket,
               SUM((raw_json->>'enter')::int) AS enter,
               SUM((raw_json->>'exit')::int)  AS exit
          FROM events
         WHERE ${where}
         GROUP BY 1 ORDER BY 1`, bucketParam);
      const { rows: perCam } = await pool.query(`
        SELECT camera_id,
               SUM((raw_json->>'enter')::int) AS enter,
               SUM((raw_json->>'exit')::int)  AS exit
          FROM events
         WHERE ${where}
         GROUP BY 1 ORDER BY 2 DESC`, params);
      res.json({
        bucket_sec: bucketSec,
        buckets: rows.map(r => ({
          ts: new Date(r.bucket).toISOString(),
          enter: parseInt(r.enter, 10) || 0,
          exit:  parseInt(r.exit, 10)  || 0,
        })),
        total_enter: rows.reduce((s, r) => s + (parseInt(r.enter, 10) || 0), 0),
        total_exit:  rows.reduce((s, r) => s + (parseInt(r.exit, 10)  || 0), 0),
        per_camera: perCam.map(r => ({
          camera_id: r.camera_id,
          enter: parseInt(r.enter, 10) || 0,
          exit:  parseInt(r.exit, 10)  || 0,
        })),
      });
    } catch (err) { routeError(res, err, 'GET /api/stats/people-counting'); }
  });

  // ── Category-aware stats routes ───────────────────────────────

  // GET /api/stats/categories?from=ISO&to=ISO[&cameras=...]
  // Returns per-category event count + previous-period count + change_pct
  // "previous" = same-length window immediately before [from, to) (rolling)
  app.get('/api/stats/categories', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const span = to.getTime() - from.getTime();
      if (span <= 0) return res.status(400).json({ error: 'to must be after from' });
      const prevFrom = new Date(from.getTime() - span);
      const cameras  = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const allowed = req.user?.allowedSites ?? null;
      const siteParam = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
      if (siteParam && allowed !== null && !allowed.includes(siteParam))
        return res.status(403).json({ error: 'forbidden' });
      const activeSites = siteParam ? [siteParam] : allowed;

      const params = [from.toISOString(), to.toISOString(), prevFrom.toISOString()];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
      }
      const swCAT = siteWhere(activeSites, 'e.camera_id', params.length + 1);
      if (swCAT.sql) { camFilter += ` ${swCAT.sql}`; params.push(...swCAT.args); }
      let catFilter = '', cardFilter = '';
      if (activeSites !== null) {
        params.push(activeSites);
        catFilter  = ` AND c.site_id = ANY($${params.length})`;
        cardFilter = `WHERE c.site_id = ANY($${params.length})`;
      }

      // Single-pass: join events→categories→rules once, GROUP BY category (FILTER
      // splits current vs previous window) instead of one correlated subquery pair
      // per category. LEFT JOIN back to event_categories is the safety net so a
      // category with zero matching events still returns count=0, not a dropped row.
      const sql = `
        WITH matched AS (
          SELECT r.category_id,
                 COUNT(DISTINCT e.id) FILTER (WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz)::int AS count,
                 COUNT(DISTINCT e.id) FILTER (WHERE e.event_time >= $3::timestamptz AND e.event_time < $1::timestamptz)::int AS prev_count
            FROM events e
            JOIN event_categories c ON TRUE ${catFilter}
            JOIN event_category_rules r ON r.category_id = c.id
                 AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
                 AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
                 AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
                 AND (r.object_class IS NULL OR r.object_class = e.object_class)
                 AND (r.vehicle_type IS NULL OR r.vehicle_type = e.vehicle_type)
                 AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
           WHERE e.event_time >= $3::timestamptz AND e.event_time < $2::timestamptz
             ${camFilter}
           GROUP BY r.category_id
        )
        SELECT c.id, c.name, c.icon, c.color, c.kind, c.is_locked, c.sort_order,
          (SELECT COUNT(*)::int FROM event_category_rules r WHERE r.category_id = c.id) AS rule_count,
          COALESCE(m.count, 0) AS count,
          COALESCE(m.prev_count, 0) AS prev_count
         FROM event_categories c
         LEFT JOIN matched m ON m.category_id = c.id
        ${cardFilter}
        ORDER BY c.sort_order, c.id`;
      const { rows } = await pool.query(sql, params);

      rows.forEach(r => {
        const cur = r.count, prev = r.prev_count;
        r.change_pct = prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10
                     : (cur > 0 ? null : 0);   // null => "no baseline"
      });

      res.json({ from: from.toISOString(), to: to.toISOString(),
                 prev_from: prevFrom.toISOString(), prev_to: from.toISOString(),
                 categories: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/categories'); }
  });

  // GET /api/stats/timeline-v2?from=ISO&to=ISO[&category_id=X][&cameras=...]
  // Bucketed counts. If category_id provided → only events matching that category.
  // Buckets are aligned to display_timezone day boundaries so the frontend's
  // local-midnight buckets match the server's. Without this, Daily/Weekly/Monthly
  // returned UTC-midnight buckets and the frontend's BKK-midnight buckets never
  // matched, leaving the chart empty.
  app.get('/api/stats/timeline-v2', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const span = to.getTime() - from.getTime();
      if (span <= 0) return res.status(400).json({ error: 'to must be after from' });
      const trunc   = pickTruncUnit(from.getTime(), to.getTime());
      const catId   = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const tz      = await getDisplayTz();

      const params = [from.toISOString(), to.toISOString(), tz];
      let where = `e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz`;
      if (cameras && cameras.length) {
        params.push(cameras);
        where += ` AND e.camera_id = ANY($${params.length}::text[])`;
      }
      const swTLV2 = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', params.length + 1);
      if (swTLV2.sql) { where += ` ${swTLV2.sql}`; params.push(...swTLV2.args); }

      // bucket expression: truncate in display TZ, then re-tag as that TZ so the
      // returned timestamptz is the local-midnight (or local-hour) instant in UTC.
      const bucketExpr = `(DATE_TRUNC('${trunc}', e.event_time AT TIME ZONE $3) AT TIME ZONE $3)`;

      let sql;
      if (catId) {
        params.push(catId);
        sql = `
          SELECT ${bucketExpr} AS bucket,
                 COUNT(DISTINCT e.id)::int AS total
            FROM events e
            JOIN event_category_rules r ON r.category_id = $${params.length}
                    AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
                    AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
                    AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
                    AND (r.object_class IS NULL OR r.object_class = e.object_class)
                    AND (r.vehicle_type IS NULL OR r.vehicle_type = e.vehicle_type)
                    AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
           WHERE ${where}
           GROUP BY bucket
           ORDER BY bucket ASC`;
      } else {
        sql = `
          SELECT ${bucketExpr} AS bucket,
                 COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name <> '')::int AS alerts
            FROM events e
           WHERE ${where}
           GROUP BY bucket
           ORDER BY bucket ASC`;
      }

      const { rows } = await pool.query(sql, params);
      res.json({ from: from.toISOString(), to: to.toISOString(), trunc, tz, buckets: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/timeline-v2'); }
  });

  // GET /api/stats/per-camera-counts?kind=people|vehicle&from=ISO&to=ISO[&cameras=...]
  // For Phase 3 — vertical bar charts of People / Vehicle counts per camera.
  // Aggregates events that match ANY mapping rule of categories with the
  // given kind (people_counter / vehicle_counter). Same all-match semantics
  // as /api/stats/categories: an event is counted once per camera if it
  // matches at least one rule for that kind.
  app.get('/api/stats/per-camera-counts', async (req, res) => {
    try {
      const kind = req.query.kind === 'vehicle' ? 'vehicle_counter'
                 : req.query.kind === 'people'  ? 'people_counter'
                 : null;
      if (!kind) return res.status(400).json({ error: 'kind must be people | vehicle' });

      const { from, to } = parseRange(req.query);
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

      const params = [from.toISOString(), to.toISOString(), kind];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
      }
      const swPCC = siteWhere(resolveSiteScope(req), 'e.camera_id', params.length + 1);
      if (swPCC.sql) { camFilter += ` ${swPCC.sql}`; params.push(...swPCC.args); }

      const sql = `
        SELECT e.camera_id, COUNT(DISTINCT e.id)::int AS count
          FROM events e
          JOIN event_category_rules r ON
               EXISTS (SELECT 1 FROM event_categories c WHERE c.id = r.category_id AND c.kind = $3)
               AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
               AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
               AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
               AND (r.object_class IS NULL OR r.object_class = e.object_class)
               AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
         WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
           ${camFilter}
         GROUP BY e.camera_id
         ORDER BY count DESC, e.camera_id`;
      const { rows } = await pool.query(sql, params);
      res.json({ kind, from: from.toISOString(), to: to.toISOString(), per_camera: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/per-camera-counts'); }
  });

  // GET /api/stats/heatmap?from=ISO&to=ISO[&category_id=X][&cameras=...]
  // 7×24 grid: day-of-week × hour-of-day. dow uses ISO ordering (0=Mon..6=Sun)
  // after a -1 offset, so Monday lines up nicely as the first row.
  // Aligned to display_timezone so the cells match a Thai user's calendar.
  app.get('/api/stats/heatmap', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      if (to.getTime() - from.getTime() <= 0) return res.status(400).json({ error: 'to must be after from' });
      const catId   = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const domainSet = req.query.domains ? new Set(String(req.query.domains).split(',')) : null;
      const tz      = await getDisplayTz();

      const params = [from.toISOString(), to.toISOString(), tz];
      let where = `e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz`;
      if (cameras && cameras.length) {
        params.push(cameras);
        where += ` AND e.camera_id = ANY($${params.length}::text[])`;
      }
      const swHM = siteWhere(resolveSiteScope(req), 'e.camera_id', params.length + 1);
      if (swHM.sql) { where += ` ${swHM.sql}`; params.push(...swHM.args); }
      if (domainSet && !domainSet.has('lpr'))  where += ` AND e.event_type <> 'anprAlarm'`;
      if (domainSet && !domainSet.has('face')) where += ` AND e.event_type NOT IN ('FaceCapture','FaceRecognition')`;

      let sql;
      if (catId) {
        params.push(catId);
        sql = `
          SELECT (EXTRACT(isodow FROM e.event_time AT TIME ZONE $3)::int - 1) AS dow,
                  EXTRACT(hour   FROM e.event_time AT TIME ZONE $3)::int      AS hour,
                  COUNT(DISTINCT e.id)::int AS count
            FROM events e
            JOIN event_category_rules r ON r.category_id = $${params.length}
                    AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
                    AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
                    AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
                    AND (r.object_class IS NULL OR r.object_class = e.object_class)
                    AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
           WHERE ${where}
           GROUP BY dow, hour
           ORDER BY dow, hour`;
      } else {
        // Generic (no category) heatmap — exclude metric events so the cells
        // reflect real incidents. Category-scoped queries above are unchanged
        // because counter categories legitimately map to CountAggregation.
        sql = `
          SELECT (EXTRACT(isodow FROM e.event_time AT TIME ZONE $3)::int - 1) AS dow,
                  EXTRACT(hour   FROM e.event_time AT TIME ZONE $3)::int      AS hour,
                  COUNT(*)::int AS count
            FROM events e
           WHERE ${where}
             AND e.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
             AND NOT ${analyticsEventClause('e.event_type')}
           GROUP BY dow, hour
           ORDER BY dow, hour`;
      }

      const { rows } = await pool.query(sql, params);
      res.json({ from: from.toISOString(), to: to.toISOString(), tz, cells: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/heatmap'); }
  });

  // GET /api/stats/quiet-cameras?since_hours=24
  // Cameras that are online but have produced zero events in the last N hours.
  // "Online" = last_seen within 90s. Useful for catching cameras whose IVA has
  // silently broken (still beating but not detecting).
  app.get('/api/stats/quiet-cameras', async (req, res) => {
    try {
      const sinceHours = Math.min(168, Math.max(1, parseInt(req.query.since_hours || '24', 10)));
      // Restrict to cameras in cameras-config.json (decision #86) — the DB
      // cameras table can carry stale rows from old MQTT testing that have
      // 0 events forever and would otherwise dominate this leaderboard.
      const cfgIds = ((loadCameraConfig().cameras) || [])
        .map(c => c.camera_id || c.id).filter(Boolean);
      if (cfgIds.length === 0) return res.json({ since_hours: sinceHours, cameras: [] });
      const allowedSites = resolveSiteScope(req);
      if (allowedSites !== null && allowedSites.length === 0) return res.json({ since_hours: sinceHours, cameras: [] });
      const qcArgs = [sinceHours, cfgIds];
      const siteSql = allowedSites ? `AND c.site_id = ANY($3)` : '';
      if (allowedSites) qcArgs.push(allowedSites);
      const { rows } = await pool.query(`
        SELECT c.id   AS camera_id,
               c.name AS camera_name,
               c.last_seen_at AS last_seen,
               EXTRACT(EPOCH FROM (NOW() - c.last_seen_at))::int AS last_seen_ago_sec,
               COALESCE(e.cnt, 0)::int AS event_count
          FROM cameras c
          LEFT JOIN (
            SELECT camera_id, COUNT(*) AS cnt
              FROM events
             WHERE event_time >= NOW() - ($1::int * INTERVAL '1 hour')
               AND event_type NOT LIKE '%Aggregation%'
               AND NOT ${analyticsEventClause('event_type')}
             GROUP BY camera_id
          ) e ON e.camera_id = c.id
         WHERE c.enabled = TRUE
           AND c.id = ANY($2::text[])
           ${siteSql}
           AND COALESCE(e.cnt, 0) = 0
         ORDER BY c.id`,
        qcArgs);
      res.json({ since_hours: sinceHours, cameras: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/quiet-cameras'); }
  });

  // GET /api/stats/top-rules?from=ISO&to=ISO[&limit=10][&cameras=...]
  // rule_name leaderboard for the active window — helps tune false positives.
  app.get('/api/stats/top-rules', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10)));
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

      const params = [from.toISOString(), to.toISOString()];
      // Exclude metric events — Counter rules would dominate the leaderboard
      // with thousands of samples, drowning out real alert rules.
      let where = `event_time >= $1::timestamptz AND event_time < $2::timestamptz
                   AND rule_name IS NOT NULL AND rule_name <> ''
                   AND event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'`;
      if (cameras && cameras.length) {
        params.push(cameras);
        where += ` AND camera_id = ANY($${params.length}::text[])`;
      }
      const swTR = siteWhere(resolveSiteScope(req), 'camera_id', params.length + 1);
      if (swTR.sql) { where += ` ${swTR.sql}`; params.push(...swTR.args); }
      params.push(limit);
      const sql = `
        SELECT rule_name, COUNT(*)::int AS count,
               COUNT(DISTINCT camera_id)::int AS cameras_seen
          FROM events WHERE ${where}
         GROUP BY rule_name
         ORDER BY count DESC
         LIMIT $${params.length}`;
      const { rows } = await pool.query(sql, params);
      res.json({ from: from.toISOString(), to: to.toISOString(), top: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/top-rules'); }
  });

  // GET /api/stats/timeline-by-category?from=ISO&to=ISO[&cameras=...]
  // One time-series per category (driven by event_category_rules).
  // Used by the Event Overview chart on the Stats page so each category
  // is its own coloured line instead of a single "Total Events" line.
  app.get('/api/stats/timeline-by-category', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const span = to.getTime() - from.getTime();
      if (span <= 0) return res.status(400).json({ error: 'to must be after from' });
      const trunc   = pickTruncUnit(from.getTime(), to.getTime());
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const tz      = await getDisplayTz();
      const allowedTBC = req.user?.allowedSites ?? null;
      const siteParamTBC = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
      if (siteParamTBC && allowedTBC !== null && !allowedTBC.includes(siteParamTBC))
        return res.status(403).json({ error: 'forbidden' });
      const activeSitesTBC = siteParamTBC ? [siteParamTBC] : allowedTBC;

      const params = [from.toISOString(), to.toISOString(), tz];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
      }
      const swTBC = siteWhere(activeSitesTBC, 'e.camera_id', params.length + 1);
      if (swTBC.sql) { camFilter += ` ${swTBC.sql}`; params.push(...swTBC.args); }

      // Scope the rule join to categories reachable from this request's sites —
      // without this, every event is matched against ALL system-wide rules
      // (44 vs. ~6 relevant ones per site), a large avoidable join fan-out.
      let catSiteFilter = '';
      if (activeSitesTBC !== null) { params.push(activeSitesTBC); catSiteFilter = `AND c.site_id = ANY($${params.length})`; }

      const bucketExpr = `(DATE_TRUNC('${trunc}', e.event_time AT TIME ZONE $3) AT TIME ZONE $3)`;

      const sql = `
        SELECT ${bucketExpr} AS bucket,
               c.id  AS category_id,
               COUNT(DISTINCT e.id)::int AS count
          FROM events e
          JOIN event_categories c ON TRUE ${catSiteFilter}
          JOIN event_category_rules r ON r.category_id = c.id
           AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
           AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
           AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
           AND (r.object_class IS NULL OR r.object_class = e.object_class)
           AND (r.vehicle_type IS NULL OR r.vehicle_type = e.vehicle_type)
           AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
         WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
           ${camFilter}
         GROUP BY bucket, c.id
         ORDER BY bucket ASC, c.id`;

      const [pointsResult, catsResult] = await Promise.all([
        pool.query(sql, params),
        pool.query(
          activeSitesTBC !== null
            ? 'SELECT id, name, icon, color, kind, sort_order FROM event_categories WHERE site_id = ANY($1) ORDER BY sort_order, id'
            : 'SELECT id, name, icon, color, kind, sort_order FROM event_categories ORDER BY sort_order, id',
          activeSitesTBC !== null ? [activeSitesTBC] : []
        ),
      ]);

      // Pivot: { categoryId → [{bucket, count}, ...] }
      const byCat = {};
      pointsResult.rows.forEach(r => {
        const k = r.category_id;
        if (!byCat[k]) byCat[k] = [];
        byCat[k].push({ bucket: r.bucket, count: r.count });
      });

      const series = catsResult.rows.map(c => ({
        category: { id: c.id, name: c.name, icon: c.icon, color: c.color, kind: c.kind, sort_order: c.sort_order },
        points: byCat[c.id] || [],
      }));

      res.json({ from: from.toISOString(), to: to.toISOString(), trunc, tz, series });
    } catch (err) { routeError(res, err, 'GET /api/stats/timeline-by-category'); }
  });

  // GET /api/stats/breakdown-v2?from=ISO&to=ISO[&cameras=...]
  // Top rule_names within each category (for the breakdown table)
  // GET /api/stats/event-coverage?from=ISO&to=ISO[&cameras=...]
  // Returns per-event_type counts + category assignment for Coverage Matrix / Uncategorized card.
  // bucket classification: incident | metric | analytics | face (fixed 4-bucket, mirrors analyticsEventClause)
  // "unmatched" = events where the full NULL-OR-match LATERAL found no category (c.id IS NULL per-event)
  app.get('/api/stats/event-coverage', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

      const params = [from.toISOString(), to.toISOString()];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
      }
      const swEV = siteWhere(resolveSiteScope(req), 'e.camera_id', params.length + 1);
      if (swEV.sql) { camFilter += ` ${swEV.sql}`; params.push(...swEV.args); }

      const sql = `
        SELECT
          e.event_type,
          COUNT(*)::int                                              AS count,
          SUM(CASE WHEN c.id IS NULL THEN 1 ELSE 0 END)::int        AS unmatched_count,
          CASE
            WHEN e.event_type LIKE '${METRIC_EVENT_TYPE_PATTERN}' THEN 'metric'
            WHEN ${analyticsEventClause('e.event_type')}           THEN 'analytics'
            WHEN e.event_type LIKE 'FaceCapture%'                  THEN 'face'
            ELSE 'incident'
          END AS bucket,
          MIN(c.id)   AS category_id,
          MIN(c.name) AS category_name,
          MIN(c.kind) AS category_kind
         FROM events e
         LEFT JOIN LATERAL (
           SELECT c2.id, c2.name, c2.kind
             FROM event_category_rules r2
             JOIN event_categories c2 ON c2.id = r2.category_id
            WHERE (r2.camera_id    IS NULL OR r2.camera_id    = e.camera_id)
              AND (r2.rule_name    IS NULL OR r2.rule_name    = e.rule_name)
              AND (r2.event_type   IS NULL OR r2.event_type   = e.event_type)
              AND (r2.object_class IS NULL OR r2.object_class = e.object_class)
              AND (r2.match_state  IS NULL OR r2.match_state  = e.event_state)
            LIMIT 1
         ) c ON true
        WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
          ${camFilter}
        GROUP BY e.event_type
        ORDER BY count DESC`;

      const { rows } = await pool.query(sql, params);

      const total        = rows.reduce((s, r) => s + r.count, 0);
      const uncatCount   = rows.reduce((s, r) => s + r.unmatched_count, 0);
      const coveredCount = total - uncatCount;

      // mark each row: fully_uncategorized = every event of this type had no match
      rows.forEach(r => { r.uncategorized = (r.unmatched_count === r.count); });

      res.json({
        from: from.toISOString(),
        to:   to.toISOString(),
        total,
        covered_count:       coveredCount,
        uncategorized_count: uncatCount,
        coverage_pct: total > 0 ? Math.round((coveredCount / total) * 1000) / 10 : 100,
        event_types: rows,
      });
    } catch (err) { routeError(res, err, 'GET /api/stats/event-coverage'); }
  });

  app.get('/api/stats/breakdown-v2', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

      const params = [from.toISOString(), to.toISOString()];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
      }
      const swBDV2 = siteWhere(resolveSiteScope(req), 'e.camera_id', params.length + 1);
      if (swBDV2.sql) { camFilter += ` ${swBDV2.sql}`; params.push(...swBDV2.args); }

      // Exclude metric (CountAggregation/*) and camera-automation analytics
      // events — neither is an "incident", so they don't belong in the
      // report's event breakdown.
      const sql = `
        SELECT COALESCE(NULLIF(e.rule_name, ''), e.event_type) AS name,
               e.event_type,
               e.camera_id,
               COUNT(*)::int AS count
          FROM events e
         WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
           AND e.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
           AND NOT ${analyticsEventClause('e.event_type')}
           ${camFilter}
         GROUP BY name, e.event_type, e.camera_id
         ORDER BY count DESC
         LIMIT 30`;
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/stats/breakdown-v2'); }
  });

  // GET /api/stats/evidence?from=ISO&to=ISO[&cameras=...]
  // Snapshot + clip coverage for events in the window.
  app.get('/api/stats/evidence', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const params = [from.toISOString(), to.toISOString()];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND camera_id = ANY($${params.length}::text[])`;
      }
      const swEVI = siteWhere(resolveSiteScope(req), 'camera_id', params.length + 1);
      if (swEVI.sql) { camFilter += ` ${swEVI.sql}`; params.push(...swEVI.args); }
      const { rows: [r] } = await pool.query(`
        SELECT
          COUNT(*)::int                                                          AS total,
          COUNT(*) FILTER (WHERE has_snapshot)::int                             AS snapshot_count,
          COUNT(*) FILTER (WHERE clip_file IS NOT NULL AND clip_status='done')::int AS clip_count,
          COUNT(*) FILTER (WHERE has_snapshot
                              OR (clip_file IS NOT NULL AND clip_status='done'))::int AS any_count
        FROM events
        WHERE event_time >= $1::timestamptz AND event_time < $2::timestamptz
          ${camFilter}`, params);
      const pct = (n) => r.total > 0 ? Math.round(n / r.total * 1000) / 10 : 0;
      res.json({
        from: from.toISOString(), to: to.toISOString(),
        total:          r.total,
        snapshot_count: r.snapshot_count,
        clip_count:     r.clip_count,
        any_count:      r.any_count,
        snapshot_pct:   pct(r.snapshot_count),
        clip_pct:       pct(r.clip_count),
        any_pct:        pct(r.any_count),
      });
    } catch (err) { routeError(res, err, 'GET /api/stats/evidence'); }
  });

  // GET /api/stats/forensic-summary?from=ISO&to=ISO[&cameras=...]
  // Compact counts for Appearance, FaceCapture, FaceRecognition, and LPR in the window.
  app.get('/api/stats/forensic-summary', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const params = [from.toISOString(), to.toISOString()];
      let evCamFilter = '', apCamFilter = '', lpCamFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        const anyClause = ` AND camera_id = ANY($${params.length}::text[])`;
        evCamFilter = anyClause;
        apCamFilter = anyClause;
        lpCamFilter = anyClause;
      }
      const swFS = siteWhere(resolveSiteScope(req), 'camera_id', params.length + 1);
      if (swFS.sql) { const sc = ` ${swFS.sql}`; evCamFilter += sc; apCamFilter += sc; lpCamFilter += sc; params.push(...swFS.args); }
      const [evR, apR, lpR] = await Promise.all([
        pool.query(`SELECT
            COUNT(*) FILTER (WHERE event_type LIKE 'FaceCapture%')::int    AS faces,
            COUNT(*) FILTER (WHERE event_type = 'FaceRecognition')::int    AS face_matches
          FROM events
          WHERE event_time >= $1::timestamptz AND event_time < $2::timestamptz
            ${evCamFilter}`, params),
        pool.query(`SELECT COUNT(*)::int AS appearances
          FROM appearances
          WHERE detected_at >= $1::timestamptz AND detected_at < $2::timestamptz
            ${apCamFilter}`, params),
        pool.query(`SELECT COUNT(*)::int AS lpr
          FROM license_plates
          WHERE detected_at >= $1::timestamptz AND detected_at < $2::timestamptz
            ${lpCamFilter}`, params),
      ]);
      res.json({
        from: from.toISOString(), to: to.toISOString(),
        appearances:   apR.rows[0].appearances,
        faces:         evR.rows[0].faces,
        face_matches:  evR.rows[0].face_matches,
        lpr:           lpR.rows[0].lpr,
      });
    } catch (err) { routeError(res, err, 'GET /api/stats/forensic-summary'); }
  });

  // GET /api/stats/alert-effectiveness?from=ISO&to=ISO[&cameras=...]
  // Alert delivery stats from alert_logs: status breakdown + per-rule summary.
  app.get('/api/stats/alert-effectiveness', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const params = [from.toISOString(), to.toISOString()];
      // ponytail: alert_logs is operational metadata (delivery records), not event data — unscoped by design
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND camera_id = ANY($${params.length}::text[])`;
      }
      const base = `FROM alert_logs WHERE sent_at >= $1::timestamptz AND sent_at < $2::timestamptz${camFilter}`;
      const [statusRes, ruleRes, failRes] = await Promise.all([
        pool.query(`SELECT status, COUNT(*)::int AS n ${base} GROUP BY status ORDER BY n DESC`, params),
        pool.query(`SELECT rule_name,
                     COUNT(*)::int AS total,
                     COUNT(*) FILTER (WHERE status='success')::int AS success,
                     COUNT(*) FILTER (WHERE status='failed')::int AS failed,
                     COUNT(*) FILTER (WHERE status='cooldown_skip')::int AS skipped,
                     ROUND(AVG(duration_ms))::int AS avg_ms
                   ${base} AND rule_name IS NOT NULL
                   GROUP BY rule_name ORDER BY total DESC LIMIT 20`, params),
        pool.query(`SELECT error_message, COUNT(*)::int AS n
                   ${base} AND status='failed' AND error_message IS NOT NULL
                   GROUP BY error_message ORDER BY n DESC LIMIT 10`, params),
      ]);
      const byStatus = Object.fromEntries(statusRes.rows.map(r => [r.status, r.n]));
      const total    = statusRes.rows.reduce((s, r) => s + r.n, 0);
      const success  = byStatus.success || 0;
      res.json({
        from: from.toISOString(), to: to.toISOString(),
        total,
        by_status:      byStatus,
        delivery_rate:  total > 0 ? Math.round(success / total * 1000) / 10 : null,
        by_rule:        ruleRes.rows,
        fail_reasons:   failRes.rows,
      });
    } catch (err) { routeError(res, err, 'GET /api/stats/alert-effectiveness'); }
  });

};
