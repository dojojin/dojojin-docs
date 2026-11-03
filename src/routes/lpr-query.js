// ============================================================
// Vigil Platform — Routes: LPR Query (Gallery API)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { siteWhere, scopeCacheKey } = require('../auth');
const { createTtlCache } = require('../helpers/ttlCache');
const { watchSiteOk, visibleSites } = require('../helpers/watchScope');
const { createHeavyRunner } = require('../helpers/heavyRunner');
const env = require('../config');
const { registerLprList, registerPlateHistoryAndMismatch } = require('./lpr-list');

// Local "now" in Bangkok (timestamp without tz).
const BKK = `(NOW() AT TIME ZONE 'Asia/Bangkok')`;
// IMPORTANT: api-server forces every connection to SET TIME ZONE 'UTC' (api-server.js:74),
// so a bare `... ::date` boundary would resolve to UTC midnight (= 07:00 Bangkok), dropping
// the first 7h of each local day. Convert the Bangkok-local boundary back to timestamptz with
// `AT TIME ZONE 'Asia/Bangkok'` so day/week/month windows are correct regardless of session TZ.
// NB: ::date::timestamp is required — `date AT TIME ZONE` would cast date→timestamptz
// (wrong direction) and shift the boundary by the session offset.
const BKK_DAY  = `${BKK}::date::timestamp AT TIME ZONE 'Asia/Bangkok'`;

// SQL boolean on e.event_time for a named period. from/to (ISO) used for 'custom'.
// Returns { sql, args } — args are appended positionally by the caller.
// col = คอลัมน์เวลาที่ใช้กรอง · ค่าเริ่มต้น e.event_time เท่ากับพฤติกรรมเดิมทุกที่เรียก
// ต้องเปลี่ยนได้เพราะ /api/lpr/stats เลิก join events แล้ว (ดูเหตุผลใน _computeLprStats)
// แต่ perCamera ยังต้องกรองบน events ⇒ สร้างเงื่อนไข 2 ชุดจากพารามิเตอร์ชุดเดียวกัน
const CUSTOM_MAX_LOOKBACK_DAYS = 31;
function periodClause(period, from, to, startIdx, col = 'e.event_time') {
  switch (period) {
    case 'hour':      return { sql: `${col} >= NOW() - INTERVAL '1 hour'`, args: [] };
    case 'yesterday': return { sql: `${col} >= ${BKK_DAY} - INTERVAL '1 day' AND ${col} < ${BKK_DAY}`, args: [] };
    case 'week':      return { sql: `${col} >= date_trunc('week',  ${BKK}) AT TIME ZONE 'Asia/Bangkok'`, args: [] };
    case 'month':     return { sql: `${col} >= date_trunc('month', ${BKK}) AT TIME ZONE 'Asia/Bangkok'`, args: [] };
    case 'custom': {
      // Compute the placeholder index BEFORE push (args.length is the next slot,
      // 0-based → $startIdx, $startIdx+1). Pushing first made it $2/$3 with only
      // 2 args → $1 unbound → "could not determine data type of parameter $1".
      // ::timestamptz cast keeps the bound params typed.
      const conds = [], args = [];
      if (from) { conds.push(`${col} >= $${startIdx + args.length}::timestamptz`); args.push(from); }
      if (to)   { conds.push(`${col} <= $${startIdx + args.length}::timestamptz`); args.push(to); }
      // 🔴 ไม่มีขอบล่าง = กวาดทั้งประวัติ (license_plates 51M แถว) · เจอใน log 2026-10-01:
      // คำขอ custom ที่ไม่มี from ค้างจนชน statement_timeout 120 วิ (500) และกิน IO จนหน้าอื่นช้าตาม
      // ใส่ขอบล่าง 31 วันให้เอง: จาก `to` ถ้ามี ไม่งั้นนับจากตอนนี้ (เปลี่ยนตัวเลขของคำขอแบบนี้ที่เคยตอบได้)
      if (!from) {
        if (to) conds.unshift(`${col} >= $${startIdx}::timestamptz - INTERVAL '${CUSTOM_MAX_LOOKBACK_DAYS} days'`);
        else conds.push(`${col} >= NOW() - INTERVAL '${CUSTOM_MAX_LOOKBACK_DAYS} days'`);
      }
      return { sql: conds.join(' AND '), args };
    }
    case 'today':
    default:          return { sql: `${col} >= ${BKK_DAY}`, args: [] };
  }
}


// เกณฑ์ "อ่านป้ายชัดพอใช้อ้างอิง" ย้ายไปอยู่ที่เดียวแล้ว — helpers/helmetCriteria.js
// เดิมไฟล์นี้มีเกณฑ์ของตัวเอง (อัตรา 0.90 · ไม่เช็ครูปแบบป้าย · เพดานจาก 24 ชม.)
// ส่วนหน้าอันดับใช้ 0.93 + เช็ครูปแบบป้าย ⇒ หน้าเดียวกันของระบบเดียวกันให้เลขต่างกัน
// 11% โดยไม่มีใครอธิบายได้ · เจ้าของสั่งรวมเป็นเกณฑ์เดียว 2026-08-22
const helmet = require('../helpers/helmetCriteria');
const kpiConf = (prefix) => helmet.evidenceSql(prefix);

const noreadEvSql = (where) => `
    SELECT count(*) FILTER (WHERE COALESCE(e.raw_json->>'plate','') = ''
                               OR e.raw_json->>'plate' = 'unknown') AS noread,
           count(*)                                                 AS vehicles
      FROM events e
     WHERE e.event_type = 'anprAlarm' AND ${where}`;

// ช่วง custom: นับ noread สดทั้งช่วงเคยใช้ 98.6 วิ สำหรับ 7 วัน (วัด 2026-10-06 · 31 วันชนเพดาน 120 วิ)
// ⇒ ชั่วโมงที่อยู่ในช่วงเต็มทั้งชั่วโมงอ่านจาก lpr_hourly_stats · เศษหัว/ท้ายของช่วงและ 1 ชม. ล่าสุด
//   นับสดเหมือนเดิม (refresher เดินทุก 15 นาที ถังจึงนิ่งหลังปิดไป 1 ชม.)
// ผลเท่ากับนับสดเมื่อตารางสรุปตามทัน — ข้อมูลที่ส่งย้อนหลัง (ANR) เกิน 3 ชม. จะเข้าตารางสรุป
//   ในรอบ reconcile ตี 5 ถัดไป (ย้อน 7 วัน) — แหล่งเดียวกับ week/month ที่ใช้อยู่แล้ว
// คืน { A, B } (Date) = ช่วงถังเต็ม [A, B) · null = ไม่มีถังเต็มให้ใช้ → นับสดทั้งช่วงเหมือนเดิม
function rollupSplit(from, to, unitMs, offMs, edgeMs, now) {
  const hi = to ? Date.parse(to) : now;
  const lo = from ? Date.parse(from) : (to ? Date.parse(to) : now) - CUSTOM_MAX_LOOKBACK_DAYS * 86_400_000;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const A = Math.ceil((lo + offMs) / unitMs) * unitMs - offMs;
  const B = Math.min(Math.floor((hi + offMs) / unitMs) * unitMs - offMs, edgeMs);
  return A < B ? { A: new Date(A), B: new Date(B) } : null;
}
// ถังชั่วโมง (lpr_hourly_stats): ขอบบนไม่เกินชั่วโมงปัจจุบัน − 1 ชม. (refresher ทุก 15 นาที)
function noreadSplit(from, to, now = Date.now()) {
  const H = 3600_000;
  return rollupSplit(from, to, H, 0, Math.floor(now / H) * H - H, now);
}
// วันนี้ (period=today): เที่ยงคืนไทยเป็นหัวชั่วโมงพอดี (UTC+7 ไม่มี DST) ⇒ ถังชั่วโมงเต็มเริ่มจากตรงนั้นได้
// ชั่วโมงที่ปิดไปแล้วอ่านจาก lpr_hourly_stats · เหลือขอบสดไม่เกิน ~2 ชม. (ชั่วโมงปัจจุบัน + ชั่วโมงก่อนหน้า)
// เดิมนับสดทั้งวัน: 1.8 วิตอน 06:00 โตเป็น 5–9 วิตอน 18:00 (วัดจริง 2026-10-09: 4.4 วิ × 26 ครั้ง) และเป็นคิวรี
// ที่ช้าที่สุดของหน้านี้ · ตัวเลขเท่าเดิมทุกหลัก (ตรวจใน snapshot REPEATABLE READ เดียวกัน 5 ขอบเขต: admin · viewer ไซต์ · กรองกล้อง · ไซต์+กล้อง · 2026-10-10) ·
// 00:00–02:00 ไทยไม่มีถังเต็มให้ใช้ ⇒ คืน null แล้วนับสดเหมือนเดิม (ช่วงสั้น เร็วอยู่แล้ว)
const bkkDayStartIso = (now = Date.now()) => {
  const D = 86_400_000, OFF = 7 * 3600_000;
  return new Date(Math.floor((now + OFF) / D) * D - OFF).toISOString();
};
const todaySplit = (now = Date.now()) => noreadSplit(bkkDayStartIso(now), undefined, now);
// วันไทย (lpr_dim_daily · day = วันที่ตามเวลาไทย UTC+7 ไม่มี DST): วันเต็มที่จบไปแล้วเท่านั้น
// วันนี้ยังอ่านสดเสมอ (แถวของวันนี้เขียนใหม่ทั้งวันทุกรอบ refresher แต่ช้าได้ถึง 15 นาที)
function daySplit(from, to, now = Date.now()) {
  const D = 86_400_000, OFF = 7 * 3600_000;
  return rollupSplit(from, to, D, OFF, Math.floor((now + OFF) / D) * D - OFF, now);
}
// where / ruWhere = เงื่อนไขช่วง+site+กล้องชุดเดิมของ events (e.) และตารางสรุป (r.) ที่ใช้ args ร่วมกัน
// iA / iB = ตำแหน่ง $ ของ A และ B ที่ผู้เรียกต่อท้าย args
const noreadSplitSql = (where, ruWhere, iA, iB) => `
  SELECT COALESCE(SUM(noread), 0)::bigint AS noread, COALESCE(SUM(vehicles), 0)::bigint AS vehicles FROM (
    SELECT r.n_noread_ev AS noread, r.n_anpr_ev AS vehicles
      FROM lpr_hourly_stats r
     WHERE ${ruWhere} AND r.bucket_hour >= $${iA}::timestamptz AND r.bucket_hour < $${iB}::timestamptz
    UNION ALL
    ${noreadEvSql(`${where} AND (e.event_time < $${iA}::timestamptz OR e.event_time >= $${iB}::timestamptz)`)}
  ) x`;

// ── ตัวเลขระดับป้าย 4 ตัว: unique · local (เห็น ≥2) · visitor (=1) · mismatch ─────────────
// COUNT DISTINCT บวกข้ามช่วงเวลาไม่ได้ จึงคิดสดทั้งช่วงเสมอ · ทางเต็มและ ?part=plates ใช้ตัวนี้ตัวเดียว
// วัด 2026-10-06 custom 30 วัน (24.9 ล้านแถว): เดิม temp 8.3 + คำนวณ 41.5 วิ — COUNT(DISTINCT) บังคับ
//   เรียง 25 ล้านแถวลงดิสก์ 1.28 GB ด้วย collation en_US · ตอนนี้ 2 อย่าง:
//   1) temp table เป็น COLLATE "C" — เทียบ byte ไม่ใช่ตามภาษา (41.5 → 22.6 วิ)
//   2) แตก COUNT(DISTINCT vehicle_type) เป็น GROUP BY อีกชั้น ⇒ HashAggregate ได้ (→ 18.8 วิ)
//   ผล 4 ตัวตรงกันทุกหลักใน snapshot เดียวกัน · work_mem 256MB ได้อีกแค่ 1 วิ แลกหน่วยความจำ ~1 GB ⇒ ไม่ใช้
// nt = จำนวนประเภทรถที่รู้จักต่อ (ป้าย, จังหวัด) = COUNT(DISTINCT vehicle_type) FILTER (ไม่ NULL / unknown) เดิม
// ต้องอยู่บน client เดียวกันทั้งหมด (TEMP TABLE ผูกกับ session)
const PLATE_COUNTS_SQL = `
  WITH prv AS (
    SELECT plate_number, region, vehicle_type, COUNT(*) AS c
      FROM _lpr_pp WHERE plate_number <> 'unknown' GROUP BY 1, 2, 3),
  plate_region AS (
    SELECT plate_number, region, SUM(c) AS rc,
           COUNT(*) FILTER (WHERE vehicle_type IS NOT NULL AND vehicle_type <> 'unknown') AS nt
      FROM prv GROUP BY 1, 2),
  plate_counts AS (
    SELECT plate_number, SUM(rc) AS c,
           MAX(nt) FILTER (WHERE region IS NOT NULL AND region <> '' AND region <> 'ไม่ทราบ') AS max_nt
      FROM plate_region GROUP BY 1)
  SELECT COUNT(*)                        AS unique,
         COUNT(*) FILTER (WHERE c >= 2)  AS local,
         COUNT(*) FILTER (WHERE c = 1)   AS visitor,
         COUNT(*) FILTER (WHERE max_nt >= 2 AND plate_number NOT IN
           (SELECT plate_number FROM lpr_mismatch_dismissals)) AS mismatch
    FROM plate_counts`;
async function plateCounts(db, whereLp, args) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `CREATE TEMP TABLE _lpr_pp ON COMMIT DROP AS
         SELECT lp.plate_number COLLATE "C" AS plate_number, lp.region COLLATE "C" AS region,
                lp.vehicle_type COLLATE "C" AS vehicle_type
           FROM license_plates lp WHERE ${whereLp}`, args);
    const { rows } = await client.query(PLATE_COUNTS_SQL);
    await client.query('COMMIT');
    const r = rows[0];
    return { unique: parseInt(r.unique, 10), local: parseInt(r.local, 10),
             visitor: parseInt(r.visitor, 10), mismatch: parseInt(r.mismatch, 10) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = function lprQueryRoutes(app, pool, statsPool) {
  // สถิติหนัก (full/kpi/warm) ใช้ pool แยก (api-server ส่งมา) — ไม่แย่ง 15 ช่องของ pool หลักจนหน้าค้นหารอ
  // ไม่ได้ส่งมา (เทสต์/เรียกจากที่อื่น) = ใช้ pool เดียวกันเหมือนเดิม
  const sp = statsPool || pool;
  // เพดาน confidence อุ่นและรีเฟรชโดย helmetCriteria.start() ที่ api-server เรียก
  // ครั้งเดียวให้ทั้งระบบ — KPI หลายจุดสร้าง SQL แบบ sync จึง await ไม่ได้
  // ช่วงไม่กี่วินาทีแรกหลังบูตจะยังไม่กรอง (evidenceSql คืนค่าว่าง) ซึ่งยอมรับได้

  // ── /api/lpr/stats cache ────────────────────────────────────────
  // Was ONE slot with a flat 20s TTL. Measured 2026-07-26: period=month costs
  // 17.4s cold (3,088,753 rows materialised, then COUNT DISTINCT over them).
  // A single slot meant switching period — or a second operator with a
  // different site pill — evicted the expensive entry and paid the 17s again.
  //
  // TTL now scales with the window, because staleness means different things at
  // different scales: one more read changes an hourly figure visibly and a
  // monthly one not at all (1 in 3 million). A long TTL on `month` is not a
  // worse answer, it is the same answer.
  // ⚠️ ตารางนี้ย้ายไปอยู่ที่ helmetCriteria แล้ว เพราะหน้าอันดับต้องใช้ค่าเดียวกัน
  // สองหน้าที่ TTL ต่างกันจะแสดงภาพถ่ายคนละนาที แล้วเลขไม่ตรงกันทั้งที่นิยามเดียวกัน
  // (ค่าที่ใช้ยังเป็นชุดเดิมทุกตัว — ย้ายที่อยู่ ไม่ได้เปลี่ยนค่า)
  const LPR_STATS_CACHE_MAX = 24;         // periods × site pills × camera filters
  // Recency refresh on read lives in the helper (`get` moves the key to the end
  // of the Map), so eviction stays LRU rather than "oldest computed" — the warm
  // loop below depends on it to keep `month` from being pushed out.
  // คำขอ stats ที่ cache พลาดต้องผ่านตัวคุมนี้: รวมคำขอซ้ำ + จำกัดจำนวนที่รันพร้อมกัน
  // (ดู helpers/heavyRunner.js) · warm loop เรียก _computeLprStats ตรง ไม่ผ่านตรงนี้
  // 🔴 จำกัดเฉพาะช่วงที่คิดสดจาก license_plates (today/hour/custom) — yesterday/week/month อ่านตารางสรุป
  // และมี warm loop คอยอุ่น จึงรวมคำขอซ้ำอย่างเดียว ไม่ต่อคิว (กันคนเปิดเดือนต้องรอหลัง custom ของคนอื่น)
  const _waitMs = env.int('LPR_STATS_QUEUE_WAIT_MS');
  const _liveFull   = createHeavyRunner({ limit: 1, maxWaitMs: _waitMs });   // ~12 คิวรีขนาน/คำขอ
  const _liveKpi    = createHeavyRunner({ limit: 2, maxWaitMs: _waitMs });
  const _rollupFull = createHeavyRunner({ limit: 4, maxWaitMs: _waitMs });
  const _rollupKpi  = createHeavyRunner({ limit: 4, maxWaitMs: _waitMs });
  const _reportRunner = createHeavyRunner({ limit: 1, maxWaitMs: _waitMs });   // /api/stats/lpr/report: temp table + 6 คิวรี
  const _isRollup = (period) => period === 'yesterday' || period === 'week' || period === 'month';
  const _fullRunner = (period) => (_isRollup(period) ? _rollupFull : _liveFull);
  const _kpiRunner  = (period) => (_isRollup(period) ? _rollupKpi  : _liveKpi);

  const _lprStatsCache = createTtlCache({
    name: 'lpr:stats', ttlMs: 0, max: LPR_STATS_CACHE_MAX });   // ttl มาต่อ entry เสมอ
  // api-server เรียกเมื่อรายการเฝ้าระวังเปลี่ยน (pg_notify 'watchlist_changed', migration 262)
  app.locals.clearLprStatsCache = () => _lprStatsCache.clear();

  const _lprStatsCacheGet = (key) => {
    const v = _lprStatsCache.get(key);
    return v === undefined ? null : v;
  };

  function _lprStatsCacheSet(key, period, data) {
    // เวลาที่ "คำนวณจริง" ไม่ใช่เวลาที่ตอบ — หน้าจอเอาไปแสดงว่า "ข้อมูล ณ HH:MM"
    // เพื่อให้ผู้ใช้ที่เปิดสองหน้าเทียบกันรู้ว่าตัวเลขถ่ายคนละนาที ไม่ใช่ขัดกันเอง
    const at = Date.now();
    if (data && typeof data === 'object') data.generated_at = new Date(at).toISOString();
    _lprStatsCache.set(key, data, {
      // TTL ของ month ต้อง **ไม่สั้นกว่า cadence ของ warm loop** ไม่งั้นจะเกิดช่องว่าง
      // ระหว่าง "cache ตาย" กับ "warm รอบถัดไป" ซึ่งเป็นช่วงที่คนเข้ามาจ่าย cold เต็ม ๆ
      // (ตารางกลางให้ month 30 นาที แต่ warm ยืดเป็น 60 นาทีแล้ว — ดู LPR_WARM_MONTH_EVERY_MS
      // ข้างล่าง · +5 นาทีเผื่อเวลาคำนวณ 9–12 วิ และ jitter ของ setInterval)
      // 🟡 ยกเว้นเฉพาะ month เท่านั้น — hour/today/week ยังใช้ตารางกลางตรง ๆ เพื่อไม่ให้
      // หน้าอื่นที่ใช้ helmet.ttlFor เพี้ยนตาม (อ่าน const แบบ lazy ตอนถูกเรียกจึงไม่ติด TDZ)
      ttlMs: period === 'month'
        ? Math.max(helmet.ttlFor(period), LPR_WARM_MONTH_EVERY_MS + 5 * 60 * 1000)
        : period === 'week'
          ? Math.max(helmet.ttlFor(period), LPR_WARM_WEEK_EVERY_MS + 5 * 60 * 1000)
          : helmet.ttlFor(period),
    });   // เพดาน LPR_STATS_CACHE_MAX + eviction อยู่ใน helper แล้ว
  }

  // ── กลุ่ม route ที่แยกออกไปเป็นไฟล์ย่อย — เรียกตรงตำแหน่งที่ route กลุ่มนั้น
  //    เคยลงทะเบียนตอนไฟล์นี้ถือครบทุกตัว (ลำดับคือพฤติกรรม)
  registerLprList(app, pool);

  // GET /api/lpr/brands — distinct vehicle-brand codes present in data (+ count) to
  // populate the brand filter. Codes → names resolve client-side via _LPR_BRAND.
  // 🔴 เหตุ 2026-08-31 (เจ้าของแจ้งว่า "ยี่ห้อมัน render พลาด"): ช่องกรองยี่ห้อขึ้นเป็น
  // กล่องแคบ ๆ ว่างเปล่า · ต้นเหตุคือ query นี้ใช้เวลา 11.8 วินาที แล้วฝั่งหน้าเว็บ
  // `.catch(() => {})` กลืน error เงียบ ๆ ทำให้ MultiPicker ค้างอยู่กับ select ที่
  // ไม่มี option เลย · ช่องนี้เป็นช่องเดียวในฟอร์มที่โหลดรายการแบบ async ช่องอื่น
  // เติม option แบบ sync จึงไม่มีใครเจอปัญหานี้
  //
  // แก้สองชั้น:
  //  1) ตัด JOIN events ทิ้ง — มันมีไว้เพื่อ site scoping เท่านั้น แต่ license_plates
  //     มี camera_id ของตัวเองอยู่แล้ว (ตรวจแล้ว 291,718/291,718 แถวเท่ากับ
  //     e.camera_id ทุกแถว) · 11.8 วิ → 4.9 วิ
  //  2) cache ผลไว้ — รายการนี้คือ 416 ค่าที่เปลี่ยนช้ามาก ไม่มีเหตุให้คำนวณใหม่
  //     ทุกครั้งที่มีคนเปิดหน้า
  //  3) 🔴 2026-09-06 — เลิกนับจาก license_plates ทั้งตาราง แล้วอ่านจาก rollup รายวัน
  //     `lpr_dim_daily` (dim='vehicle_brand') แทน · ของเดิมยังเป็น Seq Scan เต็ม 31.8M แถว
  //     เพราะไม่มีขอบเวลา: EXPLAIN ANALYZE 5,458 ms / 1.44M buffers
  //     ของใหม่ 33.9 ms / 21k buffers (เร็วขึ้น ~161 เท่า)
  //     ⚠️ ตัวเลขมาจาก rollup ⇒ (ก) ช้ากว่าของจริงได้ไม่เกินหนึ่งรอบ refresh
  //        (ข) นับตั้งแต่ 2026-07-13 เท่านั้น (rollup เริ่มวันนั้น · license_plates เริ่ม 2026-07-03)
  //     วัดจริง: ได้ยี่ห้อครบ 420 ค่าเท่ากันทั้งสองทาง · ยอดต่างกัน -0.04% ถึง -0.07%
  //     ซึ่งเป็นแค่ของวันนี้ที่ยังไม่ถูก rollup — ช่องนี้เป็น "ตัวเลือกยี่ห้อ" ไม่ใช่รายงาน
  //     ความคลาดระดับนี้จึงไม่มีผลต่อการใช้งาน
  const _brandCache = createTtlCache({ name: 'lpr:brands', ttlMs: 30 * 60 * 1000, max: 8 });
  app.get('/api/lpr/brands', async (req, res) => {
    const allowedBr = req.user?.allowedSites ?? null;
    const swBr = siteWhere(allowedBr, 'camera_id', 1);
    // args อย่างเดียวไม่พอเป็นคีย์: admin (null), scope ว่าง และ site+กล้องว่าง ให้ args = []
    // เหมือนกันทั้งสามแต่ SQL คนละอย่าง — ต่อ scope เข้าคีย์ผ่าน wrap ให้แยกกัน (#190 class)
    const key = JSON.stringify(swBr.args);
    try {
      // staleOnError: ถ้ามีของเก่าค้างอยู่ ส่งของเก่าดีกว่าส่งความว่างเปล่า —
      // ช่องกรองที่ว่างหน้าตาเหมือน "ไม่มียี่ห้อในระบบ" ซึ่งไม่จริง
      res.json(await _brandCache.wrap(key, async () => {
        const { rows } = await pool.query(
          `SELECT value AS brand, SUM(n)::int AS n
             FROM lpr_dim_daily
            WHERE dim = 'vehicle_brand' AND value IS NOT NULL AND value <> '' ${swBr.sql}
            GROUP BY value ORDER BY n DESC`,
          swBr.args
        );
        return rows;
      }, { scope: allowedBr, staleOnError: true }));
    } catch (e) {
      console.error('[lpr-query] GET /api/lpr/brands:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  registerPlateHistoryAndMismatch(app, pool);

  // ── "อ่านป้ายไม่ได้" ที่เห็นครบทั้งสองยี่ห้อ (2026-09-08) ──────────────
  // ต้องนับจาก events ไม่ใช่ license_plates เพราะสองยี่ห้อรายงานคนละรูป:
  //   · Dahua (hdy/nrw/rmutr-v) — ไม่มีฟิลด์ `plate` มาเลย และ **ไม่มีแถวใน
  //     license_plates** ⇒ การ์ด KPI เดิมที่นับ plate_number='unknown' มองไม่เห็นเลย
  //   · Hikvision (hkt)         — ส่ง `plate='unknown'` มา **และ** สร้างแถวใน
  //     license_plates ⇒ แท็บ "ไม่ทราบทะเบียน" เดิมที่นับ plate ว่าง มองไม่เห็นเลย
  //   วัดจริง 2026-09-08 หน้าต่าง 24 ชม.: hkt 12,397 · hdy 18,790 · nrw 1,001
  //   · rmutr-v 3,908 — แต่ละหน้าจอเห็นแค่ครึ่งเดียวของความจริง
  //
  // `vehicles` คือตัวหารที่ซื่อสัตย์: `total` นับแถวใน license_plates ซึ่งรวม
  //   unknown ของ Hikvision เข้ามาแต่ไม่มีของ Dahua เลย จึงหารกันไม่ได้
  //
  // 🔴 predicate ต้องเป็น OR สองขา **ห้ามเขียนเป็น IN ('', 'unknown')** — มีดัชนี
  //    บางส่วนสองตัวรองรับคนละขา (idx_events_anpr_noread_time ·
  //    idx_events_anpr_unknown_time สร้างจริง 2026-09-08) เขียนเป็น OR planner
  //    ต่อ BitmapOr ใช้ได้ทั้งคู่ · เขียนเป็น IN planner เลิกใช้ทั้งคู่เงียบ ๆ
  //    วัดจริงคิวรีเดียวกัน หน้าต่าง 24 ชม.: OR 98.9 ms · IN 2,439 ms
  //    เหตุผลเดียวกับ migration 199 — Postgres จับคู่ partial index จาก expression
  //    tree ข้อความจึงต้องตรงกับ WHERE ของดัชนีเป๊ะ (ต่างได้แค่ alias e.)
  //
  // ช่วง yesterday/week/month ไม่เรียกตัวนี้ — อ่าน n_noread_ev / n_anpr_ev จาก
  // lpr_hourly_stats แทน (migration 200) เพราะไม่มีดัชนี (event_type, event_time)
  // การนับสดทั้งเดือนคือการสแกน 15.8 ล้านแถวที่ migration 171 มีไว้เพื่อเลี่ยง
  // noreadEvSql / noreadSplit / noreadSplitSql อยู่ระดับ module (ด้านบน) — เทสต์เรียกตัวเดียวกันได้


  // Extracted so the warmer can produce a cache entry through exactly the same
  // code the request path uses. A warmer that re-implements the query is a
  // warmer that eventually caches something the endpoint would never return.
  async function _computeLprStats(period, q) {
    // เงื่อนไขขอบเขต 2 ชุดจากพารามิเตอร์ชุดเดียวกัน — args เหมือนกันทุกตัวและอยู่ตำแหน่ง
      // เดียวกัน จึงใช้ stArgs ร่วมกันได้:
      //   stSqlLp — กรองบน license_plates (ตารางกลางด้านล่างเลิก join events แล้ว)
      //   stSqlEv — กรองบน events (perCamera ยังต้องใช้ เพราะมันนับ event ที่ไม่มีป้ายด้วย)
      const pc   = periodClause(period, q.from, q.to, 1);
      const pcLp = periodClause(period, q.from, q.to, 1, 'lp.detected_at');
      const swSt   = siteWhere(q.allowedSites ?? null, 'e.camera_id',  pc.args.length + 1);
      const swStLp = siteWhere(q.allowedSites ?? null, 'lp.camera_id', pc.args.length + 1);
      let stSql   = swSt.sql   ? `${pc.sql} ${swSt.sql}`     : pc.sql;
      let stSqlLp = swStLp.sql ? `${pcLp.sql} ${swStLp.sql}` : pcLp.sql;
      const stArgs = [...pc.args, ...swSt.args];
      // In-page site-pill filter (admin/auditor only — allowedSites already
      // narrows viewers). Appended BEFORE `base` is derived so every one of
      // the events-based subqueries below inherits it.
      let camList = null;
      if (q.cameras) {
        const a = String(q.cameras).split(',').map(s => s.trim()).filter(Boolean);
        if (a.length) {
          camList = a; stArgs.push(a);
          stSql   += ` AND e.camera_id = ANY($${stArgs.length})`;
          stSqlLp += ` AND lp.camera_id = ANY($${stArgs.length})`;
        }
      }
        // 🔴 เลิกใช้ TEMP TABLE แล้ว (2026-08-23 · แผนระดับ 2)
        // ของเดิม materialize 15.8 ล้านแถวลงตารางชั่วคราวเพื่อให้ 10 คำสั่งใช้ scan ร่วมกัน
        // แต่ TEMP TABLE ผูกกับ session เดียว ⇒ ทุกคำสั่งต้องยิงบน client ตัวเดียวกัน
        // ⇒ Promise.all ไม่ได้ขนานจริงเลย node-postgres ต่อคิวให้บน connection เดียว
        //   เวลาจึงบวกกันทั้งหมด (เส้นทาง ?part=kpi ค้นพบเรื่องนี้ไปก่อนแล้ว ดูคอมเมนต์ที่นั่น)
        // ตอนนี้ยิงบน pool ตรง ๆ ทุกคำสั่งจึงขนานกันจริง (pool max = 15)
        // และ watch เร็วขึ้น 43 เท่าเมื่อไม่ต้องผ่านตารางกลาง (2.4 วิ → 0.055 วิ)
        // เพราะ planner ขับ join จากฝั่ง lpr_watchlist ที่มีแค่ 33 แถวได้
        //
        // กราฟที่ "รวมยอดล่วงหน้าได้" ย้ายไปอ่านตารางสรุป (migration 171)
        // ⚠️ ใช้ได้เฉพาะช่วงที่ขอบล่างตรงหัวชั่วโมงพอดี — yesterday/week/month
        //   · hour  = now() - 1 ชม. ไม่ตรงหัวชั่วโมง ⇒ รวม bucket ทั้งก้อนจะเกินจริง
        //   · today = ตรงเที่ยงคืนก็จริง แต่ชั่วโมงปัจจุบันในตารางสรุปเก่าได้ถึง 15 นาที
        //     ซึ่งจะไปขัดกับ KPI หมวกที่คิดสด (ทางเลือก B บังคับให้ทุกหน้าตรงกัน)
        //   · custom = ช่วงใดก็ได้
        //   สามอันนี้จึงยังคิดสดจาก license_plates เหมือนเดิม
        const useRollup = ['yesterday', 'week', 'month'].includes(period);
        // เลขหมวกใช้ตารางสรุปกว้างกว่าตัวอื่นหนึ่งช่วง — เพิ่ม today เข้ามาด้วย
        // ⚠️ hour/custom ยังคิดสด: ขอบล่างของสองอันนี้ไม่ตรงหัวชั่วโมง การรวม bucket
        //    ทั้งก้อนจะเกินจริง · today ตรงเที่ยงคืนพอดีจึงปลอดภัย
        const helmetRollup = period === 'today';
        // ขอบเขตของตารางสรุป: เงื่อนไขเวลาชุดเดียวกัน แค่เปลี่ยนชื่อคอลัมน์
        const pcRu = periodClause(period, q.from, q.to, 1, 'r.bucket_hour');
        const swRu = siteWhere(q.allowedSites ?? null, 'r.camera_id', pc.args.length + 1);
        let ruSql = swRu.sql ? `${pcRu.sql} ${swRu.sql}` : pcRu.sql;
        if (camList) ruSql += ` AND r.camera_id = ANY($${stArgs.length})`;
        // มิติรายวันเก็บเป็น date ตามเวลาไทย จึงต้องแปลงขอบเขตจาก timestamptz เป็นวัน
        const pcDim = periodClause(period, q.from, q.to, 1,
          `(d.day::timestamp AT TIME ZONE 'Asia/Bangkok')`);
        const swDim = siteWhere(q.allowedSites ?? null, 'd.camera_id', pc.args.length + 1);
        let dimSql = swDim.sql ? `${pcDim.sql} ${swDim.sql}` : pcDim.sql;
        if (camList) dimSql += ` AND d.camera_id = ANY($${stArgs.length})`;
        const dimQ = (name, alias) => useRollup
          ? `SELECT value AS ${alias}, SUM(n)::bigint AS n FROM lpr_dim_daily d
              WHERE ${dimSql} AND d.dim = '${name}'`
          : `SELECT ${name} AS ${alias}, COUNT(*) AS n FROM license_plates lp WHERE ${stSqlLp}`;

        const nrSplit = period === 'custom' ? noreadSplit(q.from, q.to) : null;
        // today ใช้ถังชั่วโมงเฉพาะ "อ่านป้ายไม่ได้/ยอด anprAlarm" — ตัวเลขอื่นของ today ยังคิดสดเหมือนเดิม
        // (จึงไม่ใช้ nrSplit/hs ตัวเดียวกับ custom ซึ่งสลับ KPI ทั้งชุดไปอ่านตารางสรุป)
        const nrToday = period === 'today' ? todaySplit() : null;
        // ── custom: ส่วนที่บวกได้อ่านตารางสรุป + ขอบสด (รอบ ค #2ก · 2026-10-06) ──────
        // วัด custom 7 วันก่อนแก้: ต่อกล้อง 134.7 วิ · ประเภทรถ 75.5 · จังหวัด 59.8 · KPI/สี/ยี่ห้อ ~13 วิ
        // ⇒ ทั้ง endpoint ชนเพดาน 120 วิ · ถังชั่วโมงเต็ม [A,B) จาก lpr_hourly_stats / วันไทยเต็มจาก
        //   lpr_dim_daily · ส่วนที่เหลือของช่วงนับสดแบบเดิม · ป้ายไม่ซ้ำ/ซ้ำ (COUNT DISTINCT) ยังสดทั้งช่วง
        // A,B ต่อท้าย args ที่ $iA,$iB — ทุกคิวรีที่ใช้ต้องอ้างทั้งคู่ (pg ไม่รับ param ที่ไม่ถูกใช้)
        const hs = nrSplit, ds = period === 'custom' ? daySplit(q.from, q.to) : null;
        const iA = stArgs.length + 1, iB = stArgs.length + 2;
        const hArgs = hs ? [...stArgs, hs.A, hs.B] : stArgs;
        const dArgs = ds ? [...stArgs, ds.A, ds.B] : stArgs;
        const ruIn   = `r.bucket_hour >= $${iA}::timestamptz AND r.bucket_hour < $${iB}::timestamptz`;
        // ขอบสด = สองช่วงแยกกัน [from, A) กับ [B, to] — ห้ามเขียนเป็น `x < A OR x >= B`
        // ขอบกว้าง (ขอบวันของมิติ ≤ 1 วันต่อข้าง) planner เลิกใช้ BitmapOr แล้วสแกนช่วงเต็ม [from, to]
        // ไล่ทิ้งทุกแถวตรงกลาง · วัด 2026-10-06 custom 30 วัน: OR 3.7 วิ (ตัดทิ้ง 24 ล้านแถว · ช้าสุดใน pgss
        // 69.7 วิ) → UNION ALL 158 ms ผลเท่ากัน (md5 ใน snapshot เดียวกัน) · ขอบแคบ (ถังชั่วโมง) ทั้งสองแบบเร็ว
        // noreadSplitSql ยังใช้ OR เพราะขอบแคบเสมอและ OR เร็วกว่าที่นั่น · alias เดิม (lp / e) ข้างนอกไม่ต้องแก้
        const lpLive = `(SELECT * FROM license_plates lp WHERE ${stSqlLp} AND lp.detected_at < $${iA}::timestamptz
                         UNION ALL
                         SELECT * FROM license_plates lp WHERE ${stSqlLp} AND lp.detected_at >= $${iB}::timestamptz) lp`;
        const evLive = `(SELECT * FROM events e WHERE ${stSql} AND e.event_time < $${iA}::timestamptz
                         UNION ALL
                         SELECT * FROM events e WHERE ${stSql} AND e.event_time >= $${iB}::timestamptz) e`;
        const dIn    = `d.day >= ($${iA}::timestamptz AT TIME ZONE 'Asia/Bangkok')::date
                        AND d.day < ($${iB}::timestamptz AT TIME ZONE 'Asia/Bangkok')::date`;
        const helmetLive = `COUNT(*) FILTER (WHERE lp.no_helmet AND lp.vehicle_type = 'twoWheelVehicle')`;
        const helmetOkLive = `COUNT(*) FILTER (WHERE lp.no_helmet AND lp.vehicle_type = 'twoWheelVehicle' ${kpiConf('lp')})`;
        // มิติ (จังหวัด/ประเภท/สี/ยี่ห้อ): ใช้กับ dArgs (A,B = ขอบวันไทย) · keep(col) = เงื่อนไขตัดค่าว่างชุดเดิม
        const dimSplitQ = (name, alias, keep, tail) => `
          SELECT k AS ${alias}, SUM(n)::bigint AS n FROM (
            SELECT value AS k, SUM(n) AS n FROM lpr_dim_daily d
             WHERE ${dimSql} AND d.dim = '${name}' AND ${dIn} GROUP BY 1
            UNION ALL
            SELECT ${name}, COUNT(*) FROM ${lpLive} GROUP BY 1
          ) x WHERE ${keep('k')} GROUP BY 1 ${tail}`;
        const [kpi, noreadEv, watchQ, dup, hourly, province, vtype, direction, dirCams, pcolor, brand, perCamera] =
          await Promise.all([
          // ── ตัวเลข KPI ──────────────────────────────────────────────────
          // ช่วง yesterday/week/month อ่านจากตารางสรุป — หน้ากวดขันก็อ่าน rollup
          // ของตัวเองในช่วงเดียวกัน (traffic_hourly_stats) และทั้งคู่ถูกเติมโดย
          // refresher ตัวเดียวกันในรอบเดียวกัน ⇒ ตัวเลขยังตรงกันตามทางเลือก B
          // ส่วน today/hour ยังคิดสด เพราะกราฟ Realtime ของหน้ากวดขันคิดสดเช่นกัน
          // ⚠️ ยิงสดพร้อมกับ query ระดับป้ายไม่ได้สำหรับ month — สองตัวสแกน
          //    15.8 ล้านแถวพร้อมกันจนชน statement_timeout 120 วินาที (เจอจริง)
          hs ? sp.query(`
            SELECT COALESCE(SUM(total), 0)::bigint AS total, COALESCE(SUM(no_helmet), 0)::bigint AS no_helmet,
                   COALESCE(SUM(no_helmet_ok), 0)::bigint AS no_helmet_ok, COALESCE(SUM(overload), 0)::bigint AS overload
              FROM (
                SELECT SUM(r.n_total) - COALESCE(SUM(r.n_noread), 0) AS total, SUM(r.n_no_helmet) AS no_helmet,
                       SUM(r.n_no_helmet_ok) AS no_helmet_ok, SUM(r.n_riders3) AS overload
                  FROM lpr_hourly_stats r WHERE ${ruSql} AND ${ruIn}
                UNION ALL
                SELECT COUNT(*) FILTER (WHERE lp.plate_number <> 'unknown'), ${helmetLive}, ${helmetOkLive},
                       COUNT(*) FILTER (WHERE lp.rider_count >= 3)
                  FROM ${lpLive}
              ) x`, hArgs) :
          sp.query(useRollup
            // total = **ป้ายที่อ่านได้จริง** ไม่ใช่จำนวนแถวใน license_plates:
            // แถวของ Hikvision ที่อ่านไม่ออกถูกเก็บเป็น plate_number='unknown' อยู่ใน n_total ด้วย
            // ถ้าไม่หักออก การ์ด "ป้ายทั้งหมด" กับ "ไม่ระบุ" จะนับรถคันเดียวกันสองครั้ง
            // (n_noread = ตัวเลข Hikvision-only ซึ่งพอดีกับจำนวนแถว unknown ในตารางป้าย)
            ? `SELECT (SUM(r.n_total) - COALESCE(SUM(r.n_noread), 0))::bigint AS total,
                      -- อ่านป้ายไม่ได้ = นับจาก events ทั้งสองรูป (migration 200)
                      -- n_noread ตัวเดิมยังอยู่ในตาราง แต่มันนับจาก license_plates
                      -- จึงเห็นแต่ Hikvision — ห้ามใช้เป็นเลข KPI อีก
                      SUM(r.n_noread_ev)::bigint    AS noread,
                      SUM(r.n_anpr_ev)::bigint      AS vehicles,
                      SUM(r.n_no_helmet)::bigint    AS no_helmet,
                      SUM(r.n_no_helmet_ok)::bigint AS no_helmet_ok,
                      SUM(r.n_riders3)::bigint      AS overload
                 FROM lpr_hourly_stats r WHERE ${ruSql}`
            // 🔴 today ไม่ได้อยู่ใน useRollup (ตัวเลขระดับป้ายยังต้องสด) แต่ **เลขหมวก
            // ต้องมาจากตารางสรุปเสมอ** ไม่งั้นหน้านี้จะนำหน้าหน้ากวดขันอยู่ 15 นาที
            // ตลอดเวลา แล้วเลขไม่มีวันตรงกัน (เจ้าของเจอ 2026-08-27: 1,393 vs 1,451)
            // ⇒ ดึงมาจาก subquery บนตารางสรุป แทนที่จะนับสดในคอลัมน์เดียวกัน
            // noread/vehicles ไม่ได้อยู่ใน SELECT นี้แล้ว — license_plates ไม่มีแถว
            // ของ Dahua ที่อ่านป้ายไม่ออกเลย ทั้งสองเลขจึงย้ายไปคิวรี `noreadEv`
            // ที่ยิงบน events ขนานกันข้างล่าง (total ยังเป็นยอดแถว license_plates)
            // ตัดแถว unknown ของ Hikvision ออกด้วยเหตุผลเดียวกับสาขา rollup ข้างบน
            : `SELECT COUNT(*) FILTER (WHERE lp.plate_number <> 'unknown') AS total,
                    ${helmetRollup
                      ? `(SELECT COALESCE(SUM(r.n_no_helmet), 0) FROM lpr_hourly_stats r
                           WHERE ${ruSql})                                                 AS no_helmet,
                         (SELECT COALESCE(SUM(r.n_no_helmet_ok), 0) FROM lpr_hourly_stats r
                           WHERE ${ruSql})                                                 AS no_helmet_ok,`
                      : `COUNT(*) FILTER (WHERE lp.no_helmet AND lp.vehicle_type = 'twoWheelVehicle')
                                                                                           AS no_helmet,
                         COUNT(*) FILTER (WHERE lp.no_helmet AND lp.vehicle_type = 'twoWheelVehicle'
                                            ${kpiConf('lp')})                              AS no_helmet_ok,`}
                    COUNT(*) FILTER (WHERE lp.rider_count >= 3)                            AS overload
               FROM license_plates lp WHERE ${stSqlLp}`, stArgs),
          // อ่านป้ายไม่ได้ + ยอด anprAlarm (ตัวหาร) — ดูหมายเหตุที่ noreadEvSql
          // ช่วง rollup ได้ค่านี้มาจาก lpr_hourly_stats ในคิวรีข้างบนแล้ว จึงไม่ยิงซ้ำ
          useRollup ? Promise.resolve({ rows: [{}] })
            : (nrSplit || nrToday) ? sp.query(noreadSplitSql(stSql, ruSql, stArgs.length + 1, stArgs.length + 2),
                                 [...stArgs, (nrSplit || nrToday).A, (nrSplit || nrToday).B])
            : sp.query(noreadEvSql(stSql), stArgs),
          // ตรงเฝ้าระวัง — ต้องสดเสมอ lpr_watchlist เปลี่ยนได้ตลอด (คนเพิ่ม + bridge เขียนทับ)
          // ⚠️ ต้องเป็น WHERE EXISTS ไม่ใช่ COUNT(*) FILTER (WHERE EXISTS ...) —
          //    แบบหลัง planner แปลงเป็น semi-join ไม่ได้ ต้องประเมินทีละแถว (วัดได้ 32 วิ)
          sp.query(
            `SELECT COUNT(*) AS watch FROM license_plates lp
              WHERE ${stSqlLp}
                AND EXISTS (SELECT 1 FROM lpr_watchlist w
                             WHERE w.plate_number = UPPER(lp.plate_number) AND w.active
                               -- Alert Match Mode enforcement — see lpr-alerts.js
                               AND (w.alert_mode <> 'plate_region' OR w.region = lp.region)
                               AND ${watchSiteOk()})`, stArgs),
          // ระดับป้าย — บวกข้ามช่วงเวลาไม่ได้ (COUNT DISTINCT) จึงยังคิดสด · ดู plateCounts() ระดับ module
          // noplates: หน้าจอช่วง custom ขอ 4 ตัวนี้แยกเป็น ?part=plates ให้ส่วนอื่นขึ้นก่อน
          // (ผลรวมกว่า 20 วิของช่วงยาว ไม่ต้องกั้นกราฟที่อ่านตารางสรุปเสร็จใน 2–3 วิ)
          q.noplates ? Promise.resolve(null) : plateCounts(sp, stSqlLp, stArgs),

          // ── กราฟที่รวมยอดล่วงหน้าได้ ────────────────────────────────────
          hs ? sp.query(`
            SELECT hr, SUM(n)::bigint AS n FROM (
              SELECT EXTRACT(HOUR FROM r.bucket_hour AT TIME ZONE 'Asia/Bangkok')::int AS hr, SUM(r.n_total) AS n
                FROM lpr_hourly_stats r WHERE ${ruSql} AND ${ruIn} GROUP BY 1
              UNION ALL
              SELECT EXTRACT(HOUR FROM lp.detected_at AT TIME ZONE 'Asia/Bangkok')::int, COUNT(*)
                FROM ${lpLive} GROUP BY 1
            ) x GROUP BY 1 ORDER BY 1`, hArgs) :
          sp.query(useRollup
            ? `SELECT EXTRACT(HOUR FROM r.bucket_hour AT TIME ZONE 'Asia/Bangkok')::int AS hr,
                      SUM(r.n_total)::bigint AS n
                 FROM lpr_hourly_stats r WHERE ${ruSql} GROUP BY 1 ORDER BY 1`
            : `SELECT EXTRACT(HOUR FROM lp.detected_at AT TIME ZONE 'Asia/Bangkok')::int AS hr,
                      COUNT(*) AS n
                 FROM license_plates lp WHERE ${stSqlLp} GROUP BY 1 ORDER BY 1`, stArgs),
          // กราฟแสดงเฉพาะข้อมูลที่ระบุได้ — ตัด unknown/ไม่ทราบ ออกเหมือนเดิมทุกประการ
          ds ? sp.query(dimSplitQ('region', 'name',
                  (c) => `${c} IS NOT NULL AND ${c} <> '' AND ${c} <> 'ไม่ทราบ'`, 'ORDER BY n DESC LIMIT 6'), dArgs) :
          sp.query(`${dimQ('region', 'name')}
              AND ${useRollup ? 'value' : 'lp.region'} IS NOT NULL
              AND ${useRollup ? 'value' : 'lp.region'} <> '' AND ${useRollup ? 'value' : 'lp.region'} <> 'ไม่ทราบ'
              GROUP BY 1 ORDER BY n DESC LIMIT 6`, stArgs),
          ds ? sp.query(dimSplitQ('vehicle_type', 'type',
                  (c) => `${c} IS NOT NULL AND ${c} <> '' AND ${c} <> 'unknown'`, 'ORDER BY n DESC'), dArgs) :
          sp.query(`${dimQ('vehicle_type', 'type')}
              AND ${useRollup ? 'value' : 'lp.vehicle_type'} IS NOT NULL
              AND ${useRollup ? 'value' : 'lp.vehicle_type'} <> '' AND ${useRollup ? 'value' : 'lp.vehicle_type'} <> 'unknown'
              GROUP BY 1 ORDER BY n DESC`, stArgs),
          hs ? sp.query(`
            WITH g AS (
              SELECT r.camera_id, EXTRACT(HOUR FROM r.bucket_hour AT TIME ZONE 'Asia/Bangkok')::int AS hr, SUM(r.n_total) AS n
                FROM lpr_hourly_stats r WHERE ${ruSql} AND ${ruIn} GROUP BY 1, 2
              UNION ALL
              SELECT lp.camera_id, EXTRACT(HOUR FROM lp.detected_at AT TIME ZONE 'Asia/Bangkok')::int, COUNT(*)
                FROM ${lpLive} GROUP BY 1, 2)
            SELECT g.hr, c.lpr_direction AS dir, SUM(g.n)::bigint AS n
              FROM g JOIN cameras c ON c.id = g.camera_id
             WHERE c.lpr_direction IN ('in','out') GROUP BY g.hr, c.lpr_direction`, hArgs) :
          sp.query(useRollup
            ? `WITH g AS (SELECT r.camera_id,
                                 EXTRACT(HOUR FROM r.bucket_hour AT TIME ZONE 'Asia/Bangkok')::int AS hr,
                                 SUM(r.n_total)::bigint AS n
                            FROM lpr_hourly_stats r WHERE ${ruSql} GROUP BY 1, 2)
               SELECT g.hr, c.lpr_direction AS dir, SUM(g.n)::bigint AS n
                 FROM g JOIN cameras c ON c.id = g.camera_id
                WHERE c.lpr_direction IN ('in','out') GROUP BY g.hr, c.lpr_direction`
            : `WITH g AS (SELECT lp.camera_id,
                                 EXTRACT(HOUR FROM lp.detected_at AT TIME ZONE 'Asia/Bangkok')::int AS hr,
                                 COUNT(*) AS n
                            FROM license_plates lp WHERE ${stSqlLp} GROUP BY 1, 2)
               SELECT g.hr, c.lpr_direction AS dir, SUM(g.n)::bigint AS n
                 FROM g JOIN cameras c ON c.id = g.camera_id
                WHERE c.lpr_direction IN ('in','out') GROUP BY g.hr, c.lpr_direction`, stArgs),
          // จำนวนกล้องที่ตั้งทิศทางไว้ — ไม่แตะ events/plates เลย ตัวกรอง site-pill
          // จึงต้องใส่เองที่นี่ ไม่ได้สืบทอดมาจาก stSql
          camList
            ? sp.query(`SELECT lpr_direction AS dir, COUNT(*) AS n
                            FROM cameras WHERE lpr_direction IN ('in','out') AND id = ANY($1) GROUP BY dir`, [camList])
            : sp.query(`SELECT lpr_direction AS dir, COUNT(*) AS n
                            FROM cameras WHERE lpr_direction IN ('in','out') GROUP BY dir`),
          ds ? sp.query(dimSplitQ('plate_color', 'color',
                  (c) => `${c} IS NOT NULL AND ${c} NOT IN ('', 'unknown', 'ไม่ทราบ')`, 'ORDER BY n DESC'), dArgs) :
          sp.query(`${dimQ('plate_color', 'color')}
              AND ${useRollup ? 'value' : 'lp.plate_color'} IS NOT NULL
              AND ${useRollup ? 'value' : 'lp.plate_color'} NOT IN ('', 'unknown', 'ไม่ทราบ')
              GROUP BY 1 ORDER BY n DESC`, stArgs),
          ds ? sp.query(dimSplitQ('vehicle_brand', 'code',
                  (c) => `${c} IS NOT NULL AND ${c} NOT IN ('', '0')`, 'ORDER BY n DESC LIMIT 10'), dArgs) :
          sp.query(`${dimQ('vehicle_brand', 'code')}
              AND ${useRollup ? 'value' : 'lp.vehicle_brand'} IS NOT NULL
              AND ${useRollup ? 'value' : 'lp.vehicle_brand'} NOT IN ('', '0')
              GROUP BY 1 ORDER BY n DESC LIMIT 10`, stArgs),
          // จำนวนรถต่อกล้อง — นับจาก events เพราะรวมรถที่อ่านป้ายไม่ออกด้วย
          // จึงมาจาก license_plates ไม่ได้ (ตารางสรุปเก็บไว้ในคอลัมน์ n_vehicle_events)
          // today ก็ใช้ถังชั่วโมงเต็มได้ (todaySplit · ขอบสด ≤ ~2 ชม.) · 27 ต.ค. คิวรีนี้นับ events ทั้งวัน 900k แถว
          // อ่านดิสก์ 1.3 GB ใช้ 4.8 วิตอน probe 18:12 และเป็นตัวเดียวของหน้านี้ที่เกิน 2 วิ · ข้อมูลที่มาช้าเกิน 3 ชม.
          // จะเข้าตัวเลขนี้หลัง reconcile 05:00 (เหมือน custom/week/month)
          (hs || nrToday) ? sp.query(`
            SELECT cam, SUM(n)::bigint AS n FROM (
              SELECT r.camera_id AS cam, SUM(r.n_vehicle_events) AS n
                FROM lpr_hourly_stats r WHERE ${ruSql} AND ${ruIn} AND r.n_vehicle_events IS NOT NULL GROUP BY 1
              UNION ALL
              SELECT e.camera_id, COUNT(*) FROM ${evLive}
               WHERE (e.object_class IN ('Car','Truck','Vehicle','Bicycle') OR e.event_type = 'anprAlarm')
               GROUP BY 1
            ) x GROUP BY 1 ORDER BY n DESC LIMIT 15`, hs ? hArgs : [...stArgs, nrToday.A, nrToday.B]) :
          sp.query(useRollup
            ? `SELECT r.camera_id AS cam, SUM(r.n_vehicle_events)::bigint AS n
                 FROM lpr_hourly_stats r WHERE ${ruSql} AND r.n_vehicle_events IS NOT NULL
                GROUP BY 1 ORDER BY n DESC LIMIT 15`
            : `SELECT e.camera_id AS cam, COUNT(*) AS n
                 FROM events e
                WHERE ${stSql}
                  AND (e.object_class IN ('Car','Truck','Vehicle','Bicycle') OR e.event_type = 'anprAlarm')
                GROUP BY 1 ORDER BY n DESC LIMIT 15`, stArgs),
        ]);
        const dirIn = Array(24).fill(0), dirOut = Array(24).fill(0);
        direction.rows.forEach(r => {
          (r.dir === 'in' ? dirIn : dirOut)[r.hr] = parseInt(r.n, 10);
        });
        const assigned = { in: 0, out: 0 };
        dirCams.rows.forEach(r => { assigned[r.dir] = parseInt(r.n, 10); });
        const hours = Array(24).fill(0);
        hourly.rows.forEach(r => { hours[r.hr] = parseInt(r.n, 10); });
        const result = {
          period,
          total:   parseInt(kpi.rows[0].total,  10),
          // rollup → มาจาก lpr_hourly_stats · live → มาจากคิวรี noreadEv บน events
          // (NULL ได้ทั้งคู่: bucket ที่ยัง backfill ไม่ถึง — หน้าจอมี ?? 0 รับอยู่แล้ว
          //  เหมือนคอลัมน์พี่น้องที่ไม่ได้ห่อ COALESCE เช่นกัน)
          noread:   parseInt((useRollup ? kpi : noreadEv).rows[0].noread,   10),
          vehicles: parseInt((useRollup ? kpi : noreadEv).rows[0].vehicles, 10),
          watch:   parseInt(watchQ.rows[0].watch, 10),
          no_helmet: parseInt(kpi.rows[0].no_helmet, 10),        // มอเตอร์ไซค์ไม่ใส่หมวก ทั้งหมด
          no_helmet_ok: parseInt(kpi.rows[0].no_helmet_ok, 10),  // ตัวเลขที่หน้าจอแสดง
          overload: parseInt(kpi.rows[0].overload, 10),    // ซ้อนตั้งแต่ 3 คนขึ้นไป
          // unique = local + visitor เสมอ · local ≥2 ครั้ง (รถในพื้นที่) · visitor =1 · mismatch สงสัยสวมทะเบียน
          // noplates ⇒ ไม่มี 4 ฟิลด์นี้ (หน้าจอรอจาก ?part=plates)
          ...(dup || {}),
          hourly: hours,
          province: province.rows.map(r => ({ name: r.name, n: parseInt(r.n, 10) })),
          vtype:    vtype.rows.map(r => ({ type: r.type, n: parseInt(r.n, 10) })),
          pcolor:   pcolor.rows.map(r => ({ color: r.color, n: parseInt(r.n, 10) })),
          brand:    brand.rows.map(r => ({ code: r.code, n: parseInt(r.n, 10) })),
          perCamera: perCamera.rows.map(r => ({ camera_id: r.cam, n: parseInt(r.n, 10) })),
          direction: { in: dirIn, out: dirOut, assigned },  // RF5 per-camera direction
        };
    return result;
  }

  // ── ?part=plates — ขอบเขตชุดเดียวกับทางเต็มทุกประการ (ช่วง · ไซต์ที่เห็นได้ · กล้อง) ──
  async function _computeLprPlates(period, q) {
    const pcLp = periodClause(period, q.from, q.to, 1, 'lp.detected_at');
    const swLp = siteWhere(q.allowedSites ?? null, 'lp.camera_id', pcLp.args.length + 1);
    let whereLp = swLp.sql ? `${pcLp.sql} ${swLp.sql}` : pcLp.sql;
    const args = [...pcLp.args, ...swLp.args];
    if (q.cameras) {
      const a = String(q.cameras).split(',').map(x => x.trim()).filter(Boolean);
      if (a.length) { args.push(a); whereLp += ` AND lp.camera_id = ANY($${args.length})`; }
    }
    return { period, partial: true, ...(await plateCounts(sp, whereLp, args)) };
  }

  // ── KPI-only fast path (?part=kpi) ──────────────────────────────
  // The full stats call materialises 3M rows into a temp table so ten
  // aggregates can share one scan — worth it for the charts, wasted for the
  // five numbers at the top of the page. Measured on a 25-day custom range:
  //   full response          14.6s
  //   temp table + kpi + dup  6.8s
  //   these two, no temp      2.2s   (they run in PARALLEL on the pool;
  //                                   the temp-table version cannot, because
  //                                   a TEMP table is bound to one session)
  // The numbers land while the charts are still being built. The full response
  // still carries the same fields, so nothing downstream has to change.
  //
  // 2026-10-06: เลิกคำนวณตัวเลขระดับป้าย (unique/local/visitor/mismatch) และเลิก JOIN events
  //   ทั้งสองอย่างทำให้ "ทางเร็ว" ช้ากว่าทางเต็ม — custom 15 วัน admin 56 วิ · viewer hdy 205 วิ
  //   4 ตัวนั้นมาจากทางเต็ม (หรือ ?part=plates) เท่านั้น หน้าจอรวมผลทีละส่วนเอง
  //   license_plates.detected_at = events.event_time ทุกแถว (ตรวจ 878,725 แถว 5 ต.ค.) ⇒ กรองบน lp ได้ผลเดิม
  async function _computeLprKpiOnly(period, q) {
    const pc = periodClause(period, q.from, q.to, 1);
    const pcLp = periodClause(period, q.from, q.to, 1, 'lp.detected_at');
    const sw = siteWhere(q.allowedSites ?? null, 'e.camera_id', pc.args.length + 1);
    const swLp = siteWhere(q.allowedSites ?? null, 'lp.camera_id', pc.args.length + 1);
    let where = sw.sql ? `${pc.sql} ${sw.sql}` : pc.sql;
    let whereLp = swLp.sql ? `${pcLp.sql} ${swLp.sql}` : pcLp.sql;
    const args = [...pc.args, ...sw.args];
    if (q.cameras) {
      const a = String(q.cameras).split(',').map(x => x.trim()).filter(Boolean);
      if (a.length) {
        args.push(a);
        where   += ` AND e.camera_id = ANY($${args.length})`;
        whereLp += ` AND lp.camera_id = ANY($${args.length})`;
      }
    }
    // 🔴 noread/vehicles ต้องเลือกแหล่งเดียวกับ _computeLprStats ไม่งั้นการ์ดจะกระพริบ
    //    หน้าจอยิงสองคำขอ: ?part=kpi ก่อน แล้ว full ตามมา (page-lpr.js ~926) ทั้งคู่
    //    เรียก _renderLprKpi · ถ้าเส้นทางนี้นับสดแต่ full อ่าน rollup ช่วง month/week/
    //    yesterday จะเห็นเลขจริงแวบหนึ่งแล้วถูกทับด้วย 0 (คอลัมน์ใหม่ยังไม่ backfill)
    //    ⇒ ใช้เกณฑ์ useRollup ชุดเดียวกัน · ได้ผลพลอยได้คือเลิกสแกน events ทั้งเดือน
    //    ⚠️ ตัวเลขอื่นของเส้นทางนี้ (total/watch/หมวก) ยังคิดสดเหมือนเดิม ไม่แตะ
    const useRollup = ['yesterday', 'week', 'month'].includes(period);
    // ขอบเขตของตารางสรุป — เงื่อนไขชุดเดียวกัน แค่เปลี่ยนชื่อคอลัมน์ ⇒ ใช้ args ร่วมกันได้
    // (ตำแหน่ง $ ต้องตรงกับ where ข้างบนเป๊ะ จึงคิด offset จาก pc.args.length เหมือนกัน)
    const pcRu = periodClause(period, q.from, q.to, 1, 'r.bucket_hour');
    const swRu = siteWhere(q.allowedSites ?? null, 'r.camera_id', pc.args.length + 1);
    let ruWhere = swRu.sql ? `${pcRu.sql} ${swRu.sql}` : pcRu.sql;
    if (args.length > pc.args.length + swRu.args.length) ruWhere += ` AND r.camera_id = ANY($${args.length})`;
    // ต้องเลือกแหล่งเดียวกับ _computeLprStats (today = ถังชั่วโมง + ขอบสด) ไม่งั้นการ์ดกระพริบ
    const nrSplit = period === 'custom' ? noreadSplit(q.from, q.to) : period === 'today' ? todaySplit() : null;
    const [counts, noreadEv] = await Promise.all([
      // total = ป้ายที่อ่านได้จริง ตรงกับทางเต็ม — เดิม COUNT(*) รวมแถว 'unknown' หัวการ์ดจึงขึ้นเลขใหญ่ก่อน
      // แล้วถูกทางเต็มทับด้วยเลขที่เล็กกว่า (วัด today admin 2026-10-06: 794,902 → 781,696)
      sp.query(
        `SELECT COUNT(*) FILTER (WHERE lp.plate_number <> 'unknown') AS total,
                COUNT(*) FILTER (WHERE w.plate_number IS NOT NULL)                          AS watch,
                ${period === 'today'
                  // วันนี้ทางเต็มอ่านหมวกจาก lpr_hourly_stats (helmetRollup ให้ตรงกับหน้ากวดขัน) — ต้องอ่าน
                  // แหล่งเดียวกัน ไม่งั้นการ์ดขึ้นเลขสดก่อนแล้วถูกทับ (วัด 2026-10-06: 57,235 → 56,698)
                  ? `(SELECT COALESCE(SUM(r.n_no_helmet), 0) FROM lpr_hourly_stats r WHERE ${ruWhere}) AS no_helmet,
                     (SELECT COALESCE(SUM(r.n_no_helmet_ok), 0) FROM lpr_hourly_stats r WHERE ${ruWhere}) AS no_helmet_ok,`
                  : `COUNT(*) FILTER (WHERE lp.no_helmet AND lp.vehicle_type = 'twoWheelVehicle') AS no_helmet,
                     COUNT(*) FILTER (WHERE lp.no_helmet AND lp.vehicle_type = 'twoWheelVehicle'
                                        ${kpiConf('lp')}) AS no_helmet_ok,`}
                COUNT(*) FILTER (WHERE lp.rider_count >= 3)                                 AS overload
           FROM license_plates lp
           LEFT JOIN lpr_watchlist w ON w.plate_number = UPPER(lp.plate_number) AND w.active
             -- Alert Match Mode enforcement (2026-07-27) — see lpr-alerts.js for the full note.
             AND (w.alert_mode <> 'plate_region' OR w.region = lp.region)
             AND ${watchSiteOk()}
          WHERE ${whereLp}`, args),
      // 🔴 noread/vehicles ออกมาจาก JOIN ข้างบนไม่ได้เลย ไม่ว่าจะแก้ FILTER ยังไง —
      //    `JOIN license_plates` ตัดรถของ Dahua ที่อ่านป้ายไม่ออกทิ้งทั้งหมดตั้งแต่ต้น
      //    (ไม่มีแถวคู่ให้ join) ⇒ ต้องเป็นคิวรีแยกบน events · ดูหมายเหตุที่ noreadEvSql
      useRollup
        ? sp.query(`SELECT SUM(r.n_noread_ev)::bigint AS noread,
                             SUM(r.n_anpr_ev)::bigint   AS vehicles
                        FROM lpr_hourly_stats r WHERE ${ruWhere}`, args)
        : nrSplit ? sp.query(noreadSplitSql(where, ruWhere, args.length + 1, args.length + 2),
                             [...args, nrSplit.A, nrSplit.B])
        : sp.query(noreadEvSql(where), args),
    ]);
    const k = counts.rows[0], n = noreadEv.rows[0];
    return {
      period, partial: true,          // charts + ตัวเลขระดับป้าย ไม่อยู่ใน payload นี้
      total: parseInt(k.total, 10),
      noread: parseInt(n.noread, 10), vehicles: parseInt(n.vehicles, 10),
      watch: parseInt(k.watch, 10),
      no_helmet: parseInt(k.no_helmet, 10), no_helmet_ok: parseInt(k.no_helmet_ok, 10),
      overload: parseInt(k.overload, 10),
    };
  }

  // ── keep the expensive windows warm ─────────────────────────────
  // month costs 17.4s cold. Even with a 10-minute TTL the operator who arrives
  // just after it expires pays the whole thing. Recomputing it in the
  // background means that cost lands on a timer nobody is waiting on.
  //
  // Only the unfiltered admin view is warmed: it is the one every session opens
  // with, and warming every site-pill/camera combination would spend more than
  // it saves. A filtered view is far cheaper anyway (measured 0.55s).
  const LPR_WARM_PERIODS = ['month', 'week', 'today'];
  // 🔴 20 นาที (เดิม 4 นาที) — ต้องน้อยกว่า TTL 30 นาทีของ week/month เพื่อให้เข้าไป
  // แทนที่ก่อนหมดอายุ แต่ไม่ถี่จนกลายเป็นงานที่วิ่งตลอดเวลา
  // เดิม: หนึ่งรอบ warm ใช้ 238 วินาที (month 154 + week 83 + today 0.5) แต่วิ่งทุก 240
  // วินาที ⇒ duty cycle 99% · วัดจาก log จริง 2026-08-23 ตลอด 78 นาที (30 งาน)
  // ตอนนี้ 238/1200 ≈ 20% และจะลดอีกเมื่อจูน query ตามแผนระดับ 1
  // ⚠️ ลำดับใน LPR_WARM_PERIODS คือ month ก่อน — ตัวที่ช้าสุดจึงได้รีเฟรชต้นรอบเสมอ
  //    เหลือขอบ 10 นาทีก่อน TTL หมด แม้รอบจะยืดจาก 238 เป็น ~600 วินาที
  const LPR_WARM_EVERY_MS = 20 * 60 * 1000;
  // 🔴 2026-09-06 — cadence แยกรายช่วงเวลา + เปลี่ยนเงื่อนไขข้ามรอบ
  // ของเดิมข้ามรอบเมื่อ "cache ยังสด" ซึ่งขัดกับเจตนาของ warm loop เอง: มันจะยอม
  // คำนวณใหม่ก็ต่อเมื่อ cache **หมดอายุไปแล้ว** ⇒ ผู้ใช้ที่เข้ามาในช่องว่างนั้นจ่าย cold เต็ม
  // ยืนยันจาก log จริง 2026-09-06: today warm ทุก 20 นาที แต่ month/week ได้จริงทุก 40 นาที
  // (TTL 30 > cadence 20 ⇒ tick ที่ 20 ถูกข้าม, tick ที่ 40 คือรอบแรกที่ cache ตายแล้ว)
  // = มีช่องโหว่ 10 นาทีต่อรอบที่ไม่มีของอุ่น · ตอนนี้จึงกันด้วย "warm ครั้งล่าสุดเมื่อไร"
  // อย่างเดียว แล้วปล่อยให้ทับของที่ยังสดได้ ซึ่งคือหน้าที่ของ warm loop
  //
  // ต้นทุนจริงต่อรอบ (log 2026-09-06, ไม่ใช่ 154 วิ ตามคอมเมนต์เก่าใน helmetCriteria
  // ที่วัดไว้ตั้งแต่ 2026-08-23 ก่อนจูน query): month 9.4–11.4 วิ · week 11.1–12.2 วิ · today 0.9–1.5 วิ
  // month ถูกยืด cadence เป็น 60 นาที เพราะเป็น temp-table (`_lpr_pp` + `plate_region`)
  // ที่หนักสุดและตัวเลข "เดือนนี้" ขยับช้าที่สุด — 1 read ใน 3 ล้านไม่เปลี่ยนกราฟ
  const LPR_WARM_MONTH_EVERY_MS = env.int('LPR_WARM_MONTH_EVERY_MS');
  // week: 30 นาที (ไม่ใช่ 20) — ของเดิมได้จริงทุก 40 นาทีเพราะ TTL 30 > cadence 20 ทำให้ tick
  // ที่ 20 ถูกข้าม ถ้าตั้ง 20 ตรง ๆ จะกลายเป็น 72 รอบ/วัน (+421 วิ DB/วัน) โดยไม่ได้อะไรเพิ่ม
  // 30 นาที + TTL floor 35 นาที (ข้างล่าง) = 48 รอบ/วัน ไม่มีช่องโหว่ cold และ DB time
  // รวมทั้งลูป ≈ 840 วิ/วัน ใกล้ของเดิม (799) แต่ช่องโหว่ 720 นาที/วัน หายไป
  const LPR_WARM_WEEK_EVERY_MS  = env.int('LPR_WARM_WEEK_EVERY_MS');
  const _warmCadence = (period) => (period === 'month' ? LPR_WARM_MONTH_EVERY_MS
                                  : period === 'week'  ? LPR_WARM_WEEK_EVERY_MS
                                  : LPR_WARM_EVERY_MS);
  const _lastWarmedAt = new Map();       // period -> epoch ms ของ warm ครั้งล่าสุด
  let _lprWarmBusy = false;
  async function _warmLprStats() {
    if (_lprWarmBusy) return;                // a slow month must not stack up
    _lprWarmBusy = true;
    try {
      for (const period of LPR_WARM_PERIODS) {
        const key = `${period}||||${scopeCacheKey(null)}`;  // same shape the route
                                             // builds for an admin with no filters
                                             // (คำนวณด้วย allowedSites: null ข้างล่าง)
        if (Date.now() - (_lastWarmedAt.get(period) || 0) < _warmCadence(period)) {
          // ยังไม่ถึงรอบ — แต่ยัง "แตะ" cache ไว้ เพราะ _lprStatsCacheGet ย้ายคีย์ไปท้าย
          // Map = กัน entry ที่อุ่นไว้โดนเบียดตกจากเพดาน 24 ช่อง (custom range/ตัวกรอง
          // ของผู้ใช้กินช่องได้ไม่จำกัด) · สำคัญกับ month เป็นพิเศษเพราะรอบห่างสุด
          _lprStatsCacheGet(key);
          continue;
        }
        const t0 = Date.now();
        try {
          // ผ่านตัวคุมเดียวกับ route: key เดียวกัน = ผู้ใช้ที่เปิดหน้านี้ระหว่าง warm รอผลก้อนเดียวกัน ไม่คิดซ้ำ
          const result = await _fullRunner(period).run(key, () => _computeLprStats(period, { allowedSites: null }));
          _lprStatsCacheSet(key, period, result);
          _lastWarmedAt.set(period, Date.now());
          console.log(`[lpr-query] warmed stats period=${period} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        } catch (e) {
          console.error(`[lpr-query] warm ${period} failed:`, e.message);
        }
      }
    } finally { _lprWarmBusy = false; }
  }
  // Deliberately late: boot already has migrations, the WS bridge and every
  // other module's startup work competing for the same pool. 180s puts this
  // last in the staggered boot queue (kpi 45s · cat-rollup 90s · traffic 135s)
  // because `_lpr_pp`/`plate_region` are the heaviest of the lot.
  const LPR_WARM_FIRST_RUN_MS = env.int('LPR_WARM_FIRST_RUN_MS');
  setTimeout(_warmLprStats, LPR_WARM_FIRST_RUN_MS);
  setInterval(_warmLprStats, LPR_WARM_EVERY_MS);

  // GET /api/lpr/stats — period-aware KPIs + chart data (Asia/Bangkok)
  // Params: period (hour|today|yesterday|week|month|custom), from, to
  app.get('/api/lpr/stats', async (req, res) => {
    const period = String(req.query.period || 'today');
    const _allowedStr = scopeCacheKey(req.user?.allowedSites ?? null);
    const _cacheKey = `${period}|${req.query.from||''}|${req.query.to||''}|${req.query.cameras||''}|${_allowedStr}`;
    // part=kpi returns only the header numbers, several times faster. Cached
    // under its own key so it can never be served in place of the full payload.
    // part=plates = ตัวเลขระดับป้าย 4 ตัวอย่างเดียว · noplates=1 = ทางเต็มที่ไม่มี 4 ตัวนั้น
    //   หน้าจอช่วง custom ยิงสองตัวหลังขนานกัน — กราฟไม่ต้องรอการนับป้ายไม่ซ้ำ (~20 วิ ที่ 30 วัน)
    //   ทุกแบบมี key ของตัวเอง จะไม่มีวันถูกเสิร์ฟแทนกัน
    const _kpiOnly = req.query.part === 'kpi';
    const _platesOnly = req.query.part === 'plates';
    const _noPlates = !_kpiOnly && !_platesOnly && req.query.noplates === '1';
    const _key = _kpiOnly ? `kpi:${_cacheKey}` : _platesOnly ? `plates:${_cacheKey}`
      : _noPlates ? `np:${_cacheKey}` : _cacheKey;
    const _cached = _lprStatsCacheGet(_key);
    if (_cached) { res.set('X-Cache', 'HIT'); return res.json(_cached); }
    // ผู้เรียกปิดหน้า/เปลี่ยนช่วงก่อนได้คิว → ออกจากคิวโดยไม่เสียงาน DB (ดู heavyRunner)
    const _gone = new AbortController();
    res.on('close', () => { if (!res.writableFinished) _gone.abort(); });

    if (_kpiOnly) {
      try {
        // ช่วงที่มีตารางสรุป (custom/yesterday/week/month) ทางเต็มแบบ noplates เร็วกว่า KPI-only
        //   วัด custom 14 วัน: noplates 0.8–0.9 วิ · KPI-only 9.8 วิ (admin) / 70 วิ (viewer hdy)
        //   เพราะ KPI-only สแกนทุกแถวในช่วง · today/hour ช่วงสั้น KPI-only ยังคุ้มกว่าทางเต็ม
        const q = { from: req.query.from, to: req.query.to, cameras: req.query.cameras,
                    allowedSites: req.user?.allowedSites ?? null };
        const kpi = await _kpiRunner(period).run(_key, () => (period === 'today' || period === 'hour'
          ? _computeLprKpiOnly(period, q)
          : _computeLprStats(period, { ...q, noplates: true }).then((r) => ({ ...r, partial: true }))), _gone.signal);
        _lprStatsCacheSet(_key, period, kpi);
        res.set('X-Cache', 'MISS');
        return res.json(kpi);
      } catch (e) {
        if (e.code === 'HEAVY_ABANDONED') return;
        if (e.code === 'HEAVY_BUSY') { res.set('Retry-After', '15'); return res.status(503).json({ error: 'busy' }); }
        console.error('[lpr-query] GET /api/lpr/stats?part=kpi:', e.message);
        return res.status(500).json({ error: 'server_error' });
      }
    }

    try {
      // noplates เบาแล้ว (ตารางสรุป) ⇒ ใช้คิวของ kpi — ถ้าใช้คิว full (live limit 1) จะต่อแถวหลัง
      // part=plates ที่ยิงมาพร้อมกัน แล้วกราฟต้องรอ ~20 วิ ซึ่งคือสิ่งที่การแยกนี้ตั้งใจเลี่ยง
      const runner = _noPlates ? _kpiRunner(period) : _fullRunner(period);
      const result = await runner.run(_key, () => (_platesOnly
        ? _computeLprPlates(period, {
            from: req.query.from, to: req.query.to, cameras: req.query.cameras,
            allowedSites: req.user?.allowedSites ?? null,
          })
        : _computeLprStats(period, {
            from: req.query.from, to: req.query.to, cameras: req.query.cameras,
            allowedSites: req.user?.allowedSites ?? null, noplates: _noPlates,
          })), _gone.signal);
      _lprStatsCacheSet(_key, period, result);
      res.set('X-Cache', 'MISS');
      res.json(result);
    } catch (e) {
      if (e.code === 'HEAVY_ABANDONED') return;
      if (e.code === 'HEAVY_BUSY') { res.set('Retry-After', '15'); return res.status(503).json({ error: 'busy' }); }
      console.error('[lpr-query] GET /api/lpr/stats:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  function reportBucket(period) {
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

  // R1b — report-specific LPR stats. Read-only endpoint for the redesigned
  // Reports page; keeps /api/lpr/stats contract stable for the LPR page.
  app.get('/api/stats/lpr/report', async (req, res) => {
    const period = String(req.query.period || 'today');
    const pc = periodClause(period, req.query.from, req.query.to, 1);
    // Site-RBAC P2: compute RBAC scope first so group placeholder indices are correct
    const swR = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', pc.args.length + 1);
    const rPcSql  = swR.sql ? `${pc.sql} ${swR.sql}` : pc.sql;
    const rPcArgs = [...pc.args, ...swR.args];
    // ฐานของรายงานขับจาก license_plates (เงื่อนไขชุดเดียวกัน ตำแหน่ง $ เดียวกัน แค่เปลี่ยนคอลัมน์)
    const pcLpR = periodClause(period, req.query.from, req.query.to, 1, 'lp.detected_at');
    const swRLp = siteWhere(req.user?.allowedSites ?? null, 'lp.camera_id', pc.args.length + 1);
    const rPcSqlLp = swRLp.sql ? `${pcLpR.sql} ${swRLp.sql}` : pcLpR.sql;
    const bucket = reportBucket(period);
    const group = String(req.query.group || 'all').trim();
    const groupSql = group && group !== 'all'
      ? ` AND (w.group_id = $${rPcArgs.length + 1} OR wg.name = $${rPcArgs.length + 1})`
      : '';
    const groupArgs = groupSql ? [group] : [];
    const siteId = req.query.site_id ? parseInt(req.query.site_id) : null;
    const baseSiteClause = siteId ? ` AND lp.camera_id IN (SELECT id FROM cameras WHERE site_id = $${rPcArgs.length + 1})` : '';
    const baseSiteArgs   = siteId ? [siteId] : [];
    const grpSiteClause  = siteId ? ` AND e.camera_id IN (SELECT id FROM cameras WHERE site_id = $${rPcArgs.length + 1 + groupArgs.length})` : '';
    const grpSiteArgs    = siteId ? [siteId] : [];
    const watchWhere = `${rPcSql} AND w.plate_number IS NOT NULL${groupSql}`;
    // identified/bucket.key against the materialized temp table (no e./lp. aliases there)
    const identifiedTmp = `region IS NOT NULL AND region <> '' AND region <> 'ไม่ทราบ'
                          AND vehicle_type IS NOT NULL AND vehicle_type <> '' AND vehicle_type <> 'unknown'`;
    const bucketKeyTmp = bucket.key.replace(/e\.event_time/g, 'event_time');
    const groupSqlTmp = group && group !== 'all' ? ` AND (group_id = $1 OR wg_name = $1)` : '';
    try {
      // รวมคำขอซ้ำ + ต่อคิวทีละ 1 + ใช้ pool สถิติ (ไม่แย่งช่องของหน้าค้นหา) · ผู้เรียกที่ออกก่อนถึงคิวไม่เสียงาน DB
      const _gone = new AbortController();
      res.on('close', () => { if (!res.writableFinished) _gone.abort(); });
      const _rkey = `report|${req.originalUrl}|${scopeCacheKey(req.user?.allowedSites ?? null)}`;
      const payload = await _reportRunner.run(_rkey, async () => {
      const dq = (label, p) => p.catch(err => { err._lprq = label; throw err; });
      // watchHits/groups don't need the base join — fire them on the pool, in
      // parallel with the temp-table build below.
      const watchHitsP = dq('watchHits', sp.query(
        `SELECT e.id, e.event_time, e.camera_id,
                lp.plate_number, lp.region, lp.vehicle_type,
                lp.vehicle_color, lp.vehicle_brand, lp.plate_image,
                e.snapshot_filename AS snapshot_file,
                w.group_id, COALESCE(wg.name, w.group_id, 'Watchlist') AS group_name,
                wg.color AS group_color,
                w.ref_image
           FROM events e
           JOIN license_plates lp ON lp.event_id = e.id
           JOIN lpr_watchlist w ON w.plate_number = UPPER(lp.plate_number) AND w.active
             -- Alert Match Mode enforcement (2026-07-27) — see lpr-alerts.js for the full note.
             AND (w.alert_mode <> 'plate_region' OR w.region = lp.region)
             AND ${watchSiteOk('w', 'e.camera_id')}
           LEFT JOIN lpr_watchlist_groups wg ON wg.id = w.group_id
          WHERE ${watchWhere}${grpSiteClause}
          ORDER BY e.event_time DESC LIMIT 50`,
        [...rPcArgs, ...groupArgs, ...grpSiteArgs]
      ));
      // กลุ่ม Global + ของ Site ตัวเอง (migration 261) · คีย์ของ _reportRunner มี scopeCacheKey แล้ว ไม่ปนข้ามผู้ใช้
      const groupsP = dq('groups', sp.query(
        `SELECT id, name, color FROM lpr_watchlist_groups
          WHERE ($1::int[] IS NULL OR site_id IS NULL OR site_id = ANY($1)) ORDER BY created_at`, [visibleSites(req)]
      ));

      const client = await sp.connect();
      let kpi, peak, province, vtype, direction, dup;
      try {
        await client.query('BEGIN');
        // Materialize the filtered events⋈license_plates join ONCE — kpi/peak/
        // province/vtype/direction/dup were each independently re-running this
        // same join against the ~1M-row events table (17.85s for a monthly
        // window). Now every downstream query reads the small temp table instead.
        await client.query(
          // 2026-10-07: เลิก JOIN events — license_plates มีครบทุกคอลัมน์ที่ใช้ (event_id = e.id ·
          //   detected_at = e.event_time · camera_id = e.camera_id ทุกแถว) · เดือน: สร้าง 29.3 วิ ส่วนใหญ่คือ join
          //   plate_number เป็น COLLATE "C" ให้การนับต่อป้ายเทียบ byte (ไม่มีคิวรีไหนเรียงตามทะเบียน)
          //   region คง collation เดิม — รายการจังหวัดเรียงตามชื่อได้
          `CREATE TEMP TABLE _lpr_report_base ON COMMIT DROP AS
           SELECT lp.event_id AS id, lp.detected_at AS event_time, lp.plate_number COLLATE "C" AS plate_number,
                  lp.region, lp.vehicle_type,
                  c.lpr_direction, w.group_id, wg.name AS wg_name, w.plate_number AS w_plate,
                  lp.no_helmet, lp.camera_id, lp.confidence,
                  -- kpiConf('') ข้างล่างอ่านคอลัมน์นี้จาก temp table — ขาดไปตั้งแต่ 798b6c53 (18 ก.ย.)
                  -- ทำให้รายงานป้ายทะเบียนตอบ 500 ทุกครั้งจนถึง 6 ต.ค.
                  lp.plate_identified
             FROM license_plates lp
             LEFT JOIN cameras c ON c.id = lp.camera_id
             LEFT JOIN lpr_watchlist w ON w.plate_number = UPPER(lp.plate_number) AND w.active
               -- Alert Match Mode enforcement (2026-07-27) — see lpr-alerts.js for the full note.
               AND (w.alert_mode <> 'plate_region' OR w.region = lp.region)
               AND ${watchSiteOk()}
             LEFT JOIN lpr_watchlist_groups wg ON wg.id = w.group_id
            WHERE ${rPcSqlLp}${baseSiteClause}`,
          [...rPcArgs, ...baseSiteArgs]
        );

        [kpi, peak, province, vtype, direction, dup] = await Promise.all([
          dq('kpi', client.query(
            // unique = local + visitor (นับป้ายไม่ซ้ำชุดเดียวกับ dup ข้างล่าง) — ไม่ต้อง COUNT(DISTINCT) ซ้ำ
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE plate_number = 'unknown')::int AS noread,
                    COUNT(*) FILTER (WHERE ${identifiedTmp})::int AS identified,
                    COUNT(*) FILTER (WHERE w_plate IS NOT NULL${groupSqlTmp})::int AS watch,
                    COUNT(*) FILTER (WHERE no_helmet AND vehicle_type = 'twoWheelVehicle')::int AS no_helmet,
                    COUNT(*) FILTER (WHERE no_helmet AND vehicle_type = 'twoWheelVehicle'
                                       ${kpiConf('')})::int AS no_helmet_ok
               FROM _lpr_report_base`,
            groupArgs
          )),
          dq('peak', client.query(
            `SELECT ${bucketKeyTmp} AS bucket, COUNT(*)::int AS n
               FROM _lpr_report_base
              WHERE ${identifiedTmp}
              GROUP BY bucket ORDER BY bucket`
          )),
          dq('province', client.query(
            `SELECT region AS name, COUNT(*)::int AS n
               FROM _lpr_report_base
              WHERE ${identifiedTmp}
              GROUP BY region ORDER BY n DESC LIMIT 8`
          )),
          dq('vtype', client.query(
            `SELECT vehicle_type AS type, COUNT(*)::int AS n
               FROM _lpr_report_base
              WHERE ${identifiedTmp}
              GROUP BY vehicle_type ORDER BY n DESC LIMIT 8`
          )),
          dq('direction', client.query(
            `SELECT ${bucketKeyTmp} AS bucket, lpr_direction AS dir, COUNT(*)::int AS n
               FROM _lpr_report_base
              WHERE lpr_direction IN ('in','out')
              GROUP BY bucket, dir ORDER BY bucket`
          )),
          // local (ป้ายซ้ำ ≥2 = รถในพื้นที่) / visitor (ป้ายไม่ซ้ำ =1 = รถต่างถิ่น) —
          // per-plate count. DISTINCT id+plate_number first to undo any watchlist
          // fan-out (a plate can match >1 lpr_watchlist row) so counts stay identical
          // to the old clean events⋈license_plates join. Mirrors /api/lpr/stats.
          dq('dup', client.query(
            `WITH plate_counts AS (
               SELECT plate_number, COUNT(*) AS c
                 FROM (SELECT id, plate_number FROM _lpr_report_base WHERE plate_number <> 'unknown'
                        GROUP BY id, plate_number) d
                GROUP BY plate_number
             )
             SELECT COUNT(*) FILTER (WHERE c >= 2)::int AS local,
                    COUNT(*) FILTER (WHERE c = 1)::int  AS visitor
               FROM plate_counts`
          )),
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      const watchHits = await watchHitsP;
      const groups = await groupsP;

      const series = (rows, field = 'n') => {
        const values = Array(bucket.labels.length).fill(0);
        rows.forEach(r => {
          const idx = period === 'month' ? parseInt(r.bucket, 10) - 1 : parseInt(r.bucket, 10);
          if (idx >= 0 && idx < values.length) values[idx] = parseInt(r[field], 10) || 0;
        });
        return values;
      };
      const dirIn = Array(bucket.labels.length).fill(0);
      const dirOut = Array(bucket.labels.length).fill(0);
      direction.rows.forEach(r => {
        const idx = period === 'month' ? parseInt(r.bucket, 10) - 1 : parseInt(r.bucket, 10);
        if (idx >= 0 && idx < bucket.labels.length) (r.dir === 'in' ? dirIn : dirOut)[idx] = parseInt(r.n, 10) || 0;
      });
      const peakValues = series(peak.rows);
      const peakMax = Math.max(...peakValues, 0);
      const peakIdx = peakValues.indexOf(peakMax);
      return {
        period,
        group,
        kpi: (() => {
          const k = kpi.rows[0] || { total: 0, noread: 0, identified: 0, watch: 0, no_helmet: 0, no_helmet_ok: 0 };
          const local = dup.rows[0]?.local || 0, visitor = dup.rows[0]?.visitor || 0;
          return { total: k.total, unique: local + visitor, ...k, local, visitor };
        })(),
        peak: { labels: bucket.labels, values: peakValues, max: peakMax, index: peakIdx },
        province: province.rows,
        vehicle_type: vtype.rows,
        direction: { labels: bucket.labels, in: dirIn, out: dirOut },
        watch_hits: watchHits.rows,
        groups: groups.rows,
      };
      }, _gone.signal);
      res.json(payload);
    } catch (e) {
      if (e.code === 'HEAVY_ABANDONED') return;
      if (e.code === 'HEAVY_BUSY') { res.set('Retry-After', '15'); return res.status(503).json({ error: 'busy' }); }
      // dq() tags each sub-query so the log names the one that failed.
      console.error('[lpr-query] GET /api/stats/lpr/report [' + (e._lprq || '?') + ']:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });
};

module.exports.periodClause = periodClause;
module.exports.noreadSplit = noreadSplit;
module.exports.todaySplit = todaySplit;
module.exports.bkkDayStartIso = bkkDayStartIso;
module.exports.daySplit = daySplit;
module.exports.noreadSplitSql = noreadSplitSql;
module.exports.noreadEvSql = noreadEvSql;
module.exports.PLATE_COUNTS_SQL = PLATE_COUNTS_SQL;
