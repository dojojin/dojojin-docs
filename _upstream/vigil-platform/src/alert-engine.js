// ============================================================
// Vigil Platform — Alert Engine
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Rule matching + Cooldown management
//
// Usage (จาก mqtt-subscriber.js):
//   const alertEngine = require('./alert-engine');
//   alertEngine.init(pool);
//   await alertEngine.onEvent({ event_id, camera_id, rule_name, event_time, ... });
//
// ============================================================

const lineSender = require('./line-sender');
const pushSender = require('./push-sender');

let pool = null;
let rulesCache = [];
let configCache = null;
let displayTz = 'Asia/Bangkok';   // refreshed from system_settings alongside the rule cache
let cacheRefreshTimer = null;
let lastRefresh = 0;
const CACHE_TTL_MS = 30 * 1000; // 30 วินาที

// ── Init ────────────────────────────────────────────────────
function init(pgPool) {
  pool = pgPool;
  refreshCache(); // Initial load
  // Background refresh ทุก 30 วินาที (กัน race ถ้า admin แก้ rule)
  cacheRefreshTimer = setInterval(refreshCache, CACHE_TTL_MS);
  console.log('🔔 Alert engine initialized');
}

function shutdown() {
  if (cacheRefreshTimer) clearInterval(cacheRefreshTimer);
}

// ── Cache management ────────────────────────────────────────
async function refreshCache() {
  try {
    const [rulesRes, configRes, tzRes] = await Promise.all([
      pool.query('SELECT * FROM alert_rules WHERE enabled = true'),
      pool.query('SELECT * FROM line_config WHERE id = 1'),
      pool.query("SELECT value FROM system_settings WHERE key = 'display_timezone'"),
    ]);
    rulesCache = rulesRes.rows;
    configCache = configRes.rows[0] || null;
    const tz = tzRes.rows[0]?.value;
    if (typeof tz === 'string' && tz.trim()) displayTz = tz.trim();
    lastRefresh = Date.now();
  } catch (e) {
    // e.message อาจว่าง (เช่น pg connection teardown) — fallback เป็น error เต็ม
    // เพื่อไม่ให้ log บรรทัดว่าง (incident 2026-06-07, audit A5)
    console.error('🔔 Alert engine cache refresh error:', e.message || e);
  }
}

// Force refresh (เรียกหลัง user แก้ rule ผ่าน UI)
async function invalidateCache() {
  await refreshCache();
}

// ── Rule matching ───────────────────────────────────────────
function matchRule(rule, event) {
  // camera_ids ว่าง = match ทุก camera
  if (rule.camera_ids && rule.camera_ids.length > 0) {
    if (!rule.camera_ids.includes(event.camera_id)) return false;
  }
  // rule_names ว่าง = match ทุก rule
  if (rule.rule_names && rule.rule_names.length > 0) {
    if (!rule.rule_names.includes(event.rule_name)) return false;
  }
  return true;
}

// ── Cooldown check ──────────────────────────────────────────
function isInCooldown(rule) {
  if (!rule.last_triggered_at) return false;
  const elapsedSec = (Date.now() - new Date(rule.last_triggered_at).getTime()) / 1000;
  return elapsedSec < rule.cooldown_seconds;
}

// ── Quiet-hours check ───────────────────────────────────────
// active_from / active_to are TIME columns naming the QUIET window
// (LINE alerts are SILENCED while now ∈ [from, to); fire outside it).
// NULL columns → no quiet hours configured → never quiet → always fire.
// The columns are still named active_* for historical reasons — semantics
// are now quiet-hours: see UI label "ช่วงเวลาเงียบ (Quiet Hours)".
// Comparison is in display timezone; windows that cross midnight (from > to,
// e.g. 22:00–06:00) are supported.
function isWithinQuietHours(rule) {
  if (!rule.active_from || !rule.active_to) return false;  // not configured → never quiet
  const from = String(rule.active_from).slice(0, 5);       // TIME → "HH:MM:SS" → "HH:MM"
  const to   = String(rule.active_to).slice(0, 5);
  if (from === to) return false;                           // identical → never quiet (no window)
  // Current time-of-day in the display timezone, zero-padded "HH:MM" so a
  // lexicographic string compare is correct.
  const now = new Date().toLocaleTimeString('en-GB', {
    timeZone: displayTz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return from < to
    ? (now >= from && now < to)        // normal window, e.g. 09:15–17:30
    : (now >= from || now < to);       // crosses midnight, e.g. 22:00–06:00
}

// ── Main event handler ──────────────────────────────────────
async function onEvent(event) {
  // Refresh cache ถ้านานเกิน TTL (กัน timer พลาด)
  if (Date.now() - lastRefresh > CACHE_TTL_MS * 2) {
    await refreshCache();
  }

  // === Mobile PUSH — dispatch ตาม rule.push_user_ids (รายคน) ===
  // อิสระจาก LINE channel on/off. ว่าง = ไม่ส่ง (สมมาตรกับ LINE recipients).
  // push-sender มี cooldown 20s/หัวข้อในตัว จึงไม่พึ่ง isInCooldown ของ LINE.
  for (const rule of rulesCache) {
    const pushUsers = rule.push_user_ids || [];
    if (pushUsers.length === 0) continue;     // ไม่เลือกผู้รับ = ไม่ส่ง
    if (!matchRule(rule, event)) continue;
    if (isWithinQuietHours(rule)) continue;
    pushSender.notifyAlert(pool, {
      id:          event.event_id,
      camera_id:   event.camera_id,
      camera_name: event.camera_name,
      location:    event.location,
      rule_name:   event.rule_name,
    }, pushUsers);
    break; // ส่ง push ครั้งเดียวต่อ event แม้ match หลาย rule
  }

  if (!configCache || !configCache.enabled || !configCache.channel_access_token) {
    return; // LINE ปิดอยู่ — skip silently (push ส่งไปแล้วด้านบน)
  }

  if (rulesCache.length === 0) return; // ไม่มี rule

  for (const rule of rulesCache) {
    if (!matchRule(rule, event)) continue;

    // Quiet hours — skip (and log) if NOW is INSIDE the configured quiet
    // window. Checked before cooldown: no point tracking cooldown for an
    // alert that's silenced anyway.
    if (isWithinQuietHours(rule)) {
      await logAttempt(rule, event, 'quiet_hours_skip', null, 0, 0, '');
      continue;
    }

    // Cooldown check
    if (isInCooldown(rule)) {
      await logAttempt(rule, event, 'cooldown_skip', null, 0, 0, '');
      continue;
    }

    // Get recipients
    const allRecipients = configCache.recipients || [];
    // ว่าง = ไม่ส่ง (เดิม fallback all; เปลี่ยนให้สมมาตรกับ mobile — ผู้รับเป็นตัวกำหนด)
    const targetIds = rule.recipient_ids || [];
    const recipients = allRecipients.filter(r => r.enabled && targetIds.includes(r.id));

    if (recipients.length === 0) {
      await logAttempt(rule, event, 'no_recipients', null, 0, 0, '');
      continue;
    }

    // Send!
    const startMs = Date.now();
    let result;
    try {
      result = await lineSender.sendAlert({
        rule,
        event,
        recipients,
        token: configCache.channel_access_token,
        imgbbKey: configCache.imgbb_api_key,
      });
    } catch (e) {
      result = { success: false, error: e.message, messageText: '', sentCount: 0 };
    }
    const durationMs = Date.now() - startMs;

    // Update last_triggered_at + trigger_count (in DB + cache)
    if (result.success || result.sentCount > 0) {
      try {
        await pool.query(
          'UPDATE alert_rules SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = $1',
          [rule.id]
        );
        rule.last_triggered_at = new Date().toISOString();
        rule.trigger_count = (rule.trigger_count || 0) + 1;
      } catch {}
    }

    // Log
    await logAttempt(
      rule, event,
      result.success ? 'success' : 'failed',
      result.error,
      result.sentCount || 0,
      durationMs,
      result.messageText || ''
    );
  }
}

// ── Logging ─────────────────────────────────────────────────
async function logAttempt(rule, event, status, errorMsg, recipientCount, durationMs, messageText) {
  try {
    await pool.query(
      `INSERT INTO alert_logs
       (rule_id, rule_name, event_id, camera_id, triggered_rule, event_time,
        status, message_text, recipient_count, error_message, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        rule.id, rule.name, event.event_id || null,
        event.camera_id, event.rule_name, event.event_time || new Date().toISOString(),
        status, messageText, recipientCount, errorMsg, durationMs
      ]
    );
  } catch (e) {
    console.error('🔔 Log error:', e.message);
  }
}

module.exports = {
  init,
  shutdown,
  onEvent,
  invalidateCache,
  // exported for unit tests (pure functions — no DB/network deps)
  matchRule,
  isInCooldown,
};
