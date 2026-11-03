// ============================================================
// Vigil Platform — Routes: Statistics (report-shaped endpoints)
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
const catRollup  = require('../helpers/categoryRollup');
const { siteWhere, resolveSiteScope } = require('../auth');

module.exports = function statsReportRoutes(app, pool, {
  parseRange,
  parseTod,
  todClause,
  getDisplayTz,
  METRIC_EVENT_TYPE_PATTERN,
  analyticsEventClause,
}) {

  // GET /api/stats/breakdown-v2?from=ISO&to=ISO[&cameras=...]
  // Top rule_names within each category (for the breakdown table)
  // GET /api/stats/event-coverage?from=ISO&to=ISO[&cameras=...]
  // Returns per-event_type counts + category assignment for Coverage Matrix / Uncategorized card.
  // bucket classification: incident | metric | analytics | face (fixed 4-bucket, mirrors analyticsEventClause)
  // "unmatched" = events where the full NULL-OR-match LATERAL found no category (c.id IS NULL per-event)
  app.get('/api/stats/event-coverage', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const tod = parseTod(req.query);
      const tz = await getDisplayTz();
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

      const params = [from.toISOString(), to.toISOString()];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
      }
      const swEV = siteWhere(resolveSiteScope(req), 'e.camera_id', params.length + 1);
      if (swEV.sql) { camFilter += ` ${swEV.sql}`; params.push(...swEV.args); }

      const todClause_EV = todClause('e.event_time', tod, tz, params.length + 1);
      if (todClause_EV.sql) { camFilter += todClause_EV.sql; params.push(...todClause_EV.args); }
      // ช่วง ≥2 ชม. อ่านถังเต็มจากตารางสรุป + เศษหัว/ท้ายดิบ (helpers/categoryRollup.eventSource) · เดือน: 45.7 วิ ทั้ง partition
      const ruEV = catRollup.canUseRollup(from.getTime(), to.getTime());
      const srcEV = ruEV ? await catRollup.eventSource(pool, params, from, to) : 'events e';
      const nEV = ruEV ? 'e.n' : '1';

      const sql = `
        SELECT
          e.event_type,
          SUM(${nEV})::int                                           AS count,
          SUM(CASE WHEN c.id IS NULL THEN ${nEV} ELSE 0 END)::int   AS unmatched_count,
          CASE
            WHEN e.event_type LIKE '${METRIC_EVENT_TYPE_PATTERN}' THEN 'metric'
            WHEN ${analyticsEventClause('e.event_type')}           THEN 'analytics'
            WHEN e.event_type LIKE 'FaceCapture%'                  THEN 'face'
            ELSE 'incident'
          END AS bucket,
          MIN(c.id)   AS category_id,
          MIN(c.name) AS category_name,
          MIN(c.kind) AS category_kind
         FROM ${srcEV}
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
        ORDER BY count DESC, e.event_type`;   // ตัดสินแถวยอดเท่ากัน — เดิมสลับลำดับได้ระหว่างครั้ง (ตรวจ 2026-10-26)

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
    } catch (err) { routeError(res, err, 'GET /api/stats/event-coverage', req); }
  });

  app.get('/api/stats/breakdown-v2', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const tod = parseTod(req.query);
      const tz = await getDisplayTz();
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

      const params = [from.toISOString(), to.toISOString()];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
      }
      const swBDV2 = siteWhere(resolveSiteScope(req), 'e.camera_id', params.length + 1);
      if (swBDV2.sql) { camFilter += ` ${swBDV2.sql}`; params.push(...swBDV2.args); }

      // หมวดที่ผู้ใช้ติ๊กออกในหน้ารายงาน — ไม่ส่งมา = ไม่กรอง (หน้าสถิติจึงไม่กระทบ)
      const hideBDV2 = req.query.cats_hide
        ? String(req.query.cats_hide).split(',').map(x => parseInt(x, 10)).filter(Number.isFinite) : null;
      if (hideBDV2 && hideBDV2.length) {
        params.push(hideBDV2);
        camFilter += ` AND ${catRollup.hideCategoriesClause(`$${params.length}::int[]`, 'e')}`;
      }

      const todClause_BDV2 = todClause('e.event_time', tod, tz, params.length + 1);
      if (todClause_BDV2.sql) { camFilter += todClause_BDV2.sql; params.push(...todClause_BDV2.args); }
      // ช่วง ≥2 ชม. อ่านถังเต็มจาก event_dim_bucket + นับดิบเฉพาะเศษหัว/ท้าย — ผลเท่าเดิมทุกแถว (helpers/categoryRollup.eventSource)
      // เดือน: 45 วิ (อ่านทั้ง partition ~37 GB) · ช่วงสั้นนับดิบตามเดิม
      const ruBD = catRollup.canUseRollup(from.getTime(), to.getTime());
      const srcBD = ruBD ? await catRollup.eventSource(pool, params, from, to) : 'events e';

      // Exclude metric (CountAggregation/*) and camera-automation analytics
      // events — neither is an "incident", so they don't belong in the
      // report's event breakdown.
      const sql = `
        SELECT COALESCE(NULLIF(e.rule_name, ''), e.event_type) AS name,
               e.event_type,
               e.camera_id,
               -- ชื่อกล้องที่ผู้ใช้ตั้งไว้ (เป็นชื่อสถานที่ เช่น "ขาออกตำบลฉลอง (C3)")
               -- รายงานเดิมพิมพ์แต่รหัสกล้อง C3-CHL-SB-01 ซึ่งคนอ่านรายงานไม่รู้ว่าที่ไหน
               COALESCE(NULLIF(cam.name, ''), e.camera_id) AS camera_name,
               NULLIF(cam.location_label, '')             AS camera_location,
               ${ruBD ? 'SUM(e.n)' : 'COUNT(*)'}::int AS count
          FROM ${srcBD}
          LEFT JOIN cameras cam ON cam.id = e.camera_id
         WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
           AND e.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
           AND NOT ${analyticsEventClause('e.event_type')}
           ${camFilter}
         -- ⚠️ ใช้เลขคอลัมน์ ไม่ใช่ชื่อ — alias "name" ชนกับ cam.name หลัง LEFT JOIN
         --    Postgres ตีความเป็น cam.name แล้วฟ้องว่า e.rule_name ไม่อยู่ใน GROUP BY
         GROUP BY 1, 2, 3, 4, 5
         -- ตัดสินแถวยอดเท่ากัน — เดิมแถวที่ยอดเท่ากันตรงอันดับ 30 หลุดเข้า/ออกได้ระหว่างครั้ง (ตรวจ 2026-10-26)
         ORDER BY count DESC, 1, 2, 3
         LIMIT 30`;
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/stats/breakdown-v2', req); }
  });

  // GET /api/stats/evidence?from=ISO&to=ISO[&cameras=...][&tod_from=HH:MM&tod_to=HH:MM]
  // Snapshot + clip coverage for events in the window.
  app.get('/api/stats/evidence', async (req, res) => {
    try {
      const { from, to } = parseRange(req.query);
      const tod = parseTod(req.query);
      const tz = await getDisplayTz();
      const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
      const params = [from.toISOString(), to.toISOString()];
      let camFilter = '';
      if (cameras && cameras.length) {
        params.push(cameras);
        camFilter = ` AND camera_id = ANY($${params.length}::text[])`;
      }
      const swEVI = siteWhere(resolveSiteScope(req), 'camera_id', params.length + 1);
      if (swEVI.sql) { camFilter += ` ${swEVI.sql}`; params.push(...swEVI.args); }

      const todClause_EVI = todClause('event_time', tod, tz, params.length + 1);
      if (todClause_EVI.sql) { camFilter += todClause_EVI.sql; params.push(...todClause_EVI.args); }
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
    } catch (err) { routeError(res, err, 'GET /api/stats/evidence', req); }
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
        // `appearances` เก็บทุกวัตถุที่กล้องติดตาม ไม่ใช่เฉพาะคน — ที่ RMUTR-V เป็นคน
        // จริง 533 จาก 12,388 (4.3%) การ์ดเคยเอายอดรวมไปติดป้ายว่า "ข้อมูลบุคคล"
        // (รายงาน 2026-08-20) จึงคืนทั้งสองค่าให้หน้าจอเลือกพูดได้ถูก
        pool.query(`SELECT COUNT(*)::int AS appearances,
                 COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons
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
        persons:       apR.rows[0].persons,
        faces:         evR.rows[0].faces,
        face_matches:  evR.rows[0].face_matches,
        lpr:           lpR.rows[0].lpr,
      });
    } catch (err) { routeError(res, err, 'GET /api/stats/forensic-summary', req); }
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
    } catch (err) { routeError(res, err, 'GET /api/stats/alert-effectiveness', req); }
  });
};
