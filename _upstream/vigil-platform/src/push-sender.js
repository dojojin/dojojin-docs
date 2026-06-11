// ============================================================
// Vigil Platform — Push Sender (Expo Push API)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright  (c) 2025-2026 ... All Rights Reserved.
// @license    Proprietary
// ============================================================
//
// ส่ง push notification ไป mobile app ผ่าน Expo Push Service.
// Token เก็บใน push_tokens (migration db_migration_push_tokens.sql);
// mobile register ผ่าน POST /api/push/register.
//
// Scope: alert (event มี rule_name) + face — hook ใน api-server
// ws-bridge หลัง pg_notify('new_event'/'new_face'). อิสระจาก LINE config.
//
// Volume guard: per-token cooldown กัน spam เมื่อ rule fire ถี่.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// กันยิงซ้ำถี่: ส่ง push ได้ไม่เกิน 1 ครั้ง / COOLDOWN_MS ต่อ "หัวข้อเดียวกัน"
// (camera_id + rule). ลด noise เมื่อกล้องเดียวยิง rule รัวๆ
const COOLDOWN_MS = 20_000;
const _lastSent = new Map();   // key → timestamp

function _cooldownKey(payload) {
  return `${payload.camera_id || ''}::${payload.rule_name || payload.kind || ''}`;
}

// kind: 'alert' | 'face' → กรองตาม sub-toggle ของแต่ละ device
// userIds (optional): จำกัดเฉพาะ device ของ vigil user ที่ระบุ (alert dispatch);
//   ไม่ส่ง = ทุก device ที่ enabled (เช่น face ที่ไม่ผูก rule)
async function _enabledTokens(pool, kind, userIds) {
  const col = kind === 'face' ? 'notify_face' : 'notify_alert';
  try {
    let sql = `SELECT token FROM push_tokens WHERE enabled = TRUE AND ${col} = TRUE`;
    const params = [];
    if (Array.isArray(userIds) && userIds.length > 0) {
      params.push(userIds);
      sql += ` AND user_id = ANY($1::int[])`;
    }
    const { rows } = await pool.query(sql, params);
    return rows.map(r => r.token).filter(t => typeof t === 'string' && t.startsWith('ExponentPushToken'));
  } catch (e) {
    console.warn('[push] token query failed:', e.message);
    return [];
  }
}

// ส่ง push ไป device ที่ enabled + เปิด sub-toggle ของ kind นั้น
// payload: { title, body, data, camera_id, rule_name, kind }
async function notify(pool, payload) {
  const key = _cooldownKey(payload);
  const now = Date.now();
  if (_lastSent.has(key) && now - _lastSent.get(key) < COOLDOWN_MS) return;
  _lastSent.set(key, now);

  const tokens = await _enabledTokens(pool, payload.kind, payload.userIds);
  if (tokens.length === 0) return;

  // Expo รับ batch ได้ถึง 100 message/request
  const messages = tokens.map(to => ({
    to,
    title: payload.title,
    body:  payload.body,
    sound: 'default',
    data:  payload.data || {},
    priority: 'high',
    channelId: 'alerts',
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify(messages),
    });
    const json = await res.json().catch(() => null);
    // Expo คืน receipts[] — token เสีย (DeviceNotRegistered) ควรลบ
    if (json && Array.isArray(json.data)) {
      json.data.forEach((r, i) => {
        if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
          pool.query(`UPDATE push_tokens SET enabled = FALSE WHERE token = $1`, [tokens[i]]).catch(() => {});
        }
      });
    }
  } catch (e) {
    console.warn('[push] send failed:', e.message);
  }
}

// helper: alert event → push (userIds = vigil user ที่ rule กำหนด)
function notifyAlert(pool, row, userIds) {
  const cam = row.camera_name || row.camera_id;
  return notify(pool, {
    title:     row.rule_name || 'แจ้งเตือน',
    body:      `${cam}${row.location ? ' · ' + row.location : ''}`,
    camera_id: row.camera_id,
    rule_name: row.rule_name,
    kind:      'alert',
    userIds,
    data:      { type: 'event', event_id: row.id, camera_id: row.camera_id },
  });
}

// helper: face capture → push
function notifyFace(pool, row) {
  const cam = row.camera_name || row.camera_id;
  return notify(pool, {
    title:     'ตรวจพบใบหน้า',
    body:      `${cam}${row.location ? ' · ' + row.location : ''}`,
    camera_id: row.camera_id,
    kind:      'face',
    data:      { type: 'face', event_id: row.id, camera_id: row.camera_id },
  });
}

module.exports = { notify, notifyAlert, notifyFace };
