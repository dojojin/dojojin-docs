// ============================================================
// Vigil Platform — Routes: Events
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const { siteWhere } = require('../auth');

module.exports = function eventsRoutes(app, pool, {
  getDisplayTz,
  getAnalyticsEnabledSet,
  METRIC_EVENT_TYPE_PATTERN, ANALYTICS_EVENT_KEYS, ANALYTICS_KEY_SQL,
}) {

  // Phase 6.1.8 — object class hierarchy. Selecting a parent class expands to
  // all children automatically so cameras that emit generic "Vehicle" + cameras
  // that emit specific "Car"/"Truck" both match a single "Vehicle" filter.
  // `null` is significant — some Counter events have no object_class.
  const CLASS_HIERARCHY = {
    Person:  ['Person', 'Face', 'HumanFace', 'HumanBody', 'Pedestrian'],
    Vehicle: ['Vehicle', 'Car', 'Truck', 'Pickup', 'Bus', 'Motorcycle', 'Motorbike', 'Van', 'Bicycle', 'Bike'],
    Other:   ['Animal', 'LicensePlate', 'Object'],
  };
  function expandClasses(input) {
    if (!input) return null;
    const tokens = String(input).split(',').map(s => s.trim()).filter(Boolean);
    const expanded = new Set();
    for (const t of tokens) {
      if (CLASS_HIERARCHY[t]) CLASS_HIERARCHY[t].forEach(c => expanded.add(c));
      else expanded.add(t);
    }
    return [...expanded];
  }

  // Burst-grouping (2026-07-15, Snapshots gallery declutter — see
  // docs/superpowers/plans burst-grouping plan). Dahua's face tracker
  // re-spawns a new ObjectID every few frames while a person is still in
  // frame, so events land <1s apart despite the existing ingest-level
  // per-object dedup working correctly. 8s is well under the observed
  // median gap between genuinely distinct passers-by (15.8s for
  // FaceDetector/Recognized, 27s for FaceDetector/Comparison on
  // hdy-nvr1-ch0) so separate people are not merged.
  const BURST_GROUPING_SECONDS = 8;

  app.get('/api/events', async (req, res) => {
    const {
      camera, cameras, category, type, cls, object_classes,
      rule_name, rule_names, category_id,
      limit = 100, offset = 0, from, to,
      hasSnapshot, hasClip, tab, q,
      dow, hour, exclude_types, group,
    } = req.query;
    try {
      // COUNT(*) OVER () returns the row count BEFORE LIMIT/OFFSET — used for
      // X-Total-Count header so the frontend can render pagination without a
      // second roundtrip. Index-friendly: ~5ms overhead vs separate count query.
      // LPR has its own page (ป้ายทะเบียน); the generic feed renders anprAlarm as a
      // synthetic plaque from raw_json, so no license_plates JOIN is needed here.
      let sql = `SELECT e.*,
                   COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot_file,
                   e.raw_json->>'_snapshot_source' AS snapshot_source,
                   COUNT(*) OVER () ::int AS _total
                 FROM events e
                 WHERE e.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
                   AND e.event_type <> 'FaceCapture'`;
      const params = [];
      let n = 0;
      // Camera-automation analytics events (Phase 7.1): hide types the
      // operator has toggled off, and always hide the event_state='false'
      // "ended" half (state dedup). Non-analytics rows have a NULL key from
      // ANALYTICS_KEY_SQL and pass both checks untouched.
      const disabledAnalytics = ANALYTICS_EVENT_KEYS.filter(k => !getAnalyticsEnabledSet().has(k));
      if (disabledAnalytics.length) {
        sql += ` AND COALESCE((${ANALYTICS_KEY_SQL}), '') <> ALL($${++n}::text[])`;
        params.push(disabledAnalytics);
      }
      sql += ` AND NOT ((${ANALYTICS_KEY_SQL}) IS NOT NULL AND e.event_state = 'false')`;
      // FieldDetector fires enter (state='true') + leave (state='false') per detection.
      // Hide only the snapshot-less leave half (Bosch — a bare duplicate of the enter).
      // Edge-ingested leaves (Dahua via N150) carry their own snapshot — those are real
      // detections with an image, so keep them (else they show on Morning Briefing but
      // vanish from Events/Snapshots — the inconsistency reported 2026-06-25).
      sql += ` AND NOT (e.event_type LIKE 'FieldDetector%' AND e.event_state = 'false' AND e.has_snapshot = FALSE)`;
      if (camera)    { sql += ` AND e.camera_id = $${++n}`;      params.push(camera); }
      if (cameras)   {
        const arr = String(cameras).split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length > 0) { sql += ` AND e.camera_id = ANY($${++n})`; params.push(arr); }
      }
      if (category)  { sql += ` AND e.event_category = $${++n}`; params.push(category); }
      if (type)      { sql += ` AND e.event_type LIKE $${++n}`;  params.push(`%${type}%`); }
      if (cls)       { sql += ` AND e.object_class = $${++n}`;   params.push(cls); }
      if (object_classes) {
        const arr = expandClasses(object_classes);
        if (arr && arr.length > 0) { sql += ` AND e.object_class = ANY($${++n})`; params.push(arr); }
      }
      if (rule_name) { sql += ` AND e.rule_name = $${++n}`;      params.push(rule_name); }
      if (rule_names) {
        const arr = String(rule_names).split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length > 0) { sql += ` AND e.rule_name = ANY($${++n})`; params.push(arr); }
      }
      if (from)      { sql += ` AND e.event_time >= $${++n}`;    params.push(from); }
      if (to)        { sql += ` AND e.event_time <= $${++n}`;    params.push(to); }
      if (hasSnapshot === 'true') { sql += ` AND e.has_snapshot = TRUE`; }
      if (hasClip === 'true')     { sql += ` AND e.clip_file IS NOT NULL AND e.clip_status = 'done'`; }
      // Phase 6.1.8 — Events Live page tabs (server-side, fixes pagination undercount)
      if (tab === 'snap')    sql += ` AND e.has_snapshot = TRUE`;
      if (tab === 'no_snap') sql += ` AND e.has_snapshot = FALSE`;
      if (tab === 'clip')    sql += ` AND e.clip_file IS NOT NULL AND e.clip_status = 'done'`;
      // Snapshot page (item 2): LPR + Face are separate categories with their own
      // pages → exclude from the generic snapshot feed. Comma-separated event_types.
      if (exclude_types) {
        const ex = String(exclude_types).split(',').map(s => s.trim()).filter(Boolean);
        if (ex.length) { sql += ` AND e.event_type <> ALL($${++n}::text[])`; params.push(ex); }
      }
      // Free-text search: scans rule_name + camera_id + object_class + event_type
      if (q && String(q).trim()) {
        const term = `%${String(q).trim()}%`;
        sql += ` AND (e.rule_name ILIKE $${++n} OR e.camera_id ILIKE $${n} OR e.object_class ILIKE $${n} OR e.event_type ILIKE $${n})`;
        params.push(term);
      }
      if (category_id) {
        // drill-down: events that match ANY mapping rule of the given category
        sql += ` AND EXISTS (
          SELECT 1 FROM event_category_rules r
           WHERE r.category_id = $${++n}
             AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
             AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
             AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
             AND (r.object_class IS NULL OR r.object_class = e.object_class)
             AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm'))`;
        params.push(category_id);
      }
      // Activity-heatmap drill-down: hour-of-week filter aligned to display_tz.
      // Must be server-side — applying it client-side after the 20-row LIMIT
      // means the filter sees only the current page, almost always missing the
      // cell's events even when they exist. dow encoding mirrors the heatmap
      // query (EXTRACT(isodow) - 1 → 0=Mon..6=Sun).
      const dowInt  = (dow  !== undefined && dow  !== '') ? parseInt(dow,  10) : null;
      const hourInt = (hour !== undefined && hour !== '') ? parseInt(hour, 10) : null;
      const validDow  = Number.isInteger(dowInt)  && dowInt  >= 0 && dowInt  <= 6;
      const validHour = Number.isInteger(hourInt) && hourInt >= 0 && hourInt <= 23;
      if (validDow || validHour) {
        const tz = await getDisplayTz();
        params.push(tz);
        const tzIdx = ++n;
        if (validDow) {
          sql += ` AND (EXTRACT(isodow FROM e.event_time AT TIME ZONE $${tzIdx})::int - 1) = $${++n}`;
          params.push(dowInt);
        }
        if (validHour) {
          sql += ` AND EXTRACT(hour FROM e.event_time AT TIME ZONE $${tzIdx})::int = $${++n}`;
          params.push(hourInt);
        }
      }
      const sw = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', n + 1);
      if (sw.sql) { sql += ` ${sw.sql}`; params.push(...sw.args); n += sw.args.length; }

      // Burst-grouping (opt-in, Snapshots gallery only — Events/alert/dwell
      // never send group=burst so their queries below are untouched). Reuses
      // every filter built above verbatim via the CTE; only the row-count
      // window function differs (per-burst, not per-row).
      if (group === 'burst') {
        const filteredSql = sql.replace(/,\s*COUNT\(\*\) OVER \(\) ::int AS _total/, '');
        const limitIdx = ++n; params.push(parseInt(limit));
        const offsetIdx = ++n; params.push(parseInt(offset));
        const burstSql = `
          WITH filtered AS (${filteredSql}),
          gapped AS (
            SELECT *, event_time - LAG(event_time) OVER (
              PARTITION BY camera_id, event_type ORDER BY event_time ASC) AS gap
            FROM filtered
          ),
          grouped AS (
            SELECT *, SUM(CASE WHEN gap IS NULL OR gap > INTERVAL '${BURST_GROUPING_SECONDS} seconds'
                                THEN 1 ELSE 0 END)
              OVER (PARTITION BY camera_id, event_type ORDER BY event_time ASC) AS burst_id
            FROM gapped
          ),
          bursts AS (
            SELECT camera_id, event_type, burst_id,
                   MIN(event_time) AS burst_first_time, MAX(event_time) AS burst_last_time,
                   COUNT(*)::int AS burst_count,
                   (ARRAY_AGG(id ORDER BY event_time ASC))[1] AS representative_id
            FROM grouped GROUP BY camera_id, event_type, burst_id
          )
          SELECT f.*, b.burst_count, b.burst_first_time, b.burst_last_time,
                 COUNT(*) OVER()::int AS _total
          FROM bursts b JOIN filtered f ON f.id = b.representative_id
          ORDER BY b.burst_last_time DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
        const { rows } = await pool.query(burstSql, params);
        const total = rows.length > 0 ? (rows[0]._total ?? 0) : 0;
        rows.forEach(r => { delete r._total; });
        res.set('X-Total-Count', String(total));
        return res.json(rows);
      }

      sql += ` ORDER BY e.event_time DESC LIMIT $${++n} OFFSET $${++n}`;
      params.push(parseInt(limit), parseInt(offset));
      const { rows } = await pool.query(sql, params);
      const total = rows.length > 0 ? (rows[0]._total ?? 0) : 0;
      // Strip _total off each row before responding (it's a window-fn artifact)
      rows.forEach(r => { delete r._total; });
      res.set('X-Total-Count', String(total));
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/events'); }
  });

  // GET /api/events/facets — distinct rule_name + event_type values seen in events
  // Used by the mapping rule editor to suggest values from real data.
  app.get('/api/events/facets', async (req, res) => {
    try {
      const params = [];
      // Base WHERE always includes the metric-event filter so dropdowns don't
      // get polluted with CountAggregation rule names like 'คนในพื้นที่ทั้งหมด'.
      let where = ` WHERE event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'`;
      if (req.query.camera_id) {
        params.push(req.query.camera_id);
        where += ` AND camera_id = $${params.length}`;
      }
      const swf = siteWhere(req.user?.allowedSites ?? null, 'camera_id', params.length + 1);
      if (swf.sql) { where += ` ${swf.sql}`; params.push(...swf.args); }
      // LPR vehicle_type facet — distinct sub-types seen in license_plates,
      // camera/site-scoped the same way (lp.camera_id == events.camera_id == cameras.id).
      const vparams = [];
      let vwhere = ` WHERE lp.vehicle_type IS NOT NULL AND lp.vehicle_type <> ''`;
      if (req.query.camera_id) { vparams.push(req.query.camera_id); vwhere += ` AND lp.camera_id = $${vparams.length}`; }
      const vsw = siteWhere(req.user?.allowedSites ?? null, 'lp.camera_id', vparams.length + 1);
      if (vsw.sql) { vwhere += ` ${vsw.sql}`; vparams.push(...vsw.args); }
      const [rules, types, classes, vtypes] = await Promise.all([
        pool.query(`SELECT DISTINCT rule_name AS v FROM events${where}
                      AND rule_name IS NOT NULL AND rule_name <> ''
                    ORDER BY v LIMIT 500`, params),
        pool.query(`SELECT DISTINCT event_type AS v FROM events${where}
                      AND event_type IS NOT NULL AND event_type <> ''
                    ORDER BY v LIMIT 500`, params),
        pool.query(`SELECT DISTINCT object_class AS v FROM events${where}
                      AND object_class IS NOT NULL AND object_class <> ''
                    ORDER BY v LIMIT 200`, params),
        pool.query(`SELECT DISTINCT lp.vehicle_type AS v FROM license_plates lp${vwhere}
                    ORDER BY v LIMIT 100`, vparams),
      ]);
      res.json({
        rule_names:     rules.rows.map(r => r.v),
        event_types:    types.rows.map(r => r.v),
        object_classes: classes.rows.map(r => r.v),    // Phase 6.1.8 — DB-driven class facet
        vehicle_types:  vtypes.rows.map(r => r.v),     // LPR sub-type facet (2026-07-20)
      });
    } catch (err) { routeError(res, err, 'GET /api/events/facets'); }
  });

  // GET /api/events/:id/appearance — IVA Pro appearance attributes for a single event
  // Returns the appearances row for this event_id, or null if none exists.
  // Used by the Events modal to conditionally render the appearance section.
  app.get('/api/events/:id/appearance', async (req, res) => {
    try {
      const swa = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', 2);
      const { rows } = await pool.query(
        `SELECT a.gender, a.hair_length, a.hair_color_xyz, a.hair_color,
                a.top_category, a.top_color_xyz, a.upper_color,
                a.bottom_category, a.bottom_color_xyz, a.lower_color,
                a.glasses, a.bag_category,
                a.helmet_wear, a.helmet_subtype,
                a.overall_color, a.overall_color_xyz, a.color_clusters
         FROM appearances a
         JOIN events e ON e.id = a.event_id
         WHERE a.event_id = $1 ${swa.sql} LIMIT 1`,
        [req.params.id, ...swa.args]
      );
      res.json(rows[0] || null);
    } catch (err) { routeError(res, err, 'GET /api/events/:id/appearance'); }
  });

  // GET /api/events/:id/dwell — zone dwell duration for a single enter event.
  // จับคู่กับ event 'false' ตัวแรกของ (camera, rule) เดียวกันหลังเวลานี้
  // (semantics เดียวกับ /api/stats/dwell — ตัดคู่ห่างเกิน 24 ชม.)
  // คืน null เมื่อ event ไม่ใช่ FieldDetector enter หรือยังไม่มีขาออก.
  // หมายเหตุ: ไม่มี object identity ใน payload → ค่าคือ "ช่วงที่โซนมีคนอยู่"
  // ไม่ใช่ระยะเวลาของ object รายตัว
  app.get('/api/events/:id/dwell', async (req, res) => {
    try {
      const swd = siteWhere(req.user?.allowedSites ?? null, 'camera_id', 2);
      const { rows: ev } = await pool.query(
        `SELECT camera_id, rule_name, event_type, event_state, event_time
         FROM events WHERE id = $1 ${swd.sql} LIMIT 1`,
        [req.params.id, ...swd.args]
      );
      const e = ev[0];
      if (!e || e.event_type !== 'FieldDetector/ObjectsInside' || e.event_state !== 'true') {
        return res.json(null);
      }
      const { rows: ex } = await pool.query(
        `SELECT event_time AS exit_time
         FROM events
         WHERE camera_id = $1 AND rule_name = $2
           AND event_type = 'FieldDetector/ObjectsInside'
           AND event_state = 'false'
           AND event_time > $3
           AND event_time <= $3::timestamptz + INTERVAL '24 hours'
         ORDER BY event_time ASC LIMIT 1`,
        [e.camera_id, e.rule_name, e.event_time]
      );
      if (!ex[0]) return res.json({ dwell_sec: null, exit_time: null });  // ยังไม่ปิด
      const dwellSec = Math.round((new Date(ex[0].exit_time) - new Date(e.event_time)) / 1000);
      res.json({ dwell_sec: dwellSec, exit_time: ex[0].exit_time });
    } catch (err) { routeError(res, err, 'GET /api/events/:id/dwell'); }
  });

};
