// ============================================================
// Vigil Platform — Routes: System Settings
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');

// route นี้กันแต่ "การเขียน" มาตลอด (requireAdminForWrites) ส่วน GET เปิดให้ทุกคนที่
// ล็อกอิน แล้วคืนทั้งตาราง → บัญชี operator ที่ถูกขโมยอ่าน license JWT + mapbox token
// + นโยบาย retention ทั้งชุดได้ฟรี (ยืนยันด้วย repro จริง 2026-08-12, GOTCHAS #164)
//
// ── ทำไมเป็น allowlist ไม่ใช่ปิดบังเป็นราย key ──────────────────
// setting ใหม่ที่ใครเพิ่มวันหน้า **ไม่หลุดออกไปเอง** ต้องตั้งใจเติมชื่อลงรายการนี้
// (fail closed แบบเดียวกับ view allowlist ใน decision #251) ตรงข้ามกับ denylist ที่
// ลืมเติมเมื่อไหร่ = รั่วเงียบๆ ทันที
//
// key ในรายการนี้มาจากการไล่ดู **จุดที่อ่านจริง** ในหน้าที่ viewer เข้าถึงได้ ไม่ใช่ grep
// เจอชื่อแล้วใส่ (`display_timezone`/`bl_*`/`face_show_expression` grep เจอแต่เป็น
// คอมเมนต์ หรือมาจาก endpoint อื่น จึงไม่อยู่ในนี้) เพิ่ม key ใหม่ = ต้องชี้ได้ว่าใครอ่าน
const PUBLIC_SETTING_KEYS = new Set([
  'nav_hidden_pages',            // dashboard.js — ซ่อนเมนูตามค่ากลาง
  'custom_range_max_days',       // page-stats.js — เพดานช่วงวันที่ที่เลือกได้
  'auraface_match_threshold',    // page-auraface-blacklist.js — เกณฑ์ match ที่แสดงบนการ์ด
  'lpr_bbox_vehicle_enabled',    // page-lpr.js — overlay กรอบรถ
  'lpr_bbox_plate_enabled',      // page-lpr.js — overlay กรอบป้าย
  'lpr_bbox_full_image_enabled', // page-lpr.js — overlay บนภาพเต็ม
  'report_section_titles',       // report-template.js — ชื่อหัวข้อรายงานที่ตั้งเอง
                                 // (viewer เปิดหน้ารายงานแล้วดูตัวอย่างได้ ต้องเห็นชื่อเดียวกับ PDF)
]);

// ชั้นที่สอง เผื่อวันหน้ามีคนเผลอเติม key ลับลง PUBLIC_SETTING_KEYS — เทสต์ assert ว่า
// สองชุดนี้ต้องไม่ทับกัน และ runtime ก็ยังปิดบังค่าให้อีกชั้นถ้าเกิดทับกันจริง
const SECRET_SETTING_KEYS = new Set(['license_key', 'mapbox_token', 'carto_api_key']);

// ชื่อหัวข้อรายงานที่ตั้งเอง (migration 224) — JSON object: section key -> ชื่อ
// รายชื่อ 9 คีย์นี้ซ้ำกับ SECTION_KEYS ใน dashboard/report-template.js โดยตั้งใจ —
// route ฝั่ง server ห้าม require ไฟล์ของ dashboard · เพิ่มหัวข้อใหม่ต้องแก้สองที่
// คีย์นอกรายการถูก **ทิ้งเงียบ** ไม่ใช่ error: แท็บเก่าที่ยังค้างในเบราว์เซอร์อาจส่ง
// คีย์ที่ถอดไปแล้วกลับมา ไม่ควรทำให้บันทึกทั้งชุดไม่ผ่าน
// อยู่นอก SETTINGS_VALIDATORS เพราะตัวนี้ไม่ต้องใช้อะไรจาก closure — เทสต์เรียกตรงได้
const REPORT_SECTION_KEYS = ['trend', 'catchart', 'share', 'percam', 'detail', 'heatmap', 'quiet', 'daily7', 'monthly'];
function validateReportSectionTitles(v) {
  let obj = v;
  if (typeof v === 'string') {
    try { obj = JSON.parse(v); } catch { throw new Error('report_section_titles must be a JSON object'); }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('report_section_titles must be an object');
  }
  const clean = {};
  for (const k of REPORT_SECTION_KEYS) {
    const s = typeof obj[k] === 'string' ? obj[k].trim() : '';
    // ว่าง = สั่งคืนค่าเริ่มต้น จึงไม่เก็บลงไป ไม่ใช่เก็บสตริงว่างทับชื่อเดิม
    if (!s) continue;
    if (s.length > 60) throw new Error(`report_section_titles.${k} too long (max 60)`);
    clean[k] = s;
  }
  return JSON.stringify(clean);
}

function redactSettings(rows, trusted) {
  const obj = {};
  for (const r of rows) {
    if (!trusted && !PUBLIC_SETTING_KEYS.has(r.key)) continue;
    const hide = !trusted && SECRET_SETTING_KEYS.has(r.key);
    obj[r.key] = {
      value: hide ? (r.value ? '\u2022\u2022\u2022\u2022\u2022\u2022' : r.value) : r.value,
      redacted: hide || undefined,
      description: r.description,
      updated_at: r.updated_at,
    };
  }
  return obj;
}

module.exports = function settingsRoutes(app, pool, { auth, getIP, ANALYTICS_EVENT_KEYS, refreshAnalyticsEnabledSet, invalidateMapboxToken, invalidateCartoKey, invalidateSystemSetting }) {

  // GET /api/settings — list all settings
  app.get('/api/settings', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT key, value, description, updated_at FROM system_settings ORDER BY key');
      res.json(redactSettings(rows, req.internal === true || req.user?.role === 'admin'));
    } catch (err) { routeError(res, err, 'GET /api/settings'); }
  });

  const SETTINGS_VALIDATORS = {
    // นโยบายล็อคบัญชีเมื่อ login ผิดซ้ำ (migration 196) — src/auth.js อ่านผ่าน
    // getSystemSetting ทุกครั้งที่มี login ผิด (cache 60s) และ fallback เป็น 5/15
    // ถ้าแถวหาย · ขอบเขตกันค่าที่ทำให้ระบบใช้ไม่ได้: ล็อคหลัง 1 ครั้งหรือล็อคข้ามวัน
    login_max_failed: v => {
      const n = parseInt(v, 10);
      if (!Number.isInteger(n) || n < 3 || n > 20) throw new Error('login_max_failed must be 3-20');
      return String(n);
    },
    login_lockout_minutes: v => {
      const n = parseInt(v, 10);
      if (!Number.isInteger(n) || n < 1 || n > 1440) throw new Error('login_lockout_minutes must be 1-1440');
      return String(n);
    },
    // เมนู sidebar ที่ซ่อนไว้ — JSON array ของ data-page (migration 141)
    // "settings" ห้ามซ่อน: ซ่อนแล้วจะไม่มีทางกลับเข้ามาเปิดคืนได้เลยนอกจากแก้ DB มือ
    // กันตั้งแต่ฝั่ง server ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ เพราะ PUT ยิงตรงได้
    nav_hidden_pages: v => {
      let arr = v;
      if (typeof v === 'string') {
        try { arr = JSON.parse(v); } catch { throw new Error('nav_hidden_pages must be a JSON array'); }
      }
      if (!Array.isArray(arr)) throw new Error('nav_hidden_pages must be an array');
      const clean = [...new Set(arr.map(String).map(s => s.trim()).filter(Boolean))]
        .filter(p => p !== 'settings')
        .filter(p => /^[a-z0-9-]{1,40}$/.test(p));
      if (clean.length > 40) throw new Error('nav_hidden_pages too long');
      return JSON.stringify(clean);
    },
    report_section_titles: validateReportSectionTitles,
    data_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('data_retention_days must be 1..730');
      return String(n);
    },
    appearances_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('appearances_retention_days must be 1..730');
      return String(n);
    },
    // migration 177 — เดิมเป็นเลขตายตัว 30 วันในโค้ด ทำให้หมวดรายงานเป็นหมวดเดียว
    // ที่ตั้งอายุไม่ได้ ขณะที่หน้าจัดการพื้นที่บอกว่าตั้งได้ทุกหมวด
    report_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) throw new Error('report_retention_days must be 1..365');
      return String(n);
    },
    snapshot_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) throw new Error('snapshot_retention_days must be 1..365');
      return String(n);
    },
    // migration 236 — backup.sh / backup-offsite.sh read these three ผ่าน psql
    // ตรง ๆ ก่อนรันทุกครั้ง ไม่ผ่าน getSystemSetting (สคริปต์เป็น bash ไม่ใช่ Node)
    // ที่มา: offsite backup หยุดทำงาน 15 วัน (8-22 ก.ย. 2026) เพราะ TimeoutStartSec
    // คงที่ตั้งแต่ DB ยังเล็ก — ดู GOTCHAS #212
    backup_local_retain_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 90) throw new Error('backup_local_retain_days must be 1..90');
      return String(n);
    },
    backup_cloud_retain_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 90) throw new Error('backup_cloud_retain_days must be 1..90');
      return String(n);
    },
    // HH:MM ตามเวลาเครื่อง — timer ตรวจทุก 5 นาที จึงคลาดเคลื่อนได้ไม่เกิน 5 นาที
    backup_schedule_time: v => {
      const s = String(v || '').trim();
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
      if (!m) throw new Error('backup_schedule_time must be HH:MM (00:00-23:59)');
      return s;
    },
    // RF4 — LPR-specific retention. lpr_retention_days = metadata rows (anprAlarm
    // events + license_plates); lpr_image_retention_days = snapshot JPGs (capped
    // ≤ metadata at runtime in lpr-retention.js so an image never outlives its row).
    lpr_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('lpr_retention_days must be 1..730');
      return String(n);
    },
    lpr_image_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('lpr_image_retention_days must be 1..730');
      return String(n);
    },
    // How long a plate photo stays on imgbb once it has been sent to LINE. Kept
    // apart from the platform-wide 48h on purpose: an ANPR frame on a
    // third-party host is heavier data to leave lying around than a doorway
    // alert. Ceiling is 720h (30 days) — well inside imgbb's own 180-day limit,
    // and past the point where anyone is still acting on the alert.
    lpr_line_image_expire_hours: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 720) throw new Error('lpr_line_image_expire_hours must be 1..720');
      return String(n);
    },
    // migration 147 — อายุลิงก์รูปที่เสิร์ฟจากโดเมนเราเอง (เดิมตายตัว 48 ชม.ในโค้ด)
    // ต่างจาก imgbb ตรงที่ไฟล์ไม่ได้ออกไปไหน หมดอายุ = ลิงก์ตาย ไฟล์ยังอยู่ที่เรา
    signed_image_expire_hours: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 720) throw new Error('signed_image_expire_hours must be 1..720');
      return String(n);
    },
    // สวิตช์ PDPA — ปิด = ถ้าลิงก์เราใช้ไม่ได้ ส่งการ์ดโดยไม่มีรูป ไม่โยนขึ้น host ภายนอก
    imgbb_fallback_enabled: v => (String(v) === 'false' || v === false) ? 'false' : 'true',
    clip_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 90) throw new Error('clip_retention_days must be 1..90');
      return String(n);
    },
    // migration 117 — LPR bbox overlay toggles (owner request 2026-08-06)
    lpr_bbox_vehicle_enabled:    v => (String(v) === '1' || v === true || v === 'true') ? '1' : '0',
    lpr_bbox_plate_enabled:      v => (String(v) === '1' || v === true || v === 'true') ? '1' : '0',
    lpr_bbox_full_image_enabled: v => (String(v) === '1' || v === true || v === 'true') ? '1' : '0',
    custom_range_max_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('custom_range_max_days must be 1..730');
      return String(n);
    },
    // ข้อความที่ผู้ใช้เห็นเมื่อไปถึงหน้าที่ตัวเองไม่มีสิทธิ์ (decision #251/#254)
    // ⚠️ ถ้าไม่มี validator ตัวนี้ `PUT /api/settings/:key` จะตอบ 404 ให้ทุกครั้ง
    // (บรรทัด `if (!validator) return 404` ข้างล่าง) = ช่องแก้ข้อความพังเงียบๆ
    restricted_view_message: v => {
      if (typeof v !== 'string') throw new Error('restricted_view_message must be a string');
      const s = v.trim();
      if (s.length < 1 || s.length > 300) throw new Error('restricted_view_message must be 1..300 chars');
      return s;
    },
    display_timezone: v => {
      if (typeof v !== 'string' || !v.trim()) throw new Error('display_timezone must be a string');
      try { new Date().toLocaleString('en-US', { timeZone: v }); } catch { throw new Error('invalid timezone'); }
      return v.trim();
    },
    // FACE-UI FP6 — face system settings
    face_similarity_min: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 50 || n > 99) throw new Error('face_similarity_min must be 50..99');
      return String(n);
    },
    face_show_expression: v => {
      const s = String(v) === '1' || v === true || v === 'true' ? '1' : '0';
      return s;
    },
    // Lab Test — AuraFace-v1 blacklist match threshold, integer % (face-embed-worker.js polls this)
    auraface_match_threshold: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 99) throw new Error('auraface_match_threshold must be 1..99');
      return String(n);
    },
    counter_dedup_mode: v => {
      if (!['state', 'object_window', 'none'].includes(v)) throw new Error('counter_dedup_mode must be state|object_window|none');
      return v;
    },
    comparison_mode: v => {
      if (!['rolling', 'calendar'].includes(v)) throw new Error('comparison_mode must be rolling|calendar');
      return v;
    },
    analytics_event_display: v => {
      if (typeof v !== 'string') throw new Error('analytics_event_display must be a CSV string');
      const parts = v.split(',').map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        if (!ANALYTICS_EVENT_KEYS.includes(p)) throw new Error(`unknown analytics event key: ${p}`);
      }
      return ANALYTICS_EVENT_KEYS.filter(k => parts.includes(k)).join(',');
    },
    brand_name: v => {
      if (typeof v !== 'string') throw new Error('brand_name must be a string');
      const s = v.trim();
      if (s.length < 1 || s.length > 100) throw new Error('brand_name must be 1..100 chars');
      return s;
    },
    brand_tagline: v => {
      if (typeof v !== 'string') throw new Error('brand_tagline must be a string');
      const s = v.trim();
      if (s.length > 200) throw new Error('brand_tagline too long (max 200)');
      return s;
    },
    brand_logo_path: v => {
      if (typeof v !== 'string') throw new Error('brand_logo_path must be a string');
      const s = v.trim();
      if (s && !/^[A-Za-z0-9._-]+$/.test(s)) throw new Error('brand_logo_path must be a simple filename');
      return s;
    },
    brand_footer_logo_path: v => {
      if (typeof v !== 'string') throw new Error('brand_footer_logo_path must be a string');
      const s = v.trim();
      if (s && !/^[A-Za-z0-9._-]+$/.test(s)) throw new Error('brand_footer_logo_path must be a simple filename');
      return s;
    },
    brand_primary_color: v => {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.trim())) throw new Error('brand_primary_color must be #RRGGBB');
      return v.trim().toLowerCase();
    },
  };

  // PUT /api/settings/map — Mapbox token + CARTO API key (admin-only; decision #171)
  // Must be before /:key wildcard so Express doesn't treat 'map' as a generic key.
  app.put('/api/settings/map', auth.requireAdmin, async (req, res) => {
    const auditDetail = {};
    try {
      // Handle Mapbox token only if present in body
      if (Object.prototype.hasOwnProperty.call(req.body, 'mapboxToken')) {
        const mapboxToken = req.body.mapboxToken;
        // pk. = public token; reject sk. (secret) — SEC-003
        if (mapboxToken && !/^pk\.[A-Za-z0-9._-]+$/.test(mapboxToken)) {
          return res.status(400).json({ error: 'invalid_token_format' });
        }
        await pool.query(
          "INSERT INTO system_settings(key,value) VALUES('mapbox_token',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
          [mapboxToken || '']
        );
        invalidateMapboxToken();
        auditDetail.tokenSet = !!(mapboxToken);
      }

      // Handle CARTO API key only if present in body
      if (Object.prototype.hasOwnProperty.call(req.body, 'cartoApiKey')) {
        const cartoApiKey = req.body.cartoApiKey;
        // Validate format: allow empty (clear), or alphanumeric + . _ - between 8-200 chars
        if (cartoApiKey && !/^[A-Za-z0-9._-]{8,200}$/.test(cartoApiKey)) {
          return res.status(400).json({ error: 'invalid_carto_key_format' });
        }
        await pool.query(
          "INSERT INTO system_settings(key,value) VALUES('carto_api_key',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
          [cartoApiKey || '']
        );
        invalidateCartoKey();
        auditDetail.cartoKeySet = !!(cartoApiKey);
      }

      await auth.logAudit(req.user?.id, req.user?.username, 'map_settings_token_update', null, null, getIP(req), req.headers['user-agent'], auditDetail);
      res.json({ success: true });
    } catch (err) { routeError(res, err, 'PUT /api/settings/map'); }
  });

  // PUT /api/settings/:key — update setting (with validation)
  app.put('/api/settings/:key', async (req, res) => {
    const key = req.params.key;
    const validator = SETTINGS_VALIDATORS[key];
    if (!validator) return res.status(404).json({ error: 'unknown setting key' });
    let value;
    try { value = validator(req.body?.value); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    try {
      const { rows } = await pool.query(
        `UPDATE system_settings SET value=$1 WHERE key=$2 RETURNING *`,
        [value, key]
      );
      if (!rows[0]) return res.status(404).json({ error: 'setting row missing' });
      if (key === 'analytics_event_display') refreshAnalyticsEnabledSet();
      invalidateSystemSetting(key);
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'PUT /api/settings/:key'); }
  });
};

module.exports.redactSettings = redactSettings;
module.exports.SECRET_SETTING_KEYS = SECRET_SETTING_KEYS;
module.exports.PUBLIC_SETTING_KEYS = PUBLIC_SETTING_KEYS;
module.exports.validateReportSectionTitles = validateReportSectionTitles;
module.exports.REPORT_SECTION_KEYS = REPORT_SECTION_KEYS;
