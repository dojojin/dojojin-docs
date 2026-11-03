// ============================================================
// Vigil Platform — Authentication Module
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Features:
// - Password hashing (bcrypt)
// - Session management (signed cookies)
// - Express middleware (requireAuth / requireAdmin)
// - Audit logging
// - Rate limiting (brute force protection)
// ============================================================

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getSystemSettings } = require('./helpers/getSystemSetting');

const SESSION_TTL_DAYS = 7;
// ค่า default ของนโยบายล็อคบัญชี — ตั้งแต่ migration 196 ค่าจริงอ่านจาก
// system_settings (login_max_failed / login_lockout_minutes, แก้ได้ใน
// Settings→System) ผ่าน _lockoutPolicy() ด้านล่าง สองค่านี้เหลือหน้าที่เป็น
// fallback เมื่อแถวหาย/อ่านไม่ได้ เพื่อไม่ให้ login พังเพราะ settings พัง
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// อ่านนโยบายล็อคจาก system_settings (cache 60s ใน helper) — เรียกเฉพาะตอน
// password ผิด ไม่ได้อยู่บน hot path · ค่าที่ parse ไม่ได้ = ใช้ default
async function _lockoutPolicy() {
  try {
    const s = await getSystemSettings(pool, ['login_max_failed', 'login_lockout_minutes']);
    const max = parseInt(s.login_max_failed, 10);
    const mins = parseInt(s.login_lockout_minutes, 10);
    return {
      max:  Number.isInteger(max)  && max  >= 1 ? max  : MAX_FAILED_ATTEMPTS,
      mins: Number.isInteger(mins) && mins >= 1 ? mins : LOCKOUT_MINUTES,
    };
  } catch { return { max: MAX_FAILED_ATTEMPTS, mins: LOCKOUT_MINUTES }; }
}

let pool = null;
let sessionSecret = null;

// ── Init ────────────────────────────────────────────────────
function init(pgPool, secret) {
  pool = pgPool;
  // ใช้ secret จาก env หรือ generate ใหม่ถ้าไม่มี
  sessionSecret = secret || crypto.randomBytes(32).toString('hex');
  if (!secret) {
    console.warn('🔐 SESSION_SECRET not set in .env — using random (sessions will reset on restart)');
  }
  ensureDefaultAdmin();
  // Cleanup expired sessions ทุก 1 ชั่วโมง
  setInterval(cleanupExpired, 60 * 60 * 1000);
}

// ── Default admin (สร้าง admin/changeme ครั้งแรก) ────────────
async function ensureDefaultAdmin() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(rows[0].count) === 0) {
      const hash = await bcrypt.hash('changeme', 10);
      await pool.query(
        `INSERT INTO users (username, full_name, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, 'admin', true)`,
        ['admin', 'Default Admin', hash]
      );
      console.log('');
      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║  🔐 DEFAULT ADMIN CREATED                        ║');
      console.log('║  Username: admin                                 ║');
      console.log('║  Password: changeme                              ║');
      console.log('║  ⚠️  CHANGE PASSWORD IMMEDIATELY AFTER LOGIN     ║');
      console.log('╚══════════════════════════════════════════════════╝');
      console.log('');
    }
  } catch (e) { console.error('🔐 ensureDefaultAdmin:', e.message); }
}

// ── Cleanup ─────────────────────────────────────────────────
async function cleanupExpired() {
  try {
    await pool.query('DELETE FROM sessions WHERE expires_at < NOW() OR revoked = true');
    await pool.query("DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '90 days'");
  } catch (e) { /* ignore */ }
  // PDPA: บันทึกการกดเปิดไฟล์ (IP + user agent) เก็บ 180 วัน (migration 266) · แยก try ให้ล้มไม่พาข้อบนล้ม
  try {
    await pool.query("DELETE FROM public_file_clicks WHERE clicked_at < NOW() - INTERVAL '180 days'");
  } catch (e) { /* ตารางยังไม่มีบนเครื่องที่ยังไม่รัน migration 266 */ }
}

// ── Password ────────────────────────────────────────────────
async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  try { return await bcrypt.compare(plain, hash); }
  catch { return false; }
}

// ── Session token (HMAC signed) ─────────────────────────────
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function signToken(sessionId) {
  const hmac = crypto.createHmac('sha256', sessionSecret).update(sessionId).digest('hex');
  return `${sessionId}.${hmac.slice(0, 32)}`;  // truncate hmac for shorter cookie
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [sessionId, sig] = parts;
  const expected = crypto.createHmac('sha256', sessionSecret).update(sessionId).digest('hex').slice(0, 32);
  // Constant-time compare
  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0 ? sessionId : null;
}

// ── Session ชั่วคราวสำหรับงานเบื้องหลัง (คำสั่งผ่าน LINE) ─────
// คำสั่งใน LINE ต้องยิง endpoint เดิม **ในนามผู้ใช้จริง** เพื่อให้ขอบเขตไซต์/สิทธิ์หน้า
// ทำงานตามปกติ · ทางเลือกอื่นคือใช้ internal token ซึ่งข้ามการตรวจสิทธิ์ทั้งหมด
// = ข้อมูลข้ามเขตหลุดเข้ากลุ่มแชท จึงไม่เลือก
//
// อายุสั้นมาก (ค่าเริ่มต้น 60 วินาที) และผู้เรียกต้องเรียก dropEphemeralSession() ใน
// finally เสมอ · แถวที่หลุดค้างไม่มีอันตราย เพราะหมดอายุเองและ getUserFromToken
// เช็ค expires_at อยู่แล้ว
//
// ⚠️ ปั๊ม user_agent ไว้ให้แยกออกจากคนล็อกอินจริงในหน้า Settings › Sessions
// ไม่งั้นแอดมินจะเห็น "session แปลก ๆ" โผล่แล้วหายเป็นระยะ แล้วอ่านเป็นเหตุด้านความปลอดภัย
async function createEphemeralSession(userId, { ttlSec = 60, tag = 'line-command' } = {}) {
  const sessionId = generateSessionId();
  await pool.query(
    `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, '127.0.0.1', $3, NOW() + ($4 || ' seconds')::interval)`,
    [sessionId, userId, tag, String(ttlSec)]
  );
  return { sessionId, token: signToken(sessionId) };
}

async function dropEphemeralSession(sessionId) {
  if (!sessionId) return;
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]).catch(() => {});
}

// ── Login ───────────────────────────────────────────────────
async function login(username, password, ipAddress, userAgent) {
  // Find user
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  const user = rows[0];

  if (!user || !user.enabled) {
    await logAudit(null, username, 'login_failed', null, null, ipAddress, userAgent, { reason: 'user_not_found_or_disabled' });
    return { success: false, error: 'Username หรือ password ไม่ถูกต้อง' };
  }

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minLeft = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    await logAudit(user.id, username, 'login_locked', null, null, ipAddress, userAgent, { minutes_left: minLeft });
    return { success: false, error: `บัญชีถูกล็อค กรุณารอ ${minLeft} นาที` };
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const { max, mins } = await _lockoutPolicy();
    const newAttempts = (user.failed_attempts || 0) + 1;
    let lockedUntil = null;
    if (newAttempts >= max) {
      lockedUntil = new Date(Date.now() + mins * 60 * 1000);
    }
    await pool.query(
      'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
      [newAttempts, lockedUntil, user.id]
    );
    await logAudit(user.id, username, 'login_failed', null, null, ipAddress, userAgent, { attempts: newAttempts });
    return {
      success: false,
      error: lockedUntil
        ? `Login ผิด ${max} ครั้ง — บัญชีถูกล็อค ${mins} นาที`
        : `Username หรือ password ไม่ถูกต้อง (เหลือ ${max - newAttempts} ครั้ง)`
    };
  }

  // Login success — create session
  await pool.query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW(), last_login_ip = $1 WHERE id = $2',
    [ipAddress, user.id]
  );

  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, user.id, ipAddress, userAgent, expiresAt]
  );

  await logAudit(user.id, username, 'login_success', null, null, ipAddress, userAgent, {});

  return {
    success: true,
    token: signToken(sessionId),
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      must_change_password: user.must_change_password,
    }
  };
}

// ── Logout ──────────────────────────────────────────────────
async function logout(token, ipAddress, userAgent) {
  const sessionId = verifyToken(token);
  if (!sessionId) return { success: true };
  try {
    const { rows } = await pool.query(
      'SELECT s.user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1',
      [sessionId]
    );
    if (rows[0]) {
      await logAudit(rows[0].user_id, rows[0].username, 'logout', null, null, ipAddress, userAgent, {});
    }
    await pool.query('UPDATE sessions SET revoked = true WHERE id = $1', [sessionId]);
  } catch {}
  return { success: true };
}

// ── Validate session (สำหรับ middleware) ────────────────────
async function getUserFromToken(token) {
  const sessionId = verifyToken(token);
  if (!sessionId) return null;

  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.email, u.full_name, u.role, u.enabled,
             u.must_change_password,
             u.allowed_views, u.landing_view, u.camera_select_mode,
             s.expires_at, s.id AS session_id
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.revoked = false
    `, [sessionId]);
    const row = rows[0];
    if (!row || !row.enabled) return null;
    if (new Date(row.expires_at) < new Date()) return null;

    // Update last_used_at (async, ไม่รอ)
    pool.query('UPDATE sessions SET last_used_at = NOW() WHERE id = $1', [sessionId]).catch(() => {});

    return {
      id: row.id,
      username: row.username,
      email: row.email,
      full_name: row.full_name,
      role: row.role,
      must_change_password: row.must_change_password,
      // สิทธิ์ระดับหน้า/แท็บ (decision #249) — ต้องอยู่ในทั้ง SELECT ข้างบน *และ*
      // object ที่ return ตรงนี้ ไม่งั้น field จะหายเงียบๆ ทุกจุดที่เรียกฟังก์ชันนี้
      // (นี่คือกับดักที่ทำให้ allowedSites หายมาแล้วครั้งหนึ่ง — GOTCHAS #162)
      // allowed_views: null = ไม่จำกัด · array = จำกัดเฉพาะที่ระบุ
      allowed_views: row.allowed_views ?? null,
      landing_view: row.landing_view ?? null,
        // ⚠️ ต้องอยู่ทั้งใน SELECT ข้างบนและ object นี้ ตามคำเตือน GOTCHAS #162
        camera_select_mode: row.camera_select_mode ?? 'multi',
      session_id: row.session_id,
    };
  } catch (e) {
    // Was a silent swallow — a transient DB hiccup here got indistinguishable
    // from "genuinely no session", which let the disclaimer/login/dashboard
    // redirect chain bounce forever (GOTCHAS #118). Log-only; still returns
    // null so callers keep treating it as unauthenticated.
    console.error('[auth] getUserFromToken query failed:', e.message);
    return null;
  }
}

// ── Express middleware ──────────────────────────────────────

// SEC-004: paths ที่ user ที่ยังไม่เปลี่ยน default password ยังเข้าได้
const ALLOW_WHILE_MUST_CHANGE = new Set([
  '/api/auth/logout',
  '/api/auth/change-password',
  '/api/auth/me',
]);

function requireAuth(req, res, next) {
  // Internal service calls (report-renderer, scheduler) — the global /api
  // middleware has already validated X-Internal-Token and set req.internal.
  // Skip the session check so server-internal HTTP calls don't 401.
  if (req.internal === true) return next();

  // ── อย่า re-fetch ถ้า global /api middleware ยืนยันตัวตนไปแล้ว ──────────
  // (เพิ่ม 2026-08-12 · decision #249 · root cause ของ GOTCHAS #162)
  // route ส่วนใหญ่ mount หลัง global middleware (`api-server.js:863`) ซึ่ง set
  // `req.user` **พร้อม field ที่คำนวณเพิ่ม** (`allowedSites`, `isSiteScoped`)
  // ไว้ให้แล้ว · ถ้าปล่อยให้ requireAuth ที่ใส่ซ้ำระดับ route ยิง
  // getUserFromToken() ใหม่แล้ว `req.user = user` ทับ → field ที่คำนวณเพิ่ม
  // **หายเงียบๆ** (ไม่ error ไม่ throw) แล้ว resolveSiteScope() เห็น undefined
  // → ตีความเป็น admin ไม่จำกัดสิทธิ์ = ช่องโหว่จริงที่เคยเกิดกับ traffic.js
  //
  // แก้ที่ต้นทางจุดเดียวแทนการไล่ลบ middleware ซ้ำ 84 จุด — ครอบ
  // requireAdmin/requireAdminOrAuditor ที่เรียกฟังก์ชันนี้ต่อด้วยโดยอัตโนมัติ
  // และกันไม่ให้เกิดซ้ำกับ route ที่ใครเขียนเพิ่มวันหน้า
  // ผลพลอยได้: ตัด DB round-trip ที่ซ้ำซ้อนออกจากทุก request ของ route เหล่านั้น
  //
  // route ที่ mount *ก่อน* global middleware (auth.js/users.js/partner-api.js
  // ที่ `:841/:846/:853`) จะไม่มี req.user → ตกลงมาทำงานเต็มรูปแบบเหมือนเดิม
  if (req.user) {
    if (req.user.must_change_password && !ALLOW_WHILE_MUST_CHANGE.has(req.path)) {
      return res.status(403).json({ error: 'Must change password before using the API', code: 'MUST_CHANGE_PASSWORD' });
    }
    return next();
  }

  const token = (req.cookies && req.cookies.session) || extractBearer(req);
  if (!token) return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });

  getUserFromToken(token).then(user => {
    if (!user) return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
    // SEC-004: block API calls จาก user ที่ยังไม่เปลี่ยน default password
    // ยกเว้นเฉพาะ logout / change-password / me เท่านั้น
    if (user.must_change_password && !ALLOW_WHILE_MUST_CHANGE.has(req.path)) {
      return res.status(403).json({ error: 'Must change password before using the API', code: 'MUST_CHANGE_PASSWORD' });
    }
    req.user = user;
    next();
  }).catch(() => res.status(500).json({ error: 'Auth error' }));
}

function requireAdmin(req, res, next) {
  if (req.internal === true) return next();
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
    next();
  });
}

// Admin หรือ Site Admin ที่ผ่าน siteAdminGate แล้ว (api-server ตั้ง req.siteAdminWriteOk หลังตรวจไซต์ของเป้าหมาย)
// ใช้กับ route ที่เดิมเป็น requireAdmin แต่เจ้าของให้ Site Admin ทำได้ในไซต์ตัวเอง (NVR · CSV · ตรวจรุ่น ·
// ทดสอบการเชื่อมต่อ — 2026-10-14) · ธงไม่ถูกตั้ง = ปฏิเสธ (fail closed)
function requireAdminOrGatedSiteAdmin(req, res, next) {
  if (req.internal === true) return next();
  requireAuth(req, res, () => {
    if (req.user.role === 'admin') return next();
    if (req.user.role === 'site_admin' && req.siteAdminWriteOk === true) return next();
    return res.status(403).json({ error: 'Admin role required' });
  });
}

// อ่านอย่างเดียว: admin · auditor · site_admin (ฝั่ง handler ตัดค่าลับ/ข้อมูลไซต์อื่นออกให้ site_admin เอง)
function requireAdminAuditorOrSiteAdmin(req, res, next) {
  if (req.internal === true) return next();
  requireAuth(req, res, () => {
    if (['admin', 'auditor', 'site_admin'].includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Admin role required' });
  });
}

// For admin-only GET/view endpoints that the read-only Auditor role
// also needs to see (Health, Users list, Audit Log, Backup list).
// Writes stay on requireAdmin — and the global auditor write-block
// rejects any non-GET from an auditor regardless.
function requireAdminOrAuditor(req, res, next) {
  if (req.internal === true) return next();
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'auditor') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    next();
  });
}

function extractBearer(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// ── Audit log ───────────────────────────────────────────────
async function logAudit(userId, username, action, targetUserId, targetUsername, ipAddress, userAgent, details, targetCameraId) {
  try {
    await pool.query(
      `INSERT INTO audit_log
         (user_id, username, action, target_user_id, target_username, target_camera_id, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [userId, username, action, targetUserId, targetUsername, targetCameraId || null, ipAddress, userAgent, JSON.stringify(details || {})]
    );
  } catch (e) { /* ignore */ }
}

// ── User CRUD (admin only) ──────────────────────────────────
async function listUsers() {
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.email, u.full_name, u.role, u.enabled,
           u.last_login_at, u.last_login_ip, u.failed_attempts, u.locked_until,
           u.must_change_password, u.created_at,
           u.allowed_views, u.landing_view, u.camera_select_mode,
           COALESCE(array_agg(DISTINCT us.site_id) FILTER (WHERE us.site_id IS NOT NULL), '{}') AS site_ids,
           COALESCE(array_agg(DISTINCT uc.camera_id) FILTER (WHERE uc.camera_id IS NOT NULL), '{}') AS camera_ids
    FROM users u
    LEFT JOIN user_sites us ON us.user_id = u.id
    LEFT JOIN user_cameras uc ON uc.user_id = u.id
    GROUP BY u.id ORDER BY u.id
  `);
  return rows;
}

// สิทธิ์ระดับหน้า/แท็บ (decision #251) — เขียนทีเดียวทั้ง 2 คอลัมน์
// `null` = ไม่จำกัด · `[]` = ไม่เห็นอะไรเลย — **ต่างกัน ห้ามแปลงหากัน**
// audit ไม่ต้องเขียนเอง: trigger `trg_users_authz_audit` (migration 143) ดักให้แล้ว
// ทุกทางเขียนรวม UPDATE ตรงเข้า DB
async function setUserViews(userId, allowedViews, landingView) {
  const { rows } = await pool.query(
    `UPDATE users SET allowed_views = $2::jsonb, landing_view = $3 WHERE id = $1
     RETURNING id, allowed_views, landing_view`,
    [userId, allowedViews === null ? null : JSON.stringify(allowedViews), landingView || null]
  );
  if (!rows[0]) throw new Error('user not found');
  return rows[0];
}

// แกนที่ 2 — กล้องที่ user คนนี้เห็นได้ (decision #253)
// ลิสต์ว่าง = ลบข้อจำกัดรายกล้อง (เห็นทุกกล้องใน Site ที่มีสิทธิ์) ไม่ใช่ "ไม่เห็นกล้องไหนเลย"
async function setUserCameras(userId, cameraIds) {
  await pool.query('BEGIN');
  try {
    await pool.query('DELETE FROM user_cameras WHERE user_id = $1', [userId]);
    if (cameraIds.length) {
      const vals = cameraIds.map((_, i) => `($1, $${i + 2})`).join(',');
      await pool.query(`INSERT INTO user_cameras (user_id, camera_id) VALUES ${vals}`, [userId, ...cameraIds]);
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function setUserSites(userId, siteIds) {
  await pool.query('BEGIN');
  try {
    await pool.query('DELETE FROM user_sites WHERE user_id = $1', [userId]);
    if (siteIds.length) {
      const vals = siteIds.map((_, i) => `($1, $${i + 2})`).join(',');
      await pool.query(`INSERT INTO user_sites (user_id, site_id) VALUES ${vals}`, [userId, ...siteIds]);
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function createUser({ username, password, email, full_name, role, must_change_password }, createdBy) {
  if (!username || !password) throw new Error('username + password required');
  if (!['admin', 'viewer', 'auditor', 'site_admin'].includes(role)) throw new Error('role must be admin, viewer, auditor or site_admin');
  const hash = await hashPassword(password);
  // บังคับเปลี่ยนรหัสตอน login แรกเป็น default (ปลอดภัยไว้ก่อน) — ปิดได้เฉพาะเมื่อ
  // admin เลือกปิดชัดๆ ตอนสร้าง (owner ask 2026-09-03: ทำเป็น checkbox ในฟอร์ม)
  const mustChange = must_change_password !== false;
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, email, full_name, role, created_by, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, role`,
    [username, hash, email || null, full_name || null, role, createdBy?.id || null, mustChange]
  );
  await logAudit(createdBy?.id, createdBy?.username, 'user_create', rows[0].id, username, null, null, { role, must_change_password: mustChange });
  return rows[0];
}

async function updateUser(id, updates, actor) {
  const allowedFields = ['email', 'full_name', 'role', 'enabled'];
  const sets = [];
  const values = [];
  let idx = 1;
  for (const f of allowedFields) {
    if (updates[f] !== undefined) {
      if (f === 'role' && !['admin', 'viewer', 'auditor', 'site_admin'].includes(updates[f])) {
        throw new Error('role must be admin, viewer, auditor or site_admin');
      }
      sets.push(`${f} = $${idx++}`);
      values.push(updates[f]);
    }
  }
  if (!sets.length) return null;
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, username, role, enabled`,
    values
  );
  if (rows[0]) {
    await logAudit(actor?.id, actor?.username, 'user_update', id, rows[0].username, null, null, updates);
  }
  return rows[0];
}

async function resetPassword(id, newPassword, actor) {
  if (!newPassword || newPassword.length < 8) throw new Error('Password ต้องอย่างน้อย 8 ตัวอักษร');
  const hash = await hashPassword(newPassword);
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $1, must_change_password = true,
       failed_attempts = 0, locked_until = NULL
     WHERE id = $2 RETURNING username`,
    [hash, id]
  );
  if (rows[0]) {
    // Revoke all sessions ของ user นี้ — ต้อง login ใหม่
    await pool.query('UPDATE sessions SET revoked = true WHERE user_id = $1', [id]);
    await logAudit(actor?.id, actor?.username, 'password_reset', id, rows[0].username, null, null, {});
  }
  return { success: true };
}

async function changeOwnPassword(userId, oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('Password ใหม่ต้องอย่างน้อย 8 ตัวอักษร');
  const { rows } = await pool.query('SELECT password_hash, username FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new Error('User not found');
  const valid = await verifyPassword(oldPassword, rows[0].password_hash);
  if (!valid) throw new Error('Password เดิมไม่ถูกต้อง');
  const hash = await hashPassword(newPassword);
  await pool.query(
    `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2`,
    [hash, userId]
  );
  await logAudit(userId, rows[0].username, 'password_change', userId, rows[0].username, null, null, {});
  return { success: true };
}

async function deleteUser(id, actor) {
  if (id === actor?.id) throw new Error('ลบบัญชีตัวเองไม่ได้');
  const { rows } = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
  if (!rows[0]) return { success: false };
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  await logAudit(actor?.id, actor?.username, 'user_delete', id, rows[0].username, null, null, {});
  return { success: true };
}

async function getAuditLog({ limit = 100, userId, action, targetCameraId } = {}) {
  const where = [];
  const values = [];
  let idx = 1;
  if (userId) { where.push(`user_id = $${idx++}`); values.push(userId); }
  if (action) { where.push(`action = $${idx++}`); values.push(action); }
  if (targetCameraId) { where.push(`target_camera_id = $${idx++}`); values.push(targetCameraId); }
  const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT $${idx}`;
  values.push(limit);
  const { rows } = await pool.query(sql, values);
  return rows;
}

async function getActiveSessions(userId) {
  const { rows } = await pool.query(`
    SELECT id, ip_address, user_agent, created_at, last_used_at, expires_at
    FROM sessions WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
    ORDER BY last_used_at DESC
  `, [userId]);
  return rows;
}

// Site-RBAC helpers (P1) ----------------------------------------
// Returns null (ALL) for admin/auditor; array of site_ids for viewer.
// Empty array = no sites assigned (fail-open preserved by caller until P2).
//
// ⚠️ ค่าที่คืนออกไปเป็น **array ที่มี property `cameras` ติดอยู่** (แกนที่ 2 ของสิทธิ์ —
// decision #253) `.length` / `ANY($n)` ยังทำงานเหมือนเดิมทุกประการ call site เดิม 66 จุด
// จึงไม่ต้องแก้ · แต่ **ห้าม spread/copy array นี้เอง** (`[...scope]`, `.slice()`,
// `JSON.parse(JSON.stringify())`) เพราะ property จะหาย = การจำกัดรายกล้องเงียบหายไป
// ต้องสร้างผ่าน `makeScope()` เท่านั้น (มีเทสต์ล็อกไว้ใน test/user-cameras-scope.test.js)
function makeScope(sites, cameras) {
  if (sites === null || sites === undefined) return null;
  const a = Array.from(sites);
  Object.defineProperty(a, 'cameras', { value: cameras ?? null, enumerable: false, writable: true });
  return a;
}

async function getAllowedSites(user, pool) {
  if (user.role === 'admin' || user.role === 'auditor') return null;
  const r = await pool.query('SELECT site_id FROM user_sites WHERE user_id = $1', [user.id]);
  return makeScope(r.rows.map(row => row.site_id), await getAllowedCameras(user, pool));
}

// แกนที่ 2 — "เห็นกล้องตัวไหนบ้าง" (`user_cameras`, migration 143)
// ไม่มีแถวเลย = ไม่จำกัดรายกล้อง (เห็นทุกตัวใน Site ที่มีสิทธิ์ — พฤติกรรมเดิม)
// มีแถว = เห็นเฉพาะกล้องนั้น **ตัดกับ** Site ที่มีสิทธิ์ (ใช้แหกกรอบ Site ไม่ได้)
async function getAllowedCameras(user, pool) {
  if (user.role === 'admin' || user.role === 'auditor') return null;
  const r = await pool.query('SELECT camera_id FROM user_cameras WHERE user_id = $1', [user.id]);
  return r.rows.length ? r.rows.map(row => row.camera_id) : null;
}

// แกนที่ 3 — "ดูพร้อมกันได้กี่ตัว" (`users.camera_select_mode`, migration 180)
// คนละเรื่องกับ user_cameras ข้างบน: อันนั้นคุม *ตัวไหน* อันนี้คุม *กี่ตัวพร้อมกัน*
// ผู้ใช้ที่มีสิทธิ์ 5 กล้องแต่เป็น single จะเลือกได้ทีละตัวจาก 5 ตัวนั้น
//
// admin/auditor ไม่ถูกจำกัด เหมือนสองแกนแรก
// ค่าที่อ่านไม่ได้/ไม่รู้จัก = 'multi' — พฤติกรรมเดิม ปลอดภัยกว่าการล็อกคนที่ไม่มี
// ใครสั่งให้ล็อก (ถ้าอ่านพลาดแล้วกลายเป็น single ทั้งระบบจะดูเหมือนหน้าจอพัง)
function cameraSelectMode(user) {
  if (!user || user.role === 'admin' || user.role === 'auditor') return 'multi';
  return user.camera_select_mode === 'single' ? 'single' : 'multi';
}

/**
 * รายชื่อ camera_id ที่ scope นี้เห็นได้ — **ใช้แทนการเขียน
 * `SELECT id FROM cameras WHERE site_id = ANY($1)` เองทุกที่**
 *
 * เหตุผล: แกนที่ 2 (จำกัดรายกล้อง `user_cameras`) เดินทางมากับ scope เป็น property
 * `cameras` ซึ่งมีแต่ helper ในไฟล์นี้ที่อ่าน · ใครประกอบ query เองจะได้กล้องทั้ง Site
 * กลับไปโดยไม่มี error ให้เห็น — บั๊กจริง 2026-08-12 (GOTCHAS #166)
 *
 * คืน `null` = ไม่จำกัด (อย่าเอาไปทำเป็น Set ว่าง!) · `Set` = รายชื่อที่เห็นได้
 */
async function scopedCameraIds(scope, pool) {
  if (scope === null || scope === undefined) return null;
  if (scope.length === 0) return new Set();
  const { rows } = await pool.query('SELECT id FROM cameras WHERE site_id = ANY($1)', [Array.from(scope)]);
  let ids = rows.map(r => r.id);
  const cams = scope.cameras || null;
  if (cams) { const only = new Set(cams); ids = ids.filter(id => only.has(id)); }
  return new Set(ids);
}

// Combines RBAC site scope (req.user.allowedSites) with the in-page Site-pill
// filter (?site_id=N) into the single array/null siteWhere() expects.
// A scoped viewer can only narrow further into their own sites, never escape
// them — picking a site_id outside allowedSites resolves to [] (no match),
// same fail-closed semantics siteWhere() already applies to empty arrays.
// Usage: siteWhere(resolveSiteScope(req), 'e.camera_id', paramOffset)
function resolveSiteScope(req) {
  const allowedSites = req.user?.allowedSites ?? null;
  // ต้องหอบ `cameras` ต่อไปทุกกิ่ง — สร้าง array ใหม่แล้วลืมติด = จำกัดรายกล้องหลุด
  const cams = req.user?.allowedCameras ?? (allowedSites ? allowedSites.cameras : null) ?? null;
  const siteId = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
  if (!siteId) return allowedSites === null ? makeScope(null) : makeScope(allowedSites, cams);
  if (allowedSites === null) return makeScope([siteId], cams);
  return makeScope(allowedSites.includes(siteId) ? [siteId] : [], cams);
}

// SQL fragment helper for camera-based site filtering.
// Usage: const { sql, args } = siteWhere(req.user.allowedSites, 'e.camera_id', paramOffset);
// Append sql to WHERE clause; spread args into query params.
// allowedSites=null → no-op (ALL); []=no match; [id,...]→filter.
function siteWhere(allowedSites, camCol, offset = 1) {
  if (allowedSites === null) return { sql: '', args: [] };
  if (allowedSites.length === 0) return { sql: 'AND FALSE', args: [] };
  const cams = allowedSites.cameras || null;
  if (!cams) {
    return {
      sql: `AND ${camCol} IN (SELECT id FROM cameras WHERE site_id = ANY($${offset}))`,
      args: [Array.from(allowedSites)],
    };
  }
  // จำกัดรายกล้องด้วย — ตัดกับ Site เสมอ (`user_cameras` ใช้แหกกรอบ Site ไม่ได้)
  if (!cams.length) return { sql: 'AND FALSE', args: [] };
  return {
    sql: `AND ${camCol} IN (SELECT id FROM cameras WHERE site_id = ANY($${offset}) AND id = ANY($${offset + 1}))`,
    args: [Array.from(allowedSites), cams],
  };
}

/**
 * Cache key ของ scope — **ใช้แทนการ `allowedSites.join(',')` เองทุกที่**
 *
 * เหตุผล: `siteWhere()` ใช้ทั้ง Site *และ* `cameras` (แกนที่ 2, decision #253) ในการ
 * ประกอบ SQL แต่ key ที่คนเขียนเองมักมีแค่ Site → ผู้ใช้สองคนที่ Site เดียวกันแต่เห็น
 * กล้องคนละชุด **ใช้ cache entry เดียวกัน** = คนที่ถูกจำกัด 4 กล้องได้ผลของคนที่เห็น 84
 * กล้องกลับไป (site 18/20 ของจริง) — รั่วข้ามสิทธิ์เงียบ ๆ ไม่มี error ให้เห็น
 *
 * pure · ไม่ throw · array ธรรมดาที่ไม่มี `cameras` → `'*'` (= ไม่จำกัดรายกล้อง
 * ซึ่งตรงกับที่ `siteWhere()` ทำกับ array แบบนั้นพอดี)
 * รูปแบบ: `'all'` | `'<sites|none>|<cameras|none|*>'`
 */
function scopeCacheKey(allowedSites) {
  if (allowedSites === null || allowedSites === undefined) return 'all';
  const sites = Array.from(allowedSites).sort((a, b) => a - b).join(',') || 'none';
  const cams = allowedSites.cameras;   // อ่านจาก argument ไม่ใช่ copy ข้างบน
  if (cams === null || cams === undefined) return `${sites}|*`;
  return `${sites}|${Array.from(cams).sort().join(',') || 'none'}`;
}
// ---------------------------------------------------------------

async function revokeSession(sessionId, actor) {
  await pool.query('UPDATE sessions SET revoked = true WHERE id = $1', [sessionId]);
  await logAudit(actor?.id, actor?.username, 'session_revoke', null, null, null, null, { session_id: sessionId.slice(0, 8) });
  return { success: true };
}

module.exports = {
  requireAdminOrGatedSiteAdmin, requireAdminAuditorOrSiteAdmin,
  init,
  makeScope,
  getAllowedCameras,
  scopedCameraIds,
  login,
  logout,
  createEphemeralSession,
  dropEphemeralSession,
  getUserFromToken,
  requireAuth,
  requireAdmin,
  requireAdminOrAuditor,
  cameraSelectMode,
  hashPassword,
  verifyPassword,
  // User mgmt
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  changeOwnPassword,
  deleteUser,
  // Audit + sessions
  getAuditLog,
  getActiveSessions,
  revokeSession,
  logAudit,
  // Site-RBAC P1+P5
  getAllowedSites,
  siteWhere,
  scopeCacheKey,
  resolveSiteScope,
  setUserSites,
  setUserViews,
  setUserCameras,
};
