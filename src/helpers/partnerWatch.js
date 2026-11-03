// ============================================================
// Vigil Platform — ยามเฝ้า partner API รายวัน (OpenAPI ระยะ 2 · R3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา: แนวทาง "ให้ตามความจำเป็น" (เจ้าของตัดสิน 2026-10-21) ให้ข้อมูลตามข้อตกลงที่บันทึกไว้
// (api_consumer_agreements, migration 269) — ข้อตกลงที่ครบทบทวน/หมดแล้วโดยไม่มีใครเห็น
// หรือ partner ที่ใช้งานผิดรูป ต้องมีคนรู้ก่อนเป็นเรื่อง · ไฟล์นี้อ่านแล้วร้อง ไม่ตัดสิทธิ์ใคร
//
// สัญญาณ (เกณฑ์ใน line_config.perf_alert.partner_watch — JSON ก้อนเดิม ไม่ต้องมีคอลัมน์ใหม่ · ปรับได้โดยไม่แก้โค้ด):
//   ข้อตกลง  — ไม่มีข้อตกลงเกิน no_agreement_days · หมดอายุแล้วแต่ยัง active · ครบทบทวนภายใน review_warn_days
//             · credential จะหมดอายุภายใน review_warn_days (หมดแล้ว = ด่าน auth ปฏิเสธอยู่แล้ว ไม่ต้องร้อง)
//   การใช้งาน (24 ชม. ล่าสุด จาก api_request_log) — ปริมาณเกิน volume_ratio เท่าของค่ากลางรายวัน 7 วันก่อน
//             และเกิน volume_min · 403 (ขอเกินสิทธิ์) · 401 ที่ใช้ key ที่รู้จัก (ลายเซ็นผิด/ถูกปิด) · 429 · IP ใหม่
// ผู้รับ = line_config.perf_alert.recipient_ids (Dojo-mAn คนเดียว) — ใช้เปิด/ปิดชุดเดียวกับ perfWatch
// cooldown: ข้อตกลง 7 วัน · การใช้งาน 24 ชม. · ส่งไม่สำเร็จไม่กิน cooldown · สถานะเก็บใน system_settings.partner_watch
// รอบ 08:30 เวลาไทย (ก่อนเริ่มงาน) · ไม่รันตอนบูต
// ============================================================
'use strict';

const KEY = 'partner_watch';
const DAY_MS = 24 * 3600_000;
const DEFAULTS = {
  review_warn_days: 14, no_agreement_days: 7,
  volume_ratio: 5, volume_min: 500,
  forbidden_per_day: 20, badsig_per_day: 20, ratelimited_per_day: 10,
  review_cooldown_days: 7, usage_cooldown_hours: 24,
};

function settings(raw) {
  const c = raw || {};
  const num = (k, min) => { const n = Number(c[k]); return Number.isFinite(n) ? Math.max(min, n) : DEFAULTS[k]; };
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = num(k, k === 'volume_ratio' ? 1.1 : 1);
  return out;
}

const localDay = (d, tz = 'Asia/Bangkok') =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * ฟังก์ชันล้วน: snapshot → รายการที่ควรแจ้ง [{ key, cls:'review'|'usage', text }]
 * consumer: { slug, label, active, created_at, expires_at, agreement:{version,valid_until,review_due}|null,
 *             last24:{total,s401,s403,s429}, daily:[n ของแต่ละวันใน 7 วันก่อนหน้า], new_ips:[...] }
 */
function decide(consumers, cfg, now) {
  const today = localDay(now);
  const items = [];
  const push = (c, kind, cls, text) => items.push({ key: `${c.slug}:${kind}`, cls, text: `${c.label} (${c.slug}): ${text}` });
  for (const c of consumers) {
    const a = c.agreement;
    if (c.active) {
      if (!a) {
        const ageDays = Math.floor((now - new Date(c.created_at)) / DAY_MS);
        if (ageDays >= cfg.no_agreement_days) push(c, 'no-agreement', 'review', `ยังไม่มีข้อตกลงข้อมูล (สร้างมา ${ageDays} วัน)`);
      } else {
        if (a.valid_until && a.valid_until < today) {
          push(c, 'agreement-expired', 'review', `ข้อตกลง v${a.version} หมดอายุ ${a.valid_until} แต่ partner ยังดึงข้อมูลได้`);
        }
        if (a.review_due < today) push(c, 'review-due', 'review', `เลยกำหนดทบทวนข้อตกลง v${a.version} (${a.review_due})`);
        else if (a.review_due <= addDays(today, cfg.review_warn_days)) push(c, 'review-due', 'review', `ครบกำหนดทบทวนข้อตกลง v${a.version} วันที่ ${a.review_due}`);
      }
      if (c.expires_at) {
        const exp = localDay(new Date(c.expires_at));
        if (exp >= today && exp <= addDays(today, cfg.review_warn_days)) push(c, 'cred-expiring', 'review', `credential จะหมดอายุ ${exp}`);
      }
    }
    const u = c.last24 || {};
    const base = median(c.daily || []);
    if (u.total > cfg.volume_min && (base === 0 || u.total > cfg.volume_ratio * base)) {
      push(c, 'volume', 'usage', `คำขอ 24 ชม. ${u.total} ครั้ง` + (base ? ` (ปกติวันละ ~${Math.round(base)})` : ' (ไม่มีประวัติ 7 วันก่อน)'));
    }
    if (u.s403 >= cfg.forbidden_per_day) push(c, 'forbidden', 'usage', `ขอข้อมูลที่ไม่ได้รับสิทธิ์ (403) ${u.s403} ครั้งใน 24 ชม.`);
    if (u.s401 >= cfg.badsig_per_day) push(c, 'badsig', 'usage', `ถูกปฏิเสธยืนยันตัวตน (401) ${u.s401} ครั้งใน 24 ชม.`);
    if (u.s429 >= cfg.ratelimited_per_day) push(c, 'ratelimited', 'usage', `ชนเพดานอัตรา (429) ${u.s429} ครั้งใน 24 ชม.`);
    if ((c.new_ips || []).length) {
      // ponytail: บอกเป็นข้อมูล ไม่ใช่ความผิด · ถ้ามี partner หลายรายแล้วรก ให้ตั้ง cooldown ยาวขึ้นหรือตัดสัญญาณนี้
      push(c, 'new-ip', 'usage', `เรียกจาก IP ใหม่: ${c.new_ips.slice(0, 5).join(', ')}${c.new_ips.length > 5 ? ` และอีก ${c.new_ips.length - 5}` : ''}`);
    }
  }
  return items;
}

/** ตัดรายการที่ยังอยู่ใน cooldown · คืน { due, alerted } โดยไม่แก้ของเดิม */
function dueItems(items, alerted, cfg, now) {
  const cd = { review: cfg.review_cooldown_days * DAY_MS, usage: cfg.usage_cooldown_hours * 3600_000 };
  return items.filter((it) => !alerted[it.key] || now - Date.parse(alerted[it.key]) >= cd[it.cls]);
}

async function snapshot(pool, now) {
  const { rows: consumers } = await pool.query(
    `SELECT c.id, c.slug, c.label, c.active, c.created_at, c.expires_at,
            CASE WHEN a.version IS NULL THEN NULL ELSE
              json_build_object('version', a.version, 'valid_until', a.valid_until::text, 'review_due', a.review_due::text) END AS agreement
       FROM api_consumers c
       LEFT JOIN LATERAL (SELECT version, valid_until, review_due FROM api_consumer_agreements
                           WHERE consumer_id = c.id ORDER BY version DESC LIMIT 1) a ON true
      WHERE c.revoked_at IS NULL OR c.revoked_at > $1::timestamptz - interval '30 days'`, [now]);
  // ขอบเวลาทุกคิวรีบน api_request_log (idx_api_request_log_consumer = (consumer_id, at))
  const { rows: usage } = await pool.query(
    `SELECT consumer_id,
            count(*) FILTER (WHERE at >= $1::timestamptz - interval '1 day')::int AS total,
            count(*) FILTER (WHERE at >= $1::timestamptz - interval '1 day' AND status = 401)::int AS s401,
            count(*) FILTER (WHERE at >= $1::timestamptz - interval '1 day' AND status = 403)::int AS s403,
            count(*) FILTER (WHERE at >= $1::timestamptz - interval '1 day' AND status = 429)::int AS s429,
            json_object_agg(d, n) FILTER (WHERE d IS NOT NULL) AS daily
       FROM (SELECT consumer_id, at, status, NULL::int AS d, NULL::int AS n FROM api_request_log
              WHERE consumer_id IS NOT NULL AND at >= $1::timestamptz - interval '1 day' AND at < $1::timestamptz
             UNION ALL
             SELECT consumer_id, NULL, NULL, d, count(*)::int FROM (
               SELECT consumer_id, floor(extract(epoch FROM ($1::timestamptz - at)) / 86400)::int AS d
                 FROM api_request_log
                WHERE consumer_id IS NOT NULL AND at >= $1::timestamptz - interval '8 days' AND at < $1::timestamptz - interval '1 day') x
              GROUP BY consumer_id, d) u
      GROUP BY consumer_id`, [now]);
  const { rows: ips } = await pool.query(
    `SELECT consumer_id, array_agg(DISTINCT ip) AS ips
       FROM api_request_log r
      WHERE consumer_id IS NOT NULL AND ip IS NOT NULL
        AND at >= $1::timestamptz - interval '1 day' AND at < $1::timestamptz
        AND NOT EXISTS (SELECT 1 FROM api_request_log p
                         WHERE p.consumer_id = r.consumer_id AND p.ip = r.ip
                           AND p.at >= $1::timestamptz - interval '31 days' AND p.at < $1::timestamptz - interval '1 day')
      GROUP BY consumer_id`, [now]);
  const byU = new Map(usage.map((r) => [String(r.consumer_id), r]));
  const byIp = new Map(ips.map((r) => [String(r.consumer_id), r.ips]));
  return consumers.map((c) => {
    const u = byU.get(String(c.id)) || {};
    // 7 วันก่อนหน้า: วันที่ไม่มีคำขอเลยนับเป็น 0 ไม่ใช่ข้าม — ไม่งั้นค่ากลางสูงเกินจริงสำหรับ partner ที่ใช้นาน ๆ ครั้ง
    const daily = Array(7).fill(0);                       // d = 1..7 วันก่อนหน้า 24 ชม. ล่าสุด
    for (const [d, n] of Object.entries(u.daily || {})) if (d >= 1 && d <= 7) daily[d - 1] = n;
    return { ...c, last24: { total: u.total || 0, s401: u.s401 || 0, s403: u.s403 || 0, s429: u.s429 || 0 },
      daily, new_ips: byIp.get(String(c.id)) || [] };
  });
}

async function runOnce(pool, { now = new Date(), send } = {}) {
  try {
    const { rows: [lc] } = await pool.query(
      `SELECT enabled, channel_access_token, perf_alert FROM line_config WHERE id = 1`);
    const cfg = settings(lc?.perf_alert?.partner_watch);
    const consumers = await snapshot(pool, now);
    const items = decide(consumers, cfg, now);
    const prev = await pool.query('SELECT value FROM system_settings WHERE key = $1', [KEY]);
    let old = {};
    try { old = JSON.parse(prev.rows[0]?.value || '{}'); } catch { /* ค่าเสีย = เริ่มใหม่ */ }
    const alerted = old.alerted || {};
    const due = dueItems(items, alerted, cfg, now);
    const ids = Array.isArray(lc?.perf_alert?.recipient_ids) ? lc.perf_alert.recipient_ids.filter(Boolean) : [];
    let sent = false;
    if (due.length && lc?.enabled && lc.channel_access_token && lc.perf_alert?.enabled !== false && ids.length) {
      const text = `Partner API (${localDay(now)}) — ${due.length} เรื่อง:\n` + due.map((d) => `· ${d.text}`).join('\n');
      const push = send || ((...a) => require('../alert-engine')._pushToAll(...a));
      const r = await push(lc.channel_access_token, ids.map((id) => ({ id })), [{ type: 'text', text: text.slice(0, 4900) }], 'partner-watch');
      sent = !!r?.sent;                                   // ส่งไม่สำเร็จ = ไม่กิน cooldown
      if (sent) for (const d of due) alerted[d.key] = now.toISOString();
    }
    const payload = { generated_at: now.toISOString(), items, sent, alerted };
    await pool.query(
      `INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KEY, JSON.stringify(payload), 'ผลยามเฝ้า partner API รายวัน (helpers/partnerWatch.js)']);
    console.log(`[partner-watch] ${localDay(now)}: พบ ${items.length} · แจ้ง ${sent ? due.length : 0}`);
    return payload;
  } catch (e) {
    console.error('[partner-watch] ล้ม:', e.message);
    return null;
  }
}

let _started = false;
function start(pool) {
  if (_started) return;
  _started = true;
  const { nextRunDelayMs } = require('./helmetMetricCheck');
  const first = nextRunDelayMs(new Date(), { hour: 8, minute: 30 });
  setTimeout(() => {
    runOnce(pool);
    setInterval(() => runOnce(pool), DAY_MS).unref?.();
  }, first).unref?.();
  console.log(`[partner-watch] scheduled in ${Math.round(first / 60_000)} min, then daily 08:30`);
}

module.exports = { start, runOnce, snapshot, decide, dueItems, settings, DEFAULTS, KEY };
