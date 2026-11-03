// ============================================================
// Vigil Platform — Helper: LINE push-quota watcher + one-time warning
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา 2026-09-24: LINE ปฏิเสธ push ไปกลุ่มใหญ่ (185 คน) ด้วย "monthly limit" ทั้งที่
// GET /v2/bot/message/quota/consumption ตอนนั้นยังบอกว่าเหลือ 1,046 ข้อความ — ตัวเลข
// consumption ของ LINE ไม่ real-time พอเชื่อได้เพียงอย่างเดียว (ดู migration 239) จึง
// ต้องฟังจาก error จริงที่บันทึกไว้ใน alert_logs (recipients_json/error_message
// ILIKE '%monthly limit%') ร่วมกับตัวเลข quota ด้วย
//
// เขียนแบบ pure-function-core + thin impure shell (เหมือน suppressionReason ใน
// lprLineAlert.js) เพื่อให้ test เดือน/เกณฑ์ได้โดยไม่ต้องมี DB จริง
// ============================================================
'use strict';

// ── ปฏิทิน Bangkok (UTC+7, ไม่มี DST) — คำนวณด้วยเลขตรง ๆ ไม่พึ่ง ICU/process TZ ──
function monthKeyBkk(date = new Date()) {
  const b = new Date(date.getTime() + 7 * 3600 * 1000);
  return `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStartBkkUtc(date = new Date()) {
  const b = new Date(date.getTime() + 7 * 3600 * 1000);
  // เที่ยงคืนวันที่ 1 ตามเวลากรุงเทพฯ = UTC ของวันเดียวกัน (wall clock) ลบ 7 ชม.
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1, 0, 0, 0) - 7 * 3600 * 1000);
}

function _hmBkk(date) {
  const b = new Date(date.getTime() + 7 * 3600 * 1000);
  return `${String(b.getUTCHours()).padStart(2, '0')}:${String(b.getUTCMinutes()).padStart(2, '0')}`;
}

// ── ตัดสินใจว่าจะส่งไหม — ส่งได้อย่างมากเดือนละ 1 ครั้ง, limit_hit ชนะ below_threshold ──
function decide({ enabled, threshold, remaining, limitHit, state, month }) {
  if (!enabled) return { send: false, reason: null };
  if (state && state.month === month) return { send: false, reason: null }; // แจ้งไปแล้วเดือนนี้
  if (limitHit) return { send: true, reason: 'limit_hit' };
  if (remaining != null && remaining < threshold) return { send: true, reason: 'below_threshold' };
  return { send: false, reason: null };
}

// ── ข้อความแจ้งเตือน (LINE alert = ข้อยกเว้นของ no-emoji-as-UI ใน CLAUDE.md #2-C) ──
function buildQuotaAlertText({ reason, quota, remaining, threshold, limitHit, now }) {
  const lines = [reason === 'limit_hit' ? '⛔ โควตา LINE เต็มแล้ว' : '⚠️ โควตา LINE ใกล้หมด'];
  if (quota && quota.type === 'limited' && remaining != null) {
    lines.push(`ใช้ไป ${quota.used.toLocaleString()} / ${quota.limit.toLocaleString()} · เหลือ ${remaining.toLocaleString()} ข้อความ`);
  }
  if (reason === 'limit_hit') {
    const who = limitHit?.recipient || 'ผู้รับรายหนึ่ง';
    const at = limitHit?.at ? _hmBkk(new Date(limitHit.at)) : _hmBkk(now);
    lines.push(`LINE ปฏิเสธการส่งถึง ${who} เมื่อ ${at} น.`);
  } else if (reason === 'below_threshold') {
    lines.push(`เหลือน้อยกว่า ${threshold.toLocaleString()} ข้อความ`);
  }
  lines.push('กลุ่มไลน์คิดโควตาเป็นรายสมาชิก — ส่งเข้ากลุ่ม 1 ครั้ง หักเท่าจำนวนสมาชิกในกลุ่มนั้น');
  lines.push('ยอดนับจะรีเซ็ตวันที่ 1 ของเดือนถัดไป');
  return lines.join('\n');
}

async function _upsertSetting(pool, key, value) {
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

const ALERT_SETTING_KEYS = ['line_quota_alert_enabled', 'line_quota_alert_threshold',
                             'line_quota_alert_recipients', 'line_quota_alert_state'];

// ── ค่าตั้งของตัวเตือนนี้เอง — ใช้ร่วมกันทั้ง checkQuota() และ GET /quota (route) ──
const RETRY_MIN_MS = 30 * 60 * 1000;

async function _readJsonSetting(pool, key) {
  const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [key]);
  try { return rows[0] ? JSON.parse(rows[0].value || '{}') : null; } catch { return null; }
}

async function readAlertSettings(pool) {
  const { rows } = await pool.query(
    'SELECT key, value FROM system_settings WHERE key = ANY($1)', [ALERT_SETTING_KEYS]);
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let recipients = [];
  try { recipients = JSON.parse(s.line_quota_alert_recipients || '[]') || []; } catch { /* ทิ้ง — ถือว่าว่าง */ }
  let state = {};
  try { state = JSON.parse(s.line_quota_alert_state || '{}') || {}; } catch { /* ทิ้ง — ถือว่ายังไม่เคยแจ้ง */ }
  return {
    enabled: s.line_quota_alert_enabled !== 'false', // ไม่มีแถว = เปิด (ค่าเริ่มต้นของ migration)
    threshold: parseInt(s.line_quota_alert_threshold, 10) || 200,
    recipients, state,
  };
}

// ── หา error "monthly limit" ล่าสุดในเดือนนี้ (alert_logs) — ใครโดน เมื่อไหร่ ──
async function findLimitHit(pool, monthStart) {
  const { rows } = await pool.query(
    `SELECT sent_at, error_message, recipients_json FROM alert_logs
      WHERE sent_at >= $1
        AND (error_message ILIKE '%monthly limit%' OR recipients_json::text ILIKE '%monthly limit%')
      ORDER BY sent_at DESC LIMIT 1`, [monthStart]);
  const row = rows[0];
  if (!row) return null;
  let recipientName = null;
  if (Array.isArray(row.recipients_json)) {
    const bad = row.recipients_json.find((r) => r && r.ok === false && /monthly limit/i.test(r.error || ''));
    if (bad) recipientName = bad.name || null;
  }
  if (!recipientName && row.error_message) {
    const m = /^\[(.+?)\]/.exec(row.error_message);
    if (m) recipientName = m[1];
  }
  return { at: row.sent_at, recipient: recipientName };
}

// ── ตรวจ quota จริง + ส่งคำเตือน (ถ้าถึงเกณฑ์) — ไม่ throw เพราะรันบน timer ──
async function checkQuota(pool, { lineSender = require('../line-sender'), now = new Date() } = {}) {
  try {
    const month = monthKeyBkk(now);
    const { rows: cfgRows } = await pool.query(
      'SELECT channel_access_token, recipients FROM line_config WHERE id = 1');
    const cfg = cfgRows[0] || {};
    const token = cfg.channel_access_token;
    if (!token) return; // ไม่ได้เชื่อม LINE — ไม่มีอะไรให้ตรวจ

    const { enabled, threshold, recipients: alertRecipientIds, state } = await readAlertSettings(pool);

    const quota = await lineSender.getLineQuota(token);
    const remaining = quota && quota.type === 'limited' ? (quota.limit - quota.used) : null;

    const limitHit = await findLimitHit(pool, monthStartBkkUtc(now));

    const last = {
      used: quota?.used ?? null, limit: quota?.limit ?? null, remaining,
      type: quota?.type ?? null, checked_at: now.toISOString(),
      limit_hit_at: limitHit?.at || null, limit_hit_recipient: limitHit?.recipient || null,
      alert_error: null,
    };

    const { send, reason } = decide({ enabled, threshold, remaining, limitHit, state, month });
    if (!send) { await _upsertSetting(pool, 'line_quota_last', last); return; }

    const recipients = (cfg.recipients || []).filter((r) =>
      r && r.enabled !== false && alertRecipientIds.map(String).includes(String(r.id)));

    // ยังไม่มีผู้รับ = ไม่ส่ง ไม่ลง alert_logs — ตัวจับเวลาวิ่งทุก 2 นาที ถ้าลง log ทุกรอบ
    // จะได้แถว no_recipients ~720 แถว/วันไปจนสิ้นเดือน (audit 2026-09-24) · สถานะไปโชว์
    // ในหน้าตั้งค่าผ่าน line_quota_last.alert_error แทน
    if (!recipients.length) {
      last.alert_error = 'ยังไม่ได้เลือกผู้รับคำเตือนนี้';
      await _upsertSetting(pool, 'line_quota_last', last);
      return;
    }
    // ส่งไม่สำเร็จทั้งหมดรอบก่อน → ลองใหม่ได้ แต่ห่างกันอย่างน้อย RETRY_MIN_MS
    // (เหตุผลเดียวกัน: ไม่ให้ log และการยิง LINE ซ้ำทุก 2 นาที)
    const prev = await _readJsonSetting(pool, 'line_quota_last');
    if (prev?.attempt_at && now.getTime() - new Date(prev.attempt_at).getTime() < RETRY_MIN_MS) {
      last.alert_error = prev.alert_error || null;
      last.attempt_at = prev.attempt_at;
      await _upsertSetting(pool, 'line_quota_last', last);
      return;
    }
    const text = buildQuotaAlertText({ reason, quota, remaining, threshold, limitHit, now });

    const results = [];
    let sentCount = 0;
    for (const r of recipients) {
      const res = await lineSender.pushLineMessage(token, r.id, [{ type: 'text', text }]);
      results.push({
        name: r.name || null, type: r.type || null,
        id_tail: r.id ? String(r.id).slice(-4) : null,
        ok: !!res.success, error: res.success ? null : (res.error || null),
      });
      if (res.success) sentCount++;
    }

    await pool.query(
      `INSERT INTO alert_logs (rule_name, triggered_rule, status, message_text,
                                recipient_count, error_message, recipients_json, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      ['LINE quota', reason,
       recipients.length === 0 ? 'no_recipients' : (sentCount > 0 ? 'sent' : 'failed'),
       text, recipients.length,
       sentCount === 0 ? (results.find((r) => !r.ok)?.error || (recipients.length ? 'ส่งไม่สำเร็จทั้งหมด' : 'ยังไม่ได้เลือกผู้รับ')) : null,
       JSON.stringify(results), now]
    );

    if (sentCount > 0) {
      await _upsertSetting(pool, 'line_quota_alert_state', { month, sent_at: now.toISOString(), reason, results });
    } else {
      last.alert_error = 'ส่งไม่สำเร็จทั้งหมด (จะลองใหม่ในอีก 30 นาที)';
      last.attempt_at = now.toISOString();
    }
    await _upsertSetting(pool, 'line_quota_last', last);
  } catch (e) {
    console.error('[line-quota-watch] checkQuota failed:', e.message);
  }
}

module.exports = {
  monthKeyBkk, monthStartBkkUtc, decide, buildQuotaAlertText, checkQuota,
  readAlertSettings, findLimitHit, ALERT_SETTING_KEYS,
};

if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(monthKeyBkk(new Date('2026-08-31T17:30:00Z')), '2026-09'); // 00:30 น. 1 ก.ย. กรุงเทพฯ
  assert.strictEqual(monthKeyBkk(new Date('2026-08-31T16:59:00Z')), '2026-08'); // 23:59 น. 31 ส.ค. กรุงเทพฯ
  assert.deepStrictEqual(decide({ enabled: true, threshold: 200, remaining: null, limitHit: null, state: {}, month: '2026-09' }),
    { send: false, reason: null });
  assert.deepStrictEqual(decide({ enabled: true, threshold: 200, remaining: 50, limitHit: null, state: {}, month: '2026-09' }),
    { send: true, reason: 'below_threshold' });
  assert.deepStrictEqual(decide({ enabled: true, threshold: 200, remaining: 50, limitHit: { at: new Date(), recipient: 'x' }, state: {}, month: '2026-09' }),
    { send: true, reason: 'limit_hit' });
  assert.deepStrictEqual(decide({ enabled: true, threshold: 200, remaining: 50, limitHit: null, state: { month: '2026-09' }, month: '2026-09' }),
    { send: false, reason: null });
  console.log('lineQuotaWatch self-check: all assertions passed');
}
