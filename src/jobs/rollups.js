// ============================================================
// Vigil Platform — Rollup jobs (เจ้าของเดียวของงานเติมตารางสรุป)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// VMOD-05 (ครึ่งหลัง — ครึ่งแรกคือ src/jobs/retention.js, decision #276)
//
// เดิม api-server.js เรียก `.start(pool)` ของ refresher ทั้งสี่ตัวเรียงกัน แล้วแต่ละ
// module ตั้ง timer ของตัวเอง ⇒ ไม่มีที่ไหนตอบได้ว่า "งานไหนรันล่าสุดเมื่อไหร่
// สำเร็จไหม รอบหน้าเมื่อไหร่" และถ้ามี api-server ตัวที่สอง (ช่วง restart ซ้อน
// หรืออนาคตที่รันสองตัว) ทั้งคู่จะเติมตารางสรุปเดียวกันพร้อมกัน
//
// ไฟล์นี้จึงเป็น **เจ้าของเดียว** ของการจัดคิว: timer ทั้งหมดอยู่ที่นี่ · งานจริง
// (SQL) ยังอยู่ใน module เดิมไม่ถูกแตะ · เรียกผ่าน `mod.tick(pool)` ที่คืนผลของ
// รอบนั้นกลับมาให้บันทึกสถานะได้
//
// 🔒 หนึ่งงาน = หนึ่งเจ้าของ: ทุกงานที่ **เขียน** ตารางสรุปห่อด้วย advisory lock
// ของ Postgres · ล็อกของ Postgres ผูกกับ session (connection) ⇒ ต้อง
// `pool.connect()` เอา client เฉพาะมาถือล็อกไว้ แล้วปลดบน client ตัวเดิมใน
// finally · ยิงผ่าน pool.query() เฉย ๆ ไม่ได้ เพราะรอบปลดล็อกอาจได้คนละ connection
//
// ⚠️ เดิมมีงาน helmet-criteria อยู่ในรายการนี้ด้วย (อุ่นเพดาน confidence ทุก 6 ชม.
// แบบไม่ล็อก) ถอดออก 2026-09-18 พร้อมกับการเลิกคิดเพดานสด ๆ — ผลถูกตัดสินตอน
// INSERT แล้วเก็บเป็น boolean (migration 234) จึงไม่มีอะไรต้องอุ่นอีก
//
// ── ตารางเวลาบูตแบบเหลื่อม (วัดจริง 2026-09-06) ─────────────────────────────
// วัดทันทีหลัง `pm2 restart api-server`: ใน 60 วินาทีแรก DB วิ่ง LPR warm loop
// (`_lpr_pp` temp table 3 วิ ×2, `plate_region` 6.5–8 วิ), tick ของ rollup ทั้งสาม
// helmet criteria และ health poll รอบแรก — พร้อมกันหมด · ทุกหน้าช้าราว 1 นาที
// หลัง deploy ทุกครั้ง ⇒ ทำทีละงาน:
//   helmet 3s · kpi 45s · cat-rollup 90s · traffic 135s · LPR warm 180s
// (แต่ละตัวเปลี่ยนได้ด้วย <PREFIX>_FIRST_RUN_MS ยกเว้น helmet ที่ตายตัว 3s)
// จากนั้นเป็นกวาดของ retention รอบวัน ห่างกัน 30 วิ ตั้งแต่ 300s — ดู jobs/retention.js
// ============================================================
'use strict';

const env      = require('../config');
const traffic  = require('../traffic-stats-refresher');
const kpi      = require('../kpi-stats-refresher');
const category = require('../category-rollup-refresher');
const appearance = require('../appearance-rollup-refresher');

// classid ของ advisory lock — 0x5647 = 'VG' (Vigil) · objid ไล่ 1..N ต่องาน
// ตรวจ 2026-09-07: `grep -rn advisory_lock src/ db/` ว่างเปล่า จึงไม่มีเลขชนกัน
// ถ้าเพิ่มงานใหม่ ให้ต่อ objid ห้ามใช้เลขซ้ำ (ซ้ำ = สองงานแย่งล็อกเดียวกัน)
const LOCK_CLASS = 0x5647;

// ลำดับตรงกับที่ api-server.js เคยเรียก: traffic → kpi → category
// (ลำดับ "เรียก" ไม่ใช่ลำดับเวลารัน — อย่าจัดใหม่ตาม firstRunMs)
// ค่าหน่วงเวลาอ่านจาก config เดียวกับที่ module เจ้าของเคยอ่านเอง ⇒ ไม่มีการ drift
const JOBS = [
  {
    name: 'traffic-stats',
    lockId: 1,
    firstRunMs: env.int('TRAFFIC_STATS_FIRST_RUN_MS'),
    refreshMs: env.int('TRAFFIC_STATS_REFRESH_MS'),
    run: (pool) => traffic.tick(pool),
  },
  {
    name: 'kpi-stats',
    lockId: 2,
    firstRunMs: env.int('KPI_STATS_FIRST_RUN_MS'),
    refreshMs: env.int('KPI_STATS_REFRESH_MS'),
    run: (pool) => kpi.tick(pool),
  },
  {
    name: 'cat-rollup',
    lockId: 3,
    firstRunMs: env.int('CAT_ROLLUP_FIRST_RUN_MS'),
    refreshMs: env.int('CAT_ROLLUP_REFRESH_MS'),
    run: (pool) => category.tick(pool),
  },
  {
    // หน้าสถิติลักษณะบุคคล (migration 282 · 2026-10-27) — รอบแรก 240s ระหว่าง LPR warm 180s กับกวาด retention 300s
    name: 'app-rollup',
    lockId: 4,
    firstRunMs: env.int('APP_ROLLUP_FIRST_RUN_MS'),
    refreshMs: env.int('APP_ROLLUP_REFRESH_MS'),
    run: (pool) => appearance.tick(pool),
  },
];

// สถานะต่องาน · helpers/retentionBeat เก็บแทนไม่ได้ — มันมีช่องเดียวต่อชื่อ
// (ล้มเหลวทับเวลาสำเร็จ) และไม่มี running / next_run · ที่นี่จึงเป็นที่เก็บเดียว
// ของสถานะ rollup ส่วน retentionBeat ยังเป็นของงาน retention ล้วน ๆ ไม่ถูกแตะ
const _state = new Map();
function _st(name) {
  if (!_state.has(name)) {
    _state.set(name, {
      running: false, lastStartAt: null, lastSuccessAt: null,
      lastFailureAt: null, lastError: null, lastResult: null,
      lastSkippedAt: null, lastSkipReason: null,
      anchorAt: null, firstRunAt: null,
    });
  }
  return _state.get(name);
}

let _pool = null;
let _started = false;

/**
 * รันงานหนึ่งรอบ — กันซ้อนใน process นี้ และกันข้าม process ด้วย advisory lock
 * @returns {Promise<object>} { ok } | { skipped } | { error }
 */
async function _runJob(job, trigger = 'timer') {
  const st = _st(job.name);
  if (st.running) {
    st.lastSkippedAt = new Date(); st.lastSkipReason = 'skipped: already running here';
    return { skipped: 'already running here' };
  }
  st.running = true;
  st.lastStartAt = new Date();
  // ponytail: ถือ connection จาก pool เดียวกับที่ผู้ใช้ใช้ตลอดรอบ — traffic reconcile
  // กินหลายนาที ⇒ เหลือ slot ให้หน้าเว็บน้อยลง 1 · ถ้าเริ่มเบียด ให้แยก pool
  // เล็กของ background job (VMOD-05 "แยก pool budget") แทนการถอดล็อกทิ้ง
  let client = null;
  try {
    if (job.lockId) {
      // pool หมด/ต่อไม่ได้ = throw ⇒ ตกลง catch นับเป็น failure ไม่ใช่ "มีเจ้าของอื่น"
      client = await _pool.connect();
      const r = await client.query(
        'SELECT pg_try_advisory_lock($1::int, $2::int) AS got', [LOCK_CLASS, job.lockId]);
      if (!r.rows[0].got) {
        st.lastSkippedAt = new Date(); st.lastSkipReason = 'skipped: another owner';
        return { skipped: 'another owner' };
      }
    }
    const result = await job.run(_pool);
    // tick() ของ refresher จับ error เองแล้วคืน { error } — ไม่ throw · และมันพิมพ์
    // บรรทัด `[kpi-stats] refresh failed: ...` ไปแล้ว จึงไม่ต้องพิมพ์ซ้ำที่นี่
    if (result && result.error) {
      st.lastFailureAt = new Date(); st.lastError = result.error;
      return { error: result.error };
    }
    if (result && result.skipped) {
      st.lastSkippedAt = new Date(); st.lastSkipReason = `skipped: ${result.skipped}`;
      return { skipped: result.skipped };
    }
    st.lastSuccessAt = new Date(); st.lastError = null; st.lastResult = result || null;
    return { ok: true, trigger, result: result || null };
  } catch (e) {
    st.lastFailureAt = new Date(); st.lastError = e.message;
    // เส้นทางนี้คือ throw จริง (เช่น pool หมด) ซึ่งยังไม่มี
    // ใครพิมพ์ให้ · ต้องดัง ไม่งั้น "ล้มทุกรอบ" กับ "ไม่มีอะไรต้องทำ" เงียบเหมือนกัน
    console.warn(`[rollups] ${job.name} ล้มเหลว: ${e.message}`);
    return { error: e.message };
  } finally {
    if (client) {
      // ปลดบน client ตัวเดิมเสมอ ไม่งั้นล็อกค้างจนกว่า connection นั้นจะตาย
      await client.query('SELECT pg_advisory_unlock($1::int, $2::int)',
        [LOCK_CLASS, job.lockId]).catch(() => {});
      client.release();
    }
    st.running = false;
  }
}

/** ตั้ง timer ทั้งหมด — เรียกครั้งเดียวจาก api-server.js ตรงจุดที่ .start() ทั้งสี่เคยอยู่ */
function start(deps) {
  if (_started) return;              // เรียกซ้ำ = สองเจ้าของ ซึ่งคือสิ่งที่งานนี้กันอยู่
  _started = true;
  _pool = deps.pool;

  // เดิมอยู่ใน traffic.start() — โหลดวันที่ reconcile ล่าสุดจาก system_settings
  // ไม่ต้องรอ: tick แรกอีก 135 วินาที ส่วน SELECT ตัวนี้เป็น PK lookup แถวเดียว
  // ⚠️ ถ้าลืมบรรทัดนี้ restart ในชั่วโมง reconcile จะรันงานหนักที่สุดของวันซ้ำทั้งก้อน
  //    ทับ pg_dump (เกิดจริง 2026-09-06 — ดูหมายเหตุที่ _reconciledDay ในไฟล์นั้น)
  traffic.loadReconciledDay(_pool);
  kpi.loadReconciledDay(_pool);
  category.loadReconciledDay(_pool);
  appearance.loadReconciledDay(_pool);

  const now = Date.now();
  for (const job of JOBS) {
    const st = _st(job.name);
    st.anchorAt = now;
    st.firstRunAt = now + job.firstRunMs;
    const fire = () => { _runJob(job).catch(() => {}); };   // _runJob จับเองหมด กันอีกชั้น
    // คงรูปเดิมของ timer ไว้เป๊ะ: setTimeout รอบแรก + setInterval คาบปกติ (สองตัวเดินอิสระ
    // กัน — setInterval นับจากตอนนี้ ไม่ใช่จากรอบแรก) · unref เหมือนของเดิมทุกตัว
    setTimeout(fire, job.firstRunMs).unref?.();
    setInterval(fire, job.refreshMs).unref?.();
    console.log(`[rollups] ${job.name} จัดคิวแล้ว (รอบแรก ${job.firstRunMs / 1000}s`
      + ` · ทุก ${(job.refreshMs / 60000).toFixed(0)} นาที`
      + `${job.lockId ? ' · advisory lock' : ' · ไม่ล็อก (cache ใน process)'})`);
  }
}

/** สถานะทุกงาน — ปลอดภัยที่จะเรียกก่อน start() (ได้ null ทั้งแถว ไม่โยน) */
function status() {
  const now = Date.now();
  return JOBS.map((job) => {
    const st = _st(job.name);
    let next = null;
    if (st.anchorAt !== null) {
      // setInterval เริ่มนับจาก anchor ⇒ รอบถัดไปคือขอบถังถัดไป · ก่อนรอบแรกของ
      // setTimeout จะยิง ให้เอาอันที่มาก่อนระหว่างสองตัว
      const tick = st.anchorAt + (Math.floor((now - st.anchorAt) / job.refreshMs) + 1) * job.refreshMs;
      next = st.firstRunAt > now ? Math.min(st.firstRunAt, tick) : tick;
    }
    return {
      name: job.name,
      running: st.running,
      last_start: st.lastStartAt,
      last_success: st.lastSuccessAt,
      last_failure: st.lastFailureAt,
      last_error: st.lastError,
      last_skipped: st.lastSkippedAt,
      skip_reason: st.lastSkipReason,
      next_run: next === null ? null : new Date(next),
      interval_ms: job.refreshMs,
      // ชื่อเดิม `locked` อ่านผิดได้ว่า "ตอนนี้ถือล็อกอยู่" — จริง ๆ คือ
      // "งานนี้ใช้ advisory lock หรือไม่"
      uses_lock: Boolean(job.lockId),
    };
  });
}

/** สั่งรันงานเดียวทันที — ปฏิเสธถ้ากำลังรันอยู่ */
async function runOnce(name) {
  const job = JOBS.find((j) => j.name === name);
  if (!job) return { ok: false, error: `ไม่รู้จักงานชื่อ ${name}` };
  if (!_pool) return { ok: false, error: 'ยังไม่ได้เรียก start()' };
  // ต้องมี `skipped` เหมือนเส้นทางเดียวกันที่ _runJob เจอเอง ไม่งั้นสาเหตุเดียวกัน
  // ตอบคนละ HTTP status (409 vs 400) แล้วแต่ว่าแพ้ตรงไหนของ race
  if (_st(name).running) return { ok: false, skipped: 'already running here', error: 'งานนี้กำลังรันอยู่' };
  const r = await _runJob(job, 'manual');
  return { ok: Boolean(r.ok), name, ...r };
}

module.exports = { start, status, runOnce, JOBS, LOCK_CLASS };
