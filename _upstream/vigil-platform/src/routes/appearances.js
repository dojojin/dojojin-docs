// ============================================================
// Vigil Platform — Routes: Appearances
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const { siteWhere } = require('../auth');
const { createTtlCache } = require('../helpers/ttlCache');
const { scrubRawJson } = require('../helpers/scrubRawJson');

module.exports = function appearancesRoutes(app, pool, { getDisplayTz, getIP }) {

  // appearances/stats materializes the filtered join once (temp table), then
  // runs 13 aggregations off it (see handler below for why). Result cached with
  // 30s TTL keyed by from+to+camera_id — same approach as today-counts (decision #181).
  // เดิมเป็นช่องเดียว (คีย์ใหม่ = ทับของเก่าทันที) · ตอนนี้ 8 ช่อง = สลับตัวกรอง
  // ไปกลับแล้วยังได้ของเดิมคืน ไม่ต้องคำนวณใหม่ทุกครั้งที่กดสลับ
  const _appStatsCache = createTtlCache({ name: 'appearances:stats', ttlMs: 30_000, max: 8 });

  // Shared WHERE builder สำหรับ /api/appearances/search + /timeline (AP.5a)
  // คืน { clause, args } — semantics สี: ดูคอมเมนต์ในฟังก์ชัน (Ph.3 + AP.4)
  // Broad-search count ceiling — see the note at the count query below.
  const APP_COUNT_CAP = parseInt(process.env.APP_COUNT_CAP || '10000', 10);

  function _buildAppearanceFilter(query) {
    const { gender, top, bottom, hair, hair_color, glasses, helmet, bag,
            upper_color, lower_color, expression, age_group, mask, hat,
            camera_id, from, to, object_class } = query;
    const where = [], args = [];
    // The camera tracks everything that moves, so this table is people AND
    // vehicles — 545 Person against 12,795 rows on BH5100i_RMUTR-V_01 over a
    // day. Without this filter the page called all of them people and the
    // results were mostly cars (reported 2026-08-20). Indexed by
    // idx_appearances_class.
    if (object_class)    { args.push(object_class); where.push(`a.object_class = $${args.length}`); }
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

  // ── /api/appearances/stats จากตารางสรุป appearance_dim_hourly (migration 282 · 2026-10-27 · เจ้าของอนุมัติ) ──
  // เดิม 7 วันทุกไซต์อ่าน appearances 1.37 ล้านแถวทุกครั้ง 3.9 วิ (cache อุ่น) · 30 วัน 16 วิ — ดูหัว migration 282
  // ชั่วโมงเต็ม [a, b) อ่านจากตารางสรุป · ชั่วโมงหัว [from, a) และท้าย [b, to] อ่านจากข้อมูลดิบด้วย SELECT เดียวกับตัวเติม
  // (appearance-rollup-refresher.selectSql) ⇒ ตัวเลขเท่าทางเดิม · b ไม่เกินชั่วโมงที่รอบ refresh สำเร็จล่าสุดครอบแล้ว
  // คืน null = ใช้ทางเดิม: refresher ยังไม่เคยสำเร็จหลังบูต · ตารางสรุปยังไม่ครอบ from · ช่วงไม่ถึงหนึ่งชั่วโมงเต็ม
  // ⚠️ ข้อมูลที่มาถึงช้าเกิน 3 ชม. (APP_ROLLUP_LOOKBACK_HOURS) จะยังไม่อยู่ในตารางสรุปจนรอบเก็บตก 05:00 — แบบเดียวกับตารางสรุปตัวอื่น
  const HOUR_MS = 3600_000;
  let _rollupStart = { at: 0, v: null };
  async function _rollupCoverageStart() {
    if (Date.now() - _rollupStart.at < 600_000) return _rollupStart.v;
    const { rows } = await pool.query('SELECT min(bucket_hour) AS m FROM appearance_dim_hourly');
    _rollupStart = { at: Date.now(), v: rows[0]?.m ? new Date(rows[0].m).getTime() : null };
    return _rollupStart.v;
  }
  async function _statsFromRollup({ from, to, camera_id, site_id, object_class, scope, tz, peakExpr }) {
    const job = require('../jobs/rollups').status().find((j) => j.name === 'app-rollup');
    if (!job || !job.last_success) return null;
    const fMs = Date.parse(from), tMs = to ? Date.parse(to) : Date.now();
    const a = Math.ceil(fMs / HOUR_MS) * HOUR_MS;
    // เว้นชั่วโมงเต็มล่าสุดให้อ่านจากข้อมูลดิบด้วย: ข้อมูลที่มาถึงช้าหลังรอบ refresh ล่าสุด (เจอจริงตอนเทียบ: ช่วงจบที่
    // "ตอนนี้" ขาด 3 แถว) จะยังนับครบ · เหลือต่างได้เฉพาะของที่มาช้าเกิน ~1 ชม. ระหว่างรอบ refresh (≤ 5 นาที)
    const fresh = Math.floor((new Date(job.last_success).getTime() - 60_000) / HOUR_MS) * HOUR_MS - HOUR_MS;
    const b = Math.min(Math.floor(tMs / HOUR_MS) * HOUR_MS, fresh);
    if (!(a < b)) return null;
    const start = await _rollupCoverageStart();
    if (start == null || a < start) return null;

    const args = [];
    const p = (v) => { args.push(v); return `$${args.length}`; };
    const tzP = p(tz), aP = p(new Date(a).toISOString()), bP = p(new Date(b).toISOString()), fromP = p(from);
    const toP = to ? p(to) : null;
    const camP = camera_id ? p(camera_id) : null;
    const ocP = object_class ? p(object_class) : null;
    const siteP = site_id ? p(parseInt(site_id)) : null;
    const sw = siteWhere(scope, '__CAM__', args.length + 1);
    args.push(...sw.args);
    const filters = (cam, oc) => (camP ? ` AND ${cam} = ${camP}` : '') + (ocP ? ` AND ${oc} = ${ocP}` : '')
      + (siteP ? ` AND ${cam} IN (SELECT id FROM cameras WHERE site_id = ${siteP})` : '')
      + (sw.sql ? ' ' + sw.sql.replace(/__CAM__/g, cam) : '');
    const rawWhere = `((a.event_time >= ${fromP} AND a.event_time < ${aP}) OR (a.event_time >= ${bP}${toP ? ` AND a.event_time <= ${toP}` : ''}))`
      + filters('a.camera_id', 'a.object_class');
    const peakSql = peakExpr.replace(/\$1/g, tzP).replace(/event_time/g, 'bucket_hour');
    const { selectSql } = require('../appearance-rollup-refresher');
    const { rows } = await pool.query(`
      WITH src AS (
        SELECT r.bucket_hour, r.camera_id, r.object_class, r.dim, r.value, r.n FROM appearance_dim_hourly r
         WHERE r.bucket_hour >= ${aP} AND r.bucket_hour < ${bP}${filters('r.camera_id', 'r.object_class')}
        UNION ALL
        ${selectSql(rawWhere, { withUpdatedAt: false })}
      )
      SELECT 'd' AS k, dim, value, NULL::timestamptz AS day, NULL::int AS peak, NULL::text AS cam, NULL::text AS oc, sum(n)::int AS n
        FROM src WHERE dim <> 'all' GROUP BY dim, value
      UNION ALL
      SELECT CASE WHEN GROUPING(day) = 0 THEN 'day' WHEN GROUPING(peak) = 0 THEN 'peak' WHEN GROUPING(cam) = 0 THEN 'camera'
                  WHEN GROUPING(oc) = 0 THEN 'class' ELSE 'all' END, NULL, NULL, day, peak, cam, oc, sum(n)::int
        FROM (SELECT (DATE_TRUNC('day', bucket_hour AT TIME ZONE ${tzP}) AT TIME ZONE ${tzP}) AS day, ${peakSql} AS peak,
                     camera_id AS cam, object_class AS oc, n FROM src WHERE dim = 'all') x
       GROUP BY GROUPING SETS ((day), (peak), (cam), (oc), ())`, args);

    // ORDER BY n DESC ของเดิม + ตัวตัดสินด้วยค่า (เดิมไม่มี — ค่าที่จำนวนเท่ากันที่ขอบ LIMIT สลับกันได้ระหว่างรอบ)
    const dimRows = (dim) => rows.filter((r) => r.k === 'd' && r.dim === dim)
      .sort((x, y) => (y.n - x.n) || x.value.localeCompare(y.value));
    const asRows = (dim, out, limit) => {
      const list = dimRows(dim).map((r) => ({ [out]: r.value, n: r.n }));
      return { rows: limit ? list.slice(0, limit) : list };
    };
    const flag = Object.fromEntries(dimRows('flag').map((r) => [r.value, r.n]));
    const total = rows.find((r) => r.k === 'all')?.n || 0;
    const camTop = rows.filter((r) => r.k === 'camera').sort((x, y) => (y.n - x.n) || x.cam.localeCompare(y.cam)).slice(0, 12);
    const { rows: names } = camTop.length
      ? await pool.query('SELECT id, name FROM cameras WHERE id = ANY($1::text[])', [camTop.map((r) => r.cam)]) : { rows: [] };
    const nameOf = new Map(names.map((c) => [c.id, c.name]));
    return {
      genderR: asRows('gender', 'gender'),
      topR: asRows('top', 'top_category', 8),
      botR: asRows('bottom', 'bottom_category', 8),
      colorR: { rows: dimRows('color').slice(0, 50).map((r) => { const [u, l] = JSON.parse(r.value); return { upper_color: u, lower_color: l, n: r.n }; }) },
      hairColorR: asRows('hair_color', 'hair_color'),
      hairLenR: asRows('hair_length', 'hair_length'),
      accessR: { rows: [{ total, bag_count: flag.bag || 0, backpack_count: flag.backpack || 0, shoulder_count: flag.shoulder || 0,
        glasses_count: flag.glasses || 0, helmet_count: flag.helmet || 0, mask_count: flag.mask || 0, hat_count: flag.hat || 0 }] },
      volumeR: { rows: rows.filter((r) => r.k === 'day').sort((x, y) => x.day - y.day).map((r) => ({ day: r.day, n: r.n })) },
      ageR: asRows('age', 'age_group'),
      exprR: asRows('expr', 'expression'),
      dirR: asRows('dir', 'direction'),
      peakR: { rows: rows.filter((r) => r.k === 'peak').sort((x, y) => x.peak - y.peak).map((r) => ({ bucket: r.peak, n: r.n })) },
      cameraR: { rows: camTop.map((r) => ({ camera_id: r.cam, camera_name: nameOf.get(r.cam) || r.cam, n: r.n })) },
      classR: { rows: rows.filter((r) => r.k === 'class').sort((x, y) => (y.n - x.n) || x.oc.localeCompare(y.oc)).map((r) => ({ object_class: r.oc, n: r.n })) },
    };
  }

  // GET /api/appearances/stats?from=ISO&to=ISO[&camera_id=]
  // Returns aggregated appearance data for the stats panel.
  // One endpoint, not six — mirrors /api/stats/categories pattern.
  const APP_STATS_MAX_DAYS = 31;
  app.get('/api/appearances/stats', async (req, res) => {
    try {
      const { from, to, camera_id, site_id, object_class } = req.query;
      // เดิมจำกัด 2 วัน เพราะ join appearances ⋈ events: 1 วัน 6.8 วิ · 3 วัน 47 · 7 วัน 76 วิ (GOTCHAS #217)
      // หลัง migration 255 (event_time + rj_* อยู่บน appearances · ไม่ join แล้ว) วัด 2026-10-06:
      // ตารางกลาง 7 วัน 1.7 วิ · 31 วัน 6.0 วิ ⇒ ขยายเป็น 31 วัน (เท่าเพดาน custom ของหน้า LPR)
      // ไม่ส่ง from ยังตอบ 400 เหมือนเดิม (ไม่มีขอบล่าง = ทั้งประวัติ)
      {
        const fMs = from ? Date.parse(from) : NaN;
        const tMs = to ? Date.parse(to) : Date.now();
        if (!Number.isFinite(fMs) || !Number.isFinite(tMs) || (tMs - fMs) > APP_STATS_MAX_DAYS * 86400_000) {
          return res.status(400).json({ error: 'range_too_large', max_days: APP_STATS_MAX_DAYS });
        }
      }
      // object_class belongs in the key like every other filter — leaving it out
      // would serve the unfiltered answer to a filtered request for the whole TTL.
      // (scope ต่อท้ายให้เองใน wrap ข้างล่าง)
      const _cacheKey = `${from||''}|${to||''}|${camera_id||''}|${site_id||''}`
        + `|${object_class||''}`;
      const result = await _appStatsCache.wrap(_cacheKey, async () => {

      const tz = await getDisplayTz();
      const where = ['TRUE'], args = [];
      if (camera_id) { args.push(camera_id); where.push(`a.camera_id = $${args.length}`); }
      if (object_class) { args.push(object_class); where.push(`a.object_class = $${args.length}`); }
      // a.event_time / a.camera_id เท่ากับของ events ทุกแถว (trigger + backfill ของ migration 255 ·
      // ตรวจ 4 ต.ค. กล้องตรง 184,436/184,436) ⇒ ไม่ต้อง JOIN events อีก (D6)
      if (from)      { args.push(from);      where.push(`a.event_time >= $${args.length}`); }
      if (to)        { args.push(to);        where.push(`a.event_time <= $${args.length}`); }
      if (site_id)   { args.push(parseInt(site_id)); where.push(`a.camera_id IN (SELECT id FROM cameras WHERE site_id = $${args.length})`); }
      const swA = siteWhere(req.user?.allowedSites ?? null, 'a.camera_id', args.length + 1);
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
      let genderR, topR, botR, colorR, hairColorR, hairLenR, accessR, volumeR, ageR, exprR, dirR, peakR, cameraR, classR;
      const rolled = await _statsFromRollup({ from, to, camera_id, site_id, object_class,
        scope: req.user?.allowedSites ?? null, tz, peakExpr });
      if (rolled) ({ genderR, topR, botR, colorR, hairColorR, hairLenR, accessR, volumeR, ageR, exprR, dirR, peakR, cameraR, classR } = rolled);
      else {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`CREATE TEMP TABLE _app_stats_filtered ON COMMIT DROP AS
          SELECT a.gender, a.top_category, a.bottom_category, a.upper_color, a.lower_color,
                 a.hair_color, a.hair_length, a.bag_category, a.glasses, a.helmet_wear,
                 a.age_group, a.attributes, a.camera_id, a.object_class, a.event_time,
                 -- สี่ค่าจาก events.raw_json คัดลอกไว้ที่ appearances แล้วตอน INSERT (migration 255)
                 a.rj_mask, a.rj_hat, a.rj_age_group, a.rj_expression
          FROM appearances a ${clause}`, args);

        [genderR, topR, botR, colorR, hairColorR, hairLenR, accessR, volumeR, ageR, exprR, dirR, peakR, cameraR, classR] = await Promise.all([
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
              count(*) FILTER (WHERE rj_mask = 'yes')::int AS mask_count,
              count(*) FILTER (WHERE rj_hat = 'yes')::int AS hat_count
            FROM _app_stats_filtered`),
          client.query(`SELECT
              (DATE_TRUNC('day', event_time AT TIME ZONE $1) AT TIME ZONE $1) AS day,
              count(*)::int AS n
            FROM _app_stats_filtered
            GROUP BY 1 ORDER BY 1`, [tz]),
          client.query(`SELECT COALESCE(age_group, rj_age_group) AS age_group, count(*)::int AS n
            FROM _app_stats_filtered WHERE COALESCE(age_group, rj_age_group) IS NOT NULL
            GROUP BY 1 ORDER BY n DESC`),
          client.query(`SELECT rj_expression AS expression, count(*)::int AS n
            FROM _app_stats_filtered WHERE rj_expression IS NOT NULL
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
          // ชนิดวัตถุ — ตัวที่บอกว่า "ที่นับมาทั้งหมดนั้น เป็นคนกี่ตัว"
          client.query(`SELECT COALESCE(object_class, 'unknown') AS object_class, count(*)::int AS n
            FROM _app_stats_filtered GROUP BY 1 ORDER BY n DESC`),
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
      const byClass = Object.fromEntries(classR.rows.map(r => [r.object_class, r.n]));
      const topCamera = cameraR.rows[0] || null;
      return {
        kpi: {
          total,
          top_camera: topCamera,
          male: gender.Male || 0,
          female: gender.Female || 0,
          gender_known: (gender.Male || 0) + (gender.Female || 0),
          // นับเฉพาะ Person จริง ๆ — total คือวัตถุทุกชนิดที่กล้องติดตาม ซึ่งส่วนใหญ่
          // เป็นรถ หน้าจอเคยเรียกทั้งก้อนว่า "คน" (รายงาน 2026-08-20)
          person: byClass.Person || 0,
        },
        by_class: byClass,
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
      }, { scope: req.user?.allowedSites ?? null });
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
      // Count in its own statement instead of COUNT(*) OVER () on the page query.
      // The window function has to see every joined row before LIMIT can apply,
      // and it drags the full-width SELECT list — e.* including raw_json — through
      // with it: the planner walked all 5.3M events via Merge Append across every
      // partition to reach 295k appearances, 20.4M buffer hits per request.
      // Measured 66.5s cold / 4.64s warm. Counting on its own touches none of that
      // width (0.38s) and the page query with the SAME ordering is 0.03s.
      // The total stays exact — both forms returned 295,741 — and nothing the
      // operator sees changes. Ordering deliberately still keys on e.event_time:
      // a.detected_at is ingest time and differs from the camera's own timestamp
      // on ALL 295,742 rows, so sorting by it would silently reorder the page.
      const countArgs = args.slice();
      args.push(lim, off);
      const [{ rows }, cnt] = await Promise.all([
        pool.query(
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
                a.attributes->>'direction' AS direction
         FROM appearances a JOIN events e ON e.id = a.event_id
         ${clause}
         ORDER BY e.event_time DESC, e.id DESC
         LIMIT $${args.length - 1} OFFSET $${args.length}`,
          args
        ),
        pool.query(
          // Stop counting at the cap. The exact figure costs 24.5s on a broad
          // search — the planner runs a nested loop whose inner side is an
          // Append across all 25 event partitions, once per appearance:
          // 806,239 executions and 7.2M buffer hits, and it is the ONLY slow
          // part of this endpoint (the 50 rows above take 6ms). Both obvious
          // escapes were measured and rejected: forcing a hash join is worse
          // (>150s), and a.detected_at cannot prune the outer side because it
          // agrees with the camera's own event_time on 6.6% of rows, off by up
          // to five days. Counting 10,001 instead of 806,116 is 287ms.
          //
          // A narrow search still reports its exact total, because it never
          // reaches the cap. Only "show me everything" gets an approximation,
          // and nobody reads 806,116 or pages to 16,000.
          `SELECT COUNT(*)::int AS n FROM (
             SELECT 1
               FROM appearances a JOIN events e ON e.id = a.event_id
               ${clause}
              LIMIT ${APP_COUNT_CAP + 1}) x`,
          countArgs
        ),
      ]);
      const counted = cnt.rows[0]?.n || 0;
      const capped = counted > APP_COUNT_CAP;
      res.set('X-Total-Count', capped ? APP_COUNT_CAP : counted);
      // The page needs to know the number is a floor, not a total, so it can say
      // "10,000+" rather than quietly presenting a cap as a fact.
      if (capped) res.set('X-Total-Capped', '1');
      // `SELECT e.*` คืน raw_json ทั้งก้อน — ปิดบัง IP/MAC ใน rawXml เหมือน /api/events (security backlog 2026-08-12 · S1 · d3fe320, 3883fc2)
      if (req.user?.role !== 'admin') for (const r of rows) r.raw_json = scrubRawJson(r.raw_json);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/appearances/search'); }
  });

  // GET /api/appearances/timeline — AP.5a forensic timeline (2026-06-12)
  // filter ชุดเดียวกับ /search แต่เรียงเวลา ASC แล้ว group การพบเห็นติดกัน
  // (กล้องเดิม, ห่าง ≤180s) เป็น segment: "อยู่หน้ากล้อง X ช่วง HH:MM–HH:MM (N ครั้ง)"
  // ⚠️ attribute matching ไม่ใช่การระบุตัวตน — UI ติด disclaimer.
  // PDPA: การไล่รอยบุคคลย้อนหลัง → จำกัด admin/auditor + ลง audit_log ทุกครั้ง
  app.get('/api/appearances/timeline', async (req, res) => {
    // unscoped: admin/auditor เท่านั้น (เช็ค role ในบรรทัดถัดไป) — สองบทบาทนี้ไม่ถูกจำกัด site
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
    // unscoped: admin/auditor เท่านั้น (เช็ค role ด้านล่าง) — สองบทบาทนี้ไม่ถูกจำกัด site
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
