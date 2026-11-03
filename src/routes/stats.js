// ============================================================
// Vigil Platform — Routes: Statistics
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const env        = require('../config');   // อ่านคาบ refresh ของ rollup มาบอกอายุข้อมูล
const catRollup  = require('../helpers/categoryRollup');
const { createTtlCache } = require('../helpers/ttlCache');
const { categoryGroup } = require('../helpers/objectClassGroup');
const { siteWhere, resolveSiteScope } = require('../auth');
const statsOccupancyRoutes = require('./stats-occupancy');
const statsCoreRoutes      = require('./stats-core');
const statsReportRoutes    = require('./stats-report');

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

  // Optional per-day time window: tod_from/tod_to as 'HH:MM' on 30-minute steps,
  // both present or both absent, from < to (overnight windows not supported).
  // Returns { from, to } or null; throws { status: 400 } Error on invalid input.
  function parseTod(query) {
    const todFrom = query.tod_from ? String(query.tod_from).trim() : null;
    const todTo   = query.tod_to ? String(query.tod_to).trim() : null;

    // Both present or both absent
    if ((todFrom && !todTo) || (!todFrom && todTo)) {
      const e = new Error('tod_from/tod_to ต้องมาเป็นคู่ — ส่งทั้งคู่หรือไม่ส่งเลย');
      e.status = 400;
      throw e;
    }

    if (!todFrom || !todTo) return null;

    // Validate format: HH:MM on 30-minute steps
    const timeRegex = /^([01]\d|2[0-3]):(00|30)$/;
    if (!timeRegex.test(todFrom) || !timeRegex.test(todTo)) {
      const e = new Error('tod_from/tod_to ต้องเป็น HH:MM ขั้นละ 30 นาที และ from < to');
      e.status = 400;
      throw e;
    }

    // Compare: from < to (string comparison works for zero-padded HH:MM)
    if (todFrom >= todTo) {
      const e = new Error('tod_from/tod_to ต้องเป็น HH:MM ขั้นละ 30 นาที และ from < to');
      e.status = 400;
      throw e;
    }

    return { from: todFrom, to: todTo };
  }

  // Build SQL time-of-day filter clause.
  // colExpr = SQL expression for the timestamptz column (e.g. 'e.event_time' or 'b.bucket')
  // Produces: AND (colExpr AT TIME ZONE $tzIdx)::time >= $todFromIdx::time AND (colExpr AT TIME ZONE $tzIdx)::time < $todToIdx::time
  // Returns { sql, args } where args = [tz, tod.from, tod.to]
  // startIdx = 1-based parameter index for tz (so $1 becomes startIdx=1, and tod params follow)
  function todClause(colExpr, tod, tz, startIdx) {
    if (!tod) return { sql: '', args: [] };
    const tzIdx = startIdx;
    const todFromIdx = startIdx + 1;
    const todToIdx = startIdx + 2;
    const sql = ` AND (${colExpr} AT TIME ZONE $${tzIdx})::time >= $${todFromIdx}::time AND (${colExpr} AT TIME ZONE $${tzIdx})::time < $${todToIdx}::time`;
    return { sql, args: [tz, tod.from, tod.to] };
  }

  // minute2_5 (150s) = โหมด expand ของช่วง "ชั่วโมงนี้" ในหน้าสถิติใหม่ —
  // ถังเล็กกว่าตารางสรุป (30 นาที) จึงบังคับอ่าน event ดิบเสมอเหมือน minute5
  const TRUNC_OVERRIDES = new Set(['minute2_5', 'minute5', 'minute30', 'hour', 'day', 'week']);

  function pickTruncUnit(fromMs, toMs, override) {
    if (TRUNC_OVERRIDES.has(override)) return override;
    const spanH = (toMs - fromMs) / 3600e3;
    if (spanH <= 2)   return 'minute5';
    if (spanH <= 48)  return 'hour';
    if (spanH <= 24 * 60) return 'day';   // up to 60 days
    return 'week';
  }

  // 30s TTL cache for today-counts (frontend polls every 60s) — ช่องเดียว เฉพาะ
  // ผู้ใช้ที่ไม่ถูก scope · ผู้ใช้ที่ถูก scope ข้ามแคชทั้งก้อนเหมือนเดิม
  const _todayCountsCache = createTtlCache({ name: 'stats:today-counts', ttlMs: 30_000, max: 1 });

  // ── กลุ่ม route ที่แยกออกไปเป็นไฟล์ย่อย — เรียกตรงตำแหน่งที่ route กลุ่มนั้น
  //    เคยลงทะเบียนตอนไฟล์นี้ถือครบทั้ง 27 ตัว (ลำดับคือพฤติกรรม) ──
  const subDeps = {
    parseRange, parseTod, todClause,
    getDisplayTz, METRIC_EVENT_TYPE_PATTERN, analyticsEventClause,
    occupancy, occupancySmoothMs,
    _todayCountsCache,
  };

  statsOccupancyRoutes(app, pool, subDeps);

  statsCoreRoutes(app, pool, subDeps);

  // ── Category-aware stats routes ───────────────────────────────

  // GET /api/stats/categories?from=ISO&to=ISO[&cameras=...][&tod_from=HH:MM&tod_to=HH:MM]
  // Returns per-category event count + previous-period count + change_pct
  // "previous" = same-length window immediately before [from, to) (rolling)
  app.get('/api/stats/categories', async (req, res) => {
    try {
      const rawRange = parseRange(req.query);
      if (rawRange.to.getTime() - rawRange.from.getTime() <= 0) {
        return res.status(400).json({ error: 'to must be after from' });
      }
      const tod = parseTod(req.query);
      const tz = await getDisplayTz();
      // ช่วงยาว → อ่านตารางสรุป (ต้อง snap ให้ตรงขอบถัง 30 นาทีก่อน)
      // ช่วงสั้น → อ่าน event ดิบเหมือนเดิม · ดู helpers/categoryRollup.js
      const useRollup = catRollup.canUseRollup(rawRange.from.getTime(), rawRange.to.getTime());
      const from = useRollup ? catRollup.snapFrom(rawRange.from) : rawRange.from;
      const to   = useRollup ? catRollup.snapTo(rawRange.to)     : rawRange.to;
      const span = to.getTime() - from.getTime();
      const prevFrom = useRollup
        ? catRollup.snapFrom(new Date(from.getTime() - span))
        : new Date(from.getTime() - span);
      const cameras  = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const allowed = req.user?.allowedSites ?? null;
      const siteParam = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
      if (siteParam && allowed !== null && !allowed.includes(siteParam))
        return res.status(403).json({ error: 'forbidden' });
      const activeSites = siteParam ? [siteParam] : allowed;

      // ชื่อคอลัมน์เวลา/กล้อง ต่างกันระหว่าง 2 แหล่ง — ที่เหลือใช้ SQL ร่วมกันได้หมด
      const srcAlias = useRollup ? 'b' : 'e';
      const timeCol  = useRollup ? 'b.bucket' : 'e.event_time';

      const params = [from.toISOString(), to.toISOString(), prevFrom.toISOString()];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND ${srcAlias}.camera_id = ANY($${params.length}::text[])`;
      }
      const swCAT = siteWhere(activeSites, `${srcAlias}.camera_id`, params.length + 1);
      if (swCAT.sql) { camFilter += ` ${swCAT.sql}`; params.push(...swCAT.args); }
      let catFilter = '', cardFilter = '';
      if (activeSites !== null) {
        params.push(activeSites);
        catFilter  = ` AND c.site_id = ANY($${params.length})`;
        cardFilter = `WHERE c.site_id = ANY($${params.length})`;
      }
      const todClause_Cur = todClause(timeCol, tod, tz, params.length + 1);
      if (todClause_Cur.sql) { camFilter += todClause_Cur.sql; params.push(...todClause_Cur.args); }

      // Single-pass: GROUP BY category once (FILTER splits current vs previous
      // window) instead of one correlated subquery pair per category. LEFT JOIN
      // back to event_categories is the safety net so a category with zero
      // matching events still returns count=0, not a dropped row.
      //
      // ช่วงยาวอ่านจาก event_dim_bucket (migration 163) — เดิม join event ทุกแถว
      // กับตารางกฎ ทำให้ "รายเดือน" ค้างเกิน 5 นาที (15 ล้านแถว × 20 กฎ)
      // สองสาขานี้ต้องได้เลขเท่ากันเสมอบนช่วงที่ snap แล้ว — มีเทสต์เทียบไว้
      // ชั้นแรกแยกถึงระดับ "หมวด × กล้อง" — หัวข้อ "รายละเอียดต่อกล้อง" ในรายงานต้องการ
      // จำนวนต่อกล้อง ไม่ใช่แค่รายชื่อกล้อง (เจ้าของสั่ง 2026-08-21)
      // ⚠️ SUM ของ COUNT(DISTINCT e.id) ต่อกล้อง = COUNT(DISTINCT e.id) ต่อหมวด เสมอ
      //    เพราะ event หนึ่งใบอยู่กล้องเดียว · ยืนยันกับข้อมูลจริงแล้ว 407,368 = 407,368
      //    ถ้าวันหนึ่ง event ผูกได้หลายกล้อง ตัวเลขนี้จะเริ่มบวมทันที ต้องกลับมาดูตรงนี้
      const matchedCamCte = useRollup ? `
          SELECT c.id AS category_id, b.camera_id,
                 COALESCE(SUM(b.n) FILTER (WHERE b.bucket >= $1::timestamptz AND b.bucket < $2::timestamptz), 0)::int AS n_cur,
                 COALESCE(SUM(b.n) FILTER (WHERE b.bucket >= $3::timestamptz AND b.bucket < $1::timestamptz), 0)::int AS n_prev
            FROM event_dim_bucket b
            JOIN event_categories c ON TRUE ${catFilter}
           WHERE b.bucket >= $3::timestamptz AND b.bucket < $2::timestamptz
             ${camFilter}
             AND ${catRollup.categoryMatchExists('c')}
           GROUP BY c.id, b.camera_id` : `
          SELECT r.category_id, e.camera_id,
                 COUNT(DISTINCT e.id) FILTER (WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz)::int AS n_cur,
                 COUNT(DISTINCT e.id) FILTER (WHERE e.event_time >= $3::timestamptz AND e.event_time < $1::timestamptz)::int AS n_prev
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
           GROUP BY r.category_id, e.camera_id`;
      const sql = `
        WITH matched_cam AS (${matchedCamCte}
        ), matched AS (
          -- ยุบเป็นระดับหมวด แล้วพก "กล้อง + จำนวน" ติดไปด้วย (เรียงมากไปน้อย)
          -- กล้องที่ยิงเข้าหมวดนี้จริงเฉพาะช่วงปัจจุบัน ไม่นับช่วงก่อนหน้า
          SELECT category_id,
                 SUM(n_cur)::int  AS count,
                 SUM(n_prev)::int AS prev_count,
                 COALESCE(json_agg(json_build_object('camera_id', camera_id, 'count', n_cur)
                          ORDER BY n_cur DESC, camera_id) FILTER (WHERE n_cur > 0), '[]') AS cameras_seen
            FROM matched_cam GROUP BY category_id
        )
        SELECT c.id, c.name, c.icon, c.color, c.kind, c.is_locked, c.sort_order,
          c.stat_group,   -- migration 183: override การจัดกลุ่มบนหน้าสถิติใหม่
          (SELECT COUNT(*)::int FROM event_category_rules r WHERE r.category_id = c.id) AS rule_count,
          -- กฎของหมวดนี้ ใช้เดาว่าหมวดนี้เป็นกลุ่มคนหรือกลุ่มรถ (ดู objectClassGroup.js)
          (SELECT COALESCE(json_agg(json_build_object(
                    'object_class', r.object_class, 'vehicle_type', r.vehicle_type)), '[]')
             FROM event_category_rules r WHERE r.category_id = c.id) AS _rules,
          COALESCE(m.count, 0) AS count,
          COALESCE(m.prev_count, 0) AS prev_count,
          COALESCE(m.cameras_seen, '[]') AS cameras_seen
         FROM event_categories c
         LEFT JOIN matched m ON m.category_id = c.id
        ${cardFilter}
        ORDER BY c.sort_order, c.id`;
      const { rows } = await pool.query(sql, params);

      rows.forEach(r => {
        const cur = r.count, prev = r.prev_count;
        r.change_pct = prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10
                     : (cur > 0 ? null : 0);   // null => "no baseline"
        // 'Person' | 'Vehicle' | null — การ์ดสรุปในรายงานบวกยอดตามช่องนี้ จะได้
        // เท่ากับกราฟเสมอ (บวกจากตัวเลขชุดเดียวกัน ไม่ได้ไปนับ event ใหม่)
        r.object_group = categoryGroup(r.kind, r._rules);
        delete r._rules;
      });

      res.json({ from: from.toISOString(), to: to.toISOString(),
                 prev_from: prevFrom.toISOString(), prev_to: from.toISOString(),
                 categories: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/categories', req); }
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
    } catch (err) { routeError(res, err, 'GET /api/stats/timeline-v2', req); }
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

      const rawRangePCC = parseRange(req.query);
      const useRollup = catRollup.canUseRollup(rawRangePCC.from.getTime(), rawRangePCC.to.getTime());
      const from = useRollup ? catRollup.snapFrom(rawRangePCC.from) : rawRangePCC.from;
      const to   = useRollup ? catRollup.snapTo(rawRangePCC.to)     : rawRangePCC.to;
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

      const srcAliasPCC = useRollup ? 'b' : 'e';
      const params = [from.toISOString(), to.toISOString(), kind];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND ${srcAliasPCC}.camera_id = ANY($${params.length}::text[])`;
      }
      const swPCC = siteWhere(resolveSiteScope(req), `${srcAliasPCC}.camera_id`, params.length + 1);
      if (swPCC.sql) { camFilter += ` ${swPCC.sql}`; params.push(...swPCC.args); }

      // ช่วงยาวอ่านจากตารางสรุป (migration 163) — เดิมช่วง 1 เดือนวัดได้ 20–31 วินาที
      const sql = useRollup ? `
        SELECT b.camera_id, SUM(b.n)::int AS count
          FROM event_dim_bucket b
         WHERE b.bucket >= $1::timestamptz AND b.bucket < $2::timestamptz
           ${camFilter}
           AND ${catRollup.kindMatchExists('$3')}
         GROUP BY b.camera_id
         ORDER BY count DESC, b.camera_id` : `
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
    } catch (err) { routeError(res, err, 'GET /api/stats/per-camera-counts', req); }
  });

  // GET /api/stats/object-counts?from=ISO&to=ISO[&cameras=...][&object_classes=a,b]
  //
  // นับ event แยกตาม "ชนิดวัตถุ" ที่กล้องบอกมา (Motorcycle / Car / Truck / Person …)
  //
  // ทำไมต้องมีเส้นนี้ (2026-09-09): ก่อนหน้านี้คำสั่งใน LINE นับผ่าน `/api/events` แล้ว
  // อ่านยอดจาก header ซึ่ง **มีเพดานนับที่ 10,000** (EVENTS_COUNT_CAP) ⇒ คำถามกว้าง ๆ
  // อย่าง "รถจักรยานยนต์ทั้งไซต์เมื่อวาน" ได้คำตอบว่า "10,000+" ซึ่งใช้ตัดสินใจอะไรไม่ได้
  // วัดจริงบนภูเก็ต 12 ชม.: ตารางสรุป 49 ms · นับจาก events ดิบ 650 ms · ค่าต่างกัน
  // 2 แถวจาก 59,744 (0.003% — ขอบถังที่ refresher ยังตามไม่ทัน)
  //
  // ⚠️ ยอดนี้รวมทุกกล้องที่ระบุชนิดวัตถุได้ **รวมกล้องอ่านป้ายด้วย** (anprAlarm พก
  // object_class มาเหมือนกัน — วัดจริงที่ RMUTR-V 1 ชม.: LineDetector 595 + anprAlarm 214)
  // รถคันเดียวที่ผ่านทั้งเส้นนับและกล้องอ่านป้ายจึงถูกนับสองครั้ง ⇒ ผู้เรียกต้องเขียนกำกับ
  app.get('/api/stats/object-counts', async (req, res) => {
    try {
      const raw = parseRange(req.query);
      if (raw.to.getTime() - raw.from.getTime() <= 0) {
        return res.status(400).json({ error: 'to must be after from' });
      }
      // เกณฑ์เดียวกับ /api/stats/categories — ช่วงสั้นหรือไม่ลงขอบถังอ่าน event ดิบ
      const useRollup = catRollup.canUseRollup(raw.from.getTime(), raw.to.getTime());
      const from = useRollup ? catRollup.snapFrom(raw.from) : raw.from;
      const to   = useRollup ? catRollup.snapTo(raw.to)     : raw.to;
      const alias = useRollup ? 'b' : 'e';
      const timeCol = useRollup ? 'b.bucket' : 'e.event_time';

      const params = [from.toISOString(), to.toISOString()];
      let filt = '';
      const cameras = req.query.cameras
        ? String(req.query.cameras).split(',').map((x) => x.trim()).filter(Boolean) : null;
      if (cameras && cameras.length) {
        params.push(cameras);
        filt += ` AND ${alias}.camera_id = ANY($${params.length}::text[])`;
      }
      const classes = req.query.object_classes
        ? String(req.query.object_classes).split(',').map((x) => x.trim()).filter(Boolean) : null;
      if (classes && classes.length) {
        params.push(classes);
        filt += ` AND ${alias}.object_class = ANY($${params.length}::text[])`;
      }
      const sw = siteWhere(resolveSiteScope(req), `${alias}.camera_id`, params.length + 1);
      if (sw.sql) { filt += ` ${sw.sql}`; params.push(...sw.args); }

      // dim เก็บ object_class เป็น NOT NULL DEFAULT '' จึงเช็ค <> '' ส่วน events เป็น NULL ได้
      const sql = useRollup ? `
        SELECT b.object_class, SUM(b.n)::int AS count
          FROM event_dim_bucket b
         WHERE b.bucket >= $1::timestamptz AND b.bucket < $2::timestamptz
           AND b.object_class <> '' ${filt}
         GROUP BY 1 ORDER BY 2 DESC` : `
        SELECT e.object_class, COUNT(*)::int AS count
          FROM events e
         WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
           AND e.object_class IS NOT NULL AND e.object_class <> '' ${filt}
         GROUP BY 1 ORDER BY 2 DESC`;
      const { rows } = await pool.query(sql, params);
      res.json({
        from: from.toISOString(), to: to.toISOString(),
        source: useRollup ? 'rollup' : 'raw',
        // ตารางสรุปตามหลังของจริงได้ถึงหนึ่งรอบ refresher — ผู้เรียกต้องบอกผู้ใช้ได้
        stale_minutes: useRollup ? Math.round(env.int('CAT_ROLLUP_REFRESH_MS') / 60000) : 0,
        classes: rows,
        total: rows.reduce((a, r) => a + r.count, 0),
      });
    } catch (err) { routeError(res, err, 'GET /api/stats/object-counts', req); }
  });

  // GET /api/stats/heatmap?from=ISO&to=ISO[&category_id=X][&cameras=...]
  // 7×24 grid: day-of-week × hour-of-day. dow uses ISO ordering (0=Mon..6=Sun)
  // after a -1 offset, so Monday lines up nicely as the first row.
  // Aligned to display_timezone so the cells match a Thai user's calendar.
  app.get('/api/stats/heatmap', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      if (to.getTime() - from.getTime() <= 0) return res.status(400).json({ error: 'to must be after from' });
      const tod = parseTod(req.query);
      const catId   = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const domainSet = req.query.domains ? new Set(String(req.query.domains).split(',')) : null;
      // หมวดที่ผู้ใช้ติ๊กออกในหน้ารายงาน — ไม่ส่งมา = ไม่กรอง (คนละตัวกับ category_id
      // ที่หน้าสถิติใช้เจาะดูหมวดเดียว ทั้งสองอยู่ร่วมกันได้)
      const hideHeat = req.query.cats_hide
        ? String(req.query.cats_hide).split(',').map(x => parseInt(x, 10)).filter(Number.isFinite) : null;
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
      if (hideHeat && hideHeat.length) {
        params.push(hideHeat);
        where += ` AND ${catRollup.hideCategoriesClause(`$${params.length}::int[]`, 'e')}`;
      }
      const todClause_HM = todClause('e.event_time', tod, tz, params.length + 1);
      if (todClause_HM.sql) { where += todClause_HM.sql; params.push(...todClause_HM.args); }
      // ช่วง ≥2 ชม. อ่านถังเต็มจาก event_dim_bucket + เศษหัว/ท้ายดิบ (helpers/categoryRollup.eventSource) — ถัง 30 นาที
      // อยู่ในชั่วโมงเดียวเสมอ dow/hour จึงตรง · เดือน: ชนเพดาน 120 วิ (ตรวจคิวรีทุกหน้า 2026-10-25) · ช่วงสั้นนับดิบตามเดิม
      const ruHM = catRollup.canUseRollup(from.getTime(), to.getTime());
      const srcHM = ruHM ? await catRollup.eventSource(pool, params, from, to) : 'events e';

      let sql;
      if (catId) {
        params.push(catId);
        sql = `
          SELECT (EXTRACT(isodow FROM e.event_time AT TIME ZONE $3)::int - 1) AS dow,
                  EXTRACT(hour   FROM e.event_time AT TIME ZONE $3)::int      AS hour,
                  ${ruHM ? 'SUM(e.n)' : 'COUNT(DISTINCT e.id)'}::int AS count
            FROM ${srcHM}
           WHERE ${where}
             -- EXISTS = นับ event ละครั้งแม้เข้าหลายกฎของหมวดเดียวกัน (เท่ากับ COUNT(DISTINCT e.id) ของ JOIN เดิม)
             AND EXISTS (SELECT 1 FROM event_category_rules r WHERE r.category_id = $${params.length}
                    AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
                    AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
                    AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
                    AND (r.object_class IS NULL OR r.object_class = e.object_class)
                    AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm'))
           GROUP BY dow, hour
           ORDER BY dow, hour`;
      } else {
        // Generic (no category) heatmap — exclude metric events so the cells
        // reflect real incidents. Category-scoped queries above are unchanged
        // because counter categories legitimately map to CountAggregation.
        sql = `
          SELECT (EXTRACT(isodow FROM e.event_time AT TIME ZONE $3)::int - 1) AS dow,
                  EXTRACT(hour   FROM e.event_time AT TIME ZONE $3)::int      AS hour,
                  ${ruHM ? 'SUM(e.n)' : 'COUNT(*)'}::int AS count
            FROM ${srcHM}
           WHERE ${where}
             AND e.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
             AND NOT ${analyticsEventClause('e.event_type')}
           GROUP BY dow, hour
           ORDER BY dow, hour`;
      }

      const { rows } = await pool.query(sql, params);
      res.json({ from: from.toISOString(), to: to.toISOString(), tz, cells: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/heatmap', req); }
  });

  // GET /api/stats/vehicle-cards?from=ISO&to=ISO[&site_id][&cameras]
  // การ์ดยานพาหนะ "อัตโนมัติ" ของหน้าสถิติใหม่ — นับจาก traffic_hourly_stats
  // (n_total ต่อ vehicle_type ต่อกล้องรายชั่วโมง ซึ่ง normalize สอง vendor แล้ว:
  // Dahua ส่ง vehicle_type ตรง · Hik object_class ถูกแปลงตอนเข้า license_plates)
  // ⇒ ไซต์ใหม่เพิ่มกล้อง LPR แล้วการ์ดโผล่เอง ไม่ต้องสร้าง event_categories
  // (ตกลงกับเจ้าของ 2026-08-28 — แทนชุดหมวดยานพาหนะ per-site ที่ลบออกไป)
  // series: รายชั่วโมงเมื่อช่วง ≤48 ชม. ไม่งั้นรายวัน · client เรียกสองครั้ง
  // (ช่วงเลือก + ช่วงเทียบ) แบบเดียวกับ categories
  app.get('/api/stats/vehicle-cards', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      if (to.getTime() - from.getTime() <= 0) return res.status(400).json({ error: 'to must be after from' });
      const tz = await getDisplayTz();
      // step (วินาที) จากหน้าจอ: แกนละเอียดกว่าชั่วโมง (ชั่วโมงนี้ = 5/2.5 นาที) อ่าน
      // ตารางสรุปไม่ได้ — traffic_hourly_stats ละเอียดสุดรายชั่วโมง ยอดทั้งชั่วโมงจะกอง
      // ที่ถังแรกของแกน (เห็นจริง 2026-08-30: เส้นวาดได้แค่หมวด RMUTR-V การ์ดโชว์
      // 2,663 แต่เส้นสูงสุด 2) ⇒ ช่วงสั้น (≤6 ชม.) นับสดจาก license_plates ซึ่งเป็น
      // ต้นทางเดียวกับที่ traffic-stats-refresher ใช้สรุป — นิยามตรงกันโดยสร้าง
      const stepSec = parseInt(req.query.step || '0', 10) || 0;
      const spanH = (to.getTime() - from.getTime()) / 3600e3;
      // เพดาน 26 ชม. ครอบ "วันนี้/เมื่อวาน + ปุ่มขยายเป็น 30 นาที" (24 ชม.) ซึ่งเป็น
      // ช่วงที่ละเอียดที่สุดที่หน้าจอขอได้ · เดิมตั้งไว้ 6 ชม. ทำให้กดขยายแล้วเส้น
      // ยานพาหนะหายไป 99.5% เงียบ ๆ (วัดจริง 2026-08-30: 259,725 → 1,303 เหลือแต่
      // หมวดของ RMUTR-V) เพราะ frontend ไม่ map series รายชั่วโมงลงแกน 30 นาที
      // ต้นทุนวัดแล้ว: 730,171 แถว/24 ชม. → 368 ms (idx detected_at) และยอดจาก raw
      // เท่ากับตารางสรุปเป๊ะ 0.00% ทุกประเภท จึงไม่มีอาการ "การ์ดกระโดด" ตอนสลับโหมด
      const useRaw = stepSec > 0 && stepSec < 3600 && spanH <= 26;
      const binSec = Math.max(150, Math.min(1800, stepSec));
      const truncVC = useRaw ? `second${binSec}` : (spanH <= 48 ? 'hour' : 'day');
      const timeCol = useRaw ? 'p.detected_at' : 't.bucket_hour';
      const camCol = useRaw ? 'p.camera_id' : 't.camera_id';
      const params = [from.toISOString(), to.toISOString(), tz];
      let where = `${timeCol} >= $1::timestamptz AND ${timeCol} < $2::timestamptz`;
      if (useRaw) where += ` AND p.camera_id IS NOT NULL`;
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      if (cameras && cameras.length) {
        params.push(cameras);
        where += ` AND ${camCol} = ANY($${params.length}::text[])`;
      }
      const swVC = siteWhere(resolveSiteScope(req), camCol, params.length + 1);
      if (swVC.sql) { where += ` ${swVC.sql}`; params.push(...swVC.args); }
      // date_bin ยึด origin ที่ขอบช่วง ($1) — ถังตรงกับแกนของหน้าจอพอดี ไม่ต้องสน tz
      const seriesSql = useRaw ? `
          SELECT coalesce(p.vehicle_type, 'unknown') AS vehicle_type,
                 date_bin('${binSec} seconds', p.detected_at, $1::timestamptz) AS bkt,
                 COUNT(*)::int AS n
            FROM license_plates p
           WHERE ${where}
             AND $3::text IS NOT NULL  -- no-op: ทุก branch ต้อง consume $3 (tz)
           GROUP BY 1, 2 ORDER BY 1, 2` : `
          SELECT t.vehicle_type,
                 (DATE_TRUNC('${truncVC}', t.bucket_hour AT TIME ZONE $3) AT TIME ZONE $3) AS bkt,
                 SUM(t.n_total)::int AS n
            FROM traffic_hourly_stats t
           WHERE ${where}
           GROUP BY 1, 2 ORDER BY 1, 2`;
      // ยอดการ์ดช่วงสั้นก็นับจาก raw ตัวเดียวกัน — ให้เส้นกับการ์ดมาจากแหล่งเดียว
      // เป๊ะ (ตารางสรุปตามหลัง refresher ได้เป็นนาที)
      // cameras_seen เป็น [{camera_id,count}] เหมือน /api/stats/categories (ไม่ใช่แค่
      // ARRAY_AGG รายชื่อ) — หน้าสถิติใหม่ (_esSiteMatrix, "แยกตามไซต์") ต้องมี count
      // ต่อกล้องไปคำนวณยอดต่อไซต์ ของเดิมส่งแค่ ARRAY_AGG(DISTINCT camera_id) ไม่มี
      // count ติดมาเลย ⇒ ทุกไซต์ในตารางเป็น 0 ตลอด ตารางเลยหน้าตาเหมือนไม่แยกอะไร
      // (เจ้าของทัก 2026-09-04) · CTE ชั้นในนับต่อกล้องก่อน ค่อยรวมเป็น total เดิม
      const totalsSql = useRaw ? `
          WITH percam AS (
            SELECT coalesce(p.vehicle_type, 'unknown') AS vehicle_type, p.camera_id, COUNT(*)::int AS n
              FROM license_plates p
             WHERE ${where}
               AND $3::text IS NOT NULL  -- no-op: ทุก branch ต้อง consume $3 (tz)
             GROUP BY 1, 2
          )
          SELECT vehicle_type, SUM(n)::int AS total,
                 COALESCE(json_agg(json_build_object('camera_id', camera_id, 'count', n)
                          ORDER BY n DESC, camera_id) FILTER (WHERE n > 0), '[]') AS cameras_seen
            FROM percam GROUP BY vehicle_type` : `
          WITH percam AS (
            SELECT t.vehicle_type, t.camera_id, SUM(t.n_total)::bigint::int AS n
              FROM traffic_hourly_stats t
             WHERE ${where}
               AND $3::text IS NOT NULL  -- no-op: ทุก branch ต้อง consume $3 (tz) ไม่งั้น bind ไม่ตรง
             GROUP BY 1, 2
          )
          SELECT vehicle_type, SUM(n)::int AS total,
                 COALESCE(json_agg(json_build_object('camera_id', camera_id, 'count', n)
                          ORDER BY n DESC, camera_id) FILTER (WHERE n > 0), '[]') AS cameras_seen
            FROM percam GROUP BY vehicle_type`;
      const [series, totals] = await Promise.all([
        pool.query(seriesSql, params), pool.query(totalsSql, params),
      ]);
      res.json({ from: from.toISOString(), to: to.toISOString(), trunc: truncVC, tz,
        cards: totals.rows.map((r) => ({
          vehicle_type: r.vehicle_type, total: r.total, cameras_seen: r.cameras_seen,
          series: series.rows.filter((s) => s.vehicle_type === r.vehicle_type)
            .map((s) => ({ t: s.bkt, n: s.n })),
        })) });
    } catch (err) { routeError(res, err, 'GET /api/stats/vehicle-cards', req); }
  });

  // GET /api/stats/pattern-heatmap?days=28[&category_ids=1,2,3][&cameras=..][&site_id=..]
  // dow×hour สำหรับส่วน BI ของหน้าสถิติใหม่ — /api/stats/heatmap เดิม scan events
  // ดิบ (28 วันวัดจริง >60s) ตัวนี้อ่าน event_dim_bucket (rollup 30 นาที,
  // migration 163) ~0.3s · semantics เท่ากัน: ไม่ระบุหมวด = ตัด metric/analytics
  // ออก · ระบุหมวดได้หลาย id (การ์ดหน้าใหม่ merge หลายหมวดเป็นใบเดียว) —
  // แถว rollup เป็น dim เดียว event เข้าได้แถวเดียว EXISTS จึงนับครั้งเดียวเสมอ
  // หมายเหตุ: เทียบ vehicle_type ด้วย (heatmap เดิมไม่เทียบ — หมวด LPR ที่ตั้ง rule
  // ด้วย vehicle_type ล้วนจะได้ 0 จาก endpoint เดิม)
  app.get('/api/stats/pattern-heatmap', async (req, res) => {
    try {
      const days = Math.min(90, Math.max(7, parseInt(req.query.days || '28', 10)));
      const catIds = req.query.category_ids
        ? String(req.query.category_ids).split(',').map((x) => parseInt(x, 10)).filter(Number.isFinite)
        : null;
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const tz = await getDisplayTz();
      const params = [String(days), tz];
      let where = `b.bucket >= now() - ($1 || ' days')::interval`;
      if (cameras && cameras.length) {
        params.push(cameras);
        where += ` AND b.camera_id = ANY($${params.length}::text[])`;
      }
      const swPH = siteWhere(resolveSiteScope(req), 'b.camera_id', params.length + 1);
      if (swPH.sql) { where += ` ${swPH.sql}`; params.push(...swPH.args); }
      let catClause = `AND b.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
             AND NOT ${analyticsEventClause('b.event_type')}`;
      if (catIds && catIds.length) {
        params.push(catIds);
        catClause = `AND EXISTS (
          SELECT 1 FROM event_category_rules r
           WHERE r.category_id = ANY($${params.length}::int[])
             AND (r.camera_id    IS NULL OR r.camera_id    = b.camera_id)
             AND (r.rule_name    IS NULL OR r.rule_name    = b.rule_name)
             AND (r.event_type   IS NULL OR r.event_type   = b.event_type)
             AND (r.object_class IS NULL OR r.object_class = b.object_class)
             AND (r.vehicle_type IS NULL OR r.vehicle_type = b.vehicle_type)
             AND (r.match_state  IS NULL OR r.match_state  = b.event_state OR b.event_type = 'anprAlarm'))`;
      }
      const { rows } = await pool.query(`
        SELECT (EXTRACT(isodow FROM b.bucket AT TIME ZONE $2)::int - 1) AS dow,
               EXTRACT(hour FROM b.bucket AT TIME ZONE $2)::int         AS hour,
               SUM(b.n)::bigint::int                                    AS count
          FROM event_dim_bucket b
         WHERE ${where} ${catClause}
         GROUP BY 1, 2 ORDER BY 1, 2`, params);
      res.json({ days, tz, cells: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/pattern-heatmap', req); }
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
               0 AS event_count
          FROM cameras c
         WHERE c.enabled = TRUE
           AND c.id = ANY($2::text[])
           ${siteSql}
           -- NOT EXISTS หยุดที่ event แรกของแต่ละกล้อง แทนการนับ event ทั้ง 24 ชม. ทุกกล้องแล้วค่อยหาตัวที่เป็น 0
           -- วัด 2026-10-02: 24 ชม. 5,728 ms → 3.6 ms · ผลตรงกันสองทาง (EXCEPT = 0) · คืนเฉพาะกล้องที่ 0 อยู่แล้ว
           -- event_count จึงเป็น 0 เสมอเหมือนเดิม (audit · O7)
           AND NOT EXISTS (
             SELECT 1 FROM events e
              WHERE e.camera_id = c.id
                AND e.event_time >= NOW() - ($1::int * INTERVAL '1 hour')
                AND e.event_type NOT LIKE '%Aggregation%'
                AND NOT ${analyticsEventClause('e.event_type')})
         ORDER BY c.id`,
        qcArgs);
      res.json({ since_hours: sinceHours, cameras: rows });
    } catch (err) { routeError(res, err, 'GET /api/stats/quiet-cameras', req); }
  });

  // GET /api/stats/top-rules?from=ISO&to=ISO[&limit=10][&cameras=...][&tod_from=HH:MM&tod_to=HH:MM]
  // rule_name leaderboard for the active window — helps tune false positives.
  app.get('/api/stats/top-rules', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const tod = parseTod(req.query);
      const tz = await getDisplayTz();
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
      const todClause_TR = todClause('event_time', tod, tz, params.length + 1);
      if (todClause_TR.sql) { where += todClause_TR.sql; params.push(...todClause_TR.args); }
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
    } catch (err) { routeError(res, err, 'GET /api/stats/top-rules', req); }
  });

  // GET /api/stats/timeline-by-category?from=ISO&to=ISO[&cameras=...]
  // One time-series per category (driven by event_category_rules).
  // Used by the Event Overview chart on the Stats page so each category
  // is its own coloured line instead of a single "Total Events" line.
  app.get('/api/stats/timeline-by-category', async (req, res) => {
    try {
      const rawRangeTBC = parseRange(req.query);
      if (rawRangeTBC.to.getTime() - rawRangeTBC.from.getTime() <= 0) {
        return res.status(400).json({ error: 'to must be after from' });
      }
      const tod = parseTod(req.query);
      const trunc = pickTruncUnit(rawRangeTBC.from.getTime(), rawRangeTBC.to.getTime(), req.query.trunc);
      // ถัง 5 นาทีเล็กกว่าถังของตารางสรุป (30 นาที) จึงต้องอ่าน event ดิบเสมอ
      // ที่เหลือ (30 นาที / ชม. / วัน / สัปดาห์) หารลงตัวกับ 30 นาที รวมยอดจากตารางสรุปได้
      const useRollup = trunc !== 'minute5' && trunc !== 'minute2_5'
        && catRollup.canUseRollup(rawRangeTBC.from.getTime(), rawRangeTBC.to.getTime());
      const from = useRollup ? catRollup.snapFrom(rawRangeTBC.from) : rawRangeTBC.from;
      const to   = useRollup ? catRollup.snapTo(rawRangeTBC.to)     : rawRangeTBC.to;
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const tz      = await getDisplayTz();
      const allowedTBC = req.user?.allowedSites ?? null;
      const siteParamTBC = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
      if (siteParamTBC && allowedTBC !== null && !allowedTBC.includes(siteParamTBC))
        return res.status(403).json({ error: 'forbidden' });
      const activeSitesTBC = siteParamTBC ? [siteParamTBC] : allowedTBC;

      const srcAliasTBC = useRollup ? 'b' : 'e';
      const params = [from.toISOString(), to.toISOString(), tz];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND ${srcAliasTBC}.camera_id = ANY($${params.length}::text[])`;
      }
      const swTBC = siteWhere(activeSitesTBC, `${srcAliasTBC}.camera_id`, params.length + 1);
      if (swTBC.sql) { camFilter += ` ${swTBC.sql}`; params.push(...swTBC.args); }

      // Scope the rule join to categories reachable from this request's sites —
      // without this, every event is matched against ALL system-wide rules
      // (44 vs. ~6 relevant ones per site), a large avoidable join fan-out.
      let catSiteFilter = '';
      if (activeSitesTBC !== null) { params.push(activeSitesTBC); catSiteFilter = `AND c.site_id = ANY($${params.length})`; }

      // $3 (tz) must appear in the SQL text on every branch — node-pg's Bind
      // message must match the placeholder count Parse saw, or "supplies N
      // parameters, but prepared statement requires M". 5-min bins don't need
      // tz-of-day alignment, so the round-trip AT TIME ZONE here is a no-op
      // (proven: `ts AT TIME ZONE z AT TIME ZONE z = ts` for any timestamptz,
      // no DST fold since Thailand has none) — it exists only to consume $3.
      const timeColTBC = useRollup ? 'b.bucket' : 'e.event_time';
      const todClause_TBC = todClause(timeColTBC, tod, tz, params.length + 1);
      if (todClause_TBC.sql) { camFilter += todClause_TBC.sql; params.push(...todClause_TBC.args); }
      const bucketExpr = trunc === 'minute2_5'
        ? `date_bin('150 seconds', ${timeColTBC} AT TIME ZONE $3 AT TIME ZONE $3, TIMESTAMPTZ '2000-01-01')`
        : trunc === 'minute5'
        ? `date_bin('5 minutes', ${timeColTBC} AT TIME ZONE $3 AT TIME ZONE $3, TIMESTAMPTZ '2000-01-01')`
        : trunc === 'minute30'
        ? `date_bin('30 minutes', ${timeColTBC} AT TIME ZONE $3 AT TIME ZONE $3, TIMESTAMPTZ '2000-01-01')`
        : `(DATE_TRUNC('${trunc}', ${timeColTBC} AT TIME ZONE $3) AT TIME ZONE $3)`;

      // ช่วงยาวรวมยอดจาก event_dim_bucket แทนการ join event ทุกแถวกับตารางกฎ
      // (ดู migration 163) — ถังของตารางสรุปคือ 30 นาที จึงยุบขึ้นเป็น ชม./วัน/สัปดาห์
      // ได้ด้วย SUM ตรง ๆ · EXISTS ไม่ใช่ JOIN เพราะ event เดียวอาจเข้าหลายกฎในหมวด
      // เดียวกัน ต้องนับครั้งเดียว (ของเดิมใช้ COUNT(DISTINCT e.id) กัน)
      // ⚠️ alias ต้อง **ไม่ชื่อ `bucket`** — event_dim_bucket มีคอลัมน์ชื่อนี้อยู่จริง
      // และเมื่อชื่อกำกวม Postgres ตีความ GROUP BY เป็น **input column ก่อน output
      // alias** (พฤติกรรมตามสเปก) ผลคือ GROUP BY จับ b.bucket ซึ่งเป็นถัง 30 นาทีดิบ
      // แทนที่จะเป็นชั่วโมง/วันที่ truncate แล้ว → หนึ่งชั่วโมงคืนสองแถว หนึ่งวันคืน 48 แถว
      // Chart.js ได้ค่า y หลายค่าที่ x เดียวกัน เส้นจึงย้อนกลับไปมา และตัวเลขที่พล็อต
      // เป็นเพียงเศษเสี้ยวของยอดจริง — ไม่มี error ใด ๆ ให้เห็น (พบ 2026-08-25)
      // สาขา non-rollup ข้างล่างอ่านจาก events ซึ่งไม่มีคอลัมน์ชื่อนี้ จึงไม่เคยพัง
      const sql = useRollup ? `
        SELECT ${bucketExpr} AS bkt,
               c.id AS category_id,
               SUM(b.n)::int AS count
          FROM event_dim_bucket b
          JOIN event_categories c ON TRUE ${catSiteFilter}
         WHERE b.bucket >= $1::timestamptz AND b.bucket < $2::timestamptz
           ${camFilter}
           AND ${catRollup.categoryMatchExists('c')}
         GROUP BY bkt, c.id
         ORDER BY bkt ASC, c.id` : `
        SELECT ${bucketExpr} AS bkt,
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
         GROUP BY bkt, c.id
         ORDER BY bkt ASC, c.id`;

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
        // ชื่อคอลัมน์ที่คืนมาคือ bkt (ดูเหตุผลที่ SQL) แต่รูปที่ส่งออกยังเป็น
        // points[].bucket เหมือนเดิม หน้าจอทุกตัวจึงไม่ต้องแก้ตาม
        byCat[k].push({ bucket: r.bkt, count: r.count });
      });

      const series = catsResult.rows.map(c => ({
        category: { id: c.id, name: c.name, icon: c.icon, color: c.color, kind: c.kind, sort_order: c.sort_order },
        points: byCat[c.id] || [],
      }));

      res.json({ from: from.toISOString(), to: to.toISOString(), trunc, tz, series });
    } catch (err) { routeError(res, err, 'GET /api/stats/timeline-by-category', req); }
  });

  statsReportRoutes(app, pool, subDeps);

};
