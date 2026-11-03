// ============================================================
// Vigil Platform — API หน้ากวดขันวินัยจราจร (Traffic Enforcement)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// อ่านจาก traffic_hourly_stats (ตารางสรุป — migration 142) ไม่ใช่ license_plates
// เหตุผลและตัวเลขวัดจริงอยู่ในหัวไฟล์ migration · สรุป: 3.6s → 0.086s
//
// ── นิยามที่ต้องไม่พลาด (พิสูจน์จากข้อมูลจริง 2026-08-11) ─────────────
// no_helmet ติดธงเฉพาะรถ 2-3 ล้อ · no_seatbelt เฉพาะรถ 4 ล้อขึ้นไป
// ⇒ ตัวหารของสองเรื่องนี้ **คนละชุดกัน** ห้ามหารด้วยรถทุกคัน ไม่งั้นอัตรา
// ไม่สวมหมวกจะร่วงจาก 20.5% เหลือ 8.2% ซึ่งผิดและคนหน้างานจับได้ทันที
//
// ── กล้องที่ยังไม่เปิดตรวจจับ ────────────────────────────────────────
// บางกล้องส่ง no_helmet=false มาทุกคัน (เจอจริง 97,252 คัน ฝ่าฝืน 0)
// ซึ่งเป็นไปไม่ได้ทางสถิติเมื่อกล้องอื่นอยู่ที่ 12-43% ⇒ ยังไม่ได้เปิดฟังก์ชัน
// ต้องกันออกจากค่าเฉลี่ย ไม่ใช่นับเป็น 0% ไม่งั้นสถิติทั้งระบบดูดีเกินจริง
// ตัดสินด้วยเกณฑ์ทางสถิติ (รถเยอะพอแต่ฝ่าฝืน 0) เพราะ DB เก็บ false ไม่ใช่ NULL
// จึงแยกจากตัวข้อมูลเองไม่ได้ — ดู NO_DETECT_MIN_SAMPLE
// ============================================================
'use strict';

const { siteWhere, resolveSiteScope, cameraSelectMode } = require('../auth');
const reportRenderer = require('../report-renderer');
// ⚠️ ถูกใช้ใน _brandLogos() — ขาดบรรทัดนี้แล้วรายงานทุกแบบจะ 500 ตอนรัน
//    (node --check ไม่จับ เพราะเป็น ReferenceError ตอน runtime ไม่ใช่ syntax)
const { brandLogos } = require('../helpers/brandLogos');
const { createTtlCache } = require('../helpers/ttlCache');

// เกณฑ์กลางของตัวเลขหมวกนิรภัย — ห้ามเขียนเกณฑ์เองในไฟล์นี้อีก (ดูหัว helmetCriteria.js)
// ทุกหน้าต้องรายงาน **เลขเดียว** ด้วยคำเดียวกัน: "ไม่สวมหมวก · พร้อมข้อมูลทะเบียน"
// (กลับด้านจากเลขคู่ 2026-08-27 — ดู DECISIONS #259)
const helmet = require('../helpers/helmetCriteria');
const { scrubRawJsonSql } = require('../helpers/scrubRawJson');

// เจ้าของสั่ง 2026-08-16: ผลลัพธ์เรื่องหมวกนิรภัยนับเฉพาะ 'จักรยานยนต์' เท่านั้น
// สามล้อ/ซาเล้ง/พ่วงข้างตัดออก — รถประเภทนั้นปกติไม่สวมหมวกอยู่แล้ว จึงไม่ใช่
// กลุ่มเป้าหมายของการกวดขัน และทำให้อันดับเพี้ยน
const MOTO_TYPES = helmet.MOTO_TYPES;
const CAR_TYPES  = ['vehicle', 'SUVMPV', 'pickupTruck', 'van', 'truck', 'largeBus', 'buggy'];
// ต่ำกว่านี้ยังสรุปไม่ได้ว่า "ไม่เปิดตรวจจับ" หรือแค่รถน้อย
const NO_DETECT_MIN_SAMPLE = 2000;
const { registerCitationPdf, registerTablePdf } = require('./traffic-report-pdf');

module.exports = (app, pool, { auth, routeError }) => {
  const TZ = 'Asia/Bangkok';
  // ส่วน "วันนี้" ของ /helmet-series (O5) — 60 วิ เท่ากับ TTL ของ today ในหน้าอื่น
  const SERIES_TODAY = createTtlCache({ name: 'traffic:series-today', ttlMs: 60_000, max: 200 });

  const parseDays = (v) => {
    const n = parseInt(v, 10);
    return [7, 28, 90].includes(n) ? n : 28;
  };
  // รับรายชื่อกล้องแบบ comma-separated · จำกัดความยาวกัน query ยาวเกิน
  //
  // 🔒 บังคับโหมด single ที่นี่ (migration 180) — จุดนี้เป็นทางเข้าเดียวของทั้ง 4
  // endpoint ในไฟล์นี้ จึงกันได้ครบโดยไม่ต้องไล่แก้ทีละที่
  //
  // **ตอบ 400 ไม่ใช่ตัดให้เหลือตัวแรก** — ตัดเงียบ ๆ จะได้กราฟของกล้องเดียวขณะที่
  // หน้าจอยังโชว์ว่าเลือกไว้หลายตัว คนอ่านจะสรุปผิดโดยไม่มีอะไรบอก
  // หน้าจอที่ถูกต้องจะไม่ยิงเกิน 1 อยู่แล้ว (สลับเป็น radio) ⇒ 400 นี้จะเกิดเฉพาะ
  // กับคำขอที่ประกอบเอง ซึ่งคือเคสที่กฎนี้มีไว้กันพอดี
  const parseCams = (v, req) => {
    // โหมด single "ไม่ระบุกล้อง" ก็ต้องปฏิเสธเช่นกัน (เจ้าของอนุมัติ 2026-09-03) —
    // เดิมบังคับเฉพาะคำขอที่ส่งมาเกิน 1 ตัว ทำให้ default ของหน้า (ไม่ส่งพารามิเตอร์)
    // ได้ข้อมูลรวมทุกกล้องในสิทธิ์กลับไปเงียบๆ · เช็คผ่าน req เท่านั้น: call site
    // ที่ parse `sites` ไม่ส่ง req มา จึงไม่โดนกฎนี้
    if (req && !v && cameraSelectMode(req.user) === 'single') {
      const e = new Error('บัญชีนี้ดูได้ทีละกล้อง — ต้องระบุกล้องที่ต้องการดูมาด้วย');
      e.status = 400;
      throw e;
    }
    if (!v) return null;
    const arr = String(v).split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
    if (arr.length > 1 && cameraSelectMode(req?.user) === 'single') {
      const e = new Error('บัญชีนี้ดูได้ทีละกล้องเท่านั้น');
      e.status = 400;
      throw e;
    }
    return arr.length ? arr : null;
  };

  // GET /api/traffic/enforcement — ข้อมูลทั้งหน้าในคำขอเดียว
  // รวมมาให้ครบทีเดียวเพราะทุกส่วนใช้ขอบเขตเดียวกัน (ช่วงเวลา/กล้อง)
  // แยกเป็นหลาย endpoint จะกลายเป็นหลาย round-trip ที่ต้อง sync กันเอง
  // ไม่ใส่ auth.requireAuth ตรงนี้ — global `/api` middleware (api-server.js)
  // ยืนยันตัวตนให้แล้วทุก /api/* request "และ" set req.user.allowedSites ไว้ให้
  // ด้วย ถ้าใส่ auth.requireAuth ซ้ำที่นี่ (เหมือนที่เคยเป็นมา ก่อนแก้ 2026-08-12)
  // มันจะ re-fetch req.user ใหม่ผ่าน getUserFromToken() ซึ่ง**ไม่มี allowedSites**
  // แล้วเขียนทับ req.user เดิม → resolveSiteScope(req) เห็น allowedSites เป็น
  // undefined → ตีความเป็น admin (unrestricted) เงียบๆ ทั้งที่ query ข้างล่างถูก
  // ต้อง — นี่คือ root cause ตัวจริงของช่องโหว่ site-RBAC (decision #246,
  // GOTCHAS #162) ไม่ใช่แค่ query ไม่มี WHERE clause ตามที่คิดตอนแรก. Route อื่น
  // ในระบบ (เช่น stats.js) ไม่ใส่ auth.requireAuth ซ้ำแบบนี้อยู่แล้ว
  app.get('/api/traffic/enforcement', async (req, res) => {
    try {
      // Site-RBAC (P1, src/auth.js) — เพิ่ม 2026-08-12: endpoint นี้ (และ
      // /helmet-series ข้างล่าง) เดิมไม่เคยกรองตาม req.user.allowedSites เลย
      // ต่างจากทุก route อื่นในระบบที่ใช้ siteWhere()/resolveSiteScope() —
      // user site-scoped (เช่น viewer สังกัด Phuket) เห็นข้อมูลทุก Site ได้
      // เจ้าของแจ้งให้แก้ 2026-08-12
      const allowedSites = resolveSiteScope(req);
      const days = parseDays(req.query.days);
      if (allowedSites !== null && allowedSites.length === 0) {
        return res.json({
          ok: true, days, generated_at: new Date().toISOString(),
          hourly: [], cameras: [], vehicle_types: [], belt_by_type: [], sites: [], daily: [],
          no_detect_min_sample: NO_DETECT_MIN_SAMPLE,
        });
      }
      const cams = parseCams(req.query.cameras, req);
      const camFilter = cams ? 'AND t.camera_id = ANY($2)' : '';
      const params = cams ? [String(days), cams] : [String(days)];

      const base1 = [...params, MOTO_TYPES, CAR_TYPES];
      const sw1 = siteWhere(allowedSites, 't.camera_id', base1.length + 1);
      const base2 = [String(days), MOTO_TYPES, CAR_TYPES];
      const sw2 = siteWhere(allowedSites, 't.camera_id', base2.length + 1);
      const sw3 = siteWhere(allowedSites, 't.camera_id', params.length + 1);
      const base4 = [...params, CAR_TYPES];
      const sw4 = siteWhere(allowedSites, 't.camera_id', base4.length + 1);
      const base6 = [MOTO_TYPES, CAR_TYPES];
      const sw6 = siteWhere(allowedSites, 't.camera_id', base6.length + 1);

      const [dowHourly, byCamera, byType, beltByType, sites, daily] = await Promise.all([
        // 1) ชั่วโมง × วันในสัปดาห์ — แกนหลักของหน้านี้
        pool.query(`
          SELECT extract(isodow FROM t.bucket_hour AT TIME ZONE '${TZ}')::int AS dow,
                 extract(hour   FROM t.bucket_hour AT TIME ZONE '${TZ}')::int AS hr,
                 count(DISTINCT (t.bucket_hour AT TIME ZONE '${TZ}')::date)   AS days_seen,
                 sum(t.n_total) FILTER (WHERE t.vehicle_type = ANY($${cams ? 3 : 2}))       AS moto_total,
                 -- 3 ล้อเคยปนอยู่ในตัวเศษ ทั้งที่ตัวส่วนเป็น 2 ล้อล้วน ⇒ อัตราสูงเกินจริง
                 sum(t.n_no_helmet) FILTER (WHERE t.vehicle_type = ANY($${cams ? 3 : 2})) AS no_helmet,
                 sum(t.n_riders3)                                            AS riders3,
                 sum(t.n_total) FILTER (WHERE t.vehicle_type = ANY($${cams ? 4 : 3}))       AS car_total,
                 sum(t.n_no_seatbelt)                                        AS no_seatbelt
            FROM traffic_hourly_stats t
           WHERE t.bucket_hour >= date_trunc('hour', now()) - ($1 || ' days')::interval
             ${camFilter}
             ${sw1.sql}
           GROUP BY 1,2 ORDER BY 1,2`, [...base1, ...sw1.args]),

        // 2) รายกล้อง — ใช้ทั้งตารางจัดอันดับและตัวเลือกกล้อง
        //    ไม่กรองด้วย camFilter เพราะหน้าจอต้องเห็นกล้องทั้งหมดเพื่อให้เลือกได้
        //    (แต่ยังกรองด้วย sw2 — ขอบเขต Site ตาม RBAC ไม่ใช่ตัวเลือกกล้องในจอ)
        pool.query(`
          SELECT t.camera_id,
                 coalesce(c.name, t.camera_id)  AS name,
                 s.code AS site_code, s.name AS site_name, s.color AS site_color,
                 sum(t.n_total) FILTER (WHERE t.vehicle_type = ANY($2)) AS moto_total,
                 sum(t.n_no_helmet) FILTER (WHERE t.vehicle_type = ANY($2)) AS no_helmet,
                 sum(t.n_total) FILTER (WHERE t.vehicle_type = ANY($3)) AS car_total,
                 sum(t.n_no_seatbelt)                                   AS no_seatbelt,
                 sum(t.n_riders3)                                       AS riders3,
                 -- ความชัน "ดึก ÷ กลางวัน" ของแต่ละจุด ใช้ตอบว่าควรไปตั้งด่านกี่โมง
                 sum(t.n_no_helmet) FILTER (WHERE t.vehicle_type = ANY($2) AND extract(hour FROM t.bucket_hour AT TIME ZONE '${TZ}') IN (22,23,0,1,2,3)) AS nh_night,
                 sum(t.n_total)     FILTER (WHERE t.vehicle_type = ANY($2) AND extract(hour FROM t.bucket_hour AT TIME ZONE '${TZ}') IN (22,23,0,1,2,3)) AS moto_night,
                 sum(t.n_no_helmet) FILTER (WHERE t.vehicle_type = ANY($2) AND extract(hour FROM t.bucket_hour AT TIME ZONE '${TZ}') BETWEEN 10 AND 15) AS nh_day,
                 sum(t.n_total)     FILTER (WHERE t.vehicle_type = ANY($2) AND extract(hour FROM t.bucket_hour AT TIME ZONE '${TZ}') BETWEEN 10 AND 15) AS moto_day
            FROM traffic_hourly_stats t
            LEFT JOIN cameras c ON c.id = t.camera_id
            LEFT JOIN sites   s ON s.id = c.site_id
           WHERE t.bucket_hour >= date_trunc('hour', now()) - ($1 || ' days')::interval
             ${sw2.sql}
           GROUP BY 1,2,3,4,5
          HAVING sum(t.n_total) > 0
           ORDER BY 6 DESC NULLS LAST`, [...base2, ...sw2.args]),

        // 3) ปริมาณแยกตามประเภทรถดิบ — หน้าจอเอาไปจัดกลุ่มเองตามที่ตั้งค่าไว้
        pool.query(`
          SELECT t.vehicle_type, sum(t.n_total) AS n
            FROM traffic_hourly_stats t
           WHERE t.bucket_hour >= date_trunc('hour', now()) - ($1 || ' days')::interval
             ${camFilter}
             ${sw3.sql}
           GROUP BY 1 ORDER BY 2 DESC`, [...params, ...sw3.args]),

        // 4) ไม่คาดเข็มขัด แยกตามประเภท — ตัวหารคือรถ 4 ล้อขึ้นไปเท่านั้น
        pool.query(`
          SELECT t.vehicle_type, sum(t.n_total) AS total, sum(t.n_no_seatbelt) AS bad
            FROM traffic_hourly_stats t
           WHERE t.bucket_hour >= date_trunc('hour', now()) - ($1 || ' days')::interval
             AND t.vehicle_type = ANY($${cams ? 3 : 2})
             ${camFilter}
             ${sw4.sql}
           GROUP BY 1 HAVING sum(t.n_total) > 0 ORDER BY 3 DESC`, [...base4, ...sw4.args]),

        pool.query(`SELECT id, code, name, color FROM sites ${allowedSites ? 'WHERE id = ANY($1)' : ''} ORDER BY sort_order, id`,
          allowedSites ? [allowedSites] : []),

        // 5) อนุกรมรายวัน — จำเป็นสำหรับแท็บ "ก่อน-หลังกวดขัน" ซึ่งต้องเทียบ
        //    ช่วงก่อนกับหลังวันที่เลือก · ข้อมูลรายชั่วโมง×วันในสัปดาห์ (ชุดที่ 1)
        //    ใช้ทำไม่ได้เพราะมันเฉลี่ยรวมทั้งหน้าต่างไปแล้ว ไม่เหลือแกนเวลาจริง
        //    ดึง 120 วันเสมอ ไม่อิงตัวกรองช่วงเวลา เพราะผู้ใช้เลือกวันกวดขัน
        //    ย้อนไปได้ไกลกว่าหน้าต่างที่กำลังดูอยู่
        //
        //    ปรับ 2026-08-11: เพิ่ม camera_id ใน GROUP BY เพื่อให้หน้าจอกรองตามขอบเขต
        //    ของผู้ใช้ได้ — ดูรายละเอียดในตำลึก GOTCHAS #159
        pool.query(`
          -- ส่งเป็นสตริง YYYY-MM-DD ไม่ใช่ชนิด date — ไม่งั้น pg คืนเป็น JS Date
          -- แล้ว JSON.stringify แปลงเป็น ISO timestamp พร้อม offset ("...T17:00:00Z")
          -- ซึ่งฝั่งหน้าจอเอาไปเทียบกับค่าจาก <input type="date"> ไม่ได้เลย
          SELECT to_char(t.day, 'YYYY-MM-DD') AS d,
                 t.camera_id,
                 sum(t.n_total) FILTER (WHERE t.vehicle_type = ANY($1)) AS moto,
                 sum(t.n_no_helmet) FILTER (WHERE t.vehicle_type = ANY($1)) AS no_helmet,
                 sum(t.n_total) FILTER (WHERE t.vehicle_type = ANY($2)) AS car,
                 sum(t.n_no_seatbelt)                                   AS no_seatbelt,
                 sum(t.n_riders3)                                       AS riders3,
                 -- จำนวนกล้องที่ส่งข้อมูลวันนั้น — ใช้เตือนเวลาเทียบก่อน/หลัง
                 -- ถ้าสองช่วงมีกล้องไม่เท่ากัน ตัวเลขที่ได้ไม่ใช่ผลของการกวดขัน
                 -- แต่เป็นผลของ "ข้อมูลมาไม่เท่ากัน" ซึ่งหลอกคนอ่านได้ง่ายมาก
                 count(DISTINCT t.camera_id)                            AS cams
            FROM traffic_daily_stats t
           -- ตารางรายวัน (migration 274) แทนรวมรายชั่วโมงสด (1,280 → ms) · วันเริ่มต้นเดิม (วันไทยของ
           -- เที่ยงคืน UTC − 120 วัน) แต่วันนั้นเป็นวันเต็มแล้ว — เดิมขาด 7 ชม.แรก (เจ้าของเลือก ก. 2026-10-22)
           WHERE t.day >= ((date_trunc('day', now()) - interval '120 days') AT TIME ZONE '${TZ}')::date
             ${sw6.sql}
           GROUP BY 1, 2 ORDER BY 1`, [...base6, ...sw6.args]),
      ]);

      const num = (v) => Number(v || 0);
      const cameras = byCamera.rows.map((r) => {
        const moto = num(r.moto_total), nh = num(r.no_helmet);
        // เกณฑ์ตัดสิน "ยังไม่เปิดตรวจจับ": รถผ่านเยอะพอแล้วแต่ฝ่าฝืน 0 พอดี
        const detect = !(moto >= NO_DETECT_MIN_SAMPLE && nh === 0);
        const mn = num(r.moto_night), md = num(r.moto_day);
        const nightPct = mn ? num(r.nh_night) / mn * 100 : null;
        const dayPct   = md ? num(r.nh_day) / md * 100 : null;
        return {
          id: r.camera_id, name: r.name,
          site_code: r.site_code, site_name: r.site_name, site_color: r.site_color,
          moto, car: num(r.car_total),
          no_helmet: nh, no_seatbelt: num(r.no_seatbelt), riders3: num(r.riders3),
          helmet_pct: detect && moto ? +(nh / moto * 100).toFixed(2) : null,
          belt_pct: num(r.car_total) ? +(num(r.no_seatbelt) / num(r.car_total) * 100).toFixed(3) : null,
          // ค่าชี้ว่ากลางคืนแย่กว่ากลางวันกี่เท่า — null เมื่อตัวอย่างน้อยเกินเชื่อถือ
          night_ratio: (detect && nightPct != null && dayPct) ? +(nightPct / dayPct).toFixed(2) : null,
          detect,
        };
      });

      res.json({
        ok: true,
        days,
        generated_at: new Date().toISOString(),
        hourly: dowHourly.rows.map((r) => ({
          dow: r.dow, hour: r.hr, days_seen: num(r.days_seen),
          moto: num(r.moto_total), no_helmet: num(r.no_helmet), riders3: num(r.riders3),
          car: num(r.car_total), no_seatbelt: num(r.no_seatbelt),
        })),
        cameras,
        vehicle_types: byType.rows.map(r => ({ type: r.vehicle_type, n: num(r.n) })),
        belt_by_type: beltByType.rows.map(r => ({
          type: r.vehicle_type, total: num(r.total), bad: num(r.bad),
          pct: num(r.total) ? +(num(r.bad) / num(r.total) * 100).toFixed(3) : 0,
        })),
        sites: sites.rows,
        daily: daily.rows.map((r) => ({
          date: r.d, camera_id: r.camera_id, moto: num(r.moto), no_helmet: num(r.no_helmet),
          car: num(r.car), no_seatbelt: num(r.no_seatbelt), riders3: num(r.riders3),
          cams: num(r.cams),
        })),
        no_detect_min_sample: NO_DETECT_MIN_SAMPLE,
      });
    } catch (err) { routeError(res, err, 'GET /api/traffic/enforcement'); }
  });

  // GET /api/traffic/helmet-series — หน้า "สถิติหมวกนิรภัย" (pilot/demo)
  // ต่างจาก /enforcement ตรงที่กรองด้วยกล้อง/ไม่เปิดตรวจจับจริงในฝั่ง SQL
  // (ไม่ใช่ scale ฝั่งหน้าจอแบบ trfShare()) เพราะ hourly/daily ทั้งคู่ต้องการ
  // "อัตราของขอบเขตที่เลือกจริง" ไม่ใช่ "อัตรารวมระบบที่สเกลปริมาณ"
  const parseDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  // เหตุผลเดียวกับ /enforcement ด้านบน — ไม่ใส่ auth.requireAuth ซ้ำ
  app.get('/api/traffic/helmet-series', async (req, res) => {
    try {
      // Site-RBAC (P1, src/auth.js) — ดูหมายเหตุเดียวกันที่ /enforcement ด้านบน
      const allowedSites = resolveSiteScope(req);
      if (allowedSites !== null && allowedSites.length === 0) {
        const y = await pool.query(`SELECT to_char((now() AT TIME ZONE '${TZ}')::date - 1, 'YYYY-MM-DD') AS d`);
        return res.json({
          ok: true, date: y.rows[0].d, generated_at: new Date().toISOString(),
          hourly: [], daily: [], realtime: [], cameras: [], sites: [],
          no_detect_min_sample: NO_DETECT_MIN_SAMPLE,
        });
      }
      const cams = parseCams(req.query.cameras, req);
      const swBase = siteWhere(allowedSites, 't.camera_id', 2);

      const [camRows, sites] = await Promise.all([
        // ฐาน 28 วันคงที่ ใช้ทั้งตัดสิน detect และเป็น list ให้ picker เลือก
        // ไม่กรองด้วย camFilter — หน้าจอต้องเห็นกล้องทั้งหมดเพื่อให้เลือกได้
        // (แต่ยังกรองด้วย swBase — ขอบเขต Site ตาม RBAC)
        pool.query(`
          SELECT t.camera_id,
                 coalesce(c.name, t.camera_id) AS name,
                 s.code AS site_code, s.name AS site_name, s.color AS site_color,
                 sum(t.n_total)     FILTER (WHERE t.vehicle_type = ANY($1)) AS moto,
                 sum(t.n_no_helmet) FILTER (WHERE t.vehicle_type = ANY($1)) AS no_helmet
            FROM traffic_hourly_stats t
            LEFT JOIN cameras c ON c.id = t.camera_id
            LEFT JOIN sites   s ON s.id = c.site_id
           WHERE t.bucket_hour >= date_trunc('hour', now()) - interval '28 days'
             ${swBase.sql}
           GROUP BY 1,2,3,4,5`, [MOTO_TYPES, ...swBase.args]),
        pool.query(`SELECT id, code, name, color FROM sites ${allowedSites ? 'WHERE id = ANY($1)' : ''} ORDER BY sort_order, id`,
          allowedSites ? [allowedSites] : []),
      ]);

      const num = (v) => Number(v || 0);
      // กันไม่ให้กล้องยังไม่เปิดตรวจจับ (รถผ่านเยอะแต่ no_helmet=0 ตลอด) ปนเข้า
      // อัตรา — ตัดสินจากฐาน 28 วันคงที่เสมอ ไม่คำนวณรายวัน (มิฉะนั้นกล้อง
      // ปริมาณต่ำจะหลุดเข้ามาผิดในบางวัน) ดู decision #237 / NO_DETECT_MIN_SAMPLE
      const nonDetect = camRows.rows
        .filter(r => num(r.moto) >= NO_DETECT_MIN_SAMPLE && num(r.no_helmet) === 0)
        .map(r => r.camera_id);

      // ขอบเขตเดียวกันใช้กับทั้ง hourly และ daily — สร้าง WHERE clause ร่วม
      // (รวม allowedSites ด้วย — ผู้ใช้ site-scoped ต้องกรองที่ hourly/daily/
      // realtime ทุกก้อน ไม่ใช่แค่ camRows ฐาน 28 วันด้านบน)
      // ⚠️ ต้องเรียก siteWhere() เท่านั้น ห้ามประกอบ clause ของ Site เอง — แกนที่ 2
      // (จำกัดรายกล้อง `user_cameras`) เดินทางมากับ allowedSites เป็น property `cameras`
      // ซึ่งมีแต่ siteWhere() ที่อ่าน · เขียน `site_id = ANY($n)` เองเมื่อไหร่ = แกนกล้อง
      // หายเงียบๆ ทันที (บั๊กจริง 2026-08-12: vss ถูกจำกัดไว้กล้องเดียวแต่เห็นข้อมูล
      // ทั้ง Site — รายการกล้องถูกต้องเพราะมันใช้ siteWhere แต่ตัวเลขไม่ถูกกรอง)
      const scopeFilter = (startIdx) => {
        const clauses = [];
        const params = [];
        let i = startIdx;
        if (cams)            { clauses.push(`t.camera_id = ANY($${i++})`);  params.push(cams); }
        if (nonDetect.length) { clauses.push(`t.camera_id != ALL($${i++})`); params.push(nonDetect); }
        const sw = siteWhere(allowedSites, 't.camera_id', i);
        if (sw.sql) { clauses.push(sw.sql.replace(/^AND /, '')); params.push(...sw.args); i += sw.args.length; }
        return { sql: clauses.length ? 'AND ' + clauses.join(' AND ') : '', params };
      };

      // วันที่ของกราฟ 24 ชม. — ถ้าไม่ระบุ default = เมื่อวาน (ครบ 24 ชม.แน่นอน)
      let date = parseDate(req.query.date);
      if (!date) {
        const y = await pool.query(`SELECT to_char((now() AT TIME ZONE '${TZ}')::date - 1, 'YYYY-MM-DD') AS d`);
        date = y.rows[0].d;
      }

      const scope1 = scopeFilter(3);  // hourly params:   $1=MOTO_TYPES $2=date, scope starts $3
      const scope2 = scopeFilter(2);  // daily params:    $1=MOTO_TYPES,          scope starts $2
      const scope3 = scopeFilter(2);  // realtime params: $1=MOTO_TYPES,          scope starts $2
      const [hourly, daily, realtime, todayRollup] = await Promise.all([
        // ⚠️ no_helmet ต้องกรอง vehicle_type เหมือน moto — เดิม sum() เปล่า ๆ จึงรวม
        // รถ 3 ล้อเข้ามาด้วย (วัดจริง 2026-08-22: 7 วันมี 3 ล้อ 11,952 จาก 470,956 ≈ 2.5%)
        // ⇒ กราฟ 24 ชม. นับคนละอย่างกับกราฟ Realtime บนหน้าเดียวกัน ซึ่งกรอง 2 ล้อล้วน
        //   เอามาเทียบ "วันนี้ vs เมื่อวาน" ไม่ได้เลย ทั้งที่หน้าจอวางไว้ให้เทียบ
        pool.query(`
          SELECT extract(hour FROM t.bucket_hour AT TIME ZONE '${TZ}')::int AS hr,
                 sum(t.n_total)        FILTER (WHERE t.vehicle_type = ANY($1)) AS moto,
                 sum(t.n_no_helmet)    FILTER (WHERE t.vehicle_type = ANY($1)) AS no_helmet,
                 sum(t.n_no_helmet_ok) FILTER (WHERE t.vehicle_type = ANY($1)) AS no_helmet_ok,
                 -- เข็มขัด: sum เปล่าเหมือน /enforcement (n_no_seatbelt มีเฉพาะรถ 4 ล้ออยู่แล้ว)
                 -- เพิ่มเพื่อการ์ดเข็มขัดในหน้าสถิติใหม่ให้มีเส้นรายชั่วโมงเหมือนหมวก
                 sum(t.n_no_seatbelt)                                          AS no_seatbelt
            FROM traffic_hourly_stats t
           -- ช่วงแบบใช้ index ได้ — ผลเท่ากับ (bucket_hour AT TIME ZONE)::date = $2 (md5 ตรงกัน)
           WHERE t.bucket_hour >= ($2::date::timestamp AT TIME ZONE '${TZ}')
             AND t.bucket_hour <  (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')
             ${scope1.sql}
           GROUP BY 1 ORDER BY 1`, [MOTO_TYPES, date, ...scope1.params]),

        // 120 วันคงที่ (เหมือนแนวทางเดิมของ /enforcement) — พอสำหรับสัปดาห์/
        // เดือน/กำหนดเองที่หน้าจอตัดช่วงเอง ไม่ต้อง round-trip ใหม่ทุกครั้งที่สลับมุมมอง
        // กรอง 2 ล้อเหมือน hourly ด้วยเหตุผลเดียวกัน — ก้อนนี้เป็นฐานของมุมมอง
        // สัปดาห์/เดือน/กำหนดเอง ⇒ ตัวเลขย้อนหลังทุกมุมมองจะลดลงตามสัดส่วนรถ 3 ล้อ
        pool.query(`
          SELECT to_char(t.day, 'YYYY-MM-DD') AS d,
                 sum(t.n_total)        FILTER (WHERE t.vehicle_type = ANY($1)) AS moto,
                 sum(t.n_no_helmet)    FILTER (WHERE t.vehicle_type = ANY($1)) AS no_helmet,
                 sum(t.n_no_helmet_ok) FILTER (WHERE t.vehicle_type = ANY($1)) AS no_helmet_ok,
                 -- เข็มขัด: sum เปล่าเหมือน hourly ด้านบน (เกณฑ์ชุดเดียวกับ /enforcement)
                 sum(t.n_no_seatbelt)                                          AS no_seatbelt
            FROM traffic_daily_stats t
           -- ตารางรายวัน (migration 274) · วันแรกเป็นวันเต็ม (เดิมขาด 7 ชม.แรก — เจ้าของเลือก ก. 2026-10-22)
           WHERE t.day >= ((date_trunc('day', now()) - interval '120 days') AT TIME ZONE '${TZ}')::date
             ${scope2.sql}
           GROUP BY 1 ORDER BY 1`, [MOTO_TYPES, ...scope2.params]),

        // ส่วน "วันนี้" (Realtime + ยอดวันนี้) ไม่ขึ้นกับ ?date — หน้าจอยิงคู่ (วันนี้+เมื่อวาน) จึงคิดซ้ำสองรอบ
        // realtime 12 ชม. วัดได้ 4.4 วิ (2026-10-03) · แคช 60 วิ คีย์ = SQL+params จริงของขอบเขต
        // (รวม Site/กล้องตาม RBAC อยู่แล้ว) · wrap รวมคำขอพร้อมกันให้คิดครั้งเดียว (O5)
        SERIES_TODAY.wrap(JSON.stringify([scope3.sql, scope3.params]), () => Promise.all([
          // กราฟ "Realtime" ทุก 30 นาทีของวันนี้ — ไม่ใช้ traffic_hourly_stats
          // (ละเอียดแค่ระดับชั่วโมง) ยิงตรงกับ license_plates แทน ข้อมูลแค่วันเดียว
          // (idx_plates_detected_at) · เดิมวัด ~260ms ตอนข้อมูลน้อย ตอนนี้ 12 ชม. = 4.4 วิ
          pool.query(`
            SELECT extract(hour FROM t.detected_at AT TIME ZONE '${TZ}')::int * 2
                   + (extract(minute FROM t.detected_at AT TIME ZONE '${TZ}')::int / 30) AS slot,
                   count(*) FILTER (WHERE t.vehicle_type = ANY($1)) AS moto,
                   count(*) FILTER (WHERE t.no_helmet AND t.vehicle_type = ANY($1)) AS no_helmet,
                   count(*) FILTER (WHERE t.no_helmet AND t.vehicle_type = ANY($1)
                                          ${helmet.evidenceSql('t')}) AS no_helmet_ok
              FROM license_plates t
             WHERE t.detected_at >= (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')
               AND t.camera_id IS NOT NULL
               ${scope3.sql}
             GROUP BY 1 ORDER BY 1`, [MOTO_TYPES, ...scope3.params]),
          // ยอดวันนี้จากตารางสรุป — แหล่งเดียวกับหน้าอันดับและหน้าป้ายทะเบียน
          pool.query(`SELECT COALESCE(sum(t.n_no_helmet_ok), 0)::bigint AS n
                        FROM traffic_hourly_stats t
                       WHERE t.vehicle_type = ANY($1)
                         AND t.bucket_hour >= date_trunc('day', now() AT TIME ZONE '${TZ}')
                                                AT TIME ZONE '${TZ}' ${scope3.sql}`,
                     [MOTO_TYPES, ...scope3.params])
        ])),
      ]).then(([h, d, [rt, tr]]) => [h, d, rt, tr]);

      res.json({
        ok: true,
        date,
        generated_at: new Date().toISOString(),
        // no_helmet_ok = ตัวเลขที่หน้าจอแสดง (นับเฉพาะครั้งที่มีข้อมูลทะเบียน)
        // n_no_helmet ยังคำนวณและเก็บต่อ แค่ไม่แสดง — ต้องใช้คำนวณและตรวจย้อนหลัง
        // ⚠️ hourly/daily อ่านจากตารางสรุป ซึ่ง bucket ก่อน migration 170 เป็น NULL
        //    ส่ง null ต่อไปตรง ๆ ให้หน้าจอแสดง "—" · แปลงเป็น 0 เมื่อไหร่จะกลายเป็น
        //    "ไม่มีใครทำผิดเลย" ซึ่งอ่านแล้วเหมือนผลลัพธ์จริง ทั้งที่แปลว่ายังไม่รู้
        // no_seatbelt ต้องผ่าน mapper นี้ด้วย — SQL select เพิ่มอย่างเดียวไม่พอ
        // (response ประกอบ field รายตัว ไม่ใช่ส่งแถวดิบ — เคยตกหล่นแล้วการ์ด
        // เข็มขัดหน้าสถิติใหม่ได้เส้นแบน 0 เงียบ ๆ ทั้งที่ total ถูก)
        hourly: hourly.rows.map(r => ({ hour: r.hr, moto: num(r.moto), no_helmet: num(r.no_helmet),
          no_helmet_ok: r.no_helmet_ok == null ? null : num(r.no_helmet_ok),
          no_seatbelt: num(r.no_seatbelt) })),
        daily: daily.rows.map(r => ({ date: r.d, moto: num(r.moto), no_helmet: num(r.no_helmet),
          no_helmet_ok: r.no_helmet_ok == null ? null : num(r.no_helmet_ok),
          no_seatbelt: num(r.no_seatbelt) })),
        realtime: realtime.rows.map(r => ({ slot: r.slot, moto: num(r.moto), no_helmet: num(r.no_helmet),
          no_helmet_ok: num(r.no_helmet_ok) })),
        // 🔴 ยอดของการ์ด Realtime ต้องมาจากตารางสรุป ไม่ใช่ผลรวมของกราฟ
        //
        // กราฟเป็นสล็อต 30 นาที ซึ่งตารางสรุปรายชั่วโมงทำไม่ได้ จึงต้องคิดสด และ
        // ของสดจะนำหน้าตารางสรุปอยู่ไม่เกิน 15 นาทีเสมอ — วัดจริง 2026-08-27
        // กราฟรวมได้ 2,373 ขณะที่หน้าอันดับได้ 2,356 จากข้อมูลชุดเดียวกัน
        //
        // ⇒ ให้ **รูปกราฟยังสด** (ซึ่งคือเหตุผลที่การ์ดนี้มีอยู่) แต่ **ตัวเลขที่คนอ่าน
        //    แล้วเอาไปพูดต่อ** มาจากแหล่งเดียวกับทุกหน้า · ต่างกันเล็กน้อยระหว่าง
        //    ยอดกับผลรวมแท่งสุดท้ายเป็นเรื่องปกติของกราฟ realtime และมี
        //    "ข้อมูล ณ HH:MM" กำกับอยู่แล้ว
        realtime_total_ok: num(todayRollup.rows[0]?.n),
        cameras: camRows.rows.map(r => {
          const moto = num(r.moto), nh = num(r.no_helmet);
          const detect = !(moto >= NO_DETECT_MIN_SAMPLE && nh === 0);
          return {
            id: r.camera_id, name: r.name,
            site_code: r.site_code, site_name: r.site_name, site_color: r.site_color,
            moto, no_helmet: nh, detect,
            helmet_pct: detect && moto ? +(nh / moto * 100).toFixed(2) : null,
          };
        }),
        sites: sites.rows,
        no_detect_min_sample: NO_DETECT_MIN_SAMPLE,
      });
    } catch (err) { routeError(res, err, 'GET /api/traffic/helmet-series'); }
  });

  // GET /api/traffic/helmet-top — แท็บ "อันดับไม่สวมหมวกนิรภัย"
  //
  // ต่างจาก /helmet-series ตรงที่อันนี้เป็นระดับ "ป้ายทะเบียนรายคัน" จึงต้องอ่าน
  // license_plates ตรง ๆ (traffic_hourly_stats เป็นยอดรวม ไม่มีเลขป้าย)
  //
  // ⚠️ เกณฑ์คัดกรองป้ายไม่ใช่ของตกแต่ง — ข้อมูลดิบอันดับต้นคือ 'ข', '1', '111'
  //    ซึ่งเป็นการอ่านไม่ครบ ใช้ออกใบสั่งไม่ได้ · regex ต้อง **anchor ทั้งสตริง**
  //    (วัดแล้ว 2026-08-15: anchor = 885ms / ไม่ anchor = 12.5s บนช่วง 30 วัน
  //     เพราะกรองแถวขยะทิ้งก่อน GROUP BY แทนที่จะไปรวมกลุ่มขยะนับล้าน)
  // 🔴 เดิมสองค่านี้เขียนซ้ำไว้ในไฟล์นี้เอง ทั้งที่หัวไฟล์บรรทัด 30 ห้ามไว้ชัดเจน
  // ผลคือหน้าอันดับใช้เกณฑ์คนละชุดกับหน้าอื่นเงียบ ๆ (ดู scale CTE ที่ถูกลบไป)
  const PLATE_OK = helmet.PLATE_OK;
  // ⚠️ ห้ามใช้เกณฑ์ confidence ตายตัว — แต่ละยี่ห้อใช้สเกลคนละแบบ (วัดจริง 2026-08-16):
  //     ภูเก็ต  Hikvision iDS-2CD9396-HIS → เพดาน 90 เฉลี่ย 87
  //     หาดใหญ่ Dahua     ITC431-RW1F-IRL8 → เพดาน 36 เฉลี่ย 33
  //   เกณฑ์ 85 ที่ตั้งจากภูเก็ตจึงตัดหาดใหญ่ทิ้งทั้งไซต์ (548 ครั้ง → 0 ป้าย)
  //   จึงเทียบกับ "เพดานของกล้องตัวนั้นเอง" แทน — ปรับตัวเองเมื่อมีกล้องยี่ห้อใหม่
  const CONF_RATIO = helmet.CONF_RATIO;
  const MIN_HITS = 3;        // ต้องทำผิดซ้ำอย่างน้อย 3 ครั้งถึงจะขึ้นอันดับ
  // เกณฑ์ "ทำเป็นนิสัย" (เจ้าของอนุมัติ 2026-08-16 · ปรับ 2026-08-17)
  //   ไม่สวมหมวกเกินครึ่งของครั้งที่ผ่านกล้อง — วัดพฤติกรรม ไม่ใช่วัดว่าใครผ่านบ่อย
  //   (1กผ6483 ผ่าน 234 ครั้ง ไม่สวม 57 = 24% เคยขึ้นอันดับ 1 ทั้งที่สวมหมวก 3 ใน 4 ครั้ง)
  // ⚠️ เดิมมีเงื่อนไข "ผ่านกล้องอย่างน้อย 10 ครั้ง" คู่กัน แต่จำนวนครั้งที่ผ่านสะสม
  //    ตามเวลาในวัน ทำให้ช่วงเช้าแทบไม่มีใครเข้าเกณฑ์ — วัดจริง 2026-08-17 เวลา 09:49
  //    มีป้ายเดียวใน 2,254 ป้ายที่ผ่านครบ 10 ครั้ง หน้าจอเลยว่างทั้งเช้า
  //    แทนที่ด้วยการยกเกณฑ์ "ทำผิดซ้ำ" จาก 2 เป็น 3 ครั้ง ซึ่งกันตัวอย่างน้อยได้เหมือนกัน
  //    (อัตราเกินครึ่ง + ผิด 3 ครั้ง ⇒ ผ่านกล้องไม่เกิน 5 ครั้ง) แต่ไม่ผูกกับเวลาในวัน
  //    ผลที่วัดได้: 09:49 ได้ 441 คัน · เต็มวันเมื่อวาน 3,309 คัน

  // เกณฑ์ "จังหวัดยังไม่นิ่ง" — ป้ายบนจอบอกจังหวัดเดียว แต่จริง ๆ mode() เป็นแค่เสียงข้างมาก
  // ⚠️ ห้ามใช้ "อ่านได้มากกว่า 1 จังหวัด" เป็นเกณฑ์ — วัดจริง 2026-08-21 บนป้ายผู้เข้าชิง
  //    37 ใบของเดือนนี้: 28 ใบ (76%) เข้าเกณฑ์นั้น แต่ 23 ใบในนั้นตัวหลักชนะ ≥90%
  //    (1กฌ8363 = สตูล 116 ครั้ง · เบตง 4 · ชลบุรี 2 · ตรัง 2 · สงขลา 2) ⇒ ติดธง 3 ใน 4 แถว
  //    กลายเป็นสัญญาณที่ไม่มีข้อมูล คนอ่านจะเลิกมองภายในวันเดียว
  //    จึงติดธงเมื่อ "จังหวัดรองถูกอ่านซ้ำจนไม่ใช่ความบังเอิญ" แทน = เข้าเกณฑ์ 4 ใน 37 ใบ (11%)
  const REGION_ALT_MIN_N = 3;        // จังหวัดรองต้องถูกอ่านซ้ำอย่างน้อย 3 ครั้ง (กันการอ่านหลุดครั้งเดียว)
  const REGION_ALT_MIN_SHARE = 0.10; // และต้องเป็นอย่างน้อย 10% ของใบที่อ่านจังหวัดออก

  // จังหวัดของแต่ละป้าย — ใช้ร่วมกัน 3 ที่ (หน้าจอ · PDF ใบสั่ง · PDF ตาราง)
  // เดิมเป็น mode() ก๊อบไว้ 3 ก้อน แก้ที่เดียวแล้วอีกสองที่พูดคนละเรื่องได้
  // ⚠️ ยังต้องเรียก **หลัง** CTE ที่ชื่อ srcCte ถูกประกาศแล้วเสมอ
  // ⚠️ region ไม่อยู่ใน covering index — ห้ามย้ายไปคิดใน hit จะเสีย Index Only Scan
  //    ที่นี่แตะแค่ป้ายที่เข้ารอบแล้ว (~200 ใบ)
  // from = แหล่งแถว (default license_plates) · ส่ง CTE ที่กรองช่วงไว้แล้วมาได้ (PDF ตาราง: 'rng') แล้วใส่ rangeSql = 'TRUE'
  const plateRegionCte = (name, srcCte, rangeSql, from = 'license_plates') => `
        ${name}_raw AS (
          SELECT lp.plate_number AS plate, lp.region, count(*)::int AS n
            FROM ${from} lp
           WHERE lp.plate_number IN (SELECT plate FROM ${srcCte})
             AND ${rangeSql}
             -- 'ไม่ทราบ' เป็นค่าที่กล้องบันทึกจริงเมื่ออ่านจังหวัดไม่ออก ไม่ใช่ค่าว่าง
             -- ถ้าไม่ตัดออก จะกลายเป็นเสียงข้างมากทุกครั้งที่อ่านไม่ออกบ่อยกว่าอ่านออก
             -- (1กผ6483: ไม่ทราบ 91 ครั้ง · ภูเก็ต 49 · สตูล 14) แล้วป้ายบนจอขึ้น "ไม่ทราบ"
             -- ทั้งที่ modal ของคันเดียวกันบอกภูเก็ต
             AND lp.region IS NOT NULL AND lp.region NOT IN ('', 'ไม่ทราบ')
           GROUP BY 1, 2
        ),
        ${name} AS (
          -- ⚠️ ทับ mode() เดิมด้วย array_agg ที่ ORDER BY n DESC, region — เท่ากันทุกอย่าง
          --    ยกเว้นตอนคะแนนเสมอ ซึ่ง mode() เลือกมั่ว ๆ ส่วนอันนี้เลือกตัวแรกตามตัวอักษร
          --    (เสมอ = ไม่มีคำตอบที่ถูกอยู่แล้ว ขอให้เดิมนิ่งไว้ก่อน จะได้ไม่สลับไปมาข้ามรอบ)
          SELECT plate,
                 (array_agg(region ORDER BY n DESC, region))[1]            AS region,
                 (array_agg(region ORDER BY n DESC, region))[2]            AS region_2nd,
                 coalesce((array_agg(n ORDER BY n DESC, region))[2], 0)    AS region_2nd_n,
                 sum(n)::int                                              AS region_reads
            FROM ${name}_raw GROUP BY 1
        )`;
  // ใส่ในผลลัพธ์เฉพาะตอนที่จังหวัดรองมีน้ำหนักจริง — ไม่เข้าเกณฑ์ = NULL (หน้าจอไม่ต้องคิดเอง)
  const regionAltSql = (a) => `CASE WHEN ${a}.region_2nd_n >= ${REGION_ALT_MIN_N}
                    AND ${a}.region_2nd_n >= ${a}.region_reads * ${REGION_ALT_MIN_SHARE}`;

  // cache ในหน่วยความจำของ process — อันดับผู้ทำผิดซ้ำไม่ต้อง real-time ระดับวินาที
  // 🔴 key ต้องผูกกับ "ขอบเขตสิทธิ์" ด้วย (sw.sql + sw.args) ไม่ใช่แค่ตัวกรองบนจอ
  //    ไม่งั้นผลของ admin จะถูกเสิร์ฟให้ผู้ใช้ที่ถูกจำกัด Site — ข้อมูลรั่วข้ามไซต์
  // TTL ต่อ period จากนโยบายร่วม (helmetCriteria) — เดิมเป็นค่าคงที่ 120 วิ ขณะที่
  // /api/lpr/stats ใช้ 600 วิ สำหรับ "เมื่อวาน" ⇒ สองหน้าถ่ายภาพคนละนาที เลขไม่ตรงกัน
  // 18 แถวทั้งที่นิยามเดียวกัน · ดูเหตุผลเต็มที่ CACHE_TTL_BY_PERIOD
  // ttlMs:0 = ไม่มีค่ากลาง ทุก set ต้องระบุ TTL ของ period นั้นเอง
  const TOP_CACHE = createTtlCache({ name: 'traffic:top', ttlMs: 0, max: 100 });
  const topCacheGet = (key) => TOP_CACHE.get(key);
  const topCacheSet = (key, data, period) => TOP_CACHE.set(key, data, { ttlMs: helmet.ttlFor(period) });
  // ── ช่วงเวลาของแท็บ "อันดับไม่สวมหมวกนิรภัย" ────────────────────────
  //
  // "วันนี้" และ "รายเดือน" ยังยึดขอบเขตแบบ **ปฏิทิน** (เที่ยงคืน / วันที่ 1)
  // ตามเดิม — ต้องตรงกับหน้าป้ายทะเบียนที่ใช้ วันนี้/เดือนนี้ ไม่งั้นตัวเลขสองหน้า
  // ไม่ตรงกันแล้วคนหน้างานจับได้ทันที (เจอจริง 2026-08-16: ตอนตี 2 หน้าหนึ่งโชว์
  // 2,716 อีกหน้า 44,097 เพราะ rolling 24 ชม. vs ตั้งแต่เที่ยงคืน)
  //
  // ที่เปลี่ยน 2026-08-19 ตามคำสั่งเจ้าของ: "รายสัปดาห์" (เดิม = ต้นสัปดาห์ตาม
  // ปฏิทิน) ถูกแทนด้วย "ย้อนหลัง 3/5/7 วัน" + "กำหนดเอง" เพราะชื่อเดิมหลอก —
  // เปิดดูวันพุธได้ข้อมูลแค่ 2 วัน แต่ป้ายเขียนว่า "รายสัปดาห์" (วัดจริง: ปฏิทิน
  // 110,949 ครั้ง vs ย้อนหลัง 7 วันจริง 367,013 ครั้ง — ต่างกัน 3.3 เท่า).
  // เหตุผลเรื่องความสอดคล้องข้างบนไม่เสีย เพราะของใหม่ "ชื่อ" ไม่เหมือนหน้าอื่น
  // แล้ว จึงไม่มีใครคาดว่าตัวเลขต้องเท่ากัน — ส่วนคู่ที่ชื่อตรงกัน (วันนี้/รายเดือน)
  // ยังยึดปฏิทินเหมือนเดิมทุกประการ.
  //
  // คำนวณขอบเขตเป็น Date ใน JS **ที่เดียว** แล้วส่งเข้า SQL เป็น parameter —
  // เป็นแหล่งความจริงเดียวทั้งของ query และของข้อความบอกช่วงวันบนรายงาน PDF.
  // เดิมสองอย่างนี้คนละสูตร (query ใช้ date_trunc / label ใช้ {day:1,week:7,
  // month:30}) ทำให้ PDF พิมพ์ว่า "13–19 ส.ค. (7 วัน)" ทั้งที่ข้างในมีข้อมูลแค่
  // 17–19 ส.ค. — เอกสารที่ใช้อ้างอิงออกใบสั่งคลาดเคลื่อนแบบนั้นไม่ได้.
  const TH_OFFSET_MS = 7 * 60 * 60 * 1000;   // Asia/Bangkok = UTC+7 ทั้งปี ไม่มี DST
  const TOP_PRESET_DAYS = { d3: 3, d5: 5, d7: 7 };
  const TOP_LBL = {
    day: 'วันนี้', yesterday: 'เมื่อวานนี้',
    d3: 'ย้อนหลัง 3 วัน', d5: 'ย้อนหลัง 5 วัน', d7: 'ย้อนหลัง 7 วัน',
    month: 'รายเดือน', custom: 'กำหนดเอง',
  };
  // เที่ยงคืนตามเวลาไทยของ instant ที่ให้มา
  const _thMidnight = (ms) => {
    const d = new Date(ms + TH_OFFSET_MS);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TH_OFFSET_MS);
  };
  const _addDays = (dt, n) => new Date(dt.getTime() + n * 86400000);

  // คืน { period, since, until } — until = null แปลว่า "ถึงตอนนี้"
  // ยึด "ตอนนี้" เป็นหลักเสมอ ไม่ใช่วันล่าสุดที่มีข้อมูล: ปุ่ม "วันนี้"/"เมื่อวานนี้"
  // เป็นวันตามปฏิทินจริง ถ้าไปยึดวันล่าสุดที่มีข้อมูลแล้วไซต์ล่มไป 1 วัน
  // "วันนี้" จะกลายเป็นเมื่อวานโดยไม่บอกใคร
  function resolveTopRange(q) {
    const raw = String(q.period || 'day');
    const today = _thMidnight(Date.now());
    if (raw === 'custom') {
      const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
      if (!ok(q.from) || !ok(q.to)) return null;
      let from = new Date(`${q.from}T00:00:00+07:00`);
      let to   = new Date(`${q.to}T00:00:00+07:00`);
      if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;
      if (from > to) { const t = from; from = to; to = t; }
      return { period: 'custom', since: from, until: _addDays(to, 1) };
    }
    if (raw === 'yesterday') return { period: raw, since: _addDays(today, -1), until: today };
    if (TOP_PRESET_DAYS[raw]) {
      return { period: raw, since: _addDays(today, -(TOP_PRESET_DAYS[raw] - 1)), until: null };
    }
    if (raw === 'month') {
      const d = new Date(Date.now() + TH_OFFSET_MS);
      return { period: 'month',
               since: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - TH_OFFSET_MS),
               until: null };
    }
    return { period: 'day', since: today, until: null };
  }

  // เงื่อนไขช่วงเวลาเป็น parameter — ค่าจากผู้ใช้ (custom) ไม่เคยถูกต่อเป็นสตริง SQL
  // ต้องเรียก **หลัง** args.push(...sw.args) เสมอ ไม่งั้น $ ของ siteWhere เลื่อน
  function topRangeSql(args, r) {
    args.push(r.since);
    let sql = `lp.detected_at >= $${args.length}`;
    if (r.until) { args.push(r.until); sql += ` AND lp.detected_at < $${args.length}`; }
    return sql;
  }

  // ข้อความบอกช่วงวัน — สร้างจาก r ตัวเดียวกับที่ query ใช้ จึงคลาดจากข้อมูลไม่ได้
  function topRangeLabel(r) {
    const fmt = (dt) => dt.toLocaleDateString('th-TH',
      { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
    // until เป็นขอบบนแบบเปิด (<) วันสุดท้ายที่อยู่ในช่วงจริงคือก่อนหน้านั้น 1 มิลลิวินาที
    const lastIn = new Date((r.until ? r.until.getTime() : Date.now()) - 1);
    const a = fmt(r.since), b = fmt(lastIn);
    return a === b ? `${TOP_LBL[r.period]} · ${a}` : `${TOP_LBL[r.period]} · ${a} – ${b}`;
  }

  app.get('/api/traffic/helmet-top', async (req, res) => {
    try {
      const range = resolveTopRange(req.query);
      if (!range) return res.status(400).json({ error: 'custom period needs valid from/to (YYYY-MM-DD)' });
      const period = range.period;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 5), 20);

      // Site-RBAC เหมือน /helmet-series — ไม่มีสิทธิ์ site ไหนเลย = คืนว่าง ไม่ใช่ 403
      // (หน้าจอยังเปิดได้ แต่ไม่มีข้อมูล — ตรงกับพฤติกรรม route อื่นในไฟล์นี้)
      const allowedSites = resolveSiteScope(req);
      if (allowedSites !== null && allowedSites.length === 0) {
        return res.json({ ok: true, period, generated_at: new Date().toISOString(),
          criteria: { plate_pattern: PLATE_OK, conf_ratio: CONF_RATIO, min_hits: MIN_HITS,
                    min_passes: null },
          rows: [], cameras: [], hourly: [], repeat: [], totals: {} });
      }
      const cams = parseCams(req.query.cameras, req);
      const siteCodes = parseCams(req.query.sites);
      // ลำดับ placeholder: $1 = regex ป้าย · $2 = กล้อง (ถ้ามี) · sites · ที่เหลือของ siteWhere
      // siteWhere คืน { sql, args } (ไม่ใช่ params) และรับ offset ของ $ ตัวแรกที่มันจะใช้
      const args = [PLATE_OK];
      if (cams) args.push(cams);
      // กรอง Site ฝั่ง server — เดิมพึ่ง list กล้องจากหน้าจอ ซึ่งแท็บนี้ยืมมาจากแท็บอื่น
      // ถ้าแท็บนั้นยังไม่โหลด list จะว่าง แล้วกลายเป็น "ไม่กรองเลย" ⇒ เลือกหาดใหญ่
      // แต่เห็นข้อมูลทุก Site (เจอจริง 2026-08-16)
      let siteSql = '';
      if (siteCodes) {
        args.push(siteCodes);
        siteSql = ` AND lp.camera_id IN (SELECT c.id FROM cameras c
                      JOIN sites s ON s.id = c.site_id WHERE s.code = ANY($${args.length}))`;
      }
      const sw = siteWhere(allowedSites, 'lp.camera_id', args.length + 1);
      args.push(...sw.args);

      const rangeSql = topRangeSql(args, range);

      // เงื่อนไขชุดเดียวกันบนตารางสรุป — ใช้ $n ตัวเดิมทั้งหมด (args ถูก push ไปแล้ว)
      // จึงไม่มีทางที่สองก้อนนี้จะอ้างช่วงเวลาหรือขอบเขตกล้องคนละชุดกัน
      // ⚠️ ใช้ได้เพราะทุก period ของหน้านี้มีขอบเขตเป็น "วัน" ซึ่งตรงหัวชั่วโมงเสมอ
      //    ถ้าวันหลังมี period ที่ขอบไม่ตรงหัวชั่วโมง (เช่น "1 ชม.ล่าสุด") ต้องกลับไป
      //    คิดสด ไม่งั้นการรวม bucket ทั้งก้อนจะเกินจริง
      const toRollup = (sql) => sql.replace(/\blp\.detected_at\b/g, 't.bucket_hour')
                                   .replace(/\blp\.camera_id\b/g, 't.camera_id');
      const rollupRangeSql = [toRollup(rangeSql),
                              cams ? `t.camera_id = ANY($2)` : '',
                              toRollup(siteSql).replace(/^\s*AND\s+/, ''),
                              toRollup(sw.sql).replace(/^\s*AND\s+/, '')].filter(Boolean).join(' AND ');

      // ขอบเขตวันที่ต้องอยู่ใน key ด้วย — ไม่งั้น custom สองช่วงที่ scope เหมือนกัน
      // จะกินแคชของกันเอง (และ preset ก็หมดอายุเองตอนเที่ยงคืนพอดี เพราะ since เปลี่ยน)
      const cacheKey = JSON.stringify([period, range.since.getTime(),
        range.until ? range.until.getTime() : null, limit, cams, siteCodes, sw.sql, sw.args]);
      const cached = topCacheGet(cacheKey);
      if (cached) return res.json({ ...cached, cached: true });

      // สแกนช่วงเวลาครั้งเดียวแล้วสรุปหลายมุมจาก CTE เดียวกัน
      // (แยกเป็น 5 query ขนานวัดได้ 17 วิ ในช่วง 7 วัน — สแกนซ้ำ 5 รอบ · CTE เดียว 1.4 วิ)
      const q = await pool.query(`
        -- 🔴 หน้านี้เคยคิดเกณฑ์เองสองรอบ และผิดทั้งสองรอบ: รอบแรกเพดานจาก 24 ชม.
        -- (ตัวเลขของอดีตขยับตามเพดานรายวัน · วัดจริง 35→36 เปลี่ยนยอดหาดใหญ่ 16.4%)
        -- รอบสองย้ายมาเป็น CTE ที่คิดสูตรเดียวกับเกณฑ์กลางแต่คนละโค้ด ซึ่งก็ยังเป็น
        -- การเขียนเกณฑ์เองอยู่ดี · ตั้งแต่ 2026-09-18 ไม่มีใครคิดเกณฑ์เองได้อีก
        -- เพราะผลถูกตัดสินตอน INSERT แล้วเก็บเป็น boolean (migration 234)
        -- ผลพลอยได้: CTE scale ที่ต้อง MATERIALIZED ทั้งหน้าต่าง 30 วันหายไปทั้งก้อน
        WITH hit AS MATERIALIZED (
          SELECT lp.plate_number AS plate, lp.camera_id, lp.detected_at, lp.confidence
            FROM license_plates lp
           WHERE ${rangeSql}
             AND lp.no_helmet = true
             AND lp.vehicle_type = 'twoWheelVehicle'
             AND lp.plate_identified
             AND lp.plate_number ~ $1
             ${cams ? 'AND lp.camera_id = ANY($2)' : ''} ${siteSql} ${sw.sql}
        ),
        per_plate AS (
          SELECT plate, count(*)::int AS n, count(DISTINCT camera_id)::int AS cams,
                 max(detected_at) AS last_at, round(avg(confidence))::int AS conf
            FROM hit GROUP BY 1
          -- ผ่านครั้งเดียวไม่ใช่ "ทำผิดซ้ำ" และมีเป็นพัน ๆ ใบ ทำให้อันดับท้ายบวมจนอ่านไม่ได้
          -- (เจ้าของสั่ง 2026-08-16 — อันดับ 5 เคยมี 1,793 ใบในกลุ่ม "1 ครั้ง")
          HAVING count(*) >= ${MIN_HITS}
        ),
        -- คัดผู้เข้าชิงก่อน แล้วค่อยเช็คประเภทรถเฉพาะกลุ่มนี้
        -- ⚠️ เดิมเช็คกับ "ทุกป้ายใน hit" (หลักหมื่น) ⇒ endpoint timeout 30 วิ
        --    ย้ายมาเช็คหลังจัดอันดับ เหลือไม่กี่สิบป้าย
        cand AS (
          SELECT * FROM per_plate ORDER BY n DESC, last_at DESC LIMIT 200
        ),
        -- พฤติกรรม: นับ "ทุกครั้งที่ผ่านกล้อง" ของคันนั้น ไม่ใช้ตัวกรอง confidence
        -- เพราะถ้ากรองด้วย จะเหลือแต่ใบที่ชัด ทำให้อัตราสูงเกินจริงทุกคัน
        beh AS (
          SELECT lp.plate_number AS plate, count(*)::int AS passes,
                 count(*) FILTER (WHERE lp.no_helmet)::int AS offences
            FROM license_plates lp
           WHERE lp.plate_number IN (SELECT plate FROM cand)
             AND ${rangeSql}
             AND lp.vehicle_type = 'twoWheelVehicle'
           GROUP BY 1
        ),
        -- จังหวัดของแต่ละป้าย — ดึงหลังคัดผู้เข้าชิงแล้วเท่านั้น
        ${plateRegionCte('plate_region', 'cand', rangeSql)},
        -- ตัดป้ายที่ "ส่วนใหญ่" ถูกอ่านเป็นรถ 4 ล้อออก — เป็นการอ่านประเภทรถผิด
        -- (บค6306 อ่านเป็นกระบะ 19 ครั้ง สามล้อ 12 ครั้ง ⇒ จริง ๆ คือกระบะ)
        real_moto AS (
          SELECT lp.plate_number AS plate
            FROM license_plates lp
           WHERE lp.plate_number IN (SELECT plate FROM cand)
             AND ${rangeSql}
           GROUP BY 1
          HAVING count(*) FILTER (WHERE lp.vehicle_type = 'twoWheelVehicle')
                 > count(*) / 2.0
        ),
        -- จำนวนครั้งเท่ากัน = อันดับเดียวกัน (dense_rank) ⇒ "Top 10" คือ 10 อันดับ
        -- ไม่ใช่ 10 คัน · หนึ่งอันดับอาจมีหลายป้าย (เจ้าของยืนยันแบบนี้ 2026-08-16)
        ranked AS (
          SELECT *, dense_rank() OVER (ORDER BY n DESC)::int AS rk
            FROM cand
           WHERE plate IN (SELECT plate FROM real_moto)
             AND plate IN (SELECT plate FROM beh WHERE offences * 2 > passes)
        )
        SELECT
          (SELECT json_agg(x ORDER BY x.rank) FROM (
             SELECT r.rk AS rank, r.n AS hits,
                    json_agg(json_build_object('plate', r.plate, 'cams', r.cams,
                             'last_at', r.last_at, 'conf', r.conf,
                             'region', pr.region,
                             -- จังหวัดรองที่มีน้ำหนักพอจะบอกว่า "ยังไม่นิ่ง" (ไม่เข้าเกณฑ์ = null)
                             'region_alt', ${regionAltSql('pr')} THEN pr.region_2nd END,
                             'region_alt_pct', ${regionAltSql('pr')}
                                  THEN round(100.0 * pr.region_2nd_n / pr.region_reads)::int END)
                             ORDER BY r.last_at DESC) AS plates
               FROM ranked r LEFT JOIN plate_region pr ON pr.plate = r.plate
              WHERE r.rk <= ${limit}
              GROUP BY r.rk, r.n) x)                                                    AS rows,
          -- 🔴 นับก่อน แล้วค่อย join ชื่อกล้อง — ห้าม join ก่อนนับ
          --
          -- เดิมเป็น FROM hit h LEFT JOIN cameras c แล้ว GROUP BY ทีหลัง ⇒ planner
          -- เลือก Nested Loop ยิง cameras **ทีละแถวของ hit** (2,695 รอบ) และอ่าน heap
          -- ไปทั้งหมด 59.5 ล้านบล็อก สำหรับตารางที่มี 144 แถว — วัดจริง 2026-08-27:
          -- node นี้กินเวลา 54.5 วินาทีจากทั้ง query 54.8 วินาที
          -- ผลลัพธ์ที่ได้มีแค่ 19 กล้อง ⇒ นับให้เหลือ 19 แถวก่อน แล้ว join ครั้งเดียว
          (SELECT json_agg(x) FROM (
             SELECT g.camera_id AS id, coalesce(c.name, g.camera_id) AS name, g.hits
               FROM (SELECT camera_id, count(*)::int AS hits FROM hit GROUP BY 1) g
               LEFT JOIN cameras c ON c.id = g.camera_id
              ORDER BY g.hits DESC) x)                                                  AS cameras,
          (SELECT json_agg(x) FROM (
             SELECT extract(hour from detected_at AT TIME ZONE '${TZ}')::int AS h,
                    count(*)::int AS hits FROM hit GROUP BY 1 ORDER BY 1) x)            AS hourly,
          (SELECT json_agg(x) FROM (
             SELECT CASE WHEN n = 1 THEN '1' WHEN n <= 3 THEN '2-3' WHEN n <= 7 THEN '4-7'
                         WHEN n <= 14 THEN '8-14' ELSE '15+' END AS band,
                    count(*)::int AS plates FROM per_plate GROUP BY 1) x)               AS repeat,
          (SELECT count(*)::int FROM per_plate)                                          AS cand_total,
          -- 🔴 นับจาก hit (สด) ไม่ได้ ถึงจะดูตรงไปตรงมากว่า — หน้าสถิติหมวกอ่าน
          -- traffic_hourly_stats ซึ่งตามหลังของสดอยู่ไม่เกิน 15 นาที ⇒ สองหน้า
          -- จะไม่มีวันเท่ากันเลย (วัดจริง 2026-08-27: สด 1,806 · ตารางสรุป 1,793)
          -- เจ้าของต้องการให้ทุกหน้าตรงกันเป๊ะ ⇒ ยอมให้เก่ากว่าได้ แต่ต้องตรงกัน
          -- และมี "ข้อมูล ณ HH:MM" กำกับให้ผู้ใช้เห็นเองว่าถ่ายเมื่อไหร่
          -- ⚠️ อันดับด้านล่างยังคิดสดจาก hit เพราะต้องใช้ข้อมูลระดับป้าย ซึ่ง
          --    ตารางสรุปรายชั่วโมงไม่มี — เป็นคนละคำถาม ไม่ใช่ตัวเลขเดียวกัน
          (SELECT COALESCE(sum(t.n_no_helmet_ok), 0)::int
             FROM traffic_hourly_stats t
            WHERE t.vehicle_type = 'twoWheelVehicle'
              AND ${rollupRangeSql})                                                   AS total_hits,
          -- ป้ายไม่ซ้ำทั้งหมดในช่วงเวลา (ไม่กรอง ≥3 ครั้งแบบ per_plate) — สำหรับการ์ดสรุป
          -- ด้านบน ต่างจาก per_plate ที่ใช้จัดอันดับผู้กระทำผิดซ้ำเท่านั้น (เจ้าของสั่ง 2026-08-18)
          (SELECT count(DISTINCT plate)::int FROM hit)                                  AS total_plates,
          -- การ์ด "สูงสุดต่อคัน" เคยอ่านจาก rows[0].hits = อันดับ 1 ของตาราง ซึ่งผ่านกฎ
          -- ผู้กระทำผิดซ้ำมาอีก 3 ชั้น (≥3 ครั้ง · อ่านเป็น 2 ล้อเกินครึ่ง · ผิดเกินครึ่ง
          -- ของจำนวนครั้งที่ผ่านกล้อง) ⇒ เป็นคนละประชากรกับการ์ดที่วางอยู่ติดกัน
          -- วัดจริง 2026-08-22: การ์ดขึ้น 13 แต่ค่าสูงสุดจริงใน 47,013 คือ 77 (กวค366 —
          -- ผ่านกล้อง 268 ครั้ง ผิด ~29% จึงตกเกณฑ์ "ผิดเกินครึ่ง") คนอ่านการ์ดจะสรุปว่า
          -- ไม่มีคันไหนเกิน 13 ซึ่งไม่จริง ⇒ ส่งค่าสูงสุดของ hit มาให้การ์ดใช้ตรง ๆ
          (SELECT max(n)::int FROM (SELECT count(*) AS n FROM hit GROUP BY plate) x)    AS max_per_plate`, args);

      const d = q.rows[0] || {};
      const payload = {
        ok: true, period, generated_at: new Date().toISOString(),
        criteria: { plate_pattern: PLATE_OK, conf_ratio: CONF_RATIO, min_hits: MIN_HITS,
                    min_passes: null },
        // เพดานผู้เข้าชิง 200 ป้ายอาจตัดกลางอันดับ ⇒ อันดับล่างสุดที่แสดงจะมีป้ายไม่ครบ
        // ต้องบอกออกไป ไม่งั้นคอลัมน์ "คัน" ของแถวนั้นต่ำกว่าจริงโดยไม่มีใครรู้
        capped: (d.cand_total || 0) > 200,
        rows: d.rows || [], cameras: d.cameras || [], hourly: d.hourly || [],
        repeat: d.repeat || [],
        // เลขเดียว (2026-08-27) — `detected` (ยอดที่ยังไม่กรอง) ถูกถอดออก
        // ส่วนต่างเอาไปทำอะไรต่อไม่ได้อยู่แล้ว เพราะไม่รู้ทะเบียน = แจ้งใครไม่ได้
        // ⚠️ `plates` เป็น COUNT DISTINCT บวกข้ามชั่วโมงไม่ได้ จึงยังคิดสดจาก hit
        // เสมอ — ห้ามย้ายไปตารางสรุป
        totals: { hits: d.total_hits || 0, plates: d.total_plates || 0,
                  max_per_plate: d.max_per_plate || 0 },
      };
      topCacheSet(cacheKey, payload, period);
      res.json(payload);
    } catch (err) { routeError(res, err, 'GET /api/traffic/helmet-top'); }
  });

  // ── กลุ่ม route รายงาน PDF ที่แยกออกไปเป็นไฟล์ย่อย — เรียกตรงตำแหน่งที่ route
  //    กลุ่มนั้นเคยลงทะเบียนตอนไฟล์นี้ถือครบทุกตัว (ลำดับคือพฤติกรรม)
  //    _brandLogos / _sendNoRowsPdf เป็น function declaration จึง hoist มาถึงตรงนี้ได้
  const pdfDeps = {
    routeError, TZ, parseCams, PLATE_OK, MIN_HITS,
    plateRegionCte, regionAltSql, TOP_LBL,
    resolveTopRange, topRangeSql, topRangeLabel,
    _brandLogos, _sendNoRowsPdf,
  };
  registerCitationPdf(app, pool, pdfDeps);

  // ตอบเป็น PDF เสมอ แม้ไม่มีรายการ — ปุ่มเปิดแท็บใหม่ ถ้าคืน JSON 404 คนกดจะเห็น
  // ข้อความ error ดิบเต็มจอแล้วคิดว่าระบบพัง ทั้งที่แค่ยังไม่มีใครเข้าเกณฑ์
  async function _sendNoRowsPdf(req, res, periodLabel, mode) {
    const logos = await _brandLogos();
    const pdf = await reportRenderer.renderNoticePdf({
      title: 'ยังไม่มีรถเข้าเกณฑ์ในช่วงนี้',
      message: `รายงานนี้นับเฉพาะ<b>ผู้ที่ทำเป็นนิสัย</b> — ไม่สวมหมวกตั้งแต่ ${MIN_HITS} ครั้งขึ้นไป`
        + ` <b>และ</b>เกินครึ่งของครั้งที่ผ่านกล้อง<br>`
        + `ช่วงที่เลือกยังไม่มีคันใดครบเกณฑ์ · ลองเลือกช่วงเวลาที่ยาวขึ้น เช่น รายสัปดาห์หรือรายเดือน`,
      periodLabel, brand: { name: req.brandName || 'Vision Meta Hub' },
      logoB64: logos.header, footerLogoB64: logos.footer,
    });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="helmet-${mode}-empty.pdf"`);
    return res.send(pdf);
  }

  // ── รายละเอียดของป้ายหนึ่งใบ (ให้หน้าต่างที่เด้งจากอันดับใช้) ──────────────────
  // ทำไมไม่ให้หน้าจอเรียก /api/lpr ตรง ๆ: ผู้ใช้ที่ได้สิทธิ์เฉพาะแท็บนี้ (เช่น vss ที่ได้
  // แค่ traffic:helmet + traffic:topHelmet) จะโดน 403 VIEW_NOT_ALLOWED แล้วหน้าจอ
  // ขึ้นว่า "ไม่พบข้อมูลของป้าย" ซึ่งชวนเข้าใจผิดว่าไม่มีข้อมูล (เจ้าของเจอจริง 2026-08-16)
  // การเปิด /api/lpr ให้แท็บนี้ = ให้สิทธิ์ค้นทั้งฐานป้ายทะเบียน กว้างเกินความจำเป็น
  // จึงทำ endpoint แคบ ๆ ที่คืนเฉพาะใบของป้ายที่กดดู และยังคง scope ของผู้ใช้ไว้ครบ
  app.get('/api/traffic/helmet-top/plate', async (req, res) => {
    try {
      const plate = String(req.query.plate || '').trim();
      if (!plate) return res.status(400).json({ error: 'plate required' });
      const allowedSites = resolveSiteScope(req);
      if (allowedSites !== null && allowedSites.length === 0) return res.json([]);
      const args = [plate];
      const cams = parseCams(req.query.cameras, req);
      if (cams) args.push(cams);
      const siteCodes = parseCams(req.query.sites);
      let siteSql = '';
      if (siteCodes) {
        args.push(siteCodes);
        siteSql = ` AND lp.camera_id IN (SELECT c.id FROM cameras c
                      JOIN sites s ON s.id = c.site_id WHERE s.code = ANY($${args.length}))`;
      }
      const sw = siteWhere(allowedSites, 'lp.camera_id', args.length + 1);
      args.push(...sw.args);
      const q = await pool.query(`
        SELECT e.id, e.camera_id, e.event_time, e.event_type,
               e.snapshot_filename AS snapshot_file,
               -- ปิดบัง IP/MAC ของกล้องใน rawXml สำหรับผู้ที่ไม่ใช่ admin
               -- (security backlog 2026-08-12 · S1 — เหมือน /api/lpr, commit d3fe320)
               ${req.user?.role === 'admin' ? 'e.raw_json' : `${scrubRawJsonSql('e.raw_json')} AS raw_json`},
               lp.plate_number, lp.region AS lp_region,
               lp.vehicle_type AS lp_vehicle_type,
               lp.vehicle_color AS lp_vehicle_color,
               lp.vehicle_brand AS lp_vehicle_brand,
               lp.plate_image, lp.confidence,
               lp.bbox_x, lp.bbox_y, lp.bbox_width, lp.bbox_height,
               lp.vehicle_bbox_x, lp.vehicle_bbox_y, lp.vehicle_bbox_width, lp.vehicle_bbox_height
          FROM license_plates lp
          JOIN events e ON e.id = lp.event_id
         WHERE lp.plate_number = $1
           AND lp.no_helmet = true
           AND lp.detected_at > now() - interval '30 days'
           ${cams ? 'AND lp.camera_id = ANY($2)' : ''} ${siteSql} ${sw.sql}
         ORDER BY lp.detected_at DESC
         LIMIT 12`, args);
      res.json(q.rows);
    } catch (err) { routeError(res, err, 'GET /api/traffic/helmet-top/plate'); }
  });

  // ── รายงานแบบตาราง: หนึ่งแถวต่อหนึ่งคัน ครอบคลุม "ทุกคันใน 10 อันดับ" ────────────
  // เหตุผลที่ต้องมีแยกจาก report.pdf: ฉบับเดิมทำได้ 10 คัน (คันละหน้า) แต่ 10 อันดับ
  // มีคันจริงมากกว่านั้นมาก — วัดจริง 2026-08-16: รายวัน 224 คัน · รายสัปดาห์ 13 · รายเดือน 11
  // (รายวันแพงสุดเพราะจำนวนครั้งกระจุกที่เลขน้อย หลายคันจึงอยู่อันดับเดียวกัน)
  // mode=text → ไม่ดึงภาพเลย ทำได้ครบทุกคัน · mode=image → ดึงภาพ 3 แบบต่อคัน จึงต้องมีเพดาน
  const TABLE_CAP = { text: 400, image: 250 };

  // โลโก้อ่านจาก branding/ — ย้ายไป helpers/brandLogos.js แล้ว (2026-08-21)
  // เพราะรายงานวิเคราะห์ต้องใช้ footer ชุดเดียวกัน · พฤติกรรมเท่าเดิม:
  // cache ตาม filename:mtime · ไฟล์ไม่มีคืน null (ห้ามเป็นกรอบรูปแตกในเอกสารที่ส่งให้ตำรวจ)
  function _brandLogos() { return brandLogos(pool); }   // function ไม่ใช่ const — ของเดิม hoist ได้ อย่าเปลี่ยนพฤติกรรมนั้น

  registerTablePdf(app, pool, pdfDeps);
};
