// ============================================================
// Vigil Platform — Alert Worker
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Standalone process: LISTENs on two pg_notify channels
//   • alert_event        — JSON payload from mqtt-subscriber; calls alertEngine.onEvent()
//   • alert_rules_changed — signals cache invalidation; calls alertEngine.invalidateCache()
//
// Isolated from api-server + mqtt-subscriber so LINE/push failures
// never crash ingestion or the web API.
// ============================================================

const { Pool, Client } = require('pg');
const http = require('http');
require('dotenv').config({ quiet: true });
const env = require('./config');
require('./singleton')('alert-worker');  // refuse to run a second copy

const alertEngine = require('./alert-engine');
const longTx = require('./helpers/longTxWatch');

const _workerStartedAt = Date.now();
const ALERT_WORKER_PORT = parseInt(process.env.ALERT_WORKER_PORT || '3002', 10);

// ── DB pool for alert-engine (queries, cooldown updates, logs) ──
const pool =   // 🔴 ไม่มี statement_timeout = query ค้างได้ไม่จำกัด · เจอจริง 2026-08-27:
  // query หนึ่งค้าง 34 ชั่วโมง ทำให้ autovacuum เก็บ dead tuple ไม่ได้ ตาราง events
  // บวมจนทั้งระบบช้า และหน้าสถิติว่างเปล่า · มีแค่ api-server ที่ตั้งค่านี้ไว้
  // ประเมินกฎ + เขียน alert_logs — คำสั่งสั้นทั้งหมด
new Pool({
  options: '-c statement_timeout=60000',
  ...env.db(),
  max: 3,
  application_name: 'alert-worker',
});

pool.on('error', (e) => console.error('[alert-worker] pool error:', e.message));

alertEngine.init(pool);
console.log('[alert-worker] ✅ Alert engine initialized');

// ── LISTEN loop ─────────────────────────────────────────────────
// ต่อกลับเองเมื่อหลุด (helpers/pgListen · GOTCHAS #217) — เดิม reconnect เฉพาะ 'error' ไม่รวม 'end'
// และ connect ครั้งแรกไม่ติด = process.exit · ตอนนี้ลองใหม่แบบ backoff แทน
function onAlertNotification(msg) {
  if (msg.channel === 'alert_event') {
    let payload;
    try { payload = JSON.parse(msg.payload); } catch { return; }
    if (!payload?.event_id || !payload?.camera_id) return;
    alertEngine.onEvent(payload).catch((e) =>
      console.error('[alert-worker] onEvent error:', e.message)
    );
    return;
  }
  if (msg.channel === 'alert_rules_changed') {
    alertEngine.invalidateCache().catch((e) =>
      console.error('[alert-worker] invalidateCache error:', e.message)
    );
  }
}

const _alertListen = require('./helpers/pgListen').listenForever({
  label: 'alert-worker',
  channels: ['alert_event', 'alert_rules_changed'],
  onNotification: onAlertNotification,
  makeClient: () => new Client({ ...env.db() }),
});

// ── Dwell alert loop (migration 044) ─────────────────────────────
// เช็ค "อยู่นานผิดปกติ" ทุก 60s — อยู่ที่ worker นี้ตัวเดียวเท่านั้น
// (alert-engine ถูก init ใน api-server/ingesters ด้วย ถ้า engine ตั้ง
// interval เองทุก process จะยิงซ้ำ). cooldown ของ rule กันเตือนถี่อยู่แล้ว
setInterval(() => {
  alertEngine.checkDwellRules()
    .catch((e) => console.error('[alert-worker] dwell check error:', e.message || e));
}, 60 * 1000);
console.log('[alert-worker] ⏱️ dwell alert loop every 60s');

// ── Edge stale alert loop (EM6) ───────────────────────────────────
// เช็คทุก 5 นาที — site ที่ไม่ส่ง heartbeat > EDGE_HEARTBEAT_STALE_SEC ส่ง LINE
setInterval(() => {
  alertEngine.checkEdgeStale()
    .catch((e) => console.error('[alert-worker] edge stale check error:', e.message || e));
}, 5 * 60 * 1000);
console.log('[alert-worker] ⏱️ edge stale alert loop every 5m');

// ── Edge data-loss alert loop ─────────────────────────────────────
// ⚠️ ต้องอยู่ที่ worker นี้ตัวเดียวเหมือนสองลูปข้างบน — alert-engine ถูก init ใน
// api-server และ ingester ด้วย ถ้าตั้ง interval ในตัว engine เองจะยิงซ้ำทุก process
//
// เหตุผลที่ต้องมี: incident 2026-08-14 — คิวของ vss ตายค้าง 2 สัปดาห์และสัญญาณ
// "กล้องถูกบัง" หายไป 7 สัปดาห์ โดยไม่มีสัญญาณใดเลย ตัวเลขที่บอกความจริงมีอยู่แล้ว
// (edge_status.bridge_dropped) แต่ไม่มีใครดู
setInterval(() => {
  alertEngine.checkEdgeDataLoss()
    .catch((e) => console.error('[alert-worker] edge data-loss check error:', e.message || e));
}, 5 * 60 * 1000);
console.log('[alert-worker] ⏱️ edge data-loss alert loop every 5m');

// ── Camera baseline — คำนวณ "นิสัยความเงียบ" ของกล้องทุกตัว วันละครั้ง ──────
//
// รันช่วงที่ทั้งฟลีตเงียบ เพราะเป็นคิวรีที่ไล่ข้อมูล 14 วัน (~8 ล้านแถว) — เวลาจริงดูบรรทัด 🔴 ด้านล่าง
// อยู่ที่ worker นี้ตัวเดียวด้วยเหตุผลเดียวกับลูปอื่น (ไม่งั้นทุก process แย่งกันคำนวณ)
// 🔴 01:30 ไม่ใช่ 03:30 — คิวรีนี้สแกน events ทุก partition (~85 วิ) และ 03:30 ทับ pg_dump (03:00–~04:00)
// กฎ GOTCHAS #191: งานหนักบน central ก่อน 02:00 หรือหลัง backup จบ
const BASELINE_AT_HOUR = parseInt(process.env.CAMERA_BASELINE_HOUR || '1', 10);
function _msUntilHour(h, m) {
  const now = new Date(), at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  return at - now;
}
const _runBaseline = (opts) => alertEngine.refreshCameraBaselines(opts)
  .catch((e) => console.error('[alert-worker] camera baseline error:', e.message || e));

setTimeout(function daily() {
  _runBaseline();
  setInterval(_runBaseline, 24 * 60 * 60 * 1000);
}, _msUntilHour(BASELINE_AT_HOUR, 30));
console.log(`[alert-worker] ⏱️ camera baseline daily at ${BASELINE_AT_HOUR}:30`);

// เติมฐานให้ทันใช้ถ้ายังไม่เคยคำนวณ (ติดตั้งใหม่ / ตารางเพิ่งถูกสร้าง) — ไม่ต้องรอถึงตี 3
// ข้ามเองถ้าฐานอายุยังไม่ถึง 26 ชม. จึงไม่ลากคิวรีหนักตามทุกครั้งที่ restart
setTimeout(() => _runBaseline({ skipIfFresherThanHours: 26 }), 3 * 60 * 1000);

// ── Camera quiet alert loop (2026-09-12) ──────────────────────────
// อยู่ที่ worker นี้ตัวเดียวด้วยเหตุผลเดียวกับลูปข้างบน
//
// เหตุผลที่ต้องมี: กล้องภูเก็ต 4 ตัวหยุดส่งข้อมูล 8 ชม. 47 นาที โดยไม่มีตัวไหนเตือน —
// ตัวเฝ้าระดับไซต์เห็น heartbeat ปกติ (กล้องอีก 9 ตัวบนไซต์เดียวกันยังส่งอยู่)
// ส่วนตัวเฝ้ารายกล้องเห็นถูกต้องแต่ปลายทางปิดอยู่ทั้ง 188 แถวเพราะมันสแปม
//
// 🔴 ตั้งต้น **ปิด** และไม่มี fallback เป็น "ผู้รับทุกคน" — ต้องตั้ง
// line_config.quiet_alert.recipient_ids เองก่อนถึงจะส่งได้ (กันหลุดเข้ากลุ่มลูกค้า)
setInterval(() => {
  alertEngine.checkQuietCameras()
    .catch((e) => console.error('[alert-worker] camera quiet check error:', e.message || e));
}, 5 * 60 * 1000);
console.log('[alert-worker] ⏱️ camera quiet alert loop every 5m (ตั้งต้นปิด)');

// ── Edge disk / prune alert loop (2026-08-27) ─────────────────────────
// อยู่ที่ worker นี้ตัวเดียวด้วยเหตุผลเดียวกับลูปข้างบน
//
// เหตุผลที่ต้องมี: hdy หมุน snapshot ~114 GB/วัน โดยเหลือว่าง 190 GB ⇒ ถ้าตัวลบ
// หยุดทำงานจะมีเวลาไม่ถึง 2 วันก่อนดิสก์เต็ม · ตัวเลขที่บอกความจริงถูกส่งกลับมา
// ที่ edge_status ทุกรอบ heartbeat อยู่แล้ว (disk_free_gb, last_prune_json)
// แต่ last_prune_json ไม่เคยมีใครอ่านเลยจนถึงวันนี้
setInterval(() => {
  alertEngine.checkEdgeDiskLow()
    .catch((e) => console.error('[alert-worker] edge disk check error:', e.message || e));
}, 15 * 60 * 1000);
console.log('[alert-worker] ⏱️ edge disk/prune alert loop every 15m');

// ── Long-transaction watch ────────────────────────────────────────
// อยู่ที่ worker นี้ตัวเดียวด้วยเหตุผลเดียวกับสามลูปข้างบน (ไม่งั้น log ซ้ำทุก process)
//
// เหตุผลที่ต้องมี: incident 2026-08-27 — transaction เปิดค้าง ~34 ชม. ตรึง
// autovacuum จน events บวม dead tuple 9.4% และหน้า Event Statistics ว่างเปล่า
// ไม่มีสัญญาณใดเลยจนเจ้าของแจ้ง · statement_timeout (migration 181) กันได้แค่
// statement เดี่ยว ไม่ได้กัน transaction ที่ค้างเป็นชั่วโมง — ดู longTxWatch.js
setInterval(() => {
  longTx.checkLongTx(pool)
    .catch((e) => console.error('[alert-worker] long-tx check error:', e.message || e));
}, 5 * 60 * 1000);
console.log(`[alert-worker] ⏱️ long-transaction watch every 5m (เกณฑ์ ${longTx.DEFAULT_AGE})`);

// ── Health endpoint ──────────────────────────────────────────────
// Bound to loopback only; no auth required (no secrets exposed).
http.createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  const t0 = Date.now();
  pool.query('SELECT 1')
    .then(() => {
      const body = {
        ok: _alertListen.isConnected(),
        worker: 'alert-worker',
        uptime_sec: Math.floor((Date.now() - _workerStartedAt) / 1000),
        pid: process.pid,
        memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        db: { ok: true, latency_ms: Date.now() - t0 },
        listener: { connected: _alertListen.isConnected() },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    })
    .catch((e) => {
      const body = {
        ok: false,
        worker: 'alert-worker',
        uptime_sec: Math.floor((Date.now() - _workerStartedAt) / 1000),
        pid: process.pid,
        memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        db: { ok: false, latency_ms: null, error: e.message },
        listener: { connected: _alertListen.isConnected() },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
}).listen(ALERT_WORKER_PORT, '127.0.0.1', () => {
  console.log(`[alert-worker] health on 127.0.0.1:${ALERT_WORKER_PORT}`);
});
