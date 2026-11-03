// ============================================================
// Vigil Platform — ยามเฝ้าความเร็วรายวัน (preventive P2 · 2026-10-06)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ที่มา: รอบปรับความเร็ว ต.ค. 2569 ทุกจุดที่ช้าถูกพบเพราะคนรู้สึกว่าช้าแล้วสั่งตรวจทั้งระบบ
// ทั้งที่ข้อมูลที่บอกล่วงหน้าเก็บอยู่แล้วทุกวัน (cron perf-daily-sample → perf-samples/ 136 ไฟล์)
// แต่ไม่มีอะไรอ่านมันเลย · ไฟล์นี้คือตัวอ่าน — เทียบวันนี้กับ 7 วันก่อน แล้วร้องเมื่อเริ่มแย่
//
// สี่สัญญาณ (เกณฑ์อยู่ใน line_config.perf_alert ปรับได้โดยไม่ต้องแก้โค้ด):
//   1. query เดิมที่ mean ช้าลงเกิน ratio เท่าของค่ากลาง 7 วันก่อน (และเกิน min_ms)
//      ยกเว้นงานเขียนตารางสรุป (ROLLUP_WRITE_RE) — ไม่ตัดสินด้วย ratio เตือนเฉพาะเมื่อเฉลี่ยเกิน rollup_ms
//   2. query ใหม่ (ไม่มีประวัติ) ที่ mean เกิน new_query_ms — โค้ดใหม่ที่พาความช้าเข้ามา
//   3. [slow-req] (คำขอเกิน 2 วิ) ของวันนี้เกิน slow_req_per_day — วัดจาก log ของ api-server
//      (ไม่นับรูป /api/hcp/picture กับ /snapshots/* · ข้อความ LINE บอกเส้นที่ช้าบ่อยสุด 3 อันดับ)
//   4. ตารางใหญ่ที่ไม่ถูก analyze เกิน analyze_stale_days และมีแถวเปลี่ยน — เหตุของ GOTCHAS #221
//   6. หน้า LPR "วันนี้" ตอน probe 18:12 (บัญชี zz_perf_* ยิง /api/lpr/stats รอบแรก cache เย็น = สิ่งที่ผู้ใช้เจอ)
//      ช้าเกิน probe_lpr_ms (3 วิ) — อ่านจากบรรทัด [slow-req] ของ probe เอง (ต่ำกว่า 2 วิ = ไม่ขึ้น = ผ่าน)
//   7. ผลวัดคิวรีของหน้าจอทุกคืน 01:15 (scripts/query-probe.js → system_settings.query_probe) — กรณีที่เกิน probe_query_ms
//      หรือช้ากว่าค่ากลาง 7 คืนก่อนของตัวเองเกิน ratio เท่า (และเกิน min_ms) · คืนนี้ไม่ได้วัด = เตือนว่าตัววัดหยุด
//      จับสิ่งที่สัญญาณ 1–3 มองไม่เห็น: ไซต์ที่ไม่มีใครเปิด และแผนของคิวรีที่เปลี่ยนเพราะ index ใหม่ (ตรวจคิวรี 2026-10-26)
//   8. ตารางสรุปเทียบกับนับดิบของเมื่อวาน (helpers/rollupCheck.js ตรวจหลัง reconcile 05:00) — ต่างเกิน 0.1% (และเกิน 100 แถว)
//      หรือไม่ได้ตรวจมาเกินหนึ่งวัน = ตัวเก็บตกไม่ทำงาน (GOTCHAS #237: ขาด 26,301 แถวเงียบ ๆ)
//   9. กล้องที่ข้อมูลมาถึงช้าเกิน 3 ชม. ≥1,000 event (ยอดที่ reconcile ต้องเติมเพิ่ม) — ข้อมูลค้างที่ edge แล้วค่อยมา
//      (C9-KAR-SB-04 หายจาก central 22–24 ต.ค. เกือบ 2 วันโดยไม่มีอะไรบอก)
//   5. อายุ xid สูงสุดของตารางใด ๆ ≥ xid_age_warn (150M) — เพดานที่ autovacuum บังคับ freeze คือ 200M
//      ถ้าตารางใหญ่ (license_plates 48 GB) ไปถึงก่อนเราทำเอง ระบบจะกินดิสก์ทั้งตารางตอนไหนก็ได้ (2026-10-10 วัดได้ 195.9M)
//
// รอบ 18:25 เวลาไทย: หลัง cron reset pg_stat_statements 08:03 และเก็บตัวอย่าง 18:12
// ⇒ หน้าต่างของทุกวันคือ 08:03–18:25 เท่ากัน เทียบข้ามวันได้ตรง ๆ
// ผลเก็บใน system_settings.perf_watch (ให้หน้า Health อ่าน) · LINE ตั้งต้นปิด ไม่มีผู้รับ
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const KEY = 'perf_watch';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULTS = {
  enabled: false, recipient_ids: [], ratio: 2, min_ms: 1000, new_query_ms: 5000, min_calls: 3,
  slow_req_per_day: 100, analyze_stale_days: 3, big_table_gb: 1, cooldown_hours: 24, rollup_ms: 60000,
  xid_age_warn: 150_000_000, probe_lpr_ms: 3000, probe_query_ms: 5000,
};

function settings(raw) {
  const c = raw || {};
  const num = (v, def, min) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, n) : def; };
  return {
    enabled: c.enabled === true,
    recipient_ids: Array.isArray(c.recipient_ids) ? c.recipient_ids.filter(Boolean) : [],
    ratio: num(c.ratio, DEFAULTS.ratio, 1.1),
    min_ms: num(c.min_ms, DEFAULTS.min_ms, 1),
    new_query_ms: num(c.new_query_ms, DEFAULTS.new_query_ms, 1),
    min_calls: num(c.min_calls, DEFAULTS.min_calls, 1),
    slow_req_per_day: num(c.slow_req_per_day, DEFAULTS.slow_req_per_day, 1),
    analyze_stale_days: num(c.analyze_stale_days, DEFAULTS.analyze_stale_days, 1),
    big_table_gb: num(c.big_table_gb, DEFAULTS.big_table_gb, 0.1),
    rollup_ms: num(c.rollup_ms, DEFAULTS.rollup_ms, 1000),
    xid_age_warn: num(c.xid_age_warn, DEFAULTS.xid_age_warn, 1_000_000),
    probe_lpr_ms: num(c.probe_lpr_ms, DEFAULTS.probe_lpr_ms, 500),
    probe_query_ms: num(c.probe_query_ms, DEFAULTS.probe_query_ms, 500),
    cooldown_ms: num(c.cooldown_hours, DEFAULTS.cooldown_hours, 1) * 3600_000,
  };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// "query เดิมที่แค่แก้ข้อความ" — แก้ SQL แม้ช่องว่างเดียว queryid ของ pg_stat_statements ก็เปลี่ยน
// แล้วถูกนับเป็น "query ใหม่ที่ช้า" ทั้งที่เร็วเท่าเดิม (คาดไว้ตอนแก้ lpr-query 2026-10-14 · เจ้าของขอทางแก้ถาวร)
// จับคู่กับ query ในประวัติที่ "หัว" (160 ตัวแรก) เหมือนกันมากพอ แล้ววัดเทียบกับค่าปกติของตัวนั้นแทน
// = ยังจับได้ถ้าช้าลงจริง แต่ไม่เตือนแค่เพราะเปลี่ยนหน้าตา SQL · ไม่มีตัวที่คล้ายพอ = query ใหม่จริง เตือนตามเดิม
const _normHead = (h) => String(h || '').toLowerCase().replace(/\$\d+/g, '$').replace(/\s+/g, ' ').trim();
function _headSimilarity(a, b) {
  a = _normHead(a); b = _normHead(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(/[^a-z0-9_$.]+/).filter(Boolean)), tb = new Set(b.split(/[^a-z0-9_$.]+/).filter(Boolean));
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter || 1);
}
const LINEAGE_MIN_SIMILARITY = 0.85;
// ตำแหน่ง placeholder ในหัว SQL ต้องตรงกันด้วย — คิวรีตัวเดียวกันแต่เลือกตัวกรองต่างกัน ($8 / $9 / $10 ในหัว)
// เป็นงานคนละขนาด เคยถูกจับคู่กับรูปที่ไม่กรอง (0.16 วิ) แล้วเตือนว่า "ช้าลง" ทั้งที่แค่เลือกตัวกรองหนัก (2026-10-21)
const _params = (h) => (String(h || '').match(/\$\d+/g) || []).join(',');
function _predecessor(q, history, heads) {
  let best = null, bestSim = 0;
  const qp = _params(q.query_head);
  for (const [id, head] of heads) {
    if (id === String(q.queryid) || !(history.get(id) || []).length) continue;
    if (_params(head) !== qp) continue;
    const sim = _headSimilarity(q.query_head, head);
    if (sim > bestSim) { best = id; bestSim = sim; }
  }
  return bestSim >= LINEAGE_MIN_SIMILARITY ? best : null;
}

// งานเติมตารางสรุปเป็นงานเบื้องหลัง ไม่มีผู้ใช้รอ · ค่าเฉลี่ยของมันขึ้นลงตามงานหนักอื่นที่แย่ง IO ในวันนั้น
// (27 ต.ค. แจ้ง "ช้าลง" 3 บรรทัดจาก backfill ด้วยมือช่วง 11–12 น.) · เตือนเฉพาะเมื่อเฉลี่ยเกิน rollup_ms
// (ใกล้รอบ refresh 5 นาที = ตัวเติมค้างจริง) · ตารางสรุปขาด/เกินจับด้วยสัญญาณ 8 อยู่แล้ว
const ROLLUP_WRITE_RE = /^\s*(insert\s+into|delete\s+from|update)\s+(event_kpi_hourly|event_dim_bucket|lpr_hourly_stats|lpr_dim_daily|lpr_alert_hourly|appearance_dim_hourly|appearance_dim_daily|traffic_hourly_stats|traffic_daily_stats)\b/i;

// ฟังก์ชันบริสุทธิ์ — today: [{queryid, calls, mean_ms, query_head}] · history: Map(queryid → [mean_ms ของวันก่อน ๆ])
// history.heads (ไม่บังคับ): Map(queryid → query_head) ใช้หา "ตัวเดิม" ของ query ที่ queryid เปลี่ยน
function decide(today, history, cfg) {
  const regressions = [], fresh = [];
  const heads = history.heads || new Map();
  for (const q of today) {
    if (q.calls < cfg.min_calls || q.mean_ms < cfg.min_ms) continue;
    if (ROLLUP_WRITE_RE.test(q.query_head || '')) {
      const rh = history.get(String(q.queryid)) || [];
      if (q.mean_ms >= cfg.rollup_ms) regressions.push({ ...q, baseline_ms: rh.length ? Math.round(median(rh)) : null, rollup: true });
      continue;
    }
    let h = history.get(String(q.queryid)) || [];
    let renamedFrom = null;
    if (!h.length && (renamedFrom = _predecessor(q, history, heads))) h = history.get(renamedFrom);
    if (!h.length) { if (q.mean_ms >= cfg.new_query_ms) fresh.push(q); continue; }
    const base = median(h);
    if (q.mean_ms >= cfg.ratio * base) regressions.push({ ...q, baseline_ms: Math.round(base), ...(renamedFrom ? { renamed_from: renamedFrom } : {}) });
  }
  return { regressions, fresh };
}

// วันที่ YYYY-MM-DD ตามเวลาไทย (log ของ pm2 พิมพ์เวลาท้องถิ่นของเครื่อง = Asia/Bangkok)
const localDay = (d = new Date(), tz = 'Asia/Bangkok') =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// คำขอที่ "ช้าเพราะตัวไฟล์ใหญ่" ไม่ใช่เพราะระบบช้า — รูปเต็ม ~0.9 MB ผ่านอุโมงค์จาก edge ใช้ 3–4 วิเป็นปกติ
// เปิดหน้าเหตุการณ์ HCP หนึ่งครั้งก็ได้เป็นร้อย แล้วเตือน LINE "ระบบเริ่มช้า" เกินจริง (เกิดจริง 2026-10-09:
// 169 ครั้ง ซึ่ง 152 เป็นรูป) · ยังอยู่ใน log ตามเดิม แค่ไม่นับเข้าสัญญาณนี้
const TRANSFER_RE = /\[slow-req\] \d+ \d+ms GET (\/api\/hcp\/picture|\/snapshots\/)/;
const SLOW_ROUTE_RE = /\[slow-req\] \d+ \d+ms [A-Z]+ ([^ ?]+)/;
// คำขอภายในระบบ (token ภายใน: report-worker, งานตรวจ/ทดสอบ) และบัญชีทดสอบชั่วคราว — ไม่ใช่ผู้ใช้ที่นั่งรอ
// 2026-10-25: เตือน "คำขอเกิน 2 วิ 110 ครั้ง" ทั้งที่ 108 ครั้งเป็นการตรวจคิวรีทุกหน้า (internal 105 + zz_tmp 3) ผู้ใช้จริง 1
// ไม่ทิ้งเงียบ ๆ — นับแยกแล้วบอกในข้อความแจ้งเตือน
const NOT_USER_RE = / user=(internal|zz_tmp_\S*) /;

// อ่าน log ครั้งเดียว ได้ทั้งยอดที่นับ · เส้นที่ช้าบ่อยสุด · จำนวนที่ไม่นับ
async function scanSlowReq(day, file) {
  if (!file || !fs.existsSync(file)) return null;
  let n = 0, skipped = 0, probeLpr = null, notUser = 0;
  const byRoute = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.startsWith(day) || !line.includes('[slow-req]')) continue;
    if (TRANSFER_RE.test(line)) { skipped++; continue; }
    if (NOT_USER_RE.test(line)) { notUser++; continue; }
    n++;
    const m = SLOW_ROUTE_RE.exec(line);
    // probe รายวัน (zz_perf_*) ยิง /api/lpr/stats รอบแรกตอน cache เย็น — ช้ากว่า 2 วิจึงมีบรรทัดนี้ ไม่มี = เร็วกว่า 2 วิ
    if (m && m[1] === '/api/lpr/stats' && / user=zz_perf_/.test(line)) {
      const ms = Number((/\] \d+ (\d+)ms /.exec(line) || [])[1]);
      if (Number.isFinite(ms) && (probeLpr == null || ms > probeLpr)) probeLpr = ms;
    }
    if (m) { const r = m[1].replace(/\/\d+/g, '/:n'); byRoute.set(r, (byRoute.get(r) || 0) + 1); }
  }
  const top = [...byRoute].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([route, count]) => ({ route, count }));
  return { n, skipped, top, probeLpr, notUser };
}
const countSlowReq = async (day, file) => (await scanSlowReq(day, file))?.n ?? null;

async function snapshot(pool, day) {
  const { rows } = await pool.query(`
    SELECT queryid, calls, mean_exec_time AS mean_ms, total_exec_time AS total_ms, max_exec_time AS max_ms,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS query_head
      FROM pg_stat_statements
     WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND query !~* '^\\s*(create index|vacuum|analyze|copy|explain|reindex)'
     ORDER BY total_exec_time DESC LIMIT 50`);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO perf_daily_queries (day, queryid, calls, mean_ms, total_ms, query_head)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (day, queryid) DO UPDATE SET calls = EXCLUDED.calls, mean_ms = EXCLUDED.mean_ms,
         total_ms = EXCLUDED.total_ms, query_head = EXCLUDED.query_head`,
      [day, r.queryid, r.calls, r.mean_ms, r.total_ms, r.query_head]);
  }
  return rows.map(r => ({ ...r, calls: Number(r.calls), mean_ms: Number(r.mean_ms), max_ms: Number(r.max_ms) }));
}

async function history(pool, day) {
  const { rows } = await pool.query(
    `SELECT queryid, mean_ms, query_head FROM perf_daily_queries WHERE day >= $1::date - 7 AND day < $1::date`, [day]);
  const h = new Map();
  h.heads = new Map();
  for (const r of rows) {
    const k = String(r.queryid); if (!h.has(k)) h.set(k, []); h.get(k).push(Number(r.mean_ms));
    if (r.query_head) h.heads.set(k, r.query_head);
  }
  return h;
}

async function staleTables(pool, cfg) {
  const { rows } = await pool.query(`
    SELECT s.relname, pg_total_relation_size(s.relid) AS bytes, s.n_mod_since_analyze AS changed,
           greatest(s.last_analyze, s.last_autoanalyze) AS analyzed_at
      FROM pg_stat_user_tables s
     WHERE pg_total_relation_size(s.relid) > $1::bigint
       AND s.n_mod_since_analyze > 0
       AND coalesce(greatest(s.last_analyze, s.last_autoanalyze), 'epoch') < now() - make_interval(days => $2::int)
     ORDER BY bytes DESC`, [Math.round(cfg.big_table_gb * 1024 ** 3), Math.round(cfg.analyze_stale_days)]);
  return rows.map(r => ({ table: r.relname, gb: +(Number(r.bytes) / 1024 ** 3).toFixed(1),
                          changed: Number(r.changed), analyzed_at: r.analyzed_at }));
}

// อายุ xid ของตารางที่แก่สุด (รวม toast/materialized view) — pg_class มีไม่กี่ร้อยแถว เบา
// ตารางเล็ก (catalog, line_*) แก่ 150M+ ได้เป็นปกติเพราะไม่ค่อยมีการเขียน · autovacuum บังคับ freeze ที่ 200M
// ใช้เสี้ยววินาที ไม่มีผลต่อระบบ (27 ต.ค. เตือน pg_attrdef 176 kB) · เตือนเฉพาะตารางที่ใหญ่พอจะกินดิสก์/IO
// ตอนโดนบังคับ (ใช้เกณฑ์ big_table_gb ตัวเดียวกับสัญญาณ 4)
async function oldestXid(pool, minBytes = 0) {
  const { rows } = await pool.query(
    `SELECT c.relname, age(c.relfrozenxid)::bigint AS age FROM pg_class c
      WHERE c.relkind IN ('r', 't', 'm') AND pg_total_relation_size(c.oid) >= $1
      ORDER BY age(c.relfrozenxid) DESC LIMIT 1`, [minBytes]);
  return rows[0] ? { table: rows[0].relname, age: Number(rows[0].age) } : null;
}

// slow log ของ Postgres (log_min_duration_statement 2 วิ) คือเครื่องมือหลักตอนถาม "ทำไมช้า" — ไปทาง stderr → docker logs
// 🔴 เครื่องรีบูต 2026-09-22 แล้วไฟล์ log ของ container มี \x00 ปน ⇒ `docker logs` อ่านไม่ได้หลัง 12 ก.ย. เงียบ ๆ
//    เดือนกว่า โดยไม่มีใครรู้ (พบ 2026-10-21) · Postgres เขียน checkpoint ลง log ทุกไม่กี่นาทีอยู่แล้ว ⇒ 6 ชม. ไม่มีสักบรรทัด = log เสีย
const PG_CONTAINER = 'vigil-postgres';   // ponytail: ชื่อตายตัวตาม docker-compose · เปลี่ยนชื่อ container ต้องแก้ที่นี่ด้วย
function pgLogLines(hours = 6) {
  return new Promise((resolve) => {
    require('child_process').execFile('docker', ['logs', '--since', `${hours}h`, PG_CONTAINER],
      { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }, (err, out, errOut) => {
        if (err) return resolve(null);   // ไม่มี docker / ไม่มีสิทธิ์ = ไม่รู้ ไม่ใช่ "เสีย"
        resolve(`${out}${errOut}`.split('\n').filter(Boolean).length);
      });
  });
}

// คิวรีสำรวจด้วยมือ (psql · สคริปต์ที่ไม่ตั้งชื่อ · adhoc_*) ใน slow log ช่วงเดียวกับ pg_stat_statements (08:03–18:25)
// ที่มา: perfWatch 25 และ 26 ต.ค. — INSERT ตารางสรุปช้า 10–17 วิ ในชั่วโมงที่มีคนสแกน license_plates 7–14 วัน
// (≥20 ครั้ง ครั้งละ 21–169 วิ) แต่ข้อความ LINE ไม่บอก เจ้าของต้องถามว่า "เกี่ยวกับงานที่ทำไหม" ทุกครั้ง
// ⇒ ไม่ตัดสินเอง แค่แนบหมายเหตุเมื่อมีแจ้งเตือนอยู่แล้ว (งานสำรวจอย่างเดียวไม่ทำให้เตือน)
// zz_qaudit_* = เครื่องมือตรวจคิวรี (scripts/query-audit/) · ถือ transaction เขียนตารางสรุป 12 นาทีคืน 27 ต.ค. แต่หลุดตัวนับ
const ADHOC_APP_RE = /^(psql|\[unknown\]|adhoc_\S*|zz_qaudit_\S*)$/;
const _ADHOC_LINE = /^(\d{4}-\d\d-\d\d) (\d\d):(\d\d):\d\d\.\d+ UTC \[\d+\] \S+ (\S+) LOG:\s+duration: ([\d.]+) ms/;
/** @returns {{ n:number, total_s:number, max_s:number, hours:string[], from:string, to:string } | null} เวลาเป็นเวลาไทย */
function parseAdhoc(text) {
  let n = 0, total = 0, max = 0, from = null, to = null;
  const hours = new Set();
  for (const line of String(text || '').split('\n')) {
    const m = _ADHOC_LINE.exec(line);
    if (!m || !ADHOC_APP_RE.test(m[4])) continue;
    const ms = Number(m[5]);
    const thai = new Date(Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`) + 7 * 3600_000).toISOString().slice(11, 16);
    n++; total += ms; max = Math.max(max, ms); hours.add(thai.slice(0, 2));
    if (!from || thai < from) from = thai;
    if (!to || thai > to) to = thai;
  }
  return n ? { n, total_s: Math.round(total / 1000), max_s: Math.round(max / 1000), hours: [...hours].sort(), from, to } : null;
}
function adhocSince(sinceIso) {
  return new Promise((resolve) => {
    require('child_process').execFile('docker', ['logs', '--since', sinceIso, PG_CONTAINER],
      { timeout: 30_000, maxBuffer: 256 * 1024 * 1024 }, (err, out, errOut) => resolve(err ? null : parseAdhoc(`${out}${errOut}`)));
  });
}

// period=week = สัปดาห์ปฏิทินเริ่มวันจันทร์ (date_trunc('week') ใน lpr-query.js) · 01:15 วันจันทร์มีข้อมูล ~1 ชม. ถึงวันอาทิตย์ ~7 วัน
// ⇒ เวลาโตขึ้นทุกคืนจันทร์→อาทิตย์ การเทียบค่ากลาง 7 คืนก่อนหน้าจึงร้องหลอกทุกวันพุธ–อาทิตย์ (perfWatch 29 และ 30 ต.ค.)
// ⇒ ตัดสินด้วยเพดานตายตัวอย่างเดียว
const PERIOD_TO_DATE_RE = /^lpr-stats-week\|/;

/**
 * ตัดสินผลวัดคิวรีของคืนนี้ (query_probe) — คืน null เมื่อยังไม่เคยมีผลเลย (ยังไม่ได้ติดตั้ง cron)
 * ms ติดลบ = ไม่ได้ 200 (−1 = หมดเวลา/ต่อไม่ได้) นับเป็นปัญหาเสมอ
 */
function judgeProbe(probe, day, cfg) {
  if (!probe || !probe.history) return null;
  const tonight = probe.history[day];
  if (!tonight) return { missing: true, offenders: [] };
  const past = Object.keys(probe.history).filter((d) => d < day).sort().slice(-7).map((d) => probe.history[d]);
  const offenders = [];
  for (const [id, ms] of Object.entries(tonight)) {
    if (id.startsWith('_')) continue;
    if (ms < 0) { offenders.push({ id, ms, why: ms === -1 ? 'timeout' : `http ${-ms}` }); continue; }
    const prev = past.map((h) => h[id]).filter((x) => x > 0);
    const base = prev.length >= 3 ? median(prev) : null;
    if (ms >= cfg.probe_query_ms) offenders.push({ id, ms, base, why: 'over' });
    else if (PERIOD_TO_DATE_RE.test(id)) continue;
    else if (base != null && ms >= cfg.min_ms && ms >= cfg.ratio * base) offenders.push({ id, ms, base, why: 'slower' });
  }
  offenders.sort((a, b) => (b.ms < 0 ? 1e9 : b.ms) - (a.ms < 0 ? 1e9 : a.ms));
  return { missing: false, offenders, stopped_at: tonight._stopped_at || null };
}

async function runOnce(pool, { now = new Date(), logFile = path.join(os.homedir(), '.pm2/logs/api-server-error.log') } = {}) {
  try {
    const { rows: lc } = await pool.query('SELECT perf_alert FROM line_config WHERE id = 1');
    const cfg = settings(lc[0]?.perf_alert);
    const day = localDay(now);
    const today = await snapshot(pool, day);
    const hist = await history(pool, day);
    const d = decide(today, hist, cfg);
    const regressions = d.regressions;
    // วันแรกที่ยังไม่มีประวัติเลย ทุก query คือ "ใหม่" — เก็บอย่างเดียว ไม่ตัดสิน ไม่งั้นรอบแรกร้องหลอกทั้งชุด
    const fresh = hist.size ? d.fresh : [];
    const scan = await scanSlowReq(day, logFile);
    const slowReq = scan ? scan.n : null;
    const stale = await staleTables(pool, cfg);
    const xid = await oldestXid(pool, cfg.big_table_gb * 1024 ** 3);
    const pgLog = await pgLogLines();
    // หน้าต่างเดียวกับ pg_stat_statements: ตั้งแต่ cron reset 08:03 (เวลาไทย) ของวันนี้
    const adhoc = await adhocSince(new Date(Date.parse(`${day}T08:03:00+07:00`)).toISOString());
    const qp = await pool.query("SELECT value FROM system_settings WHERE key = 'query_probe'");
    let probeRaw = null; try { probeRaw = JSON.parse(qp.rows[0]?.value || 'null'); } catch { /* ค่าเสีย = ไม่มีผล */ }
    const probeQuery = judgeProbe(probeRaw, day, cfg);
    const rc = await pool.query("SELECT value FROM system_settings WHERE key = 'rollup_check'");
    let rcRaw = null; try { rcRaw = JSON.parse(rc.rows[0]?.value || 'null'); } catch { /* ค่าเสีย = ไม่มีผล */ }
    const yesterday = localDay(new Date(now.getTime() - DAY_MS));
    const rollupIssues = require('./rollupCheck').judge(rcRaw, yesterday);
    const lateCams = require('./rollupCheck').judgeLate(rcRaw, now.getTime());
    const prev = await pool.query('SELECT value FROM system_settings WHERE key = $1', [KEY]);
    let old = {};
    try { old = JSON.parse(prev.rows[0]?.value || '{}'); } catch { /* ค่าเสีย = เริ่มใหม่ */ }
    // ขนาด DB รายวัน 35 วันล่าสุด — หน้า Health คิดอัตราโตและ "ดิสก์พอใช้อีกกี่วัน" จากตรงนี้ (P3)
    const { rows: [db] } = await pool.query('SELECT pg_database_size(current_database()) AS b');
    const dbGb = +(Number(db.b) / 1024 ** 3).toFixed(2);
    const dbHistory = [...(Array.isArray(old.db_history) ? old.db_history : []).filter(x => x.day !== day),
                       { day, gb: dbGb }].slice(-35);
    const payload = { day, generated_at: now.toISOString(), regressions, fresh,
      slow_req: slowReq, slow_req_limit: cfg.slow_req_per_day, slow_req_top: scan ? scan.top : [],
      slow_req_not_user: scan ? scan.notUser : 0,
      slow_req_skipped: scan ? scan.skipped : 0, stale_tables: stale,
      probe_lpr_today_ms: scan ? scan.probeLpr : null, probe_lpr_limit_ms: cfg.probe_lpr_ms,
      xid_age: xid ? xid.age : null, xid_age_table: xid ? xid.table : null, xid_age_warn: cfg.xid_age_warn,
      pg_log_lines_6h: pgLog, adhoc, probe_query: probeQuery, rollup_issues: rollupIssues, late_cameras: lateCams, probe_query_limit_ms: cfg.probe_query_ms,
      db_gb: dbGb, db_history: dbHistory, alerted: old.alerted || {} };
    if (cfg.enabled) await notify(pool, cfg, payload, now);
    await pool.query(
      `INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KEY, JSON.stringify(payload), 'ผลยามเฝ้าความเร็วรายวัน (helpers/perfWatch.js)']);
    console.log(`[perf-watch] ${day}: ช้าลง ${regressions.length} · ใหม่ที่ช้า ${fresh.length}`
      + ` · slow-req ${slowReq ?? '?'} · ตารางไม่ analyze ${stale.length}`);
    return payload;
  } catch (e) {
    console.error('[perf-watch] ล้ม:', e.message);
    return null;
  }
}

async function notify(pool, cfg, payload, now = new Date()) {
  if (!cfg.recipient_ids.length) return;
  const { rows } = await pool.query('SELECT enabled, channel_access_token FROM line_config WHERE id = 1');
  const lc = rows[0] || {};
  if (!lc.enabled || !lc.channel_access_token) return;
  const due = (k) => !payload.alerted[k] || (now.getTime() - Date.parse(payload.alerted[k])) >= cfg.cooldown_ms;
  const items = [];
  const sec = (ms) => `${(ms / 1000).toFixed(1)} วิ`;
  // ค่าเฉลี่ยถูกครั้งเดียวที่ช้ามากดึงขึ้น (2026-10-21: เฉลี่ย 6.7 วิ ทั้งที่ 6 ใน 7 ครั้งเร็ว ครั้งเดียว 41 วิ) ⇒ บอกตรง ๆ
  const outlier = (q) => {
    const rest = q.calls > 1 && q.max_ms ? (q.mean_ms * q.calls - q.max_ms) / (q.calls - 1) : null;
    // ครั้งเดียวกินเวลาเกินครึ่งของทั้งหมด = ค่าเฉลี่ยไม่ได้บอกอาการปกติของคิวรีนี้
    return rest != null && q.max_ms > 0.5 * q.mean_ms * q.calls
      ? ` · ช้าครั้งเดียว ${sec(q.max_ms)} ที่เหลือเฉลี่ย ${sec(rest)}` : '';
  };
  for (const q of payload.regressions) if (due(`q:${q.queryid}`))
    items.push([`q:${q.queryid}`, q.rollup
      ? `งานเติมตารางสรุปเฉลี่ย ${sec(q.mean_ms)} (เพดาน ${sec(cfg.rollup_ms)}) × ${q.calls} ครั้ง — ${q.query_head.slice(0, 80)}`
      : `ช้าลง: ${sec(q.mean_ms)} (ปกติ ${sec(q.baseline_ms)}${q.renamed_from ? ' ของตัวเดิมก่อน SQL เปลี่ยนรูป' : ''}) × ${q.calls} ครั้ง${outlier(q)} — ${q.query_head.slice(0, 80)}`]);
  for (const q of payload.fresh) if (due(`q:${q.queryid}`))
    items.push([`q:${q.queryid}`, `query ใหม่ที่ช้า: ${sec(q.mean_ms)} × ${q.calls} ครั้ง${outlier(q)} — ${q.query_head.slice(0, 80)}`]);
  if (payload.slow_req != null && payload.slow_req > payload.slow_req_limit && due('slow-req'))
    items.push(['slow-req', `คำขอเกิน 2 วิ วันนี้ ${payload.slow_req} ครั้ง (เกณฑ์ ${payload.slow_req_limit})`
      + ((payload.slow_req_top || []).length
        ? ` · ช้าบ่อยสุด: ${payload.slow_req_top.map(t => `${t.route} ×${t.count}`).join(', ')}` : '')
      + (payload.slow_req_not_user ? ` · ไม่นับคำขอภายในระบบ/ทดสอบอีก ${payload.slow_req_not_user}` : '')]);
  for (const t of payload.stale_tables) if (due(`t:${t.table}`))
    items.push([`t:${t.table}`, `ตาราง ${t.table} (${t.gb} GB) ไม่ถูก analyze ตั้งแต่ ${t.analyzed_at ? new Date(t.analyzed_at).toISOString().slice(0, 10) : 'ไม่เคย'} · แถวเปลี่ยน ${t.changed.toLocaleString()}`]);
  for (const r of payload.rollup_issues || []) if (due(`rollup:${r.table}`))
    items.push([`rollup:${r.table}`, r.why === 'stale'
      ? `ตารางสรุป ${r.table} ไม่ได้เทียบกับนับดิบตั้งแต่ ${r.day} — รอบเก็บตก 05:00 อาจไม่ทำงาน`
      : `ตารางสรุป ${r.table} วันที่ ${r.day} ไม่ตรงกับนับดิบ: ดิบ ${r.raw.toLocaleString()} · สรุป ${r.rollup.toLocaleString()} (ต่าง ${r.diff.toLocaleString()}) หลังเก็บตกแล้ว`]);
  for (const x of payload.late_cameras || []) if (due(`late:${x.camera_id}`))
    items.push([`late:${x.camera_id}`, `กล้อง ${x.camera_id}: ข้อมูลวันที่ ${x.day} มาถึง central ช้าเกิน 3 ชม. ${x.added.toLocaleString()} event — ค้างคิวที่ edge หรือสายหลุด (ตรวจ bridge / กล้อง)`]);
  const pq = payload.probe_query;
  if (pq && pq.missing && due('probe-query-missing'))
    items.push(['probe-query-missing', 'ตัววัดคิวรีของหน้าจอ (cron 01:15 · scripts/query-probe.js) ไม่ได้วัดคืนนี้ — ตรวจ crontab / log']);
  if (pq && pq.offenders.length && due('probe-query')) {
    const one = (o) => o.ms < 0 ? `${o.id} ${o.why === 'timeout' ? 'หมดเวลา' : o.why}`
      : `${o.id} ${sec(o.ms)}${o.base != null ? ` (ปกติ ${sec(o.base)})` : ''}`;
    items.push(['probe-query', `คิวรีหน้าจอ (วัดตี 1:15): ${pq.offenders.length} กรณีเกินเพดาน ${sec(payload.probe_query_limit_ms ?? DEFAULTS.probe_query_ms)} หรือช้ากว่าปกติ — `
      + pq.offenders.slice(0, 5).map(one).join(', ') + (pq.offenders.length > 5 ? ' …' : '')]);
  }
  if (payload.probe_lpr_today_ms != null && payload.probe_lpr_today_ms >= (payload.probe_lpr_limit_ms ?? DEFAULTS.probe_lpr_ms) && due('probe-lpr-today'))
    items.push(['probe-lpr-today', `หน้า LPR "วันนี้" ตอน probe 18:12 ใช้ ${sec(payload.probe_lpr_today_ms)} (เพดาน ${sec(payload.probe_lpr_limit_ms ?? DEFAULTS.probe_lpr_ms)})`]);
  if (payload.xid_age != null && payload.xid_age >= (payload.xid_age_warn ?? DEFAULTS.xid_age_warn) && due('xid-age'))
    items.push(['xid-age', `อายุ xid สูงสุด ${(payload.xid_age / 1e6).toFixed(0)}M (ตาราง ${payload.xid_age_table}) — ใกล้เพดาน 200M ที่ระบบบังคับ freeze เอง · ควร VACUUM (FREEZE) ตอนดึก`]);
  if (payload.pg_log_lines_6h === 0 && due('pg-log'))
    items.push(['pg-log', `slow log ของ Postgres ไม่มีบรรทัดใหม่ใน 6 ชม. (docker logs ${PG_CONTAINER}) — เครื่องมือหาสาเหตุความช้าใช้ไม่ได้ ต้องซ่อมก่อนเกิดเรื่อง`]);
  if (!items.length) return;
  let text = `ระบบเริ่มช้า (${payload.day}) — ตรวจเจอ ${items.length} เรื่อง:\n` + items.map(([, l]) => `· ${l}`).join('\n');
  // หมายเหตุ ไม่ใช่เรื่องที่ตรวจเจอ — แนบเฉพาะเมื่อรวมกันนานพอจะกระทบ (≥ 60 วิ) · ไม่กิน cooldown
  const ah = payload.adhoc;
  if (ah && ah.total_s >= 60) {
    text += `\nหมายเหตุ: วันนี้มีคิวรีสำรวจด้วยมือ (psql / สคริปต์ไม่ตั้งชื่อ / adhoc_*) ${ah.n} ครั้ง รวม ${Math.round(ah.total_s / 60)} นาที`
      + ` (ยาวสุด ${ah.max_s} วิ) ช่วง ${ah.from}–${ah.to} น. ชั่วโมงที่มี ${ah.hours.join(', ')}`
      + ` — ความช้าของคิวรีระบบในชั่วโมงเหล่านั้นอาจมาจากงานนี้`;
  }
  const engine = require('../alert-engine');
  const r = await engine._pushToAll(lc.channel_access_token, cfg.recipient_ids.map(id => ({ id })),
    [{ type: 'text', text: text.slice(0, 4900) }], 'perf-watch');
  if (!r.sent) return;                                   // ส่งไม่สำเร็จ = ไม่กิน cooldown
  const stamp = now.toISOString();
  for (const [k] of items) payload.alerted[k] = stamp;
}

let _started = false;
function start(pool) {
  if (_started) return;
  _started = true;
  const { nextRunDelayMs } = require('./helmetMetricCheck');
  const first = nextRunDelayMs(new Date(), { hour: 18, minute: 25 });
  setTimeout(() => {
    runOnce(pool);
    setInterval(() => runOnce(pool), DAY_MS).unref?.();
  }, first).unref?.();
  console.log(`[perf-watch] scheduled in ${Math.round(first / 60_000)} min, then daily 18:25`);
}

module.exports = { start, runOnce, decide, settings, notify, countSlowReq, scanSlowReq, oldestXid, pgLogLines, parseAdhoc, localDay, judgeProbe, KEY, DEFAULTS };
