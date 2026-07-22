// ============================================================
// Vigil Platform — Routes: Faces (FaceCapture + FaceRecognition)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const { getSystemSetting } = require('../helpers/getSystemSetting');
const { siteWhere } = require('../auth');

// FP6 — query-time similarity threshold (face_similarity_min, %). similarity is
// stored 0..1, so compare against min/100. NULL similarity is left untouched
// (passes). A recognition below the threshold is treated as a "miss" — reversible
// (history unchanged); change the setting and matches re-appear.
async function _faceSimMin(pool) {
  const n = parseInt(await getSystemSetting(pool, 'face_similarity_min'), 10);
  return (Number.isFinite(n) && n > 0) ? n : 0;   // 0 = threshold disabled (no-op)
}
// col = jsonb path expr, e.g. "raw_json" or "e.raw_json"
const _passMin  = (col, m) => `((${col}->>'similarity') IS NULL OR (${col}->>'similarity')::float >= ${m}/100.0)`;
const _belowMin = (col, m) => `((${col}->>'similarity') IS NOT NULL AND (${col}->>'similarity')::float < ${m}/100.0)`;

// Dahua NVR face event_type equivalents (2026-07-15 Face-page integration
// pass). Dahua's own `FaceDetector/Recognized` fires per-detection — same
// role as Hikvision's FaceCapture (a face was seen, demographics attached).
// `FaceDetector/Comparison` is the gallery/blacklist match RESULT — same
// role as Hikvision's FaceRecognition+listType. Every hardcoded
// 'FaceCapture'/'FaceRecognition' literal below is widened to an IN-list
// (additive) rather than renaming Dahua's event_type at ingest, so the
// generic Events feed / dedup / alert-rule matching already built around
// Dahua's own vocabulary today (dahua-protocol.js DAHUA_EVENT_MAP) keeps
// working unchanged.
const CAPTURE_TYPES_SQL = `'FaceCapture','FaceDetector/Recognized'`;
const RECOG_TYPES_SQL   = `'FaceRecognition','FaceDetector/Comparison'`;

module.exports = function facesRoutes(app, pool) {

  function _buildFaceFilter(q) {
    // include_recog=1 broadens the gallery to also show FaceRecognition snapshots
    // (push cameras like HIK-FACE-HKT01 emit recognition events with no demographics).
    // Only the overview "ใบหน้าล่าสุด" loader passes it — search tab + KPI stay capture-only.
    const clauses = [ q.include_recog === '1'
      ? `event_type IN (${CAPTURE_TYPES_SQL},${RECOG_TYPES_SQL})`
      : `event_type IN (${CAPTURE_TYPES_SQL})` ];
    if (q.include_recog === '1') {
      // Dahua twin suppression (2026-07-15, "ภาพเบิ้ล" report): unlike
      // Hikvision — where FaceCapture and FaceRecognition come from DIFFERENT
      // cameras — a Dahua NVR fires FaceDetector/Recognized AND
      // FaceDetector/Comparison from the SAME camera for the same person, so
      // the include_recog view showed every person twice. Hide the Recognized
      // twin when its Comparison sibling exists — the Comparison row is the
      // better representative (it carries the NVR-stored face crop via
      // dahua-rpc.js; the Recognized twin depends on the flaky snapshot.cgi
      // grab). Twins are matched by the NVR's own ObjectID — live-verified
      // identical across each pair (e.g. 1513005=1513005), even when
      // event_time drifted ~10s apart because Recognized's timestamp used to
      // be stamped AFTER its capture attempt (that stamping bug is fixed in
      // dahua-cgi.js the same day, but historical rows keep the drift, hence
      // ObjectID matching + a generous 60s bracket instead of a tight
      // time-only window). Recognized-only detections (no Comparison fired —
      // ~43% of traffic) are untouched; NULL ObjectID rows are kept (EXISTS
      // can't match NULL); Hikvision rows never match (different camera_id).
      // Filtering happens before COUNT(*) OVER() so pagination stays exact.
      clauses.push(`NOT (event_type = 'FaceDetector/Recognized' AND EXISTS (
        SELECT 1 FROM events e2
         WHERE e2.camera_id = events.camera_id
           AND e2.event_type = 'FaceDetector/Comparison'
           AND e2.raw_json->'data'->'Face'->>'ObjectID' = events.raw_json->'data'->'Object'->>'ObjectID'
           AND e2.event_time BETWEEN events.event_time - INTERVAL '60 seconds'
                                 AND events.event_time + INTERVAL '60 seconds'))`);
    }
    const params = [];
    let n = 0;
    const eq = (col, val) => { clauses.push(`${col} = $${++n}`); params.push(val); };
    if (q.gender)     eq(`raw_json->>'gender'`, q.gender);
    if (q.mask)       eq(`raw_json->>'mask'`, q.mask);
    if (q.glass)      eq(`raw_json->>'glass'`, q.glass);
    if (q.hat)        eq(`raw_json->>'hat'`, q.hat);
    if (q.expression) eq(`raw_json->>'faceExpression'`, q.expression);
    if (q.camera)     eq(`camera_id`, q.camera);
    if (q.cameras)    { const a = String(q.cameras).split(',').map(s => s.trim()).filter(Boolean); if (a.length) { clauses.push(`camera_id = ANY($${++n})`); params.push(a); } }
    if (q.top_color)    { clauses.push(`EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = events.id AND a.upper_color = $${++n})`);    params.push(q.top_color); }
    if (q.bottom_color) { clauses.push(`EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = events.id AND a.lower_color = $${++n})`);    params.push(q.bottom_color); }
    if (q.top_type)     { clauses.push(`EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = events.id AND a.top_category = $${++n})`);   params.push(q.top_type); }
    if (q.bottom_type)  { clauses.push(`EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = events.id AND a.bottom_category = $${++n})`); params.push(q.bottom_type); }
    if (q.age_min) { clauses.push(`(raw_json->>'age')::int >= $${++n}`); params.push(parseInt(q.age_min, 10)); }
    if (q.age_max) { clauses.push(`(raw_json->>'age')::int <= $${++n}`); params.push(parseInt(q.age_max, 10)); }
    if (q.from)    { clauses.push(`event_time >= $${++n}`); params.push(q.from); }
    if (q.to)      { clauses.push(`event_time <= $${++n}`); params.push(q.to); }
    return { where: clauses.join(' AND '), params, n };
  }

  // Time+space burst grouping (2026-07-15, "จัดกลุ่มแบบ NVR" plan) — opt-in
  // via ?group=burst_spatial, used ONLY by the "ใบหน้าล่าสุด" overview widget
  // (page-face-matches.js _loadFaceOvLatest, a fixed "latest N" fetch with no
  // pagination). NOT applied by default: /api/faces is also called by the
  // paginated face gallery (page-face-gallery.js) and recognition feed
  // (page-face-matches.js loadFaceMatches), which rely on X-Total-Count for
  // correct page counts — grouping would break that the same way it would
  // have for the Snapshots gallery this morning (hence opt-in, not default).
  //
  // Distance threshold is relative to the face's own BoundingBox width, not
  // an absolute pixel/unit number — live investigation today found Center/
  // BoundingBox values regularly exceed the JPEG's own ImageInfo.Width/Height
  // (e.g. Center.x=5792 vs ImageInfo.Width=1920), so the coordinate space is
  // some NVR-internal analytics grid, not plain output-image pixels. Since
  // the exact grid is unconfirmed, scaling by each event's own BoundingBox
  // size (same detector, same event, same units by construction) sidesteps
  // needing to know the absolute unit — two Centers within ~1.5x the average
  // BoundingBox width of the two events are treated as the same physical
  // face position.
  const BURST_GAP_MS = 8000;
  const BURST_BBOX_MULTIPLIER = 1.5;
  function _groupFaceBursts(rows) {
    // rows arrive event_time DESC (newest first); walk in that order and
    // compare each row against the most-recently-kept (chronologically
    // later) card in the same running group.
    const out = [];
    for (const r of rows) {
      const t = new Date(r.event_time).getTime();
      const center = Array.isArray(r.center) ? r.center : null;
      const bboxW = Array.isArray(r.bounding_box) ? Math.abs(r.bounding_box[2] - r.bounding_box[0]) : null;
      const last = out[out.length - 1];
      let merge = false;
      if (last && last.camera_id === r.camera_id && (last._lastMs - t) <= BURST_GAP_MS) {
        if (last._center && center && last._bboxW && bboxW) {
          const dist = Math.hypot(center[0] - last._center[0], center[1] - last._center[1]);
          const threshold = ((last._bboxW + bboxW) / 2) * BURST_BBOX_MULTIPLIER;
          merge = dist <= threshold;
        } else {
          // either row lacks Center/BoundingBox — fall back to time-only
          // (don't force a distance check we can't actually compute).
          merge = true;
        }
      }
      if (merge) {
        last.burst_count++;
        last._lastMs = t; last._center = center; last._bboxW = bboxW;
      } else {
        out.push({ ...r, burst_count: 1, _lastMs: t, _center: center, _bboxW: bboxW });
      }
    }
    return out.map(({ _lastMs, _center, _bboxW, center, bounding_box, ...rest }) => rest);
  }

  app.get('/api/faces', async (req, res) => {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10)  || 60));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const grouped = req.query.group === 'burst_spatial';
    try {
      const f = _buildFaceFilter(req.query);
      const sw = siteWhere(req.user?.allowedSites ?? null, 'camera_id', f.n + 1);
      if (sw.sql) { f.where += ` ${sw.sql}`; f.params.push(...sw.args); f.n += sw.args.length; }
      let n = f.n;
      const sql = `
        SELECT id, event_time, camera_id,
               raw_json->>'_snapshot'      AS snapshot,
               raw_json->>'_snapshot_full' AS snapshot_full,
               raw_json->>'age'            AS age,
               raw_json->>'ageGroup'       AS age_group,
               raw_json->>'gender'         AS gender,
               raw_json->>'faceExpression' AS expression,
               raw_json->>'glass'          AS glass,
               raw_json->>'mask'           AS mask,
               raw_json->>'hat'            AS hat,
               raw_json->>'stayDuration'   AS stay_duration,
               raw_json->>'faceScore'      AS face_score,
               raw_json->'faceRect'        AS face_rect,
               raw_json->'data'->'Object'->'Center'      AS center,
               raw_json->'data'->'Object'->'BoundingBox' AS bounding_box,
               clip_file, clip_status,
               COUNT(*) OVER() ::int       AS _total
          FROM events
         WHERE ${f.where}
         ORDER BY event_time DESC
         LIMIT $${++n} OFFSET $${++n}`;
      const params = [...f.params, limit, offset];
      const r = await pool.query(sql, params);
      const total = r.rows[0] ? r.rows[0]._total : 0;
      res.set('X-Total-Count', String(total));
      const rows = r.rows.map(({ _total, ...rest }) => rest);
      res.json(grouped ? _groupFaceBursts(rows) : rows.map(({ center, bounding_box, ...rest }) => rest));
    } catch (err) {
      routeError(res, err, 'GET /api/faces');
    }
  });

  // Demographic summary for the Face page header — same filters as
  // /api/faces, aggregated: gender split, age bands, mask count.
  app.get('/api/faces/summary', async (req, res) => {
    try {
      const f = _buildFaceFilter(req.query);
      const swS = siteWhere(req.user?.allowedSites ?? null, 'camera_id', f.n + 1);
      if (swS.sql) { f.where += ` ${swS.sql}`; f.params.push(...swS.args); }
      const r = await pool.query(`
        SELECT
          COUNT(*)::int                                                         AS total,
          COUNT(*) FILTER (WHERE raw_json->>'gender'='male')::int                AS male,
          COUNT(*) FILTER (WHERE raw_json->>'gender'='female')::int              AS female,
          COUNT(*) FILTER (WHERE raw_json->>'mask'='yes')::int                   AS masked,
          COUNT(*) FILTER (WHERE raw_json->>'age' ~ '^[0-9]+$' AND (raw_json->>'age')::int <= 19)::int             AS age_teen,
          COUNT(*) FILTER (WHERE raw_json->>'age' ~ '^[0-9]+$' AND (raw_json->>'age')::int BETWEEN 20 AND 39)::int  AS age_young,
          COUNT(*) FILTER (WHERE raw_json->>'age' ~ '^[0-9]+$' AND (raw_json->>'age')::int BETWEEN 40 AND 59)::int  AS age_mid,
          COUNT(*) FILTER (WHERE raw_json->>'age' ~ '^[0-9]+$' AND (raw_json->>'age')::int >= 60)::int             AS age_senior
        FROM events WHERE ${f.where}`, f.params);
      res.json(r.rows[0] || {});
    } catch (err) {
      routeError(res, err, 'GET /api/faces/summary');
    }
  });

  // Tab count badges for the Faces page (ค้นหาบุคคล) — 3 categories in one query:
  //   capture = FaceCapture · match = FaceRecognition+listType · miss = FaceRecognition no listType
  app.get('/api/faces/counts', async (req, res) => {
    try {
      const min = await _faceSimMin(pool);
      const swC = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', 1);
      const r = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE event_type IN (${CAPTURE_TYPES_SQL}))::int                                 AS capture,
          COUNT(*) FILTER (WHERE event_type IN (${RECOG_TYPES_SQL}) AND raw_json->>'listType' IS NOT NULL)::int   AS match,
          COUNT(*) FILTER (WHERE event_type IN (${RECOG_TYPES_SQL}) AND raw_json->>'listType' IS NULL)::int       AS miss,
          COUNT(*) FILTER (WHERE event_type IN (${RECOG_TYPES_SQL}) AND raw_json->>'listType'='blackList'
                             AND ${_passMin('raw_json', min)} AND a.event_id IS NULL)::int                  AS unacked_watch
        FROM events e
        LEFT JOIN face_event_acks a ON a.event_id = e.id
        WHERE event_type IN (${CAPTURE_TYPES_SQL},${RECOG_TYPES_SQL}) ${swC.sql}`,
      swC.args);
      const showExpr = (await getSystemSetting(pool, 'face_show_expression')) !== '0';
      res.json({ ...(r.rows[0] || { capture: 0, match: 0, miss: 0, unacked_watch: 0 }), show_expression: showExpr });
    } catch (err) {
      routeError(res, err, 'GET /api/faces/counts');
    }
  });

  // Period → time-window clause on e.event_time. Mirrors lpr-query.js
  // periodClause VERBATIM (copied, not shared, to avoid coupling faces stats to
  // the LPR module). TZ matters: api-server forces every connection to UTC
  // (api-server.js:74), so a bare ::date boundary = UTC midnight = 07:00 Bangkok
  // and the hourly peak would shift 7h. Convert Bangkok-local boundaries back via
  // AT TIME ZONE 'Asia/Bangkok'. (verified in psql 2026-06-22: UTC hr 4 = BKK hr 11)
  const _BKK     = `(NOW() AT TIME ZONE 'Asia/Bangkok')`;
  const _BKK_DAY = `${_BKK}::date::timestamp AT TIME ZONE 'Asia/Bangkok'`;
  function _facePeriodClause(period, from, to, startIdx) {
    switch (period) {
      case 'hour':      return { sql: `e.event_time >= NOW() - INTERVAL '1 hour'`, args: [] };
      case 'yesterday': return { sql: `e.event_time >= ${_BKK_DAY} - INTERVAL '1 day' AND e.event_time < ${_BKK_DAY}`, args: [] };
      case 'week':      return { sql: `e.event_time >= date_trunc('week',  ${_BKK}) AT TIME ZONE 'Asia/Bangkok'`, args: [] };
      case 'month':     return { sql: `e.event_time >= date_trunc('month', ${_BKK}) AT TIME ZONE 'Asia/Bangkok'`, args: [] };
      case 'custom': {
        // Compute the placeholder index BEFORE push (off-by-one otherwise: with
        // 2 args the SQL referenced $2/$3, leaving $1 unbound → "could not
        // determine data type of parameter $1"). ::timestamptz keeps it typed.
        const conds = [], args = [];
        if (from) { conds.push(`e.event_time >= $${startIdx + args.length}::timestamptz`); args.push(from); }
        if (to)   { conds.push(`e.event_time <= $${startIdx + args.length}::timestamptz`); args.push(to); }
        return { sql: conds.length ? conds.join(' AND ') : 'TRUE', args };
      }
      case 'today':
      default:          return { sql: `e.event_time >= ${_BKK_DAY}`, args: [] };
    }
  }

  // GET /api/faces/stats — overview tab (FP2). Period-aware. KPI mixes
  // FaceCapture (total) + FaceRecognition split by listType (recog=whiteList /
  // watch=blackList / miss=null). Charts + hourly peak = FaceCapture demographics.
  // Each sub-query carries its own copy of pc.args ($N restart at $1 per query).
  app.get('/api/faces/stats', async (req, res) => {
    const period = String(req.query.period || 'today');
    const pc = _facePeriodClause(period, req.query.from, req.query.to, 1);
    const swSt = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', pc.args.length + 1);
    const sArgs = [...pc.args, ...swSt.args];
    let n = sArgs.length;
    let camClause = '';
    if (req.query.cameras) {
      const a = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (a.length) { camClause = ` AND e.camera_id = ANY($${++n})`; sArgs.push(a); }
    }
    const capWhere = `e.event_type IN (${CAPTURE_TYPES_SQL}) AND ${pc.sql} ${swSt.sql}${camClause}`;
    const recWhere = `e.event_type IN (${RECOG_TYPES_SQL}) AND ${pc.sql} ${swSt.sql}${camClause}`;
    try {
      const min = await _faceSimMin(pool);
      const [demo, rec, expr, hourly] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*)::int                                                              AS total,
             COUNT(*) FILTER (WHERE e.raw_json->>'gender'='male')::int                  AS male,
             COUNT(*) FILTER (WHERE e.raw_json->>'gender'='female')::int                AS female,
             COUNT(*) FILTER (WHERE COALESCE(e.raw_json->>'gender','') NOT IN ('male','female'))::int AS gender_unknown,
             COUNT(*) FILTER (WHERE (e.raw_json->>'age')::int <= 19)::int               AS age_teen,
             COUNT(*) FILTER (WHERE (e.raw_json->>'age')::int BETWEEN 20 AND 39)::int    AS age_young,
             COUNT(*) FILTER (WHERE (e.raw_json->>'age')::int BETWEEN 40 AND 59)::int    AS age_mid,
             COUNT(*) FILTER (WHERE (e.raw_json->>'age')::int >= 60)::int               AS age_senior
           FROM events e WHERE ${capWhere}`, sArgs),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE e.raw_json->>'listType'='whiteList' AND ${_passMin('e.raw_json', min)})::int AS recog,
             COUNT(*) FILTER (WHERE e.raw_json->>'listType'='blackList' AND ${_passMin('e.raw_json', min)})::int AS watch,
             COUNT(*) FILTER (WHERE e.raw_json->>'listType' IS NULL OR ${_belowMin('e.raw_json', min)})::int      AS miss
           FROM events e WHERE ${recWhere}`, sArgs),
        pool.query(
          `SELECT COALESCE(NULLIF(e.raw_json->>'faceExpression',''),'unknown') AS name, COUNT(*)::int AS n
           FROM events e WHERE ${capWhere} GROUP BY name ORDER BY n DESC`, sArgs),
        pool.query(
          `SELECT EXTRACT(HOUR FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int AS hr, COUNT(*)::int AS n
           FROM events e WHERE ${capWhere} GROUP BY hr ORDER BY hr`, sArgs),
      ]);
      const d = demo.rows[0] || {};
      const hours = Array(24).fill(0);
      hourly.rows.forEach(r => { hours[r.hr] = r.n; });
      res.json({
        period,
        total: d.total || 0,
        recog: rec.rows[0]?.recog || 0,
        watch: rec.rows[0]?.watch || 0,
        miss:  rec.rows[0]?.miss  || 0,
        gender: { male: d.male || 0, female: d.female || 0, unknown: d.gender_unknown || 0 },
        age:    { teen: d.age_teen || 0, young: d.age_young || 0, mid: d.age_mid || 0, senior: d.age_senior || 0 },
        expression: expr.rows.map(r => ({ name: r.name, n: r.n })),
        hourly: hours,
        show_expression: (await getSystemSetting(pool, 'face_show_expression')) !== '0',
      });
    } catch (err) {
      routeError(res, err, 'GET /api/faces/stats');
    }
  });

  function _faceReportBucket(period) {
    if (period === 'week') {
      return {
        key: `EXTRACT(DOW FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int`,
        labels: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
      };
    }
    if (period === 'month') {
      return {
        key: `EXTRACT(DAY FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int`,
        labels: Array.from({ length: 31 }, (_, i) => String(i + 1)),
      };
    }
    return {
      key: `EXTRACT(HOUR FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int`,
      labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    };
  }

  // R1a — report-specific face stats. This deliberately does not widen
  // /api/faces/stats: report filters (FDLib group, min score) must stay
  // internally consistent without changing the Face page overview contract.
  app.get('/api/stats/face/report', async (req, res) => {
    const period = String(req.query.period || 'today');
    const pc = _facePeriodClause(period, req.query.from, req.query.to, 1);
    const minFloor = await _faceSimMin(pool);
    const requestedMin = parseFloat(req.query.min_score);
    const minPct = Math.max(
      minFloor,
      Number.isFinite(requestedMin) && requestedMin > 0 ? requestedMin : minFloor || 80
    );
    const minRatio = minPct / 100;
    const swR = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', pc.args.length + 1);
    const rPcArgs = [...pc.args, ...swR.args];
    const rPcSql  = swR.sql ? `${pc.sql} ${swR.sql}` : pc.sql;
    const group = String(req.query.group || 'all').trim();
    const groupSql = group && group !== 'all'
      ? ` AND e.raw_json->>'fdLibName' = $${rPcArgs.length + 2}`
      : '';
    const groupArgs = groupSql ? [group] : [];
    const siteId = req.query.site_id ? parseInt(req.query.site_id) : null;
    const bucket = _faceReportBucket(period);
    const recArgs = [...rPcArgs, minRatio, ...groupArgs];
    const capSiteClause = siteId ? ` AND e.camera_id IN (SELECT id FROM cameras WHERE site_id = $${rPcArgs.length + 1})` : '';
    const capSiteArgs   = siteId ? [siteId] : [];
    const recSiteClause = siteId ? ` AND e.camera_id IN (SELECT id FROM cameras WHERE site_id = $${recArgs.length + 1})` : '';
    const recSiteArgs   = siteId ? [siteId] : [];
    const capWhere = `e.event_type IN (${CAPTURE_TYPES_SQL}) AND ${rPcSql}${capSiteClause}`;
    const recWhere = `e.event_type IN (${RECOG_TYPES_SQL}) AND ${rPcSql} AND (e.raw_json->>'similarity')::float >= $${rPcArgs.length + 1}${groupSql}${recSiteClause}`;

    try {
      const [kpi, demo, accessories, peak, trend, topPersons, suspects, groups] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE e.event_type IN (${CAPTURE_TYPES_SQL}))::int AS captures,
             COUNT(*) FILTER (WHERE e.event_type IN (${RECOG_TYPES_SQL}) AND e.raw_json->>'listType'='whiteList' AND (e.raw_json->>'similarity')::float >= $${rPcArgs.length + 1}${groupSql})::int AS known,
             COUNT(*) FILTER (WHERE e.event_type IN (${RECOG_TYPES_SQL}) AND e.raw_json->>'listType'='blackList' AND (e.raw_json->>'similarity')::float >= $${rPcArgs.length + 1}${groupSql})::int AS watch,
             COUNT(*) FILTER (WHERE e.event_type IN (${RECOG_TYPES_SQL}) AND (e.raw_json->>'listType' IS NULL OR (e.raw_json->>'similarity')::float < $${rPcArgs.length + 1})${groupSql})::int AS unknown
           FROM events e
          WHERE e.event_type IN (${CAPTURE_TYPES_SQL},${RECOG_TYPES_SQL}) AND ${rPcSql}${recSiteClause}`,
          [...recArgs, ...recSiteArgs]
        ),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE e.raw_json->>'gender'='male')::int AS male,
             COUNT(*) FILTER (WHERE e.raw_json->>'gender'='female')::int AS female,
             COUNT(*) FILTER (WHERE COALESCE(e.raw_json->>'gender','') NOT IN ('male','female'))::int AS gender_unknown,
             COUNT(*) FILTER (WHERE e.raw_json->>'age' ~ '^[0-9]+$' AND (e.raw_json->>'age')::int <= 19)::int AS age_teen,
             COUNT(*) FILTER (WHERE e.raw_json->>'age' ~ '^[0-9]+$' AND (e.raw_json->>'age')::int BETWEEN 20 AND 39)::int AS age_young,
             COUNT(*) FILTER (WHERE e.raw_json->>'age' ~ '^[0-9]+$' AND (e.raw_json->>'age')::int BETWEEN 40 AND 59)::int AS age_mid,
             COUNT(*) FILTER (WHERE e.raw_json->>'age' ~ '^[0-9]+$' AND (e.raw_json->>'age')::int >= 60)::int AS age_senior
           FROM events e WHERE ${capWhere}`,
          [...rPcArgs, ...capSiteArgs]
        ),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE e.raw_json->>'glass' IN ('yes','sunglasses'))::int AS glass,
             COUNT(*) FILTER (WHERE e.raw_json->>'mask' = 'yes')::int AS mask,
             COUNT(*) FILTER (WHERE e.raw_json->>'hat' = 'yes')::int AS hat,
             COUNT(*) FILTER (WHERE e.raw_json->>'bag' = 'yes')::int AS bag
           FROM events e WHERE ${capWhere}`,
          [...rPcArgs, ...capSiteArgs]
        ),
        pool.query(
          `SELECT ${bucket.key} AS bucket, COUNT(*)::int AS n
             FROM events e WHERE ${capWhere} GROUP BY bucket ORDER BY bucket`,
          [...rPcArgs, ...capSiteArgs]
        ),
        pool.query(
          `SELECT ${bucket.key} AS bucket,
                  COUNT(*) FILTER (WHERE e.raw_json->>'listType'='whiteList')::int AS known,
                  COUNT(*) FILTER (WHERE e.raw_json->>'listType'='blackList')::int AS watch,
                  COUNT(*) FILTER (WHERE e.raw_json->>'listType' IS NULL)::int AS unknown
             FROM events e WHERE ${recWhere} GROUP BY bucket ORDER BY bucket`,
          [...recArgs, ...recSiteArgs]
        ),
        pool.query(
          `SELECT e.raw_json->>'humanId' AS human_id,
                  COALESCE(NULLIF(e.raw_json->>'personName',''),'Unknown') AS name,
                  e.raw_json->>'fdLibName' AS group_name,
                  COUNT(*)::int AS hits,
                  MAX(e.event_time) AS last_seen
             FROM events e
            WHERE ${recWhere} AND e.raw_json->>'listType' IS NOT NULL
            GROUP BY 1,2,3 ORDER BY hits DESC, last_seen DESC LIMIT 20`,
          [...recArgs, ...recSiteArgs]
        ),
        pool.query(
          `SELECT e.id, e.event_time, e.camera_id,
                  COALESCE(NULLIF(e.raw_json->>'personName',''),'Unknown') AS name,
                  e.raw_json->>'fdLibName' AS group_name,
                  (e.raw_json->>'similarity')::float AS score,
                  e.raw_json->>'humanId' AS human_id,
                  COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot,
                  e.raw_json->>'_snapshot_ref' AS ref_snapshot
             FROM events e
            WHERE ${recWhere} AND e.raw_json->>'listType'='blackList'
            ORDER BY e.event_time DESC LIMIT 200`,
          [...recArgs, ...recSiteArgs]
        ),
        // ponytail: unscoped — FDLib group names only, no personal data, used for dropdown filter
        pool.query(
          `SELECT DISTINCT e.raw_json->>'fdLibName' AS name
             FROM events e
            WHERE e.event_type IN (${RECOG_TYPES_SQL}) AND e.raw_json->>'fdLibName' IS NOT NULL
            ORDER BY 1`
        ),
      ]);

      const toSeries = (rows, field = 'n') => {
        const values = Array(bucket.labels.length).fill(0);
        rows.forEach(r => {
          const idx = period === 'month' ? parseInt(r.bucket, 10) - 1 : parseInt(r.bucket, 10);
          if (idx >= 0 && idx < values.length) values[idx] = parseInt(r[field], 10) || 0;
        });
        return values;
      };
      const trendRows = trend.rows || [];
      const trendSeries = (field) => {
        const values = Array(bucket.labels.length).fill(0);
        trendRows.forEach(r => {
          const idx = period === 'month' ? parseInt(r.bucket, 10) - 1 : parseInt(r.bucket, 10);
          if (idx >= 0 && idx < values.length) values[idx] = parseInt(r[field], 10) || 0;
        });
        return values;
      };

      const k = kpi.rows[0] || {};
      const d = demo.rows[0] || {};
      const peakValues = toSeries(peak.rows);
      const peakMax = Math.max(...peakValues, 0);
      const peakIdx = peakValues.indexOf(peakMax);
      res.json({
        period,
        group,
        min_score: minPct,
        kpi: {
          captures: k.captures || 0,
          known: k.known || 0,
          watch: k.watch || 0,
          unknown: k.unknown || 0,
        },
        demographics: {
          gender: { male: d.male || 0, female: d.female || 0, unknown: d.gender_unknown || 0 },
          age: { teen: d.age_teen || 0, young: d.age_young || 0, mid: d.age_mid || 0, senior: d.age_senior || 0 },
          accessories: accessories.rows[0] || { glass: 0, mask: 0, hat: 0, bag: 0 },
        },
        peak: { labels: bucket.labels, values: peakValues, max: peakMax, index: peakIdx },
        trend: {
          labels: bucket.labels,
          known: trendSeries('known'),
          watch: trendSeries('watch'),
          unknown: trendSeries('unknown'),
        },
        top_persons: topPersons.rows,
        suspects: suspects.rows.map(r => ({ ...r, score_pct: r.score == null ? null : Math.round(Number(r.score) * 100) })),
        groups: groups.rows.map(r => r.name).filter(Boolean),
      });
    } catch (err) {
      routeError(res, err, 'GET /api/stats/face/report');
    }
  });

  // FP4 — operator note on a face event (any authenticated user; req.user set by
  // the global /api auth middleware). One editable note per event (upsert).
  app.get('/api/face-matches/:id/note', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    try {
      const swN = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', 2);
      const r = await pool.query(
        `SELECT n.note, n.author, n.updated_at
         FROM face_event_notes n
         JOIN events e ON e.id = n.event_id
         WHERE n.event_id = $1 ${swN.sql}`, [id, ...swN.args]);
      res.json(r.rows[0] || null);
    } catch (err) { routeError(res, err, 'GET /api/face-matches/:id/note'); }
  });

  // Save/replace the note. Empty note is REJECTED (no silent delete — clearing the
  // box must not destroy an existing note). author = last editor (last-writer-wins).
  app.post('/api/face-matches/:id/note', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note)              return res.status(400).json({ error: 'note_empty' });
    if (note.length > 2000) return res.status(400).json({ error: 'note_too_long' });
    const author = req.user?.username || null;
    try {
      if (req.user?.isSiteScoped) {
        const chk = await pool.query(
          'SELECT 1 FROM events WHERE id = $1 AND camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($2))',
          [id, req.user.allowedSites]);
        if (!chk.rowCount) return res.status(403).json({ error: 'forbidden' });
      }
      const r = await pool.query(
        `INSERT INTO face_event_notes (event_id, note, author, updated_at)
              VALUES ($1, $2, $3, now())
         ON CONFLICT (event_id) DO UPDATE
              SET note = EXCLUDED.note, author = EXCLUDED.author, updated_at = now()
         RETURNING note, author, updated_at`,
        [id, note, author]);
      res.json(r.rows[0]);
    } catch (err) { routeError(res, err, 'POST /api/face-matches/:id/note'); }
  });

  // FP5 — acknowledge a watch-list match. Upsert (re-ack = last-writer-wins);
  // ack state rides down in the GET /api/face-matches payload (acked_by/at), so
  // there's no GET /ack. plain-auth (same write convention as note).
  app.post('/api/face-matches/:id/ack', async (req, res) => {
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
        `INSERT INTO face_event_acks (event_id, acked_by, acked_by_id, acked_at)
              VALUES ($1, $2, $3, now())
         ON CONFLICT (event_id) DO UPDATE
              SET acked_by = EXCLUDED.acked_by, acked_by_id = EXCLUDED.acked_by_id, acked_at = now()
         RETURNING acked_by, acked_at`,
        [id, req.user?.username || null, req.user?.id || null]);
      res.json(r.rows[0]);
    } catch (err) { routeError(res, err, 'POST /api/face-matches/:id/ack'); }
  });

  // ============================================================
  // Face Recognition matches — paginated, filterable by person name,
  // list type, camera, and date range. Separate from FaceCapture
  // (stranger analytics) — these are watchlist matches from FDLib.
  // ============================================================
  app.get('/api/face-matches', async (req, res) => {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit,  10) || 60));
    const offset = Math.max(0,                parseInt(req.query.offset, 10) || 0);
    try {
      const min = await _faceSimMin(pool);   // FP6 threshold; below-min recognitions become "miss"
      const clauses = [`event_type IN (${RECOG_TYPES_SQL})`];
      const params  = [];
      let n = 0;
      if (req.query.person)    { clauses.push(`raw_json->>'personName' ILIKE $${++n}`); params.push(`%${req.query.person}%`); }
      if (req.query.list_type)   { clauses.push(`raw_json->>'listType' = $${++n} AND ${_passMin('raw_json', min)}`); params.push(req.query.list_type); }
      if (req.query.fd_lib_name) { clauses.push(`raw_json->>'fdLibName' = $${++n}`);      params.push(req.query.fd_lib_name); }
      if (req.query.hits_only === '1')   { clauses.push(`raw_json->>'listType' IS NOT NULL AND ${_passMin('raw_json', min)}`); }
      if (req.query.misses_only === '1') { clauses.push(`(raw_json->>'listType' IS NULL OR ${_belowMin('raw_json', min)})`); }
      if (req.query.gender)    { clauses.push(`raw_json->>'gender' = $${++n}`);           params.push(req.query.gender); }
      if (req.query.glass)     { clauses.push(`raw_json->>'glass' = $${++n}`);            params.push(req.query.glass); }
      if (req.query.mask)      { clauses.push(`raw_json->>'mask' = $${++n}`);             params.push(req.query.mask); }
      if (req.query.hat)       { clauses.push(`raw_json->>'hat' = $${++n}`);              params.push(req.query.hat); }
      if (req.query.expression){ clauses.push(`raw_json->>'faceExpression' = $${++n}`);   params.push(req.query.expression); }
      if (req.query.camera)    { clauses.push(`camera_id = $${++n}`);                   params.push(req.query.camera); }
      if (req.query.cameras)   {
        const a = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
        if (a.length) { clauses.push(`camera_id = ANY($${++n})`); params.push(a); }
      }
      if (req.query.from)      { clauses.push(`event_time >= $${++n}`);                 params.push(req.query.from); }
      if (req.query.to)        { clauses.push(`event_time <= $${++n}`);                 params.push(req.query.to); }
      const swM = siteWhere(req.user?.allowedSites ?? null, 'camera_id', n + 1);
      if (swM.sql) { clauses.push(swM.sql.replace(/^AND /, '')); params.push(...swM.args); n += swM.args.length; }
      const where = clauses.join(' AND ');
      const sql = `
        SELECT id, event_time, camera_id,
               raw_json->>'personName'              AS person_name,
               CASE WHEN ${_belowMin('raw_json', min)} THEN NULL ELSE raw_json->>'listType' END AS list_type,
               raw_json->>'fdLibName'               AS fd_lib_name,
               (raw_json->>'similarity')::float      AS similarity,
               raw_json->>'humanId'                  AS human_id,
               COALESCE(snapshot_filename, raw_json->>'_snapshot')
                                                     AS snapshot,
               raw_json->>'_snapshot_full'           AS snapshot_full,
               raw_json->>'_snapshot_ref'            AS snapshot_ref,
               raw_json->>'_snapshot_body'           AS snapshot_body,
               raw_json->>'age'                      AS age,
               raw_json->>'gender'                   AS gender,
               raw_json->>'glass'                    AS glass,
               raw_json->>'mask'                     AS mask,
               raw_json->>'hat'                      AS hat,
               raw_json->>'faceExpression'            AS expression,
               raw_json->>'faceScore'                AS face_score,
               raw_json->>'ageGroup'                 AS age_group,
               raw_json->>'jacketColor'              AS jacket_color,
               raw_json->>'trousersColor'            AS trousers_color,
               raw_json->>'jacketType'               AS jacket_type,
               raw_json->>'trousersType'             AS trousers_type,
               raw_json->>'hairStyle'                AS hair_style,
               raw_json->>'bag'                      AS bag,
               raw_json->>'things'                   AS things,
               raw_json->>'direction'                AS direction,
               raw_json->>'ridingBike'               AS riding_bike,
               raw_json->>'ridingWithPassenger'      AS riding_passenger,
               clip_file, clip_status,
               a.acked_by                            AS acked_by,
               a.acked_at                            AS acked_at,
               COUNT(*) OVER() ::int                 AS _total
          FROM events e
          LEFT JOIN face_event_acks a ON a.event_id = e.id
         WHERE ${where}
         ORDER BY event_time DESC, id DESC
         LIMIT $${++n} OFFSET $${++n}`;
      params.push(limit, offset);
      const r = await pool.query(sql, params);
      const total = r.rows[0] ? r.rows[0]._total : 0;
      res.set('X-Total-Count', String(total));
      res.json(r.rows.map(({ _total, ...row }) => row));
    } catch (err) {
      routeError(res, err, 'GET /api/face-matches');
    }
  });

  // distinct FDLib group names — for populating filter dropdown dynamically
  // ponytail: deliberately unscoped — metadata only (group names, not events); same class as inline groups above
  app.get('/api/face-matches/groups', async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT DISTINCT raw_json->>'fdLibName' AS name
        FROM events
        WHERE event_type IN (${RECOG_TYPES_SQL})
          AND raw_json->>'fdLibName' IS NOT NULL
        ORDER BY 1`);
      res.json(r.rows.map(row => row.name));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};
