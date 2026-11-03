// ============================================================
// Vigil Platform — Edge bridge path selection
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// เส้นทางขึ้น central มีได้หลายเส้น เรียงตามลำดับความสำคัญใน BRIDGE_BROKER_URLS
// (เจ้าของเลือก 2026-10-18): ① Tailscale  ② SSH -R ที่ central เปิดเข้ามา  ③ wss ผ่าน Cloudflare
//
// เหตุ: ISP ของ hkt/hdy/nrw (NT) และ rmutr-v พา anycast ของ Cloudflare ไปลงยุโรปเป็นช่วง ๆ
// (CDG/MRS/MXP, TCP connect 0.17–0.36 s) ⇒ wss หลุดเป็นพายุ 20–45 ครั้ง/ชม. ตั้งแต่ ~15 ต.ค.
//
// ไฟล์นี้เป็นฟังก์ชันล้วน ไม่มี I/O — bridge.js เป็นคนเรียกและทำตามที่ decide() บอก
// ============================================================
'use strict';

const FAILOVER_MS  = 30_000;   // เส้นปัจจุบันต่อไม่ได้ติดต่อกันเท่านี้ → ไปเส้นถัดไป
const MIN_DWELL_MS = 120_000;  // อยู่เส้นสำรองอย่างน้อยเท่านี้ก่อนกลับเส้นหลัก กันสลับไปมา
const FAILBACK_OK  = 2;        // probe เส้นหลักผ่านติดกันกี่รอบถึงจะกลับ

function parseUrls(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function pathName(url) {
  const u = String(url || '');
  if (/^mqtts?:\/\/100\./.test(u)) return 'tailscale';
  if (/^mqtts?:\/\/(127\.0\.0\.1|localhost):18830\b/.test(u)) return 'ssh';
  if (/^wss?:\/\//.test(u)) return 'cloudflare';
  return 'other';
}

/**
 * @param s  { idx, count, connected, downSince, since, probeOk }
 *           downSince = ms ที่เส้นปัจจุบันเริ่มต่อไม่ได้ (null = ต่ออยู่)
 *           since     = ms ที่ย้ายมาเส้นนี้
 *           probeOk   = probe เส้นหลักผ่านติดกันกี่รอบ
 * @returns  index ของเส้นที่ควรย้ายไป หรือ null = อยู่เส้นเดิม
 */
function decide(s, now) {
  if (s.count < 2) return null;   // เส้นเดียว = พฤติกรรมเดิม (watchdog ใน bridge.js ดูแลเอง)
  if (!s.connected && s.downSince != null && now - s.downSince >= FAILOVER_MS) {
    return (s.idx + 1) % s.count;
  }
  if (s.idx !== 0 && s.connected && s.probeOk >= FAILBACK_OK && now - s.since >= MIN_DWELL_MS) {
    return 0;
  }
  return null;
}

module.exports = { parseUrls, pathName, decide, FAILOVER_MS, MIN_DWELL_MS, FAILBACK_OK };
