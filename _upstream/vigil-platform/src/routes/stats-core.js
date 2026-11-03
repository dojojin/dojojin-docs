// ============================================================
// Vigil Platform — Routes: Statistics (core / data enrichment)
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
const { siteWhere, resolveSiteScope } = require('../auth');

module.exports = function statsCoreRoutes(app, pool, {
  parseRange,
  getDisplayTz,
  METRIC_EVENT_TYPE_PATTERN,
  _todayCountsCache,
}) {

  // ── Core statistics routes ────────────────────────────────────

  // Time series: TOTAL EVENTS + ALERTS (2 lines)
  // Alerts = events with rule_name set (intentional alerts)
  app.get('/api/stats/timeline', async (req, res) => {
    const { cameras, granularity = 'hour' } = req.query;
    try {
      const truncUnit = granularity === 'hour' ? 'hour' : granularity === 'day' ? 'day' : 'week';
      let sql = `SELECT
                   DATE_TRUNC('${truncUnit}', event_time) AS bucket,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name != '')::int AS alerts
                 FROM events WHERE 1=1`;
      const params = [];
      let n = 0;
      // ขอบเวลาบังคับเสมอ: เดิมผูกกับ `if (from)` ⇒ ผู้เรียกที่ไม่ส่ง from/to
      // (เช่น `?period=today` ซึ่ง endpoint นี้ไม่รู้จัก) ได้คิวรีไม่มีขอบ = ไล่ทุก partition
      // วัดจริง 2026-09-08: 35.3 วินาที เทียบกับ 0.14 มิลลิวินาทีเมื่อมีขอบวันนี้
      // `parseRange` (จาก stats.js) ให้ค่าเริ่มต้น 1 วัน และรับ `range=1h|1d|7d|30d`
      const { from, to } = parseRange(req.query);
      sql += ` AND event_time >= $${++n}`; params.push(from);
      sql += ` AND event_time <= $${++n}`; params.push(to);
      if (cameras) {
        sql += ` AND camera_id = ANY($${++n})`;
        params.push(cameras.split(','));
      }
      const swTL = siteWhere(req.user?.allowedSites ?? null, 'camera_id', n + 1);
      if (swTL.sql) { sql += ` ${swTL.sql}`; params.push(...swTL.args); n += swTL.args.length; }
      sql += ` GROUP BY bucket ORDER BY bucket ASC`;
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/stats/timeline', req); }
  });

  // Per-camera "today" counts — used by Camera Status dashboard.
  // "Today" = midnight in display_timezone (Asia/Bangkok by default) → now.
  // Replaces the buggy client-side filter from allEvents (capped at 300 = severe undercount).
  // 30s TTL cache: frontend polls every 60s; data doesn't need sub-minute freshness (Phase 3 opt, O6)
  app.get('/api/stats/today-counts', async (req, res) => {
    try {
      const isScoped = req.user?.isSiteScoped;
      const _compute = async () => {
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
           AND event_time <= now() + interval '5 minutes'   -- กันเวลาอนาคต (GOTCHAS #217)
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
      return { total: totalAll, cameras, tz };
      };
      // ผู้ใช้ที่ถูก scope ไม่แตะแคชเลย — ไม่อ่าน ไม่เขียน ไม่กินช่อง (เหมือนเดิม)
      res.json(isScoped ? await _compute() : await _todayCountsCache.wrap('today', _compute));
    } catch (err) { routeError(res, err, 'GET /api/stats/today-counts', req); }
  });

  // KPI Cards
  app.get('/api/stats/kpi', async (req, res) => {
    const { cameras } = req.query;
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
      // ขอบเวลาบังคับเสมอ: เดิมผูกกับ `if (from)` ⇒ ผู้เรียกที่ไม่ส่ง from/to
      // (เช่น `?period=today` ซึ่ง endpoint นี้ไม่รู้จัก) ได้คิวรีไม่มีขอบ = ไล่ทุก partition
      // วัดจริง 2026-09-08: 35.3 วินาที เทียบกับ 0.14 มิลลิวินาทีเมื่อมีขอบวันนี้
      // `parseRange` (จาก stats.js) ให้ค่าเริ่มต้น 1 วัน และรับ `range=1h|1d|7d|30d`
      const { from, to } = parseRange(req.query);
      sql += ` AND event_time >= $${++n}`; params.push(from);
      sql += ` AND event_time <= $${++n}`; params.push(to);
      if (cameras) {
        sql += ` AND camera_id = ANY($${++n})`;
        params.push(cameras.split(','));
      }
      const swKPI = siteWhere(req.user?.allowedSites ?? null, 'camera_id', n + 1);
      if (swKPI.sql) { sql += ` ${swKPI.sql}`; params.push(...swKPI.args); n += swKPI.args.length; }
      const { rows } = await pool.query(sql, params);
      res.json(rows[0] || {});
    } catch (err) { routeError(res, err, 'GET /api/stats/kpi', req); }
  });

  // Event Breakdown by rule_name
  app.get('/api/stats/breakdown', async (req, res) => {
    const { cameras } = req.query;
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
      // ขอบเวลาบังคับเสมอ: เดิมผูกกับ `if (from)` ⇒ ผู้เรียกที่ไม่ส่ง from/to
      // (เช่น `?period=today` ซึ่ง endpoint นี้ไม่รู้จัก) ได้คิวรีไม่มีขอบ = ไล่ทุก partition
      // วัดจริง 2026-09-08: 35.3 วินาที เทียบกับ 0.14 มิลลิวินาทีเมื่อมีขอบวันนี้
      // `parseRange` (จาก stats.js) ให้ค่าเริ่มต้น 1 วัน และรับ `range=1h|1d|7d|30d`
      const { from, to } = parseRange(req.query);
      sql += ` AND event_time >= $${++n}`; params.push(from);
      sql += ` AND event_time <= $${++n}`; params.push(to);
      if (cameras) {
        sql += ` AND camera_id = ANY($${++n})`;
        params.push(cameras.split(','));
      }
      const swBD = siteWhere(req.user?.allowedSites ?? null, 'camera_id', n + 1);
      if (swBD.sql) { sql += ` ${swBD.sql}`; params.push(...swBD.args); n += swBD.args.length; }
      sql += ` GROUP BY name, event_type ORDER BY count DESC LIMIT 20`;
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/stats/breakdown', req); }
  });

  // Original endpoints (kept for compatibility)
  app.get('/api/stats/timeseries-rules', async (req, res) => {
    const { cameras, rules, granularity = 'day' } = req.query;
    try {
      const truncUnit = granularity === 'hour' ? 'hour' : 'day';
      let sql = `SELECT
                   DATE_TRUNC('${truncUnit}', event_time) AS bucket,
                   COALESCE(NULLIF(rule_name, ''), event_type) AS rule_name,
                   COUNT(*)::int AS count
                 FROM events WHERE rule_name IS NOT NULL`;
      const params = [];
      let n = 0;
      // ขอบเวลาบังคับเสมอ: เดิมผูกกับ `if (from)` ⇒ ผู้เรียกที่ไม่ส่ง from/to
      // (เช่น `?period=today` ซึ่ง endpoint นี้ไม่รู้จัก) ได้คิวรีไม่มีขอบ = ไล่ทุก partition
      // วัดจริง 2026-09-08: 35.3 วินาที เทียบกับ 0.14 มิลลิวินาทีเมื่อมีขอบวันนี้
      // `parseRange` (จาก stats.js) ให้ค่าเริ่มต้น 1 วัน และรับ `range=1h|1d|7d|30d`
      const { from, to } = parseRange(req.query);
      sql += ` AND event_time >= $${++n}`; params.push(from);
      sql += ` AND event_time <= $${++n}`; params.push(to);
      if (cameras) { sql += ` AND camera_id = ANY($${++n})`; params.push(cameras.split(',')); }
      if (rules) { sql += ` AND rule_name = ANY($${++n})`; params.push(rules.split(',')); }
      const swTSR = siteWhere(req.user?.allowedSites ?? null, 'camera_id', n + 1);
      if (swTSR.sql) { sql += ` ${swTSR.sql}`; params.push(...swTSR.args); n += swTSR.args.length; }
      // GROUP BY ตามตำแหน่ง ไม่ใช่ชื่อ: `rule_name` เป็นทั้งคอลัมน์จริงและ alias ของ
      // COALESCE(NULLIF(rule_name,''), event_type) — Postgres เลือกคอลัมน์จริง แล้วฟ้องว่า
      // event_type ไม่ได้อยู่ใน GROUP BY ⇒ endpoint นี้ตอบ 500 มาตลอด (เจอ 2026-09-08)
      sql += ` GROUP BY 1, 2 ORDER BY 1 ASC`;
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/stats/timeseries-rules', req); }
  });

  // Map activity intensity — event density per camera, excludes metric events
  // so the map heatmap reflects real incidents, not counter samples.
  app.get('/api/heatmap', async (req, res) => {
    const { hours = 24 } = req.query;
    try {
      const hoursVal = Math.max(1, parseInt(hours, 10) || 24);
      const allowed = req.user?.allowedSites ?? null;
      // ชั่วโมงเต็มจาก event_kpi_hourly + นับสดเฉพาะเศษหัว (ก่อนต้นชั่วโมงแรก) และท้าย (ชั่วโมงก่อนหน้า + ปัจจุบัน
      // ที่ refresher อาจยังไม่นิ่ง) · เดิมนับ events ดิบทั้งช่วงทุกครั้ง และหน้าแผนที่ยิงซ้ำทุก 60 วิ (ตรวจคิวรี 2026-10-25)
      // ⚠️ ตารางสรุปต้องมี reconcile เก็บตกของที่มาช้า (kpi-stats-refresher · GOTCHAS #237) ไม่งั้นยอดขาดเงียบ ๆ
      // ขอบเวลาถามจาก Postgres แล้วส่งเป็นพารามิเตอร์ — ถ้าคำนวณใน CTE planner ตัด partition / ใช้ index ไม่ได้ (วัดแล้ว 100 วิ)
      // ช่วงสั้นจนไม่มีชั่วโมงเต็ม หรือยาวเกินอายุตาราง (7 วัน) → นับดิบตามเดิม
      // ::text คงความละเอียดระดับไมโครวินาทีของ NOW() — Date ของ JS เหลือแค่มิลลิวินาที แถวตรงขอบจะนับต่างจากเดิม
      const { rows: [bd] } = await pool.query(`
        WITH b AS (SELECT NOW() - ($1 * INTERVAL '1 hour') AS lo,
                          date_trunc('hour', NOW() - ($1 * INTERVAL '1 hour')) + INTERVAL '1 hour' AS a,
                          date_trunc('hour', NOW()) - INTERVAL '1 hour' AS z)
        SELECT lo::text AS lo, a::text AS a, z::text AS z, a < z AS split FROM b`, [hoursVal]);
      if (hoursVal <= 24 * 6 && bd.split) {
        const swR = siteWhere(allowed, 'r.camera_id', 4), swE = siteWhere(allowed, 'e.camera_id', 4);
        const live = (cond) => `SELECT e.camera_id, count(*) AS n FROM events e
           WHERE ${cond} AND e.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}' ${swE.sql} GROUP BY 1`;
        const { rows } = await pool.query(`
          SELECT camera_id, SUM(n)::int AS count FROM (
            SELECT r.camera_id, r.n_total AS n FROM event_kpi_hourly r
             WHERE r.bucket_hour >= $2 AND r.bucket_hour < $3
               AND r.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}' ${swR.sql}
            UNION ALL ${live('e.event_time > $1 AND e.event_time < $2')}
            UNION ALL ${live('e.event_time >= $3')}
          ) t GROUP BY camera_id`, [bd.lo, bd.a, bd.z, ...swR.args]);   // $1–$3 timestamptz จากข้อความ
        return res.json(rows);
      }
      const swMapHM = siteWhere(allowed, 'camera_id', 2);
      const { rows } = await pool.query(`
        SELECT camera_id, COUNT(*)::int AS count
        FROM events
        WHERE event_time > $1
          AND event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
          ${swMapHM.sql}
        GROUP BY camera_id
      `, [bd.lo, ...swMapHM.args]);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/heatmap', req); }
  });

  // ── Data Enrichment routes ────────────────────────────────────

  // GET /api/stats/dwell?from=ISO&to=ISO[&camera_id=..][&episodes=true][&limit=50]
  // Zone dwell time — จับคู่ FieldDetector/ObjectsInside event_state true→false
  // ต่อ (camera, rule) ด้วย window function: "คนอยู่หน้าตู้เย็นนานเท่าไหร่"
  // (Data Enrichment Ph.1, 2026-06-10). หมายเหตุ: Dahua ส่งแต่ enter (true)
  // จึงยังไม่เกิดคู่ — รองรับอัตโนมัติเมื่อ Ph.2 เพิ่ม leave ฝั่ง Dahua.
  // คู่ที่ห่างเกิน 24 ชม. ถือว่า state หลุด (กล้อง reboot ฯลฯ) — ตัดทิ้ง
  // GET /api/stats/vehicle-classes?from&to[&rules=a,b][&trunc=hour][&site_id=]
  // นับ event ดิบแยกตาม (rule_name × object_class) พร้อม series รายชั่วโมง
  // ใช้โดยหน้า Emission Rate (public/others/demo/emission-rate) — จงใจคืน "ของดิบ"
  // ไม่ตีความว่าอะไรคือขาเข้า/ขาออก และไม่ผูกกับหมวด Event เลย เพราะ:
  //   · ชื่อหมวดถูก rename ได้ตลอด (เจ้าของเพิ่งเปลี่ยน เข้า/ออก → IN/OUT)
  //   · หมวดจักรยานยนต์รวม Bicycle ไว้แล้วตามผล RCA — หน้าที่ต้องการแยกคลาส
  //     (เช่นเลือกไม่นับ Bicycle) จึงอ่านจากหมวดไม่ได้
  //   · object_class ที่เป็น NULL ต้องมองเห็น ไม่ใช่หายไปเงียบ ๆ
  // การตัดสินใจว่า rule ไหน = ทิศไหน เป็นของผู้เรียก (กล้อง Bosch ตัวนี้ตั้งชื่อ
  // rule กลับทิศกับความจริง — ดู README ของหน้า demo)
  app.get('/api/stats/vehicle-classes', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      if (to.getTime() - from.getTime() <= 0) return res.status(400).json({ error: 'to must be after from' });
      const tz = await getDisplayTz();
      const trunc = req.query.trunc === 'day' ? 'day' : 'hour';
      const params = [from.toISOString(), to.toISOString(), tz];
      let where = `e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz`;
      const rules = req.query.rules ? String(req.query.rules).split(',').filter(Boolean) : null;
      if (rules && rules.length) { params.push(rules); where += ` AND e.rule_name = ANY($${params.length}::text[])`; }
      const cams = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      if (cams && cams.length) { params.push(cams); where += ` AND e.camera_id = ANY($${params.length}::text[])`; }
      const swVC = siteWhere(resolveSiteScope(req), 'e.camera_id', params.length + 1);
      if (swVC.sql) { where += ` ${swVC.sql}`; params.push(...swVC.args); }
      const [tot, ser] = await Promise.all([
        pool.query(`
          SELECT e.rule_name, COALESCE(e.object_class, '') AS object_class,
                 COUNT(*)::int AS n, ARRAY_AGG(DISTINCT e.camera_id) AS cameras_seen
            FROM events e WHERE ${where} AND $3::text IS NOT NULL
           GROUP BY 1, 2 ORDER BY 1, 2`, params),
        pool.query(`
          SELECT e.rule_name, COALESCE(e.object_class, '') AS object_class,
                 (DATE_TRUNC('${trunc}', e.event_time AT TIME ZONE $3) AT TIME ZONE $3) AS bkt,
                 COUNT(*)::int AS n
            FROM events e WHERE ${where}
           GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, params),
      ]);
      res.json({ from: from.toISOString(), to: to.toISOString(), tz, trunc,
        rows: tot.rows.map((r) => ({
          rule_name: r.rule_name, object_class: r.object_class, n: r.n,
          cameras_seen: r.cameras_seen,
          series: ser.rows.filter((s) => s.rule_name === r.rule_name && s.object_class === r.object_class)
            .map((s) => ({ t: s.bkt, n: s.n })),
        })) });
    } catch (err) { routeError(res, err, 'GET /api/stats/vehicle-classes', req); }
  });

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
    } catch (err) { routeError(res, err, 'GET /api/stats/dwell', req); }
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
    } catch (err) { routeError(res, err, 'GET /api/stats/people-counting', req); }
  });
};
