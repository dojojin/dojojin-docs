// ============================================================
// Vigil Platform — Executive Summary Endpoint
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
const { siteWhere, scopedCameraIds } = require('./auth');
const { createTtlCache } = require('./helpers/ttlCache');
const { archivedCameraIds } = require('./helpers/siteStatus');
// aliased: the local `snapshotDir` below is the caller's override, this is the fallback
const { snapshotDir: defaultSnapshotDir } = require('./helpers/snapshotDir');
// ⚠️ รายชื่อ class เคยเขียนสดใน SQL ข้างล่าง แล้วตกคำว่า 'Pickup' ไป ทำให้
//    n_traffic ของ "ชั่วโมงปัจจุบัน" นับรถขาด ~7% และไม่ตรงกับชั่วโมงก่อนหน้า
//    ที่อ่านจาก event_kpi_hourly — ตอนนี้ทั้งสองทางดึงจากไฟล์เดียวกัน
const { VEHICLE_CLASSES, PERSON_CLASSES, sqlList } = require('./helpers/objectClassGroup');
const VEHICLE_SQL = sqlList(VEHICLE_CLASSES);
const PERSON_SQL  = sqlList(PERSON_CLASSES);

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


// ── ตัวจับเวลารายส่วน (เพิ่ม 2026-08-12) ────────────────────────────────
// endpoint นี้ใช้ ~13 วินาทีทุกครั้งที่ cache 30 วิหมดอายุ (วัดจริง 3 รอบติดกัน:
// 12,925 / 12,746 / 12,685 ms) และเพราะ Node เป็น single process กับ pool เดียว
// มันลากให้หน้าอื่นช้าตามไปด้วย — หน้า Health ที่ปกติ 600ms กลายเป็น 11,190ms
// เมื่อยิงชนกัน · ยืมวิธีเดียวกับ /api/health/details ที่มี diagnostics_ms อยู่แล้ว
// เพื่อชี้เป้าว่า "ส่วนไหน" แทนที่จะรู้แค่ว่า "ทั้งก้อนช้า"
function _mkDiag() {
  const d = {};
  const t = async (name, fn) => {
    const t0 = Date.now();
    try { return await fn(); }
    finally {
      d[name] = Date.now() - t0;
      if (d[name] > 1000) console.warn(`[exec-summary] "${name}" ใช้ ${d[name]}ms`);
    }
  };
  return { d, t };
}

module.exports = function registerExecutiveSummaryRoute(app, pool, opts = {}) {
  const snapshotDir = opts.snapshotDir || defaultSnapshotDir();
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

  // 30s TTL cache — exec-summary runs ~13 parallel DB queries + dirStats + diskStats
  // (was ~15: the 4 events-table KPI scans were consolidated into 1, 2026-07-23);
  // frontend polls every 60s. Keyed by site scope (not a single global slot) —
  // a site-scoped viewer must never be served another scope's cached payload.
  const _execCache = createTtlCache({ name: 'stats:executive-summary', ttlMs: 30_000 });

  app.get('/api/stats/executive-summary', async (req, res) => {
    try {
      // MS-5-style RBAC: null = admin/auditor (all sites), array = viewer's sites.
      const allowedSites = req.user?.allowedSites ?? null;
      const payload = await _execCache.wrap('exec', async () => {

      // Canonical allowed-camera-id set, resolved from the cameras table (not
      // cameras-config.json's free-text `site` name field, which is fragile).
      // null = no filter (sees all); Set (possibly empty) = restrict to these ids.
      let allowedCameraIds = null;
      if (allowedSites !== null) {
        if (allowedSites.length === 0) {
          allowedCameraIds = new Set();
        } else {
          allowedCameraIds = await scopedCameraIds(allowedSites, pool);   // รวมแกนกล้อง (GOTCHAS #166)
        }
      }

      // Edge disk override — a viewer scoped to exactly ONE site with its own
      // Edge node should see THAT edge's disk usage, not the central server's.
      // Ambiguous for admin/auditor (sees everything) or a multi-site viewer,
      // so this only applies to the single-site case. edge_status only reports
      // disk_free/disk_total (no snapshot/clip byte counts) — those two
      // figures stay central-server-wide; see accepted-caveat note below.
      let edgeDisk = null;
      if (allowedSites !== null && allowedSites.length === 1) {
        try {
          const er = await pool.query(
            `SELECT es.disk_free_gb, es.disk_total_gb
               FROM edge_status es
               JOIN sites s ON s.code = es.site_id
              WHERE s.id = $1`,
            [allowedSites[0]]
          );
          if (er.rows[0]?.disk_total_gb != null) {
            const GB = 1024 ** 3;
            edgeDisk = {
              used:  (Number(er.rows[0].disk_total_gb) - Number(er.rows[0].disk_free_gb)) * GB,
              total: Number(er.rows[0].disk_total_gb) * GB,
            };
          }
        } catch { /* edge_status not present on older installs — fall back to central disk */ }
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
      // ขอบของตารางสรุป event_kpi_hourly: ถังที่ปิดไปเกิน 1 ชม. ถือว่านิ่ง (refresher ทุก 5 นาที)
      // · หัวของช่วง 24 ชม. เป็นเศษชั่วโมง จึงเริ่มอ่านถังเต็มจากชั่วโมงถัดไป
      const KPI_LIVE_EDGE = `(date_trunc('hour', NOW()) - INTERVAL '1 hour')`;
      const KPI_24H_LO    = `(date_trunc('hour', NOW() - INTERVAL '24 hours') + INTERVAL '1 hour')`;

      // Site-scope fragments, precomputed per query shape so every KPI/
      // breakdown/feed query below is scoped the same way the rest of the
      // codebase scopes events (siteWhere) — this route previously had none.
      const swTz      = siteWhere(allowedSites, 'camera_id', 2);   // queries already bound to $1=tz
      const swBare1   = siteWhere(allowedSites, 'camera_id', 1);   // queries with no existing params
      const swCamTable = allowedSites === null ? { sql: '', args: [] }
        : allowedSites.length === 0 ? { sql: 'AND FALSE', args: [] }
        : { sql: 'AND site_id = ANY($1)', args: [allowedSites] };  // FROM cameras directly (has site_id, not camera_id)

      const { d: _diag, t: _t } = _mkDiag();
      const _tStart = Date.now();
      const [
        kpiCounts,
        platesCounts,
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

        // ---------- KPI: events/alerts/traffic/people/faces, today vs yesterday ----------
        // Was 4 separate queries (events, alerts, traffic, people), each doing
        // its own `WHERE event_time >= yesterday` scan over the same rows —
        // measured 300-500ms EACH on prod (2.26M-row partitioned table,
        // Index Only Scan still paying heap-fetch cost from autovacuum lag on
        // the active partition), and since Promise.all fires them all at once
        // they compete for the same Postgres parallel-worker budget instead of
        // actually running independently. One scan, five FILTER pairs, cuts
        // this to a single pass. `faces` reuses the same event_type values as
        // /api/faces/stats' capture-total KPI (routes/faces.js CAPTURE_TYPES_SQL)
        // so "จำนวนใบหน้าทั้งหมด" here matches what the Face page itself counts.
        // ⚡ อ่านจากยอดสรุปรายชั่วโมง (`event_kpi_hourly`, migration 144) แทนการสแกน
        // events ~1.6 ล้านแถวทุกครั้งที่ cache หมด (วัดจริง 3.3-6.1 วินาที และลากหน้าอื่นช้าตาม)
        //
        // **ชั่วโมงปัจจุบันอ่านสดจาก events เสมอ** เพราะ refresher เดินทุก 5 นาที —
        // ถ้าอ่านจากตารางสรุปทั้งหมด ตัวเลข "วันนี้" จะค้างให้ผู้ใช้เห็นว่าไม่ขยับ
        // การนับ 1 ชั่วโมงสดวัดได้ 55ms ถูกกว่าสแกนสองวันมาก
        //
        // เงื่อนไข analytics ที่ผู้ดูแลปิดไว้ยังกรองตอนอ่าน (ตารางแยกตาม event_type ไว้ให้)
        // จึงสลับสวิตช์แล้วตัวเลขเปลี่ยนตามทันทีเหมือนเดิม
        _t('kpiCounts', () => pool.query(`
          WITH hourly AS (
            SELECT bucket_hour, n_total, n_alerts, n_traffic, n_people, n_faces
              FROM event_kpi_hourly
             WHERE bucket_hour >= ${yesterday}
               AND bucket_hour <  date_trunc('hour', NOW())
               ${analyticsExclude}
               ${swTz.sql}
          ), live AS (
            SELECT date_trunc('hour', NOW()) AS bucket_hour,
                   count(*)                                                  AS n_total,
                   count(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name <> '') AS n_alerts,
                   count(*) FILTER (WHERE object_class IN (${VEHICLE_SQL})) AS n_traffic,
                   count(*) FILTER (WHERE object_class IN (${PERSON_SQL}))  AS n_people,
                   count(*) FILTER (WHERE event_type IN ('FaceCapture','FaceDetector/Recognized')) AS n_faces
              FROM events
             WHERE event_time >= date_trunc('hour', NOW())
               AND ${METRIC_EVENT_FILTER}
               ${analyticsExclude}
               ${swTz.sql}
          ), all_rows AS (
            SELECT * FROM hourly UNION ALL SELECT * FROM live
          )
          SELECT
            COALESCE(SUM(n_total)   FILTER (WHERE bucket_hour >= ${today}), 0)::int AS events_today,
            COALESCE(SUM(n_total)   FILTER (WHERE bucket_hour <  ${today}), 0)::int AS events_yesterday,
            COALESCE(SUM(n_alerts)  FILTER (WHERE bucket_hour >= ${today}), 0)::int AS alerts_today,
            COALESCE(SUM(n_alerts)  FILTER (WHERE bucket_hour <  ${today}), 0)::int AS alerts_yesterday,
            COALESCE(SUM(n_traffic) FILTER (WHERE bucket_hour >= ${today}), 0)::int AS traffic_today,
            COALESCE(SUM(n_traffic) FILTER (WHERE bucket_hour <  ${today}), 0)::int AS traffic_yesterday,
            COALESCE(SUM(n_people)  FILTER (WHERE bucket_hour >= ${today}), 0)::int AS people_today,
            COALESCE(SUM(n_people)  FILTER (WHERE bucket_hour <  ${today}), 0)::int AS people_yesterday,
            COALESCE(SUM(n_faces)   FILTER (WHERE bucket_hour >= ${today}), 0)::int AS faces_today,
            COALESCE(SUM(n_faces)   FILTER (WHERE bucket_hour <  ${today}), 0)::int AS faces_yesterday
          FROM all_rows
        `, [tz, ...swTz.args])),

        // ---------- KPI: license plates read, today vs yesterday ----------
        // Separate table (license_plates), can't share the events-table scan
        // above. Needs its own index — migration 092 added
        // idx_plates_detected_at (was a full seq scan over 1.9M rows, 727ms;
        // ~200ms with the index). Not site-scoped (license_plates has no
        // camera-site join wired here yet — same accepted scope as the rest
        // of this route's pre-multi-site KPIs).
        _t('platesCounts', () => pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE detected_at >= ${today})::int AS today,
            COUNT(*) FILTER (WHERE detected_at >= ${yesterday} AND detected_at < ${today})::int AS yesterday
          FROM license_plates
          WHERE detected_at >= ${yesterday}
        `, [tz])),

        // ---------- 24h events per hour ----------
        // ⚡ ชั่วโมงเต็มอ่านจาก event_kpi_hourly · สดเฉพาะหัว (เศษชั่วโมงแรกของ 24 ชม.) และ
        // หาง (ชั่วโมงก่อนหน้า + ปัจจุบัน — refresher เดินทุก 5 นาที ถังจึงนิ่งหลังปิด 1 ชม.)
        // ผลเท่ากับอ่าน events ดิบทุกแถว: เทียบใน snapshot เดียวกัน admin + site 2026-10-06 (O2)
        _t('eventsByHour', () => pool.query(`
          SELECT hour, SUM(n)::int AS count FROM (
            SELECT bucket_hour AS hour, n_total AS n FROM event_kpi_hourly
             WHERE bucket_hour >= ${KPI_24H_LO} AND bucket_hour < ${KPI_LIVE_EDGE}
               ${analyticsExclude}
               ${swBare1.sql}
            UNION ALL
            SELECT DATE_TRUNC('hour', event_time), count(*) FROM events
             WHERE ((event_time >= NOW() - INTERVAL '24 hours' AND event_time < ${KPI_24H_LO})
                    OR event_time >= ${KPI_LIVE_EDGE})
               AND ${METRIC_EVENT_FILTER}
               ${analyticsExclude}
               ${swBare1.sql}
             GROUP BY 1
          ) x
          GROUP BY hour
          ORDER BY hour
        `, swBare1.args)),

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
        _t('breakdown', () => pool.query(`
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
            ${swTz.sql}
          GROUP BY 1, 2
          ORDER BY count DESC
          LIMIT 8
        `, [tz, ...swTz.args])),

        // ---------- Per-camera event counts (today) — total + alerts ----------
        // No JOIN to the cameras table: the camera LIST + names come from
        // cameras-config.json (joined in JS below). Returns total + alert
        // count per camera; the frontend filters to config cameras, maps
        // names, sorts, and takes the top 5.
        // ⚡ แบบเดียวกับ eventsByHour — วันนี้ = ชั่วโมงเต็มจากตารางสรุป + ขอบสด (O2)
        _t('topCameras', () => pool.query(`
          SELECT camera_id, SUM(t)::int AS total, SUM(a)::int AS alerts FROM (
            SELECT camera_id, n_total AS t, n_alerts AS a FROM event_kpi_hourly
             WHERE bucket_hour >= ${today} AND bucket_hour < ${KPI_LIVE_EDGE}
               ${analyticsExclude}
               ${swTz.sql}
            UNION ALL
            SELECT camera_id, count(*),
                   count(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name <> '')
              FROM events
             WHERE event_time >= GREATEST(${today}, ${KPI_LIVE_EDGE})
               AND ${METRIC_EVENT_FILTER}
               ${analyticsExclude}
               ${swTz.sql}
             GROUP BY camera_id
          ) x
          GROUP BY camera_id
        `, [tz, ...swTz.args])),

        // ---------- Recent 8 events for live feed ----------
        // Snapshot filename is a top-level column now; raw_json fallback keeps
        // compatibility with rows from older ingester versions or failed migrations.
        _t('recentEvents', () => pool.query(`
          SELECT
            id, event_time, camera_id, event_type, rule_name, object_class,
            COALESCE(snapshot_filename, raw_json->>'_snapshot') AS snapshot_filename
          FROM events
          WHERE ${METRIC_EVENT_FILTER}
            AND event_time <= now() + interval '5 minutes'   -- กันเวลาอนาคต (GOTCHAS #217)
            ${analyticsExclude}
            ${swBare1.sql}
          ORDER BY event_time DESC
          LIMIT 8
        `, swBare1.args)),

        // ---------- Camera runtime state (heartbeat + recording) ----------
        // DB-side per-camera state ONLY. The camera LIST + lat/lon comes from
        // cameras-config.json (see below) — the `cameras` table auto-registers
        // a row for every camera_id seen in MQTT traffic, including stale ones
        // that are no longer in the operator's config, so COUNT(*) here would
        // overcount. We just need last_seen_at / recording_data_until keyed by
        // id, then join in JS against the config list.
        _t('cameraRuntime', () => pool.query(`
          SELECT id, last_seen_at, recording_data_until, sd_last_check_at
          FROM cameras
          WHERE TRUE ${swCamTable.sql}
        `, swCamTable.args)),

        // ---------- 24h event count per camera ----------
        // ⚡ ตัวที่ช้าสุดของหน้านี้ (pgss เฉลี่ย 39 วิ) — แบบเดียวกับ eventsByHour (O2)
        _t('cameraEventCounts', () => pool.query(`
          SELECT camera_id, SUM(n)::int AS cnt FROM (
            SELECT camera_id, n_total AS n FROM event_kpi_hourly
             WHERE bucket_hour >= ${KPI_24H_LO} AND bucket_hour < ${KPI_LIVE_EDGE}
               ${analyticsExclude}
               ${swBare1.sql}
            UNION ALL
            SELECT camera_id, count(*) FROM events
             WHERE ((event_time >= NOW() - INTERVAL '24 hours' AND event_time < ${KPI_24H_LO})
                    OR event_time >= ${KPI_LIVE_EDGE})
               AND ${METRIC_EVENT_FILTER}
               ${analyticsExclude}
               ${swBare1.sql}
             GROUP BY camera_id
          ) x
          GROUP BY camera_id
        `, swBare1.args)),

        // ---------- MQTT pipeline health (camera heartbeat age) ----------
        // Was based on the last EVENT time, which falsely showed
        // "Disconnected" at night when no one walked past a camera. Cameras
        // send heartbeats independent of detections, so MAX(last_seen_at)
        // reflects whether the MQTT pipeline is actually flowing. Scoped so a
        // site-scoped viewer's "connected" status reflects their own cameras.
        _t('mqttHealth', () => pool.query(`
          SELECT EXTRACT(EPOCH FROM (NOW() - MAX(last_seen_at)))::int AS age_sec
          FROM cameras
          WHERE TRUE ${swCamTable.sql}
        `, swCamTable.args)),

        // ---------- Clip stats (done + pending) ----------
        // ⚡ 12,852ms → 17ms (วัดจริง 2026-08-12)
        // เดิมเป็น COUNT(*) FILTER สองตัวบน `FROM events` ทั้งตาราง ซึ่ง **ต้องอ่านทุกแถว**
        // เพื่อประเมิน FILTER — 15.3 ล้านแถวใน 25 partition เพื่อตอบว่า 0 กับ 0
        // (ระบบนี้ยังไม่มีคลิปสักไฟล์) และมันคือ 12.85 วินาทีจาก 12.86 วินาทีของทั้ง endpoint
        //
        // index ที่ต้องใช้ **มีอยู่แล้วทั้งคู่** (idx_events_clip_status, idx_events_has_clip
        // ซึ่งเป็น partial index `WHERE clip_status IS NOT NULL` / `WHERE clip_file IS NOT NULL`)
        // แต่รูปแบบ FILTER ใช้มันไม่ได้ เพราะ WHERE ของ query เป็น TRUE — ต้องอ่านทุกแถวก่อน
        // แยกเป็น subquery ที่มี WHERE ของตัวเอง ทั้งคู่จึงเข้า index ได้
        // (`$1` ตัวเดียวใช้ซ้ำได้ทั้งสอง subquery — args จึงเท่าเดิม ไม่ต้องขยับ offset)
        _t('clipStats', () => pool.query(`
          SELECT
            (SELECT count(*) FROM events
              WHERE clip_file IS NOT NULL AND clip_status = 'done' ${swBare1.sql})::int AS done,
            (SELECT count(*) FROM events
              WHERE clip_status = 'pending' ${swBare1.sql})::int AS pending
        `, swBare1.args)),

        _t('dirStats_snapshots', () => dirStats(snapshotDir)),
        _t('diskStats',           () => diskStats(snapshotDir)),
        _t('dirStats_media',      () => dirStats(mediaDir, ['.mp4'])),
      ]);
      _diag.db_and_fs_total = Date.now() - _tStart;

      const kc = kpiCounts.rows[0] || {};
      const ec = { today: kc.events_today  || 0, yesterday: kc.events_yesterday  || 0 };
      const ac = { today: kc.alerts_today  || 0, yesterday: kc.alerts_yesterday  || 0 };
      const tc = { today: kc.traffic_today || 0, yesterday: kc.traffic_yesterday || 0 };
      const pc = { today: kc.people_today  || 0, yesterday: kc.people_yesterday  || 0 };
      const fc = { today: kc.faces_today   || 0, yesterday: kc.faces_yesterday   || 0 };
      const lc = platesCounts.rows[0] || { today: 0, yesterday: 0 };

      // ----- Camera list from cameras-config.json (source of truth) -----
      // The DB `cameras` table is runtime-only and over-counts (it auto-
      // registers a row for every camera_id seen on MQTT, including stale
      // ones not in the operator's config). So: list + lat/lon come from
      // the config file; last_seen_at / recording state are joined in from
      // the cameraRuntime query keyed by id. Scoped by allowedCameraIds (DB
      // cameras.site_id, canonical) rather than the config's free-text
      // `site` name field, which is fragile to match against.
      // ไซต์ archived ไม่ใช่ส่วนของระบบที่ทำงานอยู่ — ซ่อนจากหน้าสด (ค้นหา/รายงานยังเห็น)
      const archivedCams = await archivedCameraIds(pool);
      const cfgCams = ((loadCameraConfig().cameras) || [])
        .filter(c => (allowedCameraIds === null || allowedCameraIds.has(c.camera_id)) && !archivedCams.has(c.camera_id));
      const runtimeById = {};
      for (const r of cameraRuntime.rows) runtimeById[r.id] = r;
      const evCountById = {};
      for (const r of cameraEventCounts.rows) evCountById[r.camera_id] = r.cnt;

      const tsNow = Date.now();
      const isFresh = (ts) => ts && (tsNow - new Date(ts).getTime()) < OFFLINE_THRESHOLD_SEC * 1000;
      // Freshness judged against when we last checked (sd_last_check_at), not wall-clock
      // "now" — edge-site cameras are probed hourly, so recording_data_until is routinely
      // tens of minutes stale by render time even while still genuinely recording.
      const isRecording = (dataUntil, checkedAt) => {
        if (!dataUntil) return false;
        const checkedAtMs = checkedAt ? new Date(checkedAt).getTime() : tsNow;
        return (checkedAtMs - new Date(dataUntil).getTime()) < 90 * 1000;
      };

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
          recording:    isRecording(rt.recording_data_until, rt.sd_last_check_at),
          event_count:  evCountById[c.camera_id] || 0,
        };
      });

      const cs = {
        total:     cameraView.length,
        online:    cameraView.filter(c => c.online).length,
        offline:   cameraView.filter(c => !c.online).length,
        recording: cameraView.filter(c => c.recording).length,
      };

      // ── กล้องที่ "ไม่ส่งข้อมูล" — คนละคำถามกับ online/offline ข้างบนโดยตั้งใจ ──
      //
      // 🔴 การ์ดใบนี้เคยกรอง `cameraView.filter(c => !c.online)` ซึ่งมีปัญหาสองชั้น
      // (แก้ 2026-09-12): `online` มาจาก isFresh(last_seen_at) = TCP probe ที่กะพริบ
      // 677 ครั้งต่อวันจาก 76 กล้อง ⇒ การ์ดขึ้นราว 20 ตัวเป็นปกติจนไม่มีใครอ่าน ·
      // และ cameraLocationsView ที่มันอ่านถูกกรองเหลือเฉพาะกล้องที่มี lat/lon อยู่แล้ว
      // ⇒ กล้องที่ไม่ได้ปักหมุดหายจากการ์ดเงียบ ๆ
      //
      // ตอนนี้ใช้แหล่งเดียวกับป้ายบน topbar คือ camera_quiet_alerts ซึ่งเทียบกับ
      // นิสัยของกล้องแต่ละตัว (p99 ของช่องว่าง received_at) ไม่ใช่เกณฑ์ตายตัว
      // **เลข "กล้องดับ" สองตัวบนจอเดียวกันที่ไม่มีวันตรงกัน = GOTCHAS #199**
      //
      // แถบสถานะด้านบน (cs.online/cs.total) ยังใช้ค่าเดิม — "ติดต่อกล้องได้กี่ตัว"
      // เป็นคำถามที่ถูกต้องของมันเอง และไม่ได้พาดหัวว่า "ดับ" จึงไม่ชนกัน
      //
      // ⚠️ `null` ≠ `[]` ตรงนี้สำคัญ: `[]` แปลว่า "ตรวจแล้ว ทุกตัวส่งข้อมูลปกติ" ส่วน
      // `null` แปลว่า "ยังตอบไม่ได้" — ตารางยังไม่มี (ก่อน migration 225) หรือยังไม่เคย
      // คำนวณฐาน (alert-worker ยังไม่ restart) · ถ้าปนกันการ์ดจะขึ้นข้อความเขียวว่า
      // "ส่งข้อมูลครบทุกตัว" ตั้งแต่วันแรกทั้งที่ยังไม่ได้ตรวจอะไรเลย = คำรับรองเท็จ
      let quietView = null;
      try {
        const { rows: b } = await pool.query(`SELECT count(*)::int AS n FROM camera_event_baseline`);
        if (b[0].n > 0) quietView = [];
        const { rows } = await pool.query(`
          SELECT q.camera_id, c.name AS camera_name, q.quiet_since,
                 extract(epoch from (now() - q.quiet_since))::int AS quiet_sec
            FROM camera_quiet_alerts q
            JOIN cameras c ON c.id = q.camera_id
           WHERE q.quiet_since IS NOT NULL
           ORDER BY q.quiet_since`);
        if (quietView) quietView = rows
          .filter(r => allowedCameraIds === null || allowedCameraIds.has(r.camera_id))
          .map(r => ({
            camera_id: r.camera_id,
            camera_name: r.camera_name || r.camera_id,
            quiet_since: r.quiet_since,
            quiet_sec: r.quiet_sec,
          }));
      } catch { /* ตารางยังไม่มี (ก่อน migration 225) — การ์ดขึ้นว่าง ไม่ใช่ทั้งหน้าพัง */ }

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

      _diag.total = Date.now() - _tStart;
      return {
        diagnostics_ms: _diag,
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
          faces: {
            value: fc.today,
            change_pct: pctChange(fc.today, fc.yesterday),
            trend: fc.today >= fc.yesterday ? 'up' : 'down',
          },
          plates: {
            value: lc.today,
            change_pct: pctChange(lc.today, lc.yesterday),
            trend: lc.today >= lc.yesterday ? 'up' : 'down',
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
          quiet: quietView,
        },
        system: {
          mqtt_connected: mqttConnected,
          mqtt_last_seen_age_sec: mqttAgeSec,   // camera-heartbeat age now
          storage_used_bytes:  edgeDisk ? edgeDisk.used  : disk.used,
          storage_total_bytes: edgeDisk ? edgeDisk.total : disk.total,
          storage_source: edgeDisk ? 'edge' : 'central',
          // Snapshot/clip counts stay central-server-wide even when
          // storage_source is 'edge' — edge_status doesn't report per-edge
          // file counts/byte sizes, only disk_free/disk_total (accepted
          // limitation; would need a bigger edge-heartbeat payload to fix).
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
      // staleWhileRevalidate: หน้า poll ทุก 30 วิเท่ากับ TTL (นับจากเริ่มโหลด) ⇒ เดิมแทบทุกรอบพลาด cache แล้วรอโหลด
      // ~10 คิวรีขนาน (slow-req avg 15 วิ) · ตอนนี้ตอบค่าก่อนหน้าทันทีแล้วโหลดใหม่เบื้องหลัง เก่าสุด ~TTL+เวลาโหลด
      // เกิน 5×TTL ไม่ตอบของเก่า (audit 2026-10-02 · O2)
      }, { scope: allowedSites, staleWhileRevalidate: true });   // scope เข้าคีย์ผ่าน helper — ไม่ประกอบเอง
      res.json(payload);
    } catch (err) {
      console.error('[stats/executive-summary] error:', err);
      res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
  });
};
