// ============================================================
// Vigil Platform — ยามเฝ้าตัวเลข "ไม่สวมหมวก · พร้อมข้อมูลทะเบียน"
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ที่มา: RCA 2026-09-18 ข้อ 8.3 (docs/reports/2026-09-18_hkt-helmet-evidence-gap_TH.html)
// ตัวเลขของทั้งไซต์ภูเก็ตเป็นศูนย์ติดกัน 5 วันโดยไม่มีอะไรร้องเลย กว่าจะรู้คือ 8 วัน
// ให้หลัง และรู้เพราะเจ้าของสังเกตด้วยตาเปล่า ไฟล์นี้คือยามที่ขาดไป
//
// เฝ้าสองทิศ ไม่ใช่ทิศเดียว:
//   1. **ตกผิดปกติ** — เคสภูเก็ต อัตราของไซต์ร่วงต่ำกว่าการแกว่งปกติของไซต์ตัวเอง
//   2. **ไม่ถูกกรองเลย** — กล้องที่ยังไม่มี cameras.plate_conf_floor เริ่มรายงาน
//      no_helmet ขึ้นมา · stampSql ให้ COALESCE(...) = TRUE กับกล้องที่ไม่มีเส้นแบ่ง
//      ⇒ แถวของกล้องนั้นผ่านเกณฑ์ 100% ทันที ซึ่งดู "สวย" จนไม่มีใครเอะใจ
//      วัดจริง 2026-09-18: กล้อง 60 ตัวที่ไม่มีเส้นแบ่ง ไม่มีแถว no_helmet เลยสักแถว
//      ใน 30 วัน (เป็นรุ่นที่ไม่รายงานหมวก) ⇒ เงื่อนไขนี้เงียบสนิทในวันนี้ และจะดัง
//      ก็ต่อเมื่อมีอะไรเปลี่ยนที่กล้องจริง ๆ ซึ่งคือตอนที่เราอยากรู้พอดี
//
// 🔴 ไม่เก็บฐานเปรียบเทียบไว้ในหน่วยความจำ — คิดใหม่จาก lpr_hourly_stats ทุกรอบ
//    checkEdgeDataLoss ใช้ Map ในหน่วยความจำ (_edgeLossSeen) แล้ว baseline หายทุก
//    ครั้งที่ restart · ที่แย่กว่าคือกับดักกลับด้าน: ตัวนั้น re-baseline เงียบ ๆ เมื่อค่า
//    **ลด** ส่วนยามตัวนี้ร้องตอนค่าลด ถ้าไปเก็บฐานแบบเดียวกันก็จะ re-baseline เงียบ ๆ
//    เมื่อค่า **เพิ่ม** ซึ่งคือรูปร่างของเหตุ 15 ก.ย. เป๊ะ ๆ · คิดสดจากตารางสรุปจึงทั้ง
//    ถูกกว่าและรอด restart ฟรี · มีแต่ cooldown ที่ต้องจำข้ามรอบ
//
// ผลไปโผล่ที่ /api/health/details -> lpr.helmet_metric_check ตาม CLAUDE.md ข้อ 12
// และยิง LINE ได้ถ้าเปิด line_config.metric_alert (ตั้งต้นปิด ไม่มีผู้รับ · migration 235)
'use strict';

const KEY    = 'helmet_metric_check';
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS = {
  enabled: false, recipient_ids: [], sd_k: 5, min_margin_pp: 10,
  baseline_days: 14, min_baseline_days: 7, min_rows_per_day: 200, cooldown_hours: 24,
};

// รูปเดียวกับ _quietAlertSettings ใน alert-engine.js — clamp ทีละช่องแล้วรวมกับ default
// 🔴 enabled ตั้งต้น false และ recipient_ids ตั้งต้น [] = ไม่ส่งหาใคร (ไม่ใช่ null
//    ที่แปลว่า "ทุกคน") ด้วยเหตุผลเดียวกับ quiet_alert: ผู้รับที่เปิดอยู่รวมกลุ่ม
//    ลูกค้าและตำรวจ
function settings(raw) {
  const c = raw || {};
  const num = (v, def, min) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, n) : def;
  };
  return {
    enabled: c.enabled === true,
    sd_k: num(c.sd_k, DEFAULTS.sd_k, 1),
    min_margin_pp: num(c.min_margin_pp, DEFAULTS.min_margin_pp, 1),
    baseline_days: num(c.baseline_days, DEFAULTS.baseline_days, 3),
    min_baseline_days: num(c.min_baseline_days, DEFAULTS.min_baseline_days, 2),
    min_rows_per_day: num(c.min_rows_per_day, DEFAULTS.min_rows_per_day, 1),
    cooldown_ms: num(c.cooldown_hours, DEFAULTS.cooldown_hours, 1) * 3600 * 1000,
    recipient_ids: Array.isArray(c.recipient_ids) ? c.recipient_ids : [],
  };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// ส่วนเบี่ยงเบนมาตรฐานแบบกลุ่มตัวอย่าง (หาร n-1) — ต้องมีอย่างน้อย 2 จุด
const stddev = (xs) => {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
};

/**
 * ตัดสินไซต์เดียว — pure ไม่มี I/O เพื่อให้ assert ได้ (ดู self-check ท้ายไฟล์)
 *
 * @param {{site:string, rate:number|null, rows:number}} today   วันที่ตรวจ (เมื่อวาน)
 * @param {Array<{rate:number, rows:number}>} baseline           วันก่อนหน้าที่ใช้เทียบ
 * @returns {{site, status:'ok'|'drop'|'not_watchable', ...}}
 *
 * status 'not_watchable' ไม่ใช่ความผิดพลาด — แปลว่าไซต์นี้ยังเฝ้าด้วยวิธีนี้ไม่ได้
 * (ข้อมูลน้อยเกินจะเชื่อ) แนวคิดเดียวกับ _quietThresholdMs ที่คืน null ให้กล้องที่
 * "ความเงียบไม่ใช่สัญญาณของกล้องประเภทนั้น" · ไซต์ใหม่จะเข้าเกณฑ์เองเมื่อมีข้อมูลพอ
 * ไม่ต้องมีใครมาดูแลรายชื่อ
 */
function decide(today, baseline, cfg) {
  const usable = (baseline || []).filter(d => d.rows >= cfg.min_rows_per_day);
  if (usable.length < cfg.min_baseline_days) {
    return { site: today.site, status: 'not_watchable', reason: 'baseline_days', days: usable.length };
  }
  if (today.rows < cfg.min_rows_per_day) {
    // วันที่รถน้อยผิดปกติ อัตราจะแกว่งแรงตามตัวหาร ไม่ใช่สัญญาณของเกณฑ์ที่พัง
    // (ปัญหา "กล้องไม่ส่งข้อมูล" เป็นหน้าที่ของ checkQuietCameras ไม่ใช่ยามตัวนี้)
    return { site: today.site, status: 'not_watchable', reason: 'today_rows', rows: today.rows };
  }
  const rates = usable.map(d => d.rate);
  const med = median(rates);
  const sd  = stddev(rates) ?? 0;
  // เส้นเตือนอิงการแกว่งของไซต์ตัวเอง ไม่ใช่ค่าคงที่ทั้งระบบ — วัดจริง 30 วัน:
  // hkt sd 0.67 · hdy 4.88 · rmutr-v 8.02 ⇒ "ตก 15 จุด" เงียบกับ hkt แต่ปลุกผิด
  // กับ hdy ที่แกว่ง 21 จุดเป็นเรื่องปกติ · min_margin_pp กันไซต์ที่นิ่งมาก (hkt)
  // ไม่ให้เส้นแนบจนวันเงียบธรรมดาก็ปลุก
  const margin    = Math.max(cfg.sd_k * sd, cfg.min_margin_pp);
  const threshold = med - margin;
  const status    = today.rate < threshold ? 'drop' : 'ok';
  return {
    site: today.site, status,
    rate: Math.round(today.rate * 10) / 10,
    rows: today.rows,
    median: Math.round(med * 10) / 10,
    sd: Math.round(sd * 100) / 100,
    threshold: Math.round(threshold * 10) / 10,
    baseline_days: usable.length,
  };
}

// อัตรารายวันต่อไซต์จากตารางสรุป (เล็ก) ไม่แตะ license_plates 41 ล้านแถว
//
// 🔴 สองกับดักของวันที่ ทั้งคู่เจอจริงตอนรันรอบแรก:
//   1. คืน day เป็น text เสมอ — ชนิด date ของ Postgres มาถึง node เป็น Date object
//      แล้ว String() ให้ "Wed Sep 17 2026 ..." ซึ่งจับคู่กับ 'YYYY-MM-DD' ไม่ได้
//      ผลคือทุกไซต์กลายเป็น no_data_yesterday ทั้งที่ข้อมูลอยู่ครบ
//   2. ขอบต้องแปลงกลับเป็น timestamptz ด้วย AT TIME ZONE อีกชั้น — `(now() AT TIME
//      ZONE $2)::date` เป็น timestamp ไร้โซน ถ้าเอาไปเทียบกับ bucket_hour ตรง ๆ
//      Postgres จะตีความด้วยโซนของ server (UTC) ⇒ ขอบเลื่อนไป 7 ชั่วโมง
const RATES_SQL = `
  SELECT s.code AS site,
         to_char((h.bucket_hour AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day,
         sum(h.n_no_helmet)    AS rows,
         sum(h.n_no_helmet_ok) AS ok
    FROM lpr_hourly_stats h
    JOIN cameras c ON c.id = h.camera_id
    JOIN sites   s ON s.id = c.site_id
   WHERE s.status = 'active'  -- ไซต์ maintenance/archived เงียบทุกแจ้งเตือน (sites.status · migration 285)
     AND h.bucket_hour >= (((now() AT TIME ZONE $2)::date - ($1::int || ' days')::interval) AT TIME ZONE $2)
     AND h.bucket_hour <  (((now() AT TIME ZONE $2)::date)::timestamp AT TIME ZONE $2)
   GROUP BY 1, 2
  HAVING sum(h.n_no_helmet) > 0`;

// กล้องที่ยังไม่มีเส้นแบ่ง แต่เมื่อวานเริ่มมีแถว no_helmet — แถวพวกนี้ผ่านเกณฑ์ 100%
// โดยไม่ถูกกรองเลย · ไม่ต้องใช้ฐานเปรียบเทียบ จึงดังได้ตั้งแต่วันแรกที่กล้องเปลี่ยน
// พฤติกรรม ซึ่งเป็นวันเดียวที่เงื่อนไขนี้มีความหมาย
const UNFILTERED_SQL = `
  SELECT h.camera_id, sum(h.n_no_helmet)::int AS rows
    FROM lpr_hourly_stats h
    JOIN cameras c ON c.id = h.camera_id
    JOIN sites   s ON s.id = c.site_id AND s.status = 'active'  -- ไซต์ maintenance/archived เงียบทุกแจ้งเตือน (migration 285)
   WHERE c.plate_conf_floor IS NULL
     AND h.bucket_hour >= ((((now() AT TIME ZONE $1)::date - interval '1 day'))::timestamp AT TIME ZONE $1)
     AND h.bucket_hour <  (((now() AT TIME ZONE $1)::date)::timestamp AT TIME ZONE $1)
   GROUP BY 1 HAVING sum(h.n_no_helmet) > 0
   ORDER BY 2 DESC`;

async function evaluate(pool, cfg, tz = 'Asia/Bangkok') {
  const { rows } = await pool.query(RATES_SQL, [cfg.baseline_days + 1, tz]);
  const byDay = new Map();          // site -> [{day, rate, rows}]
  for (const r of rows) {
    const nh = Number(r.rows), ok = Number(r.ok);
    if (!byDay.has(r.site)) byDay.set(r.site, []);
    byDay.get(r.site).push({ day: String(r.day).slice(0, 10), rows: nh, rate: (100 * ok) / nh });
  }
  const yday = new Date(Date.now() - DAY_MS).toLocaleDateString('en-CA', { timeZone: tz });
  const sites = [];
  for (const [site, days] of byDay) {
    const today = days.find(d => d.day === yday);
    if (!today) { sites.push({ site, status: 'not_watchable', reason: 'no_data_yesterday' }); continue; }
    sites.push(decide({ ...today, site }, days.filter(d => d.day !== yday), cfg));
  }
  sites.sort((a, b) => a.site.localeCompare(b.site));
  const unf = (await pool.query(UNFILTERED_SQL, [tz])).rows
    .map(r => ({ camera_id: r.camera_id, rows: Number(r.rows) }));
  return { day: yday, sites, unfiltered: unf };
}

async function runOnce(pool, { tz = 'Asia/Bangkok' } = {}) {
  try {
    const cfgRow = await pool.query('SELECT metric_alert FROM line_config WHERE id = 1');
    const cfg = settings(cfgRow.rows[0] && cfgRow.rows[0].metric_alert);
    const res = await evaluate(pool, cfg, tz);

    const drops = res.sites.filter(s => s.status === 'drop');
    const ok = drops.length === 0 && res.unfiltered.length === 0;
    const payload = { checked_at: new Date().toISOString(), ok, ...res };

    if (ok) {
      const watched = res.sites.filter(s => s.status === 'ok').map(s => `${s.site} ${s.rate}%`);
      console.log(`[helmet-metric] ok ${res.day} — ${watched.join(' · ') || 'ยังไม่มีไซต์ที่เฝ้าได้'}`);
    } else {
      for (const d of drops) {
        console.warn(`[helmet-metric] DROP ${res.day} ${d.site} ${d.rate}% ต่ำกว่าเส้น ${d.threshold}% `
          + `(ปกติ ${d.median}% sd ${d.sd} จาก ${d.baseline_days} วัน) — เกณฑ์อาจถูกเปลี่ยนความหมาย ดู RCA 2026-09-18`);
      }
      for (const u of res.unfiltered) {
        console.warn(`[helmet-metric] UNFILTERED ${res.day} ${u.camera_id} มี no_helmet ${u.rows} แถว `
          + `แต่ยังไม่มี cameras.plate_conf_floor — แถวของกล้องนี้ผ่านเกณฑ์ 100% โดยไม่ถูกกรอง`);
      }
    }

    // cooldown เก็บในผลเดิมที่บันทึกอยู่แล้ว ไม่ต้องมีตารางใหม่ — ยามตัวนี้เดินวันละครั้ง
    const prev = await pool.query('SELECT value FROM system_settings WHERE key = $1', [KEY]);
    let alerted = {};
    try { alerted = (JSON.parse(prev.rows[0] && prev.rows[0].value) || {}).alerted || {}; } catch { alerted = {}; }
    payload.alerted = alerted;

    if (!ok && cfg.enabled) await notify(pool, cfg, payload);

    await pool.query(
      `INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KEY, JSON.stringify(payload),
       'ผลตรวจรายวันว่าอัตรา "พร้อมข้อมูลทะเบียน" ของแต่ละไซต์ยังอยู่ในช่วงปกติของไซต์นั้น (RCA 2026-09-18 ข้อ 8.3)']
    );
    return payload;
  } catch (e) {
    // ยามพังไม่ควรลาก api-server ลงไปด้วย — รอบหน้าพรุ่งนี้
    console.error('[helmet-metric] failed:', e.message);
    return null;
  }
}

// ยิง LINE เฉพาะเรื่องที่ยังไม่ได้บอกในรอบ cooldown · mutate payload.alerted ให้ผู้เรียก
// บันทึกต่อ · 🔴 เดินสถานะเฉพาะเมื่อส่งสำเร็จจริง (_pushToAll คืน {sent}) — line-sender
// ไม่เคย throw มันคืน {success:false} เงียบ ๆ ถ้าเอา try/catch ครอบแล้วถือว่าสำเร็จ
// จะกิน cooldown ทิ้งทั้งที่ไม่มีใครได้รับ (เคยเกิดจริง ดู alert-engine.js ~605)
async function notify(pool, cfg, payload) {
  if (!cfg.recipient_ids.length) {
    console.warn('[helmet-metric] metric_alert เปิดอยู่แต่ยังไม่ได้กำหนดกลุ่มผู้รับ — ไม่ส่ง');
    return;
  }
  const { rows } = await pool.query('SELECT enabled, channel_access_token FROM line_config WHERE id = 1');
  const lc = rows[0] || {};
  if (!lc.enabled || !lc.channel_access_token) return;

  const now = Date.now();
  const due = (k) => !payload.alerted[k] || (now - Date.parse(payload.alerted[k])) >= cfg.cooldown_ms;
  const lines = [];
  for (const d of payload.sites.filter(s => s.status === 'drop' && due(`site:${s.site}`)))
    lines.push(`ไซต์ ${d.site}: ${d.rate}% (ปกติ ${d.median}% เส้นเตือน ${d.threshold}%)`);
  for (const u of payload.unfiltered.filter(u => due(`cam:${u.camera_id}`)))
    lines.push(`กล้อง ${u.camera_id}: มี ${u.rows} ครั้งที่ยังไม่ถูกกรอง (ไม่มีเส้นแบ่ง)`);
  if (!lines.length) return;

  const text = `ตัวเลขไม่สวมหมวก พร้อมข้อมูลทะเบียน ผิดปกติ (${payload.day})\n${lines.join('\n')}`;
  const engine = require('../alert-engine');
  // _pushToAll อ่าน r.id ของผู้รับแต่ละคน — ส่ง id เปล่า ๆ เข้าไปเท่ากับส่งหา undefined (ส่งไม่ถึงใคร)
  // บั๊กแฝงตั้งแต่สร้าง เพราะ metric_alert ยังไม่เคยเปิด (พบ 2026-10-06 ตอนทำ perfWatch)
  const r = await engine._pushToAll(lc.channel_access_token, cfg.recipient_ids.map(id => ({ id })),
    [{ type: 'text', text }], 'helmet-metric');
  if (!r.sent) return;                                   // ส่งไม่สำเร็จ = ไม่กิน cooldown
  const stamp = new Date().toISOString();
  for (const d of payload.sites.filter(s => s.status === 'drop')) payload.alerted[`site:${d.site}`] = stamp;
  for (const u of payload.unfiltered) payload.alerted[`cam:${u.camera_id}`] = stamp;
}

// ระยะเวลา (ms) จาก now ถึงรอบถัดไปที่ตรงกับ hour:minute ตามเวลาท้องถิ่นของ tz
// ponytail: คิดจาก "นาทีที่เท่าไหร่ของวัน" ตรง ๆ จึงไม่รองรับ DST — Asia/Bangkok ไม่มี
function nextRunDelayMs(now, { hour = 5, minute = 30, tz = 'Asia/Bangkok' } = {}) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(x => [x.type, x.value])
  );
  const cur = (Number(p.hour) * 60 + Number(p.minute)) * 60_000
            + Number(p.second) * 1000 + now.getMilliseconds();
  const target = (hour * 60 + minute) * 60_000;
  return ((target - cur) % DAY_MS + DAY_MS) % DAY_MS || DAY_MS;
}

let _started = false;

// 05:30 เวลาไทย — หลัง reconcile รายคืนที่ 05:00 (TRAFFIC_STATS_RECONCILE_HOUR) จบ
// เพราะยามตัวนี้อ่านตารางสรุปตัวเดียวกับที่ reconcile เพิ่งเขียน · **ไม่รันตอนบูต**
// โดยตั้งใจ เหมือน noreadCheck — ของที่ตรวจวันละครั้งไม่ด่วนขนาดต้องรู้ผลตอน restart
function start(pool) {
  if (_started) return;
  _started = true;
  const override = Number(process.env.HELMET_METRIC_CHECK_INTERVAL_MS) || 0;   // สำหรับเทสต์
  const period = override || DAY_MS;
  const first  = override || nextRunDelayMs(new Date(), {});
  const tick = () => { runOnce(pool); };
  setTimeout(() => {
    tick();
    setInterval(tick, period).unref?.();
  }, first).unref?.();
  console.log(`[helmet-metric] scheduled in ${Math.round(first / 60_000)} min, `
    + `then every ${Math.round(period / 60_000)} min`);
}

module.exports = { start, runOnce, evaluate, decide, settings, nextRunDelayMs, KEY, DEFAULTS };

// ---------- self-check ----------
// `node src/helpers/helmetMetricCheck.js` — ตรวจตัวตัดสินล้วน ไม่แตะ DB
if (require.main === module) {
  const assert = require('assert');
  const cfg = settings(null);
  assert.equal(cfg.enabled, false, 'ต้องตั้งต้นปิด');
  assert.deepEqual(cfg.recipient_ids, [], 'ต้องตั้งต้นไม่มีผู้รับ ไม่ใช่ทุกคน');

  const base = (rate, n = 14) => Array.from({ length: n }, () => ({ rate, rows: 40000 }));

  // เคสภูเก็ตจริง: นิ่งที่ 85% แล้วร่วงเป็น 0 ⇒ ต้องดังตั้งแต่วันแรก
  const hkt = decide({ site: 'hkt', rate: 0, rows: 43591 }, base(85.4), cfg);
  assert.equal(hkt.status, 'drop', JSON.stringify(hkt));

  // วันปกติของภูเก็ตต้องเงียบ (ค่าต่ำสุดที่เคยวัดได้จริงใน 30 วันคือ 84.0)
  assert.equal(decide({ site: 'hkt', rate: 84.0, rows: 43591 }, base(85.4), cfg).status, 'ok');

  // หาดใหญ่แกว่งเป็นปกติ sd ~4.9 ต่ำสุดที่วัดได้ 36.7 ⇒ ต้องไม่ปลุกผิด
  const hdyBase = [69.2, 62, 58, 57.7, 55, 61, 52, 63, 57, 59, 54, 60, 56, 58]
    .map(rate => ({ rate, rows: 12000 }));
  assert.equal(decide({ site: 'hdy', rate: 36.7, rows: 5458 }, hdyBase, cfg).status, 'ok',
    'หาดใหญ่แกว่ง 21 จุดเป็นเรื่องปกติ เกณฑ์ตายตัวเป็นจุดเปอร์เซ็นต์จะปลุกผิดตรงนี้');
  // แต่ถ้าหาดใหญ่ร่วงถึงศูนย์ต้องดัง
  assert.equal(decide({ site: 'hdy', rate: 0, rows: 5458 }, hdyBase, cfg).status, 'drop');

  // ไซต์ที่ข้อมูลน้อยเกินจะเชื่อ = ยังเฝ้าไม่ได้ ไม่ใช่ผ่าน
  assert.equal(decide({ site: 'new', rate: 10, rows: 40000 }, base(85, 3), cfg).status, 'not_watchable');
  assert.equal(decide({ site: 'hkt', rate: 0, rows: 5 }, base(85.4), cfg).status, 'not_watchable',
    'วันที่รถน้อยผิดปกติเป็นหน้าที่ของ checkQuietCameras ไม่ใช่ยามตัวนี้');

  // เส้นเตือนต้องอิงการแกว่งของไซต์เอง: ไซต์ที่นิ่งมากต้องได้เส้นที่ min_margin_pp คุม
  const steady = decide({ site: 'hkt', rate: 85, rows: 40000 }, base(85.4), cfg);
  assert.equal(steady.threshold, 75.4, 'sd=0 ⇒ เส้น = median - min_margin_pp');

  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(stddev([5]), null, 'จุดเดียวคิด sd ไม่ได้');

  // ตารางเวลาต้องไม่คืน 0 (กันยิงซ้ำตอน timer ตื่นตรงเวลาพอดี)
  assert.ok(nextRunDelayMs(new Date()) > 0 && nextRunDelayMs(new Date()) <= DAY_MS);

  console.log('helmetMetricCheck self-check ✓');
}
