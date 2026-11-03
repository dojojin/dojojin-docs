// ============================================================
// Vigil Platform — Routes: Events
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const { pageIndexSql, coversPageIndex } = require('../helpers/eventsPageIndex');
const { createTtlCache } = require('../helpers/ttlCache');
const { siteWhere } = require('../auth');
const { CLASS_HIERARCHY } = require('../helpers/objectClassGroup');
const { scrubRawJson } = require('../helpers/scrubRawJson');
const { perCameraFrom } = require('../helpers/perCameraScan');

module.exports = function eventsRoutes(app, pool, {
  getDisplayTz,
  getAnalyticsEnabledSet,
  METRIC_EVENT_TYPE_PATTERN, ANALYTICS_EVENT_KEYS, ANALYTICS_KEY_SQL,
}) {

  // Phase 6.1.8 — object class hierarchy. Selecting a parent class expands to
  // all children automatically so cameras that emit generic "Vehicle" + cameras
  // that emit specific "Car"/"Truck" both match a single "Vehicle" filter.
  // `null` is significant — some Counter events have no object_class.
  // ⚠️ ย้ายไป helpers/objectClassGroup.js แล้ว (2026-08-21) เพราะการ์ดสรุปในรายงาน
  //    ต้องใช้ชุดเดียวกัน — รายชื่อเท่าเดิมทุกตัว ไม่ได้เปลี่ยนพฤติกรรมของ endpoint นี้
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

  // เพดานการนับของ /api/events (non-burst) — ดูเหตุผลที่บล็อกเหนือ countSql
  const EVENTS_COUNT_CAP = parseInt(process.env.EVENTS_COUNT_CAP || '10000', 10);

  // ── ทำความสะอาดรูปก่อนส่งออก (เจ้าของสั่ง 2026-08-19) ─────────────────
  //
  // ทำที่ server ที่เดียว ไม่ใช่ที่หน้าจอ — หน้า gallery กับ modal อ่านคนละฟิลด์
  // (`snapshot_file` vs `raw_json._snapshot_full`) ถ้าไปแก้ฝั่ง frontend ต้องแก้
  // 2 ที่แล้วมีโอกาสหลุดไม่ตรงกัน
  //
  // (ก) ซ้ำในใบเดียวกัน — event ที่ไม่ได้มาจาก MQTT มี `_snapshot_full` เป็น
  //     **ไฟล์เดียวกันเป๊ะ** กับ snapshot_file (วัดจริง 2,820/2,820 ใบบนกล้อง
  //     BH5100i_RMUTR-V_01) · modal จึงเอารูปเดิมมาวางข้างกัน 2 ช่อง ⇒ ตัดทิ้ง
  //     ให้เหลือรูปเดียว · ฝั่ง MQTT ไม่โดน เพราะ crop กับ full เป็นคนละไฟล์จริง
  //     (0/353 ที่ซ้ำ) จึงยังโชว์คู่กันได้ตามเดิม
  //
  // (ข) ซ้ำข้ามใบ — edge เคย republish ไฟล์ full-scene เดิมให้ event ใหม่ตอนติด
  //     cooldown ทำให้หลาย event ชี้ไฟล์เดียวกัน (วัดจริง 2,448 จาก 3,157 ใบ
  //     ได้รูปของคนอื่น · ไฟล์แย่สุดถูกใช้ซ้ำ 51 ใบ) · ชื่อไฟล์ฝัง epoch-ms ของ
  //     ตอนถ่ายไว้ และเชื่อถือได้ 704/709 ไฟล์อยู่ในช่วง ±10 วิของ event แรก
  //     ⇒ ยกรูปให้ใบที่เวลาใกล้เวลาถ่ายที่สุดใบเดียว ที่เหลือไม่ต้องแสดง
  //     "ไม่มีรูป ดีกว่ารูปผิดคัน" — ตรงกับที่ฝั่ง edge ตัดสินใจไว้แล้ว
  //     หมายเหตุ: ตัดเฉพาะที่ส่งออกรอบนี้ ไม่ได้แก้ข้อมูลใน DB
  const _fullTs = (f) => {
    const m = /event_edge_(\d+)\.jpg/.exec(f || '');
    return m ? Number(m[1]) : null;
  };
  // scrub = true → ปิดบัง <ipAddress>/<ipv6Address>/<macAddress> ใน raw_json.rawXml
  // ก่อนส่งออก (security backlog 2026-08-12 · S1 — เจ้าของสั่ง) · ทำที่นี่จุดเดียว
  // เพราะ /api/events คืนค่าผ่านฟังก์ชันนี้ทั้งสองทาง (burst branch + ทางปกติ)
  // แก้ที่ res.json ทีละที่มีสิทธิ์ลืม · SELECT ใช้ `e.*` จึง scrub ใน SQL ไม่สะดวก
  // (countSql เขียน SELECT list ใหม่ด้วย regex) — 20–100 แถวต่อครั้ง ค่าใช้จ่ายไม่มีนัย
  function cleanEventImages(rows, scrub = false) {
    if (scrub) for (const r of rows) r.raw_json = scrubRawJson(r.raw_json);
    // (ก)
    for (const r of rows) {
      const full = r.raw_json?._snapshot_full;
      if (full && r.snapshot_file && full === r.snapshot_file) r.raw_json._snapshot_full = null;
    }
    // (ข) — จัดกลุ่มตามไฟล์ แล้วเลือกเจ้าของเพียงใบเดียว
    const byFile = new Map();
    for (const r of rows) {
      const full = r.raw_json?._snapshot_full;
      if (!full) continue;
      if (!byFile.has(full)) byFile.set(full, []);
      byFile.get(full).push(r);
    }
    for (const [file, group] of byFile) {
      if (group.length < 2) continue;
      const ts = _fullTs(file);
      // ไม่มี epoch ในชื่อไฟล์ = ตัดสินด้วยเวลาไม่ได้ ให้ใบแรกสุดถือไว้ (คงที่ ไม่สุ่ม)
      const owner = ts === null
        ? group.reduce((a, b) => (new Date(a.event_time) <= new Date(b.event_time) ? a : b))
        : group.reduce((a, b) =>
            Math.abs(new Date(a.event_time).getTime() - ts) <= Math.abs(new Date(b.event_time).getTime() - ts) ? a : b);
      for (const r of group) if (r !== owner) r.raw_json._snapshot_full = null;
    }
    return rows;
  }

  app.get('/api/events', async (req, res) => {
    const {
      camera, cameras, category, type, cls, object_classes,
      rule_name, rule_names, category_id,
      limit = 100, offset = 0, from, to,
      hasSnapshot, hasClip, tab, q,
      dow, hour, exclude_types, group,
    } = req.query;
    // limit/offset เป็นตัวเลขที่มีเพดานเสมอ — เดิม parseInt ตรง ๆ: limit=abc → NaN → 500 · limit=1000000 → คืนล้านแถว
    // พร้อม raw_json (audit 2026-10-02 · D17) · 2000 เผื่อมุมมอง burst ที่ขอ limit = burst_count
    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 2000);
    const off = Math.max(parseInt(offset, 10) || 0, 0);
    try {
      // ยอดรวมมาจากคิวรีนับของตัวเองด้านล่าง ไม่ใช่ COUNT(*) OVER () ในนี้แล้ว —
      // เหตุผลอยู่ที่บล็อกก่อน countSql
      // LPR has its own page (ป้ายทะเบียน); the generic feed renders anprAlarm as a
      // synthetic plaque from raw_json, so no license_plates JOIN is needed here.
      let sql = `SELECT e.*,
                   COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot_file,
                   e.raw_json->>'_snapshot_source' AS snapshot_source
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
      let camsIdx = 0;   // ตำแหน่ง param ของรายชื่อกล้อง — ทาง burst ใช้ไล่ทีละกล้อง (ดูข้างล่าง)
      if (camera)    { sql += ` AND e.camera_id = $${++n}`;      params.push(camera); }
      if (cameras)   {
        const arr = String(cameras).split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length > 0) { sql += ` AND e.camera_id = ANY($${++n})`; params.push(arr); camsIdx = n; }
      }
      if (category)  { sql += ` AND e.event_category = $${++n}`; params.push(category); }
      if (type)      { sql += ` AND e.event_type LIKE $${++n}`;  params.push(`%${type}%`); }
      if (cls)       { sql += ` AND e.object_class = $${++n}`;   params.push(cls); }
      if (object_classes) {
        const arr = expandClasses(object_classes);
        if (arr && arr.length > 0) { sql += ` AND e.object_class = ANY($${++n})`; params.push(arr); }
      }
      // รหัสวัตถุ = เลข track ของ "การวิ่งผ่านรอบนั้น" (ไม่ใช่ตัวตนของรถ — Bosch รีเซ็ต
      // เลขใหม่ทุก track) ใช้ดึงทุกเฟรมของรอบเดียวกันมาดู เช่นจากคำสั่งใน LINE
      if (req.query.object_id) { sql += ` AND e.object_id = $${++n}`; params.push(String(req.query.object_id)); }
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
        // รายการตัดออกครอบชุดของ partial index → ใส่เงื่อนไขค่าคงที่ซ้ำ ให้ planner ใช้ idx_events_page_time
        // (ผลเท่าเดิม: แถวที่ถูกตัดก็ถูกตัดโดย $n ข้างบนอยู่แล้ว) · helpers/eventsPageIndex.js
        if (coversPageIndex(ex)) sql += ` AND ${pageIndexSql('e')}`;
      }
      // Free-text search: scans rule_name + camera_id + object_class + event_type
      if (q && String(q).trim()) {
        const term = `%${String(q).trim()}%`;
        sql += ` AND (e.rule_name ILIKE $${++n} OR e.camera_id ILIKE $${n} OR e.object_class ILIKE $${n} OR e.event_type ILIKE $${n})`;
        params.push(term);
      }
      // category_ids = เลือกได้หลายหมวด (2026-08-25) · category_id ตัวเดิมยังใช้ได้
      // เพราะ drill-down จาก heatmap และหน้า Events ส่งมาแบบเดี่ยว — ไม่ส่งตัวใหม่มา
      // ก็ทำงานเหมือนเดิมทุกประการ
      const catIdList = req.query.category_ids
        ? String(req.query.category_ids).split(',').map(x => parseInt(x, 10)).filter(Number.isFinite)
        : null;
      if (catIdList && catIdList.length) {
        // ANY() แทน = ตัวเดียว — โครง EXISTS เหมือนเดิมทุกบรรทัด event ที่เข้าหมวด
        // ใดหมวดหนึ่งที่เลือกไว้ก็พอ (OR ไม่ใช่ AND) ซึ่งตรงกับที่ผู้ใช้คาดจากตัวกรอง
        sql += ` AND EXISTS (
          SELECT 1 FROM event_category_rules r
           WHERE r.category_id = ANY($${++n}::int[])
             AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
             AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
             AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
             AND (r.object_class IS NULL OR r.object_class = e.object_class)
             AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm'))`;
        params.push(catIdList);
      } else if (category_id) {
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
      // ตัวช่วย planner (2026-10-14): EXISTS บนกฎหมวดประเมินทีละแถว จึงต้องอ่าน events ทุกกล้องทุกไซต์ในช่วงเวลา
      // ก่อนกรอง — วันเดียว ~1 ล้านแถว = นับ 6.6 วิ (perfWatch เตือน · แกลเลอรี vehiclecount) · ถ้ากฎทุกข้อของหมวดที่เลือก
      // ระบุกล้อง (23/23 แถวตอนนี้) ใส่รายชื่อกล้องซ้ำเข้าไปให้ใช้ index (camera_id, event_time) · EXISTS เดิมยังอยู่
      // ผลจึงเท่าเดิมทุกแถว · มีกฎข้อไหนไม่ระบุกล้อง (= ทุกกล้อง) → ไม่ใส่ ทำงานแบบเดิม
      {
        const catIds = (catIdList && catIdList.length) ? catIdList
          : (category_id ? [parseInt(category_id, 10)].filter(Number.isFinite) : null);
        if (catIds && catIds.length) {
          const { rows: rc } = await pool.query(
            `SELECT bool_or(camera_id IS NULL) AS any_cam,
                    array_agg(DISTINCT camera_id) FILTER (WHERE camera_id IS NOT NULL) AS cams
               FROM event_category_rules WHERE category_id = ANY($1::int[])`, [catIds]);
          if (rc[0] && rc[0].any_cam === false && (rc[0].cams || []).length) {
            sql += ` AND e.camera_id = ANY($${++n}::text[])`;
            params.push(rc[0].cams);
          }
        }
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

      // Same 24h default the burst path below has had since 2026-07-28, now on
      // the plain feed too. Without it COUNT(*) OVER () counts every row ever
      // recorded before LIMIT can apply — 257,707 rows to render twenty, 2.57s
      // on the Events page. Bounded to 24h it is 23,544 rows and 0.57s.
      // Guarded on from/to ONLY, deliberately matching the burst path: two
      // adjacent code paths with different rules is how the LPR exclusion
      // drifted from the live push in the first place. A caller that lands here
      // without a range (e.g. the camera-card drill-in) therefore also gets 24h,
      // which is why the page states the window on screen instead of applying
      // it silently — a list that quietly disagrees with the card that opened it
      // is indistinguishable from missing data.
      if (!from && !to && group !== 'burst') {
        sql += ` AND e.event_time >= NOW() - INTERVAL '24 hours'`;
      }

      // Burst-grouping (opt-in, Snapshots gallery only — Events/alert/dwell
      // never send group=burst so their queries below are untouched). Reuses
      // every filter built above verbatim via the CTE; only the row-count
      // window function differs (per-burst, not per-row).
      if (group === 'burst') {
        let filteredSql = sql.replace(/,\s*COUNT\(\*\) OVER \(\) ::int AS _total/, '');
        // Snapshot page perf (2026-07-28): with no from/to the burst pipeline
        // previously scanned the entire partitioned history (231K+ rows, no
        // partition pruning) — measured 4.4s + 345MB disk-spilling sort.
        // Default to the last 24h so the common case (page load / "ล้างค่า")
        // stays inside 1-2 monthly partitions. Only affects group=burst.
        if (!from && !to) {
          filteredSql += ` AND e.event_time >= NOW() - INTERVAL '24 hours'`;
        }
        // Bound the window-function input regardless of range, so an explicit
        // wide custom date range can't hit the same cost. Well above normal
        // 24h volume (~21K rows measured) — X-Total-Count becomes approximate
        // only when a query would exceed this cap.
        // เพดานตามหน้าที่ขอ (2026-10-27 · เจ้าของอนุมัติ): เดิม 50,000 ตายตัว — 30 วันของ hdy มีแถวมีภาพ ~10 ล้าน
        // rmutr-v ~1 ล้าน ⇒ ชนเพดานทุกครั้ง อ่าน 50,000 แถวเต็มคอลัมน์ (~82,000 หน้า ~650 MB) เพื่อแสดง 20 การ์ด
        // cache เย็น 9.9 / 8.6 วิ (query-probe ตี 1:15) · หน้าแรกพอด้วย ~4,000 แถวล่าสุด · หน้าลึกขึ้นเพดานโตตาม offset
        // ยอดรวมเป็นค่าประมาณเมื่อชนเพดาน ⇒ ส่ง X-Total-Capped ให้หน้าจอขึ้น "+" (page-snapshots.js รองรับอยู่แล้ว)
        const BURST_INPUT_CAP = Math.min(50000, 2000 + (off + lim) * 100);
        filteredSql += ` ORDER BY e.event_time DESC LIMIT ${BURST_INPUT_CAP}`;
        // เลือกกล้องเป็นชุด (ไซต์ / กลุ่ม) → ไล่ทีละกล้องด้วย idx_events_snap_cam_time (migration 278)
        // เดิม planner เดิน idx_events_page_time ตามเวลาทั้งเดือนแล้วเปิดแถวจริงเช็คกล้องทีละแถว เพราะประเมินว่า
        // กล้องชุดนั้นมีของ ~19,000 แถว — ภูเก็ต "This month" จริง 0 แถว (ป้าย/ใบหน้าล้วน) อ่านดิสก์ 2.9 GB 49 วิ
        // วัด 2026-10-24 ช่วงเดือนนี้: ภูเก็ต 13.7–49 วิ → 0.45 · หาดใหญ่ 17 → 1.1 · RMUTR-V 4.4 → 4.1 · VSS 0.29 → 0.34
        const burstLat = perCameraFrom(filteredSql, `e.camera_id = ANY($${camsIdx})`, camsIdx, 'e.camera_id');
        if (burstLat) filteredSql = `SELECT x.* FROM ${burstLat} ORDER BY x.event_time DESC LIMIT ${BURST_INPUT_CAP}`;
        const limitIdx = ++n; params.push(lim);
        const offsetIdx = ++n; params.push(off);
        // จัดกลุ่มแยกตาม rule_name ด้วย — ไม่ใช่แค่ event_type
        //
        // event_type มาจาก topic ของ MQTT (detector/sub) ไม่ใช่จากชื่อกฎ กล้อง
        // ตัวเดียวจึงใช้ค่าเดียวกันให้หลายกฎที่ความหมายคนละเรื่อง วัดจริงบน
        // BH5100i_RMUTR-V_01 (2026-08-19): `LineDetector/Crossed` ครอบ 4 กฎ —
        // Vehicle Count (IN)/(OUT)/Vehicle Count/คนข้ามถนน · 106 จาก 237 burst
        // ปนหลายกฎ (861 event) และเจอเคสจริงที่ **เหตุการณ์คนข้ามถนนถูกซ่อนอยู่
        // หลังการ์ดนับรถ** ซึ่งไม่ใช่ burst แต่เป็นคนละเรื่องที่บังเอิญเกิดใกล้กัน
        //
        // event ที่รูปมาจาก MQTT ไม่เข้ากลุ่มเลย (burst_id เป็น id ของตัวเอง)
        // เพราะเป็นใบเดียวที่มีภาพ crop ของวัตถุจริง ๆ จากกล้อง — ถูกพับหลัง "+N"
        // เมื่อไหร่คือภาพหายไปจากสายตาคน วัดจริงพบว่าถูกซ่อน 278 จาก 340 ใบ (81.8%)
        // ทางเลือกที่เบากว่า (เลือกใบ mqtt เป็นตัวแทน) วัดแล้วยังเหลือซ่อน 155 ใบ
        // เพราะ 1 burst แสดงได้ใบเดียว — จึงต้องกันออกจากการจัดกลุ่มจริง ๆ
        const burstSql = `
          WITH filtered AS (${filteredSql}),
          gapped AS (
            SELECT *, event_time - LAG(event_time) OVER (
              PARTITION BY camera_id, event_type, rule_name ORDER BY event_time ASC) AS gap
            FROM filtered
          ),
          grouped AS (
            SELECT *, SUM(CASE WHEN gap IS NULL OR gap > INTERVAL '${BURST_GROUPING_SECONDS} seconds'
                                THEN 1 ELSE 0 END)
              OVER (PARTITION BY camera_id, event_type, rule_name ORDER BY event_time ASC) AS burst_id
            FROM gapped
          ),
          bursts AS (
            SELECT camera_id, event_type, rule_name, burst_id, mqtt_solo,
                   MIN(event_time) AS burst_first_time, MAX(event_time) AS burst_last_time,
                   COUNT(*)::int AS burst_count,
                   -- id เป็นตัวตัดสินเมื่อเวลาเท่ากัน — ไม่งั้นการ์ดตัวแทนสลับรูปได้ระหว่างกด refresh (ตรวจ 2026-10-24)
                   (ARRAY_AGG(id ORDER BY event_time ASC, id ASC))[1] AS representative_id
            FROM (SELECT *, CASE WHEN snapshot_source = 'mqtt' THEN id ELSE NULL END AS mqtt_solo
                    FROM grouped) g
            GROUP BY camera_id, event_type, rule_name, burst_id, mqtt_solo
          )
          SELECT f.*, b.burst_count, b.burst_first_time, b.burst_last_time,
                 COUNT(*) OVER()::int AS _total,
                 (SELECT count(*) FROM filtered)::int AS _input
          FROM bursts b JOIN filtered f ON f.id = b.representative_id
          ORDER BY b.burst_last_time DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
        const { rows } = await pool.query(burstSql, params);
        const total = rows.length > 0 ? (rows[0]._total ?? 0) : 0;
        const capped = rows.length > 0 && rows[0]._input >= BURST_INPUT_CAP;
        rows.forEach(r => { delete r._total; delete r._input; });
        res.set('X-Total-Count', String(total));
        if (capped) res.set('X-Total-Capped', '1');
        return res.json(cleanEventImages(rows, req.user?.role !== 'admin'));
      }

      // นับแยกเป็นคิวรีของตัวเอง แล้วยิงคู่ขนานกับคิวรีที่ดึงแถว
      //
      // เดิมใช้ COUNT(*) OVER () ในคิวรีเดียวกัน ซึ่งบังคับให้ planner ต้องดึง
      // **ทุกคอลัมน์ของทุกแถวที่ตรงเงื่อนไข** ออกจาก heap เพื่อจะนับ — ที่ ~980,000
      // แถวต่อ 24 ชม. วัดจาก endpoint จริงได้ 18.3 วินาที (เจ้าของทัก 2026-08-30)
      // พอแยกเป็น SELECT count(*) ตัวเดียว planner ใช้ Index Only Scan บน
      // idx_events_class_time (migration 184) ได้ เพราะไม่ต้องการคอลัมน์อื่นเลย
      // วัดจริงหลังแยก: นับ 133 ms + ดึงแถว 28 ms (จาก 18,333 ms)
      //
      // ปิดเพดานการนับด้วย (2026-09-06) — ยังเหลือ COUNT(*) OVER () ค้างอยู่ใน
      // คิวรีดึงแถวจนถึงรอบนี้ แปลว่าของเดิม "นับสองรอบ" · ที่หน้าต่าง 24 ชม.
      // มาตรฐาน + exclude_types ของหน้า Events (anprAlarm/Face*) pg_stat_statements
      // วัดได้ mean 1.0s / max 4.6s และอีกรูปหนึ่ง mean 2.6s / max 6.4s ส่วน log
      // [slow-req] เห็นผู้ใช้จริงรอเปิดหน้า 4.3–4.7 วินาที (คลาสเดียวกับ GOTCHAS #187)
      //
      // ทำไมต้อง cap: จำนวนที่เกิน 10,000 ไม่มีใครอ่าน และเปิดหน้าที่ 500 (หน้าละ 20)
      // ไม่ใช่การใช้งานจริง — ตัวกรองที่แคบพอจะได้ยอดแม่นเป๊ะเหมือนเดิมเพราะไม่เคย
      // ชนเพดาน · ชนเมื่อไหร่ตอบ X-Total-Capped: 1 ให้หน้าจอเติม "+" แทนที่จะเอา
      // ค่าพื้นไปโชว์เป็นยอดจริง (แบบเดียวกับ /api/appearances/search)
      //
      // ตัวเลขที่ได้เท่าเดิมเป๊ะเมื่อไม่ชนเพดาน — เงื่อนไข WHERE ชุดเดียวกันทั้งสอง
      // คิวรี ต่างกันแค่ SELECT list · ห้ามแยกเงื่อนไขออกจากกัน ไม่งั้นหัว
      // X-Total-Count จะเริ่มไม่ตรงกับรายการที่แสดง ซึ่งเป็นบั๊กที่มองไม่เห็นจนกดหน้า 2
      //
      // group=burst มีเส้นทางของตัวเองด้านบน (cap 50,000 ที่ input ของ window
      // function) ไม่ได้ถูกแตะ — และ .replace() ที่ตัด _total ในนั้นกลายเป็น no-op
      // แล้วเพราะคอลัมน์นี้ถูกถอดออกจาก SELECT list ตั้งแต่ต้น
      const countSql = `SELECT count(*)::int AS n FROM (${
        sql.replace(/^SELECT[\s\S]*?FROM events e/, 'SELECT 1 FROM events e')
      } LIMIT ${EVENTS_COUNT_CAP}) t`;
      const countParams = params.slice();
      // เลือกกล้องเป็นชุด → คิวรีดึงแถวไล่ทีละกล้อง (helpers/perCameraScan.js · GOTCHAS #236)
      // ภูเก็ต "เดือนนี้" ไม่มี event ของหน้านี้เลย แต่เดิมเดิน idx_events_page_time ทั้งเดือน 49 วิ อ่าน 3.8 GB → 4 ms
      // คิวรีนับคงแบบเดิม: เดิมเร็วอยู่แล้วทุกไซต์ (≤0.85 วิ) แบบทีละกล้องกลับช้าลงในไซต์ข้อมูลแน่น (หาดใหญ่ 0.2 → 1.0 วิ)
      const camAny = `e.camera_id = ANY($${camsIdx})`;
      // แต่ละกล้องเอาแค่ (offset + limit) แถวล่าสุด — ผลรวมยังมีครบทุกแถวที่หน้านี้ต้องแสดง
      // id ตัดสินเมื่อเวลาเท่ากัน (เวลาละเอียดถึงวินาที) — LIMIT ต่อกล้องของหน้า 1 กับหน้า 2 ไม่เท่ากัน ถ้าไม่ตัดสิน
      // แถวเวลาเท่ากันตรงขอบหน้าอาจซ้ำ/หายระหว่างหน้า (ตรวจ 2026-10-25: ภูเก็ต 3 แถวเวลาเดียวกันที่ขอบหน้า 2)
      const rowsLat = perCameraFrom(`${sql} ORDER BY e.event_time DESC, e.id DESC LIMIT ${lim + off}`, camAny, camsIdx, 'e.camera_id');
      if (rowsLat) sql = `SELECT x.* FROM ${rowsLat} ORDER BY x.event_time DESC, x.id DESC LIMIT $${++n} OFFSET $${++n}`;
      else sql += ` ORDER BY e.event_time DESC LIMIT $${++n} OFFSET $${++n}`;
      params.push(lim, off);
      const [rowsRes, cntRes] = await Promise.all([
        pool.query(sql, params),
        pool.query(countSql, countParams),
      ]);
      const rows = rowsRes.rows;
      const total = cntRes.rows[0]?.n ?? 0;
      // _total เดิมมาจาก window function — ไม่มีแล้ว แต่ลบทิ้งไว้กันแถวเก่าที่
      // อาจหลุดมาจาก path อื่นในอนาคต
      rows.forEach(r => { delete r._total; });
      res.set('X-Total-Count', String(total));
      // ชนเพดาน = ค่าที่ส่งไปเป็น "อย่างน้อยเท่านี้" ไม่ใช่ยอดจริง — หน้าจอเติม "+"
      if (total >= EVENTS_COUNT_CAP) res.set('X-Total-Capped', '1');
      res.json(cleanEventImages(rows, req.user?.role !== 'admin'));
    } catch (err) { routeError(res, err, 'GET /api/events'); }
  });

  // rule_name/object_class have no index on events (migration 105 dropped
  // them — /api/events itself never benefited, every real query there is
  // time-bounded and uses the time index instead) and this query has none by
  // design (mapping rules need every value ever seen, not just recent ones):
  // measured 11.4s on the live table (13M+ rows / 36GB across the two hot
  // monthly partitions). Cardinality is tiny (20 rule_names, 9
  // object_classes) so the values themselves barely ever change — a short
  // cache absorbs nearly all repeat cost without touching the write path.
  // Keyed by camera_id + the caller's site scope so a site-restricted user
  // never gets another site's cached facets.
  // scope เข้าคีย์ผ่าน wrap({ scope }) — ไม่ต่อ scopeCacheKey เองแล้ว (ที่มาของ #190)
  const _facetsCache = createTtlCache({ name: 'events:facets', ttlMs: 5 * 60 * 1000 });
  const FACETS_QUERY_TIMEOUT_MS = parseInt(process.env.FACETS_QUERY_TIMEOUT_MS || '8000', 10);

  // GET /api/events/facets[?camera_id=&site_id=N] — distinct rule_name + event_type
  // values seen in events. Used by the mapping rule editor to suggest values from
  // real data, and by the Events/Snapshot/Media rule dropdowns.
  //
  // site_id narrows to the site pill the operator has picked; it is a filter on
  // top of RBAC, never a way around it, so a site outside allowedSites is 403 —
  // same shape as GET /api/categories. Without it the rule dropdown listed every
  // rule name in the database, so picking site RMUTR-V still offered rules that
  // only exist at VSS or Phuket (reported 2026-08-20).
  app.get('/api/events/facets', async (req, res) => {
    try {
      const allowedSites = req.user?.allowedSites ?? null;
      const siteParam = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
      if (siteParam && allowedSites !== null && !allowedSites.includes(siteParam))
        return res.status(403).json({ error: 'forbidden' });
      // site_id belongs in the cache key: without it the first site to ask would
      // pin its answer for every other site for the whole TTL.
      const cacheKey = `${req.query.camera_id || ''}|${siteParam || ''}`;
      const payload = await _facetsCache.wrap(cacheKey, async () => {

      const params = [];
      // Base WHERE always includes the metric-event filter so dropdowns don't
      // get polluted with CountAggregation rule names like 'คนในพื้นที่ทั้งหมด'.
      //
      // …and a time bound, which is what keeps this answerable at all. `events`
      // is 23.2M rows over 25 partitions with no index on rule_name, so DISTINCT
      // across all of it never finishes: measured 2026-08-21, site-scoped facets
      // hit the 120s statement timeout every single call. Unscoped only looked
      // fine because one cached answer served everybody. Measured at site hkt:
      //   1 day   436 ms      7 days  >40 s (timeout)
      // A dropdown wants the rules an operator might actually filter on, and a
      // rule that has not fired in a day is not one of them — the 1-day and
      // all-time answers were the same 7 names here anyway.
      //
      // ⚡ 2026-09-05 — ทั้งสามคิวรี distinct ย้ายจาก `events` ไป `event_dim_bucket`
      // (rollup 30 นาที · migration 163 · src/category-rollup-refresher.js): rollup
      // กรองแค่ camera_id IS NOT NULL จึงเก็บค่าเดิมครบทุกตัว (ตรวจแล้ว 1 วัน =
      // rule 24/24 · type 17/17 · class 10/10 เท่ากันเป๊ะ) แต่ต้นทางเล็กกว่ามาก:
      // 3.6s → 22 ms ต่อ cold call. คอลัมน์ใน dim เป็น NOT NULL DEFAULT '' จึงเช็ค
      // แค่ `<> ''` ไม่ต้อง IS NOT NULL. ข้อแลกเปลี่ยนคือค่าใหม่โผล่ช้ากว่าของจริง
      // ≤ ~5 นาที (รอบ refresher) — cache 5 นาทีข้างล่างกลบไปแล้วอยู่ดี
      // predicate ที่เหลือ (camera_id / site_id / siteWhere) ใช้ชื่อคอลัมน์เดียวกัน
      // ใน dim จึงย้ายมาได้ทั้งดุ้นโดยไม่ต้องแตะ RBAC
      const facetDays = parseInt(process.env.FACETS_WINDOW_DAYS || '1', 10);
      params.push(`${facetDays} days`);
      let where = ` WHERE bucket >= now() - $${params.length}::interval`
        + ` AND event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'`;
      if (req.query.camera_id) {
        params.push(req.query.camera_id);
        where += ` AND camera_id = $${params.length}`;
      }
      if (siteParam) {
        params.push(siteParam);
        where += ` AND camera_id IN (SELECT id FROM cameras WHERE site_id = $${params.length})`;
      }
      const swf = siteWhere(req.user?.allowedSites ?? null, 'camera_id', params.length + 1);
      if (swf.sql) { where += ` ${swf.sql}`; params.push(...swf.args); }
      // LPR vehicle_type facet — อ่านจาก event_dim_bucket ด้วยเงื่อนไขเดียวกับอีกสาม facet (กล้อง/site/scope/ช่วงเวลา)
      // เดิม DISTINCT จาก license_plates: 1 วัน 8.8–14.8 วิ · 7 วัน 15.4 วิ · 30 วัน 95 วิ → dim 0.2–0.9 วิ
      // ค่าเหมือนกันทุกตัวทั้งสองทาง (EXCEPT = 0 ที่ 1/7/30 วัน วัด 2026-10-02 · audit O9)
      // A ceiling, so this endpoint can never again hold a browser connection for
      // two minutes: the page fires it alongside the snapshot list, and a request
      // that hangs is worse than one that comes back thin. Anything slower than
      // this is a bug to fix, not a wait to sit through.
      const client = await pool.connect();
      let rules, types, classes, vtypes;
      try {
        // 🔴 SET LOCAL มีผลเฉพาะใน transaction — เดิมไม่มี BEGIN ⇒ Postgres เตือน "SET LOCAL can only be used in
        // transaction blocks" แล้วไม่ตั้งค่า เพดานด้านบนจึงไม่เคยทำงาน (audit · D11)
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = '${FACETS_QUERY_TIMEOUT_MS}'`);
        [rules, types, classes, vtypes] = await Promise.all([
          client.query(`SELECT DISTINCT rule_name AS v FROM event_dim_bucket${where}
                          AND rule_name <> ''
                        ORDER BY v LIMIT 500`, params),
          client.query(`SELECT DISTINCT event_type AS v FROM event_dim_bucket${where}
                          AND event_type <> ''
                        ORDER BY v LIMIT 500`, params),
          client.query(`SELECT DISTINCT object_class AS v FROM event_dim_bucket${where}
                          AND object_class <> ''
                        ORDER BY v LIMIT 200`, params),
          client.query(`SELECT DISTINCT vehicle_type AS v FROM event_dim_bucket${where}
                          AND vehicle_type IS NOT NULL AND vehicle_type <> ''
                        ORDER BY v LIMIT 100`, params),
        ]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      return {
        rule_names:     rules.rows.map(r => r.v),
        event_types:    types.rows.map(r => r.v),
        object_classes: classes.rows.map(r => r.v),    // Phase 6.1.8 — DB-driven class facet
        vehicle_types:  vtypes.rows.map(r => r.v),     // LPR sub-type facet (2026-07-20)
      };
      }, { scope: allowedSites });
      res.json(payload);
    } catch (err) { routeError(res, err, 'GET /api/events/facets'); }
  });

  // GET /api/events/:id/appearance — IVA Pro appearance attributes for a single event
  // Returns the appearances row for this event_id, or null if none exists.
  // Used by the Events modal to conditionally render the appearance section.
  app.get('/api/events/:id/appearance', async (req, res) => {
    // unbounded: อ่าน event เดียวตาม id (มี siteWhere แล้ว)
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
