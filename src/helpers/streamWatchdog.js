// ============================================================
// Vigil Platform — เฝ้า long-lived event stream ว่าตายเงียบหรือยัง
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ทำไมต้องมี (incident จริง 2026-08-10, GOTCHAS #152):
// ingester ของ Hikvision/Dahua เปิด HTTP request ค้างไว้ (`timeout: 0` โดยตั้งใจ
// เพราะ stream ต้องอยู่ยาวและเงียบได้ระหว่างไม่มีเหตุการณ์) แล้ว reconnect
// เฉพาะตอน `res.on('end')` / `on('error')` เท่านั้น
//
// 🔴 ปัญหา: ถ้า TCP ตายแบบ "เงียบ" — ปลายทางหายไปโดยไม่ส่ง FIN/RST (กล้อง reboot,
// อุปกรณ์กลางตัด flow ทิ้ง, NAT timeout) — socket ฝั่งเราจะยัง ESTABLISHED อยู่
// อย่างนั้นตลอดไป ไม่มี event ไหนถูกยิงเลย ⇒ ingest หยุดเงียบโดยไม่มีใครรู้
// ของจริง: vss หยุดรับ 6 ชั่วโมงเต็มโดย pm2 ยังขึ้น online และ ss ยังโชว์ ESTAB
//
// ✅ ทำไม "ไม่มี byte เข้าเลย" ถึงใช้เป็นสัญญาณตายได้:
// วัดจากกล้องจริงบน vss แล้ว — alertStream ส่ง heartbeat ต่อเนื่อง
// **8,622 bytes/นาที** แม้ตอนไม่มีเหตุการณ์ใด ๆ เลย ⇒ เงียบสนิทหลายนาที
// ไม่ใช่ "กล้องว่าง" แต่คือ "สายตายแล้ว" · ตั้ง default ไว้ 5 นาทีซึ่งห่างจาก
// heartbeat จริงมากพอที่จะไม่ตัดผิดตัว
//
// นับ "byte ที่เข้ามา" ไม่ใช่ "เหตุการณ์ที่ parse ได้" — กล้องที่ส่งแต่ heartbeat
// ยังถือว่ามีชีวิต ห้ามนับเฉพาะ event ไม่งั้นจะตัดกล้องที่ตั้งอยู่ในซอยเงียบทิ้ง
// ============================================================
'use strict';

const STALE_MS = Number(process.env.STREAM_STALE_MS || 300_000);   // 5 นาที
// รอบตรวจต้องถี่กว่า threshold เสมอ ไม่งั้นเวลาตรวจพบจริงจะบวกไปอีกเต็มหนึ่งรอบ
// (และถ้าตั้ง threshold สั้นกว่ารอบตรวจ เช่นตอนทดสอบ จะไม่มีวันยิงเลย)
const SWEEP_MS = Math.max(1_000, Math.min(30_000, Math.floor(STALE_MS / 4)));

const _streams = new Map();   // key → { last, onStale, label }
let _timer = null;

function _sweep() {
  const now = Date.now();
  for (const [key, s] of _streams) {
    if (now - s.last < STALE_MS) continue;
    const quiet = Math.round((now - s.last) / 1000);
    console.error(`  🔴 [${s.label}] ไม่มีข้อมูลเข้า stream มา ${quiet}s — ถือว่าสายตายเงียบ สั่งต่อใหม่`);
    // ลบก่อนเรียก onStale — onStale จะไปปิด req ซึ่งจะวิ่งกลับมา unregister อีกรอบ
    _streams.delete(key);
    try { s.onStale(); } catch (e) { console.error(`  ❌ [${s.label}] watchdog:`, e.message); }
  }
  if (!_streams.size && _timer) { clearInterval(_timer); _timer = null; }
}

/**
 * เริ่มเฝ้า stream หนึ่งเส้น
 * @param {string} key    ตัวระบุไม่ซ้ำ (camera_id หรือ device key)
 * @param {string} label  ชื่อที่จะขึ้น log
 * @param {function} onStale  ให้ทำอะไรเมื่อเงียบเกินกำหนด (ปกติคือ req.destroy())
 */
function watch(key, label, onStale) {
  _streams.set(key, { last: Date.now(), onStale, label });
  if (!_timer) { _timer = setInterval(_sweep, SWEEP_MS); _timer.unref?.(); }
}

/** มี byte เข้ามาแล้ว — เรียกทุกครั้งใน res.on('data') */
function touch(key) {
  const s = _streams.get(key);
  if (s) s.last = Date.now();
}

/** เลิกเฝ้า (stream ปิดเองแล้ว หรือกำลังจะต่อใหม่) */
function unwatch(key) {
  _streams.delete(key);
  if (!_streams.size && _timer) { clearInterval(_timer); _timer = null; }
}

/**
 * เปิด TCP keepalive บน socket ของ request — กันชั้นที่สอง
 * ให้ OS เป็นคนตรวจว่าปลายทางยังอยู่ไหม โดยไม่ต้องรอ watchdog ครบ 5 นาที
 * (ได้ผลเฉพาะกรณีปลายทางหายจริง ๆ · ถ้ามีอุปกรณ์กลางตอบแทนจะไม่ช่วย จึงต้องมี watchdog ด้วย)
 */
function enableKeepAlive(req, initialDelayMs = 30_000) {
  req.on('socket', (sock) => {
    try { sock.setKeepAlive(true, initialDelayMs); } catch { /* best effort */ }
  });
}

module.exports = { watch, touch, unwatch, enableKeepAlive, STALE_MS };
