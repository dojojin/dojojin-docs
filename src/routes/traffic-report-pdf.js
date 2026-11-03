// ============================================================
// Vigil Platform — Routes: Traffic Enforcement (รายงาน PDF)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// แยกออกจาก routes/traffic.js — route ทั้งหมดในไฟล์นี้ยังลงทะเบียนที่ตำแหน่งเดิมเป๊ะ
// (ลำดับการลงทะเบียนคือพฤติกรรม) จึงต้อง export สองตัว เพราะกลุ่มนี้ถูกคั่นกลางด้วย
// /api/traffic/helmet-top/plate ในไฟล์เดิม
//
// เกณฑ์/ช่วงเวลา/ตัวช่วยที่ใช้ร่วมกับหน้าจอ (PLATE_OK · MIN_HITS · resolveTopRange ·
// _brandLogos · _sendNoRowsPdf) ยังมีชุดเดียวอยู่ที่ traffic.js แล้วส่งเข้ามาทาง deps —
// ห้ามก๊อบมาไว้ที่นี่ ไม่งั้นรายงานกับหน้าจอจะใช้เกณฑ์คนละชุดเงียบ ๆ (ดูหัว traffic.js)
// ============================================================
'use strict';

const { siteWhere, resolveSiteScope } = require('../auth');
const reportRenderer = require('../report-renderer');
const helmet = require('../helpers/helmetCriteria');
const env = require('../config');
const { createHeavyRunner } = require('../helpers/heavyRunner');

// กลุ่มที่ 1 — ใบสั่งรายคัน · ลงทะเบียนต่อจาก GET /api/traffic/helmet-top
function registerCitationPdf(app, pool, {
  routeError, TZ, parseCams, PLATE_OK, MIN_HITS,
  plateRegionCte, regionAltSql, TOP_LBL,
  resolveTopRange, topRangeSql, topRangeLabel,
  _brandLogos, _sendNoRowsPdf,
}) {
  // GET /api/traffic/helmet-top/report.pdf — รายงานให้เจ้าหน้าที่ใช้ประกอบการออกใบสั่ง
  // ใช้เกณฑ์คัดกรองชุดเดียวกับหน้าจอ (PLATE_OK + MIN_CONF) แล้วเลือก "ใบที่ดีที่สุด"
  // ต่อป้ายเป็นหลักฐาน — กลางวัน (08–16 น. **เวลาไทย**) เพราะภาพกลางคืนใช้ยืนยันไม่ได้
  app.get('/api/traffic/helmet-top/report.pdf', async (req, res) => {
    try {
      const range = resolveTopRange(req.query);
      if (!range) return res.status(400).json({ error: 'custom period needs valid from/to (YYYY-MM-DD)' });
      const period = range.period;
      const allowedSites = resolveSiteScope(req);
      if (allowedSites !== null && allowedSites.length === 0) {
        return res.status(404).json({ error: 'no data in scope' });
      }
      const cams = parseCams(req.query.cameras, req);
      const siteCodes = parseCams(req.query.sites);
      const args = [PLATE_OK];
      if (cams) args.push(cams);
      let siteSql = '';
      if (siteCodes) {
        args.push(siteCodes);
        siteSql = ` AND lp.camera_id IN (SELECT c.id FROM cameras c
                      JOIN sites s ON s.id = c.site_id WHERE s.code = ANY($${args.length}))`;
      }
      const sw = siteWhere(allowedSites, 'lp.camera_id', args.length + 1);
      args.push(...sw.args);
      const rangeSql = topRangeSql(args, range);
      // ⚠️ ห้ามเขียนเป็น correlated subquery ต่อแถว — เคยทำแล้ว endpoint ค้างเกิน 180 วิ
      //    ต้องคิดสเกลครั้งเดียวใน CTE แล้ว join (เหมือน /helmet-top)
      const where = `${rangeSql}
           AND lp.no_helmet = true
           AND lp.vehicle_type = 'twoWheelVehicle'
             AND lp.plate_identified
           AND lp.plate_number ~ $1
           ${cams ? 'AND lp.camera_id = ANY($2)' : ''} ${siteSql} ${sw.sql}`;

      // DISTINCT ON = หนึ่งแถวต่อป้าย (ใบที่มั่นใจสูงสุดในช่วงกลางวัน)
      const q = await pool.query(`
        -- เอาผู้เข้าชิงมากกว่า 10 แล้วค่อยตัดเหลือ 10 หลังกรองหลักฐานกลางวัน
        -- ไม่งั้นคันที่ทำผิดเฉพาะกลางคืนจะหลุดออกเงียบ ๆ แล้วรายงานเหลือ 9 คัน
        -- (เจ้าของสั่ง 2026-08-16 "ก็เอาคันอื่นขยับมาแทน")
        -- เพดาน confidence ต่อกล้อง · **หน้าต่างต้องเท่ากับเกณฑ์กลาง 30 วัน**
        -- ไม่ใช่ 24 ชม. แบบเดิม ไม่งั้น PDF คัดคนละชุดกับหน้าจอ ซึ่งคือสิ่งที่
        -- คอมเมนต์บรรทัดถัดไปเตือนไว้เองพอดี (DECISIONS #259)
        -- CTE นี้ยังต้องมีอยู่ เพราะคอลัมน์ % ในตารางใช้ sc.mx เป็นตัวหาร
        WITH scale AS (
          SELECT camera_id, max(confidence) AS mx
            FROM license_plates
           WHERE detected_at > now() - ('${helmet.CEILING_DAYS}' || ' days')::interval
             AND no_helmet = true
           GROUP BY 1
        ),
        -- เกณฑ์ต้องตรงกับหน้าจออันดับเป๊ะ ๆ ไม่งั้นเอกสารที่ใช้ออกใบสั่งมีคันที่จอไม่ยอมรับ:
        -- ต้องทำผิดซ้ำ ≥ ${MIN_HITS} ครั้ง และต้องเป็นรถสองล้อจริง (เคยหลุดรถกระบะเข้ามา)
        all_plate AS (
          SELECT lp.plate_number AS plate, count(*)::int AS hits,
                 count(DISTINCT lp.camera_id)::int AS cams
            FROM license_plates lp
           WHERE ${where}
           GROUP BY 1 HAVING count(*) >= ${MIN_HITS}
        ),
        cand AS (SELECT * FROM all_plate ORDER BY hits DESC LIMIT 400),
        moto AS (
          SELECT lp.plate_number AS plate FROM license_plates lp
           WHERE lp.plate_number IN (SELECT plate FROM cand)
             AND ${rangeSql}
           GROUP BY 1
          HAVING count(*) FILTER (WHERE lp.vehicle_type = 'twoWheelVehicle')
                 > count(*) / 2.0
        ),
        beh AS (
          SELECT lp.plate_number AS plate, count(*)::int AS passes,
                 count(*) FILTER (WHERE lp.no_helmet)::int AS offences
            FROM license_plates lp
           WHERE lp.plate_number IN (SELECT plate FROM cand)
             AND ${rangeSql}
             AND lp.vehicle_type = 'twoWheelVehicle'
           GROUP BY 1
        ),
        -- จัดอันดับ "หลัง" กรองครบแล้ว เพื่อให้เลขอันดับตรงกับหน้าจอเป๊ะ ๆ
        ranked_all AS (
          SELECT c.*, dense_rank() OVER (ORDER BY c.hits DESC)::int AS rk
            FROM cand c
            JOIN moto m ON m.plate = c.plate
            JOIN beh  b ON b.plate = c.plate AND b.offences * 2 > b.passes
        ),
        top AS (SELECT * FROM ranked_all WHERE rk <= 10 ORDER BY hits DESC LIMIT 60),
        -- จังหวัดที่พบบ่อยที่สุดของคันนั้น ไม่นับใบที่กล้องอ่านไม่ออก (เก็บคำว่า 'ไม่ทราบ'
        -- ลงคอลัมน์จริง 27% ของภูเก็ต) — เดิมใช้ค่าจากใบเดียวจึงหายไปดื้อ ๆ
        ${plateRegionCte('prov', 'top', rangeSql)}
        SELECT DISTINCT ON (t.plate)
               t.plate, t.hits, t.cams,
               lp.camera_id AS camera, coalesce(c.name, lp.camera_id) AS "camName",
               lp.plate_color AS "plateColor",
               -- ค่าดิบเทียบข้ามยี่ห้อไม่ได้ (Dahua เต็ม 36) ถ้าพิมพ์ตรง ๆ ตำรวจจะเห็น
               -- "ความมั่นใจ 33%" ในเอกสารที่ใช้ออกใบสั่ง แล้วตีความว่าอ่านไม่แม่น
               -- ทั้งที่เป็นค่าสูงสุดที่กล้องรุ่นนั้นให้ได้ — จึงเทียบเพดานของกล้องตัวนั้น
               CASE WHEN coalesce(sc.mx, 0) > 0
                    THEN round(lp.confidence / sc.mx * 100)::int
                    ELSE lp.confidence::int END AS conf,
               lp.detected_at AS at, lp.plate_image AS "plateImg",
               e.raw_json->>'_snapshot' AS scene,
               coalesce(pv.region, nullif(e.raw_json->>'region', 'ไม่ทราบ')) AS province,
               -- ใบสั่งระบุจังหวัดผิดคือคนละคัน ⇒ ต้องเตือนบนเอกสารเมื่อจังหวัดยังไม่นิ่ง
               ${regionAltSql('pv')} THEN pv.region_2nd END                  AS "provinceAlt",
               ${regionAltSql('pv')}
                    THEN round(100.0 * pv.region_2nd_n / pv.region_reads)::int END AS "provinceAltPct",
               e.id AS "eventId",
               (SELECT count(*)::int FROM ranked_all WHERE rk <= 10) AS "totalInRanks"
          FROM top t
          LEFT JOIN prov pv ON pv.plate = t.plate
          JOIN license_plates lp ON lp.plate_number = t.plate
          JOIN scale sc ON sc.camera_id = lp.camera_id AND ${where}
           AND extract(hour from lp.detected_at AT TIME ZONE '${TZ}') BETWEEN 8 AND 16
          LEFT JOIN cameras c ON c.id = lp.camera_id
          LEFT JOIN events  e ON e.id = lp.event_id
         ORDER BY t.plate, lp.confidence DESC NULLS LAST, lp.detected_at DESC`, args);

      if (!q.rows.length) {
        return _sendNoRowsPdf(req, res, TOP_LBL[period], 'top');
      }
      // DISTINCT ON บังคับ ORDER BY plate — เรียงกลับตามจำนวนครั้งแล้วตัดเหลือ 10 คัน
      const rows = q.rows.sort((a, b) => b.hits - a.hits).slice(0, 10);

      const scopeBits = [];
      if (siteCodes) {
        const sn = await pool.query('SELECT name, code FROM sites WHERE code = ANY($1) ORDER BY sort_order, id', [siteCodes]);
        scopeBits.push(sn.rows.map(r => r.name || r.code).join(', ') || siteCodes.join(', '));
      } else scopeBits.push('ทุก Site');
      if (cams) {
        const cn = await pool.query('SELECT id, name FROM cameras WHERE id = ANY($1) ORDER BY name', [cams]);
        scopeBits.push(cams.length <= 3
          ? cn.rows.map(r => r.name || r.id).join(', ')
          : `${cams.length} กล้องที่เลือกไว้`);
      } else scopeBits.push('ทุกกล้อง');
      const periodLabel = `${topRangeLabel(range)} · ขอบเขต ${scopeBits.join(' · ')}`;

      // ดึงภาพเองฝั่ง server แล้วส่งเป็น base64 — ให้ Puppeteer โหลดเองแล้วค้าง
      // (ยิงทีละใบเร็ว 210ms แต่ 10 ใบพร้อมกันผ่าน networkidle0 ไม่จบสักที)
      const grab = (p, eid) => new Promise((resolve) => {
        if (!p) return resolve(null);
        const q = eid != null ? `?bbox=1&alarm=1&eid=${encodeURIComponent(eid)}` : '';
        const req = require('http').get({
          host: '127.0.0.1', port: env.int('PORT'),
          path: `/snapshots/${encodeURI(p)}${q}`,
          headers: { 'X-Internal-Token': env.str('INTERNAL_API_SECRET') || '' },
          timeout: 20000,
        }, (r) => {
          if (r.statusCode !== 200) { r.resume(); return resolve(null); }
          const bufs = [];
          r.on('data', (c) => bufs.push(c));
          r.on('end', () => resolve(Buffer.concat(bufs).toString('base64')));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      });
      // ดึงพร้อมกันทีละ 4 แถว (เดิมทีละใบ 40 ใบเรียงกัน = 13–21 วิต่อรายงาน · slow-req 1 ต.ค. · O5)
      // ปัญหาเดิมคือ Puppeteer โหลดพร้อมกัน ไม่ใช่ server ดึงพร้อมกัน — ตรงนี้ไม่ผ่าน Puppeteer
      let next = 0;
      const worker = async () => {
        while (next < rows.length) {
          const r = rows[next++];
          [r.sceneB64, r.plateB64] = await Promise.all([
            grab(r.scene, r.eventId),   // กรอบรถฝังมาแล้วจาก ?bbox=1
            grab(r.plateImg, null),
          ]);
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));

      const logos = await _brandLogos();
      const pdf = await reportRenderer.renderHelmetTopPdf({
        baseUrl: `http://127.0.0.1:${env.int('PORT')}`,
        internalToken: env.str('INTERNAL_API_SECRET'),
        rows, periodLabel, brand: { name: req.brandName || 'Vision Meta Hub' },
        logoB64: logos.header, footerLogoB64: logos.footer,
        totalInRanks: rows[0] && rows[0].totalInRanks,
      });
      // 🔴 ห้ามให้ใครแคชรายงาน — path ลงท้าย .pdf ซึ่ง Cloudflare แคชให้เองโดยปริยาย
      //    ตามนามสกุลไฟล์ และเบราว์เซอร์ก็แคชต่อได้เพราะเดิมไม่ได้ส่ง Cache-Control เลย
      //    ผลคือกดปุ่มใหม่หลัง deploy แล้วยังได้ PDF ฉบับเก่า — ตรวจแล้วเจอจริง
      //    2026-08-16 (เจ้าของเห็นกล้องปน/ภาพกลางคืนทั้งที่แก้ไปแล้ว) · เนื้อหาเปลี่ยน
      //    ทุกครั้งที่ข้อมูลเข้าอยู่แล้ว การแคชจึงไม่มีประโยชน์ มีแต่โทษ
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition',
        `inline; filename="helmet-top-${period}-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdf);
    } catch (err) { routeError(res, err, 'GET /api/traffic/helmet-top/report.pdf'); }
  });
}

// กลุ่มที่ 2 — รายงานแบบตาราง + Export PDF ของทั้งหน้า
// ลงทะเบียนต่อจาก GET /api/traffic/helmet-top/plate
function registerTablePdf(app, pool, {
  routeError, TZ, parseCams, PLATE_OK, MIN_HITS,
  plateRegionCte, regionAltSql, TOP_LBL,
  resolveTopRange, topRangeSql, topRangeLabel,
  _brandLogos, _sendNoRowsPdf,
}) {
  // ── รายงานแบบตาราง: หนึ่งแถวต่อหนึ่งคัน ครอบคลุม "ทุกคันใน 10 อันดับ" ────────────
  // เหตุผลที่ต้องมีแยกจาก report.pdf: ฉบับเดิมทำได้ 10 คัน (คันละหน้า) แต่ 10 อันดับ
  // มีคันจริงมากกว่านั้นมาก — วัดจริง 2026-08-16: รายวัน 224 คัน · รายสัปดาห์ 13 · รายเดือน 11
  // (รายวันแพงสุดเพราะจำนวนครั้งกระจุกที่เลขน้อย หลายคันจึงอยู่อันดับเดียวกัน)
  // mode=text → ไม่ดึงภาพเลย ทำได้ครบทุกคัน · mode=image → ดึงภาพ 3 แบบต่อคัน จึงต้องมีเพดาน
  const TABLE_CAP = { text: 400, image: 250 };
  // 28 ต.ค. 14:54–14:57 admin reload แท็บเดิม 7 ครั้ง (URL เดียวกัน) แต่ละครั้งเริ่มคิวรีหนักใหม่
  // ⇒ 5 ตัวชนกันจนช้าเป็น 64–78 วิ · คำขอเหมือนกันรอผลชุดเดียวกัน · พร้อมกันได้ 2 รายงาน
  const _tableRunner = createHeavyRunner({ limit: 2, maxWaitMs: 120000 });

  app.get('/api/traffic/helmet-top/report-table.pdf', async (req, res) => {
    try {
      const range = resolveTopRange(req.query);
      if (!range) return res.status(400).json({ error: 'custom period needs valid from/to (YYYY-MM-DD)' });
      const period = range.period;
      const mode = req.query.mode === 'image' ? 'image' : 'text';
      const cap = Math.min(parseInt(req.query.limit, 10) || TABLE_CAP[mode], TABLE_CAP[mode]);
      const allowedSites = resolveSiteScope(req);
      if (allowedSites !== null && allowedSites.length === 0) {
        return res.status(403).json({ error: 'no site access' });
      }
      const cams = parseCams(req.query.cameras, req);
      const siteCodes = parseCams(req.query.sites);
      const args = [PLATE_OK];
      if (cams) args.push(cams);
      let siteSql = '';
      if (siteCodes) {
        args.push(siteCodes);
        siteSql = ` AND lp.camera_id IN (SELECT c.id FROM cameras c
                      JOIN sites s ON s.id = c.site_id WHERE s.code = ANY($${args.length}))`;
      }
      const sw = siteWhere(allowedSites, 'lp.camera_id', args.length + 1);
      args.push(...sw.args);
      const rangeSql = topRangeSql(args, range);

      // loader ถูกแชร์ระหว่างคำขอที่ key เดียวกัน ⇒ ใช้ได้แต่ค่าที่เก็บไว้ตอนสร้าง key (ห้ามแตะ req)
      const brandName = req.brandName || 'Vision Meta Hub';
      const loader = async () => {
        const q = await pool.query(`
          -- เพดาน confidence ต่อกล้อง · หน้าต่าง 30 วันให้ตรงกับเกณฑ์กลาง (DECISIONS #259)
          -- เดิมเป็น 24 ชม. ⇒ PDF คัดคนละชุดกับหน้าจอ ซึ่งอันตรายกว่าหน้าจอเพี้ยน
          -- เพราะเป็นเอกสารที่เอาไปออกใบสั่งจริง · CTE นี้ยังใช้เป็นตัวหารของคอลัมน์ % ด้วย
          WITH scale AS (
            SELECT camera_id, max(confidence) AS mx
              FROM license_plates
             WHERE detected_at > now() - ('${helmet.CEILING_DAYS}' || ' days')::interval
               AND no_helmet = true
             GROUP BY 1
          ),
          hit AS MATERIALIZED (
            SELECT lp.plate_number AS plate, lp.camera_id, lp.detected_at
              FROM license_plates lp
             WHERE ${rangeSql}
               AND lp.no_helmet = true
               AND lp.vehicle_type = 'twoWheelVehicle'
               AND lp.plate_identified
               AND lp.plate_number ~ $1
               ${cams ? 'AND lp.camera_id = ANY($2)' : ''} ${siteSql} ${sw.sql}
          ),
          per_plate AS (
            SELECT plate, count(*)::int AS n, count(DISTINCT camera_id)::int AS cams
              FROM hit GROUP BY 1 HAVING count(*) >= ${MIN_HITS}
          ),
          cand AS (SELECT * FROM per_plate ORDER BY n DESC LIMIT 600),
          -- แถวในช่วงของผู้เข้าชิงทุกคัน อ่านจาก license_plates ครั้งเดียว (ทุกกล้อง — moto/beh/prov นับข้ามกล้องโดยตั้งใจ)
          -- เดิม moto · beh · prov · ev ต่างคนต่างไล่ idx_plates_number ทีละป้าย ซึ่งต้องเดินประวัติทั้งหมดของป้าย
          -- ก่อนกรองวัน (~31 ms/ป้าย × 575 ป้าย × 4 รอบ = ~60 วิ · EXPLAIN 29 ต.ค.) ⇒ เหลือรอบเดียว
          rng AS MATERIALIZED (
            SELECT lp.id, lp.plate_number, lp.camera_id, lp.detected_at, lp.vehicle_type, lp.no_helmet,
                   lp.region, lp.plate_color, lp.confidence, lp.plate_image, lp.event_id,
                   lp.vehicle_bbox_x, lp.vehicle_bbox_y, lp.vehicle_bbox_width, lp.vehicle_bbox_height
              FROM license_plates lp
             WHERE lp.plate_number IN (SELECT plate FROM cand)
               AND ${rangeSql}
          ),
          moto AS (
            SELECT lp.plate_number AS plate FROM rng lp
             GROUP BY 1
            HAVING count(*) FILTER (WHERE lp.vehicle_type = 'twoWheelVehicle')
                   > count(*) / 2.0
          ),
          beh AS (
            SELECT lp.plate_number AS plate, count(*)::int AS passes,
                   count(*) FILTER (WHERE lp.no_helmet)::int AS offences
              FROM rng lp
             WHERE lp.vehicle_type = 'twoWheelVehicle'
             GROUP BY 1
          ),
          top AS (
            SELECT * FROM (
              SELECT c.*, dense_rank() OVER (ORDER BY c.n DESC)::int AS rk
                FROM cand c
                JOIN moto m ON m.plate = c.plate
                JOIN beh  b ON b.plate = c.plate AND b.offences * 2 > b.passes) z
             WHERE rk <= 10
          ),
          -- จังหวัดที่พบบ่อยที่สุดของคันนั้น โดย "ไม่นับใบที่กล้องอ่านไม่ออก"
          -- กล้องบันทึกคำว่า 'ไม่ทราบ' ลงคอลัมน์จริง (27% ของภูเก็ต) ถ้าเอาใบเดียวมาใช้
          -- รายงานจะขึ้นว่าไม่ทราบทั้งที่อีก 12 ใบของคันเดียวกันอ่านออกหมด
          ${plateRegionCte('prov', 'top', 'TRUE', 'rng')},
          ev AS (
            SELECT t.plate, t.n AS hits, t.cams, t.rk,
                   p.region AS province,
                   ${regionAltSql('p')} THEN p.region_2nd END                  AS "provinceAlt",
                   ${regionAltSql('p')}
                        THEN round(100.0 * p.region_2nd_n / p.region_reads)::int END AS "provinceAltPct",
                   lp.plate_color AS "plateColor",
                   CASE WHEN coalesce(sc.mx, 0) > 0
                        THEN round(lp.confidence / sc.mx * 100)::int
                        ELSE lp.confidence::int END AS conf,
                   lp.detected_at AS at, lp.camera_id AS camera,
                   coalesce(c.name, lp.camera_id) AS "camName",
                   lp.plate_image AS "plateImg", e.raw_json->>'_snapshot' AS scene,
                   e.raw_json->>'nonMotorManned' AS pillion, e.id AS "eventId",
                   lp.vehicle_bbox_x AS bx, lp.vehicle_bbox_y AS by,
                   lp.vehicle_bbox_width AS bw, lp.vehicle_bbox_height AS bh,
                   row_number() OVER (PARTITION BY t.plate ORDER BY
                     -- ใบที่อ่านทะเบียนได้ เรียงตาม "แสง" เป็นชั้น ไม่ใช่ใช่/ไม่ใช่:
                     --   0 = 08–16 กลางวันเต็มที่ · 1 = 06–18 ยังเห็นหน้าได้ · 2 = กลางคืน
                     -- แบบเดิมนับ 07:35 กับ 18:43 เป็นกลางคืนทั้งคู่ ทั้งที่ยังสว่างพอ
                     -- ทำให้บางคันได้ภาพตี 2 ทั้งที่มีใบตอนเช้าอยู่ (เจ้าของทัก 2026-08-16)
                     -- กลางคืนยังหยิบได้อยู่ ถ้าคันนั้นไม่มีใบกลางวันเลยในขอบเขตที่กรอง
                     CASE WHEN extract(hour from lp.detected_at AT TIME ZONE '${TZ}') BETWEEN 8 AND 16 THEN 0
                          WHEN extract(hour from lp.detected_at AT TIME ZONE '${TZ}') BETWEEN 6 AND 18 THEN 1
                          ELSE 2 END ASC,
                     (lp.plate_image IS NOT NULL AND e.raw_json->>'_snapshot' IS NOT NULL) DESC,
                     (lp.vehicle_bbox_width > 0) DESC,
                     lp.confidence DESC NULLS LAST, lp.detected_at DESC)::int AS rn
              FROM top t
              LEFT JOIN prov p ON p.plate = t.plate
              JOIN rng lp ON lp.plate_number = t.plate
               AND lp.no_helmet = true
               -- ⚠️ ตัวกรองกล้อง/Site ต้องใช้ที่นี่ด้วย ไม่ใช่แค่ตอนนับ:
               --    ถ้าลืม จำนวนครั้งจะนับเฉพาะกล้องที่เลือก แต่ภาพและชื่อจุดตรวจจับ
               --    กลับหยิบมาจากกล้องอื่นได้ (เจ้าของเจอจริง 2026-08-16 เลือกกล้องเดียว
               --    แต่รายงานขึ้น C18/C19/C10 ปนมา)
               ${cams ? 'AND lp.camera_id = ANY($2)' : ''} ${siteSql} ${sw.sql}
              JOIN scale sc ON sc.camera_id = lp.camera_id
              LEFT JOIN cameras c ON c.id = lp.camera_id
              LEFT JOIN events  e ON e.id = lp.event_id
          )
          -- เก็บผู้เข้าชิงไว้ 3 ใบต่อคัน — ใบแรกอาจถูกลบตามอายุไปแล้ว (วัดจริง 3 จาก 80
          -- ใบตอบ 404) ถ้าไม่มีสำรอง ช่องภาพในรายงานจะว่างโดยไม่มีทางกู้
          SELECT * FROM ev WHERE rn <= 3 ORDER BY hits DESC, plate, rn`, args);

        const byPlate = new Map();
        for (const r of q.rows) {
          if (!byPlate.has(r.plate)) byPlate.set(r.plate, []);
          byPlate.get(r.plate).push(r);
        }
        const rows = [...byPlate.values()].map(c => Object.assign({}, c[0], { _alt: c.slice(1) }))
          .sort((a, b) => b.hits - a.hits || (a.plate < b.plate ? -1 : 1));
        if (!rows.length) return { empty: true };
        const total = rows.length;
        const shown = rows.slice(0, cap);

        if (mode === 'image') {
          // ดึงภาพขนานกัน — ทีละใบเคยวัดได้ 655ms/คัน ซึ่งแปลว่า 224 คันจะกินเกิน 2 นาที
          const grab = (p, q2) => new Promise((resolve) => {
            if (!p) return resolve(null);
            const r2 = require('http').get({
              host: '127.0.0.1', port: env.int('PORT'),
              path: `/snapshots/${encodeURI(p)}${q2 || ''}`,
              headers: { 'X-Internal-Token': env.str('INTERNAL_API_SECRET') || '' },
              timeout: 25000,
            }, (r3) => {
              if (r3.statusCode !== 200) { r3.resume(); return resolve(null); }
              const bufs = []; r3.on('data', (c) => bufs.push(c));
              r3.on('end', () => resolve(Buffer.concat(bufs)));
            });
            r2.on('error', () => resolve(null));
            r2.on('timeout', () => { r2.destroy(); resolve(null); });
          });
          const sharp = require('sharp');
          let idx = 0;
          const worker = async () => {
            while (idx < shown.length) {
              const r = shown[idx++];
              // ไล่ใบสำรองจนกว่าจะได้ใบที่ภาพยังอยู่จริง — ไฟล์ที่ถูกลบตามอายุยังมีแถวใน DB
              // อยู่ ทำให้เลือกมาแล้วช่องภาพว่าง ทั้งที่ใบอื่นของคันเดียวกันยังมีภาพครบ
              let sceneBox = null, sceneRaw = null, plate = null, used = r;
              for (const c of [r, ...(r._alt || [])]) {
                const [a, b, d] = await Promise.all([
                  grab(c.scene, `?bbox=1&alarm=1&eid=${encodeURIComponent(c.eventId)}&w=560`),
                  grab(c.scene, '?w=900'),
                  grab(c.plateImg, null),
                ]);
                if (a && d) { sceneBox = a; sceneRaw = b; plate = d; used = c; break; }
                // ยังไม่ครบ — เก็บส่วนที่ได้ไว้เผื่อไม่มีใบไหนครบเลย
                if (!sceneBox && a) { sceneBox = a; sceneRaw = b; used = c; }
                if (!plate && d) plate = d;
              }
              // แถวต้องเล่าเรื่องเดียวกับภาพที่แสดง — เวลา/กล้อง/กรอบรถต้องมาจากใบเดียวกัน
              r.at = used.at; r.camera = used.camera; r.camName = used.camName;
              r.eventId = used.eventId; r.conf = used.conf;
              r.bx = used.bx; r.by = used.by; r.bw = used.bw; r.bh = used.bh;
              // ย่อเองเสมอ — ?w= ไม่มีผลกับภาพที่ฝังกรอบแล้ว (วัดจริง: 30 คัน = 11.9MB)
              const shrink = async (buf, w, qy) => {
                if (!buf) return null;
                try {
                  return (await sharp(buf).resize({ width: w, withoutEnlargement: true })
                    .jpeg({ quality: qy }).toBuffer()).toString('base64');
                } catch { return buf.toString('base64'); }
              };
              r.sceneB64 = await shrink(sceneBox, 480, 72);
              r.plateB64 = await shrink(plate, 240, 80);
              // ครอปตัวรถจากกรอบที่กล้องส่งมา (สเกล 0-1000) เผื่อขอบ 8%
              if (sceneRaw && r.bw > 0 && r.bx >= 0 && r.bx <= 1000) {
                try {
                  const im = sharp(sceneRaw); const md = await im.metadata();
                  const pad = 0.08;
                  let x = Math.max(0, Math.round((r.bx / 1000 - pad * r.bw / 1000) * md.width));
                  let y = Math.max(0, Math.round((r.by / 1000 - pad * r.bh / 1000) * md.height));
                  let w = Math.min(md.width - x, Math.round((r.bw / 1000) * (1 + 2 * pad) * md.width));
                  let h = Math.min(md.height - y, Math.round((r.bh / 1000) * (1 + 2 * pad) * md.height));
                  if (w > 10 && h > 10) {
                    r.vehicleB64 = (await sharp(sceneRaw).extract({ left: x, top: y, width: w, height: h })
                      .resize({ width: 260, withoutEnlargement: true }).jpeg({ quality: 78 })
                      .toBuffer()).toString('base64');
                  }
                } catch { /* ครอปไม่ได้ก็ปล่อยว่าง ดีกว่าทั้งรายงานล้ม */ }
              }
            }
          };
          await Promise.all(Array.from({ length: 6 }, worker));
        }

        // เขียนขอบเขตลงบนกระดาษเสมอ — ถ้าไม่เขียน เวลามีข้อสงสัยว่า "กรองกล้องหรือยัง"
        // ต้องไปไล่โค้ดกันใหม่ทุกครั้ง ทั้งที่คำตอบควรอยู่บนเอกสารตรงหน้า
        const scopeBits = [];
        if (siteCodes) {
          const sn = await pool.query('SELECT name, code FROM sites WHERE code = ANY($1) ORDER BY sort_order, id', [siteCodes]);
          scopeBits.push(sn.rows.map(r => r.name || r.code).join(', ') || siteCodes.join(', '));
        } else scopeBits.push('ทุก Site');
        if (cams) {
          const cn = await pool.query('SELECT id, name FROM cameras WHERE id = ANY($1) ORDER BY name', [cams]);
          scopeBits.push(cams.length <= 3
            ? cn.rows.map(r => r.name || r.id).join(', ')
            : `${cams.length} กล้องที่เลือกไว้`);
        } else scopeBits.push('ทุกกล้อง');
        const periodLabel = `${topRangeLabel(range)} · ขอบเขต ${scopeBits.join(' · ')}`;

        const logos = await _brandLogos();
        const pdf = await reportRenderer.renderHelmetTablePdf({
          rows: shown, periodLabel, total, withImages: mode === 'image',
          brand: { name: brandName },
          logoB64: logos.header, footerLogoB64: logos.footer,
          criteriaNote: `นับเฉพาะผู้ที่ทำเป็นนิสัย — ไม่สวมหมวกตั้งแต่ ${MIN_HITS} ครั้งขึ้นไป`
            + ` และเกินครึ่งของครั้งที่ผ่านกล้อง`,
        });
        return { pdf, filename: `helmet-table-${mode}-${period}-${new Date().toISOString().slice(0, 10)}.pdf` };
      };
      // ไม่รวม `_` (cache-buster) — คำขอที่ต่างกันแค่ตัวนั้นต้องรอผลชุดเดียวกัน
      const key = JSON.stringify([mode, cap, range.period, range.since && range.since.toISOString(),
        range.until && range.until.toISOString(), cams, siteCodes, allowedSites, req.brandName || '']);
      const gone = new AbortController();
      res.on('close', () => { if (!res.writableFinished) gone.abort(); });
      const out = await _tableRunner.run(key, loader, gone.signal);
      if (out.empty) return _sendNoRowsPdf(req, res, TOP_LBL[period], 'table');
      // 🔴 ห้ามให้ใครแคชรายงาน — path ลงท้าย .pdf ซึ่ง Cloudflare แคชให้เองโดยปริยาย
      //    ตามนามสกุลไฟล์ และเบราว์เซอร์ก็แคชต่อได้เพราะเดิมไม่ได้ส่ง Cache-Control เลย
      //    ผลคือกดปุ่มใหม่หลัง deploy แล้วยังได้ PDF ฉบับเก่า — ตรวจแล้วเจอจริง
      //    2026-08-16 (เจ้าของเห็นกล้องปน/ภาพกลางคืนทั้งที่แก้ไปแล้ว) · เนื้อหาเปลี่ยน
      //    ทุกครั้งที่ข้อมูลเข้าอยู่แล้ว การแคชจึงไม่มีประโยชน์ มีแต่โทษ
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition',
        `inline; filename="${out.filename}"`);
      res.send(out.pdf);
    } catch (err) {
      if (err.code === 'HEAVY_ABANDONED') return;   // ผู้เรียกปิดหน้าไปแล้ว
      if (err.code === 'HEAVY_BUSY') { res.set('Retry-After', '15'); return res.status(503).json({ error: 'busy' }); }
      routeError(res, err, 'GET /api/traffic/helmet-top/report-table.pdf');
    }
  });

  // POST /api/traffic/export-page.pdf — ปุ่ม "Export PDF" บนแท็บสถิติหมวก/อันดับ
  // (owner ask 2026-09-03) · หน้าเว็บส่ง DOM ของแท็บที่แสดงอยู่มา (กราฟถูกแปลงเป็น
  // <img data:> จากจอแล้ว) แล้ว server จัดหน้าเป็นไฟล์ A4 ให้ — WYSIWYG ตาม filter
  // ที่ผู้ใช้เลือกอยู่โดยไม่ต้อง re-derive อะไรฝั่งนี้ · renderer ปิด JS + บล็อกทุก
  // network request จึงไม่มีทางใช้ HTML นี้ยิงออกไปไหน (กัน SSRF)
  // write-guard: สร้าง PDF จากหน้าจอ ไม่ได้แก้ข้อมูล
  app.post('/api/traffic/export-page.pdf', async (req, res) => {
    try {
      const { html, title, scope, tab } = req.body || {};
      if (typeof html !== 'string' || !html.trim()) return res.status(400).json({ error: 'html required' });
      if (html.length > 9_000_000) return res.status(413).json({ error: 'payload too large' });
      const safeTab = /^[a-zA-Z]{1,24}$/.test(String(tab || '')) ? tab : 'page';
      const logos = await _brandLogos();
      const pdf = await reportRenderer.renderDomSnapshotPdf({
        html, title: String(title || 'รายงาน').slice(0, 120),
        scope: String(scope || '').slice(0, 300),
        brand: { name: req.brandName || 'Vision Meta Hub' },
        logoB64: logos.header, footerLogoB64: logos.footer,
      });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Content-Type', 'application/pdf');
      // ชื่อไฟล์ให้ตรงกับที่ฝั่งหน้าเว็บตั้งไว้ (a.download ชนะอยู่แล้วตอนโหลดผ่านหน้าเว็บ
      // แต่ถ้ามีใครยิง endpoint ตรง ๆ จะได้ไม่ได้ชื่อคนละแบบ)
      const fileBase = safeTab === 'topHelmet' ? 'top-helmet-report' : 'helmet-report';
      res.setHeader('Content-Disposition',
        `attachment; filename="${fileBase}-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdf);
    } catch (err) { routeError(res, err, 'POST /api/traffic/export-page.pdf'); }
  });
}

module.exports = { registerCitationPdf, registerTablePdf };
