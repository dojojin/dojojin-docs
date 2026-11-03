// ============================================================
// Vigil Platform — rate-limited "unknown push token" log with source
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เดิม /face-push/:token และ /lpr/:token ที่ token ไม่รู้จัก log หนึ่งบรรทัดต่อคำขอโดยไม่บอกต้นทาง
// ~75,000 บรรทัด/วันมาตั้งแต่ ก.ค. 2569 (log 343 MB) แต่หาไม่ได้ว่าอุปกรณ์ไหนส่ง (audit 2026-10-02 · D15)
// ตอนนี้: นับไว้ แล้วสรุปทุก 10 นาที — จำนวนรวม + 5 ต้นทางที่มากสุด (IP · token 6 ตัวแรก)
// token ที่ไม่รู้จักไม่ใช่ความลับที่ใช้งานได้ จึงแสดง 6 ตัวแรกได้ (ไว้เทียบกับ token เก่าของกล้อง)
// หน้า Health อ่านยอดของรอบล่าสุดผ่าน lastWindows() — เหตุ 2026-10-02: กล้อง 4 ตัวที่ป่าตอง
// มี slot 2 ค้าง token เก่า ส่งมาที่ Central ~1.4 ครั้ง/วินาที อยู่ใน log อย่างเดียวไม่มีใครเห็น (GOTCHAS #220)
'use strict';

const _last = new Map();   // label → ยอดของรอบที่ปิดล่าสุด

function createUnknownTokenLog(label, { flushMs = 10 * 60 * 1000, top = 5, log = console.warn } = {}) {
  let counts = new Map(), total = 0;

  function flush() {
    _last.set(label, total);
    if (!total) return;
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
      .map(([k, n]) => `${k} ×${n}`).join(' · ');
    log(`[${label}] unknown token — dropped ${total} request(s) in ${Math.round(flushMs / 60000)} min · top: ${rows}`);
    counts = new Map(); total = 0;
  }
  const t = setInterval(flush, flushMs);
  if (t.unref) t.unref();

  function record(req) {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket?.remoteAddress || '?';
    const tok = String(req.params?.token || '').slice(0, 6) || '-';
    const key = `${ip} (token ${tok}…)`;
    counts.set(key, (counts.get(key) || 0) + 1);
    total++;
  }
  return { record, flush, stop: () => clearInterval(t) };
}

// { 'face-push': n, 'lpr-push': n } — เฉพาะ label ที่ปิดรอบไปแล้วอย่างน้อยหนึ่งครั้ง
const lastWindows = () => Object.fromEntries(_last);

module.exports = { createUnknownTokenLog, lastWindows };
