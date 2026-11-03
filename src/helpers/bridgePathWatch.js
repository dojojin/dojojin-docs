// ============================================================
// Vigil Platform — แจ้งเตือนเมื่อ edge-bridge ตกไปใช้เส้นสำรองนานผิดปกติ
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา: 2026-10-19 เจ้าของเลือก Tailscale เป็นเส้นหลักของ bridge (SSH -R สำรอง · wss ท้ายสุด ดู src/edge/bridgePaths.js)
// ระบบสลับเองได้ ข้อมูลจึงไม่หาย แต่ถ้า Tailscale เสียแล้วไม่มีใครรู้ เราจะวิ่งบนเส้นสำรองไปเรื่อย ๆ
// จนเส้นสำรองเสียตามแล้วค่อยรู้ — ตัวนี้บอกตั้งแต่เส้นหลักเสีย
//
// อ่านจาก heartbeat ของ bridge ที่เข้า recordEdgeHeartbeat (mqtt-subscriber) ไม่ต้องมี schema ใหม่:
//   bridge.path (tailscale | ssh | cloudflare) · bridge.path_since (ISO) · bridge.path_switches
// "ตกมาเส้นสำรอง" = path ไม่ใช่เส้นหลัก และเคยสลับเส้นแล้ว (path_switches > 0)
//   ไซต์ที่ตั้งเส้นเดียว (เช่น vss/bma ก่อนเปิด) ไม่เคยสลับ ⇒ ไม่แจ้ง
// ผู้รับ = line_config.perf_alert.recipient_ids (ตอนนี้คือ Dojo-mAn คนเดียว) ไม่แตะกลุ่มอื่น
// สถานะ cooldown อยู่ในหน่วยความจำ — restart mqtt-subscriber แล้วอาจได้ซ้ำอีกใบ (ยอมรับ ไม่คุ้มทำตาราง)
// ============================================================
'use strict';

const { quietSiteCodes } = require('./siteStatus');

const PRIMARY = 'tailscale';        // ponytail: ตายตัว — ถ้าวันหนึ่งเปลี่ยนเส้นหลัก ให้ bridge ส่ง path_primary มาแทน
const WARN_MS = 30 * 60_000;        // อยู่เส้นสำรองเกินนี้ถึงแจ้ง (เส้นหลักกระพริบสั้น ๆ ไม่แจ้ง)
const REPEAT_MS = 6 * 3_600_000;    // ยังอยู่เส้นสำรองต่อ → เตือนซ้ำไม่ถี่กว่านี้

const _state = new Map();           // siteId → { alertedAt }

const _dur = (ms) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} นาที` : `${(m / 60).toFixed(1)} ชั่วโมง`;
};

/** ฟังก์ชันล้วน: คืน { kind:'alert'|'recovered', text } หรือ null · แก้ st ให้เอง */
function evaluate(siteId, bridge, st, now) {
  const b = bridge || {};
  const onBackup = !!b.path && b.path !== PRIMARY && Number(b.path_switches) > 0;
  const since = Date.parse(b.path_since);
  if (onBackup && Number.isFinite(since) && now - since >= WARN_MS
      && (!st.alertedAt || now - st.alertedAt >= REPEAT_MS)) {
    st.alertedAt = now;
    return { kind: 'alert',
      text: `bridge ไซต์ ${siteId} ใช้เส้นสำรอง (${b.path}) มา ${_dur(now - since)} แล้ว — Tailscale ต่อไม่ได้ · ข้อมูลยังเข้าตามปกติ แต่เหลือเส้นสำรองน้อยลง` };
  }
  if (!onBackup && st.alertedAt) {
    st.alertedAt = null;
    return { kind: 'recovered', text: `bridge ไซต์ ${siteId} กลับมาใช้ Tailscale แล้ว` };
  }
  return null;
}

/** เรียกจาก recordEdgeHeartbeat — ไม่โยน error ออกไปกระทบการบันทึก heartbeat */
async function onHeartbeat(pool, siteId, bridge, now = Date.now(), send = (...a) => require('../line-sender').pushLineMessage(...a)) {
  if (!_state.has(siteId)) _state.set(siteId, { alertedAt: null });
  const st = _state.get(siteId), prev = st.alertedAt;
  const r = evaluate(siteId, bridge, st, now);
  if (!r) return;
  // ส่งไม่ได้ (LINE ปิด / ไม่มีผู้รับ / push ล้ม) = ไม่กิน cooldown ลองใหม่ที่ heartbeat ถัดไป เหมือน perfWatch
  const undo = () => { st.alertedAt = prev; };
  // ไซต์ maintenance/archived เงียบทุกแจ้งเตือน (sites.status · migration 285) — undo เพื่อให้ transition จริงถูกแจ้งหลังออกจากโหมด
  if ((await quietSiteCodes(pool)).has(siteId)) return undo();
  const { rows } = await pool.query(
    `SELECT enabled, channel_access_token, perf_alert FROM line_config WHERE id = 1`);
  const lc = rows[0] || {};
  const ids = Array.isArray(lc.perf_alert?.recipient_ids) ? lc.perf_alert.recipient_ids.filter(Boolean) : [];
  if (!lc.enabled || !lc.channel_access_token || lc.perf_alert?.enabled === false || !ids.length) return undo();
  let sent = false;
  for (const id of ids) {
    const res = await send(lc.channel_access_token, id, [{ type: 'text', text: r.text }]);
    if (res?.success) sent = true; else console.warn('[bridge-path] LINE ส่งไม่สำเร็จ:', res?.error);
  }
  if (!sent) undo();
}

module.exports = { evaluate, onHeartbeat, PRIMARY, WARN_MS, REPEAT_MS };
