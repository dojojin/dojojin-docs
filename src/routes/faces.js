// ============================================================
// Vigil Platform — Routes: Faces (FaceCapture + FaceRecognition)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const { refPhotoScalarSql } = require('../helpers/faceRefLookup');
const { getSystemSetting } = require('../helpers/getSystemSetting');
const { siteWhere, requireAdmin } = require('../auth');
const { createTtlCache } = require('../helpers/ttlCache');
const { perCameraFrom } = require('../helpers/perCameraScan');
const env = require('../config');

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

// HCP face-match events store list/person/library under snake_case keys
// (list_type/hcp_list_type, hcp_person_name, hcp_group_name) while the
// Hikvision-direct path uses camelCase (listType/personName/fdLibName). These
// coalesce so the Face Data page surfaces BOTH sources without re-ingesting
// history. camelCase wins when present → Hikvision-direct behaviour unchanged.
// เพดานเวลาของ "การนับจำนวนผลลัพธ์" ในแท็บค้นหา — 500ms เท่ากับที่ /api/face-matches
// ใช้อยู่ · วัดจริง 2026-08-27: การนับ FaceCapture ช่วงเดือนนี้กิน 25 วินาที ⇒ ช่วงกว้าง
// จะไม่ได้ยอดจริงเลย ซึ่งถูกต้องแล้ว — หน้าจอแสดง "N+" จากแถวที่ได้มาจริงแทน
// ตัวเลขที่ไม่มีใครใช้ตัดสินใจและเปลี่ยนทุกวินาทีอยู่แล้ว ไม่คุ้มกับการรอ
const FACE_COUNT_TIMEOUT_MS = env.int('FACE_COUNT_TIMEOUT_MS');
// ?count=only ยิงแยกหลังตารางขึ้นแล้ว ไม่มีใครนั่งรอหน้าเปล่า จึงให้เวลามากกว่า
// (12 วินาที เท่ากับที่ /api/lpr ใช้) ⇒ ได้ยอดจริงในช่วงที่กว้างขึ้นมาก
const FACE_COUNT_ONLY_TIMEOUT_MS = env.int('FACE_COUNT_ONLY_TIMEOUT_MS');

const _listType   = (c = 'raw_json') => `COALESCE(${c}->>'listType', ${c}->>'list_type', ${c}->>'hcp_list_type')`;
const _personName = (c = 'raw_json') => `COALESCE(${c}->>'personName', ${c}->>'hcp_person_name')`;
const _fdLibName  = (c = 'raw_json') => `COALESCE(${c}->>'fdLibName', ${c}->>'hcp_group_name')`;

// ชื่อกลุ่ม FDLib/HCP สำหรับ dropdown ตัวกรอง — เคยเป็น DISTINCT บน `events` แบบ
// **ไม่มีขอบเวลา** และถูกยิงจากสองที่ (route /api/face-matches/groups + ทุกครั้งที่เรียก
// /api/stats/face/report) วัดจริง 2026-09-07: 14.5 วิ ตอน cold เพราะไล่ index ทุก partition
// ย้อนไปถึงพาร์ทิชันที่ไม่มี event ชนิดนี้เลย
// ขอบ 90 วันพิสูจน์แล้วว่าได้คำตอบเดิม: 30/90/180 วัน ได้ 10 ชื่อเท่ากับ all-time
// (ข้อมูลชนิดนี้เริ่ม 2026-06-22) · bounded = 273 ms · cache 30 นาทีเพราะเป็น dropdown
// ไม่ใช่รายงาน · unscoped โดยตั้งใจ — เป็นชื่อกลุ่มล้วน ไม่มีข้อมูลบุคคล
const GROUP_NAMES_WINDOW_DAYS = 90;
const GROUP_NAMES_TTL_MS = 30 * 60 * 1000;

module.exports = function facesRoutes(app, pool) {

  const _groupNamesCache = createTtlCache({
    name: 'faces:group-names', ttlMs: GROUP_NAMES_TTL_MS, max: 1 });
  // วัด 2026-10-06: cold 26–29 วิ (ต้องอ่าน 275k แถวชนิดนี้ที่กระจายอยู่ทั่ว heap) ⇒ ตอบค่าเก่าระหว่าง
  // โหลดใหม่ (SWR) + อุ่นตอนบูต — คนเปิดรายงานบุคคลไม่ต้องรอ dropdown อีก ยกเว้นช่วงแรกหลังบูต
  // กระโดดทีละชื่อบน idx_events_face_group_name (migration 280) — 18 ชื่อ = ~18 ครั้งที่แตะ index แทนการเปิด raw_json
  // ของ event การจดจำ 352,243 แถว (DISTINCT เดิม 26–49 วิ ตอน cache เย็น → 1.4 ms · ผลเหมือนเดิมทุกชื่อและลำดับ 2026-10-25)
  // ⚠️ DISTINCT ธรรมดาใช้ index นี้ไม่ได้: index-only scan ของ expression index ต้องมี raw_json ใน index ด้วย (ข้อจำกัดของ PG)
  const _recogWhere = `event_type IN (${RECOG_TYPES_SQL}) AND event_time > now() - interval '${GROUP_NAMES_WINDOW_DAYS} days'`;
  const groupNames = () => _groupNamesCache.wrap('all', async () => {
    const { rows } = await pool.query(
      `WITH RECURSIVE g(name) AS (
         (SELECT ${_fdLibName('raw_json')} FROM events
           WHERE ${_recogWhere} AND ${_fdLibName('raw_json')} IS NOT NULL
           ORDER BY 1 LIMIT 1)
         UNION ALL
         SELECT (SELECT ${_fdLibName('raw_json')} FROM events
                  WHERE ${_recogWhere} AND ${_fdLibName('raw_json')} > g.name
                  ORDER BY 1 LIMIT 1)
           FROM g WHERE g.name IS NOT NULL)
       SELECT name FROM g WHERE name IS NOT NULL`);
    return rows.map((r) => r.name).filter(Boolean);
  }, { staleWhileRevalidate: true, maxStaleMs: 24 * 3600_000 });
  setTimeout(() => groupNames().catch(() => {}), 15_000).unref?.();

  // `min` is the similarity threshold, needed only by misses_only. Optional so
  // the summary caller, which has no use for it, stays a plain synchronous call.
  function _buildFaceFilter(q, min = null) {
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
    let camIdx = 0;   // ตำแหน่ง param ของรายชื่อกล้อง — /api/faces ใช้ไล่ทีละกล้อง (helpers/perCameraScan.js)
    if (q.cameras)    { const a = String(q.cameras).split(',').map(s => s.trim()).filter(Boolean); if (a.length) { clauses.push(`camera_id = ANY($${++n})`); params.push(a); camIdx = n; } }
    if (q.top_color)    { clauses.push(`EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = events.id AND a.upper_color = $${++n})`);    params.push(q.top_color); }
    if (q.bottom_color) { clauses.push(`EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = events.id AND a.lower_color = $${++n})`);    params.push(q.bottom_color); }
    if (q.top_type)     { clauses.push(`EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = events.id AND a.top_category = $${++n})`);   params.push(q.top_type); }
    if (q.bottom_type)  { clauses.push(`EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = events.id AND a.bottom_category = $${++n})`); params.push(q.bottom_type); }
    if (q.age_min) { clauses.push(`(raw_json->>'age')::int >= $${++n}`); params.push(parseInt(q.age_min, 10)); }
    if (q.age_max) { clauses.push(`(raw_json->>'age')::int <= $${++n}`); params.push(parseInt(q.age_max, 10)); }
    // "ไม่พบในระบบ" — recognition ran and matched nobody, or matched below the
    // threshold. Same rule /api/face-matches uses, so the Live tab's chip and
    // the alert feed cannot disagree about what a miss is. Only meaningful
    // alongside include_recog, since a FaceCapture has no listType to lack.
    // The recognition-type restriction is not optional here, unlike in
    // /api/face-matches where the base clause already applies it: a FaceCapture
    // also has no listType, so the bare rule matched every capture in the feed
    // and the chip changed nothing (caught by running it, 2026-08-02).
    if (q.misses_only === '1' && min != null) {
      clauses.push(`event_type IN (${RECOG_TYPES_SQL})
        AND (${_listType('raw_json')} IS NULL OR ${_belowMin('raw_json', min)})`);
    }
    if (q.from)    { clauses.push(`event_time >= $${++n}`); params.push(q.from); }
    if (q.to)      { clauses.push(`event_time <= $${++n}`); params.push(q.to); }
    return { where: clauses.join(' AND '), params, n, camIdx };
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
      const f = _buildFaceFilter(req.query, await _faceSimMin(pool));
      // Search tab perf (2026-07-29): with include_recog=1 and no date filter,
      // the twin-suppression NOT EXISTS below runs per matching row across the
      // WHOLE history — measured 51.6s. Default to the last 24h when the caller
      // hasn't picked a range. Only the non-grouped view is affected; the
      // overview widget (group=burst_spatial) skips COUNT(*) OVER() already
      // and stays fast, so it's left untouched.
      if (!grouped && !req.query.from && !req.query.to) {
        f.where += ` AND event_time >= NOW() - INTERVAL '24 hours'`;
      }
      const sw = siteWhere(req.user?.allowedSites ?? null, 'camera_id', f.n + 1);
      if (sw.sql) { f.where += ` ${sw.sql}`; f.params.push(...sw.args); f.n += sw.args.length; }
      // "ใบหน้าล่าสุด" บนหน้าภาพรวม (grouped, ไม่มีช่วง) — ไซต์ที่ไม่มีกล้องใบหน้าเดินทั้งประวัติ
      // ด้วย ORDER BY event_time DESC LIMIT แล้วไม่เจออะไร (hdy 50 กล้อง >70 วิ · 2026-10-03 · D8)
      // ถามตารางสรุป 7 วันก่อน (12 ms) ไม่มี = คืนว่างทันที · มี = ขอบ 7 วันเท่ากับขอบของตารางสรุป
      if (grouped && !req.query.from && !req.query.to) {
        const kw = [`event_type IN (${CAPTURE_TYPES_SQL}${req.query.include_recog === '1' ? `,${RECOG_TYPES_SQL}` : ''})`];
        const ka = [];
        const camList = String(req.query.cameras || '').split(',').map(s => s.trim()).filter(Boolean);
        if (camList.length) { ka.push(camList); kw.push(`camera_id = ANY($${ka.length})`); }
        const ksw = siteWhere(req.user?.allowedSites ?? null, 'camera_id', ka.length + 1);
        const any = await pool.query(
          `SELECT 1 FROM event_kpi_hourly WHERE ${kw.join(' AND ')} ${ksw.sql} LIMIT 1`, [...ka, ...ksw.args]);
        if (!any.rows.length) return res.json([]);
        f.where += ` AND event_time >= NOW() - INTERVAL '7 days'`;
      }
      let n = f.n;
      // เลือกกล้องเป็นชุด → ไล่ทีละกล้อง (GOTCHAS #236) · นราธิวาส/RMUTR-V ไม่มีใบหน้าเลย แต่เดิมเดิน index เวลา
      // ทั้งเดือนจนชนเพดาน 120 วิ · VSS ค้นเดือน 15–38 วิ
      const perCam = (inner) => perCameraFrom(inner, `camera_id = ANY($${f.camIdx})`, f.camIdx, 'camera_id');
      const countSql = () => { const lat = perCam(`SELECT 1 FROM events WHERE ${f.where}`);
        return lat ? `SELECT count(*)::int AS n FROM ${lat}` : `SELECT count(*)::int AS n FROM events WHERE ${f.where}`; };

      // ?count=only — คำขอ "นับอย่างเดียว" ที่หน้าจอยิงแยกหลังจากตารางขึ้นแล้ว
      // (ท่าเดียวกับ /api/lpr) · ให้เวลามากกว่าเพราะไม่มีใครนั่งรอหน้าเปล่าอยู่
      //
      // ทำไมต้องแยก: วัดจริง 2026-08-27 การนับใน request เดียวกับตาราง ช่วงกว้าง
      // กว่า 1 ชั่วโมงจะนับไม่ทันในเพดาน 500ms ⇒ ทุกคนจ่าย 500ms ทิ้งแล้วไม่ได้
      // ตัวเลขกลับมาเลย (0.51 วินาที ทั้งที่ตัวข้อมูลใช้ 0.01) · พอแยกออกมา
      // ตารางขึ้นทันที และช่วงที่นับไหวก็ยังได้ยอดจริง แค่มาทีหลังนิดเดียว
      if (req.query.count === 'only') {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query(`SET LOCAL statement_timeout = ${FACE_COUNT_ONLY_TIMEOUT_MS}`);
          const cr = await c.query(countSql(), f.params);
          await c.query('COMMIT');
          return res.json({ n: cr.rows[0].n, exact: true });
        } catch {
          try { await c.query('ROLLBACK'); } catch {}
          // นับไม่ทันก็บอกตรง ๆ ว่าไม่มีเลข ไม่ส่งค่าประมาณ — หน้าจอแสดง "N+"
          // จากแถวที่เปิดดูมาแล้วจริงแทน ซึ่งเป็นความจริงเสมอ
          return res.json({ n: null, exact: false });
        } finally { c.release(); }
      }
      // COUNT(*) OVER() costs the WHOLE filtered set, which defeats the LIMIT:
      // with include_recog the twin-suppression NOT EXISTS then runs once per
      // matching row (24,441 correlated subplans, each rebuilding a 20k-row
      // bitmap) — measured 37.0s vs 0.04s without the window. The grouped
      // overview never reads X-Total-Count, and could not use it anyway: it
      // collapses rows into bursts, so the raw count describes something other
      // than what is returned (24 rows -> 17 groups). Skip it there.
      //
      // 🔴 2026-08-27 — window count นี้คือเหตุที่แท็บ "ค้นหา" ค้าง วัดจริงบนช่วง
      //    "เดือนนี้" (FaceCapture 3.1 ล้านแถว):
      //      มี COUNT(*) OVER()     >200 วินาที (ถูกฆ่าทิ้ง ไม่จบ)
      //      ไม่มี                    0.03 วินาที
      //      นับแยกล้วน ๆ            25 วินาที  ⇒ ไม่มีเพดานไหนที่รอไหว
      //    ⇒ ใช้ท่าเดียวกับ /api/face-matches ข้างล่างในไฟล์นี้ ซึ่งเจอปัญหา
      //      เดียวกันแล้วแก้ไปตั้งแต่ 2026-08-21: ขอเกินมา 1 แถวเพื่อรู้ว่ามีหน้า
      //      ถัดไหม แล้วนับแยกแบบมีเพดาน ถ้านับไม่ทันก็ไม่ส่ง header
      //    OFFSET ไม่ใช่ปัญหา (วัดแล้ว OFFSET 12,000 = 0.09 วินาที เพราะไต่ index
      //    ตาม event_time) จึงไม่ต้องรื้อไป keyset เหมือนหน้า LPR
      const wantTotal = !grouped && req.query.with_total !== '0';
      const selectSql = `
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
               clip_file, clip_status
          FROM events
         WHERE ${f.where}`;
      // ขอเกินมา 1 แถว = รู้ว่ามีหน้าถัดไปไหมโดยไม่ต้องนับอะไรเลย
      const take = grouped ? limit : limit + 1;
      // แต่ละกล้องเอาแค่ (offset + take) แถวล่าสุด — ผลรวมยังมีครบทุกแถวที่หน้านี้ต้องแสดง
      // id ตัดสินเมื่อเวลาเท่ากัน — LIMIT ต่อกล้องของแต่ละหน้าไม่เท่ากัน ถ้าไม่ตัดสิน แถวเวลาเท่ากันตรงขอบหน้าอาจ
      // ซ้ำ/หายระหว่างหน้า (ตรวจ 2026-10-25) · ทางเดิม (ไม่เลือกกล้องเป็นชุด) คงลำดับเดิมไว้ไม่ให้แผนเปลี่ยน
      const lat = perCam(`${selectSql} ORDER BY event_time DESC, id DESC LIMIT ${take + offset}`);
      const sql = lat
        ? `SELECT x.* FROM ${lat} ORDER BY x.event_time DESC, x.id DESC LIMIT $${++n} OFFSET $${++n}`
        : `${selectSql} ORDER BY event_time DESC LIMIT $${++n} OFFSET $${++n}`;
      const params = [...f.params, take, offset];
      const r = await pool.query(sql, params);
      let rows = r.rows;
      if (!grouped) {
        const hasMore = rows.length > limit;
        if (hasMore) rows = rows.slice(0, limit);
        res.set('X-Has-More', hasMore ? '1' : '0');
      }
      if (wantTotal) {
        // นับแยกบน connection ของตัวเอง: where เดียวกัน แต่ไม่มี SELECT list ที่หนัก
        // และมีเพดานเวลา — นับไม่ทันก็ไม่ส่ง header ไป ไม่ใช่ให้ทั้งหน้ารอ
        //
        // ⚠️ SET LOCAL มีผลเฉพาะใน transaction block เท่านั้น — นอก block Postgres
        //    เตือนแล้วปล่อยค่าเดิม (เคยพลาดมาแล้วที่ /api/face-matches เพดานจึงไม่
        //    เคยทำงาน) ต้องห่อ BEGIN/COMMIT ถึงจะบังคับได้จริง
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query(`SET LOCAL statement_timeout = ${FACE_COUNT_TIMEOUT_MS}`);
          const cr = await c.query(countSql(), f.params);
          await c.query('COMMIT');
          res.set('X-Total-Count', String(cr.rows[0].n));
        } catch { try { await c.query('ROLLBACK'); } catch {} }
        finally { c.release(); }
      }
      res.json(grouped ? _groupFaceBursts(rows) : rows.map(({ center, bounding_box, ...rest }) => rest));
    } catch (err) {
      routeError(res, err, 'GET /api/faces');
    }
  });

  // Demographic summary for the Face page header — same filters as
  // /api/faces, aggregated: gender split, age bands, mask count.
  app.get('/api/faces/summary', async (req, res) => {
    // ช่วงเวลามาจากตัวกรองของผู้เรียก · ไม่ส่งช่วง = 24 ชม. (ด้านล่าง)
    // 🟡 วัด 2026-09-07: ไม่ส่งช่วง = 44 วิ · ส่ง 7 วัน = 17.6 วิ (ไม่มี index (event_type,event_time))
    try {
      const f = _buildFaceFilter(req.query);
      // ไม่ส่งช่วง = 24 ชม. ล่าสุด เท่ากับรายการ /api/faces ข้าง ๆ (เดิมนับทั้งประวัติ 44 วิ
      // ขณะที่รายการแสดงแค่ 24 ชม. — ตัวเลขหัวหน้ากับรายการเลยคนละขอบ · D8)
      if (!req.query.from && !req.query.to) f.where += ` AND event_time >= NOW() - INTERVAL '24 hours'`;
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
      const params = [...swC.args];
      // Site-scope the badge the same way /api/face-matches scopes its list
      // (2026-07-29) — before this, the badge always counted every site
      // while the list obeyed the page's own site filter, so a site with no
      // matches still showed a nonzero "เฝ้าระวัง" badge from other sites.
      let camClause = '';
      if (req.query.cameras) {
        const a = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
        if (a.length) { params.push(a); camClause = ` AND e.camera_id = ANY($${params.length})`; }
      }
      // 🔴 2026-08-27 — เดิมคิวรีนี้นับสาขา capture ด้วย = FaceCapture 3.1 ล้านแถว
      //    ทั้งประวัติ โดยไม่มีขอบเขตเวลาเลย · วัดจริงบนข้อมูลจริง:
      //      นับ capture + recog   29.92 วินาที
      //      นับเฉพาะ recog         1.08 วินาที
      //    ตัวเลข capture ไปโผล่เป็นป้ายบนแท็บ "ค้นหา" (3,099,645) ซึ่งไม่มีใครใช้
      //    ตัดสินใจอะไร แต่ทำให้ทุกคนที่เปิดหน้านี้รอ 30 วินาที ⇒ เจ้าของสั่งให้เอาออก
      //    เหลือเฉพาะสาขา recog (~107k แถว) ที่ยังมีคนใช้จริงสามอย่าง: ป้ายแท็บ
      //    "แจ้งเตือน" · pill แจ้งเตือนที่ยังไม่รับทราบ (FP5) · สวิตช์ซ่อนกราฟอารมณ์ (FP6)
      // 🔴 รอบสอง 2026-08-27 — ยังเหลือ 3.75 วินาที เพราะตัวนับ `miss`
      //    (listType IS NULL) บังคับให้อ่านทุกแถว recognition มาแกะ jsonb
      //    แต่ `miss` ตัวนี้ **ไม่มีใครอ่าน** — ตัวที่หน้าจอใช้ทำการ์ด "ไม่พบในระบบ"
      //    คือ d.miss จาก /api/faces/stats คนละ endpoint กัน (ตรวจ 2026-08-27:
      //    ไม่มีที่ไหนใน dashboard/ อ่าน c.miss เลย)
      //
      //    พอตัดทิ้งแล้วเติม "listType IS NOT NULL" เข้าไปใน WHERE ตัว planner
      //    ใช้ partial index ที่มีอยู่แล้วได้ทันที (idx_events_face_haslist_time —
      //    ตรวจแล้วมีครบทุก partition) แถวที่ต้องแตะร่วงจาก 35,644 เหลือ 624
      //      3.75 วินาที → 0.04 วินาที · ไม่ต้องสร้าง index ใหม่เลย
      //
      //    ⚠️ เงื่อนไขในบรรทัด WHERE ต้องตรงกับนิยามของ index เป๊ะ ๆ ถ้าแก้ _listType
      //    (เพิ่ม key ใหม่) ต้องแก้นิยาม index ตามด้วย ไม่งั้นเงียบ ๆ กลับไป seq scan
      // 🔴 2026-10-26 — `OFFSET 0` กั้นไม่ให้ planner ดันตัวกรองกล้องเข้าไปข้างใน: หลังมี idx_events_face_cam_time
      //    (migration 279) มันเลือก BitmapAnd กล้อง × ประเภท แล้วเปิดแถวการจดจำทุกแถวของกล้องชุดนั้นมาเช็ค listType
      //    (VSS 16,456 block · cache เย็น 92 ms → 1.06 วิ) · partial index ข้างบนมีทั้งระบบแค่ ~2,700 แถว
      //    หาจากมันก่อนแล้วค่อยกรองกล้องถูกกว่าทุกไซต์ · ผลเหมือนเดิม (ตัวกรองชุดเดิม แค่ลำดับการหา)
      const r = await pool.query(`
        SELECT
          COUNT(*)::int AS match,
          COUNT(*) FILTER (WHERE ${_listType('raw_json')}='blackList'
                             AND ${_passMin('raw_json', min)} AND a.event_id IS NULL)::int AS unacked_watch
        FROM (SELECT id, camera_id, raw_json FROM events
               WHERE event_type IN (${RECOG_TYPES_SQL})
                 AND ${_listType('raw_json')} IS NOT NULL
              OFFSET 0) e
        LEFT JOIN face_event_acks a ON a.event_id = e.id
        WHERE TRUE ${swC.sql}${camClause}`,
      params);
      const showExpr = (await getSystemSetting(pool, 'face_show_expression')) !== '0';
      // capture = null ไม่ใช่ 0 — null อ่านว่า "ไม่มีตัวเลขนี้แล้ว" ส่วน 0 อ่านว่า
      // "ไม่มีใบหน้าเลย" ซึ่งไม่จริง · ฝั่งหน้าจอเช็ค != null อยู่แล้วจึงซ่อนป้ายให้เอง
      // capture / miss = null ไม่ใช่ 0 — null อ่านว่า "ไม่มีตัวเลขนี้แล้ว" ส่วน 0
      // อ่านว่า "นับแล้วได้ศูนย์" ซึ่งไม่จริง · ฝั่งหน้าจอเช็ค != null อยู่แล้ว
      res.json({ capture: null, miss: null, ...(r.rows[0] || { match: 0, unacked_watch: 0 }), show_expression: showExpr });
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
             COUNT(*) FILTER (WHERE ${_listType('e.raw_json')}='whiteList' AND ${_passMin('e.raw_json', min)})::int AS recog,
             COUNT(*) FILTER (WHERE ${_listType('e.raw_json')}='blackList' AND ${_passMin('e.raw_json', min)})::int AS watch,
             COUNT(*) FILTER (WHERE ${_listType('e.raw_json')} IS NULL OR ${_belowMin('e.raw_json', min)})::int      AS miss
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
      ? ` AND ${_fdLibName('e.raw_json')} = $${rPcArgs.length + 2}`
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
             COUNT(*) FILTER (WHERE e.event_type IN (${RECOG_TYPES_SQL}) AND ${_listType('e.raw_json')}='whiteList' AND (e.raw_json->>'similarity')::float >= $${rPcArgs.length + 1}${groupSql})::int AS known,
             COUNT(*) FILTER (WHERE e.event_type IN (${RECOG_TYPES_SQL}) AND ${_listType('e.raw_json')}='blackList' AND (e.raw_json->>'similarity')::float >= $${rPcArgs.length + 1}${groupSql})::int AS watch,
             COUNT(*) FILTER (WHERE e.event_type IN (${RECOG_TYPES_SQL}) AND (${_listType('e.raw_json')} IS NULL OR (e.raw_json->>'similarity')::float < $${rPcArgs.length + 1})${groupSql})::int AS unknown
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
                  COUNT(*) FILTER (WHERE ${_listType('e.raw_json')}='whiteList')::int AS known,
                  COUNT(*) FILTER (WHERE ${_listType('e.raw_json')}='blackList')::int AS watch,
                  COUNT(*) FILTER (WHERE ${_listType('e.raw_json')} IS NULL)::int AS unknown
             FROM events e WHERE ${recWhere} GROUP BY bucket ORDER BY bucket`,
          [...recArgs, ...recSiteArgs]
        ),
        pool.query(
          `SELECT e.raw_json->>'humanId' AS human_id,
                  COALESCE(NULLIF(${_personName('e.raw_json')},''),'Unknown') AS name,
                  ${_fdLibName('e.raw_json')} AS group_name,
                  COUNT(*)::int AS hits,
                  MAX(e.event_time) AS last_seen
             FROM events e
            WHERE ${recWhere} AND ${_listType('e.raw_json')} IS NOT NULL
            GROUP BY 1,2,3 ORDER BY hits DESC, last_seen DESC LIMIT 20`,
          [...recArgs, ...recSiteArgs]
        ),
        pool.query(
          `SELECT e.id, e.event_time, e.camera_id,
                  COALESCE(NULLIF(${_personName('e.raw_json')},''),'Unknown') AS name,
                  ${_fdLibName('e.raw_json')} AS group_name,
                  (e.raw_json->>'similarity')::float AS score,
                  e.raw_json->>'humanId' AS human_id,
                  COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot,
                  e.raw_json->>'_snapshot_ref' AS ref_snapshot,
                  -- see the identical, more-commented CASE further down (helmet-top's
                  -- sibling endpoint) for why the face_blacklist branch alone isn't enough
                  CASE WHEN e.raw_json->>'source' = 'hcp' AND e.raw_json->>'_snapshot_ref' IS NULL THEN ${refPhotoScalarSql('e')} END AS ref_photo
             FROM events e
            WHERE ${recWhere} AND ${_listType('e.raw_json')}='blackList'
            ORDER BY e.event_time DESC LIMIT 200`,
          [...recArgs, ...recSiteArgs]
        ),
        // ponytail: unscoped — FDLib group names only, no personal data, used for dropdown filter
        // (คิวรีเดียวกับ /api/face-matches/groups — รวมเป็นตัวเดียวที่มี cache แล้ว)
        groupNames(),
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
        kpi: (() => {
          const captures = k.captures || 0;
          // เฝ้าระวัง — _listType() เป็น COALESCE(listType, list_type, hcp_list_type)
          // จึงครอบทั้งฝั่ง HCP และ AuraFace อยู่แล้ว ไม่ต้องรวมจากสองที่
          const watch = k.watch || 0;
          return {
            captures,
            known: k.known || 0,
            watch,
            // ⚠️ เดิมนับจากเฉพาะ event ชนิด "จดจำใบหน้า" ที่ไม่มีผลจับคู่ ⇒ ไซต์ที่กล้อง
            //    ส่งแต่ FaceCapture (ภูเก็ต 98,999 ใบ/วัน) จะได้ 0 เสมอ ทั้งที่ควรเป็น
            //    "ใบหน้าที่ระบบไม่รู้จัก" ทั้งหมด · เจ้าของสั่ง 2026-08-22:
            //    ไม่รู้จัก = ใบหน้าทั้งหมด − เฝ้าระวัง
            unknown: Math.max(0, captures - watch),
          };
        })(),
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
        groups,                                   // groupNames() คืน string[] มาแล้ว
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
  // write-guard: งานเจ้าหน้าที่ (บันทึกโน้ตบนเหตุการณ์) — viewer ทำได้โดยตั้งใจ
  app.post('/api/face-matches/:id/note', async (req, res) => {
    // unbounded: อ่าน/เขียนแถวเดียวตาม event id
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
  // write-guard: งานเจ้าหน้าที่ (รับทราบเหตุการณ์) — viewer ทำได้โดยตั้งใจ
  app.post('/api/face-matches/:id/ack', async (req, res) => {
    // unbounded: อ่าน/เขียนแถวเดียวตาม event id
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


  // ── ข้อมูลเสริมของการจับคู่แบบ AuraFace ────────────────────────────────
  // ระบบ HCP ยัดชื่อบุคคล/บัญชี/ภาพอ้างอิงไว้ใน events.raw_json แต่ AuraFace ไม่ได้
  // เก็บที่นั่น — อยู่ใน face_blacklist_hits + face_blacklist เท่านั้น
  // ถ้าไม่เติมให้ การ์ดจะไม่มีชื่อ ไม่มีบัญชี และ **ไม่มีภาพอ้างอิงให้เทียบ**
  // กลายเป็น bubble รูปเดียว หน้าตาไม่เหมือนการ์ดของ HCP (เจ้าของเจอ 2026-08-13)
  async function auraFaceExtra(eventId) {
    const { rows } = await pool.query(
      `SELECT h.label, h.similarity, bl.group_id, bl.ref_image,
              (SELECT sr.photo_path FROM blacklist.source_records sr
                WHERE sr.id::text = bl.enrolled_ref) AS photo_path
         FROM face_blacklist_hits h
         LEFT JOIN face_blacklist bl ON bl.id = h.blacklist_id
        WHERE h.event_id = $1 LIMIT 1`, [eventId]);
    const r = rows[0];
    if (!r) return null;
    const sim = Number(r.similarity);
    return {
      person_name: r.label,
      rule_name: 'AuraFace Blacklist Match',
      list_type: 'blackList',
      // ชื่อระบบที่เตือน ไม่ใช่ชื่อกลุ่มในโรสเตอร์ (ghcp07 ฯลฯ) — ต้องแยกออกจากการ์ด
      // ของ HCP ได้ทันทีว่าใครเป็นคนเตือน (เจ้าของสั่ง 2026-08-13)
      watchlist: 'LabTest Alarm',
      similarity_pct: Number.isFinite(sim) ? (sim <= 1 ? sim * 100 : sim).toFixed(1) + '%' : undefined,
      // ภาพอ้างอิงอยู่ใต้ PHOTO_DIR เหมือนฝั่ง HCP — ส่ง path ไปให้ตัวประกอบการ์ดใช้ตรง ๆ
      ref_path: r.photo_path || r.ref_image || null,
    };
  }

  // POST /api/face-matches/:id/notify — เจ้าหน้าที่กดส่งการแจ้งเตือนนี้เข้า LINE เอง
  //
  // เหตุผลเดียวกับฝั่ง LPR: ตัวส่งอัตโนมัติมี cooldown ต่อกฎ และอาจถูกปิดไว้
  // แต่พอเจ้าหน้าที่เปิดดูแล้วตัดสินว่า "รายนี้ต้องแจ้งเดี๋ยวนี้" กลับไม่มีทางส่ง
  //
  // ช่องทางไหน: ดูจากที่มาของการจับคู่ ไม่ใช่ให้หน้าจอบอก — หน้าจอโกหกได้
  //   อยู่ใน face_blacklist_hits = เครื่องยนต์ของเราเอง (auraface)
  //   ไม่อยู่                    = มาจาก HikCentral (hcp_face)
  //
  // ⚠️ ข้าม cooldown แต่ **ไม่ข้ามการคัดผู้รับ** — ส่งได้เฉพาะผู้รับที่ระบบรู้จัก
  // และเปิดอยู่ · ติดป้าย "ส่งด้วยตนเองโดย <ชื่อ>" ที่ต้นข้อความเสมอ
  //
  // 🔒 requireAdmin เพิ่ม 2026-08-27: เดิม endpoint นี้เปิดให้ทุกคนที่ล็อกอิน เพราะ
  // ส่งไปหาผู้รับที่ตั้งไว้ตายตัวเท่านั้น — พอเลือกผู้รับเองได้ มันกลายเป็น "ยิงข้อความ
  // หาใครก็ได้ที่ระบบรู้จัก ด้วย token ของลูกค้า" ซึ่งต้องเป็นสิทธิ์แอดมิน เท่ากับ
  // ปุ่มทดสอบในหน้าตั้งค่า (/alert-channels/:ch/test) ที่เป็น requireAdmin อยู่แล้ว
  app.post('/api/face-matches/:id/notify', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    try {
      if (req.user?.isSiteScoped) {
        const chk = await pool.query(
          'SELECT 1 FROM events WHERE id = $1 AND camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($2))',
          [id, req.user.allowedSites]);
        if (!chk.rowCount) return res.status(403).json({ error: 'forbidden' });
      }
      const extra = await auraFaceExtra(id);
      const channel = extra ? 'auraface' : 'hcp_face';

      const { rows: rr } = await pool.query(
        'SELECT * FROM alert_rules WHERE channel = $1', [channel]);
      const rule = rr[0];
      if (!rule) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่าช่องทางนี้ในหน้าการแจ้งเตือน' });

      // ผู้รับเฉพาะครั้งนี้ — ตัวกรองเดียวกับปุ่มทดสอบในหน้าตั้งค่า ใช้ helper ตัวเดียวกัน
      const { resolveTestRecipients } = require('./alert-channels');
      const pickIds = await resolveTestRecipients(pool, req.body?.recipient_ids);
      if (pickIds && !pickIds.length) {
        return res.status(400).json({ error: 'ผู้รับที่เลือกใช้ไม่ได้ (ไม่รู้จัก หรือถูกปิดอยู่)' });
      }
      if (!pickIds && !(rule.recipient_ids || []).length) {
        return res.status(400).json({ error: 'ช่องทางนี้ยังไม่ได้เลือกผู้รับ' });
      }

      const out = await require('../alert-engine').sendTestForRule(
        pool, rule, id, extra,
        { manualBy: req.user?.username || 'ไม่ทราบชื่อ', recipientIds: pickIds });
      res.json({ ok: true, channel, event_id: id, ...out });
    } catch (err) { routeError(res, err, 'POST /api/face-matches/:id/notify'); }
  });

  // POST /api/face-matches/:id/notify-telegram — คู่ของ /notify ข้างบน แต่ส่งเข้า
  // Telegram เท่านั้น (requireAdmin ด้วยเหตุผลเดียวกับ /notify — เลือกผู้รับได้เอง)
  // ว่าง = แชทที่ตั้งไว้ของช่องทางนี้ (rule.telegram_chat_ids)
  app.post('/api/face-matches/:id/notify-telegram', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    try {
      if (req.user?.isSiteScoped) {
        const chk = await pool.query(
          'SELECT 1 FROM events WHERE id = $1 AND camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($2))',
          [id, req.user.allowedSites]);
        if (!chk.rowCount) return res.status(403).json({ error: 'forbidden' });
      }
      const extra = await auraFaceExtra(id);
      const channel = extra ? 'auraface' : 'hcp_face';

      const { rows: rr } = await pool.query(
        'SELECT * FROM alert_rules WHERE channel = $1', [channel]);
      const rule = rr[0];
      if (!rule) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่าช่องทางนี้ในหน้าการแจ้งเตือน' });

      const { rows: tgCfgRows } = await pool.query(
        'SELECT enabled, bot_token_enc FROM telegram_config WHERE id = 1');
      const tgCfg = tgCfgRows[0];
      if (!tgCfg?.enabled || !tgCfg.bot_token_enc) {
        return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Telegram' });
      }

      const { resolveTestChats } = require('./alert-channels');
      let chatIds = await resolveTestChats(pool, req.body?.telegram_chat_ids);
      if (chatIds && !chatIds.length) {
        return res.status(400).json({ error: 'แชทที่เลือกใช้ไม่ได้ (ไม่รู้จัก หรือถูกปิดอยู่)' });
      }
      if (!chatIds) {
        // ว่าง = แชทที่ตั้งไว้ของช่องทางนี้ — ต้องเช็คว่าอย่างน้อยหนึ่งแชทยังมีอยู่จริง
        // และเปิดอยู่ ไม่ใช่แค่ rule.telegram_chat_ids ไม่ว่าง (แชทนั้นอาจถูกลบ/ปิดไปแล้ว
        // ซึ่งจะทำให้ตอบ 200 "สำเร็จ" ทั้งที่ไม่ได้ส่งไปหาใครเลย)
        chatIds = await resolveTestChats(pool, rule.telegram_chat_ids);
        if (!chatIds || !chatIds.length) {
          return res.status(400).json({ error: 'ช่องทางนี้ยังไม่ได้เลือกแชท Telegram' });
        }
      }

      const out = await require('../alert-engine').sendTestForRule(
        pool, rule, id, extra,
        { manualBy: req.user?.username || 'ไม่ทราบชื่อ',
          manualChannel: 'telegram', telegramChatIds: chatIds });
      // ไม่ได้ส่งถึงใครเลย = ตอบ error (เดิมตอบ 200 หน้าจอขึ้น "ส่งแล้ว" — 2026-09-25)
      if (!out?.sent) return res.status(502).json({ error: out?.error || 'ส่งไม่สำเร็จ', channel, event_id: id, ...out });
      res.json({ ok: true, channel, event_id: id, ...out });
    } catch (err) { routeError(res, err, 'POST /api/face-matches/:id/notify-telegram'); }
  });

  // ============================================================
  // Face Recognition matches — paginated, filterable by person name,
  // list type, camera, and date range. Separate from FaceCapture
  // (stranger analytics) — these are watchlist matches from FDLib.
  // ============================================================
  app.get('/api/face-matches', async (req, res) => {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit,  10) || 60));
    const offset = Math.max(0,                parseInt(req.query.offset, 10) || 0);
    // 🔴 COUNT(*) OVER() ในตัว query หลักคือเหตุที่ endpoint นี้ timeout — window function
    //    บังคับให้ประเมิน SELECT list ทั้งหมด (รวม correlated subquery ref_photo ที่ยิง
    //    face_blacklist/source_records ต่อแถว) ครบทุกแถวที่ตรงเงื่อนไข "ก่อน" จะ LIMIT
    //    วัดจริง 2026-08-21 บน recog 93,063 แถว:
    //      ?limit=60                  120 วินาที (ชน statement_timeout ของ pool)
    //      ?limit=60&with_total=0       0.097 วินาที
    //    ⇒ แยกการนับออกมาเป็น query ของตัวเอง — ไม่มี subquery ไม่มีคอลัมน์หนัก
    //      วัดแล้ว SELECT count(*) ล้วน = 60ms
    //
    // ⚠️ hits_only / misses_only การนับยังแพงอยู่ (8.5 วินาที) เพราะต้องอ่าน heap
    //    มาเช็ค listType/similarity ที่อยู่ใน jsonb ⇒ ตั้ง statement_timeout สั้น ๆ
    //    เฉพาะ query นับ ถ้าไม่ทันก็ไม่ส่ง header ไป — หน้าจอ fallback เป็นจำนวนแถว
    //    ที่ได้จริง (parseInt(header || list.length)) ดีกว่าค้างทั้งหน้า
    const wantTotal = req.query.with_total !== '0';
    // เพดาน 500ms — วัดจริง 2026-08-22: ?misses_only=1 ข้อมูลมาใน 38ms แต่การนับ
    // 91,828 แถวกิน 7.75 วินาที = 99.5% ของ request ทั้งก้อน เพื่อได้ตัวเลขที่ไม่มี
    // ใครใช้ตัดสินใจและเปลี่ยนทุกวินาทีอยู่แล้ว · เคสที่นับเร็ว (blackList 1,520 แถว)
    // ยังได้ยอดจริงและหน้ากระโดดได้เหมือนเดิม เพราะนับทันในเพดานนี้
    const COUNT_TIMEOUT_MS = env.int('FACE_MATCH_COUNT_TIMEOUT_MS');
    try {
      const min = await _faceSimMin(pool);   // FP6 threshold; below-min recognitions become "miss"
      const clauses = [`event_type IN (${RECOG_TYPES_SQL})`];
      const params  = [];
      let n = 0;
      if (req.query.person)    { clauses.push(`${_personName('raw_json')} ILIKE $${++n}`); params.push(`%${req.query.person}%`); }
      if (req.query.list_type)   { clauses.push(`${_listType('raw_json')} = $${++n} AND ${_passMin('raw_json', min)}`); params.push(req.query.list_type); }
      if (req.query.fd_lib_name) { clauses.push(`${_fdLibName('raw_json')} = $${++n}`);      params.push(req.query.fd_lib_name); }
      if (req.query.hits_only === '1')   { clauses.push(`${_listType('raw_json')} IS NOT NULL AND ${_passMin('raw_json', min)}`); }
      if (req.query.misses_only === '1') { clauses.push(`(${_listType('raw_json')} IS NULL OR ${_belowMin('raw_json', min)})`); }
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
               ${_personName('raw_json')}              AS person_name,
               CASE WHEN ${_belowMin('raw_json', min)} THEN NULL ELSE ${_listType('raw_json')} END AS list_type,
               ${_fdLibName('raw_json')}               AS fd_lib_name,
               (raw_json->>'similarity')::float      AS similarity,
               raw_json->>'humanId'                  AS human_id,
               COALESCE(snapshot_filename, raw_json->>'_snapshot')
                                                     AS snapshot,
               raw_json->>'_snapshot_full'           AS snapshot_full,
               raw_json->>'_snapshot_ref'            AS snapshot_ref,
               -- HCP blacklist matches have no _snapshot_ref; resolve the enrolled
               -- reference photo from OUR blacklist library: enrolled_ref points to
               -- blacklist.source_records.id (NOT face_embeddings — id spaces overlap),
               -- whose photo_path is served by /api/blacklist/photo. Match by
               -- hcp_person_id first, name as fallback.
               -- face_blacklist is a MANUAL, partial mirror (enroll_face_blacklist_from_hcp.js
               -- run per-batch) — a person can be matched by HCP itself (source='hcp', no
               -- AuraFace embedding needed) yet have no face_blacklist row at all, so the
               -- lookup above finds nothing even though the photo already exists in the
               -- canonical roster. Fall back to source_records directly via the id HCP face
               -- imports always use: external_id = 'face:<group>:<person>' (source_id=14,
               -- data_type='face' — verified 100% of rows follow this shape, 2026-08-18).
               CASE WHEN raw_json->>'source' = 'hcp' AND raw_json->>'_snapshot_ref' IS NULL THEN ${refPhotoScalarSql('e')} END AS ref_photo,
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
               a.acked_at                            AS acked_at
          FROM events e
          LEFT JOIN face_event_acks a ON a.event_id = e.id
         WHERE ${where}
         ORDER BY event_time DESC, id DESC
         LIMIT $${++n} OFFSET $${++n}`;
      // ดึงเกินมา 1 แถว — ใช้บอกว่า "มีหน้าถัดไปไหม" โดยไม่ต้องนับทั้งชุด
      // แล้วตัดทิ้งก่อนส่ง ผู้เรียกจึงได้จำนวนแถวตามที่ขอเป๊ะ
      params.push(limit + 1, offset);
      const r = await pool.query(sql, params);
      const hasMore = r.rows.length > limit;
      if (hasMore) r.rows.length = limit;
      res.set('X-Has-More', hasMore ? '1' : '0');
      if (wantTotal) {
        // นับแยก บน connection ของตัวเอง — where เดียวกันแต่ไม่มี SELECT list ที่หนัก
        // params มี limit/offset ต่อท้ายอยู่ ตัดสองตัวนั้นออกก่อนใช้
        const countParams = params.slice(0, params.length - 2);
        const c = await pool.connect();
        try {
          // ⚠️ SET LOCAL มีผลเฉพาะใน transaction block — นอก block Postgres เตือน
          //    "SET LOCAL can only be used in transaction blocks" แล้วค่าคงเดิม
          //    (ยืนยันด้วย SHOW statement_timeout = 0) ⇒ เพดานที่ตั้งใน cb92b9f
          //    ไม่เคยทำงานเลย · ต้องห่อ BEGIN/COMMIT ถึงจะบังคับได้จริง
          await c.query('BEGIN');
          await c.query(`SET LOCAL statement_timeout = ${COUNT_TIMEOUT_MS}`);
          const cr = await c.query(`SELECT count(*)::int AS n FROM events e WHERE ${where}`, countParams);
          await c.query('COMMIT');
          res.set('X-Total-Count', String(cr.rows[0].n));
        } catch (e) {
          // นับไม่ทัน = ไม่ส่ง header · หน้าจอใช้ pager แบบเลื่อนหน้าแทน ไม่ค้าง
          await c.query('ROLLBACK').catch(() => {});
          console.warn('[face-matches] นับยอดรวมไม่ทันใน', COUNT_TIMEOUT_MS + 'ms —', e.message);
        } finally { c.release(); }
      }
      res.json(r.rows);
    } catch (err) {
      routeError(res, err, 'GET /api/face-matches');
    }
  });

  // distinct FDLib group names — for populating filter dropdown dynamically
  // ponytail: deliberately unscoped — metadata only (group names, not events); same class as inline groups above
  app.get('/api/face-matches/groups', async (req, res) => {
    try {
      res.json(await groupNames());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};
