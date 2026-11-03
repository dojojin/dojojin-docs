// ============================================================
// Vigil Platform — Routes: LPR List (gallery · plate history · mismatch)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// แยกออกจาก routes/lpr-query.js — route ทั้งหมดในไฟล์นี้ยังลงทะเบียนที่ตำแหน่งเดิมเป๊ะ
// (ลำดับการลงทะเบียนคือพฤติกรรม) จึงต้อง export สองตัว เพราะกลุ่มนี้ถูกคั่นกลางด้วย
// /api/lpr/brands ในไฟล์เดิม
//
// ฝั่งสถิติ (/api/lpr/stats · /api/stats/lpr/report · warm loop · _lprStatsCache)
// ยังอยู่ที่ lpr-query.js ทั้งชุด — warm loop กับ route ต้องใช้ cache instance เดียวกัน
// ============================================================
'use strict';

const { buildRollupCount } = require('../helpers/lprRollupCount');
const { siteWhere } = require('../auth');
const { DAHUA_CATEGORY_TO_HIK_VTYPE, DAHUA_BRAND_FIX, DAHUA_BRAND_UNKNOWN, dahuaRgbaToName } = require('../ingesters/dahua-protocol');
const { xyzToColorName } = require('../color-utils');
const { scrubRawJsonSql } = require('../helpers/scrubRawJson');
const helmet = require('../helpers/helmetCriteria');
const { toRegex: platePatternRegex } = require('../helpers/platePattern');
const { createHeavyRunner } = require('../helpers/heavyRunner');
const { brandLogos } = require('../helpers/brandLogos');
const reportRenderer = require('../report-renderer');   // เรียกผ่าน module เสมอ — เทสต์แทนฟังก์ชันได้โดยไม่เปิด Puppeteer
const env = require('../config');
const sharp = require('sharp');
// ค้นตามรูปแบบ (match=pattern) ใช้ index ไม่ได้ ต้องไล่ทุกแถวในช่วงเวลา — วัด 2026-10-22: 1 วัน 0.1 วิ · 7 วัน 1.1 วิ · ทั้งตาราง 10 วิ–>30 วิ
const PATTERN_MAX_DAYS = 7;

// ด่าน probe ชั้นสองของ GET /api/lpr (ดูหมายเหตุที่ใช้งาน) — ชุด id ที่ยอมส่งเข้า = ANY() และเวลาที่ยอมเสีย
const PROBE_CAP = 10000;
const PROBE2_MS = 1500;
// พารามิเตอร์ที่ index (region, detected_at) INCLUDE (camera_id, id) ตอบได้เองทั้งหมด (+ ตัวแบ่งหน้า/รูปแบบ)
const PROBE2_KEYS = new Set(['region', 'regions', 'camera', 'cameras', 'sites', 'from', 'to', 'hours',
  'limit', 'offset', 'export', 'count', 'before_time', 'before_id']);

// กลุ่มที่ 1 — GET /api/lpr (แกลเลอรีหลัก) · ลงทะเบียนเป็น route แรกของหน้า LPR
function registerLprList(app, pool) {
  // GET /api/lpr — paginated ANPR list with license_plates JOIN
  // Params: q, camera, region, vehicle_color, plate_color, lane, has_plate, from, to
  app.get('/api/lpr', async (req, res) => {
    const { q, camera, region, vehicle_type, vehicle_color, plate_color, lane, has_plate, from, to } = req.query;
    // ?export=1 = ดึงไปทำ CSV — เพดานสูงกว่าปกติเพราะเป็นการดึงครั้งเดียวจบ ไม่ใช่หน้าจอ
    // เดิม client ขอ 5000 แต่โดนตัดเหลือ 200 เงียบ ๆ คนกดจึงได้ไฟล์ไม่ครบโดยไม่รู้ตัว
    const isExport = req.query.export === '1';
    const limit  = Math.min(parseInt(req.query.limit,  10) || 50, isExport ? 20000 : 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0,   0);

    const where = [];
    const args  = [];
    // true เมื่อมีตัวกรองที่อ้างตาราง events จริง ๆ — ด่าน probe ข้างล่างวิ่งบน
    // license_plates เดี่ยว ๆ จึงใช้ได้เฉพาะเมื่อ WHERE ทั้งก้อนอยู่บน lp เท่านั้น
    // (เหลือแค่ event_id หลัง migration 194 ย้าย เลน/คนซ้อนท้าย ลงคอลัมน์ lp แล้ว)
    let hasEventFilter = false;
    const add = (clause, val) => { args.push(val); where.push(clause.replace('$$', `$${args.length}`)); };

    // Default = substring (ILIKE %q%) so "งต499" also surfaces near reads like
    // "งต4990". exact=1 (the "ตรงตัวเป๊ะ" checkbox) switches to an equality match.
    // Plate_number is stored space-less (the plaque renders the gap), so strip any
    // spaces the user typed before comparing — keeps the idx_plates_number index.
    if (q && req.query.match === 'pattern') {
      // ค้นตามรูปแบบ (# ตัวเลข · @ อักษรไทย · ? หนึ่งตัว · * อะไรก็ได้ · [5-9]) → regex ที่เทียบทั้งป้าย (helpers/platePattern.js)
      const r = platePatternRegex(q);
      if (r.error) return res.status(400).json({ error: 'bad_pattern', reason: r.error });
      // ต้องมีช่วงเวลาและไม่เกิน PATTERN_MAX_DAYS — ไม่งั้นไล่ทั้งตาราง 67 ล้านแถว (เหตุการณ์ช้า 21 ต.ค.)
      const span = from ? (Date.parse(to || new Date().toISOString()) - Date.parse(from)) / 86400000 : Infinity;
      if (!(span <= PATTERN_MAX_DAYS)) return res.status(400).json({ error: 'pattern_range_too_wide', max_days: PATTERN_MAX_DAYS });
      // 🔴 เขียนเป็นนิพจน์ (|| '') โดยตั้งใจ — ถ้าเป็นคอลัมน์ตรง ๆ รูปแบบที่มีตัวอักษรตายตัว (เช่น ^70… ของรถบรรทุก)
      // ทำให้ planner เลือก idx_plates_number_trgm ไล่ทั้งตาราง 67 ล้านแถวแล้วค่อยกรองเวลา: 157k heap block · 17 วิ (cache เย็น)
      // จนถึง 120 วิเมื่อซ้อนกัน และแย่ง IO จน INSERT ของระบบช้าตาม (perfWatch 2026-10-22) · นิพจน์ใช้ trigram ไม่ได้
      // ⇒ ใช้ idx_plates_time_plate_cover ตามช่วง ≤ 7 วัน (index-only · ทุกไซต์ 7 วัน 0.04–0.95 วิ ทุกรูปแบบที่ลอง)
      add(`(lp.plate_number || '') ~ $$`, r.regex);
    } else if (q && req.query.exact === '1') add(`lp.plate_number = $$`, q.trim().replace(/\s+/g, ''));
    else if (q) {
      // 🔴 ค้นแบบบางส่วนต้อง ≥ 3 ตัวอักษร — ดัชนี trigram (idx_plates_number_trgm) ใช้ไม่ได้กับ 1–2 ตัว
      // planner เลยไล่ทั้งตาราง วัด 2026-10-02: '%ซซ%' เกิน 30 วิ (ค้างถึง 120 วิ) · '%ซซซ%' 27 ms (audit · D12)
      // ค้นแบบ "ตรงตัวเป๊ะ" (exact=1) ยังใช้ได้ทุกความยาว
      if (q.trim().replace(/\s+/g, '').length < 3) return res.status(400).json({ error: 'query_too_short', min: 3 });
      add(`lp.plate_number ILIKE $$`, `%${q.trim()}%`);
    }
    // Single read by event id — the map's live plate card has only the event row
    // from the WS broadcast, which lacks the license_plates join the detail modal
    // renders from. Fetching through this endpoint means the map modal shows the
    // exact same fields as the LPR page, instead of a second, thinner mapping
    // that would drift the moment either side gains a column.
    if (req.query.event_id) { hasEventFilter = true; add(`e.id = $$`, parseInt(req.query.event_id, 10) || 0); }
    // 🔴 ทุกตัวกรองกล้อง/ไซต์อ้าง lp.camera_id ไม่ใช่ e.camera_id (แก้ 2026-08-31):
    // query นี้ขับจาก license_plates แล้ว (ดูคอมเมนต์ใหญ่เหนือ rowsP) — คอลัมน์ทั้งคู่
    // เท่ากันทุกแถว (ตรวจ 291,718/291,718) แต่ predicate ต้องอยู่บนตารางที่ขับ
    // ไม่งั้น planner กลับไปเดิน events อีก
    if (camera) add(`lp.camera_id = $$`, camera);   // legacy single (kept for back-compat)
    // cameras = csv → MultiPicker multi-select (mirror events.js camera_id = ANY)
    if (req.query.cameras) {
      const arr = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length) add(`lp.camera_id = ANY($$)`, arr);
    }
    if (region)       add(`lp.region = $$`, region);
    if (vehicle_type) add(`lp.vehicle_type = $$`, vehicle_type);
    // migration 194 — เลน/คนซ้อนท้าย เป็นคอลัมน์บน lp แล้ว (เดิมอ่าน e.raw_json
    // ต่อแถว: กรองเลน 2 เดี่ยว ๆ ที่ hdy โดน timeout เพราะ probe events ทุก candidate)
    // อยู่บน lp = ผ่านด่าน probe ได้ด้วย
    if (lane)         add(`lp.lane_no = $$`, lane);

    if (vehicle_color === 'unknown') where.push(`(lp.vehicle_color = 'unknown' OR lp.vehicle_color IS NULL)`);
    else if (vehicle_color) add(`lp.vehicle_color = $$`, vehicle_color);

    if (plate_color === '__unknown' || plate_color === 'unknown')
      where.push(`(lp.plate_color IS NULL OR lp.plate_color = 'unknown')`);
    else if (plate_color) add(`lp.plate_color = $$`, plate_color);

    // MultiPicker multi-select (csv → ANY). Additive — single params above kept for
    // back-compat. 'unknown'/'__unknown' in the set also matches NULL (mirrors single).
    const csv = (v) => String(v).split(',').map(s => s.trim()).filter(Boolean);
    if (req.query.regions)       { const a = csv(req.query.regions);       if (a.length) add(`lp.region = ANY($$)`, a); }
    if (req.query.vehicle_types) { const a = csv(req.query.vehicle_types); if (a.length) add(`lp.vehicle_type = ANY($$)`, a); }
    if (req.query.lanes)         { const a = csv(req.query.lanes);         if (a.length) add(`lp.lane_no = ANY($$)`, a); }
    if (req.query.vehicle_colors) {
      const a = csv(req.query.vehicle_colors);
      if (a.length) add(a.includes('unknown') ? `(lp.vehicle_color = ANY($$) OR lp.vehicle_color IS NULL)` : `lp.vehicle_color = ANY($$)`, a);
    }
    if (req.query.plate_colors) {
      // '__unknown' is the UI sentinel for "ไม่ทราบ"; the stored plateColor is 'unknown'.
      // Must translate before = ANY(), or it matches the literal '__unknown' (→ 0 rows).
      const a = csv(req.query.plate_colors).map(s => s === '__unknown' ? 'unknown' : s);
      if (a.length) add(a.includes('unknown') ? `(lp.plate_color = ANY($$) OR lp.plate_color IS NULL)` : `lp.plate_color = ANY($$)`, a);
    }
    // vehicle_brands = Hik numeric brand codes ('1060', '0'=ไม่ทราบ); mapped to names client-side.
    if (req.query.vehicle_brands) { const a = csv(req.query.vehicle_brands); if (a.length) add(`lp.vehicle_brand = ANY($$)`, a); }

    if (has_plate === '1') where.push(`lp.plate_number <> 'unknown'`);
    else if (has_plate === '0') where.push(`lp.plate_number = 'unknown'`);

    // lp.detected_at = e.event_time ทุกแถว (ตรวจ 104,249/104,249 ต่างกัน 0.000000s)
    // ใช้ฝั่ง lp เพื่อให้ตัดช่วงได้จาก index ของตารางที่ขับ
    if (from) add(`lp.detected_at >= $$`, from);
    if (to)   add(`lp.detected_at <= $$`, to);

    // dup filter — local (ป้ายซ้ำ ≥2 = ในพื้นที่) / visitor (ป้ายไม่ซ้ำ =1 = ต่างถิ่น).
    // Counts each plate's appearances within the SAME period (from/to) — mirrors the
    // overview KPI. Subquery's from/to get their own placeholders appended after the
    // main args (limit/offset are added last), so positions stay correct.
    const dup = req.query.dup;
    if (dup === 'local' || dup === 'visitor') {
      where.push(`lp.plate_number <> 'unknown'`);
      let periodSub = '';
      if (from) { args.push(from); periodSub += ` AND e2.event_time >= $${args.length}`; }
      if (to)   { args.push(to);   periodSub += ` AND e2.event_time <= $${args.length}`; }
      where.push(`(SELECT COUNT(*) FROM events e2 JOIN license_plates lp2 ON lp2.event_id = e2.id
                    WHERE lp2.plate_number = lp.plate_number AND lp2.plate_number <> 'unknown'${periodSub}) ${dup === 'local' ? '>= 2' : '= 1'}`);
    }

    // mismatch — สงสัยสวมทะเบียน: ป้ายเดียวกัน vehicle_type ต่าง ≥2 ชนิดในช่วงนี้.
    // Period-scoped subquery (args appended after main args, before limit/offset).
    if (req.query.mismatch === '1') {
      where.push(`lp.plate_number <> 'unknown'`);
      // Same-province only (Approach A): a plate read across provinces is an OCR
      // province misread, not a swap — so the type-variance must be within ONE
      // province, and the row itself must have a real province.
      where.push(`lp.region IS NOT NULL AND lp.region <> '' AND lp.region <> 'ไม่ทราบ'`);
      let periodSub = '';
      if (from) { args.push(from); periodSub += ` AND e3.event_time >= $${args.length}`; }
      if (to)   { args.push(to);   periodSub += ` AND e3.event_time <= $${args.length}`; }
      where.push(`(SELECT COUNT(DISTINCT lp3.vehicle_type) FROM events e3 JOIN license_plates lp3 ON lp3.event_id = e3.id
                    WHERE lp3.plate_number = lp.plate_number AND lp3.region = lp.region AND lp3.vehicle_type IS NOT NULL AND lp3.vehicle_type <> 'unknown'${periodSub}) >= 2`);
      // operator-dismissed plates are no longer suspects → drop from the filter
      where.push(`NOT EXISTS (SELECT 1 FROM lpr_mismatch_dismissals d WHERE d.plate_number = lp.plate_number)`);
    }

    // no-helmet — มอเตอร์ไซค์ไม่ใส่หมวก. Parsed to an indexed column at ingest
    // (migration 085, idx_plates_no_helmet) — was a raw_json->> detoast.
    // เจ้าของสั่ง 2026-08-16: ผลลัพธ์เรื่องหมวกนับเฉพาะจักรยานยนต์เท่านั้น
    // สามล้อ/พ่วงข้างไม่ใช่กลุ่มเป้าหมายกวดขัน (ปกติไม่สวมหมวกอยู่แล้ว)
    if (req.query.helmet === 'no') {
      // ตัวกรองในหน้าค้นหาใช้เกณฑ์เดียวกับ KPI — ไม่งั้นกดตัวเลขบนการ์ดแล้ว
      // ได้จำนวนแถวไม่ตรงกับตัวเลขที่กดมา
      where.push(`lp.no_helmet = true AND lp.vehicle_type = 'twoWheelVehicle'`
                 + helmet.evidenceSql('lp'));
    }
    // pillion passenger — มอเตอร์ไซค์มีคนซ้อนท้าย
    if (req.query.passenger === 'yes') where.push(`lp.pillion = 'yes'`);
    // pillion overload — ซ้อนตั้งแต่ 3 คนขึ้นไป (รวมคนขับ). Dahua ITC431-only;
    // parsed to an indexed column at ingest (migration 090, idx_plates_rider_count_3plus).
    if (req.query.passenger === '3plus') where.push(`lp.rider_count >= 3`);
    // seatbelt — ผู้ขับขี่/ผู้โดยสารไม่คาดเข็มขัด. Parsed to an indexed column at
    // ingest (migration 073) — was a rawXml LIKE seq scan. Partial index on the
    // flagged rows; NULL/false read as not-flagged.
    if (req.query.belt === 'no') where.push(`lp.no_seatbelt = true`);

    // ⚠️ คำวัด 2026-08-16 ("subquery 0.52 วิ · ไล่ชื่อกล้อง 6.7 วิ") เป็นจริงเฉพาะ
    // ตอน query ขับจาก events · วัดใหม่ 2026-08-31 หลังสลับมาขับจาก license_plates:
    // กลับด้านสนิท — subquery ทำให้ planner เลือก semi-join ที่เดินตามเวลาแล้วกรอง
    // ทีหลัง (5/15 กรณีทดสอบโดน statement timeout) ส่วนรายชื่อกล้องตรง ๆ ลงที่
    // idx_plates_cam_vtype_time ได้ (13/15 จบใน 0.2–120ms) · จึง resolve รายชื่อ
    // กล้องใน JS ก่อน (query เล็กมาก ตาราง cameras มี ~170 แถว) แล้วส่งเป็น ANY
    if (req.query.sites) {
      const codes = String(req.query.sites).split(',').map(x => x.trim()).filter(Boolean);
      if (codes.length) {
        const { rows: camRows } = await pool.query(
          `SELECT c.id FROM cameras c JOIN sites s ON s.id = c.site_id WHERE s.code = ANY($1)`, [codes]);
        // ไซต์ที่ไม่มีกล้อง = ผลว่างโดยเจตนา ('__none__' ไม่มีวัน match) — ห้ามตกไป
        // เป็น "ไม่กรอง" เงียบ ๆ ซึ่งจะโชว์ของทุกไซต์ทั้งที่ผู้ใช้เลือกไซต์เดียว
        add(`lp.camera_id = ANY($$)`, camRows.length ? camRows.map(r => r.id) : ['__none__']);
      }
    }

    // Site-RBAC P2
    const swLpr = siteWhere(req.user?.allowedSites ?? null, 'lp.camera_id', args.length + 1);
    if (swLpr.sql) { where.push(swLpr.sql.replace(/^AND /, '')); args.push(...swLpr.args); }
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // P1 keyset pagination — a cursor (before_time, before_id) seeks the index
    // instead of OFFSET scanning+discarding. Appended ONLY to the page query, not
    // to the estimate (which counts all rows matching the filters). Stable tie-break
    // on id. Legacy `offset` still honoured for the latest-grid / CSV callers (which
    // always pass offset 0), so this is backward-compatible.
    let pageWhere = wc, pageArgs = [...args];
    if (req.query.before_time && req.query.before_id) {
      pageArgs.push(req.query.before_time, req.query.before_id);
      const p1 = pageArgs.length - 1, p2 = pageArgs.length;
      pageWhere = (wc ? wc + ' AND ' : 'WHERE ') + `(lp.detected_at, lp.id) < ($${p1}, $${p2}::bigint)`;
    }
    const fetchLimit = limit + 1;  // +1 row → know hasMore without a COUNT

    try {
      // จำนวนผลลัพธ์ = ค่าประมาณจาก planner (ไม่สแกนจริง)
      // เคยลองเปลี่ยนเป็น "นับจริงแบบมีเพดาน" แล้ววัดได้ 13–19 วินาที เพราะแผน query
      // ที่มี cameras = ANY(...) ไม่หยุดตาม LIMIT จริง ๆ — ช้ากว่าเดิมมาก จึงถอยกลับ
      // ⚠️ ค่านี้ผิดได้หลายเท่าเมื่อเงื่อนไขสัมพันธ์กัน (วัดจริง 2026-08-16: ของจริง 49,649
      //    planner ว่า 8,081) หน้าจอจึงต้องเขียนให้ชัดว่าเป็นค่าประมาณ ห้ามโชว์เป็นยอดจริง
      //    การ์ดสรุปด้านบนของหน้าภาพรวมต่างหากที่เป็นยอดนับจริง
      let estimate = null, countExact = false;
      // ?count=only = คำขอนับอย่างเดียว มาจากหน้าจอที่ยิงแยกหลังจากตารางขึ้นแล้ว
      // จึงให้เวลามากกว่า เพราะไม่มีใครนั่งรอหน้าเปล่า ๆ อยู่ — ได้เลขจริงบ่อยขึ้นมาก
      const countOnly = req.query.count === 'only';
      // นับจริงก่อน โดยตั้งเพดานเวลา — ถ้าเงื่อนไขทำให้แผน query แพง ให้ยอมแพ้แล้วถอย
      // ไปใช้ค่าประมาณ ดีกว่าให้ผู้ใช้รอสิบวินาที · ค่าประมาณเพี้ยนได้หลายเท่า จึงเป็น
      // ทางเลือกสุดท้าย ไม่ใช่ค่าเริ่มต้นเหมือนเดิม
      const COUNT_TIMEOUT_MS = countOnly ? 12000 : 3000;
      const countExactP = (req.query.count === 'est' || countOnly)
        ? (async () => {
            const c = await pool.connect();
            // ผู้ใช้เปลี่ยนตัวกรอง/ออกจากหน้า = ยกเลิกคิวรีนี้ที่ DB — ทำที่จุดเดียวทุก GET แล้ว (helpers/requestDb.js · GOTCHAS #232/#234)
            try {
              await c.query('BEGIN');
              await c.query(`SET LOCAL statement_timeout = ${COUNT_TIMEOUT_MS}`);
              // JOIN events เฉพาะเมื่อ WHERE อ้าง e จริง (event_id) — ทุกแถว lp มี event คู่เสมอ
              // (retention ลบลูกก่อนแม่ · ตรวจ 7 วัน 5,806,229 แถว ไม่มีแถวกำพร้า 0) ผลเท่าเดิม
              // วัด 3 กล้อง 3 วัน สลับลำดับ 2 รอบ: JOIN 21.4/20.5 วิ · ไม่ JOIN 19.1/12.8 วิ (ยอดเท่ากัน 311,373)
              // ยังเกินเพดาน 12 วิ — ตัวแก้จริงคือ index (camera_id, detected_at) (O3/O4)
              // กรองแค่ กล้อง/ไซต์/เวลา → ยอดจากตารางสรุปรายชั่วโมง + นับสดเฉพาะเศษหัว/ท้าย (helpers/lprRollupCount.js)
              // ตรวจ 2026-10-21 ใน snapshot เดียวกัน 5 แบบ ตรงทุกหลัก · ไซต์ hkt ไม่มีเวลา 7.3 วิ → 0.07 วิ
              const { rows: [{ m: platesMin }] } = await c.query('SELECT min(detected_at) AS m FROM license_plates');
              const ru = buildRollupCount({ where, args, from, to, hasEventFilter,
                platesMin: platesMin ? new Date(platesMin).toISOString() : null });
              // ไม่มีช่วงเวลา + ใช้ตารางสรุปไม่ได้ (เช่น กรองประเภทรถ/ยี่ห้อ) = สแกนทั้งตารางจนชนเพดาน 12 วิ แล้วก็ได้ null
              // (16:57–16:59 2026-10-21: 8 ครั้ง ครั้งละ 12 วิ) · ลดเพดานเหลือ 3 วิ — ตัวกรองที่เลือกแคบพอ (เช่นเลขทะเบียน
              // ที่มี index) ยังนับทันตามเดิม · หน้าจอแสดง "มากกว่า N · แคบช่วงเวลาลง" อยู่แล้วเมื่อนับไม่ทัน
              if (!ru && !from) await c.query(`SET LOCAL statement_timeout = 3000`);
              const r = ru ? await c.query(ru.sql, ru.args) : await c.query(
                `SELECT count(*)::int AS n FROM license_plates lp
                   ${hasEventFilter ? 'JOIN events e ON e.id = lp.event_id' : ''} ${wc}`, args);
              await c.query('COMMIT');
              return r.rows[0].n;
            } catch { try { await c.query('ROLLBACK'); } catch {} return null; }
            finally { c.release(); }
          })()
        : Promise.resolve(null);

      if (countOnly) {
        const n = await countExactP;
        return res.json({ n, exact: n != null });
      }

      // ── ด่าน probe กัน "เดินตามเวลาแล้วไม่มีวันเจอ" (2026-08-31) ──────────
      // ORDER BY เวลา + LIMIT จะหยุดก่อนกำหนดได้ก็ต่อเมื่อเก็บแถวครบ · เงื่อนไขที่
      // "แทบไม่มีในไซต์นี้แต่มีมากที่ไซต์อื่น" (วัดจริง: hdy+buggy — buggy ทั้งหมดอยู่
      // hkt) ทำให้ index ตามประเภทกวาดของไซต์อื่นทิ้ง 80k แถว = 23 วินาที แม้ index
      // ครบ · จึงยิง probe แบบไม่เรียงก่อน: planner เลือก bitmap จาก
      // idx_plates_cam_vtype_time ได้อิสระ (วัดแล้ว 0.5–7ms ทุกเคสรวมเคสฆาตกร)
      //  - ได้ ≤ limit แถว = เห็นผลลัพธ์ "ทั้งหมด" แล้ว → เติม lp.id = ANY(...) เข้า
      //    query หลัก ซึ่งเหลือแค่ probe ด้วย pk ไม่กี่สิบครั้ง + sort ในหน่วยความจำ
      //  - ได้เกิน limit = หนาแน่นพอ การเดินตามเวลาหยุดเร็วอยู่แล้ว → เดินทางเดิม
      // ⚠️ ใช้ได้เฉพาะ WHERE ที่อยู่บน lp ล้วน (hasEventFilter=false) — subquery ของ
      //    dup/mismatch อ้าง lp.plate_number จากข้างนอกและมี FROM ของตัวเอง จึงนับว่า
      //    lp-pure · ข้อจำกัดที่เหลือ: ประเภทที่ "มี >limit แถวแต่เก่ามาก" ยังต้องเดิน
      //    ตามเวลาไกล — ขอบเขตคืออายุข้อมูลจริง ไม่ใช่ไม่มีที่สิ้นสุด
      if (!hasEventFilter) {
        try {
          let ids = null;
          const probe = await pool.query(
            `SELECT lp.id FROM license_plates lp ${pageWhere} LIMIT ${fetchLimit + offset}`,
            pageArgs);
          if (probe.rows.length <= limit + offset) ids = probe.rows;
          // เฉพาะเมื่อกรองจังหวัด และตัวกรองทั้งหมดอยู่ใน PROBE2_KEYS: idx_plates_region_time มี camera_id, id
          // ในตัว ⇒ ด่านนี้อ่านจาก index อย่างเดียว · ตัวกรองอื่น (สีรถ ฯลฯ) ต้องอ่าน heap ทุกแถวของจังหวัด
          // จนชนเพดานเวลาเปล่า ๆ (วัด: สีม่วง 165 → 1,663 ms · กรุงเทพฯ+สีม่วง 1.5 → 2.9 วิ)
          else if ((region || req.query.regions) && Object.entries(req.query)
                     .every(([k, v]) => PROBE2_KEYS.has(k) || v === '' || v == null)) {
            // ด่านที่สอง (2026-10-07): "มีเกินหนึ่งหน้า" ไม่ได้แปลว่าหนาแน่น — กล้อง C2-TCC + จังหวัดนราธิวาส
            // มี 217 แถวกระจายทั้ง 100 วัน การเดินตามเวลาไล่ทิ้ง 21.8 ล้านแถว = 173 วิ (ผู้ใช้ phuket โดน
            // timeout 3 ครั้ง 7 ต.ค.) · เก็บ id ได้ถึง PROBE_CAP แถวภายใน PROBE2_MS ⇒ ใช้ชุด id (ดึงตาม pk + เรียง)
            // เกินเพดานหรือหมดเวลา = หนาแน่นจริง → เดินตามเวลาเหมือนเดิม (เสียเพิ่มไม่เกิน PROBE2_MS)
            const c = await pool.connect();
            try {
              await c.query('BEGIN');
              await c.query(`SET LOCAL statement_timeout = ${PROBE2_MS}`);
              const p2 = await c.query(
                `SELECT lp.id FROM license_plates lp ${pageWhere} LIMIT ${PROBE_CAP + 1}`, pageArgs);
              await c.query('COMMIT');
              if (p2.rows.length <= PROBE_CAP) ids = p2.rows;   // ครบทั้งชุดแล้ว — offset ใดก็แบ่งหน้าได้ถูก
            } catch { await c.query('ROLLBACK').catch(() => {}); }
            finally { c.release(); }
          }
          if (ids) {
            pageArgs.push(ids.map(r => r.id));
            pageWhere = (pageWhere ? pageWhere + ' AND ' : 'WHERE ')
                      + `lp.id = ANY($${pageArgs.length})`;
          }
        } catch (e) { console.warn('[lpr-query] probe skipped:', e.message); }
      }

      // 🔴 ขับจาก license_plates ไม่ใช่ events (แก้ 2026-08-31 — เจ้าของแจ้ง
      // "เลือกประเภทรถแล้วค้าง"): ตัวกรองทุกตัวของฟอร์มอยู่บน lp ทั้งหมด ขับจาก
      // ตารางที่กรองได้ = เหลือแถวน้อยก่อน แล้วค่อย probe events ด้วย pk เอาคอลัมน์
      // ไปแสดง (สูงสุด limit+1 ครั้ง) · ของเดิมเดิน events 33 ล้านแถวที่ partition
      // ไว้แล้วเช็ค join ทีละแถว — เงื่อนไขที่หายาก (largeBus ที่ไซต์ Dahua) ทำให้
      // LIMIT ไม่มีวันเต็ม ไม่มีจุดหยุด จึงกวาดจนหมดประวัติ >120 วิ · หลังสลับ:
      // 13/15 กรณี (5 ไซต์ × 3 ประเภท) จบใน 0.2–120ms
      // ⚠️ ORDER BY ต้องเป็นคอลัมน์ของ lp ล้วน — ผสม lp.detected_at กับ e.id เมื่อไหร่
      //    planner เลิก early-exit ทันที (วัดแล้ว: กลับไป cancel 4/5 ไซต์)
      const rowsP = pool.query(
        `SELECT e.id, lp.id AS lp_row_id, e.camera_id, e.event_time, e.event_type,
                e.snapshot_filename AS snapshot_file,
                ${isExport
                  // raw_json มี rawXml ~2,000 ตัวอักษรต่อแถว — 12,000 แถวคือหลายสิบเมกะไบต์
                  // CSV ใช้แค่ 3 ค่า จึงหยิบเฉพาะที่ใช้ ไม่ลากทั้งก้อนข้ามเน็ต
                  ? `jsonb_build_object('plateColor', e.raw_json->>'plateColor',
                                        'laneNo', e.raw_json->>'laneNo',
                                        'region', e.raw_json->>'region') AS raw_json`
                  // ⚠️ non-admin ได้ rawXml ที่ปิดบัง <ipAddress>/<ipv6Address>/
                  // <macAddress> ของกล้องแล้ว (security backlog 2026-08-12 · S1 —
                  // เจ้าของสั่ง) · auditor นับเป็น non-admin ด้วย · admin ยังได้
                  // ของเต็มไว้ debug · scrub ใน SQL เพราะ SELECT list ตรงนี้เขียน
                  // คอลัมน์ไว้ชัดอยู่แล้ว ไม่ต้องวนแก้ทีละแถว
                  : (req.user?.role === 'admin' ? 'e.raw_json' : `${scrubRawJsonSql('e.raw_json')} AS raw_json`)},
                lp.plate_number, lp.region AS lp_region,
                lp.vehicle_type AS lp_vehicle_type,
                lp.vehicle_color AS lp_vehicle_color,
                lp.vehicle_brand AS lp_vehicle_brand,
                lp.plate_image, lp.confidence,
                lp.bbox_x, lp.bbox_y, lp.bbox_width, lp.bbox_height,
                lp.vehicle_bbox_x, lp.vehicle_bbox_y, lp.vehicle_bbox_width, lp.vehicle_bbox_height
         FROM license_plates lp
         JOIN events e ON e.id = lp.event_id
         ${pageWhere}
         ORDER BY lp.detected_at DESC, lp.id DESC
         LIMIT $${pageArgs.length + 1} OFFSET $${pageArgs.length + 2}`,
        [...pageArgs, fetchLimit, offset]
      );
      const [rows, exactN] = await Promise.all([rowsP, countExactP]);
      // นับไม่ทัน = ไม่ส่งตัวเลขเลย ไม่ใช่ส่งค่าประมาณ — ค่าประมาณของ planner เพี้ยน
      // ระดับสิบเท่า (วัดจริง: ทุก Site 1 สัปดาห์ → ว่า 6,057,425) การโชว์ตัวเลขที่ผิด
      // ขนาดนั้นแย่กว่าไม่โชว์ · หน้าจอจะแสดง "มากกว่า N" จากแถวที่เปิดดูมาแล้วจริงแทน
      if (exactN != null) { estimate = exactN; countExact = true; }
      const hasMore = rows.rows.length > limit;
      const result = hasMore ? rows.rows.slice(0, limit) : rows.rows;
      // Plate-swap badge enrichment — per-plate over a FIXED 30d window, keyed ONLY
      // on the returned plate-set. Deliberately does NOT reuse the search WHERE:
      // reusing it would mean filtering by vehicle_type collapses each plate to a
      // single type and silently kills swap detection exactly when it matters.
      const plates = [...new Set(result.map(r => r.plate_number).filter(p => p && p !== 'unknown'))];
      // ไฟล์ CSV ไม่มีคอลัมน์ "ควรตรวจสอบ" อยู่แล้ว — การไปคิดธงสวมทะเบียนให้ 12,000 แถว
      // จึงเป็นงานเปล่าที่ทำให้ export ช้าและอาจ timeout
      if (plates.length && !isExport) {
        const { rows: mm } = await pool.query(
          // Per (plate, region), then take the province with the most type-variance
          // — cross-province reads (province misread) don't inflate the badge level.
          `WITH pr AS (
             SELECT lp.plate_number,
                    -- สองล้อกับสามล้อนับเป็นชนิดเดียวกัน: มอเตอร์ไซค์พ่วงข้าง/ซาเล้ง
                    -- ทำให้กล้องอ่านสลับไปมาเป็นปกติ ไม่ใช่สัญญาณว่าสวมทะเบียน
                    -- (2กถ1909 อ่านเป็นสองล้อ 171 ครั้ง สามล้อ 16 ครั้ง — คันเดียวกัน
                    --  มีถังพ่วงข้าง) · กรณีแบบนี้ = 2.6% ของธงทั้งหมดใน 30 วัน
                    COUNT(DISTINCT CASE WHEN lp.vehicle_type IN ('twoWheelVehicle','threeWheelVehicle')
                                        THEN 'moto' ELSE lp.vehicle_type END)
                      FILTER (WHERE lp.vehicle_type  IS NOT NULL AND lp.vehicle_type  <> 'unknown') AS nt,
                    COUNT(DISTINCT lp.vehicle_color) FILTER (WHERE lp.vehicle_color IS NOT NULL AND lp.vehicle_color <> 'unknown') AS nc,
                    COUNT(DISTINCT lp.vehicle_brand) FILTER (WHERE lp.vehicle_brand IS NOT NULL AND lp.vehicle_brand <> 'unknown' AND lp.vehicle_brand <> '') AS nb
               FROM events e JOIN license_plates lp ON lp.event_id = e.id
              WHERE lp.plate_number = ANY($1) AND e.event_time >= NOW() - INTERVAL '30 days'
                AND lp.region IS NOT NULL AND lp.region <> '' AND lp.region <> 'ไม่ทราบ'
              GROUP BY lp.plate_number, lp.region
           )
           SELECT DISTINCT ON (plate_number) plate_number, nt, nc, nb
             FROM pr ORDER BY plate_number, nt DESC, (nc + nb) DESC`,
          [plates]
        );
        const lvl = {};
        for (const m of mm) {
          const nt = +m.nt;  // level 0 unless vehicle_type itself differs (>=2)
          lvl[m.plate_number] = nt >= 2 ? 1 + (+m.nc >= 2 ? 1 : 0) + (+m.nb >= 2 ? 1 : 0) : 0;
        }
        // Operator dismissals (per-plate). Keep mismatch_level RAW — the badge/KPI/
        // filter treat dismissed plates as not-suspect, but the modal still shows the
        // comparison + a re-arm button, so we expose dismissed separately.
        const { rows: dis } = await pool.query(
          `SELECT plate_number, dismissed_by, dismissed_at FROM lpr_mismatch_dismissals WHERE plate_number = ANY($1)`,
          [plates]);
        const disMap = {};
        for (const d of dis) disMap[d.plate_number] = d;
        for (const r of result) {
          r.mismatch_level = lvl[r.plate_number] || 0;
          const d = disMap[r.plate_number];
          r.mismatch_dismissed = !!d;
          if (d) { r.mismatch_dismissed_by = d.dismissed_by; r.mismatch_dismissed_at = d.dismissed_at; }
        }
      }
      res.set('X-Has-More', hasMore ? '1' : '0');
      if (estimate != null) {
        res.set('X-Estimated-Count', String(Math.max(0, Math.round(estimate))));
        res.set('X-Count-Exact', countExact ? '1' : '0');
      }
      res.json(result);
    } catch (e) {
      console.error('[lpr-query] GET /api/lpr:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });
}

// กลุ่มที่ 2 — plate-history · no-read · mismatch dismiss
// ลงทะเบียนต่อจาก GET /api/lpr/brands
function registerPlateHistoryAndMismatch(app, pool) {
  // GET /api/lpr/plate-history?plate=X — recent reads of one plate for the
  // mismatch comparison modal: surfaces the temporal sequence (รอบก่อน → รอบนี้).
  // Optional params (default = old behaviour, unused by the mismatch caller so
  // it stays byte-identical): region (exact-province match, for the repeat-plate
  // modal — a plate read in another province is an OCR misread, not the same
  // repeat), hours (window, default 720=30d), limit (default 50).
  app.get('/api/lpr/plate-history', async (req, res) => {
    const plate = String(req.query.plate || '').trim();
    if (!plate || plate === 'unknown') return res.json([]);
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 720, 1), 720);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 50);
    const region = req.query.region ? String(req.query.region).trim() : null;
    try {
      const args = [plate, hours];
      let regionSql = '';
      if (region) { args.push(region); regionSql = ` AND lp.region = $${args.length}`; }
      const swPh = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', args.length + 1);
      const { rows } = await pool.query(
        // no_helmet / plate_color / ชื่อจุดติดตั้ง เพิ่ม 2026-08-16 — ตารางประวัติใน modal
        // ปรับคอลัมน์ตามประเภทรถ (มอเตอร์ไซค์โชว์หมวก · รถ 4 ล้อโชว์สี/ยี่ห้อ)
        // เหตุผล: วัดจริง 7 วัน — มอเตอร์ไซค์มียี่ห้อ 0.0% แต่รถเก๋งมี 87-99%
        // ส่วน no_helmet ติดธงเฉพาะรถ 2-3 ล้อ รถ 4 ล้อเป็น 0.0% ทุกประเภท
        `SELECT e.id, e.event_time, e.camera_id,
                e.snapshot_filename AS snapshot_file,
                lp.vehicle_type, lp.vehicle_color, lp.vehicle_brand, lp.plate_image, lp.region,
                lp.no_helmet, lp.plate_color,
                coalesce(c.name, e.camera_id) AS camera_name
           FROM events e JOIN license_plates lp ON lp.event_id = e.id
           LEFT JOIN cameras c ON c.id = e.camera_id
          WHERE lp.plate_number = $1 AND e.event_time >= NOW() - make_interval(hours => $2::int)${regionSql} ${swPh.sql}
          ORDER BY e.event_time DESC
          LIMIT ${limit}`,
        [...args, ...swPh.args]
      );
      res.json(rows);
    } catch (e) {
      console.error('[lpr-query] GET /api/lpr/plate-history:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/no-read — ANPR events the camera couldn't read a plate for.
  // "ไม่ทราบทะเบียน" tab (2026-07-18, precedent: the สภ.หาดใหญ่ LPRMonitor
  // reference system shows these too).
  //
  // 🔴 สองยี่ห้อรายงาน "อ่านไม่ออก" คนละรูป — แท็บนี้ต้องรับทั้งคู่ (2026-09-08):
  //   · Dahua (hdy/nrw/rmutr-v) — ไม่มีฟิลด์ `plate` มาเลย และไม่มีแถวใน license_plates
  //   · Hikvision (hkt)         — ส่ง `plate = "unknown"` มา **และ** สร้างแถวใน
  //     license_plates ที่ plate_number = 'unknown'
  //   บันทึกเก่าที่ว่า "Dahua only · Hikvision drops these events entirely upstream"
  //   **ผิด** — hkt มี 12,397 เหตุการณ์ใน 24 ชม. ที่แท็บนี้ไม่เคยแสดงเลย
  //   ⇒ ขา `plate = 'unknown'` ไม่ใช่โค้ดตาย ห้ามถอดทิ้ง
  //   หมายเหตุ: แถวของ Hikvision จะไม่มี category/color/brand ให้แสดง เพราะตัว
  //   mapper ข้างล่างอ่าน raw_json->'data'->'Vehicle' ซึ่งเป็นรูปของ Dahua
  //
  // Deliberately queried straight off `events`, NEVER joined into
  // license_plates: these rows must stay out of every plate-keyed query
  // (mismatch/repeat-history/dup group by plate_number+region — a shared
  // NULL/'unknown' sentinel across 800+/day rows would collapse them into
  // one fake mega-group and corrupt those features).
  //
  // Perf 2026-09-06: เลิกใช้ anti-join กับ license_plates ทั้งหมด — "ไม่มีแถวคู่ใน
  // license_plates" เท่ากับ "raw_json->>'plate' ว่าง" พอดี วัดจริงบน central
  // นับสองทาง (ไม่ใช่แค่จำนวนเท่ากัน): 24 ชม. 19,637 = 19,637 · 7 วัน
  // 156,201 = 156,201 · ต่างกัน 0 แถวทั้งสองทิศทั้งสองหน้าต่าง.
  // predicate นี้ index ได้ (anti-join index ไม่ได้) → partial index
  // idx_events_anpr_noread_time (migration 199 + scripts/create-face-blacklist-index.js
  // --index=anpr_noread) ซึ่ง ORDER BY ด้านล่างตรงกับคอลัมน์ของดัชนีพอดี
  // ⚠️ ความเท่ากัน "anti-join = plate ว่าง" ข้างบนเป็นจริงเฉพาะฝั่ง Dahua —
  //    ตั้งแต่ 2026-09-08 predicate มีขาที่สอง (plate='unknown') ซึ่ง **มี** แถวใน
  //    license_plates ⇒ ห้ามย้อนกลับไปใช้ anti-join แทน มันจะทิ้ง hkt ทั้งหมด
  //    ขาที่สองมีดัชนีของตัวเอง: idx_events_anpr_unknown_time (--index=anpr_unknown)
  // ⚠️ ข้อความ predicate ต้องเหมือนกับดัชนีเป๊ะ (ต่างได้แค่ alias e.) — Postgres
  //    จับคู่ partial index จาก expression tree เขียนต่างเมื่อไหร่ planner เลิกใช้เงียบ ๆ
  // หมายเหตุ: บันทึกเก่า "7 วัน ≈ 38 วินาที / มัดขอบ detected_at ±1 ชม." ตกไปแล้ว
  // ทั้งคู่ — ขอบ ±1 ชม. มีไว้เพื่อ anti-join เท่านั้น ตอนนี้ไม่มี anti-join แล้ว
  // ยังคง default ย้อนหลัง 24 ชม. ไว้: ตัวกรอง e.event_time คือขอบเขตของ query
  app.get('/api/lpr/no-read', async (req, res) => {
    const { to } = req.query;
    // default window 24 ชม. — ต้องมีขอบเสมอ ไม่งั้น query สแกนทั้งตาราง
    const from = req.query.from || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const limit  = Math.min(parseInt(req.query.limit,  10) || 30, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0,   0);

    const where = [`e.event_type = 'anprAlarm'`];
    const args  = [];
    const add = (clause, val) => { args.push(val); where.push(clause.replace('$$', `$${args.length}`)); };

    if (req.query.cameras) {
      const arr = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length) add(`e.camera_id = ANY($$)`, arr);
    }
    add(`e.event_time >= $$::timestamptz`, from);
    if (to) add(`e.event_time <= $$::timestamptz`, to);

    // 🔴 ต้องเป็น OR สองขา **ห้ามเขียนเป็น IN ('', 'unknown')** — มีดัชนีบางส่วน
    //    สองตัวรองรับคนละขา (idx_events_anpr_noread_time · idx_events_anpr_unknown_time
    //    สร้างจริง 2026-09-08) · เขียนเป็น OR planner ต่อ BitmapOr ใช้ได้ทั้งคู่
    //    เขียนเป็น IN planner เลิกใช้ทั้งคู่เงียบ ๆ · วัดจริงคิวรีเดียวกัน 24 ชม.:
    //      OR                →   98.9 ms
    //      IN ('','unknown') → 2,439   ms
    //    เหตุผลเดียวกับ migration 199 — Postgres จับคู่ partial index จาก
    //    expression tree ข้อความจึงต้องตรงกับ WHERE ของดัชนีเป๊ะ (ต่างได้แค่ alias e.)
    where.push(`(COALESCE(e.raw_json->>'plate','') = '' OR e.raw_json->>'plate' = 'unknown')`);

    const swNr = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', args.length + 1);
    if (swNr.sql) { where.push(swNr.sql.replace(/^AND /, '')); args.push(...swNr.args); }
    const wc = 'WHERE ' + where.join(' AND ');

    try {
      const { rows: cnt } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM events e ${wc}`, args);
      const total = cnt[0]?.n || 0;

      const { rows } = await pool.query(
        `SELECT e.id, e.camera_id, e.event_time,
                e.snapshot_filename AS snapshot_file,
                e.raw_json->'data'->'Vehicle' AS vehicle
           FROM events e
           ${wc}
           ORDER BY e.event_time DESC, e.id DESC
           LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, limit, offset]
      );

      const out = rows.map(r => {
        const v = r.vehicle || {};
        const category = v.Category || null;
        const vehicle_type = DAHUA_CATEGORY_TO_HIK_VTYPE[category] || null;
        const rawBrand = (typeof v.Text === 'string' && v.Text.trim()) || null;
        const vehicle_brand = (!rawBrand || DAHUA_BRAND_UNKNOWN.has(rawBrand)) ? null : (DAHUA_BRAND_FIX[rawBrand] || rawBrand);
        const vehicle_color = dahuaRgbaToName(v.MainColor, xyzToColorName);
        const confidence = Number.isFinite(v.Confidence) ? Math.round((v.Confidence / 255) * 100) : null;
        return {
          id: r.id, camera_id: r.camera_id, event_time: r.event_time,
          snapshot_file: r.snapshot_file,
          plate_number: null, lp_region: null,
          lp_vehicle_type: vehicle_type, lp_vehicle_color: vehicle_color,
          lp_vehicle_brand: vehicle_brand, plate_image: null,
          confidence, raw_json: {},
        };
      });
      res.set('X-Total-Count', String(total));
      res.json(out);
    } catch (e) {
      console.error('[lpr-query] GET /api/lpr/no-read:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /api/lpr/mismatch/:plate/dismiss — operator marks a plate's swap-suspect
  // as a false positive (e.g. OCR misread plate/province). DELETE re-arms it.
  // Per-plate, audited (who/when/why). Dismissed plates drop from KPI/badge/filter.
  app.post('/api/lpr/mismatch/:plate/dismiss', async (req, res) => {
    const plate = String(req.params.plate || '').trim();
    if (!plate || plate === 'unknown') return res.status(400).json({ error: 'bad_plate' });
    const reason = (req.body && req.body.reason) ? String(req.body.reason).slice(0, 500) : null;
    try {
      const r = await pool.query(
        `INSERT INTO lpr_mismatch_dismissals (plate_number, dismissed_by, dismissed_by_id, dismissed_at, reason)
              VALUES ($1, $2, $3, now(), $4)
         ON CONFLICT (plate_number) DO UPDATE
              SET dismissed_by = EXCLUDED.dismissed_by, dismissed_by_id = EXCLUDED.dismissed_by_id,
                  dismissed_at = now(), reason = EXCLUDED.reason
         RETURNING dismissed_by, dismissed_at`,
        [plate, req.user?.username || null, req.user?.id || null, reason]);
      res.json({ plate_number: plate, dismissed: true, ...r.rows[0] });
    } catch (e) {
      console.error('[lpr-query] POST mismatch dismiss:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/lpr/mismatch/:plate/dismiss', async (req, res) => {
    const plate = String(req.params.plate || '').trim();
    if (!plate) return res.status(400).json({ error: 'bad_plate' });
    try {
      await pool.query('DELETE FROM lpr_mismatch_dismissals WHERE plate_number = $1', [plate]);
      res.json({ plate_number: plate, dismissed: false });
    } catch (e) {
      console.error('[lpr-query] DELETE mismatch dismiss:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // รถบรรทุกวิ่งในช่วงห้าม — Reject รายป้าย = ไม่ต้องแจ้งป้ายนี้อีก (เจ้าของสั่ง 2026-10-26 · migration 281)
  // ระบบแยกจำนวนเพลา/ล้อไม่ได้ ⇒ คนเป็นตัวกรองชั้นสุดท้าย (รถบรรทุกเล็ก/หกล้อ/ได้รับอนุญาต)
  // อ่านได้ทุกคนที่เห็นหน้า LPR · เขียนได้เฉพาะ admin/site_admin — viewer กดแล้วป้ายหายจากรายการของทุกคน
  // kind 'defer' (ไม่แน่ใจ · migration 286) ถูกตัดออกจากตัวเลขทุกจุดเหมือน reject แต่ยังเห็นป้าย/นับครั้ง/เปิดภาพได้จากกล่อง "ไม่แน่ใจ"
  const canReject = (u) => u && (u.role === 'admin' || u.role === 'site_admin');
  app.get('/api/lpr/truck-ban/rejections', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT plate_number, kind, reason, rejected_by, rejected_at FROM truck_ban_rejections ORDER BY rejected_at DESC');
      res.json(rows);
    } catch (e) {
      console.error('[lpr-query] GET truck-ban rejections:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/lpr/truck-ban/rejections/:plate', async (req, res) => {
    if (!canReject(req.user)) return res.status(403).json({ error: 'Admin role required for this operation' });
    const plate = String(req.params.plate || '').trim();
    if (!plate || plate === 'unknown' || plate.length > 32) return res.status(400).json({ error: 'bad_plate' });
    const reason = (req.body && req.body.reason) ? String(req.body.reason).slice(0, 500) : null;
    // kind: 'reject' (ซ่อนถาวร · ค่าเริ่มต้น) | 'defer' (ไม่แน่ใจ — migration 286) · ป้ายที่มีแถวอยู่แล้ว = สลับชนิดได้ทั้งสองทาง (upsert)
    const kind = req.body && req.body.kind != null ? req.body.kind : 'reject';
    if (kind !== 'reject' && kind !== 'defer') return res.status(400).json({ error: 'bad_kind' });
    try {
      const r = await pool.query(
        `INSERT INTO truck_ban_rejections (plate_number, kind, reason, rejected_by, rejected_by_id, rejected_at)
              VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (plate_number) DO UPDATE
              SET kind = EXCLUDED.kind, reason = EXCLUDED.reason, rejected_by = EXCLUDED.rejected_by,
                  rejected_by_id = EXCLUDED.rejected_by_id, rejected_at = now()
         RETURNING plate_number, kind, reason, rejected_by, rejected_at`,
        [plate, kind, reason, req.user?.username || null, req.user?.id || null]);
      res.json({ rejected: kind === 'reject', ...r.rows[0] });
    } catch (e) {
      console.error('[lpr-query] POST truck-ban reject:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── รถบรรทุกวิ่งในช่วงห้าม: ตัวนับฝั่งเซิร์ฟเวอร์ (กราฟย้อนหลัง · รายเดือน · 24 ชม.) ─────────────────────
  // เกณฑ์เดียวกับหน้า demo: ป้ายหมวด 50–99 (6 หลัก) / 500–999 (7 หลัก) · truck (light=1 รวม buggy = รถบรรทุกเล็ก) ·
  // เฉพาะกล้อง LPR · ตัดป้ายที่ Reject แล้ว · วันหยุด/เสาร์–อาทิตย์ หน้าเว็บเป็นคนตัดสิน (ตอบทุกวันให้เห็นเทียบ)
  // ⚠️ รายชื่อกล้องต้อง resolve ใน JS แล้วส่งเป็น literal — ANY(subquery) วัดได้ 16.5 วิ · literal 0.26 วิ (เดือน ต.ค. ไซต์ hkt)
  // sqlOf รับ WHERE ของแถว license_plates ($1 กล้อง · $2 ประเภท · $3–$4 ช่วงเวลา) คืน SQL เต็ม · ไม่มีกล้อง = null
  // scope = req.user.allowedSites ส่งมาจาก handler เอง (เห็นที่จุดเรียก + scripts/check-events-queries.js ตรวจได้)
  // extra = พารามิเตอร์เพิ่มของ sqlOf เริ่มที่ $5 · allCams = $1 เป็นกล้อง LPR ทั้งไซต์ (ตัวเลือกกล้องให้ sqlOf กรองเอง)
  // withMarked = ไม่ตัดป้ายที่มีแถวใน truck_ban_rejections (ทั้ง reject และ defer) — ใช้กับกล่อง "ไม่แน่ใจ/ซ่อนแล้ว" และดูภาพของป้ายเหล่านั้นเท่านั้น
  async function truckBanQuery(req, scope, a, b, sqlOf, { extra = [], allCams = false, withMarked = false } = {}) {
    const vt = req.query.light === '1' ? ['truck', 'buggy'] : ['truck'];
    const { rows: siteCams } = await pool.query(
      // เฉพาะกล้อง LPR — ตรงกับตัวเลือกกล้องในหน้า demo (cam_role มีค่าครบทุกไซต์ ตรวจ 2026-10-26)
      "SELECT c.id FROM cameras c JOIN sites s ON s.id = c.site_id WHERE s.code = $1 AND c.cam_role = 'lpr'",
      [String(req.query.site || 'hkt')]);
    let cams = siteCams.map((r) => r.id);
    if (req.query.cameras && !allCams) {
      const want = new Set(String(req.query.cameras).split(',').map((s) => s.trim()).filter(Boolean));
      cams = cams.filter((c) => want.has(c));
    }
    if (!cams.length) return null;
    const args = [cams, vt, a, b, ...extra];
    const sw = siteWhere(scope, 'lp.camera_id', args.length + 1);
    args.push(...sw.args);
    const where = `lp.camera_id = ANY($1::text[]) AND lp.vehicle_type = ANY($2::text[])
                      AND lp.detected_at >= $3 AND lp.detected_at < $4
                      AND (lp.plate_number || '') ~ '^[5-9][0-9]{5,6}$'
                      ${withMarked ? '' : 'AND NOT EXISTS (SELECT 1 FROM truck_ban_rejections r WHERE r.plate_number = lp.plate_number)'}
                      ${sw.sql}`;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL statement_timeout = 20000');
      const { rows } = await c.query(sqlOf(where), args);
      await c.query('COMMIT');
      return rows;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  }
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const thaiDayStart = (d) => new Date(`${d}T00:00:00+07:00`).toISOString();
  const thaiDayEnd = (d) => new Date(Date.parse(`${d}T00:00:00+07:00`) + 86400000).toISOString();

  // GET /api/lpr/truck-ban/daily?from=YYYY-MM-DD&to=YYYY-MM-DD[&site=hkt][&cameras=a,b][&light=1]
  // กราฟ "ย้อนหลัง" + "รายเดือน": ป้ายไม่ซ้ำต่อวัน ต่อช่วงห้าม (am 06–09 · pm 16–19 เวลาไทย)
  app.get('/api/lpr/truck-ban/daily', async (req, res) => {
    const from = String(req.query.from || ''), to = String(req.query.to || '');
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return res.status(400).json({ error: 'bad_range' });
    if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 62) return res.status(400).json({ error: 'range_too_wide', max_days: 62 });
    try {
      const rows = await truckBanQuery(req, req.user?.allowedSites ?? null, thaiDayStart(from), thaiDayEnd(to), (where) =>
        `SELECT to_char(d, 'YYYY-MM-DD') AS day,
                count(DISTINCT plate_number) FILTER (WHERE h < 12)::int AS am,
                count(DISTINCT plate_number) FILTER (WHERE h >= 12)::int AS pm
           FROM (SELECT lp.plate_number,
                        date_trunc('day', lp.detected_at AT TIME ZONE 'Asia/Bangkok') AS d,
                        extract(hour FROM lp.detected_at AT TIME ZONE 'Asia/Bangkok') AS h
                   FROM license_plates lp WHERE ${where}) x
          WHERE h IN (6, 7, 8, 16, 17, 18)
          GROUP BY d ORDER BY d`);
      res.json(rows || []);
    } catch (e) {
      console.error('[lpr-query] GET truck-ban daily:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/truck-ban/buckets?day=YYYY-MM-DD[&site=hkt][&cameras=a,b][&light=1]
  // กราฟ "Realtime" + "24 ชั่วโมง": ป้ายไม่ซ้ำต่อถัง 30 นาที (b = 0..47) + ยอดทั้งวัน/ในช่วงห้าม
  // เดิมหน้าเว็บดึงทุกแถวของวันมานับเอง ~4 MB ต่อกราฟต่อผู้ชม (เจ้าของสั่งย้าย 2026-10-26 · ข้อ 6 หลัง perfWatch)
  app.get('/api/lpr/truck-ban/buckets', async (req, res) => {
    const day = String(req.query.day || '');
    if (!DAY_RE.test(day)) return res.status(400).json({ error: 'bad_day' });
    try {
      const rows = await truckBanQuery(req, req.user?.allowedSites ?? null, thaiDayStart(day), thaiDayEnd(day), (where) =>
        `WITH x AS (SELECT lp.plate_number AS p,
                           extract(hour FROM lp.detected_at AT TIME ZONE 'Asia/Bangkok')::int AS h,
                           extract(minute FROM lp.detected_at AT TIME ZONE 'Asia/Bangkok')::int AS m
                      FROM license_plates lp WHERE ${where})
         SELECT 'b' AS k, h * 2 + (m >= 30)::int AS b, count(DISTINCT p)::int AS n FROM x GROUP BY 2
         UNION ALL SELECT 'all', NULL, count(DISTINCT p)::int FROM x
         UNION ALL SELECT 'ban', NULL, (count(DISTINCT p) FILTER (WHERE h IN (6, 7, 8, 16, 17, 18)))::int FROM x
         UNION ALL SELECT 'out', NULL, (count(DISTINCT p) FILTER (WHERE h NOT IN (6, 7, 8, 16, 17, 18)))::int FROM x`);
      // ทั้งสามตัว = ป้ายไม่ซ้ำ (คัน) · คันที่วิ่งทั้งในและนอกช่วงนับในทั้ง ban และ outside ⇒ ban + outside ≥ all
      const buckets = new Array(48).fill(0); let all = 0, ban = 0, outside = 0;
      for (const r of rows || []) {
        if (r.k === 'b') buckets[r.b] = r.n; else if (r.k === 'all') all = r.n;
        else if (r.k === 'ban') ban = r.n; else if (r.k === 'out') outside = r.n;
      }
      res.json({ day, buckets, all, ban, outside });
    } catch (e) {
      console.error('[lpr-query] GET truck-ban buckets:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── อันดับ · KPI · หน้าต่างป้าย · PDF — นับที่เซิร์ฟเวอร์ทุกช่วงเวลา (เจ้าของสั่ง 2026-11-02 · เดิมหน้าเว็บดึงแถวมาจัดกลุ่มเอง ≤14 วัน)
  // days = วันบังคับใช้ที่หน้าเว็บคิดจากปฏิทินวันหยุดของมันเอง · 1 ครั้ง = 1 ป้าย × 1 ช่วงห้าม × 1 วัน (กี่ภาพก็นับ 1)
  // ช่วงห้าม [06:00, 09:00) · [16:00, 19:00) เวลาไทย สร้างจาก days แล้วสแกน index ทีละช่วง
  // ⚠️ ต้องเป็น LATERAL — JOIN ธรรมดา planner สแกนทั้งช่วงแล้วกรองทีละหน้าต่าง (7 วัน 709 ms → LATERAL 26 ms · วัด 2026-11-02)
  //    ทุกช่วงเวลา (66 วัน hkt): cache อุ่น 0.25 วิ · cache เย็น ~11 วิ (อ่าน heap 95k block) — ยังอยู่ใต้ statement_timeout 20 วิ
  const TB_MAX_DAYS = 400;
  function tbParams(q) {
    const days = [...new Set(String(q.days || '').split(',').map((s) => s.trim()).filter(Boolean))].sort();
    if (days.length > TB_MAX_DAYS) return { error: 'too_many_days', max_days: TB_MAX_DAYS };
    for (const d of days) {
      // DAY_RE ปล่อย 2026-02-30 ผ่าน แล้ว ::date โยนเป็น 500 ⇒ เทียบไป-กลับ
      const t = Date.parse(d + 'T00:00:00Z');
      if (!DAY_RE.test(d) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) return { error: 'bad_day', day: d.slice(0, 20) };
    }
    const sel = q.cameras ? String(q.cameras).split(',').map((s) => s.trim()).filter(Boolean) : null;
    return { days, sel, q: String(q.q || '').replace(/\D/g, '').slice(0, 7),
      limit: Math.min(Math.max(parseInt(q.limit, 10) || 500, 1), 2000) };
  }
  const tbBounds = (days) => (days.length
    ? [thaiDayStart(days[0]), thaiDayEnd(days[days.length - 1])]
    : [new Date().toISOString(), new Date().toISOString()]);
  const TB_WIN = `w AS MATERIALIZED (
      SELECT d AS day, v.k, (d + v.f) AT TIME ZONE 'Asia/Bangkok' AS a, (d + v.t) AT TIME ZONE 'Asia/Bangkok' AS b
        FROM unnest($5::date[]) d
       CROSS JOIN (VALUES ('am', time '06:00', time '09:00'), ('pm', time '16:00', time '19:00')) v(k, f, t))`;
  const tbReads = (where, cols) => `w CROSS JOIN LATERAL (SELECT ${cols} FROM license_plates lp
      WHERE lp.detected_at >= w.a AND lp.detected_at < w.b AND ${where}) lp`;
  const bucketHm = (b) => `${String(Math.floor(b / 2)).padStart(2, '0')}:${b % 2 ? '30' : '00'}`;

  // $1 = กล้อง LPR ทั้งไซต์ (cam_plates ของตัวเลือกกล้องนับข้ามตัวเลือก) · $6 = กล้องที่เลือก (null = ทั้งหมด) · $7 ค้นป้าย · $8 เพดานแถว
  // groups = จำนวนคันต่อจำนวนครั้ง (ครบทุกคัน แม้ rows ถูกตัดที่ limit) · oldest = วันแรกที่ไซต์มีข้อมูล (ให้ปุ่ม "ทุกช่วงเวลา")
  async function tbRank(req, scope, p) {
    const out = await truckBanQuery(req, scope, ...tbBounds(p.days), (where) => `WITH ${TB_WIN},
      ra AS MATERIALIZED (SELECT w.day, w.k, lp.plate_number AS p, lp.camera_id AS cam, lp.region, lp.detected_at AS at
        FROM ${tbReads(where, 'lp.plate_number, lp.camera_id, lp.region, lp.detected_at')}),
      r AS MATERIALIZED (SELECT * FROM ra WHERE $6::text[] IS NULL OR cam = ANY($6::text[])),
      v AS MATERIALIZED (SELECT p, day, k, min(at) AS first FROM r GROUP BY 1, 2, 3),
      pp AS MATERIALIZED (SELECT p, count(*)::int AS n, max(first) AS last FROM v GROUP BY 1),
      pk AS (SELECT (extract(hour FROM first AT TIME ZONE 'Asia/Bangkok') * 2
                     + (extract(minute FROM first AT TIME ZONE 'Asia/Bangkok') >= 30)::int)::int AS b, count(*)::int AS n
               FROM v GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1),
      pq AS MATERIALIZED (SELECT * FROM pp WHERE strpos(p, $7::text) > 0),
      top AS MATERIALIZED (SELECT * FROM pq ORDER BY n DESC, last DESC, p LIMIT $8::int),
      pc AS (SELECT r.p, array_agg(DISTINCT r.cam ORDER BY r.cam) AS cams FROM r JOIN top USING (p) GROUP BY 1),
      -- จังหวัด = ค่าที่อ่านได้บ่อยที่สุด ไม่นับ ''/'ไม่ทราบ'/NULL · เสมอกันเอาที่เห็นก่อน
      prg AS (SELECT DISTINCT ON (p) p, region FROM (
                SELECT r.p, r.region, count(*) AS c, min(r.at) AS m FROM r JOIN top USING (p)
                 WHERE r.region <> '' AND r.region <> 'ไม่ทราบ' GROUP BY 1, 2) z ORDER BY p, c DESC, m)
      SELECT (SELECT count(*) FROM v)::int AS violations,
             (SELECT count(*) FROM pp)::int AS plates,
             (SELECT count(*) FROM pp WHERE n >= 2)::int AS repeaters,
             (SELECT coalesce(max(n), 0) FROM pp)::int AS max_per_plate,
             (SELECT row_to_json(pk) FROM pk) AS peak,
             (SELECT coalesce(json_agg(json_build_object('n', n, 'plates', c) ORDER BY n DESC), '[]')
                FROM (SELECT n, count(*)::int AS c FROM pq GROUP BY n) g) AS groups,
             (SELECT coalesce(json_agg(json_build_object('id', cam, 'plates', c)), '[]')
                FROM (SELECT cam, count(DISTINCT p)::int AS c FROM ra GROUP BY cam) x) AS cam_plates,
             (SELECT coalesce(json_agg(json_build_object('plate', t.p, 'n', t.n, 'last', t.last, 'cams', pc.cams, 'region', prg.region)
                                       ORDER BY t.n DESC, t.last DESC, t.p), '[]')
                FROM top t JOIN pc ON pc.p = t.p LEFT JOIN prg ON prg.p = t.p) AS list,
             (SELECT to_char(min(o.m) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') FROM unnest($1::text[]) c(id)
                CROSS JOIN LATERAL (SELECT lp.detected_at AS m FROM license_plates lp
                                     WHERE lp.camera_id = c.id ORDER BY lp.detected_at LIMIT 1) o) AS oldest`,
    { extra: [p.days, p.sel, p.q, p.limit], allCams: true });
    const x = (out && out[0]) || {};
    return {
      kpis: { violations: x.violations || 0, plates: x.plates || 0, repeaters: x.repeaters || 0,
        max_per_plate: x.max_per_plate || 0, peak: x.peak ? { bucket: bucketHm(x.peak.b), n: x.peak.n } : null },
      groups: x.groups || [], cam_plates: x.cam_plates || [], rows: x.list || [], oldest: x.oldest || null,
    };
  }

  // marked=1: นับครั้งเฉพาะป้ายที่มีแถวใน truck_ban_rejections (reject + defer) ด้วยตรรกะเดียวกับ tbRank · วัน/ประเภท/กล้องชุดเดียวกัน
  //   คืน [{ plate, kind, n, last, region }] — ป้ายที่ไม่มีครั้งในช่วงนี้ไม่อยู่ในผล (หน้าเว็บถือเป็น 0) · ไม่กระทบ kpis/rows
  async function tbMarked(req, scope, p) {
    if (!p.days.length) return [];
    const { rows: kinds } = await pool.query('SELECT plate_number, kind FROM truck_ban_rejections');
    if (!kinds.length) return [];
    const kindOf = new Map(kinds.map((k) => [k.plate_number, k.kind]));
    const out = await truckBanQuery(req, scope, ...tbBounds(p.days), (where) => `WITH ${TB_WIN},
      r AS MATERIALIZED (SELECT w.day, w.k, lp.plate_number AS p, lp.region, lp.detected_at AS at
        FROM ${tbReads(`${where} AND lp.plate_number = ANY($6::text[])`, 'lp.plate_number, lp.region, lp.detected_at')}),
      v AS MATERIALIZED (SELECT p, day, k, min(at) AS first FROM r GROUP BY 1, 2, 3),
      pp AS (SELECT p, count(*)::int AS n, max(first) AS last FROM v GROUP BY 1),
      prg AS (SELECT DISTINCT ON (p) p, region FROM (
                SELECT p, region, count(*) AS c, min(at) AS m FROM r
                 WHERE region <> '' AND region <> 'ไม่ทราบ' GROUP BY 1, 2) z ORDER BY p, c DESC, m)
      SELECT pp.p AS plate, pp.n, pp.last, prg.region FROM pp LEFT JOIN prg ON prg.p = pp.p
       ORDER BY pp.n DESC, pp.last DESC, pp.p`,
    { extra: [p.days, [...kindOf.keys()]], withMarked: true });
    return (out || []).map((x) => ({ ...x, kind: kindOf.get(x.plate) }));
  }

  // GET /api/lpr/truck-ban/ranking?days=YYYY-MM-DD,…[&site=hkt][&cameras=a,b][&light=1][&q=เลข][&limit=500][&marked=1]
  // days ว่าง = KPI ศูนย์ + oldest (หน้าเว็บใช้หาวันแรกของ "ทุกช่วงเวลา")
  app.get('/api/lpr/truck-ban/ranking', async (req, res) => {
    const p = tbParams(req.query);
    if (p.error) return res.status(400).json(p);
    try {
      const out = await tbRank(req, req.user?.allowedSites ?? null, p);
      if (req.query.marked === '1') out.marked = await tbMarked(req, req.user?.allowedSites ?? null, p);
      res.json(out);
    } catch (e) {
      console.error('[lpr-query] GET truck-ban ranking:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/truck-ban/plate/:plate?days=…[&cameras=][&light=1][&include_marked=1] — (include_marked = ป้ายที่ reject/defer ไว้ก็ดูภาพได้) ทุกภาพของป้ายนี้ในช่วงห้ามของวันที่ส่งมา (หน้าต่างป้ายของ demo)
  // แคบโดยตั้งใจ: รับเฉพาะป้ายหมวดรถบรรทุก ไม่ใช่ช่องค้นทั้งฐานป้าย · raw_json ส่งแค่ 3 ค่าแบบ /api/lpr?export=1 (ไม่มี rawXml)
  app.get('/api/lpr/truck-ban/plate/:plate', async (req, res) => {
    const plate = String(req.params.plate || '').trim();
    if (!/^[5-9][0-9]{5,6}$/.test(plate)) return res.status(400).json({ error: 'bad_plate' });
    const p = tbParams(req.query);
    if (p.error) return res.status(400).json(p);
    if (!p.days.length) return res.json([]);
    try {
      const rows = await truckBanQuery(req, req.user?.allowedSites ?? null, ...tbBounds(p.days), (where) => `WITH ${TB_WIN}
        SELECT to_char(w.day, 'YYYY-MM-DD') AS day, w.k AS win, e.id, lp.camera_id, lp.detected_at AS event_time,
               coalesce(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot_file,
               jsonb_build_object('plateColor', e.raw_json->>'plateColor', 'laneNo', e.raw_json->>'laneNo',
                                  'region', e.raw_json->>'region') AS raw_json,
               lp.plate_number, lp.region AS lp_region, lp.vehicle_type AS lp_vehicle_type,
               lp.vehicle_color AS lp_vehicle_color, lp.vehicle_brand AS lp_vehicle_brand,
               lp.plate_image, lp.confidence,
               lp.vehicle_bbox_x, lp.vehicle_bbox_y, lp.vehicle_bbox_width, lp.vehicle_bbox_height
          FROM ${tbReads(`${where} AND lp.plate_number = $6`, 'lp.*')}
          JOIN events e ON e.id = lp.event_id
         ORDER BY lp.detected_at
         LIMIT 2000`, { extra: [p.days, plate], withMarked: req.query.include_marked === '1' });
      res.json(rows || []);
    } catch (e) {
      console.error('[lpr-query] GET truck-ban plate:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── PDF: เจาะลึก 10 คัน · ตารางข้อความ · ตารางพร้อมภาพ (แบบหน้าอันดับไม่สวมหมวก — routes/traffic-report-pdf.js) ──
  // หลักฐาน = ภาพในช่วงห้ามของวันที่เลือก กล้องที่เลือก · 3 ใบต่อคัน เผื่อใบแรกถูกลบตามอายุ (ภาพไม่อยู่แล้วแต่แถวยังอยู่)
  async function tbEvidence(req, scope, p, plates) {
    return (await truckBanQuery(req, scope, ...tbBounds(p.days), (where) => `WITH ${TB_WIN},
      c AS (SELECT lp.*, w.k AS win, e.id AS eid, coalesce(e.snapshot_filename, e.raw_json->>'_snapshot') AS scene,
                   row_number() OVER (PARTITION BY lp.plate_number ORDER BY
                     -- 06:xx และ 18:xx มืด (ภาพหลักฐานใบแรกที่ลองเป็น 18:55 มองไม่เห็นตัวรถ) ⇒ 07–17 น. ก่อน
                     (extract(hour FROM lp.detected_at AT TIME ZONE 'Asia/Bangkok') BETWEEN 7 AND 17) DESC,
                     (lp.plate_image IS NOT NULL AND coalesce(e.snapshot_filename, e.raw_json->>'_snapshot') IS NOT NULL) DESC,
                     (lp.vehicle_bbox_width > 0) DESC, lp.confidence DESC NULLS LAST, lp.detected_at DESC) AS rn
              FROM ${tbReads(`${where} AND lp.plate_number = ANY($6::text[])`,
                'lp.plate_number, lp.camera_id, lp.detected_at, lp.event_id, lp.plate_image, lp.plate_color, lp.vehicle_type, lp.confidence, lp.vehicle_bbox_x, lp.vehicle_bbox_y, lp.vehicle_bbox_width, lp.vehicle_bbox_height')}
              LEFT JOIN events e ON e.id = lp.event_id)
      SELECT c.plate_number AS plate, c.win, c.camera_id AS camera, coalesce(cm.name, c.camera_id) AS "camName",
             c.detected_at AS at, c.plate_image AS "plateImg", c.scene, c.eid AS "eventId",
             c.plate_color AS "plateColor", c.vehicle_type AS vt,
             c.vehicle_bbox_x AS bx, c.vehicle_bbox_y AS by, c.vehicle_bbox_width AS bw, c.vehicle_bbox_height AS bh
        FROM c LEFT JOIN cameras cm ON cm.id = c.camera_id
       WHERE c.rn <= 3 ORDER BY c.plate_number, c.rn`, { extra: [p.days, plates] })) || [];
  }
  // ดึงภาพผ่าน /snapshots ของเราเอง (X-Internal-Token) — แบบเดียวกับ traffic-report-pdf.js
  const tbGrab = (pth, qs) => new Promise((resolve) => {
    if (!pth) return resolve(null);
    const r2 = require('http').get({
      host: '127.0.0.1', port: env.int('PORT'), path: `/snapshots/${encodeURI(pth)}${qs || ''}`,
      headers: { 'X-Internal-Token': env.str('INTERNAL_API_SECRET') || '' }, timeout: 25000,
    }, (r3) => {
      if (r3.statusCode !== 200) { r3.resume(); return resolve(null); }
      const bufs = []; r3.on('data', (c) => bufs.push(c)); r3.on('end', () => resolve(Buffer.concat(bufs)));
    });
    r2.on('error', () => resolve(null));
    r2.on('timeout', () => { r2.destroy(); resolve(null); });
  });
  // ย่อเองเสมอ — ?w= ไม่มีผลกับภาพที่ฝังกรอบแล้ว (traffic-report-pdf.js: 30 คัน = 11.9MB)
  const tbShrink = async (buf, w, qy) => {
    if (!buf) return null;
    try { return (await sharp(buf).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: qy }).toBuffer()).toString('base64'); }
    catch { return buf.toString('base64'); }
  };
  // ไล่ใบสำรองจนได้ใบที่ภาพครบ · แถวต้องเล่าเรื่องเดียวกับภาพ (เวลา/กล้องมาจากใบที่ใช้)
  async function tbAttachImages(row, cands, mode) {
    let scene = null, plate = null, used = cands[0];
    for (const c of cands) {
      const [a, d] = await Promise.all([
        mode === 'top' ? tbGrab(c.scene, `?bbox=1&alarm=1&eid=${encodeURIComponent(c.eventId)}`) : tbGrab(c.scene, '?w=900'),
        tbGrab(c.plateImg, null)]);
      if (a && d) { scene = a; plate = d; used = c; break; }
      if (!scene && a) { scene = a; used = c; }
      if (!plate && d) plate = d;
    }
    if (!used) return;
    Object.assign(row, { ev: used });
    row.plateB64 = await tbShrink(plate, 240, 80);
    if (mode === 'top') { row.sceneB64 = await tbShrink(scene, 1200, 78); return; }
    // ครอปตัวรถจากกรอบที่กล้องส่งมา (สเกล 0-1000) เผื่อขอบ 8% · ไม่มีกรอบ = ใช้ภาพเต็มย่อ
    if (scene && used.bw > 0 && used.bx >= 0 && used.bx <= 1000) {
      try {
        const md = await sharp(scene).metadata(), pad = 0.08;
        const x = Math.max(0, Math.round((used.bx / 1000 - pad * used.bw / 1000) * md.width));
        const y = Math.max(0, Math.round((used.by / 1000 - pad * used.bh / 1000) * md.height));
        const w = Math.min(md.width - x, Math.round((used.bw / 1000) * (1 + 2 * pad) * md.width));
        const h = Math.min(md.height - y, Math.round((used.bh / 1000) * (1 + 2 * pad) * md.height));
        if (w > 10 && h > 10) {
          row.vehicleB64 = (await sharp(scene).extract({ left: x, top: y, width: w, height: h })
            .resize({ width: 300, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()).toString('base64');
        }
      } catch { /* ครอปไม่ได้ก็ใช้ภาพเต็มข้างล่าง */ }
    }
    if (!row.vehicleB64) row.vehicleB64 = await tbShrink(scene, 300, 74);
  }
  const TB_TABLE_CAP = { text: 400, image: 250 };
  const _tbRunner = createHeavyRunner({ limit: 2, maxWaitMs: 120000 });
  const thDay = (d) => new Date(d + 'T12:00:00+07:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });

  async function tbPdf(req, res, mode, scope) {
    const p = tbParams(req.query);
    if (p.error) return res.status(400).json(p);
    if (!p.days.length) return res.status(400).json({ error: 'no_days' });
    const brandName = req.brandName || 'Vision Meta Hub';
    const site = String(req.query.site || 'hkt'), light = req.query.light === '1';
    const loader = async () => {
      const rk = await tbRank(req, scope, { ...p, q: '', limit: 2000 });
      // "10 อันดับ" = 10 ค่าจำนวนครั้งสูงสุด (dense rank) แบบหน้าหมวก · groups นับครบแม้ rows ถูกตัด
      const ns = rk.groups.slice(0, 10).map((g) => g.n);
      const totalInRanks = rk.groups.slice(0, 10).reduce((s, g) => s + g.plates, 0);
      const inRank = rk.rows.filter((r) => ns.includes(r.n));
      const rows = mode === 'top' ? inRank.slice(0, 10) : inRank.slice(0, TB_TABLE_CAP[mode]);
      if (!rows.length) return { empty: true };
      const [{ rows: sn }, { rows: cn }] = await Promise.all([
        pool.query('SELECT name FROM sites WHERE code = $1', [site]),
        pool.query('SELECT id, name FROM cameras WHERE id = ANY($1)', [[...new Set(rows.flatMap((r) => r.cams))]])]);
      const camName = new Map(cn.map((c) => [c.id, c.name || c.id]));
      for (const r of rows) r.camNames = r.cams.map((c) => camName.get(c) || c);
      if (mode !== 'text') {
        const ev = await tbEvidence(req, scope, p, rows.map((r) => r.plate));
        const by = new Map();
        for (const e of ev) { if (!by.has(e.plate)) by.set(e.plate, []); by.get(e.plate).push(e); }
        let i = 0;
        const worker = async () => { while (i < rows.length) { const r = rows[i++]; await tbAttachImages(r, by.get(r.plate) || [], mode); } };
        await Promise.all(Array.from({ length: mode === 'top' ? 4 : 6 }, worker));
      }
      const scopeBits = [(sn[0] && sn[0].name) || site, p.sel ? `${p.sel.length} กล้องที่เลือกไว้` : 'ทุกกล้อง'];
      const periodLabel = `${thDay(p.days[0])}${p.days.length > 1 ? ' – ' + thDay(p.days[p.days.length - 1]) : ''}`
        + ` · บังคับใช้ ${p.days.length} วัน · ขอบเขต ${scopeBits.join(' · ')}`;
      const criteriaNote = 'ช่วงห้าม 06:00–09:00 และ 16:00–19:00 เฉพาะวันบังคับใช้ · ป้ายหมวด 50–99 และ 500–999 · '
        + (light ? 'กล้องจัดเป็นรถบรรทุกหรือรถบรรทุกเล็ก' : 'กล้องจัดเป็นรถบรรทุก')
        + ' · นับ 1 ครั้งต่อป้ายต่อช่วงห้ามต่อวัน';
      const logos = await brandLogos(pool);
      const common = { rows, periodLabel, criteriaNote, brand: { name: brandName }, logoB64: logos.header, footerLogoB64: logos.footer };
      const pdf = mode === 'top'
        ? await reportRenderer.renderTruckBanTopPdf({ ...common, totalInRanks })
        : await reportRenderer.renderTruckBanTablePdf({ ...common, withImages: mode === 'image', total: totalInRanks });
      return { pdf, filename: `truck-ban-${mode === 'top' ? 'top' : 'table-' + mode}-${new Date().toISOString().slice(0, 10)}.pdf` };
    };
    try {
      // ไม่รวม `_` (cache-buster) — คำขอที่ต่างกันแค่ตัวนั้นรอผลชุดเดียวกัน
      const key = JSON.stringify([mode, p.days, p.sel, light, site, scope, brandName]);
      const gone = new AbortController();
      res.on('close', () => { if (!res.writableFinished) gone.abort(); });
      const out = await _tbRunner.run(key, loader, gone.signal);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');   // .pdf = Cloudflare แคชเองตามนามสกุล
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Content-Type', 'application/pdf');
      if (out.empty) {
        const logos = await brandLogos(pool);
        res.setHeader('Content-Disposition', 'inline; filename="truck-ban-empty.pdf"');
        return res.send(await reportRenderer.renderNoticePdf({
          heading: 'รายงานรถบรรทุกวิ่งในช่วงห้าม', footerLabel: 'รายงานรถบรรทุกวิ่งในช่วงห้าม', title: 'ไม่พบรถบรรทุกในช่วงห้ามของช่วงที่เลือก',
          message: 'ลองเลือกช่วงเวลาที่ยาวขึ้น หรือเลือกกล้องเพิ่ม', periodLabel: `บังคับใช้ ${p.days.length} วัน`,
          brand: { name: brandName }, logoB64: logos.header, footerLogoB64: logos.footer }));
      }
      res.setHeader('Content-Disposition', `inline; filename="${out.filename}"`);
      res.send(out.pdf);
    } catch (e) {
      if (e.code === 'HEAVY_ABANDONED') return;   // ผู้เรียกปิดหน้าไปแล้ว
      if (e.code === 'HEAVY_BUSY') { res.set('Retry-After', '15'); return res.status(503).json({ error: 'busy' }); }
      console.error(`[lpr-query] GET truck-ban ${mode} pdf:`, e.message);
      res.status(500).json({ error: 'server_error' });
    }
  }
  // GET /api/lpr/truck-ban/report.pdf?days=… — เจาะลึก 10 คัน (คันละหน้า ภาพหลักฐานใหญ่)
  app.get('/api/lpr/truck-ban/report.pdf', (req, res) => tbPdf(req, res, 'top', req.user?.allowedSites ?? null));
  // GET /api/lpr/truck-ban/report-table.pdf?days=…&mode=text|image — ตารางทุกคันใน 10 อันดับ (เพดาน 400 / 250 คัน)
  app.get('/api/lpr/truck-ban/report-table.pdf', (req, res) =>
    tbPdf(req, res, req.query.mode === 'image' ? 'image' : 'text', req.user?.allowedSites ?? null));

  app.delete('/api/lpr/truck-ban/rejections/:plate', async (req, res) => {
    if (!canReject(req.user)) return res.status(403).json({ error: 'Admin role required for this operation' });
    const plate = String(req.params.plate || '').trim();
    if (!plate) return res.status(400).json({ error: 'bad_plate' });
    try {
      await pool.query('DELETE FROM truck_ban_rejections WHERE plate_number = $1', [plate]);
      res.json({ plate_number: plate, rejected: false });
    } catch (e) {
      console.error('[lpr-query] DELETE truck-ban reject:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });
}

module.exports = { registerLprList, registerPlateHistoryAndMismatch };
