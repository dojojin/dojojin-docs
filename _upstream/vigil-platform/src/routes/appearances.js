// ============================================================
// Vigil Platform — Routes: Appearances
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const { siteWhere } = require('../auth');

module.exports = function appearancesRoutes(app, pool, { getDisplayTz, getIP }) {

  // appearances/stats materializes the filtered join once (temp table), then
  // runs 13 aggregations off it (see handler below for why). Result cached with
  // 30s TTL keyed by from+to+camera_id — same approach as today-counts (decision #181).
  let _appStatsCache = null, _appStatsCacheAt = 0, _appStatsCacheKey = '';
  const APP_STATS_TTL_MS = 30_000;

  // Shared WHERE builder สำหรับ /api/appearances/search + /timeline (AP.5a)
  // คืน { clause, args } — semantics สี: ดูคอมเมนต์ในฟังก์ชัน (Ph.3 + AP.4)
  function _buildAppearanceFilter(query) {
    const { gender, top, bottom, hair, hair_color, glasses, helmet, bag,
            upper_color, lower_color, expression, age_group, mask, hat,
            camera_id, from, to } = query;
    const where = [], args = [];
    if (gender)          { args.push(gender);      where.push(`a.gender = $${args.length}`); }
    // mask/hat: Hikvision-only fields, always on the raw event (no appearances column)
    if (mask)            { args.push(mask);        where.push(`e.raw_json->>'mask' = $${args.length}`); }
    if (hat)             { args.push(hat);         where.push(`e.raw_json->>'hat' = $${args.length}`); }
    if (top)             { args.push(top);         where.push(`a.top_category = $${args.length}`); }
    // LongTrousers is a Hikvision alias for Trousers — match both when Trousers is selected
    if (bottom === 'Trousers') {
      where.push(`a.bottom_category IN ('Trousers', 'LongTrousers')`);
    } else if (bottom)   { args.push(bottom);      where.push(`a.bottom_category = $${args.length}`); }
    if (hair)            { args.push(hair);        where.push(`a.hair_length = $${args.length}`); }
    if (hair_color)      { args.push(hair_color);  where.push(`a.hair_color = $${args.length}`); }
    if (expression)      { args.push(expression);  where.push(`e.raw_json->>'faceExpression' = $${args.length}`); }
    // middleAged is a Hikvision alias for middle — match both
    if (age_group === 'middle') {
      where.push(`COALESCE(a.age_group, e.raw_json->>'ageGroup') IN ('middle', 'middleAged')`);
    } else if (age_group) { args.push(age_group);  where.push(`COALESCE(a.age_group, e.raw_json->>'ageGroup') = $${args.length}`); }
    // สี: garment color (กล้อง Pro) หรือ color cluster ของแถว low-fidelity
    // (migration 041/042). upper/lower ไม่ cross กันสำหรับแถว Pro:
    //   - แถว Pro (AP.4): clusters ติดป้าย part 'top'/'bottom' → containment
    //     แบบระบุ part = ค้นเจอทุกสีของชิ้นนั้น (เสื้อลาย) โดยไม่ปนชิ้นอื่น
    //   - แถว low-fidelity (ไม่มี upper_color): clusters ไม่มี part → containment
    //     แบบไม่ระบุ part, gate ด้วย upper/lower IS NULL กันไม่ให้แถว Pro หลุดเข้า
    const clusterPart = (n, part) =>
      `a.color_clusters @> jsonb_build_array(jsonb_build_object('name', $${n}::text, 'part', '${part}'))`;
    const clusterAny = (n) =>
      `a.color_clusters @> jsonb_build_array(jsonb_build_object('name', $${n}::text))`;
    if (upper_color) {
      args.push(upper_color);
      const n = args.length;
      where.push(`(a.upper_color = $${n} OR ${clusterPart(n, 'top')}
        OR (a.upper_color IS NULL AND (a.overall_color = $${n} OR ${clusterAny(n)})))`);
    }
    if (lower_color) {
      args.push(lower_color);
      const n = args.length;
      where.push(`(a.lower_color = $${n} OR ${clusterPart(n, 'bottom')}
        OR (a.lower_color IS NULL AND (a.overall_color = $${n} OR ${clusterAny(n)})))`);
    }
    // glasses: 3-way via raw_json (yes/sunglasses/no); true/false = boolean fallback
    if      (glasses === 'yes')        where.push(`e.raw_json->>'glass' = 'yes'`);
    else if (glasses === 'sunglasses') where.push(`e.raw_json->>'glass' = 'sunglasses'`);
    else if (glasses === 'no')         where.push(`e.raw_json->>'glass' = 'no'`);
    else if (glasses === 'true')       where.push('a.glasses = TRUE');
    else if (glasses === 'false')      where.push('a.glasses = FALSE');
    if (helmet === 'true')  where.push('a.helmet_wear = TRUE');
    if (helmet === 'false') where.push('a.helmet_wear = FALSE');
    if (bag === 'has')      where.push('a.bag_category IS NOT NULL');
    else if (bag)         { args.push(bag); where.push(`a.bag_category = $${args.length}`); }
    if (camera_id) { args.push(camera_id); where.push(`a.camera_id = $${args.length}`); }
    if (query.cameras) {
      const a = String(query.cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (a.length) { args.push(a); where.push(`a.camera_id = ANY($${args.length})`); }
    }
    if (from)      { args.push(from);      where.push(`e.event_time >= $${args.length}`); }
    if (to)        { args.push(to);        where.push(`e.event_time <= $${args.length}`); }
    // min_confidence (045): ตัด ghost detection ออกจากผลค้น — แถวที่ไม่มีค่า
    // confidence ผ่านเสมอ (อย่าซ่อนข้อมูลที่แค่ไม่ได้วัด)
    const minConf = parseFloat(query.min_confidence);
    if (Number.isFinite(minConf) && minConf > 0) {
      args.push(minConf);
      where.push(`(a.confidence IS NULL OR a.confidence >= $${args.length})`);
    }
    // Dahua twin suppression (2026-07-15, "ภาพเบิ้ล" report — same fix as
    // routes/faces.js _buildFaceFilter, see the full rationale there): a
    // Dahua NVR fires FaceDetector/Recognized + FaceDetector/Comparison
    // from the SAME camera for the same person, and BOTH twins insert an
    // appearances row, doubling every person on this page. Hide the
    // Recognized twin's appearance when the Comparison sibling also has one
    // (the Comparison row carries the NVR-stored face crop). Twins matched
    // by the NVR's own ObjectID (identical across each pair) — see faces.js
    // for why time-only matching is not enough. Both rows stay in the DB —
    // display-time filter only; Hikvision/Bosch rows never match.
    where.push(`NOT (e.event_type = 'FaceDetector/Recognized' AND EXISTS (
      SELECT 1 FROM events e2 JOIN appearances a2 ON a2.event_id = e2.id
       WHERE e2.camera_id = e.camera_id
         AND e2.event_type = 'FaceDetector/Comparison'
         AND e2.raw_json->'data'->'Face'->>'ObjectID' = e.raw_json->'data'->'Object'->>'ObjectID'
         AND e2.event_time BETWEEN e.event_time - INTERVAL '60 seconds'
                               AND e.event_time + INTERVAL '60 seconds'))`);
    return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
  }

  // group การพบเห็นติดกัน (กล้องเดิม ห่าง ≤180s) เป็น segment — ใช้ร่วมระหว่าง
  // /timeline (AP.5a) กับ /similar-timeline (AP.5b). rows ต้องเรียงเวลา ASC
  function _groupTimelineSegments(rows) {
    const GAP_MS = 180 * 1000;
    const segments = [];
    for (const r of rows) {
      const t = new Date(r.event_time).getTime();
      const last = segments[segments.length - 1];
      if (last && last.camera_id === r.camera_id && t - last._lastMs <= GAP_MS) {
        last.end_time = r.event_time;
        last._lastMs = t;
        last.count++;
        if (!last.first_row.snapshot_file && r.snapshot_file) last.first_row = r;
        if (r._score != null && (last.best_score == null || r._score > last.best_score)) last.best_score = r._score;
      } else {
        segments.push({
          camera_id: r.camera_id,
          camera_name: r.camera_name || r.camera_id,
          location: r.location || null,
          start_time: r.event_time, end_time: r.event_time,
          count: 1, _lastMs: t, first_row: r,
          best_score: r._score != null ? r._score : null,
        });
      }
    }
    return segments.map(({ _lastMs, ...s }) => s);
  }

  // ── AP.5b — attribute similarity ("ตามคนนี้") ─────────────────
  // คะแนนจากชุด attribute ที่ "anchor มีจริง" เท่านั้น (weight pool แปรตาม
  // ข้อมูลที่มี) → similarity = earned/possible (0..1). น้ำหนัก: สีเสื้อบน/ล่าง
  // หนักสุด · เพศต่ำสุด (GOTCHAS #87 — Hik อคติ female) · ไม่ใช่การระบุตัวตน
  function _appColorSets(row) {
    const top = new Set(), bottom = new Set(), any = new Set();
    if (row.upper_color) top.add(row.upper_color);
    if (row.lower_color) bottom.add(row.lower_color);
    if (row.overall_color) any.add(row.overall_color);
    let clusters = row.color_clusters;
    if (typeof clusters === 'string') { try { clusters = JSON.parse(clusters); } catch { clusters = null; } }
    for (const c of (Array.isArray(clusters) ? clusters : [])) {
      if (!c?.name) continue;
      if (c.part === 'top') top.add(c.name);
      else if (c.part === 'bottom') bottom.add(c.name);
      else any.add(c.name);
    }
    return { top, bottom, any };
  }

  function _appSimilarity(anchor, cand) {
    const A = _appColorSets(anchor), C = _appColorSets(cand);
    const overlap = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
    let possible = 0, earned = 0;
    const matched = [];

    // หลักคิด: "ไม่ตรง" = ได้ 0 จาก pool แต่ "เทียบไม่ได้" (candidate ไม่มี
    // ข้อมูลด้านนั้นเลย) = ตัดออกจาก pool — มิฉะนั้นแถว low-fi (3100i โทนสี
    // อย่างเดียว) จะไม่มีวันถึง threshold แม้โทนตรงเป๊ะ (cross-fidelity)
    // สีท่อนบน (weight 3): candidate มี top → เทียบตรง; มีแต่โทนรวม →
    // เทียบกับโทน (เครดิต 2/3); ไม่มีสีเลย → ตัดออกจาก pool
    if (A.top.size) {
      if (C.top.size) {
        possible += 3;
        if (overlap(A.top, C.top)) { earned += 3; matched.push('top_color'); }
      } else if (C.any.size) {
        possible += 3;
        if (overlap(A.top, C.any)) { earned += 2; matched.push('top_color~tone'); }
      }
    }
    if (A.bottom.size) {
      if (C.bottom.size) {
        possible += 3;
        if (overlap(A.bottom, C.bottom)) { earned += 3; matched.push('bottom_color'); }
      } else if (C.any.size) {
        possible += 3;
        if (overlap(A.bottom, C.any)) { earned += 2; matched.push('bottom_color~tone'); }
      }
    }
    // anchor เป็น low-fi (มีแต่โทนรวม) → เทียบโทนกับทุกสีของ candidate
    if (!A.top.size && !A.bottom.size && A.any.size) {
      const candAll = new Set([...C.top, ...C.bottom, ...C.any]);
      if (candAll.size) {
        possible += 4;
        if (overlap(A.any, candAll)) { earned += 4; matched.push('tone'); }
      }
    }
    if (anchor.top_category && cand.top_category) {
      possible += 1;
      if (cand.top_category === anchor.top_category) { earned += 1; matched.push('top_category'); }
    }
    if (anchor.bottom_category && cand.bottom_category) {
      possible += 1;
      if (cand.bottom_category === anchor.bottom_category) { earned += 1; matched.push('bottom_category'); }
    }
    if (anchor.glasses === true && cand.glasses != null) {
      possible += 1;
      if (cand.glasses === true) { earned += 1; matched.push('glasses'); }
    }
    // เพศ — weight ต่ำสุดตาม #87 และไม่หักลบเมื่อไม่ตรง (อคติ classifier)
    if (anchor.gender && cand.gender) {
      possible += 0.5;
      if (cand.gender === anchor.gender) { earned += 0.5; matched.push('gender'); }
    }
    return { score: possible > 0 ? earned / possible : 0, matched, possible };
  }

  // GET /api/appearances/stats?from=ISO&to=ISO[&camera_id=]
  // Returns aggregated appearance data for the stats panel.
  // One endpoint, not six — mirrors /api/stats/categories pattern.
  app.get('/api/appearances/stats', async (req, res) => {
    try {
      const { from, to, camera_id, site_id } = req.query;
      const _allowedStr = req.user?.isSiteScoped ? (req.user.allowedSites || []).join(',') : '';
      const _cacheKey = `${from||''}|${to||''}|${camera_id||''}|${site_id||''}|${_allowedStr}`;
      const _now = Date.now();
      if (_appStatsCache && _appStatsCacheKey === _cacheKey && _now - _appStatsCacheAt < APP_STATS_TTL_MS) {
        return res.json(_appStatsCache);
      }

      const tz = await getDisplayTz();
      const where = ['TRUE'], args = [];
      if (camera_id) { args.push(camera_id); where.push(`a.camera_id = $${args.length}`); }
      if (from)      { args.push(from);      where.push(`e.event_time >= $${args.length}`); }
      if (to)        { args.push(to);        where.push(`e.event_time <= $${args.length}`); }
      if (site_id)   { args.push(parseInt(site_id)); where.push(`e.camera_id IN (SELECT id FROM cameras WHERE site_id = $${args.length})`); }
      const swA = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', args.length + 1);
      if (swA.sql) { where.push(swA.sql.replace(/^AND /, '')); args.push(...swA.args); }
      const clause = 'WHERE ' + where.join(' AND ');

      const fromMs = from ? Date.parse(from) : NaN;
      const toMs = to ? Date.parse(to) : Date.now();
      const spanDays = Number.isFinite(fromMs) && Number.isFinite(toMs)
        ? Math.max(0, (toMs - fromMs) / 86400_000)
        : Infinity;
      const peakMode = spanDays <= 2 ? 'hour' : spanDays <= 14 ? 'dow' : 'day';
      const peakExpr = peakMode === 'hour'
        ? `EXTRACT(hour FROM event_time AT TIME ZONE $1)::int`
        : peakMode === 'dow'
          ? `EXTRACT(isodow FROM event_time AT TIME ZONE $1)::int`
          : `EXTRACT(day FROM event_time AT TIME ZONE $1)::int`;

      // Perf: the 13 aggregations below used to each independently
      // JOIN appearances↔events and re-apply `clause` — i.e. 13x the same
      // ~1M-row events scan. Measured ~11-12s for a 7-day window. Materializing
      // the filtered join ONCE into a temp table first (then aggregating off
      // that small, already-filtered set) measured <1s for the same window —
      // verified via EXPLAIN ANALYZE before landing this change.
      const client = await pool.connect();
      let genderR, topR, botR, colorR, hairColorR, hairLenR, accessR, volumeR, ageR, exprR, dirR, peakR, cameraR;
      try {
        await client.query('BEGIN');
        await client.query(`CREATE TEMP TABLE _app_stats_filtered ON COMMIT DROP AS
          SELECT a.gender, a.top_category, a.bottom_category, a.upper_color, a.lower_color,
                 a.hair_color, a.hair_length, a.bag_category, a.glasses, a.helmet_wear,
                 a.age_group, a.attributes, a.camera_id, e.raw_json, e.event_time
          FROM appearances a JOIN events e ON e.id = a.event_id ${clause}`, args);

        [genderR, topR, botR, colorR, hairColorR, hairLenR, accessR, volumeR, ageR, exprR, dirR, peakR, cameraR] = await Promise.all([
          client.query(`SELECT gender, count(*)::int AS n
            FROM _app_stats_filtered WHERE gender IS NOT NULL GROUP BY gender ORDER BY n DESC`),
          client.query(`SELECT top_category, count(*)::int AS n
            FROM _app_stats_filtered WHERE top_category IS NOT NULL
            GROUP BY top_category ORDER BY n DESC LIMIT 8`),
          client.query(`SELECT bottom_category, count(*)::int AS n
            FROM _app_stats_filtered WHERE bottom_category IS NOT NULL
            GROUP BY bottom_category ORDER BY n DESC LIMIT 8`),
          client.query(`SELECT upper_color, lower_color, count(*)::int AS n
            FROM _app_stats_filtered WHERE (upper_color IS NOT NULL OR lower_color IS NOT NULL)
            GROUP BY upper_color, lower_color ORDER BY n DESC LIMIT 50`),
          client.query(`SELECT hair_color, count(*)::int AS n
            FROM _app_stats_filtered WHERE hair_color IS NOT NULL
            GROUP BY hair_color ORDER BY n DESC`),
          client.query(`SELECT hair_length, count(*)::int AS n
            FROM _app_stats_filtered WHERE hair_length IS NOT NULL
            GROUP BY hair_length ORDER BY n DESC`),
          client.query(`SELECT
              count(*)::int AS total,
              count(*) FILTER (WHERE bag_category IS NOT NULL)::int AS bag_count,
              count(*) FILTER (WHERE bag_category = 'Backpack')::int AS backpack_count,
              count(*) FILTER (WHERE bag_category = 'ShoulderBag')::int AS shoulder_count,
              count(*) FILTER (WHERE glasses = true)::int AS glasses_count,
              count(*) FILTER (WHERE helmet_wear = true)::int AS helmet_count,
              count(*) FILTER (WHERE raw_json->>'mask' = 'yes')::int AS mask_count,
              count(*) FILTER (WHERE raw_json->>'hat' = 'yes')::int AS hat_count
            FROM _app_stats_filtered`),
          client.query(`SELECT
              (DATE_TRUNC('day', event_time AT TIME ZONE $1) AT TIME ZONE $1) AS day,
              count(*)::int AS n
            FROM _app_stats_filtered
            GROUP BY 1 ORDER BY 1`, [tz]),
          client.query(`SELECT COALESCE(age_group, raw_json->>'ageGroup') AS age_group, count(*)::int AS n
            FROM _app_stats_filtered WHERE COALESCE(age_group, raw_json->>'ageGroup') IS NOT NULL
            GROUP BY 1 ORDER BY n DESC`),
          client.query(`SELECT raw_json->>'faceExpression' AS expression, count(*)::int AS n
            FROM _app_stats_filtered WHERE raw_json->>'faceExpression' IS NOT NULL
            GROUP BY 1 ORDER BY n DESC`),
          client.query(`SELECT attributes->>'direction' AS direction, count(*)::int AS n
            FROM _app_stats_filtered WHERE attributes->>'direction' IS NOT NULL
            GROUP BY 1 ORDER BY n DESC`),
          client.query(`SELECT ${peakExpr} AS bucket, count(*)::int AS n
            FROM _app_stats_filtered
            GROUP BY 1 ORDER BY 1`, [tz]),
          client.query(`SELECT f.camera_id,
                   COALESCE(NULLIF(c.name, ''), f.camera_id) AS camera_name,
                   count(*)::int AS n
            FROM _app_stats_filtered f
            LEFT JOIN cameras c ON c.id = f.camera_id
            GROUP BY f.camera_id, c.name
            ORDER BY n DESC, f.camera_id
            LIMIT 12`),
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      // Aggregate upper_color + lower_color distributions from color results
      const upperMap = {}, lowerMap = {};
      for (const r of colorR.rows) {
        if (r.upper_color) upperMap[r.upper_color] = (upperMap[r.upper_color] || 0) + r.n;
        if (r.lower_color) lowerMap[r.lower_color] = (lowerMap[r.lower_color] || 0) + r.n;
      }
      const sortDesc = m => Object.entries(m).sort((a, b) => b[1] - a[1]);

      const gender = Object.fromEntries(genderR.rows.map(r => [r.gender, r.n]));
      const total = accessR.rows[0]?.total || 0;
      const topCamera = cameraR.rows[0] || null;
      const result = {
        kpi: {
          total,
          top_camera: topCamera,
          male: gender.Male || 0,
          female: gender.Female || 0,
          gender_known: (gender.Male || 0) + (gender.Female || 0),
        },
        peak: {
          mode: peakMode,
          points: peakR.rows.map(r => ({ bucket: r.bucket, n: r.n })),
        },
        by_camera: cameraR.rows,
        gender,
        top_cat:     Object.fromEntries(topR.rows.map(r => [r.top_category, r.n])),
        bottom_cat:  Object.fromEntries(botR.rows.map(r => [r.bottom_category, r.n])),
        upper_color: sortDesc(upperMap),
        lower_color: sortDesc(lowerMap),
        hair_color:  sortDesc(Object.fromEntries(hairColorR.rows.map(r => [r.hair_color, r.n]))),
        hair_length: Object.fromEntries(hairLenR.rows.map(r => [r.hair_length, r.n])),
        accessories: accessR.rows[0] || {},
        volume:      volumeR.rows.map(r => ({ day: r.day, n: r.n })),
        age_group:   Object.fromEntries(ageR.rows.map(r => [r.age_group, r.n])),
        expression:  Object.fromEntries(exprR.rows.map(r => [r.expression, r.n])),
        direction:   Object.fromEntries(dirR.rows.map(r => [r.direction, r.n])),
      };
      _appStatsCache = result;
      _appStatsCacheAt = Date.now();
      _appStatsCacheKey = _cacheKey;
      res.json(result);
    } catch (err) { routeError(res, err, 'GET /api/appearances/stats'); }
  });

  // GET /api/appearances/search — forensic search by appearance attributes
  // Query: gender, top, bottom, hair, glasses, helmet, camera_id, from, to, limit, offset
  // Returns event-centric rows (e.*) so result cards can call showSnapshot(ev) directly.
  // SELECT e.* to avoid column-name collisions: a.id/camera_id/object_class shadow e.*
  app.get('/api/appearances/search', async (req, res) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      let { clause, args } = _buildAppearanceFilter(req.query);
      const swSrch = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', args.length + 1);
      if (swSrch.sql) {
        clause = clause ? `${clause} ${swSrch.sql}` : `WHERE ${swSrch.sql.replace(/^AND /, '')}`;
        args.push(...swSrch.args);
      }
      const lim = Math.min(parseInt(limit) || 50, 200);
      const off = parseInt(offset) || 0;
      args.push(lim, off);
      const { rows } = await pool.query(
        `SELECT e.*,
                COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot_file,
                e.raw_json->>'_snapshot_source'                         AS snapshot_source,
                a.gender, a.hair_length, a.hair_color, a.hair_color_xyz,
                a.top_category, a.upper_color, a.top_color_xyz,
                a.bottom_category, a.lower_color, a.bottom_color_xyz,
                a.glasses, a.bag_category,
                a.helmet_wear, a.helmet_subtype,
                a.overall_color, a.overall_color_xyz, a.color_clusters,
                COALESCE(a.age_group, e.raw_json->>'ageGroup') AS age_group, a.confidence, a.attributes,
                e.raw_json->>'faceExpression' AS expression,
                e.raw_json->>'mask' AS mask,
                e.raw_json->>'hat'  AS hat,
                a.attributes->>'direction' AS direction,
                COUNT(*) OVER()::int AS _total
         FROM appearances a JOIN events e ON e.id = a.event_id
         ${clause}
         ORDER BY e.event_time DESC, e.id DESC
         LIMIT $${args.length - 1} OFFSET $${args.length}`,
        args
      );
      res.set('X-Total-Count', rows[0]?._total || 0);
      res.json(rows.map(({ _total, ...r }) => r));
    } catch (err) { routeError(res, err, 'GET /api/appearances/search'); }
  });

  // GET /api/appearances/timeline — AP.5a forensic timeline (2026-06-12)
  // filter ชุดเดียวกับ /search แต่เรียงเวลา ASC แล้ว group การพบเห็นติดกัน
  // (กล้องเดิม, ห่าง ≤180s) เป็น segment: "อยู่หน้ากล้อง X ช่วง HH:MM–HH:MM (N ครั้ง)"
  // ⚠️ attribute matching ไม่ใช่การระบุตัวตน — UI ติด disclaimer.
  // PDPA: การไล่รอยบุคคลย้อนหลัง → จำกัด admin/auditor + ลง audit_log ทุกครั้ง
  app.get('/api/appearances/timeline', async (req, res) => {
    try {
      if (!req.internal && !['admin', 'auditor'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'admin/auditor role required', code: 'ROLE_REQUIRED' });
      }
      const { clause, args } = _buildAppearanceFilter(req.query);
      args.push(2000);   // hard cap กัน query ระเบิดเมื่อ filter กว้าง
      const { rows } = await pool.query(
        `SELECT e.id, e.camera_id, e.event_time, e.event_type, e.rule_name,
                COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot_file,
                e.raw_json->>'_snapshot_full' AS snapshot_full,
                a.gender, a.top_category, a.bottom_category, a.glasses,
                a.upper_color, a.lower_color, a.overall_color, a.color_clusters,
                c.name AS camera_name, c.location_label AS location
         FROM appearances a
         JOIN events e ON e.id = a.event_id
         LEFT JOIN cameras c ON c.id = e.camera_id
         ${clause}
         ORDER BY e.event_time ASC
         LIMIT $${args.length}`, args);

      const segments = _groupTimelineSegments(rows);
      // PDPA audit trail — ใครไล่ timeline ด้วยเงื่อนไขอะไรเมื่อไหร่
      pool.query(
        `INSERT INTO audit_log (user_id, username, action, details, ip_address)
         VALUES ($1,$2,'forensic_timeline',$3,$4)`,
        [req.user?.id || null, req.user?.username || 'internal',
         JSON.stringify(req.query), getIP(req)]
      ).catch(() => {});
      res.json({
        segments,
        total_rows: rows.length,
        truncated: rows.length >= 2000,
      });
    } catch (err) { routeError(res, err, 'GET /api/appearances/timeline'); }
  });

  // GET /api/appearances/similar-timeline?event_id=N[&window_hours=24][&threshold=0.6]
  // "ตามคนนี้" — จาก appearance ของ event หนึ่ง หาแถวที่ลักษณะคล้ายใน
  // หน้าต่างเวลารอบ event แล้วเรียงเป็น timeline. PDPA gate เดียวกับ /timeline
  app.get('/api/appearances/similar-timeline', async (req, res) => {
    try {
      if (!req.internal && !['admin', 'auditor'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'admin/auditor role required', code: 'ROLE_REQUIRED' });
      }
      const eventId = parseInt(req.query.event_id, 10);
      if (!Number.isFinite(eventId)) return res.status(400).json({ error: 'event_id required' });
      const windowH = Math.min(Math.max(parseFloat(req.query.window_hours) || 24, 1), 168);
      const threshold = Math.min(Math.max(parseFloat(req.query.threshold) || 0.6, 0.1), 1);

      const { rows: anchorRows } = await pool.query(
        `SELECT a.*, e.event_time FROM appearances a JOIN events e ON e.id = a.event_id
         WHERE a.event_id = $1 LIMIT 1`, [eventId]);
      const anchor = anchorRows[0];
      if (!anchor) return res.status(404).json({ error: 'no appearance record for this event' });

      const t0 = new Date(anchor.event_time);
      const from = new Date(t0.getTime() - windowH * 3600 * 1000).toISOString();
      const to   = new Date(t0.getTime() + windowH * 3600 * 1000).toISOString();
      const { rows } = await pool.query(
        `SELECT e.id, e.camera_id, e.event_time, e.event_type, e.rule_name,
                COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot_file,
                a.gender, a.top_category, a.bottom_category, a.glasses,
                a.upper_color, a.lower_color, a.overall_color, a.color_clusters,
                a.confidence,
                c.name AS camera_name, c.location_label AS location
         FROM appearances a
         JOIN events e ON e.id = a.event_id
         LEFT JOIN cameras c ON c.id = e.camera_id
         WHERE e.event_time BETWEEN $1 AND $2
         ORDER BY e.event_time ASC
         LIMIT 5000`, [from, to]);

      const matchedRows = [];
      for (const r of rows) {
        const { score, matched } = _appSimilarity(anchor, r);
        if (r.id === String(eventId) || Number(r.id) === eventId || score >= threshold) {
          r._score = Math.round(score * 100) / 100;
          r._matched = matched;
          matchedRows.push(r);
        }
      }
      const segments = _groupTimelineSegments(matchedRows);

      pool.query(
        `INSERT INTO audit_log (user_id, username, action, details, ip_address)
         VALUES ($1,$2,'forensic_follow',$3,$4)`,
        [req.user?.id || null, req.user?.username || 'internal',
         JSON.stringify({ event_id: eventId, window_hours: windowH, threshold }), getIP(req)]
      ).catch(() => {});
      res.json({
        anchor: {
          event_id: eventId, event_time: anchor.event_time, camera_id: anchor.camera_id,
          gender: anchor.gender, upper_color: anchor.upper_color, lower_color: anchor.lower_color,
          overall_color: anchor.overall_color, glasses: anchor.glasses,
        },
        threshold, window_hours: windowH,
        segments,
        total_matches: matchedRows.length,
        truncated: rows.length >= 5000,
      });
    } catch (err) { routeError(res, err, 'GET /api/appearances/similar-timeline'); }
  });

};
