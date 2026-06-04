// ============================================================
// DojoJin Tech Dashboard — Executive Summary Endpoint
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// Mounts: GET /api/stats/executive-summary
// Auth:   inherits from app.use('/api', ...) global gate
// ------------------------------------------------------------
// Usage in api-server.js (one line, anywhere after pool is defined
// and BEFORE the async IIFE that calls server.listen):
//
//   require('./stats-summary-route')(app, pool, {
//     snapshotDir: SNAPSHOT_DIR,
//     startedAt:   _serverStartedAt,
//     version:     'v1.2.0',
//     versionDate: '2026-05-07',
//   });
// ============================================================

const path = require('path');
const fs = require('fs');

const { OFFLINE_THRESHOLD_SEC, METRIC_EVENT_FILTER, MQTT_HEALTHY_AGE_SEC } = require('./constants');

function pctChange(today, yesterday) {
  const a = Number(today) || 0;
  const b = Number(yesterday) || 0;
  if (b === 0) return a > 0 ? 100 : 0;
  return Math.round(((a - b) / b) * 1000) / 10;
}

async function dirStats(dir, exts = ['.jpg', '.jpeg', '.png']) {
  let bytes = 0, files = 0;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (!exts.some(x => lower.endsWith(x))) continue;
      try {
        const st = await fs.promises.stat(path.join(dir, e.name));
        bytes += st.size; files++;
      } catch {}
    }
  } catch {}
  return { bytes, files };
}

async function diskStats(dir) {
  try {
    const sf = await fs.promises.statfs(dir);
    return {
      total: sf.blocks * sf.bsize,
      used:  (sf.blocks - sf.bavail) * sf.bsize,
    };
  } catch {
    return { total: 0, used: 0 };
  }
}

module.exports = function registerExecutiveSummaryRoute(app, pool, opts = {}) {
  const snapshotDir = opts.snapshotDir || path.join(__dirname, '..', 'snapshots');
  const mediaDir    = opts.mediaDir    || path.join(__dirname, '..', 'media');
  const startedAt   = opts.startedAt   || Date.now();
  const version     = opts.version     || 'v1.0.0';
  const versionDate = opts.versionDate || new Date().toISOString().slice(0, 10);
  // Source of truth for the camera LIST + lat/lon. Passed from api-server.js;
  // falls back to a no-op so the route still responds (just with empty
  // camera list) if it isn't wired.
  const loadCameraConfig = typeof opts.loadCameraConfig === 'function'
    ? opts.loadCameraConfig
    : () => ({ cameras: [] });
  // Live clause builder from api-server.js. Returns ' AND NOT (…)' when
  // analytics_event_display has any disabled keys (Trigger I/O off by
  // default, etc.), or '' when everything's enabled. Falls back to no-op
  // so the route still runs if the parent forgets to wire it.
  const disabledAnalyticsClause = typeof opts.disabledAnalyticsClause === 'function'
    ? opts.disabledAnalyticsClause
    : () => '';

  // 30s TTL cache — exec-summary runs ~15 parallel DB queries + dirStats + diskStats;
  // frontend polls every 60s; no per-user/group params → single global slot safe (Phase 3 opt, O6)
  let _execCache = null, _execCacheAt = 0;
  const EXEC_TTL_MS = 30_000;

  app.get('/api/stats/executive-summary', async (req, res) => {
    try {
      const now = Date.now();
      if (_execCache && now - _execCacheAt < EXEC_TTL_MS) {
        return res.json(_execCache);
      }

      // Resolve display timezone (matches /api/stats/today-counts pattern)
      const tzRow = await pool.query(
        `SELECT value FROM system_settings WHERE key='display_timezone'`
      );
      const tz = tzRow.rows[0]?.value || 'Asia/Bangkok';

      // Day boundaries in display timezone, expressed as timestamptz instants
      const today     = `(date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1)`;
      const yesterday = `(date_trunc('day', (NOW() AT TIME ZONE $1) - INTERVAL '1 day') AT TIME ZONE $1)`;

      // Live exclusion clause for analytics events the operator has disabled
      // (Trigger I/O off by default). Empty string when nothing's disabled.
      // Applied to KPI/breakdown/by-hour/per-camera/recent queries so
      // automation events don't pollute Top Rules / Event Breakdown.
      // Not applied to traffic/people KPIs — those filter by object_class,
      // which Trigger events don't carry, so they're already excluded.
      const analyticsExclude = disabledAnalyticsClause('event_type');
      const analyticsExcludeE = disabledAnalyticsClause('e.event_type');

      const [
        eventsCounts,
        alertsCounts,
        trafficCounts,
        peopleCounts,
        eventsByHour,
        breakdown,
        topCameras,
        recentEvents,
        cameraRuntime,
        cameraEventCounts,
        mqttHealth,
        clipStats,
        snapStats,
        disk,
        mediaStats
      ] = await Promise.all([

        // ---------- KPI: total events today vs yesterday ----------
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE event_time >= ${today})::int AS today,
            COUNT(*) FILTER (
              WHERE event_time >= ${yesterday} AND event_time < ${today}
            )::int AS yesterday
          FROM events
          WHERE event_time >= ${yesterday}
            AND ${METRIC_EVENT_FILTER}
            ${analyticsExclude}
        `, [tz]),

        // ---------- KPI: alerts (events with rule_name) ----------
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE event_time >= ${today})::int AS today,
            COUNT(*) FILTER (
              WHERE event_time >= ${yesterday} AND event_time < ${today}
            )::int AS yesterday
          FROM events
          WHERE event_time >= ${yesterday}
            AND rule_name IS NOT NULL AND rule_name <> ''
            AND ${METRIC_EVENT_FILTER}
        `, [tz]),

        // ---------- KPI: traffic (vehicles) ----------
        // Expanded object_class hierarchy — Bosch cameras emit either the
        // generic 'Vehicle' or a specific subclass (Car/Truck/Bus/...), so
        // matching only 4 values undercounts. Mirrors CLASS_HIERARCHY in
        // api-server.js. NOTE: events with NO object_class (e.g. some
        // FieldDetector detectors) still can't be counted here — that's a
        // camera-config limitation, not a query bug.
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE event_time >= ${today})::int AS today,
            COUNT(*) FILTER (
              WHERE event_time >= ${yesterday} AND event_time < ${today}
            )::int AS yesterday
          FROM events
          WHERE event_time >= ${yesterday}
            AND object_class IN ('Vehicle','Car','Truck','Bus','Motorcycle','Motorbike','Van','Bicycle','Bike')
            AND ${METRIC_EVENT_FILTER}
        `, [tz]),

        // ---------- KPI: people ----------
        // Expanded object_class hierarchy (Person/Face/HumanFace/HumanBody/
        // Pedestrian) — same reasoning as the traffic KPI above.
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE event_time >= ${today})::int AS today,
            COUNT(*) FILTER (
              WHERE event_time >= ${yesterday} AND event_time < ${today}
            )::int AS yesterday
          FROM events
          WHERE event_time >= ${yesterday}
            AND object_class IN ('Person','Face','HumanFace','HumanBody','Pedestrian')
            AND ${METRIC_EVENT_FILTER}
        `, [tz]),

        // ---------- 24h events per hour ----------
        pool.query(`
          SELECT
            DATE_TRUNC('hour', event_time) AS hour,
            COUNT(*)::int AS count
          FROM events
          WHERE event_time >= NOW() - INTERVAL '24 hours'
            AND ${METRIC_EVENT_FILTER}
            ${analyticsExclude}
          GROUP BY hour
          ORDER BY hour
        `),

        // ---------- Event breakdown (today) — by rule_name ----------
        // Was grouped by object_class, but Bosch FieldDetector/LineDetector
        // often omit object_class → almost everything fell into "Other".
        // Group by rule_name instead (business-meaningful: "ห้ามคนเข้า" etc),
        // falling back to event_type for events with no rule (the camera
        // auto-analytics). `kind` tells the frontend whether to run the
        // label through eventTypeLabel(). Disabled analytics (Trigger I/O
        // by default) are excluded so they don't pollute Top Rules; the
        // remaining analytics' event_state='false' halves are also hidden
        // so pairs don't double-count.
        pool.query(`
          SELECT
            COALESCE(NULLIF(rule_name, ''), event_type) AS label,
            CASE WHEN rule_name IS NOT NULL AND rule_name <> '' THEN 'rule' ELSE 'type' END AS kind,
            COUNT(*)::int AS count
          FROM events
          WHERE event_time >= ${today}
            AND ${METRIC_EVENT_FILTER}
            ${analyticsExclude}
            AND NOT (event_state = 'false' AND (
              event_type LIKE 'ImageToo%' OR event_type LIKE 'GlobalSceneChange%'
              OR event_type LIKE 'Trigger/%'))
          GROUP BY 1, 2
          ORDER BY count DESC
          LIMIT 8
        `, [tz]),

        // ---------- Per-camera event counts (today) — total + alerts ----------
        // No JOIN to the cameras table: the camera LIST + names come from
        // cameras-config.json (joined in JS below). Returns total + alert
        // count per camera; the frontend filters to config cameras, maps
        // names, sorts, and takes the top 5.
        pool.query(`
          SELECT
            e.camera_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE e.rule_name IS NOT NULL AND e.rule_name <> '')::int AS alerts
          FROM events e
          WHERE e.event_time >= ${today}
            AND e.event_type NOT LIKE '%Aggregation%'
            ${analyticsExcludeE}
          GROUP BY e.camera_id
        `, [tz]),

        // ---------- Recent 8 events for live feed ----------
        // Snapshot filename is a top-level column now; raw_json fallback keeps
        // compatibility with rows from older ingester versions or failed migrations.
        pool.query(`
          SELECT
            id, event_time, camera_id, event_type, rule_name, object_class,
            COALESCE(snapshot_filename, raw_json->>'_snapshot') AS snapshot_filename
          FROM events
          WHERE ${METRIC_EVENT_FILTER}
            ${analyticsExclude}
          ORDER BY event_time DESC
          LIMIT 8
        `),

        // ---------- Camera runtime state (heartbeat + recording) ----------
        // DB-side per-camera state ONLY. The camera LIST + lat/lon comes from
        // cameras-config.json (see below) — the `cameras` table auto-registers
        // a row for every camera_id seen in MQTT traffic, including stale ones
        // that are no longer in the operator's config, so COUNT(*) here would
        // overcount. We just need last_seen_at / recording_data_until keyed by
        // id, then join in JS against the config list.
        pool.query(`
          SELECT id, last_seen_at, recording_data_until
          FROM cameras
        `),

        // ---------- 24h event count per camera ----------
        pool.query(`
          SELECT camera_id, COUNT(*)::int AS cnt
          FROM events
          WHERE event_time >= NOW() - INTERVAL '24 hours'
            AND ${METRIC_EVENT_FILTER}
            ${analyticsExclude}
          GROUP BY camera_id
        `),

        // ---------- MQTT pipeline health (camera heartbeat age) ----------
        // Was based on the last EVENT time, which falsely showed
        // "Disconnected" at night when no one walked past a camera. Cameras
        // send heartbeats independent of detections, so MAX(last_seen_at)
        // reflects whether the MQTT pipeline is actually flowing.
        pool.query(`
          SELECT EXTRACT(EPOCH FROM (NOW() - MAX(last_seen_at)))::int AS age_sec
          FROM cameras
        `),

        // ---------- Clip stats (done + pending) ----------
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE clip_file IS NOT NULL AND clip_status = 'done')::int AS done,
            COUNT(*) FILTER (WHERE clip_status = 'pending')::int AS pending
          FROM events
        `),

        dirStats(snapshotDir),
        diskStats(snapshotDir),
        dirStats(mediaDir, ['.mp4'])
      ]);

      const ec = eventsCounts.rows[0]  || { today: 0, yesterday: 0 };
      const ac = alertsCounts.rows[0]  || { today: 0, yesterday: 0 };
      const tc = trafficCounts.rows[0] || { today: 0, yesterday: 0 };
      const pc = peopleCounts.rows[0]  || { today: 0, yesterday: 0 };

      // ----- Camera list from cameras-config.json (source of truth) -----
      // The DB `cameras` table is runtime-only and over-counts (it auto-
      // registers a row for every camera_id seen on MQTT, including stale
      // ones not in the operator's config). So: list + lat/lon come from
      // the config file; last_seen_at / recording state are joined in from
      // the cameraRuntime query keyed by id.
      const cfgCams = (loadCameraConfig().cameras) || [];
      const runtimeById = {};
      for (const r of cameraRuntime.rows) runtimeById[r.id] = r;
      const evCountById = {};
      for (const r of cameraEventCounts.rows) evCountById[r.camera_id] = r.cnt;

      const tsNow = Date.now();
      const isFresh = (ts) => ts && (tsNow - new Date(ts).getTime()) < OFFLINE_THRESHOLD_SEC * 1000;
      const isRecording = (ts) => ts && (tsNow - new Date(ts).getTime()) < 90 * 1000;

      const cameraView = cfgCams.map(c => {
        const rt = runtimeById[c.camera_id] || {};
        return {
          camera_id:    c.camera_id,
          camera_name:  c.camera_name || c.camera_id,
          ip_address:   c.ip_address || null,
          location:     c.location || null,
          lat:          (c.latitude  != null && c.latitude  !== '') ? parseFloat(c.latitude)  : null,
          lon:          (c.longitude != null && c.longitude !== '') ? parseFloat(c.longitude) : null,
          last_seen_at: rt.last_seen_at || null,
          online:       isFresh(rt.last_seen_at),
          recording:    isRecording(rt.recording_data_until),
          event_count:  evCountById[c.camera_id] || 0,
        };
      });

      const cs = {
        total:     cameraView.length,
        online:    cameraView.filter(c => c.online).length,
        offline:   cameraView.filter(c => !c.online).length,
        recording: cameraView.filter(c => c.recording).length,
      };

      // Map markers: only cameras with lat/lon. cfgCams is in insertion order
      // (POST /api/cameras pushes new ones to the end), so reverse → index 0
      // is the most recently ADDED camera, which the frontend focuses on.
      const cameraLocationsView = cameraView
        .filter(c => c.lat != null && c.lon != null)
        .reverse();

      // Top 5 cameras by today's event count — restricted to cameras that
      // are actually in cameras-config.json (the per-camera counts query
      // doesn't JOIN, so it'd otherwise include stale auto-registered
      // camera_ids). Names come from the config too.
      const todayCountById = {};
      for (const r of topCameras.rows) todayCountById[r.camera_id] = r;
      const topCamerasView = cfgCams
        .map(c => {
          const row = todayCountById[c.camera_id] || { total: 0, alerts: 0 };
          return {
            camera_id:   c.camera_id,
            camera_name: c.camera_name || c.camera_id,
            total:  row.total  || 0,
            alerts: row.alerts || 0,
          };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      // Motion = recent events within 5 min
      const motionCutoff = Date.now() - 5 * 60 * 1000;
      const motionCount = recentEvents.rows.filter(
        e => e.event_time && new Date(e.event_time).getTime() > motionCutoff
      ).length;

      // Health label from online ratio
      const ratio = cs.total > 0 ? cs.online / cs.total : 1;
      let healthStatus = 'Excellent';
      if      (ratio < 0.70) healthStatus = 'Critical';
      else if (ratio < 0.85) healthStatus = 'Warning';
      else if (ratio < 0.95) healthStatus = 'Good';

      // MQTT health from camera-heartbeat age (independent of detections)
      const mqttAgeSec = mqttHealth.rows[0]?.age_sec;
      const mqttConnected = mqttAgeSec != null && mqttAgeSec < MQTT_HEALTHY_AGE_SEC;

      const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);

      const payload = {
        timestamp: new Date().toISOString(),
        tz,
        kpis: {
          total_events: {
            value: ec.today,
            change_pct: pctChange(ec.today, ec.yesterday),
            trend: ec.today >= ec.yesterday ? 'up' : 'down',
          },
          alerts: {
            value: ac.today,
            change_pct: pctChange(ac.today, ac.yesterday),
            trend: ac.today >= ac.yesterday ? 'up' : 'down',
          },
          traffic: {
            value: tc.today,
            change_pct: pctChange(tc.today, tc.yesterday),
            trend: tc.today >= tc.yesterday ? 'up' : 'down',
          },
          people: {
            value: pc.today,
            change_pct: pctChange(pc.today, pc.yesterday),
            trend: pc.today >= pc.yesterday ? 'up' : 'down',
          },
          system_health: {
            status: healthStatus,
            uptime_seconds: uptimeSeconds,
          },
        },
        events_24h: eventsByHour.rows.map(r => ({
          hour: r.hour.toISOString(),
          count: r.count,
        })),
        breakdown: breakdown.rows,
        top_cameras: topCamerasView,
        recent_events: recentEvents.rows.map(r => ({
          id: r.id,
          event_time: r.event_time,
          camera_id: r.camera_id,
          event_type: r.event_type,
          rule_name: r.rule_name,
          object_class: r.object_class,
          // Auth-gated route /snapshots/:filename. Filename in raw_json is
          // bare (e.g. "BOSCH_3100i_1232_1778476787675.jpg"); no path strip.
          snapshot_file: r.snapshot_filename || null,
          snapshot_url: r.snapshot_filename
            ? `/snapshots/${r.snapshot_filename}`
            : null,
        })),
        cameras: {
          total: cs.total,
          online: cs.online,
          offline: cs.offline,
          recording: cs.recording,
          motion: motionCount,
          locations: cameraLocationsView,
        },
        system: {
          mqtt_connected: mqttConnected,
          mqtt_last_seen_age_sec: mqttAgeSec,   // camera-heartbeat age now
          storage_used_bytes:  disk.used,
          storage_total_bytes: disk.total,
          snapshot_count:      snapStats.files,
          snapshot_size_bytes: snapStats.bytes,
          clip_count:          mediaStats.files,
          clip_size_bytes:     mediaStats.bytes,
          clips_done:          clipStats.rows[0]?.done    || 0,
          clips_pending:       clipStats.rows[0]?.pending || 0,
          uptime_seconds: uptimeSeconds,
          version,
          version_date: versionDate,
        },
      };
      _execCache = payload;
      _execCacheAt = now;
      res.json(payload);
    } catch (err) {
      console.error('[stats/executive-summary] error:', err);
      res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
  });
};
