// ============================================================
// Vigil Platform — LPR "no-read" predicate self-check
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// migration 199 ทำให้แท็บ "ไม่ทราบทะเบียน" (GET /api/lpr/no-read) เลิกใช้ anti-join
// กับ license_plates แล้วหันไปใช้ predicate `COALESCE(raw_json->>'plate','') = ''`
// แทน เพราะวัดแล้วสองนิยามให้ผลตรงกันเป๊ะ (24 ชม. 19,637 = 19,637 · 7 วัน
// 156,187 = 156,187 · ต่างกัน 0 แถวทั้งสองทิศ) และ predicate ตัวนี้ "index ได้"
// ส่วน anti-join ไม่ได้ — 7 วันจาก ~38 วินาที เหลือระดับที่ปุ่ม "สัปดาห์" ใช้ได้จริง
//
// แต่ "เท่ากันตอนวัด" ไม่เท่ากับ "เท่ากันตลอดไป" — ถ้า ingester ตัวใดเริ่มเขียน key
// `plate` คนละแบบ (ใส่ช่องว่าง · ใส่ค่าทั้งที่อ่านไม่ออก · ไม่ใส่ทั้งที่มีแถวใน
// license_plates) แท็บนั้นจะโชว์แถวผิดเงียบ ๆ ไม่มีอะไรร้อง · ไฟล์นี้คือยามที่ขาดไป
//
// ผลไปโผล่ที่ /api/health/details → lpr.noread_check ตาม CLAUDE.md ข้อ 12
// (งาน monitoring ต่อยอด endpoint เดิม ไม่สร้าง endpoint ใหม่)
'use strict';

const KEY     = 'lpr_noread_check';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// 🔴 อย่า "sync" predicate ตัวนี้ให้เหมือน route (แก้ 2026-09-08 · อ่านให้จบก่อนแก้)
//    ตั้งแต่ 2026-09-08 route /api/lpr/no-read ใช้ predicate สองขา
//      (COALESCE(...'plate','') = '' OR ...'plate' = 'unknown')
//    เพื่อรับ "อ่านป้ายไม่ได้" ของ Hikvision ที่ส่ง plate='unknown' มาด้วย
//    **ห้ามเอารูปสองขานั้นมาใส่ในไฟล์นี้** — ยามตัวนี้เทียบกับ anti-join และแถวของ
//    Hikvision *มี* แถวใน license_plates ⇒ pred=true แต่ anti=false ทุกแถว
//    ยามจะแดงถาวรวันละ ~12,397 แถว (hkt) แล้วก็จะถูกปิดเสียงทิ้งไปเปล่า ๆ
//    ไฟล์นี้ตรวจ "ขาที่ว่าง ≡ anti-join" ซึ่งยังจริงและยังเป็นสิ่งที่ควรตรวจ —
//    ขา 'unknown' ไม่เทียบเท่า anti-join โดยนิยาม จึงไม่อยู่ในขอบเขตของยามตัวนี้
//
// ⚠️ ข้อความ predicate ตัวเดียวกับที่ migration 199 กำชับว่าต้องตรงกันเป๊ะ 3 ที่:
//      1) db/db_migration_199_events_anpr_noread_index.sql
//      2) scripts/create-face-blacklist-index.js → INDEXES.anpr_noread.pred
//      3) src/routes/lpr-list.js → /api/lpr/no-read (ขาแรกของ OR — ไฟล์นี้ ไม่ใช่
//         lpr-query.js อย่างที่บันทึกเก่าเขียนไว้ route ย้ายไปตั้งแต่แยกไฟล์)
//    สำเนาในไฟล์นี้เป็นที่ที่ 4 แต่อยู่ใน `count(*) FILTER (...)` ไม่ใช่ WHERE ของดัชนี
//    → planner ไม่ต้องจับคู่กับ expression tree ของ idx_events_anpr_noread_time
//
// anti-join ฝั่งเทียบตั้งใจ **ไม่ใส่ขอบเวลาให้ lp.detected_at**: ขอบแบบ ±1 ชม. ทำให้
//    เหตุการณ์ของกล้องที่นาฬิกาเดินเร็ว (skew จริงตามไซต์) กลายเป็น mismatch ปลอม
//    และยามที่ร้องหมาป่าคือยามที่ถูกปิดเสียง · วัดจริง 2026-09-06 บน central
//    (events 40.5 ล้านแถว, หน้าต่าง 24 ชม.): มีขอบ 15.3 วิ · ไม่มีขอบ 16.4 วิ
//    — idx_plates_event ทำให้ EXISTS เป็น index probe รายแถว ราคาจึงพอกัน
//    ⇒ ตัดคลาสสัญญาณลวงทิ้งได้ฟรี
const SQL = `
  SELECT count(*) FILTER (WHERE f.pred)           AS predicate,
         count(*) FILTER (WHERE f.anti)           AS anti_join,
         count(*) FILTER (WHERE f.pred <> f.anti) AS mismatch
    FROM (
      SELECT COALESCE(e.raw_json->>'plate','') = '' AS pred,
             NOT EXISTS (SELECT 1 FROM license_plates lp WHERE lp.event_id = e.id) AS anti
        FROM events e
       WHERE e.event_type = 'anprAlarm'
         AND e.event_time >= now() - ($1 || ' hours')::interval
    ) f`;

// นับทั้งสองนิยามในรอบสแกนเดียว + นับแถวที่สองนิยามไม่ตรงกัน
async function compare(pool, hours = 24) {
  const client = await pool.connect();
  try {
    // SET LOCAL ต้องอยู่ใน transaction · READ ONLY เพื่อกันตัวเองเขียนอะไรลงไปโดยบังเอิญ
    await client.query('BEGIN READ ONLY');
    // 10 นาทีคือเพดานกันค้าง ไม่ใช่ค่าที่คาดว่าจะแตะ (วัดจริง 24 ชม. ≈ 16 วิ) —
    // เผื่อไซต์ที่ใหญ่กว่าและเผื่อ cold cache หลัง restart · ยังต่ำกว่าเกณฑ์เตือน
    // long transaction ที่ 20 นาที (src/helpers/longTxWatch.js) อยู่มาก
    await client.query(`SET LOCAL statement_timeout = '10min'`);
    const { rows } = await client.query(SQL, [String(Number(hours) || 24)]);
    const r = rows[0] || {};
    return {
      predicate: parseInt(r.predicate, 10) || 0,
      anti_join: parseInt(r.anti_join, 10) || 0,
      mismatch:  parseInt(r.mismatch,  10) || 0,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

async function runOnce(pool, hours = 24) {
  try {
    const c = await compare(pool, hours);
    // ✅ เกณฑ์ผ่านคือ mismatch === 0 ไม่ใช่ predicate === anti_join — migration 199
    //    ถึงได้นับสองทาง ยอดรวมเท่ากันเกิดขึ้นได้ทั้งที่เป็นคนละชุดแถว
    // หมายเหตุ: predicate = 0 และ anti_join = 0 (ช่วงที่ไม่มี anprAlarm เลย) แปลว่า
    //    "ไม่มีอะไรให้ตรวจ" ไม่ใช่ "ตรวจแล้วผ่าน" — ตัวเลขทั้งสองอยู่ในผลให้อ่านเองได้
    const ok = c.mismatch === 0;
    const payload = { checked_at: new Date().toISOString(), hours, ...c, ok };
    if (ok) {
      console.log(`[noread-check] ok predicate=${c.predicate} anti_join=${c.anti_join}`);
    } else {
      console.warn(`[noread-check] MISMATCH ${c.mismatch} row(s) — predicate=${c.predicate} `
        + `anti_join=${c.anti_join} · แท็บ "ไม่ทราบทะเบียน" อาจโชว์แถวผิด (ดู migration 199)`);
    }
    // นอก transaction ของ compare โดยตั้งใจ — BEGIN READ ONLY ปฏิเสธ INSERT
    await pool.query(
      `INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KEY, JSON.stringify(payload),
       'ผลตรวจรายสัปดาห์ว่านิยาม "ไม่ทราบทะเบียน" ของ migration 199 ยังตรงกับ anti-join เดิม']
    );
    return payload;
  } catch (e) {
    // ยามพังไม่ควรลาก api-server ลงไปด้วย — รอบหน้าอีก 7 วัน
    console.error('[noread-check] failed:', e.message);
    return null;
  }
}

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// ระยะเวลา (ms) จาก `now` ถึงรอบถัดไปที่ตรงกับ dow/hour/minute ตามเวลาท้องถิ่นของ tz
// ponytail: คิดจาก "นาทีที่เท่าไหร่ของสัปดาห์" ตรง ๆ จึงไม่รองรับ DST — Asia/Bangkok
//   ไม่มี DST · ถ้าวันหนึ่งต้องใช้กับ tz ที่มี ต้องเปลี่ยนไปคำนวณจากวันที่จริงแทน
function nextRunDelayMs(now, { dow = 0, hour = 4, minute = 30, tz = 'Asia/Bangkok' } = {}) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(x => [x.type, x.value])
  );
  const cur = ((DOW[p.weekday] * 24 + Number(p.hour)) * 60 + Number(p.minute)) * 60_000
            + Number(p.second) * 1000 + now.getMilliseconds();
  const target = ((dow * 24 + hour) * 60 + minute) * 60_000;
  // ตรงเวลาพอดี → รออีกหนึ่งสัปดาห์ ไม่ใช่ยิงทันที (กันยิงซ้ำตอน timer ตื่นตรงเป๊ะ)
  return ((target - cur) % WEEK_MS + WEEK_MS) % WEEK_MS || WEEK_MS;
}

let _started = false;

// อาทิตย์ 04:30 ตามเวลาไทย — หลัง backup กลางคืนที่จบราว 04:05 · **ไม่รันตอนบูต**
// โดยตั้งใจ: query ~16 วินาทีไม่ควรไปแย่ง pool ตอน api-server กำลังอุ่น และของที่
// ตรวจสัปดาห์ละครั้งก็ไม่ได้ด่วนขนาดต้องรู้ผลตอน restart
function start(pool) {
  if (_started) return;
  _started = true;
  const override = Number(process.env.NOREAD_CHECK_INTERVAL_MS) || 0;   // สำหรับเทสต์
  const period = override || WEEK_MS;
  const first  = override || nextRunDelayMs(new Date(), {});
  const tick = () => { runOnce(pool); };
  setTimeout(() => {
    tick();
    setInterval(tick, period).unref?.();
  }, first).unref?.();
  console.log(`[noread-check] scheduled in ${Math.round(first / 60_000)} min, `
    + `then every ${Math.round(period / 60_000)} min`);
}

module.exports = { start, runOnce, compare, nextRunDelayMs, KEY };
